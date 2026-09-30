"""IMAGE / IMAGEDEF / RASTERVARIABLES, WIPEOUT / WIPEOUTVARIABLES and PDF underlays
(note 07 §8–§10, note 06 §8.3, note 02 §3.6/§3.14/§3.15, note 11a §7, note 11c §1).

Raster sources are small deterministic PNG/TIFF files written next to each case
(`<case>-img.png`); IMAGEDEF paths are the absolute canonical paths returned by `c.add_file`
unless a case probes path resolution. Colour matters, so the suite plots with acad.ctb.
"""

from __future__ import annotations

import math

from ezdxf.math import Vec3

from ..core import Case, SuiteBuilder, suite
from . import _images_util as U

F_SIZE = (64, 48)
BASE_INSERT = (20.0, 15.0)
BASE_U = (2.5, 0.0, 0.0)
BASE_V = (0.0, 2.5, 0.0)
MISSING_DIR = "C:\\truedxf-missing-dir"


# --------------------------------------------------------------------------------------------
# helpers


def raster_vars(c: Case, frame: int = 1, quality: int = 1) -> None:
    """RASTERVARIABLES (ACAD_IMAGE_VARS): frame (IMAGEFRAME), quality, units mm (INSUNITS 4)."""
    c.doc.set_raster_variables(frame=1 if frame == 2 else frame, quality=quality, units="mm")
    if frame == 2:  # ezdxf validates 70 as bool; AutoCAD's IMAGEFRAME has 0/1/2
        c.doc.rootdict["ACAD_IMAGE_VARS"].dxf.unprotected_set("frame", 2)


def image_def(c: Case, im, fname: str | None = None, path: str | None = None, data: bytes | None = None, write: bool = True, name: str | None = None):
    """Write the bitmap as <case>-img.png (or `fname`) and add an IMAGEDEF for it. `path`
    overrides the stored file name (relative / bogus paths); write=False: file not written."""
    fname = fname or f"{c.name}-img.png"
    if data is None:
        data = U.tiff_bytes(im) if fname.endswith(".tif") else U.png_bytes(im)
    abs_path = c.add_file(fname, data) if write else fname
    if "ACAD_IMAGE_VARS" not in c.doc.rootdict:
        raster_vars(c)
    idef = c.doc.add_image_def(path or abs_path, im.size, name=name or fname.rsplit(".", 1)[0])
    idef.dxf.pixel_size = (1.0, 1.0)
    idef.dxf.resolution_units = 0
    return idef


def add_image(c: Case, idef, insert=BASE_INSERT, u=BASE_U, v=BASE_V, layout=None, flags: int = 3, **attribs):
    layout = c.msp if layout is None else layout
    img = layout.add_image(idef, Vec3(insert), (1.0, 1.0), dxfattribs=attribs)
    img.dxf.u_pixel = Vec3(u)
    img.dxf.v_pixel = Vec3(v)
    img.dxf.flags = flags
    return img


def mark(c: Case, p, layout=None, color: int = 1) -> None:
    """Small reference cross (drawn after the image, on layer REF)."""
    c.layer("REF", color=color, lineweight=0)
    layout = c.msp if layout is None else layout
    x, y = p[0], p[1]
    layout.add_line((x - 3, y), (x + 3, y), dxfattribs={"layer": "REF"})
    layout.add_line((x, y - 3), (x, y + 3), dxfattribs={"layer": "REF"})


def fit_corners(c: Case, corners, extra=()) -> None:
    lo, hi = U.bbox(list(corners) + list(extra))
    c.fit(lo, hi, margin=0.08)


def under_lines(c: Case, layout=None, color: int = 7, y0: float = 10, y1: float = 140, step: float = 10, lw: int = 50) -> None:
    """Horizontal lines + a diagonal drawn first (to see what an image/wipeout covers)."""
    c.layer("UNDER", color=color, lineweight=lw)
    layout = c.msp if layout is None else layout
    y = y0
    while y <= y1 + 1e-9:
        layout.add_line((5, y), (195, y), dxfattribs={"layer": "UNDER"})
        y += step
    layout.add_line((5, 5), (195, 145), dxfattribs={"layer": "UNDER"})


def solid_rect(layout, x0, y0, x1, y1, color: int) -> None:
    h = layout.add_hatch(color=color)
    h.paths.add_polyline_path([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], is_closed=True)


def drop_entry(c: Case, dictionary, key: str) -> None:
    """Remove `key` from a DICTIONARY and delete the object itself (no orphan in OBJECTS)."""
    obj = dictionary[key]
    dictionary.discard(key)
    c.doc.objects.delete_entity(obj)


def wipeout_vars(c: Case, frame: int | None, dictvar: int | None) -> None:
    """Set WIPEOUTVARIABLES 70 (None: remove the object) and the WIPEOUTFRAME DICTIONARYVAR
    (None: remove it)."""
    root = c.doc.rootdict
    if frame is None:
        if "ACAD_WIPEOUT_VARS" in root:
            drop_entry(c, root, "ACAD_WIPEOUT_VARS")
    else:
        c.doc.objects.set_wipeout_variables(frame=1 if frame == 2 else frame)
        if frame == 2:
            root["ACAD_WIPEOUT_VARS"].dxf.unprotected_set("frame", 2)
    vd = root.get_required_dict("AcDbVariableDictionary")
    if dictvar is None:
        if "WIPEOUTFRAME" in vd:
            drop_entry(c, vd, "WIPEOUTFRAME")
    else:
        vd.set_or_add_dict_var("WIPEOUTFRAME", str(dictvar))


def add_wipeout(c: Case, pts, layout=None, **attribs):
    layout = c.msp if layout is None else layout
    return layout.add_wipeout(pts, dxfattribs=attribs)


def pdf_def(c: Case, fname: str | None = None):
    fname = fname or f"{c.name}-u.pdf"
    path = c.add_file(fname, U.pdf_bytes())
    return c.doc.add_underlay_def(path, "pdf", name="1")


def regular_polygon(cx, cy, r, n, start=90.0):
    return [(cx + r * math.cos(math.radians(start + 360 * i / n)), cy + r * math.sin(math.radians(start + 360 * i / n))) for i in range(n)]


