"""
ezdxf side of the differential oracle (tools/corpus/README.md).

Loads a DXF with ezdxf (``ezdxf.readfile``; ``ezdxf.recover.readfile`` when that fails) and
dumps a normalized JSON view of header variables, tables, blocks and entity spaces. The TS
counterpart is ``tools/corpus/src/dump.ts``; both must produce the same schema (field names are
truedxf's, not ezdxf's). Run with the generator venv:

    tools/gen/.venv/Scripts/python tools/corpus/ezdxf_dump.py FILE.dxf [--out out.json.gz]
    tools/gen/.venv/Scripts/python tools/corpus/ezdxf_dump.py --serve

``--serve`` reads ``<input path>\\t<output path>`` lines from stdin, writes one gzipped JSON per
line and answers ``OK``/``ERR`` + output path on stdout. ``tools/corpus/src/diff-ezdxf.ts`` runs
several of these workers in parallel (and kills/restarts them on timeouts).

Normalization rules (mirrored in dump.ts):
- numbers are rounded to 12 significant digits, points are [x, y, z];
- names are kept as loaded; dictionary keys (layer/block/... names) are upper-cased;
- optional attributes that are absent are ``None`` (JSON null);
- entity types without a truedxf parser are dumped as ``{"t": TYPE, "h": handle}`` only.
"""

from __future__ import annotations

import gzip
import json
import math
import sys
import time
import traceback
from typing import Any

import ezdxf
from ezdxf import recover

HEADER_VARS = [
    "$ACADVER",
    "$DWGCODEPAGE",
    "$INSBASE",
    "$EXTMIN",
    "$EXTMAX",
    "$LIMMIN",
    "$LIMMAX",
    "$LTSCALE",
    "$PSLTSCALE",
    "$CELTSCALE",
    "$PDMODE",
    "$PDSIZE",
    "$TEXTSIZE",
    "$TEXTSTYLE",
    "$CLAYER",
    "$CELTYPE",
    "$CECOLOR",
    "$MEASUREMENT",
    "$INSUNITS",
    "$LUNITS",
    "$AUNITS",
    "$ANGBASE",
    "$ANGDIR",
    "$MIRRTEXT",
    "$FILLMODE",
    "$TILEMODE",
    "$DIMSTYLE",
    "$DIMSCALE",
    "$PSTYLEMODE",
    "$PLINEGEN",
    "$LWDISPLAY",
]

LAYOUT_BLOCKS = {"*MODEL_SPACE", "*PAPER_SPACE", "$MODEL_SPACE", "$PAPER_SPACE"}


def num(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, int):
        return v
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    if not math.isfinite(f):
        return 0
    if f == 0:
        return 0
    r = float(f"{f:.12g}")
    return int(r) if r.is_integer() and abs(r) < 1e15 else r


def pt(v: Any) -> Any:
    if v is None:
        return None
    try:
        seq = list(v)
    except TypeError:
        return None
    while len(seq) < 3:
        seq.append(0)
    return [num(seq[0]), num(seq[1]), num(seq[2])]


def opt(dxf, name: str) -> Any:
    return dxf.get(name) if dxf.hasattr(name) else None


def getter(dxf):
    """Explicit value, else ezdxf's declared DXF default (what `dxf.name` returns), else fallback."""

    def g(name: str, fallback: Any = None) -> Any:
        v = dxf.get(name)
        if v is None:
            v = dxf.dxf_default_value(name)
        return fallback if v is None else v

    return g


def handle_of(e) -> Any:
    h = e.dxf.get("handle")
    return h.upper().lstrip("0") or "0" if h else None


def common(e) -> dict:
    d = e.dxf
    return {
        "t": e.dxftype(),
        "h": handle_of(e),
        "layer": d.get("layer", "0"),
        "linetype": d.get("linetype", "BYLAYER"),
        "color": num(d.get("color", 256)),
        "trueColor": num(opt(d, "true_color")),
        "colorName": opt(d, "color_name"),
        "transparency": num(opt(d, "transparency")),
        "lineweight": num(d.get("lineweight", -1)),
        "linetypeScale": num(d.get("ltscale", 1)),
        "invisible": bool(d.get("invisible", 0)),
        "paperSpace": bool(d.get("paperspace", 0)),
    }


