import { describe, expect, it } from "vitest";
import {
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

describe("studentBalances", () => {
  it("shows package hours left and what they are worth", () => {
    const [wei] = studentBalances(
      [],
      [
        pkg({
          bookings: [{ coachId: KEVIN, hours: 2, status: "CONFIRMED", holdExpiresAt: null }],
        }),
      ],
      NOW,
    );
    expect(wei).toMatchObject({
      packageHoursLeft: 2,
      packageValueLeftCents: 9000,
      paidCents: 18000,
      owedCents: 0,
    });
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
    expect(wei).toMatchObject({ owedCents: 18000, paidCents: 0, packageHoursLeft: 0 });
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

  it("adds up a season across both coaches", () => {
    const stats = seasonStats({
      season: "2026-27",
      coachIds: [ALISA, KEVIN],
      now: NOW,
      bookings: [
        booking(), // Kevin, taught, early bird, $110
        booking({
          coachId: ALISA,
          paymentPlan: "PACKAGE",
          totalCents: 0,
          amountPaidCents: 0,
          earlyBird: false,
          startAt: torontoWallTimeToUtc("2027-02-10", 9),
        }), // Alisa, upcoming, package
        booking({
          earlyBird: false,
          lessonType: "park",
          totalCents: 17000,
          amountPaidCents: 9000,
          paymentPlan: "DEPOSIT",
          startAt: torontoWallTimeToUtc("2026-12-20", 10),
        }), // Kevin, taught, regular, balance owing
        booking({ status: "PENDING_PAYMENT_REVIEW", amountPaidCents: 0 }),
        booking({ startAt: torontoWallTimeToUtc("2027-12-10", 9) }), // next season
      ],
      packages: [
        pkg({
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

    const kevin = stats.byCoach.find((l) => l.coachId === KEVIN)!;
    const alisa = stats.byCoach.find((l) => l.coachId === ALISA)!;
    expect(kevin).toMatchObject({ lessonCount: 2, hours: 4, lessonReceivedCents: 20000 });
    expect(alisa).toMatchObject({
      lessonCount: 1,
      hours: 2,
      packageHours: 2,
      packageReceivedCents: 18000,
    });

    expect(stats.byLessonType.map((l) => l.key)).toEqual(["riding", "park"]);
    expect(stats.months.find((m) => m.month === "2026-12")?.hoursByCoach).toEqual({
      [ALISA]: 0,
      [KEVIN]: 2,
    });
    expect(stats.months.find((m) => m.month === "2027-02")?.hoursByCoach[ALISA]).toBe(2);
  });

  it("keeps a coach with nothing booked on the list, in the given order", () => {
    const stats = seasonStats({
      season: "2026-27",
      coachIds: [ALISA, KEVIN],
      now: NOW,
      bookings: [booking()],
      packages: [],
    });
    expect(stats.byCoach.map((l) => l.coachId)).toEqual([ALISA, KEVIN]);
    expect(stats.byCoach[0].hours).toBe(0);
  });
});
