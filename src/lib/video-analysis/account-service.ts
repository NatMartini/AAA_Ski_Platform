import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { ActiveUser } from "../auth/require-user";
import { objectExists } from "../storage";
import { isFreeSkiActionId, isSubmittableFreeSkiActionId, parseFreeSkiActionId } from "../freeski/actions";
import type { FreeSkiAnalysisResult } from "../freeski/types";
import { analysisResultUsable } from "../freeski/scorecard";
import { getFreeSkiConfig, isFreeSkiConfigured } from "../freeski/config";
import { freeSkiServiceState, getFreeSkiActionCatalog } from "../freeski/adapter";
import { ensureBusinessAnalysisQueued } from "../freeski/dispatcher";
import { withAnalysisQueueReasons } from "./scheduling";
import { AnalysisDomainError, ANALYSIS_LEASE_MINUTES, ANALYSIS_QUEUE_MINUTES } from "./quota";

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

export function accountAnalysisQuota(grants: readonly { quantity: number }[],
  jobs: readonly { status: string; refundedAt: Date | null }[]) {
  const grantTotal = grants.reduce((sum, grant) => sum + grant.quantity, 0);
  const charged = jobs.filter((job) => !job.refundedAt);
  const used = charged.filter((job) => job.status === "SUCCEEDED").length;
  const reserved = charged.filter((job) => ["QUEUED", "RUNNING"].includes(job.status)).length;
  return { active: true, freeTotal: 0, paidTotal: 0, grantTotal, used, reserved,
    remaining: Math.max(0, grantTotal - charged.length) };
}

const jobDto = (job: Prisma.AccountAnalysisJobGetPayload<object>) => ({ id: job.id,
  videoId: job.videoId, actionId: job.actionId, status: job.status, createdAt: job.createdAt,
  finishedAt: job.finishedAt, result: job.result, errorCode: job.errorCode });
const supportedVideo = (video: { contentType: string; bytes: number }) =>
  ["video/mp4", "video/quicktime"].includes(video.contentType) && video.bytes > 0 && video.bytes <= 200 * 1024 * 1024;

async function expireAccountJobs(tx: Prisma.TransactionClient, accountId: string, now: Date) {
  return tx.accountAnalysisJob.updateMany({ where: { accountId, refundedAt: null, OR: [
    { status: "RUNNING", leaseExpiresAt: { lte: now } },
    { status: "RUNNING", startedAt: { lte: new Date(now.getTime() - 60 * 60_000) } },
  ] }, data: { status: "QUEUED", startedAt: null, errorCode: null,
    leaseToken: null, leaseExpiresAt: null } });
}

async function accountLedger(tx: Prisma.TransactionClient, accountId: string) {
  const grants = await tx.accountAnalysisGrant.findMany({ where: { accountId },
    orderBy: { createdAt: "desc" }, include: grantInclude });
  const jobs = await tx.accountAnalysisJob.findMany({ where: { accountId }, orderBy: { createdAt: "desc" } });
  return { grants, jobs, quota: accountAnalysisQuota(grants, jobs) };
}