def text_props(e, out: dict) -> None:
    d = e.dxf
    g = getter(d)
    out.update(
        text=g("text", ""),
        insert=pt(g("insert")),
        alignPoint=pt(opt(d, "align_point")),
        height=num(g("height", 2.5)),
        rotation=num(g("rotation", 0)),
        widthFactor=num(g("width", 1)),
        oblique=num(g("oblique", 0)),
        style=g("style", "Standard"),
        generationFlags=num(g("text_generation_flag", 0)),
        halign=num(g("halign", 0)),
        valign=num(g("valign", 0)),
        thickness=num(g("thickness", 0)),
        extrusion=pt(g("extrusion", (0, 0, 1))),
    )


def attrib(e) -> dict:
    out = common(e)
    text_props(e, out)
    d = e.dxf
    out.update(
        tag=d.get("tag", ""),
        attribFlags=num(d.get("flags", 0)),
        fieldLength=num(d.get("field_length", 0)),
        lockPosition=bool(d.get("lock_position", 0)),
    )
    if e.dxftype() == "ATTDEF":
        out["prompt"] = d.get("prompt", "")
    return out


def entity(e) -> dict:
    t = e.dxftype()
    d = e.dxf
    if t not in PARSED:
        return {"t": t, "h": handle_of(e)}
    out = common(e)
    g = getter(d)
    if t == "LINE":
        out.update(
            start=pt(g("start")),
            end=pt(g("end")),
            thickness=num(g("thickness", 0)),
            extrusion=pt(g("extrusion", (0, 0, 1))),
        )
    elif t == "POINT":
        out.update(
            location=pt(g("location")),
            thickness=num(g("thickness", 0)),
            angle=num(g("angle", 0)),
            extrusion=pt(g("extrusion", (0, 0, 1))),
        )
    elif t in ("CIRCLE", "ARC"):
        out.update(
            center=pt(g("center")),
            radius=num(g("radius", 1)),
            thickness=num(g("thickness", 0)),
            extrusion=pt(g("extrusion", (0, 0, 1))),
        )
        if t == "ARC":
            out.update(startAngle=num(g("start_angle", 0)), endAngle=num(g("end_angle", 360)))
    elif t == "ELLIPSE":
        out.update(
            center=pt(g("center")),
            majorAxis=pt(g("major_axis")),
            ratio=num(g("ratio", 1)),
            startParam=num(g("start_param", 0)),
            endParam=num(g("end_param", math.tau)),
            extrusion=pt(g("extrusion", (0, 0, 1))),
        )
    elif t in ("SOLID", "TRACE", "3DFACE"):
        v2 = g("vtx2")
        out.update(
            v0=pt(g("vtx0")),
            v1=pt(g("vtx1")),
            v2=pt(v2),
            v3=pt(opt(d, "vtx3") if d.hasattr("vtx3") else v2),
        )
        if t == "3DFACE":
            out["invisibleEdges"] = num(g("invisible_edges", 0))
        else:
            out.update(thickness=num(g("thickness", 0)), extrusion=pt(g("extrusion", (0, 0, 1))))
    elif t in ("RAY", "XLINE"):
        out.update(start=pt(g("start")), direction=pt(g("unit_vector")))
    elif t == "SPLINE":
        out.update(
            normal=pt(opt(d, "extrusion")),
            flags=num(g("flags", 0)),
            degree=num(g("degree", 3)),
            knots=[num(k) for k in e.knots],
            weights=[num(w) for w in e.weights],
            controlPoints=[pt(p) for p in e.control_points],
            fitPoints=[pt(p) for p in e.fit_points],
            startTangent=pt(opt(d, "start_tangent")),
            endTangent=pt(opt(d, "end_tangent")),
            knotTolerance=num(g("knot_tolerance", 1e-10)),
            controlPointTolerance=num(g("control_point_tolerance", 1e-10)),
            fitTolerance=num(g("fit_tolerance", 1e-10)),
        )
    elif t == "SHAPE":
        out.update(
            insert=pt(g("insert")),
            size=num(g("size", 1)),
            name=g("name", ""),
            rotation=num(g("rotation", 0)),
            widthFactor=num(g("xscale", 1)),
            oblique=num(g("oblique", 0)),
            thickness=num(g("thickness", 0)),
            extrusion=pt(g("extrusion", (0, 0, 1))),
        )
    elif t == "LWPOLYLINE":
        out.update(
            flags=num(g("flags", 0)),
            constantWidth=num(g("const_width", 0)),
            elevation=num(g("elevation", 0)),
            thickness=num(g("thickness", 0)),
            extrusion=pt(g("extrusion", (0, 0, 1))),
            vertices=[[num(x) for x in p] for p in e.get_points("xyseb")],
        )
    elif t == "POLYLINE":
        out.update(
            flags=num(g("flags", 0)),
            elevationPoint=pt(g("elevation")),
            thickness=num(g("thickness", 0)),
            defaultStartWidth=num(g("default_start_width", 0)),
            defaultEndWidth=num(g("default_end_width", 0)),
            m=num(g("m_count", 0)),
            n=num(g("n_count", 0)),
            mDensity=num(g("m_smooth_density", 0)),
            nDensity=num(g("n_smooth_density", 0)),
            smoothType=num(g("smooth_type", 0)),
            extrusion=pt(g("extrusion", (0, 0, 1))),
            vertices=[vertex(v) for v in e.vertices],
        )
    elif t == "TEXT":
        text_props(e, out)
    elif t in ("ATTRIB", "ATTDEF"):
        out = attrib(e)
    elif t == "INSERT":
        out.update(
            blockName=g("name", ""),
            insert=pt(g("insert")),
            scale=[num(g("xscale", 1)), num(g("yscale", 1)), num(g("zscale", 1))],
            rotation=num(g("rotation", 0)),
            columnCount=num(g("column_count", 1)),
            rowCount=num(g("row_count", 1)),
            columnSpacing=num(g("column_spacing", 0)),
            rowSpacing=num(g("row_spacing", 0)),
            extrusion=pt(g("extrusion", (0, 0, 1))),
            attribs=[attrib(a) for a in e.attribs],
        )
    return out


