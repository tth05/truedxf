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
):
    lay = c.doc.layouts.get(layout)
    if layout != "Model":
        lay.page_setup(size=(2000, 1500), margins=(0, 0, 0, 0), units="mm", rotation=rotation,
                       name="truedxf", device=RASTER_DEVICE)
        main = lay.main_viewport()
        if main is not None:
            main.dxf.layer = "0"
    d = lay.dxf_layout.dxf
    d.plot_configuration_file = RASTER_DEVICE
    d.paper_size = RASTER_MEDIA
    d.plot_paper_units = 2
    d.paper_width, d.paper_height = 2000.0, 1500.0
    for k in ("left_margin", "bottom_margin", "right_margin", "top_margin"):
        setattr(d, k, 0.0)
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
         "window": [list(p) for p in window] if window else None, "offset": list(offset)}
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
