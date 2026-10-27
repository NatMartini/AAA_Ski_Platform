import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveUser } from "@/lib/auth/require-user";

const mocks = vi.hoisted(() => ({
  requireCoach: vi.fn(), create: vi.fn(), load: vi.fn(), profile: vi.fn(),
  transaction: vi.fn(), lock: vi.fn(), current: vi.fn(), upsert: vi.fn(), mail: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: mocks.transaction, coachProfile: { findUnique: mocks.profile },
} }));
vi.mock("@/lib/auth/require-user", () => ({ requireCoach: mocks.requireCoach }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
vi.mock("@/lib/booking/create", () => ({ createBooking: mocks.create }));
vi.mock("@/lib/booking/access", async (original) => ({
  ...await original<typeof import("@/lib/booking/access")>(), loadBooking: mocks.load,
}));
vi.mock("@/lib/mail", () => ({ baseUrl: () => "http://localhost:3000", sendMail: mocks.mail }));

import { POST as createBooking } from "@/app/api/coach/bookings/route";
import { POST as reissue } from "@/app/api/coach/bookings/[code]/invite/route";
import { hashInviteToken } from "../waiver/invite";

const user = (id = "coach", role: ActiveUser["role"] = "COACH"): ActiveUser => ({
  id, role, email: `${id}@example.com`, name: id, image: null,
  phone: null, wechatId: null, tokenIssuedAt: null,
});
const booking = {
  id: "booking", code: "SKI-TEST", coachId: "coach", accountId: null,
  status: "AWAITING_WAIVER", waiverId: null, inviteName: "Child",
  inviteEmail: "guardian@example.com", inviteIsMinor: true,
  coach: { name: "Coach", email: "coach@example.com" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireCoach.mockResolvedValue({ ok: true, user: user() });
  mocks.load.mockResolvedValue(booking);
  mocks.current.mockResolvedValue(booking);
  mocks.profile.mockResolvedValue({ displayName: "Coach" });
  mocks.create.mockResolvedValue({
    ok: true, id: booking.id, code: booking.code, nextStep: "waiver",
    inviteToken: "first-token", inviteExpiresAt: new Date("2026-10-10T15:00:00Z"),
  });
  mocks.transaction.mockImplementation(async (work) => work({
    $queryRaw: mocks.lock, booking: { findUnique: mocks.current },
    waiverInvite: { upsert: mocks.upsert },
  }));
});

const createRequest = (extra = {}) => createBooking(new Request("http://localhost/api/coach/bookings", {
  method: "POST", headers: { "content-type": "application/json", "x-locale": "zh" },
  body: JSON.stringify({
    date: "2026-12-20", startHour: 9, hours: 2, lessonType: "riding",
    studentName: "Child", studentEmail: "guardian@example.com", studentIsMinor: true,
    ...extra,
  }),
}));
const reissueRequest = () => reissue(new Request("http://localhost/api/coach/bookings/SKI-TEST/invite", {
  method: "POST", headers: { "x-locale": "zh" },
}), { params: Promise.resolve({ code: booking.code }) });

describe("manual coach invitations", () => {
  it("returns a guardian-bound fixed email draft and link without sending mail", async () => {
    const response = await createRequest();
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      code: booking.code, signingUrl: "http://localhost:3000/zh/w/first-token",
      invitation: { to: "guardian@example.com" },
    });
    expect(body.invitation.text).toContain("guardian@example.com");
    expect(body.invitation.text).toContain("监护人");
    expect(body.invitation.text).toContain(`/zh/booking/${booking.code}`);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      coachId: "coach", invite: { name: "Child", email: "guardian@example.com", isMinor: true },
    }));
    expect(mocks.mail).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("keeps the adult invitation addressed to the student's own account", async () => {
    const response = await createRequest({ studentName: "Adult", studentEmail: "adult@example.com", studentIsMinor: false });
    const body = await response.json();
    expect(body.invitation.to).toBe("adult@example.com");
    expect(body.invitation.text).toContain("学员本人");
    expect(mocks.mail).not.toHaveBeenCalled();
  });

  it("preserves the one-student boundary", async () => {
    expect((await createRequest({ headcount: 2 })).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not let a coach create an adult lesson for their own email", async () => {
    const response = await createRequest({ studentEmail: "COACH@EXAMPLE.COM", studentIsMinor: false });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "student-email-must-differ" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("allows the coach's own address as guardian for their child", async () => {
    expect((await createRequest({ studentEmail: "coach@example.com", studentIsMinor: true })).status).toBe(201);
  });

  it("rejects unauthenticated creation before reading or writing bookings", async () => {
    mocks.requireCoach.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await createRequest()).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("locked signing-link reissue", () => {
  it("returns a new manually sent draft while persisting only the new token's hash", async () => {
    const response = await reissueRequest();
    expect(response.status).toBe(200);
    const body = await response.json();
    const token = new URL(body.signingUrl).pathname.split("/").pop()!;
    const write = mocks.upsert.mock.calls[0][0];
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(write).toMatchObject({
      where: { bookingId: booking.id },
      create: { tokenHash: hashInviteToken(token), email: booking.inviteEmail },
      update: { usedAt: null, sentAt: null, resentCount: { increment: 1 } },
    });
    expect(JSON.stringify(write)).not.toContain(token);
    expect(body.invitation.to).toBe(booking.inviteEmail);
    expect(mocks.mail).not.toHaveBeenCalled();
  });

  it("allows an admin to reissue an unfinished invitation", async () => {
    mocks.requireCoach.mockResolvedValue({ ok: true, user: user("admin", "ADMIN") });
    expect((await reissueRequest()).status).toBe(200);
  });

  it("denies another coach despite their read access", async () => {
    mocks.requireCoach.mockResolvedValue({ ok: true, user: user("another-coach") });
    expect((await reissueRequest()).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["CANCELLED", "CONFIRMED", "COMPLETED", "AWAITING_PAYMENT"])(
    "does not reopen a %s order or create a token", async (status) => {
      mocks.current.mockResolvedValue({ ...booking, status });
      expect((await reissueRequest()).status).toBe(409);
      expect(mocks.upsert).not.toHaveBeenCalled();
    },
  );

  it("rejects a cancellation that landed between initial read and locking", async () => {
    mocks.current.mockResolvedValue({ ...booking, status: "CANCELLED" });
    expect((await reissueRequest()).status).toBe(409);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
