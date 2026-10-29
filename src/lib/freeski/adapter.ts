import { setTimeout as delay } from "node:timers/promises";
import { isFreeSkiActionId, normalizeFreeSkiCatalog, parseFreeSkiActionId,
  type FreeSkiActionId, type FreeSkiActionOption, type FreeSkiActionSelection } from "./actions";
import { getFreeSkiConfig, type FreeSkiConfig } from "./config";
import type { FreeSkiAnalysisResult, FreeSkiErrorCode, FreeSkiGradingReason } from "./types";
import { ResumableUploadError, submitResumableVideo } from "./resumable-upload";
import { KEYFRAME_ID, scorecardSchema } from "./scorecard";
import { wakeFreeSkiProvider } from "./wake";

export class FreeSkiError extends Error {
  constructor(public readonly code: FreeSkiErrorCode) {
    super(code);
    this.name = "FreeSkiError";
  }
}

type Mapping = Record<string, unknown>;
function mapping(value: unknown): Mapping {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Mapping : {};
}
function score(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}
function safeText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  // The upstream report may contain links/paths. They do not belong in the AAA result contract.
  if (/(?:https?:\/\/|file:|[A-Za-z]:\\|\/media\/|bearer\s|(?:password|access_token)\s*[:=])/i.test(value)) return null;
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, limit);
  return text || null;
}
function cues(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return entries.slice(0, 20).flatMap((entry) => {
    const text = safeText(entry, 1000);
    return text ? [text] : [];
  });
}

function bridgeIdentity(value: Mapping, config: FreeSkiConfig): boolean {
  return isIsolatedBridge(value) && (!config.deploymentId || value.deploymentId === config.deploymentId);
}

function expectedActionNames(selection: FreeSkiActionSelection, result: boolean): string[] {
  // Improvement requests/jobs use "parallel", while FreeSki normalizes the
  // scored result to demonstration_parallel. Keep the old result spelling
  // readable without broadening compatibility to other parallel-family moves.
  return result && selection.pathType === "improvement" && selection.actionName === "parallel"
    ? ["demonstration_parallel", "parallel"] : [selection.actionName];
}

function assertActionIdentity(data: Mapping, selection: FreeSkiActionSelection, result = false): void {
  const meta = mapping(data.meta);
  const actualAction = data.action_name ?? meta.action_name;
  const expectedActions = expectedActionNames(selection, result);
  if (typeof actualAction !== "string" || !expectedActions.includes(actualAction)) throw new FreeSkiError("analysis-invalid-response");
  // Older upstream results omit these fields. If supplied, neither a job nor
  // its result may silently cross certification levels or analysis paths.
  for (const source of [data, meta]) {
    if (source.action_name !== undefined && (typeof source.action_name !== "string" || !expectedActions.includes(source.action_name))) {
      throw new FreeSkiError("analysis-invalid-response");
    }
    if (source.path_type !== undefined && source.path_type !== selection.pathType) {
      throw new FreeSkiError("analysis-invalid-response");
    }
    // Job.level echoes the requested CSIA level. Result.level instead is the
    // measured beginner/intermediate/advanced/expert score band (or null).
    if (!result && source.level !== undefined && source.level !== selection.level) {
      throw new FreeSkiError("analysis-invalid-response");
    }
    // The skier's level picks the improvement examples. Jobs from before it was
    // sent omit it; an echoed value must match what this job asked for.
    if (source.current_level !== undefined && (source.current_level ?? null) !== selection.currentLevel) {
      throw new FreeSkiError("analysis-invalid-response");
    }
  }
  const selectedLevel = mapping(data.level_assessment).selected_level;
  if (result && selectedLevel !== undefined && selectedLevel !== selection.level) {
    throw new FreeSkiError("analysis-invalid-response");
  }
}

