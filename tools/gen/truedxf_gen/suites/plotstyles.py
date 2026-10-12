"""Plot style tables (CTB/STB) applied by PLOT: pen lineweight index semantics, pen colour
encoding, pen selection for true-colour objects, screening/grayscale, end/join/fill styles,
CTB linetypes, "plot with plot styles"/"plot lineweights" switches and named plot styles
(research/notes/06 §6; analysis: tools/acad/calibration/analyze_plotstyles.py).

Conventions: model space, window (0,0)-(200,150) on 2000x1500 px = 10 px/unit (half-pixel
shifted, so round coordinates hit pixel centres). Fixture-specific tables are written by
``truedxf_gen.plotstyle`` as ``truedxf-<case>.ctb|stb`` next to the case; the harness installs
them into AutoCAD's Plot Styles folder. Stock tables (Screening xx%.ctb, Grayscale.ctb,
Fill Patterns.ctb) are only named, never copied. No labels (ACI 7 text would go through the
pens under test); the layout of every case is documented in ``params``.
"""

from __future__ import annotations

from ..core import SuiteBuilder, suite
from ..plotstyle import DEFAULT_LINEWEIGHTS, OBJECT_COLOR, ctb_bytes, int32, rgb_color, stb_bytes
from ._appearance_util import solid_rect

# Lineweight table whose entry i plots i+2 px wide (mm = px * 0.254, px = round(mm*100/25.4)),
# except entries 10 and 11 = 0.00 mm. Any pen index tells 0- from 1-based lookup by its width.
LW_PROBE = tuple(0.0 if i in (10, 11) else round((i + 2) * 0.254, 4) for i in range(27))

# lineweight values of the pens in lw-index (pen ACI -> CTB "lineweight")
LW_PENS = {1: 0, 2: 1, 3: 2, 4: 5, 5: 11, 6: 26, 8: 27, 9: 255}


def _lines(c, acis, lw=211, x0=10.0, x1=190.0, y_top=140.0, pitch=15.0, **attrs):
    """One horizontal LINE per ACI, from top to bottom; returns {aci: y}."""
    ys = {}
    for k, aci in enumerate(acis):
        y = y_top - pitch * k
        c.msp.add_line((x0, y), (x1, y), dxfattribs={"color": aci, "lineweight": lw, **attrs})
        ys[aci] = y
    return ys


@suite("plotstyles", "CTB/STB pen application in PLOT", style_table="acad.ctb")
def build(s: SuiteBuilder) -> None:
    _lineweight(s)
    _colors(s)
    _truecolor(s)
    _screening(s)
    _endjoin(s)
    _linetype_fill(s)
    _named(s)
    _color_matrix(s)
    _pen_resolution(s)
    _linetypes(s)
    _fills(s)
    _colorbook(s)
    _styles_ref(s)
    _gradients(s)
    _fill_anchor(s)
    _lt_wide(s)


# --- lineweight index ---------------------------------------------------------------------------


def _lineweight(s: SuiteBuilder) -> None:
    pens = {aci: {"lineweight": v} for aci, v in LW_PENS.items()}
    variants = [
        ("lw-index", "plot styles Y, lineweights Y", {}),
        ("lw-index-nolw", "plot styles Y, lineweights N", {"lineweights": False}),
        ("lw-index-nostyles", "plot styles N, lineweights Y", {"plotStyles": False}),
        ("lw-index-nostyles-nolw", "plot styles N, lineweights N", {"plotStyles": False, "lineweights": False}),
    ]
    for name, what, opts in variants:
        c = s.case(
            name,
            f"Pen lineweight index semantics: pens ACI {sorted(LW_PENS)} = lineweight {list(LW_PENS.values())}, "
            f"table entry i = (i+2) px except entries 10/11 = 0.00 mm; object lineweight 2.11 mm (8 px); {what}",
            tags=["CTB", "lineweight"],
            questions=["Q-0230", "Q-0750"],
            params={
                "pens": LW_PENS,
                "lineweight_table_mm": LW_PROBE,
                "lines": "one horizontal LINE x 10..190 per pen ACI, y = 140 - 15*k in pen order",
                "object_lineweight": 211,
            },
            outputs=["png"],
        )
        c.plot_style_table(f"truedxf-{name}.ctb", ctb_bytes(pens, LW_PROBE))
        ys = _lines(c, list(LW_PENS))
        # reference: ACI 7 object-lineweight hairline and 2.11 mm line through acad-like pen 7
        c.msp.add_line((10, 5), (190, 5), dxfattribs={"color": 7, "lineweight": 0})
        c.params["y"] = ys
        if "lineweights" in opts:
            c.plot.lineweights = opts["lineweights"]
        if "plotStyles" in opts:
            c.plot.extra["plotStyles"] = opts["plotStyles"]
        c.window((0, 0), (200, 150))


# --- pen colour encoding ------------------------------------------------------------------------

BLUE = (0, 0, 255)
RED = (255, 0, 0)
GREEN = (0, 255, 0)

COLOR_PENS: list[tuple[str, dict]] = [
    ("color 0xFF0000FF (method FF, blue), no mode_color", {"color": rgb_color(*BLUE, method=0xFF)}),
    ("color 0xC20000FF (method C2, blue), no mode_color", {"color": rgb_color(*BLUE, method=0xC2)}),
    ("color 0xC30000FF (method C3, blue), no mode_color", {"color": rgb_color(*BLUE, method=0xC3)}),
    ("color 0xC300001E (C3 + 30: ACI 30 orange or RGB 0,0,30?)", {"color": int32(0xC300001E)}),
    ("color -1, mode_color red C2", {"color": OBJECT_COLOR, "mode_color": rgb_color(*RED)}),
    ("color red C2, mode_color -1", {"color": rgb_color(*RED), "mode_color": OBJECT_COLOR}),
    ("color green C2, mode_color blue C2", {"color": rgb_color(*GREEN), "mode_color": rgb_color(*BLUE)}),
    ("color blue C2, color_policy 0", {"color": rgb_color(*BLUE), "color_policy": 0}),
    ("color blue C2, color_policy 4", {"color": rgb_color(*BLUE), "color_policy": 4}),
    ("color 0xC3FFFFFF", {"color": int32(0xC3FFFFFF)}),
    ("color white 0xC2FFFFFF", {"color": rgb_color(255, 255, 255)}),
    ("color black 0xC2000000", {"color": rgb_color(0, 0, 0)}),
    ("color 0xC3000000 (Autodesk-MONO.stb black)", {"color": int32(0xC3000000)}),
    ("color 0xFF000000 (monochrome.ctb black)", {"color": int32(0xFF000000)}),
    ("color 0xC1000000 (method ByBlock)", {"color": int32(0xC1000000)}),
    ("color 0xC0000000 (method ByLayer)", {"color": int32(0xC0000000)}),
]
# object ACIs for the pens above (avoid 7 and keep object colours distinct from the pen colours)
COLOR_ACIS = [1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 14, 30, 40, 50, 60, 70]


