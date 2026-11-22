import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { FreeSkiError } from "../freeski/adapter";
import { seasonMotionId, type CsiaSeason } from "../freeski/csia-season";
import { decodeStandardMotion } from "../freeski/standard-motion";
import { freeSkiSeason, type FreeSkiSeasonClient, type SeasonRun } from "./freeski-season";
import { getPipelineConfig, type PipelineConfig } from "./pipeline-config";
import { formatSeasonFile, listProblems, seasonListSchema, toSeasonFile, type SeasonList } from "./season-list";
import { seasonsDir } from "./season-store";
import { initialSteps, isPublished, type Note, type UpdateStep, type UpdateStepKey } from "./steps";

/**
 * Runs an "update the actions" request to its end, in the analysis worker: FreeSki reads the movement out of the
 * season's demonstration videos and rebuilds its scoring reference, this repository's generator samples the
 * demonstrations and builds every action's standard into a staging folder, the result is checked and only then put
 * on the site, and FreeSki rebuilds action recognition from it. A failure before publishing leaves the site as it was.
 */

/** Below this a generated motion does not score like the demonstrations it was made from: nothing is published. */
export const MIN_OVERALL = 70;
const LOG_LINES = 200, LINE_CHARS = 300, KEPT_RUNS = 3;
const SECRET = /bearer\s+\S+|(?:token|password|passwd|secret|api[_-]?key)\S*\s*[=:]\s*\S+/gi;

/** A step that ended the run; `code` becomes the run's error. */
export class StepError extends Error {
  constructor(readonly code: string, readonly note: Note | null = null) {
    super(code);
    this.name = "StepError";
  }
}

export type RunRow = { id: string; list: unknown };
export type RunProgress = { steps: UpdateStep[]; log: string };
export type RunnerStore = {
  /** Closes runs whose worker went away, then takes the oldest requested run; null when there is none to take. */
  claim(now: Date): Promise<RunRow | null>;
  /** Writes progress and the heartbeat; false once the run is no longer this worker's (it was cancelled). */
  save(id: string, progress: RunProgress & { heartbeatAt: Date }): Promise<boolean>;
  finish(id: string, result: RunProgress & { status: "SUCCEEDED" | "FAILED"; error: string | null; finishedAt: Date }): Promise<void>;
  /** What a cancelled run had reported when it stopped. */
  record(id: string, progress: RunProgress): Promise<void>;
};
export type ScriptJob = { script: string; args: string[]; limitMs: number; signal: AbortSignal; onLine: (line: string) => void };
export type RunnerDeps = {
  store: RunnerStore; config: () => PipelineConfig | null; freeski: FreeSkiSeasonClient;
  /** Runs one of the repository's generator scripts to its end and resolves with its exit code. */
  script: (config: PipelineConfig, job: ScriptJob) => Promise<number>;
  /** The folder holding each run's staged files. */
  stagingRoot: string;
  now: () => Date; sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  beatMs: number; pollMs: number; lookMs: number;
  /** How many times an unreachable FreeSki is asked again while ModelCtrl starts it. */
  wakeTries: number;
};

function killTree(pid: number | undefined) {
  if (!pid) return;
  // The generator runs a pool of processes; on Windows ending the parent alone would leave them working.
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
}

