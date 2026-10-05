# @truedxf/text

TEXT, ATTRIB/ATTDEF and MTEXT parsing and layout, measured against AutoCAD 2027 plots and DXFOUT values.

## Install

```bash
pnpm add @truedxf/text
```

ESM only. No DOM and no Node.js APIs: runs in browsers, workers and Node.

## What it does

- `layoutText` (TEXT, ATTRIB, ATTDEF) and `layoutMText` (MTEXT, multi-line attributes, dimension
  text) return a device-independent `TextLayout`: glyph placements (`Glyph` + `Affine2` from font
  units to the text plane), decoration lines, background fills, TrueType runs and a `plane`
  matrix to WCS. The layout is isomorphic, and the renderer turns it into strokes and fills.
- TEXT: all 72/73 alignments including FIT and ALIGNED, backward / upside-down, oblique, width
  factor, $TEXTSIZE for height 0, $QTEXTMODE boxes, vertical text with dual-orientation SHX fonts.
  `textFrame` gives AutoCAD's first alignment point 10.
- Special codes (`decodeTextString`): caret codes, `\U+XXXX`, `\M+nXXXX`, `%%c %%d %%p %%%`,
  `%%u %%o %%k`, `%%nnn`.
- MTEXT (`parseMText` into `MTextToken[]`): `\P \N \X \~ \L \l \O \o \K \k \S \A \C \c \H \W \T \Q
  \f \F \p`, braces. Layout: word wrap, line spacing styles, tabs, paragraph indents and
  alignment, stacks (`^ / #`), columns, text frame, background mask, flow direction 3.
  `mtextExtents` computes AutoCAD's stored extents 42/43.
- Fonts: `TextFonts` resolves every STYLE entry and inline `\f`/`\F` font up front through a
  `FontManager` (@truedxf/fonts), so layout is synchronous. It maps characters to glyph codes per
  font (drawing code page for non-Unicode SHX, bigfont DBCS codes), draws "?" or missing-glyph boxes
  where AutoCAD does, and reports missing fonts (`missingFonts`).

Input types (`TextStyleSpec`, `MTextInput`) are structurally compatible with @truedxf/model's
`TextStyleEntry` and `MTextEntity`, so model objects can be passed directly. `TextInput` needs a
small mapping from `TextEntity` (see `singleLine` in [render/src/text.ts](https://github.com/tth05/truedxf/blob/master/packages/render/src/text.ts)).

## Usage

```ts
import { readFile } from "node:fs/promises";
import { FontManager, MemoryFontProvider } from "@truedxf/fonts";
import { layoutText, TextFonts } from "@truedxf/text";

const shx = new Uint8Array(await readFile("fonts/romans.shx")); // any SHX or TrueType file
const manager = new FontManager(new MemoryFontProvider({ "romans.shx": shx }), { fontAlt: "romans.shx" });
const style = { name: "Standard", font: "romans.shx", bigFont: "", widthFactor: 1, oblique: 0,
  generationFlags: 0, fixedHeight: 0, vertical: false };
const fonts = new TextFonts(manager, [style]);
await fonts.prepare(); // pass inline fonts (inlineFonts(mtextContent)) for MTEXT

const layout = layoutText(
  { text: "%%c12 H7", insert: { x: 10, y: 5, z: 0 }, alignPoint: undefined, height: 2.5, rotation: 0,
    widthFactor: 1, oblique: 0, style: "Standard", generationFlags: undefined, halign: 0, valign: 0,
    extrusion: { x: 0, y: 0, z: 1 } },
  fonts,
);
for (const g of layout.glyphs) console.log(g.glyph.code, g.matrix); // font units to text plane
```

## Status

- Scoreboard ([project README](https://github.com/tth05/truedxf#scoreboard), 2026-10-01): F1(r=1) ≥ 0.99 for 278/294 `text`, 209/250 `mtext`,
  64/65 `attribs` and 21/23 `text-lato` cases, but only 15 `text` and 1 `mtext` pixel-exact.
- TrueType glyph rasterization and some positions are the largest remaining gap: text after tabs,
  wrapped `\L` paragraphs, column MTEXT with a centred attachment ([docs/TODO.md](https://github.com/tth05/truedxf/blob/master/docs/TODO.md)).
- Open or not exact: explicit `\pt` tab stops, TrueType stack geometry, `\A1`/`\A2` against
  stacks, synthetic italic, complex scripts (Arabic/Thai shaping, bidi), kerning (none).
- Several rules come from single samples or are UNVERIFIED (MTEXT decoration offsets, oblique
  order, mixed-height line pitch). The source comments say which.

In the repository, `node packages/text/scripts/oracle.ts [--suite text|mtext|attribs]` compares the layout with
AutoCAD's DXFOUT values (needs the local references in `samples/`).

## See also

- [research/notes/04-text-fonts.md](https://github.com/tth05/truedxf/blob/master/research/notes/04-text-fonts.md) (§1 TEXT, §3 MTEXT, §11 plot findings)
- [@truedxf/fonts](https://github.com/tth05/truedxf/tree/master/packages/fonts), [@truedxf/render](https://github.com/tth05/truedxf/tree/master/packages/render) (`prepareTextFonts`, drawing a `TextLayout`)

## License

MIT. AutoCAD and DXF are trademarks of Autodesk, Inc. truedxf is not affiliated with or
endorsed by Autodesk.
