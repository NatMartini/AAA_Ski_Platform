export const ANALYSIS_LEASE_MINUTES = 15;
export const ANALYSIS_QUEUE_MINUTES = 30;
export const MAX_ANALYSIS_PURCHASE_QUANTITY = 50;

/** Included credits belong to one whole lesson and are shared by all attendees.
 * Two-hour lessons include three; three-hour lessons include five. Pending any
 * more specific policy, other valid durations use those two duration tiers.
 */
export function includedAnalysisCredits(hours: number): number {
  if (!Number.isInteger(hours) || hours < 1 || hours > 12) return 0;
  return hours >= 3 ? 5 : 3;
}

type Usage = { status: string; refundedAt: Date | null };
/** Derive historical entitlements from the frozen course duration, without rewriting courses. */
export function analysisQuota(booking: { status: string; hours: number }, jobs: readonly Usage[],
  purchases: readonly { status: string; quantity: number }[]) {
  const active = booking.status === "COMPLETED";
  const freeTotal = active ? includedAnalysisCredits(booking.hours) : 0;
  const paidTotal = purchases.filter((p) => p.status === "CONFIRMED").reduce((sum, p) => sum + p.quantity, 0);
  const charged = jobs.filter((job) => !job.refundedAt);
  const used = charged.filter((job) => job.status === "SUCCEEDED").length;
  const reserved = charged.filter((job) => job.status === "QUEUED" || job.status === "RUNNING").length;
  // An inconsistent terminal ledger never creates extra spendable credits.
  const remaining = active ? Math.max(0, freeTotal + paidTotal - charged.length) : 0;
  return { active, freeTotal, paidTotal, used, reserved, remaining };
}

export class AnalysisDomainError extends Error {
  constructor(readonly reason: string) { super(reason); }
}

export function analysisParty(booking: { accountId: string | null; coachId: string }, user: { id: string; role: string }) {
  const isCustomer = booking.accountId === user.id;
  const isCoach = (user.role === "COACH" && booking.coachId === user.id) || user.role === "ADMIN";
  const isAnyCoach = user.role === "COACH" || user.role === "ADMIN";
  return { isCustomer, isCoach, isAnyCoach, canView: isCustomer || isAnyCoach,
    canAct: isCustomer || isCoach };
}
