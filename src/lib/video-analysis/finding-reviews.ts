import { NextResponse } from "next/server";
import { z } from "zod";
import type { CoachVideoReviewScope } from "@prisma/client";
import { prisma } from "../prisma";
import type { ActiveUser } from "../auth/require-user";
import { isTrustedApiWrite } from "../request-origin";
import { readJsonBody } from "../request-body";
import { DynamicReportError } from "./dynamic-report";
import { FINDING_KEY } from "./finding-key";

/**
 * Coach verdicts on FreeSki's teaching findings.
 *
 * A lesson's coach, or a coach the student authorized for a personal clip, marks each finding
 * agree/disagree. The student sees the verdicts; FreeSki later pulls them as labelled data to
 * calibrate the comparison. Nothing here touches credits or the upstream job.
 */
const metricKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const findingReviewSchema = z.object({
  findingKey: z.string().regex(FINDING_KEY), verdict: z.enum(["AGREE", "DISAGREE"]),
  note: z.string().trim().max(500).optional(), metricKeys: z.array(metricKey).max(8).default([]),
}).strict();
export type FindingReviewInput = z.infer<typeof findingReviewSchema>;

type Reviewable = { scope: CoachVideoReviewScope; jobId: string; actionId: string; viewer: "owner" | "coach" };

/** The job, if this person may read its findings; `coach` viewers may also write verdicts. */
export async function loadReviewableJob(scope: string, jobId: string, user: ActiveUser): Promise<Reviewable> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) throw new DynamicReportError(404, "not-found");
  const coachRole = user.role === "COACH" || user.role === "ADMIN";
  const finished = { refundedAt: null, status: "SUCCEEDED", videoId: { not: null } } as const;
  if (scope === "booking") {
    const job = await prisma.videoAnalysisJob.findFirst({ where: { id: jobId, ...finished,
      booking: { OR: [{ accountId: user.id }, ...(coachRole ? [{ coachId: user.id }] : [])] } },
      select: { id: true, actionId: true, booking: { select: { accountId: true, coachId: true } } } });
    if (!job) throw new DynamicReportError(404, "not-found");
    return { scope: "LESSON", jobId: job.id, actionId: job.actionId, viewer: coachRole && job.booking.coachId === user.id ? "coach" : "owner" };
  }
  if (scope === "account") {
    const job = await prisma.accountAnalysisJob.findFirst({ where: { id: jobId, ...finished },
      select: { id: true, actionId: true, accountId: true, videoId: true } });
    if (!job) throw new DynamicReportError(404, "not-found");
    if (job.accountId === user.id) return { scope: "ACCOUNT", jobId: job.id, actionId: job.actionId, viewer: "owner" };
    // A coach reaches a personal clip only through the student's live review authorization.
    const authorized = coachRole && await prisma.coachVideoReviewRequest.findFirst({ where: { coachId: user.id, accountId: job.accountId,
      scope: "ACCOUNT", sourceVideoId: job.videoId!, status: { in: ["IN_REVIEW", "PUBLISHED"] } }, select: { id: true } });
    if (!authorized) throw new DynamicReportError(404, "not-found");
    return { scope: "ACCOUNT", jobId: job.id, actionId: job.actionId, viewer: "coach" };
  }
  throw new DynamicReportError(404, "not-found");
}

const coachSelect = { id: true, name: true, coachProfile: { select: { displayName: true } } } as const;

export async function listFindingReviews(scope: string, jobId: string, user: ActiveUser) {
  const job = await loadReviewableJob(scope, jobId, user);
  const rows = await prisma.analysisFindingReview.findMany({ where: { scope: job.scope, jobId: job.jobId },
    include: { coach: { select: coachSelect } }, orderBy: { updatedAt: "desc" }, take: 200 });
  return { ok: true as const, viewer: job.viewer, canReview: job.viewer === "coach",
    reviews: rows.map((row) => ({ findingKey: row.findingKey, verdict: row.verdict, note: row.note, metricKeys: row.metricKeys,
      coachName: row.coach.coachProfile?.displayName ?? row.coach.name ?? "", mine: row.coachId === user.id, updatedAt: row.updatedAt.toISOString() })) };
}

export async function saveFindingReview(scope: string, jobId: string, user: ActiveUser, input: FindingReviewInput) {
  const job = await loadReviewableJob(scope, jobId, user);
  if (job.viewer !== "coach") throw new DynamicReportError(403, "coach-required");
  const data = { verdict: input.verdict, note: input.note || null, metricKeys: input.metricKeys, actionId: job.actionId };
  await prisma.analysisFindingReview.upsert({
    where: { scope_jobId_findingKey_coachId: { scope: job.scope, jobId: job.jobId, findingKey: input.findingKey, coachId: user.id } },
    create: { scope: job.scope, jobId: job.jobId, findingKey: input.findingKey, coachId: user.id, ...data }, update: data });
  return listFindingReviews(scope, jobId, user);
}

export async function removeFindingReview(scope: string, jobId: string, user: ActiveUser, findingKey: string) {
  const job = await loadReviewableJob(scope, jobId, user);
  if (job.viewer !== "coach") throw new DynamicReportError(403, "coach-required");
  await prisma.analysisFindingReview.deleteMany({ where: { scope: job.scope, jobId: job.jobId, findingKey, coachId: user.id } });
  return listFindingReviews(scope, jobId, user);
}

/** Everything one coach has marked, newest first: the export FreeSki calibrates from. */
export async function listCoachFindingReviews(user: ActiveUser) {
  if (user.role !== "COACH" && user.role !== "ADMIN") throw new DynamicReportError(403, "coach-required");
  const rows = await prisma.analysisFindingReview.findMany({ where: { coachId: user.id }, orderBy: { updatedAt: "desc" }, take: 500 });
  return { ok: true as const, coachId: user.id, reviews: rows.map((row) => ({ scope: row.scope, jobId: row.jobId, findingKey: row.findingKey,
    actionId: row.actionId, metricKeys: row.metricKeys, verdict: row.verdict, note: row.note, updatedAt: row.updatedAt.toISOString() })) };
}

const headers = { "Cache-Control": "private, no-store" };

export async function handleFindingReviews(input: { scope: string; jobId: string; resource: string[]; user: ActiveUser; request: Request }): Promise<Response> {
  const { request, user } = input;
  if (input.resource.length !== 1) throw new DynamicReportError(404, "not-found");
  if (request.method === "GET") return NextResponse.json(await listFindingReviews(input.scope, input.jobId, user), { headers });
  if (!isTrustedApiWrite(request)) throw new DynamicReportError(403, "invalid-origin");
  if (request.method === "POST") {
    const body = findingReviewSchema.parse(await readJsonBody(request, { maxBytes: 8192 }));
    return NextResponse.json(await saveFindingReview(input.scope, input.jobId, user, body), { headers });
  }
  if (request.method === "DELETE") {
    const { findingKey } = z.object({ findingKey: z.string().regex(FINDING_KEY) }).strict().parse(await readJsonBody(request, { maxBytes: 1024 }));
    return NextResponse.json(await removeFindingReview(input.scope, input.jobId, user, findingKey), { headers });
  }
  throw new DynamicReportError(405, "method-not-allowed");
}
