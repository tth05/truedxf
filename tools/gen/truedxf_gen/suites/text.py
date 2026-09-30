"""TEXT: alignment (72/73 incl. ALIGNED/FIT/MIDDLE), rotation, width factor, oblique, mirror
flags, heights (cap-height rule), special codes (%%c %%d %%p %%u %%o %%k %%nnn), \\U+ / \\M+
escapes, caret codes, encodings, TTF fallback glyphs, STYLE XDATA bold/italic (note 04 §1, §4.1,
§4.5, §5; 01 §1.5, §5; 02 §2.3). TrueType fonts only (FONTS.md); SHX cases live in
acad-default-fonts.

Non-left TEXT stores a first alignment point 10 computed with AutoCAD's measured TTF rules
(``_text_util``), so the fixtures are consistent whether AutoCAD places the text from 11 or 10;
the AutoCAD re-save (DXFOUT) of the alignment cases gives AutoCAD's own 10 as an oracle.
"""

from __future__ import annotations

import math

from ..core import SuiteBuilder, suite
from ..resources import TTF_FONTS
from ._text_util import (
    ALIGN,
    ALIGN_NAMES,
    GRID_ALIGNS,
    add_text,
    cross,
    placement,
    r,
    ref_layer,
)

W0, W1 = (0, 0), (200, 150)
C = (100.0, 75.0)
ALIGN_TEXT = "HxgÅ"

# style name per FONTS.md alias
STYLE_OF = {
    "sans": "Standard",
    "sans-bold": "SANS_BOLD",
    "sans-italic": "SANS_ITALIC",
    "sans-bolditalic": "SANS_BOLDITALIC",
    "lato": "LATO",
    "lato-bold": "LATO_BOLD",
    "mono": "MONO",
}


def _style(c, font: str) -> str:
    name = STYLE_OF[font]
    if name != "Standard":
        c.style(name, font=TTF_FONTS[font])
    return name


def _slug(align: str) -> str:
    return align.lower().replace("_", "-")


def _hline(c, y: float, x0: float = 5, x1: float = 195) -> None:
    c.msp.add_line((x0, y), (x1, y), dxfattribs={"layer": "REF"})


def _vline(c, x: float, y0: float = 5, y1: float = 145) -> None:
    c.msp.add_line((x, y0), (x, y1), dxfattribs={"layer": "REF"})


def _new(s: SuiteBuilder, name: str, title: str, tags, questions=(), **kw):
    c = s.case(name, title, tags=list(tags), questions=list(questions), **kw)
    ref_layer(c)
    return c


@suite(
    "text",
    "TEXT: alignment, rotation, width/oblique, mirror flags, heights, special codes, encodings, TTF fonts",
    layer0_lineweight=0,
)
def build(s: SuiteBuilder) -> None:
    _alignment(s)
    _fonts_alignment(s)
    _fit_aligned(s)
    _derived_points(s)
    _mirror_flags(s)
    _width_oblique(s)
    _heights(s)
    _characters(s)
    _encodings(s)
    _fallback(s)
    _spaces(s)
    _styles(s)
    _misc(s)
    _random(s)


# ---------------------------------------------------------------------------------------------
# alignment matrix


def _alignment(s: SuiteBuilder) -> None:
    for rot in (0, 30, 135):
        for al in ALIGN_NAMES:
            h72, v73 = ALIGN[al]
            qs = ["Q-0484"]
            if al in ("MIDDLE", "MIDDLE_CENTER"):
                qs.append("Q-0392")
            if v73 == 1:
                qs.append("Q-0393")
            if al in ("FIT", "ALIGNED"):
                qs.append("Q-0396")
            c = _new(
                s,
                f"align-{_slug(al)}-r{rot:03d}",
                f"TEXT '{ALIGN_TEXT}' h=20 Liberation Sans, {al} (72={h72} 73={v73}), rotation {rot}, cross at 11",
                ["TEXT", "alignment", "rotation"],
                qs,
                params={"align": al, "halign": h72, "valign": v73, "rotation": rot, "height": 20},
            )
            if al in ("FIT", "ALIGNED"):
                a = math.radians(rot)
                d = (60 * math.cos(a), 60 * math.sin(a))
                p1 = (r(C[0] - d[0]), r(C[1] - d[1]))
                p2 = (r(C[0] + d[0]), r(C[1] + d[1]))
                add_text(c.msp, ALIGN_TEXT, p1, align=al, h=20, p2=p2)
                cross(c.msp, p1)
                cross(c.msp, p2)
            else:
                add_text(c.msp, ALIGN_TEXT, C, align=al, h=20, rotation=rot)
                cross(c.msp, C)
            c.window(W0, W1)


