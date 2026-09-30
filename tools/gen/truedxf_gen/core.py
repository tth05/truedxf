"""Suite registry, case builder and writer.

A suite is a function decorated with ``@suite(...)`` that receives a :class:`SuiteBuilder` and
creates cases with ``s.case(...)``. Each case owns one ezdxf document created with fixed,
deterministic settings (:func:`new_doc`) and a plot description; the framework writes
``<case>.dxf`` + ``<case>.json`` per docs/fixtures.md.
"""

from __future__ import annotations

import io
import json
import math
import random
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Optional, Sequence

import ezdxf
from ezdxf import bbox as ezbbox
from ezdxf.document import Drawing
from ezdxf.enums import TextEntityAlignment  # noqa: F401  (re-exported for suites)

from . import VERSION
from .plotwin import (
    DEFAULT_CANVAS,
    check_canvas,
    check_window,
    fit_window,
    window_at,
    window_from,
)
from .resources import ACAD_SHX_FONTS, TTF_FONTS, linetype_def

# Fixed metadata: constant $TDCREATE/$TDUPDATE, null GUIDs, constant ezdxf marker string.
ezdxf.options.write_fixed_meta_data_for_testing = True

REPO_ROOT = Path(__file__).resolve().parents[3]  # tools/gen/truedxf_gen/core.py -> repo root
DEFAULT_OUT = REPO_ROOT / "samples" / "generated"
GENERATOR = f"tools/gen {VERSION} / ezdxf {ezdxf.__version__}"

ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
STYLE_TABLES = ("monochrome.ctb", "acad.ctb")
DXFVERSIONS = {
    "R12": "AC1009",
    "R2000": "AC1015",
    "R2004": "AC1018",
    "R2007": "AC1021",
    "R2010": "AC1024",
    "R2013": "AC1027",
    "R2018": "AC1032",
}

# Header defaults every fixture starts from (AutoCAD metric template values; see note 01 §9 and
# note 06 §2.5). Suites override per case via new_doc(header=...).
BASE_HEADER: dict[str, Any] = {
    "$MEASUREMENT": 1,
    "$LTSCALE": 1.0,
    "$CELTSCALE": 1.0,
    "$PSLTSCALE": 1,
    "$PDMODE": 0,
    "$PDSIZE": 0.0,
    "$FILLMODE": 1,
    "$MIRRTEXT": 0,
    "$PLINEGEN": 0,
    "$LWDISPLAY": 1,
    "$CELWEIGHT": -1,
    "$TEXTSIZE": 2.5,
    "$DIMSCALE": 1.0,
    # ezdxf.new(setup=False) leaves $DIMSTYLE=ISO-25, a style it does not create
    "$DIMSTYLE": "Standard",
}


class FixtureError(Exception):
    pass


# --------------------------------------------------------------------------------------------
# document factory


def new_doc(
    dxfversion: str = "R2018",
    units: int = 4,
    header: Optional[dict[str, Any]] = None,
    standard_font: str = TTF_FONTS["sans"],
) -> Drawing:
    """Create an ezdxf document with deterministic settings.

    - no ezdxf ``setup`` resources (its text styles reference fonts we don't allow);
    - STANDARD text style uses a font from tools/gen/FONTS.md (Liberation Sans by default);
    - handles are allocated sequentially by ezdxf, so $HANDSEED depends only on build order;
    - timestamps/GUIDs are fixed via ``ezdxf.options.write_fixed_meta_data_for_testing``.
    """
    # R12 has no $INSUNITS (ezdxf warns if units are passed)
    doc = ezdxf.new(dxfversion, setup=False, **({} if dxfversion == "R12" else {"units": units}))
    for k, v in BASE_HEADER.items():
        doc.header[k] = v
    if header:
        for k, v in header.items():
            doc.header[k] = v
    std = doc.styles.get("Standard")
    std.dxf.font = standard_font
    std.dxf.width = 1.0
    std.dxf.height = 0.0
    return doc


