"""MLINE / MLINESTYLE: STANDARD and custom styles, justification, scale, closed, sharp angles,
caps (square / outer arcs / inner arcs, start/end angles), miters, fill, element colours and
linetypes, hand-written break and fill-break parameters (note 07 §12, note 02 MLINESTYLE).

Geometry is computed by ezdxf's add_mline (miter vectors + element offsets); AutoCAD renders the
stored vertex data, the DXFOUT re-save shows whether it keeps or recomputes them."""

from __future__ import annotations

import math

from ..core import SuiteBuilder, suite
from ._blocks_util import ref_layer

ZIGZAG = [(20, 30), (70, 110), (120, 40), (180, 110)]
TWOSEG = [(30, 55), (115, 55), (170, 115)]

S = 16  # start square
SI = 32  # start inner arcs
SR = 64  # start round (outer arcs)
E = 256  # end square
EI = 512  # end inner arcs
ER = 1024  # end round


def _style(doc, name: str, elements, flags: int = 0, fill_color: int = 256, start: float = 90, end: float = 90):
    st = doc.mline_styles.new(name)
    st.dxf.flags = flags
    st.dxf.fill_color = fill_color
    st.dxf.start_angle = start
    st.dxf.end_angle = end
    for off, col, lt in elements:
        st.elements.append(off, col, lt)
    return st


def _refpath(c, pts, closed=False) -> None:
    ref_layer(c)
    c.msp.add_lwpolyline(pts, close=closed, dxfattribs={"layer": "REF"})


RGB3 = [(1, 1, "BYLAYER"), (0, 3, "BYLAYER"), (-1, 5, "BYLAYER")]


def _elems(n: int):
    """n elements, offsets evenly from +1 to -1, colours 1..n."""
    cols = [1, 3, 5, 2, 6, 4, 30]
    return [(1 - 2 * k / (n - 1), cols[k], "BYLAYER") for k in range(n)]


