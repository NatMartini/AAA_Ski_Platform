import { ArrowRight, Check, Play, Target } from "lucide-react";
import type { Scorecard, Teaching } from "@/lib/freeski/scorecard";
import { metricDelta, metricStanding, standingCounts, worstTurnFor } from "@/lib/freeski/metric-insight";
import { cn } from "@/lib/utils";
import { exampleName, referenceTarget, turnLabel } from "./analysis-scorecard";
import { splitCriterion } from "./analysis-teaching";

export type ReportFocus = { turnId: string | null; metric: string | null };

/** What the report points the player at: FreeSki's primary improvement, else the measurement furthest short of the examples. */
export function reportFocus(teaching: Teaching | null, card: Scorecard | null): ReportFocus {
  const primary = teaching?.improvements.find(item => item.priority === "primary") ?? teaching?.improvements[0];
  if (teaching && primary) {
    const facts = primary.fact_ids.flatMap(id => teaching.facts.filter(fact => fact.fact_id === id));
    const metric = facts[0]?.metric_key ?? null;
    return { metric, turnId: primary.turn_ids[0] ?? facts.find(fact => fact.turn_id)?.turn_id ?? (card && metric ? worstTurnFor(card, metric) : null) };
  }
  const weakest = card?.metrics.filter(metric => metricStanding(metric) === "work").sort((a, b) => a.score! - b.score! || b.weight - a.weight)[0];
  return card && weakest ? { metric: weakest.key, turnId: worstTurnFor(card, weakest.key) } : { metric: null, turnId: null };
}

/**
 * The report's opening card while the overall score is withheld: how many measurements reach the examples' usual
 * level, one thing going well, and the one thing to work on, with a button that plays it.
 */
export function ReportConclusion({ teaching, card, previous, zh, focus, teachingPending = false, onShow }: {
  teaching: Teaching | null; card: Scorecard | null; previous: Scorecard | null; zh: boolean; focus: ReportFocus;
  teachingPending?: boolean; onShow?: (turnId: string | null, metric: string | null) => void;
}) {
  const counts = card ? standingCounts(card) : null;
  const target = card ? referenceTarget(card) : null;
  const measured = counts ? counts.good + counts.work : 0;
  const label = (key: string | null) => { const metric = card?.metrics.find(entry => entry.key === key); return metric ? zh ? metric.label_zh : metric.label_en : null; };
  const goodLabels = card?.metrics.filter(metric => metricStanding(metric) === "good").sort((a, b) => b.weight - a.weight).slice(0, 2)
    .map(metric => zh ? metric.label_zh : metric.label_en) ?? [];
  const strength = teaching?.strengths[0] ? splitCriterion(zh ? teaching.strengths[0].text_zh : teaching.strengths[0].text_en)[0]
    : goodLabels.length ? zh ? `${goodLabels.join("、")}达到示范常见水平` : `${goodLabels.join(" and ")} at the examples' usual level` : null;
  const primary = teaching?.improvements.find(item => item.priority === "primary") ?? teaching?.improvements[0];
  const focusLabel = label(focus.metric);
  const improvement: [string, string | null] | null = primary ? splitCriterion(zh ? primary.text_zh : primary.text_en)
    : focusLabel ? [zh ? `${focusLabel}${focus.turnId ? `，${turnLabel(focus.turnId, zh)}最明显` : ""}`
      : `${focusLabel}${focus.turnId ? `, clearest in ${turnLabel(focus.turnId, zh).toLowerCase()}` : ""}`, null] : null;
  const delta = card && focus.metric ? metricDelta(card, previous, focus.metric) : null;
  if (!measured && !strength && !improvement && !teachingPending) return null;
  let summary: string | null = null;
  if (counts && target && measured > 0) {
    const [nameZh, nameEn] = exampleName(target);
    summary = zh
      ? [`${measured} 项里 ${counts.good} 项达到${nameZh.startsWith("CSIA") ? " " : ""}${nameZh}的常见水平`, counts.work && `${counts.work} 项需加强`,
        counts.estimated && `另有 ${counts.estimated} 项视频估算，不计分`, counts.none && `${counts.none} 项这次没算出`].filter(Boolean).join(" · ")
      : [`${counts.good} of ${measured} measurements are at the usual level of ${nameEn}`, counts.work && `${counts.work} need${counts.work === 1 ? "s" : ""} work`,
        counts.estimated && `${counts.estimated} more ${counts.estimated === 1 ? "is a video estimate" : "are video estimates"}, not scored`,
        counts.none && `${counts.none} not computed`].filter(Boolean).join(" · ");
  }
  return <div className="space-y-3 rounded-2xl border border-accent/30 bg-accent-soft/60 p-4 sm:p-5">
    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent"><Target className="size-4" aria-hidden />{zh ? "这次的结论" : "This run"}</p>
    {counts && summary && <div className="space-y-1.5">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {counts.good > 0 && <span className="bg-success" style={{ flexGrow: counts.good }} />}
        {counts.work > 0 && <span className="bg-amber" style={{ flexGrow: counts.work }} />}
        {counts.estimated > 0 && <span className="bg-ink-3/40" style={{ flexGrow: counts.estimated }} />}
      </div>
      <p className="text-sm text-ink-2">{summary}</p>
    </div>}
    {strength && <p className="flex gap-2 text-sm leading-relaxed"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      <span><span className="font-semibold">{zh ? "做得好：" : "Going well: "}</span>{strength}</span></p>}
    {improvement && <div className="flex gap-2 text-sm leading-relaxed"><ArrowRight className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p><span className="font-semibold">{zh ? "最该练：" : "Work on: "}</span>{improvement[0]}</p>
        {improvement[1] && <p className="text-xs text-ink-2">{improvement[1]}</p>}
        {delta !== null && delta !== 0 && <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-semibold", delta > 0 ? "bg-success-bg text-success" : "bg-danger-bg text-danger")}>
          {zh ? `这项比上次${delta > 0 ? "进步" : "退步"} ${Math.abs(delta)} 分` : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} since last time`}</span>}
      </div></div>}
    {!improvement && measured > 0 && counts?.work === 0 && <p className="text-sm text-ink-2">{zh ? "这次没有低于示范常见水平的项目。" : "Nothing measured falls short of the examples' usual level this time."}</p>}
    {teachingPending && <p className="text-xs text-ink-3">{zh ? "动作解释生成中，评分和动态对比已经可以查看。" : "The explanation is being written; scores and turn playback are already available."}</p>}
    {onShow && (focus.turnId || focus.metric) && <button type="button" onClick={() => onShow(focus.turnId, focus.metric)}
      className="press inline-flex min-h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground">
      <Play className="size-4" aria-hidden />{focus.turnId ? (zh ? `看${turnLabel(focus.turnId, zh)}，高亮这个问题` : `Watch ${turnLabel(focus.turnId, zh).toLowerCase()} with this highlighted`)
        : (zh ? "在播放器里高亮这个问题" : "Highlight this in the player")}</button>}
  </div>;
}
