import type { Locale } from "@/i18n/routing";
import { analysisResultUsable, scorecardSchema, type Scorecard } from "@/lib/freeski/scorecard";
import { parseFreeSkiActionId, type FreeSkiCurrentLevel } from "@/lib/freeski/actions";
import { DynamicCoachingReport } from "./dynamic-coaching-report";
import { AnalysisScorecard } from "./analysis-scorecard";

type SafeAnalysisResult = {
  gradingStatus: "graded" | "unavailable";
  score: number | null;
  scoreKind: string | null;
  gradingReason: string | null;
  coachingZh: string[];
  coachingEn: string[];
  numTurns: number | null;
  metrics: { key: string; score: number | null }[];
  scorecard: Scorecard | null;
  /** The skier's level given with an improvement request; null when none was asked. */
  currentLevel: FreeSkiCurrentLevel | null;
};

export function readAnalysisResult(value: unknown): SafeAnalysisResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  return {
    gradingStatus: result.gradingStatus === "graded" ? "graded" : "unavailable",
    score: typeof result.score === "number" && Number.isFinite(result.score) ? result.score : null,
    scoreKind: typeof result.scoreKind === "string" ? result.scoreKind : null,
    gradingReason: typeof result.gradingReason === "string" ? result.gradingReason : null,
    coachingZh: Array.isArray(result.coachingZh) ? result.coachingZh.filter((item): item is string => typeof item === "string") : [],
    coachingEn: Array.isArray(result.coachingEn) ? result.coachingEn.filter((item): item is string => typeof item === "string") : [],
    numTurns: typeof result.numTurns === "number" && Number.isInteger(result.numTurns) && result.numTurns >= 0 && result.numTurns <= 100_000 ? result.numTurns : null,
    metrics: Array.isArray(result.metrics) ? result.metrics.slice(0, 40).flatMap(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const metric = item as Record<string, unknown>;
      if (typeof metric.key !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(metric.key)) return [];
      return [{ key: metric.key, score: typeof metric.score === "number" && Number.isFinite(metric.score) && metric.score >= 0 && metric.score <= 100 ? metric.score : null }];
    }) : [],
    scorecard: scorecardSchema.safeParse(result.scorecard).data ?? null,
    currentLevel: parseFreeSkiActionId(result.actionId)?.currentLevel ?? null,
  };
}

export function VideoAnalysisResult({ result: rawResult, locale, dynamicReportBase }: { result: unknown; locale: Locale; dynamicReportBase?: string }) {
  const zh = locale === "zh";
  const result = readAnalysisResult(rawResult);
  const card = result?.scorecard ?? null;
  // New jobs carry a scorecard; their overall scores (scorecard and legacy TECH) stay hidden until validated.
  const comparison = card !== null && analysisResultUsable(result!);
  const available = !card && result?.gradingStatus === "graded" && result.scoreKind === "TECH" && result.score !== null && result.score >= 0 && result.score <= 100;
  // Legacy TECH cues quote TECH metric scores that disagree with the scorecard; FreeSki's teaching replaces them.
  const coaching = comparison ? [] : zh ? result?.coachingZh : result?.coachingEn;
  const reasons: Record<string, string> = {
    "wrong-action": zh ? "识别到的动作与所选动作不一致。" : "The detected action does not match the selected action.",
    "insufficient-turns": zh ? "有效滑行片段或转弯次数不足。" : "There are not enough usable turns in this clip.",
    "low-confidence": zh ? "动作识别置信度不足。" : "The action could not be recognized with enough confidence.",
    "score-unavailable": zh ? "这个片段暂不满足评分条件。" : "This clip does not meet the scoring requirements.",
  };
  return <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-3">
    {comparison ? <AnalysisScorecard card={card} zh={zh} currentLevel={result!.currentLevel} /> : <>
    <p className="text-sm font-semibold">{available ? <>{zh ? "技术评分" : "Technical score"}: <span className="font-display text-xl text-accent">{Number(result.score!.toFixed(1))}</span></>
      : zh ? "本次无法评分，不扣分析次数。" : "A score is unavailable for this analysis. No credit is used."}</p>
    {!available && <p className="text-xs text-ink-3">{zh ? "动作识别、有效滑行片段或评分条件不足时，不会显示为 0 分。可换一个更清晰、完整的片段重试。" : "An unrecognized action, insufficient usable turns or unmet scoring requirements is shown as unavailable. Try a clearer, complete clip."}</p>}
    {!available && result?.gradingReason && reasons[result.gradingReason] && <p className="text-sm text-ink-2">{reasons[result.gradingReason]}</p>}
    {available && result.numTurns !== null && <p className="text-xs text-ink-3">{zh ? `有效转弯：${result.numTurns} 次` : `Usable turns: ${result.numTurns}`}</p>}
    {available && result.metrics.length > 0 && <div className="space-y-2 border-t border-border pt-3">
      <p className="text-sm font-semibold">{zh ? "技术指标" : "Technique metrics"}</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">{result.metrics.map((metric, index) => <div key={`${metric.key}:${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-surface p-2">
        <dt className="break-words text-ink-2">{metricLabel(metric.key, zh)}</dt>
        <dd className="shrink-0 font-semibold">{metric.score === null ? (zh ? "暂无评分" : "Unavailable") : `${Number(metric.score.toFixed(1))} / 100`}</dd>
      </div>)}</dl>
    </div>}
    </>}
    {coaching && coaching.length > 0 && <ul className="space-y-1 text-sm leading-relaxed text-ink-2">{coaching.map((text, index) => <li key={index}>{text}</li>)}</ul>}
    {dynamicReportBase && <DynamicCoachingReport base={dynamicReportBase} zh={zh} />}
  </div>;
}

function metricLabel(key: string, zh: boolean) {
  const names: Record<string, [string, string]> = {
    rotation_rate: ["肩线旋转速度", "Shoulder rotation rate"], turn_tempo: ["转弯节奏", "Turn tempo"],
    rhythm_continuity: ["节奏连续性", "Rhythm continuity"], parallel_skis: ["双板平行", "Parallel skis"],
    upper_body_quiet_index: ["上身稳定性", "Upper-body stability"], turn_completion_direction: ["转弯方向完成度", "Turn direction completion"],
    turn_closure: ["弯完成度", "Turn completion"], stance_width_consistency: ["站距一致性", "Stance width consistency"],
  };
  return names[key]?.[zh ? 0 : 1] ?? key.replaceAll("_", " ");
}
