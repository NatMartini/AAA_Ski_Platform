import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { ActiveUser } from "../auth/require-user";
import { objectExists } from "../storage";
import { isFreeSkiActionId, isSubmittableFreeSkiActionId, parseFreeSkiActionId, isAutoAction } from "../freeski/actions";
import type { FreeSkiAnalysisResult } from "../freeski/types";
import { analysisResultUsable } from "../freeski/scorecard";
import { getFreeSkiConfig, isFreeSkiConfigured } from "../freeski/config";
import { freeSkiServiceState, getFreeSkiActionCatalog } from "../freeski/adapter";
import { ensureBusinessAnalysisQueued } from "../freeski/dispatcher";
import { withAnalysisQueueReasons } from "./scheduling";
import { purgeExpiredVideos } from "./retention";
import { AnalysisDomainError, ANALYSIS_LEASE_MINUTES, ANALYSIS_QUEUE_MINUTES, LESSON_ANALYSES } from "./quota";
import { isPreparing, preparationAfterTierChange, readPrepareState } from "./prepare";
import { chargedHalves, credits, FREE_ANALYSES_PER_DAY, isAnalysisTier, isFreeTier, paidAfter, resultForTier, startOfTorontoDay, storedTier, TIER_HALVES, upgradeHalves,
  type AnalysisTier } from "./tiers";

const grantInclude = { account: { select: { name: true, email: true } },
  coach: { select: { name: true, coachProfile: { select: { displayName: true } } } } } as const;
type Grant = Prisma.AccountAnalysisGrantGetPayload<{ include: typeof grantInclude }>;
const grantDto = (grant: Grant) => ({ id: grant.id, quantity: grant.quantity, note: grant.note,
  createdAt: grant.createdAt, recipient: grant.account,
  coach: { name: grant.coach.coachProfile?.displayName ?? grant.coach.name ?? "" } });

