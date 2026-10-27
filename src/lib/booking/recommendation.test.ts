import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ profiles: vi.fn(), days: vi.fn(), bookings: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: { coachProfile: { findMany: db.profiles },
  coachDay: { findMany: db.days }, booking: { findMany: db.bookings } } }));
import { listResortBookingDays, recommendCoaches } from "./recommendation";
import { dateKeyToDbDate, torontoWallTimeToUtc } from "../time";

const now = new Date("2026-11-20T15:00:00Z");
const dateKey = "2026-12-20";
const request = { resortSlug: "blue-mountain", dateKey, startHour: 9, hours: 2 };
function profile(id: string, changes = {}) {
  return { id: `profile-${id}`, userId: id, displayName: id, isPublished: true,
    user: { id, name: id, image: null }, rates: [{ lessonType: "riding", regularCents: 8000, earlyBirdCents: 7000 }],
    minHours: 2, maxHours: 4, leadTimeHours: 24, maxGroupSize: 3, teachableLevels: ["beginner"],
    teachableSkills: ["wedge"], customSkills: [], cancellationPolicyEn: "Cancel policy", cancellationPolicyZh: "取消规则",
    emtEnabled: true, emtEmail: `${id}@example.com`, wechatPayEnabled: false, alipayEnabled: false,
    ...changes };
}
function day(id: string, changes = {}) {
  return { id: `day-${id}`, coachId: id, date: dateKeyToDbDate(dateKey), resort: { slug: "blue-mountain", isActive: true },
    startHour: 9, endHour: 16, breakStartHour: 13, breakEndHour: 14, bookings: [], ...changes };
}
const range = (start: number, end: number, changes = {}) => ({
  startAt: torontoWallTimeToUtc(dateKey, start), endAt: torontoWallTimeToUtc(dateKey, end),
  status: "CONFIRMED", holdExpiresAt: null, ...changes,
});
const commitment = (coachId: string, hours: number, changes = {}) => ({
  coachId, hours, status: "CONFIRMED", holdExpiresAt: null,
  lessonStartAt: torontoWallTimeToUtc(dateKey, 9), ...changes,
});
beforeEach(() => {
  vi.resetAllMocks(); db.profiles.mockResolvedValue([profile("kevin"), profile("alisa")]);
  db.days.mockResolvedValue([day("kevin"), day("alisa")]); db.bookings.mockResolvedValue([]);
});

describe("resort time choices", () => {
  it("retains the eligible coach list for every actual duration", async () => {
    db.profiles.mockResolvedValue([profile("kevin"), profile("alisa", { maxHours: 2 })]);
    const days = await listResortBookingDays("blue-mountain", now);
    expect(days).toHaveLength(1);
    const morning = days[0].startOptions.find((s) => s.hour === 9)!;
    expect(morning.durations).toEqual([2, 3, 4]);
    expect(morning.coachIdsByDuration).toEqual({ 2: ["alisa", "kevin"], 3: ["kevin"], 4: ["kevin"] });
    expect(days[0].startOptions.some((s) => s.hour === 12 || s.hour === 13)).toBe(false);
  });
  it("does not join different coaches' adjacent availability into a phantom long lesson", async () => {
    db.days.mockResolvedValue([day("kevin", { endHour: 11 }), day("alisa", { startHour: 11, endHour: 13 })]);
    const days = await listResortBookingDays("blue-mountain", now);
    expect(days[0].startOptions.map((s) => [s.hour, s.durations])).toEqual([[9, [2]], [11, [2]]]);
  });
  it("omits sold-out, inactive, wrong-resort and off-season days", async () => {
    db.days.mockResolvedValue([
      day("kevin", { bookings: [range(9, 16)] }),
      day("alisa", { resort: { slug: "blue-mountain", isActive: false } }),
      day("alisa", { resort: { slug: "msl", isActive: true } }),
      day("alisa", { date: dateKeyToDbDate("2026-07-20") }),
    ]);
    expect(await listResortBookingDays("blue-mountain", now)).toEqual([]);
  });
  it("ignores elapsed holds while keeping rejected proof and submitted proof occupied", async () => {
    db.days.mockResolvedValue([day("kevin", { bookings: [range(9, 11, { status: "HOLD", holdExpiresAt: now })] }),
      day("alisa", { bookings: [range(9, 11, { status: "PAYMENT_REJECTED", holdExpiresAt: now })] })]);
    const days = await listResortBookingDays("blue-mountain", now);
    expect(days[0].startOptions.find((s) => s.hour === 9)!.coachIdsByDuration[2]).toEqual(["kevin"]);
  });
  it("applies each coach's notice period, using Toronto wall time", async () => {
    db.profiles.mockResolvedValue([profile("kevin", { leadTimeHours: 24 }), profile("alisa", { leadTimeHours: 0 })]);
    const shortlyBefore = torontoWallTimeToUtc(dateKey, 8);
    const days = await listResortBookingDays("blue-mountain", shortlyBefore);
    expect(days[0].coachIds).toEqual(["alisa"]);
    expect(db.days.mock.calls[0][0].where.date.gte).toEqual(dateKeyToDbDate(dateKey));
  });
});

