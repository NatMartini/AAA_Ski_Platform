"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Loader2, MinusCircle, Play, Plus, Square, Trash2, XCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { clientFetch } from "@/lib/client-fetch";
import { seasonMotionId } from "@/lib/freeski/csia-season";
import { KNOWN_ACTIONS, listProblems, seasonDates, seasonListSchema, toSeasonList, type ListProblem, type SeasonList } from "@/lib/season-update/season-list";
import type { ActionUpdateState, MaterialsState } from "@/lib/season-update/service";
import { isActive, isPublished, STEP_INFO, type RunSummary, type RunView, type UpdateStep } from "@/lib/season-update/steps";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { FieldError, Hint, Input, Label, Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const LEVELS = [1, 2, 3, 4] as const;

function when(iso: string | null | undefined, zh: boolean): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(date);
}

function took(step: UpdateStep, zh: boolean): string {
  const ms = step.startedAt && step.finishedAt ? Date.parse(step.finishedAt) - Date.parse(step.startedAt) : NaN;
  if (!Number.isFinite(ms) || ms < 1_000) return "";
  const minutes = Math.floor(ms / 60_000), seconds = Math.round(ms % 60_000 / 1_000);
  return zh ? `用时 ${minutes ? `${minutes} 分 ` : ""}${seconds} 秒` : `took ${minutes ? `${minutes} min ` : ""}${seconds} s`;
}

/** Why a run stopped, in words. Before a colon is the step's own reason; after it, the one FreeSki gave. */
export function updateErrorText(code: string, zh: boolean): string {
  const [head, detail = ""] = code.split(":");
  const t = (cn: string, en: string) => zh ? cn : en;
  const freeski: Record<string, string> = {
    "compute-unavailable": t("ModelCtrl 没有接下解析任务：它没在运行，或者没有登记雪季解析这项用途。", "ModelCtrl did not take the analysis job: it is not running, or the season use is not registered."),
    "poses-failed": t("示范视频的解析任务中途失败了。", "The job analysing the demonstration videos failed."),
    "poses-incomplete": t("有示范视频没解析出来。", "Some demonstration videos could not be analysed."),
    "calibration-failed": t("评分标准没有重建成功。", "The scoring reference could not be rebuilt."),
    "calibration-invalid": t("重建出来的评分标准不能用。", "The rebuilt scoring reference cannot be used."),
    "catalog-empty": t("按新的评分标准，没有任何动作可以开放。", "With the new scoring reference no action could be opened."),
    "standards-unavailable": t("FreeSki 读不到网站刚发布的标准动作。", "FreeSki cannot read the standards the site has just published."),
    "standards-invalid": t("FreeSki 认为刚发布的标准动作有问题，没有收录。", "FreeSki found a problem with the standards just published and did not take them over."),
    "simulation-unavailable": t("FreeSki 读不到本站的标准动作代码或采样结果。", "FreeSki cannot read this site's standard-motion code or samples."),
    "recognizer-failed": t("自动识别模型没有重建成功。", "Action recognition could not be rebuilt."),
    "recognizer-invalid": t("重建出来的自动识别模型不能用。", "The rebuilt recognition model cannot be used."),
    interrupted: t("FreeSki 在运行中重启了，这一步被打断。", "FreeSki restarted while this step was running."),
  };
  const said = freeski[detail] ?? t(`FreeSki 这一步出错了（${detail || "原因不明"}）。`, `FreeSki failed at this step (${detail || "no reason given"}).`);
  if (head === "references") return said;
  // After publishing: the site shows the new standards, FreeSki still scores against the earlier ones.
  if (head === "recognizer") return said + t("网站上的标准动作已经换了，但 FreeSki 还在按原来的标准打分。再点一次“更新动作”会重试。",
    " The site shows the new standards, but FreeSki still scores against the earlier ones. Running the update again retries.");
  const own: Record<string, string> = {
    "not-configured": t("这台服务器没有配置生成工具（SEASON_PIPELINE_PYTHON 和 SEASON_PIPELINE_FREESKI_DIR）。", "This server has no generator configured (SEASON_PIPELINE_PYTHON and SEASON_PIPELINE_FREESKI_DIR)."),
    "invalid-list": t("动作列表不合规，没有开始。", "The action list is not valid; nothing was started."),
    "freeski-unavailable": t("FreeSki 分析服务连不上。确认 ModelCtrl 在运行后再点一次。", "FreeSki could not be reached. Check that ModelCtrl is running and try again."),
    "freeski-mismatch": t("FreeSki 正在运行的版本和本站的雪季接口对不上，没有开始。让 FreeSki 重启到新版本后再点一次。", "The FreeSki that is running does not speak this site's season API; nothing was started. Restart FreeSki on its new version and try again."),
    "freeski-busy": t("FreeSki 正在跑另一个雪季更新，稍后再点一次。", "FreeSki is busy with another season update; try again later."),
    "freeski-run-lost": t("FreeSki 那边的任务记录不见了，请再点一次。", "FreeSki no longer knows the run; please start again."),
    timeout: t("这一步超时了。", "This step ran out of time."),
    interrupted: t("后台进程在运行中重启了，这次更新被打断，请再点一次。", "The background worker restarted during this update; please start it again."),
    "sampling-failed": t("采样示范弯没有成功，原因见运行记录。", "Sampling the demonstration turns failed; see the run log."),
    "sampling-empty": t("没有采到任何示范弯。", "No demonstration turns could be sampled."),
    "generation-failed": t("生成标准动作没有成功，原因见运行记录。", "Generating the standards failed; see the run log."),
    "generation-incomplete": t("有动作没生成出来，原因见运行记录。", "Some standards were not generated; see the run log."),
    "checks-failed": t("生成的结果没通过检查。", "The generated result did not pass the checks."),
    "publish-failed": t("换上新文件时出错，已经恢复原来的文件。", "Putting the new files in place failed; the previous files were restored."),
    "script-unavailable": t("生成工具启动不了，请检查 SEASON_PIPELINE_PYTHON 指向的 Python。", "The generator could not be started; check the Python that SEASON_PIPELINE_PYTHON names."),
  };
  return own[head] ?? t(`出错了（${code}）。`, `Something went wrong (${code}).`);
}

