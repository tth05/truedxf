"""T-PL-3/4: shape of thick strokes (case calibration/thick-probe).

    tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_thick.py [--masks]

All coordinates relative to the snapped endpoint pixel p = (floor u, floor v) (device, v up).
Prints per lineweight: the band of a horizontal line (rows relative to p), of a vertical line
(columns relative to p), the cap profile beyond each end (extra px per row), the footprint of a
zero-length LINE, and the horizontal run per row of the 30/45/60 degree lines.
"""

from __future__ import annotations

import math
import sys
from collections import Counter

from callib import Case, runs


def ink_set(c: Case, u0: float, v0: float, u1: float, v1: float, m: int = 9) -> set[tuple[int, int]]:
    cmin, cmax = math.floor(min(u0, u1)) - m, math.floor(max(u0, u1)) + m
    bmin, bmax = math.floor(min(v0, v1)) - m, math.floor(max(v0, v1)) + m
    out = set()
    for b in range(bmin, bmax + 1):
        r = c.H - 1 - b
        for x in range(cmin, cmax + 1):
            if c.ink[r, x]:
                out.add((x, b))
    return out


def main() -> None:
    c = Case("thick-probe")
    masks = "--masks" in sys.argv
    by_lw: dict[int, dict[str, Counter]] = {}
    for it in c.meta["params"]["items"]:
        lw, kind = it["lw"], it["kind"]
        p0 = it["p0"]
        p1 = it["p1"] or p0
        u0, v0, u1, v1 = c.u(p0[0]), c.v(p0[1]), c.u(p1[0]), c.v(p1[1])
        s0 = (math.floor(u0), math.floor(v0))
        s1 = (math.floor(u1), math.floor(v1))
        px = ink_set(c, u0, v0, u1, v1)
        rec = by_lw.setdefault(lw, {})
        if kind in ("point", "zero"):
            rel = tuple(sorted((x - s0[0], y - s0[1]) for x, y in px))
            rec.setdefault(kind, Counter())[rel] += 1
        elif kind == "h":
            rows = sorted({y - s0[1] for _, y in px})
            rec.setdefault("h_rows", Counter())[(rows[0], rows[-1])] += 1
            left = tuple(s0[0] - min(x for x, y in px if y == s0[1] + dy) for dy in range(rows[0], rows[-1] + 1))
            right = tuple(max(x for x, y in px if y == s0[1] + dy) - s1[0] for dy in range(rows[0], rows[-1] + 1))
            rec.setdefault("h_cap_left(bottom->top)", Counter())[left] += 1
            rec.setdefault("h_cap_right(bottom->top)", Counter())[right] += 1
        elif kind == "v":
            cols = sorted({x - s0[0] for x, _ in px})
            rec.setdefault("v_cols", Counter())[(cols[0], cols[-1])] += 1
        elif kind in ("d30", "d45", "d60", "d10"):
            # horizontal runs in the middle third of the segment
            ymid0 = math.floor(v0 + (v1 - v0) / 3)
            ymid1 = math.floor(v0 + 2 * (v1 - v0) / 3)
            lens = []
            for y in range(ymid0, ymid1 + 1):
                xs = sorted(x for x, yy in px if yy == y)
                if xs:
                    lens.append(xs[-1] - xs[0] + 1)
            rec.setdefault(f"{kind}_hrun", Counter())[tuple(sorted(set(lens)))] += 1
            if kind == "d45":
                cols = []
                xmid = math.floor((u0 + u1) / 2)
                ys = sorted(y for x, y in px if x == xmid)
                cols.append(ys[-1] - ys[0] + 1 if ys else 0)
                rec.setdefault("d45_vrun", Counter())[tuple(cols)] += 1
    for lw, rec in by_lw.items():
        w = max(1, round(lw * 100 / 2540))
        print(f"== lineweight {lw / 100:.2f} mm (round(mm*100/25.4) = {w} px)")
        for k, cnt in rec.items():
            if k in ("point", "zero"):
                for rel, n in cnt.items():
                    xs = [x for x, _ in rel]
                    ys = [y for _, y in rel]
                    print(f"   {k:28s} x{n}: {len(rel)} px, x {min(xs)}..{max(xs)}, y {min(ys)}..{max(ys)}")
                    if masks and k == "zero":
                        for y in range(max(ys), min(ys) - 1, -1):
                            print("        ", "".join("#" if (x, y) in rel else ("+" if (x, y) == (0, 0) else ".") for x in range(min(xs) - 1, max(xs) + 2)))
            else:
                print(f"   {k:28s} {dict(cnt)}")


if __name__ == "__main__":
    _ = runs
    main()
