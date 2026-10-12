"""Page setups plotted as stored (research/notes/08 §2, §5): the harness runs a non-detailed
-PLOT (``plot.mode = "pagesetup"``), so every PLOTSETTINGS value of the layout is AutoCAD's input:
rotation 73, plot type 74 + window 48/49/140/141, scale 75/142/143/147 and flag 16, flags 32/64/128,
style sheet 7, offsets 46/47. The ``save-*`` cases go the other way: a detailed -PLOT that saves
its page setup, then DXFOUT shows what AutoCAD writes (75, 142/143, 147, 70, 4, 44/45, 46/47).

Raster page setups (device ``truedxf PNG.pc3``) use the canonical media name AutoCAD writes for
the harness sizes, ``UserDefinedRaster (2000.00 x 1500.00Pixels)``, 72 = 2 and 44/45 in pixels
(VERIFIED-BY-ACAD 2026-10-12, DXFOUT after -PLOT with Save = Yes). Paper-space content is in
paper units = pixels: an asymmetric target (frame, filled square at the origin, +X arrow, +Y bar).
"""

from __future__ import annotations

from typing import Any, Optional, Sequence

from ..core import Case, SuiteBuilder, suite
from ..plotstyle import ctb_bytes, rgb_color
from ._appearance_util import solid_rect

RASTER_DEVICE = "truedxf PNG.pc3"
RASTER_MEDIA = "UserDefinedRaster (2000.00 x 1500.00Pixels)"
PDF_DEVICE = "truedxf PDF.pc3"
# The margins sheet (tools/acad/src/sizes.ts CANVAS_MARGINS): 1600 x 1200 px / 16 x 12 in with
# unprintable margins left/bottom/right/top = 10/20/30/40 px = 0.10/0.20/0.30/0.40 in.
MARGIN_CANVAS = (1600, 1200)
MARGINS_PX = (10, 20, 30, 40)
MARGIN_MEDIA_PNG = "UserDefinedRaster (1600.00 x 1200.00Pixels)"
MARGIN_MEDIA_PDF = "UserDefinedImperial (16.00 x 12.00Inches)"


def _raster_setup(
    c: Case,
    rotation: int = 0,
    plot_type: int = 5,
    flags: int = 688,
    std_scale: int = 16,
    num_den: Sequence[float] = (1, 1),
    unit_factor: Optional[float] = None,
    style_sheet: str = "acad.ctb",
    window: Optional[Sequence[Sequence[float]]] = None,
    offset: Sequence[float] = (0, 0),
    layout: str = "Layout1",
    canvas: Sequence[int] = (2000, 1500),
    margins: Sequence[float] = (0, 0, 0, 0),
    device: str = RASTER_DEVICE,
    media: str = RASTER_MEDIA,
    paper_units: int = 2,
    paper_size: Optional[Sequence[float]] = None,
    image_origin: Sequence[float] = (0, 0),
):
    """Stored page setup. ``margins`` = 40/41/42/43 (left, bottom, right, top) as written to the
    DXF; ``paper_size`` = 44/45 (default: the canvas in pixels)."""
    lay = c.doc.layouts.get(layout)
    w, h = paper_size if paper_size is not None else canvas
    if layout != "Model":
        lay.page_setup(size=(w, h), margins=(0, 0, 0, 0), units="mm", rotation=rotation,
                       name="truedxf", device=device)
        main = lay.main_viewport()
        if main is not None:
            main.dxf.layer = "0"
    d = lay.dxf_layout.dxf
    d.plot_configuration_file = device
    d.paper_size = media
    d.plot_paper_units = paper_units
    d.paper_width, d.paper_height = float(w), float(h)
    for k, v in zip(("left_margin", "bottom_margin", "right_margin", "top_margin"), margins):
        setattr(d, k, float(v))
    d.paper_image_origin_x, d.paper_image_origin_y = image_origin
    d.plot_rotation = rotation
    d.plot_type = plot_type
    d.plot_layout_flags = flags
    d.standard_scale_type = std_scale
    d.scale_numerator, d.scale_denominator = num_den
    d.unit_factor = unit_factor if unit_factor is not None else num_den[0] / num_den[1]
    d.current_style_sheet = style_sheet
    d.plot_origin_x_offset, d.plot_origin_y_offset = offset
    if window:
        (d.plot_window_x1, d.plot_window_y1), (d.plot_window_x2, d.plot_window_y2) = window
    c.params.setdefault("page_setup", {}).update(
        {"rotation": rotation, "plot_type": plot_type, "flags": flags, "std_scale": std_scale,
         "num_den": list(num_den), "147": d.unit_factor, "style_sheet": style_sheet,
         "window": [list(p) for p in window] if window else None, "offset": list(offset),
         "device": device, "media": media, "72": paper_units, "40-43": list(margins),
         "44/45": [w, h], "148/149": list(image_origin)}
    )
    return lay


