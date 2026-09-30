# 02 – TABLES and OBJECTS sections

Scope: the symbol tables (VPORT, LTYPE, LAYER, STYLE, VIEW, UCS, APPID, DIMSTYLE,
BLOCK_RECORD) and the non-graphical object graph in the OBJECTS section, i.e. dictionaries,
styles, variables, draw order, clip filters, image and underlay definitions. The focus is on
what the renderer needs to match AutoCAD PLOT output, and on what the data model has to
keep so files survive a round trip.

Other notes cover LAYOUT/PLOTSETTINGS in depth, header variables, linetype rendering, fonts,
DIMENSION/MLEADER rendering and VIEWPORT entities. This note only points to them.

Abbreviations used in citations:
`spec` = `research/spec/autocad_2012_dxf_reference.txt` (line numbers),
`oda` = `research/spec/OpenDesign_Specification_for_.dwg_files.txt`,
`ezdxf:` = `research/repos/ezdxf/`, `acadsharp:` = `research/repos/ACadSharp/src/ACadSharp/`,
`ixmilia:` = `research/repos/ixmilia-dxf-rs/spec/`, `libredwg:` = `research/repos/libredwg/src/`,
`#N` = issue/PR/discussion dumps under `research/github/raw/<repo>/threads/`.

**Primary evidence file.** `research/repos/ACadSharp/samples/sample_AC1032_ascii.dxf` (plus
`_AC1015_`, `_AC1018_`, `_AC1009_` siblings) was saved by **real AutoCAD**: it has
`$ACADMAINTVER`, `$LASTSAVEDBY`, AutoCAD's typical handle layout and Autodesk-only objects.
Statements marked **VERIFIED-BY-ACAD (sample)** were read directly from that file with
throw-away dump scripts. "sample" below means that file unless stated otherwise. It's the best
ground truth we have until we produce our own AutoCAD test files.

---

## 0. Key findings (read this first)

1. **AutoCAD writes DIMSTYLE records sparsely.** It only writes group codes whose value differs
   from AutoCAD's *built-in imperial defaults* (DIMASZ 0.18, DIMTXT 0.18, DIMTIH 1,
   DIMTAD 0, DIMDEC 4, ...). The `Standard` record in a metric drawing can consist of
   `2 Standard / 70 0 / 340 <style>` only. So **a missing DIMSTYLE code means the imperial
   default**, not ezdxf's metric default (ezdxf uses DIMASZ 2.5 etc.). **VERIFIED-BY-ACAD
   (sample)**: AC1015, AC1018 and AC1032 all behave this way. The same holds in a *metric*
   drawing (`$MEASUREMENT 1`): `research/repos/dxf-json/integration-test/src/tc0/tc.dxf`
   (AutoCAD, AC1032) has `Standard` = `70 0 / 340 11` and an ISO-25 record identical to the
   ACadSharp sample's. The reference point is therefore fixed and independent of
   `$MEASUREMENT`. **CONFLICT** with ezdxf's attribute defaults, see §2.6.
2. **The DIMSTYLE record uses group code 70 twice** (R2007+): the first 70 after `2` holds
   the standard flags, a later 70 holds DIMTFILLCLR. The parser has to decide by position.
   **VERIFIED-BY-ACAD (sample)** (`70 0 … 69 2 70 97`), ezdxf `dimstyle.py:load_dxf_attribs`
   has the same comment.
3. **LTYPE complex elements.** Group 50 (rotation) is written in **degrees**
   (`50 180.0`), whereas the spec says radians. Flag 74 = 2 marks text and 74 = 4 marks a shape,
   as the DXF spec says. The ODA DWG spec has these two swapped. Bit 8 means "upright" (`U=`):
   AutoCAD writes `74 10` for GAS_LINE `U=0.0`. **VERIFIED-BY-ACAD (sample)**.
4. **VPORT view height is group 40, aspect ratio is 41**, not 45 as the spec says. AutoCAD 2018
   still writes 73/75/76/77/78 (ixmilia and ezdxf claim they were removed in R2007). The
   ambient color is 63/421 (not 62). **VERIFIED-BY-ACAD (sample)**.
5. **IMAGEDEF pixel size is `11/21`**, not `11/12` as the spec says. **WIPEOUTVARIABLES** uses
   the subclass `AcDbWipeoutVariables` and has no `90`. **VERIFIED-BY-ACAD (sample)**.
6. **LAYER:** the `290` plot flag is only written when it is 0. Layer "Defpoints" always has
   `290 0`, and AutoCAD never plots it regardless of the flag. Off = negative 62, frozen = 70
   bit 1. Transparency is in XDATA `AcCmTransparency 1071 0x020000AA` (AA = alpha, 0 means
   "unset/opaque"). A true-color layer still writes the nearest ACI in 62. **VERIFIED-BY-ACAD
   (sample)** for everything except "Defpoints never plots", which is well-known AutoCAD
   behaviour and is mirrored by libredwg (`dwg.spec:3432`). It still needs an explicit test
   with 290=1.
7. **Block content on layer 0** inherits the INSERT's (effective) layer. If the INSERT's layer
   is **frozen**, the *whole* reference disappears, including content on other layers. If it is
   only **off**, only the layer-0 (inheriting) content disappears. **CONFLICT:** ezdxf says
   INSERT visibility "depends only on the invisible flag" (`addons/drawing/properties.py:661`).
   Needs an AutoCAD test.
8. **Draw order** comes from `SORTENTSTABLE` in the block record's extension dictionary under
   `ACAD_SORTENTS`. The sort key is the *sort handle* (not the entity handle), compared as
   hex→int. Entities that aren't listed use their own handle. Sort handle `0` sorts **last**
   (on top). A SORTENTSTABLE can also exist for ordinary block definitions. **VERIFIED-BY-ACAD
   (sample)**: three tables, one of them for the block `my_block_v2`.
9. **R12 as written by AutoCAD:** table entries have *no handles* even with `$HANDLING 1`,
   names are upper-cased, TTF styles are replaced by `txt`, complex linetypes lose their
   text/shape elements (only the 49 dashes stay), and there are no `BYLAYER`/`BYBLOCK` LTYPE
   entries. The same drawing therefore renders differently from its R2000+ version.
   **VERIFIED-BY-ACAD (sample_AC1009)**.
