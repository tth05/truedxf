# Memory frontend follow-up — 2026-10-03

Starting branch: clean `perf/memory` at rebased `55e6c84`, atop current master `30a06b7`.
The earlier memory work was already committed; none of its old patches were reapplied.
This follow-up changes only model record lookups/tests, a corpus profile-summary tool and
report/TODO/research documentation. Master is run in its own checkout and remains clean;
all outputs are written inside this worktree. Shared samples/baselines are read-only.

## Outcome

All six requested frontend cases are faster than master in both final alternating rounds.
Circles improve about 11% against master; dimensions improve about 2.5%. Retained loaded
circle heap is **421.23 B/entity**, unchanged within measurement noise from 421.20 and
below the ≤500 B/entity target. No per-record storage or default sharing was added.
Model load savings on architecture/circles remain; smaller cases vary within a few percent.

## Diagnosis

`PropertyResolver.plotStyle` calls `record.find(380)` on every entity (note 06 §6.2).
After loading, geometry records' expanded parts were discarded. An unqualified lookup
on an R13+ record rebuilt those parts, decoded/interned subclass names and retained the
helper graph again, even when 380 was absent. In the circle profile the call chain is:

```
renderPlot → drawEntityContent → propertyEntry → PropertyResolver.resolve
  → plotStyle → find(380) → get parts → computeParts → internString
```

`find` inclusive samples rise 115.8 → 244.7 ms and `computeParts` appears at 148.8 ms
inclusive. On dimensions `find` rises 3.2 → 43.2 ms, including 26.1 ms recomputation.
The initial repair removes simple base/subclass reconstruction; instrumentation then
found residual group-380 rebuilds on 647 LINEs, 592 HATCHes, 537 app-bearing LWPOLYLINEs,
431 XDATA-bearing LWPOLYLINEs, and smaller groups of ARC/SPLINE/INSERT/other geometry.
The second repair covers those ranges too. See `record-rebuild-dims-step01.log`; the final
instrumentation (`record-rebuild-dims-final.log`) confirms **zero group-380 reconstructions**.

The first repair's five-run circle frontend is 1144 ms versus 1423 ms before, with the
same retained heap. Dimensions improve 464 → 444 ms but still rebuild complex records;
the final range-aware path reaches 423 ms in both final rounds.

## Fix and correctness

For already-scanned records with released parts, unqualified `find` reads codes directly.
Simple base/subclass records need a tight code loop. For records with application groups,
retained app ranges skip exactly the same tags as the original `nextDataTag` loop. The first
XDATA marker or recognized `101 Embedded Object` permanently ends ordinary data; another
101 value remains a data tag. Subclass-marker queries (`code 100`), qualified subclass
queries, unscanned records and already cached parts retain the original full path. Plain
R12 subclass leniency is unchanged. Explicit `parts`, `subclass` and XDATA APIs still rebuild
when their structured values are requested. No new index, flag or cache is allocated.

The expanded differential test checks released lookup results before any other accessor
recreates the cache, across 5,000 seeded records/field definitions and undefined/empty/A/B
subclass selectors. Group 380 participates in the randomized tags and queries. Dedicated
regression cases assert no parts getter call for missing/present fields, duplicate 380s,
application groups, embedded/XDATA boundaries and unrecognized 101 values. Raw SEQEND
enumeration, existing default identities, entity property shapes, deferred handle-index
behavior, lossless tags and the fingerprint walker stay unchanged.

## Paired frontend benchmark

Node v23.10.0. Each value is the median of five fresh ViewerCore runs; two alternating
rounds execute **master → fixed → master → fixed**, sequentially, without our tests,
fingerprints, profiling or heap measurements overlapping. Master runs at
`C:/Users/Tim/programming/projects/intellij/truedxf`, commit `30a06b7`; fixed runs in this
worktree. The unfixed column is a separate fresh master/unfixed-branch pair before edits
(one five-run round), not an average of the user's supplied earlier measurements.

```powershell
node tools/corpus/src/bench.ts --runs 5 --only "dims|arch-cn|r12|circles|splines|proxy"
```

Milliseconds, existing viewer frontend metric:

| File | Master rounds 1 / 2 | Unfixed branch, fresh 5-run median | Fixed rounds 1 / 2 | Fixed vs master, mean of round medians |
|---|---:|---:|---:|---:|
| circles-117 | 1276 / 1275 | 1423 | 1149 / 1128 | -10.7% |
| dims-rumah-34 | 435 / 433 | 464 | 423 / 423 | -2.5% |
| splines-82 | 1018 / 1015 | 1117 | 987 / 970 | -3.7% |
| arch-cn-114 | 4013 / 4076 | 4179 | 3750 / 3783 | -6.9% |
| proxy-hatch-77 | 323 / 322 | 326 | 309 / 305 | -4.8% |
| r12-network-16 | 232 / 235 | 224 | 226 / 230 | -2.4% |

