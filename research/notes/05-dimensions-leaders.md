# 05 — Dimensions, DIMSTYLE, LEADER, MULTILEADER, TOLERANCE

Scope: the DIMENSION family (`DIMENSION`, `ARC_DIMENSION`, `LARGE_RADIAL_DIMENSION`), the
`DIMSTYLE` table and per-entity `DSTYLE` overrides, built-in arrowheads, `LEADER`,
`MULTILEADER`/`MLEADERSTYLE` and `TOLERANCE` (feature control frames). Written for the
implementer of the truedxf parser, data model and renderer (target: identical to AutoCAD PLOT).

Source abbreviations used below:

- `spec` = `research/spec/autocad_2012_dxf_reference.txt` (line numbers given as `spec L3876`)
- `ODA` = `research/spec/OpenDesign_Specification_for_.dwg_files.txt`
- `ezdxf:` = `research/repos/ezdxf/...` (paths relative to the repo)
- `ACadSharp:`, `netDxf:`, `gdal:`, `qcad:`, `LibreCAD:`, `libredwg:` likewise
- `ezdxf#123`, `ACadSharp#123`, `netDxf#123`, `LibreCAD#123` = thread dumps in
  `research/github/raw/<owner>__<repo>/threads/{issue,pr,discussion}-00123.md`
- **acad-sample** = real AutoCAD output that I decoded for this note (not hearsay):
  - `ACadSharp/samples/sample_AC1032_ascii.dxf` (AutoCAD 2018 format, `$MEASUREMENT=0`, Arial
    `Standard` text style, dimension styles `ISO-25`, `Standard`, `custom_dim_style`,
    `custom_style_ltypes`) — cited as **S1** with the geometry block name, e.g. `S1 *D3`.
  - `libredwg/test/test-data/example_2018.dxf` (AutoCAD `example.dwg` exported, `txt.shx`
    `Standard` style, `ISO-25`) — cited as **S2**.
  - Arrow block definitions harvested from ~20 AutoCAD-written DXFs in the repos (see §10).
  The dump scripts were throw-away Python (tag reader + block dumper); numbers below are copied
  from their output and the derived quantities recomputed by hand.

Confidence markers follow `README.md`: **VERIFIED-BY-ACAD** (observed in AutoCAD-written
data or reported by someone who tested AutoCAD; source cited), **ASSUMPTION**, **UNKNOWN**,
**CONFLICT**.

---

## 0. Executive summary (read this first)