/** Grade only explicit TECH evidence. Missing/invalid grades never become zero. */
export function normalizeFreeSkiResult(raw: unknown, actionId: FreeSkiActionId): FreeSkiAnalysisResult {
  const data = mapping(raw);
  if (!Object.keys(data).length) throw new FreeSkiError("analysis-invalid-response");
  const meta = mapping(data.meta);
  const selection = parseFreeSkiActionId(actionId);
  if (!selection) throw new FreeSkiError("analysis-invalid-response");
  assertActionIdentity(data, selection, true);
  const report = mapping(data.report);
  const kind = data.score_kind;
  // A present but invalid tech_quality must not silently fall back to the legacy score.
  const headline = data.tech_quality != null
    ? score(data.tech_quality)
    : score(data.overall_score ?? report.overall_score);
  const graded = kind === "TECH" && headline !== null;
  const reasons: Record<string, FreeSkiGradingReason> = {
    WRONG_ACTION: "wrong-action", INSUFFICIENT_TURNS: "insufficient-turns", LOW_CONFIDENCE: "low-confidence",
  };
  const turns = data.num_turns ?? meta.num_turns;
  const rawMetrics = mapping(data.per_metric_scores ?? report.per_metric_scores);
  const card = data.scorecard === undefined ? null : scorecardSchema.safeParse(data.scorecard);
  // A malformed scorecard, or one for another action or level, is dropped rather than relabelled.
  // Scorecards from before current_level existed omit it; a present one must be this request's.
  const scorecard = card?.success && expectedActionNames(selection, true).includes(card.data.action) &&
    card.data.level === selection.level &&
    (card.data.current_level === undefined || card.data.current_level === selection.currentLevel) ? card.data : null;
  return {
    version: 1,
    provider: "freeski",
    actionId,
    gradingStatus: graded ? "graded" : "unavailable",
    gradingReason: graded ? null : typeof kind === "string" && reasons[kind] ? reasons[kind] : "score-unavailable",
    score: graded ? headline : null,
    scoreKind: graded ? "TECH" : null,
    numTurns: typeof turns === "number" && Number.isInteger(turns) && turns >= 0 && turns <= 100_000 ? turns : null,
    coachingZh: graded ? cues(data.coaching_zh ?? report.coaching_zh) : [],
    coachingEn: graded ? cues(data.coaching_en ?? report.coaching_en) : [],
    metrics: graded ? Object.entries(rawMetrics).slice(0, 40).flatMap(([key, value]) =>
      /^[a-z][a-z0-9_]{0,63}$/.test(key) ? [{ key, score: score(value) }] : []) : [],
    scorerVersion: safeText(data.scorer_version, 80),
    ...(scorecard ? { scorecard } : {}),
  };
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const JOB_ID = /^[a-f0-9]{32}$/;
type TokenCache = { configKey: string; token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;
let loginPromise: Promise<string> | null = null;

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new FreeSkiError("analysis-invalid-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new FreeSkiError("analysis-invalid-response");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof FreeSkiError) throw error;
    throw new FreeSkiError("analysis-invalid-response");
  } finally {
    reader.releaseLock();
  }
}

async function request(config: FreeSkiConfig, endpoint: string, init: RequestInit, signal?: AbortSignal, timeoutMs = config.requestTimeoutMs): Promise<Response> {
  if (signal?.aborted) throw new FreeSkiError("analysis-cancelled");
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(`${config.baseUrl}${endpoint}`, { ...init, redirect: "error", cache: "no-store", signal: requestSignal });
  } catch {
    const code = signal?.aborted ? "analysis-cancelled" : requestSignal.aborted ? "analysis-timeout" : "analysis-unavailable";
    // An unreachable on-demand provider is asked for, not awaited: the caller retries shortly.
    if (code === "analysis-unavailable") void wakeFreeSkiProvider({ reason: "aaa request" });
    throw new FreeSkiError(code);
  }
}