def ensure_linetype(doc: Drawing, name: str) -> str:
    if name.upper() in ("CONTINUOUS", "BYLAYER", "BYBLOCK"):
        return name
    if name not in doc.linetypes:
        metric = doc.header.get("$MEASUREMENT", 1) == 1
        desc, elements = linetype_def(name, metric=metric)
        doc.linetypes.add(name, pattern=[sum(abs(e) for e in elements), *elements], description=desc)
    return name


def ensure_style(
    doc: Drawing,
    name: str,
    font: str = TTF_FONTS["sans"],
    width: float = 1.0,
    oblique: float = 0.0,
    height: float = 0.0,
    bigfont: str = "",
) -> str:
    if name not in doc.styles:
        st = doc.styles.add(name, font=font)
        st.dxf.width = width
        st.dxf.oblique = oblique
        st.dxf.height = height
        if bigfont:
            st.dxf.bigfont = bigfont
    return name


def ensure_layer(
    doc: Drawing,
    name: str,
    color: int = 7,
    linetype: str = "Continuous",
    lineweight: int = -3,
    plot: bool = True,
    on: bool = True,
    frozen: bool = False,
    locked: bool = False,
    true_color: Optional[int] = None,
    transparency: Optional[float] = None,
) -> str:
    if name in doc.layers:
        return name
    ensure_linetype(doc, linetype)
    layer = doc.layers.add(name, color=color, linetype=linetype, lineweight=lineweight)
    layer.dxf.plot = 1 if plot else 0
    if true_color is not None:
        layer.dxf.true_color = true_color
    if transparency is not None:
        layer.transparency = transparency
    if frozen:
        layer.freeze()
    if locked:
        layer.lock()
    if not on:
        layer.off()
    return name


# --------------------------------------------------------------------------------------------
# cases


@dataclass
class Plot:
    layout: str = "Model"
    area: dict[str, Any] = field(default_factory=lambda: {"type": "extents"})
    canvas: tuple[int, int] = DEFAULT_CANVAS
    styleTable: str = "monochrome.ctb"
    lineweights: bool = True
    scale: Any = "fit"
    # harness extensions (tools/acad/src/script.ts PlotMeta): answer to "Plot paper space
    # first?" and extra session sysvars set after the prologue (e.g. PLOTTRANSPARENCYOVERRIDE 2)
    paperSpaceFirst: Optional[bool] = None
    sysvars: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "layout": self.layout,
            "area": self.area,
            "canvas": list(self.canvas),
            "styleTable": self.styleTable,
            "lineweights": self.lineweights,
            "scale": self.scale,
        }
        if self.paperSpaceFirst is not None:
            d["paperSpaceFirst"] = self.paperSpaceFirst
        if self.sysvars:
            d["sysvars"] = dict(self.sysvars)
        return d