10. **Resolution rules:** names are case-insensitive. AutoCAD creates missing layers on
    load but refuses files with undefined linetypes (ezdxf #8, ACadSharp #1244). A missing text
    style or dimension style needs a fallback (`Standard`). Where both a name and a handle exist
    (MLINE 2 vs 340, DIMSTYLE 5/6/7 vs 342/343/344), the handle wins.

---

## 1. Table structure

### 1.1 TABLE / ENDTAB framing

R2000+ (spec 1860–1960, ezdxf `docs/source/dxfinternals/sections/tables_section.rst`):

```
0 TABLE
2 <TABLENAME>            uppercase: VPORT LTYPE LAYER STYLE VIEW UCS APPID DIMSTYLE BLOCK_RECORD
5 <table handle>         (always 5, also for DIMSTYLE's table object)
[102 {ACAD_XDICTIONARY / 360 h / 102 }]   optional, rare
330 0                    owner of a table is always 0
100 AcDbSymbolTable
70 <count>               "maximum number of entries"; NOT reliable, don't use as index (spec 1878)
[100 AcDbDimStyleTable   DIMSTYLE only
 71 <n>                  DIMSTYLE only: count of extra handles (undocumented)
 340 <h> × n]            DIMSTYLE only: libredwg dwg.spec:4175 "number of additional hard handles, undocumented"
0 <ENTRYTYPE> ...        entries
0 ENDTAB
```

Entry header (R2000+):

```
0 LAYER
5 <handle>               105 for DIMSTYLE (see 1.3)
[102 {ACAD_XDICTIONARY 360 <xdict> 102 }]
[102 {ACAD_REACTORS 330 <h>… 102 }]
330 <table handle>       owner = the TABLE object
100 AcDbSymbolTableRecord
100 AcDb<Xxx>TableRecord
2 <name>
70 <flags>
...
[1001 appid ... XDATA]
```

Observed order in AutoCAD output: `{ACAD_XDICTIONARY` comes **before** `{ACAD_REACTORS`
(sample VIEW/TABLESTYLE). The spec lists them the other way round. The parser must accept
both orders.

**Table handles as written by AutoCAD** (sample, stable across AutoCAD versions; don't rely on
them, but they're useful for test fixtures): BLOCK_RECORD `1`, LAYER `2`, STYLE `3`, LTYPE `5`,
VIEW `6`, UCS `7`, VPORT `8`, APPID `9`, DIMSTYLE `A`, root dictionary `C`, ACAD_GROUP `D`,
ACAD_PLOTSTYLENAME `E`, placeholder "Normal" `F`.

**Table order:** the spec says the order may vary "but LTYPE always precedes LAYER"
(spec 1864). AutoCAD writes VPORT, LTYPE, LAYER, STYLE, VIEW, UCS, APPID, DIMSTYLE,
BLOCK_RECORD (sample). A reader must not depend on the order. Resolve references after all
tables are loaded (two-pass).

**Deleted entries** are not written, so `70` can be larger than the actual count (spec 1873).

**Common entry flags (70)** (spec 1985 ff.): `16` = xref-dependent, `32` = xref resolved
(only together with 16), `64` = referenced by at least one entity at the last edit
(informational; ignore on read, may omit on write). Table-specific bits are listed per table.

**Xref-dependent entries** are named `XREFNAME|ENTRYNAME` (for example `ARCH|WALLS`) and carry
flag 16 (+32 if resolved). The xref's own content isn't in the DXF (only the xref BLOCK with
path group 1), so the renderer can only draw xrefs if we resolve the external file.

### 1.2 R12 vs R2000+

| Aspect | R12 (AC1009) | R2000+ |
|---|---|---|
| Handles | optional, only if `$HANDLING`=1. **AutoCAD's R12 export writes no handles on TABLE or table entries even with `$HANDLING 1`**; entities (and ENDBLK) do have `5` (sample_AC1009) | mandatory |
| `330`/`100` markers | none | always |
| BLOCK_RECORD table | absent | present |
| Layouts | `$MODEL_SPACE` / `$PAPER_SPACE` blocks (sample_AC1009 BLOCKS) | `*Model_Space` / `*Paper_Space[N]` |
| Name case | AutoCAD writes names **upper-case** (`LAYER_OFF`, `STANDARD`, `*ACTIVE`, `CONTINUOUS`) | mixed case preserved (`*Active`, `Continuous`, `Standard`) |
| LAYER | 2, 70, 62, 6 only | + 290, 370, 390, 347, 348, 420, 430, XDATA |
| LTYPE | simple only; AutoCAD drops complex elements when exporting (GAS_LINE → `49 .5 49 -.2 49 -.25`, text gone). No `74` tags | + 74/75/340/46/50/44/45/9 |
| LTYPE ByLayer/ByBlock entries | not written | written (handles 14/15 in sample) |
| STYLE | TTF styles are rewritten to `3 txt` by AutoCAD's R12 export (sample_AC1009: every style `txt`) | TTF file name + XDATA family |
| DIMSTYLE | arrow blocks by **name** in 5/6/7, no 340–347 handles, no R2000 vars (≥179) | handles 340–347, no 5/6/7 |
| True color / transparency | none | 420/430/440 & XDATA |

**R13/R14** (AC1012/AC1014) are rare. They're structurally R2000-like but lack some codes
(e.g. XRECORD has no 280 before R2000: ezdxf `entities/dxfobj.py:90`). Support them for reading,
but don't write them.

### 1.3 The DIMSTYLE 105 quirk

A DIMSTYLE record uses **105** as its handle code, because group 5 was already taken by DIMBLK
(the R12 arrow block name) (spec 1896). Everywhere else 105 is not a handle. ezdxf's low-level
loader special-cases it (`lldxf/fileindex.py:144`, `entities/dxfentity.py:665`). The DIMSTYLE
TABLE header itself uses 5 (sample line 3911). Real AutoCAD output: `0 DIMSTYLE / 105 27 /
330 A / …` (sample).

Parser rule: inside `0 DIMSTYLE` records, 105 is the handle and 5 is DIMBLK (R12 name). In
every other record 5 is the handle.

### 1.4 102 groups

`{ACAD_REACTORS` holds a list of 330 back-pointers to objects that "watch" this one
(typically the owning dictionary, or IMAGEDEF_REACTOR objects). `{ACAD_XDICTIONARY` holds a
single 360 hard-owner handle to the extension DICTIONARY. Other `{APPNAME` groups are
application data (e.g. `{BLKREFS` in BLOCK_RECORD, `{ADSK_LYR_COLOR_OVERRIDE` inside
XRECORDs). Keep them as opaque tagged lists for round-tripping. Only XDICTIONARY and (for
images) REACTORS are needed semantically.

---

## 2. The tables

### 2.1 LAYER

Group codes (spec 2322 ff., ezdxf `entities/layer.py:71`, ixmilia `TableSpec.xml`,
sample):

| Code | Meaning | Default / notes |
|---|---|---|
| 2 | name | case-insensitive key. Must not contain ``<>/\":;?*=` `` (ezdxf `lldxf/const.py:579`); `*` is allowed as the first char for Autodesk "special layers" (ezdxf `validator.py:396`); `|` separates xref-dependent names |
| 70 | flags: 1 frozen, 2 frozen by default in new viewports, 4 locked, 16/32/64 standard | 0 |
| 62 | ACI color 1..255; **negative ⇒ layer off** (abs = color). 0 (BYBLOCK) and 256 (BYLAYER) are invalid for layers (ezdxf `layer.py:47`) | 7 |
| 420 | true color 0x00RRGGBB (R2004+). If present it wins over 62. AutoCAD still writes the nearest ACI in 62 (sample `62 150 / 420 1151726`) | — |
| 430 | color book name `BOOK$COLOR` (R2004+), e.g. `DIC COLOR GUIDE(R)$DIC 7`. 420 is still present, so render from 420 | — |
| 6 | linetype name | `Continuous`. Spec 2360: xref-dependent layers export `CONTINUOUS` on SAVEAS |
| 290 | plot flag: 0 = don't plot | 1. **AutoCAD omits the tag when 1** (sample: only `Layer_NoPlot` and `Defpoints` have `290 0`) |
| 370 | lineweight enum (1/100 mm): 0,5,9,13,15,18,20,25,30,35,40,50,53,60,70,80,90,100,106,120,140,158,200,211; −3 = DEFAULT (→ `$LWDEFAULT`, normally 25) | −3. −1/−2 invalid for layers |
| 390 | hard pointer to the plot style name object (ACDBPLACEHOLDER in `ACAD_PLOTSTYLENAME`, usually "Normal") | required by AutoCAD per ezdxf (`layer.py:107`). Only matters when `$PSTYLEMODE`=0 (named plot styles, STB) |
| 347 | hard pointer to MATERIAL (R2007+) | "Global" material. Irrelevant for 2D plot |
| 348 | unknown handle (R2007+/R2013+?) | AutoCAD writes `348 0` (sample). ezdxf calls it `unknown1` |
| XDATA `AcAecLayerStandard` | `1000 ""` + `1000 <description>` | description only |
| XDATA `AcCmTransparency` | `1071 <raw transparency>` | see below |
| xdict | per-viewport overrides, see 2.1.3 | |

#### 2.1.1 Visibility / plot semantics (renderer)

Effective visibility of an entity on layer L in a given viewport V when **plotting**:

```
visible = !L.off && !L.frozen && !frozenIn(V, L) && L.plot && !isDefpoints(L)
```

- **Off** (62 < 0): not displayed, not plotted. Entities still take part in "extents".
- **Frozen** (70 & 1): not displayed, not plotted, not regenerated. ezdxf #201 notes that frozen
  "behaves mostly like off" apart from the block-reference cases below.
- **Frozen in viewport**: the VIEWPORT entity's 341 list of frozen layers (VIEWPORT note).
  Bit 2 (*frozen in new viewports*) only affects newly created viewports, so ignore it when
  rendering.
- **Locked** (4): no effect on plotting. (AutoCAD can *fade* locked layers on screen via
  `LAYLOCKFADECTL`, but that's display-only. **ASSUMPTION:** it doesn't affect PLOT.)
- **Plot flag 290 = 0**: displayed but not plotted. ezdxf applies this only in `export_mode`
  (`addons/drawing/properties.py:523`), which is exactly the PLOT behaviour we want.
- **Defpoints** (case-insensitive name `DEFPOINTS`): **never plots**, even if `290` is 1.
  AutoCAD creates it for dimension definition points. Entities on it are *displayed*. libredwg
  forces `290 0` for Defpoints on DXF export (`libredwg:dwg.spec:3432`). ezdxf's `new()` also
  creates it with `plot=0` (`ezdxf:src/ezdxf/document.py:256`). ezdxf's drawing frontend only
  hides POINTs on Defpoints (`frontend.py:491`); **don't copy that**. **UNKNOWN / needs AutoCAD
  test:** an xref-dependent `X|Defpoints` layer, and a layer named Defpoints with 290=1.
- **Layer 0** can't be renamed or deleted. **Inside block definitions** an entity on layer `0`
  takes the effective layer of the block reference (recursively through nested INSERTs). It
  inherits that layer's BYLAYER color/linetype/lineweight/transparency *and* its on/off state.
- **INSERT on a frozen layer** → the entire block reference is hidden, including nested content
  on other layers. **INSERT on an off layer** → only the content that inherits (layer 0) is
  hidden; content on other (visible) layers still shows. Sources: Autodesk forum / CADTutor
  consensus ([forum](https://forums.autodesk.com/t5/autocad-forum/block-layer-problems-in-2018/m-p/7817052),
  [cadtutor](https://www.cadtutor.net/forum/topic/56987-understanding-the-end-result-from-the-relationship-between-blocks-and-layers/)).
  **CONFLICT:** ezdxf `properties.py:661` treats INSERT visibility as independent of the layer.
  **UNKNOWN / needs AutoCAD test** (both off and frozen, nested 2 levels).
- **VIEWPORT entity on an off layer**: its border is hidden, its content is still drawn
  (ezdxf `properties.py:664`). **ASSUMPTION** for frozen-layer viewports: AutoCAD docs say
  the viewport content is also hidden (VIEWPORT note).

#### 2.1.2 Color, true color, transparency

- Color resolution (full rules in the color note): `420` overrides `62`. The ACI (abs) is still
  needed because CTB plot styles map by ACI. Plotting a true-color entity through a CTB uses the
  CTB entry of... **UNKNOWN**: the nearest ACI, or the "use object color" path? This belongs in
  the plot-style note.
- **Transparency raw value** (XDATA `AcCmTransparency 1071`; the same encoding as entity 440):
  `0x02000000 | alpha` where alpha 0 = fully transparent and 255 = opaque. Transparency
  percent t → alpha = trunc((1 − t/100)·255)? The sample layer "Layer_transp_70" stores
  `33554508` = 0x0200004C → alpha 76 = 255·0.3 = 76.5 truncated. **VERIFIED-BY-ACAD
  (sample)** for 70 %. `0` (no 0x02000000 bit) = not set → opaque (ezdxf `layer.py:298`).
  `0x01000000` = BYBLOCK makes no sense for a layer.
- Plotting transparency requires the page-setup option "plot transparency" (stored in the
  layout's XDATA according to ezdxf `entities/layout.py:69`), see the layout note.

#### 2.1.3 Per-viewport layer overrides (VP overrides)

Stored in the **layer's extension dictionary** (ezdxf `docs/.../tables/layer_table.rst`,
`entities/layer.py:600 ff`, `lldxf/const.py:693`):

| xdict key | XRECORD group per viewport | value code |
|---|---|---|
| `ADSK_XREC_LAYER_COLOR_OVR` | `102 {ADSK_LYR_COLOR_OVERRIDE` / `335 <VIEWPORT handle>` / `420 <raw color>` / `102 }` | 420 = *raw* AcCmColor value (0xC2…RGB, 0xC3…ACI), decode with the raw-color rules |
| `ADSK_XREC_LAYER_LINETYPE_OVR` | `{ADSK_LYR_LINETYPE_OVERRIDE` 335, `343 <LTYPE handle>` | handle |
| `ADSK_XREC_LAYER_LINEWT_OVR` | `{ADSK_LYR_LINEWT_OVERRIDE` 335, `91 <lineweight>` | int |
| `ADSK_XREC_LAYER_ALPHA_OVR` | `{ADSK_LYR_ALPHA_OVERRIDE` 335, `440 <raw transparency>` | int |

Each XRECORD starts with `280 1` (cloning). There's one `102` group per overridden viewport.
The layer's xdict is `280 1` hard-owned and `281 1`. If an override doesn't exist for a viewport,
use the layer's own value. Apply the overrides when rendering *inside that paper-space VIEWPORT*
only. ezdxf applies them in `addons/drawing/properties.py:454`.

Other xdict keys seen in the wild: `ADSK_XREC_LAYER_RECONCILED` (layer notification; ignore;
found in `dxf-json/sample/A_000217.dxf`).

### 2.2 LTYPE

Group codes (spec 2366 ff., ezdxf `docs/.../tables/linetype_table.rst`, sample):

| Code | Meaning |
|---|---|
| 2 | name |
| 70 | standard flags |
| 3 | description (ASCII art) |
| 72 | alignment, always 65 ('A') |
| 73 | number of elements (count of 49 groups) |
| 40 | total pattern length (sum of abs(49)); `0.0` for Continuous |
| per element: 49 | dash length: >0 dash, <0 gap, 0 dot |
| 74 | element flags (R13+): bit 1 = rotation **absolute** (`A=`), bit 2 = embedded **text**, bit 4 = embedded **shape**, bit 8 = **upright** (`U=`, undocumented; GAS_LINE `U=0.0` → `74 10`). 0 = plain dash. AutoCAD writes `74 0` after *every* 49 in R2000+ |
| 75 | shape number (shape) / 0 (text). Omitted when 74 = 0 |
| 340 | pointer to STYLE: the text style for text, or the *shape-file STYLE entry* (flag 1, empty name) for shapes |
| 46 | scale `S=` |
| 50 | rotation `R=`/`A=`/`U=`, **in degrees** in DXF (sample ZIGZAG `50 180.0`). **CONFLICT:** spec 2413 says radians. ACadSharp `LineType.Segment.cs:99` uses `IsAngle` (degrees in DXF) → agrees with the sample |
| 44, 45 | X/Y offset `X=`/`Y=` (along / perpendicular to the line direction, in pattern units) |
| 9 | text string (text elements only) |

Order inside an element as AutoCAD writes it: `49, 74, [75, 340, 46, 50, 44, 45, [9]]` (sample
GAS_LINE / TRACKS / ZIGZAG). The spec's order (74 → 75 → 340 → 46 → 50 → 44 → 45 → 9) matches.
The parser should key on `49` to start a new element and accept any order of the rest
(ixmilia stores them as parallel arrays, which breaks when optional codes are missing; don't
copy that).

**CONFLICT (bit meaning):** ODA spec (oda 8603–8614) says `&2` = shape, `&4` = text. The DXF
spec and AutoCAD output say `&2` = text (GAS_LINE `74 10`, `9 GAS`) and `&4` = shape (TRACKS
`74 4 75 130`). Go with DXF/AutoCAD. The ODA text probably mislabels the DWG bits.

**Shape elements** reference shapes *by number* (75) inside the SHX file named by the STYLE
entry's group 3. The .lin source uses shape *names* (`[TRACK1,ltypeshp.shx]`), and AutoCAD
resolves them at load time. SHX parsing is covered in the fonts note.

**Text elements**: the text height is `46` × (text style fixed height, if nonzero)?
**UNKNOWN / needs AutoCAD test.** ezdxf treats S directly as height. Both `U`/`R`/`A` handling
and the whole geometry belong in the linetype note.

**Standard entries** (AutoCAD R2000+ output): `ByBlock` (h 14), `ByLayer` (h 15),
`Continuous` (h 16). All three have `73 0 / 40 0.0`. `ByLayer`/`ByBlock` are *keywords* for
entities (case-insensitive), never real patterns. R12 files lack these two entries, so
resolution must treat the names specially rather than looking them up. `Continuous` is a real
entry (solid). **ASSUMPTION:** any LTYPE with 73 = 0 renders solid.

**ACAD_ISO\*** (from `acadiso.lin`; `netDxf/TestDxfDocument/Support/acadiso.lin`):
ISO02 `12,-3`; ISO03 `12,-18`; ISO04 `24,-3,0,-3`; ISO05 `24,-3,0,-3,0,-3`;
ISO06 `24,-3,0,-3,0,-3,0,-3`; ISO07 `0,-3`; ISO08 `24,-3,6,-3`; ISO09 `24,-3,6,-3,6,-3`;
ISO10 `12,-3,0,-3`; ISO11 `12,-3,12,-3,0,-3`; ISO12 `12,-3,0,-3,0,-3`;
ISO13 `12,-3,12,-3,0,-3,0,-3`; ISO14 `12,-3,0,-3,0,-3,0,-3`; ISO15 `12,-3,12,-3,0,-3,0,-3,0,-3`
(all `ACAD_ISOnnW100`, mm, for pen width 1.00 mm). `acad.lin` (imperial) contains the *same*
millimetre numbers for ACAD_ISO*, while its CENTER/HIDDEN are in inches (`1.25,-.25,.25,-.25`).
The renderer must **always use the definition stored in the file**, never a .lin file.

Missing linetype: AutoCAD refuses to open DXF files that reference undefined linetypes
("very picky about line types, unlike layers", ezdxf #8, #1016; ezdxf `audit.py:359`).
Renderer fallback: Continuous, plus a warning.

### 2.3 STYLE

Group codes (spec 2396 ff., ezdxf `entities/textstyle.py:27`, sample):

| Code | Meaning | Default |
|---|---|---|
| 2 | name; **empty for shape-file entries** | `Standard` must exist |
| 70 | 1 = this entry is a *shape file* (LOAD, or referenced by a complex linetype); 4 = vertical text (SHX only: "Vertical text works only for SHX fonts in AutoCAD", ezdxf `textstyle.py:41`); 16/32/64 standard | 0 |
| 40 | fixed text height; 0 = not fixed (the entity's height is used) | 0 |
| 41 | width factor | 1 |
| 50 | oblique angle, degrees | 0 |
| 71 | generation flags: 2 = backward (mirror X), 4 = upside down (mirror Y) | 0 |
| 42 | last height used (UI only; ignore when rendering) | |
| 3 | primary font file (`txt`, `simplex.shx`, `arial.ttf`, may be a full path, may be empty) | `txt` |
| 4 | big-font file (SHX for CJK); empty if none | "" |
| XDATA `ACAD` | `1000 <font family>` / `1071 <flags>` | |

Shape-file entries (sample): `2 "" / 70 1 / 3 ltypeshp.shx` and even absolute paths
`3 D:\...\test_shape.shx`. The spec says only group 3 matters (spec 2432).

**1071 flags** (ezdxf `textstyle.py:76–84`; spec 2429 "pitch and family, charset, italic
and bold"): it's a Windows `LOGFONT`-like packing:
- byte 0 = pitch & family (34 = 0x22 = VARIABLE_PITCH|FF_SWISS for Arial; 49 = 0x31 =
  FIXED_PITCH|FF_MODERN for Consolas, sample),
- byte 1 = charset (0 = ANSI),
- bit 24 (0x01000000) = italic, bit 25 (0x02000000) = bold.

Example: Arial bold+italic = 50331682. **CONFLICT:** ACadSharp maps 1071 onto a 2-bit enum
(`Tables/FontFlags.cs`: Italic = 1, Bold = 2), which is wrong for AutoCAD data.

**Font resolution** (details in the fonts note; facts relevant here):
- The group-3 name may lack an extension (`txt`). AutoCAD then looks for `.shx` first.
  **ASSUMPTION** (ezdxf `fonts/fonts.py:177` appends `.shx`).
- An empty group 3 with the XDATA family set → pick the font by family/bold/italic (ezdxf
  `addons/drawing/properties.py:531`; ezdxf #380).
- An unresolved font falls back to `FONTALT` or the font map in AutoCAD, which is outside the
  DXF → **UNKNOWN**. Our renderer needs a deterministic substitution table and must bundle or
  locate `txt.shx`, `simplex.shx`, `romans.shx`, … (fonts note).
- R12 export by AutoCAD rewrites TTF styles to `txt` (sample_AC1009).

Referenced **by name** from TEXT/MTEXT/ATTRIB/ATTDEF (7), SHAPE (the shape name is looked up in
all shape-file STYLE entries), and TABLESTYLE (7). Referenced **by handle** from DIMSTYLE 340,
LTYPE 340, MLEADERSTYLE 342, MLEADER 343, ACAD_TABLE cells.

### 2.4 VPORT

A VPORT entry is a *model-space tiled viewport configuration*. Several entries may share a
name (one per tile). The active configuration is `*ACTIVE` (case-insensitive; AutoCAD 2018 writes
`*Active`, R12 `*ACTIVE`). "The first such entry describes the current viewport"
(spec 2636). **ASSUMPTION:** that's true for AutoCAD output. `$CVPORT`? ezdxf
`vport_table.rst` has the details.

Group codes (spec 2640–2830; ezdxf `entities/vport.py:32`; ixmilia; sample):

| Code | Meaning | Notes |
|---|---|---|
| 2, 70 | name, flags | |
| 10/20, 11/21 | lower-left / upper-right corner in normalized screen space [0..1] | single viewport: (0,0)-(1,1) |
| 12/22 | view center (DCS) | |
| 13/23, 14/24 | snap base, snap spacing | UI |
| 15/25 | grid spacing | UI |
| 16/26/36 | view direction from target (WCS) | defines DCS z |
| 17/27/37 | target (WCS) | DCS origin |
| **40** | **view height** (DCS units) | **CONFLICT:** spec 2702 says 45; ezdxf (`vport.py:52` "DXF reference error"), ACadSharp (`VPort.cs:91`) and AutoCAD output (sample) use **40**. ixmilia uses 40 for ≤R2004 and 45 for R2007+, which is **wrong** |
| **41** | **aspect ratio** (width/height of the tile in pixels at save time) | view width = 40 × 41 |
| 42 | lens length (mm) | 50 |
| 43, 44 | front/back clip offsets | |
| 50 | snap rotation (deg) | |
| 51 | view twist angle (deg) | rotates the DCS |
| 71 | view mode (VIEWMODE bits: 1 perspective, 2 front clip, 4 back clip, 8 UCS follow, 16 front clip not at eye) | |
| 72 | circle sides / zoom percent (1000) | |
| 73 | fast zoom | still written by AutoCAD 2018 (sample) → ixmilia/ezdxf "removed in R2007" is **wrong** |
| 74 | UCSICON bits | |
| 75, 76 | snap on, grid on | still written (sample) |
| 77, 78 | snap style, isopair | still written (sample) |
| 281 | render mode (0 = 2D optimized, 1 wireframe, 2 hidden, 3 flat, 4 gouraud, 5/6 +wire) | |
| 65 | UCSVP | |
| 110/111/112 (+120..132) | UCS origin, X axis, Y axis | |
| 79, 146 | ortho UCS type, elevation | |
| 345, 346 | named UCS / base UCS | |
| 348 | visual style (R2007+) | sample `348 9F` (2dWireframe) |
| 60 | grid flags (undocumented; ACadSharp `GridFlags`) | sample `60 3` |
| 61 | major grid lines every N | sample 5 |
| 170, 332, 333 | shade plot setting, background, shade plot object | |
| 292, 282, 141, 142 | default lighting on/type, brightness, contrast | |
| **63**, 421, 431 | ambient color (ACI / true / name); "only output when non-black" (spec 2830) | sample `63 250 / 421 3355443`. ixmilia uses 62, **wrong** |
| 361 | sun (hard owner) | |
| 1 | plot style sheet | R2007+ |
| XDATA `ACAD_NAV_VCDISPLAY 1070 n` | ViewCube display | ignore |

**Model-space "current view"** (for PLOT with plot type 0 "Display", and for any "show the file
as it was saved" preview):

```
tile = first *ACTIVE entry (or the one with the largest area? -> UNKNOWN for multi-tile)
DCS: origin = target (17), z = normalize(direction 16), twist = 51 (deg)
view window in DCS: center = (12,22), height = 40, width = 40 * 41
```

For plan views (direction (0,0,1), target 0, twist 0) DCS = WCS, so the window is simply
center ± (w/2, h/2). If the output aspect differs, AutoCAD fits the *height* or *width*,
whichever constrains more (ezdxf `vport_table.rst`: "AutoCAD tries to fit the modelspace area
into the available viewport space"). ezdxf's author also notes that "the translation of the
view-center-point … not always work as I expected" → **UNKNOWN** for non-plan views. R12 also
has `$VIEWCTR`/`$VIEWSIZE` in the HEADER, which **should** match *ACTIVE (header note).

PLOT itself usually doesn't use the VPORT but the model LAYOUT's plot area (extents, limits,
view, window; see the layout note). The VPORT table has **no** influence on paper-space
rendering (paper space uses the layout's VIEWPORT entity with id 1).

### 2.5 VIEW

Named views (spec 2480 ff., sample `view_custom`):

| Code | Meaning |
|---|---|
| 2, 70 | name, flags (1 = paper-space view) |
| 40 / 41 | view height / width (DCS) |
| 10/20 | view center (DCS) |
| 11/21/31 | view direction from target (WCS) |
| 12/22/32 | target (WCS) |
| 42, 43, 44 | lens length, front/back clip |
| 50 | twist (deg) |
| 71 | view mode |
| 281 | render mode |
| 72 | 1 = UCS associated (then 110/111/112, 79, 146, 345, 346 follow) |
| 73 | camera plottable (R2007+). AutoCAD writes it *after* the UCS block (sample) |
| 332, 334 | background, live section (soft) |
| 348 | visual style (hard). **CONFLICT:** ixmilia says 338; spec, ezdxf, ACadSharp and the sample say 348 |
| 361 | sun (hard owner) |

Rendering relevance: PLOTSETTINGS plot type 3 ("View") names a VIEW in group 6 → the plot
window is that VIEW's center/width/height in its DCS. Also used by sheet sets. There's an
xdict with `ADSK_XREC_VTR*` (view animation info, ignore).

### 2.6 DIMSTYLE

The DIMSTYLE record is the persistent form of the `$DIM*` header variables. Every var has
the **same group code** in DIMSTYLE records, in DIMENSION XDATA overrides (`ACAD {DSTYLE`
1070-coded) and in the header (named `$DIMxxx`). Only the rendering of dimensions (dimension
note) needs most of them, because a DIMENSION usually carries its own anonymous `*D` block.
**The renderer should draw that block and only fall back to regeneration when it's missing.**

**Complete code ↔ variable map** (spec 2074–2280; ezdxf `entities/dimstyle.py:30–190`;
ixmilia; libredwg). *AutoCAD default* = the value AutoCAD assumes when the code is **absent** from
the record (built-in imperial defaults). Derived from sample `Standard` (only 340) vs `ISO-25`
(which writes every code that differs), which makes these **VERIFIED-BY-ACAD** for every var ISO-25
overrides and **ASSUMPTION** (Autodesk imperial template) for the rest. *ezdxf default* is what
ezdxf returns when the code is absent (metric, **CONFLICT** for reading).

| Code | Var | Type | AutoCAD default (absent) | ezdxf default | Versions / notes |
|---|---|---|---|---|---|
| 3 | DIMPOST | str | "" | "" | `<>` placeholder |
| 4 | DIMAPOST | str | "" | "" | |
| 5 | DIMBLK (name) | str | "" | "" | R12 only (obsolete) |
| 6 | DIMBLK1 (name) | str | "" | "" | R12 only |
| 7 | DIMBLK2 (name) | str | "" | "" | R12 only |
| 40 | DIMSCALE | real | 1.0 | 1 | 0 = paper-space-scaled (DIMSCALE 0 → viewport scale) |
| 41 | DIMASZ | real | 0.18 ✔ | 2.5 | |
| 42 | DIMEXO | real | 0.0625 ✔ | 0.625 | |
| 43 | DIMDLI | real | 0.38 ✔ | 3.75 | |
| 44 | DIMEXE | real | 0.18 ✔ | 1.25 | |
| 45 | DIMRND | real | 0 | 0 | |
| 46 | DIMDLE | real | 0 | 0 | |
| 47 | DIMTP | real | 0 | 0 | |
| 48 | DIMTM | real | 0 | 0 | |
| 49 | DIMFXL | real | 1.0 | 2.5 | R2007+, undocumented in DXF ref |
| 50 | DIMJOGANG | real (deg in DXF?) | 45° | 90 | R2007+; unit **UNKNOWN** (radians in DWG) |
| 69 | DIMTFILL | int | 0 | 0 | R2007+: 0 none, 1 background, 2 DIMTFILLCLR |
| 70 (2nd) | DIMTFILLCLR | ACI | 0 (BYBLOCK) | 0 | R2007+, **second** 70 in the record |
| 71 | DIMTOL | bool | 0 | 0 | |
| 72 | DIMLIM | bool | 0 | 0 | |
| 73 | DIMTIH | bool | 1 ✔ | 0 | |
| 74 | DIMTOH | bool | 1 ✔ | 0 | |
| 75 | DIMSE1 | bool | 0 | 0 | |
| 76 | DIMSE2 | bool | 0 | 0 | |
| 77 | DIMTAD | int | 0 ✔ | 1 | 0 center, 1 above, 2 outside, 3 JIS, 4 below |
| 78 | DIMZIN | int | 0 ✔ | 8 | |
| 79 | DIMAZIN | int | 0 | 3 | R2000+ |
| 90 | DIMARCSYM | int | 0 | — | R2007+ |
| 140 | DIMTXT | real | 0.18 ✔ | 2.5 | |
| 141 | DIMCEN | real | 0.09 ✔ | 2.5 | <0 center lines, >0 marks, 0 none |
| 142 | DIMTSZ | real | 0 | 0 | >0 ticks instead of arrows |
| 143 | DIMALTF | real | 25.4 ✔ | 0.03937 | |
| 144 | DIMLFAC | real | 1 | 1 | |
| 145 | DIMTVP | real | 0 | 0 | |
| 146 | DIMTFAC | real | 1 | 1 | |
| 147 | DIMGAP | real | 0.09 ✔ | 0.625 | <0 boxed text |
| 148 | DIMALTRND | real | 0 | 0 | R2000+ |
| 170 | DIMALT | bool | 0 | 0 | |
| 171 | DIMALTD | int | 2 ✔ | 3 | |
| 172 | DIMTOFL | bool | 0 ✔ | 1 | |
| 173 | DIMSAH | bool | 0 | 0 | |
| 174 | DIMTIX | bool | 0 | 0 | |
| 175 | DIMSOXD | bool | 0 | 0 | |
| 176 | DIMCLRD | ACI | 0 (BYBLOCK) | 0 | true-color storage **UNKNOWN** |
| 177 | DIMCLRE | ACI | 0 | 0 | |
| 178 | DIMCLRT | ACI | 0 | 0 | |
| 179 | DIMADEC | int | 0 | 2 | R2000+ |
| 270 | DIMUNIT | int | 2 | — | obsolete (→ DIMLUNIT + DIMFRAC) |
| 271 | DIMDEC | int | 4 ✔ | 2 | R2000+ |
| 272 | DIMTDEC | int | 4 ✔ | 2 | |
| 273 | DIMALTU | int | 2 | 2 | |
| 274 | DIMALTTD | int | 2 ✔ | 3 | |
| 275 | DIMAUNIT | int | 0 | 0 | 0 deg, 1 DMS, 2 grad, 3 rad, 4 surveyor |
| 276 | DIMFRAC | int | 0 | 0 | |
| 277 | DIMLUNIT | int | 2 | 2 | 1 sci, 2 dec, 3 eng, 4 arch, 5 frac, 6 Windows |
| 278 | DIMDSEP | int (char) | 46 '.' ✔ | 44 ',' | |
| 279 | DIMTMOVE | int | 0 | 0 | |
| 280 | DIMJUST | int | 0 | 0 | |
| 281 | DIMSD1 | bool | 0 | 0 | |
| 282 | DIMSD2 | bool | 0 | 0 | |
| 283 | DIMTOLJ | int | 1 ✔ | 0 | |
| 284 | DIMTZIN | int | 0 ✔ | 8 | |
| 285 | DIMALTZ | int | 0 | 0 | |
| 286 | DIMALTTZ | int | 0 | 0 | |
| 287 | DIMFIT | int | 3 | — | obsolete (→ DIMATFIT + DIMTMOVE) |
| 288 | DIMUPT | bool | 0 | 0 | |
| 289 | DIMATFIT | int | 3 | 3 | |
| 290 | DIMFXLON | bool | 0 | 0 | R2007+ |
| 294 | DIMTXTDIRECTION | bool | 0 | — | R2010+? **UNKNOWN** (not in ezdxf's map) |
| 340 | DIMTXSTY → STYLE handle | h | Standard | — | R2000+. Sample: always written |
| 341 | DIMLDRBLK → BLOCK_RECORD | h | "" = closed filled | — | R2000+ |
| 342 | DIMBLK → BLOCK_RECORD | h | closed filled | — | R2000+ |
| 343 | DIMBLK1 → BLOCK_RECORD | h | | | |
| 344 | DIMBLK2 → BLOCK_RECORD | h | | | |
| 345 | DIMLTYPE → LTYPE | h | BYBLOCK | — | R2007+ |
| 346 | DIMLTEX1 → LTYPE | h | BYBLOCK | | R2007+ |
| 347 | DIMLTEX2 → LTYPE | h | BYBLOCK | | R2007+ |
| 371 | DIMLWD | lw | −2 BYBLOCK | −2 | R2000+ |
| 372 | DIMLWE | lw | −2 BYBLOCK | −2 | R2000+ |

(✔ = confirmed by the sample's ISO-25 vs Standard diff. For example ISO-25 writes `73 0 74 0
77 1 78 8 172 1 271 2 272 2 274 3 278 44 283 0 284 8`, so the absent values are 1,1,0,0,0,4,4,2,
46,1,0.)

Arrow handles: an absent handle or handle `0` = default **closed filled** (ezdxf
`dimstyle.py:585`). Otherwise it's a BLOCK_RECORD handle whose name is either an AutoCAD
standard arrow (`_ArchTick`, `_ClosedBlank`, `_BoxBlank`, `_Dot`, `_None`, … which AutoCAD writes
as real blocks, see sample BLOCK_RECORDs `_ArchTick`, `_ClosedBlank`, `_BoxBlank`) or a user block.
A dangling handle → default arrow (ezdxf `dimstyle.py:432`).

**DIMSTYLE XDATA extensions** (vars not representable as record codes; APPIDs must exist):
`ACAD_DSTYLE_DIMJAG` `1070 388 / 1040 <DIMJAG jog height factor, 1.5>`;
`ACAD_DSTYLE_DIMTALN` `1070 392 / 1070 <DIMTOLALIGN>`; `ACAD_DSTYLE_DIMBREAK`
`1070 391 / 1040 <DIMBREAK size>`; `ACAD_DSTYLE_DIMJAG_POSITION`; R2000/R2004 only:
`ACAD_DSTYLE_DIM_LINETYPE 1070 380 / 1005 <ltype handle>`, `…_DIM_EXT1_LINETYPE 381`,
`…_DIM_EXT2_LINETYPE 382` (the pre-R2007 place for DIMLTYPE/DIMLTEX1/2), and
`ACAD_DSTYLE_DIMTEXT_FILL`. Also `AcadAnnotative {1070 1 1070 1}` marks annotative
styles. Sources: sample; LibreCAD `rs_filterdxfrw.cpp:33774 ff` (GPL, facts only); LibreCAD PR in
`LibreCAD__LibreCAD/threads` ("in XDATA at those versions, not the native 345-347").
Pattern: `1001 APPID`, then pairs `1070 <dimvar code>`, value (`1040`/`1070`/`1005`).

R12 DIMSTYLE: arrow block *names* in 5/6/7. There's no DIMTXSTY code, so the text style comes
from... **UNKNOWN** (probably `$DIMTXSTY`/STANDARD; irrelevant if the `*D` block exists).

ezdxf's R2007 export map (`dimstyle.py:192`) omits DIMPOST/DIMAPOST (3/4), which is probably an
ezdxf bug. AutoCAD writes 3/4 when non-empty. **ASSUMPTION**.

### 2.7 UCS

Spec 2440 ff., ixmilia. `2`, `70`, origin `10/20/30`, X axis `11/21/31`, Y axis `12/22/32`,
`79` (always 0), `146` elevation, `346` base UCS, repeated pairs `71` ortho type + `13/23/33`
origin. **Not rendering-relevant.** It only matters for UI and for LAYOUT/VPORT/VIEW UCS
references. Keep it for round-tripping.

### 2.8 APPID

`2` name, `70` flags (spec 1990). Every `1001` XDATA app name must have an APPID entry, or
AutoCAD refuses the file (ezdxf `docs/.../tables/appid_table.rst`). `ACAD` must always exist.
Known ones: `ACAD`, `AcAecLayerStandard`, `AcCmTransparency`, `HATCHBACKGROUNDCOLOR`,
`AcadAnnotative`, `AcadAnnoPO`, `ACAD_PSEXT`, `ACAD_NAV_VCDISPLAY`, `ACAD_MLEADERVER`,
`ACAD_DSTYLE_*`, `AcDbBlockRepBTag`, `AcDbDynamicBlockGUID`, … Reader: don't validate. Writer:
auto-register every APPID used in XDATA.

### 2.9 BLOCK_RECORD (R2000+)

Spec 2010 ff., ezdxf `entities/blockrecord.py:39`, ixmilia, sample:

| Code | Meaning | Notes |
|---|---|---|
| 2 | block name | `*Model_Space`, `*Paper_Space`, `*Paper_Space0..N`, `*D<n>` dims, `*U<n>` anon/dynamic reps, `*T<n>` tables, `*X<n>` hatch?, `*A<n>` groups? (anonymous group names are `*A1`… in ACAD_GROUP, not blocks), `_ArchTick` arrows |
| 340 | LAYOUT handle (hard pointer) | `0` for non-layout blocks |
| 70 | block insertion units (INSUNITS enum 0..20) | R2007+ (ixmilia/ezdxf). **Not** block flags! (those live in BLOCK 70) |
| 280 | explodability 0/1 | R2007+ |
| 281 | scalability: 1 = uniform scaling only | R2007+ |
| 310 | preview bitmap, binary chunks (BMP/"DIB" data) | optional, often huge. Keep lazily or drop |
| `102 {BLKREFS 331 … 102 }` | soft pointers to the INSERTs referencing this block | sample. Order: after 340, before 70 |
| XDATA `ACAD "DesignCenter Data" {1070 ver 1070 units}` | insert units for pre-2007 | spec 2034 |
| XDATA `AcDbBlockRepBTag 1070 1 / 1005 <handle>` | this `*U` block is a representation of dynamic block `<handle>` | sample |
| XDATA `AcDbDynamicBlockGUID 1000 {GUID}` | dynamic block definition | sample |
| xdict `ACAD_SORTENTS` → SORTENTSTABLE | draw order | §3.12 |
| xdict `ACAD_ENHANCEDBLOCK` → evaluation graph | dynamic block | §3.21 |

Owner 330 = BLOCK_RECORD table (`1`). The BLOCK_RECORD is the **hard owner** of all entities of
its block. Each entity's 330 points to it, and paper space entities additionally carry `67 1`.

**Layout blocks.** `*Model_Space` ↔ the "Model" LAYOUT. `*Paper_Space` ↔ the *active* paper
layout (its entities live in the ENTITIES section with `67 1`). `*Paper_Space0`…`N` ↔ the other
layouts (entities in the BLOCKS section). The numbering doesn't correspond to tab order (tab
order is LAYOUT 71). The name ↔ layout link must go through `340` / LAYOUT `330`, never the
name suffix. R12: `$MODEL_SPACE`/`$PAPER_SPACE` blocks (both spellings are accepted by ezdxf
`lldxf/const.py:630`). Details are in the blocks/layout notes.

**Xref flags** are on the BLOCK entity (70: 4 xref, 8 overlay, 16 dependent, 32 resolved,
64 referenced), with group 1 = path. The BLOCK_RECORD has no xref flag codes in DXF.

**Insert units (70)**: **ASSUMPTION:** the INSERT's stored scale factors already contain the
unit conversion applied when the block was inserted, so the renderer ignores 70 (and
`$INSUNITS`). **UNKNOWN / needs AutoCAD test** (insert an inch block into an mm drawing, compare
41/42/43).

---

## 3. OBJECTS section

### 3.1 General rules

- The **root ("named object") dictionary** is the first object of the OBJECTS section
  (ezdxf `docs/.../sections/objects_section.rst`). It has `330 0`, no reactors, `281 1`, and **no
  280** (sample `5 C`). Don't assume the handle is `C`. Take the first object, or better, the
  DICTIONARY whose owner is 0.
- Every other object has the owner in 330 and usually the same handle as a single REACTORS entry.
- Objects form a tree via ownership handles (350/360 in dictionaries, 360 in xdicts). Some
  objects (xdicts, their XRECORDs) aren't reachable from the root, only from their owner entity.
- Unknown object types must be preserved verbatim (tag list + handle + owner). The CLASSES
  section tells which DXF names are custom classes. The sample contains 48 object types, many
  of them AEC/association/dynamic-block internals.
- **Common object group codes** (spec 7688): 0, 5, `102 {ACAD_REACTORS 330… }`,
  `102 {ACAD_XDICTIONARY 360 }`, 330 owner, then subclass markers.

Handle pointer code ranges (spec 581–610): 320–329 arbitrary (not translated), 330–339 soft
pointer, 340–349 hard pointer, 350–359 soft owner, 360–369 hard owner, 390–399 plot style
(hard), 480–481 hard pointer, 1005 XDATA handle (soft semantics, translated on merge;
ezdxf `docs/.../handles.rst`). Handles are up to 16 hex digits. `0` = null.

### 3.2 DICTIONARY

| Code | Meaning |
|---|---|
| 100 | AcDbDictionary |
| 280 | hard-owner flag: 1 = entries are hard-owned. **Default 0**: AutoCAD writes no 280 on the root and top-level dicts. Extension dicts have `280 1` (ezdxf `entities/dictionary.py:42–58`, several flip-flops: #1203, #1279; sample confirms: root/top-level no 280, xdicts `280 1`) |
| 281 | duplicate record cloning: 0 n/a, 1 keep existing, 2 use clone, 3 `<xref>$0$<name>`, 4 `$0$<name>`, 5 unmangle name. AutoCAD mostly writes 1 |
| 3 | entry key (case-insensitive? **ASSUMPTION** yes, like AutoCAD's `dictsearch`) |
| 350 | soft-owner handle of the entry |
| 360 | hard-owner handle of the entry: used instead of 350 in hard-owned (xdict) dictionaries (sample `ACAD_SORTENTS 360 355`). Undocumented but accepted by AutoCAD (ezdxf `dictionary.py:77`). Preserve the code used on read |

Key/value pairs appear as `3`/`350|360` pairs in order. Entries may point to missing handles
(ezdxf: ignore on export rather than remove, because an empty dict is worse, `dictionary.py:248`).
Add-ons can put *graphical* entities in dictionaries (ezdxf #585). Preserve them.

### 3.3 ACDBDICTIONARYWDFLT

A dictionary with a default: `100 AcDbDictionary`, 281, `3/350` entries, then
`100 AcDbDictionaryWithDefault`, `340 <default entry>`. It's used only for
`ACAD_PLOTSTYLENAME` (default "Normal") (spec 7764, sample `5 E`). A missing default object is
ignored by AutoCAD (ezdxf `dictionary.py:573`).

### 3.4 ACDBPLACEHOLDER

No data beyond the common codes (sample `5 F`). Used as the "Normal" plot style name object
that LAYER/entity 390 points to. Named plot style entries (`$PSTYLEMODE`=0) are also
placeholders; the actual pen settings are in an external `.stb` file. ezdxf lists a `280`
cloning attr (`entities/dxfobj.py:52`), but AutoCAD doesn't write it.

### 3.5 XRECORD

`100 AcDbXrecord`, `280 <cloning flag>` (R2000+ only, not R13/R14, ezdxf `dxfobj.py:90`), then
any tags with codes 1–369 except 5/105 (spec 10223). This is a raw tag bag. Keep it as
`Array<[code, value]>`. XRECORDs carry rendering-relevant data in several places: layer VP
overrides (2.1.3), `ACAD_XREC_ROUNDTRIP` (inverted xclip, §3.14), MTEXT column/roundtrip data,
etc.

### 3.6 DICTIONARYVAR and AcDbVariableDictionary

The `AcDbVariableDictionary` root entry maps names → `DICTIONARYVAR` objects:
`100 DictionaryVariables`, `280 0` (schema), `1 <value as string>` (spec 7969). They're
"system variables stored outside the HEADER".

Seen in the sample: `CANNOSCALE "1:1"`, `CMLEADERSTYLE STANDARD`, `CTABLESTYLE STANDARD`,
`CVIEWDETAILSTYLE Imperial24`, `CVIEWSECTIONSTYLE Imperial24`, `DIMASSOC 2`, `HIDETEXT 1`,
`HPCOLOR BYLAYER`, `HPTRANSPARENCY ByLayer`, `LAYEREVAL 0`, `LAYERNOTIFY 0`. The spec
additionally lists DEFAULTVIEWCATEGORY, DIMADEC, DIMDSEP, DRAWORDERCTL, FIELDEVAL, HALOGAP,
INDEXCTL, INTERSECTIONCOLOR, INTERSECTIONDISPLAY, MSOLESCALE, OBSCOLOR, OBSLTYPE, OLEFRAME,
PROJECTNAME, SORTENTS, UPDATETHUMBNAIL, XCLIPFRAME. ezdxf also writes `WIPEOUTFRAME`
(`ezdxf:src/ezdxf/document.py:1092`, ACadSharp `Objects/DictionaryVariable.cs:65`).

Which ones matter for rendering:
- **CANNOSCALE**: the current annotation scale of *model space*. It chooses which
  annotative representation (object context data) is displayed and plotted in model space.
  Paper-space viewports use their own annotation scale (VIEWPORT note). **High relevance** for
  annotative text/dims/hatches.
- **OLEFRAME** (0/1/2: frame of OLE objects), **XCLIPFRAME** (the header var `$XCLIPFRAME` is the
  documented home, R2004+; see below), **WIPEOUTFRAME**: frame visibility. **Medium.**
- **HIDETEXT**, **INTERSECTIONDISPLAY/COLOR**, **OBSCOLOR/OBSLTYPE**, **HALOGAP**: hidden-line
  and 3D modes only → ignore for 2D plots.
- **DIMASSOC**, **FIELDEVAL**, **LAYEREVAL/NOTIFY**, **HPCOLOR/HPTRANSPARENCY** (defaults for
  *new* hatches), CMLEADERSTYLE/CTABLESTYLE/CVIEW*: no rendering effect.

**Frame variables (FRAME family): CONFLICT.** AutoCAD docs (IMAGEFRAME/XCLIPFRAME/WIPEOUTFRAME):
0 = not displayed & not plotted, 1 = displayed & plotted, 2 = displayed but not plotted.
ezdxf `xclip.py:58` documents XCLIPFRAME as "1 displayed/not plotted, 2 displayed/plotted" (the
reverse), and `headervars.py:2008` notes that R2004/R2007 only allow 0/1. The spec (1609) only
knows 0/1. **UNKNOWN / needs AutoCAD test** for each variable and each value. Storage: IMAGEFRAME
→ RASTERVARIABLES 70, WIPEOUTFRAME → WIPEOUTVARIABLES 70 (+ DICTIONARYVAR?), XCLIPFRAME → header
(+ DICTIONARYVAR?), PDFFRAME/DWFFRAME/DGNFRAME → header `$DWFFRAME`/`$DGNFRAME` (ezdxf
`headervars.py:2290`), PDFFRAME **UNKNOWN**.

### 3.7 Root dictionary: standard entries

From the sample (AutoCAD 2018) plus the ezdxf lists (`sections/objects.py:547–578`) and the spec:

| Key | Target type | Render? | Notes |
|---|---|---|---|
| `ACAD_GROUP` | DICTIONARY of GROUP | no | keys `*A1`… for unnamed groups |
| `ACAD_LAYOUT` | DICTIONARY of LAYOUT | **yes** | layout name → LAYOUT (layout note) |
| `ACAD_MLINESTYLE` | DICTIONARY of MLINESTYLE | **yes** | `Standard` must exist |
| `ACAD_MLEADERSTYLE` | DICTIONARY of MLEADERSTYLE | yes (fallback) | |
| `ACAD_TABLESTYLE` | DICTIONARY of TABLESTYLE | low | ACAD_TABLE has a `*T` block |
| `ACAD_PLOTSETTINGS` | DICTIONARY of PLOTSETTINGS | no (named page setups, not applied) | |
| `ACAD_PLOTSTYLENAME` | ACDBDICTIONARYWDFLT of ACDBPLACEHOLDER | STB mode only | "Normal" |
| `ACAD_MATERIAL` | DICTIONARY of MATERIAL | no (2D) | `ByBlock`, `ByLayer`, `Global` |
| `ACAD_COLOR` | DICTIONARY of DBCOLOR | no (420 carries the RGB) | key `BOOK$NAME` |
| `ACAD_VISUALSTYLE` | DICTIONARY of VISUALSTYLE | shade plot only | `2dWireframe`, `Conceptual`, … |
| `ACAD_SCALELIST` | DICTIONARY of SCALE | yes (annotative) | keys `A0`,`A1`… (not the scale names!) |
| `ACAD_IMAGE_DICT` | DICTIONARY of IMAGEDEF | **yes** | key = image name |
| `ACAD_IMAGE_VARS` | RASTERVARIABLES (directly, not a dict) | yes (frame) | |
| `ACAD_WIPEOUT_VARS` | WIPEOUTVARIABLES (directly) | yes (frame) | |
| `ACAD_PDFDEFINITIONS` / `ACAD_DWFDEFINITIONS` / `ACAD_DGNDEFINITIONS` | DICTIONARY of PDFDEFINITION/… | **yes** | underlays |
| `AcDbVariableDictionary` | DICTIONARY of DICTIONARYVAR | some | §3.6 |
| `ACAD_DETAILVIEWSTYLE` / `ACAD_SECTIONVIEWSTYLE` | DICTIONARY of ACDBDETAILVIEWSTYLE / ACDBSECTIONVIEWSTYLE | no | model documentation (views are ordinary entities/blocks) |
| `ACAD_FIELDLIST` | FIELDLIST | no | list of FIELD objects |
| `ACAD_ASSOCNETWORK`, `ACAD_ASSOCPERSSUBENTMANAGER`, `ACAD_PERSUBENTMGR` | association framework | no | |
| `ACAD_CIP_PREVIOUS_PRODUCT_INFO`, `ACAD_LAST_SAVED_VERSION_INFO`, `ACDB_RECOMPOSE_DATA` | misc XRECORD/DICT | no | |
| `ACAD_RENDER_*`, `ACAD_BACKGROUND`, `ACAD_LIGHTS`? | render settings | no | |

Missing standard dictionaries must be tolerated (files from other writers often have only
`ACAD_GROUP`, or no OBJECTS at all in R12). **Rule:** treat "missing dict" like "empty dict"
and apply built-in defaults (MLINESTYLE Standard, MLEADERSTYLE Standard, etc.).

### 3.8 LAYOUT / PLOTSETTINGS (brief)

Both start with `100 AcDbPlotSettings` (page setup): `1` page setup name, `2` device (pc3),
`4` paper size name, `6` plot view name, `40–43` margins (mm), `44/45` paper width/height (mm),
`46/47` plot origin offset, `48/49/140/141` plot window, `142/143` custom scale
numerator/denominator, `70` plot layout flags (1 plot viewport borders, 2 show plot styles, 4 plot
centered, 8 plot hidden, 16 use standard scale, 32 plot with plot styles, 64 scale lineweights,
128 plot entity lineweights, 512 draw viewports first, 1024 model type, …; default 688), `72`
paper units (0 in, 1 mm, 2 px), `73` rotation (0..3), `74` plot type (0 display, 1 extents,
2 limits, 3 view, 4 window, 5 layout), `7` CTB/STB file, `75` standard scale type, `147` unit
factor, `76–78` shade plot, `148/149` paper image origin, `333` shade plot handle (ezdxf
`entities/layout.py:32–190`). The LAYOUT adds `100 AcDbLayout`: `1` name, `70` flags, `71` tab
order, `10/11` limits, `12` insert base, `14/15` extents, `146` elevation, `13/16/17` UCS, `76`
UCS type, **`330` BLOCK_RECORD**, `331` last active VIEWPORT, `345/346` UCS
(`layout.py:274–335`; sample LAYOUT 59 also has XDATA `ACAD_PSEXT`). Everything else is in the
layout note. PLOTSETTINGS objects in ACAD_PLOTSETTINGS are only named templates.

### 3.9 MLINESTYLE (full)

Spec 8988 ff., ezdxf `entities/mline.py:751`, ACadSharp `Objects/MLineStyle*.cs`, libredwg
`dwg.spec:4513`, sample:

```
0 MLINESTYLE / 5 / {ACAD_REACTORS 330 dict} / 330 dict
100 AcDbMlineStyle
2   name ("STANDARD" in the sample, although the dict key is "Standard")
70  flags
3   description (≤255 chars)
62  fill color (ACI; default 256 BYLAYER) [+420/430 true color? ASSUMPTION]
51  start angle (deg, default 90)
52  end angle (deg, default 90)
71  number of elements
  repeated: 49 offset / 62 color / 6 linetype name
```

Flags 70: 1 fill on, 2 display miters (joints), 16 start square cap (line), 32 start inner arcs,
64 start round (outer arc), 256 end square, 512 end inner arcs, 1024 end round
(`ezdxf:src/ezdxf/lldxf/const.py:676`).

- **Element offset** 49: normal distance from the MLINE's reference line. Elements aren't
  necessarily sorted; ezdxf sorts by offset for rendering (`mline.py:856`). The MLINE entity has
  its own justification (0 top, 1 zero, 2 bottom) and scale (40), which multiplies the offsets.
  Geometry: the MLINE entity stores per-vertex miter directions and per-element
  segment/area-fill parameters, so rendering mostly uses the entity data. The style supplies
  **colors, linetypes, fill, caps, and miter display**.
- **Element color** 62: ACI; spec default 0, AutoCAD writes 256 (sample). The ACadSharp default
  is ByLayer. BYBLOCK/BYLAYER resolve against the MLINE entity/layer as usual.
- **Element linetype** 6: by **name** (`BYLAYER`, `BYBLOCK` or a table name). libredwg: DWG stores
  an index with 32767 = BYLAYER, 32766 = BYBLOCK (`dwg.spec:4562`).
- **Angles** 51/52: cap angles in degrees. libredwg clamps odd values on output (`dwg.spec:4531`,
  normalizes >91° with fmod). **UNKNOWN:** how AutoCAD renders angles ≠ 90.
- The `2` name is redundant. The dictionary key is authoritative, and MLINE references its style
  by handle `340` (spec 9057: "these groups should not be modified"). The MLINE's `2` name is
  also redundant.
- `ACAD_MLINESTYLE` must contain `Standard` (ezdxf `mline.py:963`).
- Fill color **true color**: DWG has a CMC, so DXF probably writes 420/430 after 62 when set.
  **ASSUMPTION / needs test**.

### 3.10 MLEADERSTYLE (full)

Spec 5231 ff. (incomplete), ezdxf `entities/mleader.py:1262`, ezdxf
`docs/source/dxfobjects/mleaderstyle.rst`, ACadSharp `Objects/MultiLeaderStyle.cs`. The sample
record (AutoCAD 2018, "Standard", imperial) is in the file order below:

| Code | Name | Sample value | Meaning / values |
|---|---|---|---|
| 179 | version? | 2 | undocumented (ezdxf `unknown1`) |
| 170 | content type | 2 | 0 none, 1 block, 2 MTEXT, 3 tolerance |
| 171 | draw mleader order | 1 | 0 content first, 1 leader first? (**UNKNOWN**) |
| 172 | draw leader order | 0 | 0 leader head first? (**UNKNOWN**) |
| 90 | max leader segment points | 2 | |
| 40 | first segment angle constraint | 0.0 | radians (ezdxf docs) |
| 41 | second segment angle constraint | 0.0 | |
| 173 | leader type | 1 | 0 invisible, 1 straight, 2 spline |
| 91 | leader line color | −1056964608 | raw AcCmColor: 0xC1000000 = BYBLOCK; 0xC0000000 = BYLAYER; 0xC3xxxxxx = ACI; 0xC2RRGGBB = RGB |
| 340 | leader linetype handle | `14` (ByBlock) | |
| 92 | leader lineweight | −2 | |
| 290 | enable landing | 1 | |
| 42 | landing gap | 0.09 | |
| 291 | enable dogleg | 1 | |
| 43 | dogleg length | 0.36 | |
| 3 | description (ezdxf calls it name) | Standard | the real name is the dict key |
| 341 | arrowhead block handle | absent = closed filled | |
| 44 | arrowhead size | 0.18 | |
| 300 | default MTEXT content | "" | |
| 342 | MTEXT style handle | `11` | |
| 174 | text left attachment | 1 | 0 top of top line, 1 middle of top line, 2 middle of text, 3 middle of bottom line, 4 bottom of bottom line, 5 bottom line underlined, 6 top line underlined, 7 bottom of top line, 8 all underlined |
| 178 | text right attachment | 1 | same enum |
| 175 | text angle type | 1 | 0 = last segment angle, 1 horizontal, 2 last segment angle but readable |
| 176 | text alignment type | 0 | not the MTEXT attachment (ezdxf) |
| 93 | text color | BYBLOCK raw | |
| 45 | text height | 0.18 | |
| 292 | text frame | 0 | |
| 297 | text align always left | 0 | |
| 46 | align space | 0.18 | |
| 343 | block content handle | absent | |
| 94 | block color | BYBLOCK raw | |
| 47, 49, 140 | block scale x, y, z | 1,1,1 | |
| 293 | enable block scale | 1 | |
| 141 | block rotation | 0.0 | radians |
| 294 | enable block rotation | 1 | |
| 177 | block connection type | 0 | 0 center extents, 1 insertion point |
| 142 | overall scale | 1.0 | 0 = annotative/viewport? |
| 295 | overwrite property value | 0 | |
| 296 | is annotative | 1 | the sample's Standard **is** annotative |
| 143 | break gap size | 0.125 | |
| 271 | text attachment direction | 0 | 0 horizontal (left/right), 1 vertical (top/bottom) |
| 272 | bottom attachment | 9 | 9 center, 10 underline+center |
| 273 | top attachment | 9 | 9 center, 10 overline+center |
| 298 | unknown bool | 0 | undocumented (ACadSharp comment) |

Rendering: MLEADER entities carry a full copy of the effective values in their context data
plus a property-override bitmask (MLEADER 90). The style is only a fallback for non-overridden
properties (MLEADER note). The defaults for an absent code (ezdxf `mleader.py:1265ff`, metric
2.5/4/8…) **may not match AutoCAD** in the same way as DIMSTYLE. **UNKNOWN**: does AutoCAD write
MLEADERSTYLE sparsely? The sample writes every code, so probably not.

### 3.11 TABLESTYLE (brief)

`100 AcDbTableStyle`, `280` version (0), `3` description, `70` flow direction, `71` flags, `40`/`41`
horizontal/vertical cell margin, `280` suppress title, `281` suppress header. Then per row type
(data, title, header) a block of: `7` **text style name** (by name!), `140` text height, `170`
cell alignment, `62` text color, `63` fill color, `283` fill enabled, `90` cell data type, `91`
unit type, `1` format, `274–279` border lineweights, `284–289` border visibility, `64–69` border
colors (sample; spec 9897). R2010+ adds `CELLSTYLEMAP` in the xdict
(`ACAD_ROUNDTRIP_2008_TABLESTYLE_CELLSTYLEMAP`). Rendering: ACAD_TABLE has its `*T` anonymous
block, so use that. The table style is needed only when regenerating tables ourselves (out of
scope for v1).

### 3.12 SORTENTSTABLE (draw order, **important**)

VERIFIED-BY-ACAD 2026-09-30 (draworder suite, note 06 §8.2): numeric sort-handle order with
file-order ties, unlisted entities by own handle, sort handle 0 = key 0 (first), applied to PLOT
only when $SORTENTS has bit 32; block tables are honoured.

Spec 9855, ezdxf `entities/dxfobj.py:168–290`, `reorder.py`, sample:

```
0 SORTENTSTABLE / 5 355 / {ACAD_REACTORS 330 15D} / 330 15D   (owner = ACAD_SORTENTS xdict)
100 AcDbSortentsTable
330 1F           block record whose entities are ordered (spec: "currently only *MODEL_SPACE or *PAPER_SPACE", but AutoCAD also writes it for ordinary blocks: sample my_block_v2 / my_block)
331 353          entity handle
5   35A          its sort handle
331 35A
5   354
...
```

Location: `BLOCK_RECORD xdict["ACAD_SORTENTS"]` (360 in the xdict). An empty table (only 330) is
valid (sample 79B, A0D).

Algorithm (ezdxf `reorder.py:_build`, **matches AutoCAD per ezdxf**):
1. For each entity in the block, in file order: `key = sortHandle(entity) ?? entity.handle`.
2. Convert the key as hex to an unsigned integer (up to 64 bits, or use BigInt: "handles up to
   128-bit" exist in `CADKitSamples`, `reorder.py:71`).
3. A key of `0` is treated as **+∞** (drawn last, on top). ezdxf: "this behavior is defined by
   AutoCAD but not documented" (`reorder.py:66`, `dxfobj.py:267`).
4. Sort ascending by key, **stable** (ties keep file order). Sort handles don't have to be unique
   and can reuse existing handles (`dxfobj.py:263`).
5. Invalid entity handles are ignored by AutoCAD.

Notes:
- `$SORTENTS` (header, bit 16 regen, bit 32 plot; AutoCAD default 127): the spec says AutoCAD
  uses handle order when the regen bit is set, which reads backwards. **UNKNOWN**: do plots
  ignore SORTENTSTABLE when bit 32 is cleared? Modern AutoCAD always honors draw order (the
  SORTENTS var is documented as obsolete-ish). Test it.
- Inside blocks: ezdxf ignores block draw order by default (`virtual_entities(redraw_order=True)`
  is opt-in, ezdxf #717). ACadSharp #897 reports that AutoCAD's own **PDF export** sometimes
  loses the block draw order when the sort handles don't match the entity handles.
  **UNKNOWN / needs AutoCAD test** (block draw order in PLOT, with sort handles ≠ entity handles).
- Draw order across VIEWPORT content vs paper space entities: see the layout/viewport note
  (ezdxf #634: AutoCAD ignores the "draw viewports first" flag).
- WIPEOUT masking depends entirely on this order (mlightcad #671).

### 3.13 SPATIAL_FILTER / SPATIAL_INDEX (xclip)

Location: `INSERT xdict["ACAD_FILTER"]` → DICTIONARY → `"SPATIAL"` → SPATIAL_FILTER (ezdxf
`xclip.py:14–21`). Sample `5 D32`:

| Code | Meaning |
|---|---|
| 100 AcDbFilter, 100 AcDbSpatialFilter | |
| 70 | number of boundary points: 2 = rectangle (lower-left, upper-right), >2 = polygon |
| 10/20 × n | boundary points in the clip-boundary coordinate system ("OCS", "based on an xref scale of 1") |
| 210/220/230 | boundary plane normal |
| 11/21/31 | origin of the boundary's local CS |
| 71 | clipping enabled (1) |
| 72 / 40 | front clip flag / distance (40 only if 72 = 1) |
| 73 / 41 | back clip flag / distance |
| 40 × 12 | inverse of the INSERT transform at clip time (4×3, column-major) |
| 40 × 12 | transform into the clip-boundary CS (4×3) |

Sample: the first matrix contains 25.4 scale factors, so the matrices do matter. **Inverted
clips** are stored in an XRECORD `ACAD_XREC_ROUNDTRIP` in the SPATIAL_FILTER's xdict, with sections
`ACAD_INVERTEDCLIP_ROUNDTRIP` / `…_COMPARE` (ezdxf `xclip.py:18,123,154`; ezdxf itself says
the structure is "not fully understood"). The clip frame is controlled by `$XCLIPFRAME`
(§3.6). Rendering belongs to the INSERT/xclip note (ezdxf `xclip.py`, frontend `frontend.py:908`).

SPATIAL_INDEX (`AcDbIndex 40 timestamp`, `AcDbSpatialIndex`) is "always written out empty"
(spec 9768). Ignore it, but keep it for round-tripping. The same goes for LAYER_INDEX
(`8`/`360`/`90` triples) and IDBUFFER.

### 3.14 IMAGEDEF / IMAGEDEF_REACTOR / RASTERVARIABLES

IMAGEDEF (spec 8311; sample `5 8C4`, owner `ACAD_IMAGE_DICT` entry `image`):

| Code | Meaning |
|---|---|
| 100 AcDbRasterImageDef | |
| 90 | class version 0 |
| 1 | file path (relative `.\image.JPG` in the sample, absolute, or bare name) |
| 10/20 | image size in pixels (u, v) |
| **11/21** | default pixel size in drawing units (u, v). **CONFLICT:** spec says 11/12, AutoCAD writes 11/21 (sample `11 0.26458 / 21 0.26458`, i.e. 96 dpi in mm). ezdxf reads it as a 2D point at 11 (`image.py:562`) |
| 280 | loaded flag |
| 281 | resolution units: 0 none, 2 cm, 5 inch |
| REACTORS | the owner dict + one IMAGEDEF_REACTOR per IMAGE |

The IMAGE entity (entity note) has its own `11`/`12` u/v vectors and `13` size, so rendering needs
the IMAGEDEF for the **file path only** (plus loaded state). Path resolution: absolute path,
then relative to the DXF location, then the bare name in the DXF folder (AutoCAD's "found in"
logic). **ASSUMPTION**.

IMAGEDEF_REACTOR: `100 AcDbRasterImageDefReactor`, `90 2`, `330 <IMAGE handle>` (spec 8359,
sample). It has no rendering meaning.

RASTERVARIABLES (sample `5 8C3`, the root key `ACAD_IMAGE_VARS` points **directly** at it):
`100 AcDbRasterVariables`, `90 0`, `70` image frame (IMAGEFRAME: 0/1[/2], see the §3.6
conflict), `71` display quality (0 draft, 1 high; screen only), `72` insertion units (0 none,
1 mm, 2 cm, 3 m, 4 km, 5 in, 6 ft, 7 yd, 8 mi). **Rendering: 70 decides whether image
borders plot.** If the object is absent → **ASSUMPTION** frame = 1 (AutoCAD default IMAGEFRAME 1).

### 3.15 WIPEOUTVARIABLES

Sample `5 44E`: `100 AcDbWipeoutVariables / 70 1` (**CONFLICT:** spec 10191 says
`AcDbRasterVariables` + `90`; AutoCAD 2018 writes neither). `70` = WIPEOUTFRAME. It decides whether
wipeout frames are drawn and plotted (0 off, 1 on, 2 display-only?, see §3.6). Root key
`ACAD_WIPEOUT_VARS`. ezdxf also mirrors it into a `WIPEOUTFRAME` DICTIONARYVAR
(`document.py:1092`). **UNKNOWN** which one AutoCAD reads when they disagree.

### 3.16 UNDERLAYDEFINITION (PDF/DWF/DGN)

Concrete DXF types are `PDFDEFINITION`, `DWFDEFINITION`, `DGNDEFINITION` (the spec's
"UNDERLAYDEFINITION" is the abstract class; ezdxf `entities/underlay.py:387–446`), stored in
`ACAD_PDFDEFINITIONS` / `ACAD_DWFDEFINITIONS` / `ACAD_DGNDEFINITIONS`. Codes: `100
AcDbUnderlayDefinition`, `1` file path (sample `..\pdf-definition.pdf`), `2` underlay name = **PDF
page number as a string** ("1"), DGN model name ("default"), DWF sheet name. REACTORS list the
underlay entities. Rendering a PDF underlay means rasterizing or vectorizing an external PDF page.
That's a large feature, **out of scope for v1**: draw the clip boundary or nothing.

### 3.17 GROUP

`100 AcDbGroup`, `300` description, `70` unnamed (1) / named (0), `71` selectable, `340 × n`
hard pointers to members (spec 8258, sample). **No rendering effect.**

### 3.18 SCALE (annotation scales)

`100 AcDbScale`, `70 0` (unknown), `300` name (`1:1`, `1:2`, …), `140` paper units, `141` drawing
units (scale = 140/141), `290` 1 = "unit scale" (the 1:1 entry) (sample B7/124). The dict keys are
`A0`, `A1`, … and have nothing to do with the names. Annotative entities keep per-scale
representations in their xdict (`AcDbContextDataManager` → `ACDB_ANNOTATIONSCALES` →
`ACDB_*OBJECTCONTEXTDATA_CLASS` objects, sample `ACDB_TEXTOBJECTCONTEXTDATA_CLASS`), each
pointing to a SCALE. The renderer must pick the representation for CANNOSCALE (model) or the
viewport's scale (paper). **This is significant but belongs in the annotative note.**
**UNKNOWN:** is the entity's own geometry always the representation of the scale that was
current at save time?

### 3.19 DBCOLOR

`100 AcDbColor`, `62` ACI, `420` RGB, `430` `BOOK$NAME` (sample 996). The entities also store 420
themselves, so this has no rendering effect.

### 3.20 MATERIAL, VISUALSTYLE, SUN, GEODATA, render objects (brief)

- **MATERIAL** (`100 AcDbMaterial`, name 1, ~100 codes for maps/channels; spec 8598; ACadSharp
  `Objects/Material.cs`): 3D rendering only. Keep it opaque.
- **VISUALSTYLE** (spec 10027; 24 objects in the sample: `2dWireframe`, `Wireframe`, `Hidden`,
  `Realistic`, `Conceptual`, `Shaded`, …, plus internal `*` ones). Referenced by VPORT/VIEW/VIEWPORT
  348. It matters only for shade-plot modes ≠ "as displayed"/2D wireframe. **v1: treat
  everything as 2D wireframe.** Keep it opaque.
- **SUN** (VIEW/VPORT 361), **LIGHTLIST**, **RENDERENVIRONMENT/RENDERGLOBAL/MENTALRAY…/RAPIDRT…**:
  ignore. Keep them opaque.
- **GEODATA** (ezdxf `entities/geodata.py`, `docs/source/dxfobjects/geodata.rst`; spec 8157):
  owned by the model space xdict `ACAD_GEOGRAPHICDATA`: version 90, coordinate type 70, host block
  330, design/reference points 10/11, unit scales 40/41, units 91/92, up direction 210, north
  direction 12, scale estimation 95, sea level 294/142/143, coordinate system XML in 301/303,
  mesh 93/13/14/96/97/98. No 2D rendering effect (the geo map image isn't in the DXF).

### 3.21 FIELD / FIELDLIST

FIELD (spec 8095; ezdxf `dxfobj.py:293–316`, not implemented): `1` evaluator id, `2`/`3` field
code (+overflow), `90` child count, `360` children, `97`/`331` referenced object ids, `93` data
sets, `6`/`7` keys (`ACFD_FIELD_VALUE`), `90` value type, `91`/`140`/`330`/`310` value, `301`/`9`
format, `98` format length. It's located in the text entity's xdict `ACAD_FIELD` → `TEXT`
→ FIELD. **Rendering uses the text cached in the TEXT/MTEXT/ATTRIB entity itself**; FIELD is
only needed to *re-evaluate* (e.g. date/filename fields that AutoCAD updates at plot time when
`FIELDEVAL` bit 16 "plot" is set). **UNKNOWN:** whether PLOT re-evaluates fields; if it does, the
cached value may differ from the plot. FIELDLIST: `ACAD_FIELDLIST` root entry, a list of FIELD ids.

### 3.22 Dynamic blocks and evaluation graphs (brief)

Dynamic block definitions (sample `MyBlock`, `my-dynamic-block`) hold xdict
`ACAD_ENHANCEDBLOCK` → `ACAD_EVALUATION_GRAPH` (nodes/edges) with parameter objects
(`BLOCKVISIBILITYPARAMETER`, `BLOCKLINEARPARAMETER`, `BLOCKSCALEACTION`, grips…) and
`ACDB_DYNAMICBLOCKPURGEPREVENTER_VERSION`. **Each INSERT of a modified dynamic block references
an anonymous `*U<n>` block** that already contains the evaluated geometry. Its BLOCK_RECORD
carries XDATA `AcDbBlockRepBTag 1005 <dyn block record>`, and the INSERT's xdict has
`AcDbBlockRepresentation` → `ACDB_BLOCKREPRESENTATION_DATA` (sample). **The renderer just draws
the referenced block and ignores the graph.** Visibility states are baked into the `*U` block.
**ASSUMPTION** (holds for AutoCAD-saved files). Files from other tools may reference the dynamic
block directly with visibility parameters: **UNKNOWN**. ACadSharp `Objects/Evaluations` shows the
object layout.

### 3.23 DIMASSOC, ACDBDETAILVIEWSTYLE / ACDBSECTIONVIEWSTYLE, others

- **DIMASSOC** (`AcDbDimAssoc` 330 dimension, 90 point flags, 70 trans-space, 71 rotated type, then
  `AcDbOsnapPointRef` groups; spec 7991, ezdxf `dimension.py:1073`). Associativity only, no
  rendering effect.
- **ACDBDETAILVIEWSTYLE / ACDBSECTIONVIEWSTYLE**: styles for model documentation views. Their
  graphics are ordinary entities. Keep them opaque.
- **LAYER_FILTER** (`AcDbFilter`/`AcDbLayerFilter`, 8 × layer names), **LAYER_INDEX**: UI and
  index only. Ignore.
- **ACAD_PROXY_OBJECT** (90 = 499, 91 class id, 93 bits, 310 data, 330/340/350/360 ids, 94 0, 95
  version, 70 format): keep it opaque.
- **DATATABLE**, **OBJECT_PTR**, **VBA_PROJECT** (90 size + 310 binary): keep opaque.

---

## 4. How entities reference table entries and objects

### 4.1 Reference inventory

**By name** (case-insensitive):

| Where | Code | Target |
|---|---|---|
| every entity | 8 | LAYER |
| every entity | 6 | LTYPE (absent = BYLAYER; `BYLAYER`/`BYBLOCK` keywords) |
| TEXT, MTEXT, ATTRIB, ATTDEF | 7 | STYLE (absent = `Standard`) |
| SHAPE | 2 | shape name inside any shape-file STYLE |
| INSERT | 2 | BLOCK (via BLOCK_RECORD name) |
| DIMENSION | 2 | anonymous `*D` block; 3 = DIMSTYLE name |
| LEADER, TOLERANCE | 3 | DIMSTYLE |
| VIEWPORT (R12/XDATA) | 1003 | frozen layer names in the XDATA version |
| LAYER | 6 | LTYPE |
| MLINESTYLE element | 6 | LTYPE |
| TABLESTYLE | 7 | STYLE |
| XDATA 1003 | — | LAYER |
| DICTIONARYVAR values | 1 | e.g. CMLEADERSTYLE → MLEADERSTYLE name |
| R12 DIMSTYLE | 5/6/7 | arrow BLOCK names |

**By handle**: DIMSTYLE 340–347; LTYPE 340; LAYER 390/347; entity 347 material, 390 plot style,
348 visual style?; MLINE 340 (style) with 2 redundant; MLEADER 340 (style), 341/343/344…;
MLEADERSTYLE 340/341/342/343; IMAGE/WIPEOUT 340 (IMAGEDEF), 360 (reactor); UNDERLAY 340
(definition); VIEWPORT 341 (frozen layers, R2000+), 340 clip entity, 345/346 UCS, 348 visual
style, 332/333; ACAD_TABLE 342 (TABLESTYLE), 343 (BLOCK_RECORD); HATCH 330 in boundary paths
(associativity); LAYOUT 330/331; BLOCK_RECORD 340; SORTENTSTABLE 330/331; GROUP 340; layer VP
overrides 335/343; XDATA 1005.

### 4.2 Resolution rules

1. **Case-insensitive** comparison for all table names and (ASSUMPTION) dictionary keys. ezdxf
   uses `str.lower()` (`lldxf/validator.py:383`). **UNKNOWN:** AutoCAD's folding of non-ASCII
   (e.g. `Ä` vs `ä`, Turkish i). Use a Unicode simple case fold and add a test. Names may contain
   `\U+XXXX` escapes in R2000–R2004 DXF (encoding note), so decode them before comparing.
2. **Keywords** `BYLAYER`, `BYBLOCK` (linetypes) are recognised before any table lookup, even if an
   entry exists.
3. **Missing layer** → AutoCAD creates the layer on load with default properties (color 7,
   Continuous, lineweight default, plot on) (ACadSharp #1244, claimed "same as RECOVER"). The
   renderer creates a virtual layer with those defaults, **not** layer 0's properties.
4. **Missing linetype** → AutoCAD refuses the file. Renderer: Continuous + warning. **Missing
   linetype on a LAYER** → Continuous (ezdxf audit).
5. **Missing text style** → `Standard` (ezdxf `audit.py:381`). **Missing `Standard`** → built-in
   txt.shx style. **UNKNOWN:** AutoCAD's own behaviour.
6. **Missing dimstyle** → `Standard` (ezdxf `audit.py:397`).
7. **Dangling handle** (points to nothing or to the wrong type) → treat as absent / default
   (ezdxf does this for DIMSTYLE arrows `dimstyle.py:432`; AutoCAD "does NOT report an error or
   even crash, if the text style handle is invalid" for complex linetypes,
   `tools/complex_ltype.py:98`).
8. **Name vs handle both present** → the handle wins (MLINE, DIMSTYLE R2000+, VIEWPORT frozen
   layers 341 vs XDATA 1003?). Keep both for round-tripping.
9. **Duplicate names** in a table (other than VPORT): **UNKNOWN** what AutoCAD does (most likely it
   renames or discards on RECOVER). Policy: the first entry wins for name lookup, keep all.
10. **R12 files without handles**: synthesize handles at load time (monotonic from `$HANDSEED` or
   from max(existing)+1) so the internal graph is handle-based. Remember that they were
   synthetic, so an R12 writer doesn't emit them. Table entries in AutoCAD's R12 output never have
   handles, even when entities do (§1.2).
11. **Handle collisions / bad `$HANDSEED`**: AutoCAD ignores `$HANDSEED` (ezdxf
   `docs/.../handles.rst`). Compute max+1 ourselves.
12. **Ownership consistency**: the owner 330 of an entity may be wrong in third-party files.
   ezdxf trusts the file position (ENTITIES → model/active paper by `67`; BLOCKS → the enclosing
   BLOCK). truedxf should do the same and treat 330 as advisory.

---

## 5. Data model sketch (TypeScript-ish)

```ts
type Handle = bigint;               // 0n = null; parse hex, keep original text for round-trip
type RawTags = Array<[code: number, value: string | number | Uint8Array]>;

interface DxfObjectBase {
  handle: Handle;
  ownerHandle: Handle;              // 330 (advisory)
  reactors: Handle[];               // {ACAD_REACTORS
  xdict?: Handle;                   // {ACAD_XDICTIONARY 360
  appData: Map<string, RawTags>;    // other 102 groups ({BLKREFS ...})
  xdata: Map<string /*APPID, case-insens.*/, RawTags>;
  handleSynthetic?: boolean;        // R12 without handles
}

interface SymbolTable<T extends TableEntry> {
  handle: Handle; declaredCount: number; extra: RawTags; // e.g. DIMSTYLE 71/340
  entries: T[];                                          // file order, duplicates kept
  byKey: Map<string /*casefold*/, T>;                    // first wins
}
interface TableEntry extends DxfObjectBase { name: string; flags: number; }

interface Layer extends TableEntry {
  aci: number /*abs*/; off: boolean; frozen: boolean; frozenNewVp: boolean; locked: boolean;
  trueColor?: number; colorBookName?: string; linetype: string /*name*/;
  plot: boolean /*absent=true*/; lineweight: number /*-3 default*/;
  plotStyle?: Handle; material?: Handle; unknown348?: Handle;
  transparency?: number /*raw 0x02..AA or undefined*/; description?: string;
  vpOverrides: Map<Handle /*VIEWPORT*/, {color?: RawColor; linetype?: Handle; lineweight?: number; transparency?: number}>;
}
interface LtypeElement { length: number; flags: number /*74*/; shapeNumber?: number;
  style?: Handle; scale: number; rotationDeg: number; offset: [number, number]; text?: string; }
interface Linetype extends TableEntry { description: string; patternLength: number; elements: LtypeElement[]; }
interface TextStyle extends TableEntry {           // name "" + flags&1 => shape file
  fixedHeight: number; widthFactor: number; obliqueDeg: number; genFlags: number; lastHeight: number;
  font: string; bigFont: string; ttfFamily?: string; ttfFlags?: number /*1071 raw*/;
}
interface DimStyle extends TableEntry {
  present: Map<number /*code*/, DimValue>;          // sparse, exactly what the file had
  // effective(code) = present.get(code) ?? ACAD_IMPERIAL_DEFAULTS[code]  (never ezdxf metric)
  // handle-valued: 340 txsty, 341..344 blocks, 345..347 ltypes; XDATA ext (DIMJAG etc.) parsed into present
}
interface VPort extends TableEntry { /* all codes; view: center, height(40), aspect(41), dir, target, twistDeg, ... */ }
interface View extends TableEntry { /* center, width(41), height(40), dir, target, twist, ucs?, visualStyle? */ }
interface BlockRecord extends TableEntry {
  layout: Handle; units: number; explodable: boolean; uniformScale: boolean;
  preview?: Uint8Array; blkRefs: Handle[];
  block: Handle /*BLOCK*/; endblk: Handle; entities: Handle[] /*file order*/;
}

interface Tables {
  vport: SymbolTable<VPort>; ltype: SymbolTable<Linetype>; layer: SymbolTable<Layer>;
  style: SymbolTable<TextStyle>; view: SymbolTable<View>; ucs: SymbolTable<Ucs>;
  appid: SymbolTable<AppId>; dimstyle: SymbolTable<DimStyle>; blockRecord: SymbolTable<BlockRecord>;
}

// OBJECTS: one handle-indexed store; typed views are decoded lazily from RawTags.
type DxfObject =
  | { type: "DICTIONARY"; hardOwned: boolean; cloning: number; entries: Array<{key: string; ref: Handle; code: 350 | 360}> }
  | { type: "ACDBDICTIONARYWDFLT"; /* + */ defaultRef: Handle }
  | { type: "XRECORD"; cloning?: number; tags: RawTags }
  | { type: "DICTIONARYVAR"; schema: number; value: string }
  | { type: "SORTENTSTABLE"; blockRecord: Handle; pairs: Array<[entity: Handle, sort: Handle]> }
  | { type: "MLINESTYLE"; flags: number; fill: RawColor; startDeg: number; endDeg: number;
      elements: Array<{offset: number; color: RawColor; linetype: string}> }
  | { type: "MLEADERSTYLE"; values: Map<number, unknown> }
  | { type: "IMAGEDEF"; path: string; sizePx: [number, number]; pixelSize: [number, number]; loaded: boolean; resUnits: number }
  | { type: "RASTERVARIABLES" | "WIPEOUTVARIABLES"; frame: number; quality?: number; units?: number }
  | { type: "PDFDEFINITION" | "DWFDEFINITION" | "DGNDEFINITION"; path: string; name: string }
  | { type: "SPATIAL_FILTER"; points: Vec2[]; normal: Vec3; origin: Vec3; enabled: boolean;
      front?: number; back?: number; invInsert: Mat4x3; clipXform: Mat4x3 }
  | { type: "LAYOUT" | "PLOTSETTINGS"; /* layout note */ }
  | { type: "SCALE"; name: string; paper: number; drawing: number; isUnit: boolean }
  | { type: string; unknown: true };                       // opaque, round-trip only

interface ObjectGraph {
  byHandle: Map<Handle, DxfObjectBase & DxfObject>;
  root: Handle;                                            // first object / owner 0 dictionary
  // resolved convenience views (computed after load):
  namedDict(key: string): Map<string, Handle> | undefined; // ACAD_LAYOUT, ACAD_MLINESTYLE, ...
  xdictOf(h: Handle): Map<string, Handle> | undefined;
  drawOrder(blockRecord: Handle): Handle[];                // SORTENTS algorithm §3.12
}

// Resolution service used by the renderer: name/handle -> entry with fallbacks of §4.2,
// records every fallback as a diagnostic.
```

Design points:
- **Lossless core + lazy typed views.** Keep every record as RawTags plus a decoded view. Only
  decode what the renderer needs. This covers the ~48 object types AutoCAD writes.
- **Sparse DIMSTYLE** (and probably any "AutoCAD omits default" record, like LAYER 290): store
  "present" separately from "effective" so the writer can reproduce AutoCAD's sparsity.
- **Handles as bigint** (up to 64-bit, maybe 128), with hex text preserved.
- **Two-phase load**: parse all sections → build the handle map → resolve names/handles → run
  diagnostics.

---

## 6. Open questions (summary)

- DIMSTYLE absent-code defaults for codes ISO-25 doesn't override (DIMFXL, DIMJOGANG, DIMTFILL…).
- Sparse DIMSTYLE relative to imperial defaults is confirmed for `$MEASUREMENT` 0 (ACadSharp
  sample) and 1 (dxf-json tc0). Still open: whether a *regenerating* AutoCAD really applies those
  defaults to a hand-written record that lacks codes (test 4).
- INSERT on a frozen/off layer (conflict with ezdxf).
- Defpoints with 290=1; `X|Defpoints`.
- FRAME variables' meaning of 1 vs 2, and which storage wins.
- SORTENTS inside blocks at PLOT time; the `$SORTENTS` bit 32.
- LTYPE text element height (46 vs style fixed height), bit 8 upright semantics.
- MLINESTYLE true colors and non-90° cap angles.
- Multi-tile *ACTIVE: which tile is "current".
- Non-ASCII case folding of names.
- Dimension colors as true color in DIMSTYLE (how they are stored).
- FIELD re-evaluation at plot time.

---

## Test ideas

Each is a small DXF (R2018 unless noted), plotted from AutoCAD to PDF/PNG with a fixed
page setup, then compared with truedxf:

1. **layer-states.dxf**: one line per layer: on, off (−62), frozen, locked, 290=0, Defpoints with
   290=1 *and* 290=0, true-color layer with a misleading 62, layer with 70 % transparency (with and
   without "plot transparency"). Expect: off/frozen/noplot/Defpoints missing, locked present.
2. **block-layer-inherit.dxf**: block with entities on `0` (BYLAYER) and on `Red`. Four INSERTs
   on a layer that is on / off / frozen / plot=0, plus a 2-level nesting (outer INSERT on L1,
   inner INSERT on 0). Settles the ezdxf conflict.
3. **vp-layer-overrides.dxf**: two paper-space viewports showing the same model; the layer has VP
   color/linetype/lineweight/alpha overrides for viewport A only.
4. **dimstyle-sparse.dxf**: hand-written DIMSTYLE with *only* `2 X / 70 0` and a DIMENSION using it
   *without* a `*D` block (force regeneration), in a drawing with `$MEASUREMENT 1`. Is the arrow
   size 0.18 or 2.5? Also round-trip: open in AutoCAD, save, and diff the DIMSTYLE tags.
5. **dimstyle-70-twice.dxf**: DIMSTYLE with `70 0 … 69 2 70 1` (DIMTFILL=2, DIMTFILLCLR=red).
   Expect a red text background in the plot.
6. **ltype-complex.dxf**: GAS_LINE (text, U=), BATTING/ZIGZAG (shapes with `50 180`), plus variants
   `74 3` (absolute rotation) and text with a style that has a fixed height ≠ 0. Pins the 50 unit,
   the 74 bits and the text height rule.
7. **ltype-missing.dxf**: an entity with an undefined linetype. Confirm that AutoCAD refuses or
   repairs it (it documents our fallback).
8. **layer-missing.dxf**: entities on an undefined layer `Kanten`. Confirm AutoCAD creates it
   with color 7/Continuous.
9. **case-names.dxf**: layer `Wand` defined, entities on `WAND`, `wand`, and on `Ä`/`ä`
   variants; linetype `continuous`; style `STANDARD`.
10. **sortents.dxf**: three overlapping solid hatches in creation order A, B, C with SORTENTS
    sort handles making the order C, A, B, one with sort handle `0`. Also the same inside a block
    whose sort handles are *not* entity handles. And a variant with `$SORTENTS 0`.
11. **wipeout-frame.dxf**: WIPEOUT with WIPEOUTVARIABLES 70 = 0/1/2 (three files) and
    conflicting `WIPEOUTFRAME` DICTIONARYVAR values; likewise RASTERVARIABLES 70 for an IMAGE
    border and `$XCLIPFRAME` 0/1/2 for a clipped INSERT.
12. **vport-view.dxf**: model-space plot with plot type "Display": *ACTIVE center (100,50),
    height 40, aspect 2, twist 30°. Check that the plot window matches. Repeat with
    direction ≠ Z.
13. **r12-export.dxf**: save test 1 and test 6 as R12 from AutoCAD and plot both. Documents
    the TTF → txt and complex → simple degradation, so we don't "fix" it.
14. **mlinestyle.dxf**: MLINESTYLE with 3 elements (unsorted offsets, colors 1/BYBLOCK/BYLAYER,
    linetypes), fill on with a true-color fill, caps square/inner arc/round, start angle 45°.
15. **insert-units.dxf**: an inch block inserted into an mm drawing via AutoCAD INSERT. Inspect
    INSERT 41/42/43 and BLOCK_RECORD 70 to confirm that the renderer can ignore 70.
16. **dynblock.dxf**: dynamic block with a visibility state and stretched parameters. Check that
    the `*U` block alone reproduces the plot.
17. **annotative-scale.dxf**: annotative text with two scales (1:1, 1:2), CANNOSCALE = 1:2 in
    the model-space plot, and two paper viewports with different annotation scales.