export async function getAccountVideoAnalysisState(user: ActiveUser) {
  const { upstream, ...data } = await lockedAccount(user.id, async (tx) => {
    await expireAccountJobs(tx, user.id, new Date());
    const { grants, jobs, quota } = await accountLedger(tx, user.id);
    const videos = await tx.accountAnalysisVideo.findMany({ where: { accountId: user.id }, orderBy: { uploadedAt: "asc" } });
    return { ok: true, accountId: user.id, quota, price: null, canAnalyze: quota.remaining > 0,
      canUpload: quota.grantTotal > 0, canPurchase: false, canReview: false,
      videos: videos.map((video) => ({ id: video.id, caption: video.caption, uploadedAt: video.uploadedAt,
        contentType: video.contentType, analysisSupported: supportedVideo(video),
        url: `/api/video-analysis/videos/${video.id}`,
        canDelete: !jobs.some((job) => job.videoId === video.id && ["QUEUED", "RUNNING"].includes(job.status)) })),
      jobs: jobs.map(jobDto), purchases: [],
      grants: grants.map((grant) => { const { id, quantity, note, createdAt, coach } = grantDto(grant); return { id, quantity, note, createdAt, coach }; }),
      payment: { coachName: "", wechatEnabled: false, wechatId: null, wechatQrUrl: null },
      upstream: new Map(jobs.map((job) => [job.id,
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
  input: { videoId: string; actionId: string; requestKey: string; expectedAccountId: string }) {
  if (input.expectedAccountId !== user.id) throw new AnalysisDomainError("state-changed");
  // Keep catalog/storage network reads outside row locks, and let an offline
  // duplicate reuse its original reservation without calling the catalog.
  const prepared = await lockedAccount(user.id, async (tx) => {
    const { jobs, quota } = await accountLedger(tx, user.id);
    const existing = jobs.find((job) => job.requestKey === input.requestKey);
    if (existing) {
      if (existing.videoId !== input.videoId || existing.actionId !== input.actionId) throw new AnalysisDomainError("request-conflict");
      return { kind: "existing" as const, reservation: { ok: true, job: jobDto(existing), quota } };
    }
    if (!isSubmittableFreeSkiActionId(input.actionId)) throw new AnalysisDomainError("unsupported-action");
    if (!isFreeSkiConfigured()) throw new AnalysisDomainError("service-not-configured");
    const video = await tx.accountAnalysisVideo.findFirst({ where: { id: input.videoId, accountId: user.id } });
    if (!video) throw new AnalysisDomainError("video-not-found");
    if (!supportedVideo(video)) throw new AnalysisDomainError("unsupported-video");
    if (quota.remaining < 1) throw new AnalysisDomainError("quota-exhausted");
    return { kind: "new" as const, storageKey: video.storageKey };
  });
  if (prepared.kind === "existing") {
    await ensureBusinessAnalysisQueued("account", prepared.reservation.job.id);
    return prepared.reservation;
  }
  const [actions, videoAvailable] = await Promise.all([
    getFreeSkiActionCatalog().catch(() => null), objectExists(prepared.storageKey),
  ]);
  const reservation = await lockedAccount(user.id, async (tx) => {
    await expireAccountJobs(tx, user.id, new Date());
    const { jobs, grants, quota } = await accountLedger(tx, user.id);
    const existing = jobs.find((job) => job.requestKey === input.requestKey);
    if (existing) {
      if (existing.videoId !== input.videoId || existing.actionId !== input.actionId) throw new AnalysisDomainError("request-conflict");
      return { ok: true, job: jobDto(existing), quota };
    }
    if (!actions) throw new AnalysisDomainError("service-unavailable");
    const catalogId = parseFreeSkiActionId(input.actionId)?.catalogId;
    if (!actions.some((action) => action.id === catalogId && action.available === true)) throw new AnalysisDomainError("unsupported-action");
    if (!isFreeSkiConfigured()) throw new AnalysisDomainError("service-not-configured");
    const video = await tx.accountAnalysisVideo.findFirst({ where: { id: input.videoId, accountId: user.id } });
    if (!video || video.storageKey !== prepared.storageKey || !videoAvailable) throw new AnalysisDomainError("video-not-found");
    if (!supportedVideo(video)) throw new AnalysisDomainError("unsupported-video");
    if (quota.remaining < 1) throw new AnalysisDomainError("quota-exhausted");
    const job = await tx.accountAnalysisJob.create({ data: { accountId: user.id, videoId: video.id,
      createdById: user.id, requestKey: input.requestKey, actionId: input.actionId,
      queuedExpiresAt: new Date(Date.now() + ANALYSIS_QUEUE_MINUTES * 60_000) } });
    return { ok: true, job: jobDto(job), quota: accountAnalysisQuota(grants, [...jobs, job]) };
  });
  await ensureBusinessAnalysisQueued("account", reservation.job.id);
  return reservation;
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
