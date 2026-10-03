# Question backlog

Open questions about AutoCAD behaviour, extracted from every **UNKNOWN**, **CONFLICT**, **ASSUMPTION** and
"needs AutoCAD test" item and the *Test ideas* of `research/notes/` (01–11c), deduplicated across notes.
Each question gets answered by one or more generated fixtures (`tools/gen`) plotted/re-saved by the AutoCAD
harness (`tools/acad`). When AutoCAD answers, update the note (mark **VERIFIED-BY-ACAD** with case id and date),
set the status here to `answered` (or `wontfix`) and add the answer in one line under the table of that topic.

- **ID** is stable; never renumber. New questions get the next free id at the end of their topic table.
- **question** starts with the kind: `[C]` CONFLICT between sources, `[U]` UNKNOWN, `[A]` ASSUMPTION to verify,
  `[T]` test idea pinning a claim that comes from other libraries.
- **source**: note number and section (`06 §2.6` = research/notes/06-…md §2.6); `Tn`/`H3`… are the note's test ideas.
- **test**: case ids (`suite/case`, `-*` = numbered variants) that answer it — maintained by
  `tools/gen/.venv/Scripts/python tools/gen/run.py --update-questions`; `plan: <suite> (<how>) — hint` when no case
  exists yet (`how` = png plot / dxfout re-save values / log answered errors / lisp probe).
- **status**: `answered` | `answered` | `wontfix`.