@suite("mline", "MLINE / MLINESTYLE: styles, caps, miters, fill, justification", style_table="acad.ctb", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    # --- STANDARD style: justification and scale
    for just, jname in ((0, "top"), (1, "zero"), (2, "bottom")):
        c = s.case(f"standard-just-{jname}", f"STANDARD MLINE (offsets +-0.5) scale 20, justification {jname} ({just}); REF = picked path", tags=["MLINE", "justification"], questions=[], params={"justification": just})
        ml = c.msp.add_mline(dxfattribs={"scale_factor": 20, "justification": just})
        ml.extend(ZIGZAG)
        _refpath(c, ZIGZAG)
        c.window((0, 0), (200, 150))
    for i, sc in enumerate([5, 12, -20], 1):
        c = s.case(f"standard-scale-{i:04d}", f"STANDARD MLINE zero justification, scale {sc}", tags=["MLINE", "scale"], params={"scale": sc})
        ml = c.msp.add_mline(dxfattribs={"scale_factor": sc, "justification": 1})
        ml.extend(ZIGZAG)
        _refpath(c, ZIGZAG)
        c.window((0, 0), (200, 150))
    c = s.case("standard-closed", "Closed STANDARD MLINE (5 vertices), scale 12, top justification", tags=["MLINE", "closed"])
    pts = [(30, 30), (170, 30), (170, 120), (100, 80), (30, 120)]
    ml = c.msp.add_mline(pts, close=True, dxfattribs={"scale_factor": 12, "justification": 0})
    _refpath(c, pts, True)
    c.window((0, 0), (200, 150))
    for i, inner in enumerate([90, 45, 20, 8], 1):
        c = s.case(f"sharp-angle-{i:04d}", f"STANDARD MLINE scale 6, two segments enclosing {inner} deg (long miter at the corner)", tags=["MLINE", "miter"], params={"interior_angle_deg": inner})
        a = math.radians(180 - inner)
        p0, p1 = (30, 40), (140, 40)
        p2 = (p1[0] + 95 * math.cos(a), p1[1] + 95 * math.sin(a))
        ml = c.msp.add_mline([p0, p1, p2], dxfattribs={"scale_factor": 6, "justification": 1})
        _refpath(c, [p0, p1, p2])
        c.window((0, 0), (200, 150))

    # --- element colours, caps, miters, fill
    c = s.case("style3-colors", "3-element style (offsets 1/0/-1, colours red/green/blue), no caps, scale 12", tags=["MLINE", "MLINESTYLE", "color"])
    _style(c.doc, "S3", RGB3)
    c.msp.add_mline(ZIGZAG, dxfattribs={"style_name": "S3", "scale_factor": 12, "justification": 1})
    c.window((0, 0), (200, 150))

    caps = [
        ("square", S | E, 3),
        ("round", SR | ER, 3),
        ("inner-3", SI | EI, 3),
        ("inner-4", SI | EI, 4),
        ("inner-5", SI | EI, 5),
        ("inner-6", SI | EI, 6),
        ("outer-inner-3", SR | ER | SI | EI, 3),
        ("outer-inner-4", SR | ER | SI | EI, 4),
        ("all-5", S | SI | SR | E | EI | ER, 5),
        ("round-start-square-end", SR | E, 3),
    ]
    for key, flags, n in caps:
        qs = []
        if "inner" in key or key == "all-5":
            qs.append("Q-0684")
        if key.startswith("outer-inner") or key == "round":
            qs.append("Q-0683")
        if key == "square":
            qs.append("Q-0682")
        c = s.case(f"caps-{key}", f"{n}-element style (distinct colours), caps flags {flags} ({key}), scale 10, 2 segments", tags=["MLINE", "MLINESTYLE", "caps"], questions=qs, params={"flags": flags, "elements": n})
        _style(c.doc, "CAP", _elems(n) if n != 3 else RGB3, flags=flags)
        c.msp.add_mline(TWOSEG, dxfattribs={"style_name": "CAP", "scale_factor": 10, "justification": 1})
        c.window((0, 0), (200, 150))

    for key, flag_bits in (("start", 4), ("end", 8)):
        c = s.case(f"caps-suppressed-{key}", f"Style with round+square caps at both ends, MLINE flag {flag_bits} suppresses the {key} caps", tags=["MLINE", "caps"], params={"mline_flag": flag_bits})
        _style(c.doc, "CAP", RGB3, flags=S | SR | E | ER)
        ml = c.msp.add_mline(TWOSEG, dxfattribs={"style_name": "CAP", "scale_factor": 10, "justification": 1})
        ml.dxf.flags |= flag_bits
        c.window((0, 0), (200, 150))

    for closed in (False, True):
        c = s.case(f"miters-{'closed' if closed else 'open'}", f"3-element style red/green/blue, show miters (flag 2) + square caps, {'closed' if closed else 'open'} MLINE scale 10", tags=["MLINE", "miter", "caps"] + (["closed"] if closed else []), questions=["Q-0682"], params={"closed": closed})
        _style(c.doc, "MIT", RGB3, flags=2 | S | E)
        pts = [(25, 30), (100, 30), (160, 110), (60, 120)]
        c.msp.add_mline(pts, close=closed, dxfattribs={"style_name": "MIT", "scale_factor": 10, "justification": 1})
        c.window((0, 0), (200, 150))

    for key, flags in (("square", S | E), ("inner", SI | EI), ("round", SR | ER), ("all", S | SI | SR | E | EI | ER)):
        for closed in (False, True):
            if closed and key != "all":
                continue
            c = s.case(
                f"angles-45-135-{key}{'-closed' if closed else ''}",
                f"5-element style, start angle 45 / end angle 135, {key} caps, {'closed' if closed else 'open'} MLINE scale 10",
                tags=["MLINE", "MLINESTYLE", "caps", "angle"], questions=["Q-0681"], params={"flags": flags, "start_angle": 45, "end_angle": 135, "closed": closed},
            )
            _style(c.doc, "ANG", _elems(5), flags=flags, start=45, end=135)
            pts = TWOSEG if not closed else [(30, 30), (170, 40), (110, 125)]
            c.msp.add_mline(pts, close=closed, dxfattribs={"style_name": "ANG", "scale_factor": 10, "justification": 1})
            c.window((0, 0), (200, 150))

    for sc in (10, -10):
        c = s.case(f"fill-round-{'neg' if sc < 0 else 'pos'}", f"Filled 3-element style (fill colour 2), round + inner caps, scale {sc}", tags=["MLINE", "fill", "caps"], questions=["Q-0685"], params={"scale": sc})
        _style(c.doc, "FIL", RGB3, flags=1 | SR | ER | SI | EI, fill_color=2)
        c.msp.add_mline(TWOSEG, dxfattribs={"style_name": "FIL", "scale_factor": sc, "justification": 1})
        c.window((0, 0), (200, 150))
    c = s.case("fill-bylayer-miters", "Filled 3-element style (fill BYLAYER on layer colour 4), show miters, no caps, zig-zag", tags=["MLINE", "fill", "miter"], questions=["Q-0685"])
    c.layer("ML", color=4)
    _style(c.doc, "FIL", RGB3, flags=1 | 2, fill_color=256)
    c.msp.add_mline(ZIGZAG, dxfattribs={"style_name": "FIL", "scale_factor": 10, "justification": 1, "layer": "ML"})
    c.window((0, 0), (200, 150))
    c = s.case("fill-closed", "Filled closed MLINE (fill colour 2) with a 2-element style offsets 0/-1 (bottom edge = path), scale 12", tags=["MLINE", "fill", "closed"])
    _style(c.doc, "FIL", [(0, 1, "BYLAYER"), (-1, 5, "BYLAYER")], flags=1, fill_color=2)
    pts = [(30, 30), (170, 30), (170, 120), (100, 80), (30, 120)]
    c.msp.add_mline(pts, close=True, dxfattribs={"style_name": "FIL", "scale_factor": 12, "justification": 1})
    c.window((0, 0), (200, 150))

    # --- property resolution of element colours / linetypes
    def _lt(c):
        for lt in ("DASHED", "CENTER", "PHANTOM", "DASHDOT", "HIDDEN"):
            c.linetype(lt)
        c.layer("ML", color=3, linetype="CENTER")

    PROPS = [(1.5, 6, "DASHED"), (0.5, 0, "BYLAYER"), (-0.5, 256, "BYBLOCK"), (-1.5, 0, "BYBLOCK")]
    desc = "elements (6,DASHED) (BYBLOCK,BYLAYER) (BYLAYER,BYBLOCK) (BYBLOCK,BYBLOCK); layer ML green CENTER"
    c = s.case("props-modelspace", f"MLINE colour red linetype PHANTOM on layer ML; {desc}", tags=["MLINE", "BYBLOCK", "BYLAYER", "color", "linetype"], questions=["Q-0677"], header={"$LTSCALE": 0.3})
    _lt(c)
    _style(c.doc, "PR", PROPS)
    c.msp.add_mline(ZIGZAG, dxfattribs={"style_name": "PR", "scale_factor": 8, "justification": 1, "layer": "ML", "color": 1, "linetype": "PHANTOM"})
    c.window((0, 0), (200, 150))
    for key, mattrs in (("explicit", {"color": 1, "linetype": "PHANTOM"}), ("byblock", {"color": 0, "linetype": "BYBLOCK"})):
        c = s.case(f"props-in-insert-{key}", f"MLINE ({key} colour/linetype) inside a block INSERTed with colour blue, linetype DASHDOT; {desc}", tags=["MLINE", "INSERT", "BYBLOCK", "color", "linetype"], questions=["Q-0677"], header={"$LTSCALE": 0.3}, params={"mline": mattrs})
        _lt(c)
        _style(c.doc, "PR", PROPS)
        blk = c.doc.blocks.new("MB")
        blk.add_mline(ZIGZAG, dxfattribs={"style_name": "PR", "scale_factor": 8, "justification": 1, "layer": "0", **mattrs})
        c.msp.add_blockref("MB", (0, 0), dxfattribs={"color": 5, "linetype": "DASHDOT", "layer": "ML"})
        c.window((0, 0), (200, 150))
    c = s.case("true-color", "MLINE 62=1 with true colour 420 = green (0x00C000), style elements BYBLOCK/BYBLOCK/5", tags=["MLINE", "true-color"], questions=["Q-0678"])
    _style(c.doc, "TC", [(1, 0, "BYLAYER"), (0, 0, "BYLAYER"), (-1, 5, "BYLAYER")], flags=1 | S | E, fill_color=0)
    c.msp.add_mline(ZIGZAG, dxfattribs={"style_name": "TC", "scale_factor": 10, "justification": 1, "color": 1, "true_color": 0x00C000})
    c.window((0, 0), (200, 150))
    c = s.case("style-name-handle-mismatch", "MLINE group 2 names style A (red elements) but 340 points to style B (blue elements, same offsets)", tags=["MLINE", "MLINESTYLE", "handle"], questions=["Q-0277"])
    _style(c.doc, "A", [(1, 1, "BYLAYER"), (-1, 1, "BYLAYER")])
    _style(c.doc, "B", [(1, 5, "BYLAYER"), (-1, 5, "BYLAYER")], flags=S | E)
    ml = c.msp.add_mline(ZIGZAG, dxfattribs={"style_name": "B", "scale_factor": 10, "justification": 1})
    ml.dxf.style_name = "A"
    c.window((0, 0), (200, 150))

    # --- unsorted element offsets with top / bottom justification (ezdxf: shift by max/min offset)
    for just, jname in ((0, "top"), (2, "bottom")):
        c = s.case(f"unsorted-offsets-{jname}", f"Style with unsorted offsets 0 / 0.5 / -0.5 (red/green/blue), {jname} justification, scale 20; geometry by ezdxf (-max/-min shift)", tags=["MLINE", "justification"], questions=["Q-0676"], params={"justification": just})
        _style(c.doc, "UN", [(0, 1, "BYLAYER"), (0.5, 3, "BYLAYER"), (-0.5, 5, "BYLAYER")], flags=S | E)
        c.msp.add_mline(ZIGZAG, dxfattribs={"style_name": "UN", "scale_factor": 20, "justification": just})
        _refpath(c, ZIGZAG)
        c.window((0, 0), (200, 150))

    # --- hand-written break (MLEDIT cut) and fill-break parameters
    for key in ("cut-all", "cut-single", "two-gaps"):
        c = s.case(f"breaks-{key}", f"3-element MLINE with hand-written 41 break parameters ({key}) on the first segment (gap from 30 to 45 along the segment)", tags=["MLINE", "breaks"], questions=["Q-0686"], params={"variant": key})
        _style(c.doc, "BR", RGB3, flags=S | E)
        ml = c.msp.add_mline(TWOSEG, dxfattribs={"style_name": "BR", "scale_factor": 10, "justification": 1})
        v0 = ml.vertices[0]
        new = []
        for k, lp in enumerate(v0.line_params):
            a0 = lp[0]
            if key == "cut-all" or (key == "cut-single" and k == 1):
                new.append((a0, 0.0, 30.0, 45.0))
            elif key == "two-gaps":
                new.append((a0, 5.0, 20.0, 30.0, 50.0, 60.0))
            else:
                new.append(tuple(lp))
        v0.line_params = new
        c.params["line_params_vertex0"] = [list(p) for p in new]
        c.window((0, 0), (200, 150))
    for key, fp in (("stop-start", (30.0, 45.0)), ("with-start", (0.0, 30.0, 45.0))):
        c = s.case(f"fill-breaks-{key}", f"Filled 3-element MLINE with hand-written 42 fill parameters {fp} for every element of segment 1 (guessed MLEDIT layout)", tags=["MLINE", "fill", "breaks"], questions=["Q-0687"], params={"fill_params": fp})
        _style(c.doc, "FB", RGB3, flags=1 | S | E, fill_color=2)
        ml = c.msp.add_mline(TWOSEG, dxfattribs={"style_name": "FB", "scale_factor": 10, "justification": 1})
        ml.vertices[0].fill_params = [fp for _ in ml.vertices[0].line_params]
        c.window((0, 0), (200, 150))

    # --- MLINE inside transformed INSERTs
    for key, attrs in (("rot-scale", {"rotation": 30, "xscale": 1.5, "yscale": 1.5}), ("nonuniform", {"xscale": 2, "yscale": 0.6}), ("mirror", {"xscale": -1})):
        c = s.case(f"in-insert-{key}", f"Filled 3-element MLINE with round caps inside a block, INSERT {attrs}", tags=["MLINE", "INSERT"], params={"insert": attrs})
        _style(c.doc, "IB", RGB3, flags=1 | 2 | SR | E, fill_color=2)
        blk = c.doc.blocks.new("MI")
        blk.add_mline([(0, 0), (50, 0), (70, 35)], dxfattribs={"style_name": "IB", "scale_factor": 6, "justification": 1})
        c.msp.add_blockref("MI", (60 if attrs.get("xscale", 1) > 0 else 140, 40), dxfattribs=attrs)
        c.fit()

    # --- seeded random
    for seed in range(1, 5):
        c = s.case(f"random-{seed:04d}", f"Random MLINE path/style (elements, caps, fill, miters, justification), seed {seed}", tags=["MLINE"], seed=seed)
        rng = c.rng
        n = rng.randint(2, 5)
        offs = sorted((rng.uniform(-1, 1) for _ in range(n)), reverse=True)
        elems = [(round(o, 4), rng.choice([1, 2, 3, 4, 5, 6, 0, 256]), "BYLAYER") for o in offs]
        flags = rng.choice([0, 1]) | rng.choice([0, 2]) | rng.choice([0, S, SR, SI, S | SR]) | rng.choice([0, E, ER, EI, E | ER])
        _style(c.doc, "RND", elems, flags=flags, fill_color=rng.choice([2, 8, 256]))
        pts = [(rng.uniform(20, 180), rng.uniform(20, 130)) for _ in range(rng.randint(2, 6))]
        closed = rng.random() < 0.3 and len(pts) > 2
        c.msp.add_mline(pts, close=closed, dxfattribs={"style_name": "RND", "scale_factor": rng.choice([6, 10, -8]), "justification": rng.choice([0, 1, 2])})
        c.params.update({"elements": elems, "flags": flags, "closed": closed})
        c.window((0, 0), (200, 150))
