"use client";

import { useCallback, useEffect, useState } from "react";
import { CornerUpLeft, CornerUpRight, Play, Target } from "lucide-react";
import { coachingReportSchema, type CoachingReport } from "@/lib/freeski/report-v2";
import { CoachingWorkspace } from "./coaching-workspace";
import { AnalysisTeaching, type FindingReview } from "./analysis-teaching";
import { AnalysisKeyframes } from "./analysis-keyframes";
import { AnalysisExplainer } from "./analysis-explainer";
import { AnalysisProgress } from "./analysis-progress";
import { AnalysisScorecard, referenceTarget, turnLabel as numberedTurn } from "./analysis-scorecard";
import { TurnComparisonPlayer, type TurnMeta } from "./turn-comparison-player";
import { withoutOverallScore, type Scorecard, type Teaching } from "@/lib/freeski/scorecard";
import { metricDelta, metricInsight, worstTurnFor } from "@/lib/freeski/metric-insight";
import type { FreeSkiCurrentLevel } from "@/lib/freeski/actions";
import { clientFetch } from "@/lib/client-fetch";
import { cn } from "@/lib/utils";

async function json(url: string, signal?: AbortSignal) {
  const response = await clientFetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("resource-unavailable");
  return response.json();
}

type Reviews = { canReview: boolean; reviews: FindingReview[] };

