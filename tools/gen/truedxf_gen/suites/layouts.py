"""Paper-space layouts: LAYOUT/PLOTSETTINGS, VIEWPORT scale/DCS/twist/clipping/on-off/frozen
layers/per-VP overrides, PSLTSCALE, draw order, 3D view directions, plot areas, extents
(notes 08 §1-§5 and §9 test ideas, 06 §2.5, 02 §2.1, 11a §14, 11b §14, 11c §11).

Conventions of this suite (fixtures stay minimal and consistent):

- Every layout case uses the *default* layout ``Layout1`` (the active layout, i.e. its entities
  live in the ENTITIES section with 67=1). Additional layouts (``Sheet2`` ...) are created with
  ``doc.layouts.new`` only where several layouts are the feature; they live in *Paper_SpaceN blocks.
- Page setup: ``page_setup(size=(400, 300), margins=0, units="mm", device="DWG To PDF.pc3")``
  (paper name ``truedxf_(400.00_x_300.00_MM)``); ezdxf creates the overall viewport (id 1,
  status 1, 90=557088) as the first entity of the layout; we move it to layer 0.
- Plot: window (0,0)-(400,300) in paper mm on the 2000x1500 canvas = 5 px/mm
  (``c.layout_window``), a few cases with plot area "layout" (``c.plot_layout``).
- Viewports are on layer VPORTS (colour 7, lineweight 0, plottable) so their frames plot as
  hairlines and serve as reference; the paper sheet has a hairline border (2,2)-(398,298) on
  layer PAPER.
- Model "target" (layer 0): frame (0,0)-(200,150), circle r=40 at (100,75), arrow +X, letter "F"
  standing on +Y, a small square in the lower-left corner (orientation and mirroring are
  unambiguous). The standard viewport (center (200,150), 360 x 270 mm) looks at (100,75).
- Harness plot extensions (tools/acad/src/script.ts ``PlotMeta``): ``paperSpaceFirst`` (answer to
  "Plot paper space first?") and ``sysvars``; written into the case JSON by ``_plot_extra``.
- Many PLOTSETTINGS fields are overridden by the harness' detailed -PLOT (device, paper,
  orientation, window, Fit, Center, lineweights ...). The ``pagesetup-*`` cases therefore pin the
  *stored* values: the echoed -PLOT prompts show them as defaults (log) and DXFOUT shows what
  AutoCAD keeps or recomputes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, fields
from typing import Any, Optional, Sequence

from ezdxf.math import Vec3

from ..core import Case, Plot, SuiteBuilder, suite

PAPER = (400.0, 300.0)
WIN_MIN = (0.0, 0.0)
WIN_MAX = PAPER
SHEET_C = (200.0, 150.0)
VP_SIZE = (360.0, 270.0)
TC = (100.0, 75.0)  # model target centre

VP_FLAGS_ON = 0  # ezdxf default for user viewports (proven to plot in calibration/layout-basic)
VP_OFF = 0x20000
VP_NONRECT = 0x10000


# --------------------------------------------------------------------------------------------
# helpers


@dataclass
class _PlotExt(Plot):
    """Plot description with harness extensions (paperSpaceFirst, sysvars)."""

    extra: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        d = super().to_json()
        d.update(self.extra)
        return d


def _plot_extra(c: Case, **extra: Any) -> None:
    base = {f.name: getattr(c.plot, f.name) for f in fields(Plot)}
    old = getattr(c.plot, "extra", {})
    c.plot = _PlotExt(**base, extra={**old, **extra})


def _layout(
    c: Case,
    name: str = "Layout1",
    size: Sequence[float] = PAPER,
    units: str = "mm",
    margins: Sequence[float] = (0, 0, 0, 0),
    offset: Sequence[float] = (0, 0),
    rotation: int = 0,
    scale: Any = 16,
    device: str = "DWG To PDF.pc3",
    border: bool = True,
):
    if name == "Layout1":
        lay = c.doc.layouts.get("Layout1")
    else:
        lay = c.doc.layouts.new(name)
    lay.page_setup(
        size=tuple(size), margins=tuple(margins), units=units, offset=tuple(offset),
        rotation=rotation, scale=scale, name="truedxf", device=device,
    )
    main = lay.main_viewport()
    if main is not None:
        main.dxf.layer = "0"
    c.layer("VPORTS", color=7, lineweight=0)
    c.layer("PAPER", color=7, lineweight=0)
    if border:
        w, h = size
        lay.add_lwpolyline([(2, 2), (w - 2, 2), (w - 2, h - 2), (2, h - 2)], close=True, dxfattribs={"layer": "PAPER"})
    return lay


def _vp(
    lay,
    center: Sequence[float] = SHEET_C,
    size: Sequence[float] = VP_SIZE,
    scale: float = 1.0,
    view_center: Sequence[float] = TC,
    target: Optional[Sequence[float]] = None,
    direction: Optional[Sequence[float]] = None,
    twist: float = 0.0,
    layer: str = "VPORTS",
    **attrs: Any,
):
    vp = lay.add_viewport(
        center=tuple(center), size=tuple(size), view_center_point=tuple(view_center),
        view_height=size[1] / scale, dxfattribs={"layer": layer},
    )
    if target is not None:
        vp.dxf.view_target_point = tuple(target)
    if direction is not None:
        vp.dxf.view_direction_vector = tuple(direction)
    if twist:
        vp.dxf.view_twist_angle = twist
    for k, v in attrs.items():
        setattr(vp.dxf, k, v)
    return vp


def _target(space, layer: str = "0", ox: float = 0.0, oy: float = 0.0, **attrs: Any) -> None:
    """Asymmetric reference figure in the box (ox,oy)-(ox+200,oy+150)."""
    a = {"layer": layer, **attrs}

    def p(x, y):
        return (ox + x, oy + y)

    space.add_lwpolyline([p(0, 0), p(200, 0), p(200, 150), p(0, 150)], close=True, dxfattribs=a)
    space.add_lwpolyline([p(10, 10), p(30, 10), p(30, 30), p(10, 30)], close=True, dxfattribs=a)
    space.add_circle(p(100, 75), 40, dxfattribs=a)
    space.add_line(p(100, 75), p(180, 75), dxfattribs=a)
    space.add_lwpolyline([p(168, 82), p(180, 75), p(168, 68)], dxfattribs=a)
    space.add_line(p(100, 75), p(100, 140), dxfattribs=a)
    space.add_line(p(100, 140), p(135, 140), dxfattribs=a)
    space.add_line(p(100, 112), p(125, 112), dxfattribs=a)


def _std(c: Case, title_scale: float = 1.0, **vpkw: Any):
    """Layout1 + standard viewport on the model target; returns (layout, viewport)."""
    _target(c.msp)
    lay = _layout(c)
    vp = _vp(lay, scale=title_scale, **vpkw)
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)
    return lay, vp


def _hatch(space, pts, color: int = 256, layer: str = "0", pattern: Optional[str] = None, pscale: float = 1.0, angle: float = 0.0, **attrs: Any):
    h = space.add_hatch(color=color, dxfattribs={"layer": layer, **attrs})
    if pattern:
        h.set_pattern_fill(pattern, scale=pscale, angle=angle)
    h.paths.add_polyline_path(pts, is_closed=True)
    return h


def _rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def _grid(msp, x0, y0, x1, y1, step, **attrs) -> None:
    x = x0
    while x <= x1 + 1e-9:
        msp.add_line((x, y0), (x, y1), dxfattribs=attrs)
        x += step
    y = y0
    while y <= y1 + 1e-9:
        msp.add_line((x0, y), (x1, y), dxfattribs=attrs)
        y += step


def _set_clip(vp, entity) -> None:
    """Make ``vp`` non-rectangular: 90 bit 0x10000 + 340 -> paper-space clip entity; the clip entity
    carries a reactor to the viewport as AutoCAD writes it."""
    vp.dxf.flags = vp.dxf.flags | VP_NONRECT
    vp.dxf.clipping_boundary_handle = entity.dxf.handle
    entity.set_reactors([vp.dxf.handle])


def _bbox_of(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys)), (max(xs), max(ys))


def _ent_bbox(ent):
    """Exact-ish bbox of a curve entity (ezdxf's bbox of periodic SPLINEs is wrong)."""
    if ent.dxftype() == "SPLINE":
        pts = list(ent.construction_tool().approximate(720))
    else:
        from ezdxf import path as ezpath

        pts = list(ezpath.make_path(ent).flattening(0.001))
    (x0, y0), (x1, y1) = _bbox_of([(p.x, p.y) for p in pts])
    return (round(x0, 6), round(y0, 6)), (round(x1, 6), round(y1, 6))


def _vp_for_box(lay, bmin, bmax, scale=1.0, view_center=TC, **kw):
    cx, cy = (bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2
    return _vp(lay, center=(cx, cy), size=(bmax[0] - bmin[0], bmax[1] - bmin[1]), scale=scale, view_center=view_center, **kw)


def _cube_axes(msp) -> None:
    """Wire cube 0..60 plus coloured axes (X red, Y green, Z blue) with arrow heads."""
    e = [((0, 0, 0), (60, 0, 0)), ((60, 0, 0), (60, 60, 0)), ((60, 60, 0), (0, 60, 0)), ((0, 60, 0), (0, 0, 0))]
    edges = []
    for z in (0, 60):
        edges += [((a[0], a[1], z), (b[0], b[1], z)) for a, b in e]
    edges += [((x, y, 0), (x, y, 60)) for x, y in ((0, 0), (60, 0), (60, 60), (0, 60))]
    for a, b in edges:
        msp.add_line(a, b)
    ax = {"color": 1}
    msp.add_line((0, 0, 0), (110, 0, 0), dxfattribs=ax)
    msp.add_line((100, 5, 0), (110, 0, 0), dxfattribs=ax)
    msp.add_line((100, -5, 0), (110, 0, 0), dxfattribs=ax)
    ay = {"color": 3}
    msp.add_line((0, 0, 0), (0, 95, 0), dxfattribs=ay)
    msp.add_line((5, 85, 0), (0, 95, 0), dxfattribs=ay)
    msp.add_line((-5, 85, 0), (0, 95, 0), dxfattribs=ay)
    az = {"color": 5}
    msp.add_line((0, 0, 0), (0, 0, 85), dxfattribs=az)
    msp.add_line((5, 0, 75), (0, 0, 85), dxfattribs=az)
    msp.add_line((-5, 0, 75), (0, 0, 85), dxfattribs=az)
    # "F" on the top face (z=60), readable from above
    f = {"color": 2}
    msp.add_line((20, 10, 60), (20, 50, 60), dxfattribs=f)
    msp.add_line((20, 50, 60), (42, 50, 60), dxfattribs=f)
    msp.add_line((20, 32, 60), (36, 32, 60), dxfattribs=f)


# --------------------------------------------------------------------------------------------


@suite(
    "layouts",
    "Paper-space layouts, VIEWPORTs, PLOTSETTINGS, PSLTSCALE, draw order, plot areas, extents",
    layer0_lineweight=0,
)
def build(s: SuiteBuilder) -> None:
    _scales(s)
    _view_center(s)
    _twist(s)
    _clipping(s)
    _status(s)
    _multi_layouts(s)
    _freeze_overrides(s)
    _frames(s)
    _linetypes(s)
    _draw_order(s)
    _lineweights(s)
    _views3d(s)
    _paper_content(s)
    _plot_area(s)
    _pagesetup(s)
    _extents(s)
    _misc(s)
    _random(s)


# --- scale ------------------------------------------------------------------------------------


def _scales(s: SuiteBuilder) -> None:
    for name, sc in (("1-1", 1.0), ("1-2", 0.5), ("2-1", 2.0), ("1-10", 0.1), ("3-4", 0.75)):
        c = s.case(
            f"scale-{name}",
            f"Single viewport on the model target at scale {name.replace('-', ':')} (41/45 = {sc})",
            tags=["VIEWPORT", "LAYOUT", "scale"],
            params={"scale": sc, "vp_center": SHEET_C, "vp_size": VP_SIZE, "view_center": TC, "view_height": VP_SIZE[1] / sc},
        )
        _std(c, sc)


# --- view center / target (DCS) ---------------------------------------------------------------


def _view_center(s: SuiteBuilder) -> None:
    variants = [
        ("target-center", (100, 75, 0), (0, 0), 0, "target at the figure centre, view centre (0,0): same image as scale-1-1 if 12 is DCS"),
        ("target-offset", (60, 40, 0), (40, 35), 0, "target (60,40) + view centre (40,35) = WCS (100,75): same image as scale-1-1 if 12 is DCS"),
        ("target-and-vc-wcs", (100, 75, 0), (100, 75), 0, "target (100,75) + view centre (100,75): shows WCS (200,150) if 12 is DCS, (100,75) if WCS"),
        ("target-offset-twist30", (60, 40, 0), (40, 35), 30, "target (60,40), view centre (40,35), twist 30: is 12 rotated by the twist?"),
        ("target-z", (100, 75, 50), (0, 0), 0, "target with z=50 in a top view (no visible effect expected)"),
    ]
    for name, tgt, vc, tw, desc in variants:
        c = s.case(
            f"viewcenter-{name}",
            f"Viewport DCS: {desc}",
            tags=["VIEWPORT", "DCS", "view-target", "view-center"],
            questions=["Q-0721"] + (["Q-0720"] if tw else []),
            params={"target": tgt, "view_center": vc, "twist": tw},
        )
        _std(c, 1.0, target=tgt, view_center=vc, twist=tw)


# --- twist ------------------------------------------------------------------------------------


def _twist(s: SuiteBuilder) -> None:
    for tw in (0, 15, 30, 45, 90, 180, 270, -30, -45, 400):
        name = f"m{-tw}" if tw < 0 else str(tw)
        c = s.case(
            f"twist-{name}",
            f"Viewport twist 51={tw} deg about target (100,75,0), view centre (0,0), 1:1",
            tags=["VIEWPORT", "twist"],
            questions=["Q-0720"],
            params={"twist": tw, "target": (100, 75, 0), "view_center": (0, 0)},
        )
        _std(c, 1.0, target=(100, 75, 0), view_center=(0, 0), twist=tw)
    c = s.case(
        "twist-30-vc-wcs",
        "Viewport twist 30 with target (0,0,0) and view centre (100,75): WCS view centre = Rz(-30)*(100,75) (ezdxf) or Rz(+30) (mlightcad)",
        tags=["VIEWPORT", "twist", "view-center"],
        questions=["Q-0720", "Q-0721"],
        params={"twist": 30, "target": (0, 0, 0), "view_center": (100, 75)},
    )
    _std(c, 0.5, twist=30)
    c.notes.append("Scale 1:2 so that the whole model target stays visible for either twist-sign convention.")


# --- clipping ---------------------------------------------------------------------------------


STAR = [
    (200 + (150 if i % 2 == 0 else 70) * math.cos(math.radians(90 + 36 * i)),
     150 + (125 if i % 2 == 0 else 60) * math.sin(math.radians(90 + 36 * i)))
    for i in range(10)
]
STAR = [(round(x, 6), round(y, 6)) for x, y in STAR]


def _clip_model(c: Case, thick: bool = False) -> None:
    if thick:
        _grid(c.msp, -120, -60, 320, 210, 40, lineweight=211)
    else:
        _grid(c.msp, -120, -60, 320, 210, 20)
    _target(c.msp)


def _clipping(s: SuiteBuilder) -> None:
    # polygon clip on a plottable layer / no-plot layer / coloured layer
    for name, layer_kw, style, qs in (
        ("polygon", {"color": 7, "lineweight": 0}, "monochrome.ctb", ["Q-0730"]),
        ("polygon-noplot", {"color": 7, "lineweight": 0, "plot": False}, "monochrome.ctb", ["Q-0730"]),
        ("polygon-red-lw50", {"color": 1, "lineweight": 50}, "acad.ctb", ["Q-0730", "Q-0731"]),
    ):
        c = s.case(
            f"clip-{name}",
            f"Non-rectangular viewport clipped by a closed concave LWPOLYLINE (star) on layer CLIP {layer_kw}; VIEWPORT on blue layer",
            tags=["VIEWPORT", "clipping", "LWPOLYLINE"],
            questions=qs,
            style_table=style,
            params={"clip_layer": layer_kw, "star": STAR},
        )
        _clip_model(c)
        lay = _layout(c)
        c.layer("CLIP", **layer_kw)
        c.layer("VPBLUE", color=5, lineweight=0)
        pl = lay.add_lwpolyline(STAR, close=True, dxfattribs={"layer": "CLIP"})
        bmin, bmax = _bbox_of(STAR)
        vp = _vp_for_box(lay, bmin, bmax, view_center=(100 + (bmin[0] + bmax[0]) / 2 - 200, 75 + (bmin[1] + bmax[1]) / 2 - 150), layer="VPBLUE")
        _set_clip(vp, pl)
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    # other clip entity types
    bulge_poly = [(60, 60, 0.25), (340, 60, 0.3), (340, 240, -0.8), (200, 200, 0.0), (60, 240, 0.4)]
    ell_c, ell_major, ell_ratio = (200, 150), (160, 40), 0.6
    spline_ring = [(200 + 150 * math.cos(a), 150 + 110 * math.sin(a) + 20 * math.sin(3 * a)) for a in [i * math.tau / 8 for i in range(8)]]
    for kind in ("bulge", "circle", "ellipse", "spline"):
        c = s.case(
            f"clip-{kind}",
            f"Viewport clipped by a paper-space {kind.upper() if kind != 'bulge' else 'LWPOLYLINE with bulges'} (90 0x10000, 340); clip on red layer, VIEWPORT on blue layer",
            tags=["VIEWPORT", "clipping", kind.upper()],
            questions=["Q-0730", "Q-0731"],
            style_table="acad.ctb",
            params={"kind": kind},
        )
        _clip_model(c)
        lay = _layout(c)
        c.layer("CLIP", color=1, lineweight=0)
        c.layer("VPBLUE", color=5, lineweight=0)
        if kind == "bulge":
            ent = lay.add_lwpolyline([(x, y, 0, 0, b) for x, y, b in bulge_poly], format="xyseb", close=True, dxfattribs={"layer": "CLIP"})
        elif kind == "circle":
            ent = lay.add_circle((200, 150), 130, dxfattribs={"layer": "CLIP"})
        elif kind == "ellipse":
            ent = lay.add_ellipse(ell_c, major_axis=ell_major, ratio=ell_ratio, dxfattribs={"layer": "CLIP"})
        else:
            ent = lay.add_spline(dxfattribs={"layer": "CLIP"})
            ent.set_closed([Vec3(p) for p in spline_ring], degree=3)
        bmin, bmax = _ent_bbox(ent)
        bmin = (round(bmin[0], 6), round(bmin[1], 6))
        bmax = (round(bmax[0], 6), round(bmax[1], 6))
        cx, cy = (bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2
        vp = _vp_for_box(lay, bmin, bmax, view_center=(100 + cx - 200, 75 + cy - 150), layer="VPBLUE")
        _set_clip(vp, ent)
        c.params["vp_box"] = [bmin, bmax]
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    # viewport rectangle (10/40/41) deliberately different from the clip entity's bbox
    c = s.case(
        "clip-bbox-mismatch",
        "Polygon-clipped viewport whose 10/40/41 rectangle is larger and offset from the clip LWPOLYLINE bbox (which wins? DXFOUT values?)",
        tags=["VIEWPORT", "clipping"],
        questions=["Q-0733", "Q-0730"],
        style_table="acad.ctb",
    )
    _clip_model(c)
    lay = _layout(c)
    c.layer("CLIP", color=1, lineweight=0)
    c.layer("VPBLUE", color=5, lineweight=0)
    tri = [(120, 80), (330, 110), (200, 260)]
    pl = lay.add_lwpolyline(tri, close=True, dxfattribs={"layer": "CLIP"})
    vp = _vp(lay, center=(180, 140), size=(320, 240), layer="VPBLUE")  # rectangle (20,20)-(340,260)
    _set_clip(vp, pl)
    c.params.update({"clip": tri, "vp_rect": [(20, 20), (340, 260)]})
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    # thick strokes crossing the border
    for kind in ("rect", "bulge"):
        c = s.case(
            f"clip-thick-{kind}",
            f"Grid of 2.11 mm model LINEs crossing a {'rectangular' if kind == 'rect' else 'bulged polygonal'} viewport border (cut straight or capped?)",
            tags=["VIEWPORT", "clipping", "lineweight"],
            questions=["Q-0734"],
        )
        _clip_model(c, thick=True)
        lay = _layout(c)
        if kind == "rect":
            _vp(lay, center=(200, 150), size=(300, 200))
        else:
            c.layer("CLIP", color=7, lineweight=0)
            pts = [(60, 60, 0, 0, 0.5), (340, 60, 0, 0, 0.0), (340, 240, 0, 0, -0.4), (60, 240, 0, 0, 0.0)]
            ent = lay.add_lwpolyline(pts, format="xyseb", close=True, dxfattribs={"layer": "CLIP"})
            ext = _ent_bbox(ent)
            bmin = (round(ext[0][0], 6), round(ext[0][1], 6))
            bmax = (round(ext[1][0], 6), round(ext[1][1], 6))
            cx, cy = (bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2
            vp = _vp_for_box(lay, bmin, bmax, view_center=(100 + cx - 200, 75 + cy - 150))
            _set_clip(vp, ent)
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    # text and hatches crossing the border
    for kind in ("rect", "circle", "spline"):
        c = s.case(
            f"clip-text-hatch-{kind}",
            f"TTF TEXT, solid HATCH and ANSI31 HATCH crossing a {kind} viewport border (partial geometric clip?)",
            tags=["VIEWPORT", "clipping", "TEXT", "HATCH"],
            questions=["Q-0735"],
        )
        m = c.msp
        m.add_text("CLIPPED TEXT", height=24, dxfattribs={"insert": (-40, 110)})
        _hatch(m, _rect(-40, 20, 90, 90))
        _hatch(m, _rect(110, 20, 240, 90), pattern="ANSI31", pscale=2.0)
        m.add_text("Hg", height=40, dxfattribs={"insert": (150, -45)})
        lay = _layout(c)
        if kind == "rect":
            _vp(lay, center=(200, 150), size=(240, 180))
        elif kind == "circle":
            c.layer("CLIP", color=7, lineweight=0)
            ent = lay.add_circle((200, 150), 100, dxfattribs={"layer": "CLIP"})
            vp = _vp_for_box(lay, (100, 50), (300, 250))
            _set_clip(vp, ent)
        else:
            c.layer("CLIP", color=7, lineweight=0)
            ent = lay.add_spline(dxfattribs={"layer": "CLIP"})
            ent.set_closed([Vec3(200 + 120 * math.cos(a), 150 + 95 * math.sin(a) + 15 * math.sin(2 * a)) for a in [i * math.tau / 7 for i in range(7)]], degree=3)
            ext = _ent_bbox(ent)
            bmin = (round(ext[0][0], 6), round(ext[0][1], 6))
            bmax = (round(ext[1][0], 6), round(ext[1][1], 6))
            cx, cy = (bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2
            vp = _vp_for_box(lay, bmin, bmax, view_center=(100 + cx - 200, 75 + cy - 150))
            _set_clip(vp, ent)
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)


# --- on/off, status (68), id (69), overall viewport ---------------------------------------------


QUAD = [((105, 227.5), (190, 135)), ((295, 227.5), (190, 135)), ((105, 72.5), (190, 135)), ((295, 72.5), (190, 135))]


def _quad_vps(c: Case, lay, scale: float = 190 / 270 * 0.95):
    """Four viewports in a 2x2 grid, each showing the whole target."""
    vps = []
    for center, size in QUAD:
        vps.append(_vp(lay, center=center, size=size, scale=scale))
    return vps


def _status(s: SuiteBuilder) -> None:
    c = s.case(
        "onoff-flag",
        "Four viewports: A 90 bit 0x20000 (off) with 68=1, B flags clear with 68=0, C twist 30 control (68=2), D control",
        tags=["VIEWPORT", "on-off", "status"],
        questions=["Q-0710", "Q-0709"],
        params={"A": {"flags": VP_OFF, "status": 1}, "B": {"flags": 0, "status": 0}, "C": {"twist": 30, "status": 2}, "D": {"status": 3}},
    )
    _target(c.msp)
    lay = _layout(c)
    a, b, cc, d = _quad_vps(c, lay)
    a.dxf.flags = VP_OFF
    a.dxf.status = 1
    b.dxf.status = 0
    cc.dxf.view_twist_angle = 30
    cc.dxf.status = 2
    d.dxf.status = 3
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    for name, statuses, desc in (
        ("status-sweep", [-1, 0, 1, 2], "68 = -1 / 0 / 1 / 2 (overall viewport 68=1)"),
        ("status-all-zero", [0, 0, 0, 0], "68 = 0 on every viewport incl. the overall one (as AutoCAD writes non-activated layouts)"),
    ):
        c = s.case(
            name,
            f"Four viewports with {desc}",
            tags=["VIEWPORT", "status"],
            questions=["Q-0709"] + (["Q-0711"] if name == "status-all-zero" else []),
            params={"status": statuses},
        )
        _target(c.msp)
        lay = _layout(c)
        vps = _quad_vps(c, lay)
        for vp, st in zip(vps, statuses):
            vp.dxf.status = st
        if name == "status-all-zero":
            lay.main_viewport().dxf.status = 0
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    for name, ids, desc in (
        ("id-zero-minus1", [2, 0, -1, 3], "user viewport ids 69 = 2 / 0 / -1 / 3"),
        ("ids-all-zero", [0, 0, 0, 0], "69 = 0 on every viewport incl. the overall one"),
        ("ids-all-minus1", [-1, -1, -1, -1], "69 = -1 on every viewport incl. the overall one"),
    ):
        c = s.case(
            name,
            f"Four viewports with {desc}",
            tags=["VIEWPORT", "id"],
            questions=["Q-0709", "Q-0712"],
            params={"ids": ids},
        )
        _target(c.msp)
        lay = _layout(c)
        vps = _quad_vps(c, lay)
        for vp, i in zip(vps, ids):
            vp.dxf.id = i
        if name != "id-zero-minus1":
            lay.main_viewport().dxf.id = ids[0]
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    # overall viewport not first
    c = s.case(
        "overall-last",
        "Overall viewport (id 1, 68 1) written after the two user viewports instead of first",
        tags=["VIEWPORT", "overall-viewport"],
        questions=["Q-0712"],
    )
    _target(c.msp)
    lay = _layout(c)
    main = lay.main_viewport()
    _vp(lay, center=(105, 150), size=(190, 142.5), scale=0.9)
    _vp(lay, center=(295, 150), size=(190, 142.5), scale=0.6, twist=15)
    lay.entity_space.remove(main)
    lay.entity_space.add(main)
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    c = s.case(
        "overall-first-looks-like-user",
        "First VIEWPORT is a user viewport (id 1, status 1, showing model), real overall viewport second with id 2",
        tags=["VIEWPORT", "overall-viewport"],
        questions=["Q-0712"],
    )
    _target(c.msp)
    lay = _layout(c)
    main = lay.main_viewport()
    user = _vp(lay, center=(200, 150), size=(300, 225), scale=0.9)
    lay.entity_space.remove(user)
    lay.entity_space.entities.insert(0, user)
    user.dxf.id, user.dxf.status = 1, 1
    main.dxf.id, main.dxf.status = 2, 2
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    # missing overall viewport / uninitialised layout flags / none_device
    for name, init_flags, device, desc in (
        ("no-overall", 0, "DWG To PDF.pc3", "no overall viewport, one detail viewport (69 2)"),
        ("no-overall-initflags", 8192 | 16384, "DWG To PDF.pc3", "no overall viewport, LAYOUT 70 bits 8192|16384 set"),
        ("no-overall-none-device", 8192, "none_device", "no overall viewport, none_device, 70 bit 8192"),
        ("initflags-with-overall", 8192 | 16384, "DWG To PDF.pc3", "overall viewport present, LAYOUT 70 bits 8192|16384 set"),
    ):
        c = s.case(
            name,
            f"Layout with {desc}: does it open, plot and what does DXFOUT write?",
            tags=["VIEWPORT", "LAYOUT", "overall-viewport", "initialization"],
            questions=["Q-0704"],
            params={"init_flags": init_flags, "device": device},
        )
        _target(c.msp)
        lay = _layout(c, device=device)
        vp = _vp(lay, scale=1.0)
        if name.startswith("no-overall"):
            main = lay.main_viewport()
            lay.delete_entity(main)
            vp.dxf.id = 2
            lay.set_current_viewport_handle(vp.dxf.handle)
        if device == "none_device":
            lay.dxf_layout.dxf.paper_size = "none_user_media"
        lay.dxf_layout.dxf.plot_layout_flags |= init_flags
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)


# --- several layouts --------------------------------------------------------------------------


def _multi_layouts(s: SuiteBuilder) -> None:
    def build(c: Case) -> None:
        _target(c.msp)
        l1 = _layout(c)
        _vp(l1, center=(200, 150), size=(300, 225), scale=1.0)
        l1.add_circle((40, 260), 25, dxfattribs={"layer": "PAPER"})  # marks Layout1
        l1.add_text("LAYOUT1", height=12, dxfattribs={"insert": (80, 255), "layer": "PAPER"})
        l2 = _layout(c, "Sheet2")
        _vp(l2, center=(200, 150), size=(300, 225), scale=0.5, twist=90)
        l2.add_lwpolyline(_rect(15, 235, 65, 285), close=True, dxfattribs={"layer": "PAPER"})  # marks Sheet2
        l2.add_text("SHEET2", height=12, dxfattribs={"insert": (80, 255), "layer": "PAPER"})
        l3 = _layout(c, "Sheet3")
        _vp(l3, center=(110, 150), size=(180, 135), scale=0.6)
        _vp(l3, center=(300, 150), size=(160, 120), scale=0.3)
        l3.add_text("SHEET3", height=12, dxfattribs={"insert": (80, 255), "layer": "PAPER"})

    for name, plotname, desc in (
        ("multi-plot-layout1", "Layout1", "active layout (ENTITIES, 67=1)"),
        ("multi-plot-sheet2", "Sheet2", "inactive layout (*Paper_Space0 block)"),
        ("multi-plot-sheet3", "Sheet3", "inactive layout with two viewports (*Paper_Space1 block)"),
    ):
        c = s.case(
            name,
            f"Three layouts never activated (TILEMODE 1); plot the {desc}; DXFOUT shows 68/69 of all viewports",
            tags=["LAYOUT", "VIEWPORT", "paperspace-blocks", "status"],
            questions=["Q-0708", "Q-0711", "Q-0709"],
            params={"plotted": plotname, "layouts": ["Layout1", "Sheet2", "Sheet3"]},
        )
        build(c)
        c.layout_window(plotname, WIN_MIN, WIN_MAX)


# --- frozen layers and per-VP overrides ---------------------------------------------------------


LEFT = ((105, 150), (190, 250))
RIGHT = ((295, 150), (190, 250))


def _two_vp_model(c: Case):
    """Model: layer A = frame, square, circle; layer B = arrow and F. Two side-by-side viewports."""
    c.layer("A", color=7, lineweight=0)
    c.layer("B", color=7, lineweight=0)
    m = c.msp
    a = {"layer": "A"}
    b = {"layer": "B"}
    m.add_lwpolyline(_rect(0, 0, 200, 150), close=True, dxfattribs=a)
    m.add_lwpolyline(_rect(10, 10, 30, 30), close=True, dxfattribs=a)
    m.add_circle(TC, 40, dxfattribs=a)
    m.add_lwpolyline([(100, 75), (180, 75)], dxfattribs=b)
    m.add_lwpolyline([(168, 82), (180, 75), (168, 68)], dxfattribs=b)
    m.add_lwpolyline([(100, 75), (100, 140), (135, 140)], dxfattribs=b)
    m.add_line((100, 112), (125, 112), dxfattribs=b)
    _hatch(m, _rect(140, 95, 190, 140), layer="B")
    lay = _layout(c)
    sc = 180 / 200
    left = _vp(lay, center=LEFT[0], size=LEFT[1], scale=sc)
    right = _vp(lay, center=RIGHT[0], size=RIGHT[1], scale=sc)
    return lay, left, right


def _freeze_overrides(s: SuiteBuilder) -> None:
    c = s.case(
        "vpfreeze",
        "Two viewports of the same model; the left one freezes layer A via VIEWPORT 331",
        tags=["VIEWPORT", "frozen-layers"],
        questions=["Q-0718"],
    )
    lay, left, right = _two_vp_model(c)
    left.frozen_layers = ["A"]
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    c = s.case(
        "vpfreeze-both-globally-off",
        "Left viewport freezes layer A, layer B is globally off: left shows nothing, right only A",
        tags=["VIEWPORT", "frozen-layers", "layer-off"],
        questions=["Q-0718"],
    )
    lay, left, right = _two_vp_model(c)
    left.frozen_layers = ["A"]
    c.doc.layers.get("B").off()
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    overrides = [
        ("color-aci", "colour ACI 1 (layer colour 5)", {"color": 5}, lambda o, h: o.set_color(h, 1), "acad.ctb", None),
        ("color-rgb", "true colour (255,128,0) (layer colour 5)", {"color": 5}, lambda o, h: o.set_rgb(h, (255, 128, 0)), "acad.ctb", None),
        ("lineweight", "lineweight 1.00 mm (layer lineweight 0)", {}, lambda o, h: o.set_lineweight(h, 100), "monochrome.ctb", None),
        ("linetype", "linetype DASHED (layer Continuous)", {}, lambda o, h: o.set_linetype(h, "DASHED"), "monochrome.ctb", None),
        ("transparency", "transparency 60% (layer opaque); PLOTTRANSPARENCYOVERRIDE 2", {"color": 5}, lambda o, h: o.set_transparency(h, 0.6), "acad.ctb", {"PLOTTRANSPARENCYOVERRIDE": 2}),
    ]
    for name, desc, layer_kw, apply, style, sysvars in overrides:
        c = s.case(
            f"vpoverride-{name}",
            f"Per-viewport layer override (layer xdict XRECORD) for layer B in the right viewport only: {desc}",
            tags=["VIEWPORT", "layer-override", name],
            questions=["Q-0718"],
            style_table=style,
            params={"override": name},
        )
        lay, left, right = _two_vp_model(c)
        layer_b = c.doc.layers.get("B")
        if "color" in layer_kw:
            layer_b.dxf.color = layer_kw["color"]
        if name == "linetype":
            c.linetype("DASHED")
        ovr = layer_b.get_vp_overrides()
        apply(ovr, right.dxf.handle)
        ovr.commit()
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)
        if sysvars:
            _plot_extra(c, sysvars=sysvars)

    c = s.case(
        "vpoverride-all",
        "Right viewport: layer B colour 1 + lineweight 0.70 + DASHED + 50% transparency overrides; left viewport freezes layer A",
        tags=["VIEWPORT", "layer-override", "frozen-layers"],
        questions=["Q-0718"],
        style_table="acad.ctb",
    )
    lay, left, right = _two_vp_model(c)
    c.linetype("DASHED")
    layer_b = c.doc.layers.get("B")
    layer_b.dxf.color = 5
    ovr = layer_b.get_vp_overrides()
    h = right.dxf.handle
    ovr.set_color(h, 1)
    ovr.set_lineweight(h, 70)
    ovr.set_linetype(h, "DASHED")
    ovr.set_transparency(h, 0.5)
    ovr.commit()
    left.frozen_layers = ["A"]
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)
    _plot_extra(c, sysvars={"PLOTTRANSPARENCYOVERRIDE": 2})

    # layer flag 2 "frozen in new viewports"
    for where in ("model", "layout"):
        c = s.case(
            f"newvpfrozen-{where}",
            f"Layer NEWVP with 70 bit 2 (frozen in new viewports) holding the arrow/F; plotted from {where}",
            tags=["LAYER", "frozen-in-new-vp"],
            questions=["Q-0285"],
        )
        c.layer("NEWVP", color=7, lineweight=0)
        _target(c.msp)
        c.msp.add_lwpolyline([(20, 130), (80, 130), (80, 100)], dxfattribs={"layer": "NEWVP"})
        c.msp.add_circle((50, 115), 10, dxfattribs={"layer": "NEWVP"})
        c.doc.layers.get("NEWVP").dxf.flags |= 2
        if where == "model":
            c.window((-10, -7.5), (210, 157.5))
        else:
            lay = _layout(c)
            _vp(lay)
            c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    # INSERT on a VP-frozen layer
    for frozen in ("L2", "L1"):
        c = s.case(
            f"insert-vpfreeze-{frozen.lower()}",
            f"INSERT on layer L2 of a block with children on layer 0 (square), L1 (circle) and L2 (cross); left viewport freezes {frozen}",
            tags=["VIEWPORT", "frozen-layers", "INSERT"],
            questions=["Q-0620", "Q-0718"],
        )
        c.layer("L1", color=7, lineweight=0)
        c.layer("L2", color=7, lineweight=0)
        blk = c.doc.blocks.new("BLK")
        blk.add_lwpolyline(_rect(-60, -60, 60, 60), close=True, dxfattribs={"layer": "0"})
        blk.add_circle((0, 0), 45, dxfattribs={"layer": "L1"})
        blk.add_line((-30, 0), (30, 0), dxfattribs={"layer": "L2"})
        blk.add_line((0, -30), (0, 30), dxfattribs={"layer": "L2"})
        c.msp.add_blockref("BLK", TC, dxfattribs={"layer": "L2"})
        c.msp.add_lwpolyline(_rect(0, 0, 200, 150), close=True)
        lay = _layout(c)
        sc = 180 / 200
        left = _vp(lay, center=LEFT[0], size=LEFT[1], scale=sc)
        _vp(lay, center=RIGHT[0], size=RIGHT[1], scale=sc)
        left.frozen_layers = [frozen]
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    # VIEWPORT entity on an off / frozen layer
    for state in ("off", "frozen"):
        c = s.case(
            f"vp-on-{state}-layer",
            f"Left VIEWPORT on a {state} layer, right VIEWPORT on a normal layer (content hidden? frame hidden?)",
            tags=["VIEWPORT", "layer-" + state, "frame"],
            questions=["Q-0715", "Q-0716"],
        )
        _target(c.msp)
        lay = _layout(c)
        c.layer("VPX", color=7, lineweight=0, on=(state != "off"), frozen=(state == "frozen"))
        sc = 180 / 200
        _vp(lay, center=LEFT[0], size=LEFT[1], scale=sc, layer="VPX")
        _vp(lay, center=RIGHT[0], size=RIGHT[1], scale=sc)
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)


