import { type DateKey, torontoWallTimeToUtc } from "./time";

/**
 * Turns a coach's availability window for one day into the hour grid the
 * booking page renders, plus the list of legal (start, duration) pairs.
 *
 * Worked example — window 9-16, lunch 13-14, 2h minimum:
 *   legal bookings are 9-11, 9-12, 9-13, 10-12, 10-13, 11-13, 14-16.
 *   12:00 cannot start anything, because 12-14 would run through lunch. That is
 *   correct behaviour, not a bug — the page offers a "message me on WeChat"
 *   escape hatch for anyone who wants an off-grid time.
 */

export type HourStatus =
  | "available"
  | "break"
  | "booked"
  | "past"
  | "lead-time";

export type HourCell = {
  /** Toronto wall-clock hour, 0-23. */
  hour: number;
  startAt: Date;
  endAt: Date;
  status: HourStatus;
};

export type StartOption = {
  hour: number;
  startAt: Date;
  /** Bookable durations in hours, ascending. Never empty. */
  durations: number[];
};

export type DaySlots = {
  dateKey: DateKey;
  cells: HourCell[];
  startOptions: StartOption[];
};

export type DayWindow = {
  dateKey: DateKey;
  startHour: number;
  endHour: number;
  breakStartHour: number | null;
  breakEndHour: number | null;
};

export type BookedRange = {
  startAt: Date;
  endAt: Date;
};

export type SlotRules = {
  minHours: number;
  maxHours: number;
  leadTimeHours: number;
};

export function computeDaySlots(
  window: DayWindow,
  booked: BookedRange[],
  now: Date,
  rules: SlotRules,
): DaySlots {
  const { dateKey, startHour, endHour } = window;
  const leadCutoff = new Date(now.getTime() + rules.leadTimeHours * 3_600_000);

  const cells: HourCell[] = [];
  for (let hour = startHour; hour < endHour; hour++) {
    const startAt = torontoWallTimeToUtc(dateKey, hour);
    // Derive the end from hour+1 rather than adding 3600s, so the hour after a
    // DST jump still lines up with the wall clock.
    const endAt = torontoWallTimeToUtc(dateKey, hour + 1);
    cells.push({
      hour,
      startAt,
      endAt,
      status: classify(startAt, endAt, hour, window, booked, now, leadCutoff),
    });
  }

  return { dateKey, cells, startOptions: buildStartOptions(cells, rules) };
}

function classify(
  startAt: Date,
  endAt: Date,
  hour: number,
  window: DayWindow,
  booked: BookedRange[],
  now: Date,
  leadCutoff: Date,
): HourStatus {
  // Precedence matters: a booked hour reads as "booked" even if it is also
  // during lunch or in the past.
  if (booked.some((b) => overlaps(startAt, endAt, b.startAt, b.endAt))) {
    return "booked";
  }
  if (isBreakHour(hour, window)) return "break";
  if (startAt.getTime() <= now.getTime()) return "past";
  if (startAt.getTime() < leadCutoff.getTime()) return "lead-time";
  return "available";
}

function isBreakHour(hour: number, window: DayWindow): boolean {
  const { breakStartHour, breakEndHour } = window;
  if (breakStartHour == null || breakEndHour == null) return false;
  return hour >= breakStartHour && hour < breakEndHour;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * A lesson may only start on an available hour, and may then run through
 * consecutive hours that are neither booked nor lunch.
 *
 * Later hours can never be "past" or "lead-time" once an earlier one is
 * available (time only moves forward), so the run only has to skip hard
 * blockers.
 */
function buildStartOptions(cells: HourCell[], rules: SlotRules): StartOption[] {
  const options: StartOption[] = [];

  for (let i = 0; i < cells.length; i++) {
    if (cells[i].status !== "available") continue;

    let run = 0;
    while (
      i + run < cells.length &&
      cells[i + run].status !== "booked" &&
      cells[i + run].status !== "break"
    ) {
      run++;
    }

    const max = Math.min(run, rules.maxHours);
    const durations: number[] = [];
    for (let d = rules.minHours; d <= max; d++) durations.push(d);

    if (durations.length > 0) {
      options.push({
        hour: cells[i].hour,
        startAt: cells[i].startAt,
        durations,
      });
    }
  }

  return options;
}

/** Whether a specific (start hour, duration) pair is bookable on this day. */
export function isBookable(
  slots: DaySlots,
  startHour: number,
  hours: number,
): boolean {
  const option = slots.startOptions.find((o) => o.hour === startHour);
  return option?.durations.includes(hours) ?? false;
}

export function hourStatusLabel(
  status: HourStatus,
  locale: "en" | "zh",
): string {
  const labels: Record<HourStatus, { en: string; zh: string }> = {
    available: { en: "Available", zh: "可预定" },
    break: { en: "Lunch break", zh: "午休" },
    booked: { en: "Booked", zh: "已约满" },
    past: { en: "Past", zh: "已过时" },
    "lead-time": { en: "Too soon", zh: "不足提前时间" },
  };
  return labels[status][locale];
}
