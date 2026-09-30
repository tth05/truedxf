"""Helpers shared by the fileformat, misc and acad-default-fonts suites.

- :class:`Tags`: a tiny editable view of a serialised ASCII DXF (pairs of raw code/value lines),
  used by ``c.byte_filters`` to build deliberately varied or malformed files;
- :func:`base_drawing`: the small, clearly visible reference drawing most fileformat cases use;
- :func:`binary_dxf`: re-encode ASCII DXF bytes as binary DXF (1- or 2-byte group codes);
- :class:`ProxyGraphicBuilder`: proxy-graphics byte streams (ACAD_PROXY_ENTITY 92/160 + 310).
"""

from __future__ import annotations

import struct
from typing import Callable, Iterable, Optional, Sequence, Union

from ezdxf.lldxf.types import BINARY_DATA, BYTES, DOUBLE, INT16, INT32, INT64

Value = Union[str, bytes, int, float]


def _b(v: Value) -> bytes:
    if isinstance(v, bytes):
        return v
    if isinstance(v, float):
        return repr(v).encode("ascii")
    return str(v).encode("utf-8")


def code_line(code: int) -> bytes:
    return b"%3d" % code


class Tags:
    """Editable list of ``[code_line, value_line]`` pairs of an ASCII DXF (LF line ends, as ezdxf
    writes them). Untouched lines keep their exact bytes."""

    def __init__(self, data: bytes):
        lines = data.split(b"\n")
        if lines and lines[-1] == b"":
            lines.pop()
        if len(lines) % 2:
            raise ValueError("odd number of lines")
        self.pairs: list[list[bytes]] = [[lines[i], lines[i + 1]] for i in range(0, len(lines), 2)]

    # --- access ----------------------------------------------------------------------------
    def __len__(self) -> int:
        return len(self.pairs)

    def code(self, i: int) -> int:
        return int(self.pairs[i][0])

    def value(self, i: int) -> bytes:
        return self.pairs[i][1]

    def svalue(self, i: int) -> str:
        return self.pairs[i][1].decode("latin-1")

    def find(self, code: int, value: Optional[Value] = None, start: int = 0, stop: Optional[int] = None) -> int:
        stop = len(self.pairs) if stop is None else stop
        v = None if value is None else _b(value)
        for i in range(start, stop):
            if self.code(i) == code and (v is None or self.pairs[i][1] == v):
                return i
        return -1

    def find_all(self, code: int, value: Optional[Value] = None, start: int = 0, stop: Optional[int] = None) -> list[int]:
        out = []
        i = start
        while True:
            i = self.find(code, value, i, stop)
            if i < 0:
                return out
            out.append(i)
            i += 1

    def must(self, code: int, value: Optional[Value] = None, start: int = 0, stop: Optional[int] = None) -> int:
        i = self.find(code, value, start, stop)
        if i < 0:
            raise KeyError(f"tag ({code}, {value!r}) not found")
        return i

    def next0(self, i: int) -> int:
        """Index of the next code-0 tag after ``i``."""
        j = i + 1
        while j < len(self.pairs) and self.code(j) != 0:
            j += 1
        return j

    def section(self, name: str) -> tuple[int, int]:
        """(index of ``0 SECTION``, index of its ``0 ENDSEC``)."""
        for i in self.find_all(2, name):
            if i > 0 and self.code(i - 1) == 0 and self.value(i - 1) == b"SECTION":
                return i - 1, self.must(0, "ENDSEC", i)
        raise KeyError(f"section {name}")

    def table(self, name: str) -> tuple[int, int]:
        """(index of ``0 TABLE``, index of ``0 ENDTAB``)."""
        for i in self.find_all(2, name):
            if i > 0 and self.code(i - 1) == 0 and self.value(i - 1) == b"TABLE":
                return i - 1, self.must(0, "ENDTAB", i)
        raise KeyError(f"table {name}")

    def entity(self, handle: str) -> tuple[int, int]:
        """(start, end) of the object/entity with handle ``handle`` (5 or 105); end exclusive."""
        h = _b(handle)
        for i, (c, v) in enumerate(self.pairs):
            if v == h and c.strip() in (b"5", b"105"):
                s = i - 1
                while self.code(s) != 0:
                    s -= 1
                return s, self.next0(s)
        raise KeyError(f"handle {handle}")

    def entities(self, dxftype: str, start: int = 0, stop: Optional[int] = None) -> list[tuple[int, int]]:
        return [(i, self.next0(i)) for i in self.find_all(0, dxftype, start, stop)]

    def header_var(self, name: str) -> tuple[int, int]:
        """(index of ``9 $NAME``, end exclusive)."""
        i = self.must(9, name)
        j = i + 1
        while self.code(j) not in (0, 9):
            j += 1
        return i, j

    def in_range(self, code: int, start: int, stop: int, value: Optional[Value] = None) -> int:
        return self.must(code, value, start, stop)

    # --- edit ------------------------------------------------------------------------------
    def insert(self, i: int, tags: Iterable[tuple[int, Value]]) -> None:
        self.pairs[i:i] = [[code_line(c), _b(v)] for c, v in tags]

    def remove(self, i: int, j: Optional[int] = None) -> list[list[bytes]]:
        j = i + 1 if j is None else j
        removed = self.pairs[i:j]
        del self.pairs[i:j]
        return removed

    def set(self, i: int, value: Value) -> None:
        self.pairs[i][1] = _b(value)

    def set_code(self, i: int, code: Union[int, bytes]) -> None:
        self.pairs[i][0] = code if isinstance(code, bytes) else code_line(code)

    def replace_values(self, old: Value, new: Value, code: Optional[int] = None) -> int:
        o, n = _b(old), _b(new)
        k = 0
        for p in self.pairs:
            if p[1] == o and (code is None or int(p[0]) == code):
                p[1] = n
                k += 1
        return k

    def set_header(self, name: str, *values: tuple[int, Value]) -> None:
        """Replace (or append) header variable ``name`` with the given tags."""
        try:
            i, j = self.header_var(name)
            self.remove(i, j)
        except KeyError:
            s, e = self.section("HEADER")
            i = e
        self.insert(i, [(9, name), *values])

    def del_header(self, name: str) -> None:
        i, j = self.header_var(name)
        self.remove(i, j)

    def dumps(self, eol: bytes = b"\n") -> bytes:
        return b"".join(c + eol + v + eol for c, v in self.pairs)