function runBadge(run: RunSummary, zh: boolean): { tone: BadgeTone; label: string } {
  const live = isPublished(run.steps);
  switch (run.status) {
    case "QUEUED": return { tone: "neutral", label: zh ? "等待开始" : "Waiting" };
    case "RUNNING": return { tone: "accent", label: zh ? "正在更新" : "Updating" };
    case "SUCCEEDED": return run.error ? { tone: "warning", label: zh ? "已发布，有一步没完成" : "Published, one step unfinished" }
      : { tone: "success", label: zh ? "已完成" : "Done" };
    case "CANCELLED": return { tone: live ? "warning" : "neutral", label: zh ? (live ? "已停止（新动作已发布）" : "已停止") : live ? "Stopped (already published)" : "Stopped" };
    default: return { tone: "danger", label: zh ? "没有完成" : "Not completed" };
  }
}

function problemText(problem: ListProblem, zh: boolean): string {
  switch (problem.code) {
    case "season": return zh ? "雪季要写成两个相连的年份，例如 2027-28。" : "Write the season as two consecutive years, e.g. 2027-28.";
    case "duplicate": return zh ? `${problem.id} 重复了。` : `${problem.id} is listed twice.`;
    case "not-generated": return zh ? `${problem.id} 网站还不会生成和评分，需要先开发。` : `${problem.id} cannot be generated and scored yet; it needs development first.`;
    default: return zh ? `${problem.level} 级有动作，但没有填这一级的考官指南。` : `Level ${problem.level} has actions but no candidate guide.`;
  }
}

