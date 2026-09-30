"""Colours: ACI 1-255 swatches, ACI 7/255/greys on white paper, true colour (420) vs ACI (62),
colour books (430), BYLAYER/BYBLOCK, layer colour/visibility states, model vs paper palette,
monochrome.ctb (note 06 §3, §6.3, §7; note 02 LAYER; note 08 §5.5; note 11a §15)."""

from __future__ import annotations

from ezdxf.enums import TextEntityAlignment

from ..core import SuiteBuilder, suite
from ._appearance_util import hatch_rect, label, ref_line, solid_rect

_LEFT = TextEntityAlignment.MIDDLE_LEFT

ACI_BLOCKS = [
    list(range(1, 10)),
    *[list(range(a, a + 40)) for a in range(10, 250, 40)],
    list(range(250, 256)),
]


def _aci_swatches(c, space, values, cols: int, x0=5.0, x1=195.0, y0=6.0, y1=146.0, lines=False):
    """Grid of SOLID swatches (one per ACI) with the ACI number printed under each swatch.
    With ``lines`` a 1.00 mm and a hairline LINE of the same ACI are drawn in each cell too."""
    rows = (len(values) + cols - 1) // cols
    px = (x1 - x0) / cols
    py = (y1 - y0) / rows
    lab = min(3.0, py * 0.12)
    sw = px * 0.8
    shgt = (py - lab * 2.4) * 0.92  # swatch height (tall rectangles for single-row blocks)
    cells = {}
    for i, aci in enumerate(values):
        r, k = divmod(i, cols)
        cx = x0 + px * (k + 0.5)
        top = y1 - py * r
        sy1 = top - py * 0.03
        sy0 = sy1 - shgt
        if lines:
            sy0 = sy1 - shgt * 0.6
        solid_rect(space, cx - sw / 2, sy0, cx + sw / 2, sy1, {"color": aci})
        if lines:
            ly = sy0 - shgt * 0.12
            space.add_line((cx - sw / 2, ly), (cx + sw / 2, ly), dxfattribs={"color": aci, "lineweight": 100})
            ly2 = sy0 - shgt * 0.24
            space.add_line((cx - sw / 2, ly2), (cx + sw / 2, ly2), dxfattribs={"color": aci, "lineweight": 0})
            label(c, space, str(aci), cx, sy0 - shgt * 0.3 - lab * 1.2, h=lab)
        else:
            label(c, space, str(aci), cx, sy0 - lab * 0.9, h=lab)
        cells[aci] = [round(cx - sw / 2, 4), round(sy0, 4), round(cx + sw / 2, 4), round(sy1, 4)]
    return cells


def _grey_backing(space, x0, y0, x1, y1):
    """Mid-grey true-colour backing so white swatches stay detectable."""
    solid_rect(space, x0, y0, x1, y1, {"color": 8, "true_color": 0x808080})


