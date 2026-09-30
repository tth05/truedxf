"""HATCH / MPOLYGON: solid, pattern (stored lines), user-defined/custom patterns, islands and hatch
styles, boundary edge types, gaps, full circles, gradients, background colour, INSERT transforms,
density limit (note 06 §1, §9, H1-H14, G1-G2; 11a §11; 11b §11; 11c §7).

Conventions: the 200x150 window at 10 px/unit; the default fill area is the rectangle
(20,15)-(180,135); a hairline REF rectangle 3 units outside the boundary marks where the (invisible)
hatch boundary is. Pattern definitions come from ezdxf's ISO table (acadiso.pat values, since the
fixtures are metric) and are stored pre-scaled/pre-rotated like AutoCAD does.
"""

from __future__ import annotations

import math
from typing import Optional, Sequence

from ezdxf.entities.pattern import Pattern
from ezdxf.math import Vec2
from ezdxf.tools.pattern import ISO_PATTERN

from ..core import Case, SuiteBuilder, TextEntityAlignment, suite

W = ((0, 0), (200, 150))
RECT = (20, 15, 180, 135)
GRADIENTS = ["LINEAR", "CYLINDER", "INVCYLINDER", "SPHERICAL", "INVSPHERICAL", "HEMISPHERICAL",
             "INVHEMISPHERICAL", "CURVED", "INVCURVED"]
BLACK, WHITE = (0, 0, 0), (255, 255, 255)


# ------------------------------------------------------------------------------------------------
# helpers


def _rect(x0: float, y0: float, x1: float, y1: float) -> list[tuple[float, float]]:
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def _win(c: Case) -> None:
    c.window(*W)


def _ref(c: Case, pts: Sequence[Sequence[float]], closed: bool = True) -> None:
    """Hairline reference polyline (layer REF, colour 8)."""
    c.layer("REF", color=8, lineweight=0)
    c.msp.add_lwpolyline([(p[0], p[1]) for p in pts], close=closed, dxfattribs={"layer": "REF"})


def _ref_rect(c: Case, r=RECT, off: float = 3.0) -> None:
    x0, y0, x1, y1 = r
    _ref(c, _rect(x0 - off, y0 - off, x1 + off, y1 + off))


def _hatch(space, color: int = 256, **attrs):
    """HATCH with BYLAYER colour (ezdxf's default would be 7)."""
    return space.add_hatch(color=color, dxfattribs=attrs)


def _pat(h, name: str, scale: float = 1.0, angle: float = 0.0, style: int = 0, ptype: int = 1,
         definition=None, double: int = 0) -> None:
    """Pattern fill with the definition stored pre-scaled/rotated (ezdxf set_pattern_fill)."""
    defn = ISO_PATTERN[name] if definition is None else definition
    h.set_pattern_fill(name, color=h.dxf.color, angle=angle, scale=scale, double=double,
                       style=style, pattern_type=ptype, definition=defn)


def _user_def(double: bool) -> list:
    """User-defined (76=0) base definition: spacing 1 at 0 deg (+ 90 deg family if double)."""
    d = [[0.0, (0.0, 0.0), (0.0, 1.0), []]]
    if double:
        d.append([90.0, (0.0, 0.0), (-1.0, 0.0), []])
    return d


def _shift_base(h, dx: float, dy: float) -> None:
    """Move the pattern origin: add (dx, dy) to every stored base point (what HPORIGIN does)."""
    for line in h.pattern.lines:
        line.base_point = Vec2(line.base_point) + Vec2(dx, dy)


def _edge_rect(h, x0: float, y0: float, x1: float, y1: float, flags: int):
    """Edge path of 4 line edges (CCW)."""
    p = h.paths.add_edge_path(flags=flags)
    pts = _rect(x0, y0, x1, y1)
    for i in range(4):
        p.add_line(pts[i], pts[(i + 1) % 4])
    return p


def _solid_rect_hatch(c: Case, r=RECT, color: int = 256, **attrs):
    h = _hatch(c.msp, color=color, **attrs)
    h.paths.add_polyline_path(_rect(*r), flags=1)
    return h


def _pattern_rect(c: Case, name: str, scale=1.0, angle=0.0, r=RECT, ref=True, **kw):
    h = _hatch(c.msp)
    h.paths.add_polyline_path(_rect(*r), flags=1)
    _pat(h, name, scale, angle, **kw)
    if ref:
        _ref_rect(c, r)
    return h


class _EmptyPattern(Pattern):
    """A pattern that exports `78 0` (ezdxf omits 52/41/77/78 for an empty pattern)."""

    def __bool__(self) -> bool:
        return True

    def export_dxf(self, tagwriter, force=False) -> None:  # noqa: ARG002
        tagwriter.write_tag2(78, 0)


def _appid(c: Case, name: str) -> None:
    if name not in c.doc.appids:
        c.doc.appids.new(name)


def _raw_color(top: int, value: int) -> int:
    """1071 raw colour (signed 32 bit): 0xC0 BYLAYER, 0xC1 BYBLOCK, 0xC2 RGB, 0xC3 ACI."""
    v = (top << 24) | value
    return v - (1 << 32) if v >= (1 << 31) else v


def _insert_at(c: Case, name: str, bcenter, scale=(1.0, 1.0), rot: float = 0.0, at=(100, 75)):
    """INSERT so that block point ``bcenter`` lands at ``at``."""
    sx, sy = scale
    a = math.radians(rot)
    px, py = bcenter[0] * sx, bcenter[1] * sy
    rx, ry = px * math.cos(a) - py * math.sin(a), px * math.sin(a) + py * math.cos(a)
    return c.msp.add_blockref(name, (at[0] - rx, at[1] - ry),
                              dxfattribs={"xscale": sx, "yscale": sy, "rotation": rot})


def _fmt(v: float) -> str:
    return (f"{v:g}").replace(".", "p").replace("-", "m")


# ------------------------------------------------------------------------------------------------