def _target(space, s: float = 1.0, color: int = 1, lw: int = 0):
    """Asymmetric target in the square (0,0)-(1400s,1400s): frame (10..1390), filled square
    at the origin corner (20..120), +X arrow along y=700, +Y bar along x=300."""
    a = {"color": color, "lineweight": lw}
    p = lambda x, y: (x * s, y * s)  # noqa: E731
    space.add_lwpolyline([p(10, 10), p(1390, 10), p(1390, 1390), p(10, 1390)], close=True, dxfattribs=a)
    solid_rect(space, 20 * s, 20 * s, 120 * s, 120 * s, {"color": 5})
    space.add_line(p(200, 700), p(1200, 700), dxfattribs=a)
    space.add_lwpolyline([p(1150, 750), p(1200, 700), p(1150, 650)], dxfattribs=a)
    solid_rect(space, 290 * s, 800 * s, 310 * s, 1300 * s, {"color": 3})


def _pagesetup_plot(c: Case, layout: str = "Layout1", area: Optional[dict] = None) -> None:
    if area is None:
        c.plot_layout(layout)
    else:
        c.plot.layout = layout
        c.plot.area = area
        c._plot_set = True
    c.plot.extra["mode"] = "pagesetup"
    c.plot.canvas = (2000, 1500)


@suite("pagesetup", "Page setups (PLOTSETTINGS) plotted as stored, and as written by AutoCAD", style_table="acad.ctb")
def build(s: SuiteBuilder) -> None:
    _rotation(s)
    _scale(s)
    _flags(s)
    _offset_window(s)
    _save(s)
    _margins(s)
    _pdf_offsets(s)
    _image_origin(s)


def _rotation(s: SuiteBuilder) -> None:
    for rot in range(4):
        for ptype, pname in ((5, "layout"), (4, "window")):
            c = s.case(
                f"rot-{rot}-{pname}",
                f"Raster page setup 2000x1500 px, rotation 73={rot}, plot type {pname}"
                + (" (48/49=(0,0), 140/141=(1400,1050), Fit, centred)" if ptype == 4 else " (1:1)"),
                tags=["PLOTSETTINGS", "rotation", "pagesetup"],
                questions=["Q-0706", "Q-0253"],
                outputs=["png"],
            )
            win = ((0, 0), (1400, 1050)) if ptype == 4 else None
            flags = 688 if ptype == 5 else (688 | 4)
            _raster_setup(c, rotation=rot, plot_type=ptype, window=win, flags=flags,
                          std_scale=16 if ptype == 5 else 0)
            _target(c.doc.layouts.get("Layout1"), s=0.75)
            _pagesetup_plot(c, area={"type": "window", "min": [0, 0], "max": [1400, 1050]} if win else None)


