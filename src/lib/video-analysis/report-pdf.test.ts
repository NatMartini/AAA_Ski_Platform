import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sampleScorecard } from "../freeski/scorecard.fixtures";
import { analysisTitle, renderAnalysisReportPdf } from "./report-pdf";

describe("the downloadable report", () => {
  it("names the analysis the way the site does", () => {
    expect(analysisTitle("improvement:level2:parallel", true)).toBe("平行式转弯 · 目前 CSIA 2 级");
    expect(analysisTitle("certification:level2:short_turn", true)).toContain("CSIA 2 级");
    expect(analysisTitle("unknown-action", false)).toBe("Skiing analysis");
  });

  it.each([true, false])("renders the measurements and movement explanations to a PDF (zh: %s)", async (zh) => {
    const bytes = await renderAnalysisReportPdf({ zh, actionId: "improvement:level2:parallel", caption: "Blue Mountain",
      submittedAt: new Date("2026-10-28T18:00:00Z"), finishedAt: new Date("2026-10-28T18:03:00Z"),
      result: { scorecard: sampleScorecard }, teaching: null });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toContain(zh ? "平行式" : "Parallel");
    // The Chinese font is embedded as a subset, so the file stays small.
    expect(bytes.byteLength).toBeLessThan(400_000);
  });

  it("leaves out why each problem happens where the tier has no explanations", async () => {
    const input = { zh: false, actionId: "improvement:level2:parallel", caption: null, submittedAt: new Date("2026-10-28T18:00:00Z"),
      finishedAt: null, result: { scorecard: sampleScorecard }, teaching: null };
    // Text is drawn as glyphs, so the explanations show in the file's size rather than as searchable words.
    const explained = await renderAnalysisReportPdf(input);
    const plain = await renderAnalysisReportPdf({ ...input, explanations: false });
    expect(plain.byteLength).toBeLessThan(explained.byteLength - 1000);
  });

  it("still renders without a scorecard", async () => {
    const bytes = await renderAnalysisReportPdf({ zh: true, actionId: "improvement:level2:parallel", caption: null,
      submittedAt: new Date("2026-10-28T18:00:00Z"), finishedAt: null, result: null, teaching: null });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
