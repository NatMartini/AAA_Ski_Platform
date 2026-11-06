"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Clapperboard, Images, Info, MessageCircle } from "lucide-react";
import { coachingReportSchema, type CoachingReport } from "@/lib/freeski/report-v2";
import { CoachingWorkspace } from "./coaching-workspace";
import { AnalysisTeaching, DrillList, type FindingReview } from "./analysis-teaching";
import { AnalysisKeyframes } from "./analysis-keyframes";
import { AnalysisExplainer } from "./analysis-explainer";
import { AnalysisProgress } from "./analysis-progress";
import { AnalysisScorecard, ComparisonNotes, exampleName, MetricList, NO_OVERALL, QUALITY, referenceTarget, SCORECARD_NOTE,
  turnLabel as numberedTurn, type ReferenceTarget } from "./analysis-scorecard";
import { TurnComparisonPlayer, type TurnMeta } from "./turn-comparison-player";
import { ReportConclusion, reportFocus } from "./report-conclusion";
import { TurnStrip } from "./turn-strip";
import { FilmingTips } from "./filming-tips";
import { ThinkingLevelPicker } from "./thinking-level-picker";
import { DEFAULT_THINKING, THINKING_LEVELS, withoutOverallScore, type Scorecard, type ThinkingLevel } from "@/lib/freeski/scorecard";
import { standardMotionId } from "@/lib/freeski/standard-motion";
import { metricInsight, worstTurnFor } from "@/lib/freeski/metric-insight";
import type { FreeSkiCurrentLevel } from "@/lib/freeski/actions";
import { retryWhileStarting } from "@/lib/freeski/startup-retry";
import { clientFetch } from "@/lib/client-fetch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

async function json(url: string, signal?: AbortSignal, onStarting?: () => void) {
  const response = await retryWhileStarting(() => clientFetch(url, { cache: "no-store", signal }), { signal, onStarting });
  if (!response.ok) throw new Error("resource-unavailable");
  return response.json();
}

export type Reviews = { canReview: boolean; reviews: FindingReview[] };
type Review = (key: string, verdict: "AGREE" | "DISAGREE" | null, note: string, metricKeys: string[]) => Promise<void>;
type Written = NonNullable<CoachingReport["teaching"]>;
/** The reader's thinking level for the explanation, and the level of the one on screen. */
type Thinking = { value: ThinkingLevel; shown: ThinkingLevel | null; onChange: (level: ThinkingLevel) => void };

/**
 * Loads the FreeSki report and shows it once read. `card` is the scorecard the job settled on; `previous` a
 * comparable earlier one for "since last time".
 */
