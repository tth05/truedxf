# @truedxf/testkit

Private tooling that renders generated DXF fixtures and scores them against AutoCAD reference
plots.

## What it does

- `src/visual.ts` (`pnpm test:visual`): builds the harness page (`harness/`, Vite) into
  `.harness-dist`, serves it with fonts and images on 127.0.0.1, and drives it in headless
  Chromium through Playwright with SwiftShader (`--use-angle=swiftshader`). Each case goes
  `loadDxf` → `renderPlot` → `DisplayListRenderer` (aliased) → PNG, then is compared with the
  reference. Output in `samples/out/visual/`: `<suite>/<case>.png`, `<case>.diff.png`,
  `results.json`, `report.html`.
- `src/cpu-raster.ts`: `rasterize(list, view, canvas)` draws a display list built with
  `raster: "autocad"` on the CPU: points light their pixel, triangles cover pixels whose centre is
  inside (top-left rule), clips are even-odd masks, images are sampled nearest, alpha uses
  AutoCAD's integer blend. `Lines` primitives are not supported (that mode emits thin geometry as
  pixels).
- `src/cpu-suite.ts`: scores whole suites with `rasterize` in Node, no browser. This is the scorer
  behind the scoreboard in the root README; `--json` writes the per-case report the playground's
  Fixtures view reads.
- `src/metrics.ts`: `compare(a, b)` → `Metrics`, and `diffImage(a, b)` (red = only AutoCAD,
  blue = only truedxf, light grey = identical, dark grey = colour differs).
- `src/experiment.ts` (calibration-override sweeps on one case), `src/inspect.ts` (what the
  frontend could not render), `src/png.ts` (`readPng`, `decodePng`, `writePng`).

## Scoring

`compare` takes our image and the reference, same size, RGBA. Ink is any pixel whose RGB differs
from the background (white by default).

- **Pixel-exact:** `exactMismatch` counts pixels whose RGB differs at all (no tolerance). A case
  is exact when it is 0.
- **F1 at radius r** (r = 0, 1, 2): one of our ink pixels matches if the reference has an ink pixel
  within Chebyshev distance r whose channels each differ by at most `channelTolerance` (default
  8). Precision is the matched share of our ink, recall the matched share of AutoCAD's ink
  (matched the same way in reverse), F1 = 2PR / (P + R). Two empty images score 1, one empty image 0.
- The scoreboard counts a case as passing at F1(r=1) ≥ 0.99; both runners print that count and
  the exact count.

## Usage

Needs local data that is not in the repo: fixtures in `samples/generated/<suite>/<case>.{dxf,json}`
from [tools/gen](../../tools/gen/README.md) and AutoCAD references in
`samples/refs/<acad-build>/<suite>/<case>.png` from [tools/acad](../../tools/acad/README.md)
(layout: [docs/fixtures.md](../../docs/fixtures.md)). `cpu-suite` skips cases without a
reference; `visual` renders them and reports `no-reference`.
Fonts are read from `packages/fonts/assets`, `C:\Windows\Fonts` and the AutoCAD 2027 `Fonts`
folder. The visual runner also needs Playwright's Chromium
(`pnpm --filter @truedxf/testkit exec playwright install chromium`).

```bash
pnpm test:visual --suite lines-curves                   # Chromium + three.js, newest samples/refs/* dir
pnpm test:visual --case points/<case> --repeat 2        # determinism: render twice, compare bytes
node packages/testkit/src/cpu-suite.ts lines-curves --quiet          # CPU scorer, prints non-exact cases
node packages/testkit/src/cpu-suite.ts text mtext --out samples/out/cpu --json samples/out/cpu.json
```

Visual flags: `--suite` and `--case` (repeatable), `--refs <dir>`, `--out <dir>`, `--repeat n`,
`--no-build`, `--hide-fonts <regex>`, `--draw-raster` (IMAGE/WIPEOUT, which accoreconsole omits),
`--timeout <s>` (default 120; the page is recreated after a crash or timeout). `cpu-suite` takes
`<suite>[/<case>]…`, `--out`, `--quiet`, `--json`, `--hide-fonts`, `--draw-raster`.

## Limitations

- Not published (`private`); the package exports only `metrics.ts` and `png.ts`.
- `cpu-suite` reads references from `samples/refs/acad2027-R26.0` only; `visual` takes the most
  recently modified `samples/refs/*` folder unless `--refs` is given. Font folders are
  hard-coded Windows paths.
- Only the raster metrics above exist. SSIM and a display-list vs AutoCAD PDF geometry comparison are
  not implemented.
- The densest hatch fixtures exhaust browser memory in the visual harness (docs/TODO.md).

## See also

- [@truedxf/three](../three/README.md)
