import { describe, expect, it } from "vitest";
import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  dateKeyToDbDate,
  dbDateToDateKey,
  formatTorontoTime,
  isDateKey,
  toDateKey,
  torontoWallTimeToUtc,
  utcToTorontoParts,
} from "./time";

describe("torontoWallTimeToUtc", () => {
  it("uses EST (UTC-5) in the middle of the season", () => {
    expect(torontoWallTimeToUtc("2026-01-08", 9).toISOString()).toBe(
      "2026-01-08T14:00:00.000Z",
    );
  });

  it("uses EDT (UTC-4) after the March switch", () => {
    expect(torontoWallTimeToUtc("2026-04-10", 9).toISOString()).toBe(
      "2026-04-10T13:00:00.000Z",
    );
  });

  it("handles the spring-forward day itself", () => {
    // 2026-03-08 is the second Sunday of March: clocks jump 02:00 -> 03:00, so
    // this day is 23 hours long and 9am is already EDT.
    expect(torontoWallTimeToUtc("2026-03-08", 9).toISOString()).toBe(
      "2026-03-08T13:00:00.000Z",
    );
    // The hour before the jump is still EST.
    expect(torontoWallTimeToUtc("2026-03-08", 1).toISOString()).toBe(
      "2026-03-08T06:00:00.000Z",
    );
  });

  it("keeps hour+1 one wall-clock hour later even across the jump", () => {
    const h1 = torontoWallTimeToUtc("2026-03-08", 1);
    const h3 = torontoWallTimeToUtc("2026-03-08", 3);
    // 01:00 EST -> 03:00 EDT is only one real hour apart.
    expect(h3.getTime() - h1.getTime()).toBe(3_600_000);
  });

  it("accepts minutes", () => {
    expect(torontoWallTimeToUtc("2026-01-08", 13, 5).toISOString()).toBe(
      "2026-01-08T18:05:00.000Z",
    );
  });
});

describe("utcToTorontoParts / toDateKey", () => {
  it("round-trips a wall-clock hour", () => {
    const utc = torontoWallTimeToUtc("2026-01-08", 9);
    const parts = utcToTorontoParts(utc);
    expect(parts).toMatchObject({
      year: 2026,
      month: 1,
      day: 8,
      hour: 9,
      minute: 0,
      dateKey: "2026-01-08",
    });
  });

  it("reports the Toronto date, not the UTC date", () => {
    // 03:00Z on Jan 9 is still 22:00 on Jan 8 in Toronto.
    expect(toDateKey(new Date("2026-01-09T03:00:00Z"))).toBe("2026-01-08");
  });
});

describe("db date helpers", () => {
  it("round-trips through UTC midnight", () => {
    const stored = dateKeyToDbDate("2026-01-08");
    expect(stored.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(dbDateToDateKey(stored)).toBe("2026-01-08");
  });

  it("does not shift the day (the bug torontoWallTimeToUtc would cause here)", () => {
    // Using the Toronto converter for a date-only column would store
    // 2026-01-08T05:00:00Z, which still reads back as the 8th — but for a
    // timezone east of UTC it would land on the previous day. Assert the
    // date-only path stays at exactly UTC midnight.
    expect(dateKeyToDbDate("2026-01-08").getUTCHours()).toBe(0);
  });
});

describe("date key arithmetic", () => {
  it("adds days across a month boundary", () => {
    expect(addDaysToDateKey("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToDateKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts days between keys", () => {
    expect(daysBetweenDateKeys("2026-01-08", "2026-01-11")).toBe(3);
    expect(daysBetweenDateKeys("2026-01-11", "2026-01-08")).toBe(-3);
  });

  it("spans the DST switch without drifting", () => {
    // A naive ms/86400000 over local dates would give 0.958 days here.
    expect(daysBetweenDateKeys("2026-03-07", "2026-03-09")).toBe(2);
  });
});

describe("isDateKey", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isDateKey("2026-01-08")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("2026-1-8")).toBe(false);
    expect(isDateKey("nope")).toBe(false);
  });
});

describe("formatTorontoTime", () => {
  it("formats in Toronto regardless of the server's zone", () => {
    const lessonStart = torontoWallTimeToUtc("2026-01-08", 13, 5);
    // Non-breaking spaces vary by ICU version, so compare loosely.
    expect(formatTorontoTime(lessonStart, "en").replace(/\s/g, " ")).toBe(
      "1:05 p.m.",
    );
  });
});
