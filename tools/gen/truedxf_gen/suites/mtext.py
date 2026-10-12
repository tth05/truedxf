"""MTEXT: attachment points, word wrap, line spacing, inline codes, stacking, paragraph codes,
tabs, columns, background mask/text frame, rotation, chunking and encoding (note 04 §3; 11a §9).

TTF fonts only (resources.TTF_FONTS; \\f codes use the family name). Text is large: cap height
5-10 units at 10 px/unit (200 x 150 window) unless a case needs another scale. Reference marks on
layer REF (hairline): a cross at the insertion point, baseline ticks left of the text at the
positions the 5/3 pitch model predicts (note 04 §3.6.1), vertical lines at the reference-width
edges.

Wrap-boundary widths below were computed from LiberationSans-Regular.ttf advances (cap basis =
yMax of "A" = 1409 units) and are hardcoded so the generator does not read font files.
"""

from __future__ import annotations

import math
from typing import Callable, Optional, Sequence

from ezdxf.tools.text import split_mtext_string

from ..core import SuiteBuilder, suite
from ..resources import TTF_FONTS

PITCH = 5.0 / 3.0

# Liberation Sans advances at h = 8 (cap basis 1409/2048 em)
WRAP_TEXT = "a-b_c  word  wrap example"
WRAP_ADV_8 = {"a-b_c": 29.087, "a-b_c  word": 60.752, "a-b_c  word  wrap": 92.417, "all": 139.6}

LOREM = (
    "Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor "
    "invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et "
    "accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata "
    "sanctus est Lorem ipsum dolor sit amet."
)

FAMILY = {
    "sans": "Liberation Sans",
    "lato": "Lato",
    "mono": "Cascadia Mono",
}


# --------------------------------------------------------------------------------------------
# helpers


def _ref(c) -> str:
    return c.layer("REF", color=1, lineweight=0)


def _cross(c, p, s: float = 3.0) -> None:
    lay = _ref(c)
    x, y = p[0], p[1]
    c.msp.add_line((x - s, y), (x + s, y), dxfattribs={"layer": lay})
    c.msp.add_line((x, y - s), (x, y + s), dxfattribs={"layer": lay})


def _tick(c, x: float, y: float, length: float = 5.0) -> None:
    """Short horizontal tick ending at x (left of the text) at height y."""
    c.msp.add_line((x - length, y), (x - 1.0, y), dxfattribs={"layer": _ref(c)})


def _vline(c, x: float, y0: float, y1: float) -> None:
    c.msp.add_line((x, y0), (x, y1), dxfattribs={"layer": _ref(c)})


def _baseline_ticks(c, x: float, top: float, h: float, n: int, f: float = 1.0) -> None:
    """Ticks at the baselines the 5/3 x h x f model predicts for attachment 1 at y = top."""
    for i in range(n):
        _tick(c, x, top - h - i * PITCH * h * f)


def _mt(
    c,
    text: str,
    insert: Sequence[float] = (20, 120),
    h: float = 8.0,
    width: Optional[float] = None,
    attach: int = 1,
    style: Optional[str] = None,
    cross: bool = True,
    **attribs,
):
    dx = {"insert": (insert[0], insert[1]), "char_height": h, "attachment_point": attach}
    if width is not None:
        dx["width"] = width
    if style is not None:
        dx["style"] = style
    dx.update(attribs)
    m = c.msp.add_mtext(text, dxfattribs=dx)
    if cross:
        _cross(c, insert)
    return m


def _tags(pairs: Sequence[tuple[int, str]]) -> bytes:
    return "".join(f"{code:>3}\n{val}\n" for code, val in pairs).encode("ascii")


def _insert_after(needle: bytes, extra: bytes, before: bool = False) -> Callable[[bytes], bytes]:
    """Byte filter: insert raw tags after (or before) a unique byte sequence."""

    def f(data: bytes) -> bytes:
        if data.count(needle) != 1:
            raise AssertionError(f"needle {needle!r} found {data.count(needle)} times")
        return data.replace(needle, extra + needle if before else needle + extra)

    return f


def _after_content(text: str, pairs: Sequence[tuple[int, str]]) -> Callable[[bytes], bytes]:
    """Insert tags right after the MTEXT group 1 whose value is `text` (ASCII)."""
    return _insert_after(f"  1\n{text}\n".encode("ascii"), _tags(pairs))


def _check_chunk(content: str, first_chunk_end: str) -> None:
    chunks = split_mtext_string(content, 250)
    if not chunks[0].endswith(first_chunk_end):
        raise AssertionError(f"chunk 0 ends with {chunks[0][-12:]!r}, want {first_chunk_end!r}")


def _pad(n: int) -> str:
    """n characters of plain words (deterministic filler)."""
    words = (LOREM + " ") * 4
    return words[:n]


@suite(
    "mtext",
    "MTEXT: attachment, wrapping, spacing, inline codes, stacks, paragraphs, columns, masks",
    layer0_lineweight=0,
)
def build(s: SuiteBuilder) -> None:
    _attachment(s)
    _wrapping(s)
    _spacing(s)
    _inline(s)
    _stacks(s)
    _paragraphs(s)
    _columns(s)
    _background(s)
    _rotation(s)
    _heights(s)
    _chunks(s)
    _encoding(s)
    _random(s)


# --------------------------------------------------------------------------------------------
# attachment points


ATTACH_NAMES = {1: "TL", 2: "TC", 3: "TR", 4: "ML", 5: "MC", 6: "MR", 7: "BL", 8: "BC", 9: "BR"}


def _attachment(s: SuiteBuilder) -> None:
    qs = ["Q-0448", "Q-0449"]
    for a in range(1, 10):
        c = s.case(f"attach-{a}-xg", f"MTEXT 'Xg' h=10, attachment 71={a} ({ATTACH_NAMES[a]}), 41=0; cross at 10", tags=["MTEXT", "attachment"], questions=qs, params={"attach": a, "text": "Xg", "width": 0})
        _mt(c, "Xg", insert=(100, 75), h=10, attach=a, cross=False)
        _cross(c, (100, 75), 40)
        c.window((0, 0), (200, 150))
    for a in range(1, 10):
        c = s.case(f"attach-{a}-two-lines", f"MTEXT 'A\\PAAAA' h=10, attachment {a} ({ATTACH_NAMES[a]}), 41=0 (longest line sets the frame)", tags=["MTEXT", "attachment"], questions=qs, params={"attach": a, "text": "A\\PAAAA", "width": 0})
        _mt(c, "A\\PAAAA", insert=(100, 75), h=10, attach=a, cross=False)
        _cross(c, (100, 75), 40)
        c.window((0, 0), (200, 150))
    for a in range(1, 10):
        w = 120.0
        c = s.case(f"attach-{a}-two-lines-w120", f"MTEXT 'A\\PAAAA' h=10, attachment {a} ({ATTACH_NAMES[a]}), 41=120; lines at the possible frame edges", tags=["MTEXT", "attachment", "width"], questions=qs, params={"attach": a, "text": "A\\PAAAA", "width": w})
        col = (a - 1) % 3  # 0 left, 1 center, 2 right
        x = (40.0, 100.0, 160.0)[col]  # keeps the [0, 41] box inside the window
        _mt(c, "A\\PAAAA", insert=(x, 75), h=10, attach=a, width=w, cross=False)
        _cross(c, (x, 75), 40)
        left = x - (0, w / 2, w)[col]
        for x in (left, left + w):
            _vline(c, x, 20, 130)
        c.window((0, 0), (200, 150))
    for name, text in (("three-lines", "Xg\\PXg\\PXg"), ("digits", "111"), ("descenders", "gjpq"), ("x-height", "xxx")):
        c = s.case(f"attach-grid-{name}", f"3x3 grid: MTEXT '{text}' h=6 at attachments 1-9 (row = top/middle/bottom), crosses at 10", tags=["MTEXT", "attachment"], questions=qs, params={"text": text})
        for a in range(1, 10):
            col, row = (a - 1) % 3, (a - 1) // 3
            p = (35 + 65 * col, 125 - 50 * row)
            _mt(c, text, insert=p, h=8, attach=a, cross=False)
            _cross(c, p, 6)
        c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# word wrap, explicit breaks, whitespace


