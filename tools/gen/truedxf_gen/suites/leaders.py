"""LEADER, MULTILEADER (+ MLEADERSTYLE) and TOLERANCE (note 05 §11-13, note 02 §3.10).

LEADER and TOLERANCE take their sizes/colours from the DIMSTYLE (Standard = ISO-25 x1.6, see
_dimensions_util: DIMASZ 4, DIMGAP 1, DIMTXT 4, DIMTAD 1) plus DSTYLE XDATA overrides.
MULTILEADERs are built with ezdxf's MultiLeaderMTextBuilder / MultiLeaderBlockBuilder on the
ezdxf ``Standard`` MLEADERSTYLE (text 4, arrow 4, landing gap 2, dogleg 8). ezdxf never writes the
ACDB_MLEADEROBJECTCONTEXTDATA_CLASS object, so every MULTILEADER here is a "third-party" one.

TOLERANCE: AutoCAD's gdt.shx is not installed, so no case uses ``{\\Fgdt;x}`` symbols; the
symbol cells hold plain letters (X, Y) of the dimension text style (Liberation Sans) — these cases
calibrate frame geometry only. GDT-symbol cases belong to the acad-default-fonts suite.
"""

from __future__ import annotations

import math

from ezdxf import colors
from ezdxf.math import Vec2, Vec3
from ezdxf.render import mleader as ml

from ..core import SuiteBuilder, suite
from ..resources import TTF_FONTS
from ._dimensions_util import keep_object_codes, setup_dimstyle

W = ((0, 0), (200, 150))


def _new(s: SuiteBuilder, name: str, title: str, *, style: dict | None = None, **kw):
    c = s.case(name, title, **kw)
    setup_dimstyle(c, values=style)
    return c


def _dstyle(entity, pairs):
    """Write ACAD DSTYLE XDATA pairs [(code, value)] on LEADER/TOLERANCE."""
    from ezdxf.lldxf.types import get_xcode_for

    tags = []
    for code, value in pairs:
        tags.append((1070, code))
        tags.append((get_xcode_for(code), value))
    entity.set_xdata_list("ACAD", "DSTYLE", tags)


# --------------------------------------------------------------------------------------------
# LEADER helpers


def leader(c, vertices, *, override=None, dimstyle="Standard", **attribs):
    ld = c.msp.add_leader(vertices, dimstyle=dimstyle, override=override)
    for k, v in attribs.items():
        ld.dxf.set(k, v)
    return ld


HOOK_VERTS = [(50, 40), (95, 90), (99, 90)]  # last segment = stored hook of length DIMASZ (4)


def mtext_annotation(c, ld, at, text="ABC", attachment=7, height=4.0, width=10.0):
    mt = c.msp.add_mtext(text, dxfattribs={"insert": at, "char_height": height, "attachment_point": attachment,
                                           "style": "Standard"})
    ld.dxf.annotation_type = 0
    ld.dxf.annotation_handle = mt.dxf.handle
    ld.dxf.text_height = height
    ld.dxf.text_width = width
    return mt


def mtext_leader(c, *, verts=HOOK_VERTS, tad=1, h211=(1, 0, 0), hook_dir=0, has_hook=1, text="ABC", width=10.0,
                 override=None, **attribs):
    ld = leader(c, verts, override=override, **attribs)
    ld.dxf.horizontal_direction = Vec3(h211)
    ld.dxf.hookline_direction = hook_dir
    ld.dxf.has_hookline = has_hook
    last = Vec2(verts[-1])
    if tad:
        mtext_annotation(c, ld, (last.x + 1, last.y + 1), text=text, attachment=7, width=width)
    else:
        mtext_annotation(c, ld, (last.x + 1, last.y), text=text, attachment=4, width=width)
    return ld


# --------------------------------------------------------------------------------------------
# MULTILEADER helpers


def mtext_mleader(c, content="MLEADER", *, insert=(110, 90), side=ml.ConnectionSide.left, lines=None,
                  dogleg=8.0, landing_gap=2.0, char_height=4.0, alignment=ml.TextAlignment.left, style="Standard",
                  mstyle="Standard", arrow=None, arrow_size=0.0, leader_type=ml.LeaderType.straight_lines,
                  left=ml.HorizontalConnection.by_style, right=ml.HorizontalConnection.by_style,
                  top=ml.VerticalConnection.by_style, bottom=ml.VerticalConnection.by_style, rotation=0.0):
    b = c.msp.add_multileader_mtext(mstyle)
    b.set_content(content, char_height=char_height, alignment=alignment, style=style)
    b.set_connection_properties(landing_gap=landing_gap, dogleg_length=dogleg)
    b.set_connection_types(left=left, right=right, top=top, bottom=bottom)
    b.set_leader_properties(leader_type=leader_type)
    if arrow is not None or arrow_size:
        b.set_arrow_properties(name=arrow or "", size=arrow_size)
    for ln_side, verts in (lines or [(side, [(40, 40)])]):
        b.add_leader_line(ln_side, [Vec2(v) for v in verts])
    b.build(insert=Vec2(insert), rotation=rotation)
    return b