def _fonts_alignment(s: SuiteBuilder) -> None:
    # Bottom (73=1) offset = font descent: LEFT vs BOTTOM_LEFT side by side on one reference line
    for font in STYLE_OF:
        c = _new(
            s,
            f"bottom-{font}",
            f"TEXT 'Hxg' h=20 {TTF_FONTS[font]}: LEFT at x=20 and BOTTOM_LEFT (73=1) at x=110, both anchored on y=75",
            ["TEXT", "alignment", "font-metrics"],
            ["Q-0393", "Q-0484"],
            params={"font": TTF_FONTS[font]},
        )
        st = _style(c, font)
        add_text(c.msp, "Hxg", (20, 75), align="LEFT", h=20, font=font, style=st)
        add_text(c.msp, "Hxg", (110, 75), align="BOTTOM_LEFT", h=20, font=font, style=st)
        _hline(c, 75)
        cross(c.msp, (20, 75))
        cross(c.msp, (110, 75))
        c.window(W0, W1)
    # 72=4 MIDDLE vs MIDDLE_CENTER
    for font in ("sans", "lato", "mono"):
        for sname, txt in (("xxx", "xxx"), ("xxx-upper", "XXX"), ("gjpqy", "gjpqy")):
            c = _new(
                s,
                f"middle-{font}-{sname}",
                f"TEXT '{txt}' h=20 {TTF_FONTS[font]}: MIDDLE (72=4) at x=55 vs MIDDLE_CENTER (72=1 73=2) at x=145 on y=75",
                ["TEXT", "alignment", "MIDDLE"],
                ["Q-0392"],
                params={"font": TTF_FONTS[font], "text": txt},
            )
            st = _style(c, font)
            add_text(c.msp, txt, (55, 75), align="MIDDLE", h=20, font=font, style=st)
            add_text(c.msp, txt, (145, 75), align="MIDDLE_CENTER", h=20, font=font, style=st)
            _hline(c, 75)
            cross(c.msp, (55, 75))
            cross(c.msp, (145, 75))
            c.window(W0, W1)
    # horizontal box of Center/Right/Middle (advance vs ink); vertical line through 11
    for i, txt in enumerate(("A", "AA", "CENTER", "iW."), 1):
        for al in ("CENTER", "RIGHT", "MIDDLE"):
            c = _new(
                s,
                f"hbox-{_slug(al)}-{i:04d}",
                f"TEXT '{txt}' h=20 Liberation Sans {al}, vertical reference line through 11 (x=100)",
                ["TEXT", "alignment"],
                ["Q-0394", "Q-0484"],
                params={"text": txt, "align": al},
            )
            add_text(c.msp, txt, C, align=al, h=20)
            _vline(c, 100)
            cross(c.msp, C)
            c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# FIT / ALIGNED


def _fit_aligned(s: SuiteBuilder) -> None:
    for rot in (0, 30):
        a = math.radians(rot)
        d = (50 * math.cos(a), 50 * math.sin(a))
        p1 = (r(C[0] - d[0]), r(C[1] - d[1]))
        p2 = (r(C[0] + d[0]), r(C[1] + d[1]))
        for al in ("FIT", "ALIGNED"):
            for txt in ("CA", "AC", "HIH", "WAW"):
                c = _new(
                    s,
                    f"{al.lower()}-{txt.lower()}-r{rot:03d}",
                    f"TEXT {al} '{txt}' h=20 between p1/p2 100 apart at {rot} deg (crosses at 10 and 11)",
                    ["TEXT", al, "alignment"],
                    ["Q-0396"],
                    params={"align": al, "text": txt, "p1": list(p1), "p2": list(p2)},
                )
                add_text(c.msp, txt, p1, align=al, h=20, p2=p2)
                cross(c.msp, p1)
                cross(c.msp, p2)
                c.window(W0, W1)
    for al in ("FIT", "ALIGNED"):
        c = _new(
            s,
            f"{al.lower()}-coincident",
            f"TEXT {al} 'Coincident' h=20 with 11 == 10 (zero width)",
            ["TEXT", al, "degenerate"],
            ["Q-0395"],
        )
        add_text(c.msp, "Coincident", (40, 75), align=al, h=20, p2=(40, 75))
        cross(c.msp, (40, 75))
        c.window(W0, W1)
    c = _new(
        s,
        "fit-stale-width",
        "TEXT FIT 'HIH' h=20 from (50,75) to (150,75) with inconsistent stored 41=3.0",
        ["TEXT", "FIT", "stale"],
        ["Q-0503"],
    )
    t = add_text(c.msp, "HIH", (50, 75), align="FIT", h=20, p2=(150, 75))
    t.dxf.width = 3.0
    cross(c.msp, (50, 75))
    cross(c.msp, (150, 75))
    c.window(W0, W1)
    c = _new(
        s,
        "aligned-stale-height",
        "TEXT ALIGNED 'HIH' from (50,75) to (150,75) with inconsistent stored 40=5 and 41=2",
        ["TEXT", "ALIGNED", "stale"],
        ["Q-0503"],
    )
    t = add_text(c.msp, "HIH", (50, 75), align="ALIGNED", h=20, p2=(150, 75))
    t.dxf.height = 5.0
    t.dxf.width = 2.0
    cross(c.msp, (50, 75))
    cross(c.msp, (150, 75))
    c.window(W0, W1)
    # FIT/ALIGNED x mirror flags x extrusion
    for al in ("FIT", "ALIGNED"):
        for flags in (0, 2, 4, 6):
            for ext in ("pz", "nz"):
                c = _new(
                    s,
                    f"fitflags-{al.lower()}-f{flags}-{ext}",
                    f"TEXT {al} 'Fg1' h=20, 71={flags}, extrusion {'+Z' if ext == 'pz' else '-Z'}; WCS p1=(40,75) p2=(160,75) (-Z: OCS p1=(-160,75) p2=(-40,75))",
                    ["TEXT", al, "text-generation-flags", "extrusion"],
                    ["Q-0399", "Q-0398"],
                    params={"align": al, "flags": flags, "extrusion": ext},
                )
                if ext == "pz":
                    add_text(c.msp, "Fg1", (40, 75), align=al, h=20, p2=(160, 75), flags=flags)
                else:
                    add_text(
                        c.msp, "Fg1", (-160, 75), align=al, h=20, p2=(-40, 75), flags=flags,
                        dxfattribs={"extrusion": (0, 0, -1)},
                    )
                big, small = ((40, 75), (160, 75)) if ext == "pz" else ((160, 75), (40, 75))
                cross(c.msp, big)  # WCS position of 10 (p1)
                cross(c.msp, small, size=1.5)  # WCS position of 11 (p2)
                c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# stale / missing / invalid derived values


