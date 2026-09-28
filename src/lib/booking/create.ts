import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { generateBookingCode } from "./code";
import { isOverlapViolation } from "./overlap";
import { depositFor, lessonWindow, quote, type PaymentPlan } from "../pricing";
import { sanitizeSkillKeys } from "../skills";
import {
  torontoWallTimeToUtc,
  dateKeyToDbDate,
  toDateKey,
  type DateKey,
} from "../time";
import { isWithinSeason, seasonOfDateKey } from "../season";
import { isEarlyBird, rateFor } from "../rates";
import {
  checkPackageUse,
  hoursUsed,
  packageTotalHours,
  packageValueCents,
  PACKAGE_CONSUMING_STATUSES,
  type PackageUseRefusal,
} from "../packages";
import { computeDaySlots, isBookable } from "../slots";
import { OCCUPYING_STATUSES } from "./state";
import { buildDisclosure, type DisclosureSnapshot } from "./disclosure";
import type { Locale } from "@/i18n/routing";
import { resolveWaiver } from "../waiver/validity";
import { EXPIRING_HOLD_STATUSES } from "./hold";
import { MAX_SUPPORTED_HEADCOUNT } from "./group";

/** Minutes a self-serve booking holds its slot while the student finishes up. */
export const HOLD_MINUTES = 30;

export type CreateBookingResult =
  | {
      ok: true;
      code: string;
      id: string;
      /** "done" when a package paid for it and a waiver was already on file. */
      nextStep: "waiver" | "payment" | "done";
    }
  | {
      ok: false;
      reason:
        | "off-season"
        | "no-such-day"
        | "coach-unavailable"
        | "lesson-type-unavailable"
        | "group-booking-unavailable"
        | "slot-unavailable"
        | "slot-taken"
        | "package-not-found"
        | PackageUseRefusal;
    };

type CreateInput = {
  coachId: string;
  dateKey: DateKey;
  startHour: number;
  hours: number;
  /** Key from lib/lesson-types.ts; must be one the coach has a rate for. */
  lessonType: string;
  /** Number of students; defaults to 1. Capped at the coach's maxGroupSize. */
  headcount?: number;
  /** Skill keys the student wants to work on; unknown keys are dropped. */
  requestedSkills?: string[];
  /**
   * FULL pays everything now; DEPOSIT pays one hour now; PACKAGE spends
   * prepaid hours from `packageId`. Defaults to FULL.
   */
  paymentPlan?: PaymentPlan | "PACKAGE";
  /** The account's lesson package, when paymentPlan is PACKAGE. */
  packageId?: string | null;
  locale: Locale;
  /** Self-serve booking by the account holder. */
  account?: {
    id: string;
    participantId: string;
    participantName: string;
    /** Stored participant flag; determines whether an existing waiver applies. */
    participantIsMinor: boolean;
    level?: string | null;
  };
  /** Coach-created booking; the student signs later via an invite link. */
  invite?: { name: string; email: string; isMinor: boolean };
  notes?: string | null;
  now?: Date;
};

/**
 * Creates a booking, or explains why it could not.
 *
 * Two layers guard against double-booking, and both are needed:
 *
 *   - The slot computation rejects anything outside the coach's window, during
 *     lunch, or overlapping a live booking. This produces good error messages.
 *   - The `booking_no_overlap` exclusion constraint catches the race the first
 *     layer cannot: two requests that both read "free" before either writes.
 *     That surfaces as SQLSTATE 23P01 and becomes "slot-taken".
 *
 * Expired holds are swept inside the same transaction as the insert, so a
 * dead hold that the cron has not collected yet cannot block a real booking.
 *
 * The rate is the coach's price for the lesson type — early bird when the
 * booking is made on or before 1 December. A booking paid from a lesson
 * package costs nothing on its own; the package row is locked while its
 * remaining hours are checked, so two bookings cannot spend the same hours.
 */
