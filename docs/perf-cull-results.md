# View culling results (2026-10-02)

Implemented in the `perf/cull` worktree, without committing or writing shared samples. The
before side below is this checkout with culling disabled; extents fingerprints prove its
output is unchanged from the saved current-master baseline. Node timings are medians of
three paired runs; browser timings are one run per configuration, not statistical medians.
No benchmark overlapped validation jobs. Timing noise and cache-order effects remain possible.

The implementation rejects top-level picks before traversal in `Frontend.drawEntity`; INSERT
children retain their parent's pick. ViewerCore caches bounds from complete output vertices
with batch origins, including text, fills and widened strokes. Unknown/empty and unbounded
picks always draw. Load and render-settings changes invalidate the map. Auxiliary plots do
not replace the interactive cache; AutoCAD raster and extents requests never set the filter.

Paper layouts use the union of a model handle's output across all viewports **in paper
coordinates**. This permits the filter inside viewport content, without comparing model bounds
to a paper window. Unclipped unions are conservative; repeated viewports can keep much more
geometry than is needed. Viewport frames are independent top-level picks as before.

The viewer requests detail coverage expanded by one visible view size on each side (3× width
and height), refreshing at the inner 25% coverage margin with the existing 150 ms debounce or
when LOD resolution changes. Fit/extents lists stay complete. Complete-list bounds remain the
navigation frame so zooming into an empty centre does not shrink fit or LOD limits.

The GPU retains the last complete list and draws it only outside the current detail rectangle
using four disjoint scissor strips; detail draws inside. Each partition resets depth/stencil,
so viewport clips and merged painter order still work. There is no coarse underpaint inside
detail coverage. This costs the complete list's GPU memory in addition to the detail buffers.
Picking outside detail coverage deliberately returns nothing until the pan list arrives;
inside, picking uses the current worker generation. Empty zoom windows keep complete-layout
diagnostics rather than claiming that the drawing has no visible content. Selection/hover geometry is clipped to
detail coverage; measurement overlays remain full-view. The coarse fallback remains visible
while a new list is pending, including when the view completely leaves the old coverage.

Reviewable delivery (no Git metadata writes):

- `.codex-out/01-view-culling.patch` / `.msg`: frontend hook, worker cache, viewer pan/LOD
  integration, GPU fallback and eleven bounds/ownership/scissor/empty-window regressions.
- `.codex-out/02-culling-measurements.patch` / `.msg`: Node and Playwright tooling, playground
  `?cull=0` comparison option, knowledge-base/TODO/performance-plan updates and this report.

## Node frontend and vertices

Node v23.10.0, 1600×1000 device pixels, each drawing's active layout, explicit centre windows
at 8× and 64× relative to the initial render view. Coverage is 3× those windows. Culling runs
first in each pair, after a complete fit; the fit map is reset before the next zoom pair.
These are explicit resolutions, without the browser's finest-pixel LOD clamp. Frontend ms
excludes pick-index/bounds-map construction and merge/upload time. The complete first fit is
unchanged except for the additional bounds-map work in the pick stage (arch-cn: combined pick
and bounds construction 129 ms; circles: 210 ms). Both sides use the existing smooth LOD.

```sh
pnpm exec node --disable-warning=ExperimentalWarning --max-old-space-size=16000 tools/corpus/src/bench.ts --runs 3 --zoom-cull --json .codex-out/zoom-cull-node.json
```

| Drawing | Zoom | Full ms | Culled ms | Full vertices | Culled vertices | Speedup |
|---|---:|---:|---:|---:|---:|---:|
| arch-cn-114 | 8× | 11,911 | 603 | 24,192,332 | 1,124,967 | 19.75× |
| arch-cn-114 | 64× | 15,157 | 159 | 65,341,591 | 7,464 | 95.33× |
| dense-hatch-21 | 8× | 2,219 | 2,092 | 8,811,747 | 8,264,920 | 1.06× |
| dense-hatch-21 | 64× | 2,867 | 849 | 16,212,634 | 5,393,306 | 3.38× |
| circles-117 | 8× | 3,001 | 1,847 | 15,688,022 | 8,962,241 | 1.62× |
| circles-117 | 64× | 5,363 | 200 | 43,575,758 | 663,628 | 26.82× |
| dims-rumah-34 | 8× | 637 | 145 | 1,820,486 | 537,051 | 4.39× |
| dims-rumah-34 | 64× | 732 | 24 | 3,279,347 | 17,344 | 30.50× |
| hatch-gdal-31 | 8× | 561 | 294 | 1,216,287 | 635,463 | 1.91× |
| hatch-gdal-31 | 64× | 603 | 82 | 1,566,659 | 109,570 | 7.35× |
| viewports-24 | 8× | 356 | 128 | 2,507,602 | 978,206 | 2.78× |
| viewports-24 | 64× | 452 | 127 | 4,466,977 | 1,318,337 | 3.56× |

Raw values: `.codex-out/zoom-cull-node.json` and `.log`. No row had a stage error.
Dense-hatch 8× has little benefit: broad hatch/block picks survive. Viewports 64× still outputs
more vertices than culled 8× because surviving entities are refined in full. Top-level culling
is not clipping or sub-entity culling and cannot make a single large hatch/INSERT cheap.

