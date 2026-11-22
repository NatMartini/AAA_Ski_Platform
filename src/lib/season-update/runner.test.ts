import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FreeSkiError } from "../freeski/adapter";
import { seasonMotionId } from "../freeski/csia-season";
import type { FreeSkiSeasonClient, SeasonMaterials, SeasonRun } from "./freeski-season";
import type { PipelineConfig } from "./pipeline-config";
import { createActionUpdateRunner, newLines, StepError, type RunnerDeps, type RunProgress, type ScriptJob } from "./runner";
import type { SeasonList } from "./season-list";
import { readCurrentSeason, seasonsDir } from "./season-store";

const list = (): SeasonList => ({ season: "2027-28",
  guides: [{ level: 2, file: "L2CG-EN.pdf", edition: "L2CG-27" }, { level: 3, file: "L3CG-EN.pdf", edition: "L3CG-27" }, { level: 4, file: "L4CG-EN.pdf", edition: "L4CG-27" }],
  actions: [{ level: 2, action: "demonstration_parallel", zh: "示范平行弯", en: "Demonstration parallel", guide: "L2CG-27 p.5" },
    { level: 3, action: "short_turn", zh: "小回转（三级）", en: "Short turns", guide: "L3CG-27 p.7" },
    { level: 4, action: "javelin", zh: "标枪转弯", en: "Javelin turns", guide: "L4CG-27 p.10" }] });
const IDS = ["demonstration_parallel-l2", "short_turn-l3", "javelin-l4"];

