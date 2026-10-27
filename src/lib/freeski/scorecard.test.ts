import { describe, expect, it } from "vitest";
import { citedTeaching, explainerSchema, keyframesSchema, scorecardSchema, scorecardUsable, teachingSchema, turnNumber,
  withoutOverallScore } from "./scorecard";
import { sampleExplainer, sampleKeyframes, sampleScorecard, sampleTeaching } from "./scorecard.fixtures";

// Mutable deep copies of the readonly samples, for building invalid variants.
const clone = (value: unknown) => JSON.parse(JSON.stringify(value));
const estimatedIndex = sampleScorecard.metrics.findIndex(metric => metric.measurement === "estimated");
const targetIndex = sampleScorecard.metrics.findIndex(metric => metric.presentation === "target");
const usedIndex = sampleScorecard.turns.findIndex(turn => turn.used_in_overall);

describe("scorecard contract v1.1", () => {
  it("accepts FreeSki's published sample as a usable score", () => {
    const card = scorecardSchema.parse(sampleScorecard);
    expect(card).toMatchObject({ level: "level2", overall: { score: sampleScorecard.overall.score, aggregation: "middle_turns_mean" } });
    expect(scorecardUsable(card)).toBe(true);
    // Turns failing the evidence gate are listed but carry no score.
    for (const turn of card.turns.filter(item => item.evidence?.status === "insufficient"))
      expect(turn).toMatchObject({ score: null, used_in_overall: false, metrics: [] });
  });
  it("keeps the scoring version and calibration fingerprint so stored scores stay comparable", () => {
    const card = scorecardSchema.parse(sampleScorecard);
    expect(card.calibration.scoring_version).toBe(sampleScorecard.calibration.scoring_version);
    expect(card.calibration.calibration_id).toBe(sampleScorecard.calibration.calibration_id);
    expect(card.calibration.reference_target).toBe(sampleScorecard.calibration.reference_target);
    const legacy = clone(sampleScorecard);
    delete legacy.calibration.scoring_version;
    delete legacy.calibration.calibration_id;
    delete legacy.calibration.reference_target;
    expect(scorecardSchema.safeParse(legacy).success).toBe(true);
    const unknown = clone(sampleScorecard);
    unknown.calibration.reference_target = "level9";
    expect(scorecardSchema.safeParse(unknown).success).toBe(false);
  });
  it("keeps the skier's current level from an improvement request and rejects unknown values", () => {
    const improvement = { ...clone(sampleScorecard), level: null, current_level: "level1" };
    expect(scorecardSchema.parse(improvement).current_level).toBe("level1");
    expect(scorecardSchema.parse({ ...improvement, current_level: "none" }).current_level).toBe("none");
    expect(scorecardSchema.parse({ ...improvement, current_level: null }).current_level).toBeNull();
    expect(scorecardSchema.safeParse({ ...improvement, current_level: "expert" }).success).toBe(false);
  });
  it("normalizes a native bare-digit level and rejects unknown levels", () => {
    expect(scorecardSchema.parse({ ...clone(sampleScorecard), level: "2" }).level).toBe("level2");
    expect(scorecardSchema.safeParse({ ...clone(sampleScorecard), level: "level9" }).success).toBe(false);
  });
  it("shows estimated metrics but never scores them or publishes raw image-plane values", () => {
    const weighted = clone(sampleScorecard);
    weighted.metrics[estimatedIndex].weight = .1;
    expect(scorecardSchema.safeParse(weighted).success).toBe(false);
    const raw = clone(sampleScorecard);
    raw.metrics[estimatedIndex] = { ...raw.metrics[estimatedIndex], value: 35, unit: "deg" };
    expect(scorecardSchema.safeParse(raw).success).toBe(false);
  });
  it("rejects the superseded best-turns aggregation", () => {
    const card = clone(sampleScorecard);
    card.overall.aggregation = "best_turns_mean";
    expect(scorecardSchema.safeParse(card).success).toBe(false);
  });
  it("never counts start or end turns toward the overall score", () => {
    const card = clone(sampleScorecard);
    card.turns[usedIndex].role = "start";
    expect(scorecardSchema.safeParse(card).success).toBe(false);
    card.turns[usedIndex].used_in_overall = false;
    expect(scorecardSchema.safeParse(card).success).toBe(true);
  });
  it("requires insufficient quality to carry no overall score, and the reverse", () => {
    const insufficient = { ...clone(sampleScorecard), quality: "insufficient" };
    expect(scorecardSchema.safeParse(insufficient).success).toBe(false);
    const empty = scorecardSchema.parse({ ...insufficient, overall: { ...sampleScorecard.overall, score: null } });
    expect(scorecardUsable(empty)).toBe(false);
  });
  it("rejects weights that do not sum to one and duplicate metrics", () => {
    const card = clone(sampleScorecard);
    card.metrics[0].weight += .2;
    expect(scorecardSchema.safeParse(card).success).toBe(false);
    const duplicate = clone(sampleScorecard);
    duplicate.metrics.push(duplicate.metrics[0]);
    expect(scorecardSchema.safeParse(duplicate).success).toBe(false);
  });
  it("requires a target zone for scored bell metrics and keeps slider positions off bar metrics", () => {
    const missing = clone(sampleScorecard);
    missing.metrics[targetIndex].target = null;
    expect(scorecardSchema.safeParse(missing).success).toBe(false);
    // The standard example may lack the metric entirely: no zone, no score, no weight.
    const absent = clone(sampleScorecard);
    const weight = absent.metrics[targetIndex].weight;
    absent.metrics[targetIndex] = { ...absent.metrics[targetIndex], target: null, position: null, score: null, band: null, weight: 0 };
    absent.metrics[0].weight += weight;
    expect(scorecardSchema.safeParse(absent).success).toBe(true);
    const bar = clone(sampleScorecard);
    bar.metrics[0] = { ...bar.metrics[0], presentation: "bar", position: 50 };
    expect(scorecardSchema.safeParse(bar).success).toBe(false);
  });
  it("numbers turns from one for display", () => {
    expect(turnNumber("turn_0")).toBe(1);
    expect(turnNumber("turn_6")).toBe(7);
    expect(turnNumber("../turn_1")).toBeNull();
  });
});