def _colors(s: SuiteBuilder) -> None:
    pens = {aci: over for aci, (_, over) in zip(COLOR_ACIS, COLOR_PENS)}
    c = s.case(
        "pen-color-encoding",
        "Pen colour encodings (method byte FF/C2/C3/C0/C1, color vs mode_color, colour policy bits) on SOLID swatches",
        tags=["CTB", "color", "SOLID"],
        questions=["Q-0223", "Q-0751"],
        params={
            "pens": {aci: d for aci, (d, _) in zip(COLOR_ACIS, COLOR_PENS)},
            "pen_values": pens,
            "layout": "4x4 grid, swatch k (0-based, row-major from top-left) = SOLID (12+45*col .. 47+45*col, 112-35*row .. 142-35*row), object ACI = COLOR_ACIS[k]",
            "object_acis": COLOR_ACIS,
        },
        outputs=["png"],
    )
    c.plot_style_table("truedxf-pen-color-encoding.ctb", ctb_bytes(pens))
    for k, aci in enumerate(COLOR_ACIS):
        r, col = divmod(k, 4)
        solid_rect(c.msp, 12 + 45 * col, 112 - 35 * r, 47 + 45 * col, 142 - 35 * r, {"color": aci})
    c.window((0, 0), (200, 150))

    # second pass (the first showed colour_policy 1 ignores the pen colour): policy x encoding
    pol = [(f"policy {p}, color blue C2", {"color": rgb_color(*BLUE), "color_policy": p}) for p in range(8)]
    pol += [
        ("policy 4, color -1", {"color": OBJECT_COLOR, "color_policy": 4}),
        ("policy 0, color -1", {"color": OBJECT_COLOR, "color_policy": 0}),
    ]
    pol += [(f"policy 5, {d}", {**over, "color_policy": 5}) for d, over in COLOR_PENS if "policy" not in d]
    acis = [1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 14, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]
    assert len(pol) <= len(acis), len(pol)
    pens = {aci: over for aci, (_, over) in zip(acis, pol)}
    c = s.case(
        "pen-color-policy",
        "Pen colour vs colour_policy 0-7 and colour encodings with policy 5, on SOLID swatches",
        tags=["CTB", "color", "SOLID"],
        questions=["Q-0223", "Q-0751"],
        params={
            "pens": {aci: d for aci, (d, _) in zip(acis, pol)},
            "pen_values": pens,
            "layout": "6x4 grid, swatch k (row-major from top-left) = SOLID (7+32*col .. 33+32*col, 112-35*row .. 140-35*row), object ACI = acis[k]",
            "object_acis": acis[: len(pol)],
        },
        outputs=["png"],
    )
    c.plot_style_table("truedxf-pen-color-policy.ctb", ctb_bytes(pens))
    for k, aci in enumerate(acis[: len(pol)]):
        r, col = divmod(k, 6)
        solid_rect(c.msp, 7 + 32 * col, 112 - 35 * r, 33 + 32 * col, 140 - 35 * r, {"color": aci})
    c.window((0, 0), (200, 150))


# --- true colour pen selection ------------------------------------------------------------------

TC_LINES = [
    # (description, dxfattribs, layer)
    ("62=1 + 420 green (nearest ACI 3)", {"color": 1, "true_color": 0x00FF00}, None),
    ("62=5 + 420 red (nearest ACI 1)", {"color": 5, "true_color": 0xFF0000}, None),
    ("420 red only, BYLAYER on layer TC4 (ACI 4)", {"true_color": 0xFF0000}, "TC4"),
    ("BYLAYER on layer TCL (62=2, layer 420 blue, nearest ACI 5)", {}, "TCL"),
    ("62=3 (reference pen 3)", {"color": 3}, None),
    ("62=1 (reference pen 1)", {"color": 1}, None),
    ("62=5 (reference pen 5)", {"color": 5}, None),
    ("62=2 (reference pen 2)", {"color": 2}, None),
    ("62=4 (reference pen 4)", {"color": 4}, None),
    ("62=1 + 420 green + object lineweight 1.00 mm", {"color": 1, "true_color": 0x00FF00, "lineweight": 100}, None),
]


def _truecolor(s: SuiteBuilder) -> None:
    # pen n: lineweight index 2n -> width 2n+2 px (0-based) or 2n+1 px (1-based); every pen distinct
    lw_pens = {n: {"lineweight": 2 * n} for n in range(1, 10)}
    pen_rgb = {1: (128, 0, 128), 2: (0, 128, 128), 3: (128, 128, 0), 4: (255, 128, 0), 5: (0, 0, 128)}
    for name, with_color in (("truecolor-pen", False), ("truecolor-pen-color", True)):
        pens = {n: dict(v) for n, v in lw_pens.items()}
        if with_color:
            for n, col in pen_rgb.items():
                pens[n]["color"] = rgb_color(*col)
                pens[n]["color_policy"] = 5
        c = s.case(
            name,
            "Which pen a true-colour (420) object uses: lines with 62 deliberately different from the nearest ACI of 420; "
            + ("pens 1-5 also set colours" if with_color else "pens keep object colour")
            + "; pen n lineweight index 2n",
            tags=["CTB", "true-color", "LINE"],
            questions=["Q-0222"],
            params={
                "lines": [d for d, _, _ in TC_LINES],
                "y": "line k at y = 140 - 15*k, x 10..190, object lineweight 0",
                "pens": pens,
                "pen_rgb": pen_rgb if with_color else None,
                "lineweight_table_mm": LW_PROBE,
            },
            outputs=["png"],
        )
        c.plot_style_table(f"truedxf-{name}.ctb", ctb_bytes(pens, LW_PROBE))
        c.layer("TC4", color=4)
        c.layer("TCL", color=2, true_color=0x0000FF)
        for k, (_, attrs, layer) in enumerate(TC_LINES):
            y = 140 - 15 * k
            a = {"lineweight": 0, **attrs}
            if layer:
                a["layer"] = layer
            c.msp.add_line((10, y), (190, y), dxfattribs=a)
        c.window((0, 0), (200, 150))


# --- screening / grayscale ----------------------------------------------------------------------

SCREEN_ACIS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 30, 40, 94, 140, 200, 250, 251, 252, 253, 254, 255]
SCREEN_RGB = [0xC86432, 0x0A141E, 0xFFFF00, 0x808080, 0x3366CC, 0xFF00FF, 0x00FF80, 0xFFFFFF]


def _swatches(c):
    """5 rows x 6 columns of SOLID swatches 26x22 units: ACIs then true colours (row-major)."""
    cells = []
    items = [("aci", a) for a in SCREEN_ACIS] + [("rgb", v) for v in SCREEN_RGB]
    for k, (kind, v) in enumerate(items):
        r, col = divmod(k, 6)
        x0, y0 = 7 + 32 * col, 120 - 28 * r
        attrs = {"color": v} if kind == "aci" else {"color": 7, "true_color": v}
        solid_rect(c.msp, x0, y0, x0 + 26, y0 + 22, attrs)
        cells.append({"kind": kind, "value": v, "box": [x0, y0, x0 + 26, y0 + 22]})
    return cells


def _screening(s: SuiteBuilder) -> None:
    stock = [
        ("screen-stock-25", "Screening 25%.ctb"),
        ("screen-stock-50", "Screening 50%.ctb"),
        ("screen-stock-75", "Screening 75%.ctb"),
        ("screen-stock-100", "Screening 100%.ctb"),
        ("grayscale-stock", "Grayscale.ctb"),
        ("screen-none", "."),
        ("screen-acad", "acad.ctb"),
    ]
    for name, table in stock:
        c = s.case(
            name,
            f"SOLID swatches (ACI and true colour) plotted with {table if table != '.' else 'no plot style table'}",
            tags=["CTB", "screening", "grayscale", "SOLID"],
            questions=["Q-0225", "Q-0226"],
            style_table=table,
            outputs=["png", "pdf"],
        )
        c.params["cells"] = _swatches(c)
        c.window((0, 0), (200, 150))
    # full ACI grid (layout of colors/aci-grid-full) for the measured grayscale table
    for name, table in (("grayscale-aci-grid", "Grayscale.ctb"), ("screen-50-aci-grid", "Screening 50%.ctb")):
        c = s.case(
            name,
            f"16x16 SOLID swatch grid of ACI 1-255 (ACI = 16*row+col, row 0 on top) plotted with {table}",
            tags=["CTB", "grayscale", "screening", "SOLID", "ACI"],
            questions=["Q-0225", "Q-0226"],
            params={"layout": "cell 9x9 units, swatch 8x8; cell (row,col) lower-left = (28+9*col, 138-9*row)"},
            style_table=table,
            outputs=["png"],
        )
        for aci in range(1, 256):
            r, k = divmod(aci, 16)
            x = 28 + 9 * k
            y = 138 - 9 * r
            solid_rect(c.msp, x + 0.5, y + 0.5, x + 8.5, y + 8.5, {"color": aci})
        c.window((0, 0), (200, 150))

    custom = [
        ("screen-50-policy0", "screening 50, colour policy 0 (no dithering)", {"screen": 50, "color_policy": 0}),
        ("screen-50-policy1", "screening 50, colour policy 1 (dithering)", {"screen": 50, "color_policy": 1}),
        ("screen-50-red", "screening 50 with pen colour red (policy 5)", {"screen": 50, "color": rgb_color(*RED), "color_policy": 5}),
        ("screen-0", "screening 0", {"screen": 0}),
        ("screen-10", "screening 10", {"screen": 10}),
        ("screen-90", "screening 90", {"screen": 90}),
        ("grayscale-policy2", "colour policy 2 (grayscale, no dithering)", {"color_policy": 2}),
        ("grayscale-screen-50", "colour policy 3 + screening 50", {"color_policy": 3, "screen": 50}),
    ]
    for name, what, over in custom:
        c = s.case(
            name,
            f"SOLID swatches (ACI and true colour), every pen {what}",
            tags=["CTB", "screening", "grayscale", "SOLID"],
            questions=["Q-0225", "Q-0226"],
            params={"pen": over},
            outputs=["png", "pdf"],
        )
        c.plot_style_table(f"truedxf-{name}.ctb", ctb_bytes({a: over for a in range(1, 256)}))
        c.params["cells"] = _swatches(c)
        c.window((0, 0), (200, 150))


