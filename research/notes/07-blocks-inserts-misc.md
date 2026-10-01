# 07 — Blocks, INSERT, attributes, dynamic blocks, XREF, clipping, raster/underlay/OLE, MLINE, TABLE, proxy graphics

Scope: everything a renderer needs to reproduce AutoCAD PLOT output for block references and the
"miscellaneous" entities that are either block-like (ACAD_TABLE, dynamic blocks, XREFs),
image-like (IMAGE, WIPEOUT, UNDERLAY, OLE2FRAME), composite (MLINE) or opaque
(ACAD_PROXY_ENTITY + proxy graphics on unknown entities).

Source abbreviations used below:

- `spec` = `research/spec/autocad_2012_dxf_reference.txt` (line numbers of the text dump, `spec:L4767`)
- `oda` = `research/spec/OpenDesign_Specification_for_.dwg_files.txt` (line numbers)
- `ezdxf:` = `research/repos/ezdxf/src/ezdxf/...` unless the path starts with `docs/` or `notes/`
- `ezdxf-notes:` = `research/repos/ezdxf/notes/pages/*.md` (mozman's logseq knowledge graph; experiments in BricsCAD/TrueView)
- `acadsharp:` = `research/repos/ACadSharp/...`; `netdxf:` = `research/repos/netDxf/netDxf/...`
- `mlightcad:` = `research/repos/mlightcad-realdwg-web/packages/data-model/src/...`
- `dxf-viewer:` = `research/repos/dxf-viewer/src/...`
- `librecad:` = `research/repos/LibreCAD/librecad/src/...` (GPL, facts only)
- `libredwg:` = `research/repos/libredwg/src/...` (GPL, facts only)
- `ixmilia:` = `research/repos/ixmilia-dxf-rs/...`
- `ezdxf#N`, `acadsharp#N`, `mlightcad-viewer#N`, `librecad-pr#N`, … = dumped threads under
  `research/github/raw/<owner>__<repo>/threads/{issue,pr,discussion}-NNNNN.md`
- `web:` = Autodesk/Bricsys help pages found via web search (URLs given inline)

---------------------------------------------------------------------------------------------------

## 0. TL;DR for the renderer

1. A block reference is rendered by drawing the **block definition's entities in block coordinates**
   under a **4×4 affine matrix** `M = OCS(extrusion)·T(insert)·Rz(rotation)·S(sx,sy,sz)·T(−base)`.
   Apply `M` to the *final* tessellated geometry (curves, glyph outlines, hatch lines, linetype
   dashes) instead of trying to rewrite entities (ezdxf-style "virtual entities" are lossy under
   non-uniform scaling — see §16).
2. Property resolution is a **stack**: layer "0" → parent INSERT's (resolved) layer; BYBLOCK
   color/linetype/lineweight/transparency → parent INSERT's resolved value; at top level BYBLOCK
   → ACI 7 / CONTINUOUS / LWDEFAULT / opaque.
3. Visibility: INSERT's layer **OFF** hides only its layer-0 (and BYLAYER-inherited) content;
   INSERT's layer **FROZEN** hides the entire reference incl. everything nested
   (**VERIFIED-BY-ACAD** via Autodesk forum consensus, see §3; **CONFLICT** with ezdxf).
   Entity invisibility flag 60 must be honored inside blocks — dynamic blocks depend on it (§5).
4. ATTRIBs are separate WCS/OCS entities attached to the INSERT; draw them **after** the block
   content, **not** transformed by `M`, but with the INSERT as property parent (§4).
   Non-constant ATTDEFs in a block are not drawn; constant ATTDEFs are (§4, **CONFLICT** with ezdxf).
5. Dynamic blocks: just render the block named by INSERT group 2 (usually `*U###`), honoring
   group 60. Never evaluate parameters (§5).
6. XREF blocks are empty in the DXF; AutoCAD draws the external DWG, or the saved path as text if
   missing (§6). XCLIP (SPATIAL_FILTER) clips the reference in block coordinates (§7).
7. IMAGE/WIPEOUT share pixel-space clip boundaries with a −0.5 offset and a flipped y axis (§8, §9).
8. MLINE vertex data already contain the final geometry (miter vectors + per-element offsets +
   break parameters); rendering is purely mechanical (§12).
9. ACAD_TABLE = INSERT of its `*T` anonymous block (§13).
10. Unknown entities / ACAD_PROXY_ENTITY: decode proxy graphics (§15).

---------------------------------------------------------------------------------------------------

## 1. BLOCK / ENDBLK / BLOCK_RECORD

### 1.1 Structure

- BLOCKS section: `BLOCK … entities … ENDBLK` pairs, never nested (spec:L2886ff). A block may
  contain INSERTs of other blocks.
- R13+: every BLOCK has a BLOCK_RECORD in the BLOCK_RECORD table. The BLOCK_RECORD (not the
  BLOCK entity) is the **owner** (330) of the BLOCK, ENDBLK and all entities in the definition
  (ezdxf:docs/source/dxfinternals/block_management.rst, `entities/blockrecord.py:93`).
- Link BLOCK ↔ BLOCK_RECORD: by owner handle (BLOCK 330 → BLOCK_RECORD 5) and by name (BLOCK 2 ==
  BLOCK_RECORD 2, case-insensitive). The INSERT references the block **by name** (group 2) only.
- Layouts are blocks too: `*Model_Space`, `*Paper_Space`, `*Paper_Space0…N` (spec:L2975ff). The
  entities of model space and the *active* paper space live in the ENTITIES section, the other
  paper spaces' entities inside their BLOCK definitions (block_management.rst).
- Block names are case-insensitive. Two BLOCKs with the same name: AutoCAD merges them (name of
  the first, base point of the second, entities of both) — ezdxf experiment
  (block_management.rst "Block Names"). truedxf merges them the same way and logs
  `duplicate-block` (UNVERIFIED, Q-0608; corpus: 7 files, e.g. LibreCAD#941 valentina_sock.dxf).
- BLOCK group 3 is a duplicate of the name; ignore. Group 4 = description (R2000+).
- DXF R12: no BLOCK_RECORD table; model/paper space block names are `$MODEL_SPACE`/`$PAPER_SPACE`
  (ezdxf maps them, `entities/block.py:129-136`).

### 1.2 BLOCK group codes (spec:L2910-2975, ezdxf:entities/block.py:53-77)

| code | meaning |
|---|---|
| 8 | layer of the BLOCK entity (irrelevant for rendering; ENDBLK must match) |
| 2 | block name |
| 70 | block-type flags (below) |
| 10/20/30 | base point (block coordinates) |
| 3 | block name again |
| 1 | xref path (empty string for normal blocks) |
| 4 | description (optional) |

**Block flags (70 in BLOCK, NOT in BLOCK_RECORD)**:

| bit | meaning | renderer relevance |
|---|---|---|
| 1 | anonymous block (hatch/dim/table/dyn-block representation/application) | none directly (name tells family) |
| 2 | has non-constant ATTDEFs | none (informational) |
| 4 | xref | content comes from external file (§6) |
| 8 | xref overlay | nested overlays are not loaded when the host is itself an xref (§6) |
| 16 | externally dependent (e.g. nested xref block, xref-dependent symbol) | block content lives in external file |
| 32 | resolved xref / dependent of xref ("ignored on input") | informational |
| 64 | referenced xref ("ignored on input") | informational |

ACadSharp notes "This seems to be the right way to set the flags for the block records":
the flags property of its BlockRecord forwards to the BLOCK entity
(acadsharp:src/ACadSharp/Tables/BlockRecord.cs:142-143). In **DWG** the flags are stored on the
block record; in **DXF** the BLOCK_RECORD's 70 is *insertion units* (R2007+).

### 1.3 BLOCK_RECORD group codes (spec:L2016-2050, ezdxf:entities/blockrecord.py:39-90)

| code | meaning |
|---|---|
| 2 | name |
| 340 | handle of the LAYOUT object (0 for normal blocks) |
| 70 | **block insertion units** (0..20, same enum as $INSUNITS) — R2007+ |
| 280 | explodable (1) / not (0) — edit-time only |
| 281 | scale uniformly (1) / non-uniformly allowed (0) — edit-time only |
| 310 | preview bitmap (binary chunks) — ignore |
| 102 {BLKREFS / 331… } | optional back-pointers to INSERTs referencing this block |
| xdata ACAD "DesignCenter Data": 1070 version, 1070 insert units | pre-R2007 place of the units |

Dynamic-block xdata on block records (§5): `AcDbDynamicBlockTrueName`, `AcDbDynamicBlockGUID`,
`AcDbBlockRepETag` (definition), `AcDbBlockRepBTag` + 1005 handle (anonymous representation).

### 1.4 Base point

- The base point (BLOCK 10) is **not** baked into the entity coordinates: the entities stay in raw
  block coordinates and the INSERT transform subtracts the base point before scaling/rotation
  (ezdxf:entities/insert.py:507-536, mlightcad:entity/AcDbBlockReference.ts `blockTransform`
  "Step 1", dxf-viewer:DxfScene.js `GetInsertionTransform` `makeTranslation(-origin)`).
- **CONFLICT (wording)**: spec:L2965 says "The new origin for these entities is shifted to match
  the base point… All entity data is translated to fit this new WCS." This describes what the
  BLOCK *command* does when capturing entities (UCS → block coords); it does **not** mean readers
  should shift entities. All libraries subtract the base point at insert time.

### 1.5 Block units and INSUNITS — no render-time scaling

- **Fact (verified in an AutoCAD-written file)**: AutoCAD bakes the unit conversion into the INSERT
  scale factors at insertion time. In `acadsharp:samples/dynamic-blocks/BLOCKVISIBILITYPARAMETER.dxf`
  the drawing has `$INSUNITS=1` (inch), the block record `block_visibility_parameter` has `70=4`
  (mm), and all four INSERTs have `41=42=43=0.0393700787401575` (= 1/25.4).
- Therefore a renderer must **not** apply any units scaling itself; BLOCK_RECORD 70 is metadata
  for DesignCenter/INSERT command. Same for XREF attach (the xref's units → INSERT scale). ezdxf
  does not scale either (`addons/drawing/properties.py` uses units only as metadata).
- `$INSUNITSDEFSOURCE` / `$INSUNITSDEFTARGET` (header) only matter for insertion of unitless
  content — edit-time only.

### 1.6 Anonymous block name families

Anonymous = name starts with `*` (and flag 1 set). Families (ezdxf:sections/blocks.py:64-71,
spec:L6692, ezdxf-docs `tasks/add_layouts.rst`):

| prefix | producer | referenced by | render? |
|---|---|---|---|
| `*Model_Space`, `*Paper_Space[N]` | layouts | LAYOUT | layout content, not via INSERT |
| `*U###` | generic anonymous blocks: dynamic block representations (§5), application blocks (e.g. ezdxf `add_auto_blockref`), MLEADER/other internal uses | explicit INSERT | via INSERT only |
| `*D###` | DIMENSION graphics (associative dimension block) | DIMENSION group 2, no INSERT | via DIMENSION (see dimension note) |
| `*X###` | legacy associative HATCH graphics | — | normally not referenced; don't render standalone |
| `*T###` | ACAD_TABLE graphics (spec:L6692 "an anonymous block begins with a *T value") | ACAD_TABLE group 2 | via ACAD_TABLE (§13) |
| `*E###` | "anonymous non-uniformly scaled block" per ezdxf comment — **UNKNOWN** who creates these; treat like `*U` | INSERT | via INSERT |
| `*A###` | **not a block family**: unnamed GROUP names in ACAD_GROUP dictionary (ezdxf:entities/dxfgroups.py:376). ACadSharp uses `*A` as prefix for its *own* anonymous blocks (acadsharp:Tables/BlockRecord.cs:310) | — | — |

Rules for the renderer: never render a block definition by itself; only render what is reached
from a layout via INSERT/DIMENSION/ACAD_TABLE/etc. Anonymous block names are **not stable** across
AutoCAD sessions (AutoCAD renumbers on load; ezdxf `xref.py:1428` renames `*D01` → `*D0815` when
copying) — never key caches on anonymous names across files.

### 1.7 Recursion / self reference

- Cyclic definitions (A contains INSERT A, or A→B→A) are invalid; "CAD applications will not load
  the DXF file at all or maybe just crash" (block_management.rst). ezdxf audit has a
  `BlockCycleDetector` (ezdxf:audit.py:504-535). dxf-viewer tracks the expansion path and skips a
  recursive INSERT with a warning (dxf-viewer:DxfScene.js `IsRecursiveReference`).
- **Implementation**: keep the stack of block names being expanded; skip an INSERT whose block is
  already on the stack (log). Also cap depth (e.g. 64) as a safety net. **UNKNOWN**: whether
  AutoCAD's recover path draws the non-cyclic parts; irrelevant for valid files.

---------------------------------------------------------------------------------------------------

## 2. INSERT and MINSERT

### 2.1 Group codes (spec:L4760-4810, ezdxf:entities/insert.py:86-143)

| code | meaning | default |
|---|---|---|
| 100 | `AcDbBlockReference`; MINSERT uses `AcDbMInsertBlock` (ezdxf comment insert.py:85) | |
| 66 | attributes-follow flag; 1 → ATTRIB… SEQEND follow | 0 |
| 2 | block name | required |
| 10/20/30 | insertion point **in OCS** | required |
| 41/42/43 | x/y/z scale | 1 (0 is invalid; ezdxf fixes to 1) |
| 50 | rotation in degrees, about OCS z | 0 |
| 70/71 | column count / row count (MINSERT) | 1 |
| 44/45 | column spacing / row spacing (MINSERT) | 0 |
| 210 | extrusion | (0,0,1) |
| 38 | elevation (R11 legacy; move into z of 10) | |

- Attributes: `66=1` then `ATTRIB` entities then `SEQEND`. Don't trust 66 alone — ezdxf treats the
  presence of ATTRIBs as the truth (`attribs_follow` property, insert.py:186-188) and notes that a
  SEQEND can be missing (insert.py:150-160).
- Zero scale: validators force 1 (ezdxf, LibreCAD `usableScale`, librecad-pr#2756 — "Every consumer
  surveyed draws its line at exactly zero"; ACadSharp throws on 0). **UNKNOWN** what AutoCAD does
  with a 0 scale in a DXF (probably rejects or repairs on AUDIT).
  **VERIFIED-BY-ACAD** (AutoCAD 2027 PLOT, 2026-09-30; `blocks/zero-scale-x`, `-y`, `-z`, Q-0613): the file
  loads and a zero 41/42/43 plots as scale **1** (the block content at full size, rotated as given).

### 2.2 Exact transform

From ezdxf:entities/insert.py:507-536 (consistent with mlightcad `blockTransform`, LibreCAD
`LC_InsertTransform::fromInsert`, dxf-viewer `GetInsertionTransform`):

```
ocs      = OCS(extrusion)                   // arbitrary axis algorithm, see OCS note
ux, uy   = ocs.to_wcs(X), ocs.to_wcs(Y); uz = extrusion (normalized)
Mlin     = [ux*sx, uy*sy, uz*sz] · Rz_about_extrusion(rotation)
         = OCS_rot · Rz(rotation) · S(sx, sy, sz)          (column-vector form)
t        = ocs.to_wcs(insert) − Mlin · base_point
M        = [Mlin | t]
p_wcs    = M · p_block
```

i.e. `M = OCS · T(insert_ocs) · Rz(rot) · S(sx,sy,sz) · T(−base)`.

- Rotation is always about the **OCS z axis** (= extrusion), applied after scaling.
- The insertion point is OCS; convert with the arbitrary axis algorithm.
- Negative scale factors are legal and simply mirror (det < 0). Typical AutoCAD MIRROR of a block
  → `sx=−1` plus rotation, or extrusion `(0,0,−1)` — both occur in the wild
  (ezdxf#380: `sx=-1; rotation=90`, "Ezdxf applies the scaling factor and the rotation angle in the
  same way as BricsCAD"). dxf-viewer only handles extrusion z<0 by mirroring X
  (DxfScene.js `GetInsertionTransform`) — a good sanity check: OCS(0,0,−1) maps x → −x, y → y.
- **Renderer pitfall (mirrored inserts)**: det(M)<0 reverses polygon winding. GPU backends with
  back-face culling lose fills (mlightcad-viewer#206 fixed invisible fills of `sx=-1` and
  `sz=-0.625` inserts). Also: arcs keep their direction relative to the transformed geometry if you
  transform points; if you transform *parameters* (center/radius/angles) you must swap/negate
  angles.
- Nested inserts: `M_total = M_parent · M_child`. A rotated child inside a non-uniformly scaled
  parent yields a **sheared** matrix that no INSERT can represent (ezdxf raises
  `InsertTransformationError` and then explodes recursively, explode.py `transform()`); with a
  matrix-based renderer this just works.

### 2.3 MINSERT (multi-insert)

- `mcount = (row_count if row_spacing else 1) · (col_count if col_spacing else 1)` —
  ezdxf ignores the count along an axis whose spacing is 0 and deduplicates identical offsets
  (insert.py:659-702). AutoCAD with spacing 0 would draw N coincident copies — visually identical
  for opaque output, but **not** for transparency/XOR-like effects. **ASSUMPTION**: dedupe is fine.
- Offset of cell (row, col): `o = (col·44, row·45)` in the **OCS**, **rotated by the INSERT
  rotation**, **not scaled** by 41/42 and independent of the base point:
  `insert_cell = insert + Rz(rotation)·o` (ezdxf insert.py:686-702 "Do not apply scaling to the
  grid!"; LibreCAD `mapArrayOffset` rotates but does not scale,
  librecad:lib/engine/document/entities/lc_insert_transform.cpp:236-241).
- **CONFLICT**: mlightcad applies the offset in block-local space *before* the scale
  (`blockTransform · translate(col*colSpacing,row*rowSpacing)`, mlightcad:entity/AcDbBlockReference.ts
  `subWorldDraw`), which scales the spacing and makes it relative to the base point. ezdxf and
  LibreCAD agree on "unscaled"; the ObjectARX docs describe spacing "in drawing units".
  **UNKNOWN / needs AutoCAD test** (MINSERT with sx=2, spacing 10).
- ATTRIBs of a MINSERT: ezdxf copies them to every cell with the cell offset
  (insert.py:673-675, frontend draws each virtual insert with its attribs); mlightcad draws them
  only on cell (0,0). **CONFLICT / UNKNOWN** — needs AutoCAD test.
- XCLIP on a MINSERT: **UNKNOWN** (AutoCAD's XCLIP refuses MINSERT? — test).
- **VERIFIED-BY-ACAD** (AutoCAD 2027 PLOT, 2026-09-30; `blocks/minsert-*`): the cell offsets are rotated with
  the INSERT but not scaled (ezdxf/LibreCAD rule); all six MINSERT cases match at F1(r=1) ≥ 0.999 (residual pixels
  are circle tessellation).

### 2.4 Non-uniform scaling — what AutoCAD shows

AutoCAD regenerates block content by pushing the block transform onto the graphics system and
letting each entity `worldDraw()` in block coordinates (the proxy-graphic format itself shows this
model: `PUSH_MODELXFORM` / `POP_MODELXFORM`, oda:L14940ff). Consequences (mostly **ASSUMPTION**,
consistent with how AutoCAD EXPLODE behaves and with the matrix model):

| entity inside block | under non-uniform scale / shear |
|---|---|
| CIRCLE/ARC | ellipse / elliptical arc (EXPLODE produces ELLIPSE; ezdxf converts via `Ellipse.from_arc`, explode.py) |
| LWPOLYLINE/POLYLINE bulges | elliptical segments; widths are geometry → stretched anisotropically |
| TEXT/MTEXT/ATTDEF(const) | glyphs affinely distorted (stretched/sheared) — ezdxf warns its virtual entities are wrong here (insert.py:614-617) |
| HATCH | boundary transformed; **pattern lines are computed in block space and then transformed** (so pattern spacing/angles distort). **UNKNOWN / needs AutoCAD test** |
| linetype dashes | **ASSUMPTION**: generated in block space along the untransformed curve, then transformed → dash lengths scale with the insert scale and stretch with direction. Needs test (and interplay with PSLTSCALE/CELTSCALE, see linetype note) |
| lineweight | never scaled (plot pen width) |
| POINT (PDMODE glyphs) | **UNKNOWN**: PDSIZE-based point glyphs are view/absolute sized, probably not distorted |
| nested INSERT | composed matrix (possibly shear) |

### 2.5 MIRRTEXT

- `$MIRRTEXT` (0 default) is an **edit-time** variable: it controls whether the MIRROR command
  mirrors TEXT/MTEXT/ATTDEF/ATTRIB; "it only mirrors texts on creation" (gdal#6018, tested in
  AutoCAD). Autodesk docs: text and constant attributes that are part of an inserted block are
  mirrored when the block is mirrored, regardless of MIRRTEXT.
- Renderer: **ignore MIRRTEXT**. Mirrored block content is mirrored by `M`; ATTRIBs carry their own
  orientation (the editor already applied MIRRTEXT when it updated them).

---------------------------------------------------------------------------------------------------

## 3. Property inheritance and visibility inside blocks

### 3.1 Resolution rules

Resolution keeps a stack of "current block reference properties" (the INSERT's *resolved*
properties). ezdxf implementation: `addons/drawing/properties.py:613-890`
(`push_state`/`pop_state`, `resolve_layer`, `resolve_color`, `resolve_linetype`,
`resolve_lineweight`, `_entity_alpha_str`); frontend pushes the INSERT's resolved properties
before drawing its content (`frontend.py:918-926`).

| property | value in block entity | resolves to |
|---|---|---|
| layer | "0" | parent INSERT's resolved layer (recursively: a layer-0 INSERT inside a block itself takes its parent's layer) |
| layer | other | itself |
| color | BYLAYER (256) | color of the *resolved* layer (so layer-0 entity → INSERT's layer color) |
| color | BYBLOCK (0) | parent INSERT's resolved color (incl. true color); top level: ACI 7 (white/black by background) |
| linetype | BYLAYER | resolved layer's linetype |
| linetype | BYBLOCK | parent INSERT's resolved linetype; top level: CONTINUOUS |
| lineweight | −1 BYLAYER / −2 BYBLOCK / −3 DEFAULT | analog; top-level BYBLOCK → LWDEFAULT |
| transparency | missing = BYLAYER; 0x01000000 = BYBLOCK | analog; top-level BYBLOCK → opaque |
| plot style (named) | BYLAYER/BYBLOCK | analog (see plot style note) |
| true color (420) | present | always overrides ACI (ezdxf `resolve_color`) |

Sources: ezdxf "Notes on Rendering DXF Content" (ezdxf:docs/source/dxfinternals/rendering_of_dxf_content.rst,
ezdxf-notes "Notes on Rendering DXF Content.md": "If a block insert is placed on layer 'A', and the
block contains an entity on layer '0' with BYLAYER color: the entity will be drawn with the color of
layer 'A', it seems that layer '0' is the only special case"; "BYBLOCK color… outside a block: …
white in the modelspace and black in the paperspace"). dxf-viewer: "BY_BLOCK is not useful when not
in block. As reported by users, AutoCAD uses white color in such case"
(dxf-viewer:DxfScene.js `_GetEntityColor`).

Notes:
- The layer-0 substitution happens **before** BYLAYER resolution, i.e. the *entity* is treated as if
  on the INSERT's layer for color, linetype, lineweight, transparency, plot style **and visibility**.
- BYBLOCK is resolved against the parent INSERT's already-resolved value — an INSERT with
  BYLAYER color gives its BYBLOCK children the INSERT layer's color.
- The INSERT's own ltscale (48) does **not** multiply into child linetype scales in ezdxf
  (`resolve_linetype_scale` uses only entity ltscale × global). **UNKNOWN** whether AutoCAD combines
  INSERT 48 with children (probably not; linetype scale is per-entity). Needs test.
- Attributes: ezdxf draws the INSERT's ATTRIBs inside the pushed state → layer-0 ATTRIB takes the
  INSERT's layer, BYBLOCK ATTRIB takes the INSERT's color (`frontend.py:915-917` inside
  `push_state`). **ASSUMPTION** (plausible, AutoCAD attributes follow the block ref).

### 3.2 Visibility (layer OFF vs FROZEN)

- ezdxf/"Notes on Rendering": "For entities inside a block, the visibility of the layer that the block
  is inserted does not affect the visibility of the entity *unless* the entity was created on layer 0"
  — scenario: A on layer 0, B on layer 1, INSERT on layer 2 → B visible iff layer 1 visible, A visible
  iff layer 2 visible. ezdxf `resolve_visible()` for INSERT: "depends only on the invisible flag,
  the layer state has no effect!" (properties.py:657-660).
- **CONFLICT**: this is only true for layer **OFF**. For **FROZEN** the whole block reference
  disappears: "If the pieces in a block are drawn on a different layer … then they will show even though
  the block's layer is turned off. But if you freeze that layer instead of turning it off, those nested
  objects will disappear." (web: Autodesk forum / cadtutor threads, e.g.
  https://www.cadtutor.net/forum/topic/7688-blocks-wont-show-on-layer/ ,
  https://forums.autodesk.com/t5/autocad-forum/layer-showing-inaccuratley/td-p/13740258 ). ezdxf's
  `LayerProperties.is_visible = layer.is_on() and not layer.is_frozen()` merges both states and
  therefore gets this wrong. dxf-viewer filters frozen layers at every level (`_FilterEntity`
  skips entities on frozen layers except layer "0", which is resolved later) — closer to AutoCAD.
- Rules for truedxf:
  1. INSERT (any nesting level) whose **own** (resolved) layer is frozen (globally, or VP-frozen in
     the current viewport — **ASSUMPTION** VP freeze behaves like global freeze), or has group 60 = 1
     → skip the reference **and its ATTRIBs**.
  2. INSERT whose resolved layer is OFF → still traverse; children on layer 0 (→ resolved to that
     layer) are hidden, children on other layers are shown; ATTRIBs on the INSERT's layer (or layer 0)
     hidden, on other layers shown (**ASSUMPTION** for ATTRIBs, consistent with konradmalik's
     observations in ezdxf#504: "Attribs can be … visible even when the parent insert is not").
  3. Each child: hidden if its resolved layer is OFF or FROZEN, or its 60 flag is set.
  4. Layer PLOT flag (290=0) excludes from PLOT output with the same resolution (ezdxf
     `properties.py:522-524` does `is_visible &= layer.dxf.plot` when plotting).
- **VERIFIED-BY-ACAD** (AutoCAD 2027 PLOT, 2026-09-30; `blocks/vis-*`, Q-0280, Q-0281, Q-0282, Q-0246):
  - rules 1–3 hold: a frozen INSERT layer hides the whole reference (`vis-insert-layer-frozen`), an off one only
    the layer-0 (inheriting) content (`vis-insert-layer-off`), an invisible INSERT hides everything
    (`vis-invisible-flag`).
  - rule 4 is **wrong**: a **no-plot** (290 = 0) INSERT layer suppresses the **whole block content**, also children
    on other, plottable layers (`vis-insert-layer-noplot` plots only the reference cross). Layer 0 being
    no-plot suppresses everything of a block inserted on layer 0 (`vis-layer0-noplot`, right) but nothing of the
    same block inserted on another layer (left).
  - Layer 0's own off/frozen state does not affect layer-0 content of blocks inserted on other layers (it takes
    the INSERT's layer; `vis-layer0-off`, `vis-layer0-frozen`).
  - truedxf: model `resolve.ts` `contentPlottable` (Defpoints INSERT layers are assumed to behave like no-plot,
    UNVERIFIED).
- Unresolved xrefs (`blocks/xref-missing-attach`, `-overlay`, Q-0626): PLOT draws a placeholder TEXT
  "Xref <path>" (e.g. `Xref C:\nope\x.dwg`) at the insertion point, rotated with the INSERT; its style/height are
  still to be measured (truedxf draws nothing yet).
- Draw order: an INSERT is one unit in the layout draw order; contents of two INSERTs never
  interleave (ezdxf "Notes on Rendering"). Inside the block the block's own order applies
  (entity order, or the block record's `ACAD_SORTENTS` table in its extension dictionary; ezdxf
  `virtual_entities(redraw_order=True)`, frontend has a "TODO: redraw_order=True?").
  ATTRIBs are drawn **after** all block content (ezdxf#1321, verified against TrueView and NanoCAD:
  text attrib under a hatch was wrong until ezdxf moved attrib drawing after the block content).

---------------------------------------------------------------------------------------------------

## 4. ATTDEF and ATTRIB

### 4.1 ATTDEF

- Lives in the block definition, owned by the BLOCK_RECORD (insert.py:174-176). Same data as TEXT
  plus tag (2), prompt (3), flags (70), field length (73), valign (74 — stored in the attribute
  subclass, not the 2nd text subclass!), lock position (280), attribute type (71, R2018: 1 single
  line, 2 multiline ATTRIB, 4 multiline ATTDEF) (ezdxf:entities/attrib.py:60-140).
- Flags 70: 1 invisible, 2 constant, 4 verify, 8 preset.
- Rendering rules:
  - **ATTDEF in model/paper space** (not in a block): drawn showing its **tag** (2), not the default
    value — verified in BricsCAD and TrueView (ezdxf attrib.py:60-70 comment; disassemble.py:297-298).
  - **Non-constant ATTDEF inside a block, reached through an INSERT: not drawn** (ezdxf skips all
    ATTDEFs in `virtual_block_reference_entities`, explode.py "Do not explode ATTDEF entities";
    TrueView "does not render the ATTDEF as block content for the INSERT entity", attrib.py:62-64).
  - **Constant ATTDEF (flag 2) inside a block: drawn as part of the block, showing its default value
    (group 1), like a TEXT** — Autodesk .NET docs: "Constant attributes are stored as
    AttributeDefinitions in the BlockTableRecord and are not stored with the BlockReference…
    There is no AttributeReference created… Constant AttributeDefinition defined in a BlockTableRecord
    acts the same as a Text entity" (web: https://help.autodesk.com/cloudhelp/2016/ENU/AutoCAD-NET/files/GUID-BA69D85A-2AED-43C2-B5B7-73022B5F28F8.htm).
    **CONFLICT**: ezdxf drops constant ATTDEFs too (bug). Honor the invisible flag (1) and $ATTMODE
    for constant ATTDEFs as well (**ASSUMPTION**). Needs AutoCAD test.
- ATTDEF with embedded MTEXT (multi-line, R2008+): an `Embedded Object` (101) section after the
  attribute subclass carries MTEXT data; render as MTEXT when present (ezdxf attrib.py:210-240,
  `has_embedded_mtext_entity`, ezdxf#258).

### 4.2 ATTRIB

- Follows the INSERT (66=1) until SEQEND; owned by the INSERT (330 → INSERT handle).
- Geometry is **already in the INSERT's target coordinate system** (OCS of its own extrusion,
  placed by the editor at insert/update time). **Do not transform ATTRIBs with M** — "Block
  reference attributes are located __outside__ the block reference!" (frontend.py:916), "Attached
  ATTRIB entities are already located in the WCS" (explode.py). ATTRIBs cannot represent a
  non-uniform scale; AutoCAD approximates with width factor/oblique (ezdxf tutorials/blocks.rst:55-75).
- Visible iff: not ATTRIB flag 1 (invisible) … modulated by `$ATTMODE` (0 = all attributes hidden,
  1 = normal — respect flag 1, 2 = all shown incl. invisible) (ixmilia:spec/HeaderVariablesSpec.xml
  `ATTMODE` default Normal). ezdxf only checks flag 1 and ignores $ATTMODE — **CONFLICT (gap)**.
- Also the INSERT visibility (§3.2) and the ATTRIB's own resolved layer/60 flag.
- ATTRIB anchor/alignment: like TEXT (see text note). The ezdxf finding "the anchor of TEXT and
  ATTRIB is always the left-baseline (10) regardless of alignment; 11 is for re-adjusting on edit"
  (rendering_of_dxf_content.rst) applies.
- ATTRIB text may contain formatting codes (rendering_of_dxf_content.rst "Attrib entities can have
  formatting commands in them"); multiline ATTRIBs carry embedded MTEXT (71=2 + 101 section).
- Explode semantics (BURST): ATTRIB → TEXT with same geometry (explode.py `attrib_to_text`).
  Invisible ATTRIBs become visible after ezdxf explode (ezdxf#504) — irrelevant for rendering.
- `lock_position` (280) is an editing flag for dynamic blocks; ignore.
- Draw after block content (§3.2).

---------------------------------------------------------------------------------------------------

## 5. Dynamic blocks

### 5.1 Storage (from `acadsharp:samples/dynamic-blocks/*.dxf`, AC1032 written by AutoCAD)

"AcDbDynamicBlockReference" is an ObjectARX/.NET wrapper class, **not** a stored entity type.
In the file a dynamic block reference is an ordinary INSERT.

**Definition** (e.g. BLOCK_RECORD `block_visibility_parameter`, handle 24F):
- BLOCK_RECORD xdata: `1001 AcDbDynamicBlockTrueName / 1000 <name>`,
  `1001 AcDbDynamicBlockGUID / 1000 {GUID}`, `1001 AcDbBlockRepETag / 1070 1 / 1071 5`.
  ezdxf detects a dynamic definition by `AcDbDynamicBlockGUID` (ezdxf:dynblkhelper.py:55-57).
- BLOCK_RECORD extension dictionary → `ACAD_ENHANCEDBLOCK` → `ACAD_EVALUATION_GRAPH` (nodes →
  parameter/action/grip objects: `BLOCKVISIBILITYPARAMETER`, `BLOCKVISIBILITYGRIP`,
  `BLOCKGRIPLOCATIONCOMPONENT`, `BLOCKLINEARPARAMETER`, `BLOCKFLIPPARAMETER`, …) and
  `AcDbDynamicBlockRoundTripPurgePreventer` → `ACDB_DYNAMICBLOCKPURGEPREVENTER_VERSION`.
  ACadSharp: `EvaluationGraph` = `XDictionary["ACAD_ENHANCEDBLOCK"]`, `IsDynamic` "Doesn't seem to be
  reliable" (acadsharp:Tables/BlockRecord.cs:117-192).
- Entities of the definition carry xdata `AcDbBlockRepETag / 1070 1 / 1071 <n> / 1005 <own handle>`.
- `BLOCKVISIBILITYPARAMETER` lists all controlled entities (331…) and per state (303 name,
  94 count, 332 handles of *visible* entities) (handle 33B in the sample).
- The **definition itself stores the default state's visibility in group 60** of its entities
  (e.g. LWPOLYLINE 337 has `60:1`).

**Representation** (anonymous `*U###` block per modified instance):
- BLOCK 70 = 1 (anonymous); BLOCK_RECORD xdata `1001 AcDbBlockRepBTag / 1070 1 / 1005 <handle of
  definition BLOCK_RECORD>` (ezdxf dynblkhelper.py:60-70, acadsharp `Source` property
  BlockRecord.cs:266-285).
- It contains a **full copy of all definition entities**, with the current state's hidden ones
  marked `60:1` (sample: `*U16` … `*U19` each have 5 entities, different subsets flagged 60:1). Flip,
  rotation, stretch, lookup parameters are likewise baked into the copied geometry
  (BLOCKFLIPPARAMETER / BLOCKROTATIONPARAMETER samples: the INSERTs have plain scale/rotation;
  the *U geometry differs).
- **INSERT** of a modified instance: group 2 = `*U###`, extension dictionary →
  `AcDbBlockRepresentation` → DICTIONARY { `AcDbRepData` → `ACDB_BLOCKREPRESENTATION_DATA`
  (70 version, **340 → definition BLOCK_RECORD**), `AppDataCache` → { `ACAD_ENHANCEDBLOCKDATA` →
  per-parameter XRECORDs, e.g. `1:VisibilityState0` } }.
- An **unmodified** instance references the definition block directly by its real name
  (BLOCKALIGNMENTPARAMETER / LINEARPARAMETER / POINTPARAMETER samples: first INSERT has
  `2:ALIGNMENT_PARAMETER`, no xdict).

### 5.2 What the renderer must do

- Render the block named in INSERT group 2 — nothing else. **Honor group 60** on block entities
  (this is what hides the non-current visibility states). ezdxf does (`resolve_visible` checks
  `entity.dxf.invisible`); a renderer that ignores 60 draws all visibility states on top of each
  other.
- Never evaluate the evaluation graph; the `*U` block is AutoCAD's cached result.
- ATTRIBs: normal INSERT ATTRIBs.

### 5.3 Pitfalls

- **Stale / orphan representations**: the sample has `*U6`…`*U14` with no INSERT (no BLKREFS) — left
  over from earlier states. Harmless if you only render what INSERTs reference.
- **Out-of-date `*U` blocks**: if another application edits the *definition* without regenerating
  the representations, the `*U` blocks still show the old geometry. **UNKNOWN**: whether AutoCAD
  regenerates representations on open (e.g. via the `AcDbBlockRepETag` 1071 counter). For PLOT
  parity assume AutoCAD shows the stored `*U` content. Needs test (edit def in ezdxf, open in ACAD).
- Tools that write DXF without the evaluation graph turn dynamic blocks into static anonymous
  blocks (acadsharp#1133) — rendering unaffected.
- Removing a dynamic block but leaving `AcDbDynamicBlockGUID` xdata can make AutoCAD reject the file
  (ezdxf#58) — reader robustness only.

---------------------------------------------------------------------------------------------------

## 6. XREFs

### 6.1 Storage

- XREF = BLOCK with flag 4 (attach) or 4|8 (overlay), group 1 = path (absolute, relative
  `.\`/`..\`, or bare filename), usually also 32 (resolved) and 64 (referenced) when saved while
  loaded (spec:L2940ff; ACadSharp creates xrefs with `XRef | XRefResolved [| XRefOverlay]`,
  acadsharp:Tables/BlockRecord.cs:350-366). ezdxf: `add_xref_def(filename, name, flags=BLK_XREF |
  BLK_EXTERNAL)` (ezdxf:document.py:1117-1128).
- The xref BLOCK in the DXF contains **no entities** — the content is loaded from the external DWG
  at open time. The INSERT referencing it is a normal INSERT (scale incl. unit conversion, rotation,
  optional XCLIP) — ezdxf howto/content.rst:301-340.
- Nested xrefs of the external file appear as blocks with flag 16 (externally dependent).
- Xref-dependent symbols (layers, linetypes, text styles, dimstyles, blocks) are copied into the
  host tables as `XREFNAME|SYMBOL` with flag 16 (+32 resolved) — libredwg#275 "Layer name with
  vertical bar is not marked dependent". `$VISRETAIN` (default 1) = the host keeps its own
  on/off/freeze/color overrides for these layers — so the host's `XREF|LAYER` table entries are the
  authoritative layer state when rendering xref content (**ASSUMPTION**).
- **Bound** xrefs (XREF → Bind): block becomes a normal block, symbols renamed
  `XREFNAME$0$SYMBOL` (Bind type; "Insert" type drops the prefix). Dictionary duplicate-record
  cloning flag 3 = `<xref>$0$<name>`, 4 = `$0$<name>` (ezdxf:docs/source/dxfobjects/dictionary.rst:45-60).
  Seen in the wild: `1558-BASE$0$ALERTA` (mlightcad-viewer#206), `SHAPE$0$REF` (libredwg#275),
  `0_00$0$S-100_CD_OB Ground Floor Framing Plan$0$A` (ezdxf#833). For the renderer a bound xref is a
  plain block.
- AutoCAD does not accept DXF files as xrefs (ezdxf insert.py:77-83 comment); BricsCAD shows them.

### 6.2 Rendering

- truedxf (DXF-only) cannot draw attached xref content unless it also reads DWG. Options: (a) render
  nothing, (b) optional resolver callback that supplies another document for the xref path.
- What AutoCAD shows when the xref file can't be found: "the program displays text that displays the
  folder path of the missing xref at each insertion of the missing xref" (web:
  https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-1F7D6EA1-9AA8-4D33-819F-09750C295D6B.htm).
  **UNKNOWN**: text style/height/position of that placeholder and whether it **plots**. Needs test.
- Overlay (8): not loaded when the host drawing is itself attached as an xref (nested overlays
  ignored) — only matters when resolving xref chains.
- Unloaded xrefs (xref manager "Unload"): **UNKNOWN** how it's stored in DXF (ACadSharp has an
  `IsUnloaded` remark, BlockRecord.cs:196-200); AutoCAD shows nothing for unloaded xrefs.
- Xref content honors XCLIP (§7), layer states of `XREF|LAYER` entries, and the xref's own
  `$INSUNITS` scaling is already in the INSERT scale (§1.5).

---------------------------------------------------------------------------------------------------

## 7. Clipping of block references (XCLIP → SPATIAL_FILTER)

### 7.1 Storage (ezdxf-notes "XCLIP.md", "SPATIAL_FILTER.md", ezdxf:xclip.py, entities/spatial_filter.py)

```
INSERT
  102 {ACAD_XDICTIONARY 360 → DICTIONARY
       ACAD_FILTER → DICTIONARY
           SPATIAL → SPATIAL_FILTER
                       [xdict ACAD_XREC_ROUNDTRIP → XRECORD]   (inverted clip, 2015+?)
```

SPATIAL_FILTER (spec:L9778-9830, ezdxf spatial_filter.py:37-60, 152-170):

| code | meaning |
|---|---|
| 100 | `AcDbFilter`, then `AcDbSpatialFilter` |
| 70 | number of boundary points: 2 = rectangle (lower-left, upper-right), >2 = polygon |
| 10/20 (×70) | boundary points "in OCS … based on an xref scale of 1" — in practice the points picked in the XCLIP command (OCS of the INSERT ≈ WCS) |
| 210 | normal of the clip plane (all samples (0,0,1) or INSERT extrusion) |
| 11 | origin of the clip coordinate system (all samples (0,0,0)) |
| 71 | clipping enabled 1 / 0 (XCLIP OFF keeps the boundary) |
| 72 [+40] | front clip on [+ distance] — 40 only written when 72=1 (AutoCAD rejects otherwise) |
| 73 [+41] | back clip on [+ distance] — 41 only when 73=1 |
| 40 ×12 | **inverse block transform** at the time of clipping, 3×4 row-major (translation in the 4th column) |
| 40 ×12 | **clip-boundary transform** ("transforms points into the coordinate system of the clip boundary"), 3×4 row-major |

- ezdxf reads the matrices as the **last 24** 40-values (front/back distances may precede them) and
  converts row-major 3×4 → its row-vector Matrix44 (spatial_filter.py:152-170).
- Matrix layout pitfall: "Both DWG and DXF record it as three rows of four with the translation in the
  fourth column" — ACadSharp got this transposed between DWG and DXF (acadsharp#1226, #1230).
- The boundary is open-ended OK (first ≠ last vertex), straight segments only, non self-intersecting
  (XCLIP.md). 2 points → axis-aligned rectangle in clip space.

### 7.2 Applying the clip (ezdxf xclip.py:138-195, frontend.py:881-914)

```
block_pts = inverse_insert_matrix · boundary_pts          // → block coordinates
(if 2 points → expand to rectangle in block coords)
wcs_pts   = M_insert(current) · block_pts                   // current INSERT transform
clip all block content (not ATTRIBs) to polygon wcs_pts
```

- Because the boundary is stored relative to the **block**, copying/moving/rotating/scaling the INSERT
  keeps the clip attached without changing the SPATIAL_FILTER at all (ezdxf-notes "Exploring the
  transformation behavior of SPATIAL_FILTER.md": boundary vertices and both matrices unchanged after
  copy/rotate/scale/mirror). Clipping a *transformed* insert stores the WCS pick points and an
  inverse_insert_matrix containing that insert's scaling/translation.
- `transform_matrix` (2nd matrix): identity in every examined sample; ezdxf ignores it. **UNKNOWN**
  exact semantics (ObjectARX `getClipSpaceToWCSMatrix`). Implement as: `block_pts =
  inverse_insert · transform_matrix⁻¹? · pts` only after an AutoCAD test with a clip created in a
  rotated UCS. For now: identity assumption + log if not identity.
- The clip applies to the block content only; ATTRIBs are drawn unclipped **ASSUMPTION** (ezdxf draws
  attribs after popping the clip, frontend.py:907-917).
- Nested INSERTs: each level's clip applies in its own space (clip stack). Proxy graphics even have
  `PUSH_CLIP`/`POP_CLIP` opcodes with the same struct (oda:L14920ff).
- Front/back clipping (72/73) clips along the clip normal: geometry with clip-space z outside
  [back, front] is removed. For top-view plotting this only matters for 3D content. **UNKNOWN** sign
  conventions; low priority.
- AutoCAD's drawing extents respect the clip (acadsharp#1226 compared EXTMIN/EXTMAX) — relevant for
  "plot extents".

### 7.3 Inverted clip (clip "outside", AutoCAD 2015+)

- No flag in SPATIAL_FILTER. Instead the SPATIAL_FILTER gets an extension dictionary with
  `ACAD_XREC_ROUNDTRIP` → XRECORD with sections `ACAD_INVERTEDCLIP_ROUNDTRIP` (the original, user-drawn
  polygon = the hole) and `ACAD_INVERTEDCLIP_ROUNDTRIP_COMPARE`; the SPATIAL_FILTER's own 10-points
  hold a **combined outer+hole polygon** (a single polygon with a slit) (XCLIP.md, SPATIAL_FILTER.md,
  xclip.py:120-127, 138-160).
- ezdxf's rendering: inner polygon = the smaller-bbox of {vertices, inverted_clip}; outer bounds =
  bbox of inverted_clip_compare; clip region = outer minus inner (`make_inverted_clipping_shape`).
  "The exact data structure … is still not clear to me" (xclip.py:28-46).
- Simplest correct-looking approach: use the SPATIAL_FILTER polygon **as stored** with even-odd /
  nonzero fill — it is a valid simple polygon with a slit that already describes "outside the hole".
  **UNKNOWN / needs AutoCAD test** whether AutoCAD uses exactly that polygon; the slit may be visible
  as a hairline gap in the clipping of thick geometry.
- AutoCAD refuses DXF files whose inverted-clip roundtrip data it doesn't like ("Xdata wasn't read")
  — ezdxf gave up writing them (xclip.py `invert_clipping_path` warning).

### 7.4 Clip frame ($XCLIPFRAME)

- Header `$XCLIPFRAME`: R2004–R2007 group 290 bool (0/1 only), R2010+ group 280 with 0..2
  (libredwg:header_variables_dxf.spec:446-450, ixmilia HeaderVariablesSpec.xml, ezdxf#1049: value 2 in
  an R2004/R2007 DXF made AutoCAD refuse the file).
- Values (web: Bricsys/Graebert help, ixmilia enum `XrefClippingBoundaryVisibility`):
  **0 = not displayed, not plotted; 1 = displayed and plotted; 2 = displayed, not plotted** (default 2).
- **CONFLICT**: ezdxf's `XClip` docstring and `spatial_filter.py` comment say "1 = displayed, not
  plotted; 2 = displayed and plotted" (xclip.py:64-72, spatial_filter.py:28-33) while ezdxf-notes
  XCLIP.md has the correct AutoCAD wording. ezdxf's frontend draws the frame whenever the value is
  non-zero (frontend.py:907-911). For PLOT output: draw the frame only for value 1 (R2010+) —
  and for R2004/R2007 bool 1 probably means "displayed and plotted" (**UNKNOWN**).
- The frame is drawn with the INSERT's resolved properties (ezdxf) — **ASSUMPTION**.
- `FRAME` (registry/drawing?) sets IMAGEFRAME, DWFFRAME, PDFFRAME, DGNFRAME, XCLIPFRAME and
  WIPEOUTFRAME at once (acadsharp#681 quoting Autodesk help).
- **Settled by §7.5:** 0 = no frame, 1 = frame plotted, 2 = not plotted (the ezdxf docstring is
  wrong).

### 7.5 AutoCAD results (VERIFIED-BY-ACAD, AutoCAD 2027, xclip suite, 2026-09-30)

References `samples/refs/acad2027-R26.0/xclip/*`; implementation `packages/render/src/draw/xclip.ts`.

- **Boundary → block**: `block = inverse_insert (1st matrix) · second⁻¹ · boundary`, the 2nd
  matrix mapping the clip-time WCS into the boundary system (transform-matrix-rect/-polygon:
  the boundary given in a system rotated −30° about (40,30) is honoured; identity is the norm).
  Two points = axis-aligned rectangle in the boundary system. Then the *current* INSERT transform
  (block → WCS incl. base point) places it, so the clip follows the INSERT when it is moved,
  rotated, scaled, mirrored or non-uniformly scaled afterwards, for both storage styles
  (after-clip-*, rect-block = rect-acad, made-on-*, block-coords-*; Q-0632). A repeated closing
  vertex is harmless (polygon-closed-repeat).
- **MINSERT**: one region for the whole array, placed with the transform of cell (0,0); the other
  cells are clipped by that same region, i.e. only what falls inside it shows (minsert, Q-0636).
- **Nested clips** intersect (each level in its own space) (nested, nested-child-only; Q-0635).
- **Disabled** (71 = 0): content unclipped, no frame, for any $XCLIPFRAME (disabled-frame-1/-2).
- **$XCLIPFRAME** (Q-0628, Q-0629, Q-0630): R2018 280: 0 → no frame, **1 → frame plotted**, 2 →
  not plotted (xclipframe-0/-1/-2). R2004/R2007 290: 1 → plotted; **value 2 makes AutoCAD reject
  the file** (r2004/r2007-xclipframe-2 invalid-fixture). The header wins over a DICTIONARYVAR
  XCLIPFRAME (dictvar-h0-d1, -h1-d0, -h2-d1).
- **Frame properties**: drawn with the INSERT's resolved colour, lineweight and linetype, the
  linetype restarting on every boundary edge (per-segment dashes) (frame-props-bylayer/-explicit;
  Q-0631).
- ~~ATTRIBs are not clipped~~ **SUPERSEDED 2026-10-01:** the regenerated reference of
  xclip/attrib-outside omits the ATTRIB outside the boundary, so ATTRIBs *are* clipped with
  their INSERT (VERIFIED-BY-ACAD xclip/attrib-outside, refs of 2026-10-01; Q-0637). Our
  renderer still draws them unclipped (docs/TODO.md).
- **Front/back clip** along the boundary normal (z in the boundary system): front 40 keeps
  z ≤ 40, back 41 keeps z ≥ 41; a ramp crossing a plane is cut geometrically (frontback-*;
  Q-0638). truedxf culls whole entities by their point depth range (crossing entities kept).
- **Boundary edges** (fixtures put them on exact pixel ties, so partly noise): model lines lying
  on a 2-point rectangle's edges are drawn (rect-block, x = 10 / 60 grid lines), the same lines on
  the same rectangle given as a 4-point polygon vanish (rect-4pt), while a grid line partly on a
  concave polygon edge stays (polygon-concave x = 40). truedxf drops stroke segments lying
  *entirely* on a polygon boundary edge (block-coords-* improve to F1 1.0) and keeps partial
  overlaps. Lines crossing the boundary end in the pixel that contains the boundary point
  (truedxf: single-pixel output clipped against the region dilated by ½ px; fills and thick
  strokes by pixel centre).
- **Inverted clips** written by ezdxf (ACAD_XREC_ROUNDTRIP) are rejected by AutoCAD
  ("Invalid or incomplete DXF input", inverted-ezdxf; Q-0633/Q-0639 stay open for AutoCAD-written
  inverted clips).

---------------------------------------------------------------------------------------------------

## 8. IMAGE, IMAGEDEF, IMAGEDEF_REACTOR, RASTERVARIABLES

### 8.1 IMAGE group codes (spec:L4680-4757, ezdxf:entities/image.py:236-310)

| code | meaning | default |
|---|---|---|
| 100 | `AcDbRasterImage` | |
| 90 | class version | 0 |
| 10 | insertion point (WCS) = **lower-left corner** of the image | |
| 11 | U vector of **one pixel** (visual bottom edge direction), WCS | |
| 12 | V vector of one pixel (visual left edge, pointing up), WCS | |
| 13/23 | image size in pixels (u, v) | |
| 340 | hard ref → IMAGEDEF | |
| 70 | display flags: 1 show image, 2 show when not aligned with screen, 4 use clipping boundary, 8 transparency on | ezdxf default 3 |
| 280 | clipping state 0/1 | 0 |
| 281 | brightness 0..100 | 50 |
| 282 | contrast 0..100 | 50 |
| 283 | fade 0..100 | 0 |
| 360 | hard ref → IMAGEDEF_REACTOR (not required by AutoCAD per ezdxf) | |
| 71 | clip boundary type 1 rectangular, 2 polygonal | 1 |
| 91 | number of clip vertices | |
| 14/24 | clip vertices in **pixel coordinates** | (−0.5,−0.5),(w−0.5,h−0.5) |
| 290 | clip mode (R2010+): 0 = outside mode (show inside boundary), 1 = inside mode (inverted, hide inside) | 0 |

- World size of the image = `w·|U|` × `h·|V|`; U and V need not be orthogonal (skew) and can be
  mirrored.
- WCS transform of a pixel-space point `(x, y)` where pixel space has origin at the **top-left**
  corner of pixel (0,0) minus 0.5 and **y growing downwards** (ezdxf image.py:62-66, 204-227):

  ```
  origin = insert + 0.5·U − 0.5·V
  wcs(x, y) = origin + x·U + (h − y)·V
  ```
  Check: `(−0.5, −0.5)` → `insert + h·V` (top-left corner), `(w−0.5, h−0.5)` → `insert + w·U`
  (bottom-right corner). So pixel `(i, j)` (column i, row j from the top) covers
  `insert + [i, i+1]·U + [h−1−j, h−j]·V`.
- For drawing the bitmap: `wcs = insert + (u_px)·U + (h − v_px)·V` with `u_px, v_px ∈ [0, w] × [0, h]`
  measured from the top-left corner of the bitmap (ezdxf `get_wcs_transform` uses rows U, V,
  insert and the backend flips).
- Clipping: rectangle given by two corners (expand to 4), polygon by ≥3 vertices; close it
  (ezdxf `pixel_boundary_path`). Apply when flag 4 set (ezdxf uses flag 4 only; `remove_outside =
  clip_mode == 0`). **UNKNOWN** whether AutoCAD also requires 280=1 (AutoCAD writes both
  consistently). When clipping is active, the image frame is the clip boundary.
- **CONFLICT (docs)**: spec says clip vertices are "in OCS"; they are pixel coordinates
  (ezdxf image.py:311 "boundary path coordinates are pixel coordinates NOT drawing units", mozman in
  ezdxf#205).

### 8.2 IMAGEDEF (spec:L8311-8358, ezdxf image.py:553-600)

| code | meaning |
|---|---|
| 90 | class version |
| 1 | file name (absolute or relative path, backslashes) |
| 10 | image size in pixels |
| 11 | default size of one pixel in AutoCAD units |
| 280 | loaded flag (0 unloaded, 1 loaded) |
| 281 | resolution units: 0 none, 2 cm, 5 inch (only these three, ODA 20.4.81) |

- IMAGEDEFs live in the named-object dictionary `ACAD_IMAGE_DICT`; IMAGEDEF_REACTOR (90 version 2, 330
  → IMAGE) links back; irrelevant for rendering.
- Path resolution (ezdxf-notes "IMAGE File Paths.md", frontend.py:1088-1110): try absolute path, then
  relative to the DXF's directory, then the bare filename in the DXF's directory. TrueView does not
  display relative-path images until "reload" but displays absolute-path images — i.e. AutoCAD's
  resolution also depends on the project search path (PROJECTNAME / support paths). For truedxf:
  resolver callback with the ezdxf order as default.

### 8.3 RASTERVARIABLES (spec:L9288-9320, ezdxf image.py:680-745)

Object in NOD `ACAD_IMAGE_VARS`: 90 version, **70 frame** (0 no frame, 1 frame), 71 quality
(0 draft, 1 high — screen only), 72 units (0 none, 1 mm, 2 cm, 3 m, 4 km, 5 in, 6 ft, 7 yd, 8 mi).
- `IMAGEFRAME` sysvar has 3 values (0 hidden/not plotted, 1 displayed and plotted, 2 displayed not
  plotted; libredwg:header_variables.spec:27 "IMAGEFRAME [0-2] default 1"), but RASTERVARIABLES 70
  is documented as boolean (spec, ixmilia `is_display_frame_image: bool`, ezdxf validator bool).
  **UNKNOWN** where value 2 is stored (maybe 70=2, maybe a DICTIONARYVAR). Needs test. Missing
  RASTERVARIABLES → default IMAGEFRAME 1 (**ASSUMPTION**).
- ezdxf always draws the image boundary (frontend.py:799-801) — **CONFLICT** with IMAGEFRAME=0.

### 8.4 Rendering details

- Flag 1 off, or IMAGEDEF 280=0 (unloaded), or file missing: AutoCAD shows only the frame (and,
  for missing files, **UNKNOWN** — ezdxf draws the filename centered at 75% of the image width,
  frontend.py:771-797, "only an approximation"). What PLOT does for a missing image: **UNKNOWN**.
- Brightness/contrast/fade: exact formulas **UNKNOWN**. ezdxf (pr#999, compared against an AutoCAD
  reference document): contrast via PIL `ImageEnhance.Contrast(c/50)`; fade = blend towards the
  **background color** by `fade/100` (so model/paper space differ); brightness = blend towards white
  (`b>50`) or black by `|b/50−1|`; applied in the order contrast → fade → brightness; all at 100 →
  pure white. "the exact algorithm for 'brightness' is unclear" (pr#999).
- Transparency flag 8: for images with alpha channel the alpha is used; without the flag alpha is
  forced to 255 (ezdxf frontend.py:762-763). Entity transparency (440) multiplies alpha (ezdxf).
- **Bitonal (1-bit) images**: foreground pixels are drawn in the **entity color**; with
  transparency on, the background (0) pixels are transparent. For color/grayscale images the entity
  color only affects the frame (web: https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-57FF8C8D-FF5C-4F4F-8213-4944FBCBEE8A.htm
  "The color setting controls the foreground color of a bitonal image or the frame color of a color or
  grayscale image"). ezdxf does not implement this — gap.
- Flag 2 "show when not aligned": only relevant for non-plan views; for top-view plotting always
  draw. **ASSUMPTION**.
- Resampling filter used by PLOT (nearest vs bilinear), plot raster resolution: **UNKNOWN** — the
  hardest part of pixel parity; test with a tiny 2×2 image scaled up.
- Images inside blocks: transformed by M like everything else (ezdxf pr#999 supports "transforms
  from being inside a block" and mirroring).
- Frame of a non-clipped image = the 4 image corners; of a clipped image = clip polygon.

---------------------------------------------------------------------------------------------------

### 8.5 What the reference harness shows (VERIFIED-BY-ACAD, accoreconsole 2027, 2026-09-30)

- **accoreconsole plots no IMAGE and no WIPEOUT at all**: no bitmap, no frame (even with
  IMAGEFRAME 1 / WIPEOUTFRAME 1, colour 1, 0.70 mm), no masking; every IMAGE case in `images/*`
  and every `images/wipeout*` case plots only its vector context. On DXFOUT both entities get an
  empty proxy graphic (PUSH_MODELXFORM identity + POP only): the ISM / WipeOut modules draw nothing
  in the console. So §8.4 / §9 **cannot be verified with the console**; truedxf renders them
  (RenderEnv.rasterEntities "draw", render/src/draw/image.ts, UNVERIFIED formulas) and the harness
  uses "omit". Verifying needs plots from full AutoCAD (acad.exe).
- Storage (DXFOUT): RASTERVARIABLES 70 keeps the value 2 (`imageframe-2`); WIPEOUTVARIABLES 70 = 2
  is kept and a WIPEOUTFRAME DICTIONARYVAR is written (`wipeoutframe-*`).
- PDF underlays **are** plotted by the console (content and colours, `images/pdf-*`). PDFFRAME is
  read from the DICTIONARYVAR `PDFFRAME`: 1 (and absent) plots the frame, 0 and 2 do not
  (`pdfframe-dictvar-0/1/2`; 0 and 2 byte-identical). truedxf draws only an underlay's clip frame
  so far (no PDF content).

## 9. WIPEOUT (+ WIPEOUTVARIABLES)

- Same subclass layout as IMAGE (`AcDbWipeout`/`AcDbRasterImage`, spec:L7534ff), with
  `image_def_handle = 0`, `image_def_reactor = 0`, `image_size = (1,1)`, flags 7, clipping 1
  (ezdxf image.py:500-545). U and V are the full bounding-box extents (one "pixel" = whole area);
  boundary vertices are normalized: `(x/w − 0.5, 0.5 − y/h)` relative to the bbox min
  (ezdxf `set_masking_area`). → Use the same `wcs(x,y)` formula as IMAGE with w=h=1.
- Rendering: fill the boundary polygon with the **current background color** (PLOT: paper color,
  usually white), in draw order, masking everything drawn earlier (ezdxf frontend.py:672-677;
  mlightcad-viewer#671 describes the AutoCAD behavior: "The wipeout area shows the current background
  colour… Everything created before the wipeout… is hidden… Draw order follows creation order, or
  SORTENTS when present"). ezdxf#205 (mbway): pastes a background rectangle and hides the background
  grid too.
- Wipeouts inside blocks mask earlier entities of the same block *and* whatever was drawn before the
  INSERT (block content is drawn in place). **ASSUMPTION** (ezdxf#205: "wipeout entities can wipe out
  entities within the same block if they are below in the draw order").
- Clip mode 290 on a wipeout (inverted): **UNKNOWN**.
- Frame: drawn in the **entity color** when enabled. Frame control:
  - `WIPEOUTVARIABLES` object (NOD `ACAD_WIPEOUT_VARS`; spec says owner `ACAD_IMAGE_VARS` — probably a
    copy/paste error): 70 display frame 0/1 (spec:L10191ff; ixmilia; ACadSharp pr#1202).
  - Newer AutoCAD (2013+?) stores `WIPEOUTFRAME` as `DICTIONARYVAR "WIPEOUTFRAME"` in
    `AcDbVariableDictionary` with values 0/1/2 (acadsharp#918 snippet: `"0"` off, `"1"` on;
    acadsharp#681: WIPEOUTFRAME "is not documented in dwg and is not implemented in the header").
    Values per Autodesk: 0 = not displayed/not plotted, 1 = displayed and plotted, 2 = displayed not
    plotted (**ASSUMPTION**, same scheme as the other *FRAME vars). Priority: DICTIONARYVAR over
    WIPEOUTVARIABLES. Needs test.
- PLOT with a dark model-space background: the wipeout is plotted with the plot background (white)
  — **ASSUMPTION** (background is the paper). Monochrome CTB does not change it.

---------------------------------------------------------------------------------------------------

## 10. UNDERLAY (PDF / DWF / DGN) and definitions

### 10.1 Entities `PDFUNDERLAY` (alias `PDFREFERENCE`), `DWFUNDERLAY`, `DGNUNDERLAY`

(spec:L7116-7160, ezdxf:entities/underlay.py:44-110)

| code | meaning | default |
|---|---|---|
| 100 | `AcDbUnderlayReference` | |
| 340 | → `PDFDEFINITION`/`DWFDEFINITION`/`DGNDEFINITION` | |
| 10 | insertion point (OCS) | |
| 41/42/43 | scale x/y/z | 1 |
| 50 | rotation (OCS, about z) | 0 |
| 210 | normal | (0,0,1) |
| 280 | flags: 1 clipping on, 2 underlay on, 4 monochrome, 8 adjust for background, 16 clip is inside mode (inverted) | ezdxf default 10 |
| 281 | contrast 20..100 | 100 |
| 282 | fade 0..80 | 0 |
| 11/21 (repeat) | clip boundary: 2 points = rectangle, >2 polygon, in OCS "drawing coordinates but unscaled" (ezdxf `set_boundary_path`) i.e. underlay-local units before 41/42 | |

- Transform: like INSERT without base point: `OCS · T(insert) · Rz(rot) · S(sx,sy,sz)` (ezdxf
  `transform` uses `InsertCoordinateSystem`).
- PDF "natural" size at scale 1: **UNKNOWN** — ASSUMPTION: 1 PDF inch = 1 drawing unit, unit
  conversion baked into 41/42 by the attach command (like INSERT). Needs test.

### 10.2 Definition objects (spec:L9990-10020, ezdxf underlay.py:376-446)

`PDFDEFINITION` etc. in NOD `ACAD_PDFDEFINITIONS` / `ACAD_DWFDEFINITIONS` / `ACAD_DGNDEFINITIONS`:
1 = file path, 2 = underlay name (PDF: page number as string, DGN: model name, DWF: sheet).

### 10.3 Rendering

- PDF underlays need a PDF rasterizer/vectorizer — out of scope for v1. Recommended fallback: draw
  frame only (or nothing, depending on PDFFRAME). ezdxf doesn't render underlays at all
  (disassemble.rst "Unsupported entities: … XREF, UNDERLAY").
- Monochrome (4): all non-white content drawn black (**ASSUMPTION**); "adjust for background" (8):
  lighten/invert for dark backgrounds — screen only? **UNKNOWN** for PLOT.
- PDF layer visibility (OCG) is stored somewhere in the underlay/xdict — **UNKNOWN**.
- Frame vars `$DWFFRAME`, `$DGNFRAME` are header variables (R2007+, group 280; values 0 none, 1
  display and plot, 2 display no plot — ixmilia `UnderlayFrameMode`); `PDFFRAME` has no DXF header var
  (libredwg:header_variables.spec:28 "PDFFRAME [0-2] default 1" in the TODO list) → **UNKNOWN** storage.

---------------------------------------------------------------------------------------------------

## 11. OLE2FRAME

(spec:L5844-5900, ezdxf:entities/oleframe.py, mlightcad:entity/AcDbOle2Frame.ts,
mlightcad:misc/AcDbOle2FrameGeometry.ts)

| code | meaning |
|---|---|
| 100 | `AcDbOle2Frame` |
| 70 | OLE version |
| 3 | "Length of binary data" per spec, actually a descriptive string (e.g. "Paintbrush Picture") in real files — **ASSUMPTION** |
| 10 | upper-left corner (WCS) |
| 11 | lower-right corner (WCS) |
| 71 | object type 1 link, 2 embedded, 3 static |
| 72 | tile mode: 0 model space, 1 paper space |
| 90 | binary length |
| 310… | binary data |
| 1 | "OLE" end marker |

- Binary payload: a 0x80-byte AutoCAD header — `uint16` marker (commonly 0x5580), then **four
  Point3d corners** (upper-left, upper-right, lower-right, lower-left) — followed by an MS-CFB
  compound document at offset 0x80 (mlightcad AcDbOle2FrameGeometry.ts, citing LibreDWG
  `dwg_decode_ole2`). The 4 corners allow **rotated** OLE frames (mlightcad has `rotation`); 10/11
  alone only give an axis-aligned box.
- What is renderable: the CFB usually contains a presentation stream (`\x02OlePres000`, WMF/EMF or
  DIB) — mlightcad extracts images/metafiles (`AcDbOleImageExtractor.ts`,
  `AcDbOleMetafileRasterizer.ts`: "Excel OLE previews typically arrive as WMF/EMF metafile blobs").
  AutoCAD plots OLE objects via the OLE server/cached presentation; quality `OLEQUALITY`.
- ezdxf draws a filled rectangle in an arbitrary color `#89adba` (properties.py:75,
  frontend.py:690-694). For truedxf v1: frame/placeholder; later: decode presentation stream
  (WMF/EMF/DIB). Pixel parity: **UNKNOWN**.
- OLEFRAME (R14-era, no "2"): obsolete; treat like OLE2FRAME placeholder.

---------------------------------------------------------------------------------------------------

## 12. MLINE and MLINESTYLE

### 12.1 MLINE group codes (spec:L5116-5230, ezdxf:entities/mline.py:52-130)

| code | meaning |
|---|---|
| 100 | `AcDbMline` |
| 2 | style name (redundant; use 340) |
| 340 | → MLINESTYLE |
| 40 | scale factor (may be negative → flips side) |
| 70 | justification: 0 top, 1 zero (center), 2 bottom |
| 71 | flags: 1 has vertices, 2 closed, 4 suppress start caps, 8 suppress end caps |
| 72 | number of vertices |
| 73 | number of elements in the style |
| 10 | start point (WCS) |
| 210 | normal (all vertices are WCS; MLINE is a WCS entity, ezdxf `ocs()` returns WCS) |
| per vertex: 11 | vertex (WCS) |
| 12 | direction of the segment starting at this vertex (unit) |
| 13 | miter direction at this vertex (unit) |
| per element (73×): 74 n, 41×n | element (line) parameters |
| 75 m, 42×m | area-fill parameters |

**Key fact: the vertex data are the final geometry** — scale, justification, style offsets and miter
angles are already applied (ezdxf mline.py:314-320 "The MLINE geometry stored in vertices, is the
final geometry"). The renderer does not need to recompute from the style except for colors,
linetypes, caps and fill.

### 12.2 Element parameterization (spec:L5190-5215)

For element k at vertex i, the 41 list `[a0, a1, a2, a3, …]`:
- `a0` = distance from vertex along the **miter vector** to the element's path:
  `P_ik = V_i + a0 · miter_i`.
- `a1` = distance along the **segment direction** (12) from `P_ik` to the start of the first dash.
- `a2, a3, …` = alternating stop/start distances (from `P_ik` along the direction) of breaks/cuts
  created by MLEDIT ("Cut single/all", "Weld", crossings). Linetypes do not affect these lists.
- The last start runs to the next vertex's `P_(i+1)k`.
- netDxf `Explode` implements exactly this: segments `[refStart + dir·d[k], refStart + dir·d[k+1]]`
  for k = 1, 3, 5, …, the last one ending at the next vertex's miter point
  (netdxf:Entities/MLine.cs:521-575).
- ezdxf ignores everything after `a0` (renders only full segments, render/mline.py:165-200) and drops
  breaks on edit (mline.py:180-184) — **CONFLICT (gap)**; netDxf is the better reference.
- Generation (for understanding / writing): offsets per element
  `a0 = (offset_k + shift) · scale / sin(angle(dir, miter))` with `shift = −max_offset` (top) or
  `−min_offset` (bottom) or 0 (zero) (ezdxf mline.py:582-600; netDxf uses `/cos(miter − (90°+dir))`,
  identical). Start/end miters use the style's start/end angles (51/52, default 90°):
  `miter_0 = dir_0 rotated by start_angle`, inner miters = normalized bisector normal
  `orthogonal(normalize((d1+d2)/2))`; closed → closing miter from last and first directions.
  **CONFLICT**: justification "Top"/"Bottom" — ezdxf shifts by −max/−min offset; netDxf uses
  `−Elements[0].Offset` (top) / `−Elements[last].Offset` (bottom), assuming elements sorted
  descending. Same result if sorted; ezdxf's `ordered_indices()` sorts explicitly.
- Fill parameters (75/42): same interpretation per element; define gaps in the fill, e.g. where an
  unfilled MLINE crosses a filled one (spec:L5205-5213). Empty lists = full fill.

### 12.3 MLINESTYLE (spec:L8988-9060, ezdxf mline.py:720-790)

| code | meaning | default |
|---|---|---|
| 2 | name | |
| 70 | flags: 1 fill on, 2 display miters (joints), 16 start square cap, 32 start inner arcs, 64 start round (outer arcs), 256 end square, 512 end inner arcs, 1024 end round | 0 |
| 3 | description | |
| 62 | fill color | 256 (BYLAYER) |
| 51 / 52 | start / end angle (degrees) | 90 |
| 71 | number of elements | |
| per element: 49 offset, 62 color (default 0 = BYBLOCK!), 6 linetype (default BYLAYER) | | |

- Element color default is **BYBLOCK (0)** per spec; BYBLOCK here resolves against the MLINE
  entity's color (**ASSUMPTION**; ezdxf copies element colors onto the virtual LINEs, so BYBLOCK
  resolves against the enclosing INSERT instead — **CONFLICT/UNKNOWN**). Needs test: MLINE (color red,
  style elements BYBLOCK) in model space.
- True color of MLINE is ignored by CAD applications (ezdxf render/mline.py:21-24 "True color value of
  MLINE is ignored by CAD applications"). **UNKNOWN** whether styles can carry 420 true colors per
  element.

### 12.4 Rendering algorithm

```
elements sorted by offset; top = max offset, bottom = min offset
for each vertex i, element k: P[i][k] = V_i + a0(i,k)·miter_i
lines: for each segment i→i+1 (and n−1→0 if closed), element k:
       dashes from 41 list (see 12.2), color/linetype of element k
miters (flag 2): at inner vertices (and all vertices if closed): line top-point→bottom-point
       ezdxf draws it as two halves (top→mid, bottom→mid) colored by top / bottom element;
       netDxf `CreateSquareCap` likewise uses two colors. **ASSUMPTION**: two halves.
caps (not closed, not suppressed by 71 bits 4/8):
   square (16/256): line P[0][top]→P[0][bottom] (two halves like miters)
   round/outer arcs (64/1024): semicircle through P[top] and P[bottom], center = midpoint,
        bulging outward; if top/bottom colors differ → two quarter arcs in each color
   inner arcs (32/512): semicircles between symmetric inner pairs (k, n−1−k) for k = 1 … ⌊n/2⌋−1
fill (flag 1): polygon bottom border (forward) + top border (reversed), fill color 62,
        round caps included as bulges (ezdxf) — drawn **first** (under the lines)
```

- **CONFLICT (inner arcs)**: ezdxf draws only one inner pair (ordered[1], ordered[−2]) and only for
  >3 elements (render/mline.py:66-72); netDxf draws all symmetric inner pairs `i = 1 … ⌊n/2⌋−1`
  (MLine.cs:640-660). AutoCAD's docs "connects pairs of inner elements" → netDxf more plausible.
  Needs test (5-element style with inner arcs).
- Negative scale swaps round-cap orientation (netDxf `scale >= 0 ? … : …`).
- Fill with MLEDIT fill-breaks (42 lists): not supported by ezdxf/netDxf. **UNKNOWN** exact fill
  polygon splitting.
- Round caps direction: the arc lies outside the MLINE end (away from the next vertex).

---------------------------------------------------------------------------------------------------

### 12.5 Verified (mline suite, AutoCAD 2027, 2026-09-30)

- The stored vertex data are drawn as is; **vertex element k takes the style element with the
  k-th largest offset** (AutoCAD keeps elements sorted), whatever the order of the style's 49
  list (`unsorted-offsets-*`). Caps and joints run between vertex elements 0 and n-1.
- Element colours / linetypes resolve like exploded LINEs on the MLINE's layer: BYLAYER -> the
  MLINE's layer, BYBLOCK -> the enclosing block context (top level: ACI 7 / Continuous); the
  MLINE's own colour, 420 true colour and linetype are not used (`props-*`, `true-color`); this
  resolves the §12.3 CONFLICT against the "BYBLOCK = MLINE colour" assumption.
- 340 wins over the style name in group 2 (`style-name-handle-mismatch`).
- Square caps / joints: two halves from the ends to the midpoint, coloured by elements 0 and n-1;
  round caps: two quarter arcs; inner arcs: every symmetric pair (k, n-1-k), k = 1 .. floor(n/2)-1
  (`caps-*`, `miters-*`); fill under the lines including round caps, negative scale fine
  (`fill-round-neg/pos`); 41 break parameters are honoured (`breaks-*`); the hand-written 42
  fill-break lists did not split the fill (`fill-breaks-*`).
- Linetypes restart per segment (like exploded LINEs); AutoCAD's dash pixels are 1 px off ours
  along whole dashed lines (`props-*`), a linetype rasterization detail.
- Open: fill of self-overlapping closed MLINEs (`random-0003`) and at sharp end miters
  (`random-0004`); non-90 degree caps are close but not pixel-exact (`angles-45-135-*`).

## 13. ACAD_TABLE and TABLESTYLE

### 13.1 Structure (ezdxf:entities/acad_table.py:33-235, libredwg:dwg2.spec:477-560, acadsharp:Entities/TableEntity.cs)

- ACAD_TABLE is a subclass of block reference: `AcDbEntity`, `AcDbBlockReference`
  (2 = block name `*T###`, 10 = insertion point, optionally 41/42/43, 50, 210, 66 — libredwg writes
  scale only when ≠1, rotation, extrusion), then `AcDbTable` (280 version, 342 → TABLESTYLE, 343 →
  block record of the `*T` block, 11 horizontal direction, 90 flags, 91 rows, 92 cols, 93-96 override
  flags, 141 row heights, 142 column widths, per cell 171-178/145/344/1/2/340/144/… …).
  ACadSharp models `TableEntity : Insert`.
- R2010+ also store the content in TABLECONTENT/TABLEGEOMETRY objects; text values: R2007+ 302 holds
  the full text (>66000 chars tested), R2004 splits into 2/3 chunks + 1 (acad_table.py
  `read_acad_table_content`).
- **Rendering: draw the `*T` anonymous block like an INSERT** (ezdxf `AcadTableBlockContent.
  __virtual_entities__` translates the block content by 10 — "TODO: OCS transformation (extrusion) is
  ignored yet"; r12export converts ACAD_TABLE → INSERT of `*T`). Don't re-layout the table.
- **Transform: the full INSERT transform 10/41-43/50/210** (render/src/draw/basic.ts).
  VERIFIED-BY-ACAD 2026-10-01, local probes `render-probes/table-*` (the ezdxf `acad_table_simple`
  table patched; window plot, DXFOUT): AutoCAD **regenerates** the `*T` block on load from the
  table data (DXFOUT block differs from the input even for an unchanged table) and lays the table
  out along the direction **11**, ignoring 50: 50 = 30 with 11 = (1,0,0) plots horizontal,
  11 = (cos 30°, sin 30°) with 50 = 0 plots rotated 30° about 10, both together plot rotated 30°.
  The block it writes back is pre-rotated so that INSERT(50) of it gives that orientation (50 = 30,
  11 = x axis → block content at −30°; 50 = 0, 11 at 30° → block content at +30°; both 30° →
  block content unrotated). So for AutoCAD-written files 10/50/41-43/210 applied to the stored
  block is exact; a third-party file whose block is not consistent with 50/11 differs (AutoCAD
  re-lays it out; truedxf does not re-layout tables). 41/42 = 2 on the probe gave a broken
  regenerated table in AutoCAD (lines scaled, texts not). Corpus: all 58 layout-level tables have
  50 = 0, 11 = x axis, scale 1 — only the translation mattered (they were drawn at the origin).
- Table cells may contain blocks (block-type cells) — they appear as INSERTs inside `*T`.
- TABLESTYLE (NOD `ACAD_TABLESTYLE`): layout parameters — only needed if the `*T` block is missing
  (then AutoCAD would regenerate; truedxf: draw nothing + warn). ezdxf: "todo: implement TABLESTYLE".
- Some writers (ezdxf#1241 context, older MLEADER/TABLE producers) only provide proxy graphics;
  fall back to proxy graphic if the `*T` block is missing (**ASSUMPTION**).

---------------------------------------------------------------------------------------------------

## 14. Other entities/objects (brief)

| type | kind | render in PLOT? | notes |
|---|---|---|---|
| GROUP | object in NOD `ACAD_GROUP` (300 description, 70 unnamed, 71 selectable, 340 handles) (spec:L8258ff) | no | pure selection set; unnamed groups `*A###` |
| SHAPE | entity: 10 insert (spec says WCS, **ASSUMPTION** OCS like TEXT with 210), 40 size, 2 shape name, 50 rotation, 41 x-scale, 51 oblique, 39 thickness, 210 | yes | shape found by name in the `.shx` of STYLE entries with flag 1 (shape file) — ezdxf shape.py:31-34 "iterating over all the text styles … until the one with the matching name is found". Needs SHX shape rendering (fonts note). ezdxf does not render SHAPE ("could not create any SHAPE entities in BricsCAD", disassemble.py:493); mlightcad does (AcDbShape.ts) |
| LIGHT | entity | no | light glyphs are display aids (LIGHTGLYPHDISPLAY), not plotted (**ASSUMPTION**, Autodesk: "light glyphs do not plot") |
| CAMERA | entity (not in DXF ref) | no | glyph controlled by CAMERADISPLAY; not plotted |
| SUN | object | no | |
| SECTION (SECTIONOBJECT) | entity: 90 state, 91 flags, 1 name, 10 vertical dir, 40/41 top/bottom height, 70 indicator transparency, 63/411 indicator color, 92+11 vertices, 93+12 back line, 360 settings (spec:L6136-6190) | **UNKNOWN** (section line is visible on screen; plot?) | low priority |
| GEODATA | object (spec:L8157ff) | no | geolocation; geomarker display **UNKNOWN** |
| POINTCLOUD / POINTCLOUDEX | entity referencing `.rcs/.rcp` | AutoCAD plots them; truedxf cannot | draw nothing/frame |
| ARRAY (associative) | appears as INSERT of an anonymous block + ACAD_ASSOC network | yes via INSERT | ezdxf#1325/discussion#1366 users treat it as INSERTs |
| IDBUFFER / LAYER_FILTER / SPATIAL_INDEX | objects | no | |

---------------------------------------------------------------------------------------------------

VERIFIED-BY-ACAD (misc suite, 2026-09-30): LIGHT plots nothing, whatever its plot-glyph flag
(`light-point-glyph-0/1`, `light-spot`). Native 3DSOLID / REGION are written by DXFOUT without
proxy graphics.

**ACIS wireframe records (render/src/draw/acis.ts; corpus findings 2026-10-01, file format facts,
not AutoCAD output):**
- Curve records start with header pointers before the geometry: `$attrib` (old SAT, version
  < 700), `$attrib -1 $…` (SAT ≥ 7.0 and SAB, the `-1` is a history id) or `$-1 $-1 $-1` (some
  21500 text). Geometry = the tokens after the last leading `$` pointer. Reading the first
  numbers of the record instead took the history id `-1` as the centre x of `ellipse-curve`s and
  made SAB solids/surfaces millions of units large (libredwg#1021 test-trichter, netDxf#475 MUEB).
- `ellipse-curve`: centre, normal, major axis, ratio (then the parameter range); the edge's
  vertices bound the arc. Minor axis = N̂ × major · ratio (take it before the body transform).
- Tolerant topology is a derived type: `tvertex-vertex`, `tedge-edge` (SAB joins the type names
  with `-`). Ignoring them dropped a quarter of the edges of a real solid (libredwg#1071
  Waschbecken).
- Edges store their curve parameters after the vertex pointers (`edge … $v0 t0 $v1 t1 $coedge
  $curve sense`); a closed edge points to the same vertex twice.
- `intcurve-curve` (exact_int_cur / par_int_cur / int_int_cur …) carries a B-spline
  approximation: `nubs|nurbs degree closure knotCount (knot mult)… points…` (closure is an enum in
  SAB, a word in SAT; `nurbs` points have a 4th weight), each end knot written once less than in
  a clamped knot vector. Evaluating it trimmed to the edge parameters draws the intcurve edges;
  not handled: subtype references (`ref n`) and `parcur` (surface-parameter curves) — those
  fall back to the chord between the vertices (`acis-curve` note). Corpus: 1 082 chord edges
  before, 78 after, out of ~31 500.

## 15. ACAD_PROXY_ENTITY and proxy graphics

### 15.1 Where proxy graphics live

- **Normal/unknown entities** (custom objects like AEC_WALL, or known entities written with proxy
  data, e.g. MLEADER from BricsCAD): in the `AcDbEntity` subclass as length tag + 310 chunks.
  Length tag: 92 before R2013, 160 in R2013+ (ezdxf:entities/dxfgfx.py:200-215).
- **ACAD_PROXY_ENTITY**: in the `AcDbProxyEntity` subclass (ezdxf:entities/acad_proxy_entity.py:18-40):
  90 proxy class id (498), 91 application class id (500 + index in CLASSES), **92 (or 160) graphics
  size + 310 chunks**, 96/162 + 311 unknown data, 93/161 + 310 entity data (bits), 330/340/350/360
  object ids, 94 = 0 end of ids, 95 dwg format (low word version, high word maintenance), 70 original
  data format (0 DWG, 1 DXF).
  The version→code rule is **wrong** in practice: an R2010 file used 160 (ezdxf#978,
  ezdxf-notes "ACAD_PROXY_ENTITY.md") → try 92 then 160 and take the first 310 run right after the
  length tag (acad_proxy_entity.py:69-76, `load_proxy_data`).
- 310 chunks: ≤127 bytes per chunk when writing (ezdxf `CHUNK_SIZE = 127`); AutoCAD writes up to 256
  hex chars; concatenate.

### 15.2 Binary format (oda:L14576-14990; ezdxf-notes "Proxy Graphic Binary Chunk.md" (ADN DevBlog);
ezdxf:proxygraphic.py)

All little-endian. Types: RL = uint32, RD = float64, 3RD = 3 doubles, PS = zero-terminated string
**padded to 4 bytes** in the file code page (cp1252 before R2007, else doc encoding), PUS = UTF-16LE
zero-terminated, padded to 4 bytes. "Graphics data is padded to 4 byte boundaries!" (oda).

```
header : RL total_size, RL command_count            (ezdxf starts parsing at offset 8)
command: RL chunk_size (incl. these 8 bytes), RL opcode, payload
```
Advance by `chunk_size`; `chunk_size < 8` ⇒ corrupt, stop (ezdxf#1286/pr#1287 infinite loop with 0).
Unknown opcode ⇒ skip chunk.

| op | name | payload | ezdxf output |
|---|---|---|---|
| 1 | EXTENTS | 3RD min, 3RD max | ignored |
| 2 | CIRCLE | 3RD center, RD radius, 3RD normal | CIRCLE (center is **WCS**, converted to OCS when normal ≠ Z — ezdxf#873 double-transform bug) |
| 3 | CIRCLE_3P | 3×3RD | CIRCLE |
| 4 | CIRCULAR_ARC | 3RD center, RD radius, 3RD normal, 3RD start vector, RD sweep (rad, CCW about normal), RL arc type | ARC |
| 5 | CIRCULAR_ARC_3P | 3×3RD, RL arc type | ARC (ezdxf passes p1,p3,p2) |
| 6 | POLYLINE | RL n, n×3RD | POLYLINE/POINT (fill flag ignored for polylines, ezdxf#906) |
| 7 | POLYGON | RL n, n×3RD | HATCH if fill on, else closed polyline |
| 8 | MESH | RL rows, RL cols, rows·cols×3RD, edge traits, face traits, vertex traits | polymesh ("untested") |
| 9 | SHELL | RL nverts, verts, RL face-list size, face list (negative count, then indices), edge/face/vertex traits | polyface |
| 10 | TEXT | 3RD pos, 3RD normal, 3RD direction, RD height, RD width factor, RD oblique, PS text | TEXT |
| 11 | TEXT2 | 3RD pos, normal, direction, PS text, RL length (−1 = zero terminated), RL raw (0 raw = don't interpret %%), RD height, width, oblique, tracking, RL backward, upside-down, vertical, underline, overline, PS font file, PS bigfont file | TEXT with style from font file |
| 12 / 13 | XLINE / RAY | 2×3RD | XLINE/RAY |
| 14 | SUBENT_COLOR | RL color (ACI; 0 BYBLOCK, 256 BYLAYER) | resets true color |
| 16 | SUBENT_LAYER | RL layer **index** | index into LAYER table in storage order (ezdxf) |
| 18 | SUBENT_LINETYPE | RL linetype index; 0xFFFFFFFF bylayer, 0xFFFFFFFE byblock | ezdxf: `linetypes[index + 2]` ("first two entries ByLayer and ByBlock are not included"), 32766 → BYBLOCK, else BYLAYER — **CONFLICT** with oda sentinel values |
| 19 | SUBENT_MARKER | RL | selection marker, ignore |
| 20 | SUBENT_FILLON | RL 0/1 | fill for next POLYGON; ezdxf resets after each primitive |
| 22 | SUBENT_TRUECOLOR | RL raw AcCmEntityColor (oda: RC r, g, b + method byte) | decode like DWG CMC |
| 23 | SUBENT_LNWEIGHT | RL lineweight (signed: −1/−2/−3) | |
| 24 | SUBENT_LTSCALE | RD | |
| 25 | SUBENT_THICKNESS | RD | |
| 26 | SUBENT_PLSTNAME | RL type (0 bylayer, 1 byblock, 2 dict default, 3 by id), RL index | ignored |
| 27 | PUSH_CLIP | 3RD extrusion, 3RD origin, RL n, n×2RD points, 16RD clip transform, 16RD inverse block transform, RL front on, RL back on, RD front, RD back, RL draw boundary | ignored by ezdxf (same model as SPATIAL_FILTER) |
| 28 | POP_CLIP | — | ignored |
| 29 | PUSH_MODELXFORM | 16RD matrix | ezdxf: `Matrix44(values).transpose()`, applied to following primitives (only top of stack, not composed!) |
| 30 | PUSH_MODELXFORM2 | 16RD + unknown | treated like 29 |
| 31 | POP_MODELXFORM | — | |
| 32 | POLYLINE_WITH_NORMAL | RL n, n×3RD, 3RD normal | polyline |
| 33 | LWPOLYLINE | RL byte count, DWG-bitstream LWPOLYLINE body (from flags BS to widths BD) + 3 unknown RC | LWPOLYLINE (ezdxf proxygraphic.py:549-610, flag 512 = closed "not documented") |
| 34 | SUBENT_MATERIAL | H handle | ignore |
| 35 | SUBENT_MAPPER | 7×RL | ignore |
| 36 | UNICODE_TEXT | like 10 with PUS | TEXT |
| 37 | UNKNOWN | empty | |
| 38 | UNICODE_TEXT2 | like 11 with PUS + TrueType fields (RL bold, italic, charset, pitch&family, PUS typeface, PUS font file) + PUS bigfont | TEXT |
| 44 | ELLIPTIC_ARC | 3RD center, 3RD normal, RD major len, RD minor len, RD start param, RD end param, RD major-axis angle | ELLIPSE (found in ezdxf#832 test data; not in oda) |

Opcode numbering: the ADN DevBlog lists 15 = LayerName (PS), 17 = LineTypeName (PS); ezdxf/oda only
know the index variants 16/18 (ezdxf marks 15/17 UNUSED). Implement 15/17 as "name" variants
(**ASSUMPTION**).

Mesh/shell trait flags: 0x0001 colors, 0x0002 layers, 0x0004 linetypes, 0x0020 markers, 0x0040
visibilities, 0x0080 normals, 0x0400 orientation (oda; the DevBlog lists layer ids as 0x100/0x200 —
**CONFLICT**, oda + ezdxf use 0x2/0x4). Edge count for a mesh: `(rows−1)·cols + (cols−1)·rows`;
faces `(rows−1)·(cols−1)`.

### 15.3 Semantics / pitfalls

- Coordinates are in the coordinate system of the entity's owner (WCS for top level, block coords
  inside a block) — "It's not clear if all coordinates in proxy graphics are WCS coordinates even for
  OCS entities" (ezdxf proxygraphic.py:420-425). Inside blocks ezdxf users saw shifted proxy graphics
  (ezdxf#1326, unresolved) — **UNKNOWN**; possibly the stored graphics already include a
  PUSH_MODELXFORM that must be *composed* with the outer transform (ezdxf only applies the top of its
  matrix stack and doesn't compose nested pushes).
- Initial sub-entity traits: ezdxf starts with layer "0", color BYLAYER, linetype BYLAYER (so a proxy
  on layer WALLS without an explicit SUBENT_LAYER draws with layer 0 properties in ezdxf).
  **ASSUMPTION**: the correct initial traits are the host entity's own layer/color/linetype/lineweight
  (AcGi semantics: sub-entity traits start as the entity's traits). ezdxf#1326 also reports color 0
  (BYBLOCK) resolved to black. Needs test.
- Placeholder graphics: if the object enabler wasn't loaded when saving or `$PROXYGRAPHICS=0`, the
  graphics may only contain the bounding box + class/app name text ("a bounding box with class name
  and logical application name" — DevBlog; ezdxf#1241: MLEADER proxy containing just the text
  "AcDbMLeader"). Rendering that text is what AutoCAD would show for a proxy.
- `$PROXYGRAPHICS` (header, default 1) = whether proxy images are **saved**. `PROXYSHOW` (registry,
  not in the file; 0 none, 1 full graphics — default, 2 bounding box only; web: Bricsys/ODA docs)
  controls display → assume 1.
- AutoCAD renders a *known* entity natively and ignores its proxy graphic. Use proxy graphics only for
  entity types truedxf doesn't implement (unknown class names, ACAD_PROXY_ENTITY). ezdxf policy
  SHOW = same; PREFER = always proxy (config.py:34-56). ezdxf treats MLEADER as proxy-only
  (frontend.py:156-160) because its own MLEADER renderer is incomplete.
- Unknown entities in the CLASSES section have the "is-an-entity" flag and may carry proxy graphics in
  AcDbEntity; wrap them (ezdxf `DXFGraphicProxy`, gfxproxy.py) and render the proxy graphic with the
  entity's resolved properties.
- Robustness: every read must be bounds-checked; ezdxf wraps all errors into `ProxyGraphicError`
  and skips the entity.

---------------------------------------------------------------------------------------------------

### 15.4 Status (2026-09-30)

- All `misc/proxy-*` fixtures are rejected by AutoCAD 2027 on load ("Invalid or incomplete DXF
  input", invalid-fixture), so nothing in §15.2 / §15.3 is verified yet; the generator needs a
  valid ACAD_PROXY_ENTITY. truedxf decodes the opcodes of §15.2 (text and the LWPOLYLINE bitstream
  are skipped), composes nested model transforms and starts from the entity's own traits
  (render/src/draw/proxy.ts); unknown entities with proxy graphics fall back to it.

## 16. Explode / "virtual entities" semantics

ezdxf's rendering of composite entities is built on `virtual_entities()` (ezdxf:explode.py,
insert.py:595-650, disassemble.py:542-582):

- `Insert.virtual_entities()`: copies every entity of the block (skipping ATTDEF — also the constant
  ones, see §4), calls `entity.transform(M)`; non-uniform scaling fallbacks: ARC/CIRCLE → ELLIPSE,
  LWPOLYLINE/POLYLINE with bulges → exploded into LINE/ARC then transformed, nested INSERT that can't
  represent the target system → recursively exploded; other failures → skipped with
  `skipped_entity_callback` ("non transformable", "unsupported non-uniform scaling"). Does **not**
  apply MINSERT (use `multi_insert()` first) nor XCLIP. Entities get `source_block_reference`.
- Non-copyable entities (ACAD_PROXY_ENTITY, OLE2FRAME, …) use their own `virtual_entities` (proxy
  graphic) if available.
- `explode()` = virtual entities + ATTRIB → TEXT (BURST semantics) + DIMENSION re-render.
- `recursive_decompose()` flattens INSERT/DIMENSION/LEADER/MLEADER/MLINE; points are not decomposed.
- MLINE → LINE/ARC/HATCH (render/mline.py); ACAD_TABLE → `*T` content translated by insert;
  MLEADER → proxy or native.

Lessons for truedxf:
1. Don't implement rendering via entity rewriting — text, hatch patterns, linetypes and ellipses under
   non-uniform scaling become wrong ("**Non-uniform scale factors** may lead to incorrect results
   some entities (TEXT, MTEXT, ATTRIB)", insert.py:572-575). Instead: `render(entity, matrix,
   propertyContext)`; the matrix is applied to generated 2D/3D primitives.
2. Still provide an `explode()`/`virtualEntities()` API for users, with ezdxf's documented
   limitations, but keep it separate from the renderer.
3. Keep provenance (source INSERT chain) on generated primitives for picking/grouping (ezdxf
   `set_source_block_reference`, frontend `parent_stack`).
4. The virtual entity stream must carry: resolved layer (after layer-0 substitution), the property
   stack, the clip stack, and the draw order key of the top-level INSERT.

---------------------------------------------------------------------------------------------------

## 17. Summary of conflicts and unknowns

**Conflicts**
- Frozen INSERT layer: AutoCAD hides the whole reference; ezdxf only hides layer-0 content (§3.2).
- Constant ATTDEFs: AutoCAD renders them as block content; ezdxf skips all ATTDEFs (§4.1).
- `$XCLIPFRAME` 1 vs 2: ezdxf code comments swapped; AutoCAD 1 = display+plot, 2 = display only (§7.4).
- MINSERT spacing: ezdxf/LibreCAD unscaled (rotated only), mlightcad scaled (§2.3); MINSERT ATTRIBs
  per cell (ezdxf) vs first cell only (mlightcad).
- MLINE: break parameters (netDxf yes, ezdxf no), inner-arc caps (netDxf all pairs, ezdxf one pair)
  (§12).
- Proxy graphics: linetype index sentinel values (oda vs ezdxf); trait flag bits (DevBlog vs oda) (§15).
- Spec wording on base point and on IMAGE clip vertices "in OCS" (§1.4, §8.1).
- ezdxf always draws image frames, ignoring RASTERVARIABLES/IMAGEFRAME (§8.3); ignores $ATTMODE (§4.2).

**Unknown / needs AutoCAD test**
- MINSERT spacing vs scale; MINSERT attribs; XCLIP on MINSERT.
- Linetype dashes and hatch patterns under non-uniform insert scale; INSERT ltscale (48) effect.
- Unresolved/unloaded xref placeholder (text style/size/plotting).
- SPATIAL_FILTER second matrix semantics; exact inverted-clip polygon; front/back clip.
- IMAGEFRAME=2 / WIPEOUTFRAME / PDFFRAME storage in DXF; missing-image placeholder; brightness/
  contrast/fade formulas; PLOT resampling of rasters.
- Whether AutoCAD regenerates stale dynamic block `*U` representations on open.
- ACAD_TABLE: is rotation baked into `*T`? Answered in §13.1 (AutoCAD writes it consistent with 50).
- Proxy graphics: initial traits, nested PUSH_MODELXFORM composition, coordinates inside blocks.
- MLINE element color BYBLOCK resolution; fill-break polygons.
- SECTION object plotting; PDF underlay natural size.

---------------------------------------------------------------------------------------------------

## Test ideas

Each item = one tiny DXF (R2018 unless noted), plotted by AutoCAD to PDF/PNG and compared.

1. **INSERT transform matrix**: block with an asymmetric "F" shape and base point (5,3); inserts
   with (a) sx=2, sy=0.5; (b) sx=−1, rot=30; (c) extrusion (0,0,−1); (d) extrusion (0.3,0.4,0.866)
   viewed from top; (e) nested: rotated child in non-uniformly scaled parent (shear).
2. **Circle/arc/bulge under non-uniform scale**: circle, arc and bulged LWPOLYLINE in a block with
   sx=3, sy=1 → ellipses; compare tessellation/extent.
3. **Text in non-uniform block**: TEXT (SHX and TTF) + MTEXT in a block with sx=2, sy=1 and rotated
   nested → glyph distortion.
4. **Linetype in scaled block**: DASHED line in block, inserted with scale 1, 2 and (2,1) at 45°;
   with PSLTSCALE variations; INSERT group 48 = 3 vs child ltscale.
5. **Hatch pattern in non-uniform block**: ANSI31 hatch in block with sx=2, sy=1.
6. **MINSERT**: 3×2 MINSERT with spacing (10, 5), sx=2, rot=30, base point ≠ 0; and with attributes.
   Also spacing 0 with count 3 and a semi-transparent block.
7. **Layer 0 / BYBLOCK matrix**: block containing four lines {layer 0 / layer L1} × {BYLAYER /
   BYBLOCK} colors plus BYBLOCK linetype/lineweight/transparency; inserted on layer L2 with INSERT
   color BYLAYER, red, and BYBLOCK at top level; nested two levels deep.
8. **Visibility OFF vs FROZEN**: same block; insert layer OFF, then FROZEN, then VP-frozen in a
   paper space viewport; child layer frozen; ATTRIBs on layer 0, insert layer, and third layer.
9. **Group 60 invisibility** inside a block and at top level.
10. **ATTDEF/ATTRIB**: block with non-constant ATTDEF, constant ATTDEF, invisible constant ATTDEF;
    INSERT with ATTRIBs (one invisible); $ATTMODE 0/1/2; an ATTDEF in model space (shows tag);
    multiline ATTRIB (embedded MTEXT); ATTRIB overlapping a hatch in the block (draw order).
11. **Dynamic block**: use `acadsharp:samples/dynamic-blocks/BLOCKVISIBILITYPARAMETER.dxf` and
    `BLOCKFLIPPARAMETER.dxf` directly; then a variant where the definition was edited by ezdxf without
    touching `*U` blocks (stale representation).
12. **Missing XREF**: INSERT of an xref BLOCK (flags 4, path `C:\nope\x.dwg`), plus overlay variant;
    and a bound-xref naming sample (`X$0$LAYER`).
13. **XCLIP**: rectangular and polygonal clip on (a) untransformed insert, (b) insert moved/rotated/
    scaled after clipping, (c) clip created on a scaled insert, (d) inverted clip; `$XCLIPFRAME` 0/1/2;
    clip disabled (71=0); nested clipped insert inside clipped insert; R2007 DXF with 290=1.
14. **IMAGE**: 4×3 PNG with distinct pixel colors, U/V rotated 30° and mirrored; rectangular and
    polygonal clip; clip_mode 1; brightness 20/80, contrast 20/80, fade 50 separately; transparency flag
    on RGBA PNG; bitonal TIFF with entity color red, transparency on/off; show-image flag off;
    missing file; IMAGEFRAME 0/1/2; image inside a mirrored block.
15. **WIPEOUT**: wipeout between two line sets, frame 0/1/2 (both WIPEOUTVARIABLES and DICTIONARYVAR),
    inside a block, on dark model-space background plotted to white paper, polygonal wipeout.
16. **UNDERLAY**: 1-page PDF underlay at scale 1 with INSUNITS mm vs inch, clipped rectangle and
    inverted clip, monochrome/fade/contrast; PDFFRAME 0/1/2.
17. **OLE2FRAME**: embedded Paintbrush bitmap and Excel range, rotated OLE frame.
18. **MLINE**: STANDARD style; 3- and 5-element style with fill, miters, all cap types, element colors
    BYBLOCK/BYLAYER/explicit and linetypes; justification top/zero/bottom; negative scale; closed
    MLINE; MLINE after MLEDIT "cut all" (breaks) and a filled/unfilled crossing (fill breaks).
19. **ACAD_TABLE**: 3×3 table, rotated 30° and scaled 2 (via INSERT properties), with a block cell.
20. **Proxy graphics**: an AEC/Civil custom object saved with PROXYGRAPHICS=1 and =0; MLEADER written
    by BricsCAD (proxy present); proxy entity inside a block with BYBLOCK colors; decode every opcode
    that appears.
21. **SHAPE**: SHAPE entity from `acadsharp:samples/test_shape.shx` (+ STYLE entry flag 1), rotated,
    oblique, x-scale.
22. **Cyclic block** (A→B→A) — confirm AutoCAD refuses/repairs the file; truedxf must not hang.
23. **Units**: block record units mm, $INSUNITS inch, INSERT scale 1 (hand-written) → confirm AutoCAD
    does NOT rescale at render time.