def _derived_points(s: SuiteBuilder) -> None:
    for name, al, stale in (
        ("stale10-far", "MIDDLE_CENTER", (1000.0, 1000.0)),
        ("stale10-near", "MIDDLE_CENTER", (20.0, 20.0)),
        ("stale10-correct", "MIDDLE_CENTER", None),
        ("stale10-right-near", "RIGHT", (20.0, 20.0)),
    ):
        h72, v73 = ALIGN[al]
        c = _new(
            s,
            name,
            f"TEXT 'Stale' h=20 {al} (72={h72} 73={v73}) with correct 11=(100,75) and "
            + (f"stale 10={stale}" if stale else "correct 10 (twin)"),
            ["TEXT", "alignment", "stale"],
            ["Q-0389"],
            params={"align": al, "stale_insert": list(stale) if stale else None},
        )
        t = add_text(c.msp, "Stale", C, align=al, h=20)
        if stale:
            t.dxf.insert = (stale[0], stale[1], 0)
        cross(c.msp, C)
        if stale and stale[0] < 200:
            cross(c.msp, stale, size=1.5)
        c.window(W0, W1)
    for name, al in (("missing11-center", "CENTER"), ("missing11-top-right", "TOP_RIGHT"), ("missing11-middle", "MIDDLE")):
        h72, v73 = ALIGN[al]
        c = _new(
            s,
            name,
            f"TEXT 'NoAlignPt' h=20 {al} (72={h72} 73={v73}) without group 11, 10 at (100,75)",
            ["TEXT", "alignment", "missing-11"],
            ["Q-0390"],
        )
        t = c.msp.add_text("NoAlignPt", dxfattribs={"height": 20, "style": "Standard", "insert": (100, 75)})
        t.dxf.halign = h72
        if v73:
            t.dxf.valign = v73
        cross(c.msp, C)
        c.window(W0, W1)
    # 72 in {3,4,5} with a nonzero 73; garbage combos
    for h72 in (3, 4, 5):
        for v73 in (1, 2, 3):
            c = _new(
                s,
                f"combo-72-{h72}-73-{v73}",
                f"TEXT 'Combo' h=20 with 72={h72} and nonzero 73={v73} (73 should be ignored)",
                ["TEXT", "alignment", "invalid"],
                ["Q-0391"],
                params={"halign": h72, "valign": v73},
            )
            if h72 == 4:
                t = add_text(c.msp, "Combo", C, align="MIDDLE", h=20)
                cross(c.msp, C)
            else:
                al = "ALIGNED" if h72 == 3 else "FIT"
                t = add_text(c.msp, "Combo", (40, 75), align=al, h=20, p2=(160, 75))
                cross(c.msp, (40, 75))
                cross(c.msp, (160, 75))
            t.dxf.valign = v73
            c.window(W0, W1)
    for h72, v73 in ((6, 0), (0, 4), (6, 4)):
        c = _new(
            s,
            f"combo-invalid-72-{h72}-73-{v73}",
            f"TEXT 'Garbage' h=20 with out-of-range 72={h72} 73={v73} (invalid values on purpose), 10=(40,60) 11=(100,75)",
            ["TEXT", "alignment", "invalid"],
            ["Q-0391"],
            params={"halign": h72, "valign": v73},
        )
        t = c.msp.add_text("Garbage", dxfattribs={"height": 20, "style": "Standard", "insert": (40, 60), "align_point": (100, 75)})
        t.dxf.unprotected_set("halign", h72)
        t.dxf.unprotected_set("valign", v73)
        cross(c.msp, (40, 60))
        cross(c.msp, C)
        c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# text generation flags 71 (backward / upside down)


def _mirror_flags(s: SuiteBuilder) -> None:
    rows = [("baseline", 0), ("bottom", 1), ("middle", 2), ("top", 3)]
    for flags in (0, 2, 4, 6):
        for rname, v73 in rows:
            c = _new(
                s,
                f"flags-{flags}-{rname}",
                f"TEXT 'Fg1' h=12, 71={flags}, 73={v73} with 72=0/1/2 at x=45/100/155 (crosses at 11)",
                ["TEXT", "text-generation-flags", "alignment"],
                ["Q-0398"],
                params={"flags": flags, "valign": v73},
            )
            for x, h72 in ((45, 0), (100, 1), (155, 2)):
                al = [k for k, v in ALIGN.items() if v == (h72, v73)][0]
                add_text(c.msp, "Fg1", (x, 75), align=al, h=12, flags=flags)
                cross(c.msp, (x, 75))
            _hline(c, 75)
            c.window(W0, W1)
        c = _new(
            s,
            f"flags-{flags}-middle72",
            f"TEXT 'Fg1' h=20, 71={flags}, MIDDLE (72=4) at (100,75)",
            ["TEXT", "text-generation-flags", "MIDDLE"],
            ["Q-0398"],
            params={"flags": flags},
        )
        add_text(c.msp, "Fg1", C, align="MIDDLE", h=20, flags=flags)
        cross(c.msp, C)
        c.window(W0, W1)
    # style generation flags only (entity 71 absent)
    for flags in (2, 4):
        c = _new(
            s,
            f"flags-style-{flags}",
            f"STYLE generation flags 71={flags}, TEXT 'Fg1' h=20 without 71 at (60,75)",
            ["TEXT", "STYLE", "text-generation-flags"],
            params={"style_flags": flags},
        )
        c.style("FLAGGED")
        c.doc.styles.get("FLAGGED").dxf.generation_flags = flags
        add_text(c.msp, "Fg1", (60, 75), h=20, style="FLAGGED")
        cross(c.msp, (60, 75))
        c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# width factor / oblique


