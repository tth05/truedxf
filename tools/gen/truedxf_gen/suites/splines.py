"""SPLINE: control-point, fit-point-only, periodic/closed, rational, degree 1–5, knots
(note 03 §3.8)."""

from __future__ import annotations

import math

from ezdxf.math import Vec3

from ..core import SuiteBuilder, suite

CTRL = [(20, 20), (40, 130), (80, 20), (120, 130), (160, 20), (180, 100)]
FIT = [(20, 40), (50, 120), (90, 60), (130, 120), (170, 50)]


def _frame(c, pts) -> None:
    """Thin reference polyline through the control/fit points (layer FRAME, colour 8)."""
    c.layer("FRAME", color=8, lineweight=0)
    c.msp.add_lwpolyline([p[:2] for p in pts], dxfattribs={"layer": "FRAME"})


@suite("splines", "SPLINE: control/fit points, periodic, rational, degree 1-5", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    # degree sweep, clamped (open uniform) knots
    for deg in range(1, 6):
        c = s.case(f"control-deg{deg}", f"Clamped uniform SPLINE degree {deg}, 6 control points", tags=["SPLINE", "control-points"], params={"degree": deg})
        c.msp.add_open_spline(CTRL, degree=deg)
        _frame(c, CTRL)
        c.window((0, 0), (200, 150))
    # unclamped uniform knots
    for deg in (2, 3):
        c = s.case(f"uniform-deg{deg}", f"Unclamped uniform-knot SPLINE degree {deg}", tags=["SPLINE", "knots"], params={"degree": deg})
        sp = c.msp.add_spline()
        sp.set_uniform([Vec3(p) for p in CTRL], degree=deg)
        _frame(c, CTRL)
        c.window((0, 0), (200, 150))
    # non-uniform knots, interior knot multiplicity = degree (kink), knot range not starting at 0
    knotsets = {
        "nonuniform": [0, 0, 0, 0, 0.1, 0.5, 1, 1, 1, 1],
        "kink": [0, 0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1],  # 7 ctrl? -> adjust below
        "offset-range": [10, 10, 10, 10, 12, 14, 16, 16, 16, 16],
        "scaled-range": [0, 0, 0, 0, 100, 200, 300, 300, 300, 300],
    }
    for name, knots in knotsets.items():
        ctrl = CTRL if name != "kink" else CTRL
        n_ctrl = len(knots) - 4
        ctrl = CTRL[:n_ctrl]
        c = s.case(f"knots-{name}", f"Cubic SPLINE with {name} knot vector {knots}", tags=["SPLINE", "knots"], questions=["Q-0179"], params={"knots": knots})
        sp = c.msp.add_spline()
        sp.dxf.degree = 3
        sp.control_points = [Vec3(p) for p in ctrl]
        sp.knots = knots
        _frame(c, ctrl)
        c.window((0, 0), (200, 150))
    # closed periodic
    ring = [(100 + 60 * math.cos(a), 75 + 50 * math.sin(a)) for a in [i * math.tau / 7 for i in range(7)]]
    for deg in (2, 3, 4):
        c = s.case(f"periodic-deg{deg}", f"Closed periodic SPLINE degree {deg} (flags 3), 7 distinct control points", tags=["SPLINE", "periodic", "closed"], questions=["Q-0178"], params={"degree": deg})
        sp = c.msp.add_spline()
        sp.set_closed([Vec3(p) for p in ring], degree=deg)
        _frame(c, ring + ring[:1])
        c.window((0, 0), (200, 150))
    # closed flag only, clamped knots with first == last control point
    c = s.case("closed-clamped", "SPLINE flag closed(1) only, clamped knots, first control point repeated at end", tags=["SPLINE", "closed"])
    sp = c.msp.add_open_spline(ring + ring[:1], degree=3)
    sp.dxf.flags = 1
    c.window((0, 0), (200, 150))
    # rational: weights sweep, exact circle quadrant
    for i, w in enumerate([0.1, 0.5, 1.0, 2.0, 10.0], 1):
        c = s.case(f"rational-{i:04d}", f"Rational cubic SPLINE, weight {w} on the middle control points", tags=["SPLINE", "rational"], params={"weight": w})
        weights = [1, w, w, w, w, 1]
        c.msp.add_rational_spline(CTRL, weights, degree=3)
        _frame(c, CTRL)
        c.window((0, 0), (200, 150))
    c = s.case("rational-circle", "Rational quadratic SPLINE = exact full circle (9 control points) over a CIRCLE", tags=["SPLINE", "rational", "CIRCLE"], questions=["Q-0180"])
    r, cx, cy = 60, 100, 75
    w = math.sqrt(0.5)
    pts = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1), (1, 0)]
    sp = c.msp.add_spline()
    sp.dxf.degree = 2
    sp.control_points = [Vec3(cx + r * x, cy + r * y) for x, y in pts]
    sp.knots = [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1]
    sp.weights = [1, w, 1, w, 1, w, 1, w, 1]
    sp.dxf.flags = 4 | 1  # rational + closed
    c.layer("REF", color=1, lineweight=0)
    c.msp.add_circle((cx, cy), r + 1, dxfattribs={"layer": "REF"})
    c.window((0, 0), (200, 150))
    # fit-point-only splines (AutoCAD computes the control points)
    for i, deg in enumerate([2, 3], 1):
        c = s.case(f"fit-only-deg{deg}", f"SPLINE with only fit points (no control points), degree {deg}", tags=["SPLINE", "fit-points"], questions=["Q-0171"], params={"degree": deg})
        c.msp.add_spline(FIT, degree=deg)
        c.layer("FIT", color=1, lineweight=0)
        for p in FIT:
            c.msp.add_circle(p, 1.5, dxfattribs={"layer": "FIT"})
        c.window((0, 0), (200, 150))
    tangents = [((1, 0, 0), (1, 0, 0)), ((0, 1, 0), (0, -1, 0)), ((5, 5, 0), (-1, -3, 0))]
    for i, (t0, t1) in enumerate(tangents, 1):
        c = s.case(f"fit-tangents-{i:04d}", f"Fit-point-only SPLINE with start tangent {t0} and end tangent {t1}", tags=["SPLINE", "fit-points", "tangents"], questions=["Q-0172"], params={"start_tangent": t0, "end_tangent": t1})
        sp = c.msp.add_spline(FIT, degree=3)
        sp.dxf.start_tangent = t0
        sp.dxf.end_tangent = t1
        c.window((0, 0), (200, 150))
    c = s.case("fit-closed", "Closed fit-point-only SPLINE (flag 1)", tags=["SPLINE", "fit-points", "closed"], questions=["Q-0176"])
    sp = c.msp.add_spline(ring, degree=3)
    sp.dxf.flags = 1
    c.window((0, 0), (200, 150))
    c = s.case("fit-tolerance", "Fit-point-only SPLINE with fit tolerance 44=5", tags=["SPLINE", "fit-points"], questions=["Q-0177"])
    sp = c.msp.add_spline(FIT, degree=3)
    sp.dxf.fit_tolerance = 5.0
    c.window((0, 0), (200, 150))
    # both fit and control points present: which one is drawn? (fit points deliberately differ)
    c = s.case("fit-and-control", "SPLINE with control points AND unrelated fit points (which is drawn?)", tags=["SPLINE", "fit-points", "control-points"])
    sp = c.msp.add_open_spline(CTRL, degree=3)
    sp.fit_points = [Vec3(x, 150 - y) for x, y in FIT]
    c.window((0, 0), (200, 150))
    # ezdxf's CAD-like control frame from fit points: compare to AutoCAD's own solution
    c = s.case("cad-control-frame", "Control-point SPLINE computed by ezdxf add_cad_spline_control_frame for FIT", tags=["SPLINE", "fit-points"])
    c.msp.add_cad_spline_control_frame(FIT)
    c.window((0, 0), (200, 150))
    # $SPLFRAME: control frame display/plot
    for fr in (0, 1):
        c = s.case(f"splframe-{fr}", f"Cubic SPLINE with $SPLFRAME={fr} (is the frame plotted?)", tags=["SPLINE", "SPLFRAME"], header={"$SPLFRAME": fr})
        c.msp.add_open_spline(CTRL, degree=3)
        c.window((0, 0), (200, 150))
    # 3D spline, planar/linear flags
    c = s.case("spline-3d", "Non-planar cubic SPLINE (plan projection)", tags=["SPLINE", "3d"])
    c.msp.add_open_spline([(20, 20, 0), (40, 130, 100), (80, 20, -50), (120, 130, 30), (160, 20, 80), (180, 100, 0)], degree=3)
    c.window((0, 0), (200, 150))
    c = s.case("linear-flag", "Degree-1 SPLINE with linear flag 16 and planar flag 8", tags=["SPLINE", "flags"])
    sp = c.msp.add_open_spline(CTRL, degree=1)
    sp.dxf.flags = 8 | 16
    c.window((0, 0), (200, 150))
    # tessellation: large spline, many control points, tiny spline
    for i, (scale, pxu) in enumerate([(0.05, 100), (1, 10), (50, 0.2)], 1):
        c = s.case(f"size-{i:04d}", f"Cubic SPLINE scaled x{scale} at {pxu} px/unit", tags=["SPLINE", "tessellation"], questions=["Q-0181"], params={"scale": scale, "px_per_unit": pxu})
        pts = [(x * scale, y * scale) for x, y in CTRL]
        c.msp.add_open_spline(pts, degree=3)
        c.window_center((100 * scale, 75 * scale), pxu)
    c = s.case("many-control-points", "Cubic SPLINE with 200 control points on a sine wave", tags=["SPLINE", "tessellation"], questions=["Q-0181"])
    c.msp.add_open_spline([(10 + i * 0.9, 75 + 55 * math.sin(i / 7)) for i in range(200)], degree=3)
    c.window((0, 0), (200, 150))
    # random seeds
    for seed in range(1, 7):
        c = s.case(f"random-{seed:04d}", f"Random SPLINEs (degree 2-4, some rational), seed {seed}", tags=["SPLINE"], seed=seed)
        rng = c.rng
        for _ in range(4):
            n = rng.randint(4, 9)
            pts = [(rng.uniform(10, 190), rng.uniform(10, 140)) for _ in range(n)]
            deg = rng.randint(2, min(4, n - 1))
            if rng.random() < 0.3:
                c.msp.add_rational_spline(pts, [rng.uniform(0.3, 3) for _ in pts], degree=deg)
            else:
                c.msp.add_open_spline(pts, degree=deg)
        c.window((0, 0), (200, 150))

    _question_cases(s)