## Browser action to shown list

Headless Chromium, actual Radeon RX 9070 XT via ANGLE D3D11, `--use-angle=d3d11
--ignore-gpu-blocklist`, without `--enable-unsafe-swiftshader`. Page viewport 1600×1000, drawing
canvas 1016×924, DPR 1, default merged GPU buffers and antialiasing. Each side loads arch-cn
fresh, then zooms to drawing centre at 8×/64× and pans right by 0.9 visible widths. Timings
include the debounce, worker work, transfer, GPU upload and frame: wait for the render event,
finish submitted GL commands and observe the next animation frame. Browser LOD keeps its
existing minimum pixel-size rule. Font substitution warnings occur on both sides; no fonts
were added or copied. The canvas/view and installed-font lookup differ from the Node benchmark,
so the frontend and vertex totals should not be compared across these two tables.

```sh
pnpm exec node apps/playground/scripts/cull-check.ts --timings-only
```

| Zoom | Full shown ms | Culled shown ms | Full frontend ms | Culled frontend ms | Full vertices | Culled vertices | Culled pan shown ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| 8× | 10,581 | 1,460 | 9,663 | 1,223 | 22,143,962 | 2,665,244 | 5,368 |
| 64× | 13,078 | 246 | 11,363 | 84 | 48,617,021 | 6,291 | 239 |

Full-list pan reuses the existing list, so its measured render submission/finish is under 1 ms
and there is no new worker list. Culled pan at 8× enters denser content (12,384,293 vertices,
frontend about 4.9 s) and costs 5.37 s; the 64× pan keeps 6,291 vertices and costs 0.24 s.
The old detail and coarse fallback continue showing during that time. This is a real remaining
latency, not hidden by the fast centre-zoom numbers. Raw browser records and screenshots are
under `.codex-out/cull-arch.json`, `cull-browser-timings.log`, and `arch-*-{zoom,pan}-*.png`.

## GPU screenshot and pan regression

`pnpm exec node apps/playground/scripts/cull-check.ts --synthetic-only` holds new render
requests pending with an explicit release promise, then pans by 0, 0.2, 0.9, 2, −2 and 1.2
view widths before allowing the current pan list to arrive. The paired full viewer uses the
same view and fine LOD. The synthetic grid's solids have identical geometry at fit/fine LOD,
so its outside-coverage fallback can be compared directly to a complete fine render. This
checks absence of holes and coarse underpaint, rather than accepting coarse stroke differences.
Configurations: model merged, paper layout with two viewport/stencil groups, model unmerged,
and model merged at DPR 2. Each has six pending screenshots and a settled comparison. Detail
model lists have 3,168 vertices versus 15,000 fit vertices. The model case at DPR 2 checks
3,755,136 pixels per comparison; other cases check 938,784.

All 28 synthetic comparisons and four real arch-cn settled zoom/pan comparisons pass: **zero
pixels differ**, maximum RGB delta **0**, zero interior missing-content differences. Comparison
flags pixels above an RGB delta of 8 and distinguishes antialiased edges using a 3×3 reference
neighbourhood. Real drawings are checked after the new list arrives; the deliberately held
in-flight cases use resolution-independent solids. Screenshots are canvas-only; sibling busy
UI is hidden, since it otherwise contaminates an element screenshot during worker work.
No page errors occurred. The script throws on an interior mismatch and writes PNG pairs and
JSON/log records for review. A zero-delta test cannot establish a universal analytic bounds
proof for every drawing/font; it covers these measured paths.

## Gates

- `pnpm typecheck`: PASS.
- `pnpm test`: PASS, 615 tests / 82 files.
- `pnpm lint`: PASS.
- `pnpm fingerprint --check --set fixtures`: PASS, 4,057 records; model, plot and viewer each
  4,057 identical, **0 differences / 0 errors** against `baseline`.
- `pnpm fingerprint --check --set corpus`: PASS, 315 records; model and viewer each 315
  identical, **0 differences / 0 errors** against `baseline` (this set has no plot hashes).
- `model-all`: not required; neither `packages/core` nor `packages/model` was touched.
- `git diff --check` and reverse patch applicability: PASS.

Full command logs are in `.codex-out/`. Baselines and every shared sample remained read-only.

## Limitations and open work

- Four cached fit pixels pad output bounds for curve refinement and Greeked glyphs. This is
  conservative in the measured drawings, not an analytic font-overhang bound. Unknown bounds
  always draw. Extremely unusual overhang would need analytic/full-detail text bounds.
- Repeated viewport handles union across viewports; entities spanning coverage cannot be
  rejected per viewport or inside a large INSERT/hatch. Dense-hatch at 8× remains about 2.1 s.
- The display-only fallback temporarily uses fit-level geometry outside detail coverage; users
  can see the ordinary coarse-to-fine change there. Outside picks are intentionally unavailable.
- Keeping the complete GPU list increases GPU memory; visibility/layout/assets changes request
  a new complete list to rebuild safe bounds, and remain expensive.
- Browser timing is one paired run; Node uses three. Corpus-wide pixel equivalence for arbitrary
  culled windows was not tested; the corpus/fixture fingerprint gates exercise complete renders.
- Initial full renders are still needed; AutoCAD was not invoked, and no public site was deployed.