@suite("hatches", "HATCH / MPOLYGON: fills, patterns, islands, edges, gradients", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    _solid(s)
    _patterns(s)
    _stored_lines(s)
    _user_custom(s)
    _origin(s)
    _islands(s)
    _boundaries(s)
    _appearance(s)
    _inserts_ocs(s)
    _density(s)
    _gradients(s)
    _mpolygon(s)
    _random(s)


# --- solid fills ---------------------------------------------------------------------------------


def _solid(s: SuiteBuilder) -> None:
    for name, color, rgb, layer in [
        ("aci-1", 1, None, None),
        ("aci-7", 7, None, None),
        ("aci-bylayer", 256, None, ("GREEN", 3, None)),
        ("truecolor", 1, (255, 128, 0), None),
        ("truecolor-bylayer", 256, None, ("TC", 1, 0x1E90FF)),
    ]:
        c = s.case(f"solid-{name}", f"SOLID HATCH rectangle, colour {name}", tags=["HATCH", "solid", "color"],
                   params={"color": color, "rgb": rgb, "layer": layer}, style_table="acad.ctb")
        attrs = {}
        if layer:
            c.layer(layer[0], color=layer[1], true_color=layer[2], lineweight=0)
            attrs["layer"] = layer[0]
        h = _solid_rect_hatch(c, color=color, **attrs)
        if rgb:
            h.rgb = rgb
        _win(c)

    c = s.case("solid-lineweight-211", "SOLID HATCH with lineweight 2.11 mm between two hairline LINEs on its left/right boundary (outline added?)",
               tags=["HATCH", "solid", "lineweight"], questions=["Q-0356"], params={"lineweight": 211})
    _solid_rect_hatch(c, r=(40, 30, 160, 120), lineweight=211)
    c.msp.add_line((40, 10), (40, 140))
    c.msp.add_line((160, 10), (160, 140))
    _win(c)

    c = s.case("solid-fillmode-0", "SOLID HATCH and ANSI31 HATCH with $FILLMODE=0 (outline only?)",
               tags=["HATCH", "solid", "FILLMODE"], header={"$FILLMODE": 0}, params={"fillmode": 0})
    _solid_rect_hatch(c, r=(20, 30, 95, 120))
    _pattern_rect(c, "ANSI31", 1.0, r=(105, 30, 180, 120), ref=False)
    _win(c)

    # polygon with holes as a single solid hatch; polyline path with bulges
    c = s.case("solid-poly-bulges", "SOLID HATCH polyline path with bulges (rounded rectangle, one concave side)",
               tags=["HATCH", "solid", "bulge"])
    h = _hatch(c.msp)
    h.paths.add_polyline_path([(40, 20, 0), (160, 20, 0.4142136), (180, 40, 0), (180, 110, 0.4142136),
                               (160, 130, 0), (40, 130, -0.3), (40, 20, 0)][:-1], flags=1)
    _win(c)
    c = s.case("solid-poly-semicircles", "SOLID HATCH polyline path: two semicircle bulges (+1 and -1) on a rectangle",
               tags=["HATCH", "solid", "bulge"])
    h = _hatch(c.msp)
    h.paths.add_polyline_path([(50, 30, 0), (150, 30, 1), (150, 120, 0), (50, 120, -1)], flags=1)
    _ref(c, [(50, 30), (150, 30), (150, 120), (50, 120)])
    _win(c)


# --- predefined patterns -----------------------------------------------------------------------------

GALLERY = ["ANSI31", "ANSI32", "ANSI33", "ANSI37", "AR-BRSTD", "AR-CONC", "AR-SAND", "AR-HBONE",
           "AR-PARQ1", "ISO02W100", "ACAD_ISO04W100", "GRAVEL", "HONEY", "NET", "DOTS", "ZIGZAG",
           "ESCHER", "BRICK", "CROSS", "STARS", "TRIANG", "HEX", "EARTH", "DASH", "INSUL", "SWAMP"]


# AR-* patterns are real-world sized (acadiso: AR-BRSTD courses 67.7 mm apart); these base scales
# make them readable on the 160x120 area. All other patterns use scale 1.
BASE_SCALE = {"AR-BRSTD": 0.2, "AR-CONC": 0.25, "AR-SAND": 0.25, "AR-HBONE": 0.1, "AR-PARQ1": 0.1}


def _patterns(s: SuiteBuilder) -> None:
    for name in GALLERY:
        sc = BASE_SCALE.get(name, 1.0)
        c = s.case(f"pattern-{name.lower().replace('_', '-')}", f"Predefined pattern {name} (acadiso values) scale {sc} angle 0 on a 160x120 rectangle",
                   tags=["HATCH", "pattern", name], params={"pattern": name, "scale": sc, "angle": 0},
                   questions=["Q-0341"] if name in ("ANSI33", "AR-BRSTD", "BRICK", "DASH") else [])
        _pattern_rect(c, name, sc)
        _win(c)

    # sweeps: scale {0.25,0.5,2}x base (angle 0), angle {30,45,90} (base scale), one combined
    for name in ["ANSI31", "AR-CONC", "BRICK", "HONEY"]:
        b = BASE_SCALE.get(name, 1.0)
        combos = [(0.25 * b, 0), (0.5 * b, 0), (2 * b, 0), (b, 30), (b, 45), (b, 90), (2 * b, 30)]
        for sc, ang in combos:
            c = s.case(f"sweep-{name.lower()}-s{_fmt(sc)}-a{ang}", f"{name} scale {sc} angle {ang}: stored lines pre-scaled/rotated",
                       tags=["HATCH", "pattern", name, "scale", "angle"], params={"pattern": name, "scale": sc, "angle": ang},
                       questions=["Q-0331"] if name == "ANSI31" else (["Q-0341"] if name == "BRICK" else []))
            _pattern_rect(c, name, sc, ang)
            _win(c)

    # dashes crossing the boundary (Q-0341)
    c = s.case("clip-ansi33-large", "ANSI33 at scale 4: long dashes straddle the rectangle edges (clipped exactly?)",
               tags=["HATCH", "pattern", "clip"], questions=["Q-0341"], params={"pattern": "ANSI33", "scale": 4})
    _pattern_rect(c, "ANSI33", 4)
    _win(c)
    c = s.case("clip-dash-diamond", "DASH pattern scale 3 angle 10 on a diamond: dashes cut by slanted edges",
               tags=["HATCH", "pattern", "clip"], questions=["Q-0341"], params={"pattern": "DASH", "scale": 3, "angle": 10})
    h = _hatch(c.msp)
    dia = [(100, 10), (180, 75), (100, 140), (20, 75)]
    h.paths.add_polyline_path(dia, flags=1)
    _pat(h, "DASH", 3, 10)
    _win(c)

    # pattern lines collinear with boundary edges (Q-0342)
    c = s.case("collinear-user-edges", "User-defined 0 deg lines, spacing 10, base y=15: lines coincide with the bottom and top edges",
               tags=["HATCH", "pattern", "collinear"], questions=["Q-0342"])
    h = _hatch(c.msp)
    h.paths.add_polyline_path(_rect(*RECT), flags=1)
    _pat(h, "_USER", 10, 0, ptype=0, definition=_user_def(False))
    _shift_base(h, 0, 15)
    _win(c)
    c = s.case("collinear-ansi31-diamond", "ANSI31 through the vertices of a 45-deg diamond: pattern lines lie on two edges",
               tags=["HATCH", "pattern", "collinear"], questions=["Q-0342"])
    h = _hatch(c.msp)
    h.paths.add_polyline_path([(100, 15), (160, 75), (100, 135), (40, 75)], flags=1)
    sc = (120 / math.sqrt(2)) / (3.175 * 20)
    _pat(h, "ANSI31", sc, 0)
    _shift_base(h, 100, 15)
    c.params = {"scale": sc, "base": (100, 15)}
    _win(c)


# --- stored lines vs name/scale/angle (the CONFLICT) -------------------------------------------------


def _stored_lines(s: SuiteBuilder) -> None:
    q = ["Q-0331"]
    c = s.case("stored-consistent", "ANSI31 41=2 52=30 with correctly pre-scaled/rotated stored lines",
               tags=["HATCH", "pattern", "stored-lines"], questions=q)
    _pattern_rect(c, "ANSI31", 2, 30)
    _win(c)

    c = s.case("stored-unscaled", "ANSI31 41=2 52=30 but stored lines of scale 1 angle 0 (renders stored or regenerated?)",
               tags=["HATCH", "pattern", "stored-lines"], questions=q)
    h = _pattern_rect(c, "ANSI31", 1, 0)
    h.dxf.pattern_scale = 2.0
    h.dxf.pattern_angle = 30.0
    c.notes.append("harness: plot, REGEN(ALL), plot again to see whether a regen re-derives the lines")
    _win(c)

    c = s.case("stored-edited", "ANSI31 41=2 52=30 with hand-edited stored line: 53=0, spacing 5 (horizontal lines)",
               tags=["HATCH", "pattern", "stored-lines"], questions=q)
    h = _pattern_rect(c, "ANSI31", 1, 0, definition=[[0.0, (0.0, 0.0), (0.0, 5.0), []]])
    h.dxf.pattern_scale = 2.0
    h.dxf.pattern_angle = 30.0
    _win(c)

    c = s.case("stored-qcad-placeholder", "QCAD-style placeholder: name AR-BRSTD 76=1 but a single solid 45-deg line stored",
               tags=["HATCH", "pattern", "stored-lines", "qcad"], questions=q)
    _pattern_rect(c, "AR-BRSTD", 1, 0, definition=ISO_PATTERN["ANSI31"])
    _win(c)

    c = s.case("stored-wrong-name", "Name ANSI37 (cross) but ANSI31 lines stored at scale 2",
               tags=["HATCH", "pattern", "stored-lines"], questions=q)
    h = _pattern_rect(c, "ANSI37", 2, 0, definition=ISO_PATTERN["ANSI31"])
    _win(c)

    c = s.case("stored-custom-missing-pat", "Custom pattern 76=2 named NOSUCHPAT (no .pat file) with an embedded dashed cross",
               tags=["HATCH", "pattern", "custom", "stored-lines"], questions=["Q-0334", "Q-0331"])
    _pattern_rect(c, "NOSUCHPAT", 1, 0, ptype=2,
                  definition=[[0.0, (0.0, 0.0), (0.0, 8.0), [6.0, -2.0]], [90.0, (0.0, 0.0), (-8.0, 0.0), [6.0, -2.0]]])
    _win(c)

    for m in (0, 1):
        c = s.case(f"measurement-{m}", f"ANSI31 (stored acadiso lines) + DASHED LINE (stored metric LTYPE) with $MEASUREMENT={m}",
                   tags=["HATCH", "pattern", "MEASUREMENT", "LTYPE"], questions=["Q-0332"], params={"measurement": m})
        _pattern_rect(c, "ANSI31", 1, 0, r=(20, 15, 180, 120))
        c.linetype("DASHED")
        c.msp.add_line((20, 135), (180, 135), dxfattribs={"linetype": "DASHED"})
        c.doc.header["$MEASUREMENT"] = m
        _win(c)

    for m in (0, 1):
        c = s.case(f"no-lines-{m}", f"Predefined ANSI31 (76=1, 41=1) with 78=0 (no stored pattern lines), $MEASUREMENT={m}",
                   tags=["HATCH", "pattern", "MEASUREMENT", "stored-lines"], questions=["Q-0333"], params={"measurement": m})
        h = _pattern_rect(c, "ANSI31", 1, 0)
        h.pattern = _EmptyPattern()
        c.doc.header["$MEASUREMENT"] = m
        _win(c)


# --- user-defined (76=0) and custom (76=2) patterns ----------------------------------------------


def _user_custom(s: SuiteBuilder) -> None:
    for name, spacing, ang, double, drop in [
        ("single-s5-a0", 5, 0, False, False),
        ("single-s5-a30", 5, 30, False, False),
        ("double-s8-a0", 8, 0, True, False),
        ("double-s8-a45", 8, 45, True, False),
        ("double-flag-one-line", 8, 45, True, True),
    ]:
        title = f"User-defined pattern 76=0 spacing {spacing} angle {ang}" + (" double 77=1" if double else "")
        if drop:
            title += " but only the first family stored (78=1)"
        c = s.case(f"user-{name}", title, tags=["HATCH", "pattern", "user-defined"], questions=["Q-0335"],
                   params={"spacing": spacing, "angle": ang, "double": double, "stored_lines": 1 if drop or not double else 2})
        h = _hatch(c.msp)
        h.paths.add_polyline_path(_rect(*RECT), flags=1)
        _pat(h, "_USER", spacing, ang, ptype=0, double=int(double), definition=_user_def(double and not drop))
        _ref_rect(c)
        _win(c)

    customs = {
        "dashdot": [[0.0, (0.0, 0.0), (0.0, 6.0), [8.0, -2.0, 0.0, -2.0]]],
        "brick-shift": [[0.0, (0.0, 0.0), (3.0, 5.0), [6.0, -2.0]]],
        "dot-grid": [[0.0, (0.0, 0.0), (0.0, 5.0), [0.0, -5.0]]],
        "many-dashes": [[0.0, (0.0, 0.0), (0.0, 6.0), [4.0, -1.0, 0.0, -1.0, 2.0, -1.0, 0.0, -1.0, 1.0, -3.0]]],
        "tri-dashed": [[0.0, (0.0, 0.0), (0.0, 8.660254), [6.0, -4.0]],
                       [60.0, (0.0, 0.0), (-7.5, 4.330127), [6.0, -4.0]],
                       [120.0, (0.0, 0.0), (-7.5, -4.330127), [6.0, -4.0]]],
    }
    for name, defn in customs.items():
        c = s.case(f"custom-{name}", f"Custom pattern 76=2 TDXF_{name.upper()} with dashes/dots: {defn}",
                   tags=["HATCH", "pattern", "custom", "dash"], params={"definition": defn},
                   questions=["Q-0341"] if name in ("dashdot", "many-dashes") else [])
        _pattern_rect(c, f"TDXF_{name.upper().replace('-', '_')}", 1, 0, ptype=2, definition=defn)
        _win(c)
    c = s.case("custom-dot-grid-a30-s2", "Custom dot grid 76=2 at scale 2 angle 30", tags=["HATCH", "pattern", "custom", "dot"],
               params={"scale": 2, "angle": 30})
    _pattern_rect(c, "TDXF_DOT_GRID", 2, 30, ptype=2, definition=customs["dot-grid"])
    _win(c)


# --- pattern origin, seed points, ACAD XDATA ---------------------------------------------------


def _origin(s: SuiteBuilder) -> None:
    for name, seeds in [("seed-0", []), ("seed-1", [(100, 75)]), ("seed-2", [(40, 40), (163.3, 111.7)])]:
        c = s.case(f"origin-{name}", f"ANSI31 scale 2, base point (0,0), {len(seeds)} seed point(s) {seeds}",
                   tags=["HATCH", "pattern", "seed", "origin"], questions=["Q-0337"], params={"seeds": seeds})
        h = _pattern_rect(c, "ANSI31", 2)
        if seeds:
            h.set_seed_points(seeds)
        _win(c)
    for dx, dy in [(3.175, 0), (100, 75)]:
        c = s.case(f"origin-base-{_fmt(dx)}-{_fmt(dy)}", f"ANSI31 scale 2 with base point moved to ({dx},{dy}) (pattern origin)",
                   tags=["HATCH", "pattern", "origin"], questions=["Q-0337"], params={"base": (dx, dy)})
        h = _pattern_rect(c, "ANSI31", 2)
        _shift_base(h, dx, dy)
        h.set_seed_points([(100, 75)])
        _win(c)
    c = s.case("origin-brick-shift", "BRICK scale 2 with origin (5,2.5): dash phase and row shift",
               tags=["HATCH", "pattern", "origin"], questions=["Q-0337"], params={"base": (5, 2.5)})
    h = _pattern_rect(c, "BRICK", 2)
    _shift_base(h, 5, 2.5)
    _win(c)
    c = s.case("origin-acad-xdata", "ANSI31 scale 2, base (0,0), XDATA ACAD 1010=(3.175,0,0) (does the 1010 point move the pattern?)",
               tags=["HATCH", "pattern", "origin", "XDATA"], questions=["Q-0339"], params={"xdata_1010": (3.175, 0, 0)})
    h = _pattern_rect(c, "ANSI31", 2)
    h.set_seed_points([(100, 75)])
    h.set_xdata("ACAD", [(1010, (3.175, 0.0, 0.0))])
    _win(c)


# --- islands, hatch styles, textboxes, overlapping loops -------------------------------------------

NEST = [(15, 10, 185, 140), (45, 30, 155, 120), (75, 50, 125, 100), (90, 65, 110, 85)]


def _islands(s: SuiteBuilder) -> None:
    flagsets = {"correct": (1, 16, 0, 0), "zero": (0, 0, 0, 0), "all-external": (1, 1, 1, 1)}
    for fill in ("solid", "ansi31"):
        for fname, flags in flagsets.items():
            for style in (0, 1, 2):
                c = s.case(f"nested-{fill}-{fname}-style{style}",
                           f"{fill.upper()} HATCH, 4 nested edge-path loops, path flags {flags}, hatch style 75={style}",
                           tags=["HATCH", "islands", "hatch-style"], questions=["Q-0346"],
                           params={"fill": fill, "flags": flags, "style": style})
                h = _hatch(c.msp)
                for r, f in zip(NEST, flags):
                    _edge_rect(h, *r, flags=f)
                if fill == "solid":
                    h.set_solid_fill(color=256, style=style)
                else:
                    _pat(h, "ANSI31", 1, 0, style=style)
                _win(c)

    # island style suffix in the pattern name (",_I" / ",_O" / ",_N")
    for suffix, style, fill in [("_I", 0, "SOLID"), ("_O", 0, "ANSI31"), ("_N", 2, "SOLID")]:
        c = s.case(f"name-suffix-{suffix[1].lower()}-style{style}", f"Pattern name '{fill},{suffix}' with 75={style}, nested loops flags 1/16/0/0 (does the suffix matter?)",
                   tags=["HATCH", "islands", "hatch-style", "name-suffix"], questions=["Q-0340"], params={"name": f"{fill},{suffix}", "style": style})
        h = _hatch(c.msp)
        for r, f in zip(NEST, (1, 16, 0, 0)):
            _edge_rect(h, *r, flags=f)
        if fill == "SOLID":
            h.set_solid_fill(color=256, style=style)
        else:
            _pat(h, "ANSI31", 1, 0, style=style)
        h.dxf.pattern_name = f"{fill},{suffix}"
        _win(c)

    # text box loops (flag 8)
    tb = (62, 61, 138, 89)
    for fill, flags, style in [("solid", 8, 0), ("solid", 8, 1), ("solid", 8, 2), ("solid", 24, 1),
                               ("ansi31", 8, 0), ("ansi31", 8, 1), ("solid", None, 0)]:
        tbname = "none" if flags is None else f"flag{flags}"
        c = s.case(f"textbox-{fill}-{tbname}-style{style}",
                   f"{fill.upper()} HATCH around TEXT 'TEXT' (h=24) with " + ("no textbox loop" if flags is None else f"textbox loop 92={flags}") + f", style {style}",
                   tags=["HATCH", "islands", "textbox", "TEXT"], questions=["Q-0347"], params={"fill": fill, "textbox_flags": flags, "style": style},
                   style_table="acad.ctb")
        # TEXT first (so a hatch that fills the box area would cover it), hatch after
        c.msp.add_text("TEXT", height=24, dxfattribs={"color": 7}).set_placement((100, 75), align=TextEntityAlignment.MIDDLE_CENTER)
        h = _hatch(c.msp)
        h.paths.add_polyline_path(_rect(*RECT), flags=1)
        if flags is not None:
            h.paths.add_polyline_path(_rect(*tb), flags=flags)
        if fill == "solid":
            h.set_solid_fill(color=8, style=style)
        else:
            _pat(h, "ANSI31", 1, 0, style=style)
        _ref(c, _rect(*tb))
        _win(c)

    # overlapping (not nested) loops
    A, B = (30, 20, 120, 110), (80, 40, 170, 130)
    for f2 in (1, 0):
        for style in (0, 1, 2):
            c = s.case(f"overlap-flags1{f2}-style{style}", f"SOLID HATCH, two overlapping squares, flags 1/{f2}, style {style} (intersection a hole?)",
                       tags=["HATCH", "islands", "overlap"], questions=["Q-0343"], params={"flags": (1, f2), "style": style})
            h = _hatch(c.msp)
            _edge_rect(h, *A, flags=1)
            _edge_rect(h, *B, flags=f2)
            h.set_solid_fill(color=256, style=style)
            _win(c)
    c = s.case("overlap-ansi31-style0", "ANSI31 HATCH, two overlapping squares flags 1/1, style 0", tags=["HATCH", "islands", "overlap"],
               questions=["Q-0343"])
    h = _hatch(c.msp)
    _edge_rect(h, *A, flags=1)
    _edge_rect(h, *B, flags=1)
    _pat(h, "ANSI31", 1, 0, style=0)
    _win(c)

    # disjoint external loops touching at a corner + one with an island
    for fill in ("solid", "ansi31"):
        c = s.case(f"corner-touch-{fill}", f"{fill.upper()} HATCH: 3 external loops, two squares sharing a corner, third with an island (flag 16)",
                   tags=["HATCH", "islands", "disjoint"], questions=["Q-0344"])
        h = _hatch(c.msp)
        h.paths.add_polyline_path(_rect(15, 20, 65, 70), flags=1)
        h.paths.add_polyline_path(_rect(65, 70, 115, 120), flags=1)
        h.paths.add_polyline_path(_rect(125, 20, 185, 130), flags=1)
        h.paths.add_polyline_path(_rect(140, 45, 170, 105), flags=16)
        if fill == "solid":
            h.set_solid_fill(color=256, style=0)
        else:
            _pat(h, "ANSI31", 1, 0, style=0)
        _win(c)

    c = s.case("one-loop-two-rects", "SOLID HATCH: ONE edge path whose 8 line edges form two separate rectangles",
               tags=["HATCH", "edge-path", "disjoint"], questions=["Q-0345"])
    h = _hatch(c.msp)
    p = h.paths.add_edge_path(flags=1)
    for r in ((20, 30, 90, 120), (110, 30, 180, 120)):
        pts = _rect(*r)
        for i in range(4):
            p.add_line(pts[i], pts[(i + 1) % 4])
    _ref(c, _rect(17, 27, 93, 123))
    _ref(c, _rect(107, 27, 183, 123))
    _win(c)

    # self-intersecting loops
    star = [(100 + 65 * math.cos(math.radians(90 + 144 * i)), 75 + 65 * math.sin(math.radians(90 + 144 * i))) for i in range(5)]
    for name, pts, flags, fill in [
        ("bowtie", [(30, 20), (170, 130), (170, 20), (30, 130)], 1, "solid"),
        ("pentagram", star, 1, "solid"),
        ("pentagram-flag65", star, 65, "solid"),
        ("pentagram-ansi31", star, 1, "ansi31"),
    ]:
        c = s.case(f"selfint-{name}", f"{fill.upper()} HATCH with a self-intersecting polyline loop ({name}), flags {flags}",
                   tags=["HATCH", "self-intersecting"], questions=["Q-0342"] + (["Q-0354"] if flags == 65 else []),
                   params={"flags": flags})
        h = _hatch(c.msp)
        h.paths.add_polyline_path([(round(x, 9), round(y, 9)) for x, y in pts], flags=flags)
        if fill == "solid":
            h.set_solid_fill(color=256, style=0)
        else:
            _pat(h, "ANSI31", 1, 0, style=0)
        _win(c)


# --- boundary edge types, gaps, full circles, CW arcs, ellipse angles, splines ----------------------


def _boundaries(s: SuiteBuilder) -> None:
    # gaps / ordering (Q-0348)
    sq = _rect(30, 20, 170, 130)
    edges = [(sq[i], sq[(i + 1) % 4]) for i in range(4)]

    def shorten(e, g):
        (x0, y0), (x1, y1) = e
        d = Vec2(x1 - x0, y1 - y0).normalize()
        return (x0, y0), (x1 - d.x * g, y1 - d.y * g)

    variants = [(f"gap-{_fmt(g)}", [shorten(e, g) for e in edges]) for g in (1e-6, 1e-3, 1e-1, 1.0)]
    variants += [
        ("shuffled", [edges[0], edges[2], edges[1], edges[3]]),
        ("reversed-one", [edges[0], (edges[1][1], edges[1][0]), edges[2], edges[3]]),
        ("shuffled-reversed", [(edges[2][1], edges[2][0]), edges[0], (edges[3][1], edges[3][0]), edges[1]]),
        ("open-3-edges", edges[:3]),
    ]
    for name, es in variants:
        c = s.case(f"edges-{name}", f"SOLID HATCH edge path, 4 line edges: {name}", tags=["HATCH", "edge-path", "gap"],
                   questions=["Q-0348"], params={"variant": name, "edges": [list(map(list, e)) for e in es]})
        h = _hatch(c.msp)
        p = h.paths.add_edge_path(flags=1)
        for a, b in es:
            p.add_line(a, b)
        _ref(c, _rect(27, 17, 173, 133))
        _win(c)

    # open polyline path (Q-0349)
    for name, pts in [("u-shape", [(40, 130), (40, 20), (160, 20), (160, 130)]),
                      ("last-eq-first", [(40, 20), (160, 20), (160, 130), (40, 130), (40, 20)])]:
        c = s.case(f"poly-open-{name}", f"SOLID HATCH polyline path with 73=0 (not closed): {name}", tags=["HATCH", "polyline-path", "open"],
                   questions=["Q-0349"], params={"vertices": pts})
        h = _hatch(c.msp)
        h.paths.add_polyline_path(pts, is_closed=False, flags=1)
        _ref(c, _rect(37, 17, 163, 133))
        _win(c)

    # full circles / ellipses as a single edge (Q-0350)
    for a0, a1 in [(0, 360), (-180, 180), (90, 450), (0, 0)]:
        c = s.case(f"fullcircle-arc-{_fmt(a0)}-{_fmt(a1)}", f"SOLID HATCH, one arc edge r=55 with 50={a0} 51={a1}",
                   tags=["HATCH", "edge-path", "arc", "full-circle"], questions=["Q-0350"], params={"start": a0, "end": a1})
        h = _hatch(c.msp)
        h.paths.add_edge_path(flags=1).add_arc((100, 75), 55, a0, a1, ccw=True)
        c.msp.add_circle((100, 75), 58, dxfattribs={"layer": c.layer("REF", color=8, lineweight=0)})
        _win(c)
    for a0, a1 in [(0, 360), (-180, 180), (90, 450), (0, 0)]:
        c = s.case(f"fullcircle-ellipse-{_fmt(a0)}-{_fmt(a1)}", f"SOLID HATCH, one ellipse edge (major 80, ratio 0.6) with 50={a0} 51={a1}",
                   tags=["HATCH", "edge-path", "ellipse", "full-circle"], questions=["Q-0350"], params={"start": a0, "end": a1})
        h = _hatch(c.msp)
        h.paths.add_edge_path(flags=1).add_ellipse((100, 75), (80, 0), 0.6, a0, a1, ccw=True)
        _win(c)
    c = s.case("fullcircle-two-halves", "SOLID HATCH, circle from two arc edges 0..180 and 180..360", tags=["HATCH", "edge-path", "arc"])
    p = _hatch(c.msp).paths.add_edge_path(flags=1)
    p.add_arc((100, 75), 55, 0, 180)
    p.add_arc((100, 75), 55, 180, 360)
    _win(c)

    # CW vs CCW arc edge (Q-0351)
    for name, ccw in [("cw", False), ("ccw", True)]:
        c = s.case(f"arc-edge-{name}", f"SOLID HATCH D-shape: rectangle + semicircle bump, loop traversed {'clockwise, arc 73=0 (50=270 51=450)' if not ccw else 'counter-clockwise, arc 73=1'}",
                   tags=["HATCH", "edge-path", "arc", "ccw"], questions=["Q-0351"], params={"ccw": ccw})
        p = _hatch(c.msp).paths.add_edge_path(flags=1)
        if not ccw:
            p.add_line((40, 30), (40, 120))
            p.add_line((40, 120), (120, 120))
            p.add_arc((120, 75), 45, -90, 90, ccw=False)  # CW 90 -> -90 via 0
            p.add_line((120, 30), (40, 30))
        else:
            p.add_line((40, 30), (120, 30))
            p.add_arc((120, 75), 45, -90, 90, ccw=True)
            p.add_line((120, 120), (40, 120))
            p.add_line((40, 120), (40, 30))
        _ref(c, [(37, 27), (120, 27)], closed=False)
        _ref(c, [(37, 123), (120, 123)], closed=False)
        c.msp.add_arc((120, 75), 48, -90, 90, dxfattribs={"layer": "REF"})
        _win(c)
    c = s.case("ellipse-edge-cw", "SOLID HATCH: half ellipse (major 70, ratio 0.5) as CW ellipse edge 73=0 closed by a line",
               tags=["HATCH", "edge-path", "ellipse", "ccw"], questions=["Q-0351"])
    p = _hatch(c.msp).paths.add_edge_path(flags=1)
    p.add_line((170, 60), (30, 60))
    p.add_ellipse((100, 60), (70, 0), 0.5, 0, 180, ccw=False)  # CW from 180 back to 0
    c.msp.add_ellipse((100, 60), (72, 0), 37 / 72, 0, math.pi, dxfattribs={"layer": c.layer("REF", color=8, lineweight=0)})
    _win(c)

    # ellipse edge: angle or parameter? (Q-0352)
    ratio, a0, a1 = 0.3, 30.0, 120.0
    cx, cy, major = 100.0, 45.0, 95.0

    def ang_pt(a):  # point at geometric angle a
        t = math.atan2(math.sin(math.radians(a)) / ratio, math.cos(math.radians(a)))
        return (cx + major * math.cos(t), cy + major * ratio * math.sin(t)), t

    def par_pt(a):  # point at parameter a
        t = math.radians(a)
        return (cx + major * math.cos(t), cy + major * ratio * math.sin(t)), t

    for interp, fn in [("param", par_pt), ("angle", ang_pt)]:
        c = s.case(f"ellipse-edge-{interp}-closed", f"Pie: ellipse edge ratio 0.3 50/51=30/120 ccw, closed with lines to the {interp} end points; red ELLIPSE = param, blue = angle",
                   tags=["HATCH", "edge-path", "ellipse"], questions=["Q-0352"], style_table="acad.ctb",
                   params={"ratio": ratio, "start": a0, "end": a1, "lines_to": interp})
        (ps, _), (pe, _) = fn(a0), fn(a1)
        h = _hatch(c.msp, color=9)
        p = h.paths.add_edge_path(flags=1)
        p.add_line((cx, cy), ps)
        p.add_ellipse((cx, cy), (major, 0), ratio, a0, a1, ccw=True)
        p.add_line(pe, (cx, cy))
        c.layer("REF", color=8, lineweight=0)
        (_, t0p), (_, t1p) = par_pt(a0), par_pt(a1)
        (_, t0a), (_, t1a) = ang_pt(a0), ang_pt(a1)
        c.msp.add_ellipse((cx, cy), (major, 0), ratio, t0p, t1p, dxfattribs={"layer": "REF", "color": 1})
        c.msp.add_ellipse((cx, cy), (major, 0), ratio, t0a, t1a, dxfattribs={"layer": "REF", "color": 5})
        c.msp.add_ellipse((cx, cy), (major, 0), ratio, 0, math.tau, dxfattribs={"layer": "REF", "color": 8})
        _win(c)
    c = s.case("ellipse-edge-rotated-partial", "SOLID HATCH: rotated ellipse edge (major (60,35), ratio 0.5) 200..340 ccw closed by a chord line",
               tags=["HATCH", "edge-path", "ellipse"], questions=["Q-0352"])
    h = _hatch(c.msp)
    p = h.paths.add_edge_path(flags=1)
    e = p.add_ellipse((100, 85), (70, 40), 0.6, 200, 340, ccw=True)
    p.add_line(e.end_point, e.start_point)
    _win(c)

    # edge-type coverage
    c = s.case("edges-lines-square", "SOLID HATCH square as 4 line edges (edge path, flag 1)", tags=["HATCH", "edge-path", "line"])
    _edge_rect(_hatch(c.msp), *RECT, flags=1)
    _win(c)
    c = s.case("edges-stadium-ccw", "ANSI31 HATCH stadium: 2 line edges + 2 CCW arc edges", tags=["HATCH", "edge-path", "arc"])
    h = _hatch(c.msp)
    p = h.paths.add_edge_path(flags=1)
    p.add_line((60, 30), (140, 30))
    p.add_arc((140, 75), 45, -90, 90)
    p.add_line((140, 120), (60, 120))
    p.add_arc((60, 75), 45, 90, 270)
    _pat(h, "ANSI31", 1, 0)
    _win(c)
    c = s.case("edges-ellipse-full-rotated", "SOLID HATCH: one full ellipse edge, major axis (70,40), ratio 0.45",
               tags=["HATCH", "edge-path", "ellipse"])
    _hatch(c.msp).paths.add_edge_path(flags=1).add_ellipse((100, 75), (70, 40), 0.45, 0, 360)
    _win(c)

    ctrl = [(30, 40), (50, 140), (100, 20), (150, 140), (170, 40)]
    c = s.case("edges-spline-clamped", "SOLID HATCH: clamped cubic spline edge (no fit data) closed by a line edge",
               tags=["HATCH", "edge-path", "spline"])
    p = _hatch(c.msp).paths.add_edge_path(flags=1)
    p.add_spline(control_points=ctrl, degree=3)
    p.add_line(ctrl[-1], ctrl[0])
    _ref(c, ctrl, closed=False)
    _win(c)
    c = s.case("edges-spline-fit", "SOLID HATCH: spline edge with fit points + tangents and matching control points",
               tags=["HATCH", "edge-path", "spline", "fit-points"])
    fit = [(30, 40), (60, 120), (100, 70), (140, 120), (170, 40)]
    p = _hatch(c.msp).paths.add_edge_path(flags=1)
    p.add_spline_control_frame(fit, degree=3)
    p.add_line(fit[-1], fit[0])
    c.layer("REF", color=8, lineweight=0)
    for q in fit:
        c.msp.add_circle(q, 1.5, dxfattribs={"layer": "REF"})
    _win(c)
    c = s.case("edges-spline-fit-mismatch", "SOLID HATCH: spline edge whose fit points (circles) do not match its control points (which is used?)",
               tags=["HATCH", "edge-path", "spline", "fit-points"])
    p = _hatch(c.msp).paths.add_edge_path(flags=1)
    sp = p.add_spline(control_points=ctrl, degree=3, fit_points=[(30, 40), (70, 60), (100, 110), (130, 60), (170, 40)])
    sp.start_tangent = Vec2(1, 1)
    sp.end_tangent = Vec2(1, -1)
    p.add_line(ctrl[-1], ctrl[0])
    c.layer("REF", color=8, lineweight=0)
    for q in sp.fit_points:
        c.msp.add_circle(q, 1.5, dxfattribs={"layer": "REF"})
    _win(c)
    c = s.case("edges-spline-rational-circle", "SOLID HATCH: one rational quadratic spline edge = full circle r=55 (9 weighted control points)",
               tags=["HATCH", "edge-path", "spline", "rational"])
    w = math.sqrt(0.5)
    cp = [(100 + 55 * x, 75 + 55 * y) for x, y in [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1), (1, 0)]]
    _hatch(c.msp).paths.add_edge_path(flags=1).add_spline(
        control_points=cp, knot_values=[0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1], weights=[1, w, 1, w, 1, w, 1, w, 1], degree=2)
    c.msp.add_circle((100, 75), 58, dxfattribs={"layer": c.layer("REF", color=8, lineweight=0)})
    _win(c)
    ring = [(round(100 + 65 * math.cos(a), 9), round(75 + 55 * math.sin(a), 9)) for a in [i * math.tau / 7 for i in range(7)]]
    for periodic in (1, 0):
        c = s.case(f"edges-spline-periodic-{periodic}", f"SOLID HATCH: single closed cubic spline edge, 7 control points wrapped + uniform knots, 74={periodic}",
                   tags=["HATCH", "edge-path", "spline", "periodic"], questions=["Q-0353"], params={"periodic": periodic})
        cpw = ring + ring[:3]
        knots = [float(k) for k in range(len(cpw) + 4)]
        _hatch(c.msp).paths.add_edge_path(flags=1).add_spline(control_points=cpw, knot_values=knots, degree=3, periodic=periodic)
        _ref(c, ring)
        _win(c)
    c = s.case("edges-spline-periodic-clamped", "SOLID HATCH: closed clamped cubic spline edge (first = last control point) flagged 74=1",
               tags=["HATCH", "edge-path", "spline", "periodic"], questions=["Q-0353"])
    _hatch(c.msp).paths.add_edge_path(flags=1).add_spline(control_points=ring + ring[:1], degree=3, periodic=1)
    _ref(c, ring)
    _win(c)
    c = s.case("edges-mixed", "ANSI37 HATCH: one loop of line, arc, ellipse and spline edges", tags=["HATCH", "edge-path", "line", "arc", "ellipse", "spline"])
    h = _hatch(c.msp)
    p = h.paths.add_edge_path(flags=1)
    p.add_line((30, 40), (120, 40))
    p.add_arc((140, 40), 20, 180, 360)  # CCW (120,40) -> (160,40) through the bottom (140,20)
    p.add_ellipse((160, 85), (0, 45), 0.4, 180, 360)  # (160,40) -> (160,130), bulging right to x=178
    p.add_spline(control_points=[(160, 130), (120, 150), (80, 90), (30, 130)], degree=3)
    p.add_line((30, 130), (30, 40))
    _pat(h, "ANSI37", 1, 0)
    _win(c)