def _wrap_case(c, text: str, width: float, h: float = 8.0, x: float = 20.0, top: float = 130.0) -> None:
    _mt(c, text, insert=(x, top), h=h, width=width)
    if width > 0:
        _vline(c, x + width, top - 115, top + 5)


def _wrapping(s: SuiteBuilder) -> None:
    fox = "The quick brown fox jumps over the lazy dog"
    for i, w in enumerate([0.0, 30.0, 50.0, 75.0, 110.0, 160.0], 1):
        c = s.case(f"wrap-width-{i:04d}", f"MTEXT '{fox}' h=8 with reference width 41={w} (0 = no wrap)", tags=["MTEXT", "wrap"], questions=["Q-0439"], params={"width": w})
        _wrap_case(c, fox, w)
        c.window((0, 0), (200, 150))
    # 41 just below/above the advance of 'a-b_c', 'a-b_c  word', 'a-b_c  word  wrap'
    widths = [
        ("hyphen-below", 20.0),
        ("word1-below", WRAP_ADV_8["a-b_c  word"] - 0.8),
        ("word1-above", WRAP_ADV_8["a-b_c  word"] + 0.8),
        ("word2-below", WRAP_ADV_8["a-b_c  word  wrap"] - 0.8),
        ("word2-above", WRAP_ADV_8["a-b_c  word  wrap"] + 0.8),
        ("all-above", WRAP_ADV_8["all"] + 0.8),
    ]
    for name, w in widths:
        w = round(w, 3)
        c = s.case(f"wrap-boundary-{name}", f"MTEXT '{WRAP_TEXT}' h=8, 41={w} (Liberation Sans advance boundary; '-'/'_' no break, double spaces)", tags=["MTEXT", "wrap"], questions=["Q-0439"], params={"width": w, "advances_h8": WRAP_ADV_8})
        _wrap_case(c, WRAP_TEXT, w)
        c.window((0, 0), (200, 150))
    cases = [
        ("overlong-word", "Supercalifragilistic word", 50.0, "single word wider than 41 (spills?)"),
        ("overlong-first", "Supercalifragilisticexpialidocious", 40.0, "only one word, wider than 41"),
        ("leading-space", "   leading spaces first line", 60.0, "leading spaces on the first line"),
        ("leading-space-word", " Supercalifragilistic", 60.0, "a space before an overlong word (empty first line?)"),
        ("multi-space", "word      word      word", 45.0, "many spaces at the break"),
        ("wrap-then-p", "The quick brown\\Pfox jumps", 62.0, "wrap position directly followed by \\P"),
        ("trailing-p", "Line one\\P", 0.0, "trailing \\P (empty last line)"),
        ("empty-paras", "A\\P\\PB\\P\\P\\PC", 0.0, "empty paragraphs"),
        ("nbsp", "word\\~word\\~word word", 60.0, "\\~ non-breaking spaces"),
        ("whitespace-only", "     ", 0.0, "whitespace-only content (renders nothing?)"),
    ]
    for name, text, w, what in cases:
        c = s.case(f"wrap-{name}", f"MTEXT h=8, 41={w}: {what}", tags=["MTEXT", "wrap"], questions=["Q-0439"], params={"text": text, "width": w})
        _wrap_case(c, text, w)
        c.window((0, 0), (200, 150))
    # explicit breaks and control characters
    brk = [
        ("caret-j", "A^JB^IC", "caret ^J (paragraph?) and ^I (tab?)", ["Q-0413"]),
        ("backslash-p-tab", "A\\PB\tC", "\\P and a literal TAB byte", ["Q-0413", "Q-0412"]),
        ("caret-j-lines", "line1^Jline2^Jline3", "^J between three lines (re-save: 42/43)", ["Q-0413"]),
        ("literal-tab", "A\tB\t\tC", "literal TAB bytes in group 1", ["Q-0412"]),
        ("caret-i-tab", "A^IB^I^IC", "^I tabs", ["Q-0413", "Q-0432"]),
        ("caret-m", "A^MB", "^M (ignored or space?)", ["Q-0413"]),
    ]
    for name, text, what, qs in brk:
        c = s.case(f"break-{name}", f"MTEXT h=8: {what}", tags=["MTEXT", "wrap", "control-chars"], questions=qs, params={"text": text})
        _mt(c, text, insert=(20, 120), h=8)
        _baseline_ticks(c, 20, 120, 8, 3)
        c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# line spacing


def _spacing(s: SuiteBuilder) -> None:
    for style in (1, 2):
        for f in (0.25, 0.6, 0.8, 1.0, 1.5, 2.5, 4.0):
            h = 6.0
            c = s.case(f"spacing-{'atleast' if style == 1 else 'exact'}-{int(round(f * 100)):03d}", f"4-line MTEXT 'Xg Xg' h={h}, 73={style} ({'at least' if style == 1 else 'exactly'}), 44={f}; ticks at 5/3 h f baselines", tags=["MTEXT", "line-spacing"], questions=["Q-0443", "Q-0446"], params={"line_spacing_style": style, "factor": f, "h": h})
            text = "Xg Xg\\PXg Xg\\PXg Xg\\PXg Xg"
            top = 140.0
            _mt(c, text, insert=(40, top), h=h, line_spacing_style=style, line_spacing_factor=f)
            if style == 1 and f == 1.0:
                # ezdxf does not export default values: make both explicit
                c.byte_filters.append(_after_content(text, [(73, "     1"), (44, "1.0")]))
            elif f == 1.0:
                c.byte_filters.append(_after_content(text, [(44, "1.0")]))
            _baseline_ticks(c, 40, top, h, 4, f)
            total = h + 3 * PITCH * h * f
            c.fit((30, top - total - 0.5 * h), (80, top + 2))
    for style in (1, 2):
        for f in (0.25, 1.0, 4.0):
            c = s.case(f"spacing-ten-lines-{style}-{int(round(f * 100)):03d}", f"10-line MTEXT 'Xg' h=1.5, 73={style}, 44={f} (re-save 42/43 = box model)", tags=["MTEXT", "line-spacing"], questions=["Q-0446", "Q-0443"], params={"line_spacing_style": style, "factor": f, "lines": 10})
            text = "\\P".join(["Xg"] * 10)
            h = 1.5
            top = 145.0
            _mt(c, text, insert=(40, top), h=h, line_spacing_style=style, line_spacing_factor=f)
            if f == 1.0:
                c.byte_filters.append(_after_content(text, [(73, f"     {style}"), (44, "1.0")]))
            _baseline_ticks(c, 40, top, h, 10, f)
            total = h + 9 * PITCH * h * f
            c.fit((20, top - total - 3), (60, top + 2))
    for style in (1, 2):
        c = s.case(f"spacing-ascent-push-{style}", f"MTEXT 'LAYER\\PSOS\\PBLUE' h=10, 73={style}: does ink above cap height (S/O overshoot) push line 2 down?", tags=["MTEXT", "line-spacing"], questions=["Q-0444"], params={"line_spacing_style": style})
        text = "LAYER\\PSOS\\PBLUE"
        _mt(c, text, insert=(40, 140), h=10, line_spacing_style=style)
        if style == 1:
            c.byte_filters.append(_after_content(text, [(73, "     1")]))
        _baseline_ticks(c, 40, 140, 10, 3)
        c.window((0, 0), (200, 150))
        c = s.case(f"spacing-big-line-{style}", f"MTEXT 'Xg\\P{{\\H3x;X}}g\\PXg' h=5, 73={style}: pitch with a 3x taller line", tags=["MTEXT", "line-spacing", "height"], questions=["Q-0445"], params={"line_spacing_style": style})
        text = "Xg\\P{\\H3x;X}g\\PXg"
        _mt(c, text, insert=(40, 140), h=5, line_spacing_style=style)
        if style == 1:
            c.byte_filters.append(_after_content(text, [(73, "     1")]))
        _baseline_ticks(c, 40, 140, 5, 3)
        c.window((0, 0), (200, 150))
    # 72/73/44 omitted vs explicit 0 / explicit defaults (ezdxf drops defaults on export)
    variants = [
        ("omitted", [], "72/73/44 omitted"),
        ("explicit-defaults", [(72, "     1"), (73, "     1"), (44, "1.0")], "72=1, 73=1, 44=1.0 explicit"),
        ("flow-0", [(72, "     0")], "72=0 (invalid)"),
        ("style-0", [(73, "     0")], "73=0 (invalid)"),
        ("factor-0", [(44, "0.0")], "44=0.0 (invalid: every line on the first?)"),
    ]
    for name, pairs, what in variants:
        text = f"Line one {name}\\PLine two\\PLine three"
        c = s.case(f"spacing-defaults-{name}", f"3-line MTEXT h=8 with {what}", tags=["MTEXT", "line-spacing", "defaults"], questions=["Q-0447"], params={"tags": pairs})
        _mt(c, text, insert=(40, 130), h=8)
        if pairs:
            c.byte_filters.append(_after_content(text, pairs))
        _baseline_ticks(c, 40, 130, 8, 3)
        c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# inline codes