function StepRow({ step, zh, over }: { step: UpdateStep; zh: boolean; over: boolean }) {
  const info = STEP_INFO[step.key];
  const Icon = step.status === "done" ? CheckCircle2 : step.status === "failed" ? XCircle : step.status === "skipped" ? MinusCircle : step.status === "running" ? Loader2 : Circle;
  const state = { pending: zh ? (over ? "没有执行" : "等待") : over ? "not run" : "waiting", running: zh ? "进行中" : "running", done: zh ? "完成" : "done",
    skipped: zh ? "跳过" : "skipped", failed: zh ? "没有完成" : "not completed" }[step.status];
  const text = step.note ? (zh ? step.note.zh : step.note.en) : step.status === "pending" && over ? state : zh ? info.gistZh : info.gistEn;
  const percent = step.progress === null ? null : Math.round(step.progress * 100);
  return <li className="flex gap-3">
    <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", step.status === "done" ? "text-success" : step.status === "failed" ? "text-danger"
      : step.status === "running" ? "animate-spin text-accent" : "text-ink-3")} />
    <div className="min-w-0 flex-1 space-y-1">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">{zh ? info.zh : info.en}
        <span className="sr-only">{state}</span>
        <span className="text-xs font-normal text-ink-3">{took(step, zh)}</span></p>
      <p className={cn("break-words text-sm", step.status === "failed" ? "text-danger" : "text-ink-2")}>{text}</p>
      {step.status === "running" && percent !== null && <div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
        aria-label={zh ? `${info.zh}进度` : `${info.en} progress`} className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} /></div>}
    </div>
  </li>;
}

function RunCard({ run, zh, waiting, busy, onCancel }: { run: RunView; zh: boolean; waiting: boolean; busy: boolean; onCancel: () => void }) {
  const badge = runBadge(run, zh), active = isActive(run.status);
  return <Card className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <CardTitle>{active ? (zh ? "这次更新" : "This update") : zh ? "最近一次更新" : "Latest update"}</CardTitle>
        <CardDescription>{[zh ? `${run.season} 雪季` : `${run.season} season`, zh ? `${run.actions} 个动作` : `${run.actions} actions`, when(run.createdAt, zh), run.requestedBy]
          .filter(Boolean).join(" · ")}</CardDescription>
      </div>
      <Badge tone={badge.tone} dot role="status">{badge.label}</Badge>
    </div>
    {waiting && <p className="text-sm text-amber">{zh ? "后台分析进程还没接手。网站要用 ski-launch 启动，它才会运行；启动后这里会自己开始。"
      : "The background worker has not picked this up. It runs when the site is started with ski-launch; this starts by itself once it is up."}</p>}
    <ol className="space-y-3">{run.steps.map(step => <StepRow key={step.key} step={step} zh={zh} over={!active} />)}</ol>
    {run.error && <p role="alert" className="text-sm font-medium text-danger">{updateErrorText(run.error, zh)}</p>}
    {run.status === "FAILED" && <p className="text-sm text-ink-2">{zh ? "网站上的标准动作和动作列表没有变。" : "The standards and the action list on the site are unchanged."}</p>}
    {active && <Button variant="secondary" size="sm" disabled={busy} onClick={onCancel}><Square aria-hidden />{zh ? "停止这次更新" : "Stop this update"}</Button>}
    {run.log.length > 0 && <details className="rounded-xl border border-border bg-surface-2/60">
      <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-semibold">{zh ? `运行记录（${run.log.length} 行）` : `Run log (${run.log.length} lines)`}</summary>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-border px-3 py-2 text-xs leading-relaxed text-ink-2">{run.log.join("\n")}</pre>
    </details>}
  </Card>;
}

