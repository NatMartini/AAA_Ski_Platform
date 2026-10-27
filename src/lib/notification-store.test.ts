import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ bookings: vi.fn(), packages: vi.fn(), analysisPurchases: vi.fn(), analysisJobs: vi.fn(), videoReviews: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: {
  booking: { findMany: mocks.bookings }, lessonPackage: { findMany: mocks.packages },
  videoAnalysisPurchase: { findMany: mocks.analysisPurchases }, videoAnalysisJob: { findMany: mocks.analysisJobs },
  coachVideoReviewRequest: { findMany: mocks.videoReviews },
} }));
import { loadNotifications } from "./notification-store";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.bookings.mockResolvedValue([]);
  mocks.packages.mockResolvedValue([]);
  mocks.analysisPurchases.mockResolvedValue([]);
  mocks.analysisJobs.mockResolvedValue([]);
  mocks.videoReviews.mockResolvedValue([]);
});

describe("inbox database scoping", () => {
  it("binds every customer query to their account and never selects private participant/payment data", async () => {
    await loadNotifications({ id: "student", role: "CUSTOMER" });
    expect(mocks.bookings.mock.calls[0][0].where.OR).toEqual([expect.objectContaining({ accountId: "student" })]);
    expect(mocks.packages.mock.calls[0][0].where.OR).toEqual([expect.objectContaining({ accountId: "student" })]);
    expect(mocks.bookings.mock.calls[1][0].where.accountId).toBe("student");
    expect(mocks.packages.mock.calls[1][0].where.accountId).toBe("student");
    expect(mocks.analysisPurchases.mock.calls[0][0].where.OR).toEqual([expect.objectContaining({ accountId: "student" })]);
    expect(mocks.analysisJobs.mock.calls[0][0].where.booking.OR).toEqual([{ accountId: "student" }]);
    expect(mocks.analysisJobs.mock.calls[0][0].select).not.toHaveProperty("result");
    expect(mocks.videoReviews.mock.calls[0][0].where.OR).toEqual([{ accountId: "student", status: "PUBLISHED", publishedAt: { gte: expect.any(Date) } }]);
    expect(mocks.videoReviews.mock.calls[0][0].select).not.toHaveProperty("draftText");
    expect(mocks.videoReviews.mock.calls[0][0].select).not.toHaveProperty("publishedText");
    for (const [query] of [...mocks.bookings.mock.calls, ...mocks.packages.mock.calls]) {
      expect(query.take).toBe(40);
      expect(query.select).not.toHaveProperty("participant");
      expect(query.select).not.toHaveProperty("account");
      expect(query.select).not.toHaveProperty("paymentProofKey");
      expect(query.select).not.toHaveProperty("inviteEmail");
      expect(query.select).not.toHaveProperty("coachSummary");
    }
  });

  it.each(["COACH", "ADMIN"] as const)("scopes %s action queries to self and own payment responsibilities", async (role) => {
    await loadNotifications({ id: "coach", role });
    expect(mocks.bookings.mock.calls[0][0].where.OR).toEqual([
      expect.objectContaining({ accountId: "coach" }),
      { coachId: "coach", OR: [
        { status: { in: ["PENDING_PAYMENT_REVIEW", "AWAITING_WAIVER", "PAYMENT_REJECTED"] } },
        { status: "AWAITING_PAYMENT", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: expect.any(Date) } }] },
      ] },
    ]);
    expect(mocks.packages.mock.calls[0][0].where.OR).toEqual([
      expect.objectContaining({ accountId: "coach" }),
      { payeeCoachId: "coach", status: "PENDING_PAYMENT_REVIEW" },
    ]);
    expect(mocks.videoReviews.mock.calls[0][0].where.OR).toContainEqual({ coachId: "coach", status: { in: ["REQUESTED", "IN_REVIEW"] } });
  });

  it("keeps elapsed holds out of the bounded action batch and looks up recent expiry separately", async () => {
    const now = new Date("2026-10-03T12:00:00Z");
    await loadNotifications({ id: "student", role: "CUSTOMER" }, now);
    const ownActions = mocks.bookings.mock.calls[0][0].where.OR[0];
    expect(ownActions.OR[1]).toEqual({
      status: { in: ["HOLD", "AWAITING_PAYMENT"] },
      OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
    });
    expect(mocks.bookings.mock.calls[1][0].where.OR).toContainEqual({
      status: { in: ["HOLD", "AWAITING_PAYMENT"] },
      holdExpiresAt: { gte: expect.any(Date), lte: now },
    });
  });
});
