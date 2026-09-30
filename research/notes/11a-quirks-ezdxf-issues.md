# 11a — Real-world DXF quirks from the ezdxf issue tracker

This note collects what an implementer learns only by fixing bug reports. It is not in the DXF
reference. The sources are:

- all 1,334 ezdxf GitHub issues, PRs and discussions (`research/github/raw/mozman__ezdxf/threads/`)
- ezdxf's `notes/pages/CHANGELOG.md`, its release notes and its maintainer notes (`research/repos/ezdxf/notes/`)
- the attachments downloaded to `samples/external` (see the [sample table](#notable-sample-files))

Discussions, issues and PRs share one number space on GitHub, so every citation is `ezdxf#N`. Changelog
entries without an issue number are cited as `ezdxf:CHANGELOG vX.Y`. Maintainer notes are cited as
`ezdxf:notes/<page>`.

**Confidence tags**

| Tag | Meaning |
|---|---|
| **VERIFIED-BY-ACAD** | Someone checked the behaviour in AutoCAD, AutoCAD LT or DWG TrueView. TrueView uses the AutoCAD engine. The app is named where known. |
| **VERIFIED-BY-BRICSCAD** | Checked in BricsCAD. mozman uses BricsCAD as his daily CAD. BricsCAD is often more forgiving than AutoCAD. |
| **REPORTED** | Stated by a user or by mozman, or it is how ezdxf behaves after a fix. It was not shown to be checked in a CAD app. |
| **ASSUMPTION** | Speculation in the thread, or my own inference. |

Items that feed the AutoCAD test backlog are marked **UNKNOWN / needs AutoCAD test**.

---

## 0. Ground rules the ezdxf maintainer converged on

- **The reference implementation is AutoCAD.**
  - "If AutoCAD opens a DXF file without complaints, it is DXF compatible" (ezdxf#30, ezdxf:notes/DXF Ground Truth).
  - The DXF reference "provides no rules how to render entities" and is often wrong or silent (ezdxf#325, #258, #598).
  - Undocumented behaviour has to be reverse-engineered from AutoCAD output (ezdxf#325). [REPORTED]
- **Which viewers are reliable.**
  - Reliable: TrueView (free, AutoCAD engine), BricsCAD, GstarCAD and ZWCAD (ezdxf#544, ezdxf:notes/Reliable CAD Application).
  - Not reliable as references: LibreCAD and QCAD. Their bug reports are rejected (ezdxf#325, #410, #572, #851, #989). [REPORTED]
- **AutoCAD's DXF loader is picky** and its error messages are useless (ezdxf#697). BricsCAD accepts much more than AutoCAD; examples are ezdxf#114, #157, #218, #258 and #1285. So "opens in BricsCAD" is *not* proof of AutoCAD validity. [VERIFIED-BY-ACAD / VERIFIED-BY-BRICSCAD]
- **AutoCAD is sometimes more tolerant than its own spec.**
  - It opens QGIS files with 85+ dangling handles (ezdxf#997).
  - It opens a PLOTSETTINGS object without an owner (ezdxf#1240).
  - It opens GROUPs that contain table entries (ezdxf#521).
  - It opens CloudCompare R12 files that have an OBJECTS section (ezdxf#278).
  - A tolerant reader must therefore accept files that "should" be invalid. [VERIFIED-BY-ACAD]
- **ezdxf deliberately does not aim for AutoCAD-exact rendering.** mozman says this in ezdxf#77, #335, #1053, #1390 and #1410. The drawing add-on shows *which* cases matter, not what the exact AutoCAD output is. Where the threads include an AutoCAD screenshot, the screenshot is the useful part. [REPORTED]

## 1. Parsing and file structure

### Tag level
- **Structure tags can carry trailing whitespace.** An AC1009 file had `"SECTION "` with a trailing space; the Autodesk online viewer accepted it. Strip whitespace before matching structure keywords (ezdxf#179, ezdxf:CHANGELOG v0.13.1). [VERIFIED-BY-ACAD Autodesk Viewer] (samples: `issue-179/.../test.dxf`)
- **Empty value lines are valid.** An example is `$DIMBLK2` with an empty string, which means closed filled (ezdxf#122). [REPORTED]
- **A raw line feed inside a value** (a multi-line TEXT split across lines) is a corrupt file. TrueView 2024 and BricsCAD both refuse it, so there is nothing to recover (ezdxf#1289). [VERIFIED-BY-ACAD TrueView 2024, VERIFIED-BY-BRICSCAD] (samples: `issue-1289/.../R3.dxf`)
- **Numbers are sometimes malformed.**
  - Floats with a space instead of an exponent sign: `1.000000000000000E 20`, seen in meerk40t crash logs. ezdxf's recover reads 1.0 (ezdxf#601, #960). [REPORTED]
  - ProE writes integer codes as floats, e.g. `70` / `1.0`. Accept `int(float(v))` (ezdxf:CHANGELOG v0.6.1, ezdxf#1403). [REPORTED]
  - `62` / `1e999` is +inf and overflows an int conversion. Treat it as a structure error rather than a crash (ezdxf#1403, #1406). [REPORTED]
  - Leading-zero-less numbers like `.231` occur in pattern/MTEXT data (ezdxf#1350). [REPORTED]
- **Coordinate tags can be out of order.** Old QCAD/LibreCAD wrote LINE as 10, 11, 20, 21, 30, 31. Pair coordinates by group code, not by adjacency (ezdxf#601, ezdxf:CHANGELOG v0.8.3). [REPORTED]
- **Partial vectors exist.**
  - LibreDWG writes 10 without 20, and z 31 without its x/y (ezdxf#256).
  - Some files have extrusion with only 220/230, or only 210 (ezdxf#933).
  - Default the missing components to 0, or drop the orphan tag. ezdxf's recover removes misplaced x/z tags. [REPORTED] (samples: `issue-933/*` ×3)
- **Data after `0/EOF` and trailing blank lines must be ignored** (ezdxf#639, #640). [REPORTED]
- **Tags outside any SECTION** are dropped. **Duplicate BLOCK names** occur (ezdxf:CHANGELOG v0.8.3, v0.8.4). [REPORTED]
- **999 comments** have no defined binding to structures (ezdxf#103). [REPORTED]
- **Binary chunks (310).** By the spec, each tag holds at most 254 hex characters (127 bytes) in ASCII DXF. A binary object is split over several 310 tags, often preceded by a length tag, which is 92 in some files and 160 in others. Don't assume the tag code from the DXF version (ezdxf:notes/DXF Binary Chunk Interpretation, ezdxf#978). [REPORTED]
- **XRECORD with binary data in ASCII DXF** was rejected by TrueView 2020 (ezdxf:CHANGELOG v0.14). [VERIFIED-BY-ACAD TrueView 2020]

### XDATA and application data
- **Civil 3D and Map 3D write xdata-range group codes (≥1000) inside entity bodies.** BLOCKBASEPOINTPARAMETER puts them before the entity's XDATA section. A strict "≥1000 only after 1001" validator rejects real AutoCAD files.
  - TrueView 2018 and LT 2018 refused that Civil 3D 2018 file.
  - A Map 3D 2017 file with the same entity loads fine.
  - (ezdxf#30, ezdxf:CHANGELOG v0.8.8) [VERIFIED-BY-ACAD TrueView/LT 2018]
- **An XRECORD from CAD-T** (an AutoCAD 2016 add-on) contains 102 app-data groups that look nested (ezdxf#161). [REPORTED]
- **Group code 1003** (layer name) is valid in XDATA (ezdxf:CHANGELOG v0.17.1). [REPORTED]
- **XDATA whose appid is not in the APPID table** makes AutoCAD fail: "error reading POLYLINE … Target ends early … Invalid or incomplete DXF input" (ezdxf#1079). [VERIFIED-BY-ACAD]
- **An appid referenced in BLOCK_RECORD XDATA but missing from APPID** was seen with `AcDbDynamicBlockGUID`. AutoCAD reported "Error in BLOCK_RECORD table … premature end of object" (ezdxf#58). [VERIFIED-BY-ACAD]

### Handles and ownership
- **`$HANDSEED` cannot be trusted.** It may be lower than the existing handles (ezdxf#135, #960, ezdxf:CHANGELOG v0.15). [REPORTED]
- **Duplicate handles occur.**
  - A 183 MB third-party file (with a DGN module) had duplicate handles. TrueView 2023 reported "Missing DXF group code: 2 … in INSERT". BricsCAD RECOVER found 22 errors (ezdxf#833).
  - ezdxf keeps the first entity and deletes later duplicates (ezdxf#960).
  - [VERIFIED-BY-ACAD TrueView 2023, VERIFIED-BY-BRICSCAD]
- **R13+ entities without handles** are written by ProE, a dead vendor's exporter (ezdxf#604) and CloudCompare (ezdxf#278) (ezdxf#960). [REPORTED]
- **QGIS writes a fixed-handle OBJECTS section for every file**, while the table/entity handles are dynamic.
  - LAYOUT 330 → a non-existent BLOCK_RECORD, and BLOCK_RECORD 340 does not point back.
  - The result is 85+ dangling handles in every export.
  - AutoCAD opens the file anyway. BricsCAD RECOVER finds about 10% bad objects.
  - ezdxf's repair: link LAYOUT "Model" to `*Model_Space`, then assign the remaining LAYOUTs to unowned `*Paper_Space*` blocks in order.
  - (ezdxf#997, ezdxf:notes/Read messed up LAYOUT structure created by QGIS) [VERIFIED-BY-ACAD, VERIFIED-BY-BRICSCAD]
- **LibreCAD, and at least one other unnamed application, writes PLOTSETTINGS without an owner handle (330)**, although the owner is mandatory in OBJECTS. AutoCAD loads it (ezdxf#1240). [VERIFIED-BY-ACAD] (samples: `issue-1240/.../PlotSettingsTest.dxf`)
- **Group 67 (paperspace flag) is unreliable.** The owner handle (330 → BLOCK_RECORD) decides the layout (ezdxf#680). [REPORTED]
- **Handle references may point to the wrong object type.**
  - AutoCAD R2018 files (ANSI_936) with DIMSTYLE 345/346/347 → the ACDBPLACEHOLDER "Normal" (handle F) instead of an LTYPE. AutoCAD opens them (ezdxf#643).
  - A third-party DIMSTYLE `dimtxsty` 340 → a DICTIONARY (ezdxf#687).
  - [REPORTED] (samples: `discussion-643/.../test.dxf`)

### Versions
- **R13/R14 are a transitional mix of R12 and R2000.**
  - AutoCAD can no longer write them (ezdxf#114).
  - ezdxf upgrades R13/R14 to R2000 and pre-R12 to R12 (ezdxf#1, #52, #134).
  - When upgrading, the CLASS section entries need 280 (was-a-proxy) and 281 (is-an-entity). Otherwise TrueView 2018 fails with "Group 280 (was-a-zombie-flag) expected on line 180" (ezdxf#52).
  - An R13 template upgraded badly crashed AutoCAD (ezdxf#134).
  - [VERIFIED-BY-ACAD TrueView 2018] (samples: `issue-52/.../test.dxf` R14, `issue-80/.../leader.dxf` R13)
- **R8 (AC1003) files were re-saved as R12, and R13/R14 as R2000,** "without AutoCAD complaints" (ezdxf:CHANGELOG v0.7.2/0.7.3). **R10** is readable as R12 (ezdxf#452). [VERIFIED-BY-ACAD] (samples: `issue-765/.../nzk-1.dxf` R10)
- **A fake AC1014 file with LWPOLYLINE**: TrueView 2020 refuses it, BricsCAD opens it, and a Chinese laser-cutter program reads it (ezdxf#114). [VERIFIED-BY-ACAD TrueView 2020, VERIFIED-BY-BRICSCAD]
- **An R12 (AC1009) file with an OBJECTS section**, R12-style POLYLINE without handles or subclasses, from CloudCompare/dxflib. AutoCAD and BricsCAD open it; BricsCAD RECOVER fixes 20 errors (ezdxf#278). [VERIFIED-BY-ACAD, VERIFIED-BY-BRICSCAD]
- **R12 edge cases seen in the wild**:
  - files with no handles, or `$HANDLING=0`
  - a HEADER without `$ACADVER`, or an R12 file without any HEADER section (OpenSCAD, ezdxf#537)
  - subclass markers (100) inside R12 table entries (Leica Disto files, ezdxf#1106)
  - entities without an owner (ProE)
  - "Version 1.0, Gerber Technology" files
  - (ezdxf:CHANGELOG v0.6.0–v0.10) [REPORTED]
- **Minimal or foreign writers.** A reader must accept a missing HEADER, missing TABLES and missing owners.
  - **ENTITIES-only files** exist: no HEADER, no TABLES, no handles, `6 CONTINUOUS` with no LTYPE table. Sources include a metal-forming simulator (only a 999 comment and ENTITIES, no z codes) (ezdxf#924, #1139). [REPORTED] (samples: `discussion-924/.../11001.dxf`, `discussion-1139/.../Contour1.dxf`)
  - **Inkscape** writes minimal AC1014 (ezdxf#1020, #1024). [REPORTED] (samples: `discussion-1024/.../frominkscape.dxf`)
    - `$HANDSEED FFFF`
    - entities without 330
    - no LAYOUT objects
    - `ACAD_MLINESTYLE` pointing to a missing handle
    - DIMSTYLE handle in 105
    - SPLINEs with both control and fit points
  - **Gerber Technology "R12"** (999 "Version 1.0, Gerber Technology.") (ezdxf#853, #789). [REPORTED] (samples: `discussion-853/.../input.dxf`, `discussion-789/.../square.dxf`)
    - The HEADER has only `$INSUNITS`, and there is no TABLES section.
    - Entities carry `100 AcDbText` markers although the file is R12.
  - **Browzwear/ASTM-D6673 files** (ezdxf#789). [REPORTED]
    - They have TEXT with height 0 and TEXT with **no group 1 at all**.
    - Gerber AccuMark rejects `*Model_Space`/`*Paper_Space` blocks.
  - **A C# exporter wrote R12 with R13 subclass markers** everywhere (`VPORT 5 2 100 AcDbSymbolTableRecord 2 *ACTIVE`) and `50 -90.0` arc angles. AutoCAD reads it. Don't expect group 2 at a fixed position (ezdxf#1106). [REPORTED] (samples: `issue1106.dxf`)
- **Object pointers can resolve to the wrong type.** A "required" DICTIONARY pointer resolved to an LWPOLYLINE in an R14 file. Type-check every pointer you follow (ezdxf#1025). [REPORTED]
- **Binary DXF** starts with the sentinel `AutoCAD Binary DXF\r\n\x1a\0`. Writing it is not faster than ASCII. Some binary files written by ezdxf were unreadable to AutoCAD, and proxy-graphic 310 data in binary DXF must be raw bytes (ezdxf#1205, #1412). [REPORTED]
- **Keep the original `$ACADVER`.** ezdxf upgrades R13/14 to R2000 and pre-R12 to R12, so its version is not the file's (ezdxf#1024). [REPORTED]
- **Minimum versions.**
  - True color (420) and transparency (440) on layers and entities need R2004+ (ezdxf#1294).
  - MTEXT needs R13+ (ezdxf#652).
  - IMAGE needs R2000+ (ezdxf#500).
  - ACAD_TABLE is documented from R2007 and only really an ACAD_TABLE from R2010. An R2004 save by AutoCAD has a different structure (ezdxf#1068).
  - MESH is accepted by TrueView and BricsCAD from R2000, although documented as R2010+ (ezdxf#72).
  - [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD]
- **R2018 DXF may use features that produce "invalid" data by the reference.** Example: DIMENSION without group 2 (ezdxf#253), see §10. [REPORTED]

### Compressed or foreign files
- **KLayout writes zlib-compressed content with a `.dxf` extension.** AutoCAD and BricsCAD cannot open it (ezdxf#531). [REPORTED]
- **The ODA File Converter** exits with "core dumped" on Linux even after a successful conversion (ezdxf#251, #192). It needs xvfb and `XDG_RUNTIME_DIR` (ezdxf#903). [REPORTED]

## 2. Encoding

- **R2007+ (AC1021+) is always UTF-8**, whatever `$DWGCODEPAGE` says. Writing R2007+ in another encoding produces an invalid file (ezdxf#88, #107, ezdxf:CHANGELOG v0.7.5). [REPORTED]
- **R2004 and older use `$DWGCODEPAGE`** (`ANSI_1252`, `ANSI_932`, `ANSI_936`, `ANSI_1256`, …). Characters outside the codepage are stored as `\U+XXXX`. Fall back to cp1252 for unknown codepages.
  - A Farsi R2004 drawing stored cp1256 text plus embedded `\U+` escapes. BricsCAD's R2018 re-save had the same text in UTF-8 (ezdxf#1271). [VERIFIED-BY-BRICSCAD] (samples: `issue-1271/.../plan_2004.dxf`, `plan_2018.dxf`)
  - Chinese R2000 text became `\U+` sequences unless `$DWGCODEPAGE=ANSI_936` was used (ezdxf#366). [REPORTED]
- **Encoding does not match the header.**
  - VectorWorks 2012 writes ANSI_932.
  - One AutoCAD output mixed UTF-8 and cp932 strings in one file (ezdxf#88).
  - GBK-encoded pre-2004 files contain proxy-graphic text in the codepage too (ezdxf#991).
  - Use a lossless decode (surrogate-escape) and never crash on bad bytes (ezdxf:CHANGELOG v0.14).
  - [REPORTED]
- **`\U+XXXX` escape details.**
  - The `+` is required; plain `\Uxxxx` is not AutoCAD's form, and AutoCAD needs the `+` form (ezdxf#1063).
  - Hex digits may be **lowercase** (`\U+5c42`) (ezdxf#1380).
  - It appears in table names too: layer names with `\U+00FC` (ezdxf#782). Decode it everywhere, not only in text.
  - [REPORTED]
- **`\M+nXXXX` (MIF) encoding.** `n` is a codepage digit and `XXXX` are the two DBCS bytes in hex.
  - The ODA File Converter 24.x **Linux** build writes layer names and text as MIF. The Windows build writes UTF-8 for the same DWG (ezdxf#932, #859, #1018).
  - libredwg documents the mapping (ezdxf#932).
  - ezdxf decodes MIF only in its recover module (ezdxf#932, #1063).
  - Checked by hand: `\M+1974C\M+18CC0\M+18CF6\M+18E69` with n=1 decodes as cp932 (Shift-JIS) to 有限公司; cp936, cp949 and cp950 give garbage (ezdxf#859, #935).
  - The rest of the map (2=cp950, 3=cp949, 4=cp1361 Johab, 5=cp936) is an [ASSUMPTION] taken from libredwg.
  - [REPORTED] (samples: `issue-932/.../test.dxf`)
- **ODA File Converter versions differ.**
  - 24.11/24.12 on **Windows** turned CJK MTEXT into `\U+00BF`-style mojibake when converting DWG ≤2004. 23.x and 25.4 are fine (ezdxf#1018, ezdxf:notes/ODAFileConverter).
  - Record the converter version with every converted test file. [REPORTED]
- **Literal non-ASCII symbols** such as `∅` (U+2205) occur in R2013 UTF-8 DIMENSION text (ezdxf#1211). [REPORTED]
- **MTEXT content longer than 250 characters is split into 3-chunks plus a final 1-chunk.**
  - AutoCAD 2024 joins the chunks *before* decoding. A `\M+` escape split across two chunks still decodes (ezdxf#1322). [VERIFIED-BY-ACAD AutoCAD 2024] (samples: `issue-1322/.../SplitCharEscape.dxf`)
  - LibreDWG 0.12 `dwg2dxf` wrote the chunks in the wrong order (ezdxf#889). [REPORTED]
  - When writing, never split right after a `^` (ezdxf:CHANGELOG v0.10). [REPORTED]
- **Caret notation** (`^` + char encodes a control character, code = (c − 64) mod 126).
  - AutoCAD writes `^I` for tab and `^ ` (caret, space) for a literal caret.
  - The ODA converter writes `^J` for a newline in MTEXT.
  - `^@` (NUL) terminates the string in AutoCAD.
  - TEXT shows non-printables as `?`, MTEXT as a box glyph.
  - **A TEXT value ending in `^` makes AutoCAD refuse the file; an MTEXT ending in `^` is fine.**
  - (ezdxf#170, #198, #199) [VERIFIED-BY-ACAD] (samples: `issue-170/.../caret_notation.dxf`, `newline_test.dxf`, `cad_mtext.dxf`)
- **`%%` control codes.**
  - `%%c` ⌀, `%%d` °, `%%p` ±, `%%%` literal `%` (ezdxf#1408).
  - `%%u` toggles underline up to the next `%%u` or the end of the line (ezdxf#170).
  - [REPORTED]
- **A raw `\n` in MTEXT content** must be written as `\P`, or the file is invalid (ezdxf:CHANGELOG v0.10). `\P` is *not* a line break in TEXT or ATTRIB (ezdxf#93, #258). [VERIFIED-BY-ACAD]
- **Farsi SHX fonts (NASKH, …) use a private glyph mapping.** The stored codes are not real Unicode Arabic, so text extraction gives mojibake while AutoCAD renders fine (ezdxf#1271). [REPORTED]
- **ACIS SAT text from the ODA converter** contained non-ASCII bytes. Decode tolerantly (ezdxf#690). [REPORTED]

## 3. HEADER variables

- **`$XCLIPFRAME` changed type between versions.**
  - R2007 and older: group 290 (bool), values 0/1.
  - R2010+: group 280, values 0/1/2.
  - Writing 280 or the value 2 into an AC1018/AC1021 file makes AutoCAD 2007–2020 fail with "Error 50 in drawing header on line 960 … Invalid or incomplete DXF input" (ezdxf#381, #1049).
  - [VERIFIED-BY-ACAD AutoCAD 2007, 2018–2020]
- **`$ACADMAINTVER`** uses group 90 for R2018+ and 70 before. AutoCAD 2012/2013 refuse a pre-R2018 file that uses 90 (ezdxf:CHANGELOG v0.10.1). [REPORTED]
- **`$LASTSAVEDBY` in an AC1015 file** only triggers a harmless "unknown header variable ignored" warning in AutoCAD 2016. The variable is R2004+. Unknown header variables are ignored in general (ezdxf#64, #381). [VERIFIED-BY-ACAD AutoCAD 2016]
- **Custom properties** (`$CUSTOMPROPERTYTAG` / `$CUSTOMPROPERTY`) are only accepted by AutoCAD after `$LASTSAVEDBY` (ezdxf:CHANGELOG v0.6.4/0.6.5). [REPORTED]
- **Handle variables pointing nowhere** (`$CMATERIAL`, `$INTERFEREOBJVS`, `$INTERFEREVPVS`) were flagged by BricsCAD AUDIT (ezdxf#9, #619). [VERIFIED-BY-BRICSCAD]
- **GUIDs.** `$FINGERPRINTGUID` never changes after creation; `$VERSIONGUID` changes on every save. Both use the `{XXXXXXXX-…}` form (ezdxf#729, ezdxf:CHANGELOG v0.16.2). [REPORTED]
- **`$TDCREATE` / `$TDUPDATE`** are Julian dates. Round, don't truncate, `frac(jd)*86400` (ezdxf#1396). [REPORTED]
- **Units.**
  - `$INSUNITS` (70): 0 unitless, 1 in, 2 ft, 4 mm, 5 cm, 6 m, …, up to 20 parsecs.
  - `$MEASUREMENT`: 0 imperial, 1 metric.
  - A BricsCAD file saved in inch vs meter differs only in these two variables.
  - eDrawings ignores them, and BLOCK_RECORD 70 (units) exists as well.
  - (ezdxf#68, #115) [VERIFIED-BY-BRICSCAD]
- **`$PROJECTNAME`** is the image/xref search-path key (ezdxf#27). [REPORTED]
- **`$EXTMIN` / `$EXTMAX` / `$LIMMIN` / `$LIMMAX` are stale in most files.**
  - AutoCAD's live EXTMIN differs from the stored value (ezdxf#137, #153).
  - Sometimes the stored value is only in the modelspace LAYOUT (ezdxf#936).
  - Never derive the view from them (ezdxf#219, #391, #535). The initial view is VPORT `*Active` (ezdxf#127, #685).
  - [VERIFIED-BY-ACAD AutoCAD 2020]
- **`$PDMODE` / `$PDSIZE`** drive all POINT display. `$PDSIZE < 0` is relative to the viewport height, and PDMODE 1 draws nothing (ezdxf#534, #739, #765). [REPORTED]
- **`$PSLTSCALE`** (per layout). See §12. [REPORTED]

## 4. Tables

- **Table-entry names are case-insensitive** (LAYER, STYLE, LTYPE, BLOCK, layout names), but keep the original spelling (ezdxf#545, #766, ezdxf:CHANGELOG v0.14). [REPORTED]
- **Symbol-name validity** (`snvalid`).
  - Forbidden characters: `< > / \ " : ? * | , = ` ;`.
  - `*` is allowed only as the first character, for AutoCAD-internal names like `*ADSK_…`, `*ACMAP` or `*TEMPORARY`.
  - ODA on Linux can produce names that look invalid because of `\M+` (ezdxf#932). Decode before validating.
  - (ezdxf:notes/Valid Symbol Names, ezdxf#995) [REPORTED]
- **A LAYER table entry is optional for a layer used by entities.** TrueView and DraftSight show such layers (ezdxf#744, #31, #787). [VERIFIED-BY-ACAD TrueView]
- **A LAYER that references an undefined linetype is fatal for AutoCAD.**
  - TrueView refuses `CONTINUOS` (a typo) with "Error: Undefined line type SOLID in LayerTableRecord … Invalid or incomplete DXF input -- drawing discarded".
  - `SOLID` is not predefined; the default linetype is `CONTINUOUS`.
  - BricsCAD, LibreCAD and NanoCAD open the same files (ezdxf#818, #1016).
  - [VERIFIED-BY-ACAD TrueView 2024, VERIFIED-BY-BRICSCAD] (samples: `discussion-1016/.../4m_holesCStxt.dxf` negative, `EST_GEO_NEW.dxf` positive)
- **Block names with a space are rejected in R12.** TrueView refuses an R12 BLOCK named `Shape 0_M`; BricsCAD accepts it (ezdxf#789). [VERIFIED-BY-ACAD TrueView] **UNKNOWN / needs AutoCAD test**: are spaces also rejected in R2000+ block names? AutoCAD normally allows them.
- **Layer names can start with `*`.** An example is `*IDW_BlockReferenceLayer` from Autodesk Inventor IDW exports, used even on SEQEND (ezdxf#995). [REPORTED]
- **A TEXT that references an undefined STYLE** made AutoCAD 2022 refuse the file (ezdxf#1098). [REPORTED]
- **Xref layer overrides** live in host layers named `<xref>|<layer>`, with XDATA `AcXRefLayerPropertyOverride` (ezdxf#1256). AutoCAD accepts only DWG files as xrefs, not DXF; BricsCAD accepts DXF xrefs; TrueView doesn't show DXF xrefs at all (ezdxf#825, #1256, #135). [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD]
- **Resources AutoCAD requires.**
  - A STYLE referenced by text *is* required, or AutoCAD rejects the file: "error while reading ATTRIB … Invalid DXF data" (ezdxf#164, #744).
  - A missing or `None` linetype name is fatal: "Bad linetype name None … drawing discarded" (ezdxf#43, #46, #47).
  - The auditor replaces a missing layer linetype with Continuous (ezdxf:CHANGELOG v1.2.0).
  - [VERIFIED-BY-ACAD]
- **LAYER state.**
  - Off = negative color. Frozen = flag 70 bit 1. Not plottable = 290=0; a common example is the "ROOM AREA CHECK" layer in AutoCAD Architecture files.
  - PLOT must hide non-plottable layers; on-screen display shows them (ezdxf#410, #475, #451).
  - [VERIFIED-BY-BRICSCAD]
- **LAYER description** is stored in XDATA `AcAecLayerStandard`.
  - BricsCAD writes `[1000 "", 1000 <description>]`, and files with only one 1000 tag exist.
  - Removing the leading empty string makes both BricsCAD and TrueView show no description (ezdxf#148).
  - [VERIFIED-BY-BRICSCAD, VERIFIED-BY-ACAD TrueView]
- **Per-VIEWPORT layer overrides** are stored in the LAYER's extension dictionary: color, true color, transparency, linetype and lineweight. Per-viewport frozen layers are in VIEWPORT 341 handles (ezdxf#670, #535, ezdxf:CHANGELOG v0.18). [VERIFIED-BY-BRICSCAD]
- **STYLE.**
  - Group 3 stores the **font file name** (`arial.ttf`), not the family name (ezdxf#243).
  - The family, bold and italic can be in XDATA `ACAD` `1000 <family>, 1071 <flags>`. AutoCAD and QCAD write it.
  - A STYLE can have an **empty font (3)** with the face only in XDATA, e.g. `宋体`/SimSun in an AutoCAD file (ezdxf#380, #325, #776).
  - 1071 flags: ezdxf had bold and italic swapped (fixed in ezdxf#776).
  - [REPORTED] **UNKNOWN / needs AutoCAD test**: exact bit layout of the 1071 font flags.
- **STYLE 1071 values seen in the wild:** 34 (0x22) for Arial, and 34306 (0x8602) and 34353 (0x8631) for Chinese fonts. They look like LOGFONT pitch/family plus charset (134 = GB2312) (ezdxf#1032, #1075). [ASSUMPTION for the bit layout]
- **XDATA family names can carry the vertical-font prefix `@`** (`@宋体`), and style names can be Chinese (`黑体`) (ezdxf#1032). [REPORTED] (samples: `discussion-1032/.../test.dxf`, `discussion-1075/.../123.dxf`)
- **STYLE font names in group 3 vary in form:** `simplex.shx`, `SIMPLEX`, `simplex`, `txt` without an extension, or an upper-case `.SHX`. Look them up case-insensitively, trying `.shx` and then `.ttf` (ezdxf#839, #967). [REPORTED]
- **macOS-authored files name TTFs by family** (`Arial Black.ttf`, `Comic Sans MS.ttf`, `Arial Unicode.ttf`, `Times New Roman.ttf`). TrueView on Windows maps them to `ariblk.ttf`, `comic.ttf`, `arialuni.ttf`, `times.ttf`; BricsCAD doesn't. Keep a synonym table (ezdxf#1002). [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD]
- **STYLE entries for shape files** (flag 70 bit 0) may be many, with **empty** (`2 ""`) or duplicate names (e.g. `ltypeshp.shx`). Complex linetypes reference them by handle (340). Never dedupe STYLE records by name (ezdxf:CHANGELOG v1.0.1, ezdxf#737, #809, #819). [REPORTED] (samples: `discussion-809/.../complex_lines.dxf`)
- **TEXT without a 7 tag** uses "Standard", and Standard may be a TTF. Resolve the font from the STYLE, not a hard-coded txt (ezdxf#966, #1236). [REPORTED]
- **The "Standard" style in some AutoCAD samples uses a bold font** (ezdxf#620). [REPORTED]
- **An undefined dimstyle falls back to "Standard"** (ezdxf:CHANGELOG v0.11, ezdxf#113). [REPORTED]
- **VPORT.** The `*Active` entry defines the initial view. A missing or badly centred VPORT gives the "empty drawing" effect in TrueView and the Autodesk Viewer (ezdxf#127, #232). [VERIFIED-BY-ACAD TrueView 2020]

## 5. Objects, dictionaries, groups

- **Root dictionaries missing in real files:** ACAD_COLOR, ACAD_GROUP, ACAD_LAYOUT, ACAD_MATERIAL, ACAD_MLEADERSTYLE, ACAD_MLINESTYLE, ACAD_PLOTSETTINGS, ACAD_PLOTSTYLENAME, ACAD_SCALELIST, ACAD_TABLESTYLE and ACAD_VISUALSTYLE. Create them on demand (ezdxf#619, #256). [REPORTED]
- **DICTIONARY hard-owner flag (280).**
  - AutoCAD writes it only when it is 1, and the default is 0.
  - Root-dictionary children should be 0. Extension dictionaries of modelspace entities (e.g. XCLIP's ACAD_FILTER) need 1.
  - Wrong flags cause three failures:
    - AutoCAD crashes on COPYCLIP (Ctrl+C).
    - Pasted dynamic blocks lose their dynamic features.
    - Pasted XCLIPped INSERTs lose their clipping.
  - This is reproducible in AutoCAD, ZWCAD and BricsCAD (BricsCAD is more forgiving).
  - (ezdxf#1203, #1276, #1279, #1285) [VERIFIED-BY-ACAD, VERIFIED-BY-BRICSCAD] (samples: `issue-1203/.../test.dxf|test2.dxf|test3.dxf`, `issue-1285/.../test_fix_clipping.dxf`, `recover.dxf`)
- **Missing or dangling objects break AutoCAD's clipboard.**
  - AutoCAD "Copy to clipboard failed" on ezdxf files was traced to three causes:
    - the LAYER PlotstyleName id was null
    - `*Model_Space` had an ACAD_XDICTIONARY 360 pointing to a non-existent dictionary
    - an R2000 file had a VISUALSTYLE maintenance dictionary with handles to objects R2000 can't store
  - AUDIT fixes the file (ezdxf#9, #121).
  - [VERIFIED-BY-ACAD AutoCAD 2014/2020, Map 3D 2017] (samples: `issue-9/.../all_arrows.dxf` works; `IN_2D_Eng.dxf_ezdxf (7).dxf` fails)
- **ACDBDICTIONARYWDFLT with a non-existent default object** is ignored by AutoCAD (ezdxf:CHANGELOG v0.14.1). [REPORTED]
- **GROUP.**
  - ZWCAD requires each member to have the GROUP in its `{ACAD_REACTORS` list; TrueView doesn't care (ezdxf#1085).
  - GROUPs that contain table entries or entities from different layouts are invalid but opened by AutoCAD (ezdxf#521).
  - Deleted members must be skipped on export (ezdxf#423).
  - [VERIFIED-BY-ACAD TrueView; ZWCAD]
- **Undocumented objects sit in extension-dictionary chains.**
  - Example: ATTDEF → AcDbContextDataManager → ACDB_ANNOTATIONSCALES → `*A1` → ACDB_MTEXTATTRIBUTEOBJECTCONTEXTDATA_CLASS (ezdxf:notes journals 2023-11-12).
  - Civil 3D adds ACAD_PROXY_OBJECT (thousands), ACDB_BLOCKREPRESENTATION_DATA, ACAD_EVALUATION_GRAPH, DATATABLE, CELLSTYLEMAP, … (ezdxf#365).
  - Constraints are stored as ACDBASSOCVARIABLE (ezdxf#581, #893).
  - Preserve them as raw tags. Copying them needs pointer remapping, or AutoCAD can't read the result (ezdxf:notes/Copying Undocumented Entities).
  - [REPORTED]
- **Deleting entities naively** (GROUPs, dictionaries, reactors) produces files AutoCAD rejects (ezdxf#423). [REPORTED]

## 6. OCS and transforms (affects most entity types)

- **Extrusion (0,0,−1) is common even in pure 2D drawings.** It comes from MIRROR and from exploding mirrored blocks.
  - Affected entities: ARC, CIRCLE, LWPOLYLINE, 2D POLYLINE, HATCH, TEXT, ATTRIB, SOLID, TRACE, INSERT, DIMENSION, MPOLYGON.
  - WCS x = −OCS x. An ARC's WCS angles are 180° − OCS angles, with start and end swapped.
  - Many "wrong coordinates" reports are this (ezdxf#32, #169, #247, #389, #736, #870, #1177, #1264, #1338, #1400, ezdxf:notes/Why are ARC coordinates wrong).
  - [VERIFIED-BY-BRICSCAD]
- **Always apply the arbitrary-axis algorithm**, which is always right-handed. Critical cases:
  - ARC angles
  - LWPOLYLINE/POLYLINE bulges
  - HATCH/MPOLYGON arc and ellipse edges
  - INSERT rotation plus x/y/z scale
  - (ezdxf#459) [REPORTED]
- **AutoCAD's MIRROR keeps extrusion +Z.** It mirrors vertices and negates bulges and arc directions. ezdxf instead flips the extrusion to −Z, which is geometrically equal. Differences:
  - Thickness must then be negated (ezdxf#459).
  - AutoCAD JOIN turns such −Z arcs into splines (ezdxf#1345).
  - Ansys HFSS ignores OCS.
  - For writing, **prefer AutoCAD's convention (normalize to +Z, "upright")**.
  - [VERIFIED-BY-ACAD]
- **Exploding a reflected block in AutoCAD** doesn't negate the extrusion either. It reinterprets start/end parameters (ezdxf#154). [VERIFIED-BY-ACAD] (samples: `pr-154/.../rotated_and_scaled_arcs.dxf`)
- **Nested reflections.** Multiple mirrored levels (sx=−1 at several nesting depths, with rotation 90°) need full matrix composition. Per-level "reflection compensation" fails. AutoCAD and BricsCAD compose correctly (ezdxf#380). [VERIFIED-BY-ACAD, VERIFIED-BY-BRICSCAD] (samples: `issue-380/.../test.dxf`)
- **Extrusion (0,0,0)** is invalid, but it occurs:
  - LibreCAD writes it on SPLINE (ezdxf#851).
  - TEXT with (0,0,0) behaves like (0,0,1) in AutoCAD, and (0,0,x) behaves as (0,0,1) (ezdxf#145, #280).
  - Never divide by zero.
  - [VERIFIED-BY-ACAD]
- **A non-normalized direction vector** (e.g. VIEWPORT 16/26/36) must be normalized before comparing with (0,0,1) (ezdxf#1298). [REPORTED]
- **Large coordinates.** Real files have:
  - geo-coordinates around 3.9e7 with 0.2-unit circles (ezdxf#424)
  - a radius of 1.5e-8 at 1.9e5 (ezdxf#473)
  - elevations of 1.39e19 (ezdxf#663) and 2.99e99 (ezdxf#574)
  - entities at ±2.5e9 on hidden layers (ezdxf#574)
  - Relative float tolerances break coincidence tests. Translate curves to a local origin before flattening. Parametric (determinant) line intersection is needed for near-vertical lines at x≈250,235 (ezdxf#1300, #1398).
  - [REPORTED] (samples: `issue-473/*`, `issue-424/*`, `issue-663/*`, `issue-574/*`)
  - A CIRCLE at (495799, 3325910) with r=1 renders fine in BricsCAD and TrueView. Use float64 throughout, and a local origin for GPU paths (ezdxf#977). [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD]

## 7. Entities by type

### LINE, POINT, SOLID, TRACE, 3DFACE
- **SOLID and TRACE are OCS entities with vertex order 1-2-4-3.** The "last two vertices are reversed". Writing (0,0),(0,10),(10,10),(10,0) gives a bow-tie in TrueView and eDrawings. ezdxf re-fixed TRACE rendering in 1.4.3 (ezdxf#422, #1375, ezdxf:CHANGELOG v0.15/v0.16.3). [VERIFIED-BY-ACAD TrueView]
- **SOLID, TRACE and HATCH are the only filled entities.** Closed polylines are never filled; wide polylines are filled as traces (ezdxf#796). [REPORTED]
- **3DFACE group 70 is a per-edge invisibility bitmask.**
  - The face is visible if any edge is visible; draw only the visible edges.
  - AutoCAD and BricsCAD render the edge-visibility test file identically (ezdxf#513, #514). [VERIFIED-BY-ACAD, VERIFIED-BY-BRICSCAD] (samples: `examples_dxf/3dface.dxf`)
- **Degenerate 3DFACEs are drawn by AutoCAD as lines.** Floor plans draw windows as 3DFACEs with zero-length sides.
  - AutoCAD draws a 4-vertex face with v3==v4 edge by edge (3→4 is a zero-length edge).
  - ezdxf treats it as a triangle and draws 3→1 (ezdxf#621).
  - Missing v4 = v3 (ezdxf#513).
  - [VERIFIED-BY-ACAD screenshot]
- **POINT display** follows `$PDMODE`/`$PDSIZE` (see §3). POINTs are used as hatch "dots" in real files (ezdxf#739, #765). [REPORTED]
- **POINT clouds.** Millions of POINTs open "blank" in AutoCAD until `ZOOM E` if `$EXTMIN/$EXTMAX` and VPORT `*Active` don't cover them (ezdxf#1117, #1118). [REPORTED]
- **An explicit thickness 0** on LINE crashed transforms. Thickness must be transformed, and negated when the extrusion flips (ezdxf#1344, #459). [REPORTED]

### ARC, CIRCLE
- **Angles are in degrees, counter-clockwise from the OCS x-axis.** SolidWorks 2020 writes start=270 end=90, which is correct. SolidWorks coordinates deviate at the 6th decimal (ezdxf#36, #659). [REPORTED]
- **Negative angles occur** (`50 -90.0`, ezdxf#1106), and so does -180..180 (ezdxf#302). Normalize them.
- **start == end.** BricsCAD and TrueView draw **just a point** for an ARC with equal start and end angle, not a full circle (ezdxf#330). [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD]
- **Radius 0 CIRCLE/ARC exist** in real files. Skip them (ezdxf#184–#186). [REPORTED] **UNKNOWN / needs AutoCAD test**: does AutoCAD plot a dot for a radius-0 circle?
- **Extrusion (0,0,−1)** is covered in §6 (ezdxf#32, #870, #1264). (samples: `issue-870/.../Drawing1_t3.dxf`)

### ELLIPSE
- **ELLIPSE is a WCS entity**; its parameters run around the extrusion vector (ezdxf#157). [REPORTED]
- **Axis ratio (40) range.**
  - TrueView 2021 accepts 1e-10 … 1.0 and also −1.0 … −1e-10 (ezdxf#800).
  - AutoCAD rejects values outside that range, but DWG-sourced files contain ratios slightly **above 1.0** from float noise. Clamp them when writing (ezdxf#799, #819).
  - [VERIFIED-BY-ACAD TrueView 2021]
- **Non-uniform INSERT scale** turns an ellipse into a new ellipse via conjugate diameters (Rytz). This has numeric edge cases; ODA-converted files trigger "conjugated axis required" (ezdxf#139, #140, #255, #702). [REPORTED] (samples: `issue-139/*`, `issue-140/*`, `issue-255/.../villa_chalet.dxf`)

### SPLINE
- **Use the stored knots.**
  - AutoCAD JOIN produces repeated interior knots, e.g. `[0,0,0,1,1,2,2,2]` for degree 2 (ezdxf#1028).
  - Clamped end knots may be only *nearly* equal, e.g. `0.2811314410294223` vs `0.2811314413221608` (ezdxf#541), or `0.5, 0.5, 0.5000000000000006` (ezdxf#1284).
  - Compare multiplicities with the knot tolerance (42) or a relative epsilon. Otherwise a phantom segment appears that AutoCAD doesn't draw (ezdxf#1296).
  - [REPORTED] (samples: `discussion-1028/.../to_import.dxf`, `discussion-1284/.../*step_000.dxf`, `issue-541/.../*cloudconvert.dxf`)
- **Rational splines** (70 bit 4) in AutoCAD-like AC1027 have `42 1e-9`, `43 1e-10`. ezdxf fixed its weighted basis in 1.4.2 (ezdxf#1284). [REPORTED]
- **Fit-point-only splines.**
  - AutoCAD's control points can be computed without estimating end tangents. ezdxf uses the method from Stack Overflow question 62472305 and matches BricsCAD (ezdxf#819, ezdxf:Release Notes v1.0).
  - The DXF reference's own recipe for closed/periodic splines produced data BricsCAD rejects (ezdxf:CHANGELOG v0.13).
  - Honour 12/13 tangents when present.
  - [VERIFIED-BY-BRICSCAD]
- **Degenerate splines.** Real files have:
  - start tangent (0,0,0) (LibreDWG, ezdxf#252)
  - duplicate consecutive control points (QCAD removes the spline) (ezdxf#831)
  - zero-length splines (ezdxf#834)
  - fewer than degree+1 control points (ezdxf#291)
  - Skip or guard them; never crash. [REPORTED] (samples: `issue-831/.../splinetest.dxf`)
- **The closed flag (70 bit 1) is not reliable.** LibreCAD writes an *open* spline with only the closed flag set, and TrueView and BricsCAD render it **open**. Geometry wins; check start/end coincidence (ezdxf#375, #851). [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD] (samples: `drawing_spline.dxf`)
- **AutoCAD tessellates splines view-dependently.** It shows coarse splines until `REGEN`, and a small spline in the default view looks polygonal (ezdxf#1022, #705). For PLOT fidelity: **UNKNOWN / needs AutoCAD test** — which tessellation tolerance does PLOT use (VIEWRES? device resolution)?
- **A SPLINE mis-rendered by ezdxf** (partly mirrored) against a BricsCAD reference (ezdxf#1261, fixed). (samples: `issue-1261/spline.dxf`)

### LWPOLYLINE
- **Tag order matters to AutoCAD.**
  - 90 (count) and 70 (flags) must come inside the AcDbPolyline subclass.
  - With 90 before the subclass marker, AutoCAD reports "Closed: No".
  - Canonical order: 90, 70, 43, 38, 39, then per vertex 10/20/40/41/42/91 (ezdxf#81, ezdxf:CHANGELOG v0.9).
  - [VERIFIED-BY-ACAD]
- **Bulges.**
  - The bulge on vertex i describes segment i→i+1. The last vertex's bulge describes the closing segment.
  - bulge = tan(sweep/4); negative = clockwise.
  - AutoCAD LIST of bulge 1.0 from (0,10) to (20,10) gives center (10,10), r=10, start 180°, end 0° (ezdxf#409, #461, #826, #758).
  - `bulge_to_arc()` returns CCW ARC angles (start/end swapped for negative bulge). Don't use them as path direction (ezdxf#943, #1180).
  - Bulges ≥ 1 (≥ 180°) cross the 0/360 seam, and ezdxf's Bézier conversion was wrong until 1.1 (ezdxf#927).
  - [REPORTED]
- **AutoCAD draws filled dots** (e.g. DOT arrows, MLEADER dots) as a closed 2-vertex LWPOLYLINE at ±r/2 with bulge 1.0 on both vertices and const width 43 = r. Wide arc segments must fill correctly (ezdxf#461, #793). [REPORTED] (samples: `discussion-461/.../circle_filled.dxf`)
- **Wide polylines.**
  - Tapered segments: an "arrow" made from widths 0,0,5,0 is drawn by AutoCAD 2026 as a real arrow (ezdxf#1352).
  - Collinear back-and-forth segments with width produced a bbox of ±1.1e7 in ezdxf (ezdxf#1078).
  - Zero-length segments and duplicate vertices must not break the trace builder (ezdxf#475).
  - [VERIFIED-BY-ACAD AutoCAD 2026] (samples: `problem line.dxf`, `line_arrow.dxf`, `F2-0511.dxf`, `discussion-475/.../Problem.dxf`)
- **REVCLOUD is not an entity.**
  - It is a closed LWPOLYLINE with all bulges = 0.52056705, plus XDATA `RevcloudProps (1070 0)(1040 arc_length)`.
  - With any other bulge value AutoCAD doesn't treat it as a revcloud.
  - Negative bulges (clockwise) are accepted by BricsCAD and TrueView (ezdxf#1046).
  - [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD]
- **Elevation is 38.** A 2D POLYLINE's elevation is the z of its own group 10 point (ezdxf#427). [REPORTED]

### POLYLINE / VERTEX (2D, 3D, polyface, polygon mesh)
- **Don't draw spline-frame control points.**
  - VERTEX flags: 1 = extra vertex from curve fitting, 8 = spline vertex, 16 = spline frame control point, 32 = 3D polyline vertex, 64 = polyface mesh vertex, 128 = polyface face record.
  - A spline- or curve-fit 2D POLYLINE must draw only the fit vertices (flags 1/8), not the frame control points (16) (ezdxf#1316, #1317).
  - [REPORTED] (samples: `issue-1316/.../Drawing.dxf`)
- **Polyface face records.**
  - Face records (flag 128) have location (0,0,0). Don't treat them as vertices (ezdxf#910).
  - A face index of 0 means an unused 4th vertex, not a vertex at (0,0,0) (ezdxf#589).
  - Faces have 3 or 4 vertices; negative indices mean invisible edges (ezdxf#577).
  - [REPORTED] (samples: `issue-589/.../test.dxf`)
- **Polygon mesh (flag 16) M×N counts** can disagree with the actual vertex count (ezdxf#182). [REPORTED]
- **POLYFACE and polygon MESH are wireframe** in AutoCAD's default 2D view, not filled (ezdxf#174). [VERIFIED-BY-ACAD]
- **Old 2D POLYLINEs are converted to LWPOLYLINE on open** since R14, unless they are curve- or spline-fitted or carry XDATA. 3D polylines always stay POLYLINE (ezdxf#425). [REPORTED]
- **CATIA exports mix 2D and 3D POLYLINEs** (ezdxf#989). Empty POLYLINEs (no vertices) exist in blocks (ezdxf#1377). [REPORTED]
- **Undocumented subclass names:** AcDbPolyFaceMesh, AcDbPolygonMesh, AcDbFaceRecord, AcDbPolyFaceMeshVertex, AcDbPolygonMeshVertex, AcDb3dPolylineVertex (ezdxf:CHANGELOG v0.6/v0.10). [REPORTED]

### MESH, 3DSOLID, REGION, SURFACE
- **An empty MESH** (no vertices/faces) is invalid for AutoCAD and BricsCAD; the Autodesk viewer fails (ezdxf#1219). [VERIFIED-BY-ACAD, VERIFIED-BY-BRICSCAD]
- **MESH from R2000** is accepted by TrueView and BricsCAD, although documented as R2010+ (ezdxf#72). [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD]
- **3DSOLID in R2004** must not carry the AcDb3dSolid subclass (ezdxf:CHANGELOG v0.18). [REPORTED]
- **ACIS data format.** See §16. REGION entities render as nothing in a non-ACIS renderer; AutoCAD shows them (ezdxf#1059, #1060). **UNKNOWN / needs AutoCAD test**: for a PLOT-exact renderer, can REGION/3DSOLID be drawn from SAT edges, or do they need proxy data? [REPORTED] (samples: `issue-1059/.../3B7P-L12100-1.dxf` has REGIONs)

### IMAGE, WIPEOUT, OLE2FRAME, UNDERLAY
- **IMAGE geometry.**
  - Placement: insertion 10, u vector 11, v vector 12 (size and direction of one pixel), and IMAGEDEF image_size.
  - AutoCAD and BricsCAD write u/v with 15–16 significant digits. Rounding to 6 decimals visibly changes rotation (140.555° → 140.539°) (ezdxf#21, #95, #629).
  - [REPORTED]
- **IMAGE flags (70):** 1 show, 2 show when not aligned, 4 use clipping boundary, 8 transparency on. Setting only 8 hides the image; OR it with 1 (ezdxf#14). A user boundary must be closed, or AutoCAD crashes (ezdxf:CHANGELOG v0.8.7). [REPORTED]
- **IMAGE paths.**
  - Images with **relative paths** show as "unreadable" in AutoCAD 2021 and TrueView 2023 until reloaded in the XREF manager. Absolute paths load. The same file saved as DWG loads.
  - Very short `[A-Za-z0-9_]` filenames seem to avoid the problem (ezdxf#27, #845, ezdxf:notes/IMAGE File Paths).
  - [VERIFIED-BY-ACAD AutoCAD 2021, TrueView 2023]
- **IMAGE brightness, contrast and fade** were guessed from an AutoCAD reference file: 50 = neutral, 100/100/100 = white, fade blends to the background. When the file is missing, AutoCAD draws the frame and the file name (ezdxf#999, #1001). [VERIFIED-BY-ACAD reference image; algorithm ASSUMPTION]
- **WIPEOUT** is IMAGE-based.
  - Its clip boundary is in pixel coordinates relative to u/v.
  - AutoCAD paints the background color (the grid is not visible through it) and draws the frame in the entity color.
  - The frame is controlled by the WIPEOUTFRAME setting (ezdxf#205).
  - [REPORTED] (samples: `examples_dxf/wipeout_door.dxf`, `issue-428/.../test.dxf`)
- **OLE2FRAME** holds binary 310 payloads (embedded Excel, bitmaps). TrueView renders the embedded bitmap; ezdxf only draws a rectangle (ezdxf#96, #404, #860, #1097). [VERIFIED-BY-ACAD TrueView] (samples: `issue-860/.../imagetest.dxf`)
- **UNDERLAY** default flags = 10 (on + adjust for background) (ezdxf#834). [REPORTED]

### MPOLYGON (AutoCAD Map)
- **MPOLYGON is a HATCH variant** with no DXF reference documentation.
  - Solid fill color for R2004+; R2000 fill is BYLAYER.
  - Adding a group 63 tag caused "Premature end of object".
  - It has an **offset vector (11) that translates the whole entity** (ezdxf#411, #496).
- BricsCAD displays AutoCAD Map MPOLYGONs correctly but can't create them.
- MPOLYGONs filled via SpatialManager (QGIS → AutoCAD 2020) show gaps in AutoCAD.
- [VERIFIED-BY-BRICSCAD] (samples: `discussion-411/.../mpolygons_*_{2000,2007,2010,2018}.dxf`, `issue-260/.../Italy.dxf`)

### MLINE
- Rendering needs the MLINESTYLE. ezdxf supports MLINE without breaks and fill gaps. QGIS rendered a real file differently from AutoCAD (ezdxf#1135, #1167, ezdxf:CHANGELOG v0.15). [REPORTED] (samples: `discussion-1135/.../dc.dxf`)

### LEADER, MULTILEADER (MLEADER)
- **LEADER.** The arrow comes from DIMLDRBLK, not DIMBLK. LEADERs with only 2 vertices are valid. `hookline_direction` can be an int (ezdxf#321, #180, #187). [REPORTED]
- **MULTILEADER is "very complex, badly designed and not well documented"** (mozman, ezdxf#1278).
  - The text is in the context's MTEXT (raw group 304) (ezdxf#824, #916).
  - Some MLEADERs have **no leaders**, only content (ezdxf#1241).
  - Some have huge arrowheads, which AutoCAD renders differently from the literal size (ezdxf#761).
  - Some have **zero-length leader lines** or a last segment shorter than the arrow. AutoCAD skips such segments and doesn't draw a giant line (ezdxf#1357).
  - [VERIFIED-BY-ACAD screenshots] (samples: `mlead_crash.dxf`, `issue-761/*`, `issue-791/*`)
- **Annotative MLEADER.** The displayed text comes from the annotation-scale context data, not the main content. BricsCAD and TrueView still show the old text after the main MTEXT and the proxy are changed (ezdxf#840). [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD] (samples: `issue-840/.../test.dxf`, AutoCAD 2023)
- **MLEADER with MTEXT columns** (AutoCAD 2020): TrueView 2022 renders it like AutoCAD, while BricsCAD can't even create one (ezdxf#583). [VERIFIED-BY-ACAD TrueView 2022] (samples: `not_good_mleader_example.dxf`)
- **Proxy graphics of MLEADERs are sometimes wrong or useless.**
  - The last leader segment has lineweight 0 (AutoCAD-written, while the native rendering is correct) (ezdxf#283).
  - The dogleg color differs (ezdxf#264).
  - Some contain only a placeholder text "AcDbMLeader" (ezdxf#1241).
  - Render from the MLEADER data where possible.
  - [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD] (samples: `discussion-264/.../MLEADER.dxf`)
- **Block-content MLEADER:** `context.attachment_type` 0 shows as "center extents" in BricsCAD; 1 = insertion point (ezdxf#1213). **R2007 DWG MLEADERs** were lost by ODA conversion, while R2013 was OK (ezdxf#1077). [VERIFIED-BY-BRICSCAD]

### ACAD_TABLE, TOLERANCE, ARRAY, others
- **ACAD_TABLE** is rendered via its anonymous `*T` block. Cell text is readable from the 302 tags in row-major order.
  - Documented for R2007; AutoCAD's R2004 save is structurally different (ezdxf#955, #1068).
  - ezdxf gave up full support as too undocumented (ezdxf:Release Notes v1.0).
  - [VERIFIED-BY-ACAD]
- **TOLERANCE** (feature control frame) has essentially no rendering documentation. The kind of tolerance is encoded in the content string (GDT font codes `{\Fgdt;j}`, `%%v` separators), and overrides come via XDATA DSTYLE (ezdxf#598, #1339, #1365). AutoCAD draws the GD&T symbols with the AMDT Symbols font / `gdt.shx` (ezdxf#336). **UNKNOWN / needs AutoCAD test**: TOLERANCE box layout rules. [ASSUMPTION]
- **Associative ARRAY / rectangular arrays / dynamic blocks** are INSERTs of anonymous `*U` blocks plus ACDBASSOC* objects. The original dynamic-block name lives in XDATA on the anonymous BLOCK_RECORD (ezdxf#1109, #1153, #1325, #863). [REPORTED]
- **LARGE_RADIAL_DIMENSION and ARC_DIMENSION** are separate dxftypes (§10) (ezdxf#168, #506).
- **HELIX, LIGHT, SUN, SECTION, FIELD, FIELDLIST, IMTEXT**: preserve them as raw tags (ezdxf:CHANGELOG v0.8.9, v1.4.2, ezdxf#1138). [REPORTED]
- **CAD apps other than AutoCAD may handle AutoCAD-only entities badly.** A LibreCAD "PLOTSETTINGS" example is in ezdxf#1240. [REPORTED]

## 8. Text and fonts (TEXT, ATTRIB, ATTDEF, STYLE)

### Placement
- **Which point is the anchor.**
  - For LEFT/BASELINE (72=0, 73=0) the anchor is 10 (insert).
  - For every other alignment, CAD apps position by 11 (align point) and ignore 10 (BricsCAD, VariCAD, QCAD) (ezdxf#319, #320).
  - The DXF reference says 10 is "recomputed from 11". But AutoCAD uses the stored 10 when displaying a DWG converted by ODA until the text is edited, and R12 was fine. **Writers must compute and store a correct 10 as well as 11** (ezdxf#688).
  - [VERIFIED-BY-BRICSCAD, VERIFIED-BY-ACAD] (samples: `issue-688/.../123.dxf` + `123.dwg`)
- **The ODA File Converter (24.10, 25.4) loses TEXT alignment** converting ezdxf DXF to DWG: MIDDLE_LEFT becomes BOTTOM_LEFT until the text is moved. BricsCAD's DWG export is fine (ezdxf#1075, #1258). [VERIFIED-BY-ACAD TrueView 2024, VERIFIED-BY-BRICSCAD]
- **FIT and ALIGNED.**
  - Rotation is derived from insert → align point.
  - FIT keeps the height and stretches x. ALIGNED scales the height by the same factor (ezdxf#320, #324).
  - MIDDLE (72=4) behaves like MIDDLE_CENTER.
  - TrueView and BricsCAD render FIT/ALIGNED **slightly narrower than the exact insert–align distance, with a small offset** from the insert point. They lay out by glyph advances, not ink bounds (ezdxf#333).
  - [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD] **UNKNOWN / needs AutoCAD test**: the exact FIT/ALIGNED width formula (advance vs ink box, side bearings).
- **Vertical alignment.**
  - MIDDLE_LEFT/CENTER/RIGHT (73=2): the cap-height midpoint sits on the anchor (ezdxf's "UPPER_CASE_CENTER").
  - TOP (73=3) = cap height.
  - BOTTOM (73=1): BricsCAD and TrueView leave *more* space below the baseline than the font's descender metric (ezdxf#324, #333).
  - [VERIFIED-BY-BRICSCAD, VERIFIED-BY-ACAD TrueView] **UNKNOWN / needs AutoCAD test**: what BOTTOM uses (the font's descent or a fixed fraction of the height).
- **Mirror flags (71: 2 = backward, 4 = upside-down).**
  - For basic alignments, BACKWARD mirrors in x and UPSIDE_DOWN mirrors about the baseline, and AutoCAD renders exactly that.
  - **For FIT/ALIGNED, AutoCAD's BACKWARD is not a plain x-mirror, and BACKWARD+UPSIDE_DOWN applies no mirroring at all.** BricsCAD is wrong differently (ezdxf#353).
  - STYLE 71 can also carry backward; RTL Persian SHX styles rely on it (ezdxf#967).
  - [VERIFIED-BY-ACAD]
- **Extrusion (0,0,−1) on TEXT** has the opposite effect of MIRROR_X. MTEXT reacts to negative extrusion differently from TEXT. When AutoCAD explodes a reflected block, the text reflection disappears (ezdxf#280, #154). [VERIFIED-BY-ACAD]

### Fonts and metrics
- **Text height (40) = cap height.**
  - ezdxf first measured cap height on 'X'. The later fontTools renderer measures on **'A'**, and with that all Latin fonts were "almost pixel perfect" against BricsCAD and TrueView (ezdxf#865, #333, #241).
  - **BricsCAD and TrueView do NOT apply TTF kerning tables** (ezdxf#865).
  - [VERIFIED-BY-BRICSCAD, VERIFIED-BY-ACAD TrueView] (samples: `latin_glyphs.dxf`, `chinese_glyphs.dxf`, `issue-333/.../entity2path.dxf`)
- **CJK fonts scaled by a Latin cap height come out too big.** KaiTi, SimHei and FangSong came out about 1.45× too large via text2path, Microsoft YaHei 1:1. AutoCAD fits SimHei TEXT into a box where ezdxf overflows (ezdxf#705, #733, #1075). **UNKNOWN / needs AutoCAD test**: how AutoCAD sizes CJK TTF glyphs (em-box fraction? OS/2 cap height?). [REPORTED]
- **Fonts with baseline ≠ 0** exist (Gayathri, stylu.ttf, NanumBarunGothic) (ezdxf#241, #245, #246). [REPORTED]
- **Symbol and decorative fonts break naive metrics.**
  - BOUTON has x-height == cap height.
  - Baby Kruffy has x-height = 0.96 cap.
  - AMDT Symbols (AutoCAD's GD&T TTF) makes Matplotlib throw (ezdxf#333, #336).
  - [REPORTED] (samples: `issue-325/.../bouton.dxf`)
- **Per-glyph font fallback.**
  - AutoCAD, TrueView and BricsCAD substitute missing glyphs per character from another font, e.g. Chinese under a Standard style of `arial.ttf`, or ∅ (U+2205) in Arial.
  - When a user edits such MTEXT, AutoCAD inserts `{\fSimSun|…;…}` codes.
  - A pixel-exact renderer needs a glyph-level fallback chain (ezdxf#883, #936, #1032, #1143, #1211).
  - [VERIFIED-BY-ACAD, VERIFIED-BY-BRICSCAD] (samples: `MixedLanguages.dxf`, `discussion-1211/.../test_0.dxf`, `discussion-1032/.../test.dxf`) **UNKNOWN / needs AutoCAD test**: which fallback font AutoCAD picks.
- **Where AutoCAD looks for fonts.**
  - AutoCAD only finds TTFs in `C:\Windows\Fonts`. Per-user installed fonts are silently replaced by txt.shx (ezdxf#865).
  - TrueView can't render `.ttc` fonts at all (ezdxf#733).
  - Autodesk installs TTF look-alikes of SHX fonts (romans → romans__.ttf, txt → txt_____.ttf, isocp → isocp___.ttf) (ezdxf#245, #332, #709).
  - [VERIFIED-BY-ACAD]
- **SHX.**
  - SHX, SHP and LFF stroke fonts are single-line. ezdxf renders them natively since 1.1.
  - SHX files are Autodesk-copyrighted and can't be redistributed. Free Japanese SHX fonts exist (azomix, kst32b) (ezdxf#899, #1033).
  - Big fonts (STYLE 4) are a different format (ezdxf#402, #839).
  - A **shape font** (ltypeshp.shx) used as a text font had no letters and sent ezdxf into an endless loop (ezdxf#1272).
  - [REPORTED] (samples: `issue-1272/*`, `issue-1033/*`)
- **Oblique (51/STYLE 50) and width factor (41)** multiply into the glyph transform. The width factor must not be overwritten by mirroring (ezdxf#280). [REPORTED]
- **No shaping.** Without HarfBuzz, Thai tone marks collide with upper vowels (ezdxf#1387) and Arabic/Hebrew are not shaped or reordered. AutoCAD (online viewer) renders Hebrew MTEXT right-to-left, while BricsCAD can't even create RTL text (ezdxf#1259, #1271). [VERIFIED-BY-ACAD Autodesk Viewer] **UNKNOWN / needs AutoCAD test**: RTL and Thai shaping in PLOT.
- **TEXT with height 0** (ezdxf#789, #1372) is skipped by ezdxf. **UNKNOWN / needs AutoCAD test**: does AutoCAD fall back to the STYLE height, or to TEXTSIZE?

## 9. MTEXT

- **Line spacing.** The default is 5/3 × cap height, baseline to baseline. `line_space_factor` (44) multiplies that (ezdxf:notes/Notes on Rendering DXF Content). [REPORTED, experimentally matched to AutoCAD]
- **Vertical middle attachment** is the midpoint between the first line's x-height top and the last line's baseline (same source). [REPORTED]
- **Wrapping.** MTEXT does not store wrap positions, only the column width (41), so wrapping must be recomputed from font metrics (ezdxf#620). Rules observed:
  - break only at spaces, not at `-` or `_`
  - multiple spaces act as one
  - leading/trailing spaces are ignored for alignment, except leading spaces on the first line
  - a word wider than the column spills over
  - estimated widths need about 1% slack, or extra wraps appear (ezdxf#956)
  - **CJK text must break between characters (kinsoku rules)**; ezdxf only breaks at spaces (ezdxf#1389)
  - [REPORTED; overlay vs TrueView in ezdxf#620]
- **The width in 41/42/43 is not a real extent.** Stored widths of 2.3 million units occur, and MTEXT bboxes from DXF attributes are wrong (ezdxf#1078, #1092). [REPORTED]
- **Inline codes seen in real AutoCAD files** (ezdxf#889, ezdxf:notes/MText format codes):
  - fonts: `\fArial|b1|i1|c0|p34;`, `\fSimSun|b0|i0|c134|p2;`, `\fDengXian|…`
  - colors: `\C152;` (ACI), `\c12285479;` (true color, BGR int)
  - height: `\H0.7x;` (relative) vs `\H150;` (absolute)
  - stacking: `\S1/2;` `\S3#4;` `\S5^6;` (a stacked fraction with `^`, not caret encoding)
  - paragraph: `\pi-3,l3,t3;` `\pxsm2;` `\pq*;` `\pqc;` `\ps*;`
  - others: `\A1;` `\L…\l` `\O…\o` `\K…\k` `\~` `\T` `\Q` `\W` `\X` `\N` (new column) `%%P %%C %%D`, `^I`
  - [REPORTED] (samples: `issue-889/.../test.dxf`)
- **Numeric arguments without a leading zero** (`\W.85;`, `\Q.0;`, `\H.5x;`, `\H2.x;`) occur, especially after the ODA converter. CAD accepts them (ezdxf#1350). [REPORTED] (samples: `mtext_invalid_char_width.dxf`, `mtext_complex_test.dxf`)
- **Invalid escapes** (e.g. `\:`) are rendered by AutoCAD as literal text, and an unterminated `\S` falls back to literal text (ezdxf#197). [VERIFIED-BY-ACAD]
- **An absolute `\H150;` inside a block scaled 0.001** must be scaled by the block scale. BricsCAD views it correctly, but its EXPLODE forgets the scale (ezdxf#855). `\T` (tracking) and `\W` are factors. [VERIFIED-BY-ACAD, VERIFIED-BY-BRICSCAD] (samples: `issue-855/*`)
- **Paragraph indents `\pi,l,r` and tab stops `\pt`.**
  - ezdxf multiplies them by the cap height (ezdxf#855 says they are factors of the text height).
  - Tangent CAD (Chinese architectural software) writes values that look absolute, e.g. `\pi-1440,l1920;` with height 480 (ezdxf#1390).
  - A Chinese AutoCAD file has `\pi-60,l60,t60;` (ezdxf#1252).
  - **CONFLICT:** factor vs absolute. **UNKNOWN / needs AutoCAD test** — decisive for MTEXT layout.
- **Default tab stops** are every 4 × cap height (ezdxf#1372). A cap height of 0 loops forever; char height 0 does occur (ezdxf#1372, #749). [REPORTED]
- **Text-style defaults apply to MTEXT.**
  - The STYLE's width factor (41) and oblique (50) are the base for MTEXT.
  - Not all CADs emit `\W`/`\Q` when they equal the style value.
  - TrueView 2020 and nanoCAD apply the style width factor (ezdxf#1351, #1353).
  - [VERIFIED-BY-ACAD TrueView 2020] (samples: `issue-1351/*`)
- **Rotation.** `text_direction` (11) wins over `rotation` (50) when both are present. Many files store only one (ezdxf#1270). [REPORTED]
- **Background fill (90).** AutoCAD writes value 17, which is undocumented (bit 16 = text frame, R2018+) (ezdxf#207). [VERIFIED-BY-ACAD-written file]
- **R2018 "Embedded Object".**
  - Every AutoCAD R2018 MTEXT carries `101 Embedded Object` with **group 70 = attachment point (= 71)**.
  - AutoCAD LT 2026 anchors the MTEXT at the embedded 70. Writing 1 shifted all 1,391 non-top-left MTEXTs of a 28-sheet drawing (ezdxf#1416, #1417).
  - Group 1 must come **before** the 101 section. Moving it after makes AutoCAD 2018 discard the drawing (ezdxf#40).
  - XDATA must come **after** the embedded object (ezdxf#155).
  - [VERIFIED-BY-ACAD AutoCAD LT 2026, AutoCAD 2018] (samples: `issue-40/.../AC1032.dxf`)
- **Columns (R2018).**
  - Column data sits in the embedded object (in older files, in the extension dictionary). Even a single-column MTEXT has a different structure (ezdxf#558).
  - The column count can differ from the number of linked MTEXTs. `dxf.text` held only the first column (ezdxf#1252).
  - Archicad (via the ODA converter) writes column settings never seen elsewhere (ezdxf#986).
  - [REPORTED] (samples: `MTEXT_import_missing.dxf`, `issue-986/*`)
- **An MTEXT that is only whitespace** must render nothing (ezdxf#830). [REPORTED]

## 10. Dimensions

- **What CAD displays.**
  - CAD apps display the **anonymous geometry block** (`*D<n>`, group 2), not the entity attributes.
  - Changing group 1 (text override) or group 8 has no visible effect until the dimension is regenerated in CAD.
  - `<>` in the block MTEXT shows literally; substitution only happens on regeneration (ezdxf#276, #835, #983, #984, #1015).
  - [VERIFIED-BY-ACAD] (samples: `Before Modification.dxf`, `discussion-984/.../dim.dxf`)
- **Block entities carry their own layers and colors.**
  - When the DIMENSION's layer is changed, freezing the new layer still shows the dimension (ezdxf#1151, #1152).
  - The block MTEXT is often color 0 (BYBLOCK).
  - A DIMENSION with true color 420 whose block MTEXT has none is re-rendered by BricsCAD, ignoring the block (ezdxf#1244).
  - [VERIFIED-BY-ACAD user, VERIFIED-BY-BRICSCAD]
- **DIMENSION without a geometry block** (no group 2) is written by AutoCAD R2018 / ODA (the AutoCAD "Architectural Example (Imperial)" sample) (ezdxf#253, #604).
  - BricsCAD renders dimensions without blocks itself (ezdxf#73, #135).
  - AutoCAD accepts R12 dimensions without blocks, but only without predefined tables (ezdxf#135).
  - A renderer must implement dimension rendering as a fallback, and the fallback must match AutoCAD.
  - [VERIFIED-BY-BRICSCAD] (samples: `architectural_example-imperial.dxf`)
- **Regeneration on edit.**
  - When a user edits a dimension, AutoCAD regenerates it from DIMSTYLE + XDATA overrides. The result can differ from the stored block: text disappears, arrows change, `DIMLFAC 100` multiplies measurements (ezdxf#1145, #1147, #1148, #818).
  - BricsCAD regenerated odd-looking ezdxf dimensions correctly after any property change (ezdxf#1207).
  - [VERIFIED-BY-ACAD AutoCAD 2021, VERIFIED-BY-BRICSCAD]
- **Per-entity overrides** are XDATA `1001 ACAD / 1000 DSTYLE / 1002 { / 1070 <dimvar code> / <1040|1070|1005 value> … / 1002 }`.
  - Handle-type dimvars use 1005 (e.g. `1070 340 / 1005 815` for DIMTXSTY).
  - The same XDATA also appears on TOLERANCE and LEADER (ezdxf#180, #1358, #1365, #1339).
  - [REPORTED]
- **The *D block contains POINTs on layer DEFPOINTS** at the definition points.
  - AutoCAD and BricsCAD include them in zoom extents; one far-away defpoint blew up the extents.
  - Missing POINTs are tolerated (ezdxf#644).
  - [VERIFIED-BY-BRICSCAD] (samples: `dimension_boundingbox.dxf`)
- **DIMENSION insert point (12)** is a translation for the block when the dimension sits in nested blocks or was copied. It explains dimension content that looked "misplaced" (ezdxf#453). [VERIFIED-BY-BRICSCAD] (samples: `test_no_dimension.dxf`, `examples_dxf/dimension_in_nested_blocks.dxf`)
- **Measurement.**
  - ALIGNED (dimtype 1) = |defpoint3 − defpoint2|, unprojected. Group 50 is absent there; Revit writes real ALIGNED dimensions.
  - LINEAR/ROTATED (0) projects onto angle 50.
  - The ANGULAR 2-line sector is chosen by defpoint5 (16) (ezdxf#1415).
  - ezdxf's own `add_aligned_dim()` writes a rotated LINEAR instead.
  - [REPORTED]
- **Numeric robustness.** A near-vertical aligned dimension at x ≈ 250,235 was rendered as "32" instead of "44" because of slope-intercept cancellation (ezdxf#1300, #1398). [REPORTED]
- **Text formatting.**
  - DIMDEC/DIMZIN zero suppression dropped the trailing 0 of "1050" (ezdxf#557, #566).
  - ISO-25 uses a decimal comma ("47,12") (ezdxf#984).
  - For radius dims, the "R" prefix must not be added to user text that has no `<>` (ezdxf#1215).
  - DIMLUNIT=4 (architectural) was ignored by ezdxf (ezdxf#1299).
  - [REPORTED]
- **Colors.** Arrow blocks use DIMCLRD; ezdxf drew them BYBLOCK (ezdxf#898). [REPORTED]
- **ARC_DIMENSION** (AutoCAD R2018) has embedded proxy graphics (160/310), 70=40 and 42 = arc length. Its leader points are 16/17 (ezdxf#505, #506, #984). [REPORTED]
- **LARGE_RADIAL_DIMENSION** (jogged radius) is its own dxftype, documented only in the ODA spec (ezdxf#168). [REPORTED]
- **Subclass names must be exact:** `AcDb3PointAngularDimension`, not `AcDb3dPointAngular…`, and `AcDbOrdinateDimension` (ezdxf#151). [REPORTED]
- **Keep AutoCAD's `*D` blocks.** Re-rendering DIMENSIONs when exploding INSERTs corrupted 12 of 20 dimensions: the oblique default was wrong, DIMSCALE 304.8 got multiplied into the text height (100,584), and parallel rays raised errors (ezdxf#1409, #1410). [REPORTED] (samples: `issue-1410/*`)
- **In paperspace**, a dimension measuring through a viewport needs DIMLFAC = 1/viewport scale (ezdxf#1181). [REPORTED]

## 11. HATCH

### Pattern definition
- **Stored pattern lines are already scaled and rotated.**
  - The pattern line definitions (53 angle, 43/44 base point, 45/46 offset, 49 dashes) are stored **already multiplied by pattern scale (41) and rotated by angle (52)**. 41/52 only record what was applied.
  - AutoCAD 2018 showed scale 1 until the user nudged the scale, when unscaled lines were stored (ezdxf#94).
  - The offset is in rotated WCS form: ANSI31 ISO = 45°, (0,0), (−2.2450640303, 2.2450640303), which is (0, 3.175) rotated 45° (ezdxf#742, ezdxf:notes/Hatch pattern and DXF codes).
  - [VERIFIED-BY-ACAD AutoCAD 2018, VERIFIED-BY-BRICSCAD 2020]
- **AutoCAD renders the lines stored in the file**, not a `.pat` of the same name. A custom pattern showed as ANSI31 because the file held ANSI31 lines (ezdxf#1036, #1037, #1115). [REPORTED]
- **Imperial vs metric.** ezdxf's predefined patterns were 1/25.4 of BricsCAD/AutoCAD's (acad.pat vs acadiso.pat, chosen by `$MEASUREMENT`) (ezdxf#94, ezdxf:CHANGELOG v0.11). [VERIFIED-BY-BRICSCAD]
- **Pattern origin** = the pattern-line base points (43/44). **Seed points (98 + 10/20) are not the origin**; they mark picked regions, and there can be several (ezdxf#768, #1047). [REPORTED]
- **Pattern under transforms.**
  - When a HATCH is transformed (INSERT explode, block transform), the base points must get the **full affine transform as points** (rotation + translation + scale).
  - The rotation of the lines must be the delta, not the absolute angle 52.
  - Measured against AutoCAD plots: ezdxf's missing translation shifted the pattern phase by +0.326 pitch; the fix brought it to +0.004 pitch. 15 of 1,254 compared windows changed, all improvements (ezdxf#1392, #1399, #1402, #1407, #783).
  - Non-uniform scaling of patterns is unsupported in ezdxf: it uses the length of the transformed x unit vector.
  - [VERIFIED-BY-ACAD plot comparison] (samples: `hatches_orig.dxf` + `hatches_exploded_autocad.dxf`, `issue-1392/*`, `issue-1402/*`)
- **Dash semantics.** A dash item > 0 is a dash, < 0 a gap, 0 a dot. Zero-length dashes must be drawn as dots (ezdxf#742, #715, #230). [REPORTED]
- **Very dense patterns.**
  - TrueView shows them at every zoom. ezdxf needs a line limit and a solid-fill fallback below `MIN_HATCH_LINE_DISTANCE` (1e-4), plus a 30 s timeout. 320 s renders happened (ezdxf#618, #929, #1130, #1275).
  - **UNKNOWN / needs AutoCAD test**: does AutoCAD PLOT switch dense patterns to solid (HPMAXLINES = 1,000,000 default)?
  - [VERIFIED-BY-ACAD TrueView] (samples: `issue-618/*`, `issue-1275/.../DenseHatch.dxf`)
- **Pattern lines passing exactly through boundary vertices** produce artifacts. ezdxf jitters the origin by about 1/1000 of the line distance (ezdxf#938). [REPORTED]

### Boundary paths
- **Clockwise arc and ellipse edges (73 = 0)** store start and end angles as **360° − angle**. Convert by negating and swapping. TrueView confirms, including for 3D hatches (ezdxf#175, #482). ARC entities are always CCW, hatch edges not (ezdxf#37, #1193). [VERIFIED-BY-ACAD TrueView]
- **Spline edges without fit points.**
  - `97 0` (fit-point count) must be **present for R2010+** and **absent for R2007**. AutoCAD 2020 refused the other combinations (ezdxf#150, #156).
  - Spline edges from fit points need start/end tangents.
  - [VERIFIED-BY-ACAD AutoCAD 2020] (samples: `issue-156/*` o1021…o1032)
- **Paths are not reliable.**
  - Paths are in no order. Path flags (external/outermost/default) are unreliable for classifying holes, orientation is meaningless, and one HATCH can hold many independent areas. Compute nesting geometrically (ezdxf#455, #671, #573).
  - Edges within an edge path may not be in connection order and may be reversed. Chain them by matching endpoints (ezdxf#466).
  - Edges are often not exactly contiguous (ezdxf#202).
  - Open loops: **AutoCAD and BricsCAD render no hatch for an open edge loop** (ezdxf#454), but AutoCAD renders a boundary with *small gaps* (ezdxf#706). **UNKNOWN / needs AutoCAD test**: the gap tolerance.
  - One edge path containing two closed loops renders "weirdly" but identically in AutoCAD and BricsCAD (ezdxf#454).
  - Overlapping boundary loops: AutoCAD draws a stray line where BricsCAD subtracts cleanly, so the apps differ (ezdxf#454, #708, #225).
  - [VERIFIED-BY-ACAD, VERIFIED-BY-BRICSCAD] (samples: `issue-454/*`, `issue-466/.../hole.dxf`, `issue-706/*`)
- **Textbox flag (8).** Boundary paths with this flag are holes left for text. A stand-alone text box at top level should be ignored, and one crossing fill and hole needs splitting (ezdxf#573). [VERIFIED-BY-BRICSCAD] (samples: `issue-567/.../power_unit_1.dxf`)
- **Edge type 0 (72=0) is invalid** but appears. MS Visio: TrueView opens the file, BricsCAD crashes (RECOVER fixes 246 errors). LibreDWG also writes it (ezdxf#836, #721). [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD] (samples: `issue-836/*`)
- **Full circles** appear as a single ArcEdge 0..360, or −180..180 (ezdxf#302, #328, #464). [REPORTED]
- **18,689 boundary paths in one HATCH** occur (ezdxf#689). [REPORTED]
- **HATCH has no border line**; a visible outline is a separate entity (ezdxf#268, #691). [REPORTED]
- **BricsCAD sometimes fails** on hatches with closed SPLINE-edge inner paths, where TrueView is correct (ezdxf#344). [VERIFIED-BY-BRICSCAD, VERIFIED-BY-ACAD TrueView]
- **HATCH with extrusion (0,0,−1)** has negated OCS x in its boundary (ezdxf#736). R2018 wants 210 present (ezdxf:CHANGELOG v0.15). [REPORTED]

### Color and fill
- **Solid fill color.** Use ACI/true color. ezdxf's renderer added fake transparency to hatches (ezdxf#470).
- **AutoCAD PDFIMPORT** writes SOLID HATCHes with 440 = 0x0200007F (alpha 127, about 50%) and true color 421 (ezdxf#315). [REPORTED] (samples: `Page8Scaled.dxf`)
- **Gradient fills:** none seen in these threads. **UNKNOWN / needs AutoCAD test**.

## 12. Linetypes

- **Scale.** Patterns are in drawing units: LTSCALE × CELTSCALE × entity 48. They are not screen-space dashes (ezdxf#230, #562). [REPORTED]
- **PSLTSCALE.**
  - 1 (default): in paperspace viewports, patterns are scaled by the viewport scale so dashes have the same *paper* length.
  - 0: model units, with no viewport scaling. ezdxf always behaved as 1 (ezdxf#1386).
  - [REPORTED] **UNKNOWN / needs AutoCAD test**: interaction with LTSCALE in paperspace and MSLTSCALE.
- **Pattern details.**
  - A 0-length element is a dot; AutoCAD draws a dot, not nothing (ezdxf#230).
  - 40 = total pattern length and 49 = element lengths. ezdxf's API dropped the first element when fed `[6.35, -3.175]` (the API expects [total, …]) (ezdxf#1310).
  - [REPORTED]
- **AutoCAD's standard definitions.** These were measured from 120 AutoCAD-written DWGs (acad.lin, imperial):
  - DASHED `0.5,-0.25`, DASHED2 `0.25,-0.125`, DASHEDX2 `1,-0.5`
  - DASHDOT `0.5,-0.25,0,-0.25`, DASHDOT2 `0.25,-0.125,0,-0.125`, DASHDOTX2 `1,-0.5,0,-0.5`
  - DIVIDE `0.5,-0.25,0,-0.25,0,-0.25`, DIVIDE2 `0.25,-0.125,0,-0.125,0,-0.125`, DIVIDEX2 `1,-0.5,0,-0.5,0,-0.5`
  - DOT `0,-0.25`, DOT2 `0,-0.125`
  - CENTER2 `0.75,-0.125,0.125,-0.125`, CENTERX2 `2.5,-0.5,0.5,-0.5`
  - CENTER, PHANTOM, PHANTOM2 and HIDDEN match ezdxf's table. Metric variants are ×25.4 (HIDDEN2 `3.175,-1.5875`).
  - **ezdxf's `standards.linetypes()` table is wrong** for the listed ones (ezdxf#1411).
  - [VERIFIED-BY-ACAD (files written by AutoCAD)]
- **Complex linetypes.**
  - Shapes: 74=4, 75=shape number, 340 → the shape-file STYLE, 46 scale, 50 rotation, 44/45 offsets.
  - Text: 74=2 or 10, where bit 8 is probably "upright". It has 340 → STYLE and 9 = text, which may contain `\`. Rotations like 357.8° appear (ezdxf#809).
  - AutoCAD asks for a replacement SHX when the shape file is missing (ezdxf#284, #292, #737).
  - Only AutoCAD and very compatible apps show them (ezdxf#737).
  - [REPORTED, VERIFIED-BY-ACAD for the missing-shape prompt] (samples: `discussion-809/.../complex_lines.dxf`, `issue-737/*`)
- **Undefined linetypes.** An undefined linetype name on an entity renders as continuous in lenient viewers (ezdxf#468), but on a LAYER it is fatal for AutoCAD (§4).
- **Line caps and joins** are not stored in entities. They come from the CTB (END_STYLE butt 0 / square 1 / round 2 / object 4; JOIN miter 0 / bevel 1 / round 2 / object 5) and `$ENDCAPS`/`$JOINSTYLE`. AutoCAD plots round caps via the CTB default; BricsCAD always uses round (ezdxf#607, ezdxf:notes/Line Cap- and Join Styles). [REPORTED] **UNKNOWN / needs AutoCAD test**: the cap/join AutoCAD PLOT uses with `monochrome.ctb` / no CTB.
- **Entity linetype scale 48 = 0.0001** occurs in AutoCAD Architecture exports (ezdxf#475). [REPORTED]

## 13. Blocks, INSERTs, attributes, XCLIP

- **Layer "0" and BYBLOCK inside blocks.**
  - A block entity on layer 0 with BYLAYER color takes the INSERT's layer color, and it is visible iff the INSERT's layer is visible.
  - An entity on layer L uses L's properties and visibility, whatever the INSERT's layer.
  - BYBLOCK outside any block resolves to white/black by background (ezdxf:notes/Notes on Rendering DXF Content, ezdxf#193, #544).
  - [REPORTED, experimentally vs AutoCAD]
- **Draw order.**
  - An INSERT is atomic in draw order: entities of two INSERTs never interleave.
  - Inside an INSERT, the order is the block's entity order, or its SORTENTSTABLE.
  - The default order is ascending handle. TrueView ignores the `draw viewports first` plot flag (ezdxf#634, #717).
  - [VERIFIED-BY-ACAD TrueView]
- **ATTRIBs are drawn after all block entities**, on top of hatches, regardless of ATTDEF order (ezdxf#1321). [VERIFIED-BY-ACAD TrueDWG/nanoCAD reference] (samples: `text_under_hatch.dxf`)
- **ATTRIB placement and ATTDEF role.**
  - ATTRIBs are in the **parent's coordinates**, not block-relative. They are not re-transformed by the INSERT (ezdxf#143, #925).
  - An ATTRIB doesn't need an ATTDEF (ezdxf#44).
  - Constant ATTDEFs (70 bit 2) get no ATTRIB, so draw them from the block (ezdxf#13).
  - ATTDEFs outside blocks show their tag in AutoCAD (ezdxf#87, #280).
  - [REPORTED; VERIFIED-BY-ACAD for #280]
- **ATTRIB visibility.**
  - It is flag 70 bit 1. **Group 60 invisible=1 does NOT hide an ATTRIB in AutoCAD** (ezdxf#648).
  - ATTRIB visibility is independent of the parent INSERT's invisible flag (ezdxf#504).
  - `$ATTMODE` 0 hides all; 1 is normal (ezdxf#726).
  - [VERIFIED-BY-ACAD for 60]
- **BLOCK flag 70 bit 2 (has attribute definitions)** must be set when the block has non-constant ATTDEFs. Otherwise AutoCAD INSERT/ATTSYNC/BATTMAN see "no attributes". BricsCAD ignores the flag (ezdxf#218). [VERIFIED-BY-ACAD]
- **ATTRIB/ATTDEF carry group 280 twice** in AcDbAttribute: version (first, always 0) and lock_position (last). Writing them wrongly makes TrueView 2023 reject the file, and AutoCAD 2024 RECOVER fails too; BricsCAD accepts it. Parse by position (ezdxf#907). [VERIFIED-BY-ACAD TrueView 2023 / AutoCAD 2024] (samples: `issue-906/*`, `issue-907/*`)
- **Multi-line ATTRIB/ATTDEF (R2018).**
  - They embed an MTEXT after `101 Embedded Object`.
  - The ATTRIB's group 1 may be empty or out of sync, so render the embedded MTEXT (ezdxf#258, #1191, #1216, #1222).
  - BricsCAD instead writes two separate ATTRIBs. TrueView 2022 draws some embedded MTEXT attributes differently from AutoCAD (ezdxf#258, #931).
  - The DXF R2018 reference for ATTRIB (the AcDbXrecord "secondary attributes") is wrong.
  - [VERIFIED-BY-ACAD TrueView 2022, VERIFIED-BY-BRICSCAD] (samples: `issue-258/*` incl. AutoCAD saves R2000–R2013)
- **MINSERT** (70/71 column/row counts, 44/45 spacing) expands into a grid (ezdxf#206). [VERIFIED-BY-ACAD screenshot]
- **INSERT invisible (60)** hides the reference (ezdxf#465). [REPORTED]
- **INSERT of a non-existent block** is a structure error. XREF blocks are empty blocks (ezdxf#183). [REPORTED]
- **Block base point far from the geometry** is common in AutoCAD blocks (ezdxf#925). [REPORTED]
- **Dynamic blocks.**
  - References point to anonymous `*U###` blocks that contain the geometry of *all* visibility states, plus entity invisible flags. The named definition has no INSERTs (ezdxf#465, #863).
  - After an ezdxf re-save, AutoCAD showed all visibility states overlaid (ezdxf#653, #669).
  - A hard-owned `AcDbRepData` entry holds an unresolved handle string (ezdxf#850).
  - Clipboard copy loses the dynamic features if DICTIONARY 280 flags are wrong (§5).
  - [REPORTED] (samples: `Desks_021.dxf`)
- **XCLIP (SPATIAL_FILTER).**
  - Structure: INSERT xdict → `ACAD_FILTER` (hard-owned) → DICTIONARY → `SPATIAL` → SPATIAL_FILTER (R2000+).
  - 70 = count (2 = rectangle corners); 10 = vertices in OCS (210); 11 = origin; 71 = clip on; 72/73 = front/back flags, with 40/41 written *only* when enabled (AutoCAD dislikes them otherwise).
  - Two 12-float 40 matrices follow: `inverse_insert_matrix` and a clip transform.
  - The boundary stays at its XCLIP-time location when the INSERT moves. Clip test: block coordinates = inverse_insert_matrix × boundary.
  - Inverted clips are stored via `ACAD_XREC_ROUNDTRIP` / `ACAD_INVERTEDCLIP_ROUNDTRIP`. A malformed one makes AutoCAD fail with "Xdata wasn't read"; BricsCAD accepts ezdxf's.
  - (ezdxf:notes/SPATIAL_FILTER, ezdxf:notes/XCLIP, ezdxf#1007, #1084, #1285) [VERIFIED-BY-BRICSCAD; AutoCAD error REPORTED] (samples: `examples_dxf/xclip.dxf`, `issue-1305/.../sp_test.dxf`, `test_fix_clipping.dxf`)
- **XCLIP clipping in real files.** A 59 MB file clipped most of its modelspace with SPATIAL_FILTERs; without them ezdxf drew everything (ezdxf#992). **Clip stacks must be scoped** push/pop per nested INSERT; an imbalance made all output vanish (ezdxf#1382). [VERIFIED-BY-ACAD screenshot]
- **`$XCLIPFRAME` values.** **CONFLICT**:
  - ezdxf:notes/SPATIAL_FILTER says 0 = hidden, 1 = displayed but not plotted, 2 = displayed and plotted.
  - ezdxf:notes/XCLIP, quoting AutoCAD help, says 1 = displayed and plotted, 2 = displayed but not plotted.
  - **UNKNOWN / needs AutoCAD test.**
- **Purging.** Arrow blocks, `*D` blocks, `*T` blocks and layout blocks are referenced only by handle or implicitly. Naive "unused block" deletion breaks drawings. A full reference count matched BricsCAD PURGE (86.5 MB → 2.3 MB) (ezdxf#1184, #1188). [REPORTED]

## 14. Layouts and VIEWPORTs

- **Where the entities live.**
  - Modelspace plus the *active* paperspace sit in ENTITIES. Other layouts are in `*Paper_Space<n>` blocks; the user-visible names are in the LAYOUT objects (ezdxf#823, #1014).
  - AutoCAD won't open a DXF without an active paperspace layout (ezdxf#1019).
  - [REPORTED]
- **Layout names are case-insensitive.** The ODA converter writes "MODEL" instead of "Model" (ezdxf#216). [REPORTED]
- **VIEWPORT transform.**
  - The view center (12/22) is in DCS relative to the view target (17/27/37). It is not a WCS point.
  - Panning inside a viewport changes both, and content shifts if 12 is used as the WCS center (ezdxf#1318, #1319).
  - Include twist (51) and view height (45). The view direction (16/26/36) may be non-normalized (ezdxf#1298), and a null view direction means (0,0,1) (ezdxf#554).
  - [VERIFIED-BY-ACAD TrueView/"TrueDWG", nanoCAD] (samples: `issue-1318/.../Gasket.dxf`, `pr-1319/*` incl. `twisted_viewport_modelspace_limits.dxf`)
- **VIEWPORT status (68) and id (69) are unreliable.**
  - In one file every VIEWPORT inside paperspace blocks had id 0.
  - A user reports that AutoCAD writes status 0 for viewports of layouts not activated during the session.
  - TrueView and BricsCAD still render such viewports (ezdxf#1014, #1362).
  - [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD] (samples: `issue-1362/.../layouts.dxf`) **UNKNOWN / needs AutoCAD test**: exactly which viewports PLOT draws (on/off flag 90 bit 17? status?).
- **The overall paper viewport** has id 1 (68 1, 69 1) and is not drawn as content (ezdxf#1014). [REPORTED]
- **Viewport borders.** All CADs draw the VIEWPORT border as ordinary geometry in draw order; later paperspace entities draw over it (ezdxf#1318, #1320). **UNKNOWN / needs AutoCAD test**: is the border plotted (it depends on the viewport's layer plot flag)? [REPORTED]
- **Non-rectangular viewport clipping:** 90 bit 0x10000 plus 340 → clip entity (ezdxf#401, #1031). [REPORTED] (samples: `discussion-1031/.../A_000217.dxf`)
- **Per-viewport overrides.**
  - Per-viewport frozen layers (341) behave like BricsCAD (ezdxf#1031).
  - Per-VP layer overrides are stored on the LAYER (§4).
  - Each layout can have its own CTB/STB (ezdxf#535).
  - [VERIFIED-BY-BRICSCAD]
- **LAYOUT limits (10/11)** in Revit exports are defaults ((0,0)–(12,9)) while the viewports are far bigger, and AutoCAD extends the paper. Don't trust them (ezdxf#864). [REPORTED] (samples: `issue-864/*`)
- **An empty `plotter_configuration_file`** means the default plotter (ezdxf#1099). Very long CTB names broke ezdxf (ezdxf#1273). [REPORTED]
- **An AutoCAD freeze when editing TEXT in paperspace** of an ezdxf VIEWPORT test file stayed unexplained. BricsCAD was fine (ezdxf#754). [REPORTED]

## 15. Colors, lineweights, plot styles

- **ACI.**
  - 0 = BYBLOCK, 256 = BYLAYER, 257 = BYOBJECT.
  - 7 is white on a dark background and black on a light one, including via BYLAYER on a color-7 layer (ezdxf#53, #108, #227, #1030).
  - A negative layer color = layer off (ezdxf#410).
  - AutoCAD refuses color −1 on an entity; BricsCAD treats it as 256 (ezdxf#199).
  - [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD]
- **Palettes differ between apps and spaces.**
  - An ACI palette extracted from AutoCAD 2020 screenshots shows that **modelspace and paperspace palettes differ** for many dark shades, e.g. ACI 110 = 0x135817 in modelspace vs 0x132617 in paperspace, and also 250–255 (ezdxf#447, #448, #1277).
  - TrueView shows ACI 250 as black and 255 as white in both spaces. BricsCAD's 250 is dark grey. **The grey ramp is vendor-specific** (ezdxf#470, #1030).
  - 255 is described as white in model but grey in paper (ezdxf#544). That conflicts with ezdxf#1030.
  - [VERIFIED-BY-ACAD AutoCAD 2020 / TrueView / LT 2021, VERIFIED-BY-BRICSCAD] **UNKNOWN / needs AutoCAD test**: the plotted RGB of every ACI through a PNG plotter, with and without `monochrome.ctb`. This is the key calibration test.
- **CTB beats the background rule.** A CTB entry for ACI 7 wins over the background rule: AutoCAD 2025 plotting with a CTB mapping 7→black gives black, where ezdxf drew white. Track which ACIs a CTB actually overrides; "use object color" can't be told apart from an explicit value once the table is filled with defaults (ezdxf#1401). [VERIFIED-BY-ACAD AutoCAD 2025 plot]
- **CTB/STB files.** They are zlib-compressed text with undocumented appendices, e.g. `0=0.0076200000000 (+7.Z+"8V?S_LC )` in `custom_lineweight_table` (ezdxf#1069). The CTB name is in the LAYOUT/PLOTSETTINGS (ezdxf#1051). [REPORTED]
- **True color** (420, 0x00RRGGBB) always overrides ACI (ezdxf#144, #544). True color and transparency need R2004+ (ezdxf#1294). IntelliCAD honours hatch 420 (ezdxf#1342). [REPORTED]
- **Transparency (440):** 0x02000000 | alpha (0–255). BYLAYER/BYBLOCK must be resolved (ezdxf#315, ezdxf:CHANGELOG v0.16.3). **UNKNOWN / needs AutoCAD test**: PLOTTRANSPARENCY and how plotted alpha maps.
- **Lineweights.**
  - Valid values: −3 DEFAULT, −2 BYBLOCK, −1 BYLAYER, and 0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211 (1/100 mm). TrueView rejects others such as −116 (ezdxf#256).
  - **0 = the thinnest printable line** (1 px); BricsCAD plots it (ezdxf#226).
  - 211 displays correctly in BricsCAD and TrueView (ezdxf#683).
  - They show on screen only with LWDISPLAY; plots always apply them (ezdxf#490, #797).
  - [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD]
- **AutoCAD DWG-to-PDF** writes layers as PDF optional-content groups and keeps text as real, selectable text (ezdxf#582, #1154, #1158). [REPORTED]

## 16. Proxies, ACIS, custom objects

- **Proxy graphic binary format.**
  - Header: int32 total length, int32 command count. Each command: int32 size, int32 opcode, then arguments.
  - Opcodes: 1 extents, 2/3 circles, 4/5 arcs, 6 polyline, 7 polygon, 8 mesh, 9 shell, 10/11 text, 12 xline, 13 ray, 14 color, 15/16 layer, 17/18 linetype, 19 marker, 20 fill, 22 true color, 23 lineweight, 24 ltscale, 25 thickness, 26 plotstyle, 27/28 push/pop clip, 29–31 transforms, 32 polyline with normal, 33 LWPOLYLINE, plus an elliptic arc.
  - All values are little-endian. Use explicit `<` struct formats: `L` was 8 bytes on Linux (ezdxf#295).
  - A size-0 chunk must end parsing, or it loops forever (ezdxf#1286).
  - (ezdxf:notes/Proxy Graphic Binary Chunk) [REPORTED]
- **Where proxy graphics live.**
  - In ACAD_PROXY_ENTITY they are in subclass AcDbProxyEntity. The length tag is 92 or 160 independent of version (an R2010 file used 160) (ezdxf#978).
  - Text inside proxy graphics uses `$DWGCODEPAGE` for pre-R2007 files (ezdxf#991, #998).
  - [REPORTED]
- **Undocumented proxy primitives.**
  - LWPOLYLINE with const width, as in MLEADER dot arrows. It differs from the ODA spec (ezdxf#793).
  - Elliptic arcs, from AutoCAD Plant3D (ezdxf#832).
  - SHELL (ezdxf#502).
  - [REPORTED] (samples: `issue-793/*`, `issue-832/*`, `issue-502/*`)
- **Proxy semantics.**
  - Polyline primitives with the fill flag set must **not** be filled; AutoCAD Plant3D pipes showed spurious hatches (ezdxf#906).
  - CIRCLE primitives with normal (0,0,−1) have the center in WCS, and OCS handling in proxies is unclear (ezdxf#873).
  - BYBLOCK color 0 inside proxies got resolved as black (ezdxf#1326).
  - AEC door arcs in proxies came out drawn the wrong way (ezdxf#497).
  - [VERIFIED-BY-ACAD TrueView] (samples: `issue-906/*`, `issue-873/.../inverted_extrusions.dxf`, `issue-1326/*`, `issue-497/*`)
- **Exploded proxies.** A file of ACAD_PROXY_ENTITYs exploded into proxy graphics was refused by TrueView 2023 but accepted by BricsCAD (ezdxf#906). [VERIFIED-BY-ACAD TrueView 2023, VERIFIED-BY-BRICSCAD]
- **Proxies without graphics.** Tangent (Chinese TCH architecture) ACAD_PROXY_ENTITYs carry no proxy graphics; AutoCAD and BricsCAD can't show them either (they display a "download the Tangent plugin" note) (ezdxf#847). [VERIFIED-BY-ACAD TrueView, VERIFIED-BY-BRICSCAD] (samples: `issue-847/*`)
- **AEC objects** (AutoCAD Architecture walls, doors, spaces) render only via proxy graphics (ezdxf#495, #497, #591). Proxy graphics contain primitives only, never blocks or hatches (ezdxf#591). [VERIFIED-BY-ACAD screenshots]
- **Getting proxy graphics.** BricsCAD always writes proxy graphics for an MLEADER with block content. That is a trick to obtain BricsCAD's proxy representation of any entity (ezdxf#906). [VERIFIED-BY-BRICSCAD]
- **ACIS.**
  - R2000–R2010 store SAT text, obfuscated per character as `159 − c` with spaces kept.
  - R2013+ store SAB binary as hex in the `ACDSDATA` section (`ASM_Data`, "ASM BinaryFile4").
  - Subclasses: `AcDbModelerGeometry` / `AcDb3dSolid` (ezdxf#1074, #1173, #677).
  - ezdxf can't edit ACIS and transforms it by wrapping it in an anonymous block (ezdxf:CHANGELOG v1.3.0).
  - [REPORTED] (samples: `discussion-1173/.../board.dxf`)
- **Civil 3D plans all carry proxy graphics** (ezdxf#1412). [REPORTED]

## 17. Performance findings

- **Loading.** ezdxf reads tags at roughly 1.4M tag pairs per 83 MB. A fused read-and-convert loader gave −28% on tag loading and −14% on the whole document; separate Cython loaders gained nothing, since the work is I/O and allocation bound (ezdxf#1343, #1413). [REPORTED]
- **Memory.** Keeping all tags as Python tuples cost about 5 GB for a 200 MB DXF (ezdxf#19). [REPORTED]
- **Writing.** 200k POINTs: add 6.5 s, export 14 s in CPython, 4.8 s total in PyPy. Writing is 60–70% of the time (ezdxf#135). [REPORTED]
- **Block expansion is the real bottleneck.** F397.dxf has 50k entities that become 1M+ virtual entities (AutoCAD EXPLODE shows 1M too). It needed 24 GB in the Matplotlib backend and 85 s / 16 MiB with a direct-to-raster Pillow backend (ezdxf#699). [REPORTED] (samples: `F397.dxf`)
- **Rendering.**
  - Text is a hot spot. Cache glyph paths per font+string with an unbounded, backend-owned cache; an LRU cache gives a 100% miss rate on redraw (ezdxf#234, #235).
  - Batching line segments turned 13 s into 1.7 s. Reusing one PDF shape was 38× faster (ezdxf#237, #1292).
  - Pattern hatches as individual segments are slow (41 s vs 4 s after batching) (ezdxf#715).
  - Bboxes of about 8k MTEXTs took 30 s (ezdxf#1107).
  - [REPORTED]
- **Compression.** A 145 MB Civil 3D DXF compresses to 12 MB with 7z (ezdxf#365). [REPORTED]

## 18. Writer checklist: things AutoCAD rejects

Each item below made AutoCAD, LT or TrueView refuse a file or misbehave. Citations are in the sections above.

1. An undefined linetype on a LAYER, or a linetype named "None" (§4).
2. TEXT/ATTRIB referencing an undefined STYLE (§4).
3. An XDATA appid missing from the APPID table (§1).
4. An appid on BLOCK_RECORD missing from APPID (`AcDbDynamicBlockGUID`) (§1).
5. `$XCLIPFRAME` written as 280 or with value 2 for R2007 and older; `$ACADMAINTVER` as 90 for pre-R2018 (§3).
6. MTEXT group 1 after `101 Embedded Object`; XDATA before the embedded object; embedded 70 ≠ 71 (misplaced text) (§9).
7. ATTRIB/ATTDEF without the double 280 version/lock_position layout (§13).
8. HATCH spline edge 97 presence per version (§11).
9. LWPOLYLINE 90/70 outside AcDbPolyline (it reads as not closed) (§7).
10. CLASS entries without 280/281 (§1).
11. An empty MESH (§7); an IMAGE with an open clip boundary (§7); an ELLIPSE ratio above 1.0 (§7).
12. A TEXT value ending in `^`; a raw newline in a value (§2, §1).
13. Wrong subclass names (§10); missing subclass markers (ezdxf#604).
14. Dangling dictionary handles, or R2000 files referencing VISUALSTYLEs: these break Copy-to-clipboard (§5).
15. DICTIONARY hard-owner flags: wrong flags crash COPYCLIP and lose dynamic blocks and XCLIP on paste (§5).
16. BLOCK flag bit 2 not set for blocks with ATTDEFs: ATTSYNC/BATTMAN break (§13).
17. A malformed inverted XCLIP XRECORD, and SPATIAL_FILTER 40/41 written while disabled (§13).
18. No active paperspace layout (§14).
19. A layout/VPORT view that doesn't cover the content: the file opens "empty" (§3).
20. Relative IMAGE paths: "unreadable" until reloaded (§7).
21. Block names with a space in R12 (§4).

Things AutoCAD **tolerates** that a strict reader might reject:
- dangling LAYOUT/BLOCK_RECORD links (QGIS)
- PLOTSETTINGS without an owner
- an OBJECTS section in R12
- missing LAYER entries
- wrong-type DIMSTYLE handles
- GROUPs holding table entries
- xdata codes inside entity bodies from Map 3D
- extra spaces after structure tags

## 19. Producer quirk index

| Producer | Quirks (see sections) |
|---|---|
| **AutoCAD** (reference) | MTEXT bg_fill 17 (#207). DIMENSION without block via ODA/R2018 (#253). DIMSTYLE→ACDBPLACEHOLDER (#643). Embedded-object MTEXT (#40, #1416). Multi-line ATTRIB embedded MTEXT (#258). MLEADER proxy with lw 0 (#283). Annotative context data (#840, #961). Faulty 3DFACE "lines" (#621). Repeated knots from JOIN (#1028). Map 3D/Civil 3D xdata codes in bodies (#30). Status-0 viewports (#1362). PDFIMPORT transparency (#315). |
| **AutoCAD Plant3D / Architecture / Civil 3D** | Proxy elliptic arcs (#832). Fill flag on proxy polylines (#906). AEC proxies (#495, #591). Thousands of undocumented objects (#365). Proxy graphics everywhere (#1412). |
| **BricsCAD** | Layer description XDATA form (#148). Writes two ATTRIBs for multi-line (#258). Tolerant: accepts files AutoCAD rejects (#114, #157, #906, #1016). Own ACI grey ramp (#470, #1030). Round caps always (notes). |
| **ODA File Converter** | `MODEL` layout name (#216). `^J` newlines (#170). MIF `\M+` on Linux (#932). 24.11/24.12 Windows CJK mojibake (#1018). Loses TEXT alignment and MLEADER R2007 (#1075, #1077). Leading-zero-less MTEXT numbers (#1350). Non-ASCII in SAT (#690). |
| **LibreDWG** | Lineweight −116, orphan 10/31 tags, raw line breaks in header strings, SPLINE tangent (0,0,0) (#252, #256). Unnamed BLOCKs (#1136). Misplaced root dictionary, HATCH edge type 0, dangling dictionary entries, blank lines (#721). MTEXT chunk order (#889). |
| **LibreCAD / QCAD** | Open SPLINE with the closed flag and extrusion (0,0,0) (#851). PLOTSETTINGS without owner (#1240). STYLE XDATA family (#243). Old LINE coordinate order (#601). Unreliable as viewers. |
| **QGIS** | Fixed-handle OBJECTS section, dangling LAYOUT links (#997). |
| **CloudCompare (dxflib)** | R12 with an OBJECTS section, no handles (#278). |
| **MS Visio** | HATCH edge type 0, 246 errors in BricsCAD RECOVER (#836). |
| **Inkscape** | `$HANDSEED FFFF`, no owners/layouts, dangling pointers (#1024); PDF→DXF with 15× duplicated lines (#971). |
| **Revit** | Real ALIGNED dimensions without 50 (#1415). Default LAYOUT limits (#864). |
| **Archicad** (via ODA) | Unusual MTEXT columns in dimension text (#986). |
| **Tangent (TCH)** | Proxies without graphics (#847). Absolute `\pi` values (#1390). |
| **Gerber / Browzwear (ASTM D6673)** | R12 with subclass markers, no TABLES, TEXT without group 1, block names with spaces (#789, #853). |
| **VectorWorks 2012** | ANSI_932 encoding (#88). |
| **ProE** | Integer codes written as floats, no owners (CHANGELOG v0.6.1). |
| **SolidWorks** | 6th-decimal coordinate noise (#659). |
| **KLayout** | zlib-compressed `.dxf` (#531). |
| **CATIA** | Mixed 2D/3D POLYLINEs (#989). |
| **Autodesk Inventor (IDW)** | `*`-prefixed layer names (#995). |
| **CAD-T (AutoCAD add-on)** | Nested-looking 102 groups in XRECORD (#161). |
| **"acdgnlsdraw" DGN import** | Duplicate handles, missing group 2 (#833). |
| **Metal-forming simulators, C# exporters** | ENTITIES-only files; R12 with R13 markers (#1139, #1106). |

## Notable sample files

These are attachments from ezdxf threads, downloaded into `samples/external` (see `samples/external/manifest.jsonl`: `source` is `github/mozman__ezdxf`, or the file is listed under `duplicates`). Most are **GitHub attachments with unknown license, for internal testing only**.

- **Version / producer tag** comes from the manifest's heuristic producer detection. "AutoCAD-like" means the file looks AutoCAD-written; it does *not* prove it.
- **Two paths contain CJK characters** that the manifest stores mangled, so they are shown as `*.dxf` in their directory.
- **Many threads also contain screenshots** of the same file in AutoCAD, TrueView or BricsCAD. Those screenshots are the only AutoCAD "ground truth" until we generate our own PLOT output.
- **Missing files.** Useful files that are not in the corpus:
  - `examples_dxf/caret_encoding.dxf` (#198/#199)
  - `text_negative_extrusion.dxf`, `columns.dxf` (#280)
  - `visibility.dxf` (#193)
  - the `FIT_ALIGNED_TEXT.dxf` link (#320)
  - `viewport_frozen_layers.dxf` (#1031): the corpus copy is an HTML page, not a DXF
  - `research/repos/ezdxf/examples_dxf/` has all of these except `FIT_ALIGNED_TEXT.dxf`: `caret_encoding.dxf`, `text_negative_extrusion.dxf`, `columns_R2007/R2018.dxf`, `mtext_columns_R2000/2007/2018.dxf`, `visibility.dxf`, `viewport_frozen_layers.dxf`. Most are ezdxf-written, which is useful as input but not as ground truth.

| # | Corpus path (`samples/external/...`) | Thread | Version / producer tag | What it exercises | Why valuable |
|---|---|---|---|---|---|
| 1 | `files/github/mozman__ezdxf/issue-9/2775168_all_arrows_extracted/all_arrows.dxf` | ezdxf#9 | R2013 / AutoCAD-like | all dimension arrow blocks + 69 INSERTs, R2013 | copy/paste confirmed OK in AutoCAD Map 3D 2017: known-good writer reference for arrow blocks |
| 2 | `files/github/mozman__ezdxf/issue-9/4124449_52848_IN_2D_Eng.dxf_ezdxf.7_extracted/52848_IN_2D_Eng.dxf_ezdxf (7).dxf` | ezdxf#9 | R2004 / ? | R2004 file whose root dicts point at missing VISUALSTYLEs | AutoCAD 2020 "Copy to clipboard failed" repro; negative writer test |
| 3 | `files/github/mozman__ezdxf/issue-40/2274801_acad_extracted/AC1032.dxf` | ezdxf#40 | R2018 / AutoCAD-like | AutoCAD-written R2018 MTEXT (group 1 before 101 Embedded Object) | shows the tag order AutoCAD needs; AC1027.dxf is the R2013 sibling |
| 4 | `files/github/mozman__ezdxf/issue-52/2460020_dxf_test_extracted/test.dxf` | ezdxf#52 | R14 / ? | R14 file (LINE, MTEXT, INSERT) | R13/R14 legacy parsing; CLASS 280/281 needed when upgrading |
| 5 | `files/github/mozman__ezdxf/issue-80/3125460_leader_extracted/leader.dxf` | ezdxf#80 | R13 / AutoCAD-like | R13 LEADER with MTEXT annotation | rare R13 file with LEADER and annotation link |
| 6 | `files/github/mozman__ezdxf/issue-114/4074339_test_AC101x_extracted/test_AC1014.dxf` | ezdxf#114 | R14 / ? | LWPOLYLINE in a file labelled AC1014 | TrueView 2020 refuses it, BricsCAD opens it: version/feature gating |
| 7 | `files/github/mozman__ezdxf/issue-139/4514932_ellipse_block.dxf_extracted/ellipse_block.dxf` | ezdxf#139 | R2018 / AutoCAD-like | ELLIPSE inside uniformly and non-uniformly scaled INSERTs | ellipse transform under INSERT scale |
| 8 | `files/github/mozman__ezdxf/issue-140/4515368_bug_report_extracted/crash_test_2.dxf` | ezdxf#140 | R2018 / AutoCAD-like | non-uniformly scaled ELLIPSE in a block (crash_test_1.dxf is the sibling) | Rytz axis-construction edge case |
| 9 | `files/github/mozman__ezdxf/issue-150/4549859_good.dxf_extracted/good.dxf` | ezdxf#150 | R2007 / LibreCAD | HATCH with a SPLINE edge and no fit points (LibreCAD) | AutoCAD refused the ezdxf re-save: the 97 fit-point-count tag |
| 10 | `files/github/mozman__ezdxf/issue-156/4583526_test_extracted/o1021.dxf` | ezdxf#156 | R2007 / LibreCAD | the same spline-edge HATCH as R2007/2010/2013/2018 (o1021..o1032, cannot_have_97, must_have_97_1032) | checked in AutoCAD 2020: when group 97 must be present, per version |
| 11 | `files/github/mozman__ezdxf/pr-154/4563963_rotated_and_scaled_arcs.dxf_extracted/rotated_and_scaled_arcs.dxf` | ezdxf#154, ezdxf#169 | R2018 / AutoCAD-like | 48 rotated, scaled and mirrored INSERTs of arcs (rotated_and_scaled_arcs.dxf) | OCS and reflection test for ARC in INSERT |
| 12 | `files/github/mozman__ezdxf/issue-170/4846024_caret_notation_extracted/caret_notation.dxf` | ezdxf#170 | R2018 / AutoCAD-like | MTEXT with a ^I tab and a literal caret "^ ", written by AutoCAD (newline_test.dxf: ODA ^J; cad_mtext.dxf) | caret-encoding ground truth |
| 13 | `files/github/mozman__ezdxf/issue-179/4911403_test_extracted/test.dxf` | ezdxf#179 | R12 / ? | R12 file whose section tags carry a trailing space ("SECTION ") | tolerant tag parsing |
| 14 | `files/repos/ezdxf/examples_dxf/wipeout_door.dxf` | ezdxf#205 | R2018 / AutoCAD-like | WIPEOUT inside blocks, with MTEXT | WIPEOUT masking and frame |
| 15 | `files/github/mozman__ezdxf/issue-252/5415588_visualization_-_conference_room.dxf_extracted/visualization_-_conference_room.dxf` | ezdxf#252 | R2010 / LibreDWG | LibreDWG output: 3DSOLID, LIGHT, SPLINE with a (0,0,0) tangent | AutoCAD refuses it; loader robustness |
| 16 | `files/github/mozman__ezdxf/issue-253/5415648_architectural_example-imperial.dxf_extracted/architectural_example-imperial.dxf` | ezdxf#253 | R2018 / AutoCAD-like | AutoCAD sample via ODA: DIMENSIONs with no geometry block (no group 2), 2 VIEWPORTs | renderer must draw dimensions itself |
| 17 | `files/github/mozman__ezdxf/issue-255/5421807_villa_chalet.dxf_extracted/villa_chalet.dxf` | ezdxf#255 | R2018 / AutoCAD-like | ODA-converted real villa plan, 8,648 VERTEX, ELLIPSEs | ellipse precision; large real plan |
| 18 | `files/github/LibreDWG__libredwg/issue-275/5422402_missing_y_extracted/lineweights.dxf` | ezdxf#256 | R2007 / LibreDWG | LibreDWG 0.11: lineweight -116, a 10 without its 20, header value with a raw line break | negative parser test (TrueView rejects it) |
| 19 | `files/github/LibreDWG__libredwg/issue-275/5422481_colorwh.dxf_extracted/colorwh.dxf` | ezdxf#256 | R2007 / LibreDWG | AutoCAD "color wheel" sample via LibreDWG: 36,095 SOLIDs in ACI and true color | color/SOLID stress test (repair the header first) |
| 20 | `files/github/mozman__ezdxf/issue-258/5476689_new_file.dxf_extracted/new_file.dxf` | ezdxf#258 | R2018 / AutoCAD-like | multi-line ATTRIB with embedded MTEXT (R2018) | AutoCAD and TrueView 2022 disagree; needs embedded-MTEXT rendering |
| 21 | `files/github/mozman__ezdxf/issue-258/6916760_attrib_with_mtext_many_versions_extracted/attrib_with_mtext_R2000.dxf` | ezdxf#258 | R2000 / AutoCAD-like | the same multi-line ATTRIB saved by AutoCAD as R2000/2004/2007/2010/2013 | how AutoCAD downgrades multi-line attributes per version |
| 22 | `files/github/mozman__ezdxf/issue-258/6917308_attr_with_subclass.dxf_extracted/attr_with_subclass.dxf` | ezdxf#258 | R2018 / AutoCAD-like | ATTRIB with an embedded-object subclass | rare ATTRIB structure |
| 23 | `files/github/mozman__ezdxf/issue-260/5493454_Italy_extracted/Italy.dxf` | ezdxf#260 | R2010 / AutoCAD-like | 20 MPOLYGONs (map data) | MPOLYGON parsing and fill |
| 24 | `files/github/mozman__ezdxf/discussion-264/5545999_MLEADER.dxf_extracted/MLEADER.dxf` | ezdxf#264 | R2018 / AutoCAD-like | 9 complex MULTILEADERs with proxy graphics (AutoCAD R2018) | native vs proxy MLEADER reference |
| 25 | `files/github/mozman__ezdxf/issue-302/5788340_260C0.dxf_extracted/260C0.dxf` | ezdxf#302 | R2018 / AutoCAD-like | HATCH whose arc edge runs from -180° to 180° | angle-span normalization |
| 26 | `files/github/mozman__ezdxf/discussion-315/5833002_Page8Scaled_extracted/Page8Scaled.dxf` | ezdxf#315 | R2018 / AutoCAD-like | AutoCAD PDFIMPORT output: SOLID HATCHes with true color and 50% transparency | transparency (440) rendering |
| 27 | `files/github/mozman__ezdxf/issue-325/5873155_ezdxf_extracted/bouton.dxf` | ezdxf#325 | R2013 / AutoCAD-like | TEXT in the TTF symbol font "BOUTON", written by BricsCAD | font-metric edge case (x-height equals cap height) |
| 28 | `files/github/mozman__ezdxf/issue-325/5879328_autcad_in_ezdxf_out_extracted/autcad_in_ezdxf_out/in.dxf` | ezdxf#325 | R2007 / AutoCAD-like | AutoCAD MTEXT on an Arial STYLE carrying the XDATA ACAD family name | STYLE extended font data |
| 29 | `files/github/mozman__ezdxf/issue-328/5881086_block_circles_with_hatch.dxf_extracted/block_circles_with_hatch.dxf` | ezdxf#328 | R2018 / AutoCAD-like | HATCH of two full-circle arc edges inside a block | full-circle arc-edge detection |
| 30 | `files/github/mozman__ezdxf/issue-338/5903798_block_circles_with_hatch_2.dxf_extracted/block_circles_with_hatch_2.dxf` | ezdxf#338 | R2018 / AutoCAD-like | scaled INSERT of a two-circle HATCH (AutoCAD screenshot in the thread) | hatch under INSERT scale |
| 31 | `files/github/mozman__ezdxf/issue-333/5912704_entity2path_extracted/entity2path.dxf` | ezdxf#333 | R2013 / ? | TEXT with outline polylines drawn by BricsCAD | TTF glyph placement and advances vs CAD |
| 32 | `files/github/mozman__ezdxf/issue-380/6236421_test_extracted/test.dxf` | ezdxf#380 | R2018 / AutoCAD-like | nested mirrored (sx=-1) and rotated INSERTs (chairs); simsun font only in XDATA | nested reflection composition; font from XDATA |
| 33 | `files/github/mozman__ezdxf/issue-389/6303494_door_explode_test_extracted/door_explode_test.dxf` | ezdxf#389 | R2018 / AutoCAD-like | door block: negative-scale INSERT with an ARC | OCS flip on explode |
| 34 | `files/github/mozman__ezdxf/issue-402/6334285_test_extracted/test.dxf` | ezdxf#402 | R2007 / AutoCAD-like | SHX + bigfont STYLE; MTEXT with inline \fSimSun|b0|i0|c134|p2; | CJK via bigfont and inline font switch |
| 35 | `files/github/mozman__ezdxf/discussion-411/6553652_mpolygons_extracted/mpolygons_with_fill_2010.dxf` | ezdxf#411, ezdxf#496 | R2010 / AutoCAD-like | 25 MPOLYGONs with/without fill as 2000/2007/2010/2018 (AutoCAD Map) | only real MPOLYGON corpus; offset vector 11 |
| 36 | `files/github/mozman__ezdxf/issue-424/6418816_test.insert_extracted/test insert.dxf` | ezdxf#424 | R2007 / AutoCAD-like | closed 2-vertex bulge LWPOLYLINE circle (d=0.2) at 3.9e7 coordinates | float tolerance at large coordinates |
| 37 | `files/github/mozman__ezdxf/issue-428/6465465_test_extracted/test.dxf` | ezdxf#428 | R2007 / AutoCAD-like | 24 WIPEOUTs, SOLIDs and a hatch | WIPEOUT draw order |
| 38 | `files/github/mozman__ezdxf/issue-453/6583432_test_no_dimension_extracted/test_no_dimension.dxf` | ezdxf#453 | R2018 / AutoCAD-like | DIMENSIONs nested 3 levels deep in blocks (see also examples_dxf/dimension_in_nested_blocks.dxf) | DIMENSION insert point 12 in nested blocks |
| 39 | `files/github/mozman__ezdxf/issue-454/6595595_test_simplified_extracted/test.dxf` | ezdxf#454 | R2018 / AutoCAD-like | degenerate HATCH boundary paths (siblings test_hatch.dxf, test_missing_hatch.dxf) | AutoCAD/BricsCAD hatch edge cases (open loops, 2 loops in 1 path) |
| 40 | `files/github/mozman__ezdxf/discussion-461/6623321_circle_filled_extracted/circle_filled.dxf` | ezdxf#461 | R2018 / AutoCAD-like | filled dots as 2-vertex bulge=1 wide LWPOLYLINEs in nested INSERTs | wide arc-segment fill |
| 41 | `files/github/mozman__ezdxf/discussion-464/6637859_test_extracted/test.dxf` | ezdxf#464 | R2018 / AutoCAD-like | HATCHes with 18 polyline paths and 53 full-circle ArcEdges | hatch path-type mix |
| 42 | `files/github/mozman__ezdxf/discussion-465/6638462_Desk_extracted/Desks_021.dxf` | ezdxf#465 | R2018 / AutoCAD-like | AutoCAD 2022 dynamic-block desk: invisible INSERTs, ATTDEFs | visibility of dynamic-block states |
| 43 | `files/github/mozman__ezdxf/issue-466/6637537_hole.dxf_extracted/hole.dxf` | ezdxf#466, ezdxf#482 | R2018 / AutoCAD-like | HATCH whose edges are not in connection order | edge chaining |
| 44 | `files/github/mozman__ezdxf/issue-470/6661205_ezdxf-hatch-color-mismatch_extracted/input.dxf` | ezdxf#470 | R2013 / ? | solid HATCHes in ACI 50 and 250 (+ AutoCAD LT 2021 screenshot) | ACI palette check (250 is black in AutoCAD, not in BricsCAD) |
| 45 | `files/github/mozman__ezdxf/issue-473/6677315_bug_report_extracted/bug_report/example_3.dxf` | ezdxf#473 | R2013 / ezdxf | CIRCLE r=1.5e-8 at (190233, -58473); example_1/2 are ARCs at 8.5e7 | extreme scale ratio |
| 46 | `files/github/mozman__ezdxf/discussion-475/6677597_Problem_extracted/Problem.dxf` | ezdxf#475 | R2018 / AutoCAD-like | block with const-width 50 LWPOLYLINE, duplicate vertices, entity ltscale 0.0001, non-plot layer | wide polyline + non-plot layer |
| 47 | `files/github/mozman__ezdxf/issue-495/6839744_aec_wall_extracted/aec_wall.dxf` | ezdxf#495 | R2018 / AutoCAD-like | AEC wall as ACAD_PROXY_ENTITY (+ original .dwg; aec_wall_in_block.dxf) | proxy graphic rendering; proxy inside a block |
| 48 | `files/github/mozman__ezdxf/issue-497/6848783_aec_doors_walls.dxf_extracted/aec_doors_walls.dxf` | ezdxf#497 | R2018 / AutoCAD-like | 39 AEC door/wall proxies (+ AutoCAD screenshot) | proxy arc direction |
| 49 | `files/github/mozman__ezdxf/issue-502/6855790_shell.dxf_extracted/shell.dxf` | ezdxf#502 | R2018 / AutoCAD-like | proxy graphic with a SHELL primitive, plus an ACAD_TABLE | rare proxy primitive |
| 50 | `files/github/mozman__ezdxf/issue-506/6863902_arc-dim.dxf_extracted/arc-dim.dxf` | ezdxf#505, ezdxf#506 | R2018 / AutoCAD-like | ARC_DIMENSION written by AutoCAD | ARC_DIMENSION layout |
| 51 | `files/repos/ezdxf/examples_dxf/3dface.dxf` | ezdxf#513, ezdxf#621 | R2018 / AutoCAD-like | 44 3DFACEs with edge-visibility flags | 3DFACE invisible edges; degenerate faces |
| 52 | `files/github/mozman__ezdxf/issue-541/7217124_error_ezdxf_extracted/error_ezdxf/MBV1G-PB0000047471-2012-06-01-DE-3_cloudconvert.dxf` | ezdxf#541 | R2004 / AutoCAD-like | HATCH spline edge with a non-clamped knot vector (DWG via cloudconvert/ODA) | knot tolerance |
| 53 | `files/github/mozman__ezdxf/issue-558/7319096_import_mtext_issue_extracted/import_mtext_issue/MTEXT_import_missing.dxf` | ezdxf#558 | R2013 / AutoCAD-like | MTEXT with a single column (column DXF structure) | MTEXT column parsing |
| 54 | `files/github/mozman__ezdxf/issue-561/7386181_line_type_issue_extracted/line_type_issue/MBV1G-PB0000047471-2012-06-01-DE-3.dxf` | ezdxf#561 | R2004 / AutoCAD-like | real R2004 drawing with dashed and center linetypes (+ PNG vs DXF screenshots) | linetype pattern rendering |
| 55 | `files/github/mozman__ezdxf/issue-567/7433975_power_unit_1_extracted/power_unit_1.dxf` | ezdxf#567, ezdxf#573 | R2013 / AutoCAD-like | ODA-converted drawing with textbox-flag (8) HATCH paths, 368 ATTRIBs | hatch text-box boundaries |
| 56 | `files/github/mozman__ezdxf/issue-574/7480164_test_extracted/test.dxf` | ezdxf#574 | R2018 / AutoCAD-like | 3 files: far-away entities on off layers, elevation 2.99e99, 3,972 DIMENSIONs | extents robustness; large dimension count |
| 57 | `files/github/mozman__ezdxf/issue-583/7639312_not_good_mleader_example_extracted/not_good_mleader_example.dxf` | ezdxf#583 | R2018 / AutoCAD-like | MULTILEADERs with MTEXT columns (AutoCAD 2020) | TrueView 2022 draws it like AutoCAD; column MLEADER |
| 58 | `files/github/mozman__ezdxf/issue-589/7731663_test_extracted/test.dxf` | ezdxf#589 | R2018 / AutoCAD-like | polyface meshes (19,646 VERTEX) | polyface face records with index 0 |
| 59 | `files/github/mozman__ezdxf/discussion-591/7744118_aec_space_test_extracted/aec_space_test.dxf` | ezdxf#591 | R2018 / AutoCAD-like | 17 AEC_SPACE proxies | proxy graphics without hatches/blocks |
| 60 | `files/github/mozman__ezdxf/issue-618/7897449_dxfToPng_extracted/dxfToPng.dxf` | ezdxf#618 | R2010 / ezdxf | extremely dense hatch pattern | hatch level of detail / timeout |
| 61 | `files/github/mozman__ezdxf/discussion-643/8150174_test_extracted/test.dxf` | ezdxf#643 | R2018 / AutoCAD-like | AutoCAD R2018 (ANSI_936): DIMSTYLE 345/346/347 -> ACDBPLACEHOLDER | handle-type robustness |
| 62 | `files/github/mozman__ezdxf/discussion-644/8166049_dimension_boundingbox_extracted/dimension_boundingbox.dxf` | ezdxf#644 | R2018 / AutoCAD-like | DIMENSION with a far defpoint POINT in its *D block | extents include defpoints |
| 63 | `files/github/mozman__ezdxf/discussion-661/8370071_Original.Drawing.File_extracted/9621-P-1-02-002-3-AR6.dxf` | ezdxf#661 | R2018 / AutoCAD-like | real architectural sheet: 2 paperspace layouts with VIEWPORTs, title-block ATTRIBs | end-to-end paperspace plot test |
| 64 | `files/github/mozman__ezdxf/issue-663/8407793_Crash_extracted/311000.dxf` | ezdxf#663 | R12 / AutoCAD-like | R12 POLYLINE with elevation 1.39e19 | numeric robustness |
| 65 | `files/github/mozman__ezdxf/issue-688/8749754_drawings_extracted/123.dxf` | ezdxf#688 | R2010 / ezdxf | MIDDLE_CENTER TEXT with 10 != 11 (and the ODA-made .dwg) | AutoCAD uses the stored 10 in DWG: write both points |
| 66 | `files/github/mozman__ezdxf/issue-699/9036372_F397.dxf_extracted/F397.dxf` | ezdxf#699 | R2013 / AutoCAD-like | 50k entities -> 1M+ virtual entities through nested blocks | performance and memory benchmark |
| 67 | `files/github/mozman__ezdxf/issue-706/9100511_7888_1_extracted/7888_1.dxf` | ezdxf#706 | R2018 / AutoCAD-like | HATCH boundary with gaps (AutoCAD renders it) | open-boundary tolerance |
| 68 | `files/github/mozman__ezdxf/issue-736/9430225_lost_wall_extracted/lost_wall.dxf` | ezdxf#736 | R2018 / AutoCAD-like | HATCH with extrusion (0,0,-1) | HATCH OCS |
| 69 | `files/github/mozman__ezdxf/issue-737/9437859_dxf_extracted/2013.dxf` | ezdxf#737 | R2018 / AutoCAD-like | complex linetypes referencing SHX shapes (zmm5.shx...) | complex linetype with missing shapes |
| 70 | `files/github/mozman__ezdxf/issue-739/9450780_sample_extracted/sample.dxf` | ezdxf#739 | R2004 / ezdxf | HATCH made of POINTs, PDMODE 32 (R2004) | PDMODE/PDSIZE rendering |
| 71 | `files/github/mozman__ezdxf/issue-749/9692362_buggy_mtext_extracted/buggy_mtext.dxf` | ezdxf#749 | R2018 / AutoCAD-like | MLEADER MTEXT with tabs (infinite-loop repro) | tab stops in MTEXT |
| 72 | `files/github/mozman__ezdxf/issue-761/9821253_broken_multileader_extracted/broken_multileader.dxf` | ezdxf#761 | R2018 / AutoCAD-like | MULTILEADER with huge arrowheads (AutoCAD screenshot) | arrow-size behaviour |
| 73 | `files/github/mozman__ezdxf/issue-765/9926654_git-issue_extracted/git-issue/nzk-1.dxf` | ezdxf#765 | R10 / ? | R10 (AC1006) file with POINTs | very old version parsing |
| 74 | `files/github/mozman__ezdxf/issue-783/10106258_hatches_github_issue_extracted/hatches_orig.dxf` | ezdxf#783 | R2018 / AutoCAD-like | pattern HATCHes in a scaled INSERT + the AutoCAD-exploded result (hatches_exploded_autocad.dxf) | ground truth for pattern transform under INSERT |
| 75 | `files/github/mozman__ezdxf/issue-793/10209953_broken_mleader_extracted/broken_mleader.dxf` | ezdxf#793 | R2018 / AutoCAD-like | MLEADER whose proxy graphic holds a wide LWPOLYLINE dot arrow | proxy LWPOLYLINE decoding |
| 76 | `files/github/mozman__ezdxf/discussion-809/10296162_complex_lines_extracted/complex_lines.dxf` | ezdxf#809 | R2013 / AutoCAD-like | complex linetypes with text | complex linetype text rendering |
| 77 | `files/github/mozman__ezdxf/issue-831/10705709_splinetest.dxf_extracted/splinetest.dxf` | ezdxf#831 | R2013 / QCAD | SPLINE with duplicate control points (QCAD) | degenerate spline |
| 78 | `files/github/mozman__ezdxf/issue-832/10708057_proxy2_extracted/proxy2.dxf` | ezdxf#832 | R2018 / AutoCAD-like | AutoCAD Plant3D proxies with an elliptic-arc primitive (and proxy.dxf) | undocumented proxy primitive |
| 79 | `files/github/mozman__ezdxf/issue-836/10757440_SVGtextimportedtoVisiov2_extracted/SVGtextimportedtoVisiov2.dxf` | ezdxf#836 | R14 / ? | MS Visio export: HATCH edge type 0 (TrueView opens it, BricsCAD crashes) | producer quirk; recover test |
| 80 | `files/github/mozman__ezdxf/issue-840/10965558_test.dxf_extracted/test.dxf` | ezdxf#840 | R2018 / AutoCAD-like | annotative MULTILEADER (AutoCAD 2023) | annotation-scale context data |
| 81 | `files/github/mozman__ezdxf/issue-847/10978953_acad_proxy_entity_example_extracted/*.dxf` | ezdxf#847 | R2018 / AutoCAD-like | 5,101 Tangent (TCH) ACAD_PROXY_ENTITYs without proxy graphics | proxies AutoCAD can't show either |
| 82 | `files/github/LibreCAD__LibreCAD/issue-1598/11004931_drawing_spline_extracted/drawing_spline.dxf` | ezdxf#851 | R2007 / LibreCAD | LibreCAD "closed" SPLINE that is open with the closed flag set, extrusion (0,0,0) | producer quirk; TrueView draws it open |
| 83 | `files/github/mozman__ezdxf/issue-855/11090282_bad_xref_extracted/bad_xref.dxf` | ezdxf#855 | R2018 / AutoCAD-like | MTEXT with absolute \H150; inside a 0.001-scaled block | inline absolute height under block scale |
| 84 | `files/github/mozman__ezdxf/issue-860/11135661_imagetest_extracted/imagetest.dxf` | ezdxf#860 | R2018 / AutoCAD-like | OLE2FRAME with an embedded bitmap (visible in TrueView) | OLE2FRAME rendering |
| 85 | `files/github/mozman__ezdxf/discussion-865/11296647_glyph_test_extracted/chinese_glyphs.dxf` | ezdxf#865 | R2013 / ezdxf | text glyphs converted to HATCHes (503 CJK; latin_glyphs.dxf 816) | glyph outline and hole fill |
| 86 | `files/github/mozman__ezdxf/issue-870/11330722_Drawing1_t3_extracted/Drawing1_t3.dxf` | ezdxf#870 | R2010 / AutoCAD-like | ARC with extrusion (0,0,-1) | OCS ARC |
| 87 | `files/github/mozman__ezdxf/issue-873/11441434_inverted_extrusions_extracted/inverted_extrusions.dxf` | ezdxf#873 | R2018 / AutoCAD-like | 25 proxies with (0,0,-1) normals | proxy OCS handling |
| 88 | `files/github/mozman__ezdxf/issue-889/11515106_test_extracted/test.dxf` | ezdxf#889 | R2018 / AutoCAD-like | MTEXT with the full inline-code zoo (\S1/2 \S3#4 \S5^6, \pi..., \fSimSun...) (+ .dwg) | MTEXT parser/renderer conformance |
| 89 | `files/github/mozman__ezdxf/issue-906/11915635_test_extracted/test/test.dxf` | ezdxf#906, ezdxf#907 | R2018 / AutoCAD-like | AutoCAD Plant3D pipe proxies (+ an ezdxf copy that TrueView 2023 rejects) | proxy polyline fill flag; ATTRIB 280 ordering |
| 90 | `files/github/mozman__ezdxf/issue-932/12674700_test_extracted/test.dxf` | ezdxf#932 | R2007 / LibreCAD | layer names in \M+ MIF notation (ODA converter on Linux) | MIF decoding |
| 91 | `files/github/mozman__ezdxf/issue-933/12751904_extrusion_extracted/extrusion omitted.dxf` | ezdxf#933 | ? / ? | 3 files with partial extrusion vectors (only 220/230, or only 210) | partial vector parsing |
| 92 | `files/github/mozman__ezdxf/issue-936/12866826_MixedLanguages_extracted/MixedLanguages.dxf` | ezdxf#936 | R2018 / AutoCAD-like | MTEXT mixing CJK and latin on an Arial Standard style (+ B2_1010.dxf real plan) | per-glyph font fallback |
| 93 | `files/github/mozman__ezdxf/discussion-967/13404548_persian_unicode_text_extracted/persian_text.dxf` | ezdxf#967 | R2018 / AutoCAD-like | Persian TEXT/MTEXT (AutoCAD) | RTL/Arabic text |
| 94 | `files/github/mozman__ezdxf/issue-983/13578584_dxf_extracted/Before Modification.dxf` | ezdxf#983 | R2013 / AutoCAD-like | every DIMENSION kind incl. ARC_DIMENSION and LARGE_RADIAL_DIMENSION (AutoCAD) | dimension-type coverage; text override vs block |
| 95 | `files/github/mozman__ezdxf/issue-986/13618681_not_enough_space.dxf_extracted/not_enough_space.dxf` | ezdxf#986 | R2018 / LibreDWG | Archicad dimension MTEXT with unusual column settings | MTEXT column edge case |
| 96 | `files/github/mozman__ezdxf/issue-1033/14340982_ezdxf-debug_extracted/ezdxf-debug/test.dxf` | ezdxf#1033 | R2018 / AutoCAD-like | Japanese TEXT with a full-width space and an SHX font (aehalf.shx) | CJK whitespace / SHX |
| 97 | `files/github/mozman__ezdxf/issue-1078/15281640_F2-0511_extracted/F2-0511.dxf` | ezdxf#1078 | R2010 / AutoCAD-like | back-and-forth collinear wide LWPOLYLINE; F8/F10 carry huge stored MTEXT widths | bbox pitfalls |
| 98 | `files/github/mozman__ezdxf/issue-1081/15304716_fd1_extracted/fd1.dxf` | ezdxf#1081 | R2004 / LibreDWG | LibreDWG R2004 with 1,156 issues (missing blocks, bad splines); AutoCAD can't open it, BricsCAD can | recover test |
| 99 | `files/repos/ezdxf/examples_dxf/xclip.dxf` | ezdxf#1084 | R2013 / AutoCAD-like | XCLIPped INSERTs (SPATIAL_FILTER) in model and paper space | XCLIP rendering |
| 100 | `files/github/mozman__ezdxf/discussion-1135/16407835_dc_extracted/dc.dxf` | ezdxf#1135 | R2010 / AutoCAD-like | MLINEs with MLINESTYLE (AutoCAD) | MLINE rendering |
| 101 | `files/github/LibreDWG__libredwg/issue-999/16441827_2018_extracted/2018.dxf` | ezdxf#1136 | R2004 / LibreDWG | LibreDWG 0.13.3 R2004 output with unnamed BLOCKs (TrueView rejects it) | negative test |
| 102 | `files/github/mozman__ezdxf/issue-1203/17792248_test2_extracted/test3.dxf` | ezdxf#1203 | R2018 / ezdxf | dynamic block after an ezdxf round-trip, repaired by restoring DICTIONARY 280=1 (test.dxf original, test2.dxf broken) | hard-owner flag |
| 103 | `files/github/mozman__ezdxf/issue-1240/18756248_PlotSettingsTest_extracted/PlotSettingsTest.dxf` | ezdxf#1240 | R2007 / LibreCAD | LibreCAD PLOTSETTINGS without an owner handle | producer quirk |
| 104 | `files/github/mozman__ezdxf/issue-1244/18988113_test_2456712016992_extracted/test_2456712016992.dxf` | ezdxf#1244 | R2013 / ezdxf | DIMENSION with true color whose *D block MTEXT lacks it | pre-rendered block vs entity properties |
| 105 | `files/github/mozman__ezdxf/issue-1261/19275547_spline.dxf` | ezdxf#1261 | R2013 / ezdxf | SPLINE drawn wrongly by ezdxf (BricsCAD reference) | B-spline evaluation |
| 106 | `files/github/mozman__ezdxf/issue-1271/19518783_data_extracted/plan_2004.dxf` | ezdxf#1271 | R2004 / AutoCAD-like | Farsi text: R2004 cp1256 + \U+, and the same drawing as R2018 UTF-8 (plan_2018.dxf) | codepage decoding |
| 107 | `files/github/mozman__ezdxf/issue-1272/19504532_TextLaoutHangTestCase_extracted/TextLaoutHangTestCase.dxf` | ezdxf#1272 | R2013 / QCAD | MTEXT '{\W0.85;^IFAULT}' in shape font ltypeshp.shx | shape font used as a text font |
| 108 | `files/github/mozman__ezdxf/issue-1275/19565426_DenseHatch_extracted/DenseHatch.dxf` | ezdxf#1275 | R2018 / QCAD | very dense HATCH that TrueView shows at every zoom | hatch performance |
| 109 | `files/github/mozman__ezdxf/issue-1279/19666492_test_extracted/test.dxf` | ezdxf#1279 | R2018 / ezdxf | file whose COPYCLIP crash depends on DICTIONARY hard-owner flags | writer compatibility |
| 110 | `files/github/mozman__ezdxf/issue-1285/19955879_test_fix_clipping_extracted/test_fix_clipping.dxf` | ezdxf#1285 | R2018 / ezdxf | XCLIPped INSERT that loses its clipping on clipboard copy (recover.dxf is the fixed file) | XCLIP DICTIONARY ownership |
| 111 | `files/github/mozman__ezdxf/issue-1289/19947142_R3.dxf` | ezdxf#1289 | ? / ? | TEXT value containing a raw line feed (TrueView 2024 and BricsCAD reject it) | negative parser test |
| 112 | `files/github/mozman__ezdxf/issue-1298/20459018_problematic_viewports.dxf_extracted/problematic_viewports.dxf` | ezdxf#1298 | R2018 / AutoCAD-like | 10 VIEWPORTs with a non-normalized view direction | VIEWPORT math |
| 113 | `files/github/mozman__ezdxf/issue-1316/21515141_Archive_extracted/Drawing.dxf` | ezdxf#1316 | R2018 / AutoCAD-like | spline-fit 2D POLYLINE (with frame control vertices) | curve/spline-fit POLYLINE rendering |
| 114 | `files/github/mozman__ezdxf/issue-1318/21548513_Gasket.dxf_extracted/Gasket.dxf` | ezdxf#1318, ezdxf#1319 | R2013 / AutoCAD-like | VIEWPORTs panned inside (view center vs target), Gasket drawing | viewport transform |
| 115 | `files/github/mozman__ezdxf/pr-1319/21561011_twisted_viewport_modelspace_limits.dxf_extracted/twisted_viewport_modelspace_limits.dxf` | ezdxf#1319 | R2013 / ezdxf | twisted VIEWPORT | view twist angle |
| 116 | `files/github/mozman__ezdxf/issue-1321/21564787_text_under_hatch.dxf_extracted/text_under_hatch.dxf` | ezdxf#1321 | R2013 / AutoCAD-like | ATTRIB vs HATCH draw order in an INSERT | ATTRIBs drawn last |
| 117 | `files/github/mozman__ezdxf/issue-1322/21591825_SplitCharEscape_extracted/SplitCharEscape.dxf` | ezdxf#1322 | R2013 / QCAD | MTEXT chunks split in the middle of a \M+ escape | join chunks before decoding |
| 118 | `files/github/mozman__ezdxf/issue-1326/22122932_plan.bug.dxf_extracted/plan.bug.dxf` | ezdxf#1326 | R2013 / AutoCAD-like | WIPEOUT + proxy graphics offset | proxy/WIPEOUT interaction |
| 119 | `files/github/mozman__ezdxf/pr-1350/23769346_mtext_invalid_char_width.dxf.2_extracted/mtext_invalid_char_width.dxf` | ezdxf#1350 | R2013 / AutoCAD-like | MTEXT with an invalid char-width code (".231") | inline-code parsing |
| 120 | `files/github/mozman__ezdxf/issue-1351/23827642_inconsist_text_emit_2.dxf_extracted/inconsist_text_emit_2.dxf` | ezdxf#1351 | R2013 / AutoCAD-like | MTEXT on a text style with a width factor and no \W | style defaults for MTEXT |
| 121 | `files/github/mozman__ezdxf/issue-1352/23825467_problem.line_extracted/problem line.dxf` | ezdxf#1352 | R2018 / AutoCAD-like | LWPOLYLINE arrow with tapered widths 0,0,5,0 | variable-width polyline |
| 122 | `files/github/mozman__ezdxf/pr-1357/24061899_mlead_crash.dxf_extracted/mlead_crash.dxf` | ezdxf#1357 | R2013 / AutoCAD-like | MULTILEADERs that crash without proxy graphics | MLEADER arrow rendering |
| 123 | `files/github/mozman__ezdxf/issue-1362/24296810_layouts_extracted/layouts.dxf` | ezdxf#1362 | R2018 / AutoCAD-like | layouts whose VIEWPORTs have 68=0 yet show in AutoCAD | viewport status semantics |
| 124 | `files/github/mozman__ezdxf/issue-1372/25310116_test_with_zero_height_mtext_extracted/test_with_zero_height_mtext.dxf` | ezdxf#1372 | R2010 / AutoCAD-like | MTEXT with char_height 0 | zero-height text |
| 125 | `files/github/mozman__ezdxf/issue-1392/29156684_Drawing1_extracted/Drawing1.dxf` | ezdxf#1392 | R2018 / AutoCAD-like | HATCH pattern in a 180°-rotated INSERT | pattern base-point transform |
| 126 | `files/github/mozman__ezdxf/issue-1402/ezdxf_1402_synthetic_samples_v2_extracted/pypi_1.4.4_before_transform_r2007.dxf` | ezdxf#1402 | R2007 / ezdxf | synthetic before/after pattern-transform samples (PyPI 1.4.4 vs fixed) | pattern phase under translation |
| 127 | `files/github/mozman__ezdxf/issue-1410/31495560_test_11_ylx_extracted/*.dxf` | ezdxf#1410 | R2018 / AutoCAD-like | CJK plumbing plan: DIMENSIONs inside INSERTs with CAD-generated *D blocks | keep the pre-rendered dimension geometry |
| 128 | `files/github/mozman__ezdxf/discussion-865/11296647_glyph_test_extracted/latin_glyphs.dxf` | ezdxf#865 | R2013 / ezdxf | TEXT at height 100 in Arial / Arial Narrow / Arial Black / ISOCPEUR / Liberation / OpenSans / SimSun with a kerning test string | TTF metrics vs BricsCAD/TrueView ("no kerning", cap height from "A") |
| 129 | `files/github/mozman__ezdxf/discussion-984/13618899_dim_extracted/dim.dxf` | ezdxf#984 | R2018 / ? | AutoCAD R2018 rotated DIMENSION (*D1 "100") and ARC_DIMENSION (*D2 "47,12", proxy graphics) | dimension display from the *D block; ISO decimal comma |
| 130 | `files/github/mozman__ezdxf/discussion-961/13328336_block_testing_extracted/blocksdoc2013.dxf` | ezdxf#961 | R2013 / AutoCAD-like | AutoCAD 2024 saved as R2013: ATTDEFs with the annotative xdict chain, double 280 | undocumented-object robustness |
| 131 | `files/github/mozman__ezdxf/discussion-789/10133215_square.dxf` | ezdxf#789 | ? / ? | Browzwear ASTM-D6673 R12: no TABLES, block name with a space (TrueView rejects), TEXT with height 0 and no group 1 | malformed/minimal R12 |
| 132 | `files/github/mozman__ezdxf/discussion-853/11025961_input_extracted/input.dxf` | ezdxf#853 | ? / ? | Gerber Technology "AC1009" with AcDb subclass markers | hybrid R12 tolerance |
| 133 | `files/github/mozman__ezdxf/discussion-924/12437924_11001_extracted/11001.dxf` | ezdxf#924 | ? / ? | ENTITIES-only file, undefined CONTINUOUS linetype | missing sections |
| 134 | `files/github/mozman__ezdxf/discussion-925/12616623_TestBlock_extracted/TestBlock.dxf` | ezdxf#925 | R2018 / AutoCAD-like | AutoCAD R2018 block whose base point is far from its geometry | INSERT/base-point transform |
| 135 | `files/github/LibreDWG__libredwg/issue-516/9257875_invalid.files_extracted/invalid files/A2.dxf` | ezdxf#721 | R2013 / LibreDWG | LibreDWG R2013, 28 MB: misplaced root dictionary, blank lines, HATCH edge type 0, dangling dictionaries, 6,865 ACAD_PROXY_ENTITY (and 222.dxf) | recover stress + large-file performance |
| 136 | `files/repos/ezdxf/integration_tests/data/issue1106.dxf` | ezdxf#1106 | R12 / AutoCAD-like | R12 from a C# exporter with R13 subclass markers everywhere, ARC start -90 | AutoCAD reads it; strict R12 parsers fail |
| 137 | `files/github/mozman__ezdxf/discussion-1024/14076363_frominkscape.dxf_extracted/frominkscape.dxf` | ezdxf#1024 | R14 / ? | Inkscape AC1014: $HANDSEED FFFF, no owners, dangling ACAD_MLINESTYLE | minimal third-party writer |
| 138 | `files/github/mozman__ezdxf/discussion-1139/16466655_Contour1_extracted/Contour1.dxf` | ezdxf#1139 | ? / ? | ENTITIES-only file, no handles, 2D LINEs | missing HEADER/TABLES |
| 139 | `files/github/mozman__ezdxf/discussion-1016/14071330_Script_dxf-files_extracted/4m_holesCStxt.dxf` | ezdxf#1016 | R2018 / ezdxf | LAYER with undefined linetype SOLID (TrueView 2024 rejects; EST_GEO_NEW.dxf is the valid AutoCAD original) | negative + positive validity pair |
| 140 | `files/github/mozman__ezdxf/discussion-1284/19737599_00690026_374910a12d8b4a4c1fc5f706_step_000_extracted/00690026_374910a12d8b4a4c1fc5f706_step_000.dxf` | ezdxf#1284 | R2013 / AutoCAD-like | 23 rational degree-2 SPLINEs with nearly equal clamped knots, 42=1e-9 | knot tolerance; phantom segments |
| 141 | `files/github/mozman__ezdxf/discussion-1028/14227007_ezdxf_spline_issue_extracted/to_import.dxf` | ezdxf#1028 | R2018 / AutoCAD-like | AutoCAD JOINed SPLINE with repeated interior knots | use stored knots |
| 142 | `files/github/mozman__ezdxf/discussion-1075/15259638_123_extracted/123.dxf` | ezdxf#1075 | R2010 / ezdxf | Chinese TEXT in SimHei/SimSun, STYLE with empty font resolved via XDATA | CJK glyph size vs AutoCAD |
| 143 | `files/github/mozman__ezdxf/discussion-1032/14326176_demo_extracted/demo/test.dxf` | ezdxf#1032 | R2013 / ezdxf | Chinese in an arial.ttf style, MTEXT \fsimsun|c134, "@宋体" family | glyph fallback, charset |
| 144 | `files/github/mozman__ezdxf/discussion-1211/17933130_test_0_extracted/test_0.dxf` | ezdxf#1211 | R2013 / ezdxf | DIMENSION text "∅99.06" in Arial, amgdt.shx | glyph fallback (AutoCAD shows ∅) |
| 145 | `files/github/mozman__ezdxf/discussion-1031/14318201_A_000217_extracted/A_000217.dxf` | ezdxf#1031 | R2013 / ? | AC1027 paperspace with a polygon-clipped VIEWPORT (90 bit 0x10000, 340) | non-rectangular viewport clip |
| 146 | `files/github/mozman__ezdxf/discussion-1173/17155650_board_extracted/board.dxf` | ezdxf#1173 | R2018 / AutoCAD-like | 3DSOLID R2018 with ACDSDATA/ASM_Data section | SAB parsing/skipping |
| 147 | `files/github/mozman__ezdxf/discussion-1076/15281605_demo_extracted/demo/test_block.dxf` | ezdxf#1076 | R2000 / ezdxf | same entities in modelspace and a block = duplicate handles | duplicate-handle handling |
| 148 | `files/github/mozman__ezdxf/discussion-1154/16815415_dxf.and.pdf.for.test_extracted/test.dxf` | ezdxf#1154 | R2018 / ezdxf | 150 HATCH, 40 DIMENSION, ATTRIBs; the zip also has AutoCAD's layered PDF | an AutoCAD plot to compare against |
| 149 | `files/github/mozman__ezdxf/discussion-1158/16838963_text.export.pdf.test_extracted/test_texts.dxf` | ezdxf#1158 | R2018 / AutoCAD-like | MTEXT + DIMENSION (AutoCAD PDF in the thread) | text plot comparison |
| 150 | `files/github/mozman__ezdxf/discussion-1348/23611804_files_extracted/origin.dxf` | ezdxf#1348 | R2010 / AutoCAD-like | AutoCAD R2010 nested blocks with MTEXT, paperspace viewports (test_blks.dxf, test_blk6.dxf) | nested block definitions |
| 151 | `files/github/mozman__ezdxf/pr-1320/21553491_Gasket.dxf_extracted/Gasket.dxf` | ezdxf#1320 | R2013 / AutoCAD-like | paperspace entities drawn over the viewport border (layout "render_over_viewport") | viewport border draw order |
| 152 | `files/github/mozman__ezdxf/pr-1350/23771019_mtext_complex_test.dxf_extracted/mtext_complex_test.dxf` | ezdxf#1350 | R2013 / AutoCAD-like | MTEXT with \W.85; \Q.0; \H.5x; \H2.x; and an ISOCPEUR font | inline-code number parsing |

## Open conflicts and unknowns (feed the AutoCAD test backlog)

| Topic | What is unclear | Threads |
|---|---|---|
| `$XCLIPFRAME` values | 1 vs 2 meaning "plotted"; the two ezdxf notes pages contradict each other | ezdxf:notes/XCLIP vs /SPATIAL_FILTER, ezdxf#1049 |
| MTEXT `\pi \pl \pr \pt` | Are they factors of char height or absolute drawing units? Tangent CAD writes absolute-looking values | ezdxf#855, #1252, #1390 |
| ACI 250–255 on screen vs plot | TrueView shows 250 black / 255 white; ezdxf's AutoCAD-2020 palette has distinct paperspace shades; plotted values unknown | ezdxf#447, #448, #470, #544, #1030 |
| TEXT BOTTOM and FIT/ALIGNED | Which metric sets the gap below the baseline; exact FIT width (advance vs ink) | ezdxf#324, #333 |
| CJK TTF sizing | Why AutoCAD CJK glyphs are smaller than cap-height scaling predicts | ezdxf#705, #733, #1075 |
| Glyph fallback | Which fallback font AutoCAD uses per missing glyph | ezdxf#883, #936, #1211 |
| VIEWPORT visibility | Whether status 68=0 / id 69=0 viewports plot; the role of the 90 "on" bit | ezdxf#1014, #1362 |
| Dense hatches | Whether PLOT switches to solid (HPMAXLINES) and at what threshold | ezdxf#618, #929, #1275 |
| HATCH gaps | The gap tolerance at which AutoCAD still fills a "not closed" edge boundary | ezdxf#454, #706 |
| Spline tessellation for PLOT | Chord tolerance used by PLOT (VIEWRES-dependent on screen) | ezdxf#1022, #705 |
| PSLTSCALE / MSLTSCALE | Exact scale formula for linetypes in viewports and annotative scaling | ezdxf#1386 |
| Line caps/joins | Caps/joins in PLOT with no CTB / `monochrome.ctb` / `acad.ctb` | ezdxf#607, ezdxf:notes/Line Cap- and Join Styles |
| TEXT height 0 | Fallback height (STYLE fixed height? TEXTSIZE?) | ezdxf#789, #1372 |
| Radius-0 CIRCLE / ARC start==end | Does PLOT draw a dot? (TrueView shows a point for start==end) | ezdxf#184, #330 |
| STYLE XDATA 1071 bits | Exact meaning of the font flags (bold/italic/charset/pitch) | ezdxf#776, #1032 |
| Block names with spaces | Rejected by TrueView in R12; R2000+ unknown | ezdxf#789 |

## Test ideas (small DXF files to plot in AutoCAD and compare pixel-for-pixel)

Unless stated otherwise, every test should be written as R12, R2000, R2007 and R2018 and plotted through a fixed PNG plotter configuration.

**Structure and validity** (does AutoCAD open it?)
1. **Rejection matrix.** One minimal R2018 file per item in the [§18 writer checklist](#18-writer-checklist-things-autocad-rejects). Record whether AutoCAD opens it and its exact error text. This becomes the negative test suite for truedxf's writer.
2. **`$XCLIPFRAME` / `$ACADMAINTVER` group codes.** Write each version × code (280/290, 70/90) × value, and record which files open.
3. **HATCH spline edge `97`.** Present/absent × R2004/R2007/R2010/R2013/R2018 × with/without fit points. This extends ezdxf#156.
4. **MTEXT embedded object 70.** For all 9 attachment points, write R2018 MTEXT with embedded 70 = 71 and with 70 = 1. Plot to measure AutoCAD's anchoring (ezdxf#1416).
5. **ATTRIB 280 layout.** Version+lock_position, only lock_position, and reversed order (ezdxf#907).

**Text**

6. **TEXT alignment grid.** All 72×73 combinations × {Arial, txt.shx, romans.shx, SimSun} × width factor {1, 0.7} × oblique {0, 15°}. Write both correct and deliberately wrong group 10 values to see which point AutoCAD uses (ezdxf#319, #320, #688).
7. **FIT/ALIGNED mirror matrix.** FIT/ALIGNED × BACKWARD/UPSIDE_DOWN/both × extrusion ±Z (ezdxf#353, #280).
8. **TTF metrics.** One line "HxpÅgÉ VA LW T. TA Ts" per font at height 100: Arial, Arial Narrow, Arial Black, Times, SimSun, SimHei, Microsoft YaHei. Measure cap height, advances, kerning (expected: none) and CJK scale (ezdxf#865, #1075).
9. **Glyph fallback.** Standard = arial.ttf with Chinese, ∅ (U+2205), Hebrew and Thai strings, as TEXT and MTEXT (ezdxf#936, #1211, #1259, #1387).
10. **Caret and control codes.** TEXT and MTEXT containing `^I ^J ^M ^@ ^ ` `%%c %%d %%p %%u %%%`, a trailing `^` (expect a rejection for TEXT), and an invalid `\:` escape (ezdxf#170, #197, #198, #199).
11. **Codepages.** R2004 files in ANSI_1252/932/936/1256 with native bytes and `\U+` (upper and lower case) escapes. Add MTEXT whose 250-char chunks split an escape (ezdxf#1271, #1322, #1380).

**MTEXT**

12. **Wrapping.** Column widths just below and above word boundaries. Multiple spaces, leading spaces, words longer than the column, CJK strings without spaces (ezdxf#620, #956, #1389).
13. **Paragraph codes.** `\pi`, `\pl`, `\pr`, `\pt` with small and large values at char heights 1 and 480. This decides factor vs absolute (ezdxf#1390).
14. **Line spacing.** 44 factors {0.25, 0.6, 1, 2.5}, 73 style {at least, exactly}, and multi-line middle attachment (ezdxf:notes/Notes on Rendering DXF Content).
15. **Stacking.** `\S1/2;` `\S3#4;` `\S5^6;` with `\H0.7x;` wrappers, as in ezdxf#889. Also `\A0/1/2` alignment of stacks.
16. **Style defaults.** A STYLE with width factor 0.7 and oblique 15, MTEXT without `\W`/`\Q` (ezdxf#1351).
17. **Absolute inline height in a scaled block.** `\H150;` in a block inserted at scale 0.001 and 1000 (ezdxf#855).

**Hatch**

18. **Pattern ground truth.** ANSI31, AR-CONC, AR-SAND and GRAVEL with scale {0.5, 1, 50} × angle {0, 30} × `$MEASUREMENT` {0, 1}. Write consistent lines, and deliberately *unscaled* lines with the same 41/52, to prove AutoCAD renders the stored lines (ezdxf#94, #1037, #1302).
19. **Pattern under INSERT.** The same hatch in blocks inserted with translation, rotation 180°, uniform scale, non-uniform scale and mirror. Compare with AutoCAD EXPLODE output (ezdxf#783, #1392, #1402).
20. **Boundary edge cases.**
    - clockwise arc and ellipse edges
    - a full circle as 0..360 and as −180..180
    - edges out of order and reversed
    - boundaries with gaps of 1e-6, 1e-3 and 1e-1
    - an open loop
    - two loops in one edge path
    - overlapping outer paths
    - textbox-flag paths
    - hatch_style normal/outer/ignore
    (ezdxf#175, #302, #454, #466, #573, #706)
21. **Density limit.** ANSI31 at decreasing scales until AutoCAD switches to solid or refuses to plot (ezdxf#618, #929).

**Linetypes**

22. **Standard linetypes.** Standard names with AutoCAD's acad.lin definitions (ezdxf#1411) on LINE, ARC, LWPOLYLINE with bulges and SPLINE. LTSCALE {1, 10}, CELTSCALE, entity 48, and PLINEGEN on/off.
23. **PSLTSCALE.** Viewports at scales 1:1, 1:10 and 1:100 with PSLTSCALE 0/1, plus paperspace entities (ezdxf#1386).
24. **Complex linetypes.** Text and shape elements as in ezdxf#809, with rotation 0/357.8°, upright flag and missing SHX (ezdxf#737).
25. **Dots and caps.** Zero-length dash elements (dots) with lineweights 0.00/0.50/2.11 mm; check cap style (ezdxf#230, #607).

**Geometry**

26. **OCS.** ARC, CIRCLE, LWPOLYLINE with bulges, TEXT, HATCH and INSERT with extrusion (0,0,−1), (0,0,0) and a tilted normal (ezdxf#32, #145, #280, #1400).
27. **Nested mirrored INSERTs.** sx=−1 at 1, 2 and 3 levels with rotation 90°, holding ARC/TEXT/HATCH/ATTRIB (ezdxf#380, #154).
28. **SOLID/TRACE/3DFACE.** Vertex order and every 3DFACE edge-visibility bitmask, plus a degenerate face used as a line (ezdxf#422, #513, #621).
29. **Wide polylines.**
    - tapered 0→5 segments
    - collinear back-and-forth segments
    - the dot as 2 vertices with bulge 1 and const width = r
    - bulge ≥ 1
    - duplicate vertices
    (ezdxf#461, #1078, #1352)
30. **SPLINE.**
    - fit-point-only splines
    - repeated interior knots
    - nearly equal clamped knots
    - rational splines
    - the "closed" flag on an open spline
    Compare plotted tessellation with ours (ezdxf#851, #1028, #1284).
31. **2D POLYLINE curve-fit and spline-fit.** Vertex flags 1/8/16 (ezdxf#1316).
32. **ELLIPSE.** Ratios 1e-10 and 1.0000001. Negative ratio. start == end parameter (ezdxf#800).
33. **Degenerate entities.** Radius-0 CIRCLE, ARC start==end, zero-length LINE with lineweight, TEXT/MTEXT with height 0 (ezdxf#184, #330, #1372).

**Dimensions and blocks**

34. **DIMENSION display.**
    - A dimension whose `*D` block disagrees with its group 1 / DIMSTYLE: expect the block to be shown.
    - The same without group 2: expect AutoCAD to regenerate. Record the result per dimtype (linear, aligned, angular 2L/3P, radius, diameter, ordinate, arc, jogged).
    (ezdxf#253, #984)
35. **DIMENSION in nested blocks** with insert point 12 ≠ 0 (ezdxf#453).
36. **ATTRIB draw order over HATCH** in INSERTs. Constant ATTDEFs, invisible via 60 vs 70 bit 1, `$ATTMODE` 0/1/2 (ezdxf#648, #1321).
37. **Layer 0 / BYBLOCK / BYLAYER inheritance** in nested INSERTs, with frozen and off layers and a non-plot layer (ezdxf:notes/Notes on Rendering DXF Content).
38. **XCLIP.** Rectangular, polygonal and inverted clips. Clip frame 0/1/2. Moving, rotating and mirroring the INSERT after clipping (ezdxf:notes/Exploring the transformation behavior of SPATIAL_FILTER).

**Layouts and color**

39. **VIEWPORT math.** Panned (12 ≠ target), twisted (51), non-rectangular clip, status 0 viewports, a non-normalized direction, per-VP frozen layers and per-VP layer color overrides (ezdxf#1318, #1362, #1298, #535).
40. **ACI calibration.** A 256-swatch grid of SOLID/HATCH in modelspace and paperspace, plotted with no CTB, `acad.ctb` and `monochrome.ctb`. Include ACI 7 on a white and a dark plot background, a CTB mapping 7→red, and true color/transparency swatches (ezdxf#447, #1401).
41. **Lineweights.** Every valid lineweight, 0, DEFAULT, BYLAYER/BYBLOCK, LWDISPLAY off, "plot lineweights" off, and scaled lineweights (ezdxf#226, #256, #797).
42. **IMAGE / WIPEOUT.** IMAGE with brightness/contrast/fade extremes, a clip boundary, missing file (AutoCAD draws the frame and filename), rotation from u/v vectors. WIPEOUT with frame on/off in model and paper space (ezdxf#205, #999).

**Proxies**

43. **Proxy-graphics oracle.** Use BricsCAD's MLEADER-with-block trick (ezdxf#906) or AutoCAD-authored MLEADERs to capture proxy graphics for circles, arcs, text and LWPOLYLINE with width, including inverted normals. Compare truedxf's proxy renderer with AutoCAD's native render (ezdxf#793, #832, #873).

**Tooling note**

`accoreconsole.exe /i in.dwg /s plot.scr` with a `-PLOT` script can batch-produce PNGs from AutoCAD (ezdxf#724).
- Script: `-PLOT Y Model "PublishToWeb PNG.pc3" <paper> P N W <xmin,ymin> <xmax,ymax> F C Y . Y A "out.png" N Y`.
- It needs a full AutoCAD license; TrueView's accoreconsole refuses `-PLOT`.
- DXF→DWG conversion first can be done with `SAVE <path> 16`.