# --- appearance: colour, linetype, lineweight, dots, background colour, associativity ----------------


def _appearance(s: SuiteBuilder) -> None:
    c = s.case("pattern-color-1", "ANSI31 scale 2 pattern lines with colour 1 (red)", tags=["HATCH", "pattern", "color"], style_table="acad.ctb")
    h = _pattern_rect(c, "ANSI31", 2)
    h.dxf.color = 1
    _win(c)

    for name, lt, lw in [("continuous-lw0", "CONTINUOUS", 0), ("continuous-lw50", "CONTINUOUS", 50),
                         ("continuous-lw100", "CONTINUOUS", 100), ("dashed-lw100", "DASHED", 100), ("dashed-lw0", "DASHED", 0)]:
        c = s.case(f"pattern-lt-{name}", f"ANSI31 scale 2 HATCH with entity linetype {lt} and lineweight {lw / 100:.2f} mm (linetype ignored?)",
                   tags=["HATCH", "pattern", "linetype", "lineweight"], questions=["Q-0355"], params={"linetype": lt, "lineweight": lw})
        h = _pattern_rect(c, "ANSI31", 2)
        if lt != "CONTINUOUS":
            h.dxf.linetype = c.linetype(lt)
        h.dxf.lineweight = lw
        _win(c)

    for lw in (0, 35, 50, 211):
        c = s.case(f"dots-lw{lw}", f"DOTS pattern scale 4 and a DOT-linetype LINE at lineweight {lw / 100:.2f} mm (dot size)",
                   tags=["HATCH", "pattern", "dot", "lineweight", "LTYPE"], questions=["Q-0302"], params={"lineweight": lw})
        h = _pattern_rect(c, "DOTS", 4, r=(20, 15, 180, 120))
        h.dxf.lineweight = lw
        c.linetype("DOT")
        c.msp.add_line((20, 135), (180, 135), dxfattribs={"linetype": "DOT", "lineweight": lw})
        _win(c)

    # HATCHBACKGROUNDCOLOR (Q-0357, Q-0358)
    for name, raw, pattern, title in [
        ("rgb-red", _raw_color(0xC2, 0xFF0000), "ANSI31", "RGB red (0xC2FF0000)"),
        ("aci-3", _raw_color(0xC3, 3), "ANSI31", "ACI 3 encoded 0xC3000003"),
        ("bylayer", _raw_color(0xC0, 0), "ANSI31", "BYLAYER 0xC0000000 on a layer with colour 4"),
        ("on-solid", _raw_color(0xC2, 0xFF0000), "SOLID", "RGB red on a SOLID hatch (ignored?)"),
    ]:
        c = s.case(f"bgcolor-{name}", f"HATCHBACKGROUNDCOLOR {title}: blue LINEs before and after the hatch",
                   tags=["HATCH", "pattern", "background-color", "XDATA", "draw-order"],
                   questions=["Q-0357"] + (["Q-0358"] if name in ("aci-3", "bylayer") else []), style_table="acad.ctb",
                   params={"raw_1071": raw})
        c.layer("CYAN", color=4, lineweight=0)
        c.msp.add_line((10, 50), (190, 50), dxfattribs={"color": 5, "lineweight": 100})
        h = _hatch(c.msp, color=7, layer="CYAN")
        h.paths.add_polyline_path(_rect(*RECT), flags=1)
        if pattern == "SOLID":
            h.set_solid_fill(color=7, style=0)
        else:
            _pat(h, pattern, 2)
        _appid(c, "HATCHBACKGROUNDCOLOR")
        h.set_xdata("HATCHBACKGROUNDCOLOR", [(1071, raw)])
        c.msp.add_line((10, 100), (190, 100), dxfattribs={"color": 5, "lineweight": 100})
        _win(c)

    # associativity
    pts = [(30, 20), (170, 20), (170, 90), (110, 130), (30, 130)]
    for assoc in (True, False):
        c = s.case(f"assoc-lwpolyline-{int(assoc)}", f"LWPOLYLINE boundary + ANSI31 HATCH, associative={assoc} (71, 97/330)",
                   tags=["HATCH", "associative", "LWPOLYLINE"], params={"associative": assoc})
        lw = c.msp.add_lwpolyline(pts, close=True)
        h = _hatch(c.msp)
        path = h.paths.add_polyline_path(pts, flags=1)
        _pat(h, "ANSI31", 1, 0)
        if assoc:
            h.associate(path, [lw])
        _win(c)
    c = s.case("assoc-circle", "CIRCLE boundary + associative ANSI31 HATCH (full arc edge, 330 -> CIRCLE)", tags=["HATCH", "associative", "CIRCLE"])
    circ = c.msp.add_circle((100, 75), 55)
    h = _hatch(c.msp)
    path = h.paths.add_edge_path(flags=1)
    path.add_arc((100, 75), 55, 0, 360)
    _pat(h, "ANSI31", 1, 0)
    h.associate(path, [circ])
    _win(c)


