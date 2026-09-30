# @truedxf/viewer

An embeddable, framework-free DXF viewer built on `@truedxf/model`, `@truedxf/render` and
`@truedxf/three` (docs/PLAN.md Phase 7).

```ts
import { DxfViewer } from "@truedxf/viewer";

const viewer = new DxfViewer(document.getElementById("view")!, {
  background: "dark",        // "dark" | "light" | [r, g, b]; ACI 7 contrasts with it
  fontBaseUrl: "fonts/",     // default font loader: GET fonts/<file name, lower-case>
});
await viewer.load(file);      // Uint8Array | ArrayBuffer | File/Blob | URL string
viewer.on("select", ({ handle }) => console.log(handle));
await viewer.setLayout("Layout1");
viewer.setLayerVisible("WALLS", false);
const info = await viewer.inspect(handle); // type, raw/resolved properties, raw DXF tags
```

## Features

- **Worker pipeline.** Parsing, the model and display-list generation run in a module worker
  (`src/worker.ts`); display lists and pick indexes come back as transferred buffers. When
  workers are unavailable (or `worker: false`) the same `ViewerCore` runs on the main thread,
  loaded lazily so the main bundle stays small (three.js + viewer). `@truedxf/viewer/core`
  exports `ViewerCore` / `serveWorker` for Node and custom workers.
  Font and image requests from the worker are answered on the main thread by the configured
  loaders (`loadFont`, `loadImage`), so any loader works.
- **Navigation.** Wheel zoom at the cursor, drag pan (left or middle button), touch pinch/pan,
  double-click on empty space or `fit()` to fit, `Esc` clears the selection. Resize via
  `ResizeObserver`; the drawing buffer follows `devicePixelRatio`.
- **Level of detail.** Lists are built with `raster: "smooth"` for a pixel size (tessellation
  tolerance and lineweight widening). After zooming by more than 2× a new list is requested
  (debounced 150 ms) while the old one stays visible. Deep zoom is clamped to
  1/65536 of the drawing size (beyond that the list is only magnified).
- **Layouts.** Model space and every paper-space layout (plot pipeline incl. viewports); layouts
  draw on a white paper sheet (layout limits) over a grey background.
- **Layers.** Toggle any layer, including ones that are off or frozen in the file
  (`RenderEnv.layerVisibility`). No-plot and Defpoints layers are shown (display, not plot).
- **Picking.** A flatbush index over the display list's pick ranges, built in the worker; strokes
  near the cursor win over filled areas under it, then the topmost area. Hover and selection are
  highlighted in an overlay.
- **Measure.** `setTool("measure")`: two clicks → distance, Δx, Δy, angle (`measure` event).
- **Memory.** `DisplayListRenderer({ releaseArrays: true })` drops vertex colours / UVs after GPU
  upload; the viewer keeps only positions (for picking and highlighting).

Events: `load`, `layout`, `render` (stats and timings), `select`, `hover`, `cursor` (world
coordinates), `view`, `busy`, `measure`, `error`.

## Notes and limits

- The default worker is created with `new Worker(new URL("./worker.ts", import.meta.url))`,
  which bundlers such as Vite resolve when the package is consumed from source (as in this
  monorepo). Otherwise pass `worker: () => new Worker(...)` pointing at your build of
  `@truedxf/viewer/worker`.
- The frontend tessellates the whole drawing for every list (no view culling yet), so a LOD
  step costs about as much as the first render.
- Pure black / white true colours contrast with the background like ACI 7 in the viewer (a
  display choice; plots are unaffected).
