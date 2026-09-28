import type { BookingStatus, PackageStatus, PaymentPlan } from "@prisma/client";
import { OCCUPYING_STATUSES } from "./booking/state";
import { isSelfServeHoldExpired } from "./booking/hold";
import { hoursUsed, packageValueCents } from "./packages";
import { parseSeasonStartYear, seasonOf, type Season } from "./season";
import { toDateKey } from "./time";

/**
 * Figures for the coach area: what each student has left and still owes, and
 * how a season went. Pure functions over rows the pages load, so the rules
 * are unit-tested and every page agrees on them.
 *
 * Shared definitions:
 *
 *   lesson    — a CONFIRMED or COMPLETED booking. Holds, unpaid bookings and
 *               cancellations are not lessons.
 *   received  — money a coach has confirmed: amountPaidCents on bookings that
 *               were not cancelled, plus the price of paid-up packages. A
 *               cancelled booking's payment is left out because any refund
 *               happens person to person and is not recorded here.
 *   owed      — what live orders still need from the student: the unpaid part
 *               of every booking that still holds its slot (including deposit
 *               balances after the lesson), plus unpaid package orders.
 */

/** Bookings that count as lessons given or to be given. */
export const LESSON_STATUSES: BookingStatus[] = ["CONFIRMED", "COMPLETED"];

/** Package states where money is expected but not yet confirmed. */
const UNPAID_PACKAGE_STATUSES: PackageStatus[] = [
  "AWAITING_PAYMENT",
  "PENDING_PAYMENT_REVIEW",
  "PAYMENT_REJECTED",
];

export type StatBooking = {
  code: string;
  coachId: string;
  accountId: string | null;
  participantName: string | null;
  status: BookingStatus;
  paymentPlan: PaymentPlan;
  lessonType: string;
  resortId: string;
  earlyBird: boolean;
  hours: number;
  startAt: Date;
  endAt: Date;
  totalCents: number;
  amountPaidCents: number;
  holdExpiresAt: Date | null;
};

export type StatPackage = {
  code: string;
  accountId: string;
  payeeCoachId: string;
  status: PackageStatus;
  season: string;
  hours: number;
  priceCents: number;
  /** Bookings spending this package, in any status. */
  bookings: {
    coachId: string;
    hours: number;
    status: BookingStatus;
    holdExpiresAt: Date | null;
  }[];
};

/** Still holding its slot: occupying, and not a self-serve hold that ran out. */
function isLive(b: StatBooking, now: Date): boolean {
  return OCCUPYING_STATUSES.includes(b.status) && !isSelfServeHoldExpired(b, now);
}

function isLesson(b: StatBooking): boolean {
  return LESSON_STATUSES.includes(b.status);
}

function receivedOn(b: StatBooking): number {
  return b.status === "CANCELLED" ? 0 : b.amountPaidCents;
}

function owedOn(b: StatBooking, now: Date): number {
  if (!isLive(b, now) && b.status !== "COMPLETED") return 0;
  return Math.max(0, b.totalCents - b.amountPaidCents);
}

function packageHoursLeft(p: StatPackage, now: Date): number {
  if (p.status !== "ACTIVE") return 0;
  return Math.max(0, p.hours - hoursUsed(p.bookings, now));
}

// ───────────────────────────── Students ─────────────────────────────

export type StudentBalance = {
  accountId: string;
  /** Unused hours across paid-up packages. */
  packageHoursLeft: number;
  /** Those hours at each package's price per hour. */
  packageValueLeftCents: number;
  /** What live orders still need from this student. */
  owedCents: number;
  /** Money confirmed as received from this student. */
  paidCents: number;
  lessonCount: number;
  /** Lesson hours already over. */
  hoursTaken: number;
  /** Lesson hours still to come. */
  hoursUpcoming: number;
  nextLessonAt: Date | null;
  lastLessonAt: Date | null;
  /** Everyone this account has booked for, most recent first. */
  participantNames: string[];
  /** Coach ids this student has had lessons with. */
  coachIds: string[];
};

/**
 * One line per student account, from their bookings and packages. Bookings a
 * coach made for someone who has not signed in yet have no account and are
 * left out; they appear once the student uses the signing link.
 */
