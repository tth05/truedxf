# @truedxf/viewer

An embeddable, framework-free DXF viewer built on `@truedxf/model`, `@truedxf/render` and
`@truedxf/three` (docs/PLAN.md Phase 7).

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

## Features

- **Worker pipeline.** Parsing, the model and display-list generation run in a module worker
  (`src/worker.ts`); display lists and pick indexes come back as transferred buffers. When
  workers are unavailable (or `worker: false`) the same `ViewerCore` runs on the main thread,
  loaded lazily so the main bundle stays small (three.js + viewer). `@truedxf/viewer/core`
  exports `ViewerCore` / `serveWorker` for Node and custom workers.
  Font and image requests from the worker are answered on the main thread — from the
  additional files first (see below), then by the configured loaders (`loadFont`,
  `loadImage`), so any loader works.
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

- **Warnings.** `viewer.warnings` (and the `warnings` event) explain an empty or odd-looking
  view: `ViewerWarning { code, severity: "info" | "warning", message, layout?, items?, count? }`
  with stable codes (`ViewerWarningCode`): `layout-empty` (no entities in the layout; `items`
  lists layouts with content), `layers-hidden` (every layer with content is off / frozen /
  hidden by a toggle), `layers-no-plot` (every content layer has 290 = 0: document info, since
  the viewer still shows such layers; a render cause with `visibility: "plot"`),
  `nothing-visible` (entities on visible layers drew nothing), `content-invisible` (everything
  is in the background colour), and render notes passed through from `PlotResult.notes`, e.g.
  `font-missing` / `bigfont-missing` (`items` = font names; the text is drawn with
  `fallbackFont`) and `colors-adjusted` (info: near-white / near-black colours drawn in black /
  white for contrast; `items` = `"#FFFFFF (layer 0)"`, `"ACI 255 (layer W)"`). `DocumentInfo.warnings` holds the document-level ones, `RenderResult` /
  `RenderStats.warnings` those of a render.

Events: `load`, `layout`, `render` (stats and timings), `select`, `hover`, `cursor` (world
coordinates), `view`, `busy`, `measure`, `warnings`, `files`, `error`.

## Additional files (fonts, shape files, images)

A DXF file does not contain its fonts, shape files or raster images; it names them — often by a
path of the machine that wrote it (`C:\Program Files\Autodesk\AutoCAD 2027\Fonts\txt.shx`,
`..\images\photo.jpg`, `\\server\share\logo.png`) or by a bare name (`txt`, `romans`). A browser
can never open those paths, so the viewer keeps a store of **additional files** that you hand it
and matches requests against it **by file name**.

```ts
// a <input type="file" multiple> selection or a drop: the drawing and its resources at once
const { opened, drawings } = await viewer.openFiles(input.files);
// several drawings among them: open another one later (the resources stay)
await viewer.openDrawing(drawings[1].path);

// add resources to the open drawing later: it re-renders, warnings update
viewer.addFiles(moreFiles);                          // File objects …
viewer.addFiles([{ name: "romans.shx", data: bytes }]); // … or { name, data: Uint8Array | Blob, path? }
viewer.missingFiles;   // ["textstyle1", "C:\\images\\photo.jpg"] — what the drawing still lacks
viewer.files;          // [{ name, path, size, kind: "drawing" | "font" | "image" | "other" }]
viewer.findFile("C:\\any\\dir\\TXT.SHX", "font");    // which stored file a name resolves to
viewer.removeFile("fonts/txt.shx");                  // by path, or every file with a name
viewer.clearFiles();
```

- **API.** `addFiles(files)` → the added `ViewerFile`s; `openFiles(files, { drawing? })` adds
  every file (drawings too) and opens `drawing` (a name or path, loosely matched; `false` = add
  only, e.g. to let the user choose first), by default the first `.dxf` among `files`; it
  returns `{ drawings, opened, document }`. Without a drawing among the files it only adds them
  (and re-renders the open drawing). `openDrawing(nameOrPath)` opens a stored drawing.
  `removeFile`, `clearFiles`, `files`, `findFile`, `missingFiles` and the `files` event complete
  it. Opening another drawing keeps the files (resources are often shared); call `clearFiles()`
  to start over. `File`s are kept as they are and read only when the renderer asks for them.