736 questions. Topics: [file-format](#file-format) (49), [encoding](#encoding) (20), [header](#header) (12), [tables](#tables) (4), [objects](#objects) (10), [entities-common](#entities-common) (1), [extents](#extents) (17), [ocs](#ocs) (7), [lines-curves](#lines-curves) (8), [polylines](#polylines) (22), [points](#points) (5), [ellipses](#ellipses) (4), [splines](#splines) (15), [solids](#solids) (6), [meshes-3d](#meshes-3d) (4), [colors](#colors) (10), [lineweights](#lineweights) (11), [transparency](#transparency) (7), [plotstyles](#plotstyles) (11), [plotting](#plotting) (42), [property-resolution](#property-resolution) (12), [draw-order](#draw-order) (9), [linetypes](#linetypes) (36), [hatches](#hatches) (42), [text](#text) (36), [mtext](#mtext) (49), [fonts](#fonts) (33), [attribs](#attribs) (12), [dimstyle](#dimstyle) (13), [dimensions](#dimensions) (63), [leaders](#leaders) (26), [blocks](#blocks) (18), [xrefs](#xrefs) (4), [xclip](#xclip) (12), [images](#images) (34), [wipeout](#wipeout) (8), [mline](#mline) (12), [acad-table](#acad-table) (3), [proxy](#proxy) (16), [layouts](#layouts) (6), [viewports](#viewports) (27)

<a id="file-format"></a>
## File format and parsing (`file-format`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0001 | file-format | [A] Does current AutoCAD DXFOUT formatting match acs-samples (CRLF, 3-char code pad, 6/9-char int pad, shortest float repr, R12 16-decimal floats)? | 01 header (acs-samples), §1.1 | `fileformat/version-r12`, `fileformat/version-r2000`, `fileformat/version-r2004`, `fileformat/version-r2007` (+3 more) | answered |
| Q-0002 | file-format | [A] Is acs-sample (AC1032, MAINTVER 329) really AutoCAD-written: does an AutoCAD open+DXFOUT reproduce its structure/XDATA (e.g. SOLID,_O, GradientColor XDATA)? | 06 header (source abbreviations) | `fileformat/corpus-acs-sample-ac1032` | answered |
| Q-0003 | file-format | [U] Does AutoCAD open DXF files with LF-only, CR-only and doubled-CR '\r\r\n' line ends (the latter as one break or as blank lines)? | 01 §1.3, §10 item 4; 11c §3 doubled CR (libredwg#17) (01:T3) | `fileformat/eol-lf-r12`, `fileformat/eol-cr-r12`, `fileformat/eol-crlf-r12`, `fileformat/eol-crcrlf-r12` (+8 more) | open |
| Q-0004 | file-format | [U] Does AutoCAD accept trailing spaces after structure names (e.g. 'SECTION ', 'ENTITIES ', 'LINE ') on code-0/2 value lines? | 01 §1.3 (01:T3) | `fileformat/trailing-space-types-r12`, `fileformat/trailing-space-sections-r12`, `fileformat/trailing-space-types-r2018`, `fileformat/trailing-space-sections-r2018` | answered |
| Q-0005 | file-format | [U] Does AutoCAD accept group-code lines padded with tabs or trailing spaces (e.g. '\t0', ' 10 ')? | 01 §1.3 (01:T3) | `fileformat/code-pad-tab-r12`, `fileformat/code-pad-trailing-space-r12`, `fileformat/code-pad-no-pad-r12`, `fileformat/code-pad-wide-pad-r12` (+4 more) | open |
| Q-0006 | file-format | [U] Does AutoCAD accept lowercase structure names ('section', 'entities', 'line', 'eof')? | 01 §8.1, §10 item 3 (01:T3) | `fileformat/lowercase-all-r12`, `fileformat/lowercase-entities-r12`, `fileformat/lowercase-all-r2018`, `fileformat/lowercase-entities-r2018` | answered |
| Q-0007 | file-format | [T] Does AutoCAD open files with 999 comments at file start and between 0 SECTION and 2 ENTITIES / 2 HEADER? | 11c §3 (999 anywhere, REPORTED); 11c §13 Mentor PADS / FiberSim rows; 11c §18 #26 | `fileformat/comment-999-top-r12`, `fileformat/comment-999-sections-r12`, `fileformat/comment-999-entity-r12`, `fileformat/comment-999-top-r2004` (+2 more) | answered |
| Q-0008 | file-format | [A] Does AutoCAD accept empty value lines (STYLE 4 '', header $DIMBLK 1 '') but refuse an empty line where a group code is expected? | 11c §3 (no empty line at group-code position; empty values fine; blank lines) | `fileformat/empty-values`, `fileformat/empty-code-line-r12`, `fileformat/empty-code-line-r2018` | open |
| Q-0009 | file-format | [A] Does AutoCAD refuse a DXF with NUL bytes inside a string value (e.g. trailing NULs after a layer name)? | 11c §3 (NUL bytes, libdxfrw#19); 11c §13 libdxfrw row | `fileformat/nul-layer-name`, `fileformat/nul-text-value` | open |
| Q-0010 | file-format | [T] Does AutoCAD open a DXF that ends inside ENTITIES without ENDSEC/EOF, or whose final '0/EOF' lacks a trailing newline? | 11c §3 (missing ENDSEC, truncated autosave, no trailing newline); 11c §18 #26 | `fileformat/truncated-no-endsec-r12`, `fileformat/truncated-no-eof-r12`, `fileformat/eof-no-newline-r12`, `fileformat/data-after-eof-r12` (+6 more) | open |
| Q-0011 | file-format | [T] Does AutoCAD open a file with a bare TABLE…ENDTAB block right after HEADER, without a SECTION/TABLES wrapper? | 11c §3 (old NC/CAM TABLE without TABLES, REPORTED); 11c §13; 11c §18 #26 | `fileformat/bare-table-r12` | open |
| Q-0012 | file-format | [C] Does AutoCAD open R2000+ DXF strings of 2049 bytes (and 2050+), and R12 strings >255/256 chars (spec 256 vs 2049 conflict)? | 01 §1.5 | `fileformat/long-text-255-r12`, `fileformat/long-text-256-r12`, `fileformat/long-text-300-r12`, `fileformat/long-text-2049-r12` (+7 more) | open |
| Q-0013 | file-format | [A] Does AutoCAD write and read long 3xx string fields (e.g. GEODATA 301) with continuation code 303 (dxf+2)? | 11c §3 (3xx continuation dxf+2, REPORTED) | `misc/geodata-long-cs` | open |
| Q-0014 | file-format | [A] Does AutoCAD accept 310 binary-chunk lines longer than 127 bytes (254 hex digits), and a last chunk padded with extra bytes? | 11c §3 binary chunks (ACadSharp#1153/#1140) | `fileformat/xrecord-310-lines-127`, `fileformat/xrecord-310-lines-200`, `fileformat/xrecord-310-lines-16`, `fileformat/thumbnail-310-127` (+2 more) | open |
| Q-0015 | file-format | [C] Does AutoCAD read AC1012/AC1014 binary DXF with 1-byte group codes, 2-byte codes, or both? | 01 §2.1 (01:T13) | `fileformat/binary-r12`, `fileformat/binary-r2000`, `fileformat/binary-r2004`, `fileformat/binary-r2018` (+4 more) | open |
| Q-0016 | file-format | [A] Does AutoCAD read binary DXF with proxy-graphic 310 data as raw bytes, and reject 310 written as hex strings in binary DXF? | 11a §1 | `fileformat/binary-proxy-310-raw`, `fileformat/binary-proxy-310-hex-text` | open |
| Q-0017 | file-format | [U] Which float syntaxes does AutoCAD accept in real codes: '1e2', '1.0E+02', '.5', '5.', '+5', '-0', ' 5 ', '1 0.5', decimal comma '1,5'? | 01 §1.4, §10 item 16 (01:T5) | `fileformat/float-1e1`, `fileformat/float-exp-upper`, `fileformat/float-leading-dot`, `fileformat/float-trailing-dot` (+7 more) | open |
| Q-0018 | file-format | [U] Does AutoCAD accept numbers with trailing garbage ('5xyz', '47.11xyz'), parsing the leading number like strtod? | 01 §1.4 (01:T5) | `fileformat/trailing-garbage-line-x`, `fileformat/trailing-garbage-circle-radius`, `fileformat/trailing-garbage-line-color` | open |
| Q-0019 | file-format | [U] Does AutoCAD accept integers written as floats ('1.0', '1e0', '1.95059E+06' in 1071) in int16/int32 codes? | 01 §1.4 (01:T5) | `fileformat/int-as-float-color`, `fileformat/int-as-float-flags`, `fileformat/int-as-float-xdata-*` | open |
| Q-0020 | file-format | [T] Does AutoCAD read 17-significant-digit doubles bit-exactly (as its DXFOUT shows), and accept reals written without '.0' (e.g. '943')? | 11c §3 doubles; 11c §18 #7 | `fileformat/float-17-digits`, `fileformat/float-integer-looking` | open |
| Q-0021 | file-format | [U] What does AutoCAD do with int16 overflow (62=32768, 70=70000) and non-finite reals (1e999, 'nan', '-nan(ind)'): refuse, clamp or wrap? | 01 §1.4; 11c §3 NaN (netDxf#202) (01:T5) | `fileformat/overflow-color-32768`, `fileformat/overflow-color-minus-32769`, `fileformat/overflow-lwpolyline-flags-70000`, `fileformat/overflow-circle-radius-1e999` (+5 more) | open |
| Q-0022 | file-format | [U] Are group codes 450-459 signed int32 in AutoCAD (values >= 2^31 written negative or rejected)? | 01 §1.2 | `fileformat/gradient-int32-450-2147483648`, `fileformat/gradient-int32-451-minus1`, `fileformat/gradient-int32-452-4294967295`, `fileformat/gradient-int32-453-minus1` | open |
| Q-0023 | file-format | [U] Which 290 bool values does AutoCAD accept on OPEN: '2', '-1', 'true', padded '     1'? | 01 §1.2, §1.4 (01:T6) | `fileformat/bool-290-0`, `fileformat/bool-290-1`, `fileformat/bool-290-2`, `fileformat/bool-290-minus1` (+2 more) | open |
| Q-0024 | file-format | [C] How does AutoCAD encode XDATA 1004 in ASCII (hex string) and binary DXF (length-prefixed chunk), and does it accept 1004 as plain text? | 01 §1.2 | `fileformat/xdata-1004-hex`, `fileformat/xdata-1004-plain-text`, `fileformat/xdata-1004-odd-hex`, `fileformat/xdata-1004-lowercase-hex` (+1 more) | open |
| Q-0025 | file-format | [C] In which contexts does AutoCAD reject an undefined group code (e.g. code 85 or 305 inside AcDbLine) in R12 vs R2018 files? | 01 §1.1 | `fileformat/undef-code-85-r12`, `fileformat/undef-code-85-acdbentity`, `fileformat/undef-code-85-acdbline`, `fileformat/undef-code-155-r12` (+9 more) | open |
| Q-0026 | file-format | [U] Does AutoCAD accept a LINE with coordinates ordered 10,11,20,21,30,31 (old QCAD style)? | 01 §6.3 | `fileformat/line-interleaved-coords-r12`, `fileformat/line-interleaved-coords-r2000` | open |
| Q-0027 | file-format | [U] Does AutoCAD reject an R12 file with a 100 marker in LINE, or with 102 {ACAD_REACTORS in LINE? | 01 §6.3, §9 (01:T16) | `fileformat/r12-line-subclass-markers`, `fileformat/r12-line-reactors`, `fileformat/r12-line-owner-330` | open |
| Q-0028 | file-format | [A] Does AutoCAD reject entities with misspelled subclass markers (AcDb3dPointAngularDimension) or missing subclass markers? | 11a §10 | `fileformat/subclass-angular-dim-correct`, `fileformat/subclass-angular-dim-misspelled`, `fileformat/subclass-line-none`, `fileformat/subclass-line-no-acdbline` (+1 more) | open |
| Q-0029 | file-format | [U] Does AutoCAD accept app-data groups ({ACAD_XDICTIONARY, custom {MYAPP) placed after 100 AcDbEntity or inside AcDbLine? | 01 §6.2 (01:T18) | `fileformat/appdata-custom-normal`, `fileformat/appdata-xdict-after-acdbentity`, `fileformat/appdata-custom-in-acdbline` | open |
| Q-0030 | file-format | [U] Does AutoCAD accept the closer form '102 MYAPP}' for an app-data group? | 01 §6.2 (01:T18) | `fileformat/appdata-custom-normal`, `fileformat/appdata-closer-named`, `fileformat/appdata-unbalanced` | open |
| Q-0031 | file-format | [C] Does AutoCAD accept XDATA codes 1006-1009, 1014-1039 and 1043 (in spec ranges, not in ezdxf's valid set)? | 01 §6.4 (01:T17) | `fileformat/xdata-code-*` | open |
| Q-0032 | file-format | [U] Does AutoCAD refuse unbalanced 1002 braces or 1002 values other than { and }? | 01 §6.4 (01:T17) | `fileformat/xdata-brace-unbalanced`, `fileformat/xdata-brace-value-x`, `fileformat/xdata-brace-extra-closer`, `fileformat/xdata-brace-nested` | open |
| Q-0033 | file-format | [U] Does AutoCAD accept codes >= 1000 before the first 1001 as regular data, and two XDATA groups with the same APPID? | 01 §6.4 (01:T17) | `fileformat/xdata-1000-before-*`, `fileformat/xdata-same-appid-twice` | open |
| Q-0034 | file-format | [U] Does AutoCAD refuse, silently drop or auto-register XDATA whose 1001 APPID is not in the APPID table, and with what error? | 01 §3.2, §6.4; 11c §12 (every 1001 name must exist in APPID) (01:T17) | `fileformat/xdata-unregistered-appid-r2000`, `fileformat/xdata-unregistered-appid-r2018` | open |
| Q-0035 | file-format | [A] Is there a 16 KB XDATA size limit per entity in AutoCAD, and what happens on OPEN when a DXF exceeds it? | 01 §6.4 | `fileformat/xdata-size-15kb`, `fileformat/xdata-size-17kb`, `fileformat/xdata-size-20kb`, `fileformat/xdata-size-64kb` | open |
| Q-0036 | file-format | [U] Where does AutoCAD place an embedded object (101) relative to XDATA (1001) in AC1032 output, and does it accept the other order? | 01 §6.4; 11a §9 | `fileformat/mtext-columns-xdata-ezdxf-order`, `fileformat/mtext-columns-xdata-embedded-after-xdata` | open |
| Q-0037 | file-format | [A] Which XDATA APPIDs affecting rendering does AutoCAD write (e.g. ACAD_PSEXT on VIEWPORT, ACAD DSTYLE, MTEXT fill)? | 01 §6.4 | `fileformat/appids-written` | open |
| Q-0038 | file-format | [U] In AutoCAD R2013+ output containing both THUMBNAILIMAGE and ACDSDATA, which section comes first? | 01 §3.1, §10 item 15 | `fileformat/r2018-3dsolid-thumbnail`, `fileformat/thumbnail-310-127`, `fileformat/thumbnail-310-200`, `fileformat/thumbnail-310-padded-last` | open |
| Q-0039 | file-format | [U] Does AutoCAD open an AC1015 file without a CLASSES section, or without OBJECTS / root dictionary / ACAD_GROUP entry? | 01 §3.2 (01:T2) | `fileformat/entities-only-r2018-cut`, `fileformat/r2000-no-classes`, `fileformat/r2000-no-objects`, `fileformat/r2000-no-root-dict` (+2 more) | open |
| Q-0040 | file-format | [U] Does AutoCAD open an AC1015 file with HEADER($ACADVER only)+TABLES(LAYER only)+ENTITIES and no other sections? | 01 §3.2 | `fileformat/acs1244-minimal-ac1015` | open |
| Q-0041 | file-format | [A] Does AutoCAD (not just TrueView) open an ENTITIES-only DXF with no $ACADVER and no handles, and which version/handles does it assign? | 11c §3 (header-less DXF opens in TrueView, REPORTED); 11c §13 Maker.js row; 11c §18 #26 | `fileformat/entities-only-no-handles`, `fileformat/entities-only-handles`, `fileformat/entities-only-r2000-tags` | open |
| Q-0042 | file-format | [U] Which types need a CLASS record for AutoCAD to open R2000+ DXF (MLEADER, IMAGE, MESH...); are DIMENSION/HATCH/LWPOLYLINE fine with empty CLASSES? | 01 §6.7, §10 item 6; 11c §12 (MESH without its class reads as a proxy), §14 (empty CLASSES in R14) | `fileformat/r2000-empty-classes`, `fileformat/r2004-empty-classes`, `fileformat/class-missing-mesh`, `fileformat/class-missing-image` (+3 more) | open |
| Q-0043 | file-format | [U] Does AutoCAD reject CLASS records with 280 and 281 swapped? | 01 §6.7 (01:T15) | `fileformat/class-281-before-280` | open |
| Q-0044 | file-format | [U] What does AutoCAD do with duplicate handles (two LINEs 'A0'; GROUP sharing a table record's handle): refuse, RECOVER, renumber; which do refs hit? | 01 §6.1, §10 item 11; 11c §4 (duplicate handles), §13 LibreDWG row (01:T14) | `fileformat/dup-handle-lines-r2000`, `fileformat/dup-handle-lines-r2018`, `fileformat/dup-handle-group-layer` | open |
| Q-0045 | file-format | [U] Does AutoCAD accept lowercase hex handles and 16-digit handles, and does DXFOUT normalize them? | 01 §6.1 (01:T14) | `fileformat/handle-lowercase`, `fileformat/handle-16-digit`, `fileformat/handle-leading-zeros`, `fileformat/handle-lowercase-group-ref` (+1 more) | open |
| Q-0046 | file-format | [U] Does AutoCAD accept an entity with handle '0' (the null handle)? | 01 §6.1 (01:T14) | `fileformat/handle-zero`, `fileformat/handle-missing-r2018` | open |
| Q-0047 | file-format | [C] Does AutoCAD 2027 open an AC1014 DXF written the way AutoCAD R14 wrote it (empty CLASSES, R14 DIMSTYLE table header), or refuse all AC1014? | 11c §14 (R13/R14); 11c §16 (AC1014 DXF); 11c §18 #8 | `fileformat/binary-ac1014-relabel`, `fileformat/ac1014-relabel`, `fileformat/ac1014-relabel-empty-classes`, `fileformat/acadver-ac1012` (+3 more) | open |
| Q-0048 | file-format | [T] Does accoreconsole open and plot an R12 DXF (and an R2018 DXF) given via /i without errors? | 08 §6.2, §9 T-ACC-4 (08:T-ACC-4) | `fileformat/version-r12`, `fileformat/version-r2000`, `fileformat/version-r2004`, `fileformat/version-r2007` (+7 more) | open |
| Q-0050 | file-format | [T] Do ezdxf examples_dxf and GDAL autotest DXF fixtures open without errors in AutoCAD, and what do SAVEAS-per-version and PLOT produce? | n/a | `fileformat/corpus-acs-sample-ac1032`, `fileformat/corpus-acs-sample-ac1009`, `fileformat/corpus-acs-sample-ac1015-binary`, `fileformat/corpus-ezdxf-3dface` (+100 more) | open |

- Q-0004: Trailing spaces after SECTION/ENTITIES names make the file invalid; a padded entity type (`LINE `) in AC1032 loads but the entity is dropped (`fileformat/trailing-space-*`, note 01 §8.1).
- Q-0006: Lower-case section/structure names make the file invalid; lower-case entity types plot in R12 but are dropped in AC1032 (`fileformat/lowercase-*`).
- Q-0007: Yes: 999 comments at the file start, between entities and between 0 SECTION and 2 name are accepted (`fileformat/comment-999-*`).

<a id="encoding"></a>
## Encodings (`encoding`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0051 | encoding | [A] Does AutoCAD open an ASCII DXF (AC1009/AC1018/AC1032) that starts with a UTF-8 BOM, and does its DXFOUT ever write a BOM? | 01 §5.1; 11c §5 (BOM: accept) (01:T3) | `fileformat/utf8-bom-r12`, `fileformat/utf8-bom-r2004`, `fileformat/utf8-bom-r2018` | open |
| Q-0052 | encoding | [U] Which $DWGCODEPAGE spellings does AutoCAD honour ('ansi_1251', 'ANSI1251', 'CP1251', 'dos866', 'DOS850', 'kcs5601', 'GB2312', '8859_1'); empty/missing? | 01 §5.2; 11b §3, Test ideas; 11c §5 ($DWGCODEPAGE names in the wild), §18 #27 (01:T12, 11b:7) | `fileformat/codepage-ansi-*`, `fileformat/codepage-lower-ansi-*`, `fileformat/codepage-ansi1251`, `fileformat/codepage-cp1251` (+8 more) | open |
| Q-0053 | encoding | [A] Does AutoCAD warn about or refuse an AC1018 DXF whose $DWGCODEPAGE is ANSI_1200, and how does it decode its non-ASCII strings? | 11c §5 (ANSI_1200, netDxf#146 REPORTED) | `fileformat/codepage-ansi-*` | open |
| Q-0054 | encoding | [A] In pre-AC1021 files, are valid UTF-8 high bytes decoded per $DWGCODEPAGE (mojibake under ANSI_1252/ANSI_936) or auto-detected as UTF-8? | 01 §5.5; 11b §3, Test ideas; 11c §5 (UTF-8 under ANSI header gives mojibake, ACadSharp#1092) (01:T11, 11b:7) | `text/utf8-bytes-ansi1252-r2004`, `text/utf8-bytes-ansi936-r2004` | open |
| Q-0055 | encoding | [A] In AC1021+ DXF, does AutoCAD ignore $DWGCODEPAGE (e.g. ANSI_1251/932/936) and always decode strings as UTF-8? | 11b §3, Test ideas; 11c §5 (R2007+ ignores $DWGCODEPAGE, netDxf#146) (11b:7) | `fileformat/utf8-r2013-ansi-*`, `fileformat/utf8-r2013-ansi-932`, `fileformat/utf8-r2013-ansi-936`, `fileformat/utf8-r2018-ansi-*` (+2 more) | open |
| Q-0056 | encoding | [U] How does AutoCAD handle invalid-UTF-8 cp1252/cp932 bytes in an AC1021+ file: refuse, replace, or fall back to $DWGCODEPAGE? | 01 §5.5; 11a §2 (01:T11, 11a:11) | `text/invalid-utf8-cp1252-r2007`, `text/invalid-utf8-cp932-r2007` | open |
| Q-0057 | encoding | [U] Which Unicode characters does AutoCAD map cp932/cp936 bytes to at the code points where Microsoft tables and WHATWG shift_jis/gbk differ? | n/a | `fileformat/divergent-ansi-932`, `fileformat/divergent-ansi-936` | open |
| Q-0058 | encoding | [T] How does AutoCAD decode R2004 files in ANSI_932/936/1256 with native bytes, and an MTEXT whose 250-char chunks split a \U+ escape? | 11a §2 (11a:11) | `fileformat/native-ansi-932`, `fileformat/native-ansi-936`, `fileformat/native-ansi-*`, `fileformat/native-ansi-949` (+5 more) | open |
| Q-0059 | encoding | [A] In an ANSI_932/936/950 file, do DBCS trail bytes 0x5C/0x7B/0x7D in MTEXT get misread as MTEXT codes by AutoCAD? | 01 §5.4 (01:T10) | `mtext/dbcs-trail-5c-ansi932`, `mtext/dbcs-trail-5c-ansi936`, `mtext/dbcs-trail-5c-ansi950` | open |
| Q-0060 | encoding | [A] Does AutoCAD decode a DBCS character whose two bytes are split across MTEXT 3/1 chunks in an ANSI_932 file? | 01 §5.4 | `mtext/dbcs-chunk-split-ansi932` | open |
| Q-0061 | encoding | [U] Does AutoCAD decode caret escapes (^I, ^J, ^M, '^ ' for literal ^) in TEXT and layer/block names on OPEN, keep a literal tab, and re-encode on DXFOUT? | 01 §1.5; 11c §3 (C0 control chars caret-encoded; tab literal) (01:T7) | `fileformat/caret-text`, `fileformat/caret-names`, `text/caret-controls` | open |
| Q-0062 | encoding | [U] Which \U+ spellings does AutoCAD decode in TEXT/MTEXT: lowercase prefix '\u+00fc', lowercase hex '\U+00fc', no-plus '\U00FC'? | 01 §5.3, §10 item 5; 11a §2 (01:T8, 11a:11) | `text/escape-spellings-r2000` | open |
| Q-0063 | encoding | [U] Does AutoCAD decode \U+XXXX in AC1032 TEXT/MTEXT, and how does it show malformed '\U+', '\U+00 ', '\U+ZZZZ' (literal, '?', or error)? | 01 §5.3; 11c §5 (\U+ in R2007+ files; be lenient), §18 #27 (01:T8) | `text/escape-malformed-r2000`, `text/escape-malformed-r2018`, `text/escape-literal-r2018` | open |
| Q-0064 | encoding | [A] How does AutoCAD encode characters above U+FFFF in <AC1021 files: surrogate pair '\U+D83D\U+DE00' or 8-digit '\U+1F600'? | 01 §5.3, §10 item 5 (01:T8) | `text/escape-astral-r2004` | open |
| Q-0065 | encoding | [U] Does AutoCAD decode \U+XXXX in layer, block and style names (decoded in the layer list? raw or decoded on DXFOUT)? | 01 §3.3, §5.3; 11b §3 (01:T8, 11b:7) | `fileformat/unicode-escape-names-r2004`, `fileformat/unicode-escape-names-r2018` | open |
| Q-0066 | encoding | [U] How does DXFOUT write user-typed literal text '\U+0041' in TEXT (escaped?), and does reopening show it literally or as 'A'? | 01 §5.3 | `text/escape-literal-r2018` | open |
| Q-0067 | encoding | [C] Which codepage does each \M+nXXYY selector map to (1=932, 2=950, 3=949, 4=1361 Johab vs ezdxf 1391, 5=936), in TEXT and bigfont MTEXT? | 01 §5.3; 11a §2; 11b §3, Test ideas; 11c §5 (\M+ MIF), §18 #27 (01:T9, 11b:7) | `text/mif-selectors-r2004` | open |
| Q-0068 | encoding | [U] Is \M+ (MIF) decoded at file-load time only, or also at display time (literal \M+ in created TEXT stayed literal)? | 04 §5 (04:T21) | `acad-default-fonts/mif-r2004-text`, `acad-default-fonts/mif-r2004-mtext` | open |
| Q-0069 | encoding | [A] Is \M+ in R2007+ DXF (UTF-8) files decoded by AutoCAD? | 04 §5 (04:T21) | `acad-default-fonts/mif-r2018-mtext-bigfont`, `acad-default-fonts/mif-r2018-mtext-ttf` | open |
| Q-0070 | encoding | [A] With a bigfont, is the \M+ DBCS code / raw DBCS byte pair used directly as the bigfont shape number? | 04 §5 (04:T21) | `acad-default-fonts/bigfont-native-ansi-932`, `acad-default-fonts/bigfont-native-ansi-950` | open |

<a id="header"></a>
## Header variables (`header`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0071 | header | [U] What does AutoCAD do with a file without $ACADVER that contains R2000 structures (subclass markers, OBJECTS)? | 01 §4.1 | `fileformat/r2000-acadver-missing`, `fileformat/r2018-acadver-missing`, `fileformat/header-no-header-section` | open |
| Q-0072 | header | [U] Does AutoCAD open an AC1015 file without $HANDSEED, or without the APPID 'ACAD' record? | 01 §3.2 (01:T2) | `fileformat/r2000-no-handseed`, `fileformat/r2000-no-appid-acad` | open |
| Q-0073 | header | [C] Which $ACADMAINTVER group code (70 vs 90) does AutoCAD accept per version (AC1015..AC1032), and does the wrong one cause rejection? | 01 §4.1, §7.1, §7.4; 11a §3 (11a:2) | `fileformat/acadmaintver-70-r2000`, `fileformat/acadmaintver-90-r2000`, `fileformat/acadmaintver-70-r2004`, `fileformat/acadmaintver-90-r2004` (+6 more) | open |
| Q-0075 | header | [U] What header content triggers AutoCAD's 'Error 372 in drawing header on line N' seen on LibreDWG R12/R14 output? | 11c §2 message catalogue (Error 372, cause unknown) | `fileformat/corpus-libredwg-leader-r12`, `fileformat/corpus-libredwg-leader-r12-hdr-drop1`, `fileformat/corpus-libredwg-leader-r12-hdr-drop2`, `fileformat/corpus-libredwg-leader-r12-hdr-drop3` (+10 more) | open |
| Q-0076 | header | [A] Does AutoCAD refuse or repair an R12 DXF with $PUCSXDIR/$PUCSYDIR = (0,0,0)? | 11c §9 (R12 PUCSXDIR/PUCSYDIR zero invalid, libredwg#1100 REPORTED) | `fileformat/r12-pucs-zero` | open |
| Q-0077 | header | [A] Are $CUSTOMPROPERTYTAG/$CUSTOMPROPERTY accepted only when they come after $LASTSAVEDBY in the HEADER? | 11a §3 | `fileformat/custom-props-after-lastsavedby`, `fileformat/custom-props-before-lastsavedby` | open |
| Q-0078 | header | [U] Which header values does AutoCAD assume when vars are missing (MEASUREMENT, LTSCALE, PDMODE, PDSIZE, PSLTSCALE, INSUNITS, FILLMODE, ATTMODE)? | 01 §7.2, §10 item 1 (01:T27) | `fileformat/header-minimal-r2000`, `fileformat/header-minimal-r2018`, `fileformat/header-no-header-section` | open |
| Q-0079 | header | [U] Does AutoCAD accept 3D header vars ($EXTMIN, $INSBASE) with only 10/20 (no 30) in an AC1015 file? | 01 §7.1, §8.1 (01:T28) | `fileformat/header-2d-points` | open |
| Q-0080 | header | [C] Does AutoCAD accept $XCLIPFRAME written with code 290 in an AC1024+ file, and how is it interpreted? | 01 §7.1, §7.2, §10 item 9 (01:T21) | `fileformat/xclipframe-290-1-r2018`, `fileformat/xclipframe-280-1-r2018`, `fileformat/xclipframe-280-2-r2018`, `fileformat/xclipframe-290-1-r2004` (+2 more) | open |
| Q-0081 | header | [C] Does AutoCAD accept $HIDETEXT/$INTERSECTIONDISPLAY written with code 290 (spec) instead of 280 in AC1018+? | 01 §7.1, §7.2, §7.4 (01:T21) | `fileformat/hidetext-290` | open |
| Q-0082 | header | [C] Does AutoCAD accept '$DIMFAC' (spec name) in HEADER, and does DXFOUT write only $DIMTFAC? | 01 §7.3, §7.4 | `fileformat/dimfac-name` | open |
| Q-0083 | header | [A] Does $INSUNITS/$MEASUREMENT ever rescale model-space geometry in a PLOT at a fixed plot scale? | 11b §4 | plan: calibration (png) — Same 100-unit square with INSUNITS 1 vs 4, plotted 1:1 | open |

<a id="tables"></a>
## Tables (`tables`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0084 | tables | [U] Does AutoCAD match layer refs case-insensitively ('WALLS'->'Walls'), and are ' A'/'A ' trimmed to 'A' or kept as distinct layers? | 01 §1.3, §10 item 2; 11a §4, §14; 11b §2 (01:T4) | `fileformat/layer-name-spaces-case`, `fileformat/layout-name-model-upper` | open |
| Q-0085 | tables | [U] With two symbol-table records of one name (LAYER 'A' red and blue, plus 'a') and no layer 0, which does AutoCAD keep: first, rename or refuse? | 01 §3.3; 02 §4.2 rule 9; 11c §3 (duplicate table entries), §18 #28 | `fileformat/layer-duplicate-records-no-layer-0`, `fileformat/layer-duplicate-records-with-layer-0` | open |
| Q-0089 | tables | [U] Does AutoCAD accept BLOCK names containing a space in R2000/R2007/R2018 DXF (rejected by TrueView in R12)? | 11a §4, Open conflicts | `fileformat/block-name-space-r12`, `fileformat/block-name-space-r2000`, `fileformat/block-name-space-r2007`, `fileformat/block-name-space-r2018` | open |
| Q-0090 | tables | [C] Does AutoCAD DXFOUT write complex-linetype text strings in LTYPE with group code 9 (spec says 9 is HEADER-only)? | 01 §1.2 | `fileformat/ltype-text-gas-line-r2000`, `fileformat/ltype-text-gas-line-r2018` | open |

<a id="objects"></a>
## Objects (`objects`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0091 | objects | [A] Does AutoCAD open a DXF whose named object dictionary is not the first object in OBJECTS (e.g. second after a DICTIONARYVAR)? | 11c §4 (root dictionary detection; NOD first, REPORTED ezdxf/ODA convention) | `fileformat/nod-not-first` | open |
| Q-0095 | objects | [A] Does AutoCAD refuse or repair dangling refs (330 owner, 340 pointer, GROUP member, dictionary 350 to a missing object), and does AUDIT fix them? | 11a §5; 11c §4 (dangling references, netDxf#219) | `fileformat/dangling-owner`, `fileformat/dangling-material`, `fileformat/dangling-group-member`, `fileformat/dangling-nod-350` (+1 more) | open |
| Q-0096 | objects | [A] Does AutoCAD ignore an ACDBDICTIONARYWDFLT whose default-object handle (340) points to a non-existent object? | 11a §5 | `fileformat/plotstylename-default-dangling` | open |
| Q-0097 | objects | [A] Does AutoCAD accept or repair GROUP members that lack a reactor back to the GROUP object? | 11c §4 (groups need member reactors, LibreCAD#2922) | `fileformat/group-members-no-reactors` | open |
| Q-0098 | objects | [C] Does AUDIT complain when ATTRIB/VERTEX/SEQEND 330 points at the BLOCK_RECORD instead of the parent INSERT/POLYLINE? | 11c §4 (sub-entity owner CONFLICT libredwg#1371 vs AutoCAD sample); 11c §16; 11c §18 #9 | `fileformat/attrib-owner-block-record`, `fileformat/vertex-owner-block-record` | open |
| Q-0099 | objects | [A] Does AutoCAD match DICTIONARY entry keys case-insensitively (e.g. 'acad_mlinestyle', style key 'standard')? | 02 §3.2, §4.2 rule 1 | `fileformat/dict-keys-lowercase` | open |
| Q-0100 | objects | [U] Does AutoCAD treat 102 {FOO / 102 } inside an XRECORD's AcDbXrecord subclass as payload and keep it verbatim (checked via DXFOUT)? | 01 §6.2 (01:T19) | `fileformat/xrecord-app-data-payload` | open |
| Q-0101 | objects | [A] Which extension-dictionary entries does AutoCAD write for XCLIP, draw order, layer overrides and annotative scale (ACAD_FILTER, ACAD_SORTENTS...)? | 01 §6.6 | `fileformat/appids-written`, `fileformat/extension-dicts` | open |
| Q-0102 | objects | [A] Does DXFOUT to an older version store newer-version features in ACAD_XREC_ROUNDTRIP XRECORDs (e.g. transparency, MTEXT columns)? | 01 §9 | plan: fileformat (dxfout) — AC1032 drawing with transparent LINE and column MTEXT; SAVEAS DXF R2004 and R2000; inspect | open |
| Q-0103 | objects | [U] Is the ezdxf SAT decoding quirk real: after decoded 'A' (0x5E), is the next character skipped / does AutoCAD insert a space? | 03 §3.15, Test ideas 38 (03:T38) | `misc/solid-box-plan-r2010` | open |

<a id="entities-common"></a>
## Common entity properties (`entities-common`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0104 | entities-common | [A] For legacy 38 elevation on CIRCLE/TEXT/INSERT etc., does AutoCAD add 38 to the OCS z, or use 38 only when the point z is 0? | 03 §1 | `ocs/r12-elevation-*` | open |

<a id="extents"></a>
## Extents (`extents`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0105 | extents | [T] Does PLOT 'Extents' recompute from geometry when $EXTMIN/$EXTMAX are bogus (±1e20, inverted, stale), and are RAY/XLINE excluded? | 11b §4, Test ideas (11b:17) | `extents/header-extents-*` | open |
| Q-0106 | extents | [U] Does save/DXFOUT recompute $EXTMIN/$EXTMAX and LAYOUT 14/15, or keep stale values (e.g. after erase) until REGEN/ZOOM Extents? | 03 §6.2; 08 §6.7 (08:T-PL-9) | `fileformat/stale-extents-too-large`, `fileformat/stale-extents-too-small`, `fileformat/stale-extents-inverted` | open |
| Q-0107 | extents | [A] Does an invisible entity (60=1) contribute to the extents used by PLOT 'Extents' (and to $EXTMIN/$EXTMAX)? | 03 §1, §6.2, Test ideas 35 (03:T35) | `extents/probe-invisible-entity`, `layouts/extents-invisible` | answered |
| Q-0108 | extents | [A] Do extents count invisible edges of 3D polylines, polyface meshes and 3DFACEs? | 03 §6.1 | `extents/probe-invisible-3dface-edges`, `layouts/extents-3dface-invisible-edges`, `layouts/extents-polyface-invisible-edges` | answered |
| Q-0109 | extents | [U] Do PLOT 'Extents' (and $EXTMIN/$EXTMAX) include entities on off layers and on frozen layers? | 03 §6.2, Test ideas 35; 08 §5.1, §8 item 17 (03:T35, 08:T-PL-9) | `extents/probe-layer-off`, `extents/probe-layer-frozen`, `layouts/extents-layer-off`, `layouts/extents-layer-frozen` (+1 more) | answered |
| Q-0110 | extents | [U] Do PLOT 'Extents', ZOOM E and $EXTMIN/$EXTMAX include entities on DEFPOINTS, incl. the defpoint POINTs inside dimension *D blocks? | 03 §6.2, Test ideas 35; 11a §10 (03:T35) | `extents/probe-layer-defpoints`, `extents/probe-dimension-defpoint`, `layouts/extents-defpoints`, `layouts/extents-dimension-defpoint` | answered |
| Q-0111 | extents | [U] Does an Extents plot include entities on non-plottable (LAYER 290=0) layers? | 08 §5.1, §8 item 17 (08:T-PL-9) | `extents/probe-layer-noplot` | answered |
| Q-0112 | extents | [U] Do PLOT 'Extents' include the PDMODE symbol size of POINTs, or only the point location? | 03 §3.1, §6.1, §6.2, Test ideas 35 (03:T35) | `points/point-extents-*` | answered |
| Q-0113 | extents | [T] Do plot 'Extents' include the thickness-extruded top of LINE/POINT/SOLID with thickness? | 03 §6.1 | `extents/probe-thickness`, `layouts/extents-thickness` | answered |
| Q-0114 | extents | [U] Do plot 'Extents' include half the lineweight of heavy entities? | 03 §6.2, Test ideas 35 (03:T35) | `extents/probe-lineweight`, `layouts/extents-lineweight` | answered |
| Q-0115 | extents | [U] Do plot 'Extents' of a wide polyline use the band outline (width) or only the centerline vertices? | 03 §6.1, Test ideas 35 (03:T35) | `extents/probe-wide-polyline`, `layouts/extents-wide-pline` | answered |
| Q-0116 | extents | [U] Do plot 'Extents' of TEXT use the actual glyph box or the full text cell (cap height/descender box)? | 03 §6.1, §6.2, Test ideas 35 (03:T35) | `extents/probe-text-xxx`, `extents/probe-text-hgy`, `layouts/extents-text-xxx`, `layouts/extents-text-hgy` | open |
| Q-0117 | extents | [U] Do plot 'Extents' of a SPLINE use the curve or its control-point hull? | 03 §6.1, §6.2, Test ideas 35 (03:T35) | `extents/probe-spline-control-hull`, `layouts/extents-spline-control` | answered |
| Q-0118 | extents | [U] Do plot 'Extents' of a pattern HATCH use the boundary only, or the pattern line geometry? | 03 §6.2, Test ideas 35 (03:T35) | `extents/probe-hatch-pattern`, `layouts/extents-hatch-pattern` | answered |
| Q-0119 | extents | [A] Do extents for a smoothed MESH use the level-0 control cage vertices or the subdivided surface? | 03 §6.1 | `misc/mesh-box-level0-extents`, `misc/mesh-box-level2-extents` | open |
| Q-0120 | extents | [U] Do layout extents (Extents plot / LAYOUT 14/15) include viewport frames and the overall viewport? | 08 §8 item 17 (08:T-PL-9) | `misc/layout-extents-viewports` | answered: viewport frames count, the overall viewport (id 1) does not; content seen through a viewport is clipped and never widens the extents (08 §10.16) |
| Q-0121 | extents | [T] What does PLOT 'Limits'/'Layout' do with bogus (0,0)-(12,9) paper limits that do not contain the viewports? | 11b §4, Test ideas (11b:19) | `layouts/bogus-limits-layout`, `layouts/bogus-limits-window` | answered |

- Q-0121: Plot area Layout ignores LAYOUT limits: the canvas at 1 px per paper unit from paper (0,0); Window plots are unaffected (`layouts/bogus-limits-*`, note 08 §10.12).
- Q-0107: No: invisible (60=1) entities are excluded from $EXTMIN/$EXTMAX and the Extents plot (`extents/probe-invisible-entity`, note 03 §6.2).
- Q-0108: No: a 3DFACE vertex touched only by invisible edges does not count (`extents/probe-invisible-3dface-edges`).
- Q-0109: Off layers count, frozen layers do not (`extents/probe-layer-off`, `probe-layer-frozen`).
- Q-0110: Yes: Defpoints entities (incl. a DIMENSION on Defpoints) are in the extents although they never plot (`extents/probe-layer-defpoints`, `probe-dimension-defpoint`).
- Q-0111: Yes: no-plot layers count (`extents/probe-layer-noplot`).
- Q-0112: Yes: the PDMODE symbol extent counts (`points/point-extents-0001`: $EXTMIN = -14.14 = × arm ends).
- Q-0113: Yes: the thickness top of an extruded LINE counts (`extents/probe-thickness`: $EXTMAX x = 60).
- Q-0114: No: lineweights do not enlarge the extents (`extents/probe-lineweight`).
- Q-0115: The full band counts (`extents/probe-wide-polyline`: y 20..40 for width 20 at y = 30).
- Q-0117: The curve, not the control hull (`extents/probe-spline-control-hull`).
- Q-0118: The boundary only, not the pattern lines (`extents/probe-hatch-pattern`).

<a id="ocs"></a>
## OCS / extrusion / thickness (`ocs`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0122 | ocs | [A] Does AutoCAD normalize a non-unit extrusion vector (e.g. 210=(0,0,5) or (0,0,-3)) before applying the arbitrary axis algorithm? | 03 §2.2 | `ocs/circle-unnormalised`, `ocs/lwpolyline-unnormalised`, `ocs/solid-unnormalised`, `ocs/text-unnormalised` (+8 more) | open |
| Q-0123 | ocs | [U] With extrusion (0,0,-1), does elevation 38 = 5 on an LWPOLYLINE place it at WCS z = -5 (AAA-mapped) or z = +5? | 03 §2.3, Test ideas 3 (03:T3) | plan: ocs (png) — LWPOLYLINE 38=5, 210=(0,0,-1) plus reference at z=+5/-5, in a paper-space viewport with a 3D (side) view | open |
| Q-0124 | ocs | [T] How does AutoCAD treat extrusion 210=(0,0,0) on ARC, CIRCLE, SPLINE, LWPOLYLINE, HATCH and INSERT: as +Z (like TEXT), refuse the file, or drop the entity? | 11a §6; 11b §6, Test ideas (11a:26, 11b:1) | `ocs/zero-extrusion-arc`, `ocs/zero-extrusion-circle`, `ocs/zero-extrusion-spline`, `ocs/zero-extrusion-lwpolyline` (+2 more) | answered |
| Q-0125 | ocs | [T] For 210=(0,0,-1) and arbitrary normals, are TEXT, MTEXT, INSERT, SOLID, 2D POLYLINE and HATCH placed via OCS as the spec says? | 11b §6, Test ideas (11b:1) | `ocs/circle-z`, `ocs/solid-z`, `ocs/text-z`, `ocs/circle-negz` (+43 more) | open |
| Q-0126 | ocs | [A] TEXT/MTEXT with extrusion (0,0,-1): how is the text mirrored in PLOT (TEXT x-flip via OCS, MTEXT y-scale sign)? | 04 §1.5 step 7 (04:T6) | `ocs/text-negz`, `ocs/mtext-negz` | open |
| Q-0127 | ocs | [T] Does an INSERT with extrusion (0,0,-1) and (0.3,0.4,0.866) plot per OCS*T(ins)*Rz(rot)*S*T(-base) in top view? | 07 §2.2 (07:1) | `blocks/mirror-rot30`, `blocks/extrusion-negz`, `blocks/extrusion-skew`, `blocks/extrusion-nested` (+4 more) | open |
| Q-0128 | ocs | [T] How are TEXT/ATTRIB/HATCH rendered inside INSERTs mirrored (sx=-1) at 1, 2 and 3 nesting levels with rotation 90°? | 11a §6, Test ideas (11a:27) | `ocs/mirror-nesting-1`, `ocs/mirror-nesting-2`, `ocs/mirror-nesting-3` | open |

- Q-0124: ARC, CIRCLE (and HATCH) with 210=(0,0,0) are kept but not drawn; LWPOLYLINE drops it on load, SPLINE and INSERT draw as +Z (`ocs/zero-extrusion-*`, note 03 §2.6).

<a id="lines-curves"></a>
## LINE / ARC / CIRCLE / XLINE / RAY (`lines-curves`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0129 | lines-curves | [A] Do header $ANGBASE/$ANGDIR change the PLOT of stored angles (ARC 50/51, TEXT 50, INSERT 50), or are they ignored? | 01 §7.2; 03 §2.5 | `lines-curves/angbase-*` | open |
| Q-0130 | lines-curves | [U] How are CIRCLE/ARC with radius 0 or negative handled on OPEN and in PLOT (dropped, dot, \|r\|), and what does an ARC with start == end angle plot? | 01 §8.1; 03 §3.4; 11a §7, Open conflicts (11a:33) | `lines-curves/circle-degenerate-*`, `lines-curves/degenerate-lw-*` | answered |
| Q-0131 | lines-curves | [U] How does PLOT normalise ARC angles: 0/360 and -180/180 as full circle, 350/10 as a 20 deg wrap, 51 > 360 (30/450, 0/720) modulo 360 or longer sweep? | 03 §3.5, §3.7, Test ideas 11; 11b §9 (03:T11) | `lines-curves/arc-angles-*`, `lines-curves/arc-normalise-*` | answered |
| Q-0132 | lines-curves | [U] Does PLOT draw a zero-length LINE as a dot (round/square cap sized by lineweight) or skip it, incl. at lw 0 and with a dashed linetype? | 03 §3.2; 11a Test ideas (11a:33) | `lines-curves/line-short-*`, `lines-curves/zero-line-lw000-cont`, `lines-curves/zero-line-lw000-dashed`, `lines-curves/zero-line-lw050-cont` (+5 more) | open |
| Q-0133 | lines-curves | [U] Does a CIRCLE/ARC with thickness in 2D wireframe plot only top+bottom curves (+ end connectors), or also silhouette/isolines? | 03 §2.6, Test ideas 6 (03:T6) | plan: lines-curves (png) — CIRCLE r=10 and ARC 0-90 with thickness 10, in a VPOINT 1,-1,1 paper-space viewport | open |
| Q-0134 | lines-curves | [U] Does a LINE with thickness 10 and extrusion (1,0,0), plotted in plan view, appear as a 4-edge band outline of width \|t\|? | 03 §2.6, Test ideas 5 (03:T5) | `lines-curves/line-thickness-*` | answered |
| Q-0135 | lines-curves | [U] What chord tolerance/segment count does PLOT use for CIRCLE/ARC: independent of VIEWRES/VPORT 72, scaled by PC3 vector resolution, facets at r~5000 px? | 08 §3.1 (72), §5.6; 11c §10 (octagon circles ASSUMPTION), §15 item 15; 03 §5.1, §5.3, Test ideas 36; 11b §4, §17 (03:T36) | `lines-curves/circle-radius-*`, `lines-curves/arc-radius-*` | open |
| Q-0136 | lines-curves | [T] Does PLOT render a very flat bulge (2 deg included angle, large radius) as a true arc rather than a straight chord? | 03 §3.9.1, Test ideas 37 (03:T37) | `polylines/flat-bulge` | open |

- Q-0134: Yes: base, top and two connecting edges (`lines-curves/line-thickness-*`, note 03 §2.6).
- Q-0130: Negative radius is repaired to 1 on load (DXFOUT 40 = 1), radius 0 is kept (`lines-curves/circle-degenerate-*`, `degenerate-lw-*`, `fileformat/corpus-ezdxf-circle-radius-le-0`).
- Q-0135: Independent of VIEWRES: CIRCLE/ARC whose circle lies on the canvas plot as n = 2·ceil(|sweep|/π·√Ri + ¼) segments of the integer circle (centre snapped to its pixel centre, radius ceil(r)−1); other arcs are tessellated by the graphics system with ceil(max(32, π√(1.016·r))·sweep/2π) exact segments (`calibration/probe-circles*`, `probe-arcs`, `polylines/bulge-*`, note 08 §10.13).
- Q-0131: Angles are kept as written; end − start ≥ 360 (0/360, −180/180, 30/450, 0/720) plots a full circle, 350/10 a 20° arc (`lines-curves/arc-normalise-*`).

<a id="polylines"></a>
## Polylines (`polylines`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0137 | polylines | [A] For a 2D POLYLINE, are VERTEX z values ignored in favour of the header elevation (30), and what if header 30 is missing? | 03 §2.3 | `ocs/polyline2d-elevation-*`, `polylines/polyline2d-vertex-z` | open |
| Q-0138 | polylines | [A] Does header $PLINEGEN affect PLOT of existing polylines, or only their own 70 bit 128 flag? | 01 §7.2 | `polylines/plinegen-bit0-hdr0`, `polylines/plinegen-bit0-hdr1`, `polylines/plinegen-bit1-hdr0`, `polylines/plinegen-bit1-hdr1` | open |
| Q-0139 | polylines | [A] Does PLOT of a spline-fit POLYLINE (70 bit 4) use the stored fit vertices regardless of $SPLINESEGS? | 01 §7.2 | `polylines/splinefit-splinesegs-p8`, `polylines/splinefit-splinesegs-p2`, `polylines/splinefit-splinesegs-m8` | open |
| Q-0140 | polylines | [C] For curve-fit (70 bit 2) and spline-fit (bit 4) POLYLINEs, does PLOT draw only fit vertices (flags 1/8), skipping frame vertices (16) unless $SPLFRAME=1? | 01 §7.2; 03 §0 item 7, §3.10.4, §4.2, Test ideas 28; 11a §7; 11b §8 (01:T26, 03:T28, 11a:31) | `polylines/curvefit-flag-only`, `polylines/splinefit-deg2-frame0`, `polylines/splinefit-deg2-frame1`, `polylines/splinefit-deg3-frame0` (+5 more) | open |
| Q-0141 | polylines | [A] For a spline-fit POLYLINE with no flag-8 vertices, does AutoCAD draw a uniform B-spline (degree by 75) over the frame vertices? | 03 §3.10.4 | `polylines/splinefit-flag-no-fitted`, `polylines/splinefit-closed-no-fitted` | open |
| Q-0142 | polylines | [A] Does PLOT of a smoothed polygon-mesh POLYLINE use its own 73/74 densities, ignoring $SURFU/$SURFV? | 01 §7.2 | `polylines/polymesh-smooth-surfu6`, `polylines/polymesh-smooth-surfu20` | open |
| Q-0143 | polylines | [U] For a PEDIT-smoothed polygon mesh (75=5/6/8), what vertex flags/order are stored, and is the 73x74 fitted grid what PLOT draws? | 03 §3.10.5, Test ideas 30 (03:T30) | plan: polylines (dxfout) — 4x3 mesh smoothed with PEDIT Smooth (SURFTYPE 6), SPLFRAME 0/1; DXFOUT the vertex list | open |
| Q-0144 | polylines | [T] Does a polygon mesh (flag 16) closed in M (1) and N (32) plot its closing grid lines? | 03 §3.10.5, Test ideas 30 (03:T30) | `polylines/polymesh-*` | open |
| Q-0145 | polylines | [A] Do polyface face records carrying their own layer/color (62) plot per face in that color? | 03 §3.10.3 | `polylines/polyface-face-colors` | answered |
| Q-0146 | polylines | [C] With per-vertex 40/41 set, does LWPOLYLINE 43 != 0 override them for all segments (spec: 43 unused), and with 43=0 are per-vertex widths used as-is? | 03 §0 item 6, §3.9, §4.1, Test ideas 21 (03:T21) | `polylines/width-vertex-plus-const-*` | open |
| Q-0147 | polylines | [A] How does AutoCAD plot a negative constant width (43=-1): as width 0, abs width, or refuse? | 11b §8, Test ideas (11b:12) | `polylines/width-negative-width`, `polylines/width-const-negative` | answered |
| Q-0148 | polylines | [A] In a polyline mixing zero-width and wide segments, do zero-width segments plot as normal lines with lineweight? | 03 §4.1 | `lineweights/widepline-lw`, `polylines/width-mixed-zero-lw` | open |
| Q-0149 | polylines | [U] Does AutoCAD open and plot a single-vertex LWPOLYLINE (90=1, open/closed) or a 2D POLYLINE with one VERTEX, and as what: nothing, a dot, or a width-sized blob? | 03 §3.9; 11b §8, Test ideas; 11c §9 (one-vertex polyline hung TrueView, netDxf#369 REPORTED) (11b:12) | `polylines/degenerate-single-vertex`, `polylines/single-vertex-*`, `polylines/single-vertex-polyline2d` | open |
| Q-0150 | polylines | [U] Does AutoCAD apply a miter limit for sharp joints in wide polylines (spike at 5 deg / 1 deg zig-zags) or always miter? | 03 §4.1, Test ideas 22 (03:T22) | `polylines/miter-angle-*` | answered |
| Q-0151 | polylines | [T] How does AutoCAD PLOT join wide LWPOLYLINE segments at duplicate vertices, collinear reversals and tapered 0->5 widths? | 11a §7 (11a:29) | `polylines/width-hairpin`, `polylines/width-zero-len-seg`, `polylines/joins-duplicate`, `polylines/joins-reversal` (+1 more) | answered |
| Q-0152 | polylines | [U] Does AutoCAD miter the joint between a straight and a non-tangent arc segment of a wide polyline, or leave a notch/overlap? | 03 §4.1, Test ideas 23 (03:T23) | `polylines/width-mixed-bulge`, `polylines/joins-line-arc` | answered |
| Q-0153 | polylines | [T] Is a tapered wide arc segment's width interpolated linearly along the arc with radial end cuts? | 03 §4.1, Test ideas 24 (03:T24) | `polylines/width-taper-arc`, `polylines/taper-arc-*` | answered |
| Q-0154 | polylines | [U] How does PLOT draw closed wide polylines (ring outer+inner?) and wide arc segments with w/2 >= r (inner radius 0/negative): solid disk or folded shape? | 03 §4.1, Test ideas 25; 11a §7; 11b §8, Test ideas (03:T25, 11a:29, 11b:12) | `polylines/width-closed-width`, `polylines/width-closed-taper`, `polylines/ring-semicircle-w6`, `polylines/ring-semicircle-taper` (+2 more) | answered |
| Q-0155 | polylines | [U] With FILLMODE 0, is a wide polyline drawn as each segment quad outline (with cross-lines at vertices) or only the overall outline? | 03 §4.1, Test ideas 26 (03:T26) | `polylines/fillmode-0`, `polylines/fillmode-1` | open |
| Q-0156 | polylines | [U] How does a wide LWPOLYLINE with thickness plot in a 3D view: slab outline only, filled faces, vertical edges per vertex? | 03 §2.6, §4.1, Test ideas 6 (03:T6) | plan: polylines (png) — LWPOLYLINE 3 vertices, 43=2, thickness 5, in a VPOINT 1,-1,1 viewport; also thickness only without width | open |
| Q-0157 | polylines | [A] Under non-uniform INSERT scale, do LWPOLYLINE bulges become elliptical segments and widths stretch anisotropically? | 07 §2.4 (07:2) | `blocks/nonuniform-*`, `blocks/nonuniform-bulge-width-*` | open |
| Q-0158 | polylines | [A] Does AutoCAD convert a plain 2D POLYLINE to LWPOLYLINE on open (DXFOUT), but keep curve-fit/spline-fit/XDATA ones as POLYLINE? | 11a §7 | `fileformat/r2000-polyline-conversion` | open |

- Q-0145: Yes: each face plots with its face record's colour (`polylines/polyface-face-colors`, note 03 §4.1).
- Q-0147: Negative 43 plots as width 0; negative per-vertex 40/41 plot with their absolute value (`polylines/width-const-negative`, `width-negative-width`).
- Q-0150: Yes: 30° joints are mitered, 7.2°/5°/1° are not (butt ends at the vertex); limit between 7.2° and 30° (`polylines/miter-angle-*`, `width-hairpin`, note 03 §4.1).
- Q-0151: Hairpins/sharp reversals are not mitered; width steps (end ≠ next start width) are never mitered; duplicate vertices are skipped (`polylines/width-hairpin`, `width-arrow`, `joins-duplicate`).
- Q-0152: No miter between straight and arc segments (`polylines/joins-line-arc`, `width-mixed-bulge`).
- Q-0153: Yes, linear in the angle with radial end cuts, after clamping both widths to the arc diameter (`polylines/taper-arc-*`, `ring-semicircle-taper`).
- Q-0154: Arc widths are clamped to 2r: w/2 ≥ r gives a solid sector out to radius 2r, no fold (`polylines/ring-semicircle-*`); closed wide polylines miter the closing joint (`width-closed-width`).

<a id="points"></a>
## POINT (`points`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0159 | points | [C] What exact PLOT geometry do PDMODE 0-4, +32, +64 use: circle diameter / square side = PDSIZE, and '+'/'x'/tick arm lengths relative to that frame? | 01 §7.2; 03 §3.1, Test ideas 7 (01:T24, 03:T7) | `points/pdmode-000-abs2`, `points/pdmode-001-abs2`, `points/pdmode-002-abs2`, `points/pdmode-003-abs2` (+56 more) | answered |
| Q-0160 | points | [U] For PDSIZE 0 (5%) and PDSIZE < 0 (percent), which reference height does PLOT use (viewport view height, plot area, display window), incl. from accoreconsole? | 01 §7.2; 03 §3.1, Test ideas 8; 08 §5.6, §8 item 16; 11a §3 (01:T24, 03:T8) | `points/pdmode-000-zero`, `points/pdmode-001-zero`, `points/pdmode-002-zero`, `points/pdmode-003-zero` (+58 more) | answered |
| Q-0161 | points | [U] Does POINT group 50 rotate the PDMODE symbol by +angle (CCW, following UCS x) or -angle as ezdxf does? | 03 §3.1, Test ideas 9 (03:T9) | `points/point-angle-*` | answered |
| Q-0162 | points | [A] Does a POINT with thickness plot as a line from P to P+t*N with the PDMODE symbol only at the base point? | 03 §2.6 | `points/point-thickness-*` | answered |
| Q-0163 | points | [U] Are PDMODE point glyphs inside a non-uniformly scaled/rotated block distorted, or drawn at undistorted PDSIZE? | 07 §2.4 | `blocks/points-pdmode-*`, `points/point-in-block-*` | answered |

- Q-0159: + arms ±S, × arms of length S on the diagonals, tick S/2, circle radius S/2, square half-side S/2, S = PDSIZE (`points/pdmode-*`, note 03 §3.1).
- Q-0160: Half the plot area height: S = 5 % (0) or |PDSIZE| % of view height / 2; the *Active VPORT height is ignored (`points/pdsize-*`).
- Q-0161: −angle (clockwise), like ezdxf (`points/point-angle-*`).
- Q-0162: Yes: a 1-px line P → P + t·N̂, symbol at the base (`points/point-thickness-0001`).
- Q-0163: Distorted: the symbol is transformed with the block; relative sizes are in block units (`points/point-in-block-*`, `blocks/points-pdmode-*`).

<a id="ellipses"></a>
## ELLIPSE (`ellipses`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0164 | ellipses | [U] Where is AutoCAD's ELLIPSE ratio upper bound: is 40=1.0 accepted, and are 1.0000001 / 1.5 refused, clamped or axis-swapped (params shifted by pi/2)? | 03 §3.7, Test ideas 13; 11c §9 (ratio > 1 refused), §18 #5 (03:T13) | `ellipses/ratio-*`, `ellipses/ratio-invalid-*` | open |
| Q-0165 | ellipses | [U] Does AutoCAD accept ELLIPSEs with negative ratio (-0.5) or tiny ratio (1e-10) and how are they drawn; does start param == end param plot a full ellipse or nothing? | 03 §3.7, Test ideas 12; 11a §7, Test ideas (03:T12, 11a:32) | `ellipses/ratio-*`, `ellipses/param-*`, `ellipses/ratio-invalid-*` | open |
| Q-0166 | ellipses | [A] Does AutoCAD draw an ELLIPSE with start 0 and end parameter 6.2831855 (> 2π) as a full ellipse rather than a tiny arc? | 11c §9 (normalise spans ≥ 2π, ASSUMPTION); 11c §17 LibreCAD#831 sample | `ellipses/param-2pi-*` | answered |
| Q-0167 | ellipses | [A] If ELLIPSE 210 is not perpendicular to the major axis 11, does AutoCAD re-orthogonalize (minor = N x M) or reject/repair it? | 03 §3.7 | `ellipses/extrusion-not-perpendicular` | open |

- Q-0181 (ellipses only): PNG and PDF ELLIPSEs are polylines of ceil(max(32, π√(a·f))·sweep/2π) uniform parameter steps from the start parameter at the exact points (a = semi-major axis in device units, f = 1.016 PNG / 1 PDF) (`calibration/probe-ellipses`, note 08 §10.13). SPLINE tessellation still open.
- Q-0166: Yes: a parameter span ≥ 2π (0…6.2831855, 0…7) plots the full ellipse (`ellipses/param-2pi-*`, `param-0008`).

<a id="splines"></a>
## SPLINE (`splines`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0168 | splines | [C] Which SPLINE 70 bit does AutoCAD write for 'CV frame shown' (512 per forum, 256 per libredwg mapping)? | 03 §3.8.2 | plan: splines (dxfout) — fit SPLINE saved with CVSHOW on vs off; DXFOUT and diff 70 | open |
| Q-0169 | splines | [U] Does AutoCAD ever write SPLINE 70 bit 2048 (closed periodic), and does it affect loading or drawing? | 03 §3.8.2 | `splines/flag-*` | open |
| Q-0170 | splines | [U] Does AutoCAD accept a SPLINE with no knots (or abort the whole file), and if so which knot vector does it assume? | 11b §9; 01 §3.2, §8.1 (11b:13) | `splines/no-knots` | open |
| Q-0171 | splines | [A] What curve does AutoCAD build for a fit-point-only SPLINE (no CPs/knots/tangents): chord-length knots with C''=0 ends, matching the SO#62472305/BricsCAD method? | 03 §3.8.6, Test ideas 14; 11a §7; 11b §9, Test ideas; 11c §9 (fit-point-only splines valid), §18 #5 (03:T14, 11a:30, 11b:13) | `splines/fit-only-deg2`, `splines/fit-only-deg3` | answered |
| Q-0172 | splines | [T] For a fit-only SPLINE with 12/13 tangents, are tangent magnitudes scaled by the total chord length of the fit polygon? | 03 §3.8.6, Test ideas 15 (03:T15) | `splines/fit-tangents-*` | answered |
| Q-0173 | splines | [U] For a fit-only SPLINE with only one end tangent (12 but no 13), does AutoCAD use it and apply C''=0 at the other end? | 03 §3.8.6 | `splines/fit-one-tangent-start`, `splines/fit-one-tangent-end` | answered |
| Q-0174 | splines | [A] Does AutoCAD refuse a SPLINE with zero-vector start/end tangents (12/13 = 0,0,0) written with fit points? | 11c §9 (zero tangents REPORTED via ezdxf#252); 11c §13 LibreDWG row; 11c §17 Ceco.NET sample; 11c §18 #5 | `fileformat/spline-fit-zero-tangents`, `fileformat/spline-fit-no-tangents`, `splines/fit-zero-tangents` | answered |
| Q-0175 | splines | [U] Given only fit points plus flag 64 (sqrt-chord) or 128 (uniform), does AutoCAD honour that knot parameterization? | 03 §3.8.6, Test ideas 15 (03:T15) | `splines/fit-param-64`, `splines/fit-param-64-tangents`, `splines/fit-param-128`, `splines/fit-param-128-tangents` | answered |
| Q-0176 | splines | [U] How does AutoCAD construct a closed (flag 1\|2\|1024) fit-points-only SPLINE: periodic C2 cubic interpolation? | 03 §3.8.6, Test ideas 16 (03:T16) | `splines/fit-closed`, `splines/fit-closed-periodic` | open |
| Q-0177 | splines | [U] How does AutoCAD build a fit-points-only SPLINE with fit tolerance 44 > 0 (approximation algorithm)? | 03 §3.8.6, Test ideas 19 (03:T19) | `splines/fit-tolerance`, `splines/fit-tolerance-1p0`, `splines/fit-tolerance-0p1` | open |
| Q-0178 | splines | [T] Are periodic-flag SPLINEs (70=11) evaluated as standard NURBS from the given knots over [U[p],U[m-p]], for AutoCAD-written periodic and clamped knot vectors? | 03 §3.8.4, Test ideas 17; 11b §9, Test ideas (03:T17, 11b:13) | `splines/periodic-deg2`, `splines/periodic-deg3`, `splines/periodic-deg4` | open |
| Q-0179 | splines | [A] Does PLOT evaluate SPLINE knots as given: nearly-equal clamped end knots (no phantom segment), repeated/doubled interior knots, un-normalised ranges (0..5000)? | 11a §7; 11b §9, Test ideas (11a:30, 11b:13) | `splines/knots-nonuniform`, `splines/knots-kink`, `splines/knots-offset-range`, `splines/knots-scaled-range` (+2 more) | open |
| Q-0180 | splines | [U] Does PLOT draw rational degree-2 SPLINEs exactly: quarter circle (weights 1, sqrt2/2, 1) pixel-identical to an ARC, full circle and squircle per NURBS math? | 03 §3.8.8, Test ideas 18; 11b §9, Test ideas (03:T18, 11b:13) | `splines/rational-circle`, `splines/rational-quarter-circle` | open |
| Q-0181 | splines | [U] How does PLOT tessellate SPLINEs/ELLIPSEs: PDF Beziers or polylines, chord tolerance fixed or VIEWRES/vector-resolution based, facets visible at large scale? | 03 §5.1, §3.8.8; 11a §7, Open conflicts (11a:30) | `ellipses/size-*`, `splines/size-*`, `splines/many-control-points` | open |
| Q-0182 | splines | [T] Does a HELIX plot exactly as its embedded AcDbSpline data, ignoring the helix parameters (radius/turns/height)? | 03 §3.13, Test ideas 20 (03:T20) | `splines/helix` | open |

- Q-0171: Yes: cubic, chord-length knots (unnormalized, cumulative chords), C=0 ends; AutoCAD recomputes it on load (DXFOUT control points match truedxf to 1e-12) (`splines/fit-only-deg3`, note 03 §3.8).
- Q-0172: No: the stored 12/13 vector is used unnormalized, P1−P0 = (U[p+1]/p)·T·L (`splines/fit-tangents-0003`, `fit-param-*-tangents`).
- Q-0173: Yes: the given tangent is used at its end and C=0 at the other (`splines/fit-one-tangent-*`).
- Q-0174: No: zero tangents are ignored (natural ends) (`splines/fit-zero-tangents`).
- Q-0175: No: bits 64/128 are ignored; chord-length knots are always used and 70 is rewritten as 1064 (`splines/fit-param-*`).

<a id="solids"></a>
## SOLID / TRACE / 3DFACE (`solids`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0183 | solids | [A] Does PLOT honour the file's $FILLMODE=0 by drawing SOLID, TRACE, wide polylines and solid-fill HATCH as outlines only? | 01 §7.2; 03 §3.12, §4.1, Test ideas 26 (01:T23, 03:T26) | `polylines/fillmode-0`, `polylines/fillmode-1`, `solids/solid-zorder-fill0`, `solids/solid-polygon-order-fill0` (+6 more) | answered |
| Q-0184 | solids | [U] How does PLOT fill a self-intersecting (bow-tie) SOLID stored 0-1-2-3: union of both triangles or even-odd? | 03 §3.12, Test ideas 31 (03:T31) | `solids/solid-polygon-order-fill1`, `solids/solid-polygon-order-fill0` | answered |
| Q-0185 | solids | [U] Is the top face of a SOLID/TRACE with thickness filled in a 2D wireframe plot of a 3D view, or only the prism edges drawn? | 03 §2.6, Test ideas 6 (03:T6) | `solids/solid-thickness-tilted` | answered |
| Q-0186 | solids | [U] What does a 2D-wireframe plan-view PLOT draw for REGION and 3DSOLID (ACIS edges only, fill, nothing; proxy needed?) for SAT (R2010) and SAB (R2013) DXF? | 03 §3.15, Test ideas 38; 11a §7; 11b §15 (03:T38) | `misc/solid-box-plan-r2000`, `misc/solid-box-plan-r2010`, `misc/solid-box-plan-r2013`, `misc/solid-box-plan-r2018` (+6 more) | answered |
| Q-0187 | solids | [U] Where does AutoCAD place ISOLINES on curved 3DSOLID faces and SURFACE U/V isolines in 2D wireframe PLOT? | 03 §3.15 | plan: misc (png) — 3DSOLID cylinder, sphere, cone with ISOLINES 4 and 8; SURFACE with 71/72 = 3/5 | open |
| Q-0188 | solids | [A] Does AutoCAD reject an R2004 3DSOLID that carries the AcDb3dSolid subclass marker? | 11a §7 | `fileformat/r2004-3dsolid-with-marker`, `fileformat/r2004-3dsolid-without-marker`, `fileformat/r2018-3dsolid-no-subclass` | open |

- Q-0183: Yes: SOLID/TRACE/wide polylines as outlines, and a solid HATCH is not drawn at all (`solids/fillmode-mixed-0`, `polylines/fillmode-0`).
- Q-0184: The v0,v1,v3,v2 polygon is filled as a bow tie (two triangles meeting at the crossing) (`solids/solid-polygon-order-fill1`).
- Q-0185: Only the prism edges; no fill (`solids/solid-thickness-tilted`). Tilted SOLIDs without thickness plot as outlines too (`ocs/solid-*`).
- Q-0186: All ACIS edges (a box: 12 edges incl. hidden), no fill, for SAT and SAB alike (`misc/solid-box-*`, `region-square-*`, `body-box-plan`).

<a id="meshes-3d"></a>
## Meshes, 3D and ACIS (`meshes-3d`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0189 | meshes-3d | [A] Are invisible 3DFACE edges (70 bits 1/2/4/8) and negative-index polyface edges hidden in PLOT and drawn with $SPLFRAME=1; is polyface index 0 an unused 4th vertex? | 01 §7.2, §10 item 8; 03 §3.10.3, Test ideas 29, §3.11, Test ideas 33; 11a §7; 11b §8 (01:T26, 03:T29, 03:T33) | `polylines/polyface-*`, `polylines/polyface-invisible-splframe`, `solids/3dface-invisible-00`, `solids/3dface-invisible-01` (+15 more) | answered |
| Q-0190 | meshes-3d | [A] Is MESH (AcDbSubDMesh) smoothing Catmull-Clark, i.e. does the plotted level-1/2 surface match CC subdivision of the cage? | 03 §3.14, Test ideas 39 (03:T39) | `misc/mesh-box-level0-plan`, `misc/mesh-box-level0-iso`, `misc/mesh-box-level1-plan`, `misc/mesh-box-level1-iso` (+5 more) | answered |
| Q-0191 | meshes-3d | [U] For a smoothed MESH (level > 0) in 2D wireframe PLOT, are all subdivided facet edges drawn or only smooth isolines? | 03 §3.14, Test ideas 39 (03:T39) | `misc/mesh-box-level0-plan`, `misc/mesh-box-level0-iso`, `misc/mesh-box-level1-plan`, `misc/mesh-box-level1-iso` (+4 more) | answered |
| Q-0192 | meshes-3d | [U] In MESH creases, does -1 mean 'always sharp', and does a crease >= subdivision level prevent smoothing that edge? | 03 §3.14, Test ideas 39 (03:T39) | `misc/mesh-crease-m1`, `misc/mesh-crease-0`, `misc/mesh-crease-1`, `misc/mesh-crease-2` (+2 more) | open |

- Q-0189: Invisible 3DFACE edges and negative polyface indices are hidden, shown with $SPLFRAME=1; polyface index 0 = unused corner (`solids/3dface-nonplanar`, `polylines/polyface-invisible-splframe`).
- Q-0190: Yes: Catmull-Clark of the cage (`misc/mesh-box-level1-plan` pixel-exact, levels 2/3 within a few px).
- Q-0191: Only the level-0 cage edges, following the smoothed surface; no facet edges (`misc/mesh-box-*`).

<a id="colors"></a>
## Colours (`colors`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0193 | colors | [C] What RGB does PLOT produce for each ACI 1-255 (object-colour pen) with no plot style, acad.ctb and monochrome.ctb, in PNG and PDF (e.g. ACI 99, 154)? | 06 §0 item 7, §3.3, §6.6, §9 item 4, App. A; 11a §15, Open conflicts; 11b §5, Test ideas; 11c §10 (ACI → RGB not one table), §15 item 7, §16 ACI 99, §18 #14 (06:C1, 11a:40, 11b:3) | `colors/aci-grid-full`, `colors/aci-grid-full-mono`, `colors/aci-block-*`, `colors/fill-types-aci` (+2 more) | open |
| Q-0194 | colors | [U] Are grays ACI 8, 9, 250-255 adjusted for the white paper background in plots (e.g. 250 -> 0,0,0)? | 06 §3.3, §9 item 4 (06:C2) | `colors/aci-block-*`, `colors/greys-white-paper` | open |
| Q-0195 | colors | [A] Does ACI 7 (direct, BYLAYER on a colour-7 layer, BYBLOCK in a colour-7 block; lines and solid hatch) plot black on white paper with none/acad/monochrome CTB? | 06 §0 item 8, §3.4; 11b §5, Test ideas (06:C2, 11b:3) | `colors/aci7-direct`, `colors/aci7-bylayer`, `colors/aci7-byblock`, `colors/aci7-variants-mono` (+1 more) | open |
| Q-0196 | colors | [U] Do ACI 255 and true colour 255,255,255 plot white (invisible on white paper) under no CTB / acad.ctb, while ACI 7 plots black? | 06 §3.4, §9 item 5; 08 §5.5, §8 item 15 (06:C2, 08:T-PL-5) | `colors/greys-white-paper`, `colors/white-black-swatches`, `colors/layer-truecolor-white` | open |
| Q-0197 | colors | [C] Do ACI 250-255 (and dark shades like 110) plot differently in paperspace than in modelspace? | 11a §15, Open conflicts (11a:40) | `colors/palette-modelspace`, `colors/palette-paperspace` | open |
| Q-0198 | colors | [U] Does a top-level (model space) entity with colour BYBLOCK (62=0) plot as ACI 7 black, and is it invisible when its linetype is also BYBLOCK? | 11a §13; 11b §5, Test ideas (11a:37, 11b:3) | `colors/byblock-toplevel`, `colors/byblock-toplevel-linetype-byblock` | answered |
| Q-0199 | colors | [A] How does AutoCAD treat a negative ACI 62 on an entity (not a LAYER), e.g. -1/-5: draw abs(colour), hide it, or reject/repair on load/DXFOUT? | 03 §1; 06 §3.1 | `colors/negative-entity-color` | open |
| Q-0200 | colors | [T] Does 420 true color override a contradicting 62 ACI in the plot? | 06 §3.2 (06:C3) | `colors/truecolor-over-aci`, `colors/layer-truecolor` | open |
| Q-0201 | colors | [T] Does AutoCAD use the ACI when 62=n is followed by 420=0, and plot a lone 420=0 as black? | 11b §5, Test ideas (11b:3) | `colors/truecolor-zero` | open |
| Q-0202 | colors | [A] Is 430 color-book name written as BOOK$COLOR and always accompanied by 420 in AutoCAD DXF output? | 06 §3.2 (06:C3) | `colors/colorbook-with-rgb`, `colors/colorbook-name-only` | open |

- Q-0198: ACI 7 (black on white) and Continuous; not invisible (`colors/byblock-toplevel*`).

<a id="lineweights"></a>
## Lineweights (`lineweights`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0203 | lineweights | [A] Does PLOT ignore $LWDISPLAY and apply lineweights purely from the 'plot object lineweights' page-setup flag (70 bit 128)? | 01 §7.2; 06 §5.1; 11b §12, Test ideas; 11c §15 item 14 (LWDISPLAY screen only, ASSUMPTION) (11b:11) | `lineweights/lwdisplay-0`, `lineweights/lwdisplay-1`, `lineweights/plot-lineweights-off` | open |
| Q-0204 | lineweights | [U] How does raster PLOT round each of the 24 standard lineweights to device px (mm*DPI/25.4: round, ceil, floor+1, max(1,round)) at 72-600 dpi? | 06 §5.2, §9 item 7; 08 §5.4, §8 item 4 (06:W1, 08:T-PL-3) | `lineweights/lw-000`, `lineweights/lw-005`, `lineweights/lw-009`, `lineweights/lw-013` (+23 more) | open |
| Q-0205 | lineweights | [A] Does lineweight 0 (hairline) and 0.05-0.20 mm plot exactly 1 device px wide at every slope on PNG, and what minimum width in PDF? | 06 §0 item 10, §5.2, §9 item 7; 08 §5.4, §7 item 5, §8 item 4 (06:W1, 08:T-PL-3) | `lineweights/lw-000`, `lineweights/lw-005`, `lineweights/lw-009`, `lineweights/lw-013` (+8 more) | open |
| Q-0206 | lineweights | [A] Does lineweight Default (-3) plot at LWDEFAULT, and how do ByLayer/ByBlock lw, 'plot lineweights' off and 'scale lineweights' on change plotted widths? | 08 §1.5 (LWDEFAULT), §5.4, §7 item 8; 11a §15 (08:T-PL-3, 11a:41) | `lineweights/bylayer`, `lineweights/default-lwdefault-025`, `lineweights/default-lwdefault-100`, `lineweights/byblock-toplevel` (+4 more) | answered |
| Q-0207 | lineweights | [U] How does AutoCAD handle non-standard 370 values (17, 22, 23, 212, 300) on entities/layers: repair on load/AUDIT, and which width do they plot? | 06 §5.1; 11c §10 (valid lineweight values, REPORTED by mozman), §17 lineweights.dxf sample (06:W4) | `lineweights/invalid-entity-values`, `lineweights/invalid-layer-17` | open |
| Q-0208 | lineweights | [U] With object end/join style (no CTB, acad.ctb, monochrome.ctb), which caps/joins does PLOT draw for thick lines, and do $ENDCAPS/$JOINSTYLE 0..3 change them? | 01 §7.2; 06 §5.2, §9 item 7; 08 §5.4, §8 item 4, §1.5; 11a §12, Open conflicts (06:W2, 08:T-PL-4, 11a:25) | `lineweights/caps-e0-j0`, `lineweights/caps-e1-j0`, `lineweights/caps-e2-j0`, `lineweights/caps-e3-j0` (+7 more) | open |
| Q-0209 | lineweights | [A] Does a filled SOLID also get a lineweight-wide outline stroke in PLOT, so it grows by lw/2 on each side? | 03 §3.12, Test ideas 32 (03:T32) | `lineweights/solid-lw` | open |
| Q-0210 | lineweights | [U] Is the band outline of a wide polyline additionally stroked with the entity lineweight in PLOT? | 03 §4.1, Test ideas 27 (03:T27) | `lineweights/widepline-lw` | open |
| Q-0211 | lineweights | [A] Is each linetype dash a separately capped stroke (0.5 mm dash at 0.5 mm lw looks 1.0 mm long)? | 06 §5.2, §9 item 7 (06:W3) | `lineweights/dashed-lw-050`, `lineweights/dashed-lw-211` | open |
| Q-0212 | lineweights | [U] Are POINTs plotted with their lineweight: PDMODE 0 as a round lw-sized dot (what size at lw 0?) and PDMODE shapes stroked at lw? | 06 §5.2; 03 §3.1, Test ideas 10 (03:T10) | `points/dot-lineweight-*`, `points/symbol-lineweight-*` | answered |
| Q-0213 | lineweights | [A] Is plotted lineweight of block content independent of INSERT scale (0.5 mm line inside INSERTs scaled 1, 5, (5,1), 1000)? | 07 §2.4; 11b §7, Test ideas (11b:11) | `blocks/lineweight-insert-scale`, `lineweights/insert-scale` | open |

- Q-0206: Yes: DEFAULT (and BYLAYER on a DEFAULT layer) plot at the session LWDEFAULT (`lineweights/default-lwdefault-*`); INSERT scale never scales lineweights.
- Q-0212: No: POINT dots and PDMODE symbols are always 1 px (`points/dot-lineweight-*`, `symbol-lineweight-*`).

<a id="transparency"></a>
## Transparency (`transparency`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0214 | transparency | [U] Does AutoCAD honour entity transparency (440) in an AC1018 file? | 01 §4.2, §10 item 12 | `transparency/ac1018` | answered |
| Q-0215 | transparency | [A] Is transparency percent t stored as alpha = trunc((1-t/100)*255) for all t (0..90), in layer XDATA and entity 440? | 02 §2.1.2 | plan: transparency (dxfout) — LISP set layer/entity transparency to 0,1,10,25,33,50,70,90; DXFOUT and read 1071/440 | open |
| Q-0216 | transparency | [A] Is transparency plotted only when page-setup 'plot transparency' is on, and does PLOTTRANSPARENCYOVERRIDE 0/1/2 (never/page setup/always; default 1) override it? | 02 §2.1.2; 06 §4.2 (02:T1) | `transparency/entity-050-plot-off`, `transparency/layer-070` | answered |
| Q-0217 | transparency | [A] Does transparency resolve as 440=0 or absent -> BYLAYER (layer AcCmTransparency XDATA) and 440=0x01000000 -> BYBLOCK from the INSERT's transparency? | 06 §4.1, §7.1 (06:T1) | `transparency/entity-000`, `transparency/entity-025`, `transparency/entity-050`, `transparency/entity-075` (+10 more) | answered |
| Q-0218 | transparency | [U] How are transparent objects composited in raster PLOT: plain alpha over earlier content/paper (exact RGB of 50% red over blue) for 0/25/50/90%? | 06 §4.2, §9 item 8; 08 §5.5; 11a §15 (06:T1, 08:T-PL-6, 11a:40) | `transparency/entity-000`, `transparency/entity-025`, `transparency/entity-050`, `transparency/entity-075` (+7 more) | answered |
| Q-0219 | transparency | [U] Does hatch transparency (440) also apply to the HATCHBACKGROUNDCOLOR fill when transparency is plotted? | 06 §1.10 | `transparency/hatch-background` | answered |
| Q-0220 | transparency | [U] Does plotting transparent objects rasterize them separately (e.g. raster region in PDF / different AA in PNG)? | 06 §4.2 (06:T1) | `transparency/entity-000`, `transparency/entity-025`, `transparency/entity-050`, `transparency/entity-075` (+1 more) | answered |

- Q-0214: Yes: an AC1018 file plots 440 transparency like AC1032 (`transparency/ac1018`).
- Q-0216: PLOTTRANSPARENCYOVERRIDE 0 = never (even with LAYOUT XDATA PLOTTRANSPARENCY=1), 1 = page setup XDATA, 2 = always (`transparency/entity-050-plot-off`, `layouts/pagesetup-plottransparency`, note 06 §4.3).
- Q-0217: Yes: 440 absent or 0 -> layer AcCmTransparency, 0x01000000 -> the INSERT's, top-level BYBLOCK opaque (`transparency/bylayer-*`, `byblock-*`, `layer-070`).
- Q-0218: Sequential 8-bit blend `out = (src*a + dst*(256-a)) >> 8` per primitive, a = 440 & 0xFF; strokes blend per segment (`transparency/entity-0*`, `overlap-same-color`, `wide-lines`, note 06 §4.3).
- Q-0219: Yes: the background colour fill of a pattern hatch is blended with the hatch transparency (`transparency/hatch-background`).
- Q-0220: PNG: no separate rasterization visible; exact per-pixel blending without AA or dithering (PDF not examined) (`transparency/*`).

<a id="plotstyles"></a>
## Plot styles (CTB/STB) (`plotstyles`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0221 | plotstyles | [A] Is plotting with acad.ctb pixel-identical to 'plot with plot styles = No' for ACI, true colours, lineweights and linetypes? | 06 §6.3, §6.6; 08 §5.5 (08:T-PL-5) | plan: calibration (png) — ACI 1-255 swatches + true colours + lineweight/linetype sheet plotted with acad.ctb vs PLOTSETTINGS flag 32 off | open |
| Q-0222 | plotstyles | [U] In CTB mode, which pen applies to a 420 true-colour entity/layer (nearest-ACI 62 written in file?) for colour, lineweight and linetype overrides? | 02 §2.1.2; 06 §3.2, §6.4, §9 item 6 (02:T1, 06:P2) | plan: plotstyles (png) — CTB pen 1 = blue, 1.0 mm; pen 3 other; LINE/layer 62=1 + 420 green vs 62=7 + same 420 | open |
| Q-0223 | plotstyles | [A] Does a CTB colour override (monochrome.ctb -> black, custom 7->red) apply to ACI 7 and 420 true-colour objects, and what does 'use object color' keep? | 06 §6.3; 11a §15 (11a:40) | `colors/aci-grid-full-mono`, `colors/aci7-variants-mono`, `colors/mono-aci-truecolor` | open |
| Q-0224 | plotstyles | [U] Do gradient hatch colors pass through CTB pen color/screening/grayscale when plotting? | 06 §1.7 | `colors/gradient-mono` | open |
| Q-0225 | plotstyles | [U] What grayscale conversion does CTB color_policy grayscale use (0.30R+0.59G+0.11B?) | 06 §6.3 | plan: plotstyles (png) — ACI 1-255 swatch grid plotted with Grayscale.ctb | open |
| Q-0226 | plotstyles | [A] What colour does CTB screening s% produce (c' = 255-(255-c)*s/100, a linear blend toward white?) for ACI 1-7 at screening 100/75/50/25/0? | 06 §6.3 | plan: plotstyles (png) — ACI 1-7 filled SOLIDs plotted with CTBs screening 100/75/50/25/0; PNG and PDF | open |
| Q-0227 | plotstyles | [T] Do CTB end-style (butt/square/round/diamond) and join-style (miter/bevel/round/diamond) overrides change the plotted outline of a 2.11 mm polyline as expected? | 06 §5.2; 08 §5.4 (06:W2, 08:T-PL-4) | plan: plotstyles (png) — 2.11 mm LINE + LWPOLYLINE with 30/90 deg corners; custom CTBs with explicit end style 0..3 and join style 0..3 | open |
| Q-0228 | plotstyles | [U] What are the definitions of CTB built-in linetypes 0..30 and how does 'adaptive' fitting with linepattern_size work? | 06 §2.5, §6.5 | plan: plotstyles (png) — CTB pen with linetype 1..30, adaptive TRUE/FALSE, on LINEs of varied length | open |
| Q-0229 | plotstyles | [A] In STB mode, do 380 values 0/1/2/3 map to BYLAYER / BYBLOCK / dictionary default / 390 object? | 06 §6.2, §7.1 | plan: plotstyles (png) — Named-plot-style drawing, entities with 380=0..3 and styles differing in color | open |
| Q-0230 | plotstyles | [C] Is the CTB 'use object lineweight' value stored as 0 or 255 in acad.ctb pen entries? | 06 §6.3, §9 item 6 (06:P1) | plan: none (none) — Decompress a real acad.ctb and monochrome.ctb from the install with our reader | open |
| Q-0231 | plotstyles | [A] Does an STB file header read 'PIAFILEVERSION_2.0,STBVER1,compress'? | 06 §6.3 (06:P1) | plan: none (none) — Inspect the first 48 bytes of a real acad.stb from an AutoCAD install | open |

<a id="plotting"></a>
## Plotting / harness calibration (`plotting`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0232 | plotting | [A] Does PublishToWeb PNG plot at a fixed 100 DPI, i.e. lineweight mm -> px = mm*100/25.4, independent of the custom pixel paper size? | 08 §0 item 4, §2.1 (44/45), §5.3, §5.4 (08:T-PL-3) | plan: calibration (png) — Horizontal+30deg LINEs at each standard lineweight 0..2.11mm on 2000x1500, 1000x1000 and 4000x3000 canvases | open |
| Q-0233 | plotting | [A] Is the default background of PublishToWeb PNG white? | 08 §5.3 | plan: calibration (png) — Empty drawing plotted with stock PublishToWeb PNG.pc3; inspect pixel values | open |
| Q-0234 | plotting | [U] What PNG colour type/bit depth does PublishToWeb PNG write by default (palette PLTE vs 24-bit), and does it quantize true colours? | 08 §5.3, §8 item 2 (08:T-PL-5) | `colors/truecolor-ramps` | open |
| Q-0235 | plotting | [U] Does PublishToWeb PNG PLOT output anti-alias anything (lw-0 and thick lines, fills, TTF text, SHX text), i.e. any intermediate edge pixel values? | 03 §5.3; 06 §6.6; 08 §5.3, §8 item 2 (08:T-PL-2) | plan: calibration (png) — Lw-0 and thick diagonal LINEs at many slopes/sub-px offsets, rotated SOLID, TTF and SHX TEXT; monochrome.ctb; inspect edge pixels | open |
| Q-0236 | plotting | [U] Which rasterization rule does PLOT use for thin lines and tiny circles (Bresenham vs pixel-center coverage)? | 08 §5.3, §8 item 3 (08:T-PL-2) | plan: calibration (png) — Lw-0 lines at many slopes/sub-pixel offsets; circles r = 0.3..3 px | open |
| Q-0237 | plotting | [U] What fill rule decides pixels of a solid-filled shape with sub-pixel vertices (pixel-center inclusion, top-left rule)? | 08 §9 T-PL-2 (08:T-PL-2) | plan: calibration (png) — SOLID triangle with sub-pixel vertices, several offsets | open |
| Q-0238 | plotting | [U] Where red and blue 1 mm lines cross, what colour does AutoCAD plot with merge control 'lines overwrite' vs 'lines merge' (PNG and PDF)? | n/a | plan: calibration (png) — Red and blue 1 mm LINEs crossing (and a later blue over red SOLID); plot with merge control overwrite, then merge | open |
| Q-0239 | plotting | [U] What pixel-center convention and y-flip origin does PLOT use (does window top y map to row 0 center or edge)? | 08 §8 item 3 (08:T-PL-1) | plan: calibration (png) — Lw-0 lines at x/y = 0, 0.05, 0.1..., single POINTs (PDMODE 0) at known coords on 2000x1500 | open |
| Q-0240 | plotting | [U] Is geometry lying exactly on the plot window border drawn in the PNG (first/last row and column)? | 08 §8 item 3 (08:T-PL-1) | plan: calibration (png) — Closed rectangle exactly on window 0,0-200,150 with lw 0 | open |
| Q-0241 | plotting | [U] Does Fit on a raster device use the full custom pixel size or a printable area inset (e.g. 1 px smaller)? | 08 §5.2, §7 item 3, §8 item 3 (08:T-PL-1) | plan: calibration (png) — Window 0,0-200,150 on 2000x1500; closed rectangle on window border and one inset by 0.1 unit | open |
| Q-0242 | plotting | [U] Is PLOTOFFSET=0 offset relative to the printable-area lower-left and PLOTOFFSET=1 to the paper edge (not the paper centre)? | 08 §5.2 | plan: calibration (png) — Custom size with nonzero margins; offset 10,10 with PLOTOFFSET 0 and 1; marker at window LL | open |
| Q-0243 | plotting | [A] Does Landscape on a 1600x1280 (and 2000x1500) raster size produce a PNG as wide as the long side? | 08 §5.2 (08:T-PL-7) | plan: calibration (png) — Same window plotted Landscape/Portrait on 2000x1500 and 1500x2000 custom sizes; check PNG dims | open |
| Q-0244 | plotting | [U] In which direction does PLOT rotate content for Portrait on a landscape pixel size, and for upside-down? | 08 §5.2, §2.1 (73) (08:T-PL-7) | plan: calibration (png) — Asymmetric marker (arrow + 'N') plotted Portrait/Landscape x upside-down Y/N | open |
| Q-0245 | plotting | [T] Is PLOT output at coordinates 3e6-4e7 (model space and block at 0,0) pixel-identical to the same drawing at the origin? | 11b §16, Test ideas (11b:18) | plan: calibration (png) — 0.2 TEXT, 1 mm circle, dashed line, patterned hatch at (3026284,4643826), 4.06e7, -2.9e7 | open |
| Q-0246 | plotting | [A] Does PLOT hide 60=1 entities at top level and inside *U blocks, and does an invisible INSERT (60=1) hide all its children incl. ATTRIBs? | 11b §5, Test ideas; 11a §13 (11b:4, 11a:36) | `blocks/vis-invisible-flag`, `misc/invisible-top-level`, `misc/invisible-in-anonymous-block`, `misc/invisible-insert-with-attribs` | answered |
| Q-0247 | plotting | [A] Are LIGHT and CAMERA glyphs excluded from PLOT output? | 07 §14 | `misc/light-point-glyph-0`, `misc/light-point-glyph-1`, `misc/light-spot` | answered |
| Q-0248 | plotting | [U] Does a SECTION (SECTIONOBJECT) entity's section line/indicator plot? | 07 §14, §17 | plan: misc (png) — SECTIONOBJECT with 2-vertex section line | open |
| Q-0249 | plotting | [U] Is a GEODATA geomarker displayed or plotted? | 07 §14 | `misc/geodata-short`, `misc/geodata-long-cs` | open |
| Q-0250 | plotting | [A] Is the canonical media name (PLOTSETTINGS 4) of a raster custom size spelled 'Name_(W_x_H_Pixels)' after DXFOUT? | 08 §2.1 (code 4) (08:T-PL-8) | `layouts/pagesetup-truedxf-png` | open |
| Q-0251 | plotting | [A] Do PLOTSETTINGS 44/45 of a raster page setup store px*25.4/100 mm (e.g. 640 px -> 162.56 mm)? | 08 §2.1 (44/45), §6.7, §8 item 5 (08:T-PL-8) | `layouts/pagesetup-truedxf-png` | open |
| Q-0252 | plotting | [A] Does AutoCAD set PLOTSETTINGS 72 (plot paper units) to 2 (pixels) for a raster PC3 page setup? | 08 §2.1 (72), §6.7 (08:T-PL-8) | `layouts/pagesetup-truedxf-png` | open |
| Q-0253 | plotting | [U] Which -PLOT orientation/upside-down answers map to PLOTSETTINGS 73 = 1 (90 CCW) vs 3 (90 CW) vs 2? | 08 §2.1 (73) (08:T-PL-7) | `layouts/area-layout-rotation-1`, `layouts/area-layout-rotation-2`, `layouts/area-layout-rotation-3`, `layouts/pagesetup-rotation-0` (+3 more) | open |
| Q-0254 | plotting | [C] Does AutoCAD read PLOTSETTINGS 48/49 as window lower-left and 140/141 as upper-right, contrary to the DXF reference? | 08 §0 item 2, §2.1 (48/49, 140/141) (08:T-PL-8) | `layouts/pagesetup-plottype-0`, `layouts/pagesetup-plottype-1`, `layouts/pagesetup-plottype-2`, `layouts/pagesetup-plottype-3` (+2 more) | open |
| Q-0255 | plotting | [C] What does PLOTSETTINGS 147 hold: the standard scale value (spec) or a unit factor 1.0/mm, 1/25.4/inch (ezdxf)? | 08 §2.1 (147), §6.7, §8 item 5 (08:T-PL-8) | `layouts/pagesetup-scale-mm-std-1-1`, `layouts/pagesetup-scale-mm-std-1-50`, `layouts/pagesetup-scale-inch-std-1-1`, `layouts/pagesetup-scale-inch-std-1-50` (+1 more) | open |
| Q-0256 | plotting | [U] What do PLOTSETTINGS 148/149 (paper image origin) contain after AutoCAD saves a page setup? | 08 §2.1 (148/149) (08:T-PL-8) | `layouts/pagesetup-image-origin` | open |
| Q-0257 | plotting | [A] Are the printable-area margins of raster paper sizes 0 (LAYOUT 40-43 = 0 after DXFOUT)? | 08 §5.3 (08:T-PL-8) | plan: calibration (dxfout) — -PLOT built-in and custom PNG sizes with Save=Y, DXFOUT; read 40-43 | open |
| Q-0258 | plotting | [T] What values do 70/74/75/142/143 and XDATA PLOTTRANSPARENCY get after -PLOT Window/Fit/Center with Save changes=Y? | 08 §2.1, §2.2, §6.7 (08:T-PL-8) | `layouts/ps-over-vp-flag512-0`, `layouts/ps-over-vp-flag512-1`, `layouts/pagesetup-flags-688`, `layouts/pagesetup-flags-176` (+11 more) | open |
| Q-0259 | plotting | [A] Does AutoCAD accept a PMP file with custom pixel sizes generated programmatically (zlib PIAFILEVERSION container)? | 08 §5.3, §6.6 | plan: calibration (log) — Generated truedxf PNG.pmp with 2000x1500 size; -PLOT paper size ? listing and a plot | open |
| Q-0260 | plotting | [U] What is the exact list of built-in PublishToWeb PNG paper sizes (names as shown at the -PLOT paper size prompt)? | 08 §5.3, §6.5 (08:T-ACC-1) | plan: calibration (log) — Discovery script: -PLOT, device PublishToWeb PNG.pc3, '?' at paper size prompt, cancel | open |
| Q-0261 | plotting | [U] What are the exact detailed -PLOT prompts and order for Model/layout on the PNG device (paper-units/plot-to-file prompts skipped? scale shows pixels?) | 08 §6.4, §8 item 1 (08:T-ACC-1) | plan: calibration (log) — Discovery script with full detailed -PLOT to PublishToWeb PNG for Model and Layout1; commit decoded log | open |
| Q-0262 | plotting | [A] What is the exact -PLOT plot style prompt text, and does '.' select no plot style table? | 08 §5.5 (08:T-ACC-1) | plan: calibration (log) — Detailed -PLOT answering '.' at the plot style table prompt; inspect echoed log | open |
| Q-0263 | plotting | [A] Do underscore-prefixed global keywords (_Y, _W, _F, _C, _L) work at every -PLOT prompt? | 08 §6.2 (08:T-ACC-1) | plan: calibration (log) — Detailed -PLOT script using only underscore keywords; compare echoed prompts with template | open |
| Q-0264 | plotting | [U] Is the -PLOT layout name prompt case-insensitive (e.g. 'layout1' for 'Layout1')? | 08 §6.4 (08:T-ACC-1) | plan: calibration (log) — -PLOT answering lower-case layout name; check log for error | open |
| Q-0265 | plotting | [U] What is the prompt sequence of SAVEAS with the DXF format option in accoreconsole? | 08 §6.7 | plan: fileformat (log) — Script: _.SAVEAS then DXF option; capture echoed prompts | open |
| Q-0266 | plotting | [U] Does accoreconsole find a custom PC3/PMP/CTB when run with /isolate, and does /p <profile> fix plotter/plot-style paths? | 08 §6.1, §6.6, §8 item 14 (08:T-ACC-2) | plan: calibration (log) — Run -PLOT with truedxf PNG.pc3 + custom CTB with/without /isolate and /p; check log and PNG | open |
| Q-0267 | plotting | [U] Do sysvars set in one accoreconsole run leak into the next run without /isolate (is /isolate per worker needed)? | 08 §6.1, §6.9, §8 item 14 (08:T-ACC-2) | plan: calibration (lisp) — Run 1 sets LWDEFAULT 100 / PLOTOFFSET 1; run 2 prints getvar values via LISP marker | open |
| Q-0268 | plotting | [A] Can several accoreconsole instances run in parallel without profile/registry lock errors? | 08 §6.1, §6.9 | plan: calibration (log) — Launch N console instances plotting different DXFs concurrently; check logs and PNGs | open |
| Q-0269 | plotting | [A] Does SECURELOAD 0 set in the script allow loading LISP from an untrusted folder in accoreconsole without a prompt? | 08 §6.2 | plan: calibration (log) — Script: SECURELOAD 0 then (load "untrusted/probe.lsp"); check log for prompt/stall | open |
| Q-0270 | plotting | [A] Does a UTF-8 BOM at the start of a .scr break the first command in accoreconsole? | 08 §6.3 | plan: calibration (log) — Same script saved with and without BOM (CRLF); first command SETVAR; inspect log | open |
| Q-0271 | plotting | [U] Does accoreconsole exit when stdin is redirected from NUL and a script stalls at an unexpected prompt? | 08 §6.9 | plan: calibration (log) — Script with a deliberately missing answer; run with stdin < NUL; measure exit vs hang | open |
| Q-0272 | plotting | [U] Can APS Design Automation for AutoCAD use custom PC3/PMP files shipped in an AppBundle? | 08 §6.8 | plan: calibration (log) — AppBundle with truedxf PNG.pc3/.pmp; WorkItem running -PLOT with custom size | open |
| Q-0273 | plotting | [A] Is DWG TrueView scriptable (script/console) for plotting DXF? | 08 §6.8 | plan: none (none) | open |

- Q-0232: Yes: fixed 100 dpi on every canvas (`calibration/lineweights-*`, note 08 §10.4).
- Q-0235: No anti-aliasing anywhere (monochrome plots contain only 000000/FFFFFF) (note 08 §10.6).
- Q-0236: Neither: a 16.16 fixed-point DDA between the snapped end pixels, slope truncated toward zero (301/301 probe lines, `calibration/raster-lines`, `probe-line-ties`, note 08 §10.3); circles: note 08 §10.13.
- Q-0246: Yes: an invisible INSERT hides all its content (`blocks/vis-invisible-flag`).
- Q-0247: LIGHT glyphs never plot, whatever the plot-glyph flag (`misc/light-*`; CAMERA not tested).

<a id="property-resolution"></a>
## Property resolution (`property-resolution`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0274 | property-resolution | [A] Is an entity without group 8 placed on layer '0' rather than $CLAYER? | 01 §7.2 | `colors/no-layer-group` | open |
| Q-0275 | property-resolution | [U] Does AutoCAD create a layer referenced by entities but missing from LAYER table on load, and with what colour/linetype/lw/plot flag (7, Continuous, default, on)? | 02 §0 item 10, §4.2 rule 3; 11c §3 (AutoCAD creates missing layers on the fly, REPORTED), §18 #28; 01 §3.1, §8.1 (02:T8, 01:T1) | `fileformat/undefined-layer-r12`, `fileformat/undefined-layer-r2018` | open |
| Q-0276 | property-resolution | [U] How does AutoCAD case-fold non-ASCII table names (Ä vs ä, Turkish i) and \U+XXXX-escaped names when matching layers? | 02 §4.2 rule 1, §6 (02:T9) | `fileformat/nonascii-casefold-r2004`, `fileformat/nonascii-casefold-r2018` | open |
| Q-0277 | property-resolution | [A] When a name and handle disagree (MLINE 2 vs 340, VIEWPORT 341 vs XDATA 1003 frozen layers), which does AutoCAD use? | 02 §0 item 10, §4.2 rule 8 | `mline/style-name-handle-mismatch` | open |
| Q-0278 | property-resolution | [T] Does the nested (2-level) layer-0/BYBLOCK/BYLAYER matrix for colour, linetype, lw, transparency resolve like ezdxf (top-level BYBLOCK -> 7/CONT/LWDEFAULT)? | 06 §0 item 8, §7.1; 07 §3.1; 11b §5, Test ideas; 11c §10 (ByBlock takes INSERT colour), §15 item 9, §18 #21 (06:R1, 07:7, 11b:3) | `blocks/inherit-matrix-*`, `blocks/inherit-3level-*`, `blocks/inherit-toplevel-byblock`, `colors/byblock-toplevel` (+5 more) | answered |
| Q-0279 | property-resolution | [A] Do ATTRIBs resolve like block content: layer-0 ATTRIB takes INSERT's layer, BYBLOCK colour from INSERT, BYLAYER from the ATTRIB's own layer? | 07 §3.1; 11b §5 (07:7, 07:10, 11b:15) | `attribs/props-byblock-bylayer`, `attribs/props-insert-bylayer` | open |
| Q-0280 | property-resolution | [C] Does freezing an INSERT's layer hide all block content (incl. other visible layers), while off or no-plot (290=0) hides only layer-0 content, also nested? | 06 §7.2, §9 item 11; 11a §13; 11b §5, Test ideas; 02 §0 item 7, §2.1.1, §6; 02 §2.1.1 (06:R2, 11a:37, 11b:3, 02:T2) | `blocks/vis-insert-layer-on`, `blocks/vis-insert-layer-off`, `blocks/vis-insert-layer-frozen`, `blocks/vis-insert-layer-noplot` | answered |
| Q-0281 | property-resolution | [U] Does layer 0 being off/frozen hide layer-0 content of blocks inserted on other layers? | 06 §7.2, §9 item 11 (06:R3) | `blocks/vis-layer0-off`, `blocks/vis-layer0-frozen`, `blocks/vis-layer0-noplot` | answered |
| Q-0282 | property-resolution | [A] Does AutoCAD PLOT skip entities on a layer with plot flag 290=0, including inside blocks and viewport borders? | 11a §4, §14 (11a:37) | `blocks/vis-insert-layer-noplot`, `blocks/vis-layer0-noplot`, `colors/layer-noplot` | answered |
| Q-0283 | property-resolution | [U] Does PLOT omit entities on layer DEFPOINTS (any case) even when its 290 plot flag is 1 or absent? | 02 §0 item 6, §2.1.1, §6; 06 §7.2; 05 §4.1, §14 (02:T1) | `colors/defpoints-no290`, `colors/defpoints-plot1`, `colors/defpoints-plot0`, `colors/defpoints-lowercase` | answered |
| Q-0284 | property-resolution | [A] Does a locked layer (70 bit 4) plot normally, unaffected by LAYLOCKFADECTL fading? | 02 §2.1.1 (02:T1) | `colors/layer-locked`, `misc/locked-layer`, `misc/locked-layer-hatch` | open |
| Q-0285 | property-resolution | [A] Does LAYER 70 bit 2 (frozen in new viewports) hide anything in model-space PLOT or existing viewports? | 11b §5 | `layouts/newvpfrozen-model`, `layouts/newvpfrozen-layout` | answered |

- Q-0285: No: LAYER 70 bit 2 has no effect on model plots or existing viewports (`layouts/newvpfrozen-*`).
- Q-0280: Frozen hides all content, off only layer-0 content, but no-plot (290=0) suppresses all content (`blocks/vis-insert-layer-*`, note 07 §3.2).
- Q-0281: No: layer 0's own state does not matter for layer-0 content of blocks inserted on other layers (`blocks/vis-layer0-*`).
- Q-0282: Yes, and a no-plot INSERT layer suppresses the whole block content (`blocks/vis-insert-layer-noplot`, `vis-layer0-noplot`, `colors/layer-noplot`).
- Q-0278: Yes: the 2- and 3-level layer-0/BYBLOCK/BYLAYER matrices for colour, linetype and lineweight resolve like ezdxf (top-level BYBLOCK → ACI 7 / Continuous / LWDEFAULT) (`blocks/inherit-*`).
- Q-0283: Yes: POINTs and LINEs on DEFPOINTS never plot (`points/point-defpoints-0001`, `extents/probe-layer-defpoints`); the colors/defpoints-* variants were rejected as invalid fixtures.

<a id="draw-order"></a>
## Draw order (`draw-order`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0286 | draw-order | [U] Without SORTENTS, does AutoCAD draw in DXF file order or ascending handle order when they differ? | 06 §0 item 12, §8.1, §9 item 10 (06:D1) | `draworder/baseline-file-order`, `draworder/file-vs-handle-solid`, `draworder/file-vs-handle-hatch`, `draworder/file-vs-handle-reversed` | answered |
| Q-0287 | draw-order | [A] Without SORTENTSTABLE, is a solid hatch drawn in creation order over/under MTEXT, or always below? | 11b §11, Test ideas (11b:9) | `draworder/hatch-after-mtext`, `draworder/hatch-before-mtext`, `draworder/hatch-before-sortents-mtext` | answered |
| Q-0288 | draw-order | [U] Does PLOT honour SORTENTSTABLE draw order when $SORTENTS bit 32 (plot) is cleared, e.g. $SORTENTS 0 or 95 vs 127? | 01 §7.2, §10 item 14; 02 §3.12, §6; 06 §8.2 (02:T10) | `draworder/sortents-127`, `draworder/sortents-095`, `draworder/sortents-111`, `draworder/sortents-000` | answered |
| Q-0289 | draw-order | [T] With a SORTENTSTABLE, does PLOT sort by sort handle (hex int, stable), key unlisted entities by own handle, and draw sort handle 0 last? | 02 §0 item 8, §3.12; 06 §0 item 12, §8.2 (02:T10, 06:D1) | `draworder/sortents-127`, `draworder/sortents-095`, `draworder/sortents-111`, `draworder/sortents-000` (+6 more) | answered |
| Q-0290 | draw-order | [U] Does PLOT honour a block definition's own ACAD_SORTENTS table (sort handles differing from entity handles) when drawing its INSERTs? | 02 §3.12, §6; 06 §8.1, §9 item 10; 07 §3.2 (02:T10, 06:D3) | `draworder/block-file-order`, `draworder/block-sortents` | answered |
| Q-0291 | draw-order | [T] Are ATTRIBs always drawn after all block content (above a solid hatch in the block) in PLOT? | 07 §3.2, §4.2 (07:10) | `attribs/draworder-hatch-in-block`, `attribs/draworder-hatch-after-insert`, `draworder/attrib-after-content`, `draworder/attrib-vs-later-entity` | open |
| Q-0292 | draw-order | [C] Does 'plot paperspace last' (70 bit 512 / -PLOT 'Plot paper space first?') decide whether PS entities plot over viewport content; does default 70=688 set it? | 06 §8.3, §9 item 10; 08 §3.10, §6.4, §7 item 6, §8 item 9, §2.2 (bit 512); 11a §13 (06:D2, 08:T-VP-8) | `draworder/ps-solid-after-viewport`, `draworder/ps-flags-176`, `draworder/ps-paperspace-first` | answered |
| Q-0293 | draw-order | [U] Does AutoCAD plot viewport model content above or below paper-space entities, and does the VIEWPORT's position in draw order (storage/SORTENTS) matter? | n/a | `draworder/ps-solid-after-viewport`, `draworder/ps-solid-before-viewport`, `draworder/ps-sortents-viewport-top` | answered |
| Q-0294 | draw-order | [U] Does a paper-space WIPEOUT over a viewport hide that viewport's model content when 'paperspace last' is off? | 08 §3.10 (08:T-VP-8) | `layouts/wipeout-over-vp-psfirst-n`, `layouts/wipeout-over-vp-psfirst-y` | answered |

- Q-0292: Yes: "Plot paper space first? No" (default when 70 bit 512 is set, e.g. 688) = viewport content first, paper on top; "Yes" = paper first (`layouts/ps-over-vp-*`, note 08 §10.12).
- Q-0293: Viewport content is drawn as one group before (default) or after paper space; the VIEWPORT's position in the entity list does not matter; overlapping viewports by creation order (`layouts/ps-over-vp-*`, `vp-overlap-*`).
- Q-0294: No: a paper-space WIPEOUT never masks viewport content, with either answer (`layouts/wipeout-over-vp-psfirst-*`).
- Q-0286: File order (`draworder/file-vs-handle-*`).
- Q-0287: Plain creation (file) order: a later solid hatch covers the MTEXT, an earlier one is covered (`draworder/hatch-*-mtext`).
- Q-0288: Only with $SORTENTS bit 32: 0 and 95 plot in file order, 111 and 127 sorted (`draworder/sortents-*`).
- Q-0289: Numeric sort-handle order, ties in file order, unlisted entities by own handle; sort handle 0 is key 0 and draws first, not last (`draworder/sortents-*`, `random-*`, note 06 §8.2).
- Q-0290: Yes (`draworder/block-sortents`).

<a id="linetypes"></a>
## Linetypes (`linetypes`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0295 | linetypes | [U] With $MEASUREMENT missing/0/1, does an LTYPE without pattern data (or a missing LTYPE) get acad.lin or acadiso.lin dashes? | 01 §7.2 (01:T27) | `linetypes/odd-dashed-empty-meas-1`, `linetypes/odd-dashed-empty-meas-0`, `linetypes/odd-dashed-empty-meas-absent` | answered |
| Q-0296 | linetypes | [U] Does AutoCAD open a DXF whose entity references an undefined linetype, what does it repair it to, does it plot continuous, and is lookup case-insensitive? | 01 §8.1; 02 §2.2, §4.2 rule 4; 06 §7.1; 11a §12 (02:T7) | `fileformat/undefined-linetype-entity-r12`, `fileformat/undefined-linetype-entity-r2000`, `fileformat/linetype-lowercase-ref`, `linetypes/undefined-nosuch` (+2 more) | open |
| Q-0297 | linetypes | [T] What does AutoCAD do when a LAYER's group 6 references an undefined linetype (refuse, or substitute Continuous)? | 02 §4.2 rule 4 (02:T7) | `fileformat/undefined-linetype-layer-r12`, `fileformat/undefined-linetype-layer-r2018` | open |
| Q-0298 | linetypes | [A] Does any LTYPE with 73=0 (no elements) render solid, even if 40 pattern length is nonzero? | 02 §2.2 | `linetypes/odd-empty-40-5`, `linetypes/odd-dashed-empty-meas-1`, `linetypes/odd-dashed-empty-meas-0`, `linetypes/odd-dashed-empty-meas-absent` | answered |
| Q-0299 | linetypes | [T] How does PLOT render an LTYPE whose first element is a gap, or whose 40 exceeds the sum of \|49\|? | 06 §2.1 | `linetypes/odd-leading-gap`, `linetypes/odd-total-exceeds`, `linetypes/odd-total-less`, `linetypes/odd-total-zero` (+4 more) | answered |
| Q-0300 | linetypes | [U] What exact A-type rule fits a pattern on a LINE (end dashes lengthened, phase), and is a LINE shorter than one period continuous with complex elements omitted? | 06 §0 item 5, §2.6, §9 item 1, §2.3; 11a §12 (06:L1, 11a:22) | `linetypes/fit-dashed`, `linetypes/fit-dashed2`, `linetypes/fit-dashedx2`, `linetypes/fit-dashdot` (+49 more) | answered |
| Q-0301 | linetypes | [U] For patterns whose first element is a dot (DOT, 0,-.25), what is drawn at the line ends under A-type fitting? | 06 §2.6, §9 item 1 (06:L1) | `linetypes/fit-dot`, `linetypes/fit-dot2`, `linetypes/fitzoom-dot-*` | answered |
| Q-0302 | linetypes | [A] Are zero-length dash elements (linetype DOT and hatch DOTS pattern) plotted as round discs of the lineweight diameter, 1 px at lineweight 0? | 06 §1.6.2, §9 item 9, §2.6; 11a §11, §12 (06:H10, 06:L8, 11a:25) | `hatches/dots-lw0`, `hatches/dots-lw35`, `hatches/dots-lw50`, `hatches/dots-lw211` (+6 more) | open |
| Q-0303 | linetypes | [A] Is an ARC's linetype fitted along arc length with dashes at both endpoints like a LINE? | 06 §2.6 (06:L3) | `linetypes/circle-ocs-pos`, `linetypes/circle-ocs-neg`, `linetypes/arc-dashed-010-350`, `linetypes/arc-dashed-000-090` (+12 more) | answered |
| Q-0304 | linetypes | [U] Where does a CIRCLE's pattern start (OCS angle 0, CCW about N, flipped for 210=0,0,-1), and is it stretched to whole periods vs a LINE of equal length? | 03 §3.4, Test ideas 1; 06 §2.6, §9 item 1; 11c §10 (dash scale same on lines and circles, ASSUMPTION), §18 #18 (03:T1, 06:L3) | `linetypes/pl-bulge-circle-gen0`, `linetypes/pl-bulge-circle-gen1`, `linetypes/circle-dashed-r1`, `linetypes/circle-dashed-r2-37` (+11 more) | answered |
| Q-0305 | linetypes | [A] Are open/closed ELLIPSE and SPLINE linetypes fitted like arcs (open) and circles (closed)? | 06 §2.6, §9 item 1 (06:L3) | `linetypes/ellipse-dashed-full`, `linetypes/ellipse-dashed-half`, `linetypes/ellipse-dashed-partial`, `linetypes/ellipse-dashed-rot30-full` (+11 more) | answered |
| Q-0306 | linetypes | [U] Where does the dash pattern phase start on a dashed XLINE/RAY (at base point 10, running both directions for XLINE)? | 03 §3.3, Test ideas 34 (03:T34) | `linetypes/infinite-xline`, `linetypes/infinite-ray`, `linetypes/infinite-xline-dashed`, `linetypes/infinite-extents` | answered |
| Q-0307 | linetypes | [U] With PLINEGEN off, is each LWPOLYLINE segment fitted separately; with it on, is the whole polyline fitted, and does a closed one start/close at vertex 0? | 06 §2.6, §9 item 1 (06:L2) | `linetypes/pl-zigzag-dashed-open-gen0`, `linetypes/pl-zigzag-dashed-open-gen1`, `linetypes/pl-zigzag-dashed-closed-gen0`, `linetypes/pl-zigzag-dashed-closed-gen1` (+16 more) | answered |
| Q-0308 | linetypes | [U] On wide/tapered LWPOLYLINEs, is each dash a wide quad inheriting local width, and how does PLINEGEN (70 bit 128) change this with per-segment widths? | 03 §3.9, Test ideas 27, §4.1; 06 §2.6 (03:T27, 06:L6) | `linetypes/pl-wide-const-gen0`, `linetypes/pl-wide-const-gen1`, `linetypes/pl-wide-taper-gen0`, `linetypes/pl-wide-taper-gen1` (+2 more) | answered |
| Q-0309 | linetypes | [A] Are linetypes on 3D POLYLINEs and polyface/polygon meshes applied per segment? | 06 §2.6 | `linetypes/other-polyline3d`, `linetypes/other-polymesh` | answered |
| Q-0310 | linetypes | [U] Do 3DFACE edges get the entity linetype when plotted? | 06 §2.6 | `linetypes/other-3dface` | answered |
| Q-0311 | linetypes | [A] Do TEXT/MTEXT, SOLID, TRACE and IMAGE frames ignore the entity linetype when plotted? | 06 §2.6 | `linetypes/other-nonlinear` | open |
| Q-0312 | linetypes | [U] Does PLOT switch a linetype to continuous when dashes are below the plot resolution, and at what threshold? | 06 §2.6 | `linetypes/dense-48-dashed`, `linetypes/dense-48-dot`, `linetypes/dense-ltscale-*`, `linetypes/dense-short-subpixel` (+1 more) | answered |
| Q-0313 | linetypes | [U] Does AutoCAD adjust ISO (W100) linetypes automatically by pen width/lineweight, or only via linetype scale? | 06 §2.4 | `linetypes/lw-acadiso02w100`, `linetypes/lw-acadiso07w100`, `linetypes/lw-iso02-scaled` | answered |
| Q-0314 | linetypes | [T] Is effective linetype scale LTSCALE x CELTSCALE x entity 48 (x INSERT scale), e.g. 48=0.5/LTSCALE 2 == 48=1/LTSCALE 1, and how does PSLTSCALE change it? | 06 §2.5, §7.1; 11b §12, Test ideas (11b:10, 06:L9) | `linetypes/scale-ltscale-*`, `linetypes/scale-equiv-*`, `linetypes/scale-celtscale-*`, `linetypes/scale-bylayer-48` (+16 more) | answered |
| Q-0315 | linetypes | [C] Is PSLTSCALE=1 'viewport scaling governs' (same paper dash length at 1:1/1:10/1:100), contrary to DXF ref wording, and how do LTSCALE/MSLTSCALE combine? | 01 §7.2, §7.4; 06 §2.5; 08 §0 item 2, §1.5, §3.8; 11a §12, Open conflicts (01:T22, 06:L4, 08:T-VP-7, 11a:23) | `layouts/psltscale-h1-l1`, `layouts/psltscale-h0-l0`, `layouts/psltscale-h1-l0`, `layouts/psltscale-h0-l1` (+3 more) | answered |
| Q-0316 | linetypes | [U] When header $PSLTSCALE and LAYOUT 70 bit 1 disagree, which one does PLOT of that layout use? | 01 §7.2, §10 item 10; 08 §1.5, §3.8, §8 item 10; 11c §10 (PSLTSCALE header plus LAYOUT 70 bit 1), §18 #18 (01:T22, 08:T-VP-7) | `layouts/psltscale-h1-l1`, `layouts/psltscale-h0-l0`, `layouts/psltscale-h1-l0`, `layouts/psltscale-h0-l1` (+4 more) | answered |
| Q-0317 | linetypes | [U] Is PSLTSCALE stored per layout, and how does AutoCAD write it to DXF when layouts differ? | 06 §2.5 (06:L4) | `layouts/psltscale-two-layouts-layout1`, `layouts/psltscale-two-layouts-sheet2` | answered |
| Q-0318 | linetypes | [A] Does PLOT apply the file's PSLTSCALE/LTSCALE without a REGENALL (plots regenerate)? | 08 §3.8 (08:T-VP-7) | `layouts/psltscale-h1-l1` | answered |
| Q-0319 | linetypes | [A] In a model-tab plot with MSLTSCALE=1, are dash lengths scaled by the annotation scale CANNOSCALE (combined with LTSCALE and entity 48)? | 06 §2.5; 08 §1.5 (MSLTSCALE), §3.8, §5.6 (08:T-VP-7) | plan: linetypes (png) — Model-space DASHED LINE, LTSCALE 2, entity 48=0.5; MSLTSCALE 0/1 with CANNOSCALE 1:1, 1:2, 1:10 | open |
| Q-0320 | linetypes | [C] Are block-content dashes generated in block coordinates then transformed by INSERT scale (uniform 3, mirrored -1, non-uniform 2,1 stretching by direction)? | 06 §2.5, §7.1, §9 item 2; 07 §2.4, §17 (06:L5, 07:4) | `blocks/linetype-scale-s1`, `blocks/linetype-scale-s3`, `blocks/linetype-scale-mirror`, `blocks/linetype-scale-nonuni-rot45` (+10 more) | answered |
| Q-0321 | linetypes | [U] Does INSERT group 48 (ltscale) multiply into child entity linetype scales, or is it ignored for block content? | 07 §3.1, §17 (07:4) | `blocks/linetype-insert-ltscale`, `linetypes/byblock-ltscale2`, `linetypes/insert-ltscale-vs-child` | answered |
| Q-0322 | linetypes | [A] Does dimension-block linework use LTSCALE x DIMENSION group 48 for linetype scaling (BYBLOCK-like), with no 48 on block entities? | 05 §8 | `dimensions/dimltype-dashed-lts1-s0p5-nb`, `dimensions/dimltype-dashed-lts1-s2-nb`, `dimensions/dimltype-dashed-lts3-s1-nb`, `dimensions/dimltype-dashed-lts1-s2-ez` | answered: block parts get the DIMENSION's 48 (note 05 §17.1) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0323 | linetypes | [C] Does AutoCAD treat LTYPE 74 bit 2 as text and bit 4 as shape in DXF (vs ODA's swapped meaning)? | 06 §2.2 (06:L7) | `acad-default-fonts/ltype-fenceline1-ltscale1`, `acad-default-fonts/ltype-fenceline1-ltscale2`, `acad-default-fonts/ltype-fenceline2-ltscale1`, `acad-default-fonts/ltype-fenceline2-ltscale2` (+10 more) | answered |
| Q-0324 | linetypes | [C] Is LTYPE complex element rotation 50 interpreted in degrees (not radians as the DXF reference says)? | 06 §0 item 6, §2.2 (06:L7) | `linetypes/ctext-rot-units-horizontal`, `linetypes/ctext-rot-units-angled` | answered |
| Q-0325 | linetypes | [U] How do 74 bit 1 (absolute A=) and bit 8 (upright U=) orient linetype text/shapes (rotation 0/30/357.8) on lines at 85-275deg; exact upright flip threshold? | 02 §0 item 3, §2.2, §6; 06 §2.2, §9 item 3; 11a §12 (02:T6, 06:L7, 11a:24) | `linetypes/ctext-rot-units-horizontal`, `linetypes/ctext-rot-units-angled`, `linetypes/ctext-orient-r-0-0`, `linetypes/ctext-orient-r-30-0` (+9 more) | answered |
| Q-0326 | linetypes | [A] Is complex linetype text/shape placed at the end of its element, offset by X/Y in the rotated element frame, with text inserted at its baseline-left? | 06 §2.3, §9 item 3 (06:L7) | `acad-default-fonts/ltype-fenceline1-ltscale1`, `acad-default-fonts/ltype-fenceline1-ltscale2`, `acad-default-fonts/ltype-fenceline2-ltscale1`, `acad-default-fonts/ltype-fenceline2-ltscale2` (+21 more) | answered |
| Q-0327 | linetypes | [U] Is linetype text height S (46) when the STYLE height is 0, and S x STYLE fixed height when that is nonzero? | 02 §2.2, §6; 06 §2.3 (02:T6, 06:L7) | `linetypes/ctext-height-s2-54-style0-0`, `linetypes/ctext-height-s2-54-style2-0`, `linetypes/ctext-height-s6-0-style0-0`, `linetypes/ctext-height-s6-0-style2-0` | answered |
| Q-0328 | linetypes | [A] How does AutoCAD render complex-linetype shape/text segments whose scale S is 0 or negative? | 11c §10 (segment scale 0 or negative accepted, REPORTED), §17 netDxf#59 test2.dxf | `acad-default-fonts/ltype-fenceline2-scale-zero`, `acad-default-fonts/ltype-fenceline2-scale-negative`, `linetypes/ctext-scale-zero`, `linetypes/ctext-scale-neg` | answered |
| Q-0329 | linetypes | [U] What does PLOT draw for a shape linetype element when the referenced .shx file is missing? | 06 §2.3 | `linetypes/ctext-missing-shx` | answered |
| Q-0330 | linetypes | [A] Does AutoCAD accept 'r'/'g' suffixes (radians/grads) on R=/A=/U= in .lin files? | 06 §2.4 | plan: linetypes (dxfout) — Custom .lin with R=1.5708r and R=100g; -LINETYPE load, DXFOUT and read 50 | open |

- Q-0315: Yes: $PSLTSCALE=1 gives the same paper dash length (pattern × LTSCALE × 48) in 1:1/1:4/1:10 viewports; 0 scales dashes with the viewport (`layouts/psltscale-*`, note 08 §10.12).
- Q-0316: The header $PSLTSCALE decides for the active layout; LAYOUT 70 bit 1 for the other layouts (`layouts/psltscale-h*-l*`, `psltscale-two-layouts-*`).
- Q-0317: Per layout: LAYOUT 70 bit 1 (the header mirrors the active layout) (`layouts/psltscale-two-layouts-*`).
- Q-0318: Yes: PLOT regenerates; no REGENALL needed (`layouts/psltscale-h1-l1`).
- Q-0308: Yes: each dash is the band piece between its positions with interpolated widths (mitered over vertices); PLINEGEN is ignored when the polyline has tapered segments (`linetypes/pl-wide-*`, note 03 §4.1).

Answers (VERIFIED-BY-ACAD, AutoCAD 2027, 2026-09-30):
- Q-0295: No: an LTYPE with 73=0 (even named DASHED) plots continuous for $MEASUREMENT 0/1/absent; no .lin reload (`linetypes/odd-dashed-empty-meas-*`, note 06 §2.6.1).
- Q-0298: Yes: 73=0 plots continuous regardless of 40 (`linetypes/odd-empty-40-5`).
- Q-0299: AutoCAD walks `[h, e1…, (k−1)×period, e0+r]` with k, r from group 40 (not Σ|49|) and clips at L; leading gap → head dash (e0+r)/2 merged into e1; 40=0 → continuous (`linetypes/odd-*`, note 06 §2.6.1).
- Q-0300: k=⌊L/P⌋, r=L−kP, both end dashes e0/2+r/2, interior phase e0/2−r/2; L<P → continuous and no complex elements (`linetypes/fit-*`, `fitzoom-*`; note 06 §2.6.1).
- Q-0301: Dots at both line ends (no end dashes), interior dots at h+e1+mP; a pure dot pattern shows the two end dots even for L<P (`linetypes/fit-dot*`).
- Q-0303: Yes, along the arc length from the start angle, exactly like a LINE (`linetypes/arc-*`, `arc-short-*`).
- Q-0304: OCS angle 0, CCW about the extrusion; stretched to max(2, round(L/P)) whole periods (`linetypes/circle-*`, `circle-ocs-*`).
- Q-0305: Open ELLIPSE and every SPLINE (also closed ones) like a LINE/ARC; a full ELLIPSE like a CIRCLE (stretched, starts at parameter 0) (`linetypes/ellipse-*`, `spline-*`).
- Q-0306: The XLINE/RAY is clipped to the plot window and fitted as a LINE of the clipped length (`linetypes/infinite-xline*`, `infinite-ray`).
- Q-0307: Off: every segment fitted separately; on: one unit — open: A-type at the first/last vertex; closed: stretched whole periods starting at vertex 1; the entity flag decides, not $PLINEGEN (`linetypes/pl-*`, `polyline2d-*`).
- Q-0309: Neither: 3D POLYLINEs and polygon meshes plot continuous (`linetypes/other-polyline3d`, `other-polymesh`).
- Q-0310: No, 3DFACE edges plot continuous (`linetypes/other-3dface`).
- Q-0313: No automatic adjustment; only 48/LTSCALE scale ISO linetypes (`linetypes/lw-iso02-scaled`, `lw-acadiso*`).
- Q-0314: Effective scale = $LTSCALE × entity 48 (48=0.5/LTSCALE 2 ≡ 48=1/LTSCALE 1); CELTSCALE is ignored; no INSERT scale (`linetypes/scale-*`, `insert-scale-*`).
- Q-0320: No: the pattern is applied in WCS after the INSERT transform — uniform, mirrored and non-uniform scales leave the dash lengths unchanged (`linetypes/insert-scale-*`).
- Q-0321: Ignored: INSERT 48 does not multiply into the content, also not for BYBLOCK linetypes (`linetypes/insert-ltscale-vs-child`, `byblock-ltscale2`).
- Q-0312: Yes: continuous when the pattern period is below ~0.5 device px (0.38 px continuous, 0.51 px dashed), independent of the dash count (`linetypes/dense-*`, note 06 §2.6.1).
- Q-0323: DXF meaning: 74 bit 2 = text, bit 4 = shape (`acad-default-fonts/ltype-*`, `linetypes/ctext-*`).
- Q-0324: Degrees (`linetypes/ctext-rot-units-*`).
- Q-0325: A= absolute, R= relative about the insertion point; U= flips when the line (not line + rotation) points left in the entity's block coordinates (vertical never), turning the text about the middle of its gap; rotated U= text turns about its glyph-box centre (`linetypes/ctext-orient-*`, `ctext-insert-*`, note 06 §2.3.1).
- Q-0326: Yes: end of the carrying element + X along / Y across in the line frame, text baseline-left (`linetypes/ctext-place-*`, `acad-default-fonts/ltype-*`).
- Q-0327: |S| × STYLE fixed height when set, else |S| (`linetypes/ctext-height-*`).
- Q-0328: Text: S=0 → 1 × linetype scale, S<0 → turned by 180°; shapes: S<0 point-mirrored, S=0 collapsed along the line with 1 unit across (`linetypes/ctext-scale-*`, `acad-default-fonts/ltype-fenceline2-scale-*`).
- Q-0329: Nothing (the dashes still plot) (`linetypes/ctext-missing-shx`).

<a id="hatches"></a>
## HATCH (`hatches`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0331 | hatches | [C] Does PLOT draw a HATCH's stored pattern lines (53/43-46/49) as final geometry, or regenerate from 2/41/52 (or the .pat) when they disagree, before/after REGEN? | 06 §0 item 1, §1.4, §1.6.1, §1.13; 11a §11; 11b §11, Test ideas; 11c §7 (stored lines, REPORTED), §15 item 3, §18 #11 (06:H1, 11a:18, 11b:9) | `hatches/sweep-ansi31-s0p25-a0`, `hatches/sweep-ansi31-s0p5-a0`, `hatches/sweep-ansi31-s2-a0`, `hatches/sweep-ansi31-s1-a30` (+9 more) | open |
| Q-0332 | hatches | [A] Does $MEASUREMENT 0 vs 1 change the PLOT of an existing predefined-pattern HATCH or LTYPE that stores its pattern data? | 01 §7.2; 11b §4, §11 (11b:9) | `hatches/measurement-0`, `hatches/measurement-1` | open |
| Q-0333 | hatches | [U] How does AutoCAD render a predefined-pattern HATCH lacking pattern-definition lines (78=0): regenerated from acad/acadiso.pat per $MEASUREMENT? | 01 §7.2 | `hatches/no-lines-0`, `hatches/no-lines-1` | open |
| Q-0334 | hatches | [T] Does AutoCAD render embedded lines for a custom (76=2) pattern whose .pat is missing, or substitute ANSI31? | 06 §1.13 | `hatches/stored-custom-missing-pat` | open |
| Q-0335 | hatches | [A] For user-defined patterns (76=0) with 77=1, are both families stored as 78=2 lines and does PLOT draw only stored lines? | 06 §1.6.1, §9 item 9 (06:H9) | `hatches/user-single-s5-a0`, `hatches/user-single-s5-a30`, `hatches/user-double-s8-a0`, `hatches/user-double-s8-a45` (+1 more) | open |
| Q-0336 | hatches | [A] Does AutoCAD accept .pat definition lines longer than 80 chars or with more than 6 dashes? | 06 §1.13 | plan: hatches (log) — Custom .pat with a 120-char line and 10 dashes; -HATCH with it, check log and DXFOUT | open |
| Q-0337 | hatches | [U] Is the plotted pattern origin the pattern-line base points (43/44), unaffected by seed points (98 count and 10/20 positions)? | 11a §11; 11b §11, Test ideas (11a:18, 11b:9) | `hatches/origin-seed-0`, `hatches/origin-seed-1`, `hatches/origin-seed-2`, `hatches/origin-base-3p175-0` (+2 more) | open |
| Q-0338 | hatches | [A] Does AutoCAD derive the stored pattern base point (43/44) from the pick point when creating a hatch? | 06 §1.4 | plan: hatches (dxfout) — -HATCH ANSI31 via picked internal point vs select objects, DXFOUT, compare 43/44 to seed 10/20 | open |
| Q-0339 | hatches | [U] What does HATCH XDATA 'ACAD 1010' point mean (HPORIGIN?), and does it affect the plotted pattern when it differs from 43/44? | 06 §1.1, §9 item 9 | `hatches/origin-acad-xdata` | open |
| Q-0340 | hatches | [A] Does AutoCAD append ',_O'/',_I'/',_N' to HATCH 2 for outer/ignore/normal island styles, and does the suffix affect rendering? | 06 §1.1 (code 2) | `hatches/name-suffix-i-style0`, `hatches/name-suffix-o-style0`, `hatches/name-suffix-n-style2` | open |
| Q-0341 | hatches | [A] Are hatch pattern dashes crossing the boundary clipped exactly at the boundary? | 06 §1.6.2 (06:H1) | `hatches/pattern-ansi33`, `hatches/pattern-ar-brstd`, `hatches/pattern-brick`, `hatches/pattern-dash` (+11 more) | open |
| Q-0342 | hatches | [A] Does PLOT fill a self-intersecting loop (bow-tie, pentagram) even-odd, and how are pattern lines collinear with a boundary edge drawn? | 06 §1.5; 11b §11 (11b:9) | `hatches/collinear-user-edges`, `hatches/collinear-ansi31-diamond`, `hatches/selfint-bowtie`, `hatches/selfint-pentagram` (+2 more) | open |
| Q-0343 | hatches | [U] Are two overlapping (not nested) loops in one HATCH filled even-odd (intersection is a hole) under styles 0/1/2? | 06 §1.5, §0 item 3, §9 item 9 (06:H5) | `hatches/overlap-flags11-style0`, `hatches/overlap-flags11-style1`, `hatches/overlap-flags11-style2`, `hatches/overlap-flags10-style0` (+3 more) | open |
| Q-0344 | hatches | [U] How does PLOT fill a SOLID hatch with two external loops touching at a corner, plus a third loop with an island? | 11b §11, Test ideas (11b:9) | `hatches/corner-touch-solid`, `hatches/corner-touch-ansi31` | open |
| Q-0345 | hatches | [T] How exactly does AutoCAD fill a single HATCH loop whose edges form two disjoint rectangles: implicit joining segments, and which areas get filled? | 11c §7 (sequential path loops, LibreCAD#1739), §15 item 3, §18 #12 | `hatches/one-loop-two-rects` | answered |
| Q-0346 | hatches | [A] How do hatch style 75=0/1/2 and 92 flags (1 external, 16 outermost) interact on nested loops; is nesting geometric when flags are missing or wrong? | 06 §1.5, §0 item 3; 11a §11; 11b §11, Test ideas (06:H7, 11a:20, 11b:9) | `hatches/nested-solid-correct-style0`, `hatches/nested-solid-correct-style1`, `hatches/nested-solid-correct-style2`, `hatches/nested-solid-zero-style0` (+15 more) | answered |
| Q-0347 | hatches | [U] Does a textbox loop (92 bit 8) leave the text area unfilled under hatch styles 0/1/2? | 06 §1.5, §0 item 3, §9 item 9 (06:H6) | `hatches/textbox-solid-flag8-style0`, `hatches/textbox-solid-flag8-style1`, `hatches/textbox-solid-flag8-style2`, `hatches/textbox-solid-flag24-style1` (+3 more) | open |
| Q-0348 | hatches | [U] What endpoint-gap tolerance (1e-6/1e-3/1e-1) still lets AutoCAD fill a HATCH edge path, and are out-of-order edges joined head-to-tail? | 06 §1.3.3; 11a §11, Open conflicts (06:H8, 11a:20) | `hatches/edges-gap-1em06`, `hatches/edges-gap-0p001`, `hatches/edges-gap-0p1`, `hatches/edges-gap-1` (+4 more) | answered |
| Q-0349 | hatches | [A] Does PLOT fill a HATCH polyline path with 73=0 (open) as if closed? | 06 §1.3.2 | `hatches/poly-open-u-shape`, `hatches/poly-open-last-eq-first` | answered |
| Q-0350 | hatches | [T] Do full-circle HATCH arc/ellipse edges written 0..360, -180..180, 90..450 plot as full circles, and is 0..0 treated as an open loop (fill dropped)? | 06 §1.3.3; 11b §9, Test ideas (06:H4, 11b:9) | `hatches/fullcircle-arc-0-360`, `hatches/fullcircle-arc-m180-180`, `hatches/fullcircle-arc-90-450`, `hatches/fullcircle-arc-0-0` (+4 more) | open |
| Q-0351 | hatches | [T] Does a CW (73=0) arc edge in a hatch boundary plot as the correctly mirrored arc? | 11b §11, Test ideas (11b:9) | `hatches/arc-edge-cw`, `hatches/arc-edge-ccw`, `hatches/ellipse-edge-cw` | open |
| Q-0352 | hatches | [C] Are HATCH/MPOLYGON ellipse-edge 50/51 geometric angles or ellipse parameters? | 06 §1.3.3, §9 item 9 (06:H3) | `hatches/ellipse-edge-param-closed`, `hatches/ellipse-edge-angle-closed`, `hatches/ellipse-edge-rotated-partial` | answered: angles (06 §1.3.3) |
| Q-0353 | hatches | [A] For a periodic spline edge (74=1), does AutoCAD evaluate the explicitly stored knots/ctrl points as given? | 06 §1.3.3 | `hatches/edges-spline-periodic-1`, `hatches/edges-spline-periodic-0`, `hatches/edges-spline-periodic-clamped` | open |
| Q-0354 | hatches | [A] Do HATCH path-flag bits >= 32 (not closed, self-intersecting, duplicate, annotative...) appear in DXF 92 as-is? | 06 §1.3.1 | `hatches/selfint-pentagram-flag65` | open |
| Q-0355 | hatches | [A] Does PLOT ignore the HATCH entity linetype (e.g. DASHED) for pattern lines while still applying the entity lineweight? | 06 §1.2, §1.9 | `hatches/pattern-lt-continuous-lw0`, `hatches/pattern-lt-continuous-lw50`, `hatches/pattern-lt-continuous-lw100`, `hatches/pattern-lt-dashed-lw100` (+1 more) | open |
| Q-0356 | hatches | [A] Do solid/gradient hatch fills get no lineweight outline when plotted (filled area exactly the boundary)? | 06 §1.9 | `hatches/solid-lineweight-211`, `hatches/gradient-lineweight-211`, `lineweights/hatch-lw` | open |
| Q-0357 | hatches | [A] Is HATCHBACKGROUNDCOLOR drawn as a solid fill below the pattern lines, and how does it layer against earlier entities? | 06 §1.2, §1.10, §9 item 9 (06:H12) | `hatches/bgcolor-rgb-red`, `hatches/bgcolor-aci-3`, `hatches/bgcolor-bylayer`, `hatches/bgcolor-on-solid` | open |
| Q-0358 | hatches | [A] How is HATCHBACKGROUNDCOLOR encoded for ACI/BYLAYER/BYBLOCK choices (0xC3/0xC0/0xC1 top byte in 1071)? | 06 §1.10 | `hatches/bgcolor-aci-3`, `hatches/bgcolor-bylayer` | open |
| Q-0359 | hatches | [U] Is a pattern HATCH in an INSERT (scale 2, rot 30, mirrored, non-uniform 2,1) plotted with pattern spacing/angle distorted by the full insert transform? | 06 §1.6.1; 07 §2.4, §17; 11a §11 (06:H13, 07:5, 11a:19) | `blocks/nonuniform-*`, `blocks/nonuniform-hatch`, `hatches/insert-ansi31-s1`, `hatches/insert-ansi31-s2` (+8 more) | open |
| Q-0360 | hatches | [A] What is the default value of HPMAXLINES in current AutoCAD (assumed 1,000,000)? | 06 §1.6.3 | plan: hatches (lisp) — LISP (getvar "HPMAXLINES") on fresh profile | open |
| Q-0361 | hatches | [U] At what density does PLOT switch a pattern hatch to solid or drop lines (HPMAXLINES criterion), and does it match the on-screen behaviour? | 06 §1.6.3, §9 item 9; 08 §5.6; 11a §11, Open conflicts (06:H11, 11a:21) | `hatches/dense-count-*`, `hatches/dense-count-30000`, `hatches/dense-count-60000`, `hatches/dense-count-80000` (+5 more) | answered: > 100 000 total lines plot nothing (06 §1.6.3) |
| Q-0362 | hatches | [U] What interpolation does PLOT use for each of the 9 gradient names with 1/2 colors, shift 0/0.5/1, tint and angle 0/30/45? | 06 §1.7, §9 item 9; 11a §11 (06:G1) | `hatches/gradient-linear-shift0-a0`, `hatches/gradient-linear-shift0-a45`, `hatches/gradient-linear-shift1-a0`, `hatches/gradient-linear-shift1-a45` (+39 more) | partly: HEMISPHERICAL model (06 §1.7.1) |
| Q-0363 | hatches | [C] Does AutoCAD write the computed second color for single-color gradients (452=1), and how does 462 tint derive it? | 06 §1.7, §9 item 9 (06:G2) | `hatches/gradient-onecolor-tint0`, `hatches/gradient-onecolor-tint0p25`, `hatches/gradient-onecolor-tint0p5`, `hatches/gradient-onecolor-tint0p75` (+2 more) | answered |
| Q-0364 | hatches | [U] Does AutoCAD interpolate gradient colors in sRGB or another color space? | 06 §1.7 (06:G1) | `hatches/gradient-colorspace-red-green`, `hatches/gradient-colorspace-blue-yellow` | answered |
| Q-0365 | hatches | [U] Is the gradient normalized to the hatch extents in OCS or to the extents rotated by 460? | 06 §1.7 (06:G1) | `hatches/gradient-extents-a0`, `hatches/gradient-extents-a30`, `hatches/gradient-extents-a90`, `hatches/gradient-extents-rotated-boundary` | answered |
| Q-0366 | hatches | [U] Does the PNG plot of a gradient hatch show banding or dithering (how many distinct steps)? | 06 §1.7 (06:G1) | `hatches/gradient-extents-a0`, `hatches/gradient-extents-a30`, `hatches/gradient-extents-a90` | answered |
| Q-0367 | hatches | [T] Does PLOT draw the MPOLYGON boundary, ignore hatch style 75, and fill with 63 for loops with holes? | 06 §1.12, §0 item 2 (06:H14) | `hatches/mpolygon-solid-holes`, `hatches/mpolygon-pattern`, `hatches/mpolygon-truecolor` | open |
| Q-0368 | hatches | [A] What does MPOLYGON code 11 (offset vector) do to plotted paths/pattern? | 06 §1.12 (06:H14) | `hatches/mpolygon-offset-0-0`, `hatches/mpolygon-offset-5-5` | corpus evidence only (06 §1.12) |
| Q-0369 | hatches | [A] Does AutoCAD reject an MPOLYGON carrying group 63, and is R2000 MPOLYGON fill BYLAYER? | 11a §7 | `fileformat/mpolygon-r2000-with-63`, `fileformat/mpolygon-r2000-without-63`, `fileformat/mpolygon-r2004-with-63`, `fileformat/mpolygon-r2004-without-63` | open |
| Q-0370 | hatches | [A] Does AutoCAD (DXF, not DWG) flag and de-associate a HATCH with 71=1 whose 330 boundary handle names a non-existent entity, and does it still plot? | 11c §7 (hatch associativity; DXF equivalent is an ASSUMPTION) | `fileformat/hatch-assoc-dangling` | open |
| Q-0372 | hatches | [A] Does AutoCAD reject or misread an R2018 HATCH without group 210 (extrusion)? | 11a §11 | `fileformat/hatch-no-extrusion` | open |
| Q-0373 | hatches | [T] Is HATCH spline-edge group 97 required/forbidden for R2004, R2013, R2018, with and without fit points? | 11a §11 (11a:3) | `fileformat/hatch-spline-r2004-with-97`, `fileformat/hatch-spline-r2004-without-97`, `fileformat/hatch-spline-r2007-with-97`, `fileformat/hatch-spline-r2007-without-97` (+8 more) | open |

Answers (VERIFIED-BY-ACAD, AutoCAD 2027, 2026-09-30):
- Q-0345: One polygon through the start points of all 8 edges in order (the two rectangles joined by straight lines), filled even-odd (`hatches/one-loop-two-rects`, note 06 §1.3.5).
- Q-0348: Any gap (1e-6 … 1) is bridged by a straight line to the next edge's start; edges are never reordered or reversed (`hatches/edges-gap-*`, `edges-shuffled*`, `edges-reversed-one`).
- Q-0346: Selected by flags only (0: all loops, 1: external+outermost, 2: external), filled even-odd; with no external flag styles 1/2 plot nothing — no geometric fallback (`hatches/nested-*`).
- Q-0363: The stored second 421 colour is plotted; the tint is not recomputed (`hatches/gradient-onecolor-*`, note 06 §1.7.1).
- Q-0364: sRGB, per channel linear (`hatches/gradient-colorspace-*`).
- Q-0365: To the region's extent projected on the gradient direction (exact at 0°/45°/90°; 30° is bent by AutoCAD's shading mesh) (`hatches/gradient-extents-*`).
- Q-0366: Ordered-dither-like pattern: iso-lines step by 1 px every 40 rows in a 160-row cycle; 256 levels, no banding beyond 8-bit (`hatches/gradient-extents-*`).
- Q-0367/Q-0368: not answerable with the harness — accoreconsole plots MPOLYGON as an empty proxy (AcMPolygonObj26.dbx not loaded).
- Q-0349: It fills as if closed but the open path has n−1 segments, so the last vertex is dropped (`hatches/poly-open-u-shape`).

<a id="text"></a>
## TEXT (`text`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0374 | text | [U] Does AutoCAD keep leading/trailing spaces and space-only values in TEXT content (rendered position/width and DXFOUT value)? | 01 §1.3, §10 item 2 (01:T4) | `text/spaces-left-*`, `text/spaces-center-*`, `text/spaces-right-*` | open |
| Q-0375 | text | [U] How does AutoCAD render caret codes ^@, ^B, ^\, ^], ^^, ^_ and '^ ' in TEXT and MTEXT (ezdxf#198 notes deviations)? | 01 §1.5, §10 item 13 (01:T7) | `text/caret-codes`, `text/caret-nul`, `text/caret-controls`, `text/caret-codes-mtext` (+1 more) | open |
| Q-0376 | text | [C] Does AutoCAD decode lowercase caret codes ('^a' as '!' per ezdxf formula) and a trailing lone '^', or refuse them? | 01 §1.5, §10 item 13 (01:T7) | `text/caret-lowercase`, `text/caret-lowercase-mtext`, `text/caret-trailing` | open |
| Q-0377 | text | [T] Does AutoCAD refuse a TEXT value containing a lone raw CR (no LF), as it does for a raw CR/LF? | 11c §3 (raw CR/LF in TEXT refused), §18 #6 | `fileformat/text-raw-lone-cr`, `fileformat/text-raw-raw-lf`, `fileformat/text-raw-raw-crlf` | open |
| Q-0378 | text | [T] Does AutoCAD accept a TEXT whose group 1 holds 251–300 characters unsplit, and does it keep or truncate the string on DXFOUT? | 11c §3 strings over 250 chars, §6 (TEXT > 256 chars allowed, REPORTED), §18 #6 | `fileformat/long-text-251-r2018`, `fileformat/long-text-300-r2018` | open |
| Q-0379 | text | [T] Does AutoCAD render MTEXT codes in TEXT literally (\P, \~ not interpreted)? | 04 §1.6 (04:T5) | `text/mtext-codes`, `text/mtext-codes-2` | open |
| Q-0380 | text | [U] %%nnn code space: how are %%065, %%1, %%300 and 1-2 digit forms rendered (TTF and SHX)? | 04 §1.6, §8 item 13 (04:T5) | `text/nnn-codes`, `text/nnn-latin1`, `text/nnn-short` | open |
| Q-0381 | text | [A] Non-Unicode SHX: is %%nnn drawn as shape number nnn (raw byte)? | 04 §1.6 (04:T5) | plan: acad-default-fonts (png) — TEXT '%%176%%065%%248' vs raw bytes in txt.shx/simplex.shx, R2004 ANSI_1252 | open |
| Q-0382 | text | [U] TEXT '%%' followed by an unknown letter (e.g. %%x): rendered literally or dropped? | 04 §1.6, §8 item 13 (04:T5) | `text/unknown-pct`, `text/unknown-pct-trailing` | open |
| Q-0383 | text | [A] Does %%u underline run to the next %%u or end of line in TEXT, and are %%c %%d %%p %%% rendered as expected? | 11a §2 (11a:10) | `attribs/special-codes-attrib`, `text/special-cdp`, `text/special-cdp-upper`, `text/special-cdp-vs-unicode` (+1 more) | open |
| Q-0384 | text | [U] TEXT %%u/%%o/%%k: where are underline/overline/strike lines placed (offset from baseline/cap) and how thick/long? | 04 §1.6, §7 item 5, §8 item 6 (04:T5) | `text/special-u-toggle`, `text/special-u-large`, `text/special-o-large`, `text/special-k-large` (+3 more) | open |
| Q-0385 | text | [U] Unicode SHX (e.g. isocp.shx): does %%c render the glyph of U+00D8, U+2205, or shape 258? | 04 §1.6, §4.4, §4.5, §8 item 13 (04:T5) | `acad-default-fonts/special-txt`, `acad-default-fonts/special-simplex`, `acad-default-fonts/special-romans`, `acad-default-fonts/special-isocp` (+1 more) | open |
| Q-0386 | text | [A] Does a TEXT without group 7 use style 'Standard' rather than $TEXTSTYLE? | 01 §7.2 | `text/no-style-group` | open |
| Q-0387 | text | [U] Does AutoCAD open TEXT/MTEXT with an undefined style name (error, repair, or render as Standard), and what if the STYLE table lacks 'Standard'? | 02 §4.2 rule 5; 04 §4.1 item 7; 11a §4 (04:T7) | `text/undefined-style`, `text/no-standard-style` | open |
| Q-0388 | text | [A] Does AutoCAD reject a TEXT whose group 7 (style name) is written in the AcDbEntity subclass instead of AcDbText? | 11c §3 (TEXT 7 subclass, REPORTED by mozman) | `fileformat/text-style-in-acdbentity` | open |
| Q-0389 | text | [U] On OPEN of DXF TEXT with a non-left alignment whose 10 is inconsistent with 11, does PLOT (no edit) place it from 11 or at the stale 10? | 04 §1.3, §8 item 12; 11a §8 (04:T2, 11a:6) | `text/stale10-far`, `text/stale10-near`, `text/stale10-correct`, `text/stale10-right-near` | open |
| Q-0390 | text | [A] TEXT with 72/73 != 0 but group 11 missing: does AutoCAD place the text using 10 as the alignment point? | 04 §1.3 | `text/missing11-center`, `text/missing11-top-right`, `text/missing11-middle` | open |
| Q-0391 | text | [A] With 72=3/4/5 and a nonzero 73, does AutoCAD ignore 73 (and do invalid 72/73 combos fall back to LEFT)? | 04 §1.1 (04:T1) | `text/combo-72-3-73-1`, `text/combo-72-3-73-2`, `text/combo-72-3-73-3`, `text/combo-72-4-73-1` (+8 more) | open |
| Q-0392 | text | [U] Where does TEXT Middle (72=4) anchor vertically for SHX and TTF: ink-box centre or cap/cell centre, and does it equal MIDDLE_CENTER (72=1/73=2)? | 04 §1.4 item 3; 11a §8; 11b §10, Test ideas; 11c §15 item 10 (middle/centre alignment UNKNOWN), §18 #25 (04:T1, 11a:6, 11b:5) | `text/align-middle-r000`, `text/align-middle-center-r000`, `text/align-middle-r030`, `text/align-middle-center-r030` (+11 more) | open |
| Q-0393 | text | [U] What sets the gap below the baseline for TEXT Bottom (73=1): font descent (hhea or OS/2 winDescent for TTF) or a fixed fraction of height? | 04 §1.4 item 2, §0 item 2; 11a §8, Open conflicts (04:T1, 11a:6) | `text/align-bottom-left-r000`, `text/align-bottom-center-r000`, `text/align-bottom-right-r000`, `text/align-bottom-left-r030` (+12 more) | open |
| Q-0394 | text | [U] For TEXT Center/Right/Middle in SHX (and TTF), is the horizontal box the ink extent, the advance width, or advance minus trailing pen-up gap? | 04 §0 item 7, §1.4 item 4, §4.4, §7 item 2, §8 item 2; 11b §10, Test ideas (04:T1, 11b:5) | `acad-default-fonts/align-center-txt`, `acad-default-fonts/align-right-txt`, `acad-default-fonts/align-middle-txt`, `acad-default-fonts/align-center-simplex` (+8 more) | open |
| Q-0395 | text | [A] FIT/ALIGNED TEXT with coincident 10/11 (width 0): does AutoCAD render it like LEFT at 10 with natural width? | 04 §1.3 (04:T3) | `text/fit-coincident`, `text/aligned-coincident` | open |
| Q-0396 | text | [U] What width formula does FIT/ALIGNED TTF TEXT use: stretch the advance/union box (ink starting at lsb*scale after p1) or the glyph ink box? | 04 §1.4 item 5; 11a §8, Open conflicts (04:T3, 11a:6) | `text/align-aligned-r000`, `text/align-fit-r000`, `text/align-aligned-r030`, `text/align-fit-r030` (+18 more) | open |
| Q-0397 | text | [U] SHX FIT/ALIGNED TEXT: is the stretched width the ink extent or the pen advance of the string? | 04 §8 item 2 (04:T3) | `acad-default-fonts/align-aligned-txt`, `acad-default-fonts/align-fit-txt`, `acad-default-fonts/align-aligned-simplex`, `acad-default-fonts/align-fit-simplex` | open |
| Q-0398 | text | [A] Do TEXT 71 flags 2/4/6 (backward/upside-down) mirror about the alignment anchor (10/11) or the text box, for each 72/73 alignment? | 04 §1.5 step 4; 11c §6 (TEXT 71 generation flags), §18 #15 (04:T3) | `text/fitflags-fit-f0-pz`, `text/fitflags-fit-f0-nz`, `text/fitflags-fit-f2-pz`, `text/fitflags-fit-f2-nz` (+32 more) | open |
| Q-0399 | text | [T] What exactly does BACKWARD (71=2) do for FIT/ALIGNED TEXT, and with extrusion -Z? | 11a §8 (11a:7) | `text/fitflags-fit-f0-pz`, `text/fitflags-fit-f0-nz`, `text/fitflags-fit-f2-pz`, `text/fitflags-fit-f2-nz` (+12 more) | open |
| Q-0400 | text | [U] Vertical text (STYLE flag 4, SHX modes=2): how do justifications (incl. FIT/ALIGNED) position the stacked characters? | 04 §1.4 item 6, §4.4, §4.6, §8 item 18 (04:T23) | `acad-default-fonts/vertical-baseline`, `acad-default-fonts/vertical-bottom`, `acad-default-fonts/vertical-middle`, `acad-default-fonts/vertical-top` (+1 more) | open |
| Q-0401 | text | [U] TEXT oblique + width factor: is the transform shear-then-scale x'=w(x+y tan) or scale-then-shear x'=wx+y tan? | 04 §0 item 7, §1.5 step 2, §4.5, §8 item 7 (04:T4) | `text/oblique-width-*`, `text/oblique-width-center` | open |
| Q-0402 | text | [A] Does AutoCAD refuse or repair a TEXT with width factor 41 = 0, and how does it draw it? | 11c §6 (41 = 0 invalid, libredwg#275 REPORTED) | `fileformat/text-width-zero` | open |
| Q-0403 | text | [T] With width factor 0.5 and 2.0, does AutoCAD scale SHX arc segments into true ellipses (txt.shx, romans.shx)? | 11c §6 (width factor scales arcs into ellipses), §15 item 10, §18 #24 | `acad-default-fonts/widthfactor-txt-0p5`, `acad-default-fonts/widthfactor-txt-1`, `acad-default-fonts/widthfactor-txt-2`, `acad-default-fonts/widthfactor-romans-0p5` (+2 more) | open |
| Q-0404 | text | [A] Are TEXT (SHX and TTF) and MTEXT glyphs in a non-uniformly scaled or sheared block affinely distorted in PLOT? | 07 §2.4 (07:3) | `blocks/nonuniform-*`, `blocks/nonuniform-text`, `blocks/nonuniform-text-nested-rot` | open |
| Q-0405 | text | [U] Do TEXT and SHAPE with thickness plot as extruded glyphs (SHX only) in a 3D view, and what happens with TrueType text? | 03 §2.6 | `acad-default-fonts/thickness-text-shape-iso` | open |
| Q-0406 | text | [U] What does PLOT draw for TEXT/ATTRIB with height 40=0: the STYLE fixed height, $TEXTSIZE, a dot, or nothing? | 04 §1.5; 11a §8, Open conflicts (04:T7, 11a:33) | `attribs/height0-attrib`, `text/height0-style0`, `text/height0-style15`, `text/height0-textsize12` | open |
| Q-0407 | text | [U] Does PLOT honour $QTEXTMODE=1, drawing TEXT/MTEXT/ATTRIB as bounding rectangles, and exactly which rectangle? | 01 §7.2; 04 §4.5, §8 item 17 (01:T23) | `attribs/qtextmode-0`, `attribs/qtextmode-1`, `text/qtextmode-0`, `text/qtextmode-1` | open |
| Q-0408 | text | [U] Is an annotative entity's own (base) geometry always the representation of the annotation scale current at save time? | 02 §3.18 (02:T17) | plan: text (dxfout) — Annotative TEXT with scales 1:1 and 1:2, saved with CANNOSCALE 1:2; DXFOUT and compare base vs context data | open |
| Q-0409 | text | [U] Does PLOT show a FIELD's cached text or re-evaluate it (date, filename, ViewScale), and does FIELDEVAL bit 16 change that? | 02 §3.21, §6; 11b §10 | plan: text (png) — MTEXT with filename/date/ViewScale FIELD whose cached text is 'STALE'; FIELDEVAL 31 vs 0 | open |

<a id="mtext"></a>
## MTEXT (`mtext`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0410 | mtext | [A] MTEXT with group 1 before the 3 chunks (libredwg order): does AutoCAD open it and in what order are chunks joined? | 04 §3.2 (04:T19) | `fileformat/mtext-group1-before-3` | open |
| Q-0411 | mtext | [C] Does AutoCAD DXFOUT ever write MTEXT group 50 (ixmilia: never, libredwg: yes)? | 04 §3.6.3 (04:T18) | `fileformat/mtext-rotated-r2000`, `fileformat/mtext-rotated-r2018` | open |
| Q-0412 | mtext | [U] How does AutoCAD accept and render raw TAB, LF and CR bytes in TEXT/MTEXT values (TAB vs ^I; line break, space or dropped)? | 11b §3; 01 §1.3 (11b:6) | `mtext/break-backslash-p-tab`, `mtext/break-literal-tab` | open |
| Q-0413 | mtext | [U] Does caret ^J in MTEXT content act as a paragraph break like \P (rendering and stored 42/43) and ^I as a tab; is TEXT ^J/^M drawn as '?'? | 04 §3.6.1, §3.6.3; 11a §2; 11c §5 (MTEXT ^J mapped to \P by netDxf), §17 netDxf#65 test.dxf (04:T10, 11a:10) | `mtext/break-caret-j`, `mtext/break-backslash-p-tab`, `mtext/break-caret-j-lines`, `mtext/break-caret-i-tab` (+2 more) | open |
| Q-0414 | mtext | [U] When MTEXT group 3/1 chunk boundaries split a \U+XXXX escape, a \S...; stack, \P or a UTF-8 multibyte char, is content joined before decoding? | 04 §3.2, §3.6.3; 11b §10, Test ideas; 11c §3 (chunks can split \U+), §18 #6; 01 §1.5, §5.3 (04:T19, 11b:6, 01:T8) | `mtext/chunk-unicode`, `mtext/chunk-stack`, `mtext/chunk-paragraph`, `mtext/chunk-font` (+3 more) | open |
| Q-0415 | mtext | [T] Invalid inline codes (\C+5, \H1..5, \AX, unbalanced }, unknown \J): rendered as ezdxf observed (printed verbatim)? | 04 §3.3 (04:T14) | `mtext/code-height-no-terminator`, `mtext/code-invalid-codes`, `mtext/code-unbalanced-open`, `mtext/stack-unterminated` | open |
| Q-0416 | mtext | [U] Do %%nnn and %%u/%%o/%%k work in MTEXT (as in TEXT)? | 04 §3.3 (04:T14) | `mtext/code-percent-extra` | open |
| Q-0417 | mtext | [C] MTEXT \c true colour: is n = R + 256G + 65536B (ezdxf) or 0xRRGGBB (mlightcad)? | 04 §3.3, §6.3 (04:T14) | `mtext/color-truecolor`, `mtext/color-truecolor-large` | open |
| Q-0418 | mtext | [T] MTEXT \fName,bigfont; with a ',bigfont' suffix: does AutoCAD select the bigfont, and does a missing \f font fall back to FONTALT? | 04 §3.3 (04:T14) | `acad-default-fonts/mtext-f-missing`, `acad-default-fonts/mtext-f-shx-bigfont` | open |
| Q-0419 | mtext | [U] Inside MTEXT \S, is '^' followed by a non-space ('\S5^6;') still the tolerance stack divider, or read as a caret control code? | 01 §1.5; 04 §3.6.3 (04:T13) | `mtext/stack-tol-signs-nospace`, `mtext/stack-caret-nospace`, `mtext/stack-caret-space`, `mtext/stack-caret-vs-slash` (+1 more) | open |
| Q-0420 | mtext | [U] How are stack position (TSTACKALIGN top/center/bottom) and 'decimal' stack style encoded in MTEXT content or elsewhere? | 04 §3.4, §8 item 1 (04:T13) | plan: mtext (dxfout) — create stacks via AutoCAD with TSTACKALIGN 0/1/2 and decimal style, DXFOUT and inspect | open |
| Q-0421 | mtext | [U] Horizontal-bar stack \S1/2;: part sizes, vertical gap, bar y position, bar length and thickness? | 04 §0 item 7, §3.4, §8 item 1 (04:T13) | `mtext/stack-frac-bare`, `mtext/stack-frac-70`, `mtext/stack-frac-long`, `mtext/stack-frac-long-70` | open |
| Q-0422 | mtext | [U] Diagonal stack \S1#2;: placement of parts and slash geometry (endpoints, angle, width)? | 04 §3.4, §8 item 1 (04:T13) | `mtext/stack-diag-bare`, `mtext/stack-diag-70`, `mtext/stack-diag-long`, `mtext/stack-diag-long-70` | open |
| Q-0423 | mtext | [U] Tolerance stack \S1^ 2; (and \S+0.1^-0.2;): part positions, gap and alignment without bar? | 04 §3.4, §8 item 1 (04:T13) | `mtext/stack-tol-bare`, `mtext/stack-tol-70`, `mtext/stack-tol-signs`, `mtext/stack-tol-signs-nospace` (+1 more) | open |
| Q-0424 | mtext | [U] Bare \S1/2; without \H0.7x wrapper: are parts at full current height or implicitly scaled (e.g. 70%)? | 04 §3.4, §6.1 (04:T13) | `mtext/stack-frac-bare`, `mtext/stack-frac-70` | open |
| Q-0425 | mtext | [U] Where do MTEXT stacks (\S1/2; \S3#4; \S5^6;) sit relative to the baseline, and how do \A0/1/2 and a {\H0.7x;} wrapper shift them? | 04 §3.4, §8 item 1; 11a §9 (04:T13, 11a:15) | `mtext/stack-baseline-bare`, `mtext/stack-baseline-70`, `mtext/stack-baseline-a0`, `mtext/stack-baseline-a1` (+2 more) | open |
| Q-0426 | mtext | [C] MTEXT \A default (bottom per ezdxf vs center per netDxf) and exact placement of mixed-height runs with \A0/1/2? | 04 §8 item 9 (04:T13) | `mtext/code-align-none`, `mtext/code-align-0`, `mtext/code-align-1`, `mtext/code-align-2` (+4 more) | open |
| Q-0427 | mtext | [U] MTEXT oblique (\Q / style 50) + width factor (\W / style 41): which order of shear and x-scale does AutoCAD apply? | 04 §1.5 step 2, §8 item 7 (04:T14) | `mtext/code-oblique-width-order` | open |
| Q-0428 | mtext | [A] Does MTEXT inherit the STYLE oblique angle (50) as well as the width factor when no \Q/\W is present? | 11a §9 (11a:16) | `mtext/code-style-width-oblique`, `mtext/code-style-width-override`, `mtext/code-style-width-rel` | open |
| Q-0429 | mtext | [C] MTEXT \T tracking: is \T0.1x/\T2; a multiplier of char spacing or +1 offset (mlightcad) and how applied? | 04 §3.6.2, §8 item 7 (04:T14) | `mtext/code-tracking`, `mtext/code-tracking-rel` | open |
| Q-0430 | mtext | [U] MTEXT \L/\O/\K: offsets, thickness and length of underline/overline/strike-through lines? | 04 §3.6.2, §8 item 6 (04:T14) | `mtext/code-underline-over-strike`, `mtext/code-underline-all` | open |
| Q-0431 | mtext | [U] Do underline/overline/strike lines span spaces and tabs (TEXT %%u and MTEXT \L)? | 04 §3.3, §8 item 6 (04:T5, 04:T14) | `mtext/code-underline-spaces`, `mtext/code-underline-trailing`, `mtext/code-underline-leading`, `mtext/code-underline-wrap` (+2 more) | open |
| Q-0432 | mtext | [T] How does AutoCAD render inline \S1^ 2;, \S1/2;, \S1#2;, \c16711680;, ^I, \A1; and %%u/%%o in MTEXT? | 11b §10, Test ideas (11b:6) | `mtext/break-caret-i-tab`, `mtext/code-underline-over-strike`, `mtext/code-align-1`, `mtext/code-percent-extra` (+4 more) | open |
| Q-0433 | mtext | [U] MTEXT paragraph codes \pb/\pa (spacing before/after) and \psm/\pse/\psa: units and exact semantics? | 04 §3.5, §8 item 5 (04:T15) | `mtext/para-spacing-ref`, `mtext/para-spacing-before-after`, `mtext/para-spacing-xsm2`, `mtext/para-spacing-se15` (+3 more) | open |
| Q-0434 | mtext | [U] Are \p paragraph properties scoped by { } (popped at }) or persistent until changed? | 04 §3.5 (04:T15) | `mtext/para-scope`, `mtext/para-scope-mid` | open |
| Q-0435 | mtext | [C] Are MTEXT \p indent/left/right/tab values (\pi, \pl, \pr, \pt) multiples of char height 40 or absolute drawing units (ezdxf#1390)? | 04 §3.6.2, §8 item 19; 11a §9, Open conflicts (04:T15, 11a:13) | `mtext/para-indent-h1`, `mtext/para-indent-h10`, `mtext/para-indent-h480`, `mtext/para-indent-absolute-tangent` (+3 more) | open |
| Q-0436 | mtext | [U] MTEXT explicit tab stops \pxt with c/r (and decimal) prefixes: how is text aligned at each stop? | 04 §3.5, §8 item 19 (04:T12) | `mtext/tabs-explicit`, `mtext/tabs-decimal` | open |
| Q-0437 | mtext | [A] Are default MTEXT tab stops every 4 x cap height? | 11a §9 | `mtext/tabs-default-h25`, `mtext/tabs-default-h50`, `mtext/tabs-tab-in-wrap` | open |
| Q-0438 | mtext | [U] MTEXT justified (\pxqj) last line and distributed (\pxqd) alignment: how are spaces/characters stretched? | 04 §3.6.2, §8 item 20 (04:T15) | `mtext/para-align-l`, `mtext/para-align-r`, `mtext/para-align-c`, `mtext/para-align-j` (+2 more) | open |
| Q-0439 | mtext | [A] Does MTEXT word wrap break only at spaces (not '-'/'_'), collapse spaces at breaks, keep first-line leading spaces, and let overlong words overflow? | 04 §3.6.2; 11a §9 (04:T12, 11a:12) | `mtext/wrap-width-*`, `mtext/wrap-boundary-hyphen-below`, `mtext/wrap-boundary-word1-below`, `mtext/wrap-boundary-word1-above` (+15 more) | open |
| Q-0440 | mtext | [U] Does MTEXT wrap CJK text between any characters with kinsoku (no break before 。、」), and how does it wrap when width 41 < char height? | 04 §3.6.2, §8 item 20; 11a §9; 11b §10, Test ideas (04:T12, 11a:12, 11b:6) | plan: mtext (png) — MTEXT of 40 Chinese/Japanese chars with 。、「」 in SimSun at a narrow 41; one with 41 < 40 | open |
| Q-0441 | mtext | [U] R2018 single-entity MTEXT columns: where does AutoCAD break lines into columns and what count for dynamic auto height? | 04 §3.7, §8 item 10 (04:T17) | `mtext/columns-static-r2018`, `mtext/columns-dynamic-auto-r2018`, `mtext/columns-dynamic-manual-r2018`, `mtext/columns-dynamic-auto-r2018-overflow` (+1 more) | open |
| Q-0442 | mtext | [T] Pre-R2018 linked column MTEXTs: does AutoCAD wrap each column at the master's 48 width despite 41 holding total width? | 04 §3.7 (04:T17) | `mtext/columns-linked-r2013-colwidth`, `mtext/columns-linked-r2013-totalwidth`, `mtext/columns-dynamic-auto-r2013` | open |
| Q-0443 | mtext | [A] Is MTEXT line pitch 5/3 x cap height x 44, and how do 73=1 (at least) and 73=2 (exactly) differ across 44 values? | 11a §9; 11b §10, Test ideas (11a:14, 11b:6) | `mtext/spacing-atleast-025`, `mtext/spacing-atleast-060`, `mtext/spacing-atleast-080`, `mtext/spacing-atleast-100` (+16 more) | open |
| Q-0444 | mtext | [U] MTEXT 'at least' spacing: does the ascent push (ink above cap height) actually move glyphs in PLOT, not just stored 43? | 04 §3.6.1, §8 item 4 (04:T10) | `mtext/spacing-ascent-push-1`, `mtext/spacing-ascent-push-2` | open |
| Q-0445 | mtext | [A] 'At least' spacing with a larger \H on one line: does pitch grow using that line's larger cap height by the same rule? | 04 §3.6.2, §8 item 5 (04:T10) | `mtext/spacing-big-line-1`, `mtext/spacing-big-line-2` | open |
| Q-0446 | mtext | [U] MTEXT exact line spacing (73=2): what is the box/extent model (one sample gave 43=3.0 for 2 lines at h=1)? | 04 §0 item 7, §3.6.1, §8 item 5 (04:T10) | `mtext/spacing-atleast-025`, `mtext/spacing-atleast-060`, `mtext/spacing-atleast-080`, `mtext/spacing-atleast-100` (+16 more) | open |
| Q-0447 | mtext | [T] How does AutoCAD render MTEXT with 72/73/44 omitted vs explicitly 0 (does 44 = 0 stack every line on the first)? | 11c §6 (MTEXT 72/73/44 defaults 1), §18 #15, §17 netDxf#467 0e.dxf | `mtext/spacing-defaults-omitted`, `mtext/spacing-defaults-explicit-defaults`, `mtext/spacing-defaults-flow-0`, `mtext/spacing-defaults-style-0` (+1 more) | open |
| Q-0448 | mtext | [U] For MTEXT attachments 4-9, is middle/bottom measured from cap or x-height top, last baseline, descender, or glyph ink (single and multi-line)? | 04 §3.6.2, §7 item 5, §8 item 4; 05 §0 item 5, §5.3, §15; 11a §9 (04:T11, 05:T7, 11a:14) | `mtext/attach-1-xg`, `mtext/attach-2-xg`, `mtext/attach-3-xg`, `mtext/attach-4-xg` (+27 more) | open |
| Q-0449 | mtext | [U] How does MTEXT attachment 71=1..9 place text horizontally with 41=0 (longest line; ink or advance?) and align lines within [0,41] when 41>0? | 04 §3.6.2, §8 item 4; 11b §10, Test ideas (04:T11, 11b:6) | `mtext/attach-1-xg`, `mtext/attach-2-xg`, `mtext/attach-3-xg`, `mtext/attach-4-xg` (+30 more) | open |
| Q-0450 | mtext | [C] MTEXT group 50 on DXF input: radians (spec) or degrees (ezdxf)? | 04 §3.1, §3.6.3 (04:T18) | `mtext/rot-50-only`, `mtext/rot-11-only` | open |
| Q-0451 | mtext | [C] When MTEXT has both 11/21 text direction and 50 rotation that disagree, which wins: 11 always, or whichever comes last in the file? | 04 §3.1, §3.6.3; 11a §9; 11b §10, Test ideas (04:T18, 11b:6) | `mtext/rot-11-unnormalized`, `mtext/rot-both-ezdxf`, `mtext/rot-both-11-first`, `mtext/rot-both-50-first` | open |
| Q-0452 | mtext | [U] MTEXT flow direction 72=3 (top to bottom) / vertical MTEXT: how is it rendered? | 04 §3.6.2, §8 item 18 | `mtext/flow-direction-3` | open |
| Q-0453 | mtext | [U] What does AutoCAD plot for MTEXT with char height 40=0 (fallback height, TEXTSIZE, nothing), incl. with tabs? | 11a §9, Test ideas (11a:33) | `mtext/height-zero` | open |
| Q-0454 | mtext | [U] Does $FILLMODE=0 suppress the MTEXT background mask (and WIPEOUT fill) in PLOT? | 01 §7.2 (01:T23) | `mtext/bg-fillmode-0`, `mtext/bg-fillmode-1` | open |
| Q-0455 | mtext | [A] Does MTEXT background fill plot as an opaque rectangle masking earlier entities, and what colour do 90=2/3 (window/canvas colour) fill with? | 04 §3.1, §8 item 8; 06 §8.3 (06:D4, 04:T16) | `mtext/bg-fill-aci`, `mtext/bg-fill-window`, `mtext/bg-fill-canvas`, `mtext/bg-frame-only` (+2 more) | open |
| Q-0456 | mtext | [U] What is the MTEXT background mask box: horizontal extent (41 or text extents, and with 41=0), and is the margin (45-1)*h on all four sides? | 04 §3.1, §8 item 8; 11b §10 (04:T16) | `mtext/bg-scale-10-w0`, `mtext/bg-scale-10-w150`, `mtext/bg-scale-15-w0`, `mtext/bg-scale-15-w150` (+5 more) | open |
| Q-0457 | mtext | [U] What does the MTEXT text frame (90 bit 16, e.g. 90=17) plot: offset, box basis, colour and lineweight? | 04 §3.1, §8 item 8; 11a §9 (04:T16) | `mtext/bg-fill-aci`, `mtext/bg-fill-window`, `mtext/bg-fill-canvas`, `mtext/bg-frame-only` (+4 more) | open |
| Q-0458 | mtext | [U] Pre-R2018 MTEXT text frame LWPOLYLINE referenced by ACAD_MTEXT_TEXT_BORDERS: does AutoCAD draw it (in addition to the frame)? | 04 §3.1, §8 item 8 (04:T16) | `mtext/bg-frame-r2013-xdata`, `mtext/bg-frame-r2013-no-xdata` | open |

<a id="fonts"></a>
## Fonts (`fonts`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0736 | fonts | [U] Why does empty group 3 with ACAD family 宋体 and flags 0 plot native FD as SHX: charset, localized family, or substitution before the harness sets FONTALT? | 04 §15 | `font-resolution/empty-*`, `file-simplex-song-*`, `arch-*-fd` | answered |
| Q-0737 | fonts | [U] What remaining curve/grid-fitting and SHX/GBCBIG raster rules explain the arch-cn fringes? Large upright SimSun string anchors are corrected; smaller/other orientations remain unverified. | 04 §15.3 | `font-resolution/arch-*-cjk*`; `font-metrics/simsun-*`, `gbcbig-*` (18 references analyzed) | open |
| Q-0459 | fonts | [C] Which bits of STYLE XDATA 1071 encode bold, italic, charset and pitch/family (LOGFONT packing: italic 0x01000000, bold 0x02000000? 34306=0x8602)? | 02 §2.3; 11a §4, Open conflicts; 11b §10, Test ideas (11b:8) | `fileformat/style-xdata-computed` | open |
| Q-0460 | fonts | [U] TTF family lacking bold/italic faces with XDATA bold/italic bits: does AutoCAD synthesise bold/italic, and how? | 04 §4.5 (04:T22) | `text/xdata-sans-bold`, `text/xdata-sans-italic`, `text/xdata-sans-bolditalic`, `text/xdata-mono-bold` (+4 more) | open |
| Q-0461 | fonts | [U] Does AutoCAD support OpenType (.otf) fonts in STYLE group 3 or XDATA family? | 04 §4.5 (04:T22) | plan: text (png) — STYLE group 3 'SourceCodePro.otf' (installed), TEXT 'ABC' | open |
| Q-0462 | fonts | [A] How does AutoCAD resolve STYLE group 3 names without extension, in other case or quoted ('txt', 'arial', 'SIMPLEX', 'ROMANS.SHX', '"romans.shx"'); .shx before .ttf? | 02 §2.3; 11a §4; 11c §6 (STYLE 'txt' without extension; quoted names, netDxf#227/#224), §13 | `acad-default-fonts/font-name-txt`, `acad-default-fonts/font-name-simplex-upper`, `acad-default-fonts/font-name-romans-shx-upper`, `acad-default-fonts/font-name-romans-quoted` (+3 more) | open |
| Q-0463 | fonts | [C] Which font replaces an unresolvable STYLE font in PLOT: FONTALT (set vs unset) for SHX; FONTALT or a Windows-substituted font for TTF (GUI vs console)? | 02 §2.3; 04 §4.1 item 4, §8 item 16; 11b §10, Test ideas (04:T22, 11b:8) | `acad-default-fonts/missing-font-shx`, `acad-default-fonts/missing-font-ttf`, `acad-default-fonts/mtext-f-missing` | open |
| Q-0464 | fonts | [U] Does accoreconsole print a message when it substitutes a missing SHX/TTF font via FONTALT? | 08 §6.2 (08:T-ACC-5) | `acad-default-fonts/missing-font-shx`, `acad-default-fonts/missing-font-ttf` | open |
| Q-0465 | fonts | [T] Does accoreconsole resolve SHX fonts from the drawing's folder as well as the support path? | 08 §6.2 (08:T-ACC-5) | plan: text (png) — needs test SHX: STYLE referencing a custom SHX placed only next to the DXF vs only in the support path | open |
| Q-0466 | fonts | [U] Missing bigfont in PLOT: does the whole TEXT vanish (core console TEXTBOX = 0) or render with a substitute? | 04 §0 item 6, §4.1 item 5, §8 item 15 (04:T21) | `acad-default-fonts/bigfont-missing` | open |
| Q-0467 | fonts | [U] Bigfont glyph height relative to the main SHX font when 'above' differs: each scaled by its own above? | 04 §0 item 7, §4.4, §8 item 15 (04:T21) | `acad-default-fonts/bigfont-txt-bigfont-r2018`, `acad-default-fonts/bigfont-romans-bigfont-r2018`, `acad-default-fonts/bigfont-txt-extfont-r2018`, `acad-default-fonts/bigfont-txt-chineset-r2018` (+2 more) | open |
| Q-0468 | fonts | [A] Does AutoCAD show CJK TEXT in a pre-2007 file as '?' with a non-bigfont SHX style, and correctly with romans.shx + chineset.shx? | 11c §6 (CJK TEXT needs bigfont, ACadSharp#432 REPORTED) | `acad-default-fonts/cjk-r2004-romans`, `acad-default-fonts/cjk-r2004-romans-chineset` | open |
| Q-0469 | fonts | [T] When a bigfont (gbcbig/hztxt) cannot encode U+2205, which glyph does PLOT draw for an auto-generated diameter dimension text? | 11b §3, §10, Test ideas (11b:8) | `acad-default-fonts/diameter-dim-bigfont-ez`, `acad-default-fonts/diameter-dim-bigfont-nb` | open |
| Q-0470 | fonts | [U] SHX code 4 (scale multiply): does the scale persist across characters or reset per glyph? | 04 §4.3 (04:T20) | plan: text (png) — needs test SHX: glyph using code 4 without matching code 3; TEXT of that glyph twice | open |
| Q-0471 | fonts | [C] SHX fractional arc (code 11) radius: hr*256 + r (ADSK) or hr*255 + r (ML/YF)? | 04 §4.3 (04:T20) | plan: text (png) — needs test SHX: glyph with code 11 fractional arc hr=1; TEXT at h=100 | open |
| Q-0472 | fonts | [U] SHX glyph ending with a nonzero y displacement: does the next glyph start at that y or back on the baseline? | 04 §4.4 (04:T20) | plan: text (png) — needs test SHX: glyph ending at (6,2); TEXT 'AAA' | open |
| Q-0473 | fonts | [C] Unifont code 7 subshape number: little-endian or big-endian 2-byte order? | 04 §4.3, §8 item 15 (04:T20) | `acad-default-fonts/subshape-code7` | open |
| Q-0474 | fonts | [A] SHX pen position: rounded to integer shape units after arcs (or all commands), before/after scale; is arc geometry adjusted? | 04 §0 item 6, §4.3, §8 item 3 (04:T20) | `acad-default-fonts/pen-rounding-9amp-txt`, `acad-default-fonts/charset-txt`, `acad-default-fonts/pen-rounding-9amp-simplex`, `acad-default-fonts/charset-simplex` (+2 more) | open |
| Q-0475 | fonts | [U] How does PLOT tessellate SHX arcs (fixed step, plot resolution, VIEWRES)? | 04 §0 item 7, §4.3, §8 item 3 (04:T20) | `acad-default-fonts/arc-tessellation-o-simplex`, `acad-default-fonts/arc-tessellation-o-simplex-zoom`, `acad-default-fonts/arc-tessellation-o-romans`, `acad-default-fonts/arc-tessellation-o-romans-zoom` | open |
| Q-0476 | fonts | [U] Missing glyph in an SHX font: does AutoCAD draw the font's own shape 63 '?' or something else? | 04 §4.4, §8 item 14 (04:T20) | `acad-default-fonts/missing-glyph-txt`, `acad-default-fonts/missing-glyph-simplex`, `acad-default-fonts/charset-txt`, `acad-default-fonts/charset-simplex` (+1 more) | open |
| Q-0477 | fonts | [U] Non-Unicode 'shapes' SHX: which code page maps text bytes/characters to shape numbers ($DWGCODEPAGE?) | 04 §4.4 (04:T20) | plan: acad-default-fonts (png) — R2004 DXF ANSI_1252 vs ANSI_1251 with bytes 0x80-0xFF in txt.shx TEXT | open |
| Q-0478 | fonts | [T] Non-Unicode SHX %%d/%%p/%%c: shapes 256/257/258 (ADSK) rather than 127/126/129 (mlightcad)? | 04 §4.4 (04:T20) | plan: acad-default-fonts (png) — TEXT '%%d%%p%%c' vs '\U+00B0' etc. in txt.shx and simplex.shx | open |
| Q-0479 | fonts | [U] SHX 'shapes 1.1' vs 'shapes 1.0' header: is there any layout difference? | 04 §4.2 | plan: none (none) | open |
| Q-0480 | fonts | [C] Bigfont header: is the first u16 unknown and the second the index count (majority) or the first the count (TZ)? | 04 §4.2 | plan: none (none) | open |
| Q-0481 | fonts | [A] Are fonts installed/registered mid-session found by AutoCAD (it enumerates the session's GDI fonts only)? | 04 §4.1 | plan: none (none) | open |
| Q-0482 | fonts | [U] How does SHAPE size 40 scale the shape relative to its SHX definition (defined height / 'above' value)? | 03 §3.16 | `acad-default-fonts/shape-size-1`, `acad-default-fonts/shape-size-10`, `acad-default-fonts/shape-size-25`, `acad-default-fonts/shape-rotation-30` (+4 more) | answered: one shape unit = size; 0 draws as 1; negative mirrors (07 §14) |
| Q-0483 | fonts | [C] Is SHAPE insertion point 10 in OCS like TEXT (e.g. with 210=0,0,-1), and do rotation/oblique/x-scale plot as for TEXT? | 07 §14; 03 §2.4, §3.16, Test ideas 4 (07:21, 03:T4) | `acad-default-fonts/shape-rotation-30`, `acad-default-fonts/shape-xscale-2`, `acad-default-fonts/shape-oblique-20`, `acad-default-fonts/shape-extrusion-neg-z` (+1 more) | answered: 10 is OCS; rotation/oblique/x-scale as TEXT, slant independent of x-scale (07 §14) |
| Q-0484 | fonts | [C] Is AutoCAD's TTF TEXT height the cap height of 'A' (ezdxf/QCAD rule) or derived from the font's em/ascent metrics? | n/a | `text/align-left-r000`, `text/align-center-r000`, `text/align-right-r000`, `text/align-aligned-r000` (+62 more) | open |
| Q-0485 | fonts | [U] TTF with no glyph 'A': what defines the height scale? | 04 §4.5 (04:T22) | plan: text (png) — STYLE with a TTF lacking 'A' (e.g. symbol font), TEXT h=100 | open |
| Q-0486 | fonts | [U] How does AutoCAD size CJK TTF glyphs (SimHei, KaiTi, FangSong, YaHei) relative to TEXT height: em-box fraction or OS/2 cap height? | 11a §8, Open conflicts (11a:8) | plan: text (png) — TEXT '中文H' at height 100 in SimSun, SimHei, KaiTi, FangSong, Microsoft YaHei, Arial | open |
| Q-0487 | fonts | [U] Which fallback font does AutoCAD use per script for glyphs missing from the TTF (e.g. Chinese, U+2205, Hebrew, Thai in Arial) in TEXT and MTEXT? | 04 §4.5, §8 item 14; 11a §8, Open conflicts (04:T22, 11a:9) | `text/fallback-diameter-text`, `text/fallback-diameter-mtext`, `text/fallback-cjk-text`, `text/fallback-cjk-mtext` (+6 more) | open |
| Q-0488 | fonts | [U] Does AutoCAD PLOT apply BiDi reordering (Hebrew/Arabic RTL), Arabic joining and Thai mark placement to TTF TEXT and MTEXT? | 04 §3.6.2; 11a §8 (11a:9) | `text/fallback-hebrew-text`, `text/fallback-hebrew-mtext`, `text/fallback-thai-text`, `text/fallback-thai-mtext` (+4 more) | open |
| Q-0489 | fonts | [U] How many segments does PLOT use to flatten TTF outline curves at TEXTQLTY 0/50/100, and which setting reproduces the exact outlines? | 04 §4.5, §8 item 3; 08 §5.6, §7 item 8 (04:T24, 08:T-ACC-5) | plan: text (png) — Arial 'O' h=1000 with TEXTQLTY 0/50/100 set via LISP before plot, TEXTFILL 1 (and 0) | open |
| Q-0490 | fonts | [T] TEXTFILL=0: does PLOT draw TTF glyphs as outlines only, and with what lineweight? | 04 §4.5, §7 item 1, §8 item 17 (04:T24) | plan: text (png) — Arial 'O' h=1000, TEXTFILL 0 and 1, lineweight 0.5 | open |
| Q-0491 | fonts | [U] With lineweights plotted, is SHX TEXT stroked at the entity lineweight while TTF TEXT is fill-only and ignores lineweight? | 04 §4.4, §4.5 (04:T24) | `acad-default-fonts/lineweight-shx-vs-ttf-on`, `acad-default-fonts/lineweight-shx-vs-ttf-off`, `lineweights/text-lw`, `text/lineweight-000` (+2 more) | open |

Q-0736 (2026-10-03): English AutoCAD cannot resolve localized 宋体, with flags 0 or 34306;
SimSun resolves with either flag. XDATA wins over group 3 and binds simplex at DXF load;
changing FONTALT afterward does not replace it. Linked CJK TEXT uses SimSun, including the
intervening space (note 04 §15.1).

Q-0737 partial answer (2026-10-03): near/far AutoCAD pairs are identical; anchor masks step
on whole pixels. Large upright SimSun uses a shared snapped string origin plus separately
rounded outline offsets; keep the fractional em size (note 04 §15.3). The correction improves
all large controls/native labels; smaller controls retain their existing path. Curve/edge,
small-size grid fitting and SHX/GBCBIG residues remain open. No further probe batch is staged.

<a id="attribs"></a>
## ATTRIB / ATTDEF (`attribs`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0492 | attribs | [C] In PLOT, does $ATTMODE 0/1/2 hide all / honour ATTRIB flag 70 bit 1 / show all ATTRIBs, and are 70=1 ATTRIBs omitted at the default ATTMODE=1? | 01 §7.2; 04 §2.2, §8 item 11; 07 §4.2, §17; 11a §13; 11b §7, Test ideas (01:T25, 07:10, 04:T8, 11b:15, 11a:36) | `attribs/attmode-0`, `attribs/attmode-1`, `attribs/attmode-2`, `attribs/invisible-attrib-attmode1` | open |
| Q-0493 | attribs | [U] Do constant ATTDEFs drawn via an INSERT obey $ATTMODE (hidden at 0?) and, when also invisible (70=1\|2), honour the invisible flag at ATTMODE 1/2? | 04 §2.2, §8 item 11; 07 §4.1 (04:T8, 07:10) | `attribs/attmode-0`, `attribs/attmode-1`, `attribs/attmode-2` | open |
| Q-0494 | attribs | [C] In PLOT, does a constant ATTDEF in a block draw its default (group 1) per INSERT, a non-constant block ATTDEF draw nothing, and a loose ATTDEF draw its tag? | 04 §2.2, §8 item 11; 07 §0, §4.1, §17; 11b §7, Test ideas (07:10, 11b:15, 04:T8) | `attribs/attmode-0`, `attribs/attmode-1`, `attribs/attmode-2`, `attribs/const-attdef-two-inserts` (+10 more) | open |
| Q-0495 | attribs | [C] Are a MINSERT's ATTRIBs drawn in every row/column cell (offset by the cell spacing) or only once at cell (0,0)? | 04 §2.4, §8 item 11; 07 §2.3, §17 (04:T8, 07:6) | `attribs/minsert-2x2`, `attribs/minsert-3x2`, `attribs/minsert-2x2-rot30` | open |
| Q-0496 | attribs | [C] Does an ATTRIB's BYBLOCK color resolve against its INSERT or against the INSERT's parent? | 06 §7.1 (06:R4) | `attribs/props-nested-byblock` | open |
| Q-0497 | attribs | [A] With INSERT's layer OFF, are ATTRIBs on the INSERT layer or layer 0 hidden while ATTRIBs on a third layer still plot? | 07 §3.2 (07:8) | `attribs/layer-off-insert`, `attribs/layer-frozen-insert` | open |
| Q-0498 | attribs | [U] Why does AutoCAD display an ATTRIB with 72=0 and 74=2 as MiddleCenter, and how does 74 vs 73 set ATTRIB vertical alignment? | 11c §6 (netDxf#67 ATTRIB 72=0/74=2 MiddleCenter, UNKNOWN) | `attribs/align-bottom-left`, `attribs/align-middle-left`, `attribs/align-top-left`, `attribs/valign74-0` (+3 more) | open |
| Q-0499 | attribs | [A] ATTRIB with 101 Embedded Object but no multi-line type flag (71): is the embedded MTEXT rendered? | 04 §2.3 (04:T9) | `attribs/multiline-attrib-type1` | open |
| Q-0500 | attribs | [A] For an R2018 multi-line ATTRIB (71=2) whose group 1 differs from its embedded MTEXT, does PLOT show only the embedded MTEXT content? | 04 §2.3; 11a §13 (04:T9) | `attribs/multiline-attrib`, `attribs/multiline-attrib-stale-group1` | open |
| Q-0501 | attribs | [A] Does AutoCAD refuse or repair an INSERT with 66 1 not followed by ATTRIB/SEQEND, or with 66 set to 128? | 11c §3 (INSERT 66, libredwg#1351/#1352 REPORTED), §13 LibreDWG row | `fileformat/insert-66-no-attribs`, `fileformat/insert-66-flag-128` | open |
| Q-0502 | attribs | [T] Which ATTRIB/ATTDEF 280 layouts does AutoCAD accept: version+lock_position, lock_position only, reversed order? | 11a §13 (11a:5) | `fileformat/attrib-280-both-280`, `fileformat/attrib-280-lock-only`, `fileformat/attrib-280-swapped`, `fileformat/attrib-280-ezdxf` | open |
| Q-0503 | attribs | [A] For Fit/Aligned TEXT/ATTRIB (72=5/3), does AutoCAD recompute 41/height from alignment points or honour an inconsistent stored 41? | 11b §7, Test ideas (11b:5, 11b:15) | `attribs/fit-stale-width`, `text/fit-stale-width`, `text/aligned-stale-height` | open |

<a id="dimstyle"></a>
## DIMSTYLE (`dimstyle`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0504 | dimstyle | [A] Do header $DIM* values differing from the current DIMSTYLE (e.g. $DIMSCALE, $DIMASZ) show as <style overrides> and change plotted existing DIMENSIONs? | 01 §7.2; 11c §8 ($DIM* vs DIMSTYLE, netDxf#417 REPORTED) | `dimensions/header-vs-dimstyle-ez`, `dimensions/header-vs-dimstyle-nb` | open |
| Q-0505 | dimstyle | [C] For codes absent from a DIMSTYLE record, does regeneration use header $DIM* values or built-in defaults, and imperial (DIMASZ 0.18) or metric under $MEASUREMENT 1? | 02 §0 item 1, §2.6, §6; 05 §0 item 3, §2.1, §3, §15 conflict 2; 11c §8 (DIMSTYLE missing codes: ODA uses header, AutoCAD UNKNOWN) (02:T4, 05:T4) | `dimensions/sparse-dimstyle-measurement1`, `dimensions/sparse-dimstyle-measurement0`, `dimensions/sparse-dimstyle-standard` | answered: imperial built-in defaults (sparse-dimstyle-*, note 05 §17) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0506 | dimstyle | [A] What values does AutoCAD assume for DIMSTYLE codes absent from the record that ISO-25 never overrides (DIMFXL, DIMJOGANG, DIMTFILL, DIMADEC, DIMAZIN...)? | 02 §2.6, §6 (02:T4) | `dimensions/sparse-dimstyle-measurement1`, `dimensions/sparse-dimstyle-measurement0`, `dimensions/sparse-dimstyle-angular`, `dimensions/sparse-dimstyle-fxlon` (+1 more) | answered: imperial built-in defaults (sparse-dimstyle-*) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0507 | dimstyle | [U] In an R12 DXF with no DIMTXSTY code, which text style does AutoCAD use for a DIMENSION regenerated without *D block ($DIMTXSTY or STANDARD)? | 02 §2.6 | `dimensions/r12-dimtxsty-header-nb` | open |
| Q-0508 | dimstyle | [A] When a DIMSTYLE has no 340 (DIMTXSTY), does PLOT also omit the text rather than fall back to STANDARD? | 11b §13, Test ideas (11b:14) | `dimensions/dimtxsty-absent-nb`, `dimensions/dimtxsty-present-nb` | answered: no DIMTXSTY → no text (note 05 §17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0509 | dimstyle | [A] Does a DIMENSION/LEADER referencing an undefined DIMSTYLE name open, and does it fall back to Standard (open log, AUDIT, plot)? | 02 §0 item 10, §4.2 rule 6; 11a §4 | `dimensions/undefined-dimstyle-nb`, `leaders/leader-undefined-dimstyle` | open |
| Q-0510 | dimstyle | [A] Does AutoCAD crash, refuse or repair a DXF whose DIMSTYLE 340 (DIMTXSTY) holds a style name like 'Standard' instead of a handle? | 11c §8 (DIMSTYLE 340 name, REPORTED); 11c §13 LibreCAD row; 11c §17 netDxf#105 / netDxf#228 samples | `fileformat/dimstyle-340-name` | open |
| Q-0511 | dimstyle | [U] Is DIMSTYLE group 50 (DIMJOGANG) stored in degrees or radians, and is the default 45 degrees when absent? | 02 §2.6; 05 §2.2, §15 conflict 9, §15 (05:T14) | `dimensions/jogged-dimjogang-30-nb`, `dimensions/jogged-dimjogang-90-nb`, `dimensions/jogged-dimjogang-rad-nb` | answered: degrees; ≥ 90 → 45 (note 05 §17.4) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0512 | dimstyle | [U] How are true-color DIMCLRD/E/T stored in a DXF DIMSTYLE (extra codes, XDATA, nearest ACI), and which color does a regenerated dim block get? | 02 §2.6, §6; 05 §2.2, §4.1 (05:T20) | plan: dimensions (dxfout) — DIMSTYLE with RGB DIMCLRD/E/T; DXFOUT R2018, inspect record/XDATA; dims with and without *D block, plot | open |
| Q-0513 | dimstyle | [U] Which group code (294 or 295) holds DIMTXTDIRECTION in DIMSTYLE records, and from which DXF version is it written? | 02 §2.6; 05 §2.2 | `fileformat/dimstyle-txtdirection-294`, `fileformat/dimstyle-txtdirection-295` | answered: 294 (dimtxtdirection-1-nb) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0514 | dimstyle | [A] Does AutoCAD write DIMPOST/DIMAPOST (codes 3/4) in DIMSTYLE records when non-empty for R2007+ DXF? | 02 §2.6 | `fileformat/dimstyle-post-r2007`, `fileformat/dimstyle-post-r2018` | open |
| Q-0515 | dimstyle | [C] Does DIMDSEP=0 give '.' as decimal separator (AutoCAD docs) or ',' (ezdxf)? | 05 §2.2, §15 conflict 7 (05:T10) | `dimensions/fmt-dsep-0`, `dimensions/fmt-dsep-44`, `dimensions/fmt-dsep-46` | answered: '.' (note 05 §17.3) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0516 | dimstyle | [T] Does AutoCAD read a hand-written DIMSTYLE with '70 0 ... 69 2 70 1' as DIMTFILL=2, DIMTFILLCLR=red and plot a red text background? | 02 §0 item 2, §2.6 (02:T5) | `dimensions/dimstyle-tfill-second-70-nb` | open |

<a id="dimensions"></a>
## DIMENSION (`dimensions`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0517 | dimensions | [C] Does AutoCAD regenerate, hide or reject a DIMENSION whose *D block is missing/nonexistent/empty, per dimtype, in MS vs block def, R12 vs R2018? | 05 §0 item 2, §4.2, §15 conflict 1; 11a §10 (05:T2, 11a:34) | `dimensions/type-horizontal-nb`, `dimensions/type-vertical-nb`, `dimensions/type-rotated-nb`, `dimensions/type-aligned-nb` (+17 more) | answered: regenerated in layouts; in blocks only angular3p; empty block → nothing (§17.1) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0518 | dimensions | [A] Are dimensional constraints (DIMENSION on *ADSK_CONSTRAINTS without group 2) not plotted at all? | 05 §1.8, §4.2 | plan: dimensions (png) — DIMENSION on layer *ADSK_CONSTRAINTS without 2/70, with ACDBASSOCDEPENDENCY reactor | open |
| Q-0519 | dimensions | [U] Does AutoCAD translate the *D block by DIMENSION group 12 when plotting, both at top level and inside nested INSERTs? | 05 §1.6, §4.1, §15; 11a §10 (05:T3, 11a:35) | `dimensions/struct-group12-ez`, `dimensions/struct-group12-nested-ez` | answered: yes, translated by 12 (§17.1) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0520 | dimensions | [A] For a DIMENSION inside a block definition with base point != 0, is its *D block drawn in the owner block's coordinates, then the INSERT transform? | 05 §1.6 | `dimensions/struct-in-block-ez`, `dimensions/struct-in-block-nb` | open |
| Q-0521 | dimensions | [A] Is the measurement text of a DIMENSION inside a scaled INSERT left unscaled by the INSERT scale when AutoCAD regenerates it? | 11c §8 (measured value not scaled by INSERT scale, ASSUMPTION); 11c §15 item 1 | `dimensions/struct-in-block-ez`, `dimensions/struct-in-block-nb` | open |
| Q-0522 | dimensions | [U] What group 70 type value does AutoCAD write for LARGE_RADIAL_DIMENSION (jogged radius), and does it differ by DXF version? | 05 §1.1 | `dimensions/type-jogged-r2013-nb`, `dimensions/type-jogged-r2018-nb` | open |
| Q-0523 | dimensions | [C] What group 70 type does AutoCAD write for ARC_DIMENSION in R2013 vs R2018 DXF (5, 8, or 5\|32=37)? | 05 §1.1, §15 conflict 6 | `dimensions/type-arc-ez`, `dimensions/type-arc-nb`, `dimensions/type-arc-r2013-ez`, `dimensions/type-arc-r2013-nb` | open |
| Q-0524 | dimensions | [A] Is DIMENSION group 42 (actual measurement) written unscaled, i.e. without DIMLFAC applied? | 05 §1.2 | `dimensions/fmt-lfac-2-nb`, `dimensions/fmt-lfac-0p5-nb`, `dimensions/fmt-lfac-m2-nb` | open |
| Q-0525 | dimensions | [U] For an aligned DIMENSION, does AutoCAD use or ignore group 50 when regenerating the *D block (dim line direction from 13->14 only)? | 05 §1.4 | `dimensions/type-aligned-nb`, `dimensions/aligned-angle50-inconsistent-nb` | open |
| Q-0526 | dimensions | [C] For LARGE_RADIAL_DIMENSION, is group 13 the chord point and 15 the jog point (ezdxf) or the reverse (libredwg)? | 05 §1.4, §6.3, §15 conflict 5 (05:T14) | `dimensions/jogged-swapped-13-15-nb`, `dimensions/jogged-40-jogangle-nb` | answered: 13 override centre, 14 jog, 15 chord (§17.4) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0527 | dimensions | [U] What geometry does AutoCAD draw for a jogged radius (LARGE_RADIAL): jog zig-zag shape and DIMJOGANG effect? | 05 §6.3, §15 (05:T14) | `dimensions/type-jogged-r2013-nb`, `dimensions/type-jogged-r2018-nb`, `dimensions/jogged-dimjogang-30-nb`, `dimensions/jogged-dimjogang-90-nb` (+1 more) | answered: §17.4 (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0528 | dimensions | [U] For a 2-line angular DIMENSION regenerated without *D block, which of the four sectors is measured: the one containing arc point 16? | 05 §1.4, §15; 11a §10 (05:T14, 11a:34) | `dimensions/angular2l-sector-1-nb`, `dimensions/angular2l-sector-2-nb`, `dimensions/angular2l-sector-3-nb`, `dimensions/angular2l-sector-4-nb` | answered: sector containing 16 (§17.4) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0529 | dimensions | [C] For 2-line angular dims, which defpoints does AutoCAD treat as line 1 (13/14) vs line 2 (15/10) for ext line 1/2 and DIMSE1/DIMSE2? | 05 §1.4 (05:T14) | `dimensions/angular2l-dimse1-nb`, `dimensions/angular2l-dimse2-nb` | open |
| Q-0530 | dimensions | [A] Does AutoCAD omit an angular extension line when the dim arc lies on the measured line segment itself? | 05 §6.4 (05:T14) | `dimensions/angular2l-arc-inside-nb`, `dimensions/angular2l-arc-outside-nb` | answered: yes (§17.4) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0531 | dimensions | [U] How does AutoCAD render ARC_DIMENSION partial (70=1) and leader (71=1, 16/17) variants? | 05 §6.4, §15 (05:T14) | `dimensions/arc-partial-nb`, `dimensions/arc-leader-nb`, `dimensions/arc-partial-leader-nb` | answered: §17.4 (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0532 | dimensions | [A] What are the size and position of the arc-length symbol ARC relative to text width/height for DIMARCSYM 0 and 1? | 05 §5.5, §15 conflict 15 (05:T14) | `dimensions/arc-dimarcsym-0-txt4-nb`, `dimensions/arc-dimarcsym-0-txt8-nb`, `dimensions/arc-dimarcsym-1-txt4-nb`, `dimensions/arc-dimarcsym-1-txt8-nb` (+3 more) | answered: §17.4 (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0533 | dimensions | [U] Does $ANGBASE/$ANGDIR affect angular dimension measurement text when the DIMENSION's *D block is regenerated? | 01 §7.2 | `dimensions/angular3p-angbase90-angdir0-nb`, `dimensions/angular3p-angbase0-angdir1-nb` | open |
| Q-0534 | dimensions | [A] Does DIMTIH/DIMTOH 'horizontal' text follow the creation UCS (OCS X rotated by -51) when group 51 is nonzero? | 05 §1.6, §6.2 step 11 (05:T15) | `dimensions/hdir-aligned-0-nb`, `dimensions/hdir-aligned-30-nb`, `dimensions/hdir-radius-0-nb`, `dimensions/hdir-radius-30-nb` (+2 more) | open |
| Q-0535 | dimensions | [U] At which text angle does AutoCAD flip aligned dim text for readability (90/270 exactly, any hysteresis)? | 05 §6.2 step 11, §15 | `dimensions/flip-angle-085-nb`, `dimensions/flip-angle-086-nb`, `dimensions/flip-angle-087-nb`, `dimensions/flip-angle-088-nb` (+18 more) | answered: (90°, 270°] flipped (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0536 | dimensions | [C] Does oblique angle 52=0 give perpendicular extension lines in AutoCAD (same as absent), not lines parallel to the dim line? | 05 §1.6, §15 conflict 10 (05:T12) | `dimensions/oblique-absent-nb`, `dimensions/oblique-0-nb`, `dimensions/oblique-30-nb` | answered: 52 ignored on regeneration (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0537 | dimensions | [C] Which wins when DSTYLE xdata, inline AcDbDimension codes (73/74/75) and the DIMSTYLE disagree? | 11b §13, Test ideas (11b:14) | `dimensions/precedence-dstyle-dimse1-nb`, `dimensions/precedence-record-dimse1-nb` | open |
| Q-0538 | dimensions | [T] Does DIMSTYLE 342 pointing to _ARCHTICK with empty $DIMBLK plot architectural ticks? | 11b §13, Test ideas (11b:14) | `dimensions/record-dimblk-archtick-ez`, `dimensions/record-dimblk-archtick-nb` | open |
| Q-0539 | dimensions | [A] Are the ezdxf-only arrow shapes (_Closed, _DatumBlank, _DotBlank, _Origin, _Origin2, _Integral, _Small) what AutoCAD writes into _X blocks? | 05 §10.3, §15 conflict 3 (05:T5) | `dimensions/arrow-catalog-r12-names-nb`, `dimensions/arrow-catalog-r2018-names-nb` | open |
| Q-0540 | dimensions | [C] What is AutoCAD's _DotSmall arrow block geometry: disc radius 0.3125 (const width 0.5) or 0.125? | 05 §10.3, §15 conflict 3 (05:T5) | `dimensions/arrow-dotsmall-nb`, `dimensions/arrow-catalog-r12-names-nb`, `dimensions/arrow-catalog-r2018-names-nb` | open |
| Q-0541 | dimensions | [A] Is a user block used as arrowhead treated as length 1 (dim line shortened by DIMASZ*DIMSCALE)? | 05 §10.1 (05:T5) | `dimensions/arrow-user-block-nb` | answered: yes (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0542 | dimensions | [C] For which arrow blocks does AutoCAD extend the dim line by DIMDLE (ezdxf/GDAL list incl. _DotSmall/_Small vs netDxf list)? | 05 §6.2 step 7, §15 conflict 11 (05:T5) | `dimensions/dimdle-2-archtick-nb`, `dimensions/dimdle-2-oblique-nb`, `dimensions/dimdle-2-none-nb`, `dimensions/dimdle-2-small-nb` (+3 more) | answered: ezdxf/GDAL zero-length list (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0543 | dimensions | [C] Which arrows are zero-length (no dim-line shortening): do _DotSmall and _Small shorten the dim line? | 05 §6.2 step 6, §10.1, §15 conflict 11 (05:T5) | `dimensions/arrow-closedfilled-nb`, `dimensions/arrow-closedblank-nb`, `dimensions/arrow-closed-nb`, `dimensions/arrow-dot-nb` (+24 more) | answered: DotSmall/Small do not shorten (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0544 | dimensions | [A] Do flip-arrow flags 74/75 simply reverse arrow 1/2 direction (pointing outward) and change dim-line shortening? | 05 §6.2 step 6, §15 (05:T13) | `dimensions/flip-arrows-10-nb`, `dimensions/flip-arrows-01-nb`, `dimensions/flip-arrows-11-nb`, `dimensions/flip-arrows-radius-nb` | answered: arrow reversed + stub + fill line (flip-arrows-*); ignored for radius (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0545 | dimensions | [A] When arrows are placed outside, does AutoCAD draw dim-line stubs beyond each arrow, and of what length? | 05 §6.2 step 6 (05:T6) | `dimensions/fit-atfit0-tad0-nb`, `dimensions/fit-atfit0-tad1-nb`, `dimensions/fit-atfit1-tad0-nb`, `dimensions/fit-atfit1-tad1-nb` (+6 more) | answered: stub DIMASZ (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0546 | dimensions | [A] With DIMTSZ>0, what entity and size does AutoCAD draw for ticks (±DIMTSZ oblique LINE?), and is the dim line extended by DIMDLE? | 05 §6.1, §15 | `dimensions/dimtsz-2-dimdle-0-nb`, `dimensions/dimtsz-2-dimdle-2-nb` | answered: LINE ±DIMTSZ·(d+n), DIMDLE applies (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0547 | dimensions | [A] Are regenerated dimension arrowheads colored DIMCLRD (not BYBLOCK)? | 11a §10 (11a:34) | `dimensions/colors-nb` | answered: yes (colors-nb) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0548 | dimensions | [C] Do radius/diameter center marks use DIMCLRD (ezdxf) or DIMCLRE (netDxf) color? | 05 §6.1, §15 conflict 12 (05:T13) | `dimensions/diameter-dimcen-4-colors-nb`, `dimensions/diameter-dimcen-m4-colors-nb`, `dimensions/diameter-dimcen-0-colors-nb` | answered: DIMCLRE (§17.4) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0549 | dimensions | [C] Is DIMCEN (center mark size) multiplied by DIMSCALE? | 05 §6.3, §15 conflict 12 (05:T13) | `dimensions/radius-dimcen-dimscale-nb` | answered: yes (§17.4) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0550 | dimensions | [A] Does XDATA ACAD_DSTYLE_DIMRADIAL_EXTENSION (387 on/off, 388/390 angles) control a radial arc extension line on radius/diameter dims? | 05 §1.2 | `dimensions/radius-arc-extension-0-nb`, `dimensions/radius-arc-extension-1-nb` | open |
| Q-0551 | dimensions | [U] Which arrows and lines does AutoCAD drop for radius/diameter dims with user-moved text (70 bit 128) inside/outside the circle? | 05 §5.6, §15 (05:T13) | `dimensions/radius-moved-inside-tmove0-nb`, `dimensions/radius-moved-inside-tmove1-nb`, `dimensions/radius-moved-inside-tmove2-nb`, `dimensions/radius-moved-outside-tmove0-nb` (+8 more) | answered: §17.4 (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0552 | dimensions | [U] What are AutoCAD's exact fit thresholds for DIMATFIT 0-3 with DIMTIX/DIMSOXD/DIMTAD combinations? | 05 §6.2 step 5, §15 (05:T6) | `dimensions/fit-atfit0-tad0-nb`, `dimensions/fit-atfit0-tad1-nb`, `dimensions/fit-atfit1-tad0-nb`, `dimensions/fit-atfit1-tad1-nb` (+8 more) | answered: §17.2 (thresholds from the fit sheets) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0553 | dimensions | [U] Where does AutoCAD place text that doesn't fit between ext lines with DIMTMOVE=0 (beside ext line 2 with dim-line extension?) | 05 §6.2 step 10, §15 (05:T6) | `dimensions/fit-atfit0-tad0-nb`, `dimensions/fit-atfit0-tad1-nb`, `dimensions/fit-atfit1-tad0-nb`, `dimensions/fit-atfit1-tad1-nb` (+6 more) | answered: §17.2 (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0554 | dimensions | [U] For DIMTMOVE=1, what leader geometry does AutoCAD draw to moved text and at what distance is the leader omitted? | 05 §6.2 step 10, §6.6 (05:T6) | `dimensions/dimtmove-0-offset-10-nb`, `dimensions/dimtmove-1-offset-10-nb`, `dimensions/dimtmove-2-offset-10-nb`, `dimensions/dimtmove-1-offset-1-nb` (+1 more) | answered: §17.2 (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0555 | dimensions | [C] With DIMJUST 1/2, is text placed DIMASZ+DIMGAP+w/2 from the ext line (ezdxf) or 2*DIMASZ+DIMGAP (AutoCAD docs)? | 05 §6.2 step 10, §15 (05:T8) | `dimensions/dimjust-0-horizontal-nb`, `dimensions/dimjust-0-aligned-nb`, `dimensions/dimjust-1-horizontal-nb`, `dimensions/dimjust-1-aligned-nb` (+6 more) | answered: asz + 2·gap + w/2 (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0556 | dimensions | [T] Do DIMJUST 1/2 place text next to the first/second extension line when the dimension direction is reversed? | 11b §13 (11b:14) | `dimensions/dimjust-1-reversed-nb`, `dimensions/dimjust-2-reversed-nb` | answered: DIMJUST 1 = side of 13 (dimjust-1-reversed-nb) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0557 | dimensions | [A] Does AutoCAD place DIMTAD=1 dim text with its ink-box bottom DIMGAP above the dim line (offset = DIMGAP + half ink height)? | 05 §0 item 5, §5.3, §15 (05:T7) | `dimensions/text-ink-111-nb`, `dimensions/text-ink-gjpq-nb`, `dimensions/text-ink-degree-nb`, `dimensions/text-ink-comma-nb` | answered: yes, MTEXT frame height (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0558 | dimensions | [U] Where does AutoCAD place DIMTAD=3 (JIS) text: above the dim line, and is it aligned to ext line 1? | 05 §6.2 step 10, §15 (05:T8) | `dimensions/dimtad-3-horizontal-nb`, `dimensions/dimtad-3-aligned-nb` | answered: like DIMTAD 1 (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0559 | dimensions | [U] For DIMTAD=2 ('outside'), which side of the dim line does AutoCAD pick relative to the defining points? | 05 §6.2 step 10, §15 (05:T8) | `dimensions/dimtad-2-horizontal-nb`, `dimensions/dimtad-2-aligned-nb`, `dimensions/dimtad-2-below-nb` | answered: away from the defpoints (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0560 | dimensions | [A] How does DIMTVP shift centered text (DIMTAD=0) and is the dim line unbroken only for \|DIMTVP\|>=0.7? | 05 §6.2 step 10 (05:T8) | `dimensions/dimtvp-0p5-nb`, `dimensions/dimtvp-0p7-nb`, `dimensions/dimtvp-1-nb` | answered: DIMTVP·h, unbroken from 0.7 (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0561 | dimensions | [A] Does AutoCAD prefix the dim-block MTEXT content with \A1; exactly when DIMTAD=0 (centered text)? | 05 §5.3 (05:T8) | `dimensions/dimtad-0-horizontal-nb`, `dimensions/dimtad-0-aligned-nb`, `dimensions/dimtad-1-horizontal-nb`, `dimensions/dimtad-1-aligned-nb` (+6 more) | answered: \A<DIMTOLJ>; whenever DIMTOLJ ≠ 0 (§17.3) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0562 | dimensions | [U] Does DIMGAP<0 draw a box around dim text at \|DIMGAP\|, and with which color/lineweight (DIMCLRT? DIMCLRD?)? | 05 §6.2 step 12, §8 | `dimensions/dimgap-m1-nb`, `dimensions/dimgap-m3-nb`, `dimensions/dimgap-box-colors-nb` | answered: box | `dimensions/dimgap-m1-nb`, `dimensions/dimgap-m3-nb`, `dimensions/dimgap-box-colors-nb` | in DIMCLRD/DIMLWD (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0563 | dimensions | [U] Is a text style's fixed height (STYLE 40!=0) multiplied by DIMSCALE for dimension text? | 05 §6.1, §15 | `dimensions/text-fixed-height-style-nb` | answered: no (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0564 | dimensions | [U] Does DIMTXTDIRECTION=1 change dim text geometry (right-to-left reading) in the plotted block? | 05 §7.5 | `dimensions/dimtxtdirection-0-nb`, `dimensions/dimtxtdirection-1-nb` | answered: text turned 180° (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0565 | dimensions | [T] For a regenerated DIMENSION, how are overrides '', '<>', ' ' and 42=-1 treated, and does explicit text drop DIMPOST prefix/suffix and tolerances? | 11b §13, Test ideas; 11c §8 (text override, REPORTED by a user); 11c §18 #16 (11b:14) | `dimensions/text-override-empty-nb`, `dimensions/text-override-brackets-nb`, `dimensions/text-override-space-nb`, `dimensions/text-override-suffix-nb` (+5 more) | answered: §17.3 (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0566 | dimensions | [U] When the text override (group 1) contains several '<>', does AutoCAD replace only the first or all with the measurement? | 05 §1.5 (05:T9) | `dimensions/text-override-double-nb` | answered: first only (§17.3) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0567 | dimensions | [A] Does AutoCAD omit the automatic R/diameter prefix when a radius/diameter dim has a user text override without '<>'? | 05 §1.5 (05:T9) | `dimensions/radius-text-literal-nb`, `dimensions/radius-text-brackets-nb`, `dimensions/diameter-text-literal-nb`, `dimensions/diameter-text-brackets-nb` | answered: yes (§17.3) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0568 | dimensions | [U] Does a DIMPOST prefix replace the automatic R/diameter prefix on radius/diameter dims? | 05 §7.5 | `dimensions/radius-dimpost-x-nb`, `dimensions/radius-dimpost-plain-nb`, `dimensions/diameter-dimpost-x-nb`, `dimensions/diameter-dimpost-plain-nb` | answered: any DIMPOST drops R/∅ (§17.3) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0569 | dimensions | [C] Is a DIMPOST without '<>' treated as a suffix (AutoCAD docs), e.g. DIMPOST='mm' -> '12.5mm'? | 05 §7.1, §15 conflict 8 (05:T10) | `dimensions/fmt-dimpost-mm-nb`, `dimensions/fmt-dimpost-l-mm-nb`, `dimensions/fmt-dimpost-x-y-nb` | answered: yes, suffix (§17.3) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0570 | dimensions | [C] Is the DIMPOST prefix/suffix also applied to tolerance values (DIMTOL=1)? | 05 §7.1, §15 conflict 8 (05:T11) | `dimensions/fmt-dimpost-tol-nb` | answered: suffix after the stack (§17.3) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0571 | dimensions | [A] Is '[]' in the text override / DIMAPOST replaced by the alternate-units value when DIMALT=1? | 05 §1.5 (05:T9) | `dimensions/dimalt-plain-nb`, `dimensions/dimalt-apost-nb`, `dimensions/dimalt-apost-space-nb`, `dimensions/dimalt-text-alt-nb` (+1 more) | answered: only together with <> (§17.3) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0572 | dimensions | [U] Where does AutoCAD place alternate-unit text (DIMALT=1): beside the primary value in brackets or below? | 05 §7.3, §15 (05:T9) | `dimensions/dimalt-plain-nb`, `dimensions/dimalt-apost-nb`, `dimensions/dimalt-apost-space-nb`, `dimensions/dimalt-text-alt-nb` (+1 more) | answered: beside, ' [alt]' (§17.3) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0573 | dimensions | [U] What exact MTEXT codes does AutoCAD write for DIMTOL (equal and unequal) and DIMLIM text, incl. \A, \H and \S? | 05 §7.4, §15 (05:T11) | `dimensions/tol-equal-nb`, `dimensions/tol-unequal-j0-nb`, `dimensions/tol-unequal-j1-nb`, `dimensions/tol-unequal-j2-nb` (+3 more) | answered: §17.3 (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0574 | dimensions | [A] With DIMZIN=8, does 12.0000 display as '12' (decimal separator removed)? | 05 §7.1 (05:T10) | `dimensions/fmt-zin-0`, `dimensions/fmt-zin-4`, `dimensions/fmt-zin-8`, `dimensions/fmt-zin-12` | answered: yes (§17.3) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0575 | dimensions | [A] What exact strings does AutoCAD produce for DIMLUNIT 1-6 x DIMDEC x DIMZIN x DIMFRAC (does netDxf's formatter match)? | 05 §7.1 (05:T10) | `dimensions/fmt-lunit-1`, `dimensions/fmt-lunit-2`, `dimensions/fmt-lunit-3`, `dimensions/fmt-lunit-4` (+23 more) | answered: §17.3 (packages/render/src/dimension/format.ts) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0576 | dimensions | [T] What strings does AutoCAD produce for DIMAUNIT 0-3 x DIMADEC -1..8 x DIMAZIN (DMS precision classes)? | 05 §7.2 (05:T10) | `dimensions/fmt-aunit-0-adec-0-nb`, `dimensions/fmt-aunit-0-adec-2-nb`, `dimensions/fmt-aunit-0-adec-4-nb`, `dimensions/fmt-aunit-1-adec-0-nb` (+13 more) | answered: §17.3 (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0577 | dimensions | [T] Does DIMRND round before formatting, and is DIMLFAC<0 applied only in paper space (1 in model space)? | 05 §7.1, §14 (05:T10) | `dimensions/fmt-rnd-0p25`, `dimensions/fmt-lfac-m2-nb`, `dimensions/fmt-lfac-m2-paperspace-nb` | answered: §17.3 (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0578 | dimensions | [A] Does DIMTFILL=1 (drawing background color) plot as white paper rather than the screen background? | 05 §14 | `dimensions/dimstyle-tfill-second-70-nb`, `dimensions/dimtfill-1-nb`, `dimensions/dimtfill-2-nb` | answered: MTEXT bg flag 3 = canvas (§17.2) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0579 | dimensions | [A] Which annotative representation (TEXT, DIMENSION) plots in model space (CANNOSCALE) and in each paper VIEWPORT (its own scale), with ANNOALLVISIBLE 0/1? | 05 §14, §15; 02 §3.6, §3.18 (05:T19, 02:T17) | plan: layouts (png) — Annotative dim with 1:1 and 1:2 context data; plot MS at each CANNOSCALE and 2 viewports | open |

<a id="leaders"></a>
## LEADER / MULTILEADER / TOLERANCE (`leaders`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0580 | leaders | [T] Does AutoCAD accept a LEADER with exactly one vertex (76 1), or refuse it like the 0-vertex case? | 11c §8 LEADER (fewer than 2 vertices); 11c §18 #5 | `fileformat/leader-one-vertex`, `fileformat/leader-zero-vertices` | open |
| Q-0581 | leaders | [C] Does LEADER 74=0 place the hook along 211 and 74=1 opposite (ezdxf/GDAL) rather than the spec meaning? | 05 §11.1, §15 conflict 4 (05:T16) | `leaders/leader-hook-211px-74-0-75-0`, `leaders/leader-hook-211px-74-0-75-1`, `leaders/leader-hook-211px-74-1-75-0`, `leaders/leader-hook-211px-74-1-75-1` (+4 more) | answered: 74 = 1 reverses the text extension (§17.5) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0582 | leaders | [A] Is the LEADER arrowhead omitted when DIMASZ*DIMSCALE > half the first segment length, and is segment 0 shortened by the arrow? | 05 §0 item 6, §11.2 step 3 (05:T16) | `leaders/leader-first-seg-4p9-closedfilled`, `leaders/leader-first-seg-5-closedfilled`, `leaders/leader-first-seg-5p1-closedfilled`, `leaders/leader-first-seg-10-closedfilled` (+4 more) | answered: yes (§17.5) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0583 | leaders | [A] Does a LEADER take its arrowhead from DIMLDRBLK rather than DIMBLK? | 11a §7 | `leaders/leader-dimldrblk-vs-dimblk-record`, `leaders/leader-dimldrblk-vs-dimblk-dstyle`, `leaders/leader-arrow-archtick`, `leaders/leader-arrow-open` (+3 more) | answered: yes (§17.5) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0584 | leaders | [A] Does AutoCAD draw an unstored LEADER extension under text of DIMGAP*DIMSCALE+41 when DIMTAD!=0 and 73=0, and is 75=1 required? | 05 §0 item 6, §11.2 step 4 (05:T16) | `leaders/leader-hook-211px-74-0-75-0`, `leaders/leader-hook-211px-74-0-75-1`, `leaders/leader-hook-211px-74-1-75-0`, `leaders/leader-hook-211px-74-1-75-1` (+5 more) | answered: yes, 75 not required (§17.5) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0585 | leaders | [U] Does the unstored LEADER text extension use DIMCLRD/DIMLWD/DIMLTYPE like the rest of the leader? | 05 §11.2 (05:T16) | `leaders/leader-mtext-extension-colors` | answered: yes (§17.5) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0586 | leaders | [U] What does AutoCAD draw for a LEADER with 75=1 but no stored hook vertex (as written by third-party software)? | 05 §11.2 (05:T16) | `leaders/leader-hookflag-no-hook-vertex` | answered: hook vertex added (§17.5) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0587 | leaders | [A] How does AutoCAD fit a spline LEADER (72=1): parametrisation, end tangents from segments/211, and the 2- and 3-vertex cases? | 05 §11.2 step 2; 11b §9, Test ideas (05:T16, 11b:13) | `leaders/leader-spline-2v`, `leaders/leader-spline-3v`, `leaders/leader-spline-5v`, `leaders/leader-spline-mtext` | open |
| Q-0588 | leaders | [A] Is LEADER group 77 used as color when DIMCLRD=BYBLOCK, and how does that interact with the entity color? | 05 §11.2 step 5 (05:T16) | `leaders/leader-77-color-bylayer`, `leaders/leader-77-color-color3` | answered: 77 ignored (§17.5) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0589 | leaders | [A] Does AutoCAD accept MULTILEADER (and MLEADERSTYLE) in an AC1021 DXF, or only in AC1024+? | 11c §14 AC1021 (MULTILEADER refused below R2010 as written by ACadSharp) | `fileformat/mleader-r2004`, `fileformat/mleader-r2007`, `fileformat/mleader-r2010` | open |
| Q-0590 | leaders | [U] Is a third-party MULTILEADER without an ACDB_MLEADEROBJECTCONTEXTDATA_CLASS object visible/plotted in AutoCAD? | 05 §12.5 (05:T17) | `leaders/mleader-mtext-basic` | open |
| Q-0591 | leaders | [A] Does AutoCAD use MULTILEADER entity/context values even when the corresponding property override flag bit (90) is not set? | 05 §0 item 7, §12.4 (05:T17) | `leaders/mleader-override-flags-0` | open |
| Q-0592 | leaders | [U] Is MULTILEADER property-override flag bit 5 (group 90) the landing gap? | 05 §12.1 (05:T17) | `leaders/mleader-override-landing-gap-only` | open |
| Q-0593 | leaders | [U] What defaults does AutoCAD apply to codes absent from a hand-written sparse MLEADERSTYLE (imperial vs ezdxf metric)? | 02 §3.10 | `leaders/mleader-sparse-style` | open |
| Q-0594 | leaders | [U] What does MLEADERSTYLE 171 (draw mleader order) control: does 0 draw content first and 1 leader first? | 02 §3.10 | `leaders/mleader-style-171-0`, `leaders/mleader-style-171-1` | open |
| Q-0595 | leaders | [U] What does MLEADERSTYLE 172 (draw leader order) control: arrowhead first vs leader line first? | 02 §3.10 | `leaders/mleader-style-172-0`, `leaders/mleader-style-172-1` | open |
| Q-0596 | leaders | [A] Is a MULTILEADER arrowhead omitted, clamped or scaled when the first segment is not longer than 2*arrow size (incl. zero-length segment)? | 05 §12.5 step 3; 11a §7 (05:T17) | `leaders/mleader-first-seg-0`, `leaders/mleader-first-seg-3p9`, `leaders/mleader-first-seg-4`, `leaders/mleader-first-seg-4p1` (+2 more) | answered: omitted unless first segment > 2·size (§17.5) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0597 | leaders | [A] Are MULTILEADER dogleg/landing data ignored when dogleg is disabled or leader type is spline? | 05 §12.5 step 2 (05:T17) | `leaders/mleader-dogleg-data-disabled-type1`, `leaders/mleader-dogleg-data-disabled-type2`, `leaders/mleader-spline-2v`, `leaders/mleader-spline-3v` | open |
| Q-0598 | leaders | [U] Does AutoCAD render MULTILEADER leader-line breaks (11/12) and dogleg breaks (12/13) as gaps? | 05 §12.5 step 6 (05:T17) | `leaders/mleader-leader-line-break`, `leaders/mleader-dogleg-break` | open |
| Q-0599 | leaders | [A] For MULTILEADER MTEXT with left attachment 1, is the 0.6*text-height offset of the insert 'middle of top line' and font-dependent? | 05 §12.1 (05:T17) | `leaders/mleader-mtext-lato`, `leaders/mleader-left-attachment-0`, `leaders/mleader-left-attachment-1`, `leaders/mleader-left-attachment-2` (+6 more) | open |
| Q-0600 | leaders | [T] How does AutoCAD render MULTILEADER text attachment types 0-8 (underlines) and vertical attachment 272/273=9/10 over/underlines? | 05 §12.2, §12.5 step 5 (05:T17) | `leaders/mleader-left-attachment-0`, `leaders/mleader-left-attachment-1`, `leaders/mleader-left-attachment-2`, `leaders/mleader-left-attachment-3` (+12 more) | open |
| Q-0601 | leaders | [U] What geometry does AutoCAD draw for a MULTILEADER text frame (292): MTEXT extents + landing gap? | 05 §12.5 step 1 (05:T17) | `leaders/mleader-text-frame-one-gap-2`, `leaders/mleader-text-frame-one-gap-0p5`, `leaders/mleader-text-frame-two-gap-2`, `leaders/mleader-text-frame-two-gap-0p5` | open |
| Q-0602 | leaders | [U] What layout rules does AutoCAD use for TOLERANCE frames: row height (2*DIMTXT or DIMTXT+2*DIMGAP), field padding, symbol cells, separators? | 05 §13.3, §15; 11a §7 (05:T18) | `acad-default-fonts/tolerance-one-row`, `acad-default-fonts/tolerance-two-rows`, `leaders/tol-1row`, `leaders/tol-2rows` (+7 more) | answered: §17.5 (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0603 | leaders | [U] How does AutoCAD draw TOLERANCE datum identifier rows (boxed letter) and projected tolerance zone rows? | 05 §13.3, §15 (05:T18) | `acad-default-fonts/tolerance-projected-datum`, `leaders/tol-4rows`, `leaders/tol-row2-empty`, `leaders/tol-datum-only` | answered: §17.5 (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0604 | leaders | [A] Does AutoCAD draw a composite TOLERANCE symbol once, centered over two rows, when both rows share the first field? | 05 §13.3 (05:T18) | `acad-default-fonts/tolerance-composite`, `leaders/tol-composite` | answered: not merged (§17.5) (VERIFIED-BY-ACAD 2026-09-30) |
| Q-0605 | leaders | [A] Is a TOLERANCE frame drawn in DIMCLRD and its text in DIMCLRT? | 05 §13.3 (05:T18) | `leaders/tol-colors` | answered: yes (tol-colors) (VERIFIED-BY-ACAD 2026-09-30) |

<a id="blocks"></a>
## Blocks and INSERT (`blocks`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0606 | blocks | [U] Does AutoCAD open an AC1015/R2018 DXF lacking the BLOCK_RECORD table, the *Model_Space block, or the *Paper_Space block/LAYOUT? | 01 §3.2; 11a §14 (01:T2) | `fileformat/r2000-no-block-record-table`, `fileformat/r2000-no-model-space-block`, `fileformat/r2000-no-paper-space-block`, `fileformat/r2018-model-space-only` | open |
| Q-0607 | blocks | [A] Does AutoCAD reject a file with an INSERT of a non-existent block, or open it and drop the INSERT? | 11a §13 | `fileformat/insert-missing-block` | open |
| Q-0608 | blocks | [A] When a DXF has two BLOCKs with the same (case-insensitive) name, does AutoCAD merge them (first name, second base point, both entity sets) or reject? | 07 §1.1 | `fileformat/block-duplicate-case`, `fileformat/block-duplicate-exact` | open |
| Q-0609 | blocks | [C] Does AutoCAD place block entities in raw block coords and subtract BLOCK base point at INSERT time (entities not pre-shifted), per spec L2965 wording? | 07 §1.4, §17 (07:1) | `blocks/base-point`, `blocks/base-point-far`, `blocks/nested-3level-*` | open |
| Q-0610 | blocks | [U] For a cyclic block definition (A->B->A), does AutoCAD refuse the DXF, or does RECOVER load and plot the non-cyclic parts? | 07 §1.7 (07:22) | plan: blocks (log) — block A contains INSERT B, B contains INSERT A plus lines; INSERT A in model space | open |
| Q-0611 | blocks | [U] Who creates *E### anonymous blocks, and does AutoCAD render an INSERT of a *E### block exactly like a *U### block? | 07 §1.6 | `blocks/anonymous-e` | open |
| Q-0612 | blocks | [A] Does PLOT rescale an INSERT when BLOCK_RECORD 70 units differ from $INSUNITS, or use only 41/42/43 (does -INSERT bake the ratio into the scale)? | 01 §7.2; 02 §2.9; 07 §1.5 (02:T15, 07:23) | `blocks/units-*` | open |
| Q-0613 | blocks | [U] How does AutoCAD handle an INSERT with 41/42/43 = 0: reject, repair to 1 on AUDIT, draw collapsed geometry, or (43=0) plot normally in plan view? | 07 §2.1; 11b §6, Test ideas (11b:2) | `blocks/zero-scale-x`, `blocks/zero-scale-y`, `blocks/zero-scale-z` | answered |
| Q-0614 | blocks | [A] Does a CIRCLE/ARC in a block inserted with sx=3, sy=1 plot as an exact ellipse / elliptical arc? | 07 §2.4 (07:2) | `blocks/nonuniform-*`, `blocks/nonuniform-circle-arc`, `blocks/nonuniform-circle-rot`, `blocks/nested-shear-circle` | open |
| Q-0615 | blocks | [A] Does a rotated child INSERT inside a non-uniformly scaled parent plot as the composed sheared matrix? | 07 §2.2, §2.4 (07:1) | `blocks/nonuniform-text-nested-rot`, `blocks/nested-3level-*`, `blocks/nested-shear`, `blocks/nested-shear-circle` | open |
| Q-0616 | blocks | [U] In an INSERT with 41=-1, are TEXT, MTEXT and constant ATTDEFs drawn mirrored and ATTRIBs from stored geometry, regardless of $MIRRTEXT 0/1? | 04 §1.7; 11b §4, Test ideas; 01 §7.2 (04:T6, 11b:2) | `attribs/mirror-const-attdef`, `blocks/mirrtext-0-sx`, `blocks/mirrtext-1-sx`, `blocks/mirrtext-0-sy` (+5 more) | open |
| Q-0617 | blocks | [U] Are XDATA 1010/1011/1012/1013/1041/1042 transformed per spec when a block with them is inserted rotated/mirrored/non-uniform and EXPLODEd? | 01 §6.4 (01:T17) | plan: blocks (dxfout) — block entities carrying all XDATA point/distance codes; INSERT rot 30, sx=-2, sy=1; EXPLODE, DXFOUT | open |
| Q-0618 | blocks | [C] Is MINSERT column/row spacing (44/45) scaled by 41/42 or only rotated by 50 (in OCS), and is it relative to the block base point? | 07 §2.3, §17; 11b §7, Test ideas (07:6, 11b:2) | `blocks/minsert-plain`, `blocks/minsert-scaled`, `blocks/minsert-rotated`, `blocks/minsert-rot-scaled` (+2 more) | open |
| Q-0619 | blocks | [A] Does a MINSERT with spacing 0 and count 3 draw 3 coincident copies (visible as stacked transparency) or one? | 07 §2.3 (07:6) | `blocks/minsert-zero-spacing` | open |
| Q-0620 | blocks | [A] Does a layer VP-frozen in a paper space viewport hide an INSERT on that layer including nested non-0 content (like global freeze)? | 07 §3.2 (07:8) | `layouts/insert-vpfreeze-l2`, `layouts/insert-vpfreeze-l1` | answered |
| Q-0621 | blocks | [A] Does a dynamic block's *U block alone reproduce the plot (visibility baked in via 60=1), or does AutoCAD need AcDbDynamicBlock data to hide states? | 02 §3.22; 11a §13 (02:T16) | `blocks/dynamic-like-u-blocks` | open |
| Q-0622 | blocks | [U] If an INSERT references a dynamic block definition directly (no *U), which visibility state does AutoCAD plot? | 02 §3.22 (02:T16) | plan: blocks (png) — Hand-written INSERT naming the dynamic block itself with BLOCKVISIBILITYPARAMETER, no AcDbBlockRepresentation | open |
| Q-0623 | blocks | [U] When a dynamic block definition is edited but its *U### representations are stale, does AutoCAD regenerate them on open or show stored *U content? | 07 §5.3, §17 (07:11) | `misc/dynblock-visibility-as-is`, `misc/dynblock-visibility-definition-edited` | open |

- Q-0620: Yes: a VP-frozen INSERT layer hides the whole reference in that viewport, incl. nested non-0 content; freezing a child layer hides only that child (`layouts/insert-vpfreeze-l1/-l2`).
- Q-0613: The file loads and a zero scale factor plots as 1 (`blocks/zero-scale-*`, note 07 §2.1).

<a id="xrefs"></a>
## Xrefs (`xrefs`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0624 | xrefs | [U] Does an xref-dependent layer 'X\|Defpoints' plot, or is it suppressed like Defpoints? | 02 §2.1.1, §6 (02:T1) | `misc/xref-acs-sample-plain`, `misc/xref-acs-sample-host-overrides` | open |
| Q-0625 | xrefs | [A] With $VISRETAIN=1, are the host's XREF\|LAYER table states (off/freeze/color) authoritative for xref content? | 07 §6.1 | `misc/xref-acs-sample-host-overrides`, `misc/xref-acs-sample-host-overrides-visretain0` | open |
| Q-0626 | xrefs | [U] What does PLOT draw for a missing/unresolved xref: nothing, or a path placeholder (text style/height/position)? | 07 §6.2, §17; 11b §7 (07:12) | `blocks/xref-missing-attach`, `blocks/xref-missing-overlay`, `misc/xref-missing-attach`, `misc/xref-missing-overlay` | open |
| Q-0627 | xrefs | [U] How is an unloaded xref (Xref Manager Unload) stored in DXF, and does it plot nothing? | 07 §6.2, §17 | plan: misc (dxfout) — attach xref, unload, DXFOUT; inspect BLOCK flags/xdata | open |

<a id="xclip"></a>
## XCLIP (`xclip`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0628 | xclip | [C] In R2010+ DXF, which $XCLIPFRAME (280) values 0/1/2 plot the XCLIP boundary (docs vs ezdxf: is 1 or 2 displayed+plotted)? | 01 §7.2, §7.4, §10 item 9; 02 §3.6, §3.13, §6; 07 §7.4, §17; 11a §3, §13, Open conflicts (01:T21, 02:T11, 07:13, 11a:38) | `xclip/xclipframe-0`, `xclip/xclipframe-1`, `xclip/xclipframe-2`, `xclip/disabled-frame-1` (+1 more) | answered |
| Q-0629 | xclip | [C] In AC1018/AC1021 DXF ($XCLIPFRAME group 290 bool), does 1 plot the clip frame, and does AutoCAD accept a value of 2? | 02 §3.6; 07 §7.4 (02:T11, 07:13) | `xclip/r2004-xclipframe-1`, `xclip/r2004-xclipframe-2`, `xclip/r2007-xclipframe-1`, `xclip/r2007-xclipframe-2` | answered |
| Q-0630 | xclip | [U] When $XCLIPFRAME and an XCLIPFRAME DICTIONARYVAR disagree, which does AutoCAD use? | 02 §3.6, §6 (02:T11) | `xclip/dictvar-h0-d1`, `xclip/dictvar-h1-d0`, `xclip/dictvar-h2-d1` | answered |
| Q-0631 | xclip | [A] Is the XCLIP frame drawn with the INSERT's resolved color/linetype/lineweight? | 07 §7.4 | `xclip/frame-props-bylayer`, `xclip/frame-props-explicit` | answered |
| Q-0632 | xclip | [A] Does an XCLIP stay fixed to the block when the INSERT is moved/rotated/mirrored/scaled after clipping (clip applied via inverse insert matrix)? | 07 §7.2; 11a §13 (07:13, 11a:38) | `xclip/rect-block`, `xclip/rect-acad`, `xclip/rect-4pt`, `xclip/polygon-penta` (+14 more) | answered |
| Q-0633 | xclip | [U] For inverted XCLIP (2015+), does AutoCAD clip with the stored slit polygon exactly (hairline gap visible) or a true outer-minus-hole region? | 07 §7.3, §17 (07:13) | `xclip/inverted-ezdxf` | open |
| Q-0634 | xclip | [U] What does the second 3x4 matrix of SPATIAL_FILTER (clip-boundary transform) mean; is it non-identity for XCLIP made in a rotated UCS? | 07 §7.2, §17 (07:13) | `xclip/transform-matrix-rect`, `xclip/transform-matrix-polygon` | answered |
| Q-0635 | xclip | [T] Do nested XCLIPs (clipped INSERT inside a clipped block) each clip in their own space (clip stack intersection)? | 07 §7.2 (07:13) | `xclip/nested`, `xclip/nested-child-only` | answered |
| Q-0636 | xclip | [U] Can a MINSERT be XCLIPped, and if a SPATIAL_FILTER is attached to a MINSERT in DXF, does AutoCAD clip every cell? | 07 §2.3, §17 | `xclip/minsert` | answered |
| Q-0637 | xclip | [A] Are an XCLIPped INSERT's ATTRIBs drawn unclipped? | 07 §7.2 (07:13) | `xclip/attrib-outside` | answered |
| Q-0638 | xclip | [U] What are SPATIAL_FILTER front/back clip (72/73, 40/41) sign conventions along the clip normal? | 07 §7.2, §17 | `xclip/frontback-front`, `xclip/frontback-back`, `xclip/frontback-both` | answered |
| Q-0639 | xclip | [A] Does AutoCAD reject a SPATIAL_FILTER with 40/41 while front/back clipping (72/73) is off, or a malformed inverted-clip XRECORD? | 11a §13 (11a:38) | `fileformat/spatial-filter-disabled-with-40`, `fileformat/spatial-filter-inverted-ezdxf`, `fileformat/spatial-filter-inverted-truncated` | open |

- Q-0628: R2010+ 280: 0 = no frame, 1 = frame plotted, 2 = not plotted (ezdxf docstring wrong) (`xclip/xclipframe-*`, note 07 §7.5).
- Q-0629: R2004/R2007 290 = 1 plots the frame; a value 2 makes AutoCAD reject the DXF (`xclip/r2004-*`, `r2007-*`).
- Q-0630: The header wins; a DICTIONARYVAR XCLIPFRAME is ignored (`xclip/dictvar-*`).
- Q-0631: Yes: INSERT colour/lineweight/linetype, dashes restart per boundary edge (`xclip/frame-props-*`).
- Q-0632: Yes: block = inverse-insert · boundary, placed with the current INSERT transform; the clip follows later moves/rotations/scales/mirrors (`xclip/after-clip-*`, `rect-*`, `made-on-*`).
- Q-0634: The 2nd matrix maps the clip-time WCS into the boundary system: block = inverse-insert · second⁻¹ · boundary (`xclip/transform-matrix-*`).
- Q-0635: Yes: nested clips intersect, each in its own space (`xclip/nested*`).
- Q-0636: Yes: one region placed with cell (0,0)'s transform clips all cells (`xclip/minsert`).
- Q-0637: ~~Yes: ATTRIBs are not clipped~~ Corrected 2026-10-01: ATTRIBs are clipped with their
  INSERT (`xclip/attrib-outside`, regenerated reference).
- Q-0638: Along the boundary normal: front 40 keeps z ≤ 40, back 41 keeps z ≥ 41; crossing geometry is cut (`xclip/frontback-*`).

<a id="images"></a>
## IMAGE (`images`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0640 | images | [A] Does AutoCAD display and plot an IMAGE when ACAD_IMAGE_DICT is missing from the NOD, or when the IMAGEDEF_REACTOR is absent? | 11c §12 (IMAGE without ACAD_IMAGE_DICT / reactor; ACadSharp#1124/#591 REPORTED); 11c §17 sample_3.6.29.dxf | `images/no-image-dict`, `images/no-reactor` | open |
| Q-0641 | images | [A] Does an IMAGE CLASS record with instance count 91=0 (AC1018+) stop an existing IMAGE from displaying or plotting in AutoCAD? | 11c §12 (IMAGE class count 0, ACadSharp#1127 REPORTED); 11c §17 image_3.6.35.dxf | `images/class-count-1`, `images/class-count-0` | open |
| Q-0642 | images | [A] Does AutoCAD reject or crash on an IMAGE (or WIPEOUT) whose user clip boundary polygon is not closed? | 11a §7 | `fileformat/image-clip-open-polygon`, `fileformat/wipeout-clip-open-polygon` | open |
| Q-0643 | images | [A] In what order does AutoCAD resolve an IMAGEDEF path when plotting (absolute, relative to DXF folder, bare name next to DXF, search paths)? | 02 §3.14; 07 §8.2 | `images/basic`, `images/path-bare`, `images/path-dot`, `images/path-parent` (+2 more) | open |
| Q-0644 | images | [U] What does PLOT draw for an IMAGE whose IMAGEDEF file is missing: frame only, path/filename text, or nothing? | 07 §8.4, §17; 11b §15 (07:14) | `images/missing-abs`, `images/missing-bare`, `images/missing-rotated-clipped` | open |
| Q-0645 | images | [A] With IMAGE display flag 1 (show) off, e.g. 70=8 only, or IMAGEDEF 280=0 (unloaded), does PLOT draw only the frame or nothing? | 07 §8.4; 11a §7 (07:14, 11a:42) | `images/flags-00`, `images/flags-02`, `images/flags-08`, `images/flags-09` (+2 more) | open |
| Q-0646 | images | [A] Is IMAGE display flag 2 (show when not aligned) irrelevant for top-view PLOT (image drawn regardless)? | 07 §8.4 | `images/tilted-flags1`, `images/tilted-flags3`, `images/rot30-flags1`, `images/rot30-flags3` | open |
| Q-0647 | images | [C] Are IMAGE/WIPEOUT 10/11/12 (insertion, u/v vectors) WCS or OCS when a 210 = (0,0,-1) is present? | 03 §2.4, Test ideas 4 (03:T4) | `images/extrusion-negz`, `images/wipeout-extrusion-negz` | open |
| Q-0648 | images | [T] Is an IMAGE inside a mirrored/rotated block transformed by the block matrix (mirrored pixels)? | 07 §8.4 (07:14) | `images/block-mirror-rot30`, `images/block-nonuniform`, `images/block-rot90-scale`, `images/block-clipped-rot` (+1 more) | open |
| Q-0649 | images | [C] Which IMAGEFRAME (RASTERVARIABLES 70) values 0/1/2 draw the IMAGE border in PLOT? | 02 §3.6, §3.14, §6; 07 §8.3, §17 (02:T11, 07:14) | `images/frame-color-lw`, `images/frame-clip-color`, `images/imageframe-0`, `images/imageframe-1` (+2 more) | open |
| Q-0650 | images | [U] How does AutoCAD store IMAGEFRAME=2 (display, no plot) in DXF: RASTERVARIABLES 70=2 or a DICTIONARYVAR, and is the frame then omitted from plots? | 06 §8.3, §9 item 12; 07 §8.3, §17 (07:14) | `images/imageframe-0`, `images/imageframe-1`, `images/imageframe-2` | open |
| Q-0651 | images | [A] If RASTERVARIABLES (ACAD_IMAGE_VARS) is absent, does AutoCAD default to IMAGEFRAME 1 and plot image borders? | 02 §3.14; 07 §8.3 | `images/no-rastervariables` | open |
| Q-0652 | images | [U] Does IMAGE clipping require only display flag 4, or also clipping state 280=1? | 07 §8.1 (07:14) | `images/clip-poly-flag4-280on`, `images/clip-poly-flag4-280off`, `images/clip-poly-noflag4-280on` | open |
| Q-0653 | images | [C] Are IMAGE clip vertices (14/24) pixel coords with -0.5 offset, y down, so (-0.5,-0.5)-(w-0.5,h-0.5) spans the full image? | 07 §8.1, §17 (07:14) | `images/clip-pixel11-plain`, `images/clip-pixel11-rot30`, `images/clip-pixel11-mirror-v`, `images/clip-full-default` (+2 more) | open |
| Q-0654 | images | [T] Does IMAGE clip mode 290=1 (inside mode) hide the area inside the clip boundary in PLOT? | 07 §8.1 (07:14) | `images/clip-poly-mode0`, `images/clip-poly-mode1`, `images/clip-rect-mode1`, `images/clip-poly-mode1-r2007` | open |
| Q-0655 | images | [U] What are the exact PLOT formulas and order for IMAGE brightness 281, contrast 282 and fade 283 (50 neutral? fade blends to background?)? | 07 §8.4, §17; 11a §7 (07:14, 11a:42) | `images/bcf-b050-c050-f000`, `images/bcf-b000-c050-f000`, `images/bcf-b020-c050-f000`, `images/bcf-b080-c050-f000` (+13 more) | open |
| Q-0656 | images | [T] With IMAGE transparency flag 8, is PNG alpha honored (off: alpha forced opaque), and does entity transparency 440 multiply it? | 07 §8.4 (07:14) | `images/alpha-flag8-off`, `images/alpha-flag8-on`, `images/alpha-flag8-on-t50`, `images/alpha-flag8-off-t50` (+1 more) | open |
| Q-0657 | images | [T] Are bitonal (1-bit) image foreground pixels plotted in entity color, and background transparent with flag 8? | 07 §8.4 (07:14) | `images/bitonal-png-red`, `images/bitonal-png-red-transp`, `images/bitonal-png-bylayer-green`, `images/bitonal-png-color7-transp` (+6 more) | open |
| Q-0658 | images | [U] Which resampling filter (nearest/bilinear) and raster resolution does PLOT use when scaling an IMAGE up? | 07 §8.4, §17 (07:14) | `images/resample-2x2`, `images/resample-3x3-fraction`, `images/resample-pattern-up`, `images/resample-pattern-down` (+1 more) | open |
| Q-0659 | images | [U] What is a PDF underlay's size at scale 1: 1 PDF inch = 1 drawing unit, with unit conversion baked into 41/42? | 07 §10.1, §17 (07:16) | `images/pdf-natural-mm`, `images/pdf-natural-inch`, `images/pdf-basic` | answered |
| Q-0660 | images | [T] Is an underlay clip boundary (11/21) in unscaled underlay-local units, and does flag 16 invert it? | 07 §10.1 (07:16) | `images/pdf-clip-rect`, `images/pdf-clip-inverted`, `images/pdf-clip-poly` | answered |
| Q-0661 | images | [A] Does underlay monochrome flag (280 bit 4) plot all non-white PDF content black? | 07 §10.3 (07:16) | `images/pdf-flags-mono`, `images/pdf-flags-off` | answered |
| Q-0662 | images | [U] Does underlay 'adjust for background' (280 bit 8) affect PLOT output or only screen display? | 07 §10.3 (07:16) | `images/pdf-flags-adjustbg`, `images/pdf-flags-plain` | answered |
| Q-0663 | images | [T] How do PDF underlay contrast (281) and fade (282) affect plotted underlay colors? | 07 §10.3 (07:16) | `images/pdf-fade50-contrast100`, `images/pdf-fade80-contrast100`, `images/pdf-fade00-contrast020`, `images/pdf-fade00-contrast060` (+1 more) | answered |
| Q-0664 | images | [U] Where are PDF underlay layer (OCG) visibility settings stored in DXF? | 07 §10.3 | `images/pdf-layers` | open |
| Q-0665 | images | [U] Where is PDFFRAME (0/1/2) stored in DXF, and for which values does PLOT draw the PDF underlay frame? | 01 §7.2; 07 §10.3, §17; 02 §3.6 (07:16) | `images/pdfframe-dictvar-0`, `images/pdfframe-dictvar-1`, `images/pdfframe-dictvar-2` | answered |
| Q-0742 | images | [U] When a PDF page's CropBox differs from its MediaBox, which box is the underlay origin and frame (PDF.js renders the CropBox)? | 07 §10.3 | plan: images (png) — PDFUNDERLAY of a page with MediaBox 0 0 288 216 and CropBox 36 36 252 180, frame and content position | open |
| Q-0743 | images | [U] Is a PDF page with /Rotate 90 plotted rotated (natural size swapped), or as stored? | 07 §10.3 | plan: images (png) — PDFUNDERLAY of the probe page with /Rotate 90 at scale 40 | open |
| Q-0744 | images | [A] Do page areas the PDF does not paint plot transparent, so entities drawn before the underlay show through? | 07 §10.3 | plan: images (png) — red SOLID under a PDFUNDERLAY whose page paints only a black square | open |
| Q-0745 | images | [U] What does PLOT draw for a PDF underlay whose file is missing: the frame, the path as text, or nothing? | 07 §10.3 | plan: images (png) — PDFUNDERLAY with a PDFDEFINITION path that does not exist, PDFFRAME 1 | open |
| Q-0746 | images | [U] How does PLOT rasterize PDF underlay content: fills unantialiased (pixel centre rule, pdf-basic), thin strokes at their width without a 1-pixel minimum (pdf-natural-mm)? | 07 §10.3 | plan: calibration (png) — PDF with fills at sub-pixel offsets and 0.1/0.25/0.5/1 pt strokes, underlay at scale 1 and 40 | open |
| Q-0747 | images | [T] Does PDFDEFINITION 2 (underlay name) select the page by number, e.g. \"2\" → the second page? | 07 §10.2 | plan: images (png) — two-page PDF, PDFDEFINITION name 2 | open |
| Q-0666 | images | [A] Is OLE2FRAME group 3 a descriptive string (e.g. 'Paintbrush Picture') rather than binary length in AutoCAD-written DXF? | 07 §11 (07:17) | plan: fileformat (dxfout) — embed Paintbrush bitmap OLE in AutoCAD, DXFOUT | open |
| Q-0667 | images | [U] How does PLOT render OLE2FRAME objects (cached presentation WMF/EMF/DIB), incl. rotated frames from the 4 header corners? | 07 §11 (07:17) | plan: images (png) — embedded Paintbrush bitmap and Excel range OLE; rotated OLE frame | open |

- Q-0650: Storage only: DXFOUT keeps RASTERVARIABLES 70 = 2 (`images/imageframe-2`); the plot effect is untestable, see the note below.
- Q-0659: Yes: 1 PDF inch = 1 drawing unit at scale 1, independent of INSUNITS (`images/pdf-natural-mm`, `pdf-natural-inch`).
- Q-0665: DICTIONARYVAR `PDFFRAME` is read: 1 (default when absent) plots the underlay frame, 0 and 2 do not (`images/pdfframe-dictvar-*`; 0 and 2 byte-identical).
- Q-0660: The clip boundary is in underlay units before 41/42 (`images/pdf-clip-rect`, `pdf-clip-poly`); flag 16 does not invert it in plots: `pdf-clip-inverted` plots like `pdf-clip-rect` and DXFOUT keeps 280 = 19.
- Q-0661: No: monochrome plots greys of the HLS lightness (red and blue 127, yellow FFFFD9 236, black stays black) (`images/pdf-flags-mono`).
- Q-0662: No effect on PLOT: `pdf-flags-adjustbg` is identical to `pdf-flags-plain`.
- Q-0663: Contrast c = 281/100 scales the HLS lightness about ≈ 0.3 (L' = 0.3 + (L − 0.3)·c, hue and saturation kept); fade f = 282/100 then moves it towards white (L'' = L' + (1 − L')·f) with the saturation of the colour faded per channel; ±1 per channel (`images/pdf-fade*-contrast*`).
- Note: Blocked: accoreconsole (the reference harness) plots **no IMAGE and no WIPEOUT** at all — no bitmap, no frame, no mask; DXFOUT stores empty proxy graphics for both (note 07 §8.5). Q-0640 … Q-0658 and Q-0668 … Q-0675 need plots from full AutoCAD; truedxf renders them per the UNVERIFIED rules (RenderEnv.rasterEntities, harness uses omit).

<a id="wipeout"></a>
## WIPEOUT (`wipeout`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0668 | wipeout | [T] Does AutoCAD display a WIPEOUT with no IMAGEDEF/WIPEOUTVARIABLES objects? | 11b §15 | `fileformat/wipeout-no-variables` | open |
| Q-0669 | wipeout | [A] Does PLOT fill a WIPEOUT with paper colour, masking earlier entities (and not later ones), in both model and paper space? | 06 §8.3; 11a §7; 11b §15 (06:D4, 11a:42) | `images/wipeout-basic`, `images/wipeout-paperspace`, `images/wipeout-first`, `images/wipeout-sortents` (+1 more) | open |
| Q-0670 | wipeout | [A] With a dark model-space background, is a WIPEOUT plotted as paper (white) color; unchanged by monochrome CTB? | 07 §9 (07:15) | `images/wipeout-ctb-monochrome`, `images/wipeout-ctb-acad` | open |
| Q-0671 | wipeout | [A] Does a WIPEOUT inside a block mask earlier entities of the same block and everything drawn before the INSERT? | 07 §9 (07:15) | `images/wipeout-block-plain`, `images/wipeout-block-rot-scaled` | open |
| Q-0672 | wipeout | [U] What does WIPEOUT clip mode 290=1 (inverted) do in PLOT? | 07 §9 | `images/wipeout-mode0`, `images/wipeout-mode1` | open |
| Q-0673 | wipeout | [C] Which WIPEOUTFRAME (WIPEOUTVARIABLES 70) values 0/1/2 draw the wipeout frame in PLOT, in model and paper space? | 02 §3.6, §3.15, §6 (02:T11) | `images/wipeoutframe-model-0`, `images/wipeoutframe-model-1`, `images/wipeoutframe-model-2`, `images/wipeoutframe-paper-0` (+3 more) | open |
| Q-0674 | wipeout | [U] How is WIPEOUTFRAME=2 (displayed but not plotted) stored in DXF, and is the frame then omitted from plots? | 06 §8.3, §9 item 12 | `images/wipeoutframe-model-0`, `images/wipeoutframe-model-1`, `images/wipeoutframe-model-2`, `images/wipeoutframe-paper-0` (+12 more) | open |
| Q-0675 | wipeout | [U] When WIPEOUTVARIABLES 70 and a WIPEOUTFRAME DICTIONARYVAR (0/1/2) disagree, which does AutoCAD use for display and plot? | 02 §3.6, §3.15, §6; 07 §9, §17 (02:T11, 07:15) | `images/wipeoutframe-varsnone-dict0`, `images/wipeoutframe-varsnone-dict1`, `images/wipeoutframe-varsnone-dict2`, `images/wipeoutframe-vars0-dict1` (+6 more) | open |

<a id="mline"></a>
## MLINE (`mline`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0676 | mline | [C] For MLINE Top/Bottom justification with unsorted style element offsets, is shift -max/-min offset or first/last element offset? | 07 §12.2 (07:18) | `mline/unsorted-offsets-top`, `mline/unsorted-offsets-bottom` | answered |
| Q-0677 | mline | [C] Do MLINESTYLE element colors BYBLOCK/BYLAYER and element linetypes resolve against the MLINE's own color/layer (and enclosing INSERT)? | 02 §3.9; 07 §12.3, §17 (02:T14, 07:18) | `mline/props-modelspace`, `mline/props-in-insert-explicit`, `mline/props-in-insert-byblock` | answered |
| Q-0678 | mline | [T] Is an MLINE entity's true color (420) ignored by AutoCAD when plotting? | 07 §12.3 (07:18) | `mline/true-color` | answered |
| Q-0679 | mline | [U] Can MLINESTYLE elements carry true colors (420) in DXF, and are they used when plotting? | 07 §12.3 | plan: mline (dxfout) — MLINESTYLE element with true color set in AutoCAD; DXFOUT | open |
| Q-0680 | mline | [A] Does MLINESTYLE write true-color fill as 420/430 after 62 when a true color is set? | 02 §3.9, §6 (02:T14) | `fileformat/mlinestyle-true-color-fill` | open |
| Q-0681 | mline | [U] How does AutoCAD render MLINE caps when MLINESTYLE start/end angles 51/52 are not 90 deg (e.g. 45, 135)? | 02 §3.9, §6 (02:T14) | `mline/angles-45-135-square`, `mline/angles-45-135-inner`, `mline/angles-45-135-round`, `mline/angles-45-135-all` (+1 more) | open |
| Q-0682 | mline | [A] Are MLINE miter joints and square caps drawn as two halves colored by the top and bottom elements (incl. all vertices if closed)? | 07 §12.4 (07:18) | `mline/caps-square`, `mline/miters-open`, `mline/miters-closed` | answered |
| Q-0683 | mline | [A] Does AutoCAD draw MLINE arc end caps with a split-coloured start cap and an end cap in the second element's colour/linetype? | 11c §9 (MLINE caps, netDxf#93 REPORTED); 11c §15 item 13; 11c §18 #23 | `mline/caps-round`, `mline/caps-outer-inner-3`, `mline/caps-outer-inner-4` | answered |
| Q-0684 | mline | [C] Do MLINE inner-arc caps connect all symmetric inner element pairs or only one pair? | 07 §12.4, §17 (07:18) | `mline/caps-inner-3`, `mline/caps-inner-4`, `mline/caps-inner-5`, `mline/caps-inner-6` (+3 more) | answered |
| Q-0685 | mline | [T] Is MLINE fill drawn under element lines, including round-cap areas, and does negative scale flip round-cap orientation? | 07 §12.4 (07:18) | `mline/fill-round-pos`, `mline/fill-round-neg`, `mline/fill-bylayer-miters` | answered |
| Q-0686 | mline | [C] Does PLOT honor MLINE element break parameters (41 list after a0/a1) from MLEDIT cuts? | 07 §12.2, §17 (07:18) | `mline/breaks-cut-all`, `mline/breaks-cut-single`, `mline/breaks-two-gaps` | answered |
| Q-0687 | mline | [U] How is MLINE fill split by MLEDIT fill-break parameters (75/42 lists)? | 07 §12.4, §17 (07:18) | `mline/fill-breaks-stop-start`, `mline/fill-breaks-with-start` | answered |

- Q-0676: AutoCAD draws the stored geometry; vertex element k takes the style element with the k-th largest offset, caps / joints run between vertex elements 0 and n-1 (`mline/unsorted-offsets-*`).
- Q-0677: Like exploded LINEs on the MLINE's layer: BYLAYER -> MLINE layer, BYBLOCK -> enclosing block context (top level ACI 7 / Continuous); the MLINE's own colour and linetype are unused (`mline/props-*`).
- Q-0678: Yes, ignored — as is the MLINE's ACI colour (`mline/true-color`).
- Q-0682: Yes, two halves coloured by elements 0 and n-1, at all vertices when closed (`mline/miters-*`, `caps-square`).
- Q-0683: Both round caps are two quarter arcs coloured by the outer elements (`mline/caps-round*`).
- Q-0684: All symmetric inner pairs (k, n-1-k), k = 1 .. floor(n/2)-1 (`mline/caps-inner-*`).
- Q-0685: Yes: fill first, round-cap areas included; negative scale works the same (`mline/fill-round-*`).
- Q-0686: Yes (`mline/breaks-*`).
- Q-0687: The hand-written 42 lists (30/45) did not split the fill at all (`mline/fill-breaks-*`).

<a id="acad-table"></a>
## ACAD_TABLE (`acad-table`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0688 | acad-table | [A] If an ACAD_TABLE's *T block is missing, does AutoCAD regenerate it from table data or show proxy graphics / nothing? | 07 §13.1 | plan: misc (png) — ACAD_TABLE with group 2 pointing to nonexistent *T block | open |
| Q-0689 | acad-table | [T] Does PLOT (without REGEN) draw an ACAD_TABLE's cached *T block even when it disagrees with the TABLECONTENT cell data? | 11c §11 (TABLE *T block shown until REGEN); 11c §15 item 2; 11c §18 #22 | plan: misc (png) — ACAD_TABLE whose *T block shows 'OLD' while cell data says 'NEW'; plot, then REGEN and plot | open |
| Q-0690 | acad-table | [U] Is ACAD_TABLE rotation/scale (50, 41-43, 11 direction, 210) baked into the *T block geometry or applied as INSERT transform? | 07 §13.1, §17 (07:19) | plan: misc (dxfout) — 3x3 table rotated 30 and scaled 2 with block cell; DXFOUT and plot | open |

<a id="proxy"></a>
## Proxy graphics and custom objects (`proxy`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0691 | proxy | [C] Which group code (92 or 160) does AutoCAD read/write for the proxy graphics byte count in R2013+ vs pre-R2013 DXF? | 03 §1, §3.17 | `misc/proxy-basic-r2010-92`, `misc/proxy-basic-r2018-160`, `misc/proxy-basic-r2018-92`, `misc/proxy-basic-r2010-160` | open |
| Q-0692 | proxy | [A] Does AutoCAD omit proxy graphics (92/160 + 310) on native ACIS entities (3DSOLID/REGION/BODY) when saving DXF? | 03 §3.15 | `misc/solid-box-plan-r2000`, `misc/solid-box-plan-r2010`, `misc/solid-box-plan-r2013`, `misc/solid-box-plan-r2018` (+3 more) | answered |
| Q-0693 | proxy | [T] Does PLOT draw OLE2FRAME previews and ACAD_PROXY_ENTITY graphics (PROXYSHOW default)? | 11b §3, §15 | `misc/proxy-basic-r2010-92`, `misc/proxy-basic-r2018-160`, `misc/proxy-basic-r2018-92`, `misc/proxy-basic-r2010-160` (+2 more) | open |
| Q-0694 | proxy | [T] With $PROXYGRAPHICS=0 or missing enabler, what does AutoCAD plot for a custom object (bbox + class name text)? | 07 §15.3 (07:20) | `misc/proxy-no-graphics` | open |
| Q-0695 | proxy | [A] Does AutoCAD ignore proxy graphics (310) on known entity types (e.g. MULTILEADER from BricsCAD) and plot from entity data even when they disagree? | 07 §15.3; 05 §0 item 7, §12.5 (07:20, 05:T17) | plan: misc (png) — BricsCAD-written MLEADER with proxy graphic differing from native geometry | open |
| Q-0696 | proxy | [T] Does AutoCAD's native render match the proxy graphics for circles, arcs, text, wide LWPOLYLINE, incl. (0,0,-1) normals? | 11a §16 (11a:43) | plan: misc (png) — AutoCAD-authored MLEADERs/entities with proxy graphics: circle, arc, text, wide polyline, inverted normals | open |
| Q-0697 | proxy | [C] In proxy graphics SUBENT_LINETYPE (op 18), are sentinels 0xFFFFFFFF/0xFFFFFFFE (oda) or index+2/32766 (ezdxf) used for BYLAYER/BYBLOCK? | 07 §15.2, §17 (07:20) | `misc/proxy-linetype-0`, `misc/proxy-linetype-1`, `misc/proxy-linetype-2`, `misc/proxy-linetype-ffffffff` (+3 more) | open |
| Q-0698 | proxy | [A] Are proxy-graphic opcodes 15/17 LayerName/LineTypeName (PS name) variants honored by AutoCAD? | 07 §15.2 (07:20) | `misc/proxy-layer-name-15`, `misc/proxy-linetype-name-17` | open |
| Q-0699 | proxy | [C] Are proxy MESH/SHELL trait flag bits for layers/linetypes 0x2/0x4 (oda) or 0x100/0x200 (DevBlog)? | 07 §15.2, §17 (07:20) | plan: misc (png) — proxy SHELL with per-face layer traits under each flag variant | open |
| Q-0700 | proxy | [U] Do proxy sub-entity traits default to the host's layer/color/ltype/lw, and how are color 0 (BYBLOCK) and circle normal (0,0,-1) resolved in an INSERT? | 07 §15.3, §17; 11a §16 (07:20, 11a:43) | `misc/proxy-color-layer`, `misc/proxy-traits-default-in-insert` | open |
| Q-0701 | proxy | [U] Are proxy graphics coordinates of an entity inside a block in block coords, transformed by the INSERT matrix? | 07 §15.3, §17 (07:20) | `misc/proxy-traits-default-in-insert`, `misc/proxy-in-rotated-insert` | open |
| Q-0702 | proxy | [U] Do nested PUSH_MODELXFORM (op 29/30) matrices in proxy graphics compose with each other and the outer transform? | 07 §15.3, §17 (07:20) | `misc/proxy-nested-matrix` | open |
| Q-0736 | proxy | [U] How do gh109 wall/stair edges handle exact device-pixel ties (PDF geometry and stair hatch phase agree with stored data)? | 07 §15.7; 08 §10.2 | `fid-proxy-probes/wall-stair`, `fid-proxy-probes/stair-hatch`, `fid-proxy-followup/*-halfpixel` | open |
| Q-0737 | proxy | [U] Which font fields select opcode-38 tags when typeface is set but files are empty (AutoCAD plots SHX strokes; axis digits already agree within one pixel)? | 07 §15.7; 04 §14 | `fid-proxy-probes/tags`, `fid-proxy-probes/axis-one`, `fid-proxy-followup/tag-*` | answered |
| Q-0738 | proxy | [U] How does missing base-style bigfont suppression apply to mixed base/inline MTEXT runs (fully overridden runs are verified to draw)? | 07 §15.8; 04 §4.1 | `fid-proxy-probes/columns-room`, `fid-proxy-probes/inline-missing-base-bigfont`, `fid-proxy-followup/inline-mixed-*` | answered |
| Q-0739 | proxy | [T] Is FILLON consumed after SHELL/POLYGON/TEXT (POLYLINE survival and FILLMODE=0 outlines are verified)? | 07 §15.2, §15.7–15.8 | `fid-proxy-probes/fill-consumption`, `fid-proxy-probes/fill-explicit-control`, `fid-proxy-probes/shell-fillmode-zero`, `fid-proxy-followup/fill-after-*` | answered |
| Q-0740 | proxy fonts | [U] Which charset/pitch/file/bigfont rules select proxy fonts? Arial/134 selects SimSun; charset 0/1 stays Arial; empty extended requests use TXT; typeface wins; SHX missing bigfont suppresses. | 04 §16.1; 07 §15.9 | `proxy-font-selection/*` (26 successful cases); `fid-proxy-followup/tag-*` | answered |
| Q-0741 | proxy fonts | [U] Do other charsets/typefaces/style flags follow the same face rules, and why does file-only arial.ttf select Arial Italic despite zero italic flags? | 04 §16.1 | `proxy-font-selection/file-arial-c0`, `-c134`; additional controls not requested | open |

Answers and remaining limits Q-0736–Q-0739 (**VERIFIED-BY-ACAD**, `fid-proxy-probes`
and `fid-proxy-followup`, 2026-10-03; note 07 §15.7–15.8):

- Q-0739: FILLON persists after POLYLINE, SHELL, POLYGON and TEXT. FILLMODE=0
  outlines SHELLs. MESH and untested primitives/face traits remain outside this evidence.
- Q-0738: Missing base bigfont hides SHX base glyphs; CJK still links to SimSun
  (`font-resolution/simplex-missing-bigfont`, note 04 §15.1). Inline CD retains the same pen position
  as in a healthy AB/CD/EF control, so hidden AB still advances. Both CPU zooms are now
  pixel-exact. Vertical mixtures are not isolated.
- Q-0736: The wall half-pixel window is pixel-exact; the original wall PNG differs at
  pixel ties. Both stair-hatch windows have F1(r=1)=1 and the PDF phase/spacing matches.
  Device coverage/tie rules remain open; coordinate/phase changes are not justified.
- Q-0737: 宋体 with simplex.shx and simsun.ttc files is identical to the original
  localized-family tags, compatible with the shared localized-family FONTALT correction.
  The 26-case follow-up answers the typeface/charset rule (Q-0740, note 04 §16.1):
  resolved Arial with charset 134 selects SimSun; charset 0/1 stays Arial. Empty extended
  requests select TXT and unresolved localized typefaces select FONTALT. PDF extracted
  text can describe a different searchable text layer from the plotted SHX paths. The
  earlier selection uncertainty is resolved for these probes; raster fringes remain.

- Q-0692: Yes: DXFOUT writes 3DSOLID / REGION without 92/160 + 310 (`misc/solid-box-*`, `region-square-*`).
- Partial corpus answers (VERIFIED-BY-ACAD, 2026-10-03; note 07 §15.5): Q-0693's proxy-graphics
  part plots successfully in all four `corpus-proxy/*` cases; this does not answer OLE previews.
  Q-0700: initial owner **colour** is retained without a trait override (`arch-cn-1e85a`,
  `arch-cn-1e8ba`, `arch-cn-1e965`); other traits / INSERT cases remain open. Q-0697: gh109 uses
  32767 ByLayer and 32766 ByBlock (`corpus-proxy/gh109-floor-plan`); general index offsets and
  ODA sentinels remain open. Q-0696: these plots verify closed outlines, bulges and widths for
  +Z opcode 33; +Z opcode-38 text presence/position and filled SHELL columns are additionally
  verified in gh109 (§15.6), but exact font/raster behaviour and inverted normals remain open.
  Q-0701/Q-0702 are still open: the tested
  arch-cn windows target top-level proxies with identity PUSH_MODELXFORM.
- Every synthetic `misc/proxy-*` fixture still fails AutoCAD load (invalid-fixture); the remaining
  parts of Q-0691, Q-0693 … Q-0702 need valid discriminating fixtures (note 07 §15.4).

<a id="layouts"></a>
## Layouts and PLOTSETTINGS (`layouts`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0703 | layouts | [C] Does AutoCAD open an AC1015 file lacking LAYOUT objects and the ACAD_LAYOUT dictionary (ezdxf docs contradict)? | 01 §3.2, §10 item 7 (01:T2) | `fileformat/r2000-no-layouts` | open |
| Q-0704 | layouts | [U] Can AutoCAD/accoreconsole open and plot a layout lacking the overall viewport (69=1) or never initialized (70 bits 8192/16384, none_device)? | 08 §2.2 (note), §6.2, §7 item 9, §8 item 13; 11c §11 (overall viewport needed, netDxf#125 DraftSight) (08:T-ACC-3) | `layouts/no-overall`, `layouts/no-overall-initflags`, `layouts/no-overall-none-device`, `layouts/initflags-with-overall` | answered |
| Q-0705 | layouts | [A] Is paper-space (0,0) at the printable-area lower-left plus plot offset 46/47 when plotting with plot type Layout? | 08 §2.5, §5.1 (08:T-VP-11) | `layouts/area-layout-mm`, `layouts/area-window-mm`, `layouts/area-layout-mm-margins-offset`, `layouts/area-window-mm-margins-offset` (+4 more) | answered |
| Q-0706 | layouts | [U] For rotated layouts (73 = 1/2/3), are 44/45 swapped and margins rotated in the direction ezdxf assumes (rot 1: top=right...)? | 08 §2.5, §2.1 (73) (08:T-VP-11) | `layouts/area-layout-rotation-1`, `layouts/area-layout-rotation-2`, `layouts/area-layout-rotation-3` | open |
| Q-0707 | layouts | [U] In what order does AutoCAD write/show layout tabs when LAYOUT 71 tab orders are equal or non-consecutive (sorted by (71, name)?) | 08 §1.4 | `fileformat/layout-tab-order` | open |
| Q-0708 | layouts | [T] Do ENTITIES-section entities with 67=1 belong only to the active layout in multi-layout files? | 11b §14, Test ideas (11b:19) | `layouts/multi-plot-layout1`, `layouts/multi-plot-sheet2`, `layouts/multi-plot-sheet3` | answered |

- Q-0704: Yes: layouts without an overall viewport, with 70 bits 8192/16384 or none_device open and plot normally (`layouts/no-overall*`, `initflags-with-overall`).
- Q-0705: Plot area Layout on the raster device: paper (0,0) at the canvas lower-left (offset 0,0), 1 px per paper unit, Fit ignored (`layouts/area-layout-*`, note 08 §10.12).
- Q-0708: Yes: each layout plots only its own block's entities (`layouts/multi-plot-*`).

<a id="viewports"></a>
## Viewports (`viewports`)

| ID | topic | question | source | test | status |
|---|---|---|---|---|---|
| Q-0709 | viewports | [U] Does PLOT draw VIEWPORTs with status 68=0 or id 69=0 as normal viewports, and does AutoCAD recompute 68/69 on load? | 08 §3.2, §8 item 7; 11a §14, Open conflicts; 11b §14, Test ideas; 11c §11 (VIEWPORT 68/69 derived, 68 stacking order), §15 item 11, §18 #19 (08:T-VP-1, 08:T-VP-2, 11a:39, 11b:19) | `layouts/onoff-flag`, `layouts/status-sweep`, `layouts/status-all-zero`, `layouts/id-zero-minus1` (+5 more) | answered |
| Q-0710 | viewports | [A] Is VIEWPORT 90 bit 0x20000 (off) what stops a viewport plotting (neither frame nor content), independent of 68? | 08 §3.1.1, §3.2, §8 item 7; 11b §14, Test ideas (08:T-VP-1, 11b:19) | `layouts/onoff-flag` | answered |
| Q-0711 | viewports | [T] Does AutoCAD write VIEWPORT 68 = 0 for all viewports of a layout that was not activated before DXFOUT (ezdxf#1014)? | 08 §3.2 (08:T-VP-2) | `layouts/status-all-zero`, `layouts/multi-plot-layout1`, `layouts/multi-plot-sheet2`, `layouts/multi-plot-sheet3` | answered |
| Q-0712 | viewports | [A] Which VIEWPORT is treated as the overall paper-space viewport when 69 = 0/-1 everywhere: the first entity or a structural match? | 08 §3.2, §8 item 8 (08:T-VP-1) | `layouts/id-zero-minus1`, `layouts/ids-all-zero`, `layouts/ids-all-minus1`, `layouts/overall-last` (+1 more) | answered |
| Q-0713 | viewports | [A] Does PLOT draw all viewports when a layout has more than $MAXACTVP (64) viewports? | 01 §7.2 | `layouts/maxactvp-64`, `layouts/maxactvp-2` | answered |
| Q-0714 | viewports | [A] Are overlapping viewports plotted in entity order (later on top) rather than in status (68) order? | 08 §3.2, §3.10, §8 item 9 (08:T-VP-8) | `layouts/ps-over-vp-psfirst-n`, `layouts/ps-over-vp-psfirst-y`, `layouts/vp-overlap-order-ab`, `layouts/vp-overlap-order-ba` (+1 more) | answered |
| Q-0715 | viewports | [A] For a paper-space VIEWPORT on a frozen layer, is the viewport content hidden in PLOT (and on an off layer only the border hidden)? | 02 §2.1.1 | `layouts/vp-on-off-layer`, `layouts/vp-on-frozen-layer` | answered |
| Q-0716 | viewports | [U] Is the VIEWPORT border plotted with its own color/linetype/lineweight, and omitted when its layer is off/frozen/no-plot (290=0)? | 06 §7.2; 08 §3.6, §5.6; 11a §14 (06:R5, 08:T-VP-10, 11a:39) | `layouts/vp-on-off-layer`, `layouts/vp-on-frozen-layer`, `layouts/frame-layer-props`, `layouts/frame-noplot` (+1 more) | answered |
| Q-0717 | viewports | [U] Does PLOTSETTINGS 70 bit 1 (PlotViewportBorders) suppress or enable plotting of VIEWPORT frames? | 08 §2.2 (bit 1), §8 item 11 (08:T-VP-10) | `layouts/frame-plotflag-bit1-0`, `layouts/frame-plotflag-bit1-1` | answered |
| Q-0718 | viewports | [A] Does PLOT honour VIEWPORT frozen layers (331/341) and per-VP layer color/lw/linetype/transparency overrides (layer xdict XRECORDs) only inside that VIEWPORT? | 08 §3.7; 11a §4, §14; 02 §2.1.3 (08:T-VP-9, 11a:39, 02:T3) | `layouts/vpfreeze`, `layouts/vpfreeze-both-globally-off`, `layouts/vpoverride-color-aci`, `layouts/vpoverride-color-rgb` (+6 more) | answered |
| Q-0719 | viewports | [U] Does AutoCAD ignore VIEWPORT group 1 (plot style sheet) when plotting, using only the layout's CTB? | 08 §3.1 (code 1); 06 §6.1 | `layouts/vp-plotstyle-name` | answered |
| Q-0720 | viewports | [C] Does a VIEWPORT twist (51) of +30 deg rotate model content CCW on paper (ezdxf +twist) or CW (mlightcad -twist)? | 08 §0 item 3, §3.1, §3.5, §3.11, §8 item 6 (08:T-VP-4) | `layouts/viewcenter-target-offset-twist30`, `layouts/twist-0`, `layouts/twist-15`, `layouts/twist-30` (+9 more) | answered |
| Q-0721 | viewports | [T] Is VIEWPORT 12 (view center) interpreted in DCS relative to target 17 (and rotated by twist) when PLOT maps model to paper? | 08 §0 item 2, §3.1, §3.5 (08:T-VP-4) | `layouts/viewcenter-target-center`, `layouts/viewcenter-target-offset`, `layouts/viewcenter-target-and-vc-wcs`, `layouts/viewcenter-target-offset-twist30` (+3 more) | answered |
| Q-0722 | viewports | [A] For a non-plan VIEWPORT view direction, are the DCS X/Y axes the arbitrary-axis-algorithm axes of the view direction (then twisted), as PLOT renders them? | 03 §2.1; 08 §3.4, §3.5, §8 item 6 (08:T-VP-6) | `layouts/view3d-top`, `layouts/view3d-top-nonnormalized`, `layouts/view3d-bottom`, `layouts/view3d-se-iso` (+11 more) | answered |
| Q-0723 | viewports | [U] Does a bottom view (VIEWPORT 16 = 0,0,-1) plot with mirrored X (Xd = -1,0,0) or with an extra twist? | 08 §3.4 (08:T-VP-6) | `layouts/view3d-bottom` | answered |
| Q-0724 | viewports | [T] Does AutoCAD normalize a non-normalized VIEWPORT view direction (e.g. 0,0,5) and plot it as a top view? | 08 §3.1 (16/26/36) (08:T-VP-6) | `layouts/view3d-top-nonnormalized`, `layouts/view3d-se-iso-nonnormalized` | answered |
| Q-0725 | viewports | [U] How does PLOT render a perspective VIEWPORT (90 bit 0x1) from lens length 42 and target/direction? | 08 §3.5 | `layouts/view3d-perspective` | open |
| Q-0726 | viewports | [T] Do VIEWPORT front/back clip planes (43/44, flags 0x2/0x4) cut geometry at depth > front / depth < back from the target? | 08 §3.5 | `layouts/clipplanes-front-back`, `layouts/clipplanes-front-at-eye-back`, `layouts/clipplanes-back-only` | answered |
| Q-0727 | viewports | [U] With a multi-tile *ACTIVE VPORT configuration, which tile defines the model view for plot type Display (first entry, $CVPORT, largest)? | 02 §2.4, §6 | plan: layouts (png) — Two *ACTIVE VPORT entries with different centers/heights, first one not the largest; model plot type Display | open |
| Q-0728 | viewports | [T] For a plan-view *ACTIVE VPORT with twist, does plot type Display use center/height(40)/aspect(41) and fit height or width when aspect differs? | 02 §2.4 (02:T12) | plan: layouts (png) — *ACTIVE center (100,50), height 40, aspect 2, twist 30; model plot type Display on paper of different aspect | open |
| Q-0729 | viewports | [U] How does plot type Display map *ACTIVE VPORT center 12/22 (DCS), target 17, view direction and twist 51 to the plotted window? | 02 §2.4; 11b §4, Test ideas (02:T12, 11b:17) | plan: layouts (png) — *ACTIVE with direction (1,1,1), target (10,5,0), center (3,2), height 40; plot type Display | open |
| Q-0730 | viewports | [A] Does a non-rectangular VIEWPORT (90 0x10000, 340 entity) clip content to the entity, is the entity plotted with its own props, and does it clip on a no-plot layer? | 08 §3.6; 11a §14 (08:T-VP-5, 11a:39) | `layouts/clip-polygon`, `layouts/clip-polygon-noplot`, `layouts/clip-polygon-red-lw50`, `layouts/clip-bulge` (+4 more) | answered |
| Q-0731 | viewports | [A] With a non-rectangular clip entity, does PLOT omit the VIEWPORT's own 40/41 rectangle frame? | 08 §3.6, §8 item 11 (08:T-VP-5) | `layouts/clip-polygon-red-lw50`, `layouts/clip-bulge`, `layouts/clip-circle`, `layouts/clip-ellipse` (+1 more) | answered |
| Q-0732 | viewports | [A] Can a REGION (besides LWPOLYLINE/CIRCLE/ELLIPSE/closed SPLINE) serve as a VIEWPORT clip entity (340) that PLOT honours? | 08 §3.6 (08:T-VP-3) | plan: layouts (png) — Viewport with 90 bit 0x10000 and 340 -> REGION; compare with LWPOLYLINE clip | open |
| Q-0733 | viewports | [A] After DXFOUT, are VIEWPORT 40/41/10 of a polygonal viewport equal to the bbox of the clip entity? | 08 §3.6 (08:T-VP-5) | `layouts/clip-bbox-mismatch` | open |
| Q-0734 | viewports | [A] Are thick-lineweight strokes crossing a viewport border cut straight at the border (no round cap)? | 08 §3.6, §8 item 12 (08:T-VP-3) | `layouts/clip-thick-rect`, `layouts/clip-thick-bulge` | answered |
| Q-0735 | viewports | [U] Are SHX/TTF text and pattern/solid hatches crossing a viewport border clipped partially (geometric cut) in PLOT? | 08 §3.6, §8 item 12 (08:T-VP-3) | `layouts/clip-text-hatch-rect`, `layouts/clip-text-hatch-circle`, `layouts/clip-text-hatch-spline` | answered |

- Q-0709: 68 = 0 is off (content not plotted, frame plotted); −1, 1, 2 … plot; AutoCAD rewrites 90 bit 0x20000 from 68 on load (`layouts/status-*`, `onoff-flag` + DXFOUT).
- Q-0710: No: 90 bit 0x20000 with 68 = 1 plots; 68 is the switch in the active layout (`layouts/onoff-flag`).
- Q-0711: Yes: DXFOUT writes 68 = 0 and 69 = 0 for all user viewports of non-activated layouts (`layouts/multi-plot-*` DXFOUT).
- Q-0712: The VIEWPORT with 69 = 1 wherever it is; without one, all are model viewports and AutoCAD creates a new overall viewport (`layouts/ids-*`, `overall-*`).
- Q-0713: Yes: all viewports plot regardless of $MAXACTVP (`layouts/maxactvp-*`).
- Q-0714: Neither: the later-created viewport (higher handle/id) is on top, independent of entity order and 68 (`layouts/vp-overlap-*`).
- Q-0715: No: on an off or frozen layer only the frame disappears; the content plots (`layouts/vp-on-*-layer`).
- Q-0716: The frame plots in the VIEWPORT colour, always 1 px continuous (lineweight/linetype ignored), omitted on off/frozen/no-plot/Defpoints layers (`layouts/frame-*`, `vp-on-*`).
- Q-0717: Neither: 70 bit 1 has no effect (`layouts/frame-plotflag-bit1-*`).
- Q-0718: Yes: 331 frozen layers and colour/lineweight/linetype overrides apply only inside that viewport (`layouts/vpfreeze*`, `vpoverride-*`).
- Q-0719: Yes: VIEWPORT 1 is ignored (`layouts/vp-plotstyle-name`).
- Q-0720: CCW (ezdxf sign) (`calibration/vp-twist`, `layouts/twist-*`).
- Q-0721: Yes: 12 is in the twisted DCS relative to 17 (`layouts/viewcenter-*`).
- Q-0722: Yes: arbitrary-axis DCS of the view direction, then twist (`layouts/view3d-*`).
- Q-0723: Mirrored X (Xd = −1,0,0), no extra twist (`layouts/view3d-bottom`).
- Q-0724: Yes: the direction is normalized (`layouts/view3d-*-nonnormalized`).
- Q-0726: Depth = direction · (P − target): back (0x4) keeps depth ≥ 44; front (0x2) keeps depth ≤ 43 with 0x10, depth ≤ 0 without (`layouts/clipplanes-*`).
- Q-0730: Yes: content clipped to the entity, the entity plots with its own properties, and it clips on a no-plot layer too (`layouts/clip-*`).
- Q-0731: Yes: no rectangle frame for polygonal viewports (`layouts/clip-*`).
- Q-0734: Yes: cut straight at the border; a stroke lying on a polygon edge vanishes entirely (`layouts/clip-thick-*`).
- Q-0735: Yes: text and hatches are cut at the border (the per-pixel result matches a geometric cut) (`layouts/clip-text-hatch-*`).
