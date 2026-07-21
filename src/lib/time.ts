import { TZDate } from "@date-fns/tz";

/**
 * Everything the business cares about happens in Toronto wall-clock time, but
 * the database stores UTC instants. This module is the only place allowed to
 * convert between the two.
 *
 * The trap this exists to avoid: `new Date("2026-01-08T09:00:00")` is parsed in
 * the *server's* local zone, so the same code produces different instants on a
 * laptop and on a server. And the ski season crosses the March DST switch, so
 * "9am" is UTC-5 in January and UTC-4 in April.
 */
export const TZ = "America/Toronto";

/** A Toronto calendar date, "YYYY-MM-DD". Not an instant — a day on a wall calendar. */
export type DateKey = string;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string): value is DateKey {
  if (!DATE_KEY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reject 2026-02-30 and friends.
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

export function parseDateKey(value: string): DateKey {
  if (!isDateKey(value)) throw new Error(`Invalid date key: ${value}`);
  return value;
}

/** Toronto wall-clock time on a given calendar date -> the UTC instant it refers to. */
export function torontoWallTimeToUtc(
  dateKey: DateKey,
  hour: number,
  minute = 0,
): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const zoned = new TZDate(y, m - 1, d, hour, minute, 0, 0, TZ);
  return new Date(zoned.getTime());
}

export type TorontoParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  dateKey: DateKey;
};

/** A UTC instant -> the Toronto wall-clock parts an observer there would read. */
export function utcToTorontoParts(instant: Date): TorontoParts {
  const zoned = new TZDate(instant, TZ);
  const year = zoned.getFullYear();
  const month = zoned.getMonth() + 1;
  const day = zoned.getDate();
  return {
    year,
    month,
    day,
    hour: zoned.getHours(),
    minute: zoned.getMinutes(),
    dateKey: `${pad4(year)}-${pad2(month)}-${pad2(day)}`,
  };
}

/** The Toronto calendar date an instant falls on. */
export function toDateKey(instant: Date): DateKey {
  return utcToTorontoParts(instant).dateKey;
}

/**
 * A DateKey as stored in a Prisma `@db.Date` column.
 *
 * Date-only columns have no time zone. Prisma reads and writes them using the
 * UTC components of a JS Date, so a date-only value must be built at UTC
 * midnight — NOT via torontoWallTimeToUtc, which would land on the previous day.
 */
export function dateKeyToDbDate(dateKey: DateKey): Date {
  const [y, m, d] = parseDateKey(dateKey).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Inverse of dateKeyToDbDate. Reads UTC components, never local ones. */
export function dbDateToDateKey(value: Date): DateKey {
  return `${pad4(value.getUTCFullYear())}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

export function addDaysToDateKey(dateKey: DateKey, days: number): DateKey {
  const base = dateKeyToDbDate(dateKey);
  base.setUTCDate(base.getUTCDate() + days);
  return dbDateToDateKey(base);
}

/** Whole days between two calendar dates (b - a). */
export function daysBetweenDateKeys(a: DateKey, b: DateKey): number {
  const ms = dateKeyToDbDate(b).getTime() - dateKeyToDbDate(a).getTime();
  return Math.round(ms / 86_400_000);
}

// ── Formatting (always Toronto, never the viewer's zone) ──

export function formatTorontoTime(instant: Date, locale: "en" | "zh"): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-CA", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

export function formatTorontoDate(instant: Date, locale: "en" | "zh"): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(instant);
}

export function formatTorontoDateTime(
  instant: Date,
  locale: "en" | "zh",
): string {
  return `${formatTorontoDate(instant, locale)} ${formatTorontoTime(instant, locale)}`;
}

/** Compact stamp with an explicit zone, for waiver audit pages. */
export function formatAuditTimestamp(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(instant);
  return `${parts} (${instant.toISOString()})`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}
