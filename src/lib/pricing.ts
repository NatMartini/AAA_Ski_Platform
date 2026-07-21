import { addMinutes } from "./time";

/**
 * A booking is made on the hour, but the lesson runs five minutes short at each
 * end so the coach can hand over to the next student. A 1:00-3:00 booking is
 * taught 1:05-2:55.
 *
 * Those ten minutes are credited back as a single flat discount per booking —
 * not per hour — because the handover only happens once no matter how long the
 * lesson is. $80/h for 2h is $160, less $15, so $145.
 *
 * No tax is calculated or displayed anywhere. Showing a tax line while not
 * registered would be worse than showing none.
 */

export const HANDOVER_HEAD_MINUTES = 5;
export const HANDOVER_TAIL_MINUTES = 5;
export const HANDOVER_TOTAL_MINUTES =
  HANDOVER_HEAD_MINUTES + HANDOVER_TAIL_MINUTES;

export const CURRENCY = "CAD";

export type Quote = {
  hours: number;
  hourlyRateCents: number;
  subtotalCents: number;
  handoverDiscountCents: number;
  totalCents: number;
  currency: string;
  /** Minutes actually taught, for the "1:05 PM – 2:55 PM (110 min)" line. */
  lessonMinutes: number;
};

export function quote(input: {
  hours: number;
  hourlyRateCents: number;
  handoverDiscountCents: number;
}): Quote {
  const { hours, hourlyRateCents, handoverDiscountCents } = input;

  if (!Number.isInteger(hours) || hours <= 0) {
    throw new Error(`hours must be a positive integer, got ${hours}`);
  }
  if (!Number.isInteger(hourlyRateCents) || hourlyRateCents < 0) {
    throw new Error(`hourlyRateCents must be a non-negative integer`);
  }
  if (!Number.isInteger(handoverDiscountCents) || handoverDiscountCents < 0) {
    throw new Error(`handoverDiscountCents must be a non-negative integer`);
  }

  const subtotalCents = hours * hourlyRateCents;
  // Clamp so a misconfigured discount can never produce a negative total.
  const discount = Math.min(handoverDiscountCents, subtotalCents);

  return {
    hours,
    hourlyRateCents,
    subtotalCents,
    handoverDiscountCents: discount,
    totalCents: subtotalCents - discount,
    currency: CURRENCY,
    lessonMinutes: hours * 60 - HANDOVER_TOTAL_MINUTES,
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
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")} ${currency}`;
}

/** Same, without the currency suffix, for dense table cells. */
export function formatMoneyShort(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