# --- INSERT transforms and OCS ------------------------------------------------------------------------


def _inserts_ocs(s: SuiteBuilder) -> None:
    lshape = [(0, 0), (60, 0), (60, 15), (20, 15), (20, 40), (0, 40)]
    for pname, sc in (("ANSI31", 1.0), ("BRICK", 0.5)):
        for name, scale, rot in [("s1", (1, 1), 0), ("s2", (2, 2), 0), ("s2-r30", (2, 2), 30), ("mirror-x", (-2, 2), 0),
                                 ("nonuniform-2-1", (2.5, 1.25), 0), ("s2-r180", (2, 2), 180)]:
            if pname == "BRICK" and name in ("s1", "s2-r180"):
                continue
            c = s.case(f"insert-{pname.lower()}-{name}", f"{pname} HATCH (L-shape) in a block, INSERT scale {scale} rotation {rot}",
                       tags=["HATCH", "pattern", "INSERT", "transform"], questions=["Q-0359"], params={"pattern": pname, "scale": scale, "rotation": rot})
            bname = "HB"
            blk = c.doc.blocks.new(bname)
            h = _hatch(blk)
            h.paths.add_polyline_path(lshape, flags=1)
            _pat(h, pname, sc, 0)
            blk.add_lwpolyline(lshape, close=True)
            _insert_at(c, bname, (30, 20), scale=scale, rot=rot)
            c.msp.add_point((100, 75))
            _win(c)

    # extrusion (0,0,-1): OCS x = -WCS x; elevation
    lw = [(30, 20), (170, 20), (170, 60), (80, 60), (80, 130), (30, 130)]
    ocs_pts = [(-x, y) for x, y in lw]
    for fill in ("solid", "ansi31"):
        c = s.case(f"extrusion-negz-{fill}", f"{fill.upper()} HATCH L-shape with extrusion (0,0,-1) (OCS x negated); REF outline at the expected WCS place",
                   tags=["HATCH", "OCS", "extrusion"], params={"extrusion": (0, 0, -1)})
        h = _hatch(c.msp, extrusion=(0, 0, -1))
        h.paths.add_polyline_path(ocs_pts, flags=1)
        if fill == "solid":
            h.set_solid_fill(color=256, style=0)
        else:
            _pat(h, "ANSI31", 2, 0)
        _ref(c, [(27, 17), (173, 17), (173, 63), (83, 63), (83, 133), (27, 133)])
        _win(c)
    c = s.case("extrusion-negz-arc-edge", "SOLID HATCH with extrusion (0,0,-1): CCW-in-OCS arc edge bump + lines (appears mirrored)",
               tags=["HATCH", "OCS", "extrusion", "arc"])
    h = _hatch(c.msp, extrusion=(0, 0, -1))
    p = h.paths.add_edge_path(flags=1)
    # WCS D-shape with bump on the LEFT (x = 80 centre); in OCS the bump is to the right of x=-80
    p.add_line((-160, 30), (-80, 30))
    p.add_arc((-80, 75), 45, -90, 90)
    p.add_line((-80, 120), (-160, 120))
    p.add_line((-160, 120), (-160, 30))
    c.msp.add_arc((80, 75), 48, 90, 270, dxfattribs={"layer": c.layer("REF", color=8, lineweight=0)})
    _win(c)
    c = s.case("elevation-25", "ANSI31 HATCH with elevation 25 (10 = 0,0,25), extrusion +Z (no plan effect)",
               tags=["HATCH", "OCS", "elevation"], params={"elevation": 25})
    h = _pattern_rect(c, "ANSI31", 1, 0)
    h.dxf.elevation = (0, 0, 25)
    _win(c)