def star(cx, cy, r0, r1, n=5):
    pts = []
    for i in range(2 * n):
        r = r0 if i % 2 == 0 else r1
        a = math.radians(90 + 180 * i / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


# --------------------------------------------------------------------------------------------


@suite("images", "IMAGE (+IMAGEDEF/RASTERVARIABLES), WIPEOUT and PDF underlays", style_table="acad.ctb", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    build_image_geometry(s)
    build_image_clip(s)
    build_image_display(s)
    build_image_structure(s)
    build_wipeouts(s)
    build_underlays(s)


# --------------------------------------------------------------------------------------------
# IMAGE placement


def build_image_geometry(s: SuiteBuilder) -> None:
    c = s.case("basic", "IMAGE 64x48 F-test PNG at (20,15), pixel 2.5 units (160x120), absolute path, IMAGEFRAME 1", tags=["IMAGE", "IMAGEDEF"], questions=["Q-0643"], params={"insert": BASE_INSERT, "u": BASE_U, "v": BASE_V})
    idef = image_def(c, U.f_image(*F_SIZE))
    add_image(c, idef)
    mark(c, BASE_INSERT)
    c.window((0, 0), (200, 150))

    # scale sweep: pixel size 1 / 2.5 / 3.125 (fills the window)
    for name, px, ins in (("scale-1", 1.0, (68, 51)), ("scale-3125", 3.125, (0, 0)), ("scale-small", 0.5, (84, 63))):
        c = s.case(f"geom-{name}", f"IMAGE 64x48 with square pixels of {px} units at {ins}", tags=["IMAGE", "scale"], params={"pixel": px, "insert": ins})
        idef = image_def(c, U.f_image(*F_SIZE))
        add_image(c, idef, ins, (px, 0, 0), (0, px, 0))
        c.window((0, 0), (200, 150))

    # rotation via u/v
    for ang in (30, 90, 180, -45, 140.555):
        a = math.radians(ang)
        u = (2.0 * math.cos(a), 2.0 * math.sin(a), 0)
        v = (-2.0 * math.sin(a), 2.0 * math.cos(a), 0)
        ins = (0.0, 0.0)
        tag = f"{ang:g}".replace("-", "m").replace(".", "p")
        c = s.case(f"geom-rot-{tag}", f"IMAGE 64x48 rotated {ang} deg via u/v (pixel 2), insertion at origin", tags=["IMAGE", "rotation"], params={"rotation": ang, "u": u, "v": v})
        idef = image_def(c, U.f_image(*F_SIZE))
        add_image(c, idef, ins, u, v)
        mark(c, ins)
        fit_corners(c, U.image_corners(ins, u, v, F_SIZE))

    variants = [
        ("nonsquare", "non-square pixels u=2.5 v=1.25", (20, 45), (2.5, 0, 0), (0, 1.25, 0)),
        ("skew", "skewed (u, v not perpendicular) u=(2,0) v=(0.8,2)", (10, 15), (2.0, 0, 0), (0.8, 2.0, 0)),
        ("mirror-v", "mirrored v=(0,-2.5), insertion at top-left", (20, 135), (2.5, 0, 0), (0, -2.5, 0)),
        ("mirror-u", "mirrored u=(-2.5,0), insertion at bottom-right", (180, 15), (-2.5, 0, 0), (0, 2.5, 0)),
        ("mirror-rot", "mirrored and rotated 30 deg (v = -perp(u))", (60, 40), (2.0 * math.cos(math.radians(30)), 2.0 * math.sin(math.radians(30)), 0), (2.0 * math.sin(math.radians(30)), -2.0 * math.cos(math.radians(30)), 0)),
        ("tiny-uv-digits", "u/v with 16 significant digits (rotation 140.555 deg exact vs 6 decimals)", (0, 0), (round(2 * math.cos(math.radians(140.555)), 6), round(2 * math.sin(math.radians(140.555)), 6), 0), (round(-2 * math.sin(math.radians(140.555)), 6), round(2 * math.cos(math.radians(140.555)), 6), 0)),
    ]
    for name, desc, ins, u, v in variants:
        c = s.case(f"geom-{name}", f"IMAGE 64x48 {desc}", tags=["IMAGE", name.split("-")[0]], params={"insert": ins, "u": u, "v": v})
        idef = image_def(c, U.f_image(*F_SIZE))
        add_image(c, idef, ins, u, v)
        mark(c, ins)
        fit_corners(c, U.image_corners(ins, u, v, F_SIZE))

    # pixel formats
    fmts = [
        ("fmt-gray", "8-bit grayscale PNG", U.gray_image(), "png"),
        ("fmt-indexed", "4-colour palette PNG 32x24 (pixel 5)", U.indexed_image(), "png"),
        ("fmt-rgb-8x6", "tiny 8x6 RGB PNG (pixel 20)", U.f_image(8, 6, grid=0), "png"),
        ("fmt-256", "256x192 RGB F-test PNG (pixel 0.625)", U.f_image(256, 192, grid=16), "png"),
        ("fmt-tiff-rgb", "RGB TIFF (uncompressed) 64x48", U.f_image(*F_SIZE), "tif"),
    ]
    for name, desc, im, ext in fmts:
        w, h = im.size
        px = 160.0 / w
        c = s.case(name, f"IMAGE from {desc}", tags=["IMAGE", "format"], params={"size": [w, h], "pixel": px})
        idef = image_def(c, im, fname=f"{name}-img.{ext}")
        add_image(c, idef, (20, 75 - h * px / 2), (px, 0, 0), (0, px, 0))
        c.window((0, 0), (200, 150))

    # resampling probes (Q-0658)
    c = s.case("resample-2x2", "2x2 PNG (black/white over red/blue) scaled to 100x100 units", tags=["IMAGE", "resampling"], questions=["Q-0658"])
    idef = image_def(c, U.two_by_two())
    add_image(c, idef, (50, 25), (50, 0, 0), (0, 50, 0))
    c.window((0, 0), (200, 150))
    c = s.case("resample-3x3-fraction", "3x3 distinct-colour PNG scaled to 100 units (pixel edges at 1/3 units)", tags=["IMAGE", "resampling"], questions=["Q-0658"])
    idef = image_def(c, U.distinct_image(3, 3))
    add_image(c, idef, (50, 25), (100 / 3, 0, 0), (0, 100 / 3, 0))
    c.window((0, 0), (200, 150))
    for name, px, ins, desc in (
        ("up", 0.625, (20, 15), "upsampled x6.25 (pixel 0.625 units = 6.25 plot px)"),
        ("down", 0.0625, (92, 69), "downsampled (256x192 px on 160x120 plot px)"),
        ("one", 0.1, (87.2, 65.4), "1 image pixel = 1 plot pixel"),
    ):
        c = s.case(f"resample-pattern-{name}", f"256x192 checkerboard/line pattern PNG {desc}", tags=["IMAGE", "resampling"], questions=["Q-0658"], params={"pixel": px})
        idef = image_def(c, U.pattern_image())
        add_image(c, idef, ins, (px, 0, 0), (0, px, 0))
        c.window((0, 0), (200, 150))

    # draw order
    c = s.case("draworder-lines-under", "Lines, then IMAGE on top (image covers them)", tags=["IMAGE", "draw-order"])
    under_lines(c)
    idef = image_def(c, U.f_image(*F_SIZE))
    add_image(c, idef)
    c.window((0, 0), (200, 150))
    c = s.case("draworder-lines-over", "IMAGE, then lines on top", tags=["IMAGE", "draw-order"])
    idef = image_def(c, U.f_image(*F_SIZE))
    add_image(c, idef)
    under_lines(c)
    c.window((0, 0), (200, 150))
    c = s.case("draworder-sortents", "Lines created after the IMAGE, but SORTENTS moves the IMAGE to the top", tags=["IMAGE", "draw-order", "SORTENTS"])
    idef = image_def(c, U.f_image(*F_SIZE))
    img = add_image(c, idef)
    under_lines(c)
    c.msp.set_redraw_order({img.dxf.handle: "FFFF"})
    c.window((0, 0), (200, 150))
    c = s.case("draworder-hatch-image-hatch", "Solid hatch, IMAGE, solid hatch overlapping", tags=["IMAGE", "draw-order", "HATCH"])
    solid_rect(c.msp, 5, 5, 90, 90, 1)
    idef = image_def(c, U.f_image(*F_SIZE))
    add_image(c, idef)
    solid_rect(c.msp, 110, 60, 195, 145, 5)
    c.window((0, 0), (200, 150))

    # image in blocks (Q-0648)
    for name, attrs, desc in (
        ("mirror-rot30", {"xscale": -1.5, "yscale": 1.5, "rotation": 30}, "INSERT sx=-1.5 sy=1.5 rot=30"),
        ("nonuniform", {"xscale": 2.0, "yscale": 1.0, "rotation": 0}, "INSERT sx=2 sy=1"),
        ("rot90-scale", {"xscale": 1.25, "yscale": 1.25, "rotation": 90}, "INSERT scale 1.25 rot=90"),
    ):
        c = s.case(f"block-{name}", f"IMAGE (64x48, pixel 1, base at image centre) in a block, {desc}", tags=["IMAGE", "INSERT", "block"], questions=["Q-0648"], params=attrs)
        idef = image_def(c, U.f_image(*F_SIZE))
        blk = c.doc.blocks.new("IMG")
        add_image(c, idef, (-32, -24), (1, 0, 0), (0, 1, 0), layout=blk)
        c.msp.add_blockref("IMG", (100, 75), dxfattribs=attrs)
        mark(c, (100, 75))
        m = c.msp.query("INSERT")[0].matrix44()
        corners = [m.transform(Vec3(p)) for p in U.image_corners((-32, -24), (1, 0), (0, 1), F_SIZE)]
        fit_corners(c, corners)
    c = s.case("block-clipped-rot", "Polygon-clipped IMAGE in a block, INSERT rot=-20 scale 1.8", tags=["IMAGE", "INSERT", "block", "clip"], questions=["Q-0648"])
    idef = image_def(c, U.f_image(*F_SIZE))
    blk = c.doc.blocks.new("IMG")
    img = add_image(c, idef, (-32, -24), (1, 0, 0), (0, 1, 0), layout=blk)
    img.set_boundary_path([(4, 4), (60, 10), (50, 44), (20, 40), (-0.5, 20)])
    c.msp.add_blockref("IMG", (100, 75), dxfattribs={"xscale": 1.8, "yscale": 1.8, "rotation": -20})
    c.window((0, 0), (200, 150))
    c = s.case("block-two-inserts", "One IMAGE in a block, two INSERTs (plain and mirrored-y)", tags=["IMAGE", "INSERT", "block"], questions=["Q-0648"])
    idef = image_def(c, U.f_image(*F_SIZE))
    blk = c.doc.blocks.new("IMG")
    add_image(c, idef, (0, 0), (1, 0, 0), (0, 1, 0), layout=blk)
    c.msp.add_blockref("IMG", (10, 20))
    c.msp.add_blockref("IMG", (110, 130), dxfattribs={"xscale": 1.2, "yscale": -1.2})
    c.window((0, 0), (200, 150))
    c = s.case("shared-imagedef", "Two IMAGEs sharing one IMAGEDEF (two reactors), second one rotated 90", tags=["IMAGE", "IMAGEDEF"])
    idef = image_def(c, U.f_image(*F_SIZE))
    add_image(c, idef, (10, 20), (1.2, 0, 0), (0, 1.2, 0))
    add_image(c, idef, (190, 20), (0, 1.2, 0), (-1.2, 0, 0))
    c.window((0, 0), (200, 150))

    # tilted out of the XY plane: "show when not aligned with screen" (Q-0646)
    for flags in (1, 3):
        c = s.case(f"tilted-flags{flags}", f"IMAGE tilted out of the XY plane (u has z), display flags {flags} (bit 2 show-when-not-aligned {'on' if flags & 2 else 'off'})", tags=["IMAGE", "flags", "3d"], questions=["Q-0646"], params={"flags": flags})
        idef = image_def(c, U.f_image(*F_SIZE))
        add_image(c, idef, (20, 15), (2.5, 0, 1.5), (0, 2.5, 0), flags=flags)
        mark(c, (20, 15))
        c.window((0, 0), (200, 150))
    for flags in (1, 3):
        a = math.radians(30)
        u = (2 * math.cos(a), 2 * math.sin(a), 0)
        v = (-2 * math.sin(a), 2 * math.cos(a), 0)
        c = s.case(f"rot30-flags{flags}", f"IMAGE rotated 30 deg in plane, display flags {flags}", tags=["IMAGE", "flags"], questions=["Q-0646"], params={"flags": flags})
        idef = image_def(c, U.f_image(*F_SIZE))
        add_image(c, idef, (60, 5), u, v, flags=flags)
        fit_corners(c, U.image_corners((60, 5), u, v, F_SIZE))

    # extrusion probe (Q-0647): 210 = (0,0,-1) inserted into IMAGE (undocumented)
    c = s.case("extrusion-negz", "IMAGE at (20,15) with an injected 210=(0,0,-1) (not documented for IMAGE; WCS or OCS?)", tags=["IMAGE", "OCS", "extrusion"], questions=["Q-0647"])
    idef = image_def(c, U.f_image(*F_SIZE))
    add_image(c, idef, (20, 15), (1.0, 0, 0), (0, 1.0, 0))
    mark(c, (0, 0))
    c.byte_filters.append(U.insert_extrusion("IMAGE", (0.0, 0.0, -1.0)))
    c.notes.append("WCS reading: image spans x 20..84; OCS reading (Ax=-X): x -84..-20, mirrored")
    c.window((-100, -75), (100, 75))

    # random placements
    for seed in (1, 2, 3):
        c = s.case(f"random-{seed:04d}", f"Random IMAGE placement (rotation, non-square pixels, optional mirror, clip polygon), seed {seed}", tags=["IMAGE", "random"], seed=seed)
        rng = c.rng
        ang = rng.uniform(-180, 180)
        su, sv = rng.uniform(1.2, 2.6), rng.uniform(1.2, 2.6)
        mir = rng.random() < 0.5
        a = math.radians(ang)
        u = (su * math.cos(a), su * math.sin(a), 0)
        sgn = -1 if mir else 1
        v = (-sgn * sv * math.sin(a), sgn * sv * math.cos(a), 0)
        idef = image_def(c, U.f_image(*F_SIZE))
        img = add_image(c, idef, (0, 0), u, v)
        n = rng.randint(3, 7)
        poly = []
        for k in range(n):
            t = 2 * math.pi * k / n + rng.uniform(-0.3, 0.3)
            r = rng.uniform(0.4, 0.6)
            poly.append((round(31.5 + 64 * r * math.cos(t), 3), round(23.5 + 48 * r * math.sin(t), 3)))
        img.set_boundary_path(poly)
        c.params.update({"rotation": ang, "u": u, "v": v, "clip": poly})
        fit_corners(c, U.image_corners((0, 0), u, v, F_SIZE))


# --------------------------------------------------------------------------------------------
# IMAGE clipping


def build_image_clip(s: SuiteBuilder) -> None:
    # Q-0653: pixel coordinates with -0.5 offset, y down: rect clip covering pixel (1,1) only
    for name, ins, u, v in (
        ("plain", (40, 15), (30, 0, 0), (0, 30, 0)),
        ("rot30", (70, 5), (25 * math.cos(math.radians(30)), 25 * math.sin(math.radians(30)), 0), (-25 * math.sin(math.radians(30)), 25 * math.cos(math.radians(30)), 0)),
        ("mirror-v", (40, 135), (30, 0, 0), (0, -30, 0)),
    ):
        c = s.case(f"clip-pixel11-{name}", f"4x3 distinct-colour PNG ({name}), rectangular clip (0.5,0.5)-(1.5,1.5) = pixel column 1 row 1 only", tags=["IMAGE", "clip"], questions=["Q-0653"], params={"insert": ins, "u": u, "v": v})
        idef = image_def(c, U.distinct_image(4, 3))
        img = add_image(c, idef, ins, u, v)
        img.set_boundary_path([(0.5, 0.5), (1.5, 1.5)])
        c.layer("OUTLINE", color=8, lineweight=0)
        corners = U.image_corners(ins, u, v, (4, 3))
        c.msp.add_lwpolyline(corners, close=True, dxfattribs={"layer": "OUTLINE"})
        mark(c, U.pixel_to_wcs(ins, u, v, (4, 3), (1, 1)))
        fit_corners(c, corners)
    c = s.case("clip-full-default", "IMAGE with clip flag on and the default full rectangle (-0.5,-0.5)-(w-0.5,h-0.5)", tags=["IMAGE", "clip"], questions=["Q-0653"])
    idef = image_def(c, U.f_image(*F_SIZE))
    img = add_image(c, idef)
    img.set_boundary_path([(-0.5, -0.5), (63.5, 47.5)])
    c.window((0, 0), (200, 150))
    c = s.case("clip-beyond", "IMAGE with rectangular clip larger than the bitmap (-4.5,-2.5)-(67.5,49.5): frame follows clip?", tags=["IMAGE", "clip"], questions=["Q-0653"])
    idef = image_def(c, U.f_image(*F_SIZE))
    img = add_image(c, idef)
    img.set_boundary_path([(-4.5, -2.5), (67.5, 49.5)])
    c.window((0, 0), (200, 150))
    c = s.case("clip-rect-corner", "IMAGE rectangular clip (10.5,4.5)-(40.5,30.5) given as lower-right/upper-left order swap", tags=["IMAGE", "clip"], questions=["Q-0653"])
    idef = image_def(c, U.f_image(*F_SIZE))
    img = add_image(c, idef)
    img.set_boundary_path([(40.5, 4.5), (10.5, 30.5)])
    c.window((0, 0), (200, 150))

    poly = [(4, 4), (60, 10), (50, 44), (32, 20), (20, 40), (-0.5, 24)]
    # Q-0652: flag 4 vs 280
    for name, flags, clipping in (("flag4-280on", 7, 1), ("flag4-280off", 7, 0), ("noflag4-280on", 3, 1)):
        c = s.case(f"clip-poly-{name}", f"IMAGE concave polygon clip, flags 70={flags}, clipping state 280={clipping}", tags=["IMAGE", "clip"], questions=["Q-0652"], params={"flags": flags, "clipping": clipping, "polygon": poly})
        idef = image_def(c, U.f_image(*F_SIZE))
        img = add_image(c, idef)
        img.set_boundary_path(poly)
        img.dxf.flags = flags
        img.dxf.clipping = clipping
        c.window((0, 0), (200, 150))
    # Q-0654: clip mode 290 (inverted)
    for mode in (0, 1):
        c = s.case(f"clip-poly-mode{mode}", f"IMAGE concave polygon clip, clip mode 290={mode} ({'inside/inverted' if mode else 'outside'})", tags=["IMAGE", "clip", "inverted"], questions=["Q-0654"], params={"clip_mode": mode})
        idef = image_def(c, U.f_image(*F_SIZE))
        img = add_image(c, idef)
        img.set_boundary_path(poly)
        img.dxf.clip_mode = mode
        c.window((0, 0), (200, 150))
    c = s.case("clip-rect-mode1", "IMAGE rectangular clip (15.5,11.5)-(47.5,35.5), clip mode 290=1 (inverted)", tags=["IMAGE", "clip", "inverted"], questions=["Q-0654"])
    idef = image_def(c, U.f_image(*F_SIZE))
    img = add_image(c, idef)
    img.set_boundary_path([(15.5, 11.5), (47.5, 35.5)])
    img.dxf.clip_mode = 1
    c.window((0, 0), (200, 150))
    c = s.case("clip-poly-mode1-r2007", "IMAGE polygon clip mode 290=1 saved as R2007 (290 not written: plain clip?)", tags=["IMAGE", "clip", "inverted"], questions=["Q-0654"], dxfversion="R2007")
    idef = image_def(c, U.f_image(*F_SIZE))
    img = add_image(c, idef)
    img.set_boundary_path(poly)
    img.dxf.clip_mode = 1
    c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# IMAGE display properties


def build_image_display(s: SuiteBuilder) -> None:
    # Q-0655: brightness / contrast / fade on a ramp image
    combos = [(50, 50, 0)]
    combos += [(b, 50, 0) for b in (0, 20, 80, 100)]
    combos += [(50, c_, 0) for c_ in (0, 20, 80, 100)]
    combos += [(50, 50, f) for f in (25, 50, 100)]
    combos += [(80, 20, 50), (20, 80, 30), (100, 100, 100), (0, 0, 0)]
    for b, ct, f in combos:
        c = s.case(f"bcf-b{b:03d}-c{ct:03d}-f{f:03d}", f"Ramp IMAGE (gray/R/G/B, 17-step values) brightness {b}, contrast {ct}, fade {f}", tags=["IMAGE", "brightness", "contrast", "fade"], questions=["Q-0655"], params={"brightness": b, "contrast": ct, "fade": f})
        idef = image_def(c, U.ramp_image())
        img = add_image(c, idef, (20, 35), (10, 0, 0), (0, 10, 0))
        img.dxf.brightness = b
        img.dxf.contrast = ct
        img.dxf.fade = f
        c.window((0, 0), (200, 150))
    c = s.case("bcf-fade50-over-lines", "F IMAGE fade 50 over lines (does fade blend towards the background or show what is below?)", tags=["IMAGE", "fade", "draw-order"], questions=["Q-0655"])
    under_lines(c)
    idef = image_def(c, U.f_image(*F_SIZE))
    img = add_image(c, idef)
    img.dxf.fade = 50
    c.window((0, 0), (200, 150))

    # Q-0656: alpha channel and entity transparency
    for name, flags, transp in (("flag8-off", 3, None), ("flag8-on", 11, None), ("flag8-on-t50", 11, 0.5), ("flag8-off-t50", 3, 0.5)):
        c = s.case(f"alpha-{name}", f"RGBA PNG (alpha ramp, transparent hole, opaque band) over lines and a red hatch; flags {flags}" + (f", entity transparency {transp}" if transp else ""), tags=["IMAGE", "transparency", "alpha"], questions=["Q-0656"], params={"flags": flags, "transparency": transp})
        solid_rect(c.msp, 5, 60, 195, 90, 1)
        under_lines(c)
        idef = image_def(c, U.rgba_image())
        img = add_image(c, idef, flags=flags)
        if transp:
            img.transparency = transp
        c.window((0, 0), (200, 150))
    c = s.case("rgb-t50", "Opaque RGB IMAGE with entity transparency 0.5 over lines and a red hatch", tags=["IMAGE", "transparency"], questions=["Q-0656"])
    solid_rect(c.msp, 5, 60, 195, 90, 1)
    under_lines(c)
    idef = image_def(c, U.f_image(*F_SIZE))
    img = add_image(c, idef)
    img.transparency = 0.5
    c.window((0, 0), (200, 150))

    # Q-0657: bitonal images
    for ext in ("png", "tif"):
        for name, flags, color, layer_color in (("red", 3, 1, 7), ("red-transp", 11, 1, 7), ("bylayer-green", 3, 256, 3), ("color7-transp", 11, 7, 7)):
            c = s.case(f"bitonal-{ext}-{name}", f"1-bit {ext.upper()} IMAGE (black F on white) over a blue hatch and lines, entity colour {color} (layer colour {layer_color}), flags {flags}", tags=["IMAGE", "bitonal", "color"], questions=["Q-0657"], params={"format": ext, "flags": flags, "color": color})
            solid_rect(c.msp, 5, 5, 100, 145, 5)
            under_lines(c)
            c.layer("IMG", color=layer_color, lineweight=0)
            idef = image_def(c, U.bitonal_image(), fname=f"bitonal-{ext}-{name}-img.{ext}")
            add_image(c, idef, flags=flags, color=color, layer="IMG")
            c.window((0, 0), (200, 150))
    for flags in (3, 11):
        c = s.case(f"bitonal-png-inverted-flags{flags}", f"1-bit PNG with inverted polarity (F stored as 1/white on 0/black), entity colour 1, flags {flags}", tags=["IMAGE", "bitonal", "color"], questions=["Q-0657"], params={"flags": flags, "invert": True})
        solid_rect(c.msp, 5, 5, 100, 145, 5)
        under_lines(c)
        idef = image_def(c, U.bitonal_image(invert=True))
        add_image(c, idef, flags=flags, color=1)
        c.window((0, 0), (200, 150))

    # Q-0645: show-image flag / unloaded IMAGEDEF
    for flags in (0, 2, 8, 9, 15):
        c = s.case(f"flags-{flags:02d}", f"IMAGE display flags 70={flags} (bit 1 show image {'on' if flags & 1 else 'off'})", tags=["IMAGE", "flags"], questions=["Q-0645"], params={"flags": flags})
        idef = image_def(c, U.f_image(*F_SIZE))
        img = add_image(c, idef, flags=flags)
        if flags & 4:
            img.set_boundary_path([(-0.5, -0.5), (63.5, 47.5)])
            img.dxf.flags = flags
        c.window((0, 0), (200, 150))
    c = s.case("imagedef-unloaded", "IMAGE whose IMAGEDEF has loaded flag 280=0 (file exists)", tags=["IMAGE", "IMAGEDEF", "unloaded"], questions=["Q-0645"])
    idef = image_def(c, U.f_image(*F_SIZE))
    idef.dxf.loaded = 0
    add_image(c, idef)
    c.window((0, 0), (200, 150))

    # frame appearance
    c = s.case("frame-color-lw", "IMAGE with entity colour 1 and lineweight 0.70 (frame appearance), IMAGEFRAME 1", tags=["IMAGE", "frame", "lineweight", "color"], questions=["Q-0649"])
    idef = image_def(c, U.f_image(*F_SIZE))
    add_image(c, idef, color=1, lineweight=70)
    c.window((0, 0), (200, 150))
    c = s.case("frame-clip-color", "Polygon-clipped IMAGE, colour 3, lineweight 0.50: frame follows the clip polygon?", tags=["IMAGE", "frame", "clip"], questions=["Q-0649"])
    idef = image_def(c, U.f_image(*F_SIZE))
    img = add_image(c, idef, color=3, lineweight=50)
    img.set_boundary_path([(4, 4), (60, 10), (50, 44), (20, 40)])
    c.window((0, 0), (200, 150))

    # Q-0649/Q-0650: IMAGEFRAME via RASTERVARIABLES 70 = 0/1/2
    for frame in (0, 1, 2):
        c = s.case(f"imageframe-{frame}", f"IMAGE with RASTERVARIABLES 70 (IMAGEFRAME) = {frame}; re-save shows how AutoCAD stores it", tags=["IMAGE", "RASTERVARIABLES", "IMAGEFRAME"], questions=["Q-0649", "Q-0650"], params={"frame": frame})
        raster_vars(c, frame=frame)
        idef = image_def(c, U.f_image(*F_SIZE))
        add_image(c, idef, color=1)
        c.window((0, 0), (200, 150))
    c = s.case("imageframe-0-clipped", "Polygon-clipped IMAGE with IMAGEFRAME 0 (no frame, clip still applied?)", tags=["IMAGE", "RASTERVARIABLES", "IMAGEFRAME", "clip"], questions=["Q-0649"])
    raster_vars(c, frame=0)
    idef = image_def(c, U.f_image(*F_SIZE))
    img = add_image(c, idef, color=1)
    img.set_boundary_path([(4, 4), (60, 10), (50, 44), (20, 40)])
    c.window((0, 0), (200, 150))
    c = s.case("quality-draft", "IMAGE with RASTERVARIABLES quality 71=0 (draft): does PLOT change?", tags=["IMAGE", "RASTERVARIABLES"], params={"quality": 0})
    raster_vars(c, frame=1, quality=0)
    idef = image_def(c, U.pattern_image())
    add_image(c, idef, (20, 15), (0.625, 0, 0), (0, 0.625, 0))
    c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# IMAGEDEF paths and object structure


def build_image_structure(s: SuiteBuilder) -> None:
    # Q-0643 path resolution (file present next to the DXF in every case)
    paths = [
        ("bare", "bare file name '<case>-img.png' (relative to drawing folder)", lambda f, a: f),
        ("dot", "'.\\<case>-img.png'", lambda f, a: ".\\" + f),
        ("parent", "'..\\images\\<case>-img.png' (relative via parent folder)", lambda f, a: "..\\images\\" + f),
        ("forward-slash", "absolute path with forward slashes", lambda f, a: a.replace("\\", "/")),
        ("missing-dir", "absolute path to a missing folder; the file sits next to the DXF", lambda f, a: MISSING_DIR + "\\" + f),
    ]
    for name, desc, fn in paths:
        c = s.case(f"path-{name}", f"IMAGEDEF path = {desc}", tags=["IMAGE", "IMAGEDEF", "path"], questions=["Q-0643"], params={"path_kind": name})
        fname = f"{c.name}-img.png"
        im = U.f_image(*F_SIZE)
        abs_path = c.add_file(fname, U.png_bytes(im))
        idef = image_def(c, im, fname=fname, path=fn(fname, abs_path))
        add_image(c, idef)
        c.params["path"] = idef.dxf.filename if name != "forward-slash" else "<absolute with />"
        c.window((0, 0), (200, 150))
    # Q-0644 missing file
    for name, path, desc in (
        ("missing-abs", MISSING_DIR + "\\missing-abs-img.png", "absolute path, file nowhere"),
        ("missing-bare", "missing-bare-img.png", "bare name, file nowhere"),
    ):
        c = s.case(name, f"IMAGE whose file is missing ({desc}); IMAGEDEF size 64x48, colour 1", tags=["IMAGE", "IMAGEDEF", "missing"], questions=["Q-0644"])
        idef = image_def(c, U.f_image(*F_SIZE), fname=name + "-img.png", path=path, write=False)
        add_image(c, idef, color=1)
        c.window((0, 0), (200, 150))
    c = s.case("missing-rotated-clipped", "Missing image file, IMAGE rotated 30 deg with polygon clip", tags=["IMAGE", "missing", "clip"], questions=["Q-0644"])
    idef = image_def(c, U.f_image(*F_SIZE), fname="missing-rotated-clipped-img.png", path=MISSING_DIR + "\\missing-rotated-clipped-img.png", write=False)
    a = math.radians(30)
    u = (2 * math.cos(a), 2 * math.sin(a), 0)
    v = (-2 * math.sin(a), 2 * math.cos(a), 0)
    img = add_image(c, idef, (60, 5), u, v, color=1)
    img.set_boundary_path([(4, 4), (60, 10), (50, 44), (20, 40)])
    fit_corners(c, U.image_corners((60, 5), u, v, F_SIZE))

    # Q-0651: no RASTERVARIABLES
    c = s.case("no-rastervariables", "IMAGE + IMAGEDEF without ACAD_IMAGE_VARS/RASTERVARIABLES (default IMAGEFRAME?)", tags=["IMAGE", "RASTERVARIABLES"], questions=["Q-0651"])
    idef = image_def(c, U.f_image(*F_SIZE))
    add_image(c, idef, color=1)
    drop_entry(c, c.doc.rootdict, "ACAD_IMAGE_VARS")
    c.window((0, 0), (200, 150))

    # Q-0640: missing ACAD_IMAGE_DICT / missing IMAGEDEF_REACTOR
    c = s.case("no-image-dict", "IMAGE whose IMAGEDEF is not listed in any ACAD_IMAGE_DICT (NOD entry removed; IMAGEDEF owned by the NOD) - structure probe", tags=["IMAGE", "IMAGEDEF", "structure"], questions=["Q-0640"])
    idef = image_def(c, U.f_image(*F_SIZE), name="noimgdict")
    add_image(c, idef)
    root = c.doc.rootdict
    img_dict = root["ACAD_IMAGE_DICT"]
    img_dict.discard("noimgdict")
    idef.dxf.owner = root.dxf.handle
    idef.set_reactors([h for h in idef.get_reactors() if h != img_dict.dxf.handle] + [root.dxf.handle])
    drop_entry(c, root, "ACAD_IMAGE_DICT")
    c.allow_audit_errors = True
    c.window((0, 0), (200, 150))
    c = s.case("no-reactor", "IMAGE without IMAGEDEF_REACTOR (no 360, reactor object and IMAGEDEF back-link removed) - structure probe", tags=["IMAGE", "IMAGEDEF_REACTOR", "structure"], questions=["Q-0640"])
    idef = image_def(c, U.f_image(*F_SIZE))
    img = add_image(c, idef)
    reactor = img.image_def_reactor
    rh = reactor.dxf.handle
    idef.discard_reactor_handle(rh)
    img.dxf.discard("image_def_reactor_handle")
    img._image_def_reactor = None
    c.doc.objects.delete_entity(reactor)
    c.window((0, 0), (200, 150))

    # Q-0641: R2004 CLASS IMAGE instance count
    for count in (1, 0):
        c = s.case(f"class-count-{count}", f"AC1018 file with one IMAGE; CLASS IMAGE instance count 91={count}" + (" (patched)" if count == 0 else ""), tags=["IMAGE", "CLASSES", "structure"], questions=["Q-0641"], dxfversion="R2004", params={"instance_count": count})
        idef = image_def(c, U.f_image(*F_SIZE))
        add_image(c, idef)
        if count != 1:
            c.byte_filters.append(U.set_class_instance_count("IMAGE", count))
        c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# WIPEOUT


def _wo_scene(c: Case, layout=None, frame: int | None = 1, dictvar: int | None = 1, color: int = 256, top: bool = True):
    """Lines + a green hatch, then a rectangular WIPEOUT, then a circle on top."""
    layout = c.msp if layout is None else layout
    solid_rect(layout, 10, 20, 70, 130, 3)
    under_lines(c, layout)
    wo = add_wipeout(c, [(40, 40), (160, 40), (160, 110), (40, 110)], layout=layout, color=color)
    wipeout_vars(c, frame, dictvar)
    if top:
        c.layer("TOP", color=1, lineweight=50)
        layout.add_circle((100, 75), 25, dxfattribs={"layer": "TOP"})
    return wo


def build_wipeouts(s: SuiteBuilder) -> None:
    # Q-0669 basic masking, model and paper space
    c = s.case("wipeout-basic", "Lines + green hatch, rectangular WIPEOUT, red circle after it; WIPEOUTFRAME 1 (WIPEOUTVARIABLES + DICTIONARYVAR)", tags=["WIPEOUT", "draw-order"], questions=["Q-0669"])
    _wo_scene(c)
    c.window((0, 0), (200, 150))
    c = s.case("wipeout-paperspace", "Paper-space Layout1: lines + hatch, WIPEOUT, circle after it (window plot of the layout)", tags=["WIPEOUT", "paperspace"], questions=["Q-0669"])
    _wo_scene(c, layout=c.doc.paperspace("Layout1"))
    c.layout_window("Layout1", (0, 0), (200, 150))
    c = s.case("wipeout-first", "WIPEOUT created first, then lines/hatch (masks nothing?)", tags=["WIPEOUT", "draw-order"], questions=["Q-0669"])
    add_wipeout(c, [(40, 40), (160, 40), (160, 110), (40, 110)])
    wipeout_vars(c, 1, 1)
    solid_rect(c.msp, 10, 20, 70, 130, 3)
    under_lines(c)
    c.window((0, 0), (200, 150))
    c = s.case("wipeout-sortents", "Lines drawn after the WIPEOUT, but SORTENTS moves the WIPEOUT to the top", tags=["WIPEOUT", "draw-order", "SORTENTS"], questions=["Q-0669"])
    wo = add_wipeout(c, [(40, 40), (160, 40), (160, 110), (40, 110)])
    wipeout_vars(c, 1, 1)
    under_lines(c)
    c.msp.set_redraw_order({wo.dxf.handle: "FFFF"})
    c.window((0, 0), (200, 150))
    c = s.case("wipeout-over-image", "IMAGE, then a WIPEOUT over part of it, then lines", tags=["WIPEOUT", "IMAGE", "draw-order"], questions=["Q-0669"])
    idef = image_def(c, U.f_image(*F_SIZE))
    add_image(c, idef)
    add_wipeout(c, [(60, 40), (140, 40), (140, 110), (60, 110)])
    wipeout_vars(c, 1, 1)
    c.msp.add_line((0, 75), (200, 75))
    c.window((0, 0), (200, 150))

    # shapes
    shapes = [
        ("polygon", "concave polygon", [(30, 30), (170, 20), (140, 80), (180, 130), (60, 120), (90, 70)]),
        ("star", "5-point star", star(100, 75, 65, 25)),
        ("circle32", "32-gon circle", regular_polygon(100, 75, 60, 32)),
        ("rotated-square", "square rotated 30 deg (axis-aligned u/v, boundary rotated)", regular_polygon(100, 75, 60, 4, start=30 + 45)),
        ("triangle", "triangle", [(30, 20), (170, 30), (90, 135)]),
    ]
    for name, desc, pts in shapes:
        c = s.case(f"wipeout-{name}", f"WIPEOUT {desc} over lines/hatch, frame 1", tags=["WIPEOUT", "polygon"], params={"vertices": [list(map(lambda v: round(v, 6), p)) for p in pts]})
        solid_rect(c.msp, 10, 20, 70, 130, 3)
        under_lines(c)
        add_wipeout(c, pts)
        wipeout_vars(c, 1, 1)
        c.window((0, 0), (200, 150))
    c = s.case("wipeout-uv-rotated", "WIPEOUT with rotated u/v vectors (as after ROTATE 30), unit-square boundary", tags=["WIPEOUT", "rotation"])
    under_lines(c)
    wo = add_wipeout(c, [(0, 0), (1, 0), (1, 1), (0, 1)])
    a = math.radians(30)
    wo.dxf.insert = Vec3(80, 10, 0)
    wo.dxf.u_pixel = Vec3(100 * math.cos(a), 100 * math.sin(a), 0)
    wo.dxf.v_pixel = Vec3(-80 * math.sin(a), 80 * math.cos(a), 0)
    wo.set_boundary_path([(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)])
    wipeout_vars(c, 1, 1)
    mark(c, (80, 10))
    c.window((0, 0), (200, 150))
    c = s.case("wipeout-rect2pt", "WIPEOUT with 2-point rectangular boundary (71=1) instead of a closed polygon", tags=["WIPEOUT", "clip"])
    under_lines(c)
    wo = add_wipeout(c, [(40, 40), (160, 40), (160, 110), (40, 110)])
    wo.set_boundary_path([(-0.5, -0.5), (0.5, 0.5)])
    wipeout_vars(c, 1, 1)
    c.window((0, 0), (200, 150))

    # Q-0670 style tables
    for st in ("monochrome.ctb", "acad.ctb"):
        c = s.case(f"wipeout-ctb-{st.split('.')[0]}", f"Coloured lines/hatch under a WIPEOUT, frame colour 1, plotted with {st}", tags=["WIPEOUT", "plotstyle"], questions=["Q-0670"], style_table=st)
        solid_rect(c.msp, 10, 20, 70, 130, 3)
        under_lines(c, color=5)
        add_wipeout(c, [(40, 40), (160, 40), (160, 110), (40, 110)], color=1)
        wipeout_vars(c, 1, 1)
        c.window((0, 0), (200, 150))

    # Q-0671 wipeout in a block
    for name, attrs in (("plain", {}), ("rot-scaled", {"xscale": 1.3, "yscale": 0.8, "rotation": 25})):
        c = s.case(f"wipeout-block-{name}", f"Block (line, WIPEOUT, line) inserted after a model-space hatch and lines {attrs or ''}", tags=["WIPEOUT", "block", "draw-order"], questions=["Q-0671"], params=attrs)
        solid_rect(c.msp, 10, 20, 190, 60, 3)
        under_lines(c)
        blk = c.doc.blocks.new("WO")
        c.layer("BLK", color=5, lineweight=50)
        blk.add_line((-60, -40), (60, 40), dxfattribs={"layer": "BLK"})
        blk.add_wipeout([(-45, -30), (45, -30), (45, 30), (-45, 30)])
        blk.add_line((-60, 40), (60, -40), dxfattribs={"layer": "BLK", "color": 1})
        wipeout_vars(c, 1, 1)
        c.msp.add_blockref("WO", (100, 75), dxfattribs=attrs)
        c.window((0, 0), (200, 150))

    # Q-0672 clip mode 290
    for mode in (0, 1):
        c = s.case(f"wipeout-mode{mode}", f"Polygonal WIPEOUT over lines with clip mode 290={mode}", tags=["WIPEOUT", "clip", "inverted"], questions=["Q-0672"], params={"clip_mode": mode})
        solid_rect(c.msp, 10, 20, 70, 130, 3)
        under_lines(c)
        wo = add_wipeout(c, [(30, 30), (170, 20), (140, 80), (180, 130), (60, 120), (90, 70)])
        wo.dxf.clip_mode = mode
        wipeout_vars(c, 1, 1)
        c.window((0, 0), (200, 150))

    # Q-0673 / Q-0674: WIPEOUTVARIABLES 70 alone (no DICTIONARYVAR)
    for space in ("model", "paper"):
        for frame in (0, 1, 2):
            c = s.case(f"wipeoutframe-{space}-{frame}", f"WIPEOUT frame colour 1 in {space} space; WIPEOUTVARIABLES 70={frame}, no WIPEOUTFRAME DICTIONARYVAR", tags=["WIPEOUT", "WIPEOUTFRAME", "WIPEOUTVARIABLES"], questions=["Q-0673", "Q-0674"], params={"space": space, "frame": frame})
            if space == "model":
                _wo_scene(c, frame=frame, dictvar=None, color=1)
                c.window((0, 0), (200, 150))
            else:
                _wo_scene(c, layout=c.doc.paperspace("Layout1"), frame=frame, dictvar=None, color=1)
                c.layout_window("Layout1", (0, 0), (200, 150))
    # Q-0675 conflicting storage
    for frame, dv in ((None, 0), (None, 1), (None, 2), (0, 1), (1, 0), (0, 2), (1, 2), (2, 0), (1, 1), (0, 0)):
        fs = "none" if frame is None else str(frame)
        c = s.case(f"wipeoutframe-vars{fs}-dict{dv}", f"WIPEOUT frame colour 1; WIPEOUTVARIABLES {'absent' if frame is None else '70=' + fs}, DICTIONARYVAR WIPEOUTFRAME={dv}", tags=["WIPEOUT", "WIPEOUTFRAME", "DICTIONARYVAR"], questions=["Q-0675", "Q-0674"], params={"wipeoutvariables": frame, "dictvar": dv})
        _wo_scene(c, frame=frame, dictvar=dv, color=1)
        c.window((0, 0), (200, 150))

    # frame appearance and other properties
    c = s.case("wipeout-frame-color-lw", "WIPEOUT frame 1 with entity colour 1, lineweight 0.70, linetype DASHED", tags=["WIPEOUT", "frame", "lineweight", "color"], questions=["Q-0673"])
    under_lines(c)
    c.linetype("DASHED")
    add_wipeout(c, [(40, 40), (160, 40), (160, 110), (40, 110)], color=1, lineweight=70, linetype="DASHED")
    wipeout_vars(c, 1, 1)
    c.window((0, 0), (200, 150))
    c = s.case("wipeout-transparency", "WIPEOUT with entity transparency 0.5 over lines/hatch", tags=["WIPEOUT", "transparency"])
    solid_rect(c.msp, 10, 20, 70, 130, 3)
    under_lines(c)
    wo = add_wipeout(c, [(40, 40), (160, 40), (160, 110), (40, 110)])
    wo.transparency = 0.5
    wipeout_vars(c, 1, 1)
    c.window((0, 0), (200, 150))
    c = s.case("wipeout-flags-6", "WIPEOUT with display flags 70=6 (show-image bit off)", tags=["WIPEOUT", "flags"])
    under_lines(c)
    wo = add_wipeout(c, [(40, 40), (160, 40), (160, 110), (40, 110)])
    wo.dxf.flags = 6
    wipeout_vars(c, 1, 1)
    c.window((0, 0), (200, 150))
    c = s.case("wipeout-extrusion-negz", "WIPEOUT with an injected 210=(0,0,-1) (undocumented; WCS or OCS?)", tags=["WIPEOUT", "OCS", "extrusion"], questions=["Q-0647"])
    c.msp.add_line((-100, 0), (100, 0))
    c.msp.add_line((0, -75), (0, 75))
    c.msp.add_circle((50, 35), 20)
    c.msp.add_circle((-50, 35), 20)
    add_wipeout(c, [(20, 15), (80, 15), (80, 60), (30, 60)])
    wipeout_vars(c, 1, 1)
    c.byte_filters.append(U.insert_extrusion("WIPEOUT", (0.0, 0.0, -1.0)))
    c.notes.append("WCS reading: wipeout covers x 20..80 (right circle masked); OCS reading: x -80..-20 (left circle masked)")
    c.window((-100, -75), (100, 75))
    for seed in (1, 2):
        c = s.case(f"wipeout-random-{seed:04d}", f"Random polygonal WIPEOUTs interleaved with lines, seed {seed}", tags=["WIPEOUT", "random", "draw-order"], seed=seed)
        rng = c.rng
        c.layer("L", color=5, lineweight=35)
        for k in range(3):
            for _ in range(6):
                c.msp.add_line((rng.uniform(5, 195), rng.uniform(5, 145)), (rng.uniform(5, 195), rng.uniform(5, 145)), dxfattribs={"layer": "L", "color": 1 + k * 2})
            cx, cy = rng.uniform(50, 150), rng.uniform(40, 110)
            n = rng.randint(3, 8)
            pts = [(cx + rng.uniform(15, 45) * math.cos(2 * math.pi * i / n), cy + rng.uniform(15, 40) * math.sin(2 * math.pi * i / n)) for i in range(n)]
            add_wipeout(c, pts)
        wipeout_vars(c, 1, 1)
        c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# PDF underlays


def build_underlays(s: SuiteBuilder) -> None:
    # Q-0659 natural size at scale 1 (4 x 3 inch page)
    c = s.case("pdf-natural-mm", "PDFUNDERLAY of a 4x3 inch page at scale 1 in a mm drawing; ref rectangles 4x3 and 101.6x76.2", tags=["PDFUNDERLAY", "scale"], questions=["Q-0659"])
    udef = pdf_def(c)
    c.msp.add_underlay(udef, (0, 0), 1.0)
    c.layer("REF", color=1, lineweight=0)
    c.msp.add_lwpolyline([(0, 0), (4, 0), (4, 3), (0, 3)], close=True, dxfattribs={"layer": "REF"})
    c.msp.add_lwpolyline([(0, 0), (101.6, 0), (101.6, 76.2), (0, 76.2)], close=True, dxfattribs={"layer": "REF"})
    c.window((-4, -3), (116, 87))
    c = s.case("pdf-natural-inch", "PDFUNDERLAY of a 4x3 inch page at scale 1 in an inch drawing (INSUNITS 1); ref rectangle 4x3", tags=["PDFUNDERLAY", "scale"], questions=["Q-0659"], units=1)
    udef = pdf_def(c)
    c.msp.add_underlay(udef, (0, 0), 1.0)
    c.layer("REF", color=1, lineweight=0)
    c.msp.add_lwpolyline([(0, 0), (4, 0), (4, 3), (0, 3)], close=True, dxfattribs={"layer": "REF"})
    c.window((-0.4, -0.3), (4.4, 3.3))

    def base(c: Case, scale=40.0, ins=(20, 15), rot=0.0):
        udef = pdf_def(c)
        u = c.msp.add_underlay(udef, ins, scale, rotation=rot)
        mark(c, ins)
        return u

    c = s.case("pdf-basic", "PDFUNDERLAY at (20,15) scale 40 (160x120 if 1 PDF inch = 1 unit)", tags=["PDFUNDERLAY"], questions=["Q-0659"])
    base(c)
    c.window((0, 0), (200, 150))
    c = s.case("pdf-rotated", "PDFUNDERLAY scale 30 rotated 30 deg at (80,5)", tags=["PDFUNDERLAY", "rotation"])
    base(c, 30.0, (80, 5), 30.0)
    c.window((0, 0), (200, 150))
    # Q-0660 clip boundary units, inverted clip
    for name, flags, desc in (("clip-rect", 1 | 2, "clip on"), ("clip-inverted", 1 | 2 | 16, "clip on + inverted (16)")):
        c = s.case(f"pdf-{name}", f"PDFUNDERLAY scale 40, rectangular clip (0.5,0.5)-(2.5,2) in underlay units, {desc}", tags=["PDFUNDERLAY", "clip"], questions=["Q-0660"], params={"flags": flags})
        u = base(c)
        u.set_boundary_path([(0.5, 0.5), (2.5, 2.0)])
        u.dxf.flags = flags
        c.layer("REF", color=1, lineweight=0)
        c.msp.add_lwpolyline([(40, 35), (120, 35), (120, 95), (40, 95)], close=True, dxfattribs={"layer": "REF"})
        c.window((0, 0), (200, 150))
    c = s.case("pdf-clip-poly", "PDFUNDERLAY scale 40, polygonal clip (4 vertices) in underlay units", tags=["PDFUNDERLAY", "clip"], questions=["Q-0660"])
    u = base(c)
    u.set_boundary_path([(0.25, 0.25), (3.75, 0.5), (3.0, 2.75), (1.0, 2.0)])
    c.window((0, 0), (200, 150))
    # Q-0661 / Q-0662 flags
    for name, flags, q in (("mono", 2 | 4, "Q-0661"), ("adjustbg", 2 | 8, "Q-0662"), ("plain", 2, "Q-0662"), ("off", 0, "Q-0661")):
        c = s.case(f"pdf-flags-{name}", f"PDFUNDERLAY flags 280={flags}", tags=["PDFUNDERLAY", "flags"], questions=[q], params={"flags": flags})
        u = base(c)
        u.dxf.flags = flags
        c.window((0, 0), (200, 150))
    # Q-0663 fade/contrast
    for fade, contrast in ((50, 100), (80, 100), (0, 20), (0, 60), (50, 20)):
        c = s.case(f"pdf-fade{fade:02d}-contrast{contrast:03d}", f"PDFUNDERLAY fade 282={fade}, contrast 281={contrast}", tags=["PDFUNDERLAY", "fade", "contrast"], questions=["Q-0663"], params={"fade": fade, "contrast": contrast})
        u = base(c)
        u.dxf.fade = fade
        u.dxf.contrast = contrast
        c.window((0, 0), (200, 150))
    # Q-0664 layers (only the default state can be probed from DXF)
    c = s.case("pdf-layers", "PDFUNDERLAY of a PDF with two OCG layers (Red, Blue); re-save shows default layer-state storage", tags=["PDFUNDERLAY", "layers"], questions=["Q-0664"])
    base(c)
    c.window((0, 0), (200, 150))
    # Q-0665 PDFFRAME storage guesses
    for fv in (0, 1, 2):
        c = s.case(f"pdfframe-dictvar-{fv}", f"PDFUNDERLAY with DICTIONARYVAR PDFFRAME={fv} (storage guess; re-save shows where AutoCAD keeps PDFFRAME)", tags=["PDFUNDERLAY", "PDFFRAME"], questions=["Q-0665"], params={"pdfframe": fv})
        base(c)
        c.doc.rootdict.get_required_dict("AcDbVariableDictionary").set_or_add_dict_var("PDFFRAME", str(fv))
        c.window((0, 0), (200, 150))
