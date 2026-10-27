import { prisma } from "../prisma";
import { resolveKey } from "../storage";
import { cleanupFreeSkiJob, FreeSkiError, getFreeSkiAnalysisJob, submitFreeSkiAnalysis, type FreeSkiUpstreamJob } from "./adapter";
import type { FreeSkiAnalysisResult } from "./types";
import type { ClaimedAnalysisJob } from "./worker";
import { getFreeSkiConfig } from "./config";
import { wakeFreeSkiProvider } from "./wake";

export type AnalysisScope = "booking" | "account";
export type DurableAnalysis = {
  id: string; scope: AnalysisScope; actionId: string; status: string;
  upstreamJobId: string | null; leaseToken: string | null;
  upstreamDeploymentId?: string | null;
};
type Outcome = { ok: true; result: FreeSkiAnalysisResult } |
  { ok: false; errorCode: string; expectedUnsubmittedActionId?: string };
const submitting = new Map<string, Promise<boolean>>();

async function retireUnsubmittedClosedAction(scope: AnalysisScope, id: string, actionId: string): Promise<void> {
  // Import only after submission definitively proved absence. Services import
  // this dispatcher themselves, so static imports would introduce a cycle.
  const service = scope === "booking" ? await import("../video-analysis/service") : await import("../video-analysis/account-service");
  const claim = "claimAnalysisJob" in service ? service.claimAnalysisJob : service.claimAccountAnalysisJob;
  const release = "releaseAnalysisJobToQueue" in service ? service.releaseAnalysisJobToQueue : service.releaseAccountAnalysisJobToQueue;
  const settle = "settleAnalysisJob" in service ? service.settleAnalysisJob : service.settleAccountAnalysisJob;
  // Claiming checks QUEUED under its row lock; a live RUNNING lease is never stolen.
  const claimed = await claim(id);
  if (!claimed) return;
  let settled = false;
  try {
    if (claimed.upstreamJobId !== null || claimed.actionId !== actionId) return;
    settled = await settle(id, claimed.leaseToken, { ok: false, errorCode: "UNSUPPORTED_ACTION",
      expectedUnsubmittedActionId: actionId });
  } finally {
    // Settlement repeats the absence/action guard atomically. If an upstream
    // attachment won the race, release this lease and keep tracking that job.
    if (!settled) await release(id, claimed.leaseToken).catch(() => false);
  }
}

/** Called after the reservation commits, with stable remote idempotency on retries. */
export async function ensureBusinessAnalysisQueued(scope: AnalysisScope, id: string): Promise<boolean> {
  const key = `${scope}:${id}`;
  const active = submitting.get(key);
  if (active) return active;
  const operation = (async () => {
    try {
      const job = scope === "booking"
        ? await prisma.videoAnalysisJob.findUnique({ where: { id }, include: { video: true } })
        : await prisma.accountAnalysisJob.findUnique({ where: { id }, include: { video: true } });
      if (!job || job.refundedAt || !["QUEUED", "RUNNING"].includes(job.status)) return false;
      if (job.upstreamJobId) return true;
      if (!job.video) return false;
      let upstreamJobId: string;
      try {
        upstreamJobId = await submitFreeSkiAnalysis({ videoPath: resolveKey(job.video.storageKey),
          actionId: job.actionId, requestKey: `aaa:${scope}:${id}` });
      } catch (error) {
        if (job.status === "QUEUED" && error instanceof FreeSkiError && error.code === "analysis-action-closed")
          await retireUnsubmittedClosedAction(scope, id, job.actionId);
        return false;
      }
      const where = { id, status: { in: ["QUEUED", "RUNNING"] }, refundedAt: null, upstreamJobId: null };
      const deploymentId = getFreeSkiConfig()?.deploymentId;
      const data = { upstreamJobId, ...(deploymentId ? { upstreamDeploymentId: deploymentId, upstreamApiVersion: 2 } : {}) };
      const attached = scope === "booking"
        ? await prisma.videoAnalysisJob.updateMany({ where, data })
        : await prisma.accountAnalysisJob.updateMany({ where, data });
      return attached.count === 1;
    } catch {
      // The reservation is already durable. A missing broker/runtime or lost
      // HTTP response is retried with the same key; it never consumes/refunds.
      return false;
    }
  })();
  submitting.set(key, operation);
  try { return await operation; } finally { submitting.delete(key); }
}

export type DispatcherDependencies = {
  list: () => Promise<DurableAnalysis[]>;
  enqueue: (scope: AnalysisScope, id: string) => Promise<boolean>;
  read: (id: string, actionId: string, signal?: AbortSignal) => Promise<FreeSkiUpstreamJob>;
  claim: (scope: AnalysisScope, id: string) => Promise<ClaimedAnalysisJob | null>;
  heartbeat: (scope: AnalysisScope, id: string, lease: string) => Promise<boolean>;
  release: (scope: AnalysisScope, id: string, lease: string) => Promise<boolean>;
  settle: (scope: AnalysisScope, id: string, lease: string, outcome: Outcome) => Promise<boolean>;
  cleanup: (id: string) => Promise<boolean>;
  /** Asks ModelCtrl to start the on-demand provider; it never starts one itself. */
  wake?: () => Promise<unknown>;
};

