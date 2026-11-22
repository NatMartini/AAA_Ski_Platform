import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { coachingReportSchema } from "@/lib/freeski/report-v2";
import { explainerSchema, keyframesSchema, scorecardSchema } from "@/lib/freeski/scorecard";
import { windowEdge } from "@/lib/freeski/standard-motion";
import { normalizeFreeSkiResult } from "@/lib/freeski/adapter";
import jobResult from "@/lib/freeski/fixtures/report-contract-v8/job-result.json";
import rawReport from "@/lib/freeski/fixtures/report-contract-v8/report.json";
import rawKeyframes from "@/lib/freeski/fixtures/report-contract-v8/keyframes.json";
import rawExplainer from "@/lib/freeski/fixtures/report-contract-v8/explainer.json";
import { cameraViewNote, ComparisonNotes, comparesWithStandard, exampleName, standardNote } from "./analysis-scorecard";
import { CoachingReportView } from "./dynamic-coaching-report";

vi.mock("@/i18n/navigation", () => ({ Link: (props: ComponentProps<"a">) => createElement("a", props) }));

// FreeSki's samples from score card 8 (2026-11-12): demonstration_parallel L2 compared with the generated L2 standard,
// turns cut from edge change to edge change; the official pass demonstration scores 61.6 by the same method.
const report = coachingReportSchema.parse(rawReport);
const card = report.scorecard!;
const render = (zh = true) => renderToStaticMarkup(createElement(CoachingReportView, {
  base: "/api/video-analysis/reports/account/job8", zh, report, card, reviews: { canReview: false, reviews: [] } }));

describe("score card 8: compared with the generated standard motion", () => {
  it("keeps what the comparison was, and what a pass scores against it", () => {
    expect(scorecardSchema.parse(jobResult.result.scorecard).calibration).toMatchObject({ reference_kind: "generated_standard", turn_cut: "edge_change.v1",
      standard: { id: "demonstration_parallel-l2", level: 2, source_clips: 1, source_turns: 25 }, pass_demonstration: { score: 61.6 }, standard_own: { score: 88.8 } });
    expect(normalizeFreeSkiResult(jobResult.result, "certification:level2:demonstration_parallel").scorecard?.calibration.pass_demonstration?.score).toBe(61.6);
    expect(card.camera_view).toBe("front");
    expect(card.turns.find(turn => turn.turn_id === "turn_3")).toMatchObject({ camera_view: "front", role: "middle", apex_ms: 4267 });
    expect(comparesWithStandard(card)).toBe(true);
    expect(exampleName("level2", card)).toEqual(["CSIA 2 级标准动作", "the CSIA level 2 standard"]);
    // A score card from before keeps the old name.
    expect(exampleName("level2", { calibration: { ...card.calibration, reference_kind: undefined } })).toEqual(["CSIA 2 级通过示范", "CSIA level 2 pass examples"]);
  });

  it("says what was compared and gives the pass demonstration's score as the reference", () => {
    const html = render();
    expect(html).toContain("达到 CSIA 2 级标准动作的范围");
    expect(html).toContain("参照：CSIA 2 级官方通过示范按同样方法打分是 62 分，你的弯分可以先和它比。");
    expect(html).toContain("对比 CSIA 2 级标准动作");
    expect(html).not.toContain("通过示范的常见水平");
    // The notes on the comparison, opened from the report header.
    const notes = renderToStaticMarkup(createElement(ComparisonNotes, { card, zh: true }));
    expect(notes).toContain("对比 CSIA 2 级标准动作（由 1 段官方示范、25 个弯生成）");
    expect(notes).toContain("参照：CSIA 2 级官方通过示范按同样方法打分是 62 分");
    expect(notes).toContain("机位：正面（FreeSki 从画面估计）。");
    expect(cameraViewNote({ camera_view: "left_side" }, true)).toContain("侧面拍的弯有些指标不准");
    expect(cameraViewNote({ camera_view: "unknown" }, true)).toBeNull();
    expect(cameraViewNote({}, false)).toBeNull();
    expect(html).not.toContain("示范常见范围");
    const en = render(false);
    expect(en).toContain("within the range of the CSIA level 2 standard");
    expect(en).toContain("the official CSIA level 2 pass demonstration scores 62 by the same method");
  });

  it("takes an edge-change window's start as the edge change, and searches only older windows", () => {
    expect(windowEdge({ startMs: 1100, endMs: 2467, edgeChangeMs: null, turnSegmentation: "edge_change" })).toBe(1.1);
    expect(windowEdge({ startMs: 1100, endMs: 2467, edgeChangeMs: 1800, turnSegmentation: "hip_sway" })).toBe(1.8);
    expect(windowEdge({ startMs: 1100, endMs: 2467, edgeChangeMs: 3000 })).toBeNull();
    expect(windowEdge({ startMs: 1100, endMs: 2467 })).toBeNull();
  });

  it("names the standard v2 key frames and the explainer draw", () => {
    expect(keyframesSchema.parse(rawKeyframes).items.map(item => item.standard_id)).toEqual(Array(3).fill("demonstration_parallel-l2"));
    expect(explainerSchema.parse(rawExplainer).standard).toEqual({ id: "demonstration_parallel-l2", turns: { turn_3: true, turn_4: true, turn_5: true } });
    expect(standardNote("demonstration_parallel-l2", true, false)).toBe("画面旁边并排画你和 CSIA 2 级标准动作（按指南和示范生成，不是真人），按换刃和弯顶对齐。");
    expect(standardNote("short_turn-l4", false, true)).toContain("the CSIA level 4 standard");
    expect(standardNote("short_turn-l4", false, true)).toContain("some turns show no standard");
  });
});
