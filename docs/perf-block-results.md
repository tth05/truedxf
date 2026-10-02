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
3. `03-block-admission.patch` / `.msg`: incremental follow-up on top of unchanged 01/02.
   Draw directly on the first block/key use, record on the second and replay from the third.
   Defer first-definition signatures/eligibility walks until a second sighting. Skip single
   continuous-LINE definitions after measuring their capture overhead. Bound admission
   metadata to 16,384 items; the original recording budgets still apply. Tests cover
   admission, independent property keys, nested recording, picks and unsupported counts.

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

## Admission follow-up: final results

The first use of each block/key draws directly. The second records and emits that recording;
the third and later uses replay it. First sightings retain immutable draw state and resolver
modes instead of serializing a key or walking the definition. On the second sighting, the
first and current signatures are compared; different inherited properties, transforms,
linetype scales and resolver modes still count separately. Metadata is bounded to 16,384
first-definition states/serialized keys. Rendering an outer block normally can admit nested
keys; recording the outer block still includes nested content without nested cache fills.

This extra signature deferral matters: second-use recording alone brought r12 to 284 ms in
one repeat, but another repeat reached 294 ms. A diagnostic found 16,384 unique keys and
**zero** streams in that file. Deferring signatures removes that work for one-off definitions.

A controlled probe used 256 definitions, 1/2/4 continuous LINE entities per definition, and
1/2/3/32 uses per key; alternating off/on order, six warmups and nine measured renders,
excluding document loading. At two/three uses, second-use capture of a single LINE cost
44.6%/29.4%; at 32 uses it saved 9.1%. Two-LINE definitions saved 22.7% at 32 uses.
Trying eight-use admission for a single LINE still cost 18.9% at the eighth use. The final
deterministic cutoff therefore excludes **exactly one LINE with an effective Continuous
linetype**, rather than excluding all small definitions. Dashed LINEs remain eligible.
The cutoff sacrifices the modest hot single-LINE gain; it avoids their capture cost and
key allocation. Raw probes and their executable method text are `03-tiny-*.log` and
`03-tiny-method.md`. These small synthetic timings are distinct from the corpus benchmark.

### Isolated benchmark repeats

HEAD is `2ce46dc`. As in the initial report, the master-equivalent comparison disables
reuse in the same implementation; complete reuse-disabled fingerprints are unchanged.
All benchmark invocations ran without overlapping tests, fingerprints or pixel jobs.
Commands retain the original selection, medians of three, and fit/zoom views:

```sh
node --disable-warning=ExperimentalWarning --max-old-space-size=16000 tools/corpus/src/bench.ts --runs 3 --zoom --no-block-reuse --only "arch-cn|dims|hatch-gdal|proxy|r12|attribs|viewports|huge|mtext|civil" --json .codex-out/03-bench-before-repeat.json
node --disable-warning=ExperimentalWarning --max-old-space-size=16000 tools/corpus/src/bench.ts --runs 3 --zoom --only "arch-cn|dims|hatch-gdal|proxy|r12|attribs|viewports|huge|mtext|civil" --json .codex-out/03-bench-after.json
```

| File | Before frontend ms | Final frontend ms | Before zoom ms | Final zoom ms |
|---|---:|---:|---:|---:|
| arch-cn-114 | 9,333 | 4,717 | 10,224 | 5,197 |
| huge-blocks-187 | 41 | 41 | 46 | 46 |
| proxy-hatch-77 | 499 | 336 | 590 | 429 |
| mtext-elec-35 | 149 | 91 | 147 | 94 |
| dims-rumah-34 | 556 | 482 | 612 | 556 |
| hatch-gdal-31 | 514 | 380 | 545 | 417 |
| viewports-24 | 307 | 279 | 336 | 320 |
| attribs-21 | 70 | 67 | 78 | 70 |
| r12-network-16 | 254 | 252 | 265 | 259 |
| 3dface-civil-13 | 349 | 303 | 138 | 123 |
| binary-gdal-17 | 501 | 370 | 546 | 407 |

No file is slower in either frontend or zoom in the final isolated comparison. Arch keeps
**1.98× frontend / 1.97× zoom** speedups. Relative to the original report's master-equivalent
frontend numbers, the largest regression is civil's **4.5%** (290 → 303); r12 is **2.4%**
(246 → 252), viewports improves 291 → 279, and attribs improves 69 → 67. Relative to the
old *zoom* measurements, r12 remains 238 → 259 (**8.8%**); its current disabled baseline
also drifted to 265 ms, so the historical zoom target cannot be claimed from those absolute
numbers. The current isolated pair is faster with reuse. Final arch output is 17,468,362
vertices and 68,761 batches versus 17,511,244 / 69,329 disabled.

The first disabled repeat (`03-bench-before.json`) measured arch 10,057 / 11,760 ms,
r12 283 / 282, viewports 329 / 356, attribs 79 / 80 and civil 305 / 132. Both disabled
repeats are retained. Intermediate enabled results are `03-bench-second-use.json` and
`03-bench-after-eager-signatures.json`; they are not substituted for final medians. The
original culling measurements below remain historical; this follow-up reran the requested
`--zoom` selection, not `--zoom-cull`.

