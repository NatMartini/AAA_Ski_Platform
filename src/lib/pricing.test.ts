import { describe, expect, it } from "vitest";
import {
  formatMoneyShort,
  handoverCreditCents,
  lessonWindow,
  quote,
} from "./pricing";
import { torontoWallTimeToUtc } from "./time";

const RATE = 6000; // $60/h — Kevin, ski lesson, early bird

describe("quote", () => {
  it("charges 2 hours at $60 as $120 less ten minutes' fee, $10 = $110", () => {
    expect(quote({ hours: 2, hourlyRateCents: RATE })).toMatchObject({
      subtotalCents: 12000,
      handoverDiscountCents: 1000,
      totalCents: 11000,
      lessonMinutes: 110,
    });
  });

  it("rounds the ten minutes' fee up to a whole $5, never under $10", () => {
    expect(handoverCreditCents(5000)).toBe(1000); // $8.33 → $10
    expect(handoverCreditCents(6000)).toBe(1000); // exactly $10
    expect(handoverCreditCents(7000)).toBe(1500); // $11.67 → $15
    expect(handoverCreditCents(8000)).toBe(1500); // $13.33 → $15
    expect(handoverCreditCents(9000)).toBe(1500); // exactly $15
    expect(handoverCreditCents(10000)).toBe(2000); // $16.67 → $20
    expect(handoverCreditCents(3000)).toBe(1000); // $5 → the $10 floor
    expect(handoverCreditCents(0)).toBe(0);
    expect(quote({ hours: 2, hourlyRateCents: 7000 }).totalCents).toBe(12500);
    expect(quote({ hours: 2, hourlyRateCents: 5000 }).totalCents).toBe(9000);
  });

  it("never takes off more than the lesson costs", () => {
    expect(quote({ hours: 2, hourlyRateCents: 0 }).totalCents).toBe(0);
  });

  it("deducts the handover only once, however long the lesson", () => {
    const three = quote({ hours: 3, hourlyRateCents: RATE });
    const four = quote({ hours: 4, hourlyRateCents: RATE });
    expect(three.totalCents).toBe(17000); // 180 - 10
    expect(four.totalCents).toBe(23000); // 240 - 10
    expect(three.handoverDiscountCents).toBe(1000);
    expect(four.handoverDiscountCents).toBe(1000);
  });

  it("rejects nonsense inputs rather than silently coercing", () => {
    expect(() => quote({ hours: 0, hourlyRateCents: RATE })).toThrow();
    expect(() => quote({ hours: 2.5, hourlyRateCents: RATE })).toThrow();
    expect(() => quote({ hours: 2, hourlyRateCents: -1 })).toThrow();
  });

  it("charges a group at base + $20 per extra student per hour", () => {
    // 1-on-1 $60/h, 1-on-2 $80/h, 1-on-3 $100/h; ten minutes at that rate off.
    const two = quote({
      hours: 2,
      hourlyRateCents: RATE,
      headcount: 2,
      extraPersonCents: 2000,
    });
    expect(two.perHourCents).toBe(8000);
    expect(two.subtotalCents).toBe(16000); // 80 × 2
    expect(two.totalCents).toBe(16000 - 1500); // $13.33 → $15

    const three = quote({
      hours: 2,
      hourlyRateCents: RATE,
      headcount: 3,
      extraPersonCents: 2000,
    });
    expect(three.perHourCents).toBe(10000);
    expect(three.subtotalCents).toBe(20000); // 100 × 2
    expect(three.totalCents).toBe(20000 - 2000); // $16.67 → $20
  });

  it("treats a single student as no surcharge", () => {
    const q = quote({ hours: 2, hourlyRateCents: RATE, headcount: 1, extraPersonCents: 2000 });
    expect(q.perHourCents).toBe(RATE);
    expect(q.totalCents).toBe(11000);
  });

  it("defaults to one student with no surcharge", () => {
    const q = quote({ hours: 2, hourlyRateCents: RATE });
    expect(q.headcount).toBe(1);
    expect(q.perHourCents).toBe(RATE);
  });

  it("rejects a headcount below one", () => {
    expect(() => quote({ hours: 2, hourlyRateCents: RATE, headcount: 0 })).toThrow();
  });

  it("stays in integer cents for awkward rates", () => {
    const q = quote({ hours: 3, hourlyRateCents: 8333 });
    expect(Number.isInteger(q.totalCents)).toBe(true);
    expect(q.totalCents).toBe(8333 * 3 - 1500); // $13.89 → $15
  });
});

describe("lessonWindow", () => {
  it("turns a 1:00-3:00 booking into a 1:10-3:00 lesson", () => {
    const startAt = torontoWallTimeToUtc("2026-01-08", 13);
    const endAt = torontoWallTimeToUtc("2026-01-08", 15);
    const { lessonStartAt, lessonEndAt } = lessonWindow(startAt, endAt);

    expect(lessonStartAt.toISOString()).toBe("2026-01-08T18:10:00.000Z");
    expect(lessonEndAt.toISOString()).toBe("2026-01-08T20:00:00.000Z");
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

  it("groups thousands", () => {
    expect(formatMoneyShort(130500)).toBe("$1,305.00");
    expect(formatMoneyShort(123456789)).toBe("$1,234,567.89");
    expect(formatMoneyShort(-100000)).toBe("-$1,000.00");
  });
});
