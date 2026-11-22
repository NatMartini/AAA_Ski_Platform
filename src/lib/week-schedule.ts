import { addDaysToDateKey, utcToTorontoParts, type DateKey } from "./time";

/** The Monday that starts the Toronto week holding `dateKey`. */
export function weekStartOf(dateKey: DateKey): DateKey {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysToDateKey(dateKey, -((weekday + 6) % 7));
}

export const weekDays = (start: DateKey): DateKey[] => Array.from({ length: 7 }, (_, i) => addDaysToDateKey(start, i));

/** "9:00" for minutes after midnight on the wall clock. */
export const clock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** Minutes after midnight on Toronto's wall clock. */
export function wallMinutes(instant: Date): number {
  const parts = utcToTorontoParts(instant);
  return parts.hour * 60 + parts.minute;
}

export type Placed<T> = T & {
  /** 0 for Monday. */
  day: number;
  /** Wall-clock minutes the lesson starts and ends on its day. */
  from: number;
  to: number;
  /** Side by side when lessons overlap: this lesson's column and how many the day needs. */
  lane: number;
  lanes: number;
};

/** Puts each lesson on its day of the week by Toronto wall-clock time; lessons outside the week are left out. */
export function placeInWeek<T extends { start: Date; end: Date }>(lessons: readonly T[], start: DateKey): Placed<T>[] {
  const days = weekDays(start);
  const placed = lessons.flatMap((lesson) => {
    const begins = utcToTorontoParts(lesson.start), ends = utcToTorontoParts(lesson.end);
    const day = days.indexOf(begins.dateKey);
    if (day < 0) return [];
    const from = begins.hour * 60 + begins.minute;
    // A lesson running past midnight is drawn to the end of its first day.
    const to = ends.dateKey === begins.dateKey ? ends.hour * 60 + ends.minute : 24 * 60;
    return [{ ...lesson, day, from, to: Math.max(to, from + 15), lane: 0, lanes: 1 }];
  }).sort((a, b) => a.day - b.day || a.from - b.from);
  for (let day = 0; day < 7; day++) {
    const today = placed.filter((lesson) => lesson.day === day);
    const ends: number[] = [];
    for (const lesson of today) {
      const free = ends.findIndex((end) => end <= lesson.from);
      lesson.lane = free < 0 ? ends.length : free;
      ends[lesson.lane] = lesson.to;
    }
    for (const lesson of today) lesson.lanes = Math.max(1, ends.length);
  }
  return placed;
}

/** The hours the grid shows: a ski day, 8:00 to 17:00, widened to take in every lesson. */
export function hourRange(placed: readonly { from: number; to: number }[]): { first: number; last: number } {
  return {
    first: Math.min(8, ...placed.map((lesson) => Math.floor(lesson.from / 60))),
    last: Math.max(17, ...placed.map((lesson) => Math.ceil(lesson.to / 60))),
  };
}
