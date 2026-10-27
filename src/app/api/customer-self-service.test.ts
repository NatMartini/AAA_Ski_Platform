import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as book } from "./bookings/route";
import { POST as purchase } from "./packages/route";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  participant: vi.fn(),
  resort: vi.fn(),
  coach: vi.fn(),
  createBooking: vi.fn(),
  createPackage: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    participant: { findUnique: mocks.participant },
    resort: { findUnique: mocks.resort },
    coachProfile: { findUnique: mocks.coach },
    lessonPackage: { create: mocks.createPackage },
  },
}));
vi.mock("@/lib/booking/create", () => ({ createBooking: mocks.createBooking }));
vi.mock("@/lib/booking/notify", () => ({ sendBookingConfirmation: mocks.notify }));
vi.mock("@/lib/coach", () => ({ canAcceptBookings: () => true }));
vi.mock("@/lib/packages", () => ({
  offersOnSale: () => ({
    season: "2026-27",
    offers: [{ key: "winter-pack", resortSlug: "mountain", lessonType: "riding", hours: 4, priceCents: 18000 }],
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ ok: true, user: { id: "customer", role: "CUSTOMER" } });
  mocks.participant.mockResolvedValue({
    id: "participant", accountId: "customer", fullName: "Student", isMinor: false,
    isSelf: true, level: null, archivedAt: null,
  });
  mocks.resort.mockResolvedValue({ id: "resort", isActive: true });
  mocks.coach.mockResolvedValue({ userId: "coach" });
  mocks.createBooking.mockResolvedValue({ ok: true, code: "LESSON-1", nextStep: "waiver" });
  mocks.createPackage.mockResolvedValue({ code: "PACKAGE-1" });
  mocks.notify.mockResolvedValue(undefined);
});

const ENDPOINTS = [
  { path: "/api/bookings", post: book, error: "coach-booking-required" },
  { path: "/api/packages", post: purchase, error: "customer-package-purchase-only" },
];

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function expectNoDataAccess() {
  expect(mocks.participant).not.toHaveBeenCalled();
  expect(mocks.resort).not.toHaveBeenCalled();
  expect(mocks.coach).not.toHaveBeenCalled();
  expect(mocks.createBooking).not.toHaveBeenCalled();
  expect(mocks.createPackage).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
}

describe("customer-only self-service endpoints", () => {
  it.each(ENDPOINTS.flatMap((endpoint) => ["COACH", "ADMIN"].map((role) => ({ ...endpoint, role }))))(
    "rejects $role on $path before parsing or creating anything",
    async ({ role, path, post, error }) => {
      mocks.requireUser.mockResolvedValue({ ok: true, user: { id: "coach", role } });
      const req = request(path, {});
      const parse = vi.spyOn(req, "json");

      const response = await post(req);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error });
      expect(parse).not.toHaveBeenCalled();
      expectNoDataAccess();
    },
  );

  it.each(ENDPOINTS)("preserves the sign-in requirement on $path", async ({ path, post }) => {
    const denied = Response.json({ error: "Unauthorized" }, { status: 401 });
    mocks.requireUser.mockResolvedValue({ ok: false, response: denied });

    expect(await post(request(path, {}))).toBe(denied);
    expectNoDataAccess();
  });

  it.each(ENDPOINTS)("still validates customer input on $path", async ({ path, post }) => {
    const response = await post(request(path, {}));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("validation");
    expectNoDataAccess();
  });

  it("still creates a customer's self-service booking", async () => {
    const response = await book(request("/api/bookings", {
      coachId: "coach", participantId: "participant", date: "2026-12-15",
      startHour: 9, hours: 2, lessonType: "riding",
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true, code: "LESSON-1", nextStep: "waiver", invitations: [] });
    expect(mocks.createBooking).toHaveBeenCalledOnce();
    expect(mocks.createBooking.mock.calls[0][0].account.id).toBe("customer");
    expect(mocks.notify).toHaveBeenCalledWith("LESSON-1", "zh");
  });

  it("still lets customers purchase a lesson package", async () => {
    const response = await purchase(request("/api/packages", { offerKey: "winter-pack", payeeCoachId: "coach" }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true, code: "PACKAGE-1" });
    expect(mocks.createPackage).toHaveBeenCalledOnce();
    expect(mocks.createPackage.mock.calls[0][0].data.accountId).toBe("customer");
  });
});
