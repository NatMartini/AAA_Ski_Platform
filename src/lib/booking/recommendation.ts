import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { listBookableCoaches, rulesFor } from "../coach";
import { bookingHorizon, isWithinSeason, seasonOfDateKey, seasonRange } from "../season";
import { computeDaySlots, isBookable, type DaySlots } from "../slots";
import { addDaysToDateKey, dateKeyToDbDate, dbDateToDateKey, isDateKey, toDateKey,
  torontoWallTimeToUtc, type DateKey } from "../time";
import { isEarlyBird, rateFor } from "../rates";
import { coachCanTeachRequestedSkills, coachSkillOptions, sanitizeCoachRequestedSkills } from "../custom-skills";
import { OCCUPYING_STATUSES } from "./state";
import { isSelfServeHoldExpired } from "./hold";
import { MAX_SUPPORTED_HEADCOUNT } from "./group";

type BookableCoach = Awaited<ReturnType<typeof listBookableCoaches>>[number];
export type ResortBookingDay = {
  dateKey: DateKey;
  coachIds: string[];
  startOptions: Array<{ hour: number; startAt: Date; durations: number[];
    coachIdsByDuration: Record<number, string[]> }>;
};
export type CoachRecommendationInput = {
  resortSlug: string; dateKey: DateKey; startHour: number; hours: number;
  lessonType?: string; skills?: string[]; level?: string | null; headcount?: number;
};
export type RecommendedCoach = BookableCoach & {
  bookedHours: number; recommended: boolean;
  levelMatch: "listed" | "unlisted" | "unknown";
  matchedSkills: string[]; unmatchedSkills: string[];
};

/** Read fresh availability; these reads never reserve or mutate a slot. */
async function resortSlots(resortSlug: string, now: Date, exactDate?: DateKey) {
  const coaches = await listBookableCoaches();
  if (coaches.length === 0) return [];
  const horizon = bookingHorizon(toDateKey(now));
  if (exactDate && (!isDateKey(exactDate) || !isWithinSeason(exactDate) || exactDate < toDateKey(now))) return [];
  const days = await prisma.coachDay.findMany({
    where: {
      resort: { slug: resortSlug, isActive: true }, coachId: { in: coaches.map((c) => c.userId) },
      date: exactDate ? dateKeyToDbDate(exactDate) : {
        gte: dateKeyToDbDate(horizon.from), lte: dateKeyToDbDate(horizon.to),
      },
    },
    include: {
      resort: { select: { slug: true, isActive: true } },
      bookings: { where: { status: { in: OCCUPYING_STATUSES } },
        select: { startAt: true, endAt: true, status: true, holdExpiresAt: true } },
    },
    orderBy: [{ date: "asc" }, { coachId: "asc" }],
  });
  const byId = new Map(coaches.map((c) => [c.userId, c]));
  const available: Array<{ coach: BookableCoach; slots: DaySlots }> = [];
  for (const day of days) {
    const coach = byId.get(day.coachId);
    const dateKey = dbDateToDateKey(day.date);
    if (!coach || !day.resort.isActive || day.resort.slug !== resortSlug ||
        !isWithinSeason(dateKey) || (exactDate && dateKey !== exactDate)) continue;
    const occupied = day.bookings.filter((b) =>
      OCCUPYING_STATUSES.includes(b.status) && !isSelfServeHoldExpired(b, now));
    const slots = computeDaySlots({ dateKey, startHour: day.startHour, endHour: day.endHour,
      breakStartHour: day.breakStartHour, breakEndHour: day.breakEndHour }, occupied, now, rulesFor(coach));
    if (slots.startOptions.length > 0) available.push({ coach, slots });
  }
  return available;
}