def tagfilter(fn: Callable[[Tags], None]) -> Callable[[bytes], bytes]:
    def f(data: bytes) -> bytes:
        t = Tags(data)
        fn(t)
        return t.dumps()

    return f


def eol_filter(eol: bytes) -> Callable[[bytes], bytes]:
    return lambda data: data.replace(b"\n", eol)


def replace_bytes(old: bytes, new: bytes, count: int = -1) -> Callable[[bytes], bytes]:
    def f(data: bytes) -> bytes:
        if old not in data:
            raise ValueError(f"placeholder {old!r} not found")
        return data.replace(old, new, count)

    return f


# --------------------------------------------------------------------------------------------
# reference drawing


def base_drawing(c, label: str = "", layer: str = "0") -> dict[str, str]:
    """Frame + diagonals + circle + a TEXT label inside the 200x150 window; returns handles."""
    msp = c.msp
    a = {"layer": layer}
    h: dict[str, str] = {}
    pts = [(10, 10), (190, 10), (190, 140), (10, 140)]
    for i in range(4):
        e = msp.add_line(pts[i], pts[(i + 1) % 4], dxfattribs=a)
        h[f"frame{i}"] = e.dxf.handle
    h["line"] = msp.add_line((30, 30), (170, 120), dxfattribs=a).dxf.handle
    h["line2"] = msp.add_line((30, 120), (170, 30), dxfattribs=a).dxf.handle
    h["circle"] = msp.add_circle((100, 75), 30, dxfattribs=a).dxf.handle
    if label:
        h["text"] = msp.add_text(label, height=6, dxfattribs={**a, "insert": (15, 126)}).dxf.handle
    c.window((0, 0), (200, 150))
    return h


# --------------------------------------------------------------------------------------------
# binary DXF


def binary_dxf(data: bytes, one_byte_codes: bool, hex_as_text: bool = False) -> bytes:
    """Re-encode ASCII DXF ``data`` (as produced by ezdxf) as binary DXF.

    ``one_byte_codes``: R12-style 1-byte group codes (0xFF + int16 for codes >= 255) instead of
    R13+/R2000+ 2-byte codes. ``hex_as_text``: write 310-319/1004 as NUL-terminated hex strings
    instead of length-prefixed raw bytes (a malformation)."""
    t = Tags(data)
    out = bytearray(b"AutoCAD Binary DXF\r\n\x1a\x00")
    for i in range(len(t)):
        code = t.code(i)
        raw = t.value(i)
        if code == 999:
            continue
        if one_byte_codes:
            if code >= 255:
                out += b"\xff" + code.to_bytes(2, "little")
            else:
                out += code.to_bytes(1, "little")
        else:
            out += code.to_bytes(2, "little")
        s = raw.strip()
        if code in BINARY_DATA and not hex_as_text:
            b = bytes.fromhex(s.decode("ascii"))
            out += len(b).to_bytes(1, "little") + b
        elif code in BYTES:
            out += int(s).to_bytes(1, "little", signed=int(s) < 0)
        elif code in INT16:
            out += struct.pack("<h", int(s))
        elif code in INT32:
            out += struct.pack("<i", int(s))
        elif code in INT64:
            out += struct.pack("<q", int(s))
        elif code in DOUBLE:
            out += struct.pack("<d", float(s))
        else:
            out += raw + b"\x00"
    return bytes(out)