# --- end / join styles --------------------------------------------------------------------------


def _endjoin(s: SuiteBuilder) -> None:
    # all entries 5.08 mm (20 px) so the lineweight index semantics do not matter
    thick = tuple([5.08] * 27)
    pens = {}
    rows = []
    for e in range(4):
        pens[1 + e] = {"lineweight": 3, "end_style": e}
        rows.append(f"pen {1 + e}: end {e}, join object")
    for j in range(4):
        pens[10 + j] = {"lineweight": 3, "join_style": j}
        rows.append(f"pen {10 + j}: join {j}, end object")
    pens[20] = {"lineweight": 3}
    rows.append("pen 20: end/join object")
    c = s.case(
        "endjoin",
        "CTB end styles 0-3 and join styles 0-3 on 5.08 mm (20 px) open polylines with 90 and 30 degree corners",
        tags=["CTB", "lineweight", "caps", "joins", "LWPOLYLINE"],
        questions=["Q-0227"],
        params={
            "rows": rows,
            "geometry": "per pen a row at y = 138 - 14.5*k: LWPOLYLINE (10,y-4)-(40,y-4)-(40,y+4)... see code; plus LINE (120,y)-(150,y) and a 30-degree V",
            "pens_in_order": sorted(pens),
        },
        outputs=["png", "pdf"],
    )
    c.plot_style_table("truedxf-endjoin.ctb", ctb_bytes(pens, thick))
    for k, aci in enumerate(sorted(pens)):
        y = 138 - 14.5 * k
        a = {"color": aci, "lineweight": 0}
        # 90-degree corner
        c.msp.add_lwpolyline([(10, y - 4), (40, y - 4), (40, y + 4)], dxfattribs=a)
        # 30-degree V (apex on the right)
        c.msp.add_lwpolyline([(60, y + 4), (90, y), (60, y - 4.0)], dxfattribs=a)
        # straight LINE for the caps
        c.msp.add_line((120, y), (150, y), dxfattribs=a)
        # LINE with a gap of 2 units to another LINE: caps meet?
        c.msp.add_line((165, y), (175, y), dxfattribs=a)
        c.msp.add_line((177, y), (190, y), dxfattribs=a)
    c.window((0, 0), (200, 150))


# --- CTB linetypes and fill styles ------------------------------------------------------------


def _linetype_fill(s: SuiteBuilder) -> None:
    for name, adaptive in (("linetype-adaptive", True), ("linetype-fixed", False)):
        pens = {k + 1: {"linetype": k, "adaptive_linetype": adaptive} for k in range(31)}
        c = s.case(
            name,
            f"CTB pen linetypes 0-30 (pen ACI k+1 -> linetype k), adaptive {adaptive}, on 180-unit hairline LINEs",
            tags=["CTB", "linetype", "LINE"],
            questions=["Q-0228"],
            params={"lines": "pen ACI k+1 (k = 0..30): LINE (10, 146-4.7k)-(190, 146-4.7k), plus a short LINE 10..40 at y-2"},
            outputs=["png"],
        )
        c.plot_style_table(f"truedxf-{name}.ctb", ctb_bytes(pens))
        for k in range(31):
            y = 146 - 4.7 * k
            c.msp.add_line((10, y), (190, y), dxfattribs={"color": k + 1, "lineweight": 0})
            c.msp.add_line((10, y - 2), (40, y - 2), dxfattribs={"color": k + 1, "lineweight": 0})
        c.window((0, 0), (200, 150))

    # fill styles: stock Fill Patterns.ctb sets pens 1..9 fill style 64..72
    c = s.case(
        "fill-patterns-stock",
        "Fill Patterns.ctb (pens 1-9 = fill style 64-72): SOLID, solid HATCH and wide LWPOLYLINE per pen",
        tags=["CTB", "fill-style", "SOLID", "HATCH"],
        questions=["Q-0752"],
        params={"layout": "pen ACI k+1 (k = 0..9) in column k: SOLID (5+19k..20+19k, 100..140), HATCH (.., 55..95), LWPOLYLINE width 10 (.., 10..50)"},
        style_table="Fill Patterns.ctb",
        outputs=["png"],
    )
    for k in range(10):
        x0 = 5 + 19 * k
        aci = k + 1
        solid_rect(c.msp, x0, 100, x0 + 15, 140, {"color": aci})
        h = c.msp.add_hatch(color=aci)
        h.paths.add_polyline_path([(x0, 55), (x0 + 15, 55), (x0 + 15, 95), (x0, 95)], is_closed=True)
        pl = c.msp.add_lwpolyline([(x0 + 7.5, 15), (x0 + 7.5, 45)], dxfattribs={"color": aci})
        pl.dxf.const_width = 10
    c.window((0, 0), (200, 150))


# --- named plot styles (STB) --------------------------------------------------------------------

MAGENTA = (255, 0, 255)
STB_STYLES = [
    ("Red", {"color": rgb_color(*RED), "color_policy": 5}),
    ("Blue", {"color": rgb_color(*BLUE), "color_policy": 5}),
    ("Magenta", {"color": rgb_color(*MAGENTA), "color_policy": 5}),
    ("Thick", {"lineweight": 3}),
]


def _force_380_byblock(handles):
    """ezdxf omits 380 = 1 (its default); insert it after the 370 of the given entities."""

    def f(data: bytes) -> bytes:
        text = data.decode("utf-8")
        for h in handles:
            k = text.index(f"\n  5\n{h}\n")
            end = text.index("\n  0\n", k)
            # after 370, else 62, else 8 (AcDbEntity order 8, 62, 370, 380)
            for code in ("370", " 62", "  8"):
                m = text.find(f"\n{code}\n", k, end)
                if m >= 0:
                    break
            e = text.index("\n", m + 5)
            text = text[: e + 1] + "380\n1\n" + text[e + 1 :]
        return text.encode("utf-8")

    return f


