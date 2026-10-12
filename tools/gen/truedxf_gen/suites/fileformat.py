"""DXF container format: syntax variants, versions, encodings, header, handles, XDATA, tables,
objects and malformed input: what AutoCAD opens, rejects or repairs (notes 01, 02, 11a, 11c).

Almost every case is the same small reference drawing (frame, diagonals, circle, TEXT label =
case name; ``base_drawing``) plus ONE variation or deliberate defect applied to the serialised
bytes (``c.byte_filters``). Answers come from the AutoCAD open log (does it open, which
message), the plot (what survived) and the DXFOUT re-save (how AutoCAD normalised it).
Deliberately malformed cases say "Malformed" in the title and allow ezdxf audit errors.
"""

from __future__ import annotations

import math
import struct
from typing import Optional

import ezdxf
from ezdxf.math import Vec2
from ezdxf.acis import api as acis
from ezdxf.render import forms

from ..core import SuiteBuilder, suite
from ..resources import TTF_FONTS
from ._fileformat_util import (
    ProxyGraphicBuilder,
    Tags,
    base_drawing,
    export_acis,
    binary_dxf,
    eol_filter,
    hex_chunks,
    replace_bytes,
    tagfilter,
)

OUT = ["png", "dxf"]
VERSIONS = ["R12", "R2000", "R2004", "R2007", "R2010", "R2013", "R2018"]


# --------------------------------------------------------------------------------------------
# small tag helpers (all operate on the entity with handle ``h``)


def _idx(t: Tags, h: str, code: int, nth: int = 0) -> int:
    s, e = t.entity(h)
    return t.find_all(code, None, s, e)[nth]


def _after(t: Tags, h: str, code: int, tags, nth: int = 0) -> None:
    t.insert(_idx(t, h, code, nth) + 1, tags)


def _before(t: Tags, h: str, code: int, tags, nth: int = 0) -> None:
    t.insert(_idx(t, h, code, nth), tags)


def _setv(t: Tags, h: str, code: int, value, nth: int = 0) -> None:
    t.set(_idx(t, h, code, nth), value)


def _drop(t: Tags, h: str, code: int, value=None) -> None:
    s, e = t.entity(h)
    for i in reversed(t.find_all(code, value, s, e)):
        t.remove(i)


def _end(t: Tags, h: str, tags) -> None:
    """Append tags at the end of entity ``h``."""
    s, e = t.entity(h)
    t.insert(e, tags)


def _remove_entity(t: Tags, h: str) -> None:
    s, e = t.entity(h)
    t.remove(s, e)


def _nod_remove_key(t: Tags, key: str) -> Optional[str]:
    """Remove ``3 key / 350 handle`` from the root dictionary; returns the handle."""
    s, e = t.section("OBJECTS")
    ds, de = s + 2, t.next0(s + 2)
    i = t.must(3, key, ds, de)
    h = t.svalue(i + 1)
    t.remove(i, i + 2)
    return h


def _objects_first(t: Tags) -> tuple[int, int]:
    s, e = t.section("OBJECTS")
    return s + 2, t.next0(s + 2)


# --------------------------------------------------------------------------------------------


@suite(
    "fileformat",
    "DXF container: syntax, versions, encodings, header, handles, XDATA, tables, objects, malformed input",
    description="One small reference drawing per case plus one deliberate variation/defect; answered by the AutoCAD open log, plot and DXFOUT.",
)
def build(s: SuiteBuilder) -> None:
    def mk(name, title, qs=(), ver="R2018", malformed=False, tags=(), params=None, header=None,
           outputs=OUT, label=None, style_table=None):
        c = s.case(name, title, tags=["fileformat", *tags], questions=list(qs), dxfversion=ver,
                   params=params or {}, header=header, outputs=list(outputs), style_table=style_table)
        h = base_drawing(c, label if label is not None else name)
        if malformed:
            c.allow_audit_errors = True
        return c, h

    _versions(s, mk)
    _syntax(s, mk)
    _numbers(s, mk)
    _binary(s, mk)
    _structure(s, mk)
    _xdata(s, mk)
    _handles(s, mk)
    _encoding(s, mk)
    _header(s, mk)
    _tables(s, mk)
    _objects(s, mk)
    _entities(s, mk)
    _mtext_attachment(s, mk)
    _malformed_misc(s, mk)
    _binary_chunks(s, mk)
    _corpus(s, mk)


# --------------------------------------------------------------------------------------------
# versions (Q-0001, Q-0048)


def _versions(s, mk) -> None:
    for v in VERSIONS:
        c, h = mk(f"version-{v.lower()}", f"Same small drawing written as DXF {v} (open, plot, DXFOUT formatting)",
                  ["Q-0001", "Q-0048"], ver=v, tags=["version"], params={"dxfversion": v})
        c.msp.add_arc((100, 75), 45, 20, 160)
        c.msp.add_point((100, 75))
        if v == "R12":
            c.msp.add_polyline2d([(40, 20, 0, 0, -0.4), (160, 20, 0, 0, 0)], format="xyseb")
        else:
            c.msp.add_lwpolyline([(40, 20, 0, 0, -0.4), (160, 20)], format="xyseb")
        # values whose float formatting is interesting: 1/3, 0.1+0.2, 1e-7 offset
        c.msp.add_line((100 / 3, 50 + 1e-7), (0.1 + 0.2 + 150, 2 / 3 * 100 + 1e-9))


# --------------------------------------------------------------------------------------------
# syntax: line ends, whitespace, case, comments, empty lines, NUL, truncation (Q-0003..Q-0012)


