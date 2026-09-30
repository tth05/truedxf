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
        qmap = {"negative-width": ["Q-0147"], "taper-arc": ["Q-0153"], "closed-width": ["Q-0154"], "closed-taper": ["Q-0154"],
                "hairpin": ["Q-0151"], "zero-len-seg": ["Q-0151"], "mixed-bulge": ["Q-0152"]}
        c = s.case(f"width-{name}", f"LWPOLYLINE per-vertex widths: {name}", tags=["LWPOLYLINE", "width"], questions=qmap.get(name, []), params={"vertices": pts, "closed": closed})
        c.msp.add_lwpolyline(pts, format="xyseb", close=closed)
        c.window((0, 0), (200, 150))
    for fm in (0, 1):
        c = s.case(f"fillmode-{fm}", f"Wide LWPOLYLINE, tapered segment and bulge with FILLMODE={fm}", tags=["LWPOLYLINE", "width", "FILLMODE"], questions=["Q-0155", "Q-0183"], params={"fillmode": fm}, header={"$FILLMODE": fm})
        c.msp.add_lwpolyline([(20, 40, 8, 8, 0), (80, 40, 8, 0, 0.6), (140, 40, 6, 6, 0), (180, 120, 0, 0, 0)], format="xyseb")
        c.window((0, 0), (200, 150))

    # --- degenerate LWPOLYLINEs
    c = s.case("degenerate-single-vertex", "LWPOLYLINE with a single vertex (width 5)", tags=["LWPOLYLINE", "degenerate"], questions=["Q-0149"])
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
    c = s.case("curvefit-flag-only", "2D POLYLINE with curve-fit flag 2 but only frame vertices", tags=["POLYLINE", "curve-fit"], questions=["Q-0140"])
    pl = c.msp.add_polyline2d(frame)
    pl.dxf.flags |= 2
    c.window((0, 0), (200, 150))
    for degree, stype in ((2, 5), (3, 6)):
        for splframe in (0, 1):
            c = s.case(
                f"splinefit-deg{degree}-frame{splframe}",
                f"2D POLYLINE spline-fit (75={stype}) with flag-16 frame + flag-8 fitted vertices, SPLFRAME={splframe}",
                tags=["POLYLINE", "spline-fit", "SPLFRAME"],
                questions=["Q-0140"],
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
    c = s.case("splinefit-flag-no-fitted", "2D POLYLINE spline-fit flag 4 with only flag-16 frame vertices", tags=["POLYLINE", "spline-fit"], questions=["Q-0141"])
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
        c = s.case(f"polyface-{i:04d}", f"Polyface mesh (tilted cube) invisible edges={invisible}", tags=["POLYLINE", "polyface", "invisible-edges"], questions=["Q-0189"] if invisible else [], params={"invisible_edges": invisible})
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
        c = s.case(f"polymesh-{i:04d}", f"Polygon mesh 6x8 flags={16 | flags}", tags=["POLYLINE", "polymesh"], questions=["Q-0144"], params={"closed_flags": flags})
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

    _question_cases(s)


def _question_cases(s: SuiteBuilder) -> None:
    # Q-0136: very flat bulge over a long chord
    c = s.case("flat-bulge", "LWPOLYLINE 1000 units long with bulge tan(0.5 deg) (2 deg arc) over a reference LINE", tags=["LWPOLYLINE", "bulge", "tessellation"], questions=["Q-0136"])
    c.msp.add_lwpolyline([(0, 0, 0, 0, math.tan(math.radians(0.5))), (1000, 0, 0, 0, 0)], format="xyseb")
    c.msp.add_line((0, -2), (1000, -2))
    c.window_center((500, 0), 2)

    # Q-0137: 2D POLYLINE vertex z vs header elevation (DXFOUT)
    c = s.case("polyline2d-vertex-z", "2D POLYLINE header elevation z=2 with vertices z=0 and z=7", tags=["POLYLINE", "elevation"], questions=["Q-0137"])
    pl = c.msp.add_polyline2d([(20, 20), (180, 20), (100, 130)], close=True)
    pl.dxf.elevation = (0, 0, 2)
    for i, v in enumerate(pl.vertices):
        v.dxf.location = (v.dxf.location.x, v.dxf.location.y, 7.0 if i % 2 else 0.0)
    c.window((0, 0), (200, 150))

    # Q-0138: PLINEGEN flag bit 128 vs header $PLINEGEN on a dashed short-segment polyline
    pts = [(10 + i * 9, 40 + (i % 2) * 70) for i in range(21)]
    for bit in (0, 1):
        for hdr in (0, 1):
            c = s.case(f"plinegen-bit{bit}-hdr{hdr}", f"DASHED zig-zag LWPOLYLINE, 70 bit 128 = {bit}, $PLINEGEN={hdr}", tags=["LWPOLYLINE", "PLINEGEN", "linetype"], questions=["Q-0138"], params={"bit128": bit, "plinegen": hdr}, header={"$PLINEGEN": hdr, "$LTSCALE": 0.4})
            lw = c.msp.add_lwpolyline(pts, dxfattribs={"linetype": c.linetype("DASHED")})
            if bit:
                lw.dxf.flags |= 128
            c.window((0, 0), (200, 150))

    frame = [(20, 20), (50, 130), (100, 20), (150, 130), (180, 60)]
    # Q-0139: stored spline-fit vertices vs $SPLINESEGS
    for segs in (8, 2, -8):
        c = s.case(f"splinefit-splinesegs-{'m' if segs < 0 else 'p'}{abs(segs)}", f"Spline-fit POLYLINE (stored 8/span) with $SPLINESEGS={segs}", tags=["POLYLINE", "spline-fit", "SPLINESEGS"], questions=["Q-0139", "Q-0140"], params={"splinesegs": segs}, header={"$SPLINESEGS": segs})
        pl = c.msp.add_polyline2d([])
        pl.dxf.flags |= 4
        pl.dxf.smooth_type = 6
        for p in frame:
            pl.append_vertex(p, dxfattribs={"flags": 16})
        for p in spline_fit_vertices(frame, 3):
            pl.append_vertex(p[:2], dxfattribs={"flags": 8})
        c.window((0, 0), (200, 150))
    # wide spline-fit polyline
    c = s.case("splinefit-wide", "Spline-fit POLYLINE with default width 3 (frame + fitted vertices)", tags=["POLYLINE", "spline-fit", "width"], questions=["Q-0140"])
    pl = c.msp.add_polyline2d([])
    pl.dxf.flags |= 4
    pl.dxf.smooth_type = 6
    pl.dxf.default_start_width = 3
    pl.dxf.default_end_width = 3
    for p in frame:
        pl.append_vertex(p, dxfattribs={"flags": 16})
    for p in spline_fit_vertices(frame, 3):
        pl.append_vertex(p[:2], dxfattribs={"flags": 8, "start_width": 3, "end_width": 3})
    c.window((0, 0), (200, 150))
    # Q-0141: closed spline-fit with frame vertices only
    c = s.case("splinefit-closed-no-fitted", "Closed spline-fit POLYLINE (70=5, 75=6) with only flag-16 frame vertices", tags=["POLYLINE", "spline-fit", "closed"], questions=["Q-0141"])
    pl = c.msp.add_polyline2d([])
    pl.dxf.flags |= 4 | 1
    pl.dxf.smooth_type = 6
    for p in frame:
        pl.append_vertex(p, dxfattribs={"flags": 16})
    c.window((0, 0), (200, 150))

    # Q-0142: smoothed polygon mesh flag with raw vertices, $SURFU/$SURFV
    for su in (6, 20):
        c = s.case(f"polymesh-smooth-surfu{su}", f"Polygon mesh 4x3 with 75=6 (cubic smooth) and $SURFU/$SURFV={su}", tags=["POLYLINE", "polymesh", "SURFU"], questions=["Q-0142"], params={"surfu": su}, header={"$SURFU": su, "$SURFV": su, "$SURFTYPE": 6})
        mesh = c.msp.add_polymesh(size=(4, 3))
        mesh.dxf.smooth_type = 6
        mesh.dxf.m_smooth_density = 6
        mesh.dxf.n_smooth_density = 6
        for j in range(4):
            for k in range(3):
                mesh.set_mesh_vertex((j, k), (30 + j * 45, 25 + k * 50, ((j + k) % 2) * 20))
        c.window((0, 0), (200, 150))

    # Q-0145: polyface face records with their own colours
    c = s.case("polyface-face-colors", "Polyface mesh with 2 faces: face records 62=1 / 62=3, vertices 62=5", tags=["POLYLINE", "polyface", "color"], questions=["Q-0145"], style_table="acad.ctb")
    pf = c.msp.add_polyface()
    pf.append_faces([[(30, 30, 0), (95, 30, 0), (95, 120, 0), (30, 120, 0)], [(105, 30, 0), (170, 30, 0), (170, 120, 0), (105, 120, 0)]])
    recs = [e for e in pf.vertices if e.is_face_record]
    for rec, col in zip(recs, (1, 3)):
        rec.dxf.color = col
    for v in pf.vertices:
        if v.is_poly_face_mesh_vertex:
            v.dxf.color = 5
    c.window((0, 0), (200, 150))
    # Q-0189: polyface invisible edges with $SPLFRAME=1
    c = s.case("polyface-invisible-splframe", "Polyface with negative (invisible) edge indices and $SPLFRAME=1", tags=["POLYLINE", "polyface", "invisible-edges", "SPLFRAME"], questions=["Q-0189"], header={"$SPLFRAME": 1})
    pf = c.msp.add_polyface()
    pf.append_faces([[(30, 30, 0), (100, 30, 0), (100, 120, 0), (30, 120, 0)], [(100, 30, 0), (170, 30, 0), (170, 120, 0), (100, 120, 0)]])
    for rec in [e for e in pf.vertices if e.is_face_record]:
        rec.dxf.vtx1 = -abs(rec.dxf.vtx1)
    c.window((0, 0), (200, 150))

    # Q-0146: per-vertex widths plus constant width 43
    for i, cw in enumerate([2.0, 0.0], 1):
        c = s.case(f"width-vertex-plus-const-{i:04d}", f"LWPOLYLINE vertex widths 0.5/4 and 2/2 with 43={cw}", tags=["LWPOLYLINE", "width"], questions=["Q-0146"], params={"const_width": cw})
        lw = c.msp.add_lwpolyline([(20, 75, 0.5, 4, 0), (100, 75, 2, 2, 0), (180, 75, 0, 0, 0)], format="xyseb")
        lw.dxf.const_width = cw
        c.window((0, 0), (200, 150))
    # Q-0147: negative constant width
    c = s.case("width-const-negative", "LWPOLYLINE with constant width 43=-1", tags=["LWPOLYLINE", "width", "invalid"], questions=["Q-0147"])
    c.allow_audit_errors = True
    c.msp.add_lwpolyline(ZIGZAG, dxfattribs={"const_width": 1.2345})
    c.byte_filters.append(lambda d: d.replace(b"\n 43\n1.2345\n", b"\n 43\n-1.0\n", 1))
    c.window((0, 0), (200, 150))
    # Q-0148: zero-width and wide segments with a lineweight
    c = s.case("width-mixed-zero-lw", "LWPOLYLINE segments alternating width 0 and 4, lineweight 0.50 mm", tags=["LWPOLYLINE", "width", "lineweight"], questions=["Q-0148"])
    c.msp.add_lwpolyline([(20, 40, 0, 0, 0), (60, 110, 4, 4, 0), (100, 40, 0, 0, 0), (140, 110, 4, 4, 0), (180, 40, 0, 0, 0)], format="xyseb", dxfattribs={"lineweight": 50})
    c.window((0, 0), (200, 150))
    # Q-0149: single-vertex polylines
    for i, (closed, cw) in enumerate([(False, 0.0), (True, 0.0), (False, 2.0), (True, 2.0)], 1):
        c = s.case(f"single-vertex-{i:04d}", f"LWPOLYLINE with one vertex closed={closed} width={cw} lw 0.50 mm", tags=["LWPOLYLINE", "degenerate"], questions=["Q-0149"], params={"closed": closed, "const_width": cw})
        c.msp.add_lwpolyline([(100, 75)], close=closed, dxfattribs={"const_width": cw, "lineweight": 50})
        c.msp.add_circle((100, 75), 8)
        c.window((0, 0), (200, 150))
    c = s.case("single-vertex-polyline2d", "R2004 2D POLYLINE with a single VERTEX + SEQEND", tags=["POLYLINE", "degenerate"], questions=["Q-0149"], dxfversion="R2004")
    c.msp.add_polyline2d([(100, 75)], dxfattribs={"lineweight": 50})
    c.msp.add_circle((100, 75), 8)
    c.window((0, 0), (200, 150))
    # Q-0150: miter spikes at sharp joints
    for i, ang in enumerate([90, 30, 5, 1], 1):
        c = s.case(f"miter-angle-{i:04d}", f"Wide LWPOLYLINE (w=2) with a {ang} deg joint", tags=["LWPOLYLINE", "width", "miter"], questions=["Q-0150"], params={"joint_angle": ang})
        half = math.radians(ang) / 2
        L = 70
        tip = (130, 75)
        p0 = (tip[0] - L * math.cos(half), tip[1] + L * math.sin(half))
        p2 = (tip[0] - L * math.cos(half), tip[1] - L * math.sin(half))
        c.msp.add_lwpolyline([p0, tip, p2], dxfattribs={"const_width": 2})
        c.window((0, 0), (200, 150))
    # Q-0151: duplicate vertices, collinear reversal, tapered 0,0,5,0
    cases = {
        "duplicate": ([(20, 75), (100, 75), (100, 75), (180, 120)], {"const_width": 5}),
        "reversal": ([(20, 75), (150, 75), (60, 75), (180, 75.0001)], {"const_width": 5}),
        "taper-0050": ([(20, 50, 0, 0, 0), (70, 50, 0, 5, 0), (120, 100, 5, 0, 0), (180, 100, 0, 0, 0)], {}),
    }
    for name, (pts2, attrs) in cases.items():
        c = s.case(f"joins-{name}", f"Wide LWPOLYLINE joins: {name}", tags=["LWPOLYLINE", "width", "joins"], questions=["Q-0151"], params={"vertices": pts2})
        c.msp.add_lwpolyline(pts2, format="xyseb" if len(pts2[0]) == 5 else "xy", dxfattribs=attrs)
        c.window((0, 0), (200, 150))
    # Q-0152: line -> non-tangent arc -> line
    c = s.case("joins-line-arc", "Wide LWPOLYLINE (w=2) line -> non-tangent arc (bulge 0.5) -> line", tags=["LWPOLYLINE", "width", "bulge", "joins"], questions=["Q-0152"])
    c.msp.add_lwpolyline([(20, 40, 0, 0, 0), (80, 40, 0, 0, 0.5), (140, 90, 0, 0, 0), (180, 130, 0, 0, 0)], format="xyseb", dxfattribs={"const_width": 2})
    c.window((0, 0), (200, 150))
    # Q-0153: tapered wide arcs
    for i, b in enumerate([1.0, -1.0], 1):
        c = s.case(f"taper-arc-{i:04d}", f"LWPOLYLINE 2 vertices, width 0 -> 12, bulge {b}", tags=["LWPOLYLINE", "width", "bulge"], questions=["Q-0153"], params={"bulge": b})
        y = 45
        c.msp.add_lwpolyline([(160, y, 0, 12, b), (40, y, 0, 0, 0)] if b > 0 else [(40, y, 0, 12, b), (160, y, 0, 0, 0)], format="xyseb")
        c.window((0, 0), (200, 150))
    # Q-0154: width >= diameter, closed wide rings
    rings = {
        "semicircle-w6": ([(90, 60, 6, 6, 1), (94, 60, 0, 0, 0)], False),
        "semicircle-taper": ([(80, 60, 0, 8, 1), (84, 60, 0, 0, 0)], False),
        "closed-2v-diameter": ([(70, 75, 60, 60, 1), (130, 75, 60, 60, 1)], True),
        "closed-2v-thin": ([(40, 75, 0.5, 0.5, 1), (160, 75, 0.5, 0.5, 1)], True),
    }
    for name, (pts2, closed) in rings.items():
        c = s.case(f"ring-{name}", f"Wide bulged LWPOLYLINE: {name}", tags=["LWPOLYLINE", "width", "bulge"], questions=["Q-0154"], params={"vertices": pts2, "closed": closed})
        c.msp.add_lwpolyline(pts2, format="xyseb", close=closed)
        c.window((0, 0), (200, 150)) if "semicircle" not in name else c.window_center((90, 60), 40)
