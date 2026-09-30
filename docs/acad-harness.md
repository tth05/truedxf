# AutoCAD reference harness (overview)

The harness in [tools/acad](../tools/acad/README.md) turns generated fixtures
(`samples/generated/<suite>/<case>.{dxf,json}`, contract: [fixtures.md](fixtures.md)) into
AutoCAD references (`samples/refs/acad2027-R26.0/<suite>/<case>.{png,pdf,dxf,log,json}`).

```bash
node tools/acad/src/configs.ts                 # once: generate truedxf PNG/PDF .pc3 + .pmp
node tools/acad/src/run.ts --suite <suite>     # plot new/changed cases (parallel, skips up-to-date)
```

What consumers of the references need to know (details: research/notes/08 §10, note 06 §3.5):

- **Canvases:** 2000×1500 (default), 1000×1000, 800×600 (+ 4000×3000 for calibration). Square
  sheets are plotted Portrait (Landscape would rotate them).
- **Mapping:** `u = (x − xmin)·W/(xmax − xmin)`, `v = (y − ymin)·H/(ymax − ymin)`, pixel
  `(floor u, floor v)`, image row `H−1−floor v`; no printable-area inset. Exact pixel-boundary
  coordinates are ambiguous — keep fixture geometry off them (offset the window by half a pixel).
- **Raster:** RGB 8-bit PNG, white background, no anti-aliasing, fixed 100 dpi. Thin geometry is
  snapped to pixels before rasterization. Lineweight px = `max(1, round(mm × 100/25.4))`, round caps.
- **Colours:** AutoCAD 2027's plot palette (note 06 §3.5), ACI 7 → black, true colours exact —
  also under monochrome.ctb (use ACI colours for monochrome geometry tests).
- **Statuses** in `<case>.json`: `ok`, `invalid-fixture` (AutoCAD rejected the DXF), `timeout`,
  `crash`, `harness-failure` (the harness, not the renderer, is at fault — never score these).
- **Determinism:** PNGs are byte-identical across runs; PDFs differ only in their timestamps.
- The harness zooms to the window centre before each Window plot; without it AutoCAD trims and
  re-centres Window plots whose geometry comes close to the window edge (note 08 §10.1).
