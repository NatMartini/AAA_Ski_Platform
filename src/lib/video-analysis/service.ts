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
import { analysisParty, analysisQuota, AnalysisDomainError, ANALYSIS_LEASE_MINUTES,
  ANALYSIS_QUEUE_MINUTES, MAX_ANALYSIS_PURCHASE_QUANTITY } from "./quota";

const include = { videos: { orderBy: { uploadedAt: "asc" as const } },
  analysisJobs: { orderBy: { createdAt: "desc" as const } },
  analysisPurchases: { orderBy: { createdAt: "desc" as const } } } as const;
type AnalysisBooking = NonNullable<Awaited<ReturnType<typeof readBooking>>>;
const supportedVideo = (video: { contentType: string; bytes: number }) =>
  ["video/mp4", "video/quicktime"].includes(video.contentType) && video.bytes <= 200 * 1024 * 1024;
function readBooking(tx: Prisma.TransactionClient, id: string) {
  return tx.booking.findUnique({ where: { id }, include });
}
const jobDto = (job: AnalysisBooking["analysisJobs"][number]) => ({ id: job.id, videoId: job.videoId,
  actionId: job.actionId, status: job.status, createdAt: job.createdAt, finishedAt: job.finishedAt,
  result: job.result, errorCode: job.errorCode });
const purchaseDto = (purchase: AnalysisBooking["analysisPurchases"][number]) => ({
  id: purchase.id, quantity: purchase.quantity, unitPriceCents: purchase.unitPriceCents,
  totalCents: purchase.totalCents, currency: purchase.currency, status: purchase.status,
  paymentSubmittedAt: purchase.paymentSubmittedAt, reviewNote: purchase.reviewNote,
  updatedAt: purchase.updatedAt,
});

