import { describe, expect, it } from "vitest";
import { formatMoneyShort, lessonWindow, quote } from "./pricing";
import { torontoWallTimeToUtc } from "./time";

const RATE = 8000; // $80/h
const HANDOVER = 1500; // $15

describe("quote", () => {
  it("charges 2 hours as $160 less $15 = $145", () => {
    expect(
      quote({ hours: 2, hourlyRateCents: RATE, handoverDiscountCents: HANDOVER }),
    ).toMatchObject({
      subtotalCents: 16000,
      handoverDiscountCents: 1500,
      totalCents: 14500,
      lessonMinutes: 110,
    });
  });

  it("deducts the handover only once, however long the lesson", () => {
    const three = quote({
      hours: 3,
      hourlyRateCents: RATE,
      handoverDiscountCents: HANDOVER,
    });
    const four = quote({
      hours: 4,
      hourlyRateCents: RATE,
      handoverDiscountCents: HANDOVER,
    });
    expect(three.totalCents).toBe(22500); // 240 - 15
    expect(four.totalCents).toBe(30500); // 320 - 15
    expect(three.handoverDiscountCents).toBe(HANDOVER);
    expect(four.handoverDiscountCents).toBe(HANDOVER);
  });

  it("never returns a negative total when the discount exceeds the subtotal", () => {
    const q = quote({
      hours: 1,
      hourlyRateCents: 1000,
      handoverDiscountCents: 9999,
    });
    expect(q.totalCents).toBe(0);
    expect(q.handoverDiscountCents).toBe(1000);
  });

  it("rejects nonsense inputs rather than silently coercing", () => {
    expect(() =>
      quote({ hours: 0, hourlyRateCents: RATE, handoverDiscountCents: HANDOVER }),
    ).toThrow();
    expect(() =>
      quote({ hours: 2.5, hourlyRateCents: RATE, handoverDiscountCents: HANDOVER }),
    ).toThrow();
    expect(() =>
      quote({ hours: 2, hourlyRateCents: -1, handoverDiscountCents: HANDOVER }),
    ).toThrow();
  });

  it("charges a group at base + $30 per extra student per hour", () => {
    // 1-on-1 $80/h, 1-on-2 $110/h, 1-on-3 $140/h.
    const two = quote({
      hours: 2,
      hourlyRateCents: RATE,
      handoverDiscountCents: HANDOVER,
      headcount: 2,
      extraPersonCents: 3000,
    });
    expect(two.perHourCents).toBe(11000);
    expect(two.subtotalCents).toBe(22000); // 110 × 2
    expect(two.totalCents).toBe(20500); // less 15

    const three = quote({
      hours: 2,
      hourlyRateCents: RATE,
      handoverDiscountCents: HANDOVER,
      headcount: 3,
      extraPersonCents: 3000,
    });
    expect(three.perHourCents).toBe(14000);
    expect(three.subtotalCents).toBe(28000); // 140 × 2
    expect(three.totalCents).toBe(26500);
  });

  it("treats a single student as no surcharge", () => {
    const q = quote({
      hours: 2,
      hourlyRateCents: RATE,
      handoverDiscountCents: HANDOVER,
      headcount: 1,
      extraPersonCents: 3000,
    });
    expect(q.perHourCents).toBe(RATE);
    expect(q.totalCents).toBe(14500);
  });

  it("defaults to one student with no surcharge", () => {
    const q = quote({ hours: 2, hourlyRateCents: RATE, handoverDiscountCents: HANDOVER });
    expect(q.headcount).toBe(1);
    expect(q.perHourCents).toBe(RATE);
  });

  it("rejects a headcount below one", () => {
    expect(() =>
      quote({ hours: 2, hourlyRateCents: RATE, handoverDiscountCents: HANDOVER, headcount: 0 }),
    ).toThrow();
  });

  it("stays in integer cents for awkward rates", () => {
    const q = quote({
      hours: 3,
      hourlyRateCents: 8333,
      handoverDiscountCents: HANDOVER,
    });
    expect(Number.isInteger(q.totalCents)).toBe(true);
    expect(q.totalCents).toBe(8333 * 3 - 1500);
  });
});

describe("lessonWindow", () => {
  it("turns a 1:00-3:00 booking into a 1:05-2:55 lesson", () => {
    const startAt = torontoWallTimeToUtc("2026-01-08", 13);
    const endAt = torontoWallTimeToUtc("2026-01-08", 15);
    const { lessonStartAt, lessonEndAt } = lessonWindow(startAt, endAt);

    expect(lessonStartAt.toISOString()).toBe("2026-01-08T18:05:00.000Z");
    expect(lessonEndAt.toISOString()).toBe("2026-01-08T19:55:00.000Z");
    expect((lessonEndAt.getTime() - lessonStartAt.getTime()) / 60000).toBe(110);
  });

  it("still loses exactly 10 minutes on a longer booking", () => {
    const startAt = torontoWallTimeToUtc("2026-01-08", 9);
    const endAt = torontoWallTimeToUtc("2026-01-08", 13);
    const { lessonStartAt, lessonEndAt } = lessonWindow(startAt, endAt);
    expect((lessonEndAt.getTime() - lessonStartAt.getTime()) / 60000).toBe(230);
  });
});

describe("formatMoneyShort", () => {
  it("pads cents", () => {
    expect(formatMoneyShort(14500)).toBe("$145.00");
    expect(formatMoneyShort(8005)).toBe("$80.05");
    expect(formatMoneyShort(-1500)).toBe("-$15.00");
    expect(formatMoneyShort(0)).toBe("$0.00");
  });
});
