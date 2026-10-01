# @truedxf/three

three.js (WebGL) renderer for the display lists that `@truedxf/render` produces.

## What it does

`DisplayListRenderer` owns a `THREE.WebGLRenderer`, a `Scene` and an `OrthographicCamera`.

- `setDisplayList(list)` turns each `Batch` into one three.js object: `Mesh` for triangles,
  `LineSegments` for hairlines, `Points` for points, a textured `Mesh` for image batches
  (nearest-sampled `DataTexture`, no mipmaps).
- Draw order is the display-list order, set through `renderOrder`; depth test and depth writes
  are off.
- Colours pass through unchanged: three.js colour management is disabled and the output colour
  space is linear, so the RGB bytes in the list are the bytes in the framebuffer.
- Precision: positions are float32 relative to each batch's float64 origin. `render(view)`
  subtracts the view centre from the origins on the CPU, so large world coordinates do not
  jitter.
- Clip regions (`DisplayList.clips`, viewport and XCLIP boundaries) go into the stencil buffer as
  triangle fans with `InvertStencilOp`, which gives even-odd coverage for any polygon.
- Transparency: with `exactBlend` (default `true`) a batch with alpha < 255 copies the frame
  below it to a texture and blends in a shader with AutoCAD's integer plot formula
  `(src·a + dst·(256 − a)) >> 8` (research/notes/06 §4.2). `exactBlend: false` uses ordinary
  alpha blending.
- `overlay` and `underlay` groups take host content in world coordinates, drawn above or below the
  drawing. The viewer puts selection highlights and the paper sheet there.
- `readPixels()` returns RGBA, top row first (needs `preserveDrawingBuffer`, or a call right after
  `render`). `releaseArrays: true` drops the renderer's CPU copies of vertex arrays after GPU upload.

## Usage

`three` (>= 0.170) is a peer dependency. Not on npm yet (version 0.0.0): use it from source in
this workspace (`"@truedxf/three": "workspace:*"`).

```ts
import { loadDxf } from "@truedxf/model";
import { renderPlot } from "@truedxf/render";
import { DisplayListRenderer } from "@truedxf/three";

const doc = loadDxf(new Uint8Array(await (await fetch("plan.dxf")).arrayBuffer()));
const plot = await renderPlot(doc, { layout: "Model", area: { type: "extents" }, canvas: [2000, 1500] });

const renderer = new DisplayListRenderer({ canvas: document.querySelector("canvas")!, preserveDrawingBuffer: true });
renderer.setSize(2000, 1500, true);
renderer.setDisplayList(plot.displayList);
renderer.render(plot.view); // world window { minX, minY, maxX, maxY }, stretched to the canvas
const { width, height, data } = renderer.readPixels();
```

`render` maps the window onto the whole canvas, so keep its aspect equal to the canvas aspect.
Call `clear()` before dropping a list and `dispose()` when done.

## Limitations

- WebGL only; the WebGPU trial (docs/PLAN.md Phase 7) has not started.
- No instancing: the display list has no symbol/instance structure yet, so block references
  arrive flattened and every batch is its own draw call. Drawings that mix hairlines with widened
  strokes fragment into thousands of batches (docs/TODO.md, "Batch fragmentation").
- `exactBlend` costs one framebuffer copy per transparent batch; interactive hosts turn it off.
- Importing the module sets `THREE.ColorManagement.enabled = false` globally, which also affects
  other three.js content on the page.

## See also

- [docs/PLAN.md](../../docs/PLAN.md) §4.2a (display list) and §4.2b (three.js rules)
- [@truedxf/viewer](../viewer/README.md): interactive use of this renderer
- [@truedxf/testkit](../testkit/README.md): pixel comparison against AutoCAD plots
