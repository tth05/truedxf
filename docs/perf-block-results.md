# Viewer block reuse results (2026-10-02)

Implemented in `perf/blocks`, based on current master, without Git metadata writes or changes
to shared samples/baselines. Patches and raw logs are in `.codex-out/`; remove that directory
before merging. This changes viewer LOD output only. AutoCAD raster and LOD-off rendering use
the original traversal.

## Design and delivery

1. `01-block-streams.patch` / `.msg`: Float64 builder-call recordings, similarity split,
   frontend cache, viewer comparison flag, regression tests, knowledge-base/performance-plan
   updates. Coordinates are recorded before float32 batch rebasing; each replay keeps original
   primitive/batch-break order and the real builder's current top-level pick. Bounds are
   accumulated from replayed output. Unsupported counts are repeated per reference.
2. `02-block-verification.patch` / `.msg`: `bench --no-block-reuse`, fingerprint comparison
   switch, same-view CPU checks and this report. No sample baseline is written.

The full composed Matrix44 must be an affine, planar similarity: reject nonuniform scale,
shear, perspective, tilt and z-to-xy projection. Split it into exact uniform scale plus mirror
parity and a remaining rotation/translation. Exact scale, z scale, parity, block object,
effective layer/ACI/true colour/lineweight/linetype/alpha/colour-book/plot-style properties,
folded parent visibility propagation, full block-name stack, linetypeScale and resolver mode
identify a stream. Pixel size, layer toggles, fonts, calibration, document and background are
fixed within each Frontend. Scale buckets were rejected: target-unit dash lengths must remain
unchanged (note 06 §2.5).

Reuse falls back for viewport contexts, entity filters, current clips, nested extension
dictionaries/XCLIPs, viewport entities, gradients, infinite lines, cyclic/deep definitions and
documents containing absolute-angle complex linetypes. The latter is deliberately conservative,
even if that linetype is unused. Arbitrary registered clip hooks disable reuse; the built-in
metadata-based XCLIP hook permits the eligibility walk to reject its affected subtrees.
Nonuniform nested INSERTs are still rendered normally *inside* an eligible outer stream: a
rigid outer remainder preserves their final geometry.

Nested content is included in the outer recording. Nested cache fills are disabled during
recording, preventing duplicated retained geometry; nested references reached during normal
traversal can still use their own cache. Top-level ATTRIBs stay outside their INSERT's stream,
and MINSERT cells replay separately. Top-level culling runs before this path as before.

The cache stops admitting entries at 32,000,000 stored vertices, 262,144 builder commands or
4,096 entries. An oversized recording releases its commands, restores captured counters and
draws normally; existing entries remain usable and further admissions stop. Command/entry
limits also bound empty/tiny streams. Replay reuses one frontend scratch array. An arch-cn
diagnostic retained 2,043 streams, 527,762 input vertices and 143,626 commands, with 8,444,192
bytes of coordinate/UV arrays. This excludes JS object/key overhead and the final display list.

## Benchmarks

Node v23.10.0, medians of three, 1600 × 1000. Before uses the final implementation with reuse
disabled; after enables it. Both benchmark commands ran without overlapping validation jobs.
Small-file differences include timing noise and first-use recording overhead; there is no
claim that every drawing improves.

```sh
node --disable-warning=ExperimentalWarning --max-old-space-size=16000 tools/corpus/src/bench.ts --runs 3 --zoom --no-block-reuse --only "arch-cn|dims|hatch-gdal|proxy|r12|attribs|viewports|huge|mtext|civil" --json .codex-out/bench-before.json
node --disable-warning=ExperimentalWarning --max-old-space-size=16000 tools/corpus/src/bench.ts --runs 3 --zoom --only "arch-cn|dims|hatch-gdal|proxy|r12|attribs|viewports|huge|mtext|civil" --json .codex-out/bench-after.json
```