# --- density limit (HPMAXLINES) -------------------------------------------------------------------


def _density(s: SuiteBuilder) -> None:
    # fixed line spacing (ANSI31 scale 0.03: 0.095 units = 3.8 px at 40 px/unit), growing square:
    # total line count ~ side*sqrt(2)/0.09525 crosses the assumed HPMAXLINES 1e6 between 6e4 and 8e4
    sc = 0.03
    spacing = 3.175 * sc
    for side in (1000, 30000, 60000, 80000, 120000, 300000):
        n = side * math.sqrt(2) / spacing
        c = s.case(f"dense-count-{side}", f"ANSI31 scale {sc} on a {side}x{side} square (~{n:,.0f} pattern lines), window 50x37.5 at the centre",
                   tags=["HATCH", "pattern", "density", "HPMAXLINES"], questions=["Q-0361"], params={"side": side, "scale": sc, "lines": round(n)})
        h = _hatch(c.msp)
        h.paths.add_polyline_path(_rect(-side / 2, -side / 2, side / 2, side / 2), flags=1)
        _pat(h, "ANSI31", sc, 0)
        c.window_center((0, 0), 40)
    # sub-pixel spacing on a small square (screen-solid either way; checks for solid fallback artefacts)
    for sc in (0.1, 0.01, 0.001):
        c = s.case(f"dense-scale-{_fmt(sc)}", f"ANSI31 scale {sc} on a 100x100 square at 10 px/unit",
                   tags=["HATCH", "pattern", "density"], questions=["Q-0361"], params={"scale": sc})
        _pattern_rect(c, "ANSI31", sc, r=(50, 25, 150, 125))
        _win(c)


