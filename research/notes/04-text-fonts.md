# 04 — Text and fonts (TEXT, ATTRIB/ATTDEF, MTEXT, SHX/TTF fonts)

Scope: everything needed to parse, model and render TEXT, ATTRIB, ATTDEF and MTEXT so that the result
matches AutoCAD PLOT output, plus the font formats (SHX shape fonts, TrueType) and font resolution.
DIMENSION/MLEADER/TABLE text reuse MTEXT (see their own notes).

Source abbreviations: **spec** = `research/spec/autocad_2012_dxf_reference.txt` (page numbers of the
PDF); **ODA** = `research/spec/OpenDesign_Specification_for_.dwg_files.txt` (section numbers);
`ezdxf:` = `research/repos/ezdxf/src/ezdxf/...` unless a top-level folder is given; issue references
`<repo>#N` point to `research/github/raw/<owner>__<repo>/threads/{issue|pr|discussion}-0000N.md`
(ezdxf = mozman__ezdxf, cad-viewer = mlightcad__cad-viewer, realdwg-web = mlightcad__realdwg-web,
dxf-viewer = vagran__dxf-viewer, ACadSharp = DomCR__ACadSharp, netDxf = haplokuon__netDxf, …);
**ADSK** = Autodesk online help (URLs inline).

## 0. TL;DR for the implementer

Interactive LOD (2026-10-02, renderer performance task; **viewer approximation**, not an
AutoCAD rule): with `lod: true` and smooth raster only, glyphs whose cap height times the
largest transform singular value is below 1.5 device pixels become one filled quad per consecutive
run/colour/baseline. Its height is total transformed ink area divided by the run's ink width,
clamped to the ink box height and centred on that box. This replaces the earlier half-cap-height
hairlines, which visibly lost the density of dense text columns (mtext-elec-35). TTF ink area is
the area of normalized nonzero-fill reference polygons, flattened at an ink-box-size / 1024
tolerance (power-of-two bucket). This uses the same fixed-point union as triangulation, including
holes and overlapping/self-intersecting contours, but avoids earcut and retained fine meshes.
SHX caches reference stroke length, applies the
frontend's target lineweight (one device pixel for hairlines) at draw time, and pads its ink box
by half that width. Nonuniform transforms sum transformed reference segment lengths; uniform
transforms reuse the scalar length; a one-entry linear-transform cache covers repeated nonuniform
instances without caching width. No alpha/minimum-height boost is added: GPU antialiasing
supplies sub-pixel coverage, and opaque text still merges into opaque viewer draw calls. Entity
transparency is preserved. This conserves summed ink, not the union of overlapping strokes;
the ink-box clamp limits saturation. Glyphs without ink remain blank; backgrounds, inline colour
and decorations keep their normal paths. Plot/LOD-off geometry is unchanged. Entity-plane layouts are cached per frontend, font
identity, text, header layout options, dimension handling and linked-column wrap width.

1. **Text height = cap height.** TTF: scale = h / yMax(glyph "A") in font units (Arial 1466, *not*
   OS/2 sCapHeight 1467; Times 1387 vs capHeight 1356 decides it) — VERIFIED-BY-ACAD (AutoCAD 2027
   TEXTBOX probes, §4.5, and stored alignment points / MTEXT extents in AutoCAD-saved DXFs, §1.4/§3.6).
   SHX: scale = h / *above* (ADSK). No kerning. Width factor scales x; oblique shears about the baseline.
2. **TEXT alignment** (VERIFIED-BY-ACAD, Arial + several SHX): Top = baseline + h, Middle (ML/MC/MR)
   = baseline + h/2, Bottom = baseline − font descent (TTF: hhea/win descent 434/1466 for Arial; SHX:
   h·below/above), 72=4 "Middle" = centre of the *ink* box of the string. Horizontal extent for
   Center/Right = union of the advance box [0, Σadvance] and the ink box (Arial, 131/134 samples within
   1 font unit). Use 11 as the anchor whenever 72/73 ≠ 0 (10 is a stale derived value).