def _width_oblique(s: SuiteBuilder) -> None:
    for i, w in enumerate((0.5, 0.75, 1.0, 1.5, 2.0), 1):
        c = _new(
            s, f"width-entity-{i:04d}", f"TEXT '{ALIGN_TEXT}' h=20, entity width factor 41={w}",
            ["TEXT", "width-factor"], params={"width": w},
        )
        add_text(c.msp, ALIGN_TEXT, (20, 60), h=20, width=w)
        cross(c.msp, (20, 60))
        c.window(W0, W1)
        c = _new(
            s, f"width-style-{i:04d}", f"STYLE width factor {w}, TEXT '{ALIGN_TEXT}' h=20 without 41",
            ["TEXT", "STYLE", "width-factor"], params={"style_width": w},
        )
        c.style("WIDE", width=w)
        add_text(c.msp, ALIGN_TEXT, (20, 60), h=20, style="WIDE")
        cross(c.msp, (20, 60))
        c.window(W0, W1)
    c = _new(
        s, "width-style2-entity05", f"STYLE width factor 2, TEXT '{ALIGN_TEXT}' h=20 with 41=0.5",
        ["TEXT", "STYLE", "width-factor"],
    )
    c.style("WIDE", width=2.0)
    add_text(c.msp, ALIGN_TEXT, (20, 60), h=20, style="WIDE", width=0.5)
    cross(c.msp, (20, 60))
    c.window(W0, W1)
    for i, ob in enumerate((-30, 0, 15, 45), 1):
        c = _new(
            s, f"oblique-entity-{i:04d}", f"TEXT 'IHIl' h=30, entity oblique 51={ob}",
            ["TEXT", "oblique"], params={"oblique": ob},
        )
        add_text(c.msp, "IHIl", (60, 50), h=30, oblique=ob)
        _vline(c, 60)
        _hline(c, 50)
        c.window(W0, W1)
        c = _new(
            s, f"oblique-style-{i:04d}", f"STYLE oblique {ob}, TEXT 'IHIl' h=30 without 51",
            ["TEXT", "STYLE", "oblique"], params={"style_oblique": ob},
        )
        c.style("SLANT", oblique=float(ob))
        add_text(c.msp, "IHIl", (60, 50), h=30, style="SLANT")
        _vline(c, 60)
        _hline(c, 50)
        c.window(W0, W1)
    for i, (ob, w) in enumerate(((30, 3.0), (30, 0.5), (-30, 2.0)), 1):
        c = _new(
            s, f"oblique-width-{i:04d}", f"TEXT 'I' h=80, oblique 51={ob} with width factor 41={w} (stem slope: shear/scale order)",
            ["TEXT", "oblique", "width-factor"], ["Q-0401"], params={"oblique": ob, "width": w},
        )
        x = 70 if ob < 0 else 20
        add_text(c.msp, "I", (x, 30), h=80, oblique=ob, width=w)
        _vline(c, x)
        _hline(c, 30)
        _hline(c, 110)
        c.window(W0, W1)
    c = _new(
        s, "oblique-width-center", "TEXT 'HI' h=40 MIDDLE_CENTER, oblique 30, width 2 (does the alignment box include the shear?)",
        ["TEXT", "oblique", "width-factor", "alignment"], ["Q-0401"],
    )
    add_text(c.msp, "HI", C, align="MIDDLE_CENTER", h=40, oblique=30, width=2.0)
    cross(c.msp, C)
    c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# heights


def _heights(s: SuiteBuilder) -> None:
    for i, h in enumerate((2.5, 5.0, 10.0, 20.0, 40.0), 1):
        c = _new(
            s, f"height-{i:04d}", f"TEXT '{ALIGN_TEXT}' h={h} Liberation Sans, reference lines at baseline and baseline+h",
            ["TEXT", "height", "cap-height"], ["Q-0484"], params={"height": h},
        )
        add_text(c.msp, ALIGN_TEXT, (20, 60), h=h)
        _hline(c, 60)
        _hline(c, 60 + h)
        c.window(W0, W1)
    for font in ("lato", "mono", "sans-bold"):
        c = _new(
            s, f"height-font-{font}", f"TEXT '{ALIGN_TEXT}' h=40 {TTF_FONTS[font]}, lines at baseline and baseline+h",
            ["TEXT", "height", "cap-height"], ["Q-0484"], params={"font": TTF_FONTS[font]},
        )
        add_text(c.msp, ALIGN_TEXT, (20, 60), h=40, font=font, style=_style(c, font))
        _hline(c, 60)
        _hline(c, 100)
        c.window(W0, W1)
    c = _new(
        s, "fixed-height-style15-entity5", "STYLE fixed height 15, TEXT 'HxgA' with 40=5 (lines at y+5 and y+15)",
        ["TEXT", "STYLE", "height"],
    )
    c.style("FIXED15", height=15.0)
    add_text(c.msp, "HxgA", (20, 60), h=5, style="FIXED15")
    _hline(c, 60)
    _hline(c, 65)
    _hline(c, 75)
    c.window(W0, W1)
    for name, sh, ts in (("height0-style0", 0.0, 2.5), ("height0-style15", 15.0, 2.5), ("height0-textsize12", 0.0, 12.0)):
        c = _new(
            s, name, f"TEXT 'ABC' with height 40=0 (invalid on purpose), STYLE fixed height {sh}, $TEXTSIZE {ts}; cross at insertion (40,60)",
            ["TEXT", "height", "degenerate"], ["Q-0406"], params={"style_height": sh, "textsize": ts},
            header={"$TEXTSIZE": ts},
        )
        c.style("H0", height=sh)
        t = add_text(c.msp, "ABC", (40, 60), h=10, style="H0")
        t.dxf.unprotected_set("height", 0.0)
        cross(c.msp, (40, 60))
        _hline(c, 60)
        c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# characters and special codes (LEFT at (10,70) unless noted)