function MaterialsCard({ materials, draft, zh }: { materials: MaterialsState | null; draft: SeasonList; zh: boolean }) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const title = <CardTitle>{t("FreeSki 里的材料", "Material in FreeSki")}</CardTitle>;
  if (!materials) return <Card className="space-y-2">{title}<CardDescription role="status">{t("正在读取指南和示范视频…", "Reading the guides and demonstration videos…")}</CardDescription></Card>;
  if (materials.state !== "ready") return <Card className="space-y-2">{title}<CardDescription>{materials.state === "unsupported"
    ? t("这里的 FreeSki 不提供雪季接口：更新时会跳过“解析示范视频”和“更新自动识别”两步，其余照常。", "FreeSki offers no season API here: an update skips analysing the demonstrations and updating recognition, and does the rest.")
    : materials.state === "mismatch" ? t("FreeSki 正在运行的版本和本站的雪季接口对不上，多半是它还没重启到新版本。请先让 FreeSki 重启，再点“更新动作”。", "The FreeSki that is running does not speak this site's season API, most likely because it has not been restarted on its new version. Restart FreeSki before updating.")
    : t("FreeSki 还没启动，材料暂时读不到。不影响更新：点“更新动作”时会自动叫醒它。", "FreeSki is not running yet, so its material cannot be read. An update still works: starting one wakes it.")}</CardDescription></Card>;
  const { data } = materials, groups = new Map(data.groups.map(group => [`${group.action}-l${group.level}`, group]));
  const gold = data.groups.reduce((sum, group) => sum + group.gold, 0), waiting = data.groups.reduce((sum, group) => sum + Math.max(0, group.gold - group.extracted), 0);
  const source = (item: { source: "season" | "shipped"; publishedAt: string | null } | null) => !item ? t("读不到", "unreadable")
    : item.source === "season" ? t(`上次更新时重建（${when(item.publishedAt, zh)}）`, `rebuilt by the last update (${when(item.publishedAt, zh)})`) : t("随程序发布的版本", "the version shipped with the code");
  return <Card className="space-y-4">
    <div className="space-y-1">{title}
      <CardDescription>{t(`${data.guides.length} 份指南文件，${gold} 段标准示范视频${waiting ? `，其中 ${waiting} 段还没解析（更新时会解析）` : ""}。新一季的指南和视频放进 FreeSki 的文件夹后，会显示在这里。`,
        `${data.guides.length} guide files and ${gold} reference demonstration videos${waiting ? `, ${waiting} not analysed yet (an update analyses them)` : ""}. A new season's guides and videos show here once they are in FreeSki's folders.`)}</CardDescription>
    </div>
    <ul className="divide-y divide-border rounded-xl border border-border">{draft.actions.map(entry => {
      const group = groups.get(seasonMotionId(entry));
      return <li key={seasonMotionId(entry)} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
        <span className="min-w-0 font-medium">{`L${entry.level} · ${zh ? entry.zh : entry.en}`}</span>
        <span className="flex flex-wrap gap-1.5">{group?.gold ? <>
          <Badge>{t(`示范 ${group.gold}`, `${group.gold} demo${group.gold === 1 ? "" : "s"}`)}</Badge>
          {group.extracted < group.gold && <Badge tone="warning">{t(`待解析 ${group.gold - group.extracted}`, `${group.gold - group.extracted} to analyse`)}</Badge>}
          <Badge tone={group.open ? "success" : "neutral"}>{group.open ? t("可以分析", "open") : t("未开放", "closed")}</Badge>
        </> : <Badge tone="warning">{t("没有本级示范", "no demonstration at this level")}</Badge>}</span>
      </li>;
    })}</ul>
    {data.unknown.length > 0 && <Hint>{t(`FreeSki 不认识这些文件夹，不会用到：${data.unknown.join("、")}`, `Folders FreeSki does not know and will not use: ${data.unknown.join(", ")}`)}</Hint>}
    {data.guides.length > 0 && <details className="rounded-xl border border-border">
      <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-semibold">{t(`指南文件（${data.guides.length}）`, `Guide files (${data.guides.length})`)}</summary>
      <ul className="space-y-1 border-t border-border px-3 py-2 text-xs text-ink-2">{data.guides.map(guide => <li key={guide.file} className="break-all">{guide.file}
        <span className="text-ink-3"> · {when(guide.modified, zh)}</span></li>)}</ul>
    </details>}
    <p className="text-xs leading-relaxed text-ink-3">{t(`FreeSki 打分用的标准动作：${data.standards ? `${data.standards.count} 个，${source(data.standards)}` : "读不到"}；评分标准：${source(data.calibration)}；自动识别：${source(data.recognizer)}。`,
      `Standards FreeSki scores against: ${data.standards ? `${data.standards.count}, ${source(data.standards)}` : "unreadable"}; scoring reference: ${source(data.calibration)}; action recognition: ${source(data.recognizer)}.`)}</p>
  </Card>;
}

