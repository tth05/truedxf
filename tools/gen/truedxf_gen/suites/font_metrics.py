"""Discriminate anchor phase, em size and large-coordinate CJK fringes (note 04 §15.2)."""

from __future__ import annotations

from ..core import SuiteBuilder, suite
from .font_resolution import _style


@suite("font-metrics", "CJK anchor phase, height and translated plot windows",
       fonts="acad", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    # Near/far pairs have exactly the same intended device coordinates. A difference in
    # AutoCAD's plots discriminates large-coordinate precision from ordinary GDI metrics.
    far = (-1693771.8719396493, 137862.7242351754)
    origins = [("near", (0.0, 0.0)), ("far", far)]
    for height in (299.8, 300.0, 300.2):
        for place, origin in origins:
            _case(s, f"simsun-h{str(height).replace('.', 'p')}-{place}", origin, height)
    for axis in ("x", "y"):
        for phase in (0.25, 0.5, 0.75):
            # The window spans 1800 world units / 2000 pixels. Move one anchor axis only;
            # shifting both would leave horizontal/vertical quantization indistinguishable.
            delta = phase * 0.9
            offset = (delta, 0.0) if axis == "x" else (0.0, delta)
            _case(s, f"simsun-phase-{axis}-{int(phase * 100):02d}", (0.0, 0.0), 300.0,
                  offset=offset)
    for height in (12.0, 12.1):
        for place, origin in origins:
            _case(s, f"simsun-h{str(height).replace('.', 'p')}-{place}", origin, height,
                  small=True)
    for place, origin in origins:
        _case(s, f"gbcbig-{place}", origin, 438.8652482269502, shx=True)


def _case(s, name, origin, height, *, offset=(0.0, 0.0), small=False, shx=False):
    c = s.case(name, "CJK text with controlled height, anchor and plot origin",
               tags=["TEXT", "font-metrics"], questions=["Q-0737"],
               params={"origin": origin, "height": height, "offset": offset,
                       "small": small, "shx": shx}, style_table="acad.ctb")
    st = (_style(c, "PROBE", "SIMPLEX", bigfont="GBCBIG") if shx else
          _style(c, "PROBE", family="SimSun", flags=34306))
    layer = c.layer("NATIVE", color=7 if shx else 255, lineweight=-3 if shx else 0)
    width, depth = (200.0, 150.0) if small else (1800.0, 1350.0)
    x = 10.0 if small else 100.0
    ys = (130.0, 40.0) if small else (900.0, 300.0)
    for text, y in zip(("弱电井", "冷媒"), ys):
        anchor = (origin[0] + x + offset[0], origin[1] + y + offset[1])
        c.msp.add_text(text, height=height, dxfattribs={
            "style": st, "layer": layer, "width": 0.7 if shx else 1.0, "insert": anchor,
        })
        # Independent crosses expose any whole-plot translation without altering text bounds.
        radius = 0.5 if small else 5.0
        c.msp.add_line((anchor[0] - radius, anchor[1]), (anchor[0] + radius, anchor[1]),
                       dxfattribs={"color": 8})
        c.msp.add_line((anchor[0], anchor[1] - radius), (anchor[0], anchor[1] + radius),
                       dxfattribs={"color": 8})
    c.window(origin, (origin[0] + width, origin[1] + depth), half_pixel=False)
