"""DIMENSION (all subtypes), ARC_DIMENSION, LARGE_RADIAL_DIMENSION, DIMSTYLE table and DSTYLE
overrides (note 05 §1-10, note 02 §2.6, notes 11a §10 / 11c §8).

Two modes per feature (see _dimensions_util.finish):

- ``-ez``: ezdxf renders the anonymous ``*D`` geometry block. AutoCAD displays/plots that block
  as-is, so the plot pins down *block rendering* (INSERT-like, BYBLOCK resolution, Defpoints).
- ``-nb``: no geometry block at all (no group 2); AutoCAD regenerates the dimension on load
  (netDxf#98, ACadSharp#556 — ezdxf claims AutoCAD refuses such files: the harness log decides,
  note 05 §15 conflict 1). The plot then shows *AutoCAD's own layout* and the DXFOUT re-save
  contains AutoCAD's ``*D`` block, which answers most layout/format questions.

Base style: ``Standard`` = ISO-25 values x1.6 (DIMTXT 4, DIMASZ 4, DIMEXO 1, DIMEXE 2, DIMGAP 1,
DIMTAD 1, DIMDEC 2, DIMZIN 8, DIMDSEP '.'), text style Standard (Liberation Sans). Most cases use
a 200x150 window at 10 px/unit. Per-dimension variations are DSTYLE XDATA overrides unless the
case says "DIMSTYLE record".
"""

from __future__ import annotations

import math

from ezdxf.math import Vec3

from ..core import SuiteBuilder, suite
from ..resources import TTF_FONTS
from ._dimensions_util import (
    MODE_TITLE,
    finish,
    setup_dimstyle,
    strip_entity_codes,
    strip_table_record_codes,
)

W = ((0, 0), (200, 150))
HP1, HP2, HBASE = (40, 50), (157.35, 50), (100, 80)  # horizontal: 117.35 units


def _geom(c):
    return c.layer("GEOM", color=8)


def _line(c, a, b):
    c.msp.add_line(a, b, dxfattribs={"layer": _geom(c)})


def _new(s: SuiteBuilder, name: str, title: str, *, style: dict | None = None, header: dict | None = None,
         sync_header: bool = True, **kw):
    c = s.case(name, title, **kw)
    setup_dimstyle(c, values=style, sync_header=sync_header)
    if header:
        for k, v in header.items():
            c.doc.header[k] = v
    return c


# --------------------------------------------------------------------------------------------
# per-type builders; return the DimStyleOverride (not finished)


def dim_horizontal(c, override=None, text="<>", p1=HP1, p2=HP2, base=HBASE, draw=True, **kw):
    if draw:
        _line(c, p1, p2)
    return c.msp.add_linear_dim(base=base, p1=p1, p2=p2, angle=0, text=text, dimstyle=kw.pop("dimstyle", "Standard"),
                                override=override, **kw)


def dim_vertical(c, override=None, text="<>"):
    p1, p2 = (70, 20), (70, 127.5)
    _line(c, p1, p2)
    return c.msp.add_linear_dim(base=(110, 75), p1=p1, p2=p2, angle=90, text=text, dimstyle="Standard", override=override)


def dim_rotated(c, override=None, text="<>"):
    p1, p2 = (40, 40), (160, 100)
    _line(c, p1, p2)
    return c.msp.add_linear_dim(base=(100, 95), p1=p1, p2=p2, angle=30, text=text, dimstyle="Standard", override=override)


def dim_aligned(c, override=None, text="<>", p1=(40, 40), p2=(160, 100), distance=15.0):
    _line(c, p1, p2)
    dso = c.msp.add_aligned_dim(p1=p1, p2=p2, distance=distance, text=text, dimstyle="Standard", override=override)
    # ezdxf writes a rotated linear dimension (70=32); make it a true ALIGNED one (70=33)
    dso.dimension.dxf.dimtype = (dso.dimension.dxf.dimtype & ~0x0F) | 1
    return dso


ANG2L_L1 = ((50, 30), (190, 30))
ANG2L_L2 = ((50, 30), (140, 120))


def dim_angular2l(c, override=None, text="<>", base=(142.7, 67.5), l1=ANG2L_L1, l2=ANG2L_L2):
    _line(c, *l1)
    _line(c, *l2)
    return c.msp.add_angular_dim_2l(base=base, line1=l1, line2=l2, text=text, dimstyle="Standard", override=override)


def dim_angular3p(c, override=None, text="<>", angle=60.0, radius=85.0, center=(60, 30), leg=110.0):
    p1 = (center[0] + leg, center[1])
    a = math.radians(angle)
    p2 = (center[0] + leg * math.cos(a), center[1] + leg * math.sin(a))
    _line(c, center, p1)
    _line(c, center, p2)
    base = (center[0] + radius * math.cos(a / 2), center[1] + radius * math.sin(a / 2))
    return c.msp.add_angular_dim_3p(base=base, center=center, p1=p1, p2=p2, text=text, dimstyle="Standard",
                                    override=override)


ARC_C, ARC_R, ARC_A = (100, 20), 70.0, (30.0, 150.0)


def dim_arc(c, override=None, text="<>", partial=False, leader=False):
    a0, a1 = map(math.radians, ARC_A)
    p1 = (ARC_C[0] + ARC_R * math.cos(a0), ARC_C[1] + ARC_R * math.sin(a0))
    p2 = (ARC_C[0] + ARC_R * math.cos(a1), ARC_C[1] + ARC_R * math.sin(a1))
    c.msp.add_arc(ARC_C, ARC_R, ARC_A[0], ARC_A[1], dxfattribs={"layer": _geom(c)})
    dso = c.msp.add_arc_dim_3p(base=(100, 110), center=ARC_C, p1=p1, p2=p2, text=text, dimstyle="Standard",
                               override=override)
    d = dso.dimension.dxf
    # AutoCAD stores the measured arc's start/end parameters (rad) in 40/41 (note 05 §1.4)
    d.start_angle = a0
    d.end_angle = a1
    if partial:
        # measure only 60°..120° of the 30°..150° arc
        b0, b1 = math.radians(60), math.radians(120)
        d.defpoint2 = Vec3(ARC_C[0] + ARC_R * math.cos(b0), ARC_C[1] + ARC_R * math.sin(b0))
        d.defpoint3 = Vec3(ARC_C[0] + ARC_R * math.cos(b1), ARC_C[1] + ARC_R * math.sin(b1))
        d.start_angle, d.end_angle = b0, b1
        d.is_partial = 1
    if leader:
        d.has_leader = 1
        d.leader_point1 = Vec3(160, 120)
        d.leader_point2 = Vec3(ARC_C[0] + ARC_R * math.cos(math.radians(45)), ARC_C[1] + ARC_R * math.sin(math.radians(45)))
    else:
        d.leader_point1 = d.defpoint2
        d.leader_point2 = d.defpoint3
    return dso


CIRC_C, CIRC_R = (100, 75), 45.0


def dim_radius(c, override=None, text="<>", angle=45.0, location=None, circle=True):
    if circle:
        c.msp.add_circle(CIRC_C, CIRC_R, dxfattribs={"layer": _geom(c)})
    return c.msp.add_radius_dim(center=CIRC_C, radius=CIRC_R, angle=angle, text=text, location=location,
                                dimstyle="Standard", override=override)


def dim_diameter(c, override=None, text="<>", angle=30.0, location=None):
    c.msp.add_circle(CIRC_C, CIRC_R, dxfattribs={"layer": _geom(c)})
    return c.msp.add_diameter_dim(center=CIRC_C, radius=CIRC_R, angle=angle, text=text, location=location,
                                  dimstyle="Standard", override=override)


ORD_O, ORD_F = (30, 30), (120, 80)


def _ord_geom(c):
    _line(c, (ORD_O[0] - 5, ORD_O[1]), (ORD_O[0] + 5, ORD_O[1]))
    _line(c, (ORD_O[0], ORD_O[1] - 5), (ORD_O[0], ORD_O[1] + 5))
    c.msp.add_lwpolyline([ORD_O, (ORD_F[0], ORD_O[1]), ORD_F, (ORD_O[0], ORD_F[1])], close=True,
                         dxfattribs={"layer": _geom(c)})


def dim_ordinate_x(c, override=None, text="<>", rotation=0.0):
    _ord_geom(c)
    return c.msp.add_ordinate_x_dim(feature_location=ORD_F, offset=(0, 40), origin=ORD_O, rotation=rotation,
                                    text=text, dimstyle="Standard", override=override)


def dim_ordinate_y(c, override=None, text="<>", rotation=0.0):
    _ord_geom(c)
    return c.msp.add_ordinate_y_dim(feature_location=ORD_F, offset=(45, 0), origin=ORD_O, rotation=rotation,
                                    text=text, dimstyle="Standard", override=override)


# jogged radius on a big arc whose centre (100,-100) is outside the window
JOG_C, JOG_R = (100, -100), 200.0


def dim_jogged(c, override=None, swap=False, jog_angle_attr=None):
    """LARGE_RADIAL_DIMENSION (ezdxf cannot render it -> always without *D block).
    ezdxf semantics: 13 = chord point, 14 = override centre, 15 = jog point (swap=True writes
    the libredwg assignment 13 = jog, 15 = chord, note 05 §1.4 conflict)."""
    c.msp.add_arc(JOG_C, JOG_R, 60, 120, dxfattribs={"layer": _geom(c)})
    a = math.radians(75)
    chord = Vec3(JOG_C[0] + JOG_R * math.cos(a), JOG_C[1] + JOG_R * math.sin(a))
    center = Vec3(120, 15)
    jog = Vec3(128, 55)
    attribs = {
        "dimtype": 9 | 32,
        "dimstyle": "Standard",
        "defpoint": Vec3(JOG_C),
        "chord_point": jog if swap else chord,
        "override_center": center,
        "jog_point": chord if swap else jog,
        "text": "<>",
    }
    if jog_angle_attr is not None:
        attribs["unknown2"] = jog_angle_attr
    e = c.msp.new_entity("LARGE_RADIAL_DIMENSION", attribs)
    from ezdxf.entities import DimStyleOverride

    return DimStyleOverride(e, override=override)


