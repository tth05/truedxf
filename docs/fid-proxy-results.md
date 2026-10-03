# Proxy fidelity progress — 2026-10-03

Worktree: truedxf-wt-proxy, branch fid/proxy. Changes remain uncommitted. AutoCAD accepted
all nine first-round probes (9 ok in 29 s); twelve follow-up probes need a new run. This is
an intermediate result, not a claim of a complete AutoCAD match.

## Changes and design decisions

Step 1 splits the bounded decoder into draw/proxy-data.ts, restores proxy TEXT/TEXT2/
UNICODE_TEXT/UNICODE_TEXT2 through normal TEXT layout, preserves command-relative padding,
and fills SHELL faces. Embedded font fields become private renderer styles without changing
the model STYLE table. The normal text path handles width/oblique, OCS, tracking and flags.
No general font substitution or colour/layer-index workaround was added.

Step 2 implements only the newly verified rules: POLYLINE leaves FILLON enabled for a
following POLYGON; plot-time FILLMODE overrides the saved header; fully overridden MTEXT
can draw with a missing base-style bigfont. Plain/unresolved-inline suppression remains;
mixed runs and fill consumption after other primitives await discriminating references.
Proxy charset/pitch fields are forwarded with STYLE-compatible LOGFONT flags, without
changing resolution policy. Three regression tests cover fill across trait changes, plot override/header equivalence,
and missing-base MTEXT geometry versus a healthy style.

The PDF references establish that stair HATCH 5DE has the correct stored phase and spacing
(23 lines, maximum normal error 0.126314 PDF points, within device quantization). The wall
sample's matched straight endpoints also agree within quantization. No coordinate or hatch
phase correction is justified. Proxy tags are PDF stroke paths despite their stored 宋体
family and empty font files; field precedence remains open. This work leaves arch-cn font
substitution to the other agent.

Evidence, including case ids and verification boundaries, is in
[note 07 §15.6–15.7](../research/notes/07-blocks-inserts-misc.md). Q-0736–Q-0739 and
TODO entries now record the partial answers and remaining probes.

## Measured results

CPU raster=autocad; exact RGB mismatch / F1(r=1). Before is current master, including its
LWPOLYLINE support, rather than the older supplied comparison images.

| Case | Current master | After step 1 | After step 2 |
|---|---:|---:|---:|
| gh109-floor-plan | 24,057 / 0.9079 | 20,197 / 0.9730 | **19,922 / 0.9785** |
| arch-cn-1e85a | 46,418 / 0.8648 | same | same |
| arch-cn-1e8ba | 43,628 / 0.8354 | same | same |
| arch-cn-1e965 | 42,951 / 0.8274 | same | same |
| R14 leader and hdr-drop1…6 (each) | 31,674 / 0.3335 | 20,270 / 0.7838 | same |

The seven R14 leader before measurements use the actual HEAD proxy drawer in an isolated
Node process; working sources were not swapped. Their restored proxy text changes the fit
extents and agrees better with AutoCAD. All 677 text/MTEXT/blocks/misc scores remain identical
to master. The expanded step-2 check scores 1,105 cases including solids/hatches/polylines
and the seven leaders; those extra suites' existing plot hashes remain unchanged.

| New AutoCAD probe | Before step 2 | After step 2 |
|---|---:|---:|
| columns-room | 12,901 / 0.9095 | **10,986 / 0.9239** |
| fill-consumption | 99,588 / 0.1886 | **10,486 / 0.9507** |
| inline-missing-base-bigfont | 4,463 / 0.9790 | **0 / 1.0000** |
| shell-fillmode-zero | 70,531 / 0.1689 | **10,986 / 0.6231** |
| fill-explicit-control | 10,486 / 0.9507 | same |
| axis-one | 192 / 1.0000 | same |
| stair-hatch | 11,107 / 1.0000 | same |
| tags | 9,830 / 0.8808 | same |
| wall-stair | 1,705 / 0.9861 | same |

No compared case worsens. Raw reports: .codex-out/step2-scores.json,
step2-corpus-proxy.json, step2-related.json, probes-before.json, before-proxy.json,
before-related.json and before-leader.json. Vector measurements are in hatch-phase.json
and probe-geometry.json; the complete extracted PDF vectors are probe-pdf-vectors.json.
A four-column comparison of all nine probes is .codex-out/probes-compare.png.

