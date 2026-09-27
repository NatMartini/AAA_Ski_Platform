import type { BookingStatus, Prisma, PrismaClient } from "@prisma/client";

/**
 * Only these self-serve stages are governed by the original 30-minute
 * deadline. Once proof has been submitted, the student met the deadline and a
 * later review/re-upload must not expire merely because holdExpiresAt remains
 * on the audit record.
 */
export const EXPIRING_HOLD_STATUSES: BookingStatus[] = [
  "HOLD",
  "AWAITING_PAYMENT",
];

type HoldRecord = {
  status: BookingStatus;
  holdExpiresAt: Date | null;
};

/** True when a pending self-serve booking has reached its hold deadline. */
export function isSelfServeHoldExpired(
  booking: HoldRecord,
  now: Date,
): boolean {
  return (
    EXPIRING_HOLD_STATUSES.includes(booking.status) &&
    booking.holdExpiresAt !== null &&
    booking.holdExpiresAt.getTime() <= now.getTime()
  );
}

/**
 * Persist the terminal status if this exact booking has elapsed. The guarded
 * update makes this safe to call from a route after a potentially stale read.
 */
export async function expireElapsedHold(
  tx: Prisma.TransactionClient | PrismaClient,
  bookingId: string,
  now: Date,
): Promise<boolean> {
  const result = await tx.booking.updateMany({
    where: {
      id: bookingId,
      status: { in: EXPIRING_HOLD_STATUSES },
      holdExpiresAt: { not: null, lte: now },
    },
    data: { status: "EXPIRED" },
  });
  return result.count === 1;
}