describe("per-turn evidence gate", () => {
  const excludeLast = (patch: Record<string, unknown> = {}) => {
    const card = clone(sampleScorecard);
    const last = card.turns.length - 1;
    card.quality_reasons = ["excluded_turns"];
    card.overall.turns_excluded = 1;
    card.overall.turns_used = last;
    card.turns[last] = { ...card.turns[last], score: null, used_in_overall: false, metrics: [],
      evidence: { status: "insufficient", reasons: ["out_of_frame"] }, ...patch };
    return card;
  };
  it("accepts an excluded turn that carries no score, metrics or weight in the overall", () => {
    expect(scorecardSchema.safeParse(excludeLast()).success).toBe(true);
  });
  it.each([{ score: 40 }, { used_in_overall: true }, { metrics: [{ key: "parallel_skis", score: 1, band: "below" }] }])(
    "rejects an excluded turn that still scores: %j", patch => {
      expect(scorecardSchema.safeParse(excludeLast(patch)).success).toBe(false);
    });
  it("rejects unknown evidence reasons", () => {
    expect(scorecardSchema.safeParse(excludeLast({ evidence: { status: "insufficient", reasons: ["blurry"] } })).success).toBe(false);
  });
});

describe("withheld overall score in teaching", () => {
  const teaching = () => teachingSchema.parse(sampleTeaching);
  it("hides a summary or conclusion that quotes the overall score", () => {
    const base = teaching();
    const total = sampleScorecard.overall.score!;
    const quoted = withoutOverallScore({ ...base, summary_zh: `整体评分${total.toFixed(1)}，节奏不错。`, summary_en: "Overall score 58.4.",
      strengths: [...base.strengths, { ...base.strengths[0], text_zh: `总分 ${total.toFixed(1)}` }] }, total);
    expect(quoted.summary_zh).toBe("");
    expect(quoted.summary_en).toBe("");
    expect(quoted.strengths).toHaveLength(base.strengths.length);
  });
  it("keeps per-metric and per-turn scores", () => {
    const base = teaching();
    expect(withoutOverallScore(base, sampleScorecard.overall.score!).improvements).toHaveLength(base.improvements.length);
  });
});