def _inline(s: SuiteBuilder) -> None:
    sans = FAMILY["sans"]
    lines = [
        # name, content, title, questions, extra kwargs
        ("underline-over-strike", "\\LXg\\l \\OXg\\o \\KXg\\k", "\\L \\O \\K on 'Xg' (line offsets, thickness, length)", ["Q-0430", "Q-0432"]),
        ("underline-all", "\\L\\O\\KXgXg\\k\\o\\l", "underline + overline + strike on the same run", ["Q-0430"]),
        ("underline-spaces", "\\LA  B^IC\\l", "\\L over double space and ^I tab", ["Q-0431"]),
        ("underline-trailing", "\\LAB   \\l|", "\\L with trailing spaces, then '|'", ["Q-0431"]),
        ("underline-leading", "\\L   AB\\l", "\\L with leading spaces", ["Q-0431"]),
        ("underline-wrap", "\\LThe quick brown fox jumps\\l", "\\L across a wrap (41=70)", ["Q-0431", "Q-0439"]),
        ("height-abs", "A\\H15;B\\H5;C\\H10;D", "\\H absolute heights 15/5/10", []),
        ("height-rel", "A\\H2x;B\\H2x;C\\H0.25x;D", "\\H relative factors accumulate (8, 16, 32, 8)", []),
        ("height-scope", "A{\\H2x;B{\\H2x;C}D}E", "nested braces restore \\H", []),
        ("height-no-terminator", "A\\H2xB\\H1xC", "\\H without ';' terminator", ["Q-0415"]),
        ("width-abs", "AB\\W2;AB\\W0.5;AB", "\\W absolute width factors 2 / 0.5", []),
        ("width-rel", "AB\\W2x;AB\\W2x;AB", "\\W relative factors (2, 4)", []),
        ("oblique", "AB\\Q20;AB\\Q-20;AB\\Q0;AB", "\\Q oblique 20 / -20 / 0", []),
        ("oblique-width-order", "{\\Q30;\\W3;I}  {\\W3;\\Q30;I}  {\\Q30;I}", "\\Q30 + \\W3 on 'I': stem slope reveals shear vs x-scale order", ["Q-0427"]),
        ("tracking", "ABCD\\P{\\T2;ABCD}\\P{\\T0.5;ABCD}", "\\T2 and \\T0.5 tracking", ["Q-0429"]),
        ("tracking-rel", "ABCD\\P{\\T0.1x;ABCD}\\P{\\T1.5x;ABCD}", "\\T0.1x and \\T1.5x (multiplier or +1?)", ["Q-0429"]),
        ("align-none", "X{\\H3x;X}Xg", "mixed heights, no \\A (default?)", ["Q-0426"]),
        ("align-0", "\\A0;X{\\H3x;X}Xg", "\\A0; bottom", ["Q-0426"]),
        ("align-1", "\\A1;X{\\H3x;X}Xg", "\\A1; center", ["Q-0426", "Q-0432"]),
        ("align-2", "\\A2;X{\\H3x;X}Xg", "\\A2; top", ["Q-0426"]),
        ("align-switch", "X{\\H3x;X}\\A1;X{\\H3x;X}\\A2;X{\\H3x;X}", "\\A changes mid-line", ["Q-0426"]),
        ("font-switch", f"Sans \\fLato|b0|i0|c0|p34;Lato \\fCascadia Mono|b0|i0|c0|p49;Mono \\f{sans}|b0|i0|c0|p34;Sans", "\\f family switch Liberation Sans / Lato / Cascadia Mono", []),
        ("font-bold-italic", f"\\f{sans}|b0|i0|c0|p34;Reg \\f{sans}|b1|i0|c0|p34;Bold \\f{sans}|b0|i1|c0|p34;Ital \\f{sans}|b1|i1|c0|p34;BoIt", "\\f bold/italic flags on Liberation Sans", []),
        ("font-lato-bold", "\\fLato|b1|i0|c0|p34;Lato Bold \\fLato|b0|i0;Lato", "\\fLato|b1 (LatoWeb-Bold) and back", []),
        ("font-scope", f"A{{\\fLato|b0|i0|c0|p34;B\\f{sans}|b1|i0;C}}D", "\\f inside braces restores at '}'", []),
        ("escapes", "a\\\\b \\{c\\} d\\;e", "escapes \\\\ \\{ \\} and invalid \\;", []),
        ("braces-plain", "{A}{{B}}C", "braces grouping without codes", []),
        ("percent-codes", "30%%d %%c50 %%p0.1 100%%%", "%%d %%c %%p %%% in MTEXT", []),
        ("percent-extra", "%%176 %%uAB%%u %%oCD%%o %%kEF%%k", "%%nnn and %%u/%%o/%%k in MTEXT", ["Q-0416", "Q-0432"]),
        ("unicode-escapes", "\\U+00D8 \\U+00B0 \\U+00B1 \\U+03A9 \\U+20AC", "\\U+ escapes (O-slash degree plus-minus Omega Euro)", []),
        ("invalid-codes", "a\\C+5b\\H1..5c\\AXd}e\\Jf\\:g", "invalid inline codes (\\C+5 \\H1..5 \\AX stray } \\J \\:)", ["Q-0415"]),
        ("unbalanced-open", "A{\\H2x;B{C", "unbalanced '{' (never closed)", ["Q-0415"]),
        ("column-break", "A\\NB", "\\N column break without columns", []),
        ("dim-wrap", "A\\XB", "\\X (dimension-line wrap) outside a dimension", []),
    ]
    for name, text, what, qs in lines:
        c = s.case(f"code-{name}", f"MTEXT h=8: {what}", tags=["MTEXT", "inline-codes"], questions=qs, params={"text": text})
        width = 70.0 if name == "underline-wrap" else None
        _mt(c, text, insert=(15, 110), h=8, width=width)
        _baseline_ticks(c, 15, 110, 8, 3)
        c.window((0, 0), (200, 150))
    # colours (acad.ctb)
    colors = [
        ("aci", "A\\C1;B\\C3;C\\C5;D\\C256;E\\C0;F", "\\C ACI 1/3/5, 256 (BYLAYER), 0 (BYBLOCK) on a layer with colour 6", []),
        ("truecolor", "\\c255;RED? \\c16711680;BLUE? \\c65280;GREEN", "\\c255 / \\c16711680 / \\c65280: byte order of \\c", ["Q-0417", "Q-0432"]),
        ("truecolor-large", "\\c9999999999;A\\c16777216;B", "\\c values >= 2^24", ["Q-0417"]),
        ("scope", "A{\\C1;B{\\C3;C}D}E", "\\C restored by braces", []),
        ("entity-color", "A\\C1;B", "entity colour 5, inline \\C1 overrides", []),
    ]
    for name, text, what, qs in colors:
        c = s.case(f"color-{name}", f"MTEXT h=10: {what}", tags=["MTEXT", "inline-codes", "color"], questions=qs, params={"text": text}, style_table="acad.ctb")
        c.layer("MAGENTA", color=6)
        attribs = {"layer": "MAGENTA"}
        if name == "entity-color":
            attribs["color"] = 5
        _mt(c, text, insert=(15, 110), h=10, **attribs)
        c.window((0, 0), (200, 150))
    # style width factor / oblique inherited by MTEXT (TEXT twin below)
    for name, wf, obl, text in (
        ("style-width-oblique", 0.7, 15.0, "ABC Ifl"),
        ("style-width-override", 0.7, 15.0, "{\\W1;\\Q0;ABC Ifl}"),
        ("style-width-rel", 0.7, 0.0, "ABC{\\W2x;ABC}"),
    ):
        c = s.case(f"code-{name}", f"STYLE width {wf} oblique {obl}: MTEXT '{text}' h=10 (top) vs TEXT 'ABC Ifl' (bottom)", tags=["MTEXT", "STYLE", "width-factor", "oblique"], questions=["Q-0428"], params={"style_width": wf, "style_oblique": obl, "text": text})
        st = c.style("WOBL", font=TTF_FONTS["sans"], width=wf, oblique=obl)
        _mt(c, text, insert=(20, 120), h=10, style=st)
        c.msp.add_text("ABC Ifl", height=10, dxfattribs={"style": st, "insert": (20, 50)})
        _cross(c, (20, 50))
        c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# stacks