CHAR_CASES = [
    # name, text, height, questions, note
    ("chars-descenders", "gjpqy Qy,;", 20, [], "descenders"),
    ("chars-ascenders", "bdfhklt ÅÉ", 20, [], "ascenders / accents above cap height"),
    ("chars-digits", "0123456789", 16, [], "digits"),
    ("chars-punct-1", ".,;:!?()[]{}", 16, [], "punctuation"),
    ("chars-punct-2", "\"#$&*+-/<=>@_`|~'", 12, [], "symbols"),
    ("chars-backslash", "a\\b\\\\c\\", 20, [], "literal backslashes"),
    ("chars-umlauts", "ÄÖÜäöüß", 20, [], "German umlauts / sharp s"),
    ("chars-latin1", "Øø°±µ€éèà", 16, [], "Latin-1 / euro"),
    ("special-cdp", "%%c10 %%d %%p %%%", 20, ["Q-0383"], "%%c %%d %%p %%%"),
    ("special-cdp-upper", "%%C10 %%D %%P", 20, ["Q-0383"], "upper-case %%C %%D %%P"),
    ("special-cdp-vs-unicode", "%%c\\U+00D8\\U+2205 %%d\\U+00B0", 20, ["Q-0383"], "%%c vs U+00D8 vs U+2205"),
    ("special-u-toggle", "a%%ub%%uc%%ud", 25, ["Q-0383", "Q-0384"], "%%u toggles: underline b and d (to end)"),
    ("special-u-large", "%%u12%%u3", 40, ["Q-0384"], "underline geometry"),
    ("special-o-large", "%%oAB%%o", 40, ["Q-0384"], "overline geometry"),
    ("special-k-large", "%%kAB", 40, ["Q-0384"], "strike-through to end of string"),
    ("special-uok-mixed", "%%uA%%oB%%kC", 30, ["Q-0384"], "underline+overline+strike combined"),
    ("special-u-space", "%%uA B%%u C", 30, ["Q-0384", "Q-0431"], "underline across a space"),
    ("special-u-trailing-space", "%%uAB  %%u", 30, ["Q-0384", "Q-0431"], "underline over trailing spaces"),
    ("nnn-codes", "%%065|%%1|%%300|%%65A", 16, ["Q-0380"], "%%nnn code space"),
    ("nnn-latin1", "%%216 %%176 %%248 %%177", 20, ["Q-0380"], "%%nnn Latin-1 (216=Ø 176=° 248=ø 177=±)"),
    ("nnn-short", "[%%9][%%09][%%009][%%65]", 16, ["Q-0380"], "1-2 digit %%n forms"),
    ("unknown-pct", "a%%xb a%%zb", 20, ["Q-0382"], "%% + unknown letter"),
    ("unknown-pct-trailing", "ab%% cd%%%%", 20, ["Q-0382"], "trailing %% and %%%%"),
    ("mtext-codes", "A\\PB\\~C", 20, ["Q-0379"], "MTEXT codes \\P \\~ in TEXT"),
    ("mtext-codes-2", "A\\LB\\l{C}\\H2x;D", 16, ["Q-0379"], "MTEXT codes \\L \\l { } \\H in TEXT"),
    ("caret-codes", "a^Bb^\\c^]d^^e^_f^ g", 16, ["Q-0375"], "caret codes ^B ^\\ ^] ^^ ^_ and '^ '"),
    ("caret-nul", "x^@y", 20, ["Q-0375"], "caret ^@ (NUL) inside the value"),
    ("caret-lowercase", "A^aB^zC^?D", 20, ["Q-0376"], "lowercase caret codes ^a ^z and ^?"),
    ("caret-controls", "A^IB^JC^MD", 20, ["Q-0375", "Q-0413", "Q-0061"], "caret ^I ^J ^M (tab/LF/CR) in TEXT"),
]


def _characters(s: SuiteBuilder) -> None:
    for name, txt, h, qs, note in CHAR_CASES:
        c = _new(
            s, name, f"TEXT {note}: {txt!r} h={h} Liberation Sans at (10,70)",
            ["TEXT", "special-codes" if ("%%" in txt or "^" in txt or "\\" in txt) else "characters"],
            qs, params={"text": txt, "height": h},
        )
        add_text(c.msp, txt, (10, 70), h=h)
        _hline(c, 70)
        c.window(W0, W1)
    for name, txt, qs in (
        ("caret-codes-mtext", "a^Bb^\\c^]d^^e^_f^ g", ["Q-0375"]),
        ("caret-nul-mtext", "x^@y", ["Q-0375"]),
        ("caret-lowercase-mtext", "A^aB^zC^?D", ["Q-0376"]),
    ):
        c = _new(
            s, name, f"MTEXT {txt!r} h=16 Liberation Sans, attachment 7 at (10,70) (caret codes in MTEXT)",
            ["MTEXT", "special-codes"], qs, params={"text": txt},
        )
        c.msp.add_mtext(txt, dxfattribs={"char_height": 16, "insert": (10, 70), "attachment_point": 7, "style": "Standard"})
        _hline(c, 70)
        c.window(W0, W1)
    c = _new(
        s, "caret-trailing", "TEXT 'AB^' ending in a lone caret (may make AutoCAD refuse the file, ezdxf#199), h=20",
        ["TEXT", "special-codes", "invalid"], ["Q-0376"],
    )
    add_text(c.msp, "AB^", (10, 70), h=20)
    add_text(c.msp, "ref", (10, 30), h=20)
    c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# \U+ / \M+ escapes and code pages


def _two_rows(c, txt: str, h: float = 14) -> None:
    add_text(c.msp, txt, (5, 100), h=h)
    c.msp.add_mtext(txt, dxfattribs={"char_height": h, "insert": (5, 50), "attachment_point": 7, "style": "Standard"})
    _hline(c, 100)
    _hline(c, 50)


