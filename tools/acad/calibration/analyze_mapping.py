"""T-PL-1: world -> pixel mapping for Window + Fit + Center (cases calibration/mapping-*).

    tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_mapping.py

Model:  u = (x - xmin) * W / (xmax - xmin),  v = (y - ymin) * H / (ymax - ymin)
        column = floor(u), image row = H - 1 - floor(v)
Probes whose device coordinate lies within 1e-6 px of an integer are exact ties; they are
reported separately (the scan cases show where AutoCAD's floating-point noise flips them).
"""

from __future__ import annotations

import math

import numpy as np
from callib import Case

TIE = 1e-6


def lit_cols(c: Case, y0: float, y1: float, near: float) -> list[int]:
    r0 = max(0, c.H - 1 - math.floor(c.v(y1)) + 1)
    r1 = min(c.H, c.H - 1 - math.floor(c.v(y0)))
    band = c.ink[r0:r1]
    cols = np.flatnonzero(band.any(axis=0))
    return [int(x) for x in cols if abs(x + 0.5 - near) < 3]


def lit_rows(c: Case, x0: float, x1: float, near_v: float) -> list[int]:
    c0 = max(0, math.floor(c.u(x0)) + 1)
    c1 = min(c.W, math.floor(c.u(x1)))
    band = c.ink[:, c0:c1]
    rows = np.flatnonzero(band.any(axis=1))
    return [int(r) for r in rows if abs((c.H - 1 - r) + 0.5 - near_v) < 3]


def probe_cases() -> None:
    for name in ("mapping-2000x1500", "mapping-ties-2000x1500", "mapping-ties-1000x1000", "mapping-ties-800x600"):
        c = Case(name)
        stats = {"ok": 0, "bad": 0, "tie": 0, "tie_floor": 0, "tie_ceil1": 0, "clipped": 0}
        bad = []
        for p in c.meta["params"]["xprobes"]:
            u = c.u(p["x"])
            got = lit_cols(c, p["y0"], p["y1"], u)
            if abs(u - round(u)) < TIE:
                stats["tie"] += 1
                k = round(u)
                stats["tie_floor"] += got == [k]
                stats["tie_ceil1"] += got == [k - 1]
                continue
            if not (0 <= u <= c.W):
                stats["clipped"] += got == []
                continue
            want = [math.floor(u)]
            if got == want:
                stats["ok"] += 1
            else:
                stats["bad"] += 1
                bad.append(("x", round(u, 6), got, want))
        for p in c.meta["params"]["yprobes"]:
            v = c.v(p["y"])
            got = lit_rows(c, p["x0"], p["x1"], v)
            if p["x1"] > c.xmax:  # generator placed a few probes (partly) right of the window
                stats["clipped"] += got == []
                continue
            if abs(v - round(v)) < TIE:
                stats["tie"] += 1
                k = round(v)
                stats["tie_floor"] += got == [c.H - 1 - k]
                stats["tie_ceil1"] += got == [c.H - k]
                continue
            if not (0 <= v <= c.H):
                stats["clipped"] += got == []
                continue
            want = [c.H - 1 - math.floor(v)]
            if got == want:
                stats["ok"] += 1
            else:
                stats["bad"] += 1
                bad.append(("y", round(v, 6), got, want))
        print(f"{name:26s} non-tie probes ok {stats['ok']}, wrong {stats['bad']}; exact ties {stats['tie']} "
              f"(floor {stats['tie_floor']}, ceil-1 {stats['tie_ceil1']}); outside-window probes not drawn {stats['clipped']}")
        for b in bad[:5]:
            print("    wrong:", b)


def runs(s: str) -> list[str]:
    out = []
    i = 0
    while i < len(s):
        j = i
        while j < len(s) and s[j] == s[i]:
            j += 1
        out.append(f"{s[i]}[{i}..{j - 1}]")
        i = j
    return out


def scan_cases() -> None:
    """Exact integer device coordinates k: F = drawn in pixel k (floor), C = pixel k-1."""
    for name in ("mapping-scan-2000x1500", "mapping-scan-1000x1000", "mapping-scan-800x600"):
        c = Case(name)
        ink = c.ink
        b = c.meta["params"]["bands"]
        xs = {}
        for par in (0, 1):
            f0, f1 = b["x_even" if par == 0 else "x_odd"]
            r0, r1 = c.H - int(f1 * c.H) + 3, c.H - int(f0 * c.H) - 3
            cols = set(np.flatnonzero(ink[r0:r1].all(axis=0)).tolist())
            for k in range(par, c.W + 1, 2):
                xs[k] = "?" if (k in cols and k - 1 in cols) else "F" if k in cols else "C" if k - 1 in cols else "-"
        ys = {}
        for par in (0, 1):
            f0, f1 = b["y_even" if par == 0 else "y_odd"]
            c0, c1 = int(f0 * c.W) + 3, int(f1 * c.W) - 3
            rows = set(np.flatnonzero(ink[:, c0:c1].all(axis=1)).tolist())
            for k in range(par, c.H + 1, 2):
                rf, rc = c.H - 1 - k, c.H - k
                ys[k] = "?" if (rf in rows and rc in rows) else "F" if rf in rows else "C" if rc in rows else "-"
        print(f"{name:26s} x ties: {runs(''.join(xs[k] for k in range(c.W + 1)))}  y ties: {runs(''.join(ys[k] for k in range(c.H + 1)))}")


def offset_case() -> None:
    c = Case("mapping-offset")
    ok = 0
    n = 0
    for x, y in c.meta["params"]["crosses"]:
        u, v = c.u(x), c.v(y)
        col = math.floor(u)
        row = c.H - 1 - math.floor(v)
        n += 1
        # vertical arm: ink in column `col` a few rows above the centre; horizontal arm: row `row`
        ok += bool(c.ink[row - 6 : row - 2, col].all()) and bool(c.ink[row, col - 6 : col - 2].all())
    print(f"mapping-offset (window {c.xmin},{c.ymin} .. {c.xmax},{c.ymax}, {c.s} px/unit): {ok}/{n} crosses at (floor u, floor v)")


if __name__ == "__main__":
    probe_cases()
    offset_case()
    scan_cases()
