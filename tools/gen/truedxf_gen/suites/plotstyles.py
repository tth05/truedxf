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
