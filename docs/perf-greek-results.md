# Density-preserving text LOD — 2026-10-02

Ink-area greeking preserves tiny text density with one filled quad (six vertices) per compatible run. Changes remain uncommitted on perf/greek. No Git metadata, shared samples, baselines, fonts or AutoCAD settings were written. The supplied baseline remains read-only. Patches and raw evidence are in .codex-out/, which is removed before merging.

## Design

The existing 1.5-device-pixel cap-height / largest-singular-value threshold is unchanged. Greeking applies only to smooth viewer LOD; plot mode ignores it.

TrueType ink area is cached by glyph identity. Reference outlines are flattened at ink-box extent / 1024 (power-of-two tolerance bucket) and normalized with the same fixed-point nonzero union as glyph triangulation. The resulting polygon area includes holes, overlap and self-intersections, and is multiplied by the absolute glyph-transform determinant. Avoiding earcut and retained fine reference meshes makes cold loading cheaper than summing reference triangles.

SHX caches reference stroke length without lineweight. Uniform transforms scale the scalar length; nonuniform transforms sum transformed cached reference segments, with a one-entry linear-transform cache. Target area is target stroke length times frontend stroke width (one device pixel for hairlines). Stroke ink boxes include half-width padding.

Consecutive compatible glyph placements share one rectangle aligned with the baseline, spanning their union ink extent. Height = summed target ink area / run width, clamped to the run ink-box height and centred on that box. Run identity, font, linear transform, baseline and resolved RGBA changes split rectangles; SHX and stack placements without raster-run IDs use affine/baseline compatibility. Very small positive areas are emitted. No alpha boost or minimum-height hairline is added; source transparency is preserved, while opaque text remains mergeable.

Backgrounds and decoration lines keep their original paths. Tests cover holes, overlapping contours, affine/mirrored geometry, run/colour/baseline boundaries, preserved backgrounds and stack bars, SHX draw-time width/cache identity and backend LOD forwarding.

RenderParams.lod defaults to true. Viewer options accept lod: false alongside the existing LodOptions object, and the playground accepts ?lod=0. Disabling approximations still allows curve re-tessellation during zoom. The Node GPU script shares the bench-set resolver without pulling another TS project's sources into the playground rootDir.

## Hardware-AA comparison

Run node apps/playground/scripts/lod-check.ts --label master before the text change, then --label normalized for the retained version. Chromium uses --use-angle=d3d11 and --ignore-gpu-blocklist, omits unsafe SwiftShader, and verifies both hardware rendering and enabled AA. GPU: Radeon RX 9070 XT / ANGLE D3D11. The 1600×1000 browser viewport leaves a 1016×924 drawing canvas; DPR 1. Both lists use exactly the same explicit LOD-off fitted window, layout, layers, lineweights and background.

MAE is mean absolute RGB-channel difference after 4×4 box downsampling, on a 0–255 scale. Changed-cell share is the percentage of cells differing by more than 24 in any channel. All 58,674 complete cells are included, without an ink-mask denominator. This comparison includes all viewer LOD approximations, including unchanged hatch and lineweight shortcuts.

| File | Master hairline MAE | New quad MAE | Master cells >24 | New cells >24 | New on draw calls |
|---|---:|---:|---:|---:|---:|
| arch-cn-114 | 0.127876061 | 0.049661406 | 0.310188% | 0.022156% | 15 |
| proxy-hatch-77 | 0.309483332 | 0.298437127 | 0.364727% | 0.339162% | 3 |
| mtext-elec-35 | 0.058613057 | 0.009385901 | 0.103964% | 0.003409% | 2 |
| viewports-24 | 0.521311967 | 0.141059427 | 1.244163% | 0.023861% | 3 |
| attribs-21 | 0.000202389 | 0.000202745 | 0.000000% | 0.000000% | 2 |
| 3dface-civil-13 | 0.093895933 | 0.043249920 | 0.146573% | 0.022156% | 3 |

Mtext MAE improves by 84.0%, and its >24 share falls by 96.7%. Arch-cn MAE improves by 61.2%. Proxy, viewports and civil improve in both metrics.

Attribs is a tiny numerical exception: MAE increases by 0.000000355, equivalent to one 8-bit channel unit of aggregate absolute error over the whole image; its >24 share stays zero. Repeated diagnostic captures differ at exactly one raw pixel, (871,36): full glyphs and new quads are (191,191,128), while master hairlines are (255,128,128). The new pixel matches full glyphs, but channel cancellation within its 4×4 cell makes downsampled MAE fractionally higher. Thus the literal no-increase condition is not met for attribs, despite improved raw pixels and no perceptible regression. Diagnostic off images are identical. Evidence: attrib-master-* / attrib-new-* PNGs and JSON.

