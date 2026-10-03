# Proxy fidelity progress — 2026-10-03

Worktree: `truedxf-wt-proxy`, branch `fid/proxy`. Changes remain uncommitted; patch and
commit-message artifacts are in `.codex-out/`. AutoCAD probes are pending, so this is an
intermediate fidelity result, not a claim of a complete AutoCAD match.

## Change and design

Split the bounds-checked proxy decoder into `draw/proxy-data.ts` so font preparation can
inspect text commands without importing the drawer or decoding all unrelated geometry.
TEXT (10), TEXT2 (11), UNICODE_TEXT (36) and UNICODE_TEXT2 (38) now preserve baseline,
normal/direction, width, oblique, mirror/vertical flags, tracking, raw text and decorations.
Embedded file/bigfont/TrueType fields become private render-only styles. The model's STYLE
table stays unchanged. Glyph layout, font resolution and raster output share the normal
TEXT path. No font substitution policy or ACI/CTB mapping was changed.

String padding is relative to the command payload, including after unaligned DWG commands.
This fixes gh109's second stair label. SHELL faces fill with the current traits, and negative
face counts form holes in the preceding face. FILLMODE and fill consumption are implemented
following existing fill behaviour and the MIT ezdxf source; independent AutoCAD probes for
these rules are pending. All three gh109 columns have zero differences across 3,388 measured
interior pixels. Their edges still differ by one pixel.

Evidence and verification boundaries are recorded in [note 07 §15.6](../research/notes/07-blocks-inserts-misc.md).
The binary format was cross-checked against the [MIT ezdxf decoder](https://github.com/mozman/ezdxf/blob/master/src/ezdxf/proxygraphic.py).

## Measured before / after

CPU `raster: "autocad"`, exact RGB mismatch pixels and F1 at radius 1. Before images were
rendered from the unmodified worktree/current master, not the older pre-LWPOLYLINE images.

| Case | Mismatch before → after | F1(r=1) before → after |
|---|---:|---:|
| arch-cn-1e85a | 46,418 → 46,418 | 0.8648 → 0.8648 |
| arch-cn-1e8ba | 43,628 → 43,628 | 0.8354 → 0.8354 |
| arch-cn-1e965 | 42,951 → 42,951 | 0.8274 → 0.8274 |
| gh109-floor-plan | 24,057 → 20,197 | 0.9079 → 0.9730 |
| corpus-libredwg-leader-r14 and hdr-drop1…6 (each) | 31,674 → 20,270 | 0.3335 → 0.7838 |

The seven R14 leader results use the actual HEAD proxy drawer loaded in an isolated Node
process for the before measurement; working source files were not swapped. Restored proxy
text also changes their extents fit. Raw reports: `.codex-out/before-leader.json` and
`after-leader.json`. Text/mtext/blocks/misc: all 677 per-case scores are identical before/after
(294 / 250 / 88 / 45 cases). Across these 688 scored cases, eight improve and 680 are unchanged.

The comparison sheet preserves the supplied sheet's four-case/four-column layout and includes
the metrics above. It was visually inspected. Sandbox permissions prohibit writing through
the samples junction, so it is staged at `.codex-out/compare.png`, with the after PNGs/diffs
under `.codex-out/after-images/corpus-proxy/`. The required `samples/out/fid-proxy/compare.png`
path is **not populated yet**.

## Gates

- `pnpm typecheck`: PASS, exit 0.
- `pnpm test`: PASS, 84 Vitest files / 689 tests, exit 0. Existing tests print Git ownership
  warnings from the sandbox account; they still pass. Proxy tests: 18 pass.
- `pnpm lint`: PASS, exit 0. `pnpm format` was run.
- `git diff --check`: PASS, using command-local `safe.directory`; no Git configuration or
  metadata was written.
- `pnpm fingerprint --check --set corpus --jobs 4`: exit 1 for the intended proxy-text viewer
  change in `files/repos/libredwg/test/test-data/2018/Leader.dxf`; 315 model hashes identical,
  314/315 viewer hashes identical, zero error records. This set does not have plot hashes.
- `pnpm fingerprint --check --set fixtures --jobs 2`: completed in 356.88 s, exit 1 for
  eight intended plot changes (gh109 and the seven improved R14 leader fixtures) and 15 viewer
  changes. All 4,061 model hashes are identical, 4,053 plot hashes are identical, zero errors.
  The extra seven viewer-only cases are `render-probes/imgtrig-l0-asis`, `l1-path`, `l2-noproxy`,
  `l3-pixsize`, `l4-units`, `l7-noclip`, `l8-size64`; their restored R14 proxy text uses the same
  decoder. All other plot hashes are identical. A four-worker rerun stopped at 4,058 records
  without a final summary; it is not counted as a completed gate.
- `--set model-all`: not required; neither packages/core nor packages/model was modified.
- CPU suites: no scored case worsens; the 677-case related report is identical, all three
  arch-cn scores are identical, gh109 and all seven changed R14 plots improve.

Baseline files under samples were read only. The baseline present in this session already
contains the four corpus-proxy cases, so the checker reports gh109 as differing rather than new.

## Remaining differences and probes

| Difference | Finding / next evidence |
|---|---|
| Wall/window/stair edges; apparent axis colours | RGB traits agree with AutoCAD; measured wall edges are one row high while the crossing red axis agrees. No PUSH_MODELXFORM occurs. Zoom windows will distinguish raster phase from geometry. |
| Stair hatch phase/spacing | Still unresolved; the `stair-hatch` zoom isolates it. |
| Door/window tag glyph widths and native dimension glyphs | Stored typeface fields are honoured; exact metrics/shape need zoomed PNG/PDF inspection. No font-choice workaround was added. |
| Large Chinese label, room name and area missing | These are native MTEXT, not proxy text. Base Standard uses missing hztxt.shx. Room/area have valid inline overrides, but layout stops on the missing base bigfont. The missing-base probe tests that rule; the remaining label may require the original font/substitution. |
| Fill reset, FILLMODE=0, SHELL holes/traits, non-+Z text | Corpus verifies +Z text presence and simple filled SHELLs only. Fill probes are staged; holes/face traits and non-+Z text still lack AutoCAD verification. |

Q-0736–Q-0739 track these questions. `tools/gen/proxy_probes.py` stages nine new cases at
`.venv/fid-proxy-probes-v2/` and refuses overwrites. All nine parse, retain 49 model entities,
have matching window/paper aspect ratios, and decode 33F without unsupported diagnostics.
Modified-proxy load validity still needs AutoCAD. Six DXF copies are byte-identical to the
original; two alter only 33F's graphics and one alters only the base bigfont name.

From this worktree, in the user's terminal (the sandbox cannot write samples or start AutoCAD):

```powershell
python tools/gen/proxy_probes.py
if (Test-Path -LiteralPath samples/out/fid-proxy) { throw "Destination already exists; refusing to overwrite" }
New-Item -ItemType Directory -Path samples/out/fid-proxy
Copy-Item -LiteralPath .codex-out/compare.png -Destination samples/out/fid-proxy/compare.png
Copy-Item -LiteralPath .codex-out/after-images/corpus-proxy -Destination samples/out/fid-proxy/corpus-proxy -Recurse
node tools/acad/src/run.ts --suite fid-proxy-probes --timeout 600 --jobs 2
```

All destinations are new. The generator prevents overwriting any existing fixture. No
AutoCAD settings, samples, saved baselines or existing reference files were modified here.