def _scale(s: SuiteBuilder) -> None:
    # window plot (0,0)-(1400,1400) at different stored scales: the plotted size tells which value wins
    variants = [
        ("std-1-2-flag16", "flag 16 on, 75=17 (1:2), 142/143=1:1, 147=0.5", 688, 17, (1, 1), 0.5),
        ("std-1-2-noflag16", "flag 16 off, 75=17 (1:2), 142/143=1:1, 147=0.5", 688 & ~16, 17, (1, 1), 0.5),
        ("custom-1-2-flag16", "flag 16 on, 75=16 (1:1), 142/143=1:2, 147=1.0", 688, 16, (1, 2), 1.0),
        ("custom-1-2-noflag16", "flag 16 off, 75=16 (1:1), 142/143=1:2, 147=1.0", 688 & ~16, 16, (1, 2), 1.0),
        ("std147-flag16", "flag 16 on, 75=16 (1:1), 142/143=1:1, 147=0.5", 688, 16, (1, 1), 0.5),
        ("fit-0-flag16", "flag 16 on, 75=0 (fit), 142/143=1:1, 147=1.0", 688, 0, (1, 1), 1.0),
    ]
    for name, what, flags, std, nd, uf in variants:
        c = s.case(
            f"scale-{name}",
            f"Raster page setup, plot type window (0,0)-(1400,1400) not centred: {what}",
            tags=["PLOTSETTINGS", "scale", "pagesetup"],
            questions=["Q-0255", "Q-0754"],
            outputs=["png"],
        )
        _raster_setup(c, plot_type=4, flags=flags, std_scale=std, num_den=nd, unit_factor=uf,
                      window=((0, 0), (1400, 1400)))
        _target(c.doc.layouts.get("Layout1"))
        _pagesetup_plot(c, area={"type": "window", "min": [0, 0], "max": [2000, 1500]})


def _flags(s: SuiteBuilder) -> None:
    pens = {1: {"color": rgb_color(0, 0, 255), "color_policy": 5, "lineweight": 21}}  # blue, 1.00 mm
    variants = [
        ("styles-on", "flags 688 (32 plot styles on, 128 lineweights on)", 688),
        ("styles-off", "flags 688-32 (plot styles off)", 688 & ~32),
        ("lw-off", "flags 688-128 (plot lineweights off)", 688 & ~128),
        ("styles-lw-off", "flags 688-32-128", 688 & ~32 & ~128),
    ]
    for name, what, flags in variants:
        c = s.case(
            f"flags-{name}",
            f"Stored style sheet truedxf-pagesetup-pens.ctb (pen 1 = blue, 1.00 mm), {what}; red lines with object lineweight 0.50 mm",
            tags=["PLOTSETTINGS", "CTB", "flags", "pagesetup"],
            questions=["Q-0258", "Q-0755"],
            outputs=["png"],
        )
        c.plot_style_table("truedxf-pagesetup-pens.ctb", ctb_bytes(pens))
        _raster_setup(c, flags=flags, style_sheet="truedxf-pagesetup-pens.ctb")
        _target(c.doc.layouts.get("Layout1"), lw=50)
        _pagesetup_plot(c)

    # scale lineweights (flag 64) at a 1:2 custom scale
    for flag64 in (0, 64):
        c = s.case(
            f"scale-lw-{'on' if flag64 else 'off'}",
            f"Window (0,0)-(1400,1400) at 142/143 = 1:2 (flag 16 off), red lines with object lineweight 2.00 mm; flag 64 {'on' if flag64 else 'off'}",
            tags=["PLOTSETTINGS", "lineweight", "scale", "pagesetup"],
            questions=["Q-0756"],
            outputs=["png"],
        )
        _raster_setup(c, plot_type=4, flags=(688 & ~16) | flag64, std_scale=16, num_den=(1, 2),
                      unit_factor=1.0, window=((0, 0), (1400, 1400)))
        _target(c.doc.layouts.get("Layout1"), lw=200)
        _pagesetup_plot(c, area={"type": "window", "min": [0, 0], "max": [2000, 1500]})


def _offset_window(s: SuiteBuilder) -> None:
    c = s.case(
        "offset-layout",
        "Raster page setup, plot type layout 1:1, plot offset 46/47 = (100, 50)",
        tags=["PLOTSETTINGS", "offset", "pagesetup"],
        questions=["Q-0705", "Q-0757"],
        outputs=["png"],
    )
    _raster_setup(c, offset=(100, 50))
    _target(c.doc.layouts.get("Layout1"), s=0.75)
    _pagesetup_plot(c)

    c = s.case(
        "offset-window",
        "Raster page setup, plot type window (0,0)-(1400,1050) 1:1 not centred, plot offset 46/47 = (100, 50)",
        tags=["PLOTSETTINGS", "offset", "pagesetup"],
        questions=["Q-0757"],
        outputs=["png"],
    )
    _raster_setup(c, plot_type=4, window=((0, 0), (1400, 1050)), offset=(100, 50))
    _target(c.doc.layouts.get("Layout1"), s=0.75)
    _pagesetup_plot(c, area={"type": "window", "min": [0, 0], "max": [2000, 1500]})

    # model space page setup: window corners 48/49 vs 140/141
    c = s.case(
        "model-window",
        "Model page setup: plot type window 48/49=(100,100) 140/141=(500,400), Fit, centred; target 0..1400 in model space",
        tags=["PLOTSETTINGS", "plot-window", "pagesetup"],
        questions=["Q-0254"],
        outputs=["png"],
    )
    _raster_setup(c, layout="Model", plot_type=4, flags=1712 | 4, std_scale=0,
                  window=((100, 100), (500, 400)))
    _target(c.msp)
    _pagesetup_plot(c, layout="Model", area={"type": "window", "min": [100, 100], "max": [500, 400]})