export function runPythonScript(config: PipelineConfig, job: ScriptJob): Promise<number> {
  return new Promise((resolve, reject) => {
    const home = path.dirname(config.python);
    // A bare environment: the site's secrets are not the generator's business, and FreeSki's code reads some of the
    // same variable names (its storage folder, for one) with another meaning.
    const env: Record<string, string | undefined> = { PYTHONIOENCODING: "utf-8" };
    for (const name of ["SYSTEMROOT", "WINDIR", "TEMP", "TMP", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "HOME", "FREESKI_SEASON_DIR"])
      if (process.env[name]) env[name] = process.env[name];
    env.PATH = [home, path.join(home, "Library", "bin"), path.join(home, "Scripts"),
      ...(process.platform === "win32" ? [path.join(env.SYSTEMROOT ?? "C:\\Windows", "System32")] : ["/usr/local/bin", "/usr/bin", "/bin"])].join(path.delimiter);
    const child = spawn(config.python, ["-u", path.join(config.scriptsDir, job.script), ...job.args],
      { cwd: config.root, env: env as NodeJS.ProcessEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    // Generation keeps every core busy for a long time: analyses and the site go first.
    try { if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* it runs at normal priority */ }
    let ended = false, stopped: "cancelled" | "timeout" | null = null;
    const stop = (why: "cancelled" | "timeout") => {
      if (ended) return;
      stopped ??= why;
      killTree(child.pid);
    };
    const timer = setTimeout(() => stop("timeout"), job.limitMs);
    const onAbort = () => stop("cancelled");
    job.signal.addEventListener("abort", onAbort, { once: true });
    if (job.signal.aborted) onAbort();
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on("line", job.onLine);
    const finish = (code: number | null, failed = false) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      job.signal.removeEventListener("abort", onAbort);
      if (stopped) reject(new StepError(stopped));
      else if (failed) reject(new StepError("script-unavailable"));
      else resolve(code ?? 1);
    };
    child.on("error", () => finish(null, true));
    child.on("close", code => finish(code));
  });
}

type Context = {
  deps: RunnerDeps; row: RunRow; list: SeasonList; season: CsiaSeason; config: PipelineConfig; stage: string; signal: AbortSignal;
  step: UpdateStep; log: (line: string) => void;
  /** Whether FreeSki offers its season API here; the first step finds out. */
  seasonApi: boolean;
  goldClips: number | null;
};
type Outcome = { skipped?: boolean; note?: Note } | void;

/** Asks again while FreeSki is being started; any other answer but a good one ends the step. */
async function reach<T>(ctx: Context, call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (ctx.signal.aborted || !(error instanceof FreeSkiError)) throw error;
      // An answer this site cannot read means FreeSki is running another version of its season API: waiting does not help.
      if (error.code === "analysis-invalid-response") throw new StepError("freeski-mismatch");
      if (!["analysis-unavailable", "analysis-timeout"].includes(error.code) || attempt >= ctx.deps.wakeTries) throw new StepError("freeski-unavailable");
      await ctx.deps.sleep(5_000, ctx.signal);
    }
  }
}

/** The lines of `current` that `previous` did not end with: FreeSki shows the tail of its log. */
export function newLines(previous: readonly string[], current: readonly string[]): string[] {
  for (let kept = Math.min(previous.length, current.length); kept > 0; kept--)
    if (previous.slice(-kept).every((line, index) => line === current[index])) return current.slice(kept);
  return [...current];
}

const whole = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
const names = (value: unknown) => Array.isArray(value) ? value.filter((name): name is string => typeof name === "string").slice(0, 12).map(name => name.slice(0, 60)) : [];

function stageNote(run: SeasonRun): Note {
  const done = whole(run.detail.clipsDone) ?? 0, total = whole(run.detail.clipsTotal) ?? 0;
  if (run.status === "queued") return { zh: "FreeSki 已收到，马上开始", en: "FreeSki has it and is about to start" };
  switch (run.step) {
    case "poses": return run.detail.waitingForCompute === true ? { zh: "等显卡空出来", en: "Waiting for the GPU" }
      : total ? { zh: `解析示范视频 ${done}/${total}`, en: `Analysing demonstration videos ${done}/${total}` }
      : { zh: "核对示范视频", en: "Checking the demonstration videos" };
    case "standards": return { zh: "收录新的标准动作", en: "Taking over the new standards" };
    case "calibration": return { zh: "按标准动作重建评分标准", en: "Rebuilding the scoring reference from the standards" };
    case "catalog": return { zh: "更新开放的动作", en: "Updating the open actions" };
    case "recognizer": return { zh: "重建自动识别模型", en: "Rebuilding action recognition" };
    default: return { zh: "启用新结果", en: "Switching to the new result" };
  }
}

