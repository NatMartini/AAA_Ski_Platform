import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  requireCoach: vi.fn(), booking: vi.fn(), update: vi.fn(), current: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireCoach: mocks.requireCoach }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: { booking: { updateMany: mocks.update, findUnique: mocks.current } } }));
vi.mock("@/lib/booking/access", async (original) => ({
  ...await original<typeof import("@/lib/booking/access")>(), loadBooking: mocks.booking,
}));

const request = () => new Request("http://localhost/api/bookings/LESSON/complete", { method: "POST" });
const context = { params: Promise.resolve({ code: "LESSON" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCoach.mockResolvedValue({ ok: true, user: { id: "coach", role: "COACH" } });
  mocks.booking.mockResolvedValue({ id: "booking", coachId: "coach", accountId: "student", status: "CONFIRMED", lessonEndAt: new Date(0) });
  mocks.update.mockResolvedValue({ count: 1 });
});

describe("lesson completion", () => {
  it("marks an ended lesson complete without changing historical prices or payments", async () => {
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ status: "COMPLETED" });
  });
  it("does not unlock analysis before the lesson ends", async () => {
    mocks.booking.mockResolvedValue({ id: "booking", coachId: "coach", status: "CONFIRMED", lessonEndAt: new Date(Date.now() + 60_000) });
    expect((await POST(request(), context)).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["CANCELLED", "HOLD", "PENDING_PAYMENT_REVIEW"])("rejects %s", async (status) => {
    mocks.booking.mockResolvedValue({ id: "booking", coachId: "coach", status, lessonEndAt: new Date(0) });
    expect((await POST(request(), context)).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("prevents another coach from completing this lesson", async () => {
    mocks.requireCoach.mockResolvedValue({ ok: true, user: { id: "other-coach", role: "COACH" } });
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("keeps a concurrent cancellation intact", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    mocks.current.mockResolvedValue({ status: "CANCELLED" });
    expect((await POST(request(), context)).status).toBe(409);
  });
  it("is idempotent after a concurrent completion", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    mocks.current.mockResolvedValue({ status: "COMPLETED" });
    expect((await POST(request(), context)).status).toBe(200);
  });
  it("does not write an already completed lesson", async () => {
    mocks.booking.mockResolvedValue({ coachId: "coach", status: "COMPLETED" });
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