def _encodings(s: SuiteBuilder) -> None:
    c = _new(
        s, "escape-spellings-r2000",
        "AC1015 cp1252: TEXT (y=100) and MTEXT (y=50) '\\u+00fc|\\U+00fc|\\U+00FC|\\U+5c42|\\U5C42'",
        ["TEXT", "MTEXT", "encoding", "unicode-escape"], ["Q-0062"], dxfversion="R2000",
    )
    _two_rows(c, "\\u+00fc|\\U+00fc|\\U+00FC|\\U+5c42|\\U5C42", 12)
    c.window(W0, W1)
    for ver in ("R2000", "R2018"):
        c = _new(
            s, f"escape-malformed-{ver.lower()}",
            f"{ver}: TEXT (y=100) and MTEXT (y=50) '\\U+00E4 \\U+4E2D|\\U+00 |x\\U+zz|end\\U+' (malformed escapes)",
            ["TEXT", "MTEXT", "encoding", "unicode-escape"], ["Q-0063"], dxfversion=ver,
        )
        _two_rows(c, "\\U+00E4 \\U+4E2D|\\U+00 |x\\U+zz|end\\U+", 12)
        c.window(W0, W1)
    c = _new(
        s, "escape-literal-r2018",
        "R2018 TEXT '\\U+0041' and MTEXT '\\U+0041' (DXFOUT: decoded to 'A' or kept?)",
        ["TEXT", "MTEXT", "encoding", "unicode-escape"], ["Q-0066", "Q-0063"],
    )
    _two_rows(c, "x\\U+0041y", 20)
    c.window(W0, W1)
    c = _new(
        s, "escape-astral-r2004",
        "AC1018 TEXT: surrogate pair '\\U+D83D\\U+DE00' (y=110), 8-digit '\\U+1F600' (y=70), ezdxf's '\\U+0001f600' for real U+1F600 (y=30)",
        ["TEXT", "encoding", "unicode-escape"], ["Q-0064"], dxfversion="R2004",
    )
    add_text(c.msp, "a\\U+D83D\\U+DE00b", (10, 110), h=16)
    add_text(c.msp, "a\\U+1F600b", (10, 70), h=16)
    add_text(c.msp, "a\U0001F600b", (10, 30), h=16)
    c.window(W0, W1)
    c = _new(
        s, "mif-selectors-r2004",
        "AC1018 ANSI_1252 TEXT '\\M+n' for U+4E2D in n=1 (932), 2 (950), 3 (949), 4 (Johab), 5 (936) and single-byte '\\M+1005A'",
        ["TEXT", "encoding", "mif"], ["Q-0067"], dxfversion="R2004",
    )
    rows = [
        "1:\\M+19286", "2:\\M+2A4A4", "3:\\M+3F1E9", "4:\\M+4F3E9", "5:\\M+5D6D0", "6:\\M+1005A",
    ]
    for i, t in enumerate(rows):
        add_text(c.msp, t, (10, 130 - i * 22), h=14)
    c.window(W0, W1)
    c = _new(
        s, "utf8-bytes-ansi1252-r2004",
        "AC1018 ANSI_1252 TEXT whose bytes are the UTF-8 encoding of 'Grün €' (mojibake or auto-detected UTF-8?)",
        ["TEXT", "encoding"], ["Q-0054"], dxfversion="R2004",
    )
    add_text(c.msp, "Grün €".encode("utf-8").decode("cp1252"), (10, 70), h=20)
    c.window(W0, W1)
    c = _new(
        s, "utf8-bytes-ansi936-r2004",
        "AC1018 ANSI_936 TEXT whose bytes are the UTF-8 encoding of '°±Ø 墙板'",
        ["TEXT", "encoding"], ["Q-0054"], dxfversion="R2004",
    )
    c.doc.encoding = "gbk"
    add_text(c.msp, "°±Ø 墙板".encode("utf-8").decode("gbk"), (10, 70), h=20)
    c.window(W0, W1)
    # invalid UTF-8 in an AC1021 file (raw legacy bytes); malformed on purpose
    for name, word, raw, cp in (
        ("invalid-utf8-cp1252-r2007", "Müller", "Müller".encode("cp1252"), "ANSI_1252"),
        ("invalid-utf8-cp932-r2007", "日本語", "日本語".encode("cp932"), "ANSI_932"),
    ):
        c = _new(
            s, name,
            f"AC1021 TEXT '{word}' written as raw {cp} bytes (invalid UTF-8 on purpose), $DWGCODEPAGE {cp}",
            ["TEXT", "encoding", "invalid"], ["Q-0056"], dxfversion="R2007",
        )
        c.doc.encoding = "cp1252" if cp == "ANSI_1252" else "cp932"  # -> $DWGCODEPAGE
        add_text(c.msp, f"x{word}y", (10, 70), h=20)
        utf8 = f"x{word}y".encode("utf-8")
        legacy = b"x" + raw + b"y"
        c.byte_filters.append(lambda data, a=utf8, b=legacy: data.replace(a, b))
        c.allow_audit_errors = True
        c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# glyphs missing from the TTF (fallback), BiDi / complex scripts


def _fallback(s: SuiteBuilder) -> None:
    items = [
        ("diameter", "∅ 99 Ø", ["Q-0487"], "U+2205 (missing in Liberation Sans) vs U+00D8"),
        ("cjk", "AB中文CD", ["Q-0487"], "CJK U+4E2D U+6587"),
        ("hebrew", "שלום", ["Q-0487", "Q-0488"], "Hebrew word (in Liberation Sans)"),
        ("thai", "Aกี่B", ["Q-0487", "Q-0488"], "Thai with vowel + tone mark (missing)"),
        ("arabic", "سلام", ["Q-0487", "Q-0488"], "Arabic word (missing, joining)"),
        ("mixed-bidi", "abc שלום 123", ["Q-0488"], "LTR + Hebrew RTL + digits"),
    ]
    for key, txt, qs, note in items:
        for ent in ("text", "mtext"):
            c = _new(
                s, f"fallback-{key}-{ent}", f"{ent.upper()} {note}: {txt!r} h=20 Liberation Sans at (10,70)",
                [ent.upper(), "fallback-font", "unicode"], qs, params={"text": txt},
            )
            if ent == "text":
                add_text(c.msp, txt, (10, 70), h=20)
            else:
                c.msp.add_mtext(txt, dxfattribs={"char_height": 20, "insert": (10, 70), "attachment_point": 7, "style": "Standard"})
            _hline(c, 70)
            c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# leading / trailing spaces


