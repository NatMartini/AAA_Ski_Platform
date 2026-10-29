import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { safeFreeSkiBaseUrl, getFreeSkiConfig } from "./config";
import { isFreeSkiActionId } from "./actions";
import { FreeSkiError, cleanupFreeSkiJob, freeSkiServiceState, freeSkiSchedulerState, getFreeSkiAnalysisJob, normalizeFreeSkiResult,
  getFreeSkiActionCatalog, pausableDeadline, readFreeSkiReportJson, requestFreeSkiReportResource, runFreeSkiAnalysis, submitFreeSkiAnalysis } from "./adapter";
import { sampleActionId, sampleImprovementActionId, sampleImprovementJobResult, sampleJobResult, sampleScorecard } from "./scorecard.fixtures";

const jobId = "a".repeat(32);
const bridge = { ok: true, isolated: true, featureNewScorer: false, identityGate: true };
const validResult = { action_name: "demonstration_parallel", score_kind: "TECH", level: "advanced", overall_score: 72, num_turns: 5,
  coaching_zh: ["保持双板平行"], coaching_en: ["Keep skis parallel"], per_metric_scores: { parallel_skis: 80 }, scorer_version: "v3.0.1-scoring-fix" };
const catalog = { rubric_system: "csia", improvement: { skills: [
  { id: "parallel", available: true }, { id: "short_turn", available: true },
  { id: "carving", available: false }, { id: "bumps", available: false },
] }, certification: { levels: {
  level2: { actions: ["demonstration_parallel"], availability: { demonstration_parallel: true } },
  level3: { actions: ["demonstration_parallel", "hop_turn"], availability: { demonstration_parallel: true, hop_turn: true } },
} } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

describe("FreeSki configuration boundaries", () => {
  it.each(["http://127.0.0.1:8000", "http://localhost:8000/", "http://[::1]:8000", "https://analysis.example.com"])("accepts trusted server configuration %s", (url) => {
    expect(safeFreeSkiBaseUrl(url)).toBeTruthy();
  });
  it.each(["http://example.com", "file:///C:/private", "ftp://localhost", "http://user:password@localhost", "http://localhost/?token=x", "http://localhost/api", "http://localhost/#secret", "not a URL"])("rejects unsafe endpoint %s", (url) => {
    expect(safeFreeSkiBaseUrl(url)).toBeNull();
  });
  it("requires dedicated strong credentials and bounds server timeouts", () => {
    expect(getFreeSkiConfig({ FREESKI_BASE_URL: "http://localhost:8000", FREESKI_SERVICE_IDENTIFIER: "service", FREESKI_SERVICE_PASSWORD: "dev" })).toBeNull();
    const config = getFreeSkiConfig({ FREESKI_BASE_URL: "http://localhost:8000", FREESKI_SERVICE_IDENTIFIER: "service", FREESKI_SERVICE_PASSWORD: "x".repeat(32), FREESKI_ANALYSIS_TIMEOUT_MS: "999999999", FREESKI_POLL_INTERVAL_MS: "-1" });
    expect(config?.analysisTimeoutMs).toBe(3_000_000);
    expect(config?.pollIntervalMs).toBe(2_000);
  });
  it("does not treat coach-defined actions as model capabilities", () => {
    expect(isFreeSkiActionId("carving")).toBe(true);
    expect(isFreeSkiActionId("custom:foreign")).toBe(false);
    expect(isFreeSkiActionId("expert_all_terrain")).toBe(false);
  });
});

describe("FreeSki public result contract", () => {
  it("accepts canonical FreeSki parallel results and the historical improvement spelling", () => {
    expect(normalizeFreeSkiResult(validResult, "parallel")).toMatchObject({ actionId: "parallel", score: 72 });
    expect(normalizeFreeSkiResult({ ...validResult, action_name: "parallel" }, "parallel")).toMatchObject({ actionId: "parallel", score: 72 });
    expect(() => normalizeFreeSkiResult({ ...validResult, action_name: "advanced_parallel" }, "parallel")).toThrow(FreeSkiError);
    expect(() => normalizeFreeSkiResult({ ...validResult, action_name: "intro_parallel" }, "parallel")).toThrow(FreeSkiError);
  });
  it("preserves genuine zero scores and only returns allowlisted data", () => {
    const result = normalizeFreeSkiResult({ ...validResult, tech_quality: 0, overall_score: 98,
      user: { email: "private@example.com" }, video_path: "J:/private/video.mp4", overlay_url: "http://upstream/private",
      access_token: "secret", sha1: "b".repeat(40), coaching_zh: ["有效建议", "http://upstream/media/private", "C:\\private\\video"],
      per_metric_scores: { parallel_skis: 0, "../private": 91, weird: Infinity } }, "parallel");
    expect(result).toMatchObject({ gradingStatus: "graded", scoreKind: "TECH", score: 0 });
    expect(result.coachingZh).toEqual(["有效建议"]);
    expect(result.metrics).toEqual([{ key: "parallel_skis", score: 0 }, { key: "weird", score: null }]);
    expect(JSON.stringify(result)).not.toMatch(/private|secret|upstream|access_token|sha1/);
  });
  it.each(["WRONG_ACTION", "INSUFFICIENT_TURNS", "LOW_CONFIDENCE", undefined, "OTHER"])("never publishes a grade for %s", (kind) => {
    const result = normalizeFreeSkiResult({ ...validResult, score_kind: kind, overall_score: 99 }, "parallel");
    expect(result).toMatchObject({ gradingStatus: "unavailable", score: null, scoreKind: null, metrics: [], coachingZh: [] });
  });
  it.each([NaN, Infinity, -1, 101, "90"])("does not substitute the legacy score for invalid present tech_quality %s", (quality) => {
    expect(normalizeFreeSkiResult({ ...validResult, tech_quality: quality }, "parallel").gradingStatus).toBe("unavailable");
  });
  it("rejects cross-action/empty results and bounds report text", () => {
    expect(() => normalizeFreeSkiResult({ ...validResult, action_name: "carving" }, "parallel")).toThrow(FreeSkiError);
    expect(() => normalizeFreeSkiResult({}, "parallel")).toThrow(FreeSkiError);
    const result = normalizeFreeSkiResult({ ...validResult, coaching_en: Array(99).fill("x".repeat(9000)) }, "parallel");
    expect(result.coachingEn).toHaveLength(20);
    expect(result.coachingEn[0]).toHaveLength(1000);
  });
  it("distinguishes measured score bands from the requested certification level", () => {
    const actionId = "certification:level2:demonstration_parallel";
    expect(normalizeFreeSkiResult({ ...validResult, action_name: "demonstration_parallel",
      level_assessment: { selected_level: "level2", estimated_level: "level3" } }, actionId)).toMatchObject({ actionId, score: 72 });
    expect(normalizeFreeSkiResult({ ...validResult, action_name: "demonstration_parallel", score_kind: "LOW_CONFIDENCE",
      level: null, level_assessment: null }, actionId)).toMatchObject({ actionId, gradingStatus: "unavailable", score: null });
    expect(() => normalizeFreeSkiResult({ ...validResult, action_name: "demonstration_parallel",
      level_assessment: { selected_level: "level3" } }, actionId)).toThrow(FreeSkiError);
    expect(() => normalizeFreeSkiResult({ ...validResult, action_name: "demonstration_parallel", path_type: "improvement" }, actionId)).toThrow(FreeSkiError);
  });
  it("freezes a matching contract scorecard and drops malformed or foreign ones", () => {
    const certified = { ...validResult, scorecard: sampleScorecard };
    expect(normalizeFreeSkiResult(certified, sampleActionId).scorecard?.overall.score).toBe(sampleScorecard.overall.score);
    expect(normalizeFreeSkiResult(validResult, sampleActionId)).not.toHaveProperty("scorecard");
    // Another level, another action or an unknown version is never relabelled onto this job.
    expect(normalizeFreeSkiResult({ ...validResult, scorecard: { ...sampleScorecard, level: "level3" } }, sampleActionId)).not.toHaveProperty("scorecard");
    expect(normalizeFreeSkiResult(certified, "parallel")).not.toHaveProperty("scorecard");
    expect(normalizeFreeSkiResult({ ...validResult, scorecard: { ...sampleScorecard, action: "carving" } }, sampleActionId)).not.toHaveProperty("scorecard");
    expect(normalizeFreeSkiResult({ ...validResult, scorecard: { ...sampleScorecard, schema_version: "freeski_scorecard.v9" } }, sampleActionId)).not.toHaveProperty("scorecard");
    expect(normalizeFreeSkiResult({ ...validResult, scorecard: { ...sampleScorecard, action: "parallel", level: null } }, "parallel").scorecard?.action).toBe("parallel");
  });
  it("keeps an improvement scorecard only when it was made for this skier's level", () => {
    const improvement = (current_level?: string | null) => ({ ...validResult, scorecard: { ...sampleScorecard, action: "parallel", level: null,
      ...(current_level === undefined ? {} : { current_level }) } });
    const actionId = "improvement:level1:parallel";
    expect(normalizeFreeSkiResult(improvement("level1"), actionId).scorecard?.current_level).toBe("level1");
    // A FreeSki without the field ignored the level; its card says so through reference_target.
    expect(normalizeFreeSkiResult(improvement(), actionId).scorecard).not.toBeNull();
    for (const other of ["level2", null]) expect(normalizeFreeSkiResult(improvement(other), actionId)).not.toHaveProperty("scorecard");
    expect(normalizeFreeSkiResult(improvement("level1"), "parallel")).not.toHaveProperty("scorecard");
    expect(normalizeFreeSkiResult(improvement(null), "parallel").scorecard?.current_level).toBeNull();
    expect(normalizeFreeSkiResult({ ...validResult, scorecard: { ...sampleScorecard, current_level: "level1" } }, sampleActionId)).not.toHaveProperty("scorecard");
  });
  it("normalizes FreeSki's published sample job result", () => {
    const result = normalizeFreeSkiResult(sampleJobResult.result, sampleActionId);
    expect(result.scorecard?.overall.score).toBe(sampleScorecard.overall.score);
    expect(JSON.stringify(result)).not.toContain("_sample_note");
  });
  it("normalizes FreeSki's published improvement sample for a level 1 skier", () => {
    const result = normalizeFreeSkiResult(sampleImprovementJobResult.result, sampleImprovementActionId);
    expect(result.scorecard?.current_level).toBe("level1");
    expect(result.scorecard?.calibration.reference_target).toBe("level2");
    // The same clip read as another skier's level must not keep this scorecard.
    expect(() => normalizeFreeSkiResult(sampleImprovementJobResult.result, "improvement:level2:parallel")).toThrow();
  });
});

describe("FreeSki server bridge safety", () => {
  let directory: string;
  let videoPath: string;
  let fetcher: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "aaa-freeski-adapter-"));
    await mkdir(path.join(directory, "videos"));
    videoPath = path.join(directory, "videos", "sample.mp4");
    await writeFile(videoPath, "unit fixture (not a model result)");
    vi.stubEnv("STORAGE_DIR", directory);
    vi.stubEnv("FREESKI_BASE_URL", "http://127.0.0.1:8000");
    vi.stubEnv("FREESKI_SERVICE_IDENTIFIER", `service-${randomUUID()}@example.com`);
    vi.stubEnv("FREESKI_SERVICE_PASSWORD", "x".repeat(64));
    fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return json(bridge);
      if (url.endsWith("/api/auth/login")) return json({ access_token: "test-jwt-".repeat(10), user: { onboarded: true } });
      if (url.endsWith("/api/aaa/catalog")) return json(catalog);
      if (url.endsWith("/api/aaa/scheduler")) return json({ connected: true, runtimeState: "stopped", waitingReason: "待命：等待转发门卫安装" });
      if (url.endsWith("/api/analyze")) return json({ job_id: jobId, status: "queued" }, 202);
      if (url.endsWith(`/api/jobs/${jobId}`)) return json({ job_id: jobId, action_name: "parallel", status: "done", result: validResult });
      if (url.endsWith(`/api/aaa/jobs/${jobId}`)) return json({ ok: true });
      throw new Error("unexpected test endpoint");
    });
    vi.stubGlobal("fetch", fetcher);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  it("uses authenticated async jobs, stable action selection and no redirected requests", async () => {
    const onSubmitted = vi.fn(async () => true);
    const result = await runFreeSkiAnalysis({ videoPath, actionId: "parallel", onSubmitted });
    expect(result.score).toBe(72);
    expect(onSubmitted).toHaveBeenCalledWith(jobId);
    const submit = fetcher.mock.calls.find(([url]) => url.endsWith("/api/analyze"));
    const options = submit?.[1] as RequestInit | undefined;
    expect(options?.body).toBeInstanceOf(FormData);
    expect((options?.body as FormData).get("action_name")).toBe("parallel");
    expect((options?.body as FormData).get("path_type")).toBe("improvement");
    expect((options?.body as FormData).get("current_level")).toBeNull();
    expect((options?.body as FormData).get("async_mode")).toBe("true");
    for (const [, init] of fetcher.mock.calls) expect((init as RequestInit).redirect).toBe("error");
  });
  it("submits a durable request key immediately without waiting for a broker slot", async () => {
    expect(await submitFreeSkiAnalysis({ videoPath, actionId: "parallel", requestKey: "aaa:account:durable-job" })).toBe(jobId);
    const submitted = fetcher.mock.calls.find(([url]) => url.endsWith("/api/analyze"));
    expect((submitted?.[1]?.body as FormData).get("request_key")).toBe("aaa:account:durable-job");
    expect(fetcher.mock.calls.some(([url]) => url.includes("/api/jobs/"))).toBe(false);
  });
  it("fetches only the authenticated private catalog without enabling unavailable options", async () => {
    const options = await getFreeSkiActionCatalog();
    expect(options.find((option) => option.id === "parallel")?.available).toBe(true);
    expect(options.find((option) => option.id === "carving")?.available).toBe(false);
    const request = fetcher.mock.calls.find(([url]) => url.endsWith("/api/aaa/catalog"));
    expect(request?.[1]).toMatchObject({ cache: "no-store", redirect: "error", headers: { Authorization: expect.stringMatching(/^Bearer /) } });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/catalog"))).toBe(false);
  });
  it("preserves certification context in upload payload and canonical results", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/jobs/")
      ? json({ job_id: jobId, action_name: "hop_turn", path_type: "certification", level: "level3", status: "done",
        result: { ...validResult, action_name: "hop_turn", path_type: "certification", level_assessment: { selected_level: "level3" } } }) : original(url));
    const result = await runFreeSkiAnalysis({ videoPath, actionId: "certification:level3:hop_turn" });
    expect(result).toMatchObject({ actionId: "certification:level3:hop_turn", score: 72 });
    const submitted = fetcher.mock.calls.find(([url]) => url.endsWith("/api/analyze"));
    const form = submitted?.[1]?.body as FormData;
    expect(form.get("action_name")).toBe("hop_turn");
    expect(form.get("skill_family")).toBe("tactic");
    expect(form.get("path_type")).toBe("certification");
    expect(form.get("level")).toBe("level3");
  });
  it("sends the skier's current level with improvement uploads and rejects a job that echoes another", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/jobs/")
      ? json({ job_id: jobId, action_name: "short_turn", path_type: "improvement", level: null, current_level: "level2", status: "done",
        result: { ...validResult, action_name: "short_turn", path_type: "improvement", current_level: "level2" } }) : original(url));
    expect(await runFreeSkiAnalysis({ videoPath, actionId: "improvement:level2:short_turn" })).toMatchObject({ actionId: "improvement:level2:short_turn" });
    const form = fetcher.mock.calls.find(([url]) => url.endsWith("/api/analyze"))?.[1]?.body as FormData;
    expect(form.get("action_name")).toBe("short_turn");
    expect(form.get("path_type")).toBe("improvement");
    expect(form.get("current_level")).toBe("level2");
    expect(form.get("level")).toBeNull();
    await expect(getFreeSkiAnalysisJob(jobId, "improvement:level3:short_turn")).rejects.toMatchObject({ code: "analysis-invalid-response" });
    await expect(getFreeSkiAnalysisJob(jobId, "short_turn")).rejects.toMatchObject({ code: "analysis-invalid-response" });
  });
  it("rechecks the current catalog before every new upload and denies closed or missing choices", async () => {
    await expect(submitFreeSkiAnalysis({ videoPath, actionId: "carving" })).rejects.toMatchObject({ code: "analysis-invalid-action" });
    await expect(submitFreeSkiAnalysis({ videoPath, actionId: "certification:level4:expert_parallel" })).rejects.toMatchObject({ code: "analysis-invalid-action" });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/analyze"))).toBe(false);
    await submitFreeSkiAnalysis({ videoPath, actionId: "parallel" });
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.endsWith("/api/aaa/catalog")
      ? json({ rubric_system: "csia", improvement: { skills: [{ id: "parallel", available: false }] } }) : original(url));
    await expect(submitFreeSkiAnalysis({ videoPath, actionId: "parallel" })).rejects.toMatchObject({ code: "analysis-invalid-action" });
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/api/analyze"))).toHaveLength(1);
  });
  it.each(["aaa:booking:durable-job", "aaa:account:durable_job"])("recovers an accepted closed action through its authenticated durable identity %s", async (requestKey) => {
    const original = fetcher.getMockImplementation()!;
    const endpoint = `/api/aaa/requests/${encodeURIComponent(requestKey)}`;
    fetcher.mockImplementation(async (url: string) => url.endsWith(endpoint)
      ? json({ state: "found", jobId }) : original(url));
    expect(await submitFreeSkiAnalysis({ videoPath: "missing-but-already-uploaded", actionId: "carving", requestKey })).toBe(jobId);
    const lookup = fetcher.mock.calls.find(([url]) => url.endsWith(endpoint));
    expect(lookup?.[1]).toMatchObject({ cache: "no-store", redirect: "error", headers: { Authorization: expect.stringMatching(/^Bearer /) } });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/analyze"))).toBe(false);
  });
  it("releases a closed action only after an exact absent lookup response", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/aaa/requests/")
      ? json({ state: "absent" }) : original(url));
    await expect(submitFreeSkiAnalysis({ videoPath: "missing-not-needed", actionId: "carving", requestKey: "aaa:account:closed-job" }))
      .rejects.toMatchObject({ code: "analysis-action-closed" });
    expect(fetcher.mock.calls.filter(([url]) => url.includes("/api/aaa/requests/"))).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/analyze"))).toBe(false);
  });
  it.each([
    { state: "pending" }, {}, [], null, { state: "unknown" },
    { state: "found" }, { state: "found", jobId: "A".repeat(32) },
    { state: "found", jobId: "../private" }, { state: "found", jobId: 123 },
    { state: "absent", jobId: null }, { state: "absent", pending: true },
    { state: "absent", detail: "unknown bridge contract" },
  ])("keeps a reservation when closed-action lookup is ambiguous: %j", async (state) => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/aaa/requests/") ? json(state) : original(url));
    await expect(submitFreeSkiAnalysis({ videoPath, actionId: "carving", requestKey: "aaa:account:uncertain-job" }))
      .rejects.toMatchObject({ code: "analysis-unavailable", message: "analysis-unavailable" });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/analyze"))).toBe(false);
  });
  it.each([401, 403, 404, 409, 500])("does not interpret a closed-action lookup HTTP %s as absence", async (status) => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/aaa/requests/")
      ? json({ state: "absent", detail: "private upstream explanation" }, status) : original(url));
    await expect(submitFreeSkiAnalysis({ videoPath, actionId: "carving", requestKey: "aaa:booking:uncertain-job" }))
      .rejects.toMatchObject({ code: "analysis-unavailable", message: "analysis-unavailable" });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/analyze"))).toBe(false);
  });
  it("does not release or resubmit a closed action after lookup transport/JSON failures", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => {
      if (url.includes("/api/aaa/requests/")) throw new Error("password=private C:/private");
      return original(url);
    });
    await expect(submitFreeSkiAnalysis({ videoPath, actionId: "carving", requestKey: "aaa:account:uncertain-job" }))
      .rejects.toMatchObject({ code: "analysis-unavailable", message: "analysis-unavailable" });
    fetcher.mockImplementation(async (url: string) => url.includes("/api/aaa/requests/")
      ? new Response("private invalid JSON", { status: 200 }) : original(url));
    await expect(submitFreeSkiAnalysis({ videoPath, actionId: "carving", requestKey: "aaa:account:uncertain-job" }))
      .rejects.toMatchObject({ code: "analysis-unavailable", message: "analysis-unavailable" });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/analyze"))).toBe(false);
  });
  it.each([undefined, "", "random-key", "aaa:other:job", "aaa:account:../private", "aaa:booking:job?private=true", `aaa:account:${"x".repeat(201)}`])("never looks up a closed action under a non-durable key %s", async (requestKey) => {
    await expect(submitFreeSkiAnalysis({ videoPath, actionId: "carving", requestKey }))
      .rejects.toMatchObject({ code: "analysis-invalid-action" });
    expect(fetcher.mock.calls.some(([url]) => url.includes("/api/aaa/requests/") || url.endsWith("/api/analyze"))).toBe(false);
  });
  it("does not send video or enable a cached choice when the catalog goes offline", async () => {
    await getFreeSkiActionCatalog();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/aaa/catalog")) throw new Error("password=private");
      return original(url);
    });
    await expect(submitFreeSkiAnalysis({ videoPath, actionId: "parallel", requestKey: "aaa:account:durable-job" })).rejects.toMatchObject({ code: "analysis-unavailable", message: "analysis-unavailable" });
    expect(fetcher.mock.calls.some(([url]) => url.includes("/api/aaa/requests/") || url.endsWith("/api/analyze"))).toBe(false);
  });
  it("does not trust unknown catalog actions, missing flags or legacy aliases marked available", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.endsWith("/api/aaa/catalog")
      ? json({ rubric_system: "csia", improvement: { skills: [{ id: "parallel" }, { id: "custom_move", available: true }] },
        certification: { levels: { level3: { actions: ["hop_to_hop"], availability: { hop_to_hop: true } } } } }) : original(url));
    expect((await getFreeSkiActionCatalog()).every((option) => !option.available)).toBe(true);
    await expect(submitFreeSkiAnalysis({ videoPath, actionId: "parallel" })).rejects.toMatchObject({ code: "analysis-invalid-action" });
    await expect(submitFreeSkiAnalysis({ videoPath, actionId: "certification:level3:hop_to_hop" })).rejects.toMatchObject({ code: "analysis-invalid-action" });
    await expect(submitFreeSkiAnalysis({ videoPath, actionId: "custom_move" })).rejects.toMatchObject({ code: "analysis-invalid-action" });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/analyze"))).toBe(false);
  });
  it("resumes certification jobs with encoded identities without a new upload or catalog dependency", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/jobs/")
      ? json({ job_id: jobId, action_name: "demonstration_parallel", path_type: "certification", level: "level2", status: "done",
        result: { ...validResult, action_name: "demonstration_parallel", path_type: "certification", level_assessment: { selected_level: "level2" } } }) : original(url));
    const result = await runFreeSkiAnalysis({ videoPath: "missing-not-needed", actionId: "certification:level2:demonstration_parallel", upstreamJobId: jobId });
    expect(result.actionId).toBe("certification:level2:demonstration_parallel");
    expect((await getFreeSkiAnalysisJob(jobId, result.actionId)).result?.actionId).toBe(result.actionId);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/aaa/catalog") || url.endsWith("/api/analyze"))).toBe(false);
  });
  it("keeps previously accepted reports readable after their action closes", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/jobs/")
      ? json({ job_id: jobId, action_name: "carving", path_type: "improvement", level: null, status: "done",
        result: { ...validResult, action_name: "carving", path_type: "improvement" } }) : original(url));
    expect((await getFreeSkiAnalysisJob(jobId, "carving")).result).toMatchObject({ actionId: "carving", score: 72 });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/aaa/catalog") || url.endsWith("/api/analyze"))).toBe(false);
  });
  it.each([{ level: "level3" }, { path_type: "improvement" }, { meta: { level: "level4" } }])("rejects cross-level/path certification jobs %j", async (fields) => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/jobs/")
      ? json({ job_id: jobId, action_name: "demonstration_parallel", status: "done", ...fields,
        result: { ...validResult, action_name: "demonstration_parallel" } }) : original(url));
    await expect(getFreeSkiAnalysisJob(jobId, "certification:level2:demonstration_parallel")).rejects.toMatchObject({ code: "analysis-invalid-response" });
    await expect(runFreeSkiAnalysis({ videoPath, actionId: "certification:level2:demonstration_parallel", upstreamJobId: jobId })).rejects.toMatchObject({ code: "analysis-invalid-response" });
  });
  it("returns the actual broker state without treating an interrupted job as an analysis failure", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/jobs/")
      ? json({ job_id: jobId, action_name: "parallel", status: "error", broker_status: "interrupted",
        broker_job_id: "private-broker-id", preemptions: 3, reason: "private diagnostics" }) : original(url));
    expect(await getFreeSkiAnalysisJob(jobId, "parallel")).toEqual({ status: "error", brokerStatus: "interrupted", queueReason: null, progress: null, result: null });
  });
  it.each([
    { status: "queued", queue_reason: "compute_offline", expected: "compute_offline" },
    { status: "queued", queue_reason: "waiting_for_compute", expected: "waiting_for_compute" },
    { status: "queued", queue_reason: "gpu_on_fire", expected: null },
    { status: "queued", queue_reason: null, expected: null },
    { status: "running", queue_reason: "compute_offline", expected: null },
  ])("reads FreeSki's queue reason only while the job is queued (%j)", async ({ status, queue_reason, expected }) => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/jobs/")
      ? json({ job_id: jobId, action_name: "parallel", status, broker_status: "queued", queue_reason }) : original(url));
    expect((await getFreeSkiAnalysisJob(jobId, "parallel")).queueReason).toBe(expected);
  });
  it.each([
    { status: "running", progress: 0.42, expected: 0.42 },
    { status: "running", progress: 7, expected: 1 },
    { status: "running", progress: "half", expected: null },
    { status: "queued", progress: 0.5, expected: null },
  ])("reads a bounded progress only for a running job (%j)", async ({ status, progress, expected }) => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/jobs/")
      ? json({ job_id: jobId, action_name: "parallel", status, broker_status: status, progress }) : original(url));
    expect((await getFreeSkiAnalysisJob(jobId, "parallel")).progress).toBe(expected);
  });
  it("keeps polling a job that waits for compute until FreeSki finishes it", async () => {
    vi.stubEnv("FREESKI_POLL_INTERVAL_MS", "500");
    const original = fetcher.getMockImplementation()!;
    let polls = 0;
    fetcher.mockImplementation(async (url: string) => url.endsWith(`/api/jobs/${jobId}`) && polls++ < 1
      ? json({ job_id: jobId, action_name: "parallel", status: "queued", queue_reason: "compute_offline" }) : original(url));
    expect(await runFreeSkiAnalysis({ videoPath: "missing-but-not-needed", actionId: "parallel", upstreamJobId: jobId }))
      .toMatchObject({ actionId: "parallel" });
    expect(polls).toBe(2);
  });
  it("reads scheduler reasons only through the authenticated private bridge", async () => {
    expect(await freeSkiSchedulerState()).toEqual({ connected: true, runtimeState: "stopped", waitingReason: "待命：等待转发门卫安装" });
    const scheduler = fetcher.mock.calls.find(([url]) => url.endsWith("/api/aaa/scheduler"));
    expect(scheduler?.[1]?.headers).toMatchObject({ Authorization: expect.stringMatching(/^Bearer /) });
    expect(scheduler?.[1]).toMatchObject({ redirect: "error", cache: "no-store" });
    expect(fetcher.mock.calls.every(([url]) => url.startsWith("http://127.0.0.1:8000/"))).toBe(true);
  });
  it("keeps the public scheduler contract narrow and bounds safe source text", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.endsWith("/api/aaa/scheduler")
      ? json({ connected: true, runtimeState: "ready", waitingReason: "等".repeat(1000),
        jobs: [{ token: "private" }], runtime: { model: "private" } }) : original(url));
    expect(await freeSkiSchedulerState()).toEqual({ connected: true, runtimeState: "ready", waitingReason: "等".repeat(400) });
  });
  it.each(["https://private.example/path", "C:/Users/private", "C:\\Users\\private", "/home/private", "Bearer private",
    "password=private", "api_key:private", "token:private", "secret=private", "https:private.example", "密码=private",
    "eyJheader.payload.signature", "paused\nprivate", "private\u007f", "private\u0085"])("does not expose unsafe scheduler reason %s", async (waitingReason) => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.endsWith("/api/aaa/scheduler")
      ? json({ connected: true, runtimeState: "stopped", waitingReason }) : original(url));
    expect((await freeSkiSchedulerState()).waitingReason).toBeNull();
  });
  it.each([{}, { connected: "true", runtimeState: "ready", waitingReason: null },
    { connected: true, runtimeState: "invented", waitingReason: null },
    { connected: true, runtimeState: { state: "ready" }, waitingReason: null },
    { connected: true, runtimeState: "ready", waitingReason: { token: "private" } }])("rejects malformed scheduler source %j", async (state) => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.endsWith("/api/aaa/scheduler") ? json(state) : original(url));
    await expect(freeSkiSchedulerState()).rejects.toMatchObject({ code: "analysis-invalid-response" });
  });
  it("clears scheduler details on disconnection and does not query an unconfigured bridge", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.endsWith("/api/aaa/scheduler")
      ? json({ connected: false, runtimeState: "ready", waitingReason: "stale reason" }) : original(url));
    expect(await freeSkiSchedulerState()).toEqual({ connected: false, runtimeState: null, waitingReason: null });
    vi.stubEnv("FREESKI_BASE_URL", "");
    fetcher.mockClear();
    expect(await freeSkiSchedulerState()).toEqual({ connected: false, runtimeState: null, waitingReason: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves a verified wait reason while the bridge withholds runtime readiness during teardown", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.endsWith("/api/aaa/scheduler")
      ? json({ connected: true, runtimeState: null, waitingReason: "正在等待上一个模型完全退出" }) : original(url));
    expect(await freeSkiSchedulerState()).toEqual({ connected: true, runtimeState: null, waitingReason: "正在等待上一个模型完全退出" });
  });
  it("does not disguise scheduler transport failure as a source-provided waiting reason", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/aaa/scheduler")) throw new Error("password=private C:/private");
      return original(url);
    });
    await expect(freeSkiSchedulerState()).rejects.toMatchObject({ code: "analysis-unavailable", message: "analysis-unavailable" });
  });
  it("refuses an original service before sending credentials or video", async () => {
    fetcher.mockImplementation(async () => json({ ok: true }));
    await expect(runFreeSkiAnalysis({ videoPath, actionId: "parallel" })).rejects.toMatchObject({ code: "analysis-unavailable" });
    expect(fetcher.mock.calls.every(([url]) => url.endsWith("/health"))).toBe(true);
    expect(await freeSkiServiceState()).toEqual({ configured: true, available: false });
  });
  it("resumes an existing job without re-uploading", async () => {
    await runFreeSkiAnalysis({ videoPath: "missing-but-not-needed", actionId: "parallel", upstreamJobId: jobId });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/analyze"))).toBe(false);
  });
  it("rejects path traversal, unsupported files and unknown actions before upload", async () => {
    await expect(runFreeSkiAnalysis({ videoPath: path.join(directory, "..", "private.mp4"), actionId: "parallel" })).rejects.toMatchObject({ code: "analysis-invalid-video" });
    const webm = path.join(directory, "videos", "sample.webm");
    await writeFile(webm, "video");
    await expect(runFreeSkiAnalysis({ videoPath: webm, actionId: "parallel" })).rejects.toMatchObject({ code: "analysis-invalid-video" });
    await expect(runFreeSkiAnalysis({ videoPath, actionId: "custom:any" })).rejects.toMatchObject({ code: "analysis-invalid-action" });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/analyze"))).toBe(false);
  });
  it("stops polling if durable lease ownership is lost", async () => {
    await expect(runFreeSkiAnalysis({ videoPath, actionId: "parallel", onSubmitted: async () => false })).rejects.toMatchObject({ code: "analysis-cancelled" });
    expect(fetcher.mock.calls.some(([url]) => url.includes("/api/jobs/"))).toBe(false);
  });
  it("does not retry a possibly accepted upload after a connection error", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/analyze")) throw new Error("password=do-not-leak C:\\private");
      return original(url);
    });
    await expect(runFreeSkiAnalysis({ videoPath, actionId: "parallel" })).rejects.toMatchObject({ message: "analysis-unavailable" });
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/api/analyze"))).toHaveLength(1);
  });
  it("does not expose raw upstream errors or cross-job results", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/jobs/")
      ? json({ job_id: jobId, action_name: "parallel", status: "error", error: "secret database credentials" }) : original(url));
    await expect(runFreeSkiAnalysis({ videoPath, actionId: "parallel" })).rejects.toMatchObject({ message: "analysis-failed" });
    fetcher.mockImplementation(async (url: string) => url.includes("/api/jobs/")
      ? json({ job_id: "b".repeat(32), action_name: "parallel", status: "done", result: validResult }) : original(url));
    await expect(runFreeSkiAnalysis({ videoPath, actionId: "parallel", upstreamJobId: jobId })).rejects.toMatchObject({ code: "analysis-invalid-response" });
  });
  it("bounds upstream response bodies", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes("/api/jobs/")
      ? json({ job_id: jobId, padding: "x".repeat(2 * 1024 * 1024) }) : original(url));
    await expect(runFreeSkiAnalysis({ videoPath, actionId: "parallel", upstreamJobId: jobId })).rejects.toMatchObject({ code: "analysis-invalid-response" });
  });
  it("cancels an oversized dynamic JSON body before parsing it", async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel: cancelled });
    await expect(readFreeSkiReportJson(new Response(stream))).rejects.toMatchObject({ code: "analysis-invalid-response" });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it.each([
    { deploymentId: "another-deployment" },
    { apiVersion: 1 },
    { profile: "native" },
    { features: { report: false } },
  ])("rejects incompatible report capabilities before fetching private resources: %j", async capabilityChange => {
    vi.stubEnv("FREESKI_DEPLOYMENT_ID", "integration-instance");
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async url => url.endsWith("/health") ? json({ ...bridge, deploymentId: "integration-instance" })
      : url.endsWith("/api/integrations/v2/capabilities") ? json({ apiVersion: 2, deploymentId: "integration-instance",
        profile: "platform-integration", features: { report: true }, ...capabilityChange }) : original(url));
    await expect(requestFreeSkiReportResource({ jobId, deploymentId: "integration-instance", resource: "report" }))
      .rejects.toMatchObject({ code: "analysis-unavailable" });
    expect(fetcher.mock.calls.some(([url]) => url.includes("/api/integrations/v2/analyses/"))).toBe(false);
  });
  it("rejects a report source pin that differs from current configuration before authenticating", async () => {
    vi.stubEnv("FREESKI_DEPLOYMENT_ID", "integration-instance");
    await expect(requestFreeSkiReportResource({ jobId, deploymentId: "another-instance", resource: "report" }))
      .rejects.toMatchObject({ code: "analysis-unconfigured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires the keyframes capability and a well-formed keyframe id before fetching images", async () => {
    vi.stubEnv("FREESKI_DEPLOYMENT_ID", "integration-instance");
    await expect(requestFreeSkiReportResource({ jobId, deploymentId: "integration-instance", resource: "keyframe", keyframeId: "../secret" }))
      .rejects.toMatchObject({ code: "analysis-invalid-response" });
    expect(fetcher).not.toHaveBeenCalled();
    const original = fetcher.getMockImplementation()!;
    let features: Record<string, boolean> = { report: true };
    fetcher.mockImplementation(async url => url.endsWith("/health") ? json({ ...bridge, deploymentId: "integration-instance" })
      : url.endsWith("/api/integrations/v2/capabilities") ? json({ apiVersion: 2, deploymentId: "integration-instance",
        profile: "platform-integration", features })
      : url.includes("/api/integrations/v2/analyses/") ? new Response("ok") : original(url));
    const keyframeId = `kf_${"b".repeat(32)}`;
    await expect(requestFreeSkiReportResource({ jobId, deploymentId: "integration-instance", resource: "keyframe", keyframeId }))
      .rejects.toMatchObject({ code: "analysis-unavailable" });
    features = { report: true, keyframes: true };
    await requestFreeSkiReportResource({ jobId, deploymentId: "integration-instance", resource: "keyframes", turnId: "turn_2" });
    await requestFreeSkiReportResource({ jobId, deploymentId: "integration-instance", resource: "keyframe", keyframeId });
    const urls = fetcher.mock.calls.map(([url]) => String(url)).filter(url => url.includes("/analyses/"));
    expect(urls).toEqual([expect.stringMatching(new RegExp(`/analyses/${jobId}/turns/turn_2/keyframes$`)),
      expect.stringMatching(new RegExp(`/analyses/${jobId}/assets/keyframe\\?keyframe_id=${keyframeId}$`))]);
  });
  it("requires the explainer capability before fetching the explainer manifest or video", async () => {
    vi.stubEnv("FREESKI_DEPLOYMENT_ID", "integration-instance");
    const original = fetcher.getMockImplementation()!;
    let features: Record<string, boolean> = { report: true, keyframes: true };
    fetcher.mockImplementation(async url => url.endsWith("/health") ? json({ ...bridge, deploymentId: "integration-instance" })
      : url.endsWith("/api/integrations/v2/capabilities") ? json({ apiVersion: 2, deploymentId: "integration-instance",
        profile: "platform-integration", features })
      : url.includes("/api/integrations/v2/analyses/") ? new Response("ok") : original(url));
    await expect(requestFreeSkiReportResource({ jobId, deploymentId: "integration-instance", resource: "explainer" }))
      .rejects.toMatchObject({ code: "analysis-unavailable" });
    features = { report: true, explainer: true };
    await requestFreeSkiReportResource({ jobId, deploymentId: "integration-instance", resource: "explainer" });
    await requestFreeSkiReportResource({ jobId, deploymentId: "integration-instance", resource: "explainer-video", range: "bytes=0-99" });
    const calls = fetcher.mock.calls.filter(([url]) => String(url).includes("/analyses/"));
    expect(calls.map(([url]) => String(url))).toEqual([expect.stringMatching(new RegExp(`/analyses/${jobId}/explainer$`)),
      expect.stringMatching(new RegExp(`/analyses/${jobId}/assets/explainer$`))]);
    expect(new Headers((calls[1][1] as RequestInit).headers).get("Range")).toBe("bytes=0-99");
  });
  it("honors cancellation and only cleans validated upstream IDs", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runFreeSkiAnalysis({ videoPath, actionId: "parallel", signal: controller.signal })).rejects.toMatchObject({ code: "analysis-cancelled" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await cleanupFreeSkiJob("../../other-account")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await cleanupFreeSkiJob(jobId)).toBe(true);
    const deletion = fetcher.mock.calls.find(([url]) => url.includes("/api/aaa/jobs/"));
    expect((deletion?.[1] as RequestInit).method).toBe("DELETE");
  });
});

describe("analysis deadline while waiting for compute", () => {
  afterEach(() => vi.useRealTimers());
  it("does not count time spent waiting for compute", () => {
    vi.useFakeTimers();
    const deadline = pausableDeadline(60_000);
    vi.advanceTimersByTime(50_000);
    deadline.pause(true);
    vi.advanceTimersByTime(6 * 60 * 60_000);
    expect(deadline.signal.aborted).toBe(false);
    deadline.pause(false);
    vi.advanceTimersByTime(9_999);
    expect(deadline.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(deadline.signal.aborted).toBe(true);
  });
  it("keeps one running timer through repeated reports and clears it when done", () => {
    vi.useFakeTimers();
    const deadline = pausableDeadline(60_000);
    deadline.pause(false);
    deadline.pause(true);
    deadline.pause(true);
    deadline.pause(false);
    deadline.pause(false);
    expect(vi.getTimerCount()).toBe(1);
    deadline.clear();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(120_000);
    expect(deadline.signal.aborted).toBe(false);
  });
});
