import { z } from "zod";

// Report contract v1.1 (docs/FREESKI_REPORT_CONTRACT.md): scorecard, teaching, keyframes and explainer.
const metricKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const turnId = z.string().regex(/^turn_\d{1,5}$/);
const factId = z.string().regex(/^f_[a-z0-9_]{1,80}$/);
const keyframeId = z.string().regex(/^kf_[a-f0-9]{32}$/);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/);
const score = z.number().finite().min(0).max(100);
const seconds = z.number().finite().nonnegative();
const count = z.number().int().min(0).max(100_000);
const phase = z.enum(["start", "initiation", "apex", "completion", "end"]);
const measurement = z.enum(["direct", "estimated"]);
const band = z.enum(["below", "within", "above"]);
// FreeSki's native jobs spell a level as a bare digit; AAA jobs use levelN.
const level = z.preprocess(value => typeof value === "string" && /^[1-4]$/.test(value) ? `level${value}` : value,
  z.enum(["level1", "level2", "level3", "level4"]).nullable());

/** Humans count turns from one: turn_0 is shown as turn 1 on both sides of the contract. */
export function turnNumber(id: string): number | null {
  const match = /^turn_(\d{1,5})$/.exec(id);
  return match ? Number(match[1]) + 1 : null;
}

const metricScore = z.object({
  key: metricKey, label_zh: z.string().max(40), label_en: z.string().max(60),
  measurement, presentation: z.enum(["bar", "target"]),
  score: score.nullable(), band: band.nullable(), position: score.nullable(),
  target: z.object({ low: score, high: score }).nullable(),
  weight: z.number().finite().min(0).max(1),
  value: z.number().finite().nullable(),
  unit: z.enum(["ratio", "percent", "deg", "deg_per_s", "turns_per_min", "s"]).nullable(),
  reference: z.object({ p25: z.number().finite(), median: z.number().finite(), p75: z.number().finite() }).nullable(),
}).refine(metric => (metric.presentation === "bar" ? metric.target === null && metric.position === null
      // A bell metric may lack a zone only when the standard example has no such metric (and so no score).
      : metric.target !== null || metric.score === null) &&
    (!metric.target || metric.target.low <= metric.target.high) &&
    // Image-plane angles are not true edge angles: estimates are shown, never scored or given raw values.
    (metric.measurement === "direct" || metric.weight === 0 && metric.value === null && metric.unit === null && metric.reference === null),
  "Invalid metric presentation");

export const scorecardSchema = z.object({
  schema_version: z.literal("freeski_scorecard.v1"), experimental: z.literal(true),
  action: metricKey, level,
  // The skier's own level on an improvement request; null otherwise, absent on scorecards from before 2026-10-27.
  current_level: z.enum(["none", "level1", "level2", "level3", "level4"]).nullable().optional(),
  // Stored scores are comparable only when scoring_version and calibration_id both match.
  // Scorecards saved before these existed count as freeski-scorecard-1 with an unknown calibration.
  // reference_target names the example set actually compared (absent on scorecards from before it existed).
  calibration: z.object({ reference_generation: identifier, reference_clip_count: count, matched_reference_count: count,
    scoring_version: identifier.optional(), calibration_id: identifier.nullable().optional(),
    reference_target: z.enum(["expert", "advanced", "level1", "level2", "level3", "level4", "all_pass_levels"]).nullable().optional() }),
  quality: z.enum(["valid", "approximate", "insufficient"]),
  quality_reasons: z.array(z.enum(["few_turns", "low_pose_confidence", "camera_motion",
    "no_matching_reference", "partial_metrics", "excluded_turns", "subject_reacquired"])).max(7),
  overall: z.object({ score: score.nullable(), aggregation: z.literal("middle_turns_mean"),
    turns_used: z.number().int().min(0).max(100), turns_total: count, turns_excluded: count.optional() }),
  metrics: z.array(metricScore).max(24),
  turns: z.array(z.object({ turn_id: turnId, start_ms: seconds, end_ms: seconds,
    direction: z.enum(["left", "right", "unknown"]), role: z.enum(["start", "middle", "end"]),
    score: score.nullable(), used_in_overall: z.boolean(),
    // Per-turn video quality gate: a turn without enough visual evidence is listed but never scored.
    // reacquired: the tracker re-locked onto a lone skier after losing them; scored, but identity is unverified.
    evidence: z.object({ status: z.enum(["ok", "insufficient"]),
      reasons: z.array(z.enum(["subject_small", "out_of_frame", "lower_body_hidden", "tracking_lost",
        "overlapping_person", "discontinuity"])).max(6), reacquired: z.boolean().optional() }).optional(),
    metrics: z.array(z.object({ key: metricKey, score: score.nullable(), band: band.nullable().optional() })).max(24) })).max(100),
  unavailable_metrics: z.array(metricKey).max(40),
}).refine(card => {
  const weight = card.metrics.filter(metric => metric.score !== null).reduce((sum, metric) => sum + metric.weight, 0);
  return (card.quality === "insufficient") === (card.overall.score === null) &&
    card.overall.turns_used <= card.overall.turns_total &&
    new Set(card.metrics.map(metric => metric.key)).size === card.metrics.length &&
    new Set(card.turns.map(turn => turn.turn_id)).size === card.turns.length &&
    (card.overall.score === null || Math.abs(weight - 1) <= .02) &&
    // Start and end turns are scored and listed, but only middle turns form the overall score.
    card.turns.every(turn => turn.end_ms > turn.start_ms && (!turn.used_in_overall || turn.role === "middle" && turn.score !== null) &&
      (turn.evidence?.status !== "insufficient" || turn.score === null && !turn.used_in_overall && turn.metrics.length === 0));
}, "Inconsistent scorecard");
export type Scorecard = z.infer<typeof scorecardSchema>;