def _spaces(s: SuiteBuilder) -> None:
    for i, txt in enumerate((" A", "A ", " A ", "A   ", "   ", ""), 1):
        for al in ("LEFT", "CENTER", "RIGHT"):
            c = _new(
                s, f"spaces-{_slug(al)}-{i:04d}", f"TEXT {txt!r} h=20 {al} at (100,75) (leading/trailing spaces)",
                ["TEXT", "spaces", "alignment"], ["Q-0374"], params={"text": txt, "align": al},
            )
            add_text(c.msp, txt, C, align=al, h=20)
            cross(c.msp, C)
            _vline(c, 100)
            c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# styles: fonts, XDATA family/bold/italic, missing styles


def _styles(s: SuiteBuilder) -> None:
    for font in STYLE_OF:
        c = _new(
            s, f"font-{font}", f"TEXT 'AaBbGg 0123 ÄÖÜ' h=16 in {TTF_FONTS[font]}",
            ["TEXT", "STYLE", "font"], ["Q-0484"], params={"font": TTF_FONTS[font]},
        )
        add_text(c.msp, "AaBbGg 0123 ÄÖÜ", (10, 70), h=16, font=font, style=_style(c, font))
        _hline(c, 70)
        c.window(W0, W1)
    xdata = [
        # name, group-3 font alias (or ""), family, italic, bold, note
        ("sans-bold", "sans", "Liberation Sans", False, True, "family + bold bit (real Bold face exists)"),
        ("sans-italic", "sans", "Liberation Sans", True, False, "family + italic bit (real Italic face exists)"),
        ("sans-bolditalic", "sans", "Liberation Sans", True, True, "family + bold+italic bits"),
        ("mono-bold", "mono", "Cascadia Mono", False, True, "variable font, bold bit"),
        ("mono-italic", "mono", "Cascadia Mono", True, False, "no italic face: synthesised?"),
        ("lato-italic", "lato", "Lato", True, False, "italic bit, LatoWeb-Italic installed"),
        ("family-wins", "lato", "Liberation Sans", False, False, "group 3 LatoWeb-Regular + XDATA family Liberation Sans"),
        ("empty-group3", "", "Lato", False, False, "empty group 3 + XDATA family Lato"),
    ]
    for name, g3, fam, it, bd, note in xdata:
        c = _new(
            s, f"xdata-{name}", f"STYLE XDATA ACAD family '{fam}' italic={it} bold={bd}: {note}; TEXT 'ABC abg' h=25",
            ["TEXT", "STYLE", "font", "xdata"], ["Q-0460"],
            params={"group3": TTF_FONTS[g3] if g3 else "", "family": fam, "italic": it, "bold": bd},
        )
        c.style("XD", font=TTF_FONTS[g3] if g3 else "")
        c.doc.styles.get("XD").set_extended_font_data(fam, italic=it, bold=bd)
        add_text(c.msp, "ABC abg", (10, 90), h=25, font=g3 or "lato", style="XD")
        add_text(c.msp, "ABC abg", (10, 30), h=25)  # reference: plain Liberation Sans Regular
        c.window(W0, W1)
    c = _new(
        s, "no-style-group",
        "TEXT 'ABC xg' without group 7; $TEXTSTYLE=Big (Cascadia Mono), Standard = Liberation Sans",
        ["TEXT", "STYLE"], ["Q-0386"], header={"$TEXTSTYLE": "Big"},
    )
    c.style("Big", font=TTF_FONTS["mono"])
    t = add_text(c.msp, "ABC xg", (10, 70), h=25)
    t.dxf.discard("style")
    c.window(W0, W1)
    c = _new(
        s, "undefined-style",
        "TEXT 'ABC' (y=110) and MTEXT 'ABC' (y=40) with style NOSUCHSTYLE (undefined), TEXT 'ABC' Standard at y=75",
        ["TEXT", "MTEXT", "STYLE", "invalid"], ["Q-0387"],
    )
    add_text(c.msp, "ABC", (10, 110), h=20, style="NOSUCHSTYLE")
    add_text(c.msp, "ABC", (10, 75), h=20)
    c.msp.add_mtext("ABC", dxfattribs={"char_height": 20, "insert": (10, 40), "attachment_point": 7, "style": "NOSUCHSTYLE"})
    c.window(W0, W1)
    c = _new(
        s, "no-standard-style",
        "STYLE table without 'Standard' (invalid on purpose; DIMSTYLE/MLEADERSTYLE handles dangle); TEXT 'ABC' in style LATO and TEXT without 7",
        ["TEXT", "STYLE", "invalid"], ["Q-0387"],
    )
    c.style("LATO", font=TTF_FONTS["lato"])
    add_text(c.msp, "ABC", (10, 90), h=20, style="LATO")
    t = add_text(c.msp, "ABC", (10, 40), h=20)
    t.dxf.discard("style")
    c.doc.styles.remove("Standard")
    c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# QTEXT, lineweight, MIRRTEXT, thickness, extrusion