| File | Frontend before ms | Frontend after ms | Zoom before ms | Zoom after ms |
|---|---:|---:|---:|---:|
| arch-cn-114 | 9,906 | 4,921 | 10,624 | 5,129 |
| huge-blocks-187 | 42 | 41 | 52 | 49 |
| proxy-hatch-77 | 522 | 291 | 607 | 380 |
| mtext-elec-35 | 157 | 84 | 158 | 88 |
| dims-rumah-34 | 549 | 481 | 607 | 574 |
| hatch-gdal-31 | 478 | 425 | 522 | 471 |
| viewports-24 | 291 | 337 | 327 | 354 |
| attribs-21 | 69 | 78 | 72 | 82 |
| r12-network-16 | 246 | 331 | 238 | 302 |
| 3dface-civil-13 | 290 | 308 | 158 | 131 |
| binary-gdal-17 | 472 | 418 | 520 | 457 |

Arch-cn improves **2.01×** for the first frontend render and **2.07×** for zoom. An earlier
isolated after median was 4,546 / 4,766 ms; both runs are retained. The final table reports the
repeat, including regressions on several smaller drawings, rather than selecting the faster run.

Arch-cn output changes from 17,511,244 to 17,470,870 vertices (−40,374, 0.23%) and from
69,329 to 69,317 batches. The optimization primarily saves repeated CPU tessellation and
property resolution; it does not substantially reduce output volume or GPU draw calls.

Arch-cn `--runs 3 --zoom-cull --only "^arch-cn-114$"`:

| Window | Before frontend ms | After frontend ms | Before vertices | After vertices |
|---|---:|---:|---:|---:|
| 8× culled | 716 | 365 | 1,124,967 | 1,125,165 |
| 8× full | 13,444 | 5,160 | 24,192,332 | 24,176,993 |
| 64× culled | 158 | 122 | 7,464 | 7,464 |
| 64× full | 15,582 | 7,088 | 65,341,591 | 65,338,844 |

These culling measurements are separately timed, not paired. The initial before-cull job
overlapped the tail of the initial small-file benchmark; those logs are retained, and exact
speedup factors should not be inferred from small timing differences. The main before/after
table uses isolated repeats. Raw reports: `bench-{before,after}.json`,
`cull-{before,after}.json`; initial benchmark reports are retained with `-initial` names.

## Gates

- `pnpm typecheck`: pass.
- `pnpm test`: pass, 628 tests in 83 Vitest files, including 13 new block-stream tests.
- `pnpm lint`: pass after `pnpm format` (also formats local JSON reports).
- `git diff --check`: pass.
- `pnpm fingerprint --check --set fixtures --detail`: 4,057 records, model **0**, plot **0**,
  viewer **111** differences, **0** error records. Exit 1 reports reviewed viewer differences.
- `pnpm fingerprint --check --set corpus --detail`: 315 records, model **0**, viewer **21**,
  **0** error records. Exit 1 reports reviewed viewer differences. This set has no plot hashes;
  plot coverage comes from the 4,057 fixtures.
- Repeating both complete fingerprint sets with `--no-block-reuse`: **0 differences** and
  **0 errors**, exit 0. Therefore every changed viewer hash comes from the enabled reuse path.
- `model-all`: not required; neither `packages/core` nor `packages/model` changed.

LOD-off viewer and AutoCAD raster are compared against reuse disabled in the regression tests.
The unchanged saved baseline has no coordinate snapshots for the changed records;
`fingerprint --detail` cannot invent their historical coordinates. The independent same-view
checks below supply direct on/off deltas without creating or replacing a baseline.

## Fixed-view CPU check and coordinate details

```sh
node --disable-warning=ExperimentalWarning --expose-gc --max-old-space-size=16000 tools/corpus/src/lod-check.ts --block-reuse --detail --fixtures 0 --json .codex-out/reuse-pixels.json
node --disable-warning=ExperimentalWarning --expose-gc --max-old-space-size=16000 tools/corpus/src/lod-check.ts --block-reuse --detail --only "blocks/" --fixtures 100 --json .codex-out/reuse-block-details.json
```

Both sides enable LOD and use the same explicit window from a reuse-disabled fit. Font/glyph
caches are warm for the measured pair. Pixels are reported both for **any RGB difference** and
for a channel delta >48; the counts coincide here. The CPU rasterizer uses no antialiasing.
These pair timings overlapped fingerprint checks and are not used as benchmark evidence.