def _syntax(s, mk) -> None:
    eols = {"lf": b"\n", "cr": b"\r", "crlf": b"\r\n", "crcrlf": b"\r\r\n"}
    for v in ("R12", "R2004", "R2018"):
        for en, eol in eols.items():
            c, h = mk(f"eol-{en}-{v.lower()}", f"Line endings {en.upper()} in a DXF {v} file", ["Q-0003"], ver=v,
                      malformed=en in ("cr", "crcrlf"), tags=["line-endings"], params={"eol": en})
            c.byte_filters.append(eol_filter(eol))

    for v in ("R12", "R2018"):
        # trailing spaces after structure names
        def ts_types(t: Tags):
            for i in range(len(t)):
                if t.code(i) == 0 and t.value(i) in (b"LINE", b"CIRCLE", b"TEXT"):
                    t.set(i, t.value(i) + b" ")

        def ts_sections(t: Tags):
            for i in range(len(t)):
                if t.code(i) == 0 and t.value(i) in (b"SECTION", b"ENDSEC", b"EOF"):
                    t.set(i, t.value(i) + b" ")
                elif t.code(i) == 2 and i > 0 and t.value(i - 1) == b"SECTION":
                    t.set(i, t.value(i) + b" ")

        c, h = mk(f"trailing-space-types-{v.lower()}", f"Malformed: entity type values 'LINE ', 'CIRCLE ', 'TEXT ' with trailing space ({v})",
                  ["Q-0004"], ver=v, malformed=True, tags=["whitespace"])
        c.byte_filters.append(tagfilter(ts_types))
        c, h = mk(f"trailing-space-sections-{v.lower()}", f"Malformed: 'SECTION ', 'ENDSEC ', 'EOF ' and section names with trailing space ({v})",
                  ["Q-0004"], ver=v, malformed=True, tags=["whitespace"])
        c.byte_filters.append(tagfilter(ts_sections))

        # padded group-code lines
        for pn, fmt in (("tab", lambda code: b"\t%d" % code), ("trailing-space", lambda code: b"%3d " % code),
                        ("no-pad", lambda code: b"%d" % code), ("wide-pad", lambda code: b"%6d" % code)):
            def pad(t: Tags, fmt=fmt):
                for p in t.pairs:
                    p[0] = fmt(int(p[0]))

            c, h = mk(f"code-pad-{pn}-{v.lower()}", f"Group-code lines formatted as {pn} (e.g. {fmt(0)!r}) in every tag ({v})",
                      ["Q-0005"], ver=v, malformed=pn in ("tab", "trailing-space"), tags=["whitespace"], params={"format": pn})
            c.byte_filters.append(tagfilter(pad))

        # lowercase structure names
        def lower_all(t: Tags):
            for i in range(len(t)):
                if t.code(i) == 0 or (t.code(i) == 2 and i > 0 and t.value(i - 1) in (b"SECTION", b"TABLE")):
                    t.set(i, t.value(i).lower())

        def lower_types(t: Tags):
            s0, e0 = t.section("ENTITIES")
            for i in range(s0 + 2, e0):
                if t.code(i) == 0:
                    t.set(i, t.value(i).lower())

        c, h = mk(f"lowercase-all-{v.lower()}", f"Malformed: every code-0 value and section/table name lower case ('section', 'line', 'eof') ({v})",
                  ["Q-0006"], ver=v, malformed=True, tags=["case"])
        c.byte_filters.append(tagfilter(lower_all))
        c, h = mk(f"lowercase-entities-{v.lower()}", f"Malformed: entity type names lower case ('line', 'circle', 'text') ({v})",
                  ["Q-0006"], ver=v, malformed=True, tags=["case"])
        c.byte_filters.append(tagfilter(lower_types))

    # 999 comments
    for v in ("R12", "R2004"):
        def cm_top(t: Tags):
            t.insert(0, [(999, "truedxf comment at file start"), (999, "second comment line")])

        def cm_sections(t: Tags):
            for i in reversed(t.find_all(0, "SECTION")):
                t.insert(i + 1, [(999, "comment between SECTION and its name")])

        def cm_entity(t: Tags, v=v):
            s0, e0 = t.section("ENTITIES")
            i = t.must(8, None, s0)
            t.insert(i + 1, [(999, "comment inside an entity")])
            t.insert(s0 + 2, [(999, "comment before the first entity")])

        for cn, fn in (("top", cm_top), ("sections", cm_sections), ("entity", cm_entity)):
            c, h = mk(f"comment-999-{cn}-{v.lower()}", f"999 comments: {cn} ({v})", ["Q-0007"], ver=v, tags=["comment"], params={"where": cn})
            c.byte_filters.append(tagfilter(fn))

    # empty value lines vs empty code lines
    c, h = mk("empty-values", "Empty value lines: STYLE 4 '' and header $DIMBLK '' / $DIMPOST '' written as empty lines",
              ["Q-0008"], tags=["empty-line"])
    c.header(dimblk="", dimpost="")
    c.byte_filters.append(tagfilter(lambda t: t.set_header("$DIMBLK", (1, b""))))
    for v in ("R12", "R2018"):
        c, h = mk(f"empty-code-line-{v.lower()}", f"Malformed: one extra empty line before the group code after the TEXT value ({v})",
                  ["Q-0008"], ver=v, malformed=True, tags=["empty-line"])
        c.byte_filters.append(replace_bytes(b"\n  1\nempty-code-line-" + v.lower().encode() + b"\n",
                                            b"\n  1\nempty-code-line-" + v.lower().encode() + b"\n\n", 1))

    # NUL bytes
    c, h = mk("nul-layer-name", "Malformed: LAYER record name 'WALL' followed by 12 NUL bytes; LINE on layer WALL", ["Q-0009"],
              ver="R2004", malformed=True, tags=["nul"], style_table="acad.ctb")
    c.layer("WALL", color=1)
    c.msp.add_line((20, 75), (180, 75), dxfattribs={"layer": "WALL"})

    def nul_layer(t: Tags):
        s0, e0 = t.table("LAYER")
        t.set(t.must(2, "WALL", s0, e0), b"WALL" + b"\x00" * 12)

    c.byte_filters.append(tagfilter(nul_layer))
    c, h = mk("nul-text-value", "Malformed: TEXT value with 4 NUL bytes in the middle ('AB\\0\\0\\0\\0CD')", ["Q-0009"], ver="R2004", malformed=True, tags=["nul"])
    c.msp.add_text("ABNULCD", height=10, dxfattribs={"insert": (40, 60)})
    c.byte_filters.append(replace_bytes(b"\nABNULCD\n", b"\nAB\x00\x00\x00\x00CD\n"))

    # truncation
    def cut_after_entities(keep_endsec: bool, keep_eof: bool):
        def f(t: Tags):
            s0, e0 = t.section("ENTITIES")
            del t.pairs[e0 + (1 if keep_endsec else 0):]
            if keep_eof:
                t.insert(len(t), [(0, "EOF")])
        return f

    for v in ("R12", "R2018"):
        c, h = mk(f"truncated-no-endsec-{v.lower()}", f"Malformed: file ends after the last entity (no ENDSEC, no following sections, no EOF) ({v})",
                  ["Q-0010"], ver=v, malformed=True, tags=["truncated"])
        c.byte_filters.append(tagfilter(cut_after_entities(False, False)))
        c, h = mk(f"truncated-no-eof-{v.lower()}", f"Malformed: file ends with ENDSEC of the last section, no 0/EOF ({v})",
                  ["Q-0010"], ver=v, malformed=True, tags=["truncated"])
        c.byte_filters.append(lambda d: d[: d.rindex(b"  0\nEOF\n")])
        c, h = mk(f"eof-no-newline-{v.lower()}", f"Final '0/EOF' without trailing newline ({v})", ["Q-0010"], ver=v, tags=["truncated"])
        c.byte_filters.append(lambda d: d[:-1])
        c, h = mk(f"data-after-eof-{v.lower()}", f"Garbage lines after 0/EOF ({v})", ["Q-0010"], ver=v, malformed=True, tags=["truncated"])
        c.byte_filters.append(lambda d: d + b"  0\nLINE\n  8\n0\ngarbage\n")
    c, h = mk("truncated-mid-entity", "Malformed: R2018 file cut in the middle of the CIRCLE entity (after its 20 value)", ["Q-0010"],
              malformed=True, tags=["truncated"])

    def cut_mid(t: Tags, h=h):
        i = _idx(t, h["circle"], 20)
        del t.pairs[i + 1:]

    c.byte_filters.append(tagfilter(cut_mid))
    c, h = mk("entities-only-r2018-cut", "Malformed: R2018 file whose ENTITIES section is followed directly by EOF (OBJECTS removed)",
              ["Q-0010", "Q-0039"], malformed=True, tags=["truncated"])
    c.byte_filters.append(tagfilter(cut_after_entities(True, True)))

    # bare TABLE outside TABLES (R12)
    c, h = mk("bare-table-r12", "Malformed: R12 file with HEADER, then a bare 0 TABLE/2 LAYER...ENDTAB (no SECTION wrapper, layer BARE red), BLOCKS, ENTITIES",
              ["Q-0011"], ver="R12", malformed=True, tags=["structure"], style_table="acad.ctb")
    c.layer("BARE", color=1)
    c.msp.add_line((20, 60), (180, 60), dxfattribs={"layer": "BARE"})

    def bare_table(t: Tags):
        ls, le = t.table("LAYER")
        layer = t.pairs[ls:le + 1]
        ts, te = t.section("TABLES")
        t.pairs[ts:te + 1] = layer

    c.byte_filters.append(tagfilter(bare_table))

    # long strings (Q-0012, Q-0378)
    for v, lengths in (("R12", (255, 256, 300, 2049)), ("R2018", (251, 255, 256, 300, 2049, 2050, 5000))):
        for n in lengths:
            qs = ["Q-0012"] + (["Q-0378"] if n in (251, 300) and v == "R2018" else [])
            c, h = mk(f"long-text-{n}-{v.lower()}", f"TEXT whose group-1 value has {n} characters ({v})", qs, ver=v,
                      malformed=n > 255, tags=["string-length", "TEXT"], params={"length": n})
            c.msp.add_text("LONGPLACEHOLDER", height=2, dxfattribs={"insert": (12, 50)})
            txt = ("0123456789" * (n // 10 + 1))[:n]
            txt = f"{n}:" + txt[len(str(n)) + 1:]
            c.byte_filters.append(replace_bytes(b"\nLONGPLACEHOLDER\n", b"\n" + txt.encode() + b"\n"))


# --------------------------------------------------------------------------------------------
# number syntax (Q-0017..Q-0023)


def _numbers(s, mk) -> None:
    floats = [("1e1", "3e1"), ("exp-upper", "3.0E+01"), ("leading-dot", ".5"), ("trailing-dot", "30."),
              ("plus", "+30"), ("minus-zero", "-0"), ("padded", " 30 "), ("inner-space", "3 0.5"),
              ("comma", "30,5"), ("many-digits", "30.00000000000000000000000001"), ("hex", "0x1E")]
    for n, val in floats:
        c, h = mk(f"float-{n}", f"LINE start X written as {val!r} (float syntax variant)", ["Q-0017"],
                  malformed=n in ("inner-space", "comma", "hex"), tags=["number-format"], params={"value": val})
        c.byte_filters.append(tagfilter(lambda t, h=h, val=val: _setv(t, h["line"], 10, val.encode())))
    garbage = [("line-x", "line", 10, "30xyz"), ("circle-radius", "circle", 40, "30.11xyz"), ("line-color", "line", 62, "3abc")]
    for n, key, code, val in garbage:
        c, h = mk(f"trailing-garbage-{n}", f"Malformed: {key.upper()} group {code} = {val!r} (number with trailing garbage)", ["Q-0018"],
                  malformed=True, tags=["number-format"], params={"code": code, "value": val})
        if code == 62:
            c.byte_filters.append(tagfilter(lambda t, h=h, val=val: _after(t, h["line"], 8, [(62, val)])))
        else:
            c.byte_filters.append(tagfilter(lambda t, h=h, key=key, code=code, val=val: _setv(t, h[key], code, val)))
    c, h = mk("int-as-float-color", "LINE 62 color written as '1.0' (int16 as float)", ["Q-0019"], malformed=True, tags=["number-format"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _after(t, h["line"], 8, [(62, "1.0")])))
    c, h = mk("int-as-float-flags", "LWPOLYLINE 70 flags written as '1e0' (closed flag as float)", ["Q-0019"], malformed=True, tags=["number-format"])
    pl = c.msp.add_lwpolyline([(40, 40), (160, 40), (100, 110)], close=True)
    c.byte_filters.append(tagfilter(lambda t, hh=pl.dxf.handle: _setv(t, hh, 70, "1e0")))
    c, h = mk("int-as-float-xdata-1071", "XDATA 1071 written as '1.95059E+06' (spec example)", ["Q-0019"], malformed=True, tags=["number-format", "XDATA"])
    c.doc.appids.add("TRUEDXF")
    e = c.doc.entitydb[h["line"]]
    e.set_xdata("TRUEDXF", [(1000, "x"), (1071, 1950590)])
    c.byte_filters.append(replace_bytes(b"\n1071\n1950590\n", b"\n1071\n1.95059E+06\n"))

    c, h = mk("float-17-digits", "LINEs with 17-significant-digit coordinates (0.1+0.2, 1/3, pi) for bit-exact DXFOUT", ["Q-0020"], tags=["number-format"])
    for i, v in enumerate([0.1 + 0.2, 1 / 3, math.pi, 2 ** 0.5, 1e-15 + 1, 123456.78901234567]):
        c.msp.add_line((20 + v, 20 + i * 18 + v), (180 - v, 20 + i * 18 + 2 * v))
    c, h = mk("float-integer-looking", "Reals written without '.0' (e.g. 190 instead of 190.0) in all frame LINE coordinates", ["Q-0020"], tags=["number-format"])

    def intlike(t: Tags, h=h):
        for k in ("frame0", "frame1", "frame2", "frame3"):
            s0, e0 = t.entity(h[k])
            for i in range(s0, e0):
                if 10 <= t.code(i) <= 31 and t.value(i).endswith(b".0"):
                    t.set(i, t.value(i)[:-2])

    c.byte_filters.append(tagfilter(intlike))

    overflow = [("color-32768", "line", 62, "32768", "after8"), ("color-minus-32769", "line", 62, "-32769", "after8"),
                ("lwpolyline-flags-70000", "lw", 70, "70000", "set"), ("circle-radius-1e999", "circle", 40, "1e999", "set"),
                ("circle-radius-inf", "circle", 40, "inf", "set"), ("line-end-nan", "line", 11, "nan", "set"),
                ("line-start-nan-ind", "line", 10, "-nan(ind)", "set"), ("circle-radius-1e300", "circle", 40, "1e300", "set")]
    for n, key, code, val, how in overflow:
        c, h = mk(f"overflow-{n}", f"Malformed: {key.upper()} group {code} = {val} (overflow / non-finite)", ["Q-0021"], malformed=True,
                  tags=["number-format", "overflow"], params={"code": code, "value": val})
        if key == "lw":
            h["lw"] = c.msp.add_lwpolyline([(40, 40), (160, 40), (100, 110)]).dxf.handle
        if how == "after8":
            c.byte_filters.append(tagfilter(lambda t, h=h, key=key, val=val: _after(t, h[key], 8, [(62, val)])))
        else:
            c.byte_filters.append(tagfilter(lambda t, h=h, key=key, code=code, val=val: _setv(t, h[key], code, val)))
    c, h = mk("overflow-header-ltscale-nan", "Malformed: header $LTSCALE = nan, dashed LINE", ["Q-0021"], malformed=True, tags=["number-format", "overflow"])
    c.msp.add_line((20, 60), (180, 60), dxfattribs={"linetype": c.linetype("DASHED")})
    c.byte_filters.append(tagfilter(lambda t: t.set_header("$LTSCALE", (40, "nan"))))

    # int32 450-453
    for n, code, val in (("450-2147483648", 450, "2147483648"), ("451-minus1", 451, "-1"), ("452-4294967295", 452, "4294967295"),
                         ("453-minus1", 453, "-1")):
        c, h = mk(f"gradient-int32-{n}", f"Gradient HATCH with group {code} = {val} (int32 range)", ["Q-0022"], malformed=True,
                  tags=["number-format", "HATCH", "gradient"], style_table="acad.ctb")
        hatch = c.msp.add_hatch()
        hatch.set_gradient((255, 0, 0), (0, 0, 255), rotation=30)
        hatch.paths.add_polyline_path([(40, 30), (160, 30), (160, 110), (40, 110)], is_closed=True)
        c.byte_filters.append(tagfilter(lambda t, hh=hatch.dxf.handle, code=code, val=val: _setv(t, hh, code, val)))

    for n, val in (("0", "0"), ("1", "1"), ("2", "2"), ("minus1", "-1"), ("true", "true"), ("padded", "     1")):
        c, h = mk(f"bool-290-{n}", f"Header $LWDISPLAY (290) = {val!r}", ["Q-0023"], malformed=n in ("true",), tags=["number-format", "bool"],
                  params={"value": val})
        c.byte_filters.append(tagfilter(lambda t, val=val: t.set_header("$LWDISPLAY", (290, val))))


# --------------------------------------------------------------------------------------------
# binary DXF (Q-0015, Q-0016, Q-0024)


def _binary(s, mk) -> None:
    for v, one in (("R12", True), ("R2000", False), ("R2004", False), ("R2018", False)):
        c, h = mk(f"binary-{v.lower()}", f"Binary DXF {v} with {'1' if one else '2'}-byte group codes (the documented layout)",
                  ["Q-0015", "Q-0048"], ver=v, malformed=True, tags=["binary"], params={"one_byte_codes": one})
        c.byte_filters.append(lambda d, one=one: binary_dxf(d, one))
    c, h = mk("binary-r2018-1byte-codes", "Malformed: binary DXF R2018 written with R12-style 1-byte group codes", ["Q-0015"],
              malformed=True, tags=["binary"])
    c.byte_filters.append(lambda d: binary_dxf(d, True))
    c, h = mk("binary-r12-2byte-codes", "Malformed: binary DXF R12 written with 2-byte group codes", ["Q-0015"], ver="R12", malformed=True, tags=["binary"])
    c.byte_filters.append(lambda d: binary_dxf(d, False))
    c, h = mk("binary-ac1014-relabel", "Binary DXF R2000 content relabelled $ACADVER AC1014 (2-byte codes), stands in for an R14 binary file",
              ["Q-0015", "Q-0047"], ver="R2000", malformed=True, tags=["binary", "version"])
    c.byte_filters.append(tagfilter(lambda t: t.set_header("$ACADVER", (1, "AC1014"))))
    c.byte_filters.append(lambda d: binary_dxf(d, False))
    for hex_text in (False, True):
        n = "hex-text" if hex_text else "raw"
        c, h = mk(f"binary-proxy-310-{n}", f"Binary DXF R2018 with an ACAD_PROXY_ENTITY whose 310 data is written as {'hex text (malformed)' if hex_text else 'raw bytes'}",
                  ["Q-0016"], malformed=True, tags=["binary", "ACAD_PROXY_ENTITY"])
        add_proxy_entity(c, ProxyGraphicBuilder().circle((100, 75, 0), 20).polyline([(60, 40), (140, 40), (140, 110)]))
        c.byte_filters.append(lambda d, hex_text=hex_text: binary_dxf(d, False, hex_as_text=hex_text))

    # XDATA 1004
    for n, val in (("hex", None), ("plain-text", "hello world"), ("odd-hex", "ABC"), ("lowercase-hex", "deadbeef")):
        c, h = mk(f"xdata-1004-{n}", f"LINE with XDATA 1004 binary chunk: {n}" + (f" value {val!r}" if val else ""), ["Q-0024"],
                  malformed=val is not None and n != "lowercase-hex", tags=["XDATA", "1004"], params={"value": val})
        c.doc.appids.add("TRUEDXF")
        c.doc.entitydb[h["line"]].set_xdata("TRUEDXF", [(1000, "bin"), (1004, b"\x01\x02\xfe\xff")])
        if val is not None:
            c.byte_filters.append(replace_bytes(b"\n1004\n0102FEFF\n", b"\n1004\n" + val.encode() + b"\n"))
    c, h = mk("xdata-1004-binary-dxf", "Binary DXF R2018 with XDATA 1004 (length-prefixed chunk)", ["Q-0024"], malformed=True, tags=["XDATA", "1004", "binary"])
    c.doc.appids.add("TRUEDXF")
    c.doc.entitydb[h["line"]].set_xdata("TRUEDXF", [(1000, "bin"), (1004, b"\x01\x02\xfe\xff")])
    c.byte_filters.append(lambda d: binary_dxf(d, False))


# --------------------------------------------------------------------------------------------
# proxy entity (shared with the misc suite)

PROXY_CLASS = "TRUEDXF_PROXY_TEST"


def add_proxy_entity(c, graphics: Optional[ProxyGraphicBuilder], layer: str = "0", code: Optional[int] = None,
                     color: Optional[int] = None, owner_block: Optional[str] = None) -> None:
    """Add an ACAD_PROXY_ENTITY (custom class TRUEDXF_PROXY_TEST, no entity data) with the given
    proxy graphics. ezdxf cannot create it, so a placeholder POINT is replaced by the tags.
    ``code``: graphics byte-count group (default 160 for R2013+, else 92)."""
    layout = c.doc.blocks.get(owner_block) if owner_block else c.msp
    marker = layout.add_point((0, 0), dxfattribs={"layer": layer})
    handle = marker.dxf.handle
    data = graphics.data() if graphics is not None else b""
    if code is None:
        code = 160 if c.doc.dxfversion >= "AC1027" else 92
    # 95 = AcDbDwgVersion enum (low word) | maintenance release << 16; kDHL_1015=23 ... kDHL_1032=33
    fmt = {"AC1015": 23, "AC1018": 25, "AC1021": 27, "AC1024": 29, "AC1027": 31, "AC1032": 33}.get(c.doc.dxfversion, 33)

    def f(t: Tags):
        # CLASS record (appended at the end of CLASSES); its id = 500 + index
        cs, ce = t.section("CLASSES")
        n = len(t.find_all(0, "CLASS", cs, ce))
        cls = [(0, "CLASS"), (1, PROXY_CLASS), (2, "TdxProxyTest"), (3, "truedxf test application"), (90, 0)]
        if c.doc.dxfversion >= "AC1018":
            cls.append((91, 1))
        cls += [(280, 1), (281, 1)]
        if not t.find_all(1, PROXY_CLASS, cs, ce):
            t.insert(ce, cls)
            class_id = 500 + n
        else:
            class_id = 500 + [i for i in t.find_all(0, "CLASS", cs, ce)].index(t.find(1, PROXY_CLASS, cs, ce) - 1)
        s0, e0 = t.entity(handle)
        owner = t.svalue(t.must(330, None, s0, e0))
        tags = [(0, "ACAD_PROXY_ENTITY"), (5, handle), (330, owner), (100, "AcDbEntity"), (8, layer)]
        if color is not None:
            tags.append((62, color))
        tags += [(100, "AcDbProxyEntity"), (90, 498), (91, class_id), (code, len(data))]
        tags += [(310, ch) for ch in hex_chunks(data)]
        tags += [(93, 0), (94, 0), (95, fmt), (70, 0)]
        t.pairs[s0:e0] = []
        t.insert(s0, tags)

    c.byte_filters.insert(0, tagfilter(f))
    c.allow_audit_errors = True


# --------------------------------------------------------------------------------------------
# structure / sections / classes (Q-0039..Q-0043, Q-0047, Q-0051, Q-0071)


def _structure(s, mk) -> None:
    def strip_section(name):
        def f(t: Tags):
            a, b = t.section(name)
            t.remove(a, b + 1)
        return f

    c, h = mk("r2000-no-classes", "Malformed: AC1015 file without CLASSES section", ["Q-0039"], ver="R2000", malformed=True, tags=["structure"])
    c.byte_filters.append(tagfilter(strip_section("CLASSES")))
    c, h = mk("r2000-no-objects", "Malformed: AC1015 file without OBJECTS section", ["Q-0039"], ver="R2000", malformed=True, tags=["structure"])
    c.byte_filters.append(tagfilter(strip_section("OBJECTS")))
    c, h = mk("r2000-no-root-dict", "Malformed: AC1015 file whose OBJECTS lacks the root (named object) DICTIONARY", ["Q-0039"], ver="R2000",
              malformed=True, tags=["structure", "DICTIONARY"])
    c.byte_filters.append(tagfilter(lambda t: t.remove(*_objects_first(t))))
    c, h = mk("r2000-no-acad-group", "Malformed: AC1015 root dictionary without the ACAD_GROUP entry (dictionary object kept)", ["Q-0039"], ver="R2000",
              malformed=True, tags=["structure", "DICTIONARY"])
    c.byte_filters.append(tagfilter(lambda t: _nod_remove_key(t, "ACAD_GROUP")))
    c, h = mk("r2000-empty-classes", "AC1015 file with an empty CLASSES section and DIMENSION, HATCH, LWPOLYLINE", ["Q-0042", "Q-0039"], ver="R2000",
              malformed=True, tags=["structure", "CLASS"])
    _dim_hatch_lw(c)
    c.byte_filters.append(tagfilter(lambda t: t.remove(t.section("CLASSES")[0] + 2, t.section("CLASSES")[1])))
    c, h = mk("r2004-empty-classes", "AC1018 file with an empty CLASSES section and DIMENSION, HATCH, LWPOLYLINE", ["Q-0042"], ver="R2004",
              malformed=True, tags=["structure", "CLASS"])
    _dim_hatch_lw(c)
    c.byte_filters.append(tagfilter(lambda t: t.remove(t.section("CLASSES")[0] + 2, t.section("CLASSES")[1])))

    def drop_class(*names):
        def f(t: Tags):
            cs, ce = t.section("CLASSES")
            for nm in names:
                i = t.find(1, nm, cs, ce)
                if i > 0:
                    t.remove(i - 1, t.next0(i - 1))
                    cs, ce = t.section("CLASSES")
        return f

    c, h = mk("class-missing-mesh", "Malformed: R2018 MESH without its CLASS record", ["Q-0042"], malformed=True, tags=["CLASS", "MESH"])
    _mesh(c)
    c.byte_filters.append(tagfilter(drop_class("MESH")))
    c, h = mk("class-missing-image", "Malformed: R2018 IMAGE without IMAGE/IMAGEDEF/IMAGEDEF_REACTOR CLASS records", ["Q-0042"], malformed=True, tags=["CLASS", "IMAGE"])
    _image(c)
    c.byte_filters.append(tagfilter(drop_class("IMAGE", "IMAGEDEF", "IMAGEDEF_REACTOR", "RASTERVARIABLES")))
    c, h = mk("class-missing-mleader", "Malformed: R2018 MULTILEADER without MULTILEADER/MLEADERSTYLE CLASS records", ["Q-0042"], malformed=True, tags=["CLASS", "MULTILEADER"])
    _mleader(c)
    c.byte_filters.append(tagfilter(drop_class("MULTILEADER", "MLEADERSTYLE")))
    c, h = mk("class-missing-wipeout", "Malformed: R2018 WIPEOUT without WIPEOUT/WIPEOUTVARIABLES CLASS records", ["Q-0042"], malformed=True, tags=["CLASS", "WIPEOUT"])
    c.msp.add_wipeout([(60, 50), (140, 50), (140, 100), (60, 100)])
    c.byte_filters.append(tagfilter(drop_class("WIPEOUT", "WIPEOUTVARIABLES")))
    c, h = mk("class-missing-lwpolyline-r2018", "R2018 LWPOLYLINE + HATCH + DIMENSION with all CLASS records removed", ["Q-0042"], malformed=True, tags=["CLASS"])
    _dim_hatch_lw(c)
    c.byte_filters.append(tagfilter(lambda t: t.remove(t.section("CLASSES")[0] + 2, t.section("CLASSES")[1])))

    def swap_280_281(t: Tags):
        cs, ce = t.section("CLASSES")
        for i in t.find_all(280, None, cs, ce):
            if t.code(i + 1) == 281:
                t.pairs[i], t.pairs[i + 1] = t.pairs[i + 1], t.pairs[i]

    c, h = mk("class-281-before-280", "Malformed: AC1015 CLASS records with 281 written before 280", ["Q-0043"], ver="R2000", malformed=True, tags=["CLASS"])
    c.byte_filters.append(tagfilter(swap_280_281))

    def class_without_280_281(t: Tags):
        cs, ce = t.section("CLASSES")
        for i in reversed(t.find_all(280, None, cs, ce) + t.find_all(281, None, cs, ce)):
            t.remove(i)

    c, h = mk("class-no-280-281", "Malformed: R2018 CLASS records without 280/281", [], malformed=True, tags=["CLASS"])
    c.byte_filters.append(tagfilter(class_without_280_281))

    def class_91_r2000(t: Tags):
        cs, ce = t.section("CLASSES")
        for i in reversed(t.find_all(90, None, cs, ce)):
            t.insert(i + 1, [(91, 0)])

    c, h = mk("class-91-in-r2000", "Malformed: AC1015 CLASS records with a 91 instance count (valid only from AC1018)", [], ver="R2000",
              malformed=True, tags=["CLASS"])
    c.byte_filters.append(tagfilter(class_91_r2000))

    c, h = mk("r2000-acadver-missing", "Malformed: AC1015 file with the $ACADVER header variable removed", ["Q-0071"], ver="R2000", malformed=True, tags=["header", "version"])
    c.byte_filters.append(tagfilter(lambda t: t.del_header("$ACADVER")))
    c, h = mk("r2018-acadver-missing", "Malformed: AC1032 file with the $ACADVER header variable removed", ["Q-0071"], malformed=True, tags=["header", "version"])
    c.byte_filters.append(tagfilter(lambda t: t.del_header("$ACADVER")))

    for n, extra in (("relabel", False), ("relabel-empty-classes", True)):
        c, h = mk(f"ac1014-{n}", "AC1015 content relabelled $ACADVER AC1014" + (" with an empty CLASSES section" if extra else ""),
                  ["Q-0047"], ver="R2000", malformed=True, tags=["version"])

        def ac1014(t: Tags, extra=extra):
            t.set_header("$ACADVER", (1, "AC1014"))
            if extra:
                cs, ce = t.section("CLASSES")
                t.remove(cs + 2, ce)
        c.byte_filters.append(tagfilter(ac1014))
    for n, val in (("ac1012", "AC1012"), ("ac1006", "AC1006"), ("ac1040", "AC1040"), ("garbage", "AC9999")):
        c, h = mk(f"acadver-{n}", f"R2000/R12 content with $ACADVER {val}", ["Q-0047"], ver="R12" if n == "ac1006" else "R2000", malformed=True, tags=["version"])
        c.byte_filters.append(tagfilter(lambda t, val=val: t.set_header("$ACADVER", (1, val))))

    for v in ("R12", "R2004", "R2018"):
        c, h = mk(f"utf8-bom-{v.lower()}", f"ASCII DXF {v} prefixed with a UTF-8 BOM (EF BB BF)", ["Q-0051"], ver=v, malformed=True, tags=["encoding", "BOM"])
        c.byte_filters.append(lambda d: b"\xef\xbb\xbf" + d)

    # hand-written minimal files
    c, h = mk("acs1244-minimal-ac1015", "Minimal AC1015: HEADER($ACADVER only)+TABLES(LAYER only)+ENTITIES, LINE on undefined layer", ["Q-0040"],
              ver="R2000", malformed=True, tags=["structure", "minimal"])
    c.byte_filters.append(lambda d: _minimal_file("AC1015", tables=True, handles=True))
    c, h = mk("entities-only-no-handles", "ENTITIES-only DXF: no HEADER/$ACADVER, no handles (R12-style entity tags)", ["Q-0041"],
              ver="R12", malformed=True, tags=["structure", "minimal"])
    c.byte_filters.append(lambda d: _minimal_file(None, tables=False, handles=False))
    c, h = mk("entities-only-handles", "ENTITIES-only DXF with handles on entities but no HEADER", ["Q-0041"], ver="R12", malformed=True, tags=["structure", "minimal"])
    c.byte_filters.append(lambda d: _minimal_file(None, tables=False, handles=True))
    c, h = mk("entities-only-r2000-tags", "ENTITIES-only DXF, no HEADER, entities with R2000 subclass markers and handles", ["Q-0041"], ver="R12", malformed=True,
              tags=["structure", "minimal"])
    c.byte_filters.append(lambda d: _minimal_file(None, tables=False, handles=True, subclass=True))


def _minimal_file(acadver: Optional[str], tables: bool, handles: bool, subclass: bool = False) -> bytes:
    L: list[tuple[int, str]] = []
    if acadver:
        L += [(0, "SECTION"), (2, "HEADER"), (9, "$ACADVER"), (1, acadver), (0, "ENDSEC")]
    if tables:
        L += [(0, "SECTION"), (2, "TABLES"), (0, "TABLE"), (2, "LAYER"), (70, 1), (0, "LAYER"), (2, "0"), (70, 0), (62, 7),
              (6, "CONTINUOUS"), (0, "ENDTAB"), (0, "ENDSEC")]
    L += [(0, "SECTION"), (2, "ENTITIES")]
    lines = [((10, 10), (190, 10)), ((190, 10), (190, 140)), ((190, 140), (10, 140)), ((10, 140), (10, 10)),
             ((30, 30), (170, 120)), ((30, 120), (170, 30))]
    hnd = 0x100
    for i, (a, b) in enumerate(lines):
        L.append((0, "LINE"))
        if handles:
            L.append((5, f"{hnd:X}"))
            hnd += 1
        if subclass:
            L.append((100, "AcDbEntity"))
        L.append((8, "UNDEFINED_LAYER" if i >= 4 else "0"))
        if subclass:
            L.append((100, "AcDbLine"))
        L += [(10, repr(float(a[0]))), (20, repr(float(a[1]))), (30, "0.0"), (11, repr(float(b[0]))), (21, repr(float(b[1]))), (31, "0.0")]
    L += [(0, "CIRCLE")] + ([(5, f"{hnd:X}")] if handles else []) + ([(100, "AcDbEntity")] if subclass else []) + [(8, "0")]
    L += ([(100, "AcDbCircle")] if subclass else []) + [(10, "100.0"), (20, "75.0"), (30, "0.0"), (40, "30.0")]
    L += [(0, "ENDSEC"), (0, "EOF")]
    return b"".join(b"%3d\n%s\n" % (code, str(v).encode()) for code, v in L)


def _dim_hatch_lw(c) -> None:
    c.msp.add_lwpolyline([(20, 20), (60, 20), (60, 50, 0, 0, 0.5), (20, 50)], close=True)
    hatch = c.msp.add_hatch(color=3)
    hatch.paths.add_polyline_path([(120, 20), (170, 20), (170, 50), (120, 50)], is_closed=True)
    dim = c.msp.add_linear_dim(base=(100, 105), p1=(40, 95), p2=(160, 95))
    dim.render()


def _mesh(c, level: int = 0):
    mesh = c.msp.add_mesh()
    cube = forms.cube().scale_uniform(50).translate(100, 75, 0)
    with mesh.edit_data() as md:
        md.vertices = list(cube.vertices)
        md.faces = list(cube.faces)
    mesh.dxf.subdivision_levels = level
    return mesh


def _png(w: int = 16, h: int = 12) -> bytes:
    import zlib
    raw = b""
    for y in range(h):
        raw += b"\x00" + b"".join(bytes(((x * 16) & 255, (y * 20) & 255, 128)) for x in range(w))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def _image(c, fname: str = "fileformat-img.png", relative: bool = False, clip=None):
    path = c.add_file(fname, _png())
    idef = c.doc.add_image_def(fname if relative else path, size_in_pixel=(16, 12))
    img = c.msp.add_image(idef, insert=(60, 45), size_in_units=(80, 60))
    if clip:
        img.set_boundary_path(clip)
    return img


def _mleader(c):
    ml = c.msp.add_multileader_mtext("Standard")
    ml.set_content("MLEADER", char_height=5)
    ml.add_leader_line(ezdxf.render.mleader.ConnectionSide.left, [(40, 40)])
    ml.build(insert=Vec2(90, 90))
    return ml


# --------------------------------------------------------------------------------------------
# XDATA and app-data (Q-0024..Q-0036)


def _xdata(s, mk) -> None:
    # undefined group codes
    for code in (85, 155, 305):
        c, h = mk(f"undef-code-{code}-r12", f"Malformed: R12 LINE with undefined group code {code} after its layer", ["Q-0025"], ver="R12",
                  malformed=True, tags=["undefined-code"], params={"code": code})
        c.byte_filters.append(tagfilter(lambda t, h=h, code=code: _after(t, h["line"], 8, [(code, "1")])))
        c, h = mk(f"undef-code-{code}-acdbentity", f"Malformed: R2018 LINE with undefined group code {code} in AcDbEntity", ["Q-0025"],
                  malformed=True, tags=["undefined-code"], params={"code": code})
        c.byte_filters.append(tagfilter(lambda t, h=h, code=code: _after(t, h["line"], 8, [(code, "1")])))
        c, h = mk(f"undef-code-{code}-acdbline", f"Malformed: R2018 LINE with undefined group code {code} at the end of AcDbLine", ["Q-0025"],
                  malformed=True, tags=["undefined-code"], params={"code": code})
        c.byte_filters.append(tagfilter(lambda t, h=h, code=code: _after(t, h["line"], 31, [(code, "1")])))
    for code, val in ((61, "0"), (63, "1"), (5005, "x"), (999, "comment")):
        c, h = mk(f"undef-code-{code}-acdbentity", f"R2018 LINE with group code {code} in AcDbEntity (undocumented)", ["Q-0025"],
                  malformed=True, tags=["undefined-code"], params={"code": code})
        c.byte_filters.append(tagfilter(lambda t, h=h, code=code, val=val: _after(t, h["line"], 8, [(code, val)])))

    for v in ("R12", "R2000"):
        c, h = mk(f"line-interleaved-coords-{v.lower()}", f"LINE with coordinates ordered 10,11,20,21,30,31 ({v})", ["Q-0026"], ver=v,
                  malformed=True, tags=["tag-order"])

        def interleave(t: Tags, h=h):
            s0, e0 = t.entity(h["line"])
            idx = {t.code(i): i for i in range(s0, e0) if t.code(i) in (10, 20, 30, 11, 21, 31)}
            vals = {k: t.pairs[i] for k, i in idx.items()}
            first = min(idx.values())
            order = [10, 11, 20, 21, 30, 31]
            for i in sorted(idx.values(), reverse=True):
                t.remove(i)
            t.pairs[first:first] = [vals[k] for k in order]

        c.byte_filters.append(tagfilter(interleave))
    c, h = mk("r12-line-subclass-markers", "Malformed: R12 LINE with 100 AcDbEntity / 100 AcDbLine markers", ["Q-0027"], ver="R12", malformed=True, tags=["subclass"])

    def r12_markers(t: Tags, h=h):
        _before(t, h["line"], 8, [(100, "AcDbEntity")])
        _before(t, h["line"], 10, [(100, "AcDbLine")])

    c.byte_filters.append(tagfilter(r12_markers))
    c, h = mk("r12-line-reactors", "Malformed: R12 LINE with 102 {ACAD_REACTORS / 330 / 102 }", ["Q-0027"], ver="R12", malformed=True, tags=["app-data"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _after(t, h["line"], 5, [(102, "{ACAD_REACTORS"), (330, "1"), (102, "}")])))
    c, h = mk("r12-line-owner-330", "Malformed: R12 LINE with a 330 owner handle", ["Q-0027"], ver="R12", malformed=True, tags=["handles"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _after(t, h["line"], 5, [(330, "1")])))

    # subclass marker errors (Q-0028)
    for n, wrong in (("correct", None), ("misspelled", "AcDb3dPointAngularDimension")):
        c, h = mk(f"subclass-angular-dim-{n}", f"R2018 3-point angular DIMENSION, subclass marker {wrong or 'as written by ezdxf'}", ["Q-0028"],
                  malformed=wrong is not None, tags=["subclass", "DIMENSION"])
        dim = c.msp.add_angular_dim_3p(base=(100, 110), center=(100, 40), p1=(160, 60), p2=(40, 60))
        dim.render()
        if wrong:
            c.byte_filters.append(replace_bytes(b"\nAcDb3PointAngularDimension\n", b"\n" + wrong.encode() + b"\n"))
    c, h = mk("subclass-line-none", "Malformed: R2018 LINE without any 100 subclass markers", ["Q-0028"], malformed=True, tags=["subclass"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _drop(t, h["line"], 100)))
    c, h = mk("subclass-line-no-acdbline", "Malformed: R2018 LINE without 100 AcDbLine (AcDbEntity kept)", ["Q-0028"], malformed=True, tags=["subclass"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _drop(t, h["line"], 100, "AcDbLine")))
    c, h = mk("subclass-line-wrong-name", "Malformed: R2018 LINE with 100 AcDbLines (wrong subclass name)", ["Q-0028"], malformed=True, tags=["subclass"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _setv(t, h["line"], 100, "AcDbLines", 1)))

    # app-data placement (Q-0029, Q-0030)
    c, h = mk("appdata-custom-normal", "LINE with custom app-data 102 {MYAPP / 1 x / 102 } before 100 AcDbEntity (normal place)", ["Q-0029", "Q-0030"], tags=["app-data"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _after(t, h["line"], 5, [(102, "{MYAPP"), (1, "x"), (102, "}")])))
    c, h = mk("appdata-xdict-after-acdbentity", "Malformed: LINE with 102 {ACAD_XDICTIONARY placed after 100 AcDbEntity", ["Q-0029"], malformed=True, tags=["app-data", "xdict"])
    c.doc.entitydb[h["line"]].new_extension_dict()

    def move_xdict(t: Tags, h=h):
        s0, e0 = t.entity(h["line"])
        i = t.must(102, "{ACAD_XDICTIONARY", s0, e0)
        grp = t.remove(i, i + 3)
        j = t.must(100, "AcDbEntity", s0, e0 - 3)
        t.pairs[j + 1:j + 1] = grp

    c.byte_filters.append(tagfilter(move_xdict))
    c, h = mk("appdata-custom-in-acdbline", "Malformed: LINE with 102 {MYAPP / 1 x / 102 } inside AcDbLine", ["Q-0029"], malformed=True, tags=["app-data"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _after(t, h["line"], 20, [(102, "{MYAPP"), (1, "x"), (102, "}")])))
    c, h = mk("appdata-closer-named", "Malformed: LINE app-data closed with '102 MYAPP}' instead of '102 }'", ["Q-0030"], malformed=True, tags=["app-data"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _after(t, h["line"], 5, [(102, "{MYAPP"), (1, "x"), (102, "MYAPP}")])))
    c, h = mk("appdata-unbalanced", "Malformed: LINE app-data '102 {MYAPP' without closing 102", ["Q-0030"], malformed=True, tags=["app-data"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _after(t, h["line"], 5, [(102, "{MYAPP"), (1, "x")])))

    def xline(c, h, tags_):
        c.doc.appids.add("TRUEDXF")
        c.doc.entitydb[h["line"]].set_xdata("TRUEDXF", [(1000, "MARK")])
        c.byte_filters.append(replace_bytes(b"\n1000\nMARK\n", b"\n" + b"".join(b"%d\n%s\n" % (k, str(v).encode()) for k, v in tags_)))

    for code, val in ((1006, "x"), (1014, "1.0\n1024\n2.0\n1034\n3.0"), (1043, "1.5"), (1009, "y"), (1072, "5")):
        c, h = mk(f"xdata-code-{code}", f"LINE XDATA with group {code} next to 1000 (outside ezdxf's valid set)", ["Q-0031"], malformed=True,
                  tags=["XDATA"], params={"code": code})
        xline(c, h, [(1000, "a"), (code, val)])
    c, h = mk("xdata-brace-unbalanced", "Malformed: XDATA 1002 { without closing 1002 }", ["Q-0032"], malformed=True, tags=["XDATA"])
    xline(c, h, [(1002, "{"), (1000, "a")])
    c, h = mk("xdata-brace-value-x", "Malformed: XDATA 1002 with value 'x'", ["Q-0032"], malformed=True, tags=["XDATA"])
    xline(c, h, [(1002, "x"), (1000, "a")])
    c, h = mk("xdata-brace-extra-closer", "Malformed: XDATA 1002 } without opener", ["Q-0032"], malformed=True, tags=["XDATA"])
    xline(c, h, [(1000, "a"), (1002, "}")])
    c, h = mk("xdata-brace-nested", "XDATA with nested 1002 { { } } lists", ["Q-0032"], tags=["XDATA"])
    xline(c, h, [(1002, "{"), (1000, "a"), (1002, "{"), (1070, 3), (1002, "}"), (1002, "}")])
    c, h = mk("xdata-1000-before-1001", "Malformed: 1000 tag inside AcDbLine before any 1001 (then normal XDATA)", ["Q-0033"], malformed=True, tags=["XDATA"])
    c.doc.appids.add("TRUEDXF")
    c.doc.entitydb[h["line"]].set_xdata("TRUEDXF", [(1000, "normal")])
    c.byte_filters.append(tagfilter(lambda t, h=h: _after(t, h["line"], 31, [(1000, "stray")])))
    c, h = mk("xdata-same-appid-twice", "LINE with two XDATA groups for the same APPID TRUEDXF", ["Q-0033"], malformed=True, tags=["XDATA"])
    c.doc.appids.add("TRUEDXF")
    c.doc.entitydb[h["line"]].set_xdata("TRUEDXF", [(1000, "first")])
    c.byte_filters.append(tagfilter(lambda t, h=h: _end(t, h["line"], [(1001, "TRUEDXF"), (1000, "second")])))
    for v in ("R2000", "R2018"):
        c, h = mk(f"xdata-unregistered-appid-{v.lower()}", f"Malformed: LINE XDATA 1001 UNREG_APP not in the APPID table ({v})", ["Q-0034"],
                  ver=v, malformed=True, tags=["XDATA", "APPID"])
        c.byte_filters.append(tagfilter(lambda t, h=h: _end(t, h["line"], [(1001, "UNREG_APP"), (1000, "test")])))
    for kb in (15, 17, 20, 64):
        c, h = mk(f"xdata-size-{kb}kb", f"LINE with ~{kb} KB of XDATA (1000 strings + 1004 chunks); 16 KB limit?", ["Q-0035"], malformed=kb > 16,
                  tags=["XDATA", "size"], params={"kbytes": kb})
        c.doc.appids.add("TRUEDXF")
        n = kb * 1024 // 2 // 250
        tags_ = [(1000, ("%04d" % i) + "x" * 246) for i in range(n)] + [(1004, bytes(range(127)) * 1) for _ in range(kb * 1024 // 2 // 127)]
        c.doc.entitydb[h["line"]].set_xdata("TRUEDXF", tags_)

    # embedded object vs XDATA order (Q-0036)
    for n in ("ezdxf-order", "embedded-after-xdata"):
        c, h = mk(f"mtext-columns-xdata-{n}", f"MTEXT with static columns (101 Embedded Object) and XDATA; {n}", ["Q-0036"],
                  malformed=n != "ezdxf-order", tags=["MTEXT", "XDATA", "embedded-object"])
        m = c.msp.add_mtext_static_columns(["Column one text", "Column two text"], width=50, gutter_width=10, height=40,
                                           dxfattribs={"insert": (30, 110), "char_height": 5})
        c.doc.appids.add("TRUEDXF")
        m.set_xdata("TRUEDXF", [(1000, "xdata on mtext")])
        if n != "ezdxf-order":
            def swap(t: Tags, hh=m.dxf.handle):
                s0, e0 = t.entity(hh)
                i = t.must(101, None, s0, e0)
                j = t.must(1001, None, s0, e0)
                emb = t.pairs[i:j]
                xd = t.pairs[j:e0]
                t.pairs[i:e0] = xd + emb
            c.byte_filters.append(tagfilter(swap))
    c, h = mk("mtext-embedded-70-ne-71", "Malformed: MTEXT embedded object with 70 != 71 column count", [], malformed=True, tags=["MTEXT", "embedded-object"])
    m = c.msp.add_mtext_static_columns(["Column one", "Column two"], width=50, gutter_width=10, height=40, dxfattribs={"insert": (30, 110), "char_height": 5})
    c.byte_filters.append(tagfilter(lambda t, hh=m.dxf.handle: _setv(t, hh, 70, "3")))
    c, h = mk("mtext-group1-after-101", "Malformed: MTEXT whose group 1 text is written after the 101 embedded object", [],
              malformed=True, tags=["MTEXT", "embedded-object"])
    m = c.msp.add_mtext_static_columns(["Column one", "Column two"], width=50, gutter_width=10, height=40, dxfattribs={"insert": (30, 110), "char_height": 5})

    def g1_after(t: Tags, hh=m.dxf.handle):
        s0, e0 = t.entity(hh)
        i = t.must(1, None, s0, e0)
        tag = t.remove(i)
        t.pairs[e0 - 1:e0 - 1] = tag

    c.byte_filters.append(tagfilter(g1_after))

    # which APPIDs AutoCAD writes (Q-0037)
    c, h = mk("appids-written", "Paperspace VIEWPORT, DIMENSION with DIMSTYLE override, MTEXT with background mask: which XDATA does DXFOUT write", ["Q-0037", "Q-0101"],
              tags=["XDATA", "VIEWPORT", "DIMENSION", "MTEXT"])
    dim = c.msp.add_linear_dim(base=(100, 25), p1=(40, 18), p2=(160, 18), override={"dimclrd": 1, "dimtxt": 4})
    dim.render()
    m = c.msp.add_mtext("MASKED", dxfattribs={"insert": (70, 100), "char_height": 8})
    m.set_bg_color(2, scale=1.5)
    lay = c.doc.layouts.get("Layout1")
    lay.add_viewport(center=(150, 100), size=(200, 150), view_center_point=(100, 75), view_height=150)


# --------------------------------------------------------------------------------------------
# handles (Q-0044..Q-0046, Q-0072, Q-0074)


def _handles(s, mk) -> None:
    for v in ("R2000", "R2018"):
        c, h = mk(f"dup-handle-lines-{v.lower()}", f"Malformed: two LINEs with the same handle, referenced by a GROUP and SORTENTSTABLE ({v})", ["Q-0044"], ver=v,
                  malformed=True, tags=["handles", "duplicate"])
        grp = c.doc.groups.new("G1")
        grp.extend([c.doc.entitydb[h["line"]]])
        c.msp.set_redraw_order([(h["line2"], "FFF0"), (h["line"], "FFF1")]) if v == "R2018" else None
        c.byte_filters.append(tagfilter(lambda t, h=h: _setv(t, h["line2"], 5, h["line"])))
    c, h = mk("dup-handle-group-layer", "Malformed: GROUP object whose handle equals a LAYER record handle (AC1018)", ["Q-0044"], ver="R2004",
              malformed=True, tags=["handles", "duplicate"])
    grp = c.doc.groups.new("G1")
    grp.extend([c.doc.entitydb[h["line"]]])
    layer_handle = c.doc.layers.get("0").dxf.handle

    def group_as_layer(t: Tags, gh=grp.dxf.handle, lh=layer_handle):
        s0, e0 = t.entity(gh)
        t.set(t.must(5, gh, s0, e0), lh)
        for i in range(len(t)):
            if t.code(i) in (330, 340, 350, 360) and t.value(i) == gh.encode():
                t.set(i, lh)

    c.byte_filters.append(tagfilter(group_as_layer))

    for n, new in (("lowercase", "a0f"), ("16-digit", "FFFFFFFFFFFFFFF0"), ("leading-zeros", "0000A0F"), ("lowercase-group-ref", "a10")):
        c, h = mk(f"handle-{n}", f"LINE handle written as {new!r} (group/refs matching); $HANDSEED above it", ["Q-0045"], ver="R2000",
                  malformed=True, tags=["handles"], params={"handle": new})
        grp = c.doc.groups.new("G1")
        grp.extend([c.doc.entitydb[h["line"]]])

        def rename(t: Tags, h=h, new=new):
            old = h["line"].encode()
            for i in range(len(t)):
                if t.code(i) in (5, 330, 340, 350, 360) and t.value(i) == old:
                    t.set(i, new)
            if new != "FFFFFFFFFFFFFFF0":
                t.set_header("$HANDSEED", (5, "B00"))
        c.byte_filters.append(tagfilter(rename))
    c, h = mk("handle-zero", "Malformed: LINE with handle 5 = '0' (the null handle)", ["Q-0046"], ver="R2000", malformed=True, tags=["handles"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _setv(t, h["line"], 5, "0")))
    c, h = mk("handle-missing-r2018", "Malformed: R2018 LINE without group 5 handle", ["Q-0046"], malformed=True, tags=["handles"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _drop(t, h["line"], 5)))
    c, h = mk("handle-non-hex", "Malformed: LINE handle 'XYZ' (not hex)", ["Q-0045"], ver="R2000", malformed=True, tags=["handles"])
    c.byte_filters.append(tagfilter(lambda t, h=h: _setv(t, h["line"], 5, "XYZ")))

    c, h = mk("r2000-no-handseed", "Malformed: AC1015 header without $HANDSEED", ["Q-0072"], ver="R2000", malformed=True, tags=["handles", "header"])
    c.byte_filters.append(tagfilter(lambda t: t.del_header("$HANDSEED")))
    c, h = mk("r2000-no-appid-acad", "Malformed: AC1015 APPID table without the ACAD record", ["Q-0072"], ver="R2000", malformed=True, tags=["APPID"])

    def no_acad(t: Tags):
        a, b = t.table("APPID")
        i = t.must(2, "ACAD", a + 2, b)
        st = i
        while t.code(st) != 0:
            st -= 1
        t.remove(st, t.next0(st))

    c.byte_filters.append(tagfilter(no_acad))

    for n in ("10", "max", "max-plus-1", "zero", "huge"):
        c, h = mk(f"handseed-{n}", f"$HANDSEED = {n} relative to the largest handle (AC1015)", [], ver="R2000",
                  malformed=n in ("10", "max", "zero"), tags=["handles", "HANDSEED"], params={"handseed": n})

        def seed(t: Tags, n=n):
            mx = 0
            for i in range(t.section("HEADER")[1], len(t)):
                if t.code(i) in (5, 105):
                    try:
                        mx = max(mx, int(t.value(i), 16))
                    except ValueError:
                        pass
            val = {"10": 0x10, "max": mx, "max-plus-1": mx + 1, "zero": 0, "huge": 0xFFFFFFF}[n]
            t.set_header("$HANDSEED", (5, f"{val:X}"))
        c.byte_filters.append(tagfilter(seed))


# --------------------------------------------------------------------------------------------
# encodings (Q-0052..Q-0065, Q-0276)


def _encoding(s, mk) -> None:
    spellings = [
        ("ansi-1251", "ANSI_1251", "cp1251", "Привет мир"),
        ("lower-ansi-1251", "ansi_1251", "cp1251", "Привет мир"),
        ("ansi1251", "ANSI1251", "cp1251", "Привет мир"),
        ("cp1251", "CP1251", "cp1251", "Привет мир"),
        ("dos866", "dos866", "cp866", "Привет мир"),
        ("dos850", "DOS850", "cp850", "Grüße ÄÖÜ ñ"),
        ("kcs5601", "kcs5601", "cp949", "한글 텍스트"),
        ("gb2312", "GB2312", "gbk", "中文字体"),
        ("8859-1", "8859_1", "latin-1", "Grüße ÄÖÜ ñ"),
        ("ansi-1252", "ANSI_1252", "cp1252", "Grüße ÄÖÜ € ñ"),
        ("empty", "", "cp1252", "Grüße ÄÖÜ € ñ"),
        ("missing", None, "cp1252", "Grüße ÄÖÜ € ñ"),
        ("ansi-1200", "ANSI_1200", "cp1252", "Grüße ÄÖÜ € ñ"),
        ("utf-8", "UTF-8", "utf-8", "Grüße Привет"),
    ]
    for n, cp, enc, text in spellings:
        qs = ["Q-0053"] if n == "ansi-1200" else ["Q-0052"]
        c, h = mk(f"codepage-{n}", f"AC1018 $DWGCODEPAGE {cp!r}; TEXT and layer name bytes in {enc}: {text}", qs, ver="R2004",
                  malformed=n not in ("ansi-1251", "ansi-1252"), tags=["encoding", "DWGCODEPAGE"], params={"dwgcodepage": cp, "bytes": enc})
        c.layer("ENCLAYER", color=7)
        c.msp.add_text("ENCPLACEHOLDER", height=12, dxfattribs={"insert": (20, 60), "layer": "ENCLAYER"})

        def enc_f(t: Tags, cp=cp, enc=enc, text=text):
            if cp is None:
                t.del_header("$DWGCODEPAGE")
            else:
                t.set_header("$DWGCODEPAGE", (3, cp))
            t.replace_values("ENCPLACEHOLDER", text.encode(enc), code=1)
            t.replace_values("ENCLAYER", ("L-" + text.split()[0]).encode(enc))
        c.byte_filters.append(tagfilter(enc_f))

    for v in ("R2013", "R2018"):
        for cp in ("ANSI_1251", "ANSI_932", "ANSI_936"):
            c, h = mk(f"utf8-{v.lower()}-{cp.lower().replace('_', '-')}", f"{v} (UTF-8) file with $DWGCODEPAGE {cp}: TEXT and layer 'Слой-中' in UTF-8",
                      ["Q-0055"], ver=v, tags=["encoding", "DWGCODEPAGE"], params={"dwgcodepage": cp})
            c.layer("Слой-中", color=7)
            c.msp.add_text("Привет Grüße 中文", height=10, dxfattribs={"insert": (20, 60), "layer": "Слой-中"})
            c.byte_filters.append(tagfilter(lambda t, cp=cp: t.set_header("$DWGCODEPAGE", (3, cp))))

    # cp932 / cp936 table differences (Microsoft vs WHATWG)
    divergent = {
        "ANSI_932": bytes.fromhex("815F 8160 8161 817C 8191 8192 81CA 8740 8754 878A 879A ED40 FA40 FA55".replace(" ", "")),
        "ANSI_936": bytes.fromhex("80 A1A4 A1AA A843 A1E9 A1EA A3A4 A844".replace(" ", "")),
    }
    for cp, raw in divergent.items():
        enc = {"ANSI_932": "cp932", "ANSI_936": "gbk"}[cp]
        c, h = mk(f"divergent-{cp.lower().replace('_', '-')}", f"AC1018 {cp} TEXT with byte sequences where Microsoft and WHATWG tables differ (DXFOUT reveals the mapping)",
                  ["Q-0057"], ver="R2004", header={"$DWGCODEPAGE": cp}, malformed=True, tags=["encoding", "DBCS"], params={"hex": raw.hex()})
        c.msp.add_text("DIVPLACEHOLDER", height=8, dxfattribs={"insert": (15, 60)})
        c.byte_filters.append(replace_bytes(b"\nDIVPLACEHOLDER\n", b"\n" + raw + b"\n"))

    natives = [("ANSI_932", "cp932", "日本語テキスト"), ("ANSI_936", "gbk", "中文文字"), ("ANSI_1256", "cp1256", "مرحبا بالعالم"),
               ("ANSI_949", "cp949", "한국어"), ("ANSI_950", "cp950", "中文繁體")]
    for cp, enc, text in natives:
        c, h = mk(f"native-{cp.lower().replace('_', '-')}", f"AC1018 {cp} TEXT with native {enc} bytes: {text}", ["Q-0058"], ver="R2004",
                  header={"$DWGCODEPAGE": cp}, malformed=True, tags=["encoding", "DBCS"])
        c.msp.add_text("NATPLACEHOLDER", height=12, dxfattribs={"insert": (20, 60)})
        c.byte_filters.append(replace_bytes(b"\nNATPLACEHOLDER\n", b"\n" + text.encode(enc) + b"\n"))
    # MTEXT chunks splitting \U+ escapes and DBCS characters
    for n, split in (("u-escape-3-4", 3), ("u-escape-1-6", 1), ("u-escape-7-0", 7)):
        c, h = mk(f"mtext-split-{n}", f"R2004 MTEXT > 250 chars whose 250-char chunk boundary splits a \\U+00E4 escape after {split} chars", ["Q-0058"],
                  ver="R2004", tags=["encoding", "MTEXT", "chunks"], params={"split_after": split})
        c.msp.add_mtext("MTPLACEHOLDER", dxfattribs={"insert": (15, 120), "char_height": 3, "width": 170})
        esc = "\\U+00E4"
        body = ("word " * 60)[: 250 - split] + esc + " end " + "tail " * 20

        def mt(t: Tags, body=body):
            i = t.must(1, "MTPLACEHOLDER")
            parts = [body[k:k + 250] for k in range(0, len(body), 250)]
            t.remove(i)
            t.insert(i, [(3, p) for p in parts[:-1]] + [(1, parts[-1])])
        c.byte_filters.append(tagfilter(mt))
    c, h = mk("mtext-split-dbcs", "R2004 ANSI_932 MTEXT whose 3-chunk ends with a Shift-JIS lead byte and the 1-chunk starts with its trail byte", ["Q-0058"],
              ver="R2004", header={"$DWGCODEPAGE": "ANSI_932"}, malformed=True, tags=["encoding", "MTEXT", "DBCS"])
    c.msp.add_mtext("MTPLACEHOLDER", dxfattribs={"insert": (15, 120), "char_height": 3, "width": 170})

    def mt_dbcs(t: Tags):
        i = t.must(1, "MTPLACEHOLDER")
        first = ("abcd " * 60).encode()[:249] + "表".encode("cp932")[:1]
        second = "表".encode("cp932")[1:] + " end".encode()
        t.remove(i)
        t.insert(i, [(3, first), (1, second)])

    c.byte_filters.append(tagfilter(mt_dbcs))

    # caret escapes (Q-0061)
    c, h = mk("caret-text", "TEXTs 'A^JB', 'C^ D', 'E<TAB>F', 'G^MH', 'I^@J', lowercase 'K^jL' (caret decoding on OPEN)", ["Q-0061"], tags=["caret", "TEXT"])
    vals = [b"A^JB", b"C^ D", b"E\tF", b"G^MH", b"I^@J", b"K^jL"]
    for i, v in enumerate(vals):
        c.msp.add_text(f"CARET{i}", height=10, dxfattribs={"insert": (30 + (i % 2) * 80, 100 - (i // 2) * 30)})
        c.byte_filters.append(replace_bytes(f"\nCARET{i}\n".encode(), b"\n" + v + b"\n"))
    c, h = mk("caret-names", "LAYER 'A^IB' and BLOCK 'B^ C' (caret escapes in table/block names) with entities", ["Q-0061"], malformed=True, tags=["caret", "LAYER", "BLOCK"])
    c.layer("CARETLAYER", color=1)
    blk = c.doc.blocks.new("CARETBLOCK")
    blk.add_circle((0, 0), 10)
    c.msp.add_blockref("CARETBLOCK", (60, 60), dxfattribs={"layer": "CARETLAYER"})
    c.msp.add_line((100, 60), (160, 60), dxfattribs={"layer": "CARETLAYER"})
    c.byte_filters.append(replace_bytes(b"\nCARETLAYER\n", b"\nA^IB\n"))
    c.byte_filters.append(replace_bytes(b"\nCARETBLOCK\n", b"\nB^ C\n"))
    for v in ("R2004", "R2018"):
        c, h = mk(f"unicode-escape-names-{v.lower()}", f"LAYER 'Gr\\U+00FCn', BLOCK and STYLE '\\U+5899' names with entities ({v})", ["Q-0065"], ver=v,
                  tags=["encoding", "\\U+", "LAYER"], style_table="acad.ctb")
        c.layer("GRUENPH", color=3)
        c.style("STYLEPH", font=TTF_FONTS["sans"])
        blk = c.doc.blocks.new("BLOCKPH")
        blk.add_circle((0, 0), 10)
        c.msp.add_blockref("BLOCKPH", (60, 60), dxfattribs={"layer": "GRUENPH"})
        c.msp.add_text("Styled", height=8, dxfattribs={"insert": (100, 60), "style": "STYLEPH", "layer": "GRUENPH"})
        c.byte_filters.append(replace_bytes(b"\nGRUENPH\n", b"\nGr\\U+00FCn\n"))
        c.byte_filters.append(replace_bytes(b"\nSTYLEPH\n", b"\nS\\U+5899\n"))
        c.byte_filters.append(replace_bytes(b"\nBLOCKPH\n", b"\nB\\U+5899\n"))
    for v in ("R2004", "R2018"):
        c, h = mk(f"nonascii-casefold-{v.lower()}", f"Layers 'Ä' (red) and 'Wand' (green); LINEs on 'ä', 'WAND', '\\U+00E4', 'Ä' ({v})", ["Q-0276"], ver=v,
                  malformed=True, tags=["encoding", "LAYER", "case"], style_table="acad.ctb")
        c.layer("Ä", color=1)
        c.layer("Wand", color=3)
        for i, ln in enumerate(["ä", "WAND", "UESCPH", "Ä"]):
            c.msp.add_line((30, 30 + i * 25), (170, 30 + i * 25), dxfattribs={"layer": "Ä" if ln in ("ä", "UESCPH") else ("Wand" if ln == "WAND" else ln)})
        enc = "cp1252" if v == "R2004" else "utf-8"

        def cf(t: Tags, h=h, enc=enc):
            es, ee = t.section("ENTITIES")
            ls = t.find_all(0, "LINE", es, ee)[-4:]
            names = ["ä".encode(enc), b"WAND", b"\\U+00E4", "Ä".encode(enc)]
            for li, nm in zip(ls, names):
                t.set(t.must(8, None, li), nm)
        c.byte_filters.append(tagfilter(cf))


# --------------------------------------------------------------------------------------------
# header (Q-0073..Q-0082, Q-0106)


def _header(s, mk) -> None:
    for v in ("R2000", "R2004", "R2010", "R2013", "R2018"):
        for code in (70, 90):
            c, h = mk(f"acadmaintver-{code}-{v.lower()}", f"$ACADMAINTVER written with group {code} in a {v} file", ["Q-0073"], ver=v,
                      malformed=(code == 90) != (v == "R2018"), tags=["header", "ACADMAINTVER"], params={"code": code})
            c.byte_filters.append(tagfilter(lambda t, code=code: t.set_header("$ACADMAINTVER", (code, "4"))))
    c, h = mk("r12-pucs-zero", "Malformed: R12 header $PUCSXDIR = $PUCSYDIR = (0,0,0)", ["Q-0076"], ver="R12", malformed=True, tags=["header"])

    def pucs(t: Tags):
        for nm in ("$PUCSXDIR", "$PUCSYDIR"):
            t.set_header(nm, (10, "0.0"), (20, "0.0"), (30, "0.0"))
    c.byte_filters.append(tagfilter(pucs))
    for n in ("after-lastsavedby", "before-lastsavedby"):
        c, h = mk(f"custom-props-{n}", f"R2004 header $CUSTOMPROPERTYTAG/$CUSTOMPROPERTY {n.replace('-', ' ')}", ["Q-0077"], ver="R2004",
                  malformed=n.startswith("before"), tags=["header"])

        def cp(t: Tags, n=n):
            i, j = t.header_var("$LASTSAVEDBY")
            tags_ = [(9, "$CUSTOMPROPERTYTAG"), (1, "truedxf"), (9, "$CUSTOMPROPERTY"), (1, "fixture value")]
            t.insert(j if n.startswith("after") else i, tags_)
        c.byte_filters.append(tagfilter(cp))
    for v in ("R2000", "R2018"):
        c, h = mk(f"header-minimal-{v.lower()}", f"HEADER with only $ACADVER and $HANDSEED; dashed LINE, POINT, TEXT (default values on open) ({v})",
                  ["Q-0078"], ver=v, malformed=True, tags=["header", "defaults"])
        c.msp.add_line((20, 60), (180, 60), dxfattribs={"linetype": c.linetype("DASHED")})
        c.msp.add_point((100, 40))
        c.msp.add_text("DEFAULTS", height=5, dxfattribs={"insert": (20, 45)})

        def minimal(t: Tags):
            s0, e0 = t.section("HEADER")
            keep = []
            for nm in ("$ACADVER", "$HANDSEED"):
                i, j = t.header_var(nm)
                keep += t.pairs[i:j]
            t.pairs[s0 + 2:e0] = keep
        c.byte_filters.append(tagfilter(minimal))
    c, h = mk("header-no-header-section", "R2018 file without HEADER section (defaults for everything)", ["Q-0078", "Q-0071"], malformed=True, tags=["header", "defaults"])
    c.byte_filters.append(tagfilter(lambda t: t.remove(t.section("HEADER")[0], t.section("HEADER")[1] + 1)))
    c, h = mk("header-2d-points", "AC1015 header $EXTMIN / $EXTMAX / $INSBASE written with 10/20 only (no 30)", ["Q-0079"], ver="R2000", malformed=True, tags=["header"])

    def pts2d(t: Tags):
        for nm in ("$EXTMIN", "$EXTMAX", "$INSBASE"):
            i, j = t.header_var(nm)
            for k in range(j - 1, i, -1):
                if t.code(k) == 30:
                    t.remove(k)
    c.byte_filters.append(tagfilter(pts2d))
    for n, code, val, ver in (("290-1-r2018", 290, "1", "R2018"), ("280-1-r2018", 280, "1", "R2018"), ("280-2-r2018", 280, "2", "R2018"),
                              ("290-1-r2004", 290, "1", "R2004"), ("280-2-r2004", 280, "2", "R2004"), ("280-1-r2004", 280, "1", "R2004")):
        c, h = mk(f"xclipframe-{n}", f"$XCLIPFRAME written as group {code} value {val} ({ver}) with an XCLIPped INSERT", ["Q-0080"], ver=ver,
                  malformed=n in ("290-1-r2018", "280-2-r2004", "280-1-r2004"), tags=["header", "XCLIP"])
        _xclip_insert(c)
        c.byte_filters.append(tagfilter(lambda t, code=code, val=val: t.set_header("$XCLIPFRAME", (code, val))))
    c, h = mk("hidetext-290", "AC1032 header $HIDETEXT and $INTERSECTIONDISPLAY written with group 290 (spec) instead of 280", ["Q-0081"], malformed=True, tags=["header"])

    def ht(t: Tags):
        t.set_header("$HIDETEXT", (290, "1"))
        t.set_header("$INTERSECTIONDISPLAY", (290, "0"))
    c.byte_filters.append(tagfilter(ht))
    c, h = mk("dimfac-name", "AC1015 header with '$DIMFAC' 40 = 0.5 (spec name) instead of $DIMTFAC", ["Q-0082"], ver="R2000", malformed=True, tags=["header", "DIMSTYLE"])

    def dimfac(t: Tags):
        i, j = t.header_var("$DIMTFAC")
        t.remove(i, j)
        t.insert(i, [(9, "$DIMFAC"), (40, "0.5")])
    c.byte_filters.append(tagfilter(dimfac))
    c, h = mk("header-unknown-var", "Header with an unknown variable $TRUEDXFTEST (warning only?)", [], malformed=True, tags=["header"])
    c.byte_filters.append(tagfilter(lambda t: t.set_header("$TRUEDXFTEST", (70, "1"))))
    c, h = mk("header-no-tilemode", "R2018 header without $TILEMODE (opens in paper space?)", [], malformed=True, tags=["header"])
    c.byte_filters.append(tagfilter(lambda t: t.del_header("$TILEMODE")))

    # stale extents (Q-0106)
    for n, (mn, mx) in (("too-large", ((-1000, -1000), (1000, 1000))), ("too-small", ((90, 70), (110, 80))), ("inverted", ((1e20, 1e20), (-1e20, -1e20)))):
        c, h = mk(f"stale-extents-{n}", f"Stale $EXTMIN/$EXTMAX {mn}..{mx} (and Model LAYOUT 14/15); Extents plot and DXFOUT", ["Q-0106"],
                  tags=["header", "extents"], outputs=["png", "pdf", "dxf"])
        c.keep_header_extents = True
        c.plot_extents()

        def ext(t: Tags, mn=mn, mx=mx):
            t.set_header("$EXTMIN", (10, repr(float(mn[0]))), (20, repr(float(mn[1]))), (30, "0.0"))
            t.set_header("$EXTMAX", (10, repr(float(mx[0]))), (20, repr(float(mx[1]))), (30, "0.0"))
        c.byte_filters.append(tagfilter(ext))


def _xclip_insert(c):
    from ezdxf.xclip import XClip
    blk = c.doc.blocks.new("CLIPPED")
    for i in range(5):
        blk.add_circle((0, 0), 8 + i * 8)
    ins = c.msp.add_blockref("CLIPPED", (100, 75))
    XClip(ins).set_block_clipping_path([(-30, -25), (30, -25), (30, 25), (-30, 25)])
    return ins


# --------------------------------------------------------------------------------------------
# tables (Q-0084..Q-0090, Q-0275, Q-0296, Q-0297, Q-0606..Q-0608)


def _tables(s, mk) -> None:
    c, h = mk("layer-name-spaces-case", "LAYERs 'A' red, ' A' green, 'A ' blue, 'Walls' yellow; LINEs on A, ' A', 'A ', Walls, WALLS, a, 'plate '", ["Q-0084"],
              malformed=True, tags=["LAYER", "names"], style_table="acad.ctb")
    for nm, col in (("A", 1), ("SPA", 3), ("ASP", 5), ("Walls", 2)):
        c.layer(nm, color=col)
    refs = ["A", "SPA", "ASP", "Walls", "WALLS", "a", "PLATEPH"]
    for i, nm in enumerate(refs):
        c.msp.add_line((25, 20 + i * 16), (175, 20 + i * 16), dxfattribs={"layer": nm if nm not in ("WALLS", "a", "PLATEPH") else "Walls"})

    def sp(t: Tags):
        t.replace_values("SPA", " A")
        t.replace_values("ASP", "A ")
        es, ee = t.section("ENTITIES")
        ls = t.find_all(0, "LINE", es, ee)[-3:]
        for li, nm in zip(ls, [b"WALLS", b"a", b"plate "]):
            t.set(t.must(8, None, li), nm)
    c.byte_filters.append(tagfilter(sp))
    c, h = mk("layout-name-model-upper", "Model space LAYOUT object named 'MODEL' (ODA style) instead of 'Model'", ["Q-0084"], malformed=True, tags=["LAYOUT", "names"])
    c.byte_filters.append(tagfilter(lambda t: t.replace_values("Model", "MODEL", code=1)))
    for n, keep0 in (("no-layer-0", False), ("with-layer-0", True)):
        c, h = mk(f"layer-duplicate-records-{n}", f"LAYER table with two 'A' records (red, blue) and 'a' (magenta){'' if keep0 else ', no layer 0'}; LINEs on A",
                  ["Q-0085"], malformed=True, tags=["LAYER", "duplicate"], style_table="acad.ctb", label="")
        c.layer("A", color=1)
        c.layer("DUPA", color=5)
        c.layer("LOWA", color=6)
        for e in list(c.msp):
            e.dxf.layer = "A"
        c.msp.add_text(c.name, height=6, dxfattribs={"insert": (15, 126), "layer": "A"})

        def dup(t: Tags, keep0=keep0):
            t.replace_values("DUPA", "A", code=2)
            t.replace_values("LOWA", "a", code=2)
            if not keep0:
                a, b = t.table("LAYER")
                i = t.must(2, "0", a + 2, b)
                st = i
                while t.code(st) != 0:
                    st -= 1
                t.remove(st, t.next0(st))
        c.byte_filters.append(tagfilter(dup))

    for tbl, n, fn in (("LAYER", "minus1", lambda k: k - 1), ("LAYER", "plus1", lambda k: k + 1), ("LAYER", "negative", lambda k: -5), ("LAYER", "zero", lambda k: 0),
                       ("VPORT", "plus1", lambda k: k + 1), ("VPORT", "zero", lambda k: 0), ("BLOCK_RECORD", "minus1", lambda k: k - 1),
                       ("BLOCK_RECORD", "plus1", lambda k: k + 1), ("LTYPE", "wrapped", lambda k: -24493)):
        c, h = mk(f"table-count-{tbl.lower().replace('_', '-')}-{n}", f"{tbl} table head 70 entry count = {n} (AC1018)", [], ver="R2004",
                  malformed=True, tags=["table-count"], params={"table": tbl, "count": n})

        def cnt(t: Tags, tbl=tbl, fn=fn):
            a, b = t.table(tbl)
            i = t.must(70, None, a, b)
            t.set(i, str(fn(int(t.value(i)))))
        c.byte_filters.append(tagfilter(cnt))

    c, h = mk("no-defpoints-layer", "No Defpoints layer in the LAYER table (no dimensions)", [], ver="R2004", tags=["LAYER", "Defpoints"])
    c.byte_filters.append(tagfilter(_remove_layer("Defpoints")))
    c, h = mk("no-defpoints-layer-dimension", "No Defpoints layer, but a linear DIMENSION whose *D block points are on Defpoints", [], ver="R2004",
              malformed=True, tags=["LAYER", "Defpoints", "DIMENSION"])
    c.msp.add_linear_dim(base=(100, 25), p1=(40, 18), p2=(160, 18)).render()
    c.byte_filters.append(tagfilter(_remove_layer("Defpoints")))
    for n, plot in (("plot-1", "1"), ("no-290", None)):
        c, h = mk(f"defpoints-{n}", f"Defpoints layer written with {'290 1 (plottable)' if plot else 'no 290 flag'} (invalid plot flag?)", [],
                  ver="R2004", malformed=True, tags=["LAYER", "Defpoints"])
        c.msp.add_line((20, 60), (180, 60), dxfattribs={"layer": "Defpoints"})

        def dp(t: Tags, plot=plot):
            a, b = t.table("LAYER")
            i = t.must(2, "Defpoints", a, b)
            j = t.must(290, None, i, t.next0(i))
            if plot:
                t.set(j, plot)
            else:
                t.remove(j)
        c.byte_filters.append(tagfilter(dp))
    c, h = mk("layer-name-slash", "Layer 'A/B' holding one LINE", [], ver="R2004", malformed=True, tags=["LAYER", "names"])
    c.layer("SLASHPH", color=7)
    c.msp.add_line((20, 60), (180, 60), dxfattribs={"layer": "SLASHPH"})
    c.byte_filters.append(replace_bytes(b"\nSLASHPH\n", b"\nA/B\n"))
    c, h = mk("layer-name-bar-not-dependent", "Malformed: layer 'X|L1' (vertical bar) without the xref-dependent flag", [], malformed=True, tags=["LAYER", "names"])
    c.layer("XBARL1", color=7)
    c.msp.add_line((20, 60), (180, 60), dxfattribs={"layer": "XBARL1"})
    c.byte_filters.append(replace_bytes(b"\nXBARL1\n", b"\nX|L1\n"))
    c, h = mk("layer-name-empty", "Malformed: LAYER record with an empty name", [], malformed=True, tags=["LAYER", "names"])
    c.layer("EMPTYPH", color=7)
    c.byte_filters.append(tagfilter(lambda t: t.replace_values("EMPTYPH", "", code=2)))
    for v in ("R12", "R2000", "R2007", "R2018"):
        c, h = mk(f"block-name-space-{v.lower()}", f"BLOCK named 'Shape 0_M' (contains a space) and one INSERT ({v})", ["Q-0089"], ver=v,
                  malformed=v == "R12", tags=["BLOCK", "names"])
        blk = c.doc.blocks.new("Shape 0_M")
        blk.add_polyline2d([(-10, -10), (10, -10), (10, 10), (-10, 10)], close=True)
        c.msp.add_blockref("Shape 0_M", (100, 75), dxfattribs={"xscale": 2, "yscale": 2})
    for v in ("R2000", "R2018"):
        c, h = mk(f"ltype-text-gas-line-{v.lower()}", f"Complex linetype GAS_LINE with embedded text (STANDARD style): which group holds the text on DXFOUT ({v})",
                  ["Q-0090"], ver=v, tags=["LTYPE", "complex-linetype"])
        c.doc.linetypes.add("GAS_LINE", pattern='A,12.7,-5.08,["GAS",STANDARD,S=2.54,U=0.0,X=-2.54,Y=-1.27],-6.35', length=24.13,
                            description="Gas line ----GAS----GAS----GAS----")
        c.msp.add_line((20, 60), (180, 60), dxfattribs={"linetype": "GAS_LINE", "ltscale": 1.0})
        c.msp.add_lwpolyline([(20, 80), (100, 110), (180, 80)], dxfattribs={"linetype": "GAS_LINE"})
    for v in ("R12", "R2018"):
        c, h = mk(f"undefined-layer-{v.lower()}", f"LINE with BYLAYER properties on layer 'GHOST' missing from the LAYER table ({v})", ["Q-0275"], ver=v,
                  malformed=True, tags=["LAYER", "undefined"], style_table="acad.ctb")
        c.layer("GHOST", color=1, linetype="DASHED", lineweight=100)
        c.msp.add_line((20, 60), (180, 60), dxfattribs={"layer": "GHOST"})
        c.byte_filters.append(tagfilter(_remove_layer("GHOST")))
    for v in ("R12", "R2000"):
        c, h = mk(f"undefined-linetype-entity-{v.lower()}", f"LINE with 6 = NOSUCH (no LTYPE record) on a CONTINUOUS layer ({v})", ["Q-0296"], ver=v,
                  malformed=True, tags=["LTYPE", "undefined"])
        c.msp.add_line((20, 60), (180, 60), dxfattribs={"linetype": c.linetype("DASHED")})
        c.byte_filters.append(tagfilter(lambda t: [t.set(i, "NOSUCH") for i in t.find_all(6, "DASHED", t.section("ENTITIES")[0])]))
    c, h = mk("linetype-lowercase-ref", "LINE with 6 = 'dashed' referencing the existing LTYPE 'DASHED' (case-insensitive lookup?)", ["Q-0296"], ver="R2000",
              tags=["LTYPE", "case"])
    c.msp.add_line((20, 60), (180, 60), dxfattribs={"linetype": c.linetype("DASHED")})
    c.byte_filters.append(tagfilter(lambda t: [t.set(i, "dashed") for i in t.find_all(6, "DASHED", t.section("ENTITIES")[0])]))
    for v in ("R12", "R2018"):
        c, h = mk(f"undefined-linetype-layer-{v.lower()}", f"LAYER with 6 = NOSUCH_LT (undefined linetype), LINE BYLAYER on it ({v})",
                  ["Q-0297"], ver=v, malformed=True, tags=["LTYPE", "LAYER", "undefined"])
        c.layer("BADLT", color=7, linetype="DASHED")
        c.msp.add_line((20, 60), (180, 60), dxfattribs={"layer": "BADLT"})

        def badlt(t: Tags):
            a, b = t.table("LAYER")
            i = t.must(2, "BADLT", a, b)
            t.set(t.must(6, None, i), "NOSUCH_LT")
        c.byte_filters.append(tagfilter(badlt))
    c, h = mk("linetype-named-none", "LAYER whose linetype is named 'None' (LTYPE record 'None' defined as continuous)", [],
              malformed=True, tags=["LTYPE"])
    c.doc.linetypes.add("NONEPH", pattern=[0.0])
    c.layer("NL", color=7, linetype="NONEPH")
    c.msp.add_line((20, 60), (180, 60), dxfattribs={"layer": "NL"})
    c.byte_filters.append(tagfilter(lambda t: t.replace_values("NONEPH", "None")))

    # BLOCK_RECORD / *Model_Space / *Paper_Space (Q-0606)
    def drop_table(name):
        def f(t: Tags):
            a, b = t.table(name)
            t.remove(a, b + 1)
        return f

    c, h = mk("r2000-no-block-record-table", "Malformed: AC1015 without the BLOCK_RECORD table", ["Q-0606"], ver="R2000", malformed=True, tags=["BLOCK_RECORD", "structure"])
    c.byte_filters.append(tagfilter(drop_table("BLOCK_RECORD")))
    c, h = mk("r2000-no-model-space-block", "Malformed: AC1015 without the *Model_Space BLOCK/ENDBLK (record kept)", ["Q-0606"], ver="R2000", malformed=True, tags=["BLOCK", "structure"])
    c.byte_filters.append(tagfilter(_remove_block("*Model_Space")))
    c, h = mk("r2000-no-paper-space-block", "Malformed: AC1015 without the *Paper_Space BLOCK/ENDBLK (record kept)", ["Q-0606"], ver="R2000",
              malformed=True, tags=["BLOCK", "structure"])
    c.byte_filters.append(tagfilter(_remove_block("*Paper_Space")))
    c, h = mk("r2018-model-space-only", "Malformed: R2018 with only *Model_Space (no *Paper_Space record, block and LAYOUT)", ["Q-0606"],
              malformed=True, tags=["BLOCK", "LAYOUT", "structure"])

    def model_only(t: Tags):
        _remove_block("*Paper_Space")(t)
        a, b = t.table("BLOCK_RECORD")
        i = t.must(2, "*Paper_Space", a, b)
        st = i
        while t.code(st) != 0:
            st -= 1
        ph = t.svalue(t.must(5, None, st))
        t.remove(st, t.next0(st))
        # LAYOUT object that owns *Paper_Space
        os_, oe = t.section("OBJECTS")
        for ls, le in t.entities("LAYOUT", os_, oe):
            if t.find(330, ph, ls, le) >= 0 or t.find(1, "Layout1", ls, le) >= 0:
                lh = t.svalue(t.must(5, None, ls))
                t.remove(ls, le)
                for i2 in reversed(range(len(t))):
                    if t.code(i2) == 350 and t.value(i2) == lh.encode() and t.code(i2 - 1) == 3:
                        t.remove(i2 - 1, i2 + 1)
                break
    c.byte_filters.append(tagfilter(model_only))
    c, h = mk("insert-missing-block", "Malformed: INSERT of block 'NOSUCHBLOCK' that is not defined", ["Q-0607"], malformed=True, tags=["INSERT", "BLOCK"])
    blk = c.doc.blocks.new("REALBLOCK")
    blk.add_circle((0, 0), 10)
    c.msp.add_blockref("REALBLOCK", (100, 75))
    c.byte_filters.append(tagfilter(lambda t: [t.set(i, "NOSUCHBLOCK") for i in t.find_all(2, "REALBLOCK", t.section("ENTITIES")[0])]))
    for n, second in (("case", "a"), ("exact", "A")):
        c, h = mk(f"block-duplicate-{n}", f"Two BLOCK definitions 'A' and {second!r} with different base points and content, one INSERT of 'A'", ["Q-0608"],
                  malformed=True, tags=["BLOCK", "duplicate"])
        b1 = c.doc.blocks.new("A", base_point=(0, 0))
        b1.add_circle((0, 0), 15)
        b2 = c.doc.blocks.new("SECONDBLK", base_point=(10, 10))
        b2.add_lwpolyline([(0, 0), (30, 0), (30, 30), (0, 30)], close=True)
        c.msp.add_blockref("A", (100, 75))
        c.byte_filters.append(tagfilter(lambda t, second=second: t.replace_values("SECONDBLK", second)))


def _remove_layer(name: str):
    def f(t: Tags):
        a, b = t.table("LAYER")
        i = t.must(2, name, a, b)
        st = i
        while t.code(st) != 0:
            st -= 1
        t.remove(st, t.next0(st))
    return f


def _remove_block(name: str):
    def f(t: Tags):
        a, b = t.section("BLOCKS")
        i = t.must(2, name, a, b)
        st = i
        while t.code(st) != 0:
            st -= 1
        end = t.must(0, "ENDBLK", st)
        t.remove(st, t.next0(end))
    return f


# --------------------------------------------------------------------------------------------
# objects (Q-0091..Q-0102, Q-0703, Q-0707)


def _objects(s, mk) -> None:
    c, h = mk("nod-not-first", "Named object dictionary moved to second position in OBJECTS (after a DICTIONARYVAR)", ["Q-0091"], ver="R2004",
              malformed=True, tags=["DICTIONARY", "OBJECTS"])

    def nod_second(t: Tags):
        a, b = _objects_first(t)
        nod = t.remove(a, b)
        s0, e0 = t.section("OBJECTS")
        j = t.next0(s0 + 2)
        t.pairs[j:j] = nod
    c.byte_filters.append(tagfilter(nod_second))
    c, h = mk("fieldlist-as-dictionary", "NOD key ACAD_FIELDLIST pointing at a plain DICTIONARY", [], ver="R2004", malformed=True, tags=["DICTIONARY"])
    c.byte_filters.append(tagfilter(lambda t: _nod_add(t, "ACAD_FIELDLIST", [(100, "AcDbDictionary"), (281, "1")], "DICTIONARY", "F000")))
    c, h = mk("dict-empty-material", "ACAD_MATERIAL dictionary emptied (MATERIAL objects and layer 347 refs removed)", [], ver="R2004",
              malformed=True, tags=["DICTIONARY", "MATERIAL"])
    c.byte_filters.append(tagfilter(_empty_material))
    c, h = mk("dict-empty-key", "Malformed: NOD entry with an empty group-3 key pointing at an XRECORD", [], ver="R2004", malformed=True, tags=["DICTIONARY"])
    c.byte_filters.append(tagfilter(lambda t: _nod_add(t, "", [(100, "AcDbXrecord"), (280, "1"), (1, "empty key")], "XRECORD", "F001")))
    c, h = mk("xrecord-written-twice", "Malformed: one XRECORD (same handle) emitted twice, owned by two dictionary entries", [], ver="R2004", malformed=True,
              tags=["DICTIONARY", "XRECORD", "duplicate"])

    def twice(t: Tags):
        _nod_add(t, "TRUEDXF_A", [(100, "AcDbXrecord"), (280, "1"), (1, "twice")], "XRECORD", "F002")
        a, b = _objects_first(t)
        t.insert(b - 0, [])
        i = t.must(3, "TRUEDXF_A", a, b)
        t.insert(i + 2, [(3, "TRUEDXF_B"), (350, "F002")])
        st, en = t.entity("F002")
        t.pairs[en:en] = [list(p) for p in t.pairs[st:en]]
    c.byte_filters.append(tagfilter(twice))
    c, h = mk("r2007-no-visualstyle-material", "AC1021 without ACAD_VISUALSTYLE and ACAD_MATERIAL dictionaries/objects", [], ver="R2007",
              malformed=True, tags=["DICTIONARY", "VISUALSTYLE", "MATERIAL"])

    def no_vs(t: Tags):
        _empty_material(t)
        _drop_nod_tree(t, "ACAD_MATERIAL")
        _drop_nod_tree(t, "ACAD_VISUALSTYLE")
    c.byte_filters.append(tagfilter(no_vs))
    dangling = [("owner", "LINE 330 owner -> FFFF (no such object)"), ("material", "LINE 347 material -> FFFE (dangling pointer)"),
                ("group-member", "GROUP 340 member handle that does not exist"), ("nod-350", "NOD entry 350 -> missing object"),
                ("empty-330", "LINE with an empty 330 owner value")]
    for n, title in dangling:
        c, h = mk(f"dangling-{n}", f"Malformed: {title}", ["Q-0095"], ver="R2004", malformed=True, tags=["handles", "dangling"])
        if n == "group-member":
            grp = c.doc.groups.new("G1")
            grp.extend([c.doc.entitydb[h["line"]]])
            c.byte_filters.append(tagfilter(lambda t, gh=grp.dxf.handle, h=h: _setv(t, gh, 340, "FFFD")))
        elif n == "owner":
            c.byte_filters.append(tagfilter(lambda t, h=h: _setv(t, h["line"], 330, "FFFF")))
        elif n == "empty-330":
            c.byte_filters.append(tagfilter(lambda t, h=h: _setv(t, h["line"], 330, "")))
        elif n == "material":
            c.byte_filters.append(tagfilter(lambda t, h=h: _after(t, h["line"], 8, [(347, "FFFE")])))
        else:
            def nod_dangle(t: Tags):
                a, b = _objects_first(t)
                t.insert(b, [(3, "TRUEDXF_MISSING"), (350, "FFFC")])
            c.byte_filters.append(tagfilter(nod_dangle))
    c, h = mk("plotstylename-default-dangling", "ACAD_PLOTSTYLENAME ACDBDICTIONARYWDFLT whose 340 default handle does not exist", ["Q-0096"], ver="R2004",
              malformed=True, tags=["DICTIONARY", "dangling"])

    def wdflt(t: Tags):
        s0, e0 = t.section("OBJECTS")
        st = t.must(0, "ACDBDICTIONARYWDFLT", s0, e0)
        t.set(t.must(340, None, st, t.next0(st)), "FFFB")
    c.byte_filters.append(tagfilter(wdflt))
    c, h = mk("group-members-no-reactors", "GROUP with two LINE members whose LINEs lack the {ACAD_REACTORS back-pointer", ["Q-0097"], ver="R2004", tags=["GROUP", "reactors"])
    grp = c.doc.groups.new("G1")
    grp.extend([c.doc.entitydb[h["line"]], c.doc.entitydb[h["line2"]]])

    def no_react(t: Tags, h=h):
        for k in ("line", "line2"):
            s0, e0 = t.entity(h[k])
            i = t.find(102, "{ACAD_REACTORS", s0, e0)
            if i >= 0:
                t.remove(i, t.must(102, "}", i) + 1)
    c.byte_filters.append(tagfilter(no_react))
    c, h = mk("attrib-owner-block-record", "INSERT+ATTRIB+SEQEND whose ATTRIB/SEQEND 330 point at the owning BLOCK_RECORD instead of the INSERT", ["Q-0098"], ver="R2004",
              malformed=True, tags=["ATTRIB", "owner"])
    blk = c.doc.blocks.new("ATTBLK")
    blk.add_circle((0, 0), 10)
    blk.add_attdef("TAG", (0, -20), dxfattribs={"height": 5})
    ins = c.msp.add_blockref("ATTBLK", (100, 75))
    ins.add_auto_attribs({"TAG": "VALUE"})
    c.byte_filters.append(tagfilter(lambda t, ins=ins: _owner_to_record(t, ins.dxf.handle, ("ATTRIB", "SEQEND"))))
    c, h = mk("vertex-owner-block-record", "2D POLYLINE+VERTEX+SEQEND whose VERTEX/SEQEND 330 point at the BLOCK_RECORD instead of the POLYLINE", ["Q-0098"], ver="R2004",
              malformed=True, tags=["POLYLINE", "owner"])
    pl = c.msp.add_polyline2d([(40, 40), (160, 40), (100, 110)], close=True)
    c.byte_filters.append(tagfilter(lambda t, pl=pl: _owner_to_record(t, pl.dxf.handle, ("VERTEX", "SEQEND"))))
    c, h = mk("dict-keys-lowercase", "Root dictionary keys in lower case ('acad_mlinestyle', 'acad_group', ...), MLINESTYLE key 'standard'; MLINE referencing it", ["Q-0099"],
              ver="R2004", malformed=True, tags=["DICTIONARY", "case", "MLINE"])
    c.msp.add_mline([(30, 60), (170, 60), (170, 100)])

    def lower_keys(t: Tags):
        s0, e0 = t.section("OBJECTS")
        a, b = _objects_first(t)
        for i in t.find_all(3, None, a, b):
            t.set(i, t.value(i).lower())
        for ms, me in t.entities("DICTIONARY", s0, e0):
            i = t.find(3, "Standard", ms, me)
            if i >= 0:
                t.set(i, "standard")
    c.byte_filters.append(tagfilter(lower_keys))
    c, h = mk("xrecord-app-data-payload", "XRECORD whose AcDbXrecord data contains 102 {FOO / 1 bar / 102 } as payload", ["Q-0100"], ver="R2004", tags=["XRECORD"])
    c.byte_filters.append(tagfilter(lambda t: _nod_add(t, "TRUEDXF_XREC", [(100, "AcDbXrecord"), (280, "1"), (102, "{FOO"), (1, "bar"), (102, "}"), (70, "5")],
                                                       "XRECORD", "F003")))
    c, h = mk("xrecord-112-without-122", "Malformed: XRECORD with a 112 point X not followed by 122", [], ver="R2004", malformed=True, tags=["XRECORD"])
    c.byte_filters.append(tagfilter(lambda t: _nod_add(t, "TRUEDXF_XREC", [(100, "AcDbXrecord"), (280, "1"), (112, "1.0"), (1, "x")], "XRECORD", "F004")))
    c, h = mk("extension-dicts", "XCLIPped INSERT, SORTENTSTABLE draw order, VIEWPORT layer override: extension dictionaries on DXFOUT", ["Q-0101"],
              tags=["xdict", "XCLIP", "SORTENTS", "VIEWPORT"])
    _xclip_insert(c)
    c.msp.set_redraw_order([(h["circle"], "FFF0"), (h["line"], "FFF1")])
    c.layer("VPL", color=1)
    c.msp.add_line((20, 50), (180, 50), dxfattribs={"layer": "VPL"})
    lay = c.doc.layouts.get("Layout1")
    vp = lay.add_viewport(center=(150, 100), size=(200, 150), view_center_point=(100, 75), view_height=150)
    ov = c.doc.layers.get("VPL").get_vp_overrides()
    ov.set_color(vp.dxf.handle, 3)
    ov.commit()
    c, h = mk("r2000-no-layouts", "Malformed: AC1015 root dict with only ACAD_GROUP (no ACAD_LAYOUT dictionary, no LAYOUT objects)", ["Q-0703"], ver="R2000",
              malformed=True, tags=["LAYOUT", "DICTIONARY"])

    def only_group(t: Tags):
        a, b = _objects_first(t)
        keys = [t.svalue(i) for i in t.find_all(3, None, a, b)]
        for k in keys:
            if k != "ACAD_GROUP":
                _drop_nod_tree(t, k)
        s0, e0 = t.section("OBJECTS")
        for ls, le in reversed(t.entities("LAYOUT", s0, e0)):
            t.remove(ls, le)
        # block records still point at layouts (340): drop the links
        a, b = t.table("BLOCK_RECORD")
        for i in reversed(t.find_all(340, None, a, b)):
            t.remove(i)
        for i in reversed(t.find_all(347, None, *t.section("TABLES"))):
            t.remove(i)
        for i in reversed(t.find_all(390, None, *t.section("TABLES"))):
            t.remove(i)
    c.byte_filters.append(tagfilter(only_group))
    c, h = mk("layout-tab-order", "Three paperspace layouts B, A, C with LAYOUT 71 tab orders 5, 5, 2 (DXFOUT shows normalisation)", ["Q-0707"],
              tags=["LAYOUT", "tab-order"])
    c.doc.layouts.rename("Layout1", "B")
    c.doc.layouts.new("A")
    c.doc.layouts.new("C")

    def taborder(t: Tags):
        s0, e0 = t.section("OBJECTS")
        for ls, le in t.entities("LAYOUT", s0, e0):
            nm = t.value(t.must(1, None, t.must(100, "AcDbLayout", ls, le), le))
            if nm in (b"A", b"B", b"C"):
                t.set(t.must(71, None, ls, le), {b"B": "5", b"A": "5", b"C": "2"}[nm])
    c.byte_filters.append(tagfilter(taborder))


def _nod_add(t: Tags, key: str, body, dxftype: str, handle: str) -> None:
    a, b = _objects_first(t)
    nod_h = t.svalue(t.must(5, None, a, b))
    t.insert(b, [(3, key), (350, handle)])
    s0, e0 = t.section("OBJECTS")
    t.insert(e0, [(0, dxftype), (5, handle), (330, nod_h)] + list(body))
    i, j = t.header_var("$HANDSEED")
    if int(t.value(i + 1), 16) <= int(handle, 16):
        t.set(i + 1, f"{int(handle, 16) + 1:X}")


def _drop_nod_tree(t: Tags, key: str) -> None:
    """Remove a NOD entry, its dictionary and all objects it owns (one level)."""
    try:
        dh = _nod_remove_key(t, key)
    except KeyError:
        return
    ds, de = t.entity(dh)
    owned = [t.svalue(i) for i in t.find_all(350, None, ds, de)] + [t.svalue(i) for i in t.find_all(360, None, ds, de)]
    t.remove(ds, de)
    for oh in owned:
        try:
            s0, e0 = t.entity(oh)
            t.remove(s0, e0)
        except KeyError:
            pass


def _empty_material(t: Tags) -> None:
    a, b = _objects_first(t)
    mh = t.svalue(t.must(3, "ACAD_MATERIAL", a, b) + 1)
    ds, de = t.entity(mh)
    owned = [t.svalue(i) for i in t.find_all(350, None, ds, de)]
    for i in reversed(t.find_all(3, None, ds, de)):
        t.remove(i, i + 2)
    for oh in owned:
        s0, e0 = t.entity(oh)
        t.remove(s0, e0)
    for i in reversed(range(len(t))):
        if t.code(i) == 347 and t.value(i).decode() in owned:
            t.remove(i)


def _owner_to_record(t: Tags, parent: str, types_) -> None:
    s0, e0 = t.entity(parent)
    rec = t.value(t.must(330, None, s0, e0))
    i = e0
    while i < len(t) and t.code(i) == 0 and t.svalue(i) in types_:
        j = t.next0(i)
        k = t.find(330, None, i, j)
        if k >= 0:
            t.set(k, rec)
        i = j


# --------------------------------------------------------------------------------------------
# entity-level format questions


def _entities(s, mk) -> None:
    c, h = mk("r2000-polyline-conversion", "R2000 file: plain 2D POLYLINE, curve-fit 2D POLYLINE, 2D POLYLINE with XDATA (converted to LWPOLYLINE on DXFOUT?)", ["Q-0158"],
              ver="R2000", tags=["POLYLINE", "LWPOLYLINE"])
    c.msp.add_polyline2d([(20, 20), (60, 50), (100, 20)])
    p2 = c.msp.add_polyline2d([(110, 20), (140, 60), (180, 20)])
    p2.dxf.flags |= 2
    p3 = c.msp.add_polyline2d([(20, 100), (100, 115), (180, 100)])
    c.doc.appids.add("TRUEDXF")
    p3.set_xdata("TRUEDXF", [(1000, "keep me")])
    for n, zero in (("zero-tangents", True), ("no-tangents", False)):
        c, h = mk(f"spline-fit-{n}", f"AC1018 fit-point SPLINE {'with 12/13 tangents = (0,0,0)' if zero else 'without 12/13 tangents'}", ["Q-0174"], ver="R2004",
                  malformed=zero, tags=["SPLINE"])
        sp = c.msp.add_spline([(30, 40), (70, 110), (110, 50), (160, 100)])
        if zero:
            c.byte_filters.append(tagfilter(lambda t, hh=sp.dxf.handle: _before(t, hh, 11, [(12, "0.0"), (22, "0.0"), (32, "0.0"), (13, "0.0"), (23, "0.0"), (33, "0.0")])))
    for n in ("with-marker", "without-marker"):
        c, h = mk(f"r2004-3dsolid-{n}", f"AC1018 3DSOLID box (ezdxf SAT) {n.replace('-', ' ')} '100 AcDb3dSolid'", ["Q-0188"], ver="R2004", malformed=True, tags=["3DSOLID", "ACIS"])
        so = c.msp.add_3dsolid()
        export_acis(so, [acis.body_from_mesh(forms.cube().scale_uniform(40).translate(100, 75, 0))])

        def mark(t: Tags, hh=so.dxf.handle, n=n):
            s0, e0 = t.entity(hh)
            i = t.find(100, "AcDb3dSolid", s0, e0)
            if n == "with-marker" and i < 0:
                t.insert(e0, [(100, "AcDb3dSolid"), (350, "0")])
            elif n == "without-marker" and i >= 0:
                t.remove(i, t.next0(i) if t.find(350, None, i, e0) >= 0 else i + 1)
        c.byte_filters.append(tagfilter(mark))
    c, h = mk("r2018-3dsolid-thumbnail", "R2018 3DSOLID box (SAB in ACDSDATA): which of THUMBNAILIMAGE/ACDSDATA comes first on DXFOUT", ["Q-0038"],
              tags=["3DSOLID", "ACDSDATA"])
    so = c.msp.add_3dsolid()
    export_acis(so, [acis.body_from_mesh(forms.cube().scale_uniform(40).translate(100, 75, 0))])
    for v in ("R2000", "R2004"):
        for n, with63 in (("with-63", True), ("without-63", False)):
            c, h = mk(f"mpolygon-{v.lower()}-{n}", f"MPOLYGON solid fill {n.replace('-', ' ')} fill colour ({v})", ["Q-0369"], ver=v, malformed=True,
                      tags=["MPOLYGON"], style_table="acad.ctb")
            mp = c.msp.add_mpolygon(color=1, fill_color=3 if with63 else None)
            mp.paths.add_polyline_path([(40, 30), (160, 30), (160, 110), (40, 110)], flags=1)
            if with63:
                c.byte_filters.append(tagfilter(lambda t, hh=mp.dxf.handle: None if _find_in(t, hh, 63) >= 0 else _before(t, hh, 11, [(63, "3")])))
            else:
                c.byte_filters.append(tagfilter(lambda t, hh=mp.dxf.handle: _drop(t, hh, 63)))
    c, h = mk("hatch-assoc-dangling", "Malformed: associative HATCH (71=1) whose path 330 names a non-existent boundary entity", ["Q-0370"], ver="R2004",
              malformed=True, tags=["HATCH", "associative"])
    ht = c.msp.add_hatch(color=3)
    ht.paths.add_polyline_path([(40, 30), (160, 30), (160, 110), (40, 110)], is_closed=True)

    def assoc(t: Tags, hh=ht.dxf.handle):
        _setv(t, hh, 71, "1")
        _setv(t, hh, 97, "1")
        _after(t, hh, 97, [(330, "FFFA")])
    c.byte_filters.append(tagfilter(assoc))
    for n, pattern, derived, with47 in (("honey-with-47", "HONEY", False, True), ("honey-without-47", "HONEY", False, False),
                                         ("honey-derived-with-47", "HONEY", True, True), ("honey-derived-without-47", "HONEY", True, False),
                                         ("solid-with-47", "SOLID", False, True)):
        c, h = mk(f"hatch-47-{n}", f"{pattern} HATCH, {'derived (92=7)' if derived else 'non-derived'} polyline path, {'with' if with47 else 'without'} group 47",
                  [], ver="R2018", malformed=True, tags=["HATCH", "pattern"])
        ht = c.msp.add_hatch()
        if pattern == "SOLID":
            ht.set_solid_fill(color=7)
        else:
            ht.set_pattern_fill(pattern, scale=2)
        ht.paths.add_polyline_path([(40, 30), (160, 30), (160, 110), (40, 110)], is_closed=True, flags=7 if derived else 3)

        def f47(t: Tags, hh=ht.dxf.handle, with47=with47):
            s0, e0 = t.entity(hh)
            i = t.find(47, None, s0, e0)
            if with47 and i < 0:
                t.insert(t.must(98, None, s0, e0), [(47, "0.0360345")])
            elif not with47 and i >= 0:
                t.remove(i)
        c.byte_filters.append(tagfilter(f47))
    c, h = mk("hatch-no-extrusion", "AC1032 solid HATCH with 210/220/230 omitted", ["Q-0372"], malformed=True, tags=["HATCH"])
    ht = c.msp.add_hatch(color=3)
    ht.paths.add_polyline_path([(40, 30), (160, 30), (160, 110), (40, 110)], is_closed=True)
    c.byte_filters.append(tagfilter(lambda t, hh=ht.dxf.handle: [_drop(t, hh, code) for code in (210, 220, 230)]))
    for v in ("R2004", "R2007", "R2010", "R2013", "R2018"):
        for n in ("with-97", "without-97"):
            c, h = mk(f"hatch-spline-{v.lower()}-{n}", f"HATCH with a spline edge (no fit points) {n.replace('-', ' ')} group 97 ({v})", ["Q-0373"], ver=v,
                      malformed=True, tags=["HATCH", "spline-edge"])
            _spline_hatch(c, fit=False, want97=n == "with-97")
    for n in ("with-97", "without-97"):
        c, h = mk(f"hatch-spline-fit-r2018-{n}", f"HATCH spline edge with 4 fit points, {n.replace('-', ' ')} group 97 (R2018)", ["Q-0373"], malformed=True, tags=["HATCH", "spline-edge"])
        _spline_hatch(c, fit=True, want97=n == "with-97")
    for n, raw in (("lone-cr", b"AB\rCD"), ("raw-lf", None), ("raw-crlf", b"AB\r\nCD")):
        c, h = mk(f"text-raw-{n}", f"Malformed: AC1018 TEXT whose value contains a raw {n.replace('raw-', '').replace('-', ' ').upper()} between two words", ["Q-0377"], ver="R2004",
                  malformed=True, tags=["TEXT", "control-char"])
        c.msp.add_text("RAWPLACEHOLDER", height=10, dxfattribs={"insert": (30, 60)})
        c.byte_filters.append(replace_bytes(b"\nRAWPLACEHOLDER\n", b"\n" + (raw if raw else b"AB\nCD") + b"\n"))
    c, h = mk("text-trailing-caret", "Malformed: TEXT value ending in a single '^'", [], malformed=True, tags=["TEXT", "caret"])
    c.msp.add_text("CARETEND", height=10, dxfattribs={"insert": (30, 60)})
    c.byte_filters.append(replace_bytes(b"\nCARETEND\n", b"\nABC^\n"))
    c, h = mk("text-style-in-acdbentity", "Malformed: AC1015 TEXT with group 7 (style) written in AcDbEntity instead of AcDbText", ["Q-0388"], ver="R2000",
              malformed=True, tags=["TEXT", "tag-order"])
    c.style("LIB", font=TTF_FONTS["sans"])
    te = c.msp.add_text("STYLED", height=10, dxfattribs={"insert": (30, 60), "style": "LIB"})

    def move7(t: Tags, hh=te.dxf.handle):
        s0, e0 = t.entity(hh)
        i = t.must(7, None, s0, e0)
        tag = t.remove(i)
        j = t.must(8, None, s0, e0)
        t.pairs[j + 1:j + 1] = tag
    c.byte_filters.append(tagfilter(move7))
    c, h = mk("text-width-zero", "AC1018 TEXT with width factor 41 = 0.0", ["Q-0402"], ver="R2004", malformed=True, tags=["TEXT"])
    te = c.msp.add_text("WIDTHZERO", height=10, dxfattribs={"insert": (30, 60), "width": 0.5})
    c.byte_filters.append(tagfilter(lambda t, hh=te.dxf.handle: _setv(t, hh, 41, "0.0")))
    c, h = mk("text-undefined-style", "Malformed: TEXT referencing STYLE 'NOSUCHSTYLE'", [], malformed=True, tags=["TEXT", "STYLE"])
    c.style("LIB", font=TTF_FONTS["sans"])
    te = c.msp.add_text("UNDEFINED STYLE", height=10, dxfattribs={"insert": (30, 60), "style": "LIB"})
    c.byte_filters.append(tagfilter(lambda t, hh=te.dxf.handle: _setv(t, hh, 7, "NOSUCHSTYLE")))
    c, h = mk("mtext-group1-before-3", "MTEXT with group 1 'FIRST ' written before its 3 chunk 'SECOND ...'", ["Q-0410"], malformed=True, tags=["MTEXT", "chunks"])
    c.msp.add_mtext("MTPH", dxfattribs={"insert": (20, 100), "char_height": 6, "width": 160})

    def g1first(t: Tags):
        i = t.must(1, "MTPH")
        t.remove(i)
        t.insert(i, [(1, "FIRST "), (3, "SECOND " + "x" * 243)])
    c.byte_filters.append(tagfilter(g1first))
    for v in ("R2000", "R2018"):
        c, h = mk(f"mtext-rotated-{v.lower()}", f"MTEXT rotated 30 degrees via group 50 ({v}): does DXFOUT write 50 or 11?", ["Q-0411"], ver=v, tags=["MTEXT", "rotation"])
        c.msp.add_mtext("ROTATED\\PMTEXT", dxfattribs={"insert": (70, 60), "char_height": 10, "rotation": 30})
    c, h = mk("style-xdata-computed", "STYLEs for Liberation Sans regular/bold/italic/bold-italic without XDATA: DXFOUT shows AutoCAD's family/1071 XDATA", ["Q-0459"],
              tags=["STYLE", "XDATA"])
    for i, k in enumerate(("sans", "sans-bold", "sans-italic", "sans-bolditalic")):
        c.style(k.upper(), font=TTF_FONTS[k])
        c.msp.add_text(k, height=8, dxfattribs={"insert": (20, 100 - i * 20), "style": k.upper()})
    for n in ("no-attribs", "flag-128"):
        c, h = mk(f"insert-66-{n}", "Malformed: INSERT 66=1 directly followed by the next entity (no ATTRIB/SEQEND)" if n == "no-attribs"
                  else "Malformed: INSERT with 66 = 128 and valid ATTRIB + SEQEND", ["Q-0501"], malformed=True, tags=["INSERT", "ATTRIB"])
        blk = c.doc.blocks.new("ATTBLK")
        blk.add_circle((0, 0), 10)
        blk.add_attdef("TAG", (0, -20), dxfattribs={"height": 5})
        if n == "no-attribs":
            ins = c.msp.add_blockref("ATTBLK", (100, 75))
            c.byte_filters.append(tagfilter(lambda t, hh=ins.dxf.handle: _after(t, hh, 100, [(66, "1")], nth=1) if _find_in(t, hh, 66) < 0 else None))
        else:
            ins = c.msp.add_blockref("ATTBLK", (100, 75))
            ins.add_auto_attribs({"TAG": "VALUE"})
            c.byte_filters.append(tagfilter(lambda t, hh=ins.dxf.handle: _setv(t, hh, 66, "128")))
    for n in ("both-280", "lock-only", "swapped", "ezdxf"):
        c, h = mk(f"attrib-280-{n}", f"R2018 ATTRIB with 280 layout: {n}", ["Q-0502"], malformed=n in ("swapped",), tags=["ATTRIB"])
        blk = c.doc.blocks.new("ATTBLK")
        blk.add_circle((0, 0), 10)
        blk.add_attdef("TAG", (0, -20), dxfattribs={"height": 5})
        ins = c.msp.add_blockref("ATTBLK", (100, 75))
        att = ins.add_attrib("TAG", "VALUE", (100, 55), dxfattribs={"height": 5})

        def a280(t: Tags, hh=att.dxf.handle, n=n):
            s0, e0 = t.entity(hh)
            i = t.must(100, "AcDbAttribute", s0, e0)
            j = t.must(70, None, i, e0)
            if n == "both-280":
                t.insert(j + 1, [(280, "1")])
                t.insert(i + 1, [(280, "0")])
            elif n == "lock-only":
                t.insert(j + 1, [(280, "1")])
            elif n == "swapped":
                t.insert(j + 1, [(280, "0")])
                t.insert(i + 1, [(280, "1")])
        c.byte_filters.append(tagfilter(a280))
    c, h = mk("attrib-74-wrong-subclass", "Malformed: ATTRIB 74 written in AcDbText instead of AcDbAttribute", [], malformed=True, tags=["ATTRIB"])
    blk = c.doc.blocks.new("ATTBLK")
    blk.add_attdef("TAG", (0, 0), dxfattribs={"height": 5})
    ins = c.msp.add_blockref("ATTBLK", (100, 75))
    att = ins.add_attrib("TAG", "VALUE", (100, 55), dxfattribs={"height": 5})
    c.byte_filters.append(tagfilter(lambda t, hh=att.dxf.handle: _after(t, hh, 1, [(74, "2")])))
    c, h = mk("block-attdef-no-flag-2", "BLOCK with ATTDEFs but BLOCK flag bit 2 cleared", [], malformed=True, tags=["BLOCK", "ATTDEF"])
    blk = c.doc.blocks.new("ATTBLK")
    blk.add_circle((0, 0), 10)
    blk.add_attdef("TAG", (0, -20), dxfattribs={"height": 5})
    ins = c.msp.add_blockref("ATTBLK", (100, 75))
    ins.add_auto_attribs({"TAG": "VALUE"})

    def noflag(t: Tags):
        a, b = t.section("BLOCKS")
        i = t.must(2, "ATTBLK", a, b)
        st = i
        while t.code(st) != 0:
            st -= 1
        j = t.must(70, None, st, t.next0(st))
        t.set(j, "0")
    c.byte_filters.append(tagfilter(noflag))
    c, h = mk("dimstyle-340-name", "Malformed: DIMSTYLE 340 (DIMTXSTY) holding the style name 'Standard' instead of a handle (may crash AutoCAD)", ["Q-0510"],
              ver="R2004", malformed=True, tags=["DIMSTYLE"])
    c.msp.add_linear_dim(base=(100, 25), p1=(40, 18), p2=(160, 18)).render()

    def dimstyle340(t: Tags):
        a, b = t.table("DIMSTYLE")
        st = t.must(0, "DIMSTYLE", a + 1, b)
        en = t.next0(st)
        i = t.find(340, None, st, en)
        if i >= 0:
            t.set(i, "Standard")
        else:
            k = next((j for j in range(st, en) if t.code(j) >= 340), en)
            t.insert(k, [(340, "Standard")])
    c.byte_filters.append(tagfilter(dimstyle340))
    for code in (294, 295):
        c, h = mk(f"dimstyle-txtdirection-{code}", f"DIMSTYLE with DIMTXTDIRECTION=1 written as group {code} (R2018); DXFOUT shows AutoCAD's code", ["Q-0513"],
                  malformed=True, tags=["DIMSTYLE"])
        c.msp.add_linear_dim(base=(100, 40), p1=(40, 30), p2=(160, 30)).render()

        def txtdir(t: Tags, code=code):
            a, b = t.table("DIMSTYLE")
            st = t.must(0, "DIMSTYLE", a + 1, b)
            en = t.next0(st)
            k = next((j for j in range(st, en) if t.code(j) >= 340), en)
            t.insert(k, [(code, "1")])
        c.byte_filters.append(tagfilter(txtdir))
    for v in ("R2007", "R2018"):
        c, h = mk(f"dimstyle-post-{v.lower()}", f"DIMSTYLE with DIMPOST '<> mm' and DIMAPOST '[] in' ({v}); DXFOUT", ["Q-0514"], ver=v, tags=["DIMSTYLE"])
        ds = c.doc.dimstyles.new("POSTS")
        ds.dxf.dimpost = "<> mm"
        ds.dxf.dimapost = "[] in"
        c.msp.add_linear_dim(base=(100, 40), p1=(40, 30), p2=(160, 30), dimstyle="POSTS").render()
    c, h = mk("dimstyle-table-with-71-340", "DIMSTYLE table head written AutoCAD-style with 71 count + 340 record handles (ezdxf omits them)", [],
              tags=["DIMSTYLE"])

    def dshead(t: Tags):
        a, b = t.table("DIMSTYLE")
        j = t.next0(a + 1)
        recs = [t.svalue(i + 1) for i in t.find_all(0, "DIMSTYLE", a + 1, b) if t.code(i + 1) == 105]
        t.insert(j, [(71, str(len(recs)))] + [(340, r) for r in recs])
    c.byte_filters.append(tagfilter(dshead))
    c, h = mk("dimension-bad-block-name", "Malformed: DIMENSION whose block name 2 is 'NOSUCH*D' (invalid dimension block name)", [], malformed=True,
              tags=["DIMENSION"])
    d = c.msp.add_linear_dim(base=(100, 40), p1=(40, 30), p2=(160, 30))
    d.render()
    c.byte_filters.append(tagfilter(lambda t, hh=d.dimension.dxf.handle: _setv(t, hh, 2, "NOSUCH*D")))
    c, h = mk("rotated-dim-no-subclass", "Malformed: rotated linear DIMENSION without 100 AcDbRotatedDimension", [], malformed=True, tags=["DIMENSION", "subclass"])
    d = c.msp.add_linear_dim(base=(100, 40), p1=(40, 30), p2=(160, 30), angle=10)
    d.render()
    c.byte_filters.append(tagfilter(lambda t, hh=d.dimension.dxf.handle: _drop(t, hh, 100, "AcDbRotatedDimension")))
    for n, nv in (("one-vertex", 1), ("zero-vertices", 0)):
        c, h = mk(f"leader-{n}", f"Malformed: AC1018 LEADER with 76 = {nv}", ["Q-0580"], ver="R2004", malformed=True, tags=["LEADER"])
        ld = c.msp.add_leader([(40, 40), (100, 100), (140, 100)])

        def lv(t: Tags, hh=ld.dxf.handle, nv=nv):
            s0, e0 = t.entity(hh)
            t.set(t.must(76, None, s0, e0), str(nv))
            idx = [i for i in range(s0, e0) if t.code(i) in (10, 20, 30)]
            keep = 3 * nv
            for i in reversed(idx[keep:]):
                t.remove(i)
        c.byte_filters.append(tagfilter(lv))
    for v in ("R2004", "R2007", "R2010"):
        c, h = mk(f"mleader-{v.lower()}", f"MULTILEADER in a {v} file (AutoCAD writes it only from AC1021/AC1024?)", ["Q-0589"], ver=v,
                  malformed=v != "R2010", tags=["MULTILEADER", "version"])
        _mleader(c)
    c, h = mk("insert-in-paper-space-block", "Malformed: modelspace-style entity written inside the *Paper_Space BLOCK definition", [],
              malformed=True, tags=["BLOCK"])
    ps = c.doc.layouts.get("Layout1")
    ps.add_line((0, 0), (100, 100))

    def ps_block(t: Tags):
        es, ee = t.section("ENTITIES")
        # move the paperspace LINE (67 1) from ENTITIES into the *Paper_Space block
        for ls, le in t.entities("LINE", es, ee):
            if t.find(67, "1", ls, le) >= 0:
                ent = t.remove(ls, le)
                a, b = t.section("BLOCKS")
                i = t.must(2, "*Paper_Space", a, b)
                j = t.must(0, "ENDBLK", i)
                t.pairs[j:j] = ent
                break
    c.byte_filters.append(tagfilter(ps_block))
    c, h = mk("ellipse-ratio-above-1", "Malformed: ELLIPSE with ratio 40 = 1.5 (> 1)", [], malformed=True, tags=["ELLIPSE"])
    el = c.msp.add_ellipse((100, 75), major_axis=(50, 0), ratio=0.5)
    c.byte_filters.append(tagfilter(lambda t, hh=el.dxf.handle: _setv(t, hh, 40, "1.5")))
    c, h = mk("mesh-empty", "Malformed: MESH with no vertices and no faces", [], malformed=True, tags=["MESH"])
    c.msp.add_mesh()
    c, h = mk("spline-no-knots", "Malformed: SPLINE with control points but 72 = 0 knots", [], malformed=True, tags=["SPLINE"])
    sp = c.msp.add_open_spline([(30, 40), (70, 110), (110, 50), (160, 100)])

    def noknots(t: Tags, hh=sp.dxf.handle):
        _setv(t, hh, 72, "0")
        _drop(t, hh, 40)
    c.byte_filters.append(tagfilter(noknots))
    c, h = mk("lwpolyline-90-outside", "Malformed: LWPOLYLINE with 90/70 written in AcDbEntity instead of AcDbPolyline", [], malformed=True,
              tags=["LWPOLYLINE", "tag-order"])
    pl = c.msp.add_lwpolyline([(40, 40), (160, 40), (100, 110)], close=True)

    def lw90(t: Tags, hh=pl.dxf.handle):
        s0, e0 = t.entity(hh)
        i90 = t.must(90, None, s0, e0)
        i70 = t.must(70, None, s0, e0)
        tags_ = [t.pairs[i90], t.pairs[i70]]
        for i in sorted((i90, i70), reverse=True):
            t.remove(i)
        j = t.must(8, None, s0, e0)
        t.pairs[j + 1:j + 1] = tags_
    c.byte_filters.append(tagfilter(lw90))
    c, h = mk("polyline3d-vertex-no-subclass", "Malformed: 3D POLYLINE vertices without 100 AcDb3dPolylineVertex", [], malformed=True, tags=["POLYLINE", "subclass"])
    p3 = c.msp.add_polyline3d([(30, 30, 0), (170, 30, 10), (100, 120, 20)])

    def v3(t: Tags, hh=p3.dxf.handle):
        s0, e0 = t.entity(hh)
        i = e0
        while t.svalue(i) == "VERTEX":
            j = t.next0(i)
            k = t.find(100, "AcDb3dPolylineVertex", i, j)
            if k >= 0:
                t.remove(k)
            i = t.next0(i)
    c.byte_filters.append(tagfilter(v3))
    c, h = mk("vertex-bad-visibility", "Malformed: 2D POLYLINE VERTEX with 60 = 2 (bad visibility value)", [], ver="R2004", malformed=True, tags=["POLYLINE"])
    p2 = c.msp.add_polyline2d([(30, 30), (170, 30), (100, 120)])

    def vis(t: Tags, hh=p2.dxf.handle):
        s0, e0 = t.entity(hh)
        j = t.next0(e0)
        k = t.must(8, None, e0, j)
        t.insert(k + 1, [(60, "2")])
    c.byte_filters.append(tagfilter(vis))
    c, h = mk("hatch-two-72-flags", "Malformed: HATCH polyline path with two 72 has-bulge flags", [], malformed=True, tags=["HATCH"])
    ht = c.msp.add_hatch(color=3)
    ht.paths.add_polyline_path([(40, 30), (160, 30), (160, 110), (40, 110)], is_closed=True)
    c.byte_filters.append(tagfilter(lambda t, hh=ht.dxf.handle: _after(t, hh, 72, [(72, "0")])))
    c, h = mk("hatch-arc-360-as-0", "HATCH circle edge written with start 0 / end 0 instead of 0 / 360", [], malformed=True, tags=["HATCH"])
    ht = c.msp.add_hatch(color=3)
    ep = ht.paths.add_edge_path()
    ep.add_arc((100, 75), 40, 0, 360)
    c.byte_filters.append(tagfilter(lambda t, hh=ht.dxf.handle: _setv(t, hh, 51, "0.0")))
    c, h = mk("image-no-clip-vertices", "Malformed: IMAGE with 91 = 0 clip vertices", [], malformed=True, tags=["IMAGE"])
    img = _image(c)

    def noclip(t: Tags, hh=img.dxf.handle):
        s0, e0 = t.entity(hh)
        i = t.must(91, None, s0, e0)
        t.set(i, "0")
        for k in reversed(range(i + 1, e0)):
            if t.code(k) in (14, 24):
                t.remove(k)
    c.byte_filters.append(tagfilter(noclip))
    for n, fn in (("image", _image), ("wipeout", None)):
        c, h = mk(f"{n}-clip-open-polygon", f"{n.upper()} with a polygon clip boundary whose last vertex != first (not closed)", ["Q-0642"],
                  malformed=True, tags=[n.upper(), "clip"])
        if n == "image":
            e = _image(c, clip=[(2, 2), (14, 2), (14, 10), (2, 10), (2, 2)])
        else:
            e = c.msp.add_wipeout([(60, 50), (140, 50), (140, 100), (60, 100)])

        def openclip(t: Tags, hh=e.dxf.handle):
            s0, e0 = t.entity(hh)
            i14 = t.find_all(14, None, s0, e0)
            i91 = t.must(91, None, s0, e0)
            t.remove(i14[-1], i14[-1] + 2)
            t.set(i91, str(len(i14) - 1))
            t.set(t.must(71, None, s0, e0), "2")
        c.byte_filters.append(tagfilter(openclip))
    c, h = mk("image-relative-path", "IMAGE whose IMAGEDEF path is relative ('fileformat-rel.png', file next to the DXF)", [],
              tags=["IMAGE", "path"], style_table="acad.ctb")
    _image(c, fname="fileformat-rel.png", relative=True)
    c, h = mk("wipeout-no-variables", "WIPEOUT without ACAD_WIPEOUT_VARS dictionary / WIPEOUTVARIABLES object", ["Q-0668"], ver="R2018", malformed=True, tags=["WIPEOUT"])
    c.msp.add_wipeout([(60, 50), (140, 50), (140, 100), (60, 100)])
    c.byte_filters.append(tagfilter(lambda t: _drop_nod_tree(t, "ACAD_WIPEOUT_VARS")))
    titles = {"disabled-with-40": "SPATIAL_FILTER with front clip off (72=0) but 40 written",
              "inverted-ezdxf": "Inverted XCLIP as written by ezdxf (ACAD_INVERTEDCLIP_ROUNDTRIP xrecord; ezdxf warns AutoCAD rejects it)",
              "inverted-truncated": "Inverted XCLIP whose ACAD_INVERTEDCLIP_ROUNDTRIP XRECORD data is truncated"}
    for n, title in titles.items():
        c, h = mk(f"spatial-filter-{n}", title, ["Q-0639"], malformed=True, tags=["XCLIP", "SPATIAL_FILTER"])
        ins = _xclip_insert(c)
        if n.startswith("disabled"):
            def sf40(t: Tags):
                s0, e0 = t.section("OBJECTS")
                st = t.must(0, "SPATIAL_FILTER", s0, e0)
                en = t.next0(st)
                i = t.must(72, None, st, en)
                t.insert(i + 1, [(40, "10.0")])
            c.byte_filters.append(tagfilter(sf40))
        else:
            from ezdxf.xclip import XClip
            XClip(ins).invert_clipping_path(ignore_acad_compatibility=True)
            if n == "inverted-ezdxf":
                continue

            def trunc(t: Tags):
                s0, e0 = t.section("OBJECTS")
                for xs, xe in t.entities("XRECORD", s0, e0):
                    if t.find(1, None, xs, xe) >= 0 or True:
                        pass
                # truncate the XDATA/xrecord that carries the inverted clip data
                for i in range(len(t)):
                    if t.value(i).startswith(b"ACAD_INVERTEDCLIP_ROUNDTRIP"):
                        st = i
                        k = st + 1
                        while k < len(t) and t.code(k) not in (0, 1001, 102):
                            k += 1
                        mid = st + 1 + (k - st - 1) // 2
                        t.remove(mid, k)
                        return
            c.byte_filters.append(tagfilter(trunc))
    c, h = mk("mlinestyle-true-color-fill", "MLINESTYLE with fill on and a true-colour fill 420 after 62: does DXFOUT keep it?", ["Q-0680"], ver="R2018", malformed=True,
              tags=["MLINE", "MLINESTYLE", "true-color"], style_table="acad.ctb")
    sty = c.doc.mline_styles.new("FILLED")
    sty.elements.append(5, 1)
    sty.elements.append(-5, 5)
    sty.dxf.flags = 1
    sty.dxf.fill_color = 3
    c.msp.add_mline([(30, 60), (170, 60), (170, 100)], dxfattribs={"style_name": "FILLED"})

    def f420(t: Tags):
        s0, e0 = t.section("OBJECTS")
        for ms, me in t.entities("MLINESTYLE", s0, e0):
            if t.find(2, "FILLED", ms, me) >= 0:
                i = t.must(62, None, ms, me)
                t.insert(i + 1, [(420, str(0xFF8000))])
    c.byte_filters.append(tagfilter(f420))
    c, h = mk("mlinestyle-bad-start-angle", "Malformed: MLINESTYLE with start angle 51 = 200 (bad mlstyle start angle)", [], malformed=True, tags=["MLINESTYLE"])
    c.msp.add_mline([(30, 60), (170, 60)])
    c.byte_filters.append(tagfilter(lambda t: [t.set(i, "200.0") for i in t.find_all(51, None, *t.section("OBJECTS"))[:1]]))


def _find_in(t: Tags, h: str, code: int) -> int:
    s0, e0 = t.entity(h)
    return t.find(code, None, s0, e0)


def _spline_hatch(c, fit: bool, want97: bool) -> None:
    ht = c.msp.add_hatch(color=3)
    ep = ht.paths.add_edge_path()
    ep.add_line((40, 30), (160, 30))
    ep.add_line((160, 30), (160, 100))
    ep.add_spline(control_points=[(160, 100), (120, 130), (80, 70), (40, 100)], degree=3,
                  knot_values=[0, 0, 0, 0, 1, 1, 1, 1], fit_points=[(160, 100), (100, 105), (40, 100)] if fit else None)
    ep.add_line((40, 100), (40, 30))

    def f97(t: Tags, hh=ht.dxf.handle):
        s0, e0 = t.entity(hh)
        i96 = t.must(96, None, s0, e0)
        j = t.find(97, None, i96, e0)
        # a spline edge's 97 (fit point count) follows its control points; the boundary-object
        # count 97 of the path follows later; identify the edge-97 as the first 97 after 96
        k = t.find(72, None, i96, e0)  # next edge type after the spline, if any
        has = j >= 0 and (k < 0 or j < k)
        if want97 and not has:
            last = max(i for i in range(i96, e0) if t.code(i) in (10, 20, 42))
            t.insert(last + 1, [(97, "0")])
        elif not want97 and has:
            if fit:
                n = int(t.value(j))
                t.remove(j, j + 1 + 2 * n)
                for cc in (12, 22, 13, 23):
                    pass
            else:
                t.remove(j)
    c.byte_filters.append(tagfilter(f97))


# --------------------------------------------------------------------------------------------
# further malformed-input cases


def _dib(w: int = 16, h: int = 12) -> bytes:
    """24-bit BITMAPINFOHEADER DIB (no file header), as stored in THUMBNAILIMAGE."""
    row = (w * 3 + 3) & ~3
    pix = b"".join(bytes(v for x in range(w) for v in ((x * 16) & 255, (y * 20) & 255, 200)).ljust(row, b"\0") for y in range(h))
    return struct.pack("<IiiHHIIiiII", 40, w, h, 1, 24, 0, len(pix), 2835, 2835, 0, 0) + pix


def _binary_chunks(s, mk) -> None:
    """310 binary chunk line lengths (Q-0014): XRECORD data and a THUMBNAILIMAGE section."""
    payload = bytes((i * 7) & 255 for i in range(600))
    for n, size in (("127", 127), ("200", 200), ("16", 16)):
        c, h = mk(f"xrecord-310-lines-{n}", f"XRECORD with 600 bytes of 310 binary data written in {size}-byte lines", ["Q-0014"], ver="R2004",
                  malformed=size > 127, tags=["binary-chunk", "XRECORD"], params={"line_bytes": size})
        c.byte_filters.append(tagfilter(lambda t, size=size: _nod_add(
            t, "TRUEDXF_BIN", [(100, "AcDbXrecord"), (280, "1"), (90, str(len(payload)))] + [(310, x) for x in hex_chunks(payload, size)], "XRECORD", "F010")))
    dib = _dib()
    for n in ("127", "200", "padded-last"):
        c, h = mk(f"thumbnail-310-{n}", f"THUMBNAILIMAGE section (90 = {len(dib)} byte DIB) with 310 chunks: {n}", ["Q-0014", "Q-0038"], ver="R2004",
                  malformed=n != "127", tags=["binary-chunk", "THUMBNAILIMAGE"], params={"variant": n})

        def thumb(t: Tags, n=n):
            chunks = hex_chunks(dib, 200 if n == "200" else 127)
            if n == "padded-last":
                last = bytes.fromhex(chunks[-1])
                chunks[-1] = (last + b"\0" * (127 - len(last))).hex().upper()
            t.insert(len(t) - 1, [(0, "SECTION"), (2, "THUMBNAILIMAGE"), (90, str(len(dib)))] + [(310, x) for x in chunks] + [(0, "ENDSEC")])
        c.byte_filters.append(tagfilter(thumb))


# --------------------------------------------------------------------------------------------
# MTEXT attachment point (71) missing or outside 1..9 (Q-0748)


def _mtext_attachment(s, mk) -> None:
    # insertion point (100, 75) = where the base drawing's diagonals cross; 1, 5, 9 are controls
    for n, val in (("1", "1"), ("5", "5"), ("9", "9"), ("missing", None), ("0", "0"), ("10", "10"), ("minus1", "-1"),
                   ("99", "99")):
        c, h = mk(f"mtext-attachment-{n}", f"MTEXT 'ABC\\PDEFG' at the diagonals' crossing with 71 {'absent' if val is None else '= ' + val}",
                  ["Q-0748"], malformed=n not in ("1", "5", "9"), tags=["MTEXT", "attachment"], params={"attachment": val})
        m = c.msp.add_mtext("ABC\\PDEFG", dxfattribs={"insert": (100, 75), "char_height": 10, "attachment_point": 1})
        if val is None:
            c.byte_filters.append(tagfilter(lambda t, hh=m.dxf.handle: _drop(t, hh, 71)))
        else:
            c.byte_filters.append(tagfilter(lambda t, hh=m.dxf.handle, val=val: _setv(t, hh, 71, val)))


def _malformed_misc(s, mk) -> None:
    c, h = mk("block-record-xdata-unregistered", "Malformed: BLOCK_RECORD XDATA AcDbDynamicBlockGUID without APPID record", [],
              malformed=True, tags=["BLOCK_RECORD", "XDATA"])
    blk = c.doc.blocks.new("DYN")
    blk.add_circle((0, 0), 10)
    c.msp.add_blockref("DYN", (100, 75))

    def dynguid(t: Tags):
        a, b = t.table("BLOCK_RECORD")
        i = t.must(2, "DYN", a, b)
        t.insert(t.next0(i), [(1001, "AcDbDynamicBlockGUID"), (1000, "{00000000-0000-0000-0000-000000000000}")])
    c.byte_filters.append(tagfilter(dynguid))
    c, h = mk("dict-hard-owner-flag-0", "Root and ACAD_GROUP dictionaries written with 281 = 0 instead of 1", [], ver="R2004", malformed=True,
              tags=["DICTIONARY"])
    c.byte_filters.append(tagfilter(lambda t: [t.set(i, "0") for i in t.find_all(281, "1", *t.section("OBJECTS"))[:2]]))
    c, h = mk("vport-view-far-away", "*Active VPORT centred far away from the content (opens 'empty'; plot window unaffected)", [],
              tags=["VPORT"])

    def vport(t: Tags):
        a, b = t.table("VPORT")
        i = t.must(12, None, a, b)
        t.set(i, "100000.0")
        t.set(i + 1, "100000.0")
    c.byte_filters.append(tagfilter(vport))
    c, h = mk("layer-390-dangling", "LAYER 390 plot-style handle pointing at a non-existent object (Copy-to-clipboard failure)", [], malformed=True, tags=["LAYER"])
    c.byte_filters.append(tagfilter(lambda t: [t.set(i, "FFF9") for i in t.find_all(390, None, *t.table("LAYER"))]))
    c, h = mk("appid-garbage-name", "Malformed: APPID record name with garbage characters ('TRUE<DXF>*?')", [], malformed=True, tags=["APPID"])
    c.doc.appids.add("GARBAGEPH")
    c.byte_filters.append(tagfilter(lambda t: t.replace_values("GARBAGEPH", "TRUE<DXF>*?", code=2)))
    c, h = mk("shape-style-named", "Malformed: shape-file STYLE record (flag 1) with a made-up name 'SHAPE$0$REF' instead of an empty name", [], malformed=True,
              tags=["STYLE"])
    st = c.doc.styles.add_shx("truedxf-missing-shapes.shx")
    c.byte_filters.append(tagfilter(lambda t, hh=st.dxf.handle: _setv(t, hh, 2, "SHAPE$0$REF")))
    c, h = mk("plotsettings-no-subclass", "Malformed: LAYOUT without 100 AcDbPlotSettings", [], malformed=True, tags=["LAYOUT", "subclass"])
    c.byte_filters.append(tagfilter(lambda t: [t.remove(i) for i in reversed(t.find_all(100, "AcDbPlotSettings", *t.section("OBJECTS"))[:1])]))
    c, h = mk("r2018-3dsolid-no-subclass", "Malformed: R2018 3DSOLID without 100 AcDb3dSolid / 350", ["Q-0188"], malformed=True, tags=["3DSOLID", "subclass"])
    so = c.msp.add_3dsolid()
    export_acis(so, [acis.body_from_mesh(forms.cube().scale_uniform(40).translate(100, 75, 0))])

    def nosub(t: Tags, hh=so.dxf.handle):
        _drop(t, hh, 100, "AcDb3dSolid")
        _drop(t, hh, 350)
    c.byte_filters.append(tagfilter(nosub))


# --------------------------------------------------------------------------------------------
# corpus files (local research/repos copies, skipped when missing)


def _corpus(s, mk) -> None:
    import re

    from ..core import DXFVERSIONS, REPO_ROOT
    repos = REPO_ROOT / "research" / "repos"
    files = [("acs-sample-ac1032", repos / "ACadSharp" / "samples" / "sample_AC1032_ascii.dxf", ["Q-0002", "Q-0050"]),
             ("acs-sample-ac1009", repos / "ACadSharp" / "samples" / "sample_AC1009_ascii.dxf", ["Q-0050"]),
             ("acs-sample-ac1015-binary", repos / "ACadSharp" / "samples" / "sample_AC1015_binary.dxf", ["Q-0015", "Q-0050"])]
    ez = repos / "ezdxf" / "examples_dxf"
    if ez.is_dir():
        for p in sorted(ez.glob("*.dxf"))[:60]:
            nm = "ezdxf-" + "".join(ch if ch.isalnum() else "-" for ch in p.stem.lower()).strip("-")
            while "--" in nm:
                nm = nm.replace("--", "-")
            files.append((nm[:60].strip("-"), p, ["Q-0050"]))
    gd = repos / "gdal" / "autotest" / "ogr" / "data" / "dxf"
    if gd.is_dir():
        for p in sorted(gd.glob("*.dxf")):
            nm = "gdal-" + "".join(ch if ch.isalnum() else "-" for ch in p.stem.lower()).strip("-")
            while "--" in nm:
                nm = nm.replace("--", "-")
            files.append((nm[:60].strip("-"), p, ["Q-0050"]))
    for v in ("r12", "r14"):
        files.append((f"libredwg-leader-{v}", repos / "libredwg" / "test" / "test-data" / v / "Leader.dxf", ["Q-0075", "Q-0050"]))
    seen = set()
    for name, path, qs in files:
        if not path.is_file() or name in seen:
            continue
        seen.add(name)
        data = path.read_bytes()
        ver = "R2018"
        acadver = None
        k = data.find(b"$ACADVER")
        if k >= 0:
            m = re.search(rb"AC\d{4}", data[k:k + 64])
            acadver = m.group(0).decode() if m else None
            ver = {v: n for n, v in DXFVERSIONS.items()}.get(acadver, "R2018")
        c = s.case(f"corpus-{name}", f"Corpus file {path.relative_to(REPO_ROOT).as_posix()} opened as-is (third-party, local copy)", tags=["fileformat", "corpus"],
                   questions=qs, outputs=["png", "dxf"], dxfversion=ver)
        c.params["source"] = path.relative_to(REPO_ROOT).as_posix()
        c.params["acadver"] = acadver
        c.byte_filters.append(lambda d, data=data: data)
        c.allow_audit_errors = True
        c.plot_extents()
        if name.startswith("libredwg-leader"):
            # header bisection for 'Error 372 in drawing header' (Q-0075): drop one sixth of the
            # header variables (never $ACADVER/$HANDSEED) per case
            base = data.replace(b"\r\n", b"\n")
            t0 = Tags(base)
            hs, he = t0.section("HEADER")
            names = [t0.svalue(i) for i in t0.find_all(9, None, hs, he) if t0.svalue(i) not in ("$ACADVER", "$HANDSEED")]
            k = (len(names) + 5) // 6
            for part in range(6):
                drop = names[part * k:(part + 1) * k]
                if not drop:
                    continue
                cc = s.case(f"corpus-{name}-hdr-drop{part + 1}", f"{path.name} ({name}) without header variables {drop[0]}..{drop[-1]} ({len(drop)} vars; bisecting Error 372)",
                            tags=["fileformat", "corpus", "header"], questions=["Q-0075"], outputs=["png", "dxf"], dxfversion=ver)
                cc.params["dropped"] = drop

                def bis(_d, drop=tuple(drop), base=base):
                    t = Tags(base)
                    for nm in drop:
                        while t.find(9, nm) >= 0:  # duplicated header variables exist in the wild
                            i, j = t.header_var(nm)
                            t.remove(i, j)
                    return t.dumps(b"\r\n")
                cc.byte_filters.append(bis)
                cc.allow_audit_errors = True
                cc.plot_extents()
