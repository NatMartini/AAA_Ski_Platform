import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { FreeSkiError, readFreeSkiReportJson, requestFreeSkiReportResource } from "../freeski/adapter";
import { getFreeSkiConfig } from "../freeski/config";
import { coachingReportSchema } from "../freeski/report-v2";
import { keyframesSchema, THINKING_LEVELS, type ThinkingLevel } from "../freeski/scorecard";
import { ANALYSIS_TIERS, storedTier, TIER_FEATURES, TIER_THINKING, type AnalysisTier } from "./tiers";

/**
 * Everything a tier shows is made before its report appears (owner's decision, 2026-11-09): the written explanation at
 * the tier's depth and, from deep up, the slow-motion explainer and every turn's key frames. FreeSki makes each of
 * these when it is first asked for, so a finished analysis is asked for all of them here and stays "in progress" for
 * the student until they are ready. `preparedTier` is null while they are being made.
 */
export type AddonState = "pending" | "running" | "ready" | "unavailable" | "failed";
export type PrepareState = {
  teaching: AddonState | null;
  /** Null for tiers without the explainer video. */
  explainer: AddonState | null;
  /** Key frames made so far, of the turns that have any; null for tiers without them. */
  keyframes: { ready: number; total: number } | null;
};

/** How long a tier's outputs may take before the report appears with what there is; the rest follows in the report. */
export const PREPARE_DEADLINE_MINUTES = 45;
const FINAL: readonly (AddonState | null)[] = ["ready", "unavailable", "failed"];

/** Two tiers ask FreeSki for the same things: the same explanation depth, with or without the turn media. */
export function sameOutputs(a: AnalysisTier, b: AnalysisTier) {
  return TIER_THINKING[a] === TIER_THINKING[b] && TIER_FEATURES[a].media === TIER_FEATURES[b].media;
}

type JobRow = { status: string; refundedAt: Date | null; preparedTier: string | null };
/** A scored analysis whose tier is still being completed: in progress for the student, with no report yet. */
export const isPreparing = (job: JobRow) => job.status === "SUCCEEDED" && !job.refundedAt && job.preparedTier === null;

/** What changing the tier does to the preparation: nothing when the outputs are the same, else it starts over. */
export function preparationAfterTierChange(job: JobRow & { tier: string }, next: AnalysisTier, now = new Date()) {
  if (job.status !== "SUCCEEDED") return {};
  if (job.preparedTier !== null && sameOutputs(storedTier(job.preparedTier), next)) return { preparedTier: next };
  return { preparedTier: null, prepareStartedAt: now, preparedAt: null, prepareState: Prisma.DbNull };
}

/** Parses the stored progress leniently: anything else is "not known yet". */
export function readPrepareState(value: unknown): PrepareState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const state = (item: unknown): AddonState | null => typeof item === "string" && ["pending", "running", "ready", "unavailable", "failed"].includes(item) ? item as AddonState : null;
  const frames = raw.keyframes as { ready?: unknown; total?: unknown } | null | undefined;
  return { teaching: state(raw.teaching), explainer: state(raw.explainer),
    keyframes: frames && Number.isInteger(frames.ready) && Number.isInteger(frames.total) ? { ready: frames.ready as number, total: frames.total as number } : null };
}

/** Whether everything the tier needs has reached its final state. */
export function outputsComplete(state: PrepareState, tier: AnalysisTier) {
  if (!FINAL.includes(state.teaching) || state.teaching === null) return false;
  if (!TIER_FEATURES[tier].media) return true;
  return state.explainer !== null && FINAL.includes(state.explainer) && state.keyframes !== null && state.keyframes.ready >= state.keyframes.total;
}

export type AnalysisScope = "booking" | "account";
type Source = { id: string; status: string; refundedAt: Date | null; tier: string; preparedTier: string | null; prepareStartedAt: Date | null;
  finishedAt: Date | null; upstreamJobId: string | null; upstreamDeploymentId: string | null; upstreamApiVersion: number | null };
