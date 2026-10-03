"""Write font-fidelity probes without overwriting any existing sample.

python tools/gen/write_font_resolution_probes.py --out .venv/fid-fonts/generated
Defaults to samples/generated. Repeated runs compare existing bytes without writing them.
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import sys


def main() -> None:
    if os.environ.get("PYTHONHASHSEED") != "0":
        env = dict(os.environ, PYTHONHASHSEED="0")
        raise SystemExit(subprocess.run([sys.executable, __file__, *sys.argv[1:]], env=env).returncode)

    from truedxf_gen.core import DEFAULT_OUT, build_suite, json_bytes
    from truedxf_gen import suites  # noqa: F401 (registers probes)

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--suite", choices=("font-resolution", "font-metrics"), default="font-resolution")
    args = ap.parse_args()
    output = args.out.resolve() / args.suite
    sb = build_suite(args.suite)
    files = {}
    for c in sb.cases:
        c.validate_meta()
        files[output / f"{c.name}.dxf"] = c.dxf_bytes()
        files[output / f"{c.name}.json"] = json_bytes(c.meta())

    # Check a second in-memory build before creating anything. No timestamps or random seeds.
    again = build_suite(args.suite)
    for c in again.cases:
        if files[output / f"{c.name}.dxf"] != c.dxf_bytes():
            raise SystemExit(f"Non-deterministic fixture: {c.id}")
        if files[output / f"{c.name}.json"] != json_bytes(c.meta()):
            raise SystemExit(f"Non-deterministic metadata: {c.id}")
    for path, data in files.items():
        if path.exists() and path.read_bytes() != data:
            raise SystemExit(f"Refusing to overwrite different bytes: {path}")
    output.mkdir(parents=True, exist_ok=True)
    for path, data in files.items():
        if not path.exists():
            with path.open("xb") as stream:
                stream.write(data)
        print(f"{hashlib.sha256(data).hexdigest()}  {path.name}")
    print(f"{len(sb.cases)} deterministic cases in {output}")


if __name__ == "__main__":
    main()
