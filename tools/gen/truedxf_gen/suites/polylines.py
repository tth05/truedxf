"""LWPOLYLINE / 2D+3D POLYLINE, bulges, widths, curve/spline fit, polyface and polygon meshes
(note 03 §3.9–3.10, §4)."""

from __future__ import annotations

import math

from ezdxf.math import BSpline, Vec3

from ..core import SuiteBuilder, suite

ZIGZAG = [(20, 30), (60, 120), (100, 30), (140, 120), (180, 30)]


def spline_fit_vertices(ctrl, degree: int, segs_per_span: int = 8):
    """Clamped uniform B-spline through the control frame (what PEDIT Spline stores as flag-8
    vertices; AutoCAD's exact $SPLINESEGS spacing is itself a question)."""
    sp = BSpline([Vec3(p) for p in ctrl], order=degree + 1)
    n = segs_per_span * (len(ctrl) - 1)
    return [(round(p.x, 9), round(p.y, 9), round(p.z, 9)) for p in sp.approximate(n)]


@suite("polylines", "LWPOLYLINE / POLYLINE: bulges, widths, fit curves, meshes", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    # --- bulge sweep on a single segment
    for i, b in enumerate([0.0, 1e-6, 0.1, 0.4142136, 0.5, 1.0, -1.0, 2.0, -3.0, 10.0, 100.0], 1):
        c = s.case(f"bulge-{i:04d}", f"LWPOLYLINE one segment with bulge {b}", tags=["LWPOLYLINE", "bulge"], params={"bulge": b})
        c.msp.add_lwpolyline([(70, 75, 0, 0, b), (130, 75, 0, 0, 0)], format="xyseb")
        c.msp.add_point((70, 75))
        c.msp.add_point((130, 75))
        c.window((0, 0), (200, 150))

    # --- closed vs open, closing-segment bulge
    for i, (closed, lastb) in enumerate([(False, 0), (True, 0), (True, 1), (True, -0.5), (False, 1)], 1):
        c = s.case(f"closed-{i:04d}", f"LWPOLYLINE square closed={closed} last-vertex bulge={lastb}", tags=["LWPOLYLINE", "closed", "bulge"], params={"closed": closed, "last_bulge": lastb})
        c.msp.add_lwpolyline([(50, 25), (150, 25), (150, 125), (50, 125, 0, 0, lastb)], format="xyseb", close=closed)
        c.window((0, 0), (200, 150))

    # --- constant width, tapered widths, widths with bulges, FILLMODE
    widths = [
        ("const", {"const_width": 4}),
        ("const-thin", {"const_width": 0.05}),
        ("const-huge", {"const_width": 30}),
    ]
    for i, (name, attrs) in enumerate(widths, 1):
        c = s.case(f"width-{name}", f"Zig-zag LWPOLYLINE {attrs}", tags=["LWPOLYLINE", "width"], params=attrs)
        c.msp.add_lwpolyline(ZIGZAG, dxfattribs=attrs)
        c.window((0, 0), (200, 150))
    tapers = [
        ("taper-0-10", [(20, 75, 0, 10, 0), (180, 75, 0, 0, 0)]),
        ("taper-10-0", [(20, 75, 10, 0, 0), (180, 75, 0, 0, 0)]),
        ("arrow", [(20, 75, 3, 3, 0), (140, 75, 15, 0, 0), (180, 75, 0, 0, 0)]),
        ("taper-arc", [(40, 40, 0, 12, -1), (160, 40, 0, 0, 0)]),
        ("taper-corners", [(20, 20, 2, 8, 0), (100, 130, 8, 2, 0), (180, 20, 2, 8, 0)]),
        ("mixed-bulge", [(20, 40, 4, 4, 0.5), (80, 40, 4, 4, -0.5), (140, 40, 4, 10, 0), (180, 120, 0, 0, 0)]),
        ("closed-width", [(40, 30, 6, 6, 0), (160, 30, 6, 6, 0), (160, 120, 6, 6, 0), (40, 120, 6, 6, 0)]),
        ("closed-taper", [(40, 30, 0, 12, 0), (160, 30, 12, 0, 0), (100, 120, 0, 12, 0)]),
        ("hairpin", [(20, 60, 5, 5, 0), (180, 70, 5, 5, 0), (20, 80, 5, 5, 0)]),
        ("zero-len-seg", [(20, 75, 5, 5, 0), (100, 75, 5, 5, 0), (100, 75, 5, 5, 0), (180, 100, 5, 5, 0)]),
        ("negative-width", [(20, 75, -4, -4, 0), (180, 75, 0, 0, 0)]),
    ]
    for name, pts in tapers:
        closed = name.startswith("closed")
        c = s.case(f"width-{name}", f"LWPOLYLINE per-vertex widths: {name}", tags=["LWPOLYLINE", "width"], params={"vertices": pts, "closed": closed})
        c.msp.add_lwpolyline(pts, format="xyseb", close=closed)
        c.window((0, 0), (200, 150))
    for fm in (0, 1):
        c = s.case(f"fillmode-{fm}", f"Wide LWPOLYLINE, tapered segment and bulge with FILLMODE={fm}", tags=["LWPOLYLINE", "width", "FILLMODE"], params={"fillmode": fm}, header={"$FILLMODE": fm})
        c.msp.add_lwpolyline([(20, 40, 8, 8, 0), (80, 40, 8, 0, 0.6), (140, 40, 6, 6, 0), (180, 120, 0, 0, 0)], format="xyseb")
        c.window((0, 0), (200, 150))

    # --- degenerate LWPOLYLINEs
    c = s.case("degenerate-single-vertex", "LWPOLYLINE with a single vertex (width 5)", tags=["LWPOLYLINE", "degenerate"])
    c.msp.add_lwpolyline([(100, 75)], dxfattribs={"const_width": 5})
    c.msp.add_circle((100, 75), 10)
    c.window((0, 0), (200, 150))
    c = s.case("degenerate-duplicate-points", "LWPOLYLINE with repeated vertices and bulge on a zero-length segment", tags=["LWPOLYLINE", "degenerate"])
    c.msp.add_lwpolyline([(20, 20, 0, 0, 0), (100, 20, 0, 0, 1), (100, 20, 0, 0, 0), (180, 130, 0, 0, 0)], format="xyseb")
    c.window((0, 0), (200, 150))

    # --- 2D POLYLINE equivalents (header default widths 40/41, vertex widths)
    c = s.case("polyline2d-basic", "2D POLYLINE zig-zag (no width)", tags=["POLYLINE"])
    c.msp.add_polyline2d(ZIGZAG)
    c.window((0, 0), (200, 150))
    c = s.case("polyline2d-default-width", "2D POLYLINE with header default start/end width 2/6 and no vertex widths", tags=["POLYLINE", "width"])
    pl = c.msp.add_polyline2d(ZIGZAG)
    pl.dxf.default_start_width = 2
    pl.dxf.default_end_width = 6
    c.window((0, 0), (200, 150))
    c = s.case("polyline2d-vertex-width", "2D POLYLINE with bulges and per-vertex widths", tags=["POLYLINE", "width", "bulge"])
    c.msp.add_polyline2d([(20, 40, 0, 6, 0.5), (80, 40, 6, 2, -1), (140, 40, 2, 2, 0), (180, 120, 0, 0, 0)], format="xyseb")
    c.window((0, 0), (200, 150))
    c = s.case("polyline2d-closed-bulge", "Closed 2D POLYLINE with bulge on closing segment", tags=["POLYLINE", "closed", "bulge"])
    c.msp.add_polyline2d([(50, 25, 0, 0, 0), (150, 25, 0, 0, 0), (150, 125, 0, 0, 0), (50, 125, 0, 0, 0.7)], format="xyseb", close=True)
    c.window((0, 0), (200, 150))

    # --- curve-fit (flag 2) and spline-fit (flag 4) 2D polylines
    frame = [(20, 20), (50, 130), (100, 20), (150, 130), (180, 60)]
    c = s.case("curvefit-flag-only", "2D POLYLINE with curve-fit flag 2 but only frame vertices", tags=["POLYLINE", "curve-fit"])
    pl = c.msp.add_polyline2d(frame)
    pl.dxf.flags |= 2
    c.window((0, 0), (200, 150))
    for degree, stype in ((2, 5), (3, 6)):
        for splframe in (0, 1):
            c = s.case(
                f"splinefit-deg{degree}-frame{splframe}",
                f"2D POLYLINE spline-fit (75={stype}) with flag-16 frame + flag-8 fitted vertices, SPLFRAME={splframe}",
                tags=["POLYLINE", "spline-fit", "SPLFRAME"],
                params={"degree": degree, "splframe": splframe},
                header={"$SPLFRAME": splframe, "$SPLINESEGS": 8, "$SPLINETYPE": stype},
            )
            pl = c.msp.add_polyline2d([])
            pl.dxf.flags |= 4
            pl.dxf.smooth_type = stype
            for p in frame:
                pl.append_vertex(p, dxfattribs={"flags": 16})
            for p in spline_fit_vertices(frame, degree):
                pl.append_vertex(p[:2], dxfattribs={"flags": 8})
            c.window((0, 0), (200, 150))
    c = s.case("splinefit-flag-no-fitted", "2D POLYLINE spline-fit flag 4 with only flag-16 frame vertices", tags=["POLYLINE", "spline-fit"])
    pl = c.msp.add_polyline2d([])
    pl.dxf.flags |= 4
    pl.dxf.smooth_type = 6
    for p in frame:
        pl.append_vertex(p, dxfattribs={"flags": 16})
    c.window((0, 0), (200, 150))

    # --- 3D POLYLINE
    c = s.case("polyline3d-basic", "3D POLYLINE helix-like (plan projection)", tags=["POLYLINE", "3d"])
    pts = [(100 + 60 * math.cos(t / 6), 75 + 60 * math.sin(t / 6), t * 3) for t in range(0, 37)]
    c.msp.add_polyline3d(pts)
    c.window((0, 0), (200, 150))
    c = s.case("polyline3d-closed", "Closed 3D POLYLINE", tags=["POLYLINE", "3d", "closed"])
    c.msp.add_polyline3d([(30, 30, 0), (170, 30, 50), (170, 120, -50), (30, 120, 10)], close=True)
    c.window((0, 0), (200, 150))
    c = s.case("polyline3d-splinefit", "3D POLYLINE spline-fit with flag-16 frame + flag-8 fitted vertices", tags=["POLYLINE", "3d", "spline-fit"])
    pl = c.msp.add_polyline3d([])
    pl.dxf.flags |= 4
    pl.dxf.smooth_type = 6
    f3 = [(20, 20, 0), (50, 130, 30), (100, 20, -20), (150, 130, 10), (180, 60, 0)]
    for p in f3:
        pl.append_vertex(p, dxfattribs={"flags": 16 | 32})
    for p in spline_fit_vertices(f3, 3):
        pl.append_vertex(p, dxfattribs={"flags": 8 | 32})
    c.window((0, 0), (200, 150))

    # --- polyface mesh (cube with some invisible edges), viewed in plan and skewed
    for i, invisible in enumerate([False, True], 1):
        c = s.case(f"polyface-{i:04d}", f"Polyface mesh (tilted cube) invisible edges={invisible}", tags=["POLYLINE", "polyface", "invisible-edges"], params={"invisible_edges": invisible})
        pf = c.msp.add_polyface()
        a = math.radians(30)
        def rot(p):
            x, y, z = p
            x, z = x * math.cos(a) + z * math.sin(a), -x * math.sin(a) + z * math.cos(a)
            y, z = y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)
            return (100 + x, 75 + y, z)
        v = [rot(((x - 0.5) * 70, (y - 0.5) * 70, (z - 0.5) * 70)) for x in (0, 1) for y in (0, 1) for z in (0, 1)]
        faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        pf.append_faces([[v[k] for k in f] for f in faces])
        if invisible:
            # negative vertex index = invisible edge starting at that vertex
            recs = [e for e in pf.vertices if e.is_face_record]
            for rec in recs[:3]:
                rec.dxf.vtx0 = -abs(rec.dxf.vtx0)
                rec.dxf.vtx2 = -abs(rec.dxf.vtx2)
        c.window((0, 0), (200, 150))

    # --- polygon mesh M×N (open, closed in M, closed in N)
    for i, flags in enumerate([0, 1, 32, 33], 1):
        c = s.case(f"polymesh-{i:04d}", f"Polygon mesh 6x8 flags={16 | flags}", tags=["POLYLINE", "polymesh"], params={"closed_flags": flags})
        m, n = 6, 8
        mesh = c.msp.add_polymesh(size=(m, n))
        mesh.dxf.flags |= flags
        for j in range(m):
            for k in range(n):
                ang = 2 * math.pi * k / n
                r = 20 + j * 10
                mesh.set_mesh_vertex((j, k), (100 + r * math.cos(ang), 75 + r * math.sin(ang), j * 5))
        c.window((0, 0), (200, 150))

    # --- seeded random LWPOLYLINEs with widths/bulges
    for seed in range(1, 9):
        c = s.case(f"random-{seed:04d}", f"Random LWPOLYLINE with bulges and widths, seed {seed}", tags=["LWPOLYLINE", "bulge", "width"], seed=seed)
        rng = c.rng
        pts = []
        for _ in range(rng.randint(3, 9)):
            w0 = rng.choice([0, 0, 1, 3, 6])
            w1 = rng.choice([w0, w0, 0, 4])
            pts.append((rng.uniform(15, 185), rng.uniform(15, 135), w0, w1, rng.choice([0, 0, 0.3, -0.6, 1])))
        c.msp.add_lwpolyline(pts, format="xyseb", close=rng.random() < 0.4)
        c.window((0, 0), (200, 150))