const select = { id: true, status: true, refundedAt: true, tier: true, preparedTier: true, prepareStartedAt: true, finishedAt: true,
  upstreamJobId: true, upstreamDeploymentId: true, upstreamApiVersion: true } as const;

const read = (scope: AnalysisScope, id: string): Promise<Source | null> => scope === "account"
  ? prisma.accountAnalysisJob.findUnique({ where: { id }, select }) : prisma.videoAnalysisJob.findUnique({ where: { id }, select });
/** Writes only while the job still waits for this tier: a tier changed meanwhile starts its own preparation. */
async function write(scope: AnalysisScope, job: Source, data: Prisma.AccountAnalysisJobUpdateManyMutationInput) {
  const where = { id: job.id, status: "SUCCEEDED", refundedAt: null, preparedTier: null, tier: job.tier };
  const result = scope === "account" ? await prisma.accountAnalysisJob.updateMany({ where, data })
    : await prisma.videoAnalysisJob.updateMany({ where, data: data as Prisma.VideoAnalysisJobUpdateManyMutationInput });
  return result.count === 1;
}

/** The explanation depths below a tier's own that some tier uses, deepest first. */
export function shorterLevels(tier: AnalysisTier): ThinkingLevel[] {
  const own = THINKING_LEVELS.indexOf(TIER_THINKING[tier]);
  return THINKING_LEVELS.filter((level, index) => index < own && ANALYSIS_TIERS.some(other => TIER_THINKING[other] === level)).reverse();
}

/** Asks FreeSki for everything the job's tier shows and says how far each has got. Throws when FreeSki cannot be read. */
async function askForOutputs(job: Source & { upstreamJobId: string; upstreamDeploymentId: string }, tier: AnalysisTier, signal?: AbortSignal): Promise<PrepareState> {
  const source = { jobId: job.upstreamJobId, deploymentId: job.upstreamDeploymentId, signal };
  const response = await requestFreeSkiReportResource({ ...source, resource: "report", thinking: TIER_THINKING[tier] });
  if (!response.ok) { await response.body?.cancel(); throw new FreeSkiError("analysis-unavailable"); }
  const report = coachingReportSchema.parse(await readFreeSkiReportJson(response));
  if (report.jobId !== job.upstreamJobId || report.deploymentId !== job.upstreamDeploymentId) throw new FreeSkiError("analysis-invalid-response");
  // An analysis without a score card has no explanation to write.
  let teaching: AddonState = report.teachingStatus ?? "unavailable";
  // The tier's own explanation could not be written: a shorter one is better than none, and the report shows it in
  // its place. Asking starts it; the next look finds how far it has got.
  for (const level of teaching === "failed" ? shorterLevels(tier) : []) {
    const shorter = await requestFreeSkiReportResource({ ...source, resource: "report", thinking: level });
    if (!shorter.ok) { await shorter.body?.cancel(); throw new FreeSkiError("analysis-unavailable"); }
    const status = coachingReportSchema.parse(await readFreeSkiReportJson(shorter)).teachingStatus ?? "unavailable";
    if (status === "failed" || status === "unavailable") continue;
    teaching = status;
    break;
  }
  if (!TIER_FEATURES[tier].media) return { teaching, explainer: null, keyframes: null };
  let ready = 0, total = 0;
  for (const turn of report.turns) {
    const frames = await requestFreeSkiReportResource({ ...source, resource: "keyframes", turnId: turn.turnId });
    if (!frames.ok) { await frames.body?.cancel(); throw new FreeSkiError("analysis-unavailable"); }
    const manifest = keyframesSchema.parse(await readFreeSkiReportJson(frames));
    // A turn the report has nothing to point at has no key frames to wait for.
    if (manifest.status === "unavailable") continue;
    total++;
    if (manifest.status === "ready") ready++;
  }
  return { teaching, explainer: report.explainerStatus ?? "unavailable", keyframes: { ready, total } };
}

/**
 * One look at a finished analysis whose tier is still being completed: asks FreeSki for the tier's outputs, records
 * how far they are, and marks the tier prepared once all are final or the deadline has passed.
 */
