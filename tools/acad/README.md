# tools/acad

Node scripts that plot the generated fixtures with a local AutoCAD 2027 install
(`accoreconsole.exe`, Windows) to produce the reference images truedxf is scored against.

`samples/generated/<suite>/<case>.{dxf,json}` ([docs/fixtures.md](../../docs/fixtures.md)) in,
`samples/refs/<acad-build>/<suite>/<case>.{png,pdf,dxf,log,json}` out. Calibration results (how
AutoCAD rasterizes): research/notes/08 §10 and research/notes/06 §3.5 (palette).

## Setup (once per machine / AutoCAD install)

```bash
node tools/acad/src/configs.ts          # writes the 4 truedxf plot configs (idempotent)
node tools/acad/src/configs.ts --dump   # also prints the generated PIA texts
```

`configs.ts` reads the stock `PublishToWeb PNG.pc3`, `PMP Files/PublishToWeb PNG.pmp` and
`DWG To PDF.pc3` from `%APPDATA%\Autodesk\AutoCAD 2027\R26.0\enu\Plotters` and writes:

| file | based on | content |
|---|---|---|
| `Plotters\truedxf PNG.pc3` | PublishToWeb PNG.pc3 | raster7 PNG driver, 100 dpi, white background, points to the PMP below |
| `Plotters\PMP Files\truedxf PNG.pmp` | PublishToWeb PNG.pmp (mod/del/hidden/calibration sections) | custom sizes only, zero margins |
| `Plotters\truedxf PDF.pc3` | DWG To PDF.pc3 | vector PDF, no viewer, points to the PMP below |
| `Plotters\PMP Files\truedxf PDF.pmp` | meta of DWG To PDF.pc3 + PNG PMP media sections | the same sheets in inches (px / 100), zero margins |

Existing configs are never modified and nothing from Autodesk is committed. Override the folders
with `TRUEDXF_PLOTTERS_DIR`, `TRUEDXF_ACAD_ROAMING`, `TRUEDXF_ACAD_DIR` (install folder).

**Paper sizes (authoritative canvas list):**

| canvas (px) | PNG paper name | PDF paper name |
|---|---|---|
| 2000 × 1500 (default) | `truedxf 2000x1500 (2000.00 x 1500.00 Pixels)` | `truedxf 2000x1500 (20.00 x 15.00 Inches)` |
| 1000 × 1000 | `truedxf 1000x1000 (1000.00 x 1000.00 Pixels)` | `truedxf 1000x1000 (10.00 x 10.00 Inches)` |
| 800 × 600 | `truedxf 800x600 (800.00 x 600.00 Pixels)` | `truedxf 800x600 (8.00 x 6.00 Inches)` |
| 4000 × 3000 (calibration only) | `truedxf 4000x3000 (4000.00 x 3000.00 Pixels)` | `truedxf 4000x3000 (40.00 x 30.00 Inches)` |
| 1600 × 1200 (page setups only) | `truedxf 1600x1200 (1600.00 x 1200.00 Pixels)` | `truedxf 1600x1200 (16.00 x 12.00 Inches)` |
| 1017 × 1013 (fill-tile probes only) | `truedxf 1017x1013 (1017.00 x 1013.00 Pixels)` | `truedxf 1017x1013 (10.17 x 10.13 Inches)` |
| 1030 × 1017 (fill-tile probes only) | `truedxf 1030x1017 (1030.00 x 1017.00 Pixels)` | `truedxf 1030x1017 (10.30 x 10.17 Inches)` |

The 1600 × 1200 sheet has unprintable margins left/bottom/right/top = 10/20/30/40 px
(PDF: 0.10/0.20/0.30/0.40 in), `sizes.ts` `CANVAS_MARGINS`. The raster driver writes only the
printable area, so its PNG is 1560 × 1140 (research/notes/08 §10.17). The 1017 × 1013 and
1030 × 1017 sheets (margins 3/7/11/13 px, PNG 1016 × 997) have printable sizes and margins that
are not multiples of 10/20 px, to locate the anchor of the fill-style tiles (research/notes/06 §6.8).

