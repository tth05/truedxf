"""Lineweights (370): every standard value, BYLAYER/BYBLOCK/DEFAULT, LWDISPLAY and the plot
lineweight flag, caps/joins ($ENDCAPS/$JOINSTYLE), invalid values, lineweight on fills/text/wide
polylines, dashes, INSERT scale (note 06 §5, §7.1; note 08 §5.4; note 11a §15)."""

from __future__ import annotations

import math

from ezdxf.enums import TextEntityAlignment

from ..core import SuiteBuilder, suite
from ._appearance_util import hatch_rect, label, ref_line, solid_rect

LWS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211]
LEFT = TextEntityAlignment.MIDDLE_LEFT
PAPER_MM_PER_UNIT = 2.54  # 10 px/unit at the PNG device's 100 dpi (note 08 §5.4)


def _mm(lw: int) -> str:
    return f"{lw / 100:.2f}"


def _lw_rows(c, rows, x0=45.0, x1=190.0, top=135.0, step=None):
    """One horizontal LINE per (label, dxfattribs) row with the label at the left."""
    step = step or min(24.0, 120.0 / max(1, len(rows) - 1))
    for k, (name, a) in enumerate(rows):
        y = top - k * step
        c.msp.add_line((x0, y), (x1, y), dxfattribs=a)
        label(c, c.msp, name, 4, y, h=3, align=LEFT)


def _caps_geometry(c, lw: int = 211) -> None:
    a = {"lineweight": lw}
    m = c.msp
    m.add_line((20, 130), (90, 130), dxfattribs=a)  # free ends
    m.add_line((110, 130), (190, 130), dxfattribs=a)  # T junction of two LINEs
    m.add_line((150, 130), (150, 100), dxfattribs=a)
    m.add_line((110, 65), (160, 65), dxfattribs=a)  # 90 deg corner of two separate LINEs
    m.add_line((160, 65), (160, 90), dxfattribs=a)
    m.add_lwpolyline([(20, 65), (80, 65), (80, 90), (20, 90)], close=True, dxfattribs=a)  # closed: join at vertex 0
    for k, opening in enumerate((30, 90, 150)):
        ax, ay = 35 + k * 65, 18
        h = math.radians(opening / 2)
        arm = 28
        pl = [(ax - arm * math.sin(h), ay + arm * math.cos(h)), (ax, ay), (ax + arm * math.sin(h), ay + arm * math.cos(h))]
        m.add_lwpolyline([(round(x, 6), round(y, 6)) for x, y in pl], dxfattribs=a)
    for x, y in ((20, 130), (90, 130), (110, 130), (190, 130), (150, 100)):
        ref_line(c, m, (x, y - 3), (x, y + 3))  # hairline ticks at the exact line ends


