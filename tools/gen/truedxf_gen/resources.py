"""Linetype and text-style resources used by fixtures.

Linetype definitions are embedded in every DXF, so AutoCAD and truedxf render the same stored
pattern whatever its origin. We still prefer AutoCAD's own values: note 11a §12 lists the
definitions measured from 120 AutoCAD-written files (ezdxf's `standards.linetypes()` differs for
several of them, ezdxf#1411). Fixtures are metric (INSUNITS 4, MEASUREMENT 1), so the acad.lin
values are scaled ×25.4 like acadiso.lin does. ISO patterns are defined in mm (pen width 1.0).
Pattern notation: positive = dash, negative = gap, 0 = dot (DXF LTYPE 49 values).
"""

from __future__ import annotations

# name -> (description, elements)  -- imperial values (acad.lin, note 11a §12)
_IMPERIAL: dict[str, tuple[str, list[float]]] = {
    "DASHED": ("truedxf dashed", [0.5, -0.25]),
    "DASHED2": ("truedxf dashed, half scale", [0.25, -0.125]),
    "DASHEDX2": ("truedxf dashed, double scale", [1.0, -0.5]),
    "DASHDOT": ("truedxf dash dot", [0.5, -0.25, 0.0, -0.25]),
    "DASHDOT2": ("truedxf dash dot, half scale", [0.25, -0.125, 0.0, -0.125]),
    "DASHDOTX2": ("truedxf dash dot, double scale", [1.0, -0.5, 0.0, -0.5]),
    "DIVIDE": ("truedxf dash, two dots", [0.5, -0.25, 0.0, -0.25, 0.0, -0.25]),
    "DIVIDE2": ("truedxf dash, two dots, half scale", [0.25, -0.125, 0.0, -0.125, 0.0, -0.125]),
    "DOT": ("truedxf dots", [0.0, -0.25]),
    "DOT2": ("truedxf dots, half scale", [0.0, -0.125]),
    "CENTER": ("truedxf long dash, short dash", [1.25, -0.25, 0.25, -0.25]),
    "CENTER2": ("truedxf long dash, short dash, half scale", [0.75, -0.125, 0.125, -0.125]),
    "CENTERX2": ("truedxf long dash, short dash, double scale", [2.5, -0.5, 0.5, -0.5]),
    "HIDDEN": ("truedxf short dashes", [0.25, -0.125]),
    "HIDDEN2": ("truedxf short dashes, half scale", [0.125, -0.0625]),
    "PHANTOM": ("truedxf long dash, two short dashes", [1.25, -0.25, 0.25, -0.25, 0.25, -0.25]),
    "PHANTOM2": ("truedxf long dash, two short dashes, half scale", [0.625, -0.125, 0.125, -0.125, 0.125, -0.125]),
    "BORDER": ("truedxf two dashes, dot", [0.5, -0.25, 0.5, -0.25, 0.0, -0.25]),
}

# ISO 128 linetypes (acadiso.lin names), mm at pen width 1.0
_ISO: dict[str, tuple[str, list[float]]] = {
    "ACAD_ISO02W100": ("truedxf ISO 02 dash", [12, -3]),
    "ACAD_ISO03W100": ("truedxf ISO 03 dash, long gap", [12, -18]),
    "ACAD_ISO04W100": ("truedxf ISO 04 long dash, dot", [24, -3, 0.5, -3]),
    "ACAD_ISO05W100": ("truedxf ISO 05 long dash, two dots", [24, -3, 0.5, -3, 0.5, -3]),
    "ACAD_ISO06W100": ("truedxf ISO 06 long dash, three dots", [24, -3, 0.5, -3, 0.5, -3, 0.5, -3]),
    "ACAD_ISO07W100": ("truedxf ISO 07 dots", [0.5, -3]),
    "ACAD_ISO08W100": ("truedxf ISO 08 long dash, short dash", [24, -3, 6, -3]),
    "ACAD_ISO09W100": ("truedxf ISO 09 long dash, two short dashes", [24, -3, 6, -3, 6, -3]),
    "ACAD_ISO10W100": ("truedxf ISO 10 dash, dot", [12, -3, 0.5, -3]),
    "ACAD_ISO11W100": ("truedxf ISO 11 two dashes, dot", [12, -3, 12, -3, 0.5, -3]),
    "ACAD_ISO12W100": ("truedxf ISO 12 dash, two dots", [12, -3, 0.5, -3, 0.5, -3]),
    "ACAD_ISO13W100": ("truedxf ISO 13 two dashes, two dots", [12, -3, 12, -3, 0.5, -3, 0.5, -3]),
    "ACAD_ISO14W100": ("truedxf ISO 14 dash, three dots", [12, -3, 0.5, -3, 0.5, -3, 0.5, -3]),
    "ACAD_ISO15W100": ("truedxf ISO 15 two dashes, three dots", [12, -3, 12, -3, 0.5, -3, 0.5, -3, 0.5, -3]),
}


def linetype_def(name: str, metric: bool = True) -> tuple[str, list[float]]:
    key = name.upper()
    if key in _ISO:
        desc, el = _ISO[key]
        return desc, [float(e) for e in el]
    if key in _IMPERIAL:
        desc, el = _IMPERIAL[key]
        f = 25.4 if metric else 1.0
        return desc, [round(e * f, 6) for e in el]
    raise KeyError(f"unknown linetype {name}")


SIMPLE_LINETYPES = list(_IMPERIAL)
ISO_LINETYPES = list(_ISO)

# TTF fonts that fixtures may reference (see tools/gen/FONTS.md). Keys are short aliases.
TTF_FONTS: dict[str, str] = {
    "sans": "LiberationSans-Regular.ttf",
    "sans-bold": "LiberationSans-Bold.ttf",
    "sans-italic": "LiberationSans-Italic.ttf",
    "sans-bolditalic": "LiberationSans-BoldItalic.ttf",
    "lato": "LatoWeb-Regular.ttf",
    "lato-bold": "LatoWeb-Bold.ttf",
    "mono": "CascadiaMono.ttf",
}

# AutoCAD-shipped SHX fonts: allowed ONLY in the acad-default-fonts suite.
# (present in C:\Program Files\Autodesk\AutoCAD 2027\Fonts; gdt.shx is NOT installed there)
ACAD_SHX_FONTS = (
    "txt.shx", "simplex.shx", "romans.shx", "isocp.shx", "amgdt.shx", "ltypeshp.shx",
    "bigfont.shx", "chineset.shx", "extfont.shx",
)
