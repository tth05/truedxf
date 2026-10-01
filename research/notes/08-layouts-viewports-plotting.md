# 08 — Layouts, viewports and plotting (incl. the AutoCAD reference-plot harness)

Scope: model space vs. paper space, the LAYOUT / PLOTSETTINGS objects, the VIEWPORT entity
(and the model-space VPORT `*ACTIVE`), how model space is mapped into paper space, how ezdxf
renders layouts, what AutoCAD's PLOT does, and how we drive `accoreconsole.exe` to produce
the ground-truth PNGs. The note ends with a recommended plot recipe, open questions and test ideas.

Conventions: `spec p.N` = AutoCAD 2012 DXF Reference (page numbers as printed),
`oda` = ODA DWG spec text, `ezdxf:path:line`, `ezdxf#N` = issue/PR/discussion dump under
`research/github/raw/mozman__ezdxf/threads/`, likewise `acadsharp#N`, `mlightcad-viewer#N`,
`realdwg-web#N`, `netdxf#N`. Web sources are given as URLs. Several Autodesk pages (forums,
knowledge-base articles) return HTTP 403 to automated fetches, so a few facts only come from
search-result snippets; they are marked as such.

---

## 0. The main points

1. **The model space and the *active* paper-space layout live in the ENTITIES section.** Other
   layouts live in BLOCKS as `*Paper_SpaceN`. The *owner handle* (330) decides where an entity
   belongs; 67 is only a fallback. 410 (layout name) is informational.
2. **The DXF reference is wrong or misleading in several places relevant here:**
   - PLOTSETTINGS 48/49 = plot-window **lower-left X/Y** and 140/141 = **upper-right X/Y**
     (the spec prints "49 = Y of upper-right" and "140 = X of lower-left").
   - `$PSLTSCALE` meanings are **swapped** in the spec: 1 = viewport scale governs linetype
     scaling (the default), 0 = no special scaling.
   - VIEWPORT 10 (center) is in **paper-space** coordinates, not WCS. 12 (view center) is in
     **DCS**, i.e. relative to the target (17) and rotated by the twist.
   - VPORT table view height is group **40** (aspect 41), not 45.
   - VIEWPORT frozen layers use group **331** in DXF. The ODA spec lists 341 (the DWG handle-reference label).
   - VIEWPORT "335/343/344/91 soft pointers for layer VP overrides" in the spec actually belong in the
     LAYER's extension-dictionary XRECORDs (`ADSK_XREC_LAYER_*_OVR`), not in the VIEWPORT.
3. **Model → paper transform (parallel projection).** With DCS axes (Xd, Yd, Zd = view direction):
   `paper = vp.center + s * ( Rz(twist) * [Xd·(P−T), Yd·(P−T)] − viewCenterDCS )`, where
   `s = vp.height(41) / viewHeight(45)`. ezdxf and mlightcad **disagree on the sign of the
   twist** (see 3.5). **VERIFIED-BY-ACAD (§10.10, calibration/vp-twist): ezdxf is right,
   +twist = content rotates CCW on paper.**
4. **The raster plot driver works at a fixed 100 DPI.** Pixel paper sizes are "dimensionless".
   Lineweights in mm are converted with 100 px/inch: 0.25 mm ≈ 0.98 px, 0.50 mm ≈ 1.97 px,
   2.11 mm ≈ 8.3 px. **VERIFIED-BY-ACAD (§10.4): 100 dpi on every canvas,
   px = max(1, round(mm × 100/25.4)).** The larger the pixel size, the thinner lines *look*.
5. **The accoreconsole command line is `accoreconsole.exe [/i <dwg|dxf>] /s <script> [/product <p>] [/l <lang>]
   [/isolate <userid> <userDataFolder>] [/readonly] [/p[rofile] <profile>] [/loadmodule <module>]`.**
   Opening a **DXF** with `/i` works (ixmilia-dxf integration tests do it). stdout is **UTF‑16LE**.
   There is no GUI, FILEDIA is forced to 0, and COM/`vla-*` LISP does not work. Every newline in
   a `.scr` is an Enter, and so is a *space* at most prompts.
6. **The recommended harness recipe** is a dedicated copy of *PublishToWeb PNG.pc3* with a custom pixel
   size, plot area **Window** with explicit coordinates, **Fit**, **Center**, `monochrome.ctb`
   or `acad.ctb` (fixed per test class), lineweights on, *scale lineweights* off, paper space
   first, and all relevant sysvars pinned by the script (§7).

---

## 1. Model space vs. paper space

### 1.1 Block records, sections, names

- Every layout has a BLOCK_RECORD + BLOCK/ENDBLK and (R2000+) a LAYOUT object in the
  `ACAD_LAYOUT` dictionary (`ezdxf:docs/source/dxfinternals/layout_management.rst`).
- `*Model_Space`: the model space. Its entities are written to the ENTITIES section; its BLOCK in
  BLOCKS is empty.
- `*Paper_Space`: the **active** paper-space layout. Its entities are also in the ENTITIES section,
  with 67 = 1.
