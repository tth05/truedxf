# @truedxf/three

three.js (WebGL) renderer for the display lists that `@truedxf/render` produces.

## Install

```bash
pnpm add @truedxf/three three
```

ESM only. `three` (>= 0.170) is a peer dependency.

## What it does

`DisplayListRenderer` owns a `THREE.WebGLRenderer`, a `Scene` and an `OrthographicCamera`.

- `setDisplayList(list)` turns each `Batch` into one three.js object: `Mesh` for triangles,
  `LineSegments` for hairlines, `Points` for points, a textured `Mesh` for image batches
  (nearest-sampled `DataTexture` without mipmaps, while `RasterImage.smooth` images such as PDF
  underlays are filtered linearly with mipmaps).
- Draw order is the display-list order, set through `renderOrder`. Depth test and depth writes
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
  `(src·a + dst·(256 − a)) >> 8` ([note 06](https://github.com/tth05/truedxf/blob/master/research/notes/06-hatch-linetype-appearance.md) §4.2). `exactBlend: false` uses ordinary
  alpha blending.
- `overlay` and `underlay` groups take host content in world coordinates, drawn above or below the
  drawing. The viewer puts selection highlights and the paper sheet there.
- `mergeBatches: true` with `exactBlend: false` merges opaque geometry by primitive kind within
  each consecutive clip run, with buffers capped at four million vertices. Pick ranges and
  uncovered vertex ranges receive increasing global z values. `LessEqualDepth` preserves painter
  order, including primitive order within a range. The four-million-order limit leaves distinct
  24-bit depth values after float32 rounding. Larger lists fall back to the original path.
  `mergeBatches` defaults to false and is ignored with `exactBlend: true`.
- `setMergedDisplayList(list)` uploads pre-merged GPU buffers (`exactBlend: false`). Workers can
  import `mergedGroups`, `orderCount` and `MAX_DEPTH_ORDERS` from `@truedxf/three/merge` without
  loading three.js or touching the DOM. The payload contains metadata and clip-run groups with
  xyz positions, RGBA colours, and individual alpha/image parts (UVs and image indices).
  Keep the ordinary path when `orderCount(list) > MAX_DEPTH_ORDERS`.
- Merged opaque materials are shared by kind and clipping state. Unclipped opaque objects use
  the opaque queue. Clipped ones use the transparent queue with blending disabled, keeping each
  stencil reset/mask ahead of its content. Individual alpha/image batches follow the opaque
  content of their clip run, with normal blending and depth writes. Underlay, drawing and overlay
  render in separate stages. Stencil masks never write depth. Group origins are computed in
  float64 from all vertex bounds, then subtracted from the camera centre in `render()`.
- `readPixels()` returns RGBA, top row first (needs `preserveDrawingBuffer`, or a call right after
  `render`). `releaseArrays: true` drops the renderer's CPU copies of vertex arrays after GPU upload.

## Usage

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

- WebGL only. A WebGPU renderer has not been tried yet.
- No instancing: block references arrive flattened. The original path draws each batch
  separately. Merging reduces opaque draw calls but does not merge alpha/image batches.
- Changing from per-batch origins to a common clip-run origin changes float32 rounding: aliased
  edge pixels can differ from the original path. Keep merging off for exact plot comparisons.
- `exactBlend` costs one framebuffer copy per transparent batch, so interactive hosts turn it off.
- Importing the module sets `THREE.ColorManagement.enabled = false` globally, which also affects
  other three.js content on the page.

## See also

- [@truedxf/viewer](https://github.com/tth05/truedxf/tree/master/packages/viewer): interactive use of this renderer
- [@truedxf/testkit](https://github.com/tth05/truedxf/tree/master/packages/testkit): pixel comparison against AutoCAD plots

## License

MIT. AutoCAD and DXF are trademarks of Autodesk, Inc. truedxf is not affiliated with or
endorsed by Autodesk.