/** Follows a FreeSki season run to its end; `own` runs report into the step and fail it when they fail. */
async function watch(ctx: Context, runId: string, limitMs: number, own: boolean): Promise<SeasonRun> {
  const deadline = Date.now() + limitMs;
  let seen: string[] = [], missed = 0;
  for (;;) {
    await ctx.deps.sleep(ctx.deps.pollMs, ctx.signal);
    let run: SeasonRun | null;
    try {
      run = await ctx.deps.freeski.run(runId, ctx.signal);
      missed = 0;
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      // FreeSki restarting loses nothing: its run is a record on disk.
      if (++missed * ctx.deps.pollMs > 10 * 60_000) throw new StepError("freeski-unavailable");
      continue;
    }
    if (!run) throw new StepError("freeski-run-lost");
    for (const line of newLines(seen, run.log)) ctx.log(`FreeSki: ${line}`);
    seen = run.log;
    if (own) {
      ctx.step.progress = run.progress;
      ctx.step.note = stageNote(run);
    }
    if (run.status === "done") return run;
    if (run.status === "failed") {
      if (own) throw new StepError(`${run.stage}:${run.error ?? "failed"}`);
      return run;
    }
    if (Date.now() > deadline) throw new StepError("timeout");
  }
}

async function follow(ctx: Context, stage: SeasonRun["stage"], limitMs: number): Promise<SeasonRun> {
  const ask = () => reach(ctx, () => ctx.deps.freeski.rebuild(stage, `${ctx.row.id}:${stage}`, ctx.signal));
  let started = await ask();
  if (!started) throw new StepError("freeski-unavailable");
  if (started.busy && started.stage !== stage) {
    // FreeSki does one season run at a time: let the other one end, then ask again.
    ctx.log(`FreeSki is busy with its ${started.stage} run; waiting for it`);
    await watch(ctx, started.runId, limitMs, false);
    started = await ask();
    if (!started || started.busy) throw new StepError("freeski-busy");
  } else if (started.busy) ctx.log("FreeSki is already doing this step; following that run");
  return watch(ctx, started.runId, limitMs, true);
}

async function script(ctx: Context, name: string, args: string[], limitMs: number, onLine: (line: string) => void) {
  let warned = false;
  const code = await ctx.deps.script(ctx.config, { script: name, args, limitMs, signal: ctx.signal, onLine: line => {
    // A numeric warning is two lines, the second the source line it points at; neither says anything about the result.
    const noise = /Warning[:\s]/.test(line) || (warned && /^\s/.test(line));
    warned = /Warning[:\s]/.test(line);
    if (noise) return;
    ctx.log(line);
    onLine(line.trim());
  } });
  if (code !== 0) throw new StepError(`${ctx.step.key}-failed`);
}

async function materials(ctx: Context): Promise<Outcome> {
  const found = await reach(ctx, () => ctx.deps.freeski.materials(ctx.signal));
  if (!found) return { skipped: true, note: { zh: "这里的 FreeSki 不提供雪季接口，跳过", en: "FreeSki offers no season API here; skipped" } };
  ctx.seasonApi = true;
  const gold = found.groups.reduce((sum, group) => sum + group.gold, 0);
  const waiting = found.groups.reduce((sum, group) => sum + Math.max(0, group.gold - group.extracted), 0);
  ctx.goldClips = gold || null;
  const groups = new Map(found.groups.map(group => [`${group.action}-l${group.level}`, group]));
  const without = ctx.list.actions.map(seasonMotionId).filter(id => !groups.get(id)?.gold);
  ctx.log(`material: ${found.guides.length} guide files, ${gold} reference demonstration videos, ${waiting} of them not analysed yet`);
  if (without.length) ctx.log(`material: no reference demonstration for ${without.join(", ")}; these are compared with the nearest level`);
  if (found.unknown.length) ctx.log(`material: folders FreeSki does not know, left out: ${found.unknown.slice(0, 20).join(", ")}`);
  return { note: {
    zh: `${found.guides.length} 份指南文件，${gold} 段标准示范视频${waiting ? `，其中 ${waiting} 段还没解析` : "，都已解析"}${without.length ? `；${without.length} 个动作没有本级示范，参考相邻级别` : ""}`,
    en: `${found.guides.length} guide files and ${gold} reference demonstration videos${waiting ? `, ${waiting} not analysed yet` : ", all analysed"}${without.length ? `; ${without.length} actions have no demonstration at their level and use the nearest` : ""}` } };
}