/** Lightweight queue/lease reconciler. It never starts a model or waits on GPU work. */
export class AnalysisDispatcher {
  private owned = new Map<string, { scope: AnalysisScope; id: string; lease: string }>();
  constructor(private readonly deps: DispatcherDependencies) {}

  async tick(signal?: AbortSignal): Promise<{ observed: number; settled: number }> {
    const jobs = await this.deps.list();
    // Live work keeps the provider awake; an idle queue lets ModelCtrl stop it.
    if (jobs.length > 0 && !signal?.aborted) await this.deps.wake?.();
    let settled = 0;
    // Submit the complete durable backlog before polling any running item.
    for (const job of jobs) {
      if (signal?.aborted) break;
      if (!job.upstreamJobId) await this.deps.enqueue(job.scope, job.id);
    }
    for (const job of jobs) {
      if (signal?.aborted) break;
      if (!job.upstreamJobId) continue;
      // Switching configured instances must not send an old accepted job to a
      // different environment. Drain the previous deployment before cutover.
      const configuredDeployment = getFreeSkiConfig()?.deploymentId ?? null;
      if ((job.upstreamDeploymentId ?? null) !== configuredDeployment) continue;
      const key = `${job.scope}:${job.id}`;
      const previous = this.owned.get(key);
      let state: FreeSkiUpstreamJob;
      try { state = await this.deps.read(job.upstreamJobId, job.actionId, signal); }
      catch {
        if (previous) {
          await this.deps.release(job.scope, job.id, previous.lease);
          this.owned.delete(key);
        }
        continue;
      }
      const failed = state.brokerStatus === "failed" ||
        (state.status === "error" && state.brokerStatus === "completed");
      const ready = state.brokerStatus === "running" || state.status === "done" || failed;
      if (!ready) {
        // Includes resource waits, preemption, unavailable status and manual
        // interrupted/cancelled states. None is a failed customer analysis.
        if (previous) {
          await this.deps.release(job.scope, job.id, previous.lease);
          this.owned.delete(key);
        }
        continue;
      }
      let lease = previous?.lease;
      if (job.status === "QUEUED") {
        const claimed = await this.deps.claim(job.scope, job.id);
        if (!claimed) continue;
        lease = claimed.leaseToken;
        this.owned.set(key, { scope: job.scope, id: job.id, lease });
      } else if (!lease || lease !== job.leaseToken) {
        // Another dispatcher owns the unexpired lease. Never steal it.
        continue;
      }
      if (!await this.deps.heartbeat(job.scope, job.id, lease)) {
        this.owned.delete(key);
        continue;
      }
      if (state.status === "done" && state.result || failed) {
        const outcome: Outcome = state.status === "done" && state.result
          ? { ok: true, result: state.result } : { ok: false, errorCode: "analysis-failed" };
        if (await this.deps.settle(job.scope, job.id, lease, outcome)) {
          settled++;
          await this.deps.cleanup(job.upstreamJobId).catch(() => false);
        }
        this.owned.delete(key);
      }
    }
    return { observed: jobs.length, settled };
  }

  async close(): Promise<void> {
    for (const owned of this.owned.values())
      await this.deps.release(owned.scope, owned.id, owned.lease);
    this.owned.clear();
  }
}

export async function createBusinessAnalysisDispatcher(jobId?: string): Promise<AnalysisDispatcher> {
  const booking = await import("../video-analysis/service");
  const account = await import("../video-analysis/account-service");
  return new AnalysisDispatcher({
    list: async () => {
      await booking.recoverExpiredAnalysisJobs();
      await account.recoverExpiredAccountAnalysisJobs();
      const where = { ...(jobId ? { id: jobId } : {}), status: { in: ["QUEUED", "RUNNING"] }, refundedAt: null };
      const select = { id: true, actionId: true, status: true, upstreamJobId: true, leaseToken: true, upstreamDeploymentId: true };
      const [bookingJobs, accountJobs] = await Promise.all([
        prisma.videoAnalysisJob.findMany({ where, select, orderBy: { createdAt: "asc" } }),
        prisma.accountAnalysisJob.findMany({ where, select, orderBy: { createdAt: "asc" } }),
      ]);
      return [...bookingJobs.map((job) => ({ ...job, scope: "booking" as const })),
        ...accountJobs.map((job) => ({ ...job, scope: "account" as const }))];
    },
    enqueue: ensureBusinessAnalysisQueued,
    read: getFreeSkiAnalysisJob,
    claim: (scope, id) => scope === "booking" ? booking.claimAnalysisJob(id) : account.claimAccountAnalysisJob(id),
    heartbeat: (scope, id, lease) => scope === "booking" ? booking.heartbeatAnalysisJob(id, lease) : account.heartbeatAccountAnalysisJob(id, lease),
    release: (scope, id, lease) => scope === "booking" ? booking.releaseAnalysisJobToQueue(id, lease) : account.releaseAccountAnalysisJobToQueue(id, lease),
    settle: (scope, id, lease, outcome) => scope === "booking" ? booking.settleAnalysisJob(id, lease, outcome) : account.settleAccountAnalysisJob(id, lease, outcome),
    cleanup: cleanupFreeSkiJob,
    // The background dispatcher may wait for a cold start; pages never do.
    wake: () => wakeFreeSkiProvider({ reason: "aaa dispatcher", waitSeconds: 30 }),
  });
}
