import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedBooking } from "../booking/access";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), waivers: vi.fn(), updateBooking: vi.fn(), currentBooking: vi.fn(),
  lock: vi.fn(), invite: vi.fn(), consume: vi.fn(), render: vi.fn(),
  createWaiver: vi.fn(), write: vi.fn(), remove: vi.fn(),
  updateAttendee: vi.fn(), setBooking: vi.fn(),
}));
vi.mock("../prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("./render", () => ({ renderWaiverPdf: mocks.render }));
vi.mock("../storage", async (original) => ({
  ...await original<typeof import("../storage")>(),
  writeObject: mocks.write, deleteObject: mocks.remove,
}));

import { signWaiver, type SignInput } from "./sign";
import { hashInviteToken } from "./invite";
import { CURRENT_TEMPLATE_VERSION } from "./validity";
import { acknowledgementIds } from "./template-v1";

const now = new Date("2026-10-03T15:00:00Z");
const token = "intended-signing-token";
const input: SignInput = {
  booking: {
    id: "booking", code: "SKI-TEST", coachId: "coach", status: "AWAITING_WAIVER",
    paymentPlan: "FULL", holdExpiresAt: null, waiverId: null,
    lessonStartAt: new Date("2026-12-20T14:10:00Z"),
    lessonEndAt: new Date("2026-12-20T16:00:00Z"),
    totalCents: 14500, currency: "CAD", package: null,
    coach: { name: "Coach", email: "coach@example.com" },
    resort: { nameEn: "Blue Mountain" },
  } as LoadedBooking,
  participantId: "participant", participantName: "Student", participantIsMinor: false,
  signerUserId: "student", signerName: "Student", signerEmail: "student@example.com",
  typedName: "Student", signatureImage: "data:image/png;base64,iVBORw0KGgo=",
  consentToElectronic: true,
  agreedCheckboxes: Object.fromEntries(acknowledgementIds("adult").map((id) => [id, true])) as Record<string, true>,
  guardianName: null, guardianPhone: null, guardianRelationship: null,
  ipAddress: "127.0.0.1", userAgent: "test", inviteToken: token,
};
const invite = {
  tokenHash: hashInviteToken(token), email: input.signerEmail,
  usedAt: null, expiresAt: new Date("2026-10-10T15:00:00Z"),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.waivers.mockResolvedValue([{
    id: "existing-waiver", season: "2026-27", templateVersion: CURRENT_TEMPLATE_VERSION,
    participantWasMinor: false, revokedAt: null, signedAt: now,
  }]);
  mocks.invite.mockResolvedValue(invite);
  mocks.consume.mockResolvedValue({ count: 1 });
  mocks.updateBooking.mockResolvedValue({ count: 1 });
  mocks.createWaiver.mockResolvedValue({ id: "new-waiver" });
  mocks.render.mockResolvedValue(Buffer.from("mock-pdf"));
  mocks.write.mockResolvedValue({ key: "waivers/test.pdf" });
  mocks.remove.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (work) => work({
    $queryRaw: mocks.lock,
    waiver: { findMany: mocks.waivers, create: mocks.createWaiver },
    booking: { updateMany: mocks.updateBooking, findUnique: mocks.currentBooking, update: mocks.setBooking },
    bookingAttendee: { update: mocks.updateAttendee },
    waiverInvite: { findUnique: mocks.invite, updateMany: mocks.consume },
  }));
});

