import { describe, expect, it } from "vitest";
import {
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

describe("parseSeasonStartYear", () => {
  it("rejects malformed or inconsistent labels", () => {
    expect(parseSeasonStartYear("2025-26")).toBe(2025);
    expect(() => parseSeasonStartYear("2025-27")).toThrow();
    expect(() => parseSeasonStartYear("2025")).toThrow();
  });
});