3. **MTEXT**: baseline pitch 5/3 × h × 44 (VERIFIED-BY-ACAD to 4 decimals); in "at least" mode a line
   whose ink rises above cap height is pushed down by the excess; extents (42/43) are ink-based
   (§3.6 model reproduces AutoCAD's stored 42/43 to 4 decimals in ~50 samples).
4. **Inline codes**: tolerant tokenizer (ezdxf `MTextParser` semantics, §3.3); join all 3/1 chunks
   before decoding anything; decode `\U+`/`\M+` inside the tokenizer, not as a pre-pass.
5. **ATTRIBs** are already in final position — never apply the INSERT transform; draw them after the
   block content; constant ATTDEFs render in the block, non-constant ATTDEFs don't.
6. **Fonts**: STYLE XDATA family (+ bold/italic bits 25/24 of 1071) **wins over group 3**; unresolved
   fonts → FONTALT (default simplex.shx); a missing bigfont suppresses the text (core console);
   characters missing from a TTF come from a fallback font at the primary font's scale; `%%c` = U+00D8
   for TTF. SHX is a small bytecode vector language (§4.2–4.4) — implement natively incl. bigfonts;
   pen positions are probably rounded to the integer design grid after arcs (hypothesis).
7. Biggest unknowns (need AutoCAD PLOT tests): SHX horizontal alignment width definition, stacked
   fraction geometry, underline/overline offsets, MTEXT exact-spacing box, bigfont scaling,
   \A default, column breaking, oblique/width-factor order, arc tessellation. List in §8.

## 1. TEXT

### 1.1 Group codes (entity `TEXT`, subclass markers `AcDbEntity` / `AcDbText` / `AcDbText`)

TEXT has **two** `AcDbText` subclass markers; group 73 lives in the second one (ezdxf:entities/text.py:45-145, spec p.144-145).

| Code | Meaning | Default / notes |
|---|---|---|
| 100 | `AcDbText` (first) | |
| 39 | thickness (extrusion along 210) | 0; only SHX fonts are extruded by AutoCAD/BricsCAD (ezdxf text.py:113) |
| 10/20/30 | **first alignment point** (OCS) | see 1.3 — the *computed* left end of the baseline |
| 40 | text height | ezdxf default 2.5, must be > 0. = **cap height** (§4.4 SHX, §4.5 TTF). Style fixed height (STYLE 40) only matters at creation time; the entity value is what is drawn (ezdxf:addons/drawing/frontend.py:409 "fixed text height set by associated text-style is ignored") |
| 1 | text string (single line, ≤ 255 bytes in R12, 2049 in R2000+; ezdxf tools/text.py:283) | special codes see 1.6 |
| 50 | rotation, **degrees** | 0 |
| 41 | relative X scale (width factor) | 1; "also adjusted when fit-type text is used" (spec) — AutoCAD/BricsCAD *store* the computed factor for FIT |
| 51 | oblique angle, degrees, 0 = upright, positive leans right | 0 |
| 7 | text style name | `STANDARD` (ezdxf uses "Standard") |
| 71 | text generation flags: 2 = backward (mirror in X), 4 = upside down (mirror in Y) | 0; ezdxf validator accepts {0,2,4,6} |
| 72 | horizontal justification 0 Left, 1 Center, 2 Right, 3 Aligned, 4 Middle, 5 Fit | 0 (values 3,4,5 only valid with 73 = 0) |
| 11/21/31 | **second alignment point** (OCS) | "meaningful only if 72 or 73 nonzero" |
| 210 | extrusion | (0,0,1) |
| 100 | `AcDbText` (second) | |
| 73 | vertical justification 0 Baseline, 1 Bottom, 2 Middle, 3 Top | 0 |
| 38 | elevation (R11 legacy; convert into z of 10/11) | ezdxf text.py:110, `elevation_to_z_axis` |

DWG (ODA 20.4.3): R2000+ uses a *DataFlags* byte to omit default fields (elevation, alignment point,
oblique, rotation, width, generation, halign, valign); the alignment point is stored as 2DD relative
to the insertion point defaults. Not relevant for DXF, but explains why AutoCAD always has both points.

`ezdxf:get_align_enum` (text.py:296): if `72 > 2` the stored 73 is ignored (treated as 0).
Unknown (72,73) combinations fall back to LEFT.

### 1.2 Alignment table

| 73 \ 72 | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| 3 top | TL | TC | TR | | | |
| 2 middle | ML | MC | MR | | | |
| 1 bottom | BL | BC | BR | | | |
| 0 baseline | Left | Center | Right | Aligned | Middle | Fit |

### 1.3 Which point is used

- Spec (p.145, paraphrased): when 72 or 73 is nonzero, AutoCAD ignores the first alignment point
  and recomputes it from the second alignment point plus the string's length and height under the
  text style; when both are zero or absent, the second alignment point has no meaning.
- ezdxf `Text.get_placement()` (text.py:270): LEFT → 10; FIT/ALIGNED → text runs from 10 to 11;
  everything else → **11 is the real alignment point** (falls back to 10 if 11 is missing).
- ezdxf notes ("Notes on Rendering DXF Content.md", M. Broadway, paraphrased): TEXT and ATTRIB are
  *always* anchored at the left baseline (10) whatever alignment is stored; the alignment values only
  matter when the text is edited.
  **CONFLICT** with the spec — resolved by later evidence:
  - ezdxf#688, ezdxf#1258, ezdxf#1075: when an ODA DXF→DWG conversion keeps a stale 10, **AutoCAD draws
    the text at the stale 10** until the entity is edited/moved (VERIFIED AutoCAD, TrueView 2024,
    BricsCAD v25). ACadSharp#535/#689: generated DWGs with correct 11 but stale 10 show wrong in
    AutoCAD until refreshed (VERIFIED AutoCAD).
  - So for **DWG**, AutoCAD trusts the stored 10 (it's a cache). For **DXF** input the spec says it
    recomputes; gdal#225: AutoCAD's property panel shows 11 as "Text alignment X/Y" and aligns around it;
    netDxf#262: TrueView renders MiddleCenter TEXT correctly from 11 (eDrawings wrongly uses 10).
    realdwg-web PR #77 / #199 / #200: "group 11 is the true anchor, because group 10 was computed from
    AutoCAD's own metrics"; 11 == 10 is legitimate (decide on *presence* of 11, not on equality).
  - **Decision for truedxf (DXF)**: 72/73 ≠ 0 → anchor at 11, recompute everything with our metrics;
    FIT/ALIGNED → 10 and 11; LEFT/BASELINE → 10. Keep a debug switch "use stored 10" — and use the stored
    10 of AutoCAD-saved files as a free oracle for our font metrics (see Test ideas).
  - **UNKNOWN / test**: DXF with 72=1, correct 11 and garbage 10 → what does AutoCAD PLOT show directly
    after OPEN (no edit)?
- If 11 is missing while 72/73 ≠ 0 (broken writers): use 10 as the alignment point.
- FIT with coincident points / width 0 exists in real files (netDxf#360) → render like LEFT at 10 with
  natural width (ASSUMPTION).

### 1.4 Alignment geometry — measured

Method: in files saved by a CAD application, 10 is the application's own recomputation, so
`(11 − 10)` rotated into the text frame and divided by h exposes the alignment metrics. I scanned all
3045 DXF files under `research/repos` (with a one-off script, not in the repo) and grouped by
producer: files with `$FINGERPRINTGUID` in braces are AutoCAD-style (**"ACAD"**; QCAD writes the same
style and its files were excluded), e.g. `three-dxf/sample/data/demo.dxf` maintver 197, `ezdxf/examples_dxf/text.dxf` maintver
155 = mbway's AutoCAD stress test from ezdxf PR #280, `dxf-json/sample/A_000217.dxf`,
`bjnortier-dxf/test/resources/floorplan.dxf`, `dxf-parser/samples/data/api-cw750-details.dxf`,
ACadSharp samples. Files with GUIDs without braces
are BricsCAD (ezdxf author, ezdxf#332: `text_fonts.dxf`, `text_mirror_*.dxf`, `text_stacked_*.dxf`).

Vertical offsets (dy = (11−10)·ŷ / h), rotation removed, width factor irrelevant:

| Font | producer | Bottom 73=1 | Middle 73=2 | Top 73=3 | 72=4 "Middle" |
|---|---|---|---|---|---|
| arial.ttf | ACAD (three-dxf demo) | **−0.296044** = −434/1466 | 0.5 | 1.0 | – |
| arial.ttf | BricsCAD | −0.295909 | 0.5 | 1.0 | 0.3535 ("MIDDLE_gjpqy") |
| ARIALN.TTF / ariblk.ttf | BricsCAD | −0.29413 / −0.43269 | 0.5 | 1.0 | 0.35335 / 0.35335 |
| SourceCodePro / BOUTON / babyk / Bruss | BricsCAD | −0.41612 / −0.15267 / −0.42117 / −0.26144 | 0.5 | 1.0 | 0.375 / 0.3985 / 0.304 / 0.352 |
| txt.shx | BricsCAD; ACAD 72=4 (libredwg `sample_2000.dxf`) and TEXTBOX (§4.6) | −1/3 | 0.5 | 1.0 | 1/3 ("Jen teksto simpla, cxu ne?") |
| simplex.shx | ACAD | −1/3 | 0.5 | 1.0 | 1/3 ("Xxp middle", "x") |
| romans.shx, architxt.shx, archtitl.shx | ACAD | −1/3 | 0.5 | – | archtitl: **0.5** for "CORRIDOR", "KITCHEN", "UP"…; 1/3 for "ST. #1" |
| arial bold/italic/black, hebtxt, italic.shx, romand.shx | ACAD | – | 0.5 | 1.0 | – |

Arial font data (fontTools on `C:/Windows/Fonts/arial.ttf`, upm 2048): A/H/X/E/I yMax = 1466,
OS/2 sCapHeight 1467, hhea descent −434, winDescent 434, typoDescender −431; ariblk.ttf: cap 1466,
hhea/win descent 634 (634/1466 = 0.43247 vs BricsCAD 0.43269).

Conclusions:
1. **Top = h, Middle (ML/MC/MR) = h/2** above the baseline for every font and string
   (**VERIFIED-BY-ACAD**) → h is the cap height; T/M do not depend on the string.
2. **Bottom = −descent**, a font-wide metric independent of the string (no descenders in "BOTTOM_LEFT"
   yet full offset). TTF: `hhea.descent` (= winDescent for these fonts) / capHeight(=1466 for Arial)
   — typoDescender (431) does **not** match (**VERIFIED-BY-ACAD**, 0.296044 exact). SHX: below/above
   (txt 2/6, simplex/romans 7/21). BricsCAD uses a slightly different cap basis (1466.7).
   ezdxf#333: BricsCAD/TrueView leave "more space" below than the (typo) descender predicts — explained
   by hhea/win vs typo descent.
3. **72 = 4 "Middle" = vertical centre of the string's ink box**: archtitl "CORRIDOR" → 0.5, "ST. #2"
   → 1/3 (glyph descends), simplex "x" → 1/3 = (0 + 14/21)/2 (ink top of "x"), BricsCAD Arial Black
   0.35335 ≈ Arial Narrow (glyph descent ≈ 431 units, not the 634 font descent). Autodesk TEXT help:
   "The Middle option differs from the MC option in that it uses the midpoint of all text, including
   descenders. The MC option uses the midpoint of the height of uppercase letters." (**VERIFIED-BY-ACAD**
   for SHX; TTF only BricsCAD data → ASSUMPTION same). Horizontal centre of 72=4: simplex "x" →
   0.2619 h = (ink width 11/21)/2 → consistent with the same union box as Center (see item 4).
   ezdxf#324 found "lower-case centre" matched better — consistent with ink-centre for lower-case strings.
4. **Horizontal extent for Center/Right/Middle** (Arial, AutoCAD files; 134 Center samples, 3 Right):
   box = [min(0, inkLeft), max(Σadvance, inkRight)] — i.e. the union of the pen-advance box and the
   ink box; Center = midpoint, Right = right edge. 131/134 within 1 font unit; e.g. Right "A" = 1369
   (ink xMax > advance 1366), Right "C" = 1479 (= advance > ink), Center "A6" = (−3 + 2505)/2 = 1251
   (A has lsb −3). The remaining 3 (AC1018 file, 0.07 % shorter) are probably an older arial.ttf.
   No kerning. Width factor multiplies the box. **VERIFIED-BY-ACAD (Arial)**.
   SHX: BricsCAD txt "CENTER" = 5.6667 h = 6 glyphs × 1 h − 1/3 h, i.e. the last glyph's trailing
   pen-up gap is *not* included → for SHX the box seems to be the ink box (or advance minus trailing
   gap) — **UNKNOWN for AutoCAD** (need the .shx file + an AutoCAD sample; simplex "x" data above is
   consistent with ink-only).
5. **ALIGNED**: AutoCAD/BricsCAD rewrite 40 (height = distance / natural width at h = 1) and 50 (angle
   p1→p2); width factor 41 unchanged. **FIT**: 40 unchanged, 41 = computed factor, 50 = angle p1→p2
   (BricsCAD data: txt FIT w = 0.1612, Arial 0.2018). Renderer: recompute from p1/p2 anyway.
   ezdxf#333: TrueView/BricsCAD FIT text is "slightly narrower and offset from the insert point" compared
   with ezdxf's ink-box stretching → AutoCAD stretches the **advance/union box**, not the ink box, so
   the ink starts at lsb·scale after p1. ezdxf#353: for FIT/ALIGNED AutoCAD and BricsCAD do *not* mirror
   BACKWARD about the baseline, and with both flags set AutoCAD applies no mirroring at all (VERIFIED) —
   quirky; ezdxf chose not to copy it. ezdxf#1053: FIT renders differently in BricsCAD, ezdxf, LibreCAD.
6. **Vertical text** (STYLE 70 bit 4, SHX with modes = 2): characters stack downward; BricsCAD data in
   `text_stacked_shx_font.dxf` shows different justification semantics (e.g. "Right…" dy = ±6.42 h,
   width factor has no effect on vertical offsets). AutoCAD supports vertical text only for SHX.
   ezdxf#353: AutoCAD/BricsCAD "fail completely in different ways" for FIT/ALIGNED vertical text.
   Low priority; UNKNOWN details.

**CONFLICT inside ezdxf** (none matches the measurements): `tools/text.py:_shift_y` 72=4 =
(cap − descender)/2 metric; `addons/drawing/text.py` 72=4 = lower-case centre, MC = cap/2;
`addons/text2path.py` horizontal alignment from the path **ink bbox**; dxf-viewer/mlightcad use ink boxes
for T/M/B too (mismatch).

### 1.5 Transformation order (for rendering)

ezdxf `text_transformation_matrix` (text.py:450) and `TextLine.transform_2d` (tools/text.py:171):

1. glyphs laid out at height h with baseline-left at (0,0) (advance-based pen positions)
2. oblique 51 (degrees from vertical, positive leans right): shear x' = x + y·tan(oblique).
   ezdxf TEXT matrix = shear **then** width scale (x' = w·(x + y·tan)); ezdxf MTEXT renderer =
   scale then shear (x' = w·x + y·tan) — different results for w ≠ 1. **UNKNOWN** which AutoCAD uses;
   test oblique 30° + width 3 and measure a vertical stem.
3. alignment shift (computed on the width-scaled box)
4. mirror: backward (71 & 2) → x·(−1), upside-down (71 & 4) → y·(−1), **about the alignment point**
   (ezdxf drawing/text.py `_get_extra_transform`, applied after the anchor translation). Special
   FIT/ALIGNED quirks: ezdxf#353 (1.4 item 5).
5. rotation 50 (degrees; FIT/ALIGNED: angle of p2 − p1 instead, ezdxf#319/#320)
6. translate to the anchor; OCS → WCS with the arbitrary-axis algorithm (210).
7. Extrusion (0,0,z) with any z renders as 2D; (0,0,0) acts like (0,0,1) (ezdxf PR #280, VERIFIED
   AutoCAD). With (0,0,−1) the OCS itself mirrors X — AutoCAD writes (0,0,−1) whenever geometry was
   mirrored (ACadSharp#1224/#1228, checked with `entget` on 18 drawings) — don't mirror twice.
   ezdxf: TEXT `scale_x *= sign(extrusion.z)`; MTEXT `scale_y = sign(extrusion.z)` ("Not sure about the
   rationale … but it does match AutoCAD behavior"). ACadSharp#626: MTEXT flipped by scale (−1,1,1)
   (normal −Z) "shows mirrored and rotated" in AutoCAD.
8. Thickness 39 extrudes SHX text only (ezdxf text.py comment); PLOT of a plan view: no visible effect.

Height ≤ 0: ezdxf skips TEXT with height < 1e-9 (frontend.py:409); ACadSharp#1194: height-0
ATTRIB/TEXT are common "invisible metadata" in IFC/space-planning exports and AutoCAD reads them fine
→ draw nothing (ASSUMPTION: AutoCAD draws nothing / a dot?). MTEXT height 0 with inline \H exists
(ezdxf#1372).

### 1.6 Special codes in TEXT / ATTRIB / ATTDEF

(Case-insensitive; ezdxf const.py:368, tools/text.py:279 `plain_text`; LibreCAD
rs_filterdxf.cpp:2550; dxf-viewer TextRenderer.js:15.)

| Code | Result |
|---|---|
| `%%c` | diameter. **VERIFIED-BY-ACAD (AutoCAD 2027 TEXTBOX, §4.5): with a TTF, `%%c` renders exactly like `\U+00D8` "Ø"** (and like `%%216`), while `\U+2205` gives a different glyph from a fallback font → ezdxf's mapping %%c → U+00D8 is right. The Autodesk symbol table lists Diameter %%c ↔ U+2205 (nominal) and AutoCAD-generated dimension text contains a literal U+2205 (cad-viewer#473); LibreCAD/dxf-viewer map %%c to U+2205 (**mismatch**). Non-Unicode SHX: shape 258 (ADSK); Unicode SHX: UNKNOWN whether U+00D8 or U+2205 is used (txt.shx gave identical boxes). **PLOT, TTF without U+2205 (Liberation Sans): U+2205 is drawn as the font's own U+00D8**, not from a fallback font, for dimension text (AutoCAD writes a literal U+2205) and `\U+2205` alike (VERIFIED-BY-ACAD 2026-10-01, dimensions/*-nb, text/fallback-diameter-*, special-cdp-vs-unicode); the TEXTBOX difference above came from a font setup with a U+2205 fallback. |
| `%%d` | ° U+00B0 |
| `%%p` | ± U+00B1 |
| `%%%` | "%" |
| `%%u` / `%%o` / `%%k` | toggle underline / overline / strike-through until the same code again or end of string (ezdxf const.py:374; mlightcad expands `%%uon/%%uoff`-style variants too) |
| `%%nnn` | character with decimal code nnn — 3 digits (LibreCAD; ezdxf doesn't decode it), mlightcad accepts 1–3 digits. **VERIFIED-BY-ACAD**: `%%216` renders Ø in Arial (same as `%%c`) → Latin-1/Unicode code point for TTF. Non-Unicode SHX: raw byte = shape number (ASSUMPTION). Test `%%176`, `%%248`, `%%065`, `%%1`, `%%300`. |
| `%%` + other | ezdxf keeps it literally; mlightcad drops the 3 chars — **UNKNOWN** in AutoCAD |
| `\U+XXXX` | Unicode escape, **exactly 4 hex digits**, upper or lower case (cad-viewer#615 `\U+22054.0` = U+2205 + "4.0"; ezdxf#1380 lowercase hex). Also valid in TEXT (ezdxf#1063 `\U+00F86.3` → ø6.3) and in R2007+ files (libredwg#1414). `\UXXXX` without "+" is not accepted by AutoCAD (ezdxf#1063). Surrogate pairs as two escapes (mlightcad combines them). |
| `\M+nXXXX` | multibyte escape, see §5 |
| `^X` caret | ezdxf `caret_decode`: `^X` → chr((ord(X) − 64) mod 126): `^I` tab, `^J` LF, `^M` CR, `^ ` → "^". In TEXT non-printables render as "?" (MTEXT: "▯"); `\t` renders "?"; a TEXT **ending with "^" makes AutoCAD refuse the DXF** (MTEXT is fine); `^@` (NUL) terminates the string (ezdxf#198, #199, VERIFIED AutoCAD). |

MTEXT codes are **not** interpreted in TEXT: `\P` is not a line break in TEXT (ezdxf#258, VERIFIED
BricsCAD); mlightcad routes TEXT through its MTEXT parser (mismatch). TEXT is single line (raw newline
breaks the DXF, netDxf#91/#472); AutoCAD accepts > 256 chars (ACadSharp#1045). Underline/overline
geometry: ezdxf puts them at bottom − h/5 / top + h/5 ("???" in the code), mlightcad at −0.05 h and
h + 0.05 h — **UNKNOWN** in AutoCAD, measure.

### 1.7 $MIRRTEXT and mirrored INSERTs

- `$MIRRTEXT` (header 70, spec p.21 "Mirror text if nonzero") only affects the MIRROR command at edit
  time; AutoCAD never re-mirrors existing text (gdal#6018, VERIFIED) → **a renderer ignores it**.
- "Text and constant attributes within an inserted block are mirrored as a consequence of mirroring the
  entire block … regardless of the MIRRTEXT setting" (Arkance "Working with mirrored text"; cadforum
  tip 6251). Non-constant ATTRIBs are separate entities with their own stored (readable) geometry.
- Rendering an INSERT with negative scale: transform the glyph geometry with the full block matrix
  (mirrored glyphs). When AutoCAD *explodes* such a block the text loses its reflection (TEXT can't
  store one, ezdxf PR #154, VERIFIED). ezdxf `Text.transform` re-derives rotation/oblique/width and
  flips the extrusion for reflections — fine for editing, but for rendering transform geometry.

## 2. ATTRIB / ATTDEF

### 2.1 Structure

ATTRIB = `AcDbEntity` + `AcDbText` (same codes as TEXT's first subclass, **no second AcDbText**) +
`AcDbAttribute`. ATTDEF = `AcDbEntity` + `AcDbText` + `AcDbAttributeDefinition`.
"DXF Reference for ATTRIB is a total mess and incorrect … the valign field from the 2nd AcDbText
subclass of the TEXT entity is stored in the AcDbAttribute subclass" (ezdxf:entities/attrib.py:75).
The spec order of 50/41/51/7/71/72 after 73 for ATTRIB (p.73) is wrong; the real order is the TEXT
order. Parse by group code, not by position — group codes 70, 72, 73, 280, 10, 11, 40, 2 appear
several times with different meanings in different subclasses, so **parse per subclass**.

`AcDbAttribute` / `AcDbAttributeDefinition` codes:

| Code | Meaning |
|---|---|
| 3 | prompt (ATTDEF only, before 2) |
| 2 | tag (no spaces; mandatory — ezdxf audit deletes attribs without tag) |
| 70 | flags: 1 invisible, 2 constant, 4 verify, 8 preset |
| 73 | field length (unused, 0) — *not* vertical alignment! |
| 74 | vertical justification (same values as TEXT 73) |
| 280 | lock position (R2007+). Also "version number 0 = 2010" in the spec uses 280 in the same subclass — ezdxf takes the *last* 280 as lock_position (attrib.py:82) |
| 71 | R2018+: attribute type 1 = single line, 2 = multi-line ATTRIB, 4 = multi-line ATTDEF (ezdxf attrib.py:113; ODA 20.4.4 RC) |
| 72 | R2018+: unknown, written as 0 (ezdxf `export_dxf_r2018_features`) |
| 11 | R2018+: duplicated alignment point ("why?" ezdxf) |
| 101 "Embedded Object" | R2018+ multi-line: embedded MTEXT data follows (see 2.3) |

Spec's `AcDbXrecord` subclass inside ATTRIB/ATTDEF (280 cloning flag, 70 MText flag 2/4, 70
isReallyLocked, 70 # secondary attribs, 340 handles, 10 align point, 40 annotation scale, 2 tag) and
the "attached MTEXT entity following the ATTRIB" (spec p.70) have **never been seen in real files**
(ezdxf attrib.py:141, 212: "The 'attached' MTEXT feature most likely does not exist!"). Keep them as
raw tags if encountered.

### 2.2 Flags and visibility

- 1 invisible: not drawn unless $ATTMODE = 2.
- 2 constant: value fixed in the ATTDEF; **AutoCAD does not create ATTRIB entities for constant
  attributes** — the ATTDEF's default value (1) is drawn as part of the block geometry in every block
  reference (ezdxf#13; realdwg-web PR #154/#197 and cad-viewer PR #546, "matching AutoCAD": loose ATTDEF
  in model/paper space draws its **tag**; inside a block non-constant ATTDEFs are **not** drawn,
  constant ones (incl. constant multi-line) draw their default value, invisible ones nothing).
  ezdxf's `virtual_block_reference_entities` skips **all** ATTDEFs (explode.py:211) → ezdxf does not
  draw constant attributes (mismatch). SolidWorks writes real values into ATTDEF defaults, so drawing
  non-constant ATTDEFs doubles title blocks (realdwg-web #154).
- 4 verify / 8 preset: UI-only.
- `$ATTMODE` (header 70): 0 = none (no attributes at all), 1 = normal (respect invisible flag),
  2 = all (show invisible too) (spec p.12). ezdxf ignores $ATTMODE (properties.py:673 only checks the
  flag). Whether $ATTMODE=0 also hides constant attributes: **UNKNOWN** (probably yes).
- ATTDEF outside a block (model/paper space): AutoCAD/BricsCAD render the **tag** (2), not the default
  value (ezdxf attrib.py:62, drawing/text.py `_split_into_lines`). In the block editor the tag is shown
  too; in block references ATTDEFs are not drawn (except constants, above).
- Stand-alone ATTRIB (not after an INSERT) is ignored by BricsCAD/TrueView; BricsCAD RECOVER deletes it
  (ezdxf attrib.py:51).
- Visibility is independent of the INSERT's: INSERT 60=1 hides the insert, ATTRIB 70&1 is the attribute's
  own hidden flag, separate from its entity 60 (ezdxf#465/#504, netDxf#193). The Autodesk online viewer
  doesn't always draw ATTRIBs (dxf-viewer#50) — irrelevant for PLOT.
- AutoCAD needs BLOCK flag 70 bit 2 ("has attribute definitions") for ATTSYNC/BATTMAN, BricsCAD
  ignores it (ezdxf#218) — no rendering effect.
- Tags with spaces load fine in AutoCAD (netDxf#114); duplicate ATTDEF tags exist (netDxf#190).
- AutoCAD Map 3D showed an ATTRIB 72=0/74=2 as MiddleCenter (netDxf#67, plugin data) — edge case.

### 2.3 R2018 multi-line attributes (embedded MTEXT)

Example (ezdxf:tests/test_02_dxf_graphics/test_208_attrib.py:430ff, from a real file):

```
0 ATTRIB / 100 AcDbText / 10 574.8,961.1 / 40 3.0 / 1 TEST VENUE / 7 Arial_3 NARROW / 72 1 / 11 592.3,962.6
100 AcDbAttribute / 2 DRAWING-NAME / 70 0 / 74 2 / 280 0 / 71 2 / 72 0 / 11 592.3,962.6
101 Embedded Object
10 592.3,962.6 / 40 3.0 / 41 0.0 / 46 0.0 / 71 5 / 72 5 / 1 TEST VENUE\PTEST FLOOR PLAN
7 Arial_3 NARROW / 73 1 / 44 1.0
```

- After `101 Embedded Object` come the normal AcDbMText codes starting at 10 (ODA 20.4.4: "all fields
  of an embedded MTEXT object … starting from the Entmode", DXF from group 10). Load them with the MTEXT
  loader (ezdxf `EmbeddedMText.load_dxf_tags`).
- The AcDbText 1 value is unreliable: ezdxf's comment (attrib.py:388) says AutoCAD concatenates the lines
  as "Line1\PLine2…", the test file above has only the first line, and ezdxf#258 reports AutoCAD
  multi-line ATTRIBs whose group 1 is empty → **always render the embedded MTEXT, not group 1**
  (ezdxf frontend.py:419; ezdxf#1222/#1191: changing group 1 has no visible effect, "the MTEXT content
  wins"). AutoCAD renders `\P` in these as line breaks (ezdxf#258, VERIFIED).
- Some files have embedded MTEXT without the multi-line type flag (ezdxf#258); BricsCAD writes two
  separate ATTRIBs; TrueView 2022 renders embedded MTEXT differently from AutoCAD and a BricsCAD-made
  multi-line attribute displays wrong in TrueView (ezdxf#258, #931) → follow AutoCAD: render the embedded
  MTEXT whenever a 101 Embedded Object is present (ASSUMPTION).
- Duplicated & maintained values: 7 style and 40 height in both parts (ezdxf attrib.py:567).
- Graphical properties (layer, color, linetype…) come from the host ATTRIB.
- AutoCAD always writes: insert, char_height, width, defined_height, attachment point, flow direction
  (5 = by style), style, line spacing style & factor (ezdxf `set_required_dxf_attributes`).
- Pre-R2018 DXF export of a multi-line attribute: AutoCAD degrades to a single-line ATTRIB.

### 2.4 Relation to the INSERT

- ATTRIB entities follow the INSERT (66 = 1 "attributes follow"), end with SEQEND, owner = INSERT.
- Their geometry is **already in final position**: stored in the OCS of the ATTRIB's own 210, already
  transformed by the insert's scale/rotation/position at insertion time and updated by AutoCAD when the
  INSERT is moved/rotated/scaled (ACadSharp#444/#1003/#1046, netDxf#408/#135: stored absolute; ATTSYNC
  recomputes; also true for ATTRIBs of nested INSERTs, which are in that block's coordinates). **Do not apply the INSERT transform again** (ezdxf frontend.py:915:
  "Block reference attributes are located __outside__ the block reference!").
- **Draw order**: ATTRIBs are drawn **after** all block content (on top of a HATCH in the block),
  TrueView and NanoCAD do this (ezdxf#1321, VERIFIED). Overall draw order is SORTENTSTABLE-driven (see the
  draw-order note).
- MINSERT (row/column arrays): the stored ATTRIBs belong to the first instance only; ezdxf's
  `Insert.multi_insert()` creates virtual copies with translated attribs (drawing frontend 906). Check
  AutoCAD behaviour → **UNKNOWN** (AutoCAD shows attribs on every MINSERT cell? ezdxf assumes yes).
- Lock position (280 = 1): UI-only, rendering unaffected.
- Since the ATTRIB is a copy made at insertion time, its style/height/rotation may differ from the ATTDEF
  (users edit them); never re-derive from the ATTDEF.
- ATTRIB text content can contain %%-codes like TEXT, and fields (text of a field is the evaluated
  cached string).

## 3. MTEXT

### 3.1 Group codes (`AcDbMText`)

MTEXT is a **WCS** entity (no OCS): 10 and 11 are WCS, 210 only defines the plane normal
(ezdxf docs dxfinternals/entities/mtext.rst "Orientation"; ODA 20.4.46).

| Code | Meaning | Notes |
|---|---|---|
| 10 | insertion point (WCS) | position relative to text given by 71 |
| 40 | nominal (initial) char height = cap height | ezdxf default 2.5, must be > 0 |
| 41 | reference rectangle width | 0 or missing ⇒ no word wrap ("If you specify a width of 0, word wrap is turned off", AutoCAD MTEXT command help). In column mode wrong for linked columns (holds total width), see 3.7 |
| 46 | defined height (R2007+, `AC1021`) | 0 except in column mode / "No columns" with manual height |
| 71 | attachment point 1..9 (TL,TC,TR,ML,MC,MR,BL,BC,BR) | default 1 |
| 72 | drawing direction 1 = L→R, 3 = T→B, 5 = by style | ezdxf default 1; AutoCAD writes 5 in embedded MTEXT |
| 1 / 3 | text: 3 = 250-char chunks, last chunk in 1 | see 3.2 |
| 7 | style | "STANDARD" |
| 210 | extrusion | (0,0,1) |
| 11 | x-axis direction (WCS) | wins over 50; "ACAD doesn't even bother to adjust it to unit length" (ODA) → normalise |
| 42 | horizontal width of the characters (read-only, "ignored if supplied") | rarely in AcDbMText; AutoCAD R2018+ writes extents 42/43 inside the Embedded Object — an exact oracle, see 3.6.1 |
| 43 | vertical height (read-only) | as 42; "no reliable way to calculate the MTEXT height" (ezdxf) — but see 3.6.1 |
| 50 | rotation. Spec says **radians**; ezdxf: "Error in DXF reference, which claims radians" → **degrees** | **CONFLICT** spec vs ezdxf; ezdxf is right in practice (AutoCAD writes 50 only on DXF input; DWG has no rotation field, ODA 20.4.46). "if both a code 50 and codes 11 are passed, the last one wins" (spec) vs ezdxf "text_direction has higher priority" |
| 73 | line spacing style 1 = at least, 2 = exact | default 1 |
| 44 | line spacing factor 0.25 … 4.00 | default 1 (ezdxf clamps) |
| 90 | background fill flags: 0 off, 1 use color 63/421/431, 2 drawing-window color, 3 = 1\|2 "use background (canvas) color", 16 text frame (R2018+); AutoCAD writes 17 = fill + frame (ezdxf#207) | R2007+ |
| 63 | background ACI color (required, even if 421 is used; ignored then) | |
| 421 | background true color (RGB int) | spec says 420-429 |
| 431 | background color name | |
| 45 | fill box scale ("border offset factor") 1..5, default 1.5 | Autodesk help: "A factor of 1.0 exactly fits the multiline text object. A factor of 1.5 extends the background by 0.5 times the text height." |
| 441 | background transparency ("not implemented"; not used by AutoCAD/BricsCAD) | |
| 101 "Embedded Object" | R2018 column data (3.7) | |
| 75,76,78,79,48,49,50 | spec's column codes — **these never appear as plain group codes**; they are the *encoded* codes inside XDATA ACAD_MTEXT_COLUMN_INFO (pre-R2018) | ezdxf mtext.rst |

Group 45/90/63 are required together; text-frame-only: 90 = 16 and 45/63/421/431/441 absent,
scale fixed 1.5 (ezdxf mtext.rst "Text Frame") — **wrong for AutoCAD 2027**: the frame uses 45 like the
mask (default 1.5 when absent); verified frame/mask geometry in §3.7.1. Pre-R2018 the frame is additionally stored as a
separate LWPOLYLINE referenced by XDATA `ACAD_MTEXT_TEXT_BORDERS_BEGIN` (1070 80/16, 46/1.5, 81/1,
5/handle…) — ezdxf deletes those LWPOLYLINEs on load; a renderer should **not draw the LWPOLYLINE
twice** (it is a normal visible entity in the layout! → **UNKNOWN**: does AutoCAD draw it? It is
probably drawn only by old versions; check whether it's on a special layer/invisible).

Background mask geometry (AutoCAD-verified rules: §3.7.1): ezdxf `make_bg_renderer` offsets all four sides by
`char_height × (box_fill_scale − 1)` around the *column* box (width = column/reference width, not the
text ink). Widely reported AutoCAD behaviour: the mask spans the full MTEXT reference width, not the text
extents (users are told to set width 0/"size to fit") → **VERIFY** exact horizontal extent incl. width 0.
Canvas colour (90 = 3 or 2) can't be known from the file; for PLOT it is the paper colour (white) —
**ASSUMPTION**.

### 3.2 Text content assembly

- Concatenate all 3 chunks in order, then the 1 chunk (ezdxf `load_mtext_content`). AutoCAD writes
  250-char chunks (ODA: "ACAD's entget breaks this string into 250-char pieces (not 255 as doc'd) —
  even if it's mid-word"). BricsCAD writes 249 bytes; "one byte is not always one char" (ezdxf
  mtext.rst). Chunks may split inside a format code or even inside a caret sequence — ezdxf's writer
  avoids splitting after "^" (`split_mtext_string`). **Always concatenate before parsing.**
  Some writers (libredwg dwg2dxf) emit group 1 first (dxf-json#11, dxf-parser#36, FreeCAD#8968) —
  concatenate in file order (3…3, then 1; a leading 1 followed by 3s: treat 1 as the first chunk).
- R2007+ DXF: UTF-8. Older: $DWGCODEPAGE + \U+ / \M+ escapes (§5).
- ezdxf replaces literal `\n` by `\P` on load (`escape_dxf_line_endings`).
- DWG stores the whole string at once (ODA).

### 3.3 Inline format code language

Sources: ezdxf docs/source/dxfinternals/entities/mtext.rst "Inline Code Specials" (behaviour
**tested by ezdxf author in BricsCAD/AutoCAD** — the list below reproduces those observations),
ezdxf `MTextParser` (tools/text.py:1239), ezdxf notes "MText format codes.md" (adndevblog "Dissecting
MTEXT format codes"), cadforum tip 8640, mlightcad mtext-parser (see §6.3).

Tokenisation rules (ezdxf parser):
- `\` + one of `\ { }` → literal char. A non-escaped `\` always ends the current word.
- `{` pushes the current property context, `}` pops it ("can be nested up to 8 levels deep" — ezdxf
  docs; ezdxf itself does not limit). Unbalanced `}` → ignored (pop on empty stack is a no-op).
- Unknown `\X` command → the backslash and letter are **printed verbatim** (ezdxf `UnknownCommand`).
- Control characters < 0x20 other than TAB/LF are replaced by a space; `^J`/LF → new paragraph;
  `^I` → tab; `^M` ignored (docs) / space (parser).
- Commands with arguments: "the terminator symbol ';' is optional" for single-value commands
  (\A \C \c \H \W \T \Q), **mandatory** for \f \F \p \S (argument runs until next `;` or end of string).
  ezdxf comment: the content `\H0.1\A1\C1rot` is valid (tools/text.py:760).

| Code | Meaning / argument | Edge cases (ezdxf mtext.rst) |
|---|---|---|
| `\P` | new paragraph (hard line break) | |
| `\N` | new column (column break) | not used for automatic column breaks in R2018 |
| `\X` | "paragraph wrap on the dimension line (only in dimensions)" — text before \X goes above the dim line, rest below | ezdxf token WRAP_AT_DIMLINE, unused |
| `\~` | non-breaking space | |
| `\\` `\{` `\}` | literal chars | |
| `{ … }` | property scope | |
| `\L` `\l` | underline on/off | strokes continue across spaces |
| `\O` `\o` | overline on/off | |
| `\K` `\k` | strike-through on/off | |
| `\A0;` `\A1;` `\A2;` | vertical alignment of the following text relative to the line: 0 bottom, 1 center, 2 top | "3".."9" and "-" → 0; any other char terminates the command and is printed ("\AX" → "X") |
| `\Cn;` | ACI color | leading +/- terminates the command ("\C+5" prints "\C+5"; AutoCAD 2027 prints "+5", §11); values > 255 consumed but ignored ("\C1000" prints nothing); ezdxf accepts ≤ 256 |
| `\cn;` | true color as integer n = R + 256·G + 65536·B ("\c255;" = red, "\c16711680;" = blue — ezdxf tools/text.py comment; netDxf writes `BitConverter.ToInt32([R,G,B,0])`, same). **CONFLICT**: mlightcad reads 0xRRGGBB. | ≥ 16777216 masked with 0xFFFFFF; "\c9999999999;" switches to (255,227,11) |
| `\Hv;` / `\Hvx;` | absolute height (drawing units) / factor of current height | negative ignored (abs used), leading "+", ".5", "1e2" valid; invalid float terminates and is printed ("\H1..5") |
| `\Wv;` / `\Wvx;` | width factor absolute / relative | as \H |
| `\Tv;` / `\Tvx;` | tracking (char spacing factor, 1 = normal) | as \H; "negative values are used" |
| `\Qa;` | oblique angle, degrees | as \H |
| `\fName\|b1\|i0\|c0\|p0;` | font by family name (TTF) or file name (SHX: `\fromans.shx;`? `\Fgdt;`), b bold, i italic, c charset/codepage, p pitch | family required; "fonts which are not available on the system are replaced by the TXT.SHX shape font" (ezdxf; AutoCAD 2027 uses FONTALT = simplex.shx, §4.1); a `,bigfont` suffix in the name selects a bigfont (mlightcad `splitInlineFontFamily`); b1/i1 only exact "1" enables; c and p "ignored by AutoCAD and BricsCAD"; order free; empty name = no change. An unknown `\f` family that is also not a font file (`\fNoSuchFamily|b0|i0|c0|p34;`) **draws nothing** in the plot; `\FNoSuchFont.shx;` uses FONTALT (acad-default-fonts/mtext-f-missing, VERIFIED-BY-ACAD 2026-10-01) |
| `\FName;` | older font command (file name, e.g. `\Fgdt;`, `\Ftxt.shx;`) | "\F ignores some arguments" |
| `\S…;` | stacking, see 3.4 | |
| `\p…;` | paragraph properties, see 3.5 | |
| `^I` `^J` `^M` | tab / line break / ignored | "other characters render as empty square ▯"; "1^ 2" renders "1^2" |
| `%%c %%d %%p %%%` | Ø ° ± % (also in MTEXT) | `%%nnn` and `%%u/o/k` in MTEXT: mlightcad expands them; AutoCAD: UNKNOWN |
| `\U+XXXX`, `\M+nXXXX` | unicode / mbcs escapes (§5) | |

Height semantics: MTEXT context height starts at entity 40; `\H2.5;` absolute, `\H0.7x;` relative to the
*current* height (accumulates: 2.5 × 2 × 3 = 15, ezdxf `scale_height` doc). BricsCAD writes fractions
as `{\H0.7x;\S1/2;}` (ezdxf:examples_dxf/mtext_complex_inline_codes.dxf) — the 70 % stack size is
**explicit** in the string, not implied.

### 3.4 Stacking `\S`

- Syntax: `\S` numerator divider denominator `;` with divider `^` (tolerance: no line), `/`
  (horizontal fraction bar), `#` (diagonal/slanted fraction).
- ";" is mandatory; everything until the next ";" (or end of string) belongs to the fraction;
  `\;` escapes a semicolon.
- "a space ' ' after the divider char '^' is mandatory to avoid caret decoding: '\S1^ 2;'" (the pair
  "^ " decodes to "^"); a space after "/" or "#" is rendered as a leading space of the denominator.
- Numerator/denominator may contain spaces; backslashes inside are ignored except `\;`
  ("\S\N^ \P" renders N over P) ⇒ **no property changes inside a stack**; braces render literally;
  a second divider is literal ("\S1/2/3" → "1" over "2/3").
- No divider → the content is rendered as plain text (ezdxf `fraction()` with empty type).
- Tolerance-style stack `\S+0,8^+0,1;` (adndevblog example; comma decimal separator is just text).
- AutoCAD Stack Properties dialog: text size 25..125 % (default 70 %), position top/center/bottom
  (default center, sysvar TSTACKALIGN 0/1/2 default 1), styles fraction horizontal/diagonal,
  tolerance, **decimal** (tolerance aligned at the decimal point). AutoStack only for numerics.
  How "decimal" and the position are encoded in the string: **UNKNOWN** (no
  surveyed renderer implements it). Size is encoded as `\H0.7x;` wrapper (BricsCAD/AutoCAD).
- Geometry in ezdxf (tools/text_layout.py:544 `Fraction`): both parts use the **current** height
  (no implicit scaling), height = 1.2 × (top + bottom) for `/` and `^`, width = max(top, bottom),
  both centred; slanted: width = top + bottom, top part at top-left, bottom part at bottom-right,
  divider from (cx−d, cy−d) to (cx+d, cy+d) with d = min(w,h)/2; horizontal bar at mid height.
  These are ezdxf guesses, **not measured** → needs AutoCAD test (bar position/length/thickness,
  gap between parts, vertical placement relative to baseline for \A0/1/2).

- Other renderers' stack geometry (all guesses, mutually inconsistent): dxf-viewer parts 0.7 × h
  ("Matches the AutoCAD default stack height"), baseline separation 1.4 × part size, centred on
  baseline + h/2, `#` slanted bar; mlightcad `^` parts at 0.7 (super/subscript offsets +0.1 h / −0.6 h),
  `/` and `#` at **full size** with a horizontal bar, bar at v − 0.8·fs + 0.3·H, and its PDF renderer uses
  other constants. BricsCAD and TrueView 2022 render the same stacks visibly differently (ezdxf#524).
  No thread gives AutoCAD numbers → **top-priority test** (fractions appear in every dimension with
  inch units/tolerances). **Answered by AutoCAD 2027 plots**: §11 "Stacks" (simplex) and "Stacks
  with TrueType" (VERIFIED-BY-ACAD 2026-10-01) — parts at the current height, placed by ink box;
  the ezdxf / dxf-viewer / mlightcad geometry above does not match.
- Real AutoCAD strings: `\S5^6;` (caret without space), `{\H0.7x;\S1/2;}`, `\H1.42857x;` after a stack
  to restore (1/0.7) (ezdxf#889).

### 3.5 Paragraph codes `\p…;`

(ezdxf mtext.rst; tools/text.py:1587 `parse_paragraph_properties`.)

- Arguments separated by ","; values are **multiples of the MTEXT initial char height (40)**
  (e.g. 40 = 2.5, `\pl1;` → 2.5 units).
- `i` first-line indent **relative to l**, `l` left indent, `r` right indent,
  `q` + l/r/c/j/d alignment (left, right, center, justified, distributed),
  `t` tab stops (comma list; plain number = left stop, `c` prefix centre, `r` prefix right) — defining
  any tab stop disables the default stops (every 4 × char height).
- `x` "is required if a q or t argument is present, the placement of the x has no obvious rules";
  export rule: start with `\px`, order i,l,r,q,t, end with `;`.
- `*` resets the value: BricsCAD resets all with `\pi*,l*,r*,q*,t;`.
- Examples from BricsCAD output: `\pi0;`, `\pi*;`, `\pxqr;`, `\pq*;`, `\pxi0,qj;`, `\pxi-3,l4t4;`
  (bullet list: first line −3, left 4, tab at 4), `\pi*,l*,t;`
- AutoCAD 2008+ paragraph dialog adds **paragraph spacing before/after** and **per-paragraph line
  spacing**. Encodings seen: netDxf writes `\pi<first>,l<left>,r<right>,b<before>,a<after>;` and
  `\ps*;` (inherit) / `\psa<f>;` (at least) / `\pse<f>;` (exact) / `\psm<f>;` (multiple)
  (netDxf/Entities/MText.cs:640-700; "the distance between two paragraphs is the total of the after
  spacing of the upper paragraph and the before spacing of the lower one", values 0.25..4.0 per
  MTextParagraphOptions.cs); a real AutoCAD sample contains `\pxsm2;` and `\ps*;` (ezdxf#889);
  dxf-viewer comment: "`\pxsm1,qc;` and `\pqc;` mean the same thing as `\pxqc;`" (it skips them).
  Units of b/a (multiples of h? of line pitch?) and exact semantics of sm/se/sa: **UNKNOWN** — test.
  mlightcad adds `tz` (clear tab stops). The parser must skip unknown letters + numbers gracefully.
- Paragraph properties are *persistent* until changed and **not scoped by `{}`** — ezdxf stores
  them in the context, so a `}` pops them; AutoCAD does not (VERIFIED-BY-ACAD 2026-10-01, §11).
- Default paragraph alignment when no `q` is given follows the attachment point column
  (left/center/right) (ezdxf `ATTACHMENT_POINT_TO_ALIGN`).

### 3.6 Layout algorithm

#### 3.6.1 An AutoCAD oracle: stored extents 42/43

AutoCAD writes the MTEXT extents — 42 "horizontal width of the characters" and 43 "vertical height" —
either in AcDbMText or (R2018+, column type ≠ 0, which AutoCAD uses even for plain MTEXT: type 2,
count 1) inside the `101 Embedded Object` block. I collected all MTEXT with 42/43 from AutoCAD-style
files under `research/repos` (≈ 130 entities: `ezdxf/examples_dxf/{text,colors,uncommon,3dface,
visibility,hatches_2,wipeout_door}.dxf`, `three-dxf/sample/data/demo.dxf`, ACadSharp
`samples/sample_AC1032_ascii.dxf`, `netDxf/TestDxfDocument/sample.dxf`, `bjnortier-dxf/…/attribute.dxf`)
and compared them with a model evaluated with fontTools on `C:/Windows/Fonts/arial.ttf` (Arial cap
basis 1466 units) and with known simplex.shx proportions (above 21, below 7).

**Model that reproduces AutoCAD's 42/43 to 4 decimals** (single-height text, line spacing factor 1,
"at least" style, no wrapping needed; ~50 Arial entities + all simplex ones):

```
per line i:   inkTop_i, inkBottom_i, inkLeft_i, inkRight_i  (from glyph bboxes, pen-advance positions)
              ascent_i = max(h, inkTop_i)                    (cap height or higher ink)
line 1:       top of box = baseline_1 + ascent_1
line i+1:     baseline_{i+1} = baseline_i − (5/3·h·f − h) − ascent_{i+1}      (f = group 44)
              (= baseline_i − 5/3·h·f when the line has no ink above cap height)
bottom:       baseline_last + min(0, inkBottom_last)         (descenders only of the LAST line count)
43 = top − bottom
42 = max_i (inkRight_i − max(0, inkLeft_i))                  (+ tab advances; see below)
```

Evidence (h, stored value vs model):
- simplex "X" 100: 42 = 66.667 (14/21 h, ink width), 43 = 100 (cap); "x" 100: 42 = 52.38, **43 = 100**
  (ink top of x is below cap → ascent clamps to h); "p": 43 = 133.33 (= h + 7/21 h descender).
- simplex "Xxp^Jabc" 100: 43 = 266.67 = 5/3·100 + 100 (descender of line 1 ignored);
  "a\Pab\PXpc\Pabcdef" 20: 120 = 3·33.33 + 20; "Xxp\Pab\PXpc" 20: 93.33 = 2·33.33 + 20 + 6.67.
  ⇒ **pitch is exactly 5/3·h** (not 1.66 as in the -MTEXT help, not ezdxf's 1.667) — VERIFIED-BY-ACAD.
- Arial "Splines" 10: 42 = 44.6521 (ink 6546 units), 43 = 12.9468 = (1491 [S overshoot] + 407 [p])/1466·10
  — exact. "Text Alignment" 10: 43 = 12.94 = (1466 + 431 [g])/1466·10. "BYOBJECT" 1: 1.0348 (O/J
  overshoot top and bottom). "LAYER\PBLUE" 2: 5.3674 = 2·5/3·… + U-overshoot — exact.
- **Ascent push**: "OUTLINE OF\PSEPARATE ENTITIES" 2 → 5.4370, plain 5/3 model 5.4029: the extra
  0.0341 = 25 units = the S top overshoot of **line 2**; same for "ANGLE\PDIMENSION",
  "CIRCLE\PDIMENSION", "INSERTED\PBLOCK" (line-2 O/C overshoot) and "LINE1\PLINE2\PLINE3" (digit
  overshoot 6 units per line); lines without top overshoot ("LAYER\PBLUE", "edges …\Pall hidden") match
  plain 5/3 exactly. ⇒ in "at least" mode a line whose ink rises above cap height is pushed down by the
  excess. (Whether PLOT output actually shifts the glyphs or only the stored extents: **VERIFY**.)
- **Left edge**: "Arc" (A has lsb −3) 42 = inkRight − 0, not inkRight − (−3) → ink left of the pen
  origin is clipped (or the box starts at the pen origin); for positive lsb ("Splines", S lsb 92) the box
  starts at the ink.
- **Tab**: "asasas^I" h=200 → 42 = 1600 = 8 h: the tab advanced to the next default stop (4 h grid;
  the text already passed 4 h) → **default tab stops every 4 × h** (VERIFIED-BY-ACAD).
- **Exact spacing (73 = 2)**, one sample (ACadSharp, Arial h=1, 2 lines, second line with "p"): 43 =
  **3.0** where the at-least model gives 2.9443 → exact mode appears to use a fixed box, e.g.
  n·5/3·h − h/3 (= 3.0). **UNKNOWN** — more samples needed.
- Wrapping: simplex "a word wrap example a b c d e", 41 = 1217.8 → 3 lines (43 = 433.33), 42 =
  1123.8; " abc\Pabcd" with 41 = 83.5 → 3 lines (the leading space creates an empty first line);
  "\Pabc  \Pabcabcabc\Pa\P\Pb" → 6 lines, 42 = 771.4 = the unbreakable "abcabcabc" spilling past
  41 = 360; "                       spc                       def" 41 = 375 → 42 = 2080.95 = 23 spaces
  × 90.476 → a whitespace-only first line keeps its full width in the extents.
- Anomalies: one ACadSharp entity with "…Mtext^Jwith…" stored 42/43 of a single line (^J not a break?)
  — unexplained; bjnortier `attribute.dxf` 43 small mismatch.

Caveat: 42/43 are *extents*; the attachment-point frame used to place the text may differ (e.g. the
frame width is 41 when set). Verify placement with PLOT.

#### 3.6.2 Constants and rules

- **Line pitch** = 5/3 × h × 44 (spec "3-on-5"; VERIFIED-BY-ACAD above); realdwg-web PR #157, dxf-viewer,
  ezdxf all use 5/3 (ezdxf `leading()` 1.667 — slightly off). "A factor of 3/5 results in 0 space
  between lines" (ezdxf notes). 44 valid 0.25..4.0; AutoCAD omits 72/73/44 when default — default 1/1/1.0
  (libredwg#1404; factor 0 from libredwg must be treated as 1, realdwg-web PR #216).
- **At least vs Exact**: at least = pitch grows with taller content (ascent push above; with `\H`
  larger text, presumably the same rule with the larger cap height — ASSUMPTION); exact = constant
  pitch 5/3·h·f regardless of content (spec: "taller characters will not override").
  mlightcad: at-least = max(5/3·f·H, 5/3·maxLineFontSize). ezdxf effectively does at-least with
  `leading(max cap height of line)`.
- **Vertical frame**: top = cap top (or higher ink) of line 1; bottom = last baseline (+ last-line
  descenders for the extents). ezdxf complex renderer: bottom = last baseline; ezdxf simplified renderer:
  last baseline − descender, middle = midpoint(first-line x-height, last baseline); dxf-viewer: n ×
  pitch (bottom 2/3 h below last baseline); mlightcad: ink box. **UNKNOWN** which frame AutoCAD uses for
  attachment 4–9 — test with PLOT.
- **Horizontal frame**: with 41 > 0 the frame is the reference rectangle width (AutoCAD aligns lines
  inside [0, 41] according to the paragraph alignment, default from the attachment column); with 41 = 0
  the frame is the longest line (ezdxf estimates it ×1.01 safety factor, ezdxf#956). A word longer than
  41 spills past the frame on the right (not broken, dxf-viewer#160 VERIFIED AutoCAD).
- **Word wrap** (ezdxf `text_wrap` by M. Broadway "aims to match the behavior of AutoCAD" + ezdxf
  rendering notes + oracle above): break only at spaces (not "-" or "_"); multiple spaces collapse at a
  break; leading whitespace on the first line counts and "can trigger word wrapping, which creates a
  single blank line at the start"; a too-long single word is not broken and spills; "Placing a space
  before this word will create an empty line and push the word onto the next line"; a wrap directly
  followed by \P gives one break only; trailing spaces ignored for alignment except first line.
  **Fit test** (VERIFIED-BY-ACAD mtext/chunk-*, 2026-10-01, Arial h = 3/4, 41 = 190): a word stays
  on the line when its **ink** right edge is within 41; its advance may overshoot ("…erat, sed
  diam" ends at ink 189.75, advance 190.35, and stays). Testing the advance wrapped one word early.
  CJK: AutoCAD wraps **between characters** of CJK runs (ezdxf#1389 wontfix; dxf-viewer implements CJK
  break opportunities + kinsoku). Widths < h exist (one CJK char per line).
  **VERIFIED-BY-ACAD** text-probes/cjk-wrap-w40…w97, cjk-mixed-w44/58/71, cjk-open-w40
  (Microsoft YaHei h = 5, 2026-10-02): every CJK character (ideographs, kana, CJK punctuation,
  fullwidth forms) is a break opportunity on both sides, so a CJK / Latin boundary breaks too
  (`国家` / `ABCDEFGHIJKLMN` / `规范`); Latin runs break only at spaces and overlong ones stay on
  one line. The same ink fit test applies per character. Kinsoku: closing marks never start a
  line, the character before moves down with them (`未经允` / `许，不得泄`; `计）。` stays
  together); CJK opening marks `（《「【` never end a line (moved down); `“` does end a line
  (`师修正设计）。“`). The rest of the sets in mtext-layout.ts (small kana, `ー`, ASCII closing
  marks) is the usual rule, ASSUMPTION; Hangul is not probed (treated like Latin). 41 can be absurd
  (2,318,597, ezdxf#1078) — don't use it for bounding boxes.
- **Tabs**: default stops every 4·h (verified); `\pt…` explicit stops in multiples of h.
- **Style width factor & oblique apply to MTEXT** as initial `\W`/`\Q` (ezdxf#1351/#1353, VERIFIED
  TrueView 2020 and NanoCAD; fixed in ezdxf 2025-12).
- **Absolute `\H` inside blocks is scaled with the block** (ezdxf#855, VERIFIED AutoCAD); `\T` is a
  factor; `\p` indents/tabs are multiples of h (ezdxf#855) — **CONFLICT** ezdxf#1390: Tangent CAD writes
  `\pi-1440,l1920;` at h = 480 (absolute units); mlightcad multiplies by h too. AutoCAD: UNKNOWN.
- Paragraph alignment: left/right/center/justified (stretch spaces except last line of the paragraph)/
  distributed (ezdxf treats as justified; dxf-viewer maps `d` to justify, `j` to default).
- Underline/overline/strike geometry: ezdxf h/5 guesses; mlightcad ±0.05 h; UNKNOWN.
- `\T` tracking: ezdxf ignores; mlightcad `\T0.1x` → 1.1 (+1!) vs ezdxf multiplier — CONFLICT/UNKNOWN.
- Flow direction 3 / vertical MTEXT: unsupported everywhere; rare. AutoCAD 2027: §11 (vertical
  columns with dual-orientation SHX fonts, one line with TrueType).
- Column flow: text flows into the next column when the column height is full; dynamic manual height:
  last column unlimited (height 0).
- Hebrew/Arabic: the Autodesk viewer shows Hebrew MTEXT words right-to-left (ezdxf#1259); Thai needs
  shaping (ezdxf#1387) — AutoCAD's bidi/shaping behaviour UNKNOWN; low priority.

#### 3.6.3 Other verified MTEXT facts / edge cases

- Invalid escapes like `\:` are rendered **as-is** by AutoCAD (ezdxf PR #197, VERIFIED).
- `\S5^6;` (no space after ^) occurs in real AutoCAD MTEXT together with `\pxsm2;`, `\ps*;`, `\pq*;`,
  `\pi-3,l3,t3;`, `\fISOCPEUR|b0|i0|c0|p34;`, `\C152;\c12285479;` (ezdxf#889 sample) → the caret decoder
  must not eat `^6` inside stacks; follow AutoCAD: inside `\S`, "^" followed by a non-space is still the
  divider (ASSUMPTION based on this sample rendering as a stack; **REFUTED** by AutoCAD 2027: `S5^6;` renders the
  no-divider stack "5?", §11).
- Inline `\C` overrides the entity color (dxf-viewer#160, VERIFIED AutoCAD); BYBLOCK outside blocks →
  ACI 7.
- A `\M+` sequence split across a 3/1 chunk boundary is still decoded by AutoCAD 2024 (ezdxf#1322) →
  join chunks first.
- Embedded Object 70 = attachment point used by AutoCAD instead of 71 (ezdxf#1416/#1417, VERIFIED AutoCAD
  LT 2026: all 1,391 MTEXT had 70 = 71; a constant 70 = 1 shifted all non-TL MTEXT).
- Embedded Object 40/41/10/11 must not overwrite the main AcDbMText values (libredwg#1321: 14× giant text).
- Group 1 after the 101 block → AutoCAD rejects the DXF (ezdxf#40).
- 46 is always written by AutoCAD 2015+/LT 2020 (0 = auto) (ixmilia#185). MTEXT 50: AutoCAD 2015 never
  writes it (only 11) and reuses 50 for column heights in XDATA (ixmilia#184) — CONFLICT libredwg#1379
  says AutoCAD writes 50; our reader: 50 = rotation in **degrees**, 11 wins if both present.
- Direction vector (0,0,0) → MTEXT invisible in AutoCAD until edited (ACadSharp#620/#629, VERIFIED) →
  **don't render** it (matches PLOT).
- 90 = 17 (fill + frame) written by AutoCAD (ezdxf#207); 441 raw values like 843012 (ACadSharp#1205).
- `^J` instead of `\P` in MTEXT from AutoCAD Web/ODAFC (ezdxf#170); libredwg hands over raw `\n`/tabs
  (realdwg-web#221) → treat LF as `\P`, TAB as `^I`.
- Annotative MTEXT/MLEADER: the displayed text comes from the annotation-scale context data
  (ezdxf#840) — see annotation-scaling note.

### 3.7 Columns

Pre-R2018: one MTEXT per column. The first MTEXT carries XDATA (AppID ACAD):

```
1000 ACAD_MTEXT_COLUMN_INFO_BEGIN
1070 75 / 1070 type (0 none, 1 static, 2 dynamic)
1070 79 / 1070 auto height flag
1070 76 / 1070 column count          (may not match #linked columns, AutoCAD OK with that)
1070 78 / 1070 flow reversed
1070 48 / 1040 column width
1070 49 / 1040 gutter
[1070 50 / 1070 n / n × 1040 heights]   (dynamic manual height only; last height 0)
1000 ACAD_MTEXT_COLUMN_INFO_END
1000 ACAD_MTEXT_COLUMNS_BEGIN / 1070 47 / 1070 count incl. this one / (count−1) × 1005 handle / …_END
1000 ACAD_MTEXT_DEFINED_HEIGHT_BEGIN / 1070 46 / 1040 height / …_END   (not for dynamic manual)
```
Linked column MTEXTs: own text content, own insert (shifted by width+gutter along 11), **41 holds the
total width** (wrong for rendering → use the master's column width), XDATA only the defined height; no
back link; they are normal entities in the layout between other entities (ezdxf unlinks them from the
layout). Each linked column is a self-sufficient MTEXT, so a naive renderer that draws every MTEXT
renders pre-R2018 columns correctly *except* for wrapping width (must use 48 from the master).

R2018: one MTEXT with all text; the column split must be computed by the renderer. After the normal
codes: `101 Embedded Object`, then
`70` attachment point ("AutoCAD reads the attachment point from the embedded object, not from the
MTEXT group code 71", ezdxf mtext.py export_embedded_object), `10` text direction, `11` insert, `40`
reference width, `41` defined column height, `42` total width, `43` total height (max column),
`71` column type, `72` column height count (0 for dynamic auto height!), `44` column width, `45`
gutter, `73` auto height, `74` flow reversed, n × `46` column heights. "No columns" R2018: no embedded
object, but 46 in AcDbMText. ODA 20.4.46 lists the same fields (+ "Is NOT annotative" bit).
Column count for dynamic-auto = round((total_width + gutter) / (width + gutter)) (ezdxf).
Exact column breaking = exact AutoCAD layout (line heights) → any drift in line spacing changes
which lines land in which column.

#### 3.7.1 Column layout, text frame and mask — VERIFIED-BY-ACAD (2026-10-01)

Cases: `user/columns-all`, `user/text-frame2`, `text-frame4`, `text-frame-annotated` (user drawings) and the
local probes `text-probes/mtx-*` (PDF geometry measured relative to a cross at the insertion point).

- **Column breaking**: a line moves to the next column when its extents bottom (baseline + its
  descenders) passes the column height — "pp" lines (descender 1.13 at h 4) with baseline 10.67 break at
  height 11 but not 12; "ac" lines break at 10.5 but not 11 (`mtx-break-*`). The new column restarts at
  the top (first baseline = the line's ascent). The first line always stays in column 1.
- **Static** (type 1): exactly `count` columns, all of them exist even when empty; the last column takes
  all overflow (it grows past the column height) and extra `\N` there act as paragraph breaks
  (`columns-all` "Hello…" text: column 3 holds 6 lines; `mtx-static-extra-breaks`).
- **Dynamic, auto height** (type 2, 73 = 1): as many columns of the defined height (embedded 41) as the text
  needs; AutoCAD rewrites 72 and 41/42 to the new count on load (60 words → 10 columns although 72 = 0,
  42 = 3 columns were stored, `mtx-cols-dynauto-*`; with inconsistent stored data AutoCAD even moved the
  insertion point of an MC text — not modelled).
- **Dynamic, manual heights** (73 = 0, 46 per column): one column per stored height (0 = unlimited);
  overflow goes to **one extra column** of unlimited height (AutoCAD appends `46 0.0`,
  `mtx-cols-dynman-overflow`).
- **Vertical attachment per column**: every column is aligned on its **own content height** (extents
  top = first line's ascent, bottom = its last line's descenders): top rows at the insertion point, middle
  rows centred on it, bottom rows ending on it — `columns-all`: the BR text's column 3 (6 lines) grows
  upward past the stored height, column 2 sits higher by its "jgf" descenders; `mtx-cols-static-mc/bl/tr`.
  Stored column heights and group 46 never move the text (single column too: §12, `mtx-defh-mc-col1`).
- **Horizontal attachment**: relative to all columns, n·width + (n−1)·gutter (n = the actual count);
  single column: the reference width 41 (or the content width when 41 = 0). Lines align inside their
  column; a line wider than the column spills (right-aligned text to the left, `mtx-cols-mc-spill`).
- **Frame (90 & 16) and mask (90 & 3) box** — one box per column:
  x = the column [0, width] (single column: [0, 41], or the content when 41 = 0) **widened to the ink** of
  its lines (`text-frame2`: 41 = 931 < text 1024 → box [0, 1024]; `text-frame4`, `mtx-wide-mr`: MR text
  wider than 41 → box [−42, 0], text right-aligned at the insertion point);
  height = **max(stored column height, content height)** — static/auto: embedded 41, manual: that column's
  46, no columns: AcDbMText 46 (`mtx-defh-tl-frame`: 46 = 40 → 40-high frame, text unmoved), else the
  content (= 43 for one column); placed like the column's text (top / centred / bottom at the insertion
  point); all sides grown by **(45 − 1)·h** — also for the frame-only flag 16 (`text-frame2`: 45 = 1.0 →
  frame on the extents box; `text-frame-annotated` 45 = 1.5 → 0.5·h; `mtx-w0-mr-frame125` 1.25 → 0.25·h);
  45 absent → 1.5 (`mtx-frame-noscale`). The ezdxf claim "frame-only scale fixed 1.5" is wrong.
- The **frame** is the outline of the **union** of the column boxes: touching boxes merge into one
  stepped polygon (`columns-all` "WAhh" text: gutter 0, offset 1 → one 8-segment outline;
  `mtx-cols-static-inkwide`: a spilling word joins two columns into one rectangle); separated columns get
  separate rectangles (`mtx-cols-static-*-frame`, gutter 8 > 2·offset). The mask fills the same boxes.
- A trailing `\P` adds no empty line to the frame (`mtx-trailing-p-mc/bl`).

## 4. Fonts

**Provenance of the VERIFIED-BY-ACAD font facts in this section:** measured with **AutoCAD 2027**
(`C:\Program Files\Autodesk\AutoCAD 2027`, ACADVER 26.0) on the research machine, running
`accoreconsole.exe` headless with AutoLISP (`entmake` STYLE/TEXT at h = 10, read back with
`(textbox …)`). These are TEXTBOX/core-console results, **not PLOT output**. The probe scripts and
raw outputs (`probe.lsp`, `mkscr.py`, `acad_out*.txt`) were temporary and are not in the repo — the
numbers that matter are repeated here. Where these contradict older conclusions they win.

### 4.1 STYLE table and font selection

STYLE (spec p.46): 2 name, 70 flags (1 = shape file entry, 4 = vertical text, 16/32/64 xref/ref),
40 fixed height (0 = not fixed; only a creation default — entity 40 rules), 41 width factor, 50 oblique,
71 generation flags (2 backward, 4 upside down) — all creation defaults, **the entity's own 41/51/71
are rendered** (VERIFIED-BY-ACAD: `entmake` TEXT without 41/51 ignored the style's values) — **except
MTEXT**, where style 41/50 are the initial `\W`/`\Q` (ezdxf#1351, VERIFIED TrueView 2020), 42 last
height, **3 primary font file**, **4 bigfont file**, XDATA `ACAD` 1000 family / 1071 flags.
ODA 20.4.56 also describes the XDATA (its "1001 Font file name" line is really the AppID `ACAD`).
Flag-1 entries (unnamed, e.g. `ltypeshp.shx`, `qcadshp.shx`) are shape files for SHAPE entities and
complex linetypes (realdwg-web PR #111/#112); SHAPE looks shapes up **by name**, AutoCAD also finds the
.shx next to the drawing (cad-viewer#113).

**1071 bit layout** (Windows LOGFONT-derived): bits 0–7 pitch-and-family (pitch 0 default, 1 fixed,
2 variable; family 0 dontcare, 16 roman, 32 swiss, 48 modern, 64 script, 80 decorative), bits 8–15
charset (0 ANSI, 1 default, 2 symbol, 128 Shift-JIS, 134 GB2312, 238 EastEurope, 255 OEM), bit 24
**italic**, bit 25 **bold** (ezdxf textstyle.py:93: ITALIC = 1<<24, BOLD = 1<<25; samples Arial 34 =
0x22, italic 16777250, bold 33554466, bold+italic 50331682; SimSun 34306 = 0x8602). ezdxf once had
bold/italic swapped (CHANGELOG). **CONFLICT**: ACadSharp models 1071 as {Italic = 1, Bold = 2} — wrong.
The same fields appear in `\fArial|b0|i0|c238|p34;`.

**Resolution precedence — VERIFIED-BY-ACAD (AutoCAD 2027):**
1. A non-empty XDATA family **wins over group 3**, even if group 3 is an SHX (group 3 `times.ttf` +
   XDATA Arial → Arial; `romans.shx` + XDATA Arial → Arial). The bold/italic bits select the real
   Bold/Italic face (XDATA Arial + bold renders exactly like `arialbd.ttf`).
2. Empty group 3 + XDATA family → resolved via Windows by family.
3. Group 3: case-insensitive; extension optional (`arial` → arial.ttf, `txt` → txt.shx); `.ttc` works
   (`simsun.ttc`; but TrueView could not render .ttc per ezdxf#733 — older version); a **full path
   (`C:\Windows\Fonts\arial.ttf`) did NOT resolve** (fell back to FONTALT); quoted names work
   (netDxf#224). Real files contain absolute paths (`c:\program files\autocad 2002\fonts\hztxt.shx`)
   — strip to the base name for our lookup? (AutoCAD 2027 would fall back — follow AutoCAD.)
   An **SHX** full path resolves by its base name: `C:\nope\txt.shx` draws exactly like txt.shx
   (acad-default-fonts/font-name-txt-path, VERIFIED-BY-ACAD 2026-10-01). Only TrueType paths fall
   back to FONTALT.
4. Unresolved → **FONTALT** (default `simplex.shx`): missing SHX, missing TTF, unknown XDATA family, and
   empty group 3 without XDATA all rendered exactly like simplex.shx ("A" width 7.61905 = 16/21·10).
   **CONFLICT**: Autodesk "About Substitute Fonts" says for TTF "Windows substitutes a similar font"; the
   core console used FONTALT. The GUI asks "Missing SHX files" (ignore → FONTALT, libdxfrw#76,
   Autodesk forum). AutoCAD 2026.1 reports fonts it can't find as txt.shx (cad-viewer#246 — probably the
   user's FONTALT). **ASSUMPTION** for truedxf: configurable FONTALT, default simplex.shx.
5. **Missing big font → the whole TEXT renders nothing** (zero TEXTBOX even for "A") in the core
   console; a bigfont next to a TTF primary font is ignored. Autodesk: big font substitution uses FONTALT
   ",bigname" / the pair txt.shx,bigfont.shx. **UNKNOWN** for PLOT.
6. **FONTMAP** file `acad.fmp` (lines `original;substitute`, e.g. `romanc.shx;times.ttf`) is applied
   first. AutoCAD 2027's shipped acad.fmp maps only 16 old PostScript short names to Bitstream TTFs
   (`cibt;CITYB___.TTF`, `rom;ROMANTIC.TTF`, `te;TECHNIC_.TTF`, …) — no SHX→TTF mappings by default.
7. Style name missing from the table → ezdxf/others fall back to Standard (netDxf#450) — AutoCAD
   AUDIT would fix; ASSUMPTION: render with Standard. A DXF without STYLE table won't open in AutoCAD
   (ezdxf#744).

**ezdxf has three different precedence rules** (textstyle.py:213 `make_font`: XDATA family if present,
empty family → DejaVuSans bug; fonts.py:708 `get_entity_font_face`: family else group 3 = AutoCAD;
drawing add-on properties.py:527: group 3 first, XDATA only if group 3 empty = **wrong**).

Font search paths in AutoCAD: SHX via the support file search path (user support, `…\support`,
`…\fonts`, …); TTF must be installed Windows fonts (fonts in the per-user font folder *were* found by
AutoCAD 2027, contradicting ezdxf#865 / ezdxf font_manager.py:25 for older versions; fonts registered
mid-session were not found — AutoCAD enumerates the session's GDI fonts, hypothesis). TrueView
translates macOS names (`Arial Black.ttf` → `ariblk.ttf`, `Comic Sans MS.ttf` → `comic.ttf`), BricsCAD
doesn't (ezdxf#1002 → ezdxf `font_synonyms.py`).

**Default Standard style**: AutoCAD 2027 `acad.dwt`/`acadiso.dwt` → `arial.ttf` + XDATA `ACAD Arial 34`
(VERIFIED-BY-ACAD); older drawings, ezdxf, libdxfrw → `txt` (ezdxf `DEFAULT_TEXT_FONT = "txt"`). Group 3
values in the local corpus (5,578 files): txt 4489, ltypeshp.shx 1006, standard 991, qcadshp.shx 902,
"" 604, arial.ttf 574, romans.shx 131, simplex.shx 124, simplex 79, txt.shx 56, isocp.shx 51,
simhei.ttf 30 …; bigfonts gbcbig 83, hztxt 55, bigfont.shx 11, @extfont2.shx 8, chineset.shx 2.
("standard" is a QCAD/LibreCAD font name, not an AutoCAD font.)

truedxf: `TextRenderOptions.missingFont` is `"autocad"` (the rules above; plot emulation) or
`"fallback"` (viewers, the default in smooth mode: always draw, using `fallbackFont` /
`fallbackBigFont`). In both modes PlotResult gets `font-missing` / `bigfont-missing` notes.

### 4.2 SHX / SHP shape fonts — binary format

Sources: ezdxf `src/ezdxf/fonts/shapefile.py` (MIT, "EZ"), its tests
`tests/test_05_tools/test_533_shapefiles.py` ("EZT"), mlightcad `@mlightcad/shx-parser` 1.4.5 (MIT, "ML",
github.com/mlightcad/shx-parser), tatarize/shxparser (Python, MIT, "TZ"), YFonts.SHX (C#, **no licence**
— facts only), OsgShxText (C++, no licence), Kharabadze/SHX_font_converter (Unlicense, "KH"), netDxf
`Tables/ShapeStyle.cs`, Autodesk AutoCAD Customization Guide 2025 ("ADSK": "Shape Descriptions",
"Special Codes Reference", "Text Font Descriptions", "Unicode Font Descriptions", "Big Font
Descriptions", "Extended Big Font"). Autodesk does **not** document the compiled .shx layout; the layout
below is the consensus of all reverse-engineered readers, cross-checked against real files
(`ezdxf/examples/ltypeshp.shx`, `ezdxf/fonts/strokefonts/*.shx`, `ACadSharp/samples/test_shape.shx`).

**Header**: ASCII signature + `0D 0A 1A`:

| Signature | Bytes | 0x1A at |
|---|---|---|
| `AutoCAD-86 shapes 1.0` | 21 | 0x17 |
| `AutoCAD-86 shapes 1.1` | 21 | 0x17 (same layout as 1.0 as far as anyone knows — UNKNOWN what changed) |
| `AutoCAD-86 unifont 1.0` | 22 | 0x18 |
| `AutoCAD-86 bigfont 1.0` | 22 | 0x18 |

All multi-byte header/index fields are **little-endian**. KH also accepts a broken "shapes 1.0\n"
(LF only). netDxf accepts only "shapes 1.0".

**shapes 1.0/1.1** (normal fonts and plain shape files):
```
u16 first_number, u16 last_number, u16 count (incl. shape 0)
count × { u16 shape_number, u16 record_length }
records in index order: name bytes, 0x00, bytecode ... 0x00
"EOF"
```
`record_length = defbytes + strlen(name) + 1` (verified with ACadSharp test_shape: 363 = 354 + 8 + 1).
Shape 0 = font info: `name\0 above below modes 0` (e.g. ISO.shx: above 18, below 6, modes 2). No shape 0
→ plain shape file (for SHAPE entities / complex linetypes). Font glyph names are lowercase or empty;
shape-file names are uppercase (used by SHAPE entities and linetypes to find shapes **by name**).

**unifont 1.0** (Unicode):
```
u32 count (= glyph records + 1)          (ezdxf reads u16 count + u16 0)
u16 def_length, def_length bytes: name\0 above below modes encoding embed 0
(count−1) × { u16 shape_number (= Unicode code point), u16 record_length, record bytes: name\0 bytecode }
(no index table, no EOF trailer)
```
iso3098.shx: count 319, def `iso3098\0 20 00 02 00 00 00` (above 32, below 0, modes 2); isocp fixture:
above 40, below 12. modes 0 = horizontal only, 2 = dual orientation (vertical capable); encoding 0 =
Unicode, 1 = packed multibyte, 2 = shape file; embed 0/1/2 = embeddable / not / read-only.

**bigfont 1.0** (DBCS / CJK):
```
u16 unknown (skipped by everyone), u16 index_count, u16 nranges
nranges × { u16 start, u16 end }          (lead-byte "escape" ranges, e.g. 0x81..0xFE)
index_count × { u16 shape_number, u16 length, u32 absolute_offset }   (all-zero entries = padding)
```
**CONFLICT**: TZ treats the first u16 as the count; YF/ML/OSG/KH use the second (majority).
Shape number = lead_byte·256 + trail_byte stored as normal LE u16 (the apparent byte-swap in YF/KH is
self-consistent). Glyph record "name" is the raw 2-byte DBCS code (big-endian) optionally + 00 (ML).
Shape 0 variants: normal `name\0 above below modes 0`; **extended big font**
`name\0 char_height 0 modes char_width 0` (ADSK sample `*0,5,Extended Font` `15,0,2,15,0`); gbcbig.shx
has a 3-byte tail (above, modes, 0) (ML heuristics). Text lookup: bytes in an escape range + next byte
form the code; "the program searches the Big Font file first. If the character is not found there,
the normal font file is searched" (ADSK). ezdxf has **no** bigfont support.

**SHP source** (for completeness): `*shapeno,defbytes,name` then comma-separated bytes; numbers with a
leading 0 are hex (`020AC`), parentheses cosmetic, `;` comments, ≤ 2000 bytes/shape; `*UNIFONT,6,name`
header line with `above,below,modes,encoding,type,0`; `*BIGFONT nchars,nranges,b1,e1,…`.
Negative *octant-style* values like `-044` compile to **sign-magnitude** bytes (0x80 | 0x44 = 0xC4,
verified in ltypeshp.shx), whereas signed displacements (codes 8, 9, 12, 13) are **two's complement**
(`-11` → 0xF5, verified in ACadSharp test_shape).

### 4.3 Shape bytecode

Bytes ≥ 0x10 are **vectors**: high nibble = length 1..15, low nibble = direction 0..15. Directions are
*not* unit-circle angles ("Diagonal vectors stretch to match the X or Y displacement of the closest
orthogonal vector", ADSK):

| dir | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | A | B | C | D | E | F |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dx | 1 | 1 | 1 | .5 | 0 | −.5 | −1 | −1 | −1 | −1 | −1 | −.5 | 0 | .5 | 1 | 1 |
| dy | 0 | .5 | 1 | 1 | 1 | 1 | 1 | .5 | 0 | −.5 | −1 | −1 | −1 | −1 | −1 | −.5 |

Displacement = (dx·L, dy·L) × current scale. (Identical in EZ:636, ML, YF, TZ.)

| Code | Params | Semantics |
|---|---|---|
| 0 | – | end of shape |
| 1 | – | pen down ("Draw is activated at the start of each shape") |
| 2 | – | pen up |
| 3 | u8 n | scale /= n (cumulative within a shape; "The program does not reset the scale factor for you") |
| 4 | u8 n | scale ×= n. **UNKNOWN**: persists across characters? (EZ GlyphCache renders each glyph fresh) |
| 5 / 6 | – | push / pop position; stack **4 deep**, "You must pop everything you push"; errors "Position stack overflow/underflow in shape nnn". Pop moves without drawing. |
| 7 | shapes: u8 shape#; **unifont: 2-byte shape#**; bigfont: u8, or `0` + extended form `7,0,prim#(2 bytes),basex,basey,width,height` (primitive scaled to a unit square then × width/height) | draw subshape at current point with current scale; "Draw mode is not reset for the new shape" — **contradicted, VERIFIED-BY-ACAD (triage 2026-10-01, implemented in shx/interpret.ts):** a subshape starts with the pen down even if the caller lifted it (amgdt `f`/`n` draw the first stroke of subshape 3; ezdxf's forced pen-down matches); scale and position carry over (acad-default-fonts sample-amgdt / special-amgdt / subshape-code7 / tolerance-* improved). **CONFLICT** unifont code-7 byte order: EZ/YF/TZ/OSG little-endian, ML big-endian (every other 2-byte bytecode value is high-byte-first → BE more plausible; verify with amgdt.shx) |
| 8 | i8 dx, i8 dy | single displacement (−128..127) × scale, draws if pen down |
| 9 | (i8,i8)… (0,0) | multiple displacements; (0,0) terminates |
| 0xA | u8 r, octant byte | octant arc: bit7 = clockwise, bits 4-6 start octant S (0..7, 45° steps CCW from 3 o'clock), bits 0-2 count C (0 = full circle). centre = P − r·(cos 45S, sin 45S); end angle = 45S ± 45C |
| 0xB | u8 so, u8 eo, u8 hr, u8 r, octant byte | fractional arc, formula below |
| 0xC | i8 dx, i8 dy, i8 bulge | arc to P+(dx,dy); bulge b/127 = DXF bulge ("((2*H/D)*127)", ±127 = semicircle, 0 = line, negative = CW); −128 clamped to −127 |
| 0xD | (dx,dy,bulge)… (0,0) | multiple bulge arcs; the (0,0) terminator has **no** bulge byte |
| 0xE | – | next command only for vertical text (honoured only if font modes = 2); in horizontal text skip the **whole** next command incl. parameters (9/13 lists up to (0,0), code-7 params). Idiom: `2,14,8,(-2,-6),…,14,8,(-4,-3),0` |
| 0xF | – | undefined → no-op |

Fractional arc (ADSK "11,start_offset,end_offset,high_radius,radius,(-)0SC"; offsets in 45°/256
units; example `11,(56,28,0,3,012)` = 55°→95°, r = 3):
```
R = hr*256 + r;  S = (spec>>4)&7;  C = spec&7 (0 → 8);  ccw = !(spec & 0x80)
ccw: a0 = 45S + so*45/256;  a1 = 45(S+C−1) + (eo==0 ? 256 : eo)*45/256
cw:  a0 = 45S − so*45/256;  a1 = 45(S−C+1) − (eo==0 ? 256 : eo)*45/256
centre = P − R·scale·(cos a0, sin a0); end = centre + R·scale·(cos a1, sin a1)
```
**CONFLICT**: ML/YF use `hr*255` (bug; ADSK: "most significant eight bits" → ×256). KH's variant is
wrong (asymmetric "C").

**Rounding hypothesis (important for pixel matching)**: ezdxf's float rendering of fractional arcs
drifts off the integer design grid (EZT: "9" ends at (28.1444, 0.0209), "&" at (36.0313, −0.1846);
EZ has a baseline-snap hack). Re-simulating with the pen position **rounded to integer shape units after
every arc** gives exactly (28,0) and (36,0) — strongly suggests AutoCAD keeps the pen on an integer grid
(AutoCAD-86 integer arithmetic). **UNKNOWN**: after arcs only or after all commands, before or after the
3/4 scale, and whether the drawn arc geometry is adjusted. Test #1 for SHX fidelity.

Arc tessellation in PLOT: **UNKNOWN** (EZ uses Béziers, YF 10° steps). Probably depends on plot
resolution / VIEWRES — measure. SHAPE plots (acad-default-fonts/shape-size-25, CIRC1/BAT) show visibly faceted SHX arcs; our finer
flattening is the remaining ~3.5 % gap.

### 4.4 SHX metrics → text height, advance, missing glyphs

- **Scale = text height / above** (cap height = text height). ADSK: above = "the number of vector lengths
  above the baseline that the uppercase letters extend"; above/below "are used as scale factors for the
  height specified for the text object". Same in EZ (`GlyphCache`: cap_height / font.above, fallback
  measured "A"), YF, TZ, OSG. **CONFLICT**: mlightcad uses `size / (above + below)` (bug).
  Confirmed by the AutoCAD-computed alignment points: TOP = h, MC = h/2 for txt/simplex/romans/
  architxt/archtitl/italic/romand (see 1.4).
- **Bottom (TEXT 73=1)** = baseline − h·below/above: txt 2/6, simplex/romans/architxt/archtitl 1/3
  (VERIFIED-BY-ACAD data in 1.4).
- **Advance** = pen x at the end of the glyph (usually a final pen-up move); no advance field
  (EZ:1003). mlightcad's default (ink + 0.2 cell) is a heuristic, not AutoCAD. The y at the end of a
  glyph: EZ ignores it; AutoCAD — **UNKNOWN**.
- **Horizontal alignment width for SHX**: BricsCAD data (txt "CENTER" = 6 × 6 units − 2 = 34 units)
  suggests the trailing pen-up gap of the last glyph is *not* counted (ink right edge);
  AutoCAD data (simplex "x": 72=4 half-width = 5.5/21 h, MTEXT 42 of "x" = 11/21 h) is consistent
  with ink extents. AutoCAD 2027 TEXTBOX (§4.6): txt "A" box 0..6.6667 (ink, 4 units) but advance 10
  (6 units); simplex "A" width 7.619, advance ≈ 9.524 — so TEXTBOX is ink-based for SHX. **UNKNOWN**
  whether TEXT Center/Right use the ink box or the advance — test "A" vs "AA" with 72 = 2 in AutoCAD.
- **Space** = shape 32's advance (EZ fallback: width of "A"). Shape 10 (LF) is required by ADSK.
- **Missing glyph**: AutoCAD draws "?" (forum consensus: AUGI t-4700, CADTutor 37420; mlightcad #473 —
  a GBK bigfont returned "?" for U+2205). Probably the font's own shape 63. ezdxf draws a tofu box
  (mismatch).
- **Encoding**: unifont shape numbers = Unicode; non-Unicode "shapes" fonts are indexed by code-page
  bytes (which code page: $DWGCODEPAGE? — UNKNOWN); bigfonts by DBCS code.
- **%%d %%p %%c** in non-Unicode fonts use shape numbers **256, 257, 258** ("Non-Unicode font files use
  the shape numbers 256, 257, and 258 for the symbolic identifiers Degree_Sign, Plus_Or_Minus_Sign, and
  Diameter_Symbol", ADSK Text Font Descriptions). Unicode fonts: U+00B0, U+00B1, **U+2205**
  (Autodesk "Text Symbols and Special Characters Reference" table; mlightcad #473: AutoCAD dimension
  text uses U+2205, amgdt.shx has the glyph at 0x2205) — but for TTF AutoCAD 2027 maps `%%c` to
  U+00D8 (§4.5), so the Unicode-SHX choice is **UNKNOWN**. mlightcad tries SHX codes 129/126 — no source
  found for those; "127 = degree" also not confirmed.
- **Vertical text**: needs font modes = 2 **and** STYLE flag 4; code 14 commands then execute.
  EZ/YF/OSG render horizontally only.
- **Rendering**: SHX glyphs are open polylines (pen-down runs) — each run is its own polyline (mlightcad
  PR #643: chaining runs drew spurious connectors). PLOT draws them with the entity's lineweight; they
  are never filled. Bold/italic do not exist for SHX (oblique via style/\Q only).
- **Bigfont height relative to main font** (different "above"): **UNKNOWN** (OSG scales each by its own
  above).

**Bigfont code page — VERIFIED-BY-ACAD 2026-10-01** (acad-default-fonts/bigfont-txt-*-r2018,
bigfont-native-ansi-932/950, mif-*, font-probes/bigcp-text, bigcp-mtext, bigcp-dwg936-r2004/r2018).
AutoCAD 2027 keeps text as Unicode. For a style with a bigfont, each character is encoded into
**the bigfont's own DBCS code page**:
- Code pages: bigfont.shx, extfont.shx and extfont2.shx are Shift-JIS; chineset.shx is Big5;
  gbcbig.shx is GBK; whgtxt.shx is KS X 1001.
- If the bigfont has that code, its glyph is drawn. Otherwise the character is drawn from the
  primary font by Unicode, as "?" in TEXT or the TTF fallback in MTEXT.
- `$DWGCODEPAGE` has no influence: ANSI_936 in R2004 and in R2018 gave pixel-identical plots to
  ANSI_1252.
- The code page is fixed per font; AutoCAD does not try code pages in turn. With chineset, あ
  draws "?" although GBK 0xA4A2 exists in chineset; with whgtxt, 日 draws "?"; with gbcbig, 한
  draws "?".
- Single bytes count too: the bigfont's space (bigfont.shx and extfont.shx: 9/15 h) replaces the
  primary font's, in TEXT and MTEXT. Half-width katakana U+FF71 comes from bigfont.shx shape 0xB1.
- special.shx pairs the escape byte `~` with the next ASCII character: `~1` is 1/16, `~2` is 1/8.
- A compiled bigfont does not name its code page. truedxf uses a base-name table, and for unknown
  fonts Shift-JIS when the escape ranges lie in 0x81–0x9F without 0xA1–0xDF, otherwise the
  drawing's code page if that is DBCS, else GBK (ASSUMPTION).

### 4.5 TrueType rendering rules (VERIFIED-BY-ACAD unless noted)

Implementation check (2026-10-02, unit tests + corpus/fixture fingerprints): truedxf uses
opentype.js `lowMemory: true`, which defers glyph materialization. Eager/lazy parsing agrees for
cmap indices, outlines, hmtx advances, cap-height/other metrics, GSUB tables and kerning pairs
in `packages/fonts/test/ttf-lazy.test.ts`; every plot/viewer fingerprint is unchanged. Our font
and text packages use cmap lookup and explicit glyph outlines/advances, with no GSUB shaping
or kerning calls. Font initialization improved 2.6–5.5× in the local constructor benchmark;
glyph work is deferred. See [parser performance results](../../docs/perf-parser-results.md).

- **Scale = height / yMax(glyph "A")** in font units, baseline at font y = 0. Not OS/2 sCapHeight,
  not ascender, not em. Verified to 4–6 digits for Arial (A 1466, sCap 1467), **Times (A.yMax 1387 vs
  capHeight 1356 — decisive: "H" top measured 9.7765 = 1356/1387·10)**, Calibri (1300 vs 1294, no
  baseline shift), Segoe UI, ISOCPEUR (1320: x = 0.7, p = −0.3 exactly), simplex_.ttf, txt_____.ttf,
  JetBrainsMono; SimSun is A-based too. Arial "x" top 7.2442 = 1062/1466·10, "p" −2.7763. Same rule in
  qcad (`RTextRenderer.cpp:1860`, 'A'), mlightcad (`upm / yMax('A')`), ezdxf#865 ("A", "almost pixel
  perfect" vs BricsCAD/TrueView), upFront.eZine #1106. **CONFLICT**: Autodesk help "text height
  represents the height of a capital letter plus an ascent area" — contradicted by measurement.
  ezdxf `ttfonts.py:96-113` takes the baseline from the bottom of "x" → wrong for fonts whose "x"
  overshoots (Calibri: ezdxf cap 1306 + 6-unit shift vs AutoCAD 1300, ≈ 0.46 % error).
  Font without "A": **UNKNOWN**.
- **Advance** = hmtx advance × scale; **no kerning** (Arial "AV" = 18.5266 no-kern value; kern pair
  −152 exists) (also ezdxf#865 for BricsCAD/TrueView). Space advance included.
- **Width factor** scales x of glyphs and advances; **oblique** = shear about the baseline x' = x +
  y·tan θ ("A" at 15°: 9.33834 + 10·tan 15° = 12.0178). Order vs width factor for TEXT still UNKNOWN
  (both tested separately).
- **TEXTBOX quirk**: for TTF strings entirely above the baseline TEXTBOX reports the box shifted to
  y = 0 (degree sign 6.21..10 reported 0..3.786) — beware when using TEXTBOX as an oracle; SHX boxes are
  not shifted.
- **Bold/italic**: real faces via XDATA bits / `\f|b1|i1`; synthetic emboldening/slanting for families
  lacking faces: UNKNOWN (mlightcad fakes bold ×1.06 scale and italic 15° — not AutoCAD).
- **Missing glyphs in a TTF** (Arial lacks U+2205, U+4E2D) are drawn from a fallback font **at the
  primary font's scale** (Arial ∅ box 0..10.4775 × 0..8.73; Times ∅ top × A.yMax equal) → Windows font
  linking/fallback; a style bigfont does not help. ezdxf#1211/#1143/#1032/#883: AutoCAD, TrueView and
  BricsCAD "take it from a default Unicode font on the fly"; AutoCAD later rewrites edited MTEXT with
  `{\fSimSun…}`. Which fallback font: **UNKNOWN** (per-script Windows font link table; for pixel
  matching, ship a configurable fallback list).
- **`%%c` with TTF = U+00D8 "Ø"** (Arial box identical to `\U+00D8` and to `%%216`; `\U+2205` gives a
  different glyph from the fallback font). ⇒ ezdxf's `%%c → Ø` is right for TEXT; the Autodesk table's
  "%%c = U+2205" is only nominal; dimension-generated diameter symbols use a literal U+2205
  (cad-viewer#473). `%%d`, `%%p`, `%%%` work. txt.shx: `%%c`, U+2205 and U+00D8 all gave the same
  6.667 × 10 box (glyph identity unknown; non-Unicode SHX use shape 258 per ADSK).
- **PLOT variables**: TEXTFILL (1 = filled [default], 0 = outlines; registry/sysvar, not in DXF),
  TEXTQLTY (0–100, default 50, tessellation of TTF outlines when plotting; in DWG header, not DXF;
  mapping to segment counts UNKNOWN), `$QTEXTMODE` (DXF header: "Quick Text mode on if nonzero" →
  text drawn as rectangles — should truedxf honour it for PLOT? UNKNOWN). "TrueType fonts do not take
  lineweight settings" (Autodesk KB title): TTF fills ignore lineweight, SHX strokes use it.
- AutoCAD's PDF export embeds TTFs (text selectable); a native-PDF-text experiment needed a 1.375 size
  factor (ezdxf#582/#1158) — irrelevant for raster PLOT.
- OpenType (.otf): ezdxf says "AutoCAD/BricsCAD do not support OpenType fonts!" — UNKNOWN (probe
  invalid).
- CJK TTF: cap/em ratios differ strongly (KaiTi, SimHei ≈ 1.45× vs em-based; ezdxf#733/#705) — the "A"
  rule is what matters.

### 4.6 Fonts shipped with AutoCAD and their proportions

AutoCAD 2027 `Fonts` folder (79 files): SHX txt, simplex, romans, romand, romanc, romant, italic,
italicc, italict, complex, monotxt, scripts, scriptc, gothice/g/i, greekc, greeks, isocp, isocp2,
isocp3, isoct, isoct2, isoct3, gdt, amgdt, amgdtans, syastro, symap, symath, symeteo, symusic,
ltypeshp; bigfonts bigfont, chineset, extfont, extfont2, @extfont2, exthalf2, extslim2, gbcbig,
whgdtxt, whgtxt, whtgtxt, whtmtxt, aehalf; gbenor, gbeitc; others (GENISO, AcadEref, AMDTSymbols,
ISO, SIMPLEX8, bold, …); sas_____.pfb.

Autodesk TTF look-alikes installed in `C:\Windows\Fonts` (Autodesk copyright; ratios to A.yMax):

| TTF | for | A.yMax (upm 2048) | x/A | desc/A |
|---|---|---|---|---|
| txt_____.ttf, monotxt_.ttf | txt, monotxt | 1475 | 0.675 | 0.332 |
| simplex_.ttf, romans__.ttf | simplex, romans | 1522 | 0.666 | 0.328 |
| complex_, romanc__, romand__, romant__, italic__, italicc_, italict_ | same-name SHX | 1538 | 0.674 | 0.326 |
| isocp___/isocp2__/isocp3__ | isocp* | 1327 | 0.673 | 0.333 |
| isoct___/… | isoct* | 1474 | – | – |
| isocpeur/isocpeui/isocteur/isocteui | ISO 3098 (no SHX) | 1320 | 0.700 | 0.300 |
| gdt_____, AMGDT___ | gdt, amgdt | 1522 | – | – |

Measured SHX at h = 10 (VERIFIED-BY-ACAD): txt "A" 0..6.6667 × 0..10, x-height 6.6667, descender
−3.3333, "A" advance 10; simplex "A" width 7.61905, advance ≈ 9.5238 (**wrong**: 22 units = 10.476, §10); romans "A" 0.476..8.095; isocp
"A" 1.5..7.5 × 0.5..9.5 (glyphs inset 0.5 — pen-width compensation). ezdxf's hard-coded SHX guesses
`DESCENDER_FACTOR = 0.333`, `X_HEIGHT_FACTOR = 0.666` (fonts.py:79, "just guessing") equal txt exactly.

**The TTF look-alikes are not metric clones of the SHX** (simplex_ A.yMax ratios, stroke vs fill);
ezdxf renders SHX via these TTFs by default (ezdxf#333: "TXT" was really romans__.ttf) — visually wrong
for PLOT matching. ezdxf's `SHX_FONTS` table also has wrong file names (`isocp.ttf` → real
`isocp___.ttf`, `greekc.ttf` → `greekc__.ttf`, `italicc_.ttf` for italic.shx → `italic__.ttf`) and misses
romanc/romand/romant/greeks/gothice/…/monotxt/gdt/isoct*.

Vertical text: SHX + (big font) + STYLE flag 4; `@`-prefixed TTF families are Windows vertical Asian
fonts (ADSK "About Vertical Text").

### 4.7 Open / free replacement fonts (licences)

- **ezdxf/fonts/strokefonts/**: real SHX unifonts with .shp sources — iso3098.shx (based on the
  public-domain Wikimedia ISO3098.svg), kst32b.shx (freeware, `LICENSE_KST32B_v2.txt`), azomix.shx /
  azomix_i.shx (licence "?"), from domisan.sakura.ne.jp. Useful as SHX test fixtures.
- **qcad `fonts/*.cxf`**: "Other CXF fonts in directory 'fonts' are released as public domain"
  (qcad/LICENSE.txt:8-20) except Hershey-derived ones (Hershey terms: attribution) and osifont (GPLv3 +
  font exception). Files: Standard, NormalLatin2, CourierCad, Cursive, SansND/NS, RomanS/S2/C/CS/D/P/T,
  ItalicC/CS/T, ScriptC/S, GreekC/CS/P/S, Gothic*, Cyrillic_II, Kochi*, Unicode, SymbolCad, Symbol_*,
  gdt, ltypeshp, qcadshp. Plus osifont.ttf (ISO 3098-like), M+ (free), DejaVu/Vera.
- **LibreCAD `librecad/support/fonts/*.lff`** (47): Hershey "public domain" (romanc, romand, romant,
  scriptc, scripts, …), "public domain + GPL v2+" (romans, simplex, greekc, italicc, …), "GPL v2 or later"
  (standard, iso, iso3098, cursive, …), SIL OFL 1.1 (amiri, lc_opengost-*), several "unknown".
  LibreCAD `standard.lff` "A" is identical to qcad's public-domain `Standard.cxf` "A".
- **TTF**: Liberation Sans 2.1.1 (OFL; metric-compatible advances with Arial but A.yMax 1409 vs 1466 →
  cap-scaled text ≈ 4 % *wider* than Arial — not a drop-in for pixel matching), Liberation Narrow
  (GPLv2 + exception), DejaVu (Bitstream Vera licence), Open Sans, Noto Sans SC (OFL) — all bundled in
  `ezdxf/fonts/`. No OFL ISO 3098 font found.
- For **pixel-exact** output the real Autodesk SHX/TTF files are needed at runtime (user-supplied);
  open fonts are only fallbacks. Hershey-derived LFF/CXF are *not* the SHX glyphs (different stroke
  data), only similar.

### 4.8 LFF and CXF stroke-font formats (for fallback fonts)

LFF ("LibreCAD Font 1"; ezdxf `fonts/lff.py`, LibreCAD `rs_font.cpp:349-528`):
- header lines `# Key: Value`: Format, Creator, Version, Name, Encoding (UTF-8), LetterSpacing,
  WordSpacing, LineSpacingFactor, Created, Last modified, Author, License.
- glyph `[XXXX] c` (4-hex Unicode); optional `CXXXX` include-glyph lines (ezdxf: only one, first line;
  LibreCAD: any number, recursion check); stroke lines `x,y;x,y[,A<bulge>];…` = one polyline, `A<bulge>`
  is the bulge of the segment **ending** at that vertex; missing y = 0 (LibreCAD #2045).
- metrics: cap 9, x-height 6, descender 3 (standard/iso/simplex/romans); advance = glyph max-x +
  LetterSpacing (default 3), space = WordSpacing (default 6.75), LineSpacingFactor 1; scaled by
  height / 9 (LibreCAD) — ezdxf measures cap from "A" (correct for AZO-converted fonts whose "A" spans
  1.25..10).
CXF ("QCAD 3 Font", `qcad/src/core/RFont.cpp:142-335`): same header + `Scale`, `AuxiliaryLines`;
records `L x1,y1,x2,y2`, `A cx,cy,r,a1,a2` (degrees CCW; `AR` reversed), `PL x,y,b,…` (bulge on start
vertex), `PLC` closed; 9-unit cap, scaled 1/9.

### 4.9 Other implementations' font handling

- ezdxf font_manager: scans OS font dirs recursively (+ `support_dirs`), JSON cache
  `~/.cache/ezdxf/font_manager_cache.json`; fallback TTF chain ArialUni → Arial Unicode → Arial →
  DejaVuSansCondensed → DejaVuSans → LiberationSans → OpenSans; `DEFAULT_TTF = DejaVuSans.ttf`;
  SHX resolve order "tsl" (TTF replacement, shapefile, LFF); fallback shape files txt/iso(.shx/.shp),
  LFF standard/iso/simplex (`fallback_lff()` copy-paste bug); `*monospace` measurement font; non-Unicode
  SHX: `ord(char)` used directly as shape number (no code page mapping); no bigfonts.
- LibreCAD: name lower-cased, QCAD-1 suffixes stripped, unknown → "standard"; map arastro→syastro, …,
  normal/normallatin1/2→iso; missing glyph → U+FFFD (diamond).
- qcad: substitutions txt→standard, iso→standard, isocp→standard (configurable `FontSubstitution/`
  ini key); CXF scaled 1/9, TTF by 'A'.
- dxf-viewer: ignores STYLE fonts completely; user-supplied font list, per-glyph first match.
- mlightcad: preset chains (see §6.3), CDN fonts, user `fontMapping`; SVG export maps CAD names to CSS
  stacks with fudge factors (romans 1.05, txt 1.1).

## 5. Character encoding of text content

- **R2007+ (AC1021+) DXF is always UTF-8**, whatever `$DWGCODEPAGE` says (ezdxf#366/#88/PR #107,
  dxf-viewer#72). **≤ R2004**: bytes are in `$DWGCODEPAGE` (ANSI_1252, ANSI_936 …); characters outside
  it are written as `\U+XXXX` (libredwg PRs #1322/#1375, "matching AutoCAD"; m² = byte 0xB2 in cp1252).
  AutoCAD renders bytes > 0x7F in old DXF as raw code-page characters (FreeCAD#8704: 0xB0 → °, UTF-8
  C2 B0 → "Â°", VERIFIED). The reference says $DWGCODEPAGE is "set when a new drawing is created, but not
  otherwise maintained by AutoCAD".
- **Declared code pages lie**: Microstation v8i declares ANSI_936 but writes UTF-8, QGIS declares
  ANSI_949 and writes UTF-8, ACadSharp wrote UTF-8 under any code page (dxf-viewer#135, qgis#67573,
  ACadSharp#1092). AutoCAD decodes with the declared page (→ mojibake). For pixel-matching AutoCAD, decode
  exactly as declared; offer a "fix encoding" option separately. `ANSI_1200` in R2000 made the Autodesk
  viewer reject the file (netDxf#41). Korean: ANSI_949 (not "kcs5601", ACadSharp#1259).
- **`\U+XXXX`**: exactly 4 hex digits (any case), in TEXT, MTEXT, ATTRIB, and even table names
  (ezdxf#782), in all versions incl. R2007+ (libredwg#1414). Decode *inside* the MTEXT tokenizer —
  pre-expanding `\U+005C` would create a fake backslash (dxf-viewer and mlightcad bug).
- **`\M+nXXXX` (MIF)**: n = code page selector, XXXX = the double-byte code (lead·256 + trail) in that
  page (libredwg#428, VERIFIED via AutoCAD PURGE fixing garbling):
  1 = cp932 Shift-JIS, 2 = cp950 Big5, 3 = cp949 Korean, 4 = cp1361 Johab, 5 = cp936 GBK
  (same table in ezdxf `lldxf/encoding.py:55-85` and dxf-viewer; mtext-parser's "1 sjis, 2 big5, else gbk"
  is wrong for 3/4). AutoCAD stores Chinese as MIF when a bigfont is used (cad-viewer#2:
  `\M+1928D:\M+18DD1…`); also appears in table names from Linux ODA builds (ezdxf#932). The DBCS code is
  most likely used directly as the bigfont shape number (ASSUMPTION). libdxfrw has no Johab codec (maps
  to 1252); **ezdxf bug**: Johab uses codec name `cp1391` (doesn't exist in Python; the error is
  swallowed). AutoCAD 2027: a TEXT *created* with literal `\M+182A0` content rendered the characters
  literally (VERIFIED-BY-ACAD, TEXTBOX) — MIF is apparently converted when old files are *loaded*, not at
  display time (**UNKNOWN**; libraries decode at load). Treat MIF decoding as a load-time step for files
  ≤ R2004 (files in the wild contain it in R2007+ too — decode there as well, ASSUMPTION).
- Code page names: ezdxf matches the numeric suffix of `ANSI_xxxx` (default cp1252; 874, 932, 936 →
  gbk, 949, 950, 1250–1258; `tools/codepage.py:57-91`); libredwg DWG enum 30 = ANSI_1252, 38 = 932,
  39 = 936, 40 = 949, 41 = 950, 42 = 1361, 43 = UTF16, 44 = 1258 (`src/codepages.h`). ezdxf decodes
  `\U+` in content only via `recover` (`recover.py:842`), not in the normal loader.
- **Bigfont + ANSI**: for non-Unicode SHX + bigfont, text bytes are looked up raw: bytes in the bigfont
  escape ranges pair up into DBCS codes (§4.2). ACadSharp#432: Chinese TEXT showed "???" in AutoCAD until
  a style with `romans.shx` + bigfont `chineset.shx` was used and/or `$DWGCODEPAGE` = GB2312 (VERIFIED).
  Farsi SHX fonts (NASKH, CHAPI…) use custom glyph maps: the stored bytes are not real Persian code points
  but render correctly in AutoCAD (ezdxf#1271) → SHX lookup must be by **raw code** in the font's table,
  never via Unicode normalisation.
- DWG: R2007+ strings are UTF-16 (TU), older are code-page strings (TV); DWG code-page ids e.g. 30 =
  ANSI_1252, 39 = ANSI_936 (libredwg#238/#655).

## 6. Implementation survey

### 6.1 ezdxf (Python, MIT) — best-informed, but not pixel-exact

- **Parser**: `tools/text.py:MTextParser` — token stream WORD/STACK/SPACE/NBSP/TABULATOR/NEW_PARAGRAPH/
  NEW_COLUMN/WRAP_AT_DIMLINE/PROPERTIES_CHANGED with an immutable `MTextContext` per token
  (stroke flags, aci/rgb, \A align, font face, cap height, width factor, tracking, oblique,
  paragraph props). Scope stack for `{}`. Ported to TS by mlightcad (`@mlightcad/mtext-parser`) — a
  good reference for our own parser (MIT? check licence before reading code; facts are free anyway).
- **Layout**: `tools/text_layout.py` — generic box engine (Layout → Column → Paragraph → lines of cells;
  Text/Fraction content cells, Space/NBSP/Tab glue). Cell height = cap height only ("ascenders and
  descenders are ignored"); line advance = `leading(h) = h × 1.667 × factor`. "individual kerning …
  not supported … the 'distributed' paragraph alignment … can not be supported" (docstring).
- **Renderers**: `addons/drawing/text.py` (TEXT + "simplified" MTEXT: plain text, `text_wrap`, uniform
  height), `addons/drawing/mtext_complex.py` (full layout engine, per-word transforms), `addons/
  text2path.py` (glyph outlines → `Path` objects/HATCH), `addons/mtxpl.py` (MTEXT explode into TEXT+LINE).
  Backends receive `draw_text(text, transform, properties, cap_height)` and do the glyph rendering
  themselves (matplotlib TextPath / Qt / PyMuPDF / SVG), glyph geometry comes from
  `fonts/ttfonts.py` (fontTools) — outlines scaled so that cap height = text height.
- **SHX**: `fonts/shapefile.py` renders SHX/SHP natively (see §4.2–4.4); LFF stroke fonts via `fonts/lff.py`.
- Known inconsistencies (see 1.4 / 3.6 CONFLICTs): 72=4 Middle, MTEXT middle/bottom attachment,
  ink-vs-advance width, stacked fraction size (no 0.7 — relies on explicit \H0.7x), \T ignored,
  $ATTMODE ignored, constant ATTDEFs not rendered, `estimate_mtext_extents` safety factor 1.01.

### 6.2 dxf-viewer (JS, MPL-2.0, three.js)

(Details from `research/repos/dxf-viewer/src/TextRenderer.js`, `MTextFormatParser.js`, HEAD cd07bae.)
- Fonts: TTF/WOFF via opentype.js only, list of fetchers loaded lazily per missing char; **STYLE font,
  bigfont, width factor, oblique ignored** (README: "DXF style and font attributes are ignored. Text
  glyphs are always rendered infilled."). No SHX.
- Glyphs → three `ShapePath` → earcut triangles, `curveSubdivision: 2` segments per curve (faceted),
  cached per glyph at size 1, instanced as TRIANGLES. No SDF/atlas.
- Size: `scale = 100 / (unitsPerEm × 72)` → 1 em = 1.3889 H (author: "XXX not really clear what is the
  resulting unit") — coincidentally ≈ cap height for the example fonts (0.97–0.99 H), not per-font.
- Special chars regex `%%([dpcou%])`, `\U+XXXX`, `\M+[1-5]XXXX` (MIF: 1 shift_jis, 2 big5, 3 euc-kr,
  4 undecodable (johab), 5 gbk); `%%c` → U+2205; `%%o/%%u` removed (not implemented); `%%nnn` literal.
  Bug: `\U+` is expanded *before* MTEXT parsing so `\U+005C`/`\U+007B` become syntax.
- TEXT: 51, 71, 210 not parsed (no oblique/backward/upside-down/extrusion mirroring); alignment from
  **ink bbox** with offset bugs (center uses (xMax−xMin)/2 without +xMin; FIT/ALIGNED scale uses only
  Δx; ATTRIB uses width factor as uniform scale). ATTRIB parser lacks 101 skip (embedded MTEXT codes
  overwrite ATTRIB fields).
- MTEXT: handles `\P \~ \S \C \pq… ^I ^J ^M \\ \{ \}`; `\H \W \Q \T \A \f \F` skipped without
  effect; `\c` and `\N` rendered literally; colour not scoped. Line height `5/3 × H × 44` (73 ignored),
  first baseline H below top, frame height = n × line height (bottom attach → 2/3 H below last
  baseline). Wrapping at spaces + CJK break opportunities + kinsoku; leading-space overflow rule from
  ezdxf. Default tab every 4 H. Stack parts 0.7 H, gap from ezdxf 1.2, `#` slanted.
- Issue threads (vagran__dxf-viewer): #5 `\pxqc;`, #17/#72/#135/#153 encodings & MIF, #149 CJK wrap,
  #160 \C + leading-space wrap, #164/#143 stacks, PR #104 columns declined ("only ~10 of hundreds of
  real samples had columns, all single-column"), #55 memory of triangulated glyphs, PR #155 WOFF.

### 6.3 mlightcad (TS; cad-viewer, realdwg-web, npm `@mlightcad/mtext-parser` 1.5.3,
`@mlightcad/mtext-renderer` 0.13.1, `@mlightcad/shx-parser` 1.4.5 — not vendored, read from GitHub)

- TEXT/ATTRIB are drawn **through the MTEXT engine** (realdwg-web `AcDbText.ts:843`) → backslash codes in
  TEXT get interpreted (mismatch); entity oblique 51 and flags 71 parsed but not rendered; FIT/ALIGNED
  not implemented (rendered left at nominal size); multi-line ATTRIB `_mtext` stored but not rendered.
- mtext-parser = port of ezdxf `MTextParser` + `\M+` (5 then 4 hex digits; 1 shift-jis, 2 big5, else
  gbk), `\U+` surrogate pairing, `%%nnn` (1–3 digits → fromCharCode), `%%<other>` dropped, `\p` with
  `tz` (clear tabs), `s` (line spacing) not parsed, `resetParagraphParameters` option; unknown-command
  literal slice bug. `\c` read as 0xRRGGBB (**CONFLICT** with ezdxf's BGR reading).
- Renderer: TTF/OTF/WOFF via opentype.js → typeface JSON (integer-rounded coords!) →
  `THREE.ShapeGeometry(shapes, 4)`; SHX via own parser → `THREE.LineSegments`. No kerning.
  TTF scale `unitsPerEm / yMax('A')` ("AutoCAD maps TrueType text height to the capital-letter height");
  SHX scale `size / (above + below)` (**CONFLICT**: AutoCAD uses `size / above`, see §4.4), default SHX
  advance = ink maxX + 0.2 × cell (heuristic, *not* the pen position; a native strategy exists but is
  not default); missing glyph '?' / '？' (bigfont).
- Layout: `LINE_SPACING_SCALE_FACTOR = 5/3`; exact = 44 × H × 5/3; at-least =
  max(that, 5/3 × max font size on line). Vertical anchoring from the **ink bbox** (top = ink maxY …) —
  mismatch with AutoCAD metric-based anchoring. Horizontal line alignment uses ink bbox (drops LSB);
  justified == left; tabs, `\~`, `\N`, `\X`, `\A` ignored by the renderer. Oblique adds advance
  (`tan × h` per glyph; AutoCAD doesn't). Width heuristic: 41 < 1.5 H replaced by estimated width.
  Bold TTF = uniform scale 1.06, italic = 15° skew; SHX italic = 15° oblique.
  Stacks: `^` tolerance parts at 0.7, `/` and `#` at **full** size with horizontal bar (no diagonal);
  PDF renderer uses different constants (ASCENT 0.75, DESCENT 0.25).
- Fallback chain: primary font → bigfont (\F or style) → defaultFonts (presets e.g. `['txt','simsun']`)
  → symbolFonts (`['simplex','amgdt']`) → not-found glyph. `%%c` tries SHX code 129 then U+2205,
  `%%d` 126 (!) then 176, `%%p` 177. Fonts from `cdn.jsdelivr.net/gh/mlightcad/cad-data/fonts/`.
- Tuned against **Haochen FastView (GstarCAD)** screenshots, not AutoCAD PLOT (cad-viewer #685).
- Issue threads: cad-viewer #2 (MIF = bigfont internal DBCS), #29 (missing fonts → oversized text),
  #113 (SHAPE size), #473 (AutoCAD dimensions use U+2205 not U+2300), #615 (`\U+2205` + "4.0"
  greedy parse), #571 (condensed SHX substitutes overlap), PR #264 (tiny width heuristic), PR #269,
  realdwg-web #199/#200 & PR #77 ("group 11 is the true anchor, because group 10 was computed from
  AutoCAD's own metrics"), #221 (`\n` dropped word), PR #157 (44 × 5/3), PR #216 (at least vs exact;
  factor 0 from libredwg treated as 1), PR #207 (CP949 → euc-kr).

### 6.4 Others

- **netDxf** (C#, MIT) writes paragraph codes `\pi<first>,l<left>,r<right>,b<before>,a<after>;` and
  line spacing `\ps*;` (default) / `\psa<f>;` (at least) / `\pse<f>;` (exact) / `\psm<f>;` (multiple)
  (`netDxf/Entities/MText.cs:640-700`); paragraph spacing before/after "valid values range from 0.25 to
  4.0", "the distance between two paragraphs is the total of the after-spacing of the upper paragraph and
  the before-spacing of the lower one" (`MTextParagraphOptions.cs`). It prefixes paragraphs with `\A1;`
  and documents "By default the paragraph vertical alignment is Center". **These `b`, `a`, `s?`
  letters are the undocumented AutoCAD 2008+ paragraph codes** (dxf-viewer also cites `\pxsm1,qc;`).
  PlainText(): `\X` → newline, `#` in stacks → "/", "^ " discarded.
- **ACadSharp** (C#): only `PlainText`; SVG writer maps attachment to SVG `alignment-baseline`
  (not usable as reference).
- **LibreCAD** (GPL, facts only): `toNativeString` converts `\P`→LF, `\~`→space, `%%c`→U+2205,
  `%%d`→°, `%%p`→±, `\U+XXXX`, `%%nnn` (3 decimal digits → code point), strips `\f…;` and braces
  (`rs_filterdxf.cpp:2550`).

## 7. Recommended approach for truedxf (pixel-matching PLOT)

1. **Geometry, not rasterised glyph textures.** PLOT output of text is vector: SHX = stroked polylines
   (width = lineweight of the entity; TEXTFILL/TEXTQLTY affect TTF only), TTF = filled outlines
   (TEXTFILL = 1 default; with TEXTFILL = 0 PLOT draws outlines only — see §4.5). Produce glyph
   geometry in drawing units (SHX: polylines with exact arc tessellation; TTF: quadratic/cubic
   outlines flattened adaptively to the plot resolution), then feed the normal polygon/line
   rasteriser used for all other entities. SDF/MSDF atlases can't reproduce AutoCAD's exact
   stroke/fill rasterisation and anti-aliasing and should be avoided for the reference renderer
   (they are fine for an interactive viewer later).
2. **Font metrics first**: implement `FontMetrics { capHeight(=scale basis), descent (font-wide),
   advance(glyph), inkBox(glyph), hasGlyph }` per font type. TEXT alignment uses: T = h, M = h/2,
   B = −descent·h, 72=4 = ink centre of string, widths = Σ advance (TTF) / ink extent (SHX: to verify).
3. **Don't trust derived values in the file** except as a fallback: recompute 10 from 11 (72/73 ≠ 0),
   recompute FIT/ALIGNED from 10/11, recompute MTEXT layout from content (42/43 unreliable). Provide a
   debug mode that uses stored 10 so we can compare against AutoCAD's own computation — the stored 10
   values in AutoCAD-saved DXFs are a free oracle for our font metrics (see Test ideas).
4. **Parser**: follow ezdxf's tolerant tokenizer (tested edge cases in 3.3) + `\M+`/`\U+` decoding
   *inside* the tokenizer (not as a string pre-pass), + netDxf's paragraph letters (b, a, s*, sa,
   se, sm) and `tz`.
5. **Layout**: ezdxf's box model is a good skeleton; replace constants by measured AutoCAD values
   (line spacing, at-least rule, stack geometry, underline offsets, paragraph spacing, tab rules,
   justify/distribute, column breaking).
6. **Fonts**: resolve exactly like AutoCAD (§4.1: XDATA family + bold/italic bits first, then group 3
   case-insensitive with optional extension, then an `acad.fmp`-style map, then FONTALT = simplex.shx;
   missing bigfont ⇒ no text). Real Autodesk SHX/TTF files must be supplied by the user for pixel
   matching; ship open fallbacks (qcad public-domain CXF for SHX look, Liberation/DejaVu for TTF) and
   make every substitution an explicit, reported event (PLOT with a missing font is a different drawing).
7. **Oracle-driven calibration**: build a test harness that reads AutoCAD-saved DXFs and compares our
   computed TEXT 10 and MTEXT 42/43 with the stored values (the script approach of §1.4/§3.6 already
   reproduces them to 4 decimals for Arial); run it on every font we support.

## 8. Open questions (UNKNOWN / needs AutoCAD PLOT)

Grouped by rendering impact (highest first).

1. **Stacked fractions** (`\S` with `/ # ^`, inside `{\H0.7x;…}`): part sizes, gap, bar position,
   length and thickness, diagonal geometry, vertical placement, `\A` interaction, TSTACKALIGN/decimal
   style encoding. No source has AutoCAD numbers.
2. **SHX horizontal extent** for TEXT Center/Right/Middle and FIT/ALIGNED: pen advance vs ink extent
   vs "advance minus trailing gap".
3. **SHX pen rounding** after arcs (and other commands) and arc tessellation in PLOT; TTF outline
   flattening vs TEXTQLTY (default 50).
4. **MTEXT vertical frame** for attachments 4–9 (last baseline? descender? ink?), horizontal frame
   with 41 = 0, and whether the "ascent push" observed in 43 also moves the glyphs.
5. **Exact line spacing** (73 = 2) box (one sample: 43 = 3.0 for 2 lines at h = 1), at-least with mixed
   `\H` heights, paragraph spacing `b`/`a` and `\ps…` codes and their units.
6. Underline/overline/strike offsets and thickness (TEXT %%u/%%o, MTEXT \L/\O/\K), and whether they
   span spaces/tabs.
7. Order of oblique vs width factor (TEXT and MTEXT); `\T` semantics (factor vs +1).
8. MTEXT background mask: horizontal extent (41 vs text), exact offset (45 − 1)·h on all four sides?,
   canvas colour in PLOT (90 = 2/3), text frame (90 & 16) line geometry, and the pre-R2018 frame
   LWPOLYLINE referenced from ACAD_MTEXT_TEXT_BORDERS (draw or skip?).
9. `\A` default (bottom per ezdxf; "Center" per netDxf docs) and exact placement of mixed heights.
10. Column breaking (R2018 single-entity columns), column count for dynamic auto height.
11. Constant ATTDEFs and $ATTMODE = 0/2 in PLOT; MINSERT attribs.
12. TEXT with 72/73 ≠ 0 and inconsistent 10 in a **DXF**: does AutoCAD recompute on OPEN?
13. `%%nnn` code space; unknown `%%x`; `%%c` with Unicode SHX (U+00D8 vs U+2205 vs 258).
14. Missing-glyph rendering: SHX "?" = font's shape 63?; TTF fallback font choice per script.
15. Bigfont scale relative to the main font; missing bigfont in PLOT (core console: text vanishes);
    unifont code-7 byte order.
16. Missing TTF: FONTALT (core console) vs Windows substitution (Autodesk help).
17. $QTEXTMODE in PLOT (rectangles?); TEXTFILL = 0 outlines.
18. ~~Vertical text (STYLE flag 4) alignment semantics; MTEXT flow direction 3.~~ Answered in
    §11 (2026-10-01); vertical MTEXT attachments other than 1 remain open.
19. `\p` indent/tab units (multiples of h vs absolute, ezdxf#1390), `\pt` right/centre/decimal stops.
20. Distributed paragraph alignment; justified last line; CJK line breaking and kinsoku in AutoCAD.

## 9. Test ideas

Each is a tiny DXF (R2018 unless stated), plotted from AutoCAD to a raster at known scale, plus the
re-saved DXF from AutoCAD (its recomputed 10 / 42 / 43 values are a numeric oracle — the same trick used
in §1.4/§3.6). AutoCAD 2027 is installed on the research machine (`accoreconsole.exe` + AutoLISP
`textbox`/`entget` gives quick numeric answers before PLOT comparisons — see §4 provenance; ask the
owner before automating it).

TEXT
1. Alignment matrix: all 15 (72,73) combos × {txt.shx, simplex.shx, romans.shx, isocp.shx, arial.ttf,
   times.ttf, calibri.ttf} × strings {"XXX", "xxx", "gjpqy", "A", " A ", "AV"}; h = 10, crosshair
   LINEs through 10 and 11. Re-save → compare 10.
2. Stale 10: TEXT 72=1/73=2 with correct 11 and 10 = (1000,1000); PLOT directly after OPEN.
3. FIT/ALIGNED with p1→p2 at 30°, strings ending in "A" and "C" (overhang vs advance), + BACKWARD and
   UPSIDE_DOWN flag combos (ezdxf#353 quirks).
4. Oblique 30° × width factor 3 on "I" → slope of the stem tells the transform order.
5. Special codes: "%%c%%d%%p%%%", "%%u12%%u3", "%%o%%k", "%%176%%065%%248", "%%x", "\U+2205\U+00D8",
   "\P\~" in TEXT, trailing "^ ", with txt.shx, simplex.shx, isocp.shx (Unicode), arial.ttf.
6. Negative-scale INSERT containing TEXT/ATTDEF(const)/MTEXT + an ATTRIB; extrusion (0,0,−1) TEXT.
7. Height-0 TEXT, height-0 ATTRIB; TEXT style missing from the STYLE table.

ATTRIB/ATTDEF
8. Block with constant, invisible, normal and multi-line (R2018 embedded MTEXT) ATTDEFs; INSERT with
   ATTRIBs; loose ATTDEF in model space; $ATTMODE = 0/1/2; MINSERT 2×2 with ATTRIBs; ATTRIB over a HATCH
   in the block (draw order).
9. Multi-line ATTRIB whose group 1 differs from the embedded MTEXT.

MTEXT
10. Line spacing: 10 lines "Xg" h = 1, factors 0.25/0.6/1/2/4, styles 1 and 2; plus one line with
    "{\H3x;X}" (at-least growth) and lines with overshoot glyphs ("SOS") → measure baselines.
11. Attachments 1–9 for one-line "Xg" and two-line "X\Pg" with 41 = 0 and 41 = 50, crosshair at 10.
12. Word wrap: leading spaces, multiple spaces, a word longer than 41, "a-b_c", CJK run, trailing \P,
    `\~`, tabs (default 4·h stops and `\pxt…` stops with `c`/`r` prefixes).
13. Stacks: `\S1/2;` `\S1#2;` `\S1^ 2;` `\S5^6;` `\S+0.1^-0.2;` inside `{\H0.7x;…}` and bare, with
    `\A0/1/2`, SHX and TTF.
14. Inline codes torture string from ezdxf#889 + invalid codes (`\:`, `\C+5`, `\H1..5`, `\AX`, unbalanced
    `}`), `\f` switches (`\fArial|b1|i1|c0|p34;`, `\Fgdt;`, `\fromans.shx,bigfont.shx;`), `\c255;` vs
    `\c16711680;` (byte order), `\T2;`, `\W0.5;`, `\Q20;`.
15. Paragraph codes: `\pi-3,l4,t4;`, `\pxqc;`, `\pxqj;`, `\pxqd;`, `\pxsm2;`, `\pse1.5;`, `\pb1,a2;`.
16. Background mask: 90 = 1/2/3/16/17, 45 = 1.0/1.5/5, with 41 = 0 and 41 > text width, over a HATCH.
17. Columns: static/dynamic/manual R2018 embedded object vs pre-R2018 linked MTEXT (use
    `ezdxf/examples_dxf/columns_R2007.dxf` / `columns_R2018.dxf`, which contain AutoCAD 42/43 values).
18. Rotation: 50 only (degrees), 11 only, both conflicting; 11 = (0,0,0) (should be invisible).
19. Chunking: a `\M+` / `\U+` / `\S…;` split across a 3/1 boundary.

Fonts
20. SHX per-glyph test sheet for txt/simplex/romans/isocp/gdt/amgdt: every code 32..255 (+ 256–258),
    h = 100, plotted at high DPI → compare against our SHX interpreter (pen rounding, arcs, code 14).
21. Bigfont: `txt.shx,bigfont.shx` / `gbcbig.shx` with `\M+` text and raw DBCS bytes in an R2004 DXF
    ($DWGCODEPAGE ANSI_936); missing bigfont.
22. TTF sheet: Arial, Times, Calibri, SimSun, a font without "A", a .ttc, an .otf; bold/italic via XDATA
    only; group 3 with full path; missing TTF; per-glyph fallback (U+2205, 中 in Arial).
23. Vertical style (flag 4) with txt.shx + @extfont2.shx.
24. TEXTFILL 0/1 and TEXTQLTY 0/50/100 plots of large Arial "O" (tessellation); SHX lineweight.


## 10. Findings from @truedxf/fonts (2026-09-30, local AutoCAD 2027 font folder, facts only)

- **Unifont code-7 subshape numbers are big-endian** (high byte first): all 888 subshape
  references in the 28 unifonts of the AutoCAD 2027 `Fonts` folder resolve only when read
  big-endian. This resolves the §4.3 CONFLICT (ML was right; EZ/YF/TZ/OSG read little-endian).
- **The bigfont index is a hash table**, not a list: slot = byteswap(code) mod table size (a
  prime), forward linear probing, empty slots all-zero — in all 13 bigfonts (`writeShx` builds it
  that way and every AutoCAD SHX round-trips byte-identically).
- **Pen rounding after arcs is strongly supported** (§4.3 hypothesis): chineset.shx has 15 glyphs
  whose exact arc end lies off its 48-unit advance grid (e.g. 48.2254); rounding the pen to the
  integer grid after every octant/fractional arc puts all of them on 48 (27 of 28 in bold.shx).
- The position stack spans characters in some fonts (ISO.shx, times.shx, bold.shx: shape 1
  "start" pushes, shape 13 CR pops) — decoded alone they under/overflow.
- **special.shx** (and spec_bar/spec_sl) bigfont glyphs call 1-byte subshapes that exist only in
  the **primary** font; special.shx `~z` is `3,4` only (a scale change meant to persist? UNKNOWN).
- **gbcbig.shx header height anomaly**: shape 0 reads as above = 64 (`0,64,2,0`) while its glyphs
  are scaled by 9/102 to about 8 units high — the effective height AutoCAD uses is UNKNOWN (needs a
  TEXTBOX probe).
- **gbcbig plot height** (VERIFIED-BY-ACAD 2026-10-01, font-probes/bigcp-text): AutoCAD draws gbcbig glyphs at
  **1/8 of the text height**: 日 is 7.8 high and 3.2 wide at h = 10; the 64 in the header is not the cap height.
- **simplex.shx "A"**: ink 16 units wide (7.619 at h = 10, as TEXTBOX measured), but the pen
  advance is **22 units = 10.476 at h = 10**, not "≈ 9.5238" as §4.6 said. Re-checked against
  AutoCAD: in suite `text` (plotted in simplex.shx, see §11) the Center box of "A " is exactly
  41 units = 22 ("A") + 19 (space), and Center/Right/Middle/FIT/ALIGNED of 195 strings reproduce
  AutoCAD's DXFOUT values to < 1e-3 h with the 22-unit advance — **VERIFIED-BY-ACAD**; the 9.5238
  of §4.6 is wrong.

## 11. AutoCAD 2027 PLOT findings for TEXT / MTEXT / ATTRIB (2026-09-30)

Source: `tools/acad` references of the suites `text`, `mtext`, `attribs` (fixtures from `tools/gen`)
and `text-lato` (`packages/text/scripts/gen_text_lato.py`), compared with the truedxf renderer
(`packages/text`, `packages/render/src/text.ts`) and with AutoCAD's DXFOUT re-saves
(`node packages/text/scripts/oracle.ts`). **Caveat**: the reference session did not see the
Liberation fonts installed the same day ("Substituting [simplex.shx] for
[LiberationSans-Regular.ttf]" in every log — the §4.1 "fonts registered mid-session" hypothesis
confirmed), so the `text`/`mtext`/`attribs` references are **simplex.shx** renderings (compare
with `visual.ts --hide-fonts ^liberation`); Lato and Cascadia Mono resolved, hence `text-lato` for
TrueType. Everything below is VERIFIED-BY-ACAD (case ids in parentheses) unless marked.

TEXT (§1)
- SHX horizontal box = ink box [inkLeft, inkRight] (a leading space does not count), but the
  advance box [0, Σadvance] when the string ends in a space (text/hbox-*, spaces-*). The TTF union
  rule of §1.4 is confirmed with Lato and Cascadia Mono (text/middle-lato-*, bottom-*).
- Missing group 11 with 72/73 ≠ 0: 11 defaults to the **origin** (text/missing11-*).
- Invalid 72 (e.g. 6): LEFT at 10; valid 72 with an invalid 73 (e.g. 4): baseline at 11
  (text/combo-invalid-*).
- Height ≤ 0 draws with **$TEXTSIZE**; STYLE fixed height is ignored (text/height0-*). ALIGNED with
  coincident points: AutoCAD computes h = 0 → $TEXTSIZE (text/aligned-coincident); FIT with
  coincident points: LEFT at 10 with the stored height (text/fit-coincident).
- A TEXT **without group 71** uses the STYLE's generation flags (text/flags-style-2/4), unlike
  41/51 (entity values only).
- FIT/ALIGNED with BACKWARD mirror **about the baseline** (like upside-down); both flags mirror
  nothing — ezdxf#353 confirmed (text/fitflags-*).
- Oblique is a shear applied **after** the width factor, x' = w·x + y·tan θ (text-lato/
  text-oblique-width; resolves §1.5 item 2 and §8.7 for TEXT).
- Control characters in SHX TEXT execute the font's own shape when present: `^J` (LF, shape 10)
  moves the pen down by the shape's displacement **without returning x** (simplex: 36 units);
  others draw "?" (text/caret-controls). `^?` = DEL → "?"; `^X` with X below "@" (e.g. `^6`) → "?"
  (not ezdxf's mod-126 "t"); `^a` → "!", `^z` → ":" (X − 64) (text/caret-lowercase).
- Unknown `%%x`: the `%%` is dropped and "x" drawn ("a%%xb" → "axb", "ab%% cd" → "ab cd",
  "%%%%" → "%%") (text/unknown-pct*). `\u+XXXX` (lower-case u) decodes like `\U+`; `\U5C42`
  without "+" stays literal (text/escape-spellings).
- Characters missing from an SHX font draw the font's "?" in TEXT (text/escape-spellings).
- `%%u` / `%%o` / `%%k`: SHX (simplex) lines at −0.2 h / +1.2 h / +0.5 h, spanning the characters'
  advances but **shifted 0.15 h to the left** (text/special-*; the shift's origin is unknown);
  TrueType (Lato) at −hhea descent / +hhea ascent / +0.5 h, **unshifted** (text-lato/text-*).
- **$QTEXTMODE = 1** plots rectangles: TEXT [alignment box] × [−descent, h]; MTEXT one box per line
  [ink left, ink right] × [baseline, baseline + h] (text/qtextmode-1).
- A TEXT whose style does not exist, in a STYLE table without Standard: the first style is used
  (text/no-standard-style).
- A DXF ≤ R2004 with ANSI_936 whose bytes are UTF-8 renders as GBK ("?" per unknown DBCS pair):
  AutoCAD decodes as declared (text/utf8-bytes-*); a "try UTF-8 first" load heuristic does not
  match AutoCAD.
- STYLE XDATA italic for Cascadia Mono renders with more slant than CascadiaMonoItalic.ttf —
  synthetic oblique or another face? UNKNOWN (text/xdata-mono-italic).

MTEXT (§3)
- **Stacks** (simplex; hs = current char height; parts are drawn at hs — the usual 70 % comes
  from an explicit `\H0.7x;`): `/` and `^`: lower part on the baseline, upper part's baseline at
  4/3·hs; `/` draws a bar at 7/6·hs from the stack start to the widest part's ink right edge and
  centres the parts by ink width, `^` left-aligns them; advance = the larger part advance.
  `#`: upper part at the start on baseline hs, lower part on the baseline starting hs/3 after the
  upper part's ink right; the slash is a 2·hs long line at 55° centred at (upper ink right + hs/6,
  hs); advance = lower start + lower advance. No divider (`\S12;`): the text raised by hs/3.
  Stack ink pushes the line down like any ink (mtext/stack-*). These simplex constants are the
  special case of the TrueType rule below (simplex digits: ink height = hs, side bearings ≈ 0);
  truedxf keeps them for SHX fonts.
- **Stacks with TrueType** — VERIFIED-BY-ACAD 2026-10-01 (Liberation Sans: mtext/stack-frac-*,
  -tol-*, -diag-*, -no-divider, -second-divider, -escaped-semicolon, -space-after-slash; Lato:
  text-lato/mtext-stacks; the reference PDFs give the exact pen positions, matched to ~1 font
  unit; supersedes the "details UNVERIFIED" remark). Every part is placed by its **ink box**:
  - horizontal: side bearings are removed. `^`: both inks start at the stack start. `/`: both
    parts are centred by ink width on the larger ink width W; the bar runs from the stack start
    over W. `#`: the upper ink starts at the stack start, the lower ink hs/3 after the upper ink's
    right edge (PDF: 399.8 of 400 units). No divider: the ink starts at the stack start.
    A part that starts with a space keeps it (its box starts at the pen; `\S1/ 2;` — AutoCAD's
    bar is still ~19 font units longer than pen-to-ink-right there, unexplained).
  - advance = the stack's ink width + **the side bearing of the font's "0"** (Liberation Sans 80,
    Lato 60 font units; both fonts have lsb = rsb for "0"; PDF stack advance minus ink width =
    68.1 units = 80/2048 em in Liberation, 25.2 = 60/2000 em in Lato, for `/`, `^`, `#`, no
    divider and 1- or 3-digit parts alike). Not proportional to hs across fonts (0.057 hs vs
    0.042 hs).
  - vertical (`/`, `^`): lower part on the baseline; upper baseline = the lower part's **ink
    height** (top − bottom, overshoots included) + hs/3 (frac-bare 270 px = 203 + 67; second
    divider: the "/" in "2/3" lifts it to 280); bar at the lower ink height + hs/6. `#`: upper
    baseline = the lower ink height; the slash is centred at (upper ink right + hs/6, upper
    baseline). No divider: raised by hs/3.
  - the stack's height for the line (ascent push) = upper baseline + the upper part's ink height
    (top − bottom): a descender in the upper part raises the line although no ink is there
    (stack-escaped-semicolon "1;2": 40 px gap above "1"; tol-signs "+0.1": 3 px from the "0"
    overshoot).
  - open: `\A1`/`\A2` align normal text against the stack's full height (stack-baseline-a1/a2,
    stack-in-wrap); the line after a stack line sits hs/3 higher than the at-least gap predicts
    (mtext/chunk-stack, one sample).
- `\S5^6;` is **not** a tolerance stack: `^6` is a caret code (U+FFF6: "?" with SHX, the primary
  font's .notdef with TrueType), giving the no-divider stack "5?" (mtext/stack-caret-nospace) — the §3.6.3 assumption from ezdxf#889 is wrong; `\S1^ 2;` is a
  stack.
- `\C+5` swallows `\C` and prints "+5"; `\H1..5` → h = 1, then ".5"; `\AX` prints "X"; a stray `}`
  is ignored; `\J` and `\:` are printed literally (mtext/code-invalid-codes) — the §3.3 claim
  "\C+5 prints \C+5" does not hold for AutoCAD 2027.
- `\c` = R + 256·G + 65536·B confirmed (mtext/color-truecolor); values ≥ 2^24 are **ignored**
  (entity colour), not masked (mtext/color-truecolor-large).
- `\X` outside dimensions is printed literally (mtext/code-dim-wrap).
- Control characters draw a missing-glyph box (matches Arial's .notdef at Arial's own cap scale);
  `^a`/`^z` are the printable "!"/":" (mtext/caret-*). Characters missing from an SHX font come from
  a TrueType fallback **at that font's own cap-height scale** (SimSun reproduced 层 exactly) —
  unlike TEXT, which draws "?" (text/escape-spellings).
- **Missing-glyph boxes** (VERIFIED-BY-ACAD 2026-10-01, Liberation Sans / Lato references; the
  PDF fonts and ToUnicode maps identify the glyphs, the raster gives the advances):
  - `^X` is (X − 64) as a 16-bit code: `^6` = U+FFF6, `^-` = U+FFED, `^?` = U+FFFF (not DEL).
    No font has those, so SHX fonts draw "?" (the 2026-09-30 simplex findings above still hold).
  - TEXT, TrueType: control characters (< U+0020, also `%%9`) draw the **primary font's
    .notdef** with its advance (Liberation: a cap-height box, advance 1536; text/caret-codes,
    caret-controls, nnn-short; Lato: text-lato/text-control).
  - Characters no font has — U+FFFF (`^?`), lone surrogates (`\U+D83D\U+DE00` = two boxes),
    unassigned U+FFxx — draw **Arial's .notdef at Arial's cap scale** with its advance, in TEXT
    and MTEXT, also with a TrueType primary (PDF: ArialMT at 1676.4 next to Liberation at 1744.2
    = the cap-height ratio; text/caret-lowercase(-mtext), escape-astral-r2004). C1 controls
    (U+0081 from an undefined code page byte) draw the same box with **zero advance** — the next
    character overlaps it (fileformat/divergent-ansi-932).
  - Missing *assigned* characters draw **nothing** in the raster plot (Thai with Liberation,
    text/fallback-thai-*: the PDF writes notdef glyphs for them, the PNG has no ink and no
    advance). U+FFED in a stack is a small square from a Windows font-linked font
    (mtext/stack-tol-signs-nospace: box 0.355 h, advance ≈ 0.72 h; Microsoft JhengHei comes close
    but does not match) — not emulated.
  - MTEXT control characters: Arial's .notdef at Arial's cap scale whatever the font, advancing
    **0.575·h** (Liberation and Lato alike: PDF 552/960 and 344.8/600), except FS/GS/RS/US
    (`^\ ^] ^^ ^_`), which do not advance (text/caret-codes-mtext, text-lato/mtext-control).
  - Inside an MTEXT stack a missing character draws the **primary font's** .notdef, and the stack
    measures it up to its advance, not its ink (mtext/stack-caret-side-by-side: next pen = box pen
    + 1536 units + the "0" side bearing).
  - MTEXT with an SHX font: a character missing from the font and from every TrueType fallback
    draws nothing (font probes, font-probes/bigcp-mtext: 한 with txt + gbcbig).
- `%%nnn` digits go into a **3-character buffer that keeps the previous code's tail**:
  `[%%9][%%09][%%009][%%65]` draws boxes for 9, 9, 9 and then U+0293 (659) for `%%65`
  (text/nnn-short, PDF ToUnicode 0255 → 0293, 2026-10-01). Whether the buffer survives across
  strings is UNKNOWN (truedxf resets it per string).
- **Vertical TEXT** (STYLE flag 4; VERIFIED-BY-ACAD 2026-10-01 acad-default-fonts/vertical-*
  with txt.shx — pixel-exact — and the DXFOUT of fileformat/corpus-ezdxf-text-stacked-shx-font,
  64 TEXTs incl. rotation, width factor, oblique and mirror flags, all 10 points matched):
  - a **dual-orientation SHX font** (modes = 2) does it all: its glyphs in vertical mode (code
    0x0E commands) are centred on the pen x, hang below the pen y and advance the pen down
    (txt.shx: ±2 × −6 units, advance −9 = 1.5 h; simplex ±8 × −21, advance −31);
  - 72 moves 10 along the column, **73 is ignored**: Left/any → anchor at 11 (no offset), Center
    and Middle → 11 at the centre of the column's ink, Right → 11 at the ink bottom ("ABC",
    txt.shx, h = 12: 10 = 11 + 24 / + 48);
  - ALIGNED: h = |11 − 10| / (ink column length), the ink top at 10; FIT: only the width factor
    changes (w = d / (length·h)), the column keeps its length; rotation = angle(10 → 11) + 90°,
    with BACKWARD − 90° (DXFOUT 284°/270°; the column then runs away from 11 in the plot); FIT
    with coincident points: rotation 90°, DXFOUT width factor 0, drawn like 1;
  - **TrueType** "vertical" text is drawn horizontally but aligned as a column from the pen down
    to −descent: Right puts 10 descent·h above 11 (Arial: 431/1466 = the OS/2 typo descender;
    truedxf uses the hhea 434), Center and Middle put 11 at the ink centre of the horizontal
    line, ALIGNED h = d / descent (17.53 for "Aligned alignment", a giant text) with the + 90°
    rotation (fileformat/corpus-ezdxf-text-stacked-true-type-font DXFOUT; f1 0.06 → 0.96).
  - Extents: AutoCAD's plot extents of these files matched once the BACKWARD rotation was right
    (the column's ink box; no special extents rule needed).
- **MTEXT flow direction 3** (top to bottom, VERIFIED-BY-ACAD 2026-10-01):
  - TrueType (Liberation, mtext/flow-direction-3 `ABC\PDEF`, attachment 1): **one horizontal
    line**, the paragraphs **0.55·h** apart (D's pen 5.497 after C's advance end at h = 10), the
    **baseline at the insertion point**; one sample.
  - Dual-orientation SHX (simplex, fileformat/corpus-ezdxf-text `vertical\PText`, h = 100,
    attachment 1, 44 = 1 and 2): each paragraph is a **vertical column** (glyphs as in vertical
    TEXT), the first glyph's top at the insertion point, the first column's ink starting at the
    insertion point (pen 28–30 units right of it), columns left to right **≈ 4/3·h·f** apart
    (133.25 for f = 1, 261–263 for f = 2 at 0.23 px/unit — 4/3·2·h = 266.7 is 1.5 % more);
    other attachments, wrapping, stacks and inline fonts in vertical MTEXT are UNKNOWN.
- `\T` multiplies advances, clamped to **0.75…4** (`\T0.5` and `\T0.1x` both give 0.75)
  (mtext/code-tracking*).
- At-least line gap with mixed heights: baseline_{i+1} = baseline_i − (5/3·f − 1)·(H_i + B_{i+1})/2
  − ascent_{i+1}; H_i = largest cap height on line i, B = the char height where paragraph i+1
  starts (outside its braces), ascent = max(largest cap height, ink top)
  (mtext/spacing-big-line-1, height-style-0); reduces to 5/3·h·f for uniform text.
- Paragraph spacing: `\pb<v>` / `\pa<v>` are **drawing units** before/after the paragraph (also
  before the first one); `\pse<v>` = exact spacing as for char height v (pitch 5/3·v, first
  baseline v below the top); `\psa<v>` = at least 5/3·v; `\psm<f>` = factor (mtext/para-spacing-*).
- **Paragraph codes are not scoped by braces**, and a `\p` anywhere in a paragraph formats the
  whole paragraph: `{\pxqc;A\P}B\PC` centres A, B and C; `A{\pxqc;B}C\PD` centres "ABC" and D
  (VERIFIED-BY-ACAD 2026-10-01 mtext/para-scope, para-scope-mid; answers the §3.5 question).
- **Paragraph line spacing sets the gaps below its lines** (VERIFIED-BY-ACAD 2026-10-01, PDF
  baselines at Liberation h = 8): `\pxsm2;A\P\ps*;B\PC` puts B 27.733 below A and C 13.75 below
  B (mtext/para-spacing-reset). `\psm<f>` = f × a single gap of **26/15·h** (13.867 at h = 8,
  where the entity spacing gives 13.75–13.77 from the ink excess): xsm2 1664/60 = 27.733 =
  2 × 13.867, sa2 832/60 = 13.867 (5/3·2 is smaller). The 26/15 rests on one text each —
  UNVERIFIED in general.
- **Group 44 = 0** draws like **0.25** (the valid minimum; mtext/spacing-defaults-factor-0: gaps
  3.44 at h = 8). With f < 1 the ink above the cap height (0.426 for "Line two") is scaled by f:
  gap = (5/3·f − 1)·h + h + f·excess = 3.333 + 0.107; at f = 1.25 it is not scaled
  (mtext/random-0002/-0003 regress otherwise).
- An overline raises the line like ink at +1.2 h (mtext/code-underline-all); MTEXT decoration
  lines are **not** shifted (unlike SHX TEXT); TTF decorations use the hhea metrics as in TEXT.
- Left-aligned lines put their **ink** at the margin (a positive left side bearing is removed,
  text-lato/mtext-attach-1); centre/right alignment use the ink box.
- Group 46 (defined height) does **not** move non-column MTEXT for any attachment
  (mtext/defined-height-*).
- 11 and 50 both present: the **later** one wins (mtext/rot-both-*).
- Background mask: [0, frame width] × [bottom, top] grown by (45 − 1)·h on all sides (pixel-exact,
  mtext/bg-*); with **$FILLMODE 0** the mask is drawn as its outline in the fill colour
  (mtext/bg-fillmode-0).
- Explicit `\pxt5,c15,r25;` stops produced the same positions as the default 4·h stops, and a tab
  at the start of the paragraph did not move the first character — rule UNKNOWN
  (mtext/tabs-explicit).

ATTRIB / ATTDEF (§2)
- MINSERT: the stored ATTRIBs are drawn in **every** cell (translated by the cell offset in the
  insert's rotated frame) (attribs/minsert-*).
- ATTRIBs of an INSERT on an **off** layer are still drawn when their own layer is on (layer-0
  attributes inherit the off layer) (attribs/layer-off-insert).
- R2018 attribute type 71 = 1 draws group 1 even when an embedded MTEXT is present
  (attribs/multiline-attrib-type1).

## 12. Findings 2026-10-01 (user drawing, VERIFIED-BY-ACAD user/studienleistung)

- (Triage 2026-10-01: with 41 = 0 leading tabs do *not* count — `^I^I^I|`, `^I12.5` and
  `\pxt…;^IA` put the first ink at the margin; the rule below holds for 41 > 0.)
- MTEXT lines that start with `^I` keep the tab advance: the text sits on the default 4·h tab
  stop. The "left edge = ink" rule (§3.6.1) removes only the first glyph's own side bearing,
  not leading tabs/spaces.
- Single-column dynamic column data (75 = 2, count 1, stored column height > 0) does not set the
  frame height for middle/bottom attachments; the frame comes from the text content. **Re-verified
  for multi-column text** (§3.7.1, `user/columns-all`, `text-probes/mtx-cols-*`): stored heights never
  move the text, every column is aligned on its own content; they only size the drawn frame/mask box.

## 13. Findings 2026-10-01 (user drawings text-frame*, columns-all; probes text-probes/mtx-*)

- MTEXT columns, text frame and background mask: §3.7.1 (all VERIFIED-BY-ACAD).
- Extents (plot "Extents", $EXTMIN/$EXTMAX) of TrueType TEXT/MTEXT = the font **cell boxes**, not the
  ink: per line [pen start, advance end] × [baseline − hhea descender, baseline + hhea ascender]
  (`extents/probe-text-xxx`, `user/text-frame2`: $EXTMIN.x = the pen origin of "B", 36.6 units left of
  its ink; $EXTMAX.y = the first line's ascender; note 03 §6.2). It sets the plot scale of every
  extents-plotted drawing with text (`user/studienleistung` F1(r=1) 0.41 → 0.97).
- A comment after a blank on a group-code line (` 71   // attachment point`) is ignored by AutoCAD
  (`user/text-frame-annotated`; note 01 §8.1).

## 14. TrueType glyph positions in raster plots (VERIFIED-BY-ACAD 2026-10-01, text-probes/ttf-*)

AutoCAD's **raster** plot driver (PNG) does not place TrueType glyphs at the exact pen positions;
the PDF does (its `Tj` glyph origins are the hmtx advances within 0.12 pt over 95 characters, so
the database layout is exact and this is a device-side effect). Probes: rows of one repeated glyph
(`ttf-adv-text-h{3,4,10}`, `ttf-adv-mtext-*`), two-glyph runs (`ttf-pair-h*`, `ttf-tall-h*`, the
tall/short pairs give an unambiguous run boundary), sentences (`ttf-bow-h*`) and alignments
(`ttf-align-h3`), Liberation Sans, plot at 10 px/unit.

Rule for one string of N characters (spaces included) with exact device advances aᵢ (px):

1. every character advances ⌊aᵢ⌋ px;
2. E = ⌊Σ aᵢ⌋ − Σ ⌊aᵢ⌋ missing pixels (all N advances, the last one included);
3. P = ⌊(N − 1) / E⌋; gap i (between characters i and i + 1) gets +1 px when i mod P = 0 and
   i / P < E, i.e. one extra pixel every P gaps **from the start**, until E are used;
4. the first character keeps its exact position.

Measured step patterns: `n` h=3 (24.25 px) → 25 24 24 24 …; `m` h=3 (36.32) → 37 36 36 …; `s` h=4
(29.07, E = 3 over 50 gaps) → +1 at gaps 0, 16, 32; `r` h=3 (14.52, E = 53 over 102 gaps, P = 1) →
53 × 15 px then 49 × 14 px. When E is about half the gaps or more (P = 1) the extra pixels
pile up at the start of the line, so mid-line glyphs drift right by up to ~10 px at h = 3 (cap
height 30 px) and come back by the end: the "drift" in mtext/chunk-* (F1(r=1) 0.83 → 1.00).
Rounding E with round() instead of floor() is wrong in 4 of the 9 single-glyph rows.

- The same rule holds for TEXT and MTEXT and for MTEXT attachments 1/2/3, `\pqc` and TEXT
  center/right alignment (ttf-align-h3).
- Strings: a TEXT line; an MTEXT line segment with one font, height, width factor, tracking,
  oblique, colour and underline/overline/strike (a `\C` change splits: mtext/color-truecolor);
  tabs, stacks and fallback-font glyphs end a string; spaces at the end of a wrapped MTEXT line
  are not part of it (mtext/wrap-width-0005).
- Separate TEXT entities at the exact word positions plot at the exact positions (each string
  starts exactly).
- Implemented in render `pixelRunShifts` (plot emulation only; the viewer keeps exact positions).

Open: column MTEXT with a centred attachment (text-probes/mtx-cols-dynauto-mc, -dynman-bc) plots
closer to the exact positions than this rule predicts, while the same text in columns with
attachment 1 follows it. The split rules at tabs and fallback fonts are inferred from scores,
not probed.

## 15. Corpus font resolution (2026-10-03)

**VERIFIED-BY-ACAD** (`corpus-proxy/arch-cn-1e85a`, `arch-cn-1e8ba`, `arch-cn-1e965`,
2026-10-03): the yellow native TEXT "FD" plots as thin strokes, unlike truedxf's filled
SimSun outlines. This verifies appearance, **not the name of the font or the cause of substitution**.
An isolated native-text render using `simplex.shx` differs from the first reference's yellow
label by just 2 pixels, F1(r=1)=1.0; `romans.shx` gives the same geometry for these two letters.
`txt.shx` differs by 2817 pixels, F1=0.2073. Measurement ROI: x [250,830), y [620,1130) in the
2000×1500 PNG, exact yellow only. SimSun differs by 42825 pixels, F1=0.0128. These are local
candidate measurements against the existing plot, not a new AutoCAD font-selection experiment.

Raw data observations (unmodified corpus DXF; not new AutoCAD behavioural rules):

- TEXT `9406` in block `楼层配线机柜`: style `宋体_txtstyle_0_0` (`44D`), group 3/4 both empty,
  XDATA `1001 ACAD / 1000 宋体 / 1071 0`. Height 350, width factor 0.8, horizontal alignment 4.
  Parent INSERTs: `1E82F`, `1E89F`, `1E964`, respectively. `$TEXTSTYLE=ELEC_DIM`; Standard is
  `arial.ttf` with family Arial and flags 34, so neither names simplex or txt.
- Bottom labels in 1e85a: INSERT `1E79B`, TEXT `13339` "弱电井" / `1333A` "冷媒"; in 1e8ba:
  INSERT `1E7A2`, TEXT `13D3D` / `13D3E`. Style `宋体` has empty group 3/4, family `SimSun`,
  flags **34306** (GB2312 charset), height 300, width factor 1, left-baseline alignment.
  They resolve to `simsun.ttc` in truedxf, without substitution or missing-bigfont suppression.
- In 1e965 the same labels are INSERT `1E913`, TEXT `1B2FE` / `1B2FF`: style `_TCH_DIM`,
  group 3 `SIMPLEX`, group 4 `GBCBIG`, no TTF XDATA, height 438.8652482269502, width 0.7.
  They resolve to `simplex.shx` + `gbcbig.shx`, without suppression. Treating all three cases
  as a missing CJK font would be wrong. Top-level pick ranges identify these INSERTs; child
  TEXTs were located by composing their block transforms. A text-only diagnostic confirmed
  that their rendered ranges reach the bottom edge of the respective plot windows.

`font-resolution` contains 31 probes: empty-file family/flags pairs, explicit SimSun/SHX
controls, missing primary/bigfont pairs, three FONTALT=txt variants and nine isolated native
FD/CJK cases at the corpus coordinates (CJK both clipped and fully visible). Each requests PNG,
PDF and DXFOUT. `tools/gen/write_font_resolution_probes.py` checks determinism and refuses to
overwrite different bytes. All 31 AutoCAD runs succeeded (121 s, 2026-10-03).

### 15.1. Verified resolution and linking rules

**VERIFIED-BY-ACAD** (`font-resolution/empty-song-flags0`, `empty-song-flags34306`,
`empty-simsun-flags0`, `empty-simsun-flags34306`, `file-simsun-song-flags0`,
`file-simplex-song-flags0`, `file-simplex-song-flags34306`, 2026-10-03):

- In this English AutoCAD 2027 installation, localized family **宋体 does not resolve**.
  The console reports `Substituting [simplex.shx] for [宋体].` before the harness prologue.
  Flags 0 and 34306 give identical PNGs; English **SimSun resolves** with either flag value
  and produces exactly the same PNG as explicit `simsun.ttc`. Charset zero is not the cause.
- A nonempty family still wins over group 3: even explicit `simsun.ttc` or `simplex.shx`
  with family 宋体 follows the unresolved-family path. Empty group 3 does not mean Standard
  or `$TEXTSTYLE`: FD uses **simplex.shx**, not txt.shx or Standard's Arial.
- The three isolated native FD cases (`arch-1e85a-fd`, `arch-1e8ba-fd`, `arch-1e965-fd`)
  match pixel-for-pixel after removing the renderer's forced 宋体→SimSun alias in plot mode.
  Viewers retain the alias; other localized family aliases have not been tested by this batch.

**VERIFIED-BY-ACAD** (`font-resolution/empty-song-flags0-alt-txt`,
`empty-no-xdata-alt-txt`, `empty-simsun-flags34306-alt-txt`, 2026-10-03): setting FONTALT to
txt.shx **after DXF load** does not replace the already bound simplex font. The Latin-only
unresolved/empty-file plots still match simplex exactly; resolved SimSun remains SimSun.
This does not prove what a fresh profile with FONTALT=txt.shx *before load* would do.

**VERIFIED-BY-ACAD** (`font-resolution/empty-unknown-family`, `empty-song-*`,
`file-simplex-song-*`, `file-simsun-song-flags0`, `file-simplex`, `file-txt`, `missing-shx`,
2026-10-03): an unresolved TrueType STYLE retains **Unicode linking in TEXT** after SHX
substitution: Latin uses simplex, CJK uses filled SimSun glyphs. Explicit SHX TEXT instead
draws question marks for these missing characters. The PDF embeds SimSun and records the
entire `弱电井 冷媒` span, including a SimSun space (half the CJK advance), at SimSun's own
cap-height scale. The same linked span occurs in MTEXT. Preserve that space when both
neighbors link to the same fallback font; keep ordinary SHX spaces outside such a span.
The implementation confines this new linking path to plot-mode unresolved-family styles.
The six mixed-family cases improve to F1(r=1)=1.0 (3701 exact mismatches, raster fringes).

**VERIFIED-BY-ACAD** (`font-resolution/simplex-missing-bigfont`, `missing-shx-bigfont`,
2026-10-03): TEXT and Latin MTEXT disappear, but CJK MTEXT still links to SimSun (also embedded
in the PDF). Current whole-entity MTEXT suppression misses this exception. It remains open;
it is not responsible for the arch-cn bottom labels, whose bigfont is available.

### 15.2. Remaining CJK fringes

**VERIFIED-BY-ACAD** (`font-resolution/arch-1e85a-cjk[-unclipped]`,
`arch-1e8ba-cjk[-unclipped]`, `arch-1e965-cjk[-unclipped]`, 2026-10-03): isolated native text
reproduces the corpus fringes without proxies. The first two cases' PDFs explicitly embed
SimSun. Their mismatch is therefore not a missing-family or missing-bigfont substitution.
The third uses the available simplex/GBCBIG pair and has much smaller stroke fringes.

SimSun clipped probes: 3871 / 1136 exact mismatches; unclipped: 5666 / 7336. Whole-image
translation reduces these counts but the best vertical shift changes with the plot window:
clipped wants (1,−1) px, unclipped (1,0). GBCBIG clipped/unclipped wants zero shift (156/191
pixels differ). Do not hard-code a corpus offset or globally shift glyphs on this evidence.
Q-0737 remains open for controlled anchor-phase, em-size and large-coordinate probes.
