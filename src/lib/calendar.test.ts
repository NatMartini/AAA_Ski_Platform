import { describe, expect, it } from "vitest";
import { daySegments, hhmm, weekDays, weekStart } from "./calendar";
import type { DayWindow, SlotRules } from "./slots";
import { torontoWallTimeToUtc } from "./time";

const DAY = "2026-01-08"; // a Thursday
const WINDOW: DayWindow = {
  dateKey: DAY,
  startHour: 9,
  endHour: 16,
  breakStartHour: 13,
  breakEndHour: 14,
};
const RULES: SlotRules = { minHours: 2, maxHours: 8, leadTimeHours: 24 };
const EARLY = new Date("2026-01-01T12:00:00Z");

function lesson(id: string, from: number, to: number) {
  return {
    id,
    startAt: torontoWallTimeToUtc(DAY, from),
    endAt: torontoWallTimeToUtc(DAY, to),
  };
}

/** "lesson 9-11" style summary, in Toronto hours. */
function summary(segments: ReturnType<typeof daySegments>) {
  return segments.map((s) => {
    const span = `${hhmm(s.startAt)}-${hhmm(s.endAt)}`;
    if (s.kind === "open") return `${s.bookable ? "open" : "gap"} ${span}`;
    return `${s.kind} ${span}`;
  });
}

describe("weekStart", () => {
  it("goes back to Monday", () => {
    expect(weekStart("2026-01-08")).toBe("2026-01-05");
    expect(weekStart("2026-01-05")).toBe("2026-01-05");
    // Sunday belongs to the week that started the Monday before.
    expect(weekStart("2026-01-11")).toBe("2026-01-05");
  });

  it("crosses month and year ends", () => {
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
    expect(weekDays("2026-12-28")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });
});

describe("daySegments", () => {
  it("cuts an empty day into bookable time and lunch", () => {
    expect(summary(daySegments(WINDOW, [], EARLY, RULES))).toEqual([
      "open 09:00-13:00",
      "break 13:00-14:00",
      "open 14:00-16:00",
    ]);
  });

  it("puts each lesson in its own segment, even back to back", () => {
    const segments = daySegments(
      WINDOW,
      [lesson("b", 11, 13), lesson("a", 9, 11)],
      EARLY,
      RULES,
    );
    expect(summary(segments)).toEqual([
      "lesson 09:00-11:00",
      "lesson 11:00-13:00",
      "break 13:00-14:00",
      "open 14:00-16:00",
    ]);
    expect(segments.flatMap((s) => (s.kind === "lesson" ? [s.lesson.id] : []))).toEqual([
      "a",
      "b",
    ]);
  });

  it("marks a free hour too short for a lesson as not bookable", () => {
    // 9-11 and 12-13 booked: 11-12 is free but a 2h lesson cannot fit.
    const segments = daySegments(
      WINDOW,
      [lesson("a", 9, 11), lesson("b", 12, 13)],
      EARLY,
      RULES,
    );
    expect(summary(segments)).toEqual([
      "lesson 09:00-11:00",
      "gap 11:00-12:00",
      "lesson 12:00-13:00",
      "break 13:00-14:00",
      "open 14:00-16:00",
    ]);
  });

  it("closes hours that are past or inside the lead time", () => {
    // 10:30 the same morning: 9 and 10 have started, the rest are too soon.
    const now = torontoWallTimeToUtc(DAY, 10, 30);
    expect(summary(daySegments(WINDOW, [], now, RULES))).toEqual([
      "closed 09:00-13:00",
      "break 13:00-14:00",
      "closed 14:00-16:00",
    ]);
  });
});
