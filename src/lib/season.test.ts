import { describe, expect, it } from "vitest";
import {
  bookingHorizon,
  isWithinSeason,
  parseSeasonStartYear,
  seasonOf,
  seasonOfDateKey,
  seasonRange,
} from "./season";
import { torontoWallTimeToUtc } from "./time";

describe("seasonOfDateKey", () => {
  it("opens on December 1", () => {
    expect(seasonOfDateKey("2025-11-30")).toBeNull();
    expect(seasonOfDateKey("2025-12-01")).toBe("2025-26");
    expect(seasonOfDateKey("2025-12-31")).toBe("2025-26");
  });

  it("carries January through April into the season that opened in December", () => {
    expect(seasonOfDateKey("2026-01-08")).toBe("2025-26");
    expect(seasonOfDateKey("2026-04-30")).toBe("2025-26");
  });

  it("closes after May 1", () => {
    expect(seasonOfDateKey("2026-05-01")).toBe("2025-26");
    expect(seasonOfDateKey("2026-05-02")).toBeNull();
    expect(seasonOfDateKey("2026-08-15")).toBeNull();
  });

  it("starts a new season the following December", () => {
    expect(seasonOfDateKey("2026-12-01")).toBe("2026-27");
    expect(seasonOfDateKey("2027-02-01")).toBe("2026-27");
  });

  it("handles the century-adjacent naming", () => {
    expect(seasonOfDateKey("2099-12-15")).toBe("2099-00");
    expect(seasonOfDateKey("2100-01-15")).toBe("2099-00");
  });
});

describe("seasonOf (instant)", () => {
  it("uses the Toronto date, not the UTC date", () => {
    // 03:00Z on Dec 1 is still Nov 30 in Toronto -> off-season.
    expect(seasonOf(new Date("2025-12-01T03:00:00Z"))).toBeNull();
    expect(seasonOf(torontoWallTimeToUtc("2025-12-01", 9))).toBe("2025-26");
  });

  it("puts a lesson in the season of its lesson date", () => {
    expect(seasonOf(torontoWallTimeToUtc("2026-01-08", 13))).toBe("2025-26");
  });
});

describe("isWithinSeason", () => {
  it("gates availability and bookings to the ski window", () => {
    expect(isWithinSeason("2026-01-08")).toBe(true);
    expect(isWithinSeason("2026-07-21")).toBe(false);
  });
});

describe("seasonRange", () => {
  it("returns the inclusive bookable window", () => {
    expect(seasonRange("2025-26")).toEqual({
      start: "2025-12-01",
      end: "2026-05-01",
    });
  });

  it("round-trips every date in its own range", () => {
    const { start, end } = seasonRange("2025-26");
    expect(seasonOfDateKey(start)).toBe("2025-26");
    expect(seasonOfDateKey(end)).toBe("2025-26");
  });
});

describe("bookingHorizon", () => {
  it("covers the rest of the season when we are in it", () => {
    expect(bookingHorizon("2026-01-08")).toEqual({
      from: "2026-01-08",
      to: "2026-05-01",
      season: "2025-26",
      upcoming: false,
    });
  });

  it("offers the whole of the next season during the summer", () => {
    // The bug this exists to prevent: a flat 120-day lookahead from July ends
    // in November, so the calendar was empty with nothing to explain why.
    expect(bookingHorizon("2026-07-21")).toEqual({
      from: "2026-12-01",
      to: "2027-05-01",
      season: "2026-27",
      upcoming: true,
    });
  });

  it("lets a coach in October open December dates", () => {
    expect(bookingHorizon("2026-10-15")).toMatchObject({
      from: "2026-12-01",
      season: "2026-27",
      upcoming: true,
    });
  });

  it("rolls to the next season the day after one closes", () => {
    expect(bookingHorizon("2026-05-01")).toMatchObject({
      season: "2025-26",
      upcoming: false,
    });
    expect(bookingHorizon("2026-05-02")).toMatchObject({
      from: "2026-12-01",
      season: "2026-27",
      upcoming: true,
    });
  });

  it("treats the last day of November as looking forward one day", () => {
    expect(bookingHorizon("2026-11-30")).toMatchObject({
      from: "2026-12-01",
      upcoming: true,
    });
    expect(bookingHorizon("2026-12-01")).toMatchObject({
      from: "2026-12-01",
      upcoming: false,
    });
  });

  it("always returns a range whose ends belong to the reported season", () => {
    for (const day of ["2026-01-08", "2026-07-21", "2026-10-15", "2026-12-20"]) {
      const h = bookingHorizon(day);
      expect(seasonOfDateKey(h.from)).toBe(h.season);
      expect(seasonOfDateKey(h.to)).toBe(h.season);
    }
  });
});

describe("parseSeasonStartYear", () => {
  it("rejects malformed or inconsistent labels", () => {
    expect(parseSeasonStartYear("2025-26")).toBe(2025);
    expect(() => parseSeasonStartYear("2025-27")).toThrow();
    expect(() => parseSeasonStartYear("2025")).toThrow();
  });
});
