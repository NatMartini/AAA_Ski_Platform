import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedAnalysisJob } from "./worker";
import type { FreeSkiAnalysisResult } from "./types";

const remote = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), submit: vi.fn(), resolve: vi.fn(),
  config: vi.fn(),
  bookingClaim: vi.fn(), bookingRelease: vi.fn(), bookingSettle: vi.fn(),
  accountClaim: vi.fn(), accountRelease: vi.fn(), accountSettle: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: {
  videoAnalysisJob: { findUnique: remote.find, updateMany: remote.update },
  accountAnalysisJob: { findUnique: remote.find, updateMany: remote.update },
} }));
vi.mock("../storage", () => ({ resolveKey: remote.resolve }));
vi.mock("./config", () => ({ getFreeSkiConfig: remote.config }));
vi.mock("./adapter", async (importOriginal) => ({ ...(await importOriginal<typeof import("./adapter")>()),
  submitFreeSkiAnalysis: remote.submit, getFreeSkiAnalysisJob: vi.fn(), cleanupFreeSkiJob: vi.fn() }));
vi.mock("../video-analysis/service", () => ({ claimAnalysisJob: remote.bookingClaim,
  releaseAnalysisJobToQueue: remote.bookingRelease, settleAnalysisJob: remote.bookingSettle }));
vi.mock("../video-analysis/account-service", () => ({ claimAccountAnalysisJob: remote.accountClaim,
  releaseAccountAnalysisJobToQueue: remote.accountRelease, settleAccountAnalysisJob: remote.accountSettle }));
import { FreeSkiError } from "./adapter";
import { AnalysisDispatcher, ensureBusinessAnalysisQueued, type DispatcherDependencies,
  type DurableAnalysis } from "./dispatcher";

const result: FreeSkiAnalysisResult = { version: 1, provider: "freeski", actionId: "parallel",
  gradingStatus: "graded", gradingReason: null, score: 0, scoreKind: "TECH", numTurns: 4,
  coachingZh: [], coachingEn: [], metrics: [], scorerVersion: "test" };
const upstream = "a".repeat(32);

beforeEach(() => { vi.resetAllMocks(); remote.config.mockReturnValue(null); });

describe("durable immediate upstream submission", () => {
  it.each(["booking", "account"] as const)("submits %s with a stable business idempotency key", async (scope) => {
    remote.find.mockResolvedValue({ id: "job", status: "QUEUED", refundedAt: null,
      upstreamJobId: null, actionId: "parallel", video: { storageKey: "private/video.mp4" } });
    remote.resolve.mockReturnValue("J:\\AAA_Ski_platform\\storage\\private\\video.mp4");
    remote.submit.mockResolvedValue(upstream);
    remote.update.mockResolvedValue({ count: 1 });
    const outcomes = await Promise.all([ensureBusinessAnalysisQueued(scope, "job"), ensureBusinessAnalysisQueued(scope, "job")]);
    expect(outcomes).toEqual([true, true]);
    expect(remote.submit).toHaveBeenCalledOnce();
    expect(remote.submit).toHaveBeenCalledWith(expect.objectContaining({ actionId: "parallel", requestKey: `aaa:${scope}:job` }));
    expect(remote.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ refundedAt: null, upstreamJobId: null }), data: { upstreamJobId: upstream },
    }));
  });

  it("keeps the committed reservation when runtime submission is unavailable, then retries the same key", async () => {
    remote.find.mockResolvedValue({ status: "QUEUED", refundedAt: null, upstreamJobId: null,
      actionId: "parallel", video: { storageKey: "private/video.mp4" } });
    remote.resolve.mockReturnValue("safe-local-video");
    remote.submit.mockRejectedValueOnce(new Error("private transport details")).mockResolvedValueOnce(upstream);
    remote.update.mockResolvedValue({ count: 1 });
    expect(await ensureBusinessAnalysisQueued("booking", "job")).toBe(false);
    expect(remote.update).not.toHaveBeenCalled();
    expect(await ensureBusinessAnalysisQueued("booking", "job")).toBe(true);
    expect(remote.submit.mock.calls.map(([payload]) => payload.requestKey)).toEqual(["aaa:booking:job", "aaa:booking:job"]);
  });
});

