import { lessonTypeOrder } from "./lesson-types";
import {
  bookingHorizon,
  parseSeasonStartYear,
  seasonOfDateKey,
  type Season,
} from "./season";
import type { DateKey } from "./time";

/**
 * Hourly rates per coach per lesson type, and the early-bird rule.
 *
 * Every rate here is one-on-one, per hour, final: no tax is added on top. A
 * group adds the coach's per-extra-student surcharge (see pricing.ts).
 *
 * Early bird is decided by the day the booking is *made*, not the day of the
 * lesson: anything booked on or before 1 December — the season's opening day
 * — is charged the early-bird rate for any lesson that season. A booking made
 * on 2 December pays the regular rate even for a lesson the same week.
 */

/** Month and day of the last day early-bird prices apply, in Toronto. */
export const EARLY_BIRD_LAST_MONTH = 12;
export const EARLY_BIRD_LAST_DAY = 1;

/** One row of a coach's rate card. Absent row = type not offered. */
export type RateRow = {
  lessonType: string;
  regularCents: number;
  /** Null when the coach has no early-bird price for this type. */
  earlyBirdCents: number | null;
};

/** The last calendar day (inclusive) early-bird prices apply for a season. */
export function earlyBirdLastDay(season: Season): DateKey {
  const year = parseSeasonStartYear(season);
  const month = String(EARLY_BIRD_LAST_MONTH).padStart(2, "0");
  const day = String(EARLY_BIRD_LAST_DAY).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whether a booking made on `bookedOn` for a lesson on `lessonDate` gets the
 * early-bird rate. DateKeys are zero-padded ISO dates, so string comparison
 * is date comparison.
 */
export function isEarlyBird(bookedOn: DateKey, lessonDate: DateKey): boolean {
  const season = seasonOfDateKey(lessonDate);
  if (!season) return false;
  return bookedOn <= earlyBirdLastDay(season);
}

/**
 * Early-bird status for the season a student booking today would be booking
 * into — the upcoming one in the autumn, the current one in winter.
 */
export function earlyBirdWindow(today: DateKey): {
  season: Season;
  lastDay: DateKey;
  active: boolean;
} {
  const { season } = bookingHorizon(today);
  const lastDay = earlyBirdLastDay(season);
  return { season, lastDay, active: today <= lastDay };
}

/**
 * The one-on-one hourly rate for a lesson type, or null when the coach does
 * not offer it. `earlyBird` in the result says whether the early-bird price
 * was actually used — it is false when the booking qualifies but the coach
 * has no early-bird price for that type.
 */
export function rateFor(
  rates: RateRow[],
  lessonType: string,
  earlyBird: boolean,
): { hourlyRateCents: number; earlyBird: boolean } | null {
  const row = rates.find((r) => r.lessonType === lessonType);
  if (!row || row.regularCents <= 0) return null;
  if (earlyBird && row.earlyBirdCents != null) {
    return { hourlyRateCents: row.earlyBirdCents, earlyBird: true };
  }
  return { hourlyRateCents: row.regularCents, earlyBird: false };
}

/** The lesson types a coach offers, in price-sheet order. */
export function offeredRates(rates: RateRow[]): RateRow[] {
  return rates
    .filter((r) => r.regularCents > 0)
    .sort((a, b) => lessonTypeOrder(a.lessonType) - lessonTypeOrder(b.lessonType));
}
