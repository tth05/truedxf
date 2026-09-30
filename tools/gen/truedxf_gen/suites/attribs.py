"""ATTRIB / ATTDEF: alignment, constant / invisible / preset flags with $ATTMODE, loose ATTDEFs,
INSERT transforms, draw order over block content, property resolution (BYBLOCK/BYLAYER, layer
OFF/frozen), MINSERT, R2018 multi-line attributes (note 04 §2, 07 §3-4, 11c §6).

ATTRIB geometry is stored in final (WCS) position as AutoCAD does; placements use the same
AutoCAD-consistent 10/11 computation as the text suite (``_text_util``).
"""

from __future__ import annotations

import math
from typing import Any, Optional, Sequence

from ezdxf.entities import MText

from ..core import SuiteBuilder, suite
from ..resources import TTF_FONTS
from ._text_util import ALIGN, ALIGN_NAMES, cross, placement, r, ref_layer

W0, W1 = (0, 0), (200, 150)
C = (100.0, 75.0)


def _slug(align: str) -> str:
    return align.lower().replace("_", "-")


def _new(s: SuiteBuilder, name: str, title: str, tags, questions=(), **kw):
    c = s.case(name, title, tags=list(tags), questions=list(questions), **kw)
    ref_layer(c)
    return c


def _block(c, name: str, frame: Optional[Sequence[Sequence[float]]] = None):
    blk = c.doc.blocks.new(name)
    if frame:
        blk.add_lwpolyline(frame, close=True)
    return blk


def _has_attdefs(blk) -> None:
    """BLOCK flag 2 'has attribute definitions' (as AutoCAD writes it; model space: no-op)."""
    if not getattr(blk, "is_any_layout", True) and getattr(blk, "block", None) is not None:
        blk.block.dxf.flags = blk.block.dxf.flags | 2


def attdef(blk, tag: str, text: str, p, flags: int = 0, dxfattribs: Optional[dict[str, Any]] = None, **kw: Any):
    d = placement(text, p, **kw)
    ins = d.pop("insert")
    if flags:
        d["flags"] = flags
    if dxfattribs:
        d.update(dxfattribs)
    a = blk.add_attdef(tag, ins, text, dxfattribs=d)
    _has_attdefs(blk)
    return a


def attrib(insert, tag: str, text: str, p, flags: int = 0, dxfattribs: Optional[dict[str, Any]] = None, **kw: Any):
    d = placement(text, p, **kw)
    ins = d.pop("insert")
    if flags:
        d["flags"] = flags
    if dxfattribs:
        d.update(dxfattribs)
    return insert.add_attrib(tag, text, ins, dxfattribs=d)


def _xform(p0: Sequence[float], a: Sequence[float], rot: float = 0.0, sx: float = 1.0, sy: float = 1.0):
    """Block point a -> WCS for an INSERT at p0 (base point 0,0)."""
    ang = math.radians(rot)
    x, y = a[0] * sx, a[1] * sy
    return (r(p0[0] + x * math.cos(ang) - y * math.sin(ang)), r(p0[1] + x * math.sin(ang) + y * math.cos(ang)))


def _mtext(text: str, insert, h: float, attach: int = 1, width: float = 0.0) -> MText:
    m = MText.new(dxfattribs={"insert": insert, "char_height": h, "attachment_point": attach, "style": "Standard", "width": width})
    m.text = text
    return m