export function studentBalances(
  bookings: StatBooking[],
  packages: StatPackage[],
  now: Date,
): StudentBalance[] {
  const byAccount = new Map<string, StudentBalance>();
  const get = (accountId: string) => {
    let s = byAccount.get(accountId);
    if (!s) {
      s = {
        accountId,
        packageHoursLeft: 0,
        packageValueLeftCents: 0,
        owedCents: 0,
        paidCents: 0,
        lessonCount: 0,
        hoursTaken: 0,
        hoursUpcoming: 0,
        nextLessonAt: null,
        lastLessonAt: null,
        participantNames: [],
        coachIds: [],
      };
      byAccount.set(accountId, s);
    }
    return s;
  };

  const newestFirst = [...bookings].sort(
    (a, b) => b.startAt.getTime() - a.startAt.getTime(),
  );
  for (const b of newestFirst) {
    if (!b.accountId) continue;
    const s = get(b.accountId);
    s.paidCents += receivedOn(b);
    s.owedCents += owedOn(b, now);
    if (b.participantName && !s.participantNames.includes(b.participantName)) {
      s.participantNames.push(b.participantName);
    }
    if (!isLesson(b)) continue;
    s.lessonCount++;
    if (!s.coachIds.includes(b.coachId)) s.coachIds.push(b.coachId);
    if (b.endAt <= now) {
      s.hoursTaken += b.hours;
      if (!s.lastLessonAt || b.startAt > s.lastLessonAt) s.lastLessonAt = b.startAt;
    } else {
      s.hoursUpcoming += b.hours;
      if (!s.nextLessonAt || b.startAt < s.nextLessonAt) s.nextLessonAt = b.startAt;
    }
  }

  for (const p of packages) {
    const s = get(p.accountId);
    if (p.status === "ACTIVE") s.paidCents += p.priceCents;
    if (UNPAID_PACKAGE_STATUSES.includes(p.status)) s.owedCents += p.priceCents;
    const left = packageHoursLeft(p, now);
    s.packageHoursLeft += left;
    s.packageValueLeftCents += packageValueCents(p, left);
  }

  return [...byAccount.values()];
}

// ───────────────────────────── Season ─────────────────────────────

export type CoachLine = {
  coachId: string;
  lessonCount: number;
  hours: number;
  /** Of those hours, how many were paid from a package. */
  packageHours: number;
  /** Money received on this coach's bookings. */
  lessonReceivedCents: number;
  /** Packages this coach was paid for. */
  packageReceivedCents: number;
  owedCents: number;
};

export type Breakdown = {
  key: string;
  lessonCount: number;
  hours: number;
  receivedCents: number;
};

export type MonthLine = {
  /** "2026-12" */
  month: string;
  /** Lesson hours per coach id. */
  hoursByCoach: Record<string, number>;
};

export type SeasonStats = {
  season: Season;
  lessonCount: number;
  hoursTaught: number;
  hoursScheduled: number;
  studentCount: number;
  receivedCents: number;
  owedCents: number;
  /** Proofs uploaded that a coach has not checked yet, bookings and packages. */
  awaitingReviewCents: number;
  packagesSold: number;
  packageReceivedCents: number;
  packageHoursLeft: number;
  packageValueLeftCents: number;
  /** Lesson hours at the early-bird rate, the regular rate, and from packages. */
  earlyBirdHours: number;
  regularHours: number;
  packageHours: number;
  byCoach: CoachLine[];
  byLessonType: Breakdown[];
  byResort: Breakdown[];
  months: MonthLine[];
};

/** The six months of a season, December to May, as "YYYY-MM". */
export function seasonMonths(season: Season): string[] {
  const start = parseSeasonStartYear(season);
  return [
    `${start}-12`,
    ...[1, 2, 3, 4, 5].map((m) => `${start + 1}-${String(m).padStart(2, "0")}`),
  ];
}

/**
 * A season at a glance. Bookings are those whose lesson falls in the season;
 * packages are those sold for it. `coachIds` fixes the coach order, so each
 * coach keeps the same line and colour whatever the numbers do.
 */
