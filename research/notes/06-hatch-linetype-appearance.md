# 06 — Hatch, linetype & appearance (how things LOOK)

Scope: HATCH / MPOLYGON geometry and fill, linetypes (LTYPE + application algorithm),
colors (ACI / true color / books), transparency, lineweights, plot styles (CTB/STB),
BYLAYER/BYBLOCK property resolution, draw order.

Written for the truedxf implementer. Goal of the renderer: match AutoCAD PLOT output
pixel-for-pixel, so every "AutoCAD does X" statement is tagged with its confidence:

- **VERIFIED-BY-ACAD** — someone checked it in AutoCAD/TrueView (cited), or it is visible in an
  AutoCAD-written DXF (cited).
- **DOC** — stated by Autodesk documentation (help pages / DXF reference), not independently verified.
- **ASSUMPTION** — our best guess / common CAD knowledge, not verified.
- **UNKNOWN** — needs an AutoCAD test (feeds the test backlog, see "Test ideas" at the end).
- **CONFLICT** — sources disagree.

Source abbreviations:

- `spec` = `research/spec/autocad_2012_dxf_reference.txt` (line numbers of the text dump, `spec:L4287`)
- `oda` = `research/spec/OpenDesign_Specification_for_.dwg_files.txt` (`oda:L10089`)
- `ezdxf:` = `research/repos/ezdxf/src/ezdxf/...` unless a `docs/` or `notes/` path is given
- `ezdxf#N` = `research/github/raw/mozman__ezdxf/threads/issue-0000N.md` (or discussion/pr)
- `acadsharp#N`, `netdxf#N`, `dxfviewer#N`, `mlightcad#N` analogous
  (`DomCR__ACadSharp`, `haplokuon__netDxf`, `vagran__dxf-viewer`, `mlightcad__cad-viewer`)
- `acs-sample` = `research/repos/ACadSharp/samples/sample_AC1032_ascii.dxf` ($ACADVER AC1032,
  $ACADMAINTVER 329 — looks AutoCAD-written; the other `sample_AC10xx` files are the same drawing
  saved in other versions). **ASSUMPTION:** written by AutoCAD, not by ACadSharp. Where this note
  says "seen in acs-sample" it is real-world evidence, but not a controlled test.

---

## 0. TL;DR — decisions for the renderer

Interactive LOD (2026-10-02; **viewer approximation**, not an AutoCAD rule): smooth raster with
`lod: true` replaces pattern families with perpendicular spacing below one device pixel by
an even-odd fill of the same selected loops. Its alpha is the clamped sum of on-fractions divided
by spacing in pixels; dots count as one pixel of on-length, continuous families have fraction 1.
Families with spacing at least one pixel but a sub-pixel dash period become continuous. The
100,000-line test still counts **all original families before simplification** (§1.6.3).
LOD also draws lineweight strokes at most 1.5 pixels wide as hairlines. Filled polyline bands
keep their geometry: a centre-line shortcut increased vertices and visibly brightened sub-pixel
bands in huge-blocks-187. These changes are excluded from plots.

1. **HATCH pattern lines in DXF are final geometry**: base point, offset and dash lengths are
   stored already scaled by 41 and rotated by 52 (and include the hatch origin and the doubled
   lines of 77). Render the stored 53/43/44/45/46/49 data; use 2/52/41/77 only when *creating*
   hatches. We therefore do **not need any .pat file to render** (only to author). (§1.6)
2. HATCH never draws its boundary. MPOLYGON does. (§1.12, §1.14)
3. Fill rule: filter paths by hatch style 75 + path flags (ezdxf `rendering_paths`), then fill
   **even-odd** over all remaining loops (ezdxf/dxf-viewer both effectively do odd-parity).
   Text-box loops (flag 8) are holes only in the sense of island detection; ezdxf drops them. (§1.5)
4. Arc/ellipse edges with ccw=0 store *complementary* angles (360−a). (§1.3.3)
5. Linetypes: AutoCAD's "A-type alignment" is **VERIFIED-BY-ACAD** (2026-09-30, §2.6.1): per
   unit (LINE, ARC, open curve, PLINEGEN-off segment) k = ⌊L/P⌋, r = L − kP and both end dashes
   become e0/2 + r/2; L < P → continuous. Closed curves (CIRCLE, full ELLIPSE, closed PLINEGEN
   polyline) are **stretched** to max(2, round(L/P)) whole periods. INSERT scale never scales
   linetypes; XLINE/RAY are clipped to the plot window first. (§2.6.1)
6. Complex linetype text/shape rotation (DXF 50) is written in **degrees** by AutoCAD (acs-sample),
   not radians as the DXF reference claims. 74 bit 8 = upright ("U="). (§2.2)
7. ACI→RGB: there is **no single agreed table** — two palettes circulate (a "light" one with
   CC/99/7F/4C ramps and a "dark" one with A5/7F/4C/26 ramps), and AutoCAD itself switches
   display palettes by background color. **VERIFIED-BY-ACAD: PLOT uses a third table** (ramps
   FF/DD/B8/95/72, 9 = DCDCDC, 255 = FAFAFA) in model and paper space, PNG and PDF. (§3.5)
8. ACI 7 plots black on white paper. BYBLOCK at top level → color 7, CONTINUOUS, default lineweight.
9. 440 transparency: `0x02000000 | alpha`, alpha = trunc(255·(100−t%)/100); `0x01000000` = BYBLOCK;
   absent = BYLAYER. Transparency is only plotted if the page setup's "plot transparency" is on
   (LAYOUT XDATA `PLOTTRANSPARENCY`) — harness should keep it **off** except in dedicated tests. (§4)
10. Lineweight: mm×100 enum; 0 = thinnest device line (1 px); −3 DEFAULT = LWDEFAULT (registry,
    0.25 mm — not in the DXF). Plot flag 128 "plot object lineweights". Solid fills, TrueType text,
    images, points and wide polylines (in plan view) do not get lineweight. (§5)
11. Harness: CTB mode ($PSTYLEMODE=1), `acad.ctb` (= every pen "use object …") or plot-styles flag
    off, lineweights on, transparency off, white paper, raster PC3 at a known DPI. (§6.6)
12. Draw order: block-record entity order (= DXF file order on load), overridden by SORTENTSTABLE
    sort handles (missing entries use their own handle; sort handle "0" sorts last). Whether the
    base order is *file* order or *handle* order when both differ is **UNKNOWN**. (§8)

---

## 1. HATCH

### 1.1 Group codes (AcDbHatch subclass), in file order

Order matters: the boundary data, pattern data, seed points and gradient data are repeated
groups that reuse codes 10/20/40/42/72/73/97 etc., so the parser must be positional.
Sources: spec:L4287–4640, oda:L10089–10330, ezdxf:entities/hatch.py:34–175 (`export_entity` order),
ezdxf:entities/polygon.py (`load_paths`/`load_pattern`/`load_gradient`/`load_seeds`).

| Code | Meaning | Notes |
|---|---|---|
| 100 | `AcDbHatch` | |
| 10/20/30 | "elevation point" in OCS; X=Y=0, **Z = elevation** | spec:L4296 |
| 210/220/230 | extrusion (default 0,0,1) | boundary & pattern are 2D in this OCS |
| 2 | pattern name | `SOLID` for solid & gradient. AutoCAD may append the island-style suffix: `SOLID,_O` seen in acs-sample (HATCH 3/4). Strip `,_X` before lookups (ASSUMPTION: `_O`=outer, `_I`=ignore, `_N`=normal, from HATCH command syntax). |
| 70 | solid fill flag: 1 solid (also gradient), 0 pattern | for MPOLYGON: *version* (spec) |
| 63 | MPOLYGON only: fill color ACI | |
| 71 | associativity: 1 associative | MPOLYGON: solid-fill flag |
| 91 | number of boundary paths | then boundary path data (§1.3) |
| 75 | hatch style 0 normal("odd parity") / 1 outer / 2 ignore | §1.5 |
| 76 | pattern type 0 user-defined / 1 predefined / 2 custom | §1.6 |
| 52 | pattern angle (deg) | pattern fill only; informational |
| 41 | pattern scale or spacing | pattern fill only; informational |
| 73 | MPOLYGON only: boundary annotation flag | |
| 77 | double flag | pattern fill only; informational |
| 78 | number of pattern definition lines | then pattern line data 53/43/44/45/46/79/49… |
| 47 | pixel size | oda: only present if any path flag has bit 4 "derived" (oda:L10289). No rendering effect. |
| 98 | number of seed points | then 10/20 pairs (OCS) |
| 11 | MPOLYGON only: offset vector | |
| 99 | MPOLYGON only: number of degenerate loops | |
| 450 | 0 solid / 1 gradient (R2004+). If present, 451,452,453,460,461,462,470 must all be present (spec) | §1.9 |
| 451 | reserved 0 | |
| 452 | 0 two-color, 1 single-color ("used only by dialog code") | |
| 453 | number of colors: 0 solid / 2 gradient | |
| 460 | gradient rotation (**radians**) | |
| 461 | gradient shift ("Centered" option), 0..1 | |
| 462 | tint value 0..1 (single-color gradient) | |
| 463 | per color: 0.0 first / 1.0 second (a "position"?) | repeated with 63/421 |
| 63 / 421 | per color: ACI (optional) / true color | ezdxf:entities/gradient.py `load_tags` |
| 470 | gradient name, default `LINEAR` | |

XDATA seen on AutoCAD hatches (acs-sample, all 8 hatches): `1001 GradientColor1ACI / 1070 5`,
`1001 GradientColor2ACI / 1070 2`, `1001 ACAD / 1010 0,0,0`. Meaning of the `ACAD 1010` point is
**UNKNOWN** (plausibly the hatch origin HPORIGIN; but in HATCH 1 the pattern base point is
(2.75,0) while the XDATA point is (0,0), so it is not simply the base point). Pattern background
color: `1001 HATCHBACKGROUNDCOLOR / 1071 rawcolor` (§1.10).

**Parser gotchas** (all from real issues):
- ezdxf locates the boundary data by the *first* code 91 after the subclass marker and warns
  "Spline data also contains group code 91!" (ezdxf:entities/polygon.py `load_paths`); codes
  10/20/40/42/72/73/97 are reused by several nested groups. Parse positionally with a small state
  machine (path → edge → spline sub-groups), never by "find next code X".