@suite("colors", "ACI / true colour / colour books / BYLAYER-BYBLOCK / layer states in PLOT", style_table="acad.ctb")
def build(s: SuiteBuilder) -> None:
    # --- full ACI grid: 16x16 cells, ACI = 16*row + col (row 0 at the top), ACI 0 cell empty
    for ctb, suffix in (("acad.ctb", ""), ("monochrome.ctb", "-mono")):
        c = s.case(
            f"aci-grid-full{suffix}",
            f"16x16 SOLID swatch grid of ACI 1-255 (ACI = 16*row+col, row 0 on top), {ctb}",
            tags=["SOLID", "ACI", "palette"] + (["monochrome"] if suffix else []),
            questions=["Q-0193"] + (["Q-0223"] if suffix else []),
            params={"layout": "cell 9x9 units, swatch 8x8; cell (row,col) lower-left = (28+9*col, 138-9*row)", "styleTable": ctb},
            style_table=ctb,
        )
        for aci in range(1, 256):
            r, k = divmod(aci, 16)
            x = 28 + 9 * k
            y = 138 - 9 * r
            solid_rect(c.msp, x + 0.5, y + 0.5, x + 8.5, y + 8.5, {"color": aci})
        ref_line(c, c.msp, (28, 138), (37, 147))  # diagonal marks the empty ACI 0 cell
        c.window((0, 0), (200, 150))

    # --- ACI blocks with labels (one case per block of values)
    for i, vals in enumerate(ACI_BLOCKS, 1):
        cols = 10 if len(vals) == 40 else len(vals)
        c = s.case(
            f"aci-block-{i:04d}",
            f"Labelled SOLID swatches ACI {vals[0]}-{vals[-1]}",
            tags=["SOLID", "ACI", "palette"],
            questions=["Q-0193"] + (["Q-0194"] if vals[0] == 250 else []),
            params={"aci": [vals[0], vals[-1]], "columns": cols},
        )
        cells = _aci_swatches(c, c.msp, vals, cols)
        c.params["cells"] = {str(k): v for k, v in cells.items()}
        c.window((0, 0), (200, 150))

    # --- fills vs lines: SOLID, solid HATCH and 1.00 mm LINE per ACI 1-9
    c = s.case("fill-types-aci", "ACI 1-9: SOLID (top), solid HATCH (middle), 1.00 mm LINE (bottom) per column", tags=["SOLID", "HATCH", "LINE", "ACI"], questions=["Q-0193"])
    for k, aci in enumerate(range(1, 10)):
        x = 8 + k * 21
        solid_rect(c.msp, x, 105, x + 16, 135, {"color": aci})
        hatch_rect(c.msp, x, 65, x + 16, 95, {"color": aci})
        c.msp.add_line((x + 8, 22), (x + 8, 55), dxfattribs={"color": aci, "lineweight": 100})
        label(c, c.msp, str(aci), x + 8, 12)
    c.window((0, 0), (200, 150))

    # --- greys on white paper (swatch + 1.00 mm line + hairline per ACI)
    greys = [7, 8, 9, 250, 251, 252, 253, 254, 255]
    c = s.case("greys-white-paper", "ACI 7, 8, 9, 250-255: SOLID swatch, 1.00 mm LINE and hairline LINE on white paper", tags=["SOLID", "LINE", "ACI", "greys"], questions=["Q-0194", "Q-0196"])
    _aci_swatches(c, c.msp, greys, len(greys), lines=True)
    c.window((0, 0), (200, 150))

    # --- ACI 7 / ACI 255 / true white / true black / near-white over a grey backing band
    c = s.case(
        "white-black-swatches",
        "Vertical swatches ACI 7, ACI 255, 420 white/black/near-white/near-black, ACI 250 crossing a grey band",
        tags=["SOLID", "ACI", "true-color"],
        questions=["Q-0196"],
    )
    _grey_backing(c.msp, 4, 60, 196, 90)
    specs = [
        ("ACI 7", {"color": 7}),
        ("ACI 255", {"color": 255}),
        ("FFFFFF", {"color": 7, "true_color": 0xFFFFFF}),
        ("000000", {"color": 7, "true_color": 0x000000}),
        ("FEFEFE", {"color": 255, "true_color": 0xFEFEFE}),
        ("010101", {"color": 250, "true_color": 0x010101}),
        ("ACI 250", {"color": 250}),
        ("ACI 254", {"color": 254}),
    ]
    for k, (name, a) in enumerate(specs):
        x = 10 + k * 23.5
        solid_rect(c.msp, x, 25, x + 16, 125, a)
        label(c, c.msp, name, x + 8, 15, h=3)
        ref_line(c, c.msp, (x - 1, 24), (x + 17, 24))
        ref_line(c, c.msp, (x - 1, 126), (x + 17, 126))
    c.params["swatches"] = [n for n, _ in specs]
    c.window((0, 0), (200, 150))

    # --- ACI 7 resolution paths (direct / BYLAYER on colour-7 layer / BYBLOCK in colour-7 INSERT)
    def aci7_column(c, space, x, a):
        space.add_line((x, 30), (x + 40, 30), dxfattribs={**a, "lineweight": 100})
        space.add_line((x, 20), (x + 40, 20), dxfattribs={**a, "lineweight": 0})
        hatch_rect(space, x, 45, x + 40, 125, a)

    for variant in ("direct", "bylayer", "byblock"):
        c = s.case(f"aci7-{variant}", f"ACI 7 via {variant}: 1.00 mm LINE, hairline LINE and solid HATCH (plot black?)", tags=["LINE", "HATCH", "ACI", "ACI7", variant.upper()], questions=["Q-0195"])
        if variant == "direct":
            aci7_column(c, c.msp, 80, {"color": 7})
        elif variant == "bylayer":
            c.layer("L7", color=7)
            aci7_column(c, c.msp, 80, {"layer": "L7", "color": 256})
        else:
            b = c.doc.blocks.new("ACI7BLK")
            aci7_column(c, b, 0, {"color": 0})
            c.layer("L3", color=3)
            c.msp.add_blockref("ACI7BLK", (80, 0), dxfattribs={"color": 7, "layer": "L3"})
        solid_rect(c.msp, 20, 45, 50, 125, {"color": 1})  # colour reference
        label(c, c.msp, variant, 100, 138)
        c.window((0, 0), (200, 150))
    c = s.case("aci7-variants-mono", "ACI 7 direct / BYLAYER / BYBLOCK columns plotted with monochrome.ctb", tags=["LINE", "HATCH", "ACI7", "monochrome"], questions=["Q-0195", "Q-0223"], style_table="monochrome.ctb")
    aci7_column(c, c.msp, 10, {"color": 7})
    c.layer("L7", color=7)
    aci7_column(c, c.msp, 80, {"layer": "L7"})
    b = c.doc.blocks.new("ACI7BLK")
    aci7_column(c, b, 0, {"color": 0})
    c.msp.add_blockref("ACI7BLK", (150, 0), dxfattribs={"color": 7})
    c.window((0, 0), (200, 150))

    # --- top-level BYBLOCK
    c = s.case("byblock-toplevel", "Model-space LINE/HATCH with colour BYBLOCK (62=0) next to ACI 7 and ACI 1 references", tags=["LINE", "HATCH", "BYBLOCK"], questions=["Q-0198", "Q-0278"])
    for k, (name, col) in enumerate((("62=0", 0), ("62=7", 7), ("62=1", 1))):
        x = 20 + k * 60
        c.msp.add_line((x, 30), (x + 45, 30), dxfattribs={"color": col, "lineweight": 100})
        hatch_rect(c.msp, x, 45, x + 45, 125, {"color": col})
        label(c, c.msp, name, x + 22.5, 15)
    c.window((0, 0), (200, 150))
    c = s.case("byblock-toplevel-linetype-byblock", "Model-space LINEs colour BYBLOCK with linetype BYBLOCK / DASHED / Continuous (invisible?)", tags=["LINE", "BYBLOCK", "linetype"], questions=["Q-0198"])
    c.linetype("DASHED")
    rows = [("62=0 lt=BYBLOCK", {"color": 0, "linetype": "BYBLOCK"}), ("62=0 lt=DASHED", {"color": 0, "linetype": "DASHED"}), ("62=0 lt=CONT", {"color": 0, "linetype": "Continuous"}), ("62=7 lt=BYBLOCK", {"color": 7, "linetype": "BYBLOCK"}), ("62=7 lt=CONT", {"color": 7})]
    for k, (name, a) in enumerate(rows):
        y = 130 - k * 26
        c.msp.add_line((70, y), (190, y), dxfattribs={**a, "lineweight": 50})
        label(c, c.msp, name, 5, y, align=_LEFT)
    c.window((0, 0), (200, 150))

    # --- BYBLOCK / BYLAYER colour inside an INSERT
    for name, ins, title in (
        ("aci", {"color": 1, "layer": "L3"}, "INSERT colour 1 on green layer L3"),
        ("truecolor", {"color": 1, "true_color": 0xFF8000, "layer": "L3"}, "INSERT 62=1 + 420 orange on green layer L3"),
        ("bylayer", {"layer": "L5"}, "INSERT colour BYLAYER on blue layer L5"),
    ):
        c = s.case(f"byblock-insert-{name}", f"Block with layer-0 BYBLOCK / BYLAYER / ACI 6 content; {title}", tags=["INSERT", "BYBLOCK", "BYLAYER"], questions=["Q-0278"], params={"insert": ins})
        c.layer("L3", color=3)
        c.layer("L5", color=5)
        b = c.doc.blocks.new("CONTENT")
        for k, (lab, col) in enumerate((("BYBLOCK", 0), ("BYLAYER", 256), ("ACI 6", 6))):
            x = k * 60
            hatch_rect(b, x, 40, x + 45, 120, {"color": col})
            b.add_line((x, 30), (x + 45, 30), dxfattribs={"color": col, "lineweight": 100})
            label(c, c.msp, lab, 20 + x + 22.5, 15)
        c.msp.add_blockref("CONTENT", (20, 0), dxfattribs=ins)
        c.window((0, 0), (200, 150))

    # --- negative entity colour (invalid on purpose; AutoCAD may repair or reject)
    c = s.case("negative-entity-color", "LINEs/SOLIDs with 62=-1 and 62=-5 next to 62=1 / 62=5 (invalid negative entity ACI on purpose)", tags=["LINE", "SOLID", "ACI", "invalid"], questions=["Q-0199"], params={"values": [-1, 1, -5, 5]})
    for k, v in enumerate((-1, 1, -5, 5)):
        x = 15 + k * 46
        ln = c.msp.add_line((x, 30), (x + 36, 30), dxfattribs={"lineweight": 100})
        sd = solid_rect(c.msp, x, 45, x + 36, 125)
        ln.dxf.unprotected_set("color", v)
        sd.dxf.unprotected_set("color", v)
        label(c, c.msp, f"62={v}", x + 18, 15)
    c.window((0, 0), (200, 150))

    # --- true colour vs ACI
    c = s.case("truecolor-over-aci", "420 green vs 62: (62=1+420), 62=1 only, 420 only, (BYLAYER red layer+420), (BYBLOCK+420)", tags=["LINE", "SOLID", "true-color", "ACI"], questions=["Q-0200"])
    c.layer("RED", color=1)
    specs = [
        ("62=1+420", {"color": 1, "true_color": 0x00FF00}),
        ("62=1", {"color": 1}),
        ("420 only", {"true_color": 0x00FF00}),
        ("256+420", {"layer": "RED", "color": 256, "true_color": 0x00FF00}),
        ("0+420", {"color": 0, "true_color": 0x00FF00}),
    ]
    for k, (name, a) in enumerate(specs):
        x = 8 + k * 38.5
        solid_rect(c.msp, x, 50, x + 30, 130, a)
        c.msp.add_line((x, 35), (x + 30, 35), dxfattribs={**a, "lineweight": 100})
        label(c, c.msp, name, x + 15, 18, h=3)
    c.window((0, 0), (200, 150))
    c = s.case("truecolor-zero", "420=0 edge cases: 62=18+420=0; lone 420=0; layer 62=3+420=0 with BYLAYER; refs 62=18 and 62=3", tags=["LINE", "SOLID", "true-color", "LAYER"], questions=["Q-0201"])
    c.layer("TC0", color=3, true_color=0)
    c.layer("G3", color=3)
    specs = [
        ("62=18+420=0", {"color": 18, "true_color": 0}),
        ("62=18", {"color": 18}),
        ("420=0", {"true_color": 0}),
        ("layer 3+420=0", {"layer": "TC0"}),
        ("layer 3", {"layer": "G3"}),
    ]
    for k, (name, a) in enumerate(specs):
        x = 8 + k * 38.5
        solid_rect(c.msp, x, 50, x + 30, 130, a)
        c.msp.add_line((x, 35), (x + 30, 35), dxfattribs={**a, "lineweight": 100})
        label(c, c.msp, name, x + 15, 18, h=2.5)
    c.window((0, 0), (200, 150))

    # --- true colour ramps (R, G, B, grey; 16 steps 0..255)
    c = s.case("truecolor-ramps", "420 swatch ramps: red, green, blue, grey rows, 16 steps 0x00..0xFF", tags=["SOLID", "true-color"], questions=["Q-0193", "Q-0234"], params={"steps": [17 * i for i in range(16)]})
    for r, sh in enumerate(("r", "g", "b", "k")):
        y = 115 - r * 33
        for k in range(16):
            v = 17 * k
            tc = {"r": v << 16, "g": v << 8, "b": v, "k": (v << 16) | (v << 8) | v}[sh]
            x = 4 + k * 12
            solid_rect(c.msp, x, y, x + 11, y + 28, {"color": 7, "true_color": tc})
    c.window((0, 0), (200, 150))
    for seed in range(1, 4):
        c = s.case(f"random-{seed:04d}", f"Random 420 true-colour swatches 10x7 grid, seed {seed}", tags=["SOLID", "true-color"], questions=["Q-0193"], seed=seed)
        vals = []
        for r in range(7):
            for k in range(10):
                tc = c.rng.randrange(0, 0x1000000)
                vals.append(f"{tc:06X}")
                x = 5 + k * 19
                y = 128 - r * 20
                solid_rect(c.msp, x, y, x + 18, y + 18, {"color": 7, "true_color": tc})
        c.params["colors_row_major_from_top"] = vals
        c.window((0, 0), (200, 150))

    # --- colour books (430)
    for name, a, title in (
        ("with-rgb", {"color": 52, "true_color": 0xBEBD7F, "color_name": "RAL CLASSIC$RAL 1000"}, "430 RAL CLASSIC$RAL 1000 + 420 0xBEBD7F + 62=52"),
        ("name-only", {"color": 52, "color_name": "RAL CLASSIC$RAL 1000"}, "430 RAL CLASSIC$RAL 1000 without 420 (62=52)"),
    ):
        c = s.case(f"colorbook-{name}", f"LINE + SOLID with colour book {title}; DXFOUT shows what AutoCAD keeps", tags=["LINE", "SOLID", "color-book"], questions=["Q-0202"], params={"attribs": {k: (hex(v) if k == "true_color" else v) for k, v in a.items()}})
        solid_rect(c.msp, 40, 50, 160, 130, a)
        c.msp.add_line((40, 30), (160, 30), dxfattribs={**a, "lineweight": 100})
        solid_rect(c.msp, 170, 50, 190, 130, {"color": 52})  # ACI reference
        c.window((0, 0), (200, 150))

    # --- layer colours and states
    c = s.case("layer-aci-bylayer", "BYLAYER SOLIDs/LINEs on layers with ACI 1-7 (layer 7 plots black?)", tags=["LAYER", "BYLAYER", "ACI"], questions=["Q-0195"])
    for k in range(7):
        c.layer(f"C{k + 1}", color=k + 1)
        x = 8 + k * 27
        solid_rect(c.msp, x, 50, x + 22, 130, {"layer": f"C{k + 1}"})
        c.msp.add_line((x, 35), (x + 22, 35), dxfattribs={"layer": f"C{k + 1}", "lineweight": 100})
        label(c, c.msp, f"C{k + 1}", x + 11, 18)
    c.window((0, 0), (200, 150))
    layer_states = [
        ("off", {"on": False}, "layer off (negative 62)", []),
        ("frozen", {"frozen": True}, "layer frozen (70 bit 1)", []),
        ("noplot", {"plot": False}, "layer plot flag 290=0", ["Q-0282"]),
        ("locked", {"locked": True}, "layer locked (70 bit 4)", ["Q-0284"]),
    ]
    for name, kw, title, qs in layer_states:
        c = s.case(f"layer-{name}", f"Red SOLID+LINE on a {title} next to green reference on a normal layer", tags=["LAYER", "visibility", name], questions=qs)
        c.layer("STATE", color=1, **kw)
        c.layer("NORMAL", color=3)
        for lay, x in (("STATE", 20), ("NORMAL", 110)):
            solid_rect(c.msp, x, 50, x + 70, 130, {"layer": lay})
            c.msp.add_line((x, 30), (x + 70, 30), dxfattribs={"layer": lay, "lineweight": 100})
        label(c, c.msp, name, 55, 15)
        label(c, c.msp, "normal", 145, 15)
        c.window((0, 0), (200, 150))
    for name, lname, plot, title in (
        ("no290", "Defpoints", None, "layer Defpoints without 290"),
        ("plot1", "Defpoints", 1, "layer Defpoints with 290=1"),
        ("plot0", "Defpoints", 0, "layer Defpoints with 290=0"),
        ("lowercase", "defpoints", 1, "layer 'defpoints' (lower case) with 290=1"),
    ):
        c = s.case(f"defpoints-{name}", f"Red SOLID+LINE on {title} next to green reference on layer 0", tags=["LAYER", "Defpoints", "visibility"], questions=["Q-0283"], params={"layer": lname, "plot_flag": plot})
        # ezdxf.new() already creates 'Defpoints' (290=0): modify that record
        lay = c.doc.layers.get("Defpoints")
        lay.dxf.name = lname
        lay.dxf.color = 1
        if plot is None:
            lay.dxf.discard("plot")
        else:
            lay.dxf.plot = plot
        solid_rect(c.msp, 20, 50, 90, 130, {"layer": lname})
        c.msp.add_line((20, 30), (90, 30), dxfattribs={"layer": lname, "lineweight": 100})
        solid_rect(c.msp, 110, 50, 180, 130, {"color": 3})
        c.msp.add_line((110, 30), (180, 30), dxfattribs={"color": 3, "lineweight": 100})
        label(c, c.msp, lname, 55, 15)
        c.window((0, 0), (200, 150))

    # --- layer true colour
    c = s.case("layer-truecolor", "Layer 62=1+420 orange: BYLAYER, ACI 5 entity, 420 teal entity; ACI layer 3 with 420 entity", tags=["LAYER", "true-color", "BYLAYER"], questions=["Q-0200"])
    c.layer("TCL", color=1, true_color=0xFF8000)
    c.layer("G3", color=3)
    specs = [
        ("TCL bylayer", {"layer": "TCL"}),
        ("TCL + ACI 5", {"layer": "TCL", "color": 5}),
        ("TCL + 420", {"layer": "TCL", "true_color": 0x00A0A0}),
        ("G3 + 420", {"layer": "G3", "true_color": 0x00A0A0}),
        ("G3 bylayer", {"layer": "G3"}),
    ]
    for k, (name, a) in enumerate(specs):
        x = 8 + k * 38.5
        solid_rect(c.msp, x, 50, x + 30, 130, a)
        c.msp.add_line((x, 35), (x + 30, 35), dxfattribs={**a, "lineweight": 100})
        label(c, c.msp, name, x + 15, 18, h=2.5)
    c.window((0, 0), (200, 150))
    c = s.case("layer-truecolor-white", "BYLAYER swatches on layers 62=7+420 FFFFFF, 62=7+420 000000, 62=7 and 62=255 over a grey band", tags=["LAYER", "true-color", "ACI7"], questions=["Q-0196"])
    _grey_backing(c.msp, 4, 60, 196, 90)
    specs = [("7+FFFFFF", 7, 0xFFFFFF), ("7+000000", 7, 0x000000), ("7", 7, None), ("255", 255, None)]
    for k, (name, col, tc) in enumerate(specs):
        c.layer(f"W{k}", color=col, true_color=tc)
        x = 15 + k * 46
        solid_rect(c.msp, x, 25, x + 32, 125, {"layer": f"W{k}"})
        label(c, c.msp, name, x + 16, 15)
    c.window((0, 0), (200, 150))

    # --- entity without group 8 while $CLAYER names another layer
    c = s.case("no-layer-group", "LINE+SOLID written without group 8 while $CLAYER=RED (colour 1): layer 0 (black) or RED?", tags=["LINE", "SOLID", "LAYER", "CLAYER"], questions=["Q-0274"])
    c.layer("RED", color=1)
    c.header(clayer="RED")
    ln = c.msp.add_line((30, 30), (170, 30), dxfattribs={"lineweight": 100})
    sd = solid_rect(c.msp, 30, 50, 170, 130)
    handles = [ln.dxf.handle, sd.dxf.handle]
    c.params["handles_without_group_8"] = handles

    def strip_layer(data: bytes, hs=tuple(handles)) -> bytes:
        for h in hs:
            key = f"  5\n{h}\n330\n".encode()
            i = data.index(key)
            j = data.index(b"\n  8\n0\n", i)
            data = data[:j] + data[j + len(b"\n  8\n0"):]
        return data

    c.byte_filters.append(strip_layer)
    c.window((0, 0), (200, 150))

    # --- model vs paper space palette
    pal = [7, 8, 9, 110, 250, 251, 252, 253, 254, 255]
    c = s.case("palette-modelspace", "Model space: labelled SOLID swatches ACI 7, 8, 9, 110, 250-255 (reference for the paper-space case)", tags=["SOLID", "ACI", "palette"], questions=["Q-0197"])
    _aci_swatches(c, c.msp, pal, 5)
    c.window((0, 0), (200, 150))
    c = s.case("palette-paperspace", "Layout1: ACI 7, 8, 9, 110, 250-255 swatches drawn in paper space (left) and via a 1:1 viewport onto model space (right)", tags=["SOLID", "ACI", "palette", "paperspace", "VIEWPORT"], questions=["Q-0197"])
    psp = c.doc.layout("Layout1")
    psp.reset_main_viewport()
    _aci_swatches(c, psp, pal, 2, x0=5, x1=95, y0=6, y1=146)
    _aci_swatches(c, c.msp, pal, 2, x0=5, x1=95, y0=6, y1=146)
    psp.add_viewport(center=(150, 76), size=(96, 144), view_center_point=(50, 76), view_height=144)
    c.layout_window("Layout1", (0, 0), (200, 150))

    # --- monochrome.ctb: ACI colours, ACI 255 and true colours
    c = s.case("mono-aci-truecolor", "monochrome.ctb: ACI 1-6, 250, 255 and 420 red/green/white/grey swatches (all black?)", tags=["SOLID", "ACI", "true-color", "monochrome"], questions=["Q-0223"], style_table="monochrome.ctb")
    specs = [(f"ACI {a}", {"color": a}) for a in (1, 2, 3, 4, 5, 6, 250, 255)] + [
        ("FF0000", {"color": 1, "true_color": 0xFF0000}),
        ("00FF00", {"color": 3, "true_color": 0x00FF00}),
        ("FFFFFF", {"color": 7, "true_color": 0xFFFFFF}),
        ("C0C0C0", {"color": 7, "true_color": 0xC0C0C0}),
    ]
    _grey_backing(c.msp, 2, 100, 198, 104)
    for k, (name, a) in enumerate(specs):
        r, col = divmod(k, 6)
        x = 6 + col * 32
        y = 85 - r * 70
        solid_rect(c.msp, x, y, x + 26, y + 50, a)
        label(c, c.msp, name, x + 13, y - 6, h=3)
    c.window((0, 0), (200, 150))
    for ctb, suffix in (("acad.ctb", ""), ("monochrome.ctb", "-mono")):
        c = s.case(f"gradient{suffix}", f"Linear gradient HATCH red -> yellow and ACI 5 -> 1 (two-colour) plotted with {ctb}", tags=["HATCH", "gradient"] + (["monochrome"] if suffix else []), questions=["Q-0224"] if suffix else [], style_table=ctb)
        for k, (c1, c2) in enumerate((((255, 0, 0), (255, 255, 0)), ((0, 0, 255), (255, 0, 0)))):
            h = c.msp.add_hatch(color=7)
            h.set_gradient(color1=c1, color2=c2, rotation=0, name="LINEAR")
            y = 85 - k * 65
            h.paths.add_polyline_path([(20, y), (180, y), (180, y + 50), (20, y + 50)], is_closed=True)
        c.window((0, 0), (200, 150))

