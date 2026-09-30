"""T-PL-2: coverage rule of filled SOLID / solid HATCH (case calibration/raster-fills).

    tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_fills.py [-v]

Candidates (device coordinates, v up, pixel (i, j) = [i, i+1) x [j, j+1)):
  exact-centre      pixel centre (i+.5, j+.5) inside the exact polygon
  snap-centre       vertices snapped to their pixel (floor), polygon through the pixel centres,
                    pixel centre inside (boundary included)
  snap-centre+edge  snap-centre plus the 1-px Bresenham outline of the snapped polygon
  best              vertices snapped to integer pixel indices, sample point (i + 0.5, j) (the
                    scanline runs along the lower pixel edge), boundary inclusive
Shapes with a vertex exactly on a pixel boundary are skipped.
"""

from __future__ import annotations

import math
import sys

from analyze_lines import ideal_line
from callib import Case


def inside(poly: list[tuple[float, float]], x: float, y: float, eps: float = 1e-12) -> int:
    """1 inside, 0 outside, 2 on the boundary (convex or simple polygon, even-odd)."""
    n = len(poly)
    for k in range(n):
        (x0, y0), (x1, y1) = poly[k], poly[(k + 1) % n]
        cross = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0)
        if abs(cross) < eps and min(x0, x1) - eps <= x <= max(x0, x1) + eps and min(y0, y1) - eps <= y <= max(y0, y1) + eps:
            return 2
    c = False
    for k in range(n):
        (x0, y0), (x1, y1) = poly[k], poly[(k + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            c = not c
    return 1 if c else 0


def raster(poly, rule: str, sx: float = 0.5, sy: float = 0.5) -> set[tuple[int, int]]:
    """Pixels whose sample point (i + sx, j + sy) lies inside `poly`."""
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    out = set()
    for i in range(math.floor(min(xs)) - 1, math.floor(max(xs)) + 2):
        for j in range(math.floor(min(ys)) - 1, math.floor(max(ys)) + 2):
            r = inside(poly, i + sx, j + sy)
            if r == 1 or (r == 2 and rule == "incl"):
                out.add((i, j))
    return out


def main() -> None:
    verbose = "-v" in sys.argv
    c = Case("raster-fills")
    ink = c.ink
    polys = [("solid", p) for p in c.meta["params"]["solids"]] + [("hatch", p) for p in c.meta["params"]["hatches"]]
    stats: dict[str, list[int]] = {}
    for kind, pts in polys:
        dev = [(c.u(x), c.v(y)) for x, y in pts]
        xs = [p[0] for p in dev]
        ys = [p[1] for p in dev]
        c0, c1 = math.floor(min(xs)) - 12, math.floor(max(xs)) + 12
        b0, b1 = math.floor(min(ys)) - 12, math.floor(max(ys)) + 12
        obs = {(i, j) for i in range(c0, c1 + 1) for j in range(b0, b1 + 1) if 0 <= c.H - 1 - j < c.H and ink[c.H - 1 - j, i]}
        if any(abs(t - round(t)) < 1e-6 for p in dev for t in p):
            continue  # a vertex exactly on a pixel boundary (FP-noise ties, note 08 §10.2)
        snapped = [(math.floor(x) + 0.5, math.floor(y) + 0.5) for x, y in dev]
        snapped_int = [(float(math.floor(x)), float(math.floor(y))) for x, y in dev]
        outline = set()
        for k in range(len(snapped)):
            (x0, y0), (x1, y1) = snapped[k], snapped[(k + 1) % len(snapped)]
            outline |= ideal_line(int(x0), int(y0), int(x1), int(y1), True)
        cands = {
            "snapped integer vertices, sample (i+.5, j), incl (best)": raster(snapped_int, "incl", 0.5, 0.0),
            "exact-centre (boundary excl)": raster(dev, "excl"),
            "exact-centre (boundary incl)": raster(dev, "incl"),
            "snap-centre (boundary incl)": raster(snapped, "incl"),
            "snap-centre (boundary excl)": raster(snapped, "excl"),
            "snap-centre excl + outline": raster(snapped, "excl") | outline,
            "exact-centre excl + snapped outline": raster(dev, "excl") | outline,
        }
        for k, p in cands.items():
            s = stats.setdefault(f"{kind}: {k}", [0, 0, 0])
            s[0] += p == obs
            s[1] += len(p ^ obs)
            s[2] += 1
            if verbose and p != obs and "(best)" in k:
                print(f"  {kind} {[(round(x, 2), round(y, 2)) for x, y in dev]} extra={sorted(p - obs)[:5]} missing={sorted(obs - p)[:5]}")
    for k, (ok, diff, n) in stats.items():
        print(f"{k:50s} exact {ok:2d}/{n}  sym-diff px {diff}")


if __name__ == "__main__":
    main()
