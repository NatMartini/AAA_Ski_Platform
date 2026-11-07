import { describe, expect, it } from "vitest";
import { analysisParty, analysisQuota, LESSON_ANALYSES } from "./quota";

describe("a lesson's own analyses", () => {
  const completed = { status: "COMPLETED", accountId: "student" };
  it("holds no credits to spend: a student's are in their account, three per completed lesson", () => {
    expect(LESSON_ANALYSES).toBe(3);
    expect(analysisQuota(completed, [], [{ status: "CONFIRMED", quantity: 4 }]))
      .toEqual({ active: true, freeTotal: 0, paidTotal: 4, used: 0, reserved: 0, remaining: 0 });
  });
  it.each(["HOLD", "CONFIRMED", "CANCELLED", "EXPIRED"])("is not active before the lesson is completed (%s)", (status) => {
    expect(analysisQuota({ status, accountId: "student" }, [], [])).toMatchObject({ active: false, remaining: 0 });
  });
  it("counts the student's earlier lesson analyses, not refunded ones or the coach's", () => {
    expect(analysisQuota(completed, [
      { status: "SUCCEEDED", refundedAt: null, createdById: "student" },
      { status: "RUNNING", refundedAt: null, createdById: "student" },
      { status: "FAILED", refundedAt: new Date(), createdById: "student" },
      { status: "SUCCEEDED", refundedAt: null, createdById: "coach" },
    ], [{ status: "AWAITING_PAYMENT", quantity: 2 }])).toEqual({ active: true, freeTotal: 0, paidTotal: 0, used: 1, reserved: 1, remaining: 0 });
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
