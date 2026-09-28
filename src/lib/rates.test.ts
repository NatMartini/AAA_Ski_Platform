import { describe, expect, it } from "vitest";
import {
  earlyBirdLastDay,
  earlyBirdWindow,
  isEarlyBird,
  offeredRates,
  rateFor,
  type RateRow,
} from "./rates";
import { LESSON_TYPES, isLessonTypeKey, lessonTypeLabel } from "./lesson-types";

// The published price sheet, in cents.
const KEVIN: RateRow[] = [
  { lessonType: "park", regularCents: 9000, earlyBirdCents: 8000 },
  { lessonType: "riding", regularCents: 7000, earlyBirdCents: 6000 },
  { lessonType: "csia1_prep", regularCents: 8000, earlyBirdCents: 7000 },
];
const ALISA: RateRow[] = [
  { lessonType: "riding", regularCents: 6000, earlyBirdCents: 5000 },
  { lessonType: "csia1_prep", regularCents: 7000, earlyBirdCents: 6000 },
];

describe("early bird", () => {
  it("ends on 1 December, the season's opening day", () => {
    expect(earlyBirdLastDay("2026-27")).toBe("2026-12-01");
  });

  it("is decided by when the booking is made, for any lesson that season", () => {
    expect(isEarlyBird("2026-11-20", "2027-02-10")).toBe(true);
    expect(isEarlyBird("2026-12-01", "2026-12-01")).toBe(true);
    expect(isEarlyBird("2026-12-02", "2026-12-05")).toBe(false);
    expect(isEarlyBird("2027-01-05", "2027-03-01")).toBe(false);
  });

  it("never applies to a date outside the season", () => {
    expect(isEarlyBird("2026-10-01", "2026-11-15")).toBe(false);
  });

  it("looks ahead to the coming season in the autumn", () => {
    expect(earlyBirdWindow("2026-09-28")).toEqual({
      season: "2026-27",
      lastDay: "2026-12-01",
      active: true,
    });
    expect(earlyBirdWindow("2026-12-01").active).toBe(true);
    expect(earlyBirdWindow("2026-12-02").active).toBe(false);
  });

  it("opens again for next season once this one is over", () => {
    expect(earlyBirdWindow("2027-06-01")).toMatchObject({
      season: "2027-28",
      active: true,
    });
  });
});

describe("rateFor", () => {
  it("reads the price sheet", () => {
    expect(rateFor(KEVIN, "riding", true)).toEqual({
      hourlyRateCents: 6000,
      earlyBird: true,
    });
    expect(rateFor(KEVIN, "park", false)).toEqual({
      hourlyRateCents: 9000,
      earlyBird: false,
    });
    expect(rateFor(ALISA, "csia1_prep", true)?.hourlyRateCents).toBe(6000);
  });

  it("returns null for a lesson type the coach does not teach", () => {
    expect(rateFor(ALISA, "park", true)).toBeNull();
  });

  it("falls back to the regular rate, and says so, without an early-bird price", () => {
    const rates: RateRow[] = [
      { lessonType: "riding", regularCents: 7000, earlyBirdCents: null },
    ];
    expect(rateFor(rates, "riding", true)).toEqual({
      hourlyRateCents: 7000,
      earlyBird: false,
    });
  });

  it("treats a zero regular rate as not offered", () => {
    expect(
      rateFor(
        [{ lessonType: "park", regularCents: 0, earlyBirdCents: null }],
        "park",
        false,
      ),
    ).toBeNull();
  });
});

describe("offeredRates", () => {
  it("sorts into price-sheet order", () => {
    expect(offeredRates(KEVIN).map((r) => r.lessonType)).toEqual([
      "riding",
      "csia1_prep",
      "park",
    ]);
  });
});

describe("lesson type catalogue", () => {
  it("labels every type in both languages", () => {
    for (const type of LESSON_TYPES) {
      expect(type.zh.trim()).not.toBe("");
      expect(type.en.trim()).not.toBe("");
    }
  });

  it("keeps unknown keys visible", () => {
    expect(isLessonTypeKey("riding")).toBe(true);
    expect(isLessonTypeKey("heli")).toBe(false);
    expect(lessonTypeLabel("heli", "en")).toBe("heli");
  });
});
