import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveUser } from "../auth/require-user";

const mocks = vi.hoisted(() => ({ load: vi.fn(), transaction: vi.fn(), current: vi.fn(),
  lock: vi.fn(), update: vi.fn(), expire: vi.fn(), primaryInvite: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("./access", async (original) => ({ ...await original<typeof import("./access")>(), loadBooking: mocks.load }));
vi.mock("../mail", () => ({ baseUrl: () => "http://localhost:3000" }));
import { loadAttendeeRoster, reissueAttendeeInvite } from "./attendees";
import { hashInviteToken } from "../waiver/invite";

const user = (id: string, role: ActiveUser["role"] = "CUSTOMER"): ActiveUser => ({
  id, role, name: id, email: `${id}@example.com`, image: null, phone: null, wechatId: null, tokenIssuedAt: null,
});
const booking = { id: "booking", code: "SKI-GROUP", headcount: 2, coachId: "coach", accountId: "buyer",
  status: "HOLD", createdByCoach: false, holdExpiresAt: new Date("2099-01-02T00:00:00Z"),
  lessonStartAt: new Date("2099-01-20T14:10:00Z"), coach: { name: "Coach", email: "coach@example.com" },
  attendees: [
    { id: "primary", ordinal: 1, fullName: "Buyer", email: "buyer@example.com", isMinor: false,
      accountId: "buyer", participantId: "buyer-participant", waiverId: null, participant: null, waiver: null },
    { id: "guest", ordinal: 2, fullName: "Guest", email: "guest@example.com", isMinor: false,
      accountId: null, participantId: null, waiverId: null, participant: null, waiver: null,
      inviteTokenHash: "private-hash", inviteExpiresAt: new Date("2099-01-02T00:00:00Z"), inviteUsedAt: null },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(booking); mocks.current.mockResolvedValue(booking);
  mocks.lock.mockResolvedValue([]); mocks.expire.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (work) => work({ $queryRaw: mocks.lock,
    booking: { findUnique: mocks.current, updateMany: mocks.expire },
    bookingAttendee: { update: mocks.update }, waiverInvite: { upsert: mocks.primaryInvite } }));
});

describe("group roster privacy and management", () => {
  it("gives the buyer safe rows without invitation secrets or guest PDFs", async () => {
    const result = await loadAttendeeRoster(booking.code, user("buyer"));
    expect(result).toMatchObject({ ok: true, canManage: true, allSigned: false });
    if (!result.ok) throw new Error("Expected roster");
    expect(result.attendees).toHaveLength(2);
    expect(result.attendees[1].canReadPdf).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-hash");
    expect(result.attendees[1]).not.toHaveProperty("waiver");
  });
  it("gives an invited guest only their own row and no management permission", async () => {
    const result = await loadAttendeeRoster(booking.code, user("guest"));
    expect(result).toMatchObject({ ok: true, canManage: false });
    if (!result.ok) throw new Error("Expected roster");
    expect(result.attendees.map((a) => a.id)).toEqual(["guest"]);
  });
  it("keeps the shared coach roster readable but gives only the owning coach invite controls", async () => {
    const result = await loadAttendeeRoster(booking.code, user("other-coach", "COACH"));
    expect(result).toMatchObject({ ok: true, canManage: false });
    if (!result.ok) throw new Error("Expected roster");
    expect(result.attendees).toHaveLength(2);
    expect(result.attendees.every((a) => a.canReadPdf)).toBe(true);
  });
  it.each(["CANCELLED", "EXPIRED", "CONFIRMED"])("cannot restore controls by polling a %s order", async (status) => {
    mocks.load.mockResolvedValue({ ...booking, status });
    expect(await loadAttendeeRoster(booking.code, user("buyer"))).toMatchObject({ ok: true, canManage: false });
  });
  it("hides controls when a live status has already reached its deadline", async () => {
    mocks.load.mockResolvedValue({ ...booking, holdExpiresAt: new Date(0) });
    expect(await loadAttendeeRoster(booking.code, user("buyer"))).toMatchObject({ ok: true, canManage: false });
  });
  it("refuses an unrelated customer's roster request", async () => {
    expect(await loadAttendeeRoster(booking.code, user("stranger"))).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("individual invitation reissue", () => {
  it("replaces only one guest token and caps validity to the reserved slot", async () => {
    const result = await reissueAttendeeInvite(booking.code, "guest", user("buyer"), "en");
    expect(result).toMatchObject({ ok: true, attendeeId: "guest", code: booking.code });
    if (!result.ok) throw new Error("Expected invitation");
    const token = result.signingUrl.split("/").at(-1)!;
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "guest" }, data: {
      inviteTokenHash: hashInviteToken(token), inviteExpiresAt: expect.any(Date), inviteUsedAt: null,
    } });
    expect(mocks.primaryInvite).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[0][0].data.inviteExpiresAt <= booking.holdExpiresAt).toBe(true);
    expect(result.invitation.text).not.toContain(`/booking/${booking.code}`);
  });
  it("cannot reopen an order cancelled before the row lock", async () => {
    mocks.current.mockResolvedValue({ ...booking, status: "CANCELLED" });
    expect(await reissueAttendeeInvite(booking.code, "guest", user("buyer"), "en")).toEqual({ ok: false, reason: "not-invitable" });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("lets the original customer sign through their own route instead of issuing a primary token", async () => {
    expect(await reissueAttendeeInvite(booking.code, "primary", user("buyer"), "en")).toEqual({ ok: false, reason: "not-invitable" });
  });
  it.each([user("guest"), user("other-coach", "COACH")])("refuses a nonmanager invitation request", async (caller) => {
    expect(await reissueAttendeeInvite(booking.code, "guest", caller, "en")).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
