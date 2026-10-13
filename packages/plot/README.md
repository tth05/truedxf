# @truedxf/plot

CTB/STB plot styles and DXF page setups: pens, lineweights and plot transforms exactly as AutoCAD plots them.

## Install

```bash
pnpm add @truedxf/plot
```

ESM only. No DOM and no Node.js APIs: runs in browsers, workers and Node.

## What it does

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
  ACI (true colours and colour-book colours get none; gradients never use a pen), pen colour,
  grayscale, screening, pen lineweight, end/join style, fill style and linetype.
- `penLinetypeDashes` lays out the pen linetypes 1–30 along a run (fixed lengths on the sheet,
  fixed or adaptive mode); `fillStyleInk` gives the raster tiles of fill styles 65–72.
- `plotPlacement` maps drawing coordinates to the device: printable area (sheet minus margins),
  rotation, offset, 148/149, scale, fit and centring.

```ts
const placement = plotPlacement(setup, { unitsPerMm: 600 / 25.4 }); // raster setups: pixels
const [a, b, c, d, e, f] = placement.matrix; // X = a·x + c·y + e, Y = b·x + d·y + f (Y down)
```

The DXF holds only the name of the style table, not its pens. The device resolution, the plotted
area of extents/limits/display/view plots and the registry sysvars (LWDEFAULT,
PLOTTRANSPARENCYOVERRIDE, …) are not in the DXF either, so the caller supplies them.

[@truedxf/render](https://www.npmjs.com/package/@truedxf/render) uses all of this: pens while
drawing, and the placement for `PlotRequest.pageSetup`. STB style names are resolved per entity
by [@truedxf/model](https://www.npmjs.com/package/@truedxf/model) (390, 380).

## License

MIT. AutoCAD and DXF are trademarks of Autodesk, Inc. truedxf is not affiliated with or
endorsed by Autodesk.
