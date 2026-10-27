import { createHash } from "node:crypto";
import { Prisma, type CoachVideoReviewRequest, type CoachVideoReviewScope } from "@prisma/client";
import { prisma } from "../prisma";
import type { ActiveUser } from "../auth/require-user";
import { AnalysisDomainError } from "./quota";

export const VIDEO_REVIEW_CONSENT = "video-review-v1";
export type ReviewSubject = { scope: CoachVideoReviewScope; videoId: string; bookingCode?: string };
const liveStates = ["REQUESTED", "IN_REVIEW", "PUBLISHED"] as const;
type Tx = Prisma.TransactionClient;
type Source = { id: string; storageKey: string; bytes: number; contentType: string; uploadedAt: Date; caption: string | null; bookingId: string | null };
const fail = (reason: string): never => { throw new AnalysisDomainError(reason); };

function sourceVersion(video: Source) {
  return createHash("sha256").update(JSON.stringify([video.id, video.storageKey, video.bytes,
    video.contentType, video.uploadedAt.toISOString()])).digest("hex");
}

async function ownerLocked<T>(accountId: string, work: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    // All review transitions share the account lock; video deletion may win first,
    // but a removed source never grants access through a historical request.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${accountId} FOR UPDATE`;
    const owner = await tx.user.findUnique({ where: { id: accountId }, select: { disabledAt: true } });
    if (!owner || owner.disabledAt) fail("not-found");
    return work(tx);
  });
}

async function freshActor(tx: Tx, user: ActiveUser) {
  const actor = await tx.user.findUnique({ where: { id: user.id }, select: { id: true, role: true, disabledAt: true } });
  if (!actor || actor.disabledAt) return fail("forbidden");
  return actor;
}

async function sourceFor(tx: Tx, accountId: string, subject: ReviewSubject): Promise<Source> {
  if (subject.scope === "ACCOUNT") {
    const video = await tx.accountAnalysisVideo.findFirst({ where: { id: subject.videoId, accountId } });
    if (!video) return fail("video-not-found");
    return { ...video, bookingId: null };
  }
  const video = await tx.lessonVideo.findFirst({ where: { id: subject.videoId,
    booking: { accountId, ...(subject.bookingCode ? { code: subject.bookingCode } : {}) } },
    include: { booking: { select: { id: true, accountId: true } } } });
  if (!video || video.booking.accountId !== accountId) return fail("video-not-found");
  return { ...video, bookingId: video.booking.id };
}

/** A prior lesson or a personal grant permits selection, never access by itself. */
async function eligibleCoaches(tx: Tx, accountId: string) {
  const bookings = await tx.booking.findMany({ where: { accountId, status: { in: ["CONFIRMED", "COMPLETED"] } }, select: { coachId: true } });
  const grants = await tx.accountAnalysisGrant.findMany({ where: { accountId }, select: { coachId: true } });
  const ids = [...new Set([...bookings, ...grants].map((row) => row.coachId))].filter((id) => id !== accountId);
  if (!ids.length) return [];
  const coaches = await tx.user.findMany({ where: { id: { in: ids }, disabledAt: null, role: { in: ["COACH", "ADMIN"] }, coachProfile: { isNot: null } },
    select: { id: true, name: true, coachProfile: { select: { displayName: true } } }, orderBy: { id: "asc" } });
  return coaches.map((coach) => ({ id: coach.id, name: coach.coachProfile?.displayName ?? coach.name ?? "Coach" }));
}

function reviewDto(row: CoachVideoReviewRequest, viewer: "owner" | "coach", coachName?: string) {
  return { id: row.id, accountId: row.accountId, coachId: row.coachId, coachName, scope: row.scope,
    videoId: row.sourceVideoId, caption: row.captionSnapshot, status: row.status, revision: row.revision,
    consentedAt: row.consentedAt, consentVersion: row.consentVersion, createdAt: row.createdAt,
    publishedAt: row.publishedAt, cancelledAt: row.cancelledAt,
    publishedText: row.publishedText, draftText: viewer === "coach" ? row.draftText : null,
    videoViewedAt: viewer === "coach" ? row.videoViewedAt : null,
    mediaUrl: `/api/video-analysis/coach-feedback/${row.id}/video`,
    // The source report is frozen internally for audit. Do not expose arbitrary
    // provider JSON or use it as a coach-authored draft.
    hasAnalysisSnapshot: row.analysisSnapshot !== null };
}