async function references(ctx: Context): Promise<Outcome> {
  if (!ctx.seasonApi) return { skipped: true, note: { zh: "跳过：沿用 FreeSki 已有的解析结果", en: "Skipped: FreeSki's existing analysis is used" } };
  // FreeSki only reads the movement out of new or changed demonstration videos here; scoring follows the new standards later.
  const run = await follow(ctx, "references", 8 * 3_600_000);
  const total = whole(run.detail.clipsTotal) ?? 0;
  return { note: total ? { zh: `提取了 ${total} 段新示范视频的动作`, en: `Movement read out of ${total} new demonstration video${total === 1 ? "" : "s"}` }
    : { zh: "没有新的示范视频，沿用已有的解析结果", en: "No new demonstration videos; the existing analysis stands" } };
}

async function sampling(ctx: Context): Promise<Outcome> {
  let clips = 0, groups = 0;
  await script(ctx, "extract_reference.py", ["--freeski", ctx.config.freeskiDir, "--out", path.join(ctx.stage, "gold_turns.json")], 3_600_000, line => {
    const done = /^groups (\d+)$/.exec(line);
    if (done) groups = Number(done[1]);
    // One line per demonstration video: its name and how many of its turns were used.
    else if (/\s\d+$/.test(line)) {
      clips++;
      ctx.step.progress = ctx.goldClips ? Math.min(.99, clips / ctx.goldClips) : null;
      ctx.step.note = { zh: `已采样 ${clips} 段示范视频`, en: `${clips} demonstration videos sampled` };
    }
  });
  if (!groups) throw new StepError("sampling-empty");
  return { note: { zh: `从 ${clips} 段示范视频里取出 ${groups} 组标准弯`, en: `${groups} groups of typical turns from ${clips} demonstration videos` } };
}

async function generation(ctx: Context): Promise<Outcome> {
  const ids = new Set(ctx.list.actions.map(seasonMotionId));
  let done = 0;
  await script(ctx, "generate.py", ["--season", path.join(ctx.stage, "season.json"), "--out", path.join(ctx.stage, "standard-motions"),
    "--reference", path.join(ctx.stage, "gold_turns.json"), "--docs", path.join(ctx.stage, "STANDARD_MOTIONS.md"),
    "--freeski", ctx.config.freeskiDir, "--workers", String(ctx.config.workers)], 4 * 3_600_000, line => {
    if (!ids.has(line.split(/\s+/, 1)[0])) return;
    done++;
    ctx.step.progress = Math.min(1, done / ids.size);
    ctx.step.note = { zh: `已生成 ${done}/${ids.size} 个动作`, en: `${done} of ${ids.size} generated` };
  });
  if (done < ids.size) throw new StepError("generation-incomplete");
  return { note: { zh: `${ids.size} 个动作的标准示范都生成了`, en: `All ${ids.size} standards generated` } };
}

