# Fixture and reference contract

Shared contract between the generator (`tools/gen`), the AutoCAD harness (`tools/acad`) and the
visual test kit (`packages/testkit`). Everything lives under `samples/` and is **local only**.

## Generated cases

```
samples/generated/<suite>/<case>.dxf     the fixture
samples/generated/<suite>/<case>.json    case metadata (below)
```

`<suite>` and `<case>` are lowercase `[a-z0-9-]`. The case id is `<suite>/<case>`.

```jsonc
{
  "id": "lines/line-basic-0001",
  "suite": "lines",
  "title": "Single LINE, lineweight 0",
  "tags": ["LINE"],                // entity types / features exercised
  "questions": ["Q-0012"],         // docs/questions.md ids this case helps answer (optional)
  "seed": 1,                       // generator seed (random variants), or null
  "params": {},                    // generator parameters (free form, for humans and agents)
  "dxfversion": "AC1032",
  "generator": "tools/gen 0.1 / ezdxf 1.4.4",
  "plot": {
    "layout": "Model",             // "Model" or a paper-space layout name
    "area": { "type": "window", "min": [0, 0], "max": [200, 150] },
                                   // or { "type": "extents" } | { "type": "layout" }
    "canvas": [2000, 1500],        // output pixels; must be one of the harness paper sizes
    "styleTable": "monochrome.ctb",// "monochrome.ctb" | "acad.ctb" (colour tests) | a stock table
                                   // (Grayscale.ctb, Screening 50%.ctb, …) | "." (none) |
                                   // "truedxf-*.ctb|stb" written next to the case
    "lineweights": true,
    "scale": "fit"                 // "fit", [paperUnits, drawingUnits] e.g. [1, 10], or a
                                   // verbatim -PLOT answer such as "1:50"
    // optional harness answers: paperSpaceFirst, sysvars, orientation, upsideDown, plotStyles,
    // scaleLineweights, paperUnits, savePageSetup, mode ("pagesetup" = plot the stored page
    // setup), styleTableSha256 — see tools/acad/README.md "Meta extensions"
  },
  "outputs": ["png", "pdf", "dxf"] // references to produce ("dxf" = AutoCAD re-save via DXFOUT)
}
```

Rules:
- For `window` plots the window aspect ratio **must equal** the canvas aspect ratio, so Fit gives
  an exact scale (e.g. 200 × 150 units on 2000 × 1500 px = 10 px/unit).
- Supported canvases (paper sizes in the truedxf PC3/PMP): `2000×1500` (default), `1000×1000`,
  `800×600`, and `1600×1200` (page setups only: the sheet with 10/20/30/40 px margins, whose PNG is
  the 1560×1140 printable area); `1017×1013` and `1030×1017` (margins 3/7/11/13 px, PNG 1016×997)
  only probe the fill-style tile anchor. The harness README is authoritative if this list changes.
- Every fixture must open in AutoCAD without errors; the harness marks cases whose log shows a
  load error as `invalid-fixture`.
- Fonts used by fixtures: only fonts listed in `tools/gen/FONTS.md` (free fonts installed for
  AutoCAD, plus truedxf test SHX fonts), unless the suite is explicitly about AutoCAD defaults.

## AutoCAD references

```
samples/refs/<acad-build>/<suite>/<case>.png   raster plot (truedxf PNG.pc3)
samples/refs/<acad-build>/<suite>/<case>.pdf   vector plot (truedxf PDF.pc3)
samples/refs/<acad-build>/<suite>/<case>.dxf   DXFOUT re-save (AutoCAD-computed values)
samples/refs/<acad-build>/<suite>/<case>.log   decoded accoreconsole log
samples/refs/<acad-build>/<suite>/<case>.json  run metadata (below)
```

`<acad-build>` e.g. `acad2027-R26.0` (from the console banner / `_VERNUM`).

```jsonc
{
  "id": "lines/line-basic-0001",
  "status": "ok",                   // ok | harness-failure | invalid-fixture | timeout | crash
  "acad": { "product": "AutoCAD 2027", "build": "…" },
  "configs": { "pc3": "<sha256>", "pmp": "<sha256>", "ctb": "<sha256>" },
  "fixtureSha256": "…", "metaSha256": "…",
  "script": "…",                    // the exact .scr text
  "durationMs": 1234,
  "outputs": { "png": { "width": 2000, "height": 1500 }, "pdf": {}, "dxf": {} },
  "messages": []                    // harness notes / warnings
}
```

A reference is stale when `fixtureSha256`/`metaSha256` no longer match; the harness re-runs it.
