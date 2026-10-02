# 11c — Real-world DXF quirks from the C#/C++ library trackers

Mined from the GitHub dumps of **ACadSharp** (1262 threads), **netDxf** (460), **libdxfrw** (101),
**LibreDWG** (1407, DXF-related only) and **LibreCAD** (2959, DXF import/rendering only) in
`research/github/raw/<owner__repo>/threads/`. Titles were triaged, then roughly 450 threads were read
(fuzzer crash reports, UI, build and packaging threads were skipped).

Citation format: `ACadSharp#N`, `netDxf#N`, `libdxfrw#N`, `libredwg#N`, `LibreCAD#N` (issues, PRs and
discussions share one number space per repo). Confidence tags:

- **VERIFIED-BY-ACAD**: someone opened the file in AutoCAD, DWG TrueView, `accoreconsole` or the
  Autodesk online viewer and reported what happened. AutoCAD messages are quoted verbatim.
- **REPORTED**: a maintainer or user said so without an AutoCAD check, or the check used another
  reader (ODA, ezdxf, BricsCAD).
- **ASSUMPTION**: my inference.

Some sources carry more weight than others. From 2026 on, ACadSharp contributors (`YATA-NODE`,
`ilCosmico`, `redbluevn`) checked each writer fix against AutoCAD 2027 through
`accoreconsole /i file.dxf` + `AUDIT`, and some compared **plot pixels**. Treat those as the strongest
evidence here. LibreDWG's rurban ran `DXFIN` batch imports of about 260 files through AutoCAD in 2020
(libredwg#275). That produced the largest collection of AutoCAD DXF error messages we have.

---

## 2. AutoCAD / TrueView message catalogue

| Message (verbatim) | Cause | Source |
|---|---|---|
| `Invalid or incomplete DXF input -- drawing discarded.` | generic fatal trailer | many |
| `Group 280 (zombie flag) is required.` | CLASS with 92/93 | ACadSharp#1253 |
| `Group 280 (was-a-zombie-flag) expected on line N.` | CLASS 91 in AC1015 | ACadSharp#956 |
| `Error: group code 98 is required` / `expected group code 98` | HATCH 47 where AutoCAD expects 98 | ACadSharp#1253 |
| `Error: Group code 47 expected` | HATCH with derived path but no 47 | ACadSharp#250, #1253 |
| `Error: expected group code 92 / 97 / 75 / 330 / 41` | HATCH group order | libredwg#280, #275 |
| `Object creation was not completed.` | DIMSTYLE table without 71/340 | ACadSharp#1253 |
| `No knots provided` (in SPLINE starting at line N) | SPLINE without knots | ACadSharp#1093 |
| `Class AcDbRotatedDimension requires a class separator` | missing `100 AcDbRotatedDimension` | ACadSharp#1093 |
| `Class separator for class AcDbPlotSettings expected` | PLOTSETTINGS without subclass | LibreCAD#1330 |
| `Class separator for class AcDb3dSolid expected` | 3DSOLID 100/350 | libredwg#282 |
| `Class separator for class AcDbBlockReference expected` | ACAD_TABLE without AcDbTable | ACadSharp#1217 |
| `Premature end of object on line N.` | object ended too early (DIMSTYLE header in R14, 3DSOLID, MULTILEADER, VISUALSTYLE) | ACadSharp#1220, libredwg#275 |
| `Entities not allowed in *Paper_Space block definition on line N.` | paper-space entities in BLOCKS | libredwg#277 |
| `Error: Block "*Paper_Space" was not defined` | missing layout block | libredwg#275 |
| `Error in STYLE Table` / `Invalid symbol table record name: "" on line N.` | empty table name | libredwg#275 |
| `Invalid textstyle name for shapeFile: "SHAPE$0$REF"` | shape STYLE must have an empty name | libredwg#287 |
| `Error in APPID Table` | corrupt APPID name | libredwg#1021 |
| `Invalid AcDbLayerTableRecord plot flag for DEFPOINTS layer` | Defpoints 290 ≠ 0 | libredwg#275 |
| `Layer name with vertical bar is not marked dependent` | `|` without xref flag | libredwg#275 |
| `Unexpected DXF group code: 74` | ATTRIB 74 in the wrong subclass | libredwg#275 |
| `Unexpected DXF group code: 170` | PDFUNDERLAY | libredwg#275 |
| `Missing DXF group code: 1` | BLOCKSCALE/ROTATEACTION | libredwg#278 |
| `112 group not followed by 122 group` | XRECORD | libredwg#91 |
| `Invalid dimension block name.` | DIMENSION 2 | libredwg#275 |
| `Bad visibility value 2` | VERTEX | libredwg#275 |
| `Bad mlstyle start angle` | MLINESTYLE | libredwg#275 |
| `Leader entity with no vertices` | LEADER 76 = 0 | LibreCAD#875 |
| `Invalid data for ellipse definition` | ELLIPSE ratio > 1 | netDxf#277 |
| `in IMAGE ... Xdata wasn't read.` | IMAGE without clip vertices | ACadSharp#1219 |
| `File lacks the NamedObject dictionary` | NOD | libredwg#275 |
| `GroupTable dictionary was not defined in NamedObject dictionary` | ACAD_GROUP | libredwg#275 |
| `Unknown value "AC1032" encountered in drawing version.` | older AutoCAD | netDxf#433 |
| `Unknown header variable $X ignored on line N.` | warning only | libredwg#275, netDxf#92 |
| `Error 372 in drawing header on line N.` | unknown (R12/R14 LibreDWG output) | libredwg#275 |
| `DXF read error on line N.` | raw newline in a value, or garbage | netDxf#92, libredwg#275 |
| `Copy to clipboard failed` (opens, but COPYCLIP fails) | bad plot-style or visual-style references | LibreCAD#442, netDxf#147, ACadSharp#1058 |
| `$RECOVER_<timestamp>` layer after RECOVER | written DWG was repaired | ACadSharp#173 |
| DWG: `Error 34 (eWrongObjectType) Object discarded`, `Error 67 (eDwgObjectImproperlyRead)` | wrong handle-ref codes, bad STYLE | libredwg#225, #322 |
| ODA: `Object of class X can't be cast to Y`, `Invalid owner Object`, `Null object Id` | type/handle errors | ACadSharp#1235, libredwg#82, #474 |

---

## 3. File structure and parser tolerance

- `999` comments can appear **anywhere**, including between `0 SECTION` and `2 ENTITIES` (FiberSim, ACadSharp#950) and at the top of Mentor PADS files (LibreCAD#808). Readers must skip them everywhere. REPORTED.
- Old NC/CAM and plotter software writes a `TABLE … ENDTAB` block right after HEADER, **without** a `SECTION / TABLES` wrapper (ACadSharp#1128, REPORTED).
- dxflib 3.1.5 (QCAD 3.2) leaves out ENDSEC (LibreCAD#404). An autosave that ends inside ENTITIES without ENDSEC/EOF hung libdxfrw (libdxfrw#7). Treat EOF as closing any open section.
- Header-less DXF files (no `$ACADVER`, no handles, e.g. from Maker.js) open in TrueView (libredwg#474, REPORTED). When `$ACADVER` is missing, treat the version as "unknown", not R2007, and do not require handles (LibreCAD#2798).
- The last group pair may have no trailing newline (`0\nEOF`). LibreDWG lost the pair (libredwg#474, fixed in #1366).
- A macOS "rtfd" bundle prefix of 16 KB before `0 SECTION` has been seen (netDxf#307). An optional heuristic: skip forward to the first `  0\nSECTION`.
- Blank lines: an empty value line is legal. Real files also contain broken strings that span two lines (LibreCAD#1075). Parse strictly by pairs. Do not strip empty lines.
- Leading spaces in **string values** are significant, e.g. MTEXT continuation chunks (libredwg#1285). Trim only group-code lines and numeric values.
- R12 `$EXTMIN`/`$EXTMAX` without `30` (a 2D point): the reader must not swallow the next `9`/`0` (ACadSharp#1143).
- Group codes 482–998 are unassigned. Map each group-code range once, from a single table (LibreCAD#2798).
- Binary DXF: unknown group codes cannot be skipped because value lengths are unknown (netDxf#127). A binary AC1009 reader ran past EOF (ACadSharp#421).
- Files without any 100 subclass markers, even R2000+ ones (SysCAD), exist. Readers that dispatch on markers break (ACadSharp#131). R12 DIMENSION has no subclass, and the type (70) may come before or after its points. Group-order independence is required (ACadSharp#1246).
- Duplicate table entries (two layers with the same name, no layer "0") occur. Keep the first, create defaults afterwards (ACadSharp#1239, #1258). Missing layers that entities reference: **AutoCAD creates them on the fly**, as RECOVER does (ACadSharp#1244, REPORTED).
- Table names are case-insensitive (netDxf#479; ACadSharp#1197; `*Paper_Space` vs `*PAPER_SPACE`).
- AC1009 table headers: ACadSharp created an "unnamed0" entry per table, mistaking the TABLE header's `2`/`70` for a record (ACadSharp#1109).
- **AutoCAD's DXF reader is strict and ordered.** BricsCAD, ODA, ezdxf and ACadSharp skip unknown or out-of-order codes, so a file can open everywhere except in AutoCAD (ACadSharp#1253). One error usually discards the whole drawing (`Invalid or incomplete DXF input -- drawing discarded.`); an error in CLASSES can leave the drawing empty (ACadSharp#1253). Such files have no AutoCAD reference. The messages are catalogued in §2.
- AutoCAD silently accepts the undocumented codes `61` and `63` in AcDbEntity, but an invented code such as `5005` makes it reject the file (libredwg#290 VERIFIED-BY-ACAD; netDxf#127 REPORTED). A group code in the wrong subclass fails too: ATTRIB `74` outside `AcDbAttribute` gives `Unexpected DXF group code: 74` (libredwg#275, VERIFIED-BY-ACAD); TEXT `7` in `AcDbEntity` instead of `AcDbText` (libredwg#275, REPORTED by mozman).
- Unknown header variables only produce a warning: `Unknown header variable $DIMSAV ignored on line 200.` (libredwg#275), one warning per unknown newer variable in AutoCAD 2000 (netDxf#92, #109). VERIFIED-BY-ACAD.
- Table `70` (entry count) is advisory. For more than 32767 entries AutoCAD itself writes the wrapped Int16 (`-24493` for 41043 block records), and 0 also opens (ACadSharp#1192, VERIFIED-BY-ACAD). ODA does check VPORT counts (libredwg#1091, REPORTED/ODA).
- A 102 `{`/`}` mismatch in a table header was tolerated by AutoCAD (netDxf#220, VERIFIED-BY-ACAD); QCAD and CADDirect failed on it. An **empty value** after 330 was tolerated too, but AUDIT flags it (netDxf#221).
- Line ends: AutoCAD writes CRLF. Files with a doubled CR (`\r\r\n`, from text-mode fopen on Windows) exist (libredwg#17).
- An empty line at a group-code position is broken (libredwg#1408). An empty *value* is fine: `4` + empty string in STYLE (LibreCAD#1075), `$DIMBLK / 1 / <empty>` (libredwg#1052).
- NUL bytes: libdxfrw's dwg2dxf wrote NULs into strings and AutoCAD refused the files (libdxfrw#19). LibreCAD's macOS `\U+` bug produced 12 trailing NULs per escape (LibreCAD#2816).
- A raw CR/LF inside a TEXT value → `DXF read error on line 1289. Invalid or incomplete DXF input` (netDxf#92, VERIFIED-BY-ACAD, Chinese UI). AutoCAD's own output caret-encodes C0 control characters and keeps a tab literal (libredwg#1314); a literal `^` is `^ ` (libredwg#283).
- Strings over 250 characters: MTEXT puts **250-character chunks in group 3 and the last chunk in group 1** (libredwg#986, #1284; ACadSharp#988 duplicated the text by also writing the full string to group 1). Chunks from other producers can split a `\U+XXXX` escape or a multi-byte character (libredwg#1314), so join before decoding. 3xx string fields such as GEODATA 301 continue with `dxf+2` (303), the way AutoCAD writes them (libredwg#1314, REPORTED).
- Binary chunks (310–319): hex, at most 127 bytes per line in AutoCAD's output. Other producers wrote longer lines (ACadSharp#1153), a last chunk padded with foreign bytes (ACadSharp#1140) and raw bytes (libredwg#1311).
- Group codes 280–289 are **Int16**, not bytes, in current references (ACadSharp#1051). 1070/1071 are **signed** (libredwg#1392).
- Doubles: AutoCAD prints `943.0`, other producers `943` (libredwg#1083). ACadSharp's old `G15` output changed 60–66 % of coordinates compared to a reference converter (ACadSharp#1179, REPORTED), so such files carry only 15 significant digits. With `NaN` anywhere, Autodesk products could not open the file (netDxf#202, REPORTED).
- INSERT `66 1` is followed by ATTRIBs and a SEQEND (libredwg#1351). `66` should be 0 or 1, but LibreDWG wrote 128 for pre-R13 sources (libredwg#1352). REPORTED.

---

## 4. Handles, owners, dictionaries, layouts

- AutoCAD's own DXF: VERTEX/SEQEND 330 → the POLYLINE, ATTRIB 330 → the INSERT (checked in `research/repos/ACadSharp/samples/sample_AC1018_ascii.dxf`: `VERTEX 5=423 330=422(POLYLINE)`, `ATTRIB 5=705 330=704`). **CONFLICT:** libredwg#1371 claims ATTRIB/VERTEX 330 points at the block record "as ezdxf and AutoCAD write DXF". The AutoCAD sample disproves that for VERTEX/ATTRIB.
- Root dictionary detection: the NOD usually has `330 0`. Some producers leave out 330 and write `280 0` (hard-owner flag) instead (ACadSharp#954). Use "first DICTIONARY in OBJECTS", then check that it holds `ACAD_GROUP`. Other readers find the NOD by position too (libredwg#536, #1413; REPORTED, ezdxf/ODA convention).
- SORTENTSTABLE: the `5` handles in its sort list alias real entity handles on purpose. Do not register them as object handles (libredwg#1320). `block_owner` is the BLOCK_RECORD, not the extension dictionary (libredwg#1320).
- Layout ↔ block: the BLOCK *entity* of the second and later paper spaces is named `*Paper_Space0`, `*Paper_Space1`, … while the BLOCK_RECORD may say `*Paper_Space` (libredwg#81). A LAYOUT must name an existing BLOCK_RECORD. Ezdxf could not open 365 of 445 LibreCAD saves because of dangling LAYOUT → BLOCK_RECORD links (LibreCAD#2927).
- R12 layout blocks are `$MODEL_SPACE` / `$PAPER_SPACE` (ezdxf writes `$Model_Space`). Normalize them (libredwg#1384).
- Duplicate or missing `*Model_Space`/`*Paper_Space` records are common in LibreDWG output (ACadSharp#1157/#1158). Resolve by handle and create a missing record.
- Dynamic blocks: anonymous `*U###` BLOCK_RECORDs; the name users see comes from AcDbBlockRepresentation/`ACAD_ENHANCEDBLOCK` data (netDxf#103, ACadSharp#723). Blocks named `*D`, `*T`, `*U`, `*X` are internal (netDxf#103).
- `ACAD_SORTENTS` draw order applies within one block record (ACadSharp#113, #695, #879).
- Groups: every GROUP member needs a reactor to the GROUP (LibreCAD#2922).
- Entities of `*Model_Space` and of the active `*Paper_Space` are in the ENTITIES section; paper-space ones carry `67 1` and 330 → the `*Paper_Space` BLOCK_RECORD. The other layouts' blocks (`*Paper_Space0`, …) keep their entities in BLOCKS. Otherwise AutoCAD warns `Entities not allowed in *Paper_Space block definition on line N.` (libredwg#275/#277, VERIFIED-BY-ACAD).
- Dangling references occur. ODA warns `Invalid owner Object` (libredwg#82). LibreCAD's reader rejected 1,481 of 1,483 corpus files once it required every 330/340/350/360 to resolve (LibreCAD#2855, #2927). netDxf's maintainer: "errors with handles in a DXF usually ends up in a total crash when loaded in AutoCad" (netDxf#219, #226).
- Duplicate handles: when a GROUP took handle 2, ezdxf could not resolve layout 'Model' (libredwg#1356, REPORTED/ezdxf).

---

## 5. Encoding and text escapes

- **AC1021+ DXF is UTF-8. AC1018 and older use the codepage named in `$DWGCODEPAGE`.** Characters the codepage cannot hold are written as `\U+XXXX` (ACadSharp#1092/#1259; libredwg#1212, #1322/#1375; LibreCAD#431). Writing UTF-8 bytes under an ANSI header gives mojibake in AutoCAD (ACadSharp#1092, REPORTED).
- `\U+XXXX` also appears **in R2007+ files**; AutoCAD and Revit write it (libredwg#1414). Always decode it, whatever the version. A `\U+` without digits made ezdxf raise (libredwg#1314). Be lenient.
- `\M+nXXYY` (MIF) is a double-byte character: n = 1..5 → codepages **932, 950, 949, 1361, 936** (libredwg#428). AC1018 files from Chinese AutoCAD store CJK as `\M+2A7DA…` (ACadSharp#574).
- `$DWGCODEPAGE` names seen in the wild: `ANSI_1252`, `ANSI_1250`, `ANSI_1251`, `ANSI_936`, `ANSI_932`, `ANSI_949`, `DOS850`, lower-case `ansi_1252` (corpus). Bogus names too: `kcs5601` (ACadSharp#1259, AutoCAD/ezdxf expect `ANSI_949`), `GB2312` (netDxf#21, ACadSharp#622). Map aliases case-insensitively and fall back to cp1252 with a warning. `.NET Encoding.GetEncoding(0)` silently returns UTF-8 (ACadSharp#1259).
- For R2007+, the maintainer claims AutoCAD ignores the declared `$DWGCODEPAGE` (netDxf#146, REPORTED). AutoCAD complains about `ANSI_1200` in files older than AC1021 (netDxf#146, REPORTED).
- R2007+ DWG stores header strings as UTF-16. When reading `$DWGCODEPAGE` from such a source, decode it first (libredwg#1285).
- Pre-R13 table names are also codepage-encoded. LibreCAD read GBK layer names as UTF-8 (LibreCAD#2810).
- GB18030 and other non-UTF-8 files carry no marker other than `$DWGCODEPAGE`. Some users transcode before loading (LibreCAD#1014).
- MTEXT `^J` inside text: netDxf maps it to `\P` (netDxf#65); `^I` is tab. AutoCAD's MTEXT also accepts `\P`. Plain TEXT cannot contain newlines (netDxf#472).
- A literal backslash in MTEXT must be `\\`. `\F` starts a font change (LibreCAD#1609).
- BOM: no thread reported a UTF-8 BOM. ACadSharp writes UTF-8 without BOM (ACadSharp#1098). ASSUMPTION: accept a BOM.

---

## 6. TEXT / MTEXT / ATTRIB / fonts

- TEXT `41` is the width factor, default 1.0; 0 is invalid (libredwg#275, mozman/rurban). A width factor on SHX/LFF fonts must also scale **arcs into ellipses**; LibreCAD distorted glyphs (LibreCAD#1806).
- TEXT `71` generation flags: 2 = backward (mirrored in X), 4 = upside down (LibreCAD#813). Samples are in the corpus.
- TEXT alignment: with 72/73 ≠ 0, the `11` alignment point is the anchor. KiCad writes TEXT with style `KICAD` and 11/21 equal to 10/20 (LibreCAD#363). eDrawings ignores TEXT alignment and draws at the base point; MTEXT behaves better across viewers (netDxf#262, VERIFIED-BY-ACAD: TrueView was correct).
- netDxf#67: ATTRIB with 72 = 0 / 74 = 2 displayed as **MiddleCenter** in AutoCAD (Map 3D file with missing plugins). Unexplained (REPORTED, UNKNOWN).
- MTEXT rotation: group `50` (degrees) is a documented alternative to the `11` x-axis direction. Both appear; DWG stores only the direction (libredwg#1379, ACadSharp#81). ezdxf's dimension renderer writes 50.
- MTEXT 72 (flow direction), 73 (line-spacing style) and 44 (factor) are **omitted when default**. The defaults are 1 / 1 / 1.0, not 0. Importing 0 stacks every line on top of the first (libredwg#1404).
- MTEXT R2007+ extras: 46 defined height, background fill 90/63/45/441 (45, 90 and 63 go together) plus 421 true color and 431 color name (libdxfrw#101). Dynamic columns: ACadSharp mis-wrote the column-height count and AutoCAD refused the file (DWG; ACadSharp#1188). MTEXT column data in DXF goes through `ACAD_MTEXT_COLUMN_INFO` XDATA in some versions (libdxfrw#101).
- R2018 DWG MTEXT extents 42/43 were decoded swapped (libredwg#1278). If reading from DWG, check them.
- Multiline ATTDEF/ATTRIB (R2018): embedded MTEXT (`AcDbMTextObjectEmbedded`); code 41 serves as both width factor and rectangle width, which makes naive readers produce stray lines and moved objects (netDxf#291, #164).
- ATTDEF tags may contain spaces; AutoCAD keeps them though its UI forbids them (netDxf#114).
- TEXT longer than 256 characters is allowed in AutoCAD (ACadSharp#1045, REPORTED).
- Entity `7` is a **style name**; the font comes from the STYLE record (`3` font file, `4` bigfont). LibreCAD used the style name as a font name (LibreCAD#841).
- STYLE font file `txt` **without extension** is common (the AutoCAD STANDARD style) and implies `txt.shx` (netDxf#227, #235, #40). Font names can be wrapped in quotes (netDxf#224).
- A shape-file STYLE has an **empty name** with flag 1. AutoCAD refused a made-up name such as `SHAPE$0$REF` (`Invalid textstyle name for shapeFile`, libredwg#287, VERIFIED-BY-ACAD).
- CJK TEXT in pre-2007 files shows as `???` unless the STYLE uses a bigfont (e.g. `romans.shx` + `chineset.shx`) (ACadSharp#432, REPORTED, Autodesk KB cited). MTEXT with `\f` TTF codes works.
- Fonts cannot be embedded in DXF (netDxf#260). SHX files contain information beyond the SHP source (netDxf#229).
- Annotative objects: XDATA `AcadAnnotative` + extension dictionary → `AcDbContextDataManager` → `ACDB_ANNOTATIONSCALES` → one `ACDB_*OBJECTCONTEXTDATA_CLASS` per scale (libredwg#1424). One drawing opened "with every annotation at one scale" when these were left out.

---

## 7. HATCH

- **The pattern definition lines stored in the HATCH (53/43/44/45/46/79/49) are already scaled and rotated. AutoCAD draws those cached lines.** It re-derives them from the pattern name + 41 scale + 52 angle only when the hatch is edited. ZWCAD showed a wrong pattern until the scale was changed and changed back (ACadSharp#782). AutoCAD showed a result that matched the stored values, and a regen after an edit changed it (libredwg#648). REPORTED. Renderer: use the stored lines.
- Solid hatch: `2 SOLID`, `70 1`, no pattern lines. AutoCAD's DXFOUT writes `47` (pixel size) exactly on the hatches with a derived boundary path (92 bit 4) (ACadSharp#1253).
- Edge data: arcs are center / radius / start / end in **degrees** + 73 ccw flag. Hatch arcs and polyline bulges keep their vertex order, which is why a ccw flag exists here while ARC entities are always ccw (libdxfrw#69). Ellipse edge: `11/21` is the major-axis endpoint **relative to the center**, `40` the minor/major ratio (ACadSharp#1099, #1018). Spline edges need a knot vector with knots = controls + degree + 1 (LibreCAD#2798). A full circle edge is 0/360: TrueView did not show a hatch whose 360 was written as 0, and radians produced spiky boundaries (ACadSharp#1002, #1025, VERIFIED-BY-ACAD). Full sweeps also appear as `-180..180` (ACadSharp#1237).
- Y = 0.0 is a valid coordinate. LibreDWG refused `21 0.0` on line edges (libredwg#1410).
- Loops: each loop's edges are one path. LibreCAD wrote **one loop whose edges formed two disjoint rectangles**. TrueView and the Autodesk viewer drew it wrong, while LibreCAD's own reconstruction looked fine (LibreCAD#1739, VERIFIED-BY-ACAD). Match AutoCAD by treating edges strictly as a sequential path.
- AutoCAD writes each boundary loop with its source handles (97/330) inside the loop (libredwg#280).
- A HATCH with 0 paths (91 = 0) was only seen in corrupt conversions (libredwg#1220).
- An associative HATCH (71 = 1) whose 330 boundary handle names a missing entity is repaired by AUDIT (`AcDbHatch(…) Boundary Undefined  Remove Associativity`) (ACadSharp#1209, VERIFIED-BY-ACAD on a DWG; the DXF equivalent is an ASSUMPTION).
- Nested and island loops, with even-odd rules decided by 75 hatch style; area computation is covered in LibreCAD#1572/#1659 (LibreCAD-internal, REPORTED).
- LibreCAD patterns are DXF blocks, not `.pat` files; some gost_* patterns do not tile seamlessly (LibreCAD#1648, #1651). Irrelevant to AutoCAD, except that LibreCAD-written HATCH pattern lines may not match `acad.pat`.

---

## 8. Dimensions and DIMSTYLE

- **A DIMENSION without its `*D` block (no `2`, or a dangling one) is regenerated by AutoCAD on load in model and paper space. Inside a user block it is not, except for `Angular3PointDimension`** (netDxf#98, maintainer testing in AutoCAD, VERIFIED-BY-ACAD). ACadSharp users found the same: a dimension created without an anonymous block is visible, and one cloned with a stale block reference is invisible (ACadSharp#556). Renderer: draw the `*D` block when present. When absent, generating the geometry ourselves matches AutoCAD only outside blocks.
- Dimensions in blocks: AutoCAD does not translate the `*D` block content into block-local coordinates the way it does other entities, and dimension drawings become "weird" (netDxf#98, REPORTED). The measured value is **not** scaled by the INSERT scale (LibreCAD#1092 expectation; ASSUMPTION about AutoCAD).
- Text override `1`: `""` or `"<>"` = measurement; `" "` (a single space) = suppressed; anything else is drawn with `<>` replaced by the formatted measurement (ACadSharp#151, #959). An explicit text ignores prefix/suffix/tolerance (REPORTED by a user testing AutoCAD).
- DIMPOST (`3`): the text `<>` on its own **suppresses the automatic `R`/`Ø` prefix** of radial and diameter dimensions. Leave DIMPOST empty (netDxf#97, VERIFIED-BY-ACAD 2012/2016; ACadSharp#1165: AutoCAD's default DIMPOST/DIMAPOST is empty).
- Per-dimension overrides are stored as XDATA `1001 ACAD / 1000 DSTYLE / 1002 { / 1070 <dimvar group code> / value … / 1002 }`. For example, DIMSCALE is `1070 40 / 1040 5.0` (ACadSharp#923). Handle-valued overrides (DIMBLK1/2 = 343/344, DIMLDRBLK) use `1005 <handle>`; DIMSAH is `1070 173 / 1070 1` (libredwg#663).
- DIMSTYLE handle fields: 340 DIMTXSTY, 341 DIMLDRBLK, 342–344 DIMBLK/1/2, **345/346/347 DIMLTYPE / DIMLTEX1 / DIMLTEX2** (LibreCAD#2928). LibreCAD's own DSTYLE override writer used 347/348 instead (LibreCAD-specific, REPORTED).
- DIMSTYLE `340` (DIMTXSTY) is a **handle**, but LibreCAD wrote a style name (`340 Standard`). netDxf's maintainer reports that AutoCAD crashes on such files (netDxf#105, #228; ACadSharp#120; fixed in LibreCAD#1551). REPORTED.
- If the header `$DIM*` variables differ from the current DIMSTYLE, AutoCAD lists a `<style overrides>` entry. netDxf writes every `$DIM*` variable to avoid that (netDxf#417, REPORTED).
- LEADER with fewer than 2 vertices: `Leader entity with no vertices` → drawing discarded (LibreCAD#875, VERIFIED-BY-ACAD). libdxfrw wrote `76` twice (libdxfrw#60).
- DIMSTYLE records that leave out a code: ODA takes the value from the header `$DIM*` variable (e.g. DIMZIN, DIMTDEC), not from a hard-coded default (ACadSharp#1251, REPORTED/ODA). AutoCAD's behaviour is **UNKNOWN / needs AutoCAD test**.
- Dimension defaults drift between versions. netDxf had DIMDEC 2 where AutoCAD LT used 4, and text placement "Above/Centered" (netDxf#40, REPORTED).
- DIMENSION 70: 0–6 type + 32 (block used by this dimension only, always set R13+) + 64 (ordinate X) + 128 (user text position) (ACadSharp#236). Pre-R13 DIMENSION: 13/23/33, 14/24/34 def points; 15/25/35 radius/diameter point; 16/26/36 angular arc point; no subclass markers (ACadSharp#1246).
- Radial/diameter/linear `12` insertion point exists (ACadSharp#1236).
- Arrowhead blocks are named `_Dot`, `_Oblique`, … and referenced by handle from DIMSTYLE or XDATA (libredwg#663). An empty DIMBLK means the closed-filled default.
- Tolerance display: a symmetrical display with different upper/lower values loads back as Deviation (netDxf#120, REPORTED). DIMTIH/DIMTOH round-trip (netDxf#249).
- LibreCAD's dimension text in cm drawings: DIMLFAC/unit confusion (LibreCAD#2182/#2187). PersonalDesigner dimensions were stored twice, as entities and in blocks (LibreCAD#701).
- TOLERANCE entity string: fields separated by `%%v`; SolidWorks/QCAD files carry more than the documented 5 fields and a trailing `^J` (netDxf#426).

---

## 9. Curves, polylines, splines, OCS

- **SPLINE geometry is exactly the curve of its control points, weights and knots over `[k_degree, k_count]`, whatever the 70 closed (1) / periodic (2) flags say.** AutoCAD writes closed and periodic splines with a **clamped** knot vector and the last control point equal to the first (LibreCAD#2910). LibreCAD wrote "closed" splines as open control polygons with only the flag set, and the Autodesk viewer drew them **open** (LibreCAD#1598, VERIFIED-BY-ACAD). A file flagged closed whose control points form an open curve drew as the curve the data describes in the Autodesk viewer (LibreCAD#1712, VERIFIED-BY-ACAD).
- SPLINE weights (41) are optional, default 1 (netDxf#441). A fit-point-only spline (`70 0, 71 3, 72 0, 73 0, 74 n` + 11 groups, as ezdxf writes) is valid; AutoCAD computes the curve (libredwg#1374; ACadSharp#1190). Flag 70 has no "fit vs control" bit (libredwg#1374). A SPLINE without knots (`No knots provided`, ACadSharp#1093) or with neither control points nor fit points (ACadSharp#1190) is refused (VERIFIED-BY-ACAD). Zero-vector start/end tangents were reported as refused (libredwg#275 via ezdxf#252), but AutoCAD 2027 opens such splines and ignores the tangents (VERIFIED-BY-ACAD, `splines/fit-zero-tangents`, Q-0174).
- ELLIPSE: `40` ≤ 1 (AutoCAD refuses > 1 with `Invalid data for ellipse definition`, netDxf#277, VERIFIED-BY-ACAD). `41/42` parameters are radians; the full ellipse is 0..2π. A float end parameter `6.2831855` (> 2π) made LibreCAD draw a tiny arc (LibreCAD#831). Normalise spans ≥ 2π to a full ellipse (ASSUMPTION about AutoCAD). netDxf's MajorAxis/MinorAxis are full diameters, not semi-axes (netDxf#455).
- ARC/CIRCLE: angles and centre are in **OCS**. Extrusion `(0,0,-1)` is common (Fusion 360, Onshape, mirrored geometry). In WCS the arc looks mirrored and start/end swap orientation (LibreCAD PR#430, #1237; netDxf#292; ACadSharp#846, #858). Transform with the arbitrary axis algorithm; non-Z extrusion turns circles into ellipses in plan view (LibreCAD#1237). Radius 0 circles and arcs exist in real files (ACadSharp#873).
- LWPOLYLINE: the bulge belongs to the **start vertex** of the segment (netDxf#437). 70 bit 128 = linetype generation; 43 = constant width. LibreDWG lost both, and LibreCAD lost polyline width on re-save (libredwg#40, LibreCAD#747).
- POLYLINE (old style): R12 VERTEX has no subclass. 10/20/30 on the POLYLINE header are the elevation "dummy point" (ACadSharp#845). 70 bit 16 = polygon mesh, bit 64 = polyface. netDxf treated meshes as 2D polylines (netDxf#359). A polyline with one vertex hung TrueView after netDxf wrote it (netDxf#369, REPORTED).
- Polyface mesh face records hold 4 vertex indices; a negative index marks an invisible edge. Vertices come before faces (ACadSharp#1190, #794).
- UCS header variables (`$UCSORG/$UCSXDIR`) are informational; entity coordinates never depend on them (netDxf#19).
- R12 PUCSXDIR/PUCSYDIR of (0,0,0) are invalid in AutoCAD (libredwg#1100, REPORTED).
- INSERT `43` (Z scale) defaults to 1 when absent. KiCad omits it. LibreCAD then wrote `43 0`, which LaserCut and FreeCAD reject (LibreCAD#971, #1428; fixed in LibreCAD#2756). MINSERT 70/71 are omitted when 1 (libredwg#1385).
- MLINE: an odd number of elements is legal. Arc end caps: the start cap may be split-coloured, the end cap always uses the second element's colour and linetype. A user reported that the fix matched AutoCAD exactly (netDxf#93, REPORTED).

---

## 10. Colours, linetypes, lineweights, visibility

- Valid **lineweight** values (370) are only `-3,-2,-1,0,5,9,13,15,18,20,25,30,35,40,50,53,60,70,80,90,100,106,120,140,158,200,211`. Autodesk products are picky, and DWG enum indices must be mapped to these (libredwg#275, #79, REPORTED by mozman; libredwg's lineweights.dxf failed until fixed).
- **ACI → RGB is not a single table.** In AutoCAD the palette shown depends on the UI background: index 99 is `RGB(38,76,38)` on black and `RGB(19,38,19)` on white in the colour picker. **PDF export always gave `RGB(57,114,57)`** (netDxf#175, maintainer, VERIFIED-BY-ACAD by observation). The standard table can be computed HSV-style except for indices 1–9 (netDxf#175, vsheveliov, tested against the AutoCAD .NET API). Earlier netDxf table disagreements are in netDxf#204. PLOT output colours for ACI must be measured (§ Test ideas).
- True color `420` = 0x00RRGGBB. In DWG CMC the bytes are BGR (ACadSharp#327, #850). CMC method byte: 0xC0 = ByLayer (`0xC0000000`), 0xC8 = "none" (ACI 257) (ACadSharp#656, #1187).
- A negative layer colour `62` means **layer off**. LibreDWG wrote every layer negative, so all layers came out off (libredwg#1283).
- Entity `60 1` (invisible) is independent of layer freeze. LibreCAD 2.2.1 wrote `60 1` for entities on frozen layers (LibreCAD#2913/#2920/#2936). Honour 60 exactly as stored.
- ByBlock: children with ByBlock colour take the **INSERT's** colour; an INSERT on ByLayer passes its layer's colour (LibreCAD#2522/#2661).
- Defpoints layer: never plotted (ACadSharp#760).
- Complex linetypes: shape segments need the SHX file (netDxf#229, #317). Segment scale 0 or negative is accepted by AutoCAD (netDxf#59, #163, REPORTED). Absolute rotation in `.lin` is `A=`, not `Q=` (netDxf#250). Text segments may contain commas inside quotes (netDxf#210). netDxf lost the linetype description (3) on save (netDxf#337).
- Linetype dash scale must be the same on straight lines and circles. LibreCAD used different scales (LibreCAD#2515, #1657); AutoCAD generates dashes along the true curve length (ASSUMPTION).
- Linetype names: LibreCAD silently maps `HIDDEN*` → `DASHED*` and `PHANTOM*` → `CONTINUOUS` on round trip (LibreCAD#2813, #2822). Do not trust linetype names from LibreCAD files as the author's intent.
- PSLTSCALE: header variable plus LAYOUT 70 bit 1 (netDxf#126).
- "Circles become octagons in AutoCAD" for a LibreCAD DXF (LibreCAD#807) was never resolved. ASSUMPTION: display resolution (VIEWRES / VPORT circle zoom), not geometry. Plots use true curves.

---

## 11. Viewports, layouts, plotting

- VIEWPORT `68` (status) and `69` (id) are **not stored in DWG** and are derived on DXF export. ODA numbers each layout's viewports 1..N, and 68 is a stacking order (0 = off), not a boolean. LibreDWG wrote 68 = 0 for 6825 of 13941 viewports, so four of five sheets rendered blank in consumers that honour 68 (libredwg#1406, #1213). Viewports in ordinary blocks: ODA writes `69 -1` and no 68 (libredwg#1406). Renderer: skip viewports with 68 = 0; treat id 1 (the first, overall paper-space viewport) as the sheet, not a view into model space.
- VIEWPORT frozen layers are group **331** (soft pointer). LibreDWG wrote 341, which conformant readers ignore (libredwg#1296).
- The overall paper-space viewport (id 1) is needed to define per-layout frozen layers. netDxf dropped it once, and DraftSight then hid added viewports (netDxf#125).
- Missing `$TILEMODE` → the file opens in paper space (ACadSharp#1188, VERIFIED-BY-ACAD).
- A generated DWG displayed black until ZOOM EXTENTS; the VPORT `*Active` view centre/height were not set (ACadSharp#1102). For plotting, the LAYOUT/PLOTSETTINGS plot area matters; see the viewport notes elsewhere.
- PLOTSETTINGS and page setups are lost by libraries that do not model them (netDxf#43, #435). Page-setup lists live in `ACAD_PLOTSETTINGS`.
- TABLE entities: **AutoCAD shows the cached `*T` anonymous block on open, and recomputes from TABLECONTENT/CELLSTYLE only on REGEN** (ACadSharp#1089, VERIFIED-BY-ACAD). The block is the drawn table. ACadSharp's "table dropped" round trip lost 165,565 of 165,566 ink pixels in an AutoCAD plot (ACadSharp#1217).

---

## 12. XDATA, proxies, custom objects, images

- XDATA: each `1001` starts a new application group, and one object may hold several. LibreDWG merged them, which destroyed `AcadAnnotative` data that follows `ACAD` (libredwg#1422). Every `1001` name must exist in the APPID table; ACadSharp refuses to write otherwise (ACadSharp#534). The `ACAD` APPID is not always at handle 12 (ezdxf puts it at 2A). Otherwise ODA audits the data into `$TD_AUDIT_GENERATED_(12)` and loses DSTYLE overrides (libredwg#1423).
- The XDATA limit is 16383 bytes per object; XDLIST reports "16383 bytes of Xdata space available" (netDxf#458). A 1071 outside XDATA is ignored by netDxf.
- `1005` XDATA handles link objects, e.g. MTEXT column links (LibreCAD#2927). R12 XDATA repeats Y and Z after a point's Z (`ACAD_MATERIAL_MAPPER`, `ASC_SEEDPOINT`) (LibreCAD#2855).
- XRECORD data may contain 102 values such as `{ATTRRECORD … ATTRRECORD}` (LibreCAD#2855).
- Proxy graphics (310 chunks, proxy entity "graphic" data) share one format: size, count, then records with type ids 2 circle, 6 polyline, 29 transform, 38 text, 31 empty (see ODA spec p. 270) (ACadSharp#727). Needed to render ACM BOM, AEC, Tangent and other vertical-app objects. MESH written without its class appears as `ACAD_PROXY_ENTITY` (ACadSharp#1038).
- Images: the file path in IMAGEDEF is resolved relative to the drawing. Missing files should not abort loading (netDxf#349, #130; LibreCAD#1589, #1715).
- IMAGE clip: AutoCAD always writes `280 0, 71 1, 91 2`, `(-0.5,-0.5)` and `(w-0.5, h-0.5)` for an unclipped image. An IMAGE/WIPEOUT with `91 0` is refused (`in IMAGE ... Xdata wasn't read`) (ACadSharp#1219, VERIFIED-BY-ACAD). For WIPEOUT, AutoCAD writes 340/360 as null (ACadSharp#1188).
- IMAGE bookkeeping: without `ACAD_IMAGE_DICT` in the NOD, TrueView shows no image (ACadSharp#1124). Without IMAGEDEF_REACTORs the image shows as "Not referenced" in the XREF manager (ACadSharp#591, #905, REPORTED). An IMAGE class instance count of 0 while images exist made images sometimes not show in TrueView (ACadSharp#1127, REPORTED).
- OLE2FRAME: 310 data; one OLE2FRAME without payload discarded ACadSharp's whole document (ACadSharp#1233).

---

## 13. Producer quirks (who writes what)

| Producer | Quirk | Source |
|---|---|---|
| **LibreCAD / libdxfrw** | DIMSTYLE `340 Standard` (name, not handle); `341` empty | netDxf#105, #228, #235; ACadSharp#120; LibreCAD#2855 |
| | STANDARD STYLE font `txt` without extension | netDxf#235 |
| | Layer plot-style handle to a missing object → COPYCLIP fails | LibreCAD#442, libdxfrw#19 |
| | `$HANDSEED` fixed at 20000 → AutoCAD refuses large files | libdxfrw#19 |
| | PLOTSETTINGS without `AcDbPlotSettings` (2.2 master, 2020) | LibreCAD#1276/#1330 |
| | LEADER with 0 vertices, `76` written twice | LibreCAD#875, libdxfrw#60 |
| | INSERT `43 0` | LibreCAD#971, #1428 |
| | Closed SPLINE without wrapped control points | LibreCAD#1598 |
| | HATCH with disjoint edges in one loop | LibreCAD#1739 |
| | `*Paper_Space` ENDBLK owned by `1F` (Model_Space) | LibreCAD#2855 |
| | libdxfrw 0.5: `$PSVPSCALE = 4.94065645841e-324` (subnormal) | LibreCAD#2855 |
| | `$DWGCODEPAGE` always `ANSI_1252`, other characters as `\U+` | LibreCAD#431 |
| | `$MEASUREMENT` wrong for mm drawings | LibreCAD#636 |
| | Entities on frozen layers written with `60 1` | LibreCAD#2913/#2936 |
| | HIDDEN→DASHED, PHANTOM→CONTINUOUS | LibreCAD#2813/#2822 |
| | Exploded text: huge files | LibreCAD#1056 |
| | dwg2dxf: NUL characters in strings | libdxfrw#19 |
| **LibreDWG dwg2dxf** | X without Y, zero spline tangents, bad lineweights, unescaped `\r\n` in `$KEYWORDS` | libredwg#275 |
| | Duplicate handles (GROUP on handle 2), NOD not first, `*Paper_Space` duplicated | libredwg#1356, #1413; ACadSharp#1157 |
| | INSERT `66 1` without SEQEND; `66 128`; REPEAT/ENDREP/LOAD/JUMP as entities | libredwg#1351–#1354 |
| | Raw bytes in 310, `\U+` left unexpanded in R2007+, broken 250-char splitting | libredwg#1311, #1212, #986 |
| | VIEWPORT 341 instead of 331; 68/69 = 0; every layer 62 negative | libredwg#1296, #1406, #1283 |
| | Windows: `\r\r\n` line ends (old) | libredwg#17 |
| **ACadSharp DxfWriter** | CLASS 92/93, 91 in AC1015, HATCH 47, DIMSTYLE table w/o 71/340, ACAD_FIELDLIST as DICTIONARY, UTF-8 regardless of version, G15 doubles, radians in hatch arcs (all fixed or reported 2026) | ACadSharp#1253, #956, #1235, #1092, #1179, #1002 |
| **netDxf** | Writes `$INTERFEREOBJVS/VPVS` copied from source → COPYCLIP fails (fixed); writes R2007+ header variables into R2000 files | netDxf#147, #109 |
| **QCAD 3.2 (dxflib 3.1.5)** | ENDSEC missing | LibreCAD#404 |
| **Mentor PADS** | `999` comment at file start | LibreCAD#808 |
| **FiberSim** | `999` metadata inside SECTION headers (AC1009) | ACadSharp#950 |
| **SysCAD** | R2000+ DXF without subclass markers | ACadSharp#131 |
| **Old NC/CAM** | TABLE without TABLES section; AC1003 files; R12 `$EXTMIN` without Z | ACadSharp#1128, #1143; netDxf#357 |
| **KiCad** | TEXT style `KICAD`, INSERT without 43 | LibreCAD#363, #1428 |
| **Maker.js** | No `$ACADVER`, no handles; TrueView opens it | libredwg#474 |
| **Fusion 360 / Onshape** | R14 output (Fusion offers no other version); arcs with negative extrusion | netDxf#459; LibreCAD#1237 |
| **SolidWorks** | TOLERANCE strings with extra `%%v` fields | netDxf#426 |
| **OpenCascade** | Missing dimension linetype | netDxf#404 |
| **PDMS** | Nameless MLINESTYLE | netDxf#319, #22 |
| **Autodesk verticals (Map 3D, Mechanical, Plant, Civil 3D)** | Custom objects/classes, AcDs data, XRECORD with BLL; lost without plugins | netDxf#67; libredwg#289; ACadSharp#727 |
| **Tangent (天正)** | Custom proxy entities, CLASS descriptions in GBK | libredwg#143; ACadSharp#1131 |
| **ODA-based (ARES, BricsCAD audit, Teigha)** | Stricter than AutoCAD on casts, owners and CTABLESTYLE; images "unreferenced" | ACadSharp#702, #905, #1235 |
| **Consumers**: eDrawings (ignores TEXT alignment), Rhino (dimension text upside down), Trumpf TruTops, LaserCut, LaserWorks (fragile) | | netDxf#262, #412, #122, #254; LibreCAD#971, #1970 |

---

## 14. Version differences worth encoding

- AC1009 (R12): no BLOCK_RECORD table in DXF; the header needs `$TEXTSTYLE, $CLAYER, $CELTYPE, $DIMSTYLE`; `$MODEL_SPACE`/`$PAPER_SPACE` blocks and the VPORT table are expected (libredwg#1100, ODA-checked). No subclass markers anywhere; handles optional. ATTRIB/VERTEX/DIMENSION use flat group lists (ACadSharp#845, #1246).
- R13/R14 (AC1012/AC1014): subclass markers required (libredwg#90). R14 DXF has an empty CLASSES section (libredwg#1068). AutoCAD 2027 refuses ACadSharp's R14 DXF with `Premature end of object on line 2906.` (DIMSTYLE table header), then at `ACDBPLACEHOLDER` ("class separator expected"); the same drawing as AC1015–AC1032 opened with 0 audit errors. AutoCAD 2027 cannot save R14, so there is no reference file (ACadSharp#1220, VERIFIED-BY-ACAD).
- AC1015: no CLASS 91 (ACadSharp#956).
- AC1018: 91 allowed. The last codepage-encoded version.
- AC1021 (R2007): UTF-8; `$INTERFERE*` header variables; MTEXT background/46; MULTILEADER exists from 2008. ACadSharp skips it below R2010: its R2000/R2004 output with MULTILEADER was refused (ACadSharp#1190, VERIFIED-BY-ACAD).
- AC1024+: `$DIMTXTDIRECTION` (R2010); underlay inverted clip only R2010+ (LibreCAD#2798).
- AC1032 (R2018): ATTRIB with embedded MTEXT (multiline attributes).

---

## 15. Rendering vs AutoCAD (for the pixel-exact renderer)

1. **Dimensions:** draw the `*D` block. Regenerate only when it is missing and the dimension is not inside a user block (netDxf#98). Measured values in blocks are not scaled by INSERT scale (ASSUMPTION).
2. **Tables:** draw the `*T` block (what AutoCAD shows until REGEN, ACadSharp#1089).
3. **Hatch patterns:** draw the stored pattern lines; never regenerate from name + scale (ACadSharp#782, libredwg#648). Loops are sequential paths (LibreCAD#1739).
4. **Splines:** evaluate the stored data as written; ignore the closed/periodic flags (LibreCAD#2910, #1598, #1712).
5. **INSERT scale:** already contains any INSUNITS conversion applied at insert time. Do not apply INSUNITS again (netDxf#301, #166: INSUNITS only matters when inserting a drawing into another).
6. **OCS:** apply the arbitrary axis algorithm to ARC/CIRCLE/TEXT/INSERT/LWPOLYLINE/HATCH (LibreCAD#1237, netDxf#171 TEXT with normal (0,-1,0)).
7. **ACI colours:** plot/PDF colours differ from on-screen colours (netDxf#175). Calibrate against real AutoCAD PLOT output.
8. **Visibility:** `60`, layer off (negative 62), frozen, Defpoints (never plots) and layer plot flag 290 are separate switches (LibreCAD#2920, ACadSharp#760, libredwg#1283).
9. **ByBlock:** comes from the INSERT's resolved properties (LibreCAD#2661).
10. **Text:** a width factor scales SHX arcs into ellipses (LibreCAD#1806). Missing fonts are substituted; LibreCAD falls back to "standard", which lacks Cyrillic (LibreCAD#850). MTEXT kerning on spaces and punctuation differs from TEXT in LibreCAD (LibreCAD#1845). Middle/centre TEXT alignment: LibreCAD moved to glyph-bound centring (LibreCAD#2903); AutoCAD behaviour **UNKNOWN / needs AutoCAD test**.
11. **Viewports:** honour 68 = 0 (off) and the per-layout id 1 (the sheet) (libredwg#1406). Frozen layers per viewport via 331.
12. **Annotative objects:** pick the context-data representation for the current annotation scale (libredwg#1424).
13. **MLINE caps:** follow the colouring rule in netDxf#93.
14. **Lineweights:** LWDISPLAY affects the screen only; plots always use lineweights (ASSUMPTION, LibreCAD#801 context).
15. **Circles and curves:** AutoCAD on-screen tessellation depends on VIEWRES (LibreCAD#807). Plots should be true curves (ASSUMPTION, test).

---

## 16. Open conflicts

- **Sub-entity owner (330 of ATTRIB/VERTEX/SEQEND):** AutoCAD's DXF points at the parent entity (ACadSharp sample file) vs libredwg#1371's claim of the block record.
- **Table entry count > 32767:** AutoCAD writes the wrapped negative value (ACadSharp#1192, measured), while the maintainer prefers 0. Both open.
- **AC1014 DXF:** refused by AutoCAD 2027 (ACadSharp#1220, measured) vs "older AutoCAD accepts it" (maintainer).
- **ACI 99:** `(19,38,19)` in AutoCAD 2018 (netDxf#204) vs `(38,76,38)` on a black background vs `(57,114,57)` in PDF (netDxf#175).

---

## 17. Notable sample files

Paths are relative to `samples/external/`. "AutoCAD-like" is the manifest's producer heuristic.

| Corpus path | Thread | What it exercises |
|---|---|---|
| `files/github/DomCR__ACadSharp/issue-956/24717944_WriteDXF_AcadSharp_extracted/WriteDXF_AcadSharp_AC1015.dxf` | ACadSharp#956 | **AutoCAD refuses**: CLASS 91 in AC1015 ("was-a-zombie-flag") |
| `files/github/DomCR__ACadSharp/issue-956/24717944_WriteDXF_AcadSharp_extracted/WriteDXF_AcadSharp_AC1018.dxf` | ACadSharp#956 | Same drawing as AC1018, which opens: minimal ACadSharp output |
| `files/github/DomCR__ACadSharp/issue-1058/27302805_test-dxf_extracted/test-acadsharp.dxf` | ACadSharp#1058 | Opens in AutoCAD, but COPYCLIP fails (POLYLINE 3D) |
| `files/github/DomCR__ACadSharp/issue-1058/27302805_test-dxf_extracted/test-netdxf.dxf` | ACadSharp#1058 | Same geometry from netDxf; COPYCLIP works (A/B pair) |
| `files/github/DomCR__ACadSharp/issue-1025/26562374_Hatch_extracted/Hatch.dxf` | ACadSharp#1025 | AutoCAD-like HATCH with a 0..360° arc edge |
| `files/github/DomCR__ACadSharp/issue-1009/26186059_Bar_extracted/Bar.dxf` | ACadSharp#1009 | AutoCAD polyface mesh (POLYLINE/VERTEX), reference for vertex/face order |
| `files/github/DomCR__ACadSharp/issue-916/24094156_asdf.dxf` | ACadSharp#916 | AC1018 polyface mesh, 340 vertices, face indices |
| `files/github/DomCR__ACadSharp/issue-1124/29367465_acadsharp_image_bug_extracted/acadsharp_image_bug/sample_3.4.9.dxf` | ACadSharp#1124 | IMAGE with ACAD_IMAGE_DICT (shows in TrueView) |
| `files/github/DomCR__ACadSharp/issue-1124/29367465_acadsharp_image_bug_extracted/acadsharp_image_bug/sample_3.6.29.dxf` | ACadSharp#1124 | Same without ACAD_IMAGE_DICT (image missing in TrueView) |
| `files/github/DomCR__ACadSharp/issue-1127/29378659_image_bug_extracted/acadsharp_image_bug/image_3.6.35.dxf` | ACadSharp#1127 | IMAGE class instance count 0 |
| `files/github/DomCR__ACadSharp/issue-591/21346575_Image_Dxf_Dwg_extracted/Image_Dxf_Dwg/DXF/OUTPUT_FILE(IMAGE).dxf` | ACadSharp#591 | Image "not referenced" (ARES/TrueView), lower-case `ansi_1252` |
| `files/github/DomCR__ACadSharp/issue-1246/31822169_r12_dimension_points_extracted/r12_dimension_points.dxf` | ACadSharp#1246 | 586-byte R12 DIMENSION (rotated + radial) with 13/14/15 points, no subclasses |
| `files/github/DomCR__ACadSharp/issue-1143/29879161_1204757_extracted/1204757.dxf` | ACadSharp#1143 | AC1003 (!) file, header points without Z |
| `files/github/DomCR__ACadSharp/issue-1109/28749040_Layer_extracted/Layer.dxf` | ACadSharp#1109 | AC1009 layer table, ByLayer colour resolution |
| `files/github/DomCR__ACadSharp/issue-968/25066492_777777_extracted/777777.dxf` | ACadSharp#968 | AC1009 blocks with entities, TEXT, VERTEX |
| `files/github/DomCR__ACadSharp/issue-954/24714805_Layouts_DXF_Files_extracted/KO_Layouts.dxf` | ACadSharp#954 | 7 MB AC1015, `DOS850` codepage, NOD without 330, layouts, 7904 SPLINEs |
| `files/github/DomCR__ACadSharp/issue-954/24714805_Layouts_DXF_Files_extracted/OK_Layouts.dxf` | ACadSharp#954 | Counterpart whose layouts read correctly |
| `files/github/DomCR__ACadSharp/issue-1020/26479192_demo_dxf_files_extracted/input.dxf` | ACadSharp#1020 | AC1032 `ANSI_936`, Layout1 entities, ATTRIB, 2 VIEWPORTs |
| `files/github/DomCR__ACadSharp/issue-1018/26443083_dxf_extracted/σ«ñσñûµÇ╗σ¢╛σ¥ù.dxf` | ACadSharp#1018 | AC1015 `ANSI_936`, hatch ellipse edges (filename is cp437 mojibake of a CJK name, as extracted) |
| `files/github/DomCR__ACadSharp/issue-345/15100188_test_file.dxf_extracted/test_file.dxf` | ACadSharp#345 | AC1027 `ANSI_1250`; a re-write crashed AutoCAD (layout bug) |
| `files/github/DomCR__ACadSharp/issue-873/23554697_ArcAndCircleZeroRadius.dxf` | ACadSharp#873 | QCAD CIRCLE/ARC with radius 0 |
| `files/github/DomCR__ACadSharp/issue-142/11728772_ALFA.Sportwagon-4.views_extracted/ALFA Sportwagon-4 views.dxf` | ACadSharp#142 | AC1014, 262 ARCs; rendering came out wrong until the file was converted |
| `files/github/DomCR__ACadSharp/issue-120/11162160_Circle_extracted/Circle.dxf` | ACadSharp#120 | LibreCAD DIMSTYLE `340 standard` |
| `files/github/DomCR__ACadSharp/discussion-302/14514833_DEFAULT_PROJECT0_Export_extracted/DEFAULT_PROJECT0_Export/mapLayers.dxf` | ACadSharp#302 | netDxf-written AC1032 HATCH with GradientColor APPIDs |
| `files/github/haplokuon__netDxf/issue-277/6349573_dxfs_extracted/defective.dxf` | netDxf#277 | **AutoCAD refuses**: ELLIPSE ratio > 1 |
| `files/github/haplokuon__netDxf/issue-277/6349573_dxfs_extracted/ok.dxf` | netDxf#277 | Same writer, a LINE only; opens (A/B pair) |
| `files/github/haplokuon__netDxf/issue-147/3941127_DXF_extracted/Test File_2007.dxf` | netDxf#147 | Inventor R2007 export with `$INTERFEREOBJVS` (COPYCLIP case) |
| `files/github/haplokuon__netDxf/issue-147/3941127_DXF_extracted/Test File_2000.dxf` | netDxf#147 | Same drawing, R2000 |
| `files/github/haplokuon__netDxf/issue-97/2996478_dimension.drawing_extracted/dimension drawing - original.dxf` | netDxf#97 | DIMSTYLE `3 <>` suppresses the R/Ø prefix (VERIFIED) |
| `files/github/haplokuon__netDxf/issue-97/2996478_dimension.drawing_extracted/dimension drawing - modified.dxf` | netDxf#97 | Fixed version (prefix shows) |
| `files/github/haplokuon__netDxf/issue-228/5462458_dxfs_extracted/Untitled3.dxf` | netDxf#228 | LibreCAD R2007 with `340 STANDARD`; reportedly crashes AutoCAD |
| `files/github/haplokuon__netDxf/issue-105/3134160_circle.dxf` | netDxf#105 | Minimal LibreCAD R2007 file with the same DIMSTYLE bug |
| `files/github/haplokuon__netDxf/issue-221/5389391_Utsattning.232_extracted/Utsättning 232.dxf` | netDxf#221 | Empty 330 values (AutoCAD tolerates them; audit error) |
| `files/github/haplokuon__netDxf/issue-227/5462419_Bulby-scott_extracted/Bulby-scott.dxf` | netDxf#227 | STANDARD style with font `txt` without extension |
| `files/github/haplokuon__netDxf/issue-292/6636009_Ver2_ARC_neg_NormalZ.dxf` | netDxf#292 | ARCs with extrusion (0,0,-1) |
| `files/github/haplokuon__netDxf/issue-292/6636010_Ver1_ARC_pos_NormalZ.dxf` | netDxf#292 | Same ARCs with +Z (A/B pair) |
| `files/github/haplokuon__netDxf/issue-274/6321901_invertedLeadersSample_extracted/invertedLeadersSample.dxf` | netDxf#274 | AC1032 `ANSI_932` LEADERs with horizontal direction (-1,0,0) |
| `files/github/haplokuon__netDxf/issue-426/10056986_toleranceError_extracted/toleranceError.dxf` | netDxf#426 | TOLERANCE with extra `%%v` fields and `^J` |
| `files/github/haplokuon__netDxf/issue-59/2352686_test2_extracted/test2.dxf` | netDxf#59 | **Binary DXF** AC1024, complex linetype with scale 0 |
| `files/github/haplokuon__netDxf/issue-59/2369304_test2_extracted/test2.dxf` | netDxf#59 | ASCII twin of the binary file (binary reader test pair) |
| `files/github/haplokuon__netDxf/issue-65/2471705_test_extracted/test.dxf` | netDxf#65 | MTEXT with `^J` |
| `files/github/haplokuon__netDxf/issue-291/6612262_DXFs_extracted/Pipe_RO_DrawingNo.505433-PS-01_Pipe 01_TT-TUBA-5352-5_20210521.dxf` | netDxf#291 | 14 MB AC1032 with multiline ATTDEFs, images; plus its broken re-save |
| `files/github/haplokuon__netDxf/issue-317/7136917_LineTypeRemovedFor_V-PROP-ASSESS_extracted/0910_029_org.dxf` | netDxf#317 | Civil drawing: complex linetype with shapes, layer states with bad handle, 5219 ATTRIBs |
| `files/github/haplokuon__netDxf/issue-319/7215918_equip3_extracted/equip3.dxf` | netDxf#319 | PDMS export, nameless MLINESTYLE |
| `files/github/haplokuon__netDxf/issue-439/11132898_LibreCAD_NetDxf_Issues_Docs_extracted/LibreCAD_NetDxf_Issues_Docs/closedSpline1.dxf` | netDxf#439 | LibreCAD closed spline; TrueView 2020 draws it like netDxf |
| `files/github/haplokuon__netDxf/issue-433/10705419_clip2_extracted/clip2.dxf` | netDxf#433 | AC1032 INSERT with XCLIP (spatial filter) |
| `files/github/haplokuon__netDxf/issue-467/12098574_0e_extracted/0e.dxf` | netDxf#467 | MTEXT line-spacing style value out of range |
| `files/github/haplokuon__netDxf/issue-40/2006208_ExampleDxfFiles_extracted/BlankWithStyle.dxf` | netDxf#40 | AutoCAD LT 2012 DIMSTYLE with non-default values (defaults reference) |
| `files/github/LibreCAD__LibreCAD/issue-875/886737_test_extracted/test.dxf` | LibreCAD#875 | **AutoCAD refuses**: "Leader entity with no vertices" |
| `files/github/LibreCAD__LibreCAD/issue-1330/6150438_Untitled_DXF_problem_extracted/Untitled_DXF_problem.dxf` | LibreCAD#1330 | **AutoCAD refuses**: PLOTSETTINGS class separator (R14) |
| `files/github/LibreCAD__LibreCAD/issue-1276/5178218_rect_R14_extracted/rect_R14.dxf` | LibreCAD#1276 | Minimal refused R14 file (one LWPOLYLINE) |
| `files/github/LibreCAD__LibreCAD/issue-1739/14314325_test_extracted/test.dxf` | LibreCAD#1739 | HATCH loop with disjoint edges; misrenders in TrueView |
| `files/github/LibreCAD__LibreCAD/issue-1598/11004931_drawing_spline_extracted/drawing_spline.dxf` | LibreCAD#1598 | Closed flag without wrapped control points; Autodesk draws it open |
| `files/github/LibreCAD__LibreCAD/pr-1712/13403914_open-circle-spline-defined-as-closed.dxf_extracted/open-circle-spline-defined-as-closed.dxf` | LibreCAD#1712 | Spline flagged closed; Autodesk viewer draws the data |
| `files/github/LibreCAD__LibreCAD/issue-813/461438_Example_DXF_extracted/Example_Project_Bot.dxf` | LibreCAD#813 | TEXT 71 = 2 (mirrored), R14 |
| `files/github/LibreCAD__LibreCAD/issue-831/536501_librecad_ellipse_arc_span_issue_illustration.dxf` | LibreCAD#831 | ELLIPSE end parameter 6.2831855 > 2π |
| `files/github/LibreCAD__LibreCAD/issue-1237/9864242_Onshape-DXF-test_extracted/Onshape-DXF-test-2018.dxf` | LibreCAD#1237 | Onshape: ELLIPSE/ARC/SPLINE with extrusion (also an R14 twin) |
| `files/github/LibreCAD__LibreCAD/issue-1237/4711341_2.dxf_extracted/2.dxf` | LibreCAD#1237 | Fusion 360 elevated ARCs |
| `files/github/LibreCAD__LibreCAD/issue-808/438635_Text_Edit_extracted/Text_Edit_Fail.dxf` | LibreCAD#808 | 181 bytes: Mentor PADS `999` comment breaks naive readers |
| `files/github/LibreCAD__LibreCAD/issue-1075/2918066_118419F1901.dxf_extracted/118419F1901.dxf` | LibreCAD#1075 | AC1009 with legitimately empty value lines |
| `files/github/LibreCAD__LibreCAD/issue-1075/2874430_WG32RBKF2000.dxf_extracted/WG32RBKF2000.dxf` | LibreCAD#1075 | Malformed multi-line strings (no $ACADVER) |
| `files/github/LibreCAD__LibreCAD/issue-1014/2395124_dxf_extracted/τö╖Θò┐Φúñ.dxf` | LibreCAD#1014 | AC1006 (!) GB18030 block names (filename mojibake as extracted) |
| `files/github/LibreCAD__LibreCAD/issue-1353/6580099_dxf-2013-hatch.dxf` | LibreCAD#1353 | AutoCAD 2013 large hatches (TrueView reference render in thread) |
| `files/github/LibreCAD__LibreCAD/issue-1946/17533282_demo_extracted/RIGLETA 2 JT BORD A.dxf` | LibreCAD#1946 | AutoCAD 2018 `ANSI_1251`, SHX text with elliptic arcs, enhanced attributes (#1947) |
| `files/github/LibreCAD__LibreCAD/issue-841/592294_text_test_extracted/text_test/text_dxf2007.dxf` | LibreCAD#841 | STYLE "GOST" → isocpeui.ttf; MULTILEADER |
| `files/github/LibreCAD__LibreCAD/issue-1733/14126194_44202_extracted/Урал 44202.dxf` | LibreCAD#1733 | AC1027 `ANSI_1251`, Cyrillic, unsupported MTEXT formatting |
| `files/github/LibreCAD__LibreCAD/issue-1604/11228994_test_extracted/test.dxf` | LibreCAD#1604 | QCAD Cyrillic MTEXT |
| `files/github/LibreCAD__LibreCAD/issue-850/635760_Unit_extracted/Unit.dxf` | LibreCAD#850 | QCAD: many text styles, Unicode, MTEXT formatting |
| `files/github/LibreCAD__LibreCAD/issue-2723/30585484_minimal_dimstyle_repro.dxf` | LibreCAD#2723 | ezdxf DIMSTYLE with custom DIMASZ/DIMTXT |
| `files/github/LibreCAD__libdxfrw/issue-19/15598568_errorDxf2Dxf_extracted/errorDxf2Dxf/ConstraintsError.dxf` | libdxfrw#19 | libdxfrw re-save that AutoCAD refuses (HANDSEED/plot style) |
| `files/github/LibreCAD__libdxfrw/issue-19/15598568_errorDxf2Dxf_extracted/errorDxf2Dxf/Constraints.dxf` | libdxfrw#19 | AutoCAD original of the above (A/B pair) |
| `files/github/LibreCAD__libdxfrw/issue-7/2637388_freeze.dxf` | libdxfrw#7 | Truncated file: ENTITIES without ENDSEC/EOF |
| `files/github/LibreCAD__libdxfrw/issue-78/16289948_file.dxf` | libdxfrw#78 | libdxfrw-written DIMENSION that AutoCAD did not accept |
| `files/github/LibreDWG__libredwg/issue-275/5422402_missing_y_extracted/lineweights.dxf` | libredwg#275 | Invalid lineweights, duplicated TEXT codes (AutoCAD refused) |
| `files/github/LibreDWG__libredwg/issue-275/5422481_colorwh.dxf_extracted/colorwh.dxf` | libredwg#275 | Autodesk colour wheel sample: 36k SOLIDs (ACI rendering), `$KEYWORDS` newline |
| `files/github/LibreDWG__libredwg/issue-275/5422438_Ceco.NET-Architecture-Tm-272.dxf_extracted/Ceco.NET-Architecture-Tm-272.dxf` | libredwg#275 | Zero spline tangents (AutoCAD refused) |
| `files/github/LibreDWG__libredwg/issue-516/9257875_invalid.files_extracted/invalid files/222.dxf` | libredwg#516 | NOD not the first object, `ANSI_936`, proxies |
| `files/github/LibreDWG__libredwg/issue-999/16441827_2018_extracted/2018.dxf` | libredwg#999 | Empty BLOCK name for `*Model_Space`; TrueView refused/crashed |
| `files/github/LibreDWG__libredwg/issue-474/9494937_my-drawing.dxf_extracted/my-drawing.dxf` | libredwg#474 | Maker.js: no version, no handles, no trailing newline; TrueView opens it |
| `files/github/LibreDWG__libredwg/issue-40/2541335_testdata_extracted/RectTest.dxf` | libredwg#40 | LWPOLYLINE 70 = 129 + 43 width |
| `files/github/LibreDWG__libredwg/issue-655/11981214_cyrillic-test_extracted/cyrillic-test/cyrillic-r12.dxf` | libredwg#655 | One TEXT, Cyrillic, R12; siblings `-00`/`-04`/`-07` for AC1015/AC1018/AC1021: an **encoding ladder** |
| `files/github/LibreDWG__libredwg/issue-1188/23289351_161047264177.dxf_extracted/161047264177.dxf` | libredwg#1188 | 13 MB AutoCAD `ANSI_936` with 613 DIMENSIONs (dimension block reference) |

---

## 18. Test ideas (small DXF files to pin down against AutoCAD)

Acceptance and defaults (open each with `accoreconsole /i f.dxf` + AUDIT; record the messages and what is shown):
3. `$TILEMODE` absent / 0 / 1: which space opens?
5. ELLIPSE ratio exactly 1.0 and 1.0000001; LEADER with 1 vertex; IMAGE with `91 0`; SPLINE with fit points only; SPLINE with zero tangents.
6. A string containing a raw `\r` (no `\n`); a string of 251 characters in TEXT group 1 without a group-3 split; a `\U+` split across MTEXT chunks.
7. Doubles with 15 vs 17 significant digits and integer-looking reals (`943`): does AutoCAD read them exactly (compare its DXFOUT values)?
8. AC1014 DXF in the form AutoCAD R14 wrote (empty CLASSES): does AutoCAD 2027 open it? Settles CONFLICT §16.
9. Sub-entity owner test: ATTRIB 330 → INSERT vs → BLOCK_RECORD. Does AUDIT complain?

Rendering (PLOT to PDF/PNG, compare with truedxf):
10. Dimension with `2` missing, (a) in model space and (b) inside a block. Confirms regeneration only outside blocks.
11. HATCH whose stored pattern lines disagree with its pattern name/scale (hand-edited 53/45/46). Plot shows stored vs regenerated.
12. HATCH loop with edges forming two disjoint rectangles (LibreCAD#1739 case).
13. SPLINE flagged closed/periodic with unwrapped control points and a clamped knot vector (LibreCAD#1598 case). Does the plot close it?
14. ACI 1–255 swatch sheet plotted to PDF with no plot style, with `monochrome.ctb` and with `acad.stb`. Settles the ACI→RGB table used in PLOT (netDxf#175 says PDF 99 = (57,114,57)).
15. TEXT 71 = 2/4/6 with each 72/73 alignment. MTEXT with 72/73/44 omitted vs explicit 0.
16. DIMPOST `<>` on radial/diameter dimensions (prefix suppression); text override `" "` vs `""` vs `"<>mm"`.
17. ARC and CIRCLE with extrusion (0,0,-1) and a skewed extrusion; LWPOLYLINE with elevation + extrusion.
18. Linetype DASHED on a LINE and on a CIRCLE of equal length: compare dash phase and scale. Also PSLTSCALE 0/1 in a scaled viewport.
19. VIEWPORT with 68 = 0 vs 1..N in a layout: which viewports plot?
20. Entity `60 1` on a thawed layer; layer 62 negative; Defpoints layer content: none should plot.
21. ByBlock children inside an INSERT with colour ByLayer on a red layer, nested two levels.
22. TABLE with a `*T` block that disagrees with its cell data: plot before and after REGEN.
23. MLINE with split colours and arc caps (netDxf#93 rule).
24. Width factor 0.5/2.0 on SHX text with arcs (`txt.shx`, `romans.shx`): compare glyph shapes.
25. TEXT middle-centre (72 = 4) and MTEXT middle-centre: anchor at the font cell vs glyph bounds.

Reader robustness (no AutoCAD needed; check AutoCAD opens them for the "AutoCAD tolerates" column):
26. `999` comments inside `SECTION`/`2` headers; a bare TABLE without TABLES; a file ending without ENDSEC/EOF; no `$ACADVER`; no handles.
27. `$DWGCODEPAGE` aliases (`ansi_1252`, `DOS850`, `kcs5601`, `GB2312`) with matching bytes; `\M+5xxxx` in an AC1018 file; `\U+` in an AC1032 file.
28. Duplicate layer names without layer 0; entities on undefined layers (AutoCAD creates them).