export function DynamicCoachingReport({ base, zh, card = null, currentLevel = null, previous = null, defaultOpen = false, reviewHref = null }: {
  base: string; zh: boolean; card?: Scorecard | null; currentLevel?: FreeSkiCurrentLevel | null; previous?: Scorecard | null; defaultOpen?: boolean;
  /** Where the page offers a human coach review of this clip. */
  reviewHref?: string | null;
}) {
  const [open, setOpen] = useState(defaultOpen), [report, setReport] = useState<CoachingReport | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // The idle FreeSki service stopped and is starting again; the report is asked for until it answers.
  const [starting, setStarting] = useState(false);
  const [reviews, setReviews] = useState<Reviews>({ canReview: false, reviews: [] });
  // The thinking level asked for, and the explanation on screen with its level: that one stays while
  // another level is being written. `chosen` is set once the depth is the reader's, not the default.
  const [thinking, setThinking] = useState<ThinkingLevel>(DEFAULT_THINKING);
  const [written, setWritten] = useState<{ teaching: Written; level: ThinkingLevel } | null>(null);
  const chosen = useRef(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; let polls = 0;
    const started = Date.now();
    const load = async () => {
      try {
        // Asking for a level starts writing it, so only a level other than the default is named.
        const query = thinking === DEFAULT_THINKING ? "" : `?thinking=${thinking}`;
        const value = coachingReportSchema.parse(await json(`${base}/report${query}`, controller.signal, () => setStarting(true)));
        if (controller.signal.aborted) return;
        setReport(value); setUnavailable(false); setStarting(false);
        if (value.teaching) setWritten({ teaching: value.teaching, level: thinking });
        // Opened afresh, show the deepest explanation already written; never start one unasked.
        const ready = value.teachingLevels?.filter(item => item.status === "ready").map(item => item.level) ?? [];
        const deepest = THINKING_LEVELS.filter(level => ready.includes(level)).pop();
        if (!chosen.current && deepest && THINKING_LEVELS.indexOf(deepest) > THINKING_LEVELS.indexOf(thinking)) {
          chosen.current = true; setThinking(deepest); return;
        }
        // The old observation text belongs to jobs without a scorecard; a scorecard job does not wait for it.
        const waiting = !value.scorecard && ["pending", "running", "retry_wait"].includes(value.modelStatus) ||
          value.teachingStatus === "pending" || value.teachingStatus === "running" ||
          value.explainerStatus === "pending" || value.explainerStatus === "running";
        // A deep explanation can queue behind others and think for fifteen minutes, twice if its first answer is rejected.
        if (waiting && Date.now() - started < 45 * 60_000) timer = setTimeout(() => void load(), polls++ < 24 ? 5000 : 10_000);
      } catch { if (!controller.signal.aborted) { setReport(null); setUnavailable(true); setStarting(false); } }
    };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [base, open, thinking]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    json(`${base}/finding-reviews`, controller.signal).then((value: Reviews) => { if (!controller.signal.aborted) setReviews(value); }).catch(() => {});
    return () => controller.abort();
  }, [base, open]);
  const review = useCallback(async (key: string, verdict: "AGREE" | "DISAGREE" | null, note: string, metricKeys: string[]) => {
    const response = await clientFetch(`${base}/finding-reviews`, { method: verdict ? "POST" : "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify(verdict ? { findingKey: key, verdict, note: note || undefined, metricKeys } : { findingKey: key }) });
    if (response.ok) setReviews(await response.json());
  }, [base]);
  const scorecardBlock = card && <AnalysisScorecard card={card} zh={zh} currentLevel={currentLevel} previous={previous} />;

  return <div className="space-y-5">
    {!open && <button type="button" className="text-sm font-semibold text-accent underline underline-offset-4" onClick={() => setOpen(true)}>
      {zh ? "FreeSki 自动评价与逐弯动态对比" : "FreeSki assessment and dynamic turn comparison"}</button>}
    {open && (unavailable ? <>
        <p className="text-sm text-ink-3">{zh ? "此报告暂未提供动态分析；已有技术评分和建议仍保留。" : "Dynamic analysis is not available for this report. Existing scores and advice remain available."}</p>
        {scorecardBlock}
      </> : !report ? <>
        <p role="status" className="text-sm text-ink-3">{starting ? (zh ? "分析服务正在启动，请稍候…" : "The analysis service is starting. Please wait…")
          : zh ? "正在读取分析…" : "Loading analysis…"}</p>
        {scorecardBlock}
      </> : <CoachingReportView base={base} zh={zh} report={report} card={card ?? report.scorecard} currentLevel={currentLevel} previous={previous}
        reviews={reviews} onReview={review} reviewHref={reviewHref} written={written?.teaching ?? null}
        thinking={{ value: thinking, shown: written?.level ?? null, onChange: level => { chosen.current = true; setThinking(level); } }} />)}
    <CoachingWorkspace base={base} zh={zh} />
  </div>;
}

function compared(target: ReferenceTarget, zh: boolean) {
  const [nameZh, nameEn] = exampleName(target);
  return zh ? `对比${nameZh.startsWith("CSIA") ? " " : ""}${nameZh}` : `Compared with ${nameEn}`;
}

function PanelButton({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-expanded={open} onClick={onClick}
    className={cn("press inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold [&_svg]:size-3.5",
      open ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-ink-2 hover:text-ink")}>{children}</button>;
}

/**
 * The read report in the order a coach would go through it: the conclusion, the turn to watch, how to practise,
 * the full explanation, then the measurements, what to film better and a coach's check. `written` is the
 * explanation on screen when the loader keeps one while another thinking level is written.
 */
export function CoachingReportView({ base, zh, report, card, currentLevel = null, previous = null, reviews, onReview, reviewHref = null,
  written, thinking = null }: {
  base: string; zh: boolean; report: CoachingReport; card: Scorecard | null; currentLevel?: FreeSkiCurrentLevel | null;
  previous?: Scorecard | null; reviews: Reviews; onReview?: Review; reviewHref?: string | null;
  written?: Written | null; thinking?: Thinking | null;
}) {
  const source = written === undefined ? report.teaching : written;
  // The overall score is withheld on the site, so prose quoting it is hidden too.
  const teaching = source ? withoutOverallScore(source, card?.overall.score ?? null) : null;
  // A deeper level being written is the picker's to report; with an explanation on screen nothing is pending.
  const teachingPending = !teaching && (report.teachingStatus === "pending" || report.teachingStatus === "running");
  const focus = reportFocus(teaching, card);
  const [picked, setPicked] = useState<string | null>(null);
  // Undefined until the viewer chooses, so the conclusion's metric stays highlighted as the report fills in.
  const [metricChoice, setMetricChoice] = useState<string | null | undefined>(undefined);
  const [panel, setPanel] = useState<"keyframes" | "explainer" | null>(null);
  const [about, setAbout] = useState(false);
  const focusMetric = metricChoice === undefined ? focus.metric : metricChoice;
  const hasTurn = (turnId: string | null): turnId is string => !!turnId && report.turns.some(turn => turn.turnId === turnId);
  const turnName = (turnId: string) => hasTurn(turnId) ? numberedTurn(turnId, zh) : null;
  const metaOf = (turnId: string): TurnMeta | undefined => {
    const turn = card?.turns.find(candidate => candidate.turn_id === turnId);
    return turn && { number: Number(turnId.slice(5)) + 1, direction: turn.direction, role: turn.role, score: turn.score,
      scored: turn.used_in_overall && turn.evidence?.status !== "insufficient" };
  };
  // Until a turn is picked, show the one the conclusion points at, else the first one that counts.
  const shown = hasTurn(picked) ? picked : hasTurn(focus.turnId) ? focus.turnId
    : report.turns.find(turn => metaOf(turn.turnId)?.scored ?? true)?.turnId ?? null;
  // Keyframes and the explainer draw the examples the scorecard compared; name them the same way.
  const target = card ? referenceTarget(card) : null;
  const ids = { summary: `report-summary-${base}`, player: `turn-player-${base}`, drills: `report-drills-${base}`, data: `report-data-${base}` };
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const show = (turnId: string | null, metric: string | null) => {
    if (hasTurn(turnId)) setPicked(turnId);
    setMetricChoice(metric);
    jump(ids.player);
  };
  const selectMetric = (key: string) => {
    if (focusMetric === key) { setMetricChoice(null); return; }
    show(card ? worstTurnFor(card, key) : null, key);
  };
  const player = report.turns.length > 0;
  const drills = teaching && teaching.drills.length > 0 ? teaching : null;
  const sections: [string, string][] = [];
  if (teaching || card) sections.push([ids.summary, zh ? "结论" : "Summary"]);
  if (player) sections.push([ids.player, zh ? "看问题" : "Watch"]);
  if (drills) sections.push([ids.drills, zh ? "怎么练" : "Practise"]);
  if (card) sections.push([ids.data, zh ? "数据" : "Data"]);
  const focused = focusMetric ? card?.metrics.find(metric => metric.key === focusMetric) : undefined;
  const insight = focused ? metricInsight(focused.key) : null;
  const togglePanel = (name: "keyframes" | "explainer") => setPanel(panel === name ? null : name);

  return <div className="space-y-5">
    <AnalysisProgress status="SUCCEEDED" teaching={teaching ? "ready" : report.teachingStatus} explainer={report.explainerStatus} zh={zh} compact />
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {target && <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">{compared(target, zh)}</span>}
        {card && <span className={cn("rounded-full border px-2.5 py-1 text-xs font-bold", QUALITY[card.quality][2])}>{QUALITY[card.quality][zh ? 0 : 1]}</span>}
        <button type="button" aria-expanded={about} onClick={() => setAbout(!about)}
          className="press inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-semibold text-ink-2 hover:text-ink">
          <Info className="size-3.5" aria-hidden />{zh ? "试验版 · 教练确认前仅供参考" : "Experimental · a guide until a coach confirms it"}</button>
      </div>
      {about && <div className="space-y-2 rounded-lg bg-surface p-3 text-xs leading-relaxed text-ink-3">
        <p>{NO_OVERALL[zh ? 0 : 1]}</p>
        {card && <ComparisonNotes card={card} zh={zh} currentLevel={currentLevel} />}
        <p>{SCORECARD_NOTE[zh ? 0 : 1]}</p>
      </div>}
    </div>
    {sections.length > 1 && <nav aria-label={zh ? "报告目录" : "Report sections"}
      className="scrollbar-none sticky top-16 z-30 -mx-3 flex gap-1.5 overflow-x-auto bg-surface-2/95 px-3 py-2 backdrop-blur">
      {sections.map(([id, label]) => <button type="button" key={id} onClick={() => jump(id)}
        className="press min-h-8 shrink-0 rounded-full border border-border bg-surface px-3 text-xs font-semibold text-ink-2 hover:text-ink">{label}</button>)}
    </nav>}
    {thinking && report.teachingLevels && card && <ThinkingLevelPicker value={thinking.value} shown={thinking.shown}
      levels={Object.fromEntries(report.teachingLevels.map(item => [item.level, item.status]))} zh={zh} onChange={thinking.onChange} />}
    {(teaching || card) && <section id={ids.summary} className="scroll-mt-28" aria-label={zh ? "这次的结论" : "Summary"}>
      <ReportConclusion teaching={teaching} card={card} previous={previous} zh={zh} focus={focus} teachingPending={teachingPending}
        onShow={player ? show : undefined} />
    </section>}
    {player && <section id={ids.player} className="scroll-mt-28 space-y-3" aria-label={zh ? "看问题：逐弯动态对比" : "Watch the turn: turn-by-turn comparison"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{zh ? "看问题" : "Watch the turn"}{shown ? ` · ${numberedTurn(shown, zh)}` : ""}</h3>
        <p className="text-xs text-ink-3">{zh ? "按 FreeSki 的分段，宽度按用时" : "As FreeSki split the run; widths follow each turn's duration"}</p>
      </div>
      <TurnStrip turns={report.turns} card={card} zh={zh} selected={shown} focus={focus.turnId} onSelect={setPicked} />
      {focused && <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold">{zh ? "高亮：" : "Highlighting: "}{zh ? focused.label_zh : focused.label_en}</span>
        {insight && <span>{zh ? insight.zh : insight.en}</span>}
        <button type="button" className="text-accent underline" onClick={() => setMetricChoice(null)}>{zh ? "取消高亮" : "Clear"}</button>
      </p>}
      {shown && <TurnComparisonPlayer key={`${base}:${shown}`} base={base} turnId={shown} zh={zh} meta={metaOf(shown)} focusMetric={focusMetric}
        motionId={card ? standardMotionId(card) : null} comparison={report.turns.find(turn => turn.turnId === shown)?.comparisonReference} />}
      <div className="flex flex-wrap gap-2">
        <PanelButton open={panel === "keyframes"} onClick={() => togglePanel("keyframes")}><Images aria-hidden />{zh ? "关键帧" : "Key frames"}</PanelButton>
        {report.explainerStatus && report.explainerStatus !== "unavailable" && <PanelButton open={panel === "explainer"} onClick={() => togglePanel("explainer")}>
          <Clapperboard aria-hidden />{zh ? "慢动作讲解" : "Slow-motion explainer"}</PanelButton>}
      </div>
      {panel === "keyframes" && shown && <AnalysisKeyframes key={`${base}:${shown}:keyframes`} base={base} turnId={shown} zh={zh} target={target} showEmpty />}
      {panel === "explainer" && <AnalysisExplainer base={base} zh={zh} target={target} compact />}
    </section>}
    {drills && <section id={ids.drills} className="scroll-mt-28 space-y-2" aria-label={zh ? "怎么练" : "How to practise"}>
      <h3 className="text-sm font-semibold">{zh ? "怎么练" : "How to practise"}</h3>
      <DrillList teaching={drills} zh={zh} turnLabel={turnName} onSelectTurn={player ? turnId => show(turnId, null) : undefined}
        reviews={reviews.reviews} canReview={reviews.canReview} onReview={onReview} />
    </section>}
    {teaching ? <details open={reviews.canReview || undefined} className="group rounded-xl border border-border bg-surface p-3">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold">
          {zh ? "完整讲解" : "Full explanation"}<ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <div className="mt-3"><AnalysisTeaching teaching={teaching} zh={zh} turnLabel={turnName} onSelectTurn={player ? turnId => show(turnId, null) : undefined}
          compact drills={false} reviews={reviews.reviews} canReview={reviews.canReview} onReview={onReview} /></div>
      </details>
      : !teachingPending && (card
        ? <p className="text-sm text-ink-3">{zh ? "这次的动作解释没有生成，评分和逐弯对比仍可查看。" : "The explanation was not generated this time; scores and turn playback remain available."}</p>
        : <ModelAssessment report={report} zh={zh} onSelectTurn={turnId => show(turnId, null)} />)}
    {card && <section id={ids.data} className="scroll-mt-28 space-y-3" aria-label={zh ? "详细数据" : "All measurements"}>
      <h3 className="text-sm font-semibold">{zh ? `详细数据 · ${card.metrics.length} 项` : `All measurements · ${card.metrics.length}`}</h3>
      <MetricList card={card} zh={zh} previous={previous} selectedMetric={focusMetric} onSelectMetric={player ? selectMetric : undefined} />
      {!player && <TurnStrip turns={card.turns.map(turn => ({ turnId: turn.turn_id, startMs: turn.start_ms, endMs: turn.end_ms }))} card={card} zh={zh} />}
    </section>}
    {card && <FilmingTips card={card} zh={zh} />}
    {reviewHref && !reviews.canReview && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3">
      <MessageCircle className="size-5 shrink-0 text-ink-3" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">{zh ? "这些建议由 FreeSki 自动生成，还没经教练确认。" : "FreeSki wrote these suggestions automatically; no coach has confirmed them yet."}</p>
      <Button asChild variant="secondary" size="sm"><a href={reviewHref}>{zh ? "请教练点评" : "Ask a coach to review"}</a></Button>
    </div>}
  </div>;
}

/** Reports from before FreeSki wrote cited teaching: the observations its model selected, or why there are none. */
function ModelAssessment({ report, zh, onSelectTurn }: { report: CoachingReport; zh: boolean; onSelectTurn: (turnId: string) => void }) {
  const model = report.modelAssessment;
  return <div className="space-y-3">
    <p className="text-xs text-ink-3">{zh ? "二维数据观察 · 尚无已核实的标准参照，技术判断需教练核实" : "Image-plane observations · no verified standard comparison; technique judgments need coach review"}</p>
    {model ? <div className="space-y-3">
      {model.model_provenance?.model && <p className="break-all text-xs text-ink-3">{zh ? "协助选取观察的模型：" : "Model assisting evidence selection: "}{model.model_provenance.model}</p>}
      <p className="text-sm leading-relaxed">{zh ? model.summary_zh : model.summary_en}</p>
      {model.dimensions.map(d => <p key={d.dimension} className="text-sm text-ink-2">{zh ? d.explanation_zh : d.explanation_en}</p>)}
      {model.findings.map(f => <div key={f.finding_id} className="rounded-lg bg-surface p-3 text-sm"><p>{zh ? f.observation_zh : f.observation_en}</p>
        {(zh ? f.hypothesis_zh : f.hypothesis_en) && <p className="mt-1 text-ink-3">{zh ? "可能原因：" : "Possible cause: "}{zh ? f.hypothesis_zh : f.hypothesis_en}</p>}
        <button type="button" className="mt-2 text-accent underline" onClick={() => onSelectTurn(f.turn_id)}>{zh ? "查看这个弯" : "View this turn"}</button></div>)}
      {model.exercises?.map(exercise => <div key={exercise.id} className="rounded-lg border border-border p-3 text-sm"><p className="font-semibold">{zh ? exercise.name_zh : exercise.name_en}</p><p className="mt-1 text-ink-2">{zh ? exercise.description_zh : exercise.description_en}</p></div>)}
      <ul className="space-y-1 text-xs text-ink-3">{model.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></div>
      : <p className="text-sm text-ink-3">{["pending", "running", "retry_wait"].includes(report.modelStatus)
        ? (zh ? "计算证据已保存，自动评价正在排队或生成；无需等待教练。" : "Evidence is saved; automated assessment is queued or generating. It does not wait for a coach.")
        : (zh ? "自动评价暂不可用，基础计算和可用动态片段仍可查看。" : "Automated assessment is unavailable; base calculations and available turns remain accessible.")}</p>}
  </div>;
}
