import { torontoWallTimeToUtc, utcToTorontoParts, type DateKey } from "../time";

/**
 * Videos are kept for the ski season they were uploaded in, which ends with May 31, Toronto time (owner's decision,
 * 2026-11-07). The analyses and their reports stay; only the footage goes. Plain date arithmetic, safe in the browser.
 */
const SEASON_LAST_MONTH = 5;

/** The season's last day for a video uploaded at `uploadedAt`: May 31 of the season it belongs to. */
export function seasonLastDay(uploadedAt: Date): DateKey {
  const { year, month } = utcToTorontoParts(uploadedAt);
  return `${month <= SEASON_LAST_MONTH ? year : year + 1}-05-31` as DateKey;
}

/** The moment that video is deleted: the start of June 1 after its season. */
export function videoKeptUntil(uploadedAt: Date): Date {
  const [year] = seasonLastDay(uploadedAt).split("-");
  return torontoWallTimeToUtc(`${year}-06-01` as DateKey, 0);
}

/** Every video uploaded before this moment belongs to a season that has ended by `now`. */
export function expiredBefore(now: Date): Date {
  const { year, month } = utcToTorontoParts(now);
  return torontoWallTimeToUtc(`${month > SEASON_LAST_MONTH ? year : year - 1}-06-01` as DateKey, 0);
}
