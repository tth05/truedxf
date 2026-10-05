"""The playground's sample drawing: a small single-storey house, ground floor plan.

Writes apps/playground/public/samples/truedxf-house.dxf and the logo it references
(truedxf-logo.png, next to it). Everything here is our own work (MIT): no Autodesk fonts,
blocks or patterns from an install; text uses arial.ttf, which the public site maps to
Liberation Sans.

It shows off what the viewer draws: layers with colours / lineweights / linetypes, walls as a
hatched union outline, door / window / furniture blocks (scaled, rotated, mirrored), attributes,
room labels (MTEXT with areas), dimension chains, a column grid with bubbles, MULTILEADER notes,
pattern, solid and gradient hatches, bulge polylines, ellipses, splines, an image, and a
paper-space A3 sheet with a title block and two viewports (1:50 plan, 1:25 kitchen detail).

    tools/gen/.venv/Scripts/python tools/gen/showcase.py [--out DIR]

Deterministic (run with PYTHONHASHSEED=0 like the fixture generator, see run.py).
"""

from __future__ import annotations

import argparse
import math
import os
import subprocess
import sys
from pathlib import Path

import ezdxf
from ezdxf import colors
from ezdxf.enums import MTextEntityAlignment, TextEntityAlignment
from ezdxf.math import Vec2
from ezdxf.render import mleader

# fixed $TDCREATE / $TDUPDATE, null GUIDs and marker string: the committed file only changes with
# its content
ezdxf.options.write_fixed_meta_data_for_testing = True

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "playground" / "public" / "samples"
NAME = "truedxf-house.dxf"
LOGO = "truedxf-logo.png"

T_EXT = 365.0  # exterior wall
T_INT = 115.0  # partition
T_BEAR = 240.0  # load-bearing interior wall
SCALE = 50  # plan scale 1:50

Rect = tuple[float, float, float, float]  # x0, y0, x1, y1


# ---- geometry helpers ---------------------------------------------------------------------------


def hwall(x0: float, x1: float, y: float, t: float, gaps: list[tuple[float, float]] = ()) -> list[Rect]:
    """A horizontal wall from x0 to x1 with its lower face at y, split at door/window gaps."""
    out, x = [], x0
    for a, b in sorted(gaps):
        if a > x:
            out.append((x, y, a, y + t))
        x = b
    if x < x1:
        out.append((x, y, x1, y + t))
    return out


def vwall(y0: float, y1: float, x: float, t: float, gaps: list[tuple[float, float]] = ()) -> list[Rect]:
    out, y = [], y0
    for a, b in sorted(gaps):
        if a > y:
            out.append((x, y, x + t, a))
        y = b
    if y < y1:
        out.append((x, y, x + t, y1))
    return out


def union_outline(rects: list[Rect]) -> list[list[tuple[float, float]]]:
    """Closed loops of the union of axis-parallel rectangles (rectilinear, no touching corners)."""
    xs = sorted({v for r in rects for v in (r[0], r[2])})
    ys = sorted({v for r in rects for v in (r[1], r[3])})

    def inside(x: float, y: float) -> bool:
        return any(r[0] < x < r[2] and r[1] < y < r[3] for r in rects)

    edges: dict[tuple[float, float], list[tuple[float, float]]] = {}

    def add(a: tuple[float, float], b: tuple[float, float]) -> None:
        edges.setdefault(a, []).append(b)

    e = 1e-3
    # boundary pieces between consecutive grid coordinates, oriented with the inside on the left
    for i in range(len(xs) - 1):
        xm = (xs[i] + xs[i + 1]) / 2
        for y in ys:
            below, above = inside(xm, y - e), inside(xm, y + e)
            if below != above:
                if above:
                    add((xs[i], y), (xs[i + 1], y))
                else:
                    add((xs[i + 1], y), (xs[i], y))
    for j in range(len(ys) - 1):
        ym = (ys[j] + ys[j + 1]) / 2
        for x in xs:
            left, right = inside(x - e, ym), inside(x + e, ym)
            if left != right:
                if left:
                    add((x, ys[j]), (x, ys[j + 1]))
                else:
                    add((x, ys[j + 1]), (x, ys[j]))
    loops = []
    while edges:
        start = min(edges)
        loop, p = [start], start
        while True:
            nxt = edges[p].pop(0)
            if not edges[p]:
                del edges[p]
            if nxt == start:
                break
            loop.append(nxt)
            p = nxt
        # drop collinear vertices
        clean = []
        for k, v in enumerate(loop):
            a, b = loop[k - 1], loop[(k + 1) % len(loop)]
            if not ((a[0] == v[0] == b[0]) or (a[1] == v[1] == b[1])):
                clean.append(v)
        loops.append(clean)
    return loops