def _stacks(s: SuiteBuilder) -> None:
    items = [
        ("frac-bare", "X\\S1/2;X", ["Q-0421", "Q-0424", "Q-0432"]),
        ("frac-70", "X{\\H0.7x;\\S1/2;}X", ["Q-0421", "Q-0424"]),
        ("frac-long", "X\\S12/345;X", ["Q-0421"]),
        ("frac-long-70", "X{\\H0.7x;\\S12/345;}X", ["Q-0421"]),
        ("diag-bare", "X\\S1#2;X", ["Q-0422", "Q-0432"]),
        ("diag-70", "X{\\H0.7x;\\S1#2;}X", ["Q-0422"]),
        ("diag-long", "X\\S12#345;X", ["Q-0422"]),
        ("diag-long-70", "X{\\H0.7x;\\S12#345;}X", ["Q-0422"]),
        ("tol-bare", "X\\S1^ 2;X", ["Q-0423", "Q-0432"]),
        ("tol-70", "X{\\H0.7x;\\S1^ 2;}X", ["Q-0423"]),
        ("tol-signs", "X\\S+0.1^ -0.2;X", ["Q-0423"]),
        ("tol-signs-nospace", "X\\S+0.1^-0.2;X", ["Q-0423", "Q-0419"]),
        ("tol-signs-70", "X{\\H0.7x;\\S+0.1^ -0.2;}X", ["Q-0423"]),
        ("caret-nospace", "X\\S5^6;X", ["Q-0419"]),
        ("caret-space", "X\\S5^ 6;X", ["Q-0419"]),
        ("caret-vs-slash", "X\\S5/6;X", ["Q-0419"]),
        ("caret-side-by-side", "\\S5^6; \\S5^ 6; \\S5/6;", ["Q-0419"]),
        ("baseline-bare", "A\\S1/2;B\\S3#4;C\\S5^6;", ["Q-0425"]),
        ("baseline-70", "A{\\H0.7x;\\S1/2;}B{\\H0.7x;\\S3#4;}C{\\H0.7x;\\S5^6;}", ["Q-0425"]),
        ("baseline-a0", "\\A0;A\\S1/2;B\\S3#4;C\\S5^6;", ["Q-0425", "Q-0426"]),
        ("baseline-a1", "\\A1;A\\S1/2;B\\S3#4;C\\S5^6;", ["Q-0425", "Q-0426"]),
        ("baseline-a2", "\\A2;A\\S1/2;B\\S3#4;C\\S5^6;", ["Q-0425", "Q-0426"]),
        ("no-divider", "X\\S12;X", []),
        ("second-divider", "X\\S1/2/3;X", []),
        ("space-after-slash", "X\\S1/ 2;X", []),
        ("escaped-semicolon", "X\\S1\\;2/3;X", []),
        ("codes-inside", "X\\S\\H2x;1/\\C1;2;X", []),
        ("unterminated", "X\\S1/2", ["Q-0415"]),
        ("restore-height", "X{\\H0.7x;\\S1/2;}\\H1.42857x;X", []),
    ]
    for name, text, qs in items:
        c = s.case(f"stack-{name}", f"MTEXT h=10 at 20 px/unit: '{text}'", tags=["MTEXT", "stack"], questions=qs, params={"text": text})
        _mt(c, text, insert=(10, 55), h=10)
        _tick(c, 10, 45)
        c.window_center((50, 37.5), 20)
    c = s.case("stack-in-wrap", "Stacks inside a wrapped paragraph (41=90) with \\A1: line pitch with stacks", tags=["MTEXT", "stack", "wrap"], questions=["Q-0425"], params={})
    _mt(c, "\\A1;Cut 1\\S1/2; in and 3\\S3#4; in, tolerance \\S+0.1^ -0.2; mm, done.", insert=(20, 130), h=8, width=90)
    _baseline_ticks(c, 20, 130, 8, 4)
    _vline(c, 110, 20, 135)
    c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# paragraph codes and tabs