export async function prepareJobOutputs(scope: AnalysisScope, id: string, options: { signal?: AbortSignal; now?: Date } = {}): Promise<"ready" | "waiting" | "skipped"> {
  const job = await read(scope, id);
  if (!job || !isPreparing(job)) return "skipped";
  const now = options.now ?? new Date(), tier = storedTier(job.tier);
  // The first time round, this is when the analysis is finished for its owner; a later change of tier keeps that time.
  const first = job.prepareStartedAt !== null && job.finishedAt !== null && job.prepareStartedAt.getTime() === job.finishedAt.getTime();
  const done = (state?: PrepareState) => write(scope, job, { preparedTier: tier, preparedAt: now, ...(first ? { finishedAt: now } : {}), ...(state ? { prepareState: state } : {}) });
  // An analysis this deployment cannot read has nothing more to make.
  if (!job.upstreamJobId || !job.upstreamDeploymentId || job.upstreamApiVersion !== 2 || job.upstreamDeploymentId !== getFreeSkiConfig()?.deploymentId) {
    await done();
    return "ready";
  }
  const started = job.prepareStartedAt ?? job.finishedAt ?? now;
  const overdue = now.getTime() - started.getTime() > PREPARE_DEADLINE_MINUTES * 60_000;
  let state: PrepareState;
  try {
    state = await askForOutputs({ ...job, upstreamJobId: job.upstreamJobId, upstreamDeploymentId: job.upstreamDeploymentId }, tier, options.signal);
  } catch {
    // FreeSki asleep or busy: asked again on the next round; past the deadline the report appears with what there is.
    if (!overdue) return "waiting";
    await done();
    return "ready";
  }
  if (outputsComplete(state, tier) || overdue) {
    await done(state);
    return "ready";
  }
  await write(scope, job, { prepareState: state });
  return "waiting";
}

const nextLook = new Map<string, number>();
const due = { status: "SUCCEEDED", refundedAt: null, preparedTier: null } as const;

/** How many finished analyses still wait for their tier's outputs. */
export async function countPreparing(jobId?: string) {
  const where = { ...due, ...(jobId ? { id: jobId } : {}) };
  const [account, booking] = await Promise.all([prisma.accountAnalysisJob.count({ where }), prisma.videoAnalysisJob.count({ where })]);
  return account + booking;
}

/**
 * The dispatcher's round: every waiting analysis is looked at, soon after it is scored and then every ten seconds, so
 * a long explanation does not mean a request a second.
 */
export async function prepareDueOutputs(options: { signal?: AbortSignal; jobId?: string } = {}) {
  const where = { ...due, ...(options.jobId ? { id: options.jobId } : {}) };
  const pick = { id: true, prepareStartedAt: true } as const;
  const [account, booking] = await Promise.all([
    prisma.accountAnalysisJob.findMany({ where, select: pick, orderBy: { prepareStartedAt: "asc" }, take: 20 }),
    prisma.videoAnalysisJob.findMany({ where, select: pick, orderBy: { prepareStartedAt: "asc" }, take: 20 }),
  ]);
  const jobs = [...account.map(job => ({ ...job, scope: "account" as const })), ...booking.map(job => ({ ...job, scope: "booking" as const }))];
  const live = new Set(jobs.map(job => `${job.scope}:${job.id}`));
  for (const key of nextLook.keys()) if (!live.has(key)) nextLook.delete(key);
  let prepared = 0;
  for (const job of jobs) {
    if (options.signal?.aborted) break;
    const key = `${job.scope}:${job.id}`, now = Date.now();
    if ((nextLook.get(key) ?? 0) > now) continue;
    const young = now - (job.prepareStartedAt?.getTime() ?? now) < 60_000;
    nextLook.set(key, now + (young ? 4_000 : 10_000));
    if (await prepareJobOutputs(job.scope, job.id, { signal: options.signal }).catch(() => "waiting") === "ready") {
      prepared++;
      nextLook.delete(key);
    }
  }
  return prepared;
}
