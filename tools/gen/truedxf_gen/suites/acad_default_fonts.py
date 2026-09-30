"""AutoCAD-shipped SHX fonts and shapes (FONTS.md "AutoCAD-shipped SHX fonts"; notes 04 §1.4,
§1.6, §4.2-4.4, §5; 06 §2.2-2.3; 03 §3.16). Compared tolerantly (fonts="acad").

Only txt/simplex/romans/isocp/amgdt/ltypeshp/bigfont/chineset/extfont are used. Facts read from
the installed files (2026-09-30): txt/simplex/romans/isocp/amgdt are *unifont* (Unicode) fonts,
not non-Unicode "shapes" fonts; bigfont.shx and extfont.shx are Shift-JIS (cp932) bigfonts,
chineset.shx is a Big5 (cp950) bigfont; ltypeshp.shx shapes: 130 TRACK1, 131 ZIG, 132 BOX,
133 CIRC1, 134 BAT, 135 AMZIGZAG; unifont code-7 subshape numbers are stored big-endian
(txt.shx glyph 0x80 -> subshape bytes 20 AC).
"""

from __future__ import annotations

from ..core import SuiteBuilder, suite
from ..resources import ACAD_SHX_FONTS, TTF_FONTS
from ._fileformat_util import Tags, replace_bytes, tagfilter

SHX = {n.split(".")[0]: n for n in ACAD_SHX_FONTS}
TEXT_FONTS = ["txt", "simplex", "romans", "isocp", "amgdt"]
W = ((0, 0), (200, 150))
SHAPES = {"TRACK1": 130, "ZIG": 131, "BOX": 132, "CIRC1": 133, "BAT": 134, "AMZIGZAG": 135}

# acad.lin shape linetypes x25.4 (acadiso.lin style); shape given by number for ezdxf's compiler
SHAPE_LTYPES = {
    "FENCELINE1": ("Fenceline circle ----0-----0----0-----0----0-----0--", "A,6.35,-2.54,[133,ltypeshp.shx,x=-2.54,s=2.54],-2.54,25.4", 36.83),
    "FENCELINE2": ("Fenceline square ----[]-----[]----[]-----[]----[]---", "A,6.35,-2.54,[132,ltypeshp.shx,x=-2.54,s=2.54],-2.54,25.4", 36.83),
    "TRACKS": ("Tracks -|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-", "A,3.81,[130,ltypeshp.shx,s=6.35],3.81", 7.62),
    "BATTING": ("Batting SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS",
                "A,0.0001,-2.54,[134,ltypeshp.shx,x=-2.54,s=2.54],-5.08,[134,ltypeshp.shx,r=180,x=2.54,s=2.54],-2.54", 10.1601),
    "ZIGZAG": ("Zig zag /\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\",
               "A,0.0001,-5.08,[131,ltypeshp.shx,x=-5.08,s=5.08],-10.16,[131,ltypeshp.shx,r=180,x=5.08,s=5.08],-5.08", 20.3201),
}


def _st(c, font: str, bigfont: str = "", width: float = 1.0, oblique: float = 0.0, name: str = "") -> str:
    nm = name or (font + ("-" + bigfont if bigfont else "") + ("-w%g" % width if width != 1 else "") + ("-o%g" % oblique if oblique else "")).upper()
    return c.style(nm.replace(".", "_"), font=SHX.get(font, font), bigfont=SHX.get(bigfont, bigfont), width=width, oblique=oblique)


def _cross(c, x, y, r=2.0):
    c.msp.add_line((x - r, y), (x + r, y), dxfattribs={"color": 8})
    c.msp.add_line((x, y - r), (x, y + r), dxfattribs={"color": 8})


@suite("acad-default-fonts", "AutoCAD-shipped SHX fonts, bigfonts, SHAPE entities, shape linetypes, TOLERANCE (tolerant compare)",
       fonts="acad", layer0_lineweight=0,
       description="Uses the AutoCAD-installed SHX files listed in tools/gen/FONTS.md; truedxf only renders these when pointed at an AutoCAD install.")
def build(s: SuiteBuilder) -> None:
    _samples(s)
    _special_codes(s)
    _alignment(s)
    _vertical(s)
    _geometry(s)
    _resolution(s)
    _bigfonts(s)
    _shapes(s)
    _linetypes(s)
    _tolerance(s)


# --------------------------------------------------------------------------------------------