def _content_block(c, name="MLBLK", filled=False, attdef=False):
    if name not in c.doc.blocks:
        blk = c.doc.blocks.new(name)
        if filled:
            blk.add_solid([(-8, -8), (8, -8), (-8, 8), (8, 8)], dxfattribs={"color": 5})
        blk.add_circle((0, 0), 8)
        blk.add_line((-8, 0), (8, 0))
        if attdef:
            blk.add_attdef("NUM", (-3, 1.5), dxfattribs={"height": 4, "style": "Standard"})
    return name


def block_mleader(c, *, insert=(120, 90), alignment=ml.BlockAlignment.center_extents, block=None, verts=((40, 40),),
                  side=ml.ConnectionSide.left, scale=1.0, color=None, mstyle="Standard", attrib=None):
    name = block or _content_block(c)
    b = c.msp.add_multileader_block(mstyle)
    kw = {"color": color} if color is not None else {}
    b.set_content(name=name, scale=scale, alignment=alignment, **kw)
    if attrib:
        b.set_attribute("NUM", attrib)
    b.add_leader_line(side, [Vec2(v) for v in verts])
    b.build(insert=Vec2(insert))
    return b


# --------------------------------------------------------------------------------------------


@suite("leaders", "LEADER, MULTILEADER and TOLERANCE", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    _leaders(s)
    _mleaders(s)
    _tolerances(s)
    _random(s)


def _leaders(s):
    for n, verts in ((2, [(40, 30), (160, 120)]), (3, [(40, 30), (100, 110), (160, 110)]),
                     (5, [(30, 30), (70, 110), (110, 40), (150, 110), (180, 80)])):
        c = _new(s, f"leader-straight-{n}v", f"LEADER straight (72=0), {n} vertices, closed-filled arrow, no annotation",
                 tags=["LEADER"], params={"vertices": verts})
        leader(c, verts)
        c.window(*W)
        c = _new(s, f"leader-spline-{n}v", f"LEADER spline (72=1), {n} vertices (fit points), no annotation",
                 tags=["LEADER", "spline"], questions=["Q-0587"], params={"vertices": verts})
        leader(c, verts, path_type=1)
        c.layer("FRAME", color=8)
        c.msp.add_lwpolyline(verts, dxfattribs={"layer": "FRAME"})
        c.window(*W)
    c = _new(s, "leader-spline-mtext", "LEADER spline (72=1), 3 vertices + hook, MTEXT annotation (end tangent from 211?)",
             tags=["LEADER", "spline", "MTEXT"], questions=["Q-0587"])
    mtext_leader(c, verts=[(40, 30), (70, 100), (95, 90), (99, 90)], path_type=1, has_hook=1)
    c.window(*W)
    c = _new(s, "leader-no-arrow", "LEADER with 71=0 (no arrowhead), 3 vertices", tags=["LEADER", "arrow"])
    leader(c, [(40, 30), (100, 110), (160, 110)], has_arrowhead=0)
    c.window(*W)

    # arrow omission threshold: first segment L vs 2*DIMASZ (DIMASZ 2.5), zoomed 40 px/unit
    for arrow in ("", "DOT"):
        for L in (4.9, 5.0, 5.1, 10.0):
            tag = f"{L:g}".replace(".", "p")
            c = _new(s, f"leader-first-seg-{tag}-{arrow.lower() or 'closedfilled'}",
                     f"LEADER first segment {L:g} with DIMASZ 2.5 ({arrow or 'closed filled'}): arrow drawn only if segment >= 2*DIMASZ?",
                     tags=["LEADER", "arrow"], questions=["Q-0582"], params={"first_segment": L, "dimasz": 2.5, "arrow": arrow})
            ov = {"dimasz": 2.5}
            if arrow:
                ov["dimldrblk"] = arrow
            leader(c, [(0, 0), (L, 0), (L + 8, 10)], override=ov)
            c.msp.add_point((0, 0))
            c.window_center((L / 2 + 4, 5), 40)
    # DIMLDRBLK vs DIMBLK
    c = _new(s, "leader-dimldrblk-vs-dimblk-record", "LEADER, DIMSTYLE record DIMBLK=DOT, DIMLDRBLK=OPEN30, DIMASZ 8: which arrow?",
             tags=["LEADER", "DIMLDRBLK"], questions=["Q-0583"], style={"dimblk": "DOT", "dimldrblk": "OPEN30", "dimasz": 8.0})
    leader(c, [(40, 30), (100, 110), (160, 110)])
    c.window(*W)
    c = _new(s, "leader-dimldrblk-vs-dimblk-dstyle", "LEADER, DSTYLE DIMBLK=DOT, DIMLDRBLK=OPEN30, DIMASZ 8: which arrow?",
             tags=["LEADER", "DIMLDRBLK", "DSTYLE"], questions=["Q-0583"])
    ld = leader(c, [(40, 30), (100, 110), (160, 110)], override={"dimldrblk": "OPEN30", "dimasz": 8.0})
    c.doc.acquire_arrow("DOT")
    dot = c.doc.blocks.get("_DOT").block_record_handle
    tags = [tuple(t) for t in ld.get_xdata_list("ACAD", "DSTYLE")][2:-1]
    ld.set_xdata_list("ACAD", "DSTYLE", tags + [(1070, 342), (1005, dot)])
    c.window(*W)
    for arrow in ("ARCHTICK", "OPEN", "NONE", "DOT", "BOXFILLED"):
        c = _new(s, f"leader-arrow-{arrow.lower()}", f"LEADER DIMLDRBLK={arrow}, DIMASZ 8", tags=["LEADER", "DIMLDRBLK"],
                 questions=["Q-0583"], params={"dimldrblk": arrow})
        leader(c, [(40, 30), (100, 110), (160, 110)], override={"dimldrblk": arrow, "dimasz": 8.0})
        c.window(*W)
    c = _new(s, "leader-arrow-user-block", "LEADER DIMLDRBLK=user block ARROWX (cross + tail), DIMASZ 8", tags=["LEADER", "DIMLDRBLK"])
    b = c.doc.blocks.new("ARROWX")
    b.add_line((-0.5, -0.5), (0.5, 0.5))
    b.add_line((-0.5, 0.5), (0.5, -0.5))
    b.add_line((-1, 0), (0, 0))
    leader(c, [(40, 30), (100, 110), (160, 110)], override={"dimldrblk": "ARROWX", "dimasz": 8.0})
    c.window(*W)
    c = _new(s, "leader-dimscale-2", "LEADER DSTYLE DIMSCALE=2 (arrow 2*DIMASZ?)", tags=["LEADER", "DIMSCALE"])
    leader(c, [(40, 30), (100, 110), (160, 110)], override={"dimscale": 2.0})
    c.window(*W)

    # hook line direction flags: identical geometry (hook stored toward +X, text right), flags vary
    for hx in (1, -1):
        for f74 in (0, 1):
            for f75 in (0, 1):
                c = _new(s, f"leader-hook-211{'p' if hx > 0 else 'm'}x-74-{f74}-75-{f75}",
                         f"LEADER + MTEXT, DIMTAD=1, 211={'+X' if hx > 0 else '-X'}, 74={f74}, 75={f75}: direction of the unstored text extension",
                         tags=["LEADER", "hookline", "MTEXT"], questions=["Q-0581", "Q-0584"],
                         params={"h211": hx, "hookline_direction": f74, "has_hookline": f75})
                mtext_leader(c, h211=(hx, 0, 0), hook_dir=f74, has_hook=f75)
                c.window(*W)
    c = _new(s, "leader-mtext-dimtad-0", "LEADER + MTEXT (middle-left), DIMTAD=0, 75=1, 41=10: no text extension expected",
             tags=["LEADER", "MTEXT", "DIMTAD"], questions=["Q-0584"], style={"dimtad": 0})
    mtext_leader(c, tad=0)
    c.window(*W)
    c = _new(s, "leader-mtext-extension-colors", "LEADER + MTEXT DIMTAD=1, DIMCLRD=1, DIMLWD=1.00, 41=10: extension colour/lineweight",
             tags=["LEADER", "MTEXT", "DIMCLRD"], questions=["Q-0585"], style_table="acad.ctb")
    mtext_leader(c, override={"dimclrd": 1, "dimlwd": 100})
    c.window(*W)
    c = _new(s, "leader-hookflag-no-hook-vertex", "LEADER 75=1 with 2 vertices (no stored hook, last segment diagonal) + MTEXT",
             tags=["LEADER", "hookline", "MTEXT"], questions=["Q-0586"])
    mtext_leader(c, verts=[(50, 40), (99, 90)], has_hook=1)
    c.window(*W)
    for tag, attribs in (("bylayer", {}), ("color3", {"color": 3})):
        c = _new(s, f"leader-77-color-{tag}", f"LEADER DIMCLRD=BYBLOCK, 77=1 (block color), entity color {tag}",
                 tags=["LEADER", "color"], questions=["Q-0588"], style_table="acad.ctb")
        leader(c, [(40, 30), (100, 110), (160, 110)], block_color=1, **attribs)
        c.window(*W)
    c = _new(s, "leader-undefined-dimstyle", "LEADER with 3=NOSUCH (undefined DIMSTYLE) (invalid on purpose)",
             tags=["LEADER", "DIMSTYLE"], questions=["Q-0509"])
    ld = leader(c, [(40, 30), (100, 110), (160, 110)])
    ld.dxf.dimstyle = "NOSUCH"
    c.allow_audit_errors = True
    c.window(*W)
    # annotation types 1 (tolerance) and 2 (block reference)
    c = _new(s, "leader-annotation-tolerance", "LEADER 73=1 with a TOLERANCE annotation (plain letters, no GDT font)",
             tags=["LEADER", "TOLERANCE"])
    ld = leader(c, [(40, 30), (90, 90), (94, 90)])
    t = c.msp.new_entity("TOLERANCE", {"dimstyle": "Standard", "insert": (94, 90), "content": "X%%v0.1%%vA",
                                       "x_axis_vector": (1, 0, 0)})
    ld.dxf.annotation_type = 1
    ld.dxf.annotation_handle = t.dxf.handle
    c.window(*W)
    c = _new(s, "leader-annotation-block", "LEADER 73=2 with an INSERT annotation", tags=["LEADER", "INSERT"])
    b = c.doc.blocks.new("TAG")
    b.add_circle((0, 0), 8)
    ld = leader(c, [(40, 30), (90, 90), (94, 90)])
    ins = c.msp.add_blockref("TAG", (102, 90))
    ld.dxf.annotation_type = 2
    ld.dxf.annotation_handle = ins.dxf.handle
    ld.dxf.leader_offset_block_ref = Vec3(-8, 0, 0)
    c.window(*W)


def _mleaders(s):
    c = _new(s, "mleader-mtext-basic", "MULTILEADER MTEXT content, one straight leader line, dogleg 8, landing gap 2",
             tags=["MULTILEADER", "MTEXT"], questions=["Q-0590"])
    mtext_mleader(c)
    c.window(*W)
    c = _new(s, "mleader-mtext-right", "MULTILEADER MTEXT content, leader on the right side (right attachment)",
             tags=["MULTILEADER", "MTEXT"])
    mtext_mleader(c, insert=(40, 90), side=ml.ConnectionSide.right, lines=[(ml.ConnectionSide.right, [(160, 40)])])
    c.window(*W)
    c = _new(s, "mleader-mtext-two-sides", "MULTILEADER MTEXT with one leader left and one right",
             tags=["MULTILEADER", "MTEXT"])
    mtext_mleader(c, insert=(80, 90), lines=[(ml.ConnectionSide.left, [(30, 40)]), (ml.ConnectionSide.right, [(180, 40)])])
    c.window(*W)
    c = _new(s, "mleader-mtext-three-lines", "MULTILEADER MTEXT with three leader lines on the left side (one with 2 vertices)",
             tags=["MULTILEADER", "MTEXT"])
    mtext_mleader(c, lines=[(ml.ConnectionSide.left, [(30, 30)]), (ml.ConnectionSide.left, [(60, 20)]),
                            (ml.ConnectionSide.left, [(20, 120), (50, 120)])])
    c.window(*W)
    c = _new(s, "mleader-mtext-multiline", "MULTILEADER MTEXT with two lines of text (\\P)", tags=["MULTILEADER", "MTEXT"])
    mtext_mleader(c, content="FIRST LINE\\PSECOND")
    c.window(*W)
    c = _new(s, "mleader-mtext-lato", "MULTILEADER MTEXT content in Lato (text style LATO), left attachment 1",
             tags=["MULTILEADER", "MTEXT", "font"], questions=["Q-0599"])
    c.style("LATO", font=TTF_FONTS["lato"])
    mtext_mleader(c, style="LATO", left=ml.HorizontalConnection.middle_of_top_line, content="Lato gjpq")
    c.window(*W)

    for dog in (0.0, 8.0, 20.0):
        c = _new(s, f"mleader-dogleg-{dog:g}", f"MULTILEADER dogleg length {dog:g} ({'off' if not dog else 'on'})",
                 tags=["MULTILEADER", "dogleg"], params={"dogleg": dog})
        mtext_mleader(c, dogleg=dog)
        c.window(*W)
    for lt in (1, 2):
        c = _new(s, f"mleader-dogleg-data-disabled-type{lt}", f"MULTILEADER with dogleg vector/length data present but 291=0, leader type {lt}",
                 tags=["MULTILEADER", "dogleg"], questions=["Q-0597"], params={"leader_type": lt})
        b = mtext_mleader(c, dogleg=8.0, leader_type=ml.LeaderType(lt))
        b.multileader.dxf.has_dogleg = 0
        c.window(*W)
    for gap in (0.5, 5.0):
        c = _new(s, f"mleader-landing-gap-{gap:g}".replace(".", "p"), f"MULTILEADER landing gap {gap:g}",
                 tags=["MULTILEADER", "landing-gap"], params={"landing_gap": gap})
        mtext_mleader(c, landing_gap=gap)
        c.window(*W)
    for n, verts in ((2, [(30, 30)]), (3, [(30, 30), (60, 120)])):
        c = _new(s, f"mleader-spline-{n}v", f"MULTILEADER spline leader (170=2), {n} leader points incl. landing",
                 tags=["MULTILEADER", "spline"], questions=["Q-0597"])
        mtext_mleader(c, leader_type=ml.LeaderType.splines, lines=[(ml.ConnectionSide.left, verts)])
        c.window(*W)
    c = _new(s, "mleader-leader-none", "MULTILEADER leader type 0 (invisible leader)", tags=["MULTILEADER"])
    mtext_mleader(c, leader_type=ml.LeaderType.none)
    c.window(*W)
    for arrow in ("DOT", "OPEN30", "NONE", "ARCHTICK", "BOXBLANK"):
        c = _new(s, f"mleader-arrow-{arrow.lower()}", f"MULTILEADER arrowhead {arrow}, size 6", tags=["MULTILEADER", "arrow"],
                 params={"arrow": arrow})
        mtext_mleader(c, arrow=arrow, arrow_size=6.0)
        c.window(*W)
    c = _new(s, "mleader-arrow-per-line", "MULTILEADER two leader lines, per-line arrowhead override (94/345) DOT on line 1",
             tags=["MULTILEADER", "arrow"])
    b = mtext_mleader(c, lines=[(ml.ConnectionSide.left, [(30, 30)]), (ml.ConnectionSide.left, [(40, 130)])])
    from ezdxf.entities.mleader import ArrowHeadData

    c.doc.acquire_arrow("DOT")
    b.multileader.arrow_heads.append(ArrowHeadData(1, c.doc.blocks.get("_DOT").block_record_handle))
    c.window(*W)
    # arrow omission: first segment lengths vs 2 * arrow size (arrow size 2)
    for L in (0.0, 3.9, 4.0, 4.1, 10.0):
        tag = f"{L:g}".replace(".", "p")
        c = _new(s, f"mleader-first-seg-{tag}", f"MULTILEADER arrow size 2, first leader segment {L:g} (arrow only if > 2*size?)",
                 tags=["MULTILEADER", "arrow"], questions=["Q-0596"], params={"first_segment": L, "arrow_size": 2})
        tip = (30.0, 40.0)
        mtext_mleader(c, arrow_size=2.0, lines=[(ml.ConnectionSide.left, [tip, (tip[0] + L, tip[1])])], insert=(110, 90))
        c.msp.add_point(tip)
        c.window(*W)
    c = _new(s, "mleader-arrow-huge", "MULTILEADER arrow size 50 on a ~20 unit leader line", tags=["MULTILEADER", "arrow"],
             questions=["Q-0596"])
    mtext_mleader(c, arrow_size=50.0, lines=[(ml.ConnectionSide.left, [(80, 75)])], insert=(110, 90))
    c.window(*W)
    # attachment types
    for att in range(9):
        c = _new(s, f"mleader-left-attachment-{att}", f"MULTILEADER two-line MTEXT, left attachment type {att} (173/174)",
                 tags=["MULTILEADER", "attachment"], questions=["Q-0600", "Q-0599"], params={"left_attachment": att})
        mtext_mleader(c, content="Line one\\PLine two", left=ml.HorizontalConnection(att))
        c.window(*W)
    for att in (1, 5, 6):
        c = _new(s, f"mleader-right-attachment-{att}", f"MULTILEADER two-line MTEXT, right attachment type {att} (95/175)",
                 tags=["MULTILEADER", "attachment"], questions=["Q-0600"], params={"right_attachment": att})
        mtext_mleader(c, content="Line one\\PLine two", insert=(40, 90), right=ml.HorizontalConnection(att),
                      lines=[(ml.ConnectionSide.right, [(160, 40)])], alignment=ml.TextAlignment.right)
        c.window(*W)
    for side, attv in ((ml.ConnectionSide.top, 9), (ml.ConnectionSide.top, 10), (ml.ConnectionSide.bottom, 9),
                       (ml.ConnectionSide.bottom, 10)):
        c = _new(s, f"mleader-vertical-{side.name}-{attv}", f"MULTILEADER vertical attachment ({side.name}) type {attv} (272/273)",
                 tags=["MULTILEADER", "attachment"], questions=["Q-0600"], params={"side": side.name, "attachment": attv})
        tip = (60, 130) if side == ml.ConnectionSide.top else (60, 20)
        kw = {"top": ml.VerticalConnection(attv)} if side == ml.ConnectionSide.top else {"bottom": ml.VerticalConnection(attv)}
        mtext_mleader(c, content="VERTICAL", insert=(100, 75), lines=[(side, [tip])], alignment=ml.TextAlignment.center, **kw)
        c.window(*W)
    # text frame
    for lines_, gap in (("one", 2.0), ("one", 0.5), ("two", 2.0), ("two", 0.5)):
        c = _new(s, f"mleader-text-frame-{lines_}-gap-{gap:g}".replace(".", "p"), f"MULTILEADER text frame (292=1), {lines_} line(s), landing gap {gap:g}",
                 tags=["MULTILEADER", "text-frame"], questions=["Q-0601"], params={"lines": lines_, "landing_gap": gap})
        b = mtext_mleader(c, content="FRAMED" if lines_ == "one" else "FRAMED\\PTEXT", landing_gap=gap)
        b.multileader.dxf.has_text_frame = 1
        c.window(*W)
    # entity values vs style (override flags 0)
    c = _new(s, "mleader-override-flags-0", "MULTILEADER text height 7 / arrow 8 in entity+context but style 4/4, 90=0 (no override bits)",
             tags=["MULTILEADER", "override"], questions=["Q-0591"])
    b = mtext_mleader(c, char_height=7.0, arrow_size=8.0)
    b.multileader.dxf.property_override_flags = 0
    c.window(*W)
    c = _new(s, "mleader-override-landing-gap-only", "MULTILEADER landing gap 5 (style 2), 90 = bit 5 only",
             tags=["MULTILEADER", "override"], questions=["Q-0592"])
    b = mtext_mleader(c, landing_gap=5.0)
    b.multileader.dxf.property_override_flags = 1 << 5
    c.window(*W)
    # sparse MLEADERSTYLE
    c = _new(s, "mleader-sparse-style", "MULTILEADER using MLEADERSTYLE SPARSE that keeps only 170/3/342 (byte filter)",
             tags=["MULTILEADER", "MLEADERSTYLE", "sparse"], questions=["Q-0593"])
    st = c.doc.mleader_styles.duplicate_entry("Standard", "SPARSE")
    mtext_mleader(c, mstyle="SPARSE")
    c.byte_filters.append(keep_object_codes("MLEADERSTYLE", st.dxf.handle, keep=[170, 3, 342]))
    c.notes.append("all MLEADERSTYLE SPARSE codes except 170 (content type), 3 (description), 342 (text style) removed")
    c.window(*W)
    # draw order flags of the style
    for v in (0, 1):
        c = _new(s, f"mleader-style-171-{v}", f"MULTILEADER block content (filled) overlapping the leader line, MLEADERSTYLE 171={v}",
                 tags=["MULTILEADER", "MLEADERSTYLE", "draw-order"], questions=["Q-0594"], style_table="acad.ctb")
        st = c.doc.mleader_styles.duplicate_entry("Standard", "ORDER")
        st.dxf.draw_mleader_order_type = v
        # the leader line from the tip (150,70) to the left connection point crosses the filled block
        block_mleader(c, block=_content_block(c, "FILLED", filled=True), mstyle="ORDER", verts=((150, 70),), insert=(120, 90))
        c.window(*W)
        c = _new(s, f"mleader-style-172-{v}", f"MULTILEADER two 1.00 mm leader lines (red/blue, arrow size 12); blue arrow tip lies on the red line, MLEADERSTYLE 172={v}",
                 tags=["MULTILEADER", "MLEADERSTYLE", "draw-order"], questions=["Q-0595"], style_table="acad.ctb")
        st = c.doc.mleader_styles.duplicate_entry("Standard", "ORDER")
        st.dxf.draw_leader_order_type = v
        b = c.msp.add_multileader_mtext("ORDER")
        b.set_content("ORDER", char_height=4)
        b.set_leader_properties(lineweight=100)
        b.set_arrow_properties(size=12.0)
        b.add_leader_line(ml.ConnectionSide.left, [Vec2(30, 40), Vec2(90, 40)])
        # line 2's arrow tip lies on line 1's horizontal segment
        b.add_leader_line(ml.ConnectionSide.left, [Vec2(60, 40), Vec2(60, 75)])
        b.build(insert=Vec2(110, 90))
        # per-line colours: line 1 red, line 2 blue
        lines_ = b.multileader.context.leaders[0].lines
        lines_[0].color = colors.encode_raw_color(1)
        lines_[1].color = colors.encode_raw_color(5)
        c.window(*W)
    # breaks
    c = _new(s, "mleader-leader-line-break", "MULTILEADER straight leader line with a break (90/11/12) in the middle",
             tags=["MULTILEADER", "break"], questions=["Q-0598"])
    b = mtext_mleader(c)
    line = b.multileader.context.leaders[0].lines[0]
    tip = line.vertices[0]
    last = b.multileader.context.leaders[0].last_leader_point
    d = last - tip
    line.breaks = [0, tip + d * 0.4, tip + d * 0.6]
    c.window(*W)
    c = _new(s, "mleader-dogleg-break", "MULTILEADER with a dogleg break (LEADER 12/13) over the middle of the dogleg",
             tags=["MULTILEADER", "break", "dogleg"], questions=["Q-0598"])
    b = mtext_mleader(c, dogleg=20.0)
    ld = b.multileader.context.leaders[0]
    p = ld.last_leader_point
    ld.breaks = [p + Vec3(6, 0, 0), p + Vec3(14, 0, 0)]
    c.window(*W)
    # overall scale
    for sc in (0.5, 2.0):
        c = _new(s, f"mleader-scale-{sc:g}".replace(".", "p"), f"MULTILEADER overall scale {sc:g} (text, arrow, gap, dogleg scaled)",
                 tags=["MULTILEADER", "scale"], params={"scale": sc})
        b = c.msp.add_multileader_mtext("Standard")
        b.set_content("SCALED", char_height=4)
        b.set_overall_scaling(sc)
        b.add_leader_line(ml.ConnectionSide.left, [Vec2(40, 40)])
        b.build(insert=Vec2(110, 90))
        c.window(*W)
    c = _new(s, "mleader-rotated-30", "MULTILEADER MTEXT content rotated 30°", tags=["MULTILEADER", "rotation"])
    mtext_mleader(c, rotation=30.0, insert=(100, 80))
    c.window(*W)
    # block content
    for al in (ml.BlockAlignment.center_extents, ml.BlockAlignment.insertion_point):
        c = _new(s, f"mleader-block-{al.name.replace('_', '-')}", f"MULTILEADER block content (circle r=8), connection {al.name} (176={int(al)})",
                 tags=["MULTILEADER", "block"], params={"alignment": al.name})
        block_mleader(c, alignment=al)
        c.window(*W)
    c = _new(s, "mleader-block-attribute", "MULTILEADER block content with attribute NUM='42'", tags=["MULTILEADER", "block", "ATTRIB"])
    block_mleader(c, block=_content_block(c, "MLATT", attdef=True), attrib="42")
    c.window(*W)
    c = _new(s, "mleader-block-color-scale", "MULTILEADER block content color 1, block scale 1.5", tags=["MULTILEADER", "block"],
             style_table="acad.ctb")
    block_mleader(c, scale=1.5, color=1)
    c.window(*W)


TOL_1ROW = "X%%v0.1%%vA"
TOL_2ROW = "X%%v0.1%%vA^JY%%v0.2%%vB"


def tolerance(c, content, insert=(40, 90), xdir=(1, 0, 0), dimstyle="Standard"):
    return c.msp.new_entity("TOLERANCE", {"dimstyle": dimstyle, "insert": Vec3(insert), "content": content,
                                          "x_axis_vector": Vec3(xdir)})


def _tolerances(s):
    cases = [
        ("tol-1row", "1 row", TOL_1ROW, {}),
        ("tol-2rows", "2 rows, different first cells", TOL_2ROW, {}),
        ("tol-1row-dimgap-2", "1 row, DIMGAP 2", TOL_1ROW, {"dimgap": 2.0}),
        ("tol-1row-dimgap-0p5", "1 row, DIMGAP 0.5", TOL_1ROW, {"dimgap": 0.5}),
        ("tol-1row-dimtxt-6", "1 row, DIMTXT 6", TOL_1ROW, {"dimtxt": 6.0}),
        ("tol-1row-dimscale-2", "1 row, DIMTXT 2.5 DIMGAP 0.625 DIMSCALE 2", TOL_1ROW, {"dimtxt": 2.5, "dimgap": 0.625, "dimscale": 2.0}),
        ("tol-2rows-dimscale-2", "2 rows, DIMTXT 2.5 DIMGAP 0.625 DIMSCALE 2", TOL_2ROW, {"dimtxt": 2.5, "dimgap": 0.625, "dimscale": 2.0}),
        ("tol-composite", "2 rows sharing the first cell 'X' (composite frame?)", "X%%v0.1%%vA^JX%%v0.05%%vB", {}),
        ("tol-4rows", "rows 1-2 + projected zone value row 3 '5' + datum identifier row 4 'D'", TOL_2ROW + "^J5^JD", {}),
        ("tol-row2-empty", "row 1, empty row 2, row 3 '5', row 4 'D'", TOL_1ROW + "^J^J5^JD", {}),
        ("tol-datum-only", "datum identifier only (rows 1-3 empty, row 4 'A')", "^J^J^JA", {}),
        ("tol-many-cells", "1 row with 6 cells", "X%%v0.1%%v0.2%%vA%%vB%%vC", {}),
    ]
    for name, desc, content, ov in cases:
        qs = ["Q-0602"]
        if name in ("tol-4rows", "tol-row2-empty", "tol-datum-only"):
            qs = ["Q-0603"]
        if name == "tol-composite":
            qs = ["Q-0604"]
        c = _new(s, name, f"TOLERANCE {desc}: {content!r} (plain letters, no GDT font)",
                 tags=["TOLERANCE"], questions=qs, style=ov, params={"content": content, **ov})
        tolerance(c, content)
        c.window(*W)
    c = _new(s, "tol-colors", "TOLERANCE 2 rows with DSTYLE DIMCLRD=1, DIMCLRT=3 (frame vs text colour)",
             tags=["TOLERANCE", "color", "DSTYLE"], questions=["Q-0605"], style_table="acad.ctb")
    t = tolerance(c, TOL_2ROW)
    _dstyle(t, [(176, 1), (178, 3)])
    c.window(*W)
    c = _new(s, "tol-dstyle-dimtxt", "TOLERANCE 1 row with DSTYLE DIMTXT=6 (override via XDATA)", tags=["TOLERANCE", "DSTYLE"],
             questions=["Q-0602"])
    t = tolerance(c, TOL_1ROW)
    _dstyle(t, [(140, 6.0)])
    c.window(*W)
    c = _new(s, "tol-rotated-30", "TOLERANCE 2 rows rotated 30° (11 = x-axis direction)", tags=["TOLERANCE", "rotation"])
    a = math.radians(30)
    tolerance(c, TOL_2ROW, insert=(50, 50), xdir=(math.cos(a), math.sin(a), 0))
    c.window(*W)
    c = _new(s, "tol-lato", "TOLERANCE 2 rows with DIMTXSTY = Lato style", tags=["TOLERANCE", "font"])
    c.style("LATO", font=TTF_FONTS["lato"])
    setup_dimstyle(c, values={"dimtxsty": "LATO"}, sync_header=False, text_style="LATO")
    tolerance(c, TOL_2ROW)
    c.window(*W)


def _random(s):
    for seed in range(1, 5):
        c = _new(s, f"random-leader-{seed:04d}", f"Random LEADER (straight/spline, random vertices, arrow, size), seed {seed}",
                 tags=["LEADER", "random"], seed=seed)
        rng = c.rng
        n = rng.randint(2, 5)
        verts = [(rng.uniform(20, 180), rng.uniform(20, 130)) for _ in range(n)]
        ov = {"dimasz": rng.choice([3.0, 4.0, 6.0]), "dimldrblk": rng.choice(["", "DOT", "OPEN", "ARCHTICK"])}
        leader(c, verts, override=ov, path_type=rng.choice([0, 0, 1]))
        c.params.update({"vertices": verts, "override": ov})
        c.window(*W)
    for seed in range(1, 5):
        c = _new(s, f"random-mleader-{seed:04d}", f"Random MULTILEADER (text, leader lines, dogleg, arrow), seed {seed}",
                 tags=["MULTILEADER", "random"], seed=seed)
        rng = c.rng
        insert = (rng.uniform(90, 130), rng.uniform(70, 110))
        lines = [(ml.ConnectionSide.left, [(rng.uniform(20, 70), rng.uniform(15, 135))]) for _ in range(rng.randint(1, 3))]
        mtext_mleader(c, content=rng.choice(["A", "NOTE 1", "Two\\PLines"]), insert=insert, lines=lines,
                      dogleg=rng.choice([0.0, 5.0, 10.0]), landing_gap=rng.choice([1.0, 2.0, 3.0]),
                      char_height=rng.choice([3.0, 4.0, 5.0]), arrow=rng.choice(["", "DOT", "OPEN30"]),
                      arrow_size=rng.choice([3.0, 4.0]))
        c.params.update({"insert": insert, "lines": [l[1] for l in lines]})
        c.window(*W)