export async function createBooking(
  input: CreateInput,
): Promise<CreateBookingResult> {
  const now = input.now ?? new Date();

  if (!isWithinSeason(input.dateKey)) return { ok: false, reason: "off-season" };
  if ((input.headcount ?? 1) > MAX_SUPPORTED_HEADCOUNT) {
    return { ok: false, reason: "group-booking-unavailable" };
  }

  const profile = await prisma.coachProfile.findUnique({
    where: { userId: input.coachId },
    include: { rates: true },
  });
  if (!profile) return { ok: false, reason: "coach-unavailable" };

  const rate = rateFor(
    profile.rates,
    input.lessonType,
    isEarlyBird(toDateKey(now), input.dateKey),
  );
  if (!rate) return { ok: false, reason: "lesson-type-unavailable" };

  const usePackage = input.paymentPlan === "PACKAGE";
  // Packages belong to a student account; a coach-created booking has none.
  if (usePackage && (!input.account || !input.packageId)) {
    return { ok: false, reason: "package-not-found" };
  }

  const day = await prisma.coachDay.findUnique({
    where: {
      coachId_date: {
        coachId: input.coachId,
        date: dateKeyToDbDate(input.dateKey),
      },
    },
    include: { resort: true },
  });
  if (!day) return { ok: false, reason: "no-such-day" };

  const startAt = torontoWallTimeToUtc(input.dateKey, input.startHour);
  const endAt = torontoWallTimeToUtc(input.dateKey, input.startHour + input.hours);
  const { lessonStartAt, lessonEndAt } = lessonWindow(startAt, endAt);

  // The request boundary currently admits one participant. Keep the coach cap
  // as a second guard so this remains correct when group booking is enabled.
  const headcount = Math.min(
    Math.max(1, input.headcount ?? 1),
    profile.maxGroupSize,
  );

  const priced = quote({
    hours: input.hours,
    hourlyRateCents: rate.hourlyRateCents,
    headcount,
    extraPersonCents: profile.extraPersonCents,
  });

  const plan = input.paymentPlan ?? "FULL";
  const depositCents = plan === "DEPOSIT" ? depositFor(priced) : priced.totalCents;

  const disclosure = buildDisclosure({
    locale: input.locale,
    coach: {
      displayName: profile.displayName,
      contactEmail: profile.contactEmail,
      contactPhone: profile.contactPhone,
      wechatId: profile.wechatId,
    },
    resort: { nameEn: day.resort.nameEn, nameZh: day.resort.nameZh },
    dateKey: input.dateKey,
    startAt,
    endAt,
    lessonStartAt,
    lessonEndAt,
    quote: priced,
    lessonType: input.lessonType,
    earlyBird: rate.earlyBird,
    cancellationPolicyZh: profile.cancellationPolicyZh ?? "",
    cancellationPolicyEn: profile.cancellationPolicyEn ?? "",
    participantName: input.account?.participantName ?? input.invite?.name ?? "",
  });

  // Coach-created bookings hold the slot indefinitely: the coach owns it and
  // chases the signature themselves. Self-serve holds expire.
  const createdByCoach = Boolean(input.invite);
  const holdExpiresAt = createdByCoach
    ? null
    : new Date(now.getTime() + HOLD_MINUTES * 60_000);

  try {
    const booking = await prisma.$transaction(async (tx) => {
      await sweepExpiredHolds(tx, input.coachId, now);

      const pkg = usePackage
        ? await claimPackageHours(tx, {
            packageId: input.packageId!,
            accountId: input.account!.id,
            coachId: input.coachId,
            resortId: day.resortId,
            lessonType: input.lessonType,
            season: seasonOfDateKey(input.dateKey),
            hours: input.hours,
            headcount,
            now,
          })
        : null;

      // A waiver belongs to the participant (not merely the account), coach,
      // lesson season and template version. resolveWaiver also rejects an
      // otherwise matching signature when the stored minor flag has changed.
      let reusableWaiverId: string | null = null;
      if (input.account) {
        const waivers = await tx.waiver.findMany({
          where: {
            participantId: input.account.participantId,
            coachId: input.coachId,
          },
          select: {
            id: true,
            season: true,
            templateVersion: true,
            participantWasMinor: true,
            revokedAt: true,
            signedAt: true,
          },
        });
        const resolved = resolveWaiver({
          waivers,
          participantIsMinor: input.account.participantIsMinor,
          lessonStartAt,
        });
        if (!resolved.needsSigning) reusableWaiverId = resolved.waiver.id;
      }

      // Re-read live bookings inside the transaction so the availability check
      // reflects the sweep we just did.
      const live = await tx.booking.findMany({
        where: { coachDayId: day.id, status: { in: OCCUPYING_STATUSES } },
        select: { startAt: true, endAt: true },
      });

      const slots = computeDaySlots(
        {
          dateKey: input.dateKey,
          startHour: day.startHour,
          endHour: day.endHour,
          breakStartHour: day.breakStartHour,
          breakEndHour: day.breakEndHour,
        },
        live,
        now,
        {
          minHours: profile.minHours,
          maxHours: profile.maxHours,
          // A coach booking on behalf of a student is not bound by the notice
          // period — they are arranging it directly.
          leadTimeHours: createdByCoach ? 0 : profile.leadTimeHours,
        },
      );

      if (!isBookable(slots, input.startHour, input.hours)) {
        throw new SlotUnavailable();
      }

      return tx.booking.create({
        data: {
          code: generateBookingCode(),
          accountId: input.account?.id ?? null,
          participantId: input.account?.participantId ?? null,
          coachId: input.coachId,
          resortId: day.resortId,
          coachDayId: day.id,
          createdByCoach,
          startAt,
          endAt,
          hours: input.hours,
          headcount,
          lessonStartAt,
          lessonEndAt,
          lessonType: input.lessonType,
          earlyBird: pkg ? false : rate.earlyBird,
          paymentPlan: plan,
          packageId: pkg?.id ?? null,
          depositCents: pkg ? 0 : depositCents,
          // Unknown skill keys are dropped rather than stored, so a stale or
          // hand-crafted client cannot write junk into the record.
          requestedSkills: sanitizeSkillKeys(input.requestedSkills ?? []),
          studentLevel: input.account?.level ?? null,
          // hourlyRateCents is the base (one-student) rate; the surcharge is
          // stored separately so the effective rate stays re-derivable. A
          // package booking records what a package hour is worth and owes
          // nothing, because the package was paid for up front.
          ...(pkg
            ? {
                hourlyRateCents: packageValueCents(pkg, 1),
                extraPersonCents: 0,
                subtotalCents: 0,
                handoverDiscountCents: 0,
                totalCents: 0,
                currency: pkg.currency,
              }
            : {
                hourlyRateCents: priced.hourlyRateCents,
                extraPersonCents: priced.extraPersonCents,
                subtotalCents: priced.subtotalCents,
                handoverDiscountCents: priced.handoverDiscountCents,
                totalCents: priced.totalCents,
                currency: priced.currency,
              }),
          disclosureSnapshot: (pkg
            ? withPackage(disclosure, pkg, input.hours)
            : disclosure) as unknown as Prisma.InputJsonValue,
          inviteName: input.invite?.name ?? null,
          inviteEmail: input.invite?.email.toLowerCase() ?? null,
          inviteIsMinor: input.invite?.isMinor ?? false,
          participantNameSnapshot:
            input.account?.participantName ?? input.invite?.name ?? null,
          notes: input.notes ?? null,
          // Nothing is owed on a package booking, so once a waiver is on file
          // it is confirmed outright.
          status: createdByCoach
            ? "AWAITING_WAIVER"
            : reusableWaiverId
              ? pkg
                ? "CONFIRMED"
                : "AWAITING_PAYMENT"
              : "HOLD",
          holdExpiresAt: pkg && reusableWaiverId ? null : holdExpiresAt,
          waiverId: reusableWaiverId,
        },
        select: { id: true, code: true, status: true },
      });
    });

    return {
      ok: true,
      code: booking.code,
      id: booking.id,
      nextStep:
        booking.status === "CONFIRMED"
          ? "done"
          : booking.status === "AWAITING_PAYMENT"
            ? "payment"
            : "waiver",
    };
  } catch (err) {
    if (err instanceof SlotUnavailable) {
      return { ok: false, reason: "slot-unavailable" };
    }
    if (err instanceof PackageRefused) {
      return { ok: false, reason: err.reason };
    }
    // Lost the race to another request between the check and the insert.
    if (isOverlapViolation(err)) return { ok: false, reason: "slot-taken" };
    throw err;
  }
}

