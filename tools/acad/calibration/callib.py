"""Shared helpers for the calibration analysis scripts (tools/acad/calibration/analyze_*.py)."""

from __future__ import annotations

import glob
import json
import math
import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
GEN = REPO / "samples" / "generated" / "calibration"


def refs_dir() -> Path:
    """Newest samples/refs/<acad-build>/calibration directory (override: TRUEDXF_REFS_BUILD)."""
    build = os.environ.get("TRUEDXF_REFS_BUILD")
    if build:
        return REPO / "samples" / "refs" / build / "calibration"
    dirs = sorted(glob.glob(str(REPO / "samples" / "refs" / "*" / "calibration")))
    if not dirs:
        raise SystemExit("no references; run node tools/acad/src/run.ts --suite calibration")
    return Path(dirs[-1])


class Case:
    def __init__(self, name: str):
        self.name = name
        self.meta: dict[str, Any] = json.loads((GEN / f"{name}.json").read_text(encoding="utf-8"))
        self.ref: dict[str, Any] = json.loads((refs_dir() / f"{name}.json").read_text(encoding="utf-8"))
        self.png_path = refs_dir() / f"{name}.png"
        self.pdf_path = refs_dir() / f"{name}.pdf"
        self._rgb: np.ndarray | None = None
        plot = self.meta["plot"]
        self.W, self.H = plot["canvas"]
        area = plot["area"]
        if area["type"] == "window":
            self.xmin, self.ymin = area["min"]
            self.xmax, self.ymax = area["max"]
            self.s = self.W / (self.xmax - self.xmin)

    @property
    def rgb(self) -> np.ndarray:
        if self._rgb is None:
            self._rgb = np.array(Image.open(self.png_path).convert("RGB"))
        return self._rgb

    @property
    def ink(self) -> np.ndarray:
        """Boolean mask of non-white pixels."""
        return self.rgb.min(axis=2) < 255

    # device coordinates: u to the right, v UP from the bottom edge, both in pixels, [0, W] x [0, H]
    def u(self, x: float) -> float:
        return (x - self.xmin) * self.s

    def v(self, y: float) -> float:
        return (y - self.ymin) * self.s


def pixel_index(t: float, n: int) -> int:
    """VERIFIED-BY-ACAD mapping of a device coordinate to a pixel index (FINDINGS.md §2):
    floor(t), except that exact integer ties above the centre line go to the lower pixel
    (ties round toward the canvas centre, so t = n maps to pixel n - 1)."""
    if t > n / 2 and t == math.floor(t):
        return int(t) - 1
    return math.floor(t)


def col_of(c: Case, x: float) -> int:
    return pixel_index(c.u(x), c.W)


def row_of(c: Case, y: float) -> int:
    """Image row (0 = top) of model y."""
    return c.H - 1 - pixel_index(c.v(y), c.H)


def runs(mask_1d: np.ndarray) -> list[tuple[int, int]]:
    """Inclusive (start, end) runs of True values."""
    out = []
    idx = np.flatnonzero(mask_1d)
    if idx.size == 0:
        return out
    start = prev = int(idx[0])
    for i in idx[1:]:
        i = int(i)
        if i != prev + 1:
            out.append((start, prev))
            start = i
        prev = i
    out.append((start, prev))
    return out