def _paragraphs(s: SuiteBuilder) -> None:
    body = "Aa first\\PBb second\\PCc third"
    spacing = [
        ("ref", "", "no paragraph code (reference)"),
        ("before-after", "\\pb1,a2;", "\\pb1,a2; (spacing before 1 / after 2)"),
        ("xsm2", "\\pxsm2;", "\\pxsm2; (multiple 2)"),
        ("se15", "\\pse1.5;", "\\pse1.5; (exact 1.5)"),
        ("sa2", "\\psa2;", "\\psa2; (at least 2)"),
        ("reset", "\\pxsm2;Aa\\P\\ps*;", "\\pxsm2 then \\ps*; reset on paragraph 2"),
        ("before-second", "", "\\pb2; only on the second paragraph"),
    ]
    for name, code, what in spacing:
        text = code + body
        if name == "reset":
            text = "\\pxsm2;Aa first\\P\\ps*;Bb second\\PCc third"
        if name == "before-second":
            text = "Aa first\\P\\pb2;Bb second\\PCc third"
        c = s.case(f"para-spacing-{name}", f"3-paragraph MTEXT h=8: {what}; ticks at plain 5/3 baselines", tags=["MTEXT", "paragraph"], questions=["Q-0433"], params={"text": text})
        _mt(c, text, insert=(40, 135), h=8)
        _baseline_ticks(c, 40, 135, 8, 3)
        c.window((0, 0), (200, 150))
    c = s.case("para-scope", "MTEXT '{\\pxqc;A\\P}B\\PC' h=10, 41=100: is \\p popped at '}'?", tags=["MTEXT", "paragraph"], questions=["Q-0434"])
    _mt(c, "{\\pxqc;A\\P}B\\PC", insert=(50, 130), h=10, width=100)
    for x in (50, 150):
        _vline(c, x, 40, 135)
    c.window((0, 0), (200, 150))
    c = s.case("para-scope-mid", "MTEXT 'A{\\pxqc;B}C\\PD' h=10, 41=100: \\p set mid-paragraph inside braces", tags=["MTEXT", "paragraph"], questions=["Q-0434"])
    _mt(c, "A{\\pxqc;B}C\\PD", insert=(50, 130), h=10, width=100)
    for x in (50, 150):
        _vline(c, x, 60, 135)
    c.window((0, 0), (200, 150))
    # indent units: multiples of h or absolute? same drawing at three scales
    for h in (1.0, 10.0, 480.0):
        text = "\\pxi-3,l4,t4;A^IB first line\\PC second"
        c = s.case(f"para-indent-h{int(h)}", f"MTEXT '{text}' h={h}, 41=16h: \\pi/\\pl/\\pt in multiples of h or absolute?", tags=["MTEXT", "paragraph", "indent", "tabs"], questions=["Q-0435"], params={"h": h})
        x0, top = 2 * h, 13 * h
        _mt(c, text, insert=(x0, top), h=h, width=16 * h, cross=False)
        _cross(c, (x0, top), 0.5 * h)
        for k in (1, 4):  # expected left edges if multiples of h (first line l+i = 1h, rest 4h)
            _vline(c, x0 + k * h, top - 5 * h, top + h)
        c.window((0, 0), (20 * h, 15 * h))
    c = s.case("para-indent-absolute-tangent", "MTEXT '\\pi-1440,l1920;' at h=480 (Tangent CAD, absolute units?), 41=7680", tags=["MTEXT", "paragraph", "indent"], questions=["Q-0435"])
    h = 480.0
    _mt(c, "\\pi-1440,l1920;Bullet line one\\PBullet line two", insert=(2 * h, 13 * h), h=h, width=16 * h, cross=False)
    _cross(c, (2 * h, 13 * h), 0.5 * h)
    for dx in (480, 1920):
        _vline(c, 2 * h + dx, 5 * h, 14 * h)
    c.window((0, 0), (20 * h, 15 * h))
    c = s.case("para-left-right", "MTEXT \\pxl2,r3; wrapped paragraph h=5, 41=150 (lines at l=2h and 41-3h)", tags=["MTEXT", "paragraph", "indent"], questions=["Q-0435"])
    _mt(c, "\\pxl2,r3;" + LOREM[:160], insert=(20, 135), h=5, width=150)
    for x in (20, 30, 155, 170):
        _vline(c, x, 40, 140)
    c.window((0, 0), (200, 150))
    # explicit tab stops
    c = s.case("tabs-explicit", "MTEXT '\\pxt5,c15,r25;^IA^IBBB^ICCC' h=4 (ticks at 5h/15h/25h)", tags=["MTEXT", "tabs"], questions=["Q-0436"])
    _mt(c, "\\pxt5,c15,r25;^IA^IBBB^ICCC\\P^Ix^Ixxxxx^Ixxxxxxx", insert=(20, 120), h=4)
    for k in (5, 15, 25):
        _vline(c, 20 + k * 4, 95, 130)
    c.window((0, 0), (200, 150))
    c = s.case("tabs-decimal", "MTEXT tab stops with d prefix (decimal?) '\\pxtd20;^I12.5\\P^I1.25\\P^I125'", tags=["MTEXT", "tabs"], questions=["Q-0436"])
    _mt(c, "\\pxtd20;^I12.5\\P^I1.25\\P^I125", insert=(20, 120), h=5)
    _vline(c, 20 + 100, 70, 130)
    c.window((0, 0), (200, 150))
    for h in (2.5, 5.0):
        c = s.case(f"tabs-default-h{str(h).replace('.', '')}", f"MTEXT 'A^IB^I^IC' and 'asasas^Ix' h={h}: default tab stops every 4h?", tags=["MTEXT", "tabs"], questions=["Q-0437"], params={"h": h})
        _mt(c, "A^IB^I^IC\\Pasasas^Ix\\P^I^I^I|", insert=(10, 13 * h), h=h)
        for k in range(0, 17, 4):
            _vline(c, 10 + k * h, 12 * h - 4 * h, 13 * h + h)
        c.window((0, 0), (20 * h + 10 * 0, 15 * h))
    c = s.case("tabs-tab-in-wrap", "MTEXT with ^I inside a wrapped paragraph (41=100) h=6", tags=["MTEXT", "tabs", "wrap"], questions=["Q-0437", "Q-0439"])
    _mt(c, "Name^IValue one two three four five^Iend", insert=(20, 130), h=6, width=100)
    _vline(c, 120, 60, 135)
    c.window((0, 0), (200, 150))
    # alignment
    para = "The quick brown fox jumps over the lazy dog and keeps running far away from here."
    for q in ("l", "r", "c", "j", "d"):
        c = s.case(f"para-align-{q}", f"Wrapped MTEXT h=6, 41=150 with \\pxq{q};", tags=["MTEXT", "paragraph", "alignment"], questions=["Q-0438"], params={"q": q})
        _mt(c, f"\\pxq{q};{para}\\PShort last", insert=(25, 130), h=6, width=150)
        for x in (25, 175):
            _vline(c, x, 40, 135)
        c.window((0, 0), (200, 150))
    c = s.case("para-align-default-tc", "Wrapped MTEXT h=6, 41=150, attachment 2 (TC) without \\pq: default alignment from attachment", tags=["MTEXT", "paragraph", "alignment"], questions=["Q-0438", "Q-0449"])
    _mt(c, para, insert=(100, 130), h=6, width=150, attach=2)
    for x in (25, 175):
        _vline(c, x, 40, 135)
    c.window((0, 0), (200, 150))
    # lists
    c = s.case("list-bullets", "Bullet list \\pxi-3,l3,t3; with U+2022 bullets, h=8, 41=150", tags=["MTEXT", "paragraph", "list"], questions=["Q-0435"])
    _mt(c, "\\pxi-3,l3,t3;\u2022^IFirst item\\P\u2022^ISecond item that wraps onto another line\\P\u2022^IThird", insert=(20, 135), h=8, width=150)
    for x in (20, 44):
        _vline(c, x, 40, 140)
    c.window((0, 0), (200, 150))
    c = s.case("list-numbered", "Numbered list \\pxi-3,l3,t3; h=8, 41=150, then \\pi*,l*,t; reset", tags=["MTEXT", "paragraph", "list"], questions=["Q-0435"])
    _mt(c, "\\pxi-3,l3,t3;1.^IFirst\\P2.^ISecond item wrapping onto the next line\\P\\pi*,l*,t;Reset paragraph", insert=(20, 135), h=8, width=150)
    for x in (20, 44):
        _vline(c, x, 40, 140)
    c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# columns


