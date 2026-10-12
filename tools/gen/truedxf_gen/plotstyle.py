"""CTB/STB plot style table writer for fixtures (research/notes/06 §6.3).

Text layout and key order follow the stock AutoCAD 2027 tables (only facts, no stock content is
copied): a PIA v2 container (tools/acad/src/pia.ts) around latin-1 text with one ``key=value`` per
line, one space of indent per level, strings opened with ``"`` and never closed.

Every pen/style defaults to "use object" for everything (colour -1, linetype 31, lineweight 0,
fill 73, end 4, join 5, screening 100, colour policy 1 = dithering), like acad.ctb. Overrides are
plain key/value dicts, e.g. ``{"color": rgb_color(255, 0, 0), "lineweight": 3}``; ``None`` removes
a key (e.g. ``{"mode_color": None}``).
"""

from __future__ import annotations

import zlib
from typing import Any, Mapping, Optional, Sequence

# Default custom_lineweight_table of the stock tables (mm), 27 entries.
DEFAULT_LINEWEIGHTS = (
    0.0, 0.05, 0.09, 0.1, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.53, 0.6,
    0.65, 0.7, 0.8, 0.9, 1.0, 1.06, 1.2, 1.4, 1.58, 2.0, 2.11,
)

OBJECT_COLOR = -1

PEN_KEYS = (
    "name", "localized_name", "description", "color", "mode_color", "color_policy",
    "physical_pen_number", "virtual_pen_number", "screen", "linepattern_size", "linetype",
    "adaptive_linetype", "lineweight", "fill_style", "end_style", "join_style",
)


def int32(v: int) -> int:
    v &= 0xFFFFFFFF
    return v - (1 << 32) if v >= 1 << 31 else v


def rgb_color(r: int, g: int, b: int, method: int = 0xC2) -> int:
    """Packed colour as stored in plot style tables: method byte << 24 | RGB, as signed int32.
    Stock tables use 0xFF (DWF Virtual Pens, monochrome.ctb) and 0xC3 (Autodesk-MONO.stb)."""
    return int32((method << 24) | (r << 16) | (g << 8) | b)


def _fmt(v: Any) -> str:
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        s = repr(v)
        return s
    if isinstance(v, int):
        return str(v)
    return '"' + str(v)


def _default_pen(name: str, localized: str) -> dict[str, Any]:
    return {
        "name": name,
        "localized_name": localized,
        "description": "",
        "color": OBJECT_COLOR,
        "color_policy": 1,
        "physical_pen_number": 0,
        "virtual_pen_number": 0,
        "screen": 100,
        "linepattern_size": 0.5,
        "linetype": 31,
        "adaptive_linetype": True,
        "lineweight": 0,
        "fill_style": 73,
        "end_style": 4,
        "join_style": 5,
    }


def _pen_lines(index: int, pen: Mapping[str, Any]) -> list[str]:
    out = [f" {index}{{"]
    keys = [k for k in PEN_KEYS if k in pen] + [k for k in pen if k not in PEN_KEYS]
    for k in keys:
        if pen[k] is None:
            continue
        out.append(f"  {k}={_fmt(pen[k])}")
    out.append(" }")
    return out


def _header(aci: bool, lineweight_units: int, description: str) -> list[str]:
    return [
        f'description="{description}',
        f"aci_table_available={'TRUE' if aci else 'FALSE'}",
        "scale_factor=1.0",
        "apply_factor=FALSE",
        f"custom_lineweight_display_units={lineweight_units}",
    ]


def _lw_lines(lineweights: Sequence[float]) -> list[str]:
    return ["custom_lineweight_table{"] + [f" {i}={_fmt(float(v))}" for i, v in enumerate(lineweights)] + ["}"]


def ctb_text(
    pens: Optional[Mapping[int, Mapping[str, Any]]] = None,
    lineweights: Sequence[float] = DEFAULT_LINEWEIGHTS,
    description: str = "",
) -> str:
    """Colour-dependent table: 255 pens, ``pens`` maps ACI 1..255 to overrides."""
    pens = pens or {}
    lines = _header(True, 0, description)
    lines.append("aci_table{")
    lines += [f' {i}="Color_{i + 1}' for i in range(255)]
    lines.append("}")
    lines.append("plot_style{")
    for aci in range(1, 256):
        pen = _default_pen(f"Color_{aci}", f"Color_{aci}")
        pen.update(pens.get(aci, {}))
        lines += _pen_lines(aci - 1, pen)
    lines.append("}")
    lines += _lw_lines(lineweights)
    return "\n".join(lines) + "\n"


def stb_text(
    styles: Sequence[tuple[str, Mapping[str, Any]]],
    lineweights: Sequence[float] = DEFAULT_LINEWEIGHTS,
    description: str = "",
) -> str:
    """Named table: style 0 is always "Normal" (all object); ``styles`` are the further styles."""
    lines = _header(False, 0, description)
    lines.append("plot_style{")
    entries = [("Normal", {})] + list(styles)
    for i, (name, over) in enumerate(entries):
        pen = _default_pen(name, name)
        pen.update(over)
        lines += _pen_lines(i, pen)
    lines.append("}")
    lines += _lw_lines(lineweights)
    return "\n".join(lines) + "\n"


def encode_pia(kind: str, text: str) -> bytes:
    """PIA v2 container (``kind`` = "CTB" or "STB"): 48-byte header, adler32 of the compressed
    body, plain length, compressed length (uint32 LE), zlib stream."""
    plain = text.encode("latin-1")
    comp = zlib.compress(plain, 9)
    head = f"PIAFILEVERSION_2.0,{kind}VER1,compress\r\npmzlibcodec".encode("ascii")
    assert len(head) == 48
    return (
        head
        + (zlib.adler32(comp) & 0xFFFFFFFF).to_bytes(4, "little")
        + len(plain).to_bytes(4, "little")
        + len(comp).to_bytes(4, "little")
        + comp
    )


def ctb_bytes(pens=None, lineweights=DEFAULT_LINEWEIGHTS, description: str = "") -> bytes:
    return encode_pia("CTB", ctb_text(pens, lineweights, description))


def stb_bytes(styles, lineweights=DEFAULT_LINEWEIGHTS, description: str = "") -> bytes:
    return encode_pia("STB", stb_text(styles, lineweights, description))
