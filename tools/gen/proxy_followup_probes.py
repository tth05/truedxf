"""Second proxy fidelity batch; preserves valid gh109 opaque object records.

Run from the repo root. Refuses existing outputs; --out stages a new directory.
See note 07 §15.7 for the observations and questions behind these cases.
"""

import argparse
import hashlib
import json
import struct
from pathlib import Path

from proxy_probes import ROOT, SOURCE, command, missing_base_bigfont


SUITE = "fid-proxy-followup"


def pairs(source):
    lines = source.splitlines(keepends=True)
    return [(int(lines[i]), lines[i + 1]) for i in range(0, len(lines), 2)]


def entity_range(tags, handle):
    index = next(i for i, (c, v) in enumerate(tags) if c == 5 and v.strip() == handle.encode("ascii"))
    end = next(i for i in range(index + 1, len(tags)) if tags[i][0] == 0)
    return index, end


def graphics(tags, start, end):
    length = next(i for i in range(start, end) if tags[i][0] == 160)
    stop = length + 1
    while stop < end and tags[stop][0] == 310:
        stop += 1
    blob = bytes.fromhex(b"".join(v.strip() for _, v in tags[length + 1:stop]).decode("ascii"))
    result = []
    offset = 8
    while offset < len(blob):
        size, op = struct.unpack_from("<II", blob, offset)
        result.append((op, blob[offset + 8:offset + size]))
        offset += size
    assert offset == len(blob)
    return length, stop, result


def replace_graphics(tags, length, stop, commands):
    body = b"".join(command(op, data) for op, data in commands)
    blob = struct.pack("<II", len(body) + 8, len(commands)) + body
    tags[length:stop] = [(160, str(len(blob)).encode("ascii") + b"\r\n")] + [
        (310, blob[i:i + 127].hex().upper().encode("ascii") + b"\r\n")
        for i in range(0, len(blob), 127)
    ]


def dump(tags):
    return b"".join(str(c).rjust(3).encode("ascii") + b"\r\n" + v for c, v in tags)


def fill_case(source, primitive):
    tags = pairs(source)
    length, stop, cmds = graphics(tags, *entity_range(tags, "33F"))
    shell_index = next(i for i, (op, _) in enumerate(cmds) if op == 9)
    shell = cmds[shell_index][1]
    vertices = struct.unpack_from("<12d", shell, 4)
    polygon = struct.pack("<I12d", 4, *vertices)
    if primitive == "shell":
        first = (9, shell)
    elif primitive == "polygon":
        first = (7, polygon)
    else:
        # Use an explicit available font so base-style suppression cannot mask consumption.
        pos = (vertices[0], vertices[1] + 850, 0)
        data = struct.pack("<9d", *pos, 0, 0, 1, 1, 0, 0) + padded_unicode("AB")
        data += struct.pack("<ii4d9I", -1, 0, 264, 1, 0, 1, *([0] * 9))
        data += padded_unicode("") + padded_unicode("simplex.shx") + padded_unicode("")
        first = (38, data)
    moved = [v - 1600 if i % 3 == 0 else v for i, v in enumerate(vertices)]
    replace_graphics(tags, length, stop, cmds[:shell_index] + [first, (7, struct.pack("<I12d", 4, *moved))])
    return dump(tags)


def padded_unicode(value):
    data = (value + "\0").encode("utf-16le")
    return data + bytes((-len(data)) % 4)


