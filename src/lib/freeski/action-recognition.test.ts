import { describe, expect, it } from "vitest";
import { correctedActionId, isSubmittableFreeSkiActionId, normalizeFreeSkiCatalog, parseFreeSkiActionId, submittedFreeSkiActionId, upstreamLevels } from "./actions";
import { normalizeFreeSkiResult } from "./adapter";
import { sampleScorecard } from "./scorecard.fixtures";

const recognition = { schema_version: "freeski_action_recognition.v1", model: "forest", turns: 6, status: "recognized", action: "short_turn",
  level: "level3", level_source: "current_level", confidence: .82, alternatives: [{ action: "advanced_parallel", probability: .12 }, { action: "demonstration_parallel", probability: .06 }] };
const upstream = (changes: Record<string, unknown> = {}) => ({ action_name: "short_turn", score_kind: "TECH", overall_score: 70, num_turns: 6,
  coaching_zh: [], coaching_en: [], per_metric_scores: {}, scorer_version: "v3", action_recognition: recognition, ...changes });

describe("leaving the action to FreeSki", () => {
  it("reads the catalog's recognition entry on each path it names, ahead of the actions", () => {
    const options = normalizeFreeSkiCatalog({ rubric_system: "csia", auto: { available: true, action: "auto", paths: ["certification", "improvement"] },
      improvement: { skills: [{ id: "parallel", available: true }] }, certification: { levels: { level2: { actions: ["demonstration_parallel"], availability: { demonstration_parallel: true } } } } });
    expect(options.slice(0, 2).map(option => [option.id, option.available])).toEqual([["auto:improvement", true], ["auto:certification", true]]);
    expect(normalizeFreeSkiCatalog({ rubric_system: "csia", auto: { available: false, action: "auto", paths: ["improvement"] } })).toEqual([]);
  });

  it("asks for the skier's level with a recognised run, and for the exam's level with an exam run", () => {
    expect(parseFreeSkiActionId("auto:improvement:level2")).toMatchObject({ actionName: "auto", pathType: "improvement", currentLevel: "level2", catalogId: "auto:improvement", level: null });
    expect(isSubmittableFreeSkiActionId("auto:certification")).toBe(false);
    expect(isSubmittableFreeSkiActionId("auto:certification:level2")).toBe(true);
    expect(submittedFreeSkiActionId("auto:improvement", "none")).toBe("auto:improvement:none");
    expect(submittedFreeSkiActionId("auto:improvement", null)).toBeNull();
    expect(parseFreeSkiActionId("auto:sideways:level2")).toBeNull();
    // "No level yet" is a skier's level, not an exam.
    expect(isSubmittableFreeSkiActionId("auto:certification:none")).toBe(false);
    expect(submittedFreeSkiActionId("auto:certification", "none")).toBeNull();
    expect(submittedFreeSkiActionId("auto:certification", "level2")).toBe("auto:certification:level2");
    // FreeSki compares a skier with the level above, and an exam run with its own level.
    expect(upstreamLevels(parseFreeSkiActionId("auto:certification:level2")!)).toEqual({ level: "level2", currentLevel: null });
    expect(upstreamLevels(parseFreeSkiActionId("auto:improvement:level2")!)).toEqual({ level: null, currentLevel: "level2" });
    expect(upstreamLevels(parseFreeSkiActionId("certification:level3:short_turn")!)).toEqual({ level: "level3", currentLevel: null });
    expect(upstreamLevels(parseFreeSkiActionId("improvement:none:parallel")!)).toEqual({ level: null, currentLevel: "none" });
  });

  it("keeps the recognised action, its level and the next likeliest with the result", () => {
    // As FreeSki sends it: the certification path's score card has no current level, whatever hint the run was sent with.
    const card = { ...sampleScorecard, action: "short_turn", level: "level3", current_level: null };
    const result = normalizeFreeSkiResult(upstream({ scorecard: card }), "auto:certification:level2");
    expect(result.scorecard).toMatchObject({ action: "short_turn", level: "level3" });
    expect(result.actionRecognition).toEqual({ status: "recognized", reason: null, action: "short_turn", level: "level3", levelSource: "current_level",
      confidence: .82, alternatives: recognition.alternatives, turns: 6 });
    // A fallback names the action it scored and why.
    const fallback = normalizeFreeSkiResult(upstream({ action_name: "demonstration_parallel", action_recognition: { ...recognition, status: "fallback", reason: "too_few_turns",
      action: "demonstration_parallel", confidence: null, alternatives: [] } }), "auto:improvement:level1");
    expect(fallback.actionRecognition).toMatchObject({ status: "fallback", reason: "too_few_turns", confidence: null });
    // A chosen action is never relabelled by a stray recognition.
    expect(normalizeFreeSkiResult(upstream({ action_name: "demonstration_parallel" }), "certification:level2:demonstration_parallel")).not.toHaveProperty("actionRecognition");
  });

  it("re-runs a correction as the skill at the skier's level, or the exam run at the nearest level the guide has", () => {
    expect(correctedActionId("short_turn", "improvement", null, "level1")).toBe("improvement:level1:short_turn");
    expect(correctedActionId("advanced_parallel", "certification", "level3", "level2")).toBe("certification:level3:advanced_parallel");
    expect(correctedActionId("javelin", "certification", "level3", null)).toBe("certification:level4:javelin");
    expect(correctedActionId("demonstration_parallel", "certification", "level2", null)).toBe("certification:level2:demonstration_parallel");
    expect(correctedActionId("invented", "certification", "level2", null)).toBeNull();
  });
});
