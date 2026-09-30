"""Linetypes: A-type pattern fitting on LINEs/curves/polylines, dots, scaling chain
(LTSCALE × entity 48, CELTSCALE, INSERT scale), BYLAYER/BYBLOCK, PLINEGEN, wide polylines,
dense patterns, odd LTYPE records and complex linetypes with TEXT elements
(note 06 §2, §9, test ideas L1–L9; note 02 §2.2; note 11a §12).

Complex linetypes with SHAPES (ltypeshp.shx) belong to the acad-default-fonts suite. The
text-element LTYPE records are written tag by tag (``complex_ltype``) because ezdxf's .lin
compiler always writes 74=2 (no A=/U= flags; ``A=`` even maps to group code 0).
"""

from __future__ import annotations

import math
import struct
import zlib
from typing import Any, Optional, Sequence, Union

from ezdxf.entities.ltype import LinetypePattern
from ezdxf.lldxf.tags import Tags
from ezdxf.lldxf.types import DXFTag
from ezdxf.math import Vec3

from ..core import Case, SuiteBuilder, suite
from ..plotwin import NICE_SCALES
from ..resources import ISO_LINETYPES, SIMPLE_LINETYPES, TTF_FONTS, linetype_def

FACTORS = [0.5, 0.99, 1.0, 1.01, 1.25, 1.5, 2, 2.5, 3.7, 10.3]
CANVAS = (2000, 1500)

# AutoCAD's acadiso.lin text linetypes (acad.lin ×25.4), STANDARD style = Liberation Sans here
GAS_LINE = [12.7, (-5.08, {"text": "GAS", "s": 2.54, "mode": "U", "rot": 0.0, "x": -2.54, "y": -1.27}), -6.35]
HOT_WATER = [12.7, (-5.08, {"text": "HW", "s": 2.54, "mode": "U", "rot": 0.0, "x": -2.54, "y": -1.27}), -5.08]

Elem = Union[float, tuple]


# --------------------------------------------------------------------------------------------
# helpers


def pattern_length(name: str) -> float:
    return sum(abs(e) for e in linetype_def(name)[1])


def complex_length(elements: Sequence[Elem]) -> float:
    return sum(abs(e[0] if isinstance(e, tuple) else e) for e in elements)


def complex_ltype(c: Case, name: str, elements: Sequence[Elem], desc: str = "", total: Optional[float] = None) -> str:
    """LTYPE with text/shape elements, tags in AutoCAD's order 49, 74, 75, 340, 46, 50, 44, 45, 9.

    element = length | (length, {"text"|"shape": .., "style": .., "s", "rot", "mode" R/A/U, "x", "y"})
    Flags 74: 2 text, 4 shape, |1 absolute (A=), |8 upright (U=). Rotation 50 in degrees unless the
    caller passes radians on purpose."""
    if name in c.doc.linetypes:
        return name
    lt = c.doc.linetypes.add(name, pattern=[0.0], description=desc or name)
    tl = complex_length(elements) if total is None else total
    tags = [DXFTag(72, 65), DXFTag(73, len(elements)), DXFTag(40, round(float(tl), 9))]
    for e in elements:
        length, el = (e if isinstance(e, tuple) else (e, None))
        tags.append(DXFTag(49, float(length)))
        if el is None:
            tags.append(DXFTag(74, 0))
            continue
        is_text = "text" in el
        flags = 2 if is_text else 4
        mode = el.get("mode", "R")
        if mode == "A":
            flags |= 1
        elif mode == "U":
            flags |= 8
        flags = el.get("flags", flags)
        style = el.get("style", "Standard")
        tags.append(DXFTag(74, flags))
        tags.append(DXFTag(75, 0 if is_text else int(el["shape"])))
        handle = el.get("style_handle") or c.doc.styles.get(style).dxf.handle
        tags.append(DXFTag(340, handle))
        tags.append(DXFTag(46, float(el.get("s", 1.0))))
        tags.append(DXFTag(50, float(el.get("rot", 0.0))))
        tags.append(DXFTag(44, float(el.get("x", 0.0))))
        tags.append(DXFTag(45, float(el.get("y", 0.0))))
        if is_text:
            tags.append(DXFTag(9, el["text"]))
    lt.pattern_tags = LinetypePattern(Tags(tags))
    return name


def raw_ltype(c: Case, name: str, total: float, elements: Sequence[float], desc: str = "") -> str:
    """Simple LTYPE with an explicit 40 (may differ from Σ|49| on purpose)."""
    if name not in c.doc.linetypes:
        c.doc.linetypes.add(name, pattern=[float(total), *elements], description=desc or name)
    return name


def ref(c: Case) -> str:
    return c.layer("REF", color=8, lineweight=0)


def tick(c: Case, x: float, y: float, h: float) -> None:
    """Short vertical reference mark above (x, y) that does not touch the line at y."""
    c.msp.add_line((x, y + 0.3 * h), (x, y + h), dxfattribs={"layer": ref(c)})


def nice_ppu(w: float, h: float, canvas: Sequence[int] = CANVAS) -> float:
    best = NICE_SCALES[0]
    for s in NICE_SCALES:
        if canvas[0] / s >= w and canvas[1] / s >= h:
            best = s
    return best