def _misc(s: SuiteBuilder) -> None:
    for q in (0, 1):
        c = _new(
            s, f"qtextmode-{q}",
            f"$QTEXTMODE={q}: TEXT rotated 30, ALIGNED TEXT and MTEXT 2 lines",
            ["TEXT", "MTEXT", "QTEXTMODE"], ["Q-0407"], header={"$QTEXTMODE": q},
        )
        add_text(c.msp, "Rotated", (20, 90), h=15, rotation=30)
        add_text(c.msp, "Aligned", (110, 110), align="ALIGNED", h=10, p2=(190, 110))
        c.msp.add_mtext("MText\\PLine2", dxfattribs={"char_height": 12, "insert": (100, 70), "attachment_point": 1, "style": "Standard"})
        c.window(W0, W1)
    for lw in (0, 70, 100):
        c = _new(
            s, f"lineweight-{lw:03d}",
            f"TEXT '{ALIGN_TEXT}' h=30 on layer with lineweight {lw / 100:.2f} mm (+ LINE on same layer)",
            ["TEXT", "lineweight"], ["Q-0491"], params={"lineweight": lw},
        )
        layer = c.layer(f"LW{lw:03d}", lineweight=lw)
        add_text(c.msp, ALIGN_TEXT, (20, 60), h=30, dxfattribs={"layer": layer})
        c.msp.add_line((20, 30), (180, 30), dxfattribs={"layer": layer})
        c.window(W0, W1)
    for name, sx, sy, mt in (
        ("mirror-insert-x-mirrtext0", -1, 1, 0),
        ("mirror-insert-x-mirrtext1", -1, 1, 1),
        ("mirror-insert-y-mirrtext0", 1, -1, 0),
    ):
        c = _new(
            s, name,
            f"Block with TEXT 'Rg1' (and a frame); INSERT scale ({sx},{sy}) at (100,75), $MIRRTEXT={mt}; unmirrored INSERT at (20,20) for reference",
            ["TEXT", "INSERT", "MIRRTEXT", "mirror"], ["Q-0616"], header={"$MIRRTEXT": mt},
            params={"xscale": sx, "yscale": sy, "mirrtext": mt},
        )
        blk = c.doc.blocks.new("TXTBLK")
        add_text(blk, "Rg1", (5, 5), h=20)
        blk.add_lwpolyline([(0, 0), (60, 0), (60, 30), (0, 30)], close=True)
        c.msp.add_blockref("TXTBLK", C, dxfattribs={"xscale": sx, "yscale": sy})
        c.msp.add_blockref("TXTBLK", (20, 20), dxfattribs={"xscale": 0.5, "yscale": 0.5})
        cross(c.msp, C)
        c.window(W0, W1)
    c = _new(
        s, "thickness-5", f"TEXT '{ALIGN_TEXT}' h=30 with thickness 39=5 (plan view)",
        ["TEXT", "thickness"],
    )
    add_text(c.msp, ALIGN_TEXT, (20, 60), h=30, dxfattribs={"thickness": 5.0})
    c.window(W0, W1)
    c = _new(
        s, "extrusion-negz", "TEXT 'Rg1' h=30 LEFT with extrusion (0,0,-1), OCS insert (-120,60) = WCS (120,60)",
        ["TEXT", "extrusion", "ocs"],
    )
    add_text(c.msp, "Rg1", (-120, 60), h=30, dxfattribs={"extrusion": (0, 0, -1)})
    cross(c.msp, (120, 60))
    c.window(W0, W1)
    c = _new(
        s, "extrusion-negz-center", "TEXT 'Rg1' h=30 MIDDLE_CENTER with extrusion (0,0,-1), OCS 11 (-100,75) = WCS (100,75)",
        ["TEXT", "extrusion", "ocs", "alignment"],
    )
    add_text(c.msp, "Rg1", (-100, 75), align="MIDDLE_CENTER", h=30, dxfattribs={"extrusion": (0, 0, -1)})
    cross(c.msp, C)
    c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# seeded random TEXT


def _random(s: SuiteBuilder) -> None:
    charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,-+ÄÖÜß"
    fonts = list(STYLE_OF)
    for seed in range(1, 11):
        c = _new(
            s, f"random-{seed:04d}", f"Random TEXT (font, alignment, rotation, width, oblique, flags), seed {seed}",
            ["TEXT", "alignment", "random"], seed=seed,
        )
        rng = c.rng
        for k in range(rng.randint(1, 2)):
            font = rng.choice(fonts)
            st = _style(c, font)
            txt = "".join(rng.choice(charset) for _ in range(rng.randint(2, 7))).strip() or "X"
            al = rng.choice(ALIGN_NAMES)
            h = rng.choice([12, 15, 18, 22])
            w = rng.choice([1.0, 1.0, 0.7, 1.3])
            ob = rng.choice([0, 0, 15, -10])
            fl = rng.choice([0, 0, 0, 2, 4])
            p = (r(rng.uniform(60, 140)), r(40 + 70 * k + rng.uniform(-3, 3)))
            if al in ("FIT", "ALIGNED"):
                ang = math.radians(rng.uniform(-30, 30))
                p1 = (r(p[0] - 35 * math.cos(ang)), r(p[1] - 35 * math.sin(ang)))
                p2 = (r(p[0] + 35 * math.cos(ang)), r(p[1] + 35 * math.sin(ang)))
                add_text(c.msp, txt, p1, align=al, h=min(h, 15), font=font, style=st, width=w, oblique=ob, p2=p2)
                cross(c.msp, p1, 1.5)
                cross(c.msp, p2, 1.5)
            else:
                rot = rng.choice([0, 0, 15, 45, 90, 180, 300])
                add_text(c.msp, txt, p, align=al, h=h, font=font, style=st, rotation=rot, width=w, oblique=ob, flags=fl)
                cross(c.msp, p, 1.5)
        c.window(W0, W1)