def _columns(s: SuiteBuilder) -> None:
    text = LOREM + "\P" + LOREM
    w, g, h = 58.0, 6.0, 4.0
    x0, top = 7.0, 140.0
    total3 = 3 * w + 2 * g
    ins = {"insert": (x0, top), "char_height": h}

    def frame(c, x, width, height):
        lay = _ref(c)
        c.msp.add_lwpolyline([(x, top), (x + width, top), (x + width, top - height), (x, top - height)], close=True, dxfattribs={"layer": lay})

    c = s.case("columns-static-r2018", f"R2018 MTEXT static columns (3 x {w}, gutter {g}, height 100), ezdxf add_mtext_static_columns, h={h}", tags=["MTEXT", "columns"], questions=["Q-0441"], params={"width": w, "gutter": g, "height": 100})
    c.msp.add_mtext_static_columns([LOREM, LOREM[:120], "Third column."], w, g, 100, dxfattribs=dict(ins))
    _cross(c, (x0, top))
    frame(c, x0, total3, 100)
    c.window((0, 0), (200, 150))
    c = s.case("columns-dynamic-auto-r2018", f"R2018 MTEXT dynamic auto-height columns (width {w}, gutter {g}, height 60, count 3), h={h}: where does AutoCAD break?", tags=["MTEXT", "columns"], questions=["Q-0441"], params={"width": w, "gutter": g, "height": 60, "count": 3})
    c.msp.add_mtext_dynamic_auto_height_columns(text, w, g, 60, 3, dxfattribs=dict(ins))
    _cross(c, (x0, top))
    frame(c, x0, total3, 60)
    c.window((0, 0), (200, 150))
    c = s.case("columns-dynamic-manual-r2018", f"R2018 MTEXT dynamic manual-height columns heights [40, 80, 0], h={h}", tags=["MTEXT", "columns"], questions=["Q-0441"], params={"width": w, "gutter": g, "heights": [40, 80, 0]})
    c.msp.add_mtext_dynamic_manual_height_columns(text, w, g, [40, 80, 0], dxfattribs=dict(ins))
    _cross(c, (x0, top))
    frame(c, x0, w, 40)
    frame(c, x0 + w + g, w, 80)
    c.window((0, 0), (200, 150))
    c = s.case("columns-dynamic-auto-r2018-overflow", f"R2018 dynamic auto-height columns count 2, height 40, content needing more (total width stored for 2), h={h}", tags=["MTEXT", "columns"], questions=["Q-0441"], params={"width": w, "gutter": g, "height": 40, "count": 2})
    c.msp.add_mtext_dynamic_auto_height_columns(text, w, g, 40, 2, dxfattribs=dict(ins))
    _cross(c, (x0, top))
    frame(c, x0, 2 * w + g, 40)
    c.window((0, 0), (200, 150))
    # pre-R2018 linked columns: R2013 plus R2000/R2004 (does AutoCAD relink the XDATA columns there?)
    for ver, variant in (("R2013", "colwidth"), ("R2013", "totalwidth"), ("R2000", "totalwidth"), ("R2004", "totalwidth")):
        c = s.case(f"columns-linked-{ver.lower()}-{variant}", f"{ver} static columns as linked MTEXTs (3 x {w}, gutter {g}, h={h}); linked 41 = {'column width' if variant == 'colwidth' else f'total width {total3} (as AutoCAD writes)'}", tags=["MTEXT", "columns", "linked"], dxfversion=ver, questions=["Q-0442"], params={"width": w, "gutter": g, "linked_41": w if variant == "colwidth" else total3})
        c.msp.add_mtext_static_columns([LOREM[:200], LOREM[:200], LOREM[:200]], w, g, 70, dxfattribs=dict(ins))
        _cross(c, (x0, top))
        frame(c, x0, total3, 70)
        if variant == "totalwidth":
            def fix(data: bytes, _w=w, _t=total3) -> bytes:
                needle = f" 41\n{_w}\n".encode()
                first = data.find(needle)
                if first < 0 or data.count(needle) != 3:
                    raise AssertionError("expected three 41 tags")
                head, tail = data[: first + len(needle)], data[first + len(needle):]
                return head + tail.replace(needle, f" 41\n{_t}\n".encode())
            c.byte_filters.append(fix)
        c.window((0, 0), (200, 150))
    for ver in ("R2000", "R2004", "R2007", "R2013"):
        c = s.case(f"columns-dynamic-auto-{ver.lower()}", f"{ver} dynamic auto-height columns (height 60, count 3, h={h}): ezdxf stores all content in the first MTEXT (AutoCAD redistributes?)", tags=["MTEXT", "columns", "linked"], dxfversion=ver, questions=["Q-0442", "Q-0441"], params={"width": w, "gutter": g, "height": 60, "count": 3})
        c.msp.add_mtext_dynamic_auto_height_columns(text, w, g, 60, 3, dxfattribs=dict(ins))
        _cross(c, (x0, top))
        frame(c, x0, total3, 60)
        c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# background mask and text frame


def _backdrop(c) -> None:
    """Coloured solid HATCH + a grid of LINEs behind the MTEXT (drawn first)."""
    c.layer("BACK", color=8)
    hatch = c.msp.add_hatch(color=3, dxfattribs={"layer": "BACK"})
    hatch.paths.add_polyline_path([(10, 40), (190, 40), (190, 110), (10, 110)], is_closed=True)
    for i in range(0, 21):
        x = 10 + i * 9
        c.msp.add_line((x, 20), (x, 130), dxfattribs={"layer": "BACK", "color": 5})
    for j in range(0, 12):
        y = 20 + j * 10
        c.msp.add_line((10, y), (190, y), dxfattribs={"layer": "BACK", "color": 1})