TYPES = {
    "horizontal": (dim_horizontal, "linear horizontal DIMENSION (70=32), 117.35 long"),
    "vertical": (dim_vertical, "linear vertical DIMENSION (50=90), 107.5 long"),
    "rotated": (dim_rotated, "rotated linear DIMENSION (50=30) measuring a 26.6° segment"),
    "aligned": (dim_aligned, "aligned DIMENSION (70=33)"),
    "angular2l": (dim_angular2l, "2-line angular DIMENSION (70=34), 45°"),
    "angular3p": (dim_angular3p, "3-point angular DIMENSION (70=37), 60°"),
    "arc": (dim_arc, "ARC_DIMENSION on a 120° arc r=70"),
    "radius": (dim_radius, "radius DIMENSION (70=36) r=45 at 45°"),
    "diameter": (dim_diameter, "diameter DIMENSION (70=35) d=90 at 30°"),
    "ordinate-x": (dim_ordinate_x, "ordinate X-type DIMENSION (70=102)"),
    "ordinate-y": (dim_ordinate_y, "ordinate Y-type DIMENSION (70=38)"),
}

ARROW_NAMES = [
    ("closedfilled", ""), ("closedblank", "CLOSEDBLANK"), ("closed", "CLOSED"), ("dot", "DOT"),
    ("archtick", "ARCHTICK"), ("oblique", "OBLIQUE"), ("open", "OPEN"), ("origin", "ORIGIN"),
    ("origin2", "ORIGIN2"), ("open90", "OPEN90"), ("open30", "OPEN30"), ("dotsmall", "DOTSMALL"),
    ("dotblank", "DOTBLANK"), ("small", "SMALL"), ("boxblank", "BOXBLANK"), ("boxfilled", "BOXFILLED"),
    ("datumblank", "DATUMBLANK"), ("datumfilled", "DATUMFILLED"), ("integral", "INTEGRAL"), ("none", "NONE"),
]


def _user_arrow_block(c, name="ARROWX"):
    """Small cross + tail as a user arrow block (unit size, tip at origin)."""
    if name not in c.doc.blocks:
        b = c.doc.blocks.new(name)
        b.add_line((-0.5, -0.5), (0.5, 0.5))
        b.add_line((-0.5, 0.5), (0.5, -0.5))
        b.add_line((-1, 0), (0, 0))
    return name


def _append_dstyle(dim, pairs):
    """Append raw (code, value) pairs to the ACAD DSTYLE XDATA list (creating it if needed)."""
    try:
        tags = [tuple(t) for t in dim.get_xdata_list("ACAD", "DSTYLE")][2:-1]
    except Exception:
        tags = []
    dim.set_xdata_list("ACAD", "DSTYLE", tags + list(pairs))


def _rows(n, y0=20.0, dy=25.0):
    return [y0 + i * dy for i in range(n)]


def format_sheet(c, values, override, length=60.0, x0=70.0, text="<>"):
    """Rows of horizontal dims, each `length` long; DIMLFAC = value/length gives the displayed value."""
    ys = _rows(len(values), y0=15.0, dy=min(25.0, 125.0 / max(1, len(values) - 1)) if len(values) > 1 else 25.0)
    for v, y in zip(values, ys):
        ov = dict(override)
        ov["dimlfac"] = v / length
        dso = dim_horizontal(c, override=ov, text=text, p1=(x0, y), p2=(x0 + length, y), base=(x0, y + 8))
        finish(dso, "nb")


# --------------------------------------------------------------------------------------------