- **Lookup order** for every font (`.shx` / `.ttf` / `.ttc` / `.otf`, big fonts, the shape files
  of SHAPEs and complex linetypes) and every image (IMAGEDEF, PDF underlay) request:
  1. the additional files;
  2. `loadFont` / the `fontBaseUrl` fetch loader for fonts, `loadImage` for images;
  3. images only, for a drawing opened from a URL (`load(url)`, `resolveRelativeToDrawing`,
     default true): the path resolved relative to the drawing URL (when it is relative), then
     the base name in the drawing's folder. A drawing at `https://host/plans/a.dxf` with an image
     `C:\work\plans\photo.jpg` gets `https://host/plans/photo.jpg`.
- **Loose matching.**
  - The request is split on `/` and `\`; only its **base name** is compared, case-insensitively:
    `C:\Program Files\Autodesk\AutoCAD 2027\Fonts\txt.shx`, `\\server\fonts\TXT.SHX` and
    `txt.shx` all find a stored `TXT.shx`.
  - A name **without extension** also finds stored files with a known extension added, in the
    order the font resolver uses: `txt` → `txt.shx`, then `txt.ttf`, `.ttc`, `.otf` (images: the
    raster extensions). Requests with an extension never match a different extension.
  - Several stored files with the same name (a folder with subfolders): a relative request
    (`..\images\photo.jpg`) resolved against the folder of the open drawing (when it came from
    the files) wins if it names one exactly; otherwise the file whose path shares the **most
    trailing folders** with the request (`…\AutoCAD 2027\Fonts\txt.shx` prefers
    `acad/AutoCAD 2027/Fonts/txt.shx` over `old/txt.shx`), then the one closest to the drawing's
    folder, then the shallower path, then the path in code-unit order — deterministic.
- **Folders.** Paths come from `File.webkitRelativePath` (an `<input type="file"
  webkitdirectory>` — Chromium, Firefox and Safari support it) or from `{ path }` (e.g. a dropped
  folder read with `DataTransferItem.webkitGetAsEntry()`, using the entries' `fullPath`; see
  `apps/playground/src/files.ts`). They only serve to tell same-named files apart.
- **Adding files later.** Every change of the files bumps a generation that is passed to the
  backend with the next render (`RenderParams.assets`). The backend then hands the renderer new
  loader functions, so the text layer's font cache and the decoded images (both cached per loader
  function) are looked up again; the open drawing re-renders at once and `warnings` /
  `missingFiles` update. Fonts that were already found keep coming from the same place unless a
  stored file now matches first.
- **What is missing.** `viewer.warnings` carries the render notes `font-missing`,
  `bigfont-missing`, `image-missing` (IMAGEDEF paths of IMAGE entities whose file was not found)
  and `shapefile-missing` (shape files a SHAPE needs) with the names in `items`;
  `viewer.missingFiles` collects those items (`MISSING_FILE_CODES`). Names are as the drawing
  writes them — font names may be style font names without extension or family names.
- **Memory / worker.** The files stay on the main thread; the worker requests one file at a time
  (the existing font / image request messages) and gets a copy of its bytes. Nothing is copied
  into the worker up front.

## Notes and limits

- Additional files: TrueType fonts named by family (STYLE XDATA, MTEXT `\f`) are found when the
  file is named after the family (`My Font` → `MyFont.ttf` / `myfont.ttf`) or is a known family
  file (`arial.ttf`, …); the font name tables of stored files are not scanned. External
  references (XREF drawings) are not loaded; the store already holds `.dxf` files (kind
  `drawing`), so an xref loader could resolve them with the same matching.

- The default worker is created with `new Worker(new URL("./worker.ts", import.meta.url))`,
  which bundlers such as Vite resolve when the package is consumed from source (as in this
  monorepo). Otherwise pass `worker: () => new Worker(...)` pointing at your build of
  `@truedxf/viewer/worker`.
- The frontend tessellates the whole drawing for every list (no view culling yet), so a LOD
  step costs about as much as the first render.
- Near-white colours on a light background and near-black ones on a dark background (within 8
  of pure white / black, true colours and ACI 255) contrast with it like ACI 7 in the viewer —
  e.g. QCAD's layer 0 with 420 = 0xFFFFFF. A display choice; plots are unaffected.
