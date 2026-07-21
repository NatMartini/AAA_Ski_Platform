import { prisma } from "./prisma";
import { computeDaySlots, type DaySlots } from "./slots";
import { dbDateToDateKey, dateKeyToDbDate, type DateKey } from "./time";
import { OCCUPYING_STATUSES } from "./booking/state";
import { rulesFor } from "./coach";
import { quote } from "./pricing";

export type AvailableDay = DaySlots & {
  coachDayId: string;
  resort: { id: string; slug: string; nameEn: string; nameZh: string };
  hourlyRateCents: number;
  handoverDiscountCents: number;
  note: string | null;
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
    include: {
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
      hourlyRateCents: day.hourlyRateCentsOverride ?? profile.hourlyRateCents,
      handoverDiscountCents: profile.handoverDiscountCents,
      note: day.note,
    };
  });
}

/** Price for one candidate booking, using that day's rate override if set. */
export function quoteForDay(day: AvailableDay, hours: number) {
  return quote({
    hours,
    hourlyRateCents: day.hourlyRateCents,
    handoverDiscountCents: day.handoverDiscountCents,
  });
}