@suite("dimensions", "DIMENSION subtypes, DIMSTYLE variables, DSTYLE overrides, *D blocks", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    _types(s)
    _structure(s)
    _dimstyle_table(s)
    _layout(s)
    _fit(s)
    _arrows(s)
    _appearance(s)
    _radial(s)
    _curved(s)
    _formats(s)
    _random(s)


# --- every type with and without geometry block ---------------------------------------------
def _types(s):
    for kind, (fn, desc) in TYPES.items():
        for mode in ("ez", "nb"):
            qs = ["Q-0517"] if mode == "nb" else []
            if kind == "arc":
                qs.append("Q-0523")
            if kind == "aligned" and mode == "nb":
                qs.append("Q-0525")
            c = _new(s, f"type-{kind}-{mode}", f"{desc[0].upper()}{desc[1:]} ({MODE_TITLE[mode]})",
                     tags=["DIMENSION" if kind != "arc" else "ARC_DIMENSION", kind, mode], questions=qs,
                     params={"type": kind, "mode": mode})
            if kind == "angular2l" and mode == "ez":
                # ezdxf 1.4.4 draws the reflex 315° arc (text off-window) for the natural line order;
                # with the lines swapped it draws the 45° sector (but labels it 315°)
                finish(fn(c, l1=ANG2L_L2, l2=ANG2L_L1), mode)
                c.notes.append("lines swapped (line1 = 45° line) so that ezdxf draws the 45° sector")
            else:
                finish(fn(c), mode)
            c.window(*W)
    # text midpoint present but no block
    c = _new(s, "type-horizontal-nb11", "Linear DIMENSION without *D block but with ezdxf text midpoint 11 and 42",
             tags=["DIMENSION", "nb11"], questions=["Q-0517"])
    finish(dim_horizontal(c), "nb11")
    c.window(*W)
    # arc dimension as R2013 (70 type 5) for the type-code question
    for mode in ("ez", "nb"):
        c = _new(s, f"type-arc-r2013-{mode}", f"ARC_DIMENSION in an R2013 DXF (70 type 5) ({MODE_TITLE[mode]})",
                 tags=["ARC_DIMENSION", mode], questions=["Q-0523"] + (["Q-0517"] if mode == "nb" else []),
                 dxfversion="R2013")
        finish(dim_arc(c), mode)
        c.window(*W)
    # jogged radius (ezdxf cannot render it)
    for ver in ("R2013", "R2018"):
        c = _new(s, f"type-jogged-{ver.lower()}-nb", f"LARGE_RADIAL_DIMENSION (jogged radius) in {ver}, no *D block",
                 tags=["LARGE_RADIAL_DIMENSION", "nb"], questions=["Q-0522", "Q-0527", "Q-0517"], dxfversion=ver)
        finish(dim_jogged(c), "nb")
        c.window(*W)
    c = _new(s, "jogged-swapped-13-15-nb", "LARGE_RADIAL_DIMENSION with 13/15 swapped (13 = jog, 15 = chord, libredwg reading), no *D block",
             tags=["LARGE_RADIAL_DIMENSION", "nb"], questions=["Q-0526"])
    finish(dim_jogged(c, swap=True), "nb")
    c.window(*W)
    for ang in (30, 90):
        c = _new(s, f"jogged-dimjogang-{ang}-nb", f"LARGE_RADIAL_DIMENSION, DIMSTYLE DIMJOGANG (50) = {ang} (degrees), no *D block",
                 tags=["LARGE_RADIAL_DIMENSION", "DIMJOGANG"], questions=["Q-0527", "Q-0511"], style={"dimjogang": float(ang)},
                 params={"dimjogang": ang})
        finish(dim_jogged(c), "nb")
        c.window(*W)
    c = _new(s, "jogged-dimjogang-rad-nb", "LARGE_RADIAL_DIMENSION, DIMSTYLE DIMJOGANG (50) = 0.5236 (30° in radians?), no *D block",
             tags=["LARGE_RADIAL_DIMENSION", "DIMJOGANG"], questions=["Q-0511"], style={"dimjogang": 0.5235987756})
    finish(dim_jogged(c), "nb")
    c.window(*W)
    c = _new(s, "jogged-40-jogangle-nb", "LARGE_RADIAL_DIMENSION with entity group 40 = 0.5236 (libredwg: jog angle), no *D block",
             tags=["LARGE_RADIAL_DIMENSION"], questions=["Q-0527", "Q-0526"])
    finish(dim_jogged(c, jog_angle_attr=0.5235987756), "nb")
    c.window(*W)


# --- block presence, stale blocks, blocks-in-blocks, group 12, R12 ---------------------------
def _structure(s):
    c = _new(s, "struct-dangling-block-name", "Linear DIMENSION whose group 2 names a non-existing block *D99 (invalid on purpose)",
             tags=["DIMENSION", "geometry-block"], questions=["Q-0517"])
    dso = dim_horizontal(c)
    finish(dso, "nb")
    dso.dimension.dxf.geometry = "*D99"
    c.allow_audit_errors = True
    c.window(*W)

    c = _new(s, "struct-empty-block", "Linear DIMENSION whose *D block exists but is empty",
             tags=["DIMENSION", "geometry-block"], questions=["Q-0517"])
    dso = dim_horizontal(c)
    finish(dso, "nb")
    blk = c.doc.blocks.new_anonymous_block(type_char="D")
    dso.dimension.dxf.geometry = blk.name
    c.window(*W)

    c = _new(s, "struct-block-authority", "Linear DIMENSION whose ezdxf *D block also contains a CIRCLE r=20 (block wins over defpoints?)",
             tags=["DIMENSION", "geometry-block"], questions=["Q-0517"])
    dso = dim_horizontal(c)
    finish(dso, "ez")
    c.doc.blocks.get(dso.dimension.dxf.geometry).add_circle((100, 110), 20)
    c.window(*W)

    c = _new(s, "struct-stale-text", "Linear DIMENSION: *D block rendered with '<>', then group 1 changed to 'STALE'",
             tags=["DIMENSION", "geometry-block", "text-override"])
    dso = dim_horizontal(c)
    finish(dso, "ez")
    dso.dimension.dxf.text = "STALE"
    c.window(*W)

    # group 12 (clone insertion point)
    c = _new(s, "struct-group12-ez", "Linear DIMENSION (x 10..80) with *D block and group 12 = (100,0,0): is the block shifted?",
             tags=["DIMENSION", "group-12"], questions=["Q-0519"])
    _line(c, (10, 50), (80, 50))
    dso = c.msp.add_linear_dim(base=(45, 75), p1=(10, 50), p2=(80, 50), dimstyle="Standard")
    finish(dso, "ez")
    dso.dimension.dxf.insert = Vec3(100, 0, 0)
    c.window(*W)
    c = _new(s, "struct-group12-nested-ez", "Linear DIMENSION with group 12 = (100,0,0) inside a block nested 2 levels (INSERTs at 0,0)",
             tags=["DIMENSION", "group-12", "INSERT"], questions=["Q-0519"])
    inner = c.doc.blocks.new("DIMINNER")
    inner.add_line((10, 50), (80, 50))
    dso = inner.add_linear_dim(base=(45, 75), p1=(10, 50), p2=(80, 50), dimstyle="Standard")
    finish(dso, "ez")
    dso.dimension.dxf.insert = Vec3(100, 0, 0)
    outer = c.doc.blocks.new("DIMOUTER")
    outer.add_blockref("DIMINNER", (0, 0))
    c.msp.add_blockref("DIMOUTER", (0, 0))
    c.window(*W)

    # dimension inside a block definition
    for mode in ("ez", "nb"):
        c = _new(s, f"struct-in-block-{mode}", f"Linear DIMENSION inside BLOCK (base 50,50), INSERT at (100,0) scale 2 ({MODE_TITLE[mode]})",
                 tags=["DIMENSION", "INSERT", mode], questions=["Q-0520", "Q-0521"] + (["Q-0517"] if mode == "nb" else []))
        b = c.doc.blocks.new("DIMHOST", base_point=(50, 50))
        b.add_line((50, 60), (90, 60))
        dso = b.add_linear_dim(base=(70, 70), p1=(50, 60), p2=(90, 60), dimstyle="Standard")
        finish(dso, mode)
        c.msp.add_blockref("DIMHOST", (100, 0), dxfattribs={"xscale": 2, "yscale": 2})
        c.msp.add_point((100, 0))
        c.window(*W)
    c = _new(s, "struct-in-block-angular3p-nb", "3-point angular DIMENSION inside a BLOCK, INSERT at origin, no *D block (regenerated inside blocks?)",
             tags=["DIMENSION", "INSERT", "nb"], questions=["Q-0517"])
    b = c.doc.blocks.new("ANGHOST")
    center, p1, p2 = (60, 30), (170, 30), (60 + 110 * math.cos(math.radians(60)), 30 + 110 * math.sin(math.radians(60)))
    b.add_line(center, p1)
    b.add_line(center, p2)
    dso = b.add_angular_dim_3p(base=(60 + 85 * math.cos(math.radians(30)), 30 + 85 * math.sin(math.radians(30))),
                               center=center, p1=p1, p2=p2, dimstyle="Standard")
    finish(dso, "nb")
    c.msp.add_blockref("ANGHOST", (0, 0))
    c.window(*W)

    # R12
    for mode in ("ez", "nb"):
        c = _new(s, f"struct-r12-{mode}", f"Linear DIMENSION in an R12 DXF ({MODE_TITLE[mode]})",
                 tags=["DIMENSION", "R12", mode], questions=["Q-0517"] if mode == "nb" else [], dxfversion="R12")
        finish(dim_horizontal(c), mode)
        c.window(*W)


# --- DIMSTYLE table: header vs record, sparse records, missing refs ------------------------
SMALL_W = ((0, 0), (20, 15))  # 100 px/unit: imperial defaults (DIMTXT 0.18) stay visible


def _small_dim(c, dimstyle="Standard", override=None):
    _line(c, (4, 5), (16.345, 5))
    return c.msp.add_linear_dim(base=(10, 8), p1=(4, 5), p2=(16.345, 5), dimstyle=dimstyle, override=override)


SPARSE_HEADER = {"$DIMASZ": 5.0, "$DIMTAD": 1, "$DIMZIN": 8, "$DIMTXT": 1.0, "$DIMGAP": 0.5, "$DIMEXE": 1.0,
                 "$DIMEXO": 0.5, "$DIMDEC": 3, "$DIMDSEP": 44}


def _dimstyle_table(s):
    # header $DIM* differ from the DIMSTYLE (no <style overrides> in the record)
    for mode in ("ez", "nb"):
        c = _new(s, f"header-vs-dimstyle-{mode}", f"Linear DIMENSION, header $DIMSCALE=10 $DIMASZ=5 differ from DIMSTYLE Standard ({MODE_TITLE[mode]})",
                 tags=["DIMENSION", "DIMSTYLE", "header", mode], questions=["Q-0504"],
                 header={"$DIMSCALE": 10.0, "$DIMASZ": 5.0})
        finish(dim_horizontal(c), mode)
        c.window(*W)

    # sparse DIMSTYLE records (codes stripped by a byte filter: ezdxf always writes every code)
    for meas in (1, 0):
        c = s.case(f"sparse-dimstyle-measurement{meas}", f"DIMSTYLE SPARSE with only 2/70/340 (byte-filtered), header $DIMASZ=5 $DIMTAD=1 $DIMZIN=8 ..., $MEASUREMENT={meas}, no *D block",
                   tags=["DIMENSION", "DIMSTYLE", "sparse"], questions=["Q-0505", "Q-0506"],
                   params={"header": SPARSE_HEADER, "measurement": meas})
        setup_dimstyle(c)
        setup_dimstyle(c, "SPARSE", sync_header=False)
        for k, v in SPARSE_HEADER.items():
            c.doc.header[k] = v
        c.doc.header["$MEASUREMENT"] = meas
        c.doc.header["$DIMSTYLE"] = "SPARSE"
        finish(_small_dim(c, "SPARSE"), "nb")
        c.byte_filters.append(strip_table_record_codes("DIMSTYLE", "SPARSE", keep=[340]))
        c.notes.append("ezdxf writes every DIMSTYLE code; all codes except 2/70/340 of SPARSE are removed by a byte filter")
        c.window(*SMALL_W)
    c = s.case("sparse-dimstyle-standard", "DIMSTYLE Standard with only 2/70/340 (like AutoCAD's own Standard), header synced to BASE, no *D block",
               tags=["DIMENSION", "DIMSTYLE", "sparse"], questions=["Q-0505"])
    setup_dimstyle(c)
    finish(_small_dim(c), "nb")
    c.byte_filters.append(strip_table_record_codes("DIMSTYLE", "Standard", keep=[340]))
    c.notes.append("all Standard DIMSTYLE codes except 2/70/340 removed by a byte filter")
    c.window(*SMALL_W)
    # dims revealing sparse defaults ISO-25 never overrides
    for kind in ("angular", "fxlon", "jogged"):
        c = s.case(f"sparse-dimstyle-{kind}", f"Sparse DIMSTYLE (only 2/70/340), {kind} dimension revealing DIMADEC/DIMAZIN/DIMFXL/DIMJOGANG defaults, no *D block",
                   tags=["DIMENSION", "DIMSTYLE", "sparse"], questions=["Q-0506"])
        setup_dimstyle(c)
        setup_dimstyle(c, "SPARSE", sync_header=False)
        c.doc.header["$DIMSTYLE"] = "SPARSE"
        if kind == "angular":
            _line(c, (2, 2), (18, 2))
            _line(c, (2, 2), (2 + 16 * math.cos(math.radians(40.25)), 2 + 16 * math.sin(math.radians(40.25))))
            dso = c.msp.add_angular_dim_3p(base=(2 + 12 * math.cos(math.radians(20)), 2 + 12 * math.sin(math.radians(20))),
                                           center=(2, 2), p1=(18, 2),
                                           p2=(2 + 16 * math.cos(math.radians(40.25)), 2 + 16 * math.sin(math.radians(40.25))),
                                           dimstyle="SPARSE")
        elif kind == "fxlon":
            dso = _small_dim(c, "SPARSE", override={"dimfxlon": 1})
        else:
            c.msp.add_arc((10, -10), 20, 60, 120, dxfattribs={"layer": _geom(c)})
            e = c.msp.new_entity("LARGE_RADIAL_DIMENSION", {
                "dimtype": 9 | 32, "dimstyle": "SPARSE", "defpoint": Vec3(10, -10),
                "chord_point": Vec3(10 + 20 * math.cos(math.radians(75)), -10 + 20 * math.sin(math.radians(75))),
                "override_center": Vec3(12, 1.5), "jog_point": Vec3(12.8, 5.5), "text": "<>"})
            from ezdxf.entities import DimStyleOverride

            dso = DimStyleOverride(e)
        finish(dso, "nb")
        c.byte_filters.append(strip_table_record_codes("DIMSTYLE", "SPARSE", keep=[340]))
        c.window(*SMALL_W)

    # DIMTXSTY (340) absent vs present
    for with340 in (False, True):
        c = _new(s, f"dimtxsty-{'present' if with340 else 'absent'}-nb", f"Linear DIMENSION with DIMSTYLE {'with' if with340 else 'without'} 340 (DIMTXSTY), no *D block",
                 tags=["DIMENSION", "DIMSTYLE", "DIMTXSTY"], questions=["Q-0508"])
        setup_dimstyle(c, "NOTXSTY", text_style="Standard" if with340 else None, sync_header=False)
        finish(dim_horizontal(c, dimstyle="NOTXSTY"), "nb")
        c.window(*W)

    # undefined dimstyle name
    c = _new(s, "undefined-dimstyle-nb", "Linear DIMENSION with 3=NOSUCH (undefined DIMSTYLE), no *D block (invalid on purpose)",
             tags=["DIMENSION", "DIMSTYLE"], questions=["Q-0509"])
    dso = dim_horizontal(c)
    finish(dso, "nb")
    dso.dimension.dxf.dimstyle = "NOSUCH"
    c.allow_audit_errors = True
    c.window(*W)

    # R12: no DIMTXSTY code, text style from $DIMTXSTY?
    c = s.case("r12-dimtxsty-header-nb", "R12 DXF, styles STANDARD (Liberation Sans) and ALT (Lato), $DIMTXSTY=ALT, DIMENSION without *D block",
               tags=["DIMENSION", "R12", "DIMTXSTY"], questions=["Q-0507"], dxfversion="R12")
    setup_dimstyle(c)
    c.style("ALT", font=TTF_FONTS["lato"])
    c.doc.header["$DIMTXSTY"] = "ALT"
    finish(dim_horizontal(c), "nb")

    def add_dimtxsty(data: bytes) -> bytes:
        # ezdxf does not export $DIMTXSTY for R12: insert it after $DIMSTYLE
        marker = b"$DIMSTYLE\n  2\nStandard\n"
        assert marker in data
        return data.replace(marker, marker + b"  9\n$DIMTXSTY\n  7\nALT\n", 1)

    c.byte_filters.append(add_dimtxsty)
    c.notes.append("$DIMTXSTY=ALT inserted into the R12 header by a byte filter (ezdxf does not write it for R12)")
    c.window(*W)

    # DIMTFILL=2 / DIMTFILLCLR=1 in the DIMSTYLE record (second 70)
    c = _new(s, "dimstyle-tfill-second-70-nb", "DIMSTYLE record with 69=2 and second 70=1 (DIMTFILL/DIMTFILLCLR red), dim over a hatch, no *D block",
             tags=["DIMENSION", "DIMSTYLE", "DIMTFILL"], questions=["Q-0516", "Q-0578"], style={"dimtfill": 2, "dimtfillclr": 1},
             style_table="acad.ctb")
    _hatch_under_text(c)
    finish(dim_horizontal(c), "nb")
    c.window(*W)

    # DSTYLE xdata vs DIMSTYLE record precedence
    c = _new(s, "precedence-dstyle-dimse1-nb", "DIMSTYLE DIMSE1=0, DSTYLE XDATA DIMSE1=1, inline 75=0: which wins? (no *D block)",
             tags=["DIMENSION", "DSTYLE", "DIMSE1"], questions=["Q-0537"])
    dso = dim_horizontal(c, override={"dimse1": 1})
    finish(dso, "nb")
    dso.dimension.dxf.flip_arrow_2 = 0
    c.window(*W)
    c = _new(s, "precedence-record-dimse1-nb", "DIMSTYLE record DIMSE1=1, no DSTYLE XDATA (no *D block)",
             tags=["DIMENSION", "DIMSTYLE", "DIMSE1"], questions=["Q-0537"], style={"dimse1": 1})
    finish(dim_horizontal(c), "nb")
    c.window(*W)
    # DIMSTYLE 342 -> _ARCHTICK
    for mode in ("ez", "nb"):
        c = _new(s, f"record-dimblk-archtick-{mode}", f"DIMSTYLE record 342 = handle of _ArchTick, header $DIMBLK empty ({MODE_TITLE[mode]})",
                 tags=["DIMENSION", "DIMSTYLE", "DIMBLK", mode], questions=["Q-0538"], style={"dimblk": "ARCHTICK"})
        c.doc.header["$DIMBLK"] = ""
        finish(dim_horizontal(c), mode)
        c.window(*W)


def _hatch_under_text(c):
    c.layer("HATCH", color=3)
    h = c.msp.add_hatch(color=3, dxfattribs={"layer": "HATCH"})
    h.set_pattern_fill("ANSI31", scale=1.0)
    h.paths.add_polyline_path([(60, 70), (140, 70), (140, 100), (60, 100)], is_closed=True)


# --- text placement: DIMTAD, DIMJUST, DIMTVP, DIMTIH/TOH, rotation, oblique ----------------
def _layout(s):
    sizes = [
        ("dimscale", [0.5, 2.0, 0.0]), ("dimasz", [2.0, 8.0]), ("dimtxt", [2.5, 7.0]), ("dimexo", [0.0, 5.0]),
        ("dimexe", [0.0, 6.0]), ("dimgap", [0.0, 3.0, -1.0, -3.0]),
    ]
    for var, vals in sizes:
        for v in vals:
            tag = f"{v:g}".replace("-", "m").replace(".", "p")
            qs = ["Q-0562"] if var == "dimgap" and v < 0 else []
            c = _new(s, f"{var}-{tag}-nb", f"Linear DIMENSION, DSTYLE {var.upper()}={v:g} (no *D block)",
                     tags=["DIMENSION", var.upper()], questions=qs, params={var: v})
            finish(dim_horizontal(c, override={var: v}), "nb")
            c.window(*W)
    c = _new(s, "dimgap-m1-ez", "Linear DIMENSION, DSTYLE DIMGAP=-1 (text box) (ezdxf-rendered *D block)",
             tags=["DIMENSION", "DIMGAP", "ez"], params={"dimgap": -1})
    finish(dim_horizontal(c, override={"dimgap": -1.0}), "ez")
    c.window(*W)
    c = _new(s, "dimgap-box-colors-nb", "Linear DIMENSION DIMGAP=-1, DIMCLRT=1, DIMCLRD=3, DIMLWD=50: box colour/lineweight (no *D block)",
             tags=["DIMENSION", "DIMGAP", "DIMCLRT"], questions=["Q-0562"], style_table="acad.ctb")
    finish(dim_horizontal(c, override={"dimgap": -1.0, "dimclrt": 1, "dimclrd": 3, "dimlwd": 50}), "nb")
    c.window(*W)

    for tad in range(5):
        for kind in ("horizontal", "aligned"):
            c = _new(s, f"dimtad-{tad}-{kind}-nb", f"{kind.capitalize()} DIMENSION, DSTYLE DIMTAD={tad} (no *D block)",
                     tags=["DIMENSION", "DIMTAD"], questions=["Q-0561"] + (["Q-0558"] if tad == 3 else []) + (["Q-0559"] if tad == 2 else []),
                     params={"dimtad": tad, "kind": kind})
            fn = dim_horizontal if kind == "horizontal" else dim_aligned
            finish(fn(c, override={"dimtad": tad}), "nb")
            c.window(*W)
    c = _new(s, "dimtad-0-ez", "Linear DIMENSION DIMTAD=0 (centered text) (ezdxf-rendered *D block)",
             tags=["DIMENSION", "DIMTAD", "ez"], params={"dimtad": 0})
    finish(dim_horizontal(c, override={"dimtad": 0}), "ez")
    c.window(*W)
    c = _new(s, "dimtad-2-below-nb", "Linear DIMENSION DIMTAD=2 with the dim line BELOW the measured points (no *D block)",
             tags=["DIMENSION", "DIMTAD"], questions=["Q-0559"], params={"dimtad": 2})
    finish(dim_horizontal(c, override={"dimtad": 2}, p1=(40, 100), p2=(157.35, 100), base=(100, 60)), "nb")
    c.window(*W)
    for tvp in (0.5, 0.7, 1.0):
        c = _new(s, f"dimtvp-{tvp:g}".replace(".", "p") + "-nb", f"Linear DIMENSION DIMTAD=0, DIMTVP={tvp} (no *D block)",
                 tags=["DIMENSION", "DIMTVP"], questions=["Q-0560"], params={"dimtvp": tvp})
        finish(dim_horizontal(c, override={"dimtad": 0, "dimtvp": tvp}), "nb")
        c.window(*W)

    for just in range(5):
        for kind in ("horizontal", "aligned"):
            c = _new(s, f"dimjust-{just}-{kind}-nb", f"{kind.capitalize()} DIMENSION, DSTYLE DIMJUST={just} (no *D block)",
                     tags=["DIMENSION", "DIMJUST"], questions=["Q-0555"], params={"dimjust": just, "kind": kind})
            fn = dim_horizontal if kind == "horizontal" else dim_aligned
            finish(fn(c, override={"dimjust": just}), "nb")
            c.window(*W)
    for just in (1, 2):
        c = _new(s, f"dimjust-{just}-reversed-nb", f"Linear DIMENSION drawn right-to-left (13 right, 14 left), DIMJUST={just} (no *D block)",
                 tags=["DIMENSION", "DIMJUST"], questions=["Q-0556"], params={"dimjust": just})
        finish(dim_horizontal(c, override={"dimjust": just}, p1=HP2, p2=HP1), "nb")
        c.window(*W)

    for tih in (0, 1):
        c = _new(s, f"dimtih-{tih}-aligned-nb", f"Aligned 30° DIMENSION (text inside), DIMTIH={tih} (no *D block)",
                 tags=["DIMENSION", "DIMTIH"], params={"dimtih": tih})
        finish(dim_aligned(c, override={"dimtih": tih}), "nb")
        c.window(*W)
    for toh in (0, 1):
        c = _new(s, f"dimtoh-{toh}-aligned-short-nb", f"Short aligned 30° DIMENSION (text outside), DIMTOH={toh} (no *D block)",
                 tags=["DIMENSION", "DIMTOH"], params={"dimtoh": toh})
        p1 = (90, 70)
        p2 = (90 + 8 * math.cos(math.radians(30)), 70 + 8 * math.sin(math.radians(30)))
        finish(dim_aligned(c, override={"dimtoh": toh}, p1=p1, p2=p2, distance=10), "nb")
        c.window(*W)

    for rot in (0, 30, 90):
        c = _new(s, f"text-rotation-{rot}-nb", f"Linear DIMENSION with group 53 text rotation {rot}° (no *D block)",
                 tags=["DIMENSION", "text-rotation"], params={"text_rotation": rot})
        dso = dim_horizontal(c)
        dso.dimension.dxf.text_rotation = float(rot)
        finish(dso, "nb")
        c.window(*W)

    # 51 horizontal direction with DIMTIH/DIMTOH=1
    for kind in ("aligned", "radius", "ordinate-y"):
        for hd in (0, -30):
            c = _new(s, f"hdir-{kind}-{abs(hd)}-nb", f"{kind} DIMENSION DIMTIH=DIMTOH=1 with group 51 = {hd} (no *D block)",
                     tags=["DIMENSION", "horizontal-direction", "DIMTIH"], questions=["Q-0534"], params={"hdir": hd, "kind": kind})
            ov = {"dimtih": 1, "dimtoh": 1}
            if kind == "aligned":
                dso = dim_aligned(c, override=ov)
            elif kind == "radius":
                dso = dim_radius(c, override=ov)
            else:
                dso = dim_ordinate_y(c, override=ov)
            dso.dimension.dxf.horizontal_direction = float(hd)
            finish(dso, "nb")
            c.window(*W)

    # readability flip of aligned text around 90° / 270°
    for ang in list(range(85, 96)) + list(range(265, 276)):
        a = math.radians(ang)
        cx, cy, half = 100, 75, 55
        p1 = (cx - half * math.cos(a), cy - half * math.sin(a))
        p2 = (cx + half * math.cos(a), cy + half * math.sin(a))
        c = _new(s, f"flip-angle-{ang:03d}-nb", f"Aligned DIMENSION at {ang}°, DIMTIH=DIMTOH=0: readability flip (no *D block)",
                 tags=["DIMENSION", "text-rotation"], questions=["Q-0535"], params={"angle": ang})
        finish(dim_aligned(c, p1=p1, p2=p2, distance=15), "nb")
        c.window(*W)

    # oblique extension lines
    for obl in (None, 0.0, 30.0):
        name = "absent" if obl is None else f"{obl:g}"
        c = _new(s, f"oblique-{name}-nb", f"Linear DIMENSION with group 52 oblique angle {name} (no *D block)",
                 tags=["DIMENSION", "oblique"], questions=["Q-0536"], params={"oblique": obl})
        dso = dim_horizontal(c)
        if obl is not None:
            dso.dimension.dxf.oblique_angle = obl
        finish(dso, "nb")
        c.window(*W)
    c = _new(s, "aligned-angle50-inconsistent-nb", "Aligned DIMENSION (70=33) with group 50 = 30° inconsistent with 13->14 (26.6°) (no *D block)",
             tags=["DIMENSION", "aligned"], questions=["Q-0525"])
    dso = dim_aligned(c)
    dso.dimension.dxf.angle = 30.0
    finish(dso, "nb")
    c.window(*W)

    # user text position and DIMTMOVE
    for tmove, dy in ((0, 10), (1, 10), (2, 10), (1, 1), (1, 3)):
        c = _new(s, f"dimtmove-{tmove}-offset-{dy}-nb", f"Linear DIMENSION, text moved by user (70|=128) {dy} units above the dim line, DIMTMOVE={tmove} (no *D block)",
                 tags=["DIMENSION", "DIMTMOVE", "user-text-location"], questions=["Q-0554"], params={"dimtmove": tmove, "offset": dy})
        dso = dim_horizontal(c, override={"dimtmove": tmove})
        d = dso.dimension
        d.set_flag_state(d.USER_LOCATION_OVERRIDE, state=True, name="dimtype")
        d.dxf.text_midpoint = Vec3(130, HBASE[1] + 2.5 + dy)
        finish(dso, "nb")
        c.window(*W)

    # text vertical metric (ink box) with texts of different glyph extents
    for tag, txt in (("111", "111"), ("gjpq", "gjpq"), ("degree", "90%%d"), ("comma", "4,5")):
        c = _new(s, f"text-ink-{tag}-nb", f"Linear DIMENSION DIMTAD=1 with override text '{txt}': vertical offset vs glyph extents (no *D block)",
                 tags=["DIMENSION", "text-position", "text-override"], questions=["Q-0557"], params={"text": txt})
        finish(dim_horizontal(c, text=txt), "nb")
        c.window(*W)
    c = _new(s, "text-fixed-height-style-nb", "Linear DIMENSION, DIMTXSTY with fixed height 3.0, DIMSCALE 2, DIMTXT 2.5 (no *D block)",
             tags=["DIMENSION", "DIMTXSTY", "DIMSCALE"], questions=["Q-0563"])
    c.style("FIXH", font=TTF_FONTS["sans"], height=3.0)
    finish(dim_horizontal(c, override={"dimtxsty": "FIXH", "dimscale": 2.0, "dimtxt": 2.5}), "nb")
    c.window(*W)
    for tdir in (0, 1):
        c = _new(s, f"dimtxtdirection-{tdir}-nb", f"Linear DIMENSION text 'ABC', DSTYLE code 294 (DIMTXTDIRECTION?) = {tdir} (no *D block)",
                 tags=["DIMENSION", "DIMTXTDIRECTION"], questions=["Q-0564"], params={"dimtxtdirection": tdir})
        dso = dim_horizontal(c, text="ABC", override={"dimtad": 1})
        finish(dso, "nb")
        _append_dstyle(dso.dimension, [(1070, 294), (1070, tdir)])
        c.notes.append("DIMTXTDIRECTION is not in ezdxf's DIMSTYLE map; written as raw DSTYLE pair 1070 294")
        c.window(*W)


# --- fit behaviour --------------------------------------------------------------------------
FIT_LENGTHS = [3.0, 6.0, 10.0, 14.0, 18.0, 23.0, 30.0]


def _fit_sheet(c, override):
    for i, L in enumerate(FIT_LENGTHS):
        y = 12 + i * 20
        x0 = 100 - L / 2
        _line(c, (x0, y), (x0 + L, y))
        dso = c.msp.add_linear_dim(base=(x0, y + 6), p1=(x0, y), p2=(x0 + L, y), dimstyle="Standard", override=dict(override))
        finish(dso, "nb")


def _fit(s):
    for atfit in range(4):
        for tad in (0, 1):
            c = _new(s, f"fit-atfit{atfit}-tad{tad}-nb", f"Fit sheet: linear dims {FIT_LENGTHS} long, DIMATFIT={atfit}, DIMTAD={tad}, DIMTIX=0 (no *D block)",
                     tags=["DIMENSION", "DIMATFIT", "fit"], questions=["Q-0552", "Q-0553", "Q-0545"],
                     params={"dimatfit": atfit, "dimtad": tad, "lengths": FIT_LENGTHS})
            _fit_sheet(c, {"dimatfit": atfit, "dimtad": tad, "dimdec": 1, "dimzin": 0})
            c.window(*W)
    for soxd in (0, 1):
        c = _new(s, f"fit-tix1-soxd{soxd}-nb", f"Fit sheet: linear dims {FIT_LENGTHS} long, DIMTIX=1, DIMSOXD={soxd}, DIMTAD=1 (no *D block)",
                 tags=["DIMENSION", "DIMTIX", "DIMSOXD", "fit"], questions=["Q-0552"],
                 params={"dimtix": 1, "dimsoxd": soxd, "lengths": FIT_LENGTHS})
        _fit_sheet(c, {"dimtix": 1, "dimsoxd": soxd, "dimtad": 1, "dimdec": 1, "dimzin": 0})
        c.window(*W)
    for tmove in (1, 2):
        c = _new(s, f"fit-tmove{tmove}-nb", f"Fit sheet: linear dims {FIT_LENGTHS} long, DIMATFIT=3, DIMTMOVE={tmove} (no *D block)",
                 tags=["DIMENSION", "DIMTMOVE", "fit"], questions=["Q-0552", "Q-0553"],
                 params={"dimtmove": tmove, "lengths": FIT_LENGTHS})
        _fit_sheet(c, {"dimtmove": tmove, "dimdec": 1, "dimzin": 0})
        c.window(*W)
    for tofl in (0, 1):
        c = _new(s, f"short-dimtofl-{tofl}-nb", f"Short linear DIMENSION (2 units) with arrows outside, DIMTOFL={tofl}: dim-line stubs (no *D block)",
                 tags=["DIMENSION", "DIMTOFL", "fit"], questions=["Q-0545"], params={"dimtofl": tofl})
        finish(dim_horizontal(c, override={"dimtofl": tofl}, p1=(99, 50), p2=(101, 50), base=(100, 70)), "nb")
        c.window(*W)


# --- arrowheads ------------------------------------------------------------------------------
def _arrows(s):
    for tag, name in ARROW_NAMES:
        c = _new(s, f"arrow-{tag}-nb", f"Linear DIMENSION DIMBLK={name or 'closed filled'} DIMASZ=10 (no *D block; arrow blocks written by ezdxf)",
                 tags=["DIMENSION", "DIMBLK", "arrow"], questions=["Q-0543"] + (["Q-0540"] if tag == "dotsmall" else []),
                 params={"dimblk": name, "dimasz": 10})
        finish(dim_horizontal(c, override={"dimblk": name, "dimasz": 10.0}), "nb")
        c.window(*W)
    c = _new(s, "arrow-user-block-nb", "Linear DIMENSION DIMBLK=user block ARROWX (cross + tail), DIMASZ=5: dim-line shortening (no *D block)",
             tags=["DIMENSION", "DIMBLK", "arrow"], questions=["Q-0541"])
    finish(dim_horizontal(c, override={"dimblk": _user_arrow_block(c), "dimasz": 5.0}), "nb")
    c.window(*W)
    for tag, name in (("archtick", "ARCHTICK"), ("oblique", "OBLIQUE"), ("dot", "DOT"), ("dotsmall", "DOTSMALL"),
                      ("open", "OPEN"), ("closed", "CLOSED"), ("none", "NONE"), ("user", None)):
        c = _new(s, f"arrow-{tag}-ez", f"Linear DIMENSION DIMBLK={name or 'user block ARROWX'} DIMASZ=8 (ezdxf-rendered *D block)",
                 tags=["DIMENSION", "DIMBLK", "arrow", "ez"], params={"dimblk": name, "dimasz": 8})
        blk = name if name else _user_arrow_block(c)
        finish(dim_horizontal(c, override={"dimblk": blk, "dimasz": 8.0}), "ez")
        c.window(*W)
    for tag, name in (("archtick", "ARCHTICK"), ("oblique", "OBLIQUE"), ("none", "NONE"), ("small", "SMALL"),
                      ("integral", "INTEGRAL"), ("dotsmall", "DOTSMALL"), ("dot", "DOT")):
        c = _new(s, f"dimdle-2-{tag}-nb", f"Linear DIMENSION DIMDLE=2 with DIMBLK={name}, DIMASZ=5: dim-line extension (no *D block)",
                 tags=["DIMENSION", "DIMDLE", "arrow"], questions=["Q-0542", "Q-0543"], params={"dimblk": name, "dimdle": 2})
        finish(dim_horizontal(c, override={"dimblk": name, "dimasz": 5.0, "dimdle": 2.0}), "nb")
        c.window(*W)
    for dle in (0.0, 2.0):
        c = _new(s, f"dimtsz-2-dimdle-{dle:g}-nb", f"Linear DIMENSION DIMTSZ=2 (ticks), DIMDLE={dle:g}, DIMLWD=50 (no *D block)",
                 tags=["DIMENSION", "DIMTSZ", "DIMDLE"], questions=["Q-0546"], params={"dimtsz": 2, "dimdle": dle})
        finish(dim_horizontal(c, override={"dimtsz": 2.0, "dimdle": dle, "dimlwd": 50}), "nb")
        c.window(*W)
    c = _new(s, "dimsah-blk1-blk2-nb", "Linear DIMENSION DIMSAH=1, DIMBLK1=DOT, DIMBLK2=OPEN30, DIMASZ=8 (no *D block)",
             tags=["DIMENSION", "DIMSAH", "arrow"], questions=["Q-0543"])
    finish(dim_horizontal(c, override={"dimsah": 1, "dimblk1": "DOT", "dimblk2": "OPEN30", "dimasz": 8.0}), "nb")
    c.window(*W)
    # AutoCAD's own arrow definitions: arrows referenced by NAME only, no _X blocks in the file
    c = _new(s, "arrow-catalog-r12-names-nb", "R12: 9 linear dims, DSTYLE DIMBLK by name (5) for ezdxf-only arrows, no arrow blocks, no *D blocks (harvest AutoCAD's _X blocks)",
             tags=["DIMENSION", "DIMBLK", "arrow", "R12"], questions=["Q-0539", "Q-0540"], dxfversion="R12")
    names = ["CLOSED", "DATUMBLANK", "DOTBLANK", "ORIGIN", "ORIGIN2", "INTEGRAL", "SMALL", "DOTSMALL", "OPEN90"]
    for i, n in enumerate(names):
        y = 8 + i * 15.5
        dso = dim_horizontal(c, override={"dimblk": n, "dimasz": 5.0}, p1=(40, y), p2=(160, y), base=(100, y + 6), draw=False)
        finish(dso, "nb")
    c.params["arrows"] = names
    c.window(*W)
    c = _new(s, "arrow-catalog-r2018-names-nb", "R2018: 9 linear dims with raw DSTYLE pair 1070 5 / 1000 _<name> (DIMBLK by name), no arrow blocks, no *D blocks",
             tags=["DIMENSION", "DIMBLK", "arrow"], questions=["Q-0539", "Q-0540"])
    for i, n in enumerate(names):
        y = 8 + i * 15.5
        dso = dim_horizontal(c, override={"dimasz": 5.0}, p1=(40, y), p2=(160, y), base=(100, y + 6), draw=False)
        finish(dso, "nb")
        _append_dstyle(dso.dimension, [(1070, 5), (1000, "_" + n)])
    c.params["arrows"] = names
    c.window(*W)


# --- colours, lineweights, linetypes, suppression, flip arrows -------------------------------
def _appearance(s):
    for mode in ("nb", "ez"):
        c = _new(s, f"colors-{mode}", f"Linear DIMENSION DIMCLRD=1 DIMCLRE=3 DIMCLRT=5 ({MODE_TITLE[mode]})",
                 tags=["DIMENSION", "DIMCLRD", "color", mode], questions=["Q-0547"] if mode == "nb" else [], style_table="acad.ctb")
        finish(dim_horizontal(c, override={"dimclrd": 1, "dimclre": 3, "dimclrt": 5}), mode)
        c.window(*W)
        c = _new(s, f"lineweights-{mode}", f"Linear DIMENSION DIMLWD=0.50 DIMLWE=1.00 mm ({MODE_TITLE[mode]})",
                 tags=["DIMENSION", "DIMLWD", "lineweight", mode])
        finish(dim_horizontal(c, override={"dimlwd": 50, "dimlwe": 100}), mode)
        c.window(*W)
        c = _new(s, f"entity-color-byblock-{mode}", f"Linear DIMENSION with entity color 1 and lineweight 0.35 (BYBLOCK parts) ({MODE_TITLE[mode]})",
                 tags=["DIMENSION", "BYBLOCK", mode], style_table="acad.ctb")
        finish(dim_horizontal(c, dxfattribs={"color": 1, "lineweight": 35}), mode)
        c.window(*W)
    for mode, lts, dim48 in (("nb", 1.0, 0.5), ("nb", 1.0, 2.0), ("nb", 3.0, 1.0), ("ez", 1.0, 2.0)):
        c = _new(s, f"dimltype-dashed-lts{lts:g}-s{dim48:g}-{mode}".replace(".", "p"),
                 f"Linear DIMENSION DIMLTYPE=DIMLTEX1=DASHED, DIMENSION 48={dim48:g}, $LTSCALE={lts:g} ({MODE_TITLE[mode]})",
                 tags=["DIMENSION", "DIMLTYPE", "linetype", mode], questions=["Q-0322"],
                 params={"ltscale": lts, "ltscale48": dim48}, header={"$LTSCALE": lts})
        c.linetype("DASHED")
        finish(dim_horizontal(c, override={"dimltype": "DASHED", "dimltex1": "DASHED"}, dxfattribs={"ltscale": dim48}), mode)
        c.window(*W)
    for var in ("dimse1", "dimse2", "dimsd1", "dimsd2"):
        c = _new(s, f"{var}-nb", f"Linear DIMENSION DSTYLE {var.upper()}=1 (no *D block)", tags=["DIMENSION", var.upper()], params={var: 1})
        finish(dim_horizontal(c, override={var: 1}), "nb")
        c.window(*W)
    c = _new(s, "dimsd1-dimtad0-offcenter-nb", "Linear DIMENSION DIMSD1=1 with DIMTAD=0 and text moved toward ext line 2 (DIMJUST=2) (no *D block)",
             tags=["DIMENSION", "DIMSD1"], params={"dimsd1": 1, "dimtad": 0, "dimjust": 2})
    finish(dim_horizontal(c, override={"dimsd1": 1, "dimtad": 0, "dimjust": 2}), "nb")
    c.window(*W)
    for f1, f2 in ((1, 0), (0, 1), (1, 1)):
        c = _new(s, f"flip-arrows-{f1}{f2}-nb", f"Linear DIMENSION with flip-arrow flags 74={f1} 75={f2} (no *D block)",
                 tags=["DIMENSION", "flip-arrow"], questions=["Q-0544"], params={"flip1": f1, "flip2": f2})
        dso = dim_horizontal(c)
        dso.dimension.dxf.flip_arrow_1 = f1
        dso.dimension.dxf.flip_arrow_2 = f2
        finish(dso, "nb")
        c.window(*W)
    c = _new(s, "flip-arrows-radius-nb", "Radius DIMENSION with flip-arrow flag 74=1 (no *D block)",
             tags=["DIMENSION", "flip-arrow", "radius"], questions=["Q-0544"])
    dso = dim_radius(c)
    dso.dimension.dxf.flip_arrow_1 = 1
    finish(dso, "nb")
    c.window(*W)
    for fill in (1, 2):
        c = _new(s, f"dimtfill-{fill}-nb", f"Linear DIMENSION DSTYLE DIMTFILL={fill}" + (" DIMTFILLCLR=1" if fill == 2 else " (background colour)") + " over a hatch (no *D block)",
                 tags=["DIMENSION", "DIMTFILL"], questions=["Q-0578"], style_table="acad.ctb", params={"dimtfill": fill})
        _hatch_under_text(c)
        finish(dim_horizontal(c, override={"dimtfill": fill, "dimtfillclr": 1}), "nb")
        c.window(*W)
    c = _new(s, "dimtfill-2-ez", "Linear DIMENSION DIMTFILL=2 DIMTFILLCLR=1 over a hatch (ezdxf-rendered *D block)",
             tags=["DIMENSION", "DIMTFILL", "ez"], style_table="acad.ctb")
    _hatch_under_text(c)
    finish(dim_horizontal(c, override={"dimtfill": 2, "dimtfillclr": 1}), "ez")
    c.window(*W)


# --- radius / diameter -----------------------------------------------------------------------
def _radial(s):
    for kind, fn in (("radius", dim_radius), ("diameter", dim_diameter)):
        for tofl in (0, 1):
            c = _new(s, f"{kind}-dimtofl-{tofl}-nb", f"{kind.capitalize()} DIMENSION text outside, DIMTOFL={tofl} (no *D block)",
                     tags=["DIMENSION", kind, "DIMTOFL"], params={"dimtofl": tofl})
            finish(fn(c, override={"dimtofl": tofl}), "nb")
            c.window(*W)
        c = _new(s, f"{kind}-dimtix-1-nb", f"{kind.capitalize()} DIMENSION DIMTIX=1 (text inside) (no *D block)",
                 tags=["DIMENSION", kind, "DIMTIX"], params={"dimtix": 1})
        finish(fn(c, override={"dimtix": 1}), "nb")
        c.window(*W)
        c = _new(s, f"{kind}-dimtoh-1-nb", f"{kind.capitalize()} DIMENSION DIMTOH=1 (horizontal text outside) (no *D block)",
                 tags=["DIMENSION", kind, "DIMTOH"], params={"dimtoh": 1})
        finish(fn(c, override={"dimtoh": 1}), "nb")
        c.window(*W)
    for kind, fn in (("radius", dim_radius), ("diameter", dim_diameter)):
        for place, loc in (("inside", (110, 85)), ("outside", (165, 125))):
            for tmove in (0, 1, 2):
                c = _new(s, f"{kind}-moved-{place}-tmove{tmove}-nb", f"{kind.capitalize()} DIMENSION, user text position {place} the circle (70|=128), DIMTMOVE={tmove} (no *D block)",
                         tags=["DIMENSION", kind, "DIMTMOVE", "user-text-location"], questions=["Q-0551"],
                         params={"place": place, "location": loc, "dimtmove": tmove})
                dso = fn(c, override={"dimtmove": tmove})
                d = dso.dimension
                d.set_flag_state(d.USER_LOCATION_OVERRIDE, state=True, name="dimtype")
                d.dxf.text_midpoint = Vec3(loc)
                finish(dso, "nb")
                c.window(*W)
    for cen in (4.0, -4.0, 0.0):
        tag = f"{cen:g}".replace("-", "m")
        c = _new(s, f"diameter-dimcen-{tag}-colors-nb", f"Diameter DIMENSION DIMCEN={cen:g}, DIMCLRD=1, DIMCLRE=3, DIMTOFL=0 (no *D block)",
                 tags=["DIMENSION", "diameter", "DIMCEN"], questions=["Q-0548"], style_table="acad.ctb", params={"dimcen": cen})
        finish(dim_diameter(c, override={"dimcen": cen, "dimclrd": 1, "dimclre": 3, "dimtofl": 0}), "nb")
        c.window(*W)
    c = _new(s, "radius-dimcen-dimscale-nb", "Radius DIMENSION DIMCEN=1, DIMSCALE=3, DIMTOFL=0, text outside (is DIMCEN scaled?) (no *D block)",
             tags=["DIMENSION", "radius", "DIMCEN", "DIMSCALE"], questions=["Q-0549"])
    finish(dim_radius(c, override={"dimcen": 1.0, "dimscale": 3.0, "dimtofl": 0, "dimtxt": 2.0, "dimasz": 2.0}), "nb")
    c.window(*W)
    c = _new(s, "radius-dimcen-m4-ez", "Radius DIMENSION DIMCEN=-4 (center lines), DIMTOFL=0 (ezdxf-rendered *D block)",
             tags=["DIMENSION", "radius", "DIMCEN", "ez"])
    finish(dim_radius(c, override={"dimcen": -4.0, "dimtofl": 0}), "ez")
    c.window(*W)
    # radial arc extension XDATA
    for on in (0, 1):
        c = _new(s, f"radius-arc-extension-{on}-nb", f"Radius DIMENSION on an ARC (0..60°) pointing at 100° beyond the arc end, XDATA ACAD_DSTYLE_DIMRADIAL_EXTENSION 387={on} (no *D block)",
                 tags=["DIMENSION", "radius", "xdata"], questions=["Q-0550"], params={"extension": on})
        c.doc.appids.new("ACAD_DSTYLE_DIMRADIAL_EXTENSION")
        c.msp.add_arc(CIRC_C, CIRC_R, 0, 60, dxfattribs={"layer": _geom(c)})
        dso = dim_radius(c, angle=100.0, circle=False)
        finish(dso, "nb")
        dso.dimension.set_xdata("ACAD_DSTYLE_DIMRADIAL_EXTENSION",
                                [(1070, 387), (1070, on), (1070, 388), (1040, math.radians(60) if on else 0.0),
                                 (1070, 390), (1040, math.radians(100) if on else 0.0)])
        c.window(*W)


# --- angular / arc length --------------------------------------------------------------------
def _curved(s):
    # arc point in each of the 4 sectors of two crossing lines
    l1 = ((30, 40), (170, 110))
    l2 = ((30, 110), (170, 40))
    for i, base in enumerate([(160, 75), (100, 130), (40, 75), (100, 20)], 1):
        c = _new(s, f"angular2l-sector-{i}-nb", f"2-line angular DIMENSION of two crossing lines, arc point 16 in sector {i} (no *D block)",
                 tags=["DIMENSION", "angular"], questions=["Q-0528"], params={"arc_point": base})
        finish(dim_angular2l(c, base=base, l1=l1, l2=l2), "nb")
        c.window(*W)
    for var in ("dimse1", "dimse2"):
        c = _new(s, f"angular2l-{var}-nb", f"2-line angular DIMENSION with {var.upper()}=1: which ext line is 1? (no *D block)",
                 tags=["DIMENSION", "angular", var.upper()], questions=["Q-0529"])
        finish(dim_angular2l(c, override={var: 1}, base=(50 + 60 * math.cos(math.radians(22.5)), 30 + 60 * math.sin(math.radians(22.5))),
                             l1=((80, 30), (190, 30)), l2=((80, 60), (140, 120))), "nb")
        c.window(*W)
    for tag, r in (("inside", 60.0), ("outside", 135.0)):
        c = _new(s, f"angular2l-arc-{tag}-nb", f"2-line angular DIMENSION, arc radius {r:g} {'within' if tag == 'inside' else 'beyond'} the line segments (ext lines?) (no *D block)",
                 tags=["DIMENSION", "angular"], questions=["Q-0530"], params={"radius": r})
        a = math.radians(22.5)
        finish(dim_angular2l(c, base=(50 + r * math.cos(a), 30 + r * math.sin(a)),
                             l1=((50, 30), (170, 30)), l2=((50, 30), (50 + 95 * math.cos(math.radians(45)), 30 + 95 * math.sin(math.radians(45))))), "nb")
        c.window(*W)
    for angbase, angdir in ((90.0, 0), (0.0, 1)):
        c = _new(s, f"angular3p-angbase{angbase:g}-angdir{angdir}-nb", f"3-point angular DIMENSION 30°, $ANGBASE={angbase:g} $ANGDIR={angdir} (no *D block)",
                 tags=["DIMENSION", "angular", "ANGBASE"], questions=["Q-0533"], header={"$ANGBASE": angbase, "$ANGDIR": angdir})
        finish(dim_angular3p(c, angle=30.0, radius=100.0, leg=130.0), "nb")
        c.window(*W)
    # arc length: DIMARCSYM, text size, partial, leader
    for sym in (0, 1, 2):
        for txt in (4.0, 8.0):
            c = _new(s, f"arc-dimarcsym-{sym}-txt{txt:g}-nb", f"ARC_DIMENSION DIMARCSYM={sym}, DIMTXT={txt:g} (no *D block)",
                     tags=["ARC_DIMENSION", "DIMARCSYM"], questions=["Q-0532"], params={"dimarcsym": sym, "dimtxt": txt})
            finish(dim_arc(c, override={"dimarcsym": sym, "dimtxt": txt}), "nb")
            c.window(*W)
    c = _new(s, "arc-dimarcsym-0-wide-text-nb", "ARC_DIMENSION DIMARCSYM=0 with DIMDEC=6 (wide text): symbol position vs text width (no *D block)",
             tags=["ARC_DIMENSION", "DIMARCSYM"], questions=["Q-0532"])
    finish(dim_arc(c, override={"dimarcsym": 0, "dimdec": 6, "dimzin": 0}), "nb")
    c.window(*W)
    for partial, leader in ((True, False), (False, True), (True, True)):
        tag = ("partial" if partial else "") + ("-leader" if leader else "")
        c = _new(s, f"arc-{tag.strip('-')}-nb", f"ARC_DIMENSION partial={int(partial)} (70) has_leader={int(leader)} (71, 16/17) (no *D block)",
                 tags=["ARC_DIMENSION"], questions=["Q-0531"], params={"partial": partial, "leader": leader})
        finish(dim_arc(c, partial=partial, leader=leader), "nb")
        c.window(*W)


# --- number formats (rows = values, via DIMLFAC = value/60) ---------------------------------
VALUES = [0.5, 12.0, 12.0625, 48.36, 1234.5]


def _formats(s):
    def sheet(name, title, override, values=VALUES, qs=(), text="<>"):
        c = _new(s, name, f"Format sheet {values}: {title} (DIMLFAC=value/60, no *D blocks)",
                 tags=["DIMENSION", "format"], questions=list(qs), params={"values": values, "override": override})
        format_sheet(c, values, override, text=text)
        c.window(*W)

    for lunit in range(1, 7):
        sheet(f"fmt-lunit-{lunit}", f"DIMLUNIT={lunit} DIMDEC=4 DIMZIN=0", {"dimlunit": lunit, "dimdec": 4, "dimzin": 0}, qs=["Q-0575"])
    for lunit in (4, 5):
        for frac in (1, 2):
            sheet(f"fmt-lunit-{lunit}-frac-{frac}", f"DIMLUNIT={lunit} DIMFRAC={frac} DIMDEC=4",
                  {"dimlunit": lunit, "dimfrac": frac, "dimdec": 4, "dimzin": 0}, qs=["Q-0575"])
    for dec in (0, 1, 3, 6, 8):
        sheet(f"fmt-dec-{dec}", f"DIMLUNIT=2 DIMDEC={dec} DIMZIN=0", {"dimlunit": 2, "dimdec": dec, "dimzin": 0}, qs=["Q-0575"])
    for dec in (0, 2, 6, 8):
        sheet(f"fmt-arch-dec-{dec}", f"DIMLUNIT=4 DIMDEC={dec} DIMZIN=0", {"dimlunit": 4, "dimdec": dec, "dimzin": 0}, qs=["Q-0575"])
    for zin in (0, 4, 8, 12):
        sheet(f"fmt-zin-{zin}", f"DIMLUNIT=2 DIMDEC=4 DIMZIN={zin}", {"dimlunit": 2, "dimdec": 4, "dimzin": zin},
              values=[0.5, 12.0, 12.5, 0.25, 100.0], qs=["Q-0574", "Q-0575"])
    for zin in (0, 1, 2, 3):
        sheet(f"fmt-arch-zin-{zin}", f"DIMLUNIT=4 DIMDEC=4 DIMZIN={zin} (feet/inch zero suppression)",
              {"dimlunit": 4, "dimdec": 4, "dimzin": zin}, values=[0.5, 12.0, 36.0, 48.36, 120.0], qs=["Q-0575"])
    for sep in (0, 44, 46):
        sheet(f"fmt-dsep-{sep}", f"DIMDSEP={sep} DIMDEC=2", {"dimdsep": sep, "dimdec": 2}, values=[12.5, 0.75, 1234.5], qs=["Q-0515"])
    sheet("fmt-rnd-0p25", "DIMRND=0.25 DIMDEC=2 DIMZIN=0", {"dimrnd": 0.25, "dimdec": 2, "dimzin": 0},
          values=[12.1, 12.13, 12.4, 12.62, 12.88], qs=["Q-0577"])
    # DIMLFAC itself
    for lfac in (2.0, 0.5, -2.0):
        tag = f"{lfac:g}".replace("-", "m").replace(".", "p")
        c = _new(s, f"fmt-lfac-{tag}-nb", f"Linear DIMENSION 117.35 long, DIMLFAC={lfac:g} in model space (42 unscaled?) (no *D block)",
                 tags=["DIMENSION", "DIMLFAC"], questions=["Q-0524"] + (["Q-0577"] if lfac < 0 else []), params={"dimlfac": lfac})
        finish(dim_horizontal(c, override={"dimlfac": lfac}), "nb")
        c.window(*W)
    c = _new(s, "fmt-lfac-m2-paperspace-nb", "Linear DIMENSION in paper space (Layout1), DIMLFAC=-2 (no *D block)",
             tags=["DIMENSION", "DIMLFAC", "paperspace"], questions=["Q-0577"])
    psp = c.doc.paperspace("Layout1")
    psp.add_line(HP1, HP2, dxfattribs={"layer": _geom(c)})
    finish(psp.add_linear_dim(base=HBASE, p1=HP1, p2=HP2, dimstyle="Standard", override={"dimlfac": -2.0}), "nb")
    c.layout_window("Layout1", *W)
    # DIMPOST
    for tag, post in (("mm", "mm"), ("l-mm", "L=<>mm"), ("x-y", "X<>Y")):
        c = _new(s, f"fmt-dimpost-{tag}-nb", f"Linear DIMENSION DIMPOST='{post}' (no *D block)",
                 tags=["DIMENSION", "DIMPOST"], questions=["Q-0569"], params={"dimpost": post})
        finish(dim_horizontal(c, override={"dimpost": post}), "nb")
        c.window(*W)
    c = _new(s, "fmt-dimpost-tol-nb", "Linear DIMENSION DIMPOST='<>mm', DIMTOL=1 DIMTP=0.1 DIMTM=0.2 (suffix on tolerances?) (no *D block)",
             tags=["DIMENSION", "DIMPOST", "DIMTOL"], questions=["Q-0570"])
    finish(dim_horizontal(c, override={"dimpost": "<>mm", "dimtol": 1, "dimtp": 0.1, "dimtm": 0.2}), "nb")
    c.window(*W)
    # text overrides
    for tag, txt in (("empty", ""), ("brackets", "<>"), ("space", " "), ("suffix", "<>mm"), ("literal", "ABC"),
                     ("double", "<> mm <>"), ("split", "A\\XB")):
        c = _new(s, f"text-override-{tag}-nb", f"Linear DIMENSION with text override (1) = {txt!r} (no *D block)",
                 tags=["DIMENSION", "text-override"], questions=["Q-0565"] + (["Q-0566"] if tag == "double" else []), params={"text": txt})
        finish(dim_horizontal(c, text=txt), "nb")
        c.window(*W)
    c = _new(s, "text-override-literal-post-tol-nb", "Linear DIMENSION text 'ABC' with DIMPOST 'X<>Y' and DIMTOL=1: explicit text drops prefix/suffix/tolerance? (no *D block)",
             tags=["DIMENSION", "text-override", "DIMPOST"], questions=["Q-0565"])
    finish(dim_horizontal(c, text="ABC", override={"dimpost": "X<>Y", "dimtol": 1, "dimtp": 0.1, "dimtm": 0.1}), "nb")
    c.window(*W)
    c = _new(s, "text-override-measurement-m1-nb", "Linear DIMENSION with 42 = -1 (actual measurement) and text '<>' (no *D block)",
             tags=["DIMENSION", "text-override"], questions=["Q-0565"])
    dso = dim_horizontal(c)
    dso.dimension.dxf.actual_measurement = -1.0
    finish(dso, "nb")
    c.window(*W)
    for kind, fn in (("radius", dim_radius), ("diameter", dim_diameter)):
        for tag, txt in (("literal", "ABC"), ("brackets", "<>")):
            c = _new(s, f"{kind}-text-{tag}-nb", f"{kind.capitalize()} DIMENSION text override {txt!r}: automatic R/Ø prefix? (no *D block)",
                     tags=["DIMENSION", kind, "text-override"], questions=["Q-0567"], params={"text": txt})
            finish(fn(c, text=txt), "nb")
            c.window(*W)
        for tag, post in (("x", "X<>"), ("plain", "<>")):
            c = _new(s, f"{kind}-dimpost-{tag}-nb", f"{kind.capitalize()} DIMENSION DIMPOST={post!r}: replaces the R/Ø prefix? (no *D block)",
                     tags=["DIMENSION", kind, "DIMPOST"], questions=["Q-0568"], params={"dimpost": post})
            finish(fn(c, override={"dimpost": post}), "nb")
            c.window(*W)
    # alternate units
    alt = {"dimalt": 1, "dimaltf": 25.4, "dimaltd": 2}
    for tag, extra, txt in (("plain", {}, "<>"), ("apost", {"dimapost": "[]mm"}, "<>"), ("apost-space", {"dimapost": "[] mm"}, "<>"),
                            ("text-alt", {}, "[]"), ("text-both", {}, "<> ([])")):
        c = _new(s, f"dimalt-{tag}-nb", f"Linear DIMENSION DIMALT=1 DIMALTF=25.4 {extra or ''} text {txt!r} (no *D block)",
                 tags=["DIMENSION", "DIMALT"], questions=["Q-0571", "Q-0572"], params={**extra, "text": txt})
        finish(dim_horizontal(c, text=txt, override={**alt, **extra}), "nb")
        c.window(*W)
    # tolerances and limits
    tols = [
        ("equal", {"dimtol": 1, "dimtp": 0.1, "dimtm": 0.1}),
        ("unequal-j0", {"dimtol": 1, "dimtp": 0.1, "dimtm": 0.2, "dimtolj": 0}),
        ("unequal-j1", {"dimtol": 1, "dimtp": 0.1, "dimtm": 0.2, "dimtolj": 1}),
        ("unequal-j2", {"dimtol": 1, "dimtp": 0.1, "dimtm": 0.2, "dimtolj": 2}),
        ("tfac-0p5", {"dimtol": 1, "dimtp": 0.1, "dimtm": 0.2, "dimtfac": 0.5}),
        ("limits", {"dimlim": 1, "dimtp": 0.1, "dimtm": 0.2}),
        ("limits-tfac-0p5", {"dimlim": 1, "dimtp": 0.1, "dimtm": 0.2, "dimtfac": 0.5}),
    ]
    for tag, ov in tols:
        c = _new(s, f"tol-{tag}-nb", f"Linear DIMENSION tolerance/limits {ov} (no *D block)",
                 tags=["DIMENSION", "DIMTOL" if "dimtol" in ov else "DIMLIM"], questions=["Q-0573"], params=ov)
        finish(dim_horizontal(c, override=ov), "nb")
        c.window(*W)
    c = _new(s, "tol-unequal-ez", "Linear DIMENSION DIMTOL=1 DIMTP=0.1 DIMTM=0.2 (ezdxf-rendered *D block)",
             tags=["DIMENSION", "DIMTOL", "ez"])
    finish(dim_horizontal(c, override={"dimtol": 1, "dimtp": 0.1, "dimtm": 0.2}), "ez")
    c.window(*W)
    c = _new(s, "fmt-lunit-4-ez", "Linear DIMENSION DIMLUNIT=4 (architectural, stacked fraction) (ezdxf-rendered *D block)",
             tags=["DIMENSION", "DIMLUNIT", "ez"])
    finish(dim_horizontal(c, override={"dimlunit": 4, "dimdec": 4, "dimzin": 0}), "ez")
    c.window(*W)
    # angular formats: 45.5042° = 45°30'15"
    angs = [(0, 0), (0, 2), (0, 4), (1, 0), (1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (2, 2), (3, 3)]
    for aunit, adec in angs:
        c = _new(s, f"fmt-aunit-{aunit}-adec-{adec}-nb", f"3-point angular DIMENSION 45.5042°, DIMAUNIT={aunit} DIMADEC={adec} (no *D block)",
                 tags=["DIMENSION", "angular", "DIMAUNIT"], questions=["Q-0576"], params={"dimaunit": aunit, "dimadec": adec})
        finish(dim_angular3p(c, override={"dimaunit": aunit, "dimadec": adec}, angle=45.5042, radius=100.0, leg=130.0), "nb")
        c.window(*W)
    c = _new(s, "fmt-adec-m1-dec3-nb", "3-point angular DIMENSION 45.5042°, DIMADEC=-1 with DIMDEC=3 (no *D block)",
             tags=["DIMENSION", "angular", "DIMADEC"], questions=["Q-0576"])
    finish(dim_angular3p(c, override={"dimadec": -1, "dimdec": 3}, angle=45.5042, radius=100.0, leg=130.0), "nb")
    c.window(*W)
    for azin in (0, 1, 2, 3):
        c = _new(s, f"fmt-azin-{azin}-nb", f"3-point angular DIMENSION 45.5°, DIMADEC=4 DIMAZIN={azin} (no *D block)",
                 tags=["DIMENSION", "angular", "DIMAZIN"], questions=["Q-0576"], params={"dimazin": azin})
        finish(dim_angular3p(c, override={"dimadec": 4, "dimazin": azin}, angle=45.5, radius=100.0, leg=130.0), "nb")
        c.window(*W)


# --- seeded random linear/aligned dims with random DSTYLE overrides ----------------------------
def _random(s):
    for seed in range(1, 7):
        c = _new(s, f"random-{seed:04d}", f"Random linear/aligned DIMENSION with random DSTYLE overrides, seed {seed} (no *D block)",
                 tags=["DIMENSION", "random"], seed=seed)
        rng = c.rng
        p1 = (rng.uniform(30, 80), rng.uniform(30, 70))
        L = rng.uniform(30, 110)
        ang = rng.choice([0.0, 0.0, 15.0, 30.0, 60.0, 90.0])
        a = math.radians(ang)
        p2 = (p1[0] + L * math.cos(a), p1[1] + L * math.sin(a))
        ov = {
            "dimtad": rng.choice([0, 1, 1, 4]),
            "dimasz": rng.choice([2.0, 4.0, 6.0]),
            "dimtxt": rng.choice([3.0, 4.0, 5.0]),
            "dimgap": rng.choice([0.5, 1.0, 2.0]),
            "dimdec": rng.randint(0, 4),
            "dimjust": rng.choice([0, 0, 1, 2]),
            "dimblk": rng.choice(["", "", "ARCHTICK", "OPEN", "DOT"]),
        }
        c.params.update({"p1": p1, "length": L, "angle": ang, "override": ov})
        if rng.random() < 0.5:
            dso = dim_aligned(c, override=ov, p1=p1, p2=p2, distance=rng.choice([-15.0, 12.0, 20.0]))
        else:
            _line(c, p1, p2)
            base = (p1[0] - 15 * math.sin(a), p1[1] + 15 * math.cos(a))
            dso = c.msp.add_linear_dim(base=base, p1=p1, p2=p2, angle=ang, dimstyle="Standard", override=ov)
        finish(dso, "nb")
        c.window(*W)