describe("exact-time recommendations and teaching-hour balance", () => {
  it("does not recommend a coach booked at the selected time even if their season load is lower", async () => {
    db.days.mockResolvedValue([day("kevin", { bookings: [range(9, 11)] }), day("alisa")]);
    db.bookings.mockResolvedValue([commitment("alisa", 8)]);
    const coaches = await recommendCoaches(request, "student", now);
    expect(coaches.map((c) => c.userId)).toEqual(["alisa"]);
    expect(coaches[0]).toMatchObject({ recommended: true, bookedHours: 8 });
  });
  it("uses hours rather than booking counts and never forces an intermediate level to Kevin", async () => {
    db.profiles.mockResolvedValue([profile("kevin", { teachableLevels: ["intermediate"] }), profile("alisa")]);
    db.bookings.mockResolvedValue([commitment("kevin", 8), commitment("alisa", 2), commitment("alisa", 2)]);
    const coaches = await recommendCoaches({ ...request, level: "intermediate" }, "student", now);
    expect(coaches.map((c) => c.userId)).toEqual(["alisa", "kevin"]);
    expect(coaches[0]).toMatchObject({ bookedHours: 4, levelMatch: "unlisted", recommended: true });
    expect(coaches[1]).toMatchObject({ bookedHours: 8, levelMatch: "listed", recommended: false });
  });
  it("counts completed teaching in this season but excludes cancelled, expired, elapsed holds and other seasons", async () => {
    db.bookings.mockResolvedValue([
      commitment("kevin", 6, { status: "COMPLETED" }),
      commitment("alisa", 2), commitment("alisa", 20, { status: "CANCELLED" }),
      commitment("alisa", 20, { status: "EXPIRED" }), commitment("alisa", 20, { status: "HOLD", holdExpiresAt: now }),
      commitment("alisa", 20, { status: "AWAITING_WAIVER", holdExpiresAt: now }),
      commitment("alisa", 20, { lessonStartAt: new Date("2025-12-20T14:10:00Z") }),
    ]);
    const coaches = await recommendCoaches(request, undefined, now);
    expect(coaches.map((c) => [c.userId, c.bookedHours])).toEqual([["alisa", 2], ["kevin", 6]]);
  });
  it("keeps a stable tie for the same request but distributes equal-load requests across both coaches", async () => {
    const winners = new Set<string>();
    for (let i = 0; i < 20; i++) winners.add((await recommendCoaches(request, `student-${i}`, now))[0].userId);
    expect(winners).toEqual(new Set(["kevin", "alisa"]));
    expect((await recommendCoaches(request, "student-5", now)).map((c) => c.userId))
      .toEqual((await recommendCoaches(request, "student-5", now)).map((c) => c.userId));
  });
  it("filters exact lesson rates and group size while leaving unknown ability lists visible", async () => {
    db.profiles.mockResolvedValue([profile("kevin", { maxGroupSize: 1 }), profile("alisa", { teachableLevels: [] })]);
    expect((await recommendCoaches({ ...request, headcount: 2, lessonType: "riding", level: "intermediate" }, undefined, now))
      .map((c) => [c.userId, c.levelMatch])).toEqual([["alisa", "unknown"]]);
    expect(await recommendCoaches({ ...request, lessonType: "not-priced" }, undefined, now)).toEqual([]);
  });
  it("prioritizes all requested actions over a lighter schedule", async () => {
    db.profiles.mockResolvedValue([profile("kevin", { teachableSkills: ["wedge", "spin_360"] }), profile("alisa")]);
    db.bookings.mockResolvedValue([commitment("kevin", 8)]);
    const coaches = await recommendCoaches({ ...request, skills: ["wedge", "spin_360"] }, undefined, now);
    expect(coaches).toHaveLength(1);
    expect(coaches[0]).toMatchObject({ userId: "kevin", recommended: true, bookedHours: 8,
      matchedSkills: ["wedge", "spin_360"], unmatchedSkills: [] });
  });
  it("returns no match when different coaches cover different parts of the requested lesson", async () => {
    db.profiles.mockResolvedValue([profile("kevin", { teachableSkills: ["wedge"] }), profile("alisa", { teachableSkills: ["spin_360"] })]);
    expect(await recommendCoaches({ ...request, skills: ["wedge", "spin_360"] }, undefined, now)).toEqual([]);
    expect(db.bookings).not.toHaveBeenCalled();
  });
  it("does not recommend unconfigured builtin skills, but still balances no-focus requests", async () => {
    db.profiles.mockResolvedValue([profile("kevin", { teachableSkills: [] }), profile("alisa")]);
    expect((await recommendCoaches({ ...request, skills: ["wedge"] }, undefined, now)).map((c) => c.userId)).toEqual(["alisa"]);
    expect(await recommendCoaches(request, undefined, now)).toHaveLength(2);
  });
  it("matches explicitly declared legacy park abilities without inferring other park actions", async () => {
    db.profiles.mockResolvedValue([profile("kevin", { teachableSkills: ["park_intro", "box_rail"] }), profile("alisa", { teachableSkills: [] })]);
    db.bookings.mockResolvedValue([commitment("kevin", 8)]);
    const coaches = await recommendCoaches({ ...request, skills: ["jibbing", "box", "rail"] }, undefined, now);
    expect(coaches.map((c) => c.userId)).toEqual(["kevin"]);
    expect(coaches[0]).toMatchObject({ matchedSkills: ["jibbing", "box", "rail"], unmatchedSkills: [] });
    expect(await recommendCoaches({ ...request, skills: ["jibbing", "spin_360"] }, undefined, now)).toEqual([]);
  });
  it("requires the configured owner for custom skills without silently discarding the focus", async () => {
    const id = "8bd59265-c856-4334-83fd-c5d0c4b91b21";
    const key = `custom:${id}`;
    db.profiles.mockResolvedValue([profile("kevin", { customSkills: [{ id, key, zh: "定制动作", en: "Custom focus" }] }), profile("alisa")]);
    expect((await recommendCoaches({ ...request, skills: [key] }, undefined, now)).map((c) => c.userId)).toEqual(["kevin"]);
    expect(await recommendCoaches({ ...request, skills: ["custom:removed"] }, undefined, now)).toEqual([]);
  });
  it.each([
    { dateKey: "2026-02-30" }, { dateKey: "2026-07-01" }, { dateKey: "2025-12-20" },
    { startHour: 9.5 }, { startHour: -1 }, { hours: 0 }, { headcount: 4 },
  ])("refuses malformed or stale time selections", async (changes) => {
    expect(await recommendCoaches({ ...request, ...changes }, undefined, now)).toEqual([]);
  });
});
