# Loaded-model memory results — 2026-10-02

Worktree: `truedxf-wt-model`, branch `perf/memory`, compared with its current HEAD/master,
after the parser work recorded in `perf-parser-results.md`. Only model representation,
model tests and corpus measurement tools changed; core, renderer, viewer and three sources
are unchanged. Changes are uncommitted. The shared samples and saved baseline were not written.

## Outcome and limits

Circles retain approximately **421 B/entity**, down from **1,108 B/entity** (62% less JS heap).
This meets the plan's ≤500 B/entity budget, but misses the requested ≤400 B/entity target.
Architecture loses 45% and R12 network loses 28% of retained JS heap. Typed-array backing
storage is unchanged. The fingerprint walker is unchanged and all three baseline checks
pass with zero differences, including all fixture plot hashes.

The performance acceptance criterion is not fully established: the frontend dimensions
case remains slower in the controlled GC comparison, and an all-file load run contains
large timing outliers. Paired load results below are better for circles, architecture and
dimensions; R12 is 1.6% slower in the latest pair. Do not claim universal zero slowdown.

## Measurement

`tools/corpus/src/heap-bench.ts` is a separate `--expose-gc` tool. Each file/run gets a fresh
Node process (Node v23.10.0); the input Buffer is read before the baseline, GC runs twice
before and after `DxfDocument.load`, and the document is kept alive through GC and snapshots.
It reports load wall time, `heapUsed`, `external`, `arrayBuffers`, input bytes, top-level and
inclusive entity counts, and heap B/entity. Defaults are three runs and the fixed 17-file
bench set; `--only`, `--runs`, `--json`, and `--snapshot` are supported. Reported medians are
computed independently for each metric. MB here means decimal MB; bytes of the input file
are not part of the retained-load deltas. Inclusive counts add VERTEX and ATTRIB children,
so R12's 182,846 entities differ from its 76,922 top-level count in older reports.

```powershell
node --expose-gc tools/corpus/src/heap-bench.ts --runs 3 --json .codex-out/heap-final.json
node tools/corpus/src/bench.ts --runs 3 --only "arch-cn|dims|r12"
node --expose-gc tools/corpus/src/bench.ts --runs 3 --only "arch-cn|dims|r12" --gc
```

The pipeline tool now also reports render process CPU time. Its opt-in `--gc` collects
before rendering, excluding garbage from its additional tokenizer/model timing stages.
Default rendering behavior is unchanged. CPU includes worker/parallel GC time and can
exceed wall time. The default frontend measure includes the existing pick-data stage.

## Retained heap: all 17 files

| File | Entities including children | Heap before → after (MB) | B/entity before → after | Reduction |
|---|---:|---:|---:|---:|
| arch-cn-114 | 357,048 | 527.49 → 291.46 | 1477.4 → 816.3 | 44.7% |
| huge-blocks-187 | 17,649 | 220.32 → 133.01 | 12483.2 → 7536.7 | 39.6% |
| circles-117 | 720,409 | 798.43 → 303.46 | 1108.3 → 421.2 | 62.0% |
| splines-82 | 162,020 | 316.70 → 225.78 | 1954.7 → 1393.6 | 28.7% |
| proxy-hatch-77 | 51,920 | 144.28 → 92.90 | 2778.9 → 1789.4 | 35.6% |
| mtext-elec-35 | 22,177 | 39.83 → 25.50 | 1795.8 → 1149.8 | 36.0% |
| dims-rumah-34 | 111,886 | 202.44 → 121.38 | 1809.3 → 1084.8 | 40.0% |
| hatch-gdal-31 | 92,909 | 140.78 → 81.85 | 1515.3 → 881.0 | 41.9% |
| r13-polyline-24 | 75,485 | 116.37 → 62.03 | 1541.6 → 821.8 | 46.7% |
| viewports-24 | 8,282 | 63.07 → 28.81 | 7615.3 → 3478.2 | 54.3% |
| dense-hatch-21 | 62,593 | 111.47 → 69.34 | 1780.8 → 1107.9 | 37.8% |
| attribs-21 | 32,196 | 69.79 → 49.42 | 2167.7 → 1534.8 | 29.2% |
| r12-network-16 | 182,846 | 183.67 → 132.46 | 1004.5 → 724.4 | 27.9% |
| mpolygon-italy-26 | 20 | 51.90 → 51.77 | 2594904.4 → 2588371.2 | 0.3% |
| 3dface-civil-13 | 38,097 | 72.11 → 45.96 | 1892.7 → 1206.5 | 36.3% |
| binary-1 | 357 | 3.71 → 3.21 | 10383.4 → 8992.0 | 13.4% |
| binary-gdal-17 | 92,909 | 140.84 → 81.91 | 1515.8 → 881.6 | 41.8% |

