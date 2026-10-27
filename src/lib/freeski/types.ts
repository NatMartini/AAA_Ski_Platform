import type { FreeSkiActionId } from "./actions";
import type { Scorecard } from "./scorecard";

export type FreeSkiGradingReason =
  | "wrong-action"
  | "insufficient-turns"
  | "low-confidence"
  | "score-unavailable";

/** Allowlisted result: never contains upstream URLs, paths, video hashes or account data. */
export type FreeSkiAnalysisResult = {
  version: 1;
  provider: "freeski";
  actionId: FreeSkiActionId;
  gradingStatus: "graded" | "unavailable";
  gradingReason: FreeSkiGradingReason | null;
  score: number | null;
  scoreKind: "TECH" | null;
  numTurns: number | null;
  coachingZh: string[];
  coachingEn: string[];
  metrics: { key: string; score: number | null }[];
  scorerVersion: string | null;
  /** Contract v1 scorecard, frozen at settlement; absent on legacy results. */
  scorecard?: Scorecard;
};

export type FreeSkiErrorCode =
  | "analysis-unconfigured"
  | "analysis-unavailable"
  | "analysis-auth-failed"
  | "analysis-invalid-response"
  | "analysis-failed"
  | "analysis-timeout"
  | "analysis-cancelled"
  | "analysis-invalid-video"
  | "analysis-action-closed"
  | "analysis-invalid-action";
