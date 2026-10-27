import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ profile: vi.fn(), days: vi.fn(), bookings: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { coachProfile: { findUnique: db.profile },
  coachDay: { findMany: db.days }, booking: { findMany: db.bookings } } }));
import { getAvailability } from "./availability";
import { dateKeyToDbDate, torontoWallTimeToUtc } from "./time";

const now = new Date("2026-11-20T15:00:00Z");
const dateKey = "2026-12-20";
const booking = { coachDayId: "day", startAt: torontoWallTimeToUtc(dateKey, 9),
  endAt: torontoWallTimeToUtc(dateKey, 11), status: "HOLD", holdExpiresAt: now };
beforeEach(() => {
  vi.resetAllMocks();
  db.profile.mockResolvedValue({ minHours: 2, maxHours: 4, leadTimeHours: 0, extraPersonCents: 2000, maxGroupSize: 3 });
  db.days.mockResolvedValue([{ id: "day", date: dateKeyToDbDate(dateKey), startHour: 9, endHour: 12,
    breakStartHour: null, breakEndHour: null, resort: { id: "resort", slug: "blue-mountain", nameEn: "Blue Mountain", nameZh: "蓝山" } }]);
  db.bookings.mockResolvedValue([booking]);
});
const load = () => getAvailability({ coachId: "coach", from: dateKey, to: dateKey, now });

describe("availability and hold deadlines", () => {
  it.each(["HOLD", "AWAITING_WAIVER", "AWAITING_PAYMENT"])("releases elapsed %s time without needing a sweeper", async (status) => {
    db.bookings.mockResolvedValue([{ ...booking, status }]);
    expect((await load())[0].startOptions.map((s) => s.hour)).toEqual([9, 10]);
  });
  it("keeps a live pending hold occupied", async () => {
    db.bookings.mockResolvedValue([{ ...booking, holdExpiresAt: new Date(now.getTime() + 1) }]);
    expect((await load())[0].startOptions).toEqual([]);
  });
  it.each(["PENDING_PAYMENT_REVIEW", "PAYMENT_REJECTED", "CONFIRMED"])("does not release %s after its original hold deadline", async (status) => {
    db.bookings.mockResolvedValue([{ ...booking, status }]);
    expect((await load())[0].startOptions).toEqual([]);
  });
  it("preserves a coach's legacy arrangement without a deadline", async () => {
    db.bookings.mockResolvedValue([{ ...booking, status: "AWAITING_WAIVER", holdExpiresAt: null }]);
    expect((await load())[0].startOptions).toEqual([]);
  });
});