describe("individual group signing", () => {
  function groupSetup(extraUnsigned = false) {
    const primaryWaiver = { id: "primary-waiver", participantId: "primary", coachId: "coach",
      signerUserId: "purchaser", signerRole: "PARTICIPANT", season: "2026-27",
      templateVersion: CURRENT_TEMPLATE_VERSION, participantWasMinor: false, revokedAt: null, signedAt: now };
    const group = { ...input.booking, headcount: extraUnsigned ? 3 : 2, createdByCoach: false,
      status: "HOLD", accountId: "purchaser", participantId: "primary", waiverId: "primary-waiver",
      participant: { accountId: "purchaser", isMinor: false }, waiver: primaryWaiver,
      holdExpiresAt: new Date("2026-10-04T15:00:00Z"), attendees: [
        { id: "primary-row", ordinal: 1, email: "purchaser@example.com", isMinor: false,
          accountId: "purchaser", participantId: "primary", waiverId: "primary-waiver",
          participant: { accountId: "purchaser", isMinor: false }, waiver: primaryWaiver,
          inviteTokenHash: null, inviteExpiresAt: null, inviteUsedAt: null as Date | null },
        { id: "guest-row", ordinal: 2, email: input.signerEmail, isMinor: false,
          accountId: null, participantId: null, waiverId: null, participant: null, waiver: null,
          inviteTokenHash: hashInviteToken(token), inviteExpiresAt: new Date("2026-10-04T15:00:00Z"), inviteUsedAt: null as Date | null },
        ...(extraUnsigned ? [{ id: "third-row", ordinal: 3, email: "third@example.com", isMinor: false,
          accountId: null, participantId: null, waiverId: null, participant: null, waiver: null,
          inviteTokenHash: "third", inviteExpiresAt: new Date("2026-10-04T15:00:00Z"), inviteUsedAt: null as Date | null }] : []),
      ],
    };
    mocks.currentBooking.mockImplementation(async () => group);
    mocks.updateAttendee.mockImplementation(async ({ where, data }) => {
      const attendee = group.attendees.find((a) => a.id === where.id)!;
      Object.assign(attendee, data, { participant: { accountId: input.signerUserId, isMinor: false },
        waiver: { ...primaryWaiver, id: data.waiverId, participantId: input.participantId, signerUserId: input.signerUserId } });
      return attendee;
    });
    mocks.setBooking.mockImplementation(async ({ data }) => Object.assign(group, data));
    return { group, guestInput: { ...input, booking: group as unknown as LoadedBooking, attendeeId: "guest-row" } };
  }

  it("attaches only the invited guest and unlocks payment after the final valid signature", async () => {
    const { group, guestInput } = groupSetup();
    expect(await signWaiver(guestInput)).toEqual({ ok: true, waiverId: "existing-waiver" });
    expect(group).toMatchObject({ accountId: "purchaser", participantId: "primary", waiverId: "primary-waiver", status: "AWAITING_PAYMENT" });
    expect(group.attendees[1]).toMatchObject({ accountId: "student", participantId: "participant", inviteUsedAt: now });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.setBooking).toHaveBeenCalledWith({ where: { id: "booking" }, data: { status: "AWAITING_PAYMENT" } });
  });

  it("keeps the hold while a third attendee is still unsigned", async () => {
    const { group, guestInput } = groupSetup(true);
    expect((await signWaiver(guestInput)).ok).toBe(true);
    expect(group.status).toBe("HOLD");
    expect(mocks.setBooking).not.toHaveBeenCalled();
  });

  it("cannot reopen a cancellation that won before the booking lock", async () => {
    const { group, guestInput } = groupSetup();
    group.status = "CANCELLED";
    expect(await signWaiver(guestInput)).toEqual({ ok: false, reason: "already-signed" });
    expect(mocks.updateAttendee).not.toHaveBeenCalled();
  });

  it.each(["used", "rotated", "wrong-email", "expired"])("refuses a %s guest token under the lock", async (change) => {
    const { group, guestInput } = groupSetup();
    if (change === "used") group.attendees[1].inviteUsedAt = now;
    if (change === "rotated") group.attendees[1].inviteTokenHash = hashInviteToken("new-token");
    if (change === "wrong-email") group.attendees[1].email = "someone@example.com";
    if (change === "expired") group.attendees[1].inviteExpiresAt = now;
    expect(await signWaiver(guestInput)).toEqual({ ok: false, reason: "invalid-invite" });
    expect(mocks.updateAttendee).not.toHaveBeenCalled();
  });

  it("does not unlock payment when another attendee's waiver was revoked", async () => {
    const { group, guestInput } = groupSetup();
    Object.assign(group.waiver, { revokedAt: now });
    expect((await signWaiver(guestInput)).ok).toBe(true);
    expect(group.status).toBe("HOLD");
  });
});

