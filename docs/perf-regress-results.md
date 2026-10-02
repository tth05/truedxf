# Viewer render regression repairs (2026-10-02)

Starting checkout: `a6049ae`, branch `perf/regress`. Changes remain in the worktree; no Git
metadata or shared samples were written. Fresh `regress-base` fingerprints were saved from
the unmodified checkout under `.venv/perf-regress/fingerprint`, using `--output-dir` to keep
all writes inside this worktree. Artifacts and commit messages are in `.codex-out/`.

## Measurements

Node v23.10.0, 1600 × 1000, median of three fresh ViewerCore runs per drawing:

```sh
node --disable-warning=ExperimentalWarning --max-old-space-size=16000 tools/corpus/src/bench.ts --runs 3 --zoom --only "^(3dface-civil-13|circles-117|arch-cn-114|dims-rumah-34|r12-network-16)$" --json .codex-out/bench-after.json
```

The before/after benchmarks ran sequentially without overlapping our validation or profiling
jobs. Other system activity and GC still cause variability. Morning/wave figures are read
from the existing reports, not reruns of those revisions. Current master also includes
culling, density-preserving greeking and block reuse added after the render-track merge;
only the fresh before/after pair isolates this repair.

Times are **first render / 4× zoom**, in milliseconds:

| Drawing | Morning 45fe2d2 | Wave b4baddc | Fresh before | After | First vertices before = after |
|---|---:|---:|---:|---:|---:|
| 3dface-civil-13 | 203 / 180 | 313 / 137 | 313 / 119 | 205 / 108 | 197,985 |
| circles-117 | 2,888 / 1,951 | 1,928 / 2,412 | 1,993 / 2,415 | 1,283 / 1,747 | 5,584,792 |
| arch-cn-114 | 24,392 / 12,847 | 10,053 / 10,977 | 5,603 / 6,142 | 4,149 / 4,436 | 17,063,074 |
| dims-rumah-34 | 1,423 / 730 | 649 / 720 | 484 / 551 | 435 / 498 | 859,983 |
| r12-network-16 | 434 / 329 | 298 / 291 | 251 / 297 | 236 / 236 | 133,528 |

Civil's first render improves 34.5%; circles' zoom improves 27.7%, below the morning 1,951 ms.
All five first-render batch counts, vertex counts and transfer sizes remain unchanged.
`bench-before.json` and `bench-after.json` contain the full pipeline numbers.

## Causes and decisions

**1. Property caches, not text layouts or culling, account for the circle regression.**
`a4e2abc` retained a WeakMap entry for each entity in each inheritance/viewport context and
another WeakMap entry for its adapted `Resolved` properties. A circle's repeated visibility
and colour queries hit immediately; retaining all 720,409 entities buys no subsequent hits
because every frontend is new. Text layout caching is not visited by CIRCLEs, and the requested
`--zoom` benchmark supplies no cull window, so no per-entity culling predicate runs.

The replacement retains one current entity per inheritance/viewport context, including its
adapted properties. Adjacent queries still share objects; visiting another entity evicts the
old entry. Restoring a viewport context still reuses its current entry. Resolution remains
local to a frontend; inheritance, viewport overrides and missing-resource diagnostics retain
their behavior. A cache-only median-of-three run measured circles at **1,253 / 1,598 ms** and
civil at **268 / 142 ms**. Differences from the final run are ordinary run/GC variation.

Before/after CPU profiles used `--cpu-prof --cpu-prof-dir=.venv/perf-regress`, with one run
of circles and civil including zoom. `diagnose-before.log` / `diagnose-after.log` contain pass
timings, bounds, vertices and heap snapshots; `profile-before.json` / `profile-after.json`
summarize self samples. Across the entire profiled pipeline (including parsing), sampled time
falls **12,184 → 9,450 ms**, GC **2,443 → 1,134 ms**. The two old renderer cache methods
account for **520 + 352 ms** self time; the new `propertyEntry` accounts for **62 ms**.
Inlining and sampling affect method attribution; these are not exclusive render-phase GC
measurements. Circle heap snapshots after first/zoom drawing fall **1,309/1,544 → 844/977 MiB**;
they are instantaneous heapUsed, not peak or retained-heap measurements. Profiled geometry is
identical: 5,584,792 initial and 10,787,978 zoom vertices.