def tag_case(source, family, filename):
    tags = pairs(source)
    # Change every tag with a typeface and empty filenames, leaving its text geometry intact.
    count = 0
    i = 0
    while i < len(tags):
        if tags[i][0] != 0 or tags[i][1].strip() != b"ACAD_PROXY_ENTITY":
            i += 1
            continue
        end = next(k for k in range(i + 1, len(tags)) if tags[k][0] == 0)
        length, stop, cmds = graphics(tags, i, end)
        changed = []
        for op, data in cmds:
            if op == 38:
                # Three vectors, padded UTF-16 text, two RL, four RD, nine RL, then font strings.
                pos = 72
                while data[pos:pos + 2] != b"\0\0":
                    pos += 2
                fonts = ((pos + 2 + 3) // 4) * 4 + 8 + 32 + 36
                expected = padded_unicode("宋体") + padded_unicode("") + padded_unicode("")
                if data[fonts:] == expected:
                    data = data[:fonts] + padded_unicode(family) + padded_unicode(filename) + padded_unicode("")
                    count += 1
            changed.append((op, data))
        replace_graphics(tags, length, stop, changed)
        i = next(k for k in range(length + 1, len(tags)) if tags[k][0] == 0)
    assert count == 3
    return dump(tags)


def mixed_inline(source, missing):
    data = missing_base_bigfont(source) if missing else source.replace(b"hztxt.shx", b"")
    tags = pairs(data)
    start, end = entity_range(tags, "9AE")
    text = next(i for i in range(start, end) if tags[i][0] == 1)
    tags[text] = (1, b"AB{\\Fsimplex.shx;CD}EF\r\n")
    return dump(tags)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "samples/generated" / SUITE)
    dest = parser.parse_args().out.resolve()
    source = SOURCE.read_bytes()
    fill_window = ([21000, 7000], [25000, 10000])
    tag_window = ([15000, 6500], [23000, 12500])
    cases = []
    for primitive in ("shell", "polygon", "text"):
        cases.append(("fill-after-" + primitive, fill_case(source, primitive), fill_window, "Q-0739"))
    for name, family, filename in [
        ("tag-empty-family", "", ""),
        ("tag-family-arial", "Arial", ""),
        ("tag-file-simplex", "宋体", "simplex.shx"),
        ("tag-file-simsun", "宋体", "simsun.ttc"),
        ("tag-file-arial", "Arial", "arial.ttf"),
    ]:
        cases.append((name, tag_case(source, family, filename), tag_window, "Q-0759"))
    for missing in (True, False):
        name = "inline-mixed-" + ("missing-base" if missing else "control")
        cases.append((name, mixed_inline(source, missing), ([10500, 4000], [14500, 7000]), "Q-0738"))
    for name, low, high, half_pixel in [
        ("wall-stair-halfpixel", [-500, 7000], [4500, 10750], 1.25),
        ("stair-hatch-halfpixel", [-200, 0], [3400, 2700], 0.9),
    ]:
        window = ([v + half_pixel for v in low], [v + half_pixel for v in high])
        cases.append((name, source, window, "Q-0758"))
    targets = [dest / f"{name}.{ext}" for name, *_ in cases for ext in ("dxf", "json")]
    if any(p.exists() for p in targets):
        raise FileExistsError("follow-up fixtures already exist; refusing to overwrite")
    dest.mkdir(parents=True, exist_ok=True)
    for name, data, (low, high), question in cases:
        meta = {
            "id": f"{SUITE}/{name}", "suite": SUITE, "title": f"gh109 proxy follow-up: {name}",
            "tags": ["proxy-fidelity"], "questions": [question], "seed": None,
            "params": {"source": "corpus-proxy/gh109-floor-plan", "sourceSha256": hashlib.sha256(source).hexdigest()},
            "dxfversion": "AC1027", "generator": "tools/gen/proxy_followup_probes.py",
            "plot": {"layout": "Model", "area": {"type": "window", "min": low, "max": high},
                     "canvas": [2000, 1500], "styleTable": "acad.ctb", "lineweights": True, "scale": "fit"},
            "outputs": ["png", "pdf"],
        }
        with (dest / f"{name}.dxf").open("xb") as f:
            f.write(data)
        with (dest / f"{name}.json").open("x", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
            f.write("\n")
    print(f"Wrote {len(cases)} NEW cases under {dest}")


if __name__ == "__main__":
    main()
