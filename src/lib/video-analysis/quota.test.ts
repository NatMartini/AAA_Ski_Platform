import { describe, expect, it } from "vitest";
import { analysisParty, analysisQuota, includedAnalysisCredits } from "./quota";

describe("whole-lesson included analyses", () => {
  it.each([[2, 3], [3, 5]])("includes %i-hour lesson credits without hourly multiplication", (hours, expected) => {
    expect(includedAnalysisCredits(hours)).toBe(expected);
  });

  it.each([[1, 3], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [12, 5]])("uses a bounded duration tier for other valid lesson length %i", (hours, expected) => {
    expect(includedAnalysisCredits(hours)).toBe(expected);
  });

  it.each([0, -1, 1.5, 2.5, 3.5, 13, NaN, Infinity, -Infinity])("fails closed for invalid duration %s", (hours) => {
    expect(includedAnalysisCredits(hours)).toBe(0);
  });
});

describe("video analysis entitlement", () => {
  it("derives old completed courses directly from hours and shares the allowance across attendees", () => {
    const historical = { status: "COMPLETED", hours: 2, headcount: 3, totalCents: 14500, accountId: "student" };
    expect(analysisQuota(historical, [], [])).toEqual({ active: true, freeTotal: 3,
      paidTotal: 0, used: 0, reserved: 0, remaining: 3 });
    expect(historical).toEqual({ status: "COMPLETED", hours: 2, headcount: 3, totalCents: 14500, accountId: "student" });
  });

  it.each([1, 2, 3])("shares five credits for a three-hour lesson with %i attendees", (headcount) => {
    const course = { status: "COMPLETED", hours: 3, headcount, accountId: "student" };
    expect(analysisQuota(course, [], []))
      .toMatchObject({ freeTotal: 5, remaining: 5 });
  });

  it.each(["HOLD", "CONFIRMED", "CANCELLED", "EXPIRED"])("does not activate credits for %s", (status) => {
    expect(analysisQuota({ status, hours: 2, accountId: "student" }, [], [{ status: "CONFIRMED", quantity: 4 }]))
      .toMatchObject({ active: false, freeTotal: 0, remaining: 0 });
  });

  it("only counts received purchases and reserves queued or running jobs immediately", () => {
    expect(analysisQuota({ status: "COMPLETED", hours: 2, accountId: "student" }, [
      { status: "QUEUED", refundedAt: null, createdById: "student" }, { status: "RUNNING", refundedAt: null, createdById: "student" },
      { status: "SUCCEEDED", refundedAt: null, createdById: "student" },
    ], [
      { status: "AWAITING_PAYMENT", quantity: 10 }, { status: "PENDING_PAYMENT_REVIEW", quantity: 10 },
      { status: "PAYMENT_REJECTED", quantity: 10 }, { status: "CANCELLED", quantity: 10 },
      { status: "CONFIRMED", quantity: 2 },
    ])).toEqual({ active: true, freeTotal: 3, paidTotal: 2, used: 1, reserved: 2, remaining: 2 });
  });

  it("refunds failed jobs but preserves successful consumption after their video was deleted", () => {
    const deletedVideoJob = { status: "SUCCEEDED", refundedAt: null, createdById: "student", videoId: null };
    expect(analysisQuota({ status: "COMPLETED", hours: 2, accountId: "student" }, [deletedVideoJob,
      { status: "FAILED", refundedAt: new Date(), createdById: "student" }], [])).toMatchObject({ used: 1, remaining: 2 });
  });

  it("fails closed when a failed ledger entry has not actually been refunded", () => {
    expect(analysisQuota({ status: "COMPLETED", hours: 2, accountId: "student" }, [
      { status: "FAILED", refundedAt: null, createdById: "student" }, { status: "SUCCEEDED", refundedAt: null, createdById: "student" },
    ], [])).toMatchObject({ used: 1, reserved: 0, remaining: 1 });
  });

  it("retains historical consumption above the new allowance without refunding or resetting records", () => {
    const booking = Object.freeze({ status: "COMPLETED", hours: 2, headcount: 3, totalCents: 14500, accountId: "student" });
    const jobs = Object.freeze(Array.from({ length: 6 }, () => Object.freeze({ status: "SUCCEEDED", refundedAt: null, createdById: "student" })));
    const purchases = Object.freeze([Object.freeze({ status: "CONFIRMED", quantity: 2 })]);
    expect(analysisQuota(booking, jobs, purchases)).toEqual({ active: true, freeTotal: 3,
      paidTotal: 2, used: 6, reserved: 0, remaining: 0 });
    expect(jobs).toHaveLength(6);
    expect(purchases).toEqual([{ status: "CONFIRMED", quantity: 2 }]);
    expect(booking.totalCents).toBe(14500);
  });

  it("does not use the lesson's credits for its coach's own analyses", () => {
    const jobs = [{ status: "SUCCEEDED", refundedAt: null, createdById: "own-coach" }, { status: "QUEUED", refundedAt: null, createdById: "admin" },
      { status: "SUCCEEDED", refundedAt: null, createdById: "student" }];
    expect(analysisQuota({ status: "COMPLETED", hours: 2, accountId: "student" }, jobs, []))
      .toMatchObject({ used: 1, reserved: 0, remaining: 2 });
  });

  it("adds confirmed paid credits to the included whole-lesson allowance", () => {
    expect(analysisQuota({ status: "COMPLETED", hours: 4, accountId: "student" }, [
      { status: "SUCCEEDED", refundedAt: null, createdById: "student" }, { status: "FAILED", refundedAt: new Date(), createdById: "student" },
    ], [{ status: "CONFIRMED", quantity: 2 }])).toMatchObject({ freeTotal: 5, paidTotal: 2, used: 1, remaining: 6 });
  });
});

describe("analysis read and write access", () => {
  const booking = { accountId: "buyer", coachId: "own-coach" };
  it("preserves shared platform-coach reading without allowing other coaches to act", () => {
    expect(analysisParty(booking, { id: "other-coach", role: "COACH" }))
      .toMatchObject({ canView: true, canAct: false, isCoach: false });
  });
  it.each([{ id: "buyer", role: "CUSTOMER" }, { id: "own-coach", role: "COACH" },
    { id: "admin", role: "ADMIN" }])("lets the order party act: $id", (user) => {
    expect(analysisParty(booking, user)).toMatchObject({ canView: true, canAct: true });
  });
  it("does not give a group guest access to the full course", () => {
    expect(analysisParty(booking, { id: "guest", role: "CUSTOMER" }))
      .toMatchObject({ canView: false, canAct: false });
  });
  it("does not preserve privileged coach actions after the payee's role was removed", () => {
    expect(analysisParty(booking, { id: "own-coach", role: "CUSTOMER" }))
      .toMatchObject({ isCoach: false, canView: false, canAct: false });
  });
});