async function login(config: FreeSkiConfig, signal?: AbortSignal): Promise<string> {
  const configKey = `${config.baseUrl}|${config.identifier}|${config.password}`;
  if (tokenCache?.configKey === configKey && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  // The service has one credential set. Never serialize credentials or upstream bodies into errors/logs.
  if (!loginPromise) loginPromise = (async () => {
    const health = await request(config, "/health", {}, signal, 3_000);
    if (!health.ok || !bridgeIdentity(mapping(await readJson(health)), config)) throw new FreeSkiError("analysis-unavailable");
    const response = await request(config, "/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: config.identifier, password: config.password }),
    }, signal);
    if (!response.ok) throw new FreeSkiError("analysis-auth-failed");
    const session = mapping(await readJson(response));
    const token = session.access_token;
    if (typeof token !== "string" || token.length < 30 || token.length > 8_000 || token === "dev") throw new FreeSkiError("analysis-auth-failed");
    const user = mapping(session.user);
    if (!user.onboarded) throw new FreeSkiError("analysis-auth-failed");
    tokenCache = { configKey, token, expiresAt: Date.now() + 15 * 60_000 };
    return token;
  })();
  try {
    return await loginPromise;
  } finally {
    loginPromise = null;
  }
}

async function authenticated(config: FreeSkiConfig, endpoint: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const send = async () => {
    const token = await login(config, signal);
    return request(config, endpoint, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } }, signal);
  };
  let response = await send();
  if (response.status === 401) {
    await response.body?.cancel();
    tokenCache = null;
    response = await send();
  }
  return response;
}

export async function freeSkiServiceState(): Promise<{ configured: boolean; available: boolean }> {
  const config = getFreeSkiConfig();
  if (!config) return { configured: false, available: false };
  try {
    const response = await authenticated(config, "/api/aaa/health", {}, AbortSignal.timeout(3_000));
    const data = response.ok ? mapping(await readJson(response)) : {};
    return { configured: true, available: bridgeIdentity(data, config) };
  } catch {
    return { configured: true, available: false };
  }
}

/** Current, authenticated upstream catalog; an outage never enables static fallbacks. */
export async function getFreeSkiActionCatalog(signal?: AbortSignal): Promise<FreeSkiActionOption[]> {
  const config = getFreeSkiConfig();
  if (!config) throw new FreeSkiError("analysis-unconfigured");
  const response = await authenticated(config, "/api/aaa/catalog", {}, signal);
  if (response.status === 401 || response.status === 403) throw new FreeSkiError("analysis-auth-failed");
  if (!response.ok) throw new FreeSkiError("analysis-unavailable");
  return normalizeFreeSkiCatalog(await readJson(response));
}

export type FreeSkiSchedulerState = {
  connected: boolean;
  runtimeState: "stopped" | "starting" | "ready" | null;
  waitingReason: string | null;
};

/** Authenticated, deliberately narrow scheduler view; no broker credentials or job inventory. */
export async function freeSkiSchedulerState(): Promise<FreeSkiSchedulerState> {
  const config = getFreeSkiConfig();
  const unavailable: FreeSkiSchedulerState = { connected: false, runtimeState: null, waitingReason: null };
  if (!config) return unavailable;
  const response = await authenticated(config, "/api/aaa/scheduler", {}, AbortSignal.timeout(3_000));
  if (!response.ok) throw new FreeSkiError("analysis-unavailable");
  const data = mapping(await readJson(response));
  if (typeof data.connected !== "boolean" ||
      (data.runtimeState !== null && (typeof data.runtimeState !== "string" || !["stopped", "starting", "ready"].includes(data.runtimeState))) ||
      (data.waitingReason !== null && typeof data.waitingReason !== "string")) {
    throw new FreeSkiError("analysis-invalid-response");
  }
  if (!data.connected) return unavailable;
  const reason = data.waitingReason;
  const waitingReason = typeof reason === "string" &&
      !/[/\\\u0000-\u001f\u007f-\u009f]|\b(?:https?|file|ftp|data|javascript|mailto):|\b(?:bearer|basic)\s+|(?:password|passwd|access[_-]?token|api[_-]?key|secret|authorization|cookie|token|jwt|密码|令牌|密钥)\s*[:=]|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/i.test(reason)
    ? reason.trim().slice(0, 400) || null : null;
  return { connected: true, runtimeState: data.runtimeState as FreeSkiSchedulerState["runtimeState"], waitingReason };
}

