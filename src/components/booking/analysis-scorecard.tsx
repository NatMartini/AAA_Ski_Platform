import { turnNumber, type ReferenceStatus, type Scorecard } from "@/lib/freeski/scorecard";
import type { FreeSkiCurrentLevel } from "@/lib/freeski/actions";
import { metricConfidence, metricDelta, metricInsight, perTurnScores, worstTurnFor } from "@/lib/freeski/metric-insight";

type Metric = Scorecard["metrics"][number];

const QUALITY: Record<Scorecard["quality"], [string, string, string]> = {
  valid: ["数据完整", "Complete data", "border-border bg-success-bg text-success"],
  approximate: ["数据有限", "Limited data", "border-amber-border bg-amber-bg text-amber"],
  insufficient: ["数据不足", "Insufficient data", "border-amber-border bg-amber-bg text-amber"],
};
const REASONS: Record<Scorecard["quality_reasons"][number], [string, string]> = {
  few_turns: ["能打分的中间弯较少，对比结果参考价值有限", "Few scorable middle turns, so the comparison is less reliable"],
  low_pose_confidence: ["部分画面下半身看不清", "The lower body was unclear in parts of the clip"],
  camera_motion: ["镜头晃动影响了测量", "Camera movement affected the measurements"],
  no_matching_reference: ["这个级别没有标准动作，用了最接近的级别对比", "No standard example at this level; the closest level was used"],
  partial_metrics: ["部分指标在多数弯里算不出", "Some metrics could not be computed for most turns"],
  excluded_turns: ["部分弯的画面不足以测量，没有打分", "Some turns lacked enough visual evidence and were not scored"],
  subject_reacquired: ["中途重新识别了滑雪者，标“重新识别”的弯请确认画面中是你", "The skier was re-identified mid-clip; check that turns marked “re-identified” show you"],
};
// On the improvement path FreeSki flags only the expert-to-advanced fallback with no_matching_reference.
const NO_EXPERT: [string, string] = ["这个动作没有专家示范，改用进阶示范对比", "No expert example for this action, so advanced examples were used"];
type EvidenceReason = NonNullable<Scorecard["turns"][number]["evidence"]>["reasons"][number];
const EVIDENCE: Record<EvidenceReason, [string, string]> = {
  subject_small: ["人太小", "too small in frame"], out_of_frame: ["出画或贴边", "at or past the frame edge"],
  lower_body_hidden: ["下半身看不清", "lower body not visible"], tracking_lost: ["跟踪丢失", "tracking lost"],
  overlapping_person: ["与他人重叠", "overlapping another person"], discontinuity: ["画面突跳", "abrupt camera change"],
};
const BAND: Record<NonNullable<Metric["band"]>, [string, string]> = {
  below: ["低于示范常见范围", "Below the examples' usual range"],
  within: ["在示范常见范围内", "Within the examples' usual range"],
  above: ["高于示范常见范围", "Above the examples' usual range"],
};
const ROLE: Record<Scorecard["turns"][number]["role"], [string, string] | null> = {
  start: ["启动弯", "start turn"], middle: null, end: ["结束弯", "end turn"],
};

function round(value: number, digits = 0) {
  return Number(value.toFixed(digits));
}

export function metricValue(metric: Pick<Metric, "unit">, value: number | null, zh: boolean): string | null {
  if (value === null || metric.unit === null) return null;
  switch (metric.unit) {
    case "ratio": return `${round(value * 100)}%`;
    case "percent": return `${round(value)}%`;
    case "deg": return `${round(value)}°`;
    case "deg_per_s": return `${round(value)}°/s`;
    case "turns_per_min": return zh ? `${round(value)} 弯/分钟` : `${round(value)} turns/min`;
    case "s": return `${round(value, 1)} s`;
  }
}

const REFERENCE: Record<ReferenceStatus, [string, string]> = {
  reviewed_platform_reference: ["绿色骨架是审核过的标准动作", "green is a reviewed standard example"],
  auto_matched_unreviewed: ["绿色骨架是自动匹配的 CSIA 示范（未审核）", "green is an automatically matched CSIA example (unreviewed)"],
  not_available: ["没有匹配的标准动作，只画你自己的骨架", "there is no matching standard example, so only your skeleton is drawn"],
};

