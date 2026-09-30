# Licences of the test font assets

All files in this directory are **original work of the truedxf project** and are released under
the same licence as the repository (MIT, see the root `LICENSE`). They contain **no Autodesk data**
and no glyph data taken from other fonts.

| File | What | Source |
|---|---|---|
| `truedxf-test.shx` / `.shp` | Latin stroke font, "AutoCAD-86 shapes 1.1", ASCII 32–126, Ä Ö Ü ä ö ü é ß, shapes 256/257/258 (%%d %%p %%c), above 12 / below 4, vertical-capable (modes 2) | glyphs designed for truedxf in `scripts/test-fonts.ts` |
| `truedxf-test-uni.shx` / `.shp` | the same glyphs as a unifont ("AutoCAD-86 unifont 1.0"), specials at U+00B0, U+00B1, U+00D8, U+2205 | same |
| `truedxf-big.shx` / `.shp` | small bigfont (Shift-JIS escape ranges 0x81–0x9F, 0xE0–0xFC), 13 simple CJK-like stroke glyphs, above 16 | same; the Shift-JIS codes are computed with the platform's `TextDecoder("shift_jis")` |
| `truedxf-extbig.shx` / `.shp` | extended bigfont: 3 primitives in a 16 × 16 cell + 4 glyphs composed with `7,0,…` extended subshapes | same |
| `truedxf-lt.shx` / `.shp` | shape file for complex linetypes / SHAPE entities (TDX_BOX, TDX_CIRC, TDX_ZIG, …) | same |
| `truedxf-probe.shx` / `.shp` | probe glyphs for open SHX questions (pen rounding, fractional arcs, scale persistence, dots); each probe is described in the `.shp` header | same |
| `truedxf.lin` | complex linetypes using `truedxf-lt.shx` | same |

The `.shx` files are generated from `scripts/test-fonts.ts` by `node packages/fonts/scripts/build-test-fonts.ts`;
the `.shp` files are the decompiled sources (`compileShp` turns them back into identical bytes).
A unit test checks that the committed files match the generator.

## Why not Hershey?

The plan (docs/PLAN.md §6) suggested deriving the test font from the Hershey fonts. Their Usenet
distribution may be used for any purpose if two acknowledgements (Dr. A. V. Hershey / U.S. National
Bureau of Standards, and James Hurt, Cognition Inc., for the data format) are distributed with the
data, and it must not be redistributed in the NTIS format. That would have been acceptable, but the
only Hershey-derived data available offline in this repository's research clones are LibreCAD/QCAD
conversions (LibreCAD `*.lff`, QCAD `*.cxf`) inside GPL projects, which AGENTS.md forbids copying.
Hershey glyphs also contain no arcs, while the test font must exercise every SHX arc command
(octant arcs, fractional arcs, bulge arcs and polyarcs). The glyphs were therefore drawn from scratch
on an integer grid with lines and circular arcs, which keeps the licence trivially clean.