# --- frames -----------------------------------------------------------------------------------


def _frames(s: SuiteBuilder) -> None:
    c = s.case(
        "frame-layer-props",
        "Left VIEWPORT on layer colour 1 / lineweight 0.50 / DASHED; right VIEWPORT with entity colour 3, lineweight 1.00, DASHDOT",
        tags=["VIEWPORT", "frame", "linetype", "lineweight"],
        questions=["Q-0716"],
        style_table="acad.ctb",
    )
    _target(c.msp)
    lay = _layout(c)
    c.layer("VPRED", color=1, lineweight=50, linetype="DASHED")
    c.linetype("DASHDOT")
    sc = 180 / 200
    _vp(lay, center=LEFT[0], size=LEFT[1], scale=sc, layer="VPRED")
    _vp(lay, center=RIGHT[0], size=RIGHT[1], scale=sc, color=3, lineweight=100, linetype="DASHDOT")
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    for name, layer, kw in (("noplot", "VPNOPLOT", {"plot": False}), ("defpoints", "Defpoints", None)):
        c = s.case(
            f"frame-{name}",
            f"Left VIEWPORT on {'a no-plot (290=0) layer' if name == 'noplot' else 'layer Defpoints'}, right on a plottable layer (frame omitted, content plotted?)",
            tags=["VIEWPORT", "frame", name],
            questions=["Q-0716"],
        )
        _target(c.msp)
        lay = _layout(c)
        if kw is not None:
            c.layer(layer, color=7, lineweight=0, **kw)
        sc = 180 / 200
        _vp(lay, center=LEFT[0], size=LEFT[1], scale=sc, layer=layer)
        _vp(lay, center=RIGHT[0], size=RIGHT[1], scale=sc)
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    for bit in (0, 1):
        c = s.case(
            f"frame-plotflag-bit1-{bit}",
            f"LAYOUT 70 bit 1 (PlotViewportBorders) = {bit}; viewport on a plottable layer",
            tags=["VIEWPORT", "frame", "PLOTSETTINGS"],
            questions=["Q-0717"],
            params={"plot_viewport_borders": bit},
        )
        lay, vp = _std(c, 0.9)
        lay.plot_viewport_borders(bool(bit))


