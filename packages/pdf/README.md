# @truedxf/pdf

PDF underlays for truedxf DXF drawings, rendered by PDF.js and placed exactly where AutoCAD puts them.

truedxf never parses or draws PDF itself: [PDF.js](https://mozilla.github.io/pdf.js/)
(`pdfjs-dist`, Apache-2.0) renders the page and
[@truedxf/render](https://www.npmjs.com/package/@truedxf/render) places the pixels like an IMAGE.

## Install

```bash
pnpm add @truedxf/pdf
```

ESM only. Brings `pdfjs-dist` along as a dependency.

```ts
import { createPdfRasterizer } from "@truedxf/pdf";
import { renderPlot } from "@truedxf/render";

const pdf = createPdfRasterizer({ assetsUrl: "/pdfjs/" }); // keep one per app: it caches files
const result = await renderPlot(doc, request, { loadImage, pdf });
```

`@truedxf/viewer` creates one by default (`DxfViewer` option `pdf`).

## What it does

- `createPdfRasterizer(options)` returns a `PdfRasterizer` (`RenderEnv.pdf`). PDF files are
  fetched through the renderer's `loadImage`, like image files.
- The renderer asks for each underlay's page through an affine transform at the target
  resolution, so rotated and mirrored underlays are rendered straight into device pixels. Plots
  rasterize only the part in view. Interactive lists cover the whole page, up to `maxSize`
  pixels (default 4096) on the longer side.
- PDF.js is imported on the first `open()`: drawings without PDF underlays never load it. It
  parses in the calling thread (PDF.js "fake worker"), which in the viewer is already its worker,
  so no worker script URL has to be configured.
- Browsers and workers draw into an `OffscreenCanvas`. Node uses the legacy build of PDF.js and
  its canvas factory (`@napi-rs/canvas`, an optional dependency of pdfjs-dist).
- Deterministic output: glyphs are drawn as paths (no FontFace, no system fonts), no GPU canvas.
- `assetsUrl` is a folder with pdfjs-dist's `standard_fonts/`, `cmaps/`, `wasm/` and `iccs/`
  folders, copied from the package. Only PDFs with non-embedded standard fonts, CJK CMaps,
  JPEG 2000 / JBIG2 images or ICC colours need them. Without it, such content falls back or is
  skipped.

Contrast, fade, monochrome and the clip boundary are applied by the renderer, with the formulas
fitted to AutoCAD's plots ([note 07](https://github.com/tth05/truedxf/blob/master/research/notes/07-blocks-inserts-misc.md) §10.3).

## Limitations

- No vector output: underlay content is a bitmap, so it cannot be picked, inspected or snapped
  to. Deep zoom in the viewer is limited by `maxSize`.
- PDF.js antialiases fill edges and draws strokes at least 1 pixel wide, but AutoCAD's plot does
  neither (Q-0746).
- No per-underlay PDF layer (OCG) states: the PDF's default layer visibility is used.
- Encrypted PDFs (with a password) are reported as missing (`pdf-missing`).

## License

MIT. AutoCAD and DXF are trademarks of Autodesk, Inc. truedxf is not affiliated with or
endorsed by Autodesk.
