"""Model-space "Extents" plots: what counts for the plotted extents (note 03 §6, note 08 §5.1).

Every case plots area "extents". The header $EXTMIN/$EXTMAX are left at ezdxf's "empty" values
(+1e20/-1e20) unless the case is about stale header extents, so AutoCAD has to compute them; the
DXFOUT re-save shows AutoCAD's own $EXTMIN/$EXTMAX.
"""

from __future__ import annotations

from ezdxf.math import Vec3

from ..core import Case, SuiteBuilder, suite


def _base(c: Case) -> None:
    """Small reference geometry near the origin: a 20 x 10 rectangle."""
    c.keep_header_extents = True
    c.msp.add_lwpolyline([(0, 0), (20, 0), (20, 10), (0, 10)], close=True)


@suite("extents", "Plot area Extents: which geometry counts", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    # Q-0105: bogus / stale header extents
    for i, (emin, emax, note) in enumerate(
        [
            ((1e20, 1e20, 1e20), (-1e20, -1e20, -1e20), "empty (+1e20/-1e20)"),
            ((-500, -500, 0), (500, 500, 0), "too large (stale)"),
            ((5, 2, 0), (8, 4, 0), "too small (stale)"),
            ((100, 100, 0), (-100, -100, 0), "inverted"),
        ],
        1,
    ):
        c = s.case(f"header-extents-{i:04d}", f"Geometry at negative coordinates + XLINE; header extents {note}", tags=["extents", "header", "XLINE"], questions=["Q-0105"], params={"extmin": emin, "extmax": emax})
        c.keep_header_extents = True
        c.msp.add_circle((-60, -40), 20)
        c.msp.add_line((-90, -60), (-30, -20))
        if i == 1:
            c.msp.add_xline((-60, -40), (1, 0.5))
        c.msp.dxf.extmin = Vec3(emin)
        c.msp.dxf.extmax = Vec3(emax)
        c.plot_extents()

    probes = [
        ("invisible-entity", "far LINE with 60=1 (invisible)", ["Q-0107"]),
        ("invisible-3dface-edges", "3DFACE whose far vertex only touches invisible edges", ["Q-0108"]),
        ("layer-off", "far LINE on an OFF layer", ["Q-0109"]),
        ("layer-frozen", "far LINE on a FROZEN layer", ["Q-0109"]),
        ("layer-defpoints", "far LINE and POINT on DEFPOINTS", ["Q-0110"]),
        ("layer-noplot", "far LINE on a no-plot layer", ["Q-0111"]),
        ("thickness", "LINE with thickness 50 along (1,0,0)", ["Q-0113"]),
        ("lineweight", "LINE with lineweight 2.11 mm", ["Q-0114"]),
        ("wide-polyline", "LWPOLYLINE with constant width 20", ["Q-0115"]),
        ("text-xxx", "TEXT 'xxx' (no ascenders/descenders)", ["Q-0116"]),
        ("text-hgy", "TEXT 'Hgy' (ascender + descender)", ["Q-0116"]),
        ("spline-control-hull", "SPLINE with one far-out control point", ["Q-0117"]),
        ("hatch-pattern", "large-scale ANSI31 HATCH without boundary entity", ["Q-0118"]),
        ("dimension-defpoint", "DIMENSION (rendered *D block) with far definition points", ["Q-0110"]),
    ]
    for name, desc, qs in probes:
        c = s.case(f"probe-{name}", f"Extents plot: reference rectangle + {desc}", tags=["extents"], questions=qs, params={"probe": name})
        _base(c)
        m = c.msp
        if name == "invisible-entity":
            m.add_line((100, 60), (120, 80), dxfattribs={"invisible": 1})
        elif name == "invisible-3dface-edges":
            # vertex 3 is far away; edges 2-3 and 3-4 invisible (bits 2 and 4)
            m.add_3dface([(0, 20, 0), (20, 20, 0), (120, 90, 0), (0, 30, 0)], dxfattribs={"invisible_edges": 2 | 4})
        elif name == "layer-off":
            c.layer("OFF", on=False)
            m.add_line((100, 60), (120, 80), dxfattribs={"layer": "OFF"})
        elif name == "layer-frozen":
            c.layer("FROZEN", frozen=True)
            m.add_line((100, 60), (120, 80), dxfattribs={"layer": "FROZEN"})
        elif name == "layer-defpoints":
            m.add_line((100, 60), (120, 80), dxfattribs={"layer": "Defpoints"})
            m.add_point((-80, -50), dxfattribs={"layer": "Defpoints"})
        elif name == "layer-noplot":
            c.layer("NOPLOT", plot=False)
            m.add_line((100, 60), (120, 80), dxfattribs={"layer": "NOPLOT"})
        elif name == "thickness":
            m.add_line((10, 20), (10, 30), dxfattribs={"thickness": 50, "extrusion": (1, 0, 0)})
        elif name == "lineweight":
            m.add_line((0, 20), (20, 20), dxfattribs={"lineweight": 211})
        elif name == "wide-polyline":
            m.add_lwpolyline([(0, 30), (20, 30)], dxfattribs={"const_width": 20})
        elif name.startswith("text"):
            m.add_text("xxx" if name.endswith("xxx") else "Hgy", height=10, dxfattribs={"insert": (0, 15)})
        elif name == "spline-control-hull":
            m.add_open_spline([(0, 15), (10, 15), (60, 120), (20, 15), (30, 15)], degree=3)
        elif name == "hatch-pattern":
            h = m.add_hatch()
            h.set_pattern_fill("ANSI31", scale=10)
            h.paths.add_polyline_path([(0, 15), (20, 15), (20, 35), (0, 35)], is_closed=True, flags=1)
        elif name == "dimension-defpoint":
            d = m.add_linear_dim(base=(0, 25), p1=(0, 12), p2=(20, 12))
            d.render()
            # a second, far-away DIMENSION on layer Defpoints: its *D block content (layer 0) and
            # its defpoint POINTs are not plotted - do they still count for the extents?
            d2 = m.add_linear_dim(base=(0, -5), p1=(120, 90), p2=(121, 90), dxfattribs={"layer": "Defpoints"})
            d2.render()
        c.plot_extents()