def _named(s: SuiteBuilder) -> None:
    c = s.case(
        "stb-resolution",
        "Named plot styles ($PSTYLEMODE 0): entity 380 = absent/0/1/2/3, layer 390, BYBLOCK/BYLAYER inside a block, a style missing from the STB",
        tags=["STB", "named-plot-style", "LINE", "INSERT"],
        questions=["Q-0229", "Q-0753"],
        header={"$PSTYLEMODE": 0},
        outputs=["png", "dxf"],
        params={"styles": [n for n, _ in STB_STYLES], "lineweight_table_mm": "all 1.27 mm (5 px)", "object_color": "ACI 3 (00FF00)"},
    )
    c.plot_style_table("truedxf-stb-resolution.stb", stb_bytes(STB_STYLES, tuple([1.27] * 27)))
    doc = c.doc
    psdict = doc.rootdict["ACAD_PLOTSTYLENAME"]
    handles = {"Normal": psdict["Normal"].dxf.handle}
    for name in ["Red", "Blue", "Magenta", "Thick", "Missing"]:
        ph = doc.objects.add_placeholder(owner=psdict.dxf.handle)
        psdict[name] = ph
        handles[name] = ph.dxf.handle
    c.params["placeholder_handles"] = handles
    lr = c.layer("LRED", color=3)
    doc.layers.get(lr).dxf.plotstyle_handle = handles["Red"]
    lm = c.layer("LMAG", color=3)
    doc.layers.get(lm).dxf.plotstyle_handle = handles["Magenta"]
    byblock = []
    rows = []

    def line(space, p0, p1, desc, enum=None, style=None, layer="0"):
        a = {"color": 3, "lineweight": 0, "layer": layer}
        if enum is not None and enum != 1:
            a["plotstyle_enum"] = enum
        if style:
            a["plotstyle_handle"] = handles[style]
        e = space.add_line(p0, p1, dxfattribs=a)
        if enum == 1:
            byblock.append(e.dxf.handle)
        rows.append((p0[1], desc))
        return e

    y = 140
    for desc, enum, style, layer in [
        ("380=0 BYLAYER on LRED", 0, None, lr),
        ("380=1 BYBLOCK top level, layer 0", 1, None, "0"),
        ("380=2 dictionary default, LRED", 2, None, lr),
        ("380=3 + 390 Blue, LRED", 3, "Blue", lr),
        ("380=3 + 390 Missing (in the dictionary, not in the STB), LRED", 3, "Missing", lr),
        ("380=3 + 390 Thick, layer 0", 3, "Thick", "0"),
        ("380 absent, no 390, LMAG", None, None, lm),
        ("380=3 without 390, LMAG", 3, None, lm),
        ("380=1 BYBLOCK top level, LMAG", 1, None, lm),
    ]:
        line(c.msp, (10, y), (90, y), desc, enum, style, layer)
        y -= 10
    c.params["rows_left"] = rows[:]
    rows.clear()

    blk = doc.blocks.new("PSB")
    line(blk, (0, 0), (80, 0), "380=1 BYBLOCK, layer 0", 1)
    line(blk, (0, -6), (80, -6), "380 absent, layer 0")
    line(blk, (0, -12), (80, -12), "380=0 BYLAYER, LMAG", 0, None, lm)
    line(blk, (0, -18), (80, -18), "380=3 Thick, layer 0", 3, "Thick")
    c.params["block_rows"] = [d for _, d in rows]
    inserts = [
        (140, "INSERT 380=3 Blue, layer 0", {"plotstyle_enum": 3, "plotstyle_handle": handles["Blue"]}),
        (110, "INSERT 380=0 BYLAYER, LRED", {"plotstyle_enum": 0, "layer": lr}),
        (80, "INSERT 380=1 BYBLOCK top level, layer 0", None),
        (50, "INSERT 380=2 dictionary default, LRED", {"plotstyle_enum": 2, "layer": lr}),
        (20, "INSERT 380=3 Blue, LRED", {"plotstyle_enum": 3, "plotstyle_handle": handles["Blue"], "layer": lr}),
    ]
    for iy, _, a in inserts:
        e = c.msp.add_blockref("PSB", (110, iy), dxfattribs=a or {})
        if a is None:
            byblock.append(e.dxf.handle)
    c.params["inserts"] = {"x": 110, "rows dy 0/-6/-12/-18": c.params["block_rows"], "at": [(iy, d) for iy, d, _ in inserts]}
    c.byte_filters.append(_force_380_byblock(byblock))
    c.window((0, 0), (200, 150))


# --- colour policy x colour/mode_color matrix ---------------------------------------------------

MATRIX_VARIANTS = [
    ("color -1, no mode_color", {"color": OBJECT_COLOR}),
    ("color blue C2, no mode_color", {"color": rgb_color(*BLUE)}),
    ("color blue C2, mode_color blue C2", {"color": rgb_color(*BLUE), "mode_color": rgb_color(*BLUE)}),
    ("color -1, mode_color blue C2", {"color": OBJECT_COLOR, "mode_color": rgb_color(*BLUE)}),
]
# 32 saturated / distinct object ACIs (row = variant, column = policy 0..7)
MATRIX_ACIS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160,
               170, 180, 190, 200, 210, 220, 230, 240, 11, 21, 31, 41, 51, 61, 71, 81]


def _color_matrix(s: SuiteBuilder) -> None:
    pens = {}
    desc = {}
    for r, (d, over) in enumerate(MATRIX_VARIANTS):
        for p in range(8):
            aci = MATRIX_ACIS[8 * r + p]
            pens[aci] = {**over, "color_policy": p}
            desc[aci] = f"policy {p}, {d}"
    for name, table in (("pen-color-matrix", "custom"), ("pen-color-matrix-ref", "acad.ctb")):
        c = s.case(
            name,
            "colour_policy 0-7 (columns) x pen colour/mode_color variants (rows) on SOLID swatches"
            + (" (reference: acad.ctb = object colours)" if table != "custom" else ""),
            tags=["CTB", "color", "SOLID"],
            questions=["Q-0225", "Q-0751"],
            params={
                "pens": desc,
                "layout": "8 columns (policy) x 4 rows (variant), swatch (row r, col p) = SOLID (6+24p .. 26+24p, 110-36r .. 140-36r), ACI = MATRIX_ACIS[8r+p]",
                "acis": MATRIX_ACIS,
            },
            outputs=["png"],
            style_table="acad.ctb",
        )
        if table == "custom":
            c.plot_style_table("truedxf-pen-color-matrix.ctb", ctb_bytes(pens))
        for k, aci in enumerate(MATRIX_ACIS):
            r, p = divmod(k, 8)
            solid_rect(c.msp, 6 + 24 * p, 110 - 36 * r, 26 + 24 * p, 140 - 36 * r, {"color": aci})
        c.window((0, 0), (200, 150))


# --- pen selection through BYLAYER / BYBLOCK / ACI 7 ---------------------------------------------


def _pen_resolution(s: SuiteBuilder) -> None:
    pens = {
        7: {"color": rgb_color(255, 0, 0), "color_policy": 5, "lineweight": 4},  # red, 4th entry
        2: {"color": rgb_color(0, 0, 255), "color_policy": 5, "lineweight": 8},  # blue, 8th entry
    }
    c = s.case(
        "pen-resolution",
        "Pens 7 (red) and 2 (blue) with lineweights, applied to ACI 7, BYLAYER (layer 7 / layer 2), BYBLOCK in INSERTs of colour 7/2/BYLAYER, layer-0 block content",
        tags=["CTB", "color", "BYLAYER", "BYBLOCK", "INSERT"],
        questions=["Q-0223", "Q-0195"],
        params={
            "pens": pens,
            "lineweight_table_mm": LW_PROBE,
            "rows": "LINE x 10..90 at y = 140 - 12k (left); INSERT rows at x 110..190 (right)",
        },
        outputs=["png"],
    )
    c.plot_style_table("truedxf-pen-resolution.ctb", ctb_bytes(pens, LW_PROBE))
    l7 = c.layer("L7", color=7)
    l2 = c.layer("L2", color=2)
    rows = [
        ("62=7", {"color": 7}),
        ("BYLAYER on L7", {"layer": l7}),
        ("BYLAYER on L2", {"layer": l2}),
        ("62=2", {"color": 2}),
        ("62=7 on L2", {"color": 7, "layer": l2}),
    ]
    for k, (_, a) in enumerate(rows):
        y = 140 - 12 * k
        c.msp.add_line((10, y), (90, y), dxfattribs={"lineweight": 0, **a})
    blk = c.doc.blocks.new("PB")
    blk.add_line((0, 0), (80, 0), dxfattribs={"color": 0, "lineweight": 0})  # BYBLOCK
    blk.add_line((0, -5), (80, -5), dxfattribs={"color": 256, "lineweight": 0, "layer": "0"})  # BYLAYER on 0
    ins = [
        ("INSERT 62=7 layer 0", {"color": 7}),
        ("INSERT 62=2 layer 0", {"color": 2}),
        ("INSERT BYLAYER on L7", {"layer": l7}),
        ("INSERT BYLAYER on L2", {"layer": l2}),
    ]
    for k, (_, a) in enumerate(ins):
        c.msp.add_blockref("PB", (110, 140 - 20 * k), dxfattribs=a)
    c.params["left"] = [d for d, _ in rows]
    c.params["inserts"] = {"rows": [d for d, _ in ins], "block": ["BYBLOCK at dy 0", "BYLAYER layer 0 at dy -5"], "y": "140 - 20k"}
    c.window((0, 0), (200, 150))


