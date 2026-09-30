"""XCLIP: SPATIAL_FILTER clip boundaries on INSERTs - rectangles, polygons, transformed and nested
inserts, MINSERT, $XCLIPFRAME, clip disabled, front/back clip planes (note 07 §7, 11a §13)."""

from __future__ import annotations

import math

from ezdxf.math import Matrix44, OCS, Vec3
from ezdxf.xclip import XClip

from ..core import SuiteBuilder, suite
from ._blocks_util import F_OUTLINE, cross


def _grid_block(doc, name: str = "G"):
    """80 x 60 block: border, 10-unit grid, diagonals, circle r=22, F outline. Base (0,0)."""
    blk = doc.blocks.new(name)
    blk.add_lwpolyline([(0, 0), (80, 0), (80, 60), (0, 60)], close=True)
    for x in range(10, 80, 10):
        blk.add_line((x, 0), (x, 60))
    for y in range(10, 60, 10):
        blk.add_line((0, y), (80, y))
    blk.add_line((0, 0), (80, 60))
    blk.add_line((0, 60), (80, 0))
    blk.add_circle((40, 30), 22)
    blk.add_lwpolyline([(x * 0.6 + 5, y * 0.6 + 15) for x, y in F_OUTLINE], close=True)
    return blk


def clip_block(ins, pts) -> None:
    """ezdxf style: boundary in block coordinates, both matrices identity."""
    XClip(ins).set_block_clipping_path(pts)


def clip_acad(ins, wcs_pts, clip_matrix=None) -> None:
    """AutoCAD style: boundary = picked (WCS/OCS) points, inverse_insert_matrix = inverse of the
    INSERT transform at clip time (optionally a matrix of an earlier INSERT state)."""
    xc = XClip(ins)
    xc.set_block_clipping_path([(0, 0), (1, 1)])  # creates the structure with sane defaults
    sf = xc.get_spatial_filter()
    sf.set_boundary_vertices(wcs_pts)
    m = (clip_matrix if clip_matrix is not None else ins.matrix44()).copy()
    m.inverse()
    sf.set_inverse_insert_matrix(m)
    sf.dxf.extrusion = ins.dxf.extrusion


def fit_clip(c, ins, extra=(), m=None) -> None:
    """Window around the WCS clip polygon (per ezdxf's reading of the SPATIAL_FILTER) plus
    ``extra`` points; ``m`` = additional parent matrix for nested inserts."""
    pts = [Vec3(v) for v in XClip(ins).get_wcs_clipping_path().vertices]
    if m is not None:
        pts = list(m.transform_vertices(pts))
    pts += [Vec3(p) for p in extra]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    c.fit((min(xs), min(ys)), (max(xs), max(ys)), margin=0.15)


def _case(s, name, title, *, questions=(), frame=0, **kw):
    header = dict(kw.pop("header", {}))
    header.setdefault("$XCLIPFRAME", frame)
    return s.case(name, title, tags=["INSERT", "XCLIP", "SPATIAL_FILTER"] + kw.pop("tags", []), questions=list(questions), header=header, **kw)


RECT = [(10, 10), (60, 45)]
PENTA = [(40 + 28 * math.cos(math.radians(90 + 72 * k)), 30 + 28 * math.sin(math.radians(90 + 72 * k))) for k in range(5)]
CONCAVE = [(5, 5), (75, 5), (75, 25), (40, 25), (40, 55), (5, 55)]


