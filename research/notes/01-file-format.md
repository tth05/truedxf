# 01 — DXF container format and cross-cutting infrastructure

Scope: everything below the entity level that a truedxf parser/writer needs. Covers the tagged
ASCII format, binary DXF, sections, versions, text encoding, handles/ownership/app-data/XDATA/
embedded objects, the HEADER section, robust parsing of broken files, and round-tripping.
Entity-specific semantics (TEXT, MTEXT, HATCH, …), tables and layouts belong in other notes;
they are only mentioned where they affect the container.

Source abbreviations used below:

| Abbrev. | Path |
|---|---|
| `spec` | `research/spec/autocad_2012_dxf_reference.txt` (line numbers `spec:L1234`) |
| `spec-online` | help.autodesk.com AutoCAD 2024 DXF reference, header page `GUID-A85E8E67-27CD-4C59-BE61-4DC9FADBE74A` (fetched 2026-09-30) |
| `oda` | `research/spec/OpenDesign_Specification_for_.dwg_files.txt` |
| `ezdxf:` | `research/repos/ezdxf/src/ezdxf/…` (docs: `ezdxf-docs:` = `research/repos/ezdxf/docs/source/…`, notes: `ezdxf-notes:` = `research/repos/ezdxf/notes/pages/…`) |
| `ixm:` | `research/repos/ixmilia-dxf/src/IxMilia.Dxf/…`; `ixm-spec:` = `…/IxMilia.Dxf.Generator/Specs/…`; `ixm-rs:` = `research/repos/ixmilia-dxf-rs/src/…` |
| `acs:` | `research/repos/ACadSharp/src/ACadSharp/…`; `acs-samples:` = `research/repos/ACadSharp/samples/…` |
| `lrd:` | `research/repos/libredwg/src/…` (GPL, facts only) |
| `ldxfrw:` | `research/repos/libdxfrw/src/…` (GPL, facts only) |
| `dxf-parser:`, `dxf-viewer:`, `dxf-json:`, `netdxf:` | respective repos under `research/repos` |
| `ezdxf#N`, `acs#N`, `lrd#N`, … | GitHub threads under `research/github/raw/<owner>__<repo>/threads/` |

About `acs-samples:sample_AC10xx_{ascii,binary}.dxf`: the same drawing saved in every DXF version
and in ASCII and binary. `$LASTSAVEDBY` is a person's user name, which suggests AutoCAD wrote them.
Where this note says "AutoCAD output", this is the corpus it means. (**ASSUMPTION**: they're genuine
AutoCAD output; nobody in the threads says so explicitly.)

---

## 0. TL;DR for the parser design

1. Read the file as **bytes**. Check for the 22-byte binary sentinel. Otherwise split lines at
   the byte level (`\r\n`, `\n`, lone `\r`). Group codes, numbers, handles and structure names
   are ASCII, so only string values need decoding, and that can be deferred until the encoding
   is known ($ACADVER/$DWGCODEPAGE can sit anywhere in HEADER, and in R12 `$DWGCODEPAGE` is near
   the *end* of HEADER).
2. Tag = (int code, raw value). Get the value type from the group code (§1.2). Unknown codes
   are strings. Trim group-code lines and numeric values. For string values strip only the line
   terminator, except for "structural" strings (code 0, section/table names, code 9 names),
   which are trimmed (and compared case-insensitively in recover mode).
3. An entity is the run of tags from one `(0, X)` to the next `(0, …)`. Within an entity, split
   into: base part (before first `100`), subclasses (`100`), app-data groups (`102 {…` … `102 }`),
   an embedded object (`101 Embedded Object`), and XDATA (from the first `1001` to the end).
   Store subclasses as an **ordered list**, not a map (TEXT has two `AcDbText` subclasses,
   ezdxf:lldxf/extendedtags.py `_setup` comment).
4. Handles are up to 16 hex digits, i.e. 64 bit. In TS keep them as normalized uppercase strings
   (or `bigint`), **never** `number`.
5. Build a lenient mode on the pattern of `ezdxf.recover` (§8): merge duplicate sections, rebuild
   TABLES, fix coordinate order, recover `"1.0"`-style ints, decode `\U+`/`\M+`. The renderer must
   work on files that AutoCAD itself refuses, but it must also *know* which ones AutoCAD refuses
   if we want to match AutoCAD.
