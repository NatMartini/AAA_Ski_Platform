import { describe, expect, it } from "vitest";
import { amountDueCents, balanceCents, isFullyPaid, stageOf } from "./lesson";

/** 2h at $80 with the $15 handover credit; the deposit is one hour. */
const full = {
  paymentPlan: "FULL" as const,
  totalCents: 14500,
  depositCents: 14500,
  amountPaidCents: 0,
};

const deposit = {
  paymentPlan: "DEPOSIT" as const,
  totalCents: 14500,
  depositCents: 8000,
  amountPaidCents: 0,
};

describe("stageOf", () => {
  it("treats a pay-in-full booking as one payment", () => {
    expect(stageOf(full)).toBe("FULL");
    expect(stageOf({ ...full, amountPaidCents: 14500 })).toBe("FULL");
  });

  it("moves from deposit to balance once anything has been paid", () => {
    expect(stageOf(deposit)).toBe("DEPOSIT");
    expect(stageOf({ ...deposit, amountPaidCents: 8000 })).toBe("BALANCE");
  });
});

describe("amountDueCents", () => {
  it("asks for the whole total on a pay-in-full booking", () => {
    expect(amountDueCents(full)).toBe(14500);
  });

  it("asks for one hour up front, then the rest", () => {
    expect(amountDueCents(deposit)).toBe(8000);
    expect(amountDueCents({ ...deposit, amountPaidCents: 8000 })).toBe(6500);
  });

  it("never asks for more than the total, even if the deposit exceeds it", () => {
    // A one-hour lesson: an hour's fee is more than the discounted total.
    const oneHour = {
      paymentPlan: "DEPOSIT" as const,
      totalCents: 6500,
      depositCents: 8000,
      amountPaidCents: 0,
    };
    expect(amountDueCents(oneHour)).toBe(6500);
  });
});

describe("balanceCents", () => {
  it("is zero once the total is covered", () => {
    expect(balanceCents({ totalCents: 14500, amountPaidCents: 14500 })).toBe(0);
    expect(isFullyPaid({ totalCents: 14500, amountPaidCents: 14500 })).toBe(true);
  });

  it("never goes negative when someone over-pays", () => {
    expect(balanceCents({ totalCents: 14500, amountPaidCents: 15000 })).toBe(0);
  });

  it("reports what is left after a deposit", () => {
    expect(balanceCents({ totalCents: 14500, amountPaidCents: 8000 })).toBe(6500);
    expect(isFullyPaid({ totalCents: 14500, amountPaidCents: 8000 })).toBe(false);
  });
});