All 17 files have exactly equal before/after `arrayBuffers` deltas. Examples: architecture
155,878,608 B, circles 159,820,672 B, and R12 44,426,752 B. File bytes are separate:
116,876,776 B for architecture, 119,865,499 B for circles (see raw report for exact input
sizes), and the R12 size recorded in the raw report. `external` is reported separately;
it overlaps typed-array storage and must not be added to `arrayBuffers` again.

Raw all-file three-run data: `.codex-out/heap-before.json` and `heap-final.json`.
Intermediate runs: `heap-records.json`, `heap-sparse.json`, `heap-index.json`,
`heap-shape.json`, `heap-attrib-check.json`, `heap-common-shape.json`. Non-circle base
shapes were subsequently restored, giving up part of the intermediate memory reduction.

## Logical steps and design decisions

| Step | Circle B/entity | Architecture B/entity | R12 B/entity | Decision |
|---|---:|---:|---:|---|
| Original current tree | 1108.3 | 1477.4 | 1004.5 | Establish fresh isolated-process baseline |
| Release record part caches / lazy helpers | 604.3 | 913.4 | 766.4 | Keep lossless tags, regenerate expanded structures |
| Sparse optional fields / primitive interning | 516.2 | 811.5 | 698.6 | Intern exact strings, never normalize their model values |
| Compact scan metadata / deferred entity index | 453.1 | 733.5 | 660.4 | Preserve public lookup semantics |
| Complete circle object shape | 421.2 | 732.9 | 660.3 | Avoid V8 property backing array for common circles |
| Final frontend adjustments | 421.2 | 816.3 | 724.4 | Retain hot text/dimension caches and general base shapes |

1. **Record caches:** discard parsed part arrays at completed entity groups and after
   document construction. Lazily allocate application-group ranges; presence bits avoid
   reconstructing absent app/XDATA/embedded sections. Plain one-part R12 `find`/`dataTags`
   scan lossless tags directly. Retain raw SEQEND enumerable caches because raw records
   escape on compound entities and their existing shape participates in model hashes.
2. **Compact metadata:** pack scan flags and two 11-bit relative handle/owner indices
   into one small integer. Offset 2047 means a lossless base-part fallback scan; tests
   cover 2045, 2046, 2047 and 4096, DIMSTYLE's 105, and app-data owner exclusion. Cached
   owner strings are unnecessary; exact primitive interning gives repeated owners the
   same value without separate retained string allocations. Pools are per TagStore,
   bounded to 4096 unique strings and collect with the document.
3. **Circle layout:** predeclare its full mandatory and geometry shape in one literal,
   retaining the exact original frozen point identities. Missing optional common fields
   have no own slot; their declared types now accurately allow absence. Explicit zero,
   false, empty strings and zero handles are preserved. The public external parser keeps
   its copying path, and failed parsing rebuilds the original UNKNOWN fallback base.
4. **Entity handles:** retain registration order in a reference list and cache up to eight
   distinct requested handles, including misses. The next distinct lookup builds the
   full index. This avoids a large second map for a loaded-only document and when drawing
   repeatedly queries only one dimension handle. Preserve duplicates' first registration,
   handle zero, public `parseEntities`, cached misses becoming present, and independence
   from edits to public `byHandle`. The public record handle map stays intact.