/** The one thing to work on: the primary improvement, its CSIA criterion and the turn that shows it. */
function Headline({ teaching, card, previous, zh, onShow }: { teaching: Teaching; card: Scorecard | null; previous: Scorecard | null; zh: boolean;
  onShow: (turnId: string | null, metric: string | null) => void }) {
  const primary = teaching.improvements.find(item => item.priority === "primary") ?? teaching.improvements[0];
  if (!primary) return null;
  const text = zh ? primary.text_zh : primary.text_en;
  // FreeSki writes the criterion in a fixed phrase; show it as its own line when present.
  const split = text.split(/(对应 CSIA 要求：|CSIA criterion: )/);
  const lead = split[0].trim(), criterion = split.length >= 3 ? split.slice(1).join("").trim() : null;
  const facts = primary.fact_ids.map(id => teaching.facts.find(fact => fact.fact_id === id)).filter(Boolean);
  const metric = facts[0]?.metric_key ?? null;
  const turn = primary.turn_ids[0] ?? facts.find(fact => fact!.turn_id)?.turn_id ?? (card && metric ? worstTurnFor(card, metric) : null);
  const delta = card && metric ? metricDelta(card, previous, metric) : null;
  const strengths = teaching.strengths.length;
  return <section className="space-y-3 rounded-2xl border border-accent/30 bg-accent-soft/60 p-4 sm:p-5" aria-label={zh ? "本次重点" : "Key point"}>
    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent"><Target className="size-4" aria-hidden />{zh ? "本次重点" : "Key point"}</p>
    <p className="text-base font-semibold leading-relaxed">{lead}</p>
    {criterion && <p className="text-sm text-ink-2">{criterion}</p>}
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
      {delta !== null && delta !== 0 && <span className={cn("rounded-full px-2 py-0.5 font-semibold", delta > 0 ? "bg-success-bg text-success" : "bg-danger-bg text-danger")}>
        {zh ? `这项比上次${delta > 0 ? "进步" : "退步"} ${Math.abs(delta)} 分` : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} since last time`}</span>}
      {strengths > 0 && <span>{zh ? `另有 ${strengths} 处做得好的地方，见下方。` : `${strengths} thing${strengths === 1 ? "" : "s"} going well, below.`}</span>}
    </div>
    {(turn || metric) && <button type="button" onClick={() => onShow(turn, metric)}
      className="press inline-flex min-h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground">
      <Play className="size-4" aria-hidden />{turn ? (zh ? `看${numberedTurn(turn, zh)}，高亮这个问题` : `Watch ${numberedTurn(turn, zh).toLowerCase()} with this highlighted`) : (zh ? "在播放器里高亮这个问题" : "Highlight this in the player")}</button>}
  </section>;
}

/**
 * The full FreeSki report in reading order: the key point, the explanation, the turn player, then
 * the scorecard with clickable metrics. `card` is the scorecard the job settled on; `previous` a
 * comparable earlier one for "since last time".
 */
export function DynamicCoachingReport({ base, zh, card = null, currentLevel = null, previous = null, defaultOpen = false }: {
  base: string; zh: boolean; card?: Scorecard | null; currentLevel?: FreeSkiCurrentLevel | null; previous?: Scorecard | null; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen), [report, setReport] = useState<CoachingReport | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [unavailable, setUnavailable] = useState(false);
  const [focusMetric, setFocusMetric] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Reviews>({ canReview: false, reviews: [] });
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; let attempts = 0;
    const load = async () => {
      try {
        const value = coachingReportSchema.parse(await json(`${base}/report`, controller.signal));
        if (controller.signal.aborted) return;
        setReport(value); setUnavailable(false);
        const waiting = ["pending", "running", "retry_wait"].includes(value.modelStatus) ||
          value.teachingStatus === "pending" || value.teachingStatus === "running" ||
          value.explainerStatus === "pending" || value.explainerStatus === "running";
        if (waiting && attempts++ < 120) timer = setTimeout(() => void load(), 5000);
      } catch { if (!controller.signal.aborted) { setReport(null); setSelected(null); setUnavailable(true); } }
    };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [base, open]);
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

  const model = report?.modelAssessment;
  const scorecard = card ?? report?.scorecard ?? null;
  // The overall score is withheld on the site, so prose quoting it is hidden too.
  const teaching = report?.teaching ? withoutOverallScore(report.teaching, scorecard?.overall.score ?? null) : null;
  const turnLabel = (turnId: string) => report?.turns.some(turn => turn.turnId === turnId) ? numberedTurn(turnId, zh) : null;
  const metaOf = (turnId: string): TurnMeta | undefined => {
    const turn = scorecard?.turns.find(candidate => candidate.turn_id === turnId);
    return turn && { number: Number(turnId.slice(5)) + 1, direction: turn.direction, role: turn.role, score: turn.score,
      scored: turn.used_in_overall && turn.evidence?.status !== "insufficient" };
  };
  // Until a turn is picked, show the first one that counts, so the comparison is visible without hunting for it.
  const shown = selected ?? report?.turns.find(turn => metaOf(turn.turnId)?.scored ?? true)?.turnId ?? null;
  // Keyframes and the explainer draw the examples the scorecard compared; name them the same way.
  const target = scorecard ? referenceTarget(scorecard) : null;
  const show = (turnId: string | null, metric: string | null) => {
    if (turnId && report?.turns.some(turn => turn.turnId === turnId)) setSelected(turnId);
    setFocusMetric(metric);
    document.getElementById(`turn-player-${base}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const selectMetric = (key: string) => {
    if (focusMetric === key) { setFocusMetric(null); return; }
    const worst = scorecard ? worstTurnFor(scorecard, key) : null;
    show(worst, key);
  };
  const scorecardBlock = scorecard && <AnalysisScorecard card={scorecard} zh={zh} currentLevel={currentLevel} previous={previous}
    selectedMetric={focusMetric} onSelectMetric={report && report.turns.length > 0 ? selectMetric : undefined} />;

  return <div className="space-y-5">
    {!open && <button type="button" className="text-sm font-semibold text-accent underline underline-offset-4" onClick={() => setOpen(true)}>
      {zh ? "FreeSki 自动评价与逐弯动态对比" : "FreeSki assessment and dynamic turn comparison"}</button>}
    {open && (unavailable ? <>
        <p className="text-sm text-ink-3">{zh ? "此报告暂未提供动态分析；已有技术评分和建议仍保留。" : "Dynamic analysis is not available for this report. Existing scores and advice remain available."}</p>
        {scorecardBlock}
      </> : !report ? <>
        <p className="text-sm text-ink-3">{zh ? "正在读取分析…" : "Loading analysis…"}</p>
        {scorecardBlock}
      </> : <>
        <AnalysisProgress status="SUCCEEDED" teaching={report.teachingStatus} explainer={report.explainerStatus} zh={zh} compact />
        {teaching && <Headline teaching={teaching} card={scorecard} previous={previous} zh={zh} onShow={show} />}
        {teaching ? <AnalysisTeaching teaching={teaching} zh={zh} turnLabel={turnLabel} onSelectTurn={turnId => show(turnId, null)}
            reviews={reviews.reviews} canReview={reviews.canReview} onReview={review} />
          : report.teachingStatus === "pending" || report.teachingStatus === "running"
            ? <p className="text-sm text-ink-3">{zh ? "动作解释生成中，评分和动态对比已经可以查看。" : "The explanation is being written; scores and turn playback are already available."}</p>
          : <><p className="text-xs text-ink-3">{zh ? "二维数据观察 · 尚无已核实的标准参照，技术判断需教练核实" : "Image-plane observations · no verified standard comparison; technique judgments need coach review"}</p>
          {model ? <div className="space-y-3">
            {model.model_provenance?.model && <p className="break-all text-xs text-ink-3">{zh ? "协助选取观察的模型：" : "Model assisting evidence selection: "}{model.model_provenance.model}</p>}
            <p className="text-sm leading-relaxed">{zh ? model.summary_zh : model.summary_en}</p>
            {model.dimensions.map(d => <p key={d.dimension} className="text-sm text-ink-2">{zh ? d.explanation_zh : d.explanation_en}</p>)}
            {model.findings.map(f => <div key={f.finding_id} className="rounded-lg bg-surface p-3 text-sm"><p>{zh ? f.observation_zh : f.observation_en}</p>
              {(zh ? f.hypothesis_zh : f.hypothesis_en) && <p className="mt-1 text-ink-3">{zh ? "可能原因：" : "Possible cause: "}{zh ? f.hypothesis_zh : f.hypothesis_en}</p>}
              <button type="button" className="mt-2 text-accent underline" onClick={() => show(f.turn_id, null)}>{zh ? "查看这个弯" : "View this turn"}</button></div>)}
            {model.exercises?.map(exercise => <div key={exercise.id} className="rounded-lg border border-border p-3 text-sm"><p className="font-semibold">{zh ? exercise.name_zh : exercise.name_en}</p><p className="mt-1 text-ink-2">{zh ? exercise.description_zh : exercise.description_en}</p></div>)}
            <ul className="space-y-1 text-xs text-ink-3">{model.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></div>
            : <p className="text-sm text-ink-3">{["pending", "running", "retry_wait"].includes(report.modelStatus)
              ? (zh ? "计算证据已保存，自动评价正在排队或生成；无需等待教练。" : "Evidence is saved; automated assessment is queued or generating. It does not wait for a coach.")
              : (zh ? "自动评价暂不可用，基础计算和可用动态片段仍可查看。" : "Automated assessment is unavailable; base calculations and available turns remain accessible.")}</p>}</>}
        {report.turns.length > 0 && <section id={`turn-player-${base}`} className="scroll-mt-28 space-y-3" aria-label={zh ? "逐弯动态对比" : "Turn-by-turn comparison"}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">{zh ? "逐弯动态对比" : "Turn-by-turn comparison"}</p>
            <p className="text-xs text-ink-3">{zh ? "每个弯从换刃到下一次换刃" : "Each turn runs edge change to edge change"}</p>
          </div>
          <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">{report.turns.map(turn => {
            const meta = metaOf(turn.turnId), active = shown === turn.turnId;
            const Arrow = meta?.direction === "left" ? CornerUpLeft : meta?.direction === "right" ? CornerUpRight : null;
            return <button type="button" key={turn.turnId} aria-pressed={active} onClick={() => setSelected(turn.turnId)}
              title={meta && !meta.scored ? (zh ? "不计分" : "Not scored") : undefined}
              className={cn("press flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold",
                active ? "border-accent bg-accent text-accent-foreground"
                  : meta && !meta.scored ? "border-dashed border-border-strong text-ink-3 hover:text-ink" : "border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink")}>
              {numberedTurn(turn.turnId, zh)}
              {Arrow && <Arrow className="size-3.5" aria-label={meta?.direction === "left" ? (zh ? "左转" : "left") : (zh ? "右转" : "right")} />}
              {meta?.scored && meta.score !== null && <span className={cn("text-xs", active ? "text-accent-foreground/80" : "text-ink-3")} data-numeric>{Math.round(meta.score)}</span>}
            </button>;
          })}</div>
          {focusMetric && scorecard && <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
            <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold">{zh ? "高亮：" : "Highlighting: "}{zh ? scorecard.metrics.find(m => m.key === focusMetric)?.label_zh : scorecard.metrics.find(m => m.key === focusMetric)?.label_en}</span>
            {metricInsight(focusMetric) && <span>{zh ? metricInsight(focusMetric)!.zh : metricInsight(focusMetric)!.en}</span>}
            <button type="button" className="text-accent underline" onClick={() => setFocusMetric(null)}>{zh ? "取消高亮" : "Clear"}</button>
          </p>}
          {shown && report.turns.some(t => t.turnId === shown) && <>
            <TurnComparisonPlayer key={`${base}:${shown}`} base={base} turnId={shown} zh={zh} meta={metaOf(shown)} focusMetric={focusMetric}
              comparison={report.turns.find(turn => turn.turnId === shown)?.comparisonReference} />
            <AnalysisKeyframes key={`${base}:${shown}:keyframes`} base={base} turnId={shown} zh={zh} target={target} /></>}
        </section>}
        {report.explainerStatus && report.explainerStatus !== "unavailable" && <AnalysisExplainer base={base} zh={zh} target={target} />}
        {scorecardBlock}
      </>)}
    <CoachingWorkspace base={base} zh={zh} />
  </div>;
}