# --- linetype scaling -------------------------------------------------------------------------


STRIPS = [(255.0, 1.0), (175.0, 0.25), (95.0, 0.1)]


def _ltype_layout(c: Case, layout: str = "Layout1", celtscale: float = 1.0, lay=None):
    """Three strip viewports (1:1, 1:4, 1:10) on one long DASHED model LINE (y=0), a paper-space
    DASHED LINE at y=30 and a continuous paper LINE at y=36 as reference."""
    c.linetype("DASHED")
    if not c.msp.query("LINE"):
        c.msp.add_line((-5000, 0), (5000, 0), dxfattribs={"linetype": "DASHED", "ltscale": celtscale})
    if lay is None:
        lay = _layout(c, layout)
    for y, sc in STRIPS:
        _vp(lay, center=(200, y), size=(380, 70), scale=sc, view_center=(0, 0))
    lay.add_line((10, 30), (390, 30), dxfattribs={"layer": "PAPER", "linetype": "DASHED", "ltscale": celtscale})
    lay.add_line((10, 36), (390, 36), dxfattribs={"layer": "PAPER"})
    return lay


def _linetypes(s: SuiteBuilder) -> None:
    combos = [
        ("h1-l1", 1, 1, 1.0),
        ("h0-l0", 0, 0, 1.0),
        ("h1-l0", 1, 0, 1.0),
        ("h0-l1", 0, 1, 1.0),
        ("h1-l1-ltscale2", 1, 1, 2.0),
        ("h0-l0-ltscale2", 0, 0, 2.0),
    ]
    for name, hdr, flag, lts in combos:
        qs = ["Q-0315", "Q-0316"]
        if name == "h1-l1":
            qs.append("Q-0318")
        c = s.case(
            f"psltscale-{name}",
            f"DASHED model LINE through viewports 1:1 / 1:4 / 1:10 + paper DASHED LINE; $PSLTSCALE={hdr}, LAYOUT 70 bit 1={flag}, LTSCALE={lts}",
            tags=["VIEWPORT", "linetype", "PSLTSCALE", "LTSCALE"],
            questions=qs,
            header={"$PSLTSCALE": hdr, "$LTSCALE": lts},
            params={"psltscale_header": hdr, "layout_flag_bit1": flag, "ltscale": lts, "strips": STRIPS},
        )
        lay = _ltype_layout(c)
        lay.dxf_layout.dxf.layout_flags = (lay.dxf_layout.dxf.layout_flags & ~1) | flag
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)
    c = s.case(
        "psltscale-celtscale-05",
        "Same strips with entity linetype scale 48=0.5 on the model and paper DASHED LINEs (PSLTSCALE 1)",
        tags=["VIEWPORT", "linetype", "PSLTSCALE", "CELTSCALE"],
        questions=["Q-0315"],
    )
    _ltype_layout(c, celtscale=0.5)
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    # two layouts with different PSLTSCALE flags
    for plotted in ("Layout1", "Sheet2"):
        c = s.case(
            f"psltscale-two-layouts-{plotted.lower()}",
            f"Layout1 LAYOUT 70 bit1=1, Sheet2 bit1=0, header $PSLTSCALE=1; plot {plotted}; DXFOUT shows how the per-layout value is stored",
            tags=["LAYOUT", "linetype", "PSLTSCALE"],
            questions=["Q-0317", "Q-0316"],
            params={"plotted": plotted},
        )
        l1 = _ltype_layout(c)
        l1.dxf_layout.dxf.layout_flags |= 1
        l2 = _ltype_layout(c, "Sheet2")
        l2.dxf_layout.dxf.layout_flags &= ~1
        c.layout_window(plotted, WIN_MIN, WIN_MAX)


