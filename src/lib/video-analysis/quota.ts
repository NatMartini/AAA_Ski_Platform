export const ANALYSIS_LEASE_MINUTES = 15;
export const ANALYSIS_QUEUE_MINUTES = 30;
export const MAX_ANALYSIS_PURCHASE_QUANTITY = 50;

/**
 * Each completed lesson gives three analyses to every student on it with an account, the booker and companions
 * alike, straight into their own account to use whenever they like (owner's decision, 2026-11-07).
 */
export const LESSON_ANALYSES = 3;

type Usage = { status: string; refundedAt: Date | null; createdById: string; preparedTier?: string | null };
/** Scored, with its tier's outputs still being made: in progress, not yet a finished analysis. */
const completing = (job: Usage) => job.status === "SUCCEEDED" && job.preparedTier === null;
/**
 * A lesson's own analyses. A lesson holds no credits of its own any more: the student's are in their account,
 * and the lesson's coach analyses there without limit (owner's decision, 2026-11-06). Used and reserved count
 * the student's earlier analyses of lesson clips, which their account counts as spent; paidTotal is what the
 * student bought through this lesson, which their account adds.
 */
export function analysisQuota(booking: { status: string; accountId: string | null }, jobs: readonly Usage[],
  purchases: readonly { status: string; quantity: number }[]) {
  const active = booking.status === "COMPLETED";
  const paidTotal = purchases.filter((p) => p.status === "CONFIRMED").reduce((sum, p) => sum + p.quantity, 0);
  const charged = jobs.filter((job) => !job.refundedAt && job.createdById === booking.accountId);
  const used = charged.filter((job) => job.status === "SUCCEEDED" && !completing(job)).length;
  const reserved = charged.filter((job) => job.status === "QUEUED" || job.status === "RUNNING" || completing(job)).length;
  return { active, freeTotal: 0, paidTotal, used, reserved, remaining: 0 };
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
