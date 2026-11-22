import { describe, expect, it } from "vitest";
import { torontoWallTimeToUtc } from "./time";
import { clock, hourRange, placeInWeek, wallMinutes, weekDays, weekStartOf } from "./week-schedule";

const at = (dateKey: string, hour: number, minute = 0) => torontoWallTimeToUtc(dateKey, hour, minute);

describe("the coach's week", () => {
  it("starts on Monday, whatever day it is", () => {
    expect(weekStartOf("2026-11-21")).toBe("2026-11-16"); // a Saturday
    expect(weekStartOf("2026-11-16")).toBe("2026-11-16"); // the Monday itself
    expect(weekStartOf("2026-11-22")).toBe("2026-11-16"); // Sunday ends the week
    expect(weekDays("2026-12-28")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  });

  it("places lessons by Toronto wall-clock time, also across a clock change", () => {
    const placed = placeInWeek([
      { id: "sat", start: at("2026-11-21", 9), end: at("2026-11-21", 11, 30) },
      { id: "dst", start: at("2026-11-01", 13), end: at("2026-11-01", 15) },
      { id: "next-week", start: at("2026-11-23", 9), end: at("2026-11-23", 10) },
    ], "2026-11-16");
    expect(placed.map(({ id, day, from, to }) => ({ id, day, from, to }))).toEqual([{ id: "sat", day: 5, from: 540, to: 690 }]);
    // 1 November 2026 is the day Toronto leaves daylight time: the wall clock still reads 13:00 to 15:00.
    expect(placeInWeek([{ start: at("2026-11-01", 13), end: at("2026-11-01", 15) }], "2026-10-26")[0]).toMatchObject({ day: 6, from: 780, to: 900 });
    expect(clock(540)).toBe("9:00");
    expect(clock(690)).toBe("11:30");
    expect(wallMinutes(at("2026-11-21", 14, 5))).toBe(845);
  });

  it("sets overlapping lessons side by side and widens the hours to fit", () => {
    const placed = placeInWeek([
      { id: "a", start: at("2026-11-18", 9), end: at("2026-11-18", 11) },
      { id: "b", start: at("2026-11-18", 10), end: at("2026-11-18", 12) },
      { id: "c", start: at("2026-11-18", 11), end: at("2026-11-18", 13) },
      { id: "evening", start: at("2026-11-19", 18), end: at("2026-11-19", 20, 30) },
    ], "2026-11-16");
    expect(placed.filter((lesson) => lesson.day === 2).map(({ id, lane, lanes }) => ({ id, lane, lanes }))).toEqual([
      { id: "a", lane: 0, lanes: 2 }, { id: "b", lane: 1, lanes: 2 }, { id: "c", lane: 0, lanes: 2 }]);
    expect(hourRange(placed)).toEqual({ first: 8, last: 21 });
    expect(hourRange([])).toEqual({ first: 8, last: 17 });
  });
});