function isIsolatedBridge(data: Mapping): boolean {
  return data.ok === true && data.isolated === true && data.featureNewScorer === false && data.identityGate === true;
}

async function videoForUpload(videoPath: string, maxBytes: number): Promise<{ bytes: Buffer; extension: string }> {
  try {
    // Private files belong to runtime storage, never the deployment bundle.
    // Use documented ignored dynamic imports to keep tracing from following arbitrary storage paths.
    const { readFile, realpath, stat } = await import(/* turbopackIgnore: true */ "node:fs/promises");
    const path = (await import(/* turbopackIgnore: true */ "node:path")).default;
    const privateRoot = await realpath(path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage")));
    const full = await realpath(videoPath);
    const relative = path.relative(privateRoot, full);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("outside private storage");
    const extension = path.extname(full).toLowerCase();
    if (![".mp4", ".mov", ".m4v", ".avi", ".mkv"].includes(extension)) throw new Error("unsupported extension");
    const info = await stat(full);
    if (!info.isFile() || info.size <= 0 || info.size > maxBytes) throw new Error("invalid size");
    const bytes = await readFile(full);
    if (bytes.length > maxBytes) throw new Error("file grew");
    return { bytes, extension };
  } catch {
    throw new FreeSkiError("analysis-invalid-video");
  }
}

/** Reconcile a previously accepted durable request before releasing its credit. */
async function recoverClosedActionRequest(config: FreeSkiConfig, requestKey: string | undefined,
  signal?: AbortSignal): Promise<string> {
  if (!requestKey || requestKey.length > 200 || !/^aaa:(?:booking|account):[A-Za-z0-9_-]+$/.test(requestKey)) {
    throw new FreeSkiError("analysis-invalid-action");
  }
  let data: Mapping;
  try {
    const response = await authenticated(config, `/api/aaa/requests/${encodeURIComponent(requestKey)}`, {}, signal);
    if (!response.ok) throw new FreeSkiError("analysis-unavailable");
    data = mapping(await readJson(response));
  } catch {
    // An unavailable/unauthorized lookup proves nothing about whether an earlier
    // POST succeeded. Keep the reservation and retry through the durable queue.
    throw new FreeSkiError("analysis-unavailable");
  }
  if (data.state === "found" && typeof data.jobId === "string" && JOB_ID.test(data.jobId)) return data.jobId;
  // Only the exact negative lookup contract proves that no earlier POST won.
  // Unknown fields could indicate a changed or ambiguous bridge response.
  if (data.state === "absent" && Object.keys(data).length === 1) {
    throw new FreeSkiError("analysis-action-closed");
  }
  // Includes a still-in-flight POST, unknown states and malformed job identities.
  throw new FreeSkiError("analysis-unavailable");
}

export async function submitFreeSkiAnalysis(input: {
  videoPath: string;
  actionId: string;
  requestKey?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const config = getFreeSkiConfig();
  if (!config) throw new FreeSkiError("analysis-unconfigured");
  const selection = parseFreeSkiActionId(input.actionId);
  if (!selection) throw new FreeSkiError("analysis-invalid-action");
  const health = await authenticated(config, "/api/aaa/health", {}, input.signal);
  const healthData = health.ok ? mapping(await readJson(health)) : {};
  if (!bridgeIdentity(healthData, config)) throw new FreeSkiError("analysis-unavailable");
  const catalog = await getFreeSkiActionCatalog(input.signal);
  if (!catalog.some((option) => option.id === selection.catalogId && option.available)) {
    return recoverClosedActionRequest(config, input.requestKey, input.signal);
  }
  // New deployments recover an accepted upload before reading or re-sending
  // its bytes. A lost HTTP response must not cost another video upload.
  if (config.deploymentId && input.requestKey) {
    const previous = await authenticated(config, `/api/aaa/requests/${encodeURIComponent(input.requestKey)}`, {}, input.signal);
    if (!previous.ok) throw new FreeSkiError("analysis-unavailable");
    const recovered = mapping(await readJson(previous));
    if (recovered.state === "found" && typeof recovered.jobId === "string" && JOB_ID.test(recovered.jobId)) return recovered.jobId;
    if (!(recovered.state === "absent" && Object.keys(recovered).length === 1)) throw new FreeSkiError("analysis-unavailable");
  }
  if (healthData.apiVersion === 2 && config.deploymentId && input.requestKey) {
    const response = await authenticated(config, "/api/integrations/v2/capabilities", {}, input.signal);
    if (!response.ok) {await response.body?.cancel(); throw new FreeSkiError("analysis-unavailable");}
    const capability = mapping(await readJson(response));
    if (capability.apiVersion !== 2 || capability.deploymentId !== config.deploymentId || capability.profile !== "platform-integration") throw new FreeSkiError("analysis-invalid-response");
    if (mapping(capability.features).resumableUpload === true) {
      try {
        const maxBytes = mapping(capability.uploads).maxBytes;
        if (typeof maxBytes !== "number" || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 200 * 1024 * 1024) throw new FreeSkiError("analysis-invalid-response");
        return await submitResumableVideo({videoPath:input.videoPath,maxBytes:Math.min(config.maxVideoBytes,maxBytes),requestKey:input.requestKey,selection,signal:input.signal,
          send:(endpoint,init,signal)=>authenticated(config,endpoint,init,signal)});
      } catch (error) {
        if (error instanceof ResumableUploadError) throw new FreeSkiError(error.reason === "invalid-video" ? "analysis-invalid-video" : error.reason === "cancelled" ? "analysis-cancelled" : "analysis-unavailable");
        throw error;
      }
    }
  }
  const { bytes, extension } = await videoForUpload(input.videoPath, config.maxVideoBytes);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: extension === ".mov" ? "video/quicktime" : "video/mp4" }), `lesson${extension}`);
  form.append("action_name", selection.actionName);
  form.append("skill_family", selection.skillFamily);
  form.append("path_type", selection.pathType);
  if (selection.level) form.append("level", selection.level);
  if (selection.currentLevel) form.append("current_level", selection.currentLevel);
  form.append("rubric", "csia");
  form.append("async_mode", "true");
  if (input.requestKey) form.append("request_key", input.requestKey);
  const response = await authenticated(config, "/api/analyze", { method: "POST", body: form }, input.signal);
  if (response.status === 403 || response.status === 401) throw new FreeSkiError("analysis-auth-failed");
  if (response.status !== 202) throw new FreeSkiError(response.status === 415 ? "analysis-invalid-video" : "analysis-failed");
  const data = mapping(await readJson(response));
  if (typeof data.job_id !== "string" || !JOB_ID.test(data.job_id)) throw new FreeSkiError("analysis-invalid-response");
  return data.job_id;
}