/**
 * Says which standard skeleton FreeSki drew in keyframes or the explainer; empty when unknown. With the scorecard's
 * target, an automatic match is named like FreeSki's own captions (e.g. "CSIA 2 级通过示范").
 */
export function referenceNote(statuses: readonly ReferenceStatus[], zh: boolean, target: ReferenceTarget | null = null): string {
  const unique = [...new Set(statuses)];
  if (!unique.length) return "";
  const name = target && exampleName(target);
  const parts = unique.map(status => status === "auto_matched_unreviewed" && name
    ? zh ? `绿色骨架是自动匹配的${name[0].startsWith("CSIA") ? " " : ""}${name[0]}（未审核）` : `green is automatically matched from ${name[1]} (unreviewed)`
    : REFERENCE[status][zh ? 0 : 1]);
  if (zh) return `橙色骨架是你；${unique.length > 1 ? parts.map(part => `部分弯${part}`).join("，") : parts[0]}。`;
  return `Orange is you; ${unique.length > 1 ? parts.map(part => `in some turns ${part}`).join(", ") : parts[0]}.`;
}

export type ReferenceTarget = NonNullable<Scorecard["calibration"]["reference_target"]>;

/**
 * The example set FreeSki actually compared. Older scorecards lack the field: AAA always submits certification
 * actions with a level, so one without a level is the improvement path, compared with expert examples.
 */
export function referenceTarget(card: Scorecard): ReferenceTarget | null {
  return card.calibration.reference_target !== undefined ? card.calibration.reference_target : card.level ?? "expert";
}

function comparedWith(target: ReferenceTarget | null, count: number, zh: boolean): string {
  const plural = count === 1 ? "" : "s";
  switch (target) {
    case null: return zh ? "没有可对比的标准动作" : "No standard example to compare with";
    case "expert": return zh ? `对比 ${count} 段专家级示范` : `Compared with ${count} expert example${plural}`;
    case "advanced": return zh ? `对比 ${count} 段进阶级示范` : `Compared with ${count} advanced example${plural}`;
    case "all_pass_levels": return zh ? `对比 ${count} 段各级通过示范` : `Compared with ${count} pass example${plural} across levels`;
    default: return zh ? `对比 ${count} 段 CSIA ${target.slice(-1)} 级通过示范`
      : `Compared with ${count} CSIA level ${target.slice(-1)} pass example${plural}`;
  }
}

function exampleName(target: ReferenceTarget): [string, string] {
  const t = target.slice(-1);
  return target === "expert" ? ["专家示范", "expert examples"] : target === "advanced" ? ["进阶示范", "advanced examples"]
    : target === "all_pass_levels" ? ["各级通过示范", "pass examples across levels"] : [`CSIA ${t} 级通过示范`, `CSIA level ${t} pass examples`];
}

/** Names the example set for a skier who gave their level; the score is the distance to it. */
function levelNote(level: FreeSkiCurrentLevel, target: ReferenceTarget, zh: boolean): string {
  const n = level.slice(-1);
  const name = exampleName(target);
  const gap = name[0].startsWith("CSIA") ? " " : "";
  if (zh) return `${level === "none" ? "你还没考 CSIA 级别" : `你目前是 CSIA ${n} 级`}，技术提升这次对比${gap}${name[0]}，分数表示离这个水平还有多远。`;
  return `${level === "none" ? "You have no CSIA level yet" : `You are currently CSIA level ${n}`}; this improvement analysis compares you with ${name[1]}, so scores show the distance to that standard.`;
}

export function turnLabel(turnId: string, zh: boolean): string {
  const number = turnNumber(turnId);
  return zh ? `第 ${number} 弯` : `Turn ${number}`;
}

const CONFIDENCE: Record<"high" | "medium" | "low", [string, string, string]> = {
  high: ["可信度高", "High confidence", "bg-success-bg text-success"],
  medium: ["可信度中", "Medium confidence", "bg-amber-bg text-amber"],
  low: ["可信度低", "Low confidence", "bg-surface-2 text-ink-3"],
};

