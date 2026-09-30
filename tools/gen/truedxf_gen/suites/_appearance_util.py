"""Small drawing helpers shared by the appearance suites (colors, lineweights, transparency,
draworder). Private module (leading underscore: not auto-imported as a suite)."""

from __future__ import annotations

from typing import Any, Optional, Sequence

from ezdxf.enums import TextEntityAlignment

# Harness plot options that the fixture metadata cannot express yet (tools/acad/src/script.ts has
# `plot.sysvars` / `plot.paperSpaceFirst` extensions, tools/gen core.Plot does not emit them).
# Cases record the intent under params["harness"] so the lead can lift it mechanically.
PLOT_TRANSPARENCY_ON = {"sysvars": {"PLOTTRANSPARENCYOVERRIDE": 2}}


def attrs_of(attrs: Optional[dict[str, Any]]) -> dict[str, Any]:
    return dict(attrs or {})


def solid_rect(space, x0: float, y0: float, x1: float, y1: float, attrs=None):
    """Axis-aligned filled SOLID rectangle (DXF vertex order 1-2-4-3)."""
    return space.add_solid([(x0, y0), (x1, y0), (x0, y1), (x1, y1)], dxfattribs=attrs_of(attrs))


def hatch_poly(space, pts: Sequence[Sequence[float]], attrs=None):
    """Solid-fill HATCH with one closed polyline path. ``attrs['color']`` defaults to BYLAYER
    (ezdxf's add_hatch would default to 7)."""
    a = attrs_of(attrs)
    color = a.pop("color", 256)
    h = space.add_hatch(color=color, dxfattribs=a)
    h.paths.add_polyline_path([(p[0], p[1]) for p in pts], is_closed=True)
    return h


def hatch_rect(space, x0: float, y0: float, x1: float, y1: float, attrs=None):
    return hatch_poly(space, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], attrs)


def label(c, space, text: str, x: float, y: float, h: float = 3.0,
          align: TextEntityAlignment = TextEntityAlignment.MIDDLE_CENTER):
    """Black (ACI 7), hairline TEXT on layer LABEL."""
    c.layer("LABEL", color=7, lineweight=0)
    t = space.add_text(text, height=h, dxfattribs={"layer": "LABEL"})
    t.set_placement((x, y), align=align)
    return t


def ref_line(c, space, p0, p1, color: int = 7):
    """Thin (lineweight 0) reference line on layer REF."""
    c.layer("REF", color=7, lineweight=0)
    return space.add_line(p0, p1, dxfattribs={"layer": "REF", "color": color})


def rgb(v: int) -> tuple[int, int, int]:
    return ((v >> 16) & 255, (v >> 8) & 255, v & 255)
