import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveUser } from "@/lib/auth/require-user";

const mocks = vi.hoisted(() => ({
  requireCoach: vi.fn(), load: vi.fn(), current: vi.fn(), update: vi.fn(),
  transaction: vi.fn(), lock: vi.fn(), mail: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: mocks.transaction,
  booking: { updateMany: mocks.update },
} }));
vi.mock("@/lib/auth/require-user", () => ({ requireCoach: mocks.requireCoach }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
vi.mock("@/lib/booking/access", async (original) => ({
  ...await original<typeof import("@/lib/booking/access")>(),
  loadBooking: mocks.load,
}));
vi.mock("@/lib/booking/notify", () => ({ sendPaymentReviewed: mocks.mail }));

import { POST } from "./route";
import { CURRENT_TEMPLATE_VERSION } from "@/lib/waiver/validity";

const user = (id = "coach", role: ActiveUser["role"] = "COACH"): ActiveUser => ({
  id, role, name: id, email: `${id}@example.com`, image: null,
  phone: null, wechatId: null, tokenIssuedAt: null,
});
const base = {
  id: "booking", code: "SKI-TEST", coachId: "coach", accountId: "student",
  status: "AWAITING_PAYMENT", headcount: 1,
  lessonStartAt: new Date("2026-12-20T14:10:00Z"), participantId: "participant",
  participant: { accountId: "student", isMinor: false },
  waiverId: "waiver", waiver: { id: "waiver", revokedAt: null as Date | null,
    participantId: "participant", coachId: "coach", signerUserId: "student", signerRole: "PARTICIPANT",
    season: "2026-27", templateVersion: CURRENT_TEMPLATE_VERSION, participantWasMinor: false,
    signedAt: new Date("2026-10-03T15:00:00Z") },
  holdExpiresAt: null, paymentProofKey: null, paymentSubmittedAt: null,
  updatedAt: new Date("2026-10-03T15:00:00Z"), paymentPlan: "FULL",
  amountPaidCents: 0, depositCents: 8000, totalCents: 14500,
  account: { email: "student@example.com" },
};
let stored: Omit<typeof base, "holdExpiresAt" | "waiver" | "paymentSubmittedAt"> & {
  holdExpiresAt: Date | null;
  paymentSubmittedAt: Date | null;
  waiver: typeof base.waiver;
};

beforeEach(() => {
  vi.resetAllMocks();
  stored = { ...base };
  mocks.requireCoach.mockResolvedValue({ ok: true, user: user() });
  mocks.load.mockResolvedValue({ ...base });
  mocks.current.mockImplementation(async () => stored);
  mocks.lock.mockResolvedValue([]);
  mocks.mail.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (work) => work({
    $queryRaw: mocks.lock,
    booking: { findUnique: mocks.current, updateMany: mocks.update },
  }));
  mocks.update.mockImplementation(async ({ where, data }) => {
    const stateMatches = typeof where.status === "string"
      ? where.status === stored.status : where.status.in.includes(stored.status);
    const sameSubmission = where.paymentSubmittedAt === undefined ||
      where.paymentSubmittedAt?.getTime() === stored.paymentSubmittedAt?.getTime();
    const sameVersion = !where.updatedAt ||
      where.updatedAt.getTime() === stored.updatedAt.getTime();
    const sameWaiver = !where.waiver || stored.waiver.revokedAt === null;
    if (!stateMatches || !sameSubmission || !sameVersion || !sameWaiver) return { count: 0 };
    Object.assign(stored, data);
    return { count: 1 };
  });
});

const request = (body: unknown = {
  action: "confirm", manualReceipt: { method: "EMT", reference: "receipt-123" },
}) => POST(new Request("http://localhost/api/bookings/SKI-TEST/review", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ expectedUpdatedAt: base.updatedAt.toISOString(), ...body as Record<string, unknown> }),
}), { params: Promise.resolve({ code: "SKI-TEST" }) });