# --- draw order -------------------------------------------------------------------------------


def _draw_order(s: SuiteBuilder) -> None:
    def ps_over_vp(c: Case, flag512: Optional[bool] = None):
        m = c.msp
        _hatch(m, _rect(0, 0, 200, 150), color=5)  # blue model area
        m.add_lwpolyline(_rect(0, 0, 200, 150), close=True)
        lay = _layout(c)
        _vp(lay, center=(200, 150), size=(240, 180), scale=1.2)
        _hatch(lay, _rect(40, 100, 220, 200), color=1)  # red paper area overlapping the viewport corner
        lay.add_text("PAPER", height=14, dxfattribs={"insert": (50, 180), "color": 3})
        if flag512 is not None:
            lay.draw_viewports_first(flag512)
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)
        return lay

    for psf in (False, True):
        c = s.case(
            f"ps-over-vp-psfirst-{'y' if psf else 'n'}",
            f"Red paper-space solid HATCH overlapping a viewport showing a blue model solid HATCH; 'Plot paper space first?' {'Y' if psf else 'N'}",
            tags=["VIEWPORT", "draw-order", "HATCH"],
            questions=["Q-0714"],
            style_table="acad.ctb",
            params={"paperSpaceFirst": psf},
        )
        ps_over_vp(c)
        _plot_extra(c, paperSpaceFirst=psf)
    for bit in (0, 1):
        c = s.case(
            f"ps-over-vp-flag512-{bit}",
            f"Paper HATCH over viewport content with PLOTSETTINGS 70 bit 512 (DrawViewportsFirst) = {bit}; the log shows the default of 'Plot paper space first?'",
            tags=["VIEWPORT", "draw-order", "PLOTSETTINGS"],
            questions=["Q-0258"],
            style_table="acad.ctb",
            params={"flag512": bit},
        )
        ps_over_vp(c, bool(bit))

    for psf in (False, True):
        c = s.case(
            f"wipeout-over-vp-psfirst-{'y' if psf else 'n'}",
            f"Paper-space WIPEOUT overlapping a viewport that shows a model solid HATCH; 'Plot paper space first?' {'Y' if psf else 'N'}",
            tags=["VIEWPORT", "draw-order", "WIPEOUT"],
            questions=["Q-0294"],
            style_table="acad.ctb",
            params={"paperSpaceFirst": psf},
        )
        m = c.msp
        _hatch(m, _rect(0, 0, 200, 150), color=5)
        lay = _layout(c)
        _vp(lay, center=(200, 150), size=(240, 180), scale=1.2)
        lay.add_wipeout(_rect(60, 90, 240, 190))
        lay.add_lwpolyline(_rect(60, 90, 240, 190), close=True, dxfattribs={"layer": "PAPER", "color": 1})
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)
        _plot_extra(c, paperSpaceFirst=psf)

    # overlapping viewports
    for name, swap_order, statuses in (
        ("overlap-order-ab", False, (2, 3)),
        ("overlap-order-ba", True, (2, 3)),
        ("overlap-status-swapped", False, (3, 2)),
    ):
        c = s.case(
            f"vp-{name}",
            f"Two overlapping viewports A (red model hatch) and B (blue model hatch); entity order {'B,A' if swap_order else 'A,B'}, 68 A={statuses[0]} B={statuses[1]}",
            tags=["VIEWPORT", "draw-order", "overlap"],
            questions=["Q-0714"],
            style_table="acad.ctb",
            params={"entity_order": "BA" if swap_order else "AB", "status": statuses},
        )
        m = c.msp
        _hatch(m, _rect(0, 0, 200, 150), color=1)
        _hatch(m, _rect(1000, 0, 1200, 150), color=5)
        m.add_text("A", height=40, dxfattribs={"insert": (80, 55), "color": 7})
        m.add_text("B", height=40, dxfattribs={"insert": (1080, 55), "color": 7})
        lay = _layout(c)
        a = _vp(lay, center=(160, 170), size=(220, 165), scale=1.1)
        b = _vp(lay, center=(240, 130), size=(220, 165), scale=1.1, view_center=(1100, 75))
        a.dxf.status, b.dxf.status = statuses
        if swap_order:
            lay.entity_space.remove(a)
            lay.entity_space.add(a)
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)