def _background(s: SuiteBuilder) -> None:
    text = "ABC\\PDEF"
    fills = [
        ("fill-aci", 1, "90=1, 63=1 (red)"),
        ("fill-window", 2, "90=2 (drawing window colour)"),
        ("fill-canvas", 3, "90=3 (background colour)"),
        ("frame-only", 16, "90=16 text frame only"),
        ("fill-frame", 17, "90=17 fill 63=1 + frame"),
        ("fill-truecolor", 1, "90=1, 421=(255,200,0)"),
    ]
    for name, flag, what in fills:
        c = s.case(f"bg-{name}", f"MTEXT 'ABC\\PDEF' h=12 over a green HATCH and line grid, {what}, 45=1.5", tags=["MTEXT", "background"], questions=["Q-0455", "Q-0457"], params={"bg_fill": flag}, style_table="acad.ctb")
        _backdrop(c)
        m = _mt(c, text, insert=(100, 75), h=12, attach=5, cross=False)
        if name == "fill-truecolor":
            m.set_bg_color((255, 200, 0), scale=1.5)
        elif flag == 16:
            m.set_bg_color(None, text_frame=True)
        elif flag == 3:
            m.set_bg_color("canvas", scale=1.5)
        elif flag == 2:
            m.dxf.bg_fill = 2
            m.dxf.bg_fill_color = 0
            m.dxf.box_fill_scale = 1.5
        else:
            m.set_bg_color(1, scale=1.5, text_frame=bool(flag & 16))
        c.window((0, 0), (200, 150))
    for scale in (1.0, 1.5, 3.0, 5.0):
        for width in (0.0, 150.0):
            c = s.case(f"bg-scale-{int(scale * 10):02d}-w{int(width)}", f"MTEXT 'ABC\\PDEF' h=10, 90=1 63=1, 45={scale}, 41={width}: mask box extent and margin", tags=["MTEXT", "background"], questions=["Q-0456"], params={"scale": scale, "width": width}, style_table="acad.ctb")
            _backdrop(c)
            m = _mt(c, text, insert=(25, 100), h=10, width=width if width else None, cross=False)
            m.set_bg_color(1, scale=scale)
            _cross(c, (25, 100))
            c.window((0, 0), (200, 150))
    for width in (0.0, 150.0):
        c = s.case(f"bg-frame-fill3-w{int(width)}", f"R2018 MTEXT 90=17 fill colour 3, 41={width}, 1 line 'Frame me' h=10", tags=["MTEXT", "background", "text-frame"], questions=["Q-0457"], params={"width": width}, style_table="acad.ctb")
        _backdrop(c)
        m = _mt(c, "Frame me", insert=(25, 90), h=10, width=width if width else None, cross=False)
        m.set_bg_color(3, scale=1.5, text_frame=True)
        c.window((0, 0), (200, 150))
    for fm in (0, 1):
        c = s.case(f"bg-fillmode-{fm}", f"MTEXT with background fill 90=1 and 90=3 over lines/HATCH, $FILLMODE={fm}", tags=["MTEXT", "background", "FILLMODE"], questions=["Q-0454"], params={"fillmode": fm}, header={"$FILLMODE": fm}, style_table="acad.ctb")
        _backdrop(c)
        m = _mt(c, "Fill 1", insert=(60, 90), h=12, attach=5, cross=False)
        m.set_bg_color(1, scale=1.5)
        m = _mt(c, "Fill 3", insert=(140, 60), h=12, attach=5, cross=False)
        m.set_bg_color("canvas", scale=1.5)
        c.window((0, 0), (200, 150))
    c = s.case("bg-rotated-wrapped", "Rotated (30 deg) wrapped MTEXT (41=90) with background 90=1, 45=1.25", tags=["MTEXT", "background", "rotation"], questions=["Q-0456"], style_table="acad.ctb")
    _backdrop(c)
    m = _mt(c, "The quick brown fox jumps over the lazy dog", insert=(100, 75), h=8, width=90, attach=5, cross=False, rotation=30.0)
    m.set_bg_color(1, scale=1.25)
    c.window((0, 0), (200, 150))
    # pre-R2018 text frame + LWPOLYLINE referenced by ACAD_MTEXT_TEXT_BORDERS
    for with_xdata in (True, False):
        nm = "xdata" if with_xdata else "no-xdata"
        c = s.case(f"bg-frame-r2013-{nm}", f"R2013 MTEXT 90=16 + red LWPOLYLINE 2 units outside the expected frame{' referenced by XDATA ACAD_MTEXT_TEXT_BORDERS' if with_xdata else ' (not referenced)'}", tags=["MTEXT", "text-frame", "XDATA"], dxfversion="R2013", questions=["Q-0458"], params={"xdata": with_xdata}, style_table="acad.ctb")
        h = 10.0
        x0, top, w = 30.0, 110.0, 140.0
        m = _mt(c, "Framed MTEXT\\Psecond line", insert=(x0, top), h=h, width=w, cross=False)
        m.set_bg_color(None, text_frame=True)
        off = 0.5 * h + 2.0
        bottom = top - h - PITCH * h
        pl = c.msp.add_lwpolyline([(x0 - off, top + off), (x0 + w + off, top + off), (x0 + w + off, bottom - off), (x0 - off, bottom - off)], close=True, dxfattribs={"color": 1})
        if with_xdata:
            m.set_xdata("ACAD", [
                (1000, "ACAD_MTEXT_TEXT_BORDERS_BEGIN"),
                (1070, 80), (1070, 16),
                (1070, 46), (1040, 1.5),
                (1070, 81), (1070, 1),
                (1070, 5), (1005, pl.dxf.handle),
                (1000, "ACAD_MTEXT_TEXT_BORDERS_END"),
            ])
        c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# rotation / direction


def _rotation(s: SuiteBuilder) -> None:
    text = "Rotated\\PMTEXT"

    def ray(c, deg):
        a = math.radians(deg)
        c.msp.add_line((100, 75), (100 + 70 * math.cos(a), 75 + 70 * math.sin(a)), dxfattribs={"layer": _ref(c)})

    c = s.case("rot-50-only", "MTEXT with 50=30 and no 11 (degrees -> 30 deg; radians -> 278.9 deg); ray at 30 deg", tags=["MTEXT", "rotation"], questions=["Q-0450"])
    _mt(c, text, insert=(100, 75), h=10, rotation=30.0)
    ray(c, 30)
    c.window((0, 0), (200, 150))
    c = s.case("rot-11-only", "MTEXT with 11=(cos30, sin30) only", tags=["MTEXT", "rotation"], questions=["Q-0450"])
    _mt(c, text, insert=(100, 75), h=10, text_direction=(math.cos(math.radians(30)), math.sin(math.radians(30)), 0))
    ray(c, 30)
    c.window((0, 0), (200, 150))
    c = s.case("rot-11-unnormalized", "MTEXT with non-unit 11=(30,30,0): normalised? (45 deg, h unchanged)", tags=["MTEXT", "rotation"], questions=["Q-0451"])
    _mt(c, text, insert=(100, 75), h=10, text_direction=(30, 30, 0))
    ray(c, 45)
    c.window((0, 0), (200, 150))
    c = s.case("rot-both-ezdxf", "MTEXT with 11=(0,1,0) (90 deg) written before 50=30: which wins?", tags=["MTEXT", "rotation"], questions=["Q-0451"])
    _mt(c, text, insert=(100, 75), h=10, text_direction=(0, 1, 0), rotation=30.0)
    ray(c, 30)
    ray(c, 90)
    c.window((0, 0), (200, 150))
    for order in ("11-first", "50-first"):
        c = s.case(f"rot-both-{order}", f"MTEXT 11=(1,0,0) and 50=45 with {order.replace('-', ' ')} in the file: which wins?", tags=["MTEXT", "rotation"], questions=["Q-0451"], params={"order": order})
        _mt(c, text, insert=(100, 75), h=10, rotation=45.0)
        c.byte_filters.append(_insert_after(b" 50\n45.0\n", _tags([(11, "1.0"), (21, "0.0"), (31, "0.0")]), before=(order == "11-first")))
        ray(c, 0)
        ray(c, 45)
        c.window((0, 0), (200, 150))
    for a in (5, 9):
        c = s.case(f"rot-attach-{a}-wrapped", f"MTEXT rotated 60 deg, attachment {a}, 41=80, wrapped text h=8", tags=["MTEXT", "rotation", "attachment"], questions=["Q-0449"], params={"attach": a})
        _mt(c, "The quick brown fox jumps over the lazy dog", insert=(100, 75), h=8, width=80, attach=a, rotation=60.0)
        ray(c, 60)
        c.window((0, 0), (200, 150))
    for fd in (3, 5):
        c = s.case(f"flow-direction-{fd}", f"MTEXT 72={fd} ({'top to bottom' if fd == 3 else 'by style'}) 'ABC\\PDEF' h=10, Liberation Sans", tags=["MTEXT", "flow-direction"], questions=["Q-0452"] if fd == 3 else [], params={"flow_direction": fd})
        _mt(c, "ABC\\PDEF", insert=(60, 130), h=10, flow_direction=fd)
        c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# heights: 40 x style height, defined height 46, 40 = 0


def _heights(s: SuiteBuilder) -> None:
    for sh in (0.0, 20.0):
        c = s.case(f"height-style-{int(sh)}", f"MTEXT 40=5 on a STYLE with fixed height {sh}: 'Ab{{\\H2x;Ab}}' (which height wins?)", tags=["MTEXT", "STYLE", "height"], params={"style_height": sh})
        st = c.style("FIXH", font=TTF_FONTS["sans"], height=sh)
        _mt(c, "Ab{\\H2x;Ab}\\PAb", insert=(20, 130), h=5, style=st)
        _baseline_ticks(c, 20, 130, 5, 2)
        c.window((0, 0), (200, 150))
    for sty in ("lato", "mono"):
        c = s.case(f"height-style-font-{sty}", f"MTEXT h=10 on a {FAMILY[sty]} STYLE, two lines 'Hxgp\\PHxgp'", tags=["MTEXT", "STYLE"])
        st = c.style(sty.upper(), font=TTF_FONTS[sty])
        _mt(c, "Hxgp\\PHxgp", insert=(20, 120), h=10, style=st)
        _baseline_ticks(c, 20, 120, 10, 2)
        c.window((0, 0), (200, 150))
    for a in (1, 4, 7):
        for dh in (30.0, 80.0):
            c = s.case(f"defined-height-{a}-{int(dh)}", f"MTEXT 3 lines h=8, 46={dh} (content ~35), attachment {a}: does 46 move the text?", tags=["MTEXT", "defined-height"], params={"attach": a, "defined_height": dh})
            _mt(c, "Line one\\PLine two\\PLine three", insert=(40, 110), h=8, attach=a, width=100, defined_height=dh, cross=False)
            _cross(c, (40, 110), 10)
            if a == 1:
                _vline(c, 30, 110 - dh, 110)
            c.window((0, 0), (200, 150))
    c = s.case("height-zero", "MTEXT 40=0 (invalid on purpose) containing 'A^IB', $TEXTSIZE=2.5", tags=["MTEXT", "height", "invalid"], questions=["Q-0453"], header={"$TEXTSIZE": 2.5})
    _mt(c, "A^IB", insert=(10, 30), h=1.2345)
    c.byte_filters.append(lambda d: d.replace(b" 40\n1.2345\n", b" 40\n0.0\n"))
    c.window((0, 0), (50, 37.5))