The updated four-case, four-column comparison (AutoCAD / master / after / diff) is
.codex-out/compare.png; full after PNGs/diffs are .codex-out/step2-images/. The user copied
the previous image into samples/out/fid-proxy; these new outputs stay in the worktree
because the samples junction is read-only to the sandbox.

## Gates

- pnpm typecheck: PASS, exit 0.
- pnpm test: PASS, 84 files / 692 tests, exit 0. Existing test Git-ownership warnings are
  harmless; no Git config or metadata was changed.
- pnpm lint: PASS after pnpm format. The initial lint caught formatting in new diagnostic
  JSON files; formatting resolved it. No source lint errors.
- pnpm fingerprint --check --set fixtures --jobs 2: **exit 1, expected differences**,
  4,119 records, zero error records, 323.01 s. All 4,061 baseline model hashes match.
  Plot: 4,053 identical, eight changed, 58 new. Viewer: 4,046 identical, 15 changed, 58 new.
  New records are fid-proxy-probes (9) and the parallel agent's font-resolution (31)
  and font-metrics (18) suites.
- The eight intended plot changes are corpus-proxy/gh109-floor-plan (text, SHELL fill,
  inline room/area restoration) and fileformat/corpus-libredwg-leader-r14 plus hdr-drop1…6
  (restored proxy text and resulting fit). These improve CPU fidelity. Every other existing
  plot hash is identical, including all arch-cn cases.
- The 15 viewer changes are those eight plus render-probes/imgtrig-l0-asis, l1-path,
  l2-noproxy, l3-pixsize, l4-units, l7-noclip and l8-size64 (same R14 proxy text).
- pnpm fingerprint --check --set corpus --jobs 2: **exit 1, expected difference**,
  315 model hashes identical; 314 viewer hashes identical, one changed in
  files/repos/libredwg/test/test-data/2018/Leader.dxf (proxy text); zero errors, 24.65 s.
  This set has no plot hashes.
- model-all is not required: packages/core and packages/model are untouched.
- CPU fidelity: nine probes unchanged/improved, gh109 improved, 677 related cases and seven
  R14 leaders unchanged from step 1. Arch-cn hashes and scores unchanged. No compared
  score regresses.

Logs and the enumerated differences are under .codex-out/step2-*.log and
step2-fingerprint-differences.json. Saved baseline files were read only. The installed
baseline already contains corpus-proxy, so gh109 is reported as changed rather than new.

## Patches

Apply in order. No commits were attempted.

1. .codex-out/01-proxy-text-fills.patch + .msg: initial decoder/text/SHELL support, tests,
   first probe generator, research and initial report.
2. .codex-out/02-proxy-acad-probes.patch + .msg: verified fill/FILLMODE/inline fixes,
   regression tests, follow-up generator, updated research/questions/TODO and this report.

## What is still different

| Difference | Cause / next evidence |
|---|---|
| Proxy M0921/C1815 glyph shapes and widths | AutoCAD uses stroke paths; current typeface-only resolution chooses TrueType. Five field-only variants isolate empty-file/typeface precedence. No font-choice guess added. |
| Wall/stair/window one-pixel edges; hatch exact pixels | Stored geometry and hatch phase agree with PDF; integer device ties are unresolved. Two half-pixel windows test the raster boundary. |
| Large native 天正单行文字输入 label | Standard has missing hztxt.shx and no inline override. Pure font-choice/substitution question, left to font work; room/area now restored. |
| Native dimension exact raster pixels | SimSun belongs to native dimensions, distinct from proxy tags. Their zoom ROI has 1,814 exact mismatches but F1(r=1)=1.0000; this supports raster differences, not font-shape substitution. |
| Fill after SHELL/POLYGON/TEXT; mixed base/inline MTEXT | Existing assumptions beyond the verified boundaries remain; five follow-up cases isolate these. SHELL holes/face traits, MESH, non-+Z text and nested transforms still lack references. |

## Next AutoCAD batch

The standard-library generator stages twelve new cases under .venv/fid-proxy-followup-v2;
all parse with 49 model entities and no proxy-corrupt diagnostics. It refuses all existing
outputs. It keeps opaque custom-object fields, replacing only graphics/font strings or
MTEXT test content; the two half-pixel cases are byte-identical DXF copies.

Run from this worktree in the user's terminal:

```powershell
python tools/gen/proxy_followup_probes.py
node tools/acad/src/run.ts --suite fid-proxy-followup --timeout 600 --jobs 2
```

No samples, AutoCAD settings, saved baselines or reference files were modified by this
sandbox. Load validity of the new modified proxies remains for AutoCAD to confirm.