def _save(s: SuiteBuilder) -> None:
    """Detailed -PLOT on the PDF device with Save = Yes, then DXFOUT (AutoCAD-authored 75/147)."""
    variants = [
        ("mm-1-50", "mm", "1:50"),
        ("mm-1-100", "mm", "1:100"),
        ("mm-1-5", "mm", "1:5"),
        ("mm-custom-1-3", "mm", "1=3"),
        ("mm-fit", "mm", "fit"),
        ("inch-1-1", "inches", "1:1"),
        ("inch-1-50", "inches", "1=50"),
        ("inch-quarter-foot", "inches", "1/4\"=1'"),
    ]
    for name, units, scale in variants:
        c = s.case(
            f"save-{name}",
            f"-PLOT layout window (0,0)-(400,300) on truedxf PDF, paper units {units}, scale {scale}, Save = Yes; DXFOUT shows the page setup AutoCAD writes",
            tags=["PLOTSETTINGS", "scale", "units", "dxfout"],
            questions=["Q-0255", "Q-0258"],
            outputs=["pdf", "dxf"],
        )
        lay = c.doc.layouts.get("Layout1")
        lay.page_setup(size=(400, 300), margins=(0, 0, 0, 0), units="mm", name="truedxf", device="DWG To PDF.pc3")
        _target(lay, s=0.2)
        c.layout_window("Layout1", (0, 0), (400, 300))
        c.half_pixel_shift = False
        c.plot.area = {"type": "window", "min": [0, 0], "max": [400, 300]}
        c.plot.scale = scale
        c.plot.extra.update({"paperUnits": units, "savePageSetup": True, "scaleLineweights": name == "mm-1-50"})


# --- unprintable margins x rotation (Q-0706), offsets on mm/inch setups (Q-0757), 148/149 (Q-0256)


def _margin_target(space, u: float = 1.0) -> None:
    """Paper-space probe in paper units (``u`` = paper units per sheet pixel): a cyan SOLID far
    larger than the sheet (clipped to the printable area, so its edges show the margins), a blue
    100 x 100 square at the origin, a red +X bar and a green +Y bar."""
    solid_rect(space, -3000 * u, -3000 * u, 3000 * u, 3000 * u, {"color": 4})
    solid_rect(space, 0, 0, 100 * u, 100 * u, {"color": 5})
    solid_rect(space, 100 * u, 0, 600 * u, 30 * u, {"color": 1})
    solid_rect(space, 0, 100 * u, 30 * u, 400 * u, {"color": 3})


MARGIN_LAYOUT = (
    "probe in sheet pixels x u: cyan SOLID (-3000..3000)^2 clipped to the printable area, blue square "
    "(0,0)-(100,100), red +X bar (100,0)-(600,30), green +Y bar (0,100)-(30,400)"
)


