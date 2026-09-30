"""Shared helpers for the `dimensions` and `leaders` suites (note 05, note 02 §2.6).

Every case starts from the ``Standard`` DIMSTYLE with ISO-25-like values scaled by 1.6 so that
dimension text is ~4 units high (40 px at 10 px/unit). The header ``$DIM*`` variables are synced
to the same values (unless a case tests header vs DIMSTYLE on purpose), and ``$DIMSTYLE`` names
the style that exists (ezdxf's default header says ``ISO-25``, which is not defined with
``setup=False``).
"""

from __future__ import annotations

from typing import Any, Callable, Iterable, Optional

# ISO-25 (as AutoCAD writes it, note 05 §2.1) with all sizes x1.6 and '.' as decimal separator.
BASE_DIMSTYLE: dict[str, Any] = {
    "dimscale": 1.0,
    "dimtxt": 4.0,
    "dimasz": 4.0,
    "dimexo": 1.0,
    "dimexe": 2.0,
    "dimgap": 1.0,
    "dimcen": 4.0,
    "dimdli": 6.0,
    "dimtad": 1,
    "dimtih": 0,
    "dimtoh": 0,
    "dimtofl": 1,
    "dimzin": 8,
    "dimtzin": 8,
    "dimdec": 2,
    "dimtdec": 2,
    "dimadec": 0,
    "dimazin": 0,
    "dimdsep": 46,
    "dimaltd": 3,
    "dimalttd": 3,
    "dimaltf": 0.03937007874,
    "dimtolj": 0,
    "dimatfit": 3,
    "dimtmove": 0,
    "dimlfac": 1.0,
}

# DIMSTYLE attribs that exist as header variables with the same name ($DIM + upper case)
# not synced: header unit differs ($DIMJOGANG radians) or header holds names instead of handles
_NO_HEADER_SYNC = {"dimjogang", "dimblk", "dimblk1", "dimblk2", "dimldrblk", "dimtxsty", "dimltype", "dimltex1", "dimltex2"}


def setup_dimstyle(
    c,
    name: str = "Standard",
    values: Optional[dict[str, Any]] = None,
    base: bool = True,
    sync_header: bool = True,
    text_style: Optional[str] = "Standard",
):
    """Configure (or create) DIMSTYLE `name` with BASE_DIMSTYLE + `values`; returns the entry."""
    doc = c.doc
    if name in doc.dimstyles:
        ds = doc.dimstyles.get(name)
    else:
        ds = doc.dimstyles.new(name)
    vals: dict[str, Any] = dict(BASE_DIMSTYLE) if base else {}
    vals.update(values or {})
    for k, v in vals.items():
        ds.dxf.set(k, v)
    if text_style and doc.dxfversion > "AC1009":
        ds.dxf.dimtxsty = text_style
    if sync_header:
        for k, v in vals.items():
            if k in _NO_HEADER_SYNC:
                continue
            hk = "$" + k.upper()
            try:
                doc.header[hk] = v
            except Exception:  # pragma: no cover - var unknown to this DXF version
                pass
        doc.header["$DIMSTYLE"] = name
        if text_style:
            doc.header["$DIMTXSTY"] = text_style
    return ds


def finish(dso, mode: str) -> None:
    """Complete a DimStyleOverride.

    mode "ez": ezdxf renders the *D geometry block (AutoCAD shows it as-is).
    mode "nb": no geometry block, no text midpoint (only the definition data + DSTYLE XDATA);
               AutoCAD has to regenerate the dimension on load.
    mode "nb11": no geometry block, but with ezdxf's text midpoint (11) and measurement (42)
                 (render(discard=True)).
    """
    if mode == "ez":
        dso.render()
    elif mode == "nb":
        dso.commit()
    elif mode == "nb11":
        dso.render(discard=True)
    else:  # pragma: no cover
        raise ValueError(mode)


MODE_TITLE = {
    "ez": "ezdxf-rendered *D block",
    "nb": "no *D block, AutoCAD regenerates",
    "nb11": "no *D block but ezdxf text midpoint 11/42",
}


# --------------------------------------------------------------------------------------------
# byte filters (serialised DXF is ASCII; latin-1 round trip is byte transparent)


def _pairs(lines: list[str]) -> list[tuple[str, str]]:
    return [(lines[i], lines[i + 1]) for i in range(0, len(lines) - 1, 2)]


