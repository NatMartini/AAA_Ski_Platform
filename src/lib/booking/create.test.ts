import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  coachProfile: { findUnique: vi.fn() },
  coachDay: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("../prisma", () => ({ prisma: db }));

import { createBooking } from "./create";
import { hashInviteToken } from "../waiver/invite";

const now = new Date("2026-11-20T15:00:00Z");
const input = {
  coachId: "coach",
  dateKey: "2026-12-20",
  startHour: 9,
  hours: 2,
  lessonType: "riding",
  locale: "en" as const,
  account: {
    id: "student",
    email: "student@example.com",
    participantId: "participant",
    participantName: "Student",
    participantIsMinor: false,
  },
  now,
};

const profile = {
  userId: "coach",
  displayName: "Coach",
  isPublished: true,
  cancellationPolicyEn: "Contact the coach before cancelling.",
  cancellationPolicyZh: "取消前请联系教练。",
  emtEnabled: true,
  emtEmail: "coach@example.com",
  wechatPayEnabled: false,
  alipayEnabled: false,
  contactEmail: "coach@example.com",
  contactPhone: null,
  wechatId: null,
  maxGroupSize: 3,
  teachableSkills: ["wedge"],
  extraPersonCents: 2000,
  minHours: 2,
  maxHours: 8,
  leadTimeHours: 24,
  rates: [{ lessonType: "riding", regularCents: 6000, earlyBirdCents: 5000 }],
};

const day = {
  id: "day",
  resortId: "resort",
  startHour: 9,
  endHour: 16,
  breakStartHour: 13,
  breakEndHour: 14,
  resort: { nameEn: "Blue Mountain", nameZh: "蓝山", isActive: true },
};