Off/on PNG pairs for mtext-elec-35 and arch-cn-114 are saved under master-* and normalized-*. Their master/new LOD-off PNGs are byte-identical. Raw reports: master.json and normalized.json. Opaque output keeps mtext and attribs at two GPU calls; proxy, viewports and civil at three; arch-cn at fifteen.

## Cold frontend benchmark

Node v23.10.0; median of three; fresh ViewerCore per run; LOD on. Command: node --disable-warning=ExperimentalWarning --max-old-space-size=16000 tools/corpus/src/bench.ts --runs 3 --only "mtext|arch-cn|attribs|proxy|viewports|civil" --json <local-report>. Timing runs did not overlap fingerprint gates. Before = bench-master.json; retained after = bench-greek-normalized.json.

| File | Before frontend ms | After frontend ms | Before vertices | After vertices | Vertex change |
|---|---:|---:|---:|---:|---:|
| arch-cn-114 | 9,940 | 9,875 | 17,511,244 | 17,105,956 | -2.31% |
| proxy-hatch-77 | 556 | 541 | 906,287 | 828,045 | -8.63% |
| mtext-elec-35 | 167 | 163 | 284,012 | 227,046 | -20.06% |
| viewports-24 | 319 | 320 | 1,689,941 | 1,687,925 | -0.12% |
| attribs-21 | 75 | 73 | 233,602 | 232,134 | -0.63% |
| 3dface-civil-13 | 290 | 289 | 214,203 | 197,985 | -7.57% |

No noticeable retained frontend regression: five files improve slightly; viewports increases by 1 ms (0.31%). The initial reference-triangle implementation was roughly 10–19% slower against the first master timing and was replaced with normalized polygon area. Profiled arch-cn reference-area triangulation cost ~164 ms, and retained meshes added allocation pressure. The retained code also analytically projects ink boxes without per-corner arrays and caches repeated nonuniform SHX lengths.

Timing noise remains material: repeated master measured 10,352 / 637 / 171 / 349 / 83 / 306 ms in table order, versus initial 9,940 / 556 / 167 / 319 / 75 / 290 ms. Speedups smaller than that variation are not established. All intermediate logs and JSON remain available.

Ordinary batch count grows (arch-cn 69,329→126,562) because filled text interrupts hairlines. Opaque GPU merging prevents this turning into a draw call per run, as the GPU call counts above show.

## Gates

- pnpm typecheck: PASS.
- pnpm test: PASS, 609 tests in 80 files. Sandbox Git ownership warnings were handled with process-local GIT_CONFIG_* settings; no global configuration was changed.
- pnpm lint: PASS (one size warning for the generated local 2.3 MiB baseline JSON; no source warnings).
- pnpm fingerprint --check --set fixtures --jobs 4: 4,057 model hashes identical; 4,057 plot hashes identical; 13 expected viewer changes; zero error records. Exit 1 reflects those viewer differences.
- pnpm fingerprint --check --set corpus --jobs 4: 315 model hashes identical; 19 expected viewer changes; zero error records. This set has no plot hashes. Exit 1 reflects viewer differences.
- Full LOD-off comparison: PASS, all model/plot/viewer hashes identical for all 4,057 fixtures and 315 corpus files; zero errors. Master text was temporarily restored to save a separate local master-off baseline, then the retained code checked with --lod-off --output-dir .codex-out --name master-off. Shared samples were never written.
- model-all: not required; packages/core and packages/model were not touched.
- git diff --check: PASS.

## Viewer changes against saved baseline

Only the active greeking branch changes output (including fit/tolerance consequences of the new ink bounds). All 32 changed IDs are below and in .codex-out/viewer-changes.csv. The corpus gate excludes arch-cn by design; GPU and Node benchmarks cover it separately.

