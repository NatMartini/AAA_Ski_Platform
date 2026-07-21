import { type DateKey, toDateKey, parseDateKey } from "./time";

/**
 * A ski season runs 1 December through 1 May of the following year, and is
 * named for the pair, e.g. "2025-26" = 2025-12-01 .. 2026-05-01 inclusive.
 *
 * A waiver is valid for one participant, one coach, one season. Season is
 * decided by the *lesson* date, not the signing date, so a waiver signed in
 * November for a January lesson belongs to that January's season.
 *
 * Outside the window there are no lessons at all: availability and bookings are
 * both rejected. That keeps `seasonOf` from ever having to guess.
 */

export const SEASON_START_MONTH = 12; // December
export const SEASON_START_DAY = 1;
export const SEASON_END_MONTH = 5; // May
export const SEASON_END_DAY = 1; // inclusive — the last bookable day

export type Season = string; // "2025-26"

/**
 * The season a calendar date belongs to, or null if it falls in the off-season
 * (2 May through 30 November).
 */
export function seasonOfDateKey(dateKey: DateKey): Season | null {
  const [year, month, day] = parseDateKey(dateKey).split("-").map(Number);

  // Dec 1-31 opens the season named for this year.
  if (month === SEASON_START_MONTH && day >= SEASON_START_DAY) {
    return `${year}-${twoDigit(year + 1)}`;
  }
  // Jan through Apr belongs to the season that opened last December.
  if (month >= 1 && month < SEASON_END_MONTH) {
    return `${year - 1}-${twoDigit(year)}`;
  }
  // May 1 is the final day of that same season.
  if (month === SEASON_END_MONTH && day <= SEASON_END_DAY) {
    return `${year - 1}-${twoDigit(year)}`;
  }
  return null;
}

/** The season an instant's Toronto calendar date belongs to. */
export function seasonOf(instant: Date): Season | null {
  return seasonOfDateKey(toDateKey(instant));
}

export function isWithinSeason(dateKey: DateKey): boolean {
  return seasonOfDateKey(dateKey) !== null;
}

export function isInstantWithinSeason(instant: Date): boolean {
  return seasonOf(instant) !== null;
}

/** First and last bookable calendar dates of a season, inclusive. */
export function seasonRange(season: Season): { start: DateKey; end: DateKey } {
  const startYear = parseSeasonStartYear(season);
  return {
    start: `${startYear}-12-01`,
    end: `${startYear + 1}-05-01`,
  };
}

export function parseSeasonStartYear(season: Season): number {
  const match = /^(\d{4})-(\d{2})$/.exec(season);
  if (!match) throw new Error(`Invalid season: ${season}`);
  const startYear = Number(match[1]);
  if (twoDigit(startYear + 1) !== match[2]) {
    throw new Error(`Invalid season: ${season}`);
  }
  return startYear;
}

/** Human label, e.g. "2025-26 season" / "2025-26 雪季". */
export function formatSeason(season: Season, locale: "en" | "zh"): string {
  return locale === "zh" ? `${season} 雪季` : `${season} season`;
}

function twoDigit(year: number): string {
  return String(year % 100).padStart(2, "0");
}