### Final gates and fixed-view pixels

- `pnpm typecheck`: pass.
- `pnpm test`: pass, **631 tests / 83 files**, including **16 block-stream tests**.
- `pnpm lint`: pass after `pnpm format` formats the generated benchmark JSON.
- `git diff --check`: pass; the incremental 03 patch also passes reverse-apply checking.
- `pnpm fingerprint --check --set fixtures --detail`: **4,057** records, model **0**, plot
  **0**, viewer **84** differences (initially 111), errors **0**. Exit 1 reflects reviewed
  viewer differences; it is not an entirely identical fingerprint run.
- `pnpm fingerprint --check --set corpus --detail`: **315** records, model **0**, viewer
  **15** differences (initially 21), errors **0**; exit 1. The corpus set has no plot hashes.
- Both full sets with `--no-block-reuse`: **0 differences / 0 errors**, exit 0.
- LOD-off/AutoCAD-raster comparisons in the tests are unchanged. `model-all` is unnecessary:
  neither core nor model changed. No saved baseline was written.

Same-view CPU comparisons use the original `lod-check --block-reuse --detail` commands,
writing `03-reuse-pixels.json` and `03-reuse-block-details.json`. Both sides enable LOD;
only reuse differs. Any RGB change and the >48 channel-difference counts coincide.

| File | Off vertices | Final vertices | Differing pixels |
|---|---:|---:|---:|
| arch-cn-114 | 17,511,381 | 17,468,289 | 2 |
| huge-blocks-187 | 84,281 | 84,281 | 0 |
| circles-117 | 5,584,792 | 5,584,792 | 0 |
| splines-82 | 2,057,738 | 2,057,738 | 0 |
| proxy-hatch-77 | 906,287 | 907,271 | 0 |
| mtext-elec-35 | 282,020 | 282,035 | 0 |
| dims-rumah-34 | 892,980 | 893,379 | 0 |
| hatch-gdal-31 | 630,078 | 630,087 | 0 |
| r13-polyline-24 | 405,212 | 405,374 | 0 |
| viewports-24 | 1,689,941 | 1,689,941 | 0 |
| dense-hatch-21 | 1,745,701 | 1,745,701 | 0 |
| attribs-21 | 233,618 | 233,618 | 0 |
| r12-network-16 | 133,528 | 133,528 | 0 |
| mpolygon-italy-26 | 1,645,110 | 1,645,110 | 0 |
| 3dface-civil-13 | 214,203 | 214,203 | 0 |
| binary-1 | 26,939 | 26,939 | 0 |
| binary-gdal-17 | 630,078 | 630,087 | 0 |

All **88 block fixtures** have zero pixel differences. Only three now have changed vertex
counts: `inherit-matrix-0002/0003/0004` gain **18/27/9** vertices. Other block fixtures have
identical counts, with maximum ordered coordinate difference **2.91e−13 px**. The initial
filled-polyline fixtures with large ordered deltas now draw directly and have no such deltas.

With identical counts, civil's maximum ordered delta is **0.000812499 px**, binary-1's is
**0.000402027 px**, and r12/mpolygon are zero. Three larger cases exceed the requested
1e−3 px ordered-array bound: huge-blocks **0.401213 px**, viewports **0.822129 px**, and
dense-hatch **0.372912 px**, all in triangle batches and all with zero pixel differences.
Equal total/batch counts do not imply equal tessellation/order. This mixed direct/canonical
path retains the existing translation-sensitive stroker/grid/triangulation behavior described
below; these deltas are **not claimed to be float rounding only**. The independent
`03-coordinate-order.log` diagnostic confirms the affected triangle batches. A fully
rigid-equivariant tessellator remains open. Pixel equivalence at these views does not prove
AA or every-zoom equivalence.

## Initial benchmarks (before admission follow-up)

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

## Initial gates (before admission follow-up)

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

## Initial fixed-view CPU check and coordinate details

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

- Enabled arch-cn medians across initial/intermediate/final runs range from 4.55 to 5.21 s,
  with the final implementation at 4.72 s, not a guaranteed first render well below 5 s:
  instrumented single runs exceed 5 s and other system load affects timings. An eligibility
  diagnostic saw 9,361 non-similarity transform fallbacks, 405 definition fallbacks and 621
  clipped calls; they retain normal traversal. Those fallback paths remain a substantial cost.
- Reuse is geometric/visual, not bit-identical LOD tessellation. Ordered topology can change;
  zero/few CPU pixels at these views do not establish browser AA or all-zoom equivalence.
- Conservative viewport/clip/gradient/absolute-linetype fallbacks leave optimization potential.
  Nested cache fills, cross-render reuse, GPU instancing and a fully rigid-equivariant
  tessellator remain follow-ups. Single-use keys now incur admission lookup overhead, but
  no recording or replay; exactly twice-used keys still pay a capture cost on their second use.
- No shared samples/baselines, fonts, AutoCAD profile settings or Git metadata were written.
