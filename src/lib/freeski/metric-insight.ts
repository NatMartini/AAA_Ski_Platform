import type { Scorecard } from "./scorecard";

type Metric = Scorecard["metrics"][number];
type Turn = Scorecard["turns"][number];

/**
 * Plain words for each metric: which body lines it measures and what a low value usually means.
 * The joint pairs are the lines the turn player highlights when the metric is selected; "hip_path"
 * draws the hip trail instead. Names match FreeSki's published 23-joint layout.
 */
export const METRIC_INSIGHT: Record<string, { zh: string; en: string; lines: [string, string][]; hipPath?: boolean }> = {
  parallel_skis: { zh: "两条小腿（膝到踝）在画面里的倾斜差。差得越多，两板越不平行。",
    en: "How differently the two lower legs (knee to ankle) tilt in the picture. The bigger the difference, the less parallel the skis.",
    lines: [["left_knee", "left_ankle"], ["right_knee", "right_ankle"]] },
  upper_body_quiet_index: { zh: "肩线相对髋线转动了多少。上身跟着雪板一起转，这项就低。",
    en: "How much the shoulder line turns compared with the hip line. It drops when the upper body turns with the skis.",
    lines: [["left_shoulder", "right_shoulder"], ["left_hip", "right_hip"]] },
  rotation_rate: { zh: "肩线转动的速度。短弯需要更快的转向，长弯则更慢。",
    en: "How fast the shoulder line turns. Short turns need faster steering; long turns slower.",
    lines: [["left_shoulder", "right_shoulder"], ["left_hip", "right_hip"]] },
  turn_tempo: { zh: "每分钟转了几个弯，按这个弯的用时折算。", en: "Turns per minute, from this turn's duration.", lines: [], hipPath: true },
  rhythm_continuity: { zh: "弯中段髋部移动速度稳不稳。忽快忽慢、中途停顿会拉低。",
    en: "How steady the hips move through the middle of the turn. Speeding up, slowing down or pausing lowers it.", lines: [], hipPath: true },
  turn_completion_direction: { zh: "从入弯到出弯，髋部行进方向转了多少度。弯没收完就直接换边，这项低。",
    en: "How many degrees the hips' direction of travel changes from entry to exit. Changing edges before the turn is finished lowers it.", lines: [], hipPath: true },
  turn_closure: { zh: "弯的后半段收得够不够，同样看髋部行进方向的变化。",
    en: "How fully the second half of the turn is finished, again from the hips' direction of travel.", lines: [], hipPath: true },
  edge_angle: { zh: "踝到膝的线相对画面垂直线倾了多少度，视频估算，只显示不计分。",
    en: "How far the ankle-to-knee line tilts from vertical in the picture. A video estimate; shown, not scored.",
    lines: [["left_hip", "left_ankle"], ["right_hip", "right_ankle"]] },
  edge_change_sync: { zh: "两条腿换刃的时间差，视频估算，只显示不计分。",
    en: "The time gap between the two legs changing edges. A video estimate; shown, not scored.",
    lines: [["left_knee", "left_ankle"], ["right_knee", "right_ankle"]] },
  flexion_range: { zh: "一个弯里腿部屈伸的幅度，视频估算，只显示不计分。",
    en: "How much the legs flex and extend within the turn. A video estimate; shown, not scored.",
    lines: [["left_hip", "left_knee"], ["left_knee", "left_ankle"], ["right_hip", "right_knee"], ["right_knee", "right_ankle"]] },
};

export function metricInsight(key: string) {
  return Object.hasOwn(METRIC_INSIGHT, key) ? METRIC_INSIGHT[key] : null;
}

/** This metric's score in each turn, in turn order; null where the turn was not scored for it. */
export function perTurnScores(card: Scorecard, key: string): { turnId: string; score: number | null; counted: boolean }[] {
  return card.turns.map(turn => ({ turnId: turn.turn_id, counted: turn.used_in_overall,
    score: turn.metrics.find(metric => metric.key === key)?.score ?? null }));
}

