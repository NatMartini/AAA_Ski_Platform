/** SQLSTATE for exclusion_violation. */
export const EXCLUSION_VIOLATION = "23P01";

export const OVERLAP_CONSTRAINT = "booking_no_overlap";

/**
 * Detects a rejected double-booking.
 *
 * Prisma does not map SQLSTATE 23P01 to one of its own error codes, so this
 * surfaces as a PrismaClientUnknownRequestError with the Postgres code buried
 * in the message rather than in `meta.code`. Check both: `meta.code` in case a
 * future Prisma version starts populating it, and the message text as it
 * actually behaves today.
 *
 * Callers turn a true result into HTTP 409 — the slot was taken between the
 * availability check and the insert, which is exactly the race the constraint
 * exists to lose safely.
 */
export function isOverlapViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const meta = (err as { meta?: { code?: unknown } }).meta;
  if (meta && typeof meta.code === "string" && meta.code === EXCLUSION_VIOLATION) {
    return true;
  }

  const message = (err as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return (
    message.includes(EXCLUSION_VIOLATION) || message.includes(OVERLAP_CONSTRAINT)
  );
}
