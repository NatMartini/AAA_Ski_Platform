import type { Booking } from "@prisma/client";

/**
 * Money still owed on a booking.
 *
 * A deposit booking is CONFIRMED once the deposit clears — the slot is the
 * coach's to lose at that point — so "confirmed" and "paid in full" are no
 * longer the same thing and every surface has to ask this rather than the
 * status.
 */
export function balanceCents(
  booking: Pick<Booking, "totalCents" | "amountPaidCents">,
): number {
  return Math.max(0, booking.totalCents - booking.amountPaidCents);
}

export function isFullyPaid(
  booking: Pick<Booking, "totalCents" | "amountPaidCents">,
): boolean {
  return balanceCents(booking) === 0;
}

/**
 * What a confirmation covers.
 *
 * Derived rather than passed in by the client: the first cleared payment on a
 * deposit booking is the deposit, anything after it is the balance, and a FULL
 * booking only ever has one.
 */
export function stageOf(
  booking: Pick<
    Booking,
    "paymentPlan" | "depositCents" | "totalCents" | "amountPaidCents"
  >,
): "DEPOSIT" | "BALANCE" | "FULL" {
  if (booking.paymentPlan !== "DEPOSIT") return "FULL";
  return booking.amountPaidCents <= 0 ? "DEPOSIT" : "BALANCE";
}

/** What the next payment on this booking should amount to. */
export function amountDueCents(
  booking: Pick<
    Booking,
    "paymentPlan" | "depositCents" | "totalCents" | "amountPaidCents"
  >,
): number {
  return stageOf(booking) === "DEPOSIT"
    ? Math.min(booking.depositCents, booking.totalCents)
    : balanceCents(booking);
}