# --- gradients ------------------------------------------------------------------------------------


def _grad_case(s: SuiteBuilder, cname: str, title: str, q: list[str], r=(20, 35, 180, 115), **g):
    c = s.case(cname, title, tags=["HATCH", "gradient", g.get("name", "LINEAR")], questions=q, style_table="acad.ctb", params=g)
    h = _hatch(c.msp)
    h.paths.add_polyline_path(_rect(*r) if isinstance(r, tuple) else r, flags=1)
    h.set_gradient(**g)
    _win(c)
    return c, h


def _gradients(s: SuiteBuilder) -> None:
    for name in GRADIENTS:
        for shift in (0.0, 1.0):
            for ang in (0, 45):
                _grad_case(s, f"gradient-{name.lower()}-shift{int(shift)}-a{ang}", f"Gradient {name} black->white, 461 shift {shift}, rotation {ang} deg, 160x80 rectangle",
                           ["Q-0362"], color1=BLACK, color2=WHITE, rotation=ang, centered=shift, name=name)
    for name, shift, ang in [("LINEAR", 0.5, 0), ("LINEAR", 0.0, 30), ("SPHERICAL", 0.5, 0), ("CYLINDER", 0.0, 30)]:
        _grad_case(s, f"gradient-{name.lower()}-shift{_fmt(shift)}-a{ang}", f"Gradient {name} black->white, shift {shift}, rotation {ang}",
                   ["Q-0362"], color1=BLACK, color2=WHITE, rotation=ang, centered=shift, name=name)
    for cname, c1, c2 in [("red-green", (255, 0, 0), (0, 255, 0)), ("blue-yellow", (0, 0, 255), (255, 255, 0))]:
        _grad_case(s, f"gradient-colorspace-{cname}", f"LINEAR gradient {c1}->{c2}: midpoint colour reveals the interpolation space",
                   ["Q-0364", "Q-0362"], color1=c1, color2=c2, name="LINEAR")
    for ang in (0, 30, 90):
        _grad_case(s, f"gradient-extents-a{ang}", f"LINEAR black->white on a 180x45 rectangle, rotation {ang}: normalisation to OCS or rotated extents",
                   ["Q-0365", "Q-0366"], r=(10, 52.5, 190, 97.5), color1=BLACK, color2=WHITE, rotation=ang, name="LINEAR")
    _grad_case(s, "gradient-extents-rotated-boundary", "LINEAR black->white rotation 30 on a rectangle rotated by 30 deg",
               ["Q-0365"], r=[(round(100 + x * math.cos(math.radians(30)) - y * math.sin(math.radians(30)), 9),
                               round(75 + x * math.sin(math.radians(30)) + y * math.cos(math.radians(30)), 9))
                              for x, y in _rect(-80, -22.5, 80, 22.5)],
               color1=BLACK, color2=WHITE, rotation=30, name="LINEAR")
    # one-colour gradient: 452=1 with tint; second colour stored = color1 mixed with white by tint
    blue = (0, 64, 192)
    for tint in (0.0, 0.25, 0.5, 0.75, 1.0):
        c2 = tuple(round(v + (255 - v) * tint) for v in blue)
        _grad_case(s, f"gradient-onecolor-tint{_fmt(tint)}", f"One-colour LINEAR gradient 452=1 color1 {blue} tint 462={tint}, stored 421#2 = mix with white {c2}",
                   ["Q-0363"], color1=blue, color2=c2, one_color=1, tint=tint, name="LINEAR")
    _grad_case(s, "gradient-onecolor-conflict", "One-colour gradient 452=1 tint 0.5 but stored second colour pure red (stored vs recomputed)",
               ["Q-0363"], color1=blue, color2=(255, 0, 0), one_color=1, tint=0.5, name="LINEAR")
    # gradient with islands, and with lineweight
    c = s.case("gradient-islands", "SPHERICAL gradient over nested loops (flags 1/16/0/0, style 0)", tags=["HATCH", "gradient", "islands"],
               questions=["Q-0346", "Q-0362"], style_table="acad.ctb")
    h = _hatch(c.msp)
    for r, f in zip(NEST, (1, 16, 0, 0)):
        _edge_rect(h, *r, flags=f)
    h.set_gradient(color1=(0, 0, 128), color2=(255, 255, 0), name="SPHERICAL")
    h.dxf.hatch_style = 0
    _win(c)
    c, h = _grad_case(s, "gradient-lineweight-211", "LINEAR gradient with entity lineweight 2.11 mm between two hairline LINEs on its boundary",
                      ["Q-0356"], r=(40, 30, 160, 120), color1=(255, 0, 0), color2=(0, 0, 255), name="LINEAR")
    h.dxf.lineweight = 211
    c.msp.add_line((40, 10), (40, 140))
    c.msp.add_line((160, 10), (160, 140))


