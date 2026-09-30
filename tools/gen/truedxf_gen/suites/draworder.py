"""Draw order: file order vs handle order, SORTENTSTABLE semantics ($SORTENTS, sort handle 0,
unlisted/duplicate/invalid entries, hex comparison), block SORTENTSTABLE, INSERT atomicity,
ATTRIBs after block content, fills vs lines/MTEXT, MTEXT background, paper space vs viewports
(note 06 §8; note 02 §3.12; note 07 §3.2; note 08 §3.10)."""

from __future__ import annotations

from ezdxf.enums import TextEntityAlignment

from ..core import SuiteBuilder, suite
from ._appearance_util import hatch_rect, label, solid_rect

# three overlapping squares: A red (lower left), B green (middle), C blue (upper right)
SQUARES = {"A": ((15, 15, 105, 105), 1), "B": ((55, 35, 145, 125), 3), "C": ((95, 55, 185, 145), 5)}


def _abc(c, space, kind: str = "hatch", names: str = "ABC") -> dict:
    """Create the overlapping squares in the order given by ``names``; return name -> entity."""
    out = {}
    for n in names:
        (x0, y0, x1, y1), col = SQUARES[n]
        f = hatch_rect if kind == "hatch" else solid_rect
        out[n] = f(space, x0, y0, x1, y1, {"color": col})
    return out


def _move_to_end(space, *ents) -> None:
    """Re-append entities at the end of the layout's entity list: file order changes, handles don't."""
    for e in ents:
        space.unlink_entity(e)
        space.add_entity(e)


def _record(c, ents: dict, table=None) -> None:
    c.params["handles"] = {n: e.dxf.handle for n, e in ents.items()}
    c.params["file_order"] = [n for n, _ in sorted(ents.items(), key=lambda kv: _pos(c, kv[1]))]
    if table is not None:
        c.params["sortents"] = {k: v for k, v in table}


def _pos(c, e) -> int:
    owner = e.dxf.owner
    for layout in [c.msp, *[c.doc.blocks.get(b.name) for b in c.doc.blocks]]:
        if layout.block_record_handle == owner:
            return list(layout).index(e)
    return -1


def _viewport_case(c, ps_first: bool, flags: int = 688, sortents: bool = False) -> None:
    psp = c.doc.layout("Layout1")
    psp.reset_main_viewport()
    psp.dxf.plot_layout_flags = flags
    hatch_rect(c.msp, 60, 40, 140, 110, {"color": 5})  # model content: blue square
    c.msp.add_line((20, 75), (180, 75), dxfattribs={"color": 3, "lineweight": 100})
    red = None
    if not ps_first:
        vp = psp.add_viewport(center=(100, 75), size=(120, 90), view_center_point=(100, 75), view_height=90)
    red = hatch_rect(psp, 20, 20, 110, 95, {"color": 1})
    if ps_first:
        vp = psp.add_viewport(center=(100, 75), size=(120, 90), view_center_point=(100, 75), view_height=90)
    c.params["paperspace_order"] = [e.dxftype() for e in psp]
    c.params["plot_layout_flags"] = flags
    if sortents:
        psp.set_redraw_order([(vp.dxf.handle, "FFFFF")])
        c.params["sortents"] = {vp.dxf.handle: "FFFFF"}
    c.layout_window("Layout1", (0, 0), (200, 150))


