# Proxy font-selection checkpoint — 2026-10-03

This follow-up starts from merged master, including both prior font and proxy work.
Old patches were not reapplied. The verified empty UNICODE_TEXT2 default is fixed;
the two Arial probes remain pending one bounded AutoCAD batch. The overall font-selection
goal is not complete yet.

## Evidence and implementation

Candidate renders change only the three embedded tag font requests in memory and use
the existing AutoCAD PNGs. No samples, saved baselines, fonts or AutoCAD settings are
written. Full candidate scores and raw requests are in `.codex-out/tagfonts/candidates.json`
and `raw-tags.json`.

- Empty family/file/bigfont: TXT matches both visible tags exactly. Full-window mismatch
  drops 4360→1814, F1(r=1) 0.9581→1.0000. All 1814 remaining pixels are in the upper half,
  at the native dimension; the lower half containing M0921/C1815 has zero differences.
  Simplex gives 4360; Romans 4733; ISO 3952; SimSun 9896.
- Localized 宋体 with either simplex or SimSun files already resolves to simplex on merged
  master. Those two probes have 1814 mismatches and exact tag regions. The older 9830
  scores predate the merged alias correction and are not the starting scores here.
- Arial with charset 134/pitch 2 has SimSun serif Latin glyphs in both PNGs and PDF spans.
  Explicit SimSun candidates give 2698 mismatches / F1=1.0000 versus Arial's 15861 / 0.8282.
  The difference beyond the native dimension is 884 raster-edge pixels in the lower half.
  These references identify the face in that exact request, but do not isolate charset
  from other proxy selection rules. No general Arial substitution is implemented.

Embedded styles carry an explicit request source through TextFonts to FontManager.
In plot mode, empty UNICODE_TEXT2 font fields select TXT; native STYLE and viewer
defaults retain FONTALT. The proxy drawer continues to use ordinary TEXT layout and
does not select a font. Private prepared-style names include the request source to
prevent otherwise identical legacy/Unicode requests from sharing different defaults.
Two hermetic tests cover shared resolution boundaries and actual renderer geometry,
including a mixed-format cache collision. No core/model or proxy geometry change is made.

Knowledge: note 04 §16 and note 07 §15.9 separate VERIFIED-BY-ACAD appearances from
unverified selection causes. Q-0740 tracks the remaining rule; TODO records the fix and
the pending batch. Legacy empty-font opcodes 10/11/36 retain their existing path until probed.

## Scores on merged master

| Case | Mismatch, merged master → implemented | F1(r=1), before → after | Diagnostic candidate |
|---|---:|---:|---|
| tag-empty-family | 4360 → 1814 | 0.9581 → 1.0000 | TXT; implemented |
| tag-family-arial | 15861 → 15861 | 0.8282 → 0.8282 | SimSun: 2698 / 1.0000; pending rule |
| tag-file-arial | 15861 → 15861 | 0.8282 → 0.8282 | SimSun: 2698 / 1.0000; pending rule |
| tag-file-simplex | 1814 → 1814 | 1.0000 → 1.0000 | Simplex; already correct |
| tag-file-simsun | 1814 → 1814 | 1.0000 → 1.0000 | Family still selects simplex; already correct |
| gh109-floor-plan | 19251 → 19251 | 0.9862 → 0.9862 | Already better than pre-proxy-text 24057 / 0.9079 |

The supplied pre-proxy-text empty-family score was 3328 / 0.9715; the implemented
1814 / 1.0000 improves it. The two Arial probes are still worse than the supplied
8778 / 0.8812 and must be completed after the pending batch. F1 is rounded to four decimals.

The full before/after CPU run covers 1442 cases: text, mtext, acad-default-fonts,
text-probes, font-probes, text-lato, attribs, blocks, misc, fileformat, render-probes,
both proxy probe suites, font-resolution, font-metrics and all four corpus windows.
Only tag-empty-family improves; every other score stays identical: 168 exact cases,
with F1(r=1) ≥ 0.99 increasing from 1239 to 1240. A final 22-case
proxy/gh109 rerun checks the prepared-style safeguard. Raw scores/logs and comparisons
are under `.codex-out/tagfonts/`; `compare.png` shows implemented output and
`candidate-compare.png` clearly labels the unimplemented SimSun candidate.
The unavailable `simhei.ttf` diagnostic falls back to FONTALT and is excluded from
font identification; `candidate-fonts.json` records availability.

## Gates and provenance

- `pnpm typecheck`: pass, exit 0.
- `pnpm test`: pass, 84 files / 704 tests, exit 0.
- `pnpm lint`: pass after formatting, exit 0. One warning skips formatting/checking
  the 2.4 MiB local fixture-baseline JSON artifact; source files pass.
- Fresh unmodified `tagfonts-base`: 4131 fixture + 315 corpus records, zero errors,
  saved only to `.codex-out/tagfonts/` without position binaries.
- Fingerprint against `tagfonts-base`: fixtures exit 1 for exactly one plot change,
  `fid-proxy-followup/tag-empty-family`; all models/viewers match. Corpus passes with
  all 315 model/viewer hashes identical. There are no new fixture records in this run.
- Required saved `baseline` check: fixtures exit 1, 70 new records in each kind plus
  11 historical saved plot changes and 15 historical saved viewer changes; zero errors.
  Corpus exit 1 for the already merged 2018/Leader viewer change; all 315 models match.
  The only change introduced by this follow-up is the empty-family probe plot above.
- `model-all` is not required: core/model untouched.
- Patch replay and `git diff --check` pass. Changes remain uncommitted; no index writes.

The single logical-step patch and one-paragraph message are
`.codex-out/tagfonts/01-empty-proxy-fonts.patch` and `.msg`. They include the verified
resolver change, tests, knowledge updates, this report and the pending probe generator.
Patch replay reproduces all 12 changed/new source and documentation files exactly.

An initial renderer test used two bundled fonts with identical glyphs, so its intended
contrast assertion failed. A distinct bundled probe font corrected the test; the final
test verifies nonempty geometry and passes. Intermediate logs remain available.

## One AutoCAD batch needed

`tools/gen/proxy_font_selection_probes.py` prepares 26 deterministic cases from valid
gh109 opaque records and refuses existing outputs. Its staged `.venv/fid-fonts/proxy-font-selection/`
files decode with all three tags and the expected font fields (zero audit errors).
Cases vary charset 0/1/134, pitch 0/2/34, family/file precedence, available/missing
bigfonts, unknown/missing fonts and opcodes 10/11/36. It preserves tag geometry and
requests PNG/PDF/DXFOUT. This is the one requested run for this follow-up.

From this worktree:

```powershell
& "C:/Users/Tim/programming/projects/intellij/truedxf/tools/gen/.venv/Scripts/python.exe" tools/gen/proxy_font_selection_probes.py
node tools/acad/src/run.ts --suite proxy-font-selection --timeout 600 --jobs 2
```

Remaining issues: charset/family selection for Arial; unverified empty defaults of legacy
opcodes; primary/bigfont interaction; 884 SimSun tag raster fringes in the candidate;
the unchanged native dimension and gh109 geometry/text differences outside this font fix.
No additional probe round beyond this batch is proposed.