All pairwise per-round frontend comparisons pass the ~3% limit; every fixed value is
lower than its corresponding master value. Geometry, transfer size, batches, active
layout and unsupported counts match master on all six files. Raw data/logs are
`paired-1-master`, `paired-1-fixed`, `paired-2-master`, `paired-2-fixed` in `.codex-out`.
The instrumented CPU-profile runs are excluded from these benchmark numbers.

## Model timings

The same paired pipeline reports model milliseconds including tokenization:

| File | Master rounds 1 / 2 | Fixed rounds 1 / 2 | Change, mean of round medians |
|---|---:|---:|---:|
| circles-117 | 2371 / 2412 | 1971 / 1926 | -18.5% |
| dims-rumah-34 | 452 / 463 | 446 / 445 | -2.6% |
| splines-82 | 907 / 959 | 931 / 910 | -1.3% |
| arch-cn-114 | 1743 / 1742 | 1577 / 1454 | -13.0% |
| proxy-hatch-77 | 431 / 424 | 407 / 416 | -3.7% |
| r12-network-16 | 438 / 445 | 445 / 441 | +0.3% |

Architecture and circles retain clear model load gains. Splines vary from +2.6% to −5.1%
across the two rounds, R12 from +1.6% to −0.9%; this does not establish a 5–15% gain on
every small case. The repair adds no load-only structure; fresh isolated heap-tool timings
below also show no large model regression. The original noisy splines/proxy load outliers
are not reproduced in these paired current-master controls. Do not extrapolate to files
outside the selected set or claim statistical confidence from two medians.

A separate load-only control isolates this repair from the earlier memory changes: the
current rebased HEAD record implementation and the fixed implementation run in alternating
fresh `--expose-gc` processes, five runs per file, two rounds. Only `record.ts` is temporarily
restored from rebased HEAD; final source is restored byte-for-byte in `finally`. No validation
or render benchmarks overlap this control.

| File | Rebased HEAD rounds 1 / 2 (ms) | Fixed rounds 1 / 2 (ms) | Change, mean of medians |
|---|---:|---:|---:|
| r12-network-16 | 377.5 / 373.8 | 376.4 / 374.6 | -0.04% |
| splines-82 | 784.7 / 779.6 | 789.7 / 790.1 | +0.99% |
| dims-rumah-34 | 516.9 / 514.7 | 529.5 / 520.5 | +1.78% |

This control shows no material load regression from the repair: R12 is unchanged; splines
and dimensions are within the ~3% noise band. Raw files: `load-control-{1,2}-{head,fixed}.json`.

## Retained heap

Three isolated `--expose-gc` processes per file, GC twice before/after `DxfDocument.load`.
The input Buffer precedes the baseline and the document remains live after GC. MB is decimal;
entity counts include POLYLINE vertices and INSERT attributes. This compares the rebased
memory branch before/after this repair, not its old pre-memory master.

| File | Heap before → after (MB) | B/entity before → after | Isolated load before → after (ms) |
|---|---:|---:|---:|
| circles-117 | 303.439 → 303.461 | 421.20 → 421.23 | 1663.6 → 1581.4 |
| dims-rumah-34 | 121.375 → 121.380 | 1084.81 → 1084.85 | 519.4 → 520.3 |
| splines-82 | 225.795 → 225.786 | 1393.62 → 1393.57 | 780.1 → 786.9 |
| arch-cn-114 | 291.463 → 291.457 | 816.31 → 816.30 | 1457.8 → 1421.0 |
| proxy-hatch-77 | 87.191 → 87.181 | 1679.33 → 1679.13 | 480.6 → 474.1 |
| r12-network-16 | 132.457 → 132.462 | 724.42 → 724.45 | 372.2 → 382.8 |

Every selected file's `arrayBuffers` delta is exactly unchanged; circles retain
159,820,672 B of array-buffer allocations, plus 119,865,499 B of separately counted input.
Circles include 720,409 entities, with 303,461,040 B retained JS heap (see raw measurements
for the independently computed medians). The ≤400 B stretch target from the earlier task
remains open; this follow-up's ≤500 B requirement is met without a heap tradeoff.

Raw reports: `heap-followup-before.json`, `heap-step01.json`, `heap-followup-final.json`.
The first repair is the only intermediate runtime step; the second step is the final state.

## CPU profiles

Four before profiles (master/branch × circles/dimensions), two intermediate branch profiles,
and two final branch profiles use the requested `--cpu-prof --runs 1` command in their own
checkout; output names end in `.json` to comply with the delivery folder's extension rule.
`profile-summary.ts` emits sampled self/inclusive milliseconds, filtered by ViewerCore
render or renderPlot stack frames, including async continuations after font preparation.
Recursive function instances count once per sample. Root GC samples are reported separately
as unscoped: the tool cannot assign them to rendering. JIT inlining and sampling shift self
attribution; zero means no sampled time, not proof of zero calls. Inclusive rows overlap
and must not be summed as independent budgets. Unprofiled paired times determine acceptance.

