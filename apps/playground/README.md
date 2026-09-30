# truedxf playground

A Vite app around `@truedxf/viewer`.

```bash
pnpm playground            # dev server on http://localhost:5173
pnpm playground:build      # static build in apps/playground/dist
```

- **Modes** (only when the local `samples/` folder exists): **Viewer**, **Fixtures** (suite /
  case browser with scores from `samples/reports/scoreboard/*.log` and
  `samples/out/visual/results.json`; compare our plot-mode render — raster `autocad`, the case's
  plot request — with `samples/refs/acad2027-*/<suite>/<case>.png` side by side, as onion skin or
  as a diff: red = only AutoCAD, blue = only truedxf, grey = both) and **Corpus** (search
  `samples/external/manifest.jsonl` by path / title, entity type, version, producer).
- **Open** a DXF with the button, `Ctrl+O`, drag and drop, or `?file=<url>` (in dev, local
  files load through Vite's `/@fs/<absolute path>` URLs).
- **Layouts** and **Layers** (click: toggle, Alt+click: isolate, filter box) in the left panel.
- **Inspector**: click an entity for its type, handle, owning block, layer, colour / linetype /
  lineweight / transparency (raw → resolved) and the raw DXF tags of its record.
- **Measure** (`M`): two clicks. **Fit** (`F` or double-click on empty space). Dark / light
  background, lineweights on/off.
- Status bar: file, entity count, parse / render / upload times, first frame, batches and
  vertices, backend (worker or main thread), cursor world coordinates. The Diagnostics panel lists
  what the renderer could not draw (`unsupported` counts), model diagnostics and entity types.

## Fonts

`/fonts/<file>` serves `packages/fonts/assets` (our MIT test fonts, also copied into the build).
The **dev server only** additionally serves the local system font folders and
`C:\Program Files\Autodesk\AutoCAD 2027\Fonts` (extra folders: `TRUEDXF_FONT_DIRS`, `;`-separated),
so real drawings get real fonts on this machine. Nothing from those folders is copied into the
repository or the build output.

## Tests and performance

- `apps/playground/test/samples.test.ts`: the samples API on a temporary folder.
- `apps/playground/test/smoke.test.ts`: builds the app, serves it with `vite preview`, opens a
  small DXF in headless Chromium (SwiftShader), checks drawn pixels and click → selection →
  inspector. Skipped when Playwright's Chromium is not installed.
- `pnpm perf:viewer [--count 5] [--files external/…] [--gpu]`: opens the largest ASCII DXFs of
  the corpus in the built app and reports parse / frontend / upload / first-frame / frame times
  (SwiftShader by default, so pessimistic). Results: `samples/reports/viewer-perf.json`.

Measured 2026-10-01 (`pnpm perf:viewer --count 6`, headless Chromium on SwiftShader, 1600×1000,
worker backend; the 75.8 MB file renders at ~15 ms per frame on this machine's GPU):

| File | MB | parse | frontend | first frame | vertices / batches | frame (SwiftShader) |
|---|---|---|---|---|---|---|
| spline_points_large | 80.2 | 1.7 s | 3.3 s | 5.3 s | 1.67 M / 2 | 104 ms |
| 1#门诊…(proxy entities) | 75.8 | 0.8 s | 1.6 s | 3.1 s | 2.40 M / 3976 | 242 ms |
| ellipse_large | 43.7 | 1.1 s | 1.1 s | 2.4 s | 1.73 M / 2 | 118 ms |
| arcs-large | 40.4 | 1.4 s | 1.2 s | 2.9 s | 2.87 M / 3 | 240 ms |
| lines_large | 35.6 | 1.0 s | 0.6 s | 1.9 s | 0.38 M / 1 | 27 ms |
| Mr DIY … Elektrik Projeler | 34.5 | 0.3 s | 1.3 s | 1.9 s | 1.98 M / 1972 | 181 ms |

