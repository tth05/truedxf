# @truedxf/fonts

SHX and TrueType fonts for DXF, with font lookup and fallback that pick the same font AutoCAD does.

## Install

```bash
pnpm add @truedxf/fonts
```

ESM only. No DOM and no Node.js APIs: runs in browsers, workers and Node.

Isomorphic: no DOM and no `node:*` imports in `src/`. Font files come through an injected
`FontProvider`. Glyphs are in font units (y up, baseline at y = 0). `font.scaleForHeight(h)`
(= `h / capHeight`) converts to drawing units.

## What it does

- SHX shape files 1.0/1.1, unifonts, bigfonts and extended bigfonts: `parseShx` / `writeShx`
  (every SHX file in the AutoCAD 2027 `Fonts` folder round-trips byte-identically, local test),
  `compileShp` / `decompileShx` (`.shp` source), `disassemble` / `assemble` (bytecode and typed
  `ShapeOp[]`), `interpretOps` / `interpretBytes` (the shape machine).
- TrueType/OpenType through opentype.js: `TtfFont` reads `.ttf`, `.otf` (CFF) and `.ttc` (the face
  is extracted with `extractFace`, since opentype.js cannot read collections). `readNames`,
  `faceCount` read sfnt tables without a full parse.
- One `Font` interface over both (`capHeight`, `ascent`, `descent`, `unitsPerEm`, `glyph(code)`).
  SHX glyphs are `{ kind: "strokes" }` with exact arcs as DXF bulges, while TTF glyphs are
  `{ kind: "outline" }` paths (M/L/Q/C/Z). `bounds` is the exact ink box and `advance` is the
  final pen x (SHX) or the hmtx advance (TTF, no kerning).
- `FontManager.resolveStyle` turns a STYLE entry into a `StyleFont` (primary + bigfont + glyph
  fallbacks) following AutoCAD 2027 (note 04 §4.1) and reports every substitution.
- `flattenStrokes` / `flattenPath` turn glyphs into polylines, deterministically.

## Usage

```ts
import { readdir, readFile } from "node:fs/promises"; // Node; in a browser use MemoryFontProvider
import { DirectoryFontProvider, FontManager, flattenStrokes } from "@truedxf/fonts";

const provider = new DirectoryFontProvider(
  ["C:/Program Files/Autodesk/AutoCAD 2027/Fonts", "C:/Windows/Fonts"], // first directory wins
  { readDir: (d) => readdir(d), readFile: async (p) => new Uint8Array(await readFile(p)) },
);
const fonts = new FontManager(provider, { fontAlt: "simplex.shx", glyphFallbacks: ["arialuni.ttf"] });

// STYLE: group 3, group 4, XDATA ACAD 1000 family / 1071 flags
const { font, suppressed, substitutions } = await fonts.resolveStyle({ fontFile: "txt", bigFontFile: "gbcbig.shx" });
const r = font && !suppressed ? font.glyph(0x41) : undefined; // { glyph, font, scale, fallback }
if (r?.glyph.kind === "strokes") {
  const polylines = flattenStrokes(r.glyph.strokes, { scale: r.scale * 2.5 }); // text height 2.5
}
```

## Resolution (`FontManager`, `StyleFont`)

- Providers: `MemoryFontProvider`, `DirectoryFontProvider(dirs, fs)` (injected `FontFileSystem`),
  `ChainFontProvider`. A provider implements `getFile(name)` and optionally `listFiles()` /
  `findFamily(family, style)`.
- `loadFile("txt")`: case-insensitive, extension optional (`.shx`, `.ttf`, `.ttc`, `.otf`),
  `name.ttc#1` selects a collection face, one instance per file.
- `findFamily(family, bold, italic)`: GDI face name (name ID 1) plus style bits, via an index over
  `listFiles()` built on first use. It prefers the exact style, then the closest face.
