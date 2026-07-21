# Fonts

## NotoSansSC-Regular.ttf

Embedded into signed waiver PDFs so Chinese participant names and the Chinese
text of the agreement render. Licensed under the SIL Open Font License 1.1,
which permits redistribution — see https://openfontlicense.org.

Built from the upstream variable font, instantiated at `wght=400`:

    curl -L -o NotoSansSC-VF.ttf \
      "https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"

    python -c "
    from fontTools import ttLib
    from fontTools.varLib import instancer
    f = ttLib.TTFont('NotoSansSC-VF.ttf')
    instancer.instantiateVariableFont(f, {'wght': 400}, inplace=True, updateFontNames=True)
    f.save('NotoSansSC-Regular.ttf')
    "

### Why a TrueType build and not the OTF

This has to be a glyf-outline TrueType font, not the CFF-flavoured `.otf`.

pdf-lib subsets a CFF source into a CIDFontType0 descendant with a `/FontFile3`
program. Viewers lay that out with the correct advance widths but paint nothing
for the CJK glyphs, so the PDF looks like it has blank gaps where the Chinese
should be — and it fails silently, with no error at generation time.

Feeding it a glyf-based TTF produces CIDFontType2 with `/FontFile2`, which
renders correctly everywhere. Subsetting keeps the embedded font at roughly
90 KB, so a signed waiver comes out around 80 KB rather than 7 MB.

If this font is ever replaced, verify the output rather than trusting it: the
failure mode is invisible. `npm run sample:waiver` renders a sample containing
Chinese, and the embedded font can be checked with:

    node -e "..."  # extract /FontFile2 and confirm glyphs have contours