const sites: string[] = [];
afterEach(() => { for (const root of sites.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A site folder as the run finds it: last season's standard of one action and its sampled demonstrations are in place. */
function site() {
  const root = mkdtempSync(join(tmpdir(), "season-run-"));
  sites.push(root);
  for (const dir of ["public/standard-motions", "scripts/standard-motion/reference", "docs", "seasons/csia"]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "public/standard-motions/javelin-l4.json"), "old javelin");
  writeFileSync(join(root, "scripts/standard-motion/reference/gold_turns.json"), "old samples");
  return root;
}

const shippedMotion = (id: string) => JSON.parse(readFileSync(join(process.cwd(), "public", "standard-motions", `${id}.json`), "utf8"));

/** The two generator scripts, standing in for Python: they write what the real ones write, from the season file they are given. */
function generator(options: { overall?: Record<string, number | null>; seconds?: Record<string, number>; exit?: Record<string, number>; hold?: string } = {}) {
  const calls: ScriptJob[] = [];
  const script: RunnerDeps["script"] = async (_config, job) => {
    calls.push(job);
    const arg = (name: string) => job.args[job.args.indexOf(name) + 1];
    if (options.hold === job.script) await new Promise<never>((_, reject) => job.signal.addEventListener("abort", () => reject(new StepError("cancelled")), { once: true }));
    if (job.script === "extract_reference.py") {
      writeFileSync(arg("--out"), JSON.stringify({ phases: [0, 1], groups: { "short_turn|3|pass": {} } }));
      for (const line of ["clip-one 4", "clip-two 6", "RuntimeWarning: Mean of empty slice", "  return np.nanmean(values)", "groups 1"]) job.onLine(line);
    } else {
      const season = JSON.parse(readFileSync(arg("--season"), "utf8")) as { actions: SeasonList["actions"] };
      mkdirSync(arg("--out"), { recursive: true });
      job.onLine(`motions ${season.actions.length}`);
      const motions = season.actions.map(entry => {
        const id = seasonMotionId(entry), motion = shippedMotion(id);
        motion.name = { zh: entry.zh, en: entry.en };
        motion.csia.source = entry.guide;
        if (options.overall?.[id] !== undefined) motion.verification.overall = options.overall[id];
        if (options.seconds?.[id] !== undefined) motion.motion.durationSec = options.seconds[id];
        writeFileSync(join(arg("--out"), `${id}.json`), JSON.stringify(motion));
        job.onLine(`${id.padEnd(26)} overall ${motion.verification.overall} token=abc123 wrote ${arg("--out")}`);
        return { id };
      });
      writeFileSync(join(arg("--out"), "index.json"), JSON.stringify({ schema: "standard_motion_index.v1", motions }));
      writeFileSync(arg("--docs"), "# data sheet\n");
    }
    return options.exit?.[job.script] ?? 0;
  };
  return { script, calls };
}

const materials: SeasonMaterials = { schema_version: "freeski_season_materials.v1", guides: [{ file: "csia/official/L2CG-EN.pdf", bytes: 10, modified: "2027-09-01T00:00:00+00:00" }],
  groups: [{ level: 2, action: "demonstration_parallel", folder: "demonstration_parallel", clips: 5, gold: 2, extracted: 1, pass: 2, unscored: 0, open: true },
    { level: 3, action: "short_turn", folder: "short_turn", clips: 3, gold: 1, extracted: 1, pass: 1, unscored: 0, open: true }],
  unknown: ["level2/new_drill"], calibration: null, recognizer: null };
const RUNS = { references: "a".repeat(32), recognizer: "b".repeat(32) };

/** FreeSki's season API: each stage is one run that is over by the time it is first read. */
function freeSki(options: { api?: boolean; fail?: Partial<Record<SeasonRun["stage"], string>> } = {}) {
  const asked: string[] = [];
  const client: FreeSkiSeasonClient = {
    materials: async () => options.api === false ? null : materials,
    rebuild: async (stage, key) => {
      asked.push(`${stage} ${key}`);
      return { runId: RUNS[stage], stage, busy: false };
    },
    run: async runId => {
      const stage = runId === RUNS.references ? "references" : "recognizer", error = options.fail?.[stage] ?? null;
      return { runId, stage, status: error ? "failed" : "done", step: stage === "references" ? "reload" : "recognizer", progress: 1, error,
        detail: stage === "references" ? { clipsDone: 2, clipsTotal: 2 } : { standards: 3, open: 19, opened: ["hop_turn level4"], closed: [] },
        log: [`${stage}: line one`, `${stage}: line two`] };
    },
  };
  return { client, asked };
}

type Finished = RunProgress & { status: string; error: string | null };
function setup(options: { row?: { id: string; list: unknown }; generator?: Parameters<typeof generator>[0]; freeski?: Parameters<typeof freeSki>[0];
  client?: FreeSkiSeasonClient; unconfigured?: boolean; beatMs?: number } = {}) {
  const root = site(), row = options.row ?? { id: "run1", list: list() }, made = generator(options.generator), upstream = freeSki(options.freeski);
  const state = { status: "QUEUED", finished: null as Finished | null, recorded: null as RunProgress | null };
  const store: RunnerDeps["store"] = {
    claim: async () => state.status === "QUEUED" ? (state.status = "RUNNING", row) : null,
    save: async () => state.status === "RUNNING",
    finish: async (_id, result) => {
      if (state.status !== "RUNNING") return;
      state.finished = structuredClone(result);
      state.status = result.status;
    },
    record: async (_id, progress) => { state.recorded = structuredClone(progress); },
  };
  const config: PipelineConfig = { python: "python", freeskiDir: join(root, "freeski"), scriptsDir: join(root, "scripts", "standard-motion"), root, workers: 2 };
  const worker = new AbortController();
  const deps: RunnerDeps = { store, config: () => options.unconfigured ? null : config, freeski: options.client ?? upstream.client, script: made.script,
    stagingRoot: join(root, "staging"), now: () => new Date("2027-10-01T12:00:00Z"),
    sleep: async (_ms, signal) => { if (signal.aborted) throw new Error("aborted"); },
    beatMs: options.beatMs ?? 60_000, pollMs: 1, lookMs: 0, wakeTries: 3 };
  const run = async () => {
    const runner = createActionUpdateRunner(deps);
    runner.tick(worker.signal);
    await runner.close();
    return state;
  };
  const read = (file: string) => readFileSync(join(root, file), "utf8");
  return { root, state, run, worker, read, calls: made.calls, asked: upstream.asked };
}
const statuses = (progress: RunProgress) => Object.fromEntries(progress.steps.map(step => [step.key, step.status]));
const note = (progress: RunProgress, key: string) => progress.steps.find(step => step.key === key)?.note?.zh ?? "";
/** The site still shows what it showed before the run. */
function untouched(site: ReturnType<typeof setup>) {
  expect(site.read("public/standard-motions/javelin-l4.json")).toBe("old javelin");
  expect(site.read("scripts/standard-motion/reference/gold_turns.json")).toBe("old samples");
  expect(readdirSync(join(site.root, "public/standard-motions"))).toEqual(["javelin-l4.json"]);
  expect(existsSync(join(site.root, "seasons/csia/current.json"))).toBe(false);
}

describe("updating the season's actions", () => {
  it("analyses, samples, generates, checks, publishes and updates recognition, in that order", async () => {
    const made = setup();
    const state = await made.run();
    expect(state.finished).toMatchObject({ status: "SUCCEEDED", error: null });
    expect(statuses(state.finished!)).toEqual({ materials: "done", references: "done", sampling: "done", generation: "done", checks: "done", publish: "done", recognizer: "done" });
    expect(made.asked).toEqual(["references run1:references", "recognizer run1:recognizer"]);
    expect(made.calls.map(call => call.script)).toEqual(["extract_reference.py", "generate.py"]);
    expect(made.calls[1].args).toEqual(expect.arrayContaining(["--freeski", join(made.root, "freeski"), "--workers", "2"]));
    // The site now shows the list's actions under the list's names.
    expect(JSON.parse(made.read("public/standard-motions/short_turn-l3.json"))).toMatchObject({ name: { zh: "小回转（三级）" }, csia: { source: "L3CG-27 p.7" } });
    expect(JSON.parse(made.read("public/standard-motions/index.json")).motions.map((motion: { id: string }) => motion.id)).toEqual(IDS);
    expect(made.read("scripts/standard-motion/reference/gold_turns.json")).toContain("short_turn|3|pass");
    expect(made.read("docs/STANDARD_MOTIONS.md")).toBe("# data sheet\n");
    expect(readCurrentSeason(seasonsDir(made.root))).toEqual({ season: "2027-28", from: "2027-06-01", to: "2028-05-31", guides: list().guides, actions: list().actions });
    // What was replaced is kept with the run.
    const kept = readdirSync(join(made.root, "staging/run1/replaced"));
    expect(readFileSync(join(made.root, "staging/run1/replaced", kept.find(name => name.endsWith("javelin-l4.json"))!), "utf8")).toBe("old javelin");
    expect(note(state.finished!, "materials")).toBe("1 份指南文件，3 段标准示范视频，其中 1 段还没解析；1 个动作没有本级示范，参考相邻级别");
    expect(note(state.finished!, "references")).toBe("提取了 2 段新示范视频的动作");
    // FreeSki rebuilds its scoring from the standards only after the site has published them.
    expect(note(state.finished!, "recognizer")).toBe("FreeSki 已收录 3 个标准动作并按它们重建评分标准；开放 19 个动作级别；新开放 hop_turn level4；自动识别已更新");
    expect(note(state.finished!, "sampling")).toBe("从 2 段示范视频里取出 1 组标准弯");
    expect(note(state.finished!, "generation")).toBe("3 个动作的标准示范都生成了");
    expect(note(state.finished!, "checks")).toContain("3 个动作都通过检查");
    // The log is shown on the page: no credentials, no folders, no numeric-warning noise.
    const log = state.finished!.log;
    expect(log).toContain("FreeSki: references: line one");
    expect(log).toContain("<staging>");
    for (const hidden of ["abc123", made.root, "RuntimeWarning", "np.nanmean"]) expect(log).not.toContain(hidden);
  });

  it("does the rest where FreeSki offers no season API", async () => {
    const made = setup({ freeski: { api: false } });
    const state = await made.run();
    expect(state.finished).toMatchObject({ status: "SUCCEEDED", error: null });
    expect(statuses(state.finished!)).toMatchObject({ materials: "skipped", references: "skipped", generation: "done", publish: "done", recognizer: "skipped" });
    expect(made.asked).toEqual([]);
    expect(readCurrentSeason(seasonsDir(made.root)).season).toBe("2027-28");
  });

  it("leaves the site as it was when generation fails", async () => {
    const made = setup({ generator: { exit: { "generate.py": 1 } } });
    const state = await made.run();
    expect(state.finished).toMatchObject({ status: "FAILED", error: "generation-failed" });
    expect(statuses(state.finished!)).toMatchObject({ sampling: "done", generation: "failed", checks: "pending", publish: "pending" });
    untouched(made);
  });

  it("does not publish a standard that scores unlike its demonstrations", async () => {
    const made = setup({ generator: { overall: { "short_turn-l3": 55 } } });
    const state = await made.run();
    expect(state.finished).toMatchObject({ status: "FAILED", error: "checks-failed" });
    expect(note(state.finished!, "checks")).toContain("short_turn-l3: scores 55");
    untouched(made);
  });

  it("does not publish a standard that changed beyond belief from the one in use", async () => {
    const inUse = shippedMotion("short_turn-l3");
    for (const generated of [{ seconds: { "short_turn-l3": inUse.motion.durationSec * .3 } }, { overall: { "short_turn-l3": null } }]) {
      const made = setup({ generator: generated });
      writeFileSync(join(made.root, "public/standard-motions/short_turn-l3.json"), JSON.stringify(inUse));
      const state = await made.run();
      expect(state.finished).toMatchObject({ status: "FAILED", error: "checks-failed" });
      expect(note(state.finished!, "checks")).toMatch(generated.seconds ? /short_turn-l3: a turn takes [0-9.]+ s, against/ : /short_turn-l3: could not be scored/);
      expect(JSON.parse(made.read("public/standard-motions/short_turn-l3.json"))).toEqual(inUse);
      expect(existsSync(join(made.root, "seasons/csia/current.json"))).toBe(false);
    }
  });

  it("stops within a heartbeat when the admin cancels, and records where it was", async () => {
    const made = setup({ generator: { hold: "generate.py" }, beatMs: 5 });
    const done = made.run();
    await vi.waitFor(() => expect(made.calls.map(call => call.script)).toContain("generate.py"));
    made.state.status = "CANCELLED";
    const state = await done;
    expect(state.finished).toBeNull();
    expect(statuses(state.recorded!)).toMatchObject({ sampling: "done", generation: "failed", checks: "pending" });
    expect(note(state.recorded!, "generation")).toBe("已停止");
    untouched(made);
  });

  it("says it was interrupted when the worker stops", async () => {
    const made = setup({ generator: { hold: "extract_reference.py" } });
    const done = made.run();
    await vi.waitFor(() => expect(made.calls).toHaveLength(1));
    made.worker.abort();
    expect((await done).finished).toMatchObject({ status: "FAILED", error: "interrupted" });
    untouched(made);
  });

  it("fails with FreeSki's reason when the demonstrations cannot be analysed, before anything is generated", async () => {
    const made = setup({ freeski: { fail: { references: "compute-unavailable" } } });
    const state = await made.run();
    expect(state.finished).toMatchObject({ status: "FAILED", error: "references:compute-unavailable" });
    expect(made.calls).toEqual([]);
    untouched(made);
  });

  it("counts a published season as done even when recognition did not follow", async () => {
    const worse = await setup({ freeski: { fail: { recognizer: "recognizer-worse" } } }).run();
    // FreeSki kept the better recognition model; the standards and scoring are in use: nothing went wrong.
    expect(worse.finished).toMatchObject({ status: "SUCCEEDED", error: null });
    expect(statuses(worse.finished!)).toMatchObject({ publish: "done", recognizer: "done" });
    expect(note(worse.finished!, "recognizer")).toContain("自动识别继续用现在的");
    const made = setup({ freeski: { fail: { recognizer: "recognizer-failed" } } });
    const failed = await made.run();
    expect(failed.finished).toMatchObject({ status: "SUCCEEDED", error: "recognizer:recognizer-failed" });
    expect(statuses(failed.finished!)).toMatchObject({ publish: "done", recognizer: "failed" });
    expect(readCurrentSeason(seasonsDir(made.root)).season).toBe("2027-28");
  });

  it("puts back what it replaced when publishing breaks half way", async () => {
    const made = setup();
    rmSync(join(made.root, "docs"), { recursive: true });
    writeFileSync(join(made.root, "docs"), "not a folder");
    const state = await made.run();
    expect(state.finished).toMatchObject({ status: "FAILED", error: "publish-failed" });
    expect(statuses(state.finished!)).toMatchObject({ checks: "done", publish: "failed", recognizer: "pending" });
    untouched(made);
  });

  it("refuses a list it cannot run and a server without the generator", async () => {
    const unknown = { ...list(), actions: [{ level: 4, action: "moguls_zipper", zh: "拉链线", en: "Zipper line", guide: "x p.1" }] };
    for (const row of [{ id: "run1", list: unknown }, { id: "run1", list: "nonsense" }, { id: "../run", list: list() }]) {
      const made = setup({ row });
      expect((await made.run()).finished).toMatchObject({ status: "FAILED", error: "invalid-list" });
      expect(made.calls).toEqual([]);
    }
    expect((await setup({ unconfigured: true }).run()).finished).toMatchObject({ status: "FAILED", error: "not-configured" });
  });

  it("waits for FreeSki to be started, and gives up when it stays away", async () => {
    const waking = (failures: number): FreeSkiSeasonClient => {
      let left = failures;
      return { ...freeSki().client, materials: async () => {
        if (left-- > 0) throw new FreeSkiError("analysis-unavailable");
        return materials;
      } };
    };
    expect((await setup({ client: waking(2) }).run()).finished).toMatchObject({ status: "SUCCEEDED" });
    const away = setup({ client: waking(99) });
    expect((await away.run()).finished).toMatchObject({ status: "FAILED", error: "freeski-unavailable" });
    untouched(away);
    // A FreeSki on another version of the season API answers, but not readably: nothing is started on it.
    const other = setup({ client: { ...freeSki().client, materials: async () => { throw new FreeSkiError("analysis-invalid-response"); } } });
    expect((await other.run()).finished).toMatchObject({ status: "FAILED", error: "freeski-mismatch" });
    expect(other.calls).toEqual([]);
    untouched(other);
  });

  it("lets FreeSki finish another season run before starting its own", async () => {
    const base = freeSki().client, other = "c".repeat(32);
    let asks = 0;
    const client: FreeSkiSeasonClient = { ...base,
      rebuild: async (stage, key) => stage === "references" && asks++ === 0 ? { runId: other, stage: "recognizer", busy: true } : base.rebuild(stage, key),
      run: async runId => runId === other ? { runId, stage: "recognizer", status: "done", step: "reload", progress: 1, error: null, detail: {}, log: [] } : base.run(runId) };
    const state = await setup({ client }).run();
    expect(state.finished).toMatchObject({ status: "SUCCEEDED", error: null });
    expect(state.finished!.log).toContain("FreeSki is busy with its recognizer run");
  });
});

describe("reading the tail of FreeSki's log", () => {
  it("takes only the lines not seen before", () => {
    expect(newLines([], ["a", "b"])).toEqual(["a", "b"]);
    expect(newLines(["a", "b"], ["a", "b", "c"])).toEqual(["c"]);
    // The window moved on: b and c were seen, d is new.
    expect(newLines(["a", "b", "c"], ["b", "c", "d"])).toEqual(["d"]);
    expect(newLines(["a", "b"], ["a", "b"])).toEqual([]);
    expect(newLines(["a"], ["x", "y"])).toEqual(["x", "y"]);
  });
});
