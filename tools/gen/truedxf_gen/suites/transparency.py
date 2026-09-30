"""Transparency (440, layer AcCmTransparency XDATA, BYLAYER/BYBLOCK) and how PLOT composites it
(note 06 §4, §7.1; note 02 §2.1.2; note 08 §5.5; note 11a §15).

Plotting transparency needs PLOTTRANSPARENCYOVERRIDE=2 (the harness prologue pins 0 = never);
every case records the intended harness setting in params["harness"] (see _appearance_util)."""

from __future__ import annotations

import copy

from ..core import SuiteBuilder, suite
from ._appearance_util import PLOT_TRANSPARENCY_ON, hatch_poly, hatch_rect, label, solid_rect

BYBLOCK_T = 0x01000000


def alpha_of(percent: float) -> int:
    """AutoCAD UI percent -> 440 value (alpha = trunc(255*(100-t)/100), note 06 §4.1)."""
    return 0x02000000 | int(255 * (100 - percent) / 100)


def _backdrop(c, space=None) -> None:
    """Opaque blue HATCH band + black 1.00 mm and hairline vertical LINEs, drawn first."""
    m = space or c.msp
    hatch_rect(m, 5, 62, 195, 88, {"color": 5})
    m.add_line((100, 5), (100, 145), dxfattribs={"color": 7, "lineweight": 100})
    m.add_line((104, 5), (104, 145), dxfattribs={"color": 7, "lineweight": 0})


def _case(s, name, title, tags, questions=(), plot_transparency=True, **kw):
    params = kw.pop("params", {})
    params = dict(params)
    params["plot_transparency"] = plot_transparency
    if plot_transparency:
        params["harness"] = copy.deepcopy(PLOT_TRANSPARENCY_ON)
    c = s.case(name, title, tags=["transparency", *tags], questions=list(questions), params=params, **kw)
    if plot_transparency:
        c.notes.append("Plot with transparency: harness must set PLOTTRANSPARENCYOVERRIDE=2 (params.harness.sysvars).")
    else:
        c.notes.append("Reference with transparency NOT plotted (harness default PLOTTRANSPARENCYOVERRIDE=0).")
    return c


