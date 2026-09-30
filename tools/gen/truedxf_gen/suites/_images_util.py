"""Deterministic raster/PDF sources and IMAGE/WIPEOUT/UNDERLAY helpers for the `images` suite.

All bitmaps are drawn pixel by pixel (no fonts, no antialiasing) and written by Pillow without
metadata at a fixed compression level, so the bytes only depend on this code and the Pillow
version. The PDF is written by PyMuPDF without /ID and with empty metadata.
"""

from __future__ import annotations

import io
import re
from typing import Iterable, Optional, Sequence

from PIL import Image as PILImage

# --------------------------------------------------------------------------------------------
# bitmaps


def png_bytes(im: PILImage.Image) -> bytes:
    bio = io.BytesIO()
    im.save(bio, "PNG", optimize=False, compress_level=9)
    return bio.getvalue()


def tiff_bytes(im: PILImage.Image) -> bytes:
    bio = io.BytesIO()
    im.save(bio, "TIFF")  # uncompressed, no software/date tags
    return bio.getvalue()


def _f_mask(w: int, h: int) -> set[tuple[int, int]]:
    """Pixels of an asymmetric "F" (x right, y down), so flips/rotations are obvious."""
    px: set[tuple[int, int]] = set()
    sw = max(1, w // 8)  # stroke width
    sh = max(1, h // 8)
    x0, x1 = w // 4, (3 * w) // 4
    y0, y1 = (3 * h) // 20, (17 * h) // 20
    xm = (3 * w) // 5
    ym = (9 * h) // 20
    for y in range(y0, y1):
        for x in range(x0, x0 + sw):
            px.add((x, y))
    for y in range(y0, y0 + sh):
        for x in range(x0, x1):
            px.add((x, y))
    for y in range(ym, ym + sh):
        for x in range(x0, xm):
            px.add((x, y))
    return px


CORNERS = {
    "top-left": (255, 0, 0),
    "top-right": (0, 200, 0),
    "bottom-left": (0, 0, 255),
    "bottom-right": (255, 0, 255),
}


def f_image(w: int, h: int, grid: int = 8) -> PILImage.Image:
    """RGB: gradient background (R grows to the right, G grows downwards, B=96), white 1-px grid
    lines every `grid` px, black "F", one coloured marker pixel in each corner."""
    im = PILImage.new("RGB", (w, h))
    f = _f_mask(w, h)
    for y in range(h):
        for x in range(w):
            if (x, y) in f:
                c = (0, 0, 0)
            elif grid and (x % grid == grid - 1 or y % grid == grid - 1):
                c = (255, 255, 255)
            else:
                c = (round(255 * x / max(1, w - 1)), round(255 * y / max(1, h - 1)), 96)
            im.putpixel((x, y), c)
    im.putpixel((0, 0), CORNERS["top-left"])
    im.putpixel((w - 1, 0), CORNERS["top-right"])
    im.putpixel((0, h - 1), CORNERS["bottom-left"])
    im.putpixel((w - 1, h - 1), CORNERS["bottom-right"])
    return im


PALETTE12 = [
    (255, 0, 0), (0, 160, 0), (0, 0, 255), (255, 200, 0),
    (0, 200, 200), (200, 0, 200), (0, 0, 0), (255, 255, 255),
    (128, 64, 0), (128, 128, 128), (255, 128, 128), (64, 0, 128),
]


def distinct_image(w: int, h: int) -> PILImage.Image:
    """Every pixel a distinct colour (row-major from the top-left) — for pixel-exact clip tests."""
    im = PILImage.new("RGB", (w, h))
    for y in range(h):
        for x in range(w):
            im.putpixel((x, y), PALETTE12[(y * w + x) % len(PALETTE12)])
    return im


def two_by_two() -> PILImage.Image:
    im = PILImage.new("RGB", (2, 2))
    im.putpixel((0, 0), (0, 0, 0))
    im.putpixel((1, 0), (255, 255, 255))
    im.putpixel((0, 1), (255, 0, 0))
    im.putpixel((1, 1), (0, 0, 255))
    return im


def ramp_image() -> PILImage.Image:
    """16x8: rows 0-1 gray ramp, 2-3 red, 4-5 green, 6-7 blue; column i has value 17*i."""
    im = PILImage.new("RGB", (16, 8))
    for x in range(16):
        v = 17 * x
        for y in range(8):
            band = y // 2
            c = [(v, v, v), (v, 0, 0), (0, v, 0), (0, 0, v)][band]
            im.putpixel((x, y), c)
    return im


def rgba_image(w: int = 64, h: int = 48) -> PILImage.Image:
    """F image with alpha ramp 0..255 left to right, an opaque bottom band (8 rows) and a fully
    transparent square hole in the middle."""
    base = f_image(w, h)
    im = PILImage.new("RGBA", (w, h))
    for y in range(h):
        for x in range(w):
            r, g, b = base.getpixel((x, y))
            a = round(255 * x / (w - 1))
            if y >= h - 8:
                a = 255
            if w * 3 // 8 <= x < w * 5 // 8 and h * 3 // 8 <= y < h * 5 // 8:
                a = 0
            im.putpixel((x, y), (r, g, b, a))
    return im


def bitonal_image(w: int = 64, h: int = 48, invert: bool = False) -> PILImage.Image:
    """1-bit: F and a 1-px checkerboard border ring (width 4) are black (0) on white (1) like a
    scanned drawing; invert=True stores them as white (1) on black (0)."""
    im = PILImage.new("1", (w, h), 0)
    f = _f_mask(w, h)
    for y in range(h):
        for x in range(w):
            ring = x < 4 or y < 4 or x >= w - 4 or y >= h - 4
            on = (x, y) in f or (ring and (x + y) % 2 == 0)
            im.putpixel((x, y), 1 if on == invert else 0)
    return im


def indexed_image(w: int = 32, h: int = 24) -> PILImage.Image:
    """Palette (P) image with 4 colours: quadrants red/green/blue/yellow + black F."""
    im = PILImage.new("P", (w, h))
    im.putpalette([255, 0, 0, 0, 160, 0, 0, 0, 255, 255, 220, 0, 0, 0, 0] + [0] * (256 * 3 - 15))
    f = _f_mask(w, h)
    for y in range(h):
        for x in range(w):
            if (x, y) in f:
                i = 4
            else:
                i = (1 if x >= w // 2 else 0) + (2 if y >= h // 2 else 0)
            im.putpixel((x, y), i)
    return im


def gray_image(w: int = 64, h: int = 48) -> PILImage.Image:
    """8-bit grayscale (L): horizontal ramp, black F, white 1-px grid every 8 px."""
    im = PILImage.new("L", (w, h))
    f = _f_mask(w, h)
    for y in range(h):
        for x in range(w):
            if (x, y) in f:
                v = 0
            elif x % 8 == 7 or y % 8 == 7:
                v = 255
            else:
                v = round(40 + 200 * x / (w - 1))
            im.putpixel((x, y), v)
    return im


def pattern_image(w: int = 256, h: int = 192) -> PILImage.Image:
    """Resampling probe: quadrants with 1-px checkerboard (top-left), 2-px checkerboard
    (top-right), 1-px horizontal lines every 2 rows (bottom-left), 1-px vertical lines every 4
    columns (bottom-right); a red 1-px frame around the whole bitmap."""
    im = PILImage.new("RGB", (w, h), (255, 255, 255))
    hw, hh = w // 2, h // 2
    for y in range(h):
        for x in range(w):
            if x < hw and y < hh:
                on = (x + y) % 2 == 0
            elif y < hh:
                on = ((x // 2) + (y // 2)) % 2 == 0
            elif x < hw:
                on = y % 2 == 0
            else:
                on = x % 4 == 0
            if on:
                im.putpixel((x, y), (0, 0, 0))
            if x in (0, w - 1) or y in (0, h - 1):
                im.putpixel((x, y), (255, 0, 0))
    return im


# --------------------------------------------------------------------------------------------
# PDF


def pdf_bytes() -> bytes:
    """One 4 x 3 inch page (288 x 216 pt): pale yellow background, black border, black "F",
    a red square on OCG "Red", a blue disc on OCG "Blue", thin green grid lines, a white box."""
    import pymupdf

    d = pymupdf.open()
    p = d.new_page(width=288, height=216)
    ocg_red = d.add_ocg("Red", on=True)
    ocg_blue = d.add_ocg("Blue", on=True)
    R = pymupdf.Rect
    p.draw_rect(R(0, 0, 288, 216), color=None, fill=(1, 1, 0.85), width=0)
    p.draw_rect(R(4, 4, 284, 212), color=(0, 0, 0), fill=None, width=2)
    # "F" (PDF y grows downwards here)
    p.draw_rect(R(40, 30, 58, 186), color=None, fill=(0, 0, 0), width=0)
    p.draw_rect(R(40, 30, 130, 48), color=None, fill=(0, 0, 0), width=0)
    p.draw_rect(R(40, 98, 110, 116), color=None, fill=(0, 0, 0), width=0)
    p.draw_rect(R(160, 24, 260, 94), color=(0.5, 0, 0), fill=(1, 0, 0), width=1, oc=ocg_red)
    p.draw_circle((210, 150), 40, color=(0, 0, 0.5), fill=(0, 0, 1), width=1, oc=ocg_blue)
    for i in range(6):
        y = 130 + 10 * i
        p.draw_line((70, y), (140, y), color=(0, 0.6, 0), width=0.5)
    p.draw_rect(R(150, 170, 180, 200), color=(0, 0, 0), fill=(1, 1, 1), width=0.5)
    d.set_metadata({})
    data = d.tobytes(garbage=4, deflate=True, no_new_id=True)
    d.close()
    return data


# --------------------------------------------------------------------------------------------
# DXF byte filters


def set_class_instance_count(name: str, count: int):
    """CLASS record `name`: replace group 91 (instance count, R2004+) by `count`."""
    pat = re.compile(
        rb"(  0\r?\nCLASS\r?\n  1\r?\n" + re.escape(name.encode()) + rb"\r?\n(?:.*\r?\n.*\r?\n)*? 91\r?\n)(-?\d+)"
    )

    def f(data: bytes) -> bytes:
        new, n = pat.subn(lambda m: m.group(1) + str(count).encode(), data, count=1)
        if n != 1:
            raise ValueError(f"CLASS {name} 91 not found")
        return new

    return f


def insert_extrusion(dxftype: str, extrusion: Sequence[float]):
    """Insert 210/220/230 after the 12/22/32 (v vector) of every `dxftype` entity (IMAGE,
    WIPEOUT have no documented 210 — deliberately probing)."""
    pat = re.compile(
        rb"(  0\r?\n" + dxftype.encode() + rb"\r?\n(?:.*\r?\n.*\r?\n)*? 32\r?\n[^\r\n]*\r?\n)"
    )
    x, y, z = extrusion
    add = f"210\n{x}\n220\n{y}\n230\n{z}\n".encode()

    def f(data: bytes) -> bytes:
        nl = b"\r\n" if b"\r\n" in data[:200] else b"\n"
        new, n = pat.subn(lambda m: m.group(1) + add.replace(b"\n", nl), data)
        if n == 0:
            raise ValueError(f"{dxftype} v vector not found")
        return new

    return f


# --------------------------------------------------------------------------------------------
# geometry


def image_corners(insert, u, v, size) -> list[tuple[float, float]]:
    w, h = size
    ix, iy = insert[0], insert[1]
    ux, uy = u[0] * w, u[1] * w
    vx, vy = v[0] * h, v[1] * h
    return [(ix, iy), (ix + ux, iy + uy), (ix + ux + vx, iy + uy + vy), (ix + vx, iy + vy)]


def bbox(points: Iterable[Sequence[float]]):
    pts = list(points)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys)), (max(xs), max(ys))


def pixel_to_wcs(insert, u, v, size, p):
    """IMAGE pixel/clip coordinate (x right, y down, (-0.5,-0.5) = top-left corner) -> WCS."""
    h = size[1]
    ox = insert[0] + 0.5 * u[0] - 0.5 * v[0]
    oy = insert[1] + 0.5 * u[1] - 0.5 * v[1]
    return (ox + p[0] * u[0] + (h - p[1]) * v[0], oy + p[0] * u[1] + (h - p[1]) * v[1])


def opt(x: Optional[float], d: float) -> float:
    return d if x is None else x
