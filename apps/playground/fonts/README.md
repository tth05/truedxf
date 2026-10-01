# Fallback fonts of the public viewer

The deployed playground has no AutoCAD or Windows fonts. These free fonts are served next to our
test fonts (`packages/fonts/assets`) so text in drawings whose fonts are missing still reads well:

| Files | Font | Licence | Stands in for |
|---|---|---|---|
| `LiberationSans-*.ttf` | Liberation Sans 2.1.1 | SIL OFL 1.1 ([LICENSE-Liberation.txt](LICENSE-Liberation.txt)) | Arial (metric-compatible) |
| `LiberationSerif-*.ttf` | Liberation Serif 2.1.1 | SIL OFL 1.1 | Times New Roman (metric-compatible) |
| `LiberationMono-*.ttf` | Liberation Mono 2.1.1 | SIL OFL 1.1 | Courier New (metric-compatible) |

Source: the unmodified `liberation-fonts-ttf-2.1.1` release
(<https://github.com/liberationfonts/liberation-fonts>). The OFL allows bundling and
redistributing the fonts with software as long as the licence travels with them and they are not
sold on their own; the build copies `LICENSE-Liberation.txt` to `fonts/`.

`src/fonts.ts` maps the Windows file names (`arial.ttf`, `timesbd.ttf`, `cour.ttf`, …) to these
files when the real font is not available, and the viewer's fallback list ends with
`LiberationSans-Regular.ttf` for every other missing font (SHX fonts included).