# --- CTB linetypes: measured on long/short lines, curves, object linetypes (Q-0228) -----------

# per pen row k (pen ACI k+1 -> CTB linetype k): (x0, x1, dy) in drawing units; window 0..200 at
# 10 px/unit = 0.1 in/unit on the 20 x 15 in sheet. Lengths are deliberately not multiples of
# 0.05 in, so whole-pattern fits and end phases are visible.
LT_LINES = ((10.0, 183.37, 0.0), (10.0, 11.2, -2.0), (15.0, 18.3, -2.0), (25.0, 66.1, -2.0))


def _lt_pens(adaptive: bool, size: float) -> dict:
    return {k + 1: {"linetype": k, "adaptive_linetype": adaptive, "linepattern_size": size} for k in range(31)}


def _lt_rows(c, f: float = 1.0) -> None:
    for k in range(31):
        y = 146 - 4.7 * k
        for x0, x1, dy in LT_LINES:
            c.msp.add_line((x0 * f, (y + dy) * f), (x1 * f, (y + dy) * f), dxfattribs={"color": k + 1, "lineweight": 0})


def _linetypes(s: SuiteBuilder) -> None:
    variants = [
        # name, adaptive, linepattern_size, geometry factor (window 200 * f), outputs, PDF units
        ("lt-fixed", False, 0.5, 1, ["png", "pdf"], None),
        ("lt-adaptive", True, 0.5, 1, ["png", "pdf"], None),
        ("lt-fixed-size-1", False, 1.0, 1, ["png", "pdf"], None),
        ("lt-adaptive-size-1", True, 1.0, 1, ["png", "pdf"], None),
        ("lt-fixed-size-0-2", False, 0.2, 1, ["png", "pdf"], None),
        ("lt-fixed-scale-half", False, 0.5, 2, ["png", "pdf"], None),
        ("lt-fixed-mm", False, 0.5, 1, ["pdf"], "mm"),
    ]
    for name, adaptive, size, f, outputs, units in variants:
        c = s.case(
            name,
            f"CTB pen linetypes 0-30 (pen ACI k+1 -> linetype k), adaptive {adaptive}, linepattern_size {size}, "
            f"hairline LINEs of 17.337 / 0.12 / 0.33 / 4.11 in on paper"
            + (f", geometry x{f} with window x{f} (plot scale 1/{f})" if f != 1 else "")
            + (f", PDF paper units {units}" if units else ""),
            tags=["CTB", "linetype", "LINE"],
            questions=["Q-0228"],
            params={
                "rows": "pen ACI k+1 (k = 0..30): y = 146 - 4.7k (x f); lines (x0, x1, dy) = LT_LINES",
                "lines": LT_LINES,
                "factor": f,
                "paper_in_per_unit": 0.1 / f,
            },
            outputs=outputs,
        )
        c.plot_style_table(f"truedxf-{name}.ctb", ctb_bytes(_lt_pens(adaptive, size)))
        _lt_rows(c, f)
        c.window((0, 0), (200 * f, 150 * f))
        if units:
            c.plot.extra["paperUnits"] = units

    # curves, polylines, reversed lines, thick lines
    lts = (2, 4, 11, 23)
    pens = {}
    for i, lt in enumerate(lts):
        pens[1 + i] = {"linetype": lt, "adaptive_linetype": False}
        pens[5 + i] = {"linetype": lt, "adaptive_linetype": True}
    c = s.case(
        "lt-curves",
        "CTB pen linetypes 2/4/11/23 (pens 1-4 fixed, 5-8 adaptive) on CIRCLE, ARC, LWPOLYLINE zigzag (plinegen off/on), reversed LINE, 1.00 mm LINE",
        tags=["CTB", "linetype", "CIRCLE", "ARC", "LWPOLYLINE"],
        questions=["Q-0228"],
        params={
            "pens": pens,
            "rows": "pen ACI k+1 (k = 0..7): y = 140 - 17.5k; CIRCLE c=(15, y-6) r=6; ARC c=(15,y-6) r=3 0..270 deg; "
            "zigzag (30,y)-(43.7,y-8)-(57.4,y)-(71.1,y-8)-(84.8,y) plinegen off; same +60 in x plinegen on; "
            "LINE (190,y)->(150.3,y) (reversed); LINE (150.3,y-8)->(190,y-8) lineweight 1.00 mm",
        },
        outputs=["png", "pdf"],
    )
    c.plot_style_table("truedxf-lt-curves.ctb", ctb_bytes(pens))
    for k in range(8):
        y = 140 - 17.5 * k
        a = {"color": k + 1, "lineweight": 0}
        c.msp.add_circle((15, y - 6), 6, dxfattribs=a)
        c.msp.add_arc((15, y - 6), 3, 0, 270, dxfattribs=a)
        for dx, gen in ((0, False), (60, True)):
            pl = c.msp.add_lwpolyline(
                [(30 + dx, y), (43.7 + dx, y - 8), (57.4 + dx, y), (71.1 + dx, y - 8), (84.8 + dx, y)], dxfattribs=a
            )
            if gen:
                pl.dxf.flags = pl.dxf.flags | 128
        c.msp.add_line((190, y), (150.3, y), dxfattribs=a)
        c.msp.add_line((150.3, y - 8), (190, y - 8), dxfattribs={**a, "lineweight": 100})
    c.window((0, 0), (200, 150))

    # pen linetype vs the object's own linetype, entity ltscale and LTSCALE
    pens = {
        1: {},  # object linetype (31)
        2: {"linetype": 4, "adaptive_linetype": False},
        3: {"linetype": 4, "adaptive_linetype": True},
        4: {"linetype": 0, "adaptive_linetype": False},
    }
    for name, ltscale in (("lt-object", 1.0), ("lt-object-ltscale-2", 2.0)):
        c = s.case(
            name,
            f"Pens 1 (object linetype), 2 (linetype 4 fixed), 3 (linetype 4 adaptive), 4 (linetype 0 solid) on LINEs with object "
            f"linetype Continuous / DASHED / DASHED + entity ltscale 3; $LTSCALE {ltscale}",
            tags=["CTB", "linetype", "LTSCALE", "LINE"],
            questions=["Q-0228"],
            header={"$LTSCALE": ltscale},
            params={
                "pens": pens,
                "rows": "row r = 3*(pen-1) + j, y = 140 - 11r, LINE x 10..183.37; j = 0 Continuous, 1 DASHED, 2 DASHED ltscale 3",
            },
            outputs=["png", "pdf"],
        )
        c.plot_style_table(f"truedxf-{name}.ctb", ctb_bytes(pens))
        dashed = c.linetype("DASHED")
        for p in range(1, 5):
            for j, attrs in enumerate(({}, {"linetype": dashed}, {"linetype": dashed, "ltscale": 3.0})):
                y = 140 - 11 * (3 * (p - 1) + j)
                c.msp.add_line((10, y), (183.37, y), dxfattribs={"color": p, "lineweight": 0, **attrs})
        c.window((0, 0), (200, 150))

    # paper space: a viewport at scale 0.5 with PSLTSCALE 1 vs the same lines in paper space
    c = s.case(
        "lt-layout-psltscale",
        "Layout (paper mm, window 0..200 x 0..150 at 10 px/mm): viewport scale 0.5 over model LINEs and the same LINEs in paper space; "
        "pen 2 = linetype 4 fixed, pen 1 = object (DASHED); PSLTSCALE 1",
        tags=["CTB", "linetype", "PSLTSCALE", "VIEWPORT"],
        questions=["Q-0228"],
        header={"$PSLTSCALE": 1},
        params={
            "viewport": "centre (100,110) size (190,70) paper, view centre (200,70) model, view height 140 (scale 0.5)",
            "model": "LINEs x 20..366.74 at model y 30 (pen 2), 50 (pen 1 DASHED), 70 (pen 2 DASHED), 90 (pen 1 Continuous)",
            "paper": "LINEs x 10..183.37 at paper y 60 (pen 2), 45 (pen 1 DASHED), 30 (pen 2 DASHED)",
        },
        outputs=["png", "pdf"],
    )
    pens = {1: {}, 2: {"linetype": 4, "adaptive_linetype": False}}
    c.plot_style_table("truedxf-lt-layout-psltscale.ctb", ctb_bytes(pens))
    dashed = c.linetype("DASHED")
    lay = c.doc.layouts.get("Layout1")
    lay.page_setup(size=(200, 150), margins=(0, 0, 0, 0), units="mm")
    vp = lay.add_viewport(center=(100, 110), size=(190, 70), view_center_point=(200, 70), view_height=140)
    vp.dxf.layer = "0"
    for y, aci, lt in ((30, 2, None), (50, 1, dashed), (70, 2, dashed), (90, 1, None)):
        c.msp.add_line((20, y), (366.74, y), dxfattribs={"color": aci, "lineweight": 0, **({"linetype": lt} if lt else {})})
    for y, aci, lt in ((60, 2, None), (45, 1, dashed), (30, 2, dashed)):
        lay.add_line((10, y), (183.37, y), dxfattribs={"color": aci, "lineweight": 0, **({"linetype": lt} if lt else {})})
    c.layout_window("Layout1", (0, 0), (200, 150))


