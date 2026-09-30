"""Calibration suite generator (tools/acad owns suite "calibration"; research/notes/08 §9 T-PL-*).

    tools/gen/.venv/Scripts/python tools/acad/calibration/calgen.py [--only name,...]

Writes samples/generated/calibration/<case>.{dxf,json} per docs/fixtures.md. Every case records
its probe geometry in ``params`` so the analysis scripts (analyze.py) can evaluate the references.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Callable

import ezdxf
from ezdxf.document import Drawing

ezdxf.options.write_fixed_meta_data_for_testing = True

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "samples" / "generated" / "calibration"
GENERATOR = f"tools/acad/calibration 0.1 / ezdxf {ezdxf.__version__}"

LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211]

CASES: dict[str, Callable[[], None]] = {}


def case(fn: Callable[[], None]) -> Callable[[], None]:
    CASES[fn.__name__] = fn
    return fn


def new_doc() -> Drawing:
    doc = ezdxf.new("R2018", setup=False)
    doc.header["$MEASUREMENT"] = 1
    doc.header["$INSUNITS"] = 4
    doc.header["$LWDISPLAY"] = 1
    doc.header["$FILLMODE"] = 1
    doc.header["$PDMODE"] = 0
    doc.header["$PDSIZE"] = 0.0
    doc.header["$LTSCALE"] = 1.0
    doc.header["$PSLTSCALE"] = 1
    # Layer 0 with explicit lineweight 0 so "BYLAYER" entities are hairlines, not LWDEFAULT.
    doc.layers.get("0").dxf.lineweight = 0
    return doc


def write(
    name: str,
    doc: Drawing,
    *,
    title: str,
    tags: list[str],
    params: dict[str, Any],
    canvas: tuple[int, int] = (2000, 1500),
    window: tuple[tuple[float, float], tuple[float, float]] | None = None,
    layout: str = "Model",
    area: dict[str, Any] | None = None,
    style: str = "monochrome.ctb",
    outputs: tuple[str, ...] = ("png",),
    extra_plot: dict[str, Any] | None = None,
) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if area is None:
        (x0, y0), (x1, y1) = window or ((0.0, 0.0), (canvas[0] / 10, canvas[1] / 10))
        assert abs((x1 - x0) * canvas[1] - (y1 - y0) * canvas[0]) < 1e-9, "window aspect != canvas aspect"
        area = {"type": "window", "min": [x0, y0], "max": [x1, y1]}
    meta = {
        "id": f"calibration/{name}",
        "suite": "calibration",
        "title": title,
        "tags": tags,
        "questions": [],
        "seed": None,
        "params": params,
        "dxfversion": doc.dxfversion,
        "generator": GENERATOR,
        "plot": {
            "layout": layout,
            "area": area,
            "canvas": list(canvas),
            "styleTable": style,
            "lineweights": True,
            "scale": "fit",
            **(extra_plot or {}),
        },
        "outputs": list(outputs),
    }
    doc.saveas(OUT / f"{name}.dxf")
    (OUT / f"{name}.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8", newline="\n")


# ---------------------------------------------------------------------------------------------
# T-PL-1: world -> pixel mapping


def _mapping(name: str, canvas: tuple[int, int]) -> None:
    """Short lineweight-0 vertical (x probes) and horizontal (y probes) segments at sub-pixel steps.

    Nominal scale is 10 px/unit (window = canvas / 10). Around each anchor the probe coordinate
    advances by 0.005 units (0.05 px) over 0.25 units, so the column/row flip points give scale and
    offset to ~0.05 px at several places across the canvas. A border rectangle is on the window edge.
    """
    doc = new_doc()
    msp = doc.modelspace()
    W, H = canvas[0] / 10, canvas[1] / 10
    msp.add_lwpolyline([(0, 0), (W, 0), (W, H), (0, H)], close=True, dxfattribs={"lineweight": 0})
    xprobes, yprobes = [], []
    nx = 51
    step = 0.005
    # x probes: vertical segments, one row band per probe index; anchors spread across the width.
    xanchors = [round(W * f, 3) + 0.0 for f in (0.1, 0.35, 0.6, 0.85)]
    band = (H - 10) / nx  # probe i occupies y in [5 + i*band, 5 + i*band + 0.6*band]
    for a in xanchors:
        for i in range(nx):
            x = a + i * step
            y0 = 5 + i * band
            y1 = y0 + 0.6 * band
            msp.add_line((x, y0), (x, y1), dxfattribs={"lineweight": 0})
            xprobes.append({"x": x, "y0": y0, "y1": y1})
    # y probes: horizontal segments in a separate case would overlap; put them in columns between
    # the x-anchor groups (x ranges chosen to avoid the vertical probes).
    yanchors = [round(H * f, 3) for f in (0.1, 0.35, 0.6, 0.85)]
    colw = W * 0.2 / nx
    for k, a in enumerate(yanchors):
        base = W * (0.12 + 0.25 * k)
        for i in range(nx):
            y = a + i * step
            x0 = base + 0.5 + i * colw * 0.9
            x1 = x0 + colw * 0.5
            msp.add_line((x0, y), (x1, y), dxfattribs={"lineweight": 0})
            yprobes.append({"y": y, "x0": x0, "x1": x1})
    write(
        name,
        doc,
        title=f"Window/Fit/Center mapping probes {canvas[0]}x{canvas[1]}",
        tags=["LINE", "LWPOLYLINE", "calibration", "T-PL-1"],
        params={"xprobes": xprobes, "yprobes": yprobes, "window": [[0, 0], [W, H]]},
        canvas=canvas,
        outputs=("png", "pdf"),
    )


@case
def mapping_2000() -> None:
    _mapping("mapping-2000x1500", (2000, 1500))


@case
def mapping_1000() -> None:
    _mapping("mapping-1000x1000", (1000, 1000))


@case
def mapping_800() -> None:
    _mapping("mapping-800x600", (800, 600))


def _ties(name: str, canvas: tuple[int, int]) -> None:
    """Probes exactly ON pixel boundaries (and +-2^-20 units off them) at 8 px/unit.

    8 px/unit is a power of two, so k/8 and the device coordinates are exact binary values and the
    result shows the tie rule itself, not floating-point noise. Covers both canvas edges and the
    centre line.
    """
    W, H = canvas
    ppu = 8
    ww, wh = W / ppu, H / ppu
    doc = new_doc()
    msp = doc.modelspace()
    eps = 2.0**-20
    ks_x = [0, 1, 2, 3, W // 4, W // 2 - 1, W // 2, W // 2 + 1, 3 * W // 4, W - 3, W - 2, W - 1, W]
    ks_y = [0, 1, 2, 3, H // 4, H // 2 - 1, H // 2, H // 2 + 1, 3 * H // 4, H - 3, H - 2, H - 1, H]
    xprobes, yprobes = [], []
    i = 0
    for k in ks_x:
        for off in (0.0, -eps, eps):
            x = k / ppu + off
            y0 = 2 + i * (wh - 4) / (3 * len(ks_x))
            y1 = y0 + 0.5 * (wh - 4) / (3 * len(ks_x))
            msp.add_line((x, y0), (x, y1), dxfattribs={"lineweight": 0})
            xprobes.append({"x": x, "k": k, "off": off, "y0": y0, "y1": y1})
            i += 1
    j = 0
    span = ww * 0.2
    for k in ks_y:
        for off in (0.0, -eps, eps):
            y = k / ppu + off
            x0 = ww * 0.52 + j * span / (3 * len(ks_y))
            x1 = x0 + 0.5 * span / (3 * len(ks_y))
            msp.add_line((x0, y), (x1, y), dxfattribs={"lineweight": 0})
            yprobes.append({"y": y, "k": k, "off": off, "x0": x0, "x1": x1})
            j += 1
    write(
        name,
        doc,
        title=f"Pixel-boundary tie probes {W}x{H} (8 px/unit)",
        tags=["LINE", "calibration", "T-PL-1"],
        params={"xprobes": xprobes, "yprobes": yprobes, "ppu": ppu, "window": [[0, 0], [ww, wh]]},
        canvas=canvas,
        window=((0.0, 0.0), (ww, wh)),
        outputs=("png", "pdf"),
    )


@case
def mapping_ties() -> None:
    _ties("mapping-ties-2000x1500", (2000, 1500))
    _ties("mapping-ties-1000x1000", (1000, 1000))
    _ties("mapping-ties-800x600", (800, 600))


@case
def mapping_offset() -> None:
    """Same probes but the window does not start at the origin and is not 10 px/unit."""
    doc = new_doc()
    msp = doc.modelspace()
    x0, y0, W, H = 1000.0, -500.0, 80.0, 60.0  # 25 px/unit on 2000x1500
    msp.add_lwpolyline([(x0, y0), (x0 + W, y0), (x0 + W, y0 + H), (x0, y0 + H)], close=True, dxfattribs={"lineweight": 0})
    pts = []
    for i in range(1, 8):
        for j in range(1, 6):
            x, y = x0 + i * 10 + 0.013 * i, y0 + j * 10 + 0.017 * j
            msp.add_line((x - 0.5, y), (x + 0.5, y), dxfattribs={"lineweight": 0})
            msp.add_line((x, y - 0.5), (x, y + 0.5), dxfattribs={"lineweight": 0})
            pts.append([x, y])
    write(
        "mapping-offset",
        doc,
        title="Mapping with an off-origin window at 25 px/unit",
        tags=["LINE", "calibration", "T-PL-1"],
        params={"crosses": pts, "arm": 0.5},
        window=((x0, y0), (x0 + W, y0 + H)),
    )


# ---------------------------------------------------------------------------------------------
# T-PL-2: rasterization of thin lines, points, small circles, fills


@case
def raster_lines() -> None:
    """Lineweight-0 lines at many slopes and sub-pixel endpoint offsets (one per 10x10-unit cell)."""
    doc = new_doc()
    msp = doc.modelspace()
    lines = []
    k = 0
    for row in range(15):
        for col in range(20):
            cx, cy = col * 10 + 1.0, row * 10 + 1.0
            ang = math.radians((k * 7.3) % 360)
            length = 3.0 + (k % 5)
            ox = ((k * 0.37) % 1.0) * 0.1  # 0 .. 1 px sub-pixel offset
            oy = ((k * 0.53) % 1.0) * 0.1
            p0 = (cx + 1 + ox, cy + 1 + oy)
            p1 = (p0[0] + length * math.cos(ang) * 0.9, p0[1] + length * math.sin(ang) * 0.9)
            p1 = (min(max(p1[0], cx + 0.2), cx + 9.6), min(max(p1[1], cy + 0.2), cy + 9.6))
            msp.add_line(p0, p1, dxfattribs={"lineweight": 0})
            lines.append({"p0": list(p0), "p1": list(p1), "cell": [col, row]})
            k += 1
    write(
        "raster-lines",
        doc,
        title="Thin line rasterization at many slopes and sub-pixel offsets",
        tags=["LINE", "calibration", "T-PL-2"],
        params={"lines": lines},
        outputs=("png", "pdf"),
    )


@case
def raster_curves() -> None:
    """Points (PDMODE 0), tiny and medium circles, arcs, lineweight 0."""
    doc = new_doc()
    msp = doc.modelspace()
    points, circles, arcs = [], [], []
    for i in range(20):
        p = (5 + i * 9.5 + 0.037 * i, 140 + 0.043 * i)
        msp.add_point(p, dxfattribs={"lineweight": 0})
        points.append(list(p))
    radii = [0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0, 5.0]
    x = 5.0
    for i, r in enumerate(radii):
        c = (x + r + 0.013 * i, 115 + 0.021 * i)
        msp.add_circle(c, r, dxfattribs={"lineweight": 0})
        circles.append({"c": list(c), "r": r})
        x += 2 * r + 3
    for i in range(6):
        c = (20 + i * 30, 40.0)
        r = 12.0 + i * 0.37
        msp.add_arc(c, r, 10 + 20 * i, 200 + 20 * i, dxfattribs={"lineweight": 0})
        arcs.append({"c": list(c), "r": r, "a0": 10 + 20 * i, "a1": 200 + 20 * i})
    # One big circle to measure tessellation (segment count) in PNG and PDF.
    msp.add_circle((100, 80), 60, dxfattribs={"lineweight": 0})
    circles.append({"c": [100, 80], "r": 60})
    write(
        "raster-curves",
        doc,
        title="Points, small circles and arcs at lineweight 0",
        tags=["POINT", "CIRCLE", "ARC", "calibration", "T-PL-2"],
        params={"points": points, "circles": circles, "arcs": arcs},
        outputs=("png", "pdf"),
    )


@case
def raster_fills() -> None:
    """SOLID and solid HATCH triangles/quads with sub-pixel vertices (edge coverage rule)."""
    doc = new_doc()
    msp = doc.modelspace()
    solids, hatches = [], []
    k = 0
    for row in range(3):
        for col in range(8):
            cx, cy = 5 + col * 24, 10 + row * 22
            f = [((k * 0.29) % 1) * 0.1, ((k * 0.61) % 1) * 0.1, ((k * 0.83) % 1) * 0.1]
            tri = [(cx + f[0], cy + f[1]), (cx + 15.3 + f[2], cy + 3.7 + f[0]), (cx + 5.1 + f[1], cy + 14.2 + f[2])]
            if row == 2:
                # axis-aligned rectangles with fractional edges
                tri = [(cx + f[0], cy + f[1]), (cx + 12.34 + f[2], cy + f[1]), (cx + 12.34 + f[2], cy + 9.87 + f[0]), (cx + f[0], cy + 9.87 + f[0])]
            if len(tri) == 3:
                msp.add_solid([tri[0], tri[1], tri[2], tri[2]], dxfattribs={"lineweight": 0})
            else:
                # SOLID vertex order 1,2,4,3 for a quad
                msp.add_solid([tri[0], tri[1], tri[3], tri[2]], dxfattribs={"lineweight": 0})
            solids.append([list(p) for p in tri])
            k += 1
    for col in range(8):
        cx, cy = 5 + col * 24, 80
        f = [((k * 0.29) % 1) * 0.1, ((k * 0.61) % 1) * 0.1, ((k * 0.83) % 1) * 0.1]
        poly = [(cx + f[0], cy + f[1]), (cx + 15.3 + f[2], cy + 3.7 + f[0]), (cx + 5.1 + f[1], cy + 14.2 + f[2])]
        h = msp.add_hatch(dxfattribs={"lineweight": 0})
        h.set_solid_fill(color=7)
        h.paths.add_polyline_path(poly, is_closed=True)
        hatches.append([list(p) for p in poly])
        k += 1
    # A solid hatch rectangle with default lineweight (does a hatch get a lineweight outline?)
    for i, lw in enumerate([0, 50, 211, -3]):
        cx, cy = 5 + i * 30, 105
        poly = [(cx, cy), (cx + 20, cy), (cx + 20, cy + 20), (cx, cy + 20)]
        h = msp.add_hatch(dxfattribs={"lineweight": lw})
        h.set_solid_fill(color=7)
        h.paths.add_polyline_path(poly, is_closed=True)
        hatches.append([list(p) for p in poly])
    for i, lw in enumerate([0, 211]):
        cx, cy = 125 + i * 30, 105
        msp.add_solid([(cx, cy), (cx + 20, cy), (cx, cy + 20), (cx + 20, cy + 20)], dxfattribs={"lineweight": lw})
        solids.append([[cx, cy], [cx + 20, cy], [cx + 20, cy + 20], [cx, cy + 20]])
    write(
        "raster-fills",
        doc,
        title="SOLID and solid HATCH edge coverage with sub-pixel vertices",
        tags=["SOLID", "HATCH", "calibration", "T-PL-2"],
        params={"solids": solids, "hatches": hatches, "fill_lineweights": {"hatch": [0, 50, 211, -3], "solid": [0, 211]}},
        outputs=("png", "pdf"),
    )


# ---------------------------------------------------------------------------------------------
# T-PL-3 / T-PL-4: lineweights, caps, joins


def _lineweights(name: str, canvas: tuple[int, int], frac: float) -> None:
    """All 24 lineweights: horizontal, vertical and 30 deg lines; centre offset `frac` px."""
    doc = new_doc()
    msp = doc.modelspace()
    W, H = canvas[0] / 10, canvas[1] / 10
    # coordinates in units; nominal 10 px/unit; frac shifts the centreline by frac px
    d = frac / 10
    items = []
    for i, lw in enumerate(LINEWEIGHTS + [-3]):
        y = 3 + i * 2.4 + d
        msp.add_line((3, y), (40, y), dxfattribs={"lineweight": lw})
        x = 45 + i * 2.4 + d
        msp.add_line((x, 3), (x, 40), dxfattribs={"lineweight": lw})
        # diagonal 30 deg and 45 deg
        bx = 3 + i * 7.5
        if bx + 6 < W:
            msp.add_line((bx, H - 50), (bx + 6, H - 50 + 6 * math.tan(math.radians(30))), dxfattribs={"lineweight": lw})
            msp.add_line((bx, H - 38), (bx + 5, H - 33), dxfattribs={"lineweight": lw})
        items.append({"lw": lw, "hy": y, "hx": [3, 40], "vx": x, "vy": [3, 40], "d30": [bx, H - 50], "d45": [bx, H - 38]})
    write(
        name,
        doc,
        title=f"All standard lineweights, {canvas[0]}x{canvas[1]}, centre offset {frac} px",
        tags=["LINE", "lineweight", "calibration", "T-PL-3"],
        params={"items": items, "frac_px": frac},
        canvas=canvas,
        outputs=("png", "pdf"),
    )


@case
def lineweights() -> None:
    _lineweights("lineweights-2000x1500", (2000, 1500), 0.0)
    _lineweights("lineweights-2000x1500-half", (2000, 1500), 0.5)
    _lineweights("lineweights-4000x3000", (4000, 3000), 0.0)


@case
def caps_joins() -> None:
    """Thick (2.11 mm) open/closed polylines with 90/30/150 degree corners, single LINEs, arcs.

    40 px/unit (window 50 x 37.5) so the 8.3 px wide strokes are large enough to see cap shapes.
    """
    doc = new_doc()
    msp = doc.modelspace()
    lw = 211
    msp.add_line((2, 2), (12, 2), dxfattribs={"lineweight": lw})
    msp.add_line((2, 6), (12, 9), dxfattribs={"lineweight": lw})
    msp.add_lwpolyline([(16, 2), (26, 2), (26, 12)], dxfattribs={"lineweight": lw})  # 90 deg
    msp.add_lwpolyline([(30, 2), (42, 2), (32, 8)], dxfattribs={"lineweight": lw})  # ~30 deg
    msp.add_lwpolyline([(2, 16), (10, 16), (18, 19)], dxfattribs={"lineweight": lw})  # 160 deg
    msp.add_lwpolyline([(22, 15), (30, 15), (30, 22), (22, 22)], close=True, dxfattribs={"lineweight": lw})
    # two separate LINEs meeting at a corner
    msp.add_line((34, 15), (44, 15), dxfattribs={"lineweight": lw})
    msp.add_line((44, 15), (44, 25), dxfattribs={"lineweight": lw})
    msp.add_arc((8, 28), 5, 0, 180, dxfattribs={"lineweight": lw})
    # 2D POLYLINE (old style) with a corner
    msp.add_polyline2d([(18, 26), (26, 26), (26, 34)], dxfattribs={"lineweight": lw})
    # lw 100 corner for comparison
    msp.add_lwpolyline([(32, 28), (40, 28), (40, 35)], dxfattribs={"lineweight": 100})
    write(
        "caps-joins",
        doc,
        title="Line caps and joins of 2.11 mm strokes (40 px/unit)",
        tags=["LINE", "LWPOLYLINE", "POLYLINE", "ARC", "lineweight", "calibration", "T-PL-4"],
        params={"px_per_unit": 40, "lw": lw},
        window=((0, 0), (50, 37.5)),
        outputs=("png", "pdf"),
    )


# ---------------------------------------------------------------------------------------------
# T-PL-5: colours


def _swatches(block, x0: float, y0: float, size: float, true_colors: list[tuple[int, int, int]]):
    """16 x 16 grid of ACI 0..255 (0 = empty) solid hatch swatches + a row of true colours."""
    cells = []
    for aci in range(1, 256):
        col, row = aci % 16, aci // 16
        x, y = x0 + col * size, y0 + (15 - row) * size
        poly = [(x + 0.1 * size, y + 0.1 * size), (x + 0.9 * size, y + 0.1 * size), (x + 0.9 * size, y + 0.9 * size), (x + 0.1 * size, y + 0.9 * size)]
        h = block.add_hatch(color=aci, dxfattribs={"lineweight": 0})
        h.paths.add_polyline_path(poly, is_closed=True)
        cells.append({"aci": aci, "center": [x + 0.5 * size, y + 0.5 * size]})
    tcs = []
    for i, rgb in enumerate(true_colors):
        x, y = x0 + i * size, y0 - 1.2 * size
        poly = [(x + 0.1 * size, y + 0.1 * size), (x + 0.9 * size, y + 0.1 * size), (x + 0.9 * size, y + 0.9 * size), (x + 0.1 * size, y + 0.9 * size)]
        h = block.add_hatch(dxfattribs={"lineweight": 0})
        h.rgb = rgb
        h.paths.add_polyline_path(poly, is_closed=True)
        tcs.append({"rgb": list(rgb), "center": [x + 0.5 * size, y + 0.5 * size]})
    return cells, tcs


TRUE_COLORS = [(255, 255, 255), (0, 0, 0), (1, 2, 3), (254, 253, 252), (128, 64, 32), (18, 52, 86), (200, 100, 150), (255, 0, 0), (0, 255, 0), (0, 0, 255), (127, 127, 127), (51, 51, 51), (91, 91, 91), (153, 204, 102), (152, 152, 0), (204, 0, 0)]


@case
def palette_model() -> None:
    doc = new_doc()
    msp = doc.modelspace()
    cells, tcs = _swatches(msp, 0.0, 22.0, 8.0, TRUE_COLORS)
    # thin lines in ACI 1..7 + 7 via ByLayer (does a hatch fill differ from a line colour?)
    for i in range(1, 8):
        msp.add_line((140, 20 + i * 5), (190, 20 + i * 5), dxfattribs={"color": i, "lineweight": 50})
    write(
        "palette-model",
        doc,
        title="ACI 1-255 and true-colour swatches in model space, acad.ctb",
        tags=["HATCH", "color", "ACI", "truecolor", "calibration", "T-PL-5"],
        params={"cells": cells, "true_colors": tcs, "window": [[0, 0], [200, 150]]},
        style="acad.ctb",
        outputs=("png", "pdf"),
    )


@case
def palette_paper() -> None:
    """Same swatches drawn directly in paper space of Layout1, plus a viewport showing model swatches."""
    doc = new_doc()
    msp = doc.modelspace()
    _swatches(msp, 0.0, 22.0, 8.0, TRUE_COLORS)
    lay = doc.layouts.get("Layout1")
    lay.page_setup(size=(200, 150), margins=(0, 0, 0, 0), units="mm")
    cells, tcs = _swatches(lay, 2.0, 22.0, 5.0, TRUE_COLORS)
    vp = lay.add_viewport(center=(150, 75), size=(96, 146), view_center_point=(64, 75), view_height=146 * 1.4)
    vp.dxf.lineweight = 0
    write(
        "palette-paper",
        doc,
        title="ACI swatches in paper space and through a viewport, acad.ctb",
        tags=["HATCH", "color", "ACI", "VIEWPORT", "paperspace", "calibration", "T-PL-5"],
        params={"cells": cells, "true_colors": tcs, "window": [[0, 0], [200, 150]], "viewport": {"center": [150, 75], "size": [96, 146], "view_center": [64, 75], "view_height": 146 * 1.4}},
        layout="Layout1",
        style="acad.ctb",
        outputs=("png", "pdf"),
    )


@case
def palette_mono() -> None:
    """Swatches under monochrome.ctb (everything black? true colours too?)."""
    doc = new_doc()
    msp = doc.modelspace()
    cells, tcs = _swatches(msp, 0.0, 22.0, 8.0, TRUE_COLORS)
    write(
        "palette-mono",
        doc,
        title="ACI and true-colour swatches under monochrome.ctb",
        tags=["HATCH", "color", "calibration", "T-PL-5"],
        params={"cells": cells, "true_colors": tcs, "window": [[0, 0], [200, 150]]},
        style="monochrome.ctb",
    )


# ---------------------------------------------------------------------------------------------
# PDF curves, layouts and viewports


@case
def pdf_curves() -> None:
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_circle((40, 75), 30, dxfattribs={"lineweight": 50})
    msp.add_arc((110, 75), 30, 30, 150, dxfattribs={"lineweight": 0})
    msp.add_ellipse((160, 40), major_axis=(25, 10), ratio=0.4, dxfattribs={"lineweight": 0})
    msp.add_spline([(120, 110), (140, 140), (160, 100), (190, 130)], dxfattribs={"lineweight": 0})
    msp.add_lwpolyline([(10, 130, 0, 0, 1), (40, 130, 0, 0, 0)], format="xyseb", dxfattribs={"lineweight": 0})
    write(
        "pdf-curves",
        doc,
        title="Circle, arc, ellipse, spline, bulge polyline (PDF curve representation)",
        tags=["CIRCLE", "ARC", "ELLIPSE", "SPLINE", "LWPOLYLINE", "calibration"],
        params={"circle": {"c": [40, 75], "r": 30}},
        outputs=("png", "pdf"),
    )


def _arrow_model(msp) -> None:
    # arrow along +X from the origin, a short tick along +Y, and a "N" made of lines at +Y
    msp.add_lwpolyline([(0, 0), (40, 0)], dxfattribs={"lineweight": 50})
    msp.add_lwpolyline([(34, 4), (40, 0), (34, -4)], dxfattribs={"lineweight": 50})
    msp.add_line((0, 0), (0, 20), dxfattribs={"lineweight": 50})
    msp.add_lwpolyline([(-3, 24), (-3, 32), (3, 24), (3, 32)], dxfattribs={"lineweight": 50})


@case
def layout_basic() -> None:
    """Layout1 (200 x 150 mm, zero margins) with one viewport at 1:2 and paper-space geometry."""
    doc = new_doc()
    msp = doc.modelspace()
    _arrow_model(msp)
    msp.add_circle((0, 0), 10, dxfattribs={"lineweight": 0})
    lay = doc.layouts.get("Layout1")
    lay.page_setup(size=(200, 150), margins=(0, 0, 0, 0), units="mm")
    lay.add_lwpolyline([(0, 0), (200, 0), (200, 150), (0, 150)], close=True, dxfattribs={"lineweight": 0})
    lay.add_line((0, 0), (200, 150), dxfattribs={"lineweight": 0})
    vp = lay.add_viewport(center=(100, 75), size=(120, 90), view_center_point=(10, 5), view_height=180)
    vp.dxf.lineweight = 0
    write(
        "layout-basic",
        doc,
        title="Paper-space layout with one 1:2 viewport",
        tags=["VIEWPORT", "paperspace", "LAYOUT", "calibration"],
        params={"viewport": {"center": [100, 75], "size": [120, 90], "view_center": [10, 5], "view_height": 180}},
        layout="Layout1",
        area={"type": "window", "min": [0, 0], "max": [200, 150]},
        outputs=("png", "pdf", "dxf"),
    )


@case
def layout_extent_area() -> None:
    """Same layout plotted with plot area 'layout' (paper-space origin / printable area)."""
    doc = new_doc()
    msp = doc.modelspace()
    _arrow_model(msp)
    lay = doc.layouts.get("Layout1")
    lay.page_setup(size=(200, 150), margins=(0, 0, 0, 0), units="mm")
    lay.add_lwpolyline([(0, 0), (200, 0), (200, 150), (0, 150)], close=True, dxfattribs={"lineweight": 0})
    lay.add_line((0, 0), (200, 150), dxfattribs={"lineweight": 0})
    vp = lay.add_viewport(center=(100, 75), size=(120, 90), view_center_point=(10, 5), view_height=180)
    vp.dxf.lineweight = 0
    write(
        "layout-area-layout",
        doc,
        title="Paper-space layout plotted with area 'layout'",
        tags=["VIEWPORT", "paperspace", "LAYOUT", "calibration"],
        params={},
        layout="Layout1",
        area={"type": "layout"},
    )


@case
def vp_twist() -> None:
    """Viewports with twist 30 deg and -45 deg (VIEWPORT 51) looking at the +X arrow."""
    doc = new_doc()
    msp = doc.modelspace()
    _arrow_model(msp)
    lay = doc.layouts.get("Layout1")
    lay.page_setup(size=(200, 150), margins=(0, 0, 0, 0), units="mm")
    vps = []
    for i, tw in enumerate([0, 30, -45, 90]):
        c = (50 + (i % 2) * 100, 112.5 - (i // 2) * 75)
        vp = lay.add_viewport(center=c, size=(96, 71), view_center_point=(15, 10), view_height=100)
        vp.dxf.view_twist_angle = tw
        vp.dxf.lineweight = 0
        vps.append({"center": list(c), "twist": tw})
    write(
        "vp-twist",
        doc,
        title="Viewport twist sign (0, 30, -45, 90 deg)",
        tags=["VIEWPORT", "paperspace", "twist", "calibration", "T-VP-4"],
        params={"viewports": vps},
        layout="Layout1",
        area={"type": "window", "min": [0, 0], "max": [200, 150]},
        outputs=("png", "pdf", "dxf"),
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    for name, fn in CASES.items():
        if only and name not in only:
            continue
        fn()
    print(f"wrote {len(list(OUT.glob('*.json')))} cases to {OUT}")


if __name__ == "__main__":
    main()
