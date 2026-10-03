# Proxy fidelity progress — 2026-10-03

Worktree: truedxf-wt-proxy, branch fid/proxy. Changes remain uncommitted. AutoCAD accepted
all nine first-round probes (9 ok in 29 s) and all twelve follow-up probes. This is
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
mixed runs and fill consumption after other primitives were isolated in step 3.
Proxy charset/pitch fields are forwarded with STYLE-compatible LOGFONT flags, without
changing resolution policy. Three regression tests cover fill across trait changes, plot override/header equivalence,
and missing-base MTEXT geometry versus a healthy style.

Step 3 removes primitive-based fill consumption: the final probes verify persistence after
SHELL/POLYGON/TEXT as well as POLYLINE. Mixed MTEXT now measures hidden base runs but emits
only resolved inline runs, preserving their positions. Regression tests cover fill snapshots
through an explicit clear and inline geometry versus a healthy control. Shared TextFonts
still resolves every embedded font field; this branch adds no separate font-choice policy.

The PDF references establish that stair HATCH 5DE has the correct stored phase and spacing
(23 lines, maximum normal error 0.126314 PDF points, within device quantization). The wall
sample's matched straight endpoints also agree within quantization. No coordinate or hatch
phase correction is justified. Proxy tags are PDF stroke paths despite their stored 宋体
family and empty font files; the final file/typeface equality results support the shared localized-family FONTALT correction,
while the Arial/empty-family PDF/PNG distinction remains open. This work leaves arch-cn font
substitution to the other agent.

Evidence, including case ids and verification boundaries, is in
[note 07 §15.6–15.7](../research/notes/07-blocks-inserts-misc.md). Q-0736–Q-0739 and
TODO entries record answered fill/mixed-run questions and remaining raster/font-selection limits.

## Measured results

CPU raster=autocad; exact RGB mismatch / F1(r=1). Before is current master, including its
LWPOLYLINE support, rather than the older supplied comparison images.

| Case | Current master | After step 1 | Final (steps 2–3) |
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
3. .codex-out/03-proxy-followup.patch + .msg: persistent fill after filled/text primitives,
   mixed-run suppression with retained advances, tests and final evidence/report.

## What is still different

| Difference | Evidence / remaining cause |
|---|---|
| Proxy M0921/C1815 shapes and widths | Localized 宋体 with simplex or SimSun files plots identically to the original. The shared localized-family FONTALT correction belongs to the other branch and is compatible with these private proxy styles. Arial and empty-family PDF/PNG font selection still differs; no proxy resolver added. |
| Wall/stair/window edge pixels | The half-pixel wall window is pixel-exact. Original PDF endpoints agree within device quantization; the general raster tie/coverage rule remains open. |
| Stair hatch exact pixels | Stored phase and spacing agree with all 23 PDF lines; both windows have F1(r=1)=1. No phase/spacing correction is justified. |
| Large native 天正单行文字输入 label | Standard has missing hztxt.shx and no inline override. This is a native font-choice issue, left to font work; room and area are restored. |
| Native dimension exact pixels | The native SimSun dimension ROI has F1(r=1)=1.0000 despite 1,814 exact mismatches. No verified font-shape fix. |
| Proxy capabilities beyond the case | MESH fills, SHELL holes/face traits, non-+Z text and nested transforms still lack valid reference coverage. Their implementation boundaries are recorded in note 07. |

## Final follow-up probes

All twelve cases loaded successfully in AutoCAD. No further AutoCAD run is requested.
The reference generator preserves opaque object data and refuses existing outputs.

| Probe | Before step 3 | After step 3 |
|---|---:|---:|
| fill-after-polygon | 99,588 / 0.6716 | **10,486 / 0.9733** |
| fill-after-shell | 99,588 / 0.6716 | **10,486 / 0.9733** |
| fill-after-text | 99,588 / 0.1833 | **10,486 / 0.9505** |
| inline-mixed-missing-base | 1,185 / 0.9902 | **0 / 1.0000** |
| inline-mixed-control | 0 / 1.0000 | same |
| wall-stair-halfpixel | 0 / 1.0000 | same |
| stair-hatch-halfpixel | 20,098 / 1.0000 | same |
| tag-empty-family | 4,360 / 0.9581 | same |
| tag-family-arial / tag-file-arial | 15,861 / 0.8282 each | same |
| tag-file-simplex / tag-file-simsun | 9,830 / 0.8808 each | same |

All 1,105 previously scored related cases remain identical to step 2. Raw evidence:
.codex-out/step3-before.json, step3-followup.json, step3-related.json and
step3-pdf-vectors.json. The localized-family correction is not installed in this worktree;
its merged result must be scored separately. Proxy synthetic styles retain the family and
file fields and use the shared resolver, so that correction applies without another resolver.

## Final gates and deliverables

- `pnpm typecheck`: PASS, exit 0.
- `pnpm test`: PASS, 84 files / 694 tests, exit 0.
- `pnpm lint`: PASS after `pnpm format`, exit 0.
- `pnpm fingerprint --check --set fixtures --jobs 2`: exit 1 for **expected differences**,
  4,131 records, zero error records, 696.52 s. All 4,061 baseline model hashes match;
  70 new records are 21 proxy probes and 49 parallel font probes. Existing plot hashes:
  4,053 identical, eight intentional changes listed in the step-2 gate section above.
  Existing viewer hashes: 4,046 identical, the same 15 intentional changes. Step 3 adds
  no changed existing plot or viewer hashes; the twelve final probes are new.
- `pnpm fingerprint --check --set corpus --jobs 2`: exit 1 for the same expected single
  viewer difference in 2018/Leader.dxf (restored proxy text). All 315 models match,
  314 viewers match, zero errors, 50.23 s. This set has no plot hashes.
- `model-all` not required: core/model untouched.
- CPU fidelity: 1,130 cases scored (1,105 related, four corpus cases, 21 probes). No case
  worsens. All four corpus PNGs are byte-identical to step 2, including every arch-cn plot;
  gh109 remains 19,922 / 0.9785 versus master 24,057 / 0.9079. Four follow-up cases improve.
  The redirected main CPU invocation reported wrapper exit 1 with Node's type-stripping
  warning; all 13 results/PNGs completed without error records. The score-comparison
  assertion passes; related-suite CLI exits 0. This is not a hidden missing score.

Final logs and enumerated differences: `.codex-out/step3-gates.json`,
`step3-fingerprint-differences.json`, `step3-score-validation.json`, `step3-*.log`.
Updated comparison `.codex-out/compare.png` has the same four-column/four-case layout
as the supplied image, with current-master before images and final captions.
`.codex-out/followup-compare.png` covers all twelve accepted final probes. Full final
images/diffs are `.codex-out/step3-images/`; PNG hashes are `step3-png-hashes.json`.
These outputs are staged here because the samples junction is read-only. The requested
`samples/out/fid-proxy/compare.png` cannot be updated by this sandbox; the user can copy
this staged image as they did in the preceding round. No baselines or samples changed.

Apply the three patch files in order; each has a one-paragraph .msg. Changes remain in the
working tree and no commits or Git metadata writes were attempted. No further AutoCAD run
is needed for the implemented rules. The font-resolution branch is still to be merged
and re-scored; this report does not claim its future improvement.
