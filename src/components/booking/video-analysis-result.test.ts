import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readAnalysisResult, VideoAnalysisResult } from "./video-analysis-result";
import { AnalysisScorecard, referenceNote, turnLabel } from "./analysis-scorecard";
import { AnalysisTeaching } from "./analysis-teaching";
import { citedTeaching, scorecardSchema, teachingSchema } from "@/lib/freeski/scorecard";
import { sampleImprovementActionId, sampleImprovementJobResult, sampleScorecard, sampleTeaching } from "@/lib/freeski/scorecard.fixtures";

const graded = { version: 1, provider: "freeski", gradingStatus: "graded", scoreKind: "TECH", score: 0,
  gradingReason: null, coachingZh: ["保持重心稳定"], coachingEn: ["Keep your balance centered"] };

describe("safe video analysis result display", () => {
  it("preserves a real technical zero and useful coaching", () => {
    const html = renderToStaticMarkup(createElement(VideoAnalysisResult, { result: graded, locale: "en" }));
    expect(html).toContain("Technical score");
    expect(html).toContain(">0</span>");
    expect(html).toContain("Keep your balance centered");
    expect(html).not.toContain("A score is unavailable");
  });
  it.each([
    { ...graded, scoreKind: "WRONG_ACTION", score: 70, gradingReason: "wrong-action" },
    { ...graded, gradingStatus: "unavailable", score: 70 },
    { ...graded, score: null },
    { ...graded, score: NaN },
    { ...graded, score: Infinity },
    { ...graded, score: -1 },
    { ...graded, score: 101 },
    null,
  ])("never presents ungradable or invalid evidence as a score: %j", (result) => {
    const html = renderToStaticMarkup(createElement(VideoAnalysisResult, { result, locale: "en" }));
    expect(html).toContain("A score is unavailable for this analysis. No credit is used.");
    expect(html).not.toContain("Technical score:");
    expect(html).not.toContain(">0</span>");
  });
  it.each(["zh", "en"] as const)("explains insufficient turns and preserves feedback in %s", (locale) => {
    const html = renderToStaticMarkup(createElement(VideoAnalysisResult, { result: { ...graded, gradingStatus: "unavailable", score: null, gradingReason: "insufficient-turns" }, locale }));
    expect(html).toContain(locale === "zh" ? "有效滑行片段或转弯次数不足" : "not enough usable turns");
    expect(html).toContain(locale === "zh" ? "保持重心稳定" : "Keep your balance centered");
  });
  it("reads only typed display fields and ignores malformed feedback entries", () => {
    expect(readAnalysisResult({ ...graded, coachingZh: ["valid", { text: "invalid" }, 12], coachingEn: false })).toEqual(expect.objectContaining({ coachingZh: ["valid"], coachingEn: [] }));
    expect(readAnalysisResult([])).toBeNull();
  });
  it("renders malicious feedback as escaped text without HTML execution", () => {
    const html = renderToStaticMarkup(createElement(VideoAnalysisResult, { result: { ...graded, coachingEn: ["<img src=x onerror=alert(1)>", "<script>alert(1)</script>"] }, locale: "en" }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
  });
  it("shows valid turn count and metric zeros, while rejecting malformed and non-finite evidence", () => {
    const html = renderToStaticMarkup(createElement(VideoAnalysisResult, { locale: "zh", result: { ...graded, numTurns: 4,
      metrics: [{ key: "parallel_skis", score: 0 }, { key: "turn_tempo", score: NaN }, { key: "turn_closure", score: 101 },
        { key: "<svg onload=x>", score: 80 }, { key: "rotation_rate", score: 61.6 }] } }));
    expect(html).toContain("有效转弯：4 次");
    expect(html).toContain("双板平行"); expect(html).toContain("0 / 100");
    expect(html).toContain("61.6 / 100"); expect(html).toContain("暂无评分");
    expect(html).not.toContain("NaN"); expect(html).not.toContain("101 / 100"); expect(html).not.toContain("onload");
    const unavailable = renderToStaticMarkup(createElement(VideoAnalysisResult, { locale: "en", result: { ...graded,
      gradingStatus: "unavailable", metrics: [{ key: "parallel_skis", score: 99 }], numTurns: 4 } }));
    expect(unavailable).not.toContain("Technique metrics"); expect(unavailable).not.toContain("99 / 100");
  });
});

describe("contract scorecard and teaching display", () => {
  const card = () => JSON.parse(JSON.stringify(sampleScorecard));
  it("shows the comparison without any overall score until it is validated", () => {
    const html = renderToStaticMarkup(createElement(VideoAnalysisResult, { locale: "zh",
      result: { ...graded, score: 80, coachingZh: ["旧 TECH 提示 得分 55.9"], scorecard: sampleScorecard } }));
    const quality = { valid: "数据完整", approximate: "数据有限", insufficient: "数据不足" }[sampleScorecard.quality];
    const first = sampleScorecard.turns.find(turn => turn.used_in_overall)!;
    expect(html).toContain("FreeSki 动作对比");
    expect(html).toContain("总分暂不显示");
    // Quality reasons must not point at the withheld overall score either.
    expect(html).not.toContain("总分参考价值");
    expect(html).toContain(quality);
    expect(html).toContain(`对比 ${sampleScorecard.calibration.matched_reference_count} 段 CSIA ${sampleScorecard.calibration.reference_target.slice(-1)} 级通过示范 · ${sampleScorecard.overall.turns_used} 个中间弯`);
    expect(html).not.toContain("技术提升按专家示范对比");
    expect(html).toContain("视频估算 · 不计分");
    expect(html).toContain("在示范常见范围内");
    expect(html).toContain(`${turnLabel(first.turn_id, true)}${first.direction === "right" ? "（右）" : "（左）"} · ${Math.round(first.score!)}`);
    for (const turn of scorecardSchema.parse(sampleScorecard).turns.filter(item => item.evidence?.reasons.includes("subject_small")))
      expect(html).toContain(`${turnLabel(turn.turn_id, true)}${turn.direction === "right" ? "（右）" : "（左）"} · 证据不足（人太小`);
    expect(html).toContain("换刃同步（估算）");
    expect(html).toContain("只对比视频能测量的 CSIA 考核要求");
    expect(html).not.toContain("需要传感器");
    expect(html).not.toContain(String(Math.round(sampleScorecard.overall.score!)) + "</span>");
    // A distinctive total, since the sample's own may coincide with a metric or turn score.
    const marked = renderToStaticMarkup(createElement(AnalysisScorecard, { card: scorecardSchema.parse({ ...card(),
      overall: { ...sampleScorecard.overall, score: 63.27 } }), zh: true }));
    expect(marked).not.toMatch(/63\.27|63\.3/);
    expect(html).not.toContain("技术评分");
    expect(html).not.toContain(">80</span>");
    expect(html).not.toContain("旧 TECH 提示");
  });
  it("still shows the TECH score on legacy jobs without a scorecard", () => {
    const html = renderToStaticMarkup(createElement(VideoAnalysisResult, { locale: "zh", result: { ...graded, score: 80 } }));
    expect(html).toContain("技术评分");
    expect(html).toContain(">80</span>");
  });
  it("shows the comparison, not the TECH score, when only TECH settled the credit", () => {
    const insufficient = { ...card(), quality: "insufficient", overall: { ...sampleScorecard.overall, score: null } };
    const html = renderToStaticMarkup(createElement(VideoAnalysisResult, { locale: "zh", result: { ...graded, score: 80, scorecard: insufficient } }));
    expect(html).toContain("FreeSki 动作对比");
    expect(html).toContain("数据不足");
    expect(html).not.toContain(">80</span>");
  });
  it("marks turns without enough visual evidence instead of scoring them", () => {
    const value = card();
    value.quality_reasons = ["excluded_turns"];
    value.overall.turns_excluded = 1;
    value.overall.turns_used = value.turns.length - 1;
    const last = value.turns.length - 1;
    value.turns[last] = { ...value.turns[last], score: null, used_in_overall: false, metrics: [],
      evidence: { status: "insufficient", reasons: ["out_of_frame", "tracking_lost"] } };
    const html = renderToStaticMarkup(createElement(AnalysisScorecard, { card: scorecardSchema.parse(value), zh: true }));
    expect(html).toContain(`第 ${last + 1} 弯（右） · 证据不足（出画或贴边、跟踪丢失）`);
    expect(html).toContain("部分弯的画面不足以测量，没有打分");
  });
  it("asks the skier to confirm turns where the tracker re-identified them", () => {
    const value = card();
    const used = value.turns.findIndex((turn: { used_in_overall: boolean }) => turn.used_in_overall);
    value.turns[used].evidence = { ...value.turns[used].evidence, reacquired: true };
    value.quality = "approximate";
    value.quality_reasons = [...value.quality_reasons, "subject_reacquired"];
    const html = renderToStaticMarkup(createElement(AnalysisScorecard, { card: scorecardSchema.parse(value), zh: true }));
    expect(html).toContain(`${turnLabel(value.turns[used].turn_id, true)}`);
    expect(html).toContain(" · 重新识别</li>");
    expect(html).toContain("标“重新识别”的弯：中途重新识别了滑雪者，请确认画面中是你。");
    expect(html).toContain("中途重新识别了滑雪者，标“重新识别”的弯请确认画面中是你");
    const plain = renderToStaticMarkup(createElement(AnalysisScorecard, { card: scorecardSchema.parse(sampleScorecard), zh: true }));
    expect(plain).not.toContain("重新识别");
  });
  it("places bell metrics on the slider by position, not by score", () => {
    const html = renderToStaticMarkup(createElement(AnalysisScorecard, { card: scorecardSchema.parse(sampleScorecard), zh: false }));
    const rotation = sampleScorecard.metrics.find(metric => metric.key === "rotation_rate")!;
    expect(html).toContain(`left:${rotation.position}%`);
    expect(html).toContain(`aria-valuenow="${rotation.position}"`);
  });
  it("never shows raw values for estimated metrics", () => {
    const html = renderToStaticMarkup(createElement(AnalysisScorecard, { card: scorecardSchema.parse(sampleScorecard), zh: false }));
    const parallel = sampleScorecard.metrics.find(metric => metric.key === "parallel_skis")!;
    expect(html).toContain(`Yours: ${Math.round(parallel.value!)}%`);
    const estimated = html.slice(html.indexOf("Edge angle"));
    expect(estimated.slice(0, estimated.indexOf("</div></div>"))).not.toContain("Yours:");
  });
  it("labels start and end turns and says they are not counted", () => {
    const value = card();
    value.turns[0] = { ...value.turns[0], role: "start", used_in_overall: false };
    const html = renderToStaticMarkup(createElement(AnalysisScorecard, { card: scorecardSchema.parse(value), zh: true }));
    expect(html).toContain("第 1 弯·启动弯");
    expect(html).toContain("启动弯和结束弯单独列出");
    expect(html).not.toContain("总分 ");
  });
  it("names the example set FreeSki actually compared with", () => {
    const render = (level: string | null, target?: string | null) => {
      const value = { ...card(), level };
      if (target === undefined) delete value.calibration.reference_target;
      else value.calibration.reference_target = target;
      return renderToStaticMarkup(createElement(AnalysisScorecard, { card: scorecardSchema.parse(value), zh: true }));
    };
    const count = sampleScorecard.calibration.matched_reference_count;
    const expert = render(null, "expert");
    expect(expert).toContain(`对比 ${count} 段专家级示范`);
    expect(expert).toContain("技术提升按专家示范对比");
    expect(render(null, "advanced")).toContain("技术提升按进阶示范对比");
    // The selected level had no example, so FreeSki used the nearest one.
    const nearest = render("level2", "level3");
    expect(nearest).toContain(`对比 ${count} 段 CSIA 3 级通过示范`);
    expect(nearest).not.toContain("技术提升");
    expect(render("level2", "all_pass_levels")).toContain("段各级通过示范");
    // Scorecards from before the field existed fall back to the submitted level.
    expect(render(null)).toContain(`对比 ${count} 段专家级示范`);
    expect(render("level2")).toContain(`对比 ${count} 段 CSIA 2 级通过示范`);
  });
  it("tells a skier who gave their level which examples the improvement path used", () => {
    const render = (currentLevel: "none" | "level2" | "level4", target: string, zh = true) => {
      const value = { ...card(), level: null };
      value.calibration.reference_target = target;
      return renderToStaticMarkup(createElement(AnalysisScorecard, { card: scorecardSchema.parse(value), zh, currentLevel }));
    };
    const next = render("level2", "level3");
    expect(next).toContain("你目前是 CSIA 2 级，技术提升这次对比 CSIA 3 级通过示范，分数表示离这个水平还有多远。");
    expect(next).not.toContain("请选 CSIA 考证动作");
    expect(render("none", "level1")).toContain("你还没考 CSIA 级别，技术提升这次对比 CSIA 1 级通过示范");
    const top = render("level4", "expert");
    expect(top).toContain("你目前是 CSIA 4 级，技术提升这次对比专家示范");
    expect(top).not.toContain("技术提升按专家示范对比");
    expect(render("level2", "level3", false)).toContain("You are currently CSIA level 2; this improvement analysis compares you with CSIA level 3 pass examples");
    // The level travels in the stored action id.
    const html = renderToStaticMarkup(createElement(VideoAnalysisResult, { locale: "zh",
      result: { ...graded, actionId: "improvement:level2:short_turn", scorecard: { ...card(), level: null } } }));
    expect(html).toContain("你目前是 CSIA 2 级");
    expect(readAnalysisResult({ ...graded, actionId: "parallel" })?.currentLevel).toBeNull();
    // Only a level 4 skier without expert examples falls back, so the reason names that fallback.
    const fallback = { ...card(), level: null, quality_reasons: ["no_matching_reference"] };
    fallback.calibration.reference_target = "advanced";
    const advanced = renderToStaticMarkup(createElement(AnalysisScorecard, { card: scorecardSchema.parse(fallback), zh: true, currentLevel: "level4" }));
    expect(advanced).toContain("这个动作没有专家示范，改用进阶示范对比");
    expect(advanced).not.toContain("用了最接近的级别对比");
  });
  it("shows FreeSki's improvement sample as a comparison one level up", () => {
    const html = renderToStaticMarkup(createElement(VideoAnalysisResult, { locale: "zh", result: { ...graded,
      actionId: sampleImprovementActionId, scorecard: sampleImprovementJobResult.result.scorecard } }));
    expect(html).toContain("你目前是 CSIA 1 级，技术提升这次对比 CSIA 2 级通过示范");
    expect(html).toContain("对比 1 段 CSIA 2 级通过示范");
  });
  it("lists nothing video cannot measure, even if FreeSki names it", () => {
    const html = renderToStaticMarkup(createElement(AnalysisScorecard, { card: scorecardSchema.parse({ ...card(),
      unavailable_metrics: ["g_force", "weight_release"] }), zh: true }));
    expect(html).not.toContain("G 力");
    expect(html).not.toContain("g force");
    expect(html).not.toContain("weight release");
  });
  it("names the standard skeleton by its review status", () => {
    expect(referenceNote(["auto_matched_unreviewed", "auto_matched_unreviewed"], true)).toBe("橙色骨架是你；绿色骨架是自动匹配的 CSIA 示范（未审核）。");
    expect(referenceNote(["not_available"], true)).toBe("橙色骨架是你；没有匹配的标准动作，只画你自己的骨架。");
    expect(referenceNote(["reviewed_platform_reference", "not_available"], true))
      .toBe("橙色骨架是你；部分弯绿色骨架是审核过的标准动作，部分弯没有匹配的标准动作，只画你自己的骨架。");
    expect(referenceNote([], true)).toBe("");
    // With the scorecard's target, an automatic match is named like FreeSki's captions.
    expect(referenceNote(["auto_matched_unreviewed"], true, "level2")).toBe("橙色骨架是你；绿色骨架是自动匹配的 CSIA 2 级通过示范（未审核）。");
    expect(referenceNote(["auto_matched_unreviewed"], true, "expert")).toBe("橙色骨架是你；绿色骨架是自动匹配的专家示范（未审核）。");
    expect(referenceNote(["auto_matched_unreviewed"], false, "level3")).toBe("Orange is you; green is automatically matched from CSIA level 3 pass examples (unreviewed).");
    expect(referenceNote(["reviewed_platform_reference"], true, "level2")).toBe("橙色骨架是你；绿色骨架是审核过的标准动作。");
  });
  it("falls back to the legacy unavailable message for an insufficient scorecard", () => {
    const insufficient = { ...card(), quality: "insufficient", overall: { ...sampleScorecard.overall, score: null } };
    const html = renderToStaticMarkup(createElement(VideoAnalysisResult, { locale: "en",
      result: { ...graded, gradingStatus: "unavailable", score: null, scorecard: insufficient } }));
    expect(html).toContain("A score is unavailable for this analysis. No credit is used.");
    expect(html).not.toContain("FreeSki technique score");
  });
  it("renders teaching without a primary improvement", () => {
    const teaching = citedTeaching(teachingSchema.parse({ ...sampleTeaching,
      improvements: sampleTeaching.improvements.map(item => ({ ...item, priority: "secondary" })) }));
    const html = renderToStaticMarkup(createElement(AnalysisTeaching, { teaching, zh: true,
      turnLabel: (id: string) => turnLabel(id, true), onSelectTurn: () => {} }));
    expect(html).toContain("需要改进");
    expect(html).not.toContain("border-accent bg-accent-soft");
  });
  it("renders FreeSki's sample teaching with matching turn numbers", () => {
    const teaching = citedTeaching(teachingSchema.parse(sampleTeaching));
    const html = renderToStaticMarkup(createElement(AnalysisTeaching, { teaching, zh: true,
      turnLabel: (id: string) => turnLabel(id, true), onSelectTurn: () => {} }));
    const linked = sampleTeaching.improvements.find(item => item.turn_ids.length > 0)!;
    expect(html).toContain("动作解释");
    expect(html).toContain(linked.text_zh);
    expect(html).toContain(`查看${turnLabel(linked.turn_ids[0], true)}`);
    expect(html).toContain(sampleTeaching.drills[0].name_zh);
  });
});
