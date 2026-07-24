import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { generateBookingCode } from "./code";
import { isOverlapViolation } from "./overlap";
import { lessonWindow, quote } from "../pricing";
import { torontoWallTimeToUtc, dateKeyToDbDate, type DateKey } from "../time";
import { isWithinSeason } from "../season";
import { computeDaySlots, isBookable } from "../slots";
import { OCCUPYING_STATUSES } from "./state";
import { buildDisclosure, type DisclosureSnapshot } from "./disclosure";
import type { Locale } from "@/i18n/routing";

/** Minutes a self-serve booking holds its slot while the student finishes up. */
export const HOLD_MINUTES = 30;

export type CreateBookingResult =
  | { ok: true; code: string; id: string }
  | {
      ok: false;
      reason:
        | "off-season"
        | "no-such-day"
        | "coach-unavailable"
        | "slot-unavailable"
        | "slot-taken";
    };

type CreateInput = {
  coachId: string;
  dateKey: DateKey;
  startHour: number;
  hours: number;
  /** Number of students; defaults to 1. Capped at the coach's maxGroupSize. */
  headcount?: number;
  locale: Locale;
  /** Self-serve booking by the account holder. */
  account?: { id: string; participantId: string; participantName: string };
  /** Coach-created booking; the student signs later via an invite link. */
  invite?: { name: string; email: string; birthDate: DateKey };
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
 */
export async function createBooking(
  input: CreateInput,
): Promise<CreateBookingResult> {
  const now = input.now ?? new Date();

  if (!isWithinSeason(input.dateKey)) return { ok: false, reason: "off-season" };

  const profile = await prisma.coachProfile.findUnique({
    where: { userId: input.coachId },
  });
  if (!profile) return { ok: false, reason: "coach-unavailable" };

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

  // Clamp the group size to what this coach allows rather than trusting the
  // client; a maxGroupSize of 1 means no group bookings.
  const headcount = Math.min(
    Math.max(1, input.headcount ?? 1),
    profile.maxGroupSize,
  );

  const rate = day.hourlyRateCentsOverride ?? profile.hourlyRateCents;
  const priced = quote({
    hours: input.hours,
    hourlyRateCents: rate,
    handoverDiscountCents: profile.handoverDiscountCents,
    headcount,
    extraPersonCents: profile.extraPersonCents,
  });

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
          // hourlyRateCents is the base (one-student) rate; the surcharge is
          // stored separately so the effective rate stays re-derivable.
          hourlyRateCents: priced.hourlyRateCents,
          extraPersonCents: priced.extraPersonCents,
          subtotalCents: priced.subtotalCents,
          handoverDiscountCents: priced.handoverDiscountCents,
          totalCents: priced.totalCents,
          currency: priced.currency,
          disclosureSnapshot: disclosure as unknown as Prisma.InputJsonValue,
          inviteName: input.invite?.name ?? null,
          inviteEmail: input.invite?.email.toLowerCase() ?? null,
          inviteBirthDate: input.invite
            ? dateKeyToDbDate(input.invite.birthDate)
            : null,
          participantNameSnapshot:
            input.account?.participantName ?? input.invite?.name ?? null,
          notes: input.notes ?? null,
          status: createdByCoach ? "AWAITING_WAIVER" : "HOLD",
          holdExpiresAt,
        },
        select: { id: true, code: true },
      });
    });

    return { ok: true, code: booking.code, id: booking.id };
  } catch (err) {
    if (err instanceof SlotUnavailable) {
      return { ok: false, reason: "slot-unavailable" };
    }
    // Lost the race to another request between the check and the insert.
    if (isOverlapViolation(err)) return { ok: false, reason: "slot-taken" };
    throw err;
  }
}

class SlotUnavailable extends Error {}

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
      status: "HOLD",
      holdExpiresAt: { not: null, lt: now },
    },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

export type { DisclosureSnapshot };
