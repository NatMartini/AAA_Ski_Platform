import type { ThinkingLevel } from "../freeski/scorecard";
import { THINKING_LEVELS } from "../freeski/scorecard";
import { toDateKey, torontoWallTimeToUtc } from "../time";

/**
 * The four analysis tiers (owner's decisions, 2026-11-09). Simple and standard are free, deep costs half an analysis
 * and complete one. A tier can be changed later: a free-to-free change costs nothing, a change up costs the difference
 * to the costliest tier already paid for, and nothing is refunded on the way down, so going back up to a tier already
 * paid for is free too. Coaches and administrators analyse without limit.
 */
export const ANALYSIS_TIERS = ["SIMPLE", "STANDARD", "DEEP", "COMPLETE"] as const;
export type AnalysisTier = (typeof ANALYSIS_TIERS)[number];

/** Older analyses were the full report and cost one analysis: they are complete. */
export const LEGACY_TIER: AnalysisTier = "COMPLETE";
export const DEFAULT_TIER: AnalysisTier = "STANDARD";

/** What each tier costs, in half analyses, so half an analysis stays a whole number. */
export const TIER_HALVES: Record<AnalysisTier, number> = { SIMPLE: 0, STANDARD: 0, DEEP: 1, COMPLETE: 2 };

/** Free analyses a student may start in a day, so free tiers cannot fill the analysis queue. */
export const FREE_ANALYSES_PER_DAY = 5;

/** The depth FreeSki writes each tier's explanation at. */
export const TIER_THINKING: Record<AnalysisTier, ThinkingLevel> = { SIMPLE: "none", STANDARD: "low", DEEP: "xhigh", COMPLETE: "xhigh" };

export type TierFeatures = {
  /** Per-turn scores and every measurement. */
  scores: boolean;
  /** Why it happens: the written explanation of each weak movement. */
  explanations: boolean;
  /** The turn-by-turn 3D comparison, key frames and the slow-motion explainer: media read turn by turn. */
  media: boolean;
  /** The run's whole path and the piste's width (read from the same turn media). */
  track: boolean;
  /** The flat force pictures in the movement explanations. */
  diagrams: boolean;
  /** The 3D animated lessons. */
  lessons: boolean;
};

/** Owner's decision, 2026-11-21: standard has no "why" explanations, and the path and force pictures are complete's. */
export const TIER_FEATURES: Record<AnalysisTier, TierFeatures> = {
  SIMPLE: { scores: false, explanations: false, media: false, track: false, diagrams: false, lessons: false },
  STANDARD: { scores: true, explanations: false, media: false, track: false, diagrams: false, lessons: false },
  DEEP: { scores: true, explanations: true, media: true, track: false, diagrams: false, lessons: false },
  COMPLETE: { scores: true, explanations: true, media: true, track: true, diagrams: true, lessons: true },
};

export const isAnalysisTier = (value: unknown): value is AnalysisTier => (ANALYSIS_TIERS as readonly unknown[]).includes(value);
/** A stored tier, read leniently: anything unknown is an older, full analysis. */
export const storedTier = (value: unknown): AnalysisTier => isAnalysisTier(value) ? value : LEGACY_TIER;
export const isFreeTier = (tier: AnalysisTier) => TIER_HALVES[tier] === 0;

/** What a job has cost, in half analyses: the costliest tier paid for. */
export const chargedHalves = (job: { paidTier?: string | null }) => TIER_HALVES[storedTier(job.paidTier)];

/** What moving a job to `next` costs, in half analyses: the difference to what was paid, never a refund. */
export const upgradeHalves = (paidTier: AnalysisTier, next: AnalysisTier) => Math.max(0, TIER_HALVES[next] - TIER_HALVES[paidTier]);

/** The tier paid for after moving to `next`: the costlier of the two, the later one between equals. */
export const paidAfter = (paidTier: AnalysisTier, next: AnalysisTier): AnalysisTier =>
  TIER_HALVES[next] > TIER_HALVES[paidTier] || (TIER_HALVES[next] === TIER_HALVES[paidTier] && ANALYSIS_TIERS.indexOf(next) > ANALYSIS_TIERS.indexOf(paidTier)) ? next : paidTier;

/** Explanation depths a tier may read: its own and the quicker ones. */
export function readableThinking(tier: AnalysisTier): ThinkingLevel[] {
  const top = THINKING_LEVELS.indexOf(TIER_THINKING[tier]);
  return THINKING_LEVELS.filter((_, i) => i <= top);
}

/** Half analyses as the number people read: 0.5, 1, 1.5. */
export const credits = (halves: number) => halves / 2;

/** The start of today in Toronto, where the daily free allowance resets. */
export const startOfTorontoDay = (now = new Date()) => torontoWallTimeToUtc(toDateKey(now), 0);

/** A stored result as far as a tier shows it: below standard no scores or measurements reach the page. */
export function resultForTier<T>(result: T, tier: AnalysisTier): T {
  if (TIER_FEATURES[tier].scores || result === null || typeof result !== "object" || Array.isArray(result)) return result;
  const rest = { ...(result as Record<string, unknown>) };
  delete rest.scorecard;
  // The legacy scorer's cues quote its scores, so they go with them.
  return { ...rest, score: null, metrics: [], coachingZh: [], coachingEn: [] } as T;
}

export const TIER_INFO: Record<AnalysisTier, { zh: string; en: string; gistZh: string; gistEn: string }> = {
  SIMPLE: { zh: "简单", en: "Simple", gistZh: "一段文字：主要的动作问题和怎么调整", gistEn: "A short written summary: the main problem and how to adjust" },
  STANDARD: { zh: "标准", en: "Standard", gistZh: "每个弯打分，给出文字改进方法和 CSIA 练习", gistEn: "Every turn scored, with written fixes and CSIA drills" },
  DEEP: { zh: "深度", en: "Deep", gistZh: "再加每个问题为什么会这样、逐弯 3D 对比、关键帧、慢动作讲解和最深的讲解", gistEn: "Adds why each problem happens, the turn-by-turn 3D comparison, key frames, slow-motion explainer and the deepest explanation" },
  COMPLETE: { zh: "完全", en: "Complete", gistZh: "深度的全部，再加滑行轨迹、受力图和 3D 动作讲解动画", gistEn: "Everything in deep, plus your path, force diagrams and the 3D animated lessons" },
};

/** A price as people read it: free, or how many analyses. */
export function priceLabel(halves: number, zh: boolean) {
  if (halves === 0) return zh ? "免费" : "Free";
  const value = credits(halves);
  return zh ? `${value} 次` : `${value} ${value === 1 ? "credit" : "credits"}`;
}