```powershell
node --cpu-prof --cpu-prof-dir=<this-worktree>/.codex-out --cpu-prof-name=<name>.json tools/corpus/src/bench.ts --runs 1 --only circles
node tools/corpus/src/profile-summary.ts <profiles...> --json .codex-out/profiles-summary.json
```


### circles: sampled self / inclusive milliseconds

| Model accessor | Master | Unfixed branch | Fixed branch |
|---|---:|---:|---:|
| find | 115.8 / 115.8 | 27.2 / 244.7 | 17.6 / 17.6 |
| get parts | 0.0 / 0.0 | 70.2 / 217.5 | 0.0 / 0.0 |
| computeParts | 0.0 / 0.0 | 95.1 / 148.8 | 0.0 / 0.0 |
| internString | 0.0 / 0.0 | 53.7 / 53.7 | 0.0 / 0.0 |
| get handle | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| get owner | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| subclass | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| xdata | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| getEntity | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| resolve | 67.8 / 237.2 | 24.6 / 317.1 | 28.7 / 88.9 |
| plotStyle | 3.5 / 115.3 | 0.0 / 244.7 | 0.0 / 14.1 |

### dims: sampled self / inclusive milliseconds

| Model accessor | Master | Unfixed branch | Fixed branch |
|---|---:|---:|---:|
| find | 3.2 / 3.2 | 5.7 / 43.2 | 15.0 / 15.0 |
| get parts | 0.0 / 0.0 | 11.4 / 37.5 | 0.0 / 2.0 |
| computeParts | 0.0 / 0.0 | 18.8 / 26.1 | 2.0 / 2.0 |
| internString | 0.0 / 0.0 | 7.3 / 7.3 | 0.0 / 0.0 |
| get handle | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.4 |
| get owner | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| subclass | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| xdata | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| getEntity | 0.0 / 0.0 | 0.0 / 0.0 | 1.5 / 1.5 |
| resolve | 27.7 / 51.5 | 27.6 / 93.1 | 20.2 / 43.2 |
| plotStyle | 2.0 / 3.3 | 2.0 / 43.5 | 2.0 / 14.8 |

Circle reconstruction/interning disappear from the final render samples. Dimensions retain
about 2 ms of structural work for synthetic/nested document parsing, rather than geometry
`find(380)` rebuilding. `find` now accounts for 15 ms directly in that profile, while total
model resolution drops 93.1 → 43.2 ms inclusive. Handle/owner/subclass/XDATA accessors and
selective getEntity were not dominant causes. The fix meets the rendering target without
changing sparse circle shapes, string pools or deferred entity indexing.

## Validation and baseline provenance

- `pnpm typecheck`: PASS.
- `pnpm test`: PASS, **648 tests / 83 files**. Sandbox Git ownership warnings from test
  subprocesses remain nonfatal; no global Git configuration was changed.
- `pnpm format` / `pnpm lint`: PASS, no errors; one warning for the 2.3 MiB local
  fixture-baseline JSON exceeding Biome's file-size limit (delivery folder removed before merging).
- `pnpm fingerprint --check --set model-all --jobs 2`: PASS against the shared saved
  `baseline`, **4,833 identical**, zero errors/differences.
- `pnpm fingerprint --check --set fixtures --jobs 2`: EXIT 1 against the shared saved
  baseline: **4,057 identical model and plot**, 96 viewer differences, zero stage errors.
- `pnpm fingerprint --check --set corpus --jobs 2`: EXIT 1 against the shared saved
  baseline: **315 identical model**, 23 viewer differences, zero stage errors.
- Unchanged current master has exactly the same 96 fixture and 23 corpus viewer differences,
  with the same case IDs and reasons, and zero model/plot differences. The shared viewer
  baseline predates current master; it is not overwritten or relaxed.
- `pnpm fingerprint --check --set fixtures,corpus --name rebased-master --output-dir
  .codex-out/fingerprint --jobs 2`: PASS, **4,057 fixture model/plot/viewer and 315 corpus
  model/viewer records identical**, zero errors/differences against unchanged current master.

A local `rebased-master` baseline is saved by unmodified master using the existing CLI's
`--output-dir` and `--name`; only JSON is written under `.codex-out/fingerprint` (no detail
position binaries requested). Checking the fixed branch against it uses identical default
viewer/plot options. No gate implementation or walker modification is made. The original
shared-baseline failures remain reported above, rather than calling them passes.

## Delivery and limitations

No commits or git-index changes. Four ordered `.patch`/`.msg` pairs are in `.codex-out`:
01 profile summary, 02 simple released lookup, 03 range-aware released lookup, 04 report/TODO/
research updates. `all-changes.patch` is the cumulative alternative from rebased `55e6c84`;
apply this follow-up only, not the previously committed memory patches. See `.codex-out/README.md`.

Open: shared viewer baseline migration belongs to the current master changes; circle ≤400 B
remains a separate stretch goal. Smaller model load gains are within measurement variation.
No GPU/browser or new AutoCAD work was needed for this representation fix. Full structured
accessors still allocate parts on demand; this deliberately optimizes the ordinary data
lookup that property resolution actually uses.
