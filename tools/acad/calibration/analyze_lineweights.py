"""T-PL-3: lineweight -> pixel width (cases calibration/lineweights-*).

    tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_lineweights.py

For every standard lineweight: stroke width in px of the horizontal line (ink rows in one column),
the vertical line (ink columns in one row), and the vertical/horizontal run lengths of the 30 and
45 degree lines (perpendicular width = run * cos(angle)). Also the cap overshoot at the line ends.
"""

from __future__ import annotations

import math

import numpy as np
from callib import Case, runs


def measure(name: str) -> list[dict]:
    c = Case(name)
    ink = c.ink
    out = []
    for it in c.meta["params"]["items"]:
        lw = it["lw"]
        # horizontal line: column at the middle, rows around the line
        xm = (it["hx"][0] + it["hx"][1]) / 2
        col = math.floor(c.u(xm))
        rc = c.H - 1 - math.floor(c.v(it["hy"]))
        seg = ink[max(0, rc - 12) : rc + 13, col]
        rr = runs(seg)
        hw = max((b - a + 1 for a, b in rr), default=0)
        hrows = [(a + rc - 12, b + rc - 12) for a, b in rr]
        # horizontal extent -> caps: ink columns of the row through the centre
        row = ink[rc, :]
        hr = [r for r in runs(row) if r[0] <= col <= r[1]]
        hext = hr[0] if hr else None
        # vertical line
        ym = (it["vy"][0] + it["vy"][1]) / 2
        r = c.H - 1 - math.floor(c.v(ym))
        cc = math.floor(c.u(it["vx"]))
        seg = ink[r, max(0, cc - 12) : cc + 13]
        vr = runs(seg)
        vw = max((b - a + 1 for a, b in vr), default=0)
        vcols = [(a + cc - 12, b + cc - 12) for a, b in vr]
        # 30 / 45 deg lines: vertical run at the middle of the segment
        diag = {}
        for key, ang, length in (("d30", 30, 6.0), ("d45", 45, 5 * math.sqrt(2))):
            bx, by = it[key]
            t = 0.5
            mx = bx + math.cos(math.radians(ang)) * length * t
            my = by + math.sin(math.radians(ang)) * length * t
            ccol = math.floor(c.u(mx))
            crow = c.H - 1 - math.floor(c.v(my))
            s = ink[max(0, crow - 15) : crow + 16, ccol]
            rr2 = [q for q in runs(s) if q[0] <= 15 <= q[1]]
            vrun = (rr2[0][1] - rr2[0][0] + 1) if rr2 else 0
            diag[key] = {"vrun": vrun, "perp": round(vrun * math.cos(math.radians(ang)), 2)}
        nominal = lw * 100 / 2540 if lw >= 0 else None
        out.append(
            {
                "lw": lw,
                "nominal_px": round(nominal, 3) if nominal is not None else None,
                "h": hw,
                "h_rows": hrows,
                "v": vw,
                "v_cols": vcols,
                "h_extent": hext,
                "h_expected_extent": (math.floor(c.u(it["hx"][0])), math.floor(c.u(it["hx"][1]))),
                **diag,
            }
        )
    return out


def main() -> None:
    names = ["lineweights-2000x1500", "lineweights-2000x1500-half", "lineweights-4000x3000"]
    res = {n: measure(n) for n in names}
    print("lw(1/100mm) nominal_px | H V d30(vrun/perp) d45(vrun/perp) caps(H: extra px left/right) per case")
    for i, it in enumerate(res[names[0]]):
        line = f"{it['lw']:4d} {str(it['nominal_px']):>6s} |"
        for n in names:
            m = res[n][i]
            e = m["h_extent"]
            ex = m["h_expected_extent"]
            caps = f"{ex[0] - e[0]:+d}/{e[1] - ex[1]:+d}" if e else "?"
            line += f" {m['h']:2d} {m['v']:2d} {m['d30']['vrun']:2d}/{m['d30']['perp']:<5} {m['d45']['vrun']:2d}/{m['d45']['perp']:<5} caps {caps:7s}|"
        print(line)


if __name__ == "__main__":
    np.set_printoptions(linewidth=200)
    main()