describe("teaching contract", () => {
  it("keeps the sample's cited conclusions", () => {
    const teaching = citedTeaching(teachingSchema.parse(sampleTeaching));
    expect(teaching.improvements).toHaveLength(sampleTeaching.improvements.length);
    expect(teaching.strengths).toHaveLength(sampleTeaching.strengths.length);
    expect(teaching.drills).toHaveLength(sampleTeaching.drills.length);
  });
  it("drops conclusions without citations, with unknown facts, or carrying links", () => {
    const raw = clone(sampleTeaching);
    raw.strengths.push({ ...raw.strengths[0], fact_ids: [] });
    raw.improvements.push({ ...raw.improvements[0], fact_ids: ["f_invented"] });
    raw.drills[0] = { ...raw.drills[0], why_en: "See http://example.com/drill" };
    raw.summary_en = "Details at C:\\private\\report.json";
    const teaching = citedTeaching(teachingSchema.parse(raw));
    expect(teaching.strengths).toHaveLength(sampleTeaching.strengths.length);
    expect(teaching.improvements).toHaveLength(sampleTeaching.improvements.length);
    expect(teaching.drills).toHaveLength(0);
    expect(teaching.summary_en).toBe("");
  });
  it("removes citation ids the model echoed into the prose", () => {
    const raw = clone(sampleTeaching);
    const [first, second] = raw.facts.map((item: { fact_id: string }) => item.fact_id);
    raw.summary_zh = `站距稳定在范围内（${first}）。`;
    raw.strengths[0] = { ...raw.strengths[0], text_zh: `站距稳定得分 97.0 (${first})。`, text_en: `Stance scored 97.0 (${first}).`, fact_ids: [first] };
    raw.drills[0] = { ...raw.drills[0], why_zh: `针对旋转和平行 (${first}, ${second})。`, fact_ids: [first, second] };
    const teaching = citedTeaching(teachingSchema.parse(raw));
    expect(teaching.summary_zh).toBe("站距稳定在范围内。");
    expect(teaching.strengths[0]).toMatchObject({ text_zh: "站距稳定得分 97.0。", text_en: "Stance scored 97.0.", fact_ids: [first] });
    expect(teaching.drills[0].why_zh).toBe("针对旋转和平行。");
  });
  it("rejects an unknown schema version instead of guessing fields", () => {
    expect(teachingSchema.safeParse({ ...clone(sampleTeaching), schema_version: "freeski_teaching.v2" }).success).toBe(false);
  });
});

describe("keyframes contract", () => {
  it("accepts the sample and rejects duplicate or malformed keyframe ids", () => {
    expect(keyframesSchema.parse(sampleKeyframes).items).toHaveLength(3);
    expect(keyframesSchema.parse(sampleKeyframes).items[0].reference_status).toBe(sampleKeyframes.items[0].reference_status);
    const unknown = clone(sampleKeyframes);
    unknown.items[0].reference_status = "guessed";
    expect(keyframesSchema.safeParse(unknown).success).toBe(false);
    const duplicate = clone(sampleKeyframes);
    duplicate.items.push(duplicate.items[0]);
    expect(keyframesSchema.safeParse(duplicate).success).toBe(false);
    const malformed = clone(sampleKeyframes);
    malformed.items[0].keyframe_id = "../secret";
    expect(keyframesSchema.safeParse(malformed).success).toBe(false);
  });
});

describe("explainer contract", () => {
  it("accepts the sample storyboard", () => {
    const explainer = explainerSchema.parse(sampleExplainer);
    expect(explainer.segments?.map(segment => segment.kind)).toContain("freeze");
  });
  it("accepts turns without a standard example", () => {
    const explainer = clone(sampleExplainer);
    explainer.reference = "not_available";
    explainer.reference_status = Object.fromEntries(Object.keys(explainer.reference_status ?? { turn_0: "" }).map(id => [id, "not_available"]));
    expect(explainerSchema.safeParse(explainer).success).toBe(true);
  });
  it("accepts a pending manifest without media fields but not an incomplete ready one", () => {
    expect(explainerSchema.safeParse({ schema_version: "freeski_explainer.v1", status: "pending" }).success).toBe(true);
    expect(explainerSchema.safeParse({ schema_version: "freeski_explainer.v1", status: "ready" }).success).toBe(false);
  });
  it("rejects segments that run past the video or have no length", () => {
    const late = clone(sampleExplainer);
    late.segments.at(-1).end_sec = late.duration_sec + 5;
    expect(explainerSchema.safeParse(late).success).toBe(false);
    const empty = clone(sampleExplainer);
    empty.segments[0].end_sec = empty.segments[0].start_sec;
    expect(explainerSchema.safeParse(empty).success).toBe(false);
  });
});