/** The counted turn where this metric scored lowest; the best place to look when it needs work. */
export function worstTurnFor(card: Scorecard, key: string): string | null {
  let worst: { turnId: string; score: number } | null = null;
  for (const turn of card.turns) {
    if (!turn.used_in_overall) continue;
    const score = turn.metrics.find(metric => metric.key === key)?.score;
    if (score !== null && score !== undefined && (!worst || score < worst.score)) worst = { turnId: turn.turn_id, score };
  }
  return worst?.turnId ?? null;
}

export type Confidence = { level: "high" | "medium" | "low"; reasons: [string, string][] };

/**
 * How far to trust one metric's comparison, from what the scorecard itself reports: how the clip
 * was shot, how many turns it was measured in, and how many demonstrations stand behind the range.
 */
export function metricConfidence(card: Scorecard, metric: Metric): Confidence {
  const reasons: [string, string][] = [];
  let level: Confidence["level"] = "high";
  const lower = (to: Confidence["level"]) => { if (to === "low" || level === "high") level = to; };
  if (metric.measurement === "estimated") { reasons.push(["视频估算", "video estimate"]); lower("low"); }
  if (metric.score === null) { reasons.push(["没有算出", "not computed"]); lower("low"); }
  const counted = card.turns.filter(turn => turn.used_in_overall);
  const scored = counted.filter(turn => turn.metrics.some(entry => entry.key === metric.key && entry.score !== null));
  if (counted.length > 0 && scored.length < Math.max(3, counted.length / 2)) { reasons.push([`只在 ${scored.length} 个弯里测到`, `measured in only ${scored.length} turns`]); lower("low"); }
  else if (counted.length > 0 && counted.length < 5) { reasons.push(["可打分的弯较少", "few scorable turns"]); lower("medium"); }
  if (card.calibration.matched_reference_count <= 1) { reasons.push(["只有 1 段示范可比", "only one demonstration to compare with"]); lower("medium"); }
  if (card.quality === "insufficient") { reasons.push(["画面不足", "insufficient footage"]); lower("low"); }
  else if (card.quality_reasons.includes("camera_motion")) { reasons.push(["镜头晃动", "camera movement"]); lower("medium"); }
  if (card.quality_reasons.includes("low_pose_confidence") && metricInsight(metric.key)?.lines.some(([a]) => /(knee|ankle|hip)/.test(a)))
    { reasons.push(["下半身看不清", "lower body unclear"]); lower("medium"); }
  if (card.quality_reasons.includes("subject_reacquired")) { reasons.push(["中途重新识别", "re-identified mid-clip"]); lower("medium"); }
  return { level, reasons };
}

/** Two scorecards can be compared turn for turn only when the same scoring and references produced them. */
export function comparableScorecards(current: Scorecard, previous: Scorecard): boolean {
  const c = current.calibration, p = previous.calibration;
  return current.action === previous.action && current.level === previous.level &&
    (current.current_level ?? null) === (previous.current_level ?? null) &&
    (c.scoring_version ?? "freeski-scorecard-1") === (p.scoring_version ?? "freeski-scorecard-1") &&
    (c.calibration_id ?? null) === (p.calibration_id ?? null) && (c.reference_target ?? null) === (p.reference_target ?? null);
}

/** Change in a metric's score since a comparable earlier scorecard; null when either side has none. */
export function metricDelta(current: Scorecard, previous: Scorecard | null, key: string): number | null {
  if (!previous || !comparableScorecards(current, previous)) return null;
  const now = current.metrics.find(metric => metric.key === key)?.score ?? null;
  const then = previous.metrics.find(metric => metric.key === key)?.score ?? null;
  return now === null || then === null ? null : Math.round(now - then);
}

export function turnById(card: Scorecard, turnId: string): Turn | undefined {
  return card.turns.find(turn => turn.turn_id === turnId);
}