### PIA file format (PC3 / PMP / CTB / STB)

`src/pia.ts`: 48-byte ASCII header `PIAFILEVERSION_2.0,PC3VER1,compress\r\npmzlibcodec`
(`PC3VER1` also for PMP, `CTBVER1`/`STBVER1` for plot styles), three uint32 LE (**adler32 of the
compressed body**, plain length, compressed length), then a zlib stream of latin-1 text: one
`key=value` per line, one space of indent per level, `key{ … }` sections, string values start
with `"` and have no closing quote. Some files end with a NUL. Numbers ≥ 1e5 or with many digits
carry an optional ` (xxxxxxxxxxxxxx)` token (uuencode-style little-endian double plus 16 bits of
an unknown checksum). AutoCAD accepts plain decimals without it. Raster sizes use inclusive pixel
indices: zero margins = printable bounds `(0,0)–(W−1,H−1)`. AutoCAD 2027 also reads an
uncompressed `PIAFILEVERSION_3.0,json` variant (not used). The parser round-trips all stock files
byte-exactly (text level).

Hashes (sha256) on the reference machine, 2026-09-30 (the generated files embed the absolute PMP
path, so they are machine specific):

| file | sha256 |
|---|---|
| stock PublishToWeb PNG.pc3 | `b4ce03606f365613134250d17def09bf7b31e7a5227258473d602d011a61bedf` |
| stock PublishToWeb PNG.pmp | `fe25fb0b643d255df6412635891caecf4e766a991dd1698aa77f55574f5be82d` |
| stock DWG To PDF.pc3 | `cdf9040f4e69c9189845e854f57b5b4eb1d29e354ec95cabd095e683215dd553` |
| stock monochrome.ctb | `39e50a1605c0ff5805065a39766271192de6e52dd4b54cfd4f031ad6e4433608` |
| stock acad.ctb | `9e6fdb8dc2735ab9000719ab77cff9c8403987b447a5863c2f3a95824b6bdb27` |
| truedxf PNG.pc3 | `218204c1488ba910fdb2d763c49d8372ad57f400a7aa20bd6d27b678ad835a58` |
| truedxf PNG.pmp | `5055c51ced0019ee50e321abad0ce492ee45b80a0c4d31dabc943c649fdadb17` (2026-10-12, with the margins and fill-tile probe sheets) |
| truedxf PDF.pc3 | `cc4b13f7a883d742126688d1ef394f1f7bce86beb2232bd55cfd379235769403` |
| truedxf PDF.pmp | `c4bdc03fd9a5b2d8cea3a5dc8715e57b1c24488b71490adfbb8cd89aa2930f33` (2026-10-12, with the margins and fill-tile probe sheets) |

Every reference `.json` records the hashes actually used (`configs`).

## Running

```bash
node tools/acad/src/run.ts                          # all suites, skip up-to-date references
node tools/acad/src/run.ts --suite lines            # one suite
node tools/acad/src/run.ts --case lines/line-basic-0001 --force
node tools/acad/src/run.ts --suite text --jobs 4 --timeout 180
node tools/acad/src/run.ts --list                   # list the cases it would consider
```

Defaults: `--jobs min(4, cores/2)`, `--timeout 120` s per case. Exit code 2 if any case is not
`ok`. A reference is up to date when its `.json` has the same `fixtureSha256`, `metaSha256` and
`harness` version and status `ok` or `invalid-fixture`. Everything else is re-run.

Per case the runner:

1. copies the DXF to a short, space-free work dir (`%TEMP%\truedxf-acad\w<slot>\case.dxf`, root
   override `TRUEDXF_ACAD_TMP`).
