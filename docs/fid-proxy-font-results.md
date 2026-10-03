# Proxy font-selection results — 2026-10-03

The verified shared resolution changes are complete. This task starts from merged master,
including prior font and proxy work; those old patches were not reapplied. All five tag
probes now have F1(r=1)=1.0000, and gh109 improves to 0.9984. No further AutoCAD run is requested.

## Evidence and design

The user's 26-case `proxy-font-selection` run succeeded in 80 s. Candidate renders change
only the three tag font requests in memory and compare against the reference PNGs.
`new-candidates.json`, `new-raw-tags.json` and `new-reference-audit.json` preserve the
scores, fields, PNG equalities and PDF text spans. Note 04 §16.1 records every controlled
selection rule as VERIFIED-BY-ACAD, with case IDs and date.

- Resolved Arial typeface with charset 134 selects SimSun; charset 0/1 retains Arial.
  Pitch 0/2/34 gives identical SimSun PNGs. A nonempty typeface wins over an explicit file.
- Unresolved localized 宋体 and unknown typefaces retain FONTALT/simplex. Charset does
  not turn them into SimSun. The merged localized-family correction remains intact.
- Empty TEXT2/UNICODE_TEXT2 file and typeface selects TXT. An available bigfont remains
  paired with SHX; a missing bigfont suppresses SHX text. A selected TrueType ignores it.
- With empty typeface, explicit simsun.ttc uses SimSun; explicit arial.ttf plots Arial
  Italic with either tested charset despite zero italic flags. This narrow file exception
  is implemented from matching PNG glyphs and Arial-ItalicMT PDF spans. Its general cause
  is open, so other files do not inherit this exception.
- Bare opcodes 10/36 remain Standard requests: these references show absent tags with
  gh109's missing-bigfont Standard, and do not establish an independent bare-opcode default.

Proxy origin passes through TextFonts into FontManager. The drawer still uses ordinary
TEXT layout and has no separate font lookup. New substitutions report `proxy-font-face`.
Native STYLE, MTEXT inline requests and viewer selection do not receive the proxy mapping.
Unavailable candidate faces retain the otherwise resolved primary. No font bytes, OS-specific
imports below the renderer, or system/profile changes are introduced.

Native MTEXT `9B0` is `天正单行文字输入`, Standard `txt.shx` plus missing `hztxt.shx`.
The earlier `font-resolution/simplex-missing-bigfont` and `missing-shx-bigfont` PDFs/PNGs
explicitly show CJK linking to SimSun despite missing bigfont. MTEXT now measures every
run, hides base SHX glyphs individually, and emits linked TrueType glyphs at their own
cap-height scale, including the linked-space metric. Hidden Latin still advances; valid
inline runs retain their positions. TEXT remains suppressed. A missing-bigfont diagnostic
can still describe the hidden base-font path even when linked CJK glyphs are visible.

Two additional hermetic tests cover proxy face-selection boundaries and MTEXT linking,
hidden Latin advances, linked spaces and retained TEXT suppression. The earlier resolver
and renderer tests now cover both extended proxy formats sharing their TXT default.
Research notes 04/07, Q-0737 (proxy), Q-0740 and TODO are updated; Q-0741 tracks untested cases.

## Scores against current merged master

| Case | Exact mismatch, before → after | F1(r=1), before → after |
|---|---:|---:|
| fid-proxy-followup/tag-empty-family | 4,360 → 1,814 | 0.9581 → 1.0000 |
| fid-proxy-followup/tag-family-arial | 15,861 → 2,698 | 0.8282 → 1.0000 |
| fid-proxy-followup/tag-file-arial | 15,861 → 2,698 | 0.8282 → 1.0000 |
| fid-proxy-followup/tag-file-simplex | 1,814 → 1,814 | 1.0000 → 1.0000 |
| fid-proxy-followup/tag-file-simsun | 1,814 → 1,814 | 1.0000 → 1.0000 |
| corpus-proxy/gh109-floor-plan | 19,251 → 19,137 | 0.9862 → 0.9984 |

Against the supplied pre-proxy-text numbers, empty-family is better than 3328 / 0.9715;
both Arial probes are better than 8778 / 0.8812. File-simplex and file-simsun were already
1814 / 1.0000 on current master and remain identical. All three arch-cn windows are unchanged:
2257, 491 and 196 mismatches, respectively, with F1(r=1)=1.0000.

All **3940 runnable reference cases in 43 CPU suites** were scored before and
after. The HEAD-only baseline used a temporary Node source loader, preserving the working
tree; all original 1442 scores agree exactly with the original unmodified-tree snapshot.
Every case's mismatch and every reported F1 radius were checked: **20 improve,
3920 are identical, zero regressions and zero errors**. Exact cases stay
972; F1(r=1) ≥ 0.99 cases rise 3480→3499.
The CLI skips fixtures lacking either a PNG reference or a DXF; no runnable reference case
was omitted. Target reruns agree exactly with the full after run.

Every improvement:

| Case | Exact mismatch, before → after | F1(r=1), before → after |
|---|---:|---:|
| corpus-proxy/gh109-floor-plan | 19,251 → 19,137 | 0.9862 → 0.9984 |
| fid-proxy-followup/tag-empty-family | 4,360 → 1,814 | 0.9581 → 1.0000 |
| fid-proxy-followup/tag-family-arial | 15,861 → 2,698 | 0.8282 → 1.0000 |
| fid-proxy-followup/tag-file-arial | 15,861 → 2,698 | 0.8282 → 1.0000 |
| fid-proxy-probes/columns-room | 10,986 → 3,375 | 0.9239 → 0.9971 |
| fid-proxy-probes/shell-fillmode-zero | 10,986 → 3,375 | 0.6231 → 0.9888 |
| font-resolution/missing-shx-bigfont | 25,818 → 2,116 | 0.0094 → 1.0000 |
| font-resolution/simplex-missing-bigfont | 25,818 → 2,116 | 0.0094 → 1.0000 |
| proxy-font-selection/arial-big-available | 15,861 → 2,698 | 0.8282 → 1.0000 |
| proxy-font-selection/arial-big-missing | 15,861 → 2,698 | 0.8282 → 1.0000 |
| proxy-font-selection/arial-c134 | 15,861 → 2,698 | 0.8282 → 1.0000 |
| proxy-font-selection/arial-file-txt-c134 | 15,861 → 2,698 | 0.8282 → 1.0000 |
| proxy-font-selection/arial-p0 | 15,861 → 2,698 | 0.8282 → 1.0000 |
| proxy-font-selection/arial-p34 | 15,861 → 2,698 | 0.8282 → 1.0000 |
| proxy-font-selection/empty-big-available | 4,360 → 1,814 | 0.9581 → 1.0000 |
| proxy-font-selection/empty-c0 | 4,360 → 1,814 | 0.9581 → 1.0000 |
| proxy-font-selection/empty-c134 | 4,360 → 1,814 | 0.9581 → 1.0000 |
| proxy-font-selection/file-arial-c0 | 10,294 → 2,780 | 0.9270 → 1.0000 |
| proxy-font-selection/file-arial-c134 | 10,294 → 2,780 | 0.9270 → 1.0000 |
| proxy-font-selection/opcode-11-empty | 4,360 → 1,814 | 0.9581 → 1.0000 |

## Gates and fingerprint provenance

Step 01 checkpoint gates: typecheck, 704 tests in 84 files, and lint passed. All 1442 CPU
cases retained or improved their scores. Only tag-empty-family's plot changed relative
to `tagfonts-base`; all saved model/viewer and corpus hashes were unchanged. Logs are
`typecheck.log`, `test.log`, `lint.log`, `fingerprint-current.log` and `fingerprint-baseline.log`.

Step 02 completion:

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS, exit 0. |
| `pnpm test` | PASS, 706 tests / 84 files, exit 0. |
| `pnpm lint` | PASS, exit 0; the local 2.4 MiB fingerprint snapshot is skipped with one size warning. |
| CPU, all available suites | PASS: 3940 cases, zero regressions/errors; before/after logs and JSONs retained. |
| Fingerprint fixtures vs `tagfonts-base` | Expected exit 1: 4131 saved model/viewer hashes unchanged; exactly 8 intended saved plot changes, plus 26 new cases. Zero errors. |
| Fingerprint corpus vs `tagfonts-base` | All 315 model/viewer hashes identical; zero errors. |
| Fingerprint fixtures vs saved `baseline` | Expected exit 1: 96 new cases; 11 saved plot and 15 viewer differences whose IDs already differed before this task. gh109's plot is additionally updated by this task. Zero errors. |
| Fingerprint corpus vs saved `baseline` | Expected exit 1: one existing 2018/Leader.dxf viewer difference; 315 model hashes identical, zero errors. |
| Fingerprint model-all | Not required: packages/core and packages/model are untouched. |
| Incremental patch replay / `git diff --check` | PASS: both patches reproduce every changed source/docs file; no index or commit writes. |

The combined fixture/corpus runs contain 4472 records. Current-master check: 86 reported
differences = 26 new cases × 3 hashes + 8 intended plots. Saved-baseline check: 315 differences
= 96 new cases × 3 hashes + 27 existing historical differences. The eight task plot changes
are gh109, tag-empty-family, both Arial tags, columns-room, shell-fillmode-zero, and both
missing-bigfont font-resolution probes. Their CPU scores all improve against AutoCAD.
Other saved plots, all saved viewer hashes and every model hash stay identical on top of
current master. Both CPU runs leave all three arch-cn cases unchanged.

Commands use `pnpm fingerprint --check --set fixtures,corpus`, once with
`--name tagfonts-base --output-dir .codex-out/tagfonts` and once with the default read-only
saved baseline. The expected exit-1 results are documented rather than treated as passes
with zero differences. Full per-kind lists are in `02-fingerprint-*-deltas.json`.

## Deliverables and remaining differences

`compare.png` uses the requested AutoCAD | merged master | after | diff layout, with five
tag rows and gh109 and captions containing mismatch/F1. `resolved-targets/` and
`native-final/` contain full-size output/diff PNGs; `scores.csv` and
`02-score-validation.json` list measurements. Everything is under `.codex-out/tagfonts/`
for the user to copy; samples and their baselines were never written.

| Still different | Evidence / reason |
|---|---|
| 1814 pixels common to the tag windows | Unchanged native dimension in the upper half; TXT/simplex tag regions are pixel-exact. |
| 884 extra pixels in Arial/134 windows | SimSun Latin raster edges, with the correct face and F1(r=1)=1.0. |
| Arial regular / file-only italic edges | Correct candidate faces; remaining small TrueType raster coverage is outside the verified large-CJK correction. |
| Native SimSun label edges and gh109 geometry | Restored label has one-pixel fringes. Wall/stair pixel ties and SHX dimension edges remain in proxy research; geometry was not changed. |
| Other charsets/typefaces/style flags and other file-only faces | Unverified, Q-0741; no general GDI enumeration rule or further probe run is claimed. |

Logical patches: `01-empty-proxy-fonts.patch/.msg` is the prior checkpoint relative to
merged master; `02-proxy-faces-and-cjk.patch/.msg` completes this task on top of it.
All changes remain in the working tree; no commits were attempted.
