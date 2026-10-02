# DXF knowledge base

Notes collected from the DXF reference, reference libraries and their issue trackers.
They're the input for designing and implementing truedxf.

## Sources (local)

| Path | What |
|---|---|
| `research/spec/autocad_2012_dxf_reference.txt` | AutoCAD 2012 DXF Reference (pdftotext -layout of the official PDF). Often outdated or wrong. |
| `research/spec/OpenDesign_Specification_for_.dwg_files.txt` | ODA DWG spec. Useful for object semantics and fields the DXF reference leaves out. |
| `research/repos/ezdxf` | Python, MIT. Most complete reference. `docs/source/dxfinternals`, `src/ezdxf/entities`, `src/ezdxf/addons/drawing`, `src/ezdxf/render`, `src/ezdxf/fonts`, `src/ezdxf/tools/text.py`, `NEWS.md`/`notes` |
| `research/repos/dxf-viewer` | JS, MPL-2.0. WebGL (three.js) viewer: batching, text, hatch, linetypes |
| `research/repos/dxf-parser`, `three-dxf`, `dxf-json`, `bjnortier-dxf` | JS/TS parsers and viewers |
| `research/repos/mlightcad-*` | TS CAD viewer and data model (realdwg-web mimics the ObjectARX API) |
| `research/repos/ACadSharp` | C#, MIT. DXF+DWG reader/writer, `DxfCodeValue` attributes |
| `research/repos/netDxf` | C#, MIT |
| `research/repos/ixmilia-dxf`, `ixmilia-dxf-rs` | C# / Rust. **Machine-readable spec XML** (`spec/`), from which the code is generated |
| `research/repos/libredwg` | C, GPL. `src/dwg.spec`, `src/header_variables_dxf.spec`, `doc/` |
| `research/repos/libdxfrw`, `LibreCAD`, `qcad` | C++, GPL. LibreCAD/QCAD rendering, fonts (LFF/CXF), hatch patterns |
| `research/repos/gdal` (sparse) | OGR DXF driver + `doc/source/drivers/vector/dxf.rst` |
| `research/repos/FreeCAD` (sparse) | FreeCAD DXF importer |
| `research/github/raw/<owner>__<repo>/threads/*.md` | Dumped issues / PRs / discussions (grep these!) |

GPL code (libredwg, libdxfrw, LibreCAD, qcad) may be read for *facts* about the format,
but must never be copied into truedxf. Same for Autodesk material.

## Conventions for notes

- One file per topic, `NN-topic.md`. Written for an implementer: exact group codes, defaults,
  value ranges, units, and the algorithm AutoCAD uses where known.
- **Always cite sources**, e.g. `ezdxf:src/ezdxf/entities/mtext.py:123`, `spec p.142`,
  `ezdxf#1234` (issue), `dxf-viewer:src/parser/...`.
- Mark conflicts explicitly: **CONFLICT:** spec says X, ezdxf says Y (reason...).
- Mark confidence where it matters: **VERIFIED-BY-ACAD** (someone checked in AutoCAD, cite it),
  **ASSUMPTION**, **UNKNOWN / needs AutoCAD test** — the last feeds the test-generation backlog.
- End each note with a "Test ideas" list: small DXF files that would pin the behaviour down
  against AutoCAD.

## Index

| Note | Topic |
|---|---|
| [01-file-format](01-file-format.md) | Tagged format, group-code types, binary DXF, sections, versions, encodings, handles/ownership, XDATA, header variables, robust parsing, lossless reading |
| [02-tables-objects](02-tables-objects.md) | All tables (LAYER, LTYPE, STYLE, DIMSTYLE incl. sparse-imperial-defaults rule, VPORT, …), OBJECTS dictionaries and object types, reference resolution, model sketch |
| [03-entities-geometry](03-entities-geometry.md) | Common entity codes, OCS/arbitrary axis, every curve/polyline/solid entity, SPLINE math, wide polylines, tessellation, extents |
| [04-text-fonts](04-text-fonts.md) | TEXT/ATTRIB/ATTDEF/MTEXT, inline codes, layout (5/3 pitch, cap-height rule), SHX format & bytecode, TTF resolution, library survey (partly measured in AutoCAD 2027) |
| [05-dimensions-leaders](05-dimensions-leaders.md) | DIMENSION subtypes, `*D` blocks, DIMSTYLE vars & overrides, arrow geometry, LEADER, MULTILEADER, TOLERANCE |
| [06-hatch-linetype-appearance](06-hatch-linetype-appearance.md) | HATCH (paths, stored pattern lines, gradients), linetypes & fitting, ACI palettes, transparency, lineweights, CTB/STB, property resolution, draw order |
| [07-blocks-inserts-misc](07-blocks-inserts-misc.md) | Blocks, INSERT transform, inheritance, dynamic blocks, xrefs, XCLIP, IMAGE, WIPEOUT, UNDERLAY, MLINE, ACAD_TABLE, proxy graphics |
| [08-layouts-viewports-plotting](08-layouts-viewports-plotting.md) | Layouts, PLOTSETTINGS, VIEWPORT, plot pipeline, accoreconsole automation, reference-plot recipe |
| [11a-quirks-ezdxf-issues](11a-quirks-ezdxf-issues.md) | Findings mined from ezdxf issues/discussions |
| [11b-quirks-js-viewers-gis](11b-quirks-js-viewers-gis.md) | Findings from JS viewer + GDAL/QGIS/FreeCAD issues, what web-viewer users want |
| [11c-quirks-csharp-cpp-libs](11c-quirks-csharp-cpp-libs.md) | Findings from ACadSharp/netDxf/libdxfrw/LibreDWG/LibreCAD issues, what AutoCAD refuses, error-message catalogue |