def rect_pts(x0: float, y0: float, x1: float, y1: float) -> list[tuple[float, float]]:
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def rounded(x0: float, y0: float, x1: float, y1: float, r: float) -> list[tuple[float, float, float]]:
    """LWPOLYLINE points (x, y, bulge) of a rectangle with round corners."""
    b = math.tan(math.pi / 8)  # quarter circle
    return [
        (x0 + r, y0, 0),
        (x1 - r, y0, b),
        (x1, y0 + r, 0),
        (x1, y1 - r, b),
        (x1 - r, y1, 0),
        (x0 + r, y1, b),
        (x0, y1 - r, 0),
        (x0, y0 + r, b),
    ]


# ---- document set-up ------------------------------------------------------------------------------

LAYERS = [
    # name, ACI, lineweight (1/100 mm), linetype, description
    ("A-WALL", 7, 50, "Continuous", "Walls"),
    ("A-WALL-PATT", 8, 9, "Continuous", "Wall hatch"),
    ("A-DOOR", 3, 25, "Continuous", "Doors"),
    ("A-GLAZ", 4, 25, "Continuous", "Windows"),
    ("A-FURN", 151, 18, "Continuous", "Furniture"),
    ("A-FLOR-PATT", 8, 9, "Continuous", "Floor finishes (60 % transparent)"),
    ("A-AREA-IDEN", 7, 25, "Continuous", "Room labels"),
    ("A-ANNO-DIMS", 1, 18, "Continuous", "Dimensions"),
    ("A-ANNO-NOTE", 30, 18, "Continuous", "Notes"),
    ("A-GRID", 254, 13, "CENTER", "Structural grid"),
    ("A-GRID-IDEN", 254, 25, "Continuous", "Grid bubbles"),
    ("L-PLNT", 94, 18, "Continuous", "Planting"),
    ("L-SITE", 62, 13, "Continuous", "Terrace, paths, lawn"),
    ("G-ANNO-TTLB", 7, 35, "Continuous", "Sheet border and title block"),
    ("G-ANNO-TEXT", 7, 25, "Continuous", "Sheet text"),
    ("G-VPORT", 9, 13, "Continuous", "Viewports (no plot)"),
]


def setup(doc: ezdxf.document.Drawing) -> None:
    doc.header["$INSUNITS"] = 4  # mm
    doc.header["$MEASUREMENT"] = 1
    doc.header["$LUNITS"] = 2
    doc.header["$LTSCALE"] = 1.0
    doc.header["$PSLTSCALE"] = 0
    doc.header["$LWDISPLAY"] = 1
    doc.header["$TEXTSTYLE"] = "ARIAL"
    doc.styles.add("ARIAL", font="arial.ttf")
    doc.styles.add("ARIAL-BOLD", font="arialbd.ttf")
    for name, color, lw, lt, desc in LAYERS:
        layer = doc.layers.add(name, color=color, lineweight=lw, linetype=lt)
        layer.description = desc
    doc.layers.get("G-VPORT").dxf.plot = 0
    doc.layers.get("A-FLOR-PATT").transparency = 0.6
    ds = doc.dimstyles.new("PLAN-50")
    ds.dxf.dimscale = SCALE
    ds.dxf.dimtxt = 2.2
    ds.dxf.dimasz = 1.6
    ds.dxf.dimblk = "ARCHTICK"
    ds.dxf.dimexo = 1.5
    ds.dxf.dimexe = 1.25
    ds.dxf.dimgap = 0.8
    ds.dxf.dimdec = 0
    ds.dxf.dimtad = 1
    ds.dxf.dimtih = 0
    ds.dxf.dimtoh = 0
    ds.dxf.dimtxsty = "ARIAL"
    ds.dxf.dimclrd = 1
    ds.dxf.dimclre = 1
    ds.dxf.dimclrt = 7
    ds.dxf.dimlwd = 18
    ds.dxf.dimlwe = 13
    ml = doc.mleader_styles.get("Standard")
    ml.dxf.char_height = 2.5
    ml.dxf.arrow_head_size = 2.0
    ml.dxf.scale = SCALE


# ---- blocks ------------------------------------------------------------------------------------------


