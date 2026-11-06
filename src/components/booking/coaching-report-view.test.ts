import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { coachingReportSchema, type CoachingReport } from "@/lib/freeski/report-v2";
import { scorecardSchema } from "@/lib/freeski/scorecard";
import { sampleReport } from "@/lib/freeski/scorecard.fixtures";
import { CoachingReportView } from "./dynamic-coaching-report";
import { filmingAdvice } from "./filming-tips";

// The turn player links to the standard-motion library where that page exists.
vi.mock("@/i18n/navigation", () => ({ Link: (props: ComponentProps<"a">) => createElement("a", props) }));

// FreeSki's sample: CSIA level 2 parallel turns, 3 of 7 turns scored, turns 1–2 too small and 6–7 out of frame.
const parse = (overrides: Record<string, unknown> = {}) => coachingReportSchema.parse({ ...sampleReport, ...overrides });
const render = (report: CoachingReport = parse(), props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(CoachingReportView, {
  base: "/api/video-analysis/reports/account/job1", zh: true, report, card: report.scorecard, reviews: { canReview: false, reviews: [] }, ...props }));

describe("FreeSki report in reading order", () => {
  it("leads with the conclusion, then the turn to watch, how to practise and the measurements", () => {
    const html = render();
    const order = ['aria-label="这次的结论"', 'aria-label="看问题：逐弯动态对比"', 'aria-label="怎么练"', ">完整讲解<", 'aria-label="详细数据"']
      .map(marker => html.indexOf(marker));
    expect(order.every(index => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("试验版 · 教练确认前仅供参考");
  });

  it("sums up the measurements instead of showing the withheld overall score", () => {
    const report = parse();
    // A distinctive total, since the sample's own may coincide with a metric or turn score.
    const card = scorecardSchema.parse({ ...report.scorecard, overall: { ...report.scorecard!.overall, score: 63.27 } });
    const html = render(report, { card });
    expect(html).toContain("7 项里 6 项达到 CSIA 2 级通过示范的常见水平 · 1 项需加强 · 另有 2 项视频估算，不计分");
    expect(html).not.toMatch(/63\.27|63\.3/);
  });

  it("names one strength and the primary improvement, and opens the player on its turn", () => {
    const html = render();
    expect(html).toContain("做得好：</span>上身稳定与 CSIA 2 级通过示范接近（100 分）。</span>");
    expect(html).toContain("最该练：</span>第4弯的收弯完成度只有 33.4 分，低于 CSIA 2 级通过示范的常见范围。</p>");
    expect(html).toContain("看第 4 弯，高亮这个问题");
    expect(html).toContain('aria-pressed="true" aria-label="第 4 弯 · 左转 · 67 分 · 最该练"');
    expect(html).toMatch(/高亮：(<!-- -->)?收弯完成度/);
  });

  it("marks the turns that were not scored on the strip", () => {
    const html = render();
    expect(html).toContain('aria-label="第 1 弯 · 右转 · 证据不足（人太小）"');
    expect(html).toContain('aria-label="第 6 弯 · 左转 · 证据不足（出画或贴边）"');
    expect(html).toContain("证据不足，不打分");
  });

  it("gives drills their own section instead of a second copy in the full explanation", () => {
    const html = render();
    expect(html.split("曲棍球急停").length - 1).toBe(1);
    expect(html).toContain(">看第 4 弯</button>");
  });

  it("groups the measurements by where each one stands", () => {
    const html = render();
    const group = (standing: string) => { const start = html.indexOf(`data-standing="${standing}"`); return start < 0 ? "" : html.slice(start, html.indexOf("</ul>", start)); };
    expect(group("work")).toContain("旋转速率");
    expect(group("good")).toContain("上身稳定");
    expect(group("good")).not.toContain("旋转速率");
    expect(group("estimated")).toContain("立刃角度（估算）");
    expect(group("none")).toBe("");
  });

  it("turns this clip's own footage problems into filming advice", () => {
    const card = parse().scorecard!;
    expect(filmingAdvice(card, true)).toEqual([
      "第 1、2 弯人太小，没有打分。离近一些，让人至少占画面高度的五分之一。",
      "第 6、7 弯出画或贴边，没有打分。横屏拍，镜头一直跟住人，让整个弯都留在画面里。",
    ]);
    expect(filmingAdvice(card, false)[0]).toBe("Turns 1 and 2: too small in frame, so not scored. Film closer so the skier fills at least a fifth of the frame height.");
    const clean = scorecardSchema.parse({ ...card, quality: "valid", quality_reasons: [], turns: card.turns.filter(turn => turn.evidence?.status !== "insufficient") });
    expect(filmingAdvice(clean, true)).toEqual([]);
    expect(render()).toContain("下次拍得更准");
  });

  it("asks the student to have a coach check the suggestions, but not the coach reviewing them", () => {
    expect(render(parse(), { reviewHref: "#coach-feedback-v1" })).toContain('href="#coach-feedback-v1"');
    const coach = render(parse(), { reviewHref: "#coach-feedback-v1", reviews: { canReview: true, reviews: [] } });
    expect(coach).not.toContain("请教练点评");
    expect(coach).toContain("<details open=\"\"");
    expect(render()).not.toContain("请教练点评");
  });

  it("concludes from the measurements while the explanation is still being written", () => {
    const html = render(parse({ teaching: null, teachingStatus: "running" }));
    expect(html).toContain("动作解释生成中");
    expect(html).toContain("做得好：</span>双板平行、收弯方向达到示范常见水平");
    expect(html).toContain("最该练：</span>旋转速率");
    expect(html).not.toContain(">完整讲解<");
    expect(html).not.toContain("二维数据观察");
  });

  it("keeps the written explanation and offers the thinking levels while a deeper one is written", () => {
    const written = parse().teaching!;
    const report = parse({ teaching: null, teachingStatus: "running",
      teachingLevels: [{ level: "none", status: "ready" }, { level: "xhigh", status: "running" }] });
    const thinking = { value: "xhigh", shown: "none", onChange: vi.fn() };
    const html = render(report, { written, thinking });
    expect(html).toContain("最该练：</span>第4弯的收弯完成度只有 33.4 分");
    expect(html).not.toContain("动作解释生成中");
    expect(html).toContain("正在用「当个事办」档写讲解");
    expect(html.indexOf('aria-label="讲解深度"')).toBeLessThan(html.indexOf('aria-label="这次的结论"'));
    // A deployment without thinking levels sends no list, and then none are offered.
    expect(render(parse(), { thinking })).not.toContain('aria-label="讲解深度"');
  });

  it("says a scorecard job's explanation was not written instead of showing the old observations", () => {
    const html = render(parse({ teaching: null, teachingStatus: "failed" }));
    expect(html).toContain("这次的动作解释没有生成");
    expect(html).not.toContain("二维数据观察");
  });

  it("reads the same way in English", () => {
    const html = render(parse(), { zh: false });
    expect(html).toContain("6 of 7 measurements are at the usual level of CSIA level 2 pass examples · 1 needs work · 2 more are video estimates, not scored");
    expect(html).toContain("Turns 1 and 2: too small in frame, so not scored.");
    expect(html).toContain(">Watch</button>");
  });
});
