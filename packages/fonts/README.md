# @truedxf/fonts

Fonts for truedxf: a native **SHX** implementation (shape fonts, unifonts, bigfonts, extended
bigfonts, shape files), **TrueType/OpenType** via [opentype.js](https://github.com/opentypejs/opentype.js),
and **font resolution that follows AutoCAD 2027** (research note 04 §4). Isomorphic: no DOM, no
`node:*` imports in `src/` — file access goes through an injected `FontProvider`.

Everything is in font units with y up and the baseline at y = 0. Text height `h` maps to drawing
units with `font.scaleForHeight(h)` (= `h / capHeight`).

## Quick start

```ts
import { FontManager, DirectoryFontProvider, MemoryFontProvider, flattenStrokes } from "@truedxf/fonts";
import { readdir, readFile } from "node:fs/promises"; // in Node; in the browser use MemoryFontProvider

const provider = new DirectoryFontProvider(
  ["C:/Program Files/Autodesk/AutoCAD 2027/Fonts", "C:/Windows/Fonts"], // first directory wins
  { readDir: (d) => readdir(d), readFile: async (p) => new Uint8Array(await readFile(p)) },
);
const fonts = new FontManager(provider, { fontAlt: "simplex.shx", glyphFallbacks: ["arialuni.ttf"] });

// STYLE table entry: group 3, group 4, XDATA ACAD 1000 family / 1071 flags
const { font, suppressed, substitutions } = await fonts.resolveStyle({ fontFile: "txt", bigFontFile: "gbcbig.shx" });
if (font && !suppressed) {
  const r = font.glyph(0x41); // { glyph, font, scale, fallback }
  const h = 2.5;
  if (r?.glyph.kind === "strokes") {
    const polylines = flattenStrokes(r.glyph.strokes, { scale: r.scale * h }); // SHX: stroked polylines
  }
}
```

## API

### Unified font interface (`types.ts`)

```ts
interface Font {
  kind: "shx" | "ttf"; name: string;
  capHeight: number;   // text-height basis: SHX `above`, TTF yMax of glyph "A"
  ascent: number;      // SHX above, TTF hhea ascender
  descent: number;     // positive; SHX below, TTF hhea descender (TEXT Bottom = baseline − descent·h/cap)
  unitsPerEm: number;  // TTF em; SHX = capHeight
  scaleForHeight(h: number): number;
  hasGlyph(code: number): boolean;
  glyph(code: number, options?: { vertical?: boolean }): Glyph | undefined; // cached
}
type Glyph =
  | { kind: "strokes"; code; strokes: Stroke[]; advance; advanceY; bounds } // SHX, never filled
  | { kind: "outline"; code; path: PathCommand[]; advance; bounds };      // TTF/OTF, M/L/Q/C/Z
```

`Stroke.vertices` carry DXF-style **bulges** (segment from this vertex to the next), so SHX arcs are
exact. `bounds` is the exact ink box (arc and curve extrema included). `advance` is the final pen x
for SHX (note 04 §4.4) and the hmtx advance for TTF — **no kerning**.

`flattenStrokes(strokes, { maxAngle = 5.625, tolerance?, scale? })` splits every arc into
`ceil(|sweep| / maxAngle)` equal-angle chords — by default **8 segments per 45° octant, 64 per full
circle** — or more if a chord `tolerance` demands it. AutoCAD's SHX arc tessellation in PLOT is still
UNKNOWN (note 04 §8.3), so this is configurable and deterministic. `flattenPath(path, { tolerance? |
segments = 8, scale? })` does the same for outlines (Wang's bound); the TEXTQLTY mapping is UNKNOWN.

### SHX

| Function / class | What |
|---|---|
| `parseShx(bytes)` → `ShxFile` | shapes 1.0/1.1, unifont 1.0, bigfont 1.0 (escape ranges, hash index); tolerant, `warnings` |
| `writeShx(file)` | inverse; all 79 AutoCAD 2027 SHX files round-trip **byte-identically** |
| `compileShp(text)` / `decompileShx(file)` | `.shp` source ⇄ `ShxFile` (role-aware signs: two's complement displacements, sign-magnitude octant specs) |
| `disassemble` / `assemble` | bytecode ⇄ typed `ShapeOp[]` |
| `interpretOps` / `interpretBytes` | the shape machine → strokes, end pen position |
| `ShxFont` | `Font` implementation; `shapeByName`/`glyphByName` (SHAPE entities, linetypes), `splitCodes(bytes)` (bigfont DBCS pairing), `withCompanion(primary)` |

Interpreter coverage: pen up/down, 16 vector directions (stretched diagonals), scale ×/÷ (cumulative),
4-deep position stack, subshapes (1-byte; unifont 2-byte **high byte first**; bigfont extended
`7,0,shape,x,y,w,h` with non-uniform scaling), single and multiple displacements, octant arcs,
fractional arcs (radius = high·256 + low), bulge arcs and polyarcs (−128 clamped), vertical-only code
0x0E (skips the whole next command unless vertical text is requested *and* the font has modes = 2),
0x0F as no-op. Options (`ShxFontOptions`):

- `penRounding: "none" | "arcs" | "all"` (default **`arcs`**) and `penGrid` (default 1): note 04's
  rounding hypothesis — the pen is snapped to the integer grid after octant/fractional arcs; rounded
  arcs keep their sweep and end at the snapped point.
- `maxDepth` (subshape nesting, default 16), `anisotropicArcSegments` (arcs inside non-uniformly
  scaled extended subshapes are flattened, default 64 per circle).

Font metrics: `capHeight = above` (shape 0 or unifont header; measured "A" for shape files),
`descent = below`, `modes`, `file.info.extended` for extended bigfonts.

### TrueType / OpenType

`new TtfFont(bytes, name?, { face? })` — `.ttf`, `.otf` (CFF, cubic), `.ttc` (a face is extracted
because opentype.js cannot read collections). `capHeight` = yMax of "A" (fallback OS/2 sCapHeight,
then ascender — fonts without "A" are UNKNOWN in AutoCAD); `metrics` exposes hhea/OS-2/win values for
the layout package (width factor and oblique are the layout's job). `readNames`, `faceCount`,
`extractFace` read sfnt tables without a full parse.

### Providers and resolution

- `FontProvider { getFile(name), listFiles?(), findFamily?(family, style) }`;
  `MemoryFontProvider`, `DirectoryFontProvider(dirs, fs)` (injected `FontFileSystem`),
  `ChainFontProvider`.
- `FontManager(provider, options)`:
  - `loadFile("txt")` — case-insensitive, extension optional (`.shx`, `.ttf`, `.ttc`, `.otf`),
    `name.ttc#1` for collection faces, one instance per file.
  - `findFamily(family, bold, italic)` — GDI face name (name ID 1) + style bits, via a lazily built
    index over `listFiles()`.
  - `resolveStyle({ fontFile, bigFontFile, family, flags })` → `{ font: StyleFont, suppressed,
    substitutions }` implementing note 04 §4.1: font map (`acad.fmp`, `FontManager.parseFontMap`)
    first; non-empty XDATA family wins over group 3 (bits 25/24 = bold/italic); quotes stripped;
    absolute paths do not resolve (option `resolveFullPaths`); anything unresolved → **FONTALT**
    (default `simplex.shx`, then `lastResort`); a bigfont next to a TTF is ignored; a **missing bigfont
    suppresses the text** (option `missingBigFont: "ignore"`). Every deviation is reported.
- `StyleFont.glyph(code)` → `{ glyph, font, scale, fallback }`: bigfont first, then the primary
  font (ADSK); SHX misses render the font's **"?"**; TTF misses go through `glyphFallbacks` at the
  primary font's em-normalised scale. Bigfont glyphs use the bigfont's own `above`
  (`bigFontScale: "primary"` to change — UNKNOWN in AutoCAD). Bigfont subshapes that the bigfont
  lacks resolve in the primary font (as special.shx requires).

Code spaces: unifonts and TTF take Unicode code points; non-Unicode shape fonts take code-page
bytes (and 256/257/258 for `%%d %%p %%c`); bigfonts take `lead·256 + trail`. Mapping text to codes
(code pages, `%%` codes, `\U+`, `\M+`) is the text package's job.

## Test fonts (`assets/`)

Our own fonts, MIT, generated by `node packages/fonts/scripts/build-test-fonts.ts` from
`scripts/test-fonts.ts` (see [assets/LICENSES.md](assets/LICENSES.md)): `truedxf-test.shx` (Latin
shape font, every SHX command, on-grid so it does not depend on the rounding hypothesis),
`truedxf-test-uni.shx` (same as unifont), `truedxf-big.shx` (Shift-JIS bigfont, above 16),
`truedxf-extbig.shx` (extended bigfont), `truedxf-lt.shx` + `truedxf.lin` (complex linetypes),
`truedxf-probe.shx` (one glyph per open AutoCAD question, listed in its `.shp` header). AutoCAD and
truedxf load the same files, so these fonts make text fixtures exact.

`node packages/fonts/scripts/render-svg.ts <font> <out.svg> [--vertical]` draws a glyph sheet.

## Findings from the AutoCAD 2027 font folder (local tests, facts only)

- **Unifont code-7 subshape numbers are high byte first**: all 888 references in 28 unifonts resolve only
  big-endian (resolves the note 04 §4.3 CONFLICT).
- **The bigfont index is a hash table**: slot = byteswap(code) mod size (a prime), forward linear
  probing, empty slots zero — in all 13 bigfonts. `writeShx` builds it that way.
- **Pen rounding after arcs is strongly supported**: chineset.shx has 15 arc glyphs whose exact end
  is off its 48-unit advance grid (e.g. 48.2254); rounding after every octant/fractional arc puts all
  of them on 48 (and 27 of 28 in bold.shx).
- The position stack spans characters: shape 1 ("start") pushes and shape 13 (CR) pops in ISO.shx,
  times.shx, bold.shx, … (decoded alone they under/overflow; reported as warnings).
- special.shx / spec_bar.shx / spec_sl.shx bigfont glyphs call 1-byte subshapes that exist only in
  the **primary** font; special.shx `~z` is `3,4` only (a scale change meant to persist?) — UNKNOWN.
- gbcbig.shx's shape 0 is `0,64,2,0` (read as above 64) but its glyphs are scaled by 9/102 to about
  8 units high — its effective height in AutoCAD is UNKNOWN (needs a TEXTBOX probe).
- simplex.shx "A": ink 16 units wide (7.619 at h = 10, as measured by AutoCAD), pen advance 22 units
  (10.476) — note 04 §4.6 quotes an advance of "≈ 9.5238"; to be verified.

## Known gaps

- AutoCAD behaviour still UNKNOWN (configurable here): pen rounding details, arc tessellation,
  bigfont scale vs. the primary font, whether scale (codes 3/4) and the position stack persist across
  characters (we reset per glyph), extended-subshape pen placement, fonts without "A", synthetic
  bold/italic when a family lacks the face, which Windows fallback font supplies missing TTF glyphs.
- Type 1 (`.pfb`) fonts are not supported; OpenType variations are ignored.
- The family index reads every TTF the provider lists on first use (fine for a fonts folder; supply
  `findFamily` on the provider for large or remote collections).