- ACadSharp wrote 50/51 of arc edges in radians (acadsharp#1002) and normalized 360→0
  (acadsharp#1025): **VERIFIED-BY-ACAD (TrueView)**: an arc edge 0..0 instead of 0..360 makes
  TrueView reject/not draw the hatch; manually restoring 360 fixes it (acadsharp#1025). Full-sweep
  edges must keep `end − start = 360` (acadsharp pr-1237 keeps e.g. −180..180).
- ellipse edge 11/21 read wrongly by ACadSharp (acadsharp#1099), ratio 40 not read (acadsharp#147).

### 1.2 Solid vs pattern vs gradient

- `70=1` and no 450, or `450=0` → solid fill with the entity color (ezdxf:addons/drawing/properties.py:899 `resolve_filling`).
- `70=1` and `450=1` → gradient; entity color is irrelevant for the fill (colors in 421).
- `70=0` → pattern fill with the pattern lines of code 78; lines drawn with the entity color,
  linetype CONTINUOUS (the dash structure comes from the pattern), entity lineweight.
  ezdxf forces `linetype_pattern = ()` for hatch pattern lines (ezdxf:addons/drawing/frontend.py:547).
  **ASSUMPTION:** AutoCAD ignores the HATCH entity linetype for pattern lines.
- Pattern fill with a background color → XDATA `HATCHBACKGROUNDCOLOR` (§1.10): solid fill in that
  color below the pattern lines (ASSUMPTION about layering).
- `FILLMODE=0` ($FILLMODE header, default 1, spec:L1165): "wide polylines, solid-filled polygons,
  gradient fill, and hatches are displayed in outline form" (**DOC**, Autodesk help via web search
  "To turn on or off the display of solid fills"). Harness keeps FILLMODE=1.

### 1.3 Boundary paths

#### 1.3.1 Path flags (92), bit-coded

| Bit | Name | Source |
|---|---|---|
| 0 | default | spec:L4452 |
| 1 | external | spec |
| 2 | polyline (path is a polyline path, otherwise edge path) | spec |
| 4 | derived | spec |
| 8 | textbox | spec |
| 16 | outermost | spec |
| 32 | not closed | ACadSharp `Entities/BoundaryPathFlags.cs` (= ObjectARX `AcDbHatch::kNotClosed`) |
| 64 | self-intersecting | ACadSharp |
| 128 | text island ("text loop surrounded by an even number of loops") | ACadSharp |
| 256 | duplicate | ACadSharp |
| 512 | is annotative | ACadSharp |
| 1024 | does not support scale | ACadSharp |
| 2048 | force annotative all visible | ACadSharp |
| 4096 | orient to paper | ACadSharp |
| 8192 | is annotative block | ACadSharp |

AutoCAD-written values seen: `92=1` (external edge path), `92=7` (external|polyline|derived)
(acs-sample). The bits ≥ 32 are only in ACadSharp (from ObjectARX headers, ASSUMPTION they appear
in DXF as-is). Rendering-relevant: 1, 2, 8, 16 (§1.5). Bit 2 decides the path *encoding*
(ezdxf:entities/boundary_paths.py `BoundaryPaths.load_tags`: `is_polyline_path = flags & 2`).

#### 1.3.2 Polyline path (flag bit 2)

`92 flags, 72 has_bulge, 73 is_closed, 93 n_vertices, (10,20[,42]){n}, 97 n_sources, 330…`
(spec:L4478, oda:L10248). For HATCH the order is 72 then 73; for **MPOLYGON it is 73 then 72**
(ezdxf:entities/boundary_paths.py `PolylinePath.export_dxf`, comment "great design :<").
Bulge semantics as LWPOLYLINE: bulge on vertex *i* describes segment i→i+1; tan(θ/4), positive =
CCW. `42` appears after each vertex only when 72=1 (ezdxf writes it for all vertices then).
`73=0` (open) still behaves as closed for filling: ezdxf closes every sub-path
(`hatch_boundary_paths` → `sub_path.close()`, ezdxf:render/hatching.py:630ff). ASSUMPTION: AutoCAD
too. MPOLYGON polyline paths have no 97/330.

#### 1.3.3 Edge path

`92 flags, 93 n_edges, {72 edge_type, edge data}{n}, 97 n_sources, 330…`. Edge types:

| 72 | Edge | Codes |
|---|---|---|
| 1 | line | 10/20 start, 11/21 end |
| 2 | circular arc | 10/20 center, 40 radius, 50 start angle, 51 end angle (**degrees**), 73 ccw |
| 3 | elliptic arc | 10/20 center, 11/21 major-axis endpoint relative to center, 40 minor/major **ratio** (spec calls it "length of minor axis (percentage…)", it is a ratio), 50/51 start/end, 73 ccw |
| 4 | spline | 94 degree, 73 rational, 74 periodic, 95 n_knots, 96 n_ctrl, 40 knots…, 10/20 ctrl [42 weight]…, R2010+: 97 n_fit, 11/21 fit…, 12/22 start tangent, 13/23 end tangent |

**ccw = 0 convention (arc and ellipse edges).** The DXF stores clockwise edges with *complementary*
angles: a CW arc from 90° to 0° is written as `50=270, 51=360, 73=0` (ezdxf#175, with TrueView
screenshots — **VERIFIED-BY-ACAD (TrueView), mozman 2020**; "no official documentation … works
until someone proves otherwise", mozman 2022). Loader rule (ezdxf:entities/boundary_paths.py:1073
and :1211):

```
if ccw: a0, a1 = start, end              # CCW sweep a0 → a1
else:   a0, a1 = 360 − end, 360 − start  # CCW representation; traverse reversed (a1 → a0)
```

i.e. in the CW case the geometric points are at angles `−start` … `−end` (mirrored about the
x-axis of the edge's local frame), traversed clockwise. For the *fill* the traversal direction does
not matter (even-odd), but it matters for chaining edges and for finding gaps.
For ellipse edges the same complement rule is applied (ezdxf#175 "also valid for ellipse edges").

**Ellipse edge angles are geometric angles** (degrees, in the ellipse's own frame, after the
ccw = 0 complement): parameter = atan2(sin a / ratio, cos a), kept in the same turn so 0 … 360
stays a full ellipse. **VERIFIED-BY-ACAD 2026-10-01** (`hatches/ellipse-edge-angle-closed`,
`ellipse-edge-param-closed`, `ellipse-edge-rotated-partial`: F1(r=1) 0.71/0.78/0.89 with 50/51
as parameters → 0.998/0.999/1.000 as angles; Q-0352). ezdxf converts them the same way with
`angle_to_param(ratio, a)` (ezdxf:entities/boundary_paths.py `EllipseEdge.start_param`, although
its own comment says "start param, not a real angle"); netDxf also treats them as angles
(`netDxf/Entities/HatchBoundaryPath.cs` `Ellipse(EntityObject)`). ELLIPSE entities use
parameters (41/42, radians).

**Full circle / full ellipse:** `50=0, 51=360` (or any pair with span 360). Keep 360; 0..0 breaks
AutoCAD (acadsharp#1025). ACadSharp preserves −180..180 style spans (acadsharp pr-1237).

**Edge paths may have gaps** (edges not connected end-to-start). ezdxf ignored such open paths in
older versions (ezdxf#706 — AutoCAD still rendered the hatch, **VERIFIED-BY-ACAD** by the reporter's
screenshot); newer ezdxf has `EdgePath.close_gaps(len_tol)` which inserts line edges.
**ASSUMPTION:** AutoCAD closes small gaps implicitly by connecting consecutive edge end/start points.
Also the order of edges is not guaranteed to be head-to-tail; AutoCAD writes them in loop order.

**Spline edges:**
- knots and control points are mandatory, "AutoCAD crashes on invalid data" (ezdxf docstring
  `EdgePath.add_spline`, ezdxf:entities/boundary_paths.py).
- R2010+ needs `97 0` even without fit points (ezdxf:entities/boundary_paths.py:1407
  "(97, 0) len tag required by AutoCAD 2010+"); the ODA spec marks fit data "R24:" (= AC1024,
  R2010) (oda:L10230).
- If fit points are present, start/end tangents 12/13 are written (ezdxf computes them from the
  control polygon if missing, `set_required_tangents`).
- Rational: weights as 42 after each control point (DXF) — ODA shows `weight BD 40` in DWG.
- For rendering use the control points/knots (NURBS). Fit points only if there are no control
  points (ezdxf `spline_edges_to_line_edges` falls back to `BSpline.from_fit_points`).
- Periodic flag (74): ASSUMPTION — knots are still stored explicitly, evaluate as given.

#### 1.3.4 Source boundary objects & associativity

After each path: `97 count`, then `330` handles (soft pointers) of the source entities; ezdxf pops
them from the end of the path tags (ezdxf:entities/boundary_paths.py `pop_source_boundary_objects_tags`).
In DWG the 330s are collected in the handle stream (oda:L10300). 71=1 marks the hatch associative;
source entities have the HATCH in their reactors. **Rendering never uses the source objects** —
the path data stored in the hatch is authoritative (AutoCAD rebuilds it only on edit). A hatch
with 71=1 but missing 97/330 tags is "not valid for AutoCAD" per ezdxf comment; ACadSharp pr-1209
("A hatch does not claim a boundary the file does not carry") clears 71 in that case.

### 1.3.5 How AutoCAD 2027 PLOT builds loops (VERIFIED-BY-ACAD, 2026-09-30)

Cases `hatches/edges-*`, `poly-open-*`, `one-loop-two-rects`, `nested-*`, `solid-fillmode-0`,
`mpolygon-*`; implementation `packages/render/src/draw/hatch.ts` `loopPoints`:
- A loop is the sequence of the **start points** of its edges in stored order: every edge
  contributes its flattened points except its end point, and the loop closes from the last point
  to the first. AutoCAD never reorders or reverses edges: shuffled edges give a bow-tie, one
  reversed edge a triangle, 3 edges of a square a triangle (`edges-shuffled*`,
  `edges-reversed-one`, `edges-open-3-edges`); gaps of 1e-6 … 1 unit are simply bridged
  (`edges-gap-*`); one path with two separate rectangles is one self-intersecting polygon
  (`one-loop-two-rects`). ezdxf's gap closing / chaining is therefore wrong for plots.
  Self-intersecting loops fill even-odd like any other: the solid-fill trapezoid decomposition
  (note 08 §10.5) must also cut at every edge–edge crossing y, otherwise edges that cross inside a
  slab pair up wrongly (`selfint-bowtie`, `selfint-pentagram`, `selfint-pentagram-flag65`,
  `edges-shuffled`, `one-loop-two-rects` exact after that fix, 2026-10-01; render/src/raster.ts
  `trapezoids`).
- A polyline path with 73 = 0 has n − 1 segments, so its **last vertex is dropped**
  (`poly-open-u-shape`: a U of 4 vertices fills the triangle of the first three).
- Styles 1 (outer) and 2 (ignore) with no loop flagged external (92 bit 1) plot **nothing** — no
  geometric nesting fallback (`nested-solid-zero-style1|2`, `nested-ansi31-zero-style1|2`);
  style 0 fills all loops even-odd.
- $FILLMODE = 0: no hatch is plotted at all, no outline — solid, gradient **and pattern**
  (`solid-fillmode-0` is an ANSI31 hatch and its reference is empty; triage 2026-10-01). A zero extrusion (210 = 0,0,0) hatch does not plot.
- MPOLYGON: accoreconsole does not load AcMPolygonObj26.dbx, the entities become proxies with
  empty graphics and plot nothing (`mpolygon-*`, DXFOUT writes 310 proxy data) — a harness
  limitation, not AutoCAD behaviour; the references cannot verify MPOLYGON rendering.

### 1.4 Seed points, pixel size, origin

- `98` + `10/20` seed points (OCS): pick points used by the flood/boundary-detection when the hatch
  was created. **They do not define the pattern origin** — ezdxf tested this in AutoCAD
  (ezdxf#768/discussion-769: setting seeds had no effect; changing the pattern line base points
  moves the pattern, screenshots). Multiple seeds are possible (ezdxf discussion-1047).
- dxf-viewer uses the seed point as pattern origin *only for its own named-pattern library*, and
  applies **no transform** to patterns embedded in the HATCH ("according to observation of AutoDesk
  viewer behavior", dxf-viewer:src/DxfScene.js ~L1280). CONFLICT-ish but consistent with "embedded
  lines are final".
- Hatch origin (HPORIGIN / "Set new origin"): baked into the 43/44 base points. In acs-sample the
  ANSI31 hatch has base point (2.7504, 0) == its seed point (2.7504, 0), while AR-PARQ1 has base 0,0
  and seed 0,0 — ASSUMPTION: AutoCAD sometimes derives the origin from the pick point. Irrelevant for
  rendering because the base points are stored.
- `47` pixel size: only for (re)computation, no rendering effect.

### 1.5 Hatch style (75) and island detection — how the fill is computed

Spec: 0 = "Hatch odd parity area (Normal)", 1 = "outermost area only (Outer)", 2 = "entire area
(Ignore)" (spec:L4331, oda:L10265).

AutoCAD stores the *result* of island detection in the path flags: external (1) for the outer
boundary, outermost (16) for loops directly inside it, default (0) for deeper loops, textbox (8)
for text extents. The renderer's job is to filter by style and then fill:

ezdxf `BoundaryPaths.rendering_paths(hatch_style)` (ezdxf:entities/boundary_paths.py:172):
- NESTED/normal (0): all paths.
- OUTERMOST (1): only paths with EXTERNAL or OUTERMOST flag.
- IGNORE (2): only EXTERNAL paths.
- Paths are yielded in the order EXTERNAL, OUTERMOST, DEFAULT (stable within class).
Then ezdxf fills all selected loops together (`draw_filled_paths`), i.e. **even-odd / odd-parity**;
text boxes are removed first (`ignore_text_boxes`, `filter_text_boxes=True`) — ezdxf#573 was about
text-box paths being rendered as filled areas.

**Caveat:** if *no* path has flag 1 (e.g. files written by other tools with 92=0 or 2 only), the
OUTER and IGNORE styles would select nothing. ezdxf would then draw nothing for styles 1/2.
dxf-viewer instead ignores flags and computes nesting depth geometrically
(dxf-viewer:src/HatchCalculator.js `GetSolidRegions`, L440ff): a loop with an even number of
containing loops is filled, odd = hole; THROUGH_ENTIRE_AREA (2): only loops with depth 0 are
filled; OUTERMOST: loops filtered to external+outermost before the odd-parity pass
(HatchCalculator.js L73ff). dxf-viewer pr-165 fixed "solid hatch with multiple disjoint loops"
(don't treat loop 0 as the contour and all others as holes).

Recommendation (ASSUMPTION until tested): 
1. Select loops by style using flags (ezdxf rule). If style ∈ {1,2} and no loop carries flag 1,
   fall back to geometric nesting depth (dxf-viewer rule).
2. Drop text-box loops (flag 8) for filling; they are only there to make the island detection cut
   holes around text — ASSUMPTION: AutoCAD *does* leave the text box area empty under style 0/1
   (that's what the textbox loop is for), so dropping it would *fill* under text. **UNKNOWN** —
   test H6. (ezdxf drops them; ezdxf#573.)
3. Fill with even-odd over the remaining loops. Self-intersecting loops (flag 64) → even-odd too
   (ASSUMPTION; AutoCAD usually refuses to create them).
4. The same region definition clips the pattern lines (§1.6).

Even-odd vs nonzero: all reference renderers use odd parity (ezdxf `_line_segments` toggles
`inside` at every intersection, ezdxf:render/hatching.py:573; dxf-viewer `_GenerateOddParitySegments`);
winding direction of loops is irrelevant in AutoCAD data (ezdxf docstring of `hatch_polygons`:
"the winding orientation (cw or ccw) of paths is not important"). Nonzero is never used.
Overlapping (not nested) separate loops in one hatch → with even-odd their intersection is a hole.
**UNKNOWN** whether AutoCAD does that (test H5).

### 1.6 Pattern fill

#### 1.6.1 Pattern definition lines (78 × {53, 43, 44, 45, 46, 79, 49…})

| Code | Meaning |
|---|---|
| 53 | line angle (deg), already includes 52 |
| 43/44 | base point (x,y) OCS, already scaled/rotated and including the hatch origin |
| 45/46 | offset vector between adjacent parallel lines, **in OCS (already rotated by the line angle and 52)** |
| 79 | number of dash items (0 = continuous line) |
| 49 | dash items: >0 dash, <0 gap, 0 = dot |

oda:L10275 has a typo "45/56". ezdxf: "The hatch pattern parameters are already scaled and rotated
for direct usage! The stored scale and angle is just for reconstructing the base pattern"
(ezdxf:render/hatching.py `pattern_baselines`, and properties.py `resolve_filling` comment "DXF
stores the hatch pattern already rotated and scaled, pattern_scale and pattern_rotation are just
hints for the CAD application"). Evidence in acs-sample: ANSI31 (`45, 0,0, 0,.125` in acad.pat) is
stored as `53=45, 45=-0.0884, 46=0.0884` — the .pat offset (0, .125) rotated by 45°; custom
patterns at `41=0.1` have offsets like `46=2.39999995` (float noise from scale+rotate).

**.pat offset vs DXF offset:** in a .pat file `dx,dy` are given in the *line's own coordinate
system* (dx along the line = dash phase shift between successive lines, dy perpendicular = spacing);
in DXF the vector is rotated into OCS (ezdxf `PatternFileCompiler.compile_pattern`: "rotate offset:
offset = offset.rotate_deg(angle)", ezdxf:tools/pattern.py). dxf-viewer handles both
(`offsetInLineSpace`, dxf-viewer:src/DxfScene.js `_DecomposeHatchPatternLine`).

Transformations of the pattern (e.g. hatch inside a scaled INSERT) must transform base points with
the full affine map and offset/dashes with the linear part — ezdxf had bugs exactly there
(ezdxf#1392, #1399, #1402: pattern phase drifted because base points were not translated).

**77 double / 76=0 user-defined:** User-defined patterns are a single line family (angle 52,
spacing 41) and with 77=1 a second family at +90°. **ASSUMPTION:** AutoCAD writes both families as
pattern lines (78=2), so the renderer ignores 77. ezdxf's drawing add-on multiplies the scale by 2
for 77=1 with "todo: is this correct?" (ezdxf:addons/drawing/properties.py:921) — that is almost
certainly wrong for rendering and irrelevant if the stored lines are used. Test H9.

#### 1.6.2 Line family generation & clipping (ezdxf algorithm, ezdxf:render/hatching.py)

For each pattern line: origin `O = base_point`, direction `d = (cos a, sin a)`, offset `v`.
Line k of the family: `O + k·v + t·d`. Normal spacing `n = det(−v, d − v)` (= perpendicular
component of v); raise `DenseHatchingLinesError` if `|n| < 1e-4` drawing units
(`MIN_HATCH_LINE_DISTANCE`, ezdxf:render/hatching.py:34; configurable, ezdxf#929; the drawing
add-on then falls back to a **solid fill**, frontend.py:612).

1. Compute the signed normal distance of every boundary vertex / Bézier control point to the base
   line; the range of k is `ceil(min/n) … ceil(max/n)-1` (`hatch_line_distances`, :339).
2. Intersect each hatch line with all boundary segments (lines exactly; curves as cubic Béziers —
   `intersect_path` does real ray/Bézier intersection, no flattening). Intersections are bucketed by
   `round(distance, 4)`.
3. Sort the intersections along the line and emit segments between intersection pairs using the
   odd-parity toggle (`_line_segments`). Collinear/touching cases are simply skipped, which causes
   artefacts at vertices; ezdxf therefore **jiggles** the origin of all pattern lines by a random
   `(0.0003…0.001)·mean(|offset|)` (`_jiggle_factor`, :655; `jiggle_origin=True` in the drawing
   add-on). truedxf should not use randomness (pixel-exact determinism): handle vertex
   intersections properly (count a vertex once if the two adjacent edges are on opposite sides of
   the hatch line, twice/zero times if on the same side).
   **Boundary edges collinear with a hatch line: AutoCAD draws no pattern line along them**, on
   either side of the region (the bottom and the top edge of a box alike). VERIFIED-BY-ACAD
   2026-10-01 (`hatches/collinear-ansi31-diamond`, `collinear-user-edges` exact after the fix).
   truedxf keeps its half-open crossing rule (a vertex on the line counts as below it) and cuts
   the t-range of every edge lying on the line (within 1e-9 of the coordinate magnitude) out of
   the inside intervals (geometry/src/hatch.ts).
4. Apply the dash pattern to each inside segment (`PatternRenderer.render`): the dash sequence is
   anchored at the line's origin `O + k·v` (so successive lines are shifted by the along-line
   component of v, which is how brick patterns work); for a segment [s,e] compute
   `divmod(dot(d, s − origin), pattern_length)` and walk the dashes. If the segment runs opposite
   to d it is swapped. Pattern length = Σ|items|.
   dxf-viewer does the same (`_DecomposeHatchLine`: `minSegIdx = floor((xStart − xBase)/len)`).
5. Dots (0-length items) are emitted as zero-length segments (start is end). dxf-viewer emits
   POINTS. **ASSUMPTION:** AutoCAD plots a dot as a point of the current lineweight (round
   cap), 1 device pixel at lineweight 0. Test H10.

Differences between reference renderers: none implement "partial dashes are clipped exactly at
the boundary" differently — all clip dashes at the boundary (a dash crossing the boundary is cut).
**ASSUMPTION:** AutoCAD does the same (it is what hatch patterns look like).

#### 1.6.3 Too dense patterns

- AutoCAD system variable **HPMAXLINES** (AutoCAD 2008+, "a whole number between 0 and 10000000"),
  earlier the registry/env variable `MaxHatch` (web: resources.imaginit.com "AutoCAD: Certain
  Hatches do not Plot, Preview, Display properly"; search summary of landfx.com KB 2037 "Hatches are
  Displaying as Solid Rather Than as Patterns": "When the calculated hatch pattern is too dense to
  display, hatches appear as solid colors"). Documented default 1,000,000; PLOT's limit is
  100,000 lines (below).
- At creation time AutoCAD may refuse: "hatch scale is too small or its dash length too short".
- ~~Existing too-dense hatches are displayed and plotted as solid fill~~ (KB articles; on-screen
  display at best). **PLOT draws nothing** for a too-dense pattern hatch — no lines, no solid
  fill. **VERIFIED-BY-ACAD 2026-10-01**: hatches/dense-count-30000 … 300000 (ANSI31 scale 0.03,
  445k … 4.45M lines) plot empty, dense-scale-0p001 (44.5k lines) plots; local probes
  `hatch-probes/dense-lines-*` (ANSI31, square side varied) plot at 99,995 lines and are empty at
  100,001, 100,003, 100,010, …, 300k lines; `dense-ansi37-*` (two families) plot at 2 × 45k and
  are empty at 2 × 55k, so the limit applies to the **total** over all definition lines;
  `dense-thin-*` (a 40-unit strip with 150k / 300k lines, small area) is empty too, so it is the
  **line count**, not area or segment count. Implemented criterion: Σ over the definition lines
  of the family lines crossing the boundary's extent (k-range from the vertices' normal
  coordinates) > **100,000** → nothing (`DEFAULT_HATCH_MAX_LINES`, geometry/src/hatch.ts).
  Whether this is HPMAXLINES with a different default or a separate PLOT limit is open. The load
  log of every probe (also those that plot) says "Drawing contains large dense hatch patterns
  that can cause instability". The boundary still counts for the extents (note 03 §6.2).
- ezdxf: 1e-4 absolute spacing threshold + 30 s timeout (config `hatching_timeout`).
- dxf-viewer: `MAX_HATCH_LINES = 20000` per line family and `MAX_HATCH_SEGMENTS = 20000` dash
  repetitions per line → drops the family (dxf-viewer:src/DxfScene.js:30–34). Not AutoCAD-like.

### 1.7 Gradient hatch (450–470)

AutoCAD-written example (acs-sample HATCH 3, LINEAR, blue→yellow):

```
70=1 … 450=1 451=0 460=0.0 461=0.0 452=0 462=0.0 453=2
463=0.0 63=5 421=255   463=1.0 63=2 421=16776960   470=LINEAR
```

- Names (470): `LINEAR, CYLINDER, INVCYLINDER, SPHERICAL, INVSPHERICAL, HEMISPHERICAL,
  INVHEMISPHERICAL, CURVED, INVCURVED` (ezdxf:entities/gradient.py; netDxf
  `HatchGradientPatternType.cs`). In ezdxf's enum 0 = NONE, in netDxf 0 = LINEAR (int values
  differ between libraries — only the name is in the DXF).
- 460 rotation is **radians** (spec L4410; ezdxf converts to degrees internally).
- 461 shift: 0 = unshifted ("Centered" checked), 1 = shifted: "If this option is not selected, the
  gradient fill is shifted up and to the left, creating the illusion of a light source to the left"
  (ezdxf docs/source/dxfentities/hatch.rst ~L553). AutoCAD writes 461=0.0 by default (acs-sample).
- 452=1 single-color: the second color is derived from color1 and 462 tint. Formulas in libraries:
  - netDxf: `color2 = HSL(h1, s1, L = tint)` (netDxf:Entities/HatchGradientPattern.cs `Color2FromTint`).
  - mlightcad three-renderer: `lerp(color1, tint<0 ? black : white, |tint| || 0.5)`
    (mlightcad-cad-viewer:packages/three-renderer/src/style/AcTrGradientHatchShaders.ts
    `getOneColorGradientEndColor`); its PDF renderer uses `c + (255−c)·t` for t ≥ 0
    (…/pdf-renderer/src/hatch/AcPdfGradient.ts `oneColorEnd`).
  - ezdxf drawing add-on: gray `(t·255, t·255, t·255)` (properties.py:907) — certainly wrong.
  - ezdxf docs: "tint (color1 mixed with white)".
  **CONFLICT** → **ASSUMPTION:** AutoCAD writes the *computed* second color into the second 421
  (453=2 always), so the renderer should just use both stored 421 values and never compute the
  tint. Test G2.
- 63 (ACI) is optional, 421 is authoritative (ezdxf comment "code 63 could be left off").
- Interpolation geometry: **UNKNOWN for AutoCAD.** No library reproduces AutoCAD; mlightcad's
  shader is a plausible approximation: in a frame rotated by −angle and normalized to the hatch
  bbox (≈[−1,1]²), with `x' = x − shift`:
  `linear = sat(x'/2 + 1/2)`, `cylinder = sat(1 − |x'|)`, `spherical = 1 − sat(|p'|)`,
  `hemispherical = sat(1 − |p' − (0,−1)|/2)`, `curved = smoothstep(linear)`, INV* = 1 − f;
  `color = mix(c1, c2, f)` in sRGB (AcTrGradientHatchShaders.ts `getGradientFactor`). Also unknown:
  whether AutoCAD interpolates in RGB or another space, whether bounds are the hatch extents in
  OCS or rotated extents, and the plot's gradient banding/dithering. Gradients are a low-priority
  area; test matrix G1.
- Gradient hatch is "also a solid filled hatch" (ezdxf docstring); requires R2004+.
- Colors used for plotting still go through the CTB? **UNKNOWN** (true colors bypass CTB colors in
  most cases; §6).

#### 1.7.1 Gradients in AutoCAD 2027 PLOT (VERIFIED-BY-ACAD 2026-09-30, partly empirical)

Cases `hatches/gradient-*` (160×80 and 180×45 rectangles); implementation
`packages/render/src/draw/gradient.ts` (F1(r=1) ≈ 0.84 over 54 cases, not pixel exact):
- Colours are interpolated per channel in **sRGB** (red→green midpoint 127/128/0,
  `gradient-colorspace-*`); one-colour gradients use the **stored** second 421 colour, the tint
  is not recomputed (`gradient-onecolor-conflict` plots blue→red).
- LINEAR: f = t across the extent of the region **projected on the gradient direction**
  (45° on 160×80: span 169.7 = (160+80)·cos 45°). CYLINDER: f = sin(πt). SPHERICAL:
  f = cos(π/2·min(1, d/R)), R = half the larger box side, centre = box centre. INV* = 1 − f.
- 461 is effectively boolean (0.5 plots like 1). Shifted SPHERICAL moves the centre by
  (−R/2, +R/2) — exact to one level; shifted 1D types put the middle at t ≈ 0.3125 and stretch
  the rest to ≈ 0.703 (empirical).
- HEMISPHERICAL (and INV…) = radial cos law f = cos(π/2·min(1, d/R)) with **S = max(extent of
  the region along the rotated x axis, unrotated (target-aligned) height H₀)**, R = S, centre
  at (0, −S/2) from the box centre in the frame rotated by 460; shifted (461 ≠ 0) moves the
  centre by −S/2 along the rotated x axis only (not up, unlike SPHERICAL). VERIFIED-BY-ACAD
  2026-10-01, empirical fit: mean |Δ| ≤ 3.7 levels on `hatches/gradient-{inv,}hemispherical-
  shift{0,1}-a{0,45}` (160 × 80) and local probes `hatch-probes/hemi-{tall,wide,square}-
  shift{0,1}-a{0,30}` (60 × 110, 180 × 40, 100 × 100). The rotated-box variant (S = max of both
  rotated extents) fails the tall box at 30° (S fits 108–115, not 125); S from the unrotated box
  alone fails the square at 30° (fits 134–136 = the rotated width). The mixed rule is odd, but
  it is what the 20 cases support. Before (centre from the rotated box, shift (−R/2, +R/2)) the
  shift0-a45 and shift1-a0 cases were wrong-colour gross failures (F1 ≈ 0).
- CURVED ≈ sin(π/2·(w − 0.1125 q²)) with w = 0 at the top edge (empirical fit, shifted variants
  not modelled).
- AutoCAD Gouraud-shades its own triangle mesh with an ordered dither (iso-lines step by 1 px
  every 40 rows in a 160-row cycle), so pixel exactness is out of reach; rotated gradients at 30°
  fit a plane at 33–35° (mesh artefact), 45° is exact.

### 1.8 Elevation, OCS, extrusion

All boundary and pattern coordinates are 2D in the hatch OCS (210); the Z of code 10 is the
elevation. Transform to WCS with the arbitrary-axis algorithm. Mirroring flips the extrusion to
(0,0,−1): arc angles stay CCW around the (new) extrusion (ezdxf `ArcEdge.transform` comment).
Hatches with non-(0,0,1) extrusion appear mirrored in plan view — standard OCS handling
(see the geometry note). Non-uniform scaling of arcs: convert arcs → ellipse edges, bulge
polylines → edge paths first (ezdxf `BoundaryPaths.transform`).

### 1.9 Hatch boundary is not drawn; lineweight/linetype on hatches

- A HATCH entity renders only its fill (solid/gradient/pattern). Boundary outlines seen in drawings
  are separate entities. ezdxf draws nothing for the boundary (frontend.py `draw_hatch_entity`),
  dxf-viewer pr-173 "prevent solid hatch outlines from filling room interiors".
- "TrueType fonts, raster images, points, and solid fills (2D solids) cannot display lineweight"
  (**DOC**, Autodesk help "Control Lineweights", via web search). ASSUMPTION: solid/gradient hatch
  fills get no lineweight outline in plots → the filled area is exactly the boundary (anti-aliasing
  aside). Pattern lines do get the entity lineweight.
- LibreCAD issue 257 ("printing: hatches are connected with lines") — a LibreCAD bug, not AutoCAD.

### 1.10 Pattern background color (XDATA)

`1001 HATCHBACKGROUNDCOLOR`, `1071 <raw color>` where raw color = `0xC2000000 | 0xRRGGBB` (true
color, as signed 32-bit int) or presumably `0xC3000000 | aci`, `0xC1…` BYBLOCK, `0xC0…` BYLAYER
(ezdxf:entities/polygon.py:177 `bgcolor`, "it's magic" = `rgb | -0b1111100…` = 0xC2 flag;
raw color decoding ezdxf:colors.py:151 `decode_raw_color`). Draw as solid fill under the pattern
(ASSUMPTION). Also applies transparency? UNKNOWN.

### 1.11 Hatch transparency and draw order

- 440 on the hatch applies to fill and pattern lines (ACadSharp issue 398 was about writing it to
  DWG). Transparency plotting §4.
- "Send hatches to back" / HPDRAWORDER only act at creation by writing SORTENTS entries (§8).
  There is no hatch-specific draw order at render time. LibreCAD #1790 / mlightcad pr-228 show that
  non-AutoCAD renderers often break hatch-vs-outline order; truedxf simply follows §8.

### 1.12 MPOLYGON differences

(ezdxf:entities/mpolygon.py; ezdxf discussion-411 with AutoCAD Map sample files; spec lists the
MPOLYGON codes inside the HATCH table.)

- Subclass `AcDbMPolygon`; not a core entity, needs a CLASS.
- `70` = version (1), `71` = solid-fill flag (HATCH's 70 meaning), `63` = fill color ACI
  (R2004+ only; "solid fill color for R2000 is BYLAYER"), true-color fill stored as a *gradient*
  with two equal colors (ezdxf `set_solid_rgb_gradient`); gradient block always written for R2004+
  (`Gradient(kind=0,num=0)` when none).
- Hatch style 75: "TrueView does not accept this tag in any place! BricsCAD supports this tag!"
  → MPOLYGON renders **all** paths (ezdxf frontend `draw_mpolygon_entity` "MPOLYGON does not support
  hatch styles, all paths are rendered"). Fill rule even-odd.
- Polyline path tag order 73 before 72; no 97/330 source objects.
- `73` boundary annotation flag, `11` offset vector, `99` number of degenerate loops.
  The **offset vector translates the stored paths**: AutoCAD Map writes some polygons around
  (0, 0) with their position in 11 (corpus ezdxf discussion-411 `mpolygons_*.dxf`: 23 entities
  with 11 = 0 and vertices near (−85.28, 35.05), two with vertices within ±0.001 of the origin
  and 11 = (−85.28, 35.048)); ezdxf applies it to all paths too. truedxf translates the OCS
  plane by it (paths and, ASSUMPTION, pattern lines; only 210 = 0,0,1 seen). Not verifiable with
  accoreconsole (§1.3.5).
- `78` must be present (0) even with no pattern.
- **Boundary is drawn** as lines in the entity color/linetype/lineweight; the fill uses 63
  (or the gradient color 1). Pattern lines use the entity color (ezdxf `draw_mpolygon_entity`).
- ezdxf does not export MPOLYGON with edge paths.

### 1.13 .pat file format

(ezdxf:tools/pattern.py `PatternFileCompiler`; Autodesk help "About Custom Hatch Patterns and Hatch
Pattern Definitions" (web); netDxf/TestDxfDocument/Support/acad(iso).pat.)

```
; comment (";;" commonly)
*NAME, optional description
angle, x-origin, y-origin, delta-x, delta-y [, dash1, dash2, ...]
...
```

- One header line `*NAME[,description]` then one line per pattern line family. Only the first
  comma splits the header (ezdxf `_tokenize_pattern_line`: `maxsplit=1`).
- `angle` in degrees; origin in pattern units; `delta-x` = shift along the line between successive
  lines, `delta-y` = perpendicular spacing (line coordinate system); dashes >0 pen down, <0 pen up,
  0 dot. Up to 6 dashes per line traditionally; line length ≤ 80 chars (classic limit, ASSUMPTION
  for modern AutoCAD). Floats may lack a leading zero (`.125`; ezdxf pr-1350 fixed parsing).
- Files: `acad.pat` (imperial) and `acadiso.pat` (metric, ×25.4, ANSI31 spacing 3.175) selected by
  `$MEASUREMENT` (0 English → acad.pat, 1 metric → acadiso.pat) (spec:L1277; ezdxf
  `Hatch.set_pattern_fill` "scaled according to … $MEASUREMENT … replicates BricsCAD").
  `SOLID` is a pseudo-pattern (`*SOLID` has a dummy 45° line in acad.pat). ISO pen-width patterns
  `ACAD_ISO02W100…ACAD_ISO15W100` exist as hatch patterns too (single horizontal family, spacing 5).
- Custom .pat files (76=2): one pattern per file, file name = pattern name (qcad/patterns/metric/*.pat).
  AutoCAD substitutes ANSI31 when it cannot find a custom pattern *when regenerating*
  (ezdxf#1036 — but DXF-stored lines should still render; the report is about AutoCAD re-evaluating
  scripted hatches). dxf-viewer also falls back to ANSI31 when a name is not found and no lines are
  embedded (DxfScene.js).
- QCAD embeds a single 45° line as placeholder in every hatch it exports (dxf-viewer comment,
  DxfScene.js ~L1252) — files from QCAD carry wrong embedded pattern data. We render embedded
  data anyway (ASSUMPTION: that is what AutoCAD does too).
- Predefined names (ezdxf ISO_PATTERN keys, 172 entries, ezdxf:tools/_iso_pattern.py): ANSI31–38,
  AR-B816, AR-B816C, AR-B88, AR-BRELM, AR-BRSTD, AR-CONC, AR-HBONE, AR-PARQ1, AR-RROOF, AR-RSHKE,
  AR-SAND, ANGLE, BOX, BRASS, BRICK, BRSTONE, CLAY, CORK, CROSS, DASH, DOLMIT, DOTS, EARTH, ESCHER,
  FLEX, GOST_GLASS, GOST_GROUND, GOST_WOOD, GRASS, GRATE, GRAVEL, HEX, HONEY, HOUND, INSUL,
  ISO02W100…ISO15W100, ACAD_ISO02W100…ACAD_ISO15W100, JIS_LC_*, JIS_RC_*, JIS_STN_1E, JIS_WOOD, LINE,
  MUDST, NET, NET3, PLAST, PLASTI, SACNCR, SQUARE, STARS, STEEL, SWAMP, TRANS, TRIANG, ZIGZAG,
  SOLID, plus non-AutoCAD extras (BRICK_*, CONC_*, HERRING_*, V_* …).
- Pattern values differ between sources: e.g. hatch `ACAD_ISO04W100` dash `24,-3,.5,-3` in
  acadiso.pat/QCAD/ezdxf vs. the *linetype* `ACAD_ISO04W100` `24,-3,0,-3` in acadiso.lin.

#### Licensing of pattern (and linetype) definition sets

| Set | Location | License / provenance | Usable in truedxf? |
|---|---|---|---|
| Autodesk acad.pat / acadiso.pat / acad.lin / acadiso.lin | `repos/netDxf/TestDxfDocument/Support/` | "Copyright 2017 Autodesk, Inc. All rights reserved … subject to the terms of the Autodesk license agreement" (file headers) | **No** (don't copy; tests may read them from a local AutoCAD install) |
| ezdxf ISO_PATTERN | `repos/ezdxf/src/ezdxf/tools/_iso_pattern.py` | MIT (ezdxf), header: "Collected, extracted and scaled from various DXF files" — provenance is AutoCAD-derived data | Legally MIT, ethically "facts extracted from DXF files". Best available option if we ship pattern definitions. |
| ezdxf standard linetypes | `ezdxf:tools/standards.py` | MIT; values differ from acad.lin for 13 of 16 names (ezdxf#1411) | only with corrected values |
| QCAD patterns & linetypes | `repos/qcad/patterns/{imperial,metric}/*.pat`, `repos/qcad/linetypes/*.lin` | no separate license file → QCAD's GPLv3 (+exceptions) (`repos/qcad/LICENSE.txt`) | **No** (GPL) |
| dxf-viewer patterns | `repos/dxf-viewer/src/patterns/{metric,imperial}/*.js` | MPL-2.0 repo, but "Patterns here mostly from QCAD project" (`src/patterns/index.js`) → GPL provenance | **No** |
| LibreCAD patterns | `repos/LibreCAD/librecad/support/patterns/*.dxf` (64 files, DXF-encoded) | GPLv2 (`repos/LibreCAD/licenses/readme.md`) | **No** |

Numeric pattern definitions are arguably non-copyrightable facts, but the safe route is: render
from embedded DXF data (needs no pattern file); for *authoring* ship either ezdxf's MIT table or
let users point to their own .pat. Note for legal review.

---

## 2. Linetypes

### 2.1 LTYPE table entry

(spec:L2296–2357, oda:L8554ff, ezdxf:entities/ltype.py, ezdxf docs dxfinternals/tables/linetype_table.rst)

| Code | Meaning |
|---|---|
| 2 | name (`CONTINUOUS`, `BYLAYER`, `BYBLOCK` always exist) |
| 70 | standard flags (16 xref-dependent, 32 resolved, 64 referenced) |
| 3 | description (ASCII art, informational) |
| 72 | alignment, always 65 ('A') |
| 73 | number of elements (0 for CONTINUOUS) |
| 40 | total pattern length (should equal Σ\|49\|) |
| 49 | element length: >0 dash, <0 gap, 0 dot — one per element |
| 74 | element type flags (one per element, after its 49; 0 = simple) |
| 75 | shape number (if shape) / 0 (if text) |
| 340 | STYLE handle (shape file style or text style) |
| 46 | scale (S=) |
| 50 | rotation (R=/A=/U=) |
| 44 | x offset (X=) along the line |
| 45 | y offset (Y=) perpendicular |
| 9 | text string (if text) |

In DWG the text strings live in a 256 (R2004−) / 512 (R2007+) byte "strings area" indexed by 75
(oda:L8600ff). ezdxf's `compile_line_pattern` (ezdxf:entities/ltype.py:124): merges consecutive
elements of equal sign, appends a gap if 40 > Σ|49|, rotates a leading gap to the end — handy
normalization, but **don't** rotate a leading gap for AutoCAD fidelity unless proven (A-type rules
require the first element to be a dash ≥ 0 anyway, see §2.4). ezdxf#1310: ezdxf lost the first
49 when a pattern was passed wrongly — a reminder that 40 is the first number in ezdxf's list form.

### 2.2 Complex element flags (74) and rotation units

| Bit | spec (DXF) | ODA (DWG) | ACadSharp `LinetypeShapeFlags` | netDxf reader | acs-sample |
|---|---|---|---|---|---|
| 1 | 50 is absolute rotation (else relative) | "text is rotated 0 degrees, otherwise it follows the segment" | RotationIsAbsolute | `(type&1)` → Absolute | — |
| 2 | element is text | "complexshapecode holds the index of the shape" | Text | text | GAS_LINE text element has 74=10 |
| 4 | element is shape | "index into the text area" | Shape | shape | ZIGZAG shapes have 74=4 |
| 8 | (not documented) | — | — | (netDxf: "upright and relative considered equivalent") | 74=10 for `U=0.0` text → **bit 8 = upright** |

**CONFLICT:** ODA swaps the meaning of 2 and 4 relative to the DXF reference. DXF files (ezdxf
writes text 74=2 / shape 74=4 and AutoCAD accepts them; acs-sample shape 74=4, text 74=2|8) follow
the DXF reference. mlightcad also has code to "detect swapped" LibreDWG output
(mlightcad-cad-viewer:packages/three-renderer/src/linetype/AcTrLineTypeWalker.ts L63ff).

**Rotation units — CONFLICT:** spec says 50 is "rotation value in radians" (spec:L2351);
acs-sample (AutoCAD-written, AC1032) stores ZIGZAG `r=180` as `50=180.0` → **degrees**.
ezdxf writes the .lin value unchanged (degrees) (ezdxf:tools/complex_ltype.py `CMD_CODES`).
Treat 50 as degrees (VERIFIED-BY-ACAD-file, acs-sample:L2310); keep a test (L7).

Rotation modes: `R=` relative to the line direction (default), `A=` absolute (bit 1),
`U=` upright = relative but flipped by 180° when the text would read upside down (bit 8)
(mlightcad `placementAngle` "Keeps relative linetype text readable (AutoCAD U-rotation behaviour):
flip 180° when the tangent would draw the label upside-down"). The exact flip threshold (90°/270°
inclusive?) is UNKNOWN.

### 2.3 Complex element placement (text / shape)

A complex element is attached to the 49 element that precedes the `[...]` in the .lin definition
(it *is* that element's record in DXF). Evidence-based rule (ASSUMPTION, consistent with all
standard definitions):

- The shape/text **origin is at the end of the element it is attached to** (running distance after
  that element), shifted by X (44) along and Y (45) perpendicular to the line (in the rotated frame
  of the element), scaled by the linetype scale.
  - `GAS_LINE  A,.5,-.2,["GAS",STANDARD,S=.1,U=0.0,X=-0.1,Y=-.05],-.25`: text at 0.7−0.1 = 0.6,
    text height 0.1 (S), baseline 0.05 below the line (Y=−.05 = half the height → vertically
    centered). The gap around it is 0.5…0.95; text ≈0.6…0.8 → centered. With "start of element"
    semantics the text would overlap the dash → rejected.
  - `ZIGZAG A,.0001,-.2,[ZIG,…,x=-.2,s=.2],-.4,[ZIG,…,r=180,x=.2,s=.2],-.2` works out the same way.
- S (46): for text = text height if the style has height 0 (ASSUMPTION: S × style height
  otherwise); for shapes = shape scale.
- Text uses the referenced STYLE (340) font; insertion at the text *baseline-left* (AutoCAD text
  default) — mlightcad instead centers text in the pen-up slot and ignores X/Y for text
  (AcTrLineTypeWalker.ts L375ff comments) — an approximation, not AutoCAD.
- Shapes need the .shx shape file (STYLE with flag 1, e.g. `ltypeshp.shx`, shape numbers e.g.
  ZIG=131 in acs-sample). Without the file: UNKNOWN what AutoCAD plots (probably nothing).
- If a segment is shorter than one period (§2.6) → continuous line, no texts/shapes
  (mlightcad pr-668 "Match AutoCAD when a polyline segment is shorter than one linetype pattern
  cycle: draw a continuous stroke and skip partial dashes / TEXT / SHAPE placements").

#### 2.3.1 Complex elements in AutoCAD 2027 PLOT (VERIFIED-BY-ACAD, 2026-09-30)

Cases `linetypes/ctext-*`, `fit-gasline`, `fit-hotwatersupply`, `pl-gasline-*`,
`acad-default-fonts/ltype-*` (ltypeshp.shx FENCELINE1/2, TRACKS, ZIGZAG, BATTING); implementation
`packages/render/src/draw/complex-linetype.ts` + dash.ts placements:
- 74 bit 2 = text, bit 4 = shape, bit 1 = absolute, bit 8 = upright (DXF reference meaning, not
  ODA's); 50 is **degrees** (`ctext-rot-units-*`: 50 = 1.5708 is 1.57°).
- Origin = end of the carrying element (on the fitted pattern, so it moves with the A-type head
  h), then X along and Y across the line (left normal), both × linetype scale; R= rotates about
  that point relative to the line, A= absolute. On arcs the anchor lies on the true arc; AutoCAD
  rotates by the direction of its own tessellation chord (≈ 2.3° chords for r = 400 px), which we
  approximate by the true tangent (≤ 1° error).
- **Shapes**: one shape unit = S × linetype scale, from the STYLE (340, flag 1) shape file; S < 0
  mirrors through the origin; S = 0 collapses the shape along the line and keeps 1 drawing unit
  across it (`ltype-fenceline2-scale-zero|negative`); a missing .shx draws nothing
  (`ctext-missing-shx`). A pattern without gaps (TRACKS: dashes + shapes) is not continuous.
- **Text** (VERIFIED-BY-ACAD 2026-10-01, references regenerated with the Liberation fonts visible
  to AutoCAD): linetype text uses the STYLE's font like TEXT, **TrueType included** (filled
  LiberationSans glyphs in `ctext-*`, `fit-gasline`, `pl-gasline-*`,
  `fileformat/ltype-text-gas-line-*`, `corpus-gdal-linetypes`); FONTALT only stands in for a
  missing font file. Height = |S| × the STYLE's fixed height when that is set, else |S|
  (`ctext-height-*`). With a TrueType font, S < 0 draws exactly like |S| (no turn,
  `ctext-scale-neg`) and S = 0 draws **no text** at all (`ctext-scale-zero`; the dashes stay).
- **Upright (U=)**: the flip is decided by the **line direction alone** (not direction + rotation)
  and only when it points left (cos < 0; exactly vertical up or down never flips;
  `ctext-orient-u-*`), and in the entity's **own block coordinates**: texts of a mirrored or
  rotated (180°, 150°) INSERT are drawn upside down, unflipped (`ctext-insert-mirror`,
  `ctext-insert-rotate`). TrueType text turns — by the U angle and, when upside down, by 180° —
  about the centre of the **font cell box** of the unturned text (pen start … advance end ×
  baseline − descender … baseline + ascender, note 04 §13), so it stays in its own slot on lines
  and circles (VERIFIED-BY-ACAD 2026-10-01: `ctext-orient-u-0-0|30-0|357-8`,
  `ctext-hotwatersupply-shapes`; the glyph ink box misses `ctext-hotwatersupply-shapes`); R= turns
  about the insertion point (`ctext-orient-r-*`).
- *Superseded (simplex era, before 2026-10-01)*: the references of 2026-09-30 were plotted while
  AutoCAD could not see the Liberation fonts, so every TTF style was drawn with FONTALT
  (simplex.shx). From them we had concluded "linetype text cannot use TrueType", "S = 0 → height
  1 × linetype scale", "S < 0 → text turned by 180° about its insertion", "a flipped U= element
  turns about the middle of the gap" and "U=30 turns about the centre of the glyph ink box". These
  hold for SHX text only (what AutoCAD did with simplex substituted) and are kept for SHX fonts in
  `complex-linetype.ts` / dash.ts; whether a genuine SHX STYLE behaves the same is unverified.
- Short units (L < P) are continuous without elements, like simple linetypes.

### 2.4 .lin file format

(Autodesk help "About Simple Custom Linetypes", 2018 LT: fetched text; ezdxf:tools/complex_ltype.py.)

```
*NAME,description
A,dash1,dash2,...
```

- "you can enter up to 12 dash-length specifications per linetype, provided they fit on one
  80-character line in the LIN file" (**DOC**). Long definitions may continue… (not needed).
- Alignment field "A" is the only supported alignment. "The first descriptor must be 0 or greater
  (a pen-down segment), the second should be less than 0 … you must have at least two dash
  specifications for A-type alignment" (**DOC**).
- Complex: `[shapename,shxfile,params]` or `["text",stylename,params]`, params `S=scale`,
  `R=rel.rotation`, `A=abs.rotation`, `U=upright rotation`, `X=`, `Y=` (all in drawing units ×
  linetype scale; rotations in degrees, suffix `r`/`g` for radians/grads allowed in .lin, ASSUMPTION).
  ezdxf's compiler requires the shape *index* (it cannot read .shx names).
- acad.lin (imperial) vs acadiso.lin (×25.4 for the classic ones; ISO ones are defined in mm).
  Selected via $MEASUREMENT when loading.

Standard definitions (facts from the Autodesk files in `repos/netDxf/TestDxfDocument/Support/`;
values quoted for reference, do not copy the files):

| Name | acad.lin (inch) | acadiso.lin (mm) |
|---|---|---|
| BORDER | .5,-.25,.5,-.25,0,-.25 | 12.7,-6.35,12.7,-6.35,0,-6.35 |
| CENTER | 1.25,-.25,.25,-.25 | 31.75,-6.35,6.35,-6.35 |
| DASHDOT | .5,-.25,0,-.25 | 12.7,-6.35,0,-6.35 |
| DASHED | .5,-.25 | 12.7,-6.35 |
| DIVIDE | .5,-.25,0,-.25,0,-.25 | 12.7,-6.35,0,-6.35,0,-6.35 |
| DOT | 0,-.25 | 0,-6.35 |
| HIDDEN | .25,-.125 | 6.35,-3.175 |
| PHANTOM | 1.25,-.25,.25,-.25,.25,-.25 | 31.75,-6.35,6.35,-6.35,6.35,-6.35 |
| xxx2 / xxxX2 | ×0.5 / ×2 of the above | |
| ACAD_ISO02W100 | — | 12,-3 |
| ACAD_ISO03W100 | — | 12,-18 |
| ACAD_ISO04W100 | — | 24,-3,0,-3 |
| ACAD_ISO05W100 | — | 24,-3,0,-3,0,-3 |
| ACAD_ISO06W100 | — | 24,-3,0,-3,0,-3,0,-3 |
| ACAD_ISO07W100 | — | 0,-3 |
| ACAD_ISO08W100 | — | 24,-3,6,-3 |
| ACAD_ISO09W100 | — | 24,-3,6,-3,6,-3 |
| ACAD_ISO10W100 | — | 12,-3,0,-3 |
| ACAD_ISO11W100 | — | 12,-3,12,-3,0,-3 |
| ACAD_ISO12W100 | — | 12,-3,0,-3,0,-3 |
| ACAD_ISO13W100 | — | 12,-3,12,-3,0,-3,0,-3 |
| ACAD_ISO14W100 | — | 12,-3,0,-3,0,-3,0,-3 |
| ACAD_ISO15W100 | — | 12,-3,12,-3,0,-3,0,-3,0,-3 |
| FENCELINE1/2, TRACKS, BATTING, HOT_WATER_SUPPLY, GAS_LINE, ZIGZAG, HW_GAS_LINE | complex (ltypeshp.shx / STANDARD) | |
| JIS_08_*, JIS_02_*, JIS_09_* | — | e.g. JIS_02_1.0 `1,-1` |

ezdxf#1411 (2026): measured 120 real AutoCAD drawings — ezdxf's `standards.linetypes()` differs from
what AutoCAD drawings carry for DASHED (`.5,-.1` vs real `.5,-.25`), DASHDOT, DIVIDE, DOT, CENTER2,
CENTERX2 … (13 of 16). The real-drawing values match acad.lin above. Mozman: "there is no absolute
correct definition". **Rendering always uses the LTYPE table of the file**; this only matters when
we author files.

The "W100" suffix means pen width 1.00 mm; AutoCAD's ISO linetypes are meant to be scaled with the
pen width (ISO 128) — ASSUMPTION: AutoCAD does *not* adjust anything automatically; the user sets
the linetype scale. No "adjustment for ISO linetypes" found in any source (UNKNOWN).

### 2.5 Scaling chain

Effective pattern scale for an entity:

```
s = LTSCALE (header $LTSCALE, default 1)
  × entity 48 (linetype scale, default 1.0; set from $CELTSCALE at creation time only)
  × [paper-space viewport factor]         (PSLTSCALE, see below)
  × [annotation scale factor]             (MSLTSCALE in model space, see below)
  × [block insert scale]                  (ASSUMPTION, see below)
```

- `$CELTSCALE` only initializes 48 of new entities (spec:L756 "Current entity linetype scale").
  Not part of rendering. ezdxf `resolve_linetype_scale = entity.dxf.ltscale * $LTSCALE`
  (ezdxf:addons/drawing/properties.py `resolve_linetype_scale`).
- `$PSLTSCALE` (default 1): **CONFLICT** — spec:L1376 says "1 = No special linetype scaling;
  0 = Viewport scaling governs linetype scaling", which is the inverse of AutoCAD's help and of
  common practice: PSLTSCALE=1 → linetype lengths of model-space objects shown in a viewport are
  scaled by 1/viewport-scale, so dashes have the same *paper* size in every viewport; 0 → no
  special scaling (ezdxf#1386 states the AutoCAD behaviour; ezdxf's pipeline always applies
  1/vp_scale, `get_vp_ltype_scale`, ezdxf:addons/drawing/pipeline.py:214). The value lives in the
  header of each layout? — ASSUMPTION: PSLTSCALE is per layout in AutoCAD (stored in the layout's
  block? UNKNOWN); DXF has a single `$PSLTSCALE` header var. Test L4.
  With PSLTSCALE=1, LTSCALE also applies in paper space (so the paper pattern = def × LTSCALE × 48).
- `$MSLTSCALE` (AutoCAD 2008+, default 1): model-space linetypes scaled by the annotation scale
  (CANNOSCALE) — affects model-space *display/plot* when plotting from model space with an
  annotation scale ≠ 1. ASSUMPTION; harness keeps annotation scale 1:1 or MSLTSCALE=0.
- **Block inserts: VERIFIED-BY-ACAD (2026-09-30, `linetypes/insert-scale-s1|s3|s0-5|mirror|mirror3|
  nonuniform-2-1|nonuniform-1-2|nonuniform-2-1-rot45`): the INSERT scale does NOT scale linetypes.**
  The block content is transformed to WCS first and the pattern (LTSCALE × entity 48) is applied
  there, like ezdxf does — a block line of WCS length 120 inserted at scale 3 has exactly the dashes
  of a directly drawn 120-unit line; non-uniform scales and mirroring change nothing either. The
  INSERT's own group 48 does not multiply into the content (`insert-ltscale-vs-child`,
  `byblock-ltscale2`: BYBLOCK content uses its own 48 and LTSCALE only).
- Scale chain **VERIFIED-BY-ACAD** (`linetypes/scale-ltscale-*`, `scale-equiv-*`, `scale-bylayer-48`,
  `scale-celtscale-*`): effective scale = $LTSCALE × entity 48 (48 = 0.5 with LTSCALE 2 equals
  48 = 1 with LTSCALE 1); $CELTSCALE has no effect on existing entities.
- ezdxf's min dash length 0.1 × vp-scale (`min_dash_length`, pipeline.py:596) is an ezdxf
  display hack.
- CTB "adaptive linetype" + "linepattern_size" apply only when the plot style overrides the
  linetype (§6).

### 2.6 How AutoCAD applies the pattern ("A-type alignment")

Autodesk documentation (help "About Simple Custom Linetypes", paraphrased): the alignment field
controls how the pattern is fitted at the ends of lines, arcs and circles. With A alignment the
dash-dot sequence of each line is adjusted so the line both starts and ends with a dash, at least
half a first dash long; the first and last dashes are lengthened when needed. A line too short for
one full sequence is drawn continuous. Arcs are adjusted so dashes fall on the endpoints; circles
and other closed objects get a pattern adjusted to look reasonable.

(**DOC**, paraphrased from Autodesk help.) mlightcad implemented the
"too short → continuous" rule and calls it matching AutoCAD (mlightcad pr-668). No library
implements the end alignment:
- ezdxf: pattern starts with the first element at the start of each primitive, continues across
  polyline vertices (the `LineTypeRenderer` state carries over between segments of one path),
  no end adjustment, no short-segment rule (ezdxf:render/_linetypes.py).
- mlightcad: pattern starts at offset 0 at the polyline start, walks continuously over the
  whole polyline (no per-vertex restart), short (< one cycle) → continuous
  (AcTrLineTypeWalker.ts `walkLineType`); screen shader falls back to solid when the pattern is
  < 1.5 px (AcTrLinePatternShaders.ts).
- QCAD: **centers** the pattern symmetrically on each entity (chooses an offset so that the entity's
  midpoint lies at a symmetry point of the pattern, maximizing the dash at the ends)
  (qcad:src/core/RLinetypePattern.cpp `getPatternOffset`/`getPatternOffsetAt`) — QCAD's own idea,
  but it is the closest in spirit to A-type alignment.
- dxf-viewer: no linetype support at all (`_GetLineType` returns 0, DxfScene.js:391).

#### 2.6.1 The rule AutoCAD 2027 PLOT uses (VERIFIED-BY-ACAD, 2026-09-30)

Measured on the vector PDF references (1/600 in) of the `linetypes` suite: every dash end of 226
cases is reproduced to < 0.35 px by the rules below (scratch oracle comparing our smooth-mode
strokes with the PDF strokes; implementation `packages/geometry/src/dash.ts` `autocadCandidateFit`).
Pattern `e0 … e(n−1)` (already × scale), Σ = Σ|ei|, **P = LTYPE group 40** (normally = Σ; the fit
uses 40, not Σ — `odd-total-exceeds|less|zero`), L = unit length along the curve (exact arc length).

**Open unit** (LINE, ARC, open ELLIPSE, SPLINE — also a closed SPLINE —, PLINEGEN-off polyline
segment, clipped XLINE/RAY; cases `fit-*` (all acad/acadiso simple linetypes × 10 lengths),
`fitzoom-*`, `direction-*`, `arc-*`, `arc-short-*`, `ellipse-*-half|partial`, `spline-*`):
1. k = ⌊L/P⌋, r = L − kP, h = (e0 + r)/2.
2. AutoCAD walks the element sequence `[h, e1 … e(n−1), (k−1) × (e0 … e(n−1)), e0 + r]` from the
   start and clips it at L (> 0 pen down, < 0 pen up, 0 dot). For a normal pattern (40 = Σ,
   e0 ≥ 0) this is exactly: both end dashes h = e0/2 + r/2, interior periodic with phase
   e0/2 − r/2 (dashes symmetric about the midpoint). With 40 ≠ Σ the walk ends early (40 > Σ:
   the last dash is `e0 + r` long and the rest of the line stays empty) or is cut at L (40 < Σ).
   A leading gap (e0 < 0, `odd-leading-gap`) gives a head dash h = (e0 + r)/2 merged into e1.
3. L < P → one continuous line, **except** patterns without any dash (only dots and gaps, e.g.
   DOT): they draw a dot at both ends even when L < P (`fit-dot`: 0.5 P → two dots).
4. Patterns starting with a dot (e0 = 0) draw **dots at 0 and at L** instead of the end dashes
   h (`fit-dot*`, `odd-dot-dash-start`); interior dots sit at h + e1 + m·P.
5. 40 = 0 → continuous (`odd-total-zero`); 73 = 0 (no elements) → continuous, also for a record
   named DASHED with any $MEASUREMENT (`odd-empty-40-5`, `odd-dashed-empty-meas-*`): AutoCAD does
   not reload .lin data. Consecutive dashes (`odd-two-dashes`) are just walked.

**Closed unit** (CIRCLE, full ELLIPSE, closed LWPOLYLINE/POLYLINE with PLINEGEN; `circle-*`,
`ellipse-*-full`, `pl-zigzag-*-closed-gen1`, `pl-fine-gen1`, `pl-bulge-circle-gen1`,
`odd-*` circles): L < P → continuous; else n = **max(2, round(L/P))** whole periods and every
element is multiplied by L/(n·P) (with 40 ≠ Σ the stretched real elements are walked and clipped at
L). The pattern starts with e0 at the curve start: CIRCLE at OCS angle 0 running CCW about the
extrusion (`circle-ocs-neg`: WCS 180°, clockwise), full ELLIPSE at parameter 0, closed PLINEGEN
polyline at **vertex 1** (not vertex 0!). CENTER on a circle of 1.24 P gets 2 periods, DASHED on
1.65 P gets 2, on 3.30 P 3, on 19.79 P 20.

**Units:** LWPOLYLINE / 2D POLYLINE with PLINEGEN (70 bit 128) off: every segment is an open unit
(dashes meet at each vertex); on: the whole polyline is one unit (open: A-type ends at the first and
last vertex; closed: closed rule). The entity flag decides, $PLINEGEN is irrelevant
(`pl-header-*`, `polyline2d-*`). 3D POLYLINEs, polygon/polyface meshes and 3DFACE edges plot
**continuous** (`other-polyline3d`, `other-polymesh`, `other-3dface`). XLINE and RAY are first
clipped to the plot window and then fitted as a LINE of the clipped length (`infinite-*`: the dashes
end symmetrically at the window edges; a RAY starts with a head dash at its base point).

**Lineweights** do not change the pattern (`lw-*`); ISO W100 linetypes are not adjusted to the
pen width (Q-0313: `lw-iso02-scaled` — only 48 scales them).

**Too dense** (`dense-*`, 10 px/unit): the criterion is the **device size of the period**, not the
dash count: periods of 0.32 px (DOT) and 0.38 px (DASHED) plot continuous, 0.51 px (DOT), 0.64 px,
0.76 px and 0.95 px stay dashed — on 18-unit lines with only 472 periods (`dense-short-subpixel`)
as on 1800-unit lines with 14173 periods (`dense-long-visible`). truedxf: continuous when the
period (Σ|ei| × scale) < 0.5 device px (threshold somewhere in (0.38, 0.51]).

**Which primitive is "an individual line"?** (pre-test notes; §2.6.1 has the verified answers)
- LINE: one unit.
- ARC: one unit along the arc length, from start angle CCW to end angle ("dashes at the endpoints").
- CIRCLE: no endpoints → "adjusted to provide a reasonable display"; ASSUMPTION: pattern starts at
  angle 0 (WCS/OCS +x) going CCW, length = 2πr, fitted so that it closes smoothly (integer number of
  periods, stretched?). UNKNOWN, test L3.
- ELLIPSE / SPLINE: one unit along the curve length (ASSUMPTION: like arcs if open; like circles if
  closed). Test L3.
- LWPOLYLINE / POLYLINE (2D): with **PLINEGEN off** (entity flag 128 off; LWPOLYLINE 70 bit 128,
  POLYLINE 70 bit 128) each segment (line or bulge arc) is its own unit → dashes at every vertex,
  short segments continuous. With **PLINEGEN on** the pattern runs continuously over the whole
  polyline length: "1 = Linetype is generated in a continuous pattern around vertices of the
  polyline" (spec:L1345); `$PLINEGEN` (default 0) is only the default for *new* polylines — the
  entity flag decides (libredwg dwg.h comment "512 closed, 128 plinegen", gdal issue 10153).
  With PLINEGEN on, is the whole polyline fitted with A-type end alignment? ASSUMPTION yes; closed
  polylines: pattern starts at vertex 0 and closes there. UNKNOWN, test L2.
- 3D polylines, meshes: ASSUMPTION per segment.
- Wide polylines (constant/variable width): the linetype is applied to the centerline and each dash
  is drawn as a wide quad/trapezoid (the dash inherits the local width). ASSUMPTION; test L6.
  PLINEGEN with tapered segments: UNKNOWN.
- HATCH pattern lines, TEXT/MTEXT, SOLID, TRACE, 3DFACE edges?, IMAGE frames: no linetype
  (ASSUMPTION; 3DFACE edges do get linetypes? UNKNOWN).
- DIMENSION: lines inside the dimension block have their own linetypes (dimlinetype overrides).
- Point entity: no.

**Zero-length dash (dot):** drawn as a dot. With lineweight > 0 and round caps it becomes a
disc of diameter = lineweight (ASSUMPTION); with lineweight 0 → 1 device pixel. mlightcad replaces
dots by 0.5-unit dashes (hack). Test L8.

**Pattern too dense:** On screen AutoCAD draws continuous lines when the dashes would be smaller
than a pixel (commonly observed; ASSUMPTION). For plotting: UNKNOWN whether a similar threshold
exists (probably based on plot resolution). For pixel matching at typical plot scales this rarely
matters.

**Paper-space / viewport:** the pattern is generated in model units using the effective scale of
§2.5, then projected. Linetypes are applied in the entity's own coordinate system *before*
viewport transformation.

---

## 3. Colors

### 3.1 Special ACI values

| Value | Meaning | Source |
|---|---|---|
| 0 | BYBLOCK | spec:L3124 |
| 1–255 | ACI palette index | |
| 256 | BYLAYER (also the default when 62 is absent) | spec |
| 257 | BYOBJECT / BYENTITY (R13+; internal, ACI "from object") — ezdxf const `BYOBJECT = 257`; ezdxf's pen resolution maps it to 7 with "???" | ezdxf:colors.py:124, ezdxf#53, properties.py `resolve_pen` |
| negative (LAYER 62) | layer is **off**; abs(value) is the color | spec:L2281 |
| negative (entity 62) | spec says "a negative value indicates that the layer is turned off (optional)" (spec:L3124) — ASSUMPTION: never written by AutoCAD for entities; treat abs() | |

Layer colors 0 or 256 are invalid ("BYBLOCK or BYLAYER is not valid a layer color", ezdxf:entities/layer.py:47);
ezdxf maps invalid layer ACI to 7 (properties.py `_true_layer_color`).

### 3.2 True color (420) and color books (430)

- 420: `0x00RRGGBB` (low byte blue, top byte 0) (spec:L3144). If 420 is present it **overrides 62**;
  AutoCAD still writes 62 with the nearest ACI (ezdxf `resolve_color`: "An existing true color value
  always overrides ACI color! Do not default to BYLAYER or BYBLOCK, this ACI value is ignored!").
  CTB lookup for true-color entities: UNKNOWN which ACI pen is used (the written 62? color 7?), see §6.
- 430: color name, format `BOOKNAME$COLORNAME` (e.g. `RAL CLASSIC$RAL 1000`) — ASSUMPTION about the
  format from ObjectARX; 420 carries the RGB, so for rendering 430 can be ignored (ASSUMPTION: 420 is
  always present alongside 430).
- LAYER true color: 420 in the LAYER record (R2004+). ezdxf: "layers with only true color set have
  default ACI color 7".
- Raw color ints (used in XDATA 1071, overrides, MLEADER, CTB): top byte `0xC0` BYLAYER, `0xC1`
  BYBLOCK, `0xC2` RGB, `0xC3` ACI (low byte), `0xC8` "window background" (seen in MLEADER)
  (ezdxf:colors.py:136–182). In DWG: CMC encoding (oda).

### 3.3 ACI 1–255 → RGB: CONFLICT (measure!)

Seven tables were extracted and compared (with a throwaway script, not kept; sources:
ezdxf:colors.py `DXF_DEFAULT_COLORS` / `DXF_DEFAULT_PAPERSPACE_COLORS`, netDxf:AciColor.cs
`indexRgb`, ACadSharp:Color.cs `_indexRgb`, dxf-viewer:src/parser/AutoCadColorIndex.js,
mlightcad-realdwg-web:packages/common/src/AcCmColorUtil.ts, libdxfrw:src/drw_objects.h `dxfColors`,
qcad:src/3rdparty/dxflib/src/dl_codes.h `dxfColors`, libredwg:src/dwg.c `rgb_palette`):

| ACI | ezdxf ms / netDxf / ACadSharp | ezdxf "paperspace" | dxf-viewer / mlightcad | libdxfrw | qcad dxflib | libredwg |
|---|---|---|---|---|---|---|
| 7 | FFFFFF | 000000 | FFFFFF | 000000 | — | FFFFFF |
| 11 | FF7F7F | FF7F7F | FF7F7F | FF7F7F | FF8080 | FFAAAA |
| 12 | A50000 | A50000 | CC0000 | CC0000 | A60000 | BD0000 |
| 14 | 7F0000 | 7F0000 | 990000 | 990000 | 800000 | 810000 |
| 16 | 4C0000 | 4C0000 | 7F0000 | 7F0000 | 4C0000 | 680000 |
| 18 | 260000 | 260000 | 4C0000 | 4C0000 | 260000 | 4F0000 |
| 54 | A5A500 | … | 989800 | 999900 | … | … |
| 109 | 135817 | 132617 | 264C2F | 264C2F | 132618 | 354F3B |
| 250 | 000000 | 000000 | 333333 | 333333 | 545454 | 333333 |
| 251 | 656565 | 2D2D2D | 5B5B5B | 5B5B5B | 767676 | 505050 |
| 252 | 666666 | 5B5B5B | 848484 | 848484 | 989898 | 696969 |
| 253 | 999999 | 898989 | ADADAD | ADADAD | BBBBBB | 828282 |
| 254 | CCCCCC | B7B7B7 | D6D6D6 | D6D6D6 | DDDDDD | BEBEBE |
| 255 | FFFFFF | B3B3B3 | FFFFFF | FFFFFF | FFFFFF | FFFFFF |

Two families:
- **"Light" palette** (dxf-viewer, mlightcad, libdxfrw; also the widely published table with
  250–254 = 51,91,132,173,214): value ramps FF / CC / 99 / 7F / 4C (+ half-saturated variants).
  dxf-viewer/mlightcad have 0x98 where libdxfrw has 0x99 in 44 entries (columns x4/x5, e.g. 54 =
  989800 vs 999900) and libdxfrw has a typo at 227 (7F3F0B vs 7F3F6F) — so even this family has
  ±1 discrepancies.
- **"Dark" palette** (ezdxf, netDxf, ACadSharp, qcad dxflib): ramps FF / A5 / 7F / 4C / 26. ezdxf
  claims "modelspace color palette for AutoCAD 2020 … values change depending on Uniform background
  color setting", i.e. captured from the screen with background 33,40,48; the ezdxf tables contain
  obviously background-adjusted anomalies (109 = 135817, 250 = 000000, 255 = B3B3B3 in "paperspace").

Explanation: AutoCAD uses **two RGB sets per ACI depending on the background**: slightly lighter
RGB on a black background, slightly darker on any other, for contrast (jtbworld blog 2008
"ACI to RGB color inconsistency", citing Autodesk TS1074647), and grays 8, 9, 250–255 are adjusted
for visibility (ACI 250 shows as 0,0,0 on white and 51,51,51 on black — Autodesk forum "Default
Index Colors?", via search summary). So the "light" table is
the classic/black-background set; the "dark" table is the non-black-background set.

What PLOT uses (with a CTB "use object color" pen) is **UNKNOWN**. Hypotheses: (a) the canonical
light table (plot drivers get the "true" RGB of the ACI), (b) the set for the paper color (white →
darker set, grays adjusted). **Must be measured**: plot an ACI 1–255 swatch sheet to PNG with
acad.ctb and to PDF (test C1). Until then implement the palette as data, selectable, default =
light table. The palette is factual data; no licensing issue expected.

### 3.4 ACI 7 (black/white)

ACI 7 is "white on dark background, black on light background" (ezdxf#108). In plots on white
paper ACI 7 plots **black** (ASSUMPTION, universal CAD behaviour; ezdxf uses the layout foreground
color for 7 and plot-style colors if the CTB forces one, ezdxf pr-1401 "Honour plot style table
color for ACI 7"). Only ACI 7 is inverted — ACI 255 and true color 255,255,255 stay white
(ASSUMPTION; test C2). BYBLOCK/BYLAYER resolving to 7 behaves like 7. ezdxf also treats layer
color 7 specially (`has_aci_color_7` → layout foreground) unless the layer has a true color.

### 3.5 Plotted ACI palette (VERIFIED-BY-ACAD, AutoCAD 2027)

Measured 2026-09-30 with the tools/acad harness (cases `calibration/palette-model`, `palette-paper`,
`palette-mono`; 255 solid-hatch swatches + 16 true colours; references under
`samples/refs/acad2027-R26.0/calibration/`; `tools/acad/calibration/analyze_palette.py --dump`;
details in note 08 §10.7):

- With `acad.ctb` ("use object color") AutoCAD 2027 plots a palette that matches **neither**
  candidate of §3.3 (55/255 entries equal each). Identical results in model space, in paper
  space, through a VIEWPORT, in the PNG (raster driver) and in the PDF (255/255) — so it is the
  plot palette, not a driver or background artefact. Swatches are uniform (no dithering; CTB
  `color_policy=1` has no visible effect).
- Structure: pure ramps **FF / DD / B8 / 95 / 72** (the "light" CC/99/7F/4C and "dark" A5/7F/4C/26
  ramps are both wrong for plots); half-saturated columns use value/2 rounded down (ACI 11 =
  FF7F7F, 13 = DD6E6E, 15 = B85C5C, 17 = 954A4A, 19 = 723939). ACI 8 = 808080, **ACI 9 = DCDCDC**
  (not C0C0C0), 250–255 = **545454 767676 989898 BABABA DBDBDB FAFAFA** — ACI 255 is *not*
  white.
- ACI 7 → **000000** on the white sheet (also via a viewport).
- True colours (420) plot exactly (16/16: FFFFFF, 000000, 010203, FEFDFC, 804020, …); true-colour
  white is invisible on the white sheet.
- `monochrome.ctb`: every ACI swatch → 000000, but **true-colour objects keep their RGB** (the
  ASSUMPTION in §6.3 "true-color objects also plot black" is wrong).

Measured table (row label = first ACI of the row; index 0 unused):

```
  0: 000000 FF0000 FFFF00 00FF00 00FFFF 0000FF FF00FF 000000 808080 DCDCDC FF0000 FF7F7F DD0000 DD6E6E B80000 B85C5C
 16: 950000 954A4A 720000 723939 FF3F00 FF9F7F DD3700 DD8A6E B82E00 B8735C 952500 955D4A 721C00 724739 FF7F00 FFBF7F
 32: DD6E00 DDA56E B85C00 B88A5C 954A00 95704A 723900 725639 FFBF00 FFDF7F DDA500 DDC16E B88A00 B8A15C 957000 95834A
 48: 725600 726439 FFFF00 FFFF7F DDDD00 DDDD6E B8B800 B8B85C 959500 95954A 727200 727239 BFFF00 DFFF7F A5DD00 C1DD6E
 64: 8AB800 A1B85C 709500 83954A 567200 647239 7FFF00 BFFF7F 6EDD00 A5DD6E 5CB800 8AB85C 4A9500 70954A 397200 567239
 80: 3FFF00 9FFF7F 37DD00 8ADD6E 2EB800 73B85C 259500 5D954A 1C7200 477239 00FF00 7FFF7F 00DD00 6EDD6E 00B800 5CB85C
 96: 009500 4A954A 007200 397239 00FF3F 7FFF9F 00DD37 6EDD8A 00B82E 5CB873 009525 4A955D 00721C 397247 00FF7F 7FFFBF
112: 00DD6E 6EDDA5 00B85C 5CB88A 00954A 4A9570 007239 397256 00FFBF 7FFFDF 00DDA5 6EDDC1 00B88A 5CB8A1 009570 4A9583
128: 007256 397264 00FFFF 7FFFFF 00DDDD 6EDDDD 00B8B8 5CB8B8 009595 4A9595 007272 397272 00BFFF 7FDFFF 00A5DD 6EC1DD
144: 008AB8 5CA1B8 007095 4A8395 005672 396472 007FFF 7FBFFF 006EDD 6EA5DD 005CB8 5C8AB8 004A95 4A7095 003972 395672
160: 003FFF 7F9FFF 0037DD 6E8ADD 002EB8 5C73B8 002595 4A5D95 001C72 394772 0000FF 7F7FFF 0000DD 6E6EDD 0000B8 5C5CB8
176: 000095 4A4A95 000072 393972 3F00FF 9F7FFF 3700DD 8A6EDD 2E00B8 735CB8 250095 5D4A95 1C0072 473972 7F00FF BF7FFF
192: 6E00DD A56EDD 5C00B8 8A5CB8 4A0095 704A95 390072 563972 BF00FF DF7FFF A500DD C16EDD 8A00B8 A15CB8 700095 834A95
208: 560072 643972 FF00FF FF7FFF DD00DD DD6EDD B800B8 B85CB8 950095 954A95 720072 723972 FF00BF FF7FDF DD00A5 DD6EC1
224: B8008A B85CA1 950070 954A83 720056 723964 FF007F FF7FBF DD006E DD6EA5 B8005C B85C8A 95004A 954A70 720039 723956
240: FF003F FF7F9F DD0037 DD6E8A B8002E B85C73 950025 954A5D 72001C 723947 545454 767676 989898 BABABA DBDBDB FAFAFA
```

The renderer's plot mode should use this table (the display palettes of §3.3 / Appendix A remain
relevant only for on-screen emulation).

---

## 4. Transparency

### 4.1 Encoding (440 on entities; also layer XDATA, VP overrides)

(spec:L3162 just says "Transparency value"; ezdxf:colors.py:202–240; ACadSharp:Transparency.cs;
netDxf:Transparency.cs)

- `0x02000000 | alpha` — alpha 0 = fully transparent, 255 = opaque (`OPAQUE = 0x020000FF`).
- UI transparency t ∈ 0…90 % → `alpha = trunc(255 × (100 − t) / 100)` (ACadSharp/netDxf
  `ToAlphaValue`; ezdxf `float2transparency` uses `int((1−t)·255)`, same truncation). ezdxf
  constants: 10 % = 0xE5 (229), 50 % = 0x7F (127), 90 % = 0x19 (25). AutoCAD UI maximum is 90 %.
  Reverse: `t = trunc(100 − alpha/255·100)` (ACadSharp `FromAlphaValue`).
- `0x01000000` = BYBLOCK (seen in the wild, dxf-json#86: `440 16777216` on an INSERT).
- **BYLAYER = absent** (ezdxf `_entity_alpha_str`: "No transparency attribute means by layer";
  ACadSharp/netDxf model BYLAYER as −1). ASSUMPTION: `0` (flag byte 0) also means BYLAYER.
- Layer transparency: XDATA `1001 AcCmTransparency`, `1071 value` (same encoding; ezdxf checks
  `t & 0x2000000` for a "real transparency value", ezdxf:entities/layer.py:291).
- VP layer overrides: layer extension dictionary `ADSK_XREC_LAYER_ALPHA_OVR` XRECORD with pairs
  `335 vp-handle / 440 value` (ezdxf:lldxf/const.py:693–707).
- IMAGE has its own transparency flag (bit 8 in 70 = "transparency is on" for bitonal images,
  ezdxf const `IMAGE_TRANSPARENCY_IS_ON = 8`) — unrelated.
- BYBLOCK at top level → opaque ("There is no default transparency value for layouts, AutoCAD and
  BricsCAD shows opaque entities!", ezdxf properties.py `_entity_alpha_str`).

### 4.2 Does transparency plot?

- Page setup option "Plot transparency" is stored as **XDATA on the LAYOUT object**:
  `1001 PLOTTRANSPARENCY / 1071 1` (ezdxf:entities/layout.py:195), *not* in PLOTSETTINGS 70.
- System variable PLOTTRANSPARENCYOVERRIDE (0 = never plot transparency, 1 = use page setup
  (default), 2 = always) — from AutoCAD documentation (ASSUMPTION, registry-level).
- If transparency is not plotted, everything plots opaque.
- If plotted: ASSUMPTION alpha compositing over what is already drawn (paper white). Whether AutoCAD
  rasterizes transparent objects separately (it switches to raster output in PDF) is UNKNOWN.
- Harness: **plot transparency off** by default; one dedicated test T1 with it on.

---

### 4.3 Calibration results (VERIFIED-BY-ACAD, AutoCAD 2027, 2026-09-30, transparency suite)

- **PLOTTRANSPARENCYOVERRIDE**: 0 = never (opaque even when the LAYOUT XDATA `PLOTTRANSPARENCY
  1071 1` is set: `layouts/pagesetup-plottransparency`, `transparency/entity-050-plot-off`),
  1 = page setup XDATA, 2 = always (all other `transparency/*` cases set 2). The harness prologue
  sets 0, so truedxf's PlotRequest default is 0 too (render/src/transparency.ts).
- **Blend formula** (PNG, 8-bit per channel, no dithering, no AA): `out = (src*a + dst*(256 - a)) >> 8`
  with `a = 440 & 0xFF`. 50 % (a = 127): red over white (255,128,128), over blue (126,0,128), over
  black (126,0,0); 25/75/90 % and a second 50 % layer on top agree exactly (`entity-025/050/075/090`,
  `overlap-same-color`). Every drawn primitive blends over what is already there.
- Resolution: 440 absent or 0 -> layer (AcCmTransparency XDATA: `layer-070`, `bylayer-zero`,
  `bylayer-absent`), `0x01000000` -> the INSERT's (`byblock-insert-*`), top-level BYBLOCK -> opaque
  (`byblock-entity-toplevel`). AC1018 files plot transparency too (`ac1018`).
- Blend units: a solid HATCH / SOLID blends once per pixel; a stroke blends **per segment**: the
  round-capped segments of a 2.11 mm circle or LWPOLYLINE darken twice where they overlap, and the
  segments of a width-6 LWPOLYLINE overlap at the joints (`other-fills`, `wide-lines`).
- A pattern HATCH's background colour fill is transparent as well (`hatch-background`).
- Open: ACI 30 at 60 % gives G = 203 where the formula with the plot palette's 127 gives 204
  (`random-0001`): one channel of a few colours is off by one.

## 5. Lineweights

### 5.1 Values (370)

- Enum, mm × 100, 16-bit: `0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100,
  106, 120, 140, 158, 200, 211` (ezdxf:lldxf/const.py:234 `VALID_DXF_LINEWEIGHTS`).
- `−1` BYLAYER, `−2` BYBLOCK, `−3` DEFAULT (ezdxf const:230). Spec: "Stored and moved around as a
  16-bit integer", default not omitted (spec:L3130). Layers: 370 required, −3 = default.
- Invalid values (e.g. 17): ASSUMPTION AutoCAD snaps to the nearest valid value ≤? UNKNOWN;
  ezdxf's validator rounds to a valid value. Test W4.
- DEFAULT (−3) → `LWDEFAULT` system variable, **stored in the registry, not in the DXF**
  (spec has no $LWDEFAULT; ezdxf: "todo: is this value stored anywhere?" and returns 0.25,
  properties.py `default_lineweight`). AutoCAD default = 0.25 mm. Harness: keep LWDEFAULT = 25.
  **VERIFIED-BY-ACAD** (2026-09-30, `lineweights/default-lwdefault-025`, `-100`, Q-0206): DEFAULT and BYLAYER on a
  DEFAULT layer plot at the session's LWDEFAULT (set by the harness from `meta.plot.sysvars.LWDEFAULT`; truedxf:
  `PlotRequest.sysvars.LWDEFAULT`). ByLayer / ByBlock / explicit lineweights resolve as in §7.1
  (`lineweights/bylayer`, `byblock-*`, `insert-scale`: INSERT scale never scales lineweights).
- `$CELWEIGHT` = lineweight of new objects (spec:L760), not used for rendering.
- `$LWDISPLAY` (0/1) only controls screen display (spec:L1267). **Plots honour lineweights if the
  page setup flag 128 "PrintLineweights" (plot object lineweights) is set, independent of
  LWDISPLAY** (spec:L9173; ASSUMPTION about independence — universally stated in AutoCAD help).
  With plot styles enabled, "plot with plot styles" (32) takes lineweights from the CTB pen if it
  overrides them.
- Flag 64 "ScaleLineweights": scale lineweights proportionally to the plot scale (only meaningful
  in layouts with scale ≠ 1 or model plots). Harness: off.

### 5.2 Rendering lineweights in plots

- Physical width on paper in mm (not scaled by drawing scale). Raster plot: width_px =
  lw_mm × DPI / 25.4; rounding rule **VERIFIED-BY-ACAD (note 08 §10.4): px = max(1, round(mm × 100/25.4)) at the
  fixed 100 dpi raster DPI, PDF width = round(mm × 600/25.4)/600 in; caps round**; earlier text: (test W1: plot all 24 weights at 300/600 DPI
  and measure).
- Lineweight 0: "thinnest line the plotter can draw" = 1 device pixel (ASSUMPTION; W1).
- On screen: weights ≤ 0.25 mm (LWDEFAULT) display as 1 px (irrelevant for PLOT).
- End caps / joins: `$ENDCAPS` (0 none, 1 round, 2 angle, 3 square; spec:L1137) and `$JOINSTYLE`
  (0 none, 1 round, 2 angle, 3 flat; spec:L1248) are *document* settings "for new objects"
  (ezdxf defaults 0/0, sections/headervars.py). The CTB/STB pen can override: end style
  0 butt, 1 square, 2 round, 3 diamond, 4 = use object; join 0 miter, 1 bevel, 2 round, 3 diamond,
  5 = use object (ezdxf:addons/acadctb.py:22–33). ASSUMPTION: with ENDCAPS = 0 ("none") AutoCAD
  uses **round caps and round joins** for wide lineweights in plots (common observation). UNKNOWN →
  test W2 (plot a 2.11 mm line and a polyline corner, measure cap overshoot = lw/2 for round/square,
  0 for butt).
- Joins inside LWPOLYLINE: one continuous stroke (joined); separate LINEs meeting at a point: each
  capped separately (with round caps looks the same).
- Dashes of a linetype are separate strokes each with caps (ASSUMPTION: a 0.5 mm dash with 0.5 mm
  lineweight and round caps is visually 1.0 mm long). Test W3.
- **Wide polylines:** "Wide polylines show lineweights only when displayed outside of the plan
  view" (**DOC**, Autodesk help "Control Lineweights", via web search). So in 2D plan plots a
  polyline with width > 0 is drawn as its filled outline with no lineweight added; width 0 segments
  use the lineweight. Solid fills (SOLID, solid HATCH), TrueType text, raster images, points get no
  lineweight (**DOC**, same page). ASSUMPTION: points (PDMODE shapes) are drawn with lineweight?
  UNKNOWN.
- ezdxf clamps to min 0.01 mm to avoid invisible lines (properties.py `resolve_lineweight`).

---

## 6. Plot styles (CTB / STB)

### 6.1 Modes

- `$PSTYLEMODE` (290): **1 = color-dependent (CTB)**, 0 = named (STB) (spec:L1382; ezdxf default 1).
  A drawing is in one mode; conversion requires CONVERTPSTYLES.
- Layout/PLOTSETTINGS code **7** = current style sheet file name (e.g. `acad.ctb`, `monochrome.ctb`)
  (spec PLOTSETTINGS "7 Current style sheet"; ezdxf `layout.get_plot_style_filename()`). Header
  `$STYLESHEET` = default style sheet (mentioned in ezdxf properties.py comment).
- PLOTSETTINGS 70 flags (spec:L9157): 1 PlotViewportBorders, 2 ShowPlotStyles, 4 PlotCentered,
  8 PlotHidden, 16 UseStandardScale, **32 PlotPlotStyles**, **64 ScaleLineweights**,
  **128 PrintLineweights**, **512 DrawViewportsFirst**, 1024 ModelType, 2048 UpdatePaper,
  4096 ZoomToPaperOnUpdate, 8192 Initializing, 16384 PrevPlotInit. ezdxf default 688
  (= 512+128+32+16). PLOTTRANSPARENCY is XDATA (§4.2). 72 paper units (0 in, 1 mm, 2 px),
  73 rotation, 74 plot type, 75 standard scale, 142/143 custom scale, 76 shade plot mode.
- VIEWPORT entity has its own plot style sheet (`plot_style_name`, used by ezdxf
  `RenderContext.from_viewport`) — applies to viewport content? ASSUMPTION: only for shaded plots;
  UNKNOWN.

### 6.2 Named plot styles (STB) attachment

- Entity `390` = hard pointer to the plot style (an `ACDBPLACEHOLDER` object that is an entry of the
  `ACAD_PLOTSTYLENAME` dictionary — the dictionary *key* is the style name, e.g. "Normal"),
  entity `380` = plot style type: 0 BYLAYER, 1 BYBLOCK, 2 BYDICTIONARYDEFAULT, 3 BYOBJECTID
  (= use 390). Same enum as `$CEPSNTYPE` (spec:L766; dxf-json#86; ezdxf dxfgfx.py:137
  `plotstyle_enum` 380 (R2007+, default 1?), `plotstyle_handle` 390).
- LAYER `390` = handle of the layer's plot style (spec:L2289). The dictionary has a default entry
  ("Normal"), `ACDBDICTIONARYWDFLT`.
- STB file: same container as CTB, `aci_table_available=FALSE`, styles by name, "Normal" style
  always first and not editable (ezdxf acadctb.py `NamedPlotStyles`).
- In CTB mode 390/380 are ignored; pens are selected by the resolved ACI.

### 6.3 CTB/STB file format

(ezdxf:addons/acadctb.py; the ezdxf implementation is known to round-trip with AutoCAD.)

Binary container:
```
"PIAFILEVERSION_2.0,CTBVER1,compress\r\npmzlibcodec"   (48 bytes; STB: ",STBVER1,")
uint32 adler32(compressed body), uint32 uncompressed length, uint32 compressed length   (LE)
zlib stream (from byte 60)
```
`_decompress`: `zlib.decompress(content[60:])`, strip trailing NUL (acadctb.py:658).
`_compress` writes the header with `pack("LLL", adler, len(content), len(comp))` (acadctb.py:665)
— note: ASSUMPTION the header string differs for STB (`STBVER1`).

Decompressed text (CTB):
```
description="...
aci_table_available=TRUE
scale_factor=1.0
apply_factor=FALSE
custom_lineweight_display_units=0
aci_table{
 0="Color_1
 ...
}
plot_style{
 0{
  name="Color_1
  localized_name="Color_1
  description="
  color=-1                     (-1 = use object color; else raw color int, negative, 0xC2RRGGBB)
  mode_color=-1006632961       (the "real" color; OBJECT_COLOR2 = -1006632961 also = object)
  color_policy=1               (bit 1 dithering, bit 2 grayscale, bit 4 named color)
  physical_pen_number=0        (0 = automatic)
  virtual_pen_number=0
  screen=100                   (0..100 %)
  linepattern_size=0.5         (for adaptive CTB linetypes)
  linetype=31                  (31 = use object linetype; 0..30 = built-in plot linetypes)
  adaptive_linetype=TRUE
  lineweight=0                 (index into custom_lineweight_table; see below)
  fill_style=73                (64 solid … 72 vertical bars, 73 = use object)
  end_style=4                  (0 butt, 1 square, 2 round, 3 diamond, 4 object)
  join_style=5                 (0 miter, 1 bevel, 2 round, 3 diamond, 5 object)
 }
 ... 255 entries for ACI 1..255 (index = aci − 1)
}
custom_lineweight_table{
 0=0.00
 1=0.05 ... 26=2.11            (27 default entries, mm)
}
```
Strings start with `"` and have no closing quote (ezdxf writer). Colors are stored as negative
ints (`-((type<<24) + rgb) & 0xFFFFFFFF`, acadctb.py:777). ezdxf treats `lineweight` value 0
(table entry 0.00) as "use object lineweight" (`OBJECT_LINEWEIGHT = 0`, `get_lineweight` returns
None for 0.0) — **CONFLICT/UNKNOWN:** it is widely reported that AutoCAD uses 255 for "Use object
lineweight" in the pen table; with ezdxf's semantics a pen could never force 0.00 mm. Verify with a
real acad.ctb (test P1). The default table has 27 entries including 0.10, 0.45, 0.65 which are not
DXF lineweights.

Color policy: dithering (1), grayscale (2): grayscale conversion formula UNKNOWN (ASSUMPTION
luminance 0.30R+0.59G+0.11B). Screening s %: ASSUMPTION `c' = 255 − (255 − c)·s/100`
(lighten towards white). Both only matter if the harness ever uses such pens.

Standard tables (ASSUMPTION, typical AutoCAD installs): `acad.ctb` — every pen use object color,
no dithering changes, screening 100, object linetype/lineweight/end/join/fill → equivalent to "no
plot style". `monochrome.ctb` — all 255 pens color black (0,0,0), rest object → everything black
(**wrong — VERIFIED-BY-ACAD §3.5: true-color objects keep their RGB under monochrome.ctb**). `Grayscale.ctb`, `Screening xx%.ctb`, `Fill
Patterns.ctb`. "None" = no plot style table → object properties.

### 6.4 Pen selection for true-color objects (CTB mode)

UNKNOWN which ACI pen applies to an entity with 420 true color: color comes from the object (if the
pen says "use object color"), but lineweight/linetype overrides of which pen? ezdxf looks up the pen
by `entity.dxf.color` (the 62 value, which AutoCAD writes as nearest ACI) — properties.py
`resolve_lineweight` ("Not sure if plotstyle table overrides actual entity setting?"). Avoided by the
harness (acad.ctb has no overrides). Test P2.

### 6.5 How truedxf should emulate plot styles

Pipeline per primitive after BYLAYER/BYBLOCK resolution (§7):
1. Determine the pen: CTB → resolved ACI (1..255; ACI 7 is pen 7); STB → resolved style name
   (380/390 with BYLAYER/BYBLOCK resolution).
2. Color: pen color if not "object"; else object color (ACI→RGB via palette, ACI 7 → black on
   white paper, true color as is). Then grayscale/screening/dither if enabled.
3. Lineweight: pen lineweight if not "object"; else resolved object lineweight (DEFAULT → LWDEFAULT);
   only if plot flag 128 (or PlotPlotStyles with a pen lineweight).
4. Linetype: pen linetype if not 31 (object) — CTB linetypes 0..30 with "adaptive" fitting are a
   separate feature (low priority, UNKNOWN definitions).
5. End/join/fill style from pen unless "object" → ENDCAPS/JOINSTYLE defaults.
Implement the CTB reader early (small) but default everything to "object".

### 6.6 Reference harness settings (keep AutoCAD PLOT simple and deterministic)

- `$PSTYLEMODE = 1`, plot style table **`acad.ctb`** (or PLOTSETTINGS flag 32 off → "plot with
  plot styles" disabled). Never monochrome.ctb (hides color bugs).
- Plot flag 128 on (plot lineweights), 64 off (don't scale lineweights), transparency off
  (no `PLOTTRANSPARENCY` XDATA, PLOTTRANSPARENCYOVERRIDE=1), 512 decide explicitly per test (§8).
- Raster PC3 ("PublishToWeb PNG.pc3") with a fixed custom paper size and DPI, or DWG To PDF.pc3 and
  rasterize ourselves — PNG avoids PDF rasterizer differences, but has its own anti-aliasing (UNKNOWN
  whether AutoCAD's PNG driver anti-aliases; test).
- White paper, 1:1 scale, plot area = window/extents fixed by the test file, no centering drift.
- LWDEFAULT = 0.25 mm, LTSCALE = 1, PSLTSCALE = 1, MSLTSCALE = 0/1 (decide), FILLMODE = 1,
  $MEASUREMENT fixed, TEXTFILL = 1.
- Fixed ACI→RGB table measured once (test C1) and stored as data.

---

## 7. Property resolution (BYLAYER / BYBLOCK)

### 7.1 Algorithm (ezdxf RenderContext, cross-checked; ezdxf:addons/drawing/properties.py:626ff)

State while descending into INSERTs: a stack of *resolved* properties of the enclosing INSERT
(`push_state(insert_properties)`, frontend.py `draw_composite_entity`). The INSERT itself is
resolved like any entity (its BYBLOCK refers to *its* parent insert).

```
resolve_layer(e):
    if e.layer == "0" and inside_block: return parent.resolved_layer   # innermost INSERT's resolved layer
    return e.layer
# recursive by construction: a layer-0 INSERT inside a block already resolved to the outer INSERT's layer

resolve_color(e):
    if e has 420:            color = RGB(420)                      # overrides 62 completely
    elif e.62 == 256/absent: color = layer(resolved).color         # layer ACI 7 → layout fg (black on paper)
    elif e.62 == 0:          color = parent.color if inside_block else fg(7)
    else:                    color = ACI(e.62)                     # 257: object color, rare
    alpha = resolve_transparency(e)

resolve_linetype(e):
    BYLAYER → layer linetype;  BYBLOCK → parent linetype if inside block else CONTINUOUS
    name lookup case-insensitive; unknown name → CONTINUOUS (ASSUMPTION)

resolve_lineweight(e):
    −1 → layer lineweight (layer −3 → LWDEFAULT); −2 → parent.lw if inside else LWDEFAULT;
    −3 → LWDEFAULT; else value/100 mm
    (CTB pen override applied afterwards, §6.5)

resolve_transparency(e):
    absent → layer transparency (XDATA AcCmTransparency, VP override), none → opaque
    0x01000000 → parent alpha if inside block else opaque
    0x02xxxxxx → alpha byte

resolve_linetype_scale(e) = e.48 × $LTSCALE (× insert scale, ASSUMPTION §2.5)

plot style (STB): 380 = 0 BYLAYER → layer 390; 1 BYBLOCK → parent; 2 → dictionary default;
                  3 → 390 of the entity  (ASSUMPTION mapping)
```

Notes:
- `ezdxf notes/pages/Notes on Rendering DXF Content.md` (experimentally determined, ezdxf authors):
  entity on layer "B" in a block inserted on layer "A" with BYLAYER color → color of **B**; entity on
  layer "0" → color of **A** ("layer 0 is the only special case"); BYBLOCK outside a block → layout
  default color (white in model space, black in paper space).
- BYBLOCK linetype outside a block → CONTINUOUS (ezdxf returns "STANDARD" + continuous pattern).
- MINSERT: each grid instance resolves like an INSERT.
- ATTRIBs belong to the INSERT (they are *not* inside the block): resolve them at the INSERT's level
  (their BYBLOCK → the INSERT's parent; their layer 0 → normal layer 0?). ASSUMPTION; ezdxf draws
  `insert.attribs` after the block content, still inside `push_state(insert)` (frontend.py:915) —
  so ezdxf resolves attrib BYBLOCK against the INSERT itself. CONFLICT-candidate; mlightcad
  realdwg-web pr-68 "propagate layer/color/lineType to INSERT ATTRIBs". Test R4.
- Dimension/leader/MText internals: entities inside the anonymous dimension block use BYBLOCK a lot;
  the DIMENSION entity is the "insert" for that block (same algorithm).
- Layer names are case-insensitive (ezdxf notes).
- Nested xrefs / xref-dependent layers `XREF|LAYER`: same algorithm (xref layers are real layers).

### 7.2 Visibility

- Layer **off** (negative 62) or **frozen** (70 bit 1) → entities on that layer invisible.
- Layer plot flag `290 = 0` → not plotted (spec:L2285; ezdxf `export_mode` only).
- `DEFPOINTS` layer never plots (ASSUMPTION, universal AutoCAD behaviour; not in any local source).
- Entity 60 = 1 invisible.
- Inside blocks (ezdxf notes, experimental): entity on layer X ≠ 0 → visible iff X visible
  (independent of the INSERT's layer); entity on layer 0 → visible iff the INSERT's (resolved) layer
  is visible. ezdxf `resolve_visible` for INSERT: "depends only on the invisible flag, the layer
  state has no effect!".
  **CONFLICT (ASSUMPTION from AutoCAD folklore):** *freezing* the INSERT's layer hides the whole
  block including non-layer-0 content, while turning it *off* hides only layer-0 content. Test R2.
- Layer 0 itself frozen/off: effect on layer-0 content of blocks inserted on other layers? UNKNOWN
  (ezdxf rule would say: layer 0 state is ignored). Test R3.
- **VERIFIED-BY-ACAD** (2026-09-30): freeze vs off as assumed; layer 0's own state is ignored for content of
  blocks inserted on other layers; a **no-plot INSERT layer suppresses the whole block content** (note 07 §3.2,
  `blocks/vis-*`). Top-level BYBLOCK colour plots as ACI 7 and BYBLOCK linetype as Continuous
  (`colors/byblock-toplevel`, `byblock-toplevel-linetype-byblock`, Q-0198).
- VIEWPORT frozen layers: VIEWPORT 341 handles (frozen-in-viewport); ezdxf `_setup_vp_layers`
  marks them invisible for that viewport's content. Layer 70 bit 2 "frozen in new viewports" only
  affects new viewports.
- Per-viewport layer overrides (color, true color, linetype, lineweight, transparency) in the layer's
  extension dictionary XRECORDs `ADSK_XREC_LAYER_COLOR_OVR` (335 vp handle + 420 raw color),
  `ADSK_XREC_LAYER_LINETYPE_OVR` (335 + 343 ltype handle), `ADSK_XREC_LAYER_LINEWT_OVR`
  (335 + 91 lw), `ADSK_XREC_LAYER_ALPHA_OVR` (335 + 440) (ezdxf:lldxf/const.py:693ff,
  ezdxf:entities/layer.py `load_layer_overrides`). Apply only for content drawn through that viewport
  (plot style override? not supported by ezdxf).
- VIEWPORT entity visibility: the layer of the viewport entity controls only its border
  (ezdxf `resolve_visible` "If the layer is off the viewport borders are invisible"); viewport
  status ≤ 0 → not drawn (ezdxf `_draw_viewports`). Border plotted? PLOTSETTINGS flag 1
  "PlotViewportBorders" (ASSUMPTION: for model-space viewports only; paper-space VIEWPORT borders
  plot if their layer plots). Test R5.

---

## 8. Draw order

### 8.1 Base order

- AutoCAD draws the entities of a block record (model space, paper space, block definition) in the
  order of the block record's entity list. When reading a DXF that is the **file order** of the
  ENTITIES section / BLOCK definition (ASSUMPTION).
- Mozman (ezdxf#634, 2022): "the default draw order: by ascending handles, which is in all CAD
  applications and also ezdxf, the order of creation". In AutoCAD-created files handle order and file
  order coincide, so both statements agree in practice. For DXF files written by other tools they can
  differ → **UNKNOWN** which one AutoCAD uses (test D1: file order ≠ handle order, overlapping solid
  fills).
- ezdxf: no SORTENTS → file order; with SORTENTS → ascending sort handle, ties in file order
  (ezdxf:reorder.py, frontend.py:298).
- INSERT = single element in the draw order: "two Insert entities cannot interleave the contents of
  their blocks" (ezdxf notes, experimental). Within the block, the block's own order (and its own
  SORTENTS? — block records can have `ACAD_SORTENTS` in their extension dictionary, ezdxf supports
  `BlockLayout` redraw order; ezdxf does not apply it when drawing inserts: "TODO: redraw_order=True?",
  frontend.py:903). ASSUMPTION: AutoCAD honours block SORTENTS. Test D3.
- ATTRIBs are drawn after the block content of their INSERT (ezdxf#1321, frontend.py:915).
- Layers have no influence on draw order (ezdxf notes).

### 8.2 SORTENTSTABLE

(spec:L9855ff, oda:L11884ff)

- Object in the block record's extension dictionary under `ACAD_SORTENTS`; `330` owner block record
  (spec: "currently only the *MODEL_SPACE or *PAPER_SPACE blocks"), then pairs `331 entity handle`,
  `5 sort handle`.
- Semantics: each listed entity is drawn as if its handle were the sort handle; entities not listed
  use their own handle (oda: "When the sortentstable doesn't have a mapping from entity handle to sort
  handle, then the entity's own handle is used for sorting"). Sort ascending by the numeric (hex)
  value; the sort handle "does not have to point to an entity". Equal sort handles → source order.
- Special: sort handle **"0"** sorts **last** (ezdxf reorder.py `_build`: "Special handling of
  sort-handle '0': this behavior is defined by AutoCAD but not documented", maps 0 →
  0xFFFFFFFFFFFFFFFF). Handles can be up to 128 bit in practice ("CADKitSamples\AEC Plan Elev
  Sample.dxf") → compare as BigInt / hex strings by length then lexicographic.
- Implication: with a SORTENTSTABLE present, *all* entities are ordered by (sort) handle, not by file
  order.
- `$SORTENTS` (spec:L1468, default 127) — legacy bit flags (16 = regen, 32 = plotting) "uses sort
  table for …". ASSUMPTION: modern AutoCAD always honours the table. Ignore.

VERIFIED-BY-ACAD (draworder suite, AutoCAD 2027, 2026-09-30):
- No SORTENTSTABLE: **file order**, not handle order (`draworder/file-vs-handle-*`).
- With a table: key = sort handle if listed, else the entity's own handle; ascending numeric hex
  (`sortents-hex-compare`: 9 < FF < 100), equal keys keep file order (`sortents-duplicate`); sort
  handle `0` is an ordinary key 0, drawn **first**, not last (`sortents-zero-handle`; ezdxf's
  "0 sorts last" does not hold for AutoCAD 2027 PLOT); entries for missing entities are ignored
  (`sortents-invalid-entity`); unlisted entities interleave by their own handle
  (`sortents-unlisted`, `random-*`).
- `$SORTENTS` bit 32 (plotting) gates the table for PLOT: 0 and 95 plot in file order, 111 and
  127 sorted (`sortents-000/095/111/127`).
- Block definitions honour their own ACAD_SORTENTS (`block-sortents`); an INSERT is one unit in
  the parent order and a table can move a top-level entity between two INSERTs
  (`insert-sortents-between`).
- Solid fills (HATCH, SOLID, TRACE, wide polylines) keep plain draw order
  (`hatch-before/after-lines`, `mixed-fills-order`, `hatch-*-mtext`).

### 8.2a Interactive renderer order (GPU verification, 2026-10-02)

This is an implementation observation, not an additional AutoCAD rule. The exact plot renderer
retains its original painter sequence. The interactive renderer can merge opaque batches within
each consecutive stencil clip run and encode that sequence in depth. With the renderer's
orthographic camera (`near=-1`, `far=1`, camera z=0), **positive world z is nearer**. The real
RX 9070 XT / Chromium D3D11 checks confirm that later ranges win, including across primitive kinds;
`LessEqualDepth` allows overlapping primitives of one range to retain buffer order. Four million
orders mapped into (-0.999, 0.999) remain distinct after float32 projection and 24-bit quantization;
larger lists fall back to the original path. See `packages/three/test/merge.test.ts` and
`apps/playground/scripts/merge-check.ts`.

three.js renders its opaque queue before its transparent queue. Clipped merged opaque objects
therefore use the transparent queue with **NoBlending**, alongside resets/masks and individual
alpha/image batches. Each clip run emits masks, opaque content, then alpha/image content in
source order. Unclipped opaque content may run first because global depth rejects earlier
fragments. Underlays and overlays need separate render stages to preserve their host order;
resets/masks disable both depth testing and depth writes, including highlight masks.

Common float64 group origins still require a new float32 relative-position copy. On the fitted
1600×1000 browser viewport (1016×924 drawing buffer) aliased corpus comparison, six of eleven
drawings match exactly; the other five differ by six edge pixels in total: `circles_large` (1),
`spline_points_large` (2), issue-847 (1), `zhangmabeng1` (1), issue-574/test.dxf (1). For every
one of those drawings the differences are reproduced by the **original unmerged renderer** using
only rebased origins; merged versus rebased-unmerged is pixel-identical. This isolates
coordinate/raster-edge rounding rather than painter order. Keep merging off for exact pixel
comparisons. The nine synthetic checks, including transparency and clipped highlights, match.

### 8.3 Special entities

- **WIPEOUT**: a polygon filled with the *background color* (paper color when plotting) that masks
  everything drawn before it; entities after it are drawn on top (mlightcad#671 describes the expected
  AutoCAD behaviour; ezdxf frontend `draw_wipeout_entity` fills with the layout background color;
  ezdxf#205 user observation: "wipeouts remove anything below it in the draw order by pasting a
  rectangle of the background color"). Frame: drawn in entity color depending on WIPEOUTFRAME
  (stored in the `WIPEOUTVARIABLES` object, 70 display-frame flag 0/1, spec:L10221; newer AutoCAD
  has 2 = "displayed but not plotted" — encoding UNKNOWN). Wipeout geometry is in IMAGE-style pixel
  coordinates (ezdxf#205) → see the image note.
- **IMAGE**: opaque raster over earlier content (unless transparent bitonal); IMAGEFRAME via
  `RASTERVARIABLES` 70 (spec:L9314) — same 0/1/2 caveat. IMAGE 70 display flags (show image, show
  when not aligned, use clipping boundary, transparency on).
- **Solid fills** (HATCH solid, SOLID, TRACE, wide polylines): drawn in draw order like everything
  else — no automatic "send to back". A white/ACI-7-on-paper solid hatch *covers* earlier lines
  (mlightcad pr-228 bug: z-fighting made fill order random).
- **MTEXT background fill** (90 flags: 1 = use fill color 63/421/431, 2 = use drawing window
  (= background/paper) color, 3 = both bits (ezdxf: "canvas color"), 16 = text frame (R2018?,
  ODA 20.4.46); 45 = fill box scale (border = (scale − 1) × char height, default 1.5); 441 fill
  transparency "not implemented" (spec:L5782ff; ezdxf:entities/mtext.py:180ff,
  addons/drawing/mtext_complex.py `make_bg_renderer`). Drawn as an opaque rectangle directly before
  the MTEXT's glyphs, i.e. it masks earlier entities like a wipeout (ASSUMPTION) — details in the
  text note. Bit 2 with plotting → paper white (ASSUMPTION).
- **TEXTFILL** (system variable, default 1): TrueType text plotted filled vs outlines. **TEXTQLTY**
  (tessellation quality of TrueType outlines for plotting, default 50) — both registry/sysvars, not
  in the 2012 DXF header. Harness: TEXTFILL = 1.
- **Viewports in paper space** — "DrawViewportsFirst" (PLOTSETTINGS 70 bit 512, ezdxf default on):
  when set, viewport contents are plotted first and paper-space entities on top; when not set,
  viewports are drawn in their position in the paper-space draw order (ASSUMPTION). Mozman (ezdxf#634):
  "even AutoCAD (TrueView) ignores this flag" — CONFLICT/UNKNOWN; test D2. ezdxf always draws
  viewports *after* all paper-space entities (`_draw_entities` collects viewports and draws them at
  the end, frontend.py:1044) — the opposite of "viewports first". Viewports are drawn sorted by
  status (stacking) and status ≤ 0 skipped.
- **Hatch HPDRAWORDER** (send behind boundary etc.) is only applied at creation via SORTENTS.

---

## 9. Consolidated UNKNOWN list (to resolve with AutoCAD)

**Open after the 2026-09-30 AutoCAD pass (rungs 7–8):** linetypes on wide polylines (dashes are
butt-ended quads at the local width; not implemented, `linetypes/pl-wide-*`); AutoCAD's arc
tessellation chords determine complex-element rotation on arcs (≤ 1° off here); exact
too-dense threshold (0.38–0.51 px); gradient mesh/dither emulation, CURVED shift;
MPOLYGON (accoreconsole cannot load its enabler); text-box loops (flag 8), HATCHBACKGROUNDCOLOR
(not drawn yet, `bgcolor-*`), dots with lineweight. Answered 2026-10-01: ellipse-edge angles
(§1.3.3), too-dense hatches plot nothing above 100,000 lines (§1.6.3), HEMISPHERICAL shift and
rotation (§1.7.1), collinear edges (§1.6.2).

1. ~~A-type linetype alignment exact formula; circles/ellipses/splines/closed polylines; PLINEGEN runs;
   dots at the ends.~~ ANSWERED §2.6.1 (only the too-dense criterion is open).
2. ~~Linetype scaling by INSERT scale (and mirror/non-uniform).~~ ANSWERED §2.5: never.
3. Complex linetype placement origin (end of element?), upright flip threshold, text insertion
   point. (§2.2–2.3)
4. Which ACI→RGB palette PLOT uses (light/dark, gray adjustments). (§3.3)
5. ACI 255 / RGB white on white paper. (§3.4)
6. CTB "use object lineweight" encoding (0 vs 255); pen selection for true-color entities. (§6.3–6.4)
7. Lineweight → pixel rounding; lineweight 0; default end caps/joins; dash caps. (§5.2)
8. Transparency compositing when plotted. (§4.2)
9. Hatch: text-box loops, styles 1/2 without flags, overlapping loops, ellipse-edge angle vs param,
   dot rendering, HPMAXLINES criterion & solid fallback, gradient geometry/colour math, background
   color layering, `ACAD` XDATA 1010, 77 double handling. (§1)
10. Base draw order: file vs handle order; block SORTENTS; DrawViewportsFirst. (§8)
11. Visibility of block content when the INSERT layer is frozen vs off; layer 0 state. (§7.2)
12. WIPEOUTFRAME/IMAGEFRAME value 2 storage and plotting. (§8.3)

---

## Test ideas

Each is a small DXF (R2018, $MEASUREMENT=1, white paper, acad.ctb, lineweights on, transparency off
unless stated) plotted with fixed window/DPI; compare pixels with truedxf.

**Hatch**
- H1: square with solid hatch; same with pattern ANSI31 at 52=0/30, 41=0.5/1/2; check stored lines vs
  image (proves "stored lines are final" and the dash phase at the boundary).
- H2: edge-path hatch with a CW arc edge (ccw=0, 50=270, 51=360) vs the CCW version (ezdxf#175
  scripts) → identical output.
- H3: ellipse edge with ratio 0.3 and 50/51 = 30°/120°: is the arc end at geometric 30° or at
  parameter 30°? Compare with an ELLIPSE entity drawn on top.
- H4: full-circle arc edge written as 0..360, −180..180, 90..450 → all render as circle; 0..0 → ?
- H5: one hatch with two overlapping (not nested) square loops, flags 1/1 and 1/0; styles 0/1/2.
- H6: hatch around a TEXT with a textbox loop (flag 8) – styles 0/1/2 – does the text box stay empty?
- H7: nested loops (outer, island, island-in-island) with correct flags (1,16,0) and with all flags 0,
  styles 0/1/2 → compare with ezdxf rendering_paths and dxf-viewer nesting.
- H8: edge path with a 1e-3 gap between edges and edges out of order → does AutoCAD fill?
- H9: user-defined pattern (76=0) with 77=1: are two families stored? Delete the second family
  manually: does AutoCAD still draw the cross?
- H10: pattern with dots (DOTS) at lineweight 0 / 0.5 mm: dot size.
- H11: increasing density ANSI31 at 41 = 1e-1 … 1e-5 on a 1000-unit square: where does AutoCAD
  switch to solid (HPMAXLINES default) – and does the plot match the screen?
- H12: pattern hatch with HATCHBACKGROUNDCOLOR (red) over a blue line: layering.
- H13: hatch in an INSERT with scale 2, rotation 30, mirrored X: pattern transformed with the block.
- H14: MPOLYGON with holes, fill color 63=1, pattern: boundary drawn? style ignored?
- G1: gradient matrix: 9 names × shift {0,1} × angle {0,45°} × two colors black→white in a 100×50
  rectangle, sample pixel rows → fit the interpolation formula.
- G2: single-color gradient (452=1) with 462 ∈ {0, 0.25, 0.5, 0.75, 1}: what AutoCAD writes into the
  second 421 (save from AutoCAD, then diff) and how it plots.

**Linetypes**
- L1: horizontal LINEs of lengths P·{0.5, 0.99, 1.0, 1.01, 1.25, 1.5, 2, 2.5, 3.7, 10.3} for DASHED,
  CENTER, DASHDOT, DOT, ACAD_ISO04W100 → measure dash start/end positions (A-type formula).
- L2: LWPOLYLINE zig-zag with short and long segments, PLINEGEN off/on, open/closed; bulge segments.
- L3: CIRCLE, ARC (10°..350°), ELLIPSE full/partial, closed/open SPLINE with DASHED: where does the
  pattern start, is it stretched to close?
- L4: paper-space layout, two viewports at 1:1 and 1:10 showing the same DASHED line, PSLTSCALE 0/1,
  LTSCALE 2.
- L5: block containing a DASHED line inserted with scale 1, 3, −1 (mirror), (2,1) non-uniform.
- L6: wide LWPOLYLINE (width 2, tapered 0→4) with DASHED.
- L7: complex linetypes GAS_LINE (text, U flag), ZIGZAG and FENCELINE1 (shapes) on a line and on an
  arc; rotate text 50 = 90 written as degrees and as radians (1.5708) to confirm units.
- L8: DOT linetype at lineweights 0, 0.35, 2.11 mm.
- L9: entity 48 = 0.5 with LTSCALE 2 → equals 48 = 1, LTSCALE 1?

**Colors / transparency / lineweights / plot styles**
- C1: 16×16 swatch grid of SOLID fills ACI 1–255 + labels; plot to PNG and PDF; also on a black
  "paper"? (not possible) — compare with both palettes.
- C2: ACI 7, ACI 255, RGB(255,255,255), RGB(0,0,0), ACI 250 lines on white paper.
- C3: entity with 62=1 and 420=0x00FF00 → green (420 wins); 430 book color with 420.
- T1: overlapping solid hatches with 440 = 0x0200007F (50 %), layer transparency XDATA, BYBLOCK in a
  block with INSERT transparency; plot with PLOTTRANSPARENCY on and off.
- W1: 24 horizontal lines, one per valid lineweight, at 300 and 600 DPI → width in px.
- W2: 2.11 mm line end and 90° LWPOLYLINE corner with ENDCAPS/JOINSTYLE 0..3 and CTB end/join
  overrides → cap/join shape.
- W3: DASHED line with 0.5 mm lineweight: visible dash length.
- W4: 370 = 17 (invalid) → which width.
- P1: open a real `acad.ctb`/`monochrome.ctb` with our reader; check "use object lineweight" value.
- P2: CTB with pen 1 lineweight 1.0 mm; entity 62=1 + 420 true color: does the pen apply?

**Property resolution / draw order**
- R1: nested blocks (A in B in model space) with BYBLOCK/BYLAYER/layer-0 entities; INSERTs with
  explicit/BYLAYER/BYBLOCK properties at each level (color, linetype, lineweight, transparency).
- R2: block with entities on layer 0 and layer X inserted on layer Y; Y off vs Y frozen.
- R3: same with layer 0 off / frozen.
- R4: ATTRIB with BYBLOCK color on an INSERT with color 1 inside a block inserted with color 3.
- R5: paper-space VIEWPORT on a non-plotting layer; flag 1 PlotViewportBorders.
- D1: two overlapping solid squares where file order ≠ handle order, no SORTENTS; then with a
  SORTENTSTABLE, with a sort handle "0", with an entity missing from the table.
- D2: paper-space solid over a viewport, DrawViewportsFirst on/off.
- D3: block with its own ACAD_SORTENTS reversing its two entities.
- D4: WIPEOUT between lines (frame 0/1), MTEXT with background fill (90 = 1, 2, 3, 16) over lines.


---

## Appendix A — ACI palettes (extracted data, see §3.3)

Both tables are candidate data; which one AutoCAD PLOT uses is UNKNOWN (test C1).

### A.1 'Light' palette (dxf-viewer = mlightcad)

Source: dxf-viewer:src/parser/AutoCadColorIndex.js; identical to mlightcad-realdwg-web:packages/common/src/AcCmColorUtil.ts; libdxfrw:src/drw_objects.h differs in 44 entries by 0x98 vs 0x99 (plus 7 = 000000 and a typo at 227). Row label = first ACI of the row; index 0 is a dummy.

```
  0: 000000 FF0000 FFFF00 00FF00 00FFFF 0000FF FF00FF FFFFFF 808080 C0C0C0 FF0000 FF7F7F CC0000 CC6666 990000 994C4C
 16: 7F0000 7F3F3F 4C0000 4C2626 FF3F00 FF9F7F CC3300 CC7F66 992600 995F4C 7F1F00 7F4F3F 4C1300 4C2F26 FF7F00 FFBF7F
 32: CC6600 CC9966 994C00 99724C 7F3F00 7F5F3F 4C2600 4C3926 FFBF00 FFDF7F CC9900 CCB266 997200 99854C 7F5F00 7F6F3F
 48: 4C3900 4C4226 FFFF00 FFFF7F CCCC00 CCCC66 989800 98984C 7F7F00 7F7F3F 4C4C00 4C4C26 BFFF00 DFFF7F 99CC00 B2CC66
 64: 729800 85984C 5F7F00 6F7F3F 394C00 424C26 7FFF00 BFFF7F 66CC00 99CC66 4C9800 72984C 3F7F00 5F7F3F 264C00 394C26
 80: 3FFF00 9FFF7F 33CC00 7FCC66 269800 5F984C 1F7F00 4F7F3F 134C00 2F4C26 00FF00 7FFF7F 00CC00 66CC66 009800 4C984C
 96: 007F00 3F7F3F 004C00 264C26 00FF3F 7FFF9F 00CC33 66CC7F 009826 4C985F 007F1F 3F7F4F 004C13 264C2F 00FF7F 7FFFBF
112: 00CC66 66CC99 00984C 4C9872 007F3F 3F7F5F 004C26 264C39 00FFBF 7FFFDF 00CC99 66CCB2 009872 4C9885 007F5F 3F7F6F
128: 004C39 264C42 00FFFF 7FFFFF 00CCCC 66CCCC 009898 4C9898 007F7F 3F7F7F 004C4C 264C4C 00BFFF 7FDFFF 0099CC 66B2CC
144: 007298 4C8598 005F7F 3F6F7F 00394C 26424C 007FFF 7FBFFF 0066CC 6699CC 004C98 4C7298 003F7F 3F5F7F 00264C 26394C
160: 003FFF 7F9FFF 0033CC 667FCC 002698 4C5F98 001F7F 3F4F7F 00134C 262F4C 0000FF 7F7FFF 0000CC 6666CC 000098 4C4C98
176: 00007F 3F3F7F 00004C 26264C 3F00FF 9F7FFF 3300CC 7F66CC 260098 5F4C98 1F007F 4F3F7F 13004C 2F264C 7F00FF BF7FFF
192: 6600CC 9966CC 4C0098 724C98 3F007F 5F3F7F 26004C 39264C BF00FF DF7FFF 9900CC B266CC 720098 854C98 5F007F 6F3F7F
208: 39004C 42264C FF00FF FF7FFF CC00CC CC66CC 980098 984C98 7F007F 7F3F7F 4C004C 4C264C FF00BF FF7FDF CC0099 CC66B2
224: 980072 984C85 7F005F 7F3F6F 4C0039 4C2642 FF007F FF7FBF CC0066 CC6699 98004C 984C72 7F003F 7F3F5F 4C0026 4C2639
240: FF003F FF7F9F CC0033 CC667F 980026 984C5F 7F001F 7F3F4F 4C0013 4C262F 333333 5B5B5B 848484 ADADAD D6D6D6 FFFFFF
```

### A.2 'Dark' palette (ezdxf DXF_DEFAULT_COLORS)

Source: ezdxf:colors.py DXF_DEFAULT_COLORS ('modelspace color palette for AutoCAD 2020', background 33,40,48); netDxf/ACadSharp agree except 29, 91, 145, 192, 203 (e.g. 145 = 3F6FD9, 192 = A50052 there, likely typos); ezdxf's DXF_DEFAULT_PAPERSPACE_COLORS differs further at 7 and the x9 entries 109-249 and 251-255. Row label = first ACI of the row; index 0 is a dummy.

```
  0: 000000 FF0000 FFFF00 00FF00 00FFFF 0000FF FF00FF FFFFFF 808080 C0C0C0 FF0000 FF7F7F A50000 A55252 7F0000 7F3F3F
 16: 4C0000 4C2626 260000 261313 FF3F00 FF9F7F A52900 A56752 7F1F00 7F4F3F 4C1300 4C2F26 260900 261713 FF7F00 FFBF7F
 32: A55200 A57C52 7F3F00 7F5F3F 4C2600 4C3926 261300 261C13 FFBF00 FFDF7F A57C00 A59152 7F5F00 7F6F3F 4C3900 4C4226
 48: 261C00 262113 FFFF00 FFFF7F A5A500 A5A552 7F7F00 7F7F3F 4C4C00 4C4C26 262600 262613 BFFF00 DFFF7F 7CA500 91A552
 64: 5F7F00 6F7F3F 394C00 424C26 1C2600 212613 7FFF00 BFFF7F 52A500 7CA552 3F7F00 5F7F3F 264C00 394C26 132600 1C2613
 80: 3FFF00 9FFF7F 29A500 67A552 1F7F00 4F7F3F 134C00 2F4C26 092600 172613 00FF00 7FFF7F 00A500 52A552 007F00 3F7F3F
 96: 004C00 264C26 002600 132613 00FF3F 7FFF9F 00A529 52A567 007F1F 3F7F4F 004C13 264C2F 002609 135817 00FF7F 7FFFBF
112: 00A552 52A57C 007F3F 3F7F5F 004C26 264C39 002613 13581C 00FFBF 7FFFDF 00A57C 52A591 007F5F 3F7F6F 004C39 264C42
128: 00261C 135858 00FFFF 7FFFFF 00A5A5 52A5A5 007F7F 3F7F7F 004C4C 264C4C 002626 135858 00BFFF 7FDFFF 007CA5 5291A5
144: 005F7F 3F6F7F 00394C 26427E 001C26 135858 007FFF 7FBFFF 0052A5 527CA5 003F7F 3F5F7F 00264C 26397E 001326 131C58
160: 003FFF 7F9FFF 0029A5 5267A5 001F7F 3F4F7F 00134C 262F7E 000926 131758 0000FF 7F7FFF 0000A5 5252A5 00007F 3F3F7F
176: 00004C 26267E 000026 131358 3F00FF 9F7FFF 2900A5 6752A5 1F007F 4F3F7F 13004C 2F267E 090026 171358 7F00FF BF7FFF
192: 5200A5 7C52A5 3F007F 5F3F7F 26004C 39267E 130026 1C1358 BF00FF DF7FFF 7C00A5 9152A5 5F007F 6F3F7F 39004C 42264C
208: 1C0026 581358 FF00FF FF7FFF A500A5 A552A5 7F007F 7F3F7F 4C004C 4C264C 260026 581358 FF00BF FF7FDF A5007C A55291
224: 7F005F 7F3F6F 4C0039 4C2642 26001C 581358 FF007F FF7FBF A50052 A5527C 7F003F 7F3F5F 4C0026 4C2639 260013 58131C
240: FF003F FF7F9F A50029 A55267 7F001F 7F3F4F 4C0013 4C262F 260009 581317 000000 656565 666666 999999 CCCCCC FFFFFF
```
