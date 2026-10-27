import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { generateBookingCode } from "./code";
import { isOverlapViolation } from "./overlap";
import { depositFor, lessonWindow, quote, type PaymentPlan } from "../pricing";
import { coachCanTeachRequestedSkills, sanitizeCoachRequestedSkills, snapshotRequestedSkills } from "../custom-skills";
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
import { MAX_SUPPORTED_HEADCOUNT, attendeeIdentity, type AdditionalAttendee } from "./group";
import { canAcceptBookings } from "../coach";
import { generateInviteToken, inviteFields } from "../waiver/invite";

/** Minutes a self-serve booking holds its slot while the student finishes up. */
export const HOLD_MINUTES = 30;
export const GROUP_HOLD_HOURS = 24;

export type CreatedAttendeeInvite = AdditionalAttendee & {
  attendeeId: string; ordinal: number; token: string; expiresAt: Date;
};

export type CreateBookingResult =
  | {
      ok: true;
      code: string;
      id: string;
      /** "done" when a package paid for it and a waiver was already on file. */
      nextStep: "waiver" | "payment" | "done";
      /** Returned only to the creating coach; only its hash is persisted. */
      inviteToken?: string;
      inviteExpiresAt?: Date;
      attendeeInvites?: CreatedAttendeeInvite[];
      holdExpiresAt?: Date | null;
      coachName?: string;
    }
  | {
      ok: false;
      reason:
        | "off-season"
        | "no-such-day"
        | "coach-unavailable"
        | "lesson-type-unavailable"
        | "group-booking-unavailable"
        | "invalid-requested-skills"
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
  /** Number of students; refuses requests above the coach's maxGroupSize. */
  headcount?: number;
  additionalAttendees?: AdditionalAttendee[];
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
    email?: string;
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
  const extras = input.additionalAttendees ?? [];
  const headcount = input.headcount ?? 1;
  const primaryName = input.account?.participantName ?? input.invite?.name ?? "";
  const primaryEmail = input.account?.email ?? input.invite?.email ?? "";

  if (!isWithinSeason(input.dateKey)) return { ok: false, reason: "off-season" };
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > MAX_SUPPORTED_HEADCOUNT ||
      headcount !== extras.length + 1 || (headcount > 1 && !primaryEmail) ||
      new Set([attendeeIdentity(primaryName, primaryEmail), ...extras.map((a) =>
        attendeeIdentity(a.fullName, a.email))]).size !== headcount) {
    return { ok: false, reason: "group-booking-unavailable" };
  }

  const profile = await prisma.coachProfile.findUnique({
    where: { userId: input.coachId },
    include: { rates: true },
  });
  if (!profile || (!input.invite && !canAcceptBookings(profile))) {
    return { ok: false, reason: "coach-unavailable" };
  }
  if (headcount > profile.maxGroupSize) return { ok: false, reason: "group-booking-unavailable" };
  const requestedSkills = sanitizeCoachRequestedSkills(input.requestedSkills ?? [], profile);
  if (!coachCanTeachRequestedSkills(input.requestedSkills ?? [], profile)) {
    return { ok: false, reason: "invalid-requested-skills" };
  }

  const rate = rateFor(
    profile.rates,
    input.lessonType,
    isEarlyBird(toDateKey(now), input.dateKey),
  );
  if (!rate) return { ok: false, reason: "lesson-type-unavailable" };

  const usePackage = input.paymentPlan === "PACKAGE";
  if (usePackage && headcount > 1) return { ok: false, reason: "group-booking-unavailable" };
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
  if (!day.resort.isActive) {
    return { ok: false, reason: "no-such-day" };
  }

  const startAt = torontoWallTimeToUtc(input.dateKey, input.startHour);
  const endAt = torontoWallTimeToUtc(input.dateKey, input.startHour + input.hours);
  const { lessonStartAt, lessonEndAt } = lessonWindow(startAt, endAt);

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

  // Groups need time to circulate individual signatures without retaining an
  // unfinished reservation past the coach's notice deadline.
  const createdByCoach = Boolean(input.invite);
  const inviteToken = input.invite ? generateInviteToken() : undefined;
  const signingInvite = input.invite && inviteToken
    ? inviteFields(input.invite.email, inviteToken, now) : null;
  const groupDeadline = new Date(lessonStartAt.getTime() -
    (createdByCoach ? 24 : profile.leadTimeHours) * 3_600_000);
  const holdExpiresAt = headcount > 1
    ? new Date(Math.min(groupDeadline.getTime(), createdByCoach ? Infinity : now.getTime() + GROUP_HOLD_HOURS * 3_600_000))
    : createdByCoach ? null : new Date(now.getTime() + HOLD_MINUTES * 60_000);
  if (headcount > 1 && holdExpiresAt!.getTime() <= now.getTime()) {
    return { ok: false, reason: "slot-unavailable" };
  }
  if (signingInvite && holdExpiresAt && signingInvite.expiresAt > holdExpiresAt) {
    signingInvite.expiresAt = holdExpiresAt;
  }
  const guestInvites = extras.map((attendee, index) => {
    const token = generateInviteToken();
    const fields = inviteFields(attendee.email, token, now);
    const expiresAt = new Date(Math.min(fields.expiresAt.getTime(), holdExpiresAt!.getTime()));
    return { ...attendee, email: fields.email, ordinal: index + 2, token, expiresAt, tokenHash: fields.tokenHash };
  });

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
          requestedSkills,
          requestedSkillsSnapshot: snapshotRequestedSkills(requestedSkills, profile) as Prisma.InputJsonValue,
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
            : reusableWaiverId && headcount === 1
              ? pkg
                ? "CONFIRMED"
                : "AWAITING_PAYMENT"
              : "HOLD",
          holdExpiresAt: pkg && reusableWaiverId ? null : holdExpiresAt,
          waiverId: reusableWaiverId,
          // The slot and its signing link commit together, so an invite write
          // failure cannot leave a reservation that the student cannot finish.
          ...(signingInvite ? { waiverInvite: { create: signingInvite } } : {}),
          ...(headcount > 1 ? { attendees: { create: [
            { ordinal: 1, fullName: primaryName, email: primaryEmail.trim().toLowerCase(),
              isMinor: input.account?.participantIsMinor ?? input.invite?.isMinor ?? false,
              accountId: input.account?.id ?? null, participantId: input.account?.participantId ?? null,
              waiverId: reusableWaiverId },
            ...guestInvites.map((a) => ({ ordinal: a.ordinal, fullName: a.fullName, email: a.email,
              isMinor: a.isMinor, inviteTokenHash: a.tokenHash, inviteExpiresAt: a.expiresAt })),
          ] } } : {}),
        },
        select: { id: true, code: true, status: true, attendees: { select: { id: true, ordinal: true } } },
      });
    });

    return {
      ok: true,
      code: booking.code,
      id: booking.id,
      holdExpiresAt,
      coachName: profile.displayName,
      attendeeInvites: [
        ...(headcount > 1 && inviteToken && signingInvite ? [{ attendeeId: booking.attendees.find((b) => b.ordinal === 1)!.id,
          ordinal: 1, fullName: primaryName, email: signingInvite.email, isMinor: input.invite!.isMinor,
          token: inviteToken, expiresAt: signingInvite.expiresAt }] : []),
        ...guestInvites.map((a) => ({ attendeeId: booking.attendees.find((b) => b.ordinal === a.ordinal)!.id,
          ordinal: a.ordinal, fullName: a.fullName, email: a.email, isMinor: a.isMinor, token: a.token, expiresAt: a.expiresAt })),
      ],
      ...(inviteToken && signingInvite ? {
        inviteToken,
        inviteExpiresAt: signingInvite.expiresAt,
      } : {}),
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
 * Legacy single coach arrangements have a null holdExpiresAt and are not swept.
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