function History({ runs, zh }: { runs: RunSummary[]; zh: boolean }) {
  if (runs.length === 0) return null;
  return <section className="space-y-3" aria-labelledby="action-update-history">
    <h2 id="action-update-history" className="text-lg font-extrabold">{zh ? "以前的更新" : "Earlier updates"}</h2>
    <ul className="space-y-2">{runs.map(run => {
      const badge = runBadge(run, zh);
      return <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
        <span className="min-w-0 break-words">{[zh ? `${run.season} 雪季` : `${run.season} season`, zh ? `${run.actions} 个动作` : `${run.actions} actions`, when(run.createdAt, zh), run.requestedBy].filter(Boolean).join(" · ")}</span>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </li>;
    })}</ul>
  </section>;
}

/** The season's action list and its "update the actions" button. A changed sign-in starts a fresh workspace without the previous drafts. */
export function ActionUpdatePanel({ zh, initial }: { zh: boolean; initial: ActionUpdateState }) {
  return <Workspace key={initial.coachId} zh={zh} initial={initial} />;
}

function Workspace({ zh, initial }: { zh: boolean; initial: ActionUpdateState }) {
  const router = useRouter();
  const t = (cn: string, en: string) => zh ? cn : en;
  const [state, setState] = useState(initial);
  const [draft, setDraft] = useState<SeasonList>(() => toSeasonList(initial.season));
  const [materials, setMaterials] = useState<MaterialsState | null>(null);
  const [problems, setProblems] = useState<ListProblem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);
  const coachId = initial.coachId, run = state.run, active = run ? isActive(run.status) : false, locked = active || busy;

  const load = useCallback(async (withMaterials: boolean, signal?: AbortSignal): Promise<ActionUpdateState | null> => {
    const response = await clientFetch(`/api/coach/actions${withMaterials ? "?materials=1" : ""}`, { cache: "no-store", signal });
    if (response.status === 401 || response.status === 403) {
      router.refresh();
      return null;
    }
    const body = response.ok ? await response.json().catch(() => null) as ActionUpdateState | null : null;
    if (signal?.aborted || !body?.ok) return null;
    if (body.coachId !== coachId) {
      router.refresh();
      return null;
    }
    setCheckedAt(Date.now());
    return body;
  }, [coachId, router]);

  // FreeSki may be asleep when the page opens: asking wakes it, so ask a few times before giving up.
  useEffect(() => {
    const controller = new AbortController();
    let tries = 0, timer = 0;
    const ask = async () => {
      const body = await load(true, controller.signal).catch(() => null);
      if (controller.signal.aborted) return;
      if (body) setState(body);
      if (body?.materials) setMaterials(body.materials);
      if ((!body || body.materials?.state === "unavailable") && ++tries < 6) timer = window.setTimeout(() => void ask(), 10_000);
    };
    timer = window.setTimeout(() => void ask(), 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [load]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => void load(false, controller.signal).then(body => { if (body && !controller.signal.aborted) setState(body); }).catch(() => undefined), 3_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [active, load]);

  const edit = (change: (list: SeasonList) => SeasonList) => {
    setDraft(change);
    setProblems([]);
    setError(null);
  };
  const listed = useMemo(() => new Set(draft.actions.map(seasonMotionId)), [draft.actions]);
  const dates = seasonDates(draft.season);
  const changes = useMemo(() => {
    const now = new Map(state.season.actions.map(entry => [seasonMotionId(entry), entry])), next = new Map(draft.actions.map(entry => [seasonMotionId(entry), entry]));
    const added = [...next.keys()].filter(id => !now.has(id)), removed = [...now.keys()].filter(id => !next.has(id));
    const renamed = [...next].filter(([id, entry]) => {
      const before = now.get(id);
      return before && (before.zh !== entry.zh || before.en !== entry.en || before.guide !== entry.guide);
    }).map(([id]) => id);
    const parts = [
      draft.season !== state.season.season ? t(`雪季 ${state.season.season} → ${draft.season}`, `season ${state.season.season} → ${draft.season}`) : "",
      added.length ? t(`新增 ${added.join("、")}`, `added ${added.join(", ")}`) : "",
      removed.length ? t(`去掉 ${removed.join("、")}`, `removed ${removed.join(", ")}`) : "",
      renamed.length ? t(`${renamed.length} 个动作改了名称或页码`, `${renamed.length} renamed or moved to another page`) : "",
      JSON.stringify(draft.guides) !== JSON.stringify(state.season.guides) ? t("指南有改动", "guides changed") : "",
    ].filter(Boolean);
    return parts.length ? t(`和网站现在的相比：${parts.join("；")}。`, `Compared with the site now: ${parts.join("; ")}.`)
      : t("列表和网站现在的一样：会按它重新全量跑一遍，适合只换了指南或示范视频的时候。", "The list is the same as the site's: it is run again in full, which suits a season where only the guides or videos changed.");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` only depends on `zh`
  }, [draft, state.season, zh]);

  function addAction(id: string) {
    const known = KNOWN_ACTIONS.find(action => action.id === id);
    if (!known) return;
    edit(list => {
      // An action that was on the site before comes back with its name and page; a new one starts from the general name.
      const before = state.season.actions.find(entry => seasonMotionId(entry) === id), guide = list.guides.find(item => item.level === known.level);
      const entry = before ? { ...before } : { level: known.level, action: known.action, zh: known.zh, en: known.en, guide: guide ? `${guide.edition} p.` : "" };
      const after = list.actions.reduce((last, item, index) => item.level <= known.level ? index : last, -1);
      return { ...list, actions: [...list.actions.slice(0, after + 1), entry, ...list.actions.slice(after + 1)] };
    });
  }

  async function start() {
    if (locked) return;
    const parsed = seasonListSchema.safeParse(draft);
    if (!parsed.success) {
      setError(t("有格子没填，或者名称里用了竖线、尖括号、反引号、反斜杠这些符号。", "A field is empty, or a name uses a vertical bar, angle bracket, backtick or backslash."));
      return;
    }
    const found = listProblems(parsed.data);
    if (found.length) {
      setProblems(found);
      return;
    }
    if (!window.confirm(t(`会重新解析示范视频、采样，并生成全部 ${parsed.data.actions.length} 个动作的标准示范，需要一段时间，期间网站照常使用。结果检查通过后才会换到网站上。现在开始吗？`,
      `This analyses the demonstration videos again, samples them and generates the standards of all ${parsed.data.actions.length} actions. It takes a while and the site stays usable. The result goes on the site only after it passes the checks. Start now?`))) return;
    setBusy(true);
    setError(null);
    try {
      const response = await clientFetch("/api/coach/actions", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedCoachId: coachId, list: parsed.data }) });
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: string; problems?: ListProblem[] } | null;
      if (response.status === 401 || response.status === 403 || body?.error === "session-changed") {
        setError(t("登录账号或权限变了，请刷新页面后再试。", "Your sign-in or permissions changed. Refresh the page and try again."));
        router.refresh();
        return;
      }
      if (body?.error === "validation" && Array.isArray(body.problems)) setProblems(body.problems);
      else if (!body?.ok) setError(body?.error === "update-running" ? t("已经有一次更新在进行，等它结束再点。", "An update is already under way; wait for it to end.")
        : body?.error === "not-configured" ? updateErrorText("not-configured", zh)
        : t("没有开始，请稍后再试。", "The update did not start. Please try again."));
      const fresh = await load(false);
      if (fresh) setState(fresh);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!run || busy || !window.confirm(t("停止这次更新？已经换到网站上的内容会保留。", "Stop this update? What is already on the site stays."))) return;
    setBusy(true);
    try {
      await clientFetch(`/api/coach/actions/${encodeURIComponent(run.id)}/cancel`, { method: "POST" });
      const fresh = await load(false);
      if (fresh) setState(fresh);
    } finally {
      setBusy(false);
    }
  }

  // A request nobody has taken for a while means the background worker is not running.
  const waiting = run?.status === "QUEUED" && checkedAt - Date.parse(run.createdAt) > 20_000;

  return <div className="space-y-6">
    <p className="text-sm text-ink-2">{t(`网站现在用的是 ${state.season.season} 雪季的 ${state.season.actions.length} 个动作。`, `The site is on the ${state.season.season} season with ${state.season.actions.length} actions.`)}</p>
    {run && active && <RunCard run={run} zh={zh} waiting={waiting} busy={busy} onCancel={() => void cancel()} />}
    <MaterialsCard materials={materials} draft={draft} zh={zh} />

    <Card className="space-y-4">
      <div className="space-y-1">
        <CardTitle>{t("雪季和考官指南", "Season and candidate guides")}</CardTitle>
        <CardDescription>{t("每个雪季一份列表。指南的文件名和版本只用来标明动作出自哪一版。", "One list per season. A guide's file name and edition only say which edition an action comes from.")}</CardDescription>
      </div>
      <div className="space-y-2 sm:max-w-xs">
        <Label htmlFor="season-name">{t("雪季", "Season")}</Label>
        <Input id="season-name" value={draft.season} disabled={locked} maxLength={7} placeholder="2027-28" autoComplete="off" aria-describedby="season-dates"
          onChange={event => edit(list => ({ ...list, season: event.target.value.trim() }))} />
        <p id="season-dates" className={cn("text-xs", dates ? "text-ink-3" : "text-danger")}>{dates ? t(`${dates.from} 至 ${dates.to}`, `${dates.from} to ${dates.to}`)
          : t("写成两个相连的年份，例如 2027-28", "Two consecutive years, e.g. 2027-28")}</p>
      </div>
      <div className="space-y-2">
        {draft.guides.map((guide, index) => <div key={index} className="grid gap-2 rounded-xl border border-border p-2.5 sm:grid-cols-[6.5rem_1fr_1fr_auto] sm:items-center">
          <Select aria-label={t("这份指南的级别", "This guide's level")} value={guide.level} disabled={locked}
            onChange={event => edit(list => ({ ...list, guides: list.guides.map((item, i) => i === index ? { ...item, level: Number(event.target.value) } : item) }))}>
            {LEVELS.map(level => <option key={level} value={level}>{t(`${level} 级`, `Level ${level}`)}</option>)}
          </Select>
          <Input aria-label={t("指南文件名", "Guide file name")} value={guide.file} maxLength={120} disabled={locked} placeholder="L2CG-EN.pdf"
            onChange={event => edit(list => ({ ...list, guides: list.guides.map((item, i) => i === index ? { ...item, file: event.target.value } : item) }))} />
          <Input aria-label={t("指南版本", "Guide edition")} value={guide.edition} maxLength={80} disabled={locked} placeholder="L2CG-EN-27"
            onChange={event => edit(list => ({ ...list, guides: list.guides.map((item, i) => i === index ? { ...item, edition: event.target.value } : item) }))} />
          <Button type="button" variant="ghost" size="icon" disabled={locked || draft.guides.length <= 1} aria-label={t(`去掉 ${guide.file || "这份指南"}`, `Remove ${guide.file || "this guide"}`)}
            onClick={() => edit(list => ({ ...list, guides: list.guides.filter((_, i) => i !== index) }))}><Trash2 aria-hidden /></Button>
        </div>)}
        <Button type="button" variant="secondary" size="sm" disabled={locked || draft.guides.length >= 12}
          onClick={() => edit(list => ({ ...list, guides: [...list.guides, { level: 1, file: "", edition: "" }] }))}><Plus aria-hidden />{t("加一份指南", "Add a guide")}</Button>
      </div>
    </Card>

    <Card className="space-y-5">
      <div className="space-y-1">
        <CardTitle>{t(`动作（${draft.actions.length} 个）`, `Actions (${draft.actions.length})`)}</CardTitle>
        <CardDescription>{t("每行依次是中文名、英文名、指南页码，会显示在标准动作库里。", "Each row is the Chinese name, the English name and the guide page, as the standards library shows them.")}</CardDescription>
      </div>
      {LEVELS.map(level => {
        const rows = draft.actions.map((entry, index) => ({ entry, index })).filter(row => row.entry.level === level);
        const addable = KNOWN_ACTIONS.filter(known => known.level === level && !listed.has(known.id));
        return <section key={level} aria-labelledby={`season-level-${level}`} className="space-y-2">
          <h3 id={`season-level-${level}`} className="text-sm font-bold">{t(`${level} 级`, `Level ${level}`)}<span className="ml-2 font-normal text-ink-3">{rows.length}</span></h3>
          {rows.length === 0 && <p className="text-sm text-ink-3">{t("这一级没有动作。", "No actions at this level.")}</p>}
          {rows.map(({ entry, index }) => {
            const change = (field: "zh" | "en" | "guide", value: string) => edit(list => ({ ...list, actions: list.actions.map((item, i) => i === index ? { ...item, [field]: value } : item) }));
            return <div key={seasonMotionId(entry)} className="grid gap-2 rounded-xl border border-border p-2.5 sm:grid-cols-[1fr_1fr_11rem_auto] sm:items-center">
              <Input aria-label={t(`${entry.action} 的中文名`, `Chinese name of ${entry.action}`)} value={entry.zh} maxLength={40} disabled={locked} onChange={event => change("zh", event.target.value)} />
              <Input aria-label={t(`${entry.action} 的英文名`, `English name of ${entry.action}`)} value={entry.en} maxLength={60} disabled={locked} onChange={event => change("en", event.target.value)} />
              <Input aria-label={t(`${entry.action} 的指南页码`, `Guide page of ${entry.action}`)} value={entry.guide} maxLength={80} disabled={locked} placeholder="L2CG-EN p.5"
                onChange={event => change("guide", event.target.value)} />
              <div className="flex items-center justify-between gap-2">
                <code className="break-all text-xs text-ink-3 sm:hidden">{entry.action}</code>
                <Button type="button" variant="ghost" size="icon" disabled={locked} aria-label={t(`去掉 ${level} 级的${entry.zh}`, `Remove ${entry.en} from level ${level}`)}
                  onClick={() => edit(list => ({ ...list, actions: list.actions.filter((_, i) => i !== index) }))}><Trash2 aria-hidden /></Button>
              </div>
            </div>;
          })}
          {addable.length > 0 && <Select aria-label={t(`给 ${level} 级加一个动作`, `Add an action to level ${level}`)} value="" disabled={locked} className="sm:max-w-xs"
            onChange={event => { if (event.target.value) addAction(event.target.value); }}>
            <option value="">{t("＋ 加一个动作…", "+ Add an action…")}</option>
            {addable.map(known => <option key={known.id} value={known.id}>{zh ? known.zh : known.en}</option>)}
          </Select>}
        </section>;
      })}
      <Hint>{t("这里只能加网站已经会生成和评分的动作。指南里出现全新的动作时，要先开发它的生成规则和评分，再加进来。",
        "Only actions the site can already generate and score can be added. A wholly new action needs its generation rules and scoring developed first.")}</Hint>
    </Card>

    <Card className="space-y-4">
      <div className="space-y-1">
        <CardTitle>{t("更新动作", "Update the actions")}</CardTitle>
        <CardDescription>{t("按上面的列表全量跑一遍：解析示范视频 → 采样示范弯 → 生成每个动作的标准示范 → 检查 → 换到网站上 → FreeSki 按新的标准动作更新评分和自动识别。检查不通过时，网站保持原样。",
          "Runs the whole list: analyse the demonstration videos → sample their turns → generate each action's standard → check → put on the site → FreeSki updates its scoring and action recognition from the new standards. If the checks fail, the site stays as it is.")}</CardDescription>
      </div>
      <p className="text-sm text-ink-2">{changes}</p>
      {problems.length > 0 && <ul role="alert" className="list-disc space-y-1 pl-5 text-sm font-medium text-danger">
        {problems.map((problem, index) => <li key={index}>{problemText(problem, zh)}</li>)}</ul>}
      <FieldError>{error}</FieldError>
      {!state.configured && <p className="text-sm text-amber">{updateErrorText("not-configured", zh)}</p>}
      <Button type="button" disabled={locked || !state.configured} onClick={() => void start()}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}{active ? t("正在更新…", "Updating…") : t("更新动作", "Update the actions")}</Button>
    </Card>

    {run && !active && <RunCard run={run} zh={zh} waiting={false} busy={busy} onCancel={() => undefined} />}
    <History runs={state.history} zh={zh} />
  </div>;
}
