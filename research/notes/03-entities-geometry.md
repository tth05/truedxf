# 03 — Geometric entities, coordinate systems and curve math

Scope: the common entity group codes, OCS/WCS/UCS/DCS, and every "plain geometry" entity
(POINT, LINE, XLINE, RAY, CIRCLE, ARC, ELLIPSE, SPLINE, LWPOLYLINE, POLYLINE/VERTEX/SEQEND,
3DFACE, SOLID, TRACE, HELIX, MESH, REGION/3DSOLID/BODY/SURFACE, SHAPE). It also covers wide polylines,
tessellation and extents. Text, hatch, dimension, linetype and lineweight rendering belong in their own notes and
only show up here where they touch geometry.

Citation shorthand:
- `spec:NNNN` is a line in `research/spec/autocad_2012_dxf_reference.txt`.
- `ezdxf:path:line` is relative to `research/repos/ezdxf/`, usually under `src/ezdxf/`.
- `ezdxf#N`, `ACadSharp#N`, … are threads under `research/github/raw/<owner>__<repo>/threads/`.
- `dxf-viewer:src/DxfScene.js:N`, `netDxf:…`, `ACadSharp:…`, `libredwg:src/dwg.spec:N`. libredwg, LibreCAD and qcad
  are GPL, so they're cited for facts only.

Confidence tags: **VERIFIED-BY-ACAD** (someone checked in AutoCAD, TrueView or BricsCAD, and the note says which),
**ASSUMPTION**, **UNKNOWN**, **CONFLICT**.

---

## 0. TL;DR for implementers

1. OCS→WCS uses the arbitrary axis algorithm with a 1/64 polar cap (§2.2). Get it exactly right.
   Extrusion `(0,0,-1)` is **extremely common**, because AutoCAD writes it whenever geometry is mirrored. For that
   extrusion the OCS x-axis is `(-1,0,0)` and the y-axis is `(0,1,0)`, so the stored X is the negated world X and arcs
   run clockwise in WCS. Failing to apply this is the #1 bug in every JS/C# library (ACadSharp#1224, #1228;
   bjnortier-dxf#147; netDxf#292; dxf-viewer only mirrors X).
2. The OCS entities are CIRCLE, ARC, LWPOLYLINE, 2D POLYLINE/VERTEX, SOLID, TRACE, TEXT, ATTRIB, ATTDEF, INSERT,
   HATCH, DIMENSION (partly) and probably SHAPE (the spec contradicts itself). The WCS entities are LINE, POINT,
   3DFACE, 3D POLYLINE, mesh POLYLINE, ELLIPSE, SPLINE, XLINE, RAY, MESH, HELIX, MTEXT (210 is only its normal), IMAGE
   (probably), VIEWPORT, LEADER and MLINE. Full table in §2.4.
3. ELLIPSE is WCS. Its 210 is only the plane normal: `minor = normalize(N × major) · |major| · ratio`. Parameters are
   **not** angles.
