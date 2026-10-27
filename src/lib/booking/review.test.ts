import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bookingUpdate: vi.fn(),
  packageUpdate: vi.fn(),
  loadBooking: vi.fn(),
  loadPackage: vi.fn(),
  bookingMail: vi.fn(),
  packageMail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  booking: { updateMany: mocks.bookingUpdate },
  lessonPackage: { updateMany: mocks.packageUpdate },
} }));
vi.mock("@/lib/auth/require-user", () => ({
  requireCoach: async () => ({ ok: true, user: { id: "coach" } }),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
vi.mock("@/lib/booking/access", () => ({
  bookingInclude: {},
  loadBooking: mocks.loadBooking,
  accessFor: () => ({ isCoach: true, canReview: true }),
}));
vi.mock("@/lib/package-store", () => ({
  loadPackage: mocks.loadPackage,
  accessForPackage: () => ({ isPayee: true, canReview: true }),
}));
vi.mock("@/lib/booking/notify", () => ({
  sendPaymentReviewed: mocks.bookingMail,
  sendPackageReviewed: mocks.packageMail,
}));
vi.mock("@/lib/payment-proof", () => ({
  deletePaymentProofIfUnreferenced: vi.fn(),
  withPaymentProofLock: async (_id: string, work: (tx: unknown) => unknown) => work({
    booking: { findUnique: async () => ({ status: "PENDING_PAYMENT_REVIEW", holdExpiresAt: null }),
      updateMany: mocks.bookingUpdate },
  }),
}));
// These tests isolate the exact-submission CAS; readiness has its own domain tests.
vi.mock("@/lib/booking/group-readiness", () => ({ areBookingWaiversValid: () => true }));
vi.mock("@/lib/booking/attendees", () => ({ lockBookingWaivers: async () => undefined }));

import { POST as reviewBooking } from "@/app/api/bookings/[code]/review/route";
import { POST as reviewPackage } from "@/app/api/packages/[code]/review/route";

const firstSubmission = new Date("2026-11-20T15:00:00Z");
const secondSubmission = new Date("2026-11-20T15:05:00Z");
const snapshot = {
  id: "order",
  code: "ORDER-TEST",
  status: "PENDING_PAYMENT_REVIEW",
  waiverId: "waiver",
  paymentProofKey: null,
  paymentSubmittedAt: firstSubmission,
  updatedAt: firstSubmission,
  paymentPlan: "FULL",
  totalCents: 18000,
  amountPaidCents: 0,
  account: { email: "student@example.com" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.bookingMail.mockResolvedValue(undefined);
  mocks.packageMail.mockResolvedValue(undefined);
});

describe.each([
  { name: "booking", review: reviewBooking, load: mocks.loadBooking, update: mocks.bookingUpdate, mail: mocks.bookingMail },
  { name: "package", review: reviewPackage, load: mocks.loadPackage, update: mocks.packageUpdate, mail: mocks.packageMail },
])("$name payment review", ({ review, load, update, mail }) => {
  async function submitReview() {
    return review(new Request("http://localhost/api/order/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "confirm", expectedUpdatedAt: firstSubmission.toISOString() }),
    }), { params: Promise.resolve({ code: snapshot.code }) });
  }

  function storeSubmission(submittedAt: Date | null) {
    const stored = { ...snapshot, paymentSubmittedAt: submittedAt };
    update.mockImplementation(async ({ where, data }) => {
      // Simulate the conditional database update, including Prisma's behavior
      // of skipping an undefined filter. The status and null WeChat key alone
      // still match after rejection and resubmission.
      const sameSubmission = where.paymentSubmittedAt === undefined ||
        where.paymentSubmittedAt?.getTime() === stored.paymentSubmittedAt?.getTime();
      if (where.status !== stored.status || where.paymentProofKey !== stored.paymentProofKey || !sameSubmission) {
        return { count: 0 };
      }
      Object.assign(stored, data);
      return { count: 1 };
    });
    return stored;
  }

  it("refuses a stale confirm after a WeChat claim is rejected and resubmitted", async () => {
    load.mockResolvedValue(snapshot);
    const stored = storeSubmission(secondSubmission);

    const response = await submitReview();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "state-changed" });
    expect(stored.status).toBe("PENDING_PAYMENT_REVIEW");
    expect(stored.amountPaidCents).toBe(0);
    expect(mail).not.toHaveBeenCalled();
  });

  it("refuses the browser's old version even when the POST loads a fresh resubmission", async () => {
    load.mockResolvedValue({ ...snapshot, paymentSubmittedAt: secondSubmission, updatedAt: secondSubmission });
    const stored = storeSubmission(secondSubmission);
    const response = await submitReview();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "state-changed" });
    expect(stored.amountPaidCents).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(mail).not.toHaveBeenCalled();
  });

  it("confirms the submission the coach actually reviewed", async () => {
    load.mockResolvedValue(snapshot);
    storeSubmission(firstSubmission);

    expect((await submitReview()).status).toBe(200);
    expect(mail).toHaveBeenCalledOnce();
  });

  it("allows a legacy pending record whose submission timestamp is null", async () => {
    load.mockResolvedValue({ ...snapshot, paymentSubmittedAt: null });
    storeSubmission(null);

    expect((await submitReview()).status).toBe(200);
    expect(mail).toHaveBeenCalledOnce();
  });
});
