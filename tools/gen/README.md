# tools/gen

Python generator (needs Python 3.11 and ezdxf 1.4.4) for the small, deterministic DXF fixtures
that `tools/acad` plots with AutoCAD and `packages/testkit` scores against. Output contract:
[docs/fixtures.md](../../docs/fixtures.md). Fixtures are local only (`samples/generated/`,
gitignored).

## Setup

The venv is `tools/gen/.venv` (gitignored, with Python 3.11, ezdxf 1.4.4, matplotlib, pillow,
pymupdf):

```bash
py -3.11 -m venv tools/gen/.venv
tools/gen/.venv/Scripts/python -m pip install ezdxf==1.4.4 matplotlib pillow pymupdf
tools/gen/.venv/Scripts/python -m pip install -e tools/gen    # optional: `-m truedxf_gen` from anywhere
```

## Commands (from the repo root)

```bash
PY=tools/gen/.venv/Scripts/python
$PY tools/gen/run.py --list                   # suites and case counts (-v: every case)
$PY tools/gen/run.py                          # all suites -> samples/generated/<suite>/
$PY tools/gen/run.py -s points -s 'line*'     # selected suites (globs, repeatable or comma list)
$PY tools/gen/run.py -s hatches --case 'pattern-*' --clean
$PY tools/gen/run.py --check-determinism      # generate twice in fresh processes, compare bytes
$PY tools/gen/run.py --update-questions       # refresh the `test` column of docs/questions.md
$PY -m truedxf_gen.preview samples/generated/polylines/width-*.json --out sheet.png  # ezdxf preview (run in tools/gen)
```

`python -m truedxf_gen …` is the same CLI (inside `tools/gen` or after `pip install -e`).

- Every written DXF is re-read and run through `ezdxf.audit`: audit errors fail the run (exit
  code 1), fixes are printed as warnings. `--no-audit` skips it.
- `--clean` deletes only the selected suites' folders. `samples/generated/calibration` belongs to
  `tools/acad`, and the registry rejects that suite name.
- The generator re-executes itself with `PYTHONHASHSEED=0`, because ezdxf creates a few objects
  in set-iteration order and the bytes would otherwise change between runs.

## Adding a suite

Create `truedxf_gen/suites/<name>.py` (modules are auto-discovered in sorted order):

```python
from ..core import SuiteBuilder, suite

@suite("points", "POINT symbols", style_table="monochrome.ctb", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    for mode in (0, 2, 3):
        c = s.case(
            f"pdmode-{mode:03d}",                    # case name: [a-z0-9-]
            f"POINT grid PDMODE={mode}",             # title
            tags=["POINT", "PDMODE"],                # entity types / features
            questions=["Q-0123"],                    # docs/questions.md ids (optional)
            params={"pdmode": mode},                 # free-form, for humans/agents
            header={"$PDMODE": mode, "$PDSIZE": 5.0},
        )
        c.msp.add_point((100, 75))                   # c.doc / c.msp are plain ezdxf objects
        c.window((0, 0), (200, 150))                 # plot area (aspect must match canvas)
```

### `s.case(name, title, **kw)` keywords

`tags`, `questions`, `seed` (int → `c.rng = random.Random(seed)`, the only allowed randomness),
`params`, `dxfversion` (`"R2018"` default = AC1032, also R12…R2013), `units` ($INSUNITS, default
4 = mm), `header` (dict of `$VAR` overrides), `standard_font` (STANDARD style font, default
Liberation Sans), `style_table` (`"monochrome.ctb"` | `"acad.ctb"` | a stock table such as `"Grayscale.ctb"` | `"."` = none; default from the suite),
`outputs` (default `["png", "pdf", "dxf"]`).

### Case helpers