def _margins(s: SuiteBuilder) -> None:
    for rot in range(4):
        for name, off in (("", (0, 0)), ("-offset", (100, 50))):
            c = s.case(
                f"margins-rot-{rot}{name}",
                f"Raster margins sheet 1600x1200 px (margins L/B/R/T 10/20/30/40 px, stored in 40-43), rotation 73={rot}, "
                f"plot type layout 1:1, offset 46/47={off}",
                tags=["PLOTSETTINGS", "margins", "rotation", "pagesetup"],
                questions=["Q-0706", "Q-0757"],
                params={"layout": MARGIN_LAYOUT, "u": 1},
                outputs=["png"],
            )
            _raster_setup(c, rotation=rot, canvas=MARGIN_CANVAS, margins=MARGINS_PX, media=MARGIN_MEDIA_PNG, offset=off)
            _margin_target(c.doc.layouts.get("Layout1"))
            _pagesetup_plot(c)
            c.plot.canvas = MARGIN_CANVAS
    c = s.case(
        "margins-rot-1-stored-zero",
        "As margins-rot-1, but 40-43 stored as 0: does PLOT take the margins from the device or from the DXF?",
        tags=["PLOTSETTINGS", "margins", "rotation", "pagesetup"],
        questions=["Q-0706"],
        params={"layout": MARGIN_LAYOUT, "u": 1},
        outputs=["png"],
    )
    _raster_setup(c, rotation=1, canvas=MARGIN_CANVAS, margins=(0, 0, 0, 0), media=MARGIN_MEDIA_PNG)
    _margin_target(c.doc.layouts.get("Layout1"))
    _pagesetup_plot(c)
    c.plot.canvas = MARGIN_CANVAS
    # PLOT uses the stored 40-43, so the PNG is the whole sheet (VERIFIED-BY-ACAD 2026-10-12)
    c.plot.extra["pngSize"] = list(MARGIN_CANVAS)
    # detailed -PLOT on the margins sheet with Save = Yes: what AutoCAD writes to 40-43 / 148/149
    orients = (("landscape", False), ("portrait", False), ("landscape", True), ("portrait", True))
    for rot, (orient, upside) in enumerate(orients):
        c = s.case(
            f"margins-detailed-{rot}",
            f"Detailed -PLOT of Layout1 (area Layout, 1:1, offset 0,0) on the margins sheet, {orient}"
            f"{' upside down' if upside else ''} (73={rot}), Save = Yes; DXFOUT shows 40-43, 46/47, 148/149",
            tags=["PLOTSETTINGS", "margins", "rotation", "dxfout"],
            questions=["Q-0706", "Q-0256"],
            params={"layout": MARGIN_LAYOUT, "u": 1},
            outputs=["png", "dxf"],
        )
        lay = c.doc.layouts.get("Layout1")
        lay.page_setup(size=(1600, 1200), margins=(0, 0, 0, 0), units="mm", name="truedxf", device=RASTER_DEVICE)
        _margin_target(lay)
        c.plot_layout("Layout1", canvas=MARGIN_CANVAS, scale="1:1")
        c.plot.extra.update({"orientation": orient, "upsideDown": upside, "savePageSetup": True})


def _pdf_offsets(s: SuiteBuilder) -> None:
    """PDF page setups (vector, 1/600 in device units) on the 16 x 12 in margins sheet: 46/47 =
    (5, 3) is 5 mm or 5 in depending on the unit AutoCAD applies; content in paper units."""
    wmm, hmm = 16 * 25.4, 12 * 25.4
    mm = [round(v * 0.254, 6) for v in MARGINS_PX]
    variants = [
        ("pdf-in-offset-0", 0, 0, (0, 0), {}),
        ("pdf-in-offset-5-3", 0, 0, (5, 3), {}),
        ("pdf-mm-offset-0", 1, 0, (0, 0), {}),
        ("pdf-mm-offset-5-3", 1, 0, (5, 3), {}),
        ("pdf-mm-offset-5-3-rot-1", 1, 1, (5, 3), {}),
        ("pdf-in-offset-5-3-rot-3", 0, 3, (5, 3), {}),
        ("pdf-mm-offset-5-3-plotoffset-1", 1, 0, (5, 3), {"PLOTOFFSET": 1}),
        ("pdf-mm-offset-0-plotoffset-1", 1, 0, (0, 0), {"PLOTOFFSET": 1}),
    ]
    for name, units, rot, off, sysvars in variants:
        uname = "inches" if units == 0 else "mm"
        u = 0.01 if units == 0 else 0.254
        c = s.case(
            name,
            f"PDF page setup on the margins sheet (16x12 in, margins 0.1/0.2/0.3/0.4 in), 72={units} ({uname}), 73={rot}, "
            f"plot type layout 1:1, 46/47={off}" + (f", sysvars {sysvars}" if sysvars else ""),
            tags=["PLOTSETTINGS", "offset", "units", "pagesetup", "pdf"],
            questions=["Q-0757", "Q-0706"],
            params={"layout": MARGIN_LAYOUT, "u": u},
            outputs=["pdf"],
        )
        _raster_setup(c, rotation=rot, canvas=MARGIN_CANVAS, margins=mm, device=PDF_DEVICE,
                      media=MARGIN_MEDIA_PDF, paper_units=units, paper_size=(wmm, hmm), offset=off)
        _margin_target(c.doc.layouts.get("Layout1"), u=u)
        _pagesetup_plot(c)
        c.plot.canvas = MARGIN_CANVAS
        for k, v in sysvars.items():
            c.sysvar(k, v)