const tx = {
  booking: { updateMany: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  waiver: { findMany: vi.fn() },
};

beforeEach(() => {
  vi.resetAllMocks();
  db.coachProfile.findUnique.mockResolvedValue(profile);
  db.coachDay.findUnique.mockResolvedValue(day);
  tx.booking.updateMany.mockResolvedValue({ count: 0 });
  tx.booking.findMany.mockResolvedValue([]);
  tx.waiver.findMany.mockResolvedValue([]);
  tx.booking.create.mockImplementation(async ({ data }) => ({
    id: "booking",
    code: "SKI-TEST",
    status: data.status,
    attendees: (data.attendees?.create ?? []).map((a: { ordinal: number }) => ({ id: `attendee-${a.ordinal}`, ordinal: a.ordinal })),
  }));
  db.$transaction.mockImplementation(async (fn) => fn(tx));
});

describe("createBooking readiness", () => {
  it.each([
    ["unpublished", { isPublished: false }],
    ["missing cancellation terms", { cancellationPolicyEn: " " }],
    ["no payment destination", { emtEmail: null }],
  ])("rejects a self-serve booking for a coach who is %s", async (_, changes) => {
    db.coachProfile.findUnique.mockResolvedValue({ ...profile, ...changes });

    expect(await createBooking(input)).toEqual({
      ok: false,
      reason: "coach-unavailable",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("does not reserve an old availability day at an inactive resort", async () => {
    db.coachDay.findUnique.mockResolvedValue({
      ...day,
      resort: { ...day.resort, isActive: false },
    });

    expect(await createBooking(input)).toEqual({ ok: false, reason: "no-such-day" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("keeps coach-created private arrangements available before publication", async () => {
    db.coachProfile.findUnique.mockResolvedValue({ ...profile, isPublished: false });

    const result = await createBooking({
      ...input,
      account: undefined,
      invite: { name: "Student", email: "guardian@example.com", isMinor: true },
    });
    expect(result).toMatchObject({ ok: true, nextStep: "waiver" });
    if (!result.ok) throw new Error("Expected the coach booking to succeed");
    expect(tx.booking.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "AWAITING_WAIVER",
        holdExpiresAt: null,
        inviteIsMinor: true,
      }),
    }));
    const data = tx.booking.create.mock.calls[0][0].data;
    expect(data.waiverInvite.create).toMatchObject({
      email: "guardian@example.com",
      tokenHash: hashInviteToken(result.inviteToken!),
      expiresAt: result.inviteExpiresAt,
    });
    expect(JSON.stringify(data)).not.toContain(result.inviteToken!);
  });

  it("creates a ready self-serve booking with the original 30-minute deadline", async () => {
    expect(await createBooking(input)).toMatchObject({ ok: true, nextStep: "waiver" });
    expect(tx.booking.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "HOLD",
        holdExpiresAt: new Date("2026-11-20T15:30:00Z"),
        participantId: "participant",
      }),
    }));
  });
});

describe("individual group booking records", () => {
  const extras = [{ fullName: "Guest", email: "guest@example.com", isMinor: false }];
  it("freezes group pricing and keeps all signatures pending under a 24-hour hold", async () => {
    tx.waiver.findMany.mockResolvedValue([{ id: "primary-waiver", season: "2026-27", templateVersion: 1,
      participantWasMinor: false, revokedAt: null, signedAt: now }]);
    const result = await createBooking({ ...input, headcount: 2, additionalAttendees: extras });
    expect(result).toMatchObject({ ok: true, nextStep: "waiver", holdExpiresAt: new Date("2026-11-21T15:00:00Z") });
    if (!result.ok) throw new Error("Expected group create");
    const data = tx.booking.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "HOLD", headcount: 2, hourlyRateCents: 5000, extraPersonCents: 2000,
      subtotalCents: 14000, totalCents: 12500, accountId: "student" });
    expect(data.attendees.create).toHaveLength(2);
    expect(data.attendees.create[0]).toMatchObject({ ordinal: 1, accountId: "student", participantId: "participant" });
    const invite = result.attendeeInvites![0];
    expect(invite).toMatchObject({ attendeeId: "attendee-2", ordinal: 2, email: "guest@example.com" });
    expect(data.attendees.create[1].inviteTokenHash).toBe(hashInviteToken(invite.token));
    expect(JSON.stringify(data)).not.toContain(invite.token);
  });

  it("allows different children to share their guardian's signing email", async () => {
    const result = await createBooking({ ...input, headcount: 3, additionalAttendees: [
      { fullName: "Child A", email: "guardian@example.com", isMinor: true },
      { fullName: "Child B", email: "guardian@example.com", isMinor: true },
    ] });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("Expected group create");
    expect(new Set(result.attendeeInvites!.map((a) => a.token)).size).toBe(2);
  });

  it.each([
    { headcount: 3, additionalAttendees: extras },
    { headcount: 2, additionalAttendees: [{ fullName: " Student ", email: "STUDENT@example.com", isMinor: false }] },
    { headcount: 2, additionalAttendees: extras, paymentPlan: "PACKAGE" as const, packageId: "pkg" },
  ])("rejects incomplete, duplicate or package groups", async (changes) => {
    expect(await createBooking({ ...input, ...changes })).toEqual({ ok: false, reason: "group-booking-unavailable" });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it("rejects a coach's group cap without silently changing the headcount", async () => {
    db.coachProfile.findUnique.mockResolvedValue({ ...profile, maxGroupSize: 1 });
    expect(await createBooking({ ...input, headcount: 2, additionalAttendees: extras })).toEqual({ ok: false, reason: "group-booking-unavailable" });
  });

  it("gives coach-created group invitations only until the day before the lesson", async () => {
    const result = await createBooking({ ...input, account: undefined,
      invite: { name: "Student", email: "student@example.com", isMinor: false },
      headcount: 2, additionalAttendees: extras });
    expect(result).toMatchObject({ ok: true, holdExpiresAt: new Date("2026-12-19T14:10:00Z") });
    if (!result.ok) throw new Error("Expected group create");
    expect(result.attendeeInvites).toHaveLength(2);
    // The signing tokens retain the shorter seven-day TTL and cannot outlive the slot.
    expect(result.attendeeInvites!.every((a) => a.expiresAt <= result.holdExpiresAt!)).toBe(true);
  });
});

describe("coach custom focus snapshots", () => {
  const id = "8bd59265-c856-4334-83fd-c5d0c4b91b21";
  const key = `custom:${id}`;
  it("freezes the chosen coach's custom labels alongside historical builtin preferences", async () => {
    db.coachProfile.findUnique.mockResolvedValue({ ...profile, customSkills: [{ id, key, zh: "教练自定义动作", en: "Coach custom focus" }] });
    expect((await createBooking({ ...input, requestedSkills: [key, "wedge"] })).ok).toBe(true);
    const data = tx.booking.create.mock.calls[0][0].data;
    expect(data.requestedSkills).toEqual([key, "wedge"]);
    expect(data.requestedSkillsSnapshot).toContainEqual({ key, zh: "教练自定义动作", en: "Coach custom focus" });
  });
  it("refuses a foreign or removed custom focus before reserving a slot", async () => {
    expect(await createBooking({ ...input, requestedSkills: [key] })).toEqual({ ok: false, reason: "invalid-requested-skills" });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });
  it.each(["spin_360", "parallel"])("rejects unsupported builtin %s even when the slot is available", async (skill) => {
    expect(await createBooking({ ...input, requestedSkills: ["wedge", skill] })).toEqual({ ok: false, reason: "invalid-requested-skills" });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.booking.create).not.toHaveBeenCalled();
  });
  it("rechecks a stale coach selection after the coach removes the requested action", async () => {
    db.coachProfile.findUnique.mockResolvedValue({ ...profile, teachableSkills: [] });
    expect(await createBooking({ ...input, requestedSkills: ["wedge"] })).toEqual({ ok: false, reason: "invalid-requested-skills" });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });
  it("rejects unsupported actions in coach-created lessons too", async () => {
    expect(await createBooking({ ...input, account: undefined,
      invite: { name: "Student", email: "student@example.com", isMinor: false }, requestedSkills: ["spin_360"] }))
      .toEqual({ ok: false, reason: "invalid-requested-skills" });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });
});