/** FreeSki keeps such a job and starts it by itself once compute is back. */
export type FreeSkiQueueReason = "compute_offline" | "waiting_for_compute";
export type FreeSkiUpstreamJob = {
  status: "queued" | "running" | "done" | "error" | "cancelled";
  brokerStatus: string | null;
  queueReason?: FreeSkiQueueReason | null;
  /** How far a running analysis has got, 0 to 1, when FreeSki reports it. */
  progress?: number | null;
  result: FreeSkiAnalysisResult | null;
};
const jobProgress = (job: Mapping): number | null => job.status === "running" && typeof job.progress === "number" &&
  Number.isFinite(job.progress) ? Math.max(0, Math.min(1, job.progress)) : null;
const queueReason = (job: Mapping): FreeSkiQueueReason | null => job.status === "queued" &&
  (job.queue_reason === "compute_offline" || job.queue_reason === "waiting_for_compute") ? job.queue_reason : null;

/** A deadline that stops counting while FreeSki reports the job is waiting for compute. */
export function pausableDeadline(ms: number) {
  const controller = new AbortController();
  let remaining = ms, since = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => controller.abort(), remaining);
  return {
    signal: controller.signal,
    pause(paused: boolean) {
      if (paused && timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
        remaining -= Date.now() - since;
      } else if (!paused && timer === undefined && !controller.signal.aborted) {
        since = Date.now();
        timer = setTimeout(() => controller.abort(), Math.max(0, remaining));
      }
    },
    clear() { clearTimeout(timer); timer = undefined; },
  };
}

