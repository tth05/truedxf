# 10 — Survey of existing DXF libraries (architecture, limitations, what to borrow)

This survey covers the libraries cloned under `research/repos` and informs truedxf's package design. It is written for the people designing truedxf: how each library parses, models and renders DXF, where each one falls short of AutoCAD PLOT output, and what we should copy or avoid.

**Method.** Each library was read in its own clone. Citations are `repo:path:line`. Issue and PR numbers come from the `research/github/raw/<owner>__<repo>/threads` dumps and are written as `ezdxf#1234`. Licences and versions were checked with `npm view` and the GitHub API on 2026-09-30. Star counts and push dates are from `gh api repos/...`. All clones are shallow single commits, so there is no git history to go on.

**GPL notice.** libredwg, libdxfrw, LibreCAD, QCAD and dxf-json are GPL. This note describes their *architecture and facts only*. No code or tables from them may enter truedxf.

Contents
1. ezdxf (Python) is the baseline to beat
2. dxf-viewer (JS)
3. dxf-parser and three-dxf (JS)
4. dxf-json (TS)
5. bjnortier `dxf` (JS, SVG output)
6. mlightcad realdwg-web and cad-viewer (TS)
7. ACadSharp (C#)
8. netDxf (C#)
9. ixmilia dxf (C#) and dxf-rs (Rust), with an evaluation of their spec XML
10. libdxfrw (C++)
11. LibreCAD renderer (C++)
12. QCAD renderer (C++)
13. libredwg (C)
14. GDAL OGR DXF driver (C++)
15. tarikjabiri/dxf (TS writer)
16. Synthesis: comparison table, adopt/avoid list, recommended package architecture, npm dependencies, deterministic headless rendering
17. Open questions and test ideas

---

## 0. TL;DR

- **No library in this set tries to match AutoCAD PLOT output**, and several say so explicitly:
  - ezdxf#335, ezdxf#1390 ("no intent to be a 100% correct DXF/MTEXT renderer"), ezdxf#1410 ("will never … render like AutoCAD").
  - dxf-viewer uses the *Autodesk online viewer* as its visual reference (`dxf-viewer:README.md:90-106`).
  - No project has image regression tests against AutoCAD output. The closest are:
    - dxf-viewer's scene-dump goldens.
    - ACadSharp's comparison with an AutoCAD object-tree dump.
    - mlightcad's coarse pixel-colour counts in Playwright.
- **Nobody does these things properly, so truedxf has to build them from scratch:**
  - Linetypes with AutoCAD dash placement:
    - PLINEGEN
    - PSLTSCALE
    - complex linetypes with shapes and text
  - Plot styles:
    - CTB/STB
    - screening
    - end and join styles
  - Page-setup semantics:
    - plot area
    - scale
    - offset
    - centring
  - Viewports with:
    - non-rectangular clipping
    - VP layer freeze and overrides
    - correct draw order
  - SHX fonts with BIGFONT.
  - TTF metrics as AutoCAD computes them.
  - Deterministic hatching.
  - A lineweight-to-device-pixel rule.
- **Nobody keeps data losslessly.** No library keeps unknown group codes *inside* known entities through a write. These do slightly better:
  - ezdxf keeps whole unknown entities (`DXFTagStorage`).
  - ixmilia keeps all 102 groups and the `ExcessCodePairs`, but does not write the excess back.
  - libdxfrw has "raw carriers" (experimental).

  truedxf's model should be a typed view over a lossless tag store.
- **Best references by concern:**

  | Concern | Reference |
  |---|---|
  | Parse, recover, model semantics | ezdxf |
  | Property resolution | ezdxf `properties.py`, QCAD `REntityData` |
  | Hatch pattern clipping | dxf-viewer `HatchCalculator`, ezdxf `render/hatching.py` |
  | Batching and instancing for WebGL | dxf-viewer, mlightcad |
  | Renderer-agnostic primitive interface | mlightcad `AcGiRenderer`, QCAD `RExporter`, ezdxf `BackendInterface` |
  | Codegen seed | ixmilia spec XML (MIT) plus the subclass partition from ACadSharp `[DxfCodeValue]` attributes (MIT) |
  | Coverage checklist | libredwg dynapi (GPL, facts only) |
  | Test corpus method | ACadSharp's AutoCAD-generated multi-version samples plus a LISP dump |

- **Licensing traps on npm:**
  - `dxf-json` is **GPL-3.0**.
  - `@mlightcad/libredwg-web` and `libredwg-converter` are **GPL-3.0**.
  - three-dxf depends on the GPL-3 `@dxfom/mtext` (three-dxf#97).
  - dxf-viewer is MPL-2.0. Its hatch patterns come from QCAD (`dxf-viewer:src/patterns/index.js` header). QCAD patterns are GPL or CC, so check their licence before copying.

---

## 1. ezdxf (Python, MIT). The baseline to beat

| | |
|---|---|
| Version | 1.4.5b1 (`ezdxf:src/ezdxf/version.py`), commit dated 2026-09-30. Recent releases: 1.4.4 (2026-05-14), 1.4.3 (2025-10), 1.4.0 (2025-03) (`ezdxf:notes/pages/CHANGELOG.md`) |
| Size | About 144k LOC in `src/ezdxf`, about 290 .rst docs (42k lines), 1,452 stars, 22 open issues |
| Maintainer | Essentially one person (mozman), with community PRs on viewports, clipping and hatch transforms in 2025–26 |
| Dependencies | numpy, fontTools, pyparsing, typing_extensions (`pyproject.toml:28-32`). Optional Cython `acc/` |

### 1.1 Parse approach

ezdxf parses in layers. The layering is sound and truedxf should copy it.

1. **Tokenizer.**
   - `ascii_tags_loader` (`ezdxf:src/ezdxf/lldxf/tagger.py:88`) is a readline loop over `(code, str)`. It drops 999 comments and stops at `0/EOF`.
   - `binary_tags_loader` (`tagger.py:134`):
     - Checks the sentinel `AutoCAD Binary DXF\r\n\x1a\0`.
     - Sniffs `$ACADVER` and `$DWGCODEPAGE` in the first 1 KB.
     - R12 files use 1-byte group codes, with 255 as the escape to a 2-byte code (`tagger.py:203-208`).
   - The profiling note at `tagger.py:69-85` says byte-level reading does not pay off in Python. In JS it does (see §16.3).
2. **Tag compiler.**
   - `tag_compiler` (`tagger.py:249`) casts values by group-code range (`lldxf/types.py:80-151`).
   - It merges x/y/z into `DXFVertex`, whose y code is x+10 and z code x+20 (`types.py:280-295`). The point codes are listed in `POINT_CODES` (`types.py:31`).
   - Binary codes 310–319 and 1004 become `DXFBinaryTag`.
3. **Structure loader.** `load_dxf_structure` (`lldxf/loader.py:21`) builds `{section: [Tags per entity]}`. It is strict and raises `DXFStructureError` on bad structure. Duplicate handles only produce a warning (`loader.py:150`).
4. **ExtendedTags.**
   - `lldxf/extendedtags.py:25` splits each entity into subclasses (a list, because TEXT has `AcDbText` twice), app data, xdata and embedded objects (R2018 MTEXT columns).
   - App data is replaced in place by a placeholder `DXFTag(102, index)`, so its position survives (`extendedtags.py:152-183`).
5. **Recover mode** (`ezdxf:src/ezdxf/recover.py`), a separate, tolerant pipeline:
   - It is byte-based.
   - Integer parsing is stoll-style (`_search_int`, `recover.py:535`).
   - It resyncs to the next valid group code.
   - It detects the encoding anywhere in the file.
   - Repair filters (`lldxf/repair.py`):
     - QCAD's x1,x2,y1,y2 point order
     - invalid point codes
     - invalid handles
   - It rebuilds sections (`recover.py:213`), rescues header variables found outside HEADER, and recovers the root dictionary.
   - **Only the recover path decodes `\U+XXXX` and `\M+` MIF escapes** (`recover.py:843-847`, ezdxf#1063). MIF escapes split across two tags are not decoded (ezdxf#1322).
6. **Streaming.**
   - `addons/iterdxf.py` builds a file index of code-0 offsets (`lldxf/fileindex.py:17`) and loads entities on demand. `single_pass_modelspace` handles streams that cannot seek.
   - There is no document context, so table references cannot be resolved.
7. **Encoding.**
   - R2007 and later are UTF-8. Older files use the codepage (`tools/codepage.py:83`).
   - Text is read with `errors="surrogateescape"`, which keeps undecodable bytes.
   - The writer's `dxfreplace` error handler emits `\U+XXXX` for characters it cannot encode (`lldxf/encoding.py:12`).

### 1.2 Data model

- **Schema.**
  - Every entity declares `DefSubclass(name, {attr: DXFAttr(code, xtype, default, optional, dxfversion, validator, fixer)})` (`lldxf/attributes.py`). Example: `ezdxf:src/ezdxf/entities/line.py:30-83`.
  - Values live in `DXFNamespace`:
    - Unset attributes fall back to the default (`entities/dxfns.py:124`).
    - Setting an attribute validates, fixes and casts it (`dxfns.py:143`).
  - Export writes attributes in an explicit order per entity (`line.py:70-83`).
- **Loading.**
  - A factory keyed by `DXFTYPE` creates entities (`entities/factory.py:41-79`).
  - Loading happens in two stages. `post_load_hook(doc)` resolves handles and may return a deferred callable that runs after the whole document is set up (`document.py:475`).
  - Full load order (`document.py:375-472`):
    - header
    - encoding
    - handle seed
    - bind entities
    - classes and tables
    - blocks, entities, objects, ACDSDATA
    - unmanaged sections kept raw as `StoredSection`
    - second loading stage
    - version upgrades: R13 and R14 become R2000 (`document.py:444-455`)
    - root dictionary and layouts
- **Unknown data.**
  - Unknown *entities* are kept verbatim by `DXFTagStorage` (`entities/dxfentity.py:971`). They are written back unchanged, and their proxy graphics can still be rendered.
  - Unknown *tags inside known entities* are **dropped** (`fast_load_dxfattribs`, `dxfns.py:495`). They are only logged, and only with `log_unprocessed_tags`.
  - XDATA, app data, reactors and the extension dictionary are all kept (`dxfentity.py:385`).
- **Handles.**
  - `EntityDB` is a `dict[handle, entity]` with a trashcan (`entitydb.py:36`).
  - The handle seed comes from `$HANDSEED`.
- **Round-trip.**
  - Unknown entities: exact.
  - Known entities: normalized, with tag order re-emitted from the schema.
  - Floats: exact, because Python `repr` is shortest round-trip.
  - 999 comments: lost.
  - Version downgrade only logs a warning. The real R12 conversion is `addons/r12export`.
  - Recent round-trip bug: the MTEXT embedded object's code 70 was always written as 1 (ezdxf#1416, PR #1417).
- **Auditor.** `audit.py:117`, including a block-cycle detector (`audit.py:504`).

### 1.3 Drawing add-on (`src/ezdxf/addons/drawing`)

This is the most complete open DXF renderer. It is the thing truedxf has to beat.

**Pipeline.**

```
Frontend (frontend.py:108/947) — property resolution + decomposition to primitives
  → RenderPipeline2d (pipeline.py:183): ClippingStage2d → LinetypeStage2d → BackendStage2d
  → BackendInterface (backend.py:66): draw_point/line/solid_lines/path/filled_paths/filled_polygon/image
```

- Linetypes, hatch patterns and text are all turned into geometry *before* the backend. Backends only ever see solid strokes and fills (even-odd). This design choice is the right one for truedxf.
- Geometry travels as `NumpyPath2d`: float64 vertices plus a command array covering lines and quadratic/cubic Béziers (`npshapes.py:123`).
- `BackendProperties` carries color, lineweight in mm, layer, pen and handle (`properties.py:175`).

**Frontend.**

- **Dispatch table.** `frontend.py:181-204`. INSERT, DIMENSION, LEADER, MLEADER, ACAD_TABLE, MLINE and proxies go through `virtual_entities()`.
- **Blocks are expanded, never instanced.** Each INSERT deep-copies and transforms every block entity (`frontend.py:881-926`). This is a known hot spot.
  - MINSERT is supported.
  - XCLIP pushes a clipping portal. The clip region can be convex, concave or inverted (`tools/clipping_portal.py:445-475`).
  - ATTRIBs are drawn after the block content (ezdxf#1321).
- **DIMENSION** draws the anonymous `*D` block. If the block is missing, nothing is drawn (`entities/dimension.py:772-827`).
- **Draw order.**
  - Follows SORTENTSTABLE if present, else layout storage order (`frontend.py:298-308`). The docstring's "ascending handle order" is wrong.
  - VIEWPORT content is drawn *after* all paperspace entities (`frontend.py:1044-1069`). PR #1320, which would have drawn viewports in order, was rejected.
  - Viewport borders are not drawn.
- **XLINE and RAY** get a fixed length of 20 (`frontend.py:399-407`).
- **POINT** with a relative pdsize is forced to 1 unit (`frontend.py:147-149`).
- **WIPEOUT** is filled with the background colour instead of masking (`frontend.py:672-677`).
- **OLE2FRAME** is drawn as a grey rectangle.
- **Wide polylines** are converted to polygons by `TraceBuilder`. Precision is poor for zero-width and varying-width segments (ezdxf#1352).

**Viewports** (`pipeline.py:261-306`).

- Top view only.
- Twist is supported.
- Non-rectangular clip paths are supported, flattened with a sagitta of 0.1 mm.
- Modelspace entities are culled with a bbox cache and iterated in storage order, so redraw order is not applied inside viewports.
- Nested viewports are not supported.
- Linetype scale is hard-wired to `1/vp_scale`, which is PSLTSCALE=1 (`pipeline.py:214-218`, ezdxf#1386).
- Layer freeze and per-viewport layer overrides are honoured (`properties.py:446-491`).

**Property resolution.** This is a good reference. `RenderContext`, `resolve_all` at `properties.py:626-884`.

- Order: layer → units → colour → pen → linetype → lineweight → ltscale → visibility → font → filling.
- An entity on layer "0" inside a block takes the INSERT's layer (`properties.py:678-685`).
- Colour:
  - True colour beats ACI.
  - BYBLOCK takes the INSERT's colour.
  - ACI 7 means the foreground colour.
  - Layer transparency goes into the alpha channel.
- Default lineweight is **hard-coded at 0.25 mm**. `$LWDEFAULT` is not read, and neither is `$LWDISPLAY` (`properties.py:886-889`).
- **CTB bug** (code-inferred): the CTB lineweight is applied only when the entity's *own* ACI is 1..255 (`properties.py:842-884`). BYLAYER-coloured entities therefore never get their CTB lineweight.
- `acadctb.py` parses the full CTB (screening, dither, grayscale, end/join/fill style), but the drawing add-on uses **only colour and lineweight**.
- STB files are parsed but unused.

**`Configuration`** (`config.py:187-277`, frozen dataclass).

| Group | Options |
|---|---|
| Policies | `line_policy`, `hatch_policy`, `proxy_graphic_policy`, `color_policy`, `background_policy`, `lineweight_policy` (ABSOLUTE / RELATIVE), `text_policy`, `image_policy` |
| Lineweight | `lineweight_scaling`, `min_lineweight` (in 1/300 inch) |
| Limits and tolerances | `min_dash_length` = 0.1 drawing units (distorts dots), `max_flattening_distance`, `circle_approximation_count` = 128, `hatching_timeout` = 30 s, `min_hatch_line_distance` |
| Other | `infinite_line_length`, `show_defpoints` |

The shape is useful as a model for truedxf's own render options. truedxf should replace the time-based limits with deterministic ones (§16.5).

**Lineweight to pixels, per backend.** It is inconsistent:

- matplotlib passes the mm value *as points*, with butt caps (`matplotlib.py:74-107,154`).
- PyQt uses a cosmetic pen, `lw/0.3527` px.
- SVG uses round caps and joins in a 1e6-unit integer space (`svg.py:189-277`).
- PyMuPDF uses `w*72/25.4` pt.

**Page and layout** (`layout.py:223`). `Page.from_dxf_layout` reads only paper size, margins and rotation. None of these is implemented:
- plot area type (window, extents, limits, layout)
- plot origin
- standard scale
- centring
- `$PLOTSTYLEMODE`

The render box defaults to the recorded content bbox.

**Text** (`text.py`, `unified_text_renderer.py`, `mtext_complex.py`).

- **Height and spacing.**
  - Height is treated as cap height.
  - MTEXT line spacing is `cap_height*5/3*factor` (`text.py:52,151-157`).
- **Ignored or skipped.**
  - **TEXT oblique (group 51) is ignored** on the simple path.
  - 3D text is skipped (`frontend.py:443-455`).
  - Vertical text is drawn horizontally.
- **Complex MTEXT** supports:
  - paragraphs
  - tabs
  - stacking
  - columns
  - background fill
  - inline font, height and colour changes

  The docs say "close to AutoCAD but not pixel perfect" (`docs/source/addons/drawing.rst:43`).
- **Known MTEXT problems.**
  - ezdxf#1390: `\pi` indents are double-scaled.
  - ezdxf#1389: no CJK line breaking.
  - ezdxf#1351: style width and line-spacing factors are ignored.
  - ezdxf#749: tabs are only partly supported.
- **Empirical AutoCAD rules** are collected in `ezdxf:docs/source/dxfinternals/rendering_of_dxf_content.rst`. It is valuable and should be cross-referenced by the text note.

**Hatch** (`ezdxf:src/ezdxf/render/hatching.py`).

- Pattern lines are intersected with the *exact* Bézier boundary. Intersections are bucketed by rounded distance and paired as in/out (`hatching.py:495-592`).
- **Non-deterministic:** `jiggle_origin=True` shifts pattern origins by a *random* 0.03–0.1 % of the mean offset (`hatching.py:655-700`). ezdxf#1237 reports PNG bytes that differ run to run.
- A hatch that is too dense falls back to a solid fill, and there is a timeout per entity.
- **Gradients are rendered as a solid fill** in the entity colour (`properties.py:150-154`).
- Pattern transform bugs were fixed in 1.4.5: ezdxf#1391, ezdxf#1399, ezdxf#1392, ezdxf#1402.

**Linetypes** (`pipeline.py:559-650`, `render/_linetypes.py`).

- Pattern scale = `ltscale*$LTSCALE/vp_scale`.
- Paths are flattened, then dashed. The phase is **continuous across all vertices and always starts at the start point**: PLINEGEN-like behaviour for everything, with no per-segment restart and no AutoCAD dash adjustment.
- Complex linetypes are not supported (`entities/ltype.py:246`, ezdxf#1070, ezdxf#809).
- ezdxf#1411: the linetypes bundled with ezdxf differ from `acad.lin`.

### 1.4 Fonts (`src/ezdxf/fonts`)

- **TTF.**
  - `ttfonts.py` uses fontTools.
  - Scale = requested cap height / bbox top of "A". x-height comes from "x" and descender from "p" (`ttfonts.py:97-110`).
  - Missing glyphs are drawn as `.notdef`.
  - There is **no per-glyph fallback font**, **no shaping** and no BiDi (ezdxf#1387, ezdxf#1259, ezdxf#1271).
  - Kerning is off by default (`fonts.py:561`).
- **SHX** (`shapefile.py`).
  - Full SHP and SHX parser: shapes 1.0/1.1 and unifont.
  - **BIGFONT raises `UnsupportedShapeFile`** (`shapefile.py:320-321`; ezdxf#1376 hztxt.shx, ezdxf#970).
  - Characters are mapped by Unicode codepoint, which gives wrong glyphs for codepage SHX fonts above 127.
- **Resolution.**
  - `resolve_shx_font_name(order="tsl")` tries an Autodesk TTF substitute, then a real .shx in `support_dirs`, then LibreCAD .lff (`fonts.py:32-74,160`).
  - `FontManager` scans system directories and caches the result as JSON.

### 1.5 Testing, performance, docs

- **Tests.**
  - About 362 pytest files in numbered groups (`ezdxf:tests/`).
  - Tests use only fonts from the repo, so metrics are deterministic.
  - Drawing tests are *structural*: a `BasicBackend` records primitives and the tests assert on them.
  - **No image comparisons.** Validation is by eye against BricsCAD and TrueView screenshots posted in issues (ezdxf#324, ezdxf#865).
  - `integration_tests/`: 55 files.
  - `examples_dxf/`: 60 generated fixtures with their generator scripts. They are good seeds for our AutoCAD corpus.
- **Performance.**
  - Optional Cython versions of vector, matrix, bezier, bspline, earcut and linetypes (`acc/*.pyx`).
  - Batch transforms on numpy arrays.
  - Caches for bboxes, glyphs and patterns.
  - Known hot spots: INSERT deep-copy, dense hatches (ezdxf#699, ezdxf#1275), MTEXT layout.
- **Docs.** Excellent. The DXF internals chapters, concept pages and how-tos are the best free DXF documentation available.

### 1.6 ezdxf summary for truedxf

| Adopt | Replace |
|---|---|
| Layered parsing (tokenizer, compiler, structure, ExtendedTags) | Drop of unknown tags inside known entities |
| Separate recover mode | Escape decoding only in recover mode (truedxf should always decode, at the text layer) |
| Two-stage load with deferred hooks | Block expansion by deep copy |
| `DXFTagStorage` for unknown entities | Random hatch jiggle and time-based limits |
| Frontend / pipeline / backend split, backends that see only strokes and fills | Continuous-phase dasher |
| `properties.py` rules | CTB lineweight bug, lack of page-setup and plot semantics |
| TTF cap-height rule as a starting point | Font engine without BIGFONT |

---

## 2. dxf-viewer (vagran; JS, MPL-2.0)

| | |
|---|---|
| Version | 1.0.49 (npm and `package.json`), last commit 2026-09-21, 575 stars, 29 open issues |
| Dependencies | `three ^0.186`, `opentype.js ^1.3.4`, `earcut ^3`, `loglevel` |
| Size | About 13.7k LOC: `DxfScene.js` 3,076, `TextRenderer.js` 1,496, `DxfViewer.js` 1,154, parser about 2.9k |
| Types | Hand-written `index.d.ts` for the API only. The parsed model is untyped: `tsc --checkJs` reports about 175 errors (`test/README.md`) |

**Pipeline.** DxfFetcher → DxfParser → DxfScene (packed ArrayBuffers) → DxfViewer (three.js). The first three stages can run in a Web Worker.

**Missing features, by the author's own list** (`dxf-viewer:README.md:45-86`):
- no streaming
- text styles ignored
- most MTEXT codes ignored
- **no linetypes**: everything is continuous
- **no wide polylines**
- no INSERT grid arrays
- only linear dimensions
- no leaders
- `$DWGCODEPAGE` ignored
- OCS only for ±Z extrusion
- **no paper space, layouts or viewports**

### 2.1 Parser (`src/parser`, forked from dxf-parser)

- **Not streaming.**
  - The fetch body is decoded into one string (`DxfFetcher.js:33-51`, "XXX streaming parsing is not supported").
  - The string is then split into lines with `split(/\r\n|\r|\n/g)` (`DxfParser.js:106-108`).
  - File size is therefore capped by the maximum JS string length.
- **Scanner.**
  - `DxfArrayScanner` provides `next`, `peek` and `rewind`.
  - Values are typed by group-code range (`DxfArrayScanner.js:116-190`).
- **Sections.**
  - Parsed: HEADER, TABLES (VPORT, LTYPE, LAYER, DIMSTYLE, STYLE only), BLOCKS, ENTITIES.
  - **CLASSES and OBJECTS are skipped** (`DxfParser.js:149`).
- **Missing fields.**
  - LAYER linetype (6), lineweight (370) and plot flag (290) are not parsed.
  - LTYPE shape and text elements are not parsed (`DxfParser.js:552-670`).
- **Entities.**
  - Each has a handler class with a `switch(curr.code)`. Common properties go through `checkCommonEntityProperties` (`ParseHelpers.js:77-145`).
  - About 17 entity types are handled. Unknown entities are skipped (`DxfParser.js:842-853`).
- **XDATA and handles.**
  - XDATA becomes a lossy nested object (`ExtendedDataParser.js`).
  - Entities without a handle get a sequential number.
  - There is no handle index. **Round-trip is impossible.**

### 2.2 DxfScene: entities to batches

- **Primitive types.**
  - Entities decompose into internal `Entity` objects: POINTS, LINE_SEGMENTS, POLYLINE or TRIANGLES (`DxfScene.js:2897-3013`).
  - Tessellation is fixed when the scene is built:
    - arcs: 10° per segment, at least 8 segments (`:3053-3061`)
    - splines: 4 samples per control point in uniform t; fit-point-only splines are skipped (`:2039-2160`)
- **Blocks.**
  - Each block definition is built once, in block coordinates relative to its *first vertex* (a float32 precision trick, `BlockContext.TransformVertex`, `:2762-2782`).
  - Nested INSERTs are **flattened into the parent definition**, with cycle detection.
  - Only top-level INSERTs are instanced.
  - A block is flattened rather than instanced when `useCount==1 || useCount*vertices <= 1024` (`Block.SetFlatten`, `:2668-2679`).
  - Instances push a 3×2 affine matrix (`:2483-2490`).
  - The INSERT transform is 2D only. Grid arrays (70/71/44/45) and Z scale are ignored (`:1725,1736`).
- **Batching.**
  - Batches are keyed by `BatchingKey(layer, blockName, geometryType, color, lineType)` in a red-black tree (`BatchingKey.js`, `RBTree.js`).
  - **Draw order is therefore key order, not DXF order.** SORTENTS is not supported. This matters for fills and wipeouts.
  - Indices are 16-bit, in 64K-vertex chunks packed best-fit. Longer polylines are split with a one-vertex overlap (`:2498-2519,2936-3003`).
- **Colour.**
  - BY_LAYER (-1) and BY_BLOCK (-2) sentinels inside blocks are resolved at instancing or flattening time (`:2270-2322,3045`).
  - Top-level BYBLOCK becomes white.
  - Layer-0 inheritance is only approximated: entities with no layer inherit, but an explicit `8/0` does not.
- **Serialization and precision.**
  - `_BuildScene` produces three transferable ArrayBuffers (Float32 xy vertices, Uint16 indices, Float32 transforms) plus a batch list (`:2405-2458`).
  - A global scene `origin` (the first vertex) is subtracted from everything. That is a single global origin, not one per tile.
- **Lineweight.** Group 370 is parsed and **never used**. Linetype lookup always returns 0 (`:391-401`).

### 2.3 Worker, viewer and shaders

- **Worker.**
  - `DxfWorker.js` is an RPC over `postMessage` with sequence numbers.
  - Fetch, parse, font loading and scene build all happen in the worker.
  - It **transfers** the three buffers (`DxfWorker.js:85-87`). The batch list is structured-cloned.
- **Viewer.**
  - `WebGLRenderer({depth:false})` with an orthographic camera.
  - Custom GLSL3 `RawShaderMaterial` per instance type (NONE / FULL / POINT). The vertex shader applies `mat2*pos+vec2` from instance attributes (`DxfViewer.js:734-805`).
  - **Lines are GL_LINES, always 1 px** (`:1038-1041`).
  - Materials are cached per colour.
  - `ColorTransform` does black/white inversion against the background. It is not CTB.

### 2.4 Text, hatch, dimensions

- **Text** (`TextRenderer.js`).
  - opentype.js only. **No SHX**, and STYLE font names are ignored.
  - Fonts are a lazy fallback chain: the next font is fetched only when a glyph is missing (`:157-200`).
  - Glyphs are triangulated once at size 1 (`ShapeUtils.triangulateShape`) and cached per character. The font unit comment says "XXX not really clear what is the resulting unit" (`:389-451`). A Korean sample produces 82,729 triangles.
  - Honoured: kerning, width factor, 72/73 alignment.
  - Ignored: oblique, backward, upside-down.
  - MTEXT layout does word wrap with CJK rules.
  - `MTextFormatParser.js` ignores `\f \H \W \Q \T \A \L \O \K \c`.
- **Hatch** (`HatchCalculator.js`). The analytic line clipper is well done:
  - For each pattern line family, parallel lines are generated across the bbox.
  - Each line is intersected with every boundary edge and the parameters are sorted.
  - Segments are emitted by odd-parity toggling. Vertex hits use a margin of 1e-6 of the diagonal, plus same-side tests for tangents (`:36-316`).
  - Dashes are then applied along each segment.
  - Solid fills use earcut.
  - 20k line and segment caps guard against runaway files.
  - The embedded pattern definition lines are used without an extra seed or angle transform (`DxfScene.js:1281-1288`).
  - 245 bundled .pat patterns, taken from QCAD.
- **Dimensions.** `LinearDimension.js` is used only when the `*D` block is missing, and places text naively.

### 2.5 Testing (the best JS test design here)

- `node --test` with 47 generated fixture DXFs.
- **Scene-dump goldens** go through a DOM-free `SceneReader.js`.
- **Invariants:**
  - A translated drawing gives the same geometry, shifted.
  - An exploded block gives the same output as the instanced block.
  - Hatch lines stay inside their boundary.
  - 64K chunking works.
- Validator mutation tests.
- A synthetic test font with rectangle glyphs.
- An `npm run svg` debug renderer.
- A private corpus of proprietary drawings for smoke tests (`dxf-viewer:test/README.md`).

**Summary for truedxf.**
- **Adopt:**
  - worker with transferable buffers
  - block definitions built once, in local coordinates
  - flatten-vs-instance heuristic
  - deferred BYLAYER/BYBLOCK sentinels
  - analytic hatch clipper design
  - scene-dump goldens and metamorphic invariants
- **Avoid:**
  - whole-string split
  - untyped model
  - batch-key draw order
  - 1 px GL lines
  - fixed tessellation

---

## 3. dxf-parser and three-dxf (gdsestimating; JS/TS, MIT)

**dxf-parser.**
- Version 1.1.2, last commit 2023-03-15, 558 stars, 42 open issues.
- It is the upstream of dxf-viewer's parser, with the same scanner, `split()` and handler map.
- Tables: VPORT, LTYPE, LAYER only. OBJECTS and CLASSES are skipped (`dxf-parser:src/DxfParser.ts:229-258,745-760`).
- Has MULTILEADER (`entities/mleader.ts`). Has no HATCH or ATTRIB.
- Typing is shallow interfaces.
- XDATA handles 1000/1001 only.
- Tests are mocha + approvals over 12 DXFs.
- Effectively unmaintained.

**three-dxf.**
- Version 1.3.1, last commit 2021-10-21. The author points users to dxf-viewer (three-dxf#45).
- Architecture:
  - One `Viewer` in 809 lines, creating **one three.js object per entity** (`three-dxf:src/index.js:86-228`).
  - Blocks are rebuilt for every INSERT (`:620-646`).
  - White is forced to black. BYBLOCK/BYLAYER are not resolved properly.
  - A dashed-line shader is built but never used (`:660-746`).
- Issues from the dump:
  - Memory: three-dxf#5, #30, #99 (a 6 MB file needs 2.5 GB, versus 200 MB in dxf-viewer).
  - Draw calls: three-dxf#11.
  - Float precision in blocks: three-dxf#24.
  - OCS: three-dxf#23, #47, #92.
  - Curves:
    - #8: Inventor arcs.
    - #18: rational splines drawn with weights ignored.
    - #34 and #64: spline and bulge artefacts.
  - Frozen layers shown: three-dxf#86.
  - GPL contamination through `@dxfom/mtext`: three-dxf#97.
- Lesson: every performance problem here comes from per-entity scene objects and a synchronous parse.

---

## 4. dxf-json (dotoritos-kim; TS, **GPL-3.0**)

- **Versions.** npm 0.14.1; repo `package.json` 1.0.0 (unreleased); last merge 2026-07-02; 130 stars.
- **Licence.** GPL-3.0 (`dxf-json:LICENSE`, `package.json` `"license": "GPL-3.0"`). **It must not become a dependency or a code source.**
- **Parse.**
  - `parseBuffer` detects ASCII vs **binary DXF** and decodes with a configurable encoding (`src/parser/shared/binaryDxf.ts`).
  - `DxfStreamParser` fills only HEADER, so streaming is not real.
  - Sections: HEADER, CLASSES, TABLES (all 9), BLOCKS, ENTITIES (about 38 types), OBJECTS (LAYOUT, PLOTSETTINGS, DICTIONARY, SPATIAL_FILTER, IMAGEDEF, MLEADERSTYLE, …) and THUMBNAILIMAGE.
- **Declarative "snippet" engine** (`src/parser/shared/parserGenerator.ts`). The pattern is worth knowing, though the code must not be copied:
  - Each type is a list of `{code|codes, name: "dotted.path", parser, isMultiple, pushContext}`.
  - Snippets used once are popped after they match, so a repeated code goes to the next snippet.
  - `pushContext` separates code collisions between subclasses. Example: DIMENSION code 40 is both leader length and DIMSCALE (`entities/dimension/parser.ts:213`).
  - Parsing stops at the first code that matches no snippet. **That drops data.**
- **Model.**
  - Discriminated union with literal `type`.
  - `CommonDxfEntity` covers 410 layout, 420/430/440, 370, 380/390, proxy graphics and structured XDATA.
  - `extensions` keeps the raw 102 groups.
  - The header is essentially untyped (a 21-line type).
  - No writer, no handle graph.
- **Tests.** Vitest with 37 files and snippet fixtures, plus JSON snapshot integration tests.
- **Verdict.** The most complete typed JS parser, but we can learn from its design only, never take its code.

---

## 5. bjnortier `dxf` (now skymakerolof/dxf; JS, MIT)

- **Versions.** 5.3.1 (CHANGELOG 2025-09-01), 402 stars. Dependencies: lodash and vecks.
- **Parse.** Lines → `[code, value]` tuples → per-section reducers (`bjnortier-dxf:src/parseString.js`). Values are typed coarsely. The fields are flat (`x`, `scaleX`, `extrusionZ`).
- **`denormalise`** (`src/denormalise.js`) expands INSERTs into cloned entities with a `transforms[]` stack.
  - **Supports MINSERT arrays.** Row and column offsets are rotated by the insert rotation but not scaled (`:17-33`). This rule should be verified in AutoCAD.
  - **Bug:** the INSERT's layer is unconditionally written onto every block entity (`:47`). It should only replace layer "0".
  - No BYBLOCK colour.
- **`toSVG`** (`src/toSVG.js`):
  - Uses native `<circle>`, `<ellipse>` and arc paths.
  - Non-rational degree-2 and degree-3 splines become exact Béziers via knot insertion (`util/toPiecewiseBezier.js`).
  - Uses nested `<g transform>` and a Y flip.
  - Stroke width is `0.1%`.
  - **No text, hatch, linetype or lineweight.**
  - Mirror flips are applied per type by trial and error (`addFlipXIfApplicable`).
- **Tests.** Mocha, about 37 files, 66 DXFs in `test/resources`.
- **Lesson.** The exact spline-to-Bézier conversion is right for SVG and PDF backends. Keep curves as curves as long as possible.

---

## 6. mlightcad realdwg-web and cad-viewer (TS, MIT; parts GPL and Apache)

| | |
|---|---|
| Size | realdwg-web about 134k LOC (data-model 86k). cad-viewer about 250k LOC |
| Activity | Both committed 2026-09-30. cad-viewer: 1,092 stars, PR #688 |
| Tooling | pnpm, nx, changesets, versions kept in lock-step |
| Licences | MIT for data-model, geometry-engine, graphic-interface, common and all cad-viewer packages |
| Licence exceptions | `emf-converter` is **Apache-2.0**. `libredwg-converter` and `@mlightcad/libredwg-web` are **GPL-3.0** |

The geometry-engine's math classes are "'stolen' from THREE.js by modifying their class name" (`mlightcad-realdwg-web:README.md:140`), so three.js attribution applies.

**Business model.** `PROPRIETARY-PARSER.md`:
- A closed-source DWG converter sells for $3,000 perpetual plus $1,500/yr.
- The GPL LibreDWG build is isolated in a separate worker bundle that talks over `postMessage`.

**Fonts.** They default to a jsDelivr CDN (`gh/mlightcad/cad-data`). The licence of those fonts is unclear.

### 6.1 Data model (mimics ObjectARX)

- **Package stack:**

  ```
  common (AcCm*)
    └─ geometry-engine (AcGe*)
         └─ graphic-interface (AcGi*)
              └─ data-model (AcDb*)
  ```

- **`AcDbObject<ATTRS>`** keeps its attributes in an event-capable bag, used for UI and undo (`data-model/src/base/AcDbObject.ts:83`).
  - `AcDbObjectId` is the hex handle string. Detached objects get `TEMP_`+uid.
  - It has `dxfIn`/`dxfOut` filer methods, ARX-style.
- **`AcDbEntity`** stores layer, linetype and style **by name**. Rendering is `subWorldDraw(renderer)` inside a `worldDraw` wrapper (`entity/AcDbEntity.ts:822-881`).
  - About 48 entity classes.
  - The `AcDbDatabase` has typed sysvars (`database/AcDbDatabase.ts:332-428`), plus tables, dictionaries and a transaction manager.
- **DXF parser** (MIT, own code, runs on the main thread). It is "single-pass streaming":
  - `AcDbDxfPairReader` streams over the bytes, supports **binary DXF**, and peeks `$ACADVER`/`$DWGCODEPAGE` first (`base/AcDbDxfPairReader.ts:13-46,622-666`).
  - It covers about 35 entity types and 10 object types.
  - It includes:
    - a proxy-graphics decoder
    - an ACIS SAT/SAB decrypter/decoder
    - the full `acad.pat`, embedded as data (`misc/pat/AcDbPatPredefined.ts`)
- **Group-code audit scripts** (`data-model/scripts/audit-all-dxf-codes.mjs`) are a good idea to copy.
- **Unknown data is weak:**
  - Undefined group codes are ignored (`AcDbObject.ts:1128-1136`).
  - Unknown entities and objects are skipped.
  - **`{ACAD_REACTORS` is discarded**.
  - XDATA is kept in order in a compact flat array (`:89-103,494-559`).
- **Handles.** A global `Map` from handle to object. `$HANDSEED` is honoured, with a BigInt fallback above 2^53.
- **Write.** `dxfOut` writes ASCII or binary, version-dependent (`AcDbDatabase.ts:2545-2590`). The result is **lossy**.

### 6.2 Renderer

- **`AcGiRenderer`** (`graphic-interface/src/AcGiRenderer.ts`) is a small primitive API:
  - `point`, `circularArc`, `ellipticalArc`, `lines`, `lineSegments`, `area`, `offsetRing`, `mtext`, `shape`, `image`, `group`.
  - Traits: colour, full linetype, lineweight, fill (solid / pattern lines / gradient), transparency, draw order.
  - **Three implementations exist: three.js, SVG and PDF.** This shows a primitive-level interface can drive both raster and vector outputs.
- **Tessellation happens in the data model** at a fixed `circleSides`. There is no LOD.
- **Batching and caching.**
  - "Direct capture" fast path: a simple entity emits one primitive straight into a batch (`AcTrRenderer.ts:225-296`).
  - Batches are keyed by material id. Containers are **split by world origin**, so vertices are rebased for float32 (`batch/AcTrBatchedGroup.ts:82-106`).
  - Material caches let a layer colour change update materials in place, without re-tessellating.
  - rbush spatial index.
- **Blocks.** Templates are cached (`misc/AcDbRenderingCache.ts`): one template per block, or per block and colour when the block contains BYBLOCK entities. There is an LRU budget. The transform is baked in; there is no GPU instancing.
- **Lineweight.**
  - Pixel width is `max(1, lw/40)` (`AcTrLineMaterialManager.ts:125`). This is a screen heuristic, not plot semantics.
  - three.js `LineMaterial` fat lines.
  - SVG and PDF use mm, which is closer to plotting.
- **Linetype.**
  - A fragment shader walks `pattern[]` along `lineDistance` (`style/AcTrLinePatternShaders.ts`).
  - Dots become a fixed 0.5 dash.
  - Dashed lines are always 1 px.
  - Complex shape and text elements are built as geometry (`linetype/AcTrComplexLineBuilder.ts`).
  - No PLINEGEN.
  - BYBLOCK linetype is not implemented (`AcDbEntity.ts:1029-1034`).
- **Hatch.**
  - Fills: earcut via `THREE.Shape`, with hole union through `@velipso/polybool`.
  - **Pattern lines are procedural, in a fragment shader** (`AcTrHatchPatternShaders.ts`), so the pattern depends on the screen and needs a separate CPU path for SVG and PDF. GRAVEL is broken.
- **Text.**
  - Uses the external packages `@mlightcad/mtext-renderer`, `mtext-parser` and `shx-parser`, plus opentype.js, iconv-lite and an IndexedDB cache. MTEXT renders in a worker pool.
  - **TEXT is converted into MTEXT** (`AcDbText.ts:843-867`), which risks mixing up the escape semantics of the two.
  - It does support SHX.
- **Viewports.**
  - Each paper-space viewport re-renders the model scene into a rectangular **scissor** (`viewport/AcTrViewportView.ts:316-331`).
  - Not supported:
    - non-rectangular clips
    - VP layer freeze (it is parsed but not used)
  - No CTB/STB anywhere.
- **Tests.**
  - realdwg has about 176 jest specs and cad-viewer about 250. Fixtures are tiny: 4 DXFs, plus 11 in the Playwright end-to-end tests.
  - The end-to-end tests check coarse pixel colour counts. There is no reference-image comparison.
  - Docs: TypeDoc, VitePress in 7 languages.

**Summary for truedxf.**
- **Adopt:**
  - primitive renderer interface with several backends
  - codepage pre-peek
  - compact ordered XDATA
  - block templates keyed by BYBLOCK dependence
  - origin-rebased batches
  - in-place material updates
  - group-code audit scripts
- **Avoid:**
  - lossy model
  - name-typed references
  - screen-heuristic lineweights
  - shader-procedural hatches and linetypes (not plot-exact, and not reproducible in vector output)
  - TEXT treated as MTEXT
  - dependency on a font CDN

---

## 7. ACadSharp (DomCR; C#, MIT)

| | |
|---|---|
| Version | 3.8.5 (`src/ACadSharp/ACadSharp.csproj:20`), commit 2026-09-29, very active, 868 stars, 119 open issues |
| Targets | net8/9/10/48, netstandard2.x. Depends on a `CSUtilities` submodule, which is empty in our clone |
| DXF | Read AC1009–AC1032; write AC1012–AC1032 (no R12 write) |
| DWG | Read AC1014+; write all except AC1021 (`README.md`) |

**Parse** (`src/ACadSharp/IO/DXF/`).

- **Stream readers.** A pull cursor (`DxfStreamReaderBase.cs:9-121`) with three backends:
  - text
  - binary
  - pre-R13 binary with 1-byte codes (`DxfBinaryReaderAC1009`)
- **Entity dispatch.**
  - A big `switch` on the type name creates a `CadEntityTemplate<T>` and a reader per type (`DxfSectionReaderBase.cs:153-268`).
  - Common codes: 5, 100 (sets the current subclass), 102, 330, 1001.
  - **Unhandled codes produce a `Notify` and are lost** (`:147-149`).
- **Subclass-aware reflection mapping.** This is the correct way to handle duplicate codes:
  - `DxfMap.Create(Type)` groups `[DxfCodeValue(codes…)]` properties by `[DxfSubClass("AcDbXxx")]` (`DxfMap.cs:34-110`).
  - `tryAssignCurrentValue` looks up `map.SubClasses[currentSubclass].DxfProperties[code]` (`DxfSectionReaderBase.cs:2319-2379`).
  - About 1,150 attributes exist. They carry codes and defaults but no version ranges.
  - Angles are stored in radians (`DxfReferenceType.IsAngle`).
- **Templates and deferred resolution.**
  - `CadTemplate` holds owner, xdict, reactors and XDATA handles (`IO/Templates/CadTemplate.cs:10-164`).
  - `getTableReference` resolves **by handle, falling back to name**. The fallback is needed for R12, which has no handles.
  - `DxfDocumentBuilder.BuildDocument` (`DxfDocumentBuilder.cs:38`) runs:
    1. create missing handles
    2. build tables
    3. build dictionaries
    4. assign orphan owners (VERTEX→POLYLINE, ATTRIB/SEQEND→INSERT)
    5. build everything else
- **Options.**
  - `Failsafe` defaults to true.
  - `KeepUnknownEntities`: unknown entities are kept only if a CLASSES entry exists, only their common fields are kept, and **they are never written**.
  - Problems are reported through a notification callback, not exceptions.

**Model.**
- 143 entity files and 106 object files, the broadest of any library here. Covers:
  - MESH
  - MULTILEADER with context data
  - the full ACAD_TABLE cell model
  - VIEWPORT
  - typed HATCH edges and gradients
  - dynamic-block parameters and actions
  - GEODATA
- Unknown 102 groups are skipped (`:2276-2301`). XDATA, xdict and reactors are written back.

**Geometry.**
- `ApplyTransform`, `GetBoundingBox` (48 overrides), `PolygonalVertexes`.
- `Insert.Explode` (`Insert.cs:321`) converts circles to ellipses under non-uniform scale.
- `Dimension.UpdateBlock()` regenerates the block for 8 dimension types.
- A basic `SvgXmlWriter` (901 lines). It is not plot-accurate: splines are commented out and ellipses have a TODO.

**Testing. This is the method to copy.**
- `samples/sample_AC1009…AC1032_{ascii,binary}.dxf/.dwg` are **produced by AutoCAD**, by `samples/sample_base/save_samples.lsp` running SAVEAS once per version.
- A `DOCUMENTTREE` command dumps AutoCAD's .NET object tree to `sample_base_tree.json`. `DocumentIntegrity.AssertDocumentTree` compares the parsed document against it.
- About 289 xunit tests. Cross-format round-trips.

**Limitations.** 74 TODOs, lossy on unknown data, reflection-heavy.

---

## 8. netDxf (haplokuon; C#, MIT, with a Boost-licensed GTE folder)

| | |
|---|---|
| Version | 3.0.1, last commit 2023-10-11, **dormant** (1,147 stars, 183 open issues) |
| Versions | Reads and writes R2000–R2018, ASCII and binary. Throws on anything before R2000 (`netDxf/IO/DxfReader.cs:150-162`) |

- **Parser.** A monolithic hand-written `DxfReader.cs` (12,060 lines) and `DxfWriter.cs` (5,544).
  - It assumes a strict code order (`Debug.Assert` on subclass markers, `:3880`).
  - Unknown data goes to `ReadUnknowData(); return null`.
  - Reactors are dropped (`:11697-11718`).
  - Names and handles are resolved eagerly through many side dictionaries.
- **Model.** "Document-managed": adding an entity creates its layers and styles. Observable collections.
  - Not supported:
    - REGION
    - SURFACE
    - 3DSOLID
    - MLEADER
    - dynamic blocks

    ACAD_TABLE is read as an INSERT.
- **Geometry.** The richest of the C# libraries.
  - `TransformBy` on every entity, `PolygonalVertexes`, `Explode`.
  - `DimensionBlock.cs` (1,685 lines) is a good reference for rendering dimensions that have no block.
  - NURBS through a GTE port (Boost licence).
- **Tests.** None. There is only an 8,874-line demo `Program.cs`.

---

## 9. ixmilia dxf (C#) and dxf-rs (Rust), both MIT, and their spec XML

| | C# `ixmilia-dxf` | Rust `ixmilia-dxf-rs` |
|---|---|---|
| Version | 0.8.5; changelog to 0.8.4 (2024-06); commit 2026-07-28 (packaging only) | 0.6.1; commit 2026-09-09 |
| Read and write | R10–R2018, ASCII, binary, DXB | same |
| Generated code | `src/IxMilia.Dxf.Generator` writes into gitignored `Generated/` | `build.rs` writes into `$OUT_DIR`, pulled in with `include!` (`build/build.rs:17-61`) |
| Unknown entities | dropped (`SwallowEntity`) | dropped |
| Unknown codes | kept in `ExcessCodePairs`, **not written back** (`Entities/DxfEntity.cs:319-347`) | ignored (`build/entity_generator.rs:159-199`) |
| 102 groups | **all kept and written back** (`DxfCodePairGroup`) | all kept (`ExtensionGroup`) |
| Pointers | `DxfPointer.BindPointers` pass after load (`DxfPointer.cs:35-160`) | lazy, linear scan per lookup (`src/drawing.rs:511-575`) |
| Tests | 317 tests with inline code-pair strings; optional AutoCAD/ODA interop tests driving `acad.exe /i … /s script` (`AudoCadCompatTests.cs:14-228`) | 330 tests; generated "all types" tests; ODA interop |

The C# README warns that AutoCAD may reject its output for 3DSOLID, ATTRIB, DIMENSION, MTEXT and others, and that "AutoCAD doesn't seem to like R13 files written by IxMilia".

### 9.1 Evaluating the spec XML as a source for truedxf's TS model

**Files.**
- `ixmilia-dxf-rs:spec/{EntitiesSpec,ObjectsSpec,TableSpec,HeaderVariablesSpec}.xml`.
- C#: `ixmilia-dxf:src/IxMilia.Dxf.Generator/Specs/*.xml`.
- **The files have no licence headers of their own and are covered by each repo's MIT LICENSE.txt.** They can be ported with attribution.

**Coverage.**

| | C# | Rust |
|---|---|---|
| Entities | 51 `<Entity>` | 47. **HATCH is missing**, as are the Aligned and Angular2Line dimensions |
| Objects | 42 | 42 |
| Tables | 9 | 9 |
| Header variables | 285 entries, 280 unique names (80 `DIM*`) | the same name set |
| Fields | 1,098 `<Property>`, 36 `<Pointer>` | 1,153 `<Field>`, 57 `<Pointer>` |

**Missing from both specs:**
- MESH, MLEADER, SURFACE, TABLE, the VIEWPORT *entity* and ARC_DIMENSION. They are only TODO comments, e.g. `ixmilia-dxf-rs:spec/EntitiesSpec.xml:636,710,1056,1062,1278`.
- SCALE, the `*OBJECTCONTEXTDATA` family, DBCOLOR, PDFDEFINITION and the dynamic-block objects.

**Schema.**

| Element | Attributes |
|---|---|
| Type | `Name`, `SubclassMarker` (only one), `TypeString` (a comma list), `MinVersion`/`MaxVersion`, `BaseClass`, `GenerateReaderFunction`/`GenerateWriterFunction` |
| Field | `Code`, `Type`, `DefaultValue`, `CodeOverrides="10,20,30"`, `AllowMultiples`, `Read/WriteConverter`, `DisableWritingDefault`, `WriteCondition`, `Min/MaxVersion`, `<Flag Name Mask>` |
| Pointer | `<Pointer Name Code Type SubType AllowMultiples>` |
| Write order | `<WriteOrder>` containing `WriteField`, `WriteSpecificValue Code Value`, `Foreach`, `WriteExtensionData` |
| Header variable | code −2 marks a 2D point, −3 a 3D point |
| Synthetic field | `Code="-1"` marks a field that does not exist in the file |

Example (`ixmilia-dxf-rs:spec/EntitiesSpec.xml:593-598`):

```xml
<Entity Name="Line" SubclassMarker="AcDbLine" TypeString="LINE,3DLINE">
  <Field Name="thickness" Code="39" Type="f64" DefaultValue="0.0" DisableWritingDefault="true" />
  <Field Name="p1" Code="10" Type="Point" DefaultValue="Point::origin()" CodeOverrides="10,20,30" />
  ...
```

**Quality problems.** It cannot be consumed as-is.

1. `DefaultValue`, the converters, `WriteCondition` and `Value` are **target-language expressions** (Rust or C#).
   - Rust has 741 plain literals and 556 other expressions (`Point::origin()`, enum paths).
   - The Rust spec still contains stale C# conditions (`WriteCondition="IsFrontClippingPlane"`, `ObjectsSpec.xml:1014,1016,1072-1075`).
2. **No subclass partition for reading.**
   - Readers dispatch on the code alone.
   - The Rust generator keeps only the first field for a duplicate code (`build/entity_generator.rs:487-488`, `// TODO: allow for duplicates`).
   - The C# object generator uses ordinal counters.
   - The subclass structure can only be recovered from `WriteSpecificValue Code="100"` in the write order.
3. **No enums in the spec.** Rust defines 101 hand-written enums in `src/enums.rs`; C# has about 115.
4. **Value types are not in the spec.** They come from a separate code-range table (`ixmilia-dxf-rs:src/expected_type.rs:13-60`).
5. **Repeated structs** (LWPOLYLINE vertices, LTYPE elements, spline control points) become hidden parallel arrays (`__x`/`__y`) or custom code.
   - The Rust LTYPE parallel arrays lose alignment when optional per-dash codes are missing. C# replaced them with a hand-written `Elements` list (`TableSpec.xml:91-108`).
6. **The hard types are hand-written** in both repos:
   - HATCH paths
   - MTEXT (code 50 is both rotation and column height)
   - LWPOLYLINE
   - POLYLINE/VERTEX/SEQEND
   - INSERT/ATTRIB
   - DIMENSION subtype selection (in Rust, by the 100 marker)
   - LEADER, DICTIONARY, LAYOUT, XRECORD and more

   About 15k lines of hand-written C# and 16k of Rust sit next to generators of about 2.9k lines.
7. **The two specs have drifted apart.**
   - HATCH exists only in C#. MTEXT code 46 is only in C#.
   - DimStyle `HeaderVariable` mappings (69) exist only in C#.
   - The FIELD type string is `ACAD_FIELD` in C#, which is a likely bug (`ixmilia-dxf:…/ObjectsSpec.xml:135`).
   - Field counts differ for about 15 types.

**Verdict.** Use the spec as a **seed, not a source of truth**:
- Take the Rust spec for its namespace and snake_case.
- Merge in the C# additions (HATCH, the dimension subclasses, MTEXT 46, `HeaderVariable` mappings, LTYPE elements).
- Convert it to our own neutral JSON/TS spec, with:
  - literal defaults
  - named codecs (`bool16`, `invBool16`, `enum`, `aci`, `lineweight`, `handle`, `angleDeg`, `julianDate`)
  - **an explicit per-subclass field partition**, taken from ACadSharp's `[DxfSubClass]` classes and checked against the DXF reference
  - version ranges
  - enums
- Write the missing types by hand, using ACadSharp's readers as the reference.
- Then treat our spec as the source of truth, validated against AutoCAD-written files. The header list of 280 variables with version ranges is the most directly usable part.

---

## 10. libdxfrw (C++, GPL-2.0+). Facts only

- **Version.** 2.0.0 standalone fork (C++17, public ABI) dated 2026-09-18 (`libdxfrw:NEWS:1-10`). About 89k LOC. Synced from LibreCAD (`LIBRECAD_SYNC.md`).
- **Architecture: SAX-style.**
  - `dxfReader` has ASCII, binary and R12-binary variants (`src/intern/dxfreader.h:24-198`).
  - `dxfRW::read(DRW_Interface*)` drives the section processors (`src/libdxfrw.h:392-416`).
  - Each `DRW_*` entity overrides `parseCode(code, reader)`, i.e. virtual dispatch on the group code (`drw_entities.h:230`).
  - Results go to the consumer through `DRW_Interface` callbacks such as `addLine` and `addHatch` (`src/drw_interface.h`).
  - There are **raw carriers** for unknown data: `addRawDxfObject`, `addRawDxfEntity`, `addRawDxfSection` (experimental).
  - Writing is callback-driven too.
- **Model.**
  - No document model.
  - Header variables are a `DRW_Variant` map (`drw_header.h:42`).
  - The lineweight enum maps indices 0–23 to the standard values 0, 5, 9, … 211, plus ByLayer, ByBlock and Default (`drw_base.h:801-831`).
- **Tests.** A writer version matrix AC1015–AC1032, a fuzz lane, and codepage tests.
- **Lesson.** The callback design is simple but forces every consumer to rebuild a document. Its interface list is a useful coverage checklist.

---

## 11. LibreCAD rendering (C++/Qt, GPLv2). Facts only

- **Version.** v2.2.2.6-alpha, commit 2026-09-30, 6,428 stars.
- **Import.** DXF comes in through libdxfrw into `RS_FilterDXFRW` (`lib/filters/rs_filterdxfrw.cpp`, 33.8k lines). **VIEWPORT is ignored** (`rs_filterdxfrw.h:2121`).
- **Linetypes are nothing like AutoCAD's.**
  - Linetype names are mapped to a fixed enum. Unknown linetypes are drawn solid (`lib/engine/lc_linetypenames.cpp:34-148`).
  - Patterns are hard-coded (`gui/rs_linetypepattern.cpp:34-78`) and converted to Qt dash arrays in *device millimetres* (`gui/render/rs_painter.cpp:95-117,1556-1610`).
  - LTSCALE is not applied.
- **Lineweight.**
  - Width = `lw/100 mm` converted to drawing units, then to px. Below 1 px it becomes a cosmetic line.
  - Printing uses `1/paperScale` ("AutoCAD like", `headless/lc_printviewportrenderer.cpp:79-140`).
  - Paper comes from `$PLIMMIN/$PLIMMAX`/`$PSVPSCALE`, not from LAYOUT.
- **Property resolution.** `RS_Entity::getPenResolved` (`rs_entity.cpp:868-940`) walks up the parents for ByBlock and then applies the layer.
  - INSERT *clones* the block entities.
  - Clones on layer 0 are moved to the insert's layer.
  - MINSERT is supported.
- **Hatch.**
  - Patterns are **DXF tile files**, not .pat (`rs_pattern.cpp:68-118`, 64 files).
  - The DXF definition lines are ignored.
  - Pattern entities are trimmed against the loops (`lc_looputils.cpp:964`).
- **Fonts.**
  - **LFF stroke fonts only** (48 files). No TTF or SHX rendering.
  - Style names are remapped (`rs_filterdxfrw.cpp:3903-3910`).
  - Each glyph is an `RS_Insert` of a letter block.
  - MTEXT codes are mostly stripped.
- **Lesson.** A counter-example of what truedxf's renderer should look like. The LFF fonts, however, are a reasonable last-resort fallback: ezdxf uses them too.

---

## 12. QCAD CE rendering (C++/Qt/ECMAScript, GPLv3 with exceptions). Facts only

- **Version.** 3.33.1.3 (`src/core/RVersion.h:28`), commit 2026-09-29. DXF goes through dxflib 3.26.4. DWG support is a proprietary plugin, not in this repo.
- **Architecture.**
  - `RDocument` sits on `RStorage`/`RMemoryStorage` (QHash maps) with an R*-tree spatial index (`RSpatialIndexNavel`).
  - **`RExporter` is the central visitor.**
    - Call chain: `exportEntity` → `setEntityAttributes`, which resolves attributes against a block-ref/viewport stack (`RExporter.cpp:426`), then the entity's own `exportEntity(RExporter&)`, then primitive calls such as `exportLine`, `exportArc` and `exportPainterPaths`.
    - Only a few primitives are pure virtual. The base class dashes the patterned lines (`RExporter.h:195-264`).
    - `RGraphicsScene`, `RDxfExporter`, the painter-path exporter and others all derive from it.
  - This is the same pattern as ezdxf's frontend/backend and a good one.
- **Linetypes.** World units, including shapes.
  - Pattern scale = LTSCALE × unit factor × entity ltscale, divided by the viewport scale inside a viewport (`RExporter.cpp:1738-1800`).
  - **The phase is centred for symmetric ends**, not started at the start point (`RLinetypePattern.cpp:244-282`). This is a known visual difference from AutoCAD.
  - Zero-length dashes are replaced by 0.1 (`RDxfImporter.cpp:282-327`).
  - Shapes in linetypes come from hand-converted CXF files. **QCAD never parses SHX.**
- **Hatch.**
  - 127 metric and imperial .pat files.
  - Parallel lines across the bbox, clipped by `getSegments` (`RHatchData.cpp:836-1000,1774`).
  - Timeout guard.
  - The DXF definition lines are not used.
- **Text** (`RTextRenderer.cpp`, 2,270 lines).
  - It parses MTEXT codes with regexes itself, and uses QTextLayout for TTF.
  - **TTF height = cap height of "A"** (about lines 1840–1860). This is the same empirical rule as ezdxf.
  - CXF stroke fonts, with an .shx→CXF substitution list (`RFontList.cpp:48-118`, `RDxfServices.cpp:617-647`).
  - The TTF family and bold/italic are read from STYLE xdata 1000/1071 (`RDxfImporter.cpp:730-750`).
- **Lineweight and print.**
  - Pens are in world units (`RExporter.cpp:508-520`).
  - On screen, below 1.5 px becomes cosmetic. Print divides by the drawing scale (`RGraphicsViewImage` about lines 1915–1990).
  - The print script (`scripts/File/Print/Print.js:320-420`) sets a minimum lineweight of 0.01 mm divided by the scale, with per-printer calibration factors.
  - Page settings are QCAD's own; DXF PLOTSETTINGS and LAYOUT are not used.
- **Viewports.** `RViewportEntity::exportEntity` (`:180-290`):
  - Only a rectangular `exportClipRectangle`.
  - A temporary block reference to model space with scale and twist.
  - VP-frozen layers are temporarily hidden.
  - Block references are exported through a **transform stack, not cloning**, with a recursion limit of 16.

---

## 13. libredwg (C, GPLv3). Facts only

- **Version.** 0.14 (2026-06-27), 0.14.1 security release (2026-07-25) (`libredwg:NEWS:6-40`).
- **Coverage.** The README claims dwg2dxf at "about 90%" and dxf2dwg at "r2000 only… about 80%" (`README:195-198`).
- **`dwg.spec` is a single-source macro DSL.**
  - Example: `FIELD_3BD (start, 10)`, where the **second argument is the DXF group code**, with version guards `SINCE`, `PRE` and `VERSIONS` (`src/dwg.spec:1514-1554`).
  - The file is included with different macro definitions by decode, encode, print, JSON and `out_dxf.c`.
- **DXF output is generated from the spec. DXF input is not.** `in_dxf.c` (15k lines) is hand-written:
  - A pair reader feeds per-section readers.
  - Generic fields are matched through the **dynapi field list** (`f->dxf == pair->code`, `in_dxf.c:12614`).
  - About 60 `add_*` helpers cover the complex types.
  - Postponed references are resolved in a second pass (`:14770-15017`).
- **dynapi.**
  - Generated by `gen-dynapi.pl` from `dwg.h` and `dwg.spec`.
  - `Dwg_DYNAPI_field {name, type, size, offset, is_indirect, is_malloc, is_string, dxf}` (`include/dwg_api.h:89-103`).
  - About 435 field tables and 7,239 fields. 317 typed objects out of 1,123 names, and 444 subclasses.
  - Usable by us as a **fact checklist** (object → field → DXF code), not as data. It is GPL, it ignores DXF emission order, and codes that repeat within a subclass are ambiguous.
- **Tests.**
  - `dxf-roundtrip.sh` and `dxf-check` (dwg → dxf → ODA → dwg → dxf).
  - `alldxf_*.inc` expected values.
  - 331 unit tests.
- **Issues from the dump: a ready-made pitfall list for our writer tests.**

  | Pitfall | Threads |
  |---|---|
  | Long strings: the 250/255 limit, 3-then-1 chunking, UTF-8 split mid-codepoint | libredwg#986 |
  | A CR inside TEXT leaves an empty line where a group code belongs | libredwg#1408 |
  | Layer colour written negative, so every layer comes out "off" | PR #1283/#1290 |
  | 420 true colour flags lost | PR #1377 |
  | Linetype handles on R13/R14 | PR #1378 |
  | Float formatting: `1.000000000000000E+20` and integers without ".0" | libredwg#687, libredwg#1083 |
  | `\U+` handling between TV and TU strings, codepage mojibake | libredwg#1414, PR #1210/#1375 |
  | MTEXT groups 3 and 1 must be concatenated | PR #1284 |
  | VIEWPORT frozen layers use code 331 | PR #1296 |
  | HATCH handle index reset per path | PR #1313 |
  | 66=1 without ATTRIB/SEQEND | libredwg#1351 |
  | Duplicate handles; the named object dictionary not written first | libredwg#1355/#1356/#1409/#1413 |
  | A missing trailing newline loses the last pair | PR #1366 |
  | Quadratic import times | libredwg#912 |

---

## 14. GDAL OGR DXF driver (C++, MIT)

The whole of GDAL is MIT, so this driver is not GPL.

- **Reader.** Its own streaming reader (`ogrdxfreader.cpp`). Binary DXF since 3.12.
  - One "entities" layer, with the fields Layer, PaperSpace, SubClasses, Linetype, EntityHandle, Text and an optional RawCodeValues (`doc/source/drivers/vector/dxf.rst:31-51`).
  - One `Translate*` per entity type (`ogrdxflayer.cpp`).
  - Curves are tessellated with `OGR_ARC_STEPSIZE` / `OGR_ARC_MAX_GAP`.
  - Splines use an in-house NURBS (`intronurbs.cpp`) with 8 vertices per control point.
  - OCS is handled everywhere except DIMENSION and LEADER.
- **Styles are OGR style strings.**
  - **PEN** (`ogrdxflayer.cpp:414-530`): resolves ByBlock and ByLayer lineweight and linetype, with dashes × `$LTSCALE` × entity ltscale.
  - **BRUSH**: fill colour only. Hatch patterns are not rendered.
  - **LABEL**: the font comes only from STYLE xdata. The default is **Arial**, even for SHX.
- **Blocks.**
  - Inlined and merged into one compound geometry by default (`DXF_MERGE_BLOCK_GEOMETRIES`).
  - `DXF_INLINE_BLOCKS=FALSE` produces a "blocks" layer with INSERTs as points.
  - Recursion guard (`ogrdxflayer.cpp:3063`).
- **Hatch.** Boundaries are assembled into polygons with `OGRBuildPolygonFromEdges` and `DXF_HATCH_TOLERANCE` (`ogrdxf_hatch.cpp:32-160`).
- **Writer.** A template writer:
  - It copies `data/header.dxf` (AC1018) and splices new LAYER, LTYPE, STYLE and BLOCK_RECORD entries into the tables.
  - It patches `$HANDSEED` in place and appends `data/trailer.dxf` (`ogrdxfwriterds.cpp:401-1214`).
  - This is a simple and robust way to produce AutoCAD-openable files, and a viable fallback for truedxf's first writer.
- **Tests.** `autotest/ogr/ogr_dxf.py` has 79 tests and 54 small targeted fixtures: byblock-bylayer, ocs2wcs, mtext-ocs, text-fancy, insert-recursive, frozen-off, binary R12 and R2000, clusterfuzz. The fixtures are MIT, so they can seed our parser tests.

---

## 15. tarikjabiri/dxf (dxfjs writer; TS, MIT)

- **Versions.** npm `@tarikjabiri/dxf` 2.9.0; repo 3.0.0-alpha.14 (rewrite); commit 2026-09-16.
- **API.** `new Writer(); w.document.modelSpace.addLine({...}); w.stringify()`.
  - Each entity has an options interface, a `bbox()` and a `tagify` visitor (`src/entities/manager.ts:88-200`).
  - `TagsManager.add` omits undefined values (`src/utils/tags.ts`), which is how optional groups disappear.
- **Handles.** One global `Seeder` counter, written as hex. `$HANDSEED` is taken from `peek()` at stringify time (`src/header/header.ts:36-43`).
- **Limits.**
  - **Only R2007 (AC1021)**, hard-coded (`header.ts:14`).
  - No LAYOUT objects, so paper space is not well formed.
  - Numbers are written with JS `toString`.
- **Dimensions** are rendered into `*D` blocks by the writer (`src/entities/dimension/render/renderer.ts`).
- **Tests.** Vitest snapshots.
- **Lesson.** A pleasant builder API to mirror in `@truedxf/model`'s creation helpers. Irrelevant for reading and round-trip.

---

## 16. Synthesis

### 16.1 Comparison table

Legend: ✓ = supported, ~ = partial, ✗ = no, — = not applicable.

| Library | Lang / licence | Active? | Read | Write | Lossless | Typed model | Blocks | Linetype | Lineweight | Hatch pattern | SHX | Layouts/VP | Plot styles | Ref tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ezdxf | Py / MIT | ✓ (2026-09) | R12–R2018 ASCII+bin, recover | R12–R2018 | ~ unknown entities only | ✓ DXFAttr schema | expanded (deep copy) | ~ simple, continuous phase | ~ mm, 0.25 default | ✓ exact-Bézier clip, random jiggle | ~ no BIGFONT | ~ top view, non-rect clip | ~ CTB colour+lw | ✗ structural only |
| dxf-viewer | JS / MPL-2.0 | ✓ | ~ 17 entities, no OBJECTS | ✗ | ✗ | ✗ | ✓ instanced + flattened | ✗ | ✗ (1 px) | ✓ analytic clip | ✗ | ✗ | ✗ | ~ scene-dump goldens |
| dxf-parser / three-dxf | JS / MIT | ✗ | ~ | ✗ | ✗ | ~ | ✗ per-entity objects | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| dxf-json | TS / **GPL-3** | ✓ | ✓ 38 entities, OBJECTS, binary | ✗ | ✗ | ✓ union types | — | — | — | — | — | — | — | ~ snapshots |
| bjnortier dxf | JS / MIT | ~ | ~ | ✗ | ✗ | ✗ flat | expanded (MINSERT ✓) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ~ |
| mlightcad | TS / MIT (+GPL DWG) | ✓✓ | ✓ ASCII+bin | ✓ lossy | ✗ | ✓ ARX-like | templates, baked | ~ shader, 1 px | ~ lw/40 px | ~ shader | ✓ | ~ rect scissor | ✗ | ✗ |
| ACadSharp | C# / MIT | ✓✓ | AC1009–AC1032 + DWG | AC1012–AC1032 + DWG | ✗ | ✓ widest | explode helper | — | — | — | — | model only | — | ✓ AutoCAD samples + tree dump |
| netDxf | C# / MIT | ✗ | R2000+ | R2000–R2018 | ✗ | ✓ | explode helper | — | — | — | — | model only | — | ✗ |
| ixmilia C#/Rust | C#, Rust / MIT | ~ | R10–R2018 + DXB | same | ~ 102 groups + excess (C#) | ✓ generated | — | — | — | — | — | — | — | ~ interop |
| libdxfrw | C++ / GPL-2 | ✓ | ✓ + DWG | ✓ | ~ raw carriers | POD callbacks | — | — | — | — | — | — | — | ~ |
| LibreCAD | C++ / GPL-2 | ✓ | via libdxfrw | ✓ | ✗ | own | cloned | ✗ screen-mm enum | ~ | ~ DXF tiles | ✗ (LFF) | ✗ | ✗ | ✗ |
| QCAD | C++ / GPL-3 | ✓ | via dxflib | R12, R2000 | ✗ | own | transform stack | ✓ world, centred phase | ✓ world units | ✓ .pat library | ✗ (CXF) | ~ rect clip | ✗ | ✗ |
| libredwg | C / GPL-3 | ✓ | DXF→DWG r2000 | DWG→DXF ~90 % | ~ | spec-generated | — | — | — | — | — | — | — | ~ roundtrip scripts |
| GDAL OGR | C++ / MIT | ✓ | ✓ streaming, binary | template | ✗ | features | inlined | ~ style string | ~ style string | ✗ | ✗ (Arial) | ✗ | ✗ | ✓ targeted fixtures |
| tarikjabiri | TS / MIT | ✓ | ✗ | R2007 only | — | builder API | — | — | — | — | — | ✗ | — | ~ snapshots |

### 16.2 What truedxf should adopt and what it should avoid

**Adopt (idea → where it comes from):**

1. **Layered reading.** Byte tokenizer → typed tags → structure (sections, entities) → subclass split (ExtendedTags) → typed view.
   - Keep a separate tolerant recover mode with repair filters.
   - Source: ezdxf `lldxf`, `recover`.
2. **Lossless core.** Every object keeps its raw tag list, split by subclass, with XDATA, all 102 groups and embedded objects in place.
   - Typed properties are views onto or over that list, and only modified fields are re-serialized.
   - Unknown entities, objects and sections pass through untouched.
   - This goes beyond every surveyed library. The closest precedents are ezdxf `DXFTagStorage` and `StoredSection`, ixmilia `ExcessCodePairs` and `ExtensionGroup`, and libdxfrw's raw carriers.
3. **Subclass-aware field dispatch** on `(subclass marker, group code)`, plus ordinal rules for codes that repeat within one subclass.
   - Sources: ACadSharp `DxfMap`, dxf-json `pushContext`.
4. **Two-stage load.** Bind all handles first, then resolve pointers and owners, with a fallback from handle to name for R12.
   - Sources: ACadSharp `CadTemplate`, `DxfDocumentBuilder`; ezdxf `post_load_hook`.
5. **Spec-driven codegen.** Build our own neutral spec, seeded from ixmilia's XML (MIT). Take the subclass partition from ACadSharp (MIT). Use libredwg dynapi and the Autodesk reference as checklists only.
   - Commit the generated code, unlike ixmilia.
   - Add group-code audit scripts (mlightcad) that list every code seen in the corpus that the spec does not describe.
6. **Frontend, display list, backends.**
   - The frontend resolves properties and does *all* dashing, hatch-line generation, text-to-glyph and clipping.
   - Backends see only strokes (with width, cap and join), fills (with fill rule) and images.
   - Sources: ezdxf `BackendInterface`, QCAD `RExporter`, mlightcad `AcGiRenderer`.
7. **Property resolution rules.**
   - ezdxf `properties.py:626-884` and QCAD `REntityData` for ByBlock, ByLayer, layer-0 inheritance, viewport overrides and ACI 7.
   - Fix ezdxf's CTB-by-raw-ACI bug.
   - Read `$LWDEFAULT`.
8. **Analytic hatch clipping.**
   - dxf-viewer `HatchCalculator`: odd-parity with explicit vertex-hit handling.
   - ezdxf: intersect against exact curves.
   - Guard with limits on line and segment counts, **not** timeouts.
9. **GPU viewer tricks.**
   - worker with transferable typed arrays (dxf-viewer)
   - block definitions built once, in local coordinates
   - instance-vs-flatten heuristic
   - deferred ByBlock/ByLayer sentinels
   - origin-rebased float32 batches (mlightcad)
   - in-place material updates on layer changes (mlightcad)
10. **Testing.**
    - AutoCAD-generated multi-version samples plus an AutoCAD-side dump (ACadSharp `save_samples.lsp`, `sample_base_tree.json`).
    - Scene-dump goldens and metamorphic invariants (dxf-viewer).
    - Fonts from the repo only (ezdxf).
    - Targeted MIT fixtures from GDAL's autotest.
    - AutoCAD driven headless by script (ixmilia `acad.exe /i … /s`).
11. **Writer safety list.** Treat the libredwg issue list in §13 as writer tests.
    - GDAL's header/trailer template approach can serve as a bootstrap writer.

**Avoid:**
- Parsing by splitting the whole file into one string (dxf-viewer, dxf-parser, dxf-json, bjnortier). Use a chunked byte tokenizer instead, which also removes the JS string-length cap.
- Dropping unknown tags or objects (all of them).
- Storing references by name (mlightcad, netDxf). Keep handles and resolve names as views.
- Batch-key draw order (dxf-viewer). Draw order must follow AutoCAD: SORTENTS, then handle order or storage order. See the draw-order note.
- Screen-space linetypes and lineweights (LibreCAD, mlightcad, dxf-viewer).
- Shader-procedural hatches or dashes as the *reference* implementation (mlightcad). A shader path is fine as a viewer optimisation, but only if it matches the CPU output.
- Centred linetype phase (QCAD) and continuous phase for everything (ezdxf). Implement AutoCAD's rules, which the linetype note covers.
- Randomness or wall-clock dependence in the output: ezdxf's hatch jiggle and 30 s timeout, QCAD's MaxHatchTime.
- Converting TEXT into MTEXT (mlightcad). TEXT and MTEXT differ in escapes, metrics and alignment.
- A three.js dependency in the core, and depending on a font CDN.
- GPL dependencies: dxf-json, libredwg-web, `@dxfom/mtext`.

### 16.3 Recommended TypeScript package architecture

The workspace is pnpm (or bun), ESM-only, TS `strict`, target ES2022. Every package except the Node adapters, testkit and the WebGL backend is **isomorphic**: no DOM and no `node:*` imports, with I/O injected through interfaces.

```
                    @truedxf/core            (0 deps)
                         │
      ┌──────────────────┼──────────────────┐
@truedxf/spec (dev)  @truedxf/model       @truedxf/geometry (0 deps; clipper2-ts optional)
      └──codegen──▶      │                    │
                         │        @truedxf/fonts (opentype.js peer)
                         │                    │
                         │        @truedxf/text  (MTEXT/TEXT parse + layout)
                         │                    │
                     @truedxf/plot (CTB/STB/page setup, lineweight→device)
                         │                    │
                         └──────▶ @truedxf/render (frontend + display list) ◀─┘
                                     │
     ┌──────────────┬───────────────┼───────────────┬───────────────┐
render-raster   render-svg     render-canvas     render-webgl     (render-pdf, render-webgpu later)
(pure TS,       (string)       (Canvas2D-like    (browser only)
 test oracle)                   ctx injected)
                                     │
                        @truedxf/viewer (app)   @truedxf/node (fs adapters, CLI)   @truedxf/testkit (Node only)
```

**`@truedxf/core`** (tag layer, zero dependencies).
- **Tokenizer.**
  - Chunked byte tokenizer over `Uint8Array`, fed by `ReadableStream` or buffers.
  - ASCII and binary DXF: the R12 1-byte code with 255 escape, and 2-byte codes for R13+.
  - Tolerant line endings. Positions (byte offset and line) for diagnostics.
- **Group codes.** The value-type table by code range, and point merging, both from the reference.
- **Encoding.**
  - Sniff `$ACADVER` and `$DWGCODEPAGE` from the first bytes.
  - Decode lazily with `TextDecoder`.
  - Keep raw bytes for strings that fail to decode, so they round-trip.
- **Structure.**
  - Groups tags into sections and objects.
  - A **lossless `TagList`** per object with subclass boundaries, 102 groups, XDATA and embedded-object spans.
- **Writer.**
  - ASCII and binary output.
  - AutoCAD-compatible number formatting (a separate note).
  - String chunking: 250 characters, 3-then-1.
  - `\U+` escaping for pre-R2007.
  - Streaming output.
- **Recover mode:** optional, a separate entry point.
- **Performance.**
  - Values stay unparsed until they are accessed.
  - A structure index of code-0 offsets, like ezdxf's `fileindex`, enables random access and lazy loading of huge files.

**`@truedxf/spec`** (dev-only, not published at runtime).
- A neutral JSON/TS spec: types, subclasses, fields (code, type, default, codec, version range, repeat or struct), pointers (with soft, hard or owner kind), enums, header variables.
- Seeded from ixmilia (MIT, attributed), with the partition from ACadSharp (MIT).
- The generator emits TS into `@truedxf/model/src/generated`, and the generated code is committed. It also emits "all types" round-trip tests.

**`@truedxf/model`** (depends on core).
- **Document.** Header, classes, tables, blocks and block records, entities, objects, layouts, thumbnail.
- **Typed objects** are generated classes that are *views over the lossless TagList*.
  - Each keeps dirty tracking and re-serializes only what changed.
  - Hand-written parts: HATCH paths, MTEXT, LWPOLYLINE, POLYLINE/VERTEX/SEQEND, INSERT/ATTRIB, DIMENSION subtypes, LTYPE elements, SPLINE, LEADER, MLEADER context, DICTIONARY, XRECORD, LAYOUT, PLOTSETTINGS, VIEWPORT.
- **Handles.** `HandleDB` using BigInt, or a hex string with fast comparison. Owner, reactor and extension-dictionary graph.
- **Pointer resolution.** Soft or hard, with name fallback for R12.
- **Also:** `audit()`, version conversion on export, and builder helpers (tarikjabiri-style option objects).
- **Property-resolution primitives.** Pure functions such as `resolveColor(entity, ctx)`, plus the ACI palette. There are no rendering dependencies here, so non-rendering users (BOM extraction, GIS) get correct effective properties.

**`@truedxf/geometry`** (zero dependencies; the Clipper2 port is optional).
- 2D/3D vectors and matrices in float64, OCS/WCS (arbitrary axis algorithm), bulge arcs, ellipses.
- B-splines and NURBS: de Boor, knot insertion, **exact spline → Bézier conversion** (as bjnortier does) for vector backends.
- Adaptive flattening with the tolerance given *in device units*.
- Wide polylines and traces, and a **stroker** (caps, joins, miter limit) so that every backend gets identical outlines.
- Dash engine: pattern walking, PLINEGEN, shape and text placement hooks.
- Hatch: boundary assembly, island nesting by style, pattern-line generation and clipping, gradient descriptors.
- Polygon booleans for viewport and XCLIP and wipeout.
- Deterministic: no randomness, and stable sort order.

**`@truedxf/fonts`** (optional peer: opentype.js).
- SHX parser covering shapes, unifont and **bigfont**.
- TTF, OTF and TTC through opentype.js.
- `FontProvider` interface: an async `getFont(name) → bytes`. The Node adapter scans directories; the browser uses URLs or `File`s.
- Font resolution and fallback chain, from STYLE, `\f` codes, and the substitution map.
- Metrics rules as AutoCAD applies them: the SHX "above" value, the TTF cap-height rule, which is an ASSUMPTION inherited from ezdxf and QCAD and needs verifying.
- Output: a glyph cache of outline paths (TTF fills) and stroke polylines (SHX).

**`@truedxf/text`** (depends on fonts).
- TEXT layout: alignment, fit/aligned, oblique, backward and upside-down, width factor.
- MTEXT parser and layout engine: paragraphs, tabs, stacking, columns, inline codes, background mask, CJK line breaking.
- Separate TEXT and MTEXT code paths.

**`@truedxf/plot`** (depends on model).
- CTB and STB parsing. CTB files are zlib-compressed text (ezdxf `acadctb.py`), so use built-in `DecompressionStream('deflate')` or fflate.
- Plot-style application by *resolved* ACI.
- Page setup to plot transform: paper size, printable area, plot area type, scale, offset, centring, rotation.
- Lineweight in mm to device px, with `LWDISPLAY` and plot-with-lineweights semantics.
- Screening and grayscale.

**`@truedxf/render`** (frontend and display list).
- Walks a layout.
  - For paper space: paper-space entities and viewports in AutoCAD draw order, with VP clipping and layer overrides.
  - Model space is an extents/view plot.
- Expands INSERT/MINSERT. The display list records *symbol definitions and instances*, so WebGL can instance while raster and SVG expand.
- Applies ByBlock through instance colour overrides.
- **Display list format.**
  - A flat, transferable structure: `Float64Array` or `Float32Array` with a local origin for coordinates, a command stream, a style table, and a strict draw-order sequence.
  - Primitives: `stroke(path, widthMm, cap, join)`, `hairline(path)`, `fill(rings, rule)`, `image`, `clipPush`/`clipPop` (or pre-clipped geometry), `beginGroup(handle)` for picking.
  - Everything is in paper millimetres, or model units with a transform.
- Tessellation tolerance is a render option tied to the target DPI and zoom. The viewer re-tessellates by level of detail; tests use a fixed DPI.

**Backends.**

| Backend | Runtime | Notes |
|---|---|---|
| `@truedxf/render-raster` | Node and browser | Pure-TS scanline rasterizer with explicit AutoCAD-emulating rules (§16.5). **The oracle for pixel tests.** No native dependencies, so it is deterministic across operating systems. |
| `@truedxf/render-svg` | Node and browser | Keeps arcs and Béziers as curves. `shape-rendering` optional. |
| `@truedxf/render-canvas` | Browser; Node through `@napi-rs/canvas` | Takes any Canvas2D-like context. For interactive 2D viewing and quick exports. |
| `@truedxf/render-webgl` | Browser only | Own WebGL2 code, no three.js. Instanced symbols. Wide lines as screen-aligned quads, or triangulated outlines from the stroker at plot DPI. Fills via earcut on the CPU. |
| `render-pdf`, `render-webgpu` | — | Later. |

**`@truedxf/viewer`** (app).
- Vite. Worker pipeline: core → model → render display list.
- Transfers the buffers to the main thread, which hosts the WebGL backend.
- UI: layers, layouts, pick.
- flatbush spatial index for culling and picking.

**`@truedxf/node`.**
- Filesystem font provider, stream helpers, CLI (`truedxf render in.dxf --layout A1 --dpi 300 -o out.png`).

**`@truedxf/testkit`** (Node only).
- Corpus manifest (DXF, AutoCAD version, PC3/PMP/CTB, plot settings, reference outputs, hashes).
- AutoCAD job generator (`.scr` scripts for `accoreconsole.exe`).
- PDF reference reader: pdf.js `getOperatorList`, used for vector comparison.
- Rasterization: our raster backend, and pdfium for the AutoCAD PDF.
- Diffing: exact, tolerant, and a pixelmatch image. SSIM score. HTML report.
- Metamorphic test helpers.

### 16.4 Third-party npm libraries

Checked with `npm view` on 2026-09-30.

| Need | Candidate | Version | Licence | Verdict |
|---|---|---|---|---|
| TTF/OTF outlines, metrics, kerning | `opentype.js` | 2.0.0 | MIT | **Use.** Pure JS, and both dxf-viewer and mlightcad use it. It does no complex shaping beyond kerning and ligatures. |
| WOFF2, variable fonts, full GSUB/GPOS | `fontkit` | 2.0.4 | MIT | Fallback if opentype.js falls short. Heavier. |
| Complex script shaping | `harfbuzzjs` | 1.6.2 | MIT (wasm) | Optional plugin. **UNKNOWN:** how much shaping AutoCAD applies to TTF text (Arabic, Thai; ezdxf#1387). Test before paying the wasm cost. |
| Triangulating fills for WebGL | `earcut` | 3.2.4 | ISC | **Use** in the WebGL backend only. Raster, SVG and canvas fill paths directly with a fill rule and do not need triangulation. |
| Robust tessellation (self-intersecting input) | `libtess` / `tess2-ts` | 1.2.2 / 1.0.8 | SGI-B-2.0 (permissive) | Fallback for broken hatch boundaries in WebGL. |
| Polygon booleans | `clipper2-ts` / `@countertype/clipper2-ts` / `clipper2-wasm` | 2.0.1-x / 1.5.4 / 0.4.0 | BSL-1.0 | **Use** for viewport and XCLIP clip polygons, wipeouts, and hatch island repair. Works on integers, so clip in device space or at a fixed scale. `polygon-clipping` (MIT) is a float alternative but slower. |
| Spatial index | `flatbush` / `rbush` | 4.6.2 / 4.0.1 | ISC / MIT | **Use** flatbush, which is static and fast, in the viewer. |
| Deflate and zip | `fflate` | 0.8.3 | MIT | Optional. The CTB zlib stream can use built-in `DecompressionStream` instead. Prefer fflate over `pako` 3.0.2 (MIT AND Zlib). |
| Reading code pages | built-in `TextDecoder` | — | — | **Use.** WHATWG encodings cover windows-874 and 1250–1258, shift_jis (≈cp932), gbk/gb18030 (≈cp936), euc-kr (≈cp949), big5 (≈cp950). Node includes full ICU by default. **UNKNOWN:** AutoCAD's exact cp932/936 tables vs WHATWG, which differ for a few code points. |
| Writing code pages | `iconv-lite` | 0.7.3 | MIT | Avoid by writing ASCII plus `\U+XXXX` for pre-R2007. Keep as an optional writer plugin. |
| WebGL scene graph | `three` | 0.186.1 | MIT | **Not in core or backends.** Both dxf-viewer and mlightcad fight three.js: custom shaders, manual batching, precision hacks. Acceptable in the demo app only, for gizmos. |
| Thin WebGL helper | `twgl.js` / `regl` | 7.0.0 / 2.1.1 | MIT | Optional. A hand-written WebGL2 backend is small enough to own. |
| WebGPU | native API + `@webgpu/types` | 0.1.74 | BSD-3 | Later. The backend-agnostic display list keeps it additive. |
| Skia headless raster | `@napi-rs/canvas` / `skia-canvas` | 1.0.9 / 3.0.8 | MIT | Canvas-backend tests and "like Chrome" output. **Canvas2D has no way to turn off path antialiasing**: `imageSmoothingEnabled` affects images only. Prebuilt binaries, no system dependencies. |
| Cairo headless raster | `canvas` (node-canvas) | 3.2.3 | MIT | Has a non-standard `ctx.antialias = 'default'\|'none'\|'gray'\|'subpixel'` (node-canvas Readme §antialias). Native build friction on Windows. |
| SVG raster | `@resvg/resvg-js` / `@resvg/resvg-wasm` | 2.6.2 | MPL-2.0 | Deterministic CPU rasterizer (tiny-skia), with the same output in Node and wasm. The `shapeRendering: 1` (crispEdges) option sets `paint.anti_alias=false` (`resvg:crates/resvg/src/path.rs:70`). **Use as the second oracle for render-svg.** MPL is fine as a dev dependency. |
| Full Skia in wasm | `canvaskit-wasm` | 0.42.0 | BSD-3 | Candidate for a cross-platform deterministic reference: the same wasm runs in Node and browser, with explicit `Paint.setAntiAlias(false)`, `setStrokeCap` and `setStrokeJoin`. About 7 MB. |
| PNG I/O | `fast-png` / `pngjs` | 8.0.0 / 7.0.0 | MIT | **Use** fast-png, which works in both runtimes. |
| Pixel diff | `pixelmatch` | 7.2.0 | ISC | **Use** for diff images and counts. Its AA-detection heuristic helps when one side is antialiased. |
| SSIM | `ssim.js` | 3.5.0 | MIT | Secondary regression score. |
| Fast native diff | `odiff-bin` | 4.5.0 | MIT | Optional, for large corpora in CI. |
| PDF raster and vectors (AutoCAD "DWG To PDF" references) | `@embedpdf/pdfium` / `@hyzyla/pdfium` / `pdfjs-dist` | 2.15.1 / 2.1.13 / 6.3.289 | MIT / MIT / Apache-2.0 | **Use** pdfium (wasm) to rasterize references, and pdf.js `getOperatorList()` to extract paths and widths for vector comparison. **Avoid `mupdf` (AGPL-3.0).** |
| NURBS | `verb-nurbs` | 3.0.3 | MIT | **Avoid**: Haxe-generated and heavy. Implement de Boor, knot insertion and Bézier extraction ourselves, with ezdxf `math/bspline.py` as the reference. |
| Worker RPC | `comlink` | 4.4.2 | Apache-2.0 | Optional. A hand-written `postMessage` protocol with transferables is simple enough. |
| Test runners | `vitest` / `playwright` | 5.0.2 / 1.63.0 | MIT / Apache-2.0 | **Use**: vitest for unit and golden tests, Playwright for WebGL backend screenshots. |

**Licence rules for truedxf, which is assumed MIT:**
- Runtime dependencies must be MIT, ISC, BSD, Apache-2.0 or BSL-1.0.
- MPL-2.0 is acceptable as a dev dependency (resvg), or as a runtime dependency that we do not modify.
- GPL and AGPL are banned.
- Fonts shipped for tests must be OFL or Apache: Noto, DejaVu, Liberation, plus our own synthetic SHX files. Autodesk SHX and TTF files must never be committed (ezdxf `fonts.py:32-74` lists the Autodesk TTF substitutes; they are copyrighted).

### 16.5 Making the headless renderer deterministic enough for pixel comparison with AutoCAD

The goal is that the same DXF plus the same plot settings give the same pixels as AutoCAD's plot, and give byte-identical output on every run and every operating system. Five parts:

**A. Fix the reference side.**

1. Drive AutoCAD by script. Run `accoreconsole.exe /i in.dwg /s job.scr` (ixmilia's `acad.exe /i … /s` pattern; ACadSharp's LISP driver). `-PLOT` answers every prompt explicitly:
   - layout
   - device PC3
   - paper
   - units
   - orientation
   - plot area
   - scale
   - offset or centring
   - plot style table
   - lineweights on or off
   - "plot paperspace last"
   - hide
2. Plot to **two targets**:
   - `DWG To PDF.pc3`. The vector result allows *geometric* comparison in paper mm: stroke paths and widths, fills and colours from the pdf.js operator list. It also allows raster comparison after both sides go through **the same rasterizer** (pdfium, or our own via a PDF-path importer), so rasterizer differences cancel out.
   - `PublishToWeb PNG.pc3`, a raster device with a custom pixel paper size. Needed to learn and pin down AutoCAD's own raster rules.

   **UNKNOWN / needs AutoCAD test:**
   - whether PNG output is antialiased
   - how lineweight is rounded to pixels
   - hairline width
   - cap and join shapes
   - how merge control affects overlaps
   - the PDF driver's vector-resolution setting and how it affects arc tessellation
3. Store every PC3, PMP and CTB file used, the AutoCAD version and build, and hashes, in the corpus manifest.
4. Use a custom PMP with **zero margins** (or record the printable-area offset), so paper and pixel alignment is known. Keep the paper size an integer number of pixels at the chosen DPI.
5. Start with `monochrome.ctb` and lineweights off, to test geometry alone. Then add lineweights, then colour. This isolates the failure classes.

**B. Deterministic geometry on our side.**

- **Numbers.**
  - All model and geometry math in float64. Float32 only in GPU buffers, with local origins.
  - No `Math.random`. No wall-clock timeouts: use count limits (maximum hatch lines, maximum dash count, maximum recursion). Iterate maps in insertion order.
  - Tessellation tolerance is set in device space (for example chord error ≤ 1/16 px at the target DPI). The segment-count formula must be deterministic.

    **UNKNOWN:** what tessellation AutoCAD's plot uses for arcs, circles and splines. It depends on the PDF vector resolution or the raster DPI rather than VIEWRES. Measure it from PDF output.
- **Transcendental functions.** `Math.sin`, `cos`, `atan2` and `pow` are implementation-approximated in ECMAScript. V8 (Node and Chrome) uses an fdlibm port and is stable across operating systems. SpiderMonkey and JSC may differ in the last ulp.
  - For bit-exact goldens, run the golden tests in Node only.
  - Or ship a tiny fdlibm-derived `sin`/`cos`/`atan2` in `@truedxf/geometry`, behind a `strictMath` flag, if cross-engine exactness ever matters. It is not needed for AutoCAD comparison, which is tolerance-based anyway.
- **Snapping.** Snap only at the final device transform: convert paper mm to px as `x_px = (x_mm − origin) * dpi / 25.4`.
  - Define the pixel-centre convention explicitly: pixel (i, j) covers [i, i+1) and its centre is at +0.5. Do the Y flip there as well.
  - Do not round intermediate geometry.
- **Fonts.** Only fonts in the corpus, loaded by explicit path, never through system lookup. Glyph outlines are cached per (font hash, glyph).

**C. Our own rasterizer (`render-raster`) as the oracle.**

Pure TS, with no reliance on Skia or Cairo behaviour. Everything is our own rule, so we can tune it to match AutoCAD.

- **Fill modes.**
  - *Aliased*: a pixel is covered if its centre is inside the polygon, with the nonzero or even-odd rule and a top-left tie-breaking convention (as in D3D/GDI).
  - *Antialiased*: exact area coverage per pixel (analytic, like the stb_truetype and tiny-skia approaches). Blend in 8-bit sRGB with a documented formula. Choose one blend space and never use gamma-dependent blending in the aliased mode.
- **Strokes.** Converted to polygons by `@truedxf/geometry`'s stroker, so SVG, canvas, WebGL and raster all fill the same outline. Hairlines (lineweight 0, or below 1 px after scaling) take a dedicated 1-px rule, for example Bresenham with the diamond-exit rule.

  **ASSUMPTION:** AutoCAD plots lineweight 0 as the device's minimum width, 1 px on raster. Needs a test.
- **Lineweight to pixels.** `w_px = lw_mm * dpi / 25.4`, then a rounding rule to be decided: round, ceil, floor+1, or `max(1, round)`. **UNKNOWN:** plot the 24 standard lineweights at 72, 150, 300 and 600 dpi in AutoCAD and measure.
- **Caps and joins.** The defaults from AutoCAD's "Use object end style" and "Use object join style" are **UNKNOWN**. The ASSUMPTION is round caps and round joins for lineweighted geometry.
  - The CTB can override them with butt, square, round or diamond ends, and miter, bevel, round or diamond joins. ezdxf's `acadctb.py:133-149` parses these fields.
  - Plotted TTF text is a fill with no stroke. SHX text is strokes at the entity's lineweight (ezdxf `pipeline.py:308`). **Needs an AutoCAD test** for SHX text lineweight.
- **Overlap merging.** "Merge control: lines overwrite vs lines merge" changes the colour where lines of different colours overlap on raster devices. Implement both modes, and confirm the semantics with an AutoCAD test.
- **Colour.** Exact ACI palette. CTB mapping by resolved ACI. Screening as linear intensity towards white (**ASSUMPTION**). Transparency as alpha over the already-plotted content, or ignored when "plot transparency" is off.

**D. Comparison metrics** (`@truedxf/testkit`).

1. **Vector level**, against the AutoCAD PDF. Match strokes and fills by colour and width. Compute the symmetric Hausdorff distance in paper mm between the flattened paths. Threshold: below 1 device px at the test DPI. This finds logic bugs such as a wrong dash phase or text position even when the raster is ambiguous.
2. **Raster, exact.** The count of mismatching pixels after both sides are rasterized by the same rasterizer, with AA off. The target is zero on simple fixtures.
3. **Raster, tolerant.** Every ink pixel in A must have an ink pixel of the same colour within r px in B, and the reverse, computed via a distance transform. Report r = 0, 1, 2. Also compare ink-count ratios per colour.
4. **Visualisation.** A `pixelmatch` diff image with `threshold` near 0 for aliased output, SSIM as a trend metric, and an HTML report with per-fixture history.
5. **Budgets per fixture class.** Geometry-only fixtures must be exact. Text fixtures get tolerance r ≤ 1 until the font metrics are verified. Hatch fixtures are exact once the pattern origin rules are pinned.

**E. Viewer vs oracle.**
- The WebGL and canvas backends are checked against `render-raster` with the tolerant metric (they are antialiased and GPU-dependent). Only `render-raster` is checked against AutoCAD. This keeps GPU nondeterminism out of the AutoCAD comparison.
- The WebGL backend should get its outlines from the same stroker at plot DPI when "plot preview" mode is active. Its interactive mode can use cheaper screen-space wide lines.

---

## 17. Open questions and test ideas

**CONFLICTs noted.**
- **Versions.** dxf-json is 0.14.1 on npm but 1.0.0 in the repo. tarikjabiri is 2.9.0 on npm but 3.0.0-alpha.14 in the repo. Pin whichever is actually released if we ever benchmark against them.
- **MINSERT offsets.** bjnortier says row and column offsets are "affected by rotation but NOT by scale" (`bjnortier-dxf:src/denormalise.js:17-33`). ezdxf and QCAD also apply offsets in the block's rotated frame. Needs an AutoCAD test with non-uniform scale.
- **TTF height.** ezdxf (`ttfonts.py:97-110`) and QCAD (`RTextRenderer.cpp` about lines 1840–1860) both define TTF text height as the cap height of "A". AutoCAD's documented behaviour relates height to the font's em/ascent metrics. **UNKNOWN / needs AutoCAD test.**
- **Hatch pattern transform.** dxf-viewer applies the embedded HATCH definition lines without extra transforms, based on observing the Autodesk viewer (`DxfScene.js:1281-1288`). ezdxf un-scales and un-rotates them back to a base pattern and re-applies the transform (`properties.py:899-965`). Both should give the same result if the file is consistent. **Test with a file whose 52/41 values disagree with its definition lines.**

**UNKNOWN / needs AutoCAD test.** This list feeds the test-generation backlog.
1. Lineweight to pixel rounding on PNG plots: 24 lineweights × 4 DPIs.
2. Lineweight 0 (hairline) width on PNG and PDF.
3. Default line end and join style when plotting with lineweights: L-shaped and T-shaped polylines at 2.11 mm.
4. Whether PublishToWeb PNG applies antialiasing, and to what: lines, fills, text.
5. Merge control semantics on overlapping coloured lines.
6. Arc and circle tessellation in PDF output vs the PC3 vector resolution setting.
7. SHX text stroked with the entity lineweight: yes or no.
8. Screening formula (for example 50 % screening on ACI 1).
9. Draw order of viewport content vs paper-space entities. ezdxf draws viewports last (`frontend.py:1044-1069`); verify.

**Test ideas.** Small DXF files that would pin the behaviour down against AutoCAD.
- `lw_ladder.dxf`: 24 horizontal and 24 diagonal lines, one per standard lineweight, in paper space at 1:1. Plot to PDF and to PNG at 72, 150, 300 and 600 dpi.
- `caps_joins.dxf`: an open LWPOLYLINE with 90°, 30° and 150° corners, lineweight 2.11 mm, plotted with the default CTB and with CTB overrides for each end and join style.
- `hairline.dxf`: lineweight 0 lines at 1°, 45° and 89°, plotted to PNG. Tests the 1-px rule and its coverage pattern.
- `merge_control.dxf`: red and blue 1 mm lines crossing, with merge control set to "overwrite" and then "merge".
- `arc_tess.dxf`: circles with radius 1, 10 and 100 mm, plotted to PDF at vector resolutions 400, 1200 and 4800 dpi. Count the segments in the PDF path.
- `text_metrics_ttf.dxf`: "HxgÅ" in Arial, height 10, all 15 TEXT alignments. Compare glyph bboxes with the cap-height hypothesis.
- `shx_lineweight.dxf`: TEXT in txt.shx on a layer with lineweight 0.70 mm, plotted with lineweights on.
- `screening.dxf`: ACI 1–7 solids with a CTB at screening 100, 50 and 0.
- `vp_draworder.dxf`: a paper-space solid partly overlapping a viewport whose model content is a solid of a different colour. Check which is on top in the plot.
- `minsert_nonuniform.dxf`: MINSERT 3×2 with row and column spacing, rotation 30° and xscale 2, yscale 0.5.
- Corpus bootstrap: run ezdxf's `examples_dxf/*.dxf` (MIT) and GDAL's `autotest/ogr/data/dxf/*.dxf` (MIT) through AutoCAD (open, save as every version, plot). ACadSharp's `save_samples.lsp` shows how to automate the AutoCAD side.