5. **Frontend tradeoffs:** retain subclass-based text/dimension parts because rebuilding
   them during drawing caused a regression. Restore non-circle base property slots to
   preserve hot access shapes. Skip absent app groups using a presence flag before an
   absent-property lookup. Attribute parsers now read a smaller field object and assemble
   the result once: the former large temporary object became dictionary properties,
   adding ~158 ms in the R12 profile. A five-run intermediate load fell from ~550 to
   ~372 ms after this change. External base extras/default precedence remain tested.

No shared-default optimization was retained. No TagStore array narrowing was attempted:
backing arrays are a separate budget and their public offsets must retain exact semantics.

## Heap snapshots

`heap-summary.ts` summarizes V8 node kinds and shallow sizes, and groups generic objects
by referenced property names. Inline numeric fields are not reference edges, so these
object labels are descriptive, not an exhaustive object-shape census. It reads flat
snapshot sections independently, avoiding Node's single-string size limit on the large
circle snapshot.

Before optimization, the R12 snapshot (`heap-before-snapshot.json` / `heap-before-summary.json`)
contains 267,272 DxfRecord objects / 36.35 MB shallow, 680,375 arrays / 21.77 MB,
property arrays / 20.38 MB, and 267,279 part-like objects / 14.97 MB. VERTEX objects
account for 15.98 MB and ATTRIB-like objects 8.72 MB; numeric boxes contribute 11.19 MB.
Native backing allocations are 63.92 MB. These counts include tables, objects, raw records
and children, so they exceed the top-level entity count.

The intermediate circle snapshot (`heap-sparse-circle-snapshot.json` and its summary)
shows 720,409 circle-like objects / 92.21 MB shallow, 720,460 DxfRecords / 86.46 MB,
map-like backing arrays / 59.49 MB, property arrays / 46.16 MB, points / 34.60 MB and
heap numbers / 34.58 MB. Its separate property arrays motivated preallocating the final
circle shape. Snapshot shallow totals and retained `heapUsed` deltas measure different
things; they should not be summed as independent budgets.

## Load timings

The latest paired comparison temporarily restored only the modified model source files
from HEAD, ran three isolated processes per file, restored the final sources byte-for-byte,
and ran the same three measurements. No git/index metadata changed.

| File | Load before (ms) | Load after (ms) | Change |
|---|---:|---:|---:|
| arch-cn-114 | 1553.3 | 1426.3 | -8.2% |
| circles-117 | 1805.2 | 1567.1 | -13.2% |
| dims-rumah-34 | 540.9 | 514.5 | -4.9% |
| r12-network-16 | 368.0 | 373.9 | +1.6% |

Raw data: `heap-paired-final-before.json` / `heap-paired-final-after.json`.
The all-17 final run is noisier: circles 1886 → 2652 ms, splines 949 → 1726 ms,
proxy-hatch 482 → 933 ms. These observations remain in `heap-final.json`; the separate
circle paired comparison did not reproduce its regression. The splines/proxy-hatch
outliers have not been resolved by a paired control, so a universal load-performance
claim would be premature. A prior five-run paired control also recorded architecture
1682 ms, circles 1990 ms, dimensions 601 ms and R12 402 ms before changes.

## Frontend timings

Latest default frontend pair (`node tools/corpus/src/bench.ts --runs 3 --only "arch-cn|dims|r12"`):

| File | Before wall / CPU (ms) | After wall / CPU (ms) | Wall change |
|---|---:|---:|---:|
| arch-cn-114 | 9250 / 14640 | 9499 / 14329 | +2.7% |
| dims-rumah-34 | 530 / 953 | 607 / 1047 | +14.5% |
| r12-network-16 | 240 / 281 | 235 / 313 | -2.1% |

