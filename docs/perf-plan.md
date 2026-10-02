# Performance plan (Phase 7 item 4)

Goal: faster parsing and viewing without changing what truedxf draws. Plot output (`raster:
"autocad"`) must stay bit-identical; viewer-only shortcuts (`raster: "smooth"`) are allowed where
they are invisible at the current zoom and are re-tessellated on the next LOD step.

Analysis date: 2026-10-02, Ryzen 7 9700X, Radeon RX 9070 XT, Node 23.10, Chromium (Playwright).

## Tools

| Command | What |
|---|---|
| `node tools/corpus/src/bench.ts [--runs 3] [--zoom] [--by-type] [--only re] [--json f]` | Node pipeline per stage over the bench set (below): tokenize, model, frontend (`renderPlot` as the viewer calls it), pick data, a 4× zoom LOD render; `--by-type` = exclusive frontend ms / vertices per entity type |
| `node --cpu-prof --cpu-prof-dir=… tools/corpus/src/bench.ts --runs 1 --only re` | CPU profile of one file |
| `pnpm perf:viewer --gpu --files …` | end to end in Chromium: parse, frontend, upload, first frame, frame time, main heap |

`perf:viewer --gpu` ran on SwiftShader before 2026-10-02: headless Chromium needs
`--use-angle=d3d11 --ignore-gpu-blocklist` (and no `--enable-unsafe-swiftshader`) for the real
GPU. Fixed; the WebGL renderer string is now printed and stored in the report.

Baselines (local, not committed): `samples/reports/bench-baseline.json`,
`samples/reports/prof/perf-viewer-gpu.log`, CPU profiles in `samples/reports/prof/<name>/`.

## Bench set

Large, varied, all from `samples/external` except one local binary conversion
(`samples/bench/`, ezdxf `recover.readfile` + `saveas(fmt="bin")`; the corpus has no binary DXF
over 1.4 MB). Names carry the size in MB.

| Name | Why |
|---|---|
| arch-cn-114 | real architecture drawing: 15 k INSERTs, 16 k texts (CJK), hatches, splines; worst real-world case |
| huge-blocks-187 | biggest file; parse stress, trivial render |
| circles-117 | 720 k CIRCLEs: per-entity model overhead |
| splines-82 | 154 k SPLINEs: NURBS evaluation |
| proxy-hatch-77 | ACAD_PROXY_ENTITY, hatches, 4 k batches |
| mtext-elec-35 | MTEXT / TTF fonts, 2 k batches |
| dims-rumah-34 | DIMENSIONs, nested inserts |
| hatch-gdal-31 | 3.5 k hatches, 7 k batches |
| r13-polyline-24 | R13 POLYLINE/VERTEX, SOLIDs in blocks |
| viewports-24 | paper layout with viewports (clip regions) |
| dense-hatch-21 | ezdxf#574: dense pattern hatches, 100 s / 208 M vertices |
| attribs-21 | 22 k ATTRIBs, embedded MTEXT |
| r12-network-16 | R12: INSERT+ATTRIB+SEQEND, POLYLINE/VERTEX |
| mpolygon-italy-26 | 20 MPOLYGONs with 1.6 M vertices |
| 3dface-civil-13 | 3DFACE, POLYLINE meshes |
| binary-1, binary-gdal-17 | binary DXF |

## Baseline