def vertex(v) -> dict:
    d = v.dxf
    faces = [num(d.get(n)) for n in ("vtx0", "vtx1", "vtx2", "vtx3") if d.hasattr(n) and d.get(n)]
    return {
        "layer": d.get("layer", "0"),
        "location": pt(d.get("location", (0, 0, 0))),
        "startWidth": num(opt(d, "start_width")),
        "endWidth": num(opt(d, "end_width")),
        "bulge": num(d.get("bulge", 0)),
        "flags": num(d.get("flags", 0)),
        "tangent": num(opt(d, "tangent")),
        "faceIndices": faces,
    }


PARSED = {
    "LINE",
    "POINT",
    "CIRCLE",
    "ARC",
    "ELLIPSE",
    "SOLID",
    "TRACE",
    "3DFACE",
    "RAY",
    "XLINE",
    "SPLINE",
    "SHAPE",
    "LWPOLYLINE",
    "POLYLINE",
    "TEXT",
    "ATTRIB",
    "ATTDEF",
    "INSERT",
}


def header_value(v: Any) -> Any:
    if isinstance(v, (str, bool, int, float)):
        return num(v) if not isinstance(v, str) else v
    try:
        seq = list(v)
        return pt(seq)
    except TypeError:
        return str(v)


def xdata_int(entry, appid: str, code: int) -> Any:
    try:
        if not entry.has_xdata(appid):
            return None
        for tag in entry.get_xdata(appid):
            if tag.code == code:
                return int(tag.value)
    except Exception:  # noqa: BLE001 - malformed xdata
        return None
    return None