describe("retiring a definitively absent closed action", () => {
  function closedReservation(status = "QUEUED") {
    remote.find.mockResolvedValue({ id: "job", status, refundedAt: null, upstreamJobId: null,
      actionId: "carving", video: { storageKey: "private/video.mp4" } });
    remote.resolve.mockReturnValue("safe-local-video");
    remote.submit.mockRejectedValue(new FreeSkiError("analysis-action-closed"));
    remote.bookingRelease.mockResolvedValue(true);
    remote.accountRelease.mockResolvedValue(true);
  }

  it.each(["booking", "account"] as const)("refunds an unsubmitted %s reservation only once through its owning service", async (scope) => {
    closedReservation();
    const claim = scope === "booking" ? remote.bookingClaim : remote.accountClaim;
    const settle = scope === "booking" ? remote.bookingSettle : remote.accountSettle;
    const release = scope === "booking" ? remote.bookingRelease : remote.accountRelease;
    claim.mockResolvedValue({ id: "job", actionId: "carving", upstreamJobId: null, leaseToken: "retirement-lease" });
    settle.mockImplementation(async () => {
      remote.find.mockResolvedValue({ status: "FAILED", refundedAt: new Date() });
      return true;
    });
    expect(await ensureBusinessAnalysisQueued(scope, "job")).toBe(false);
    expect(await ensureBusinessAnalysisQueued(scope, "job")).toBe(false);
    expect(claim).toHaveBeenCalledExactlyOnceWith("job");
    expect(settle).toHaveBeenCalledExactlyOnceWith("job", "retirement-lease", { ok: false,
      errorCode: "UNSUPPORTED_ACTION", expectedUnsubmittedActionId: "carving" });
    expect(release).not.toHaveBeenCalled();
    expect(remote.update).not.toHaveBeenCalled();
    const otherClaim = scope === "booking" ? remote.accountClaim : remote.bookingClaim;
    expect(otherClaim).not.toHaveBeenCalled();
  });

  it.each(["analysis-invalid-action", "analysis-unavailable", "analysis-timeout", "analysis-failed"] as const)
    ("keeps the reservation retryable for %s without definitive absence evidence", async (code) => {
      closedReservation();
      remote.submit.mockRejectedValue(new FreeSkiError(code));
      expect(await ensureBusinessAnalysisQueued("booking", "job")).toBe(false);
      expect(remote.bookingClaim).not.toHaveBeenCalled();
      expect(remote.bookingSettle).not.toHaveBeenCalled();
    });

  it("does not trust a generic error with a closed-action code", async () => {
    closedReservation();
    remote.submit.mockRejectedValue(Object.assign(new Error("transport failed"), { code: "analysis-action-closed" }));
    expect(await ensureBusinessAnalysisQueued("booking", "job")).toBe(false);
    expect(remote.bookingClaim).not.toHaveBeenCalled();
  });

  it("does not steal a running reservation or a queued job claimed elsewhere", async () => {
    closedReservation("RUNNING");
    expect(await ensureBusinessAnalysisQueued("booking", "job")).toBe(false);
    expect(remote.bookingClaim).not.toHaveBeenCalled();
    closedReservation();
    remote.bookingClaim.mockResolvedValue(null);
    expect(await ensureBusinessAnalysisQueued("booking", "job")).toBe(false);
    expect(remote.bookingSettle).not.toHaveBeenCalled();
    expect(remote.bookingRelease).not.toHaveBeenCalled();
  });

  it.each([{ upstreamJobId: upstream, actionId: "carving" }, { upstreamJobId: null, actionId: "parallel" }])
    ("releases a retirement lease when the claimed identity changed (%j)", async (identity) => {
      closedReservation();
      remote.bookingClaim.mockResolvedValue({ id: "job", leaseToken: "lease", ...identity });
      expect(await ensureBusinessAnalysisQueued("booking", "job")).toBe(false);
      expect(remote.bookingSettle).not.toHaveBeenCalled();
      expect(remote.bookingRelease).toHaveBeenCalledExactlyOnceWith("job", "lease");
    });

  it.each(["rejected-guard", "transaction-error"])("releases the retirement lease after %s and retains retryability", async (failure) => {
    closedReservation();
    remote.accountClaim.mockResolvedValue({ id: "job", actionId: "carving", upstreamJobId: null, leaseToken: "lease" });
    if (failure === "transaction-error") remote.accountSettle.mockRejectedValue(new Error("database unavailable"));
    else remote.accountSettle.mockResolvedValue(false);
    expect(await ensureBusinessAnalysisQueued("account", "job")).toBe(false);
    expect(remote.accountRelease).toHaveBeenCalledExactlyOnceWith("job", "lease");
    expect(remote.update).not.toHaveBeenCalled();
  });
});

