import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), guest: vi.fn(), upsert: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: {
  waiverInvite: { findUnique: mocks.find, upsert: mocks.upsert },
  bookingAttendee: { findUnique: mocks.guest },
} }));
vi.mock("../mail", () => ({ baseUrl: () => "http://localhost:3000" }));

import { checkInvite, createInvite, hashInviteToken, inviteFields } from "./invite";

const now = new Date("2026-10-03T15:00:00Z");
const token = "original-signing-token";
const invite = {
  tokenHash: hashInviteToken(token), email: "guardian@example.com",
  expiresAt: new Date("2026-10-10T15:00:00Z"), usedAt: null,
  booking: { id: "booking", code: "SKI-TEST", status: "AWAITING_WAIVER" },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.guest.mockResolvedValue(null);
  mocks.find.mockImplementation(async ({ where }) =>
    where.tokenHash === invite.tokenHash ? invite : null);
});
afterEach(() => vi.useRealTimers());

describe("coach signing invitations", () => {
  it("binds the token to the intended guardian and normalizes sign-in email", async () => {
    expect(await checkInvite(token, " GUARDIAN@EXAMPLE.COM ")).toMatchObject({
      ok: true, bookingId: "booking",
    });
    expect(await checkInvite(token, "someone-else@example.com")).toEqual({
      ok: false, reason: "email-mismatch", expected: "guardian@example.com",
    });
  });

  it.each([
    { usedAt: now },
    { expiresAt: now },
    { booking: { ...invite.booking, status: "CANCELLED" } },
  ])("refuses a used, elapsed, or cancelled invitation", async (changes) => {
    mocks.find.mockResolvedValue({ ...invite, ...changes });
    expect(await checkInvite(token, invite.email)).toEqual({ ok: false, reason: "invalid" });
  });

  it("does not treat an unknown token as authorization", async () => {
    expect(await checkInvite("unknown", invite.email)).toEqual({ ok: false, reason: "invalid" });
  });

  it("reissues only a hash and resets use/send evidence in the caller's transaction", async () => {
    const transaction = { waiverInvite: { upsert: mocks.upsert } };
    const fresh = await createInvite({ bookingId: "booking", email: " GUARDIAN@EXAMPLE.COM " },
      transaction as unknown as Parameters<typeof createInvite>[1]);
    const write = mocks.upsert.mock.calls[0][0];
    expect(write.create).toMatchObject({
      bookingId: "booking", tokenHash: hashInviteToken(fresh),
      email: invite.email, expiresAt: invite.expiresAt,
    });
    expect(write.update).toMatchObject({ usedAt: null, sentAt: null, resentCount: { increment: 1 } });
    expect(JSON.stringify(write)).not.toContain(fresh);
  });

  it("builds identical hashed fields for an atomic first booking", () => {
    expect(inviteFields(" GUARDIAN@EXAMPLE.COM ", token, now)).toEqual({
      tokenHash: invite.tokenHash, email: invite.email, expiresAt: invite.expiresAt,
    });
  });
});

describe("personalized group invitation lookup", () => {
  const guest = { id: "guest", bookingId: "booking", ordinal: 2, fullName: "Child", isMinor: true,
    email: "guardian@example.com", inviteUsedAt: null, inviteExpiresAt: invite.expiresAt,
    booking: { ...invite.booking, status: "HOLD", holdExpiresAt: invite.expiresAt } };
  it("returns only the invited attendee identity and exact guardian email", async () => {
    mocks.find.mockResolvedValue(null);
    mocks.guest.mockResolvedValue(guest);
    expect(await checkInvite("guest-token", " GUARDIAN@example.com ")).toMatchObject({
      ok: true, attendeeId: "guest", ordinal: 2, fullName: "Child", isMinor: true,
    });
    expect(await checkInvite("guest-token", "other@example.com")).toMatchObject({ ok: false, reason: "email-mismatch" });
  });
  it.each([
    { inviteUsedAt: now }, { inviteExpiresAt: now },
    { booking: { ...guest.booking, status: "CANCELLED" } },
    { booking: { ...guest.booking, holdExpiresAt: now } },
  ])("rejects a used, expired or terminal guest invitation", async (changes) => {
    mocks.find.mockResolvedValue(null); mocks.guest.mockResolvedValue({ ...guest, ...changes });
    expect(await checkInvite("guest-token", guest.email)).toEqual({ ok: false, reason: "invalid" });
  });
});