@suite("lineweights", "Lineweights: standard values, BYLAYER/BYBLOCK/DEFAULT, caps/joins, invalid values, fills")
def build(s: SuiteBuilder) -> None:
    # --- one case per standard lineweight: H, V, 1/30/45/89 deg lines, circle, arc
    for lw in LWS:
        c = s.case(f"lw-{lw:03d}", f"Lineweight {_mm(lw)} mm: horizontal, vertical, 1/30/45/89 deg LINEs, CIRCLE and ARC", tags=["LINE", "CIRCLE", "ARC", "lineweight"], questions=["Q-0204"] + (["Q-0205"] if lw <= 18 else []), params={"lineweight": lw})
        a = {"lineweight": lw}
        m = c.msp
        m.add_line((20, 132), (190, 132), dxfattribs=a)
        m.add_line((20, 115), (20 + 170 * math.cos(math.radians(1)), 115 + 170 * math.sin(math.radians(1))), dxfattribs=a)
        m.add_line((12, 12), (12, 100), dxfattribs=a)
        for ang in (30, 45, 89):
            r = math.radians(ang)
            m.add_line((25, 12), (25 + 95 * math.cos(r), 12 + 95 * math.sin(r)), dxfattribs=a)
        m.add_circle((145, 60), 32, dxfattribs=a)
        m.add_arc((145, 60), 18, 20, 250, dxfattribs=a)
        label(c, m, f"{_mm(lw)} mm", 150, 144, h=3)
        c.window((0, 0), (200, 150))

    # --- ladders: all 24 lineweights in one plot
    c = s.case("ladder-horizontal", "24 horizontal LINEs, one per standard lineweight (0 at the bottom)", tags=["LINE", "lineweight"], questions=["Q-0204", "Q-0205"], params={"lineweights": LWS, "y": [6 + 6 * i for i in range(24)]})
    for i, lw in enumerate(LWS):
        y = 6 + 6 * i
        c.msp.add_line((30, y), (192, y), dxfattribs={"lineweight": lw})
        label(c, c.msp, _mm(lw), 4, y, h=2.5, align=LEFT)
    c.window((0, 0), (200, 150))
    c = s.case("ladder-vertical", "24 vertical LINEs, one per standard lineweight (0 at the left)", tags=["LINE", "lineweight"], questions=["Q-0204", "Q-0205"], params={"lineweights": LWS, "x": [8 + 8 * i for i in range(24)]})
    for i, lw in enumerate(LWS):
        x = 8 + 8 * i
        c.msp.add_line((x, 20), (x, 140), dxfattribs={"lineweight": lw})
        label(c, c.msp, _mm(lw), x, 12, h=1.8)
    c.window((0, 0), (200, 150))
    c = s.case("ladder-circles", "6x4 grid of CIRCLEs r=12, one per standard lineweight (row-major from top-left)", tags=["CIRCLE", "lineweight"], questions=["Q-0204"], params={"lineweights": LWS})
    for i, lw in enumerate(LWS):
        r, k = divmod(i, 6)
        cx, cy = 18 + k * 33, 128 - r * 36
        c.msp.add_circle((cx, cy), 12, dxfattribs={"lineweight": lw})
        label(c, c.msp, _mm(lw), cx, cy - 16, h=2.5)
    c.window((0, 0), (200, 150))
    for ang in (1, 30, 45, 89):
        c = s.case(f"thin-angle-{ang:02d}", f"Parallel LINEs at {ang} deg with lineweights 0, 0.05, 0.09, 0.13, 0.15, 0.18 mm", tags=["LINE", "lineweight", "hairline"], questions=["Q-0205"], params={"angle": ang, "lineweights": [0, 5, 9, 13, 15, 18]})
        r = math.radians(ang)
        d = (math.cos(r), math.sin(r))
        n = (-math.sin(r), math.cos(r))
        for k, lw in enumerate((0, 5, 9, 13, 15, 18)):
            off = -40 + 16 * k
            cx, cy = 100 + n[0] * off, 75 + n[1] * off
            c.msp.add_line((cx - 50 * d[0], cy - 50 * d[1]), (cx + 50 * d[0], cy + 50 * d[1]), dxfattribs={"lineweight": lw})
        c.window((0, 0), (200, 150))

    # --- BYLAYER lineweights vs explicit entity lineweights
    c = s.case("bylayer", "LINEs with lw BYLAYER on layers 0.00/0.50/1.00/2.11/Default (left) vs explicit entity lw (right)", tags=["LINE", "lineweight", "BYLAYER", "LAYER"], questions=["Q-0206"])
    for k, lw in enumerate((0, 50, 100, 211, -3)):
        name = f"LW{lw:03d}" if lw >= 0 else "LWDEF"
        c.layer(name, lineweight=lw)
        y = 130 - k * 26
        c.msp.add_line((40, y), (110, y), dxfattribs={"layer": name, "lineweight": -1})
        c.msp.add_line((125, y), (195, y), dxfattribs={"lineweight": lw if lw >= 0 else 25})
        label(c, c.msp, name, 4, y, align=LEFT)
    c.window((0, 0), (200, 150))

    # --- DEFAULT (-3) -> LWDEFAULT (a registry sysvar, not in the DXF; the harness pins 25)
    rows = [
        ("-3 (layer 0 -3)", {"lineweight": -3}),
        ("-1 (layer 0 -3)", {"lineweight": -1}),
        ("0.25 ref", {"lineweight": 25}),
        ("1.00 ref", {"lineweight": 100}),
        ("0.00 ref", {"lineweight": 0}),
    ]
    for lwd, extra in ((25, {}), (100, {"harness": {"sysvars": {"LWDEFAULT": 100}}})):
        c = s.case(f"default-lwdefault-{lwd:03d}", f"LINEs with lineweight DEFAULT (-3) and BYLAYER on a -3 layer vs references; LWDEFAULT={lwd}", tags=["LINE", "lineweight", "DEFAULT", "LWDEFAULT"], questions=["Q-0206"], params={"LWDEFAULT": lwd, **extra})
        if lwd != 25:
            c.notes.append("Needs the harness to set LWDEFAULT 100 before plotting (params.harness.sysvars); ezdxf cannot store $LWDEFAULT (not a DXF header variable).")
        _lw_rows(c, rows)
        c.window((0, 0), (200, 150))
    c = s.case("byblock-toplevel", "Model-space LINE with lineweight BYBLOCK (-2) vs 0.25 / 0.00 / 1.00 mm references", tags=["LINE", "lineweight", "BYBLOCK"], questions=["Q-0206", "Q-0278"])
    _lw_rows(c, [("-2", {"lineweight": -2}), ("0.25 ref", {"lineweight": 25}), ("0.00 ref", {"lineweight": 0}), ("1.00 ref", {"lineweight": 100})])
    c.window((0, 0), (200, 150))

    # --- BYBLOCK / BYLAYER inside INSERTs
    for i, (ins, title) in enumerate((
        ({"lineweight": 100}, "INSERT lw 1.00 mm on layer 0"),
        ({"lineweight": -1, "layer": "LW030"}, "INSERT lw BYLAYER on layer LW030 (0.30 mm)"),
        ({"lineweight": -3}, "INSERT lw DEFAULT"),
        ({"lineweight": -2}, "top-level INSERT lw BYBLOCK"),
    ), 1):
        c = s.case(f"byblock-insert-{i:04d}", f"Block LINEs lw BYBLOCK / BYLAYER(layer 0) / 0.50 mm + BYBLOCK CIRCLE; {title}", tags=["INSERT", "lineweight", "BYBLOCK"], questions=["Q-0206", "Q-0278"], params={"insert": ins})
        c.layer("LW030", lineweight=30)
        c.doc.layers.get("0").dxf.lineweight = 211
        b = c.doc.blocks.new("LWB")
        for k, lw in enumerate((-2, -1, 50)):
            y = 120 - k * 30
            b.add_line((40, y), (130, y), dxfattribs={"lineweight": lw})
            label(c, c.msp, {-2: "BYBLOCK", -1: "BYLAYER (layer 0 = 2.11)", 50: "0.50"}[lw], 4, y + 6, h=3, align=LEFT)
        b.add_circle((165, 90), 25, dxfattribs={"lineweight": -2})
        c.msp.add_blockref("LWB", (0, 0), dxfattribs=ins)
        c.msp.add_line((40, 30), (130, 30), dxfattribs={"lineweight": 25})
        label(c, c.msp, "0.25 ref (outside block)", 4, 36, h=3, align=LEFT)
        c.window((0, 0), (200, 150))

    # --- LWDISPLAY and the plot lineweights flag
    rows_lw = [("entity 0.50", {"lineweight": 50}), ("entity 1.00", {"lineweight": 100}), ("layer 0.50", {"layer": "L050"}), ("layer 1.00", {"layer": "L100"}), ("entity 0.00", {"lineweight": 0})]
    for name, disp, plot_lw in (("lwdisplay-0", 0, True), ("lwdisplay-1", 1, True), ("plot-lineweights-off", 1, False)):
        c = s.case(name, f"LINEs 0.50/1.00 mm (entity and layer lw); $LWDISPLAY={disp}; plot lineweights {'on' if plot_lw else 'off'}", tags=["LINE", "lineweight", "LWDISPLAY"], questions=["Q-0203", "Q-0206"], header={"$LWDISPLAY": disp}, params={"lwdisplay": disp, "plot_lineweights": plot_lw})
        c.layer("L050", lineweight=50)
        c.layer("L100", lineweight=100)
        _lw_rows(c, rows_lw)
        c.plot.lineweights = plot_lw
        c.window((0, 0), (200, 150))

    # --- caps and joins: $ENDCAPS / $JOINSTYLE
    combos = [(0, 0), (1, 0), (2, 0), (3, 0), (0, 1), (0, 2), (0, 3), (1, 1), (2, 2), (3, 3)]
    for e, j in combos:
        c = s.case(f"caps-e{e}-j{j}", f"2.11 mm LINE ends, T junction, LINE corner, closed/open LWPOLYLINE corners 30/90/150 deg; $ENDCAPS={e} $JOINSTYLE={j}", tags=["LINE", "LWPOLYLINE", "lineweight", "ENDCAPS", "JOINSTYLE"], questions=["Q-0208"], header={"$ENDCAPS": e, "$JOINSTYLE": j}, params={"endcaps": e, "joinstyle": j})
        _caps_geometry(c)
        c.window((0, 0), (200, 150))
    c = s.case("caps-e0-j0-acad-ctb", "Same caps/joins geometry ($ENDCAPS=0 $JOINSTYLE=0) plotted with acad.ctb", tags=["LINE", "LWPOLYLINE", "lineweight", "ENDCAPS", "JOINSTYLE"], questions=["Q-0208"], style_table="acad.ctb", header={"$ENDCAPS": 0, "$JOINSTYLE": 0})
    _caps_geometry(c)
    c.window((0, 0), (200, 150))

    # --- invalid 370 values (on purpose)
    vals = [15, 17, 18, 20, 22, 23, 25, 211, 212, 300]
    c = s.case("invalid-entity-values", "LINEs with invalid 370 = 17/22/23/212/300 (on purpose) between valid 15/18/20/25/211 references", tags=["LINE", "lineweight", "invalid"], questions=["Q-0207"], params={"values": vals})
    for k, v in enumerate(vals):
        y = 140 - k * 14.5
        ln = c.msp.add_line((40, y), (190, y))
        ln.dxf.unprotected_set("lineweight", v)
        label(c, c.msp, f"370={v}", 4, y, h=3, align=LEFT)
    c.window((0, 0), (200, 150))
    c = s.case("invalid-layer-17", "Layer with invalid 370=17 (on purpose): BYLAYER LINE vs 0.15/0.18/0.20 mm references", tags=["LINE", "LAYER", "lineweight", "invalid"], questions=["Q-0207"])
    lay = c.doc.layers.get(c.layer("LW17"))
    lay.dxf.unprotected_set("lineweight", 17)
    _lw_rows(c, [("layer 17", {"layer": "LW17", "lineweight": -1}), ("0.15", {"lineweight": 15}), ("0.18", {"lineweight": 18}), ("0.20", {"lineweight": 20})])
    c.window((0, 0), (200, 150))

    # --- lineweight on fills, wide polylines and TTF text
    c = s.case("solid-lw", "SOLID squares and triangles (13=12) with lineweight 0 (left) vs 2.00 mm (right): does the fill grow?", tags=["SOLID", "lineweight"], questions=["Q-0209"], params={"squares": [[25, 80, 85, 140], [115, 80, 175, 140]], "triangles": [[(25, 10), (85, 10), (55, 65)], [(115, 10), (175, 10), (145, 65)]]})
    for x, lw in ((25, 0), (115, 200)):
        solid_rect(c.msp, x, 80, x + 60, 140, {"lineweight": lw})
        c.msp.add_solid([(x, 10), (x + 60, 10), (x + 30, 65)], dxfattribs={"lineweight": lw})
    c.window((0, 0), (200, 150))
    c = s.case("hatch-lw", "Solid HATCH squares with lineweight 0 (left) vs 2.11 mm (right), hairline LINE on the right square's boundary", tags=["HATCH", "lineweight"], questions=["Q-0356"])
    for x, lw in ((20, 0), (110, 211)):
        hatch_rect(c.msp, x, 35, x + 70, 115, {"lineweight": lw})
    ref_line(c, c.msp, (110, 20), (110, 130))
    c.window((0, 0), (200, 150))
    c = s.case("widepline-lw", "LWPOLYLINE width 2 with lw 0 / lw 1.00 mm, and alternating width 0/2 segments with lw 0.50 mm", tags=["LWPOLYLINE", "width", "lineweight"], questions=["Q-0210", "Q-0148"])
    zig = [(20, 0), (60, 25), (100, 0), (140, 25), (180, 0)]
    c.msp.add_lwpolyline([(x, y + 110) for x, y in zig], dxfattribs={"const_width": 2, "lineweight": 0})
    c.msp.add_lwpolyline([(x, y + 65) for x, y in zig], dxfattribs={"const_width": 2, "lineweight": 100})
    c.msp.add_lwpolyline([(x, y + 20, w, w, 0) for (x, y), w in zip(zig, (0, 2, 0, 2, 0))], format="xyseb", dxfattribs={"lineweight": 50})
    c.window((0, 0), (200, 150))
    c = s.case("text-lw", "TrueType TEXT (Liberation Sans) height 30 with lineweight 0 (top) vs 1.00 mm (bottom)", tags=["TEXT", "lineweight", "TTF"], questions=["Q-0491"])
    for y, lw in ((95, 0), (25, 100)):
        c.msp.add_text("HOLE 8", height=30, dxfattribs={"lineweight": lw}).set_placement((20, y))
    c.window((0, 0), (200, 150))

    # --- dashes with lineweight: dash lengths 0.5/1/2/5 mm on paper; DOT
    for lw in (50, 211):
        c = s.case(f"dashed-lw-{lw:03d}", f"DASHED LINEs with paper dash length 0.5/1/2/5 mm and DOT at lw {_mm(lw)} mm, each above a hairline copy", tags=["LINE", "linetype", "lineweight", "DASHED", "DOT"], questions=["Q-0211", "Q-0302"], params={"lineweight": lw, "paper_mm_per_unit": PAPER_MM_PER_UNIT})
        c.linetype("DASHED")
        c.linetype("DOT")
        rows = []
        for k, dash_mm in enumerate((0.5, 1, 2, 5)):
            scale = round((dash_mm / PAPER_MM_PER_UNIT) / 12.7, 9)  # metric DASHED dash = 12.7
            rows.append((f"dash {dash_mm} mm", "DASHED", scale))
        rows.append(("DOT", "DOT", round((2 / PAPER_MM_PER_UNIT) / 6.35, 9)))  # gap 2 mm on paper
        c.params["rows"] = [{"label": n, "linetype": lt, "ltscale": sc} for n, lt, sc in rows]
        for k, (name, lt, sc) in enumerate(rows):
            y = 135 - k * 28
            c.msp.add_line((45, y), (190, y), dxfattribs={"linetype": lt, "ltscale": sc, "lineweight": lw})
            c.msp.add_line((45, y - 6), (190, y - 6), dxfattribs={"linetype": lt, "ltscale": sc, "lineweight": 0})
            label(c, c.msp, name, 4, y - 3, h=3, align=LEFT)
        c.window((0, 0), (200, 150))

    # --- lineweight is independent of INSERT scale
    c = s.case("insert-scale", "0.50 mm LINE: direct, and inside INSERTs scaled (16,16), (16,1), (16,1000), (16,0.01)", tags=["INSERT", "lineweight", "scale"], questions=["Q-0213"])
    b = c.doc.blocks.new("L10")
    b.add_line((0, 0), (10, 0), dxfattribs={"lineweight": 50})
    c.msp.add_line((30, 135), (190, 135), dxfattribs={"lineweight": 50})
    label(c, c.msp, "direct", 4, 135, align=LEFT)
    for k, (sx, sy) in enumerate(((16, 16), (16, 1), (16, 1000), (16, 0.01)), 1):
        y = 135 - k * 28
        c.msp.add_blockref("L10", (30, y), dxfattribs={"xscale": sx, "yscale": sy})
        label(c, c.msp, f"{sx},{sy:g}", 4, y, align=LEFT)
    c.window((0, 0), (200, 150))

    # --- random mixes
    for seed in range(1, 4):
        c = s.case(f"random-{seed:04d}", f"Random LINEs/ARCs/CIRCLEs with random standard lineweights, seed {seed}", tags=["LINE", "ARC", "CIRCLE", "lineweight"], seed=seed)
        rng = c.rng
        for _ in range(14):
            lw = rng.choice(LWS)
            k = rng.random()
            if k < 0.5:
                c.msp.add_line((rng.uniform(10, 190), rng.uniform(10, 140)), (rng.uniform(10, 190), rng.uniform(10, 140)), dxfattribs={"lineweight": lw})
            elif k < 0.75:
                c.msp.add_circle((rng.uniform(40, 160), rng.uniform(40, 110)), rng.uniform(5, 30), dxfattribs={"lineweight": lw})
            else:
                c.msp.add_arc((rng.uniform(40, 160), rng.uniform(40, 110)), rng.uniform(5, 30), rng.uniform(0, 360), rng.uniform(0, 360), dxfattribs={"lineweight": lw})
        c.window((0, 0), (200, 150))
