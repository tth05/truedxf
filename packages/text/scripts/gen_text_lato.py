"""Generates the `text-lato` fixture suite: TrueType text in Lato (a FONTS.md font that AutoCAD 2027
on the reference machine resolves, unlike Liberation Sans), for TTF-specific rules of
research/notes/04-text-fonts.md (fills, decorations, stacks, MTEXT metrics, missing glyphs).

    tools/gen/.venv/Scripts/python packages/text/scripts/gen_text_lato.py
    node tools/acad/src/run.ts --suite text-lato

Output: samples/generated/text-lato/<case>.{dxf,json} (docs/fixtures.md contract).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools" / "gen"))

from truedxf_gen.core import SuiteBuilder, build_suite, json_bytes, suite  # noqa: E402
from truedxf_gen.resources import TTF_FONTS  # noqa: E402
from truedxf_gen.suites._text_util import add_text, cross, ref_layer  # noqa: E402

LATO = TTF_FONTS["lato"]
W0, W1 = (0, 0), (200, 150)


def _case(s: SuiteBuilder, name: str, title: str, tags: list[str], **kw):
    c = s.case(name, title, tags=tags, standard_font=LATO, **kw)
    ref_layer(c)
    return c


def _mt(c, text: str, insert, h: float, attach: int = 1, width: float | None = None):
    d = {"insert": insert, "char_height": h, "attachment_point": attach, "style": "Standard"}
    if width is not None:
        d["width"] = width
    m = c.msp.add_mtext(text, dxfattribs=d)
    cross(c.msp, insert)
    return m


@suite("text-lato", "TrueType (Lato) TEXT/MTEXT rules: fills, decorations, stacks, attachment, fallback", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    for align in ("LEFT", "CENTER", "RIGHT", "MIDDLE", "MIDDLE_CENTER", "TOP_RIGHT", "BOTTOM_LEFT"):
        c = _case(s, f"text-align-{align.lower().replace('_', '-')}", f"TEXT 'HxgÅ' h=20 Lato {align} at (100,75)", ["TEXT", "alignment"])
        add_text(c.msp, "HxgÅ", (100, 75), align=align, h=20, font="lato")
        cross(c.msp, (100, 75))
        c.window(W0, W1)
    for name, text in (("underline", "%%uAB%%u CD"), ("overline", "%%oAB%%o CD"), ("strike", "%%kAB%%k CD")):
        c = _case(s, f"text-{name}", f"TEXT '{text}' h=30 Lato at (10,70): TTF decoration geometry", ["TEXT", "special-codes"])
        add_text(c.msp, text, (10, 70), h=30, font="lato")
        cross(c.msp, (10, 70))
        c.window(W0, W1)
    c = _case(s, "text-oblique-width", "TEXT 'I' h=40 Lato oblique 30 width 3 at (60,50): shear vs width order", ["TEXT", "oblique"])
    add_text(c.msp, "I", (60, 50), h=40, width=3.0, oblique=30.0, font="lato")
    cross(c.msp, (60, 50))
    c.window(W0, W1)
    c = _case(s, "text-large-o", "TEXT 'O8' h=100 Lato at (20,25): TTF curve tessellation", ["TEXT", "tessellation"])
    add_text(c.msp, "O8", (20, 25), h=100, font="lato")
    c.window(W0, W1)
    c = _case(s, "text-missing-glyph", "TEXT 'A\\U+5C42B' h=20 Lato: TTF per-glyph fallback font and scale", ["TEXT", "fallback"])
    add_text(c.msp, "A\\U+5C42B", (20, 75), h=20, font="lato")
    cross(c.msp, (20, 75))
    c.window(W0, W1)
    c = _case(s, "text-control", "TEXT 'A^BB' h=20 Lato: control character with a TTF", ["TEXT", "special-codes"])
    add_text(c.msp, "A^BB", (20, 75), h=20, font="lato")
    c.window(W0, W1)

    c = _case(s, "mtext-decorations", "MTEXT h=10 Lato '\\LAB\\l \\OCD\\o \\KEF\\k' at (20,100)", ["MTEXT", "decorations"])
    _mt(c, "\\LAB\\l \\OCD\\o \\KEF\\k", (20, 100), 10)
    c.window(W0, W1)
    c = _case(s, "mtext-stacks", "MTEXT h=10 Lato 'X\\S1/2;X\\S1#2;X\\S1^ 2;X' at (20,100)", ["MTEXT", "stack"])
    _mt(c, "X\\S1/2;X\\S1#2;X\\S1^ 2;X", (20, 100), 10)
    c.window(W0, W1)
    for a in (1, 5, 9):
        c = _case(s, f"mtext-attach-{a}", f"MTEXT h=10 Lato 'Xg\\PSOS' attachment {a} at (100,75)", ["MTEXT", "attachment"])
        _mt(c, "Xg\\PSOS", (100, 75), 10, attach=a)
        c.window(W0, W1)
    c = _case(s, "mtext-wrap", "MTEXT h=6 Lato 41=60 'The quick brown fox jumps over the lazy dog' at (20,120)", ["MTEXT", "wrap"])
    _mt(c, "The quick brown fox jumps over the lazy dog", (20, 120), 6, width=60)
    c.window(W0, W1)
    c = _case(s, "mtext-missing-glyph", "MTEXT h=10 Lato 'A\\U+5C42B' at (20,100): TTF fallback glyph", ["MTEXT", "fallback"])
    _mt(c, "A\\U+5C42B", (20, 100), 10)
    c.window(W0, W1)
    c = _case(s, "mtext-control", "MTEXT h=10 Lato 'a^Bb' at (20,100): control character box with a TTF", ["MTEXT", "special-codes"])
    _mt(c, "a^Bb", (20, 100), 10)
    c.window(W0, W1)
    c = _case(s, "mtext-bg", "MTEXT h=10 Lato 'Mask' background ACI 1 scale 1.5 over lines", ["MTEXT", "background"], style_table="acad.ctb")
    for y in range(40, 120, 10):
        c.msp.add_line((0, y), (200, y), dxfattribs={"layer": "REF"})
    m = _mt(c, "Mask", (60, 90), 10)
    m.set_bg_color(1, scale=1.5)
    c.window(W0, W1)


def main() -> None:
    os.environ.setdefault("PYTHONHASHSEED", "0")
    sb = build_suite("text-lato")
    out = ROOT / "samples" / "generated" / "text-lato"
    out.mkdir(parents=True, exist_ok=True)
    for c in sb.cases:
        c.validate_meta()
        (out / f"{c.name}.dxf").write_bytes(c.dxf_bytes())
        (out / f"{c.name}.json").write_bytes(json_bytes(c.meta()))
    print(f"text-lato: {len(sb.cases)} cases -> {out}")


if __name__ == "__main__":
    main()