4. SPLINE: evaluate the stored control points, knots and weights as a standard NURBS over
   `[knots[p], knots[len-1-p]]`. Ignore the closed/periodic flags for drawing (TrueView does too, ezdxf#851). Only build
   a curve from the fit points when there are no control points. AutoCAD then always makes a cubic by global
   interpolation with chord parameterization (§3.8).
5. SOLID/TRACE draw in vertex order 1-2-4-3. The fourth vertex is always present.
6. Wide polylines: segments become quads with mitered joints between straight segments, arcs become annular sectors,
   and widths taper linearly. A non-zero 43 constant width overrides 40/41 in AutoCAD, but not in BricsCAD (§4).
7. Curve-fit polylines (flag 2): draw **all** vertices, including the extra flag-1 vertices, with their bulges.
   Spline-fit polylines (flag 4): draw only the flag-8 vertices and skip the flag-16 frame. **CONFLICT**: ezdxf ≥1.4.x
   also skips flag 1 (§3.10.4).
8. Tessellate adaptively in device space, with chord error below about 0.1–0.25 px. VIEWRES only affects the screen
   (§5).
9. Extents leave out XLINE and RAY. A spline's bounding box has to come from the curve, not the control polygon (§6).

---

## 1. Common entity group codes

Source: spec:3039-3180. Defaults come from ezdxf:src/ezdxf/entities/dxfgfx.py:63-140, which follows "when a group
is omitted, its default applies" (spec:3052-3056).

| Code | Meaning | Default if omitted | Notes |
|---|---|---|---|
| 0 | entity type | — | |
| 5 | handle (hex string) | — | DIMSTYLE uses 105 instead; entities always use 5 |
| 102 `{ACAD_REACTORS` … `}` | persistent reactors; contains 330 soft pointers | — | also `{ACAD_XDICTIONARY` with 360, and arbitrary `{appname` groups |
| 330 | owner handle (BLOCK_RECORD for entities; for VERTEX/SEQEND/ATTRIB it's the parent POLYLINE/INSERT) | — | The first 330 **after** the 102 groups is the owner |
| 100 | `AcDbEntity` subclass marker | — | R12 files have no 100 markers. ezdxf also accepts the base class and AcDbEntity mixed together (dxfgfx.py:203) |
| 67 | 1 = paper space | 0 (model space) | |
| 410 | layout tab name | — | spec marks it "APP", yet R2000+ files write it. Treat it as informative; use the owner block record to find the layout |
| 8 | layer name | "0" | Case-insensitive lookup (ezdxf rendering notes) |
| 6 | linetype name | BYLAYER | `BYBLOCK`/`BYLAYER` are special; case-insensitive |
| 62 | ACI color: 0 BYBLOCK, 256 BYLAYER, 257 BYOBJECT (ezdxf) | 256 | spec:3120 says a negative value means the layer is off. That's a LAYER-table semantic and it's **ASSUMPTION** that it never appears on entities |
| 420 | true color 0x00RRGGBB | — | **Overrides 62** when present (ezdxf dxfgfx.py:113) |
| 430 | color name ("BOOK$NAME") | — | Informational. 420 still carries the RGB |
| 440 | transparency 0x02000000 \| alpha (0 = fully transparent, 255 = opaque); 0x01000000 = BYBLOCK | absent = BYLAYER | ezdxf dxfgfx.py:117-126 |
| 370 | lineweight in 1/100 mm; -1 BYLAYER, -2 BYBLOCK, -3 DEFAULT | -1 (ezdxf); spec says "not omitted" | Only the standard set 0,5,9,13,…,211 is valid |
| 48 | linetype scale | 1.0 | R2000+ |
| 60 | 1 = invisible | 0 | An invisible entity is **not drawn and not plotted**. **ASSUMPTION**: it also stays out of extents; test it |
| 347 | material handle | BYLAYER | irrelevant for 2D plot |
| 348 | visual style handle | — | R2007+ (ezdxf) |
| 284 | shadow mode 0..3 | — | irrelevant for 2D plot |
| 380 | plot style name type (AcDb::PlotStyleNameType) | 1 | Not in spec; ezdxf dxfgfx.py:137 |
| 390 | plot style handle (named plot styles, STB) | — | Needed for STB plotting (see the plot-style note) |
| 92 / 160 | byte count of proxy graphics | — | **CONFLICT**: spec says 92. ezdxf reads 92 below R2013 and **160** for R2013+ (dxfgfx.py:205-210) |
| 310 | proxy graphics binary chunks (hex, ≤127 bytes per line) | — | Fallback geometry for custom entities (§3.17) |
| 38 | elevation | 0 | Legacy for most entities (R11 and older; ezdxf dxfgfx.py:143-170). **Still current for LWPOLYLINE** (the OCS z of all vertices). POLYLINE uses 10/20/30 instead |
| 39 | thickness (can be negative) | 0 | Extrudes along 210 (§2.6) |
| 210/220/230 | extrusion / normal | (0,0,1) | A (0,0,0) vector is invalid; ezdxf falls back to the default (ezdxf#851 found a LibreCAD file with a null extrusion) |

Implementation notes:
- Group-code order is not guaranteed (spec:3047-3051), so parse with a switch.
- Legacy elevation (ezdxf dxfgfx.py:143-170): for R12, if a point has z = 0 and 38 is present, use 38 as z. This applies
  to SOLID, TRACE, TEXT, CIRCLE, ARC, ATTRIB, ATTDEF, INSERT and SHAPE. **ASSUMPTION**: AutoCAD adds 38 to OCS z; ezdxf
  instead replaces z only when z = 0.

---

## 2. Coordinate systems

### 2.1 WCS, UCS, OCS, DCS, PSDCS

- **WCS**: the world. Everything is finally expressed in it.
- **UCS**: a user working plane. Coordinates in DXF are **never** UCS. They're always WCS or OCS
  (ezdxf docs/source/concepts/coordinates.rst). The UCS in effect when an entity was drawn can't be recovered
  (spec:11513-11530). The one exception is POINT 50, "angle of the X axis for the UCS in effect when the point was
  drawn" (§3.1).
- **OCS / ECS**: defined only by the extrusion vector N. Its origin is the WCS origin and its axes come from the
  arbitrary axis algorithm. The **elevation** is the OCS z of the entity plane (spec:11467-11530). It's always
  right-handed (ezdxf ocs.rst).
- **DCS**: display coordinate system of a view or viewport. Origin = TARGET (VIEWPORT 17), z-axis = view direction
  (VIEWPORT 16, pointing from the target toward the viewer), plus the twist angle (VIEWPORT 51). A viewport is
  always a plan view of its DCS. VIEWPORT 12 "view center" is in DCS (spec:7250-7300).
- **PSDCS**: paper space DCS. Model-space DCS maps into it by a uniform scale
  (viewport height in paper units / view height 45) and a translation, so the view center 12 lands on the
  viewport center 10.
  ezdxf implements top views only (ezdxf:src/ezdxf/entities/viewport.py:642-658). The formula is
  `M = T(−target) · S(scale) · Rz(twist) · T(vp.center − viewCenter·scale)`.
  **ASSUMPTION**: for non-plan views the DCS x/y axes come from the arbitrary axis algorithm applied to the view
  direction, then twist. That gives "WCS Z points up" away from the poles, which matches how AutoCAD shows
  3D views. **UNKNOWN**: needs a VPOINT test.

Renderer pipeline (per entity):

```
OCS point (x, y, z=elevation)  --AAA(N)-->  WCS
  --(nested INSERT transforms, each built in its own OCS)-->  WCS of layout
  --DCS (model space viewport: target/direction/twist) + PSDCS (scale, center)-->  paper units
  --plot transform (paper → device, plot scale, offset, rotation)-->  device pixels
```

For model-space plots use the active VPORT (the "*Active" entry) or the plot window instead of a paper-space
VIEWPORT. Thickness extrusion happens in WCS, before the view projection (§2.6).

### 2.2 Arbitrary Axis Algorithm (exact)

From spec:11534-11590 and ezdxf:src/ezdxf/math/ucs.py:24-45.

```
N  = normalize(extrusion)              // AutoCAD normalizes; the magnitude is irrelevant
if |N.x| < 1/64 and |N.y| < 1/64:      // "square polar cap", 1/64 = 0.015625 exactly
    Ax = normalize( (0,1,0) × N )      // Wy × N
else:
    Ax = normalize( (0,0,1) × N )      // Wz × N
Ay = normalize( N × Ax )
Az = N
```

- `(a × b) = (a.y·b.z − a.z·b.y, a.z·b.x − a.x·b.z, a.x·b.y − a.y·b.x)`.
- The comparison is a strict `<` in both spec and ezdxf.
- OCS→WCS: `P_wcs = x·Ax + y·Ay + z·Az`, i.e. matrix columns `[Ax Ay Az]`.
- WCS→OCS: `x = P·Ax, y = P·Ay, z = P·Az` (transpose; the matrix is orthonormal).
- Shortcut: ezdxf skips the transform when `N ≈ (0,0,1)` (`Vec3.isclose`, ucs.py:37). That's fine because the AAA gives
  identity for exactly +Z.
- Worked example, `N = (0,0,-1)`: `Ax = (0,1,0)×(0,0,-1) = (-1,0,0)`, `Ay = (0,0,-1)×(-1,0,0) = (0,1,0)`.
  So `x_wcs = −x_ocs`, `y_wcs = y_ocs`, `z_wcs = −z_ocs`. An arc that is CCW in OCS is CW seen from +Z. Its WCS
  start point is `(−(cx + r·cos a), cy + r·sin a)`. Real AutoCAD confirmation: ACadSharp#1224 shows an `entget` dump
  with stored X `-4.2675e+06` and extrusion `(0,0,-1)` while the true world X is `+4.2675e+06`.
- Normalizing N matters: some writers store non-unit extrusions. ezdxf normalizes. **ASSUMPTION**: so does AutoCAD
  ("Given a unit-length vector…", spec:11541).

### 2.3 Elevation per entity

| Entity | Where the OCS z comes from |
|---|---|
| CIRCLE, ARC | 30 of the center (OCS). 38 is legacy |
| LWPOLYLINE | **38** (single value for all vertices; the vertices are 2D, 10/20 only) |
| 2D POLYLINE | 30 of the POLYLINE header "dummy point" (10 = 0, 20 = 0, 30 = elevation) (spec:5990-5998). The vertex z is **ASSUMPTION**: ignored / equal. ezdxf uses the header elevation and falls back to the first vertex z if 30 is missing (ezdxf path/converter.py:141-147) |
| HATCH | 10/20/30 "elevation point", x = y = 0, z = elevation (OCS) |
| SOLID/TRACE | the z of 10-13 (normally all equal) |
| TEXT/INSERT | the z of the insertion point |

**UNKNOWN**: the sign of the elevation under a flipped normal. It's consistent to map `(x, y, elev)` through the AAA,
which gives WCS z = −elev for N = −Z. ACadSharp#1228 flags this as unverified.

### 2.4 OCS vs WCS per entity (points 10–37)

| Entity | Point codes | System | Source / notes |
|---|---|---|---|
| LINE | 10, 11 | WCS | spec:4972ff; 210 only gives the thickness direction |
| POINT | 10 | WCS | spec:5946ff. 210 gives the thickness direction and the PDMODE symbol plane (ezdxf render/point.py: "not a real OCS") |
| XLINE, RAY | 10 base, 11 unit direction | WCS | spec:6088ff, 7622ff; no 210 |
| CIRCLE, ARC | 10 | OCS | spec:3298ff, 3844ff |
| ELLIPSE | 10 center, 11 major-axis endpoint relative to center | **WCS** | spec:4249ff. 210 is only the normal (ezdxf entities/ellipse.py:84-88). VERIFIED in practice: ACadSharp#1228 lists "666 mirrored ellipses" correct as WCS |
| SPLINE | 10 control, 11 fit, 12/13 tangents | WCS | spec:6291ff. 210 is the normal, omitted when non-planar |
| HELIX | all | WCS | spec:4625ff |
| LWPOLYLINE | 10/20 | OCS + 38 | spec:5006ff |
| POLYLINE 2D (no flag 8/16/64) + VERTEX | 10 | OCS | spec:5976ff, 7178ff |
| POLYLINE 3D (flag 8), polymesh (16), polyface (64) + VERTEX | 10 | WCS | same |
| 3DFACE | 10–13 | WCS | spec:3181ff |
| SOLID | 10–13 | OCS | The spec's SOLID table doesn't say, but the OCS table (spec:11495) lists solid as a 2D/OCS entity, and so does ezdxf entities/solid.py:120-142. The comment "Solid WCS; Trace OCS" in solid.py:39 is stale |
| TRACE | 10–13 | OCS | spec:7068ff |
| TEXT, ATTRIB, ATTDEF | 10, 11 | OCS | spec:11495 |
| MTEXT | 10, 11 (x-axis direction) | WCS | 210 is the normal |
| INSERT | 10 | OCS | Block content is transformed in the INSERT's OCS |
| HATCH, MPOLYGON | boundary 10/20 | OCS + elevation point | ACadSharp#1228 |
| SHAPE | 10 | **CONFLICT**: spec:6199ff says "Insertion point (in WCS)", but the OCS table (spec:11495) lists shape as OCS. ezdxf transforms it as WCS with a "WCS?" comment (entities/shape.py:124). **UNKNOWN**: test with a non-Z extrusion |
| IMAGE, WIPEOUT | 10 insertion, 11/12 u/v pixel vectors | **CONFLICT**: spec OCS table says OCS; ezdxf transforms as WCS (entities/image.py:171-176). ASSUMPTION: WCS |
| DIMENSION | 10 defpoint WCS, 11 text midpoint OCS, 12 OCS, 13/14/15 WCS, 16 OCS | mixed | ezdxf entities/dimension.py:84-217 |
| VIEWPORT | 10 WCS (paper space), 12 DCS, 16/17 WCS | — | spec:7250ff |
| MLINE, LEADER | vertices WCS, 210 normal | WCS | ezdxf entities/mline.py:99-103, 745-748 |

### 2.5 Angles

- DXF angles (ARC 50/51, TEXT 50, INSERT 50, POINT 50, SHAPE 50) are in **degrees**, measured CCW about the
  entity's extrusion axis from the OCS x-axis. `$ANGBASE` and `$ANGDIR` only affect UI input and output, never
  stored data. **ASSUMPTION**: well established; ezdxf never applies them.
- ELLIPSE 41/42 and hatch-ellipse parameters are in **radians** (ellipse parameters, not angles, §3.7).
- Angles can be negative or over 360. Normalize with `a mod 360` into [0, 360), but see the full-circle rules (§3.5).

### 2.6 Thickness (39) and extrusion rendering

- Thickness extrudes the entity by `thickness · N̂` (N̂ = normalized 210), even for WCS entities (LINE, POINT) whose
  points aren't in OCS (spec:11490-11493: "only lines and points can be extruded" among the 3D entities).
- Wireframe appearance (2D wireframe, the normal plot mode):
  - LINE: base line, top line `+t·N̂`, and two connecting edges at the endpoints, so a quad outline. In plan view
    with N = view direction, all four collapse onto the base line.
  - POINT with thickness: a line from P to `P + t·N̂` (**ASSUMPTION**; the PDMODE symbol is presumably drawn at the base).
  - CIRCLE/ARC with thickness: bottom and top curves, with connecting lines at the arc ends.
    **UNKNOWN**: whether AutoCAD draws silhouette or isolines for circles in 2D wireframe (probably not, only the two
    circles).
  - LWPOLYLINE/2D POLYLINE with thickness: bottom and top polylines plus vertical edges at each vertex. With width,
    you get a 3D slab (and fill?). **UNKNOWN**.
  - SOLID/TRACE with thickness: a prism. **UNKNOWN** whether the top face is filled in 2D wireframe plots.
  - TEXT/SHAPE with thickness: extruded glyphs (SHX only). **UNKNOWN**.
- For the common case (plan view, N ∥ view direction) thickness is **invisible**. It only matters for plots of
  paper-space viewports with 3D views, or for entities whose N isn't parallel to the view (e.g. N = +X with thickness,
  seen from the top as a band of width |t|).
- Current library behaviour: ezdxf's drawing add-on ignores thickness entirely, and its bbox has "TODO apply
  thickness" (ezdxf disassemble.py:198, 238, 246). dxf-viewer ignores it too. So no reference implementation exists.
  **UNKNOWN / needs AutoCAD test** for all non-plan cases.
- Priority for truedxf: implement the projection correctly for lines, arcs and polylines with thickness (cheap:
  project the base curve, the top curve and the connectors). Treat the rest as a later refinement.

**VERIFIED-BY-ACAD** (AutoCAD 2027 PLOT, 2026-09-30; `ocs/thickness-skew`, `ocs/thickness-tilt-y45`,
`lines-curves/line-thickness-*`, `solids/solid-thickness-tilted`, `points/point-thickness-0001`, Q-0134, Q-0162,
Q-0185):
- LINE with thickness plots as the quad base + top (`+t·N̂`) + two connecting edges, also for WCS LINEs with
  210 = (1,0,0) in plan view (a 4-edge band outline of width |t|).
- CIRCLE/ARC with thickness: base and top curves plus a **generator line at every tessellation vertex** of the curve
  (40 generators for a 150 px circle in `thickness-skew`, 44 in `thickness-tilt-y45`: the count follows AutoCAD's
  view-dependent tessellation, see note 08 §10.3); arcs also get the end edges.
- SOLID/TRACE with thickness: a wireframe prism (bottom, top, four vertical edges), **never filled**.
- POINT with thickness: a 1-px line from P to P + t·N̂; the PDMODE symbol stays at the base point.
- ARC and CIRCLE (and HATCH) with 210 = (0,0,0) stay in the file (DXFOUT keeps 210 = 0,0,0) but are **not drawn**;
  LWPOLYLINE drops the zero vector on load (drawn as +Z), SPLINE and INSERT are drawn as +Z
  (`ocs/zero-extrusion-*`, Q-0124).

---

## 3. Entities

### 3.1 POINT

Group codes (spec:5946-5975; ezdxf entities/point.py):

| Code | Meaning | Default |
|---|---|---|
| 100 | AcDbPoint | |
| 10/20/30 | location (WCS) | 0,0,0 |
| 39 | thickness | 0 |
| 210 | extrusion (thickness direction and symbol plane) | 0,0,1 |
| 50 | "angle of the X axis for the UCS in effect when the point was drawn", used when PDMODE ≠ 0 | 0 |

Appearance is global: `$PDMODE` (int) and `$PDSIZE` (real) from the header. All POINTs look the same
(ezdxf docs/source/dxfentities/point.rst).

PDMODE = `style | frame`, with `style = PDMODE & 7` (LibreCAD uses `&7`, dxf-viewer `&0xF`, ezdxf `&7`) and
`frame = PDMODE & 0x60`:

| style | symbol |
|---|---|
| 0 | dot (a pixel-size dot, independent of PDSIZE) |
| 1 | nothing (only the frame, if any) |
| 2 | `+` |
| 3 | `×` |
| 4 | `'` short vertical tick from the center upward |

| frame bit | adds |
|---|---|
| 32 | circle |
| 64 | square |
| 96 | circle + square |

That gives the 20 valid values: 0-4, 32-36, 64-68 and 96-100. Mode 33 (circle, no mark) and 1 (invisible) are
common in the wild. LibreCAD adds non-DXF bits 128/256 for UI only (LibreCAD dxf_format.h:667-689).

Geometry (unit: `S = effective point size`, see PDSIZE below; `r = S/2`):

| element | ezdxf render/point.py | dxf-viewer DxfScene.js:713-745, 800-825 | LibreCAD rs_painter.cpp:265-325 |
|---|---|---|---|
| circle | radius r | radius r (15° tessellation) | octagon, radius r |
| square | ±r | ±r | ±r |
| `+` | arms ±**S** (total 2S) | arms ±**0.75·S** (±1.5·r) | ±S/2(?) |
| `×` | ends at (±S, ±S) | ends at (±r, ±r), i.e. the square corners | ? |
| tick | center → (0, r) | center → (0, r) | center → (0, −halfsize) in screen coords (= up) |

**CONFLICT** on the `+` and `×` lengths. From memory of the AutoCAD Point Style dialog, the `+` sticks out beyond the
circle and square, and the `×` reaches the square corners, which matches dxf-viewer. **UNKNOWN / needs AutoCAD test**:
plot PDMODE 34, 35, 66 and 67 at PDSIZE 10 and measure.

PDSIZE (LibreCAD dxf_format.h:691-702; ezdxf config.py:190-199):
- `> 0`: absolute size in drawing units. **ASSUMPTION**: S is the full symbol width, i.e. circle diameter = PDSIZE.
- `0`: 5% of the "drawing area" / viewport height.
- `< 0`: `|PDSIZE|` percent of the viewport height (LibreCAD: `deviceHeight · |pdsize| / 100`,
  rs_painter.cpp:1786-1798).
- So relative sizes are view-dependent. For a paper-space viewport, "viewport height" is presumably the model-space
  view height of that viewport. For a model-space plot it's presumably the plotted view.
  **UNKNOWN / needs AutoCAD test**: which height PLOT uses (display window, plot area, or viewport).
  ezdxf simply gives up ("relative point size is not supported", falls back to 1; frontend.py:147-149). dxf-viewer
  skips non-dot points with PDSIZE ≤ 0 (DxfScene.js:639-641).
- Point angle 50: ezdxf rotates the symbol by **−angle** ("The point angle is clockwise oriented",
  render/point.py:44-47) inside the plane given by 210. **UNKNOWN**: the sign. The spec wording suggests the symbol
  follows the UCS x-axis, i.e. +angle. Test with PDMODE 3 and angle 30.
- The symbol plane: ezdxf builds a UCS from the point's OCS axes (AAA of 210) at the location
  (render/point.py:40-44).
- Mode 0 dot: plotted as a dot of the entity's lineweight. **ASSUMPTION**: a zero-length line drawn with round caps.
  ezdxf emits a zero-length LINE (render/point.py:57).
- Defpoints: POINTs (and anything else) on layer `DEFPOINTS` are **never plotted** (well-known AutoCAD rule; ezdxf
  hides them by default, frontend.py:492-497). Cross-reference the layers/plot note.
- Extents: ezdxf uses only the location (disassemble.py:214-231). **UNKNOWN**: whether AutoCAD includes the symbol.

**VERIFIED-BY-ACAD** (AutoCAD 2027 PLOT, 2026-09-30; `points/*`, Q-0159…Q-0163, Q-0112, Q-0212). With the point size S
(below):
- `+` (2): arms ±S (total length 2S). `×` (3): two lines of length S from the centre along the diagonals (ends at
  ±S/√2). Tick (4): from the centre up to S/2. Circle (+32): radius S/2. Square (+64): half-side S/2. Mode 0 draws
  its dot together with the frames (32, 64, 96); mode 1 draws only the frames.
- S = PDSIZE for PDSIZE > 0. For PDSIZE = 0 S = 5 %, for PDSIZE < 0 S = |PDSIZE| % of **half the plotted view
  height** (plot window / extents height, not the *Active VPORT height: `pdsize-vport-0001…3` with VPORT heights
  50/150/600 plot identically; `pdsize-relative-0005` with a 300-unit window doubles S).
- The symbol lies in the plane of 210 (arbitrary axis algorithm) at the WCS location and is rotated by **−angle**
  (clockwise; `point-angle-0002/4`), i.e. ezdxf's sign.
- Inside blocks the symbol is transformed with the INSERT (non-uniform scale distorts circles into ellipses,
  `point-in-block-0001`). Relative sizes are measured in block units: S_block = S · |M⁻¹·(0,1)| with M the
  block → plot transform (`point-in-block-0002`, sx = 3, sy = 1, rot 30°).
- POINT dots and all symbol strokes are 1 px wide whatever the lineweight (`symbol-lineweight-*`,
  `dot-lineweight-*`).
- Extents include the symbol ($EXTMIN = −14.14 for PDMODE 35, PDSIZE 20 in `point-extents-0001`: the × arm ends).

### 3.2 LINE

spec:4972-5005: 100 AcDbLine, 39 thickness, 10 start (WCS), 11 end (WCS), 210 extrusion (thickness direction only).
- Zero-length line: AutoCAD plots a dot (with round caps if lineweight > 0). **ASSUMPTION**.
- Linetype patterns start at 10.

### 3.3 XLINE and RAY

spec:6088-6110, 7622-7640: 100 AcDbXline/AcDbRay, 10 base point (WCS), 11 unit direction (WCS). No thickness or
extrusion.
- XLINE is infinite both ways, RAY from 10 toward +11.
- Normalize 11 defensively (ezdxf validates non-null, entities/xline.py).
- Rendering: clip to the plot window, expanded by the maximum lineweight and a margin. Liang–Barsky / parametric slab
  clipping:
  ```
  P(t) = B + t·D  (in device/paper coordinates after the full transform; the transform is affine, so lines stay lines)
  for each slab (x in [xmin,xmax], y in [ymin,ymax]):
      if |D.x| < eps: reject if B.x outside, else continue
      t1 = (xmin − B.x)/D.x ; t2 = (xmax − B.x)/D.x ; order them; tEnter = max(tEnter,t1); tExit = min(tExit,t2)
  XLINE: tEnter starts at −∞, tExit at +∞ ; RAY: tEnter starts at 0
  draw if tEnter ≤ tExit
  ```
  Do the clipping **after** projecting to the device, or in WCS against the inverse-transformed window. With a 3D
  view, project first.
- ezdxf draws a finite line with a configurable `infinite_line_length = 20` drawing units (frontend.py:394-409,
  config.py:262). That's wrong for plots. LibreCAD intersects with the viewport rect (rs_painter.cpp:1804ff).
- Linetype phase: AutoCAD presumably starts the pattern at the base point (10) and runs it in both directions for
  XLINE. **UNKNOWN / needs AutoCAD test**: dashed XLINE, check the phase at the base point.
- Extents: XLINE and RAY **don't** affect extents or ZOOM Extents (Autodesk "About Construction Lines"; ezdxf maps
  them to EmptyPrimitive, disassemble.py:494-535). So a plot with "Extents" never considers them, and they're clipped
  to the extents-derived plot window.

### 3.4 CIRCLE

spec:3844-3870: 100 AcDbCircle, 39 thickness, 10 center (OCS), 40 radius, 210 extrusion. ezdxf adds 38 legacy
elevation.
- Radius ≤ 0 is "valid" (AutoCAD/BricsCAD accept it, ezdxf entities/circle.py:40). **UNKNOWN**: how it renders.
  Probably nothing, or a dot for 0. ezdxf uses `abs(radius)` when converting to a spline (entities/spline.py
  from_arc).
- WCS: `P(θ) = AAA(N) · (cx + r cos θ, cy + r sin θ, cz)`. With N = −Z the circle is mirrored in X (still a circle, but
  the center moves to `(−cx, cy)` and the linetype direction flips).
- Linetype start: AutoCAD starts the pattern at angle 0 of the OCS and runs CCW. **ASSUMPTION**; covered in the
  linetype note.
- **VERIFIED-BY-ACAD** (AutoCAD 2027, 2026-09-30; `lines-curves/circle-degenerate-*`, `degenerate-lw-*`,
  `fileformat/corpus-ezdxf-circle-radius-le-0`, Q-0130): a **negative** CIRCLE/ARC radius is repaired to **1** on
  load (DXFOUT writes 40 = 1; the ARC keeps its angles); radius 0 is kept. A CIRCLE with 210 = (0,0,0) plots in the
  XY plane around the WCS **origin** (centre collapses), an ARC with 210 = 0 is not drawn (`ocs/zero-extrusion-*`).

### 3.5 ARC

spec:3298-3320: AcDbCircle subclass (39, 10 center OCS, 40 radius), then 100 AcDbArc, 50 start angle, 51 end angle
(degrees), 210.
- It always runs **CCW about N** from 50 to 51. There's no "clockwise" flag; clockwise arcs are stored with N = −Z or
  with swapped angles.
- Span: `Δ = (end − start) mod 360`, taken into [0, 360).
- Full-circle rule: ezdxf treats `start ≡ end (mod 360)` with *different* raw values as a full 360°
  (e.g. 0→360, −180→180), and **identical** values as zero span (ezdxf math/_construct.py:190-215).
  **VERIFIED-BY-ACAD** (TrueView and BricsCAD, ezdxf#330): an ARC with start == end draws **only a point**. The same
  holds for ELLIPSE and hatch arc/ellipse edges (ezdxf#330).
  **UNKNOWN**: what AutoCAD does with 0 and 360 (different raw values, same mod 360). ezdxf says full circle.
  mlightcad realdwg-web#203 notes that writing 0/0 for a full hatch arc makes AutoCAD treat the hatch boundary as open.
- Endpoints: `S = C + r(cos a0, sin a0)` and `E = C + r(cos a1, sin a1)` in OCS, then AAA.
- Bounding box (OCS plane): start with S and E, then add each axis point `C ± r·x̂`, `C ± r·ŷ` whose angle (0, 90,
  180, 270) lies inside the span. For N ≠ ±Z, compute the WCS bbox from the WCS ellipse-like projection instead (see
  §6).
- **VERIFIED-BY-ACAD** (`lines-curves/arc-normalise-*`, Q-0131): angles are kept as written (DXFOUT keeps 30/450);
  0/360, −180/180, 30/450 and 0/720 plot a **full circle** (end − start ≥ 360°), 350/10 a 20° arc through 0°.

### 3.6 Arc-like primitives: common math

A circle or arc of radius r in any orientation projects to an ellipse in WCS/DCS. Keep one internal representation:
the **elliptical arc** `P(t) = C + cos t·U + sin t·V, t ∈ [t0, t1]`, where U and V are 3D vectors (not necessarily
orthogonal after projection). CIRCLE/ARC map to `U = r·Ax, V = r·Ay` and `t = angle`. ELLIPSE maps to
`U = major, V = minor`. After any affine transform (block scale, view, paper) you still have `C' = M·C, U' = M·U, V' = M·V`,
so it's exact under non-uniform block scaling too. Converting back to conjugate axes (Rytz) is only needed if you
want canonical axes; ezdxf has `rytz_axis_construction` (math/ellipse.py:556-599).

### 3.7 ELLIPSE

spec:4249-4290; ezdxf entities/ellipse.py:46-98:

| Code | Meaning | Default |
|---|---|---|
| 100 | AcDbEllipse | |
| 10 | center (WCS) | |
| 11 | major-axis endpoint **relative to the center** (WCS), i.e. the semi-major vector M | (1,0,0) |
| 210 | normal N (not an OCS, just the plane normal) | (0,0,1) |
| 40 | ratio = minor/major, valid `1e-10 ≤ |ratio| ≤ 1` ("tested with DWG TrueView 2022", ellipse.py:46-67) | 1 |
| 41 | start parameter (radians) | 0 |
| 42 | end parameter (radians) | 2π |

Parameterization (ezdxf math/ellipse.py:318-337, 495-510):

```
m̂ = normalize(N × M)              // minor axis direction
m = m̂ · |M| · ratio
P(t) = C + cos(t)·M + sin(t)·m      // t from 41 to 42, increasing = CCW about N
```

- The parameter isn't the polar angle. Conversions (ezdxf math/ellipse.py:526-553):
  `param = atan2(sin(angle)/ratio, cos(angle)) mod 2π` and `angle = atan2(sin(param)·ratio, cos(param))`.
- Full ellipse: 41 = 0 and 42 = 2π, detected as `span ≈ 2π`. Span rules are the same as ARC, using the same function
  (ezdxf math/construct2d.py:60-72): `span = (end − start) mod 2π`, equal raw values give 0 (a point, ezdxf#330), and
  congruent-but-different values give 2π.
- ezdxf param normalization: `start % τ`, and `end % τ` except when end ≈ τ (math/ellipse.py:375-384).
- Negative extrusion: with N = (0,0,−1) and M = (1,0,0), `m̂ = (0,0,−1)×(1,0,0) = (0,−1,0)`. Increasing t runs
  **clockwise** seen from +Z. The center and M are **not** mirrored (they're WCS). Don't apply AAA to ELLIPSE
  (ACadSharp#1228 explicitly keeps ellipses WCS).
- A negative ratio is accepted by ezdxf's validator (keeps its sign, ellipse.py:58-67). It would flip m, which is
  equivalent to flipping N. **UNKNOWN**: whether AutoCAD accepts it.
- Ratio > 1 is invalid. ezdxf's audit swaps the axes (entities/ellipse.py:304-319, math/ellipse.py `swap_axis`):
  `major' = old minor vector`, `ratio' = 1/ratio`, and `start' = (start − π/2) mod 2π`, `end' = (end − π/2) mod 2π`,
  except for a full ellipse. **UNKNOWN**: whether AutoCAD loads ratio > 1 at all.
- If N isn't perpendicular to M (bad data), the cross product still gives a perpendicular minor.
  **ASSUMPTION**: AutoCAD re-orthogonalizes the same way.
- Tangent: `P'(t) = −sin t·M + cos t·m`.
- Bbox: for each axis i, the extreme parameters are `t = atan2(m_i, M_i)` and `t + π`, with half-extent
  `sqrt(M_i² + m_i²)` for the full ellipse. For arcs, clip the candidate t values to the span.
- **VERIFIED-BY-ACAD** (`ellipses/param-2pi-*`, `param-0008`, Q-0166): end − start ≥ 2π plots the full ellipse
  (0 … 6.2831855 and 0 … 7 are full, not a tiny wrap-around arc).

### 3.8 SPLINE

#### 3.8.1 Group codes

spec:6291-6360, the Autodesk 2020 online DXF reference (same table), ezdxf entities/spline.py:67-120 and
ACadSharp:src/ACadSharp/Entities/Spline.cs:

| Code | Meaning | Default |
|---|---|---|
| 100 | AcDbSpline | |
| 210 | normal (omitted if non-planar) | (0,0,1) |
| 70 | flags, see below | 0 |
| 71 | degree (1..11 per ObjectARX per ezdxf spline.py:72; netDxf MaxDegree = 10) | 3 |
| 72 | number of knots | |
| 73 | number of control points | |
| 74 | number of fit points | |
| 42 | knot tolerance | 1e-7 (spec). ezdxf uses 1e-10 |
| 43 | control-point tolerance | 1e-7 |
| 44 | fit tolerance | 1e-10 |
| 12 | start tangent (WCS), optional | |
| 13 | end tangent (WCS), optional | |
| 40 | knot value, repeated | |
| 41 | weight, repeated. Present for all CPs, or not at all | 1 |
| 10 | control point (WCS), repeated | |
| 11 | fit point (WCS), repeated | |

- Counts 72/73/74 are 16-bit in DXF. netDxf doesn't write them ("AutoCAD does not use those values when importing",
  netDxf:IO/DxfWriter.cs:2654-2660). **Count the actual 40/10/11 tags** and don't trust the declared counts.
- Tangents equal to (0,0,0) are invalid, and ezdxf drops them on load (entities/spline.py:210-214). They should be unit
  vectors, but CAD apps tolerate non-unit ones (spline.py:83-84).
- Weights (41) may come before or after the control-point coordinates (netDxf:IO/DxfReader.cs:7881). A weight
  belongs to the control point it's interleaved with, in order. If the weight count ≠ CP count, ignore the weights
  (netDxf DxfReader.cs:7907-7912).

#### 3.8.2 Flag 70

| bit | meaning | source |
|---|---|---|
| 1 | closed | spec |
| 2 | periodic | spec |
| 4 | rational (weights present) | spec |
| 8 | planar | spec. ezdxf: "don't read or set, just ignore like AutoCAD" (spline.py:149-150) |
| 16 | linear (planar also set) | spec |
| 32 | knot parameterization: chord | netDxf SplineTypeFlags.cs:67-70 ("just a guess"), Autodesk forum "Splines in the DXF" (via web search) |
| 64 | knot parameterization: square-root chord | same |
| 128 | knot parameterization: uniform | same |
| 256 | knot parameterization: custom | same |
| 512 | CV frame visible (forum). netDxf calls it "Unknown" | **CONFLICT/UNKNOWN** |
| 1024 | defined by fit points (method = fit) | netDxf `FitPointCreationMethod`, Autodesk forum ("1161 = 1024+128+8+1: closed, planar, uniform, defined by fit points") |
| 2048 | closed periodic (netDxf `ClosedPeriodicSpline`) | netDxf only. **UNKNOWN** |

DWG side (libredwg:src/dwg.spec:2571-2668, include/dwg.h:2897-2906; ACadSharp SplineFlags1.cs):
- R2013+ has `splineflags1` with bits 1 = METHOD_FIT_POINTS, 2 = CV_FRAME_SHOW, 4 = CLOSED, and `knotparam`
  0 = chord, 1 = sqrt chord, 2 = uniform, 15 = custom.
- "scenario" 1 = control points, 2 = fit points.
- ACadSharp: if the knot parameterization is Custom or there are no fit points, the scenario is 1, otherwise 2
  (ACadSharp#613).
- libredwg writes DXF 70 = 8 + 32 + ((splineflags & ~5) << 7) for fit splines.
  **CONFLICT**: that mapping (CV frame → 256) doesn't match the forum mapping (512). Don't rely on bits > 16 for
  rendering. They're editing metadata.
- AutoCAD UI: a closed fit-point spline is always periodic, and an open one never is (ACadSharp#1029, DomCR tested in
  AutoCAD). A DWG can still contain a closed-but-non-periodic spline made by the control-point method.

#### 3.8.3 Which data to draw

1. **Control points present (73 > 0 / any 10 tags)**: draw the NURBS from CPs, knots and weights. AutoCAD writes CPs
   and knots even for fit-method splines, so this is the normal case. ezdxf prefers CPs whenever present
   (entities/spline.py:322-345). The fit points are only editing data.
2. **Only fit points** (files from other tools): construct a cubic interpolant (§3.8.6). "A SPLINE can be created
   just from fit points — knot values and weights are optional (tested with AutoCAD 2010)" (ezdxf
   docs/source/dxfentities/spline.rst).
3. Closed/periodic flags **don't change** the evaluation. **VERIFIED-BY-ACAD** (TrueView and BricsCAD, ezdxf#851):
   LibreCAD wrote an open clamped spline with only the closed flag set, and TrueView drew it open.
4. Knots: ezdxf rounds knots to `-log10(knot_tolerance)` decimal digits before building the curve
   (entities/spline.py:325-327, math/bspline.py:2074-2086). That merges near-equal knots into exact multiplicities,
   which matters for clamping and for Bézier decomposition. ezdxf also **normalizes** a knot vector whose first knot
   isn't 0 to [0,1] (math/bspline.py:905-907). Either is harmless for evaluation.

#### 3.8.4 Knot-vector conventions and periodic storage

- Standard: `#knots = #CP + degree + 1` (ezdxf math/bspline.py:287-308).
- Clamped (open uniform): `[0]*(p+1), 1, 2, …, n−p, [n−p+1]*(p+1)` (ezdxf `open_uniform_knot_vector`,
  bspline.py:368-391). The curve passes through the first and last CP.
- Uniform (unclamped): `0, 1, …, n+p+1` (bspline.py:349-365). The curve doesn't pass through the end CPs. The valid
  domain is `[u_p, u_{n+1}]`.
- **Periodic splines as written by AutoCAD**, from netDxf's reader and writer, which interoperate with AutoCAD
  (netDxf:IO/DxfReader.cs:7920-7943, DxfWriter.cs:2685-2697, Entities/Spline.cs:290-305):
  - The DXF holds `n + p` control points where the **first p repeat the last p** (netDxf writes the last p CPs first,
    then all n).
  - `#knots = n + 2p + 1`, which equals `(n+p) + p + 1`, the standard count for the wrapped CP list.
  - So a standard NURBS evaluator over `[knots[p], knots[len−p−1]]` draws periodic splines correctly with no special
    case. netDxf strips the p duplicates on read to get its "periodic" model, but truedxf doesn't need to.
  - ezdxf's own `set_closed` wraps the *first* p CPs at the end and uses a uniform knot vector. It notes "If the
    spline is periodic, the length of knot vector will be greater than length of the control array by 1, but this
    does not work with BricsCAD" (entities/spline.py `set_closed`).
- Evaluation domain: always `[U[p], U[m−p]]` with `m = #knots − 1`, for clamped and unclamped alike. ezdxf `params()`
  does exactly that (bspline.py:1052-1058). ezdxf `flattening()` iterates *all* unique knots from U[0]
  (bspline.py:1086-1101), which is out of domain for unclamped vectors, so don't copy that.
  netDxf/ACadSharp use `[U[0], U[last]]` for "closed" and `[U[p], U[last−p]]` for periodic
  (netDxf Spline.cs:688-704; ACadSharp Spline.cs:733-750). Also don't copy.

#### 3.8.5 NURBS evaluation: de Boor (rational, homogeneous)

```
input: degree p, knots U[0..m], control points P[0..n] (m = n+p+1), weights w[0..n] (default 1), parameter u
1. clamp u to [U[p], U[n+1]]
2. span k: largest k in [p, n] with U[k] ≤ u  (for u == U[n+1] take the last k with U[k] < U[k+1])
3. for j = 0..p:  d[j] = (w[k−p+j]·P[k−p+j], w[k−p+j])          // homogeneous 4D
4. for r = 1..p:
     for j = p down to r:
        i = k − p + j
        denom = U[i + p − r + 1] − U[i]
        α = denom == 0 ? 0 : (u − U[i]) / denom
        d[j] = (1 − α)·d[j−1] + α·d[j]
5. C(u) = d[p].xyz / d[p].w
```

Alternatives: basis functions by Cox–de Boor (NURBS Book A2.2, used by ezdxf math/_bspline.py:96-117 and A3.1
`Evaluator.point` 210-222). Rational basis = `N_i·w_i / Σ N_j·w_j` (ezdxf `span_weighting`, _bspline.py:118-126).
Derivatives: NURBS Book A2.3 / A4.2 (needed for tangents, offsets and adaptive flattening).

Span search: ezdxf uses a linear search when `knots[p] != 0` because binary search looped forever on a weird closed
spline (_bspline.py:74-94). Use a robust binary search over `[p, n]` with the end special case.

Bézier decomposition (knot insertion until every interior knot has multiplicity p) turns the spline into p-degree
Bézier segments (ezdxf `bezier_decomposition`, bspline.py:1230). That's useful for exact bbox and for emitting cubic
Béziers to vector backends. Rational Béziers can't be cubic paths exactly, so tessellate those.

#### 3.8.6 Splines from fit points only (AutoCAD/BricsCAD compatible)

Facts (ezdxf math/bspline.py:91-135 `fit_points_to_cad_cv`, ezdxf spline.py:62-65 citing the ObjectARX
`AcDbSpline::setFitData` docs):
- Degree is **always 3** for fit-point splines, whatever 71 says ("degree has no effect").
- Parameterization is **chord length** (the default in AutoCAD). The knot vector is "natural": the interior knots are
  the fit-point parameters themselves, clamped with p+1 zeros and ones.
- With start and end tangents (12/13): global interpolation with end-derivative constraints (NURBS Book 9.2.2), n+3
  control points. Tangent magnitudes are estimated as the **total chord length** of the fit polygon
  (`estimate_end_tangent_magnitude(..., "chord")`, math/parametrize.py:141-160).
- Without tangents: the 2 extra equations are **C''(0) = 0 and C''(1) = 0** (natural end conditions), per
  stackoverflow a/74863330 (ezdxf author). ezdxf `cad_fit_point_interpolation` (bspline.py:667-730) says "in the same
  way as AutoCAD and BricsCAD". It's visually verified by ezdxf's author (ezdxf#1280 compares with BricsCAD).
  Exact numeric agreement isn't claimed anywhere.
- Other parameterizations: the flag bits 32/64/128 (or DWG `knotparam`) say chord / sqrt-chord / uniform. ezdxf always
  uses chord. ACadSharp/netDxf `generateKnotValues` supports Chord, SquareRoot and Uniform (ACadSharp Spline.cs:660-705).
  **UNKNOWN**: whether AutoCAD, given only fit points plus flag 64/128, honours them. Implement all three and select by
  flag. Default to chord.
- Fit tolerance 44 > 0 means AutoCAD *approximates* (the curve passes within the tolerance) rather than interpolates.
  **UNKNOWN**: the algorithm. Fit-only files with 44 > 0 should be rare; treat them as interpolation.
- Closed fit splines (periodic): **UNKNOWN**: the construction. Presumably periodic cubic interpolation with C²
  wrap-around. Test.
- Two fit points: ACadSharp builds a straight cubic with CPs at 0, 1/3, 2/3, 1 (Spline.cs `straightLine`,
  ~line 880).

Algorithm (chord parameterization, n+1 fit points Q0..Qn, p = 3):

```
d_k = |Q_k − Q_{k−1}|,  L = Σ d_k,  t_0 = 0,  t_k = t_{k−1} + d_k / L,  t_n = 1       (parametrize.py:39-60)
   (sqrt-chord: use sqrt(d_k); uniform: t_k = k/n)
knots U = [0,0,0,0, t_1, …, t_{n−1}, 1,1,1,1]           // n+3 CPs, n+7 knots  (natural_knots_constrained)
unknowns P_0 … P_{n+2}
rows:
  C(t_k) = Q_k                         for k = 0..n          (row = basis vector N_{·}(t_k))
  with tangents (T_s, T_e unit, scaled by L):
    −P_0 + P_1          = (U[p+1]/p) · T_s·L                 // 1st derivative at 0
    −P_{n+1} + P_{n+2}  = ((1 − U[m−p−1])/p) · T_e·L         // 1st derivative at 1
  without tangents (C''=0), u1 = U[p+1], u2 = U[p+2]:
    f = p(p−1)/u1 ;  (f/u1)·P_0 − f(u1+u2)/(u1·u2)·P_1 + (f/u2)·P_2 = 0
    and symmetric at the end with (1−U[m−p−1]), (1−U[m−p−2])     (bspline.py:680-705, NURBS Book eq. 3.9/3.10)
order of rows: [C(t0), deriv/2nd-deriv start, C(t1..t_{n−1}), deriv/2nd-deriv end, C(tn)]
solve the banded (n+3)×(n+3) system per coordinate.
```

If only one tangent is given, ezdxf requires both before using them (entities/spline.py:334-336; it uses them only
if both are present). **UNKNOWN**: AutoCAD with a single tangent. Presumably the missing end gets C''=0.

#### 3.8.7 Other constructions ezdxf offers (for reference)

`global_bspline_interpolation` (averaged knots for even degree, natural for odd, bspline.py:159-243),
`local_cubic_bspline_interpolation` (NURBS Book 9.3.4), rational arc and ellipse to NURBS (`from_arc`/`from_ellipse`),
and `closed_uniform_bspline`. For HATCH spline edges with fit points only, ezdxf uses the same path
(path/converter.py:390-403).

#### 3.8.8 Tessellation of splines

- ezdxf: adaptive recursive subdivision. It starts with `segments` (default 4, min 16 in the pipeline) per knot span,
  splits while the curve midpoint's distance to the chord ≥ `distance` (sagitta), default 0.01 drawing units
  (bspline.py:1060-1110, disassemble.py:52, pipeline.py:633).
- dxf-viewer: `#CP × 4` uniform samples in the normalized parameter, **weights ignored**, fit-only splines not drawn
  (DxfScene.js:25-26, 2038-2057). Not accurate enough to copy.
- netDxf: fixed `precision` uniform samples (Spline.cs:595-720).
- Recommendation: Bézier-decompose, then flatten each segment adaptively in **device space** with sagitta tolerance
  ≤ 0.1 px (§5). The midpoint-sagitta test can miss inflections, so enforce a minimum of 2–4 subdivisions per span.

**VERIFIED-BY-ACAD** via DXFOUT (AutoCAD 2027, 2026-09-30; `splines/fit-*`, Q-0171…Q-0175): AutoCAD rebuilds every
interpolating fit-point SPLINE (fit tolerance 0) **from its fit points on load**: the §3.8.6 construction with
**chord-length** knots (`[0,0,0,0, d1, d1+d2, …, L,L,L,L]` unnormalized), natural ends C'' = 0 without tangents, one
end handled independently when only 12 or 13 is present, zero tangents ignored. The 70 bits 64/128 are **ignored**
(DXFOUT rewrites 70 = 1064 with chord knots) and so are **stored control points and knots** when fit points exist
(`fit-and-control`: the CVs are recomputed from the unrelated fit points). The tangent rows use the 12/13 vectors
**unnormalized**: P1 − P0 = (U[p+1]/p)·T·L with T as stored (tangent (5,5) → 142.4 = 28.48·5; `fit-tangents-0003`).
With fit tolerance 44 > 0 AutoCAD approximates (different knots, e.g. 90.33/161.98/233.83/319.04 instead of
85.44/157.55/229.66/310.28 for `fit-tolerance`); that algorithm is still open (Q-0177) — truedxf uses the stored
control points when present, else interpolates.

### 3.9 LWPOLYLINE

spec:5006-5057; ezdxf entities/lwpolyline.py:

| Code | Meaning | Default |
|---|---|---|
| 100 | AcDbPolyline | |
| 90 | number of vertices | |
| 70 | flags: 1 = closed, 128 = plinegen | 0 |
| 43 | constant width | 0 |
| 38 | elevation (OCS z of all vertices) | 0 |
| 39 | thickness (can be negative) | 0 |
| 10/20 | vertex x, y (OCS), one pair per vertex, **starts a new vertex** | |
| 91 | vertex identifier (R2010+, one per vertex, after 20) | |
| 40 | start width of the segment starting at this vertex | 0 (or 43) |
| 41 | end width of that segment | 0 (or 43) |
| 42 | bulge of that segment | 0 |
| 210 | extrusion | 0,0,1 |

Per-vertex attributes follow their 10/20 pair. 40/41/42 apply to the segment **from this vertex to the next**. The
last vertex's 40/41/42 only matter if closed (ezdxf docs/source/dxfentities/lwpolyline.rst:49-55).

- 43 vs 40/41. **CONFLICT**: spec says 43 is "not used if variable width (codes 40 and/or 41) is set". ezdxf
  found that "AutoCAD uses just const width if not 0, for all line segments" (lwpolyline.py comment,
  render/trace.py:558-563), while "BricsCAD uses const width only for missing width values". Follow AutoCAD: if 43 ≠ 0,
  every segment has width 43. **UNKNOWN**: whether 43 = 0 with 40/41 present follows the per-vertex values (surely yes).
- A single vertex: **UNKNOWN**. Probably a dot, or nothing.
- Duplicate consecutive vertices: skip zero-length segments (ezdxf LinearTrace merges them, trace.py `add_station`).
- Closed flag: add the segment last → first, using the last vertex's bulge and widths.
- `has_width`: any start or end width ≠ 0, or const_width ≠ 0. Such polylines render as filled bands (§4).
- Plinegen (128): the linetype pattern runs continuously over the whole polyline. Without it, each segment restarts
  the pattern. qcad: "if polyline has individual segment widths, polylineGen has no effect" (qcad
  src/core/RExporter.cpp:1533-1545; GPL, fact only). **UNKNOWN**: whether that holds in AutoCAD. Details go in the
  linetype note.

#### 3.9.1 Bulge math

Bulge `b = tan(θ/4)`, where θ is the included angle. `b > 0` is CCW (in OCS) from this vertex to the next, `b < 0` is
CW. `|b| = 1` is a semicircle and `b = 0` a straight segment (spec:7185-7188). A single bulge can't make a full circle,
since that would need b = ±∞.

Given `P1, P2, b ≠ 0`:

```
c      = |P2 − P1|                         // chord
θ      = 4·atan(b)                         // signed included angle
r      = c·(1 + b²) / (4·|b|)              // = c / (2·sin(|θ|/2))
s      = |b|·c/2                           // sagitta
M      = (P1 + P2)/2
n̂      = rot90ccw((P2 − P1)/c)             // left normal
h      = c·(1 − b²) / (4·b)                // signed distance midpoint→center along n̂
Center = M + h·n̂
a1     = atan2(P1 − Center)
a2     = a1 + θ                            // CCW if θ>0, CW if θ<0
```

Equivalent ezdxf formula (Lee Mac, math/bulge.py): signed radius
`r_s = c·(1+b²)/4/b`, direction `a = angle(P1→P2) + (π/2 − 2·atan(b))`, `Center = P1 + r_s·(cos a, sin a)`. For b < 0 it
returns swapped angles, so the arc is always reported CCW (`bulge_to_arc`, bulge.py:66-90).
dxf-viewer's version (DxfScene.js:426-470) is the same with `R = D/2/sin(θ/2)`.

Checks: b = 1 gives h = 0 (the center is the midpoint). 0 < b < 1 puts the center left of the chord for a CCW minor
arc, and b > 1 gives a major arc with the center to the right.

Inverse (ezdxf bulge.py): `b = tan(Δangle/4)`, and from radius and chord `b = x/(1+sqrt(1−x²))` with `x = c/(2r)`
(bulge.py `bulge_from_radius_and_chord`, ezdxf discussion #758).

Tessellation hazard: dxf-viewer draws bulges with `|θ| < 10°` as **straight chords** (DxfScene.js:428-431). For large
radii that's visibly wrong in a pixel-exact comparison, so always tessellate by sagitta.

### 3.10 POLYLINE / VERTEX / SEQEND (heavy polyline)

#### 3.10.1 POLYLINE header

spec:5976-6040:

| Code | Meaning | Default |
|---|---|---|
| 100 | AcDb2dPolyline / AcDb3dPolyline / AcDbPolygonMesh / AcDbPolyFaceMesh | |
| 66 | obsolete "entities follow" | ignore |
| 10/20/30 | dummy point: 0, 0, **elevation** (OCS for 2D, WCS for 3D) | |
| 39 | thickness | 0 |
| 70 | flags, see below | 0 |
| 40 | default start width | 0 |
| 41 | default end width | 0 |
| 71 | polymesh M vertex count; for polyface, the vertex count | 0 |
| 72 | polymesh N vertex count; for polyface, the face count | 0 |
| 73 | smooth-surface M density | 0 |
| 74 | smooth-surface N density | 0 |
| 75 | curve/surface type: 0 none, 5 quadratic B-spline, 6 cubic B-spline, 8 Bézier | 0 |
| 210 | extrusion | 0,0,1 |

Flags 70 (spec:6000-6012; ezdxf lldxf/const.py:269-277):
1 = closed (for a mesh: closed in M), 2 = curve-fit vertices added, 4 = spline-fit vertices added, 8 = 3D polyline,
16 = 3D polygon mesh, 32 = mesh closed in N, 64 = polyface mesh, 128 = linetype generated continuously (plinegen).
Type: 64 → polyface, 16 → polygon mesh, 8 → 3D polyline, otherwise 2D.

Polyface counts: "applications are not required to place correct values in these fields" (spec:6045-6050), so count
the vertices yourself.

#### 3.10.2 VERTEX

spec:7178-7250:

| Code | Meaning |
|---|---|
| 100 | AcDbVertex, then AcDb2dVertex / AcDb3dPolylineVertex / AcDbPolyFaceMeshVertex / AcDbFaceRecord |
| 10/20/30 | location (OCS for 2D, WCS for 3D and mesh). Always 0 in face records |
| 40 / 41 | start / end width (optional; otherwise the header's 40/41) |
| 42 | bulge |
| 70 | vertex flags: 1 extra curve-fit vertex, 2 curve-fit tangent defined, 4 unused, 8 spline vertex (created by spline fitting), 16 spline frame control point, 32 3D polyline vertex, 64 3D polygon mesh vertex, 128 polyface mesh vertex |
| 50 | curve-fit tangent direction (degrees, OCS) |
| 71–74 | polyface face vertex indices (1-based, negative = the edge *starting* at this vertex is invisible, 0 = unused) |
| 91 | vertex identifier |

Width resolution per vertex: use the vertex 40/41 if present, else the header 40/41 (ezdxf trace.py:571-590).

SEQEND ends the vertex list (spec:6183-6198). Its 330 points to the POLYLINE and it carries only common codes.

#### 3.10.3 Polyface mesh (flag 64)

spec:6040-6088, 7215-7245:
- Vertex records have flags `128 | 64` and real coordinates. Face records have flag `128` only (no 64), location 0,
  indices in 71–74.
- Indices are 1-based into the vertex records in order of appearance. `index < 0` means the edge from this vertex to
  the next face vertex is invisible. 0 ends the list. Faces have up to 4 vertices (PFACEVMAX = 4). Larger polygons are
  split into wedges with invisible interior edges.
- Face records can carry their own layer and color (62). Use them per face. **ASSUMPTION**: standard.
- Readers must tolerate faces interleaved with vertices (spec:6085-6088).
- Rendering in 2D wireframe: draw only the visible edges. When `$SPLFRAME = 1`, AutoCAD also shows the invisible
  edges. **ASSUMPTION**: same as the 3DFACE rule. ezdxf draws every face as a closed polygon and **ignores
  invisibility** (render/mesh.py:638-651, frontend.py:836-846), so it doesn't match AutoCAD.
  An edge shared by two faces is drawn twice. That's fine for opaque plotting but matters for transparency.

#### 3.10.4 Curve-fit and spline-fit 2D/3D polylines

Generated by PEDIT Fit / Spline. **AutoCAD stores the generated vertices**, so the renderer doesn't need to refit
(ezdxf render/r12spline.py:1-95 documents real AutoCAD files):
- **Curve-fit (70 & 2)**: the original vertices (flag 0, or 2 when a tangent is defined, with 50 = tangent) alternate
  with the **extra vertices** (flag 1). Every vertex has a bulge. So it's an arc-fit polyline and should be drawn like
  a normal bulged polyline over **all** vertices. The example "2D_FIT_CURVE_CLOSED.dxf" has vertex flags 0,1,0,1
  (r12spline.py:83-92).
- **Spline-fit (70 & 4)**: the vertices with flag 8 are the curve points (SPLINESEGS segments per span), and the
  vertices with flag 16 are the **frame control points**. They come after the curve vertices in the file (per
  r12spline.py). Draw only the flag-8 vertices as straight segments. Draw the flag-16 frame only when `$SPLFRAME = 1`.
  75 = 5 for quadratic, 6 for cubic, per `$SPLINETYPE`. For 3D polylines the flags are 8|32 and 16|32.
- **CONFLICT**: ezdxf PR #1317 (fixing ezdxf#1316, 2025) filters **both** flag 1 and flag 16 in the wide-polyline
  path (render/trace.py:414-437, 575). Dropping flag 1 (curve-fit extra vertices) contradicts the file structure
  above: the bulges of the remaining vertices then describe arcs to vertices that no longer exist. ezdxf's non-wide
  path (`make_path`) filters nothing, so it draws the frame too (path/converter.py:129-158).
  truedxf rule: skip 16 (unless SPLFRAME), keep 1 and 8. **Needs AutoCAD test**, see the test ideas.
- `$SPLINESEGS` (default 8, range −32768..32767) is the number of line segments per frame span when AutoCAD
  *generates* a spline fit. Negative values make AutoCAD arc-fit the result (BricsCAD SPLINESEGS help, via web
  search). Only relevant for regenerating missing vertices.
- `$SPLINETYPE` 5 = quadratic, 6 = cubic (default). `$SPLFRAME` 0/1.
- If a spline-fit polyline has **no** flag-8 vertices (made by a buggy writer), fall back to evaluating a uniform
  clamped B-spline of degree `75 == 5 ? 2 : 3` over the frame vertices. ezdxf R12Spline documents "open uniform" knots
  for open and "closed uniform" for closed (r12spline.py:15-60). **ASSUMPTION**.

#### 3.10.5 Polygon mesh (flag 16)

- `M × N` vertices (71 × 72), stored row-major: vertex index `m·N + n`. Draw the grid lines along M and N, plus the
  closing lines when flag 1 (closed in M) or 32 (closed in N) is set.
  ezdxf `from_polyface` builds (M−1)×(N−1) quads and **ignores the closed flags** (render/mesh.py:652-663).
- Smooth surfaces (75 = 5/6/8, surface fitted with PEDIT Smooth): **ASSUMPTION**. AutoCAD stores the M×N control
  vertices plus a fitted grid of `73 × 74` (SURFU × SURFV density) vertices, and displays the fitted grid unless
  SPLFRAME = 1. **UNKNOWN**: the vertex flags and order. Needs a sample file. Current libraries ignore it.

### 3.11 3DFACE

spec:3181-3215; ezdxf entities/solid.py:66-85:
- 10–13: four corners (WCS). All four must be present, or AutoCAD rejects the file (ezdxf solid.py:36-38). A triangle
  repeats the third corner.
- 70: invisible edges. 1 = edge 1 (v0→v1), 2 = edge 2 (v1→v2), 4 = edge 3 (v2→v3), 8 = edge 4 (v3→v0).
- Vertex order is natural (0-1-2-3), **not** the SOLID order.
- Rendering in 2D wireframe: edges only, **never filled**. Skip invisible edges unless `$SPLFRAME = 1`.
  **ASSUMPTION**: the documented SPLFRAME behaviour. ezdxf draws visible edges only (frontend.py:516-537).
- In shaded or hidden plots the face is opaque. Out of scope.

### 3.12 SOLID and TRACE

spec:6239-6290, 7068-7118; ezdxf entities/solid.py:32-65, 134-163:
- 10, 11, 12, 13: four corners (OCS), all required. A triangle has 13 = 12. 39 thickness, 210 extrusion, legacy 38.
- **Draw order 1-2-4-3** (v0, v1, v3, v2), so a square is stored "Z-shaped" as 0-1-3-2 (ezdxf solid.py:57-58,
  156-160).
- A triangle (v3 == v2) is drawn as the triangle v0, v1, v2 (ezdxf drops the duplicate; solid.py:152-154).
- Fill: SOLID and TRACE are filled when `$FILLMODE = 1` (header default 1). With `FILLMODE = 0` only the outline is
  drawn (AutoCAD FILL command: "hatches, fills, 2D solids and wide polylines"). **ASSUMPTION**: PLOT honours the
  FILLMODE value stored in the file, as regenerated. ezdxf **ignores FILLMODE** (no reference in the drawing add-on).
- Self-intersecting quads (the user entered 1-2-3-4 around the perimeter, so 1-2-4-3 makes a bow-tie):
  **ASSUMPTION**: AutoCAD fills the two triangles (v0,v1,v2) and (v1,v3,v2), their union. This follows from the SOLID
  command's "third point diagonally opposite the second" construction. **UNKNOWN / needs AutoCAD test**: bow-tie fill
  (union vs even-odd).
- Fill color is the entity color. Lineweight also applies to the outline. **ASSUMPTION**: the filled area also gets a
  lineweight-wide outline stroke in plots, so solids come out slightly larger than their geometry.
  **Needs a test**: that's measurable pixel by pixel.
- TRACE is identical to SOLID (the legacy TRACE command produced it). ezdxf `Trace(Solid)`.

**VERIFIED-BY-ACAD** (AutoCAD 2027 PLOT, 2026-09-30; Q-0183, Q-0184, Q-0185):
- The fill is the polygon v0, v1, v3, v2 (the drawing order) filled as is: a crossed order gives a **bow tie** (two
  triangles meeting at the crossing, `solids/solid-polygon-order-fill1`), a concave one keeps its notch
  (`solid-concave-fill1`). The ASSUMPTION of the union of (v0,v1,v2) and (v1,v3,v2) is wrong.
- Only a SOLID/TRACE whose plane faces the view (normal ∥ view direction) is filled. Any tilt, even 210 =
  (0.01, 0.01, 1) (below the 1/64 arbitrary-axis threshold), plots the **outline** only (`ocs/solid-small`,
  `solid-threshold`, `solid-tilt-*`, `solid-edge-on`). With thickness: wireframe prism (§2.6).
- `$FILLMODE = 0`: SOLID, TRACE and wide polylines plot as outlines, a solid HATCH plots **nothing**
  (`solids/fillmode-mixed-0`).
- 3DFACE: invisible edges (70) are hidden and **shown with `$SPLFRAME = 1`** (`solids/3dface-nonplanar`, Q-0189).

### 3.13 HELIX

spec:4625-4672; ezdxf entities/helix.py:28-75:
- HELIX **contains a complete AcDbSpline subclass** (all spline codes, control points, knots). Then comes
  `100 AcDbHelix`: 90 major release (29), 91 maintenance release (63), 10 axis base point, 11 start point, 12 axis
  vector, 40 radius (**top** radius; the base radius is `|start − base|`), 41 turns, 42 turn height,
  290 handedness (0 left, 1 right; default 1), 280 constrain (0 turn height, 1 turns, 2 height).
- Rendering: just evaluate the embedded spline (ezdxf `Helix(Spline)`; path converter registers Helix with Spline).
  The helix parameters are only for editing.
- ezdxf docs note that a DWG named Helix.dwg may not contain DWG_TYPE_HELIX (LibreDWG#1156, not important).

### 3.14 MESH (AcDbSubDMesh, R2010+)

spec:5058-5118; ezdxf docs/source/dxfinternals/entities/mesh.rst:
- 71 version (2), 72 blend crease (0/1), 91 subdivision level, 92 vertex count (level 0), then 10 vertices (WCS).
- 93 is the face-list size: the **count of 90 tags**, not the face count. The list is `[n, i1..in]` repeated
  (n-gons allowed, 0-based indices).
- 94 edge count (the real count), then 2×90 per edge. 95 crease count (= edge count), then 140 crease per edge.
- Then 90 override count with 91 sub-entity marker, 92 property count and 90 property type
  (0 color, 1 material, 2 transparency, 3 material mapper), undocumented further.
- The file stores the **level-0 control cage**. When 91 > 0, AutoCAD displays and plots the **subdivided smooth
  surface**. A crease equal to the level (or −1 = "always"? **UNKNOWN**) prevents smoothing of that edge (mesh.rst).
  **ASSUMPTION**: the subdivision is Catmull–Clark (quads). Needs verification before matching smoothed meshes.
- ezdxf draws the level-0 faces as closed polygons (frontend.py:824-834), i.e. not what AutoCAD shows for level > 0.
- 2D wireframe: presumably draws the edges of the subdivided faces. Plot of a MESH in plan: the edges.
  **UNKNOWN**: whether facet edges or only the "smooth" isolines are drawn.

VERIFIED-BY-ACAD (misc suite, 2026-09-30): the 2D-wireframe plot of a MESH shows the **level-0
cage edges only**; at subdivision level L > 0 those edges follow the Catmull-Clark surface after L
steps (our CC matches `mesh-box-level1-plan` exactly, levels 2/3 within a few pixels); the finer
facet edges are not drawn. Crease -1 keeps an edge sharp; semi-sharp creases are close but not
pixel-exact yet (`mesh-crease-*`).

### 3.15 REGION, 3DSOLID, BODY, SURFACE family (ACIS)

VERIFIED-BY-ACAD (misc suite, 2026-09-30): 2D-wireframe PLOT draws every ACIS edge (a box: all 12
edges, hidden ones included; no isolines for planar faces), for SAT (R2000-R2010) and SAB (R2013+,
ACDSDATA `ASM_Data`) alike (`solid-box-*`, `region-square-*`, `body-box-plan`); truedxf parses both
(render/src/draw/acis.ts).

Group codes (spec:3229-3250, 6112-6135, 6412ff; ezdxf entities/acis.py):
- `100 AcDbModelerGeometry`, 70 modeler format version (1), then **1** for SAT text lines (< 255 chars) and **3** for
  continuation lines (optional).
- 3DSOLID adds `100 AcDb3dSolid`, 350 history handle. SURFACE adds `100 AcDbSurface`, 71 U isolines, 72 V isolines.
  Extruded, lofted, revolved and swept surfaces add many parameters (ezdxf acis.py:356-420; spec:6438-6660).
- **R2013+ (AC1027+)**: codes 1/3 are gone and **290 (flag) and 2 (uid GUID)** appear instead. The ACIS data is stored as
  **SAB** (binary) in the **ACDSDATA** section, as an `ACDSRECORD` whose `AcDbDs::ID` (320) references the entity
  handle and whose `ASM_Data` record holds `94` (byte count) + `310` binary chunks (ezdxf acis.py:55-77).
  ezdxf loads it on demand via `doc.acdsdata.get_acis_data(handle)`.
- SAT "encryption" for R2000–R2010 DXF (ezdxf tools/crypt.py): every character c except space (0x20) becomes
  `chr(159 − ord(c))`. ezdxf implements it as a table plus `c ^ 0x5F`, which is equivalent for printable ASCII, e.g.
  `'^'(0x5E) ↔ 'A'`, `'@' ↔ '_'`. ezdxf has one quirk: after decoding 0x5E ('A') it **skips the following character**,
  and the encoder appends a space after 'A'. Confirmed on AutoCAD-written data (ACadSharp `sample_AC1015_ascii.dxf`,
  REGION D69: `^ *+0\^ [` decodes to "AutoCAD" only when the space after each encoded 'A' is dropped;
  line 2 decodes to `16 Autodesk AutoCAD 20 ASM 230.7.0.65535 NT 0`), 2026-09-30.
- SAT versions: the first line is e.g. `700 0 1 0` (version 7.0). SAB starts with `ACIS BinaryFile`. The format is the
  proprietary Spatial ACIS format. ezdxf's `acis` package parses both (acis/sat.py, sab.py) and can build
  **meshes only from flat polygonal faces**. Curved surfaces need an ACIS kernel (ezdxf acis/mesh.py:12-36).
- What AutoCAD shows in 2D wireframe: REGION shows its boundary edges. 3DSOLID shows edges plus **isolines** (`ISOLINES`
  sysvar, default 4) on curved faces. SURFACE shows U/V isolines (71/72). Hidden or shaded plots show tessellated faces
  (FACETRES).
- What a renderer can realistically do:
  1. **REGION** (planar): parse the SAT/SAB edge records (`straight-curve`, `ellipse-curve`, `intcurve-curve` = spline,
     `edge` with parameter range and `coedge` sense) and draw the edges. That's feasible, since the regions are
     planar and the curves are lines, arcs and splines. Filled display of regions doesn't apply in 2D wireframe
     plots. **ASSUMPTION**: REGIONs plot as outlines.
  2. **Polyhedral 3DSOLID/BODY** (all faces planar): draw the edges from the SAT topology (ezdxf's approach).
  3. **Curved solids and surfaces**: edges are feasible (circles, ellipses and splines exist in SAT as curves).
     Isolines need surface definitions (cone, sphere, torus, spline surface) and the isoline logic. That's a big
     project. **UNKNOWN**: the exact isoline placement.
  4. Proxy graphics: AutoCAD does **not** write proxy graphics for native ACIS entities. **ASSUMPTION**: 92/310
     are absent on 3DSOLID. So there's no free fallback.
  5. v1 plan: draw REGION edges and polyhedral edges. For everything else draw nothing, report "unsupported", and
     record it in the render diagnostics.

### 3.16 SHAPE

spec:6199-6238; ezdxf entities/shape.py: 39 thickness, 10 insertion point (WCS vs OCS **CONFLICT**, §2.4),
40 size, 2 shape name, 50 rotation, 41 x scale, 51 oblique, 210 extrusion.
- It needs the SHX shape file. That's found through a STYLE table entry with flag 1 (shape file) whose font file
  contains the named shape. Rendering reuses the SHX engine from the text/font note.
- Size 40 scales the shape's defined height. **UNKNOWN**: the exact scaling vs the shape's own "above" value. Rare in
  practice. Complex linetypes use shapes too (linetype note).

### 3.17 Proxy graphics (fallback for custom and unknown entities)

- Present on ACAD_PROXY_ENTITY and on many custom (ObjectARX) entities as 92/160 + 310 (spec:3256-3296;
  ezdxf dxfgfx.py:200-212).
- Binary little-endian: an 8-byte header (total size u32, command count u32), then records
  `size u32 (incl. header), type u32, payload` (ezdxf proxygraphic.py:250-300).
  Types (ezdxf proxygraphic.py:208-247): 1 extents, 2 circle, 3 circle-3p, 4 circular arc, 5 arc-3p, 6 polyline,
  7 polygon, 8 mesh, 9 shell, 10 text, 11 text2, 12 xline, 13 ray, 14 color, 16 layer, 18 linetype, 19 marker,
  20 fill, 22 true color, 23 lineweight, 24 ltscale, 25 thickness, 26 plot style name, 27/28 push/pop clip,
  29/30/31 push/push2/pop matrix, 32 polyline with normals, 33 lwpolyline, 34 material, 35 mapper,
  36 unicode text, 38 unicode text2, 44 elliptic arc.
- ezdxf policy: draw proxy graphics for unsupported entities, optionally "prefer" them (frontend.py:358-392).
- Belongs in its own note if we implement it. Listed here as the fallback path.

---

## 4. Wide polylines (LWPOLYLINE / 2D POLYLINE with widths)

### 4.1 AutoCAD behaviour (what is known)

- Each **straight segment** is a quadrilateral. Its offset lines sit at ±w(s)/2 perpendicular to the segment, with
  the width interpolated linearly from the start width (at the segment start) to the end width. That gives tapering.
  ezdxf `_normal_offset_points` (trace.py:260-272).
- **Joints between consecutive straight segments are mitered**: the left and right offset lines of adjacent segments
  are intersected (ezdxf LinearTrace.faces, trace.py:176-257). ezdxf skips the miter (uses the unmitered corner) when
  the two directions are within 0.031415 rad (≈1.8°) of parallel or antiparallel (trace.py:200-208).
  **UNKNOWN**: whether AutoCAD has a miter limit for very sharp angles (spikes). **Needs a test** with a 5° zig-zag.
- Open ends are cut **perpendicular** to the first and last segment (butt, no caps). A closed polyline miters the
  closing joint too (trace.py:219-231; `TraceBuilder.close()` merges the first and last linear traces,
  trace.py:520-533).
- **Arc segments (bulge)**: an annular sector, `r ± w(θ)/2`, with the width interpolated linearly along the arc
  (ezdxf CurvedTrace.from_arc uses linspace over angles, trace.py:346-385). Its ends are cut **radially**, i.e.
  perpendicular to the curve. ezdxf doesn't miter between an arc and a line: each arc is a separate sub-polygon
  (trace.py:604-640). If the joint is tangent-continuous that's seamless. If it isn't, there's a notch or overlap.
  **UNKNOWN**: whether AutoCAD miters line–arc joints. **Needs a test**.
- `w/2 > r` (width larger than the diameter): the inner radius goes negative. **UNKNOWN**: AutoCAD's result
  (probably a self-overlapping fan).
- The fill is solid, in the entity color, when FILLMODE = 1. With FILLMODE = 0 only the outline is drawn.
  **UNKNOWN**: whether that's the outline of each segment quad (with cross-lines at the vertices) or just the overall
  outline. Test.
- Linetypes on wide polylines: **ASSUMPTION**, from common AutoCAD observation: the dash pattern cuts the band into
  dashed wide pieces. qcad ignores linetype for wide polylines (RExporter.cpp:1538-1541). Test.
- Lineweight on wide polylines: **UNKNOWN**. Is the band outline additionally stroked with the lineweight? Test.
- Constant width 43 overrides everything in AutoCAD (§3.9). Zero widths everywhere means a normal thin polyline
  (lineweight applies).
- Mixed widths: a polyline where some segments have width 0 and others don't. The zero-width segments are hairlines
  (or lineweight), the others bands. **ASSUMPTION**: AutoCAD draws zero-width segments as normal lines.
- Thickness + width: a 3D slab. Out of scope for plan views.

**VERIFIED-BY-ACAD** (AutoCAD 2027 PLOT, 2026-09-30; `polylines/*`, Q-0147, Q-0150, Q-0151, Q-0152, Q-0153, Q-0154):
- Joints between straight band segments are mitered only when the widths meet (end width of one segment = start
  width of the next) and the joint is not too sharp; otherwise both bands simply end with their perpendicular cut
  at the vertex. `width-arrow` (3 → 15 step): no miter, the arrow head starts square at the vertex;
  `miter-angle-0002` (30° joint): mitered (tip 1/sin 15° half-widths out); `miter-angle-0003` (5°) and
  `width-hairpin` (7.2°): not mitered; 1° (`miter-angle-0004`): not mitered. The limit lies between 7.2° and 30°
  (truedxf: miter while the miter length ≤ 10 half-widths ≈ 11.5°, UNVERIFIED in between).
- Arc segments: widths are **clamped to the arc diameter 2r** before tapering linearly along the angle, so the inner
  radius never goes negative: r = 2, w = 6 plots a half disk of radius 4 (`ring-semicircle-w6`); a 0 → 8 taper on
  r = 2 plots like 0 → 4 (`ring-semicircle-taper`). Tapered arcs have radial end cuts (`taper-arc-*`).
- Negative widths: per-vertex 40/41 = −4 plot as width 4 (absolute value, `width-negative-width`); a negative
  constant width 43 = −1 plots as width 0 (hairline, `width-const-negative`).
- Line–arc joints are not mitered (`joins-line-arc`, `width-mixed-bulge` match without miters).
- Linetypes on wide polylines: every dash is a **piece of the band** between its arc-length positions on the
  centre line, with the widths interpolated along the segment and a miter where a dash runs over a vertex
  (`linetypes/pl-wide-const-gen*`, `pl-wide-taper-gen*` match; `pl-wide-bulge-gen*` shows a small dash phase drift
  on wide arcs, open). **PLINEGEN is ignored for polylines with tapered segments** (`pl-wide-taper-gen1` plots
  pixel-identical to `-gen0`, as the AutoCAD docs say).
- `$FILLMODE = 0`: outlines of the band pieces; tapered arcs show a radial rung at every tessellation step
  (`polylines/fillmode-0`; truedxf draws only the outer outline, open).
- Polyface meshes: each face plots with its **face record's own properties** (62 of the face VERTEX, not of the
  POLYLINE or of the position vertices, `polyface-face-colors`, Q-0145); negative indices hide edges unless
  `$SPLFRAME = 1` (`polyface-invisible-splframe`, Q-0189); index 0 = unused corner.

### 4.2 ezdxf implementation summary (reference)

`TraceBuilder.from_polyline` (render/trace.py:537-646):
1. Collect `(location, start_width, end_width, bulge)`. For LWPOLYLINE a non-zero const width replaces both widths.
   For POLYLINE a vertex width falls back to the header default and flag-1/16 vertices are filtered (see the
   §3.10.4 CONFLICT).
2. If closed, append the first point again.
3. Walk the vertices. Runs of straight segments go into a LinearTrace. Each bulge segment becomes its own CurvedTrace
   (`segments` = `circle_approximation_count // 2` = 64 for a full circle, at least 3, trace.py:346-385;
   frontend.py:863-865).
4. Each trace becomes one polygon: the forward contour of down-side points plus the reversed up-side points
   (trace.py:50-68). Each polygon is filled separately (frontend.py:866-878), so overlapping sub-polygons overdraw.
   That's harmless for opaque fills but wrong with transparency.
5. Widths on arcs: when the bulge is negative, `bulge_to_arc` swaps start and end, so ezdxf swaps the widths
   (trace.py:617-622).

truedxf should build the band outline the same way, but tessellate arcs by device tolerance and union the pieces
into one fill path (nonzero rule) so transparency is correct.

---

## 5. Tessellation and approximation

### 5.1 Facts

- **VIEWRES** (range 1–20000, default 1000; "circle zoom percent") controls how many vectors AutoCAD uses to
  *display* circles, arcs, splines and arced polylines in the current viewport. It's per viewport and a display
  setting (Autodesk VIEWRES help 2020).
- Display settings don't affect plotting. "Even with 5 your arcs will be printed as arcs" (Autodesk forum
  "Why do Curves/circles keep turning to polygons?"). Objects plot smooth at any plot quality better than draft
  (cadac/forum summary). A PDF user reported polygonal arcs in PDF even with VIEWRES 20000. That points to the PDF
  driver's own vector resolution (DWG To PDF.pc3 "vector quality" DPI) being what matters there.
- So PLOT tessellates (or emits true curves) per output device. For raster plotters (PublishToWeb PNG/JPG, Raster
  File Format drivers) curves are presumably generated at the device resolution. **UNKNOWN**: the chord tolerance
  AutoCAD's raster driver uses (sub-pixel?), and whether it uses arcs directly (HP-GL/2 and PDF can).
- `$SPLINESEGS` only affects *generating* spline-fit polylines (§3.10.4). SPLINE entity display uses VIEWRES-like
  adaptive logic. **UNKNOWN**: the details.
- `FACETRES`/`ISOLINES` affect solids (§3.15).
- `WHIPARC` affects DWF only (not relevant).

### 5.2 Library heuristics (for comparison, not to copy)

| Library | Circles/arcs | Bulges | Splines |
|---|---|---|---|
| ezdxf drawing | `make_path`: arcs → cubic Béziers (≤90° each), flattened by sagitta `max_flattening_distance` = 0.01 drawing units by default (disassemble.py:52, config.py:230-266; "backends should use ~1 pixel converted to drawing units") | same path, `segments=1` | adaptive, ≥`segments` per span (bspline.py:1060) |
| ezdxf wide polylines | `circle_approximation_count` = 128 per full circle, arcs get 64 × span/360, min 3 (config.py:267, frontend.py:863) | | `segments` evenly |
| dxf-viewer | `arcTessellationAngle` = 10°, `minArcTessellationSubdivisions` = 8 (DxfScene.js:3057-3061) | chord if `|θ| < 10°`, else ⌊θ/10°⌋ (min 8) (DxfScene.js:426-470) | `#CP × 4` uniform samples, no weights (DxfScene.js:25-26, 2038-2057) |
| netDxf | fixed `precision` count | | fixed `precision` uniform samples (Spline.cs:595-720) |

### 5.3 What precision truedxf needs

- Target: pixel-identical raster output vs AutoCAD PLOT at, say, 1× or 2× device DPI. Polyline approximation of a
  curve differs from the true curve by at most the sagitta `s = r·(1 − cos(Δθ/2))`. With AA off (AutoCAD raster
  plotters are typically aliased; **UNKNOWN**, see the plot note), pixels flip when the curve crosses a pixel center.
  To stay below one pixel of disagreement anywhere, the sagitta must be well below 0.5 px. Aim for **≤ 0.1 px**
  (≤ 0.05 px if cheap).
- Segment count for a circular arc of device radius r_px, span Δ:
  `n = ceil( Δ / (2·acos(1 − tol/r_px)) )`, with `tol = 0.1` px. For a full circle at tol 0.1 px: r = 100 px gives
  about 71 segments, r = 1000 px about 222, and r = 10 000 px about 703. For large r this grows like
  `π·sqrt(r/(2·tol))`.
- Always compute in **device space**, after the full transform, including non-uniform block scaling (which turns
  circles into ellipses, §3.6), view and plot scale. Clip first (cull invisible arcs) so huge radii stay cheap.
- For ellipses and splines use adaptive subdivision on the transformed curve (midpoint sagitta + minimum splits),
  or Bézier-decompose and use a standard Bézier flattening with tolerance.
- Linetype dashes along curves need **arc length** parameterization. Compute on the tessellated polyline with a finer
  tolerance, or with exact arc length for circular arcs. See the linetype note.
- Rasterization rules (pixel centers, line caps, lineweight rounding) matter more than the tessellation tolerance
  once the tolerance is ≤ 0.1 px. Those belong in the plot/raster note.
- **UNKNOWN**: does AutoCAD's raster plotter tessellate arcs with a *coarse* fixed resolution (visible facets on huge
  circles)? If so, we'd have to *imitate* the faceting. Test idea: plot a circle of radius ≈ 5000 px to PNG and look
  for facets.

---

## 6. Bounding boxes and extents

### 6.1 Per entity

| Entity | Exact bbox (WCS) | Pitfalls |
|---|---|---|
| POINT | location (+ thickness end) | PDMODE symbol ignored by ezdxf (disassemble.py:230). AutoCAD **UNKNOWN** |
| LINE | endpoints (+ endpoints + t·N̂ if thickness) | |
| XLINE/RAY | **excluded** from extents | Autodesk; ezdxf EmptyPrimitive |
| CIRCLE | center ± r along the WCS projection: for the WCS axis i, half-extent `r·sqrt(Ax_i² + Ay_i²)` | Apply the OCS first (ACadSharp#1224: mirrored circles boxed at the wrong X) |
| ARC | endpoints + extreme points inside the span | bjnortier-dxf#47 used the full circle box, too big |
| ELLIPSE | §3.7 formula; for arcs use the extreme params within the span | WCS, don't apply AAA (ACadSharp#1228) |
| SPLINE | **curve**, not the control polygon | The control polygon hull is a conservative superset. ixmilia-dxf#135 used fit + control points ("overly large"). Exact: Bézier-decompose and solve derivative roots per axis, or flatten finely. ezdxf `fast=True` uses control points (bbox.py:103-104) |
| LWPOLYLINE/2D POLYLINE | vertices + bulge-arc extremes, in OCS, then AAA; with width, the band outline | ezdxf uses the trace mesh when `has_width` (disassemble.py:197-212) |
| 3D POLYLINE, mesh, polyface | all vertices | invisible edges still count (**ASSUMPTION**) |
| 3DFACE/SOLID/TRACE | 4 corners (SOLID/TRACE in OCS → AAA; ACadSharp#1228) | thickness TODO everywhere |
| HELIX | spline curve | |
| MESH | level-0 vertices (a superset of the subdivided surface, **ASSUMPTION**: CC surface lies within the cage hull) | |
| REGION/3DSOLID | needs ACIS; fall back to "unknown" | |
| TEXT/MTEXT | glyph geometry, not the insertion point | See the text note. ezdxf TextLinePrimitive uses font metrics |
| INSERT | union of transformed block content (recursive), attributes | Use exact curve boxes after transform, not transformed boxes (rotated boxes grow) |
| HATCH | boundary paths (OCS + elevation → AAA) | ACadSharp#1228 |

For arcs and ellipses after an arbitrary affine map M: with `U' = M·U, V' = M·V`, the extreme parameter for axis i is
`t = atan2(V'_i, U'_i)` (+π), filtered by the span. That's exact.

### 6.2 Layout extents, $EXTMIN/$EXTMAX, plot "Extents"

- `$EXTMIN/$EXTMAX` (model space) and `$PEXTMIN/$PEXTMAX` (active paper space), plus per-layout values in the LAYOUT
  object. They're only as fresh as AutoCAD's last update. ezdxf doesn't maintain them, and the defaults are
  (+1e20…)/(−1e20…) (ezdxf docs/source/concepts/extents_limits.rst). Treat them as **hints only**. Files written
  by other tools often carry stale or default values.
- AutoCAD's stored extents may be **stale-large**: they can lag behind erasures until a regen or ZOOM Extents.
  **ASSUMPTION**: common knowledge.
- PLOT with plot area "Extents": "plots the portion of the current space of the drawing that contains objects… AutoCAD
  may regenerate the drawing to recalculate the extents before plotting" (Autodesk Plot Dialog Box help 2016-2018).
  So truedxf must **compute** extents itself, and in the same way AutoCAD does, because the plot window (and thus
  every pixel) depends on it.
- **UNKNOWN / important**: exactly what AutoCAD's recalculated extents include.
  - Frozen or off layers? Probably excluded when frozen. What about off?
  - Invisible (60 = 1)?
  - Defpoints (not plotted, but probably still in extents).
  - Lineweight width? Probably not.
  - Text: the glyph box or the text box?
  - Spline: curve or hull?
  - Points: the symbol size?
  - Hatch pattern lines vs the boundary?
  Each of these is a test in the backlog.

**VERIFIED-BY-ACAD** via DXFOUT $EXTMIN/$EXTMAX of the Extents probes (AutoCAD 2027, 2026-09-30; `extents/probe-*`,
Q-0107…Q-0118): extents **include** entities on off, no-plot and Defpoints layers (incl. DIMENSIONs on Defpoints),
the thickness top of extruded LINEs, the full band of wide polylines, the PDMODE symbol, the SPLINE curve (not its
control hull) and a pattern HATCH's boundary (not its pattern lines — truedxf adds every loop's flattened points
in the extents pass, render/src/draw/hatch.ts, also for too-dense hatches that plot nothing and, ASSUMPTION, with
FILLMODE 0; `extents/probe-hatch-pattern` F1 0.001 → 0.16, the rest is the open padding rule below); they **exclude** invisible (60 = 1) entities,
frozen layers, 3DFACE vertices touched only by invisible edges and lineweight widths. The plotted Extents area is
slightly larger than $EXTMIN/$EXTMAX (e.g. 20 × 10 extents → "Effective plotting area: 2000.00 wide by 1004.45 high"
at 99 px/unit instead of 100); that padding rule is open. 2026-10-01 probes (note 08 §10.15,
local suite `extents-probes`): it does not depend on excluded entities but on the *Active VPORT
and the extents' position in it — edges move outward to a grid of 5/32768 half-views for view
height 1000/3000, other rules for other heights; not implemented.

**Text (VERIFIED-BY-ACAD 2026-10-01)**: TrueType TEXT and MTEXT count with their **font cell box**, not the
ink: per line [pen start, advance end] × [baseline − hhea descender, baseline + hhea ascender]
(`extents/probe-text-xxx`: TEXT "xxx" h 10 → $EXTMAX = (3 advances, 15 + 1854/1409·10);
`user/text-frame2`, `text-frame4`: MTEXT $EXTMIN/$EXTMAX = first line's ascender, last line's descender,
leftmost pen origin, rightmost advance end; the MTEXT frame/mask box counts too and dominates when larger,
`user/text-frame-annotated`). SHX text: not measured (truedxf keeps the ink). Note 04 §13.

---

### 6.3 Interactive view culling (2026-10-02)

#### Initial viewer fit: stale-large hints (2026-10-02)

Implementation measurement, **not an AutoCAD verification**: `3dface-civil-13` stores model
extents from (0,0) to (552656.62,6140343.68), while the smooth geometric probe measures
(546788.16,6138690.80) to (552656.65,6139957.27). A speculative LOD render therefore fails
the 4× scale check and adds a third pass. The viewer now samples at most 32 evenly spaced
top-level entities, using only explicit WCS LINE, POINT and 3DFACE vertices. With at least
eight usable entities and a sampled span smaller than 1/64 of both header spans, it goes
straight to the existing accurate probe. This is a path-selection heuristic, not a bound:
unsampled geometry, symbols, thickness and blocks still participate in the full probe.
Plots and paper layouts retain their existing fit path. A false positive can trade a valid
one-pass viewer approximation for an accurate two-pass fit; a false negative retains the
three-pass fallback.

This is a viewer implementation choice, not an AutoCAD rule. After a complete smooth render,
ViewerCore unions each top-level pick's output vertices across batches, adding their float64
origins. INSERT children share the parent's pick. Repeated model handles in paper viewports
union in paper coordinates (note 08 §3.5); retaining unclipped bounds is conservative and avoids
trusting a particular viewport's clip as the entity's extent. The union may retain an entity in
more viewports than necessary. Unknown/empty and unbounded XLINE/RAY picks always draw.

The cache belongs to the document and render settings (layout, layers, visibility, lineweights,
assets, fonts, raster/style/system-variable options); resolution and window are excluded.
Auxiliary plots do not replace it. Only explicit smooth window requests may cull; extents and
AutoCAD raster requests stay complete. A four-cached-pixel guard accounts for curve refinement
and Greeked text; it is a conservative practical margin, not an analytic bound on arbitrary
font overhang. View-dependent infinite extensions must never acquire finite culling bounds.

Detail lists cover three view widths/heights and refresh when the visible view reaches the
inner 25% coverage margin, with the existing LOD debounce. The complete GPU list draws only
outside detail coverage using disjoint integer scissor rectangles; depth/stencil are reset per
partition. Detail picks/highlights are confined to coverage; the coarse fallback is display-only.
Host measurements remain a full-view overlay. Keeping complete fit bounds prevents detail
extents from changing navigation limits. No new AutoCAD experiment was made for this
optimization.

## 7. Implementation checklist (derived)

1. A `Vec3`/`Mat4` math core with AAA (strict 1/64), OCS↔WCS, and elliptical-arc primitives `(C, U, V, t0, t1)`.
2. Entity readers that count actual repeated tags (spline 40/41/10/11, lwpolyline vertices), tolerate order, apply
   defaults, and handle legacy 38.
3. Geometry builders, all producing a device-independent "curve path":
   lines, elliptical arcs (from CIRCLE/ARC/ELLIPSE/bulges), NURBS (from SPLINE/HELIX) and filled polygons
   (SOLID/TRACE/wide bands).
4. Device-space flattener with sagitta tolerance ≤ 0.1 px, plus an exact arc-length helper for linetypes.
5. Wide polyline band builder (miters, radial arc caps, tapering, 43 override) that produces a single fill path.
6. POLYLINE interpreter: 2D, 3D, polyface (visible edges), mesh (M/N closed), curve-fit (all vertices),
   spline-fit (flag 8 only), with a fallback spline evaluation.
7. Exact bbox for every curve type after transformation. Extents that exclude XLINE/RAY.
8. A diagnostics channel for unsupported ACIS or MESH-subdivision cases.

---

## Web sources used

- Autodesk DXF reference 2020, SPLINE: https://help.autodesk.com/cloudhelp/2020/ENU/AutoCAD-DXF/files/GUID-E1F884F8-AA90-4864-A215-3182D47A9C74.htm
  (the table matches the 2012 spec; no flags above 16 are documented).
- Autodesk forum "Splines in the DXF" (flag bits 32–1024; 1161 example):
  https://forums.autodesk.com/t5/visual-lisp-autolisp-and-general/splines-in-the-dxf/td-p/7788034
  (seen only via the search snippet; the page returned 403).
- VIEWRES help: https://help.autodesk.com/cloudhelp/2020/ENU/AutoCAD-Core/files/GUID-77B1C617-E4BB-4D1E-823A-8E2B055B258E.htm
- "Why do Curves/circles keep turning to polygons?" (VIEWRES doesn't affect plotting; PDF faceting report):
  https://forums.autodesk.com/t5/autocad-for-mac-forum/why-do-curves-circles-keep-turning-to-polygons/m-p/7882460
- BricsCAD SPLINESEGS: https://help.bricsys.com/en-us/document/system-variable-reference/s/splinesegs-system-variable
- Autodesk Plot Dialog Box ("Extents … may regenerate the drawing to recalculate the extents"):
  https://help.autodesk.com/cloudhelp/2016/ENU/AutoCAD-Core/files/GUID-264D3513-0D22-4461-82D6-14F391BC5CDE.htm
- Construction lines don't change extents: https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-Mechanical/files/GUID-0E8B6F92-6EBE-4084-8E67-75DC71F84123.htm
- stackoverflow answer on CAD fit-point interpolation (cited by ezdxf): https://stackoverflow.com/a/74863330/6162864

---

## Test ideas (small DXF files to pin behaviour against AutoCAD PLOT)

OCS / coordinates
1. CIRCLE and ARC (radius 10, 0→90°) with extrusion (0,0,−1), OCS center (10,5). Expect the WCS center at (−10,5) and
   an arc from (−20,5) clockwise (seen from +Z) to (−10,15). Verify position, direction and linetype phase.
2. The same with extrusion (0.01, 0, 1) (inside the 1/64 cap) and (0.02, 0, 1) (outside). Verifies the cap threshold
   and branch.
3. LWPOLYLINE with elevation 38 = 5 and extrusion (0,0,−1) in a paper-space viewport with a 3D view. Verifies the
   elevation sign.
4. SHAPE and IMAGE with extrusion (0,0,−1). Settles the WCS/OCS conflicts in §2.4.
5. LINE with thickness 10 and extrusion (1,0,0), plan view. Expect a band outline (4 edges)?
6. CIRCLE, LWPOLYLINE and SOLID with thickness, in a VPOINT 1,−1,1 viewport. Shows how extruded wireframes are drawn.

POINT
7. One POINT per PDMODE value (the 20 values) with PDSIZE = 10 (absolute), plotted 1:1. Measure the arm lengths of
   `+`/`×`/tick vs circle and square.
8. PDSIZE = 0 and PDSIZE = −10 in model space and in paper-space viewports of different zoom. Determines the
   reference height for relative sizes when plotting.
9. POINT with 50 = 30°, PDMODE 3. Rotation sign.
10. POINT with a lineweight of 0.5 mm, PDMODE 0. Dot size and shape.

ARC / ELLIPSE
11. ARC with 50 = 51 = 45, ARC 0/360, ARC −180/180, ARC 350/10. Point vs full circle vs wrap.
12. ELLIPSE with 41 = 42 = 1.0; 41 = 0, 42 = 2π; 41 = −π/2, 42 = π/2; ratio 1.0; negative ratio −0.5; extrusion
    (0,0,−1).
13. ELLIPSE with ratio > 1 (1.5). Does AutoCAD load it, and how is it drawn?

SPLINE
14. Fit-points-only SPLINE (no control points), 5 points, no tangents. Compare to our chord/natural interpolation
    (overlay at 4× DPI).
15. The same with tangents 12/13, with flag 64 (sqrt chord) and flag 128 (uniform).
16. The same, closed (flag 1 | 2 | 1024), fit points only.
17. Control-point SPLINE with a periodic knot vector as AutoCAD writes it (n+p CPs, n+2p+1 knots). Plus an open
    clamped spline with only the closed flag set (like ezdxf#851).
18. Rational SPLINE (quarter circle with weights 1, √2/2, 1) vs a true ARC. Pixel-identical?
19. SPLINE with fit tolerance 44 = 1.0, fit points only.
20. HELIX, 3 turns, plan view.

Polylines
21. LWPOLYLINE with 43 = 2 and per-vertex 40/41 = 0.5/4. Which wins in AutoCAD?
22. Wide LWPOLYLINE zig-zag with angles 90°, 30°, 5° and 1°. Miter shape and spike limit.
23. Wide LWPOLYLINE with a line → non-tangent arc → line. Joint shape.
24. Tapered arc segment (40 = 0, 41 = 4, bulge 1).
25. Wide polyline with w/2 > r on an arc segment.
26. Wide polylines, SOLIDs and TRACEs with FILLMODE 0 vs 1 in the header. Outline form with FILL off.
27. Wide polyline with DASHED linetype, with and without plinegen. Plus a wide polyline with lineweight 1.0 mm.
28. Curve-fit POLYLINE (PEDIT Fit) and spline-fit POLYLINE (PEDIT Spline, SPLINETYPE 5 and 6), saved by AutoCAD,
    with SPLFRAME 0 and 1. Confirms which vertex flags are drawn (§3.10.4 CONFLICT).
29. Polyface mesh with negative indices (a pentagon split into wedges), SPLFRAME 0/1.
30. Polygon mesh 4×3 closed in M and N. Plus a PEDIT-smoothed mesh (75 = 6) to capture the vertex layout.

SOLID / 3DFACE
31. SOLID square stored 0-1-3-2 (correct) vs 0-1-2-3 (bow-tie). Fill of the bow-tie.
32. SOLID triangle (13 = 12). SOLID with lineweight 2 mm (does the fill grow by the lineweight?).
33. 3DFACE with each invisible-edge bit, SPLFRAME 0/1.

Infinite lines / extents
34. XLINE and RAY (dashed) crossing the plot window; plot "Extents" with them present. Verifies they're excluded and
    clipped, and the dash phase.
35. Extents probes: one entity per file (spline with a far-out control point, text, point with a big PDMODE symbol,
    thick polyline, hatch with a pattern, entity on a frozen or off layer, invisible entity, defpoints). Plot
    "Extents" to a fixed paper at "fit". The resulting scale/offset reveals the computed extents.

Tessellation
36. Circles with radius 1, 100, 10 000 units, plotted to PNG so the radius is about 5000 px. Look for facets.
37. A very flat bulge (θ = 2°) with a large radius. Checks we don't straighten it (dxf-viewer does).

ACIS / MESH
38. REGION made from a circle and a rectangle (union), R2010 DXF (SAT) and R2013 DXF (SAB). Check SAT decoding (and
    the ezdxf "skip after A" quirk) and that the edges plot.
39. MESH box at subdivision levels 0, 1 and 2, with crease values. What does the plot show?