function harness() {
  const row: DurableAnalysis = { id: "job", scope: "booking", actionId: "parallel",
    status: "QUEUED", upstreamJobId: upstream, leaseToken: null };
  const deps: DispatcherDependencies = {
    list: vi.fn(async () => [{ ...row }]), enqueue: vi.fn(async () => true),
    read: vi.fn(async () => ({ status: "queued" as const, brokerStatus: "queued", result: null })),
    claim: vi.fn(async () => {
      row.status = "RUNNING"; row.leaseToken = "owned-lease";
      return { id: row.id, leaseToken: row.leaseToken } as ClaimedAnalysisJob;
    }),
    heartbeat: vi.fn(async () => true),
    release: vi.fn(async () => { row.status = "QUEUED"; row.leaseToken = null; return true; }),
    settle: vi.fn(async () => { row.status = "SUCCEEDED"; return true; }), cleanup: vi.fn(async () => true),
  };
  return { row, deps, dispatcher: new AnalysisDispatcher(deps) };
}

describe("broker driven business leases", () => {
  it("asks ModelCtrl to wake the provider only while durable work exists", async () => {
    const { dispatcher, deps } = harness();
    deps.wake = vi.fn(async () => "ready");
    await dispatcher.tick();
    expect(deps.wake).toHaveBeenCalledOnce();
    vi.mocked(deps.list).mockResolvedValue([]);
    await dispatcher.tick();
    expect(deps.wake).toHaveBeenCalledOnce();
  });

  it.each([
    ["accepted-deployment", null],
    ["accepted-deployment", "different-deployment"],
    [null, "new-deployment"],
  ])("does not poll or settle an accepted job from deployment %s with configuration %s", async (accepted, configured) => {
    const { dispatcher, deps, row } = harness();
    row.upstreamDeploymentId = accepted;
    remote.config.mockReturnValue(configured ? { deploymentId: configured } : null);
    vi.mocked(deps.read).mockResolvedValue({ status: "done", brokerStatus: "completed", result });
    expect(await dispatcher.tick()).toMatchObject({ settled: 0 });
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.cleanup).not.toHaveBeenCalled();
  });

  it("settles accepted work when its stored deployment matches the configured deployment", async () => {
    const { dispatcher, deps, row } = harness();
    row.upstreamDeploymentId = "accepted-deployment";
    remote.config.mockReturnValue({ deploymentId: "accepted-deployment" });
    vi.mocked(deps.read).mockResolvedValue({ status: "done", brokerStatus: "completed", result });
    expect(await dispatcher.tick()).toMatchObject({ settled: 1 });
    expect(deps.read).toHaveBeenCalledWith(upstream, "parallel", undefined);
    expect(deps.settle).toHaveBeenCalledOnce();
  });

  it.each(["queued", "interrupted", "cancelled", "unavailable", null])("does not claim or settle a broker %s job", async (brokerStatus) => {
    const { dispatcher, deps } = harness();
    vi.mocked(deps.read).mockResolvedValue({ status: "queued", brokerStatus, result: null });
    for (let attempt = 0; attempt < 3; attempt++) await dispatcher.tick();
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.heartbeat).not.toHaveBeenCalled();
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it("claims only real running work and releases the lease on preemption without refund", async () => {
    const { dispatcher, deps, row } = harness();
    vi.mocked(deps.read).mockResolvedValueOnce({ status: "running", brokerStatus: "running", result: null })
      .mockResolvedValueOnce({ status: "queued", brokerStatus: "queued", result: null })
      .mockResolvedValueOnce({ status: "running", brokerStatus: "running", result: null });
    await dispatcher.tick();
    expect(deps.claim).toHaveBeenCalledOnce();
    await dispatcher.tick();
    expect(deps.release).toHaveBeenCalledWith("booking", "job", "owned-lease");
    expect(row.status).toBe("QUEUED");
    expect(deps.settle).not.toHaveBeenCalled();
    await dispatcher.tick();
    expect(deps.claim).toHaveBeenCalledTimes(2);
    await dispatcher.close();
    expect(row.status).toBe("QUEUED");
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it.each(["compute_offline", "waiting_for_compute"] as const)("holds a job waiting for compute (%s) without settling, then finishes it", async (queueReason) => {
    const { dispatcher, deps, row } = harness();
    const waiting = { status: "queued" as const, brokerStatus: null, queueReason, result: null };
    vi.mocked(deps.read).mockResolvedValueOnce({ status: "running", brokerStatus: "running", result: null });
    for (let tick = 0; tick < 20; tick++) vi.mocked(deps.read).mockResolvedValueOnce(waiting);
    vi.mocked(deps.read).mockResolvedValueOnce({ status: "running", brokerStatus: "running", result: null })
      .mockResolvedValueOnce({ status: "done", brokerStatus: "completed", result });
    await dispatcher.tick();
    for (let tick = 0; tick < 20; tick++) await dispatcher.tick();
    expect(deps.release).toHaveBeenCalledOnce();
    expect(row.status).toBe("QUEUED");
    expect(deps.settle).not.toHaveBeenCalled();
    await dispatcher.tick();
    await dispatcher.tick();
    expect(deps.settle).toHaveBeenCalledWith("booking", "job", "owned-lease", { ok: true, result });
  });

  it("releases a claimed lease on an unavailable broker response", async () => {
    const { dispatcher, deps } = harness();
    vi.mocked(deps.read).mockResolvedValueOnce({ status: "running", brokerStatus: "running", result: null })
      .mockRejectedValueOnce(new Error("unavailable"));
    await dispatcher.tick(); await dispatcher.tick();
    expect(deps.release).toHaveBeenCalledOnce();
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it("settles a completed real zero, then cleans the private upstream artifacts", async () => {
    const { dispatcher, deps } = harness();
    vi.mocked(deps.read).mockResolvedValue({ status: "done", brokerStatus: "completed", result });
    expect(await dispatcher.tick()).toMatchObject({ settled: 1 });
    expect(deps.settle).toHaveBeenCalledWith("booking", "job", "owned-lease", { ok: true, result });
    expect(deps.cleanup).toHaveBeenCalledWith(upstream);
  });

  it("settles a definite model failure, while interrupted work stays reserved", async () => {
    const { dispatcher, deps } = harness();
    vi.mocked(deps.read).mockResolvedValueOnce({ status: "error", brokerStatus: "interrupted", result: null })
      .mockResolvedValueOnce({ status: "error", brokerStatus: "failed", result: null });
    await dispatcher.tick();
    expect(deps.settle).not.toHaveBeenCalled();
    await dispatcher.tick();
    expect(deps.settle).toHaveBeenCalledWith("booking", "job", "owned-lease", { ok: false, errorCode: "analysis-failed" });
  });

  it("does not steal another dispatcher's live lease", async () => {
    const { dispatcher, deps, row } = harness();
    row.status = "RUNNING"; row.leaseToken = "another-worker";
    vi.mocked(deps.read).mockResolvedValue({ status: "done", brokerStatus: "completed", result });
    await dispatcher.tick();
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it("submits the complete backlog before polling a running job", async () => {
    const { dispatcher, deps, row } = harness();
    const order: string[] = [];
    vi.mocked(deps.list).mockResolvedValue([{ ...row, id: "first", upstreamJobId: null }, row,
      { ...row, scope: "account", id: "last", upstreamJobId: null }]);
    vi.mocked(deps.enqueue).mockImplementation(async (scope, id) => { order.push(`${scope}:${id}`); return true; });
    vi.mocked(deps.read).mockImplementation(async () => { order.push("poll"); return { status: "queued", brokerStatus: "queued", result: null }; });
    await dispatcher.tick();
    expect(order).toEqual(["booking:first", "account:last", "poll"]);
  });
});
