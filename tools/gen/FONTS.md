# Fonts fixtures may use

docs/fixtures.md: fixtures reference only the fonts listed here, so that AutoCAD and truedxf
render text from **the same font file**. The aliases are defined in
`truedxf_gen/resources.py` (`TTF_FONTS`, `ACAD_SHX_FONTS`); use those constants, not literal
file names, in suites.

## Free TrueType fonts (all suites)

Checked in `C:\Windows\Fonts` on the reference machine (2026-09-30). AutoCAD finds TTFs there by
file name (STYLE code 3 = file name).

| Alias | STYLE font (code 3) | Family | License | Notes |
|---|---|---|---|---|
| `sans` | `LiberationSans-Regular.ttf` | Liberation Sans | SIL OFL 1.1 | **default** for every fixture (STANDARD style) |
| `sans-bold` | `LiberationSans-Bold.ttf` | Liberation Sans Bold | SIL OFL 1.1 | |
| `sans-italic` | `LiberationSans-Italic.ttf` | Liberation Sans Italic | SIL OFL 1.1 | |
| `sans-bolditalic` | `LiberationSans-BoldItalic.ttf` | Liberation Sans Bold Italic | SIL OFL 1.1 | |
| `lato` | `LatoWeb-Regular.ttf` | Lato | SIL OFL 1.1 | second proportional family (different metrics) |
| `lato-bold` | `LatoWeb-Bold.ttf` | Lato Bold | SIL OFL 1.1 | |
| `mono` | `CascadiaMono.ttf` | Cascadia Mono | SIL OFL 1.1 | monospace; installed with Windows Terminal |

Not installed (do **not** reference until they are installed system-wide for AutoCAD):
Liberation Serif, Liberation Mono, DejaVu, Noto. `JetBrainsMonoNL-Regular.ttf` exists only in the
per-user font folder (`%LOCALAPPDATA%\Microsoft\Windows\Fonts`), which AutoCAD may not search.
To add a font: install it for all users, add a row here and an alias in `resources.py`.

MTEXT `\f` codes use the family name (e.g. `\fLiberation Sans|b0|i0|c0|p34;`); the STYLE record
uses the file name. Both must resolve to a row above.

## AutoCAD-shipped SHX fonts (suite `acad-default-fonts` only)

Present in `C:\Program Files\Autodesk\AutoCAD 2027\Fonts`: `txt.shx`, `simplex.shx`,
`romans.shx`, `isocp.shx`, `amgdt.shx`, `ltypeshp.shx` (shapes for complex linetypes),
`bigfont.shx`, `chineset.shx`, `extfont.shx`. Note: `gdt.shx` is **not** installed.

These are Autodesk files: truedxf can't ship them and our renderer only has them when a user
points it at an AutoCAD install. Cases using them are compared with a tolerant metric and live in
the `acad-default-fonts` suite (`fonts="acad"` in the suite registration), which also holds
complex linetypes with shapes (`ltypeshp.shx`) and TOLERANCE (GDT symbols).

## truedxf test SHX fonts (later)

`packages/fonts` will provide our own compiled SHX fonts (shape font, unifont, bigfont) built
from permissively licensed stroke fonts; the same `.shx` file is then installed for AutoCAD and
loaded by truedxf. Until they exist, **no suite except `acad-default-fonts` uses SHX**. Questions
that need them are marked `plan: needs test SHX` in docs/questions.md.
