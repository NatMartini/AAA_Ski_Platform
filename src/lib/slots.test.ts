import { describe, expect, it } from "vitest";
import {
  computeDaySlots,
  isBookable,
  type BookedRange,
  type DayWindow,
  type SlotRules,
} from "./slots";
import { torontoWallTimeToUtc } from "./time";

const DAY = "2026-01-08";

// 9am-4pm at the resort, lunch 1-2pm — the example from the requirements.
const WINDOW: DayWindow = {
  dateKey: DAY,
  startHour: 9,
  endHour: 16,
  breakStartHour: 13,
  breakEndHour: 14,
};

const RULES: SlotRules = { minHours: 2, maxHours: 8, leadTimeHours: 24 };

/** Well before the day, so nothing is filtered by lead time. */
const EARLY = new Date("2026-01-01T12:00:00Z");

function slots(booked: BookedRange[] = [], now = EARLY, rules = RULES) {
  return computeDaySlots(WINDOW, booked, now, rules);
}

function booking(startHour: number, endHour: number): BookedRange {
  return {
    startAt: torontoWallTimeToUtc(DAY, startHour),
    endAt: torontoWallTimeToUtc(DAY, endHour),
  };
}

/** Compact view: "9:2,3,4" means 9am can be booked for 2, 3 or 4 hours. */
function optionSummary(s: ReturnType<typeof slots>): string[] {
  return s.startOptions.map((o) => `${o.hour}:${o.durations.join(",")}`);
}

describe("hour grid", () => {
  it("covers the window and marks lunch", () => {
    const s = slots();
    expect(s.cells.map((c) => c.hour)).toEqual([9, 10, 11, 12, 13, 14, 15]);
    expect(s.cells.find((c) => c.hour === 13)!.status).toBe("break");
    expect(s.cells.find((c) => c.hour === 12)!.status).toBe("available");
  });

  it("marks hours covered by an existing booking", () => {
    const s = slots([booking(10, 12)]);
    expect(s.cells.find((c) => c.hour === 10)!.status).toBe("booked");
    expect(s.cells.find((c) => c.hour === 11)!.status).toBe("booked");
    expect(s.cells.find((c) => c.hour === 12)!.status).toBe("available");
    expect(s.cells.find((c) => c.hour === 9)!.status).toBe("available");
  });

  it("shows booked in preference to break when both apply", () => {
    const s = slots([booking(13, 14)]);
    expect(s.cells.find((c) => c.hour === 13)!.status).toBe("booked");
  });

  it("omits the break when the coach turns lunch off", () => {
    const s = computeDaySlots(
      { ...WINDOW, breakStartHour: null, breakEndHour: null },
      [],
      EARLY,
      RULES,
    );
    expect(s.cells.every((c) => c.status === "available")).toBe(true);
  });
});

describe("start options with lunch at 1-2pm", () => {
  it("produces exactly the legal combinations from the requirements", () => {
    // 9-11, 9-12, 9-13, 10-12, 10-13, 11-13, 14-16
    expect(optionSummary(slots())).toEqual([
      "9:2,3,4",
      "10:2,3",
      "11:2",
      "14:2",
    ]);
  });

  it("will not start a lesson at noon, because 12-2 would run through lunch", () => {
    const s = slots();
    expect(s.startOptions.find((o) => o.hour === 12)).toBeUndefined();
    expect(isBookable(s, 12, 2)).toBe(false);
  });

  it("caps duration at the end of the window", () => {
    const s = slots();
    expect(isBookable(s, 14, 2)).toBe(true);
    expect(isBookable(s, 14, 3)).toBe(false); // would run past 16:00
  });
});

describe("interaction with existing bookings", () => {
  it("stops a run at the booked hour", () => {
    // 11-13 taken -> mornings can only be 9-11.
    const s = slots([booking(11, 13)]);
    expect(optionSummary(s)).toEqual(["9:2", "14:2"]);
  });

  it("frees the run again once the booking ends", () => {
    const s = slots([booking(9, 11)]);
    expect(optionSummary(s)).toEqual(["11:2", "14:2"]);
  });

  it("leaves no options when the whole day is taken", () => {
    const s = slots([booking(9, 13), booking(14, 16)]);
    expect(s.startOptions).toEqual([]);
  });

  it("treats touching bookings as non-overlapping", () => {
    // A 9-11 booking must not mark the 11:00 cell as booked.
    const s = slots([booking(9, 11)]);
    expect(s.cells.find((c) => c.hour === 11)!.status).toBe("available");
  });
});

describe("min and max hours", () => {
  it("honours a 3-hour minimum", () => {
    const s = slots([], EARLY, { ...RULES, minHours: 3 });
    // 11:00 only has 2 free hours before lunch, so it drops out entirely.
    expect(optionSummary(s)).toEqual(["9:3,4", "10:3"]);
  });

  it("honours a max shorter than the free run", () => {
    const s = slots([], EARLY, { ...RULES, maxHours: 2 });
    expect(optionSummary(s)).toEqual(["9:2", "10:2", "11:2", "14:2"]);
  });
});

describe("lead time", () => {
  it("blocks hours inside the lead window but keeps later ones", () => {
    // Now is 2026-01-08 06:00 Toronto with a 4h lead, so the cutoff is 10:00.
    // 9:00 is too soon; 10:00 is exactly 4 hours out and therefore allowed.
    const now = torontoWallTimeToUtc(DAY, 6);
    const s = slots([], now, { ...RULES, leadTimeHours: 4 });

    expect(s.cells.find((c) => c.hour === 9)!.status).toBe("lead-time");
    expect(s.cells.find((c) => c.hour === 10)!.status).toBe("available");
    expect(optionSummary(s)).toEqual(["10:2,3", "11:2", "14:2"]);
  });

  it("marks already-started hours as past", () => {
    const now = torontoWallTimeToUtc(DAY, 11, 30);
    const s = slots([], now, { ...RULES, leadTimeHours: 0 });
    expect(s.cells.find((c) => c.hour === 9)!.status).toBe("past");
    expect(s.cells.find((c) => c.hour === 11)!.status).toBe("past");
    expect(s.cells.find((c) => c.hour === 12)!.status).toBe("available");
  });

  it("removes the whole day once it is over", () => {
    const s = slots([], new Date("2026-01-09T12:00:00Z"), RULES);
    expect(s.startOptions).toEqual([]);
  });
});

describe("daylight saving", () => {
  it("keeps the grid aligned to the wall clock on the spring-forward day", () => {
    // 2026-03-08 jumps 02:00 -> 03:00. The 9-16 window is entirely after the
    // jump, so it must still be 7 cells of exactly one hour each.
    const dst: DayWindow = { ...WINDOW, dateKey: "2026-03-08" };
    const s = computeDaySlots(dst, [], new Date("2026-03-01T12:00:00Z"), RULES);

    expect(s.cells).toHaveLength(7);
    for (const cell of s.cells) {
      expect(cell.endAt.getTime() - cell.startAt.getTime()).toBe(3_600_000);
    }
    // 9am EDT is 13:00Z, not the 14:00Z it would be in January.
    expect(s.cells[0].startAt.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    expect(optionSummary(s)).toEqual(["9:2,3,4", "10:2,3", "11:2", "14:2"]);
  });
});
