import { addMinutes } from "./time";

/**
 * A booking is made on the hour, but the first ten minutes are the coach's
 * handover from the previous student, so the lesson starts ten past and runs
 * to the end of the hour. A 1:00-3:00 booking is taught 1:10-3:00.
 *
 * Those ten minutes are credited back as a single flat discount per booking —
 * not per hour — because the handover only happens once no matter how long the
 * lesson is. $60/h for 2h is $120, less $10, so $110.
 *
 * Group lessons: the per-hour rate rises by a fixed amount for each additional
 * student. With a $60 base and a $20 per-extra-person rate, one-on-one is
 * $60/h, one-on-two $80/h, one-on-three $100/h. The handover credit is still
 * deducted once per booking, not per person.
 *
 * Which base rate applies — lesson type, early bird or regular — is decided in
 * rates.ts. No tax is calculated or displayed anywhere: the published prices
 * are final. Showing a tax line while not registered would be worse than
 * showing none.
 */

export const HANDOVER_HEAD_MINUTES = 10;
export const HANDOVER_TAIL_MINUTES = 0;
export const HANDOVER_TOTAL_MINUTES =
  HANDOVER_HEAD_MINUTES + HANDOVER_TAIL_MINUTES;

export const CURRENCY = "CAD";

/** Default extra charge per additional student per hour ($20). */
export const DEFAULT_EXTRA_PERSON_CENTS = 2000;

export type Quote = {
  hours: number;
  /** How many students the lesson is for. */
  headcount: number;
  /** Base per-hour rate for one student. */
  hourlyRateCents: number;
  /** Extra per additional student per hour, snapshotted. */
  extraPersonCents: number;
  /** Effective per-hour rate charged: base + (headcount-1) × extra. */
  perHourCents: number;
  subtotalCents: number;
  handoverDiscountCents: number;
  totalCents: number;
  currency: string;
  /** Minutes actually taught, for the "1:10 PM – 3:00 PM (110 min)" line. */
  lessonMinutes: number;
};

/** Effective per-hour rate for a group of `headcount` students. */
export function perHourRateCents(
  hourlyRateCents: number,
  headcount: number,
  extraPersonCents: number,
): number {
  return hourlyRateCents + Math.max(0, headcount - 1) * extraPersonCents;
}

export function quote(input: {
  hours: number;
  hourlyRateCents: number;
  handoverDiscountCents: number;
  headcount?: number;
  extraPersonCents?: number;
}): Quote {
  const {
    hours,
    hourlyRateCents,
    handoverDiscountCents,
    headcount = 1,
    extraPersonCents = 0,
  } = input;

  if (!Number.isInteger(hours) || hours <= 0) {
    throw new Error(`hours must be a positive integer, got ${hours}`);
  }
  if (!Number.isInteger(hourlyRateCents) || hourlyRateCents < 0) {
    throw new Error(`hourlyRateCents must be a non-negative integer`);
  }
  if (!Number.isInteger(handoverDiscountCents) || handoverDiscountCents < 0) {
    throw new Error(`handoverDiscountCents must be a non-negative integer`);
  }
  if (!Number.isInteger(headcount) || headcount < 1) {
    throw new Error(`headcount must be a positive integer, got ${headcount}`);
  }
  if (!Number.isInteger(extraPersonCents) || extraPersonCents < 0) {
    throw new Error(`extraPersonCents must be a non-negative integer`);
  }

  const perHourCents = perHourRateCents(
    hourlyRateCents,
    headcount,
    extraPersonCents,
  );
  const subtotalCents = hours * perHourCents;
  // Clamp so a misconfigured discount can never produce a negative total.
  const discount = Math.min(handoverDiscountCents, subtotalCents);

  return {
    hours,
    headcount,
    hourlyRateCents,
    extraPersonCents,
    perHourCents,
    subtotalCents,
    handoverDiscountCents: discount,
    totalCents: subtotalCents - discount,
    currency: CURRENCY,
    lessonMinutes: hours * 60 - HANDOVER_TOTAL_MINUTES,
  };
}

/**
 * The deposit for a booking: one hour at the effective (group-adjusted) rate.
 *
 * Capped at the total so a one-hour booking can never ask for more than the
 * lesson costs.
 */
export function depositFor(quote: Quote): number {
  return Math.min(quote.perHourCents, quote.totalCents);
}

export type PaymentPlan = "FULL" | "DEPOSIT";

/** What is due right now under a given plan. */
export function amountDueNow(quote: Quote, plan: PaymentPlan): number {
  return plan === "DEPOSIT" ? depositFor(quote) : quote.totalCents;
}

/** What is still owed after `paid` has been confirmed. */
export function balanceRemaining(totalCents: number, paidCents: number): number {
  return Math.max(0, totalCents - paidCents);
}

/**
 * Rebuilds a Quote for display from a booking's frozen price snapshot.
 *
 * Uses the stored totals verbatim rather than recomputing, so what is shown is
 * exactly what was charged even if the coach's rates have since changed. The
 * effective per-hour rate is recovered from the stored subtotal, which is an
 * exact multiple of the hours.
 */
export function quoteFromBooking(b: {
  hours: number;
  headcount: number;
  hourlyRateCents: number;
  extraPersonCents: number;
  subtotalCents: number;
  handoverDiscountCents: number;
  totalCents: number;
  currency: string;
  lessonStartAt: Date;
  lessonEndAt: Date;
}): Quote {
  return {
    hours: b.hours,
    headcount: b.headcount,
    hourlyRateCents: b.hourlyRateCents,
    extraPersonCents: b.extraPersonCents,
    perHourCents: Math.round(b.subtotalCents / b.hours),
    subtotalCents: b.subtotalCents,
    handoverDiscountCents: b.handoverDiscountCents,
    totalCents: b.totalCents,
    currency: b.currency,
    lessonMinutes: Math.round(
      (b.lessonEndAt.getTime() - b.lessonStartAt.getTime()) / 60000,
    ),
  };
}

/** The taught window inside a booked block. */
export function lessonWindow(startAt: Date, endAt: Date): {
  lessonStartAt: Date;
  lessonEndAt: Date;
} {
  return {
    lessonStartAt: addMinutes(startAt, HANDOVER_HEAD_MINUTES),
    lessonEndAt: addMinutes(endAt, -HANDOVER_TAIL_MINUTES),
  };
}

/** Integer cents -> "$145.00". Display only; never feed this back into math. */
export function formatMoney(cents: number, currency = CURRENCY): string {
  return `${formatMoneyShort(cents)} ${currency}`;
}

/** Same, without the currency suffix, for dense table cells. "$1,305.00". */
export function formatMoneyShort(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
