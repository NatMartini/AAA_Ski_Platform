import { describe, expect, it, vi } from "vitest";
import { processAnalysisJob, type AnalysisWorkerDependencies } from "./worker";
import { FreeSkiError } from "./adapter";
import type { FreeSkiAnalysisResult } from "./types";

const job = { id: "job", storageKey: "videos/order/sample.mp4", actionId: "parallel", leaseToken: "lease" };
const result: FreeSkiAnalysisResult = { version: 1, provider: "freeski", actionId: "parallel", gradingStatus: "graded",
  gradingReason: null, score: 0, scoreKind: "TECH", numTurns: 4, coachingZh: [], coachingEn: [], metrics: [], scorerVersion: "v3" };
function dependencies(overrides: Partial<AnalysisWorkerDependencies> = {}): AnalysisWorkerDependencies {
  return { resolveVideo: vi.fn(() => "private/video.mp4"), heartbeat: vi.fn(async () => true),
    attach: vi.fn(async () => true), settle: vi.fn(async () => true), cleanup: vi.fn(async () => true),
    analyze: vi.fn(async (input) => {
      if (await input.onSubmitted?.("a".repeat(32)) === false) throw new FreeSkiError("analysis-cancelled");
      return result;
    }), ...overrides };
}

describe("Durable analysis worker lifecycle", () => {
  it("persists the upstream ID and settles before deleting private artifacts", async () => {
    const order: string[] = [];
    const deps = dependencies({ attach: async () => { order.push("attach"); return true; },
      settle: async (_id, _lease, outcome) => { order.push("settle"); expect(outcome).toEqual({ ok: true, result }); return true; },
      cleanup: async () => { order.push("cleanup"); return true; } });
    expect(await processAnalysisJob(job, deps)).toEqual({ settled: true, cleaned: true, graded: true });
    expect(order).toEqual(["attach", "settle", "cleanup"]);
  });
  it("does not submit an upload if the initial lease is no longer owned", async () => {
    const deps = dependencies({ heartbeat: vi.fn(async () => false), settle: vi.fn(async () => false) });
    expect(await processAnalysisJob(job, deps)).toMatchObject({ settled: false, cleaned: false });
    expect(deps.analyze).not.toHaveBeenCalled();
    expect(deps.settle).toHaveBeenCalledWith("job", "lease", { ok: false, errorCode: "analysis-cancelled" });
  });
  it("keeps an already attached upstream ID when resuming", async () => {
    const upstreamJobId = "b".repeat(32);
    const deps = dependencies({ analyze: vi.fn(async (input) => { expect(input.upstreamJobId).toBe(upstreamJobId); return result; }) });
    await processAnalysisJob({ ...job, upstreamJobId }, deps);
    expect(deps.attach).not.toHaveBeenCalled();
    expect(deps.cleanup).toHaveBeenCalledWith(upstreamJobId);
  });
  it("cancels in-flight polling on lost heartbeat and cannot settle another lease", async () => {
    let beats = 0;
    const deps = dependencies({ heartbeat: vi.fn(async () => ++beats === 1), settle: vi.fn(async () => false),
      analyze: vi.fn(async (input) => new Promise<FreeSkiAnalysisResult>((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(new FreeSkiError("analysis-cancelled")), { once: true });
      })) });
    const processed = await processAnalysisJob(job, deps, { heartbeatIntervalMs: 1 });
    expect(processed.settled).toBe(false);
    expect(deps.settle).toHaveBeenCalledWith("job", "lease", { ok: false, errorCode: "analysis-cancelled" });
    expect(deps.cleanup).not.toHaveBeenCalled();
  });
  it("refuses continuation after failure to durably attach the upstream ID", async () => {
    const deps = dependencies({ attach: vi.fn(async () => false), settle: vi.fn(async () => false) });
    await processAnalysisJob(job, deps);
    expect(deps.settle).toHaveBeenCalledWith("job", "lease", { ok: false, errorCode: "analysis-cancelled" });
    expect(deps.cleanup).not.toHaveBeenCalled();
  });
  it("turns unknown exceptions into a safe failure code", async () => {
    const deps = dependencies({ analyze: vi.fn(async () => { throw new Error("JWT_SECRET=private path C:\\users"); }) });
    await processAnalysisJob(job, deps);
    expect(deps.settle).toHaveBeenCalledWith("job", "lease", { ok: false, errorCode: "analysis-failed" });
  });
  it("retains terminal upstream data for recovery if database settlement fails", async () => {
    const deps = dependencies({ settle: vi.fn(async () => { throw new Error("database unavailable"); }) });
    await expect(processAnalysisJob(job, deps)).rejects.toThrow("database unavailable");
    expect(deps.cleanup).not.toHaveBeenCalled();
  });
  it("passes unavailable grading to the refund ledger and cleans only after settlement", async () => {
    const unavailable: FreeSkiAnalysisResult = { ...result, gradingStatus: "unavailable", score: null, scoreKind: null, gradingReason: "low-confidence" };
    const deps = dependencies({ analyze: vi.fn(async () => unavailable) });
    const processed = await processAnalysisJob({ ...job, upstreamJobId: "c".repeat(32) }, deps);
    expect(processed).toEqual({ settled: true, cleaned: true, graded: false });
    expect(deps.settle).toHaveBeenCalledWith("job", "lease", { ok: true, result: unavailable });
  });
});