/** A queued broker, an interrupted worker or a transport outage is not a failed analysis. */
export async function getFreeSkiAnalysisJob(upstreamJobId: string, actionId: string,
  signal?: AbortSignal): Promise<FreeSkiUpstreamJob> {
  const config = getFreeSkiConfig();
  if (!config) throw new FreeSkiError("analysis-unconfigured");
  const selection = parseFreeSkiActionId(actionId);
  if (!JOB_ID.test(upstreamJobId) || !selection) throw new FreeSkiError("analysis-invalid-response");
  const response = await authenticated(config, `/api/jobs/${upstreamJobId}`, {}, signal);
  if (!response.ok) throw new FreeSkiError("analysis-unavailable");
  const job = mapping(await readJson(response));
  if (job.job_id !== upstreamJobId ||
      !["queued", "running", "done", "error", "cancelled"].includes(String(job.status))) throw new FreeSkiError("analysis-invalid-response");
  assertActionIdentity(job, selection);
  return {
    status: job.status as FreeSkiUpstreamJob["status"],
    brokerStatus: typeof job.broker_status === "string" ? job.broker_status : null,
    queueReason: queueReason(job),
    progress: jobProgress(job),
    result: job.status === "done" ? normalizeFreeSkiResult(job.result, selection.id) : null,
  };
}

export async function runFreeSkiAnalysis(input: {
  videoPath: string;
  actionId: string;
  upstreamJobId?: string | null;
  signal?: AbortSignal;
  onSubmitted?: (upstreamJobId: string) => Promise<boolean | void>;
}): Promise<FreeSkiAnalysisResult> {
  const config = getFreeSkiConfig();
  if (!config) throw new FreeSkiError("analysis-unconfigured");
  if (!isFreeSkiActionId(input.actionId)) throw new FreeSkiError("analysis-invalid-action");
  const actionId = input.actionId;
  const deadline = pausableDeadline(config.analysisTimeoutMs);
  const deadlineSignal = deadline.signal;
  const signal = input.signal ? AbortSignal.any([input.signal, deadlineSignal]) : deadlineSignal;
  let jobId = input.upstreamJobId;
  try {
    // Never send videos to the original FreeSki service/history by accidental configuration.
    const health = await authenticated(config, "/api/aaa/health", {}, signal);
    if (!health.ok || !bridgeIdentity(mapping(await readJson(health)), config)) throw new FreeSkiError("analysis-unavailable");
    if (jobId && !JOB_ID.test(jobId)) throw new FreeSkiError("analysis-invalid-response");
    if (!jobId) {
      jobId = await submitFreeSkiAnalysis({ videoPath: input.videoPath, actionId, signal });
      if (await input.onSubmitted?.(jobId) === false) throw new FreeSkiError("analysis-cancelled");
    }
    for (;;) {
      const response = await authenticated(config, `/api/jobs/${jobId}`, {}, signal);
      if (!response.ok) throw new FreeSkiError(response.status === 401 || response.status === 403 ? "analysis-auth-failed" : "analysis-failed");
      const job = mapping(await readJson(response));
      if (job.job_id !== jobId) throw new FreeSkiError("analysis-invalid-response");
      assertActionIdentity(job, parseFreeSkiActionId(actionId)!);
      if (job.status === "done") return normalizeFreeSkiResult(job.result, actionId);
      if (job.status === "error" || job.status === "cancelled") throw new FreeSkiError("analysis-failed");
      if (job.status !== "queued" && job.status !== "running") throw new FreeSkiError("analysis-invalid-response");
      deadline.pause(queueReason(job) !== null);
      await delay(config.pollIntervalMs, undefined, { signal });
    }
  } catch (error) {
    if (deadlineSignal.aborted) throw new FreeSkiError("analysis-timeout");
    if (input.signal?.aborted) throw new FreeSkiError("analysis-cancelled");
    if (error instanceof FreeSkiError) throw error;
    throw new FreeSkiError("analysis-failed");
  } finally {
    deadline.clear();
  }
}

