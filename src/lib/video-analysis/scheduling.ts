import { freeSkiSchedulerState, getFreeSkiAnalysisJob, type FreeSkiQueueReason } from "../freeski/adapter";
import { getFreeSkiConfig } from "../freeski/config";

export type UpstreamAnalysisRef = { upstreamJobId: string | null; upstreamDeploymentId: string | null };
const MAX_UPSTREAM_READS = 10;
const LIVE = new Set(["QUEUED", "RUNNING"]);

/** Enrich an already-authorized snapshot without holding its database row lock. */
export async function withAnalysisQueueReasons<T extends { id: string; status: string; actionId: string }>(
  jobs: readonly T[], upstream: ReadonlyMap<string, UpstreamAnalysisRef> = new Map()) {
  const queued = jobs.filter((job) => job.status === "QUEUED");
  const config = getFreeSkiConfig();
  // Only jobs FreeSki already accepted, on the configured deployment, can say they wait for
  // compute (queued) or how far along they are (running).
  const accepted = config ? jobs.flatMap((job) => {
    const ref = upstream.get(job.id);
    return LIVE.has(job.status) && ref?.upstreamJobId && (ref.upstreamDeploymentId ?? null) === (config.deploymentId ?? null)
      ? [{ id: job.id, actionId: job.actionId, upstreamJobId: ref.upstreamJobId }] : [];
  }).slice(0, MAX_UPSTREAM_READS) : [];
  const [scheduler, states] = await Promise.all([
    queued.length > 0 ? freeSkiSchedulerState().catch(() => null) : null,
    Promise.all(accepted.map(async (job): Promise<[string, { queueReason: FreeSkiQueueReason | null; progress: number | null }]> => {
      const state = await getFreeSkiAnalysisJob(job.upstreamJobId, job.actionId, AbortSignal.timeout(3_000)).catch(() => null);
      return [job.id, { queueReason: state?.queueReason ?? null, progress: state?.progress ?? null }];
    })),
  ]);
  const reason = scheduler?.connected ? scheduler.waitingReason : null;
  const live = new Map(states);
  return jobs.map((job) => ({ ...job, queueReason: job.status === "QUEUED" ? reason : null,
    computeWait: job.status === "QUEUED" ? live.get(job.id)?.queueReason ?? null : null,
    progress: job.status === "RUNNING" ? live.get(job.id)?.progress ?? null : null }));
}
