# @truedxf/plot

Plot settings: page setups (LAYOUT / PLOTSETTINGS) and CTB/STB plot style tables.

```ts
import { builtinPlotStyleTable, penForAci, readPageSetup, readPlotStyleTable } from "@truedxf/plot";

const setup = readPageSetup(layout.object); // area, scale, offset, style sheet name, flags
const table = setup.styleSheet
    ? (builtinPlotStyleTable(setup.styleSheet) ?? readPlotStyleTable(ctbBytes))
    : undefined;
const pen = table && penForAci(table, 1); // colour / lineweight (mm) / … or undefined = object
```

- `readPageSetup` interprets the stored plot settings: plot area, scale (standard scales, custom
  ratio or fit), paper and margins, offset and centering, style sheet name and the plot flags.
- `readPlotStyleTable` / `writePlotStyleTable` read and write .ctb/.stb files (PIA container,
  zlib text). The parsed tree is kept, so files round-trip.
- `builtinPlotStyleTable` returns equivalents of the stock tables, which we cannot ship
  (acad, monochrome, Grayscale, Screening 25/50/75/100 %, Fill Patterns; pen for pen identical
  to AutoCAD 2027's). `buildColorTable` / `buildNamedTable` create tables in code.
- `penForObject` + `applyPlotStyle` apply a pen as AutoCAD's PLOT does: the pen of the resolved
  ACI (true colours get none), pen colour, grayscale, screening, pen lineweight.

The DXF holds only the name of the style table, not its pens. The device resolution and the
registry sysvars (LWDEFAULT, PLOTTRANSPARENCYOVERRIDE, …) are not in the DXF either, so the
caller supplies them.

Not implemented yet: using the pens in the renderer, STB style resolution (380/390), CTB
linetypes and fill patterns, and the page-setup to device transform.
[@truedxf/render](../render) still takes the plot area and canvas from its `PlotRequest` and
emulates only `monochrome.ctb`.

See [research/notes/06-hatch-linetype-appearance.md](../../research/notes/06-hatch-linetype-appearance.md)
§6 (plot styles) and [08-layouts-viewports-plotting.md](../../research/notes/08-layouts-viewports-plotting.md)
§2 (PLOTSETTINGS).
