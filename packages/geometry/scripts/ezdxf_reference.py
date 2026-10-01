"""Dev-only: print ezdxf reference values as JSON for packages/geometry/test/fixtures/ezdxf-reference.json.

Run with the generator venv:  tools/gen/.venv/Scripts/python packages/geometry/scripts/ezdxf_reference.py
Tests never call Python; re-run this only when adding reference cases.
"""

import json
import math

from ezdxf.math import (
    OCS,
    BSpline,
    Vec3,
    bulge_to_arc,
    fit_points_to_cad_cv,
    global_bspline_interpolation,
    estimate_end_tangent_magnitude,
)


def r(v: float) -> float:
    return float(repr(v)) if isinstance(v, float) else v


def vl(vs):
    return [[r(c) for c in v] for v in vs]


out: dict = {}

FIT = [(0, 0, 0), (10, 5, 0), (20, -3, 1), (35, 8, 2), (40, 0, 0)]
out["fit_natural"] = (lambda s: {"cps": vl(s.control_points), "knots": list(s.knots())})(fit_points_to_cad_cv(FIT))
out["fit_tangents"] = (lambda s: {"cps": vl(s.control_points), "knots": list(s.knots())})(
    fit_points_to_cad_cv(FIT, tangents=[(1, 1, 0), (0, -1, 0)])
)
FIT2 = [(0, 0, 0), (3, 4, 0)]
out["fit_two"] = (lambda s: {"cps": vl(s.control_points), "knots": list(s.knots())})(fit_points_to_cad_cv(FIT2))
FIT3 = [(0, 0, 0), (1, 2, 0), (4, 2, 0)]
out["fit_three"] = (lambda s: {"cps": vl(s.control_points), "knots": list(s.knots())})(fit_points_to_cad_cv(FIT3))

# sqrt-chord with tangents (magnitude = total chord length, like fit_points_to_cad_cv)
pts = Vec3.list(FIT)
m1, m2 = estimate_end_tangent_magnitude(pts, method="chord")
s = global_bspline_interpolation(
    pts, degree=3, tangents=(Vec3(1, 1, 0).normalize(m1), Vec3(0, -1, 0).normalize(m2)), method="centripetal"
)
out["fit_tangents_sqrt"] = {"cps": vl(s.control_points), "knots": list(s.knots())}
s = global_bspline_interpolation(
    pts, degree=3, tangents=(Vec3(1, 1, 0).normalize(m1), Vec3(0, -1, 0).normalize(m2)), method="uniform"
)
out["fit_tangents_uniform"] = {"cps": vl(s.control_points), "knots": list(s.knots())}

# Rational, unclamped B-spline evaluation + derivatives
CPS = [(0, 0, 0), (1, 3, 0), (4, 4, 1), (6, 1, 0), (9, 2, -1), (10, 6, 0)]
W = [1, 0.5, 2, 1, 0.75, 1]
KN = [0, 0.5, 1, 2, 3, 3, 4, 5, 6.5, 7]
sp = BSpline(CPS, order=4, knots=KN, weights=W)
t0, t1 = KN[3], KN[len(KN) - 4]
params = [t0 + (t1 - t0) * i / 7 for i in range(8)]
out["rational"] = {
    "params": params,
    "points": vl(sp.point(u) for u in params),
    "derivs": [vl(sp.derivative(u, n=2)) for u in params],
}

# AutoCAD periodic storage: n + p CPs (first p repeat the last p), n + 2p + 1 uniform knots
base = [(math.cos(a) * 5, math.sin(a) * 3, 0) for a in [i * math.tau / 6 for i in range(6)]]
p = 3
wrapped = base[-p:] + base
knots = [float(i) for i in range(len(wrapped) + p + 1)]
sp = BSpline(wrapped, order=p + 1, knots=knots)
t0, t1 = knots[p], knots[len(knots) - 1 - p]
params = [t0 + (t1 - t0) * i / 12 for i in range(13)]
out["periodic"] = {"cps": vl(wrapped), "knots": knots, "params": params, "points": vl(sp.point(u) for u in params)}

# Bulge → arc (ezdxf always reports CCW: center, start angle, end angle, radius)
out["bulge"] = [
    [list(a), list(b), bu, (lambda c: [r(c[0].x), r(c[0].y), r(c[1]), r(c[2]), r(c[3])])(bulge_to_arc(a, b, bu))]
    for a, b, bu in [((0, 0), (10, 0), 1.0), ((0, 0), (10, 0), -0.5), ((1, 2), (4, 7), 0.25), ((3, 3), (-2, 1), -2.5)]
]

# OCS
out["ocs"] = [
    [list(n), list(pt), list(OCS(n).to_wcs(pt))]
    for n, pt in [
        ((0, 0, -1), (10, 5, 3)),
        ((0.01, 0, 1), (1, 2, 3)),
        ((0.02, 0, 1), (1, 2, 3)),
        ((1, 1, 1), (4, -2, 7)),
        ((0, 1, 0), (1, 2, 3)),
        ((-0.3, 0.7, -0.2), (5, 6, -1)),
    ]
]

print(json.dumps(out, indent=None))