@suite("attribs", "ATTRIB / ATTDEF: alignment, flags, ATTMODE, transforms, draw order, properties, MINSERT, multi-line", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    _alignment(s)
    _visibility(s)
    _flags(s)
    _transforms(s)
    _draw_order(s)
    _properties(s)
    _minsert(s)
    _multiline(s)
    _misc(s)
    _random(s)


# ---------------------------------------------------------------------------------------------


def _alignment(s: SuiteBuilder) -> None:
    frame = [(-50, -20), (50, -20), (50, 20), (-50, 20)]
    for al in ALIGN_NAMES:
        h72, v73 = ALIGN[al]
        c = _new(
            s, f"align-{_slug(al)}",
            f"INSERT at (100,75) with ATTRIB 'Fg1 Ag' h=15 {al} (72={h72} 74={v73}); ATTDEF alike in the block; cross at 11",
            ["ATTRIB", "ATTDEF", "INSERT", "alignment"], ["Q-0498"] if h72 == 0 and v73 else [],
            params={"align": al},
        )
        blk = _block(c, "B", frame)
        kw: dict[str, Any] = {"align": al, "h": 15}
        if al in ("FIT", "ALIGNED"):
            attdef(blk, "VAL", "Fg1 Ag", (-40, 0), p2=(40, 0), **kw)
        else:
            attdef(blk, "VAL", "Fg1 Ag", (0, 0), **kw)
        ins = c.msp.add_blockref("B", C)
        if al in ("FIT", "ALIGNED"):
            attrib(ins, "VAL", "Fg1 Ag", (60, 75), p2=(140, 75), **kw)
            cross(c.msp, (60, 75))
            cross(c.msp, (140, 75))
        else:
            attrib(ins, "VAL", "Fg1 Ag", C, **kw)
            cross(c.msp, C)
        c.window(W0, W1)
    # ATTRIB 72=0 with 74 = 0..3 and a differing 73 (field length)
    for v74 in range(4):
        fl = (v74 + 2) % 4
        c = _new(
            s, f"valign74-{v74}",
            f"ATTRIB 'Fg1 Ag' h=15 with 72=0, 74={v74} and field length 73={fl}; 11 at (100,75) (cross), 10 consistent with 74",
            ["ATTRIB", "INSERT", "alignment"], ["Q-0498"], params={"valign": v74, "field_length": fl},
        )
        blk = _block(c, "B", frame)
        al = [k for k, v in ALIGN.items() if v == (0, v74)][0]
        attdef(blk, "VAL", "Fg1 Ag", (0, 0), align=al, h=15)
        ins = c.msp.add_blockref("B", C)
        a = attrib(ins, "VAL", "Fg1 Ag", C, align=al, h=15, dxfattribs={"field_length": fl})
        if v74 == 0:
            a.dxf.align_point = (C[0], C[1], 0)  # 11 present although 72=74=0
        cross(c.msp, C)
        c.window(W0, W1)


# ---------------------------------------------------------------------------------------------
# visibility: $ATTMODE, invisible, constant, non-constant ATTDEFs, loose ATTDEFs

ROWS = [
    # tag, value/default, flags, has ATTRIB
    ("VIS", "VISIBLE", 0, True),
    ("INV", "INVISIBLE", 1, True),
    ("CONST", "CONST", 2, False),
    ("CINV", "CONST-INVIS", 3, False),
    ("VAR", "VAR-DEFAULT", 0, False),
]


def _visibility(s: SuiteBuilder) -> None:
    for mode in (0, 1, 2):
        c = _new(
            s, f"attmode-{mode}",
            f"$ATTMODE={mode}: rows VISIBLE (ATTRIB), INVISIBLE (ATTRIB 70=1), CONST (ATTDEF 70=2), CONST-INVIS (ATTDEF 70=3), VAR-DEFAULT (ATTDEF without ATTRIB)",
            ["ATTRIB", "ATTDEF", "ATTMODE", "invisible", "constant"], ["Q-0492", "Q-0493", "Q-0494"],
            params={"attmode": mode}, header={"$ATTMODE": mode},
        )
        blk = _block(c, "ROWS")
        ins = c.msp.add_blockref("ROWS", (0, 0))
        for i, (tag, val, flags, has) in enumerate(ROWS):
            y = 125 - i * 25
            blk.add_line((10, y), (22, y))
            attdef(blk, tag, val, (30, y), flags=flags, h=12)
            if has:
                attrib(ins, tag, val, (30, y), flags=flags, h=12)
        c.window(W0, W1)
    c = _new(
        s, "const-attdef-two-inserts",
        "Block with constant ATTDEF 'CONST' (70=2) + frame, inserted twice (plain; rotated 30 and scaled 1.5); no ATTRIBs",
        ["ATTDEF", "constant", "INSERT"], ["Q-0494"],
    )
    blk = _block(c, "K", [(0, 0), (60, 0), (60, 25), (0, 25)])
    attdef(blk, "CONST", "CONST", (5, 7), flags=2, h=12)
    c.msp.add_blockref("K", (15, 100))
    c.msp.add_blockref("K", (90, 20), dxfattribs={"rotation": 30, "xscale": 1.5, "yscale": 1.5})
    c.window(W0, W1)
    c = _new(
        s, "var-attdef-no-attrib",
        "Block with non-constant ATTDEF (default 'VAR-DEFAULT') + frame, INSERT without ATTRIBs (should draw only the frame)",
        ["ATTDEF", "INSERT"], ["Q-0494"],
    )
    blk = _block(c, "V", [(0, 0), (120, 0), (120, 30), (0, 30)])
    attdef(blk, "VAR", "VAR-DEFAULT", (5, 9), h=12)
    c.msp.add_blockref("V", (40, 60))
    c.window(W0, W1)
    for name, flags, note in (("loose-attdef", 0, "normal"), ("loose-attdef-invisible", 1, "invisible 70=1"), ("loose-attdef-constant", 2, "constant 70=2")):
        c = _new(
            s, name,
            f"Model-space ATTDEF ({note}) tag 'TAGNAME' default 'DEFAULT' prompt 'PROMPT' h=15 at (20,70) (tag or default shown?)",
            ["ATTDEF", "loose"], ["Q-0494"], params={"flags": flags},
        )
        a = attdef(c.msp, "TAGNAME", "DEFAULT", (20, 70), flags=flags, h=15)
        a.dxf.prompt = "PROMPT"
        cross(c.msp, (20, 70))
        c.window(W0, W1)
    c = _new(
        s, "invisible-attrib-attmode1",
        "Single invisible ATTRIB (70=1) 'HIDDEN' next to a visible one 'SHOWN', $ATTMODE=1 (default)",
        ["ATTRIB", "invisible", "ATTMODE"], ["Q-0492"], header={"$ATTMODE": 1},
    )
    blk = _block(c, "I", [(0, 0), (150, 0), (150, 60), (0, 60)])
    attdef(blk, "A", "SHOWN", (10, 35), h=15)
    attdef(blk, "B", "HIDDEN", (10, 10), flags=1, h=15)
    ins = c.msp.add_blockref("I", (25, 45))
    attrib(ins, "A", "SHOWN", (35, 80), h=15)
    attrib(ins, "B", "HIDDEN", (35, 55), flags=1, h=15)
    c.window(W0, W1)


# ---------------------------------------------------------------------------------------------


def _flags(s: SuiteBuilder) -> None:
    for name, flags, lock, note in (
        ("flag-verify", 4, 0, "verify 70=4"),
        ("flag-preset", 8, 0, "preset 70=8"),
        ("lock-position", 0, 1, "lock position 280=1"),
    ):
        c = _new(
            s, name, f"INSERT with ATTRIB 'Value Fg' h=15 ({note}; UI-only, rendering unchanged)",
            ["ATTRIB", "ATTDEF", "flags"], params={"flags": flags, "lock_position": lock},
        )
        blk = _block(c, "F", [(0, 0), (120, 0), (120, 30), (0, 30)])
        extra = {"lock_position": lock} if lock else None
        attdef(blk, "VAL", "Value Fg", (5, 9), flags=flags, h=15, dxfattribs=extra)
        ins = c.msp.add_blockref("F", (40, 60))
        attrib(ins, "VAL", "Value Fg", (45, 69), flags=flags, h=15, dxfattribs=extra)
        c.window(W0, W1)


# ---------------------------------------------------------------------------------------------


def _transforms(s: SuiteBuilder) -> None:
    frame = [(0, 0), (70, 0), (70, 25), (0, 25)]
    cases = [
        # name, insert point, rot, sx, sy, backward, note
        ("insert-rotated-30", (80.0, 50.0), 30, 1, 1, False, "rotation 30"),
        ("insert-scaled-2", (30.0, 50.0), 0, 2, 2, False, "uniform scale 2"),
        ("insert-rotated-scaled", (130.0, 40.0), 120, 1.5, 1.5, False, "rotation 120, scale 1.5"),
        ("insert-nonuniform-2x1", (30.0, 60.0), 0, 2, 1, False, "scale (2,1): ATTRIB width factor 2"),
        ("insert-mirrored-x-readable", (140.0, 60.0), 0, -1, 1, False, "scale (-1,1), ATTRIB kept readable"),
        ("insert-mirrored-x-backward", (140.0, 60.0), 0, -1, 1, True, "scale (-1,1), ATTRIB mirrored (71=2)"),
    ]
    for name, p0, rot, sx, sy, back, note in cases:
        c = _new(
            s, name, f"INSERT at {p0} {note}; ATTRIB 'Fg1 Attr' stored in final position (block ATTDEF h=10 at (5,8))",
            ["ATTRIB", "INSERT", "transform"], params={"rotation": rot, "xscale": sx, "yscale": sy},
        )
        blk = _block(c, "T", frame)
        attdef(blk, "VAL", "Fg1 Attr", (5, 8), h=10)
        ins = c.msp.add_blockref("T", p0, dxfattribs={"rotation": rot, "xscale": sx, "yscale": sy})
        a = _xform(p0, (5, 8), rot, sx, sy)
        h = 10 * abs(sy)
        w = abs(sx / sy)
        if sx < 0 and not back:
            # readable: text starts at the mirrored far end of the frame
            a = _xform(p0, (65, 8), rot, sx, sy)
        attrib(ins, "VAL", "Fg1 Attr", a, h=h, width=w, rotation=rot, flags=2 if back else 0)
        cross(c.msp, p0)
        c.window(W0, W1)
    c = _new(
        s, "attrib-untransformed",
        "INSERT at (100,80) rotated 45 scaled 2, but ATTRIB left at block-relative coordinates (5,8) h=10 (drawn from stored geometry, not transformed)",
        ["ATTRIB", "INSERT", "transform"],
    )
    blk = _block(c, "T", frame)
    attdef(blk, "VAL", "Fg1 Attr", (5, 8), h=10)
    ins = c.msp.add_blockref("T", (100, 80), dxfattribs={"rotation": 45, "xscale": 2, "yscale": 2})
    attrib(ins, "VAL", "Stored", (5, 8), h=10)
    cross(c.msp, (100, 80))
    c.window(W0, W1)
    c = _new(
        s, "mirror-const-attdef",
        "Block with TEXT 'Txt', constant ATTDEF 'Const' and ATTDEF VAL; INSERT scale (-1,1) at (150,40) with readable ATTRIB 'Attr', $MIRRTEXT 0; plain INSERT at (20,100)",
        ["ATTRIB", "ATTDEF", "constant", "INSERT", "mirror", "MIRRTEXT"], ["Q-0616"],
    )
    blk = _block(c, "M", [(0, 0), (100, 0), (100, 40), (0, 40)])
    blk.add_text("Txt", dxfattribs={"insert": (5, 25), "height": 10, "style": "Standard"})
    attdef(blk, "C", "Const", (5, 5), flags=2, h=10)
    attdef(blk, "VAL", "Attr", (55, 5), h=10)
    ins = c.msp.add_blockref("M", (20, 100))
    attrib(ins, "VAL", "Attr", (75, 105), h=10)
    ins = c.msp.add_blockref("M", (150, 40), dxfattribs={"xscale": -1})
    attrib(ins, "VAL", "Attr", (55, 45), h=10)
    c.window(W0, W1)


# ---------------------------------------------------------------------------------------------


def _draw_order(s: SuiteBuilder) -> None:
    c = _new(
        s, "draworder-hatch-in-block",
        "Block: TEXT 'UNDER' (green) then solid red HATCH; INSERT with blue ATTRIB 'OVER' over the hatch (ATTRIBs after block content?)",
        ["ATTRIB", "HATCH", "draw-order"], ["Q-0291"], style_table="acad.ctb",
    )
    blk = _block(c, "H")
    blk.add_text("UNDER", dxfattribs={"insert": (5, 25), "height": 12, "color": 3, "style": "Standard"})
    h = blk.add_hatch(color=1)
    h.paths.add_polyline_path([(0, 0), (140, 0), (140, 60), (0, 60)], is_closed=True)
    attdef(blk, "VAL", "OVER", (70, 30), align="MIDDLE_CENTER", h=25)
    ins = c.msp.add_blockref("H", (30, 45))
    attrib(ins, "VAL", "OVER", (100, 75), align="MIDDLE_CENTER", h=25, dxfattribs={"color": 5})
    c.window(W0, W1)
    c = _new(
        s, "draworder-hatch-after-insert",
        "INSERT with blue ATTRIB 'OVER', then a model-space solid red HATCH over it (later entity on top?)",
        ["ATTRIB", "HATCH", "draw-order"], ["Q-0291"], style_table="acad.ctb",
    )
    blk = _block(c, "H", [(0, 0), (140, 0), (140, 60), (0, 60)])
    attdef(blk, "VAL", "OVER", (70, 30), align="MIDDLE_CENTER", h=25)
    ins = c.msp.add_blockref("H", (30, 45))
    attrib(ins, "VAL", "OVER", (100, 75), align="MIDDLE_CENTER", h=25, dxfattribs={"color": 5})
    h = c.msp.add_hatch(color=1)
    h.paths.add_polyline_path([(80, 30), (180, 30), (180, 90), (80, 90)], is_closed=True)
    c.window(W0, W1)


# ---------------------------------------------------------------------------------------------


def _properties(s: SuiteBuilder) -> None:
    for name, icolor, note in (("props-byblock-bylayer", 5, "INSERT colour 5 (blue)"), ("props-insert-bylayer", 256, "INSERT colour BYLAYER")):
        c = _new(
            s, name,
            f"{note} on layer L2 (red); ATTRIBs on layer 0 / A (green) with colour BYBLOCK / BYLAYER; block LINE BYBLOCK on layer 0",
            ["ATTRIB", "INSERT", "BYBLOCK", "BYLAYER", "color"], ["Q-0279"], style_table="acad.ctb",
            params={"insert_color": icolor},
        )
        c.layer("L2", color=1)
        c.layer("A", color=3)
        blk = _block(c, "P")
        blk.add_line((0, 0), (160, 0), dxfattribs={"color": 0})
        rows = [("L0BB", "0 BYBLOCK", "0", 0), ("L0BL", "0 BYLAYER", "0", 256), ("LABB", "A BYBLOCK", "A", 0), ("LABL", "A BYLAYER", "A", 256)]
        for i, (tag, val, layer, col) in enumerate(rows):
            attdef(blk, tag, val, (0, 15 + i * 25), h=15, dxfattribs={"layer": layer, "color": col})
        ins = c.msp.add_blockref("P", (20, 15), dxfattribs={"layer": "L2", "color": icolor})
        for i, (tag, val, layer, col) in enumerate(rows):
            attrib(ins, tag, val, (20, 30 + i * 25), h=15, dxfattribs={"layer": layer, "color": col})
        c.window(W0, W1)
    c = _new(
        s, "props-nested-byblock",
        "Block OUTER contains INSERT INNER (colour 1 red) with ATTRIB colour BYBLOCK; OUTER inserted with colour 3 (green)",
        ["ATTRIB", "INSERT", "BYBLOCK", "nested", "color"], ["Q-0496"], style_table="acad.ctb",
    )
    inner = _block(c, "INNER")
    inner.add_line((0, -5), (120, -5), dxfattribs={"color": 0})
    attdef(inner, "VAL", "NESTED BYBLOCK", (0, 0), h=12, dxfattribs={"color": 0})
    outer = _block(c, "OUTER")
    outer.add_line((0, -20), (120, -20), dxfattribs={"color": 0})
    ii = outer.add_blockref("INNER", (0, 0), dxfattribs={"color": 1})
    attrib(ii, "VAL", "NESTED BYBLOCK", (0, 0), h=12, dxfattribs={"color": 0})
    c.msp.add_blockref("OUTER", (30, 70), dxfattribs={"color": 3})
    c.window(W0, W1)
    for name, state in (("layer-off-insert", "off"), ("layer-frozen-insert", "frozen")):
        c = _new(
            s, name,
            f"INSERT on layer L2 ({state.upper()}) with ATTRIBs on layers 0, L2, L3; block LINEs on 0 and L3",
            ["ATTRIB", "INSERT", "layer", f"layer-{state}"], ["Q-0497"], params={"layer_state": state},
        )
        c.layer("L2", on=state != "off", frozen=state == "frozen")
        c.layer("L3")
        blk = _block(c, "O")
        blk.add_line((0, 0), (150, 0))
        blk.add_line((0, -10), (150, -10), dxfattribs={"layer": "L3"})
        rows = [("A0", "ON LAYER 0", "0"), ("AL2", "ON LAYER L2", "L2"), ("AL3", "ON LAYER L3", "L3")]
        for i, (tag, val, layer) in enumerate(rows):
            attdef(blk, tag, val, (0, 10 + i * 25), h=15, dxfattribs={"layer": layer})
        ins = c.msp.add_blockref("O", (25, 40), dxfattribs={"layer": "L2"})
        for i, (tag, val, layer) in enumerate(rows):
            attrib(ins, tag, val, (25, 50 + i * 25), h=15, dxfattribs={"layer": layer})
        c.window(W0, W1)


# ---------------------------------------------------------------------------------------------


def _minsert(s: SuiteBuilder) -> None:
    for name, rows, cols, rot in (("minsert-2x2", 2, 2, 0), ("minsert-3x2", 3, 2, 0), ("minsert-2x2-rot30", 2, 2, 30)):
        c = _new(
            s, name,
            f"MINSERT {rows} rows x {cols} cols, spacing col 60 / row 35, rotation {rot}; one ATTRIB 'ATT' at cell (0,0) (drawn in every cell?)",
            ["ATTRIB", "MINSERT"], ["Q-0495"], params={"rows": rows, "cols": cols, "rotation": rot},
        )
        blk = _block(c, "MI", [(0, 0), (50, 0), (50, 25), (0, 25)])
        attdef(blk, "VAL", "ATT", (5, 7), h=12)
        p0 = (30.0, 25.0) if rot == 0 else (60.0, 15.0)
        ins = c.msp.add_blockref("MI", p0, dxfattribs={"rotation": rot})
        ins.grid(size=(rows, cols), spacing=(35, 60))
        attrib(ins, "VAL", "ATT", _xform(p0, (5, 7), rot), h=12, rotation=rot)
        cross(c.msp, p0)
        c.window(W0, W1)


# ---------------------------------------------------------------------------------------------


def _multiline(s: SuiteBuilder) -> None:
    def ml_insert(c, value: str, group1: Optional[str], atype: Optional[int]):
        blk = _block(c, "ML", [(0, 0), (150, 0), (150, 60), (0, 60)])
        ad = blk.add_attdef("VAL", (5, 50), "DEF", dxfattribs={"height": 12, "style": "Standard"})
        ad.set_mtext(_mtext("DEF\\PDEF2", (5, 50, 0), 12))
        ad.dxf.insert = (5, 38, 0)
        _has_attdefs(blk)
        ins = c.msp.add_blockref("ML", (25, 35))
        a = ins.add_attrib("VAL", "x", (30, 85), dxfattribs={"height": 12, "style": "Standard"})
        a.set_mtext(_mtext(value, (30, 85, 0), 12))
        a.dxf.insert = (30, 73, 0)  # 10 = first baseline start of the top-left attached MTEXT
        if group1 is not None:
            a.dxf.text = group1
        if atype is not None:
            a.dxf.attribute_type = atype
        return a

    c = _new(
        s, "multiline-attrib",
        "R2018 multi-line ATTRIB (71=2) embedded MTEXT 'NEW\\PLINE2', group 1 = same content",
        ["ATTRIB", "ATTDEF", "multi-line", "MTEXT"], ["Q-0500"],
    )
    ml_insert(c, "NEW\\PLINE2", "NEW\\PLINE2", None)
    c.window(W0, W1)
    c = _new(
        s, "multiline-attrib-stale-group1",
        "R2018 multi-line ATTRIB (71=2) with group 1 'OLD' but embedded MTEXT 'NEW\\PLINE2'",
        ["ATTRIB", "multi-line", "MTEXT", "stale"], ["Q-0500"],
    )
    ml_insert(c, "NEW\\PLINE2", "OLD", None)
    c.window(W0, W1)
    c = _new(
        s, "multiline-attrib-type1",
        "R2018 ATTRIB with embedded MTEXT 'A\\PB' but attribute type 71=1 (single line), group 1 'A'",
        ["ATTRIB", "multi-line", "MTEXT"], ["Q-0499"],
    )
    ml_insert(c, "A\\PB", "A", 1)
    c.window(W0, W1)
    c = _new(
        s, "multiline-const-attdef",
        "R2018 constant multi-line ATTDEF (70=2, 71=4) 'CONST\\PLINE2' in a block, INSERT without ATTRIBs",
        ["ATTDEF", "constant", "multi-line", "MTEXT"], ["Q-0494"],
    )
    blk = _block(c, "MC", [(0, 0), (150, 0), (150, 60), (0, 60)])
    ad = blk.add_attdef("CONST", (5, 50), "CONST", dxfattribs={"height": 12, "style": "Standard", "flags": 2})
    ad.set_mtext(_mtext("CONST\\PLINE2", (5, 50, 0), 12))
    ad.dxf.insert = (5, 38, 0)
    ad.dxf.text = "CONST\\PLINE2"
    _has_attdefs(blk)
    c.msp.add_blockref("MC", (25, 35))
    c.window(W0, W1)


# ---------------------------------------------------------------------------------------------


def _misc(s: SuiteBuilder) -> None:
    c = _new(
        s, "height0-attrib",
        "INSERT with ATTRIB 'ZERO' height 40=0 (invalid on purpose) at (30,90) and normal ATTRIB 'NORMAL' h=15 at (30,40)",
        ["ATTRIB", "height", "degenerate"], ["Q-0406"],
    )
    blk = _block(c, "Z", [(0, 0), (120, 0), (120, 80), (0, 80)])
    attdef(blk, "Z", "ZERO", (5, 60), h=15)
    attdef(blk, "N", "NORMAL", (5, 10), h=15)
    ins = c.msp.add_blockref("Z", (25, 30))
    a = attrib(ins, "Z", "ZERO", (30, 90), h=15)
    a.dxf.unprotected_set("height", 0.0)
    attrib(ins, "N", "NORMAL", (30, 40), h=15)
    cross(c.msp, (30, 90))
    c.window(W0, W1)
    for q in (0, 1):
        c = _new(
            s, f"qtextmode-{q}",
            f"$QTEXTMODE={q}: INSERT with a LEFT ATTRIB and a rotated MIDDLE_CENTER ATTRIB",
            ["ATTRIB", "QTEXTMODE"], ["Q-0407"], header={"$QTEXTMODE": q},
        )
        blk = _block(c, "Q", [(0, 0), (150, 0), (150, 90), (0, 90)])
        attdef(blk, "A", "Attrib Fg", (5, 65), h=15)
        attdef(blk, "B", "Rotated", (100, 30), align="MIDDLE_CENTER", h=12, rotation=30)
        ins = c.msp.add_blockref("Q", (25, 30))
        attrib(ins, "A", "Attrib Fg", (30, 95), h=15)
        attrib(ins, "B", "Rotated", (125, 60), align="MIDDLE_CENTER", h=12, rotation=30)
        c.window(W0, W1)
    c = _new(
        s, "fit-stale-width",
        "ATTRIB FIT 'HIH' h=20 from (50,75) to (150,75) with inconsistent stored 41=3.0",
        ["ATTRIB", "FIT", "stale"], ["Q-0503"],
    )
    blk = _block(c, "S", [(0, -10), (120, -10), (120, 30), (0, 30)])
    attdef(blk, "VAL", "HIH", (10, 0), align="FIT", h=20, p2=(110, 0))
    ins = c.msp.add_blockref("S", (40, 75))
    a = attrib(ins, "VAL", "HIH", (50, 75), align="FIT", h=20, p2=(150, 75))
    a.dxf.width = 3.0
    cross(c.msp, (50, 75))
    cross(c.msp, (150, 75))
    c.window(W0, W1)
    c = _new(
        s, "special-codes-attrib",
        "INSERT with ATTRIB '%%c50 %%d %%p %%uUL%%u' h=15 (TEXT special codes in an ATTRIB)",
        ["ATTRIB", "special-codes"], ["Q-0383"],
    )
    blk = _block(c, "SC", [(0, 0), (170, 0), (170, 35), (0, 35)])
    attdef(blk, "VAL", "x", (5, 10), h=15)
    ins = c.msp.add_blockref("SC", (15, 60))
    attrib(ins, "VAL", "%%c50 %%d %%p %%uUL%%u", (20, 70), h=15)
    c.window(W0, W1)
    c = _new(
        s, "attrib-styles",
        "ATTRIBs in Lato (h=15) and Cascadia Mono width 0.8 oblique 15 (h=15) from one INSERT",
        ["ATTRIB", "STYLE", "font"],
    )
    c.style("LATO", font=TTF_FONTS["lato"])
    c.style("MONO", font=TTF_FONTS["mono"])
    blk = _block(c, "ST", [(0, 0), (170, 0), (170, 70), (0, 70)])
    attdef(blk, "A", "Lato Attrib", (5, 45), h=15, font="lato", style="LATO")
    attdef(blk, "B", "Mono Attrib", (5, 10), h=15, font="mono", style="MONO", width=0.8, oblique=15)
    ins = c.msp.add_blockref("ST", (15, 40))
    attrib(ins, "A", "Lato Attrib", (20, 85), h=15, font="lato", style="LATO")
    attrib(ins, "B", "Mono Attrib", (20, 50), h=15, font="mono", style="MONO", width=0.8, oblique=15)
    c.window(W0, W1)


# ---------------------------------------------------------------------------------------------


def _random(s: SuiteBuilder) -> None:
    words = ["Tag", "Fg1", "Value", "ÄÖÜ", "42", "Attr", "xyz", "N-7"]
    for seed in range(1, 7):
        c = _new(
            s, f"random-{seed:04d}", f"Random INSERT (rotation, uniform scale) with 1-3 ATTRIBs of random alignment, seed {seed}",
            ["ATTRIB", "INSERT", "random"], seed=seed,
        )
        rng = c.rng
        blk = _block(c, "R", [(-40, -50), (40, -50), (40, 50), (-40, 50)])
        rot = rng.choice([0, 0, 20, 90, 200])
        sc = rng.choice([1.0, 1.0, 1.2, 0.8])
        p0 = (r(rng.uniform(90, 110)), r(rng.uniform(70, 80)))
        ins = c.msp.add_blockref("R", p0, dxfattribs={"rotation": rot, "xscale": sc, "yscale": sc})
        for k in range(rng.randint(1, 3)):
            tag = f"T{k}"
            val = rng.choice(words)
            al = rng.choice([a for a in ALIGN_NAMES if a not in ("FIT", "ALIGNED")])
            a_blk = (0.0, 32.0 - 32.0 * k)
            h = rng.choice([8.0, 10.0, 12.0])
            attdef(blk, tag, val, a_blk, align=al, h=h)
            attrib(ins, tag, val, _xform(p0, a_blk, rot, sc, sc), align=al, h=h * sc, rotation=rot)
        cross(c.msp, p0)
        c.window(W0, W1)
