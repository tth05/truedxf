# Renderer performance results — 2026-10-02

Implemented property/layout caches and smooth viewer LOD. Plot output and LOD-off output remain exact. No shared samples or baseline files were written. The final same-view reductions are 65.8% in arch-cn vertices and 99.2% in dense-hatch vertices.

## Commit status

**No commits were created.** Git rejected the index lock at `C:/Users/Tim/programming/projects/intellij/truedxf/.git/worktrees/truedxf-wt-render/index.lock` with Permission denied. That metadata is outside this task's writable directory. The checkout remains on `perf/render`, with the changes uncommitted. There are no commit hashes to report.

Ordered, independently reviewable patches in the local `.perf-render/` directory:

1. `part-a1.patch` — **Cache entity properties by inheritance and viewport context**. Includes the diagnostic/context tests and test-runner repair. Vitest previously discovered a node:test file as an empty suite; pnpm test now runs it with Node. The dense ellipse property test needed a longer timeout under load; its assertions, seed and sample count are unchanged.
2. `part-a2.patch` — **Cache entity text layouts within each frontend**. Fonts, text/tag/value, default height, quick text, dimension flag and linked wrap width participate in cache identity. Existing glyph/tolerance caches already cover tessellation.
3. `part-b.patch` — **Add opt-in viewer level of detail and CPU comparison tooling**. B1 stored-extents fast pass with accurate fallback, B2 family coverage/continuous dashes, B3 cap-height greeking, B4 narrow lineweight hairlines, tests, notes and this report. Wide filled polyline bands keep their original geometry.

`all-changes.patch` contains the complete change including new files. The patches are artifacts, not commits. Optional A3 work was not attempted.

## Frontend benchmark

Node v23.10.0, median of three, 1600 × 1000, the requested arch-cn/dims/r12/mtext/hatch-gdal/attribs/proxy selection (also selects binary-gdal). Times in milliseconds. **Timings were affected by concurrent system load and overlapping checks**, particularly A1/A2; about 3 GB of RAM was free during part of A1. These raw results do not establish an isolated speed benefit for A2. All A1/A2 vertex counts equal the measured baseline.

| File | Before ms | A1 ms | A2 ms | Final B ms | Before / A vertices | Final B vertices |
|---|---:|---:|---:|---:|---:|---:|
| arch-cn-114 | 41,059 | 29,242 | 35,989 | 14,381 | 51,205,833 | 17,511,244 |
| proxy-hatch-77 | 1,576 | 6,266 | 1,655 | 641 | 3,489,035 | 906,287 |
| mtext-elec-35 | 470 | 2,506 | 578 | 178 | 2,046,148 | 284,012 |
| dims-rumah-34 | 1,414 | 3,992 | 1,702 | 697 | 2,792,041 | 893,332 |
| hatch-gdal-31 | 1,364 | 4,412 | 1,410 | 540 | 2,511,583 | 656,639 |
| attribs-21 | 256 | 596 | 273 | 78 | 930,339 | 233,602 |
| r12-network-16 | 578 | 1,000 | 513 | 306 | 133,528 | 133,528 |
| binary-gdal-17 | 1,337 | 1,708 | 1,380 | 896 | 2,511,583 | 656,639 |
| dense-hatch-21 | 92,639* | — | — | 2,057 | 208,052,327* | 1,745,701 |

*Dense-hatch's first-render before values are the earlier saved benchmark baseline, not a new A-step measurement; dense-hatch is absent from the requested A regex. Its new fixed-view off/on measurement is in the next table. Raw stage JSON/logs are retained locally in `.perf-render/`.

B4 alone saves 633,340 arch-cn vertices (3.49%) relative to the corrected B1–B3 fixed-view run. Dense-hatch's vertex count is unchanged by the lineweight threshold. The attempted narrow filled-band shortcut was rejected: on huge-blocks it increased vertices from 159,948 to 250,966 in an isolated feature check and changed 28.754% of ink. Without that shortcut, the final whole-LOD comparison is 4.468%.