# --- lineweights ------------------------------------------------------------------------------


def _lineweights(s: SuiteBuilder) -> None:
    c = s.case(
        "lineweight-vp-scale",
        "Model LINEs with lineweights 0.25/0.50/1.00/2.11 mm through viewports 1.2:1 (top) and 1:4 (bottom) + same lineweights in paper space (right)",
        tags=["VIEWPORT", "lineweight", "scale"],
        params={"lineweights": [25, 50, 100, 211]},
    )
    for i, lw in enumerate((25, 50, 100, 211)):
        y = 10 + 30 * i
        c.msp.add_line((0, y), (200, y), dxfattribs={"lineweight": lw})
        c.msp.add_line((0, y), (60, y + 25), dxfattribs={"lineweight": lw})
    lay = _layout(c)
    _vp(lay, center=(140, 220), size=(250, 140), scale=1.2, view_center=(100, 55))
    _vp(lay, center=(140, 80), size=(250, 120), scale=0.25, view_center=(100, 55))
    for i, lw in enumerate((25, 50, 100, 211)):
        y = 40 + 60 * i
        lay.add_line((290, y), (390, y), dxfattribs={"lineweight": lw})
        lay.add_line((290, y), (320, y + 40), dxfattribs={"lineweight": lw})
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)


# --- 3D view directions -----------------------------------------------------------------------


