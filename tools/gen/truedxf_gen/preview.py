"""Quick visual sanity check of generated cases with ezdxf's drawing add-on (NOT a reference).

    python -m truedxf_gen.preview samples/generated/polylines/width-*.json --out sheet.png

Renders each case's model-space plot window (or extents) into a contact sheet so that a human or
agent can check that the feature is visible and well placed in the window.
"""

from __future__ import annotations

import argparse
import glob
import json
import math
from pathlib import Path

import ezdxf
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from ezdxf.addons.drawing import Frontend, RenderContext  # noqa: E402
from ezdxf.addons.drawing.config import BackgroundPolicy, ColorPolicy, Configuration  # noqa: E402
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend  # noqa: E402


def render_sheet(metas: list[Path], out: Path, cols: int = 4, cell: float = 3.2) -> None:
    rows = math.ceil(len(metas) / cols)
    fig = plt.figure(figsize=(cols * cell, rows * cell * 0.8), dpi=100)
    for i, mpath in enumerate(metas):
        meta = json.loads(mpath.read_text(encoding="utf-8"))
        doc = ezdxf.readfile(str(mpath.with_suffix(".dxf")))
        ax = fig.add_subplot(rows, cols, i + 1)
        ax.set_title(meta["id"].split("/", 1)[1], fontsize=6)
        ax.set_xticks([])
        ax.set_yticks([])
        layout = doc.modelspace() if meta["plot"]["layout"] == "Model" else doc.paperspace(meta["plot"]["layout"])
        cfg = Configuration(background_policy=BackgroundPolicy.WHITE, color_policy=ColorPolicy.COLOR)
        try:
            Frontend(RenderContext(doc), MatplotlibBackend(ax), config=cfg).draw_layout(layout, finalize=True)
        except Exception as e:  # pragma: no cover - preview only
            ax.text(0.5, 0.5, f"render error\n{e}", fontsize=5, ha="center", transform=ax.transAxes)
        area = meta["plot"]["area"]
        if area["type"] == "window":
            ax.set_xlim(area["min"][0], area["max"][0])
            ax.set_ylim(area["min"][1], area["max"][1])
        ax.set_aspect("equal", adjustable="box")
    fig.tight_layout()
    fig.savefig(out)
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("metas", nargs="+", help="case .json files (globs allowed)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--cols", type=int, default=4)
    args = ap.parse_args()
    files: list[Path] = []
    for m in args.metas:
        files += [Path(p) for p in sorted(glob.glob(m))]
    render_sheet(files[:64], args.out, args.cols)
    print(f"{len(files[:64])} cases -> {args.out}")


if __name__ == "__main__":
    main()
