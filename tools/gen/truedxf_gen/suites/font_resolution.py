"""Isolate the arch-cn font paths (verified AutoCAD rules in note 04 §15).

These probes deliberately use installed Windows/AutoCAD fonts and unavailable names.
No font bytes are included. The flags-zero cases test a hypothesis, not a rendering rule.
"""

from __future__ import annotations

from ..core import SuiteBuilder, suite


def _style(c, name, font="", family=None, flags=0, bigfont=""):
    # Keep the source drawing's stored code page and Standard font (note 04 §15), so an
    # unexpected fallthrough to Standard cannot be confused with the generator's defaults.
    c.doc.encoding = "gbk"  # ezdxf writes $DWGCODEPAGE from this; R2018 content stays UTF-8.
    standard = c.doc.styles.get("Standard")
    standard.dxf.font = "arial.ttf"
    standard.set_xdata("ACAD", [(1000, "Arial"), (1071, 34)])
    st = c.style(name, font=font, bigfont=bigfont)
    if family is not None:
        # Preserve 1071 exactly: ezdxf's convenience setter adds its own pitch/charset bits.
        c.doc.styles.get(st).set_xdata("ACAD", [(1000, family), (1071, flags)])
    return st


@suite("font-resolution", "Empty STYLE file, XDATA charset/family and CJK plot probes",
       fonts="acad", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    variants = [
        ("empty-no-xdata", "", None, 0, ""),
        ("empty-song-flags0", "", "宋体", 0, ""),
        ("empty-song-flags34306", "", "宋体", 34306, ""),
        ("empty-simsun-flags0", "", "SimSun", 0, ""),
        ("empty-simsun-flags34306", "", "SimSun", 34306, ""),
        ("empty-arial-flags0", "", "Arial", 0, ""),
        ("empty-arial-flags34", "", "Arial", 34, ""),
        ("empty-unknown-family", "", "TruedxfMissingFamily", 0, ""),
        ("file-simsun", "simsun.ttc", None, 0, ""),
        ("file-simsun-song-flags0", "simsun.ttc", "宋体", 0, ""),
        ("file-simplex", "simplex.shx", None, 0, ""),
        ("file-txt", "txt.shx", None, 0, ""),
        ("file-romans", "romans.shx", None, 0, ""),
        ("file-simplex-song-flags0", "simplex.shx", "宋体", 0, ""),
        ("file-simplex-song-flags34306", "simplex.shx", "宋体", 34306, ""),
        ("missing-shx", "TruedxfMissingFont.shx", None, 0, ""),
        ("missing-shx-bigfont", "TruedxfMissingFont.shx", None, 0, "TruedxfMissingBig.shx"),
        ("simplex-missing-bigfont", "simplex.shx", None, 0, "TruedxfMissingBig.shx"),
        ("simplex-gbcbig", "simplex.shx", None, 0, "gbcbig.shx"),
    ]
    for name, font, family, flags, big in variants:
        c = s.case(name, f"STYLE file={font!r}, family={family!r}, flags={flags}, big={big!r}",
                   tags=["TEXT", "MTEXT", "font-resolution"],
                   questions=["Q-0736", "Q-0737"],
                   params={"font": font, "family": family, "flags": flags, "bigfont": big})
        st = _style(c, "PROBE", font, family, flags, big)
        # Same rows/anchors in every case make substituted outlines directly comparable.
        c.msp.add_text("FD Hxg 012", height=12, dxfattribs={"style": st, "insert": (10, 125)})
        c.msp.add_text("弱电井 冷媒", height=12, dxfattribs={"style": st, "insert": (10, 95)})
        c.msp.add_mtext("FD Hxg 012\\P弱电井 冷媒", dxfattribs={
            "style": st, "insert": (10, 65), "char_height": 12, "width": 175,
        })
        # Crosses plot even when a missing bigfont suppresses the entire text.
        for x, y in ((10, 125), (10, 95), (10, 65)):
            c.msp.add_line((x - 1, y), (x + 1, y), dxfattribs={"color": 8})
            c.msp.add_line((x, y - 1), (x, y + 1), dxfattribs={"color": 8})
        c.window((0, 0), (200, 150))

    # Separate FONTALT at plot time from font substitution while the DXF is loaded. The
    # harness sets FONTALT only after /i opens the drawing (note 04 §15, unresolved).
    for name in ("empty-no-xdata", "empty-song-flags0", "empty-simsun-flags34306"):
        _, font, family, flags, big = next(v for v in variants if v[0] == name)
        c = s.case(name + "-alt-txt", "Same STYLE, FONTALT=txt.shx after DXF load",
                   tags=["TEXT", "font-resolution"], questions=["Q-0736"],
                   params={"family": family, "flags": flags, "fontalt": "txt.shx"})
        st = _style(c, "PROBE", font, family, flags, big)
        c.msp.add_text("FD Hxg 012", height=12, dxfattribs={"style": st, "insert": (10, 125)})
        c.sysvar("FONTALT", "txt.shx")
        c.window((0, 0), (200, 150))

    _arch_windows(s)


def _arch_windows(s: SuiteBuilder) -> None:
    # Numeric observations from the unmodified corpus copy, native TEXT only (no proxies).
    # Keep its original world coordinates and clipping phase to distinguish metrics from
    # raster-grid effects. FD's stored 10/11 offset is preserved even if AutoCAD recomputes 10.
    windows = [
        ("1e85a", (-1693771.8719396493, 137862.7242351754),
         (-1693287.5793820233, 138403.96293002332),
         (-1694088.888957692, 137670.4115252614), (-1692295.552160228, 137645.48782397545)),
        ("1e8ba", (-1693772.1220676117, 204713.26453396352),
         (-1693280.3824818463, 205174.5195858786),
         (-1694077.7711812498, 204435.86545070048), (-1692284.4343837854, 204410.94174941452)),
        ("1e965", (-1693782.6573328564, 270966.46082117606),
         (-1693304.3900833502, 271637.3241317561),
         (-1694096.5668607273, 270900.74103320885), (-1692303.2300632629, 270875.8173319229)),
    ]
    for name, vmin, fd, weak, cold in windows:
        for kind in ("fd", "cjk", "cjk-unclipped"):
            c = s.case(f"arch-{name}-{kind}", f"Native {kind} text isolated from corpus-proxy/arch-cn-{name}",
                       tags=["TEXT", "font-resolution", "corpus-isolation"],
                       questions=["Q-0736" if kind == "fd" else "Q-0737"],
                       params={"source": f"corpus-proxy/arch-cn-{name}", "isolation": kind},
                       style_table="acad.ctb")
            if kind == "fd":
                st = _style(c, "宋体_txtstyle_0_0", family="宋体", flags=0)
                layer = c.layer("NATIVE", color=2, lineweight=-3)
                c.msp.add_text("FD", height=350, dxfattribs={
                    "style": st, "layer": layer, "width": 0.8, "halign": 4,
                    "insert": (fd[0] - 200.2, fd[1] - 167.3), "align_point": fd,
                })
            else:
                shx = name == "1e965"
                st = (_style(c, "_TCH_DIM", "SIMPLEX", bigfont="GBCBIG") if shx else
                      _style(c, "宋体", family="SimSun", flags=34306))
                layer = c.layer("NATIVE", color=7 if shx else 255, lineweight=-3 if shx else 0)
                for text, pos in (("弱电井", weak), ("冷媒", cold)):
                    c.msp.add_text(text, height=438.8652482269502 if shx else 300,
                                   dxfattribs={"style": st, "layer": layer,
                                               "width": 0.7 if shx else 1, "insert": pos})
                if kind == "cjk-unclipped":
                    vmin = (vmin[0], vmin[1] - 500)
            c.half_pixel_shift = False
            c.window(vmin, (vmin[0] + 1800, vmin[1] + 1350))