def _views3d(s: SuiteBuilder) -> None:
    dirs = [
        ("top", (0, 0, 1), 0),
        ("top-nonnormalized", (0, 0, 5), 0),
        ("bottom", (0, 0, -1), 0),
        ("se-iso", (1, -1, 1), 0),
        ("sw-iso", (-1, -1, 1), 0),
        ("ne-iso", (1, 1, 1), 0),
        ("nw-iso", (-1, 1, 1), 0),
        ("front", (0, -1, 0), 0),
        ("back", (0, 1, 0), 0),
        ("right", (1, 0, 0), 0),
        ("left", (-1, 0, 0), 0),
        ("near-back", (0, 1, 0.01), 0),
        ("se-iso-twist30", (1, -1, 1), 30),
        ("oblique", (2, -1, 0.5), 0),
        ("se-iso-nonnormalized", (100, -100, 100), 0),
    ]
    for name, d, tw in dirs:
        qs = ["Q-0722"]
        if name == "bottom":
            qs = ["Q-0723", "Q-0722"]
        if "nonnormalized" in name:
            qs.append("Q-0724")
        c = s.case(
            f"view3d-{name}",
            f"Viewport view direction 16={d}, twist {tw}: wire cube 0..60 with X (red) / Y (green) / Z (blue) axes and an F on the top face",
            tags=["VIEWPORT", "3d", "view-direction", "DCS"],
            questions=qs,
            style_table="acad.ctb",
            params={"direction": d, "twist": tw, "target": (30, 30, 30)},
        )
        _cube_axes(c.msp)
        lay = _layout(c)
        _vp(lay, scale=270 / 220, view_center=(0, 0), target=(30, 30, 30), direction=d, twist=tw)
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    c = s.case(
        "view3d-perspective",
        "Perspective viewport (90 bit 0x1), lens 42=50 mm, direction (300,-300,240) from target (30,30,30) (camera distance = |16|?)",
        tags=["VIEWPORT", "3d", "perspective"],
        questions=["Q-0725"],
        style_table="acad.ctb",
    )
    _cube_axes(c.msp)
    lay = _layout(c)
    vp = _vp(lay, scale=270 / 220, view_center=(0, 0), target=(30, 30, 30), direction=(300, -300, 240))
    vp.dxf.flags = vp.dxf.flags | 0x1
    vp.dxf.perspective_lens_length = 50
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    for name, flags in (("front-back", 0x2 | 0x4 | 0x10), ("front-at-eye-back", 0x2 | 0x4), ("back-only", 0x4)):
        c = s.case(
            f"clipplanes-{name}",
            f"Top-view viewport with front clip 43=20 / back clip 44=-20 (90 flags 0x{flags:x}); 11 model LINEs at z=-50..50",
            tags=["VIEWPORT", "3d", "clip-planes"],
            questions=["Q-0726"],
            params={"flags": flags, "front": 20, "back": -20, "z": [-50 + 10 * i for i in range(11)]},
        )
        for i in range(11):
            z = -50 + 10 * i
            y = 20 + 11 * i
            c.msp.add_line((30, y, z), (170, y, z))
            c.msp.add_text(f"{z}", height=6, dxfattribs={"insert": (175, y - 3, 0)})
        c.msp.add_lwpolyline(_rect(0, 0, 200, 150), close=True)
        lay = _layout(c)
        vp = _vp(lay, scale=1.0, view_center=(0, 0), target=(100, 75, 0))
        vp.dxf.flags = vp.dxf.flags | flags
        vp.dxf.front_clip_plane_z_value = 20
        vp.dxf.back_clip_plane_z_value = -20
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    c = s.case(
        "ucs-per-viewport",
        "Viewport with its own rotated UCS (71=1, origin (50,50), X axis (0,1,0)) and elevation 146=20: no display effect expected",
        tags=["VIEWPORT", "UCS"],
    )
    lay, vp = _std(c, 1.0)
    vp.dxf.ucs_per_viewport = 1
    vp.dxf.ucs_origin = (50, 50, 0)
    vp.dxf.ucs_x_axis = (0, 1, 0)
    vp.dxf.ucs_y_axis = (-1, 0, 0)
    vp.dxf.elevation = 20


# --- paper-space content ----------------------------------------------------------------------


def _paper_content(s: SuiteBuilder) -> None:
    c = s.case(
        "paper-text",
        "TEXT (heights 5/10/20 mm, rotated) and MTEXT in paper space next to a 1:2 viewport",
        tags=["TEXT", "MTEXT", "paperspace"],
    )
    _target(c.msp)
    lay = _layout(c)
    _vp(lay, center=(270, 150), size=(220, 165), scale=0.5 * 220 / 270 * 1.3)
    lay.add_text("Paper 5 mm", height=5, dxfattribs={"insert": (15, 260)})
    lay.add_text("Paper 10 mm", height=10, dxfattribs={"insert": (15, 230)})
    lay.add_text("Hg 20", height=20, dxfattribs={"insert": (15, 190)})
    lay.add_text("rotated 30", height=10, dxfattribs={"insert": (20, 110), "rotation": 30})
    mt = lay.add_mtext("MTEXT in paper\\Psecond line", dxfattribs={"insert": (15, 70), "char_height": 7, "width": 130})
    mt.dxf.attachment_point = 1
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    c = s.case(
        "paper-hatch",
        "ANSI31 HATCH (scale 1 and 3, paper units), solid HATCH and a DASHED LINE in paper space",
        tags=["HATCH", "paperspace", "linetype"],
    )
    lay = _layout(c)
    c.linetype("DASHED")
    _hatch(lay, _rect(20, 160, 180, 280), pattern="ANSI31", pscale=1.0)
    _hatch(lay, _rect(220, 160, 380, 280), pattern="ANSI31", pscale=3.0, angle=0)
    _hatch(lay, _rect(20, 40, 180, 140))
    lay.add_line((220, 90), (380, 90), dxfattribs={"linetype": "DASHED"})
    lay.add_lwpolyline(_rect(20, 160, 180, 280), close=True)
    lay.add_lwpolyline(_rect(220, 160, 380, 280), close=True)
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)


# --- plot area "layout", limits, paper origin -------------------------------------------------


