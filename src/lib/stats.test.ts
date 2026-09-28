import { describe, expect, it } from "vitest";
import {
  packageHoursLeftByAccount,
  seasonMonths,
  seasonStats,
  studentBalances,
  type StatBooking,
  type StatPackage,
} from "./stats";
import { torontoWallTimeToUtc } from "./time";

const KEVIN = "kevin";
const ALISA = "alisa";
const NOW = new Date("2027-01-15T12:00:00Z");

let seq = 0;
function booking(over: Partial<StatBooking> = {}): StatBooking {
  const startAt = over.startAt ?? torontoWallTimeToUtc("2027-01-10", 9);
  const hours = over.hours ?? 2;
  return {
    code: `SKI-${++seq}`,
    coachId: KEVIN,
    accountId: "wei",
    participantName: "Wei Zhang",
    status: "CONFIRMED",
    paymentPlan: "FULL",
    lessonType: "riding",
    resortId: "blue",
    earlyBird: true,
    hours,
    startAt,
    endAt: new Date(startAt.getTime() + hours * 3_600_000),
    totalCents: 11000,
    amountPaidCents: 11000,
    holdExpiresAt: null,
    ...over,
  };
}

function pkg(over: Partial<StatPackage> = {}): StatPackage {
  return {
    code: "PKG-1",
    accountId: "wei",
    payeeCoachId: ALISA,
    status: "ACTIVE",
    season: "2026-27",
    hours: 4,
    priceCents: 18000,
    bookings: [],
    ...over,
  };
}

describe("packageHoursLeftByAccount", () => {
  it("adds up hours left across paid-up packages, whoever was paid", () => {
    const left = packageHoursLeftByAccount(
      [
        pkg({
          payeeCoachId: KEVIN,
          bookings: [{ coachId: ALISA, hours: 2, status: "CONFIRMED", holdExpiresAt: null }],
        }),
        pkg({ code: "PKG-2", payeeCoachId: ALISA }),
        pkg({ code: "PKG-3", accountId: "lin", status: "PENDING_PAYMENT_REVIEW" }),
      ],
      NOW,
    );
    expect(left.get("wei")).toBe(6);
    // An unpaid package has no hours to spend yet.
    expect(left.has("lin")).toBe(false);
  });

  it("hands back hours from a hold that ran out", () => {
    const left = packageHoursLeftByAccount(
      [
        pkg({
          bookings: [
            {
              coachId: KEVIN,
              hours: 2,
              status: "HOLD",
              holdExpiresAt: new Date("2027-01-15T11:00:00Z"),
            },
          ],
        }),
      ],
      NOW,
    );
    expect(left.get("wei")).toBe(4);
  });
});

describe("studentBalances", () => {
  it("counts a paid-up package as paid", () => {
    const [wei] = studentBalances([], [pkg()], NOW);
    expect(wei).toMatchObject({ paidCents: 18000, owedCents: 0 });
  });

  it("counts a deposit balance and an unpaid booking as owed", () => {
    const [wei] = studentBalances(
      [
        booking({ paymentPlan: "DEPOSIT", totalCents: 11000, amountPaidCents: 6000 }),
        booking({
          status: "AWAITING_PAYMENT",
          amountPaidCents: 0,
          startAt: torontoWallTimeToUtc("2027-02-01", 9),
          holdExpiresAt: new Date("2027-01-15T12:20:00Z"),
        }),
      ],
      [],
      NOW,
    );
    expect(wei.owedCents).toBe(5000 + 11000);
    expect(wei.paidCents).toBe(6000);
  });

  it("forgets a hold that has run out and a cancelled booking", () => {
    const [wei] = studentBalances(
      [
        booking({
          status: "HOLD",
          amountPaidCents: 0,
          holdExpiresAt: new Date("2027-01-15T11:00:00Z"),
        }),
        booking({ status: "CANCELLED", amountPaidCents: 11000 }),
      ],
      [],
      NOW,
    );
    expect(wei.owedCents).toBe(0);
    expect(wei.paidCents).toBe(0);
    expect(wei.lessonCount).toBe(0);
  });

  it("splits lesson hours into taken and upcoming", () => {
    const [wei] = studentBalances(
      [
        booking({ startAt: torontoWallTimeToUtc("2027-01-10", 9) }),
        booking({ startAt: torontoWallTimeToUtc("2027-02-10", 9), hours: 3 }),
      ],
      [],
      NOW,
    );
    expect(wei).toMatchObject({ lessonCount: 2, hoursTaken: 2, hoursUpcoming: 3 });
    expect(wei.nextLessonAt?.toISOString()).toBe(
      torontoWallTimeToUtc("2027-02-10", 9).toISOString(),
    );
  });

  it("counts an unpaid package order as owed, not paid", () => {
    const [wei] = studentBalances([], [pkg({ status: "PENDING_PAYMENT_REVIEW" })], NOW);
    expect(wei).toMatchObject({ owedCents: 18000, paidCents: 0 });
  });

  it("leaves out bookings with no account yet", () => {
    expect(studentBalances([booking({ accountId: null })], [], NOW)).toEqual([]);
  });
});

describe("seasonStats", () => {
  it("covers December to May", () => {
    expect(seasonMonths("2026-27")).toEqual([
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
      "2027-05",
    ]);
  });

  it("adds up one coach's season", () => {
    const stats = seasonStats({
      season: "2026-27",
      now: NOW,
      bookings: [
        booking(), // taught, early bird, $110
        booking({
          paymentPlan: "PACKAGE",
          totalCents: 0,
          amountPaidCents: 0,
          earlyBird: false,
          startAt: torontoWallTimeToUtc("2027-02-10", 9),
        }), // upcoming, from a package
        booking({
          earlyBird: false,
          lessonType: "park",
          totalCents: 17000,
          amountPaidCents: 9000,
          paymentPlan: "DEPOSIT",
          startAt: torontoWallTimeToUtc("2026-12-20", 10),
        }), // taught, regular, balance owing
        booking({ status: "PENDING_PAYMENT_REVIEW", amountPaidCents: 0 }),
        booking({ startAt: torontoWallTimeToUtc("2027-12-10", 9) }), // next season
      ],
      packages: [
        pkg({
          payeeCoachId: KEVIN,
          bookings: [{ coachId: ALISA, hours: 2, status: "CONFIRMED", holdExpiresAt: null }],
        }),
        pkg({ code: "PKG-2", season: "2025-26" }),
      ],
    });

    expect(stats).toMatchObject({
      lessonCount: 3,
      hoursTaught: 4,
      hoursScheduled: 2,
      studentCount: 1,
      receivedCents: 11000 + 9000 + 18000,
      owedCents: 8000 + 11000,
      awaitingReviewCents: 11000,
      packagesSold: 1,
      packageHoursLeft: 2,
      packageValueLeftCents: 9000,
      earlyBirdHours: 2,
      regularHours: 2,
      packageHours: 2,
    });
    expect(stats.byLessonType.map((l) => l.key)).toEqual(["riding", "park"]);
    expect(stats.months.map((m) => m.hours)).toEqual([2, 2, 2, 0, 0, 0]);
  });

  it("gives every month of the season a line, even with nothing booked", () => {
    const stats = seasonStats({ season: "2026-27", now: NOW, bookings: [], packages: [] });
    expect(stats.months).toHaveLength(6);
    expect(stats.lessonCount).toBe(0);
  });
});