Raw data: `frontend-paired-final-before.json` / `frontend-paired-final-after.json`.

The GC-isolated reverse-order three-run control is:

| File | Before wall / CPU (ms) | After wall / CPU (ms) | Wall change |
|---|---:|---:|---:|
| arch-cn-114 | 9578 / 16594 | 9698 / 15219 | +1.3% |
| dims-rumah-34 | 633 / 1125 | 686 / 1297 | +8.4% |
| r12-network-16 | 278 / 438 | 269 / 453 | −3.2% |

Earlier default paired readings varied (architecture 8946 → 9667 ms, dimensions
535 → 616 ms, R12 235 → 251 ms). The residual dimensions slowdown is an open acceptance
issue rather than evidence of zero regression. Geometry counts match: architecture
17,511,244 vertices / 69,329 batches; dimensions 893,332 / 3,931; R12 133,528 / 139.
The baseline fingerprint checks below provide the stronger correctness guarantee.

## Rejected experiments

- **Frozen-value walker:** the user-requested walker change was tested before any model
  changes. It expanded frozen objects as values while preserving mutable-object reference
  tracking. Result: 4,833 model-all records, zero errors, **4,012 differences**. Existing
  parsers already share frozen defaults, so the change alone cannot produce the requested
  zero differences against this saved baseline. Reverted walker and test; no gate relaxation
  or baseline migration. See `walker-only-model-all.log` and
  `rejected-frozen-walker.patch` (do not apply).
- **General sparse base shapes:** smaller memory but slower frontend access; restored
  undefined slots for non-circle types.
- **Discarding every part cache:** moved text/dimension parsing work into rendering;
  retain those hot subclass caches instead.
- **Normalized resolver-name cache:** no clear frontend benefit; reverted. Diagnostic
  `rejected-name-cache.patch` must not be applied.

## Validation

- `pnpm typecheck`: PASS. An initial run found declaration errors; corrected optional
  base fields and the attribute field-only generic; final typecheck is clean.
- `pnpm test`: PASS, 82 files / 619 tests. Git subprocess warnings from this sandbox's
  ownership policy do not fail tests; no global config was changed.
- `pnpm lint`: PASS, no errors; four warnings for large diagnostic JSON snapshots/profiles
  under `.codex-out` exceeding Biome's 1 MiB limit (folder removed before merging).
- `pnpm fingerprint --check --set fixtures --jobs 2`: PASS, 4,057 records, model/plot/viewer
  all identical, zero errors/differences (35.42 s). **All 4,057 plot hashes unchanged.**
- `pnpm fingerprint --check --set corpus --jobs 2`: PASS, 315 records, model/viewer
  all identical, zero errors/differences (25.11 s).
- `pnpm fingerprint --check --set model-all --jobs 2`: PASS, 4,833 records,
  all identical, zero errors/differences (56.03 s).
- Frozen-walker-only pre-model check: FAIL, 4,012 differences; experiment reverted.

Differential record tests compare release/rebuild cycles against the original record
oracle, with subclass lookup, find, data tags, app dictionary/reactors, embedded/XDATA,
handle and owner checks. Additional model tests cover omitted optional circle fields,
explicit falsy values, external attribute parsers and both stages of the handle index.

## Delivery and open work

Apply numbered patches 01–12 in order; each has a one-paragraph commit message.
`.codex-out/README.md` links every patch and measurement. The cumulative
`all-changes.patch` contains the final source/tests/docs/new tools and is an alternative
application path. `.codex-out` is diagnostic delivery material and should be removed
before merging. No commits were attempted.

Open: reduce circles from ~421 to ≤400 B/entity without reference or API changes; resolve
the dimensions frontend regression; control the splines/proxy-hatch load outliers; decide
separately whether a frozen-object hash-baseline migration is acceptable. A full handle
index is still allocated once enough distinct handles are queried, so loaded-only savings
are not a guarantee of identical retained heap after arbitrary application queries.