# --- CTB fill styles: geometry, phase and scale (Q-0752 follow-up) ------------------------------


def _fill_cells(c, f: float = 1.0) -> None:
    """Column k (pen k+2 = fill style 65+k of Fill Patterns.ctb), x0 = 5 + 24k: SOLID squares
    20 x 20 at y 120 (unshifted), 95 (+0.13, +0.37) and 70 (+0.55, +0.71); solid HATCH at y 45;
    LWPOLYLINE width 8 along y = 32; LINE 2.11 mm along y = 15."""
    for k in range(8):
        a = {"color": k + 2}
        x0 = 5 + 24 * k
        for y0, dx, dy in ((120, 0, 0), (95, 0.13, 0.37), (70, 0.55, 0.71)):
            solid_rect(c.msp, (x0 + dx) * f, (y0 + dy) * f, (x0 + dx + 20) * f, (y0 + dy + 20) * f, a)
        h = c.msp.add_hatch(color=k + 2)
        h.paths.add_polyline_path([(x0 * f, 45 * f), ((x0 + 20) * f, 45 * f), ((x0 + 20) * f, 65 * f), (x0 * f, 65 * f)], is_closed=True)
        pl = c.msp.add_lwpolyline([(x0 * f, 32 * f), ((x0 + 20) * f, 32 * f)], dxfattribs=a)
        pl.dxf.const_width = 8 * f
        c.msp.add_line((x0 * f, 15 * f), ((x0 + 20) * f, 15 * f), dxfattribs={**a, "lineweight": 211})


def _fills(s: SuiteBuilder) -> None:
    for name, f in (("fill-phase", 1), ("fill-phase-scale-half", 2)):
        c = s.case(
            name,
            "Fill Patterns.ctb styles 65-72 (pens 2-9) on SOLID squares at three sub-unit shifts, solid HATCH, wide LWPOLYLINE, 2.11 mm LINE"
            + (f"; geometry and window x{f} (plot scale 1/{f})" if f != 1 else ""),
            tags=["CTB", "fill-style", "SOLID", "HATCH", "LWPOLYLINE"],
            questions=["Q-0752"],
            params={"layout": _fill_cells.__doc__, "factor": f},
            style_table="Fill Patterns.ctb",
            outputs=["png", "pdf"],
        )
        _fill_cells(c, f)
        c.window((0, 0), (200 * f, 150 * f))

    # which entity kinds take a fill style: every pen crosshatch (66) vs acad.ctb
    for name, table in (("fill-targets", "custom"), ("fill-targets-ref", "acad.ctb")):
        c = s.case(
            name,
            "Fill style 66 (crosshatch) on every pen" + (" (reference: acad.ctb)" if table != "custom" else "")
            + ": TrueType TEXT/MTEXT, SHX TEXT, thin and 2.11 mm LINEs, CIRCLE 1.00 mm, ANSI31 HATCH, gradient HATCH, SOLID, wide LWPOLYLINE",
            tags=["CTB", "fill-style", "TEXT", "MTEXT", "HATCH", "LINE"],
            questions=["Q-0752"],
            params={"items": "top row: TTF TEXT h 20 (y 115), SHX TEXT h 20 (y 85), MTEXT TTF h 12 (y 70); bottom: see code"},
            outputs=["png", "pdf"],
        )
        if table == "custom":
            c.plot_style_table("truedxf-fill-targets.ctb", ctb_bytes({a: {"fill_style": 66} for a in range(1, 256)}))
        a = {"color": 5}
        sans = c.style("SANS")
        shx = c.style("SHX", font="simplex.shx")
        c.msp.add_text("HEW", height=20, dxfattribs={**a, "style": sans, "insert": (10, 115)})
        c.msp.add_text("HEW", height=20, dxfattribs={**a, "style": shx, "insert": (110, 115)})
        c.msp.add_mtext("MTEXT", dxfattribs={**a, "style": sans, "char_height": 12, "insert": (10, 100)})
        c.msp.add_line((10, 70), (90, 70), dxfattribs={**a, "lineweight": 0})
        c.msp.add_line((10, 60), (90, 60), dxfattribs={**a, "lineweight": 211})
        c.msp.add_circle((130, 70), 12, dxfattribs={**a, "lineweight": 100})
        h = c.msp.add_hatch(color=5)
        h.set_pattern_fill("ANSI31", scale=1.0)
        h.paths.add_polyline_path([(10, 10), (50, 10), (50, 45), (10, 45)], is_closed=True)
        h = c.msp.add_hatch(color=5)
        h.set_gradient(color1=(0, 0, 255), color2=(255, 255, 0), rotation=0, name="LINEAR")
        h.dxf.color = 5
        h.paths.add_polyline_path([(60, 10), (100, 10), (100, 45), (60, 45)], is_closed=True)
        solid_rect(c.msp, 110, 10, 150, 45, a)
        pl = c.msp.add_lwpolyline([(160, 10), (160, 45)], dxfattribs=a)
        pl.dxf.const_width = 12
        c.window((0, 0), (200, 150))


# --- colour books and ACI + true colour (pen selection) ------------------------------------------

BOOK_ROWS = [
    ("62=1 (reference: pen 1)", {"color": 1}),
    ("62=52 (reference: pen 52)", {"color": 52}),
    ("62=52 + 420 BEBD7F + 430 RAL CLASSIC$RAL 1000", {"color": 52, "true_color": 0xBEBD7F, "color_name": "RAL CLASSIC$RAL 1000"}),
    ("62=52 + 430 RAL CLASSIC$RAL 1000 (no 420)", {"color": 52, "color_name": "RAL CLASSIC$RAL 1000"}),
    ("62=52 + 420 BEBD7F (no 430)", {"color": 52, "true_color": 0xBEBD7F}),
    ("62=1 + 420 FF0000 + 430 TRUEDXF BOOK$RED (unknown book)", {"color": 1, "true_color": 0xFF0000, "color_name": "TRUEDXF BOOK$RED"}),
    ("62=1 + 420 FF0000", {"color": 1, "true_color": 0xFF0000}),
]


