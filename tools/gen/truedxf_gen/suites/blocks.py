"""BLOCK / INSERT / MINSERT: base points, transform sweeps, non-uniform scale and mirroring,
nesting, MIRRTEXT, property inheritance (layer 0 / BYBLOCK), layer visibility, block units,
anonymous blocks, missing xrefs (note 07 §1-§3, §5-§6; note 06 §7; note 02 BLOCK_RECORD)."""

from __future__ import annotations

import math

from ezdxf.math import OCS, Vec3

from ..core import SuiteBuilder, TextEntityAlignment, suite
from ._blocks_util import F_OUTLINE, cross, f_block, ref_layer, zero_scale_filter


def _rich_block(doc, name: str = "RICH"):
    """40 x 30 block (base = centre (20,15)) with circle, arc, TEXT, ANSI31 hatch, a bulged wide
    LWPOLYLINE and a tapered LWPOLYLINE."""
    blk = doc.blocks.new(name, base_point=(20, 15))
    blk.add_lwpolyline([(0, 0), (40, 0), (40, 30), (0, 30)], close=True)
    blk.add_circle((10, 9), 6)
    blk.add_arc((30, 9), 6, 0, 120)
    t = blk.add_text("Fg1", height=6)
    t.set_placement((2, 20))
    h = blk.add_hatch()
    h.set_pattern_fill("ANSI31", scale=0.5)
    h.paths.add_polyline_path([(24, 18), (38, 18), (38, 28), (24, 28)], is_closed=True)
    blk.add_lwpolyline([(22, 17), (38, 17), (38, 29), (22, 29)], close=True)
    blk.add_lwpolyline([(3, 16, 0, 0, 0.4), (19, 16, 0, 0, 0)], format="xyseb", dxfattribs={"const_width": 1.2})
    blk.add_lwpolyline([(22, 4, 0, 3, 0), (38, 4, 0, 0, 0)], format="xyseb")
    return blk


