import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateLimitOrRespond: vi.fn(),
  requireCoach: vi.fn(),
  findUnique: vi.fn(),
  countBookings: vi.fn(),
  deleteDay: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimitOrRespond: mocks.rateLimitOrRespond,
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireCoach: mocks.requireCoach,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    coachDay: {
      findUnique: mocks.findUnique,
      delete: mocks.deleteDay,
    },
    booking: {
      count: mocks.countBookings,
    },
  },
}));

import { DELETE } from "./route";

describe("DELETE /api/coach/availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimitOrRespond.mockReturnValue(null);
    mocks.requireCoach.mockResolvedValue({
      ok: true,
      user: { id: "coach-1" },
    });
    mocks.findUnique.mockResolvedValue({
      id: "day-1",
      coachId: "coach-1",
    });
    mocks.countBookings.mockResolvedValue(0);
    mocks.deleteDay.mockResolvedValue({ id: "day-1" });
  });

  it("refuses deletion when the day has any booking, regardless of status", async () => {
    mocks.countBookings.mockResolvedValue(1);

    const response = await DELETE(
      new Request("http://localhost/api/coach/availability?id=day-1", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "has-bookings",
      count: 1,
    });
    expect(mocks.countBookings).toHaveBeenCalledWith({
      where: { coachDayId: "day-1" },
    });
    expect(mocks.deleteDay).not.toHaveBeenCalled();
  });

  it("deletes an owned day that has never had a booking", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/coach/availability?id=day-1", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.deleteDay).toHaveBeenCalledWith({ where: { id: "day-1" } });
  });

  it("returns a conflict when the restrictive FK catches a concurrent booking", async () => {
    mocks.countBookings
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    mocks.deleteDay.mockRejectedValue({ code: "P2003" });

    const response = await DELETE(
      new Request("http://localhost/api/coach/availability?id=day-1", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "has-bookings",
      count: 1,
    });
    expect(mocks.countBookings).toHaveBeenCalledTimes(2);
  });
});