/** Union legal time/duration pairs, retaining coaches eligible for each pair. */
export async function listResortBookingDays(resortSlug: string, now = new Date()): Promise<ResortBookingDay[]> {
  const availability = await resortSlots(resortSlug, now);
  const days = new Map<string, ResortBookingDay>();
  for (const { coach, slots } of availability) {
    let day = days.get(slots.dateKey);
    if (!day) { day = { dateKey: slots.dateKey, coachIds: [], startOptions: [] }; days.set(slots.dateKey, day); }
    if (!day.coachIds.includes(coach.userId)) day.coachIds.push(coach.userId);
    for (const start of slots.startOptions) {
      let option = day.startOptions.find((s) => s.hour === start.hour);
      if (!option) { option = { hour: start.hour, startAt: start.startAt, durations: [], coachIdsByDuration: {} }; day.startOptions.push(option); }
      for (const hours of start.durations) {
        const ids = option.coachIdsByDuration[hours] ??= [];
        if (!ids.includes(coach.userId)) ids.push(coach.userId);
        if (!option.durations.includes(hours)) option.durations.push(hours);
      }
    }
  }
  return [...days.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey)).map((day) => ({
    ...day, coachIds: day.coachIds.sort(),
    startOptions: day.startOptions.sort((a, b) => a.hour - b.hour).map((s) => ({
      ...s, durations: s.durations.sort((a, b) => a - b),
      coachIdsByDuration: Object.fromEntries(Object.entries(s.coachIdsByDuration).map(([hours, ids]) => [hours, ids.sort()])),
    })),
  }));
}

/** Match every selected skill and the exact slot before balancing teaching hours. */
export async function recommendCoaches(input: CoachRecommendationInput, userId?: string, now = new Date()): Promise<RecommendedCoach[]> {
  const headcount = input.headcount ?? 1;
  if (!isDateKey(input.dateKey) || !isWithinSeason(input.dateKey) ||
      !Number.isInteger(input.startHour) || input.startHour < 0 || input.startHour > 23 ||
      !Number.isInteger(input.hours) || input.hours < 1 || input.hours > 12 ||
      !Number.isInteger(headcount) || headcount < 1 || headcount > MAX_SUPPORTED_HEADCOUNT) return [];
  const available = await resortSlots(input.resortSlug, now, input.dateKey);
  const earlyBird = isEarlyBird(toDateKey(now), input.dateKey);
  const eligible = available.filter(({ coach, slots }) =>
    coach.maxGroupSize >= headcount && isBookable(slots, input.startHour, input.hours) &&
    (!input.lessonType || rateFor(coach.rates, input.lessonType, earlyBird) !== null) &&
    coachCanTeachRequestedSkills(input.skills ?? [], coach));
  if (eligible.length === 0) return [];
  const seasonKey = seasonOfDateKey(input.dateKey)!;
  const season = seasonRange(seasonKey);
  const commitments = await prisma.booking.findMany({
    where: {
      coachId: { in: eligible.map(({ coach }) => coach.userId) },
      status: { in: [...OCCUPYING_STATUSES, "COMPLETED"] },
      lessonStartAt: { gte: torontoWallTimeToUtc(season.start, 0),
        lt: torontoWallTimeToUtc(addDaysToDateKey(season.end, 1), 0) },
    },
    select: { coachId: true, hours: true, status: true, holdExpiresAt: true, lessonStartAt: true },
  });
  const loadBy = new Map<string, number>();
  for (const booking of commitments) {
    if ((!OCCUPYING_STATUSES.includes(booking.status) && booking.status !== "COMPLETED") ||
        isSelfServeHoldExpired(booking, now) || seasonOfDateKey(toDateKey(booking.lessonStartAt)) !== seasonKey) continue;
    loadBy.set(booking.coachId, (loadBy.get(booking.coachId) ?? 0) + booking.hours);
  }
  const salt = `${userId ?? "anonymous"}|${input.resortSlug}|${input.dateKey}|${input.startHour}|${input.hours}`;
  const tie = (coachId: string) => createHash("sha256").update(`${salt}|${coachId}`).digest("hex");
  const ranked = eligible.map(({ coach }) => {
    const skills = sanitizeCoachRequestedSkills(input.skills ?? [], coach);
    const offeredSkills = new Set(coachSkillOptions(coach).map((skill) => skill.key));
    return { ...coach, bookedHours: loadBy.get(coach.userId) ?? 0, recommended: false,
      levelMatch: (!input.level || coach.teachableLevels.length === 0 ? "unknown" :
        coach.teachableLevels.includes(input.level) ? "listed" : "unlisted") as RecommendedCoach["levelMatch"],
      matchedSkills: skills.filter((key) => offeredSkills.has(key)),
      unmatchedSkills: skills.filter((key) => !offeredSkills.has(key)),
    };
  }).sort((a, b) => a.bookedHours - b.bookedHours || tie(a.userId).localeCompare(tie(b.userId)));
  ranked[0].recommended = true;
  return ranked;
}
