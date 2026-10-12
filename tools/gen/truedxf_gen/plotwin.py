"""Plot-window helpers.

docs/fixtures.md: for window plots the window aspect ratio must equal the canvas aspect ratio so
that "Fit" yields an exact, known scale. All helpers here produce windows whose size is exactly
``canvas / pixels_per_unit`` with a "nice" pixels-per-unit value.
"""

from __future__ import annotations

import math
from typing import Sequence

# Paper sizes in the truedxf PC3/PMP (docs/fixtures.md; tools/acad/README.md is authoritative).
# 1600x1200 is the margins sheet (10/20/30/40 px unprintable margins, tools/acad/src/sizes.ts);
# 1017x1013 and 1030x1017 (margins 3/7/11/13 px) probe the fill-style tile anchor (note 06 §6.8)
CANVASES: tuple[tuple[int, int], ...] = (
    (2000, 1500), (1000, 1000), (800, 600), (1600, 1200), (1017, 1013), (1030, 1017)
)
DEFAULT_CANVAS = (2000, 1500)


def _nice_scales() -> list[float]:
    out: list[float] = []
    for k in range(-4, 5):
        for m in (1, 2, 2.5, 4, 5, 8):
            out.append(float(f"{m}e{k}"))
    return sorted(out)


NICE_SCALES = _nice_scales()


def _r(v: float) -> float:
    """Round to 9 significant decimals so printed JSON numbers are short and stable."""
    r = round(v, 9)
    return 0.0 if r == 0 else r


def check_canvas(canvas: Sequence[int]) -> tuple[int, int]:
    c = (int(canvas[0]), int(canvas[1]))
    if c not in CANVASES:
        raise ValueError(f"canvas {c} is not a harness paper size {CANVASES}")
    return c


def check_window(
    vmin: Sequence[float], vmax: Sequence[float], canvas: Sequence[int]
) -> None:
    w = vmax[0] - vmin[0]
    h = vmax[1] - vmin[1]
    if w <= 0 or h <= 0:
        raise ValueError(f"empty plot window {vmin} {vmax}")
    cw, ch = canvas
    if abs(w * ch - h * cw) > 1e-9 * max(w * ch, h * cw):
        raise ValueError(
            f"plot window {w} x {h} does not match canvas aspect {cw} x {ch}"
        )


def window_at(
    center: Sequence[float], px_per_unit: float, canvas: Sequence[int] = DEFAULT_CANVAS
) -> tuple[tuple[float, float], tuple[float, float]]:
    """Window of exactly canvas/px_per_unit units, centred on ``center``."""
    cw, ch = check_canvas(canvas)
    w = cw / px_per_unit
    h = ch / px_per_unit
    x0 = center[0] - w / 2
    y0 = center[1] - h / 2
    # snap the lower-left corner to whole device pixels
    x0 = math.floor(x0 * px_per_unit + 0.5) / px_per_unit
    y0 = math.floor(y0 * px_per_unit + 0.5) / px_per_unit
    return (_r(x0), _r(y0)), (_r(x0 + w), _r(y0 + h))


def window_from(
    origin: Sequence[float], px_per_unit: float, canvas: Sequence[int] = DEFAULT_CANVAS
) -> tuple[tuple[float, float], tuple[float, float]]:
    """Window with lower-left corner ``origin`` and exact scale ``px_per_unit``."""
    cw, ch = check_canvas(canvas)
    return (_r(origin[0]), _r(origin[1])), (
        _r(origin[0] + cw / px_per_unit),
        _r(origin[1] + ch / px_per_unit),
    )


def fit_window(
    bmin: Sequence[float],
    bmax: Sequence[float],
    canvas: Sequence[int] = DEFAULT_CANVAS,
    margin: float = 0.05,
) -> tuple[tuple[float, float], tuple[float, float], float]:
    """Smallest window with a nice scale that contains the box plus ``margin`` (fraction of the
    box size on every side). Returns (min, max, px_per_unit)."""
    cw, ch = check_canvas(canvas)
    bw = max(bmax[0] - bmin[0], 1e-9)
    bh = max(bmax[1] - bmin[1], 1e-9)
    need_w = bw * (1 + 2 * margin)
    need_h = bh * (1 + 2 * margin)
    best = NICE_SCALES[0]
    for s in NICE_SCALES:
        if need_w * s <= cw and need_h * s <= ch:
            best = s
    c = ((bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2)
    vmin, vmax = window_at(c, best, canvas)
    return vmin, vmax, best