@suite("xclip", "XCLIP / SPATIAL_FILTER clipped block references", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    # --- basic boundaries, block-coordinate (ezdxf) vs AutoCAD-style storage
    c = _case(s, "rect-block", "Rectangular 2-point XCLIP (10,10)-(60,45) stored in block coords (identity matrices), INSERT at (60,45)", questions=["Q-0632"])
    _grid_block(c.doc)
    clip_block(c.msp.add_blockref("G", (60, 45)), RECT)
    cross(c, (60, 45))
    c.window((0, 0), (200, 150))

    c = _case(s, "rect-acad", "Same clip stored AutoCAD-style: WCS pick points + inverse INSERT matrix (translation -60,-45)", questions=["Q-0632"])
    _grid_block(c.doc)
    ins = c.msp.add_blockref("G", (60, 45))
    clip_acad(ins, [(70, 55), (120, 90)])
    cross(c, (60, 45))
    c.window((0, 0), (200, 150))

    c = _case(s, "rect-4pt", "Rectangle given as 4-point polygon (not 2 corners), block coords", questions=["Q-0632"])
    _grid_block(c.doc)
    clip_block(c.msp.add_blockref("G", (60, 45)), [(10, 10), (60, 10), (60, 45), (10, 45)])
    c.window((0, 0), (200, 150))

    for key, pts in (("penta", PENTA), ("concave", CONCAVE), ("closed-repeat", CONCAVE + CONCAVE[:1])):
        c = _case(s, f"polygon-{key}", f"Polygonal XCLIP ({key}{', first vertex repeated' if key == 'closed-repeat' else ''}) in block coords", questions=["Q-0632"], params={"boundary": [list(p) for p in pts]})
        _grid_block(c.doc)
        clip_block(c.msp.add_blockref("G", (60, 45)), pts)
        c.window((0, 0), (200, 150))

    # --- clip in block coords on transformed inserts (clip follows the block)
    xforms = [
        ("rot30", {"rotation": 30}),
        ("scale15", {"xscale": 1.5, "yscale": 1.5}),
        ("mirror", {"xscale": -1}),
        ("nonuniform", {"xscale": 2, "yscale": 0.8, "rotation": -15}),
        ("negz", {"extrusion": (0, 0, -1)}),
    ]
    for key, attrs in xforms:
        c = _case(s, f"block-coords-{key}", f"Concave XCLIP in block coords on an INSERT with {attrs}", questions=["Q-0632"], params={"insert": attrs})
        _grid_block(c.doc)
        a = dict(attrs)
        p = Vec3(100, 50, 0) if "xscale" not in a or a["xscale"] > 0 else Vec3(140, 50, 0)
        if "extrusion" in a:
            p = OCS(a["extrusion"]).from_wcs(Vec3(140, 40, 0))
        ins = c.msp.add_blockref("G", p, dxfattribs=a)
        clip_block(ins, CONCAVE)
        fit_clip(c, ins)

    # --- AutoCAD storage: clip made on a plain INSERT, then the INSERT is transformed
    for key, attrs, newpos in (
        ("moved", {}, (110, 70)),
        ("rotated", {"rotation": 30}, (110, 50)),
        ("mirrored", {"xscale": -1, "rotation": 10}, (150, 50)),
        ("scaled", {"xscale": 1.5, "yscale": 1.5}, (80, 30)),
        ("nonuniform", {"xscale": 2, "yscale": 0.7}, (30, 40)),
    ):
        c = _case(s, f"after-clip-{key}", f"Clip made AutoCAD-style on the INSERT at (20,20); INSERT then {key} to {newpos} {attrs} (SPATIAL_FILTER unchanged)", questions=["Q-0632"], params={"insert_after": attrs, "position": newpos})
        _grid_block(c.doc)
        ins = c.msp.add_blockref("G", (20, 20))
        clip_acad(ins, [(p[0] + 20, p[1] + 20) for p in PENTA])
        ins.dxf.insert = newpos
        for k, v in attrs.items():
            ins.dxf.set(k, v)
        cross(c, newpos)
        fit_clip(c, ins, [newpos])

    # --- clip made on an already transformed insert (inverse matrix contains the transform)
    for key, attrs in (("scaled", {"xscale": 0.5, "yscale": 1}), ("rot-scaled", {"xscale": 1.5, "yscale": 1.5, "rotation": 20})):
        c = _case(s, f"made-on-{key}", f"Clip made AutoCAD-style on an INSERT {attrs}: WCS pick rectangle (70,50)-(110,90) + inverse of that INSERT matrix", questions=["Q-0632"], params={"insert": attrs})
        _grid_block(c.doc)
        ins = c.msp.add_blockref("G", (60, 40), dxfattribs=attrs)
        clip_acad(ins, [(70, 50), (110, 90)])
        fit_clip(c, ins)

    # --- nested clips
    c = _case(s, "nested", "Clipped child INSERT (concave clip) inside a block whose INSERT is clipped by a rectangle", questions=["Q-0635"])
    _grid_block(c.doc)
    par = c.doc.blocks.new("PAR")
    par.add_lwpolyline([(-10, -10), (130, -10), (130, 90), (-10, 90)], close=True)
    child = par.add_blockref("G", (0, 0), dxfattribs={"rotation": 10, "xscale": 1.2, "yscale": 1.2})
    clip_block(child, CONCAVE)
    clip_block(c.msp.add_blockref("PAR", (40, 30)), [(20, 15), (110, 75)])
    c.window((0, 0), (200, 150))

    c = _case(s, "nested-child-only", "Clipped child INSERT (pentagon) inside an unclipped parent INSERT rot 20 scale 1.2", questions=["Q-0635"])
    _grid_block(c.doc)
    par = c.doc.blocks.new("PAR")
    par.add_circle((0, 0), 3)
    child = par.add_blockref("G", (0, 0))
    clip_block(child, PENTA)
    pins = c.msp.add_blockref("PAR", (70, 30), dxfattribs={"rotation": 20, "xscale": 1.2, "yscale": 1.2})
    fit_clip(c, child, [(70, 30)], m=pins.matrix44())

    # --- $XCLIPFRAME (R2018: 280) and clip enabled flag
    for frame in (0, 1, 2):
        c = _case(s, f"xclipframe-{frame}", f"Pentagon XCLIP, $XCLIPFRAME {frame} (R2018, group 280)", questions=["Q-0628"], frame=frame, params={"xclipframe": frame})
        _grid_block(c.doc)
        clip_block(c.msp.add_blockref("G", (60, 45)), PENTA)
        c.window((0, 0), (200, 150))
    for frame in (1, 2):
        c = _case(s, f"disabled-frame-{frame}", f"Pentagon XCLIP with clipping disabled (71=0), $XCLIPFRAME {frame}", questions=["Q-0628"], frame=frame, params={"xclipframe": frame, "enabled": 0})
        _grid_block(c.doc)
        ins = c.msp.add_blockref("G", (60, 45))
        clip_block(ins, PENTA)
        XClip(ins).disable_clipping()
        c.window((0, 0), (200, 150))

    for ver in ("R2004", "R2007"):
        for frame in (1, 2):
            c = _case(
                s, f"{ver.lower()}-xclipframe-{frame}",
                f"{ver} DXF, pentagon XCLIP, $XCLIPFRAME 290 = {frame}" + (" (2 is out of range for the bool: may be rejected)" if frame == 2 else ""),
                questions=["Q-0629"], frame=frame, dxfversion=ver, params={"xclipframe": frame},
            )
            _grid_block(c.doc)
            clip_block(c.msp.add_blockref("G", (60, 45)), PENTA)
            c.window((0, 0), (200, 150))

    for hv, dv in ((0, 1), (1, 0), (2, 1)):
        c = _case(s, f"dictvar-h{hv}-d{dv}", f"$XCLIPFRAME {hv} in the header but DICTIONARYVAR XCLIPFRAME = {dv}; pentagon XCLIP", questions=["Q-0630"], frame=hv, params={"header": hv, "dictvar": dv})
        vd = c.doc.rootdict.get_required_dict("AcDbVariableDictionary")
        vd.set_or_add_dict_var("XCLIPFRAME", str(dv))
        _grid_block(c.doc)
        clip_block(c.msp.add_blockref("G", (60, 45)), PENTA)
        c.window((0, 0), (200, 150))

    for key, attrs in (("bylayer", {}), ("explicit", {"color": 3, "linetype": "HIDDEN", "lineweight": 100})):
        c = _case(s, f"frame-props-{key}", f"XCLIP frame ($XCLIPFRAME 1) of an INSERT on layer RED (lw 0.50, DASHED), INSERT props {key}", questions=["Q-0631"], frame=1, style_table="acad.ctb", params={"insert": attrs})
        c.linetype("HIDDEN")
        c.layer("RED", color=1, linetype="DASHED", lineweight=50)
        _grid_block(c.doc)
        clip_block(c.msp.add_blockref("G", (60, 45), dxfattribs={"layer": "RED", **attrs}), PENTA)
        c.window((0, 0), (200, 150))

    # --- inverted clip (ezdxf's experimental writer; AutoCAD reportedly refuses these files)
    c = _case(s, "inverted-ezdxf", "Inverted XCLIP written by ezdxf (ACAD_XREC_ROUNDTRIP xrecord; AutoCAD reportedly refuses the file - check the log)", questions=["Q-0633"])
    _grid_block(c.doc)
    ins = c.msp.add_blockref("G", (60, 45))
    xc = XClip(ins)
    xc.set_block_clipping_path([(25, 15), (55, 45)])
    xc.invert_clipping_path(extents=[(-5, -5), (85, 65)], ignore_acad_compatibility=True)
    c.window((0, 0), (200, 150))

    # --- second matrix (clip-boundary transform) non-identity
    for key, pts in (("rect", [(-20, -12), (20, 12)]), ("polygon", [(-25, -15), (25, -15), (0, 20)])):
        c = _case(s, f"transform-matrix-{key}", f"SPATIAL_FILTER 2nd matrix = rotation -30 deg about the block point (40,30), boundary {key} given in that clip system (honoured -> clip rotated +30 deg)", questions=["Q-0634"], params={"boundary": pts})
        _grid_block(c.doc)
        ins = c.msp.add_blockref("G", (60, 45))
        clip_block(ins, pts)
        sf = XClip(ins).get_spatial_filter()
        t = Matrix44.chain(Matrix44.translate(-40, -30, 0), Matrix44.z_rotate(math.radians(-30)))
        sf.set_transform_matrix(t)
        c.window((0, 0), (200, 150))

    # --- MINSERT
    c = _case(s, "minsert", "2x2 MINSERT (spacing 90 x 70) of the grid block with a rectangular SPATIAL_FILTER (10,10)-(60,45)", questions=["Q-0636"], tags=["MINSERT"])
    _grid_block(c.doc)
    ins = c.msp.add_blockref("G", (5, 5), dxfattribs={"column_count": 2, "row_count": 2, "column_spacing": 90, "row_spacing": 70})
    clip_block(ins, RECT)
    c.window((0, 0), (200, 150))

    # --- ATTRIB outside the clip
    c = _case(s, "attrib-outside", "Clipped INSERT whose ATTRIBs lie inside and outside the clip boundary", questions=["Q-0637"], tags=["ATTRIB"])
    blk = _grid_block(c.doc)
    blk.add_attdef("IN", (15, 30), height=5)
    blk.add_attdef("OUT", (5, 62), height=5)
    ins = c.msp.add_blockref("G", (60, 45))
    ins.add_attrib("IN", "inside Ag", (75, 75), dxfattribs={"height": 5})
    ins.add_attrib("OUT", "outside Ag", (65, 110), dxfattribs={"height": 5})
    clip_block(ins, RECT)
    c.window((0, 0), (200, 150))

    # --- front/back clipping planes along the clip normal
    for key, front, back in (("front", 2.0, None), ("back", None, -2.0), ("both", 2.0, -2.0)):
        c = _case(s, f"frontback-{key}", f"Block with lines at z=-8,-4,0,4,8 (rows) and a ramp z -10..10; rect XCLIP with front clip {front} / back clip {back}", questions=["Q-0638"], tags=["3d"], params={"front": front, "back": back})
        blk = c.doc.blocks.new("Z")
        for k, z in enumerate((-8, -4, 0, 4, 8)):
            blk.add_line((0, 10 + 10 * k, z), (80, 10 + 10 * k, z))
            blk.add_circle((90, 10 + 10 * k, z), 3)
        blk.add_line((0, 0, -10), (80, 0, 10))
        ins = c.msp.add_blockref("Z", (50, 40))
        clip_block(ins, [(-5, -5), (100, 65)])
        sf = XClip(ins).get_spatial_filter()
        if front is not None:
            sf.dxf.has_front_clipping_plane = 1
            sf.dxf.front_clipping_plane_distance = front
        if back is not None:
            sf.dxf.has_back_clipping_plane = 1
            sf.dxf.back_clipping_plane_distance = back
        c.window((0, 0), (200, 150))

    # --- clipping of fills, wide polylines and text
    c = _case(s, "fills", "Pentagon XCLIP over a block with a SOLID hatch, ANSI31 hatch, wide LWPOLYLINE and TEXT", tags=["HATCH", "LWPOLYLINE", "TEXT"])
    blk = c.doc.blocks.new("FL")
    h = blk.add_hatch(color=7)
    h.paths.add_polyline_path([(0, 0), (40, 0), (40, 60), (0, 60)], is_closed=True)
    h = blk.add_hatch()
    h.set_pattern_fill("ANSI31", scale=1)
    h.paths.add_polyline_path([(40, 0), (80, 0), (80, 60), (40, 60)], is_closed=True)
    blk.add_lwpolyline([(0, 30), (80, 30)], dxfattribs={"const_width": 6})
    blk.add_text("CLIP Fg", height=12).set_placement((5, 40))
    clip_block(c.msp.add_blockref("FL", (60, 45)), PENTA)
    c.window((0, 0), (200, 150))

    # --- seeded random convex/star polygons on random transforms
    for seed in range(1, 5):
        c = _case(s, f"random-{seed:04d}", f"Random polygonal XCLIP (block coords) on a random INSERT transform, seed {seed}", seed=seed)
        rng = c.rng
        _grid_block(c.doc)
        n = rng.randint(3, 9)
        angs = sorted(rng.uniform(0, math.tau) for _ in range(n))
        star = rng.random() < 0.5
        pts = []
        for k, a in enumerate(angs):
            r = rng.uniform(15, 30) * (0.5 if star and k % 2 else 1)
            pts.append((40 + r * math.cos(a), 30 + r * math.sin(a)))
        sc = rng.choice([1, 1.2, -1])
        ins = c.msp.add_blockref("G", (100, 60), dxfattribs={"rotation": rng.uniform(-45, 45), "xscale": sc, "yscale": rng.choice([1, 0.8, 1.3])})
        clip_block(ins, pts)
        c.params["boundary"] = [[round(x, 6), round(y, 6)] for x, y in pts]
        fit_clip(c, ins)
