import { describe, expect, it } from "vitest";
import { bookingReviewSchema, coachCreateBookingSchema, createBookingSchema, packagePaymentSchema,
  paymentProofSchema, reviewSchema } from "./validators";

const KEY = "proofs/b1/c928d4a1-027e-417d-97fe-92fc8e1ebb11.webp";

describe("review snapshot validation", () => {
  it.each([reviewSchema, bookingReviewSchema])("requires a valid explicit version for every review", (schema) => {
    expect(schema.safeParse({ action: "confirm" }).success).toBe(false);
    expect(schema.safeParse({ action: "reject", expectedUpdatedAt: "invalid" }).success).toBe(false);
    expect(schema.safeParse({ action: "confirm", expectedUpdatedAt: "2026-10-07T15:00:00.000Z" }).success).toBe(true);
  });
  it("also requires the version when the coach directly records a receipt", () => {
    expect(bookingReviewSchema.safeParse({ action: "confirm", manualReceipt: { method: "WECHAT" } }).success).toBe(false);
  });
});

describe("payment proof", () => {
  it("accepts WeChat with nothing attached: the coach confirms it in WeChat", () => {
    expect(paymentProofSchema.safeParse({ method: "WECHAT" }).success).toBe(true);
    expect(packagePaymentSchema.safeParse({ method: "WECHAT" }).success).toBe(true);
  });

  it("needs both the screenshot and the reference for an e-Transfer", () => {
    expect(
      paymentProofSchema.safeParse({ method: "EMT", proofKey: KEY, reference: "CA7Xk9" })
        .success,
    ).toBe(true);

    const noReference = paymentProofSchema.safeParse({ method: "EMT", proofKey: KEY });
    expect(noReference.success).toBe(false);
    expect(noReference.error?.issues.map((i) => i.path.join("."))).toEqual(["reference"]);

    const noScreenshot = packagePaymentSchema.safeParse({
      method: "EMT",
      reference: "CA7Xk9",
    });
    expect(noScreenshot.error?.issues.map((i) => i.path.join("."))).toEqual(["proofKey"]);
  });

  it("does not count a blank reference", () => {
    expect(
      paymentProofSchema.safeParse({ method: "ALIPAY", proofKey: KEY, reference: "   " })
        .success,
    ).toBe(false);
  });
});

describe("complete group request validation", () => {
  const customer = { coachId: "coach", date: "2026-12-20", startHour: 9, hours: 2,
    lessonType: "riding", participantId: "self", headcount: 2,
    additionalAttendees: [{ fullName: "Guest", email: "guest@example.com", isMinor: false }] };
  it("accepts two or three fully identified attendees", () => {
    expect(createBookingSchema.safeParse(customer).success).toBe(true);
    expect(createBookingSchema.safeParse({ ...customer, headcount: 3, additionalAttendees: [
      { fullName: "Child A", email: "guardian@example.com", isMinor: true },
      { fullName: "Child B", email: "guardian@example.com", isMinor: true },
    ] }).success).toBe(true);
  });
  it("rejects an incorrect count or a group package", () => {
    expect(createBookingSchema.safeParse({ ...customer, headcount: 3 }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...customer, paymentPlan: "PACKAGE", packageId: "pkg" }).success).toBe(false);
  });
  it("uses the same canonical name as participant creation to reject disguised duplicates", () => {
    expect(createBookingSchema.safeParse({ ...customer, headcount: 3, additionalAttendees: [
      { fullName: "Xiao Ming", email: "guardian@example.com", isMinor: true },
      { fullName: "Xiao-Ming", email: "GUARDIAN@example.com", isMinor: true },
    ] }).success).toBe(false);
    expect(coachCreateBookingSchema.safeParse({ ...customer, studentName: "Xiao Ming", studentEmail: "guardian@example.com",
      studentIsMinor: true, additionalAttendees: [{ fullName: "Xiao-Ming", email: "guardian@example.com", isMinor: true }] }).success).toBe(false);
  });
});