describe("direct coach receipts", () => {
  it.each(["EMT", "WECHAT", "ALIPAY"])("records a %s receipt without a student proof", async (method) => {
    const response = await request({ action: "confirm", manualReceipt: { method } });
    expect(response.status).toBe(200);
    expect(stored).toMatchObject({
      status: "CONFIRMED", amountPaidCents: 14500, paymentMethod: method,
      paymentProofKey: null, proofUploadedBy: "COACH", reviewedById: "coach",
      paymentSubmittedAt: expect.any(Date), reviewedAt: expect.any(Date),
    });
    expect(mocks.lock).toHaveBeenCalledTimes(2);
    expect(mocks.mail).toHaveBeenCalledOnce();
  });

  it("confirms only the deposit on a deposit booking", async () => {
    stored = { ...base, paymentPlan: "DEPOSIT" };
    mocks.load.mockResolvedValue({ ...stored });
    expect((await request()).status).toBe(200);
    expect(stored).toMatchObject({ amountPaidCents: 8000, paymentReference: "receipt-123" });
  });

  it("lets the owner confirm a rejected payment directly", async () => {
    stored = { ...base, status: "PAYMENT_REJECTED" };
    mocks.load.mockResolvedValue({ ...stored });
    expect((await request()).status).toBe(200);
  });

  it("allows an admin to record the receipt", async () => {
    mocks.requireCoach.mockResolvedValue({ ok: true, user: user("admin", "ADMIN") });
    expect((await request()).status).toBe(200);
    expect(stored).toMatchObject({ reviewedById: "admin" });
  });

  it("denies another coach who can only view the order", async () => {
    mocks.requireCoach.mockResolvedValue({ ok: true, user: user("other-coach") });
    expect((await request()).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("honors the coach authentication rejection for a student", async () => {
    mocks.requireCoach.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await request()).status).toBe(403);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("requires the waiver before accepting money", async () => {
    mocks.load.mockResolvedValue({ ...base, waiverId: null });
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "waiver-required" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(["AWAITING_WAIVER", "CANCELLED", "EXPIRED", "CONFIRMED", "PENDING_PAYMENT_REVIEW"])(
    "does not bypass the %s state", async (status) => {
      mocks.load.mockResolvedValue({ ...base, status });
      expect((await request()).status).toBe(409);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("expires a self-serve hold that elapsed before the lock", async () => {
    stored = { ...base, holdExpiresAt: new Date("2000-01-01T00:00:00Z") };
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "expired" });
    expect(stored.status).toBe("EXPIRED");
    expect(mocks.mail).not.toHaveBeenCalled();
  });

  it("does not overwrite a cancellation that won before the row lock", async () => {
    stored = { ...base, status: "CANCELLED" };
    expect((await request()).status).toBe(409);
    expect(stored.amountPaidCents).toBe(0);
    expect(mocks.mail).not.toHaveBeenCalled();
  });

  it("rejects a changed version even when status and null proof match", async () => {
    stored = { ...base, updatedAt: new Date("2026-10-03T15:01:00Z") };
    expect((await request()).status).toBe(409);
    expect(stored.status).toBe("AWAITING_PAYMENT");
  });

  it("requires the version the coach actually saw, including direct receipts", async () => {
    const response = await request({ action: "confirm", expectedUpdatedAt: undefined,
      manualReceipt: { method: "WECHAT" } });
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not accept a revoked waiver", async () => {
    stored = { ...base, waiver: { ...base.waiver, revokedAt: new Date() } };
    expect((await request()).status).toBe(409);
    expect(stored.amountPaidCents).toBe(0);
  });

  it("rejects a manual rejection payload", async () => {
    expect((await request({ action: "reject", manualReceipt: { method: "WECHAT" } })).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("refuses group confirmation if a guest waiver was revoked before the payment lock", async () => {
    const guestWaiver = { ...base.waiver, id: "guest-waiver", participantId: "guest-participant", signerUserId: "guest" };
    const attendees = [
      { ordinal: 1, isMinor: false, accountId: "student", participantId: base.participantId,
        participant: base.participant, waiverId: base.waiverId, waiver: base.waiver },
      { ordinal: 2, isMinor: false, accountId: "guest", participantId: "guest-participant",
        participant: { accountId: "guest", isMinor: false }, waiverId: "guest-waiver", waiver: guestWaiver },
    ];
    mocks.load.mockResolvedValue({ ...base, headcount: 2, attendees });
    mocks.current.mockResolvedValue({ ...base, headcount: 2,
      attendees: [attendees[0], { ...attendees[1], waiver: { ...guestWaiver, revokedAt: new Date() } }] });
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "waiver-required" });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