def _colorbook(s: SuiteBuilder) -> None:
    c = s.case(
        "colorbook-pen",
        "Every pen green (policy 5) with lineweight index 21 (1.00 mm): which rows (ACI, colour book 430, ACI + 420) take the pen",
        tags=["CTB", "color-book", "true-color", "LINE", "SOLID"],
        questions=["Q-0222", "Q-0223"],
        params={"rows": [d for d, _ in BOOK_ROWS], "geometry": "row k: SOLID (10..60, 128-18k..140-18k), LINE (70..190, 134-18k) object lineweight 0"},
        outputs=["png", "dxf"],
    )
    c.plot_style_table("truedxf-colorbook-pen.ctb", ctb_bytes({a: {"color": rgb_color(*GREEN), "color_policy": 5, "lineweight": 21} for a in range(1, 256)}))
    for k, (_, a) in enumerate(BOOK_ROWS):
        y = 128 - 18 * k
        solid_rect(c.msp, 10, y, 60, y + 12, a)
        c.msp.add_line((70, y + 6), (190, y + 6), dxfattribs={**a, "lineweight": 0})
    c.window((0, 0), (200, 150))


# --- acad.ctb vs "plot with plot styles = No" vs no table (Q-0221) ------------------------------

REF_TRUECOLORS = [0xFF0000, 0x00FF00, 0x0000FF, 0x808080, 0xC86432, 0xFAFAFA, 0x000000, 0x3366CC]
REF_LINEWEIGHTS = [-3, 0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211]
REF_LINETYPES = ["DASHED", "DOT", "CENTER", "HIDDEN", "PHANTOM", "DASHDOT"]


def _styles_ref(s: SuiteBuilder) -> None:
    for name, table, styles in (
        ("styles-ref-acad", "acad.ctb", True),
        ("styles-ref-off", "acad.ctb", False),
        ("styles-ref-none", ".", True),
    ):
        c = s.case(
            name,
            "ACI 1-255 SOLID + LINE cells, true colours, lineweights, linetypes, TrueType text plotted with "
            + {"styles-ref-acad": "acad.ctb", "styles-ref-off": "plot styles = No", "styles-ref-none": "no table ('.')"}[name],
            tags=["CTB", "ACI", "true-color", "lineweight", "linetype"],
            questions=["Q-0221"],
            style_table=table,
            params={
                "grid": "ACI = 16*row + col, cell lower-left (2 + 8*col, 134 - 8*row): SOLID (+0.5..+4.5)^2, LINE (+5, +0.5)-(+7.5, +4.5)",
                "truecolors": REF_TRUECOLORS,
                "lineweights": REF_LINEWEIGHTS,
                "linetypes": REF_LINETYPES,
            },
            outputs=["png", "pdf"],
        )
        if not styles:
            c.plot.extra["plotStyles"] = False
        for aci in range(1, 256):
            r, k = divmod(aci, 16)
            x, y = 2 + 8 * k, 134 - 8 * r
            solid_rect(c.msp, x + 0.5, y + 0.5, x + 4.5, y + 4.5, {"color": aci})
            c.msp.add_line((x + 5, y + 0.5), (x + 7.5, y + 4.5), dxfattribs={"color": aci, "lineweight": 0})
        for i, tc in enumerate(REF_TRUECOLORS):
            c.msp.add_line((135, 146 - 2 * i), (198, 146 - 2 * i), dxfattribs={"color": 7, "true_color": tc, "lineweight": 50})
        for i, lw in enumerate(REF_LINEWEIGHTS):
            c.msp.add_line((135, 128 - 3 * i), (165, 128 - 3 * i), dxfattribs={"color": 1 + i % 7, "lineweight": lw})
        for i, lt in enumerate(REF_LINETYPES):
            c.msp.add_line((168, 128 - 6 * i), (198, 128 - 6 * i), dxfattribs={"color": 5, "linetype": c.linetype(lt), "lineweight": 0})
        c.msp.add_text("Plot", height=8, dxfattribs={"color": 3, "style": c.style("SANS"), "insert": (168, 70)})
        c.window((0, 0), (200, 150))


# --- gradient HATCH through pens (Q-0224) --------------------------------------------------------

GRAD_ROWS = [
    # description, entity 62, gradient (aci1, rgb1, aci2, rgb2, one_color, tint)
    ("62=7, ACI 1 -> ACI 5 (63 + 421)", 7, (1, (255, 0, 0), 5, (0, 0, 255), 0, 0.0)),
    ("62=1, ACI 1 -> ACI 5 (63 + 421)", 1, (1, (255, 0, 0), 5, (0, 0, 255), 0, 0.0)),
    ("62=7, one colour ACI 3, tint 0.5", 7, (3, (0, 255, 0), None, (255, 255, 255), 1, 0.5)),
    ("62=7, true colours red -> yellow (no 63)", 7, (None, (255, 0, 0), None, (255, 255, 0), 0, 0.0)),
    ("62=1, true colours 0000C0 -> 00C000 (no 63)", 1, (None, (0, 0, 192), None, (0, 192, 0), 0, 0.0)),
]


def _gradients(s: SuiteBuilder) -> None:
    for name, table in (
        ("gradient-pens-acad", "acad.ctb"),
        ("gradient-pens-off", "off"),
        ("gradient-pens-green", "custom"),
        ("gradient-pens-gray", "Grayscale.ctb"),
        ("gradient-pens-screen-50", "Screening 50%.ctb"),
    ):
        c = s.case(
            name,
            "Linear gradient HATCHes (ACI and true-colour gradient colours, entity 62 = 7 / 1) and SOLID references ACI 1/5/3 plotted with "
            + {"off": "acad.ctb, plot styles = No", "custom": "every pen green (policy 5)"}.get(table, table),
            tags=["CTB", "HATCH", "gradient", "grayscale", "screening"],
            questions=["Q-0224"],
            style_table="acad.ctb" if table in ("off", "custom") else table,
            params={"rows": [d for d, _, _ in GRAD_ROWS], "geometry": "row k: gradient HATCH (10..150, 122-27k..142-27k); SOLID refs ACI 1, 5, 3 at x 160..190 rows 0-2"},
            outputs=["png"],
        )
        if table == "off":
            c.plot.extra["plotStyles"] = False
        if table == "custom":
            c.plot_style_table("truedxf-gradient-pens-green.ctb", ctb_bytes({a: {"color": rgb_color(*GREEN), "color_policy": 5} for a in range(1, 256)}))
        for k, (_, ent, (a1, c1, a2, c2, one, tint)) in enumerate(GRAD_ROWS):
            y = 122 - 27 * k
            h = c.msp.add_hatch(color=ent)
            h.set_gradient(color1=c1, color2=c2, rotation=0, name="LINEAR", one_color=one, tint=tint)
            h.gradient.aci1 = a1
            h.gradient.aci2 = a2
            h.paths.add_polyline_path([(10, y), (150, y), (150, y + 20), (10, y + 20)], is_closed=True)
        for k, aci in enumerate((1, 5, 3)):
            y = 122 - 27 * k
            solid_rect(c.msp, 160, y, 190, y + 20, {"color": aci})
        c.window((0, 0), (200, 150))


# --- fill-style tile anchor (Q-0760) -------------------------------------------------------------

# Probe sheets whose printable sizes are not multiples of 10/20 px (tools/acad/src/sizes.ts):
# 1017 x 1013 without margins, 1030 x 1017 with margins L/B/R/T 3/7/11/13 (printable 1016 x 997).
ODD_CANVAS = (1017, 1013)
ODD_MARGIN_CANVAS = (1030, 1017)
ODD_MARGINS = (3, 7, 11, 13)


