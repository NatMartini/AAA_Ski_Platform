import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { deleteObject, type StorageKey } from "./storage";

/**
 * Payment screenshots belong to either a booking ("proofs/<bookingId>/…") or
 * a lesson package ("package-proofs/<packageId>/…"). The owner is encoded in
 * the server-generated key, so a key alone says which row to lock and check.
 */
const PAYMENT_PROOF_KEY =
  /^(proofs|package-proofs)\/([A-Za-z0-9_-]+)\/[A-Za-z0-9-]+\.(?:webp|png|jpe?g)$/i;

export type ProofOwner = { kind: "booking" | "package"; id: string };

/** Which booking or package a server-generated proof key belongs to. */
export function paymentProofOwner(key: StorageKey): ProofOwner | null {
  const match = PAYMENT_PROOF_KEY.exec(key);
  if (!match) return null;
  return {
    kind: match[1].toLowerCase() === "proofs" ? "booking" : "package",
    id: match[2],
  };
}

/** Returns the owning booking id encoded by a server-generated proof key. */
export function paymentProofBookingId(key: StorageKey): string | null {
  const owner = paymentProofOwner(key);
  return owner?.kind === "booking" ? owner.id : null;
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

/** The same lock, on a lesson package row. */
export async function withPackageProofLock<T>(
  packageId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "LessonPackage" WHERE "id" = ${packageId} FOR UPDATE
    `;
    return work(tx);
  });
}

/**
 * Deletes a payment proof only when nothing currently points at it.
 *
 * Invalid or non-proof keys are deliberately ignored. Missing files count as
 * cleaned because deleteObject is idempotent.
 */
export async function deletePaymentProofIfUnreferenced(
  key: StorageKey,
): Promise<boolean> {
  const owner = paymentProofOwner(key);
  if (!owner) return false;

  const lock =
    owner.kind === "booking" ? withPaymentProofLock : withPackageProofLock;
  return lock(owner.id, async (tx) => {
    const references =
      owner.kind === "booking"
        ? await tx.booking.count({ where: { paymentProofKey: key } })
        : await tx.lessonPackage.count({ where: { paymentProofKey: key } });
    if (references > 0) return false;

    await deleteObject(key);
    return true;
  });
}
