# @truedxf/render

Draws DXF exactly like an AutoCAD plot. Fast, renderer-agnostic display lists, pixel-tested against thousands of AutoCAD plots.

It walks a model-space or paper-space layout of a `DxfDocument` and emits a display list that
any renderer can draw, such as [@truedxf/three](https://www.npmjs.com/package/@truedxf/three).

## Install

```bash
pnpm add @truedxf/render
```

ESM only. No DOM and no Node.js APIs: runs in browsers, workers and Node.

## What it does

- `renderPlot(doc, request, env)` returns `PlotResult { displayList, view, unsupported, notes? }`.
  `PlotRequest` picks the layout, the plot area (`window` with Fit + Center, `extents`, `layout`
  at 1 px per paper unit or an explicit scale) and the canvas in device pixels.
- All geometry work happens here: tessellation, linetypes (including complex linetypes with shapes
  and text), lineweight widening, hatch fills, clipping. The `DisplayList` holds batches of
  `Triangles`, `Lines` (1 px), `Points` and textured `Image` triangles in strict draw order, float32
  positions relative to a float64 origin, clip regions and pick ranges back to entity handles.
  `transferables(list)` lists its buffers for `postMessage`.
- `raster: "autocad"` (default) computes pixel spans on the CPU with AutoCAD's raster rules for
  thin lines, arcs, lineweight polygons and fills (`PixelGrid`, `linePixels`, `arcVertices`,
  `fillPolygon`) at the driver's 100 dpi. `raster: "smooth"` gives plain geometry for viewers.
- Properties (`PropertyResolver`): ByLayer/ByBlock, layer on/off/frozen/no-plot/Defpoints,
  per-viewport freeze, the plotted ACI palette (`PLOT_ACI_RGB`), plotted transparency
  (PLOTTRANSPARENCYOVERRIDE), draw order (SORTENTSTABLE with `$SORTENTS`).
- Plot styles (@truedxf/plot): CTB pens by resolved ACI, STB styles by name; pen colour,
  grayscale, screening, lineweight, end / join styles, pen linetypes (fixed and adaptive) and
  raster fill styles. `PlotRequest.styleTable` names the table; its bytes come from
  `plotStyleTable`, `env.loadPlotStyleTable`, or the built-in equivalents of the stock tables.
- Stored page setups: `PlotRequest.pageSetup` plots a layout's PLOTSETTINGS like a non-detailed
  -PLOT (area, scale, rotation, margins, offsets, style table, switches); `PlotResult.canvas` is
  then the printable area.
- Entities: LINE, CIRCLE, ARC, ELLIPSE, SPLINE, LWPOLYLINE, POLYLINE, POINT (PDMODE), SOLID, TRACE,
  3DFACE, RAY, XLINE, INSERT/MINSERT with ATTRIBs and XCLIP, TEXT, MTEXT, ATTDEF, SHAPE, HATCH,
  MPOLYGON, DIMENSION (regenerated with `generateDimension` when the `*D` block is missing),
  LEADER, MULTILEADER, TOLERANCE, MLINE, MESH, HELIX, ACAD_TABLE (its block), IMAGE and WIPEOUT
  (PNG, JPEG, TIFF, BMP), REGION/3DSOLID/BODY/surfaces as ACIS wireframe (SAT and SAB), proxy
  graphics, VIEWPORT, PDF underlays (content through `env.pdf`, e.g. @truedxf/pdf with PDF.js),
  DWF / DGN underlays (frames only) and OLE frames.
- Fonts and images come from the host through `env.loadFont` / `env.loadImage`. Text is laid out
  by @truedxf/text. `env.text.missingFont` chooses AutoCAD's missing-font behaviour or a fallback
  font. Missing fonts show up in `PlotResult.notes` (`font-missing`, `bigfont-missing`).

Importing the package registers every drawer (side effects in `src/draw/*.ts`). `registerDrawer`
and `registerPreparer` add more.

## Usage

```ts
import { readFile } from "node:fs/promises";
import { loadDxf } from "@truedxf/model";
import { type PlotRequest, renderPlot } from "@truedxf/render";

const doc = loadDxf(new Uint8Array(await readFile("drawing.dxf")));
const request: PlotRequest = { layout: "Model", area: { type: "extents" }, canvas: [1600, 1200] };
const { displayList, view, unsupported, notes } = await renderPlot(doc, request, {
  // font bytes by lower-cased file name ("txt.shx", "arial.ttf"); undefined = missing
  loadFont: (name) => readFile(`fonts/${name}`).then((b) => new Uint8Array(b), () => undefined),
});
// view: the world window that maps onto the canvas; draw the batches in order without depth testing
console.log(displayList.batches.length, view, unsupported, notes);
```

For a paper-space layout pass its name and `area: { type: "layout" }` (or a `window` in paper
units). Viewers pass `raster: "smooth"`, `visibility: "display"` and `layerVisibility`, as
[viewer/src/protocol.ts](https://github.com/tth05/truedxf/blob/master/packages/viewer/src/protocol.ts) does.

## Limitations

- Plot styles: pen linetypes on wide polylines and the exact outline of wide pen-linetype dots
  are approximations; fill styles follow the raster driver only (no PDF tiling).
- Page setups: display and view plot areas are plotted as extents; PLOTROTMODE 0/1 (not in the
  DXF) is not modelled. Without `pageSetup` the caller supplies the plot area and canvas
  (`PlotRequest`, docs/fixtures.md). Extents plots miss AutoCAD's padding (extents suite 9/18 at
  F1(r=1) ≥ 0.99).
- Model space is drawn in plan view (the `*ACTIVE` VPORT view direction is not applied).
  Perspective viewports are not supported.
- Open features: wide polylines with linetypes, some
  MULTILEADER variants, XCLIP of ATTRIBs. Raster gaps: exact-pixel ties, spline tessellation, hatch
  islands, clipped huge arcs ([docs/TODO.md](https://github.com/tth05/truedxf/blob/master/docs/TODO.md)).

## License

MIT. AutoCAD and DXF are trademarks of Autodesk, Inc. truedxf is not affiliated with or
endorsed by Autodesk.