async function expireJobs(tx: Prisma.TransactionClient, bookingId: string, now: Date) {
  return tx.videoAnalysisJob.updateMany({ where: { bookingId, refundedAt: null, OR: [
    { status: "RUNNING", leaseExpiresAt: { lte: now } },
    { status: "RUNNING", startedAt: { lte: new Date(now.getTime() - 60 * 60_000) } },
  ] }, data: { status: "QUEUED", startedAt: null, errorCode: null,
    leaseToken: null, leaseExpiresAt: null } });
}
async function locked<T>(code: string, user: ActiveUser,
  work: (tx: Prisma.TransactionClient, booking: AnalysisBooking) => Promise<T>, mode: "act" | "view" = "act",
  recoverLeases = true): Promise<T> {
  const found = await prisma.booking.findUnique({ where: { code }, select: { id: true } });
  if (!found) throw new AnalysisDomainError("not-found");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${found.id} FOR UPDATE`;
    let booking = await readBooking(tx, found.id);
    if (!booking) throw new AnalysisDomainError("not-found");
    const access = analysisParty(booking, user);
    if (!(mode === "view" ? access.canView : access.canAct)) throw new AnalysisDomainError("forbidden");
    if (recoverLeases && (await expireJobs(tx, found.id, new Date())).count > 0) booking = (await readBooking(tx, found.id))!;
    return work(tx, booking);
  });
}
const completed = (booking: AnalysisBooking) => {
  if (booking.status !== "COMPLETED") throw new AnalysisDomainError("lesson-not-completed");
};

export async function getVideoAnalysisState(code: string, user: ActiveUser) {
  const { upstream, ...data } = await locked(code, user, async (tx, booking) => {
    const party = analysisParty(booking, user);
    const quota = analysisQuota(booking, booking.analysisJobs, booking.analysisPurchases);
    const profile = await tx.coachProfile.findUnique({ where: { userId: booking.coachId } });
    const paidEnabled = !!profile?.analysisCreditPriceCents && profile.wechatPayEnabled;
    return { ok: true, quota, price: paidEnabled ? { unitCents: profile!.analysisCreditPriceCents!, currency: "CAD" } : null,
      canAnalyze: party.canAct && quota.active && quota.remaining > 0,
      canUpload: party.canAct && ["CONFIRMED", "COMPLETED"].includes(booking.status),
      canPurchase: party.isCustomer && quota.active && paidEnabled, canReview: party.isCoach,
      videos: booking.videos.map((video) => ({ id: video.id, caption: video.caption, uploadedAt: video.uploadedAt,
        contentType: video.contentType, analysisSupported: supportedVideo(video),
        url: `/api/bookings/${code}/videos/${video.id}`, canDelete: (party.isCoach || (party.isCustomer && video.uploadedById === user.id)) &&
          !booking.analysisJobs.some((job) => job.videoId === video.id && ["QUEUED", "RUNNING"].includes(job.status)) })),
      jobs: booking.analysisJobs.map(jobDto), purchases: booking.analysisPurchases.map(purchaseDto),
      payment: { coachName: profile?.displayName ?? "", wechatEnabled: profile?.wechatPayEnabled ?? false,
        wechatId: profile?.wechatId ?? null,
        wechatQrUrl: profile?.wechatPayEnabled && profile.wechatPayQrKey ? `/api/files/qr/${booking.coachId}?kind=wechat` : null },
      upstream: new Map(booking.analysisJobs.map((job) => [job.id,
        { upstreamJobId: job.upstreamJobId, upstreamDeploymentId: job.upstreamDeploymentId }])),
    };
  }, "view");
  const [service, jobs, actions] = await Promise.all([
    freeSkiServiceState().catch(() => ({ configured: isFreeSkiConfigured(), available: false })),
    withAnalysisQueueReasons(data.jobs, upstream),
    getFreeSkiActionCatalog().catch(() => []),
  ]);
  return { ...data, jobs, canAnalyze: data.canAnalyze && service.configured && service.available && actions.some((action) => action.available), actions, service };
}

export async function requestVideoAnalysis(code: string, user: ActiveUser,
  input: { videoId: string; actionId: string; requestKey: string }) {
  // Authorize and reuse retries before any upstream request. This first pass
  // is read-only; a failed catalog lookup must not alter the credit ledger.
  const prepared = await locked(code, user, async (_tx, booking) => {
    const existing = booking.analysisJobs.find((job) => job.requestKey === input.requestKey);
    if (existing) {
      if (existing.videoId !== input.videoId || existing.actionId !== input.actionId) throw new AnalysisDomainError("request-conflict");
      return { kind: "existing" as const, reservation: { ok: true, job: jobDto(existing),
        quota: analysisQuota(booking, booking.analysisJobs, booking.analysisPurchases) } };
    }
    completed(booking);
    if (!isSubmittableFreeSkiActionId(input.actionId)) throw new AnalysisDomainError("unsupported-action");
    if (!isFreeSkiConfigured()) throw new AnalysisDomainError("service-not-configured");
    const video = booking.videos.find((item) => item.id === input.videoId);
    if (!video) throw new AnalysisDomainError("video-not-found");
    if (!supportedVideo(video)) throw new AnalysisDomainError("unsupported-video");
    if (analysisQuota(booking, booking.analysisJobs, booking.analysisPurchases).remaining < 1) throw new AnalysisDomainError("quota-exhausted");
    return { kind: "new" as const, storageKey: video.storageKey };
  }, "act", false);
  if (prepared.kind === "existing") {
    await ensureBusinessAnalysisQueued("booking", prepared.reservation.job.id);
    return prepared.reservation;
  }
  const [actions, videoAvailable] = await Promise.all([
    getFreeSkiActionCatalog().catch(() => null), objectExists(prepared.storageKey),
  ]);
  const reservation = await locked(code, user, async (tx, booking) => {
    const existing = booking.analysisJobs.find((job) => job.requestKey === input.requestKey);
    if (existing) {
      if (existing.videoId !== input.videoId || existing.actionId !== input.actionId) throw new AnalysisDomainError("request-conflict");
      return { ok: true, job: jobDto(existing), quota: analysisQuota(booking, booking.analysisJobs, booking.analysisPurchases) };
    }
    completed(booking);
    if (!actions) throw new AnalysisDomainError("service-unavailable");
    const catalogId = parseFreeSkiActionId(input.actionId)?.catalogId;
    if (!actions.some((action) => action.id === catalogId && action.available === true)) throw new AnalysisDomainError("unsupported-action");
    if (!isFreeSkiConfigured()) throw new AnalysisDomainError("service-not-configured");
    const video = booking.videos.find((item) => item.id === input.videoId);
    if (!video || video.storageKey !== prepared.storageKey || !videoAvailable) throw new AnalysisDomainError("video-not-found");
    if (!supportedVideo(video)) throw new AnalysisDomainError("unsupported-video");
    const quota = analysisQuota(booking, booking.analysisJobs, booking.analysisPurchases);
    if (quota.remaining < 1) throw new AnalysisDomainError("quota-exhausted");
    const job = await tx.videoAnalysisJob.create({ data: { bookingId: booking.id, videoId: video.id,
      createdById: user.id, requestKey: input.requestKey, actionId: input.actionId,
      queuedExpiresAt: new Date(Date.now() + ANALYSIS_QUEUE_MINUTES * 60_000) } });
    return { ok: true, job: jobDto(job), quota: analysisQuota(booking, [...booking.analysisJobs, job], booking.analysisPurchases) };
  });
  // Commit quota/ownership first. Upstream submission immediately announces
  // FreeSki demand to the broker; an outage leaves this reservation queued.
  await ensureBusinessAnalysisQueued("booking", reservation.job.id);
  return reservation;
}

export async function createAnalysisPurchase(code: string, user: ActiveUser, input: { quantity: number; requestKey: string; expectedUnitPriceCents?: number }) {
  return locked(code, user, async (tx, booking) => {
    if (!analysisParty(booking, user).isCustomer) throw new AnalysisDomainError("forbidden");
    const existing = booking.analysisPurchases.find((p) => p.requestKey === input.requestKey);
    if (existing) {
      if (existing.quantity !== input.quantity) throw new AnalysisDomainError("request-conflict");
      return { ok: true, purchase: purchaseDto(existing) };
    }
    completed(booking);
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_ANALYSIS_PURCHASE_QUANTITY) throw new AnalysisDomainError("invalid-quantity");
    const profile = await tx.coachProfile.findUnique({ where: { userId: booking.coachId } });
    if (!profile?.analysisCreditPriceCents || !profile.wechatPayEnabled) throw new AnalysisDomainError("purchase-not-configured");
    if (input.expectedUnitPriceCents !== undefined && input.expectedUnitPriceCents !== profile.analysisCreditPriceCents) throw new AnalysisDomainError("price-changed");
    const purchase = await tx.videoAnalysisPurchase.create({ data: { bookingId: booking.id, accountId: user.id,
      payeeCoachId: booking.coachId, requestKey: input.requestKey, quantity: input.quantity,
      unitPriceCents: profile.analysisCreditPriceCents, totalCents: profile.analysisCreditPriceCents * input.quantity } });
    return { ok: true, purchase: purchaseDto(purchase) };
  });
}

export async function submitAnalysisPayment(code: string, purchaseId: string, user: ActiveUser, reference?: string) {
  return locked(code, user, async (tx, booking) => {
    completed(booking);
    const purchase = booking.analysisPurchases.find((p) => p.id === purchaseId);
    if (!purchase) throw new AnalysisDomainError("not-found");
    if (!["AWAITING_PAYMENT", "PAYMENT_REJECTED"].includes(purchase.status)) throw new AnalysisDomainError("invalid-state");
    const updated = await tx.videoAnalysisPurchase.update({ where: { id: purchase.id }, data: {
      status: "PENDING_PAYMENT_REVIEW", paymentMethod: "WECHAT", paymentReference: reference?.trim() || null,
      paymentSubmittedAt: new Date(), reviewNote: null } });
    return { ok: true, purchase: purchaseDto(updated) };
  });
}

export async function reviewAnalysisPayment(code: string, purchaseId: string, user: ActiveUser,
  input: { action: "confirm" | "reject"; note?: string | null; manualReceipt?: { method: "WECHAT"; reference?: string };
    expectedUpdatedAt: string }) {
  return locked(code, user, async (tx, booking) => {
    if (!analysisParty(booking, user).isCoach) throw new AnalysisDomainError("forbidden");
    completed(booking);
    const purchase = booking.analysisPurchases.find((p) => p.id === purchaseId);
    if (!purchase) throw new AnalysisDomainError("not-found");
    if (purchase.payeeCoachId !== booking.coachId) throw new AnalysisDomainError("forbidden");
    if (input.manualReceipt && input.action !== "confirm") throw new AnalysisDomainError("invalid-state");
    if (purchase.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new AnalysisDomainError("state-changed");
    if (input.manualReceipt ? !["AWAITING_PAYMENT", "PAYMENT_REJECTED"].includes(purchase.status) : purchase.status !== "PENDING_PAYMENT_REVIEW") {
      throw new AnalysisDomainError("invalid-state");
    }
    const now = new Date();
    const updated = await tx.videoAnalysisPurchase.update({ where: { id: purchase.id }, data: {
      status: input.action === "confirm" ? "CONFIRMED" : "PAYMENT_REJECTED", reviewedById: user.id,
      reviewedAt: now, reviewNote: input.note?.trim() || null,
      ...(input.action === "reject" ? { paymentSubmittedAt: null } : {}),
      ...(input.manualReceipt ? { paymentMethod: "WECHAT", paymentSubmittedAt: now,
        paymentReference: input.manualReceipt.reference?.trim() || null } : {}),
    } });
    return { ok: true, purchase: purchaseDto(updated), quota: analysisQuota(booking, booking.analysisJobs,
      booking.analysisPurchases.map((p) => p.id === updated.id ? updated : p)) };
  });
}

export async function cancelAnalysisPurchase(code: string, purchaseId: string, user: ActiveUser) {
  return locked(code, user, async (tx, booking) => {
    const purchase = booking.analysisPurchases.find((p) => p.id === purchaseId);
    if (!purchase) throw new AnalysisDomainError("not-found");
    if (!["AWAITING_PAYMENT", "PAYMENT_REJECTED"].includes(purchase.status)) throw new AnalysisDomainError("invalid-state");
    const updated = await tx.videoAnalysisPurchase.update({ where: { id: purchase.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    return { ok: true, purchase: purchaseDto(updated) };
  });
}

/** Worker-only: take one reservation once, serialized with deletion and refunds. */
export async function claimAnalysisJob(jobId?: string) {
  await recoverExpiredAnalysisJobs();
  const found = await prisma.videoAnalysisJob.findFirst({ where: { ...(jobId ? { id: jobId } : {}), status: "QUEUED" },
    orderBy: { createdAt: "asc" }, select: { id: true, bookingId: true } });
  if (!found) return null;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${found.bookingId} FOR UPDATE`;
    const job = await tx.videoAnalysisJob.findUnique({ where: { id: found.id }, include: { video: true, booking: { select: { status: true } } } });
    if (!job || job.status !== "QUEUED" || job.refundedAt) return null;
    if (!job.video || !isFreeSkiActionId(job.actionId) || job.booking.status !== "COMPLETED") {
      await tx.videoAnalysisJob.update({ where: { id: job.id }, data: { status: "FAILED", refundedAt: new Date(),
        finishedAt: new Date(), errorCode: "INVALID_VIDEO" } });
      return null;
    }
    const leaseToken = randomUUID();
    await tx.videoAnalysisJob.update({ where: { id: job.id }, data: { status: "RUNNING", startedAt: new Date(),
      leaseToken, leaseExpiresAt: new Date(Date.now() + ANALYSIS_LEASE_MINUTES * 60_000), attempts: { increment: 1 } } });
    return { id: job.id, bookingId: job.bookingId, videoId: job.videoId, storageKey: job.video.storageKey,
      actionId: job.actionId, upstreamJobId: job.upstreamJobId, leaseToken };
  });
}

