"""T-PL-2: which pixels a lineweight-0 LINE lights (case calibration/raster-lines).

    tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_lines.py [-v]

Compares the reference PNG against candidate rasterization rules, per line (each line has its own
10 x 10-unit cell). Lines with an endpoint exactly on a pixel boundary are reported separately:
exact ties are resolved by floating-point noise in AutoCAD (research/notes/08 §10.2).
"""

from __future__ import annotations

import math
import sys
from fractions import Fraction as Fr
from typing import Callable

from callib import Case

Pt = tuple[int, int]


def observed(c: Case, cell: list[int]) -> set[Pt]:
    """Ink pixels of one cell as (col, bottom-up row index)."""
    col, row = cell
    x0, y0 = col * 10 + 1.0, row * 10 + 1.0
    c0 = max(0, math.floor(c.u(x0)))
    c1 = min(c.W - 1, math.floor(c.u(x0 + 10)) - 1)
    r1 = min(c.H - 1, c.H - 1 - math.floor(c.v(y0)))
    r0 = max(0, c.H - 1 - math.floor(c.v(y0 + 10)) + 1)
    ink = c.ink
    out: set[Pt] = set()
    for r in range(r0, r1 + 1):
        for x in range(c0, c1 + 1):
            if ink[r, x]:
                out.add((x, c.H - 1 - r))
    return out


def rnd(fr: Fr, half_down: bool) -> int:
    fl = fr.numerator // fr.denominator
    rem = fr - fl
    if rem != Fr(1, 2):
        return fl + (1 if rem > Fr(1, 2) else 0)
    return fl if half_down else fl + 1


def ideal_line(x0: int, y0: int, x1: int, y1: int, half_down: bool) -> set[Pt]:
    """Pixels of the exact line between two pixel centres, rounded along the minor axis."""
    dx, dy = x1 - x0, y1 - y0
    pts: set[Pt] = set()
    if dx == 0 and dy == 0:
        return {(x0, y0)}
    if abs(dx) >= abs(dy):
        for x in range(min(x0, x1), max(x0, x1) + 1):
            pts.add((x, rnd(Fr(y0) + Fr(dy * (x - x0), dx), half_down)))
    else:
        for y in range(min(y0, y1), max(y0, y1) + 1):
            pts.add((rnd(Fr(x0) + Fr(dx * (y - y0), dy), half_down), y))
    return pts


def acad_line(x0: int, y0: int, x1: int, y1: int) -> set[Pt]:
    """Best-fitting model (research/notes/08 §10.3): the exact line between the two snapped pixel centres,
    minor axis rounded to the nearest pixel; exact halves go toward the END point for x-major
    lines (|dx| >= |dy|) and toward the START point for y-major lines."""
    dx, dy = x1 - x0, y1 - y0
    if dx == 0 and dy == 0:
        return {(x0, y0)}
    pts: set[Pt] = set()
    xmaj = abs(dx) >= abs(dy)
    a0, b0, a1, b1, da, db = (x0, y0, x1, y1, dx, dy) if xmaj else (y0, x0, y1, x1, dy, dx)
    for a in range(min(a0, a1), max(a0, a1) + 1):
        f = Fr(b0) + Fr(db * (a - a0), da)
        fl = f.numerator // f.denominator
        rem = f - fl
        if rem == Fr(1, 2):
            target = b1 if xmaj else b0
            b = fl if target < f else fl + 1
        else:
            b = fl + (1 if rem > Fr(1, 2) else 0)
        pts.add((a, b) if xmaj else (b, a))
    return pts


def bresenham(x0: int, y0: int, x1: int, y1: int) -> set[Pt]:
    pts = []
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        pts.append((x0, y0))
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy
    return set(pts)


def centre_sampling(u0: float, v0: float, u1: float, v1: float) -> set[Pt]:
    """Sub-pixel DDA: minor coordinate of the exact line at each major-axis pixel centre."""
    pts: set[Pt] = set()
    xmaj = abs(u1 - u0) >= abs(v1 - v0)
    if not xmaj:
        u0, v0, u1, v1 = v0, u0, v1, u1
    if u0 > u1:
        u0, v0, u1, v1 = u1, v1, u0, v0
    m = (v1 - v0) / (u1 - u0) if u1 != u0 else 0.0
    for i in range(math.floor(u0), math.floor(u1) + 1):
        j = math.floor(v0 + (i + 0.5 - u0) * m)
        pts.add((i, j) if xmaj else (j, i))
    return pts


def main() -> None:
    verbose = "-v" in sys.argv
    c = Case("raster-lines")
    H = c.H

    def snapped(u0, v0, u1, v1):
        return math.floor(u0), math.floor(v0), math.floor(u1), math.floor(v1)

    def image_rows(f):
        # run a rule in image coordinates (row index grows downwards)
        def g(u0, v0, u1, v1):
            x0, b0, x1, b1 = snapped(u0, v0, u1, v1)
            return {(x, H - 1 - r) for (x, r) in f(x0, H - 1 - b0, x1, H - 1 - b1)}

        return g

    cands: dict[str, Callable[..., set[Pt]]] = {
        "snap floor + exact line, ties x-major->end, y-major->start": lambda *a: acad_line(*snapped(*a)),
        "snap floor + exact line, ties to lower IMAGE index": image_rows(lambda *a: ideal_line(*a, True)),
        "snap floor + exact line, ties to higher IMAGE index": image_rows(lambda *a: ideal_line(*a, False)),
        "snap floor + exact line, ties to lower DEVICE index": lambda *a: ideal_line(*snapped(*a), True),
        "snap floor + Bresenham (integer)": lambda *a: bresenham(*snapped(*a)),
        "sub-pixel DDA at pixel centres": centre_sampling,
    }
    for subset in ("no endpoint on a pixel boundary", "all lines"):
        tot = {k: [0, 0] for k in cands}
        n = 0
        for ln in c.meta["params"]["lines"]:
            u0, v0 = c.u(ln["p0"][0]), c.v(ln["p0"][1])
            u1, v1 = c.u(ln["p1"][0]), c.v(ln["p1"][1])
            tie = any(abs(t - round(t)) < 1e-6 for t in (u0, v0, u1, v1))
            if subset.startswith("no") and tie:
                continue
            n += 1
            obs = observed(c, ln["cell"])
            for k, f in cands.items():
                p = f(u0, v0, u1, v1)
                tot[k][0] += len(p ^ obs)
                tot[k][1] += p == obs
                if verbose and p != obs and k.startswith("snap floor + exact line, ties to lower IMAGE"):
                    print(f"   miss ({u0:.3f},{v0:.3f})->({u1:.3f},{v1:.3f}) extra={sorted(p - obs)[:4]} missing={sorted(obs - p)[:4]}")
        print(f"{subset}: {n} lines")
        for k, (diff, exact) in tot.items():
            print(f"  {k:55s} exact {exact:3d}/{n}  pixel sym-diff {diff}")


if __name__ == "__main__":
    main()
