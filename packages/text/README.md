# @truedxf/text

DXF TEXT and MTEXT layout that lines up with AutoCAD: wrapping, stacking, columns, SHX and TrueType glyphs.

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

## Limitations

- No kerning, no complex-script shaping (Arabic, Thai) and no bidi.
- Explicit `\pt` tab stops, TrueType stack geometry, `\A1`/`\A2` next to stacks and synthetic
  italic are approximations.

## License

MIT. AutoCAD and DXF are trademarks of Autodesk, Inc. truedxf is not affiliated with or
endorsed by Autodesk.