def _image_origin(s: SuiteBuilder) -> None:
    """148/149: what AutoCAD writes (detailed -PLOT, Save = Yes, DXFOUT) and whether a stored value
    changes a plot of the stored page setup."""
    detailed = [
        # name, layout, window, scale, offset answer (None = Center), device, PDF paper units
        ("io-win-offset", "Layout1", ((10, 20), (410, 320)), "1:1", "30,40", "png", None),
        ("io-win-center", "Layout1", ((10, 20), (410, 320)), "1:1", None, "png", None),
        ("io-win-1-2", "Layout1", ((10, 20), (410, 320)), "1:2", "0,0", "png", None),
        ("io-layout-offset", "Layout1", None, "1:1", "30,40", "png", None),
        ("io-model-win", "Model", ((10, 20), (410, 320)), "1:1", "0,0", "png", None),
        ("io-pdf-in-win", "Layout1", ((10, 20), (410, 320)), "1=100", "0.3,0.4", "pdf", "inches"),
        ("io-pdf-mm-win", "Layout1", ((10, 20), (410, 320)), "1=4", "3,4", "pdf", "mm"),
    ]
    for name, layout, win, scale, off, dev, units in detailed:
        c = s.case(
            name,
            f"Detailed -PLOT of {layout} {'window ' + str(win) if win else 'area Layout'}, scale {scale}, "
            f"offset {off or 'Center'}, {dev}" + (f" ({units})" if units else "") + ", Save = Yes; DXFOUT shows 148/149",
            tags=["PLOTSETTINGS", "image-origin", "dxfout"],
            questions=["Q-0256"],
            outputs=[dev, "dxf"],
        )
        space = c.msp if layout == "Model" else c.doc.layouts.get("Layout1")
        if layout != "Model":
            space.page_setup(size=(2000, 1500), margins=(0, 0, 0, 0), units="mm", name="truedxf", device=RASTER_DEVICE)
        _target(space, s=0.3)
        c.half_pixel_shift = False
        if win:
            if layout == "Model":
                c.window(win[0], win[1])
            else:
                c.layout_window(layout, win[0], win[1])
        else:
            c.plot_layout(layout)
        c.plot.scale = scale
        c.plot.extra["savePageSetup"] = True
        if off is not None:
            c.plot.extra["offset"] = off
        if units:
            c.plot.extra["paperUnits"] = units

    for name, io, ptype in (
        ("io-read-win-0", (0, 0), 4),
        ("io-read-win-100-50", (100, 50), 4),
        ("io-read-win-neg", (-10, -20), 4),
        ("io-read-layout-0", (0, 0), 5),
        ("io-read-layout-100-50", (100, 50), 5),
    ):
        c = s.case(
            name,
            f"Raster page setup plotted as stored, plot type "
            f"{'window (10,20)-(410,320) 1:1 not centred' if ptype == 4 else 'layout 1:1'}, 148/149 = {io}",
            tags=["PLOTSETTINGS", "image-origin", "pagesetup"],
            questions=["Q-0256"],
            outputs=["png"],
        )
        win = ((10, 20), (410, 320)) if ptype == 4 else None
        _raster_setup(c, plot_type=ptype, window=win, image_origin=io)
        _target(c.doc.layouts.get("Layout1"), s=0.3)
        _pagesetup_plot(c, area={"type": "window", "min": [10, 20], "max": [410, 320]} if win else None)
