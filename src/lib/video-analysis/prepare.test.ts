import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), request: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: {
  accountAnalysisJob: { findUnique: mocks.find, updateMany: mocks.update, count: vi.fn(), findMany: vi.fn() },
  videoAnalysisJob: { findUnique: mocks.find, updateMany: mocks.update, count: vi.fn(), findMany: vi.fn() } } }));
vi.mock("../freeski/adapter", () => ({ requestFreeSkiReportResource: mocks.request, readFreeSkiReportJson: (response: Response) => response.json(),
  FreeSkiError: class extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock("../freeski/config", () => ({ getFreeSkiConfig: () => ({ deploymentId: "integration-instance" }) }));

import { sampleKeyframes, sampleReport } from "../freeski/scorecard.fixtures";
import { isPreparing, outputsComplete, preparationAfterTierChange, prepareJobOutputs, PREPARE_DEADLINE_MINUTES, readPrepareState, sameOutputs, shorterLevels } from "./prepare";

const upstream = "a".repeat(32), settled = new Date("2026-11-09T20:00:00Z");
const row = (changes: Record<string, unknown> = {}) => ({ id: "job", status: "SUCCEEDED", refundedAt: null, tier: "COMPLETE", preparedTier: null,
  prepareStartedAt: settled, finishedAt: settled, upstreamJobId: upstream, upstreamDeploymentId: "integration-instance", upstreamApiVersion: 2, ...changes });
const report = (changes: Record<string, unknown> = {}) => Response.json({ ...sampleReport, deploymentId: "integration-instance", jobId: upstream, ...changes });
const frames = (status: "ready" | "pending" | "unavailable") => Response.json({ ...sampleKeyframes, status, items: status === "ready" ? sampleKeyframes.items : [] });
/** FreeSki as the mock: a report, then one key-frame manifest per turn. */
function freeSki(reportChanges: Record<string, unknown>, frameStatus: (turnId: string) => "ready" | "pending" | "unavailable") {
  mocks.request.mockImplementation(async (input: { resource: string; turnId?: string }) =>
    input.resource === "report" ? report(reportChanges) : frames(frameStatus(input.turnId!)));
}
const soon = new Date(settled.getTime() + 60_000);

beforeEach(() => { vi.resetAllMocks(); mocks.update.mockResolvedValue({ count: 1 }); });

describe("what a tier needs before its report appears", () => {
  it("treats deep and complete as the same outputs, and the free tiers as their own", () => {
    expect(sameOutputs("DEEP", "COMPLETE")).toBe(true);
    for (const [a, b] of [["SIMPLE", "STANDARD"], ["STANDARD", "DEEP"], ["SIMPLE", "COMPLETE"]] as const) expect(sameOutputs(a, b)).toBe(false);
  });

  it("is complete for a free tier once the explanation is final, and for a paid one once the frames and the video are too", () => {
    expect(outputsComplete({ teaching: "running", explainer: null, keyframes: null }, "STANDARD")).toBe(false);
    expect(outputsComplete({ teaching: "ready", explainer: null, keyframes: null }, "STANDARD")).toBe(true);
    expect(outputsComplete({ teaching: "failed", explainer: null, keyframes: null }, "SIMPLE")).toBe(true);
    expect(outputsComplete({ teaching: "ready", explainer: "running", keyframes: { ready: 3, total: 3 } }, "DEEP")).toBe(false);
    expect(outputsComplete({ teaching: "ready", explainer: "ready", keyframes: { ready: 2, total: 3 } }, "COMPLETE")).toBe(false);
    expect(outputsComplete({ teaching: "ready", explainer: "unavailable", keyframes: { ready: 0, total: 0 } }, "COMPLETE")).toBe(true);
  });

  it("starts over when the tier changes to different outputs, and not otherwise", () => {
    const prepared = { status: "SUCCEEDED", refundedAt: null, tier: "DEEP", preparedTier: "DEEP" };
    expect(preparationAfterTierChange(prepared, "COMPLETE")).toEqual({ preparedTier: "COMPLETE" });
    expect(preparationAfterTierChange(prepared, "STANDARD", settled)).toMatchObject({ preparedTier: null, prepareStartedAt: settled, preparedAt: null });
    // Still being scored: settling starts the preparation.
    expect(preparationAfterTierChange({ ...prepared, status: "RUNNING" }, "SIMPLE")).toEqual({});
    expect(isPreparing({ status: "SUCCEEDED", refundedAt: null, preparedTier: null })).toBe(true);
    expect(isPreparing({ status: "SUCCEEDED", refundedAt: null, preparedTier: "DEEP" })).toBe(false);
    expect(isPreparing({ status: "RUNNING", refundedAt: null, preparedTier: null })).toBe(false);
  });

  it("reads stored progress leniently", () => {
    expect(readPrepareState({ teaching: "running", explainer: "pending", keyframes: { ready: 1, total: 4 } })).toEqual({ teaching: "running", explainer: "pending", keyframes: { ready: 1, total: 4 } });
    expect(readPrepareState({ teaching: "nonsense" })).toEqual({ teaching: null, explainer: null, keyframes: null });
    expect(readPrepareState(null)).toBeNull();
  });
});

describe("completing a scored analysis", () => {
  it("asks for the tier's explanation and waits while it is written", async () => {
    mocks.find.mockResolvedValue(row({ tier: "STANDARD" }));
    freeSki({ teachingStatus: "running", teaching: null }, () => "ready");
    expect(await prepareJobOutputs("account", "job", { now: soon })).toBe("waiting");
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ resource: "report", thinking: "low" }));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: { prepareState: { teaching: "running", explainer: null, keyframes: null } } }));
  });

  it("finishes a free tier as soon as its explanation is ready, and stamps the analysis as finished then", async () => {
    mocks.find.mockResolvedValue(row({ tier: "SIMPLE" }));
    freeSki({}, () => "ready");
    expect(await prepareJobOutputs("account", "job", { now: soon })).toBe("ready");
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ resource: "report", thinking: "none" }));
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "job", status: "SUCCEEDED", refundedAt: null, preparedTier: null, tier: "SIMPLE" },
      data: expect.objectContaining({ preparedTier: "SIMPLE", preparedAt: soon, finishedAt: soon }) });
  });

  it("waits for every turn's key frames and the explainer video at the paid tiers", async () => {
    mocks.find.mockResolvedValue(row());
    const turns = sampleReport.turns.map(turn => turn.turnId);
    freeSki({ explainerStatus: "ready" }, turnId => turnId === turns[0] ? "pending" : turnId === turns[1] ? "unavailable" : "ready");
    expect(await prepareJobOutputs("account", "job", { now: soon })).toBe("waiting");
    expect(mocks.request).toHaveBeenCalledTimes(1 + turns.length);
    const state = mocks.update.mock.calls[0][0].data.prepareState;
    // The turn with nothing to point at is not waited for.
    expect(state).toEqual({ teaching: "ready", explainer: "ready", keyframes: { ready: turns.length - 2, total: turns.length - 1 } });
    mocks.update.mockClear();
    freeSki({ explainerStatus: "ready" }, () => "ready");
    expect(await prepareJobOutputs("account", "job", { now: soon })).toBe("ready");
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ preparedTier: "COMPLETE" });
  });

  it("asks for a shorter explanation when the tier's own cannot be written, and waits for that one", async () => {
    expect([shorterLevels("COMPLETE"), shorterLevels("DEEP"), shorterLevels("STANDARD"), shorterLevels("SIMPLE")]).toEqual([["low", "none"], ["low", "none"], ["none"], []]);
    mocks.find.mockResolvedValue(row({ tier: "DEEP" }));
    const shorter = { low: "running", none: "ready" } as Record<string, string>;
    mocks.request.mockImplementation(async (input: { resource: string; thinking?: string }) => input.resource !== "report" ? frames("ready")
      : input.thinking === "xhigh" ? report({ teachingStatus: "failed", teaching: null, explainerStatus: "ready" })
      : report({ teachingStatus: shorter[input.thinking!], teaching: shorter[input.thinking!] === "ready" ? sampleReport.teaching : null }));
    // The next depth down is being written: the report waits for it and nothing shallower is asked for.
    expect(await prepareJobOutputs("account", "job", { now: soon })).toBe("waiting");
    expect(mocks.request.mock.calls.filter(([input]) => input.resource === "report").map(([input]) => input.thinking)).toEqual(["xhigh", "low"]);
    expect(mocks.update.mock.calls[0][0].data.prepareState).toMatchObject({ teaching: "running" });
    shorter.low = "ready";
    expect(await prepareJobOutputs("account", "job", { now: soon })).toBe("ready");
    // That one failing too, the next is tried; with none left the report appears without a written explanation.
    mocks.request.mockClear();
    shorter.low = "failed";
    expect(await prepareJobOutputs("account", "job", { now: soon })).toBe("ready");
    expect(mocks.request.mock.calls.filter(([input]) => input.resource === "report").map(([input]) => input.thinking)).toEqual(["xhigh", "low", "none"]);
    shorter.none = "failed";
    mocks.update.mockClear();
    expect(await prepareJobOutputs("account", "job", { now: soon })).toBe("ready");
    expect(mocks.update.mock.calls[0][0].data.prepareState).toMatchObject({ teaching: "failed" });
  });

  it("keeps the first finish time when a later change of tier is completed", async () => {
    const changed = new Date(settled.getTime() + 3_600_000);
    mocks.find.mockResolvedValue(row({ tier: "STANDARD", prepareStartedAt: changed }));
    freeSki({}, () => "ready");
    expect(await prepareJobOutputs("booking", "job", { now: new Date(changed.getTime() + 5_000) })).toBe("ready");
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("finishedAt");
  });

  it("lets the report appear with what there is once the deadline has passed, even with FreeSki away", async () => {
    const late = new Date(settled.getTime() + (PREPARE_DEADLINE_MINUTES + 1) * 60_000);
    mocks.find.mockResolvedValue(row({ tier: "DEEP" }));
    freeSki({ teachingStatus: "running", teaching: null, explainerStatus: "pending" }, () => "pending");
    expect(await prepareJobOutputs("account", "job", { now: late })).toBe("ready");
    mocks.request.mockRejectedValue(new Error("offline"));
    expect(await prepareJobOutputs("account", "job", { now: soon })).toBe("waiting");
    expect(await prepareJobOutputs("account", "job", { now: late })).toBe("ready");
  });

  it("has nothing to make for an analysis this deployment cannot read, and leaves others alone", async () => {
    mocks.find.mockResolvedValue(row({ upstreamDeploymentId: "another-instance" }));
    expect(await prepareJobOutputs("account", "job", { now: soon })).toBe("ready");
    expect(mocks.request).not.toHaveBeenCalled();
    for (const other of [null, row({ status: "RUNNING" }), row({ preparedTier: "COMPLETE" }), row({ refundedAt: settled })]) {
      mocks.find.mockResolvedValue(other);
      expect(await prepareJobOutputs("account", "job", { now: soon })).toBe("skipped");
    }
  });
});
