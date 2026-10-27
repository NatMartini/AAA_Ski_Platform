import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), update: vi.fn(), cancelPurchase: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ ok: true, user: { id: "coach", role: "COACH" } }),
  requireCoach: async () => ({ ok: true, user: { id: "coach", role: "COACH" } }),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: { booking: { updateMany: mocks.update } } }));
vi.mock("@/lib/booking/access", () => ({ loadBooking: mocks.load,
  accessFor: () => ({ isCoach: true, canView: true, canCancel: true }) }));
vi.mock("@/lib/booking/notify", () => ({ sendBookingCancelled: vi.fn() }));
vi.mock("@/lib/video-analysis/service", () => ({ cancelAnalysisPurchase: mocks.cancelPurchase }));
import { POST as complete } from "./bookings/[code]/complete/route";
import { POST as cancel } from "./bookings/[code]/cancel/route";
import { POST as balance } from "./bookings/[code]/balance/route";
import { POST as cancelCredits } from "./bookings/[code]/analysis/purchases/[id]/cancel/route";
import { MAX_JSON_BODY_BYTES } from "@/lib/request-body";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ id: "booking", code: "SKI-TEST", status: "CONFIRMED", coachId: "coach",
    lessonEndAt: new Date("2000-01-01"), totalCents: 14500, amountPaidCents: 0, paymentPlan: "FULL",
    account: { email: "student@example.com" }, coach: { name: "Coach", email: "coach@example.com" } });
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.cancelPurchase.mockResolvedValue({ ok: true });
});
const context = { params: Promise.resolve({ code: "SKI-TEST", id: "purchase" }) };
const request = (body?: string, contentLength?: string) => new Request("http://localhost/api/bookings/SKI-TEST/action", {
  method: "POST", body, headers: { "content-type": "application/json", ...(contentLength ? { "content-length": contentLength } : {}) },
});
const routes = [
  { name: "course completion", post: complete }, { name: "booking cancellation", post: cancel },
  { name: "default balance settlement", post: balance }, { name: "credit purchase cancellation", post: cancelCredits },
];
describe("body failures cannot become a successful default mutation", () => {
  it.each(routes)("blocks oversized $name bodies even with a forged length", async ({ post }) => {
    const response = await post(request(JSON.stringify({ reason: "x".repeat(MAX_JSON_BODY_BYTES + 1) }), "1"), context);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too-large" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.cancelPurchase).not.toHaveBeenCalled();
  });
  it.each(routes)("blocks malformed $name bodies without falling back to an empty action", async ({ post }) => {
    const response = await post(request("{broken"), context);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid-json" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.cancelPurchase).not.toHaveBeenCalled();
  });
  it("keeps a legitimately empty completion request usable", async () => {
    expect((await complete(request(), context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  it("keeps a legitimately empty optional balance note usable", async () => {
    expect((await balance(request(), context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledOnce();
  });
});