/** The standard the site shows for this action now, when it has a readable one. */
async function standardInUse(file: string) {
  try {
    return decodeStandardMotion(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

async function checks(ctx: Context): Promise<Outcome> {
  const staged = path.join(ctx.stage, "standard-motions"), ids = ctx.list.actions.map(seasonMotionId);
  const problems: string[] = [], lower: string[] = [], scores: number[] = [];
  for (const entry of ctx.list.actions) {
    const id = seasonMotionId(entry);
    try {
      const motion = decodeStandardMotion(JSON.parse(await readFile(path.join(staged, `${id}.json`), "utf8")));
      const overall = motion.verification.overall;
      if (motion.id !== id || motion.level !== entry.level || motion.action !== entry.action) problems.push(`${id}: made for another action or level`);
      else if (motion.name.zh !== entry.zh || motion.name.en !== entry.en || motion.csia.source !== entry.guide) problems.push(`${id}: its name or guide page is not the list's`);
      else if (overall !== null && overall < MIN_OVERALL) problems.push(`${id}: scores ${overall} against its own demonstrations (at least ${MIN_OVERALL} is expected)`);
      if (overall !== null) scores.push(overall);
      // A season changes a standard a little. One that changed beyond belief was built from a wrong cut of the
      // demonstrations or from the wrong demonstrations, and is not published.
      const before = await standardInUse(path.join(ctx.config.root, "public", "standard-motions", `${id}.json`));
      const seconds = motion.motion.durationSec, ratio = before ? seconds / before.motion.durationSec : 1;
      if (before && (ratio < .5 || ratio > 2)) problems.push(`${id}: a turn takes ${seconds} s, against ${before.motion.durationSec} s in the standard in use`);
      else if (before && overall === null && before.verification.overall !== null) problems.push(`${id}: could not be scored, unlike the standard in use`);
      const earlier = before?.verification.overall ?? null;
      if (overall !== null && earlier !== null && overall < earlier - 5) lower.push(`${id} ${earlier}→${overall}`);
    } catch {
      problems.push(`${id}: missing or unreadable`);
    }
  }
  try {
    const index = JSON.parse(await readFile(path.join(staged, "index.json"), "utf8")) as { motions?: { id?: unknown }[] };
    if (JSON.stringify(index.motions?.map(motion => motion.id)) !== JSON.stringify(ids)) problems.push("index.json does not list the season's actions");
    const sampled = JSON.parse(await readFile(path.join(ctx.stage, "gold_turns.json"), "utf8")) as { groups?: Record<string, unknown> };
    if (!sampled.groups || Object.keys(sampled.groups).length === 0) problems.push("the sampled demonstrations are empty");
    if (!(await stat(path.join(ctx.stage, "STANDARD_MOTIONS.md"))).size) problems.push("the data sheet is empty");
  } catch {
    problems.push("the index, the sampled demonstrations or the data sheet is missing");
  }
  for (const problem of problems) ctx.log(`check: ${problem}`);
  if (problems.length) throw new StepError("checks-failed", { zh: `${problems.length} 处没通过，没有发布：${problems.slice(0, 3).join("；")}`,
    en: `${problems.length} problem${problems.length === 1 ? "" : "s"}, nothing published: ${problems.slice(0, 3).join("; ")}` });
  if (lower.length) ctx.log(`check: scoring lower than the standards in use by more than 5: ${lower.join(", ")}`);
  const average = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length * 10) / 10 : null;
  return { note: {
    zh: `${ids.length} 个动作都通过检查${average === null ? "" : `，评分核对平均 ${average} 分`}${lower.length ? `；比现在用的低 5 分以上：${lower.join("、")}` : ""}`,
    en: `All ${ids.length} actions pass${average === null ? "" : `, scoring ${average} on average`}${lower.length ? `; more than 5 below the ones in use: ${lower.join(", ")}` : ""}` } };
}

async function publish(ctx: Context): Promise<Outcome> {
  const { root } = ctx.config, ids = ctx.list.actions.map(seasonMotionId), staged = path.join(ctx.stage, "standard-motions"), seasons = seasonsDir(root);
  await writeFile(path.join(ctx.stage, "current.json"), `${JSON.stringify({ season: ctx.season.season, publishedAt: ctx.deps.now().toISOString(), run: ctx.row.id }, null, 2)}\n`, "utf8");
  const files: [from: string, target: string][] = [
    ...[...ids.map(id => `${id}.json`), "index.json"].map((name): [string, string] => [path.join(staged, name), path.join(root, "public", "standard-motions", name)]),
    [path.join(ctx.stage, "gold_turns.json"), path.join(ctx.config.scriptsDir, "reference", "gold_turns.json")],
    [path.join(ctx.stage, "STANDARD_MOTIONS.md"), path.join(root, "docs", "STANDARD_MOTIONS.md")],
    [path.join(ctx.stage, "season.json"), path.join(seasons, `${ctx.season.season}.json`)],
    // Last: the site turns to the new season only once everything it names is in place.
    [path.join(ctx.stage, "current.json"), path.join(seasons, "current.json")],
  ];
  const kept = path.join(ctx.stage, "replaced"), replaced: { target: string; copy: string | null }[] = [];
  await mkdir(kept, { recursive: true });
  try {
    for (const [index, [from, target]] of files.entries()) {
      const copy = existsSync(target) ? path.join(kept, `${index}-${path.basename(target)}`) : null;
      if (copy) await copyFile(target, copy);
      replaced.push({ target, copy });
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(from, `${target}.part`);
      await rename(`${target}.part`, target);
    }
  } catch {
    // Half a season is worse than the old one: put back what was replaced.
    for (const { target, copy } of replaced.reverse()) await (copy ? copyFile(copy, target) : rm(target, { force: true })).catch(() => undefined);
    throw new StepError("publish-failed");
  }
  ctx.log(`published ${ids.length} standards and the ${ctx.season.season} action list`);
  return { note: { zh: `${ids.length} 个标准动作和 ${ctx.season.season} 雪季的动作列表已换上`, en: `${ids.length} standards and the ${ctx.season.season} action list are on the site` } };
}

async function recognizer(ctx: Context): Promise<Outcome> {
  if (!ctx.seasonApi) return { skipped: true, note: { zh: "跳过：FreeSki 的评分和自动识别沿用现在的", en: "Skipped: FreeSki's scoring and recognition stay as they are" } };
  // FreeSki takes over the standards just published, rebuilds its scoring reference from them, opens the actions that
  // reference supports and rebuilds action recognition. Until it has, FreeSki still scores against the earlier standards.
  let run: SeasonRun | null = null, kept = false;
  try {
    run = await follow(ctx, "recognizer", 4 * 3_600_000);
  } catch (error) {
    // Not a failure: the standards and scoring are in use; FreeSki measured the new recognition model on real clips and kept the better one.
    if (!(error instanceof StepError && error.code === "recognizer:recognizer-worse")) throw error;
    kept = true;
  }
  const standards = whole(run?.detail.standards), open = whole(run?.detail.open), opened = names(run?.detail.opened), closed = names(run?.detail.closed);
  const zh = [`FreeSki 已${standards ? `收录 ${standards} 个标准动作并` : ""}按它们重建评分标准`, open !== null && `开放 ${open} 个动作级别`,
    opened.length > 0 && `新开放 ${opened.join("、")}`, closed.length > 0 && `关闭 ${closed.join("、")}`,
    kept ? "新的识别模型在真实视频上不如现在的，自动识别继续用现在的" : "自动识别已更新"].filter(Boolean).join("；");
  const en = [`FreeSki ${standards ? `took over ${standards} standards and ` : ""}rebuilt its scoring from them`, open !== null && `${open} action levels open`,
    opened.length > 0 && `newly open: ${opened.join(", ")}`, closed.length > 0 && `closed: ${closed.join(", ")}`,
    kept ? "the new recognition model did worse on real clips, so the one in use stays" : "action recognition updated"].filter(Boolean).join("; ");
  return { note: { zh, en } };
}

const STEPS: Record<UpdateStepKey, (ctx: Context) => Promise<Outcome>> = { materials, references, sampling, generation, checks, publish, recognizer };

async function prepareStage(root: string, id: string): Promise<string> {
  await mkdir(root, { recursive: true });
  // The last few runs stay for looking into (each holds what it replaced); older ones go.
  const others = await Promise.all((await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name !== id)
    .map(async entry => ({ name: entry.name, at: (await stat(path.join(root, entry.name))).mtimeMs })));
  await Promise.all(others.sort((a, b) => b.at - a.at).slice(KEPT_RUNS - 1).map(entry => rm(path.join(root, entry.name), { recursive: true, force: true })));
  const stage = path.join(root, id);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  return stage;
}

async function execute(row: RunRow, worker: AbortSignal, deps: RunnerDeps): Promise<void> {
  const steps = initialSteps(), lines: string[] = [], abort = new AbortController();
  const stopWithWorker = () => abort.abort();
  worker.addEventListener("abort", stopWithWorker, { once: true });
  if (worker.aborted) abort.abort();
  let cancelled = false, writing: Promise<void> = Promise.resolve(), tags: [string, string][] = [];
  // One write at a time, each carrying everything, so the page reads steps and log from the same moment.
  const save = () => (writing = writing.then(async () => {
    if (cancelled) return;
    if (!(await deps.store.save(row.id, { steps, log: lines.join("\n"), heartbeatAt: deps.now() }))) {
      cancelled = true;
      abort.abort();
    }
  }).catch(() => undefined));
  const log = (line: string) => {
    // The page shows this log: no credentials, and folders by what they are instead of where they are.
    let clean = line;
    for (const [folder, tag] of tags) for (const form of new Set([folder, folder.replaceAll("\\", "/"), folder.replaceAll("/", "\\")])) clean = clean.split(form).join(tag);
    clean = clean.replace(SECRET, "***").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trimEnd().slice(0, LINE_CHARS);
    if (!clean.trim()) return;
    lines.push(clean);
    if (lines.length > LOG_LINES) lines.splice(0, lines.length - LOG_LINES);
  };
  const beat = setInterval(() => void save(), deps.beatMs);
  let failure: string | null = null, afterPublish: string | null = null;
  try {
    const parsed = seasonListSchema.safeParse(row.list), config = deps.config();
    if (!parsed.success || listProblems(parsed.data).length > 0 || !/^[A-Za-z0-9_-]{1,64}$/.test(row.id)) failure = "invalid-list";
    else if (!config) failure = "not-configured";
    else {
      const season = toSeasonFile(parsed.data), stage = await prepareStage(deps.stagingRoot, row.id);
      tags = [[stage, "<staging>"], [config.freeskiDir, "<freeski>"], [config.root, "<site>"]];
      await writeFile(path.join(stage, "season.json"), formatSeasonFile(season), "utf8");
      const ctx: Context = { deps, row, list: parsed.data, season, config, stage, signal: abort.signal, step: steps[0], log, seasonApi: false, goldClips: null };
      for (const step of steps) {
        if (abort.signal.aborted) break;
        ctx.step = step;
        step.status = "running";
        step.startedAt = deps.now().toISOString();
        await save();
        // That write is also where a cancellation shows: a step is not started after it.
        if (abort.signal.aborted) {
          step.status = "pending";
          step.startedAt = null;
          break;
        }
        try {
          const outcome = await STEPS[step.key](ctx);
          step.status = outcome?.skipped ? "skipped" : "done";
          if (outcome?.note) step.note = outcome.note;
        } catch (error) {
          step.status = "failed";
          if (abort.signal.aborted) step.note = { zh: "已停止", en: "Stopped" };
          else {
            const code = error instanceof StepError ? error.code : "internal-error";
            if (error instanceof StepError && error.note) step.note = error.note;
            // The message may hold private paths: only its kind is kept.
            if (!(error instanceof StepError)) log(`unexpected ${error instanceof Error ? error.name : "error"} in ${step.key}`);
            if (isPublished(steps)) afterPublish = code;
            else failure = code;
          }
          break;
        } finally {
          step.progress = null;
          step.finishedAt = deps.now().toISOString();
        }
      }
    }
  } catch {
    failure ??= "internal-error";
  } finally {
    clearInterval(beat);
    worker.removeEventListener("abort", stopWithWorker);
  }
  await writing;
  const progress = { steps, log: lines.join("\n") }, live = isPublished(steps);
  // The worker stopping only matters to a run it cut short.
  const cutShort = worker.aborted && !failure && !afterPublish && steps.some(step => step.status === "pending" || step.status === "failed");
  // Published is done, whatever came after: the error then says what did not follow.
  if (cancelled) await deps.store.record(row.id, progress).catch(() => undefined);
  else if (cutShort) await deps.store.finish(row.id, { ...progress, status: live ? "SUCCEEDED" : "FAILED", error: "interrupted", finishedAt: deps.now() }).catch(() => undefined);
  else await deps.store.finish(row.id, { ...progress, status: failure ? "FAILED" : "SUCCEEDED", error: failure ?? afterPublish, finishedAt: deps.now() }).catch(() => undefined);
}

export function createActionUpdateRunner(deps: RunnerDeps) {
  let current: Promise<void> | null = null, nextLook = 0;
  return {
    /** Looks for a requested update without holding the caller up; one run at a time. */
    tick(signal: AbortSignal): void {
      if (current || signal.aborted || Date.now() < nextLook) return;
      nextLook = Date.now() + deps.lookMs;
      current = (async () => {
        const row = await deps.store.claim(deps.now());
        if (row) await execute(row, signal, deps);
      })().catch(() => undefined).finally(() => { current = null; });
    },
    /** Resolves once the run in hand has stopped; the worker's signal is what stops it. */
    async close(): Promise<void> {
      await current;
    },
  };
}

export const runnerDefaults = (store: RunnerStore, stagingRoot: string): RunnerDeps => ({
  store, stagingRoot, config: getPipelineConfig, freeski: freeSkiSeason, script: runPythonScript, now: () => new Date(),
  sleep: (ms, signal) => delay(ms, undefined, { signal }).then(() => undefined),
  beatMs: 5_000, pollMs: 5_000, lookMs: 5_000, wakeTries: 24,
});