def _samples(s: SuiteBuilder) -> None:
    for f in TEXT_FONTS:
        c = s.case(f"sample-{f}", f"TEXT sample lines in {f}.shx (upper, lower, digits, punctuation) h=10", tags=["TEXT", "SHX"], params={"font": f})
        st = _st(c, f)
        for i, line in enumerate(["ABCDEFGHIJKLM", "NOPQRSTUVWXYZ", "abcdefghijklm", "nopqrstuvwxyz", "0123456789", "!\"#$&'()*+,-./:;<=>?@[]_{|}~"]):
            c.msp.add_text(line, height=10, dxfattribs={"style": st, "insert": (10, 130 - i * 22)})
        c.window(*W)
    for f in ("txt", "romans"):
        for w, obl in ((1.0, 15.0), (1.0, -15.0), (0.7, 0.0)):
            c = s.case(f"style-{f}-w{w:g}-o{obl:g}".replace(".", "p").replace("-o-", "-om"), f"{f}.shx STYLE width {w:g} oblique {obl:g}: TEXT 'OSC Hxg 0369'",
                       tags=["TEXT", "SHX", "width", "oblique"], params={"font": f, "width": w, "oblique": obl})
            st = _st(c, f, width=w, oblique=obl)
            c.msp.add_text("OSC Hxg 0369", height=18, dxfattribs={"style": st, "insert": (15, 60)})
            _cross(c, 15, 60)
            c.window(*W)
    c = s.case("mtext-shx-fonts", "MTEXT switching fonts inline: \\Ftxt.shx; \\Fsimplex.shx; \\Fromans.shx; \\Fisocp.shx;", tags=["MTEXT", "SHX"])
    c.msp.add_mtext("\\Ftxt.shx;TXT Hxg 123\\P\\Fsimplex.shx;SIMPLEX Hxg 123\\P\\Fromans.shx;ROMANS Hxg 123\\P\\Fisocp.shx;ISOCP Hxg 123",
                    dxfattribs={"insert": (10, 140), "char_height": 10, "width": 180})
    c.window(*W)
    c = s.case("mtext-shx-style", "MTEXT in a romans.shx STYLE with \\H, \\W, \\Q and \\T inline codes", tags=["MTEXT", "SHX"])
    st = _st(c, "romans")
    c.msp.add_mtext("Plain romans\\P{\\H1.5x;Height 1.5x}\\P{\\W0.6;Width 0.6}\\P{\\Q20;Oblique 20}\\P{\\T2;Track 2}",
                    dxfattribs={"insert": (10, 140), "char_height": 10, "width": 180, "style": st})
    c.window(*W)


