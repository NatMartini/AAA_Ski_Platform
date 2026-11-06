import { describe, expect, it } from "vitest";
import { scorecardSchema, type Scorecard } from "./scorecard";
import { sampleScorecard } from "./scorecard.fixtures";
import { comparableScorecards, metricConfidence, metricDelta, metricInsight, metricStanding, perTurnScores, standingCounts, worstTurnFor } from "./metric-insight";

const card = () => scorecardSchema.parse(sampleScorecard);
const direct = (c: Scorecard) => c.metrics.find(metric => metric.measurement === "direct" && metric.score !== null)!;

describe("metric insight", () => {
  it("explains every scored metric in plain words with the body lines it uses", () => {
    for (const metric of card().metrics) {
      const insight = metricInsight(metric.key);
      expect(insight, metric.key).not.toBeNull();
      expect(insight!.zh.length).toBeGreaterThan(8);
      expect(insight!.lines.length > 0 || insight!.hipPath).toBe(true);
    }
    expect(metricInsight("made_up")).toBeNull();
  });

  it("counts a bar metric above its range as good, but a bell metric only inside its zone", () => {
    const c = card();
    const standing = (key: string) => metricStanding(c.metrics.find(metric => metric.key === key)!);
    expect(standing("parallel_skis")).toBe("good");
    expect(standing("upper_body_quiet_index")).toBe("good");
    expect(standing("rotation_rate")).toBe("work");
    expect(standing("turn_tempo")).toBe("good");
    expect(standing("edge_angle")).toBe("estimated");
    const below = { ...c.metrics.find(metric => metric.key === "parallel_skis")!, band: "below" as const };
    expect(metricStanding(below)).toBe("work");
    expect(metricStanding({ ...below, score: null })).toBe("none");
    expect(standingCounts(c)).toEqual({ good: 6, work: 1, estimated: 2, none: 0 });
  });

  it("finds the counted turn where a metric scored lowest, ignoring unscored and start turns", () => {
    const c = card();
    const key = direct(c).key;
    const scores = perTurnScores(c, key);
    expect(scores.map(entry => entry.turnId)).toEqual(c.turns.map(turn => turn.turn_id));
    const worst = worstTurnFor(c, key);
    const counted = scores.filter(entry => entry.counted && entry.score !== null);
    expect(worst).toBe(counted.reduce((low, entry) => entry.score! < low.score! ? entry : low).turnId);
    const uncounted: Scorecard = { ...c, turns: c.turns.map(turn => ({ ...turn, used_in_overall: false })) };
    expect(worstTurnFor(uncounted, key)).toBeNull();
  });

  it("lowers confidence for estimates, thin evidence, single demonstrations and poor footage", () => {
    const c = card();
    const estimated = c.metrics.find(metric => metric.measurement === "estimated");
    if (estimated) expect(metricConfidence(c, estimated).level).toBe("low");
    const solid: Scorecard = { ...c, quality: "valid", quality_reasons: [], calibration: { ...c.calibration, matched_reference_count: 4 } };
    expect(metricConfidence(solid, direct(solid)).level).toBe(c.overall.turns_used >= 5 ? "high" : "medium");
    const single: Scorecard = { ...solid, calibration: { ...solid.calibration, matched_reference_count: 1 } };
    expect(metricConfidence(single, direct(single))).toMatchObject({ level: "medium" });
    expect(metricConfidence(single, direct(single)).reasons.map(reason => reason[0])).toContain("只有 1 段示范可比");
    const poor: Scorecard = { ...solid, quality: "insufficient" };
    expect(metricConfidence(poor, direct(poor)).level).toBe("low");
  });

  it("compares scorecards only when the same scoring and references produced them", () => {
    const c = card();
    expect(comparableScorecards(c, c)).toBe(true);
    expect(comparableScorecards(c, { ...c, calibration: { ...c.calibration, scoring_version: "freeski-scorecard-1" } })).toBe(false);
    expect(comparableScorecards(c, { ...c, action: "carving" })).toBe(false);
    const key = direct(c).key;
    const earlier: Scorecard = { ...c, metrics: c.metrics.map(metric => metric.key === key ? { ...metric, score: metric.score! - 7.4 } : metric) };
    expect(metricDelta(c, earlier, key)).toBe(7);
    expect(metricDelta(c, null, key)).toBeNull();
    expect(metricDelta(c, { ...earlier, action: "carving" }, key)).toBeNull();
  });
});