/** A scorecard settles a credit only with a real overall score from sufficient evidence. */
export function scorecardUsable(card: Scorecard | null | undefined): boolean {
  return !!card && card.quality !== "insufficient" && card.overall.score !== null;
}

/** Credits settle on a valid legacy TECH grade or a usable contract scorecard. */
export function analysisResultUsable(result: { gradingStatus: string; scoreKind: string | null;
  score: number | null; scorecard?: Scorecard | null }): boolean {
  const tech = result.gradingStatus === "graded" && result.scoreKind === "TECH" && typeof result.score === "number" &&
    Number.isFinite(result.score) && result.score >= 0 && result.score <= 100;
  return tech || scorecardUsable(result.scorecard);
}

const prose = (max: number) => z.string().max(max);
const fact = z.object({ fact_id: factId, metric_key: metricKey, turn_id: turnId.nullable(), phase: phase.nullable(),
  time_sec: seconds.nullable(), user_score: score.nullable(), reference_band: band, measurement });
const citations = z.array(factId).max(8);
const strength = z.object({ text_zh: prose(600), text_en: prose(600), fact_ids: citations });
const improvement = strength.extend({ turn_ids: z.array(turnId).max(10), keyframe_ids: z.array(keyframeId).max(10),
  priority: z.enum(["primary", "secondary"]) });
const drill = z.object({ drill_id: metricKey, name_zh: prose(150), name_en: prose(200),
  why_zh: prose(600), why_en: prose(600), fact_ids: citations });

export const teachingSchema = z.object({
  schema_version: z.literal("freeski_teaching.v1"), experimental: z.literal(true), mode: z.literal("reference_comparison"),
  facts: z.array(fact).max(40), summary_zh: prose(800), summary_en: prose(800),
  strengths: z.array(strength).max(4), improvements: z.array(improvement).max(4), drills: z.array(drill).max(3),
  limitations_zh: z.array(prose(600)).max(8), limitations_en: z.array(prose(600)).max(8),
  model: z.object({ model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_. -]{0,199}$/).nullable(), project: identifier, prompt_version: identifier }),
});
export type Teaching = z.infer<typeof teachingSchema>;
/** Lifecycle shared by the asynchronous teaching and explainer addons. */
export const addonStatusSchema = z.enum(["pending", "running", "ready", "unavailable", "failed"]);

const unsafeText = /(?:https?:\/\/|file:|[A-Za-z]:\\|\/(?:media|storage|home|Users)\/)/i;

// The model sometimes echoes its citations inline, e.g. "（f_rotation_rate, f_parallel_skis）"; fact_ids already carry them.
const inlineCitation = /\s*[(（[【]\s*f_[a-z0-9_]{1,80}(?:\s*[,，、;；]\s*f_[a-z0-9_]{1,80})*\s*[)）\]】]/g;
const plain = (text: string) => text.replace(inlineCitation, "");

/** Keeps only conclusions whose every citation names a code-computed fact, without inline citation ids. */
export function citedTeaching(teaching: Teaching): Teaching {
  const facts = new Map(teaching.facts.map(item => [item.fact_id, item]));
  const cited = <T extends { fact_ids: string[] }>(entry: T, texts: string[]) => entry.fact_ids.length > 0 &&
    entry.fact_ids.every(id => facts.has(id)) && texts.every(text => !unsafeText.test(text));
  return {
    ...teaching,
    facts: [...facts.values()],
    strengths: teaching.strengths.filter(entry => cited(entry, [entry.text_zh, entry.text_en]))
      .map(entry => ({ ...entry, text_zh: plain(entry.text_zh), text_en: plain(entry.text_en) })),
    improvements: teaching.improvements.filter(entry => cited(entry, [entry.text_zh, entry.text_en]))
      .map(entry => ({ ...entry, text_zh: plain(entry.text_zh), text_en: plain(entry.text_en) })),
    drills: teaching.drills.filter(entry => cited(entry, [entry.name_zh, entry.name_en, entry.why_zh, entry.why_en]))
      .map(entry => ({ ...entry, why_zh: plain(entry.why_zh), why_en: plain(entry.why_en) })),
    summary_zh: unsafeText.test(teaching.summary_zh) ? "" : plain(teaching.summary_zh),
    summary_en: unsafeText.test(teaching.summary_en) ? "" : plain(teaching.summary_en),
  };
}

