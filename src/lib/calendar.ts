import { computeDaySlots, type DayWindow, type SlotRules } from "./slots";
import {
  addDaysToDateKey,
  dateKeyToDbDate,
  utcToTorontoParts,
  type DateKey,
} from "./time";

/**
 * The shared week calendar: every coach's days and lessons, laid out on one
 * time axis so a week reads like a timetable.
 *
 * A coach day is cut into segments — lessons, bookable time, lunch, and time
 * that is open but can no longer be booked — using the same slot maths as the
 * booking page, so what the calendar calls bookable is exactly what a student
 * can pick there.
 */

/** Monday of the week a date falls in. Weeks run Monday to Sunday. */
export function weekStart(dateKey: DateKey): DateKey {
  // getUTCDay is 0 = Sunday; the week starts on Monday.
  const dow = dateKeyToDbDate(dateKey).getUTCDay();
  return addDaysToDateKey(dateKey, -((dow + 6) % 7));
}

/** The seven dates of the week starting on `monday`. */
export function weekDays(monday: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToDateKey(monday, i));
}

export type CalendarLesson = { startAt: Date; endAt: Date };

export type Segment<L extends CalendarLesson> =
  | { kind: "lesson"; startAt: Date; endAt: Date; lesson: L }
  /** Free hours. `bookable` when at least one lesson can start inside them. */
  | { kind: "open"; startAt: Date; endAt: Date; bookable: boolean }
  | { kind: "break"; startAt: Date; endAt: Date }
  /** Free, but past or inside the coach's lead time. */
  | { kind: "closed"; startAt: Date; endAt: Date };

type Gap<L extends CalendarLesson> = Exclude<Segment<L>, { kind: "lesson" }>;

export function daySegments<L extends CalendarLesson>(
  window: DayWindow,
  lessons: L[],
  now: Date,
  rules: SlotRules,
): Segment<L>[] {
  const slots = computeDaySlots(window, lessons, now, rules);
  const starts = new Set(slots.startOptions.map((o) => o.hour));

  const out: Segment<L>[] = lessons.map((lesson) => ({
    kind: "lesson",
    startAt: lesson.startAt,
    endAt: lesson.endAt,
    lesson,
  }));

  // Consecutive hours of the same kind merge into one segment; a booked hour
  // ends the run, because the lesson covering it is already in the list.
  let run: Gap<L> | null = null;
  for (const cell of slots.cells) {
    if (cell.status === "booked") {
      run = null;
      continue;
    }
    const kind =
      cell.status === "available"
        ? "open"
        : cell.status === "break"
          ? "break"
          : "closed";
    const bookable = starts.has(cell.hour);
    if (run && run.kind === kind && run.endAt.getTime() === cell.startAt.getTime()) {
      run.endAt = cell.endAt;
      if (run.kind === "open" && bookable) run.bookable = true;
      continue;
    }
    const next: Gap<L> =
      kind === "open"
        ? { kind, startAt: cell.startAt, endAt: cell.endAt, bookable }
        : { kind, startAt: cell.startAt, endAt: cell.endAt };
    out.push(next);
    run = next;
  }

  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/** Toronto wall-clock time as fractional hours, for placing blocks on the axis. */
export function torontoHours(instant: Date): number {
  const p = utcToTorontoParts(instant);
  return p.hour + p.minute / 60;
}

/** "09:10" — the same 24-hour form the booking page's hour tiles use. */
export function hhmm(instant: Date): string {
  const p = utcToTorontoParts(instant);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