**2. Civil really incurred three passes.** Its header spans (0,0) to
(552656.62,6140343.68); the geometric probe spans approximately
(546788.16,6138690.80) to (552656.65,6139957.27). The failed LOD fast pass uses 6,140.34 units
per pixel, versus the final 3.6678 units per pixel. Before-profile draw times were **169 ms
rejected fast pass + 128 ms probe + 124 ms final**. The complete profiled frontend was 468 ms;
profiling/setup adds overhead, so this is not the unprofiled 313 ms median.

A bounded preflight samples at most 32 evenly spaced top-level entities' explicit WCS
LINE/POINT/3DFACE vertices. With at least eight usable entities and sample spans below 1/64
of both header spans, the viewer chooses the existing accurate probe directly. It never
fits to sampled geometry. OCS/block anchors are excluded; plot and paper-layout paths are
unchanged. Civil now takes two passes and retains exactly the same probe/final bounds and
pixel sizes. Tests include unsampled distant geometry to ensure it still participates in
the fit. No intentional first-fit output change was needed on either fingerprint set.

This is deliberately a heuristic for choosing work, not a proof that the header is wrong.
A false positive can turn a valid one-pass viewer approximation into an accurate two-pass
fit; a false negative retains the original three-pass fallback. The conservative 64×
threshold leaves normal scale disagreements to the existing 4× check. See note 03 §6.3.

**3. The visible-bounds TODO cannot safely substitute `list.bounds`.** Although both exclude
unbounded batches and respect clip boxes, the builder clips each float64 primitive box while
the viewer clips the whole float32-relative batch box. Tests demonstrate quantization and
two disconnected primitives straddling a clip, where builder bounds are empty but viewer
bounds are not. Changing this would alter viewer hashes and zoom windows.

Instead, `buildPickData` optionally accumulates batch boxes from its existing vertex scan.
`DrawingState` reuses these in `visibleBounds`, preserving the original origin-addition and
clipping order. Complete contiguous pick coverage removes the second vertex scan;
unpicked/incompletely picked batches fall back to scanning. Unbounded batches remain excluded.
No display-list schema, model, plot geometry or interaction semantics change. See note 08 §10.16.

Median of 11 alternating bounds calls on the same returned lists; exact equality asserted
each iteration (`bounds-measurement.log`). All ten lists had zero fallback batches. These
measure bounds computation only; additional per-batch bookkeeping is part of pick work.

| Drawing | Initial scan → reuse ms | Zoom scan → reuse ms |
|---|---:|---:|
| arch-cn-114 | 38.90 → 6.09 | 44.85 → 5.78 |
| circles-117 | 9.58 → 0.62 | 17.01 → 0.37 |
| dims-rumah-34 | 1.64 → 0.14 | 2.45 → 0.20 |
| r12-network-16 | 0.17 → 0.002 | 0.17 → 0.002 |
| 3dface-civil-13 | 0.27 → 0.003 | 1.10 → 0.008 |

Bounds computation was formerly outside `ms.frontend`, so its improvement is not included
in the first/zoom timing table. The measurement-only run's pipeline timings are not used
for comparisons (one run, instrumentation, and a brief overlapping typecheck).

## Gates and delivery

- `pnpm typecheck`: PASS.
- `pnpm test`: PASS, 642 tests across 83 files. Targeted renderer/viewer tests also pass.
- `pnpm format` / `pnpm lint`: PASS.
- Fixtures, `regress-base`: **4,057 identical model + 4,057 identical plot + 4,057 identical
  viewer hashes**, zero differences and zero error records.
- Corpus, `regress-base`: **315 identical model + 315 identical viewer hashes**, zero
  differences and zero error records. This set does not contain plot hashes.
- `model-all`: not required; packages/core and packages/model were not touched.
- `git diff --check`: PASS. Shared `baseline` and samples remain read-only.

Independent ordered patches (including new files; no index writes):

1. `.codex-out/01-property-cache.patch` / `.msg`: bound per-context property retention.
2. `.codex-out/02-stale-extents.patch` / `.msg`: avoid grossly stale speculative fits, tests, note.
3. `.codex-out/03-visible-bounds.patch` / `.msg`: reuse pick boxes without changing bounds, tests, note.
4. `.codex-out/04-results.patch` / `.msg`: this report and TODO updates.

Open limitations: sampled hints do not guarantee two passes for every stale header; external
viewer first-fit output outside the fingerprint sets can choose the accurate path instead
of the approximation. Incomplete pick coverage retains a vertex scan. No GPU/browser or new
AutoCAD run was needed for these CPU changes. Initial cache tests exposed reliance on object
identity after eviction; the test now explicitly checks equal properties and reuse of the
current restored context. The direct `list.bounds` substitution was rejected for the reasons
above. No commits were attempted.