/** The caller chooses its authenticated account; this helper grants no cross-account access. */
export async function lockedAccount<T>(accountId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${accountId} FOR UPDATE`;
    const account = await tx.user.findUnique({ where: { id: accountId }, select: { id: true, disabledAt: true } });
    if (!account) throw new AnalysisDomainError("not-found");
    if (account.disabledAt) throw new AnalysisDomainError("forbidden");
    return work(tx);
  });
}

/**
 * What an account may analyse (owner's decisions, 2026-11-06 and 2026-11-07): every student account starts with
 * three analyses, gets three more for each completed lesson, and adds what coaches issue and what the student
 * bought; all of it is spent from the account whenever the student likes. Coaches and administrators analyse
 * without limit.
 */
export const ACCOUNT_FREE_ANALYSES = 3;
export type AccountAllowance = { free: number; unlimited: boolean };
export const accountAllowance = (user: Pick<ActiveUser, "role">): AccountAllowance => ({
  free: user.role === "CUSTOMER" ? ACCOUNT_FREE_ANALYSES : 0, unlimited: user.role === "COACH" || user.role === "ADMIN" });

/**
 * What the student's lessons add: how many they completed, what they bought through them, and the analyses they
 * ran on lesson clips before credits moved to the account, which count as spent.
 */
type ChargedJob = { status: string; refundedAt: Date | null; paidTier?: string | null; preparedTier?: string | null };
/** Scored, with its tier's outputs still being made: in progress, not yet a finished analysis. */
const completing = (job: ChargedJob) => job.status === "SUCCEEDED" && job.preparedTier === null;
export type LessonCredits = { lessons: number; purchased: number; lessonJobs: readonly ChargedJob[] };
const NO_LESSONS: LessonCredits = { lessons: 0, purchased: 0, lessonJobs: [] };

/**
 * `remaining` counts analyses, in halves where a deep analysis cost half of one; an unlimited account has none to count
 * and is never refused for want of one. `freeToday` is how many free analyses were started today.
 */
export function accountAnalysisQuota(grants: readonly { quantity: number }[],
  jobs: readonly (ChargedJob & { createdAt?: Date })[], allowance: AccountAllowance, lessons: LessonCredits = NO_LESSONS, now = new Date()) {
  const grantTotal = grants.reduce((sum, grant) => sum + grant.quantity, 0);
  const lessonTotal = lessons.lessons * LESSON_ANALYSES, paidTotal = lessons.purchased;
  const charged = [...jobs, ...lessons.lessonJobs].filter((job) => !job.refundedAt);
  const halves = (list: readonly ChargedJob[]) => list.reduce((sum, job) => sum + chargedHalves(job), 0);
  const used = credits(halves(charged.filter((job) => job.status === "SUCCEEDED" && !completing(job))));
  const reserved = credits(halves(charged.filter((job) => ["QUEUED", "RUNNING"].includes(job.status) || completing(job))));
  const earned = allowance.free + lessonTotal + grantTotal + paidTotal;
  const remainingHalves = allowance.unlimited ? 0 : Math.max(0, earned * 2 - halves(charged));
  const today = startOfTorontoDay(now);
  const freeToday = jobs.filter((job) => !job.refundedAt && job.createdAt && job.createdAt >= today && isFreeTier(storedTier(job.paidTier))).length;
  return { active: true, unlimited: allowance.unlimited, freeTotal: allowance.free, lessonCount: lessons.lessons, lessonTotal, paidTotal,
    grantTotal, earned, used, reserved, remaining: credits(remainingHalves), remainingHalves,
    freeToday, freeLimit: allowance.unlimited ? null : FREE_ANALYSES_PER_DAY };
}

/** Completed lessons count for the booker and for every companion with an account. */
async function lessonCredits(tx: Prisma.TransactionClient, user: ActiveUser): Promise<LessonCredits> {
  const lessons = await tx.booking.count({ where: { status: "COMPLETED",
    OR: [{ accountId: user.id }, { attendees: { some: { accountId: user.id } } }] } });
  const purchases = await tx.videoAnalysisPurchase.findMany({ where: { accountId: user.id, status: "CONFIRMED" }, select: { quantity: true } });
  const lessonJobs = await tx.videoAnalysisJob.findMany({ where: { createdById: user.id }, select: { status: true, refundedAt: true, paidTier: true, preparedTier: true } });
  return { lessons, purchased: purchases.reduce((sum, purchase) => sum + purchase.quantity, 0), lessonJobs };
}
type Quota = ReturnType<typeof accountAnalysisQuota>;
/** Whether an analysis at this tier may start: a free one within the day's allowance, a paid one with the credit for it. */
function tierRefusal(quota: Quota, tier: AnalysisTier, correction = false): string | null {
  if (quota.unlimited) return null;
  // Putting a recognised action right is not another analysis of the day.
  if (isFreeTier(tier)) return !correction && quota.freeToday >= FREE_ANALYSES_PER_DAY ? "free-daily-limit" : null;
  return quota.remainingHalves >= TIER_HALVES[tier] ? null : "quota-exhausted";
}
type Correction = { videoId: string; actionId: string; tier: AnalysisTier; replacesJobId?: string | null };
/** The recognised analysis of this clip that a correction may replace: finished, still standing, and corrected by a chosen action. */
function replaceable<T extends { id: string; videoId: string | null; actionId: string; status: string; refundedAt: Date | null; paidTier: string }>(
  jobs: readonly T[], input: Correction): T | null {
  const job = jobs.find((candidate) => candidate.id === input.replacesJobId);
  return job && !job.refundedAt && job.status === "SUCCEEDED" && job.videoId === input.videoId && isAutoAction(job.actionId) && !isAutoAction(input.actionId) ? job : null;
}
/**
 * Whether a correction may start. What was paid for the recognised run carries over, so only a costlier tier needs more:
 * the quota is read as if that run were already closed, against the tier the correction ends up paid at.
 */
function correctionRefusal<T extends Parameters<typeof replaceable>[0][number]>(jobs: readonly T[], input: Correction, quotaOf: () => Quota): string | null {
  const replaced = replaceable(jobs, input);
  if (!replaced) return "not-replaceable";
  const paid = paidAfter(storedTier(replaced.paidTier), input.tier), standing = replaced.refundedAt;
  replaced.refundedAt = new Date();
  try { return tierRefusal(quotaOf(), paid, true); } finally { replaced.refundedAt = standing; }
}
/** Whether anything can still be analysed: a free tier is always on offer within the day's allowance. */
const mayAnalyse = (quota: Quota) => quota.unlimited || quota.freeToday < FREE_ANALYSES_PER_DAY || quota.remainingHalves > 0;

const jobDto = (job: Prisma.AccountAnalysisJobGetPayload<object>) => {
  const preparing = isPreparing(job), tier = storedTier(job.tier);
  return { id: job.id, videoId: job.videoId, actionId: job.actionId, createdAt: job.createdAt, errorCode: job.errorCode,
    tier, paidTier: storedTier(job.paidTier),
    // Until everything the tier shows is made, the analysis is still in progress for its owner and has no report.
    status: preparing ? "RUNNING" : job.status, finishedAt: preparing ? null : job.finishedAt,
    // A simple analysis shows no scores, so none reach the page.
    result: preparing ? null : resultForTier(job.result, tier),
    ...(preparing ? { phase: "preparing" as const, prepare: readPrepareState(job.prepareState) } : {}) };
};
/** A recognised analysis put right by another keeps no place in the lists: its correction stands for it. */
const listed = (job: { errorCode: string | null }) => job.errorCode !== "replaced";
const busy = (job: { status: string; refundedAt: Date | null; preparedTier: string | null }) => ["QUEUED", "RUNNING"].includes(job.status) || isPreparing(job);
const supportedVideo = (video: { contentType: string; bytes: number }) =>
  ["video/mp4", "video/quicktime"].includes(video.contentType) && video.bytes > 0 && video.bytes <= 200 * 1024 * 1024;

async function expireAccountJobs(tx: Prisma.TransactionClient, accountId: string, now: Date) {
  return tx.accountAnalysisJob.updateMany({ where: { accountId, refundedAt: null, OR: [
    { status: "RUNNING", leaseExpiresAt: { lte: now } },
    { status: "RUNNING", startedAt: { lte: new Date(now.getTime() - 60 * 60_000) } },
  ] }, data: { status: "QUEUED", startedAt: null, errorCode: null,
    leaseToken: null, leaseExpiresAt: null } });
}

async function accountLedger(tx: Prisma.TransactionClient, user: ActiveUser) {
  const grants = await tx.accountAnalysisGrant.findMany({ where: { accountId: user.id },
    orderBy: { createdAt: "desc" }, include: grantInclude });
  const jobs = await tx.accountAnalysisJob.findMany({ where: { accountId: user.id }, orderBy: { createdAt: "desc" } });
  const lessons = await lessonCredits(tx, user);
  return { grants, jobs, lessons, quota: accountAnalysisQuota(grants, jobs, accountAllowance(user), lessons) };
}

export async function getAccountVideoAnalysisState(user: ActiveUser) {
  // Last season's videos go before the list is read; the worker clears the rest. A failure only delays it.
  await purgeExpiredVideos({ accountId: user.id }).catch(() => 0);
  const { upstream, ...data } = await lockedAccount(user.id, async (tx) => {
    await expireAccountJobs(tx, user.id, new Date());
    const { grants, jobs, quota } = await accountLedger(tx, user);
    const videos = await tx.accountAnalysisVideo.findMany({ where: { accountId: user.id }, orderBy: { uploadedAt: "asc" } });
    return { ok: true, accountId: user.id, quota, price: null, unlimited: quota.unlimited, canAnalyze: mayAnalyse(quota),
      canUpload: quota.unlimited || quota.earned > 0, canPurchase: false, canReview: false,
      videos: videos.map((video) => ({ id: video.id, caption: video.caption, uploadedAt: video.uploadedAt,
        contentType: video.contentType, analysisSupported: supportedVideo(video),
        url: `/api/video-analysis/videos/${video.id}`,
        canDelete: !jobs.some((job) => job.videoId === video.id && busy(job)) })),
      jobs: jobs.filter(listed).map(jobDto), purchases: [],
      grants: grants.map((grant) => { const { id, quantity, note, createdAt, coach } = grantDto(grant); return { id, quantity, note, createdAt, coach }; }),
      payment: { coachName: "", wechatEnabled: false, wechatId: null, wechatQrUrl: null },
      // FreeSki's own job has finished once the tier's outputs are being made: nothing to ask it about.
      upstream: new Map(jobs.filter((job) => !isPreparing(job)).map((job) => [job.id,
        { upstreamJobId: job.upstreamJobId, upstreamDeploymentId: job.upstreamDeploymentId }])) };
  });
  const [service, jobs, actions] = await Promise.all([
    freeSkiServiceState().catch(() => ({ configured: isFreeSkiConfigured(), available: false })),
    withAnalysisQueueReasons(data.jobs, upstream),
    getFreeSkiActionCatalog().catch(() => []),
  ]);
  return { ...data, jobs, canAnalyze: data.canAnalyze && service.configured && service.available && actions.some((action) => action.available),
    actions, service };
}

export async function requestAccountAnalysis(user: ActiveUser,
  input: { videoId: string; actionId: string; requestKey: string; expectedAccountId: string; tier: AnalysisTier;
    /** A recognised analysis of the same clip this one corrects: what was paid for it carries over to this one. */
    replacesJobId?: string | null }) {
  if (input.expectedAccountId !== user.id) throw new AnalysisDomainError("state-changed");
  if (!isAnalysisTier(input.tier)) throw new AnalysisDomainError("invalid-tier");
  // Keep catalog/storage network reads outside row locks, and let an offline
  // duplicate reuse its original reservation without calling the catalog.
  const prepared = await lockedAccount(user.id, async (tx) => {
    const { jobs, grants, lessons, quota } = await accountLedger(tx, user);
    const existing = jobs.find((job) => job.requestKey === input.requestKey);
    if (existing) {
      if (existing.videoId !== input.videoId || existing.actionId !== input.actionId || storedTier(existing.tier) !== input.tier) throw new AnalysisDomainError("request-conflict");
      return { kind: "existing" as const, reservation: { ok: true, job: jobDto(existing), quota } };
    }
    if (!isSubmittableFreeSkiActionId(input.actionId)) throw new AnalysisDomainError("unsupported-action");
    if (!isFreeSkiConfigured()) throw new AnalysisDomainError("service-not-configured");
    const video = await tx.accountAnalysisVideo.findFirst({ where: { id: input.videoId, accountId: user.id } });
    if (!video) throw new AnalysisDomainError("video-not-found");
    if (!supportedVideo(video)) throw new AnalysisDomainError("unsupported-video");
    const refusal = input.replacesJobId ? correctionRefusal(jobs, input, () => accountAnalysisQuota(grants, jobs, accountAllowance(user), lessons))
      : tierRefusal(quota, input.tier);
    if (refusal) throw new AnalysisDomainError(refusal);
    return { kind: "new" as const, storageKey: video.storageKey };
  });
  if (prepared.kind === "existing") {
    void ensureBusinessAnalysisQueued("account", prepared.reservation.job.id).catch(() => {});
    return prepared.reservation;
  }
  const [actions, videoAvailable] = await Promise.all([
    getFreeSkiActionCatalog().catch(() => null), objectExists(prepared.storageKey),
  ]);
  const reservation = await lockedAccount(user.id, async (tx) => {
    await expireAccountJobs(tx, user.id, new Date());
    const { jobs, grants, lessons, quota } = await accountLedger(tx, user);
    const existing = jobs.find((job) => job.requestKey === input.requestKey);
    if (existing) {
      if (existing.videoId !== input.videoId || existing.actionId !== input.actionId || storedTier(existing.tier) !== input.tier) throw new AnalysisDomainError("request-conflict");
      return { ok: true, job: jobDto(existing), quota };
    }
    if (!actions) throw new AnalysisDomainError("service-unavailable");
    // The recognised run a correction replaces: closed here, with what was paid for it carried to the new run.
    const replaced = input.replacesJobId ? replaceable(jobs, input) : null;
    if (input.replacesJobId && !replaced) throw new AnalysisDomainError("not-replaceable");
    const catalogId = parseFreeSkiActionId(input.actionId)?.catalogId;
    if (!actions.some((action) => action.id === catalogId && action.available === true)) throw new AnalysisDomainError("unsupported-action");
    if (!isFreeSkiConfigured()) throw new AnalysisDomainError("service-not-configured");
    const video = await tx.accountAnalysisVideo.findFirst({ where: { id: input.videoId, accountId: user.id } });
    if (!video || video.storageKey !== prepared.storageKey || !videoAvailable) throw new AnalysisDomainError("video-not-found");
    if (!supportedVideo(video)) throw new AnalysisDomainError("unsupported-video");
    const refusal = replaced ? correctionRefusal(jobs, input, () => accountAnalysisQuota(grants, jobs, accountAllowance(user), lessons))
      : tierRefusal(quota, input.tier);
    if (refusal) throw new AnalysisDomainError(refusal);
    if (replaced) {
      const now = new Date();
      await tx.accountAnalysisJob.update({ where: { id: replaced.id }, data: { refundedAt: now, errorCode: "replaced" } });
      replaced.refundedAt = now;
      replaced.errorCode = "replaced";
    }
    const paidTier = replaced ? paidAfter(storedTier(replaced.paidTier), input.tier) : input.tier;
    const job = await tx.accountAnalysisJob.create({ data: { accountId: user.id, videoId: video.id,
      createdById: user.id, requestKey: input.requestKey, actionId: input.actionId, tier: input.tier, paidTier,
      queuedExpiresAt: new Date(Date.now() + ANALYSIS_QUEUE_MINUTES * 60_000) } });
    return { ok: true, job: jobDto(job), quota: accountAnalysisQuota(grants, [...jobs, job], accountAllowance(user), lessons) };
  });
  // The hand-off uploads the whole clip to FreeSki, which may be asleep, starting or busy, so the answer does not wait
  // for it: the reservation is durable and the analysis worker retries the hand-off every few seconds until it lands.
  void ensureBusinessAnalysisQueued("account", reservation.job.id).catch(() => {});
  return reservation;
}

/**
 * Moves an analysis to another tier: free between free tiers, the difference to what was paid when going up, and no
 * refund going down, so returning to a tier already paid for costs nothing.
 */
export async function changeAccountAnalysisTier(user: ActiveUser, input: { jobId: string; tier: AnalysisTier; expectedAccountId: string }) {
  if (input.expectedAccountId !== user.id) throw new AnalysisDomainError("state-changed");
  if (!isAnalysisTier(input.tier)) throw new AnalysisDomainError("invalid-tier");
  return lockedAccount(user.id, async (tx) => {
    const { grants, jobs, lessons, quota } = await accountLedger(tx, user);
    const job = jobs.find((candidate) => candidate.id === input.jobId);
    if (!job || job.refundedAt || !["QUEUED", "RUNNING", "SUCCEEDED"].includes(job.status)) throw new AnalysisDomainError("not-found");
    const paid = storedTier(job.paidTier), cost = quota.unlimited ? 0 : upgradeHalves(paid, input.tier);
    if (cost > quota.remainingHalves) throw new AnalysisDomainError("quota-exhausted");
    const updated = await tx.accountAnalysisJob.update({ where: { id: job.id },
      data: { tier: input.tier, paidTier: paidAfter(paid, input.tier), ...preparationAfterTierChange(job, input.tier) } });
    return { ok: true, job: jobDto(updated), charged: credits(cost),
      quota: accountAnalysisQuota(grants, jobs.map((candidate) => candidate.id === updated.id ? updated : candidate), accountAllowance(user), lessons) };
  });
}

type GrantInput = { recipientEmail: string; quantity: number; note?: string | null; requestKey: string; expectedCoachId: string };
export async function issueAccountAnalysisGrant(user: ActiveUser, input: GrantInput) {
  if (input.expectedCoachId !== user.id) throw new AnalysisDomainError("state-changed");
  if (!["COACH", "ADMIN"].includes(user.role)) throw new AnalysisDomainError("forbidden");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) throw new AnalysisDomainError("invalid-quantity");
  const email = input.recipientEmail.trim().toLowerCase();
  const note = input.note?.trim() || null;
  if (note && note.length > 500) throw new AnalysisDomainError("validation");
  const found = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
  if (!found) throw new AnalysisDomainError("recipient-not-found");
  return prisma.$transaction(async (tx) => {
    // A consistent order also avoids deadlocks when two instructors issue grants together.
    const ids = [...new Set([user.id, found.id])].sort();
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
    const coach = await tx.user.findUnique({ where: { id: user.id }, select: { id: true, role: true, disabledAt: true } });
    if (!coach || coach.disabledAt || !["COACH", "ADMIN"].includes(coach.role)) throw new AnalysisDomainError("forbidden");
    const recipient = await tx.user.findUnique({ where: { id: found.id }, select: { id: true, email: true, role: true, disabledAt: true } });
    if (!recipient || recipient.email.toLowerCase() !== email || recipient.disabledAt || recipient.role !== "CUSTOMER") {
      throw new AnalysisDomainError("recipient-not-eligible");
    }
    const existing = await tx.accountAnalysisGrant.findUnique({ where: { coachId_requestKey: { coachId: user.id, requestKey: input.requestKey } }, include: grantInclude });
    if (existing) {
      if (existing.accountId !== recipient.id || existing.quantity !== input.quantity || existing.note !== note) throw new AnalysisDomainError("request-conflict");
      return { ok: true, grant: grantDto(existing) };
    }
    const grant = await tx.accountAnalysisGrant.create({ data: { accountId: recipient.id, coachId: user.id,
      quantity: input.quantity, note, requestKey: input.requestKey }, include: grantInclude });
    return { ok: true, grant: grantDto(grant) };
  });
}

export async function listAccountAnalysisGrants(user: ActiveUser) {
  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true, disabledAt: true } });
  if (!current || current.disabledAt || !["COACH", "ADMIN"].includes(current.role)) throw new AnalysisDomainError("forbidden");
  const grants = await prisma.accountAnalysisGrant.findMany({ where: { coachId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: grantInclude });
  return { ok: true, coachId: user.id, grants: grants.map(grantDto) };
}

/** Worker-only: own-account requests never grant instructors access to personal footage. */
export async function claimAccountAnalysisJob(jobId?: string) {
  await recoverExpiredAccountAnalysisJobs();
  const found = await prisma.accountAnalysisJob.findFirst({ where: { ...(jobId ? { id: jobId } : {}), status: "QUEUED" },
    orderBy: { createdAt: "asc" }, select: { id: true, accountId: true } });
  if (!found) return null;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${found.accountId} FOR UPDATE`;
    const job = await tx.accountAnalysisJob.findUnique({ where: { id: found.id }, include: { video: true, account: { select: { disabledAt: true } } } });
    const now = new Date();
    if (!job || job.status !== "QUEUED" || job.refundedAt) return null;
    if (!job.video || job.video.accountId !== job.accountId || !supportedVideo(job.video) || !isFreeSkiActionId(job.actionId) || job.account.disabledAt) {
      await tx.accountAnalysisJob.update({ where: { id: job.id }, data: { status: "FAILED", refundedAt: now,
        finishedAt: now, errorCode: "INVALID_VIDEO" } });
      return null;
    }
    const leaseToken = randomUUID();
    await tx.accountAnalysisJob.update({ where: { id: job.id }, data: { status: "RUNNING", startedAt: now,
      leaseToken, leaseExpiresAt: new Date(now.getTime() + ANALYSIS_LEASE_MINUTES * 60_000), attempts: { increment: 1 } } });
    return { id: job.id, accountId: job.accountId, videoId: job.videoId, storageKey: job.video.storageKey,
      actionId: job.actionId, upstreamJobId: job.upstreamJobId, leaseToken };
  });
}