export function seasonStats(input: {
  season: Season;
  bookings: StatBooking[];
  packages: StatPackage[];
  coachIds: string[];
  now: Date;
}): SeasonStats {
  const { season, now } = input;
  const bookings = input.bookings.filter((b) => seasonOf(b.startAt) === season);
  const packages = input.packages.filter((p) => p.season === season);
  const lessons = bookings.filter(isLesson);

  const coachLines = new Map<string, CoachLine>(
    input.coachIds.map((coachId) => [
      coachId,
      {
        coachId,
        lessonCount: 0,
        hours: 0,
        packageHours: 0,
        lessonReceivedCents: 0,
        packageReceivedCents: 0,
        owedCents: 0,
      },
    ]),
  );
  const coachLine = (coachId: string) => {
    let line = coachLines.get(coachId);
    if (!line) {
      line = {
        coachId,
        lessonCount: 0,
        hours: 0,
        packageHours: 0,
        lessonReceivedCents: 0,
        packageReceivedCents: 0,
        owedCents: 0,
      };
      coachLines.set(coachId, line);
    }
    return line;
  };

  const breakdown = (rows: StatBooking[], keyOf: (b: StatBooking) => string) => {
    const out = new Map<string, Breakdown>();
    for (const b of rows) {
      const key = keyOf(b);
      const line =
        out.get(key) ?? { key, lessonCount: 0, hours: 0, receivedCents: 0 };
      line.receivedCents += receivedOn(b);
      if (isLesson(b)) {
        line.lessonCount++;
        line.hours += b.hours;
      }
      out.set(key, line);
    }
    return [...out.values()]
      .filter((l) => l.lessonCount > 0 || l.receivedCents > 0)
      .sort((a, b) => b.hours - a.hours);
  };

  const months = new Map<string, MonthLine>(
    seasonMonths(season).map((month) => [
      month,
      {
        month,
        hoursByCoach: Object.fromEntries(input.coachIds.map((id) => [id, 0])),
      },
    ]),
  );

  let hoursTaught = 0;
  let hoursScheduled = 0;
  let earlyBirdHours = 0;
  let regularHours = 0;
  let packageHours = 0;
  const students = new Set<string>();

  for (const b of lessons) {
    if (b.endAt <= now) hoursTaught += b.hours;
    else hoursScheduled += b.hours;
    if (b.paymentPlan === "PACKAGE") packageHours += b.hours;
    else if (b.earlyBird) earlyBirdHours += b.hours;
    else regularHours += b.hours;
    students.add(b.accountId ?? `booking:${b.code}`);

    const line = coachLine(b.coachId);
    line.lessonCount++;
    line.hours += b.hours;
    if (b.paymentPlan === "PACKAGE") line.packageHours += b.hours;

    const month = months.get(toDateKey(b.startAt).slice(0, 7));
    if (month) {
      month.hoursByCoach[b.coachId] =
        (month.hoursByCoach[b.coachId] ?? 0) + b.hours;
    }
  }

  let awaitingReviewCents = 0;
  for (const b of bookings) {
    const line = coachLine(b.coachId);
    line.lessonReceivedCents += receivedOn(b);
    line.owedCents += owedOn(b, now);
    if (b.status === "PENDING_PAYMENT_REVIEW") {
      awaitingReviewCents += Math.max(0, b.totalCents - b.amountPaidCents);
    }
  }

  let packagesSold = 0;
  let packageReceivedCents = 0;
  let packageHoursLeftTotal = 0;
  let packageValueLeftCents = 0;
  let packageOwedCents = 0;
  for (const p of packages) {
    if (p.status === "ACTIVE") {
      packagesSold++;
      packageReceivedCents += p.priceCents;
      coachLine(p.payeeCoachId).packageReceivedCents += p.priceCents;
    }
    if (UNPAID_PACKAGE_STATUSES.includes(p.status)) {
      packageOwedCents += p.priceCents;
      coachLine(p.payeeCoachId).owedCents += p.priceCents;
    }
    if (p.status === "PENDING_PAYMENT_REVIEW") awaitingReviewCents += p.priceCents;
    const left = packageHoursLeft(p, now);
    packageHoursLeftTotal += left;
    packageValueLeftCents += packageValueCents(p, left);
  }

  const byCoach = [...coachLines.values()];
  return {
    season,
    lessonCount: lessons.length,
    hoursTaught,
    hoursScheduled,
    studentCount: students.size,
    receivedCents:
      byCoach.reduce((sum, l) => sum + l.lessonReceivedCents, 0) +
      packageReceivedCents,
    owedCents:
      bookings.reduce((sum, b) => sum + owedOn(b, now), 0) + packageOwedCents,
    awaitingReviewCents,
    packagesSold,
    packageReceivedCents,
    packageHoursLeft: packageHoursLeftTotal,
    packageValueLeftCents,
    earlyBirdHours,
    regularHours,
    packageHours,
    byCoach,
    byLessonType: breakdown(bookings, (b) => b.lessonType),
    byResort: breakdown(bookings, (b) => b.resortId),
    months: [...months.values()],
  };
}