- `*Paper_Space0`, `*Paper_Space1`, …: the other (inactive) layouts. Their content is stored as
  BLOCK content in the BLOCKS section. The numbering does not have to be consecutive; AutoCAD
  tolerates gaps (ezdxf layout_management.rst; acadsharp#1096 review: "after the first one, the
  others don't seem to effect the output").
- DXF R12 names are `$MODEL_SPACE` / `$PAPER_SPACE`, and R12 has only **one** paper space. The
  R12 VIEWPORT stores its view data in XDATA `ACAD`/`MVIEW` (`ezdxf:src/ezdxf/entities/viewport.py:
  load_xdata_into_dxf_namespace`, which lists the tag order).
- **Names are case-insensitive.** AutoCAD accepts `*MODEL_SPACE`. acadsharp#1197
  (**VERIFIED-BY-ACAD**, AutoCAD 2027): a DXF whose model space was written as an *ordinary block*
  in BLOCKS (because of the upper-case name) was still read and drawn correctly by AutoCAD:
  "the round trip audits 0 errors and plots within 0.4% of the source". So AutoCAD associates
  entities by block record, not by section.
- BLOCK_RECORD 340 → LAYOUT handle; LAYOUT 330 (in AcDbLayout) → BLOCK_RECORD. Broken links exist
  in the wild (QGIS writes fixed handles). ezdxf recovers them by pairing unassigned
  `*Paper_Space*` blocks with dangling LAYOUTs in order of appearance
  (`ezdxf:notes/pages/Read messed up LAYOUT structure created by QGIS.md`).
  truedxf: LAYOUT 330, then BLOCK_RECORD 340, then "Model" by name, then the same pairing in order
  of appearance (diagnostic `layout-relinked`; 34 corpus files, mostly QGIS).
- Files produced by LibreDWG-based converters may reference `*Model_Space`/`*Paper_Space` twice or
  not at all. AutoCAD/ODA tolerate this (acadsharp#1157).

### 1.2 Entity group codes 67 and 410

- 67: 0/absent = model space, 1 = paper space. 410 (R2000+): layout name.
- Loader rule in ezdxf (`ezdxf:src/ezdxf/sections/entities.py:_build`): **the owner handle (330)
  has priority**. If the owner is `*Model_Space` → msp, if it is `*Paper_Space` → active psp, else
  fall back to 67. We should use the same rule.
- dxf-viewer only has `inPaperSpace` (from 67) and a `suppressPaperSpace` option. It does not
  support viewports (`dxf-viewer:src/parser/ParseHelpers.js:114`, `src/DxfScene.js:221`). If we
  rendered the ENTITIES section blindly, we would draw model and paper entities on top of each other.

### 1.3 Which layout is "active"? `$TILEMODE`

- The active paper-space layout is the one whose block record is named `*Paper_Space`
  (`ezdxf:src/ezdxf/layouts/layouts.py:get_active_layout_key`). Switching the active layout =
  swapping block names (ezdxf `set_active_layout`).
- `$TILEMODE` (70): 1 = the Model tab is current, 0 = a layout tab is current (the one owning
  `*Paper_Space`). The spec text "1 for previous release compatibility mode" is historical
  wording. ezdxf default 1.
  **VERIFIED-BY-ACAD** (acadsharp#1188, AutoCAD 2027): when `$TILEMODE` was *missing* from the
  header, "the file opened in paper space". So the missing value behaves like 0. Our writer must
  always emit `$TILEMODE`.
- `CTAB` (current tab name) is a sysvar but not a DXF header variable.
- In the harness we never rely on the "current" layout. `-PLOT` asks for the layout name
  explicitly (§6.4).
- For the renderer's default view: TILEMODE=1 → model space via VPORT `*ACTIVE`. TILEMODE=0 → the
  active paper-space layout, viewed through its overall viewport (id 1).

### 1.4 Layout tab order

- LAYOUT 71 = tab order. "Model" is always shown first regardless of its value (spec p.176).
  ezdxf uses 0 for Model and 1..n for the others (`layouts.py:setup_modelspace/new`). Values need
  not be consecutive. Sort by (71, name)? ezdxf `names_in_taborder` sorts `(taborder, name)`.
- ezdxf `Layouts.get(None)` → first paper-space layout in tab order.

### 1.5 Layout-related header variables

| Var | Code | Meaning / notes |
|---|---|---|
| `$TILEMODE` | 70 | See 1.3. |
| `$MAXACTVP` | 70 | Max. number of viewports regenerated at once (default 64). **It does not affect how many viewports are plotted** (BricsCAD/AutoCAD sysvar docs via search, https://help.bricsys.com/en-us/document/system-variable-reference/m/maxactvp-system-variable). Viewports beyond the limit show status 68 = −1. |
| `$PSLTSCALE` | 70 | **CONFLICT:** spec p.1376 says "1 = No special linetype scaling, 0 = Viewport scaling governs". The real meaning (AutoCAD/BricsCAD sysvar docs, https://help.autodesk.com/cloudhelp/2016/ENU/AutoCAD-LT/files/GUID-23EA4D64-AE7D-41E5-A8D0-20F060313D62.htm, and the ezdxf#1386 description) is **0 = no special scaling** (dash lengths in the units of the space where the object lives) and **1 = viewport scaling governs** (dash lengths on paper are the same in every viewport). Default 1. The per-layout value is LAYOUT 70 bit 1 and the header shows the current layout's value. netdxf#126: changing the header had no effect in AutoCAD, only LAYOUT 70 did. **ASSUMPTION:** AutoCAD uses LAYOUT 70 bit 1 per layout when it plots that layout. |
| `$PLIMMIN/$PLIMMAX`, `$PEXTMIN/$PEXTMAX`, `$PINSBASE`, `$PUCS*`, `$PELEVATION`, `$PLIMCHECK` | | Values for the *active* paper space (copies of the active LAYOUT's 10/11/14/15/12 …). Every LAYOUT carries its own (ezdxf `concepts/extents_limits.rst`). |
| `$LIMMIN/$LIMMAX`, `$EXTMIN/$EXTMAX` | | Model space. The EXTMIN default is (1e20,1e20,1e20) and EXTMAX (−1e20,…) = "empty". **These are often stale.** mlightcad-viewer#347 switched from EXTMIN/EXTMAX to computed bounds. |
| `$PSVPSCALE` | 40 | Scale for *new* viewports (0 = fit). Only matters for authoring. |
| `$VISRETAIN` | 70 | Retain xref layer visibility. Relevant for frozen-layer state of xref layers. |
| `$LWDISPLAY` | 290 | Screen display of lineweights only. **Does not affect plots.** |
| `$ENDCAPS`, `$JOINSTYLE` | 280 | Lineweight end-cap/join settings for new objects (ezdxf notes "Line Cap- and Join Styles.md": 0 none, 1 round, 2 angle, 3 square). Their effect on plots with CTB "use object end style" is UNKNOWN. |
| `$PSTYLEMODE` | 290 | 1 = color-dependent (CTB) and 0 = named plot styles (STB). This decides which kind of table the layouts' 7 refers to. |
| `CANNOSCALE`, `MSLTSCALE` | — | **Not header variables.** They are stored as DICTIONARYVAR objects in the `AcDbVariableDictionary` of the root dictionary (`ezdxf:src/ezdxf/sections/header.py:49-62`). MSLTSCALE=1 (default in new drawings) scales model-tab linetypes by the annotation scale, which matters for model plots if CANNOSCALE ≠ 1:1. |
| `LWDEFAULT` | — | **Registry / user setting, not a drawing setting.** The value used for lineweight "Default" (−3) at plot time. Default 0.25 mm. The harness must pin it (§7). |

---

## 2. LAYOUT and PLOTSETTINGS objects

A LAYOUT object = `AcDbPlotSettings` subclass + `AcDbLayout` subclass. A standalone PLOTSETTINGS
object (a named page setup, stored in the `ACAD_PLOTSETTINGS` dictionary) has only the first
subclass (spec p.176-178, p.189-191; `ezdxf:src/ezdxf/entities/layout.py`;
`ixmilia-dxf:src/IxMilia.Dxf.Generator/Specs/ObjectsSpec.xml:707`).

### 2.1 AcDbPlotSettings group codes

All lengths are in **mm**, unless noted.

| Code | Meaning | Notes / defaults |
|---|---|---|
| 1 | Page setup name | ezdxf default ""; ACadSharp default "none_device" (sic). |
| 2 | Printer / PC3 name | e.g. `PublishToWeb PNG.pc3`, `DWG To PDF.pc3`, `none_device`. An empty string means the default printer (ezdxf comment). |
| 4 | Paper size = **canonical media name** | Scheme `Name_(W_x_H_Unit)`, e.g. `ISO_A4_(210.00_x_297.00_MM)`, `Letter_(8.50_x_11.00_Inches)`. For raster devices the unit is `Pixels` (ASSUMPTION about the exact spelling). The UI/-PLOT shows a *localized display name* such as `ISO A4 (210.00 x 297.00 MM)`. ezdxf docs: "the part in front of the braces is ignored by AutoCAD" (for unknown devices). libredwg calls it `canonical_media_name`. |
| 6 | Plot view name | Used by plot type 3. In DWG ≥ R2004 it is a handle to the VIEW (libredwg `dwg.spec:5246ff`). |
| 40/41/42/43 | Unprintable margin left/bottom/right/top | Device-defined printable area. ezdxf doc: 40/41 also define the plot origin. |
| 44/45 | Physical paper width/height | Stored in *unrotated device* orientation. For raster devices **ASSUMPTION** px × 25.4/100 (e.g. 640 px → 162.56 mm), consistent with the fixed 100 DPI (§5.3). |
| 46/47 | Plot origin offset X/Y | In mm, even for inch layouts. Relative to the printable area's lower-left (PLOTOFFSET=0) or to the paper edge (PLOTOFFSET=1), §5.2. |
| 48/49 | Plot window **lower-left** X/**Y** | **CONFLICT:** spec p.190 says "49 = Y value of upper-right". ezdxf, ixmilia, ACadSharp and libredwg (`plot_window_ll` 48 / `plot_window_ur` 140) all agree on LL = (48,49), UR = (140,141). |
| 140/141 | Plot window **upper-right** X/Y | Spec says "140 = X of lower-left"; that is wrong, see above. Coordinates are in drawing units of the plotted space (WCS for model if UCS = World; paper units for layouts). |
| 142/143 | Custom scale numerator (paper units) / denominator (drawing units) | 1:50 → 142 = 1, 143 = 50. "Paper units" = 72 units (inch or mm). |
| 70 | Plot layout flags | See 2.2. Default 688. |
| 72 | Plot paper units | 0 = inches, 1 = mm, 2 = pixels. ezdxf comment "are pixels really supported?". For raster PC3s AutoCAD sets 2 (ASSUMPTION). |
| 73 | Plot rotation | 0 = none, 1 = 90° CCW, 2 = upside-down (180°), 3 = 90° CW. `-PLOT` "orientation" + "upside down" map to this; which combination gives 1 vs 3 is **UNKNOWN**. |
| 74 | Plot type | 0 = last screen display, 1 = drawing extents, 2 = drawing limits, 3 = view (code 6), 4 = window (48/49/140/141), 5 = layout. ezdxf default 5; ixmilia/ACadSharp default 1. |
| 7 | Current style sheet | CTB/STB file name, e.g. `acad.ctb`, `monochrome.ctb`. "" = none. **A long name can break readers** (ezdxf#1273). |
| 75 | Standard scale type | 0 = scaled to fit, 1..15 imperial (1/128"=1' … 1'=1'), 16 = 1:1 … 32 = 1000:1. The full table is in 2.3. ezdxf writes 16 also when a custom scale is used. |
| 76 | Shade plot mode | 0 as displayed, 1 wireframe, 2 hidden, 3 rendered (R2004+). |
| 77 | Shade plot resolution | 0 draft, 1 preview, 2 normal, 3 presentation, 4 maximum, 5 custom. |
| 78 | Shade plot custom DPI | 100..32767, used only if 77 = 5. |
| 147 | Spec: "floating point scale factor that represents the standard scale value specified in code 75" | **CONFLICT:** ezdxf calls it `unit_factor`, "DXF Reference error", 1.0 for mm and 1/25.4 for inches (`ezdxf:entities/layout.py:185`, `layout_management.rst`). ixmilia (`StandardScaleValue`) and ACadSharp (`StandardScale`) follow the spec. **UNKNOWN / needs AutoCAD test:** DXFOUT page setups with inch/mm units and a standard scale ≠ 1:1. |
| 148/149 | Paper image origin X/Y | Unknown semantics; usually 0. |
| 333 | Shade plot ID (optional) | Handle (visual style / render preset?). |
| XDATA `PLOTTRANSPARENCY` 1071 | "Plot transparency" checkbox | Stored as XDATA on the LAYOUT (`ezdxf:entities/layout.py:200`). Overridden globally by sysvar `PLOTTRANSPARENCYOVERRIDE` (§5.5). |

DWG field order (ODA 20.4.84, libredwg `dwg.spec:5223`) differs, but the semantics are the same.

### 2.2 Plot layout flags (70) — bitfield

(spec p.190, ezdxf `entities/layout.py:59-78`, ixmilia `ObjectsSpec.xml`, ACadSharp `PlotFlags.cs`)

| Bit | Name | Meaning / UI mapping |
|---|---|---|
| 1 | PlotViewportBorders | ObjectARX `plotViewportBorders`. No checkbox in the current UI. **VERIFIED-BY-ACAD: no effect on plotted frames (§10.12).** The VIEWPORT frame's plottability is normally governed by its layer (mlightcad-viewer#338). |
| 2 | ShowPlotStyles | "Display plot styles" in the layout (screen only). |
| 4 | PlotCentered | "Center the plot". |
| 8 | PlotHidden | "Hide paperspace objects" (HIDE applied to paper-space 3D objects). |
| 16 | UseStandardScale | 75 is used instead of 142/143 (ezdxf `page_setup` clears it: "works best, don't know why"). |
| 32 | PlotPlotStyles | "Plot with plot styles". |
| 64 | ScaleLineweights | "Scale lineweights" (layouts only). |
| 128 | PrintLineweights | "Plot object lineweights". |
| 512 | DrawViewportsFirst | ObjectARX name. **Presumably** the "Plot paperspace last" checkbox ("Plots model space geometry first. Paper space geometry is usually plotted before model space geometry", Plot dialog help https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-264D3513-0D22-4461-82D6-14F391BC5CDE.htm). **CONFLICT/UNKNOWN:** AutoCAD's own default layouts are commonly written with 70 = 688 (= 16+32+128+512, Model: 1712 = 688+1024). That would mean "paperspace last" is on by default, while the UI default appears to be off. mozman in ezdxf#634: "even AutoCAD (TrueView) ignores this flag". Must be tested (test idea T-VP-8). **VERIFIED-BY-ACAD (§10.12): bit 512 set → the -PLOT prompt "Plot paper space first?" defaults to No = viewports first, paper space on top.** |
| 1024 | ModelType | Set for the Model layout's LAYOUT (ezdxf sets it on export if name == "Model"). |
| 2048 | UpdatePaper | Internal. |
| 4096 | ZoomToPaperOnUpdate | Internal. |
| 8192 | Initializing | Internal: layout not yet initialized. |
| 16384 | PrevPlotInit | Internal. |

Note: "layout initialization" matters in accoreconsole. The APS notes
(https://blog.autodesk.io/notes-on-using-da4a/) say that layouts *created* by add-ins in
AcCoreConsole are not initialized and "cannot be printed". Layouts in our generated DXFs have
never been displayed by AutoCAD, so they may behave the same way. **UNKNOWN**, test T-ACC-3. A
detailed `-PLOT` that overrides every setting is our best defence.

### 2.3 Standard scale type (75) → (numerator, denominator)

From `ezdxf:src/ezdxf/lldxf/const.py:582 STD_SCALES` (numerator in paper units, denominator in
drawing units; imperial ones use inches per foot → (x, 12)):

```
 0 fit        1 1/128"=1' (1/128,12)  2 1/64"=1'  3 1/32"=1'  4 1/16"=1'  5 3/32"=1'
 6 1/8"=1'    7 3/16"=1'   8 1/4"=1'   9 3/8"=1'  10 1/2"=1'  11 3/4"=1'  12 1"=1' (1,12)
13 3"=1'     14 6"=1'     15 1'=1' (12,12)
16 1:1  17 1:2  18 1:4  19 1:8  20 1:10  21 1:16  22 1:20  23 1:30  24 1:40  25 1:50
26 1:100  27 2:1  28 4:1  29 8:1  30 10:1  31 100:1  32 1000:1
```

The effective scale (drawing unit → mm on paper) is `142/143 × (25.4 if 72==0 else 1)`
(ezdxf `Layout.get_plot_unit_scale_factor`). ezdxf ignores pixels (72 = 2).

### 2.4 AcDbLayout group codes

| Code | Meaning | Notes |
|---|---|---|
| 1 | Layout name | "Model" for model space. Case-insensitive unique. |
| 70 | Flags | 1 = PSLTSCALE value for this layout, 2 = LIMCHECK value. ezdxf default 1. |
| 71 | Tab order | §1.4 |
| 10/20, 11/21 | LIMMIN/LIMMAX (2D) | For paper space: the paper edges relative to the plot origin in paper units (see 2.5). A Revit export had bogus (0,0)-(12,9) limits and AutoCAD "fixed" them on open (ezdxf#864). mlightcad-viewer#284 also sees many DWGs with legacy (0,0)-(12,9). **Never trust layout limits for the page size.** Use 44/45 + margins + rotation. |
| 12/22/32 | INSBASE | |
| 14/24/34, 15/25/35 | EXTMIN/EXTMAX | Stale values are common. Default ±1e20. |
| 146 | Elevation | |
| 13, 16, 17 | UCS origin, X axis, Y axis | |
| 76 | UCS ortho type | 0 not ortho, 1 top … 6 right. ezdxf default 1 (!). |
| 330 | → BLOCK_RECORD | Second 330 in the object (the first 330 = owner dictionary). |
| 331 | → last active VIEWPORT | May point to a model viewport, not to the overall one. |
| 345 / 346 | Named UCS / base UCS | |
| 333 | Shade plot ID | |
| (DWG R2004+) | Viewport handle list | ODA: "Viewport handle (repeats Viewport count times)". It is not in DXF. |

### 2.5 Paper-space coordinate frame vs. the physical sheet

From ezdxf `Paperspace.reset_paper_limits` / `default_viewport_config`
(`ezdxf:src/ezdxf/layouts/layout.py:699-734`). **ASSUMPTION** (derived from AutoCAD-created
examples, not independently verified):

- **Paper-space origin (0,0) = lower-left corner of the printable area + plot origin offset
  (46,47)**, in paper units (inch or mm, divided by the plot scale if ≠ 1:1).
- Hence `LIMMIN = (−(leftMargin+xOff), −(bottomMargin+yOff))` and
  `LIMMAX = (paperW − leftMargin − xOff, paperH − bottomMargin − yOff)`, all in paper units.
- For rotated layouts (73 = 1/3) the physical 44/45 are swapped and the margins are rotated
  (ezdxf drawing add-on `Page.from_dxf_layout`, `addons/drawing/layout.py:223-262`). Its mapping:
  rotation 1 (90°): `top=right, right=bottom, bottom=left, left=top`; rotation 2: top↔bottom,
  left↔right; rotation 3: `top=left, right=top, bottom=right, left=bottom`.
  **UNKNOWN:** is this the direction AutoCAD uses?
- Plot type 5 "Layout": "plots everything within the printable area of the specified paper size"
  (Plot dialog help). This fits the origin rule above. For the harness we use Window instead (§7)
  so that we do not depend on it.

---

## 3. VIEWPORT entity (paper-space viewport, "MVIEW")

### 3.1 Group codes

(spec p.150-155, ODA 20.4.38, `ezdxf:src/ezdxf/entities/viewport.py`, ACadSharp `Entities/Viewport.cs`)

| Code | Meaning | Notes |
|---|---|---|
| 10/20/30 | Center | **In paper-space coordinates** (spec says WCS. Paper-space WCS *is* the paper frame, so "WCS of paper space"). Stored as 3D (ezdxf comment). |
| 40 / 41 | Width / height in paper units | The frame rectangle and the clip rectangle when not polygonal. |
| 68 | Status | −1 = on but off-screen or beyond MAXACTVP, 0 = off, >0 = on; 1 = "active", n = stacking order. **Runtime value, unreliable in files** (3.2). |
| 69 | Viewport ID | 1 = the overall paper-space viewport. **Unreliable** (3.2). ezdxf default 2. |
| 12/22 | View center | **In DCS**: relative to the target (17) and rotated by the twist. mlightcad `realdwg-web#138` (**VERIFIED** on real DWGs: target (750984,−1587549) + center (165042,1206723) = WCS view center of the floor plan). ODA DWG note (quoted in ACadSharp `DwgObjectReader.cs:6645`): "If it's plan view, add the view target (17) to get the WCS coordinates." ezdxf fixed its code for this in ezdxf#1318 / PR #1319. |
| 13/23 | Snap base | |
| 14/24, 15/25 | Snap spacing, grid spacing | |
| 16/26/36 | View direction (WCS), **from target towards the camera** | **May be non-normalized**: ezdxf#1298, "dir is non-normalized. you should normalize it" (fixed in v1.4.3). Default (0,0,1). |
| 17/27/37 | View target (WCS) | |
| 42 | Lens length (mm) | Perspective only (flag 0x1). Default 50. |
| 43 / 44 | Front / back clip plane Z | Offsets from the target along the view direction. Active only with flags 0x2 / 0x4 (0x10 = front clip not at eye). |
| 45 | View height in model units (DCS) | Scale `s = 41/45` (spec NOTE: "ZOOM XP factor = group_41 / group_45"). ACadSharp `ScaleFactor = 1/(ViewHeight/Height)`. View width = `45 * 40/41`. |
| 50 | Snap angle | |
| 51 | View twist angle | Degrees in DXF. The ezdxf code treats it as degrees (`math.radians`), mlightcad keeps radians internally. Sign convention: 3.5. |
| 72 | Circle zoom percent | VIEWRES for this viewport. Display tessellation only; plots are presumably device-resolution (ASSUMPTION). |
| 331 (repeated) | Frozen layers (handles) | DXF uses **331**. ODA lists 341 (DWG). ezdxf `FROZEN_LAYER_GROUP_CODE = 331`, netDxf reads 331, ACadSharp 331. |
| 90 | Status bit flags | Table 3.1.1. |
| 340 | Clip boundary entity handle | Only meaningful if 90 & 0x10000. |
| 1 | Plot style sheet name for this viewport | ezdxf `from_viewport` loads it as the CTB for the viewport. AutoCAD *probably* ignores it for plotting (the layout's table wins). **UNKNOWN.** |
| 281 | Render mode | 0 2D optimized … 6 Gouraud + wireframe. |
| 71 | UCS per viewport | |
| 74 | UCS icon at origin | Ignored. |
| 110/111/112 | UCS origin / X / Y | |
| 345/346, 79 | Named UCS, base UCS, ortho type | |
| 146 | Elevation | |
| 170 | Shade plot mode | 0 as displayed, 1 wireframe, 2 hidden, 3 rendered (R2004+). The "legacy hidden" behaviour changed in AutoCAD 2025 (forum snippet: "shade plot set to legacy hidden … no longer overrides the Wireframe visual style"). |
| 61 | Major grid frequency | R2007+ |
| 332 / 333 / 348 / 361 | Background / shade plot / visual style / sun | 348 is hard/soft depending on version (acadsharp#1149). |
| 292, 282, 141, 142, 63/421/431 | Default lighting flag/type, brightness, contrast, ambient color | Ambient color default ACI 250 (acadsharp#1077: TrueView crashed on Realistic/Conceptual visual styles when it was missing). |
| 335/343/344/91 | "Soft pointer reference to viewport object (for layer VP property override)" | **These are not really VIEWPORT data.** The codes match the per-layer override XRECORDs (3.8). ezdxf discards them on copy: "BricsCAD does not create these". |
| XDICT `ASDK_XREC_ANNOTATION_SCALE_INFO` | XRECORD with 340 → SCALE object | The viewport's annotation scale (ACadSharp `Viewport.Scale`, `Viewport.cs:199-228`). |

#### 3.1.1 Status flags (90)

`0x1` perspective, `0x2` front clip, `0x4` back clip, `0x8` UCS follow, `0x10` front clip not at
eye, `0x20` UCS icon visible, `0x40` UCS icon at origin, `0x80` fast zoom, `0x100` snap, `0x200`
grid, `0x400` isometric snap, `0x800` **hide plot** (hidden-line removal when plotting),
`0x1000/0x2000` isopair top/right, `0x4000` **zoom lock** (display locked), `0x8000` "currently
always enabled", `0x10000` **non-rectangular clipping**, `0x20000` **viewport off**, `0x40000`
grid beyond limits, `0x80000` adaptive grid, `0x100000` subdivide grid, `0x200000` grid follows
workplane (spec p.152, ezdxf `lldxf/const.py:501-528`).

AutoCAD default for the overall viewport: 90 = 557088 (0x88020 = UCS icon + 0x8000 + adaptive
grid; ezdxf `add_new_main_viewport`). The ezdxf doc example shows 819232 (+0x40000).

### 3.2 Overall ("main") viewport, id (69) and status (68)

- Every initialized paper-space layout has at least one VIEWPORT: the **overall paper-space
  viewport**, which describes how the layout itself is shown (location/zoom) on screen. It is
  **not drawn** and has no model content. ezdxf calls it the "main" viewport: AutoCAD needs it,
  it is created on activation, ezdxf does not create one by default
  (`ezdxf:layouts/layout.py:505-596`). Model space has none.
- Nominally: id 69 = 1 and status 68 = 1 for the overall viewport. **In practice both are unreliable:**
  - ezdxf#1014 (alektron): in the paper-space *blocks* **all viewport ids were 0**. After opening
    and saving in AutoCAD **without activating a layout**, all viewports of that layout had
    status 0. "Only the viewports of layouts that have been active at least once during the last
    session seem to have valid status."
  - BricsCAD writes id −1 for "off" viewports and may omit 68 (ezdxf `Viewport.is_visible`).
  - libredwg-web renumbers ids by object id sort order. mlightcad-viewer#284 and #327 therefore detect
    the overall viewport **structurally**: `center == viewCenter` ("looks at itself", 1:1), with a
    fallback on center at origin and height == viewHeight
    (`mlightcad-cad-viewer:packages/pdf-renderer/src/viewport/AcPdfPaperViewport.ts:isDefaultPaperSpaceViewport`).
  - mlightcad-viewer#197: real user viewports with number 0 were skipped by a `number > 1` test.
- ezdxf's renderer: sort by status, drop status ≤ 0, drop the first one if its status is 1, draw
  the rest in status order (`ezdxf:src/ezdxf/addons/drawing/frontend.py:1044-1069`).
  **Consequence:** viewports of a layout that was not active in the last AutoCAD session
  (status 0) are *not drawn* by ezdxf. AutoCAD plots them (UNKNOWN, but almost certain).
- **Answered by AutoCAD in §10.12** (overall = id 1; on/off = 68 in the active layout; plot order
  by handle). The original proposal was:
- **Proposal for truedxf (ASSUMPTION, verify with T-VP-1/2):**
  - The overall viewport is the **first VIEWPORT in the layout's entity order** if its id is 1,
    or if its geometry matches the structural fingerprint. Otherwise take the first with id == 1.
  - A model viewport is **on** iff `!(90 & 0x20000)`, and 68 is not used for on/off.
    AutoCAD writes 68 = 0 for inactive layouts, so 68 cannot be the persistent on/off flag. The
    ODA DWG VIEWPORT has no 68 at all (status is 90), which supports this.
  - Draw order of viewports: entity order (3.10), not status order.

### 3.3 Viewport scale

- `s = height(41) / viewHeight(45)` paper units per model unit (spec NOTE; ezdxf `get_scale`;
  ACadSharp `ScaleFactor`). Viewport width in model units = `45 * 40/41`.
- Aspect ratio of the model window = aspect of the paper rectangle (the model window is never
  distorted). mlightcad computes separate `sx` and `sy` (`AcPdfPaperViewport.ts:buildModelToPaperMatrix`),
  which gives the same result only because the model box is built from 45 and 40/41.
- "Custom scale" in the UI is exactly `s` (with inch/mm conversion to 72 units). The annotation
  scale is separate (XRECORD, 3.1).

### 3.4 DCS (display coordinate system)

- The DCS origin is the target (17) and its Z axis is the view direction (16) (ezdxf
  `concepts/coordinates.rst:70-80`: "a viewport is always a plan view of its DCS". ezdxf does not
  support DCS otherwise).
- **DCS X/Y axes: ASSUMPTION** — the arbitrary axis algorithm (the OCS rule) applied to the view
  direction, then rotated about Z by the twist. Sanity checks with the AAA:
  - Top view N=(0,0,1): Xd = (1,0,0), Yd = (0,1,0). ✔ (matches plan views)
  - SW iso N ∝ (−1,−1,1): Xd = Wz×N ∝ (1,−1,0) horizontal, Yd ∝ (1,1,2) has +Z. So WCS Z points
    "up" on screen, as AutoCAD shows isometric views. ✔
  - Bottom view N=(0,0,−1): Xd = Wy×N = (−1,0,0). That is a mirrored X. Whether AutoCAD shows it
    this way or adds a twist is UNKNOWN (T-VP-6).
- The ODA eye coordinate system presumably uses `OdGeVector3d::perpVector()` (AAA) for the same
  purpose. Not verified in local sources.

### 3.5 Model space → paper space transform (parallel projection)

```
d      = normalize(viewDirection(16))            # guard: zero → (0,0,1)
(Xd,Yd)= arbitraryAxis(d)                        # ASSUMPTION, 3.4
q      = P_wcs − target(17)
u      = ( Xd·q , Yd·q )                         # DCS before twist
w      = Rz(twist) · u                           # SIGN: see CONFLICT below
paper  = center(10).xy + s · ( w − viewCenter(12) ),   s = h(41)/viewHeight(45)
depth  = d·q     (used for front/back clip only)
```

- For top views this reduces to ezdxf `Viewport.get_transformation_matrix`
  (`ezdxf:src/ezdxf/entities/viewport.py:640-655`):
  `T(−target) · S(s) · Rz(+twist) · T(center − viewCenter·s)` (row vectors, left to right).
  The ezdxf test `test_modelspace_limits_rotated` (twist 90, vc (2,2), s = 0.5 → msp limits
  x∈[1,3], y∈[−4,0]) pins the ezdxf convention.
- **CONFLICT (twist sign):**
  - ezdxf: WCS→paper rotates by **+twist**, so WCS view center = `target + Rz(−twist)·vc`.
  - mlightcad (`realdwg-web:packages/graphic-interface/src/AcGiViewport.ts:dcsCenterToWcs`, and
    `AcPdfPaperViewport.ts:buildModelToPaperMatrix` "M = T(paperCenter)·S·R(−twist)·T(−modelCenter)"):
    WCS view center = `target + Rz(+twist)·vc`, i.e. WCS→paper rotates by **−twist**.
  - Evidence for ezdxf's sign: DVIEW TWist, where a positive angle rotates the view CCW and "−45 will
    rotate the view in the clockwise rotation" (https://autocadtips1.com/2013/06/03/dview-with-a-twist-rotating-a-viewport-view/).
    The LISP idiom `(setvar "snapang" (- (getvar "viewtwist")))` (search snippet, AUGI "Rotate
    Viewport") means a WCS line at angle −VIEWTWIST appears horizontal. So screen angle = WCS angle +
    twist.
  - mlightcad's twist path is covered only by a unit test (realdwg-web#138) and was not checked
    against AutoCAD.
  → **UNKNOWN / needs AutoCAD test T-VP-4** (twisted viewport showing an arrow).
- ezdxf's model-space window (`get_modelspace_limits`) is used for culling only: the axis-aligned
  bbox of the inverse-transformed frame corners (PR #1319).
- ezdxf renders **only top views**: `if not vp.is_top_view: "Cannot render non top-view
  viewports"` (`frontend.py:685`). mlightcad renders only 2D as well.
- **Perspective (0x1):** not supported by any reference library. AutoCAD perspective = camera at
  `target + d·dist` (distance is not stored directly; lens length 42 with a 35 mm-film
  convention). **UNKNOWN**, low priority.
- **Front/back clipping (0x2/0x4):** clip where `depth > front` / `depth < back` (offsets from
  the target). Not supported anywhere locally. Low priority.
- 3D entities (non-Z-up OCS) need the full projection. The z of 2D entities with elevation /
  thickness also matters once d ≠ Z.

### 3.6 Clipping by the viewport border

- **Rectangular:** the paper rectangle `center ± (w/2, h/2)` (`Viewport.clipping_rect_corners`).
- **Non-rectangular:** flag 0x10000 and 340 → a paper-space entity. ezdxf's comment lists
  "LWPOLYLINE (2D POLYLINE), CIRCLE, ELLIPSE, closed SPLINE". AutoCAD MVIEW/VPCLIP also accept
  regions (ASSUMPTION). ezdxf builds the path with `make_path(clip_entity)`
  (`ezdxf:src/ezdxf/path/converter.py:224`) and flattens curves with max sagitta 0.1 mm (1/254"
  for inch layouts) (`pipeline.py:enter_viewport`). It chooses rect / convex / concave clipping
  shapes (`ezdxf:src/ezdxf/tools/clipping_portal.py`). Known ezdxf bugs: filled paths in
  viewports (ezdxf#1055), inverted polygon clipping (ezdxf#1101), `None` vertices (PR #1113).
- The clip entity is an ordinary paper-space entity and is drawn/plotted with its own properties.
  In that case the VIEWPORT's own rectangle is (ASSUMPTION) *not* drawn, and 40/41 are the bbox
  of the clip entity (T-VP-5).
- **Is clipping geometric or at pixel level?** In AutoCAD a thick lineweight stroke crossing the
  border is cut at the border edge, not with a round cap (ASSUMPTION). Text and hatches are
  clipped partially. **UNKNOWN**, test T-VP-3.
- **VERIFIED-BY-ACAD (§10.12):** the frame plots in the VIEWPORT's colour, 1 px, continuous
  (lineweight/linetype ignored); off/frozen/no-plot/Defpoints layers hide only the frame; polygonal
  viewports draw no rectangle. The original assumption was:
- **The VIEWPORT frame itself** (the rectangle or the polygon) is drawn with the VIEWPORT entity's
  layer/color/linetype/lineweight. It is not plotted if that layer is off/frozen/non-plottable.
  Using a no-plot layer "is a common AutoCAD convention precisely so their frames stay off the
  printed sheet" (mlightcad-viewer#338). AutoCAD desktop *displays* no-plot layers but does not
  plot them. The AutoCAD Web Viewer does not draw them (mlightcad maintainer, same thread).
  ezdxf does **not** draw frames at all (ezdxf#1318: "viewport's outline not rendered as
  should … all CADs draws line around viewports"; PR #1320 "render viewport as regular entity"
  was closed).

### 3.7 Frozen layers and per-viewport layer overrides

- VIEWPORT 331 (repeated) → LAYER handles frozen *in this viewport* (VPLAYER/"VP Freeze").
  Entities on these layers are not drawn inside that viewport. Global freeze/off still applies.
- LAYER flag 2 ("frozen by default in new viewports") affects only viewport *creation* and is
  not a render rule.
- **Layer VP overrides** (color, linetype, lineweight, transparency; R2008+) are stored in the
  **LAYER's extension dictionary** as XRECORDs
  (`ezdxf:src/ezdxf/lldxf/const.py:693-707`, `entities/layer.py:640-800`):
  `ADSK_XREC_LAYER_COLOR_OVR` (420 true color or ACI-encoded), `ADSK_XREC_LAYER_LINETYPE_OVR`
  (343 → LTYPE), `ADSK_XREC_LAYER_LINEWT_OVR` (91), `ADSK_XREC_LAYER_ALPHA_OVR` (440). Each entry
  is `102 {ADSK_LYR_*_OVERRIDE / 335 <viewport handle> / <code> <value> / 102 }`. ezdxf applies
  them in `RenderContext._setup_vp_layers` (`addons/drawing/properties.py:446-477`). Supported and
  tested with BricsCAD (ezdxf#535, #670).
- Plot style overrides per viewport exist in AutoCAD (named plot styles). ezdxf does not support them.

### 3.8 Linetype scaling in viewports

- PSLTSCALE = 1 (default): for model entities seen through a viewport, the dash lengths on paper
  = pattern × LTSCALE × entity 48 (celtscale), in **paper units**. Equivalently, in model units
  the pattern is scaled by 1/s. Paper-space entities use pattern × LTSCALE × 48 in paper units.
- PSLTSCALE = 0: model entities use pattern × LTSCALE × 48 in model units. The dashes then scale
  with the viewport zoom.
- ezdxf always behaves as PSLTSCALE = 1: `get_vp_ltype_scale = 1/max(vp_scale, 0.0001)`
  (`pipeline.py:213-218`). ezdxf#1386 (2026) proposes honouring 0.
- Which PSLTSCALE is used when plotting a non-current layout: LAYOUT 70 bit 1 of *that* layout;
  for the active layout the header $PSLTSCALE (**VERIFIED-BY-ACAD §10.12**). Model-tab plot: MSLTSCALE × annotation scale (1.5).
- AutoCAD needs a REGEN(ALL) after PSLTSCALE changes on screen. Plots regenerate (ASSUMPTION).

### 3.9 Lineweights in viewports

- Lineweights are absolute (mm on paper) and **do not scale with the viewport scale**. This is
  what ezdxf does (lineweights are resolved without vp scale). "Scale lineweights" (70 bit 64)
  scales *all* lineweights by the layout's plot scale (§5.4).

### 3.10 Draw order: paper-space entities vs. viewport content

- ezdxf: all paper-space entities first, then all viewports in status order
  (`frontend.py:_draw_entities` collects VIEWPORTs and draws them **after** everything else).
  Viewport content therefore always covers paper-space entities.
- AutoCAD: "Paper space geometry is usually plotted before model space geometry" unless "Plot
  paperspace last" is set (Plot dialog help). So by default, viewport content is on top of *all*
  paper-space geometry, which matches ezdxf. With "paperspace last", paper space goes on top.
  The mapping of this option to flag 512 and its default is **UNKNOWN** (2.2).
  **VERIFIED-BY-ACAD (§10.12):** "Plot paper space first? No" = viewports first, paper on top;
  "Yes" = paper first; overlapping viewports by creation order; paper WIPEOUTs never mask
  viewport content.
- Within paper space: SORTENTS/draw-order table (see note on draw order, `SORTENTS` bit 16 =
  "sorts for plotting"). Among several viewports: probably entity/draw order. **UNKNOWN** (T-VP-8).
- A WIPEOUT in paper space that covers a viewport: does it hide the viewport content when
  "paperspace last" is off? It should not. **UNKNOWN**, a cheap test.

### 3.11 Model-space VPORT `*ACTIVE`

- Table VPORT, entry `*ACTIVE` (several with the same name = tiled model viewports). Codes 10/11
  = lower-left/upper-right of the tile in normalized screen coords (0..1), 12 = view center
  (**DCS**), 16/17 = direction/target, **40 = view height**, 41 = aspect ratio (spec says 45;
  ezdxf `entities/vport.py:52`: "DXF reference error: listed as group code 45"), 42 lens,
  43/44 clip, 50 snap angle, 51 twist, 71 view mode, 72 circle sides, 331/441 frozen layers.
- WCS view center = target + rotate(center, ±twist) (realdwg-web#138, **VERIFIED** for target ≠ 0;
  the twist sign has the same conflict as 3.5).
- It matters for plot type 0 "Display" in model space. In accoreconsole there is no real window,
  so the "display" is whatever VPORT `*ACTIVE` says, with an aspect from a virtual device.
  **Avoid Display plots** in the harness.

### 3.12 What the other libraries implement

| Library | Viewport rendering |
|---|---|
| ezdxf | Top-view only. Rect + polygonal clip. Frozen layers + layer overrides. CTB per viewport. PSLTSCALE=1 hard-coded. No frames. Draws after paper space. Skips status ≤ 0. |
| mlightcad (cad-viewer / realdwg-web) | Paper viewports with frames. Structural detection of the overall viewport. DCS center + target + twist (−twist convention). No-plot layer frames optional. PDF export `AcPdfPaperSpaceExport.ts`. |
| dxf-viewer | No viewport support. Paper-space entities are mixed in or suppressed. |
| ACadSharp / netDxf / ixmilia | Data model only. |

---

## 4. How ezdxf renders layouts (drawing add-on)

Files: `ezdxf:src/ezdxf/addons/drawing/{frontend.py, pipeline.py, layout.py, properties.py, config.py}`.

1. `Frontend.draw_layout(layout)` → `_draw_entities`: resolves properties and draws every
   non-VIEWPORT entity in layout order (with optional SORTENTS). Then `_draw_viewports`
   (`frontend.py:1022-1069`).
2. `draw_viewport(vp)`: skip `status < 1` and non-top views, then
   `RenderPipeline2d.draw_viewport` (`pipeline.py:261-306`):
   - compute msp limits (`get_modelspace_limits`) and filter model entities by bbox
     (`filter_vp_entities`, optional bbox cache);
   - `enter_viewport`: `current_vp_scale = s`, `m = vp.get_transformation_matrix()`, build the
     clipping path (flattened if curved), `clipping_portal.push(shape, m)`;
   - draw model entities with `layout_ctx.from_viewport(vp)`: viewport CTB (group 1) unless an
     override CTB is given, frozen layers, layer overrides;
   - `exit_viewport`: pop the clip, reset the scale ("viewports cannot be nested").
3. Pipeline stages: `ClippingStage2d → LinetypeStage2d (ltype scale 1/vp_scale) → BackendStage2d`.
   Clipping is done in the frontend on geometry (lines, polylines, polygons, paths, filled paths,
   text glyph paths), not by the backend.
4. **Page / placement** (`addons/drawing/layout.py`):
   - `Page(width, height, units, margins, max_width, max_height)`: 0 = auto-detect.
     `Page.from_dxf_layout(layout)` uses 44/45 + 40-43 (rounded to 0.1 mm) and applies 73
     (§2.5). Units in the page model: inch, px (1/96 inch!), pt, mm, cm. **ezdxf px = 1/96", not
     AutoCAD's raster 1/100".**
   - `Settings(content_rotation, fit_page=True, scale=1, page_alignment=MIDDLE_CENTER,
     crop_at_margins=False, …)`.
   - `fit_to_page`: `min((W−ml−mr)/cw, (H−mt−mb)/ch)`. `placement_matrix` scales, rotates,
     shifts the content bbox to the first quadrant and aligns it inside the margins (center by
     default).
   - The **render box is the content bbox**, not the plot window. ezdxf has no notion of plot
     types 0–5 and never reads 48/49/140/141, 74, 46/47 (grep: `from_dxf_layout` is the only use
     of PLOTSETTINGS). For paper space the example script in ezdxf#1031 uses `fit_page=False,
     scale=layout.get_plot_unit_scale_factor()`.
5. Colors: ACI 7 follows the background (black on light, white on dark), a special case from
   ezdxf#227. A CTB that forces ACI 7 used to be ignored. PR #1401 fixed this: "Plotting the same
   drawing and CTB through AutoCAD 2025 renders them black" (**VERIFIED-BY-ACAD** that a CTB colour
   for ACI 7 is honoured).
6. Lineweights: `LineweightPolicy.ABSOLUTE/RELATIVE/RELATIVE_FIXED`, `lineweight_scaling`,
   `min_lineweight` (in 1/300 inch) (`config.py:78-90, 220-275`). There is no model of a
   device DPI.
7. **Not supported / known deviations:** non-top-view and perspective viewports; front/back
   clip; PSLTSCALE = 0; viewport frames; viewports with status 0 (non-activated layouts); plot
   windows/types/offsets; "paperspace last"; per-viewport named plot styles; shade plot /
   visual styles; `DrawViewportsFirst` (ezdxf#634/#645); `Scale lineweights`; raster pixel
   geometry. mozman: "This was never planned and never will be a perfect DXF viewer!" (PR #1401).

---

## 5. AutoCAD plotting pipeline facts

### 5.1 Plot area (plot type 74 / `-PLOT` "Enter plot area")

(Plot dialog help, https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-264D3513-0D22-4461-82D6-14F391BC5CDE.htm)

- **Display**: "the view in the current viewport in the selected Model tab or the current paper
  space view in the layout". In model space this comes from VPORT `*ACTIVE`. Avoid it.
- **Extents**: "the portion of the current space of the drawing that contains objects". AutoCAD
  may regenerate to recompute extents. Like ZOOM Extents, objects on **off** layers are
  **included** and objects on **frozen** layers are **excluded** (search summary of AUGI/CADTutor
  threads, ASSUMPTION for plotting). Non-plottable layers are presumably included (UNKNOWN).
  Useful as a separate *extents* test oracle, but not for rendering tests.
- **Limits**: model only, LIMMIN/LIMMAX.
- **Layout**: layouts only, "everything within the printable area of the specified paper size",
  with the paper-space origin as in 2.5.
- **View**: named VIEW (code 6).
- **Window**: two corners. In `-PLOT` they are entered as points (current UCS; keep UCS = World).
  The PLOTSETTINGS 48/49/140/141 are the stored values.

### 5.2 Scale, fit, offset, centering, rotation

- Scale: "a ratio of plotted units to the world-size units"
  (https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-89604826-0B55-4994-8214-1CA93FA66985.htm).
  **Fit** = "largest possible size that fits the paper", i.e. presumably
  `k = min(printW / areaW, printH / areaH)` over the **printable area** (paper minus margins),
  after orientation. Whether AutoCAD shrinks the printable area by some pixels for raster devices
  is **UNKNOWN** (T-PL-1).
- **Offset**: "an offset of the plot area relative to the lower-left corner (the origin) of the
  printable area or the edge of the paper"
  (https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-88080625-C6E0-4FC3-A8FD-226D10DA780D.htm).
  The reference is chosen by sysvar **PLOTOFFSET**: 0 = relative to the printable area, 1 =
  relative to the paper edge. A search snippet says "relative to the center of the paper"
  (Graebert), so verify. **Center the plot** "Automatically calculates the X and Y offset values to
  center the plot on the paper" (for plot types other than Layout).
- **PLOTROTMODE** (0..2, default 2): 0 = rotate the effective plot area so the corner with the
  rotation icon aligns with the paper at lower-left/top-left/top-right/lower-right for
  0/90/180/270, with offsets relative to the lower-left corner. 1 = align the lower-left corner of
  the plot area with the lower-left of the paper. 2 = like 0, but offsets relative to the rotated
  origin (BricsCAD/AutoCAD sysvar docs via search). Irrelevant if we always use Center + no
  rotation.
- **Orientation**: "Portrait … short edge of the paper represents the top", "Landscape … long
  edge … top", plus "Plot upside-down". For a 1600×1280 raster "paper", **Landscape** should give a
  1600-wide PNG (ASSUMPTION). The "twisted image" KB article
  (https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/PublishToWeb-JPG-results-in-twisted-image-on-some-layouts-in-AutoCAD.html,
  403, title only) and an XGA orientation fix hint at pitfalls. **Verify the output PNG dimensions
  in every run.**

### 5.3 Raster output with "PublishToWeb PNG.pc3"

- "Most formats supported by this driver produce 'dimensionless' raster files that have size in
  pixels but do not have size in inches or millimeters." By default it writes to a file.
  "The type, size, and color depth of the raster file determine the final file size."
  (About Plotting Raster File Formats, https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-1DE891EB-BEA8-48A7-B67D-1F1FB9FF4B66.htm)
- **Fixed DPI = 100.** cadforum.cz tip 1028 (https://www.cadforum.cz/en/qaID.asp?tip=1028): "The
  DPI (dots-per-inch) value is usually fixed (e.g. 100 dpi) so to get 2000 pixel resolution you
  will have to set 2000/100 = 20 inches page size." An Autodesk KB (search snippet only):
  "Resolution (DPI) of raster files … is fixed to 100 DPI". Another KB title: "Lineweights look too
  thin in high-resolution raster images". Consequence: **paper size in px ↔ inches at
  100 px/inch.** Plot scale "1 px = 1 unit" means 1 unit = 0.254 mm on "paper". Lineweights stay
  in mm (§5.4).
- **Background color**: configurable in PC3 → Device and Document Settings → Custom Properties.
  "If you change the background color, any objects plotted in that color are invisible" (raster
  help above). The plot preview stays white even with a coloured background (KB snippet). The default
  is white (ASSUMPTION).
- **Color depth**: "Under Device settings you can set the color depth (for color formats) – fewer
  colors means smaller files" (cadforum 1028). The default depth of *PublishToWeb PNG* (256-colour
  palette vs. 24-bit) is **UNKNOWN** and **critical**: a palette would quantize true colours.
  → Harness: a dedicated PC3 copy with the highest colour depth and **no transparency**, checked once
  by inspecting the PNG header (bit depth / colour type / PLTE chunk).
- **Anti-aliasing**: no documentation found. The HDI raster driver output is commonly described
  as aliased ("jagged lines" threads, 403). **ASSUMPTION: no anti-aliasing**, hard pixel coverage.
  This is good for pixel-exact matching, if we can find the coverage rule (pixel-center sampling?
  Bresenham?). **UNKNOWN**, T-PL-2.
- **Custom pixel sizes**: PLOTTERMANAGER → edit the PC3 → Device and Document Settings →
  User-Defined Paper Sizes & Calibration → Custom Paper Sizes → Add → "Start from scratch" → size
  in **pixels** → name → **PMP file name** (the custom sizes live in a `.pmp` next to the PC3, in
  `Plotters\PMP Files`)
  (https://techshelps.github.io/Acad_aug/WS1a9193826455f5ffa23ce210c4a30acaf-60d9-procedure2.htm;
  https://bradshacks.com/autocad-png/: "17″×11″ at 300DPI would be 5100×3300 pixels").
  "There is no public API for changing pc3/pmp-files" (search snippet of the Autodesk .NET forum
  thread "How to create a user plot size of 'PublishToWeb PNG.pc3' & delete it after plot",
  https://forums.autodesk.com/t5/net/how-to-create-a-user-plot-size-of-publishtoweb-png-pc3-amp/td-p/9109860).
- **PC3/PMP/CTB container**: `PIAFILEVERSION_2.0,<TYPE>VER1,compress\r\npmzlibcodec` +
  `pack("LLL", adler32(body), len(plain), len(body))` + zlib body of ASCII text; the header is 60
  bytes (`ezdxf:src/ezdxf/addons/acadctb.py:658-671` for CTB, "PC3, CTB, STB and PMP files all
  share the same encoding" (search snippet, vanderworp.org). A tool: https://github.com/avbrakel/unzip_pc3).
  **ASSUMPTION:** we could generate PMPs with custom sizes programmatically. It is safer to create
  them once in the GUI and keep them under version control.
- Built-in PublishToWeb PNG sizes: names like `VGA (640.00 x 480.00 Pixels)`, `XGA (1024.00 x
  768.00 Pixels)`, `Sun Hi-Res (1600.00 x 1280.00 Pixels)` (the last seen in a CADTutor LISP:
  `"PublishToWeb PNG.pc3" "Sun hi-Res (1600.00 x 1280.00 Pixels)" "L" "N" "EXTENTS"`,
  https://www.cadtutor.net/forum/topic/69802-help-need-to-generate-lots-of-png-files/). The exact
  list is **UNKNOWN**. Get it with `?` at the paper-size prompt (§6.5).
- Printable-area margins of raster sizes: default 0 (ASSUMPTION). You can modify the printable
  area of standard sizes in the PC3 editor. Check the LAYOUT 40-43 after DXFOUT.
- PNGOUT/JPGOUT capture the *screen* and "cannot export images bigger than your screen
  resolution" (bradshacks). There is no quality control (cadforum 1028). **Not usable** in
  accoreconsole (no display).

### 5.4 Lineweights → pixels

- With "Plot object lineweights" on: the stroke width (mm) = entity lineweight (resolved
  BYLAYER/BYBLOCK). "Default" (−3) uses **LWDEFAULT** (a registry value, 25 = 0.25 mm). With a
  CTB that assigns a lineweight, the CTB value wins, unless the CTB says "use object lineweight".
- **px = mm × 100 / 25.4 = mm × 3.937** under the 100 DPI assumption:

  | lw (1/100 mm) | 0 | 5 | 9 | 13 | 15 | 18 | 20 | 25 | 30 | 35 | 40 | 50 | 53 | 60 | 70 | 80 | 90 | 100 | 106 | 120 | 140 | 158 | 200 | 211 |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
  | px @100dpi | thinnest | .20 | .35 | .51 | .59 | .71 | .79 | .98 | 1.18 | 1.38 | 1.57 | 1.97 | 2.09 | 2.36 | 2.76 | 3.15 | 3.54 | 3.94 | 4.17 | 4.72 | 5.51 | 6.22 | 7.87 | 8.31 |

  The rounding rule (round / ceil / minimum 1 px) is **UNKNOWN** (T-PL-3). Lineweight 0 plots
  "with the thinnest lineweight available on the specified plotting device", i.e. 1 px (ASSUMPTION).
- **Scale lineweights** (layouts only): "Scales lineweights in proportion to the plot scale"
  (Plot dialog help). Normally 1:1, so no effect. With Fit, the effective plot scale is the fit
  factor; keep it **off**.
- End caps / joins: CTB fields "Line end style" / "Line join style" (0 butt, 1 square, 2 round,
  3 diamond, 4/5 = use object) (ezdxf notes "Line Cap- and Join Styles.md", `acadctb.py`). The
  object default is presumably round (screen lineweights use round caps). **UNKNOWN for plots**
  (T-PL-4). BricsCAD always uses round.
- Lineweights are **not** scaled by viewport scale or by LTSCALE.

### 5.5 Plot styles, color 7, transparency, monochrome

- **Plot with plot styles = No**: object colours and lineweights are used directly (like
  `acad.ctb`, which maps every colour to "use object color", "use object lineweight", screening
  100) (ASSUMPTION, standard knowledge).
- **`monochrome.ctb`**: every ACI → black. It removes the colour dimension and is ideal for
  geometry tests. **`acad.ctb`**: pass-through. `Grayscale.ctb`: greys. STB named styles only if
  `$PSTYLEMODE = 0`.
- **ACI 7 plots black** on the white raster background (standard AutoCAD behaviour; ezdxf#227
  context). A CTB colour for ACI 7 is honoured (**VERIFIED-BY-ACAD** in PR #1401). **Watch out:**
  a *true-colour* white (255,255,255) and ACI 255 (= RGB 255,255,255 in the AutoCAD palette,
  ASSUMPTION) are *not* mapped and plot white, i.e. invisible. Test it.
- `-PLOT` style table prompt: `Enter plot style table name or [?] (enter . for none) <…>:`
  ("." = none, ASSUMPTION about the exact wording).
- **Plot transparency**: page-setup flag (LAYOUT XDATA `PLOTTRANSPARENCY`). The global
  override **PLOTTRANSPARENCYOVERRIDE** is 0 = never plot transparency, 1 = use page setup
  (initial), 2 = always plot transparency (saved in user settings,
  https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-38F03A2C-6D36-4AD9-BBE0-9CA574BEF218.htm).
  There is no `-PLOT` prompt for it, so the harness sets the sysvar. How transparency blends on a
  raster (alpha over white, and with palette depth?) is **UNKNOWN**.
- CTB/STB location: the "Plot Style Table Search Path" (user profile, `...\Plotters\Plot Styles`).

### 5.6 Screen display vs. plot — things that differ or need pinning

| Topic | Display | Plot | Pin in harness |
|---|---|---|---|
| Lineweights | LWDISPLAY, pixel-scaled screen widths | Device mm → px (§5.4) | lineweights = Y, LWDEFAULT |
| Non-plottable layers (LAYER 290 = 0), `Defpoints` layer | shown | **not plotted** | – |
| Viewport frames | shown | plotted if layer plottable | – |
| POINT | PDMODE/PDSIZE; PDSIZE < 0 = % of *screen* height | uses the same rules; % of what in accoreconsole? **UNKNOWN** | use PDSIZE > 0 in tests |
| Arc/circle smoothness | VIEWRES / viewport 72 / VPORT 72 | device resolution (ASSUMPTION) | – |
| TrueType text | TEXTFILL, TEXTQLTY | TEXTFILL (1 = filled, 0 = outlines), TEXTQLTY (0..100, resolution of TTF outlines when plotting) | set TEXTFILL 1, TEXTQLTY 100? (UNKNOWN which gives exact outlines) |
| SHX text | vectors | vectors, stroked with the entity lineweight | – |
| Solid fills (SOLID, wide PLINE, solid HATCH, TRACE) | FILLMODE | FILLMODE | FILLMODE 1 |
| Raster IMAGE frame | IMAGEFRAME 0/1/2 (2 = display, don't plot) | same | IMAGEFRAME / WIPEOUTFRAME / XCLIPFRAME / FRAME fixed |
| Hatch pattern density | HPMAXLINES limits | same? | keep tests below 1e6 lines |
| Draw order | SORTENTS | SORTENTS bit 16 "sort for plotting" | SORTENTS 127 |
| Annotative objects | ANNOALLVISIBLE, CANNOSCALE | same | CANNOSCALE 1:1 |
| Model linetypes | MSLTSCALE × CANNOSCALE | same | MSLTSCALE 0 or CANNOSCALE 1:1 |
| OLE objects | shown | "OLE objects are not printing" in core console (keanw.com user report) | avoid OLE |
| Plot stamp | – | PLOTSTAMP | off |
| Hide paperspace objects / shade plot | – | layout flag 8 / 76 / viewport 170 | No / As displayed |

---

## 6. `accoreconsole.exe` automation

### 6.1 Command line

- Full switch list (Autodesk ObjectARX help "AutoCAD Core Console", via search summary,
  https://help.autodesk.com/view/OARX/2025/ENU/?guid=AUTOCAD_CORE_CONSOLE):
  `AcCoreConsole.exe [/i <input dwg>] /s <script> [/product <product>] [/l <language>]
  [/isolate <userid> <userDataFolder>] [/readonly] [/p[rofile] <profile>] [/loadmodule <module>]`.
  - `/i` input drawing. **DXF works**: ixmilia-dxf integration tests run
    `accoreconsole /i "<file>.dxf" /s "<script>.scr"`
    (`ixmilia-dxf:src/IxMilia.Dxf.Integration.Test/AudoCadCompatTests.cs:201-215`), and so does
    acadsharp (AUDIT + SAVEAS DXF, acadsharp#1188). One drawing per process: OPEN/NEW are **not
    supported** in the console (https://blog.autodesk.io/notes-on-using-da4a/).
  - `/s` script. `/l en-US` language (only with language packs). `/product ACAD|C3D|…`.
  - `/isolate`: "Used to prevent the changes to the system variables from affecting regular
    AutoCAD" (https://blog.autodesk.io/getting-started-with-accoreconsole/). It needs a userid
    (+ data folder). It uses a separate HKCU root/profile, so **support paths, plotter paths,
    plot-style paths and LWDEFAULT may be the defaults, not the user's**. **UNKNOWN:** whether
    PC3/CTB/PMP are found. T-ACC-2.
  - `/p` profile (ARG name) to fix support/plotter paths. `/loadmodule` loads a module at startup.
- Executable: `C:\Program Files\Autodesk\AutoCAD 20xx\accoreconsole.exe`. ixmilia searches
  `%ProgramFiles%\Autodesk\AutoCAD*\accoreconsole.exe` (`AutoCadExistsFactAttribute.cs`).
- **stdout is UTF-16LE.** ixmilia reads it with `StandardOutputEncoding = Encoding.Unicode`
  (`CompatTestsBase.cs:110`). The console echoes every prompt and answer, so **the log is our
  verification of the prompt sequence**.
- ixmilia waits 30 s, then kills the process. Its TODO says "kill all instances of senddmp.exe and
  fail if present". senddmp.exe is the crash reporter (CER); a crash leaves it running. The harness
  must detect and kill it.
- Performance claims (fdestech.com, not verified): start-up < 1 s, < 100 MB. Several instances
  can run in parallel ("each instance of Core Console is, in essence, a separate instance of
  AutoCAD", https://www.houseofbim.com/posts/son-of-a-batch-autocad-core-console-through-lisp/).
  Lock contention on profile/registry and output files is ours to manage (distinct output dirs,
  and maybe distinct `/isolate` user ids).
- Detect failure by grepping the console output ("error", "Invalid", "*Cancel*", unexpected
  prompt text) and by checking that the PNG exists with the expected dimensions. The exit code is
  not reliable (fdestech examples use output grepping).

### 6.2 Environment and limitations

- **No GUI**, and FILEDIA is effectively 0 ("The system variable FILEDIA is automatically set to
  0", https://fdestech.com/resources/accoreconsole-guide-headless-cad-automation/). Use
  hyphen commands (`-PLOT`, `-LAYER`, `-PURGE`). The forum thread "Set FileDia doesn't work in
  accoreconsole (with specific argument)" (403) suggests edge cases with `/isolate`. Set
  `FILEDIA 0` and `CMDDIA 0` explicitly anyway.
- **LISP**: plain AutoLISP works (`command`, `entget`, `textbox`, `getvar`). **`vla-*`/`vlax-*`
  (ActiveX/COM) do not.** Express Tools and RText do not load
  (https://blog.autodesk.io/getting-started-with-accoreconsole/).
- **.NET**: only assemblies built against `AcCoreMgd.dll` (not `AcMgd.dll`). DBX/CRX modules work
  (https://www.keanw.com/2012/02/the-autocad-2013-core-console.html). Load them with `NETLOAD`. The
  folder must be in TRUSTEDPATHS, or SECURELOAD must be 0. Network paths need escaped backslashes
  and `accoreconsole.exe.config` (autodesk.io getting-started).
- **SECURELOAD**: with 1 (default), loading from untrusted paths prompts, and a prompt in a script
  stalls or aborts. Set `SECURELOAD 0` in the script before any load, or put our LISP/.NET folder
  into TRUSTEDPATHS (ASSUMPTION about the exact behaviour in the console).
- **Fonts**: SHX fonts are found through the support file search path (profile) and the drawing
  folder. TTF fonts come from Windows `Fonts`. Missing fonts are substituted by FONTALT (and
  FONTMAP). Silent substitution **ruins text tests** → pin `FONTALT` to a known font, ship our test
  fonts in a support path that the profile knows, and grep the log for substitution messages
  (UNKNOWN whether the console prints them). Design Automation has a fixed font set; custom fonts
  need an AppBundle + `.fmp` (https://blog.autodesk.io/notes-on-using-da4a/).
- **Localization**: use `_` + `.` prefixed global command names (`_.-PLOT`) and underscore
  keywords (`_Y`, `_N`, `_W`, `_F`, `_C`, `_L`) so that non-English installs work
  (ASSUMPTION: the keyword-underscore rule applies to -PLOT options too). Device, paper, file and
  CTB names are literal strings.
- The layouts of our DXFs have never been initialized, see 2.2 (T-ACC-3).
- Design Automation: "DWG/DXF files must be uncorrupted. AUDIT errors or non-TrustedDWG status may
  cause WorkItem execution failure", and R12 DXF may fail (Unicode) (autodesk.io notes). The
  desktop console is probably more lenient, but the harness should run `AUDIT`-free first and log
  any "errors found" messages.

### 6.3 Script (.scr) syntax pitfalls

- "Every line break is an Enter keypress. A blank line is also an Enter"
  (https://fdestech.com/resources/accoreconsole-script-examples/). **A space is also Enter** at
  most prompts (classic AutoCAD script rule), except at prompts that accept spaces (names/strings
  such as the device, paper size and file-name prompts of -PLOT, which read the whole line; the
  CADTutor example uses unquoted `DWG to PDF.pc3` and `ISO A3 (420.00 x 297.00 MM)` successfully,
  https://www.cadtutor.net/forum/topic/17296-plotting-to-a-file-using-script/). **Avoid spaces in
  output paths**, and never leave trailing spaces.
- "Scripts fail silently when the final command lacks an Enter after it", so **end with a
  newline** (fdestech). Generate scripts with CRLF and no BOM (ASSUMPTION: a BOM may break the
  first command).
- The output file name must be given explicitly: "you have no png filename… by going accept it
  gets nothing" (BIGAL in the CADTutor PNG thread) and "simply using a space or blank line won't
  automatically use the drawing name" (CADTutor 17296).
- Scripts must not contain answers for prompts that do not appear, otherwise everything shifts.
  **Always generate scripts from one tested template per (space, device) combination, and diff the
  echoed log against the expected prompt list.**
- Alternative: drive everything via `(command "_.-PLOT" "_Y" "Model" …)` in a LISP line inside
  the script. This is more explicit (`""` = Enter), and `(command)` works in the console.
- End: `_.QUIT` + `_Y` to discard changes (ixmilia uses `QUIT Y`), or rely on the console
  exiting at the end of the script. The harness enforces a timeout either way.

### 6.4 The `-PLOT` prompt sequence

The order of prompts comes from the -PLOT help
(https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-625E395D-143A-494F-A1EA-1BF119B927DC.htm,
https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-MAC-Core/files/GUID-AD562D05-6FF6-47AE-B52C-7203031ADFB2.htm)
and from the working layout-to-PDF script in CADTutor 17296. The **exact prompt texts** below are
from memory/help paraphrase (**ASSUMPTION**). The first harness run must capture the real
transcript.

**Model space, detailed, PublishToWeb PNG (the harness form):**

```
_.-PLOT
_Y                                   ; Detailed plot configuration? [Yes/No] <No>:
Model                                ; Enter a layout name or [?] <Model>:
truedxf PNG.pc3                      ; Enter an output device name or [?] <…>:
truedxf 2000x1500 (2000.00 x 1500.00 Pixels)   ; Enter paper size or [?] <…>:
                                     ; (NO "Enter paper units" prompt for raster devices — help: "Not displayed for raster images")
_L                                   ; Enter drawing orientation [Portrait/Landscape] <Landscape>:
_N                                   ; Plot upside down? [Yes/No] <No>:
_W                                   ; Enter plot area [Display/Extents/Limits/View/Window] <Display>:
0,0                                  ; Enter lower left corner of window <…>:
200,150                              ; Enter upper right corner of window <…>:
_F                                   ; Enter plot scale (Plotted <units>=Drawing Units) or [Fit] <Fit>:   (<units> for raster = Pixels? UNKNOWN)
_C                                   ; Enter plot offset (x,y) or [Center] <0.00,0.00>:
_Y                                   ; Plot with plot styles? [Yes/No] <Yes>:
monochrome.ctb                       ; Enter plot style table name or [?] (enter . for none) <>:
_Y                                   ; Plot with lineweights? [Yes/No] <Yes>:
_A                                   ; Enter shade plot setting [As displayed/legacy Wireframe/legacy Hidden/Visual styles/Rendered] <As displayed>:   (Model only)
C:\truedxf\out\case0001.png          ; Enter file name <…>:   (a raster device always writes a file: "Write the plot to a file" is presumably NOT asked, UNKNOWN)
_N                                   ; Save changes to page setup [Yes/No]? <N>   (2024 help: "[Yes/No/Quality]" → quality/DPI sub-prompts for shaded plots)
_Y                                   ; Proceed with plot [Yes/No] <Y>:
```

**Layout, detailed** (layout-only prompts from the help, order from CADTutor 17296's PDF script:
`-plot y Layout1 "DWG to PDF.pc3" "ISO A3 (420.00 x 297.00 MM)" m l n e F C y "STL Mono.ctb" y n n n <file> n y`):

```
_.-PLOT
_Y
Layout1                              ; layout name
truedxf PNG.pc3
truedxf 2000x1500 (2000.00 x 1500.00 Pixels)
                                     ; (paper units: only for non-raster devices — the PDF script answers "m" here)
_L
_N
_W                                   ; Enter plot area [Display/Extents/Layout/View/Window] <Layout>:
0,0                                  ; lower-left corner in PAPER units
420,297                              ; upper-right corner
_F                                   ; plot scale or Fit (1:1 is the normal layout choice)
_C
_Y                                   ; plot with plot styles
monochrome.ctb
_Y                                   ; plot with lineweights
_N                                   ; Scale lineweights with plot scale? [Yes/No] <No>:   (layout only)
_N                                   ; Plot paper space first? [Yes/No] <No>:               (layout only; "Plot paperspace last" inverted wording)
_N                                   ; Hide paperspace objects? [Yes/No] <No>:              (layout only)
C:\truedxf\out\case0001-Layout1.png
_N                                   ; Save changes to page setup
_Y                                   ; Proceed with plot
```

Notes:
- The non-detailed form is `-PLOT N <layout> <page setup name> <device> <file> N Y` (fdestech
  recipe 1). It uses a *named page setup*: we could ship one in the DXF (PLOTSETTINGS object),
  but then we depend on our own PLOTSETTINGS writer. Prefer the detailed form.
- "Plot paper space first?" appears in the -PLOT help as "Plot paper space first [Yes/No] –
  Layout-only; reverses plotting order". Given "Paper space geometry is usually plotted before
  model space geometry", answering **Yes = default order** (paper first, viewports on top) and
  **No = paperspace last**? **The polarity is UNKNOWN**, T-VP-8. Record the answer in the case
  metadata.
- The layout name is the LAYOUT 1 name (case-insensitive?). For Model you can also answer "Model".
- Everything answered here also overrides LAYOUT settings stored in the DXF. With "Save changes
  = N" the DXF page setup is untouched.

### 6.5 Listing paper sizes / devices

Answer `?` at the device prompt (lists PC3s + system printers) and at the paper-size prompt
(lists the sizes of the selected device, including PMP custom sizes). Then cancel. A one-off
"discovery script" writes the lists to the log. Run it on every new AutoCAD install and commit the
output.

### 6.6 Custom pixel sizes (our PC3)

1. In the full AutoCAD GUI (one time): PLOTTERMANAGER → copy `PublishToWeb PNG.pc3` →
   `truedxf PNG.pc3`. Custom Properties: background white, highest colour depth, no transparency.
   Custom Paper Sizes → add e.g. 2000×1500, 1000×1000, 4000×3000 px, margins 0 → PMP
   `truedxf PNG.pmp`.
2. Commit the PC3 + PMP to the harness repo. The harness copies them into the plotter folder of the
   profile used by accoreconsole (`/p` or `/isolate` data folder), T-ACC-2.
3. **Alternative (ASSUMPTION):** generate the PMP programmatically (zlib container, §5.3). Only if
   the GUI route is impractical.

### 6.7 Saving DXF from a script (ground truth for non-visual data)

- `DXFOUT` (FILEDIA 0): `DXFOUT "<path>" V R2013 16`, i.e. file name, then the prompt "decimal
  places of accuracy (0 to 16) or [Objects/Version/Binary] <16>" → `V` → version (`R12`, `2000`,
  `2004`, `2007`, `2010`, `2013`, `2018`) → `16` precision. **VERIFIED** as working scripts in
  ixmilia (`AudoCadCompatTests.cs:30, 100, 182`: `DXFOUT "{path}" V {version} 16`, then `QUIT Y`).
  Also `DXFOUT "{path}" 16` for the default version.
- `SAVEAS` with the `DXF` format option is the other route (acadsharp uses "SAVEAS DXF for the
  oracle comparisons", acadsharp#1188). The prompt order is UNKNOWN; prefer DXFOUT.
- **Using AutoCAD's DXFOUT as an oracle:** AutoCAD recomputes and writes, among others:
  `$EXTMIN/$EXTMAX` and the LAYOUT 14/15 (after a regen/`ZOOM _E`?), dimension measurement (42) and
  the regenerated `*D` blocks, MTEXT 42/43 (actual width/height), HATCH seed/boundary
  associativity, VIEWPORT 68/69 after activation, LAYOUT plot settings after `-PLOT … Save changes
  = Y` (this reveals 44/45 for pixel sizes, 72 = 2?, 147, flag 70 for each prompt answer).
  → This is the cheapest way to answer most of the open questions in §8.
- Other text ground truth: `(textbox (entget e))` (pure AutoLISP) for text boxes, `(getvar
  "EXTMIN")` after `_.ZOOM _E`, and `LIST` output (echoed to stdout). Wrap LISP output in
  `(princ "\n@@TRUEDXF@@ …")` markers so that the harness can parse the UTF-16 log.

### 6.8 Alternatives

| Option | Verdict |
|---|---|
| **PUBLISH / -PUBLISH with DSD** | Batch of several layouts in one run. Adds DSD complexity; possible later. |
| **-EXPORT → PDF, then rasterize (pdftoppm/mupdf)** | Vector output: resolution-independent, lineweights exact, but rasterizer AA ≠ AutoCAD. SHX text may be stored as comments/text (PDFSHX sysvar); TTF may become real PDF text; merge control. Useful as a *geometry* oracle at arbitrary DPI. Second priority. |
| **PNGOUT / JPGOUT** | Screen capture, limited to screen resolution, no quality control. Not in the console. ✗ |
| **DWG TrueView** | Can plot DXF/DWG with the same plot engine, but is not scriptable (no script/console, ASSUMPTION). Only manual spot checks. |
| **APS Design Automation for AutoCAD** | Cloud accoreconsole. commandLine `$(engine.path)\accoreconsole.exe /i "$(args[HostDwg].path)" /s "$(settings[script].path)"`. Paths must be double-quoted. Default time limit 100 s, max 900 s (DA4A notes; the rate-limit docs mention per-engine limits up to 10800 s via `limitProcessingTimeSec`). Fonts limited (custom fonts via AppBundle + .fmp). One user reports "the plotted pngs are perfect" (ezdxf#618). An option if no local licence is available, but paid, slower, and PC3/PMP must be shipped in an AppBundle (UNKNOWN whether custom PMPs work). |

### 6.9 Parallelism, timeouts, crashes

- One process per DXF (or several plots per process: one DXF can be plotted several times in one
  script, model + layouts + several windows. That saves start-up time but increases blast radius).
- Timeout: hard kill after N s (ixmilia uses 30 s). A stalled prompt = the process waits on stdin
  forever. Redirect stdin from NUL so that it hits EOF (UNKNOWN whether it then exits).
- Kill `senddmp.exe` / CER dialogs after a crash (ixmilia TODO). Treat the missing PNG as
  failure.
- Run N ≈ cores/2 instances. Every instance writes to its own temp dir. Do not share output file
  names. `/isolate` per worker if sysvar writes collide (UNKNOWN whether needed).
- Sysvars set by scripts persist in the profile unless `/isolate` is used, so **every script
  resets every sysvar it depends on** (§7).

---

## 7. Recommended reference-plot recipe

**Goal:** a deterministic mapping `pixel = f(world)` that truedxf can replicate exactly, with as
few AutoCAD heuristics in the loop as possible.

1. **Device:** `truedxf PNG.pc3` (a copy of PublishToWeb PNG). White background, maximum colour
   depth (24-bit RGB), no transparency, custom sizes in `truedxf PNG.pmp` with **0 margins**.
   Default canvas **2000 × 1500 px** (4:3, 20 × 15 inch at 100 DPI) plus a square 1000 × 1000.
   *Reason:* the pixel size is fixed, and a dedicated PC3 means user edits cannot change it.
2. **Plot area: Window**, corners chosen by the test generator with **exactly the canvas aspect
   ratio** (e.g. 200 × 150 units for 2000 × 1500 → 10 px/unit). *Reason:* no dependence on
   extents/display/limits computation, and Fit then gives a known, exact scale.
3. **Scale: Fit**, **offset: Center**, **orientation: Landscape**, **not upside down**.
   *Reason:* with matching aspect, Fit = canvas/window, and Center = 0 offset. Verify with the
   calibration case T-PL-1 (Fit may use a printable area that is 1 px smaller).
4. **Plot styles: Yes**, with `monochrome.ctb` for geometry tests and `acad.ctb` for colour tests
   (never "."). *Reason:* explicit and reproducible. monochrome isolates geometry from palette
   questions.
5. **Lineweights: Yes.** Layouts: **scale lineweights No**. Two test classes: (a) all entities
   lineweight 0 → 1 px lines (geometry precision), (b) lineweight tests on purpose.
   *Reason:* lineweight 0 lines are the most sensitive probe of the rasterization rule.
6. **Shade plot: As displayed** (model). Layouts: **hide paperspace objects No**, and "plot paper
   space first" fixed (answer recorded).
7. **Save changes to page setup: No. Proceed: Yes.** Output path without spaces.
8. **Sysvars set at the start of every script** (all with `_.SETVAR` or direct): `FILEDIA 0`,
   `CMDDIA 0`, `CMDECHO 1` (for the log), `EXPERT 5`, `BACKGROUNDPLOT 0`, `SECURELOAD 0` (only if
   we load LISP), `PLOTTRANSPARENCYOVERRIDE 0` (or 2 for transparency tests), `PLOTOFFSET 0`,
   `PLOTROTMODE 2`, `LWDEFAULT 25`, `FILLMODE 1`, `TEXTFILL 1`, `TEXTQLTY 50` (record it),
   `PSLTSCALE` untouched (a property of the file), `MSLTSCALE 0`, `ANNOALLVISIBLE 1`,
   `SORTENTS 127`, `PLOTSTAMP`/`PLOTSTAMPON` off, `FONTALT` = a known font, `UCS _W`.
   *Reason:* registry/profile state leaks between runs.
9. **Page setup in the DXF itself:** write every LAYOUT with a sane PLOTSETTINGS (device
   `none_device`, 70 = 688) and let `-PLOT` override it. For layouts, also write the overall
   VIEWPORT (id 1, 90 = 557088) as the first entity, so AutoCAD finds an initialized layout
   (T-ACC-3).
10. **Metadata:** store the exact script, the echoed UTF‑16 log (decoded), the AutoCAD version/build,
    the PC3/PMP/CTB hashes and the PNG header info next to each PNG.
11. **Verification per run:** PNG size == canvas, and the log prompt sequence == the template.
    Otherwise mark the case as a harness failure, not a render mismatch.
12. **Extra oracles in the same run** (optional): `DXFOUT` after the plots → AutoCAD-computed
    values (extents, dimension measurements, MTEXT sizes, viewport status).

Calibration cases to run first (they define `f`): T-PL-1 … T-PL-4 below.

---

## 8. Open questions (need a real AutoCAD install)

1. Exact `-PLOT` prompt texts for raster devices. Is there a "paper units" prompt? Is "Write the
   plot to a file" asked? What does the scale prompt say (Pixels?)?
2. PNG colour depth / colour type of PublishToWeb PNG by default. Palette quantization?
   Anti-aliasing?
3. Fit/Center math for raster: exact printable area (1 px inset?), pixel-center vs. edge
   convention, y-axis flip origin (does model y = window top map to row 0 or −0.5?).
4. Lineweight → px rounding at 100 DPI. Minimum width. End caps/joins for "use object style".
5. Do 44/45 of a raster page setup store px × 0.254 mm? What is 147 for inch/mm/pixel layouts?
6. Twist sign (ezdxf +twist vs. mlightcad −twist) and DCS axes for non-plan view directions
   (AAA?).
7. On/off: is VIEWPORT 68 = 0 in a non-activated layout still plotted? Is 90 bit 0x20000 the real
   switch?
8. Overall-viewport identification when 69 = 0 everywhere (first entity?).
9. `DrawViewportsFirst` (512) ↔ "Plot paperspace last" ↔ "Plot paper space first?" polarity and
   the AutoCAD default.
10. PSLTSCALE source when plotting a non-current layout (LAYOUT 70 bit 1 vs. header).
11. Viewport frame plotting vs. PLOTSETTINGS bit 1. Frame of non-rectangular viewports (clip
    entity only?).
12. Border clipping of thick strokes/text/hatches (geometric cut vs. per-pixel).
13. Behaviour of never-initialized layouts in accoreconsole (flags 8192/16384, missing overall
    viewport).
14. `/isolate` + plotter/plot-style search paths. Does `/p <profile>` fix them? Fonts in console.
15. Does ACI 255 plot white (invisible)? True-colour white?
16. Negative PDSIZE in plots from the console (relative to what "screen"?).
17. Extents plot: off layers included, non-plottable layers included, viewports/overall
    viewport included in layout extents?

---

## 9. Test ideas

Each test = a small DXF + a script template. The IDs are referenced above.

- **T-PL-1 Fit/center calibration.** Model: a window 0,0–200,150 on 2000×1500 px. Draw
  lineweight-0 lines on x = 0, 0.05, 0.1 … and y = …, a closed rectangle exactly on the window
  border, a rectangle inset by 0.1 unit, and single POINTs (PDMODE 0) at known coordinates. Result:
  scale, offset, pixel-center convention, border inclusion.
- **T-PL-2 Rasterization rule.** Lineweight-0 lines at many slopes and sub-pixel offsets, tiny
  circles (r = 0.3 … 3 px), a solid-filled triangle with sub-pixel vertices. Result: AA yes/no,
  Bresenham vs. coverage, fill rule (pixel-center inclusion).
- **T-PL-3 Lineweight table.** One horizontal and one 30° line per standard lineweight (0 …
  2.11 mm), plus lineweight "Default" with LWDEFAULT 25. Measure the widths. Repeat with 1000×1000
  and 4000×3000 to confirm the fixed 100 DPI.
- **T-PL-4 Caps/joins.** A thick (2.11 mm) open polyline with 90°/30° corners and a single thick
  LINE. acad.ctb with object end style vs. a CTB with explicit butt/square/round.
- **T-PL-5 Colours.** ACI 1–255 swatches (solid hatches) + true colours incl. (255,255,255) +
  ACI 7/255 under acad.ctb, monochrome.ctb and "Plot with plot styles = No". Check palette
  quantization and white-on-white.
- **T-PL-6 Transparency.** Overlapping 50%-transparent solid hatches with
  PLOTTRANSPARENCYOVERRIDE 0 / 2.
- **T-PL-7 Orientation.** The same window with Landscape / Portrait / upside-down on a 2000×1500
  and a 1500×2000 custom size. Check the PNG dimensions and the rotation direction. Then DXFOUT
  with Save = Y to read 73.
- **T-PL-8 Page-setup oracle.** `-PLOT … Save changes Y` for Model and Layout1 with various
  answers, then DXFOUT. Read 44/45/40-43/72/73/74/75/142/143/147/70 and the XDATA
  PLOTTRANSPARENCY. Answers open questions 5 and 9.
- **T-PL-9 Extents.** Entities on normal / off / frozen / no-plot layers far apart, then plot
  area Extents, then compare with `$EXTMIN/$EXTMAX` after DXFOUT.
- **T-VP-1 Viewport identification.** A layout with the overall viewport + 2 viewports. Save variants
  with 69 = 0/−1/1 and 68 = 0/1/2, and with 90 bit 0x20000 set on one of them. Which ones plot?
- **T-VP-2 Non-activated layout.** A DXF with 3 layouts written by truedxf (never opened). Plot
  each layout from the console. Also open → DXFOUT without switching tabs, then inspect 68/69
  (reproduces ezdxf#1014).
- **T-VP-3 Clipping.** A viewport over a model grid of thick lines, text (SHX + TTF), a solid
  hatch and a hatch pattern crossing the border. Rectangular + polygonal (LWPOLYLINE with bulges)
  + CIRCLE + closed SPLINE clip entities.
- **T-VP-4 Twist sign.** A model arrow pointing +X plus the text "N" at +Y. Viewports with twist
  30°, 90°, −45° and a non-zero target (17) + view center (12). Compare with ezdxf's vs.
  mlightcad's formula.
- **T-VP-5 Non-rectangular frame.** Is the rectangle 40/41 drawn? Is the clip entity drawn with
  its own layer props? Clip entity on a no-plot layer.
- **T-VP-6 3D view directions.** A cube of 3DFACEs/LINEs (with a marked +X/+Y/+Z) in viewports
  with directions (0,0,−1), (1,−1,1) (SE iso), (−1,−1,1) (SW), (0,−1,0) (front), and a
  non-normalized (0,0,5). Result: DCS axes rule.
- **T-VP-7 Linetype scaling.** A DASHED line in 2 viewports with scales 1:1 and 1:10. PSLTSCALE
  0/1 via LAYOUT 70 bit 1 vs. header; LTSCALE 2; entity 48 = 0.5; MSLTSCALE + CANNOSCALE for the
  model tab.
- **T-VP-8 Draw order.** A paper-space solid hatch overlapping a viewport whose model content is a
  solid hatch of another colour. A paper-space WIPEOUT over the viewport. Two overlapping
  viewports in both entity orders. Answer "Plot paper space first" Y/N, and flag 512 set/clear.
- **T-VP-9 Frozen layers / overrides.** VIEWPORT 331 freezes a layer in one viewport. Layer VP
  overrides (colour, lineweight, linetype, transparency) through the XRECORDs.
- **T-VP-10 Frame properties.** VIEWPORT on layer with colour 1 / lineweight 0.5 / DASHED; on an off
  layer; on a no-plot layer; PLOTSETTINGS bit 1 set/clear.
- **T-VP-11 Layout origin.** Plot type Layout vs. Window for a layout with margins/offset
  (46/47) set. Check that paper-space (0,0) = printable LL + offset (§2.5), for rotations 0–3.
- **T-ACC-1 Prompt transcript.** The discovery script: `?` lists for devices and paper sizes,
  and full detailed -PLOT runs for Model and a layout. Commit the decoded logs.
- **T-ACC-2 Profile/paths.** Run with and without `/isolate` and `/p`. Check that the PC3/PMP/CTB are
  found and that sysvars do not leak.
- **T-ACC-3 Uninitialized layouts.** Layouts without an overall viewport, with and without flags
  8192/16384, and with `none_device` page setups.
- **T-ACC-4 DXF input robustness.** R12 vs. R2018 DXF, missing `$TILEMODE` (expect paper space,
  acadsharp#1188), upper-case `*MODEL_SPACE` (acadsharp#1197).
- **T-ACC-5 Fonts.** SHX from the drawing folder vs. the support path, a missing SHX → FONTALT, TTF
  (Arial) with TEXTFILL 0/1 and TEXTQLTY 0/50/100.

---

## 10. Calibration results (VERIFIED-BY-ACAD, AutoCAD 2027)

AutoCAD 2027 (ACADVER 26.0, `_VERNUM` X.118.0.0) through `tools/acad` (accoreconsole, `/isolate`),
configs `truedxf PNG.pc3` / `truedxf PDF.pc3` generated by `tools/acad/src/configs.ts`, stock
`monochrome.ctb` / `acad.ctb`, 2026-09-30. Cases: `samples/generated/calibration/*` (generator
`tools/acad/calibration/calgen.py`); references:
`samples/refs/acad2027-R26.0/calibration/<case>.png|pdf|log|json`; every number below is reproduced
by `tools/acad/calibration/analyze_*.py` (see tools/acad/README.md).

Conventions: device coordinates `u` (right) and `v` (**up**, from the bottom edge) in pixels,
canvas `W × H`, pixel `(i, j)` = `[i, i+1) × [j, j+1)`, image row = `H − 1 − j`.

**Answers to §8:** Q1 → §10.1; Q2 → §10.6 (RGB 8-bit, no AA); Q3 → §10.2 (no inset, `floor`,
ties are noise); Q4 → §10.4 (`round`, min 1 px, round caps); Q6 → §10.10 (twist is CCW, ezdxf's
sign); Q14 → §10.1 (`/isolate` still finds the user's plotter paths); Q15 → §10.7 (ACI 255 =
FAFAFA; true-colour white is invisible). Main points 3 and 4 are thereby confirmed.

| Question | Answer |
|---|---|
| World → pixel (Window + Fit + Center) | `u = (x − xmin)·W/(xmax − xmin)`, `v = (y − ymin)·H/(ymax − ymin)`; pixel `(floor u, floor v)`; image row `H−1−floor v`. Scale exactly `W / window width`. |
| Printable area inset? | **No.** PMP printable bounds `(0,0)–(W−1,H−1)` are inclusive pixel indices; "Effective plotting area: 2000.00 wide by 1500.00 high". |
| Ties / edges | Exact integer device coordinates (±1e-5 px) are floating-point noise (§10.2). `t = 0` → pixel 0, `t = W` → pixel W−1; geometry ≥ 1e-6 px outside the window is clipped. |
| y flip | Row 0 = window top. |
| Anti-aliasing | **None** (monochrome plots contain exactly 000000 and FFFFFF). |
| PNG | 8-bit RGB (colour type 2), no alpha/palette/gAMA/pHYs, background FFFFFF. |
| DPI | Fixed 100 dpi on every canvas (4000×3000 gives the same stroke widths as 2000×1500). |
| Lineweight → px | `max(1, round(mm × 100/25.4))`, all 24 weights + Default (§10.4). PDF: `round(mm × 600/25.4)` in 1/600 in. |
| Hairline | Lineweight 0 (and every weight ≤ 0.35 mm, and Default with LWDEFAULT 25) = 1 px. |
| Caps / joins | Round caps; LWPOLYLINE corners = two LINEs with round caps; PDF `1 J 1 j`. Every segment is a convex integer polygon with polygonal round caps (§10.14). |
| Thin lines | Endpoints snapped to their pixel; 16.16 fixed-point DDA x(y) = x0 + (y−y0)·trunc(dx/dy), round-half-up per row (y-major) / of the inverted line per column (x-major): 301/301 probe lines exact (§10.3). |
| Fills | Vertices snapped (floor); scanline y = j, edges walked from their lower vertex with a truncated 16.16 slope, filled if x_left < i + ½ ≤ x_right; solid HATCH cut into trapezoids at every vertex y first (§10.5). All SOLIDs and island-free hatches off pixel boundaries exact. |
| ACI palette | New table (note 06 §3.5): ramps FF/DD/B8/95/72; 7 → 000000; 8 = 808080; 9 = DCDCDC; 250–255 = 545454…FAFAFA. Same in model space, paper space, viewport, PNG and PDF. |
| True colours | Exact (16/16), **also under monochrome.ctb**. |
| Determinism | PNG byte-identical; PDF identical except CreationDate/ModDate. |
| PDF | 1/600 in units; circles/arcs = Béziers; ellipses/splines = integer polylines. |
| Curves (PNG) | CIRCLE/ARC on the canvas: integer circle (snapped centre, radius ceil(r)−1), n = 2·ceil(sweep/π·√Ri + ¼); ellipses, off-canvas arcs, outlines: ceil(max(32, π√(1.016a))·sweep/2π) exact points (§10.13). |
| Twist | `paper = vp.center + s·(R_ccw(twist)·p − view_center)` (view centre in DCS). |

### 10.1 Harness facts

- **-PLOT transcript** (model, PNG): `Detailed plot configuration? [Yes/No] <No>:` → `Enter a
  layout name or [?] <Model>:` → `Enter an output device name or [?] <…>:` → `Enter paper size or
  [?] <…>:` → (**no paper-units prompt for raster devices**) → `Enter drawing orientation
  [Portrait/Landscape]` → `Plot upside down? [Yes/No] <No>:` → `Enter plot area
  [Display/Extents/Limits/View/Window] <Limits>:` → `Enter lower left corner of window <…>:` /
  `Enter upper right corner of window <…>:` → `Enter plot scale (Plotted pixels=Drawing Units) or
  [Fit] <1=1>:` → `Enter plot offset (x,y) or [Center] <0.00,0.00>:` → `Plot with plot styles?
  [Yes/No] <No>:` → `Enter plot style table name or [?] (enter . for none) <>:` → `Plot with
  lineweights? [Yes/No] <No>:` → `Enter shade plot setting [As displayed/legacy Wireframe/legacy
  Hidden/Visual styles/Rendered] <As displayed>:` → `Enter file name <…-Model.png>:` → `Save
  changes to page setup [Yes/No]? <N>` → `Proceed with plot [Yes/No] <Y>:` → `Effective plotting
  area:  2000.00 wide by 1500.00 high` / `Plotting viewport 2.` There is no "write to file" prompt.
  PDF adds `Enter paper units [Inches/Millimeters] <Millimeters>:` after the paper size (the scale
  prompt then says `Plotted Inches=Drawing Units`). Layouts: area list
  `[Display/Extents/Layout/View/Window] <Layout>`, and instead of the shade prompt `Scale
  lineweights with plot scale? [Yes/No] <No>:`, `Plot paper space first? [Yes/No] <No>:`, `Hide
  paperspace objects? [Yes/No] <No>:`; the layout is regenerated ("Regenerating layout.",
  "Regenerating model - caching viewports.").
- Plot area **Layout** has no Center option (`Enter plot offset (x,y) <0.00,0.00>:`); `_C`
  cancels -PLOT and desynchronises the script.
- **Square sheets:** Landscape on 1000×1000 rotates the plot by 90° (model +X → image up);
  Portrait (the offered default) keeps +X to the right.
- **Window trimming (affects every Window plot):** if the plot window lies inside the current
  view, AutoCAD shrinks the window on every side where the geometry extents come closer to the
  window edge than a threshold, then **centres the shrunken area** — the whole plot shifts (the
  log shows e.g. `Effective plotting area: 2000.00 wide by 1449.18 high`). Threshold with the
  ezdxf default view (VPORT height 1000): 19.66 units (bisected 19.65–19.68 for windows 250×187.5,
  500×375, 100×75, both axes), ≈ 0.0197 × view height; with view height 5000 gaps of 120 units
  are trimmed; a view **smaller** than the window disables it (gaps 0.05…30 units tested).
  Geometry touching the window edge is unaffected. The harness zooms to 1 % of the window height
  at the window centre before plotting (paper space: after `CTAB` = layout and `PSPACE`).
- `/isolate` uses a private profile (~27 MB), but Plotters, Plot Styles and PMP Files still resolve
  to the user's roaming folder; sysvars set inside do not persist in the user profile.
- Invalid DXF: `Error in drawing header on line N.`, `… is not valid DXF file`, `Invalid or
  incomplete DXF input -- drawing discarded.`, exit code 53. A script that ends inside a prompt
  leaves the console waiting on stdin forever (stdin = NUL does not end it) → always `_.QUIT _Y`.
- `DXFOUT` prompts: `Enter DXF file name <…>:`, `Enter decimal places of accuracy (0 to 16) or
  [Binary/select Objects/Preview/Version] <16>:`, `Enter version
  [R12(LT2)/2000(LT2000)/2004(LT2004)/2007(LT2007)/2010(LT2010)/2013(LT2013)/2018(LT2018)] <2018>:`,
  then the accuracy prompt again.
- 2.3–2.6 s per run alone; about 1 s per case effective with 4 parallel consoles.
- Stock raster sizes include `Super VGA (800.00 x 600.00 Pixels)`, `XGA Hi-Res (1600.00 x 1200.00
  Pixels)`, `FHD`, `4K UHD`, `8K UHD`, `16K (15360.00 x 8640.00 Pixels)` plus 56 `User 1 (…)` sizes
  from the stock PMP. PC3/PMP container format and the generator: tools/acad/README.md. AutoCAD
  2027 also reads a new uncompressed `PIAFILEVERSION_3.0,json` PC3 variant.

### 10.2 Mapping and ties (T-PL-1)

- `mapping-2000x1500` (10 px/unit, sub-pixel probes in 0.05 px steps): 370/370 non-tie probes at
  `floor`. `mapping-offset` (window 1000,−500 … 1080,−440 = 25 px/unit): 35/35.
  `mapping-ties-*` (8 px/unit, exact binary coordinates; 2000×1500, 1000×1000 Portrait, 800×600):
  48/48 non-tie probes; probes at `k ± 7.6e-6 px` always resolve to `floor`, so the scale is
  exact to better than 1e-8.
- **Exact ties** (`mapping-scan-*`: one probe on every integer device coordinate): `u = k` lights
  pixel `k` for `k ≤ 1126` and `k − 1` for `k ≥ 1127` on 2000 px; y: switch at 871 of 1500;
  1000 px: 576 (both axes); 800×600: 436 / 333. No simple double-precision formula reproduces
  this → treat as implementation noise. The finer scans `probe-ties-{10ppu,4ppu,centred,offset,800-10ppu}`
  (2026-09-30) show a structure in device space independent of the window above ~1100 px on a
  2000 px axis (x: odd k floor / even k−1 in [1100, 1299], all k−1 in [1300, 1499], even k floor /
  odd k−1 in [1500, 1698], all k−1 above; boundaries at multiples of 100 px = 1 inch) plus window-
  dependent noise below (10 px/unit: period-5 patterns). 35 double-precision candidate pipelines
  (mm/inch round trips, NDC, matrix forms) reproduce none of it → not modelled; round window
  coordinates at 10 px/unit hit it (old calibration cases, palette swatches). Window edges: `k = 0` → 0, `k = W` → W−1. At 10 px/unit
  every multiple of 0.1 unit is an exact tie → generators should offset the window by half a pixel.

### 10.3 Thin lines, points, curves (T-PL-2)

`raster-lines` (300 lines; 93 without an endpoint on a pixel boundary) and `probe-line-ties` (208
LINE / 2-vertex LWPOLYLINE with exact half-pixel ties: 8 directions × dyadic and non-dyadic
slopes): both endpoints snap to `(floor u, floor v)`; the line is then represented as
`x(y) = i0 + (y − j0)·K/2^16`, `K = trunc(dx·2^16/dy)` (toward zero), walked from the start point.
y-major lines (|dy| ≥ |dx|) take column `floor(x(j) + ½)` in every row, x-major lines take, in every
column, the row `floor(y*(i) + ½)` of the inverted line `y* = j0 + (i − i0)·2^16/K`. Exact ties
therefore go toward the start point for non-dyadic y-major slopes, toward the end for non-dyadic
x-major slopes (dx/dy truncated) and up/right when the slope is exact in binary: **301/301 lines
exact** (F = 14…24 fraction bits all fit; 16 used). The earlier "halves toward end/start" rule
was 92/93; integer Bresenham 81/93; a DDA on the unsnapped line 4/93. LWPOLYLINE segments behave
like LINEs. VERIFIED-BY-ACAD 2026-09-30 (raster.ts `linePixels`). POINT (PDMODE 0): one pixel at `(floor u, floor v)`. Circles: §10.13.

### 10.4 Lineweights (T-PL-3, T-PL-4)

| lw (1/100 mm) | 0 | 5 | 9 | 13 | 15 | 18 | 20 | 25 | 30 | 35 | 40 | 50 | 53 | 60 | 70 | 80 | 90 | 100 | 106 | 120 | 140 | 158 | 200 | 211 | −3 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PNG px | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 3 | 3 | 4 | 4 | 4 | 5 | 6 | 6 | 8 | 8 | 1 |
| PDF (1/600 in) | 0 | 1 | 2 | 3 | 4 | 4 | 5 | 6 | 7 | 8 | 9 | 12 | 13 | 14 | 17 | 19 | 21 | 24 | 25 | 28 | 33 | 37 | 47 | 50 | 6 |

- PNG `w = max(1, round(mm × 100/25.4))` (the §5.4 table rounded); PDF `round(mm × 600/25.4)`,
  lineweight 0 → `0 w` (hairline). Same widths on 2000×1500, 4000×3000 and with the centre line
  shifted by 0.5 px.
- Horizontal/vertical band relative to the snapped centre pixel `p` (v up):
  `[p − ⌊(w−1)/2⌋, p + ⌈(w−1)/2⌉]` (even widths get the extra pixel up/right); identical for 4
  sub-pixel offsets of the line.
- Round caps. Extra pixels beyond the snapped end pixel per band row (bottom → top): w = 8 start
  `0 2 2 3 2 2 1 0`, end `0 2 3 4 3 2 1 0`; w = 6 `0 2 2 2 1 0` at both ends; w = 4 start
  `0 1 0 0`, end `0 2 1 0`; w = 3 `0 1 0`; w = 2 start `0 0`, end `1 0`.
- A 90° LWPOLYLINE corner gives exactly the pixels of two LINEs with round caps meeting there.
- Zero-length LINE: a small blob (w = 8: 24 px, 6×5; w = 6: 8 px; w = 2–4: 3 px). **POINT ignores
  the lineweight** (1 px at any weight).
- Diagonal strokes are narrower than a round pen: horizontal run per row for w = 8 at
  10°/30°/45°/60° = 41–42 / 16–17 / 9 / 9–10 px (a round pen gives 46 / 16 / 11.3 / 9.2);
  w = 6: 28–29 / 10–11 / 9 / 6–7; w = 4: 17 / 7–8 / 5 / 4–5. The wide-line algorithm: §10.14.

### 10.5 Fills

SOLID / solid HATCH vertices are snapped to pixels (identical pixels for 4 sub-pixel offsets).
Axis-aligned SOLID rectangles fill exactly `[floor x0, floor x1) × [floor y0, floor y1)`.
**Rule** (VERIFIED-BY-ACAD `raster-fills`, `probe-fills` 2026-09-30): vertices `(floor u, floor v)`;
the scanline of row j is `y = j` (the pixel's lower edge), crossings over `[ymin, ymax)`; every edge
is walked from its lower vertex with the slope `trunc(dx·2^16/dy)/2^16`; pixel i is filled when
`x_left < i + ½ ≤ x_right` (exact dyadic ties: left edges exclude, right edges include). All 20
random SOLID triangles/quads and all SOLIDs of `raster-fills` off pixel boundaries are exact.
**Solid HATCH** is first cut into trapezoids at the y of every boundary vertex (exact coordinates,
all edges of the band, before snapping); each trapezoid's four corners snap separately and fill
with the rule above — a triangle's long edge kinks at its snapped split point. 40/40 hatches without
islands exact (triangles, quads, concave 7-gons). With an island the outer edges are split only at
*some* island vertex levels (a pure trapezoidal map: 0/10, full band split: 1/10 exact, 4–39 px off)
— open (raster.ts `trapezoids`). Fills get **no lineweight outline** (hatches/solids with 0.50 and 2.11 mm look like 0).

### 10.6 Raster format

IHDR depth 8, colour type 2 (RGB), not interlaced; only IHDR/IDAT/IEND chunks. The PC3 says
`RGBA`/32 bit, but the PNG is RGB. Background FFFFFF (`RASTER_RGB_Back_Color=16777215`). No
anti-aliasing anywhere.

### 10.7 Colours (T-PL-5)

Full measured table in note 06 §3.5. acad.ctb in model space, in paper space, through a viewport
and in the PDF all give the same palette, which matches neither the "light" nor the "dark" table
of note 06 (55/255 equal each); ACI 7 → 000000, ACI 255 → FAFAFA (not white); true colours
exact; monochrome.ctb blackens ACI colours but **not true colours**.

### 10.8 Determinism

5 cases re-plotted: PNG byte-identical; PDF differs only in `/CreationDate` and `/ModDate`.

### 10.9 PDF output

Page = sheet (20×15 in → 1440×1080 pt), `0.12 0 0 0.12 0 0 cm` → 1 unit = 1/600 in, y up; the
window maps onto `[0, 12000]` with the border drawn at 0 and 11999 (last-pixel snapping as in the
PNG); circles/arcs as cubic Béziers (full circle = 4 segments, centres on half units, e.g.
2400.5); ellipses/splines as polylines with integer coordinates; `1 J`, `1 j`; one optional-content
group per layer; fills with `b`. A geometry oracle to 1/600 in (0.17 PNG px).

### 10.10 Paper space

- Window plots of layouts use the same mapping (paper units → px): a 200 × 150 mm layout on
  2000×1500 = 10 px/mm; the paper border lands on columns 0/1999 and rows 0/1499; the VIEWPORT
  frame (layer 0) is plotted.
- **Twist** (`vp-twist`, twists 0/30/−45/90, VIEWPORT 51 in degrees): 5/5 probe points match
  `paper = vp.center + s · (R_ccw(twist) · p − view_center)`, `s` = VP height / view height, view
  centre (12) in the twisted DCS; the clockwise and WCS-centre alternatives score 0–2/5. This
  confirms ezdxf's sign (§3.5).
- An ezdxf-written, never-activated layout (VIEWPORT 90 = 0) plots its viewport; DXFOUT keeps
  90 = 0 and renumbers 69 (overall = 1). DXFOUT of the page setup: 70 = 672, 72 = 1, 74 = 5,
  75 = 16 (unchanged with `Save changes = N`).

### 10.11 Still open

Raster rules still open (2026-09-30): exact-tie noise (§10.2); hatch trapezoids around islands
(§10.5); circle-vs-graphics-system decision for arcs near the canvas edge (only "full circle inside
the canvas" tested) and clipped arcs (`polylines/bulge-0011`, `flat-bulge`); CIRCLEs in a tilted
OCS (projected ellipses: the GS rule is worse than a chord tolerance, `ocs/circle-tilt-*`); bulge
arcs next to lines (`polylines/closed-0004`); hatch boundary arcs (`ocs/hatch-z`); SPLINE
tessellation; wide-stroke edge tie direction (12/288 lines) and 2 px caps (122/136); zero-length
strokes of other widths (table from 3 widths); the GS factor 1.016 vs 1 for outlines.
Not raster: orientation/upside-down (T-PL-7), page-setup oracle (T-PL-8), Extents plots (T-PL-9:
padding of the effective plotting area, note 03 §6.2). ("Plot paper space first" polarity:
answered in §10.12.)

### 10.12 Layouts and viewports (layouts suite, 169 cases, 2026-09-30)

VERIFIED-BY-ACAD, AutoCAD 2027 through `tools/acad` (`samples/refs/acad2027-R26.0/layouts/*`;
implementation `packages/render/src/layout.ts`, `draw/viewport.ts`). Case ids in brackets.

**Plot area and paper frame**
- **Plot area "Layout" on the raster device: 1 device pixel = 1 paper unit** (mm or inch; the
  `-PLOT` "Fit" answer is ignored), paper-space (0,0) at the lower-left canvas corner with plot
  offset 0,0; negative paper coordinates (margins + offset 46/47) fall outside. LAYOUT limits,
  margins and 73 play no role (area-layout-mm/-inch/-*-margins-offset, area-layout-rotation-1..3
  with the harness' Landscape, bogus-limits-layout, calibration/layout-area-layout). Window plots
  of layouts use the §10.2 mapping in paper units (area-window-*).
- Open: in area-window-inch-margins-offset (16×12 in, margins + offset, 125 px/in) paper geometry
  on the right lands 1–2 px left of the §10.2 prediction (x = 12.8 in → col 1880 instead of 1881),
  as if the scale were ≈ 124.96 px/in; the mm and plain inch variants are exact.

**Which viewports plot**
- The **overall viewport is the VIEWPORT with 69 = 1**, wherever it is in the entity list; it
  draws neither frame nor content (overall-last, overall-first-looks-like-user: a user viewport
  with id 1 is treated as the overall one and vanishes, the real overall viewport with id 2 is
  plotted as a model viewport at 1:1). Without any id 1 (ids-all-zero, ids-all-minus1) every
  VIEWPORT is a model viewport, and DXFOUT shows AutoCAD created a new overall viewport (id 1,
  90 = 32800) and renumbered the others.
- **On/off is 68, not 90**: content plots unless 68 = 0 (68 = −1, 1, 2 … all plot); 90 bit
  0x20000 with 68 = 1 plots (onoff-flag, status-sweep, status-all-zero). On load AutoCAD rewrites
  90 bit 0x20000 from 68 (DXFOUT of onoff-flag / status-all-zero: 68 = 0 → 90 = 0x20000; 68 = 1
  with 0x20000 → 90 = 0).
- **Non-activated layouts are written with 68 = 0 and 69 = 0** for all user viewports (DXFOUT of
  multi-plot-*; ezdxf#1014 confirmed, Q-0711) while they still plot. truedxf therefore applies
  "68 = 0 = off" to the active layout (`*Paper_Space`) only and uses 90 bit 0x20000 for the
  other layouts (ASSUMPTION for AutoCAD-written inactive layouts; the generated inactive layouts
  had 68 = 2 and plotted, multi-plot-sheet2/-sheet3).
- All viewports plot beyond $MAXACTVP (maxactvp-2, maxactvp-64).
- LAYOUT 70 bits 8192/16384 and a missing overall viewport do not matter; such layouts open and
  plot (no-overall*, initflags-with-overall, Q-0704).

**Frames**
- Rectangular viewports plot their rectangle (40/41) **in the VIEWPORT's colour, always 1 px and
  continuous**: the VIEWPORT's lineweight and linetype are ignored (frame-layer-props: layer
  0.50 mm DASHED and entity 1.00 mm DASHDOT both plot as 1-px solid lines in colours 1 / 3).
- A VIEWPORT on an off, frozen, no-plot (290 = 0) or Defpoints layer loses only its frame; its
  **content still plots** (vp-on-off-layer, vp-on-frozen-layer, frame-noplot, frame-defpoints give
  identical images). Frames also plot for viewports with 68 = 0 (status-all-zero).
- PLOTSETTINGS 70 bit 1 (PlotViewportBorders) has no effect (frame-plotflag-bit1-0/-1, Q-0717).
- Non-rectangular viewports (90 bit 0x10000 + 340) draw no rectangle; the clip entity plots as an
  ordinary paper-space entity with its own properties (clip-polygon-red-lw50, clip-bulge …); the
  clip entity wins over 10/40/41 (clip-bbox-mismatch).

**Transform** (§3.5 formula, twist CCW): verified for scales 1:10 … 2:1, view centre in DCS with
target offsets and twist (viewcenter-*, twist-* incl. 180/270/400/−45), and 3D views with the
arbitrary-axis DCS (view3d-*: top/bottom/front/back/left/right/iso/oblique; bottom = mirrored X,
non-normalized directions are normalized; Q-0722/0723/0724). Perspective (90 bit 0x1) is not
implemented (view3d-perspective). VIEWPORT UCS (71/110-112/146) has no effect (ucs-per-viewport).

**Front/back clip planes** (clipplanes-*, model LINEs at z = −50…50, 43 = 20, 44 = −20):
back clip (0x4) keeps depth ≥ 44; front clip (0x2) keeps depth ≤ 43 only with 0x10 ("front clip
not at eye"); without 0x10 the front plane is at the target (depth ≤ 0). Depth = view direction ·
(P − target) (Q-0726).

**Clipping** (note 07 §7.5 has the XCLIP side): thick strokes crossing a viewport border are cut
straight at the border, no caps outside (clip-thick-rect). A 2.11 mm model line lying exactly on
a polygonal clip boundary disappears completely (clip-thick-bulge, x = 60), i.e. AutoCAD clips
the centre line geometrically (boundary-collinear pieces dropped for polygons) and then clips the
widened stroke to the region. Solid fills in viewports stop one pixel short of the frame on the
right/top in some cases (ps-over-vp-psfirst-y: frame at col 1600 / row 299, fill to col 1598 /
row 301, 1-px gap) while thick strokes reach the pixel next to the frame (clip-thick-rect) — open
(fill edge rule, §10.5). The log's per-viewport "Effective plotting area" (e.g. 1198 × 898 for a
1200 × 900 px viewport) reflects this inset.

**Draw order**
- "Plot paper space first? **No**" (the default answer when PLOTSETTINGS 70 bit 512
  DrawViewportsFirst is set, e.g. 688; "Yes" is the default without it — ps-over-vp-flag512-0/-1
  logs): all viewport content first, paper-space entities on top. "Yes": paper space first,
  viewport content on top (ps-over-vp-psfirst-n/-y; Q-0292). The log order "Plotting viewport 2 …
  Plotting viewport 1" matches (1 = paper space).
- A paper-space WIPEOUT **never masks viewport content**, also when paper space is plotted last
  (wipeout-over-vp-psfirst-n/-y, Q-0294).
- Overlapping viewports: the later-created one (higher handle, higher 69) is on top, independent
  of entity order and 68 (vp-overlap-order-ab/-ba, vp-overlap-status-swapped; Q-0714).

**Layer state, linetypes, lineweights**
- VIEWPORT 331 frozen layers hide only in that viewport, also for INSERTs on the layer and for
  nested non-0 content (vpfreeze, vpfreeze-both-globally-off, insert-vpfreeze-l1/-l2; Q-0620,
  Q-0718); per-VP layer overrides (colour ACI/RGB, lineweight, linetype) apply only there
  (vpoverride-*). LAYER 70 bit 2 has no plot effect (newvpfrozen-model/-layout, Q-0285).
  The VIEWPORT's own plot style sheet (1) is ignored (vp-plotstyle-name, Q-0719).
- **PSLTSCALE: the header `$PSLTSCALE` decides for the active layout, LAYOUT 70 bit 1 for other
  layouts**: psltscale-h1-l0 = h1-l1 (paper dash 64-65 px in 1:1, 1:4 and 1:10 strips) and
  h0-l1 = h0-l0 (dashes scale with the viewport); psltscale-two-layouts: header 1, Sheet2 bit 1 =
  0 → Sheet2 plots unscaled dashes (Q-0315, Q-0316, Q-0317). PLOT regenerates, no REGENALL needed
  (Q-0318). Dash lengths on paper = pattern × LTSCALE × 48 with PSLTSCALE 1.
- Lineweights through viewports are absolute paper widths, independent of the viewport scale
  (lineweight-vp-scale).


### 10.13 Curve tessellation (PNG)

Cases `probe-circles` (129 circles, r 0.3–68 px, 3 sub-pixel centres each), `probe-circles-large`
(29, r 70–731 px), `probe-arcs` (60), `probe-ellipses` (30), `raster-curves`, `polylines/bulge-*`;
VERIFIED-BY-ACAD 2026-09-30, raster.ts `arcVertices`, `arcSegmentCount`, `gsSegmentCount`. The raster
rules of §10.3–10.5, §10.13 and §10.14 are reproduced by rendering the cases with the CPU
rasterizer: `node packages/testkit/src/experiment.ts calibration/<case>` prints `exact=0` for
`probe-circles`, `probe-arcs`, `probe-ellipses`, `probe-line-ties` (probe-thick 15 px, probe-fills
188 px: the island hatches).

- **CIRCLE / ARC** (and polyline bulge arcs) whose full circle lies inside the canvas go to the
  raster driver as arcs: centre snapped to its pixel centre `C = (floor u + ½, floor v + ½)`,
  integer radius `Ri = ceil(r) − 1` (r = device radius; an exact integer r gives r − 1),
  `n = 2·ceil(|sweep|/π · √Ri + ¼)` segments (full circle `2·ceil(2√Ri + ¼)`: Ri 1→6, 6→12, 49→30,
  456→86, 599→100), uniform angles from the start angle (0 for circles), vertices
  `floor(C + Ri·(cos t, sin t))` evaluated in double at absolute device coordinates (an exact
  −24.5 offset rounds differently at x ≈ 56 and x ≈ 685), segments drawn with the thin-line rule
  in CCW order. 115/115 + 7/7 uncontaminated circles and 60/60 arcs exact; the result depends only
  on (pixel, Ri), not on the sub-pixel centre. The PDF driver instead writes Béziers (§10.9).
- **Graphics-system tessellation** for ELLIPSE (and arcs whose circle leaves the canvas, e.g.
  `polylines/bulge-0003/-0009/-0010`): `ceil(max(32, π·√(a·f)) · |sweep| / 2π)` segments uniform in
  the parameter from the start parameter, vertices at the exact points (then snapped like any line
  vertex); a = semi-major axis in device units; f = 1.016 fits PNG strokes (range 1.0084–1.0254),
  f = 1 the outlines of wide polylines (`ring-semicircle-w6` exact) and the PDF driver (same rule at
  600 dpi, 30/30 counts). The minimum 32 applies before the sweep scaling. 30/30 ellipses exact.

### 10.14 Wide strokes (PNG)

Cases `probe-thick` (11 lineweights × 24 directions + zero-length), `thick-probe`,
`probe-thick-curves`; VERIFIED-BY-ACAD 2026-09-30, raster.ts `strokeSegmentPolygon`,
`fillConvexByEdges`.

- Each segment (w ≥ 3 px, snapped end pixels P0, P1) is a convex polygon with integer vertices,
  counter-clockwise: `P0 + o−, P1 + o−`, end cap, `P1 + o+, P0 + o+`, start cap, with
  `o± = round-half-up(±h·n)`, `h = (w − 1)/2`, n = left unit normal of P1 − P0. The caps are arcs
  of radius h around P with `max(2, floor(h) + 1)` segments per half circle (w 3–4: 2, 5–6: 3, 8: 4)
  from +n/−n, vertices `P + round-half-up(h·(cos a, sin a))`. The polygon's edges are drawn with the
  thin-line rule in polygon order and every row is filled between its leftmost and rightmost edge
  pixel. This explains the diagonal footprints of §10.4 (w = 8 at 45°: offsets (±2, ∓2) → 9 px
  runs) and the tabulated cap shapes. Body offsets 281/288, whole strokes 269/288 exact; the rest
  differ by the tie direction of an edge.
- w = 2: the thin line plus its copy one pixel up (x-major) or right (y-major); caps of radius ½
  with 2 segments (122/136 strokes exact).
- Polylines: every segment separately with both caps (joins = union), as §10.4 found for corners.
- Zero-length strokes (and linetype dots with a lineweight): fixed footprints relative to the
  pixel — w 2–4: (−1,0), (0,0), (0,−1); w 5–6: rows +1: −1..0, 0: −2..1, −1: −1..0; w 8: rows ±2:
  −2..1, ±1: −2..2, 0: −3..2 (all sub-pixel positions identical). POINT stays 1 px.

---

## 11. Never-activated layouts

A layout created but never activated in AutoCAD has an empty paper-space block (not even the
overall VIEWPORT, id 1), paper size 0 x 0 and default limits (0,0)-(12,9). Example:
`Studienleistung-Bebauungsplan.dxf` "Layout2" (local user sample).

- VERIFIED-BY-ACAD user/bebauungsplan-l2, user/bebauungsplan-l2ext (2026-10-01): accoreconsole
  plots the layout blank (window "layout" and "extents" alike); the log shows "Regenerating
  layout." and the page setup falls back to the device default (ANSI A for DWG To PDF). DXFOUT
  keeps the layout untouched: 0 entities, paper 0 x 0. The console never initializes it.
- The AutoCAD GUI initializes the layout when its tab is first activated (default page setup and,
  with LAYOUTCREATEVIEWPORT = 1, a viewport showing the model extents). That is editor behaviour,
  not file content: truedxf renders the layout empty and the viewer marks it as such
  (`LayoutInfo.empty`). UNVERIFIED: the exact default page/viewport the GUI creates.

## Sources

Local: `spec` p.150-155 (VIEWPORT), p.176-178 (LAYOUT), p.189-191 (PLOTSETTINGS), header vars
p.1261-1605 of the text file; `oda` 20.4.38 VIEWPORT, 20.4.84 LAYOUT; `ezdxf:src/ezdxf/entities/{viewport,layout,vport,layer}.py`,
`ezdxf:src/ezdxf/layouts/{layout,layouts}.py`, `ezdxf:src/ezdxf/sections/entities.py`,
`ezdxf:src/ezdxf/addons/drawing/{frontend,pipeline,layout,properties,config}.py`,
`ezdxf:src/ezdxf/lldxf/const.py`, `ezdxf:src/ezdxf/addons/acadctb.py`, `ezdxf:docs/source/dxfinternals/layout_management.rst`,
`ezdxf:docs/source/concepts/{paperspace,extents_limits,coordinates}.rst`, `ezdxf:notes/pages/*`,
`ezdxf:tests/test_02_dxf_graphics/test_211_viewport.py`; ixmilia `ObjectsSpec.xml`,
`IxMilia.Dxf.Integration.Test/*`; ACadSharp `Entities/Viewport.cs`, `Objects/PlotSettings.cs`;
libredwg `src/dwg.spec`; mlightcad `AcGiViewport.ts`, `AcPdfPaperViewport.ts`; dxf-viewer parser.
Threads: ezdxf#634, #864, #1014, #1031, #1298, #1318, PR #1319, PR #1320, #1386, PR #1401, #535,
#881, #618; acadsharp#1077, #1096, #1149, #1157, #1188, #1197; mlightcad-viewer#197, #284, #327,
#338, #347; realdwg-web#138, #155; netdxf#126, #111.

Web (accessed 2026-09-30):
- https://help.autodesk.com/view/OARX/2025/ENU/?guid=AUTOCAD_CORE_CONSOLE (switch list, via search summary)
- https://blog.autodesk.io/getting-started-with-accoreconsole/
- https://blog.autodesk.io/notes-on-using-da4a/
- https://www.keanw.com/2012/02/the-autocad-2013-core-console.html
- https://www.cadtutor.net/forum/topic/44080-up-and-running-with-the-2013-core-console/
- https://fdestech.com/resources/accoreconsole-guide-headless-cad-automation/
- https://fdestech.com/resources/accoreconsole-script-examples/
- https://www.houseofbim.com/posts/son-of-a-batch-autocad-core-console-through-lisp/
- https://www.cadtutor.net/forum/topic/17296-plotting-to-a-file-using-script/
- https://www.cadtutor.net/forum/topic/69802-help-need-to-generate-lots-of-png-files/
- https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-625E395D-143A-494F-A1EA-1BF119B927DC.htm (-PLOT)
- https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-MAC-Core/files/GUID-AD562D05-6FF6-47AE-B52C-7203031ADFB2.htm (-PLOT)
- https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-264D3513-0D22-4461-82D6-14F391BC5CDE.htm (Plot dialog)
- https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-89604826-0B55-4994-8214-1CA93FA66985.htm (plot scale)
- https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-88080625-C6E0-4FC3-A8FD-226D10DA780D.htm (plot offset)
- https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-1DE891EB-BEA8-48A7-B67D-1F1FB9FF4B66.htm (raster formats)
- https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-38F03A2C-6D36-4AD9-BBE0-9CA574BEF218.htm (PLOTTRANSPARENCYOVERRIDE)
- https://help.autodesk.com/cloudhelp/2016/ENU/AutoCAD-LT/files/GUID-23EA4D64-AE7D-41E5-A8D0-20F060313D62.htm (PSLTSCALE)
- https://help.bricsys.com/en-us/document/system-variable-reference/m/maxactvp-system-variable
- https://www.cadforum.cz/en/qaID.asp?tip=1028 (raster resolution, 100 DPI)
- https://bradshacks.com/autocad-png/
- https://techshelps.github.io/Acad_aug/WS1a9193826455f5ffa23ce210c4a30acaf-60d9-procedure2.htm (custom paper sizes / PMP)
- https://autocadtips1.com/2013/06/03/dview-with-a-twist-rotating-a-viewport-view/
- 403/unreadable, titles or snippets only: Autodesk KB "Lineweights look too thin in high-resolution raster images",
  "How to plot a JPG or PNG with a colored background", "PublishToWeb JPG results in twisted image";
  Autodesk forum "How to create a user plot size of 'PublishToWeb PNG.pc3'", "Set FileDia doesn't work in accoreconsole",
  "Different behavior with same scr code between accoreconsole.exe and AutoCad GUI".
