"""Small plot windows and fill probes using the valid gh109 proxy records.

Run from the repository root: python tools/gen/proxy_probes.py
Writes a NEW local suite only; refuses to replace any existing sample. Opaque
TArch entity data, classes, tables and object references stay byte-for-byte intact.
See research/notes/07-blocks-inserts-misc.md §15.6 and docs/fixtures.md.
"""

import hashlib
import argparse
import json
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "samples/generated/corpus-proxy/gh109-floor-plan.dxf"
DEST = ROOT / "samples/generated/fid-proxy-probes"
SUITE = "fid-proxy-probes"


def command(op, payload):
    return struct.pack("<II", len(payload) + 8, op) + payload


def fill_probe(source, explicit_fill):
    """Replace only 33F's graphics; retain its valid custom-object serialization."""
    lines = source.splitlines(keepends=True)
    pairs = [(int(lines[i]), lines[i + 1]) for i in range(0, len(lines), 2)]
    start = next(i for i, (c, v) in enumerate(pairs) if c == 5 and v.strip() == b"33F")
    length = next(i for i in range(start, len(pairs)) if pairs[i][0] == 160)
    end = length + 1
    while pairs[end][0] == 310:
        end += 1
    original = bytes.fromhex(b"".join(v.strip() for _, v in pairs[length + 1:end]).decode("ascii"))
    prefix = []
    offset = 8
    while offset < len(original):
        size, op = struct.unpack_from("<II", original, offset)
        data = original[offset:offset + size]
        if op == 9:
            count = struct.unpack_from("<I", data, 8)[0]
            assert count == 4
            vertices = list(struct.unpack_from("<12d", data, 12))
            break
        prefix.append(data)
        offset += size
    else:
        raise ValueError("33F has no SHELL")
    # FILLON precedes this outline; POLYLINE itself must remain unfilled. The
    # following POLYGON distinguishes consumption from persistent fill state.
    outline = vertices + vertices[:3]
    prefix.append(command(6, struct.pack("<I15d", 5, *outline)))
    if explicit_fill:
        prefix.append(command(20, struct.pack("<I", 1)))
    moved = [v - 1600 if i % 3 == 0 else v for i, v in enumerate(vertices)]
    prefix.append(command(7, struct.pack("<I12d", 4, *moved)))
    body = b"".join(prefix)
    blob = struct.pack("<II", len(body) + 8, len(prefix)) + body
    tags = [(160, str(len(blob)).encode("ascii") + b"\r\n")]
    for i in range(0, len(blob), 127):
        tags.append((310, blob[i:i + 127].hex().upper().encode("ascii") + b"\r\n"))
    replacement = b"".join(str(c).rjust(3).encode("ascii") + b"\r\n" + v for c, v in tags)
    return b"".join(lines[:length * 2]) + replacement + b"".join(lines[end * 2:])


def missing_base_bigfont(source):
    """Keep existing valid inline font overrides, but force a missing base bigfont."""
    old = b"hztxt.shx"
    assert source.count(old) == 1
    return source.replace(old, b"truedxf-probe-missing-bigfont.shx")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEST, help="New suite directory (never overwritten)")
    dest = parser.parse_args().out.resolve()
    source = SOURCE.read_bytes()
    # Width/height of each world window is 4/3, matching the paper exactly.
    cases = [
        ("wall-stair", [-500, 7000], [4500, 10750], source, {}, ["Q-0758"]),
        ("tags", [15000, 6500], [23000, 12500], source, {}, ["Q-0759"]),
        ("columns-room", [7000, 3500], [14000, 8750], source, {}, ["Q-0738"]),
        ("axis-one", [-800, -6600], [1200, -5100], source, {}, ["Q-0759"]),
        ("stair-hatch", [-200, 0], [3400, 2700], source, {}, ["Q-0758"]),
        ("shell-fillmode-zero", [7000, 3500], [14000, 8750], source, {"FILLMODE": 0}, ["Q-0739"]),
        ("fill-consumption", [21000, 7000], [25000, 10000], fill_probe(source, False), {}, ["Q-0739"]),
        ("fill-explicit-control", [21000, 7000], [25000, 10000], fill_probe(source, True), {}, ["Q-0739"]),
        ("inline-missing-base-bigfont", [10500, 4200], [13500, 6450], missing_base_bigfont(source), {}, ["Q-0738"]),
    ]
    paths = [dest / f"{name}.{ext}" for name, *_ in cases for ext in ("dxf", "json")]
    if any(p.exists() for p in paths):
        raise FileExistsError("probe samples already exist; refusing to overwrite")
    dest.mkdir(parents=True, exist_ok=True)
    for name, low, high, data, sysvars, questions in cases:
        meta = {
            "id": f"{SUITE}/{name}", "suite": SUITE,
            "title": f"gh109 proxy fidelity probe: {name}",
            "tags": ["ACAD_PROXY_ENTITY", "proxy-fidelity"],
            "questions": questions, "seed": None,
            "params": {"source": "corpus-proxy/gh109-floor-plan", "sourceSha256": hashlib.sha256(source).hexdigest()},
            "dxfversion": "AC1027", "generator": "tools/gen/proxy_probes.py / lossless corpus copy",
            "plot": {"layout": "Model", "area": {"type": "window", "min": low, "max": high},
                     "canvas": [2000, 1500], "styleTable": "acad.ctb", "lineweights": True,
                     "scale": "fit", "sysvars": sysvars},
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