Node, median of 3 (`bench.ts --runs 3 --zoom`; model = tokenize + model; frontend = viewer's first render incl. probe pass; zoom = 4× LOD render):

| File | MB | tokenize | MB/s | model | frontend | zoom | pick | vertices | batches | transfer |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| arch-cn-114 | 111.5 | 469 ms | 238 | 3.1 s | 24.4 s | 12.8 s | 98 ms | 51.2 M | 89947 | 587.9 MB |
| huge-blocks-187 | 183.1 | 369 ms | 496 | 1.3 s | 79 ms | 48 ms | 2 ms | 0.2 M | 239 | 1.9 MB |
| circles-117 | 114.3 | 464 ms | 246 | 3.8 s | 2.9 s | 2.0 s | 67 ms | 5.6 M | 14408 | 72.2 MB |
| splines-82 | 80.2 | 298 ms | 270 | 2.0 s | 2.4 s | 1.6 s | 13 ms | 2.1 M | 2 | 25.4 MB |
| proxy-hatch-77 | 75.8 | 167 ms | 455 | 860 ms | 1.3 s | 709 ms | 7 ms | 3.5 M | 3990 | 40.2 MB |
| mtext-elec-35 | 34.5 | 46 ms | 745 | 320 ms | 466 ms | 206 ms | 4 ms | 2.0 M | 2108 | 23.5 MB |
| dims-rumah-34 | 33.4 | 120 ms | 277 | 942 ms | 1.4 s | 730 ms | 6 ms | 2.8 M | 4607 | 32.1 MB |
| hatch-gdal-31 | 30.2 | 97 ms | 312 | 648 ms | 1.2 s | 611 ms | 9 ms | 2.5 M | 7050 | 29.5 MB |
| r13-polyline-24 | 23.7 | 147 ms | 161 | 707 ms | 695 ms | 257 ms | 1 ms | 0.4 M | 250 | 4.7 MB |
| viewports-24 | 23.5 | 41 ms | 579 | 326 ms | 709 ms | 506 ms | 7 ms | 3.3 M | 6448 | 37.5 MB |
| dense-hatch-21 | 20.9 | 69 ms | 303 | 930 ms | 92.6 s | 47.1 s | 271 ms | 208.1 M | 56599 | 2382.9 MB |
| attribs-21 | 21 | 57 ms | 372 | 476 ms | 219 ms | 126 ms | 2 ms | 0.9 M | 83 | 10.7 MB |
| r12-network-16 | 15.9 | 72 ms | 222 | 985 ms | 434 ms | 329 ms | 3 ms | 0.1 M | 139 | 1.8 MB |
| mpolygon-italy-26 | 26.1 | 62 ms | 421 | 331 ms | 1.3 s | 661 ms | 3 ms | 1.6 M | 2 | 18.8 MB |
| 3dface-civil-13 | 13.2 | 41 ms | 325 | 332 ms | 203 ms | 180 ms | 3 ms | 1.0 M | 281 | 11.5 MB |
| binary-1 | 1.4 | 1 ms | 1195 | 7 ms | 29 ms | 14 ms | 0 ms | 0.2 M | 143 | 2.5 MB |
| binary-gdal-17 | 16.2 | 124 ms | 130 | 607 ms | 1.2 s | 549 ms | 11 ms | 2.5 M | 7050 | 29.5 MB |

The zoom render is cheaper than the first one: no probe pass and warm font caches. Node uses
the drawing's active layout (`describe().activeLayout`, e.g. "6F" for dense-hatch); the browser
numbers below differ where the playground opened another layout or canvas size.

Browser, real GPU (`perf:viewer --gpu`, 1600×1000):

| File | parse | frontend | upload | first frame | vertices | batches | frame | main heap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| arch-cn-114 | 2.3 s | 20.4 s | 5.9 s | 37.6 s | 47.5 M | 89 903 | 701 ms | 1373 MB |
| circles-117 | 3.1 s | 3.1 s | 0.8 s | 7.5 s | 5.5 M | 14 408 | 43 ms | 368 MB |
| splines-82 | 1.6 s | 2.6 s | 0.01 s | 4.6 s | 1.7 M | 2 | 0.7 ms | 141 MB |
| proxy-hatch-77 | 0.6 s | 2.0 s | 0.2 s | 3.1 s | 3.5 M | 3 990 | 32 ms | 87 MB |
| mtext-elec-35 | 0.3 s | 0.8 s | 0.1 s | 1.4 s | 2.0 M | 2 096 | 18 ms | 73 MB |
| dims-rumah-34 | 0.7 s | 1.7 s | 0.2 s | 2.7 s | 2.8 M | 4 607 | 40 ms | 150 MB |
| hatch-gdal-31 | 0.6 s | 1.4 s | 0.3 s | 2.5 s | 2.7 M | 7 050 | 42 ms | 150 MB |
| viewports-24 | 0.3 s | 0.6 s | 0.1 s | 1.1 s | 0.7 M | 1 578 | 13 ms | 73 MB |
| r12-network-16 | 0.5 s | 0.7 s | 0.02 s | 1.4 s | 0.1 M | 139 | 1.4 ms | 48 MB |
| attribs-21 | 0.4 s | 0.5 s | 0.05 s | 1.0 s | 0.2 M | 1 284 | 11 ms | 43 MB |
| dense-hatch-21 | 0.5 s | 25.0 s | 1.8 s | 28.5 s | 105 M | 28 563 | 195 ms | 1078 MB |

## Findings

1. **Frame time is draw calls, not vertices.** ~8 µs per batch on a fast GPU (90 k batches →
   700 ms/frame; 2 batches with 1.7 M vertices → 0.7 ms). Every batch is its own three.js Mesh
   *and* Material (`packages/three/src/index.ts`), and the builder starts a new batch at every
   Lines ↔ Triangles switch (TODO "Batch fragmentation").
2. **Extents renders draw everything twice.** `renderPlot` with `area: extents` runs a full
   probe pass (`probeBounds`, frontend.ts) to find the bounds, then the real pass: 33–65 % of
   frontend time in the profiles. The viewer's first render of model space always uses it.
3. **Block content is re-tessellated per INSERT.** arch-cn: 27 s of 29 s frontend under
   `drawBlockContent`; property resolution alone (`model.resolve`, `nameKey` upper-casing) is
   ~4.6 s because `PropertyResolver.properties` re-resolves the same entity 3–5 times per draw
   (isPlotted, effectiveLayer, resolve, inherit) and allocates each time.
4. **Output volume in viewing mode is far beyond what is visible.** Per-type vertices (both
   passes): dense-hatch HATCH 403 M (pattern lines and dashes far below a pixel); arch-cn TEXT
   43 M (sub-pixel CJK glyphs), HATCH 19 M, LWPOLYLINE 13.5 M. arch-cn's list is 574 MB to
   transfer, dense-hatch's 2.4 GB. Hairlines are line lists (2 vertices per segment),
   triangles are unindexed, colours are per vertex.
5. **Model loading is 4–10× the tokenizer.** The generic `readFields` (fields.ts) dominates: a
   `Set` per call, generator + spread per part (`[...rec.partTags(part)]`), a tuple per value,
   and every entity is scanned 3–4 times (`readBase` COMMON fields, `recoverMisplaced`, the type's
   fields, `readProxyGraphics`, `handle`/`owner`). GC is 10–16 % of the total.
6. **Tokenizer** runs at 115–740 MB/s (PLAN budget ≥ 50 MB/s is met, but it can do better): a
   tuple allocation per line (`lineEnd`), `indexOf` call per line; numbers with 16–17 digits
   (common in AutoCAD output) fall back to `latin1` string + regex + `Number()`
   (`parseNumberString` ~0.7 s on circles-117).
7. **Binary DXF** tokenizes at 130 MB/s (ASCII 250–750) but loads the model as fast as the
   ASCII original (0.61 s vs 0.65 s); `TagStore.num` boxes every value through `value()`.
8. **Model memory ~1 KB per entity** of JS heap (circles-117: 728 MB heap + 121 MB tag arrays +
   114 MB file bytes). The worker holds all of it plus the list; the main thread keeps every
   batch's positions for picking (arch-cn main heap 1.4 GB).
9. **TTF fonts are parsed eagerly** with opentype.js (~0.5 s for a text-heavy drawing, per font
   on first use; `opentype.parse` without `lowMemory`).

## Plan

Ordered by benefit / risk. Each step is a separate commit with before/after bench numbers.

### 0. Safety net first

- **Fingerprint gate** `tools/corpus/src/fingerprint.ts`: hashes of (a) the model dump
  (`dump.ts` JSON) and (b) the display list (kinds, positions, colours, pick ranges, clips,
  bounds) for every generated fixture in plot mode and for a fixed corpus sample (the bench set
  + ~300 files, deterministic) in plot *and* viewer mode. `--save` writes a baseline under
  `samples/reports/`, `--check` lists files whose hashes changed and, for display lists, the
  largest coordinate difference in pixels. Behaviour-neutral steps must pass `--check` exactly;
  viewer-only steps must pass it for plot mode.
- Keep `pnpm test`, `pnpm typecheck`, `pnpm lint`, and the CPU fidelity suites
  (`cpu-suite.ts`, scoreboard must not drop) as before.

### 1. Renderer: fewer draw calls (frames, upload) — viewer only

- Shared materials per primitive kind instead of one per batch.
- **Merge batches** in the interactive renderer: consecutive opaque batches are drawn in order
  with a per-batch depth value (later = nearer, depth test on), so all triangles of a clip group
  go in one draw call and all lines in another while the painter's order is preserved; batches
  with alpha and clip changes still split. Positions are rebased to a shared origin where the
  float32 range allows (else grouped by origin). The exact renderer (visual tests, plot preview)
  keeps today's path behind an option.
- Build the merged GPU buffers in the worker (transferable), so the main thread only uploads
  (arch-cn upload today 5.9 s on the main thread).
- Expected: arch-cn 700 ms → a few ms per frame; circles / hatch-gdal / dims 40 ms → < 5 ms.

### 2. Frontend: stop redundant work — output-neutral

- **Memoize property resolution** per (entity, inherited context, viewport): a one-entry cache
  covers the repeated calls for the entity being drawn; inherited contexts can carry a small map.
- **Cache text layouts per entity** (layout is independent of the INSERT transform; glyph
  meshes are already per tolerance), and Matrix44 products per INSERT.
- Viewer first render without the probe pass: the viewer asks for a window around the header
  extents when they are plausible and fits to the returned bounds (LOD re-requests if far off);
  falls back to `extents` when they are not. Plot `extents` stays two-pass.
- Smaller items from the profiles: `GrowF32.take` copies, per-segment allocations in
  `strokeFlat` / `triangles`, `loopPoints` building a path per segment.
- Expected: first render −40…60 % (probe), insert-heavy drawings another −20…30 %.

### 3. Viewer LOD: draw only what is visible — viewer only (`raster: "smooth"`)

- Pattern hatches whose line spacing is below ~1 px: one solid fill with the pattern's coverage
  as alpha; pattern dashes / dots shorter than a pixel merge into continuous lines (the
  linetype rule `DENSE_LINETYPE_PERIOD_PX` already does this for linetypes).
- Text whose glyph cell is below ~1.5 px: a box or baseline stroke per character cell instead of
  outlines; per-glyph tessellation only above that.
- Lineweight widening below ~1.5 px → hairline (already partly done by `hairlineMaxPx`).
- View culling for zoomed-in LOD lists (TODO "Frontend view culling"): skip entities and block
  references whose cached bounds miss the window + margin; re-request on pan.
- Expected: dense-hatch 105 M → a few M vertices, 25 s → ~1 s; arch-cn 47 M → < 10 M.

### 4. Parser — output-neutral (TagStore and model identical)

- Tokenizer: one byte loop per line with the group code parsed inline, no tuple allocations.
- Numbers: Clinger fast path for any mantissa < 2^53 (16-digit values) with |exp10| ≤ 22, and the
  string fallback without the regex pre-test; property test against `Number()`.
- Binary DXF: `num` / `int` read directly by value kind (DataView), no `value()` boxing (small).
- `readFields` rewrite: per FieldTable a code → definitions array lookup, filled flags in a
  reused array, direct iteration over part ranges (no generators / spreads), values written
  straight into the target; parts and `hasSubclasses` computed once; `readBase` and the type's
  fields in one pass over the tags where the subclass rules allow it; `readProxyGraphics` /
  `recoverMisplaced` only when their codes occur.
- Fonts: `opentype.parse(…, { lowMemory: true })` (lazy glyphs), checked against the fixture
  hashes (kerning, cap height "A").
- Expected: model load 2–3× faster (circles 3.8 s → < 2 s, arch-cn 3.1 s → ~1.2 s, r12-network
  1.0 s → ~0.4 s), tokenizer 1.5–2×.

### 5. Memory and transfer

- Display list: hairlines as line strips or indexed segments, colours per pick range / batch
  where uniform, so lists shrink 2–3×; picking queries go to the worker (or keep positions only
  for the merged buffers) instead of a main-thread copy of every batch.
- Model: drop per-record caches after load where they are not needed, avoid materialising
  default-only objects; target ≤ 500 B per simple entity.

### Completed: worker merging and interaction (2026-10-02)

Steps 1 (worker GPU buffers) and 5 (worker picking / highlight extraction) now use the DOM-free
`@truedxf/three/merge` subpath, shared with the renderer rather than duplicating the algorithm in
the viewer. `setMergedDisplayList` uploads that form; `setDisplayList` remains the exact/unmerged
entry. Individual alpha/image parts contain only GPU data, UVs and image indices. The backend
retains the original list and Flatbush index; transfer buffers, including clip rings, are independent
of that state. More than `MAX_DEPTH_ORDERS` ranges falls back to ordinary batches.

`pick` and `geometry` requests carry the displayed generation. Hover keeps one request in flight
and only the latest pending pointer position; older answers are discarded. Selected/hovered
highlight geometry uses the same stencil masks as the drawing, and selection geometry is cached
until the list changes. `pickAt` and `zoomToEntity` are now asynchronous. Measuring still uses world
cursor coordinates. Auxiliary `renderList` calls preserve interaction state; `LocalBackend` uses
the same core, with original geometry necessarily residing on the main thread in that mode.

GPU results, 1600×1000, RX 9070 XT (`pnpm perf:viewer --gpu --files-from
samples/reports/prof/perf-files.txt`). Before = saved `samples/reports/prof/viewer-merged.json`,
after = `samples/reports/prof/viewer-worker.json`. All values below are **before → after**. Timing
comparisons are noisy under concurrent CPU work; draw-call counts and vertex counts are unchanged.

| File | Frame median ms | Upload ms | First frame s | Immediate main heap MB | Retained heap + backing MB (after GC) |
|---|---:|---:|---:|---:|---:|
| arch-cn-114 | 4.4 → 3.3 | 1712 → 260 | 48.26 → 39.67 | 1545 → 905 | 3.2 + 41.1 |
| circles-117 | 2.6 → 1.7 | 270 → 35 | 11.14 → 6.71 | 368 → 242 | 2.8 + 21.2 |
| splines-82 | 1.0 → 0.6 | 85 → 16 | 7.10 → 4.69 | 169 → 141 | 2.7 + 21.2 |
| proxy-hatch-77 | 2.0 → 3.1 | 146 → 26 | 4.31 → 2.82 | 202 → 159 | 3.0 + 22.1 |
| mtext-elec-35 | 0.7 → 0.7 | 86 → 20 | 2.41 → 1.48 | 125 → 98 | 2.9 + 24.5 |
| dims-rumah-34 | 1.6 → 1.3 | 131 → 28 | 4.33 → 2.72 | 141 → 104 | 3.0 + 21.8 |
| hatch-gdal-31 | 1.2 → 0.9 | 136 → 28 | 3.86 → 2.35 | 141 → 98 | 3.0 + 22.1 |
| viewports-24 | 0.9 → 0.8 | 51 → 13 | 1.74 → 1.06 | 73 → 65 | 3.0 + 23.7 |
| r12-network-16 | 1.0 → 0.8 | 22 → 9 | 3.06 → 1.41 | 48 → 45 | 2.8 + 21.2 |
| attribs-21 | 0.8 → 0.5 | 35 → 8 | 2.29 → 0.99 | 58 → 54 | 2.9 + 23.9 |
| dense-hatch-21 | 9.8 → 8.4 | 3443 → 411 | 49.11 → 28.61 | 2995 → 1745 | 3.1 + 22.1 |

The saved merged baseline's immediate heaps differ from the older baseline table above.
`performance.memory` includes uncollected upload buffers and is bucketed by Chromium: it is not a
measure of live geometry. The perf script keeps that metric for comparison and additionally uses
CDP to collect garbage and measure main-isolate heap / ArrayBuffer backing storage **after** all
timed work. The browser smoke checks that no list positions, pick index or uploaded vertex
attributes remain referenced on the main thread; metadata, cached assets and entity highlights
remain. Large upload buffers can still contribute to transient peak memory, and selecting a very
large entity can request substantial highlight geometry.

Validation: fixture/corpus fingerprints match the saved baseline (4057 / 315 records, zero
differences). The GPU comparison and rebasing diagnostic cover the full bench set; pointer smoke
checks select clipped model content in `problematic_viewports.dxf`'s paper layout and an entity in
`Network.dxf`'s model space. No AutoCAD domain behaviour changed.

### Later / only if needed

- Tessellate block definitions once per (block, inherited properties, pixel size) and reuse
  them per INSERT, or GPU instancing of block geometry (display-list format change).
- Parallel frontend over several workers (entity ranges, lists concatenated in order).
- Progressive display (first list for the visible area, rest streamed).

## Success targets (bench set)

- Every file in the set opens in the browser without OOM; first frame ≤ 5 s for every file
  except arch-cn (≤ 10 s) and dense-hatch (≤ 5 s).
- Frames ≤ 16 ms on the RX 9070 XT for every file, ≤ 50 ms on SwiftShader for all but arch-cn.
- Model load ≥ 50 MB/s for every file (today 16–145 MB/s; 11 of 17 files are below 50).
- Fingerprint gate: plot mode identical for every step; viewer mode identical for steps 2 and 4.