def blocks(doc: ezdxf.document.Drawing) -> None:
    # door: 1000 mm leaf hinged at the origin, opening to +y; scale x = width
    b = doc.blocks.new("DOOR")
    b.add_lwpolyline([(0, 0), (40, 0), (40, 1000), (0, 1000)], close=True)
    b.add_arc((0, 0), 1000, 0, 90, dxfattribs={"lineweight": 13})
    b.add_line((0, 0), (1000, 0), dxfattribs={"lineweight": 13, "linetype": "DASHED", "ltscale": 5})

    # window: 1000 mm long, 1 unit deep (scaled to the wall thickness): frame, two panes, sill
    b = doc.blocks.new("WINDOW")
    b.add_lwpolyline(rect_pts(0, 0, 1000, 1), close=True)
    b.add_line((0, 0.42), (1000, 0.42))
    b.add_line((0, 0.58), (1000, 0.58))
    b.add_line((-30, -0.12), (1030, -0.12), dxfattribs={"lineweight": 13})

    b = doc.blocks.new("BED-DOUBLE")  # 1800 x 2000, head at y = 2000
    b.add_lwpolyline(rounded(0, 0, 1800, 2000, 60), close=True)
    b.add_lwpolyline(rounded(120, 1600, 840, 1920, 80), close=True)
    b.add_lwpolyline(rounded(960, 1600, 1680, 1920, 80), close=True)
    b.add_spline([(0, 1350), (500, 1250), (1300, 1450), (1800, 1350)])
    b = doc.blocks.new("BED-SINGLE")  # 900 x 2000
    b.add_lwpolyline(rounded(0, 0, 900, 2000, 50), close=True)
    b.add_lwpolyline(rounded(120, 1620, 780, 1920, 80), close=True)
    b.add_spline([(0, 1380), (300, 1300), (650, 1460), (900, 1380)])
    b = doc.blocks.new("NIGHTSTAND")
    b.add_lwpolyline(rect_pts(0, 0, 450, 400), close=True)
    b.add_circle((225, 200), 110)
    b.add_circle((225, 200), 30)

    b = doc.blocks.new("SOFA")  # 2600 x 900, seat facing +y
    b.add_lwpolyline(rounded(0, 0, 2600, 900, 120), close=True)
    b.add_lwpolyline(rounded(160, 0, 2440, 220, 60), close=True)
    for i in range(3):
        x0 = 180 + i * 750
        b.add_lwpolyline(rounded(x0, 240, x0 + 730, 860, 60), close=True)
    b = doc.blocks.new("ARMCHAIR")  # 850 x 850
    b.add_lwpolyline(rounded(0, 0, 850, 850, 120), close=True)
    b.add_lwpolyline(rounded(150, 170, 700, 800, 60), close=True)
    b = doc.blocks.new("CHAIR")  # 450 x 450, back at y = 0
    b.add_lwpolyline(rounded(0, 50, 450, 450, 60), close=True)
    b.add_lwpolyline(rounded(20, 0, 430, 90, 40), close=True)
    b = doc.blocks.new("STOOL")
    b.add_circle((0, 0), 190)
    b.add_circle((0, 0), 140)

    b = doc.blocks.new("WC")  # 380 x 700, tank at y = 0
    b.add_lwpolyline(rounded(0, 0, 380, 180, 30), close=True)
    b.add_ellipse((190, 450), major_axis=(0, 250), ratio=0.68)
    b.add_ellipse((190, 470), major_axis=(0, 180), ratio=0.6)
    b = doc.blocks.new("BASIN")  # 600 x 450, wall at y = 0
    b.add_lwpolyline(rounded(0, 0, 600, 450, 40), close=True)
    b.add_ellipse((300, 240), major_axis=(220, 0), ratio=0.7)
    b.add_circle((300, 240), 22)
    b = doc.blocks.new("BATHTUB")  # 750 x 1700
    b.add_lwpolyline(rounded(0, 0, 750, 1700, 40), close=True)
    b.add_lwpolyline(rounded(80, 80, 670, 1620, 260), close=True)
    b.add_circle((375, 1450), 30)
    b = doc.blocks.new("SHOWER")  # 900 x 900 with a door arc
    b.add_lwpolyline(rect_pts(0, 0, 900, 900), close=True)
    b.add_line((0, 0), (900, 900), dxfattribs={"lineweight": 9})
    b.add_line((900, 0), (0, 900), dxfattribs={"lineweight": 9})
    b.add_circle((450, 450), 45)

    b = doc.blocks.new("HOB")  # 600 x 520, four burners
    b.add_lwpolyline(rect_pts(0, 0, 600, 520), close=True)
    for cx, cy, r in ((150, 140, 95), (450, 140, 70), (150, 380, 70), (450, 380, 95)):
        b.add_circle((cx, cy), r)
        b.add_circle((cx, cy), r * 0.45)
    b = doc.blocks.new("SINK")  # 800 x 500, double bowl
    b.add_lwpolyline(rounded(0, 0, 800, 500, 30), close=True)
    b.add_lwpolyline(rounded(40, 60, 470, 440, 50), close=True)
    b.add_lwpolyline(rounded(510, 60, 760, 440, 40), close=True)
    b.add_circle((255, 250), 25)
    b.add_circle((635, 250), 20)
    b = doc.blocks.new("FRIDGE")  # 600 x 600
    b.add_lwpolyline(rect_pts(0, 0, 600, 600), close=True)
    b.add_line((0, 80), (600, 80))
    b.add_text("FR", height=120, dxfattribs={"style": "ARIAL"}).set_placement(
        (300, 340), align=TextEntityAlignment.MIDDLE_CENTER
    )

    b = doc.blocks.new("PLANT")  # pot plant: circle with leaves
    b.add_circle((0, 0), 220)
    for k in range(7):
        a = k * 2 * math.pi / 7
        b.add_ellipse((math.cos(a) * 120, math.sin(a) * 120), major_axis=(math.cos(a) * 110, math.sin(a) * 110), ratio=0.4)

    b = doc.blocks.new("TREE")  # cloud outline of bulge arcs around a trunk
    pts = []
    n = 11
    for k in range(n):
        a = k * 2 * math.pi / n
        r = 1000 * (0.9 + 0.1 * math.sin(3 * a))
        pts.append((math.cos(a) * r, math.sin(a) * r, -0.6))
    b.add_lwpolyline(pts, format="xyb", close=True)
    b.add_circle((0, 0), 120)
    for k in range(5):
        a = k * 2 * math.pi / 5 + 0.3
        b.add_line((math.cos(a) * 160, math.sin(a) * 160), (math.cos(a) * 520, math.sin(a) * 520), dxfattribs={"lineweight": 9})

    # grid bubble with the axis name as an attribute
    b = doc.blocks.new("GRID-BUBBLE")
    b.add_circle((0, 0), 350)
    b.add_attdef("AXIS", (0, 0), dxfattribs={"height": 300, "style": "ARIAL"}).set_placement(
        (0, 0), align=TextEntityAlignment.MIDDLE_CENTER
    )

    b = doc.blocks.new("NORTH")
    b.add_circle((0, 0), 700)
    b.add_solid([(0, 650), (-300, -450), (0, -200)])
    b.add_lwpolyline([(0, 650), (300, -450), (0, -200)], close=True)
    b.add_text("N", height=350, dxfattribs={"style": "ARIAL-BOLD"}).set_placement(
        (0, 1050), align=TextEntityAlignment.MIDDLE_CENTER
    )

    # title block field: label + attribute value (paper mm)
    b = doc.blocks.new("TITLE")
    rows = [
        ("PROJECT", "Project", "truedxf sample house"),
        ("TITLE", "Drawing", "Ground floor plan"),
        ("CLIENT", "Client", "Open-source demo"),
        ("SCALE", "Scale", "1:50 (A3)"),
        ("DRAWN", "Drawn", "truedxf"),
        ("DATE", "Date", "2026-10"),
        ("NUMBER", "Drawing no.", "A-101"),
    ]
    for i, (tag, label, default) in enumerate(rows):
        y = -i * 9.0
        b.add_line((0, y - 9), (80, y - 9))
        b.add_text(label.upper(), height=1.6, dxfattribs={"style": "ARIAL"}).set_placement((2, y - 3))
        b.add_attdef(tag, (2, y - 7.4), dxfattribs={"height": 2.6, "style": "ARIAL"}).dxf.text = default