class Case:
    """One fixture: an ezdxf document + metadata."""

    def __init__(
        self,
        suite: "SuiteBuilder",
        name: str,
        title: str,
        tags: Sequence[str] = (),
        questions: Sequence[str] = (),
        seed: Optional[int] = None,
        params: Optional[dict[str, Any]] = None,
        dxfversion: str = "R2018",
        units: int = 4,
        header: Optional[dict[str, Any]] = None,
        standard_font: Optional[str] = None,
        style_table: Optional[str] = None,
        outputs: Sequence[str] = ("png", "pdf", "dxf"),
    ):
        if not ID_RE.match(name):
            raise FixtureError(f"bad case name {name!r}")
        self.suite = suite
        self.name = name
        self.title = title
        self.tags = list(tags)
        self.questions = list(questions)
        self.seed = seed
        self.rng = random.Random(seed) if seed is not None else None
        self.params = dict(params or {})
        if dxfversion not in DXFVERSIONS:
            raise FixtureError(f"unsupported dxfversion {dxfversion}")
        self.dxfversion = dxfversion
        self.doc = new_doc(
            dxfversion,
            units=units,
            header=header,
            standard_font=standard_font or TTF_FONTS["sans"],
        )
        self.msp = self.doc.modelspace()
        if suite.info.layer0_lineweight is not None:
            self.doc.layers.get("0").dxf.lineweight = suite.info.layer0_lineweight
        self.plot = Plot(styleTable=style_table or suite.style_table)
        self.outputs = list(outputs)
        self.extra_files: dict[str, bytes] = {}
        self._plot_set = False
        self.notes: list[str] = []
        # bytes -> bytes filters applied after serialisation (deliberately malformed files for
        # `fileformat` questions); such cases usually also set allow_audit_errors
        self.byte_filters: list[Callable[[bytes], bytes]] = []
        self.allow_audit_errors = False
        # False: store ezdxf's bounding box as $EXTMIN/$EXTMAX; True: leave the header extents
        # as set by the suite (e.g. ezdxf's "empty" +1e20/-1e20 so AutoCAD must recompute)
        self.keep_header_extents = False
        # window plots are shifted by half a pixel (see window()); set False per case to plot
        # the exact window given
        self.half_pixel_shift = True

    # --- resources -------------------------------------------------------------------------
    def layer(self, name: str, **kw: Any) -> str:
        return ensure_layer(self.doc, name, **kw)

    def linetype(self, name: str) -> str:
        return ensure_linetype(self.doc, name)

    def style(self, name: str, **kw: Any) -> str:
        return ensure_style(self.doc, name, **kw)

    def header(self, **kv: Any) -> None:
        for k, v in kv.items():
            self.doc.header["$" + k.upper()] = v

    def add_file(self, filename: str, data: bytes) -> str:
        """Extra file written next to the case (e.g. an IMAGE's PNG). Returns the absolute path
        of the file in the canonical output folder samples/generated/<suite>/ (independent of
        ``--out`` so the DXF bytes stay deterministic)."""
        if not re.match(r"^[a-z0-9][a-z0-9._-]*$", filename):
            raise FixtureError(f"bad extra file name {filename!r}")
        self.extra_files[filename] = data
        return str((DEFAULT_OUT / self.suite.name / filename).resolve())

    # --- plot area -------------------------------------------------------------------------
    def window(
        self,
        vmin: Sequence[float],
        vmax: Sequence[float],
        canvas: Sequence[int] = DEFAULT_CANVAS,
        half_pixel: Optional[bool] = None,
    ) -> None:
        """Window plot. By default the window is shifted by half a device pixel towards -x/-y
        so that round coordinates land on pixel centres instead of exact pixel-boundary ties,
        which AutoCAD resolves by floating-point noise (tools/acad/README.md, note 08 §10)."""
        canvas = check_canvas(canvas)
        check_window(vmin, vmax, canvas)
        if self.half_pixel_shift if half_pixel is None else half_pixel:
            p = (vmax[0] - vmin[0]) / canvas[0] / 2
            vmin = (round(vmin[0] - p, 9), round(vmin[1] - p, 9))
            vmax = (round(vmax[0] - p, 9), round(vmax[1] - p, 9))
            check_window(vmin, vmax, canvas)
        self.plot.area = {
            "type": "window",
            "min": [float(vmin[0]), float(vmin[1])],
            "max": [float(vmax[0]), float(vmax[1])],
        }
        self.plot.canvas = canvas
        self._plot_set = True
        w = vmax[0] - vmin[0]
        h = vmax[1] - vmin[1]
        cx = (vmin[0] + vmax[0]) / 2
        cy = (vmin[1] + vmax[1]) / 2
        if self.plot.layout == "Model":
            vp = self.doc.set_modelspace_vport(h, (cx, cy))
            vp.dxf.aspect_ratio = w / h

    def window_scale(
        self,
        origin: Sequence[float],
        px_per_unit: float,
        canvas: Sequence[int] = DEFAULT_CANVAS,
    ) -> None:
        """Window with lower-left ``origin`` and exact pixels per drawing unit."""
        vmin, vmax = window_from(origin, px_per_unit, canvas)
        self.window(vmin, vmax, canvas)

    def window_center(
        self,
        center: Sequence[float],
        px_per_unit: float,
        canvas: Sequence[int] = DEFAULT_CANVAS,
    ) -> None:
        vmin, vmax = window_at(center, px_per_unit, canvas)
        self.window(vmin, vmax, canvas)

    def fit(
        self,
        bmin: Optional[Sequence[float]] = None,
        bmax: Optional[Sequence[float]] = None,
        canvas: Sequence[int] = DEFAULT_CANVAS,
        margin: float = 0.05,
    ) -> float:
        """Window around a box (default: ezdxf extents of model space) at a nice scale.
        Returns pixels per unit."""
        if bmin is None or bmax is None:
            ext = ezbbox.extents(self.msp, fast=True)
            if not ext.has_data:
                raise FixtureError(f"{self.name}: empty model space, cannot fit")
            bmin, bmax = (ext.extmin.x, ext.extmin.y), (ext.extmax.x, ext.extmax.y)
        vmin, vmax, s = fit_window(bmin, bmax, canvas, margin)
        self.window(vmin, vmax, canvas)
        return s

    def plot_extents(self, canvas: Sequence[int] = DEFAULT_CANVAS) -> None:
        self.plot.area = {"type": "extents"}
        self.plot.canvas = check_canvas(canvas)
        self._plot_set = True

    def plot_layout(
        self, layout: str, canvas: Sequence[int] = DEFAULT_CANVAS, scale: Any = "fit"
    ) -> None:
        """Plot a paper-space layout ("layout" area = the layout's paper/limits)."""
        self.plot.layout = layout
        self.plot.area = {"type": "layout"}
        self.plot.canvas = check_canvas(canvas)
        self.plot.scale = scale
        self._plot_set = True

    def layout_window(
        self,
        layout: str,
        vmin: Sequence[float],
        vmax: Sequence[float],
        canvas: Sequence[int] = DEFAULT_CANVAS,
    ) -> None:
        """Window plot of a paper-space layout (paper units)."""
        self.plot.layout = layout
        self.window(vmin, vmax, canvas)

    # --- serialisation ---------------------------------------------------------------------
    @property
    def id(self) -> str:
        return f"{self.suite.name}/{self.name}"

    def sysvar(self, name: str, value: Any) -> None:
        """Session sysvar the harness sets before plotting (registry values such as LWDEFAULT or
        PLOTTRANSPARENCYOVERRIDE that a DXF cannot carry)."""
        self.plot.sysvars[name.upper()] = value

    def meta(self) -> dict[str, Any]:
        # legacy form: params["harness"] = {"sysvars": {...}, "paperSpaceFirst": bool}
        h = self.params.get("harness")
        if isinstance(h, dict):
            for k, v in (h.get("sysvars") or {}).items():
                self.plot.sysvars.setdefault(k.upper(), v)
            if "paperSpaceFirst" in h and self.plot.paperSpaceFirst is None:
                self.plot.paperSpaceFirst = bool(h["paperSpaceFirst"])
        m: dict[str, Any] = {
            "id": self.id,
            "suite": self.suite.name,
            "title": self.title,
            "tags": self.tags,
        }
        if self.questions:
            m["questions"] = self.questions
        m.update(
            {
                "seed": self.seed,
                "params": self.params,
                "dxfversion": DXFVERSIONS[self.dxfversion],
                "generator": GENERATOR,
                "plot": self.plot.to_json(),
                "outputs": self.outputs,
            }
        )
        if self.notes:
            m["notes"] = self.notes
        return m

    def _set_extents(self) -> None:
        if self.keep_header_extents:
            return
        # ezdxf does not maintain $EXTMIN/$EXTMAX; store real values so an "extents" plot does
        # not depend on AutoCAD recomputing them on open.
        try:
            ext = ezbbox.extents(self.msp, fast=True)
        except Exception:  # pragma: no cover - bbox is best effort
            return
        if ext.has_data and all(math.isfinite(v) for v in (*ext.extmin, *ext.extmax)):
            self.msp.dxf.extmin = ext.extmin
            self.msp.dxf.extmax = ext.extmax

    def dxf_bytes(self) -> bytes:
        self._set_extents()
        stream = io.StringIO()
        self.doc.write(stream)
        data = self.doc.encode(stream.getvalue())
        for f in self.byte_filters:
            data = f(data)
        return data

    def validate_meta(self) -> None:
        if not self._plot_set:
            raise FixtureError(f"{self.id}: no plot area set")
        if self.plot.styleTable not in STYLE_TABLES:
            raise FixtureError(f"{self.id}: bad style table {self.plot.styleTable}")
        for f in self.extra_files:
            if f.endswith((".dxf", ".json")):
                raise FixtureError(f"{self.id}: extra file {f} collides with fixture names")


