"""LINE, ARC, CIRCLE, XLINE, RAY (note 03 §3.1–3.4). Hairline (lineweight 0) geometry."""

from __future__ import annotations

import math

from ..core import SuiteBuilder, suite


@suite("lines-curves", "LINE / ARC / CIRCLE / XLINE / RAY geometry at lineweight 0", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    # --- LINE at angles: one case per angle, 100-unit line from the centre, 10 px/unit
    for i, a in enumerate([0, 1, 5, 15, 26.565, 30, 45, 60, 89, 90, 91, 135, 179, 200, 315], 1):
        c = s.case(f"line-angle-{i:04d}", f"LINE 60 units long at {a} deg", tags=["LINE"], params={"angle": a})
        r = math.radians(a)
        c.msp.add_line((100, 75), (100 + 60 * math.cos(r), 75 + 60 * math.sin(r)))
        c.window((0, 0), (200, 150))

    # --- sub-pixel placement: horizontal/vertical lines at fractional device-pixel offsets
    for i, off in enumerate([0.0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9], 1):
        c = s.case(
            f"line-subpixel-{i:04d}",
            f"Axis-parallel LINEs offset {off} px from pixel grid",
            tags=["LINE", "pixel-centre"],
            params={"offset_px": off},
        )
        d = off / 10  # 10 px/unit
        for k in range(5):
            y = 20 + k * 25 + d
            c.msp.add_line((20 + d, y), (180 + d, y))
            x = 30 + k * 30 + d
            c.msp.add_line((x, 10 + d), (x, 140 + d))
        c.window((0, 0), (200, 150))

    # --- short and zero-length LINEs (dot rule)
    for i, length in enumerate([0.0, 0.01, 0.05, 0.1, 0.15, 0.3, 1.0], 1):
        c = s.case(
            f"line-short-{i:04d}",
            f"LINEs of length {length} units (10 px/unit), several directions",
            tags=["LINE", "zero-length"],
            questions=["Q-0132"] if length == 0 else [],
            params={"length": length},
        )
        for k, a in enumerate(range(0, 180, 30)):
            r = math.radians(a)
            x, y = 30 + k * 28, 75
            c.msp.add_line((x, y), (x + length * math.cos(r), y + length * math.sin(r)))
        c.window((0, 0), (200, 150))

    # --- far from origin (float precision / plot origin)
    for i, off in enumerate([1e3, 1e5, 1e6, 1e7, -3.5e6], 1):
        c = s.case(
            f"line-far-{i:04d}",
            f"Star of LINEs around ({off}, {off})",
            tags=["LINE", "precision"],
            params={"offset": off},
        )
        cx, cy = off + 100, off / 2 + 75
        for a in range(0, 360, 20):
            r = math.radians(a)
            c.msp.add_line((cx, cy), (cx + 60 * math.cos(r), cy + 60 * math.sin(r)))
        c.window((off, off / 2), (off + 200, off / 2 + 150))

    # --- CIRCLE radius sweep (tessellation / VIEWRES question)
    for i, (rad, pxu) in enumerate(
        [(0.05, 10), (0.2, 10), (0.5, 10), (1, 10), (2.5, 10), (7, 10), (20, 10), (70, 10),
         (700, 1), (5000, 0.125), (70, 40), (1.7, 400)],
        1,
    ):
        c = s.case(
            f"circle-radius-{i:04d}",
            f"CIRCLE r={rad} at {pxu} px/unit",
            tags=["CIRCLE", "tessellation"],
            questions=["Q-0135"],
            params={"radius": rad, "px_per_unit": pxu},
        )
        c.msp.add_circle((0, 0), rad)
        c.window_center((0, 0), pxu)

    # --- concentric circles, many radii in one view (tessellation vs radius)
    c = s.case("circle-concentric-0001", "40 concentric CIRCLEs r=1.5..72", tags=["CIRCLE", "tessellation"])
    for k in range(40):
        c.msp.add_circle((100, 75), 1.5 + k * 1.8)
    c.window((0, 0), (200, 150))

    # --- degenerate circles (open check + render)
    for i, rad in enumerate([0.0, -5.0, 1e-9], 1):
        c = s.case(
            f"circle-degenerate-{i:04d}",
            f"CIRCLE with radius {rad} next to a reference cross",
            tags=["CIRCLE", "degenerate"],
            questions=["Q-0130"],
            params={"radius": rad},
        )
        c.msp.add_line((90, 75), (110, 75))
        c.msp.add_line((100, 65), (100, 85))
        c.msp.add_circle((100, 75), rad)
        c.window((0, 0), (200, 150))

    # --- ARC angle sweeps
    arcs = [
        (0, 90), (0, 180), (0, 270), (45, 135), (350, 10), (270, 90), (90, 89.9), (0, 0.5),
        (30, 30), (0, 360), (-90, 90), (90, 450), (-450, -300), (10, 370), (179.999, 180.001),
    ]
    for i, (a0, a1) in enumerate(arcs, 1):
        c = s.case(
            f"arc-angles-{i:04d}",
            f"ARC r=50 start {a0} end {a1}",
            tags=["ARC"],
            questions=["Q-0131"],
            params={"start": a0, "end": a1},
        )
        c.msp.add_arc((100, 75), 50, a0, a1)
        c.msp.add_point((100, 75))
        c.window((0, 0), (200, 150))

    for i, (rad, sweep, pxu) in enumerate(
        [(0.3, 90, 10), (3, 90, 10), (60, 5, 10), (2000, 2, 10), (1e5, 0.05, 10), (50, 359.5, 10)], 1
    ):
        c = s.case(
            f"arc-radius-{i:04d}",
            f"ARC r={rad} sweep {sweep} deg",
            tags=["ARC", "tessellation"],
            questions=["Q-0135"],
            params={"radius": rad, "sweep": sweep, "px_per_unit": pxu},
        )
        # place the arc so its midpoint is at the window centre
        mid = 90.0
        cx, cy = 100.0, 75.0 - rad + (rad * 0 if rad < 70 else 0)
        c.msp.add_arc((cx, cy if rad >= 70 else 75.0), rad, mid - sweep / 2, mid + sweep / 2)
        if rad >= 70:
            c.window_center((100, cy + rad), pxu)
        else:
            c.window_center((100, 75), pxu)

    # --- XLINE and RAY clipped to the plot window
    xl = [
        ((100, 75), 0), ((100, 75), 90), ((100, 75), 30), ((0, 0), 45), ((-500, 75), 0.5),
        ((1e4, 1e4), 225), ((300, 75), 90),
    ]
    for i, (p, a) in enumerate(xl, 1):
        c = s.case(
            f"xline-{i:04d}",
            f"XLINE through {p} at {a} deg",
            tags=["XLINE", "infinite"],
            params={"base": p, "angle": a},
        )
        r = math.radians(a)
        c.msp.add_xline(p, (math.cos(r), math.sin(r)))
        c.msp.add_circle((100, 75), 2)
        c.window((0, 0), (200, 150))
    rays = [
        ((100, 75), 0), ((100, 75), 135), ((20, 20), 30), ((-100, 75), 0), ((-100, 75), 180),
        ((250, 200), 225),
    ]
    for i, (p, a) in enumerate(rays, 1):
        c = s.case(
            f"ray-{i:04d}",
            f"RAY from {p} at {a} deg",
            tags=["RAY", "infinite"],
            params={"base": p, "angle": a},
        )
        r = math.radians(a)
        c.msp.add_ray(p, (math.cos(r), math.sin(r)))
        c.msp.add_circle((100, 75), 2)
        c.window((0, 0), (200, 150))

    # extents plot with an XLINE: are infinite lines part of the extents?
    c = s.case("xline-extents-0001", "Extents plot of a circle plus an XLINE and a RAY", tags=["XLINE", "RAY", "extents"])
    c.msp.add_circle((100, 75), 30)
    c.msp.add_xline((100, 75), (1, 0.3))
    c.msp.add_ray((100, 75), (0, 1))
    c.plot_extents()

    # --- 3D LINE with z (plan view projection)
    c = s.case("line-3d-0001", "LINEs with different z values (plan projection)", tags=["LINE", "3d"])
    for k, z in enumerate([-1000, -10, 0, 10, 1000]):
        c.msp.add_line((20, 20 + k * 25, z), (180, 20 + k * 25, -z))
    c.window((0, 0), (200, 150))

    # --- seeded random mixes
    for seed in range(1, 7):
        c = s.case(f"random-{seed:04d}", f"Random LINE/ARC/CIRCLE mix, seed {seed}", tags=["LINE", "ARC", "CIRCLE"], seed=seed)
        rng = c.rng
        for _ in range(40):
            kind = rng.choice(["line", "arc", "circle"])
            x, y = rng.uniform(10, 190), rng.uniform(10, 140)
            if kind == "line":
                c.msp.add_line((x, y), (rng.uniform(10, 190), rng.uniform(10, 140)))
            elif kind == "arc":
                c.msp.add_arc((x, y), rng.uniform(1, 40), rng.uniform(0, 360), rng.uniform(0, 360))
            else:
                c.msp.add_circle((x, y), rng.uniform(0.5, 40))
        c.window((0, 0), (200, 150))

    _question_cases(s)


def _question_cases(s: SuiteBuilder) -> None:
    """Cases driven by docs/questions.md (degenerates, angles, thickness)."""
    # Q-0129: $ANGBASE / $ANGDIR must not change stored angles
    for i, (angbase, angdir) in enumerate([(0.0, 0), (90.0, 0), (0.0, 1), (45.0, 1)], 1):
        c = s.case(
            f"angbase-{i:04d}",
            f"ARC 0-90, TEXT rot 30, INSERT rot 45 with $ANGBASE={angbase} $ANGDIR={angdir}",
            tags=["ARC", "TEXT", "INSERT", "ANGBASE", "ANGDIR"],
            questions=["Q-0129"],
            params={"angbase": angbase, "angdir": angdir},
            header={"$ANGBASE": angbase, "$ANGDIR": angdir},
        )
        c.notes.append("$ANGBASE unit (degrees vs radians in DXF) is itself uncertain; value written as given")
        c.msp.add_arc((50, 75), 30, 0, 90)
        c.msp.add_text("Rot30", height=8, rotation=30, dxfattribs={"insert": (90, 40)})
        blk = c.doc.blocks.new("ARROW")
        blk.add_lwpolyline([(0, 0), (30, 0), (25, 4), (30, 0), (25, -4)])
        c.msp.add_blockref("ARROW", (150, 60), dxfattribs={"rotation": 45})
        c.window((0, 0), (200, 150))

    # Q-0130: degenerate CIRCLE/ARC (r=0, r<0, start == end), heavy lineweight to make dots visible
    for i, (kind, r, a0, a1) in enumerate(
        [("circle", 0.0, 0, 0), ("circle", -5.0, 0, 0), ("arc", 0.0, 0, 90), ("arc", -5.0, 0, 90), ("arc", 10.0, 45, 45)], 1
    ):
        c = s.case(
            f"degenerate-lw-{i:04d}",
            f"{kind.upper()} r={r} {a0}..{a1} with lineweight 0.50 mm beside a reference cross",
            tags=[kind.upper(), "degenerate", "lineweight"],
            questions=["Q-0130"],
            params={"kind": kind, "radius": r, "start": a0, "end": a1},
        )
        c.msp.add_line((60, 75), (80, 75))
        c.msp.add_line((70, 65), (70, 85))
        if kind == "circle":
            c.msp.add_circle((120, 75), r, dxfattribs={"lineweight": 50})
        else:
            c.msp.add_arc((120, 75), r, a0, a1, dxfattribs={"lineweight": 50})
        c.window((0, 0), (200, 150))

    # Q-0131: ARC angle normalisation
    for i, (a0, a1) in enumerate([(0, 360), (-180, 180), (350, 10), (30, 450), (0, 720), (45, 45), (720, 810)], 1):
        c = s.case(
            f"arc-normalise-{i:04d}",
            f"ARC r=50 start {a0} end {a1} (normalisation)",
            tags=["ARC", "angles"],
            questions=["Q-0131"],
            params={"start": a0, "end": a1},
        )
        c.msp.add_arc((100, 75), 50, a0, a1)
        c.msp.add_line((100, 75), (160, 75))
        c.window((0, 0), (200, 150))

    # Q-0132: zero-length LINE with lineweights and a dashed linetype
    for i, lw in enumerate([0, 50, 200, 211], 1):
        for dashed in (False, True):
            c = s.case(
                f"zero-line-lw{lw:03d}-{'dashed' if dashed else 'cont'}",
                f"Zero-length LINEs lineweight {lw / 100:.2f} mm {'DASHED' if dashed else 'Continuous'}",
                tags=["LINE", "zero-length", "lineweight"] + (["linetype"] if dashed else []),
                questions=["Q-0132"],
                params={"lineweight": lw, "dashed": dashed},
            )
            a = {"lineweight": lw}
            if dashed:
                a["linetype"] = c.linetype("DASHED")
            for k in range(5):
                p = (40 + k * 30, 75)
                c.msp.add_line(p, p, dxfattribs=a)
            c.window((0, 0), (200, 150))

    # Q-0134: LINE with thickness seen edge-on in plan view
    for i, t in enumerate([10.0, -10.0], 1):
        c = s.case(
            f"line-thickness-{i:04d}",
            f"LINE (100,40)-(100,110) thickness {t} extrusion (1,0,0) in plan view",
            tags=["LINE", "thickness"],
            questions=["Q-0134"],
            params={"thickness": t},
        )
        c.msp.add_line((100, 40), (100, 110), dxfattribs={"thickness": t, "extrusion": (1, 0, 0)})
        c.msp.add_line((60, 20), (140, 20))
        c.window((0, 0), (200, 150))
