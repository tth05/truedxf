"""One bounded proxy-font selection batch; never overwrites existing samples.

Preserve gh109's valid opaque records. Change only its three tag font requests or
their text opcode. See note 04 §16 and note 07 §15.9 for why these controls are needed.
"""

import argparse
import hashlib
import json
import struct
from pathlib import Path

from proxy_followup_probes import dump, graphics, padded_unicode, pairs, replace_graphics
from proxy_probes import ROOT, SOURCE

SUITE = "proxy-font-selection"


def padded_ascii(value):
    data = (value + "\0").encode("ascii")
    return data + bytes((-len(data)) % 4)


def build(source, family="", font="", charset=134, pitch=2, bigfont="", opcode=38):
    tags = pairs(source)
    count = 0
    i = 0
    while i < len(tags):
        if tags[i][0] != 0 or tags[i][1].strip() != b"ACAD_PROXY_ENTITY":
            i += 1
            continue
        end = next(k for k in range(i + 1, len(tags)) if tags[k][0] == 0)
        length, stop, commands = graphics(tags, i, end)
        changed = []
        for op, data in commands:
            if op == 38:
                p = 72
                while data[p:p + 2] != b"\0\0":
                    p += 2
                fields = ((p + 2 + 3) // 4) * 4
                flags = fields + 8 + 32
                fonts = flags + 36
                expected = padded_unicode("宋体") + padded_unicode("") + padded_unicode("")
                if data[fonts:] == expected:
                    head = bytearray(data[:fonts])
                    struct.pack_into("<II", head, flags + 28, charset, pitch)
                    if opcode == 38:
                        data = bytes(head) + padded_unicode(family) + padded_unicode(font) + padded_unicode(bigfont)
                    else:
                        text = data[72:p].decode("utf-16le")
                        if opcode == 11:
                            data = data[:72] + padded_ascii(text) + bytes(head[fields:flags + 20])
                            data += padded_ascii(font) + padded_ascii(bigfont)
                        else:
                            encode = padded_unicode if opcode == 36 else padded_ascii
                            data = data[:72] + data[fields + 8:fields + 32] + encode(text)
                    op = opcode
                    count += 1
            changed.append((op, data))
        replace_graphics(tags, length, stop, changed)
        i = next(k for k in range(length + 1, len(tags)) if tags[k][0] == 0)
    assert count == 3
    return dump(tags)


def cases():
    out = [("song-control", {"family": "宋体"})]
    for charset in (0, 1, 134):
        out.append((f"arial-c{charset}", {"family": "Arial", "charset": charset}))
    for charset in (0, 134):
        for name, family, font in [
            ("empty", "", ""), ("simsun", "SimSun", ""),
            ("unknown", "TruedxfNoSuchFamily", ""), ("file-arial", "", "arial.ttf"),
            ("arial-file-txt", "Arial", "txt.shx"),
        ]:
            out.append((f"{name}-c{charset}", {"family": family, "font": font, "charset": charset}))
    out.extend([
        ("file-simsun-c134", {"font": "simsun.ttc"}),
        ("file-txt-c134", {"font": "txt.shx"}),
        ("missing-file-c134", {"font": "truedxf-probe-missing.shx"}),
        ("arial-p0", {"family": "Arial", "pitch": 0}),
        ("arial-p34", {"family": "Arial", "pitch": 34}),
    ])
    for name, family in [("arial", "Arial"), ("empty", "")]:
        for suffix, big in [("available", "gbcbig.shx"), ("missing", "truedxf-probe-missing-bigfont.shx")]:
            out.append((f"{name}-big-{suffix}", {"family": family, "bigfont": big}))
    for op in (10, 11, 36):
        out.append((f"opcode-{op}-empty", {"opcode": op}))
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "samples/generated" / SUITE)
    dest = parser.parse_args().out.resolve()
    source = SOURCE.read_bytes()
    built = [(name, params, build(source, **params)) for name, params in cases()]
    assert all(data == build(source, **params) for _, params, data in built)
    targets = [dest / f"{name}.{ext}" for name, *_ in built for ext in ("dxf", "json")]
    if any(p.exists() for p in targets):
        raise FileExistsError("proxy font fixtures exist; refusing to overwrite")
    dest.mkdir(parents=True, exist_ok=True)
    for name, params, data in built:
        meta = {
            "id": f"{SUITE}/{name}", "suite": SUITE,
            "title": f"Proxy font selection: {name}", "tags": ["proxy-fonts"],
            "questions": ["Q-0740"], "seed": None,
            "params": {"source": "corpus-proxy/gh109-floor-plan", "sourceSha256": hashlib.sha256(source).hexdigest(), **params},
            "dxfversion": "AC1027", "generator": "tools/gen/proxy_font_selection_probes.py",
            "plot": {"layout": "Model", "area": {"type": "window", "min": [15000, 6500], "max": [23000, 12500]},
                     "canvas": [2000, 1500], "styleTable": "acad.ctb", "lineweights": True, "scale": "fit"},
            "outputs": ["png", "pdf", "dxf"],
        }
        with (dest / f"{name}.dxf").open("xb") as f:
            f.write(data)
        with (dest / f"{name}.json").open("x", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f"{len(built)} deterministic cases written to {dest}")


if __name__ == "__main__":
    main()
