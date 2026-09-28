import { prisma } from "./prisma";
import { computeDaySlots, type DaySlots } from "./slots";
import {
  dbDateToDateKey,
  dateKeyToDbDate,
  toDateKey,
  type DateKey,
} from "./time";
import { OCCUPYING_STATUSES } from "./booking/state";
import { rulesFor } from "./coach";
import { isEarlyBird } from "./rates";

export type AvailableDay = DaySlots & {
  coachDayId: string;
  resort: { id: string; slug: string; nameEn: string; nameZh: string };
  /** A booking made now for this day would be charged the early-bird rate. */
  earlyBird: boolean;
  extraPersonCents: number;
  maxGroupSize: number;
};

/**
 * Builds the bookable grid for a coach over a date range.
 *
 * Only days the coach has explicitly opened appear at all — there is no
 * implicit "available unless booked". Bookings in an occupying status block
 * their hours; expired and cancelled ones do not.
 */
export async function getAvailability(opts: {
  coachId: string;
  from: DateKey;
  to: DateKey;
  now?: Date;
}): Promise<AvailableDay[]> {
  const now = opts.now ?? new Date();

  const profile = await prisma.coachProfile.findUnique({
    where: { userId: opts.coachId },
  });
  if (!profile) return [];

  const days = await prisma.coachDay.findMany({
    where: {
      coachId: opts.coachId,
      date: { gte: dateKeyToDbDate(opts.from), lte: dateKeyToDbDate(opts.to) },
    },
    select: {
      id: true,
      date: true,
      startHour: true,
      endHour: true,
      breakStartHour: true,
      breakEndHour: true,
      resort: { select: { id: true, slug: true, nameEn: true, nameZh: true } },
    },
    orderBy: { date: "asc" },
  });
  if (days.length === 0) return [];

  const bookings = await prisma.booking.findMany({
    where: {
      coachDayId: { in: days.map((d) => d.id) },
      status: { in: OCCUPYING_STATUSES },
    },
    select: { coachDayId: true, startAt: true, endAt: true },
  });

  const byDay = new Map<string, { startAt: Date; endAt: Date }[]>();
  for (const b of bookings) {
    const list = byDay.get(b.coachDayId) ?? [];
    list.push({ startAt: b.startAt, endAt: b.endAt });
    byDay.set(b.coachDayId, list);
  }

  const rules = rulesFor(profile);
  const today = toDateKey(now);

  return days.map((day) => {
    const dateKey = dbDateToDateKey(day.date);
    const slots = computeDaySlots(
      {
        dateKey,
        startHour: day.startHour,
        endHour: day.endHour,
        breakStartHour: day.breakStartHour,
        breakEndHour: day.breakEndHour,
      },
      byDay.get(day.id) ?? [],
      now,
      rules,
    );

    return {
      ...slots,
      coachDayId: day.id,
      resort: day.resort,
      earlyBird: isEarlyBird(today, dateKey),
      extraPersonCents: profile.extraPersonCents,
      maxGroupSize: profile.maxGroupSize,
    };
  });
}