class SlotUnavailable extends Error {}

class PackageRefused extends Error {
  constructor(readonly reason: PackageUseRefusal | "package-not-found") {
    super(reason);
  }
}

/**
 * Checks a package can pay for this lesson, holding a row lock on it until
 * the booking transaction commits. Two bookings racing for the last two hours
 * serialise here: the second one re-counts after the first has inserted.
 *
 * Holds whose timer has run out are not counted even if the sweeper has not
 * reached them yet — they may belong to another coach, whose holds this
 * transaction's sweep does not touch.
 */
async function claimPackageHours(
  tx: Prisma.TransactionClient,
  want: {
    packageId: string;
    accountId: string;
    coachId: string;
    resortId: string;
    lessonType: string;
    season: string | null;
    hours: number;
    headcount: number;
    now: Date;
  },
) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "LessonPackage" WHERE "id" = ${want.packageId} FOR UPDATE
  `;
  const pkg = await tx.lessonPackage.findUnique({
    where: { id: want.packageId },
    include: {
      bookings: {
        where: { status: { in: PACKAGE_CONSUMING_STATUSES } },
        select: { hours: true, status: true, holdExpiresAt: true },
      },
      adjustments: { select: { hours: true } },
    },
  });
  // Someone else's package id looks exactly like a missing one.
  if (!pkg || pkg.accountId !== want.accountId) {
    throw new PackageRefused("package-not-found");
  }

  const check = checkPackageUse(
    {
      ...pkg,
      hours: packageTotalHours(pkg),
      hoursUsed: hoursUsed(pkg.bookings, want.now),
    },
    want,
  );
  if (!check.ok) throw new PackageRefused(check.reason);
  return pkg;
}

/** Records on the frozen disclosure that a package paid for this lesson. */
function withPackage(
  disclosure: DisclosureSnapshot,
  pkg: { code: string; priceCents: number; hours: number },
  hours: number,
): DisclosureSnapshot {
  return {
    ...disclosure,
    price: {
      ...disclosure.price,
      subtotalCents: 0,
      handoverDiscountCents: 0,
      totalCents: 0,
      earlyBird: false,
      package: {
        code: pkg.code,
        hours,
        valueCents: packageValueCents(pkg, hours),
      },
    },
  };
}

/**
 * Releases holds whose timer ran out.
 *
 * Coach-created bookings have a null holdExpiresAt and are never swept.
 */
export async function sweepExpiredHolds(
  tx: Prisma.TransactionClient | PrismaClient,
  coachId: string | undefined,
  now: Date,
): Promise<number> {
  const result = await tx.booking.updateMany({
    where: {
      ...(coachId ? { coachId } : {}),
      status: { in: EXPIRING_HOLD_STATUSES },
      holdExpiresAt: { not: null, lte: now },
    },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

export type { DisclosureSnapshot };
