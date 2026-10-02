# @truedxf/viewer

Embeddable, framework-free DXF viewer on top of `@truedxf/model`, `@truedxf/render` and
`@truedxf/three` (docs/PLAN.md Phase 7).

## Usage

```ts
import { DxfViewer } from "@truedxf/viewer";

const viewer = new DxfViewer(document.getElementById("view")!, {
  background: "dark",        // "dark" | "light" | [r, g, b]; ACI 7 contrasts with it
  fontBaseUrl: "fonts/",     // default font loader: GET fonts/<file name, lower-case>
  fallbackFont: ["simplex.shx", "arial.ttf"], // for text whose font is missing (optional)
});
await viewer.load(file);      // Uint8Array | ArrayBuffer | File/Blob | URL string
viewer.on("select", ({ handle }) => console.log(handle));
await viewer.setLayout("Layout1");
viewer.setLayerVisible("WALLS", false);
const info = await viewer.inspect(handle); // type, raw/resolved properties, raw DXF tags
```

Not on npm yet (version 0.0.0); consumed from source in the workspace. `three` is a peer
dependency.

## Embedding

Every input switch, the fitting behaviour and the view are configurable, at construction and at
runtime.

```ts
// a static picture of the drawing: no input, refits when the container resizes
new DxfViewer(el, { interaction: false, autoFit: "always" });

// in a scrolling page: Ctrl/⌘ + wheel zooms, the plain wheel scrolls the page; no click-select
new DxfViewer(el, { interaction: { zoom: "ctrl", select: false }, limits: { minZoom: 0.5, maxZoom: 50 } });

viewer.setInteraction({ pan: false, zoom: false }); // lock the view ("true" / "false" for all)
viewer.zoomToEntity("2F");                          // from your own list / search
viewer.setView({ cx: 120, cy: 40, scale: 0.05 });   // world centre, world units per CSS pixel
const png = await viewer.snapshot();                // Blob of the current view
```