export async function getCoachFeedbackState(user: ActiveUser, subject: ReviewSubject) {
  return ownerLocked(user.id, async (tx) => {
    await freshActor(tx, user);
    await sourceFor(tx, user.id, subject);
    const coaches = await eligibleCoaches(tx, user.id);
    const rows = await tx.coachVideoReviewRequest.findMany({ where: { accountId: user.id, scope: subject.scope, sourceVideoId: subject.videoId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 });
    const current = rows.find((row) => liveStates.includes(row.status as typeof liveStates[number])) ?? null;
    return { ok: true, accountId: user.id, consentVersion: VIDEO_REVIEW_CONSENT, coaches,
      status: current?.status ?? "NOT_REQUESTED", current: current ? reviewDto(current, "owner", coaches.find((coach) => coach.id === current.coachId)?.name) : null,
      history: rows.map((row) => reviewDto(row, "owner", coaches.find((coach) => coach.id === row.coachId)?.name)) };
  });
}

export async function requestCoachFeedback(user: ActiveUser, input: ReviewSubject & {
  expectedAccountId: string; coachId: string; requestKey: string; consent: true; consentVersion: string;
  expectedCurrentId: string | null; expectedRevision: number | null;
}) {
  if (input.expectedAccountId !== user.id) fail("state-changed");
  if (input.consent !== true || input.consentVersion !== VIDEO_REVIEW_CONSENT) fail("consent-required");
  return ownerLocked(user.id, async (tx) => {
    await freshActor(tx, user);
    const source = await sourceFor(tx, user.id, input);
    const existing = await tx.coachVideoReviewRequest.findUnique({ where: { accountId_requestKey: { accountId: user.id, requestKey: input.requestKey } } });
    if (existing) {
      if (existing.scope !== input.scope || existing.sourceVideoId !== input.videoId || existing.coachId !== input.coachId) fail("request-conflict");
      return { ok: true, request: reviewDto(existing, "owner") };
    }
    if (!(await eligibleCoaches(tx, user.id)).some((coach) => coach.id === input.coachId)) fail("coach-not-eligible");
    const current = await tx.coachVideoReviewRequest.findFirst({ where: { accountId: user.id, scope: input.scope, sourceVideoId: input.videoId,
      status: { in: [...liveStates] } } });
    if ((current?.id ?? null) !== input.expectedCurrentId || (current?.revision ?? null) !== input.expectedRevision) fail("state-changed");
    if (current) await tx.coachVideoReviewRequest.update({ where: { id: current.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), revision: { increment: 1 } } });
    const analysis = input.scope === "ACCOUNT"
      ? await tx.accountAnalysisJob.findFirst({ where: { accountId: user.id, videoId: source.id, status: "SUCCEEDED" }, orderBy: { createdAt: "desc" },
        select: { id: true, result: true, updatedAt: true } })
      : await tx.videoAnalysisJob.findFirst({ where: { bookingId: source.bookingId!, videoId: source.id, status: "SUCCEEDED" }, orderBy: { createdAt: "desc" },
        select: { id: true, result: true, updatedAt: true } });
    const row = await tx.coachVideoReviewRequest.create({ data: { accountId: user.id, coachId: input.coachId,
      scope: input.scope, sourceVideoId: source.id, bookingId: source.bookingId,
      lessonVideoId: input.scope === "LESSON" ? source.id : null, accountVideoId: input.scope === "ACCOUNT" ? source.id : null,
      requestKey: input.requestKey, status: "REQUESTED", consentVersion: VIDEO_REVIEW_CONSENT,
      sourceVersion: sourceVersion(source), captionSnapshot: source.caption,
      ...(analysis ? { analysisSnapshot: { id: analysis.id, capturedVersionAt: analysis.updatedAt.toISOString(), result: analysis.result } as Prisma.InputJsonValue } : {}) } });
    return { ok: true, request: reviewDto(row, "owner") };
  });
}

async function reviewLocked<T>(id: string, user: ActiveUser, work: (tx: Tx, row: CoachVideoReviewRequest, viewer: "owner" | "coach") => Promise<T>) {
  const found = await prisma.coachVideoReviewRequest.findUnique({ where: { id }, select: { accountId: true } });
  if (!found) return fail("not-found");
  return ownerLocked(found.accountId, async (tx) => {
    const row = await tx.coachVideoReviewRequest.findUnique({ where: { id } });
    if (!row) return fail("not-found");
    const actor = await freshActor(tx, user);
    if (row.accountId === user.id) return work(tx, row, "owner");
    // No administrator override and no "issued credits" implicit permission.
    if (row.coachId !== user.id || !["COACH", "ADMIN"].includes(actor.role) || !liveStates.includes(row.status as typeof liveStates[number])) return fail("not-found");
    if (!(await eligibleCoaches(tx, row.accountId)).some((coach) => coach.id === user.id)) return fail("not-found");
    const video = await sourceFor(tx, row.accountId, { scope: row.scope, videoId: row.sourceVideoId });
    if (sourceVersion(video) !== row.sourceVersion) return fail("video-not-found");
    return work(tx, row, "coach");
  });
}

