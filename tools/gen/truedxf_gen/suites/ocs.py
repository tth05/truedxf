"""OCS / extrusion / elevation / thickness (note 03 §2). Plan-view plots of OCS entities."""

from __future__ import annotations

import math

from ezdxf.math import OCS, Vec3

from ..core import SuiteBuilder, TextEntityAlignment, suite

NORMALS = {
    "z": (0, 0, 1),
    "negz": (0, 0, -1),
    "tilt-y45": (0, -1, 1),
    "tilt-x30": (math.sin(math.radians(30)), 0, math.cos(math.radians(30))),
    "small": (0.01, 0.01, 1),  # |Nx|,|Ny| < 1/64: arbitrary-axis 'Wy' branch
    "threshold": (1 / 64, 0.0, 1),  # right at the 1/64 threshold
    "near-threshold": (0.0157, 0.0, 0.99988),
    "edge-on": (1, 0, 0),
    "unnormalised": (0, 0, -5),
    "skew": (0.3, -0.4, 0.866),
}


def _place(ocs: OCS, wcs_center: Vec3) -> Vec3:
    """OCS point whose WCS image is ``wcs_center`` (so entities land in the window)."""
    return ocs.from_wcs(wcs_center)


@suite("ocs", "Extrusion vectors, elevation and thickness (plan view)", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    center = Vec3(100, 75, 0)
    for key, n in NORMALS.items():
        ocs = OCS(n)
        # CIRCLE + ARC
        c = s.case(f"circle-{key}", f"CIRCLE r=40 and ARC r=25 0..120 with extrusion {n}", tags=["CIRCLE", "ARC", "OCS"], params={"extrusion": n})
        p = _place(ocs, center)
        c.msp.add_circle(p, 40, dxfattribs={"extrusion": n})
        c.msp.add_arc(p, 25, 0, 120, dxfattribs={"extrusion": n})
        c.msp.add_line((95, 75), (105, 75))
        c.msp.add_line((100, 70), (100, 80))
        c.window((0, 0), (200, 150))
        # LWPOLYLINE with bulge and elevation
        c = s.case(f"lwpolyline-{key}", f"LWPOLYLINE with bulges, elevation 5, extrusion {n}", tags=["LWPOLYLINE", "OCS", "elevation"], params={"extrusion": n})
        p = _place(ocs, center)
        pts = [(p.x - 40, p.y - 30, 0, 0, 0), (p.x + 40, p.y - 30, 0, 0, 0.5), (p.x + 40, p.y + 30, 0, 0, 0), (p.x - 40, p.y + 30, 0, 0, -0.3)]
        c.msp.add_lwpolyline(pts, format="xyseb", close=True, dxfattribs={"extrusion": n, "elevation": p.z})
        c.window((0, 0), (200, 150))
        # SOLID + TRACE (OCS corners)
        c = s.case(f"solid-{key}", f"SOLID and TRACE with extrusion {n}", tags=["SOLID", "TRACE", "OCS"], params={"extrusion": n})
        p = _place(ocs, center)
        c.msp.add_solid([(p.x - 50, p.y - 20, p.z), (p.x - 10, p.y - 20, p.z), (p.x - 50, p.y + 20, p.z), (p.x - 10, p.y + 30, p.z)], dxfattribs={"extrusion": n})
        c.msp.add_trace([(p.x + 10, p.y - 20, p.z), (p.x + 50, p.y - 20, p.z), (p.x + 10, p.y + 20, p.z), (p.x + 50, p.y + 20, p.z)], dxfattribs={"extrusion": n})
        c.window((0, 0), (200, 150))
        # TEXT (OCS insertion + rotation)
        c = s.case(f"text-{key}", f"TEXT 'OCS Fg' h=15 rot 10 with extrusion {n}", tags=["TEXT", "OCS"], params={"extrusion": n})
        p = _place(ocs, center)
        t = c.msp.add_text("OCS Fg", height=15, rotation=10, dxfattribs={"extrusion": n})
        t.set_placement(p, align=TextEntityAlignment.MIDDLE_CENTER)
        c.window((0, 0), (200, 150))
        # ELLIPSE is WCS (extrusion only defines the plane) - include for contrast
        c = s.case(f"ellipse-{key}", f"ELLIPSE (WCS centre) with extrusion {n}", tags=["ELLIPSE", "OCS"], params={"extrusion": n})
        nz = Vec3(n).normalize()
        major = ocs.to_wcs(Vec3(50, 0, 0))  # OCS x axis: perpendicular to the extrusion
        c.msp.add_ellipse(center, major_axis=major, ratio=0.5, dxfattribs={"extrusion": nz})
        c.window((0, 0), (200, 150))

    # INSERT with extrusion (block drawn in the OCS plane)
    for key in ("negz", "tilt-y45", "small", "skew"):
        n = NORMALS[key]
        ocs = OCS(n)
        c = s.case(f"insert-{key}", f"INSERT of an 'F' block with extrusion {n}", tags=["INSERT", "OCS"], params={"extrusion": n})
        blk = c.doc.blocks.new("F")
        blk.add_lwpolyline([(0, 0), (0, 60), (40, 60)])
        blk.add_line((0, 30), (25, 30))
        blk.add_circle((30, 10), 8)
        p = _place(ocs, Vec3(80, 45, 0))
        c.msp.add_blockref("F", p, dxfattribs={"extrusion": n, "rotation": 15})
        c.window((0, 0), (200, 150))

    # HATCH with extrusion (0,0,-1): OCS x negated (ezdxf#736)
    for key in ("z", "negz", "tilt-x30"):
        n = NORMALS[key]
        ocs = OCS(n)
        c = s.case(f"hatch-{key}", f"Solid HATCH (square + circle hole) with extrusion {n}", tags=["HATCH", "OCS"], params={"extrusion": n})
        p = _place(ocs, center)
        h = c.msp.add_hatch(color=1, dxfattribs={"extrusion": n, "elevation": (0, 0, p.z)})
        h.paths.add_polyline_path([(p.x - 40, p.y - 40), (p.x + 40, p.y - 40), (p.x + 40, p.y + 40), (p.x - 40, p.y + 40)], is_closed=True, flags=1)
        ep = h.paths.add_edge_path(flags=16)
        ep.add_arc((p.x + 10, p.y), 15, 0, 360)
        c.window((0, 0), (200, 150))

    # 2D POLYLINE with elevation in the header (vertex z ignored?)
    c = s.case("polyline2d-elevation-0001", "2D POLYLINE with header elevation and conflicting vertex z", tags=["POLYLINE", "elevation"])
    pl = c.msp.add_polyline2d([(20, 20), (180, 20), (100, 130)], close=True, dxfattribs={"extrusion": (0, 0, -1)})
    pl.dxf.elevation = (0, 0, 7)
    for i, v in enumerate(pl.vertices):
        v.dxf.location = Vec3(v.dxf.location.x, v.dxf.location.y, 100 * (i + 1))
    c.window((-200, 0), (0, 150))

    # thickness in plan view and in tilted views of the extrusion
    for key in ("z", "tilt-y45", "skew"):
        n = NORMALS[key]
        ocs = OCS(n)
        c = s.case(f"thickness-{key}", f"LINE/CIRCLE/ARC/SOLID/TEXT with thickness 20, extrusion {n}", tags=["thickness", "OCS", "LINE", "CIRCLE", "SOLID", "TEXT"], params={"extrusion": n, "thickness": 20})
        da = {"thickness": 20, "extrusion": n}
        c.msp.add_line((20, 20), (60, 40), dxfattribs=da)  # LINE: WCS points, 210 = thickness direction
        p = _place(ocs, Vec3(100, 40, 0))
        c.msp.add_circle(p, 15, dxfattribs=da)
        p = _place(ocs, Vec3(150, 40, 0))
        c.msp.add_arc(p, 15, 0, 180, dxfattribs=da)
        p = _place(ocs, Vec3(30, 100, 0))
        c.msp.add_solid([(p.x, p.y, p.z), (p.x + 30, p.y, p.z), (p.x, p.y + 20, p.z), (p.x + 30, p.y + 20, p.z)], dxfattribs=da)
        p = _place(ocs, Vec3(90, 100, 0))
        c.msp.add_text("Th", height=15, dxfattribs={**da, "insert": p})
        c.window((0, 0), (200, 150))

    # arbitrary random normals (seeded)
    for seed in range(1, 7):
        c = s.case(f"random-normal-{seed:04d}", f"CIRCLE+ARC+LWPOLYLINE with a random extrusion, seed {seed}", tags=["OCS", "CIRCLE", "ARC", "LWPOLYLINE"], seed=seed)
        rng = c.rng
        n = Vec3(rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.2, 1)).normalize()
        if rng.random() < 0.5:
            n = -n
        c.params["extrusion"] = [round(v, 9) for v in n]
        n = Vec3(c.params["extrusion"])
        ocs = OCS(n)
        p = _place(ocs, center)
        c.msp.add_circle(p, 35, dxfattribs={"extrusion": n})
        c.msp.add_arc(p, 20, rng.uniform(0, 360), rng.uniform(0, 360), dxfattribs={"extrusion": n})
        c.msp.add_lwpolyline([(p.x - 15, p.y), (p.x + 15, p.y, 0, 0, 1)], format="xyseb", close=True, dxfattribs={"extrusion": n, "elevation": p.z})
        c.window((0, 0), (200, 150))
