# tools/gen — test-fixture generator (Python + ezdxf)

Generates the small, deterministic DXF fixtures that the AutoCAD harness (`tools/acad`) plots
and the visual test kit compares against. Output contract: [docs/fixtures.md](../../docs/fixtures.md).
Fixtures are **local only** (`samples/generated/`, gitignored).

## Setup

The venv lives in `tools/gen/.venv` (gitignored; Python 3.11, ezdxf 1.4.4, matplotlib, pillow,
pymupdf). To recreate it:

```bash
py -3.11 -m venv tools/gen/.venv
tools/gen/.venv/Scripts/python -m pip install ezdxf==1.4.4 matplotlib pillow pymupdf
tools/gen/.venv/Scripts/python -m pip install -e tools/gen    # optional: makes `-m truedxf_gen` work anywhere
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

(`python -m truedxf_gen …` is equivalent when run inside `tools/gen` or after `pip install -e`.)

- Every written DXF is re-read and passed through `ezdxf.audit`; audit **errors** fail the run
  (exit code 1). Audit fixes are printed as warnings.
- `--clean` deletes only the selected suites' folders. `samples/generated/calibration` belongs to
  `tools/acad` and is never written here (the name is rejected by the registry).
- The generator re-executes itself with `PYTHONHASHSEED=0`: ezdxf creates a few objects in
  set-iteration order, which otherwise changes the byte output between runs.

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
`params`, `dxfversion` (`"R2018"` default = AC1032; also R12…R2013), `units` ($INSUNITS, default 4 =
mm), `header` (dict of `$VAR` overrides), `standard_font` (STANDARD style font, default Liberation
Sans), `style_table` (`"monochrome.ctb"` | `"acad.ctb"`, default from the suite), `outputs`
(default `["png", "pdf", "dxf"]`).

### Case helpers

| Helper | What |
|---|---|
| `c.window(min, max, canvas=(2000,1500))` | window plot; raises unless the window aspect equals the canvas aspect |
| `c.window_scale(origin, px_per_unit)` / `c.window_center(center, px_per_unit)` | window of exactly `canvas/px_per_unit` units |
| `c.fit(bmin=None, bmax=None, margin=0.05)` | window around a box (default: ezdxf extents) at a *nice* scale (1, 2, 2.5, 4, 5, 8 × 10^k px/unit); returns px/unit |
| `c.plot_extents()` | plot area "extents" |
| `c.plot_layout(name, scale="fit")` / `c.layout_window(name, min, max)` | paper-space plots |
| `c.layer(name, color=, linetype=, lineweight=, plot=, on=, frozen=, locked=, true_color=, transparency=)` | create a layer once |
| `c.linetype(name)` | add an AutoCAD-valued standard/ISO linetype (`resources.py`; note 11a §12) |
| `c.style(name, font=, width=, oblique=, height=, bigfont=)` | text style; fonts from [FONTS.md](FONTS.md) |
| `c.header(pdmode=3, ltscale=2)` | set header vars (`$` + upper-cased name) |
| `c.add_file("img-a.png", data)` | extra file written next to the case; returns its absolute canonical path (`samples/generated/<suite>/…`) |
| `c.notes.append("…")` | free-text notes copied into the meta JSON (`notes`) |
| `c.byte_filters.append(fn)` | `bytes -> bytes` post-processing of the serialised DXF (deliberately malformed files for `fileformat` questions) |
| `c.allow_audit_errors = True` | ezdxf audit errors are reported but don't fail the run (only for cases that are invalid on purpose) |

Canvases: `2000×1500` (default), `1000×1000`, `800×600` (`plotwin.CANVASES`; the harness README
is authoritative). Default document state (`core.new_doc`): no ezdxf `setup` resources, STANDARD
style → `LiberationSans-Regular.ttf`, `$MEASUREMENT 1`, `$INSUNITS 4`, `$LTSCALE`/`$CELTSCALE 1`,
`$PSLTSCALE 1`, `$PDMODE 0`, `$FILLMODE 1`, `$MIRRTEXT 0`, `$LWDISPLAY 1`, fixed timestamps and
null GUIDs; `$EXTMIN/$EXTMAX` are set from ezdxf's bounding box before writing;
the `*Active` VPORT is centred on the plot window so AutoCAD opens on the feature.

## Conventions for cases

- **One feature per case.** Parameter sweeps become separate cases (`bulge-0001…`), plus a few
  seeded random cases (`random-0001…`) per suite. Keep drawings small (≲ 200 entities) except in
  `mixed`.
- **Make it visible.** Choose windows so the feature spans a large part of the canvas and has
  several px per unit (typically a 200 × 150 window on 2000 × 1500 px = 10 px/unit). Put a small
  reference mark (cross/point) where it helps to locate things.
- **Hairline geometry.** Geometry suites register `layer0_lineweight=0` so entities are drawn at
  the thinnest width (pixel-exact comparisons); appearance suites keep the defaults.
- **Style tables.** `monochrome.ctb` by default; colour/appearance suites use `acad.ctb`.
- **Fonts.** Only [FONTS.md](FONTS.md) fonts; AutoCAD SHX fonts only in `acad-default-fonts`.
- **Determinism.** No `random` module functions, no time, no `set` iteration, no absolute paths
  except those returned by `c.add_file` (canonical folder, independent of `--out`).
  `--check-determinism` must pass.
- **AutoCAD must open it.** Cases that probe invalid data on purpose (e.g. radius 0) say so in
  the title; if AutoCAD rejects them the harness marks them `invalid-fixture`, which is itself an
  answer for `fileformat` questions.
- **Questions.** Link each case to the `docs/questions.md` ids it helps answer
  (`questions=[…]`), then run `--update-questions`. Questions without a case keep a
  `plan: …` note in the test column.

## Layout

```
tools/gen/
  run.py                      entry point (adds tools/gen to sys.path)
  truedxf_gen/__main__.py     CLI (generate, list, audit, determinism check, questions update)
  truedxf_gen/core.py         registry, Case/SuiteBuilder, document factory, writer
  truedxf_gen/plotwin.py      canvas list, aspect check, nice-scale windows
  truedxf_gen/resources.py    linetype table (AutoCAD values), font aliases
  truedxf_gen/questions.py    docs/questions.md test-column updater
  truedxf_gen/preview.py      ezdxf/matplotlib contact sheet (sanity check only)
  truedxf_gen/suites/*.py     one module per suite
```
