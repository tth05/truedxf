"""Seeded random drawings mixing many entity types and properties (crash + integration tests).

These are not meant to pin a single rule; they catch interactions and regressions (PLAN §5 Phase 6
anti-overfitting: hold-out seeds 1000+ are generated too but should not be looked at while fixing).
"""

from __future__ import annotations

import math
import random

from ezdxf.enums import TextEntityAlignment

from ..core import Case, SuiteBuilder, suite
from ..resources import ISO_LINETYPES, SIMPLE_LINETYPES, TTF_FONTS

W, H = 400.0, 300.0
PATTERNS = ["ANSI31", "ANSI32", "ANSI37", "AR-BRSTD", "GRAVEL", "HONEY", "NET", "DOTS", "ZIGZAG", "CROSS"]
LINEWEIGHTS = [-3, -2, -1, 0, 5, 13, 18, 25, 35, 50, 70, 100, 140, 211]
ALIGNS = [a for a in TextEntityAlignment if a.name not in ("ALIGNED", "FIT")]


def _pt(rng: random.Random, margin: float = 10.0) -> tuple[float, float]:
    return (round(rng.uniform(margin, W - margin), 4), round(rng.uniform(margin, H - margin), 4))


def _setup(c: Case, rng: random.Random) -> list[str]:
    layers = ["0"]
    for i in range(rng.randint(2, 6)):
        name = f"L{i}"
        lt = rng.choice(["Continuous", "Continuous", *rng.sample(SIMPLE_LINETYPES + ISO_LINETYPES, 2)])
        c.layer(name, color=rng.randint(1, 255), linetype=lt, lineweight=rng.choice(LINEWEIGHTS[3:]))
        layers.append(name)
    c.style("MIX-SANS", font=TTF_FONTS["sans"])
    c.style("MIX-WIDE", font=TTF_FONTS["lato"], width=1.3, oblique=10)
    for name in ("DASHED", "CENTER", "ACAD_ISO02W100", "DOT"):
        c.linetype(name)
    # a few blocks with nested content
    b = c.doc.blocks.new("MIX-A")
    b.add_circle((0, 0), 5, dxfattribs={"color": 0})
    b.add_line((-7, 0), (7, 0))
    b.add_line((0, -7), (0, 7), dxfattribs={"layer": "L0"})
    b2 = c.doc.blocks.new("MIX-B")
    b2.add_lwpolyline([(0, 0), (20, 0), (20, 10), (0, 10)], close=True, dxfattribs={"color": 0, "lineweight": -2})
    b2.add_blockref("MIX-A", (10, 5), dxfattribs={"xscale": 0.5, "yscale": 0.5})
    b2.add_text("B", height=4, dxfattribs={"insert": (1, 1), "style": "MIX-SANS"})
    return layers


def _common(rng: random.Random, layers: list[str]) -> dict:
    a: dict = {"layer": rng.choice(layers)}
    r = rng.random()
    if r < 0.3:
        a["color"] = rng.randint(1, 255)
    elif r < 0.4:
        a["true_color"] = rng.randint(0, 0xFFFFFF)
    if rng.random() < 0.3:
        a["lineweight"] = rng.choice(LINEWEIGHTS)
    if rng.random() < 0.15:
        a["linetype"] = rng.choice(["DASHED", "CENTER", "ACAD_ISO02W100", "DOT", "BYLAYER", "Continuous"])
        a["ltscale"] = rng.choice([0.25, 0.5, 1.0, 2.0])
    return a


