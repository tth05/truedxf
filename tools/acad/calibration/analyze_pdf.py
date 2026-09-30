"""PDF reference properties (truedxf PDF.pc3): page size, device units, stroke widths per lineweight,
cap/join styles, curve representation (cases calibration/lineweights-2000x1500, pdf-curves).

    tools/gen/.venv/Scripts/python tools/acad/calibration/analyze_pdf.py
"""

from __future__ import annotations

import re

import pymupdf
from callib import Case


def main() -> None:
    c = Case("lineweights-2000x1500")
    page = pymupdf.open(str(c.pdf_path))[0]
    content = page.read_contents().decode("latin1")
    print("page (pt):", page.rect, " content transform:", re.search(r"([\d.]+ 0 0 [\d.]+ 0 0) cm", content).group(1))
    # 1 unit on the model = 7.2 pt at 10 px/unit on a 20 x 15 in sheet
    widths = {}
    for d in page.get_drawings():
        r = d["rect"]
        for it in c.meta["params"]["items"]:
            if abs((r.y0 + r.y1) / 2 - (c.ymax - it["hy"]) * 7.2) < 1.5 and r.x1 > 39 * 7.2 and r.height < 10:
                widths[it["lw"]] = (round(d["width"] * 600 / 72, 3), d["lineCap"], d["lineJoin"])
    print("lineweight -> stroke width in 1/600 in (round(mm*600/25.4)), caps, join:")
    for lw, (w, cap, join) in widths.items():
        nominal = lw * 600 / 2540 if lw >= 0 else 0.25 * 600 / 25.4
        print(f"  {lw:4d}  nominal {nominal:6.2f}  pdf {w:5.1f}  round-ok {round(nominal) == w}  cap {cap} join {join}")
    c = Case("pdf-curves")
    content = pymupdf.open(str(c.pdf_path))[0].read_contents().decode("latin1")
    print("pdf-curves operators:", {op: len(re.findall(rf" {op}\n", content)) for op in ("m", "l", "c", "S", "b", "f")})
    print("  circle/arc paths use 'c' (cubic Bezier); ellipse/spline are 'l' polylines with integer device coords")


if __name__ == "__main__":
    main()