6. For AC1021+ decode as UTF-8. Otherwise use `$DWGCODEPAGE` (default ANSI_1252), with a
   "valid UTF-8" fallback heuristic for mislabeled files (§5.5). Decode bytes to Unicode
   **before** interpreting any backslash escapes, because DBCS trail bytes can be 0x5C `\`.

---

## 1. Tagged ASCII format

### 1.1 Basic syntax

- A file is a sequence of *tags* (group code/value pairs). Each takes **two lines**: the group
  code (an integer), then the value (spec:L10353ff "Group Codes in DXF Files";
  ezdxf-docs:dxfinternals/dxftags.rst).
- Structure markers are `(0, SECTION)`, `(2, <name>)`, `(0, ENDSEC)`, `(0, TABLE)`, `(0, ENDTAB)`,
  `(0, BLOCK)`, `(0, ENDBLK)`, `(0, SEQEND)`, `(0, EOF)`.
- The end of an entity is only signalled by the next `0` tag (spec:L300ff "Object and Entity Codes").
- The spec advises table-driven parsing, ignoring undefined group codes and not assuming tag
  order (spec:L310ff). **CONFLICT:** in reality order matters in many places (§6.3), and AutoCAD
  itself rejects undefined group codes in some contexts. Example: `330` owner tags in an R12
  VERTEX give "Undefined group code 330 for object on line 1578. Invalid or incomplete DXF input
  -- drawing discarded." (ixmilia#72, **VERIFIED-BY-ACAD** AutoCAD 2015/TrueView 2018).

**AutoCAD output formatting** (from `acs-samples`, byte dump via `od -c`):

- Line ending `\r\n` (CRLF) everywhere, including after `EOF` (the file ends `0\r\nEOF\r\n`).
- Group codes are right-aligned in a 3-character field: `"  0"`, `" 10"`, `"100"`, `"1001"`
  (4 digits, no padding).
- Integers (16/32-bit) in R12–R2007 output are right-aligned in a 6-character field:
  `"     1"`, `"    20"`. 32-bit values (90–99) are right-aligned in a 9-character field
  (`"        0"` in CLASS 90/91 of the AC1032 sample). R2018 uses the same widths (the squeezed
  display above was mine). → Parsers must `trim()` numeric lines.
- Floats: R2000+ writes the shortest form of up to ~16 significant digits (`-566.1685822008871`,
  `1.570796326794896`, `0.0`, `12.0`). The R12 (AC1009) output of the same drawing uses 16
  **decimal places** with trailing zeros trimmed (`-566.1685822008870446`, `-5.0916887568732809`).
  Integral values are written as `0.0`, `1.0`. `$TDINDWG` has fixed 10 decimals (`0.4023958333`).
  Other producers write `1e+20`, `1.0E+20`, `.5`, `-0` and so on, so accept everything that
  C `strtod` accepts.
- Empty strings are written as an **empty value line** (for example `$DIMPOST`, `$DIMBLK1`,
  `$UCSNAME` in the AC1032 sample). An empty line in *value* position is therefore valid. An empty
  line in *code* position is an error: ixm:DxfTextReader.cs stops parsing, and ezdxf#1289 found
  that a stray blank line after a TEXT value makes the file unreadable by AutoCAD 2024/TrueView
  and BricsCAD (**VERIFIED-BY-ACAD** via mozman's comment).
- AutoCAD does not write comments (999) (spec:L676 "SAVEAS does not include such groups").
  OPEN honours and skips them.

### 1.2 Group code ranges → value types (complete)

Merged from spec:L321-419 (value types) and spec:L421-700 (numerical order), cross-checked with
ezdxf:lldxf/types.py, ixm:DxfCodePair.ExpectedType.cs, acs:GroupCodeValue.cs and
dxf-parser:src/DxfArrayScanner.ts.

| Codes | Type (ASCII) | Binary encoding (R13+) | Meaning / notes |
|---|---|---|---|
| −5…−1 | — | — | APP only (AutoLISP/ObjectARX): −1 entity name, −2 entity name ref, −3 XDATA sentinel, −4 ssget operator, −5 reactor chain. **Never in files** (spec:L455ff). ezdxf uses negative codes internally for compressed tags (ezdxf:lldxf/const.py `COMPRESSED_TAGS = -10`). |
| 0 | string | NUL-terminated string | Entity/structure type (fixed) |
| 1 | string | str | Primary text value |
| 2 | string | str | Name (block, tag, section, table, …) |
| 3–4 | string | str | Other text/name values; MTEXT continuation chunks use 3 |
| 5 | string (hex handle) | str | Entity handle, ≤16 hex digits (fixed). **Exception**: in DIMSTYLE records the handle is **105**, because code 5 there held DIMBLK (ezdxf-docs:dxfinternals/handles.rst) |
| 6 | string | str | Linetype name (fixed) |
| 7 | string | str | Text style name (fixed) |
| 8 | string | str | Layer name (fixed) |
| 9 | string | str | Header variable name. **CONFLICT:** spec says "used only in HEADER", but LTYPE complex-linetype elements use code 9 for the text string (AC1032 sample: `LTYPE … 9 GAS`). Treat 9 as a variable name only inside HEADER. |
| 10–18 | double | 8-byte IEEE LE | X of points; the Y/Z codes are +10/+20 |
| 20–28, 30–37 | double | 8 | Y and Z |
| 38 | double | 8 | Elevation (LWPOLYLINE etc.) — **not** a Z of 18 (ezdxf:lldxf/repair.py removes 38 from the invalid-Z set) |
| 39 | double | 8 | Thickness (fixed) |
| 40–48 | double | 8 | Floats; 48 = entity linetype scale |
| 49 | double | 8 | Repeated value (LTYPE dash lengths), preceded by a 7x count |
| 50–58 | double | 8 | Angles in **degrees** in DXF (radians in APP) |
| 59 | double | 8 | (in 40–59 range) |
| 60–79 | int16 | 2 | 60 visibility, 62 ACI color, 66 "entities follow", 67 paperspace, 68/69 viewport, 70–78 flags/counts |
| 80–89 | *undefined* | — | Not in any range → treat as string (ixm/ezdxf default) |
| 90–99 | int32 | 4 | 32-bit ints (signed) |
| 100 | string | str | Subclass marker (spec says ≤255 chars) |
| 101 | string | str | Embedded object marker `"Embedded Object"` (R2018; ezdxf-docs:dxftags.rst); also a normal data code in ACDSDATA (`101 ACDSRECORD`, ezdxf:sections/acdsdata.py). Not in the 2012 spec table |
| 102 | string | str | Control string `{name` / `}` for app-data groups; ordinary data inside XRECORD (§6.2) |
| 103–104 | *undefined* | — | string fallback |
| 105 | string (hex handle) | str | DIMSTYLE handle |
| 106–109 | *undefined* | — | string fallback (dxf-parser treats 100–109 as strings) |
| 110–112 | double | 8 | UCS origin/X-axis/Y-axis (VPORT/VIEW, when 72=1) |
| 113–119 | double | 8 | |
| 120–139 | double | 8 | Y and Z of 110–119 |
| 140–149 | double | 8 | Scalar doubles (DIMSTYLE etc.) |
| 150–159 | *undefined* | — | string fallback |
| 160–169 | int64 | 8 | 64-bit ints (`$REQUIREDVERSIONS`, proxy graphic size in R2013+). **TS: use `bigint`** or check `Number.isSafeInteger` |
| 170–179 | int16 | 2 | DIMSTYLE flags |
| 180–209 | *undefined* | — | string fallback |
| 210–239 | double | 8 | 210/220/230 extrusion (fixed); 211–239 other vectors |
| 240–269 | *undefined* | — | string fallback |
| 250 | (unofficial) int16 | — | "used in POLYLINEs by CLO" (ixm:DxfCodePair.ExpectedType.cs) |
| 270–279 | int16 | 2 | |
| 280–289 | int16 | **2** | Spec: 16-bit. AutoCAD's binary output uses 2 bytes (AC1015/AC1032 binary sample: `$ENDCAPS` = `18 01 00 00`). acs:GroupCodeValue.cs types them as `Byte`, which is wrong for binary |
| 290–299 | bool | **1 byte** | ASCII `0`/`1` (AutoCAD pads it: `"     1"`). Binary: 1 byte (AC1032 binary `$LWDISPLAY` = `22 01 00`). ixm-rs reads 2 bytes in pre-R13 binary (irrelevant: R12 has no 29x codes) |
| 300–309 | string | str | Arbitrary text |
| 310–319 | binary chunk | 1-byte length + bytes | Hex string in ASCII; ≤127 bytes (≤254 hex chars) per tag (spec:L650). AutoCAD output never exceeds 254 hex chars (measured over 187 files in the repos). A 256-byte claim in ezdxf-notes:"DXF Binary Chunk Interpretation.md" is wrong/unsupported |
| 320–329 | handle | str | **Arbitrary** handle, not translated on INSERT/XREF |
| 330–339 | handle | str | **Soft pointer**; 330 in the base part = owner |
| 340–349 | handle | str | **Hard pointer** |
| 350–359 | handle | str | **Soft owner** |
| 360–369 | handle | str | **Hard owner** |
| 370–379 | int16 | 2 | Lineweight enum; entities use only 370 as their lineweight, 371–379 for others (spec:L620ff) |
| 380–389 | int16 | 2 | PlotStyleName type enum; 380 = entity's |
| 390–399 | handle | str | PlotStyleName object handle (a hard pointer, separate range for compatibility); 390 = entity's |
| 400–409 | int16 | 2 | |
| 410–419 | string | str | 410 = layout name (VIEWPORT, LAYOUT) |
| 420–429 | int32 | 4 | True color `0x00RRGGBB` (spec says 420–427). `(r<<16)|(g<<8)|b`, e.g. 200,100,50 → 13132850 (spec:L640) |
| 430–439 | string | str | Color name (color-book "BOOK$NAME") (spec says 430–437) |
| 440–449 | int32 | 4 | Transparency: `0x020000TT` where TT = alpha 0 (transparent)…255 (opaque); `0x01000000` = BYBLOCK (ezdxf:lldxf/const.py `TRANSPARENCY_BYBLOCK`, validator.py `is_transparency`). Spec says 440–447 |
| 450–459 | int32 ("Long") | 4 | ezdxf: signedness unknown (ezdxf:lldxf/types.py comment) |
| 460–469 | double | 8 | |
| 470–479 | string | str | |
| 480–481 | handle | str | Hard pointer |
| 482–998 | *undefined* | — | string fallback |
| 999 | string | — | Comment. Must be skipped by readers. **Not allowed in binary DXF** (spec:L10880) |
| 1000 | string | str | XDATA string, ≤255 **bytes** (+NUL) |
| 1001 | string | str | XDATA APPID; starts an XDATA group; ≤31 bytes by spec |
| 1002 | string | str | XDATA control `{` or `}` |
| 1003 | string | str | XDATA layer name (translated on merge) |
| 1004 | binary chunk | length byte + bytes | XDATA binary, ≤127 bytes/chunk. **CONFLICT:** ixmilia types 1004 as string (ixm:DxfCodePair.ExpectedType.cs `1000–1009 → string`), ezdxf as binary (`BINARY_DATA` includes 1004). Binary DXF needs the binary form, so type it as binary |
| 1005 | handle | str | XDATA handle, soft-pointer semantics, translated on INSERT/XREF/EXPLODE; AUDIT sets dangling ones to `0` (spec:L11229ff) |
| 1006–1009 | string | str | (range 1000–1009 = string) |
| 1010/1020/1030 | double | 8 | XDATA 3D point, **never transformed** |
| 1011/1021/1031 | double | 8 | World-space **position**: moved, scaled, rotated, mirrored, stretched with parent |
| 1012/1022/1032 | double | 8 | World-space **displacement**: scaled, rotated, mirrored (not moved/stretched) |
| 1013/1023/1033 | double | 8 | World-space **direction**: rotated, mirrored (not moved/scaled/stretched). Spec typo: "followed by 1022 and 1032" (spec:L689) |
| 1014–1019, 1024–1029, 1034–1039 | double | 8 | In range; no defined meaning |
| 1040 | double | 8 | Real |
| 1041 | double | 8 | Distance, scaled with parent |
| 1042 | double | 8 | Scale factor, scaled with parent |
| 1043–1059 | double | 8 | In range |
| 1060–1070 | int16 | 2 | 1070 = XDATA 16-bit int ("signed or unsigned") |
| 1071 | int32 | 4 | XDATA 32-bit signed long. Note: the spec's own example writes `1071 1.95059E+06` (spec:L11380ff), so accept floats in integer fields |
| ≥1072 | invalid | — | ezdxf `MAX_GROUP_CODE = 1071`; recover's `synced_bytes_loader` treats ≥1072 as garbage |

**Implementation table for truedxf** (the same partition as ezdxf's `TYPE_TABLE`, plus binary sizes):

```
DOUBLE : 10-59, 110-149, 210-239, 460-469, 1010-1059
INT16  : 60-79, 170-179, 270-289, 370-389, 400-409, 1060-1070
INT32  : 90-99, 420-429, 440-459, 1071
INT64  : 160-169
BOOL   : 290-299            (binary: 1 byte)
BINARY : 310-319, 1004      (binary: uint8 length + bytes)
HANDLE : 5, 105, 320-369, 390-399, 480-481, 1005   (string in both ASCII and binary)
STRING : everything else (0-9, 100-102, 300-309, 410-419, 430-439, 470-479, 999, 1000-1003, 1006-1009, undefined codes)
POINT X-codes (followed by +10, optional +20): 10-18, 110-112, 210-213, 1010-1013
```

ezdxf `POINT_CODES` (ezdxf:lldxf/types.py) = {10…18, 110, 111, 112, 210, 211, 212, 213, 1010…1013}.
Don't auto-group 19/29/39 or 38. LWPOLYLINE vertices are *2D* points (10/20 without 30), so the
point assembler must support "x, y, then the next tag is not z".

**Special values:**

- ACI color (62): 0 = BYBLOCK, 256 = BYLAYER, 257 = BYENTITY/BYOBJECT (ezdxf:lldxf/const.py);
  negative = layer off (LAYER table). Valid range 0–257 (validator.py `is_valid_aci_color`).
- Lineweight (370): −1 BYLAYER, −2 BYBLOCK, −3 DEFAULT; otherwise 1/100 mm, one of
  0,5,9,13,15,18,20,25,30,35,40,50,53,60,70,80,90,100,106,120,140,158,200,211
  (ezdxf:lldxf/const.py `VALID_DXF_LINEWEIGHTS`; validator.py `fix_lineweight` rounds up to the
  next valid value and clamps at 211).

### 1.3 Line endings, whitespace, padding

- AutoCAD writes CRLF. Real files contain LF-only (Unix tools, ezdxf's text mode on Linux) and
  occasionally CR-only (classic Mac).
- ezdxf's normal loader opens the file in Python text mode, which uses universal newlines, so
  CR-only works (ezdxf:filemanagement.py `open(..., mode="rt")`). **But** `ezdxf.recover` reads
  bytes with `readline()`, which splits on `\n` only (ezdxf:recover.py `bytes_loader`), so a
  CR-only file becomes one giant line in recover mode and fails.
- dxf-parser and dxf-viewer split with `/\r\n|\r|\n/` (dxf-parser:src/DxfParser.ts:218,
  dxf-viewer:src/parser/DxfParser.js:108).
- **truedxf rule:** a line ends at `\r\n`, `\n`, or a lone `\r`. Raw CR/LF can never be *inside*
  a value because AutoCAD caret-escapes them (§1.5). Edge case: `\r\r\n` (double conversion).
  Treating it as CR + CRLF gives an extra empty line and desynchronizes the pairs. Recover mode
  should detect a code line that is empty or non-numeric and try resyncing (see
  `synced_bytes_loader`, §8).
- Group-code lines: trim both sides. AutoCAD pads them on the left (`"  0"`). Python `int()`,
  .NET `int.TryParse(NumberStyles.Integer)` and JS `parseInt` all accept surrounding whitespace.
- Numeric values: trim. ixmilia even strips *inner* spaces for doubles
  (`s.Replace(" ", "")`, ixm:DxfTextReader.cs `TryParseDoubleValue`).
- String values:
  - Spec: "string items should not have leading spaces unless these are intended to be part of the
    string" (spec:L10830ff). So **leading spaces are significant**.
  - lrd#1285: libredwg stripped leading whitespace, which broke MTEXT chunks starting with a space
    (joined words).
  - **Wrong-by-design implementations:** ixmilia trims every string (`valueLine.Trim()`,
    ixm:DxfTextReader.cs), and dxf-parser trims every value (`.trim()`,
    dxf-parser:src/DxfArrayScanner.ts:45,68).
  - ezdxf strips only `\n` (text mode) or `\r\n` (recover), and strips code-0 values
    (`tag_compiler`: `if code == 0: value = x.value.strip()`); recover additionally upper-cases
    code-0 values (`byte_tag_compiler`: `.strip().upper()`).
  - **UNKNOWN / needs AutoCAD test:** does AutoCAD strip trailing spaces of string values (TEXT
    content, layer names)? Symbol-table name lookup in mlightcad trims and compares
    case-insensitively "per AutoCAD convention" (mlightcad-realdwg-web#131, not verified).
- Tabs: AutoCAD keeps a literal TAB (0x09) inside strings in some places, but writes `^I` in
  MTEXT (ezdxf#170: "tab character … did get encoded as `^I`"; lrd#1314 says "Tab stays literal, as
  AutoCAD keeps it"). Accept both.

### 1.4 Number formats seen in the wild

| Seen | Source | Handling |
|---|---|---|
| Ints written as floats `"1.0"` in int16/int32 codes | ProE (ezdxf:lldxf/tagger.py `tag_compiler` comment "ProE stores int values as floats") | `int(float(v))` fallback |
| Trailing garbage `"42xyz"`, `"47.11xyz"` | ezdxf:recover.py `_search_int`/`_search_float` emulate C `stoll`/`stod` ("just stop converting at the first invalid char") | regex-extract the leading number in lenient mode |
| Whitespace inside floats | ezdxf `_strip_whitespace` in `recover_float`, ixmilia `Replace(" ","")` | strip all whitespace |
| `1e999` → inf, `int(inf)` → OverflowError | ezdxf#1403/#1406 | treat as a structure error, or clamp in lenient mode |
| `1.95059E+06` in 1071 | spec example (spec:L11380ff) | float → int fallback |
| Decimal comma (`"1,5"`) | Locale bugs in .NET writers (netDxf#63 concerns .pat parsing) | **UNKNOWN** whether AutoCAD accepts it (probably not). Lenient mode: if the float parse fails and the value matches `^-?\d+,\d+$`, replace the comma |
| 15-significant-digit output (not round-trip safe) | acs#1179 (ACadSharp writer) | Writer: use the shortest round-trip repr (JS `String(x)` is fine) |
| Bool as `"0"`/`"1"` padded | AutoCAD | ixmilia parses bools as double then `!= 0` (ixm:DxfTextReader.cs), dxf-parser throws on anything but `'0'`/`'1'` (dxf-parser:src/DxfArrayScanner.ts `parseBoolean`) → use lenient `!= 0` |

JS pitfall: `Number("")` is `0` and `Number(" ")` is `0`. Don't use `Number()` for validation.
Use `parseFloat` plus a regex check, or a hand-written scanner.

### 1.5 String length limits and escaping

- **Lengths:**
  - Spec (2012): codes 0–9 "255-character limit has been increased to 2049 single-byte characters
    not including the newline" since AutoCAD 2000 (spec:L330); 100/102 ≤255; 1000 ≤255 bytes;
    1001 ≤31 bytes.
  - Spec chapter 9 still says "maximum DXF file string length is 256 characters … OPEN and INSERT
    fail if your DXF file contains strings that exceed this number" (spec:L10361ff).
    **CONFLICT/outdated** with the 2049 statement.
  - ezdxf: `MAX_STR_LEN = 255` (R12), `EXT_MAX_STR_LEN = 2049` (R2000+) (ezdxf:lldxf/const.py:203);
    ezdxf recommends ≤255 for safety (ezdxf-docs:dxftags.rst).
  - MTEXT splits text into chunks of 250 characters: `3` tags, then the final `1` tag
    (ezdxf-docs:dxftags.rst "Multi tag text"). A chunk boundary must not split `^x` (ezdxf
    `split_mtext_string` backs off one char if a chunk ends in `^`, ezdxf:tools/text.py:517) and
    should not split a `\U+XXXX` escape (lrd#1314: a split `\U+` crashed ezdxf).
    **VERIFIED-BY-ACAD:** AutoCAD 2024 decodes a `\M+` escape that is split across a `3` chunk
    and the following `1` chunk (ezdxf#1322). So escapes are decoded on the **concatenated**
    string, not per tag.
  - Other long strings use continuation tags with the same or neighbouring code. GEODATA uses
    `303` chunks with `^J` line endings (ezdxf:lldxf/tags.py `text_to_multi_tags`, code=303,
    size=255). libredwg found AutoCAD uses `dxf + 2` (301 → 303) for continuations
    (lrd#1314 item 4).
  - **Parser rule:** impose **no** line-length limit (libredwg-produced files have longer lines;
    tolerate them).
- **Caret encoding of control characters** (spec:L10373 "ASCII Control Characters in DXF Files"):
  "SAVEAS handles ASCII control characters in text strings by expanding the character into a caret
  (^) followed by the appropriate letter … If the text itself contains a caret character, it is
  expanded to caret, space". So:
  - `^@`=0x00, `^A`…`^Z` = 0x01…0x1A, `^[`=0x1B, `^\`=0x1C, `^]`=0x1D, `^^`=0x1E, `^_`=0x1F,
    **`^ ` = literal `^`** (ixm:DxfReader.cs `TransformControlCharacter`).
  - Common: `^J` (LF, a line break in TEXT/GEODATA/ATTRIB), `^M^J` (CRLF), `^I` (TAB)
    (ezdxf#170).
  - ezdxf's generalized formula `chr((ord(c) - 64) % 126)` was "reverse engineered from what I
    saw AutoCAD produce" (ezdxf#198, ezdxf:tools/text.py:501 `caret_decode`). With it, lowercase
    `^a` becomes `!` (0x21), and `^ ` becomes `^` (0x5E). **CONFLICT:** ixmilia throws on any
    caret char it doesn't know (lowercase letters etc.). ezdxf's test file
    `examples_dxf/caret_encoding.dxf` (generated by `create_caret_encoding.py`) covers `^a`–`^z`,
    `^A`–`^Z`, `^?`, `^@`, `^[`, `^]`, `^\`, `^_`, `^ `, `^^`, and a trailing `^`. ezdxf#198 says
    AutoCAD's rendering of `^B`, `^@`, `^\`, `^]` differs from the naive decoding
    (**UNKNOWN / needs AutoCAD test**, compare `caret_encoding.dxf` rendering).
  - A single `^` at the end of a string is invalid in one-line text (ezdxf validator
    `is_valid_one_line_text`: must not end with `^`).
  - Is caret decoding a *file-level* string rule (every string code) or a *text-level* rule?
    Per the spec it is file-level (SAVEAS/OPEN do it for all strings). ezdxf only applies it at
    text rendering (`plain_text`, `MTextParser`), and ixmilia applies it to all strings at read
    time. **Design:** decode at render time for text content (so round-trip keeps the raw
    string), but offer a decoded accessor. Stacked fractions in MTEXT are written `\S1^ 2;`
    (the space after `^` belongs to the encoding, dxf-viewer:src/MTextFormatParser.js:146ff).
    libredwg-produced files contain a bare `\S5^6;` (ezdxf#889). **UNKNOWN** how AutoCAD reads a
    bare `^6` inside `\S` (as a control char, or as a stack divider?).
- **Unicode escapes** `\U+XXXX` / `\M+NXXXX` are an encoding mechanism (§5.3), usable in any string.
- **`%%` codes** (`%%d` °, `%%p` ±, `%%c` ⌀, `%%%` %, `%%u`/`%%o`/`%%k` toggles, `%%nnn` char
  codes) belong to TEXT/ATTRIB/MTEXT content interpretation, not to the container
  (ezdxf:tools/text.py `plain_text`, dxf-viewer:src/TextRenderer.js:16). See the text note.
- **Backslash** has no special meaning at the container level. MTEXT uses it for inline codes and
  escapes `\\`, `\{`, `\}`.

---

## 2. Binary DXF

### 2.1 Layout

- A binary DXF starts with a 22-byte sentinel: `"AutoCAD Binary DXF\r\n\x1A\x00"` (spec:L10859;
  bytes `41 75 74 6f 43 41 44 20 42 69 6e 61 72 79 20 44 58 46 0d 0a 1a 00`, acs-samples dump).
- Then come tags until `(0, EOF)`. There are no line endings and no comments (999 not allowed).
- **Group code size:**
  - Spec: "2-byte binary value (1 byte in DXF files prior to AutoCAD Release 14)" (spec:L10865).
  - R12 (AC1009) binary: 1-byte codes. A code ≥255 (XDATA) is written as `0xFF` + int16 LE code
    (spec:L10883 "Extended data group codes are represented in binary DXF as a single byte with
    the value 255, followed by a 2-byte integer …").
  - R2000+ binary: 2-byte little-endian codes, no 0xFF escape.
  - **CONFLICT** about R13 (AC1012):
    - Spec: "prior to R14", so R13 would use 1 byte.
    - libredwg writes 1-byte codes for `version < R_14`, i.e. also R13, and escapes any code
      `>= 255` (lrd:out_dxfb.c:191 `GROUP` macro).
    - ezdxf switches on `dxfversion <= "AC1009"`, i.e. R13 gets 2 bytes, and escapes only codes
      ≥1000 (ezdxf:lldxf/tagger.py `binary_tags_loader`, tagwriter.py `BinaryTagWriter`).
    - Auto-detection makes this moot: ixm-rs reads the first code byte, then reads a
      NUL-terminated string. An *empty* string there means the second byte of a 2-byte code 0 was
      read, so it switches to 2-byte mode (ixm-rs:code_pair_iter.rs `BinaryCodePairIter`,
      `codes_are_two_bytes`). ACadSharp checks byte 23 (after the sentinel and the low code byte):
      non-zero → AC1009 1-byte format (acs:IO/DxfReader.cs:502ff). **truedxf:** use the same
      byte-23 test (`data[22] == 0x00` always, since the first code is 0; `data[23] == 0x00` →
      2-byte codes, otherwise it's the `'S'` of SECTION → 1-byte codes).
- **Value encodings** (LE):

  | Type | Binary |
  |---|---|
  | int16 | 2 bytes, signed |
  | int32 | 4 bytes, signed |
  | int64 | 8 bytes |
  | double | 8-byte IEEE 754 |
  | bool (290–299) | 1 byte |
  | string / handle | bytes up to NUL, in the file encoding (codepage for <AC1021, UTF-8 for ≥AC1021) |
  | binary chunk (310–319, 1004) | uint8 length + bytes |

  Sources: ezdxf:lldxf/tagger.py `binary_tags_loader`; spec:L10865-10895; verified against
  acs-samples dumps (R12: `00 'SECTION' 00 02 'HEADER' 00 09 '$ACADVER' 00 01 'AC1009' 00 09
  '$INSBASE' 00 0a <8 bytes> 14 …`; AC1015: `00 00 'SECTION' 00 02 00 'HEADER' 00 …`).
- Encoding detection for binary: ezdxf scans the first 1024 bytes for `$ACADVER` and
  `$DWGCODEPAGE` (ezdxf:lldxf/tagger.py `scan_params`); dxf-json scans the first 8192 bytes
  (dxf-json:src/parser/shared/binaryDxf.ts). Both can miss an R12 `$DWGCODEPAGE`, which sits
  late in HEADER (§7.1). Better: parse HEADER completely with a Latin-1 string decoder first,
  then decode strings.
- The spec claims binary DXF is "25 percent less file space" and "five times faster" and
  "preserves the accuracy" (spec:L10852). Angles are still in degrees in binary.
- ezdxf-docs:filestructure.rst: "it seems that it is not often used". ezdxf#1412: TypeError
  writing binary DXF with proxy graphics. tagwriter.py warns that ezdxf-written binary DXF with
  `ACSH_SWEEP_CLASS` entities cannot be opened by AutoCAD, although the ASCII version can.

### 2.2 DXB

`AutoCAD DXB 1.0\r\n\x1A\x00` is a different (drawing-exchange-binary) format. ixmilia checks for
it (ixm:DxfFile.cs `DxbReader.BinarySentinel`). Not DXF, so out of scope. Detect it and reject
with a clear message.

---

## 3. Sections

### 3.1 Order, optionality, EOF

Standard order: HEADER, CLASSES (R13+), TABLES, BLOCKS, ENTITIES, OBJECTS (R13+),
THUMBNAILIMAGE (optional, R13+), ACDSDATA (R2013+), then `0 EOF`
(ezdxf-docs:dxfinternals/filestructure.rst; spec:L10330ff).

- AutoCAD 2018 output: `HEADER CLASSES TABLES BLOCKS ENTITIES OBJECTS ACDSDATA`
  (acs-samples:sample_AC1032_ascii.dxf, awk over `(0,SECTION)(2,name)`). Files with thumbnails
  (ezdxf repo): `… OBJECTS THUMBNAILIMAGE`.
- R12 AutoCAD output: `HEADER TABLES BLOCKS ENTITIES` (acs-samples:sample_AC1009_ascii.dxf:
  4 SECTION tags).
- The order of THUMBNAILIMAGE vs ACDSDATA is **UNKNOWN** (no sample with both).
- Spec rules for writers (R12-era, spec:L10760ff): "The entire HEADER section can be omitted",
  tables can be omitted, "If you define any linetypes in the LTYPE table, this table must appear
  before the LAYER table", "If present, the BLOCKS section must appear before the ENTITIES
  section", "Within the ENTITIES section, you can reference layer names even though you haven't
  defined them … automatically created with color 7 and the CONTINUOUS linetype", "The EOF item
  must be present".
- ezdxf treats a missing EOF as a fatal `DXFStructureError` in normal mode (ezdxf#85; loader.py
  `load_dxf_structure`) and ignores data after EOF (`ascii_tags_loader` stops). ezdxf warns on a
  second EOF. Tags outside sections are logged and ignored.
- ezdxf drops THUMBNAILIMAGE on load (document.py `_load`: `del sections["THUMBNAILIMAGE"]`).
- Sections are keyed by name. A duplicated section overwrites in normal ezdxf and is **merged**
  in recover (`load_section_dict.add_section` extends).
- THUMBNAILIMAGE content: `90` byte count, then `310` chunks (spec:L10279). The data is a
  BITMAPINFOHEADER-based DIB without BITMAPFILEHEADER (starts `28000000…`, i.e. biSize=40;
  ezdxf examples; ezdxf-notes:"DXF Binary Chunk Interpretation.md"). Some producers write
  PNG/other data (`dxf-json` test "tc_thumbnail" has 4 bytes). Irrelevant for rendering.
- ACDSDATA (R2013+): `70`, `71` flags, then `ACDSSCHEMA` and `ACDSRECORD` "entities" without
  handles. They carry, among other things, ACIS SAB data of 3DSOLID/REGION/SURFACE for R2013+
  (`AcDb3DSolid_ASM_Data` schema, `101 ACDSRECORD`) and thumbnails
  (ezdxf:sections/acdsdata.py docstring). For truedxf: store raw; decode only if 3D solids
  ever need rendering.

### 3.2 What AutoCAD needs to open a file

**R12 (AC1009) and older:** only the ENTITIES section is required
(ezdxf-docs:filestructure.rst "Minimal DXF Content"):

```
  0