/** Only the isolated AAA wrapper exposes this owner-scoped cleanup endpoint. */
export async function cleanupFreeSkiJob(upstreamJobId: string): Promise<boolean> {
  const config = getFreeSkiConfig();
  if (!config || !JOB_ID.test(upstreamJobId)) return false;
  try {
    const response = await authenticated(config, `/api/aaa/jobs/${upstreamJobId}`, { method: "DELETE" });
    await response.body?.cancel();
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

/** Only fixed integration resources, pinned to the deployment stored on the job. */
export async function requestFreeSkiReportResource(input: { jobId: string; deploymentId: string;
  resource: "report" | "turn" | "keyframes" | "keyframe" | "explainer" | "explainer-video" | "background" | "user-pose" | "reference-pose" | "standard-pose";
  turnId?: string; keyframeId?: string; range?: string; signal?: AbortSignal }): Promise<Response> {
  const config = getFreeSkiConfig();
  if (!config || !config.deploymentId || config.deploymentId !== input.deploymentId) throw new FreeSkiError("analysis-unconfigured");
  if (!JOB_ID.test(input.jobId) || input.turnId && !/^turn_\d{1,5}$/.test(input.turnId) ||
      input.resource === "keyframes" && !input.turnId ||
      input.resource === "keyframe" && !KEYFRAME_ID.test(input.keyframeId ?? "")) throw new FreeSkiError("analysis-invalid-response");
  const capabilities = await authenticated(config, "/api/integrations/v2/capabilities", {}, input.signal);
  const capability = capabilities.ok ? mapping(await readJson(capabilities)) : {};
  const features = mapping(capability.features);
  if (capability.apiVersion !== 2 || capability.deploymentId !== config.deploymentId ||
      capability.profile !== "platform-integration" || features.report !== true ||
      (input.resource === "keyframes" || input.resource === "keyframe") && features.keyframes !== true ||
      (input.resource === "explainer" || input.resource === "explainer-video") && features.explainer !== true) throw new FreeSkiError("analysis-unavailable");
  const root = `/api/integrations/v2/analyses/${input.jobId}`;
  const endpoint = input.resource === "report" ? `${root}/report` : input.resource === "turn"
    ? `${root}/turns/${input.turnId}` : input.resource === "keyframes" ? `${root}/turns/${input.turnId}/keyframes`
    : input.resource === "keyframe" ? `${root}/assets/keyframe?keyframe_id=${input.keyframeId}`
    : input.resource === "explainer" ? `${root}/explainer` : input.resource === "explainer-video" ? `${root}/assets/explainer`
    : `${root}/assets/${input.resource}${input.turnId ? `?turn_id=${input.turnId}` : ""}`;
  const headers: Record<string, string> = {};
  if (input.range) {
    if (input.range.length > 100 || !/^bytes=\d*-\d*$/.test(input.range)) throw new FreeSkiError("analysis-invalid-response");
    headers.Range = input.range;
  }
  return authenticated(config, endpoint, { headers }, input.signal);
}

export async function readFreeSkiReportJson(response: Response): Promise<unknown> {
  return readJson(response);
}

/** Only these resources can cross the product boundary; callers supply a verified actor. */
export async function requestFreeSkiWorkspaceResource(input: { jobId: string; deploymentId: string;
  resource: string[]; method: string; actorHash: string; role: "owner" | "coach";
  body?: unknown; range?: string; signal?: AbortSignal }): Promise<Response> {
  const config = getFreeSkiConfig();
  if (!config?.deploymentId || config.deploymentId !== input.deploymentId) throw new FreeSkiError("analysis-unconfigured");
  if (!JOB_ID.test(input.jobId) || !/^[a-f0-9]{64}$/.test(input.actorHash)) throw new FreeSkiError("analysis-invalid-response");
  const route = input.resource.join("/");
  let verb: string | undefined, feature = "coachingWorkspace";
  if (route === "workspace") verb = "GET";
  else if (/^workspace\/(consent|annotations|reference)$/.test(route)) verb = "POST";
  else if (route === "observations") { verb = "GET|POST|DELETE"; feature = "observationJobs"; }
  else if (route === "evidence") { verb = "POST"; feature = "evidenceWindows"; }
  else if (route === "exports") { verb = "POST"; feature = "comparisonExports"; }
  else if (/^exports\/[a-f0-9]{32}$/.test(route)) { verb = "GET|DELETE"; feature = "comparisonExports"; }
  else if (/^exports\/[a-f0-9]{32}\/file$/.test(route)) { verb = "GET"; feature = "comparisonExports"; }
  else if (route === "references/items") { verb = "GET|POST"; feature = "referenceLibrary"; }
  else if (route === "references/published") { verb = "GET"; feature = "referenceLibrary"; }
  else if (/^references\/items\/ref_[a-f0-9]{32}$/.test(route)) { verb = "GET|PATCH"; feature = "referenceLibrary"; }
  else if (/^references\/items\/ref_[a-f0-9]{32}\/(submit|review|publish|withdraw)$/.test(route)) { verb = "POST"; feature = "referenceLibrary"; }
  if (!verb?.split("|").includes(input.method)) throw new FreeSkiError("analysis-invalid-response");
  const caps = await authenticated(config, "/api/integrations/v2/capabilities", {}, input.signal);
  const capability = caps.ok ? mapping(await readJson(caps)) : {};
  if (capability.apiVersion !== 2 || capability.deploymentId !== config.deploymentId || capability.profile !== "platform-integration" ||
      mapping(capability.features)[feature] !== true) throw new FreeSkiError("analysis-unavailable");
  const root = `/api/integrations/v2/analyses/${input.jobId}`;
  const endpoint = route.startsWith("references/") ? `/api/references/v1/${route.slice(11)}`
    : route === "evidence" ? "/api/evidence/v1/query" : `${root}/${route}`;
  const headers: Record<string, string> = { "X-Reference-Actor": `aaa:${input.role}:${input.actorHash}`, "X-Reference-Role": input.role };
  if (input.body !== undefined) headers["Content-Type"] = "application/json";
  if (input.range) {
    if (input.range.length > 100 || !/^bytes=\d*-\d*$/.test(input.range)) throw new FreeSkiError("analysis-invalid-response");
    headers.Range = input.range;
  }
  return authenticated(config, endpoint, { method: route === "workspace/annotations" ? "PUT" : input.method,
    headers, ...(input.body !== undefined ? {body: JSON.stringify(input.body)} : {}) }, input.signal);
}