/** This metric turn by turn: a tiny bar chart whose lowest counted turn is marked. */
function TurnSparkline({ card, metricKey, zh }: { card: Scorecard; metricKey: string; zh: boolean }) {
  const scores = perTurnScores(card, metricKey);
  if (scores.every(entry => entry.score === null)) return null;
  const worst = worstTurnFor(card, metricKey);
  return <div className="flex h-7 items-end gap-px" role="img"
    aria-label={zh ? `逐弯：${scores.map(entry => entry.score === null ? "无" : round(entry.score)).join("、")}` : `By turn: ${scores.map(entry => entry.score === null ? "n/a" : round(entry.score)).join(", ")}`}>
    {scores.map(entry => <span key={entry.turnId} title={`${turnLabel(entry.turnId, zh)}${entry.score === null ? "" : ` · ${round(entry.score)}`}`}
      className={`min-w-1 flex-1 rounded-sm ${entry.score === null ? "bg-surface-2" : entry.turnId === worst ? "bg-amber" : entry.counted ? "bg-accent/70" : "bg-ink-3/40"}`}
      style={{ height: `${entry.score === null ? 15 : Math.max(8, entry.score)}%` }} />)}
  </div>;
}

function MetricBar({ metric, card, previous, zh, selected, onSelect }: { metric: Metric; card: Scorecard; previous: Scorecard | null; zh: boolean;
  selected: boolean; onSelect?: (key: string) => void }) {
  const label = zh ? metric.label_zh : metric.label_en;
  const value = metricValue(metric, metric.value, zh), reference = metricValue(metric, metric.reference?.median ?? null, zh);
  const band = metric.band && BAND[metric.band][zh ? 0 : 1];
  const confidence = metricConfidence(card, metric);
  const [confZh, confEn, confTone] = CONFIDENCE[confidence.level];
  const delta = metricDelta(card, previous, metric.key);
  const insight = metricInsight(metric.key);
  const worst = worstTurnFor(card, metric.key);
  const body = <>
    <div className="flex items-start justify-between gap-3">
      <p className="min-w-0 break-words text-sm font-medium">{label}
        {metric.measurement === "estimated" && <span className="ml-2 whitespace-nowrap rounded-full border border-amber-border bg-amber-bg px-2 py-0.5 text-xs font-normal text-amber">{zh ? "视频估算 · 不计分" : "Video estimate · not scored"}</span>}
      </p>
      <p className="flex shrink-0 items-baseline gap-1.5 text-sm font-semibold" data-numeric>
        {metric.score === null ? (zh ? "暂无" : "N/A") : round(metric.score)}
        {delta !== null && delta !== 0 && <span className={`text-xs ${delta > 0 ? "text-success" : "text-danger"}`} title={zh ? "和上一次分析相比" : "Compared with your previous analysis"}>{delta > 0 ? "+" : ""}{delta}</span>}
      </p>
    </div>
    {metric.target ? <div role="meter" aria-label={`${label}${band ? `：${band}` : ""}`} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={metric.position ?? undefined} className="relative h-2 rounded-full bg-surface-2">
      <div className="absolute inset-y-0 rounded-full bg-success-bg ring-1 ring-success/40"
        style={{ left: `${metric.target.low}%`, width: `${metric.target.high - metric.target.low}%` }} />
      {metric.position !== null && <div className={`absolute -top-1 h-4 w-1.5 -translate-x-1/2 rounded-full ${metric.band === "within" ? "bg-success" : "bg-amber"}`}
        style={{ left: `${metric.position}%` }} />}
    </div> : <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={metric.score ?? undefined}
      className="relative h-2 rounded-full bg-surface-2">
      {metric.score !== null && <div className={`absolute inset-y-0 left-0 rounded-full ${metric.measurement === "estimated" ? "bg-ink-3" : "bg-accent"}`}
        style={{ width: `${metric.score}%` }} />}
    </div>}
    {(band || value) && <p className="text-xs text-ink-3">
      {[band, value && (zh ? `你的：${value}` : `Yours: ${value}`), reference && (zh ? `示范：${reference}` : `Examples: ${reference}`)]
        .filter(Boolean).join(" · ")}</p>}
    {insight && <p className="text-xs leading-relaxed text-ink-2">{zh ? insight.zh : insight.en}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${confTone}`}
        title={confidence.reasons.map(reason => reason[zh ? 0 : 1]).join(zh ? "；" : "; ") || undefined}>{zh ? confZh : confEn}</span>
      {confidence.reasons.length > 0 && <span className="text-[11px] text-ink-3">{confidence.reasons.map(reason => reason[zh ? 0 : 1]).join(zh ? "、" : ", ")}</span>}
    </div>
    <TurnSparkline card={card} metricKey={metric.key} zh={zh} />
    {onSelect && worst && <span className="text-xs font-semibold text-accent">{selected ? (zh ? "已在播放器里高亮" : "Highlighted in the player") : (zh ? `看最差的${turnLabel(worst, zh)} ›` : `See weakest ${turnLabel(worst, zh).toLowerCase()} ›`)}</span>}
  </>;
  const className = `min-w-0 space-y-2 rounded-lg p-3 text-left ${selected ? "bg-accent-soft ring-2 ring-accent" : "bg-surface"}`;
  return onSelect
    ? <button type="button" aria-pressed={selected} onClick={() => onSelect(metric.key)} className={`${className} press w-full hover:bg-surface-3`}>{body}</button>
    : <div className={className}>{body}</div>;
}

/**
 * Contract v1.1 scorecard: Carv-style per-metric comparison against FreeSki's own standard examples.
 * The overall score is withheld until it is validated against examiner scores (decision of 2026-10-26), and what
 * video cannot measure is not listed at all (2026-10-27), so `unavailable_metrics` is ignored.
 */
export function AnalysisScorecard({ card, zh, currentLevel = null, previous = null, selectedMetric = null, onSelectMetric }: {
  card: Scorecard; zh: boolean; currentLevel?: FreeSkiCurrentLevel | null;
  /** A comparable earlier scorecard of the same action, for "since last time" deltas. */
  previous?: Scorecard | null;
  /** When given, each metric is a button that focuses the turn player on that metric's weakest turn. */
  selectedMetric?: string | null; onSelectMetric?: (key: string) => void;
}) {
  const [qualityZh, qualityEn, qualityTone] = QUALITY[card.quality];
  const metrics = [...card.metrics].sort((a, b) => Number(a.measurement === "estimated") - Number(b.measurement === "estimated") || b.weight - a.weight);
  const separateTurns = card.turns.some(turn => turn.role !== "middle");
  const reacquired = card.turns.some(turn => turn.evidence?.reacquired);
  const target = referenceTarget(card);
  const aboveLevel = currentLevel ? null : target === "expert" ? ["专家", "expert"] : target === "advanced" ? ["进阶", "advanced"] : null;
  return <section className="space-y-4" aria-label={zh ? "FreeSki 动作对比" : "FreeSki technique comparison"}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold">{zh ? "FreeSki 动作对比" : "FreeSki technique comparison"}</p>
        <p className="text-xs text-ink-3">{zh ? "总分暂不显示：评分方法还在用考官打分验证，验证通过后再开放。" : "No overall score yet: the scoring is still being validated against examiner marks."}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${qualityTone}`}>{zh ? qualityZh : qualityEn}</span>
        <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-bold text-ink-2">{zh ? "试验性" : "Experimental"}</span>
      </div>
    </div>
    <p className="text-xs text-ink-3">{comparedWith(target, card.calibration.matched_reference_count, zh)}{zh
      ? ` · ${card.overall.turns_used} 个中间弯${separateTurns ? "，启动弯和结束弯单独列出" : ""}`
      : ` · ${card.overall.turns_used} middle turns${separateTurns ? "; start and end turns are listed separately" : ""}`}</p>
    {aboveLevel && <p className="text-xs text-ink-3">{zh
      ? `技术提升按${aboveLevel[0]}示范对比，分数表示离${aboveLevel[0]}水平还有多远，还没到这个水平时普遍偏低。想和自己所在级别的通过示范比，请选 CSIA 考证动作和级别。`
      : `Improvement analyses compare with ${aboveLevel[1]} examples, so scores show the distance to that level and run low below it. To compare with pass examples at your own level, choose a CSIA certification action and level.`}</p>}
    {currentLevel && target && <p className="text-xs text-ink-3">{levelNote(currentLevel, target, zh)}</p>}
    {card.quality_reasons.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-ink-3">
      {card.quality_reasons.map(reason => <li key={reason}>{(reason === "no_matching_reference" && card.level === null && target === "advanced"
        ? NO_EXPERT : REASONS[reason])[zh ? 0 : 1]}</li>)}</ul>}
    {previous && <p className="text-xs text-ink-3">{zh ? "分数旁的 +/− 是和你上一次同一动作分析的变化。" : "The +/− beside a score is the change since your previous analysis of this action."}</p>}
    {metrics.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{metrics.map(metric => <MetricBar key={metric.key} metric={metric} card={card} previous={previous} zh={zh}
      selected={selectedMetric === metric.key} onSelect={onSelectMetric} />)}</div>}
    {card.turns.length > 0 && <div className="space-y-2">
      <p className="text-sm font-semibold">{zh ? "逐弯得分" : "Score by turn"}</p>
      <ul className="flex flex-wrap gap-2">{card.turns.map(turn => {
        const role = ROLE[turn.role];
        const excluded = turn.evidence?.status === "insufficient";
        const why = excluded ? turn.evidence!.reasons.map(reason => EVIDENCE[reason][zh ? 0 : 1]).join(zh ? "、" : ", ") : "";
        return <li key={turn.turn_id} className={`rounded-full border px-3 py-1 text-sm ${turn.used_in_overall ? "border-accent bg-accent-soft"
          : excluded ? "border-amber-border bg-amber-bg text-amber" : "border-border bg-surface text-ink-2"}`}>
          {turnLabel(turn.turn_id, zh)}{role ? (zh ? `·${role[0]}` : ` · ${role[1]}`) : ""}
          {turn.direction === "left" ? (zh ? "（左）" : " (L)") : turn.direction === "right" ? (zh ? "（右）" : " (R)") : ""}
          {" · "}{excluded ? (zh ? `证据不足${why ? `（${why}）` : ""}` : `not scored${why ? ` (${why})` : ""}`)
            : turn.score === null ? (zh ? "暂无" : "N/A") : round(turn.score)}
          {turn.evidence?.reacquired && (zh ? " · 重新识别" : " · re-identified")}</li>;
      })}</ul>
      <p className="text-xs text-ink-3">{zh ? "每个弯的分数是这个弯各项对比的加权结果；高亮的是中间弯。画面不足以测量的弯不打分。" : "Each turn's score weights its metric comparisons; middle turns are highlighted. Turns without enough visual evidence are not scored."}</p>
      {reacquired && <p className="text-xs text-amber">{zh ? "标“重新识别”的弯：中途重新识别了滑雪者，请确认画面中是你。"
        : "Turns marked re-identified: the skier was picked up again mid-clip, so check that it is you in the frame."}</p>}
    </div>}
    <p className="text-xs leading-relaxed text-ink-3">{zh
      ? "对比为试验性：与 FreeSki 的标准动作数据比较得出，尚未经过考官或教练打分验证。人太小、出画或与他人重叠的弯不打分；其余弯也会受拍摄角度和镜头移动影响。标“视频估算”的指标来自单机位视频，只显示、不计分。只对比视频能测量的 CSIA 考核要求。"
      : "Experimental: compared with FreeSki's standard examples and not yet validated against examiner or coach ratings. Turns where the skier is too small, out of frame or overlapping someone are not scored; the rest can still be affected by camera angle and movement. Metrics marked as video estimates come from single-camera video and are shown but not scored. Only CSIA criteria that video can measure are compared."}</p>
  </section>;
}
