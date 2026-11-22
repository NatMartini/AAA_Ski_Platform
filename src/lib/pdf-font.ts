import type { PDFDocument, PDFFont } from "pdf-lib";

/** The parts of @pdf-lib/fontkit's TrueType subset that the fix below reaches into. */
type GlyphSubset = { glyf: Uint8Array[]; offset: number; _addGlyph: (glyphId: number) => number };

/**
 * Embeds a font so that a PDF carries only the glyphs it uses.
 *
 * pdf-lib's own subsetting (through @pdf-lib/fontkit 1.1.1) is wrong for short documents. A subset whose glyph data
 * is under 64 KB is written with the short glyph index, which stores each glyph's position divided by two, but the
 * glyphs are not placed at even positions. Every glyph after one of odd length is then read from the wrong place: it
 * draws as a blank or as scribble, while the text can still be selected and copied, so nothing looks wrong to a
 * program. A long Chinese document escapes this only because its glyph data is larger. Here each glyph is padded to an
 * even length, which the font format allows, so every position is exact in both index formats.
 */
export async function embedSubsetFont(doc: PDFDocument, bytes: Uint8Array): Promise<PDFFont> {
  const font = await doc.embedFont(bytes, { subset: true });
  const subset = (font as unknown as { embedder?: { subset?: Partial<GlyphSubset> } }).embedder?.subset;
  // A changed library must not quietly go back to writing blanks.
  if (!subset || typeof subset._addGlyph !== "function") throw new Error("Font subsetting changed: glyph positions cannot be kept even");
  const glyphs = subset as GlyphSubset, add = glyphs._addGlyph.bind(glyphs);
  glyphs._addGlyph = glyphId => {
    const index = add(glyphId), glyph = glyphs.glyf[index];
    if (glyph.length % 2 === 1) {
      // The library writes only buffers of its own bundled kind: the padded glyph is made as the original was.
      const Bytes = glyph.constructor as unknown as { alloc(size: number): Uint8Array };
      const padded = Bytes.alloc(glyph.length + 1);
      padded.set(glyph);
      glyphs.glyf[index] = padded;
      glyphs.offset += 1;
    }
    return index;
  };
  return font;
}
