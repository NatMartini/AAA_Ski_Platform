import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveUser } from "@/lib/auth/require-user";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), invite: vi.fn(), guest: vi.fn(), load: vi.fn(), self: vi.fn(), participant: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  waiverInvite: { findUnique: mocks.invite }, participant: { upsert: mocks.participant, findFirst: mocks.self },
  bookingAttendee: { findUnique: mocks.guest },
} }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
vi.mock("@/lib/booking/access", () => ({ loadBooking: mocks.load }));
vi.mock("@/lib/waiver/sign", () => ({ signWaiver: mocks.sign }));

import { POST } from "./route";
import { hashInviteToken } from "@/lib/waiver/invite";

const token = "guardian-invitation";
const user: ActiveUser = {
  id: "guardian", email: "guardian@example.com", name: "Guardian", role: "CUSTOMER",
  image: null, phone: null, wechatId: null, tokenIssuedAt: null,
};
const booking = {
  id: "booking", code: "SKI-TEST", status: "AWAITING_WAIVER",
  inviteName: "Child", inviteIsMinor: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue({ ok: true, user });
  mocks.guest.mockResolvedValue(null);
  mocks.self.mockResolvedValue(null);
  mocks.invite.mockImplementation(async ({ where }) => where.tokenHash === hashInviteToken(token)
    ? { email: user.email, usedAt: null, expiresAt: new Date("2099-01-01T00:00:00Z"), booking }
    : null);
  mocks.load.mockResolvedValue(booking);
  mocks.participant.mockResolvedValue({ id: "child", fullName: "Child", isMinor: true, isSelf: false });
  mocks.sign.mockResolvedValue({ ok: true, waiverId: "waiver" });
});
const request = (signingToken = token) => POST(new Request("http://localhost/api/waiver-invites/token", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    typedName: "Guardian", signatureImage: "data:image/png;base64,iVBORw0KGgo=",
    consentToElectronic: true, agreedCheckboxes: {}, guardianName: "Guardian",
  }),
}), { params: Promise.resolve({ token: signingToken }) });

describe("student continuation identity", () => {
  it("allows the intended guardian and forwards the token for atomic completion", async () => {
    expect((await request()).status).toBe(200);
    expect(mocks.participant).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ accountId: "guardian", isMinor: true, isSelf: false }),
    }));
    expect(mocks.sign).toHaveBeenCalledWith(expect.objectContaining({
      inviteToken: token, signerUserId: "guardian", participantId: "child", participantIsMinor: true,
    }));
  });

  it("refuses a different signed-in email before creating participants or waivers", async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: { ...user, id: "other", email: "other@example.com" } });
    expect((await request()).status).toBe(403);
    expect(mocks.participant).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("rejects a same-name identity with the opposite minor flag without rewriting it", async () => {
    mocks.participant.mockResolvedValue({ id: "existing", fullName: "Child", isMinor: false, isSelf: true });
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "participant-status-mismatch" });
    expect(mocks.participant).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("refuses an unknown or invalidated token before changing data", async () => {
    expect((await request("old-token")).status).toBe(404);
    expect(mocks.participant).not.toHaveBeenCalled();
  });
  it("returns a clear conflict when an adult account already has a different self identity", async () => {
    mocks.load.mockResolvedValue({ ...booking, inviteIsMinor: false });
    mocks.self.mockResolvedValue({ identityKey: "different-existing-identity" });
    expect((await request()).status).toBe(409);
    expect(mocks.participant).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("uses the personal guest name and minor status instead of the primary student's identity", async () => {
    mocks.invite.mockResolvedValue(null);
    mocks.guest.mockResolvedValue({ id: "extra-child", bookingId: "booking", ordinal: 2,
      fullName: "Guest Child", email: user.email, isMinor: true, inviteUsedAt: null,
      inviteExpiresAt: new Date("2099-01-01T00:00:00Z"), booking: { ...booking, status: "HOLD", holdExpiresAt: null } });
    mocks.load.mockResolvedValue({ ...booking, status: "HOLD", inviteName: null });
    mocks.participant.mockResolvedValue({ id: "guest-child", fullName: "Guest Child", isMinor: true, isSelf: false });
    const response = await request();
    expect(response.status).toBe(200);
    expect(mocks.sign).toHaveBeenCalledWith(expect.objectContaining({ attendeeId: "extra-child",
      participantName: "Guest Child", participantId: "guest-child", participantIsMinor: true }));
    expect(await response.json()).toMatchObject({ isPrimary: false, isBookingOwner: false });
  });
});