def zoom(c: Case, bmin: Sequence[float], bmax: Sequence[float], margin: float = 0.08) -> float:
    w = (bmax[0] - bmin[0]) * (1 + 2 * margin)
    h = (bmax[1] - bmin[1]) * (1 + 2 * margin)
    ppu = nice_ppu(max(w, 1e-9), max(h, 1e-9))
    c.window_center(((bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2), ppu)
    return ppu


def lt_attr(lt: str, **kw: Any) -> dict[str, Any]:
    d: dict[str, Any] = {"linetype": lt}
    d.update(kw)
    return d


def stacked_lines(c: Case, lengths: Sequence[float], lt: str, extra: Optional[Sequence[dict]] = None, tick_ends: bool = True) -> None:
    """Horizontal lines, first at the top, all starting at x=0; window fitted around them."""
    lmax = max(lengths)
    n = len(lengths)
    sp = max(lmax * 0.75 / (n + 1.5), 1e-9)
    for i, L in enumerate(lengths):
        y = (n - 1 - i) * sp
        attrs = lt_attr(lt, **(extra[i] if extra else {}))
        c.msp.add_line((0, y), (L, y), dxfattribs=attrs)
        if tick_ends:
            tick(c, 0, y, 0.3 * sp)
            tick(c, L, y, 0.3 * sp)
    c.fit((0, -0.5 * sp), (lmax, (n - 1) * sp + 0.5 * sp))


def tiny_png(w: int = 4, h: int = 4) -> bytes:
    """Deterministic grey checkerboard PNG (8-bit greyscale)."""
    raw = b"".join(b"\x00" + bytes((255 if (x + y) % 2 else 160) for x in range(w)) for y in range(h))

    def chunk(t: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def lt_slug(name: str) -> str:
    return name.lower().replace("_", "")


# --------------------------------------------------------------------------------------------


@suite("linetypes", "Linetypes: A-type fitting, scaling chain, PLINEGEN, BYBLOCK, complex text linetypes", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    fit_cases(s)
    direction_cases(s)
    scaling_cases(s)
    property_cases(s)
    insert_cases(s)
    polyline_cases(s)
    curve_cases(s)
    infinite_cases(s)
    other_entity_cases(s)
    lineweight_cases(s)
    dense_cases(s)
    odd_ltype_cases(s)
    undefined_cases(s)
    complex_text_cases(s)
    random_cases(s)


# --- L1: A-type fitting on LINEs of length P × factor -----------------------------------------


def fit_cases(s: SuiteBuilder) -> None:
    for lt in SIMPLE_LINETYPES + ISO_LINETYPES:
        P = pattern_length(lt)
        qs = ["Q-0300"]
        if linetype_def(lt)[1][0] == 0.0:
            qs.append("Q-0301")
        c = s.case(
            f"fit-{lt_slug(lt)}",
            f"{lt} (P={P:g}) on horizontal LINEs of length P x {FACTORS} (top to bottom); ticks mark the endpoints",
            tags=["LINE", "linetype", "A-type"],
            questions=qs,
            params={"linetype": lt, "pattern": linetype_def(lt)[1], "P": P, "factors": FACTORS},
        )
        c.linetype(lt)
        stacked_lines(c, [f * P for f in FACTORS], lt)
    for name, elements in (("GAS_LINE", GAS_LINE), ("HOT_WATER_SUPPLY", HOT_WATER)):
        P = complex_length(elements)
        c = s.case(
            f"fit-{lt_slug(name)}",
            f"Text linetype {name} (acadiso.lin values, U=0, P={P:g}) on LINEs of length P x {FACTORS}: texts omitted below one period?",
            tags=["LINE", "linetype", "A-type", "complex-linetype"],
            questions=["Q-0300", "Q-0326"],
            params={"linetype": name, "P": P, "factors": FACTORS},
        )
        complex_ltype(c, name, elements)
        stacked_lines(c, [f * P for f in FACTORS], name)
    # zoomed single lines around one period for precise dash positions
    for lt in ("DASHED", "DASHDOT", "CENTER", "DOT", "ACAD_ISO04W100"):
        P = pattern_length(lt)
        for f in (0.99, 1.01, 1.5, 2.5):
            L = f * P
            qs = ["Q-0300"] + (["Q-0301"] if lt == "DOT" else [])
            c = s.case(
                f"fitzoom-{lt_slug(lt)}-{int(round(f * 100)):04d}",
                f"Single {lt} LINE of length {f} x P (P={P:g}) at high zoom",
                tags=["LINE", "linetype", "A-type"],
                questions=qs,
                params={"linetype": lt, "P": P, "factor": f, "length": L},
            )
            c.linetype(lt)
            c.msp.add_line((0, 0), (L, 0), dxfattribs=lt_attr(lt))
            tick(c, 0, 0, L * 0.05)
            tick(c, L, 0, L * 0.05)
            zoom(c, (0, -L * 0.1), (L, L * 0.1))


def direction_cases(s: SuiteBuilder) -> None:
    """Asymmetric patterns drawn start->end and end->start: is the fitting symmetric?"""
    for lt in ("CENTER", "DASHDOT", "PHANTOM", "ACAD_ISO04W100", "BORDER"):
        P = pattern_length(lt)
        lengths = [2.5 * P, 2.5 * P, 3.7 * P, 3.7 * P]
        c = s.case(
            f"direction-{lt_slug(lt)}",
            f"{lt} LINEs of 2.5P and 3.7P, each drawn left->right then right->left (circle = start point)",
            tags=["LINE", "linetype", "A-type", "direction"],
            questions=["Q-0300"],
            params={"linetype": lt, "P": P, "lengths": lengths, "reversed": [False, True, False, True]},
        )
        c.linetype(lt)
        sp = 3.7 * P * 0.75 / 5.5
        for i, L in enumerate(lengths):
            y = (3 - i) * sp
            a, b = ((0, y), (L, y)) if i % 2 == 0 else ((L, y), (0, y))
            c.msp.add_line(a, b, dxfattribs=lt_attr(lt))
            c.msp.add_circle((a[0], a[1] + 0.35 * sp), 0.08 * sp, dxfattribs={"layer": ref(c)})
        c.fit((0, -0.5 * sp), (3.7 * P, 3.5 * sp))
    # angled line (non-axis direction)
    P = pattern_length("CENTER")
    c = s.case("direction-angled-center", "CENTER LINE of 3.7P at 30 deg and a parallel one reversed", tags=["LINE", "linetype", "A-type"], questions=["Q-0300"], params={"angle": 30})
    c.linetype("CENTER")
    L = 3.7 * P
    d = Vec3.from_deg_angle(30) * L
    n = Vec3.from_deg_angle(120) * 25
    c.msp.add_line((0, 0), d, dxfattribs=lt_attr("CENTER"))
    c.msp.add_line(d + n, n, dxfattribs=lt_attr("CENTER"))
    c.fit()


# --- L9: scaling chain ----------------------------------------------------------------------


def scaling_cases(s: SuiteBuilder) -> None:
    celt = [0.25, 0.5, 1.0, 2.0, 4.0]
    for lts in (0.5, 1.0, 2.0):
        c = s.case(
            f"scale-ltscale-{int(lts * 100):04d}",
            f"$LTSCALE={lts}: DASHED LINEs (180) with entity 48 = {celt} (top to bottom)",
            tags=["LINE", "linetype", "LTSCALE", "ltscale-48"],
            questions=["Q-0314"],
            params={"ltscale": lts, "entity_ltscale": celt},
            header={"$LTSCALE": lts},
        )
        c.linetype("DASHED")
        stacked_lines(c, [180.0] * len(celt), "DASHED", extra=[{"ltscale": v} for v in celt], tick_ends=False)
    # equivalence: identical drawings, LTSCALE × 48 = 1 in every case
    for lts, e48 in ((1.0, 1.0), (2.0, 0.5), (0.5, 2.0), (4.0, 0.25)):
        c = s.case(
            f"scale-equiv-{int(lts * 100):04d}",
            f"Equivalence: $LTSCALE={lts} x entity 48={e48} (=1): DASHED/CENTER/DASHDOT LINEs, CIRCLE, ARC",
            tags=["LINE", "CIRCLE", "ARC", "linetype", "LTSCALE", "ltscale-48"],
            questions=["Q-0314"],
            params={"ltscale": lts, "entity_ltscale": e48},
            header={"$LTSCALE": lts},
        )
        for i, lt in enumerate(("DASHED", "CENTER", "DASHDOT")):
            c.linetype(lt)
            c.msp.add_line((10, 130 - i * 15), (190, 130 - i * 15), dxfattribs=lt_attr(lt, ltscale=e48))
        c.msp.add_circle((55, 45), 35, dxfattribs=lt_attr("DASHED", ltscale=e48))
        c.msp.add_arc((145, 45), 35, 20, 250, dxfattribs=lt_attr("CENTER", ltscale=e48))
        c.window((0, 0), (200, 150))
    # CELTSCALE only initialises 48 for new entities
    for celts, lts in ((2.0, 1.0), (3.0, 0.5)):
        c = s.case(
            f"scale-celtscale-{int(celts * 100):04d}",
            f"$CELTSCALE={celts}, $LTSCALE={lts}: DASHED LINE without 48 (top) and with 48=1 (bottom); CELTSCALE must not apply",
            tags=["LINE", "linetype", "CELTSCALE"],
            questions=["Q-0314"],
            params={"celtscale": celts, "ltscale": lts},
            header={"$CELTSCALE": celts, "$LTSCALE": lts},
        )
        c.linetype("DASHED")
        stacked_lines(c, [180.0, 180.0], "DASHED", extra=[{}, {"ltscale": 1.0}], tick_ends=False)
    c = s.case(
        "scale-bylayer-48",
        "Layer DASHED (BYLAYER lines) with entity 48 = 0.5, 1, 2 and an explicit DASHED line 48=2",
        tags=["LINE", "linetype", "ltscale-48", "BYLAYER"],
        questions=["Q-0314"],
        params={"entity_ltscale": [0.5, 1, 2, 2], "last_explicit": True},
    )
    c.layer("DASH", linetype="DASHED", lineweight=0)
    c.linetype("DASHED")
    for i, (v, lt) in enumerate(((0.5, "BYLAYER"), (1.0, "BYLAYER"), (2.0, "BYLAYER"), (2.0, "DASHED"))):
        c.msp.add_line((10, 120 - 30 * i), (190, 120 - 30 * i), dxfattribs={"layer": "DASH", "linetype": lt, "ltscale": v})
    c.window((0, 0), (200, 150))


# --- BYLAYER / BYBLOCK / INSERT scale -------------------------------------------------------


def property_cases(s: SuiteBuilder) -> None:
    c = s.case(
        "bylayer-vs-entity",
        "Layer DASH (DASHED): lines BYLAYER, explicit CENTER, explicit Continuous; layer 0: BYLAYER, explicit DASHED, explicit BYBLOCK (top to bottom)",
        tags=["LINE", "linetype", "BYLAYER", "BYBLOCK"],
        questions=["Q-0314"],
        params={"rows": ["DASH/BYLAYER", "DASH/CENTER", "DASH/Continuous", "0/BYLAYER", "0/DASHED", "0/BYBLOCK"]},
    )
    c.layer("DASH", linetype="DASHED", lineweight=0)
    c.linetype("CENTER")
    c.linetype("DASHED")
    rows = [("DASH", "BYLAYER"), ("DASH", "CENTER"), ("DASH", "Continuous"), ("0", "BYLAYER"), ("0", "DASHED"), ("0", "BYBLOCK")]
    for i, (layer, lt) in enumerate(rows):
        c.msp.add_line((10, 135 - 22 * i), (190, 135 - 22 * i), dxfattribs={"layer": layer, "linetype": lt})
    c.window((0, 0), (200, 150))

    # BYBLOCK content resolved from the INSERT
    variants = [
        ("dashed", {"linetype": "DASHED"}, "INSERT linetype DASHED"),
        ("center", {"linetype": "CENTER"}, "INSERT linetype CENTER"),
        ("bylayer", {"linetype": "BYLAYER", "layer": "DASH"}, "INSERT BYLAYER on layer DASH (DASHED)"),
        ("layer0", {}, "INSERT BYLAYER on layer 0 (Continuous)"),
        ("byblock", {"linetype": "BYBLOCK"}, "INSERT with linetype BYBLOCK in model space"),
        ("ltscale2", {"linetype": "DASHED", "ltscale": 2.0}, "INSERT linetype DASHED with INSERT 48=2"),
    ]
    for key, attrs, desc in variants:
        c = s.case(
            f"byblock-{key}",
            f"Block with BYBLOCK LINE/ARC/CIRCLE/LWPOLYLINE (48=1): {desc}",
            tags=["INSERT", "linetype", "BYBLOCK"],
            questions=["Q-0314"] + (["Q-0321"] if key == "ltscale2" else []),
            params={"insert": attrs},
        )
        c.layer("DASH", linetype="DASHED", lineweight=0)
        c.linetype("DASHED")
        c.linetype("CENTER")
        blk = c.doc.blocks.new("BB")
        bb = {"linetype": "BYBLOCK"}
        blk.add_line((0, 0), (150, 0), dxfattribs=bb)
        blk.add_line((0, 0), (0, 100), dxfattribs=bb)
        blk.add_circle((50, 55), 35, dxfattribs=bb)
        blk.add_arc((120, 50), 25, 0, 270, dxfattribs=bb)
        blk.add_lwpolyline([(95, 90), (150, 90), (150, 20)], dxfattribs=bb)
        c.msp.add_blockref("BB", (25, 25), dxfattribs=attrs)
        c.window((0, 0), (200, 150))


def insert_cases(s: SuiteBuilder) -> None:
    """Block with explicit DASHED content inserted at various scales; directly drawn DASHED
    reference lines of the same WCS length below/left of it."""
    variants = [
        ("s1", (1, 1), 0),
        ("s3", (3, 3), 0),
        ("mirror", (-1, 1), 0),
        ("mirror3", (-3, 3), 0),
        ("nonuniform-2-1", (2, 1), 0),
        ("nonuniform-1-2", (1, 2), 0),
        ("nonuniform-2-1-rot45", (2, 1), 45),
        ("s0-5", (0.5, 0.5), 0),
    ]
    for key, (sx, sy), rot in variants:
        c = s.case(
            f"insert-scale-{key}",
            f"Block (DASHED LINEs 40 x 30 + CIRCLE r=10 + CENTER ARC) inserted at scale ({sx},{sy}) rotation {rot}; reference DASHED LINEs of the WCS lengths drawn directly",
            tags=["INSERT", "linetype", "insert-scale"],
            questions=["Q-0314", "Q-0320"],
            params={"xscale": sx, "yscale": sy, "rotation": rot},
        )
        c.linetype("DASHED")
        c.linetype("CENTER")
        blk = c.doc.blocks.new("DSH")
        blk.add_line((0, 0), (40, 0), dxfattribs=lt_attr("DASHED"))
        blk.add_line((0, 0), (0, 30), dxfattribs=lt_attr("DASHED"))
        blk.add_circle((22, 17), 10, dxfattribs=lt_attr("DASHED"))
        blk.add_arc((22, 17), 13, 0, 180, dxfattribs=lt_attr("CENTER"))
        ins = c.msp.add_blockref("DSH", (0, 0), dxfattribs={"xscale": sx, "yscale": sy, "zscale": 1, "rotation": rot})
        # reference lines: the WCS images of the block's two lines, offset away from the insert
        m = ins.matrix44()
        p0, px, py = m.transform(Vec3(0, 0)), m.transform(Vec3(40, 0)), m.transform(Vec3(0, 30))
        lx, ly = (px - p0).magnitude, (py - p0).magnitude
        pts = [p0, px, py, m.transform(Vec3(40, 30))]
        xmin = min(p.x for p in pts)
        ymin = min(p.y for p in pts)
        xmax = max(p.x for p in pts)
        gap = 0.15 * max(lx, ly)
        c.msp.add_line((xmin, ymin - gap), (xmin + lx, ymin - gap), dxfattribs=lt_attr("DASHED"))
        c.msp.add_line((xmin, ymin - 2 * gap), (xmin + ly, ymin - 2 * gap), dxfattribs=lt_attr("DASHED"))
        c.params.update({"ref_lengths": [round(lx, 6), round(ly, 6)]})
        ymax = max(p.y for p in pts)
        zoom(c, (min(xmin, xmin), ymin - 2.5 * gap), (max(xmax, xmin + max(lx, ly)), ymax))
    c = s.case(
        "insert-ltscale-vs-child",
        "INSERT 48=3 of a block with a DASHED LINE (48=1) (top) vs directly drawn DASHED LINE 48=3 (middle) and 48=1 (bottom)",
        tags=["INSERT", "linetype", "ltscale-48"],
        questions=["Q-0321", "Q-0314"],
    )
    c.linetype("DASHED")
    blk = c.doc.blocks.new("L1")
    blk.add_line((0, 0), (180, 0), dxfattribs=lt_attr("DASHED"))
    c.msp.add_blockref("L1", (10, 120), dxfattribs={"ltscale": 3.0})
    c.msp.add_line((10, 75), (190, 75), dxfattribs=lt_attr("DASHED", ltscale=3.0))
    c.msp.add_line((10, 30), (190, 30), dxfattribs=lt_attr("DASHED"))
    c.window((0, 0), (200, 150))


# --- L2/L6: polylines ------------------------------------------------------------------------


def _zigzag(P: float, x0: float = 30, y0: float = 50) -> list[tuple[float, float]]:
    """Long 2.3P segments at ±75° joined by short 0.5P horizontal segments."""
    pts = [(x0, y0)]
    x, y = x0, y0
    long_, short = 2.3 * P, 0.5 * P
    for i in range(4):
        ang = math.radians(75 if i % 2 == 0 else -75)
        x, y = x + long_ * math.cos(ang), y + long_ * math.sin(ang)
        pts.append((x, y))
        if i < 3:
            x += short
            pts.append((x, y))
    return pts


def polyline_cases(s: SuiteBuilder) -> None:
    P = pattern_length("DASHED")
    zz = _zigzag(P)
    for lt in ("DASHED", "CENTER"):
        for closed in (False, True):
            for gen in (0, 1):
                name = f"pl-zigzag-{lt_slug(lt)}-{'closed' if closed else 'open'}-gen{gen}"
                c = s.case(
                    name,
                    f"{lt} LWPOLYLINE zig-zag (segments 2.3P and 0.5P, P=DASHED) {'closed' if closed else 'open'}, PLINEGEN (70 bit 128) {'on' if gen else 'off'}",
                    tags=["LWPOLYLINE", "linetype", "PLINEGEN"],
                    questions=["Q-0307"],
                    params={"linetype": lt, "closed": closed, "plinegen": bool(gen), "vertices": zz},
                )
                c.linetype(lt)
                pl = c.msp.add_lwpolyline(zz, close=closed, dxfattribs=lt_attr(lt))
                if gen:
                    pl.dxf.flags |= 128
                c.msp.add_circle(zz[0], 1.5, dxfattribs={"layer": ref(c)})
                c.fit()
    # $PLINEGEN header must not override the entity flag
    for hdr, flag in ((1, 0), (0, 1)):
        c = s.case(
            f"pl-header-plinegen{hdr}-flag{flag}",
            f"$PLINEGEN={hdr} but LWPOLYLINE 70 bit 128 = {flag}: the entity flag decides",
            tags=["LWPOLYLINE", "linetype", "PLINEGEN", "header"],
            questions=["Q-0307"],
            params={"header_plinegen": hdr, "entity_flag": flag},
            header={"$PLINEGEN": hdr},
        )
        c.linetype("DASHED")
        pl = c.msp.add_lwpolyline(zz, dxfattribs=lt_attr("DASHED"))
        if flag:
            pl.dxf.flags |= 128
        c.fit()
    # bulges
    bz = [(30, 60, 0.5), (75, 60, 0), (90, 60, -0.5), (135, 60, 0), (145, 60, 1.0), (175, 60, 0)]
    for gen in (0, 1):
        c = s.case(
            f"pl-bulge-gen{gen}",
            f"DASHED LWPOLYLINE with bulge 0.5 / -0.5 / 1.0 arcs and short straight segments, PLINEGEN {'on' if gen else 'off'}",
            tags=["LWPOLYLINE", "linetype", "PLINEGEN", "bulge"],
            questions=["Q-0307", "Q-0300"],
            params={"plinegen": bool(gen), "vertices": bz},
        )
        c.linetype("DASHED")
        pl = c.msp.add_lwpolyline([(x, y, 0, 0, b) for x, y, b in bz], format="xyseb", dxfattribs=lt_attr("DASHED"))
        if gen:
            pl.dxf.flags |= 128
        c.window((0, 0), (200, 150))
        c = s.case(
            f"pl-bulge-circle-gen{gen}",
            f"Closed LWPOLYLINE circle r=50 from two bulge-1 segments, CENTER, PLINEGEN {'on' if gen else 'off'} (vs CIRCLE)",
            tags=["LWPOLYLINE", "linetype", "PLINEGEN", "bulge", "closed"],
            questions=["Q-0307", "Q-0304"],
            params={"plinegen": bool(gen)},
        )
        c.linetype("CENTER")
        pl = c.msp.add_lwpolyline([(50, 75, 0, 0, 1), (150, 75, 0, 0, 1)], format="xyseb", close=True, dxfattribs=lt_attr("CENTER"))
        if gen:
            pl.dxf.flags |= 128
        c.window((0, 0), (200, 150))
    # many very short segments
    for gen in (0, 1):
        c = s.case(
            f"pl-fine-gen{gen}",
            f"DASHED LWPOLYLINE of 64 segments (each 0.2P, shorter than one dash) on a circle, PLINEGEN {'on' if gen else 'off'}",
            tags=["LWPOLYLINE", "linetype", "PLINEGEN", "short-segments"],
            questions=["Q-0307", "Q-0300"],
            params={"plinegen": bool(gen), "segments": 64},
        )
        c.linetype("DASHED")
        r = 0.2 * P * 64 / math.tau
        pts = [(100 + r * math.cos(t), 75 + r * math.sin(t)) for t in (i * math.tau / 64 for i in range(64))]
        pl = c.msp.add_lwpolyline(pts, close=True, dxfattribs=lt_attr("DASHED"))
        if gen:
            pl.dxf.flags |= 128
        zoom(c, (100 - r, 75 - r), (100 + r, 75 + r))
    # 2D POLYLINE (flag 128 too)
    for gen in (0, 1):
        c = s.case(
            f"polyline2d-zigzag-gen{gen}",
            f"DASHED 2D POLYLINE zig-zag, 70 bit 128 {'on' if gen else 'off'}",
            tags=["POLYLINE", "linetype", "PLINEGEN"],
            questions=["Q-0307"],
            params={"plinegen": bool(gen)},
        )
        c.linetype("DASHED")
        pl = c.msp.add_polyline2d(zz, dxfattribs=lt_attr("DASHED"))
        if gen:
            pl.dxf.flags |= 128
        c.fit()
    # wide / tapered
    wide = [
        ("const", {"const_width": 2.0}, [(20, 40), (80, 110), (130, 40), (185, 110)]),
        ("taper", {}, [(20, 40, 0, 1.3, 0), (80, 110, 1.3, 2.7, 0), (130, 40, 2.7, 4.0, 0), (185, 110, 0, 0, 0)]),
        ("bulge", {"const_width": 3.0}, [(20, 75, 0, 0, 0.6), (100, 75, 0, 0, -0.6), (180, 75, 0, 0, 0)]),
    ]
    for key, attrs, pts in wide:
        for gen in (0, 1):
            c = s.case(
                f"pl-wide-{key}-gen{gen}",
                f"DASHED wide LWPOLYLINE ({key}: {attrs or 'per-vertex widths 0->4'}), PLINEGEN {'on' if gen else 'off'}: dashes as wide quads?",
                tags=["LWPOLYLINE", "linetype", "width", "PLINEGEN"],
                questions=["Q-0308"],
                params={"widths": attrs or "per-vertex", "plinegen": bool(gen), "vertices": pts},
            )
            c.linetype("DASHED")
            d = lt_attr("DASHED", **attrs)
            if len(pts[0]) == 5:
                pl = c.msp.add_lwpolyline(pts, format="xyseb", dxfattribs=d)
            elif key == "bulge":
                pl = c.msp.add_lwpolyline(pts, format="xyb", dxfattribs=d)
            else:
                pl = c.msp.add_lwpolyline(pts, dxfattribs=d)
            if gen:
                pl.dxf.flags |= 128
            c.window((0, 0), (200, 150))
    # text linetype across polyline vertices
    for gen in (0, 1):
        c = s.case(
            f"pl-gasline-gen{gen}",
            f"GAS_LINE text linetype on the zig-zag LWPOLYLINE, PLINEGEN {'on' if gen else 'off'}",
            tags=["LWPOLYLINE", "linetype", "complex-linetype", "PLINEGEN"],
            questions=["Q-0307", "Q-0300", "Q-0326"],
            params={"plinegen": bool(gen)},
        )
        complex_ltype(c, "GAS_LINE", GAS_LINE)
        pl = c.msp.add_lwpolyline(zz, dxfattribs=lt_attr("GAS_LINE"))
        if gen:
            pl.dxf.flags |= 128
        c.fit()


# --- L3: curves -------------------------------------------------------------------------------


def curve_cases(s: SuiteBuilder) -> None:
    for lt in ("DASHED", "CENTER"):
        P = pattern_length(lt)
        for r in (1, 2.37, 5, 10, 60):
            c = s.case(
                f"circle-{lt_slug(lt)}-r{str(r).replace('.', '-')}",
                f"{lt} CIRCLE r={r} (circumference {math.tau * r / P:.3g} P); tick at angle 0",
                tags=["CIRCLE", "linetype"],
                questions=["Q-0304"],
                params={"linetype": lt, "radius": r, "circumference_in_P": round(math.tau * r / P, 6)},
            )
            c.linetype(lt)
            c.msp.add_circle((0, 0), r, dxfattribs=lt_attr(lt))
            c.msp.add_line((r * 1.05, 0), (r * 1.2, 0), dxfattribs={"layer": ref(c)})
            zoom(c, (-r, -r), (r, r))
    c = s.case("circle-vs-line-r10", "DASHED CIRCLE r=10 and a DASHED LINE of length 2*pi*10", tags=["CIRCLE", "LINE", "linetype"], questions=["Q-0304"])
    c.linetype("DASHED")
    c.msp.add_circle((12, 12), 10, dxfattribs=lt_attr("DASHED"))
    c.msp.add_line((27, 12), (27 + math.tau * 10, 12), dxfattribs=lt_attr("DASHED"))
    c.fit()
    for ez in (1, -1):
        c = s.case(
            f"circle-ocs-{'pos' if ez > 0 else 'neg'}",
            f"CENTER CIRCLE r=50 and ARC 0-90 (r=62) with extrusion (0,0,{ez}); ticks at WCS +x",
            tags=["CIRCLE", "ARC", "linetype", "OCS"],
            questions=["Q-0304", "Q-0303"],
            params={"extrusion": [0, 0, ez]},
        )
        c.linetype("CENTER")
        cx = 100 * ez  # OCS x of WCS (100, 75) under (0,0,-1) is -100
        c.msp.add_circle((cx, 75), 50, dxfattribs=lt_attr("CENTER", extrusion=(0, 0, ez)))
        c.msp.add_arc((cx, 75), 62, 0, 90, dxfattribs=lt_attr("CENTER", extrusion=(0, 0, ez)))
        c.msp.add_line((153, 75), (158, 75), dxfattribs={"layer": ref(c)})
        c.window((0, 0), (200, 150))
    arcs = [(10, 350), (0, 90), (90, 180), (300, 60), (0, 359.9), (30, 60)]
    for lt in ("DASHED", "CENTER"):
        for a0, a1 in arcs:
            c = s.case(
                f"arc-{lt_slug(lt)}-{int(a0):03d}-{int(round(a1)):03d}",
                f"{lt} ARC r=60 from {a0} to {a1} deg (ticks at the endpoints)",
                tags=["ARC", "linetype"],
                questions=["Q-0303"],
                params={"linetype": lt, "start": a0, "end": a1, "radius": 60},
            )
            c.linetype(lt)
            c.msp.add_arc((100, 75), 60, a0, a1, dxfattribs=lt_attr(lt))
            for a in (a0, a1):
                u = Vec3.from_deg_angle(a)
                c.msp.add_line(Vec3(100, 75) + u * 63, Vec3(100, 75) + u * 68, dxfattribs={"layer": ref(c)})
            c.window((0, 0), (200, 150))
        P = pattern_length(lt)
        for f in (0.8, 1.2, 2.5):
            r = 40
            sweep = math.degrees(f * P / r)
            c = s.case(
                f"arc-short-{lt_slug(lt)}-{int(f * 100):04d}",
                f"{lt} ARC r=40 with arc length {f} P ({sweep:.2f} deg)",
                tags=["ARC", "linetype", "short-segments"],
                questions=["Q-0303", "Q-0300"],
                params={"linetype": lt, "arc_length_in_P": f, "sweep_deg": round(sweep, 6)},
            )
            c.linetype(lt)
            a0 = 90 - sweep / 2
            arc = c.msp.add_arc((0, 0), r, a0, a0 + sweep, dxfattribs=lt_attr(lt))
            sp, ep = arc.start_point, arc.end_point
            zoom(c, (min(sp.x, ep.x), r * math.cos(math.radians(sweep / 2)) - 2), (max(sp.x, ep.x), r + 2))
    # ellipses
    ells = [("full", 0.0, math.tau, 0), ("half", 0.0, math.pi, 0), ("partial", 0.3, 5.0, 0), ("rot30-full", 0.0, math.tau, 30), ("rot30-partial", 1.0, 4.0, 30)]
    for lt in ("DASHED", "CENTER"):
        for key, p0, p1, rot in ells:
            c = s.case(
                f"ellipse-{lt_slug(lt)}-{key}",
                f"{lt} ELLIPSE ratio 0.5, major 80, rotation {rot}, params {p0:g}..{p1:g}",
                tags=["ELLIPSE", "linetype"],
                questions=["Q-0305"],
                params={"linetype": lt, "start_param": p0, "end_param": p1, "rotation": rot},
            )
            c.linetype(lt)
            major = Vec3.from_deg_angle(rot) * 80
            c.msp.add_ellipse((100, 75), major, 0.5, p0, p1, dxfattribs=lt_attr(lt))
            c.msp.add_line(Vec3(100, 75) + major * 1.04, Vec3(100, 75) + major * 1.1, dxfattribs={"layer": ref(c)})
            c.window((0, 0), (200, 150))
    # splines
    ctrl = [(20, 20), (40, 130), (80, 20), (120, 130), (160, 20), (180, 100)]
    ring = [(100 + 70 * math.cos(a), 75 + 55 * math.sin(a)) for a in (i * math.tau / 7 for i in range(7))]
    for lt in ("DASHED", "CENTER"):
        c = s.case(f"spline-{lt_slug(lt)}-open", f"{lt} open cubic SPLINE (6 control points)", tags=["SPLINE", "linetype"], questions=["Q-0305"], params={"linetype": lt})
        c.linetype(lt)
        c.msp.add_open_spline(ctrl, degree=3, dxfattribs=lt_attr(lt))
        c.window((0, 0), (200, 150))
        c = s.case(f"spline-{lt_slug(lt)}-closed", f"{lt} closed periodic cubic SPLINE (7 control points)", tags=["SPLINE", "linetype", "closed"], questions=["Q-0305"], params={"linetype": lt})
        c.linetype(lt)
        sp = c.msp.add_spline(dxfattribs=lt_attr(lt))
        sp.set_closed([Vec3(p) for p in ring], degree=3)
        c.window((0, 0), (200, 150))
    c = s.case("spline-dashed-fit", "DASHED fit-point-only SPLINE", tags=["SPLINE", "linetype", "fit-points"], questions=["Q-0305"])
    c.linetype("DASHED")
    c.msp.add_spline([(20, 40), (50, 120), (90, 60), (130, 120), (170, 50)], degree=3, dxfattribs=lt_attr("DASHED"))
    c.window((0, 0), (200, 150))


def infinite_cases(s: SuiteBuilder) -> None:
    for key, lt in (("xline", "CENTER"), ("ray", "CENTER"), ("xline-dashed", "DASHED")):
        c = s.case(
            f"infinite-{key}",
            f"{lt} {'RAY' if key == 'ray' else 'XLINE'} with base point (100,75) (circle) direction 20 deg: pattern phase at the base point",
            tags=["XLINE" if key != "ray" else "RAY", "linetype"],
            questions=["Q-0306"],
            params={"linetype": lt},
        )
        c.linetype(lt)
        d = Vec3.from_deg_angle(20)
        if key == "ray":
            c.msp.add_ray((100, 75), d, dxfattribs=lt_attr(lt))
        else:
            c.msp.add_xline((100, 75), d, dxfattribs=lt_attr(lt))
        c.msp.add_circle((100, 75), 3, dxfattribs={"layer": ref(c)})
        c.window((0, 0), (200, 150))
    c = s.case(
        "infinite-extents",
        "Extents plot: DASHED XLINE through a CIRCLE r=30 (XLINE excluded from extents?)",
        tags=["XLINE", "linetype", "extents"],
        questions=["Q-0306"],
    )
    c.linetype("DASHED")
    c.msp.add_xline((100, 75), Vec3.from_deg_angle(20), dxfattribs=lt_attr("DASHED"))
    c.msp.add_circle((100, 75), 30)
    c.plot_extents()


def other_entity_cases(s: SuiteBuilder) -> None:
    c = s.case("other-polyline3d", "DASHED 3D POLYLINE zig-zag in the XY plane (per segment?)", tags=["POLYLINE", "3d", "linetype"], questions=["Q-0309"])
    c.linetype("DASHED")
    c.msp.add_polyline3d([(x, y, 0) for x, y in _zigzag(pattern_length("DASHED"))], dxfattribs=lt_attr("DASHED"))
    c.fit()
    c = s.case("other-polymesh", "DASHED 3x3 polygon mesh in the XY plane (edges 60 units)", tags=["POLYLINE", "polymesh", "linetype"], questions=["Q-0309"])
    c.linetype("DASHED")
    mesh = c.msp.add_polymesh(size=(3, 3), dxfattribs=lt_attr("DASHED"))
    for i in range(3):
        for j in range(3):
            mesh.set_mesh_vertex((i, j), (40 + 60 * i, 15 + 60 * j, 0))
    c.window((0, 0), (200, 150))
    c = s.case("other-3dface", "3DFACE square 100x100 with linetype DASHED: are edges dashed?", tags=["3DFACE", "linetype"], questions=["Q-0310"])
    c.linetype("DASHED")
    c.msp.add_3dface([(50, 25, 0), (150, 25, 0), (150, 125, 0), (50, 125, 0)], dxfattribs=lt_attr("DASHED"))
    c.window((0, 0), (200, 150))
    c = s.case(
        "other-nonlinear",
        "linetype DASHED (48=1) on TEXT, MTEXT, SOLID, TRACE and IMAGE (frame on): all ignore it?",
        tags=["TEXT", "MTEXT", "SOLID", "TRACE", "IMAGE", "linetype"],
        questions=["Q-0311"],
    )
    c.linetype("DASHED")
    d = lt_attr("DASHED")
    c.msp.add_text("DASHED TEXT", height=12, dxfattribs=dict(d, insert=(10, 125)))
    c.msp.add_mtext("DASHED MTEXT", dxfattribs=dict(d, insert=(10, 105), char_height=12))
    c.msp.add_solid([(10, 10), (60, 10), (10, 70), (60, 70)], dxfattribs=d)
    c.msp.add_trace([(75, 10), (125, 10), (75, 70), (125, 70)], dxfattribs=d)
    path = c.add_file("linetypes-checker.png", tiny_png())
    c.doc.set_raster_variables(frame=1, quality=1, units="mm")
    idef = c.doc.add_image_def(path, (4, 4))
    img = c.msp.add_image(idef, (140, 10), (50, 60), dxfattribs=d)
    img.dxf.flags = 1 | 8  # show image, use clipping boundary
    c.window((0, 0), (200, 150))


def lineweight_cases(s: SuiteBuilder) -> None:
    lws = [0, 35, 50, 100, 211]
    for lt in ("DASHED", "DOT", "DASHDOT", "ACAD_ISO02W100", "ACAD_ISO07W100"):
        qs = ["Q-0302"] if lt in ("DOT", "DASHDOT", "ACAD_ISO07W100") else []
        if lt.startswith("ACAD_ISO"):
            qs.append("Q-0313")
        c = s.case(
            f"lw-{lt_slug(lt)}",
            f"{lt} LINEs (180) with lineweights {[w / 100 for w in lws]} mm (top to bottom): dash caps, dot size",
            tags=["LINE", "linetype", "lineweight"],
            questions=qs,
            params={"linetype": lt, "lineweights": lws},
        )
        c.linetype(lt)
        stacked_lines(c, [180.0] * len(lws), lt, extra=[{"lineweight": w} for w in lws], tick_ends=False)
    c = s.case(
        "lw-iso02-scaled",
        "ACAD_ISO02W100 LINEs: lineweight 0.25 mm with 48=0.25 vs 1.0 mm with 48=1 (ISO pen-width scaling is manual?)",
        tags=["LINE", "linetype", "lineweight", "ISO"],
        questions=["Q-0313"],
        params={"rows": [(25, 0.25), (25, 1.0), (100, 1.0), (100, 0.25)]},
    )
    c.linetype("ACAD_ISO02W100")
    stacked_lines(c, [180.0] * 4, "ACAD_ISO02W100", extra=[{"lineweight": 25, "ltscale": 0.25}, {"lineweight": 25, "ltscale": 1.0}, {"lineweight": 100, "ltscale": 1.0}, {"lineweight": 100, "ltscale": 0.25}], tick_ends=False)
    c = s.case("lw-dashed-circle", "DASHED CIRCLE and DOT ARC with lineweight 1.0 mm", tags=["CIRCLE", "ARC", "linetype", "lineweight"], questions=["Q-0302"])
    c.linetype("DASHED")
    c.msp.add_circle((60, 75), 45, dxfattribs=lt_attr("DASHED", lineweight=100))
    c.linetype("DOT")
    c.msp.add_arc((150, 75), 40, 30, 300, dxfattribs=lt_attr("DOT", lineweight=100))
    c.window((0, 0), (200, 150))


def dense_cases(s: SuiteBuilder) -> None:
    e48 = [0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0001]
    for lt in ("DASHED", "DOT"):
        c = s.case(
            f"dense-48-{lt_slug(lt)}",
            f"{lt} LINEs (180) at 10 px/unit with entity 48 = {e48}: when does PLOT go continuous?",
            tags=["LINE", "linetype", "dense", "ltscale-48"],
            questions=["Q-0312"],
            params={"linetype": lt, "entity_ltscale": e48, "dash_px_at_48_1": round(linetype_def(lt)[1][0] * 10, 6)},
        )
        c.linetype(lt)
        n = len(e48)
        for i, v in enumerate(e48):
            y = 140 - i * 15
            c.msp.add_line((10, y), (190, y), dxfattribs=lt_attr(lt, ltscale=v))
        c.window((0, 0), (200, 150))
    for lts in (1e-2, 1e-3, 1e-4, 1e-5):
        c = s.case(
            f"dense-ltscale-{int(round(-math.log10(lts))):04d}",
            f"$LTSCALE={lts:g}: DASHED and DOT LINEs (180) and DASHED CIRCLE r=40 at 10 px/unit",
            tags=["LINE", "CIRCLE", "linetype", "dense", "LTSCALE"],
            questions=["Q-0312"],
            params={"ltscale": lts},
            header={"$LTSCALE": lts},
        )
        c.linetype("DASHED")
        c.linetype("DOT")
        c.msp.add_line((10, 135), (190, 135), dxfattribs=lt_attr("DASHED"))
        c.msp.add_line((10, 115), (190, 115), dxfattribs=lt_attr("DOT"))
        c.msp.add_circle((100, 50), 40, dxfattribs=lt_attr("DASHED"))
        c.window((0, 0), (200, 150))


def odd_ltype_cases(s: SuiteBuilder) -> None:
    def lines_and_circle(c: Case, lt: str) -> None:
        for i, L in enumerate((180, 95, 47.5, 19)):
            c.msp.add_line((10, 140 - 14 * i), (10 + L, 140 - 14 * i), dxfattribs=lt_attr(lt))
        c.msp.add_circle((100, 45), 35, dxfattribs=lt_attr(lt))
        c.window((0, 0), (200, 150))

    c = s.case("odd-empty-40-5", "LTYPE EMPTY5 with 73=0 and 40=5.0 (no 49): solid? LINEs and CIRCLE", tags=["LTYPE", "linetype"], questions=["Q-0298"])
    raw_ltype(c, "EMPTY5", 5.0, [])
    lines_and_circle(c, "EMPTY5")
    for key, meas in (("1", 1), ("0", 0), ("absent", None)):
        c = s.case(
            f"odd-dashed-empty-meas-{key}",
            f"LTYPE named DASHED with 73=0/40=0, $MEASUREMENT {key}: solid, or acad.lin/acadiso.lin dashes?",
            tags=["LTYPE", "linetype", "MEASUREMENT"],
            questions=["Q-0295", "Q-0298"],
            params={"measurement": meas},
            header={"$MEASUREMENT": meas} if meas is not None else None,
        )
        if meas is None:
            del c.doc.header["$MEASUREMENT"]
        raw_ltype(c, "DASHED", 0.0, [], desc="Dashed __ __ __ __ __ __ __ __ __ __ __ __ __ _")
        lines_and_circle(c, "DASHED")
    odd = [
        ("leading-gap", 19.05, [-6.35, 12.7], "pattern starts with a gap (-6.35, 12.7), non-standard"),
        ("total-exceeds", 25.4, [12.7, -6.35], "40=25.4 > sum |49| = 19.05"),
        ("total-less", 12.7, [12.7, -6.35], "40=12.7 < sum |49| = 19.05"),
        ("total-zero", 0.0, [12.7, -6.35], "40=0 with elements 12.7,-6.35"),
        ("single-dash", 12.7, [12.7], "one element only (73=1, 49=12.7)"),
        ("single-dot", 0.0, [0.0], "one dot element only (73=1, 49=0)"),
        ("two-dashes", 19.05, [12.7, 6.35, -6.35], "consecutive dashes 12.7, 6.35 then gap -6.35"),
        ("dot-dash-start", 25.4, [0.0, -6.35, 12.7, -6.35], "first element dot then a dash"),
    ]
    for key, total, el, desc in odd:
        c = s.case(
            f"odd-{key}",
            f"Non-standard LTYPE: {desc}; LINEs of 180/95/47.5/19 and CIRCLE r=35",
            tags=["LTYPE", "linetype"],
            questions=["Q-0299"],
            params={"total": total, "elements": el},
        )
        raw_ltype(c, f"ODD_{key.upper().replace('-', '_')}", total, el)
        lines_and_circle(c, f"ODD_{key.upper().replace('-', '_')}")


def undefined_cases(s: SuiteBuilder) -> None:
    for key, name, define in (("nosuch", "NOSUCH", False), ("lowercase", "dashed", True), ("mixedcase", "Dashed", True)):
        c = s.case(
            f"undefined-{key}",
            f"Entity linetype name {name!r} "
            + ("with LTYPE DASHED defined (case-insensitive lookup?)" if define else "with no LTYPE record (invalid on purpose: does AutoCAD open/repair it?)"),
            tags=["LINE", "linetype", "undefined", "fileformat"],
            questions=["Q-0296"],
            params={"entity_linetype": name, "ltype_defined": define},
        )
        if define:
            c.linetype("DASHED")
        c.msp.add_line((10, 100), (190, 100), dxfattribs={"linetype": name})
        c.msp.add_circle((100, 50), 30, dxfattribs={"linetype": name})
        c.window((0, 0), (200, 150))


# --- L7: complex linetypes with TEXT elements --------------------------------------------


def _text_style(c: Case, name: str = "LTTEXT", height: float = 0.0) -> str:
    return c.style(name, font=TTF_FONTS["sans"], height=height)


def complex_text_cases(s: SuiteBuilder) -> None:
    # AutoCAD's own definitions on a line, an arc, a circle
    for name, el in (("GAS_LINE", GAS_LINE), ("HOT_WATER_SUPPLY", HOT_WATER)):
        c = s.case(
            f"ctext-{lt_slug(name)}-shapes",
            f"{name} (74=10 text, U=0, S=2.54, X=-2.54, Y=-1.27) on LINE, ARC 20-160 deg and CIRCLE",
            tags=["LINE", "ARC", "CIRCLE", "linetype", "complex-linetype"],
            questions=["Q-0323", "Q-0326"],
            params={"linetype": name},
        )
        complex_ltype(c, name, el)
        c.msp.add_line((10, 135), (190, 135), dxfattribs=lt_attr(name))
        c.msp.add_arc((55, 20), 45, 20, 160, dxfattribs=lt_attr(name))
        c.msp.add_circle((150, 60), 38, dxfattribs=lt_attr(name))
        c.window((0, 0), (200, 150))
    # ezdxf's own compiler output (74=2, R=0) for comparison
    c = s.case(
        "ctext-ezdxf-compiled",
        "Text linetype compiled by ezdxf from 'A,12.7,-5.08,[\"GAS\",STANDARD,S=2.54,R=0.0,X=-2.54,Y=-1.27],-6.35' (74=2) on LINE and ARC",
        tags=["LINE", "ARC", "linetype", "complex-linetype", "ezdxf"],
        questions=["Q-0323", "Q-0326"],
    )
    c.doc.linetypes.add("GAS_EZDXF", pattern='A,12.7,-5.08,["GAS",STANDARD,S=2.54,R=0.0,X=-2.54,Y=-1.27],-6.35', length=24.13, description="GAS ezdxf")
    c.msp.add_line((10, 120), (190, 120), dxfattribs=lt_attr("GAS_EZDXF"))
    c.msp.add_arc((100, 10), 80, 30, 150, dxfattribs=lt_attr("GAS_EZDXF"))
    c.window((0, 0), (200, 150))

    # rotation units: 50 in degrees vs radians
    for key, angle in (("horizontal", 0), ("angled", 30)):
        c = s.case(
            f"ctext-rot-units-{key}",
            f"Text linetypes on LINEs at {angle} deg (top to bottom): A=90 (74=3, 50=90), A=1.5708 (50=1.5708), R=90 (74=2, 50=90), R=1.5708",
            tags=["LINE", "linetype", "complex-linetype", "rotation"],
            questions=["Q-0324", "Q-0325"],
            params={"line_angle": angle, "rows": ["A 90", "A 1.5708", "R 90", "R 1.5708"]},
        )
        st = _text_style(c)
        rows = [("ROT_A90", "A", 90.0), ("ROT_A157", "A", 1.5708), ("ROT_R90", "R", 90.0), ("ROT_R157", "R", 1.5708)]
        d = Vec3.from_deg_angle(angle) * 150
        for i, (nm, mode, rot) in enumerate(rows):
            complex_ltype(c, nm, [10.0, (-6.0, {"text": "ROT", "style": st, "s": 3.0, "mode": mode, "rot": rot, "x": -4.0, "y": 0.0}), -2.0])
            p = Vec3(15, 130 - 30 * i - (d.y if angle else 0) / 4)
            c.msp.add_line(p, p + d, dxfattribs=lt_attr(nm))
        c.fit()

    # R / A / U × rotation 0 / 30 / 357.8 on lines at 8 directions
    angles = [0, 85, 90, 95, 180, 265, 270, 275]
    for mode in ("R", "A", "U"):
        for rot in (0.0, 30.0, 357.8):
            nm = f"TXT_{mode}{str(rot).replace('.', '_')}"
            c = s.case(
                f"ctext-orient-{mode.lower()}-{str(rot).replace('.', '-')}",
                f"Text linetype 'GAS' with {mode}={rot} (74={ {'R': 2, 'A': 3, 'U': 10}[mode] }) on LINEs at {angles} deg (circle = start point)",
                tags=["LINE", "linetype", "complex-linetype", "rotation", "upright"],
                questions=["Q-0325"],
                params={"mode": mode, "rotation": rot, "line_angles": angles},
            )
            el = [12.7, (-5.08, {"text": "GAS", "s": 2.54, "mode": mode, "rot": rot, "x": -2.54, "y": -1.27}), -6.35]
            complex_ltype(c, nm, el)
            for k, a in enumerate(angles):
                cx = 50 + 100 * (k % 4)
                cy = 225 - 150 * (k // 4)
                u = Vec3.from_deg_angle(a)
                half = 45 if abs(u.x) > 0.5 else 65
                p0 = Vec3(cx, cy) - u * half
                c.msp.add_line(p0, Vec3(cx, cy) + u * half, dxfattribs=lt_attr(nm))
                c.msp.add_circle(p0, 1.5, dxfattribs={"layer": ref(c)})
            c.window((0, 0), (400, 300))

    # placement: X/Y offsets, attached to a dash, long string
    placements = [
        ("xy-zero", [12.7, (-5.08, {"text": "GAS", "s": 2.54, "x": 0.0, "y": 0.0}), -6.35], "X=0 Y=0"),
        ("xy-std", [12.7, (-5.08, {"text": "GAS", "s": 2.54, "x": -2.54, "y": -1.27}), -6.35], "X=-2.54 Y=-1.27 (GAS_LINE)"),
        ("xy-pos", [12.7, (-5.08, {"text": "GAS", "s": 2.54, "x": 2.54, "y": 1.27}), -6.35], "X=2.54 Y=1.27"),
        ("xy-far", [12.7, (-5.08, {"text": "GAS", "s": 2.54, "x": -8.0, "y": 3.0}), -6.35], "X=-8 Y=3"),
        ("on-dash", [(12.7, {"text": "GAS", "s": 2.54, "x": -8.0, "y": -1.27}), -5.08, 6.35, -5.08], "text attached to the first (dash) element, X=-8"),
        ("long-string", [10.0, (-2.0, {"text": "PIPELINE-42 Ag", "s": 2.54, "x": 0.0, "y": -1.27}), -22.0], "long string 'PIPELINE-42 Ag' in a 24-unit gap, X=0"),
    ]
    for key, el, desc in placements:
        c = s.case(
            f"ctext-place-{key}",
            f"Text linetype placement: {desc}; horizontal LINE (top, 2 copies) and ARC r=60 20-160 deg",
            tags=["LINE", "ARC", "linetype", "complex-linetype", "placement"],
            questions=["Q-0326"],
            params={"elements": [list(e) if isinstance(e, tuple) else e for e in el]},
        )
        nm = f"PLACE_{key.upper().replace('-', '_')}"
        complex_ltype(c, nm, el)
        c.msp.add_line((10, 135), (190, 135), dxfattribs=lt_attr(nm))
        c.msp.add_line((10, 115), (190, 115), dxfattribs=lt_attr(nm))
        c.msp.add_arc((100, 20), 60, 20, 160, dxfattribs=lt_attr(nm))
        c.window((0, 0), (200, 150))

    # text height: S vs STYLE fixed height
    for sv in (2.54, 6.0):
        for sh in (0.0, 2.0):
            c = s.case(
                f"ctext-height-s{str(sv).replace('.', '-')}-style{str(sh).replace('.', '-')}",
                f"Text linetype S={sv} with a STYLE of fixed height {sh}: text height S or S x style height?",
                tags=["LINE", "linetype", "complex-linetype", "text-height"],
                questions=["Q-0327"],
                params={"S": sv, "style_height": sh},
            )
            st = _text_style(c, "LTH", height=sh)
            nm = "HEIGHT_T"
            complex_ltype(c, nm, [10.0, (-2.0, {"text": "Hg", "style": st, "s": sv, "x": 0.0, "y": 0.0}), -28.0])
            c.msp.add_line((55, 60), (145, 60), dxfattribs=lt_attr(nm))
            ref(c)
            c.msp.add_line((52, 60 + sv), (54, 60 + sv), dxfattribs={"layer": "REF"})
            c.window_center((100, 70), 20)
    for key, sv in (("zero", 0.0), ("neg", -1.0)):
        c = s.case(
            f"ctext-scale-{key}",
            f"Text linetype element with S={sv} (degenerate scale) on a LINE",
            tags=["LINE", "linetype", "complex-linetype"],
            questions=["Q-0328"],
            params={"S": sv},
        )
        st = _text_style(c)
        complex_ltype(c, "SCALE_T", [12.7, (-5.08, {"text": "GAS", "style": st, "s": sv, "x": -2.54, "y": -1.27}), -6.35])
        c.msp.add_line((10, 75), (190, 75), dxfattribs=lt_attr("SCALE_T"))
        c.window((0, 0), (200, 150))

    # shape element pointing at a shape file that does not exist
    c = s.case(
        "ctext-missing-shx",
        "Shape linetype element (74=4, 75=131) whose STYLE shape file 'truedxf-missing.shx' does not exist (missing on purpose)",
        tags=["LINE", "linetype", "complex-linetype", "shape", "missing-font"],
        questions=["Q-0329"],
    )
    shx = c.doc.styles.get_shx("truedxf-missing.shx")  # shape-file STYLE entry (flag 1, empty name)
    complex_ltype(c, "MISSING_SHP", [2.54, (-5.08, {"shape": 131, "style_handle": shx.dxf.handle, "s": 5.08, "x": -5.08}), -10.16])
    c.msp.add_line((10, 75), (190, 75), dxfattribs=lt_attr("MISSING_SHP"))
    c.window((0, 0), (200, 150))

    # mirrored INSERT of a text linetype
    c = s.case(
        "ctext-insert-mirror",
        "Block with a GAS_LINE LINE inserted at scale (1,1) (top) and (-1,1) (bottom): mirrored/upright texts?",
        tags=["INSERT", "linetype", "complex-linetype", "insert-scale"],
        questions=["Q-0325", "Q-0320"],
    )
    complex_ltype(c, "GAS_LINE", GAS_LINE)
    blk = c.doc.blocks.new("GASB")
    blk.add_line((0, 0), (170, 0), dxfattribs=lt_attr("GAS_LINE"))
    c.msp.add_blockref("GASB", (15, 110))
    c.msp.add_blockref("GASB", (185, 40), dxfattribs={"xscale": -1})
    c.window((0, 0), (200, 150))


def random_cases(s: SuiteBuilder) -> None:
    names = SIMPLE_LINETYPES + ISO_LINETYPES
    for seed in range(1, 7):
        c = s.case(f"random-{seed:04d}", f"Random LINEs/ARCs/CIRCLEs/LWPOLYLINEs with random linetypes and 48, seed {seed}", tags=["LINE", "ARC", "CIRCLE", "LWPOLYLINE", "linetype"], seed=seed)
        rng = c.rng
        for _ in range(8):
            lt = c.linetype(rng.choice(names))
            d = lt_attr(lt, ltscale=rng.choice([0.25, 0.5, 1.0, 1.0, 2.0]))
            kind = rng.choice(["line", "line", "arc", "circle", "pl"])
            if kind == "line":
                c.msp.add_line((rng.uniform(10, 190), rng.uniform(10, 140)), (rng.uniform(10, 190), rng.uniform(10, 140)), dxfattribs=d)
            elif kind == "arc":
                c.msp.add_arc((rng.uniform(50, 150), rng.uniform(40, 110)), rng.uniform(10, 40), rng.uniform(0, 360), rng.uniform(0, 360), dxfattribs=d)
            elif kind == "circle":
                c.msp.add_circle((rng.uniform(50, 150), rng.uniform(40, 110)), rng.uniform(5, 35), dxfattribs=d)
            else:
                pts = [(rng.uniform(10, 190), rng.uniform(10, 140), 0, 0, rng.choice([0, 0, 0.4, -0.7])) for _ in range(rng.randint(3, 6))]
                pl = c.msp.add_lwpolyline(pts, format="xyseb", close=rng.random() < 0.3, dxfattribs=d)
                if rng.random() < 0.5:
                    pl.dxf.flags |= 128
        c.window((0, 0), (200, 150))
