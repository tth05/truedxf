"""Shared helpers for the blocks / xclip / mline suites (not a suite: leading underscore)."""

from __future__ import annotations

from typing import Any, Sequence

# Asymmetric "F" outline (block coordinates, 30 x 50) - shows rotation, mirroring and shear.
F_OUTLINE = [
    (0, 0), (0, 50), (30, 50), (30, 42), (8, 42), (8, 29), (22, 29), (22, 21), (8, 21), (8, 0),
]


def f_block(doc, name: str = "F", base: Sequence[float] = (5, 3), attribs: Any = None):
    """Block with a closed F outline, a circle (r 5 at (20,8)) and a short tick at the base
    point. Returns the BlockLayout."""
    blk = doc.blocks.new(name, base_point=(base[0], base[1]))
    a = dict(attribs or {})
    blk.add_lwpolyline(F_OUTLINE, close=True, dxfattribs=a)
    blk.add_circle((20, 8), 5, dxfattribs=a)
    blk.add_line((base[0] - 2, base[1]), (base[0] + 2, base[1]), dxfattribs=a)
    return blk


def ref_layer(c, color: int = 8) -> str:
    return c.layer("REF", color=color, lineweight=0)


def cross(c, p: Sequence[float], size: float = 3.0, layout=None) -> None:
    """Reference cross on layer REF (colour 8, hairline)."""
    ref_layer(c)
    lay = layout if layout is not None else c.msp
    x, y = p[0], p[1]
    lay.add_line((x - size, y), (x + size, y), dxfattribs={"layer": "REF"})
    lay.add_line((x, y - size), (x, y + size), dxfattribs={"layer": "REF"})


def zero_scale_filter(sentinel: str):
    """bytes filter replacing a sentinel float value by 0.0 (ezdxf refuses 0 scale factors)."""
    needle = f"\n{sentinel}\n".encode()

    def f(data: bytes) -> bytes:
        assert needle in data, "sentinel not found"
        return data.replace(needle, b"\n0.0\n")

    return f