# ---- the plan ------------------------------------------------------------------------------------------

# rooms: name, x0, y0, x1, y1 (inner faces), floor pattern
# patterns: AR-PARQ1 at 3 = 914 mm parquet squares of 150 mm strips; NET at 94.5 = 300 mm tiles
ROOMS = [
    ("LIVING / DINING", T_EXT, 3840, 7000, 9000 - T_EXT, ("AR-PARQ1", 3, 0)),
    ("KITCHEN", 7240, 5800, 12000 - T_EXT, 9000 - T_EXT, ("NET", 94.5, 0)),
    ("HALL", 7240, 3840, 12000 - T_EXT, 5680, ("NET", 94.5, 45)),
    ("BEDROOM", T_EXT, T_EXT, 4600, 3600, ("AR-PARQ1", 3, 90)),
    ("BATH", 4715, T_EXT, 7000, 3600, ("NET", 63, 0)),
    ("STUDY", 7115, T_EXT, 12000 - T_EXT, 3600, ("AR-PARQ1", 3, 0)),
]


def walls() -> tuple[list[Rect], list[tuple[str, tuple[float, float], float, float, float]]]:
    """Wall rectangles and the openings: (kind, insert, rotation, width, depth/mirror)."""
    W, H = 12000.0, 9000.0
    r: list[Rect] = []
    # exterior: windows and the entrance leave gaps
    r += hwall(0, W, 0, T_EXT, [(1200, 3200), (5300, 6200), (8300, 10300)])
    r += hwall(0, W, H - T_EXT, T_EXT, [(1200, 3200), (4200, 6200), (8500, 10500)])
    r += vwall(T_EXT, H - T_EXT, 0, T_EXT, [(5000, 7600)])
    r += vwall(T_EXT, H - T_EXT, W - T_EXT, T_EXT, [(1200, 2600), (4300, 5300), (6600, 8000)])
    # load-bearing wall between the south rooms and the rest, with three doors
    r += hwall(T_EXT, W - T_EXT, 3600, T_BEAR, [(3500, 4400), (5200, 6000), (8000, 8900)])
    # partitions
    r += vwall(T_EXT, 3600, 4600, T_INT)
    r += vwall(T_EXT, 3600, 7000, T_INT)
    r += vwall(3840, H - T_EXT, 7000, T_BEAR, [(4100, 5000)])
    r += hwall(7240, W - T_EXT, 5680, 120, [(8500, 9900)])
    openings = [
        # doors: insert = hinge, rotation, width, mirror (-1 = swing the other way)
        ("door", (4400, 3600), 180, 900, 1),
        ("door", (6000, 3600), 180, 800, 1),
        ("door", (8000, 3600), 180, 900, -1),
        ("door", (7000, 4100), 90, 900, -1),
        ("door", (W, 4300), 90, 1000, 1),
        # windows: insert = start on the outer face, rotation, length, wall thickness
        ("window", (1200, 0), 0, 2000, T_EXT),
        ("window", (5300, 0), 0, 900, T_EXT),
        ("window", (8300, 0), 0, 2000, T_EXT),
        ("window", (3200, H), 180, 2000, T_EXT),
        ("window", (6200, H), 180, 2000, T_EXT),
        ("window", (10500, H), 180, 2000, T_EXT),
        ("window", (0, 7600), 270, 2600, T_EXT),
        ("window", (W, 1200), 90, 1400, T_EXT),
        ("window", (W, 6600), 90, 1400, T_EXT),
    ]
    return r, openings