def _origin_marks(c: Case, lay, w: float, h: float, unit: float = 1.0) -> None:
    """Cross at paper-space (0,0), boxes at the stored LIMMIN/LIMMAX, a border at the limits."""
    k = 10 * unit
    lay.add_line((-k, 0), (k, 0))
    lay.add_line((0, -k), (0, k))
    lay.add_circle((0, 0), k / 2)
    lmin = lay.dxf_layout.dxf.limmin
    lmax = lay.dxf_layout.dxf.limmax
    lay.add_lwpolyline([(lmin[0], lmin[1]), (lmax[0], lmin[1]), (lmax[0], lmax[1]), (lmin[0], lmax[1])], close=True)
    lay.add_lwpolyline(_rect(lmax[0] - 2 * k, lmax[1] - 2 * k, lmax[0] - k, lmax[1] - k), close=True)
    lay.add_text("UR", height=k, dxfattribs={"insert": (lmax[0] - 5 * k, lmax[1] - 2.2 * k)})
    lay.add_text("0,0", height=k, dxfattribs={"insert": (k, k)})


def _plot_area(s: SuiteBuilder) -> None:
    variants = [
        ("mm", {}, "400x300 mm, zero margins, no offset"),
        ("mm-margins-offset", {"margins": (10, 20, 30, 40), "offset": (15, 25)}, "400x300 mm, margins t10 r20 b30 l40, offset 46/47 = (15,25)"),
        ("inch", {"size": (16, 12), "units": "inch"}, "16x12 inch (72=0)"),
        ("inch-margins-offset", {"size": (16, 12), "units": "inch", "margins": (0.5, 1, 1.5, 2), "offset": (0.25, 0.75)}, "16x12 inch, margins and offset"),
    ]
    for name, kw, desc in variants:
        for area in ("layout", "window"):
            c = s.case(
                f"area-{area}-{name}",
                f"Layout {desc}: marks at paper (0,0) and LIMMIN/LIMMAX; plot area {area}",
                tags=["LAYOUT", "plot-area", "PLOTSETTINGS", "limits"],
                questions=["Q-0705"],
                params={"page": kw, "area": area},
            )
            _target(c.msp)
            size = kw.get("size", PAPER)
            unit = 1.0 if kw.get("units", "mm") == "mm" else 1 / 25.4
            lay = _layout(c, border=False, **kw)
            _origin_marks(c, lay, size[0], size[1], unit)
            w, h = size
            _vp(lay, center=(w / 2, h / 2), size=(w * 0.6, h * 0.6), scale=w * 0.6 / 300)
            if area == "layout":
                c.plot_layout("Layout1")
            else:
                lmin = lay.dxf_layout.dxf.limmin
                x0, y0 = lmin[0], lmin[1]
                # window around the limits with the canvas aspect (limits are 4:3 here)
                c.layout_window("Layout1", (x0, y0), (x0 + w, y0 + h))

    # rotations: stored 73 (log defaults for orientation/upside-down; DXFOUT limits)
    for rot in (1, 2, 3):
        c = s.case(
            f"area-layout-rotation-{rot}",
            f"Layout 400x300 mm with asymmetric margins (t10 r20 b30 l40) and plot rotation 73={rot}; plot area layout (harness forces Landscape)",
            tags=["LAYOUT", "plot-area", "PLOTSETTINGS", "rotation"],
            questions=["Q-0253", "Q-0706"],
            params={"rotation": rot},
        )
        _target(c.msp)
        lay = _layout(c, border=False, margins=(10, 20, 30, 40), rotation=rot)
        _origin_marks(c, lay, 400, 300)
        _vp(lay, center=(200, 150), size=(240, 180), scale=0.8)
        c.plot_layout("Layout1")

    # bogus limits
    for area in ("layout", "window"):
        c = s.case(
            f"bogus-limits-{area}",
            f"LAYOUT limits (0,0)-(12,9) (Revit-style) while the viewports lie far outside; plot area {area}",
            tags=["LAYOUT", "limits", "plot-area"],
            questions=["Q-0121"],
        )
        _target(c.msp)
        lay = _layout(c)
        _vp(lay, center=(110, 150), size=(180, 135), scale=0.8)
        _vp(lay, center=(300, 150), size=(160, 120), scale=0.5)
        lay.dxf_layout.dxf.limmin = (0, 0)
        lay.dxf_layout.dxf.limmax = (12, 9)
        lay.add_lwpolyline(_rect(0, 0, 12, 9), close=True, dxfattribs={"layer": "PAPER"})
        if area == "layout":
            c.plot_layout("Layout1")
        else:
            c.layout_window("Layout1", WIN_MIN, WIN_MAX)


# --- stored page setup values (log defaults / DXFOUT) -----------------------------------------


def _pagesetup(s: SuiteBuilder) -> None:
    def base(c: Case, **kw):
        lay, vp = _std(c, 0.9, **kw)
        return lay, lay.dxf_layout.dxf

    for flags in (688, 176, 688 | 4, 688 | 8, 688 | 64):
        c = s.case(
            f"pagesetup-flags-{flags}",
            f"PLOTSETTINGS 70 = {flags} (bits: 512 DrawViewportsFirst, 4 centered, 8 hide, 64 scale lw); log shows the -PLOT defaults",
            tags=["PLOTSETTINGS", "flags"],
            questions=["Q-0258"],
            params={"plot_layout_flags": flags},
        )
        lay, d = base(c)
        d.plot_layout_flags = flags

    for rot in (0, 1, 2, 3):
        c = s.case(
            f"pagesetup-rotation-{rot}",
            f"PLOTSETTINGS 73 = {rot}; log defaults of 'drawing orientation' and 'Plot upside down'",
            tags=["PLOTSETTINGS", "rotation"],
            questions=["Q-0253"],
            params={"plot_rotation": rot},
        )
        lay, d = base(c)
        d.plot_rotation = rot

    for ptype in range(6):
        c = s.case(
            f"pagesetup-plottype-{ptype}",
            f"PLOTSETTINGS 74 = {ptype} with window 48/49=(10,20) 140/141=(300,200); log default plot area / window corners",
            tags=["PLOTSETTINGS", "plot-type", "plot-window"],
            questions=["Q-0254", "Q-0258"],
            params={"plot_type": ptype, "window": [(10, 20), (300, 200)]},
        )
        lay, d = base(c)
        d.plot_type = ptype
        d.plot_window_x1, d.plot_window_y1 = 10, 20
        d.plot_window_x2, d.plot_window_y2 = 300, 200

    for name, units, std, num_den, uf in (
        ("mm-std-1-1", 1, 16, (1, 1), 1.0),
        ("mm-std-1-50", 1, 25, (1, 50), 1.0),
        ("inch-std-1-1", 0, 16, (1, 1), 1 / 25.4),
        ("inch-std-1-50", 0, 25, (1, 50), 1 / 25.4),
        ("mm-custom-1-3-spec147", 1, 16, (1, 3), 1 / 3),
    ):
        c = s.case(
            f"pagesetup-scale-{name}",
            f"PLOTSETTINGS 72={units}, standard scale 75={std} (bit 16 set), 142/143={num_den}, 147={uf:.6g}; DXFOUT shows AutoCAD's 147",
            tags=["PLOTSETTINGS", "scale", "units"],
            questions=["Q-0255"],
            params={"units": units, "std_scale": std, "custom": num_den, "147": uf},
        )
        lay, d = base(c)
        d.plot_paper_units = units
        d.standard_scale_type = std
        d.scale_numerator, d.scale_denominator = num_den
        d.unit_factor = uf
        d.plot_layout_flags = d.plot_layout_flags | 16

    c = s.case(
        "pagesetup-image-origin",
        "PLOTSETTINGS 148/149 (paper image origin) = (5,7), 46/47 = (12,8); DXFOUT/log",
        tags=["PLOTSETTINGS"],
        questions=["Q-0256"],
    )
    lay, d = base(c)
    d.paper_image_origin_x, d.paper_image_origin_y = 5, 7
    d.plot_origin_x_offset, d.plot_origin_y_offset = 12, 8

    c = s.case(
        "pagesetup-plottransparency",
        "LAYOUT XDATA PLOTTRANSPARENCY 1071=1 and a 50% transparent paper HATCH (PLOTTRANSPARENCYOVERRIDE 0 = never)",
        tags=["PLOTSETTINGS", "transparency"],
        questions=["Q-0258"],
        style_table="acad.ctb",
    )
    lay, d = base(c)
    if "PLOTTRANSPARENCY" not in c.doc.appids:
        c.doc.appids.new("PLOTTRANSPARENCY")
    lay.dxf_layout.set_xdata("PLOTTRANSPARENCY", [(1071, 1)])
    h = _hatch(lay, _rect(40, 40, 200, 160), color=1)
    h.transparency = 0.5

    c = s.case(
        "pagesetup-truedxf-png",
        "Page setup naming the harness device truedxf PNG.pc3 with a guessed raster media name, 72=2, 44/45=508x381; DXFOUT shows what AutoCAD keeps",
        tags=["PLOTSETTINGS", "raster", "device"],
        questions=["Q-0250", "Q-0251", "Q-0252"],
    )
    lay, d = base(c)
    d.plot_configuration_file = "truedxf PNG.pc3"
    d.paper_size = "truedxf_2000x1500_(2000.00_x_1500.00_Pixels)"
    d.plot_paper_units = 2
    d.paper_width, d.paper_height = 508.0, 381.0
    d.current_style_sheet = "monochrome.ctb"
    c.notes.append("The harness does not save the page setup (Save changes = N); this only shows how AutoCAD normalises a stored raster page setup on load.")

    c = s.case(
        "pagesetup-style-sheet",
        "PLOTSETTINGS 7 = acad.ctb stored, harness plots with monochrome.ctb (log default of the style-table prompt)",
        tags=["PLOTSETTINGS", "plotstyle"],
        questions=["Q-0258"],
    )
    lay, d = base(c)
    d.current_style_sheet = "acad.ctb"