| File | Off vertices | On vertices | Changed pixels (any RGB / >48) |
|---|---:|---:|---:|
| arch-cn-114 | 17,511,381 | 17,470,602 | 2 / 2 |
| huge-blocks-187 | 84,281 | 84,281 | 0 / 0 |
| circles-117 | 5,584,792 | 5,584,792 | 0 / 0 |
| splines-82 | 2,057,738 | 2,057,738 | 0 / 0 |
| proxy-hatch-77 | 906,287 | 908,246 | 0 / 0 |
| mtext-elec-35 | 282,020 | 282,068 | 0 / 0 |
| dims-rumah-34 | 892,980 | 893,808 | 0 / 0 |
| hatch-gdal-31 | 630,078 | 630,111 | 0 / 0 |
| r13-polyline-24 | 405,212 | 405,467 | 1 / 1 |
| viewports-24 | 1,689,941 | 1,689,941 | 0 / 0 |
| dense-hatch-21 | 1,745,701 | 1,745,704 | 0 / 0 |
| attribs-21 | 233,618 | 233,618 | 0 / 0 |
| r12-network-16 | 133,528 | 133,528 | 0 / 0 |
| mpolygon-italy-26 | 1,645,110 | 1,645,110 | 0 / 0 |
| 3dface-civil-13 | 214,203 | 214,203 | 0 / 0 |
| binary-1 | 26,939 | 26,945 | 0 / 0 |
| binary-gdal-17 | 630,078 | 630,111 | 0 / 0 |

All **88 block fixtures** have zero differing pixels. Seven have different vertex counts:
`inherit-3level-0001/0002` (+30 each), `inherit-matrix-0001/0002/0003/0004`
(+42/+48/+57/+33), and `linetype-scale-mirror` (−4). Detailed primitive instrumentation on
`inherit-3level-0001` shows 24/30-vertex widened LINE calls becoming 27/33-vertex calls:
nearly collinear round-cap fan triangles survive/fail `triangulateConvex`'s cross-product-zero
test differently without the large INSERT translation. The stroker and tessellator themselves
were left unchanged, preserving LOD-off/plot output. Canonical hatch/wide-polyline fixed-point
normalization and dash endpoint rounding can also change triangulation decisions.

Where batch structure is comparable, max ordered coordinate delta is **0.000473170 px** for
huge-blocks and **0.000812499 px** for civil. `anonymous-e/u` are **1.27e−13 px**,
`lineweight-insert-scale` **6.27e−14 px**, `minsert-rotated` **8.09e−14 px**,
and `nonuniform-0001/0003` **4.74e−13 px**, all with identical vertex counts. Other comparable
block cases are zero or similarly tiny.

Two filled-polyline fixtures, `nonuniform-0004` (uniform −1/−1 despite its name) and
`nonuniform-0007` (mirrored similarity), preserve counts but have different triangulations:
ordered coordinate comparison reports **533.33 / 317.66 px**, respectively. Comparing
quantized unordered primitive triples also differs, so these are not claimed to be only a
vertex permutation. Target-grid normalization and triangulation can change diagonals/order
after rotation. Both produce exactly the same CPU pixels. Thus the requested ≤1e−3 px bound
is met for comparable unchanged tessellations, **not for every ordered vertex array**; changed
topology is reported explicitly rather than hidden behind a coordinate metric.

## Remaining limits

- Arch-cn medians range from 4.55 to 4.92 s, not a guaranteed first render well below 5 s:
  instrumented single runs exceed 5 s and other system load affects timings. An eligibility
  diagnostic saw 9,361 non-similarity transform fallbacks, 405 definition fallbacks and 621
  clipped calls; they retain normal traversal. Those fallback paths remain a substantial cost.
- Reuse is geometric/visual, not bit-identical LOD tessellation. Ordered topology can change;
  zero/few CPU pixels at these views do not establish browser AA or all-zoom equivalence.
- Conservative viewport/clip/gradient/absolute-linetype fallbacks leave optimization potential.
  Nested cache fills, cross-render reuse, GPU instancing and a fully rigid-equivariant
  tessellator remain follow-ups. Single-use definitions can incur recording overhead.
- No shared samples/baselines, fonts, AutoCAD profile settings or Git metadata were written.