## Gates

`pnpm typecheck`, `pnpm test` (575 Vitest tests in 72 files plus six Node tests), `pnpm lint` and `git diff --check` pass. The full fingerprint commands use the shared `baseline` without modifying it. B commands exit 1 because their viewer differences are expected and reviewed; there are **zero model/plot differences and zero stage errors**.

| Stage | Fixtures model / plot / viewer differences (4,057 files) | Corpus model / viewer differences (315 files) |
|---|---|---|
| A1 | 0 / 0 / 0 | 0 / 0 |
| A2 | 0 / 0 / 0 | 0 / 0 |
| B / LOD off | 0 / 0 / 0 | 0 / 0 |
| B / LOD on | 0 / 0 / 1,678 | 0 / 93 |

The corpus set has no plot hashes; fixture plots cover all 4,057 generated cases. The B/LOD-off check temporarily disabled ViewerCore's LOD request for both complete sets, then restored it. Every changed B viewer is therefore caused by the enabled LOD path, including B1 metadata/tolerance changes with unchanged vertex counts. Circles and splines have zero same-view raster difference despite their initial-fit fingerprint changes.

All 1771 changed viewer IDs, before/after vertex counts, deltas and reasons are in the local [viewer-deltas.csv](../.perf-render/viewer-deltas.csv). A coordinate/colour/metadata-only change has delta 0. Detailed console records are in `final-fixtures.log` and `final-corpus.log`.

CPU fidelity: `node packages/testkit/src/cpu-suite.ts hatches text mtext blocks --quiet`; every per-case score is identical before/after (the JSON reports are byte-identical), including after A1. Total: 911 cases, 198 exact, 816 at F1(r=1) ≥ 0.99.

| Suite | Cases | Exact | F1 ≥ .99 | Mean F1(r=1), unchanged |
|---|---:|---:|---:|---:|
| hatches | 279 | 140 | 247 | 0.954089628 |
| text | 294 | 15 | 278 | 0.987029116 |
| mtext | 250 | 1 | 209 | 0.953402865 |
| blocks | 88 | 42 | 82 | 0.983910509 |

## Fixed-view CPU LOD check

`node --disable-warning=ExperimentalWarning --expose-gc --max-old-space-size=16000 tools/corpus/src/lod-check.ts --json .perf-render/lod-final-b.json --images .perf-render/lod-final-b-images`

Both lists use the same explicit window from the LOD-off extents fit. The first fit is excluded from the reported frontend intervals; fonts/glyph caches are warm. Pixels count when any RGB channel differs by more than 48. Percentage denominator is the union of ink pixels in both images. This CPU rasterizer has no AA; single-pixel hairlines use clipped Bresenham traversal. It is a comparison tool, not a claim of browser AA equivalence.