@suite("blocks", "BLOCK/INSERT/MINSERT: transforms, nesting, inheritance, visibility", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    _base_and_transforms(s)
    _nonuniform(s)
    _nesting(s)
    _mirrtext(s)
    _minsert(s)
    _inheritance(s)
    _visibility(s)
    _units_anon_misc(s)
    _linetype_lineweight(s)
    _random(s)


# --------------------------------------------------------------------------------------------
def _base_and_transforms(s: SuiteBuilder) -> None:
    c = s.case("base-point", "F block with base point (5,3) inserted at (100,75), scale 1 (cross = insertion point)", tags=["INSERT", "BLOCK", "base-point"], questions=["Q-0609"])
    f_block(c.doc, base=(5, 3))
    c.msp.add_blockref("F", (100, 75))
    cross(c, (100, 75))
    c.window((0, 0), (200, 150))

    c = s.case("base-point-far", "F block with base point (-40,25) inserted at (100,75)", tags=["INSERT", "BLOCK", "base-point"], questions=["Q-0609"])
    f_block(c.doc, base=(-40, 25))
    c.msp.add_blockref("F", (100, 75))
    cross(c, (100, 75))
    c.window((0, 0), (200, 150))

    for i, rot in enumerate([0, 30, 90, 180, 270, -45, 359.5], 1):
        c = s.case(f"rotation-{i:04d}", f"F block base (5,3), INSERT rotation {rot}", tags=["INSERT", "rotation"], params={"rotation": rot})
        f_block(c.doc)
        c.msp.add_blockref("F", (100, 75), dxfattribs={"rotation": rot})
        cross(c, (100, 75))
        c.window((0, 0), (200, 150))

    for i, (sx, sy) in enumerate([(0.5, 0.5), (2, 2), (-2, -2), (2.5, 2.5)], 1):
        c = s.case(f"scale-{i:04d}", f"F block base (5,3), uniform INSERT scale ({sx},{sy})", tags=["INSERT", "scale"], params={"scale": [sx, sy]})
        f_block(c.doc)
        c.msp.add_blockref("F", (100, 75), dxfattribs={"xscale": sx, "yscale": sy, "zscale": abs(sx)})
        cross(c, (100, 75))
        c.fit()

    c = s.case("mirror-rot30", "F block base (5,3), INSERT sx=-1 rotation 30", tags=["INSERT", "mirror", "rotation"], questions=["Q-0127"])
    f_block(c.doc)
    c.msp.add_blockref("F", (100, 60), dxfattribs={"xscale": -1, "rotation": 30})
    cross(c, (100, 60))
    c.window((0, 0), (200, 150))

    for key, n in (("negz", (0, 0, -1)), ("skew", (0.3, 0.4, 0.866))):
        c = s.case(f"extrusion-{key}", f"F block base (5,3), INSERT with extrusion {n}, rotation 20 (plan view)", tags=["INSERT", "OCS"], questions=["Q-0127"], params={"extrusion": n})
        f_block(c.doc)
        ocs = OCS(n)
        p = ocs.from_wcs(Vec3(100, 60, 0))
        c.msp.add_blockref("F", p, dxfattribs={"extrusion": n, "rotation": 20})
        cross(c, (100, 60))
        c.window((0, 0), (200, 150))

    c = s.case("extrusion-nested", "Block with a child INSERT extrusion (0,0,-1) rot 30, parent INSERT rot 30 scale 1.5", tags=["INSERT", "OCS", "nested"], questions=["Q-0127"])
    f_block(c.doc)
    par = c.doc.blocks.new("PAR", base_point=(0, 0))
    par.add_lwpolyline([(-5, -5), (45, -5), (45, 55), (-5, 55)], close=True)
    par.add_blockref("F", OCS((0, 0, -1)).from_wcs(Vec3(20, 5, 0)), dxfattribs={"extrusion": (0, 0, -1), "rotation": 30})
    c.msp.add_blockref("PAR", (80, 20), dxfattribs={"xscale": 1.5, "yscale": 1.5, "zscale": 1.5, "rotation": 30})
    cross(c, (80, 20))
    c.fit()


# --------------------------------------------------------------------------------------------
def _nonuniform(s: SuiteBuilder) -> None:
    sweeps = [(1, 1, 0), (2, 1, 0), (1, -1, 0), (-1, -1, 0), (0.5, 3, 0), (3, 1, 30), (-1, 1, 30), (2, 0.5, -20)]
    for i, (sx, sy, rot) in enumerate(sweeps, 1):
        c = s.case(
            f"nonuniform-{i:04d}",
            f"Block with circle/arc/TEXT/ANSI31 hatch/bulged wide and tapered LWPOLYLINE, INSERT scale ({sx},{sy}) rot {rot}",
            tags=["INSERT", "non-uniform-scale", "CIRCLE", "ARC", "TEXT", "HATCH", "LWPOLYLINE"],
            questions=["Q-0614", "Q-0157", "Q-0404", "Q-0359"],
            params={"xscale": sx, "yscale": sy, "rotation": rot},
        )
        _rich_block(c.doc)
        c.msp.add_blockref("RICH", (100, 75), dxfattribs={"xscale": sx, "yscale": sy, "rotation": rot})
        cross(c, (100, 75))
        c.fit()

    c = s.case("nonuniform-circle-arc", "Block with CIRCLE r=12 and ARC r=7 0..120 deg, INSERT sx=3 sy=1 (exact ellipse?)", tags=["INSERT", "non-uniform-scale", "CIRCLE", "ARC"], questions=["Q-0614"])
    blk = c.doc.blocks.new("CA")
    blk.add_circle((0, 0), 12)
    blk.add_arc((0, 0), 7, 0, 120)
    c.msp.add_blockref("CA", (100, 75), dxfattribs={"xscale": 3, "yscale": 1})
    c.window((0, 0), (200, 150))

    c = s.case("nonuniform-circle-rot", "Block with CIRCLE r=12 and ARC r=7 0..120, INSERT sx=3 sy=1 rotation 30 (rotated ellipse)", tags=["INSERT", "non-uniform-scale", "CIRCLE", "ARC"], questions=["Q-0614"])
    blk = c.doc.blocks.new("CA")
    blk.add_circle((0, 0), 12)
    blk.add_arc((0, 0), 7, 0, 120)
    c.msp.add_blockref("CA", (100, 75), dxfattribs={"xscale": 3, "yscale": 1, "rotation": 30})
    c.window((0, 0), (200, 150))

    for i, (sx, sy) in enumerate([(3, 1), (1, 3)], 1):
        c = s.case(f"nonuniform-bulge-width-{i:04d}", f"Block with bulged LWPOLYLINE const width 2 and a tapered segment, INSERT ({sx},{sy})", tags=["INSERT", "non-uniform-scale", "LWPOLYLINE", "width", "bulge"], questions=["Q-0157"], params={"xscale": sx, "yscale": sy})
        blk = c.doc.blocks.new("BW")
        blk.add_lwpolyline([(-20, 0, 0, 0, 1), (0, 0, 0, 0, -0.5), (20, 0, 0, 0, 0)], format="xyseb", dxfattribs={"const_width": 2})
        blk.add_lwpolyline([(-20, -12, 0, 4, 0.3), (20, -12, 0, 0, 0)], format="xyseb")
        c.msp.add_blockref("BW", (100, 80), dxfattribs={"xscale": sx, "yscale": sy})
        c.fit()

    c = s.case("nonuniform-text", "Block with TEXT (Liberation Sans) and MTEXT, INSERT sx=2 sy=1", tags=["INSERT", "non-uniform-scale", "TEXT", "MTEXT"], questions=["Q-0404"])
    blk = c.doc.blocks.new("TX")
    blk.add_text("Stretch Fg", height=8).set_placement((0, 20))
    blk.add_mtext("MText Ag\\PLine two", dxfattribs={"char_height": 6, "insert": (0, 12), "width": 60})
    c.msp.add_blockref("TX", (20, 60), dxfattribs={"xscale": 2, "yscale": 1})
    cross(c, (20, 60))
    c.fit()

    c = s.case("nonuniform-text-nested-rot", "TEXT/MTEXT block inserted rot 30 inside a parent inserted sx=2 sy=1 (sheared glyphs)", tags=["INSERT", "non-uniform-scale", "shear", "TEXT", "MTEXT", "nested"], questions=["Q-0404", "Q-0615"])
    blk = c.doc.blocks.new("TX")
    blk.add_text("Shear Fg", height=8).set_placement((0, 20))
    blk.add_mtext("MText Ag\\PLine two", dxfattribs={"char_height": 6, "insert": (0, 12), "width": 60})
    par = c.doc.blocks.new("TXP")
    par.add_blockref("TX", (0, 0), dxfattribs={"rotation": 30})
    c.msp.add_blockref("TXP", (30, 30), dxfattribs={"xscale": 2, "yscale": 1})
    cross(c, (30, 30))
    c.fit()

    c = s.case("nonuniform-hatch", "Block with ANSI31 and SOLID hatches, INSERT sx=2 sy=1 rotation 30 (pattern distortion)", tags=["INSERT", "non-uniform-scale", "HATCH"], questions=["Q-0359"])
    blk = c.doc.blocks.new("HB")
    h = blk.add_hatch()
    h.set_pattern_fill("ANSI31", scale=1)
    h.paths.add_polyline_path([(0, 0), (40, 0), (40, 30), (0, 30)], is_closed=True)
    blk.add_lwpolyline([(0, 0), (40, 0), (40, 30), (0, 30)], close=True)
    h = blk.add_hatch(color=7)
    h.paths.add_edge_path().add_arc((55, 15), 10, 0, 360)
    c.msp.add_blockref("HB", (50, 20), dxfattribs={"xscale": 2, "yscale": 1, "rotation": 30})
    c.fit()

    for i, pdsize in enumerate([5, -5], 1):
        c = s.case(f"points-pdmode-{i:04d}", f"POINTs PDMODE 34 PDSIZE {pdsize} in a block, INSERT sx=3 sy=1 rot 30 (+ top-level POINT)", tags=["INSERT", "non-uniform-scale", "POINT", "PDMODE"], questions=["Q-0163"], params={"pdsize": pdsize}, header={"$PDMODE": 34, "$PDSIZE": pdsize})
        blk = c.doc.blocks.new("PT")
        for x in (-10, 0, 10):
            blk.add_point((x, 0))
        blk.add_line((-10, -6), (10, -6))
        c.msp.add_blockref("PT", (100, 80), dxfattribs={"xscale": 3, "yscale": 1, "rotation": 30})
        c.msp.add_point((30, 30))
        c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
def _nested_blocks(doc):
    """L1 = F (base (5,3)); L2 = frame + two L1 INSERTs, base (10,-4); L3 = circle + two L2
    INSERTs, base (-7,12)."""
    f_block(doc, "L1", base=(5, 3))
    l2 = doc.blocks.new("L2", base_point=(10, -4))
    l2.add_lwpolyline([(-2, -6), (80, -6), (80, 56), (-2, 56)], close=True)
    l2.add_blockref("L1", (5, 3))
    l2.add_blockref("L1", (70, 5), dxfattribs={"rotation": 90, "xscale": 0.5, "yscale": 0.5})
    l3 = doc.blocks.new("L3", base_point=(-7, 12))
    l3.add_circle((-7, 12), 4)
    l3.add_blockref("L2", (0, 0))
    l3.add_blockref("L2", (100, 60), dxfattribs={"rotation": -30, "xscale": 0.6, "yscale": -0.6})


def _nesting(s: SuiteBuilder) -> None:
    variants = [(1, 1, 0), (1, 1, 30), (-1, 1, 0), (2, 0.5, 15)]
    for i, (sx, sy, rot) in enumerate(variants, 1):
        c = s.case(f"nested-3level-{i:04d}", f"3-level nested blocks with base points != 0 (child rot/scale/mirror), outer INSERT ({sx},{sy}) rot {rot}", tags=["INSERT", "nested", "base-point"], questions=["Q-0609", "Q-0615"], params={"xscale": sx, "yscale": sy, "rotation": rot})
        _nested_blocks(c.doc)
        c.msp.add_blockref("L3", (20, 20), dxfattribs={"xscale": sx, "yscale": sy, "rotation": rot})
        cross(c, (20, 20))
        c.fit()

    c = s.case("nested-shear", "Parent INSERT sx=2 sy=0.5 containing a child F INSERT rot 30 (sheared composite matrix)", tags=["INSERT", "nested", "shear"], questions=["Q-0615"])
    f_block(c.doc)
    par = c.doc.blocks.new("SH")
    par.add_blockref("F", (0, 0), dxfattribs={"rotation": 30})
    par.add_lwpolyline([(-30, -10), (40, -10), (40, 60), (-30, 60)], close=True)
    c.msp.add_blockref("SH", (100, 60), dxfattribs={"xscale": 2, "yscale": 0.5})
    cross(c, (100, 60))
    c.fit()

    c = s.case("nested-shear-circle", "Parent INSERT sx=2 sy=0.5 containing a child INSERT rot 45 of a circle+arc block (sheared circle = rotated ellipse)", tags=["INSERT", "nested", "shear", "CIRCLE", "ARC"], questions=["Q-0615", "Q-0614"])
    blk = c.doc.blocks.new("CA")
    blk.add_circle((0, 0), 20)
    blk.add_arc((0, 0), 12, 10, 200)
    blk.add_line((0, 0), (20, 0))
    par = c.doc.blocks.new("SH")
    par.add_blockref("CA", (0, 0), dxfattribs={"rotation": 45, "xscale": 1, "yscale": 0.5})
    c.msp.add_blockref("SH", (100, 75), dxfattribs={"xscale": 2, "yscale": 0.5})
    c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
def _mirror_block(doc) -> None:
    blk = doc.blocks.new("MT", base_point=(0, 0))
    blk.add_lwpolyline([(0, 0), (70, 0), (70, 40), (0, 40)], close=True)
    blk.add_text("TEXT Fg", height=6).set_placement((3, 30))
    blk.add_mtext("MTEXT Rk\\Pline 2", dxfattribs={"char_height": 5, "insert": (3, 24), "width": 60})
    blk.add_attdef("CTAG", (3, 5), "CONST Pq", height=5, dxfattribs={"flags": 2})
    blk.add_attdef("VTAG", (40, 5), "var", height=5)


def _mirrtext(s: SuiteBuilder) -> None:
    modes = [
        ("0-sx", 0, {"xscale": -1}, "sx=-1"),
        ("1-sx", 1, {"xscale": -1}, "sx=-1"),
        ("0-sy", 0, {"yscale": -1}, "sy=-1"),
        ("1-sy", 1, {"yscale": -1}, "sy=-1"),
        ("0-negz", 0, {"extrusion": (0, 0, -1)}, "extrusion (0,0,-1)"),
    ]
    for key, mirr, attrs, desc in modes:
        c = s.case(
            f"mirrtext-{key}",
            f"Block with TEXT, MTEXT, constant ATTDEF, variable ATTDEF: plain INSERT (top) and mirrored INSERT {desc} with ATTRIB (bottom), $MIRRTEXT {mirr}",
            tags=["INSERT", "mirror", "MIRRTEXT", "TEXT", "MTEXT", "ATTDEF", "ATTRIB"],
            questions=["Q-0616", "Q-0494"],
            params={"mirrtext": mirr, "mirror": desc},
            header={"$MIRRTEXT": mirr},
        )
        _mirror_block(c.doc)
        top = c.msp.add_blockref("MT", (65, 85))
        top.add_attrib("VTAG", "attrib top", (105, 90), dxfattribs={"height": 5})
        a = dict(attrs)
        if "extrusion" in a:
            ins_pt = OCS(a["extrusion"]).from_wcs(Vec3(135, 20, 0))
            wx0 = 135
        elif "xscale" in a:
            ins_pt = (135, 20)
            wx0 = 135
        else:
            ins_pt = (65, 60)
            wx0 = 65
        m = c.msp.add_blockref("MT", ins_pt, dxfattribs=a)
        # readable ATTRIB placed at the mirrored ATTDEF location (as MIRROR with MIRRTEXT 0 does)
        if "yscale" in a:
            m.add_attrib("VTAG", "attrib mir", (wx0 + 40, 60 - 5 - 5), dxfattribs={"height": 5})
        else:
            m.add_attrib("VTAG", "attrib mir", (wx0 - 70, 25), dxfattribs={"height": 5})
        cross(c, (65, 85))
        cross(c, (wx0, 20 if "yscale" not in a else 60))
        c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
def _minsert(s: SuiteBuilder) -> None:
    variants = [
        ("plain", 1, 1, 0, 40, 30),
        ("scaled", 2, 0.5, 0, 40, 30),
        ("rotated", 1, 1, 30, 40, 30),
        ("rot-scaled", 2, 0.5, 30, 45, 20),
        ("negative-spacing", 1, 1, 0, -40, -30),
        ("mirrored", -1, 1, 15, 40, 30),
    ]
    for key, sx, sy, rot, dc, dr in variants:
        c = s.case(
            f"minsert-{key}",
            f"MINSERT 3 cols x 2 rows spacing ({dc},{dr}), scale ({sx},{sy}), rot {rot}, block base (1,2); REF crosses = unscaled rotated grid, REF circles = scaled grid hypothesis",
            tags=["MINSERT", "INSERT"],
            questions=["Q-0618"],
            params={"xscale": sx, "yscale": sy, "rotation": rot, "col_spacing": dc, "row_spacing": dr},
        )
        blk = c.doc.blocks.new("SQ", base_point=(1, 2))
        blk.add_lwpolyline([(0, 0), (16, 0), (16, 16), (0, 16)], close=True)
        blk.add_line((0, 0), (7, 7))
        blk.add_circle((1, 2), 1.5)
        ins = (50, 40) if dc > 0 else (150, 110)
        c.msp.add_blockref(
            "SQ", ins,
            dxfattribs={"xscale": sx, "yscale": sy, "rotation": rot, "column_count": 3, "row_count": 2, "column_spacing": dc, "row_spacing": dr},
        )
        a = math.radians(rot)
        for col in range(3):
            for row in range(2):
                ox, oy = col * dc, row * dr
                px = ins[0] + ox * math.cos(a) - oy * math.sin(a)
                py = ins[1] + ox * math.sin(a) + oy * math.cos(a)
                cross(c, (px, py), size=2)
                # scaled-grid hypothesis (mlightcad): offset scaled by 41/42 before rotation
                sx_, sy_ = ox * sx, oy * sy
                qx = ins[0] + sx_ * math.cos(a) - sy_ * math.sin(a)
                qy = ins[1] + sx_ * math.sin(a) + sy_ * math.cos(a)
                c.msp.add_circle((qx, qy), 1.5, dxfattribs={"layer": "REF"})
        c.fit()

    c = s.case("minsert-zero-spacing", "MINSERT 3x1 with spacing 0 of a 50%-transparent solid hatch (left) vs a single INSERT (right)", tags=["MINSERT", "transparency", "HATCH"], questions=["Q-0619"], style_table="acad.ctb")
    blk = c.doc.blocks.new("TR")
    h = blk.add_hatch(color=5)
    h.paths.add_polyline_path([(0, 0), (60, 0), (60, 60), (0, 60)], is_closed=True)
    h.transparency = 0.5
    c.msp.add_blockref("TR", (20, 45), dxfattribs={"column_count": 3, "row_count": 1, "column_spacing": 0, "row_spacing": 0})
    c.msp.add_blockref("TR", (120, 45))
    c.notes.append("transparency only shows if the plot honours object transparency")
    c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
KINDS = [("0", "BYLAYER"), ("0", "BYBLOCK"), ("L1", "BYLAYER"), ("L1", "BYBLOCK")]


def _props(mode: str, color: int = 0, lt: str = "", lw: int = 0) -> dict:
    if mode == "BYLAYER":
        return {"color": 256, "linetype": "BYLAYER", "lineweight": -1}
    if mode == "BYBLOCK":
        return {"color": 0, "linetype": "BYBLOCK", "lineweight": -2}
    return {"color": color, "linetype": lt, "lineweight": lw}


def _inherit_resources(c) -> None:
    for lt in ("DASHED", "CENTER", "HIDDEN", "PHANTOM", "DASHDOT", "DOT"):
        c.linetype(lt)
    c.layer("L1", color=3, linetype="DASHED", lineweight=30)
    c.layer("RED", color=1, linetype="CENTER", lineweight=70)
    c.layer("BLU", color=5, linetype="HIDDEN", lineweight=50)


def _four_lines(blk, y0: float) -> None:
    for k, (layer, mode) in enumerate(KINDS):
        a = _props(mode)
        a["layer"] = layer
        blk.add_line((0, y0 - 15 * k), (38, y0 - 15 * k), dxfattribs=a)


OUTER = [
    ("RED", "BYLAYER"),
    ("RED", "explicit"),
    ("RED", "BYBLOCK"),
    ("0", "BYLAYER"),
]
INNER = [
    ("0", "BYBLOCK"),
    ("0", "BYLAYER"),
    ("BLU", "BYLAYER"),
    ("BLU", "explicit"),
]


def _inheritance(s: SuiteBuilder) -> None:
    for i, (ilayer, imode) in enumerate(INNER, 1):
        c = s.case(
            f"inherit-matrix-{i:04d}",
            f"Layer-0/BYBLOCK matrix, 2 levels: columns = outer INSERT {{RED BYLAYER, RED explicit(30,DASHDOT,1.00), RED BYBLOCK, layer 0 BYLAYER}}; top 4 lines = level 1, bottom 4 = level 2 via inner INSERT on {ilayer} {imode}",
            tags=["INSERT", "BYBLOCK", "BYLAYER", "layer-0", "nested", "color", "linetype", "lineweight"],
            questions=["Q-0278"],
            params={"inner_layer": ilayer, "inner_mode": imode, "line_kinds": KINDS, "outer": OUTER},
            style_table="acad.ctb",
            header={"$LTSCALE": 0.2},
        )
        _inherit_resources(c)
        a = c.doc.blocks.new("A")
        _four_lines(a, 0)
        b = c.doc.blocks.new("B")
        _four_lines(b, 0)
        ia = _props(imode, 6, "PHANTOM", 35)
        ia["layer"] = ilayer
        b.add_blockref("A", (0, -65), dxfattribs=ia)
        for col, (olayer, omode) in enumerate(OUTER):
            oa = _props(omode, 30, "DASHDOT", 100)
            oa["layer"] = olayer
            c.msp.add_blockref("B", (6 + col * 50, 140), dxfattribs=oa)
        c.window((0, 0), (200, 150))

    for i, (olayer, omode) in enumerate([("RED", "explicit"), ("RED", "BYLAYER")], 1):
        c = s.case(
            f"inherit-3level-{i:04d}",
            f"3-level BYBLOCK chain: outer INSERT {olayer} {omode}; columns = middle INSERT {{0 BYBLOCK, 0 BYLAYER, BLU BYLAYER, 0 explicit(6,PHANTOM,0.35)}}, innermost INSERT 0 BYBLOCK of the 4-line block",
            tags=["INSERT", "BYBLOCK", "layer-0", "nested", "color", "linetype", "lineweight"],
            questions=["Q-0278"],
            params={"outer": [olayer, omode], "line_kinds": KINDS},
            style_table="acad.ctb",
            header={"$LTSCALE": 0.2},
        )
        _inherit_resources(c)
        a = c.doc.blocks.new("A")
        _four_lines(a, 0)
        b = c.doc.blocks.new("B")
        b.add_blockref("A", (0, 0), dxfattribs={"layer": "0", **_props("BYBLOCK")})
        mids = [("0", "BYBLOCK"), ("0", "BYLAYER"), ("BLU", "BYLAYER"), ("0", "explicit")]
        for col, (mlayer, mmode) in enumerate(mids):
            cb = c.doc.blocks.new(f"C{col}")
            ma = _props(mmode, 6, "PHANTOM", 35)
            ma["layer"] = mlayer
            cb.add_blockref("B", (0, 0), dxfattribs=ma)
            oa = _props(omode, 30, "DASHDOT", 100)
            oa["layer"] = olayer
            c.msp.add_blockref(f"C{col}", (6 + col * 50, 120), dxfattribs=oa)
        c.window((0, 0), (200, 150))

    c = s.case("inherit-toplevel-byblock", "Model-space LINEs with BYBLOCK colour/linetype/lineweight on layers 0 and RED next to BYLAYER ones", tags=["BYBLOCK", "color", "linetype", "lineweight"], questions=["Q-0278"], style_table="acad.ctb", header={"$LTSCALE": 0.2})
    _inherit_resources(c)
    for k, (layer, mode) in enumerate([("0", "BYLAYER"), ("0", "BYBLOCK"), ("RED", "BYLAYER"), ("RED", "BYBLOCK")]):
        a = _props(mode)
        a["layer"] = layer
        c.msp.add_line((30, 120 - 30 * k), (170, 120 - 30 * k), dxfattribs=a)
    c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
def _vis_blocks(c) -> None:
    q = c.doc.blocks.new("Q")
    q.add_circle((8, 8), 8, dxfattribs={"layer": "0"})
    q.add_lwpolyline([(20, 0), (36, 0), (36, 16), (20, 16)], close=True, dxfattribs={"layer": "X"})
    p = c.doc.blocks.new("P")
    p.add_line((0, 0), (60, 0), dxfattribs={"layer": "0"})
    p.add_line((0, 10), (60, 10), dxfattribs={"layer": "0", "color": 0})
    p.add_line((0, 20), (60, 20), dxfattribs={"layer": "X"})
    p.add_blockref("Q", (80, 0), dxfattribs={"layer": "0"})
    p.add_blockref("Q", (80, 30), dxfattribs={"layer": "X"})
    p.add_blockref("Q", (0, 35), dxfattribs={"layer": "Y"})


def _visibility(s: SuiteBuilder) -> None:
    states = {
        "on": {},
        "off": {"on": False},
        "frozen": {"frozen": True},
        "noplot": {"plot": False},
    }
    for key, st in states.items():
        qs = ["Q-0280"] + (["Q-0282"] if key == "noplot" else [])
        c = s.case(
            f"vis-insert-layer-{key}",
            f"INSERT on layer Y ({key}) of block P: layer-0 BYLAYER/BYBLOCK lines, layer-X line, nested INSERTs of Q on layers 0/X/Y (Q: layer-0 circle, layer-X square); top-level LINE on Y at top, REF cross",
            tags=["INSERT", "layer-0", "visibility", "layer-off", "layer-frozen", "layer-plot"],
            questions=qs,
            params={"insert_layer_state": key},
            header={"$CLAYER": "REF"},
        )
        ref_layer(c)
        c.layer("X", color=7)
        c.layer("Y", color=7, **st)
        _vis_blocks(c)
        c.msp.add_blockref("P", (30, 40), dxfattribs={"layer": "Y"})
        c.msp.add_line((30, 130), (170, 130), dxfattribs={"layer": "Y"})
        cross(c, (30, 40))
        c.window((0, 0), (200, 150))

    for key, st in (("off", "off"), ("frozen", "freeze"), ("noplot", "noplot")):
        qs = ["Q-0281"] + (["Q-0282"] if key == "noplot" else [])
        c = s.case(
            f"vis-layer0-{key}",
            f"Layer 0 {key}: block P inserted on layer Y (left, on) and on layer 0 (right); top-level LINEs on 0 and X at top",
            tags=["INSERT", "layer-0", "visibility"],
            questions=qs,
            params={"layer0_state": key},
            header={"$CLAYER": "REF"},
        )
        ref_layer(c)
        c.layer("X", color=7)
        c.layer("Y", color=7)
        l0 = c.doc.layers.get("0")
        if st == "off":
            l0.off()
        elif st == "freeze":
            l0.freeze()
        else:
            l0.dxf.plot = 0
        q = c.doc.blocks.new("Q")
        q.add_circle((8, 8), 8, dxfattribs={"layer": "0"})
        q.add_lwpolyline([(20, 0), (36, 0), (36, 16), (20, 16)], close=True, dxfattribs={"layer": "X"})
        p = c.doc.blocks.new("P")
        p.add_line((0, 0), (40, 0), dxfattribs={"layer": "0"})
        p.add_line((0, 10), (40, 10), dxfattribs={"layer": "0", "color": 0})
        p.add_line((0, 20), (40, 20), dxfattribs={"layer": "X"})
        p.add_blockref("Q", (0, 30), dxfattribs={"layer": "0"})
        c.msp.add_blockref("P", (20, 50), dxfattribs={"layer": "Y"})
        c.msp.add_blockref("P", (120, 50), dxfattribs={"layer": "0"})
        c.msp.add_line((20, 130), (80, 130), dxfattribs={"layer": "0"})
        c.msp.add_line((120, 130), (180, 130), dxfattribs={"layer": "X"})
        cross(c, (20, 50))
        cross(c, (120, 50))
        c.window((0, 0), (200, 150))

    c = s.case("vis-invisible-flag", "Block with 60=1 LINE inside, INSERT with 60=1 (right) and normal INSERT (left)", tags=["INSERT", "visibility", "invisible"], questions=["Q-0246"])
    ref_layer(c)
    b = c.doc.blocks.new("IV")
    b.add_lwpolyline([(0, 0), (50, 0), (50, 50), (0, 50)], close=True)
    b.add_line((0, 0), (50, 50), dxfattribs={"invisible": 1})
    b.add_line((0, 50), (50, 0))
    c.msp.add_blockref("IV", (20, 50))
    c.msp.add_blockref("IV", (120, 50), dxfattribs={"invisible": 1})
    cross(c, (120, 50))
    c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
def _units_anon_misc(s: SuiteBuilder) -> None:
    for i, (ins, blk_units) in enumerate([(4, 1), (1, 4), (4, 0)], 1):
        c = s.case(
            f"units-{i:04d}",
            f"$INSUNITS {ins}, BLOCK_RECORD units 70={blk_units}, INSERT scale 1 of a 50x50 square (REF square 52x52 around the unscaled result)",
            tags=["INSERT", "BLOCK_RECORD", "INSUNITS", "units"],
            questions=["Q-0612"],
            params={"insunits": ins, "block_units": blk_units},
            units=ins,
        )
        ref_layer(c)
        b = c.doc.blocks.new("U50", base_point=(0, 0))
        b.block_record.dxf.units = blk_units
        b.add_lwpolyline([(0, 0), (50, 0), (50, 50), (0, 50)], close=True)
        b.add_line((0, 0), (50, 50))
        b.add_circle((25, 25), 10)
        c.msp.add_blockref("U50", (75, 50))
        c.msp.add_lwpolyline([(74, 49), (126, 49), (126, 101), (74, 101)], close=True, dxfattribs={"layer": "REF"})
        cross(c, (75, 50))
        c.window((0, 0), (200, 150))

    for ch in ("U", "E"):
        c = s.case(f"anonymous-{ch.lower()}", f"INSERT of an anonymous *{ch}1 block (flag 1) with F content, base (5,3), rot 15", tags=["INSERT", "BLOCK", "anonymous"], questions=["Q-0611"] if ch == "E" else [])
        blk = c.doc.blocks.new_anonymous_block(ch, base_point=(5, 3))
        blk.add_lwpolyline(F_OUTLINE, close=True)
        blk.add_circle((20, 8), 5)
        c.msp.add_blockref(blk.name, (100, 60), dxfattribs={"rotation": 15})
        cross(c, (100, 60))
        c.params["block"] = blk.name
        c.window((0, 0), (200, 150))

    for axis, sentinel in (("x", "0.987654321"), ("y", "0.876543219"), ("z", "0.765432198")):
        c = s.case(
            f"zero-scale-{axis}",
            f"INVALID ON PURPOSE: INSERT with {axis}-scale 41/42/43 = 0 of a square+circle block (REF cross = insertion point)",
            tags=["INSERT", "scale", "invalid"],
            questions=["Q-0613"],
            params={"zero_axis": axis},
        )
        b = c.doc.blocks.new("SC")
        b.add_lwpolyline([(-30, -30), (30, -30), (30, 30), (-30, 30)], close=True)
        b.add_circle((10, 5), 12)
        ins = c.msp.add_blockref("SC", (100, 75), dxfattribs={"rotation": 20})
        ins.dxf.set(f"{axis}scale", float(sentinel))
        c.byte_filters.append(zero_scale_filter(sentinel))
        c.allow_audit_errors = True
        cross(c, (100, 75))
        c.window((0, 0), (200, 150))

    # hand-made visibility-state block: definition + *U representations with 60=1, no
    # AcDbDynamicBlock / ACAD_ENHANCEDBLOCK data (geometry from ACadSharp BLOCKVISIBILITYPARAMETER)
    c = s.case(
        "dynamic-like-u-blocks",
        "Visibility-state style *U blocks (entities hidden with 60=1), INSERTed x7 without any dynamic-block data; left = the plain definition",
        tags=["INSERT", "BLOCK", "anonymous", "dynamic-block", "invisible"],
        questions=["Q-0621"],
    )
    circ = ((3.517580941685125, 3.030945614423675), 2.5)
    l1 = ((0, 0), (5, 5))
    l2 = ((2.5, 2.5), (4.708006693411043, 0.032056982916945))
    p1 = [(2.22101048983341, 4.186906221133032), (0.4140522937602214, 2.536615631310954), (2.493025706578983, 0.5368517513563021), (4.610858406624693, 2.225972692726237)]
    p2 = [(0.3226717298425967, 5.290033280519622), (0.3226717298425962, 2.68319247764149), (2.989861616443484, 3.57807813984505), (3.223484079233763, 6.418367367719017)]

    def fill(blk, hidden):
        blk.add_circle(circ[0], circ[1], dxfattribs={"invisible": int("c" in hidden)})
        blk.add_line(*l1, dxfattribs={"invisible": int("l1" in hidden)})
        blk.add_line(*l2, dxfattribs={"invisible": int("l2" in hidden)})
        blk.add_lwpolyline(p1, close=True, dxfattribs={"invisible": int("p1" in hidden)})
        blk.add_lwpolyline(p2, close=True, dxfattribs={"invisible": int("p2" in hidden)})

    d = c.doc.blocks.new("vis_def")
    fill(d, {"p1"})
    c.msp.add_blockref("vis_def", (4, 50), dxfattribs={"xscale": 7, "yscale": 7})
    for k, hidden in enumerate([{"p1", "p2"}, {"l2", "p1"}, {"c", "l1", "l2"}], 1):
        u = c.doc.blocks.new_anonymous_block("U")
        fill(u, hidden)
        c.msp.add_blockref(u.name, (4 + 50 * k, 50), dxfattribs={"xscale": 7, "yscale": 7})
    c.window((0, 0), (200, 150))

    for key, flags in (("attach", 4), ("overlay", 12)):
        c = s.case(
            f"xref-missing-{key}",
            f"INSERT (rot 20, scale 2) of an unresolvable xref BLOCK (flags {flags}, path C:\\nope\\x.dwg) next to a normal block",
            tags=["INSERT", "XREF", "missing-xref"],
            questions=["Q-0626"],
            params={"flags": flags},
        )
        c.doc.add_xref_def("C:\\nope\\x.dwg", "XR", flags=flags)
        c.msp.add_blockref("XR", (60, 75), dxfattribs={"rotation": 20, "xscale": 2, "yscale": 2, "zscale": 2})
        f_block(c.doc)
        c.msp.add_blockref("F", (150, 50))
        cross(c, (60, 75))
        c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
def _linetype_lineweight(s: SuiteBuilder) -> None:
    variants = [("s1", 1, 1, 0), ("s3", 3, 3, 0), ("mirror", -1, 1, 0), ("nonuni-rot45", 2, 1, 45)]
    for key, sx, sy, rot in variants:
        c = s.case(
            f"linetype-scale-{key}",
            f"Block with DASHED horizontal/vertical LINEs and CIRCLE, INSERT scale ({sx},{sy}) rot {rot}; top-level DASHED reference line (60 long)",
            tags=["INSERT", "linetype", "non-uniform-scale"],
            questions=["Q-0320"],
            params={"xscale": sx, "yscale": sy, "rotation": rot},
        )
        c.linetype("DASHED")
        b = c.doc.blocks.new("LT")
        a = {"linetype": "DASHED"}
        b.add_line((0, 0), (60, 0), dxfattribs=a)
        b.add_line((0, 0), (0, 40), dxfattribs=a)
        b.add_circle((35, 22), 15, dxfattribs=a)
        c.msp.add_blockref("LT", (0, 0), dxfattribs={"xscale": sx, "yscale": sy, "rotation": rot})
        c.msp.add_line((0, -15), (60, -15), dxfattribs=a)
        c.fit()

    c = s.case("linetype-insert-ltscale", "DASHED LINE in block: INSERT with 48=3 (row 2) vs block child with 48=3 (row 3); top-level 48=1 (row 1) and 48=3 (row 4)", tags=["INSERT", "linetype", "ltscale"], questions=["Q-0321"])
    c.linetype("DASHED")
    b1 = c.doc.blocks.new("D1")
    b1.add_line((0, 0), (160, 0), dxfattribs={"linetype": "DASHED"})
    b3 = c.doc.blocks.new("D3")
    b3.add_line((0, 0), (160, 0), dxfattribs={"linetype": "DASHED", "ltscale": 3})
    c.msp.add_line((20, 120), (180, 120), dxfattribs={"linetype": "DASHED"})
    c.msp.add_blockref("D1", (20, 90), dxfattribs={"ltscale": 3})
    c.msp.add_blockref("D3", (20, 60))
    c.msp.add_line((20, 30), (180, 30), dxfattribs={"linetype": "DASHED", "ltscale": 3})
    c.window((0, 0), (200, 150))

    c = s.case("lineweight-insert-scale", "0.50 mm L-shapes in blocks inserted at scale 1, 5, (5,1) and 1000 (block geometry pre-shrunk to 40 units) + top-level 0.50 mm reference", tags=["INSERT", "lineweight", "scale"], questions=["Q-0213"])
    for k, (sx, sy) in enumerate([(1, 1), (5, 5), (5, 1), (1000, 1000)]):
        b = c.doc.blocks.new(f"W{k}")
        b.add_lwpolyline([(0, 40 / sy), (0, 0), (40 / sx, 0)], dxfattribs={"lineweight": 50})
        c.msp.add_blockref(f"W{k}", (10 + 47 * k, 60), dxfattribs={"xscale": sx, "yscale": sy})
    c.msp.add_lwpolyline([(10, 130), (190, 130)], dxfattribs={"lineweight": 50})
    c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
def _random(s: SuiteBuilder) -> None:
    for seed in range(1, 5):
        c = s.case(f"random-{seed:04d}", f"Random 3-level nesting with random base points, rotations and (non-uniform, negative) scales, seed {seed}", tags=["INSERT", "nested", "non-uniform-scale"], seed=seed)
        rng = c.rng
        f_block(c.doc, "R0", base=(rng.uniform(-10, 10), rng.uniform(-10, 10)))
        for lvl in (1, 2):
            b = c.doc.blocks.new(f"R{lvl}", base_point=(rng.uniform(-10, 10), rng.uniform(-10, 10)))
            b.add_circle((rng.uniform(-20, 20), rng.uniform(-20, 20)), rng.uniform(3, 10))
            for _ in range(rng.randint(1, 3)):
                sc = rng.choice([0.5, 1, 1.5, -1])
                b.add_blockref(
                    f"R{lvl - 1}",
                    (rng.uniform(-40, 40), rng.uniform(-40, 40)),
                    dxfattribs={"rotation": rng.choice([0, 30, 90, 135, 200]), "xscale": sc, "yscale": rng.choice([sc, abs(sc) * 2, 0.5])},
                )
        c.msp.add_blockref("R2", (0, 0), dxfattribs={"rotation": rng.uniform(0, 360), "xscale": rng.choice([1, -1, 1.5]), "yscale": rng.choice([1, 0.7])})
        c.fit()
