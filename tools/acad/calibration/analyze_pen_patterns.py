"""CTB pen linetypes and fill styles measured on the references of suite ``plotstyles`` (tools/gen):
``lt-*`` (pen linetypes 0-30), ``fill-phase*`` (fill styles 65-72).

    tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_pen_patterns.py [--lt CASE] [--fills]

Linetypes are read from the PDF of each case (truedxf PDF.pc3 writes every dash as its own
``x y m x y l S`` stroke in integer device units of 1/600 in, research/notes/08 §10.9), so dash and
gap lengths are exact to 1/600 in = 0.0423 mm. Prints, per pen linetype, the dash/gap sequence of
the long line (in 1/600 in and in mm) and the first/last dash of every line, i.e. the data of the
tables in research/notes/06 §6.7. Fill styles are read from the PNGs (device-pixel tiles, §6.8).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
REFS = REPO / "samples" / "refs" / "acad2027-R26.0" / "plotstyles"
GEN = REPO / "samples" / "generated" / "plotstyles"
U = 25.4 / 600  # mm per PDF device unit

STROKE = re.compile(r"(-?\d+) (-?\d+) m\n(-?\d+) (-?\d+) l\nS")


def segments(case: str) -> list[tuple[int, int, int, int]]:
    import pymupdf

    content = pymupdf.open(str(REFS / f"{case}.pdf"))[0].read_contents().decode("latin1")
    return [tuple(int(v) for v in m.groups()) for m in STROKE.finditer(content)]


def device(meta: dict, x: float, y: float) -> tuple[float, float]:
    a = meta["plot"]["area"]
    (x0, y0), (x1, _) = a["min"], a["max"]
    s = 12000 / (x1 - x0)  # 20 in sheet = 12000 device units
    return (x - x0) * s, (y - y0) * s


def runs_on_row(segs, y: float, xa: float, xb: float, tol: float = 2.0):
    """Horizontal strokes on device row y between xa and xb, sorted, as (start, end)."""
    out = []
    for x1, y1, x2, y2 in segs:
        if y1 == y2 and abs(y1 - y) <= tol and min(x1, x2) >= xa - 3 and max(x1, x2) <= xb + 3:
            out.append((min(x1, x2), max(x1, x2)))
    return sorted(set(out))


def describe(runs, xa: float) -> str:
    parts = []
    for i, (s, e) in enumerate(runs):
        gap = runs[i + 1][0] - e if i + 1 < len(runs) else None
        parts.append(f"{e - s}" + (f"/{gap}" if gap is not None else ""))
    return f"start {runs[0][0] - xa:+.0f}: " + " ".join(parts) if runs else "(nothing)"


def linetypes(case: str, nshow: int = 14) -> None:
    meta = json.loads((GEN / f"{case}.json").read_text(encoding="utf-8"))
    f = meta["params"]["factor"]
    lines = meta["params"]["lines"]
    segs = segments(case)
    print(f"== {case}: {meta['title']}")
    for k in range(31):
        y = 146 - 4.7 * k
        out = []
        for x0, x1, dy in lines:
            (xa, yy), (xb, _) = device(meta, x0 * f, (y + dy) * f), device(meta, x1 * f, (y + dy) * f)
            r = runs_on_row(segs, round(yy), xa, xb)
            out.append((xa, xb, r))
        xa, xb, r = out[0]
        print(f"lt {k:2d}: long {len(r):3d} dashes, {describe(r[:nshow], xa)} ... end {xb - r[-1][1]:+.0f}" if r else f"lt {k:2d}: -")
        for xa, xb, r in out[1:]:
            print(f"        short {xb - xa:6.0f}: {describe(r, xa)} end {xb - r[-1][1]:+.0f}" if r else "        short: -")


# Measured CTB pen linetype definitions (research/notes/06 §6.7), in 1/600 inch on the sheet:
# dash >= 0 (0 = dot), gap < 0. Values are exact multiples of 0.005 in.
PEN_LINETYPES: dict[int, list[int]] = {
    1: [90, -60], 2: [0, -60], 3: [78, -36, 0, -36], 4: [75, -225], 5: [150, -150], 6: [225, -75],
    7: [150, -450], 8: [300, -300], 9: [450, -150], 10: [180, -120], 11: [120, -36, 36, -36, 36, -36],
    12: [210, -30, 30, -30], 13: [210, -30, 0, -30, 0, -30], 14: [240, -30, 0, -30],
    15: [150, -30, 0, -30, 30, -30, 0, -30], 16: [0, -300], 17: [141, -36], 18: [141, -213],
    19: [282, -36, 0, -36], 20: [282, -36, 0, -36, 0, -36], 21: [282, -36, 0, -36, 0, -36, 0, -36],
    22: [0, -237], 23: [282, -36, 72, -36], 24: [282, -36, 72, -36, 72, -36], 25: [141, -36, 0, -36],
    26: [141, -36, 141, -36, 0, -36], 27: [141, -36, 0, -36, 0, -36], 28: [141, -36, 141, -36, 0, -36, 0, -36],
    29: [141, -36, 0, -36, 0, -36, 0, -36], 30: [141, -36, 141, -36, 0, -36, 0, -36, 0, -36],
}


def model(lt: int, length: float, adaptive: bool) -> list[tuple[float, float]]:
    """Dash intervals of pen linetype ``lt`` on a straight run of ``length`` device units.
    Fixed: the pattern starts at phase 0 at the start point and is cut at the end. Adaptive: the
    pattern is scaled to N = max(1, round(length / P)) repetitions of P (P = the pattern length for
    linetypes 1-16, 300 = 0.5 in for the ISO linetypes 17-30) and starts in the middle of its
    first dash."""
    pat = PEN_LINETYPES[lt]
    period = sum(abs(v) for v in pat)
    s, pos = 1.0, 0.0
    if adaptive:
        fit = period if lt <= 16 else 300
        s = length / (max(1, round(length / fit)) * fit)
        pos = -pat[0] * s / 2
    out = []
    i = 0
    while pos <= length + 1e-9:
        v = pat[i % len(pat)] * s
        if v >= 0:
            a, b = max(pos, 0.0), min(pos + v, length)
            if b >= a:
                out.append((a, b))
            pos += v
        else:
            pos -= v
        i += 1
    return out


def verify(case: str) -> tuple[int, int]:
    """Compares every line of an lt-* case with ``model``; returns (lines ok, lines)."""
    meta = json.loads((GEN / f"{case}.json").read_text(encoding="utf-8"))
    f = meta["params"]["factor"]
    adaptive = "adaptive True" in meta["title"]
    segs = segments(case)
    ok = n = 0
    for k in range(1, 31):
        y = 146 - 4.7 * k
        for x0, x1, dy in meta["params"]["lines"]:
            (xa, yy), (xb, _) = device(meta, x0 * f, (y + dy) * f), device(meta, x1 * f, (y + dy) * f)
            got = [(a - xa, b - xa) for a, b in runs_on_row(segs, round(yy), xa, xb)]
            exp = model(k, xb - xa, adaptive)
            # a dot within 1 unit of the end point may or may not be drawn (floating-point end
            # test, both happen): ignore it on both sides
            def trim(v, L=xb - xa):
                return v[:-1] if v and v[-1][1] - v[-1][0] < 1 and abs(v[-1][0] - L) < 1.5 else v

            got, exp = trim(got), trim(exp)
            good = len(got) == len(exp) and all(abs(g[0] - e[0]) <= 1.5 and abs(g[1] - e[1]) <= 1.5 for g, e in zip(got, exp))
            n += 1
            ok += good
            if not good:
                print(f"  MISMATCH {case} lt {k} line {x0}-{x1}: got {got[:4]}... exp {[(round(a), round(b)) for a, b in exp[:4]]}... ({len(got)} vs {len(exp)})")
    return ok, n


# CTB fill styles on the raster device (research/notes/06 §6.8): ink at device pixel (u, v), u = column
# from the left, v = row from the bottom (all harness canvases are multiples of 20 px high, so a
# top-anchored tile gives the same pixels). Independent of the object position and the plot scale.
FILL_STYLES = {
    65: lambda u, v: (u % 10 <= 4 and v % 10 <= 4) and (u % 10 in (0, 4) or v % 10 in (0, 4)),  # checkerboard: 5x5 outlines
    66: lambda u, v: u % 10 == 0 or v % 10 == 0,  # crosshatch
    67: lambda u, v: (u + v) % 20 == 0 or (u - v) % 20 == 0,  # diamonds
    68: lambda u, v: v % 10 == 0,  # horizontal bars
    69: lambda u, v: (u + v) % 20 == 0,  # slant left (\)
    70: lambda u, v: (u - v) % 20 == 0,  # slant right (/)
    71: lambda u, v: u % 10 <= 1 and v % 10 <= 1,  # square dots 2x2
    72: lambda u, v: u % 10 == 0,  # vertical bars
}


def fills(case: str, f: float) -> tuple[int, int]:
    """Checks the interior of every fill-phase region (3 px inset) against FILL_STYLES."""
    import numpy as np
    from PIL import Image

    a = np.array(Image.open(REFS / f"{case}.png").convert("RGB"))
    ink = a.min(axis=2) < 255
    H = a.shape[0]
    s = 10 / f
    ok = n = 0
    for k in range(8):
        style = 65 + k
        x0 = 5 + 24 * k
        boxes = [(x0 + dx, y0 + dy, x0 + dx + 20, y0 + dy + 20) for y0, dx, dy in ((120, 0, 0), (95, 0.13, 0.37), (70, 0.55, 0.71))]
        boxes += [(x0, 45, x0 + 20, 65), (x0, 28, x0 + 20, 36)]  # HATCH, wide LWPOLYLINE
        for bx0, by0, bx1, by1 in boxes:
            c0, c1 = int(bx0 * f * s) + 3, int(bx1 * f * s) - 3
            r0, r1 = int(H - by1 * f * s) + 3, int(H - by0 * f * s) - 3
            bad = 0
            for r in range(r0, r1):
                for col in range(c0, c1):
                    bad += ink[r, col] != FILL_STYLES[style](col, H - 1 - r)
            n += 1
            ok += bad == 0
            if bad:
                print(f"  MISMATCH {case} style {style} box {bx0},{by0}: {bad} px")
    return ok, n


def main() -> None:
    args = sys.argv[1:]
    cases = [args[i + 1] for i, a in enumerate(args) if a == "--lt"]
    for c in cases:
        linetypes(c)
    if not cases:
        for c in ("lt-fixed", "lt-adaptive", "lt-fixed-size-1", "lt-adaptive-size-1", "lt-fixed-size-0-2",
                  "lt-fixed-scale-half", "lt-fixed-mm"):
            if (REFS / f"{c}.pdf").exists():
                ok, n = verify(c)
                print(f"{'PASS' if ok == n else 'FAIL'} {c}: {ok}/{n} lines match the measured definitions")
        for c, f in (("fill-phase", 1.0), ("fill-phase-scale-half", 2.0)):
            if (REFS / f"{c}.png").exists():
                ok, n = fills(c, f)
                print(f"{'PASS' if ok == n else 'FAIL'} {c}: {ok}/{n} fill regions match the device-pixel tiles")


if __name__ == "__main__":
    main()