# --- extents (model space, plot area Extents) -------------------------------------------------


def _extents(s: SuiteBuilder) -> None:
    def base(c: Case) -> None:
        c.msp.add_lwpolyline(_rect(0, 0, 100, 75), close=True)
        c.msp.add_line((0, 0), (100, 75))

    def case(name, title, qs, **kw):
        c = s.case(f"extents-{name}", f"Extents plot (model): {title}", tags=["extents"] + kw.pop("tags", []), questions=qs, **kw)
        c.notes.append("Core writes $EXTMIN/$EXTMAX from ezdxf's bounding box (includes every entity); DXFOUT shows AutoCAD's values.")
        return c

    c = case("invisible", "base box + far LINE with 60=1 (invisible) to (300,200)", ["Q-0107"], tags=["LINE", "invisible"])
    base(c)
    c.msp.add_line((100, 75), (300, 200), dxfattribs={"invisible": 1})
    c.plot_extents()

    c = case("3dface-invisible-edges", "3DFACE whose far vertex (300,200) lies only on invisible edges 3 and 4", ["Q-0108"], tags=["3DFACE"])
    base(c)
    f = c.msp.add_3dface([(0, 0), (100, 0), (100, 75), (300, 200)])
    f.dxf.invisible_edges = 4 | 8
    c.plot_extents()

    c = case("polyface-invisible-edges", "polyface face whose far vertex (300,200) lies only on invisible edges", ["Q-0108"], tags=["POLYLINE", "polyface"])
    base(c)
    pf = c.msp.add_polyface()
    pf.append_face([(0, 0, 0), (100, 0, 0), (100, 75, 0), (300, 200, 0)])
    rec = [e for e in pf.vertices if e.is_face_record][0]
    rec.dxf.vtx2 = -abs(rec.dxf.vtx2)  # edge v2->v3 invisible
    rec.dxf.vtx3 = -abs(rec.dxf.vtx3)  # edge v3->v0 invisible
    c.plot_extents()

    for state in ("off", "frozen", "noplot"):
        c = case(f"layer-{state}", f"base box + far LINE to (300,200) on a {state} layer", ["Q-0109"], tags=["LAYER", state])
        base(c)
        c.layer("FAR", color=7, lineweight=0, on=(state != "off"), frozen=(state == "frozen"), plot=(state != "noplot"))
        c.msp.add_line((100, 75), (300, 200), dxfattribs={"layer": "FAR"})
        c.plot_extents()

    c = case("defpoints", "base box + far LINE and POINT on layer Defpoints", ["Q-0110"], tags=["Defpoints"])
    base(c)
    c.msp.add_line((100, 75), (300, 200), dxfattribs={"layer": "Defpoints"})
    c.msp.add_point((-150, -100), dxfattribs={"layer": "Defpoints"})
    c.plot_extents()

    c = case("dimension-defpoint", "linear DIMENSION with suppressed extension lines whose defpoints lie far below (y=-300)", ["Q-0110"], tags=["DIMENSION", "Defpoints"])
    base(c)
    dim = c.msp.add_linear_dim(base=(10, 60), p1=(10, -300), p2=(90, -300), dimstyle="Standard", override={"dimse1": 1, "dimse2": 1, "dimtxt": 5, "dimasz": 4, "dimexe": 0, "dimexo": 0})
    dim.render()
    c.plot_extents()

    c = case("thickness", "LINE (0,0)-(0,75) with extrusion (1,0,0) and thickness 100 (plan shows a 100x75 face)", ["Q-0113"], tags=["LINE", "thickness", "ocs"])
    c.msp.add_line((0, 0, 0), (0, 75, 0), dxfattribs={"extrusion": (1, 0, 0), "thickness": 100})
    c.msp.add_circle((50, 37.5), 5)
    c.plot_extents()

    c = case("lineweight", "single horizontal LINE 100 long with lineweight 2.11 mm", ["Q-0114"], tags=["LINE", "lineweight"])
    c.msp.add_line((0, 0), (100, 0), dxfattribs={"lineweight": 211})
    c.plot_extents()

    c = case("wide-pline", "L-shaped LWPOLYLINE (0,0)-(100,0)-(100,75) with constant width 20", ["Q-0115"], tags=["LWPOLYLINE", "width"])
    c.msp.add_lwpolyline([(0, 0), (100, 0), (100, 75)], dxfattribs={"const_width": 20})
    c.plot_extents()

    for name, txt in (("text-xxx", "xxx"), ("text-hgy", "Hgy")):
        c = case(name, f"single TEXT '{txt}' height 10 (Liberation Sans)", ["Q-0116"], tags=["TEXT"])
        c.msp.add_text(txt, height=10, dxfattribs={"insert": (0, 0)})
        c.plot_extents()

    c = case("spline-control", "cubic SPLINE with one far-out control point (curve stays far below it)", ["Q-0117"], tags=["SPLINE"])
    c.msp.add_open_spline([(0, 0), (30, 0), (50, 300), (70, 0), (100, 0)], degree=3)
    c.plot_extents()

    c = case("hatch-pattern", "ANSI31 HATCH (scale 20) in a 100x75 boundary with no boundary entity", ["Q-0118"], tags=["HATCH"])
    _hatch(c.msp, _rect(0, 0, 100, 75), pattern="ANSI31", pscale=20.0)
    c.plot_extents()


# --- misc -------------------------------------------------------------------------------------


def _misc(s: SuiteBuilder) -> None:
    for maxact in (64, 2):
        c = s.case(
            f"maxactvp-{maxact}",
            f"70 viewports (10x7 grid) each showing the model target, $MAXACTVP={maxact}: are all plotted?",
            tags=["VIEWPORT", "MAXACTVP"],
            questions=["Q-0713"],
            header={"$MAXACTVP": maxact},
        )
        _target(c.msp)
        lay = _layout(c)
        for r in range(7):
            for k in range(10):
                cx = 20 + 40 * k
                cy = 280 - 40 * r - 5
                _vp(lay, center=(cx, cy), size=(36, 27), scale=27 / 165)
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)

    c = s.case(
        "vp-plotstyle-name",
        "Viewport with group 1 (plot style sheet) = monochrome.ctb, layout plotted with acad.ctb; coloured model HATCHes",
        tags=["VIEWPORT", "plotstyle"],
        questions=["Q-0719"],
        style_table="acad.ctb",
    )
    for i, col in enumerate((1, 2, 3, 4, 5, 6)):
        _hatch(c.msp, _rect(10 + 30 * i, 40, 35 + 30 * i, 110), color=col)
    c.msp.add_lwpolyline(_rect(0, 0, 200, 150), close=True, dxfattribs={"color": 1})
    lay = _layout(c)
    sc = 180 / 200
    left = _vp(lay, center=LEFT[0], size=LEFT[1], scale=sc)
    left.dxf.plot_style_name = "monochrome.ctb"
    _vp(lay, center=RIGHT[0], size=RIGHT[1], scale=sc)
    c.layout_window("Layout1", WIN_MIN, WIN_MAX)


# --- random -----------------------------------------------------------------------------------


def _random(s: SuiteBuilder) -> None:
    cells = [((105, 227.5), (190, 135)), ((295, 227.5), (190, 135)), ((105, 72.5), (190, 135)), ((295, 72.5), (190, 135))]
    for seed in range(1, 6):
        c = s.case(
            f"random-{seed:04d}",
            f"Random viewports (scale, twist, target, view centre) in a 2x2 grid, seed {seed}",
            tags=["VIEWPORT", "scale", "twist", "view-target"],
            questions=["Q-0720", "Q-0721"],
            seed=seed,
        )
        rng = c.rng
        _target(c.msp)
        lay = _layout(c)
        vps = []
        for center, size in cells:
            if rng.random() < 0.2:
                continue
            w = round(rng.uniform(0.6, 1.0) * size[0], 3)
            h = round(rng.uniform(0.6, 1.0) * size[1], 3)
            sc = round(rng.uniform(0.5, 1.0) * min(w / 220, h / 165), 4)
            tw = round(rng.choice([0, 0, rng.uniform(-180, 180)]), 3)
            tgt = (round(rng.uniform(0, 200), 3), round(rng.uniform(0, 150), 3), 0.0)
            # WCS view centre near the target figure centre under the ezdxf convention
            # (WCS centre = target + Rz(-twist) * vc  <=>  vc = Rz(+twist) * (centre - target))
            dx = TC[0] + rng.uniform(-20, 20) - tgt[0]
            dy = TC[1] + rng.uniform(-15, 15) - tgt[1]
            a = math.radians(tw)
            vc = (round(dx * math.cos(a) - dy * math.sin(a), 3), round(dx * math.sin(a) + dy * math.cos(a), 3))
            _vp(lay, center=center, size=(w, h), scale=sc, target=tgt, view_center=vc, twist=tw)
            vps.append({"center": center, "size": (w, h), "scale": sc, "twist": tw, "target": tgt, "view_center": vc})
        c.params["viewports"] = vps
        c.layout_window("Layout1", WIN_MIN, WIN_MAX)