@suite("draworder", "Draw order: file/handle order, SORTENTSTABLE, blocks, INSERTs, ATTRIBs, viewports", style_table="acad.ctb")
def build(s: SuiteBuilder) -> None:
    # --- base order
    c = s.case("baseline-file-order", "Overlapping HATCH squares A red, B green, C blue; file order = handle order A,B,C; no SORTENTSTABLE", tags=["HATCH", "draw-order"], questions=["Q-0286"])
    _record(c, _abc(c, c.msp))
    c.window((0, 0), (200, 150))
    for kind in ("solid", "hatch"):
        c = s.case(f"file-vs-handle-{kind}", f"Overlapping {kind.upper()} squares created A,B,C (handle order) but written C,A,B (file order); no SORTENTSTABLE", tags=[kind.upper(), "draw-order"], questions=["Q-0286"])
        ents = _abc(c, c.msp, kind)
        _move_to_end(c.msp, ents["A"], ents["B"])
        _record(c, ents)
        c.window((0, 0), (200, 150))
    c = s.case("file-vs-handle-reversed", "Overlapping HATCH squares created A,B,C, written in reverse file order C,B,A; no SORTENTSTABLE", tags=["HATCH", "draw-order"], questions=["Q-0286"])
    ents = _abc(c, c.msp)
    _move_to_end(c.msp, ents["B"], ents["A"])
    _record(c, ents)
    c.window((0, 0), (200, 150))

    # --- SORTENTSTABLE reorder C,A,B (rotated handles, like DRAWORDER) with $SORTENTS values
    for se in (127, 95, 111, 0):
        c = s.case(f"sortents-{se:03d}", f"HATCH squares A,B,C reordered to C,A,B via SORTENTSTABLE (rotated handles); $SORTENTS={se}", tags=["HATCH", "draw-order", "SORTENTSTABLE", "SORTENTS"], questions=["Q-0288", "Q-0289"], header={"$SORTENTS": se}, params={"sortents_var": se, "expected_sorted": ["C", "A", "B"]})
        ents = _abc(c, c.msp)
        h = {n: e.dxf.handle for n, e in ents.items()}
        table = [(h["C"], h["A"]), (h["A"], h["B"]), (h["B"], h["C"])]
        c.msp.set_redraw_order(table)
        _record(c, ents, table)
        c.window((0, 0), (200, 150))

    # --- SORTENTSTABLE corner cases
    c = s.case("sortents-zero-handle", "SORTENTSTABLE maps A to sort handle '0' (drawn last?); B, C unlisted", tags=["HATCH", "draw-order", "SORTENTSTABLE"], questions=["Q-0289"])
    ents = _abc(c, c.msp)
    table = [(ents["A"].dxf.handle, "0")]
    c.msp.set_redraw_order(table)
    _record(c, ents, table)
    c.window((0, 0), (200, 150))
    c = s.case("sortents-unlisted", "SORTENTSTABLE lists only A, with a sort handle between B's and C's handles (B, C keyed by own handle)", tags=["HATCH", "draw-order", "SORTENTSTABLE"], questions=["Q-0289"])
    ents = _abc(c, c.msp, names="AB")
    spacer = label(c, c.msp, "sort(A) between B and C", 100, 5)  # its handle lies between B and C
    ents.update(_abc(c, c.msp, names="C"))
    table = [(ents["A"].dxf.handle, spacer.dxf.handle)]
    c.msp.set_redraw_order(table)
    _record(c, ents, table)
    c.params["expected_sorted"] = ["B", "A", "C"]
    c.window((0, 0), (200, 150))
    c = s.case("sortents-duplicate", "SORTENTSTABLE gives A, B, C the same sort handle; file order C,A,B != handle order A,B,C (tie-break?)", tags=["HATCH", "draw-order", "SORTENTSTABLE"], questions=["Q-0289"])
    ents = _abc(c, c.msp)
    _move_to_end(c.msp, ents["A"], ents["B"])
    table = [(ents[n].dxf.handle, "FFFF") for n in "ABC"]
    c.msp.set_redraw_order(table)
    _record(c, ents, table)
    c.window((0, 0), (200, 150))
    c = s.case("sortents-invalid-entity", "SORTENTSTABLE C,A,B reorder plus an entry for a non-existent entity handle (AutoCAD repair?)", tags=["HATCH", "draw-order", "SORTENTSTABLE", "invalid"], questions=["Q-0289"])
    ents = _abc(c, c.msp)
    h = {n: e.dxf.handle for n, e in ents.items()}
    table = [("FFFFF", h["A"]), (h["C"], h["A"]), (h["A"], h["B"]), (h["B"], h["C"])]
    c.msp.set_redraw_order(table)
    _record(c, ents, table)
    c.window((0, 0), (200, 150))
    c = s.case("sortents-hex-compare", "Sort handles A='FF', B='100', C='9': numeric order C,A,B vs string order B,C,A", tags=["HATCH", "draw-order", "SORTENTSTABLE"], questions=["Q-0289"], params={"numeric_order": ["C", "A", "B"], "string_order": ["B", "C", "A"]})
    ents = _abc(c, c.msp)
    table = [(ents["A"].dxf.handle, "FF"), (ents["B"].dxf.handle, "100"), (ents["C"].dxf.handle, "9")]
    c.msp.set_redraw_order(table)
    _record(c, ents, table)
    c.window((0, 0), (200, 150))

    # --- block-internal SORTENTSTABLE
    for with_table in (False, True):
        name = "block-sortents" if with_table else "block-file-order"
        title = "block SORTENTSTABLE reverses them (sort handles 3,2,1 != entity handles)" if with_table else "no block SORTENTSTABLE"
        c = s.case(name, f"Block with HATCH squares A,B,C in file order; {title}; one INSERT", tags=["INSERT", "HATCH", "draw-order", "SORTENTSTABLE"], questions=["Q-0290"])
        b = c.doc.blocks.new("ABC")
        ents = _abc(c, b)
        table = None
        if with_table:
            table = [(ents["A"].dxf.handle, "3"), (ents["B"].dxf.handle, "2"), (ents["C"].dxf.handle, "1")]
            b.set_redraw_order(table)
            c.params["expected_sorted"] = ["C", "B", "A"]
        _record(c, ents, table)
        c.msp.add_blockref("ABC", (0, 0))
        c.window((0, 0), (200, 150))

    # --- INSERT atomicity
    c = s.case("insert-atomic", "Two INSERTs of a block [big red square, then small yellow square]; 2nd INSERT's red covers 1st INSERT's yellow?", tags=["INSERT", "HATCH", "draw-order"])
    b = c.doc.blocks.new("PAIR")
    hatch_rect(b, 0, 0, 80, 80, {"color": 1})
    hatch_rect(b, 50, 50, 80, 80, {"color": 2})
    c.msp.add_blockref("PAIR", (20, 20))
    c.msp.add_blockref("PAIR", (80, 60), dxfattribs={"color": 0})
    c.window((0, 0), (200, 150))
    c = s.case("insert-sortents-between", "INSERT A (red), top-level green HATCH G, INSERT B (blue) in file order; SORTENTSTABLE puts G on top of B", tags=["INSERT", "HATCH", "draw-order", "SORTENTSTABLE"], questions=["Q-0289"])
    for nm, col in (("RB", 1), ("BB", 5)):
        blk = c.doc.blocks.new(nm)
        hatch_rect(blk, 0, 0, 90, 90, {"color": col})
    ia = c.msp.add_blockref("RB", (15, 15))
    g = hatch_rect(c.msp, 55, 35, 145, 125, {"color": 3})
    ib = c.msp.add_blockref("BB", (95, 55))
    table = [(g.dxf.handle, "FFFFF")]
    c.msp.set_redraw_order(table)
    c.params["handles"] = {"A": ia.dxf.handle, "G": g.dxf.handle, "B": ib.dxf.handle}
    c.params["sortents"] = dict(table)
    c.window((0, 0), (200, 150))

    # --- ATTRIBs after block content
    c = s.case("attrib-after-content", "Block: ATTDEF, TEXT, then a solid HATCH over both; INSERT with ATTRIB -> ATTRIB above the hatch, block TEXT hidden?", tags=["INSERT", "ATTRIB", "HATCH", "draw-order"], questions=["Q-0291"])
    b = c.doc.blocks.new("TAGGED")
    b.add_attdef("TAG", text="ATTRIB", height=18, dxfattribs={"color": 1}).set_placement((80, 90), align=TextEntityAlignment.MIDDLE_CENTER)
    b.add_text("TEXT", height=18, dxfattribs={"color": 1}).set_placement((80, 50), align=TextEntityAlignment.MIDDLE_CENTER)
    hatch_rect(b, 10, 30, 150, 110, {"color": 5})
    ins = c.msp.add_blockref("TAGGED", (20, 10))
    ins.add_auto_attribs({"TAG": "ATTRIB"})
    c.window((0, 0), (200, 150))
    c = s.case("attrib-vs-later-entity", "INSERT with ATTRIB, then a later top-level green HATCH covering half of the ATTRIB", tags=["INSERT", "ATTRIB", "HATCH", "draw-order"], questions=["Q-0291"])
    b = c.doc.blocks.new("TAGGED")
    b.add_attdef("TAG", text="ATTRIB", height=24, dxfattribs={"color": 1}).set_placement((80, 60), align=TextEntityAlignment.MIDDLE_CENTER)
    b.add_circle((80, 60), 55, dxfattribs={"color": 5, "lineweight": 100})
    ins = c.msp.add_blockref("TAGGED", (20, 15))
    ins.add_auto_attribs({"TAG": "ATTRIB"})
    hatch_rect(c.msp, 100, 5, 195, 145, {"color": 3})
    c.window((0, 0), (200, 150))

    # --- fills vs lines and MTEXT
    def grid_lines(c):
        for k in range(9):
            c.msp.add_line((10 + k * 22.5, 10), (10 + k * 22.5, 140), dxfattribs={"color": 7, "lineweight": 70})
        for k in range(6):
            c.msp.add_line((10, 10 + k * 26), (190, 10 + k * 26), dxfattribs={"color": 1, "lineweight": 70})

    for when in ("after", "before"):
        c = s.case(f"hatch-{when}-lines", f"Solid yellow HATCH written {when} a grid of 0.70 mm LINEs (no SORTENTSTABLE)", tags=["HATCH", "LINE", "draw-order"])
        if when == "before":
            hatch_rect(c.msp, 40, 30, 160, 120, {"color": 2})
        grid_lines(c)
        if when == "after":
            hatch_rect(c.msp, 40, 30, 160, 120, {"color": 2})
        c.window((0, 0), (200, 150))
    for when, table in (("after", False), ("before", False), ("before-sortents", True)):
        c = s.case(f"hatch-{when}-mtext", f"Solid yellow HATCH {when.replace('-', ' + ')} a large MTEXT 'MTEXT' (Liberation Sans)", tags=["HATCH", "MTEXT", "draw-order"] + (["SORTENTSTABLE"] if table else []), questions=["Q-0287"])
        h = None
        if when.startswith("before"):
            h = hatch_rect(c.msp, 30, 45, 170, 105, {"color": 2})
        mt = c.msp.add_mtext("MTEXT", dxfattribs={"char_height": 30, "color": 5})
        mt.set_location((100, 75), attachment_point=5)
        if when == "after":
            h = hatch_rect(c.msp, 30, 45, 170, 105, {"color": 2})
        if table:
            c.msp.set_redraw_order([(h.dxf.handle, "FFFFF")])
            c.params["sortents"] = {h.dxf.handle: "FFFFF"}
        c.window((0, 0), (200, 150))
    for bg in ("color", "canvas"):
        c = s.case(f"mtext-bgfill-{bg}", f"MTEXT with background fill ({'ACI 2' if bg == 'color' else 'canvas colour'}, scale 1.5) over earlier LINEs; a later LINE crosses it", tags=["MTEXT", "background-fill", "draw-order"])
        for k in range(7):
            c.msp.add_line((10, 20 + k * 18), (190, 20 + k * 18), dxfattribs={"color": 1, "lineweight": 50})
        mt = c.msp.add_mtext("BG FILL", dxfattribs={"char_height": 20, "color": 5})
        mt.set_location((100, 75), attachment_point=5)
        mt.set_bg_color(2 if bg == "color" else "canvas", scale=1.5)
        c.msp.add_line((20, 10), (180, 140), dxfattribs={"color": 3, "lineweight": 100})
        c.window((0, 0), (200, 150))

    # --- mixed fill types in file order
    c = s.case("mixed-fills-order", "Overlapping SOLID (red), wide LWPOLYLINE (green), solid HATCH (blue), TRACE (magenta), 2.11 mm LINE (yellow) in file order", tags=["SOLID", "LWPOLYLINE", "HATCH", "TRACE", "LINE", "draw-order"])
    solid_rect(c.msp, 15, 60, 95, 140, {"color": 1})
    c.msp.add_lwpolyline([(40, 100), (160, 100)], dxfattribs={"color": 3, "const_width": 30})
    hatch_rect(c.msp, 70, 50, 130, 125, {"color": 5})
    c.msp.add_trace([(90, 20), (190, 20), (90, 80), (190, 80)], dxfattribs={"color": 6})
    c.msp.add_line((10, 10), (190, 140), dxfattribs={"color": 2, "lineweight": 211})
    c.window((0, 0), (200, 150))

    # --- paper space vs viewport content (minimal; layouts suite owns the rest)
    c = s.case("ps-solid-after-viewport", "Layout1: VIEWPORT (model: blue square + green line) then PS red HATCH overlapping it; flags 688; 'paper space first' N", tags=["VIEWPORT", "paperspace", "HATCH", "draw-order"], questions=["Q-0292", "Q-0293"])
    _viewport_case(c, ps_first=False)
    c = s.case("ps-solid-before-viewport", "Layout1: PS red HATCH written before the VIEWPORT (model: blue square); flags 688; 'paper space first' N", tags=["VIEWPORT", "paperspace", "HATCH", "draw-order"], questions=["Q-0293"])
    _viewport_case(c, ps_first=True)
    c = s.case("ps-flags-176", "Layout1: VIEWPORT then PS red HATCH; PLOTSETTINGS 70=176 (bit 512 off); 'paper space first' N", tags=["VIEWPORT", "paperspace", "HATCH", "draw-order", "PLOTSETTINGS"], questions=["Q-0292"])
    _viewport_case(c, ps_first=False, flags=176)
    c = s.case("ps-paperspace-first", "Layout1: VIEWPORT then PS red HATCH; harness should answer 'Plot paper space first?' Y", tags=["VIEWPORT", "paperspace", "HATCH", "draw-order"], questions=["Q-0292"], params={"harness": {"paperSpaceFirst": True}})
    c.notes.append("Needs the harness to answer 'Plot paper space first?' with Y (params.harness.paperSpaceFirst).")
    _viewport_case(c, ps_first=False)
    c = s.case("ps-sortents-viewport-top", "Layout1: PS red HATCH then VIEWPORT; paper-space SORTENTSTABLE moves the VIEWPORT to the top", tags=["VIEWPORT", "paperspace", "HATCH", "draw-order", "SORTENTSTABLE"], questions=["Q-0293"])
    _viewport_case(c, ps_first=False, sortents=True)

    # --- random overlapping hatches, random file order and random SORTENTSTABLE
    for seed in range(1, 3):
        c = s.case(f"random-{seed:04d}", f"8 overlapping solid HATCHes, shuffled file order and random SORTENTSTABLE entries, seed {seed}", tags=["HATCH", "draw-order", "SORTENTSTABLE"], seed=seed)
        rng = c.rng
        ents = {}
        for k in range(8):
            x, y = rng.uniform(10, 120), rng.uniform(10, 80)
            ents[f"E{k}"] = hatch_rect(c.msp, x, y, x + rng.uniform(40, 70), y + rng.uniform(40, 60), {"color": [1, 2, 3, 4, 5, 6, 30, 200][k]})
        order = list(ents)
        rng.shuffle(order)
        _move_to_end(c.msp, *[ents[n] for n in order])
        table = [(ents[n].dxf.handle, f"{rng.randrange(0x20, 0x80):X}") for n in list(ents) if rng.random() < 0.5]
        c.msp.set_redraw_order(table)
        _record(c, ents, table)
        c.window((0, 0), (200, 150))