describe("atomic invitation signing with a new waiver", () => {
  it("creates evidence and attaches the account while consuming the current token", async () => {
    mocks.waivers.mockResolvedValue([]);
    expect(await signWaiver(input)).toEqual({ ok: true, waiverId: "new-waiver" });
    expect(mocks.createWaiver).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ participantId: "participant", signerUserId: "student" }),
    }));
    expect(mocks.updateBooking).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        waiverId: "new-waiver", accountId: "student", participantId: "participant", status: "AWAITING_PAYMENT",
      }),
    }));
    expect(mocks.consume).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("cleans the staged PDF if the coach rotates the token while it renders", async () => {
    mocks.waivers.mockResolvedValue([]);
    mocks.render.mockImplementation(async () => {
      mocks.invite.mockResolvedValue({ ...invite, tokenHash: hashInviteToken("fresh-token") });
      return Buffer.from("mock-pdf");
    });
    expect(await signWaiver(input)).toEqual({ ok: false, reason: "invalid-invite" });
    expect(mocks.updateBooking).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith("waivers/test.pdf");
  });

  it("cannot confirm a package after its hold expires while rendering the PDF", async () => {
    const expiry = new Date(now.getTime() + 30 * 60_000);
    const pending = { ...input.booking, headcount: 1, status: "HOLD", paymentPlan: "PACKAGE", holdExpiresAt: expiry };
    mocks.waivers.mockResolvedValue([]);
    mocks.render.mockImplementation(async () => {
      vi.setSystemTime(new Date(expiry.getTime() + 1));
      return Buffer.from("mock-pdf");
    });
    mocks.currentBooking.mockResolvedValue(pending);
    mocks.updateBooking.mockImplementation(async ({ where }) => ({ count:
      where.OR?.some((condition: { status: string; holdExpiresAt: { gt: Date } | null }) =>
        condition.status === pending.status && condition.holdExpiresAt && expiry > condition.holdExpiresAt.gt) ? 1 : 0 }));
    expect(await signWaiver({ ...input, booking: pending as LoadedBooking, inviteToken: undefined }))
      .toEqual({ ok: false, reason: "expired" });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith("waivers/test.pdf");
  });
});
afterEach(() => vi.useRealTimers());

describe("atomic invitation signing with a reusable waiver", () => {
  it("links the student and consumes the token in the same waiver transaction", async () => {
    expect(await signWaiver(input)).toEqual({ ok: true, waiverId: "existing-waiver" });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.updateBooking).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        waiverId: "existing-waiver", status: "AWAITING_PAYMENT", accountId: "student",
        participantId: "participant", participantNameSnapshot: "Student",
      }),
    }));
    expect(mocks.consume).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookingId: "booking", tokenHash: hashInviteToken(token), usedAt: null },
      data: { usedAt: now },
    }));
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it.each([
    { tokenHash: hashInviteToken("reissued-token") },
    { usedAt: now },
    { expiresAt: now },
    { email: "different-student@example.com" },
  ])("refuses an invite that changed after the route's initial check", async (changes) => {
    mocks.invite.mockResolvedValue({ ...invite, ...changes });
    expect(await signWaiver(input)).toEqual({ ok: false, reason: "invalid-invite" });
    expect(mocks.updateBooking).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("does not attach an account or consume the invitation after cancellation", async () => {
    mocks.updateBooking.mockResolvedValue({ count: 0 });
    mocks.currentBooking.mockResolvedValue({
      status: "CANCELLED", waiverId: null, holdExpiresAt: null,
    });
    expect(await signWaiver(input)).toEqual({ ok: false, reason: "already-signed" });
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});
