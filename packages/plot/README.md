# @truedxf/plot

Placeholder for plot settings: CTB/STB plot style tables, page setup to plot transform, lineweight to device units.

Not implemented: `src/index.ts` exports nothing. The plan is to
parse CTB/STB files (zlib-compressed text, hence the `fflate` dependency) and apply them by
resolved ACI, and to turn PLOTSETTINGS into the plot transform. Until then
[@truedxf/render](../render) takes the plot area and canvas from its `PlotRequest`, converts
lineweights itself and emulates only `monochrome.ctb`.

See [research/notes/06-hatch-linetype-appearance.md](../../research/notes/06-hatch-linetype-appearance.md)
§6 (plot styles) and [08-layouts-viewports-plotting.md](../../research/notes/08-layouts-viewports-plotting.md) §2 (PLOTSETTINGS).