class SuiteBuilder:
    def __init__(self, info: "SuiteInfo"):
        self.info = info
        self.name = info.name
        self.style_table = info.style_table
        self.cases: list[Case] = []
        self._names: set[str] = set()

    def case(self, name: str, title: str, **kw: Any) -> Case:
        if name in self._names:
            raise FixtureError(f"duplicate case {self.name}/{name}")
        self._names.add(name)
        c = Case(self, name, title, **kw)
        self.cases.append(c)
        return c


@dataclass
class SuiteInfo:
    name: str
    title: str
    build: Callable[[SuiteBuilder], None]
    style_table: str = "monochrome.ctb"
    description: str = ""
    fonts: str = "ttf"  # "ttf" (FONTS.md fonts only) | "acad" (AutoCAD-shipped fonts)
    layer0_lineweight: Optional[int] = None  # e.g. 0 for hairline geometry suites


REGISTRY: dict[str, SuiteInfo] = {}


def suite(
    name: str,
    title: str,
    style_table: str = "monochrome.ctb",
    description: str = "",
    fonts: str = "ttf",
    layer0_lineweight: Optional[int] = None,
) -> Callable[[Callable[[SuiteBuilder], None]], Callable[[SuiteBuilder], None]]:
    if not ID_RE.match(name):
        raise FixtureError(f"bad suite name {name!r}")
    if name == "calibration":
        raise FixtureError("the calibration suite is owned by tools/acad")

    def deco(fn: Callable[[SuiteBuilder], None]) -> Callable[[SuiteBuilder], None]:
        if name in REGISTRY:
            raise FixtureError(f"duplicate suite {name}")
        REGISTRY[name] = SuiteInfo(
            name, title, fn, style_table, description, fonts, layer0_lineweight
        )
        return fn

    return deco