def strip_table_record_codes(
    rtype: str, name: str, keep: Iterable[int], keep_first_70: bool = True
) -> Callable[[bytes], bytes]:
    """Return a byte filter that removes every group code of the `rtype` table record (or
    object) named `name` except those in `keep` (0/5/105/330/100/2 are always kept; only the first
    70 = the table flags is kept when keep_first_70 and 70 is not in `keep`)."""
    keep_set = set(keep) | {0, 5, 105, 330, 100, 2, 3}

    def f(data: bytes) -> bytes:
        text = data.decode("latin-1")
        nl = "\r\n" if "\r\n" in text[:200] else "\n"
        lines = text.split(nl)
        tail = []
        if len(lines) % 2:
            tail = [lines[-1]]
            lines = lines[:-1]
        pairs = _pairs(lines)
        out: list[tuple[str, str]] = []
        i = 0
        while i < len(pairs):
            code, value = pairs[i]
            if code.strip() == "0" and value == rtype:
                j = i + 1
                while j < len(pairs) and pairs[j][0].strip() != "0":
                    j += 1
                rec = pairs[i:j]
                if any(cd.strip() == "2" and v == name for cd, v in rec):
                    seen70 = False
                    kept = []
                    for cd, v in rec:
                        k = int(cd)
                        if k == 70 and 70 not in keep:
                            if keep_first_70 and not seen70:
                                kept.append((cd, v))
                            seen70 = True
                            continue
                        if k in keep_set:
                            kept.append((cd, v))
                    rec = kept
                out.extend(rec)
                i = j
                continue
            out.append((code, value))
            i += 1
        flat = [x for p in out for x in p] + tail
        return nl.join(flat).encode("latin-1")

    return f


def strip_entity_codes(
    etype: str, handle: str, drop: Iterable[int], subclass: Optional[str] = None
) -> Callable[[bytes], bytes]:
    """Byte filter: drop group codes `drop` from the entity `etype` with handle `handle`
    (optionally only after the subclass marker `subclass`)."""
    drop_set = set(drop)

    def f(data: bytes) -> bytes:
        text = data.decode("latin-1")
        nl = "\r\n" if "\r\n" in text[:200] else "\n"
        lines = text.split(nl)
        tail = []
        if len(lines) % 2:
            tail = [lines[-1]]
            lines = lines[:-1]
        pairs = _pairs(lines)
        out: list[tuple[str, str]] = []
        i = 0
        while i < len(pairs):
            code, value = pairs[i]
            if code.strip() == "0" and value == etype:
                j = i + 1
                while j < len(pairs) and pairs[j][0].strip() != "0":
                    j += 1
                rec = pairs[i:j]
                if any(cd.strip() == "5" and v == handle for cd, v in rec):
                    active = subclass is None
                    kept = []
                    for cd, v in rec:
                        k = int(cd)
                        if k == 100 and subclass is not None:
                            active = v == subclass
                        if active and k in drop_set:
                            continue
                        kept.append((cd, v))
                    rec = kept
                out.extend(rec)
                i = j
                continue
            out.append((code, value))
            i += 1
        flat = [x for p in out for x in p] + tail
        return nl.join(flat).encode("latin-1")

    return f


def keep_object_codes(otype: str, handle: str, keep: Iterable[int]) -> Callable[[bytes], bytes]:
    """Byte filter: in the object/entity `otype` with handle `handle` (group 5), keep only the
    group codes in `keep` (plus 0/5/102/330/100 and everything inside 102 {...} groups)."""
    keep_set = set(keep) | {0, 5, 330, 100}

    def f(data: bytes) -> bytes:
        text = data.decode("latin-1")
        nl = "\r\n" if "\r\n" in text[:200] else "\n"
        lines = text.split(nl)
        tail = []
        if len(lines) % 2:
            tail = [lines[-1]]
            lines = lines[:-1]
        pairs = _pairs(lines)
        out: list[tuple[str, str]] = []
        i = 0
        while i < len(pairs):
            code, value = pairs[i]
            if code.strip() == "0" and value == otype:
                j = i + 1
                while j < len(pairs) and pairs[j][0].strip() != "0":
                    j += 1
                rec = pairs[i:j]
                if any(cd.strip() == "5" and v == handle for cd, v in rec):
                    kept = []
                    in_group = False
                    for cd, v in rec:
                        k = int(cd)
                        if k == 102:
                            in_group = v.startswith("{")
                            kept.append((cd, v))
                            continue
                        if in_group or k in keep_set:
                            kept.append((cd, v))
                    rec = kept
                out.extend(rec)
                i = j
                continue
            out.append((code, value))
            i += 1
        flat = [x for p in out for x in p] + tail
        return nl.join(flat).encode("latin-1")

    return f
