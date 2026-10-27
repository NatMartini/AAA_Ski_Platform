import { freeSkiSchedulerState, getFreeSkiAnalysisJob, type FreeSkiQueueReason } from "../freeski/adapter";
import { getFreeSkiConfig } from "../freeski/config";

export type UpstreamAnalysisRef = { upstreamJobId: string | null; upstreamDeploymentId: string | null };
const MAX_UPSTREAM_READS = 10;

/** Enrich an already-authorized snapshot without holding its database row lock. */
export async function withAnalysisQueueReasons<T extends { id: string; status: string; actionId: string }>(
  jobs: readonly T[], upstream: ReadonlyMap<string, UpstreamAnalysisRef> = new Map()) {
  const queued = jobs.filter((job) => job.status === "QUEUED");
  const config = getFreeSkiConfig();
  // Only jobs FreeSki already accepted, on the configured deployment, can say they wait for compute.
  const accepted = config ? queued.flatMap((job) => {
    const ref = upstream.get(job.id);
    return ref?.upstreamJobId && (ref.upstreamDeploymentId ?? null) === (config.deploymentId ?? null)
      ? [{ id: job.id, actionId: job.actionId, upstreamJobId: ref.upstreamJobId }] : [];
  }).slice(0, MAX_UPSTREAM_READS) : [];
  const [scheduler, waits] = await Promise.all([
    queued.length > 0 ? freeSkiSchedulerState().catch(() => null) : null,
    Promise.all(accepted.map(async (job): Promise<[string, FreeSkiQueueReason | null]> => {
      const state = await getFreeSkiAnalysisJob(job.upstreamJobId, job.actionId, AbortSignal.timeout(3_000)).catch(() => null);
      return [job.id, state?.queueReason ?? null];
    })),
  ]);
  const reason = scheduler?.connected ? scheduler.waitingReason : null;
  const computeWait = new Map(waits);
  return jobs.map((job) => ({ ...job, queueReason: job.status === "QUEUED" ? reason : null,
    computeWait: job.status === "QUEUED" ? computeWait.get(job.id) ?? null : null }));
}