export async function heartbeatAnalysisJob(id: string, leaseToken: string) {
  return (await prisma.videoAnalysisJob.updateMany({ where: { id, status: "RUNNING", leaseToken,
    refundedAt: null, leaseExpiresAt: { gt: new Date() }, startedAt: { gt: new Date(Date.now() - 60 * 60_000) } },
    data: { leaseExpiresAt: new Date(Date.now() + ANALYSIS_LEASE_MINUTES * 60_000) } })).count === 1;
}
export async function releaseAnalysisJobToQueue(id: string, leaseToken: string) {
  return (await prisma.videoAnalysisJob.updateMany({ where: { id, status: "RUNNING", leaseToken,
    refundedAt: null }, data: { status: "QUEUED", startedAt: null, leaseToken: null,
    leaseExpiresAt: null, errorCode: null } })).count === 1;
}
export async function attachUpstreamJobId(id: string, leaseToken: string, upstreamJobId: string) {
  if (!upstreamJobId || upstreamJobId.length > 200) return false;
  const deploymentId = getFreeSkiConfig()?.deploymentId;
  return (await prisma.videoAnalysisJob.updateMany({ where: { id, status: "RUNNING", leaseToken,
    leaseExpiresAt: { gt: new Date() }, startedAt: { gt: new Date(Date.now() - 60 * 60_000) },
    refundedAt: null, upstreamJobId: null }, data: { upstreamJobId,
      ...(deploymentId ? { upstreamDeploymentId: deploymentId, upstreamApiVersion: 2 } : {}) } })).count === 1;
}
const SAFE_FAILURE_CODES = new Set(["TIMED_OUT", "SERVICE_UNAVAILABLE", "SERVICE_NOT_CONFIGURED", "INVALID_VIDEO", "UNSUPPORTED_ACTION", "ANALYSIS_FAILED"]);
const FAILURE_ALIASES: Record<string, string> = {
  "analysis-unconfigured": "SERVICE_NOT_CONFIGURED", "analysis-unavailable": "SERVICE_UNAVAILABLE",
  "analysis-auth-failed": "SERVICE_UNAVAILABLE", "analysis-timeout": "TIMED_OUT",
  "analysis-cancelled": "TIMED_OUT", "analysis-invalid-video": "INVALID_VIDEO",
  "analysis-invalid-action": "UNSUPPORTED_ACTION",
};
export async function settleAnalysisJob(id: string, leaseToken: string,
  outcome: { ok: true; result: FreeSkiAnalysisResult } |
    { ok: false; errorCode: string; expectedUnsubmittedActionId?: string }) {
  const found = await prisma.videoAnalysisJob.findUnique({ where: { id }, select: { bookingId: true } });
  if (!found) return false;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${found.bookingId} FOR UPDATE`;
    const now = new Date();
    const usable = outcome.ok && analysisResultUsable(outcome.result);
    const unsubmittedGuard = !outcome.ok && outcome.expectedUnsubmittedActionId !== undefined
      ? { upstreamJobId: null, actionId: outcome.expectedUnsubmittedActionId } : {};
    const result = await tx.videoAnalysisJob.updateMany({ where: { id, status: "RUNNING", leaseToken,
      refundedAt: null, leaseExpiresAt: { gt: now }, startedAt: { gt: new Date(now.getTime() - 60 * 60_000) },
      ...unsubmittedGuard }, data: usable ? {
      status: "SUCCEEDED", result: outcome.ok ? outcome.result as unknown as Prisma.InputJsonValue : Prisma.DbNull,
      finishedAt: now, leaseToken: null, leaseExpiresAt: null,
    } : { status: "FAILED", refundedAt: now, finishedAt: now, leaseToken: null, leaseExpiresAt: null,
      result: outcome.ok ? { ...outcome.result, gradingStatus: "unavailable", score: null, scoreKind: null,
        gradingReason: outcome.result.gradingReason ?? "score-unavailable" } as unknown as Prisma.InputJsonValue : Prisma.DbNull,
      errorCode: outcome.ok ? "UNGRADABLE" : SAFE_FAILURE_CODES.has(outcome.errorCode) ? outcome.errorCode : FAILURE_ALIASES[outcome.errorCode] ?? "ANALYSIS_FAILED" } });
    return result.count === 1;
  });
}
export async function recoverExpiredAnalysisJobs(bookingIds?: readonly string[]) {
  if (bookingIds?.length === 0) return 0;
  const now = new Date();
  const stale = await prisma.videoAnalysisJob.findMany({ where: {
    ...(bookingIds ? { bookingId: { in: [...bookingIds] } } : {}), OR: [
    { status: "RUNNING", leaseExpiresAt: { lte: now } },
    { status: "RUNNING", startedAt: { lte: new Date(now.getTime() - 60 * 60_000) } },
  ] }, select: { bookingId: true }, distinct: ["bookingId"] });
  let count = 0;
  for (const { bookingId } of stale) count += await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
    return (await expireJobs(tx, bookingId, now)).count;
  });
  return count;
}