def build_suite(name: str) -> SuiteBuilder:
    info = REGISTRY[name]
    sb = SuiteBuilder(info)
    info.build(sb)
    return sb


def _json(obj: Any, ind: int) -> str:
    pad = "  " * (ind + 1)
    if isinstance(obj, dict):
        if not obj:
            return "{}"
        items = [
            f"{pad}{json.dumps(str(k), ensure_ascii=False)}: {_json(v, ind + 1)}"
            for k, v in obj.items()
        ]
        return "{\n" + ",\n".join(items) + "\n" + "  " * ind + "}"
    if isinstance(obj, (list, tuple)):
        flat = json.dumps(list(obj), ensure_ascii=False)
        if len(flat) <= 100 and all(not isinstance(v, dict) for v in obj):
            return flat
        return "[\n" + ",\n".join(pad + _json(v, ind + 1) for v in obj) + "\n" + "  " * ind + "]"
    return json.dumps(obj, ensure_ascii=False)


def json_bytes(obj: Any) -> bytes:
    """Pretty JSON with short arrays kept on one line (stable, human-diffable)."""
    return (_json(obj, 0) + "\n").encode("utf-8")


def iter_numbered(prefix: str, items: Iterable[Any], start: int = 1):
    """Yield (case_name, item) with a 4-digit running number: prefix-0001, prefix-0002, …"""
    for i, it in enumerate(items, start):
        yield f"{prefix}-{i:04d}", it