export async function getCoachFeedback(id: string, user: ActiveUser) {
  return reviewLocked(id, user, async (_tx, row, viewer) => ({ ok: true, viewer, request: reviewDto(row, viewer) }));
}

export async function cancelCoachFeedback(id: string, user: ActiveUser, expectedRevision: number) {
  return reviewLocked(id, user, async (tx, row, viewer) => {
    if (viewer !== "owner") return fail("forbidden");
    if (row.revision !== expectedRevision) return fail("state-changed");
    if (row.status === "CANCELLED") return { ok: true, request: reviewDto(row, viewer) };
    const updated = await tx.coachVideoReviewRequest.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), revision: { increment: 1 } } });
    return { ok: true, request: reviewDto(updated, viewer) };
  });
}

export async function updateCoachFeedback(id: string, user: ActiveUser, input: {
  expectedRevision: number; action: "start" | "save" | "publish"; text?: string;
  watchedVideo?: boolean; authoredByMe?: boolean; publishConfirmed?: boolean;
}) {
  return reviewLocked(id, user, async (tx, row, viewer) => {
    if (viewer !== "coach") return fail("forbidden");
    if (input.expectedRevision !== row.revision) return fail("state-changed");
    if (input.action === "start") {
      if (row.status !== "REQUESTED") return fail("invalid-state");
      const updated = await tx.coachVideoReviewRequest.update({ where: { id }, data: { status: "IN_REVIEW", revision: { increment: 1 } } });
      return { ok: true, request: reviewDto(updated, viewer) };
    }
    if (row.status !== "IN_REVIEW") return fail("invalid-state");
    if (typeof input.text !== "string") return fail("validation");
    const text = input.text.trim();
    if (text.length > 8000 || (input.action === "publish" && !text)) return fail("validation");
    if (input.action === "publish" && (!row.videoViewedAt || input.watchedVideo !== true || input.authoredByMe !== true || input.publishConfirmed !== true)) return fail("review-attestation-required");
    const updated = await tx.coachVideoReviewRequest.update({ where: { id }, data: { draftText: text,
      ...(input.action === "publish" ? { status: "PUBLISHED", publishedText: text, publishedAt: new Date(), authoredAt: new Date() } : {}),
      revision: { increment: 1 } } });
    return { ok: true, request: reviewDto(updated, viewer) };
  });
}

/** Called for each new media request, including Range, never from a cached DTO. */
export async function getCoachFeedbackVideo(id: string, user: ActiveUser, markViewed = false) {
  return reviewLocked(id, user, async (tx, row, viewer) => {
    if (viewer === "coach" && row.status === "REQUESTED") return fail("invalid-state");
    if (row.status === "CANCELLED") return fail("not-found");
    const source = await sourceFor(tx, row.accountId, { scope: row.scope, videoId: row.sourceVideoId });
    if (sourceVersion(source) !== row.sourceVersion) return fail("video-not-found");
    if (markViewed && viewer === "coach" && row.status === "IN_REVIEW" && !row.videoViewedAt) {
      await tx.coachVideoReviewRequest.update({ where: { id }, data: { videoViewedAt: new Date() } });
    }
    return { storageKey: source.storageKey, contentType: source.contentType, bytes: source.bytes };
  });
}

export async function listAssignedCoachFeedback(user: ActiveUser) {
  // getCoachFeedback performs fresh actor/assignment/source checks per row.
  if (!["COACH", "ADMIN"].includes(user.role)) return fail("forbidden");
  const rows = await prisma.coachVideoReviewRequest.findMany({ where: { coachId: user.id, status: { in: [...liveStates] } }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true } });
  const requests = [];
  for (const row of rows) {
    try { requests.push((await getCoachFeedback(row.id, user)).request); }
    catch (error) { if (!(error instanceof AnalysisDomainError)) throw error; }
  }
  return { ok: true, coachId: user.id, requests };
}
