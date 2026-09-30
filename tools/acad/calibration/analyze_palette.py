"""T-PL-5: ACI palette and true colours as plotted (cases calibration/palette-*).

    tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_palette.py [--dump]

Samples the centre pixel of every swatch and compares with the two candidate palettes of
research/notes/06 Appendix A ('light' = A.1, 'dark' = A.2). --dump prints the measured palette in
the Appendix format.
"""

from __future__ import annotations

import math
import re
import sys

from callib import REPO, Case


def note06_palettes() -> dict[str, list[str]]:
    text = (REPO / "research" / "notes" / "06-hatch-linetype-appearance.md").read_text(encoding="utf-8")
    out = {}
    for key, head in (("light", "### A.1"), ("dark", "### A.2")):
        sec = text[text.index(head) :]
        block = sec[sec.index("```") + 3 :]
        block = block[: block.index("```")]
        vals: list[str] = []
        for line in block.strip().splitlines():
            vals += re.findall(r"\b[0-9A-F]{6}\b", line.split(":", 1)[1])
        out[key] = vals
    return out


def sample(c: Case, x: float, y: float) -> str:
    col = math.floor(c.u(x))
    row = c.H - 1 - math.floor(c.v(y))
    r, g, b = (int(t) for t in c.rgb[row, col])
    return f"{r:02X}{g:02X}{b:02X}"


def paper_case(c: Case) -> tuple[list[dict], list[dict]]:
    return c.meta["params"]["cells"], c.meta["params"]["true_colors"]


def main() -> None:
    pals = note06_palettes()
    for name in ("palette-model", "palette-paper", "palette-mono"):
        c = Case(name)
        cells, tcs = paper_case(c)
        meas = {cell["aci"]: sample(c, *cell["center"]) for cell in cells}
        print(f"== {name} ({c.meta['plot']['styleTable']}, layout {c.meta['plot']['layout']})")
        for key, pal in pals.items():
            same = [a for a in range(1, 256) if meas[a] == pal[a]]
            diff = [a for a in range(1, 256) if meas[a] != pal[a]]
            print(f"  matches '{key}' palette: {len(same)}/255; differs at {diff[:20]}{' ...' if len(diff) > 20 else ''}")
        print("  ACI 7 ->", meas[7], "  ACI 250..255 ->", [meas[a] for a in range(250, 256)])
        tc = [(t["rgb"], sample(c, *t["center"])) for t in tcs]
        bad = [(f"{r:02X}{g:02X}{b:02X}", m) for (r, g, b), m in tc if f"{r:02X}{g:02X}{b:02X}" != m]
        print(f"  true colours exact: {len(tc) - len(bad)}/{len(tc)}; mismatches (want, got): {bad}")
        if "--dump" in sys.argv:
            for row in range(16):
                vals = " ".join(meas.get(a, "000000") if a > 0 else "000000" for a in range(row * 16, row * 16 + 16))
                print(f"  {row * 16:3d}: {vals}")
    # paper-space viewport showing model-space swatches (palette-paper): sample through the viewport
    c = Case("palette-paper")
    vp = c.meta["params"]["viewport"]
    scale = vp["size"][1] / vp["view_height"]
    ms = Case("palette-model").meta["params"]["cells"]
    diffs = []
    for cell in ms:
        mx, my = cell["center"]
        px = vp["center"][0] + (mx - vp["view_center"][0]) * scale
        py = vp["center"][1] + (my - vp["view_center"][1]) * scale
        got = sample(c, px, py)
        if got != pals["light"][cell["aci"]]:
            diffs.append((cell["aci"], got))
    print(f"== palette-paper viewport (model swatches seen through a VIEWPORT): {255 - len(diffs)}/255 match 'light'; diffs {diffs[:10]}")


if __name__ == "__main__":
    main()