2. writes `run.scr` (CRLF, no BOM): LISP helpers, the sysvar prologue, `_.UCS _W`, optional
   `_.DXFOUT` (R2018, 16 digits), the harness ZOOM, one detailed `_.-PLOT` per requested output
   (`png` → truedxf PNG.pc3, `pdf` → truedxf PDF.pc3), `_.QUIT _Y`.
3. runs `accoreconsole.exe /isolate truedxf-w<slot> <tmp>\profile-w<slot> /i case.dxf /s run.scr
   /l en-US` (stdin = NUL, the process tree is killed on timeout and `senddmp.exe` is killed after
   a crash).
4. decodes the UTF-16LE transcript and verifies it: every expected prompt answered in order (no
   re-prompt), `Effective plotting area` after each plot, no error lines (`Unknown command`,
   `; error:`, `Invalid …`, `not found.` …), the PNG exists and its size equals the canvas minus
   the sheet's margins (or `plot.pngSize`).
5. writes `<case>.png/.pdf/.dxf` (as requested), `<case>.log` (decoded transcript) and
   `<case>.json` (docs/fixtures.md + `harness`, `outputs.png.{width,height,channels,depth,palette,
   sha256,effectivePlottingArea}`, `outputs.pdf.{bytes,sha256,mediaBox,pages}`).

Statuses: `ok`, `invalid-fixture` (AutoCAD rejected the DXF: "Invalid or incomplete DXF input",
exit code 53), `timeout`, `crash` (non-zero exit before the end of the script) and
`harness-failure` (anything else: desynchronised prompts, missing output, wrong PNG size, error
lines).

Several runner processes may run at once (e.g. one per suite): each worker claims a slot with a
lock file `%TEMP%\truedxf-acad\slot-<n>.lock` (stale locks of dead processes are taken over), so
work dirs and `/isolate` profiles never collide.

### Script recipe (research/notes/08 §7, as implemented)