| File | Vertices off | Vertices on | Frontend off ms | Frontend on ms | Pixels >48 | % of ink |
|---|---:|---:|---:|---:|---:|---:|
| arch-cn-114 | 51,205,833 | 17,511,381 | 15,302 | 11,108 | 4,342 | 10.813% |
| huge-blocks-187 | 159,948 | 84,281 | 165 | 95 | 527 | 4.468% |
| circles-117 | 5,584,792 | 5,584,792 | 2,045 | 1,966 | 0 | 0.000% |
| splines-82 | 2,057,738 | 2,057,738 | 1,507 | 1,579 | 0 | 0.000% |
| proxy-hatch-77 | 3,489,035 | 906,287 | 902 | 802 | 7,698 | 8.470% |
| mtext-elec-35 | 2,046,145 | 282,020 | 311 | 249 | 1,225 | 6.938% |
| dims-rumah-34 | 2,792,041 | 892,980 | 902 | 897 | 2,730 | 3.793% |
| hatch-gdal-31 | 2,511,583 | 629,912 | 826 | 771 | 3,684 | 9.637% |
| r13-polyline-24 | 405,212 | 405,212 | 386 | 385 | 0 | 0.000% |
| viewports-24 | 3,262,765 | 1,689,941 | 535 | 507 | 5,481 | 3.842% |
| dense-hatch-21 | 208,052,327 | 1,745,701 | 59,087 | 2,166 | 4,505 | 6.061% |
| attribs-21 | 930,339 | 233,602 | 134 | 118 | 2,430 | 3.098% |
| r12-network-16 | 133,528 | 133,528 | 300 | 318 | 0 | 0.000% |
| mpolygon-italy-26 | 1,645,110 | 1,645,110 | 712 | 675 | 0 | 0.000% |
| 3dface-civil-13 | 987,368 | 214,203 | 167 | 152 | 1,790 | 3.170% |
| binary-1 | 221,735 | 26,939 | 41 | 31 | 1,586 | 11.988% |
| binary-gdal-17 | 2,511,583 | 629,912 | 711 | 662 | 3,684 | 9.637% |
| hatches/arc-edge-ccw | 396 | 396 | 1 | 1 | 0 | 0.000% |
| hatches/mpolygon-solid-holes | 33 | 33 | 1 | 1 | 0 | 0.000% |
| hatches/user-single-s5-a30 | 82 | 82 | 1 | 0 | 0 | 0.000% |
| text/align-aligned-r000 | 1,400 | 1,400 | 1 | 1 | 0 | 0.000% |
| text/flags-4-middle | 1,580 | 1,580 | 1 | 1 | 0 | 0.000% |
| text/xdata-sans-italic | 5,271 | 5,271 | 2 | 1 | 0 | 0.000% |
| mtext/attach-1-two-lines-w120 | 308 | 308 | 1 | 1 | 0 | 0.000% |
| mtext/height-style-0 | 1,850 | 1,850 | 1 | 1 | 0 | 0.000% |
| mtext/wrap-wrap-then-p | 3,231 | 3,231 | 1 | 1 | 0 | 0.000% |
| blocks/anonymous-e | 158 | 158 | 1 | 0 | 0 | 0.000% |
| blocks/nonuniform-0004 | 1,226 | 1,226 | 1 | 1 | 0 | 0.000% |
| blocks/zero-scale-z | 188 | 188 | 0 | 1 | 0 | 0.000% |

Off/on/diff PNGs are saved locally under `.perf-render/lod-final-b-images/`; raw values are in [lod-final-b.json](../.perf-render/lod-final-b.json). The sparse arch-cn drawing changes 4342 pixels (0.271% of the canvas). Dense-hatch changes 4505 pixels (0.282% of the canvas). Relative ink differences are not uniformly small; the table reports them without hiding that limitation.

## Findings and open issues

- Visual inspection of arch-cn, proxy-hatch and huge-blocks PNG pairs preserved placement and large structures. Differences concentrate in tiny text, dense pattern coverage and strokes near one pixel. The high huge-blocks error was investigated with separate hatch/text/width runs and fixed by rejecting filled-band greeking; the final pair was inspected again.
- Rasterizing sub-pixel patterns without AA produces phase-dependent missing/solid pixels. Coverage fills change those pixels to the intended average colour; 1 px greeking and narrowed lineweights also move/change ink at the pixel grid. Some relative ink percentages still exceed 10%; this is a visible approximation at this scale, not bit-identical viewer fidelity.
- Arch-cn still exceeds the plan's <10 M vertices / ≤10 s goals. A by-type diagnostic before rejecting the band shortcut showed 5.15 M HATCH, 6.49 M LWPOLYLINE and 3.15 M LINE vertices, versus only 0.58 M TEXT. Remaining work is hatch geometry, wide bands, culling and block geometry reuse, rather than more text tessellation caching. View culling and the optional micro-optimizations remain open.
- LOD changes batch fragmentation; dense-hatch's final list has 59,996 batches despite its much smaller geometry. Batch merging belongs to the other renderer task; packages/three, viewer.ts and apps/playground were not edited.
- Commit creation remains blocked by the worktree metadata permissions. No shared baseline, samples, fonts or AutoCAD settings were changed.