export async function heartbeatAccountAnalysisJob(id: string, leaseToken: string) {
  return (await prisma.accountAnalysisJob.updateMany({ where: { id, status: "RUNNING", leaseToken,
    refundedAt: null, leaseExpiresAt: { gt: new Date() }, startedAt: { gt: new Date(Date.now() - 60 * 60_000) } },
    data: { leaseExpiresAt: new Date(Date.now() + ANALYSIS_LEASE_MINUTES * 60_000) } })).count === 1;
}
export async function releaseAccountAnalysisJobToQueue(id: string, leaseToken: string) {
  return (await prisma.accountAnalysisJob.updateMany({ where: { id, status: "RUNNING", leaseToken,
    refundedAt: null }, data: { status: "QUEUED", startedAt: null, leaseToken: null,
    leaseExpiresAt: null, errorCode: null } })).count === 1;
}
export async function attachAccountUpstreamJobId(id: string, leaseToken: string, upstreamJobId: string) {
  if (!/^[a-f0-9]{32}$/.test(upstreamJobId)) return false;
  const deploymentId = getFreeSkiConfig()?.deploymentId;
  return (await prisma.accountAnalysisJob.updateMany({ where: { id, status: "RUNNING", leaseToken,
    leaseExpiresAt: { gt: new Date() }, startedAt: { gt: new Date(Date.now() - 60 * 60_000) },
    refundedAt: null, upstreamJobId: null }, data: { upstreamJobId,
      ...(deploymentId ? { upstreamDeploymentId: deploymentId, upstreamApiVersion: 2 } : {}) } })).count === 1;
}