def _add_random(c: Case, rng: random.Random, layers: list[str]) -> str:
    msp = c.msp
    kind = rng.choices(
        ["line", "circle", "arc", "lwpoly", "ellipse", "spline", "text", "mtext", "hatch", "insert", "point", "solid", "dim"],
        weights=[14, 8, 8, 10, 5, 5, 6, 4, 5, 6, 3, 3, 3],
    )[0]
    a = _common(rng, layers)
    if kind == "line":
        msp.add_line(_pt(rng), _pt(rng), dxfattribs=a)
    elif kind == "circle":
        msp.add_circle(_pt(rng), rng.uniform(1, 60), dxfattribs=a)
    elif kind == "arc":
        msp.add_arc(_pt(rng), rng.uniform(1, 60), rng.uniform(0, 360), rng.uniform(0, 360), dxfattribs=a)
    elif kind == "lwpoly":
        pts = [(*_pt(rng), 0, 0, rng.choice([0, 0, 0.4, -1])) for _ in range(rng.randint(2, 7))]
        if rng.random() < 0.3:
            a["const_width"] = rng.choice([0.5, 2, 5])
        msp.add_lwpolyline(pts, format="xyseb", close=rng.random() < 0.4, dxfattribs=a)
    elif kind == "ellipse":
        ang = rng.uniform(0, math.pi)
        r = rng.uniform(5, 60)
        msp.add_ellipse(_pt(rng), (r * math.cos(ang), r * math.sin(ang)), rng.uniform(0.1, 1),
                        rng.uniform(0, 6.28), rng.uniform(0, 6.28), dxfattribs=a)
    elif kind == "spline":
        msp.add_spline([_pt(rng) for _ in range(rng.randint(3, 6))], dxfattribs=a)
    elif kind == "text":
        t = msp.add_text(rng.choice(["Hello", "AutoCAD 2027", "Ag", "x=1.25", "ÄÖÜ äöü ß"]), height=rng.uniform(2, 15),
                         rotation=rng.choice([0, 0, 30, 90, 200]),
                         dxfattribs={**a, "style": rng.choice(["Standard", "MIX-SANS", "MIX-WIDE"])})
        t.set_placement(_pt(rng), align=rng.choice(ALIGNS[:12]))
    elif kind == "mtext":
        mt = msp.add_mtext(rng.choice(["Line one\\PLine two", "{\\LUnder}lined and \\Oover\\o", "Wrap me " * 6, "A\\S1/2;B"]),
                           dxfattribs={**a, "char_height": rng.uniform(2, 8), "width": rng.uniform(20, 120)})
        mt.set_location(_pt(rng), attachment_point=rng.randint(1, 9))
    elif kind == "hatch":
        h = msp.add_hatch(color=rng.randint(1, 255), dxfattribs={"layer": a["layer"]})
        x, y = _pt(rng, 40)
        s = rng.uniform(10, 40)
        h.paths.add_polyline_path([(x - s, y - s), (x + s, y - s), (x + s, y + s), (x - s, y + s)], is_closed=True, flags=1)
        if rng.random() < 0.4:
            h.paths.add_polyline_path([(x - s / 3, y - s / 3), (x + s / 3, y - s / 3), (x, y + s / 3)], is_closed=True, flags=16)
        if rng.random() < 0.6:
            h.set_pattern_fill(rng.choice(PATTERNS), scale=rng.choice([0.25, 0.5, 1.0]), angle=rng.choice([0, 45, 90]))
    elif kind == "insert":
        msp.add_blockref(rng.choice(["MIX-A", "MIX-B"]), _pt(rng), dxfattribs={
            **a, "xscale": rng.choice([1, 2, -1, 0.5]), "yscale": rng.choice([1, 2, 0.5]), "rotation": rng.uniform(0, 360)})
    elif kind == "point":
        msp.add_point(_pt(rng), dxfattribs=a)
    elif kind == "solid":
        x, y = _pt(rng, 30)
        msp.add_solid([(x, y), (x + rng.uniform(5, 25), y), (x, y + rng.uniform(5, 25)), (x + rng.uniform(5, 25), y + rng.uniform(5, 25))], dxfattribs=a)
    elif kind == "dim":
        p1, p2 = _pt(rng, 40), _pt(rng, 40)
        d = msp.add_linear_dim(base=(p1[0], max(p1[1], p2[1]) + 15), p1=p1, p2=p2, angle=rng.choice([0, 90]),
                               dxfattribs={"layer": a["layer"]})
        d.render()
    return kind


@suite("mixed", "Seeded random drawings (integration / crash tests)", style_table="acad.ctb")
def build(s: SuiteBuilder) -> None:
    seeds = list(range(1, 31)) + [1001, 1002, 1003, 1004, 1005]  # 1000+: hold-out seeds
    for seed in seeds:
        rng = random.Random(seed)
        n = rng.randint(40, 200)
        c = s.case(
            f"random-{seed:04d}",
            f"Random mixed drawing, {n} entities, seed {seed}" + (" (hold-out)" if seed >= 1000 else ""),
            tags=["mixed"],
            seed=seed,
            params={"entities": n, "holdout": seed >= 1000},
            header={"$LTSCALE": rng.choice([1.0, 1.0, 2.0, 5.0]), "$PDMODE": rng.choice([0, 3, 34]), "$PDSIZE": 3.0},
        )
        layers = _setup(c, rng)
        kinds: dict[str, int] = {}
        for _ in range(n):
            k = _add_random(c, rng, layers)
            kinds[k] = kinds.get(k, 0) + 1
        c.params["kinds"] = dict(sorted(kinds.items()))
        c.tags = ["mixed", *sorted(kinds)]
        c.window((0, 0), (W, H))
    # larger stress drawings, extents plot
    for seed in (501, 502):
        rng = random.Random(seed)
        c = s.case(f"stress-{seed:04d}", f"Random mixed drawing with 3000 entities, seed {seed}", tags=["mixed", "stress"], seed=seed,
                   params={"entities": 3000})
        layers = _setup(c, rng)
        for _ in range(3000):
            _add_random(c, rng, layers)
        c.window((0, 0), (W, H))