# --------------------------------------------------------------------------------------------
# 250-character chunks


def _chunks(s: SuiteBuilder) -> None:
    splits = [
        ("unicode", "\\U+00", "\\U+00D8", "chunk ends with '\\U+00' (rest 'D8' in group 1)"),
        ("stack", "\\S1/", "\\S1/2;", "chunk ends inside '\\S1/2;'"),
        ("paragraph", "\\", "\\P", "chunk ends with '\\' (next chunk starts with 'P')"),
        ("font", "\\fLato|b", "\\fLato|b1|i0;", "chunk ends inside '\\fLato|b1|i0;'"),
        ("height", "\\H2", "\\H2x;", "chunk ends inside '\\H2x;'"),
        ("brace", "{\\C1", "{\\C1;RED}", "chunk ends inside '{\\C1;'"),
    ]
    for name, head, code, what in splits:
        pad = _pad(250 - len(head))
        content = pad + code + " marker text after the code, then more words to wrap."
        _check_chunk(content, head)
        c = s.case(f"chunk-{name}", f"MTEXT > 250 chars (group 3 + 1), {what}; h=4, 41=190", tags=["MTEXT", "chunks"], questions=["Q-0414"], params={"split_after": head, "code": code})
        _mt(c, content, insert=(5, 140), h=4, width=190)
        c.window((0, 0), (200, 150))
    content = " ".join([LOREM] * 4)
    chunks = split_mtext_string(content, 250)
    assert len(chunks) >= 4
    c = s.case("chunk-long-plain", f"MTEXT of {len(content)} chars (ezdxf writes {len(chunks) - 1} x group 3 + group 1), h=3, 41=190", tags=["MTEXT", "chunks", "wrap"], params={"length": len(content), "chunks": len(chunks)})
    _mt(c, content, insert=(5, 145), h=3, width=190)
    c.window((0, 0), (200, 150))


# --------------------------------------------------------------------------------------------
# DBCS encodings (R2004)


DBCS = {
    # codepage: ((char, bytes), (char, bytes)) with trail byte 0x5C
    "ANSI_932": ("cp932", "\u8868", "\u30bd"),  # 表 95 5C, ソ 83 5C
    "ANSI_936": ("cp936", "\u4e57", "\u50dc"),  # 81 5C, 83 5C
    "ANSI_950": ("cp950", "\u4e48", "\u515d"),  # A4 5C, A2 5C
}


def _encoding(s: SuiteBuilder) -> None:
    for cp, (enc, ch1, ch2) in DBCS.items():
        text = f"1{ch1}P2{ch2}L3 end"
        c = s.case(f"dbcs-trail-5c-{cp.lower().replace('_', '')}", f"R2004 {cp} MTEXT '1<5C-trail>P2<5C-trail>L3': misread as \\P (break) and \\L (underline)?", tags=["MTEXT", "encoding", "DBCS"], dxfversion="R2004", questions=["Q-0059"], params={"codepage": cp, "text_hex": text.encode(enc).hex()})
        c.doc.encoding = enc
        _mt(c, text, insert=(20, 110), h=10)
        _baseline_ticks(c, 20, 110, 10, 2)
        c.notes.append("CJK glyphs are not in Liberation Sans: AutoCAD draws them from a fallback font (or '?'); only the line break / underline matters")
        c.window((0, 0), (200, 150))
    enc, ch1 = "cp932", "\u8868"
    pad = _pad(249)
    content = pad + ch1 + "P after the split, more words here."
    _check_chunk(content, ch1)
    c = s.case("dbcs-chunk-split-ansi932", "R2004 ANSI_932 MTEXT, DBCS char split on purpose: group 3 ends with lead byte 0x95 of U+8868, group 1 starts with trail 0x5C then 'P' (per-chunk decode would give \\P)", tags=["MTEXT", "encoding", "DBCS", "chunks"], dxfversion="R2004", questions=["Q-0060", "Q-0414"], params={"codepage": "ANSI_932"})
    c.doc.encoding = enc
    _mt(c, content, insert=(5, 140), h=4, width=190)
    c.byte_filters.append(_move_trail_byte)
    c.allow_audit_errors = True  # ezdxf cannot decode the split DBCS char line by line
    c.notes.append("the 3/1 chunk boundary splits one DBCS character (byte filter moves 0x5C into group 1)")
    c.window((0, 0), (200, 150))


def _move_trail_byte(data: bytes) -> bytes:
    needle = b"\x95\x5c\n  1\n"
    if data.count(needle) != 1:
        raise AssertionError("DBCS split needle not found")
    return data.replace(needle, b"\x95\n  1\n\x5c")


# --------------------------------------------------------------------------------------------
# seeded random


def _random(s: SuiteBuilder) -> None:
    words = LOREM.replace(",", "").replace(".", "").split()
    for seed in range(1, 7):
        c = s.case(f"random-{seed:04d}", f"Random MTEXT with inline codes, wrap and attachment, seed {seed}", tags=["MTEXT", "inline-codes", "wrap"], seed=seed)
        rng = c.rng
        parts = []
        for _ in range(rng.randint(8, 16)):
            wd = rng.choice(words)
            r = rng.random()
            if r < 0.12:
                wd = f"\\L{wd}\\l"
            elif r < 0.22:
                wd = f"{{\\H{rng.choice([0.5, 1.5, 2])}x;{wd}}}"
            elif r < 0.30:
                wd = f"{{\\W{rng.choice([0.6, 1.4])};{wd}}}"
            elif r < 0.37:
                wd = f"{{\\Q{rng.choice([-15, 20])};{wd}}}"
            elif r < 0.44:
                wd = f"\\S{rng.randint(1, 9)}{rng.choice('/#^')}{' ' if rng.random() < 0.5 else ''}{rng.randint(1, 99)};"
            elif r < 0.50:
                wd = wd + "\\P"
            elif r < 0.55:
                wd = f"{{\\fLato|b{rng.randint(0, 1)}|i0|c0|p34;{wd}}}"
            parts.append(wd)
        text = " ".join(parts)
        attach = rng.randint(1, 9)
        width = rng.choice([100.0, 130.0, 160.0, 180.0])
        h = rng.choice([5.0, 6.0, 7.0])
        col, row = (attach - 1) % 3, (attach - 1) // 3
        # the [0, 41] box is centred in the window whatever the attachment column
        p = (100 + (col - 1) * width / 2, (140, 75, 10)[row])
        _mt(c, text, insert=p, h=h, width=width, attach=attach, line_spacing_factor=rng.choice([1.0, 1.25]))
        c.params.update({"text": text, "attach": attach, "width": width, "h": h})
        c.window((0, 0), (200, 150))