| Set | ID | Vertices before → after |
|---|---|---:|
| fixtures | fileformat/corpus-acs-sample-ac1009 | 16,242 → 10,662 |
| fixtures | fileformat/corpus-acs-sample-ac1015-binary | 26,939 → 21,339 |
| fixtures | fileformat/corpus-acs-sample-ac1032 | 51,336 → 45,746 |
| fixtures | fileformat/corpus-ezdxf-multi-insert-with-attribs | 2,550 → 2,150 |
| fixtures | fileformat/corpus-ezdxf-text-negative-extrusion | 20,406 → 20,354 |
| fixtures | fileformat/corpus-gdal-mtext-ocs-reduced | 352 → 48 |
| fixtures | fileformat/float-17-digits | 60 → 36 |
| fixtures | fileformat/long-text-2049-r12 | 5,148 → 1,056 |
| fixtures | fileformat/long-text-2049-r2018 | 5,376 → 1,284 |
| fixtures | fileformat/long-text-2050-r2018 | 5,384 → 1,290 |
| fixtures | fileformat/long-text-5000-r2018 | 10,088 → 60 |
| fixtures | fileformat/overflow-circle-radius-1e300 | 131,142 → 131,092 |
| fixtures | mtext/para-indent-absolute-tangent | 60 → 44 |
| corpus | ../bench/hatch-gdal-binary.dxf | 656,639 → 646,013 |
| corpus | files/github/FreeCAD__FreeCAD/issue-19247/18552337_DesignRumah_extracted/DesignRumah.dxf | 893,332 → 859,608 |
| corpus | files/github/OSGeo__gdal/issue-991/2463909_zhangmabeng1_extracted/zhangmabeng1.dxf | 656,639 → 646,013 |
| corpus | files/github/haplokuon__netDxf/issue-317/7280601_0909_021_extracted/0909_021.dxf | 233,602 → 232,134 |
| corpus | files/github/haplokuon__netDxf/pr-304/6820845_Civil.Drawings.AutoCAD2000_extracted/Civil Drawings AutoCAD2000.dxf | 214,203 → 197,985 |
| corpus | files/github/ixmilia__dxf/issue-106/3449059_reexport80973-1_extracted/reexport80973-1.dxf | 19,053 → 16,623 |
| corpus | files/github/mozman__ezdxf/issue-1086/15401623_ralated.file_extracted/ralated file/test.dxf | 105,179 → 94,889 |
| corpus | files/github/mozman__ezdxf/issue-1298/20459018_problematic_viewports.dxf_extracted/problematic_viewports.dxf | 1,689,941 → 1,687,925 |
| corpus | files/github/mozman__ezdxf/issue-847/10978953_acad_proxy_entity_example_extracted/1#门诊、综合楼建筑最终(消防审查后).dxf | 906,287 → 828,045 |
| corpus | files/github/tarikjabiri__dxf/issue-70/11189770_11_21_31_extracted/has_11_21_31.dxf | 30 → 20 |
| corpus | files/github/vagran__dxf-viewer/issue-135/19178911_J0-J17.dxf_extracted/J0-J17.dxf | 141,100 → 131,982 |
| corpus | files/github/vagran__dxf-viewer/issue-160/26211223_dxf-viewer-issue-160-test-files_extracted/Mr DIY Eşkişehir Vişnelik  Elektrik Projeler.dxf | 284,012 → 227,046 |
| corpus | files/repos/ACadSharp/samples/sample_AC1015_binary.dxf | 26,939 → 21,339 |
| corpus | files/repos/ACadSharp/samples/sample_AC1021_binary.dxf | 51,299 → 45,699 |
| corpus | files/repos/ACadSharp/samples/sample_AC1024_ascii.dxf | 51,336 → 45,746 |
| corpus | files/repos/ACadSharp/samples/sample_AC1024_binary.dxf | 51,299 → 45,699 |
| corpus | files/repos/libredwg/test/test-data/example_2013.dxf | 8,410 → 8,226 |
| corpus | files/repos/qcad/libraries/templates/metric/dl3dl/DIN-A0-Querformat-Rahmen-mit PK.dxf | 46,001 → 45,939 |
| corpus | files/repos/qcad/libraries/templates/metric/dl3dl/DIN-A1-Querformat-Rahmen-mit PK.dxf | 45,922 → 45,860 |

## Delivery and limits

1. 01-lod-comparison.patch / .msg: viewer LOD switch, forwarding test and hardware-AA tooling.
2. 02-ink-area-greeking.patch / .msg: cached metrics, run quads, geometry tests, research note and TODO update.
3. 03-local-fingerprint-checks.patch / .msg: local baseline destination and LOD-off controls, with tool documentation.
4. 04-greeking-results.patch / .msg: this report. all-changes.patch combines the steps.

No commits, pushes, deployments or AutoCAD runs were attempted. The attribs aggregate-MAE exception is disclosed above. Summed SHX ink intentionally does not model stroke overlap union or round-cap area; the run-box clamp limits saturation. This remains a viewer approximation. View culling, unrelated features and other existing LOD limitations remain open.