const failureAliases: Record<string, string> = { "analysis-unconfigured": "SERVICE_NOT_CONFIGURED",
  "analysis-unavailable": "SERVICE_UNAVAILABLE", "analysis-auth-failed": "SERVICE_UNAVAILABLE",
  "analysis-timeout": "TIMED_OUT", "analysis-cancelled": "TIMED_OUT", "analysis-invalid-video": "INVALID_VIDEO",
  "analysis-invalid-action": "UNSUPPORTED_ACTION" };
const safeFailureCodes = new Set(["TIMED_OUT", "SERVICE_UNAVAILABLE", "SERVICE_NOT_CONFIGURED", "INVALID_VIDEO", "UNSUPPORTED_ACTION", "ANALYSIS_FAILED"]);
export async function settleAccountAnalysisJob(id: string, leaseToken: string,
  outcome: { ok: true; result: FreeSkiAnalysisResult } |
    { ok: false; errorCode: string; expectedUnsubmittedActionId?: string }) {
  const found = await prisma.accountAnalysisJob.findUnique({ where: { id }, select: { accountId: true } });
  if (!found) return false;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${found.accountId} FOR UPDATE`;
    const now = new Date();
    const usable = outcome.ok && analysisResultUsable(outcome.result);
    const unsubmittedGuard = !outcome.ok && outcome.expectedUnsubmittedActionId !== undefined
      ? { upstreamJobId: null, actionId: outcome.expectedUnsubmittedActionId } : {};
    const result = await tx.accountAnalysisJob.updateMany({ where: { id, status: "RUNNING", leaseToken,
      refundedAt: null, leaseExpiresAt: { gt: now }, startedAt: { gt: new Date(now.getTime() - 60 * 60_000) },
      ...unsubmittedGuard }, data: usable ? {
      status: "SUCCEEDED", result: outcome.ok ? outcome.result as unknown as Prisma.InputJsonValue : Prisma.DbNull,
      finishedAt: now, leaseToken: null, leaseExpiresAt: null,
      // Scored; the report appears once everything its tier shows has been made (prepare.ts).
      preparedTier: null, prepareStartedAt: now, preparedAt: null, prepareState: Prisma.DbNull,
    } : { status: "FAILED", refundedAt: now, finishedAt: now, leaseToken: null, leaseExpiresAt: null,
      result: outcome.ok ? { ...outcome.result, gradingStatus: "unavailable", score: null, scoreKind: null,
        gradingReason: outcome.result.gradingReason ?? "score-unavailable" } as unknown as Prisma.InputJsonValue : Prisma.DbNull,
      errorCode: outcome.ok ? "UNGRADABLE" : safeFailureCodes.has(outcome.errorCode) ? outcome.errorCode : failureAliases[outcome.errorCode] ?? "ANALYSIS_FAILED" } });
    return result.count === 1;
  });
}

export async function recoverExpiredAccountAnalysisJobs(accountIds?: readonly string[]) {
  if (accountIds?.length === 0) return 0;
  const now = new Date();
  const stale = await prisma.accountAnalysisJob.findMany({ where: { refundedAt: null,
    ...(accountIds ? { accountId: { in: [...accountIds] } } : {}), OR: [
      { status: "RUNNING", leaseExpiresAt: { lte: now } },
      { status: "RUNNING", startedAt: { lte: new Date(now.getTime() - 60 * 60_000) } },
    ] }, select: { accountId: true }, distinct: ["accountId"] });
  let count = 0;
  for (const { accountId } of stale) count += await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${accountId} FOR UPDATE`;
    return (await expireAccountJobs(tx, accountId, now)).count;
  });
  return count;
}
