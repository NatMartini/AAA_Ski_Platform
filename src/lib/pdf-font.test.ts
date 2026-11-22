import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import fontkit from "@pdf-lib/fontkit";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, type PDFRef } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { embedSubsetFont } from "./pdf-font";
import { renderAnalysisReportPdf } from "./video-analysis/report-pdf";
import { renderWaiverPdf } from "./waiver/render";
import { acknowledgementIds, templateHash } from "./waiver/template-v1";

type Glyph = { path: { commands: unknown[]; toSVG(): string } };
type Font = { numGlyphs: number; loca: { version: number }; getGlyph(id: number): Glyph; layout(text: string): { glyphs: Glyph[] } };
const open = (bytes: Uint8Array) => (fontkit as unknown as { create(data: Uint8Array): Font }).create(bytes);
const fontFile = readFile("assets/fonts/NotoSansSC-Regular.ttf");

/** The font a PDF carries, as a viewer would read it. */
async function embedded(pdf: Uint8Array): Promise<Font> {
  const doc = await PDFDocument.load(pdf);
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of("Type"))?.toString() !== "/FontDescriptor") continue;
    const stream = doc.context.lookup(object.get(PDFName.of("FontFile2")) as PDFRef) as PDFRawStream;
    return open(inflateSync(Buffer.from(stream.contents)));
  }
  throw new Error("No embedded font");
}

/** Glyphs that cannot be read back, and glyphs that draw nothing: a space is the only one that should. */
function health(font: Font) {
  let unreadable = 0, blank = 0;
  for (let id = 1; id < font.numGlyphs; id++) {
    try { if (font.getGlyph(id).path.commands.length === 0) blank++; } catch { unreadable++; }
  }
  return { unreadable, blank };
}

describe("fonts embedded in PDFs", () => {
  it("draws every character of a short document as the font does", async () => {
    const bytes = await fontFile, text = "提交 2026年11月12日 完成 结论 0123456789 ABC abc 滑雪 免责书 签字 Kevin";
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await embedSubsetFont(doc, bytes);
    doc.addPage([420, 120]).drawText(text, { x: 20, y: 60, size: 12, font });
    // The glyph numbers written into the page, in the order of the text.
    const ids = font.encodeText(text).toString().slice(1, -1).match(/.{4}/g)!.map(code => parseInt(code, 16));
    const carried = await embedded(await doc.save()), original = open(bytes).layout(text).glyphs;
    // A document this short gets the short glyph index: the case the library's own subsetting gets wrong.
    expect(carried.loca.version).toBe(0);
    expect(ids).toHaveLength(original.length);
    ids.forEach((id, index) => expect(carried.getGlyph(id).path.toSVG(), `character ${index + 1} of the text`).toBe(original[index].path.toSVG()));
    expect(health(carried)).toEqual({ unreadable: 0, blank: 1 });
  });

  it("keeps a report readable however little it says, in either language", async () => {
    const base = { actionId: "certification:level2:demonstration_parallel", caption: "sample", submittedAt: new Date("2026-11-12T12:00:00Z"),
      finishedAt: new Date("2026-11-12T12:06:00Z"), result: null, teaching: null };
    for (const zh of [true, false]) {
      const carried = await embedded(await renderAnalysisReportPdf({ ...base, zh }));
      expect(carried.loca.version, zh ? "Chinese" : "English").toBe(0);
      expect(health(carried), zh ? "Chinese" : "English").toEqual({ unreadable: 0, blank: 1 });
    }
  });

  it("keeps a signed waiver readable", async () => {
    const pdf = await renderWaiverPdf({ variant: "adult", bookingCode: "SKI-8F3K2M", coachName: "Kevin", resortName: "Mount St. Louis Moonstone",
      lessonStartAt: new Date("2026-01-08T18:10:00Z"), lessonEndAt: new Date("2026-01-08T20:00:00Z"), totalCents: 11000, currency: "CAD", season: "2025-26",
      participantName: "张伟 (Zhang Wei)", participantIsMinor: false, signerName: "张伟 (Zhang Wei)", signerEmail: "student@example.com", typedName: "张伟",
      signatureImagePng: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
      guardianName: null, guardianRelationship: null, guardianPhone: null, acknowledgedClauseIds: acknowledgementIds("adult"), consentToElectronic: true,
      signedAt: new Date("2026-01-06T15:22:31Z"), ipAddress: "203.0.113.42", userAgent: "sample", templateHash: templateHash("adult") });
    expect(health(await embedded(pdf))).toEqual({ unreadable: 0, blank: 1 });
  });
});
