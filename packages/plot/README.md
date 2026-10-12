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
- `ACAD_CTB` and `MONOCHROME_CTB` reproduce the behaviour of the standard tables, which we
  cannot ship. `buildColorTable` / `buildNamedTable` create tables in code.

The DXF holds only the name of the style table, not its pens. The device resolution and the
registry sysvars (LWDEFAULT, PLOTTRANSPARENCYOVERRIDE, …) are not in the DXF either, so the
caller supplies them.

Not implemented yet: applying pens when rendering (screening, grayscale, pen choice for true
colours) and the page-setup to device transform. [@truedxf/render](../render) still takes the
plot area and canvas from its `PlotRequest` and emulates only `monochrome.ctb`.

See [research/notes/06-hatch-linetype-appearance.md](../../research/notes/06-hatch-linetype-appearance.md)
§6 (plot styles) and [08-layouts-viewports-plotting.md](../../research/notes/08-layouts-viewports-plotting.md)
§2 (PLOTSETTINGS).