def plan(doc: ezdxf.document.Drawing) -> None:
    msp = doc.modelspace()
    rects, openings = walls()

    # site: lawn (radial gradient) around the house and terrace, terrace decking, entrance path
    lawn = msp.add_hatch(dxfattribs={"layer": "L-SITE"})
    lawn.set_gradient(color1=(58, 112, 62), color2=(138, 186, 104), rotation=0, centered=1, name="SPHERICAL")
    lawn.paths.add_polyline_path(rect_pts(-3200, -2600, 15400, 13000), is_closed=True, flags=1)
    # hole: the house and the terrace
    footprint = [(-150, -150), (12150, -150), (12150, 9150), (7000, 9150), (7000, 11000), (T_EXT, 11000), (T_EXT, 9150), (-150, 9150)]
    lawn.paths.add_polyline_path(footprint, is_closed=True, flags=16)
    lawn.paths.add_polyline_path(rect_pts(12150, 4200, 15400, 5400), is_closed=True, flags=16)
    msp.add_lwpolyline(rect_pts(-3200, -2600, 15400, 13000), close=True, dxfattribs={"layer": "L-SITE"})
    deck = rect_pts(T_EXT, 9000, 7000, 11000)
    msp.add_lwpolyline(deck, close=True, dxfattribs={"layer": "L-SITE", "lineweight": 25})
    h = msp.add_hatch(color=colors.BYLAYER, dxfattribs={"layer": "L-SITE"})
    h.set_pattern_fill("LINE", scale=50, angle=0, color=colors.BYLAYER)
    h.paths.add_polyline_path(deck, is_closed=True)
    path = rect_pts(12000, 4300, 15400, 5300)
    msp.add_lwpolyline(path, close=True, dxfattribs={"layer": "L-SITE"})
    h = msp.add_hatch(color=colors.BYLAYER, dxfattribs={"layer": "L-SITE"})
    h.set_pattern_fill("BRICK", scale=15, angle=90, color=colors.BYLAYER)
    h.paths.add_polyline_path(path, is_closed=True)

    # floor finishes per room (under everything else)
    for name, x0, y0, x1, y1, (pat, scale, angle) in ROOMS:
        h = msp.add_hatch(color=colors.BYLAYER, dxfattribs={"layer": "A-FLOR-PATT"})
        h.set_pattern_fill(pat, scale=scale, angle=angle, color=colors.BYLAYER)
        h.paths.add_polyline_path(rect_pts(x0, y0, x1, y1), is_closed=True)

    # walls: hatch over the union, outline on top
    loops = union_outline(rects)
    wall_hatch = msp.add_hatch(color=colors.BYLAYER, dxfattribs={"layer": "A-WALL-PATT"})
    wall_hatch.set_pattern_fill("ANSI31", scale=30, angle=0, color=colors.BYLAYER)
    wall_hatch.dxf.hatch_style = 0
    for loop in loops:
        wall_hatch.paths.add_polyline_path(loop, is_closed=True)
        msp.add_lwpolyline(loop, close=True, dxfattribs={"layer": "A-WALL"})

    for kind, (x, y), rot, width, extra in openings:
        if kind == "door":
            msp.add_blockref(
                "DOOR",
                (x, y),
                dxfattribs={"layer": "A-DOOR", "xscale": width / 1000 * extra, "yscale": width / 1000, "rotation": rot},
            )
        else:
            msp.add_blockref(
                "WINDOW", (x, y), dxfattribs={"layer": "A-GLAZ", "xscale": width / 1000, "yscale": extra, "rotation": rot}
            )
    # the sliding terrace door has two panes: draw its track over the window block
    msp.add_line((T_EXT / 2, 5000), (T_EXT / 2, 7600), dxfattribs={"layer": "A-GLAZ", "lineweight": 35})

    furn = {"layer": "A-FURN"}

    def put(name: str, x: float, y: float, rot: float = 0, sx: float = 1, sy: float = 1) -> None:
        msp.add_blockref(name, (x, y), dxfattribs={**furn, "rotation": rot, "xscale": sx, "yscale": sy})

    # bedroom
    put("BED-DOUBLE", 1100, 1580)
    put("NIGHTSTAND", 600, 3150)
    put("NIGHTSTAND", 2950, 3150)
    msp.add_lwpolyline(rect_pts(3900, 400, 4560, 2600), close=True, dxfattribs=furn)  # wardrobe
    for yy in range(600, 2600, 400):
        msp.add_line((3900, yy), (4560, yy), dxfattribs={**furn, "lineweight": 9})
    put("PLANT", 3600, 700)
    # bath
    put("BATHTUB", 6200, 420)
    put("WC", 4760, 2700, rot=-90)
    put("BASIN", 4760, 1700, rot=-90)
    put("SHOWER", 6050, 2650)
    # study
    put("BED-SINGLE", 10650, 1550)
    msp.add_lwpolyline(rect_pts(8450, 420, 10150, 1170), close=True, dxfattribs=furn)  # desk
    put("CHAIR", 9075, 1700, rot=180)
    msp.add_lwpolyline(rect_pts(7180, 1800, 7580, 3500), close=True, dxfattribs=furn)  # shelf
    # living / dining
    put("SOFA", 900, 4050)
    put("ARMCHAIR", 3700, 4500, rot=90)
    msp.add_lwpolyline(rounded(1600, 5250, 2900, 5900, 60), close=True, dxfattribs=furn)  # coffee table
    rug = rect_pts(950, 5100, 3600, 6400)
    msp.add_lwpolyline(rug, close=True, dxfattribs={**furn, "linetype": "DASHED", "ltscale": 20})
    msp.add_lwpolyline(rect_pts(900, 8235, 3500, 8635), close=True, dxfattribs=furn)  # sideboard
    cx, cy = 5100, 6900
    msp.add_circle((cx, cy), 650, dxfattribs=furn)  # round dining table
    for k in range(6):
        a = k * 60 + 30
        r = 900
        put("CHAIR", cx + math.cos(math.radians(a)) * r, cy + math.sin(math.radians(a)) * r, rot=a + 90, sx=1, sy=1)
    put("PLANT", 6600, 8250)
    put("PLANT", 600, 7900)
    # kitchen
    counter = [(7600, 8635), (7600, 8035), (11035, 8035), (11035, 5800), (11635, 5800), (11635, 8635)]
    msp.add_lwpolyline(counter, close=True, dxfattribs=furn)
    put("HOB", 8100, 8075)
    put("SINK", 9300, 8090)
    put("FRIDGE", 11035, 6000)
    msp.add_lwpolyline(rounded(8300, 6500, 10300, 7400, 80), close=True, dxfattribs=furn)  # island
    for x in (8700, 9300, 9900):
        put("STOOL", x, 6250)
    # hall
    msp.add_lwpolyline(rect_pts(10200, 3840, 11635, 4240), close=True, dxfattribs=furn)  # shoe cabinet
    mat = rect_pts(10900, 4400, 11600, 5200)
    msp.add_lwpolyline(mat, close=True, dxfattribs=furn)
    h = msp.add_hatch(color=colors.BYLAYER, dxfattribs={"layer": "A-FURN"})
    h.set_pattern_fill("DOTS", scale=40, color=colors.BYLAYER)
    h.paths.add_polyline_path(mat, is_closed=True)

    # room labels: name and area (TrueType MTEXT, white background mask)
    for name, x0, y0, x1, y1, _ in ROOMS:
        area = (x1 - x0) * (y1 - y0) / 1e6
        cxr, cyr = (x0 + x1) / 2, (y0 + y1) / 2
        if name == "LIVING / DINING":
            cxr, cyr = 2300, 7300
        if name == "KITCHEN":
            cxr, cyr = 10350, 6250
        if name == "BATH":
            cxr, cyr = 5450, 1350
        if name == "STUDY":
            cxr, cyr = 9200, 2500
        if name == "BEDROOM":
            cxr, cyr = 2000, 950
        m = msp.add_mtext(
            f"{{\\fArial|b1|i0|c0|p34;{name}}}\\P{{\\H0.8x;{area:.2f} m\\U+00B2}}",
            dxfattribs={"layer": "A-AREA-IDEN", "char_height": 150, "style": "ARIAL"},
        )
        m.set_location((cxr, cyr), attachment_point=MTextEntityAlignment.MIDDLE_CENTER)
        # background mask in the drawing's background colour (AutoCAD wants code 63 with it)
        m.set_bg_color("canvas", scale=1.3, text_frame=False)
        m.dxf.bg_fill_color = 7

    # structural grid: centre lines with bubbles (attributes)
    grid_x = [("1", T_EXT / 2), ("2", 4657.5), ("3", 7120), ("4", 12000 - T_EXT / 2)]
    grid_y = [("A", T_EXT / 2), ("B", 3720), ("C", 9000 - T_EXT / 2)]
    g = {"layer": "A-GRID", "ltscale": 25}
    for label, x in grid_x:
        msp.add_line((x, -1550), (x, 9500), dxfattribs=g)
        ins = msp.add_blockref("GRID-BUBBLE", (x, -1900), dxfattribs={"layer": "A-GRID-IDEN"})
        ins.add_auto_attribs({"AXIS": label})
    for label, y in grid_y:
        msp.add_line((-1550, y), (12500, y), dxfattribs=g)
        ins = msp.add_blockref("GRID-BUBBLE", (-1900, y), dxfattribs={"layer": "A-GRID-IDEN"})
        ins.add_auto_attribs({"AXIS": label})

    # dimension chains: openings along the south wall, overall sizes, west wall
    dims = {"layer": "A-ANNO-DIMS"}

    def chain(points: list[float], fixed: float, base: float, horizontal: bool) -> None:
        for a, b in zip(points, points[1:]):
            if horizontal:
                d = msp.add_linear_dim(base=(a, base), p1=(a, fixed), p2=(b, fixed), dimstyle="PLAN-50", dxfattribs=dims)
            else:
                d = msp.add_linear_dim(
                    base=(base, a), p1=(fixed, a), p2=(fixed, b), angle=90, dimstyle="PLAN-50", dxfattribs=dims
                )
            d.render()

    chain([0, 1200, 3200, 4600, 4715, 5300, 6200, 7000, 7115, 8300, 10300, 12000], 0, -700, True)
    chain([0, 12000], 0, -1250, True)
    chain([0, 3600, 3840, 5000, 7600, 9000], 0, -700, False)
    chain([0, 9000], 0, -1250, False)

    # notes with leaders
    def note(text: str, at: tuple[float, float], to: list[tuple[float, float]], side: mleader.ConnectionSide) -> None:
        mb = msp.add_multileader_mtext("Standard", dxfattribs={"layer": "A-ANNO-NOTE"})
        mb.set_content(text, char_height=2.5, alignment=mleader.TextAlignment.left, style="ARIAL")
        for t in to:
            mb.add_leader_line(side, [Vec2(t)])
        mb.build(insert=Vec2(at))

    note("Sliding door to the\\Pterrace, triple glazing", (-2500, 10500), [(200, 7000)], mleader.ConnectionSide.right)
    note("Kitchen island\\Pwith seating", (7700, 10500), [(9300, 7000)], mleader.ConnectionSide.right)
    note("Underfloor heating\\Pin all rooms", (10000, 10500), [(11000, 7500), (11300, 5200)], mleader.ConnectionSide.right)

    # planting and orientation
    for x, y, s in ((-2000, 12000, 1.0), (13900, 11300, 1.3), (14200, -1100, 0.9), (9500, 12300, 0.7), (-2400, 2000, 0.6)):
        msp.add_blockref("TREE", (x, y), dxfattribs={"layer": "L-PLNT", "xscale": s, "yscale": s, "rotation": x % 37})
    msp.add_blockref("NORTH", (14300, 9300), dxfattribs={"layer": "A-ANNO-NOTE", "rotation": -12})
    t = msp.add_text("TERRACE", height=220, dxfattribs={"layer": "A-AREA-IDEN", "style": "ARIAL-BOLD"})
    t.set_placement((3700, 10000), align=TextEntityAlignment.MIDDLE_CENTER)
    t = msp.add_text("ENTRANCE", height=180, dxfattribs={"layer": "A-AREA-IDEN", "style": "ARIAL"})
    t.set_placement((13700, 5700), align=TextEntityAlignment.MIDDLE_CENTER)
    t = msp.add_text("%%c1300 dining table", height=100, dxfattribs={"layer": "A-ANNO-NOTE", "style": "ARIAL"})
    t.set_placement((5100, 5800), align=TextEntityAlignment.MIDDLE_CENTER)


