"""Viewport twist sign and model->paper transform (cases calibration/vp-twist, layout-basic).

    tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_viewports.py

For every viewport, predicts where model points (0,0), (40,0) (arrow tip) and (0,20) land on the
paper under two hypotheses and checks the ink there:
  H-dcs : paper = vp.center + s * (R(twist) * p - view_center)     (view centre in DCS, CCW twist)
  H-wcs : paper = vp.center + s * R(twist) * (p - view_center)     (view centre in WCS)
  and the same with R(-twist).
"""

from __future__ import annotations

import math

from callib import Case


def rot(p, deg):
    a = math.radians(deg)
    return (p[0] * math.cos(a) - p[1] * math.sin(a), p[0] * math.sin(a) + p[1] * math.cos(a))


def ink_near(c: Case, x: float, y: float, r: int = 2) -> bool:
    col = math.floor(c.u(x))
    row = c.H - 1 - math.floor(c.v(y))
    return bool(c.ink[max(0, row - r) : row + r + 1, max(0, col - r) : col + r + 1].any())


def main() -> None:
    c = Case("vp-twist")
    probes = [(0, 0), (40, 0), (0, 20), (20, 0), (0, 10)]
    for vp in c.meta["params"]["viewports"]:
        tw = vp["twist"]
        s = 71 / 100  # viewport height / view height
        vc = (15, 10)
        res = {}
        for name, sign in (("ccw", 1), ("cw", -1)):
            for hyp in ("dcs", "wcs"):
                hits = 0
                for p in probes:
                    if hyp == "dcs":
                        q = rot(p, sign * tw)
                        px, py = vp["center"][0] + s * (q[0] - vc[0]), vp["center"][1] + s * (q[1] - vc[1])
                    else:
                        q = rot((p[0] - vc[0], p[1] - vc[1]), sign * tw)
                        px, py = vp["center"][0] + s * q[0], vp["center"][1] + s * q[1]
                    hits += ink_near(c, px, py)
                res[f"{hyp}/{name}"] = f"{hits}/{len(probes)}"
        print(f"twist {tw:4}: {res}")


if __name__ == "__main__":
    main()