| Helper | What |
|---|---|
| `c.window(min, max, canvas=(2000,1500))` | window plot (raises unless the window aspect equals the canvas aspect) |
| `c.window_scale(origin, px_per_unit)` / `c.window_center(center, px_per_unit)` | window of exactly `canvas/px_per_unit` units |
| `c.fit(bmin=None, bmax=None, margin=0.05)` | window around a box (default: ezdxf extents) at a *nice* scale (1, 2, 2.5, 4, 5, 8 × 10^k px/unit). Returns px/unit |
| `c.plot_extents()` | plot area "extents" |
| `c.plot_layout(name, scale="fit")` / `c.layout_window(name, min, max)` | paper-space plots |
| `c.layer(name, color=, linetype=, lineweight=, plot=, on=, frozen=, locked=, true_color=, transparency=)` | create a layer once |
| `c.linetype(name)` | add an AutoCAD-valued standard/ISO linetype (`resources.py`, note 11a §12) |
| `c.style(name, font=, width=, oblique=, height=, bigfont=)` | text style with fonts from [FONTS.md](FONTS.md) |
| `c.sysvar("PLOTTRANSPARENCYOVERRIDE", 2)` / `c.plot.paperSpaceFirst = True` | emitted as `plot.sysvars` / `plot.paperSpaceFirst`: registry sysvars and plot prompts a DXF cannot carry (see tools/acad) |
| `c.plot.extra["orientation"] = "portrait"` etc. | further harness answers written verbatim into `plot` (`mode`, `orientation`, `upsideDown`, `plotStyles`, `scaleLineweights`, `paperUnits`, `savePageSetup`; tools/acad README) |
| `c.plot_style_table("truedxf-x.ctb", ctb_bytes(pens, lineweights))` | fixture-specific CTB/STB (`truedxf_gen/plotstyle.py`: `ctb_bytes`, `stb_bytes`, `rgb_color`; pens default to "object" like acad.ctb); written next to the case, installed by the harness, sha256 in the meta |
| `c.header(pdmode=3, ltscale=2)` | set header vars (`$` + upper-cased name) |
| `c.add_file("img-a.png", data)` | extra file written next to the case. Returns its absolute canonical path (`samples/generated/<suite>/…`) |
| `c.notes.append("…")` | free-text notes copied into the meta JSON (`notes`) |
| `c.byte_filters.append(fn)` | `bytes -> bytes` post-processing of the serialised DXF (deliberately malformed files for `fileformat` questions) |
| `c.allow_audit_errors = True` | ezdxf audit errors are reported but do not fail the run (only for cases that are invalid on purpose) |

Canvases: `2000×1500` (default), `1000×1000`, `800×600` (`plotwin.CANVASES`, but the tools/acad
README is authoritative). Default document (`core.new_doc`): no ezdxf `setup` resources,
STANDARD style → `LiberationSans-Regular.ttf`, `$MEASUREMENT 1`, `$INSUNITS 4`,
`$LTSCALE`/`$CELTSCALE 1`, `$PSLTSCALE 1`, `$PDMODE 0`, `$FILLMODE 1`, `$MIRRTEXT 0`,
`$LWDISPLAY 1`, fixed timestamps and null GUIDs. `$EXTMIN/$EXTMAX` come from ezdxf's bounding box,
and the `*Active` VPORT is centred on the plot window so AutoCAD opens on the feature.

## Conventions for cases

- **One feature per case.** Parameter sweeps become separate cases (`bulge-0001…`), plus a few
  seeded random cases (`random-0001…`) per suite. Keep drawings small (≲ 200 entities) except in
  `mixed`.
- **Make it visible.** The feature should span much of the canvas at several px per unit
  (typically a 200 × 150 window on 2000 × 1500 px = 10 px/unit). Add a small reference mark
  (cross/point) where it helps to locate things.
- **Pixel centres.** `c.window*` shift the window by half a device pixel towards −x/−y, so round
  coordinates hit pixel centres instead of exact pixel-boundary ties (tools/acad calibration).
  Set `c.half_pixel_shift = False` for cases about exact boundaries.
- **Extra files.** `tools/acad` copies only the DXF into its work dir, so IMAGE/underlay/xref
  paths must be the absolute paths returned by `c.add_file`. Relative paths resolve only when
  AutoCAD opens the fixture in `samples/generated/<suite>/`.
- **Hairline geometry.** Geometry suites register `layer0_lineweight=0` so entities plot at the
  thinnest width (pixel-exact comparisons). Appearance suites keep the defaults.
- **Style tables.** `monochrome.ctb` by default, while colour/appearance suites use `acad.ctb`.
- **Fonts.** Only [FONTS.md](FONTS.md) fonts. AutoCAD SHX fonts only in `acad-default-fonts`.
- **Determinism.** No `random` module functions, no time, no `set` iteration, no absolute paths
  except those from `c.add_file` (canonical folder, independent of `--out`).
  `--check-determinism` must pass.
- **AutoCAD must open it.** Cases that probe invalid data on purpose (e.g. radius 0) say so in the
  title. If AutoCAD rejects them the harness marks them `invalid-fixture`, which is itself an
  answer for `fileformat` questions.
- **Questions.** Link each case to the `docs/questions.md` ids it helps answer (`questions=[…]`),
  then run `--update-questions`. Questions without a case keep a `plan: …` note in the test
  column.

## Layout

```
tools/gen/
  run.py                      entry point (adds tools/gen to sys.path)
  truedxf_gen/__main__.py     CLI (generate, list, audit, determinism check, questions update)
  truedxf_gen/core.py         registry, Case/SuiteBuilder, document factory, writer
  truedxf_gen/plotwin.py      canvas list, aspect check, nice-scale windows
  truedxf_gen/resources.py    linetype table (AutoCAD values), font aliases
  truedxf_gen/plotstyle.py    CTB/STB writer (PIA container, stock key order)
  truedxf_gen/questions.py    docs/questions.md test-column updater
  truedxf_gen/preview.py      ezdxf/matplotlib contact sheet (sanity check only)
  truedxf_gen/suites/*.py     one module per suite
```