- Sysvars set every run (`/isolate` keeps them out of the user's profile): FILEDIA 0, CMDDIA 0,
  CMDECHO 1, EXPERT 5, BACKGROUNDPLOT 0, PLOTTRANSPARENCYOVERRIDE 0, PLOTOFFSET 0, PLOTROTMODE 2,
  LWDEFAULT 25, TEXTFILL 1, TEXTQLTY 50, FONTALT simplex.shx, SECURELOAD 0. Drawing-stored
  variables are **not** overridden, only echoed into the log: FILLMODE, MSLTSCALE, PSLTSCALE,
  LTSCALE, SORTENTS, TILEMODE, LWDISPLAY, PDMODE, PDSIZE.
- **Harness ZOOM** before Window plots: `_.ZOOM _C <window centre> <window height / 100>` (for
  layouts after `CTAB = <layout>`, `_.PSPACE`, LAYOUTCREATEVIEWPORT 0). Without it AutoCAD trims
  the window to the geometry extents and re-centres the plot when the geometry comes within ~2 %
  of the view height of the window edge (note 08 §10.1).
- -PLOT answers: `_Y`, layout, device, paper, (`_I` paper units for PDF), orientation (`_L`, but
  **`_P` for square sheets**, since Landscape rotates a square sheet by 90°), `_N` upside down,
  area (`_W` + corners | `_E` | `_L` layout), scale (`_F` or `p=d`, with PNG units in pixels and
  PDF units in inches = px/100), offset `_C` (`0,0` for area Layout, which has no Center option),
  `_Y` plot styles, CTB, lineweights `_Y/_N`, then `_A` shade plot (model) or `_N` scale
  lineweights, `_N/_Y` paper space first, `_N` hide paperspace objects (layouts), file name, `_N`
  save page setup, `_Y` proceed.

### Meta extensions understood by the runner

`plot.paperSpaceFirst` (boolean, for layouts, default false = AutoCAD's default answer "No"),
`plot.sysvars` (`{ "PLOTTRANSPARENCYOVERRIDE": 2 }` etc., set after the prologue). `outputs`
defaults to `["png"]`. Further optional answers (defaults = the behaviour above):

| key | effect |
|---|---|
| `plot.orientation` | `"portrait"` / `"landscape"` (on a landscape sheet stored as 73 = 1 / 0) |
| `plot.upsideDown` | answer to "Plot upside down?" (73 = 2 / 3 with landscape / portrait) |
| `plot.plotStyles` | answer to "Plot with plot styles?" (the style-table prompt still follows) |
| `plot.scaleLineweights` | answer to "Scale lineweights with plot scale?" (layouts) |
| `plot.paperUnits` | `"inches"` (default) / `"mm"` on the PDF device |
| `plot.scale` | also a verbatim scale answer string, e.g. `"1:50"`, `"1=3"`, `"1/4\"=1'"` |
| `plot.savePageSetup` | "Save changes to page setup" = Yes, and DXFOUT runs *after* the plots |
| `plot.offset` | verbatim answer to "Enter plot offset", e.g. `"30,40"` (default `_C` for windows, `0,0` for Layout) |
| `plot.pngSize` | expected PNG size when a stored page setup brings other margins than the sheet (e.g. 40–43 = 0 on the margins sheet) |
| `plot.mode: "pagesetup"` | non-detailed -PLOT: `_N`, layout, page setup name = Enter (the layout's own settings), device (must be the one stored in the layout: `truedxf PNG.pc3` with media `UserDefinedRaster (2000.00 x 1500.00Pixels)`), file, save, proceed. Every other setting comes from the stored PLOTSETTINGS |

**Plot style tables.** `plot.styleTable` names a table in the Plot Styles folder, or `"."` for
none. A table named `truedxf-*.ctb|stb` that lies next to the case
(`samples/generated/<suite>/`, written by tools/gen `Case.plot_style_table`) is copied into the
Plot Styles folder before the run (write + rename, skipped when unchanged); stock tables are only
read. The tools/gen meta carries the table's sha256 (`plot.styleTableSha256`), so a changed table
re-runs its references.

## Calibration suite

```bash
tools/gen/.venv/Scripts/python tools/acad/calibration/calgen.py [--only mapping_ties,...]
node tools/acad/src/run.ts --suite calibration
tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_mapping.py      # T-PL-1 mapping + ties
tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_lines.py        # T-PL-2 thin lines
tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_fills.py        # SOLID / HATCH edges
tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_lineweights.py  # T-PL-3 widths, caps
tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_thick.py --masks  # stroke shapes
tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_palette.py --dump # T-PL-5 colours
tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_pdf.py          # PDF widths/curves
tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_viewports.py    # twist, layouts
tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_plotstyles.py   # CTB/STB rules, page setups (suites plotstyles, pagesetup)
tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_pen_patterns.py # CTB pen linetypes (PDF) and fill-style tiles (PNG)
```

The `calibration` suite is owned by tools/acad (tools/gen refuses to write it).

## Fixture advice for generators (from the calibration)

- Keep geometry off exact pixel boundaries: at 10 px/unit every multiple of 0.1 unit is an exact
  tie that AutoCAD resolves by floating-point noise. Shift the window by half a pixel (e.g.
  `min = (-0.05, -0.05)`) so round coordinates hit pixel centres.
- Use `monochrome.ctb` only with ACI colours: true-colour entities keep their RGB under it.
- POINT ignores the lineweight (1 px). ACI 255 plots FAFAFA, true-colour white is invisible.

## Troubleshooting

- `harness-failure … prompt not found`: the first unexpected line in `<case>.log` shows which
  answer AutoCAD rejected.
- Git Bash converts `/i`-style arguments to paths, so run the console only through `run.ts`
  (Node spawn) or with `MSYS_NO_PATHCONV=1`.
- `ErrorReports/` folders in the work dirs are AutoCAD crash dumps (ignored by git).