def _anchor_strips(space, pw: float, ph: float) -> None:
    """Eight SOLID strips across the paper x range 0..pw (strip k = pen k+2 = Fill Patterns.ctb
    fill style 65+k), 4 units apart, each from y = -200 to ph + 200 (clipped by the sheet)."""
    for k in range(8):
        x0 = -200 if k == 0 else k * pw / 8 + 2
        x1 = pw + 200 if k == 7 else (k + 1) * pw / 8 - 2
        solid_rect(space, round(x0, 3), -200, round(x1, 3), ph + 200, {"color": k + 2})


ANCHOR_LAYOUT = (
    "8 SOLID strips over the paper x range 0..W (W x H = printable paper of the rotation, paper units = px), "
    "strip k = pen k+2 = fill style 65+k, from y -200 to H+200"
)


def _fill_anchor(s: SuiteBuilder) -> None:
    from .pagesetup import _pagesetup_plot, _raster_setup

    sheets = {
        "": (ODD_CANVAS, (0, 0, 0, 0)),
        "-margins": (ODD_MARGIN_CANVAS, ODD_MARGINS),
    }
    variants = [(sheet, rot, (0, 0)) for sheet in sheets for rot in range(4)]
    variants += [("-margins", 0, (13, 7)), ("-margins", 1, (13, 7))]
    for sheet, rot, off in variants:
        canvas, margins = sheets[sheet]
        pw, ph = canvas[0] - margins[0] - margins[2], canvas[1] - margins[1] - margins[3]
        if rot in (1, 3):
            pw, ph = ph, pw
        name = f"fill-anchor{sheet}-rot-{rot}" + ("-offset" if off != (0, 0) else "")
        c = s.case(
            name,
            f"Fill Patterns.ctb styles 65-72 on full-height SOLID strips, raster page setup {canvas[0]}x{canvas[1]} px "
            f"(margins L/B/R/T {margins}), rotation 73={rot}, plot type layout 1:1, 46/47={off}: where is the tile anchored?",
            tags=["CTB", "fill-style", "SOLID", "pagesetup", "rotation"],
            questions=["Q-0760"],
            params={"layout": ANCHOR_LAYOUT, "paper": [pw, ph], "canvas": list(canvas), "margins": list(margins),
                    "offset": list(off)},
            style_table="Fill Patterns.ctb",
            outputs=["png"],
        )
        _raster_setup(c, rotation=rot, canvas=canvas, margins=margins, offset=off, style_sheet="Fill Patterns.ctb",
                      media=f"UserDefinedRaster ({canvas[0]:.2f} x {canvas[1]:.2f}Pixels)")
        _anchor_strips(c.doc.layouts.get("Layout1"), pw, ph)
        _pagesetup_plot(c)
        c.plot.canvas = canvas

    # the same through a detailed -PLOT of a model window (Fit, centred = 1 px/unit), and at 1:1
    # with an offset of 13,7 px
    for name, off in (("fill-anchor-window", None), ("fill-anchor-window-offset", "13,7")):
        c = s.case(
            name,
            "Fill Patterns.ctb styles 65-72 on full-height SOLID strips, model window 1017 x 1013 on the 1017x1013 px sheet"
            + (f", scale 1:1, offset {off} px" if off else " (fit = 1 px/unit, centred)"),
            tags=["CTB", "fill-style", "SOLID"],
            questions=["Q-0760"],
            params={"layout": ANCHOR_LAYOUT.replace("paper", "model"), "paper": list(ODD_CANVAS), "offset": off},
            style_table="Fill Patterns.ctb",
            outputs=["png"],
        )
        _anchor_strips(c.msp, *ODD_CANVAS)
        c.window((0, 0), ODD_CANVAS, canvas=ODD_CANVAS)
        if off:
            c.plot.scale = "1:1"
            c.plot.extra["offset"] = off


# --- pen linetypes on wide lines: caps and joins of the dashes (Q-0761) ---------------------------

LT_WIDE_ROWS = (
    "left: LINE (10,y)-(52.3,y) per pen 1-4, 18, 20-24 (y = 142 - 9i); reference pens 5-8 / 19 as separate LINEs at "
    "the model dashes (+50 in x; dots: zero-length LINEs). Right: LWPOLYLINE (110,y-4)-(112.5,y-4)-(112.5,y+0.5)-"
    "(125,y+0.5) per pen 10-13, 18 (y = 140 - 16j); reference pens 14-17 / 19 at +40 in x: the first dash as a "
    "polyline through the vertex, the second dash as a LINE"
)


def _lt_wide(s: SuiteBuilder) -> None:
    # pen linetype 8 (Medium Dash X2, 0.5 in / 0.5 in = 50 / 50 px) and 16 (Sparse Dot, one dot
    # per 0.5 in), fixed, so the dashes are known exactly (note 06 §6.7): [0,50], [100,150], ...,
    # [400,423] px from the start point of the 42.3-unit LINE; dots every 50 px
    pens: dict[int, dict] = {}
    for e in range(4):
        pens[1 + e] = {"linetype": 8, "adaptive_linetype": False, "lineweight": 1, "end_style": e}
        pens[5 + e] = {"linetype": 0, "lineweight": 1, "end_style": e}
        pens[10 + e] = {"linetype": 8, "adaptive_linetype": False, "lineweight": 1, "end_style": 0, "join_style": e}
        pens[14 + e] = {"linetype": 0, "lineweight": 1, "end_style": 0, "join_style": e}
        pens[20 + e] = {"linetype": 16, "adaptive_linetype": False, "lineweight": 1, "end_style": e}
    pens[18] = {"linetype": 8, "adaptive_linetype": False, "lineweight": 1}
    pens[19] = {"linetype": 0, "lineweight": 1}
    pens[24] = {"linetype": 16, "adaptive_linetype": False, "lineweight": 1}
    pens = dict(sorted(pens.items()))
    ref = {1: 5, 2: 6, 3: 7, 4: 8, 18: 19, 20: 5, 21: 6, 22: 7, 23: 8, 24: 19}
    for name, mm in (("lt-wide-508", 5.08), ("lt-wide-100", 1.0)):
        c = s.case(
            name,
            f"CTB pen linetypes 8 (dash 0.5 in) and 16 (sparse dot) on {mm:.2f} mm lines: end styles 0-3/object per dash, "
            "join styles 0-3 at a polyline vertex inside a dash, against solid-pen references of the same dashes",
            tags=["CTB", "linetype", "lineweight", "caps", "joins", "LINE", "LWPOLYLINE"],
            questions=["Q-0761"],
            params={"pens": pens, "reference_pen": ref, "lineweight_mm": mm, "rows": LT_WIDE_ROWS},
            outputs=["png", "pdf"],
        )
        c.plot_style_table(f"truedxf-{name}.ctb", ctb_bytes(pens, tuple([mm] * 27)))
        for i, p in enumerate((1, 2, 3, 4, 18, 20, 21, 22, 23, 24)):
            y = 142 - 9 * i
            c.msp.add_line((10, y), (52.3, y), dxfattribs={"color": p, "lineweight": 0})
            r = {"color": ref[p], "lineweight": 0}
            if p < 20:
                for x0, x1 in ((60, 65), (70, 75), (80, 85), (90, 95), (100, 102.3)):
                    c.msp.add_line((x0, y), (x1, y), dxfattribs=r)
            else:
                for k in range(9):
                    c.msp.add_line((60 + 5 * k, y), (60 + 5 * k, y), dxfattribs=r)
        for j, p in enumerate((10, 11, 12, 13, 18)):
            y = 140 - 16 * j
            c.msp.add_lwpolyline([(110, y - 4), (112.5, y - 4), (112.5, y + 0.5), (125, y + 0.5)],
                                 dxfattribs={"color": p, "lineweight": 0})
            r = {"color": 14 + j if p != 18 else 19, "lineweight": 0}
            c.msp.add_lwpolyline([(150, y - 4), (152.5, y - 4), (152.5, y - 1.5)], dxfattribs=r)
            c.msp.add_line((155.5, y + 0.5), (160.5, y + 0.5), dxfattribs=r)
        c.window((0, 0), (200, 150))