- `resolveStyle({ fontFile, bigFontFile, family, flags })`: font map first (`fontMap`, parse
  `acad.fmp` with `FontManager.parseFontMap`). A non-empty XDATA family wins over group 3 (flags
  bit 25 bold, 24 italic). Quotes are stripped. An SHX path resolves by its base name, while a
  TrueType path goes to FONTALT (`resolveFullPaths: true` changes that). Anything unresolved
  becomes FONTALT (default `simplex.shx`, then `lastResort`). A bigfont next to a TTF is ignored.
  A missing bigfont suppresses the text (`missingBigFont: "ignore"` to draw it).
- `missingFont: "fallback"` (viewers) always draws the text: missing primary fonts use the first
  loadable of `fallbackFonts`, missing bigfonts `fallbackBigFont` or none. The default `"autocad"`
  is the plot behaviour above.
- `StyleFont.glyph(code)` returns `{ glyph, font, scale, fallback }`. Codes at or above
  `BIG_FONT_CODE` address the bigfont directly (`bigFontCode`). ASCII, and every raw code of a
  non-Unicode shape font, try the bigfont first. SHX misses draw the font's "?", while TTF misses
  go through `glyphFallbacks` at the primary font's em scale. Bigfont glyphs use the bigfont's own
  `above` (`bigFontScale: "primary"` to change, UNKNOWN in AutoCAD). Bigfont subshapes the bigfont
  lacks resolve in the primary font (`withCompanion`, needed by special.shx).
- Code spaces: unifonts and TTF take Unicode code points, non-Unicode shape fonts take code page
  bytes (256/257/258 for `%%d %%p %%c`), and bigfonts take `lead·256 + trail` in their own DBCS
  code page (`bigFontEncoding`, `StyleFont.bigFontEncoding`). Mapping text to codes is
  @truedxf/text's job.

## SHX details

- Interpreter: pen up/down, 16 vector directions, cumulative scale ×/÷, position stack (overflow
  past 4 warns), subshapes (1-byte, 2-byte high byte first in unifonts, and extended bigfont
  `7,0,shape,x,y,w,h` with non-uniform scaling), single and multiple displacements, octant,
  fractional (radius = high·256 + low) and bulge arcs, polyarcs, code 0x0E (skips the next command
  unless vertical text is requested and the font has modes = 2), 0x0F as a no-op.
- `ShxFontOptions`: `penRounding: "none" | "arcs" | "all"` (default `arcs`: snap the pen to the
  `penGrid`, default 1, after octant and fractional arcs. The arc keeps its sweep and ends at the
  snapped point), `maxDepth` (subshape nesting, default 16), `anisotropicArcSegments` (default 64
  per circle).
- Metrics: `capHeight` = `above` (shape 0 or unifont header, measured "A" for shape files, and
  gbcbig's `0,64,2,0` header gives 8), `descent` = `below`, `modes`, `cell` for extended bigfonts.
- `ShxFont.shapeByName` / `glyphByName` serve SHAPE entities and complex linetypes. `splitCodes`
  pairs DBCS bytes for bigfonts.
- `flattenStrokes(strokes, { maxAngle = 5.625, tolerance?, scale? })` cuts each arc into
  `ceil(|sweep| / maxAngle)` chords (64 per circle by default), more if `tolerance` demands it.
  `flattenPath(path, { tolerance? | segments = 8, scale? })` does the same for outlines.

TrueType: `capHeight` is the yMax of "A" (fallback OS/2 sCapHeight, then the ascender,
and `capHeightSource` says which), `ascent` / `descent` come from hhea, `metrics` exposes the hhea /
OS/2 / win values. Width factor and oblique are applied by the layout, not here.

## Limitations

- AutoCAD behaviour still UNKNOWN (configurable here): pen rounding details, SHX arc tessellation in
  plots, bigfont scale relative to the primary font, whether scale (codes 3/4) and the position
  stack persist across characters (reset per glyph here), extended-subshape pen placement, fonts
  without "A", synthetic bold/italic when a family lacks the face, which Windows font supplies
  missing TTF glyphs.
- No kerning and no Type 1 (`.pfb`) fonts. OpenType variations are ignored.
- The family index reads every TTF the provider lists on first use. For large or remote
  collections, implement `findFamily` on the provider.

## License

MIT. AutoCAD and DXF are trademarks of Autodesk, Inc. truedxf is not affiliated with or
endorsed by Autodesk.