def _special_codes(s: SuiteBuilder) -> None:
    for f in TEXT_FONTS:
        c = s.case(f"special-{f}", f"{f}.shx: %%c vs \\U+00D8 vs \\U+2205, %%d vs \\U+00B0, %%p vs \\U+00B1, %%% (rows) h=14", tags=["TEXT", "SHX", "special-codes"],
                   questions=["Q-0385"], params={"font": f})
        st = _st(c, f)
        rows = [("%%c", "\\U+00D8", "\\U+2205"), ("%%d", "\\U+00B0", "%%176"), ("%%p", "\\U+00B1", "%%177"), ("%%%", "%%u under%%u", "%%o over%%o")]
        for r, row in enumerate(rows):
            for k, txt in enumerate(row):
                c.msp.add_text(txt, height=14, dxfattribs={"style": st, "insert": (15 + k * 62, 120 - r * 32)})
                _cross(c, 15 + k * 62, 120 - r * 32, 1.5)
        c.window(*W)
    for f in ("txt", "simplex"):
        c = s.case(f"percent-nnn-{f}", f"R2004 ANSI_1252 TEXT '%%176%%065%%248' vs raw cp1252 bytes B0 41 F8 in {f}.shx (unifont: code point or byte?)",
                   tags=["TEXT", "SHX", "special-codes", "encoding"], dxfversion="R2004", header={"$DWGCODEPAGE": "ANSI_1252"}, params={"font": f})
        st = _st(c, f)
        c.msp.add_text("%%176%%065%%248", height=16, dxfattribs={"style": st, "insert": (20, 95)})
        c.msp.add_text("RAWPH", height=16, dxfattribs={"style": st, "insert": (20, 45)})
        c.byte_filters.append(replace_bytes(b"\nRAWPH\n", b"\n\xb0A\xf8\n"))
        c.allow_audit_errors = True
        c.window(*W)
        c.notes.append("All AutoCAD 2027 text SHX fonts in FONTS.md are unifont; the non-Unicode 'shapes' behaviour (Q-0381/Q-0477/Q-0478) needs a test SHX.")
    for f in ("txt", "simplex"):
        c = s.case(f"high-bytes-{f}", f"R2004 ANSI_1252 vs text bytes 0x80-0xFF in {f}.shx (unifont mapping of code-page bytes)", tags=["TEXT", "SHX", "encoding"],
                   dxfversion="R2004", params={"font": f})
        st = _st(c, f)
        for r in range(8):
            c.msp.add_text(f"HB{r}PH", height=7, dxfattribs={"style": st, "insert": (10, 135 - r * 17)})
            c.byte_filters.append(replace_bytes(f"\nHB{r}PH\n".encode(), b"\n" + bytes(range(0x80 + r * 16, 0x90 + r * 16)).replace(b"\x81", b"?")
                                                .replace(b"\x8d", b"?").replace(b"\x8f", b"?").replace(b"\x90", b"?").replace(b"\x9d", b"?") + b"\n"))
        c.allow_audit_errors = True
        c.window(*W)
    for f in ("txt", "simplex"):
        c = s.case(f"missing-glyph-{f}", f"{f}.shx TEXT with characters the font lacks: U+4E2D, U+05D0, U+2603 between A..B (drawn as '?'?)",
                   tags=["TEXT", "SHX", "missing-glyph"], questions=["Q-0476"], params={"font": f})
        st = _st(c, f)
        for i, t in enumerate(["A\u4e2dB", "A\u05d0B", "A\u2603B", "A?B"]):
            c.msp.add_text(t, height=20, dxfattribs={"style": st, "insert": (20 + (i % 2) * 90, 95 - (i // 2) * 50)})
        c.window(*W)


def _alignment(s: SuiteBuilder) -> None:
    halign = {1: "center", 2: "right", 4: "middle"}
    for f in ("txt", "simplex", "romans"):
        for h, hn in halign.items():
            c = s.case(f"align-{hn}-{f}", f"{f}.shx TEXT 72={h} ({hn}) 'A', 'AA', 'CENTER', 'iW.' aligned on x=100 (DXFOUT 10 vs 11: ink box or advance?)",
                       tags=["TEXT", "SHX", "alignment"], questions=["Q-0394"], params={"font": f, "halign": h}, outputs=["png", "pdf", "dxf"])
            st = _st(c, f)
            c.msp.add_line((100, 5), (100, 145), dxfattribs={"color": 8})
            for i, t in enumerate(["A", "AA", "CENTER", "iW."]):
                y = 120 - i * 32
                e = c.msp.add_text(t, height=20, dxfattribs={"style": st})
                e.dxf.halign = h
                e.dxf.valign = 0 if h != 4 else 0
                e.dxf.insert = (100, y)
                e.dxf.align_point = (100, y)
            c.window(*W)
    for f in ("txt", "simplex"):
        for h, hn in ((3, "aligned"), (5, "fit")):
            c = s.case(f"align-{hn}-{f}", f"{f}.shx TEXT 72={h} ({hn}) 'A' and 'AA' between x=40 and x=160 (stretch to ink or advance?)",
                       tags=["TEXT", "SHX", "alignment"], questions=["Q-0397"], params={"font": f, "halign": h}, outputs=["png", "pdf", "dxf"])
            st = _st(c, f)
            for x in (40, 160):
                c.msp.add_line((x, 5), (x, 145), dxfattribs={"color": 8})
            for i, t in enumerate(["A", "AA", "AAAA"]):
                y = 110 - i * 40
                e = c.msp.add_text(t, height=15, dxfattribs={"style": st})
                e.dxf.halign = h
                e.dxf.insert = (40, y)
                e.dxf.align_point = (160, y)
            c.window(*W)


def _vertical(s: SuiteBuilder) -> None:
    combos = {
        "baseline": [(0, 0), (1, 0), (2, 0)],
        "bottom": [(0, 1), (1, 1), (2, 1)],
        "middle": [(0, 2), (1, 2), (2, 2)],
        "top": [(0, 3), (1, 3), (2, 3)],
        "special": [(4, 0), (3, 0), (5, 0)],
    }
    for n, lst in combos.items():
        c = s.case(f"vertical-{n}", f"Vertical txt.shx STYLE (flag 4): TEXT 'ABC' h=12 with (72,73) = {lst}", tags=["TEXT", "SHX", "vertical"],
                   questions=["Q-0400"], params={"combos": lst}, outputs=["png", "pdf", "dxf"])
        st = _st(c, "txt", name="TXT-VERTICAL")
        c.doc.styles.get(st).dxf.flags = 4
        for k, (h, v) in enumerate(lst):
            x, y = 40 + k * 60, 75
            e = c.msp.add_text("ABC", height=12, dxfattribs={"style": st})
            e.dxf.halign = h
            e.dxf.valign = v
            e.dxf.insert = (x, y)
            e.dxf.align_point = (x, y) if h not in (3, 5) else (x, y - 50)
            _cross(c, x, y)
        c.window(*W)


def _geometry(s: SuiteBuilder) -> None:
    for f in ("txt", "romans"):
        for w in (0.5, 1.0, 2.0):
            c = s.case(f"widthfactor-{f}-{w:g}".replace(".", "p"), f"TEXT 'OSC03' in {f}.shx with width factor {w:g} (arcs scaled into ellipses?)",
                       tags=["TEXT", "SHX", "width"], questions=["Q-0403"], params={"font": f, "width": w}, outputs=["png", "pdf", "dxf"])
            st = _st(c, f, width=w)
            c.msp.add_text("OSC03", height=30 if w < 2 else 22, dxfattribs={"style": st, "insert": (10, 60)})
            c.window(*W)
    for f in ("txt", "simplex", "romans"):
        c = s.case(f"pen-rounding-9amp-{f}", f"{f}.shx '9&' at h=60 (fractional arcs: pen position on the integer grid?)", tags=["TEXT", "SHX", "arcs"],
                   questions=["Q-0474"], params={"font": f}, outputs=["png", "pdf", "dxf"])
        st = _st(c, f)
        c.msp.add_text("9&", height=60, dxfattribs={"style": st, "insert": (40, 40)})
        c.msp.add_line((20, 40), (180, 40), dxfattribs={"color": 8})
        c.window(*W)
        c = s.case(f"charset-{f}", f"{f}.shx all code points 32..255 in rows of 16 (h=6)", tags=["TEXT", "SHX", "charset"], questions=["Q-0474", "Q-0476"],
                   params={"font": f})
        st = _st(c, f)
        for r, start in enumerate(range(32, 256, 16)):
            chars = "".join(chr(k) for k in range(start, start + 16) if not (127 <= k < 160))
            if chars:
                c.msp.add_text(chars.replace("%", "%%%").replace("^", "^ "), height=6, dxfattribs={"style": st, "insert": (8, 140 - r * 10)})
        c.window(*W)
    for f in ("simplex", "romans"):
        c = s.case(f"arc-tessellation-o-{f}", f"{f}.shx 'O' at h=120 (arc tessellation in PLOT)", tags=["TEXT", "SHX", "arcs"], questions=["Q-0475"], params={"font": f},
                   outputs=["png", "pdf"])
        st = _st(c, f)
        c.msp.add_text("O", height=120, dxfattribs={"style": st, "insert": (60, 15)})
        c.window(*W)
        c = s.case(f"arc-tessellation-o-{f}-zoom", f"{f}.shx 'O' at h=120, window 40x30 units on its left flank (50 px/unit)", tags=["TEXT", "SHX", "arcs"],
                   questions=["Q-0475"], params={"font": f}, outputs=["png", "pdf"])
        st = _st(c, f)
        c.msp.add_text("O", height=120, dxfattribs={"style": st, "insert": (60, 15)})
        c.window((50, 60), (90, 90))
    c = s.case("subshape-code7", "Glyphs built from code-7 subshapes: amgdt 'dfghjknrt', isocp 'ÀÄÖÑØ', txt/simplex '€' (code-7 byte order)",
               tags=["TEXT", "SHX", "subshape"], questions=["Q-0473"])
    rows = [("amgdt", "dfghjknrt"), ("isocp", "ÀÄÖÑØ"), ("txt", "€ \u20a0"), ("simplex", "€ \u2104 \u214a")]
    for i, (f, t) in enumerate(rows):
        c.msp.add_text(t, height=20, dxfattribs={"style": _st(c, f), "insert": (15, 118 - i * 34)})
    c.window(*W)
    for lw_on in (True, False):
        c = s.case(f"lineweight-shx-vs-ttf-{'on' if lw_on else 'off'}", f"TEXT in txt.shx and Liberation Sans on layers with lineweight 0 / 0.70 / 1.00 mm, plot lineweights {'on' if lw_on else 'off'}",
                   tags=["TEXT", "SHX", "lineweight"], questions=["Q-0491"], params={"plot_lineweights": lw_on})
        txt = _st(c, "txt")
        ttf = c.style("LIBSANS", font=TTF_FONTS["sans"])
        for i, lw in enumerate((0, 70, 100)):
            ln = c.layer(f"LW{lw:03d}", lineweight=lw)
            c.msp.add_text(f"SHX {lw / 100:.2f}", height=14, dxfattribs={"style": txt, "layer": ln, "insert": (10, 120 - i * 45)})
            c.msp.add_text(f"TTF {lw / 100:.2f}", height=14, dxfattribs={"style": ttf, "layer": ln, "insert": (105, 120 - i * 45)})
        c.plot.lineweights = lw_on
        c.window(*W)


def _resolution(s: SuiteBuilder) -> None:
    names = [("txt", "txt"), ("simplex-upper", "SIMPLEX"), ("romans-shx-upper", "ROMANS.SHX"), ("romans-quoted", '"romans.shx"'),
             ("isocp-noext", "isocp"), ("liberation-noext", "LiberationSans-Regular"), ("txt-path", "C:\\nope\\txt.shx")]
    for n, font in names:
        c = s.case(f"font-name-{n}", f"STYLE group 3 = {font!r}; TEXT 'Hxg 0123 ABC' (how does AutoCAD resolve it?)", tags=["STYLE", "font-resolution"],
                   questions=["Q-0462"], params={"font": font})
        c.style("RESOLVE", font="txt.shx")
        c.msp.add_text("Hxg 0123 ABC", height=20, dxfattribs={"style": "RESOLVE", "insert": (15, 65)})
        c.byte_filters.append(tagfilter(lambda t, font=font: _set_style_font(t, "RESOLVE", font)))
        c.window(*W)
    for n, font, family in (("shx", "nosuch.shx", None), ("ttf", "nosuch.ttf", "NoSuchFamily")):
        c = s.case(f"missing-font-{n}", f"STYLE font {font!r}{' + XDATA family ' + repr(family) if family else ''}: TEXT and MTEXT 'HELLO AAxg' (FONTALT substitute?)",
                   tags=["STYLE", "missing-font"], questions=["Q-0463", "Q-0464"], params={"font": font})
        st = c.style("MISSING", font=font)
        if family:
            c.doc.styles.get(st).set_xdata("ACAD", [(1000, family), (1071, 34)])
        c.msp.add_text("HELLO AAxg", height=18, dxfattribs={"style": st, "insert": (15, 95)})
        c.msp.add_mtext("HELLO AAxg", dxfattribs={"style": st, "insert": (15, 60), "char_height": 18, "width": 170})
        c.window(*W)
    c = s.case("mtext-f-missing", "MTEXT '\\FNoSuchFont.shx;HELLO' and '\\fNoSuchFamily|b0|i0|c0|p34;HELLO' (missing inline fonts)", tags=["MTEXT", "missing-font"],
               questions=["Q-0418", "Q-0463"])
    c.msp.add_mtext("\\FNoSuchFont.shx;HELLO SHX\\P\\fNoSuchFamily|b0|i0|c0|p34;HELLO TTF", dxfattribs={"insert": (15, 110), "char_height": 18, "width": 170})
    c.window(*W)


def _set_style_font(t: Tags, style: str, font: str) -> None:
    a, b = t.table("STYLE")
    i = t.must(2, style, a, b)
    j = t.must(3, None, i, t.next0(i))
    t.set(j, font.encode("latin-1"))


def _bigfonts(s: SuiteBuilder) -> None:
    jp = "日本"   # present in bigfont.shx (cp932 93FA 967B)
    for main, big in (("txt", "bigfont"), ("romans", "bigfont"), ("txt", "extfont"), ("txt", "chineset")):
        c = s.case(f"bigfont-{main}-{big}-r2018", f"R2018 (UTF-8) TEXT 'AB{jp if big != 'chineset' else '中文'}' h=20 in STYLE {main}.shx + bigfont {big}.shx",
                   tags=["TEXT", "SHX", "bigfont"], questions=["Q-0467"], params={"font": main, "bigfont": big})
        st = _st(c, main, big)
        t = "AB" + (jp if big != "chineset" else "中文")
        c.msp.add_text(t, height=20, dxfattribs={"style": st, "insert": (20, 90)})
        c.msp.add_text("AB", height=20, dxfattribs={"style": _st(c, main), "insert": (20, 40)})
        c.msp.add_line((10, 90), (190, 90), dxfattribs={"color": 8})
        c.window(*W)
    for cp, enc, big, text in (("ANSI_932", "cp932", "bigfont", "AB日本"), ("ANSI_950", "cp950", "chineset", "AB中文")):
        c = s.case(f"bigfont-native-{cp.lower().replace('_', '-')}", f"R2004 {cp} TEXT with native DBCS bytes '{text}' vs the same as \\M+ escapes, STYLE txt.shx + {big}.shx",
                   tags=["TEXT", "SHX", "bigfont", "encoding"], questions=["Q-0070", "Q-0467"], dxfversion="R2004", header={"$DWGCODEPAGE": cp})
        st = _st(c, "txt", big)
        mif = "AB" + "".join("\\M+%d%s" % ({"ANSI_932": 1, "ANSI_950": 2}[cp], ch.encode(enc).hex().upper()) for ch in text[2:])
        c.msp.add_text("NATIVEPH", height=20, dxfattribs={"style": st, "insert": (20, 95)})
        c.msp.add_text(mif, height=20, dxfattribs={"style": st, "insert": (20, 45)})
        c.byte_filters.append(replace_bytes(b"\nNATIVEPH\n", b"\n" + text.encode(enc) + b"\n"))
        c.allow_audit_errors = True
        c.params["mif"] = mif
        c.window(*W)
    c = s.case("bigfont-missing", "STYLE txt.shx + bigfont 'nosuchbig.shx': TEXT 'ABC' and DBCS TEXT 'AB日本'", tags=["TEXT", "SHX", "bigfont", "missing-font"],
               questions=["Q-0466"])
    st = c.style("NOBIG", font="txt.shx", bigfont="nosuchbig.shx")
    c.msp.add_text("ABC", height=20, dxfattribs={"style": st, "insert": (20, 95)})
    c.msp.add_text("AB日本", height=20, dxfattribs={"style": st, "insert": (20, 45)})
    c.window(*W)
    for n, big in (("romans", ""), ("romans-chineset", "chineset")):
        c = s.case(f"cjk-r2004-{n}", f"AC1018 ANSI_950 TEXT '中文' (Big5 bytes) in STYLE romans.shx{' + chineset.shx' if big else ' without bigfont'}",
                   tags=["TEXT", "SHX", "bigfont", "encoding"], questions=["Q-0468"], dxfversion="R2004", header={"$DWGCODEPAGE": "ANSI_950"})
        st = _st(c, "romans", big)
        c.msp.add_text("CJKPH", height=30, dxfattribs={"style": st, "insert": (30, 60)})
        c.byte_filters.append(replace_bytes(b"\nCJKPH\n", b"\nAB" + "中文".encode("cp950") + b"\n"))
        c.allow_audit_errors = True
        c.window(*W)
    # \M+ escapes (Q-0068, Q-0069)
    for kind in ("text", "mtext"):
        c = s.case(f"mif-r2004-{kind}", f"R2004 ANSI_1252 {kind.upper()} 'A\\M+182A0B' (cp932 hiragana) in STYLE txt.shx + bigfont.shx (decoded at load or shown literally?)",
                   tags=[kind.upper(), "SHX", "bigfont", "\\M+"], questions=["Q-0068"], dxfversion="R2004")
        st = _st(c, "txt", "bigfont")
        if kind == "text":
            c.msp.add_text("A\\M+182A0B", height=20, dxfattribs={"style": st, "insert": (20, 70)})
        else:
            c.msp.add_mtext("A\\M+182A0B", dxfattribs={"style": st, "insert": (20, 90), "char_height": 20, "width": 160})
        c.window(*W)
    for n, big in (("bigfont", "bigfont"), ("ttf", "")):
        c = s.case(f"mif-r2018-mtext-{n}", f"R2018 MTEXT 'A\\M+193FAB' (cp932 '日') in STYLE {'txt.shx + bigfont.shx' if big else 'Liberation Sans'} (is \\M+ decoded in UTF-8 files?)",
                   tags=["MTEXT", "bigfont", "\\M+"], questions=["Q-0069"])
        st = _st(c, "txt", big) if big else c.style("LIBSANS", font=TTF_FONTS["sans"])
        c.msp.add_mtext("A\\M+193FAB", dxfattribs={"style": st, "insert": (20, 90), "char_height": 20, "width": 160})
        c.window(*W)
    c = s.case("mtext-f-shx-bigfont", "MTEXT '\\Fromans.shx,bigfont.shx;AB\\M+193FA' and '\\Ftxt,bigfont;AB日本' (inline font with ',bigfont' suffix)",
               tags=["MTEXT", "SHX", "bigfont"], questions=["Q-0418"])
    c.msp.add_mtext("\\Fromans.shx,bigfont.shx;AB\\M+193FA\\P\\Ftxt,bigfont;AB日本", dxfattribs={"insert": (15, 110), "char_height": 20, "width": 170})
    c.window(*W)
    for mode in ("ez", "nb"):
        c = s.case(f"diameter-dim-bigfont-{mode}", "Diametric DIMENSION whose text style is romans.shx + chineset.shx (auto text %%c: which glyph?) — "
                   + ("ezdxf-rendered block" if mode == "ez" else "no *D block, AutoCAD regenerates"), tags=["DIMENSION", "SHX", "bigfont"], questions=["Q-0469"],
                   outputs=["png", "pdf", "dxf"])
        st = _st(c, "romans", "chineset")
        c.msp.add_circle((100, 75), 40)
        dso = c.msp.add_diameter_dim(center=(100, 75), radius=40, angle=30, override={"dimtxsty": st, "dimtxt": 8, "dimasz": 5})
        if mode == "ez":
            dso.render()
        else:
            dso.commit()
            c.allow_audit_errors = True
        c.window(*W)


def _shapes(s: SuiteBuilder) -> None:
    for size in (1, 10, 25):
        c = s.case(f"shape-size-{size}", f"SHAPE entities BOX, CIRC1, ZIG, TRACK1, BAT from ltypeshp.shx at size 40 = {size}", tags=["SHAPE", "SHX"],
                   questions=["Q-0482"], params={"size": size})
        c.doc.styles.add_shx("ltypeshp.shx")
        k = 0
        for name in ("BOX", "CIRC1", "ZIG", "TRACK1", "BAT", "AMZIGZAG"):
            x, y = 30 + (k % 3) * 60, 105 - (k // 3) * 60
            c.msp.add_shape(name, (x, y), size=size)
            _cross(c, x, y, 3)
            k += 1
        c.window(*W)
    variants = [("rotation-30", {"rotation": 30}), ("xscale-2", {"xscale": 2}), ("oblique-20", {"oblique": 20}),
                ("extrusion-neg-z", {"extrusion": (0, 0, -1)}), ("thickness-5-plan", {"thickness": 5})]
    for n, attrs in variants:
        c = s.case(f"shape-{n}", f"SHAPE BOX and ZIG (ltypeshp.shx) size 20 with {attrs}", tags=["SHAPE", "SHX"], questions=["Q-0483", "Q-0482"], params=attrs)
        c.doc.styles.add_shx("ltypeshp.shx")
        if "extrusion" in attrs:
            # 10 written as (40, 0) and (40, 40): WCS reading puts the shapes right of x=0, OCS reading
            # (x flipped for (0,0,-1)) puts them left of it; both stay inside the window
            for name, (x, y) in (("BOX", (40, -30)), ("ZIG", (40, 30))):
                c.msp.add_shape(name, (x, y), size=20, dxfattribs=dict(attrs))
                _cross(c, x, y, 3)
                _cross(c, -x, y, 3)
            c.msp.add_line((0, -70), (0, 70), dxfattribs={"color": 8})
            c.window((-100, -75), (100, 75))
            continue
        for name, (x, y) in (("BOX", (60, 75)), ("ZIG", (140, 75))):
            c.msp.add_shape(name, (x, y), size=20, dxfattribs=dict(attrs))
            _cross(c, x, y, 3)
        c.window(*W)
    c = s.case("thickness-text-shape-iso", "TEXT (txt.shx and Liberation) and SHAPE BOX with thickness 5, VPOINT 1,-1,1 viewport (extruded glyphs?)",
               tags=["SHAPE", "TEXT", "thickness", "VIEWPORT"], questions=["Q-0405"])
    c.doc.styles.add_shx("ltypeshp.shx")
    c.msp.add_text("SHX", height=20, dxfattribs={"style": _st(c, "txt"), "insert": (20, 90), "thickness": 5})
    c.msp.add_text("TTF", height=20, dxfattribs={"style": c.style("LIBSANS", font=TTF_FONTS["sans"]), "insert": (110, 90), "thickness": 5})
    c.msp.add_shape("BOX", (100, 40), size=20, dxfattribs={"thickness": 5})
    lay = c.doc.layouts.get("Layout1")
    lay.page_setup(size=(200, 150), margins=(0, 0, 0, 0), units="mm", scale=16, name="truedxf", device="DWG To PDF.pc3")
    vp = lay.add_viewport(center=(100, 75), size=(190, 140), view_center_point=(0, 0), view_height=170)
    vp.dxf.view_target_point = (100, 75, 0)
    vp.dxf.view_direction_vector = (1, -1, 1)
    c.layout_window("Layout1", *W)


def _linetypes(s: SuiteBuilder) -> None:
    def add_lt(c, name, abs_rot=False, scale_override=None, shx="ltypeshp.shx"):
        desc, pat, length = SHAPE_LTYPES[name]
        if shx != "ltypeshp.shx":
            pat = pat.replace("ltypeshp.shx", shx)
        lt_name = name if not (abs_rot or scale_override is not None) else name + "-VAR"
        c.doc.linetypes.add(lt_name, pattern=pat, length=length, description=desc)
        lt = c.doc.linetypes.get(lt_name)
        if abs_rot or scale_override is not None:
            def f(t: Tags, h=lt.dxf.handle):
                s0, e0 = t.entity(h)
                for i in t.find_all(74, None, s0, e0):
                    if abs_rot:
                        t.set(i, str(int(t.value(i)) | 1))
                for i in t.find_all(46, None, s0, e0):
                    if scale_override is not None:
                        t.set(i, repr(float(scale_override)))
            c.byte_filters.append(tagfilter(f))
        return lt_name

    def geometry(c, lt, ltscale=1.0):
        a = {"linetype": lt, "ltscale": ltscale}
        c.msp.add_line((15, 130), (185, 130), dxfattribs=a)
        c.msp.add_line((15, 20), (80, 105), dxfattribs=a)
        c.msp.add_arc((135, 60), 40, 0, 180, dxfattribs=a)
        c.msp.add_lwpolyline([(95, 15), (185, 15), (185, 45)], dxfattribs=a)

    for name in SHAPE_LTYPES:
        for lts in (1.0, 2.0):
            c = s.case(f"ltype-{name.lower()}-ltscale{lts:g}", f"Shape linetype {name} (ltypeshp.shx, acadiso values) on LINE/ARC/LWPOLYLINE, entity ltscale {lts:g}",
                       tags=["LTYPE", "complex-linetype", "SHAPE"], questions=["Q-0326", "Q-0323"], params={"linetype": name, "ltscale": lts})
            geometry(c, add_lt(c, name), lts)
            c.window(*W)
    c = s.case("ltype-zigzag-absolute-rotation", "ZIGZAG with 74 bit 1 set (absolute shape rotation) on LINE/ARC/LWPOLYLINE", tags=["LTYPE", "complex-linetype", "SHAPE"],
               questions=["Q-0326", "Q-0323"])
    geometry(c, add_lt(c, "ZIGZAG", abs_rot=True), 2.0)
    c.window(*W)
    for n, sc in (("zero", 0.0), ("negative", -2.54)):
        c = s.case(f"ltype-fenceline2-scale-{n}", f"FENCELINE2 with shape scale 46 = {sc} (zero/negative shape scale)", tags=["LTYPE", "complex-linetype", "SHAPE"],
                   questions=["Q-0328"], params={"shape_scale": sc})
        geometry(c, add_lt(c, "FENCELINE2", scale_override=sc), 2.0)
        c.window(*W)
    c = s.case("ltype-fenceline1-plinegen", "FENCELINE1 on a 2D LWPOLYLINE zig-zag with PLINEGEN 0 and 1 (two polylines)", tags=["LTYPE", "complex-linetype", "PLINEGEN"],
               questions=["Q-0326"])
    lt = add_lt(c, "FENCELINE1")
    c.msp.add_lwpolyline([(15, 110), (55, 140), (95, 110), (135, 140), (185, 110)], dxfattribs={"linetype": lt, "ltscale": 1.5})
    p = c.msp.add_lwpolyline([(15, 40), (55, 70), (95, 40), (135, 70), (185, 40)], dxfattribs={"linetype": lt, "ltscale": 1.5})
    p.dxf.flags |= 128
    c.window(*W)


def _tolerance(s: SuiteBuilder) -> None:
    rows = [
        ("one-row", "{\\Famgdt;j}%%v{\\Famgdt;n}0.05{\\Famgdt;m}%%vA%%vB%%vC", ["Q-0602"]),
        ("two-rows", "{\\Famgdt;j}%%v{\\Famgdt;n}0.05%%vA^J{\\Famgdt;u}%%v0.02%%vB", ["Q-0602"]),
        ("composite", "{\\Famgdt;j}%%v{\\Famgdt;n}0.2%%vA%%vB^J{\\Famgdt;j}%%v{\\Famgdt;n}0.05%%vA", ["Q-0604"]),
        ("projected-datum", "{\\Famgdt;j}%%v0.1%%vA^J^J5{\\Famgdt;p}^JA", ["Q-0603"]),
    ]
    for n, content, qs in rows:
        c = s.case(f"tolerance-{n}", f"TOLERANCE frame '{n}' with amgdt.shx symbols (\\Famgdt;), DIMTXT 5", tags=["TOLERANCE", "SHX", "amgdt"], questions=qs,
                   params={"content": content}, outputs=["png", "pdf", "dxf"])
        ds = c.doc.dimstyles.new("TOL")
        ds.dxf.dimtxt = 5
        ds.dxf.dimgap = 1.25
        c.msp.new_entity("TOLERANCE", dxfattribs={"dimstyle": "TOL", "insert": (20, 100), "content": content, "x_axis_vector": (1, 0, 0)})
        _cross(c, 20, 100)
        c.window(*W)