# --------------------------------------------------------------------------------------------
# proxy graphics (note 03 §3.17, ezdxf proxygraphic.py)


class ProxyGraphicBuilder:
    """Build a proxy-graphics byte stream: u32 total size, u32 command count, then commands
    ``u32 size (incl. 8-byte header), u32 type, payload``."""

    def __init__(self) -> None:
        self.cmds: list[bytes] = []

    def _cmd(self, type_: int, payload: bytes = b"") -> "ProxyGraphicBuilder":
        self.cmds.append(struct.pack("<2L", 8 + len(payload), type_) + payload)
        return self

    def circle(self, center: Sequence[float], radius: float, normal: Sequence[float] = (0, 0, 1)):
        return self._cmd(2, struct.pack("<3d", *center) + struct.pack("<d", radius) + struct.pack("<3d", *normal))

    def arc(self, center, radius, start_vec, sweep_rad, normal=(0, 0, 1), arc_type: int = 0):
        p = struct.pack("<3dd3d3dd", *center, radius, *normal, *start_vec, sweep_rad) + struct.pack("<L", arc_type)
        return self._cmd(4, p)

    def polyline(self, pts: Sequence[Sequence[float]]):
        p = struct.pack("<L", len(pts)) + b"".join(struct.pack("<3d", *(tuple(q) + (0.0,) * (3 - len(q)))) for q in pts)
        return self._cmd(6, p)

    def polygon(self, pts):
        p = struct.pack("<L", len(pts)) + b"".join(struct.pack("<3d", *(tuple(q) + (0.0,) * (3 - len(q)))) for q in pts)
        return self._cmd(7, p)

    def color(self, aci: int):
        return self._cmd(14, struct.pack("<L", aci & 0xFFFFFFFF))

    def raw_attr(self, type_: int, value: int):
        return self._cmd(type_, struct.pack("<L", value & 0xFFFFFFFF))

    def layer(self, index: int):
        return self._cmd(16, struct.pack("<L", index & 0xFFFFFFFF))

    def linetype(self, index: int):
        return self._cmd(18, struct.pack("<L", index & 0xFFFFFFFF))

    def name_attr(self, type_: int, name: str):
        """Name-based attribute (op 15 layer name / op 17 linetype name, as some sources claim):
        NUL-terminated string padded to 4 bytes."""
        b = name.encode("ascii") + b"\x00"
        b += b"\x00" * (-len(b) % 4)
        return self._cmd(type_, b)

    def fill(self, on: bool):
        return self._cmd(20, struct.pack("<L", 1 if on else 0))

    def lineweight(self, lw: int):
        return self._cmd(23, struct.pack("<L", lw & 0xFFFFFFFF))

    def push_matrix(self, m: Sequence[Sequence[float]]):
        """``m``: 4x4 row-major matrix with the translation in the last column."""
        vals = [float(v) for row in m for v in row]
        return self._cmd(29, struct.pack("<16d", *vals))

    def pop_matrix(self):
        return self._cmd(31)

    def data(self) -> bytes:
        body = b"".join(self.cmds)
        return struct.pack("<2L", 8 + len(body), len(self.cmds)) + body


def hex_chunks(data: bytes, size: int = 127) -> list[str]:
    return [data[i : i + size].hex().upper() for i in range(0, len(data), size)]


# --------------------------------------------------------------------------------------------
# deterministic ACIS export (ezdxf.acis.api.export_dxf stamps datetime.now() and a random GUID)


def export_acis(entity, bodies, uid: str = "{7D0E5A1C-0000-4000-8000-000000000001}") -> None:
    from datetime import datetime

    from ezdxf.acis import hdr, sab, sat

    header = hdr.AcisHeader()
    header.creation_date = datetime(2026, 1, 1, 12, 0, 0)
    if entity.doc.dxfversion < "AC1027":
        header.set_version(700)
        header.asm_end_marker = False
        ex = sat.SatExporter(header)
        for b in bodies:
            ex.export(b)
        entity.sat = ex.dump_sat()
    else:
        header.set_version(21800)
        header.asm_end_marker = True
        ex2 = sab.SabExporter(header)
        for b in bodies:
            ex2.export(b)
        entity.sab = ex2.dump_sab()
        entity.dxf.uid = uid