@suite("transparency", "Transparency 440 / layer / BYBLOCK and plotted alpha compositing", style_table="acad.ctb")
def build(s: SuiteBuilder) -> None:
    # --- entity transparency sweep, one value per case
    for t in (0, 25, 50, 75, 90):
        c = _case(s, f"entity-{t:03d}", f"Red solid HATCH with 440 = {t}% over a blue band and black lines", ["HATCH", "440"], ["Q-0217", "Q-0218", "Q-0220"], params={"percent": t, "value": hex(alpha_of(t))})
        _backdrop(c)
        hatch_rect(c.msp, 40, 30, 160, 120, {"color": 1, "transparency": alpha_of(t)})
        c.window((0, 0), (200, 150))
    c = _case(s, "entity-050-plot-off", "Red solid HATCH 440 = 50% over blue band and black lines, transparency NOT plotted", ["HATCH", "440"], ["Q-0216"], plot_transparency=False, params={"percent": 50, "value": hex(alpha_of(50))})
    _backdrop(c)
    hatch_rect(c.msp, 40, 30, 160, 120, {"color": 1, "transparency": alpha_of(50)})
    c.window((0, 0), (200, 150))
    sweep = [0, 10, 25, 33, 50, 70, 75, 90]
    c = _case(s, "entity-sweep", "Red solid HATCH columns with 440 = 0/10/25/33/50/70/75/90% crossing a blue band", ["HATCH", "440"], ["Q-0218"], params={"percent": sweep, "values": [hex(alpha_of(t)) for t in sweep]})
    hatch_rect(c.msp, 2, 62, 198, 88, {"color": 5})
    for k, t in enumerate(sweep):
        x = 6 + k * 24.5
        hatch_rect(c.msp, x, 25, x + 20, 125, {"color": 1, "transparency": alpha_of(t)})
        label(c, c.msp, f"{t}%", x + 10, 15)
    c.window((0, 0), (200, 150))
    raw = [0x02000000, 0x02000001, 0x0200007F, 0x02000080, 0x020000FE, 0x020000FF]
    c = _case(s, "alpha-raw", "Red solid HATCH columns with raw 440 alpha 0, 1, 127, 128, 254, 255 crossing a blue band", ["HATCH", "440"], ["Q-0217", "Q-0218"], params={"values": [hex(v) for v in raw]})
    hatch_rect(c.msp, 2, 62, 198, 88, {"color": 5})
    for k, v in enumerate(raw):
        x = 8 + k * 32
        hatch_rect(c.msp, x, 25, x + 26, 125, {"color": 1, "transparency": v})
        label(c, c.msp, f"a={v & 255}", x + 13, 15)
    c.window((0, 0), (200, 150))

    # --- BYLAYER: layer transparency (AcCmTransparency XDATA) with entity 440 absent / 0 / opaque
    for name, t440, title in (
        ("absent", None, "entity without 440"),
        ("zero", 0, "entity 440=0"),
        ("opaque-override", 0x020000FF, "entity 440=0x020000FF (opaque)"),
    ):
        c = _case(s, f"bylayer-{name}", f"Red solid HATCH on a 50% transparent layer, {title}", ["HATCH", "LAYER", "BYLAYER"], ["Q-0217"], params={"layer_percent": 50, "entity_440": None if t440 is None else hex(t440)})
        c.layer("T50", color=1, transparency=0.5)
        _backdrop(c)
        h = hatch_rect(c.msp, 40, 30, 160, 120, {"layer": "T50"})
        if t440 is not None:
            h.dxf.unprotected_set("transparency", t440)  # 0 is rejected by ezdxf's validator
        c.window((0, 0), (200, 150))
    c = _case(s, "layer-070", "Red solid HATCH (BYLAYER) on a 70% transparent layer + 50% entity HATCH on layer 0", ["HATCH", "LAYER"], ["Q-0216", "Q-0217"])
    c.layer("T70", color=1, transparency=0.7)
    _backdrop(c)
    hatch_rect(c.msp, 20, 30, 95, 120, {"layer": "T70"})
    hatch_rect(c.msp, 110, 30, 185, 120, {"color": 1, "transparency": alpha_of(50)})
    c.window((0, 0), (200, 150))

    # --- BYBLOCK: content 440=0x01000000 inside INSERTs
    def byblock_block(c):
        b = c.doc.blocks.new("TB")
        hatch_rect(b, 0, 0, 60, 90, {"color": 1, "transparency": BYBLOCK_T})  # BYBLOCK transparency
        hatch_rect(b, 70, 0, 130, 90, {"color": 3})  # no 440: BYLAYER (layer 0 -> INSERT layer)
        hatch_rect(b, 140, 0, 180, 90, {"color": 6, "transparency": 0x020000FF})  # explicit opaque
        return b

    for name, ins, title in (
        ("030", {"transparency": alpha_of(30)}, "INSERT 440 = 30% on layer 0"),
        ("bylayer", {"layer": "T60"}, "INSERT without 440 on a 60% layer"),
        ("byblock-toplevel", {"transparency": BYBLOCK_T}, "top-level INSERT 440 = BYBLOCK"),
    ):
        c = _case(s, f"byblock-insert-{name}", f"Block: red BYBLOCK / green BYLAYER / magenta opaque HATCHes; {title}", ["INSERT", "HATCH", "BYBLOCK"], ["Q-0217"], params={"insert": {k: (hex(v) if k == "transparency" else v) for k, v in ins.items()}})
        c.layer("T60", color=7, transparency=0.6)
        _backdrop(c)
        byblock_block(c)
        c.msp.add_blockref("TB", (10, 30), dxfattribs=ins)
        c.window((0, 0), (200, 150))
    c = _case(s, "byblock-entity-toplevel", "Top-level red HATCH with 440 = BYBLOCK (0x01000000) next to a 50% one", ["HATCH", "BYBLOCK"], ["Q-0217"])
    _backdrop(c)
    hatch_rect(c.msp, 20, 30, 95, 120, {"color": 1, "transparency": BYBLOCK_T})
    hatch_rect(c.msp, 110, 30, 185, 120, {"color": 1, "transparency": alpha_of(50)})
    c.window((0, 0), (200, 150))

    # --- overlaps: same-colour transparent fills, wide lines, other filled entity types
    c = _case(s, "overlap-same-color", "Two overlapping red 50% HATCHes and two overlapping 50% HATCHes red/green", ["HATCH", "overlap"], ["Q-0218"])
    hatch_rect(c.msp, 10, 80, 80, 140, {"color": 1, "transparency": alpha_of(50)})
    hatch_rect(c.msp, 50, 60, 120, 120, {"color": 1, "transparency": alpha_of(50)})
    hatch_rect(c.msp, 90, 30, 160, 90, {"color": 1, "transparency": alpha_of(50)})
    hatch_rect(c.msp, 130, 10, 195, 70, {"color": 3, "transparency": alpha_of(50)})
    c.window((0, 0), (200, 150))
    c = _case(s, "wide-lines", "50% transparent 2.11 mm LINEs crossing each other, self-crossing 2.11 mm LWPOLYLINE, width-6 LWPOLYLINE over a blue band", ["LINE", "LWPOLYLINE", "lineweight", "overlap"], ["Q-0218"])
    hatch_rect(c.msp, 5, 62, 195, 88, {"color": 5})
    t = alpha_of(50)
    c.msp.add_line((10, 20), (80, 130), dxfattribs={"color": 1, "lineweight": 211, "transparency": t})
    c.msp.add_line((10, 130), (80, 20), dxfattribs={"color": 1, "lineweight": 211, "transparency": t})
    c.msp.add_lwpolyline([(95, 20), (140, 130), (140, 20), (95, 130)], dxfattribs={"color": 1, "lineweight": 211, "transparency": t})
    c.msp.add_lwpolyline([(155, 20), (190, 130), (190, 20), (155, 130)], dxfattribs={"color": 1, "const_width": 6, "transparency": t})
    c.window((0, 0), (200, 150))
    c = _case(s, "other-fills", "50% transparent SOLID, TRACE, TrueType TEXT and 2.11 mm CIRCLE over a blue band and black line", ["SOLID", "TRACE", "TEXT", "CIRCLE"], ["Q-0218"])
    _backdrop(c)
    t = alpha_of(50)
    solid_rect(c.msp, 10, 90, 60, 140, {"color": 1, "transparency": t})
    c.msp.add_trace([(10, 20), (60, 20), (10, 70), (60, 60)], dxfattribs={"color": 1, "transparency": t})
    c.msp.add_text("Ag", height=40, dxfattribs={"color": 1, "transparency": t}).set_placement((75, 55))
    c.msp.add_circle((160, 75), 25, dxfattribs={"color": 1, "lineweight": 211, "transparency": t})
    c.window((0, 0), (200, 150))

    # --- pattern hatch with background colour and transparency
    c = _case(s, "hatch-background", "ANSI31 pattern HATCH with red background colour, 440 = 50%, over blue band and black lines", ["HATCH", "pattern", "background-color"], ["Q-0219"])
    _backdrop(c)
    h = c.msp.add_hatch(color=5, dxfattribs={"transparency": alpha_of(50)})
    h.set_pattern_fill("ANSI31", scale=2.0)
    h.bgcolor = (255, 0, 0)
    h.paths.add_polyline_path([(40, 30), (160, 30), (160, 120), (40, 120)], is_closed=True)
    c.window((0, 0), (200, 150))

    # --- AC1018 (R2004) file
    c = _case(s, "ac1018", "AC1018 (R2004) file: overlapping red/green solid HATCHes with 440 = 0x0200007F over black lines", ["HATCH", "440", "AC1018"], ["Q-0214"], dxfversion="R2004")
    _backdrop(c)
    hatch_rect(c.msp, 30, 30, 120, 120, {"color": 1, "transparency": 0x0200007F})
    hatch_rect(c.msp, 80, 20, 170, 110, {"color": 3, "transparency": 0x0200007F})
    c.window((0, 0), (200, 150))

    # --- random overlapping transparent hatches
    for seed in range(1, 3):
        c = _case(s, f"random-{seed:04d}", f"Random overlapping solid HATCH triangles with random colours and transparency, seed {seed}", ["HATCH", "overlap"], ["Q-0218"], seed=seed)
        rng = c.rng
        items = []
        for _ in range(10):
            pts = [(round(rng.uniform(10, 190), 3), round(rng.uniform(10, 140), 3)) for _ in range(3)]
            col = rng.choice([1, 2, 3, 4, 5, 6, 30, 150])
            t = rng.choice([0, 20, 40, 50, 60, 80, 90])
            items.append({"color": col, "percent": t})
            hatch_poly(c.msp, pts, {"color": col, "transparency": alpha_of(t)})
        c.params["items"] = items
        c.window((0, 0), (200, 150))