# ---- the A3 sheet ---------------------------------------------------------------------------------------


def sheet(doc: ezdxf.document.Drawing) -> None:
    # remove the default layouts, add one A3 sheet
    for name in [l.name for l in doc.layouts if l.name != "Model"]:
        if len(doc.layouts) > 2:
            doc.layouts.delete(name)
    psp = doc.layouts.get("Layout1")
    doc.layouts.rename("Layout1", "A3-Plan")
    psp.page_setup(size=(420, 297), margins=(0, 0, 0, 0), units="mm", device="DWG To PDF.pc3", name="ISO_full_bleed_A3_(420.00_x_297.00_MM)")
    tb = {"layer": "G-ANNO-TTLB"}
    psp.add_lwpolyline(rect_pts(0, 0, 420, 297), close=True, dxfattribs={**tb, "lineweight": 13})
    psp.add_lwpolyline(rect_pts(20, 10, 410, 287), close=True, dxfattribs={**tb, "lineweight": 50})
    psp.add_line((328, 10), (328, 287), dxfattribs=tb)

    vp = {"layer": "G-VPORT"}
    main = psp.add_viewport(center=(174, 148.5), size=(304, 273), view_center_point=(4950, 4500), view_height=273 * SCALE, dxfattribs=vp)
    main.dxf.status = 2
    # kitchen detail at 1:25
    detail = psp.add_viewport(center=(369, 250.5), size=(80, 71), view_center_point=(9200, 7600), view_height=71 * 25, dxfattribs=vp)
    detail.dxf.status = 3
    # the detail shows the fittings only: room labels, notes, dimensions and the grid frozen in it
    detail.frozen_layers = ["A-AREA-IDEN", "A-ANNO-NOTE", "A-ANNO-DIMS", "A-GRID", "A-GRID-IDEN"]
    psp.add_line((328, 214), (410, 214), dxfattribs=tb)
    t = psp.add_text("DETAIL  KITCHEN  1:25", height=2.2, dxfattribs={"layer": "G-ANNO-TEXT", "style": "ARIAL-BOLD"})
    t.set_placement((331, 209.5))

    # room schedule
    y = 203.0
    t = psp.add_text("ROOM SCHEDULE", height=2.2, dxfattribs={"layer": "G-ANNO-TEXT", "style": "ARIAL-BOLD"})
    t.set_placement((331, y))
    total = 0.0
    for name, x0, y0, x1, y1, _ in ROOMS:
        y -= 5.2
        area = (x1 - x0) * (y1 - y0) / 1e6
        total += area
        psp.add_text(name.title(), height=2.0, dxfattribs={"layer": "G-ANNO-TEXT", "style": "ARIAL"}).set_placement((331, y))
        psp.add_text(f"{area:.2f} m\\U+00B2".replace("\\U+00B2", "²"), height=2.0, dxfattribs={"layer": "G-ANNO-TEXT", "style": "ARIAL"}).set_placement(
            (407, y), align=TextEntityAlignment.BOTTOM_RIGHT
        )
        psp.add_line((331, y - 1.4), (407, y - 1.4), dxfattribs={**tb, "lineweight": 9})
    y -= 6
    psp.add_text("Net floor area", height=2.2, dxfattribs={"layer": "G-ANNO-TEXT", "style": "ARIAL-BOLD"}).set_placement((331, y))
    psp.add_text(f"{total:.2f} m²", height=2.2, dxfattribs={"layer": "G-ANNO-TEXT", "style": "ARIAL-BOLD"}).set_placement(
        (407, y), align=TextEntityAlignment.BOTTOM_RIGHT
    )

    # notes
    notes = psp.add_mtext(
        "{\\fArial|b1|i0|c0|p34;NOTES}\\P"
        "1. All dimensions in millimetres.\\P"
        "2. Do not scale from this drawing.\\P"
        "3. Wall thickness: exterior 365, load-bearing 240, partitions 115.\\P"
        "4. Opened in your browser by truedxf: nothing was uploaded.",
        dxfattribs={"layer": "G-ANNO-TEXT", "char_height": 1.9, "style": "ARIAL", "width": 76},
    )
    notes.set_location((331, 132), attachment_point=MTextEntityAlignment.TOP_LEFT)
    psp.add_blockref("NORTH", (395, 100), dxfattribs={"layer": "G-ANNO-TTLB", "xscale": 0.011, "yscale": 0.011, "rotation": -12})

    # title block with attributes and the logo
    psp.add_line((328, 74), (410, 74), dxfattribs=tb)
    ins = psp.add_blockref("TITLE", (329, 74), dxfattribs={"layer": "G-ANNO-TTLB"})
    ins.add_auto_attribs({})
    logo = doc.add_image_def(filename=LOGO, size_in_pixel=(256, 256), name="truedxf-logo")
    psp.add_image(logo, insert=(331, 76), size_in_units=(14, 14), dxfattribs={"layer": "G-ANNO-TTLB"})
    t = psp.add_text("truedxf", height=5, dxfattribs={"layer": "G-ANNO-TEXT", "style": "ARIAL-BOLD"})
    t.set_placement((348, 80))
    t = psp.add_text("DXF viewer sample drawing", height=2, dxfattribs={"layer": "G-ANNO-TEXT", "style": "ARIAL"})
    t.set_placement((348, 77))


