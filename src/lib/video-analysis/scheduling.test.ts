import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduler = vi.hoisted(() => vi.fn());
const upstreamJob = vi.hoisted(() => vi.fn());
const config = vi.hoisted(() => vi.fn());
vi.mock("../freeski/adapter", () => ({ freeSkiSchedulerState: scheduler, getFreeSkiAnalysisJob: upstreamJob }));
vi.mock("../freeski/config", () => ({ getFreeSkiConfig: config }));
import { withAnalysisQueueReasons, type UpstreamAnalysisRef } from "./scheduling";

beforeEach(() => {
  vi.resetAllMocks();
  config.mockReturnValue({ deploymentId: "freeski-platform-8100" });
  upstreamJob.mockResolvedValue({ status: "queued", brokerStatus: null, queueReason: null, progress: null, result: null });
});
const job = (id: string, status: string) => ({ id, status, actionId: "parallel" });
const accepted = (upstreamJobId: string, upstreamDeploymentId: string | null = "freeski-platform-8100"): UpstreamAnalysisRef =>
  ({ upstreamJobId, upstreamDeploymentId });

describe("authorized analysis queue snapshot", () => {
  it("reads one scheduler snapshot for a complete queued backlog and leaves other states unchanged", async () => {
    const reason = "待命：等待门卫切换";
    scheduler.mockResolvedValue({ connected: true, runtimeState: "stopped", waitingReason: reason });
    const jobs = [job("one", "QUEUED"), job("two", "QUEUED"), job("active", "RUNNING"), job("done", "SUCCEEDED"), job("failed", "FAILED")];
    const enriched = await withAnalysisQueueReasons(jobs);
    expect(scheduler).toHaveBeenCalledOnce();
    expect(enriched.map((job) => job.queueReason)).toEqual([reason, reason, null, null, null]);
    expect(jobs.every((job) => !("queueReason" in job))).toBe(true);
    expect(JSON.stringify(enriched)).not.toContain("runtimeState");
  });

  it.each([{ jobs: [] }, { jobs: [job("active", "RUNNING")] }, { jobs: [job("done", "SUCCEEDED")] }])(
    "does not poll the scheduler without queued work (%j)", async ({ jobs }) => {
      expect((await withAnalysisQueueReasons(jobs, new Map(jobs.map((row) => [row.id, accepted("a".repeat(32))]))))
        .every((job) => job.queueReason === null && job.computeWait === null)).toBe(true);
      expect(scheduler).not.toHaveBeenCalled();
      // Only a running job is worth asking FreeSki about (for its progress).
      expect(upstreamJob).toHaveBeenCalledTimes(jobs.some((row) => row.status === "RUNNING") ? 1 : 0);
    },
  );

  it.each([
    { connected: false, runtimeState: null, waitingReason: "stale reason" },
    { connected: true, runtimeState: "ready", waitingReason: null },
  ])("does not invent a reason when the broker has no current information (%j)", async (state) => {
    scheduler.mockResolvedValue(state);
    expect(await withAnalysisQueueReasons([job("job", "QUEUED")]))
      .toEqual([{ ...job("job", "QUEUED"), queueReason: null, computeWait: null, progress: null }]);
  });

  it("keeps a reservation queued through connection failure and picks up recovery on the next read", async () => {
    scheduler.mockRejectedValueOnce(new Error("private transport details"))
      .mockResolvedValueOnce({ connected: true, runtimeState: "stopped", waitingReason: "检测到游戏：cs2.exe" });
    const jobs = [job("job", "QUEUED")];
    expect(await withAnalysisQueueReasons(jobs)).toEqual([{ ...jobs[0], queueReason: null, computeWait: null, progress: null }]);
    expect(await withAnalysisQueueReasons(jobs)).toEqual([{ ...jobs[0], queueReason: "检测到游戏：cs2.exe", computeWait: null, progress: null }]);
  });
});

