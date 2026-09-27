import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { deleteObject, type StorageKey } from "./storage";

const PAYMENT_PROOF_KEY =
  /^proofs\/([A-Za-z0-9_-]+)\/[A-Za-z0-9-]+\.(?:webp|png|jpe?g)$/i;

/** Returns the owning booking id encoded by a server-generated proof key. */
export function paymentProofBookingId(key: StorageKey): string | null {
  return PAYMENT_PROOF_KEY.exec(key)?.[1] ?? null;
}

/**
 * Serialises proof attachment and deletion for one booking row.
 *
 * A database check followed by a filesystem delete has a race of its own: a
 * payment request could attach the key between those two operations. Taking a
 * row lock lets both paths make the check while holding the same lock.
 */
export async function withPaymentProofLock<T>(
  bookingId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE
    `;
    return work(tx);
  });
}

/**
 * Deletes a payment proof only when no booking currently points at it.
 *
 * Invalid or non-proof keys are deliberately ignored. Missing files count as
 * cleaned because deleteObject is idempotent.
 */
export async function deletePaymentProofIfUnreferenced(
  key: StorageKey,
): Promise<boolean> {
  const bookingId = paymentProofBookingId(key);
  if (!bookingId) return false;

  return withPaymentProofLock(bookingId, async (tx) => {
    const references = await tx.booking.count({
      where: { paymentProofKey: key },
    });
    if (references > 0) return false;

    await deleteObject(key);
    return true;
  });
}
