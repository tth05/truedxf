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
- margins sheet (1600x1200, L/B/R/T 10/20/30/40 px): PNG = printable area, paper origin in the
  printable corner of the rotation, 46/47 along the device axes, stored 40-43 win; PDF page setups
  apply 46/47 in mm also for 72 = 0; AutoCAD writes 148/149 = -(48, 49) (x 25.4 for 72 = 0) and a
  stored layout plot is shifted by +148/149; acad.ctb = no styles; gradients and colour books
  (430 + 420) bypass the pens (note 08 §2.1, §10.17; note 06 §6.3-§6.4).
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


def _np(case: str):
    import numpy as np

    p = REFS / f"{case}.png"
    return np.array(Image.open(p).convert("RGB")).astype(int) if p.exists() else None


def _bbox(a, rgb):
    import numpy as np

    m = (a[:, :, 0] == rgb[0]) & (a[:, :, 1] == rgb[1]) & (a[:, :, 2] == rgb[2])
    if not m.any():
        return None
    ys, xs = np.nonzero(m)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def margins() -> None:
    """Margins sheet 1600x1200 (L/B/R/T 10/20/30/40 px): the PNG is the printable area, the paper
    origin sits in the printable corner of the rotation, offsets 46/47 run along the device axes."""
    corner = {0: ("l", "b"), 1: ("l", "t"), 2: ("r", "t"), 3: ("r", "b")}
    for rot, (hx, vy) in corner.items():
        for suffix, (ox, oy) in (("", (0, 0)), ("-offset", (100, 50))):
            a = _np(f"pagesetup/margins-rot-{rot}{suffix}")
            if a is None:
                continue
            h, w = a.shape[:2]
            b = _bbox(a, (0, 0, 255))  # blue 100x100 square at the paper origin
            x = b[0] if hx == "l" else w - 2 - b[2]  # fill edge rule: last column stays white
            y = h - 1 - b[3] if vy == "b" else b[1] - 1  # fill edge rule: top row 1 px low
            check(f"margins 73={rot}{suffix}: PNG {w}x{h} = printable area, origin in the {hx}{vy} corner + ({ox},{oy}) px along the device axes",
                  (w, h) == (1560, 1140) and (x, y) == (ox, oy), f"{(w, h)} {b} -> {(x, y)}")
    a = _np("pagesetup/margins-rot-1-stored-zero")
    if a is not None:
        check("stored 40-43 = 0 on the margins sheet: PLOT uses the stored margins (PNG 1600x1200)", a.shape[:2] == (1200, 1600), f"{a.shape}")


def pdf_offsets() -> None:
    """46/47 = (5, 3) on PDF page setups: mm for 72 = 0 and 72 = 1 (118/70 units of 1/600 in)."""
    import re

    def blue(case):
        p = REFS / f"pagesetup/{case}.pdf"
        if not p.exists():
            return None
        import pymupdf

        c = pymupdf.open(str(p))[0].read_contents().decode("latin1")
        i = c.index("0 0 1 rg")
        path = c[i : c.index("\nb\n", i)]
        pts = [(int(x), int(y)) for x, y in re.findall(r"(-?\d+) (-?\d+) [ml]\s", path)]
        return min(x for x, _ in pts), min(y for _, y in pts)

    for case, exp in (("pdf-in-offset-0", (0, 0)), ("pdf-in-offset-5-3", (118, 70)), ("pdf-mm-offset-0", (0, 0)),
                      ("pdf-mm-offset-5-3", (118, 70)), ("pdf-mm-offset-5-3-plotoffset-1", (118, 70)),
                      ("pdf-mm-offset-0-plotoffset-1", (0, 0))):
        b = blue(case)
        if b is not None:
            check(f"{case}: origin at printable corner + 46/47 in mm", b == exp, f"{b}")


def image_origin() -> None:
    import ezdxf

    for case, exp in (("io-win-offset", (-10, -20)), ("io-win-center", (-10, -20)), ("io-win-1-2", (-10, -20)),
                      ("io-layout-offset", (0, 0)), ("io-model-win", (-10, -20)), ("io-pdf-in-win", (-254, -508)),
                      ("io-pdf-mm-win", (-10, -20)), ("margins-detailed-1", (0, 0))):
        p = REFS / f"pagesetup/{case}.dxf"
        if not p.exists():
            continue
        d = ezdxf.readfile(p)
        lay = d.layouts.get("Model" if case == "io-model-win" else "Layout1").dxf_layout.dxf
        got = (lay.paper_image_origin_x, lay.paper_image_origin_y)
        check(f"{case}: AutoCAD writes 148/149 = {exp}", got == exp, f"{got}")
    w0, w1, l0, l1 = (_np(f"pagesetup/io-read-{n}") for n in ("win-0", "win-100-50", "layout-0", "layout-100-50"))
    if w0 is not None and w1 is not None:
        check("148/149 ignored by stored window plots", (w0 == w1).all())
    if l0 is not None and l1 is not None:
        b0, b1 = _bbox(l0, (0, 0, 255)), _bbox(l1, (0, 0, 255))
        check("148/149 = (100, 50) shifts a stored layout plot by +100 px right, +50 px up",
              (b1[0] - b0[0], b0[1] - b1[1]) == (100, 50), f"{b0} {b1}")


def pens_misc() -> None:
    a = [_np(f"plotstyles/styles-ref-{n}") for n in ("acad", "off", "none")]
    if all(x is not None for x in a):
        check("acad.ctb = plot styles No = no table (pixel-identical)", (a[0] == a[1]).all() and (a[0] == a[2]).all())
    g = {n: _np(f"plotstyles/gradient-pens-{n}") for n in ("acad", "green", "gray", "screen-50")}
    if all(v is not None for v in g.values()):
        # gradient rows occupy columns 100..1500, the SOLID references 1600..1900
        same = all((v[:, 100:1500] == g["acad"][:, 100:1500]).all() for v in g.values())
        check("gradient HATCH colours bypass pen colour, grayscale and screening", same)
    a = _np("plotstyles/colorbook-pen")
    if a is not None:
        rows = [tuple(int(v) for v in a[int(1500 - (128 - 18 * k + 6) * 10), 350]) for k in range(7)]
        exp = [(0, 255, 0), (0, 255, 0), (190, 189, 127), (0, 255, 0), (190, 189, 127), (255, 0, 0), (255, 0, 0)]
        check("colour book 430 + 420 gets no pen; 430 without 420 is dropped (ACI pen)", rows == exp, f"{rows}")


def main() -> None:
    lineweights()
    colours()
    screening()
    truecolor()
    pagesetup()
    margins()
    pdf_offsets()
    image_origin()
    pens_misc()
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'' if ok else '  ' + detail}")
    if not results:
        print("no references found (run tools/gen -s plotstyles -s pagesetup and tools/acad)")


if __name__ == "__main__":
    main()
