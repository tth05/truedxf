"""Plot style tables and stored page setups (suites ``plotstyles`` and ``pagesetup``, tools/gen).

    tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_plotstyles.py

Checks the rules recorded in research/notes/06 §6.3-§6.4 and 08 §2.1/§2.3/§10.17 against the
references and prints PASS/FAIL per rule (plus the measured values on failure):

- CTB pen ``lineweight``: 0 = object, N >= 1 -> custom_lineweight_table[N-1], out of range = object;
  a table entry of 0.00 mm forces the thinnest line; "plot lineweights" off -> 1 px everywhere.
- pen colour: value = mode_color if present and != -1, else color; low 24 bits = RGB (method
  byte ignored), 0xFFFFFF = object; applied for colour_policy 0/2/3/4/5, ignored for 1/6/7;
  grayscale (policy 2/3) = floor(.299R) + floor(.587G) + floor(.114B); screening s:
  c' = 255 - floor((255 - c) * s / 100), after grayscale. True-colour objects use no pen.
- page setups: rotation 73 maps paper (x, y) to the canvas as described in note 08 §10.17;
  flag 16 -> scale 147 (75 = 0 -> fit), else 142/143.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[3]
REFS = REPO / "samples" / "refs" / "acad2027-R26.0"
GEN = REPO / "samples" / "generated"
WHITE = (255, 255, 255)

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))


def img(case: str):
    p = REFS / f"{case}.png"
    if not p.exists():
        return None
    return Image.open(p).convert("RGB").load()


def runs(px, col: int, h: int = 1500):
    out, start, cur = [], None, None
    for r in range(h):
        c = px[col, r]
        if start is not None and c != cur:
            out.append((start, r - 1, cur))
            start = None
        if c != WHITE and start is None:
            start, cur = r, c
    if start is not None:
        out.append((start, h - 1, cur))
    return out


def at(px, x: float, y: float):
    """Pixel at drawing point (10 px/unit, window 0..200 x 0..150)."""
    return px[int(x * 10), int(1499 - y * 10)]


def gray(c):
    return math.floor(0.299 * c[0]) + math.floor(0.587 * c[1]) + math.floor(0.114 * c[2])


def screen(c, s):
    return tuple(255 - ((255 - v) * s) // 100 for v in c)


def lineweights() -> None:
    px = img("plotstyles/lw-index")
    if px is None:
        return
    # pens 1,2,3,4,5,6,8,9 = lineweight 0,1,2,5,11,26,27,255; entry i = i+2 px, entries 10/11 = 0 mm
    expect = [8, 2, 3, 6, 1, 27, 28, 8]
    got = [b - a + 1 for a, b, _ in runs(px, 1000)][:8]
    check("CTB lineweight: 0 = object, N -> table[N-1], 0.00 entry = thinnest, 255 = object", got == expect, f"{got}")
    for case, exp in (("lw-index-nolw", 1), ("lw-index-nostyles-nolw", 1), ("lw-index-nostyles", 8)):
        p = img(f"plotstyles/{case}")
        if p is None:
            continue
        w = {b - a + 1 for a, b, _ in runs(p, 1000)[:8]}
        check(f"{case}: all lines {exp} px", w == {exp}, f"{w}")


def colours() -> None:
    a, b = img("plotstyles/pen-color-matrix"), img("plotstyles/pen-color-matrix-ref")
    if a is None or b is None:
        return
    meta = json.loads((GEN / "plotstyles" / "pen-color-matrix.json").read_text(encoding="utf-8"))
    acis = meta["params"]["acis"]
    blue = (0, 0, 255)
    bad = []
    # rows: color -1 | color blue | color blue + mode blue | color -1 + mode blue
    for r in range(4):
        pen = None if r == 0 else blue
        for p in range(8):
            x, y = 6 + 24 * p + 10, 110 - 36 * r + 15
            res, obj = at(a, x, y), at(b, x, y)
            src = obj if (pen is None or p in (1, 6, 7)) else pen
            exp = (gray(src),) * 3 if p in (2, 3) else src
            if res != exp:
                bad.append((acis[8 * r + p], p, res, exp))
    check("pen colour vs colour_policy 0-7 and mode_color", not bad, f"{bad}")

    px = img("plotstyles/pen-color-policy")
    if px is not None:
        # policy 5 encodings: FF/C2/C3 blue -> blue; C3 00001E -> 00001E; C3FFFFFF / C2FFFFFF -> object
        cells = {10: (0, 0, 255), 11: (0, 0, 255), 12: (0, 0, 255), 13: (0, 0, 30), 19: (0, 0, 0), 22: (0, 0, 0), 23: (0, 0, 0)}
        bad = []
        for k, exp in cells.items():
            r, col = divmod(k, 6)
            got = at(px, 7 + 32 * col + 13, 112 - 35 * r + 14)
            if got != exp:
                bad.append((k, got, exp))
        check("pen colour = low 24 bits RGB, method byte ignored", not bad, f"{bad}")


def screening() -> None:
    ref = img("colors/aci-grid-full")
    g, s = img("plotstyles/grayscale-aci-grid"), img("plotstyles/screen-50-aci-grid")
    if ref is None or g is None or s is None:
        return
    bg, bs = [], []
    for aci in range(1, 256):
        r, k = divmod(aci, 16)
        x, y = 28 + 9 * k + 4.5, 138 - 9 * r + 4.5
        o = at(ref, x, y)
        if at(g, x, y) != (gray(o),) * 3:
            bg.append(aci)
        if at(s, x, y) != screen(o, 50):
            bs.append(aci)
    check("grayscale = floor(.299R)+floor(.587G)+floor(.114B) (255 ACIs)", not bg, f"{bg}")
    check("screening 50% = 255 - floor((255-c)*50/100) (255 ACIs)", not bs, f"{bs}")
    for case, s_ in (("screen-stock-25", 25), ("screen-stock-75", 75), ("screen-10", 10), ("screen-90", 90)):
        px, ref2 = img(f"plotstyles/{case}"), img("plotstyles/screen-acad")
        if px is None or ref2 is None:
            continue
        cells = json.loads((GEN / "plotstyles" / f"{case}.json").read_text(encoding="utf-8"))["params"]["cells"]
        bad = []
        for c in cells:
            x0, y0, x1, y1 = c["box"]
            o = at(ref2, (x0 + x1) / 2, (y0 + y1) / 2)
            got = at(px, (x0 + x1) / 2, (y0 + y1) / 2)
            exp = screen(o, s_) if c["kind"] == "aci" else o  # true colours: no pen
            if got != exp:
                bad.append((c["kind"], c["value"], got, exp))
        check(f"{case}: screening formula, true colours untouched", not bad, f"{bad}")


def truecolor() -> None:
    px = img("plotstyles/truecolor-pen-color")
    if px is None:
        return
    w = [(b - a + 1, c) for a, b, c in runs(px, 1000)]
    # rows 0-3 true colour: 1 px object colour; rows 4-8 ACI pens 3,1,5,2,4: 2n+1 px, pen colours
    ok = [x[0] for x in w[:4]] == [1, 1, 1, 1] and [x[0] for x in w[4:9]] == [7, 3, 11, 5, 9] and w[9][0] == 4
    check("true-colour objects use no pen (object colour and lineweight)", ok, f"{w}")


def pagesetup() -> None:
    def blue_box(case):
        px = img(f"pagesetup/{case}")
        if px is None:
            return None
        xs, ys = [], []
        for y in range(1500):
            for x in range(0, 2000):
                if px[x, y] == (0, 0, 255):
                    xs.append(x)
                    ys.append(y)
        return min(xs), max(xs), min(ys), max(ys)

    # filled square paper (15..90) x (15..90) in rot-*-layout (1 px per paper unit)
    expect = {0: ("left", "bottom"), 1: ("left", "top"), 2: ("right", "top"), 3: ("right", "bottom")}
    for rot, (hx, vy) in expect.items():
        b = blue_box(f"rot-{rot}-layout")
        if b is None:
            continue
        ok = (b[0] < 100 if hx == "left" else b[1] > 1900) and (b[2] < 100 if vy == "top" else b[3] > 1400)
        check(f"73={rot}: paper origin at canvas {hx}-{vy}", ok, f"{b}")
    for case, size in (
        ("scale-std-1-2-flag16", 50), ("scale-std-1-2-noflag16", 100), ("scale-custom-1-2-flag16", 100),
        ("scale-custom-1-2-noflag16", 50), ("scale-std147-flag16", 50), ("scale-fit-0-flag16", 107),
    ):
        b = blue_box(case)
        if b is None:
            continue
        check(f"{case}: 100-unit square plots {size} px", b[1] - b[0] + 1 == size, f"{b}")


def main() -> None:
    lineweights()
    colours()
    screening()
    truecolor()
    pagesetup()
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'' if ok else '  ' + detail}")
    if not results:
        print("no references found (run tools/gen -s plotstyles -s pagesetup and tools/acad)")


if __name__ == "__main__":
    main()