| Option | Default | |
|---|---|---|
| `interaction` | `true` | `true` / `false` or switches (missing ones stay on): `pan` (drag, two fingers), `zoom` (`true`, `"ctrl"`: wheel only with Ctrl/⌘ held, trackpad pinch included, `false`), `hover` (highlight + `hover` events), `select` (click to select + `select` event; `select()` always works), `dblclickFit`, `keyboard` (focus on click, `Esc`). Turning all of them off also gives the page its wheel, touch scrolling and context menu back. `setInteraction(change)`, `interaction`. |
| `autoFit` | `"load"` | `"load"`: fit on load and layout switch. `"always"`: also on container resize, until the user or `setView` moves the view; `fit()` re-arms it. `false`: keep the view across `load()` / `setLayout()` (live preview of an edited drawing), fit only when there is none yet. `setAutoFit(mode)`. |
| `fitMargin` | `0.04` | Margin per side, relative to the drawing size. |
| `limits` | none | `{ minZoom, maxZoom }` relative to the fitted view (1 = fitted, so they work in any unit) and `keepInView` (the view centre stays inside the drawing). Applied to input and to `zoom` / `setView` / `fitTo` / `zoomToEntity`. `setLimits(limits)`. |
| `initialLayout` | `"model"` | `"model"`, `"active"` (the layout current when the file was saved, `DocumentInfo.activeLayout` from `$TILEMODE`), a layout name (falls back to model space) or `(doc) => name`. The first list is rendered for that layout directly. |
| `colors` | | `select`, `hover`, `measure` and `surround` (around a layout's paper sheet; the sheet stays white because drawing colours are contrasted against it), CSS colour strings or `0xRRGGBB`. `setColors(colors)`. |

View methods: `fit()`, `fitTo(rect, margin?)`, `zoomToEntity(handle, margin = 0.25)` (false when
the entity draws nothing in the current layout; a point only centres), `setView({ cx?, cy?,
scale? })`, `zoom(factor)`, `viewState`, `zoomLevel` (1 = fitted), `screenToWorld` /
`worldToScreen`, and the `view` event. `snapshot(type?, quality?)` draws and copies the frame in
one task, so it needs no `preserveDrawingBuffer`.

**Bundlers.** The worker is created with `new Worker(new URL("./worker.js", import.meta.url))`,
which Vite, webpack and Rollup bundle. Vite's dependency pre-bundling breaks that URL: add
`optimizeDeps: { exclude: ["@truedxf/viewer"] }`. Or pass your own `worker: () => new Worker(…)`.

## What it does

- **Worker pipeline.** Parsing, the model and display-list generation run in a module worker
  (`src/worker.ts`); display lists and pick indexes come back as transferred buffers. Without
  workers (or with `worker: false`) the same `ViewerCore` runs on the main thread, loaded lazily
  so the main bundle holds only three.js and the viewer. `@truedxf/viewer/core` exports
  `ViewerCore` and `serveWorker` for Node and custom workers. The worker's font and image
  requests are answered on the main thread: additional files first (below), then `loadFont` /
  `loadImage`, so any loader works.
- **Navigation** (each part switchable, see Embedding). Wheel zoom at the cursor, drag pan
  (left, middle or right button), touch pinch/pan, `fit()` or double-click on empty space to
  fit, `Esc` clears the selection (or the measurement). The canvas follows the container (`ResizeObserver`) and `devicePixelRatio`.
- **Level of detail.** Lists are built with `raster: "smooth"` for one pixel size (tessellation
  tolerance, lineweight widening). After zooming by more than 2× a new list is requested
  (debounced 150 ms) while the old one stays visible. Below 1/65536 of the drawing size the list
  is only magnified.
- **Layouts.** Model space and every paper-space layout (plot pipeline including viewports);
  layouts draw on a white paper sheet (layout limits) over a grey background.
- **Layers.** Any layer can be toggled, including ones off or frozen in the file
  (`RenderEnv.layerVisibility`). No-plot and Defpoints layers are shown (display, not plot).
- **Picking.** A flatbush index over the display list's pick ranges, built in the worker. Strokes
  near the cursor win over filled areas under it, then the topmost area. Like AutoCAD's selection,
  the unit is the top-level entity: a block reference, dimension or leader picks and highlights as
  a whole (block content, ATTRIBs, arrows and text included), everywhere it is drawn (several
  viewports). Viewport content is pickable only inside its viewport, and its highlight is clipped
  like the drawing. Hover and selection are highlighted in the renderer's overlay.
- **Measure.** `setTool("measure")`: two clicks give distance, Δx, Δy and angle (`measure` event).
- **Memory.** The renderer runs with `releaseArrays: true`; after GPU upload the viewer keeps only
  positions (for picking and highlighting).
- **Contrast.** Colours within 8 of pure white on a light background, or of pure black on a dark
  one (true colours, ACI 255; e.g. QCAD's layer 0 with 420 = 0xFFFFFF), are drawn like ACI 7.
  A display choice; plots are unaffected.
- **Warnings.** `viewer.warnings` and the `warnings` event explain an empty or odd-looking view:
  `ViewerWarning { code, severity: "info" | "warning", message, layout?, items?, count? }` with
  stable codes (`ViewerWarningCode`):
  - `layout-empty`: no entities in the layout; `items` lists layouts with content.
  - `layers-hidden`: every layer with content is off, frozen or toggled off.
  - `layers-no-plot`: every content layer has 290 = 0. Document info, since the viewer still
    shows such layers; a render cause with `visibility: "plot"`.
  - `nothing-visible`: entities on visible layers drew nothing.
  - `content-invisible`: everything is in the background colour.
  - Render notes passed through from `PlotResult.notes`: `font-missing` / `bigfont-missing`
    (`items` = font names; text uses `fallbackFont`), `image-missing`, `shapefile-missing`, and
    `colors-adjusted` (info; `items` like `"#FFFFFF (layer 0)"`, `"ACI 255 (layer W)"`).

  `DocumentInfo.warnings` holds the document-level ones, `RenderResult.warnings` /
  `RenderStats.warnings` those of a render.

Events: `load`, `layout`, `render` (stats and timings), `select`, `hover`, `cursor` (world
coordinates), `view`, `busy`, `measure`, `warnings`, `files`, `error`.

## Additional files (fonts, shape files, images)

A DXF names its fonts, shape files and images, often by a path on the machine that wrote it
(`C:\Program Files\Autodesk\AutoCAD 2027\Fonts\txt.shx`, `..\images\photo.jpg`,
`\\server\share\logo.png`) or by a bare name (`txt`, `romans`). A browser cannot open those
paths, so the viewer keeps a store of files you hand it and matches requests by file name.

```ts
const { opened, drawings, document } = await viewer.openFiles(input.files); // drawing + resources
await viewer.openDrawing(drawings[1].path);           // another drawing among them; files stay
viewer.addFiles([{ name: "romans.shx", data: bytes }]); // File objects or { name, data: Uint8Array | Blob, path? }
viewer.missingFiles;                                  // ["textstyle1", "C:\\images\\photo.jpg"]
viewer.findFile("C:\\any\\dir\\TXT.SHX", "font");     // which stored file a name resolves to
```

- **API.** `addFiles(files)` returns the added `ViewerFile`s and re-renders the open drawing.
  `openFiles(files, { drawing? })` adds every file (drawings too) and opens `drawing` (name or
  path, loosely matched; `false` = add only), by default the first `.dxf` among `files`; with no
  drawing among them it only adds. `openDrawing(nameOrPath)` opens a stored drawing.
  `removeFile(nameOrPath)` (a path, or every file with a name), `clearFiles()`,
  `files` (`{ name, path, size, kind: "drawing" | "font" | "image" | "other" }`) and the `files`
  event complete it. Opening another drawing keeps the files; call `clearFiles()` to start over.
  `File`s are read only when the renderer asks for them. `reloadAssets()` looks every font and
  image up again when your `loadFont` / `loadImage` start returning other files.
- **Lookup order** for fonts (`.shx`, `.ttf`, `.ttc`, `.otf`, big fonts, shape files of SHAPEs and
  complex linetypes) and images (IMAGEDEF, PDF underlay):
  1. the additional files;
  2. `loadFont` (default: the `fontBaseUrl` fetch loader) or `loadImage`;
  3. images of a drawing opened from a URL (`resolveRelativeToDrawing`, default true): a relative
     path resolved against the drawing URL, then the base name in the drawing's folder
     (`https://host/plans/a.dxf` with `C:\work\plans\photo.jpg` gets `https://host/plans/photo.jpg`).
- **Matching.**
  - The request is split on `/` and `\`; only the base name is compared, case-insensitively, so
    `C:\…\Fonts\txt.shx`, `\\server\fonts\TXT.SHX` and `txt.shx` all find a stored `TXT.shx`.
  - A name without extension also finds stored files with a known extension, in the font
    resolver's order (`txt` → `txt.shx`, `.ttf`, `.ttc`, `.otf`; images: the raster extensions).
    A request with an extension never matches another extension.
  - Several stored files with the same name: a relative request (`..\images\photo.jpg`) resolved
    against the open drawing's folder (when it came from the files) wins if it names one exactly;
    otherwise the most trailing folders in common with the request (`…\AutoCAD 2027\Fonts\txt.shx`
    prefers `acad/AutoCAD 2027/Fonts/txt.shx` over `old/txt.shx`), then the file closest to the
    drawing's folder, then the shallower path, then code-unit order.
- **Folders.** Paths come from `File.webkitRelativePath` (`<input type="file" webkitdirectory>`)
  or from `{ path }` (e.g. a dropped folder read with `DataTransferItem.webkitGetAsEntry()`, using
  `fullPath`; see `apps/playground/src/files.ts`). They only tell same-named files apart.
- **Re-rendering.** Every change bumps a generation passed to the backend with the next render
  (`RenderParams.assets`). The backend then hands the renderer new loader functions, so the font
  cache and decoded images (cached per loader) are looked up again, the drawing re-renders and
  `warnings` / `missingFiles` update. A font already found keeps its source unless a stored file
  now matches first.
- **Missing files.** `missingFiles` collects the `items` of the `MISSING_FILE_CODES` warnings
  (`font-missing`, `bigfont-missing`, `image-missing`, `shapefile-missing`) as the drawing writes
  them: font names may be style font names without extension, or family names.
- **Worker.** Files stay on the main thread; the worker requests one at a time and gets a copy of
  its bytes.

## Limitations

- TrueType fonts named by family (STYLE XDATA, MTEXT `\f`) are found only when the file is named
  after the family (`My Font` → `MyFont.ttf` / `myfont.ttf`) or is a known family file
  (`arial.ttf`, …); stored files' name tables are not scanned.
- XREF drawings are not loaded, though the store already holds `.dxf` files (kind `drawing`).
- The default worker is `new Worker(new URL("./worker.ts", import.meta.url))`, which bundlers such
  as Vite resolve only when the package is consumed from source. Otherwise pass
  `worker: () => new Worker(...)` pointing at your build of `@truedxf/viewer/worker`.
- No view culling: every list tessellates the whole drawing, so a LOD step costs about as much as
  the first render.