# --- MPOLYGON -------------------------------------------------------------------------------------


def _mpolygon(s: SuiteBuilder) -> None:
    outer = _rect(20, 15, 180, 135)
    holes = [_rect(40, 40, 90, 110), [(120, 40), (160, 40), (140, 110)]]

    def mpoly(c, color=5, fill=1):
        mp = c.msp.add_mpolygon(color=color, fill_color=fill)
        mp.paths.add_polyline_path(outer, flags=0)
        for hpts in holes:
            mp.paths.add_polyline_path(hpts, flags=0)
        return mp

    c = s.case("mpolygon-solid-holes", "MPOLYGON outer + 2 holes, boundary colour 5, fill 63=1 (boundary drawn? holes?)",
               tags=["MPOLYGON", "solid"], questions=["Q-0367"], style_table="acad.ctb")
    mpoly(c)
    _win(c)
    c = s.case("mpolygon-pattern", "MPOLYGON outer + 2 holes with ANSI31 scale 2 pattern, colour 1",
               tags=["MPOLYGON", "pattern"], questions=["Q-0367"], style_table="acad.ctb")
    mp = mpoly(c, color=1, fill=None)
    mp.set_pattern_fill("ANSI31", color=1, scale=2, definition=ISO_PATTERN["ANSI31"])
    _win(c)
    c = s.case("mpolygon-truecolor", "MPOLYGON outer + 2 holes, true-colour fill (orange) stored as a 2-colour gradient",
               tags=["MPOLYGON", "solid", "color"], questions=["Q-0367"], style_table="acad.ctb")
    mp = mpoly(c)
    mp.set_solid_fill(color=1, rgb=(255, 128, 0))
    _win(c)
    for off in ((0, 0), (5, 5)):
        c = s.case(f"mpolygon-offset-{off[0]}-{off[1]}", f"MPOLYGON square fill 63=3 with offset vector 11={off}; REF square at the stored path",
                   tags=["MPOLYGON", "offset"], questions=["Q-0368"], style_table="acad.ctb", params={"offset": off})
        mp = c.msp.add_mpolygon(color=5, fill_color=3)
        mp.paths.add_polyline_path(_rect(50, 35, 150, 115), flags=0)
        mp.dxf.offset_vector = off
        _ref(c, _rect(47, 32, 153, 118))
        _win(c)