const overallWords = /总分|整体评分|综合评分|评分卡|overall score|score ?card/i;

/** Hides prose that quotes the withheld overall score; per-metric and per-turn scores stay. */
export function withoutOverallScore(teaching: Teaching, overall: number | null): Teaching {
  const total = overall === null ? null : overall.toFixed(1);
  const quotes = (text: string) => overallWords.test(text) || total !== null && text.includes(total);
  const keep = (texts: string[]) => texts.every(text => !quotes(text));
  return {
    ...teaching,
    summary_zh: quotes(teaching.summary_zh) ? "" : teaching.summary_zh,
    summary_en: quotes(teaching.summary_en) ? "" : teaching.summary_en,
    strengths: teaching.strengths.filter(entry => keep([entry.text_zh, entry.text_en])),
    improvements: teaching.improvements.filter(entry => keep([entry.text_zh, entry.text_en])),
  };
}

/** True when any cited fact comes from a video-estimated (not directly measured) metric. */
export function citesEstimated(teaching: Teaching, factIds: string[]): boolean {
  return factIds.some(id => teaching.facts.find(item => item.fact_id === id)?.measurement === "estimated");
}

/** Which standard skeleton FreeSki drew for a turn: reviewed, auto-matched CSIA example, or none. */
export const referenceStatusSchema = z.enum(["reviewed_platform_reference", "auto_matched_unreviewed", "not_available"]);
export type ReferenceStatus = z.infer<typeof referenceStatusSchema>;

export const keyframesSchema = z.object({
  schema_version: z.literal("freeski_keyframes.v1"), turn_id: turnId,
  status: z.enum(["pending", "ready", "unavailable"]),
  items: z.array(z.object({ keyframe_id: keyframeId, phase, time_sec: seconds,
    reference_time_sec: seconds.nullable(),
    width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096),
    focus_metric_key: metricKey.nullable(), caption_zh: prose(300), caption_en: prose(400),
    fact_ids: citations, reference_status: referenceStatusSchema.optional() })).max(5),
}).refine(manifest => new Set(manifest.items.map(item => item.keyframe_id)).size === manifest.items.length, "Duplicate keyframe");
export type Keyframes = z.infer<typeof keyframesSchema>;

const explainerSegment = z.object({
  kind: z.enum(["title", "realtime", "slow", "freeze", "outro"]), start_sec: seconds, end_sec: seconds,
  turn_id: turnId.nullable(), speed: z.number().finite().min(0).max(1).nullable(),
  source_start_sec: seconds.optional(), source_end_sec: seconds.optional(), freeze_at_sec: seconds.optional(),
  keyframe_id: keyframeId.optional(), focus_metric_key: metricKey.nullable(), fact_ids: citations,
  caption_zh: prose(300), caption_en: prose(400),
}).refine(segment => segment.end_sec > segment.start_sec, "Empty explainer segment");

export const explainerSchema = z.object({
  schema_version: z.literal("freeski_explainer.v1"), status: addonStatusSchema, experimental: z.literal(true).optional(),
  width: z.number().int().min(1).max(4096).optional(), height: z.number().int().min(1).max(4096).optional(),
  fps: z.number().finite().positive().max(120).optional(), duration_sec: seconds.max(600).optional(),
  bytes: z.number().int().positive().optional(),
  reference: z.enum(["reviewed_platform_reference", "auto_matched_unreviewed", "not_available", "mixed"]).optional(),
  reference_status: z.record(turnId, referenceStatusSchema).optional(),
  segments: z.array(explainerSegment).max(40).optional(),
}).refine(explainer => explainer.status !== "ready" || explainer.width !== undefined && explainer.height !== undefined &&
  explainer.duration_sec !== undefined && explainer.segments !== undefined &&
  explainer.segments.every(segment => segment.end_sec <= explainer.duration_sec! + .05), "Incomplete ready explainer");
export type Explainer = z.infer<typeof explainerSchema>;

export const KEYFRAME_ID = /^kf_[a-f0-9]{32}$/;
export const MAX_KEYFRAME_BYTES = 400 * 1024;
export const MAX_EXPLAINER_BYTES = 24 * 1024 * 1024;
