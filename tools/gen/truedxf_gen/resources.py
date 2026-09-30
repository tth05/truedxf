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
    "DASHED": ("Dashed __ __ __ __ __ __ __ __ __ __ __ __ __ _", [0.5, -0.25]),
    "DASHED2": ("Dashed (.5x) _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _", [0.25, -0.125]),
    "DASHEDX2": ("Dashed (2x) ____  ____  ____  ____  ____  ___", [1.0, -0.5]),
    "DASHDOT": ("Dash dot __ . __ . __ . __ . __ . __ . __ . __", [0.5, -0.25, 0.0, -0.25]),
    "DASHDOT2": ("Dash dot (.5x) _._._._._._._._._._._._._._._.", [0.25, -0.125, 0.0, -0.125]),
    "DASHDOTX2": ("Dash dot (2x) ____  .  ____  .  ____  .  ___", [1.0, -0.5, 0.0, -0.5]),
    "DIVIDE": ("Divide ____ . . ____ . . ____ . . ____ . . ____", [0.5, -0.25, 0.0, -0.25, 0.0, -0.25]),
    "DIVIDE2": ("Divide (.5x) __..__..__..__..__..__..__..__.._", [0.25, -0.125, 0.0, -0.125, 0.0, -0.125]),
    "DOT": ("Dot . . . . . . . . . . . . . . . . . . . . . . . .", [0.0, -0.25]),
    "DOT2": ("Dot (.5x) ........................................", [0.0, -0.125]),
    "CENTER": ("Center ____ _ ____ _ ____ _ ____ _ ____ _ ____", [1.25, -0.25, 0.25, -0.25]),
    "CENTER2": ("Center (.5x) ___ _ ___ _ ___ _ ___ _ ___ _ ___", [0.75, -0.125, 0.125, -0.125]),
    "CENTERX2": ("Center (2x) ________  __  ________  __  _____", [2.5, -0.5, 0.5, -0.5]),
    "HIDDEN": ("Hidden __ __ __ __ __ __ __ __ __ __ __ __ __ __", [0.25, -0.125]),
    "HIDDEN2": ("Hidden (.5x) _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _", [0.125, -0.0625]),
    "PHANTOM": ("Phantom ______  __  __  ______  __  __  ______", [1.25, -0.25, 0.25, -0.25, 0.25, -0.25]),
    "PHANTOM2": ("Phantom (.5x) ___ _ _ ___ _ _ ___ _ _ ___ _ _", [0.625, -0.125, 0.125, -0.125, 0.125, -0.125]),
    "BORDER": ("Border __ __ . __ __ . __ __ . __ __ . __ __ .", [0.5, -0.25, 0.5, -0.25, 0.0, -0.25]),
}

# ISO 128 linetypes (acadiso.lin names), mm at pen width 1.0
_ISO: dict[str, tuple[str, list[float]]] = {
    "ACAD_ISO02W100": ("ISO dash __ __ __ __ __ __ __ __ __ __ __ __ __", [12, -3]),
    "ACAD_ISO03W100": ("ISO dash space __    __    __    __    __    __", [12, -18]),
    "ACAD_ISO04W100": ("ISO long-dash dot ____ . ____ . ____ . ____ . _", [24, -3, 0.5, -3]),
    "ACAD_ISO05W100": ("ISO long-dash double-dot ____ .. ____ .. ____ .", [24, -3, 0.5, -3, 0.5, -3]),
    "ACAD_ISO06W100": ("ISO long-dash triple-dot ____ ... ____ ... ____", [24, -3, 0.5, -3, 0.5, -3, 0.5, -3]),
    "ACAD_ISO07W100": ("ISO dot . . . . . . . . . . . . . . . . . . . .", [0.5, -3]),
    "ACAD_ISO08W100": ("ISO long-dash short-dash ____ __ ____ __ ____ _", [24, -3, 6, -3]),
    "ACAD_ISO09W100": ("ISO long-dash double-short-dash ____ __ __ ____", [24, -3, 6, -3, 6, -3]),
    "ACAD_ISO10W100": ("ISO dash dot __ . __ . __ . __ . __ . __ . __ .", [12, -3, 0.5, -3]),
    "ACAD_ISO11W100": ("ISO double-dash dot __ __ . __ __ . __ __ . __ _", [12, -3, 12, -3, 0.5, -3]),
    "ACAD_ISO12W100": ("ISO dash double-dot __ . . __ . . __ . . __ . .", [12, -3, 0.5, -3, 0.5, -3]),
    "ACAD_ISO13W100": ("ISO double-dash double-dot __ __ . . __ __ . . _", [12, -3, 12, -3, 0.5, -3, 0.5, -3]),
    "ACAD_ISO14W100": ("ISO dash triple-dot __ . . . __ . . . __ . . . _", [12, -3, 0.5, -3, 0.5, -3, 0.5, -3]),
    "ACAD_ISO15W100": ("ISO double-dash triple-dot __ __ . . . __ __ . .", [12, -3, 12, -3, 0.5, -3, 0.5, -3, 0.5, -3]),
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
ACAD_SHX_FONTS = ("txt.shx", "simplex.shx", "romans.shx", "isocp.shx", "gdt.shx", "ltypeshp.shx")