def tables(doc) -> dict:
    layers = {}
    for layer in doc.layers:
        d = layer.dxf
        key = d.get("name", "").upper()
        if key in layers:
            continue
        color = d.get("color", 7)
        layers[key] = {
            "name": d.get("name", ""),
            "color": num(abs(color)),
            "off": color < 0,
            "frozen": bool(d.get("flags", 0) & 1),
            "locked": bool(d.get("flags", 0) & 4),
            "linetype": d.get("linetype", "Continuous"),
            "plot": bool(d.get("plot", 1)),
            "lineweight": num(d.get("lineweight", -3)),
            "trueColor": num(opt(d, "true_color")),
            "transparency": xdata_int(layer, "AcCmTransparency", 1071),
        }
    linetypes = {}
    for lt in doc.linetypes:
        d = lt.dxf
        key = d.get("name", "").upper()
        if key in linetypes:
            continue
        tags = lt.pattern_tags.tags
        length = 0
        elements = []
        for tag in tags:
            if tag.code == 40:
                length = num(tag.value)
            elif tag.code == 49:
                elements.append(num(tag.value))
        linetypes[key] = {
            "name": d.get("name", ""),
            "description": d.get("description", ""),
            "patternLength": length,
            "elements": elements,
        }
    styles = {}
    for st in doc.styles:
        d = st.dxf
        name = d.get("name", "")
        # nameless shape-file entries (flag 1): key by font file
        key = name.upper() or f"<{d.get('font', '').upper()}>"
        if key in styles:
            continue
        styles[key] = {
            "name": name,
            "flags": num(d.get("flags", 0)),
            "font": d.get("font", ""),
            "bigFont": d.get("bigfont", ""),
            "fixedHeight": num(d.get("height", 0)),
            "widthFactor": num(d.get("width", 1)),
            "oblique": num(d.get("oblique", 0)),
            "generationFlags": num(d.get("generation_flags", 0)),
        }
    block_records = sorted({br.dxf.get("name", "").upper() for br in doc.block_records})
    return {"layers": layers, "linetypes": linetypes, "styles": styles, "blockRecords": block_records}


def dump(doc) -> dict:
    header = {}
    for name in HEADER_VARS:
        if name in doc.header:
            try:
                header[name] = header_value(doc.header.get(name))
            except Exception:  # noqa: BLE001
                header[name] = None
    blocks = {}
    for b in doc.blocks:
        key = b.name.upper()
        if key in LAYOUT_BLOCKS or key in blocks:
            continue
        blk = b.block
        blocks[key] = {
            "name": b.name,
            "flags": num(blk.dxf.get("flags", 0)) if blk else 0,
            "basePoint": pt(blk.dxf.get("base_point", (0, 0, 0))) if blk else [0, 0, 0],
            "entities": [entity(e) for e in b],
        }
    layouts = {}
    for name in doc.layouts.names():
        layout = doc.layouts.get(name)
        layouts[name.upper()] = {
            "block": layout.block_record_name.upper(),
            "tabOrder": num(layout.dxf.get("taborder", 0)),
        }
    return {
        "header": header,
        "tables": tables(doc),
        "layouts": layouts,
        "blocks": blocks,
        "modelspace": [entity(e) for e in doc.modelspace()],
        "paperspace": [entity(e) for e in doc.paperspace()],
    }


def load(path: str):
    try:
        return ezdxf.readfile(path), "readfile", None
    except Exception as e:  # noqa: BLE001 - any failure → recover mode
        first = f"{type(e).__name__}: {e}"
    doc, _auditor = recover.readfile(path)
    return doc, "recover", first


def dump_file(path: str) -> dict:
    t = time.perf_counter()
    try:
        doc, loader, first_error = load(path)
        result = {"ok": True, "loader": loader, "readfileError": first_error, "ezdxf": ezdxf.__version__}
        result["doc"] = dump(doc)
    except Exception as e:  # noqa: BLE001
        result = {
            "ok": False,
            "ezdxf": ezdxf.__version__,
            "error": f"{type(e).__name__}: {e}",
            "trace": traceback.format_exc(limit=4),
        }
    result["seconds"] = round(time.perf_counter() - t, 3)
    return result


def write(result: dict, out: str) -> None:
    data = json.dumps(result, separators=(",", ":"), ensure_ascii=False, default=str)
    if out.endswith(".gz"):
        with gzip.open(out, "wt", encoding="utf-8", errors="surrogateescape", compresslevel=5) as f:
            f.write(data)
    else:
        with open(out, "w", encoding="utf-8", errors="surrogateescape") as f:
            f.write(data)


def serve() -> None:
    import logging

    logging.disable(logging.CRITICAL)  # ezdxf logs every recovered flaw
    for line in sys.stdin:
        line = line.rstrip("\r\n")
        if not line:
            continue
        src, out = line.split("\t")
        try:
            write(dump_file(src), out)
            print(f"OK\t{out}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"ERR\t{out}\t{type(e).__name__}: {e}", flush=True)


def main(argv: list[str]) -> None:
    if "--serve" in argv:
        serve()
        return
    out = None
    files = []
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            out = argv[i + 1]
            i += 2
            continue
        files.append(argv[i])
        i += 1
    if len(files) != 1:
        print(__doc__)
        sys.exit(2)
    result = dump_file(files[0])
    if out:
        write(result, out)
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main(sys.argv[1:])