1. **Render the geometry block.** Every AutoCAD-written DIMENSION references an anonymous
   block `*D<n>` (group 2) that contains the complete, already laid-out picture as plain
   LINE/ARC/SOLID/INSERT/MTEXT/POINT entities. AutoCAD *displays and plots that block*; it does
   not re-layout on open (**VERIFIED-BY-ACAD**: editing group 1 text in a DXF has no visible
   effect in AutoCAD until the block is updated, ezdxf#983/#984; stale blocks cloned by
   ACadSharp were shown as-is, ACadSharp#556). So pixel-exactness for existing files is mostly
   an INSERT-rendering problem, not a dimension-layout problem.
2. **Missing block ⇒ we must regenerate.** AutoCAD regenerates missing dimension blocks for
   dimensions in model/paper space on load (netDxf#98, ACadSharp#556, netDxf#107), but *not*
   for dimensions nested inside block definitions (netDxf#98). **CONFLICT:** ezdxf docs claim
   "AutoCAD refuses to open DXF files containing DIMENSION entities without a content BLOCK"
   (`ezdxf:src/ezdxf/entities/dimstyleoverride.py:557-565`). Our regeneration will never be
   AutoCAD-exact without the AutoCAD fit algorithm; §6 documents what is known.
3. **DIMSTYLE records store only non-default values.** AutoCAD writes a dimstyle group code
   only if it differs from the built-in **imperial** default (S1: `Standard` has no values at
   all; `ISO-25` writes `41=2.5 42=0.625 … 278=44`). A missing code therefore means the
   AutoCAD imperial initial value (table §2.2), **not** ezdxf's metric defaults and **not** the
   `$DIM*` header values (**VERIFIED-BY-ACAD** from S1, see §2.1; **CONFLICT** with
   LibreCAD#2940).
4. Default arrow `""`/handle `0` = *closed filled* is emitted by AutoCAD as a **SOLID directly
   in the `*D` block**, length `DIMASZ·DIMSCALE`, half-width exactly **1/6** of that
   (**VERIFIED-BY-ACAD**, S1/S2; GDAL and netDxf agree; ezdxf uses `sin(9.46°)` = 0.1644 →
   **CONFLICT**, ezdxf is slightly wrong). Every other arrow is an INSERT of a `_Name` block
   scaled by `DIMASZ·DIMSCALE`.
5. Dimension text in the block is always an **MTEXT with attachment 5 (middle center)** at the
   text midpoint (group 11). Its vertical offset from the dimension line equals
   `DIMGAP + ½·(ink height of the actual glyphs)` — AutoCAD uses real glyph extents, not
   `DIMTXT` (§5.3, **ASSUMPTION** backed by 5 measurements).
6. LEADER: AutoCAD stores the hook line as a real vertex; the extension under the text when
   `DIMTAD≠0` is *not stored* and must be drawn (`DIMGAP·DIMSCALE + 41`) (GDAL,
   atlight.github.io, ezdxf). Arrowhead only if first segment ≥ 2·arrow size.
7. MULTILEADER is self-contained: all geometry needed is in `CONTEXT_DATA{}`; AutoCAD also
   writes proxy graphics (group 310) for it (S1). Values in the entity win over the style
   regardless of the override flags (ezdxf `IGNORE_OVERRIDE_FLAGS=True`).
8. TOLERANCE has **no** geometry block; the frame must always be computed (§13).

---

## 1. DIMENSION entity

### 1.1 Entity types and subclass layout

| DXF type | 70 & 0x0F | subclasses after `AcDbEntity` | since |
|---|---|---|---|
| DIMENSION rotated/horizontal/vertical ("linear") | 0 | `AcDbDimension`, `AcDbAlignedDimension`, `AcDbRotatedDimension` (empty) | R13 |
| DIMENSION aligned | 1 | `AcDbDimension`, `AcDbAlignedDimension` | R13 |
| DIMENSION angular 2-line | 2 | `AcDbDimension`, `AcDb2LineAngularDimension` | R13 |
| DIMENSION diameter | 3 | `AcDbDimension`, `AcDbDiametricDimension` | R13 |
| DIMENSION radius | 4 | `AcDbDimension`, `AcDbRadialDimension` | R13 |
| DIMENSION angular 3-point | 5 | `AcDbDimension`, `AcDb3PointAngularDimension` | R13 |
| DIMENSION ordinate | 6 | `AcDbDimension`, `AcDbOrdinateDimension` | R13 |
| ARC_DIMENSION | 5 (≤R2013) / 8 (≥R2018) | `AcDbDimension`, `AcDbArcDimension` | R2004 |
| LARGE_RADIAL_DIMENSION (jogged radius) | 9? (**UNKNOWN**) | `AcDbDimension`, `AcDbRadialDimensionLarge` | R2004 |

Sources: `ezdxf:src/ezdxf/entities/dimension.py:585-630` (export per type), `spec L3876-4211`,
S1/S2 (subclass markers match). ezdxf notes a DXF-reference error: the spec lists
`AcDb3PointAngularDimension` for the 2-line angular (`spec L4136`) — AutoCAD writes
`AcDb2LineAngularDimension` for type 2 (S1 `*D5`, S2 `*D8`, `70=34`).

- ARC_DIMENSION type value: 5 up to R2013, 8 from R2018 — so **type 5 is ambiguous**; dispatch
  on the DXF entity name, not on 70 (`ezdxf:src/ezdxf/entities/dimension.py:925-975`).
  S2 (R2018) has `ARC_DIMENSION` with `70=37` (= 5|32) though — **CONFLICT/UNKNOWN**: the value
  in R2018 files is apparently not always 8; again: dispatch by entity name.
- Parsing: the subclass markers must be respected — group codes 70, 40, 41 appear both in
  `AcDbDimension`-style common data and in `AcDbArcDimension` with different meaning.
- `ezdxf` merges all subclass attributes into one namespace (`acdb_dimension_dummy`), which is
  fine for DIMENSION but not for ARC_DIMENSION/LARGE_RADIAL (separate subclass definitions).
- R12: no subclass markers; all codes appear flat (`ezdxf:.../dimension.py:547-570`).

### 1.2 Common group codes (`AcDbDimension`)

| code | meaning | CS | notes |
|---|---|---|---|
| 280 | version, 0 = R2010 | | R2010+ |
| 2 | name of geometry block `*D<n>` | | missing in dimensional constraints (§1.8) |
| 3 | dimstyle name | | default "Standard"; resolve case-insensitively |
| 10 | definition point (meaning per subtype, §1.4) | WCS | |
| 11 | text midpoint | OCS | also defines the elevation (z) of the block content (ezdxf `__virtual_entities__`) |
| 12 | insertion point for clones (Baseline/Continue) | OCS | spec puts it in `AcDbAlignedDimension`, AutoCAD/ezdxf write it in `AcDbDimension`; usually 0,0,0 (ACadSharp#1223) |
| 70 | type + flags (§1.3) | | |
| 71 | text attachment point 1..9 (MTEXT style) | | R2000+, default 5; AutoCAD writes 5 (S1, S2) |
| 72 | line spacing style 1 = at least, 2 = exact | | optional |
| 41 | line spacing factor 0.25..4.0 | | optional |
| 42 | actual measurement (read-only, informative) | | R2000+; in drawing units ×? — S1 `*D10` `42=11.3994` for text `R11,4` ⇒ unscaled measurement (DIMLFAC not applied) **ASSUMPTION** |
| 73 | unknown, always 0 | | R2007+ (`libredwg:src/dwg.spec:1689`) |
| 74 | flip arrow 1 (bool) | | R2007+ ("Flip Arrow" grip command) |
| 75 | flip arrow 2 (bool) | | R2007+ |
| 1 | text override (§1.5) | | |
| 52 | oblique angle (deg) of extension lines, linear dims | | spec says `AcDbAlignedDimension`, written in `AcDbDimension` by ezdxf ("DXF reference error") |
| 53 | text rotation (deg), user-defined, away from default | | absent ⇒ automatic orientation |
| 51 | "horizontal direction": negative of angle between OCS X and UCS X at creation | | always in OCS xy-plane; used for text "horizontal" (DIMTIH/DIMTOH) and ordinate axes |
| 54 | clone insertion rotation (DWG `ins_rotation`) | | libredwg only (`dwg.spec:1698`), rarely in DXF |
| 210 | extrusion | | default 0,0,1 |

Point coordinate systems per spec: 10, 13, 14, 15 = WCS; 11, 12, 16 = OCS (`spec L3985-3995`).
In the *block*, however, **all entities (even LINE/POINT/MTEXT which are "WCS entities")
are located in the dimension's OCS**, with elevation = z of group 11
(`ezdxf:src/ezdxf/entities/dimension.py:772-827`). For extrusion = +Z (99.9 % of files) OCS=WCS.

XDATA on the entity (all AutoCAD-written, S1):
- `ACAD` → `DSTYLE {…}` overrides (§3).
- `ACAD_DSTYLE_DIMRADIAL_EXTENSION` on radius/diameter: `1070 387, 1070 1, 1070 388, 1040 0.0,
  1070 390, 1040 0.0` — radial arc extension line on/off + start/end angles (**ASSUMPTION**;
  ezdxf: "meaning unknown", `dimension.py:1069-1076`).
- `ACAD_DSTYLE_DIMJAG` (388 = jog height factor), `ACAD_DSTYLE_DIMTALN` (392),
  `ACAD_DSTYLE_DIMBREAK` (391 = break size) appear on DIMSTYLE records (S1). Preserve them on
  round-trip — ezdxf#1147 shows AutoCAD re-layouts differently if they are lost.
- Before R2007 dimstyle linetypes / fixed extension line lengths were stored as XDATA groups
  `ACAD_DSTYLE_DIM_LINETYPE` (1070 380 + 1005 handle), `…_EXT1_LINETYPE` (381),
  `…_EXT2_LINETYPE` (382), `ACAD_DSTYLE_DIMEXT_ENABLED` (383), `ACAD_DSTYLE_DIMEXT_LENGTH`
  (378 + 1040) (`ezdxf:docs/source/dxfinternals/tables/dimstyle_table.rst:474-510`).

Extension dictionaries: AutoCAD dims may carry `{ACAD_XDICTIONARY` → `AcDbContextDataManager`
→ `ACDB_ANNOTATIONSCALES` → `ACDB_ALDIMOBJECTCONTEXTDATA_CLASS` (annotative scale
representations) and `{ACAD_REACTORS` → `DIMASSOC` (associativity) (S1 `*D10`,
ACadSharp#556). DIMASSOC is not needed for rendering.

### 1.3 Group 70 — type and flags

`70 = type (0..6, 8) | 32 | 64 | 128` (`spec L3897-3925`, `ezdxf:.../dimension.py:94-110`):

- bits 0-3: type (mask `& 0x0F`; ezdxf uses `& 15`).
- 32: "block referenced by this dimension only" — **always set since R13**. DWG stores it as
  "use block" bit 1 of flag1 (`libredwg:src/dwg.spec:1640-1641`).
- 64: ordinate X-type (only with type 6); clear = Y-type.
- 128: text at user-defined position (not the default position). DWG stores the *inverse*
  (flag1 bit 0 = "text at default position") (`libredwg:src/dwg.spec:1639`).
- S1 examples: 32 (linear), 33 aligned, 34 angular-2L, 36 radius, 37 3-point-angular,
  38 ordinate-Y, 102 = 6|32|64 ordinate-X, 163 = 3|32|128 diameter with moved text.

### 1.4 Definition points per subtype

| type | 10 (WCS) | 13 (WCS) | 14 (WCS) | 15 (WCS) | 16 (OCS) | other |
|---|---|---|---|---|---|---|
| 0 linear/rotated | point on dim line; AutoCAD: intersection of dim line with ext line 2 (= tip of arrow 2) | origin of ext line 1 | origin of ext line 2 | – | – | 50 = dim line angle (deg, OCS), 52 oblique |
| 1 aligned | as above (dim line ∥ 13→14) | ext line 1 origin | ext line 2 origin | – | – | 50 written but meaningless? (**UNKNOWN**) |
| 2 angular 2-line | end point of line 2 | start of line 1 | end of line 1 | start of line 2 | point on dim arc | vertex = intersection of the two lines |
| 3 diameter | point on circle opposite to 15 | – | – | point on circle (arrow) | – | 40 leader length |
| 4 radius | center | – | – | point on circle/arc | – | 40 leader length |
| 5 angular 3-point | point on dim arc (arc location) | ext line 1 point | ext line 2 point | vertex | – | – |
| 6 ordinate | UCS origin at creation | feature location | leader end point | – | – | 51 = UCS rotation, 64 flag X/Y |
| ARC_DIMENSION | point on dim arc | arc start point (ext line 1) | arc end point (ext line 2) | arc center | 16/17 = leader points (`AcDbArcDimension`) | 70 is_partial, 40/41 arc start/end *parameters* (rad), 71 has_leader |
| LARGE_RADIAL | center (common 10) | **CONFLICT** chord point (ezdxf) vs jog point (libredwg) | override center | **CONFLICT** jog point (ezdxf) vs chord point (libredwg) | – | 40 = jog angle (libredwg) / "unknown" (ezdxf) |

Sources: `spec L4005-4211`; ezdxf factories and renderers
(`ezdxf:src/ezdxf/graphicsfactory.py:1548-1552` for 2-line angular: `13,14`=line1,
`15,10`=line2, `16`=arc location); `ezdxf:src/ezdxf/render/dim_curved.py:733-745, 826-830,
903-907`; `ezdxf:src/ezdxf/entities/dimension.py:925-1060`; libredwg `dwg2.spec:2835-2844`,
`dwg.spec:2007-2021`.

Verified against S1 (**VERIFIED-BY-ACAD**):
- `*D3` aligned: 10 = (360.358, 44.291) is exactly the tip of arrow 2 on the dim line; 13/14
  are the measured points; ext line 2 runs from `14 + DIMEXO·dir` to `10 + DIMEXE·dir`.
- `*D4` 3-point angular: 15 = arc center/vertex; 10 lies on the arc (radius 34.670 = |10-15|).
- `*D5` 2-line angular: 13 = 15 = the vertex (both lines start at the vertex here), 16 on the arc.
- `*D10` radius: 10 = center, 15 = point on circle = arrow tip.
- Ordinate `*D6`/`*D7`: 10 = (313.19, 111.24) — a far-away origin, 13 feature, 14 leader end.
- ARC_DIMENSION (S2 `*D5`): 15 = arc center, 13/14 arc end points; 16/17 = 13/14 when
  `71 = 0` (no leader); `40=4.1313, 41=1.1653` rad ≈ 236.7°, 66.8° — start/end angle of the
  measured arc, so `40 > 41` means the arc crosses 0°.

Angular measurement quadrant (**UNKNOWN / needs AutoCAD test**): for 2-line angular dims four
angles exist between two lines; AutoCAD chooses the one containing the arc point 16 (ezdxf and
QCAD do this via the dim-line location; ezdxf's measurement helper just takes
`angle(10-15) - angle(14-13)` normalized to [0,360), `dimension.py:1167-1175`).
**CONFLICT (internal ezdxf):** `AngularDimension` renderer names `10/15` "leg1" and `14/13`
"leg2" (`dim_curved.py:733-745`), whereas the factory calls `13/14` "line1".

`get_measurement()` (ezdxf): linear/aligned = projection of 13→14 onto direction `50` (for
aligned 50 should be the 13→14 angle); diameter/radius = |15-10|; ordinate = projection of
`13-10` onto the local axis rotated by `-51` (`dimension.py:1150-1205`,
`render/dim_ordinate.py:36-60`). ezdxf#1415: `get_measurement()` wrong for ALIGNED when 50 is
not maintained — compute aligned from 13→14 directly.

### 1.5 Text override (group 1)

From spec (`spec L3931-3934`) plus AutoCAD behaviour:

- absent, `""` or `"<>"` → the formatted measurement.
- `" "` (exactly one space) → text suppressed (no text; the dimension line is not broken).
  (`ezdxf:render/dim_base.py:650-656`, `netDxf:Entities/DimensionBlock.cs:46-50`, GDAL.)
- any string containing `<>` → first `<>` replaced by the formatted measurement **including**
  prefix/suffix from DIMPOST and automatic prefixes (`R`, `%%c`) (ezdxf only replaces the first
  occurrence "like BricsCAD", `dim_base.py:656-660`). **UNKNOWN**: whether AutoCAD replaces all
  occurrences.
- anything else → literal text (MTEXT inline codes allowed; the content becomes MTEXT content).
- `[]` → alternate-units value (only meaningful with DIMALT=1); also valid in DIMAPOST
  (**ASSUMPTION** from AutoCAD docs; not verified in data).
- `\X` inside the text: text before `\X` goes above the dimension line, after it below
  (`netDxf:Entities/DimensionBlock.cs:137-160`, AutoCAD MTEXT code "paragraph on dimension
  line").
- Radius/diameter: the `R`/`Ø` prefix is part of the *automatic* text only; ezdxf#1215 (bug)
  prepended `R` to user text — AutoCAD does not (**ASSUMPTION**, ezdxf fixed it,
  `notes/pages/CHANGELOG.md:154`). AutoCAD writes the diameter sign as the Unicode character
  U+2205 `∅` in the block MTEXT (S1 `*D11`: `∅45,6`), ezdxf writes `%%c`.

### 1.6 Other flags and oddities

- 53 text rotation: absolute angle (deg) of the text in OCS, overriding everything incl. DIMTIH/
  DIMTOH (ezdxf: "user defined text rotation – overrides everything", `dim_base.py:434-436`).
- 51 horizontal direction: ezdxf *ignores* it for linear dims (`dim_base.py:417-419`) but uses
  `-51` as the ordinate local x-axis (`dim_ordinate.py:32-38`). For DIMTIH/DIMTOH "horizontal"
  means horizontal in the UCS of creation, i.e. rotated by `-51` relative to OCS X
  (**ASSUMPTION** from the spec wording; test needed with rotated UCS).
- 52 oblique: extension line angle = 50 + 52 (absolute). ezdxf renderer uses
  `get_dxf_attrib("oblique_angle", 90)` so an *absent* 52 means perpendicular but a *present
  52 = 0* would make extension lines parallel to the dim line (`dim_linear.py:47-52`) —
  **CONFLICT/ezdxf bug**: in AutoCAD 0 means "not oblique" (perpendicular). Treat 0 like 90.
- 12 clone insertion point: ezdxf translates the block content by 12 when present
  (`dimension.py:817-822`, CHANGELOG "correct application of Dimension.dxf.insert"), while
  ACadSharp#1223 says AutoCAD leaves it at the origin unless created by Baseline/Continue.
  **UNKNOWN / needs AutoCAD test**: does AutoCAD offset the block by 12?
- Dimensions inside block definitions: AutoCAD does not make `*D` coordinates relative to the
  owner block's base point like other block entities (netDxf#98: "something that AutoCad does
  for all entities except the entities belonging to the block that makes the dimension
  drawing"). Just render the `*D` block in the owner block's coordinate system (identity
  transform), then apply the owner INSERT transform. **ASSUMPTION**.
- 3D/extruded dims are rare; ezdxf note "3D placement of DIMENSION entities seems to be broken"
  (`notes/journals/2023_11_23.md:3`).

### 1.7 DIMENSION measurement (42) and ARC_DIMENSION 40/41

- 42 is written by AutoCAD R2000+ and equals the raw measured value (S1 `*D3`: 46.7156 =
  |13→14| projected; S1 `*D5`: 1.64757 = angle in *radians* for angular dims).
- Don't trust 42 for formatting if the block is regenerated; recompute from defpoints.

### 1.8 Dimensional constraints

DIMENSION entities on layer `*ADSK_CONSTRAINTS` without group 2 (and without 70) with a reactor
to `ACDBASSOCDEPENDENCY` are parametric constraints, not annotation
(`ezdxf:src/ezdxf/entities/dimension.py:674-688`). **ASSUMPTION**: AutoCAD does not plot them
(constraint bar/dimension display is a UI thing). Render nothing.

---

## 2. DIMSTYLE table

### 2.1 Record layout and the "missing code" rule

Subclasses `AcDbSymbolTableRecord`, `AcDbDimStyleTableRecord`; name 2, flags 70, then DIMVARs
by their group code; handle of the record uses group **105** (not 5) (S1: `105=39A`).
**Group 70 is used twice**: first the table flags, later DIMTFILLCLR (S1 `custom_dim_style`:
`70=0 … 69=2 70=97`) — the parser must be positional (`ezdxf:entities/dimstyle.py:371-375`).

Resources are handles (R2000+): 340 DIMTXSTY (STYLE), 341 DIMLDRBLK, 342 DIMBLK, 343 DIMBLK1,
344 DIMBLK2 (BLOCK_RECORD handles; handle `0` or absent = closed filled), 345 DIMLTYPE,
346 DIMLTEX1, 347 DIMLTEX2 (LTYPE, R2007+). R12 stores arrow *names* in 5/6/7 (strings).
In the header, `$DIMBLK` etc. are names (S1: `$DIMBLK=BoxBlank` — without the leading `_`!),
`$DIMLTYPE=BATTING`.

**AutoCAD writes only values that differ from the built-in initial values** (S1/S2
**VERIFIED-BY-ACAD**):
- S1 `Standard`: only `340=11` (text style); everything else absent ⇒ imperial defaults.
- S1/S2 `ISO-25`: `41=2.5 42=0.625 43=3.75 44=1.25 73=0 74=0 77=1 78=8 140=2.5 141=2.5
  143=0.03937 147=0.625 171=3 172=1 271=2 272=2 274=3 278=44 283=0 284=8 340=…` — exactly the
  ISO-25 values that differ from the imperial Standard.
- The fallback is *not* the header: S1's header has `$DIMCLRD=4 $DIMBLK=BoxBlank` (current
  style `custom_style_ltypes`), but ISO-25 dimensions (`*D3`, no 176/342 in the record) were
  drawn by AutoCAD with BYBLOCK color and SOLID closed-filled arrows. **CONFLICT:**
  LibreCAD#2940 back-fills unset fields from `$DIM*` header values; ezdxf falls back to its own
  (metric-ish) defaults (`ezdxf:entities/dimstyle.py:36-200`) — both wrong for AutoCAD files.

### 2.2 DIMVAR table: codes and defaults

"imp" = AutoCAD imperial initial value (acad.dwt / DIMSTYLE record fallback), "ISO" = ISO-25 as
written by AutoCAD (S1), "ezdxf" = ezdxf attribute default where it differs. Scaled = multiplied
by DIMSCALE (overall scale) when laying out. Imperial values from AutoCAD docs + S1 header
(which equals the imperial defaults for all non-overridden values).

| var | code | type | imp | ISO | scaled | notes |
|---|---|---|---|---|---|---|
| DIMPOST | 3 | str | "" | | | prefix/suffix `pre<>suf` |
| DIMAPOST | 4 | str | "" | | | alt-unit prefix/suffix, `[]` placeholder |
| DIMBLK/1/2 | 5/6/7 (R12), 342/343/344 | name/handle | "" | | | "" = closed filled |
| DIMSCALE | 40 | real | 1.0 | | – | 0 ⇒ computed from viewport scale (§14) |
| DIMASZ | 41 | real | 0.18 | 2.5 | yes | arrow size; also hook line length (LEADER) |
| DIMEXO | 42 | real | 0.0625 | 0.625 | yes | ext line offset from origin |
| DIMDLI | 43 | real | 0.38 | 3.75 | yes | baseline spacing (creation only) |
| DIMEXE | 44 | real | 0.18 | 1.25 | yes | ext line extension beyond dim line |
| DIMRND | 45 | real | 0 | | no | rounding increment |
| DIMDLE | 46 | real | 0 | | yes | dim line extension past ext lines (ticks/oblique arrows only) |
| DIMTP | 47 | real | 0 | | no | plus tolerance |
| DIMTM | 48 | real | 0 | | no | minus tolerance (sign inverted on display) |
| DIMFXL | 49 | real | 1.0 | | yes | fixed ext line length (R2007+), ezdxf default 2.5 |
| DIMJOGANG | 50 | real | 45° | | – | jogged radius transverse angle; header stores **radians** (`$DIMJOGANG=0.785398`, S1/S2); unit of DIMSTYLE code 50 **UNKNOWN**, corpus evidence says degrees (4833-file corpus 2026-09-30: 237 DIMSTYLE records with 45/90, 6 with radian-like values; header `$DIMJOGANG` always radians); ezdxf default 90 (**CONFLICT**) |
| DIMTFILL | 69 | int | 0 | | – | 0 none, 1 background color, 2 DIMTFILLCLR (R2007+) |
| DIMTFILLCLR | 70 (2nd!) | ACI | 0 | | – | |
| DIMTOL | 71 | bool | 0 | | | turns DIMLIM off |
| DIMLIM | 72 | bool | 0 | | | turns DIMTOL off |
| DIMTIH | 73 | bool | **1** | 0 | | text inside horizontal |
| DIMTOH | 74 | bool | **1** | 0 | | text outside horizontal |
| DIMSE1/2 | 75/76 | bool | 0 | | | suppress ext line 1/2 |
| DIMTAD | 77 | int | **0** | 1 | | ezdxf default 1 |
| DIMZIN | 78 | int | **0** | 8 | | ezdxf default 8 |
| DIMAZIN | 79 | int | 0 | | | ezdxf default 3 |
| DIMARCSYM | 90 | int | 0 | | | 0 preceding, 1 above, 2 none |
| DIMTXT | 140 | real | 0.18 | 2.5 | yes | ignored if text style has fixed height (40 ≠ 0) |
| DIMCEN | 141 | real | 0.09 | 2.5 | yes | >0 mark, <0 mark + center lines, 0 none |
| DIMTSZ | 142 | real | 0 | | yes | >0: ticks instead of arrows |
| DIMALTF | 143 | real | 25.4 | 0.03937 | | alt units factor |
| DIMLFAC | 144 | real | 1.0 | | | linear factor; <0 ⇒ only in paper space |
| DIMTVP | 145 | real | 0 | | ×DIMTXT | vertical text offset when DIMTAD=0 |
| DIMTFAC | 146 | real | 1.0 | | | tolerance/fraction height factor |
| DIMGAP | 147 | real | 0.09 | 0.625 | yes | <0 ⇒ box around text |
| DIMALTRND | 148 | real | 0 | | | |
| DIMALT | 170 | bool | 0 | | | |
| DIMALTD | 171 | int | 2 | 3 | | |
| DIMTOFL | 172 | bool | **0** | 1 | | force dim line inside; ezdxf default 1 |
| DIMSAH | 173 | bool | 0 | | | separate arrow blocks |
| DIMTIX | 174 | bool | 0 | | | force text inside |
| DIMSOXD | 175 | bool | 0 | | | suppress outside arrows |
| DIMCLRD/E/T | 176/177/178 | ACI | 0 (BYBLOCK) | | | |
| DIMADEC | 179 | int | 0 | | | -1 ⇒ use DIMDEC; ezdxf default 2 |
| DIMUNIT | 270 | int | | | | obsolete |
| DIMDEC | 271 | int | **4** | 2 | | ezdxf default 2 |
| DIMTDEC | 272 | int | 4 | 2 | | |
| DIMALTU | 273 | int | 2 | | | |
| DIMALTTD | 274 | int | 2 | 3 | | |
| DIMAUNIT | 275 | int | 0 | | | 0 dec deg, 1 DMS, 2 grad, 3 rad, (4 surveyor, not selectable in UI, netDxf) |
| DIMFRAC | 276 | int | 0 | | | 0 horizontal, 1 diagonal, 2 not stacked |
| DIMLUNIT | 277 | int | 2 | | | 1 sci, 2 dec, 3 eng, 4 arch, 5 frac, 6 Windows |
| DIMDSEP | 278 | char code | 46 `.` | 44 `,` | | ezdxf maps 0 → `,` (`dimstyleoverride.py:221-223`) — **CONFLICT**: AutoCAD docs: NULL/0 ⇒ `.` |
| DIMTMOVE | 279 | int | 0 | | | 0 move dim line, 1 leader, 2 free |
| DIMJUST | 280 | int | 0 | | | 0 center, 1 ext1, 2 ext2, 3 over ext1, 4 over ext2 |
| DIMSD1/2 | 281/282 | bool | 0 | | | suppress dim line half 1/2 |
| DIMTOLJ | 283 | int | **1** | 0 | | 0 bottom, 1 middle, 2 top |
| DIMTZIN | 284 | int | 0 | 8 | | |
| DIMALTZ | 285 | int | 0 | | | |
| DIMALTTZ | 286 | int | 0 | | | |
| DIMFIT | 287 | int | | | | obsolete (R14), replaced by DIMATFIT+DIMTMOVE |
| DIMUPT | 288 | bool | 0 | | | AutoCAD writes 288=1 in DSTYLE of radial dims (S1) |
| DIMATFIT | 289 | int | 3 | | | ezdxf renderer behaves like 2 |
| DIMFXLON | 290 | bool | 0 | | | |
| DIMTXTDIRECTION | 295? | bool | 0 | | | **UNKNOWN** DXF code; header `$DIMTXTDIRECTION` |
| DIMTXSTY | 340 | handle | Standard | | | |
| DIMLDRBLK | 341 | handle | "" | | | leader arrow |
| DIMLTYPE/DIMLTEX1/2 | 345/346/347 | handle | ByBlock | | | R2007+ |
| DIMLWD/DIMLWE | 371/372 | lw enum | -2 (BYBLOCK) | | | |

Sources: `ezdxf:docs/source/dxfinternals/tables/dimstyle_table.rst` (meaning of every value),
`ezdxf:src/ezdxf/entities/dimstyle.py:36-190` (codes/ezdxf defaults), S1/S2 header and
DIMSTYLE records (defaults), AutoCAD DIMGAP help
(https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-EB367187-A5D6-404A-8121-A6D1D25B626A.htm),
DIMJOGANG (docs.intellicad.org/ODA: initial 45, range π/36..π/2).

True colors: the DXF DIMSTYLE record only has ACI (176-178), but AutoCAD's block entities carry
true colors (`420`) when the dimstyle used them (S1 `*D14`: `62=183 420=8404418` etc.). This is
one more reason to prefer the block; when regenerating from DXF only ACI is available.
**UNKNOWN** whether R2004+ DXF stores the true colors somewhere (XDATA?) in the DIMSTYLE.

---

## 3. DSTYLE overrides (XDATA)

Format (`spec L4212-4240`, verified S1 `*D8`):

```
1001 ACAD
1000 DSTYLE
1002 {
1070 <dimvar group code>     ; e.g. 276 = DIMFRAC
<typed value>                ; 1070 int / 1040 real / 1000 string / 1005 handle
... repeated pairs ...
1002 }
```

S1 `*D8` example: `1070 276 1070 1` (DIMFRAC=1), `1070 78 1070 8`, `1070 277 1070 4`
(architectural), `1070 44 1040 2.0` (DIMEXE), `1070 46 1040 2.0` (DIMDLE), `1070 176 1070 1`
(DIMCLRD red), `1070 343 1005 4A4` (DIMBLK1 = handle of `_ArchTick` BLOCK_RECORD),
`1070 173 1070 1` (DIMSAH), `1070 344 1005 4A4`.

Rules:
- Value type is determined by the dimvar (not by the preceding code): ints/bools/colors 1070,
  reals 1040, strings 1000, handles 1005 (`ezdxf:entities/dimension.py:367-376` uses
  `get_xcode_for(code)`); code 5 (DIMBLK name, R12) is written as 1000.
- Handles in 1005 are translated on copy like any XDATA handle (resource mapping comes free).
- Priority: **DSTYLE override > DIMSTYLE record (by name in group 3) > AutoCAD built-in
  default**. Header `$DIM*` values are *not* part of the chain for existing entities
  (`ezdxf:entities/dimstyleoverride.py:67-88`; §2.1).
- Overrides also apply to LEADER and TOLERANCE (`spec L4213`), and GDAL reads them for LEADER
  (`gdal:ogr/ogrsf_frmts/dxf/ogrdxf_leader.cpp:159-178`). GDAL accepts 1005/1040/1070 values.
- Invalid XDATA is ignored by AutoCAD (ezdxf comment `dimension.py:888-890`).
- Special handle `0` for DIMBLK* means closed filled (`ezdxf:entities/dimension.py:388-394`).
- For the jogged/arc extension XDATA groups see §1.2.

---

## 4. Rendering strategy

### 4.1 Block present (the normal case)

Render the DIMENSION like an INSERT of block `2` with:
- insertion point (0,0,0) (**ASSUMPTION** regarding group 12, see §1.6), scale 1, rotation 0,
  OCS = DIMENSION extrusion, elevation = z(11) (`ezdxf:entities/dimension.py:772-830`);
- BYBLOCK properties resolve to the DIMENSION entity (color, linetype, lineweight,
  transparency). AutoCAD writes block content with `62=0` (BYBLOCK), `370=-2` (BYBLOCK),
  `440=16777216` (transparency BYBLOCK) unless the dimstyle sets explicit values (S1, all
  blocks).
- **Layer:** AutoCAD puts the block entities on the *DIMENSION's own layer* (`8=Layer1` in S1
  `*D3` whose DIMENSION is on `Layer1`; `8=0` when the dim is on 0; S2 `Tavolo 3`), and the
  defpoint POINTs on `Defpoints`. So freezing/colour of that layer applies directly.
  (ezdxf writes its content on layer 0 → inherits from the INSERT anyway.)
- `Defpoints` layer never plots (AutoCAD special layer; netDxf creates it with `Plot=false`,
  `netDxf:Entities/DimensionBlock.cs:825`). POINTs also render only according to
  `$PDMODE/$PDSIZE`; in PLOT, Defpoints is skipped regardless of its plot flag
  (**ASSUMPTION**, well-known AutoCAD behaviour; add a test).
- The default arrow is a SOLID (fill obeys `$FILLMODE`, ezdxf `__virtual_entities__` note: "AutoCAD
  uses the SOLID entity to render the solid-fill arrow directly").
- Text is MTEXT (R2000+) or TEXT (R12). Background fill of DIMTFILL is MTEXT background
  (`90=1, 63=<aci>, 421=<rgb>, 45=1.25, 441=0` in S1 `*D14`/`*D23`; box scale **1.25**, while
  ezdxf uses 1.1 `dim_base.py:495`) → the note on MTEXT background masking applies (masks
  entities drawn *earlier* in the block; AutoCAD writes the MTEXT after lines and arrows in S1).

### 4.2 Block missing, empty or unreadable

- AutoCAD: regenerates on load for dims directly in model/paper space; not for dims inside
  block definitions (except 3-point angular, "who knows why") (netDxf#98); "AutoCAD creates
  missing anonymous blocks for all dimensions when the document is saved" and a dimension
  without block is visible (ACadSharp#556). A cloned DIMENSION referencing a *foreign/stale*
  block was invisible until the block reference was set to null (ACadSharp#556) — i.e. AutoCAD
  trusts group 2 blindly.
- BricsCAD regenerates missing blocks too and ezdxf recommends "discard" for BricsCAD
  (`dimstyleoverride.py:552-565`).
- truedxf: regenerate with the layout engine of §6 when (a) group 2 is missing, (b) the block
  does not exist, or (c) the block is empty. Never regenerate a present, non-empty block
  (would deviate from AutoCAD which shows it as-is). Optionally offer a "force regenerate"
  mode for authoring.
- Dimensional constraints (§1.8) have no block by design → render nothing.

### 4.3 Stale blocks

If the entity data (defpoints, text override, DSTYLE) disagree with the block, AutoCAD still
shows the block (**VERIFIED-BY-ACAD**, ezdxf#983/#984: modified group 1 text not visible in
AutoCAD; mozman: "The content of that block is what a CAD application displays"). truedxf must
do the same; a validator could warn.

---

## 5. What AutoCAD actually puts into `*D` blocks (decoded samples)

All measurements **VERIFIED-BY-ACAD** (AutoCAD output), derived numbers recomputed by me.

### 5.1 Entity inventory & order

Linear/aligned (S1 `*D3`, ISO-25): `LINE` ext1, `LINE` ext2, `LINE` dim line (one segment when
text is above), `SOLID` arrow1, `SOLID` arrow2, `MTEXT`, `POINT`×3 on Defpoints (13, 14, 10).
With centered text (DIMTAD=0, S1 `*D23`) the dim line is **two LINEs**, each drawn from the
arrow toward the text (second LINE goes from arrow 2 *towards* the middle).
Angular: `LINE` ext1, `LINE` ext2, `ARC` dim arc, 2 `SOLID`, MTEXT, POINTs (vertex, 13, 14, 10).
Radius (text outside): `LINE` leader/extension from text end to arrow base, MTEXT, `LINE`
center→point on circle (DIMTOFL=1), SOLID, POINTs.
Ordinate: 3 `LINE`s (leader with jog), MTEXT, POINTs.
Other arrows: `INSERT` of `_ArchTick`, `_BoxBlank`, … with `41=42=43=DIMASZ·DIMSCALE`.

### 5.2 Linear geometry (S1 `*D3`, DIMASZ 2.5, DIMEXO 0.625, DIMEXE 1.25, DIMGAP 0.625)

- Ext line 1: starts `13 + DIMEXO·u` (u = unit ext-line direction, from measured point toward
  the dim line), ends `dimline_point1 + DIMEXE·u`. Measured: 0.625 / 1.25 exactly.
- Arrow SOLID: vertices `10/11 = base corners`, `12 = 13 = tip` (triangle as degenerate
  quad). Tip = dim-line/ext-line intersection. Base midpoint at distance `DIMASZ` from the tip
  along the dim line, base half-width `DIMASZ/6` (0.41667). The SOLID corner order
  (10 = left of the arrow direction, 11 = right) is consistent in all samples.
- Dim line LINE: from arrow-1 base midpoint to arrow-2 base midpoint (shortened by DIMASZ at
  each end for closed filled; `_BoxBlank` in S1 `*D22` also shortened by the full DIMASZ).
- ArchTick style (S1 `*D8`, DSTYLE DIMEXE=2, DIMDLE=2, DIMBLK1/2=_ArchTick, DIMCLRD=1):
  INSERT `_ArchTick` at the dim-line endpoints, rotation `50+180` at 13-side and `50` at 14-side
  (225°/45° for a 45° dim), scale DIMASZ (2.5 — *not* DIMTSZ), color 1; dim line **extended by
  DIMDLE beyond each tick** (2.0), ext lines extend DIMEXE (2.0) past the dim line.
- Centered text (S1 `*D23`, imperial, DIMGAP 0.09, text `\A1;34.9453` h=0.18): the dim line
  gap around the text is `text_ink_half_width + DIMGAP` on each side (0.5335).

### 5.3 Text position (vertical offset)

Observed perpendicular distance from dim line (or arc, or ordinate leader) to the MTEXT
insertion point (attachment 5) with DIMTAD=1:

| sample | font | text | DIMTXT | DIMGAP | offset | offset − DIMGAP |
|---|---|---|---|---|---|---|
| S1 `*D3` aligned | Arial | `46,72` | 2.5 | 0.625 | 2.127 | 1.502 |
| S1 `*D10` radius | Arial | `R11,4` | 2.5 | 0.625 | 2.127 | 1.502 |
| S1 `*D6` ordinate | Arial | `102,59` | 2.5 | 0.625 | 2.127 | 1.502 |
| S1 `*D4` angular | Arial | `94°` | 2.5 | 0.625 | 1.901 | 1.276 |
| S1 `*D11` diameter | Arial | `∅45,6` | 2.5 | 0.625 | 2.168 | 1.543 |
| S2 linear ×4 | txt.shx | `277,87`… | 2.5 | 0.625 | 2.0833 | 1.4583 = 7/12·h |

Interpretation (**ASSUMPTION**, consistent with all rows): AutoCAD places the text so that the
bottom of its *ink bounding box* is DIMGAP above the dimension line, and the MTEXT insertion
point is the center of that ink box. Arial (TTF height = cap height 0.716 em): comma descends
≈0.147 em → ink height ≈ 2.5·(1+0.205) ≈ 3.01 → half 1.505 ✓; `94°` has no descender and
the `°` reaches slightly above cap height → ≈2.55 → 1.276 ✓. txt.shx: comma descends 1/6 of
cap height → 7/6·2.5/2 = 1.4583 ✓. Consequences: (1) our regenerated text position depends on
exact glyph extents of the font (SHX and TTF), (2) for rendering existing blocks nothing needs
to be computed — just render MTEXT with attachment 5 the way AutoCAD does (see MTEXT note:
how AutoCAD defines "middle" of a single-line MTEXT — the samples strongly suggest ink-extent
based centring, **needs AutoCAD test**).

Horizontal: ordinate text starts `DIMGAP` after the leader end point 14 and the last leader
segment extends to the end of the text (S1 `*D6`: 5.074·2 = 10.15 text width, start 0.625 after
14; `*D7` same). Radius text outside: text begins `DIMASZ` (2.5) after the arrow base, the
leader line continues under the whole text to its end (S1 `*D10`).

MTEXT fields AutoCAD writes in dim blocks: `40=DIMTXT·DIMSCALE`, `41=0` (no width), `46=0`,
`71=5`, `72=1`, `73=1`, `44=1.0`, `11=direction vector` only if not horizontal, style `7`
omitted when Standard. Content prefixed with `\A1;` when DIMTAD=0 (S1 `*D14`, `*D23`) but not
for DIMTAD=1 (`*D3`) — **ASSUMPTION** that `\A1;` (center vertical alignment for stacks) is
emitted for centered text. Architectural fraction: `4'-0{\H1x;\S1#4;}"` (S1 `*D8`, DIMFRAC=1
diagonal `#`; `\H<DIMTFAC>x;`; no space between inches and fraction).

### 5.4 Angular (S1 `*D4`, `*D5`)

- ARC centered at the vertex with radius |10−15| (3-point) / |16−vertex| (2-line).
- Arrow SOLIDs have **both tip and base-midpoint on the arc**: the arrow is the chord of an arc
  segment of length ≈ DIMASZ (tilted by `DIMASZ/(2r)` rad against the tangent); the ARC is
  shortened by exactly the angle `DIMASZ/r` at each end (345.70° vs tip at 341.56°:
  4.14°·34.67·π/180 = 2.50). Same as ezdxf's `arrow_tilt` (`dim_curved.py:568-600`).
- Ext lines are radial: start `DIMEXO` beyond the measured point (away from the vertex), end
  `DIMEXE` beyond the arc (**VERIFIED**: 18.649−18.024 = 0.625, 35.92−34.67 = 1.25).
- Text `94°` with degree sign as `\U+00B0` in R2018 MTEXT, rotated tangentially
  (direction (0.481, −0.877)), readable orientation.

### 5.5 Arc length (S2 `*D5`)

- Radial ext lines, ARC dim line, SOLID arrows as for angular.
- Arc-length symbol (DIMARCSYM=0 "preceding") is **not a text character**: a separate `ARC`
  (radius 2.3333 = 0.9333·DIMTXT, 180° span, opening towards the text baseline, i.e. a "∩")
  placed before the text: its center is 10.62 before the text midpoint along the text direction
  and 1.17 below the text center line. **ASSUMPTION** on the general formula (depends on text
  width). ezdxf instead prefixes `"( "` (`dim_curved.py:41`) — **CONFLICT** (ezdxf is an
  approximation).

### 5.6 Radius/diameter

- S1 `*D10` radius, ISO-25 (DIMTOFL=1, DIMTIH/DIMTOH=0, text outside): arrow tip at 15,
  arrow body outside the circle (pointing inward), full LINE center→15, leader LINE from arrow
  base outward along the radial direction to the end of the text; text aligned with the
  radial line (45°) and DIMGAP above it.
- S1 `*D11` diameter with user-moved text inside (70=163): only **one** arrow (at 15), one LINE
  from the text start to the arrow base, text horizontal (`∅45,6`) above the line.
  **UNKNOWN**: the general rule for which arrows AutoCAD drops for moved text.
- DSTYLE of radial dims always contained `288=1` (DIMUPT) in S1.

### 5.7 Ordinate (S1 `*D6` Y-type, `*D7` X-type)

Leader: `13 + DIMEXO·dir` → point `14 − 4·DIMASZ·dir` (along the measurement-orthogonal
direction), jog to `14 − 2·DIMASZ·dir` shifted to the leader end's line, then `14` → end of
text. Measured: jog segment start 10 = 4·2.5 before 14, jog end 5 = 2·2.5 before 14; matches
ezdxf (`dim_ordinate.py:176-196`, leg = 2·DIMASZ). X-type text rotated 90° (reads bottom→top),
"above" = to the left.

---

## 6. Dimension layout algorithm (for regeneration)

AutoCAD's algorithm is not published. The following merges AutoCAD documentation, the samples
of §5, and ezdxf's implementation (`ezdxf:src/ezdxf/render/dim_base.py`, `dim_linear.py`,
`dim_radius.py`, `dim_diameter.py`, `dim_curved.py`, `dim_ordinate.py`). ezdxf itself says
"ezdxf will NEVER render exact like AutoCAD" (ezdxf#77) and uses a monospace width estimate
`len(text)·height·width_factor` (`dim_base.py:641-648`). truedxf must use real font metrics.

### 6.1 Effective values

- `S = DIMSCALE`; if S == 0: model-space dims: S from viewport/"scale to layout" (§14),
  otherwise 1 (ezdxf/GDAL: treat 0 as 1, `dim_base.py:968-971`).
- Sizes multiplied by S: DIMASZ, DIMEXO, DIMEXE, DIMDLE, DIMGAP, DIMTXT, DIMCEN, DIMTSZ, DIMFXL,
  DIMDLI. Not scaled: measurement, DIMRND, DIMTP/DIMTM, DIMLFAC.
- Text height = STYLE fixed height (40) if ≠ 0 else DIMTXT; then ×S (ezdxf
  `get_char_height`, `dim_base.py:1339-1345` — ezdxf does not apply S to a fixed style height;
  **UNKNOWN** in AutoCAD). Width factor from STYLE 41.
- Text style = DIMTXSTY (fallback Standard). Text color DIMCLRT; dim line + arrows DIMCLRD;
  ext lines DIMCLRE; center marks: ezdxf uses DIMCLRD, netDxf uses DIMCLRE
  (`netDxf:Entities/DimensionBlock.cs:402-440`) — **CONFLICT/UNKNOWN**.
- Ticks: if DIMTSZ > 0 arrows are replaced by oblique strokes. ezdxf draws `_Oblique` scaled
  `2·DIMTSZ` ("tick size is per definition double the size of arrow size",
  `dim_base.py:367-374`); the `_Oblique` block spans ±0.5 so a tick spans ±DIMTSZ along both
  axes (**ASSUMPTION**; exact AutoCAD tick entity type unknown — probably LINE with DIMLWD).

### 6.2 Linear / aligned

1. Dimension line direction `d` = angle 50 (linear) or 13→14 (aligned; 50 stored too).
   Extension line direction `e` = 50 + 52 (oblique; default 90). Ext line base points: 13, 14.
2. Dim line endpoints P1, P2 = intersections of the line through 10 with direction `d` with the
   ext lines through 13 and 14 along `e`. (10 should equal P2.)
3. Measurement `m = |P2−P1|` (projection), displayed value `m·DIMLFAC` (DIMLFAC<0 → |DIMLFAC|
   in paper space only, 1 in model space; `netDxf:DimensionBlock.cs:86-99`).
4. Text string (§7), text width `w`, height `h` from real glyph extents.
5. Fit decision (AutoCAD docs; ezdxf only partially):
   - Room required for everything inside: `2·DIMASZ + 2·DIMGAP (dim-line stubs) + 2·DIMGAP
     (gaps around text) + w` when the text breaks the dim line (DIMTAD=0 and |DIMTVP|<0.7);
     when text is above/below: `max(w, 2·(DIMASZ+DIMGAP))` — "Text placed above or below the
     dimension line is moved inside only if there is room for the arrowheads, dimension text,
     and a margin between them at least as large as DIMGAP: 2·(DIMASZ+DIMGAP)"
     (DIMGAP help; `dimstyle_table.rst:118-128`). ezdxf uses
     `w + 2·DIMASZ` (centered) or `w` (above) vs `m`, and `arrows_outside = 2·DIMASZ + DIMGAP >
     m` (`dim_linear.py:103-135`).
   - DIMATFIT (when not everything fits): 0 both outside; 1 arrows first (move text out first,
     keep arrows inside if they fit, else both out); 2 text first (keep text inside if it fits,
     arrows out); 3 best fit (whatever fits: text only or arrows only inside) — Fit tab help
     (https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-LT/files/GUID-17FAE4A5-34C7-4D87-BFC5-E3791C083E73.htm).
     ezdxf ignores DIMATFIT (behaves like 2).
   - DIMTIX=1: text always inside (ezdxf re-centers wide text: halign→0).
   - DIMSOXD=1 (only with DIMTIX=1): arrows that do not fit are suppressed.
   - DIMTOFL=1: dim line drawn between ext lines even when arrows are outside.
6. Arrows inside: arrow 1 at P1 rotated `d+180`, arrow 2 at P2 rotated `d`; dim line shortened
   by the arrow's "length" (1·DIMASZ for most arrows, 0 for ORIGIN_ZERO arrows: `_ArchTick,
   _Oblique, _DotSmall, _Small, _Integral, _None` — ezdxf `arrows.py:424-431`; GDAL list
   identical, `ogrdxf_leader.cpp:1170-1172`).
   Arrows outside: rotations swapped (pointing inward), and ezdxf adds dim-line extension
   stubs of length DIMASZ beyond each arrow (`dim_linear.py:410-440`) — AutoCAD draws such
   stubs too (**ASSUMPTION**, typical appearance; length **UNKNOWN**).
   Flip-arrow flags 74/75 invert the respective arrow direction (**ASSUMPTION**).
7. DIMDLE: dim line extends DIMDLE past the ext lines only for ticks/tick-like arrows
   (`_ArchTick, _Oblique, _None, _Small, _Integral, _DotSmall` — ezdxf
   `EXTENSIONS_ALLOWED`; netDxf only `_Oblique,_ArchTick,_Integral,_None`,
   `DimensionBlock.cs:195-236`) — **CONFLICT** in the lists; S1 `*D8` confirms for ArchTick.
8. DIMSD1/DIMSD2 suppress the dim line half on the ext-line-1/2 side *and its arrow*; "half" is
   split at the text, not at the geometric middle (ezdxf splits at the middle, TODO note,
   `dim_linear.py:456-492`).
9. Extension lines: from `origin + DIMEXO·e` to `P + DIMEXE·e`; with DIMFXLON=1 from
   `P − DIMFXL·e` (but not closer than DIMEXO to the origin — "DIMEXO determines the minimum
   offset", DIMEXO docs) to `P + DIMEXE·e` (`dim_linear.py:493-520`; ezdxf ignores the
   minimum). DIMSE1/2 suppress. Linetypes DIMLTEX1/2, lineweight DIMLWE, color DIMCLRE.
   With DIMJUST 3/4 the respective ext line is lengthened by the text width
   (`dim_linear.py:516`).
10. Text location (default position):
   - DIMJUST 0: centered on the dim line; 1/2: next to ext line 1/2 at distance
     `DIMASZ + DIMGAP + w/2` from the ext line (ezdxf; AutoCAD docs describe "twice the
     arrowhead size plus the text gap" — **CONFLICT/UNKNOWN**); 3/4: over ext line 1/2,
     rotated parallel to the ext line, `DIMEXE + w/2` along it, `DIMGAP + h/2` beside it
     (`dim_linear.py:285-300`).
   - DIMTAD: 0 centered (plus `DIMTVP·h` shift; the dim line is broken only if |DIMTVP|<0.7);
     1 above (DIMGAP between dim line and text bottom); 2 "outside" = on the side away from the
     defining points; 3 JIS (above, but always left-aligned with ext line? — **UNKNOWN**);
     4 below. "Above" for DIMTAD=1 when the dim line is not horizontal and DIMTIH=1: text is
     centered instead (DIMTAD docs, `dimstyle_table.rst:167-172`).
   - Text outside: ezdxf moves it above the dim line at the center (`DIMEXE + DIMGAP + h/2`
     offset) — AutoCAD places outside text *beside* the second ext line with a dim-line
     extension (DIMTMOVE=0 behaviour "beside the dimension line") — **UNKNOWN exact
     rule**, needs AutoCAD tests.
   - User position (70 bit 128): text midpoint = 11. DIMTMOVE: 0 → dim line moves with the
     text (the text stays on the dim line, 10 updated), 1 → leader from dim line middle to the
     text (omitted if the text is close), 2 → no leader.
11. Text rotation: 53 if present; else aligned with `d` inside/outside unless DIMTIH (inside)
    / DIMTOH (outside) → horizontal (w.r.t. UCS = OCS rotated by −51). Readability: text
    angles in (90°, 270°] are flipped by 180° (ezdxf `normalize_text_angle`,
    `tools/__init__.py:148-160`; curved dims use a ±3° hysteresis
    `is_upside_down_text_angle`, `tools/text.py:1694-1706`). **UNKNOWN**: AutoCAD's exact
    flip boundary (vertical dims read bottom→top, i.e. 90° is *not* flipped, S1 `*D7`).
12. Box (DIMGAP<0): rectangle around the text at distance |DIMGAP| (ezdxf does not implement).
13. Defpoints: POINT at 13, 14, 10 on layer Defpoints.

### 6.3 Radius / diameter (ezdxf `dim_radius.py`, `dim_diameter.py`)

- Default: text outside unless DIMTIX. Text outside + DIMTOH: horizontal landing: text placed
  at `center + dir·(r + 2·DIMASZ)` plus `w/2` sideways (sign by side of the circle), horizontal
  line under/next to text. Text outside aligned: radial extension of length `DIMGAP + w`.
- Text inside: radius: midway between center and arrow; diameter: at center.
- Arrow at 15 (and at 10 for diameter when the dim line spans the circle).
- DIMTOFL=1 with text outside: radius: line center→15 (S1 `*D10`); diameter: line across.
  DIMTOFL=0: no inner line, but center mark (DIMCEN) instead (ezdxf `add_center_mark`).
- Center mark (DIMCEN ≠ 0, "drawn only if the dimension line is outside the circle", DIMCEN
  docs): cross with arms ±|DIMCEN| (ezdxf uses DIMCEN *unscaled* — probably a bug; netDxf
  scales by DIMSCALE); DIMCEN < 0 adds center lines from `2·|DIMCEN|` to `r + |DIMCEN|`
  (`dim_radius.py:430-488`). Diameter prefix `Ø`, radius `R` (§7.5).
- Jogged radius (LARGE_RADIAL_DIMENSION): dim line from the override center (14) to the chord
  point with a zig-zag of angle DIMJOGANG at the jog point; ezdxf does not render it.
  **UNKNOWN** geometry.

### 6.4 Angular / arc length (ezdxf `dim_curved.py`)

- Center: vertex (15 for 3-point; line intersection for 2-line); radius = distance to the arc
  location point (10 or 16). Extension line start: which of the two line end points is closer
  to the arc (`detect_closer_defpoint`, `dim_curved.py:955-966`), offset DIMEXO, extension
  DIMEXE beyond the arc; no ext line if the arc lies on the line segment itself
  (**ASSUMPTION**).
- Fit: text/arrows fit if `arc_span > (w + gaps + 2·DIMASZ)/r` (chord ignored;
  `fits_into_arc_span`), text outside uses 1.1× margin (ezdxf heuristic).
- Arrows tilted by `DIMASZ/(2r)` (§5.4); arc shortened by `DIMASZ/r` per arrow.
- Text default at the arc middle angle, `r + DIMGAP + h/2` for DIMTAD≠0; tangential orientation
  with readability flip. ezdxf ignores DIMTIH/DIMTOH/DIMJUST/DIMDLE for angular dims ("at least
  by BricsCAD", `dim_curved.py:724-731`).
- Arc length measures `arc_span·r_arc` where `r_arc = |13 − 15|`; `ARC_DIMENSION 70=1` partial
  arc and leader (71, 16, 17) when the dim arc is not over the measured arc (**UNKNOWN**
  rendering).

### 6.5 Ordinate

§5.7; text rotation 0 (Y-type) or 90° (X-type) + horizontal direction; X-type measures along
local x = rotated by −51. ezdxf ignores user text location and always recomputes 11
(`dim_ordinate.py:24-30`). The ordinate leader uses **extension line** properties
(DIMCLRE/DIMLTEX1/DIMLWE) (`dim_ordinate.py:177`).

### 6.6 Multi-line / wide text and moved text

- ezdxf: `is_wide_text` if required space > measurement, then text outside
  (`dim_linear.py:118-127`); with DIMTMOVE=1 a two-segment leader from the dim line center to
  the nearer bottom corner of the text box (`order_leader_points`,
  `get_center_leader_points`, `dim_base.py:1243-1270`), leg length = DIMASZ.
- AutoCAD: DIMTMOVE=1 leader "omitted if text remains close" (Fit tab help).

---

## 7. Dimension text formatting

### 7.1 Linear values

Pipeline (ezdxf `format_text`, `dim_base.py:74-99`; netDxf `FormatDimensionText`):
`value = measurement · DIMLFAC` → round to DIMRND (if > 0) → format by DIMLUNIT with DIMDEC →
zero suppression DIMZIN → decimal separator DIMDSEP → prefix/suffix DIMPOST
(`pre<>suf`, or suffix only if no `<>`; ezdxf raises for DIMPOST without `<>`,
`dim_base.py:101-106` — AutoCAD treats a DIMPOST without `<>` as suffix (DIMPOST docs:
"to establish a suffix for millimeters, set DIMPOST to mm") → **CONFLICT**, follow AutoCAD).
DIMPOST applies to tolerances too ("the suffix is applied to the tolerances as well",
`dimstyle_table.rst:95-99`) — ezdxf does *not* apply it to tolerances (`dim_base.py:225`)
→ **CONFLICT**.

DIMZIN:
- bit 4 (value 4): suppress leading zeros `0.5000 → .5000`; bit 8: trailing zeros
  `12.5000 → 12.5` (and `12.0000 → 12` — decimal separator removed, **ASSUMPTION**).
- values 0-3 (feet/inch only): 0 suppress zero feet and precisely zero inches; 1 include both;
  2 include zero feet, suppress zero inches; 3 include zero inches, suppress zero feet.
- S1 `*D8` (DIMZIN=8 via DSTYLE, DIMLUNIT=4, DIMFRAC=1, measurement 48.3636"):
  `4'-0{\H1x;\S1#4;}"` = 4'-0¼" — the whole-inch `0` before a fraction is kept and the
  fraction follows without a space. (48.36" → ¼" precision: DIMDEC 2 ⇒ 1/2² = 1/4.)
DIMLUNIT: 1 scientific (`1.5E+01`), 2 decimal, 3 engineering (feet + decimal inches
`1'-6.50"`), 4 architectural (feet-inches-fraction, fraction *always stacked*), 5 fractional
(always stacked), 6 Windows desktop (locale). Fraction precision for 4/5 is `1/2^DIMDEC`.
Stacked fractions are MTEXT `\S` with DIMFRAC 0 `a/b` horizontal bar (`\Sa/b;`), 1 diagonal
(`\Sa#b;`), 2 not stacked (plain `a/b`); fraction height `\H<DIMTFAC>x;` (S1 `*D8`).
netDxf implements all unit types (`netDxf:Units/LinearUnitFormat.cs`, via
`DimensionBlock.cs:100-126`) — useful reference for exact strings (**ASSUMPTION** that netDxf
mimics AutoCAD).

### 7.2 Angular values

DIMAUNIT: 0 decimal degrees + `°` (AutoCAD writes `°` as `\U+00B0`, S1 `*D4`), 1 DMS
`45°30'15"` with precision classes (ezdxf: DIMADEC 0 → `d°`, 1-2 → `d°m'`, 3-4 → `d°m's"`,
≥5 → seconds with `DIMADEC−4` decimals, `dim_curved.py:70-82`), 2 grads suffix `g`, 3 radians
suffix `r`. DIMADEC = −1 ⇒ use DIMDEC (netDxf `DimensionBlock.cs:56`). DIMAZIN: 1 leading,
2 trailing, 3 both. DIMRND and DIMLFAC do not apply to angles. Angular tolerances are
interpreted in DIMAUNIT units (ezdxf `AngularTolerance`, `dim_curved.py:116-160`).

### 7.3 Alternate units (DIMALT)

`alt = measurement·DIMALTF` rounded to DIMALTRND, DIMALTU format, DIMALTD decimals, DIMALTZ
zero suppression, DIMAPOST prefix/suffix (`[]` placeholder); displayed after the primary value
in brackets: `10"[254.00mm]` (DIMAPOST docs quoted in `dimstyle_table.rst:58-63`); DIMALTTD/
DIMALTTZ for alt tolerances. Position of alt text (beside vs below, DIMAPOST `\X`) —
**UNKNOWN**; ezdxf does not implement DIMALT.

### 7.4 Tolerances and limits

- DIMTOL=1: if DIMTP == DIMTM: `value±tol` (single), else stacked `+DIMTP` over `−DIMTM`
  (DIMTM displayed negated; a plus sign added for positive upper values, `-` for… see
  `dimstyle_table.rst:209-216`). DIMTDEC decimals, DIMTZIN zero suppression, text height
  `DIMTXT·DIMTFAC`, vertical justification DIMTOLJ (0 bottom, 1 middle, 2 top).
- DIMLIM=1: stacked `value+DIMTP` over `value−DIMTM` replacing the measurement.
- ezdxf MTEXT templates (`dim_base.py:51-55`):
  `\A<tolj>;<value>{\H<tfac>x;<tol>}` (single, tol = `±0.10`),
  `\A<tolj>;<value>{\H<tfac>x;\S<upper>^ <lower>;}` (stacked, note the space after `^`),
  limits `{\H<tfac>x;\S<upper>^ <lower>;}`. ezdxf uses a line spacing guess 1.35 (BricsCAD).
  Whether AutoCAD writes exactly these codes: **UNKNOWN** (need a sample with DIMTOL); the
  `\A<n>;` prefix fits the observed `\A1;` of §5.3.
- DIMTP/DIMTM are *not* scaled by DIMLFAC (DIMLFAC docs).

### 7.5 Automatic prefixes & symbols

- Radius `R`, diameter `Ø`: AutoCAD writes `∅` U+2205 (S1 `*D11`); `%%c` in DXF text maps to
  the diameter glyph of the font (text note). DIMPOST prefix *replaces* the automatic prefix?
  netDxf: prefix = DIMPOST prefix if set, else `R`/`Ø` (`DimensionBlock.cs:128-137`) —
  **UNKNOWN** for AutoCAD.
- Arc length symbol: separate ARC (§5.5), controlled by DIMARCSYM.
- DIMTXTDIRECTION=1: right-to-left reading (UI only?) — **UNKNOWN** effect on geometry.

---

## 8. Colors, linetypes, lineweights of dimension parts

| part | color | linetype | lineweight |
|---|---|---|---|
| dimension line, arrows, leader (radial/moved text), center marks (ezdxf) | DIMCLRD | DIMLTYPE | DIMLWD |
| extension lines, ordinate leader | DIMCLRE | DIMLTEX1 / DIMLTEX2 | DIMLWE |
| text (and text frame box?) | DIMCLRT | – | – (**UNKNOWN** for the box) |
| text background | DIMTFILL/DIMTFILLCLR | | |

- All default BYBLOCK (0 / ByBlock / −2) so the DIMENSION's own properties show through
  (S1 blocks: `62=0 370=-2 440=16777216`).
- S1 `*D22` (`custom_style_ltypes`: DIMCLRD=4, DIMCLRE=6, DIMLWD=15, DIMLTYPE=BATTING,
  DIMLTEX1=TRACKS, DIMLTEX2=ZIGZAG): ext lines `6=TRACKS/ZIGZAG 62=6 370=-2`, dim line
  `6=BATTING 62=4 370=15`, arrow INSERTs `62=4 370=15` (arrows take dim line color *and
  lineweight* but no linetype), MTEXT `62=0`.
- ezdxf bug history: arrow blocks not using DIMCLRD (ezdxf#898, fixed; CHANGELOG line 399).
- Linetype scale: AutoCAD writes no 48 on block entities; LTSCALE × entity scale (DIMENSION 48)
  × INSERT-like BYBLOCK rules apply (**ASSUMPTION**; see linetype note).
- Arrow blocks are defined with `8=0, 62=0 (BYBLOCK), 6=ByBlock, 370=-2` (§10) → they take
  the INSERT's properties.

---

## 9. Where things live (quick map)

- Display/plot differences, DIMSCALE=0, annotative scales: §14.
- Arrow blocks: §10. LEADER: §11. MULTILEADER: §12. TOLERANCE: §13.
- Conflicts/unknowns summary: §15; implementation checklist: §16; tests at the end.

## 10. Built-in arrowheads

### 10.1 Names and resolution

DIMBLK/DIMBLK1/DIMBLK2/DIMLDRBLK reference a BLOCK_RECORD (R2000+ handle) or a name (R12,
header vars). The UI names map to block names with a leading underscore; the header/R12 value
is written *without* the underscore (S1 `$DIMBLK=BoxBlank`, block `_BoxBlank`), ezdxf
`ARROWS.block_name()/arrow_name()` (`ezdxf:src/ezdxf/render/arrows.py:505-530`). Name
comparison must be case-insensitive (`_OPEN`, `_DOT`, `_NONE` seen upper-case in real files).

| UI name | block | ezdxf const | length used for dim-line shortening |
|---|---|---|---|
| Closed filled | `""` / handle 0 (no block; AutoCAD emits SOLID; ezdxf `_CLOSEDFILLED` block) | `""` | 1 |
| Closed blank | `_ClosedBlank` | CLOSEDBLANK | 1 |
| Closed | `_Closed` | CLOSED | 1 |
| Dot | `_Dot` | DOT | 1 |
| Architectural tick | `_ArchTick` | ARCHTICK | 0 (+DIMDLE) |
| Oblique | `_Oblique` | OBLIQUE | 0 (+DIMDLE) |
| Open | `_Open` | OPEN | 1 |
| Origin indicator | `_Origin` | ORIGIN | 1 |
| Origin indicator 2 | `_Origin2` | ORIGIN2 | 1 |
| Right angle | `_Open90` | OPEN90 | 1 |
| Open 30 | `_Open30` | OPEN30 | 1 |
| Dot small | `_DotSmall` | DOTSMALL | 0 |
| Dot blank | `_DotBlank` | DOTBLANK | 1 |
| Small | `_Small` | SMALL | 0 |
| Box | `_BoxBlank` | BOXBLANK | 1 |
| Box filled | `_BoxFilled` | BOXFILLED | 1 |
| Datum triangle | `_DatumBlank` | DATUMBLANK | 1 |
| Datum triangle filled | `_DatumFilled` | DATUMFILLED | 1 |
| Integral | `_Integral` | INTEGRAL | 0 |
| None | `_None` | NONE | 0 |

Zero-length set: ezdxf `ORIGIN_ZERO` (`arrows.py:424-431`) equals the GDAL list
(`_ArchTick, _DotSmall, _Integral, _None, _Oblique, _Small`, `ogrdxf_leader.cpp:1170`) —
agreement between two independent sources. ezdxf also has private `EZ_ARROW*` arrows
(not AutoCAD). netDxf uses a shorter list (`_Oblique, _ArchTick, _Integral, _None`,
`netDxf:Entities/DimensionBlock.cs:195-236`) — **CONFLICT** for `_DotSmall`/`_Small`.

A user block can be used as arrow: it is inserted exactly like the built-ins (INSERT, scale
DIMASZ·DIMSCALE, rotation along the dim line); treat user blocks as length 1
(**ASSUMPTION**, same as GDAL).

### 10.2 Insertion semantics

Every arrow block is defined for the *right* end of a dimension line pointing right: tip at
(0,0), body toward −x, unit size (`arrows.py:17-18` "->|"; GDAL "Arrowhead blocks always
point to the right"). Insert at the tip point with `scale = DIMASZ·DIMSCALE` (x = y = z) and
rotation = direction from the dim line interior toward the tip (arrow 2: dim-line angle;
arrow 1: +180°; outside arrows: opposite) (S1 `*D8`, `*D22`). The dim line connects to
`tip − length·scale·dir` (§10.1 lengths).

For curved dims the insertion rotation is tilted by `±asz/(2r)` so that the base lies on the arc
(§5.4). For LEADER/MLEADER the rotation is `angle(v1 − v0) + 180°`, i.e. the block's −x axis
points along the first segment (ezdxf `render/leader.py:108`, `render/mleader.py:736`).

### 10.3 Geometry at unit size

"AutoCAD" rows are decoded from AutoCAD-written DXF files (**VERIFIED-BY-ACAD**; block contents
printed with `8=0 62=0 6=ByBlock 370=-2` stripped). Other rows are ezdxf's reconstruction
(`arrows.py`) — **needs an AutoCAD sample**.

| block | source | entities (unit size) |
|---|---|---|
| closed filled | AutoCAD S1/S2 (as SOLID in `*D`) | SOLID tip (0,0), base (−1, ±1/6) (GDAL `GenerateDefaultArrowhead` "3:1 aspect ratio", netDxf `ArrowSize/6`) |
| `_ClosedBlank` | AutoCAD (ACadSharp samples) | 3 LINEs: (−1, 1/6)→(0,0), (0,0)→(−1,−1/6), (−1,1/6)→(−1,−1/6) |
| `_Closed` | ezdxf | closed triangle as `_ClosedBlank` + LINE (0,0)→(−1,0) |
| `_Open` | AutoCAD (dxf-parser sample `api-cw750-details.dxf`) | LINEs (−1,1/6)→(0,0), (0,0)→(−1,−1/6), (0,0)→(−1,0) |
| `_Open30` | AutoCAD (bjnortier `dimension-vertical.dxf`) | LINEs (−1, tan15°=0.26794919)→(0,0), (0,0)→(−1,−0.26794919), (0,0)→(−1,0) |
| `_Open90` | AutoCAD (same file) | LINEs (−0.5,0.5)→(0,0), (0,0)→(−0.5,−0.5), (0,0)→(−1,0) |
| `_ArchTick` | AutoCAD (18 files) | LWPOLYLINE (−0.5,−0.5)→(0.5,0.5), const width 0.15 |
| `_Oblique` | AutoCAD | LINE (−0.5,−0.5)→(0.5,0.5) |
| `_BoxBlank` | AutoCAD | 4 LINEs square ±0.5 + LINE (−0.5,0)→(−1,0) |
| `_BoxFilled` | AutoCAD (gdal `byblock-bylayer.dxf`) | SOLID (−0.5,0.5),(0.5,0.5),(−0.5,−0.5),(0.5,−0.5) + LINE (−0.5,0)→(−1,0) |
| `_DatumFilled` | AutoCAD (bjnortier) | SOLID (0,0.57735),(−1,0),(0,−0.57735): flat side at the insertion point, apex at −1 |
| `_DatumBlank` | ezdxf | closed polyline (0,0.57735),(0,−0.57735),(−1,0) |
| `_Dot` | AutoCAD (bjnortier `testHatch.dxf`) | LWPOLYLINE closed, vertices (−0.25,0),(0.25,0) bulge 1, const width 0.5 (= filled disc r 0.5) + LINE (−0.5,0)→(−1,0) |
| `_DotSmall` | AutoCAD (bjnortier `alu-profile.dxf`, AC1032 written by AutoCAD) | LWPOLYLINE closed, vertices (±0.0625,0) bulge 1, **const width 0.5** (⇒ disc r 0.3125) |
| `_DotBlank` | ezdxf | CIRCLE r 0.5 + LINE (−0.5,0)→(−1,0) |
| `_Small` | netDxf sample (netDxf copies AutoCAD's definitions) | CIRCLE r 0.25 at origin |
| `_Origin` | ezdxf | CIRCLE r 0.5 + LINE (0,0)→(−1,0) |
| `_Origin2` | ezdxf | CIRCLEs r 0.5 and r 0.25 + LINE (−0.5,0)→(−1,0) |
| `_Integral` | ezdxf | 2 ARCs r = 0.3535534: center (−r,0) from −90° to 0°, center (+r,0) from 90° to 180° |
| `_None` | AutoCAD (9 files) | empty block |

**CONFLICTs with ezdxf** (ezdxf computes half-widths as `sin(angle/2)` at x = −1,
`ezdxf:src/ezdxf/render/forms.py:182-194`): closed/open arrows 0.16440 vs AutoCAD 1/6 =
0.16667; `_Open30` 0.25882 vs 0.26795 (tan 15°); `_Open90` legs to (−1, ±0.7071) vs AutoCAD
(−0.5, ±0.5); `_DotSmall` disc r 0.125 (ezdxf) vs 0.3125 (one AutoCAD sample — surprising,
re-check with a second AutoCAD file). truedxf should synthesize missing arrow blocks from the
AutoCAD rows.

If the referenced arrow block is missing: AutoCAD normally writes the `_X` block definitions
into the DXF when used; fall back to synthesizing it (GDAL falls back to the default arrow,
`ogrdxf_leader.cpp:1112-1121`).

---

## 11. LEADER entity

### 11.1 Group codes (`AcDbLeader`, `spec L4810-4870`, `ezdxf:entities/leader.py:40-140`)

| code | meaning | default |
|---|---|---|
| 3 | dimstyle name | Standard |
| 71 | arrowhead flag 0/1 | 1 ("spec is silent as to default, but AutoCAD assumes true", GDAL `ogrdxf_leader.cpp:71`) |
| 72 | path type 0 straight, 1 spline | 0 |
| 73 | creation flag: 0 text (MTEXT), 1 tolerance, 2 block ref, 3 none | 3 |
| 74 | hook-line direction flag | see CONFLICT below |
| 75 | hook-line flag 0/1 | – |
| 40 | text annotation height | |
| 41 | text annotation width | |
| 76 | number of vertices | |
| 10 | vertices (WCS), first = arrow point | ≥2 |
| 77 | color to use if DIMCLRD = BYBLOCK | |
| 340 | hard ref to annotation (MTEXT/TOLERANCE/INSERT) | |
| 210 | normal | 0,0,1 |
| 211 | "horizontal" direction | 1,0,0 |
| 212 | offset of last vertex from block insertion point | |
| 213 | offset of last vertex from annotation placement point | |

**CONFLICT (74):** spec says 0 = hook opposite to 211, 1 = same direction (`spec L4845-4850`);
ezdxf ("DXF reference error: swapped meaning", `entities/leader.py:80-86`) and GDAL ("a value
of 0 actually indicates no flipping occurs, and 1 (flip) is the default",
`ogrdxf_leader.cpp:141-145`) say 1 = opposite. S1 leader `512` (AutoCAD): `74=0`, hook along
+X = along 211 → supports ezdxf/GDAL. ACadSharp#1216: AutoCAD 2027 writes `75=1` also for
hooks toward −X.

XDATA `ACAD DSTYLE` overrides apply (spec, GDAL). ezdxf defaults `dimgap 0.625 / 0.0625` and
`dimasz 2.5 / 0.1875` by `$MEASUREMENT` (`render/leader.py:31-40`) — for AutoCAD fidelity use
the dimstyle chain of §2-3 instead (imperial DIMASZ default is 0.18, not 0.1875).

S1 leader `512` (AutoCAD, ISO-25): `73=0 74=0 75=1 40=1.8448 41=16.374 76=4`, last segment
from (737.899,14.072) to (740.399,14.072) = **2.5 = DIMASZ** along +X: AutoCAD stores the hook
line as a real last vertex of length DIMASZ·DIMSCALE (**VERIFIED-BY-ACAD**; ACadSharp#1216).

### 11.2 Rendering (AutoCAD behaviour as reconstructed)

1. Vertices connected by straight LINE segments (72=0) or a spline (72=1).
2. **Spline** (72=1): vertices are fit points of a degree-3 spline, fit tolerance 0, start
   tangent = direction of the first segment, end tangent = direction of the last segment (or
   the hook direction 211 when there is text annotation) (atlight.github.io/formats/dxf-leader.html
   — the reference ezdxf cites, `render/mleader.py:77`; GDAL `InterpolateSpline`,
   `ogrdxf_leader.cpp:230-244`, which recommends chord-length parametrisation, knot vector
   `0…0 params 1…1` and tangents multiplied by the total chord length "to fully match
   AutoCAD"; ezdxf `fit_points_to_cad_cv` with tangents, `render/leader.py:84-90`).
   A spline with only 2-3 vertices must still render (degree reduced; mlightcad-realdwg-web#174).
3. **Arrowhead** (71=1 and ≥2 vertices): block DIMLDRBLK (default closed filled) at vertex 0,
   size `DIMASZ·DIMSCALE` (DIMSCALE 0 → 1), rotation along segment 0; the first segment is
   shortened by the arrow length (1·size, or 0 for zero-length arrows). **AutoCAD omits the
   arrowhead if `size > ½·length(first segment)`** (GDAL `InsertArrowhead`,
   `ogrdxf_leader.cpp:1101-1108`; the same rule appears independently in ezdxf's MLEADER
   renderer). ezdxf's LEADER renderer neither shortens the line nor applies the rule
   (`render/leader.py:95-126`) → ezdxf is less faithful here.
4. **Extension under text** (not stored!): if `DIMTAD ≠ 0` and `73 = 0` (text annotation) and
   `41 > 0`, append a vertex `last + (DIMGAP·DIMSCALE + 41)·h`, `h = 211` (default (1,0,0)),
   negated if 74 = 1 (GDAL `ogrdxf_leader.cpp:196-222` "needed to replicate the way AutoCAD
   displays leader objects"; atlight formula; ezdxf additionally requires 75=1,
   `render/leader.py:64-70`).
5. Color: DIMCLRD; if BYBLOCK, use 77 (ezdxf; spec). Linetype DIMLTYPE, lineweight DIMLWD
   (ezdxf). GDAL uses DIMCLRD only if > 0.
6. The annotation (MTEXT etc.) is a separate entity rendered on its own; 340 only links it.

**UNKNOWN**: what AutoCAD does for LEADERs from other writers with 75=1 but no stored hook
vertex; whether the extension of step 4 uses DIMCLRD/DIMLWD.

---

## 12. MULTILEADER (MLEADER) and MLEADERSTYLE

Entity name in DXF is always `MULTILEADER` (alias `MLEADER` accepted on import). Colors are
**raw 32-bit color values** (`0xC1000000` = BYBLOCK = −1056964608, `0xC0000000` = BYLAYER =
−1073741824, `0xC2rrggbb` true color, `0xC3000000|aci` ACI) (ezdxf
`docs/source/dxfinternals/entities/mleader.rst`, `render/mleader.py:217-227`, S1).

### 12.1 Structure (`ezdxf:docs/source/dxfinternals/entities/mleader.rst`, S1 entity `7B8`)

```
100 AcDbMLeader
270 2                       version
300 CONTEXT_DATA{
  40  content scale (overall scale)
  10  content base point (NOT the MTEXT insert: start of the leader on the LEFT side of the
      content for horizontal attachment, BOTTOM side for vertical — entities/mleader.py:708-721)
  41  text height (already scaled)
  140 arrowhead size (scaled)
  145 landing gap (scaled)
  174 text left attachment, 175 text right attachment, 176 text align type (0 L,1 C,2 R),
  177 attachment type (0 content extents, 1 insertion point)
  290 has MTEXT content  -> if 1, MTEXT block follows:
      304 text (MTEXT content string)   11 normal   340 text style
      12 text location (= MTEXT insert)  13 text direction  42 rotation (rad)
      43 width  44 defined height  45 line spacing factor  170 line spacing style
      90 color (raw)  171 attachment (1..9, MTEXT attachment point) 172 flow direction
      91 bg color (raw) 141 bg scale factor 92 bg transparency 291 use window bg color
      292 has bg fill  173 column type  293 use auto height  142 column width
      143 gutter  294 column flow reversed  144 column sizes (repeat)  295 word break
  296 has BLOCK content  -> if 1:
      341 block record handle  14 normal  15 block location (WCS!)  16 scale vector
      46 rotation (rad)  93 color (raw)  47 x16 transformation matrix (transposed; not used by
      AutoCAD, BricsCAD needs it present — entities/mleader.py:1076-1086)
  110 plane origin  111 plane x-axis  112 plane y-axis  297 plane normal reversed
  302 LEADER{            (0..n)
      290 has last leader line (AutoCAD: leader invisible if 0; BricsCAD ignores)
      291 has dogleg vector
      10  last leader point = landing / dogleg start (WCS)
      11  dogleg vector (unit)
      12/13 dogleg break start/end (repeat)
      90  leader branch index
      40  dogleg length (scaled)
      304 LEADER_LINE{   (0..n)
          10 vertex (repeat, WCS; first = arrow tip)
          90 break index, 11 break start, 12 break end (repeat)
          91 leader line index
          92 color (raw)   (R2010+: 170 type, 171 lineweight, 340 linetype, 341 arrow,
                            40 arrow size, 93 override flags — ODA spec p.214-215)
      305 }
      271 attachment direction (0 horizontal, 1 vertical) R2010+
  303 }
  272 bottom attachment, 273 top attachment (R2010+)
301 }
340 MLEADERSTYLE handle
90  property override flags (bit list below)
170 leader type (0 invisible, 1 straight, 2 spline)
91  leader color (raw)  341 leader linetype  171 leader lineweight
290 enable landing  291 enable dogleg  41 dogleg length (unscaled)
342 arrowhead block (absent = closed filled)  42 arrowhead size (unscaled)
172 content type (0 none, 1 block, 2 MTEXT, 3 tolerance)
343 text style  173 text left attachment  95 text right attachment  174 text angle type
175 text alignment type  92 text color  292 text frame
344 block  93 block color  10 block scale  43 block rotation (rad)  176 block connection
    (0 center extents, 1 insertion point)
293 annotative
94/345  arrowhead index + handle (repeat, per leader line override)
330/177/44/302  block attribute: ATTDEF handle, index, width, text (repeat)
294 text direction negative  178 text align in IPE  179 text attachment point (1 L,2 C,3 R)
45  scale (R2007+)  271 text attachment direction  272 bottom / 273 top attachment type
295 leader extended to text (R2013+)
```

Group-code reuse (302 both "LEADER{" and attribute text, 304 both "LEADER_LINE{" and MTEXT
content) forces a stateful parser that checks value strings (ezdxf `entities/mleader.py:242-250`;
GDAL "group codes mean different things in different sections of the MLEADER entity").
The spec lists only flat codes (`spec L5349-5520`) and omits the nesting.

S1 MULTILEADER (AutoCAD, imperial Standard mleader style): context `41=0.18 140=0.18 145=0.09`,
LEADER `10=(1083.321, 23.239) 11=(1,0,0) 40=0.36`, one LEADER_LINE with a single vertex
(1050.24, 8.18) (so the leader is vertex → landing point → dogleg end); context base point
10 = (1083.681, 23.239) = landing point + dogleg (0.36); MTEXT insert 12 = (1083.771, 23.347)
= base point + landing gap (0.09) in x and +0.108 (= 0.6·text height) in y with MTEXT
attachment 171=1 (top left) and left attachment 173=1 ("middle of top line"); 90 override flags
279552 = bits 10, 14, 18. The entity also carries proxy graphics (160/310).
**VERIFIED-BY-ACAD** (data); interpretation of the 0.108 as "middle of the top line" offset for
Arial is an **ASSUMPTION** (ties to §5.3 and the MTEXT note).

Property override flag bits (ODA p.158 via ezdxf `render/mleader.py:93-125`): 0 leader type,
1 line color, 2 linetype, 3 lineweight, 4 enable landing, 5 landing gap(?), 6 enable dogleg,
7 dogleg length, 8 arrow block, 9 arrow size, 10 content type, 11 text style, 12 left
attachment, 13 text angle type, 14 text alignment, 15 text color, 16 text height, 17 text
frame, 18 use default MTEXT content, 19 block, 20 block color, 21 block scale, 22 block
rotation, 23 block connection, 24 scale, 25 right attachment, 26 text switch alignment,
27 attachment direction, 28 top attachment, 29 bottom attachment.

### 12.2 Enumerations

- Text left/right attachment (173/95 entity, 174/175 context): 0 top of top line, 1 middle of
  top line, 2 middle of text, 3 middle of bottom line, 4 bottom of bottom line, 5 bottom of bottom
  line + underline bottom line, 6 bottom of top line + underline top line, 7 bottom of top line,
  8 bottom of top line + underline all lines (`entities/mleader.py:141-153`).
- Top/bottom attachment (vertical attachment direction, 272/273): 9 center, 10 underline
  (bottom) / overline (top) and center.
- Text angle type (174): 0 = angle of last leader segment, 1 horizontal, 2 like 0 but flipped
  for readability.
- Content type (172): 0 none, 1 block, 2 MTEXT, 3 tolerance.
- Leader type (170): 0 invisible, 1 straight, 2 spline.

### 12.3 MLEADERSTYLE (object, `ezdxf:entities/mleader.py:1262-1320`, `spec L5231-5347`)

170 content type (2), 171 draw mleader order, 172 draw leader order, 90 max leader points (2),
40/41 first/second segment angle constraint, 173 leader type (1), 91 leader color (raw),
340 leader linetype, 92 lineweight (−2), 290 landing on, 42 landing gap (2.0), 291 dogleg on,
43 dogleg length (8), 3 description, 341 arrow block, 44 arrow size (4), 300 default MTEXT
content, 342 text style, 174 left attachment (1), 175 text angle type (1), 176 text alignment
type (0), 178 right attachment (1), 93 text color, 45 text height (4), 292 text frame,
297 text align always left, 46 align space (4), 343 block, 94 block color, 47/49/140 block scale
x/y/z, 293 enable block scale, 141 block rotation, 294 enable block rotation, 177 block
connection type, 142 scale, 295 overwrite property value, 296 annotative, 143 break gap size
(3.75), 271 attachment direction, 272 bottom attachment (9), 273 top attachment (9), 298 unknown
bool, 179 unknown (2). The defaults in parentheses are ezdxf's metric-ish ones; AutoCAD's
imperial "Standard" uses text 0.18 / landing gap 0.09 / dogleg 0.36 / arrow 0.18 (S1).

### 12.4 Precedence

ezdxf: "AutoCAD and BricsCAD always (?) use values stored in the MULTILEADER entity, even if the
override flag isn't set" → `IGNORE_OVERRIDE_FLAGS = True`; text height comes from context 41
(`render/mleader.py:80-84, 148-160`). Context values override the common section for duplicated
parameters (atlight). Scale: context 40 is the effective overall scale; ignore MLEADERSTYLE 142
(`render/mleader.py:357-359`). Scale ≈ 0 ⇒ render nothing (ezdxf `run()`).

### 12.5 Rendering (ezdxf `render/mleader.py:338-745`, atlight)

1. Content: MTEXT from context MTEXT data (insert 12, direction 13, width 43·scale, char
   height 41, attachment 171, style 340, raw colors → ACI/RGB, bg fill 292/91/141/92/291;
   rotation 42 ignored in favour of 13). Or INSERT of block 341 at 15 (WCS!, converted to OCS
   for an extruded plane), scale 16, rotation 46 (rad), color 93; attributes from 330/302 pairs
   (ATTDEF handle → tag). Text frame 292: not implemented by ezdxf; **UNKNOWN** geometry
   (probably MTEXT extents + landing gap).
2. Leaders (skip if leader type 0): for each LEADER, for each LEADER_LINE:
   vertices = line vertices + [last leader point 10] (+ dogleg end `10 + 11·40` if horizontal
   attachment and dogleg enabled). Spline leaders have no dogleg (ezdxf). atlight: dogleg only if
   `291≠0 && 170==1 && 40≠0 && |11|≠0`; GDAL: "When the dogleg is turned off or we are in spline
   mode, it seems that the dogleg and landing data are still present in the DXF file, but they
   are not supposed to be drawn".
3. Arrow at vertex 0 (block from 94/345 per line index, else 342, else closed filled), size
   context 140, rotation along the first segment; **omitted if the first segment is not longer
   than 2·arrow size** ("AutoCAD does not render the arrow-head, if the last distance is less
   than 2 times the size of the arrow-head", `render/mleader.py:655-657`); the first vertex is
   moved by the arrow length.
4. Spline leaders: fit spline with start tangent = arrow direction and end tangent = dogleg
   vector (horizontal attachment) or last segment.
5. Underline (attachment 5/6/8) from the connection point along the text direction, length
   `text width + landing gap`; overline/underline for vertical attachment (272/273 = 10) of text
   width centered at the last leader point.
6. Breaks (11/12 pairs in LEADER_LINE, 12/13 in LEADER for the dogleg): gaps in straight
   leaders only (atlight). ezdxf ignores breaks.
7. Colors: leader-line raw color 92 overrides the entity leader color unless BYBLOCK
   (`leader_line_attribs`); arrows use the leader line color (GDAL: "Arrowheads should be the
   same color as the leader line").

Known pitfalls: AutoCAD requires the redundant `ACDB_MLEADEROBJECTCONTEXTDATA_CLASS` object
(linked via the extension dictionary) for third-party MLEADERs to be visible (ACadSharp
MultiLeader discussions: "When I write the MultiLeaderObjectContextData as CadObject with
handle, the MultiLeader becomes visible"); MLEADER support is reliable only for R2010+
(ACadSharp); proxy graphics may disagree with the entity data (ezdxf#283); ezdxf estimates
MTEXT extents (`text_size.estimate_mtext_extents`) so its underline/landing lengths are
approximate. Proxy graphics are a usable fallback when our renderer lacks a feature, but
AutoCAD itself renders from entity data.

---

## 13. TOLERANCE (feature control frame, `AcDbFcf`)

### 13.1 Group codes (`spec L7034-7055`, `ezdxf:src/ezdxf/entities/tolerance.py`)

| code | meaning |
|---|---|
| 3 | dimstyle name (text height DIMTXT, gap DIMGAP, colors DIMCLRD/DIMCLRT, text style DIMTXSTY, scale DIMSCALE) |
| 10 | insertion point (WCS) |
| 1 | the frame description string |
| 210 | extrusion |
| 11 | x-axis direction (WCS) — rotation of the frame |

DSTYLE XDATA overrides apply (`spec L4213`). There is **no geometry block**: every consumer
must build the frame. netDxf stores a custom text height as XDATA (`netDxf:Entities/Tolerance.cs:145-160`).

### 13.2 String syntax (AutoCAD examples from S1/S2 and netDxf)

- Rows separated by `^J`; fields inside a row separated by `%%v`.
- Row layout for the two tolerance rows: `symbol %%v tol1 %%v tol2 %%v datum1 %%v datum2 %%v datum3`
  (≤ 6 fields, `netDxf:Entities/Tolerance.cs:500-506`). Row 3: projected tolerance zone value
  followed by `{\Fgdt;p}`; row 4: datum identifier (e.g. `A`) (`Tolerance.cs:240-280`).
- Symbols are single characters in the `gdt` SHX font, written as MTEXT font switch
  `{\Fgdt;x}`. Mapping (netDxf `Tolerance.cs:380-420, 590-620`):

| char | symbol | char | symbol |
|---|---|---|---|
| a | angularity | j | position |
| b | perpendicularity | k | profile of a line |
| c | flatness | l | LMC (least material) |
| d | profile of a surface | m | MMC (maximum material) |
| e | circularity/roundness | n | diameter Ø (tolerance zone) |
| f | parallelism | p | projected tolerance zone |
| g | cylindricity | r | concentricity/coaxiality |
| h | circular runout | s | RFS (regardless of feature size) |
| i | symmetry | t | total runout |
| u | straightness | | |

- AutoCAD samples: S1 `{\Fgdt;j}%%v{\Fgdt;n}%%v%%v%%v%%v^J{\Fgdt;d}%%v%%v%%v%%v%%v^J.5^J5`,
  `99^Ja`, `{\Fgdt;p}`; S2 `{\Fgdt;r}%%v1%%v2%%v%%v%%v^J10`. Note that rows may have fewer
  fields and free text (not only the canonical layout).
- The gdt font may be referenced as `gdt` or `GDT`; QCAD normalizes `\F[gG][dD][tT];`
  (`qcad:src/entity/RToleranceData.cpp:353-356`). truedxf needs a gdt.shx equivalent glyph
  set (font note).

### 13.3 Frame geometry (QCAD algorithm; AutoCAD rule **UNKNOWN**)

QCAD (`qcad:src/entity/RToleranceData.cpp:338-530`, LibreCAD port
`LibreCAD:.../entities/lc_tolerance.cpp:200-345`), with `t = DIMTXT·DIMSCALE`:
- Insertion point = left end of the vertical middle of the first row. Each row is `2t` high
  (from `−t` to `+t` around the row's center line); row k center at `y = −2t·k`.
- Fields are laid out left to right: cursor starts at `t/2`; each non-empty field is a text
  (height t, middle-left aligned at the cursor), then `cursor += text_width + t`; a vertical
  separator is drawn at `cursor − t/2` after each field and at x = 0. Empty fields produce
  nothing (no empty boxes).
- Top and bottom horizontal lines span from the first to the last separator of the row.
- If rows 1 and 2 have the same first field (composite symbol), the symbol is drawn once,
  moved down by t (centered over both rows) and the separating horizontal line starts after
  that field ("joinFirstField").
- Rows with only one division (no fields) are dropped.
- Rotation: by the angle of 11; everything relative to 10.

AutoCAD docs only say the frame height is derived from the text height and DIMGAP is the
gap between text and frame (Tolerances Tab help,
https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-BE52ACEE-A046-412D-AEC8-593B9DEB674D.htm).
**UNKNOWN / needs AutoCAD test**: whether the row height is `2·DIMTXT` or `DIMTXT + 2·DIMGAP`,
whether the field padding is DIMGAP or DIMTXT/2, and how the datum identifier row (boxed
letter) and projected-zone row are drawn. ezdxf does not render TOLERANCE (ezdxf#598,
ezdxf#1339, discussion #1365). mlightcad realdwg-web has an `AcDbFcf` implementation with
bounding-point tests (`mlightcad-realdwg-web:packages/data-model/__tests__/AcDbFcf.spec.ts`).
Colors: frame = DIMCLRD, text = DIMCLRT (QCAD `RToleranceData.cpp:367-430`) — **ASSUMPTION**.

---

## 14. Display vs plot, scaling and annotative dimensions

- **Defpoints layer**: POINTs of the `*D` block live on `Defpoints`, which AutoCAD never plots
  (netDxf creates it with `Plot = false`). Other entities placed on Defpoints by users also
  don't plot. Render them (optionally) on screen, never in plot mode.
- **DIMSCALE = 0** ("scale dimensions to layout"): for dimensions in model space AutoCAD
  computes the scale from the model-space viewport to paper space (1/viewport scale); in paper
  space and without viewports the factor is 1 (`dimstyle_table.rst:131-144`, Fit tab help).
  Only relevant for regeneration: the stored `*D` block was computed for one specific viewport
  scale at creation/last update.
- **DIMLFAC < 0**: applied only in paper space (for measurements of dims in paper space over
  viewports); in model space treated as 1 (`netDxf:DimensionBlock.cs:86-99`).
- **Annotative dimensions** (dimstyle XDATA `AcadAnnotative` `AnnotativeData {1070 1, 1070 1}`,
  S1 `Annotative` and `Beschriftung` styles, with `40=0.0` DIMSCALE): DIMSCALE is forced to 0
  and the scale comes from the annotation scale (CANNOSCALE / viewport annotation scale). Each
  supported scale has an `ACDB_ALDIMOBJECTCONTEXTDATA_CLASS` (and siblings for other dim types)
  object in the entity's extension dictionary (`AcDbContextDataManager` → `ACDB_ANNOTATIONSCALES`)
  with its **own `*D` block handle** (DXF group 2), text location (10), text rotation (140) and
  fit flags (DIMTOFL 298, DIMSOXD 291, DIMATFIT 70, DIMTIX 292, DIMTMOVE 71)
  (`libredwg:src/dwg2.spec:3617-3650, 4552-4559`; ACadSharp#556). Rendering rule
  (**ASSUMPTION**): in model space use the representation of `$CANNOSCALE`; in a paper-space
  viewport use the representation matching the viewport's annotation scale (if
  `ANNOALLVISIBLE=0` hide dims without that scale); the entity's own group 2 block is the
  representation of the "current" scale at save time. Same mechanism for MTEXT/MLEADER
  (`ACDB_MLEADEROBJECTCONTEXTDATA_CLASS`).
- **Text background mask** (DIMTFILL) and text frame (DIMGAP<0) are drawn identically on screen
  and in plot, except that background fill with "use drawing background color" (DIMTFILL=1) plots
  white (paper) rather than the screen background (**ASSUMPTION**, same as MTEXT bg mask →
  MTEXT note).
- **Lineweights**: DIMLWD/DIMLWE BYBLOCK resolve to the DIMENSION's lineweight; screen
  display depends on LWDISPLAY but plot always uses lineweights (general note).
- **Fill**: SOLID arrows follow `$FILLMODE` (both display and plot).
- Dimension text height in paper space for model-space dims uses DIMSCALE — nothing special at
  plot time because it is baked into the block.

---

## 15. Collected conflicts and unknowns

CONFLICTs:
1. Missing geometry block: AutoCAD regenerates (netDxf#98, ACadSharp#556) vs "AutoCAD refuses
   to open" (ezdxf `dimstyleoverride.py:563-565`). Probably version/flavour dependent; test.
2. DIMSTYLE missing codes: AutoCAD built-in imperial defaults (S1 evidence) vs header values
   (LibreCAD#2940) vs ezdxf metric defaults.
3. Arrow geometry: AutoCAD 1/6 half-width, tan-based open arrows, `_Open90` legs of 0.5 vs
   ezdxf sin-based shapes (§10.3). `_DotSmall` size (one sample).
4. LEADER 74 meaning swapped between spec and ezdxf/GDAL (AutoCAD data supports ezdxf/GDAL).
5. LARGE_RADIAL_DIMENSION 13/15 meaning: ezdxf (13 chord, 15 jog) vs libredwg (13 jog, 15 chord).
6. ARC_DIMENSION 70 type in R2018: ezdxf says 8, S2 (R2018) has 37 → 5.
7. DIMDSEP 0: ezdxf ',' vs AutoCAD '.'.
8. DIMPOST without `<>`: ezdxf error vs AutoCAD suffix; DIMPOST on tolerances: ezdxf no vs
   AutoCAD docs yes.
9. DIMJOGANG default 90 (ezdxf) vs 45° (AutoCAD docs; header in radians).
10. Oblique angle 52 = 0 handled as parallel ext lines by ezdxf renderer.
11. DIMDLE/zero-length arrow lists (ezdxf/GDAL vs netDxf).
12. Center mark color DIMCLRD (ezdxf) vs DIMCLRE (netDxf); ezdxf does not scale DIMCEN.
13. DIMTFILL box scale: AutoCAD writes MTEXT 45=1.25, ezdxf 1.1.
14. Spec lists `AcDb3PointAngularDimension` for the 2-line angular type; AutoCAD writes
    `AcDb2LineAngularDimension`. Spec puts 12/52 in `AcDbAlignedDimension`, AutoCAD/ezdxf in
    `AcDbDimension`.
15. Arc-length symbol: AutoCAD separate ARC vs ezdxf `"( "` text prefix.
16. Diameter sign: AutoCAD U+2205 in MTEXT vs ezdxf `%%c`.

UNKNOWN / needs AutoCAD tests:
- AutoCAD's fit algorithm (DIMATFIT 0-3 with exact thresholds), placement of outside text
  (DIMTMOVE 0), JIS (DIMTAD 3), DIMTAD 2 side choice, DIMJUST 1/2 distance.
- Vertical centring rule of MTEXT with attachment 5 (ink box vs line box) — decisive for text
  position; the samples suggest ink box.
- Whether group 12 translates the block.
- Tick (DIMTSZ) geometry and whether DIMDLE applies.
- Flip-arrow (74/75) geometry; arrows dropped for moved text.
- Jogged radius and partial arc-length geometry; ARC_DIMENSION leader.
- Tolerance frame metrics, datum identifier box.
- DIMTOL/DIMLIM MTEXT exact codes as written by AutoCAD; alternate units position.
- Whether TTF fixed-height styles are multiplied by DIMSCALE.
- Unit of DIMJOGANG in the DIMSTYLE record (degrees vs radians).
- Readability flip boundary for aligned text (exactly 90°/270° handling, hysteresis).
- Annotative representation selection in plots with ANNOALLVISIBLE.

---

## 16. Implementation checklist for truedxf

1. Parser: stateful subclass-aware reader for DIMENSION family (per-subclass code maps),
   DIMSTYLE (positional duplicate 70, handle 105), DSTYLE XDATA decoder (typed pairs),
   MULTILEADER nested `{}` sections with code reuse, TOLERANCE string splitter
   (`^J`/`%%v`/`{\Fgdt;x}`).
2. Data model: effective dimstyle = built-in imperial defaults ← DIMSTYLE record ← DSTYLE.
   Keep unknown XDATA groups (ACAD_DSTYLE_*) for round trips.
3. Renderer:
   - DIMENSION with block → INSERT-like rendering in the dimension OCS (elevation from 11),
     BYBLOCK resolution from the DIMENSION, Defpoints not plotted.
   - DIMENSION without block → layout engine (§6) + AutoCAD arrow blocks (§10.3) + text
     formatting (§7); flag the result as "approximate".
   - LEADER → §11.2 (hook extension, arrow rule, spline fit).
   - MULTILEADER → §12.5.
   - TOLERANCE → §13.3 (QCAD layout until AutoCAD tests calibrate it).
4. Fonts: dimension text positions depend on real glyph extents (TTF cap-height scaling and
   SHX grid), see §5.3.

---

## Test ideas

Each is a small DXF to open/plot in AutoCAD (PDF/PNG plot) and compare, or to *create* in
AutoCAD and read back the `*D` block.

1. **Block authority**: DIMENSION whose `*D` block content disagrees with defpoints/text (e.g.
   block draws a circle). Expect AutoCAD to plot the circle.
2. **Missing block**: same DIMENSION with group 2 removed; (a) in model space, (b) inside a
   block definition, (c) group 2 pointing to a non-existing block, (d) empty block. Record
   whether AutoCAD opens, regenerates, or hides it — resolves CONFLICT 1.
3. **Group 12 offset**: dimension with `12 = (100,0,0)` and a normal block. Does the plot shift?
4. **DIMSTYLE fallback**: DIMSTYLE record with only `2`/`70`, header `$DIMASZ=5 $DIMTAD=1`;
   DIMENSION without block → regenerated arrow size 0.18 (built-in) or 5 (header)?
5. **Arrow catalogue**: one linear dimension per built-in arrow with DIMASZ=10 and DIMSAH=1;
   save as DXF from AutoCAD; harvest all `_X` block definitions (fills the ezdxf-only rows of
   §10.3, `_DotSmall` size re-check) and dim-line shortening per arrow.
6. **Fit matrix**: linear dims with measurement 1…30 (step 1) × DIMATFIT 0-3 × DIMTIX 0/1 ×
   DIMSOXD 0/1 × DIMTAD 0/1 × DIMTMOVE 0/1/2 created in AutoCAD, read back blocks → derive the fit
   thresholds.
7. **Text vertical metric**: DIMTAD=1 dims with texts `111`, `gjpq`, `°`, `,` in Arial, txt.shx,
   simplex.shx → confirm the ink-box rule of §5.3 (and MTEXT middle-center semantics).
8. **DIMJUST 1-4, DIMTAD 2/3/4, DIMTVP 0.5/1.0** on horizontal and 30° aligned dims.
9. **Text override**: `""`, `"<>"`, `" "`, `"<> mm <>"`, `"A\XB"`, `"[]"` with DIMALT on.
10. **Number formats**: DIMLUNIT 1-6 × DIMDEC 0-8 × DIMZIN 0-15 × DIMFRAC 0-2 for values
    0, 0.5, 12, 12.0625, 48.36; DIMAUNIT 0-3 × DIMADEC −1..8 × DIMAZIN; DIMRND 0.25, DIMLFAC −2
    in model and paper space; DIMDSEP 0/44/46.
11. **Tolerance/limits**: DIMTOL with DIMTP=DIMTM and ≠, DIMTOLJ 0/1/2, DIMTFAC 0.5; DIMLIM →
    read MTEXT content from `*D`.
12. **Oblique**: linear dim with 52 absent, 0, 30.
13. **Radial set**: radius/diameter with text inside/outside, DIMTOFL 0/1, DIMCEN ±, DIMTIH/DIMTOH,
    moved text with DIMTMOVE 0/1/2, flip arrows 74/75.
14. **Angular/arc**: 2-line angular with arc point in each of the four quadrants; arc length
    with DIMARCSYM 0/1/2 and partial/leader variants; jogged radius with DIMJOGANG 30/45/90.
15. **Ordinate**: X/Y types with rotated UCS (51 ≠ 0).
16. **LEADER**: straight/spline, 2/3/5 vertices, first segment shorter than 2·DIMASZ, DIMTAD 0/1,
    74 = 0/1 with 211 = ±X, 75 = 0/1, annotation types 0-3, DIMLDRBLK variants, DIMCLRD BYBLOCK
    with 77.
17. **MULTILEADER**: MTEXT content with every left/right attachment type 0-8, vertical attachment
    with 272/273 = 9/10, dogleg on/off, landing gap, spline leader, breaks, per-line arrow override,
    block content with attributes and connection type 0/1, scale 0.5/2, text frame; compare with
    proxy graphics.
18. **TOLERANCE**: frames with 1/2 rows, composite symbol (same first field), projected zone row,
    datum identifier, DIMTXT 2.5 with DIMGAP 0.625 and 1.0 → calibrate §13.3.
19. **Annotative**: annotative dimension with two scales; plot model space at each CANNOSCALE and
    through two viewports with different annotation scales, ANNOALLVISIBLE 0/1.
20. **Colors**: dimstyle with true-color DIMCLRD/E/T → verify which values appear in DXF (ACI
    approximation vs 420 in block) and in plot.

---

## 17. AutoCAD 2027 findings (dimensions / leaders suites, 2026-09-30)

All **VERIFIED-BY-ACAD** with the case ids given (refs `samples/refs/acad2027-R26.0/`). For `-nb`
cases the DXFOUT re-save contains the block AutoCAD regenerated; truedxf's generator
(`packages/render/src/dimension/*`) reproduces 518 of 521 of those blocks entity by entity.
These findings supersede the ASSUMPTION/UNKNOWN markers of §1–§13 where they differ.

### 17.1 Blocks and regeneration
- The stored `*D` block is drawn **translated by group 12** (OCS), also nested (struct-group12-ez,
  struct-group12-nested-ez). An existing but **empty** block draws nothing (struct-empty-block).
- A missing/undefined block is regenerated for dimensions in a layout; inside block definitions
  only 3-point angular dimensions are regenerated (struct-in-block-nb, struct-in-block-angular3p-nb).
- Regenerated block entities: layer = the dimension's layer, `62`/`370` from DIMCLRx/DIMLWx
  (0 / −2 by default), no linetype unless DIMLTYPE/DIMLTEX are set (→ `6=<name>`), `48` = the
  DIMENSION's 48 on every part (dimltype-*-nb). SOLID arrows keep lineweight −2; INSERT arrows
  take DIMCLRD + DIMLWD; the MTEXT has DIMCLRT and the *entity's* lineweight
  (entity-color-byblock-nb). Order: ext1, ext2, dim line(s), arrows, MTEXT, DIMGAP<0 frame.
- DSTYLE code 5 (R12 DIMBLK name) is ignored in R2018 files (arrow-catalog-r2018-names-nb).

### 17.2 Linear / aligned
- 52 (oblique) is ignored on regeneration: extension lines stay perpendicular (oblique-30-nb).
- Arrows: closed filled SOLID length DIMASZ, half-width DIMASZ/6; zero-length arrows (no line
  shortening, DIMDLE allowed) = `_ArchTick _Oblique _DotSmall _Small _Integral _None`; `_Dot`,
  `_Origin`, user blocks shorten by DIMASZ (arrow-*-nb, dimdle-2-*-nb). `_None` writes nothing.
- Ticks (DIMTSZ > 0): LINE P ± DIMTSZ·(d + n) in DIMCLRD/DIMLWD, dim line extended by DIMDLE.
- Fit (fit-* sheets): both inside iff m ≥ 2·(asz + gap) and m ≥ text space (text breaking the
  line: 2·(asz + gap) + w + 2·gap). Otherwise DIMATFIT 0: both out; 1: arrows out, text in if it
  fits; 2: text out, arrows in only if m > 2·(asz + gap); 3: text in (arrows out) if it fits, else
  arrows in if m ≥ 2·(asz + gap). DIMTIX keeps the text in; DIMSOXD then drops outside arrows.
- Arrows outside: a DIMASZ stub beyond each arrow base; inner line when DIMTOFL or text inside.
  Text outside: beside ext line 2 (DIMJUST 1: ext line 1) at (arrow if outside) + asz + gap + w/2;
  with DIMTAD ≠ 0 the stub continues under the text to its end + gap.
- Text centre: above = gap + h/2 along the *readable* text's up vector (h = MTEXT frame height,
  ink based); DIMGAP < 0 doubles the gap and adds a frame |gap| around the text in DIMCLRD/DIMLWD
  (dimgap-m1-nb, dimgap-box-colors-nb). Readability flip for angles in (90°, 270°]
  (flip-angle-*). DIMTAD 2 = away from the defpoints, 3 = like 1, 4 = below. DIMTVP shifts by
  DIMTVP·h; the line is broken only for |DIMTVP| < 0.7.
- DIMJUST 1/2: text centre asz + 2·gap + w/2 from the ext line; 3/4: text along the ext line,
  exe + gap + w/2 past the dim line on the left of the ext-line direction, the ext line extended by
  gap + w + gap. DIMTIH on a non-horizontal line or a 53 rotation: text centred on the line, the
  line cut at the gap-enlarged text box. `\X` splits the text into two MTEXTs above/below.
- DIMTMOVE with user text (70 & 128): 0 moves the dim line through 11; 1 leader from the line middle
  to 11 − gap·d, then under the text (omitted near the line); 2 text at 11, no leader. Text moved
  by the fit rules: 1.375·h above the middle (TMOVE 1 leader knee 0.4125·h along; one sample).
- DIMTXTDIRECTION is code 294; 1 turns the text by 180° (dimtxtdirection-1-nb).
- A text style's fixed height is used as is, not × DIMSCALE (text-fixed-height-style-nb).
- A DIMSTYLE without 340 (R2000+) plots no text (dimtxsty-absent-nb).
- DIMTFILL: MTEXT background flags 3 (DIMTFILL 1) / 1 with 63 = DIMTFILLCLR (2), box scale 1.1.

### 17.3 Text strings (fmt-*, tol-*, dimalt-*, text-override-*)
- Rounding half away from zero; DIMDSEP 0 → '.'; DIMZIN 8 drops the separator (12); DIMLUNIT 6 =
  machine locale ("1.234,5000"); architectural/fractional stacks `{\H<DIMTFAC>x;\Sn/d;}` (`#` for
  DIMFRAC 1, "a b/c" unstacked for 2); feet/inch DIMZIN 0–3 as §7.1, the whole-inch 0 kept before
  a fraction only together with feet.
- DIMADEC −1 gives 0 decimals (not DIMDEC); DMS classes as §7.2; grads `g`, radians `r`.
- `\A<DIMTOLJ>;` leads every measured text when DIMTOLJ ≠ 0 (not tied to DIMTAD; imperial
  defaults give `\A1;`). Tolerances: `117.35±0.1`, `117.35\S+0.1^ -0.2;`; DIMTFAC ≠ 1 →
  `{\H<absolute height>;…}`; the DIMPOST suffix follows the stack; limits `\S117.45^ 117.15;`.
- DIMPOST without `<>` is a suffix; any DIMPOST drops the automatic `R` / `∅` prefix.
- Override: only the first `<>` is replaced; literal text drops tolerances/DIMPOST; `[]` becomes
  " [alt]" only when `<>` is also present; alternate units follow as " [alt]".
- DIMLFAC < 0 applies as |DIMLFAC| in paper space only (fmt-lfac-m2-nb, -paperspace-nb).

### 17.4 Radial, angular, arc length, ordinate, jogged
- Radius/diameter default: text outside beyond 15 (DIMTIX no effect, flip flags ignored), leader
  from the text end to the arrow base; DIMTOFL 1 adds the centre line (diameter: full line, second
  arrow and stub), 0 a centre mark (DIMCEN × DIMSCALE in DIMCLRE; DIMCEN < 0 adds lines from 2|c|
  to r + |c|). DIMTOH: horizontal landing from a knee DIMASZ (diameter 2·DIMASZ) past the base.
  Moved text inside: one line text → arrow, arrow inside, no second diameter arrow; TMOVE 2: text
  free, line centre → arrow (radius-/diameter-moved-*).
- Angular: 2-line sector = the one containing 16; 3-point: the one containing 10; radial extension
  lines only where the arc misses the lines; arrows are chords (tip and base on the arc, arc
  shortened by 2·asin(asz / 2r)); DIMTIH makes angular text horizontal, the arc is cut at the box.
- Arc length: radial ext lines, orthogonal (parallel to the bisector) below 90°; DIMARCSYM 0 = ARC
  r 0.8·h, centre w/2 + h before and 0.4·h below the text centre; 1 = ARC r 1.0875·h over the text
  from 46.3972° to 133.6028°; 2 none. Leader (71 = 1) only for full arcs: dim arc middle → measured
  arc with an arrow; 16/17 ignored.
- Ordinate: leader in DIMCLRE from 13 + DIMEXO; jog from 14 − 4·asz to 14 − 2·asz; line to
  14 + gap + w; text gap + w/2 past 14, above.
- LARGE_RADIAL: 13 = override centre, 14 = jog point, 15 = chord point (measurement |15 − 10|).
  Lines 13 → A → B → arrow at 15, B = jog line (through 14 at DIMJOGANG to the radial, turned to
  the side of 13) ∩ radial line 10 → 15, A = 2·14 − B; text midway between B and the arrow base.
  DIMSTYLE 50 is in degrees (0.5236 → 0.5236°); ≥ 90 → 45° (jogged-*).

### 17.5 LEADER / MULTILEADER / TOLERANCE
- LEADER: arrow DIMLDRBLK, omitted when the first segment is shorter than 2·size; 77 is ignored
  (entity colour); a text annotation without hook gets the hook vertex added (DXFOUT gains it);
  DIMTAD ≠ 0: unstored extension of gap + 41 from the last vertex along 211 (74 = 1 reverses it,
  even back over the stored hook) in DIMCLRD/DIMLWD (leaders/leader-*). Spline leaders: fit spline
  with the first/last segment directions as end tangents (sub-pixel differences remain).
- MULTILEADER: drawn from the context data; arrows omitted unless the first segment exceeds
  2·size; arrows in the leader line colour.
- TOLERANCE: t = DIMTXT·DIMSCALE; rows 2·t high from the insertion point (middle of row 1's left
  edge); cells = text width + t, text middle-left at t/2; DIMGAP unused; empty rows keep their
  place (a row without fields draws t-long top/bottom edges); composite rows are **not** merged;
  frame DIMCLRD, text DIMCLRT (leaders/tol-*).

### 17.6 Open
- MTEXT `\A1;`/`\A2;` against a stack (tol-unequal-j1/j2-nb): the text engine keeps the main text
  bottom-aligned, AutoCAD centres/tops it against the stack.
- MULTILEADER: dogleg length 0 / disabled dogleg, spline leaders, text frames, underline
  attachments 5/6/8, breaks and block attributes are not reproduced yet.
- LARGE_RADIAL group 40 moves the text (jogged-40-jogangle-nb, meaning UNKNOWN).

## 18. Findings 2026-10-01 (VERIFIED-BY-ACAD user/studienleistung)

- MULTILEADER with block content: the attribute values are stored in the MULTILEADER (330 ATTDEF
  handle + 302 value, see §6) and AutoCAD draws them at their ATTDEF's placement, height and
  style, transformed with the block content (circled numbers in the fixture). Non-constant ATTDEFs
  of the block are not drawn themselves.