# --- seeded random --------------------------------------------------------------------------------


def _random(s: SuiteBuilder) -> None:
    names = ["ANSI31", "ANSI37", "AR-BRSTD", "BRICK", "HONEY", "NET", "CROSS", "ESCHER", "AR-SAND", "SOLID"]
    for seed in range(1, 9):
        c = s.case(f"random-{seed:04d}", f"Random star polygon + optional island, random pattern/scale/angle, seed {seed}",
                   tags=["HATCH", "pattern", "islands"], seed=seed)
        rng = c.rng
        n = rng.randint(5, 11)
        radii = [rng.uniform(35, 70) for _ in range(n)]
        pts = [(round(100 + r * 1.2 * math.cos(math.tau * i / n), 6), round(75 + r * math.sin(math.tau * i / n), 6))
               for i, r in enumerate(radii)]
        h = _hatch(c.msp)
        h.paths.add_polyline_path(pts, flags=1)
        island = rng.random() < 0.6
        if island:
            ir = min(radii) * 0.45
            k = rng.randint(3, 8)
            ipts = [(round(100 + ir * math.cos(math.tau * i / k), 6), round(75 + ir * math.sin(math.tau * i / k), 6)) for i in range(k)]
            h.paths.add_polyline_path(ipts, flags=16)
        name = rng.choice(names)
        scale = rng.choice([0.5, 1, 1.5, 2])
        ang = rng.choice([0, 15, 30, 45, 60, 90, 135])
        if name == "SOLID":
            h.set_solid_fill(color=256, style=0)
        else:
            _pat(h, name, scale, ang, style=0)
        c.params = {"pattern": name, "scale": scale, "angle": ang, "vertices": n, "island": island}
        _win(c)