SECTION
  2
ENTITIES
  0
ENDSEC
  0
EOF
```

`research/repos/ezdxf/examples_dxf/Minimal_DXF_AC1009.dxf` is exactly this (7 lines).
`Minimal_DXF_AC1006.dxf` is an R10 file with `$LINMIN/$LINMAX` (typos, ignored), 999 comment,
3DFACE/LINE.

**R13/R14 and later** (ezdxf-docs:filestructure.rst; example `Minimal_DXF_AC1021.dxf`, 700 lines):

- Sections HEADER, CLASSES, TABLES, ENTITIES, OBJECTS are required (BLOCKS too, for the
  `*Model_Space`/`*Paper_Space` definitions).
- HEADER: `$ACADVER` and `$HANDSEED`.
- CLASSES may be empty, "but some DXF entities requires class definitions to work in AutoCAD".
- TABLES:
  - VPORT (may be empty)
  - LTYPE with BYBLOCK, BYLAYER, CONTINUOUS
  - LAYER with `0`
  - STYLE with STANDARD
  - VIEW and UCS (may be empty)
  - APPID with ACAD
  - DIMSTYLE with STANDARD
  - BLOCK_RECORD with `*MODEL_SPACE`, `*PAPER_SPACE`
- BLOCKS: `*MODEL_SPACE`, `*PAPER_SPACE`.
- OBJECTS: root DICTIONARY (must be the **first** object) with an `ACAD_GROUP` entry; that
  dictionary may be empty (ezdxf-docs:dxfinternals/datamodel.rst "Objects Organisation").
  ezdxf's recover moves a misplaced root dict to the front (recover.py `recover_rootdict`,
  identified by `(3, "ACAD_GROUP")`).
- ezdxf also creates ACAD_LAYOUT, ACAD_PLOTSTYLENAME (ACDBDICTIONARYWDFLT with "Normal"),
  ACAD_MLINESTYLE and others (datamodel.rst). Whether LAYOUT objects are *required* for AutoCAD
  to open an R2000 file is **UNKNOWN / needs AutoCAD test**. ezdxf says "ACAD_LAYOUT: required",
  in the same text that says only ACAD_GROUP is required. **CONFLICT inside ezdxf docs.**
- ACadSharp#1244 shows an AC1015 file with HEADER(`$ACADVER` only) + TABLES(LAYER only) +
  ENTITIES. The reporter claims AutoCAD opens files whose layers are missing from the table and
  creates them ("same as RECOVER"). Whether that minimal file opens is not stated explicitly
  (**UNKNOWN**).

**AutoCAD error messages** seen in threads (useful for "what would AutoCAD do" tests):

| Message | Cause | Source |
|---|---|---|
| `Invalid or incomplete DXF input -- drawing discarded.` | generic final message | many |
| `Group 280 (was-a-zombie-flag) expected on line N` | CLASS entry with a `91` instance count in an AC1015 file. `91` is only valid from AC1018 on, so AutoCAD's CLASS reader is **order- and version-strict** | acs#956 (**VERIFIED-BY-ACAD**), ezdxf#52 (R13/R14 upgrade bug) |
| `Undefined group code 330 for object on line N` | R12 VERTEX/SEQEND with an owner tag | ixmilia#72 (**VERIFIED-BY-ACAD**) |
| `112 group not followed by 122 group` (in XRECORD) | a point X without its Y. AutoCAD requires Y to follow X immediately | lrd#91 (**VERIFIED-BY-ACAD**) |
| `No knots provided` (SPLINE) | invalid entity data aborts the whole load | acs#1093 |
| `Invalid data for ellipse definition` / `… drawing aborted` | invalid ELLIPSE | netDxf#277 |
| `Invalid symbol table record name: "" on line N` | empty or invalid table names (VIEW, LAYER) | ixmilia#81, qgis#47381, lrd#275 |
| "entity ended prematurely" (paraphrase) | XDATA with an APPID not in the APPID table | acs#534 |

→ AutoCAD is **not** a lenient reader. It aborts the whole file on a single invalid entity. For
pixel-matching, rendering broken files is a bonus: AutoCAD's reference output for such files is
"nothing" (or the RECOVER result).

### 3.3 Table and block structure (container-level facts only)

- TABLE head (R2000+): `0 TABLE, 2 <name>, 5 <handle>, 330 0, 100 AcDbSymbolTable, 70 <count>`.
  The count is "not reliable and ignored by AutoCAD" (ezdxf-docs:sections/tables_section.rst).
  R12: `0 TABLE, 2 <name>, [5 handle], 70 count` (handles only if `$HANDLING=1`).
- Table order written by AutoCAD: VPORT, LTYPE, LAYER, STYLE, VIEW, UCS, APPID, DIMSTYLE,
  BLOCK_RECORD (ezdxf:lldxf/const.py `TABLE_NAMES_ACAD_ORDER`). ezdxf's recover rebuilds TABLES
  in this order, re-creating missing table heads and moving misplaced table entries into their
  table (recover.py `rebuild_tables`).
- VPORT can contain several entries with the same name (`*ACTIVE` multi-viewport configuration);
  the first `*ACTIVE` is the current one (ezdxf-docs:filestructure.rst).
- Modelspace/paperspace block names: R13+ `*Model_Space` / `*Paper_Space` (any case);
  R12 `$MODEL_SPACE` / `$PAPER_SPACE`. Inactive layouts: `*Paper_Space0`, `*Paper_Space1`, …
  Their content is in BLOCKS. The modelspace and *active* paperspace content is in ENTITIES,
  distinguished by `67` (paperspace flag) in R12, and additionally by owner in R13+
  (ezdxf-docs:sections/blocks_section.rst, filestructure.rst).
- Symbol names: compared case-insensitively ("AutoCAD preserves the case of names but does not use
  the case in comparisons", ezdxf:lldxf/validator.py comment citing the OARX docs). Forbidden
  characters: `< > / \ " : ; ? * | , = `` ` `` (ezdxf-notes:"Valid Symbol Names.md"). A leading `*`
  is allowed for special names (`*ADSK_…`, `*ACMAP`, `*Model_Space`, anonymous blocks `*U…`,
  `*D…`, `*X…`, `*A…`, `*E`, `*T`). ezdxf's `INVALID_NAME_CHARACTERS = '<>/\\":;?*=`'` allows `|`
  (xref-dependent names `XREF|LAYER`), ezdxf:lldxf/const.py:579. Names may contain `\U+`/`\M+`
  escapes (ezdxf#782, ezdxf#932) → decode before validating.
- Duplicate table entries with the same name happen in the wild (acs#1239: two LAYER entries,
  no layer `0`). Keep the first, warn. (What AutoCAD does: **UNKNOWN**.)

---

## 4. Versions ($ACADVER)

### 4.1 Version codes

From spec-online (`$ACADVER` description), lrd:common.c:39-92 and ixm:DxfAcadVersion.cs:

| $ACADVER | AutoCAD releases (same file format) | Notes |
|---|---|---|
| `MC0.0` | MicroCAD 1.1 | ancient |
| `AC1.2`, `AC1.3`, `AC1.40`, `AC1.50`, `AC2.10`, `AC2.21`, `AC2.22` | R1.2…R2.x | ancient |
| `AC1001` | R2.4 (ixm: alt. of 2.22) | |
| `AC1002` | R2.5 | ACadSharp refuses anything < AC1002 (acs:IO/DxfReader.cs:537) |
| `AC1003` | R2.6 | real R12-like files still labelled AC1003 exist (acs#1143) |
| `AC1004` | R9 | |
| `AC1005` | R9c1 | |
| `AC1006` | R10 | |
| `AC1007`, `AC1008` | R11 betas | |
| `AC1009` | R11 **and** R12 (LT R1/R2) | "DXF R12". AutoCAD still writes it (DXFOUT R12) |
| `AC1010`, `AC1011` | pre-R13 betas | ixm: "according to the DXF R13 spec, 'AC1011' is correct, but all later specs use 'AC1012'" |
| `AC1012` | R13 | AutoCAD no longer writes R13/R14 DXF (ezdxf-docs:datamodel.rst) |
| `AC1013` | R13c3 | |
| `AC1014` | R14 | |
| `AC1015` | 2000, 2000i (AC1016 in DWG), 2002 (AC1017) | DXF always says AC1015 |
| `AC1018` | 2004, 2005, 2006 | |
| `AC1021` | 2007, 2008, 2009 | |
| `AC1024` | 2010, 2011, 2012 | |
| `AC1027` | 2013–2017 | |
| `AC1032` | 2018–current (2019–2027 still AC1032) | lrd:common.c: AC1033/34/35 "not seen"; libredwg removed its R_2021/AC1035 placeholder (lrd ChangeLog). ezdxf test uses AC1033 as "unknown" (ezdxf tests test_534) |

ixmilia also maps odd writer values like `"14"`, `"14.01"`, `"15.0"`, `"15.05"`, `"16.0"`–`"19.3"`
to versions (ixm:DxfAcadVersion.cs), which suggests some writers put release numbers into `$ACADVER`.

- **Missing `$ACADVER`** → treat as AC1009 (ezdxf `_detect_dxf_version` default DXF12;
  document.py "files without header are by default DXF R12"). **UNKNOWN:** what does AutoCAD
  do with an unlabelled file that contains R2000 structures?
- ezdxf validates the value with `re.fullmatch(r"AC[0-9]{4}")` in recover. String comparison
  `"AC10xx" >= "AC1021"` is safe for the real version codes.
- Maintenance version `$ACADMAINTVER`: code 70 up to AC1027, **code 90 in AC1032**
  (lrd:header_variables_dxf.spec:31-36; ixm-spec:HeaderVariablesSpec.xml comment "The spec says
  this should be a code 70 short, but other tools expect and write a code 90 long on R2018+";
  AutoCAD AC1032 sample: `$ACADMAINTVER[90]=329`). spec-online still documents 70. Values in the
  samples: 20 (AC1015), 104 (AC1018), 50 (AC1021), 329 (AC1032). "should be ignored".

### 4.2 What changed per version (parsing- and rendering-relevant)

| Version | Changes |
|---|---|
| ≤ AC1009 (R12) | No subclass markers, no CLASSES/OBJECTS, no BLOCK_RECORD table. Handles optional (`$HANDLING`=1 → `5` tags). References by **name**; layout membership by `67`. Complex entities POLYLINE/VERTEX/SEQEND, INSERT+ATTRIB+SEQEND. No LWPOLYLINE, HATCH, MTEXT, ELLIPSE, SPLINE (hatches are anonymous `*X` blocks). ACI only. String limit 255. Codepage text. Binary DXF: 1-byte codes (ezdxf-docs:datamodel.rst "DXF R12 Data Model") |
| AC1012 (R13) | Handles mandatory (`$HANDLING` removed), subclass markers, CLASSES, OBJECTS, BLOCK_RECORD table, owner 330, app-data 102, extension dictionaries, reactors. New entities (ELLIPSE, SPLINE, MTEXT, MLINE, RAY, XLINE, 3DSOLID/REGION/BODY with ACIS, LEADER, TOLERANCE). DICTIONARY/XRECORD/GROUP objects. `$DWGCODEPAGE` moved to the start of HEADER (lrd header spec) |
| AC1014 (R14) | LWPOLYLINE, HATCH, IMAGE (as classes; the 2012 spec's default CLASS list still contains HATCH, LWPOLYLINE, spec:L1780ff). Binary DXF 2-byte codes from R14 per spec |
| AC1015 (2000) | Lineweights (370, `$LWDISPLAY`, `$CELWEIGHT`), plot styles (380/390, `$PSTYLEMODE`), multiple layouts (LAYOUT objects, `*Paper_SpaceN` blocks), extended symbol names (`$EXTNAMES`, 255-char names, 2049-char strings), `$INSUNITS`, `$ACADMAINTVER` code 70 |
| AC1018 (2004) | True color 420, color names 430 (ezdxf: DXF2004 attrs, ezdxf:entities/dxfgfx.py:115-117), transparency 440 (ezdxf allows 440 from DXF2004, ezdxf:entities/dxfgfx.py:121; the AutoCAD transparency feature came with AutoCAD 2011 = AC1024 → **UNKNOWN** whether AutoCAD honours 440 in AC1018 files). CLASS `91` instance count (acs#956). DIMASSOC, MATERIAL, PLOTSETTINGS, LAYER_FILTER objects. New header vars: `$SORTENTS`, `$INDEXCTL`, `$HIDETEXT`, `$XCLIPFRAME` (290), `$HALOGAP`, `$OBSCOLOR`, `$OBSLTYPE`, `$INTERSECTION*`, `$DIMASSOC`, `$PROJECTNAME`, `$LASTSAVEDBY` |
| AC1021 (2007) | **File encoding UTF-8** (§5). Entity 284 shadow, 347 material, 348 visual style (ezdxf:entities/dxfgfx.py:132-140). New objects: VISUALSTYLE, TABLESTYLE, FIELD, SUNSTUDY, UNDERLAYDEFINITION (DWF/DGN), MLEADER (2008 features appear in AC1021 files), annotative scales (SCALE, `ACDB_*OBJECTCONTEXTDATA`). Header: `$DIMFXL…$DIMLTEX2`, camera/loft/sun/shadow vars, `$CMATERIAL`, `$INTERFERE*`, `$DRAGVS` |
| AC1024 (2010) | `$XCLIPFRAME` becomes code **280** with 3 values (lrd:header_variables_dxf.spec:446-450; AutoCAD AC1032 output `$XCLIPFRAME[280]=2`), `$DIMTXTDIRECTION`, MESH, PDFUNDERLAY/PDFDEFINITION, transparency (AutoCAD 2011). libredwg writes `$DIMALTMZS`/`$DIMMZS` (group 1) for R2010+, AutoCAD's AC1032 output does not (sample header list) |
| AC1027 (2013) | `$REQUIREDVERSIONS` (160). ACDSDATA section (ACIS data moves there). Proxy graphic size tag `160` instead of `92` (but not strictly: an R2010 file with 160 exists, ezdxf-notes:"ACAD_PROXY_ENTITY.md", ezdxf#978; "try both") |
| AC1032 (2018) | `$ACADMAINTVER` code 90. **Embedded objects** (`101 Embedded Object`): MTEXT columns are stored in an embedded object instead of XDATA `ACAD_MTEXT_COLUMN_INFO_BEGIN…END` plus linked MTEXT entities (ezdxf:entities/mtext.py:220-260, 351, 376-397, 754-810). Multi-line ATTRIB/ATTDEF (flag 2/4 in `280`) carry an embedded MTEXT (ezdxf:entities/attrib.py:119-124, 210ff; ezdxf#258). ACDBNAVISWORKSMODELDEF |

---

## 5. Text encoding

### 5.1 Rule by version

- **≤ AC1018:** the file is encoded in the codepage named by `$DWGCODEPAGE` (default `ANSI_1252`
  if missing). Characters outside the codepage are written as `\U+XXXX`
  (ezdxf-docs:dxfinternals/fileencoding.rst). AutoCAD sets `$DWGCODEPAGE` "to the system code page
  when a new drawing is created, but not otherwise maintained" (spec:L1128, `$DWGCODEPAGE`
  description).
- **≥ AC1021:** the file is **UTF-8**. `$DWGCODEPAGE` is still written (AutoCAD AC1032 sample:
  `ANSI_1252`) but has no meaning for decoding. "For DXF R2007 and later UTF-8 encoding is
  mandatory" (mozman, ezdxf#88). ezdxf: `info.version >= "AC1021" → "utf-8"`
  (ezdxf:filemanagement.py `dxf_stream_info`); ACadSharp does the same (acs:IO/DxfReader.cs:531).
  `\U+XXXX` still occurs in R2007+ files: "R2007+ is where AutoCAD and Revit most commonly
  author these escapes" (lrd#1414, not independently verified). ODA File Converter 24.1x writes
  `\U+00BF` even for Latin-1 chars (ezdxf#1018/discussion-01018).
- **Binary DXF** strings use the same rule.
- **UTF-8 BOM:** dxf-json strips a leading U+FEFF before the sentinel check
  (dxf-json:src/parser/shared/binaryDxf.ts `isBinaryDxfText`). Strip a BOM in ASCII files too
  (**ASSUMPTION**: AutoCAD doesn't write a BOM; UTF8Encoding(false) in acs pr-1098 avoids writing
  one).

### 5.2 $DWGCODEPAGE values → encodings

ezdxf:tools/codepage.py matches the **suffix** of the value (`dxfcodepage.endswith("1252")`),
so `ANSI_1252`, `ansi_1252`, `ANSI1252` all work. Unknown → cp1252.

| $DWGCODEPAGE | ezdxf/Python | WHATWG `TextDecoder` label (for TS) | Script |
|---|---|---|---|
| ANSI_874 | cp874 | `windows-874` | Thai |
| ANSI_932 | cp932 | `shift_jis` | Japanese |
| ANSI_936 | gbk | `gbk` (= GB18030 decoder) | Simplified Chinese |
| ANSI_949 | cp949 | `euc-kr` (WHATWG euc-kr = windows-949 superset; mlightcad-realdwg-web#207) | Korean |
| ANSI_950 | cp950 | `big5` | Traditional Chinese |
| ANSI_1250 | cp1250 | `windows-1250` | Central Europe |
| ANSI_1251 | cp1251 | `windows-1251` | Cyrillic |
| ANSI_1252 | cp1252 | `windows-1252` | Western |
| ANSI_1253 | cp1253 | `windows-1253` | Greek |
| ANSI_1254 | cp1254 | `windows-1254` | Turkish |
| ANSI_1255 | cp1255 | `windows-1255` | Hebrew |
| ANSI_1256 | cp1256 | `windows-1256` | Arabic |
| ANSI_1257 | cp1257 | `windows-1257` | Baltic |
| ANSI_1258 | cp1258 | `windows-1258` | Vietnamese |
| ANSI_1361 | — | none (Johab; no WHATWG decoder) | Korean Johab |
| ANSI_1200 | — | UTF-16 "reserved" (ezdxf codepage.py comment) | |

**Other names seen in the wild:**

- `dos437`, `dos850`, `dos852`, `dos855`, `dos857`, `dos860`–`dos869`, `dos866`, `dos932`, `dos950`,
  `dos720`, `dos737`, `dos775`, `mac-roman`, `big5`, `gb2312`, `ksc5601`/`kcs5601`, `johab`,
  `ascii`, `iso8859-1`…`iso8859-15`, `ansi1252` (acs:CadUtils.cs `_dxfEncodingMap` keys).
- ACadSharp mapped Korean to `kcs5601` instead of `ANSI_949`, which caused mojibake in other
  readers (acs#1259).
- LibreCAD/libdxfrw accept aliases like `CP1252`, `LATIN1`, `ISO-8859-1`, `ISO8859-15`,
  `IBM 850`, `APPLE ROMAN` → ANSI_1252; `GBK`, `GB2312`, `GB18030`, `CHINESE`, `CN-GB` →
  ANSI_936; `SHIFT-JIS` → ANSI_932; `BIG5`, `BIG5-HKSCS` → ANSI_950; `EUCKR` → ANSI_949;
  `UTF-8`/`UTF8` (ldxfrw:intern/drw_textcodec.cpp:672-743 `correctCodePage`).
- `8859_1` (non-standard) crashed FreeCAD (FreeCAD pr-21905). FreeCAD had a case-sensitivity
  bug (pr-9712); libdxfrw had an uppercase/lowercase comparison bug (libdxfrw#71).
- QGIS writes `$DWGCODEPAGE` inconsistently and sometimes omits it (qgis#60802) and wrote UTF-8
  MTEXT under ANSI_949 (qgis#67573).
- The DWG code-page **index** (0–43) is stored in DWG files, not DXF. Mapping list in
  ezdxf:tools/codepage.py comments (e.g. 30 = ansi_1252, 39 = ansi_936; LibreCAD pr-2810 confirms
  39 → ANSI_936).

**truedxf mapping:** uppercase, strip; `ANSI_(\d+)` → windows-/DBCS table above; `DOS(\d+)` →
`ibm866` for 866, otherwise no WHATWG decoder (fall back to cp1252 plus a warning). WHATWG lacks
`ibm437`/`ibm850`; ship small tables if needed. Named aliases as in libdxfrw. Unknown → cp1252.

### 5.3 `\U+XXXX` and `\M+NXXXX`

- `\U+XXXX` ("CIF", Common Interchange Format): exactly 4 hex digits = a UTF-16 code unit / BMP
  code point.
  - Matched case-insensitively for the hex digits: ezdxf#1380 (fixed in v1.4.4: "decode CIF and
    MIF encoded strings including lower case characters"); dxf-viewer regex
    `/\\U\+([0-9a-f]{4})/gi` (dxf-viewer:src/TextRenderer.js:16). Whether `\u+` (lowercase u) is
    accepted by AutoCAD: **UNKNOWN**.
  - Characters above U+FFFF: ezdxf's *writer* emits `\U+%08x` (8 digits) for >0xFFFF
    (ezdxf:lldxf/encoding.py `dxf_backslash_replace`), but its decoder only accepts 4 digits.
    Surrogate pairs `\U+D83D\U+DE00` are the likely AutoCAD form (**ASSUMPTION**, needs a test).
    Combine surrogate pairs after decoding.
  - Invalid or bare `\U+` without digits: leave literally (ezdxf crashed on it before 1.4.x,
    lrd#1314). ixmilia substitutes `?` (ixm:DxfReader.cs `TransformUnicodeCharacters`).
- `\M+NXXXX` ("MIF", Maker Interchange Format): N = codepage selector, XXXX = the **byte
  sequence** in that codepage (lead byte, trail byte), not a code point.
  - Selectors: 1 = cp932 (Shift-JIS), 2 = cp950 (Big5), 3 = cp949 (Wansung), 4 = cp1361 (Johab),
    5 = cp936 (GB2312/GBK) (lrd#428 rurban; dxf-viewer:src/TextRenderer.js:19-25;
    ldxfrw:intern/drw_textcodec.cpp:293-297).
  - **CONFLICT:** ezdxf maps 4 → `"cp1391"` (ezdxf:lldxf/encoding.py `MIF_CODE_PAGE`), almost
    certainly a typo for 1361; nothing decodes it anyway.
  - dxf-viewer treats values < 0x80 as single bytes and values < 0x100 as one byte
    (dxf-viewer:src/TextRenderer.js `DecodeMifChar`).
  - Seen in: old Asian DXF files, ODA-converted layer names `\M+5D7DF\M+5CFDF` (ezdxf#932),
    libredwg output from ANSI_936 DWGs (lrd#428, lrd#1165).
- **Where do escapes appear?** In any string: layer/block names (ezdxf#782, #932), TEXT, MTEXT
  (group 1/3), ATTRIB, XRECORD (lrd#1414).
- **When to decode:**
  - ezdxf's normal loader does **not** decode them, only `recover` does
    (ezdxf:recover.py:840-846 `byte_tag_compiler`; `ezdxf.readfile` path has no decode call). For
    MTEXT, `\U+` is also a documented inline code.
  - ixmilia decodes at read time only when no encoding is given (ixm:DxfTextReader.cs).
  - dxf-viewer decodes at render time (TextRenderer.js).
  - **truedxf:** decode in the *semantic* layer (names and text content) after joining
    continuation chunks; keep raw strings for round-trip. Recommended decoded accessors:
    `name` (decoded) vs `rawName`.
- Writing: for <AC1021, characters not representable in the target codepage → `\U+XXXX`
  (ezdxf's `dxfreplace` codec error handler, ezdxf:__init__.py:79). A literal backslash in
  strings is not escaped. **UNKNOWN:** how AutoCAD distinguishes a literal `\U+0041` typed by a
  user in a TEXT entity.

### 5.4 DBCS pitfalls

- Shift-JIS, GBK and Big5 trail bytes can be 0x5C (`\`) and 0x7B–0x7D (`{|}`), and Shift-JIS/Big5
  trail bytes can be 0x40–0x7E. If a parser scans raw bytes for MTEXT `\` codes before decoding,
  it breaks characters like "表" (0x95 0x5C in Shift-JIS). **ASSUMPTION** (well-known issue, no
  thread in the corpus). Rule: decode to Unicode first, then parse escapes. Test idea below.
- A fixed-width or chunk boundary can cut a DBCS character in half (LibreCAD pr-2810 for DWG;
  for DXF MTEXT chunks likewise). Therefore decode the **concatenated bytes** of all chunks, not
  each chunk separately. `\M+` escapes are split in practice (ezdxf#1322).
- WHATWG decoders substitute U+FFFD for invalid sequences. For round-trip, keep the raw bytes when
  decoding fails (ezdxf's `surrogateescape` approach, ezdxf:recover.py `errors` parameter).

### 5.5 Mis-encoded files and heuristics

Seen in the wild:

- R2007+ files that are not UTF-8: VectorWorks 2012 wrote ANSI_932 bytes. AutoCAD then produced
  a *mix* of UTF-8 and cp932 strings when re-saving (ezdxf#88).
- Pre-2007 files with UTF-8 bytes:
  - ACadSharp's DxfWriter always wrote UTF-8, even for AC1018 with ANSI_936 → AutoCAD mojibake
    (acs#1092, fixed in pr-1098).
  - QGIS wrote UTF-8 MTEXT with ANSI_949 declared (qgis#67573).
  - ACadSharp's ANSI_949 path silently wrote UTF-8 because `Encoding.GetEncoding(0)` returns
    UTF-8 in .NET (acs#1259).
- `$DWGCODEPAGE` wrong or missing:
  - LibreCAD always writes ANSI_1252 (LibreCAD#431).
  - QGIS omitted it (qgis#60802).
  - GDAL/QGIS needed a user-selectable ENCODING open option (gdal#13224, qgis#23915/#27798/#30267).
- Libraries offer an **override**:
  - `ezdxf.readfile(encoding=…)`: "override default encodings if absolute necessary",
    ezdxf:filemanagement.py:150.
  - mlightcad `encoding` option (mlightcad-realdwg-web#207).
  - dxf-viewer: the caller must specify `fileEncoding` (default utf-8), since it doesn't read
    `$DWGCODEPAGE` (dxf-viewer:src/DxfViewer.js:885-893).
- ezdxf's detection:
  - `dxf_info` reads the first ≤5 relevant header vars with a UTF-8 decoder using
    `errors="ignore"` (ezdxf:filemanagement.py `dxf_file_info`, lldxf/validator.py
    `_detect_dxf_info`). If the file doesn't start with SECTION/HEADER, it assumes R12/cp1252.
  - The recover path scans the **whole** tag stream for `$DWGCODEPAGE`/`$ACADVER`, because
    "header variables could reside outside of the HEADER section" (ezdxf:recover.py
    `detect_encoding` docstring).
- **truedxf heuristic** (lenient mode):
  1. Determine the declared encoding (version + codepage).
  2. If declared UTF-8 and the bytes are not valid UTF-8 → decode each invalid string with
     `$DWGCODEPAGE`'s codepage (or cp1252) and emit a warning.
  3. If declared as a codepage (<AC1021) but *all* non-ASCII byte runs are valid multi-byte UTF-8
     and at least one exists → it's very likely UTF-8 (valid UTF-8 by accident in cp125x text is
     rare, e.g. `Ã¼`). Decode as UTF-8 with a warning. **ASSUMPTION** (no library does this; it
     needs a corpus test).
  4. The user override wins.

---

## 6. Object infrastructure

### 6.1 Handles, $HANDSEED, ownership, pointers

- **Handle:** hex string, ≤16 digits (8 bytes), usually uppercase (ezdxf-docs:handles.rst;
  spec:L520 "text string of up to 16 hexadecimal digits"). Unique per file, constant for the life
  of the drawing (spec:L11140). Code 5, or **105** for DIMSTYLE records.
- `"0"` = null handle. The owner of the root DICTIONARY and of TABLE heads is `330 0`
  (ezdxf-docs:datamodel.rst root dict listing; tables_section.rst).
- **R10–R12:** handles optional, enabled by `$HANDLING=1` (ezdxf-docs:handles.rst;
  lrd:header_variables_dxf.spec:291 `VERSIONS (R_10, R_14) HANDLING`). The AutoCAD R12 sample has
  `$HANDLING=1` and `$HANDSEED=2459`. **R13+:** mandatory, `$HANDLING` removed.
- **`$HANDSEED` (code 5):** "next available handle", should exceed every used handle. "AutoCAD
  ignores this value" (ezdxf-docs:handles.rst, unverified). A writer must still set it correctly.
  On read: compute `max(handles)+1` and use the larger of the two.
- **Duplicate handles:** broken files (ezdxf discussion-1288: "Entity handles have to unique, these
  are broken DXF files!"). ezdxf warns "Found non-unique entity handle #58, data validation is
  required" and the *last* entity wins in the entitydb dict (ezdxf:lldxf/loader.py
  `load_and_bind_dxf_content`; entitydb.py `__setitem__`). ACadSharp switched to hash sets to
  avoid repeated handles (acs pr-762). The same entity handle can appear in files merged naively
  by tools. **truedxf:** in lenient mode keep all objects, reassign fresh handles to later
  duplicates, and resolve references to the *first* (or nearest in section order? **UNKNOWN**
  what AutoCAD RECOVER does).
- **Invalid handles** (non-hex): ezdxf's recover drops the `5`/`105` tag (repair.py
  `filter_invalid_handles`) and audit assigns a new one.
- **Pointer semantics** (spec:L11156-11230; ezdxf-docs:handles.rst):
  - soft pointer 330–339, hard pointer 340–349 and 480–481 (and 390–399), soft owner 350–359,
    hard owner 360–369, arbitrary 320–329 (not translated, e.g. references into external files),
    XDATA 1005 (soft-pointer semantics, "stored as handles").
  - Hard refs protect from PURGE, soft refs don't.
  - Block definitions and complex entities (POLYLINE → VERTEX/SEQEND, INSERT → ATTRIB/SEQEND) are
    hard owners of their parts; symbol tables and dictionaries are soft owners of their entries.
  - "An object can have any number of pointer references … but it can have only one owner."
- **Owner tag:** the `330` in the base part (before the first `100`, after any `102` app-data
  groups) is the owner (ezdxf `OWNER_CODE = 330`). Other `330`s are reactors (inside
  `{ACAD_REACTORS`) or subclass data (e.g. LAYOUT's 330 = paperspace BLOCK_RECORD, BLOCKs in R13+
  have 330 = BLOCK_RECORD). Don't use "the first 330 anywhere".
- **R12 files with 330** tags are rejected by AutoCAD (§3.2), so the R12 writer must drop all R13+
  tags.

### 6.2 102 application-defined groups

- Syntax `102 {NAME` … `102 }` (spec:L550). "AutoCAD does not interpret these strings except during
  drawing audit operations." `102 NAME}` is also accepted as a closer (ezdxf-docs:dxftags.rst;
  ezdxf:lldxf/validator.py `entity_structure_validator` `app_data_closing_tag = value[1:] + "}"`).
- They can't be nested (ezdxf raises `DXFAppDataError`) and must not contain `0` or `102 {` tags.
- **Known names:**

  | Name | Content |
  |---|---|
  | `{ACAD_REACTORS` | 330 soft pointers to reactor objects (owner dictionaries, groups, DIMASSOC, IMAGEDEF_REACTOR, …) |
  | `{ACAD_XDICTIONARY` | one 360 hard owner → the extension DICTIONARY |
  | `{BLKREFS` | in BLOCK_RECORD: 331 soft pointers to INSERTs referencing the block (acs-samples AC1032: `102 {BLKREFS / 331 660 / 331 661 / 102 }`; ezdxf:entities/blockrecord.py:77) |

  Counts over the ACadSharp and ezdxf sample corpus: `{ACAD_REACTORS` 6601×, `{ACAD_XDICTIONARY`
  850×, `{BLKREFS` in BLOCK_RECORD, `{ATTRRECORD` inside XRECORD.
- **Position:**
  - Spec examples always put app data before the first `100`.
  - `{BLKREFS` appears *after* the subclass markers, inside `AcDbBlockTableRecord` (105 of 105
    occurrences in the samples), so app data can occur in any subclass (ezdxf accepts them
    anywhere: "Ezdxf accepts them at any position").
  - AutoCAD writes `{ACAD_XDICTIONARY` after `{ACAD_REACTORS`, both between `5` and `330`
    (ezdxf-docs:dxftags.rst; sample order).
- **XRECORD exception:** in XRECORD, `102` is ordinary data. AutoCAD's VISUALSTYLE-related
  XRECORDs contain `102 RTVSPropertyOp`, `102 RTVSPost2010PropOp57` etc. thousands of times, and
  `102 {ATTRRECORD` (samples). ezdxf skips app-data validation for XRECORD. **Rule:** inside an
  XRECORD's `AcDbXrecord` subclass, treat all tags, including `102 {…`, as payload. Only a `102 {`
  before the first `100` is app data.

### 6.3 Subclass markers (100) and tag order

- Spec (spec:L11228-11300): every class level in the inheritance chain "precede[s] their
  class-specific portion of instance data with a 'subclass' marker". The same group codes mean
  different things in different subclasses (spec example `FOOGRANDCHILD`: 10/20/30 in three
  subclasses).
- A subclass ends at the next `100`, at a `101 Embedded Object`, at the first `1001`, or at the
  end of the entity (ezdxf:lldxf/extendedtags.py `is_end_of_class`).
- **Subclass names are not unique within an entity:** TEXT (and ATTRIB/ATTDEF) contain
  `100 AcDbText` twice. DIMASSOC has a sub-structure starting with `(1, AcDbOsnapPointRef)`
  instead of `100` (ezdxf:lldxf/extendedtags.py `collect_base_class` comment). Store as an
  ordered list.
- **The same group code twice in one subclass** with different meanings, resolved by order: e.g.
  ATTDEF `280` (version vs lock-position, ezdxf#907). ezdxf maps duplicated group codes to a
  *list* of attribute names consumed in definition order (ezdxf:entities/dxfns.py:541-553).
- **Order matters to AutoCAD:**
  - LWPOLYLINE: if the vertex count `90` is not the first tag in `AcDbPolyline`, AutoCAD doesn't
    close the polyline even with the closed flag set, while BricsCAD renders it correctly
    (ezdxf-docs:dxftags.rst "Tag order is sometimes important especially for AutoCAD",
    **VERIFIED-BY-ACAD** per ezdxf).
  - CLASS `91` before `280` in AC1015 → fatal (acs#956).
  - X must be followed by Y (lrd#91).
- **Coordinate order:** ezdxf requires x, y, [z] consecutive (`tag_compiler` raises "Missing
  required y coordinate"). Old QCAD writes LINE as `10, 11, 20, 21, 30, 31` → ezdxf
  `tag_reorder_layer` fixes this for LINE only (ezdxf:lldxf/repair.py `COORDINATE_FIXING_TOOLBOX`).
  Recover also removes orphan Y/Z codes and X without Y (`filter_invalid_point_codes`).
- **R12 files with 100 markers** (non-AutoCAD writers, e.g. a C# generator in ezdxf
  discussion-1106) confuse subclass-based parsers. ezdxf flattens/removes the markers in R12
  mode (`ExtendedTags.legacy_repair`/`flatten_subclasses`; recover `check_entities` removes 100
  for R12).
- **Base class mixed with AcDbEntity:** some files put layer, color etc. before
  `100 AcDbEntity`. ezdxf moves non-base codes of the base class into AcDbEntity ("It is valid to
  mix up the base class with AcDbEntity class", ezdxf:entities/dxfns.py
  `append_base_class_to_acdb_entity`), and recover can move misplaced graphic attributes
  (`recover_graphic_attributes`).
- **Seen in the corpus (differential oracle vs ezdxf, 2026-09-30, tools/corpus/README.md):**
  common properties *after* the entity marker (`100 AcDbEntity`, `100 AcDbLine`, `8`, `62`, `370`,
  `6`; QCAD/LibreCAD/QGIS, ~240 k attributes), VERTEX data *before* its markers (ACadSharp#421),
  interleaved `10 11 20 21 30 31` coordinates (AC1003, old QCAD), TEXT `7` in AcDbEntity. truedxf
  recovers misplaced common codes for types whose subclasses never use them (not MTEXT: 48 is the
  column width) and reads single fields of the simple entities leniently from other parts
  (`fieldTable(…, { lenient: true })`), like ezdxf's `recover_graphic_attributes` /
  `simple_dxfattribs_loader`. Files *without* `$ACADVER` but with markers: ezdxf parses them in
  R12 mode and loses subclass data; truedxf decides per record by its markers.
- **Parser design:** decode per subclass with a code → field map *per subclass name*. For codes
  that repeat, use "next unassigned field" semantics, as ezdxf does. Keep unknown tags per
  subclass for round-trip (§9).

### 6.4 XDATA

- XDATA starts with the first `1001 <APPID>` and runs to the end of the entity (spec:L11308;
  ezdxf `entity_structure_validator`: once in XDATA, codes <1000 are invalid). Exception: an
  embedded object may follow XDATA? ezdxf's validator says "embedded objects may follow XDATA",
  while ezdxf-docs:dxftags.rst "Unconfirmed assumptions" says it comes before XDATA.
  **UNKNOWN**. Accept both.
- Codes ≥1000 can appear **before** XDATA as normal data, e.g. BLOCKBASEPOINTPARAMETER in
  Civil 3D/Map 3D (ezdxf-docs:dxftags.rst). So "first code ≥1000" is **not** the XDATA start;
  only `1001` is.
- One group per APPID per entity ("Each APPID name can have no more than one data group attached
  to each entity", spec). ezdxf logs duplicates and keeps the last (ezdxf:entities/xdata.py:70-74).
- The APPID must exist in the APPID table. AutoCAD fails otherwise (acs#534). Readers must
  tolerate it; writers must add the APPID.
- `1002 {`/`}` must balance ("When AutoCAD reads the extended data … it checks to ensure that
  braces are balanced", spec). ezdxf raises `DXFXDataError` on imbalance.
  `1002` values other than `{`/`}` are invalid.
- **Size limit:** 16 KB per entity is the documented ObjectARX xdata limit (**ASSUMPTION**, not
  found in the local corpus). 1000 strings ≤255 bytes (ezdxf:entities/xdata.py:391); 1004 chunks
  ≤127 bytes.
- **Transform semantics** (spec:L11380-11420; ezdxf:entities/xdata.py `transform_xdata_tags`):

  | Code | Semantics | Transform |
  |---|---|---|
  | 1010 | plain point | never changed |
  | 1011 | WCS position | full `m.transform(p)` (plus stretch) |
  | 1012 | displacement | `m.transform_direction(v)` (scale, rotate, mirror) |
  | 1013 | direction | rotate/mirror only, length preserved (normalize to the old length) |
  | 1041 | distance | scaled (ezdxf uses `|m·(d,0,0)|`, "works only for uniform scaling") |
  | 1042 | scale factor | scaled (same as 1041) |

  Relevant for a renderer only when it applies XDATA-driven overrides (e.g. dimension overrides in
  `ACAD` `DSTYLE` XDATA, which use 1070/1040/1000/1005). 1011 etc. matter for "explode" style
  operations and block-reference transformations of XDATA.
- Filter for invalid XDATA codes: ezdxf `filter_invalid_xdata_group_codes` keeps only {1000–1005,
  1010–1013, 1040–1042, 1070, 1071} (`VALID_XDATA_GROUP_CODES`, ezdxf:lldxf/types.py).
  **CONFLICT:** that excludes the spec's "range" codes 1006–1009, 1014–1039 etc., which ixmilia
  and the spec type table allow.
- Well-known XDATA APPIDs that affect rendering: `ACAD` (DSTYLE overrides on DIMENSION/LEADER,
  MTEXT fill, `ACAD_MTEXT_COLUMN_INFO` in <R2018, `ACAD_XREC_ROUNDTRIP`),
  `ACAD_PSEXT` (VIEWPORT?), `AcDbAttr`, `ACAD_EXEMPT_FROM_CAD_STANDARDS` (**ASSUMPTION**, listed
  for other notes).

### 6.5 Embedded objects (101)

- Introduced with AC1032 (ezdxf-docs:dxftags.rst "Embedded Objects").
- Starts with `101 Embedded Object`. It is appended to the encapsulating object and may contain
  any group code except `0`.
- Used in MTEXT (columns) and ATTRIB/ATTDEF (embedded MTEXT for multi-line attributes). Other
  uses are "unconfirmed" (ezdxf).
- `101` with other values is **not** a marker (ACDSDATA `101 ACDSRECORD`; ezdxf `is_end_of_class`
  checks the string).
- ezdxf supports more than one embedded object in the data structure, but only one is used.

### 6.6 Extension dictionaries and reactors

- Any object can have `102 {ACAD_XDICTIONARY` / `360 <dict>` / `102 }`. The DICTIONARY's owner
  (330) is the object (ezdxf-docs:dxftags.rst; ezdxf:entities/factory.py `bind` updates
  `xdict.update_owner`).
- Rendering-relevant extension-dictionary content:
  - `ACAD_FILTER`/`SPATIAL` → SPATIAL_FILTER (XCLIP of INSERTs).
  - `ACAD_XREC_ROUNDTRIP` XRECORDs.
  - `ACDB_*` annotation scale contexts (`AcDbContextDataManager` → ACAD_*OBJECTCONTEXTDATA).
  - `ACAD_SORTENTS` on BLOCK_RECORDs (draw order).
  - Per-LAYER `ADSK_XREC_LAYER_*` overrides.
  - (**ASSUMPTION** list; details in the entity/block notes.)
- Reactors are back-links only; a renderer can ignore them. A writer must keep them consistent,
  or drop them together with the reacting object.

### 6.7 CLASSES section

- One `0 CLASS` record per application-defined class, with codes `1` DXF record name, `2` C++
  class name, `3` application name, `90` proxy capability flags, `91` instance count (AC1018+),
  `280` was-a-proxy, `281` is-an-entity (spec:L1734-1780; ezdxf-docs:sections/classes_section.rst).
- Proxy flags: 0 none, 1 erase, 2 transform, 4 color change, 8 layer change, 16 linetype change,
  32 linetype scale change, 64 visibility change, 128 cloning, 256 lineweight change, 512 plot
  style change, 895 all but cloning, 1023 all, 1024 disable proxy warning, 32768 R13-format
  proxy (spec:L1745-1770).
- Order in each record is fixed and AutoCAD reads it strictly: `1,2,3,90,[91],280,281`, `91` only
  for AC1018+ (acs#956).
- CLASS records have **no handle** (ezdxf doesn't store them in the entity db).
- `1` is "always unique" per spec, but **not** in practice: Autodesk Architectural Desktop 2007
  uses the same `1` with different C++ names. Key by `(1, 2)` (ezdxf classes_section.rst
  "Update 2019-03-03"; acs pr-76 "DxfClassCollection handle duplicates").
- `3` can contain quotes, `|` and long descriptions (AC1032 sample:
  `"WipeOut|Product Desc: …|Company: Autodesk, Inc.|WEB Address: www.autodesk.com"`).
- When are classes needed? For every entity/object type that is not a "built-in" DXF type since
  R13. The entity types that need a CLASS entry in AutoCAD-written files (AC1032 sample) include:
  ACDBDICTIONARYWDFLT, DICTIONARYVAR, TABLESTYLE, MATERIAL, VISUALSTYLE, SCALE, MLEADERSTYLE,
  CELLSTYLEMAP, LAYER_INDEX, SPATIAL_INDEX, IDBUFFER, MESH (281=1), SORTENTSTABLE, WIPEOUT (281=1),
  WIPEOUTVARIABLES, DIMASSOC, ACAD_TABLE (281=1), MULTILEADER (281=1), RASTERVARIABLES, IMAGEDEF,
  IMAGEDEF_REACTOR, IMAGE (281=1), DBCOLOR, PDFDEFINITION, PDFUNDERLAY (281=1), SPATIAL_FILTER,
  ACSH_*, dynamic-block BLOCK*PARAMETER/GRIP/ACTION classes, DATATABLE, …
  - ezdxf has a template table (ezdxf:sections/classes.py `CLASS_DEFINITIONS`) and writes
    classes on demand.
  - The 2012 spec's default list also has HATCH, LWPOLYLINE, LAYOUT, PLOTSETTINGS, OLE2FRAME,
    ARCALIGNEDTEXT, ACDBPLACEHOLDER (spec:L1780ff). Modern AutoCAD does not list HATCH or
    LWPOLYLINE in its CLASSES section (AC1032 sample).
  - Whether AutoCAD refuses a file with e.g. MULTILEADER but no class entry: ezdxf says "some
    DXF entities requires class definitions … or AutoCAD will not open the DXF file"
    (classes_section.rst). Specific list **UNKNOWN / needs AutoCAD test**. acs#1093 claimed
    dimension classes were missing, but the real cause was a bad SPLINE.
- **Reader use:** CLASSES tells whether an unknown `0 <TYPE>` is an entity (`281=1`) or an object,
  and gives proxy flags. ACadSharp reads unknown entity types as `UnknownEntity` only if a CLASS
  exists for them (acs:IO/DXF/DxfStreamReader/DxfSectionReaderBase.cs:238-265).

### 6.8 Proxies (overview)

- `ACAD_PROXY_ENTITY` / `ACAD_PROXY_OBJECT` wrap objects of applications that weren't loaded.
  They store the original class id (90/91), the data as 310 binary chunks, and a proxy graphic
  (`AcDbProxyEntity` subclass, 310 chunks with a length tag `92` or `160`, "try both",
  ezdxf-notes:"ACAD_PROXY_ENTITY.md").
- Non-core custom entities (e.g. AEC objects, ACSH_*) may also carry a proxy graphic preceded by
  `92`. The proxy graphic is the only renderable representation ("the binary chunk contains the
  proxy graphic generated by the entity, when its saveAs() method was called", ezdxf-notes:
  "DXF Binary Chunk Interpretation.md"). `$PROXYGRAPHICS` controls whether they are saved (§7).
- Decoding the proxy graphic format is in a separate note ("Proxy Graphic Binary Chunk").

---

## 7. HEADER section

### 7.1 Structure

```
  0
SECTION
  2
HEADER
  9
$ACADVER
  1
AC1032
  9
$INSBASE
 10
0.0
 20
0.0
 30
0.0
…
  0
ENDSEC
```

- Each variable is a `9 $NAME` tag followed by one tag (scalar) or 2/3 tags (point with codes
  10/20[/30]) (ezdxf-docs:sections/header_section.rst; spec:L10381ff).
- Points: 2D vars (`$LIMMIN/MAX`, `$PLIMMIN/MAX`, R≤10 `$EXTMIN/MAX`, `$INSBASE`) have 10/20; 3D
  vars have 10/20/30.
  - **Real files omit 30** for 3D vars (acs#1143, an AC1003-labelled R12 file from a third-party
    tool) → accept 2 or 3 components.
  - ezdxf's `_detect_dxf_info` treats a following non-30 tag as the start of the next var
    (undo tag).
- Variable names start with `$` (ezdxf `header_validator` raises otherwise). **Duplicates:**
  - `$CUSTOMPROPERTYTAG`/`$CUSTOMPROPERTY` pairs repeat (AutoCAD DWGPROPS; libredwg writes them
    from R2004 on together with `$TITLE`, `$SUBJECT`, `$AUTHOR`, `$KEYWORDS`, `$COMMENTS`,
    `$REVISIONNUMBER`, lrd:header_variables_dxf.spec:40-59; ezdxf exposes `header.custom_vars`).
    Not in the AutoCAD AC1032 sample → these vars are **optional**.
  - Otherwise treat a repeated var as last-wins with a warning.
- The HEADER in R12 is optional; R13+ requires it (ezdxf-docs:sections/header_section.rst). Header
  vars can be orphaned outside HEADER in broken files; ezdxf recover "rescues orphaned header
  vars" (recover.py `rescue_orphaned_header_vars`).
- **Order** is AutoCAD's fixed order (the full AC1032 order is in the libredwg spec and the
  sample, see §7.4). Readers must not depend on it. Note that R12 writes `$DWGCODEPAGE` near the
  **end** of HEADER (after `$PLINEGEN`, `$PSLTSCALE`, `$TREEDEPTH`), while R13+ writes it third,
  after `$ACADVER`/`$ACADMAINTVER` (lrd:header_variables_dxf.spec:37-39 vs 400-402). The R12
  AutoCAD sample in acs-samples doesn't contain `$DWGCODEPAGE` at all.
- **Wrong group codes:** vars whose code changed by version (`$ACADMAINTVER` 70/90,
  `$XCLIPFRAME` 290/280, `$HIDETEXT`, `$INTERSECTIONDISPLAY`). Parse by the actual code's type,
  not by a fixed expectation. ixmilia lists both codes for these (ixm-spec:HeaderVariablesSpec.xml).
- Header vars describe the *current* drawing state (for new objects and UI). Almost none change
  how existing entities look. The ones that do are marked **R** below.

### 7.2 Rendering-relevant variables — semantics and defaults

Default columns: "ACAD-imp" = imperial AutoCAD defaults as used by ixmilia
(ixm-spec:HeaderVariablesSpec.xml `DefaultValue`, matching acad.dwt). "ezdxf" = ezdxf's
new-document defaults (metric ISO template, ezdxf:sections/headervars.py). "AC1032 sample" = the
value in acs-samples. **What AutoCAD assumes for a *missing* variable is UNKNOWN in general**
(presumably the database defaults of a new AcDbDatabase = imperial, needs AutoCAD test).

| Var | Code | Since | R? | Semantics | ACAD-imp / ezdxf / sample |
|---|---|---|---|---|---|
| `$ACADVER` | 1 | all | — | Format version (§4) | R12 / AC1032 / AC1032 |
| `$DWGCODEPAGE` | 3 | R11 (lrd), ixm: R13 | — | Codepage for <AC1021 (§5) | ANSI_1252 |
| `$HANDSEED` | 5 | R10 | — | Next handle (§6.1) | – / "100" / 12DC |
| `$INSUNITS` | 70 | 2000 | (R) | Drawing units for insertion/DesignCenter: 0 unitless, 1 in, 2 ft, 3 mi, 4 mm, 5 cm, 6 m, 7 km, 8 µin, 9 mil, 10 yd, 11 Å, 12 nm, 13 µm, 14 dm, 15 dam, 16 hm, 17 Gm, 18 AU, 19 ly, 20 pc (spec), 21 US survey ft, 22 US survey in, 23 US survey yd, 24 US survey mi (ezdxf:units.py:70-73). **Rendering:** geometry is unitless; AutoCAD applies unit scaling when *inserting* (the result is stored in the INSERT scale), so the renderer does not rescale INSERTs (**ASSUMPTION**). Matters for xref/underlay/image scaling and for `PLOTSETTINGS` "paper units vs drawing units" only indirectly | 0 / 6 / 1 |
| `$MEASUREMENT` | 70 | R14 (lrd: R13c3) | (R) | 0 English, 1 Metric. Chooses acad.lin/acad.pat vs acadiso.lin/acadiso.pat when AutoCAD *loads* definitions. HATCH stores its pattern lines and LTYPE stores its dashes in the file, so existing geometry is unaffected (**ASSUMPTION**; relevant if a hatch lacks pattern data, or for predefined-pattern re-generation). ACadSharp added it late (acs pr-1073) | 0 / 1 / 0 |
| `$LTSCALE` | 40 | all | **R** | Global linetype scale; effective dash length = LTYPE length × LTSCALE × entity 48 × (paperspace/viewport factor per PSLTSCALE). See linetype note | 1.0 |
| `$CELTSCALE` | 40 | R13 | — | Linetype scale for **new** entities (stored per entity as 48) | 1.0 |
| `$PSLTSCALE` | 70 | R11 | **R** | **CONFLICT:** spec and spec-online say "1 = No special linetype scaling, 0 = Viewport scaling governs". The AutoCAD sysvar docs (PSLTSCALE, AutoCAD LT 2016 help) and ezdxf#1386 say **0 = no special scaling, 1 = viewport scaling governs** (dashes in paper units regardless of viewport zoom; default 1). The DXF reference text is inverted. It is **per layout**: LAYOUT `70` bit 1 "Indicates the PSLTSCALE value for this layout when this layout is current" (ezdxf:entities/layout.py:276; netDxf#126: changing the header var alone "doesn't do anything unless you set the value in the layout"). Use the LAYOUT flag; the header var = current layout | 1 / 1 / 1 |
| `$PLINEGEN` | 70 | R11 | — | Linetype generation around polyline vertices for **new** polylines; existing ones carry their own flag (POLYLINE/LWPOLYLINE 70 bit 128) (**ASSUMPTION**, standard AutoCAD behavior) | 0 |
| `$LWDISPLAY` | 290 | 2000 | (R) | Show lineweights on screen. PLOT uses the plot settings' "plot object lineweights" flag instead, so for PLOT emulation ignore it (**ASSUMPTION / needs AutoCAD test**) | 0 |
| `$LWDEFAULT` | — | — | **R** | **Not a DXF header variable.** It is a registry/user setting, default 0.25 mm; not in spec, spec-online or the AC1032 sample. Lineweight −3 (DEFAULT) resolves to it → renderer config option, default 25 | – |
| `$CELWEIGHT` | 370 | 2000 | — | Lineweight of new objects | ByBlock(−2)? ixm; ezdxf −1; sample −1 |
| `$PDMODE` | 70 | all | **R** | POINT display mode: 0 dot, 1 none, 2 +, 3 ×, 4 tick; +32 circle, +64 square (combinable). Point entities are drawn with it | 0 / 0 / 34 |
| `$PDSIZE` | 40 | all | **R** | Point size: 0 → 5% of the drawing-area height, >0 absolute units, <0 percentage of viewport size (AutoCAD sysvar semantics; see the POINT note). For PLOT: relative to the viewport/plot area (**needs test**) | 0.0 / 0.0 / 0.1 |
| `$FILLMODE` | 70 | all | **R** | 0 = solid-filled objects (SOLID, TRACE, wide polylines, solid-fill HATCH, (MTEXT background?)) drawn as outlines only; also affects plots | 1 |
| `$QTEXTMODE` | 70 | all | **R** | 1 = text drawn as bounding rectangles (screen and plot) | 0 |
| `$MIRRTEXT` | 70 | R9c1 | (R) | Whether MIRROR mirrors text. Creation-time behavior; mirrored text is stored via TEXT 71 flags or INSERT scale. **UNKNOWN** whether it affects rendering of text in negatively scaled INSERTs (AutoCAD: text inside mirrored blocks is mirrored regardless, **ASSUMPTION**) | 0 / 1 / 0 |
| `$TILEMODE` | 70 | R11 | (R) | 1 = Model tab active, 0 = a layout tab active. Tells which layout is current; the active paperspace = `*Paper_Space` block | 1 |
| `$EXTMIN`/`$EXTMAX` | 10/20/30 | all | (R) | Model-space extents (WCS). Unreliable: stale, or the sentinel `(1e20,1e20,1e20)`/`(-1e20,…)` for "empty" (ezdxf defaults; ixm uses origin). "ZOOM E" fixes the display in AutoCAD (ezdxf#1117). Use only as a hint; compute extents ourselves for "Extents" plots | origin / ±1e20 |
| `$PEXTMIN`/`$PEXTMAX` | 10/20/30 | R11 | (R) | Same for the *current* paperspace layout. ixm default ±1e20 | |
| `$LIMMIN`/`$LIMMAX` | 10/20 | all | (R) | Model-space limits: the plot area "Limits" and the grid. Default (0,0)–(12,9) imperial, (420,297) ezdxf metric | |
| `$PLIMMIN`/`$PLIMMAX` | 10/20 | R11 | (R) | Paperspace limits of the current layout (LAYOUT stores its own limits, codes 10/11 in AcDbLayout, see the layout note) | |
| `$INSBASE`/`$PINSBASE` | 10/20/30 | all/R14 | — | Base point for inserting this drawing as a block/xref. Relevant when rendering **xrefs** (the xref's `$INSBASE` is its origin) | origin |
| `$ANGBASE` | 50 | all | — | Angle 0 direction for **UI** input/output. DXF angles are always stored CCW from the OCS X axis in degrees (**ASSUMPTION**, standard). Possibly affects angular dimension text formatting (**UNKNOWN**) | 0.0 |
| `$ANGDIR` | 70 | all | — | 1 = clockwise angle *input/display*; stored angles unaffected (**ASSUMPTION**) | 0 |
| `$AUNITS`/`$AUPREC`/`$LUNITS`/`$LUPREC` | 70 | all | (R) | Unit formats/precision for UI; dimension text uses DIMSTYLE `DIMLUNIT`/`DIMDEC` etc., not these. FIELD evaluation may use them | 0/0 (ezdxf 2) / 2/4 |
| `$SPLINESEGS` | 70 | R9 | — | Segments per spline patch for spline-fit POLYLINEs (generated vertices are stored in the file); a negative value means arc-fit segments. Rendering uses stored vertices (**ASSUMPTION**) | 8 |
| `$SPLFRAME` | 70 | R9 | **R?** | Missing from spec 2012 and spec-online, but written by AutoCAD (AC1032 sample) and libredwg (`SINCE R_9`). ixmilia wrongly limits it to ≤R2013. AutoCAD sysvar: 1 = show the control frame of spline-fit polylines and **display invisible edges of 3DFACEs and polyface meshes** (**ASSUMPTION** from sysvar docs; needs test with invisible-edge 3DFACE) | 0 |
| `$SPLINETYPE` | 70 | R10 | — | 5 quadratic, 6 cubic for PEDIT spline | 6 |
| `$SURFU`/`$SURFV` | 70 | R10 | — | Smooth surface density for PEDIT smooth of polygon meshes; each POLYLINE mesh stores its own 73/74 densities (**ASSUMPTION**) | 6 |
| `$SURFTAB1/2`, `$SURFTYPE` | 70 | R10 | — | Mesh generation (RULESURF etc.) | 6 |
| `$TEXTSTYLE` | 7 | all | — | Current style for new text. A TEXT without `7` uses "Standard", not `$TEXTSTYLE` (**ASSUMPTION**) | STANDARD / Standard |
| `$CLAYER` | 8 | all | — | Current layer. An entity without `8` is on layer `0` (**ASSUMPTION**; ezdxf default) | 0 |
| `$CELTYPE` | 6 | R2.21 | — | Current linetype; the entity default is BYLAYER | BYLAYER |
| `$CECOLOR` | 62 | R2.21 | — | Current color; the entity default is 256 BYLAYER | 256 / 256 / 193 |
| `$DIMSTYLE` | 2 | R11 | — | Current dimstyle name; existing DIMENSIONs reference their own style (code 3) | STANDARD / ISO-25 |
| `$DIM*` | 40/70/1/6/7 | var. | — | Current dimension variables = the "unsaved" overrides for new dimensions. Existing dimensions use DIMSTYLE + XDATA `ACAD`/`DSTYLE` overrides + their `*D` block. Renderer: ignore (**ASSUMPTION**). The full list is in §7.3 |  |
| `$XCLIPFRAME` | **290** (AC1018–AC1021), **280** (AC1024+) | 2004 | **R** | Xref/block clip boundary frame: 0 = not displayed and not plotted, 1 = displayed and plotted, 2 = displayed but **not plotted** (AC1024+). **CONFLICT:** spec/spec-online say code 290 with values 0/1 only; AutoCAD 2018 writes `280` value `2` (sample). For PLOT emulation: draw the frame only if 1 | 290:0 (AC1018/21 samples), 280:2 (AC1032) |
| `$DIMASSOC` | 280 | 2004 | — | Associativity of new dims (0 exploded, 1 non-assoc, 2 assoc). libredwg writes it twice in pre-2007 ordering quirks (lrd spec:451-455) | 2 |
| `$PSTYLEMODE` | 290 | 2000 | **R** | 1 = color-dependent plot styles (CTB), 0 = named plot styles (STB). Decides how 380/390 and the plot style table are interpreted when plotting | 1 |
| `$CEPSNTYPE` | 380 | 2000 | — | Plot style type of new objects: 0 ByLayer, 1 ByBlock, 2 dictionary default, 3 object id (then `$CEPSNID` 390) | 0 |
| `$CEPSNID` | 390 | 2000 | — | Plot style handle for new objects if CEPSNTYPE=3 (libredwg calls it CPSNID) | |
| `$MAXACTVP` | 70 | R11 | (R) | Max viewports *regenerated* on screen (default 64). PLOT plots all viewports (**ASSUMPTION**; needs test with >64 viewports) | 64 |
| `$INTERFERECOLOR`/`OBJVS`/`VPVS` | 62/345/346 | 2007 | — | INTERFERE command display | 1 |
| `$OBSCOLOR`/`$OBSLTYPE` | 70/280 | 2004 | (R) | Obscured-line color/linetype for HIDE/hidden plot. OBSLTYPE 0 = off (default) | 257 / 0 |
| `$HALOGAP` | 280 | 2004 | (R) | Gap (% of a unit) where an object is hidden, for HIDE | 0 |
| `$HIDETEXT` | 280 (AutoCAD output), spec says 290 | 2004 | (R) | Whether HIDE ignores text. **CONFLICT:** spec/spec-online say 290; AutoCAD AC1018/AC1021/AC1032 output uses **280** (samples); ixmilia lists both | 1 |
| `$INTERSECTIONDISPLAY`/`COLOR` | 280 (AutoCAD out), spec 290 / 70 | 2004 | (R) | Intersection polylines in HIDE/shade. Same code **CONFLICT** as HIDETEXT (sample: 280) | 0 / 257 |
| `$ENDCAPS` | 280 | 2000 | (R) | "Lineweight endcaps setting for new objects": 0 none, 1 round, 2 angle, 3 square. Line cap/join styles are not stored per entity; CTB plot styles define them (END_STYLE_OBJECT = "use object end style"), BricsCAD always uses round (ezdxf-notes:"Line Cap- and Join Styles.md"). **UNKNOWN** what "object end style" resolves to in PLOT; probably this header var | 0 |
| `$JOINSTYLE` | 280 | 2000 | (R) | 0 none, 1 round, 2 angle, 3 flat. As ENDCAPS | 0 |
| `$VISRETAIN` | 70 | R12 | (R) | 1 = xref-dependent layer settings (on/off, freeze, color, linetype) stored in the host drawing override the xref's own. For rendering xrefs: use the host's `XREF|LAYER` records | 1 |
| `$DISPSILH` | 70 | R13 | (R) | Silhouette curves of 3D solids in wireframe (relevant only for rendering ACIS bodies) | 0 |
| `$UCSORG`/`XDIR`/`YDIR`/`NAME`/`BASE`, `$UCSORTHO*`, `$UCSORG{TOP..BACK}` | 10.. / 2 / 70 | R10/2000 | — | Current model-space UCS. **Not** used for DXF coordinates (all WCS/OCS). R10 wrote `$UCSXORI`/`$UCSYORI` (lrd spec) | WCS |
| `$PUCS*` | same | R11/2000 | — | Current paperspace UCS | |
| `$ELEVATION`/`$PELEVATION`/`$THICKNESS` | 40 | all | — | Current elevation/thickness for new entities | 0 |
| `$TRACEWID`/`$PLINEWID` | 40 | all | — | Default widths for new TRACE/PLINE | 0.05 / 0.0 |
| `$TEXTSIZE` | 40 | all | — | Default text height for new text; a text style with height 0 plus TEXT 40 → the entity's 40 | 0.2 / 2.5 / 0.5 |
| `$ATTMODE` | 70 | all | **R** | Attribute visibility: 0 none (all hidden), 1 normal (respect ATTRIB invisible flag), 2 all (show even invisible) | 1 |
| `$PROXYGRAPHICS` | 70 | R13c3/R14 | — | Whether proxy images are saved (writer hint; tells whether proxies have graphics) | 1 |
| `$SORTENTS` | 280 | 2004 | (R) | Bit flags for draw-order sorting: 1 selection, 2 osnap, 4 redraw, 8 MSLIDE, 16 REGEN, **32 plotting**, 64 PostScript (spec). With 32 cleared, plots ignore SORTENTSTABLE? (**UNKNOWN / needs test**) | 127 |
| `$INDEXCTL` | 280 | 2004 | — | Layer/spatial index saving | 0 |
| `$EXTNAMES` | 290 | 2000 | — | 1 = 255-char names with spaces and special chars; 0 = R14 rules (31 chars, `A-Z0-9$_-`) | 1 |
| `$PSVPSCALE` | 40 | 2000 | — | Scale for new viewports | 0.0 |
| `$WORLDVIEW`, `$SHADEDGE`, `$SHADEDIF` | 70 | R11 | (R) | SHADE command settings (legacy); SHADEDIF default 70 | 1/3/70 |
| `$CSHADOW`, `$SHADOWPLANELOCATION`, `$LIGHTGLYPHDISPLAY`, `$TILEMODELIGHTSYNCH`, sun/camera/loft vars | var | 2007 | — | 3D rendering, not relevant for 2D plot emulation | |
| `$CMATERIAL` | 347 | 2007 | — | Current material handle | |
| `$DWFFRAME`/`$DGNFRAME` | 280 | 2007 | **R** | Underlay frame visibility: 0 hidden, 1 displayed and plotted, 2 displayed not plotted (sample DWFFRAME 2, DGNFRAME 0). PDF frame: `$PDFFRAME` is not in DXF (**UNKNOWN**) | 2/2 (ezdxf), 2/0 (sample) |
| `$HYPERLINKBASE`, `$STYLESHEET`, `$PROJECTNAME`, `$FINGERPRINTGUID`, `$VERSIONGUID`, `$MENU`, `$LASTSAVEDBY`, `$REQUIREDVERSIONS` | var | var | — | Metadata. `$PROJECTNAME` is used to resolve xref/image paths (project search paths) | |
| `$HANDLING` | 70 | R10–R12 (lrd: to R14) | — | 1 = handles present | 1 |
| `$TDCREATE`/`$TDUPDATE`/`$TDUCREATE`/`$TDUUPDATE` | 40 | all/2000 | — | Julian dates (`2459632.474340278`). Relevant for FIELDs showing dates | |
| `$TDINDWG`/`$TDUSRTIMER` | 40 | all | — | Durations in days | |

### 7.3 All other variables (codes/types)

Compiled from ixm-spec:HeaderVariablesSpec.xml (285 entries, with min/max versions),
ezdxf:sections/headervars.py (259 entries) and lrd:header_variables_dxf.spec, checked against the
AutoCAD AC1032 sample (§7.4). Format: `NAME code`. Point vars are marked `P3` (10/20/30) or `P2`
(10/20).

- **Metadata/version:**
  - ACADVER 1, ACADMAINTVER 70 (≤AC1027) / 90 (AC1032), DWGCODEPAGE 3, LASTSAVEDBY 1 (2004+),
    REQUIREDVERSIONS 160 (2013+), HANDSEED 5, HANDLING 70 (≤R12), MENU 1, FINGERPRINTGUID 2,
    VERSIONGUID 2, PROJECTNAME 1, HYPERLINKBASE 1, STYLESHEET 1.
  - Summary info (libredwg only): TITLE, SUBJECT, AUTHOR, KEYWORDS, COMMENTS, REVISIONNUMBER,
    CUSTOMPROPERTYTAG, CUSTOMPROPERTY (all 1).
- **Geometry/extents:** INSBASE P3 (R≤9: P2), EXTMIN/EXTMAX P3 (R≤10: P2), LIMMIN/LIMMAX P2,
  PINSBASE P3, PEXTMIN/PEXTMAX P3, PLIMMIN/PLIMMAX P2.
- **Modes (70 unless noted):**
  - ORTHOMODE, REGENMODE (default 1), FILLMODE, QTEXTMODE, MIRRTEXT, ATTMODE, LIMCHECK,
    PLIMCHECK, USRTIMER, SKPOLY, WORLDVIEW, TILEMODE, MAXACTVP, UNITMODE, VISRETAIN, PLINEGEN,
    PSLTSCALE, TREEDEPTH (default 3020), PROXYGRAPHICS, MEASUREMENT, INSUNITS, DISPSILH (R13+),
    SPLFRAME, SPLINETYPE, SPLINESEGS, SURFTAB1, SURFTAB2, SURFTYPE, SURFU, SURFV, PDMODE,
    ANGDIR, AUNITS, AUPREC, LUNITS, LUPREC, SHADEDGE, SHADEDIF, LOFTPARAM, TIMEZONE (e.g. −8000),
    UCSORTHOVIEW, PUCSORTHOVIEW, CMLJUST, OBSCOLOR (ACI in 70), INTERSECTIONCOLOR (70).
  - ≤R14 only: DRAGMODE, OSMODE, COORDS, ATTDIA, ATTREQ, BLIPMODE, DELOBJ (R13–R14), PICKSTYLE
    (R13–R14; lrd: R10–R2000).
  - ≤R10 only: AXISMODE, AXISUNIT P2, FASTZOOM, GRIDMODE, GRIDUNIT P2, SNAPANG 50, SNAPBASE P2,
    SNAPISOPAIR, SNAPMODE, SNAPSTYLE, SNAPUNIT P2, VIEWCTR P2, VIEWDIR P3, VIEWSIZE 40, FLATLAND
    (R10).
- **Doubles (40):** LTSCALE, CELTSCALE, TEXTSIZE, TRACEWID, SKETCHINC, FILLETRAD, ELEVATION,
  PELEVATION, THICKNESS, CHAMFERA–D, TDCREATE, TDUCREATE, TDUPDATE, TDUUPDATE, TDINDWG,
  TDUSRTIMER, PDSIZE, PLINEWID, USERR1–5, CMLSCALE, PSVPSCALE, LENSLENGTH, CAMERAHEIGHT,
  STEPSPERSEC, STEPSIZE, 3DDWFPREC, PSOLWIDTH, PSOLHEIGHT, LOFTANG1/2 (radians), LOFTMAG1/2,
  LATITUDE, LONGITUDE, NORTHDIRECTION, SHADOWPLANELOCATION.
- **Angle (50):** ANGBASE.
- **Names:**
  - TEXTSTYLE 7, CLAYER 8, CELTYPE 6, DIMSTYLE 2, DIMTXSTY 7, DIMLTYPE/DIMLTEX1/DIMLTEX2 6,
    DIMBLK/DIMBLK1/DIMBLK2/DIMLDRBLK 1, CMLSTYLE **7 in R13, 2 in R14+** (ixm-spec).
  - UCSNAME/UCSBASE/UCSORTHOREF/PUCSNAME/PUCSBASE/PUCSORTHOREF 2. R≤2.10 swapped TEXTSTYLE/CLAYER
    codes (8/7) (lrd:header_variables_dxf.spec).
- **Ints:** USERI1–5 70, CECOLOR 62, CELWEIGHT 370, CEPSNTYPE 380, CEPSNID 390, INTERFERECOLOR 62.
- **Handles:** DRAGVS 349, CMATERIAL 347, INTERFEREOBJVS 345, INTERFEREVPVS 346.
- **Bools (290):** LWDISPLAY, XEDIT, PSTYLEMODE, EXTNAMES, OLESTARTUP, CAMERADISPLAY,
  REALWORLDSCALE, XCLIPFRAME (2004–2007).
- **280:** ENDCAPS, JOINSTYLE, SORTENTS, INDEXCTL, HIDETEXT, XCLIPFRAME (2010+), HALOGAP,
  OBSLTYPE, INTERSECTIONDISPLAY, DIMASSOC, LOFTNORMALS, LIGHTGLYPHDISPLAY, TILEMODELIGHTSYNCH,
  SOLIDHIST, SHOWHIST, DWFFRAME, DGNFRAME, CSHADOW.
- **UCS points (P3):** UCSORG, UCSXDIR, UCSYDIR, UCSORG{TOP,BOTTOM,LEFT,RIGHT,FRONT,BACK}, and the
  same with the P prefix (R2000+ for the ortho ones).
- **Dimension vars** (ixm/ezdxf/lrd; the version is the first DXF version that writes them):
  - 40 (doubles): DIMSCALE, DIMASZ, DIMEXO, DIMDLI, DIMRND, DIMDLE, DIMEXE, DIMTP, DIMTM,
    DIMTXT, DIMCEN, DIMTSZ, DIMALTF, DIMLFAC, DIMTVP, DIMTFAC (R12; spec lists it as **DIMFAC**
    40, a spec typo; AutoCAD writes `$DIMTFAC`), DIMGAP, DIMALTRND (2000), DIMFXL (2007),
    DIMJOGANG (2007, radians).
  - 70: DIMTOL, DIMLIM, DIMTIH, DIMTOH, DIMSE1, DIMSE2, DIMTAD, DIMZIN, DIMASO, DIMSHO, DIMALT,
    DIMALTD, DIMTOFL, DIMTIX, DIMSOXD, DIMSAH, DIMCLRD, DIMCLRE, DIMCLRT (ACI), DIMJUST, DIMSD1,
    DIMSD2, DIMTOLJ, DIMTZIN, DIMALTZ, DIMALTTZ, DIMUPT, DIMDEC, DIMTDEC, DIMALTU, DIMALTTD,
    DIMAUNIT (R13+), DIMFIT, DIMUNIT (R13–R14 only), DIMADEC, DIMAZIN, DIMDSEP (char code,
    46 = '.', ezdxf default 44 = ','), DIMATFIT, DIMFRAC, DIMLUNIT, DIMLWD, DIMLWE (signed
    lineweights), DIMTMOVE (2000), DIMFXLON, DIMTFILL, DIMTFILLCLR, DIMARCSYM (2007),
    DIMTXTDIRECTION (2010).
  - 1 (strings): DIMPOST, DIMAPOST, DIMBLK, DIMBLK1, DIMBLK2, DIMLDRBLK; DIMALTMZS, DIMMZS
    (lrd 2010+; not in AutoCAD output).
  - Names: DIMSTYLE 2, DIMTXSTY 7, DIMLTYPE/DIMLTEX1/DIMLTEX2 6.
  - DIMSAV is "not in DXF" (lrd).

### 7.4 AutoCAD 2018 (AC1032) header order (acs-samples:sample_AC1032_ascii.dxf)

`$ACADVER $ACADMAINTVER $DWGCODEPAGE $LASTSAVEDBY $REQUIREDVERSIONS $INSBASE $EXTMIN $EXTMAX $LIMMIN $LIMMAX $ORTHOMODE $REGENMODE $FILLMODE $QTEXTMODE $MIRRTEXT $LTSCALE $ATTMODE $TEXTSIZE $TRACEWID $TEXTSTYLE $CLAYER $CELTYPE $CECOLOR $CELTSCALE $DISPSILH $DIMSCALE $DIMASZ $DIMEXO $DIMDLI $DIMRND $DIMDLE $DIMEXE $DIMTP $DIMTM $DIMTXT $DIMCEN $DIMTSZ $DIMTOL $DIMLIM $DIMTIH $DIMTOH $DIMSE1 $DIMSE2 $DIMTAD $DIMZIN $DIMBLK $DIMASO $DIMSHO $DIMPOST $DIMAPOST $DIMALT $DIMALTD $DIMALTF $DIMLFAC $DIMTOFL $DIMTVP $DIMTIX $DIMSOXD $DIMSAH $DIMBLK1 $DIMBLK2 $DIMSTYLE $DIMCLRD $DIMCLRE $DIMCLRT $DIMTFAC $DIMGAP $DIMJUST $DIMSD1 $DIMSD2 $DIMTOLJ $DIMTZIN $DIMALTZ $DIMALTTZ $DIMUPT $DIMDEC $DIMTDEC $DIMALTU $DIMALTTD $DIMTXSTY $DIMAUNIT $DIMADEC $DIMALTRND $DIMAZIN $DIMDSEP $DIMATFIT $DIMFRAC $DIMLDRBLK $DIMLUNIT $DIMLWD $DIMLWE $DIMTMOVE $DIMFXL $DIMFXLON $DIMJOGANG $DIMTFILL $DIMTFILLCLR $DIMARCSYM $DIMLTYPE $DIMLTEX1 $DIMLTEX2 $DIMTXTDIRECTION $LUNITS $LUPREC $SKETCHINC $FILLETRAD $AUNITS $AUPREC $MENU $ELEVATION $PELEVATION $THICKNESS $LIMCHECK $CHAMFERA $CHAMFERB $CHAMFERC $CHAMFERD $SKPOLY $TDCREATE $TDUCREATE $TDUPDATE $TDUUPDATE $TDINDWG $TDUSRTIMER $USRTIMER $ANGBASE $ANGDIR $PDMODE $PDSIZE $PLINEWID $SPLFRAME $SPLINETYPE $SPLINESEGS $HANDSEED $SURFTAB1 $SURFTAB2 $SURFTYPE $SURFU $SURFV $UCSBASE $UCSNAME $UCSORG $UCSXDIR $UCSYDIR $UCSORTHOREF $UCSORTHOVIEW $UCSORGTOP $UCSORGBOTTOM $UCSORGLEFT $UCSORGRIGHT $UCSORGFRONT $UCSORGBACK $PUCSBASE $PUCSNAME $PUCSORG $PUCSXDIR $PUCSYDIR $PUCSORTHOREF $PUCSORTHOVIEW $PUCSORGTOP $PUCSORGBOTTOM $PUCSORGLEFT $PUCSORGRIGHT $PUCSORGFRONT $PUCSORGBACK $USERI1…5 $USERR1…5 $WORLDVIEW $SHADEDGE $SHADEDIF $TILEMODE $MAXACTVP $PINSBASE $PLIMCHECK $PEXTMIN $PEXTMAX $PLIMMIN $PLIMMAX $UNITMODE $VISRETAIN $PLINEGEN $PSLTSCALE $TREEDEPTH $CMLSTYLE $CMLJUST $CMLSCALE $PROXYGRAPHICS $MEASUREMENT $CELWEIGHT $ENDCAPS $JOINSTYLE $LWDISPLAY $INSUNITS $HYPERLINKBASE $STYLESHEET $XEDIT $CEPSNTYPE $PSTYLEMODE $FINGERPRINTGUID $VERSIONGUID $EXTNAMES $PSVPSCALE $OLESTARTUP $SORTENTS $INDEXCTL $HIDETEXT $XCLIPFRAME $HALOGAP $OBSCOLOR $OBSLTYPE $INTERSECTIONDISPLAY $INTERSECTIONCOLOR $DIMASSOC $PROJECTNAME $CAMERADISPLAY $LENSLENGTH $CAMERAHEIGHT $STEPSPERSEC $STEPSIZE $3DDWFPREC $PSOLWIDTH $PSOLHEIGHT $LOFTANG1 $LOFTANG2 $LOFTMAG1 $LOFTMAG2 $LOFTPARAM $LOFTNORMALS $LATITUDE $LONGITUDE $NORTHDIRECTION $TIMEZONE $LIGHTGLYPHDISPLAY $TILEMODELIGHTSYNCH $CMATERIAL $SOLIDHIST $SHOWHIST $DWFFRAME $DGNFRAME $REALWORLDSCALE $INTERFERECOLOR $INTERFEREOBJVS $INTERFEREVPVS $CSHADOW $SHADOWPLANELOCATION`

Notable absences: `$DRAGVS` (the spec lists it; not written when NULL, lrd `HEADER_H0`),
`$CEPSNID` (only if CEPSNTYPE=3), `$LWDEFAULT` (never).

**Spec vs reality summary for HEADER:**

- **CONFLICT:** PSLTSCALE semantics are inverted in the spec.
- **CONFLICT:** XCLIPFRAME/HIDETEXT/INTERSECTIONDISPLAY group codes: the spec says 290,
  AutoCAD writes 280 (XCLIPFRAME: 290 up to AC1021).
- **CONFLICT:** ACADMAINTVER is code 90 in AC1032.
- **CONFLICT:** spec `$DIMFAC` vs actual `$DIMTFAC`.
- Missing from the spec: SPLFRAME, DIMFXL…DIMTXTDIRECTION, CAMERADISPLAY…, DWFFRAME/DGNFRAME,
  REALWORLDSCALE, CMATERIAL, LIGHTGLYPHDISPLAY, TILEMODELIGHTSYNCH, SOLIDHIST/SHOWHIST,
  REQUIREDVERSIONS (spec-online table fetched 2026-09-30).

---

## 8. Robust parsing

### 8.1 Malformed input seen in the wild

| Defect | Example source | Handling (ezdxf recover / others) |
|---|---|---|
| Missing EOF | ezdxf#85 | normal: fatal; recover: fine |
| Missing ENDSEC / SECTION | ezdxf#179 "found ENDSEC tag without previous SECTION tag" | recover: `open_section` closes the previous section, stray ENDSEC is ignored (`AuditError.MISSING_SECTION_TAG`) |
| Tags outside sections | — | normal: warn and ignore; recover: collects orphans, rescues orphaned header vars |
| Missing section name tag | — | recover: ignore the section |
| Duplicate sections | naive concatenation | recover: merge (`add_section`) |
| Misplaced/missing TABLE heads, entries in wrong table | — | recover `rebuild_tables` |
| Root DICTIONARY not first | — | recover `recover_rootdict` |
| Broken LAYOUT ↔ BLOCK_RECORD links | QGIS output (ezdxf#997, ezdxf-notes:"Read messed up LAYOUT structure created by QGIS.md") | recover `fix_broken_layout_links` (placeholder; fixed in audit) |
| No HEADER / no `$ACADVER` | R12 minimal files | R12 default |
| R12 file with R13+ markers (100, 330) | ezdxf discussion-1106 (C# generator) | recover: strip 100 in R12 mode (#1106); AutoCAD: rejects 330 in R12 (ixmilia#72) |
| R12 without handles | common (R12 writers, `$HANDLING` absent) | assign handles internally |
| Duplicate handles | ezdxf discussion-1288 | warn, last wins (ezdxf) |
| Invalid (non-hex) handles | ezdxf#65 | recover drops the tag → a new handle is assigned |
| Header point without Z | acs#1143 | accept 2D |
| Ints as floats | ProE (ezdxf tagger comment) | int(float()) |
| Garbage after numbers | — | recover: regex (stod/stoll emulation) |
| Invalid group code line | ezdxf#1289 (blank line) | normal: DXFStructureError; `recover.explore()` with `synced_bytes_loader`: skip lines until something parses as a code 0–1071 ("dangerous!", ezdxf:recover.py) |
| Coordinates out of order (x1,x2,y1,y2) | old QCAD LINE (ezdxf tagger docstring) | `tag_reorder_layer` (LINE only) |
| Orphan Y/Z, X without Y | — | `filter_invalid_point_codes` |
| Invalid XDATA codes | — | `filter_invalid_xdata_group_codes` |
| Unbalanced 102 / 1002 | ezdxf#30 "Invalid XDATA structure" | normal: `DXFAppDataError`/`DXFXDataError` (validator) |
| Lowercase structure names | — | recover: `strip().upper()` on code-0 values. **UNKNOWN** what AutoCAD does |
| Entities with invalid data (SPLINE without knots, ELLIPSE ratio > 1, circles with r ≤ 0) | acs#843/#1093, netDxf#277, `examples_dxf/circle_radius_le_0.dxf` | AutoCAD aborts the whole file for SPLINE/ELLIPSE (§3.2); r ≤ 0 circles: **UNKNOWN** (ezdxf ships a test file); ezdxf audit removes invalid entities |
| Layers/linetypes referenced but not defined | acs#1244 | AutoCAD creates missing layers (spec: color 7, CONTINUOUS); ACadSharp fell back to layer 0 → create on the fly |
| Visio HATCH with many 72=0 | ezdxf#836 ("It's a wonder that Autodesk TrueView opens that file"; BricsCAD RECOVER fixes 246 errors) | entity-level recovery |
| Unicode escapes in names | ezdxf#782/#932 | recover decodes `\U+`/`\M+` |
| Raw control bytes inside strings (from decoder over-reads in DWG→DXF converters) | lrd#1314: "a single raw byte < 0x20 desyncs the tag/value pair stream for every reader" (well, except for CR/LF) | the line splitter only splits on CR/LF, so other control chars are harmless; caret-encode on write |
| NUL bytes in strings | LibreCAD pr-2816 (`\U+` escapes with 12 trailing NULs on macOS, DWG ≤R2004 got the NULs) | strip NUL in lenient mode |
| Non-UTF-8 in R2007+, UTF-8 in R2004- | §5.5 | heuristic |
| Huge files (2 GB+ decompressed parts in DWG; 83 MB DXF with 1.42M tags) | acs#838, ezdxf pr-1413 | streaming |

**ezdxf.recover pipeline** (ezdxf:recover.py `Recover.run`/`safe_tag_loader`):

1. `bytes_loader` (or `synced_bytes_loader`) yields raw byte tags and skips 999.
2. `detect_encoding` scans all tags (tee'd stream).
3. Repair filters: `tag_reorder_layer`, `filter_invalid_point_codes`, `filter_invalid_handles`.
4. `byte_tag_compiler`: typed values, point assembly, lenient int/float, decoding with two
   stages (strict, then the `errors` handler, recording `DECODING_ERROR`), code-0 upper/strip,
   `\U+`/`\M+` decode.
5. `rebuild_sections`, `load_section_dict` (merge, rescue header vars, detect version, drop
   CLASSES/OBJECTS/ACDSDATA for R12).
6. `rebuild_tables`, `recover_rootdict`, `check_entities` (structure validator; strip 100 in R12).
7. Build the Drawing, then run the Auditor (fixes references, handles, invalid values).

ezdxf's philosophy: the normal `readfile` expects valid files; everything messy goes through
`recover` (ezdxf#1403: "Ezdxf has a special module ezdxf.recover to read crappy DXF files";
ezdxf-notes:"Load Documents.md"). **truedxf:** one parser with a strictness flag. Strict mode
mirrors AutoCAD's acceptance (useful to predict "AutoCAD would refuse"), lenient mode mirrors
ezdxf.recover.

**VERIFIED-BY-ACAD** (AutoCAD 2027, 2026-09-30, `fileformat/*`; Q-0004, Q-0006, Q-0007):
- 999 comments are accepted at the file start, between entities and between `0 SECTION` and its `2 name`
  (`comment-999-*`, all plot normally).
- Trailing text after a blank on group-code lines and integer value lines is ignored: a user file with
  ` 10                    // insertion point x` and `     1                    // top left` loads and
  plots like the clean file (VERIFIED-BY-ACAD 2026-10-01, `user/text-frame-annotated`; AutoCAD reads the
  code like `strtol`). truedxf accepts a code line "digits + blank + anything"; "10abc" stays invalid
  (untested in AutoCAD). Float values already use `strtod` semantics.
- Entity type names: in an R12 file lower-case types (`line`, `circle`, `text`) load and plot
  (`lowercase-entities-r12`); in an AC1032 file lower-case or space-padded types (`LINE `) load without error
  but the entities are **dropped** (nothing plots, `lowercase-entities-r2018`, `trailing-space-types-r2018`).
  Lower-case or padded section/structure names make the file invalid (`lowercase-all-*`,
  `trailing-space-sections-*`, `trailing-space-types-r12`: "invalid-fixture").

### 8.2 Performance strategies

- ezdxf: "heavy I/O bound … Most potential for optimization is to reduce the cost of function call
  overhead" (ezdxf#3). A fused loader+compiler gave −28% tag loading and −14% document load on an
  83 MB / 1.42M-tag file (ezdxf pr-1413). Reading bytes and decoding later was *not* faster in
  Python, because of the decode overhead (ezdxf:lldxf/tagger.py comment: 50 MB file, text 1.30 s
  vs binary 0.65 s raw, but 5.3 s total processing). In JS/TS a byte-level scanner avoids string
  allocation for numbers.
- Lazy parsing:
  - ezdxf's `iterdxf` builds a `FileStructure` index of structure tags (code 0, section names,
    handles) with file offsets (ezdxf:lldxf/fileindex.py) and iterates modelspace entities
    without loading the whole document (ezdxf:addons/iterdxf.py `opendxf`, `modelspace`).
  - ACadSharp can read only the ENTITIES section (`ReadEntities`; acs#81: it skips the rest) and
    only specific entity types (acs#110).
- Web viewers: mlightcad decodes UTF-8 "in line-aligned windows" (mlightcad-realdwg-web#163);
  dxf-viewer runs parsing in a worker (dxf-viewer:src/DxfWorker.js).
- **truedxf plan:**
  1. `Uint8Array` input. Single pass producing a flat tag array
     (`Int32Array` codes, `Uint32Array` value start/end offsets); no per-tag objects.
  2. Numbers parsed on demand from byte ranges.
  3. Strings decoded on demand with a cached `TextDecoder`.
  4. Entity index = positions of code-0 tags.
  5. Entities materialized lazily per layout or block.
  6. For binary DXF the same flat representation, with typed values decoded eagerly (cheap).
  7. Memory: ~12 bytes per tag → 1.4M tags ≈ 17 MB, plus the original buffer.
- Avoid `split(/\r\n|\r|\n/)` on a giant string (dxf-parser/dxf-viewer do this): it allocates
  millions of strings and doubles memory.

---

## 9. Round-tripping

- **Unknown entity/object types:**
  - ezdxf stores them as `DXFTagStorage`, i.e. all tags as `ExtendedTags`, and writes them back
    verbatim (ezdxf:entities/dxfentity.py:972-1012). Graphical detection is by the presence of an
    `AcDbEntity` subclass. Copy/transform is not supported ("Copying of tag storage … not
    supported", "cannot transform DXF tag storage").
  - To copy undocumented entities, hard-pointer targets must be copied and soft pointers mapped,
    and CLASS entries copied (ezdxf-notes:"Copying Undocumented Entities.md").
- **Unknown tags in known entities:**
  - ezdxf **drops** them: `load_tags_into_namespace` returns "unprocessed tags", which are logged
    (`log_unprocessed_tags`) and not stored, except that recover moves misplaced graphic
    attributes (ezdxf:entities/dxfns.py:500-582). So ezdxf does not preserve unknown group codes
    of known entity types.
  - ACadSharp keeps only the common AcDbEntity codes of unknown entities
    (`UnknownEntity`/`UnknownNonGraphicalObject`, acs:Entities/UnknownEntity.cs,
    IO/DXF/DxfStreamReader/DxfSectionReaderBase.cs:238-265: "Entity not supported read as an
    UnknownEntity"; without a CLASS entry it is skipped entirely). Its reader "notifies" about
    unhandled codes.
  - **truedxf:** keep each subclass's unknown tags (with their position relative to known tags)
    and re-emit them in place. This is necessary because tag order matters to AutoCAD (§6.3).
- **Always preserved by ezdxf:** XDATA (`XData` dict by APPID, entities/xdata.py), app-data groups
  (`ExtendedTags.appdata`), extension dictionaries (`{ACAD_XDICTIONARY`), reactors, embedded
  objects (ExtendedTags.embedded_objects; MTEXT columns/embedded MTEXT are re-exported), CLASSES
  (by `(name, cpp)` key), THUMBNAILIMAGE (**dropped** by ezdxf), ACDSDATA (kept as raw sections,
  ezdxf:sections/acdsdata.py), comments (999 are **skipped** by default; ezdxf#103 asked to keep
  them).
- **Version conversion constraints for a writer:**
  - R12 output must drop all R13+ tags: 100, 102 groups, 330 and other pointers, CLASSES,
    OBJECTS, and 91 in CLASS (R≥2004). Otherwise AutoCAD refuses the file (ixmilia#72, acs#956).
  - R2000+ output needs a consistent owner/handle graph: BLOCK_RECORD for every BLOCK, a LAYOUT
    for each paperspace, the root dict first, APPID entries for all XDATA APPIDs (acs#534), and
    `$HANDSEED` > max handle.
  - Strings for <AC1021: encode in the codepage, `\U+XXXX` for the rest (ezdxf `dxfreplace`).
    ≥AC1021: UTF-8 without BOM.
  - Caret-encode control characters and `^` → `^ ` (spec:L10373). Don't split `^x` or `\U+XXXX`
    across 250-char MTEXT chunks (ezdxf `split_mtext_string`; lrd#1314).
  - Floats: round-trip repr (acs#1179).
  - Binary chunks: ≤127 bytes (254 hex digits) per 310 line.
  - Line endings: CRLF like AutoCAD (**ASSUMPTION**: LF is accepted too; ezdxf writes `\n` via
    Python text mode, i.e. LF on Linux and CRLF on Windows, and AutoCAD reads ezdxf files).
- **What a writer must preserve for "AutoCAD-identical" re-save:** tag order within subclasses,
  duplicate subclass markers, handles (so SORTENTSTABLE, groups, reactors and dimension
  associations keep working), XDATA, and extension dictionaries with their XRECORDs (e.g.
  `ACAD_XREC_ROUNDTRIP` holds data newer than the saved format: AutoCAD round-trips newer-version
  features through old DXF versions this way; **ASSUMPTION**, see the entity notes).

---

## 10. Open questions (feed the AutoCAD test backlog)

1. Missing header vars: which defaults does AutoCAD assume (imperial database defaults vs
   template)? Especially `$MEASUREMENT`, `$LTSCALE`, `$PDMODE`/`$PDSIZE`, `$PSLTSCALE`,
   `$INSUNITS`, `$FILLMODE`, `$ATTMODE`.
2. Does AutoCAD trim trailing/leading spaces in string values (TEXT content, names)?
3. Is a lowercase `section`/`entities`/`line` accepted by AutoCAD?
4. CR-only and LF-only line endings, and `\r\r\n`: does AutoCAD accept them?
5. Does AutoCAD accept `\u+00fc` (lowercase u) and lowercase hex? How are >U+FFFF characters
   written (surrogate pair vs 8 digits)?
6. Which entity types *require* a CLASS entry for AutoCAD to open an R2000+ file?
7. Are LAYOUT objects and the ACAD_LAYOUT dict required in a minimal R2000 file?
8. `$SPLFRAME=1` effect on 3DFACE invisible edges in PLOT.
9. `$XCLIPFRAME` 0/1/2 effect on PLOT output; the 290 code in an AC1024+ file.
10. `$PSLTSCALE` header vs LAYOUT flag precedence when they disagree.
11. Duplicate handles: what does AutoCAD do (refuse? RECOVER?), and which duplicate wins for
    references?
12. Transparency (440) in an AC1018 file: honoured?
13. Caret codes `^B`, `^@`, `^\`, `^]` rendering (ezdxf#198 noted differences), and lowercase
    `^a`.
14. `$SORTENTS` bit 32 cleared: does PLOT ignore draw order?
15. THUMBNAILIMAGE vs ACDSDATA section order in AutoCAD R2013+ output.
16. Decimal comma floats: does AutoCAD refuse?

---

## Test ideas

Small DXF files to pin behaviour down against AutoCAD (open, and PLOT to PNG/PDF where visual):

1. **min_r12.dxf**: ENTITIES-only R12 with one LINE (from ezdxf `Minimal_DXF_AC1009.dxf` plus a
   LINE). Expect: opens; LINE on layer 0, color 7.
2. **min_r2000_variants/**: AC1015 files stripping one required piece at a time (no CLASSES
   section, no OBJECTS, no root dict, no ACAD_GROUP, no BLOCK_RECORD table, no
   `*Model_Space` block, no `$HANDSEED`, no LAYOUT objects, no APPID ACAD). Record open/refuse
   plus the error text.
3. **lineendings/**: the same R12 drawing with CRLF, LF, CR-only, `\r\r\n`, a UTF-8 BOM, trailing
   spaces after `SECTION`, tab-padded group codes, lowercase `section`/`line`.
4. **whitespace_strings.dxf**: TEXT entities with leading spaces, trailing spaces, only spaces, an
   empty value line; layer names `" A"`, `"A "`. Check rendering and the layer list.
5. **numbers.dxf**: floats as `1e2`, `1.0E+02`, `.5`, `5.`, `+5`, `-0`, `1,5`, ` 5 `,
   `5xyz`; ints as `1.0`, `1e0`, `  7  `, `32768` (int16 overflow) in `62`/`70`. Record which are
   accepted.
6. **bool_codes.dxf**: 290 values `0`, `1`, `2`, `-1`, `true`.
7. **caret.dxf**: reuse ezdxf `examples_dxf/caret_encoding.dxf` (`^A`–`^Z`, `^a`–`^z`, `^@`,
   `^[`, `^\`, `^]`, `^^`, `^_`, `^ `, a trailing `^`) in TEXT and MTEXT. PLOT and compare.
8. **unicode_escapes.dxf**: AC1015 cp1252 file with `\U+00FC`, `\u+00fc`, `\U+00fc`, `\U+D83D\U+DE00`,
   `\U+1F600` (8-digit), a bare `\U+`, `\U+00` in TEXT, MTEXT and a layer name; an MTEXT with
   `\U+` split across a 3/1 chunk boundary.
9. **mif_escapes.dxf**: `\M+19195` (Shift-JIS), `\M+5B0A1` (GBK), `\M+4…` (Johab), split across
   chunks (ezdxf#1322 has a synthetic example `SplitCharEscape.dxf`).
10. **dbcs_5c.dxf**: AC1018 ANSI_932 file with MTEXT containing 表 (0x95 0x5C) and ソ (0x83 0x5C),
    plus the same in ANSI_936/950 with 0x5C trail bytes. Expect no spurious MTEXT codes.
11. **mislabeled_encoding/**: an AC1018 file declaring ANSI_1252 but containing UTF-8 bytes;
    an AC1021 file containing cp1252 bytes. See what AutoCAD shows (mojibake pattern).
12. **codepage_names/**: `$DWGCODEPAGE` = `ansi_1251`, `ANSI1251`, `dos866`, `CP1251`, missing →
    Cyrillic text. Check which ones AutoCAD honours.
13. **binary/**: an AutoCAD-written binary DXF for R12 and R2018 (SAVEAS binary), plus
    truedxf-written binary R13/R14 variants with 1-byte and 2-byte codes → verify that AutoCAD
    reads both (settles the R13 CONFLICT).
14. **handles/**: an R2000 file with duplicate entity handles, handle `0` on an entity, lowercase
    handles, 16-digit handles, `$HANDSEED` lower than the max handle.
15. **class_order.dxf**: CLASS records with 91 in AC1015 (expect the acs#956 error) and with
    280/281 swapped.
16. **r12_with_r13_tags.dxf**: R12 with a 330 in VERTEX (expect ixmilia#72 error), with a 100 in
    LINE, and with `102 {ACAD_REACTORS` in LINE.
17. **xdata/**: XDATA with an unregistered APPID (acs#534), unbalanced 1002, codes 1006/1014/1043,
    codes ≥1000 before the first 1001, two groups for the same APPID. Then INSERT a block whose
    entities carry 1010/1011/1012/1013/1041/1042 XDATA with a rotated, mirrored, non-uniform
    INSERT, EXPLODE, re-export, and compare values (verifies the transform table).
18. **appdata_position.dxf**: `102 {ACAD_XDICTIONARY` placed after `100 AcDbEntity`, `102 {MYAPP`
    inside AcDbLine, and a `102 MYAPP}` closer.
19. **xrecord_102.dxf**: XRECORD with `102 {FOO` / `102 }` as payload → check round-trip and that
    AutoCAD doesn't treat it as app data.
20. **lwpolyline_order.dxf**: LWPOLYLINE with 70=1 and `90` placed after the vertices (ezdxf says
    AutoCAD then doesn't close it). PLOT.
21. **header_codes.dxf**: AC1032 with `$XCLIPFRAME` as 290 vs 280 and values 0/1/2; an INSERT with
    a SPATIAL_FILTER. PLOT → frame visible? Same for `$HIDETEXT` 290.
22. **psltscale/**: a layout with a viewport at 1:10 and a dashed line in model space; header
    PSLTSCALE vs LAYOUT 70 bit 1 in all four combinations. PLOT → dash lengths.
23. **fillmode_qtext.dxf**: SOLID, wide LWPOLYLINE, solid HATCH, TEXT with `$FILLMODE=0` and
    `$QTEXTMODE=1`. PLOT.
24. **pdmode/**: POINTs with PDMODE 0,1,2,3,4,32–36,64–68,98 and PDSIZE 0, 5, −5, in model space
    and a paperspace viewport. PLOT.
25. **attmode.dxf**: invisible and visible ATTRIBs with `$ATTMODE` 0/1/2. PLOT.
26. **splframe.dxf**: 3DFACE with invisible edges (70 flags) and a polyface mesh, `$SPLFRAME` 0/1.
    PLOT.
27. **missing_header_vars.dxf**: an R2000 file whose HEADER has only `$ACADVER`/`$HANDSEED`, with
    dashed lines, points and text → reveals AutoCAD's defaults for LTSCALE/PDMODE/PDSIZE/
    MEASUREMENT (dash pattern acad vs acadiso if the LTYPE has no pattern data?).
28. **header_point_2d.dxf**: `$EXTMIN` without 30, `$INSBASE` 2D in an AC1015 file.
29. **huge.dxf**: a generated 200 MB file with 5M LINEs → parser throughput and memory budget
    (not an AutoCAD test).
30. **empty_lines.dxf**: a blank line in code position (ezdxf#1289), and a blank line as a
    legitimate empty string value → AutoCAD refuses the former, accepts the latter.