def logo_png(path: Path) -> None:
    from PIL import Image, ImageDraw

    s = 256
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=56, fill=(47, 129, 247, 255))
    tri = [(s * 0.19, s * 0.78), (s * 0.5, s * 0.22), (s * 0.81, s * 0.78)]
    d.line(tri + [tri[0]], fill=(255, 255, 255, 255), width=22, joint="curve")
    img.save(path, optimize=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    if os.environ.get("PYTHONHASHSEED") != "0":
        env = {**os.environ, "PYTHONHASHSEED": "0"}
        return subprocess.call([sys.executable, __file__, *sys.argv[1:]], env=env)
    args.out.mkdir(parents=True, exist_ok=True)
    doc = ezdxf.new("R2018", setup=["linetypes"])
    setup(doc)
    blocks(doc)
    plan(doc)
    sheet(doc)
    target = args.out / NAME
    doc.saveas(target)
    logo_png(args.out / LOGO)
    auditor = ezdxf.readfile(target).audit()
    for e in auditor.errors:
        print("audit error:", e.message)
    print(f"{target}: {target.stat().st_size / 1e3:.0f} kB, audit errors {len(auditor.errors)}, fixes {len(auditor.fixes)}")
    return 1 if auditor.errors else 0


if __name__ == "__main__":
    sys.exit(main())
