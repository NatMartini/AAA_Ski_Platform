import { setTimeout as delay } from "node:timers/promises";
import { FreeSkiError, type runFreeSkiAnalysis } from "./adapter";
import type { FreeSkiAnalysisResult } from "./types";

export type ClaimedAnalysisJob = {
  id: string;
  storageKey: string;
  actionId: string;
  upstreamJobId?: string | null;
  leaseToken: string;
};
type Outcome = { ok: true; result: FreeSkiAnalysisResult } | { ok: false; errorCode: string };
export type AnalysisWorkerDependencies = {
  resolveVideo: (storageKey: string) => string;
  heartbeat: (id: string, lease: string) => Promise<boolean>;
  attach: (id: string, lease: string, upstreamId: string) => Promise<boolean>;
  settle: (id: string, lease: string, outcome: Outcome) => Promise<boolean>;
  analyze: typeof runFreeSkiAnalysis;
  cleanup: (upstreamId: string) => Promise<boolean>;
};

/** The heartbeat, submission and settlement are all awaited; no detached GPU request. */
export async function processAnalysisJob(job: ClaimedAnalysisJob, deps: AnalysisWorkerDependencies,
  options: { signal?: AbortSignal; heartbeatIntervalMs?: number } = {}) {
  const local = new AbortController();
  const signal = options.signal ? AbortSignal.any([local.signal, options.signal]) : local.signal;
  let upstreamId = job.upstreamJobId;
  let heartbeatTask: Promise<void> | undefined;
  let outcome: Outcome;
  try {
    if (signal.aborted || !await deps.heartbeat(job.id, job.leaseToken)) throw new FreeSkiError("analysis-cancelled");
    heartbeatTask = (async () => {
      while (!signal.aborted) {
        try {
          await delay(options.heartbeatIntervalMs ?? 30_000, undefined, { signal });
          if (!await deps.heartbeat(job.id, job.leaseToken)) local.abort();
        } catch {
          local.abort();
        }
      }
    })();
    const result = await deps.analyze({ videoPath: deps.resolveVideo(job.storageKey), actionId: job.actionId,
      upstreamJobId: upstreamId, signal, onSubmitted: async (id) => {
        upstreamId = id;
        return deps.attach(job.id, job.leaseToken, id);
      } });
    outcome = { ok: true, result };
  } catch (error) {
    outcome = { ok: false, errorCode: error instanceof FreeSkiError ? error.code : "analysis-failed" };
  } finally {
    local.abort();
    await heartbeatTask;
  }
  const settled = await deps.settle(job.id, job.leaseToken, outcome);
  let cleaned = false;
  if (settled && upstreamId) cleaned = await deps.cleanup(upstreamId).catch(() => false);
  return { settled, cleaned, graded: outcome.ok && outcome.result.gradingStatus === "graded" };
}