def _question_cases(s: SuiteBuilder) -> None:
    # Q-0169: flag 2048 on an open spline
    c = s.case("flag-2048", "Open cubic SPLINE with 70 bit 2048 set", tags=["SPLINE", "flags"], questions=["Q-0169"])
    sp = c.msp.add_open_spline(CTRL, degree=3)
    sp.dxf.flags = 2048
    c.window((0, 0), (200, 150))
    # Q-0170: SPLINE without knots (72=0)
    c = s.case("no-knots", "Degree-3 SPLINE with 6 control points and no knots (72=0)", tags=["SPLINE", "knots", "invalid"], questions=["Q-0170"])
    c.allow_audit_errors = True
    sp = c.msp.add_open_spline(CTRL, degree=3)
    sp.knots = []
    c.window((0, 0), (200, 150))
    # Q-0173: only one end tangent
    for which in ("start", "end"):
        c = s.case(f"fit-one-tangent-{which}", f"Fit-point-only SPLINE with only the {which} tangent set", tags=["SPLINE", "fit-points", "tangents"], questions=["Q-0173"], params={"tangent": which})
        sp = c.msp.add_spline(FIT, degree=3)
        if which == "start":
            sp.dxf.start_tangent = (0, 1, 0)
        else:
            sp.dxf.end_tangent = (0, -1, 0)
        c.window((0, 0), (200, 150))
    # Q-0174: zero-vector tangents
    c = s.case("fit-zero-tangents", "Fit-point-only SPLINE with start/end tangents (0,0,0)", tags=["SPLINE", "fit-points", "tangents", "invalid"], questions=["Q-0174"])
    c.allow_audit_errors = True
    sp = c.msp.add_spline(FIT, degree=3)
    sp.dxf.start_tangent = (1, 2, 0)
    sp.dxf.end_tangent = (3, 4, 0)
    c.byte_filters.append(lambda d: d.replace(b"\n 12\n1.0\n 22\n2.0\n 32\n0.0\n", b"\n 12\n0.0\n 22\n0.0\n 32\n0.0\n", 1).replace(b"\n 13\n3.0\n 23\n4.0\n 33\n0.0\n", b"\n 13\n0.0\n 23\n0.0\n 33\n0.0\n", 1))
    c.window((0, 0), (200, 150))
    # Q-0175: knot parameterisation flags with fit points only
    for flag in (64, 128):
        for tang in (False, True):
            c = s.case(f"fit-param-{flag}{'-tangents' if tang else ''}", f"Fit-point-only SPLINE with 70 bit {flag}{' and tangents' if tang else ''}", tags=["SPLINE", "fit-points", "knot-parameterization"], questions=["Q-0175"], params={"flag": flag, "tangents": tang})
            sp = c.msp.add_spline(FIT, degree=3)
            sp.dxf.flags = flag
            if tang:
                sp.dxf.start_tangent = (1, 0, 0)
                sp.dxf.end_tangent = (1, 0, 0)
            c.window((0, 0), (200, 150))
    # Q-0176: closed fit-point-only spline flags 1|2|1024
    ring = [(100 + 60 * math.cos(a), 75 + 50 * math.sin(a)) for a in [i * math.tau / 5 for i in range(5)]]
    c = s.case("fit-closed-periodic", "Fit-point-only SPLINE with 70 = 1|2|1024 (closed periodic), 5 fit points", tags=["SPLINE", "fit-points", "closed", "periodic"], questions=["Q-0176"])
    sp = c.msp.add_spline(ring, degree=3)
    sp.dxf.flags = 1 | 2 | 1024
    c.window((0, 0), (200, 150))
    # Q-0177: fit tolerance values
    for tol in (1.0, 0.1):
        c = s.case(f"fit-tolerance-{str(tol).replace('.', 'p')}", f"Fit-point-only SPLINE (6 points) with fit tolerance 44={tol}", tags=["SPLINE", "fit-points"], questions=["Q-0177"], params={"fit_tolerance": tol})
        sp = c.msp.add_spline(FIT + [(185, 140)], degree=3)
        sp.dxf.fit_tolerance = tol
        c.window((0, 0), (200, 150))
    # Q-0179: nearly-equal clamped end knots, doubled interior knots
    kn = {
        "nearly-equal-end": [0, 0, 0, 0, 0.5, 0.5, 0.5000000000000006, 1, 1, 1, 1],
        "doubled-interior": [0, 0, 0, 0, 0.3, 0.3, 0.7, 1, 1, 1, 1],
    }
    for name, knots in kn.items():
        c = s.case(f"knots-{name}", f"Cubic SPLINE, 7 control points, knots {name}", tags=["SPLINE", "knots"], questions=["Q-0179"], params={"knots": knots})
        pts = [(20, 20), (40, 130), (70, 20), (100, 130), (130, 20), (160, 130), (185, 60)]
        sp = c.msp.add_spline()
        sp.dxf.degree = 3
        sp.control_points = [Vec3(p) for p in pts]
        sp.knots = knots
        _frame(c, pts)
        c.window((0, 0), (200, 150))
    # Q-0180: rational quarter circle vs ARC
    c = s.case("rational-quarter-circle", "Rational quadratic SPLINE quarter circle (weights 1, sqrt2/2, 1) beside an identical ARC", tags=["SPLINE", "rational", "ARC"], questions=["Q-0180"])
    w = math.sqrt(0.5)
    sp = c.msp.add_spline()
    sp.dxf.degree = 2
    sp.control_points = [Vec3(40, 20), Vec3(40, 120), Vec3(140, 120)]
    sp.knots = [0, 0, 0, 1, 1, 1]
    sp.weights = [1, w, 1]
    sp.dxf.flags = 4
    c.layer("REF", color=1, lineweight=0)
    c.msp.add_arc((142, 20), 100, 90, 180, dxfattribs={"layer": "REF"})  # shifted by 2 units to the right
    c.window((0, 0), (200, 150))
    # Q-0182: HELIX in plan view (drawn from its embedded spline?)
    c = s.case("helix", "HELIX r=50, 3 turns, height 30 in plan view", tags=["HELIX", "SPLINE"], questions=["Q-0182"])
    c.msp.add_helix(radius=50, pitch=10, turns=3, dxfattribs={"axis_base_point": (100, 75, 0)})
    c.window((0, 0), (200, 150))