describe("FreeSki waiting for compute", () => {
  it("asks FreeSki only about queued jobs it accepted on the configured deployment", async () => {
    scheduler.mockResolvedValue({ connected: false, runtimeState: null, waitingReason: null });
    upstreamJob.mockResolvedValue({ status: "queued", brokerStatus: null, queueReason: "compute_offline", result: null });
    const jobs = [job("waiting", "QUEUED"), job("unsent", "QUEUED"), job("elsewhere", "QUEUED"), job("running", "RUNNING")];
    const upstream = new Map([["waiting", accepted("a".repeat(32))], ["unsent", { upstreamJobId: null, upstreamDeploymentId: null }],
      ["elsewhere", accepted("b".repeat(32), "freeski-old")], ["running", accepted("c".repeat(32))]]);
    const enriched = await withAnalysisQueueReasons(jobs, upstream);
    expect(enriched.map((row) => row.computeWait)).toEqual(["compute_offline", null, null, null]);
    // The queued accepted job and the running accepted job are read; the unsent and foreign ones are not.
    expect(upstreamJob).toHaveBeenCalledTimes(2);
    expect(upstreamJob).toHaveBeenCalledWith("a".repeat(32), "parallel", expect.any(AbortSignal));
    expect(upstreamJob).toHaveBeenCalledWith("c".repeat(32), "parallel", expect.any(AbortSignal));
    expect(JSON.stringify(enriched)).not.toContain("a".repeat(32));
  });

  it("shows no compute wait when FreeSki cannot be read, and keeps the job queued", async () => {
    scheduler.mockResolvedValue({ connected: false, runtimeState: null, waitingReason: null });
    upstreamJob.mockRejectedValueOnce(new Error("private transport details"))
      .mockResolvedValueOnce({ status: "queued", brokerStatus: null, queueReason: "waiting_for_compute", result: null });
    const upstream = new Map([["job", accepted("a".repeat(32))]]);
    expect(await withAnalysisQueueReasons([job("job", "QUEUED")], upstream))
      .toEqual([{ ...job("job", "QUEUED"), queueReason: null, computeWait: null, progress: null }]);
    expect(await withAnalysisQueueReasons([job("job", "QUEUED")], upstream))
      .toEqual([{ ...job("job", "QUEUED"), queueReason: null, computeWait: "waiting_for_compute", progress: null }]);
  });

  it("bounds how many upstream jobs one page view reads", async () => {
    scheduler.mockResolvedValue({ connected: false, runtimeState: null, waitingReason: null });
    upstreamJob.mockResolvedValue({ status: "queued", brokerStatus: null, queueReason: "waiting_for_compute", result: null });
    const jobs = Array.from({ length: 15 }, (_, index) => job(`job${index}`, "QUEUED"));
    const upstream = new Map(jobs.map((row, index) => [row.id, accepted(index.toString(16).padStart(32, "0"))]));
    const enriched = await withAnalysisQueueReasons(jobs, upstream);
    expect(upstreamJob).toHaveBeenCalledTimes(10);
    expect(enriched.filter((row) => row.computeWait === "waiting_for_compute")).toHaveLength(10);
  });
});

describe("running progress", () => {
  it("reports FreeSki's progress for accepted running jobs and nothing for queued ones", async () => {
    scheduler.mockResolvedValue({ connected: false, runtimeState: null, waitingReason: null });
    upstreamJob.mockImplementation(async (id: string) => id === "a".repeat(32)
      ? { status: "running", brokerStatus: "running", queueReason: null, progress: 0.42, result: null }
      : { status: "queued", brokerStatus: null, queueReason: "waiting_for_compute", result: null });
    const jobs = [job("running", "RUNNING"), job("waiting", "QUEUED"), job("done", "SUCCEEDED")];
    const upstream = new Map([["running", accepted("a".repeat(32))], ["waiting", accepted("b".repeat(32))], ["done", accepted("c".repeat(32))]]);
    const enriched = await withAnalysisQueueReasons(jobs, upstream);
    expect(enriched.map((row) => [row.progress, row.computeWait])).toEqual([[0.42, null], [null, "waiting_for_compute"], [null, null]]);
    expect(upstreamJob).toHaveBeenCalledTimes(2);
  });
});
