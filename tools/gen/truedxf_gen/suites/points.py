"""POINT with every PDMODE × PDSIZE (note 03 §3.1, note 01 §7.2)."""

from __future__ import annotations

from ..core import SuiteBuilder, suite

PDMODES = [0, 1, 2, 3, 4, 32, 33, 34, 35, 36, 64, 65, 66, 67, 68, 96, 97, 98, 99, 100]


def _grid(c, n: int = 4, dx: float = 40, dy: float = 35, x0: float = 40, y0: float = 22.5):
    for j in range(n - 1):
        for i in range(n):
            c.msp.add_point((x0 + i * dx, y0 + j * dy + 17.5))


@suite("points", "POINT symbols: all PDMODE values × PDSIZE (absolute, 0, negative)", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    # every mode × representative sizes; window 200x150 at 10 px/unit
    for size in (0.0, 2.0, 5.0, 10.0, -5.0, -10.0):
        tag = {0.0: "zero", 2.0: "abs2", 5.0: "abs5", 10.0: "abs10", -5.0: "neg5", -10.0: "neg10"}[size]
        for mode in PDMODES:
            c = s.case(
                f"pdmode-{mode:03d}-{tag}",
                f"POINT grid PDMODE={mode} PDSIZE={size}",
                tags=["POINT", "PDMODE", "PDSIZE"],
                questions=["Q-0159"] if size > 0 else ["Q-0160"],
                params={"pdmode": mode, "pdsize": size},
                header={"$PDMODE": mode, "$PDSIZE": size},
            )
            _grid(c)
            c.window((0, 0), (200, 150))

    # relative sizes depend on "view height": same drawing, different plot windows
    for i, (pxu, size) in enumerate([(10, 0.0), (5, 0.0), (20, 0.0), (10, -10.0), (5, -10.0), (20, -10.0)], 1):
        c = s.case(
            f"pdsize-relative-{i:04d}",
            f"PDMODE 34, PDSIZE {size} plotted at {pxu} px/unit (which height is the reference?)",
            tags=["POINT", "PDSIZE", "relative"],
            questions=["Q-0160"],
            params={"pdmode": 34, "pdsize": size, "px_per_unit": pxu},
            header={"$PDMODE": 34, "$PDSIZE": size},
        )
        for k in range(5):
            c.msp.add_point((60 + k * 20, 75))
        c.window_center((100, 75), pxu)

    # the modelspace *Active VPORT height differs from the plot window: which one does PDSIZE 0 use?
    for i, vh in enumerate([50.0, 150.0, 600.0], 1):
        c = s.case(
            f"pdsize-vport-{i:04d}",
            f"PDSIZE 0 with *Active VPORT height {vh} but plot window height 150",
            tags=["POINT", "PDSIZE", "relative", "VPORT"],
            questions=["Q-0160"],
            params={"pdmode": 3, "pdsize": 0, "vport_height": vh},
            header={"$PDMODE": 3, "$PDSIZE": 0.0},
        )
        for k in range(5):
            c.msp.add_point((60 + k * 20, 75))
        c.window((0, 0), (200, 150))
        vp = c.doc.set_modelspace_vport(vh, (100, 75))
        vp.dxf.aspect_ratio = 4 / 3

    # point angle (50): rotation sign of the symbol
    for i, ang in enumerate([0, 30, 90, -30, 45], 1):
        c = s.case(
            f"point-angle-{i:04d}",
            f"POINT PDMODE 3/66/4 at PDSIZE 20 with angle 50={ang}",
            tags=["POINT", "angle"],
            questions=["Q-0161"],
            params={"angle": ang, "pdsize": 20},
            header={"$PDMODE": 67, "$PDSIZE": 20.0},
        )
        c.msp.add_point((100, 75), dxfattribs={"angle": ang})
        c.msp.add_line((70, 75), (130, 75))
        c.window((0, 0), (200, 150))

    # dot mode with lineweights (mode 0 dot size)
    for i, lw in enumerate([0, 25, 50, 100, 211], 1):
        c = s.case(
            f"dot-lineweight-{i:04d}",
            f"PDMODE 0 dots with lineweight {lw / 100:.2f} mm",
            tags=["POINT", "lineweight"],
            questions=["Q-0212"],
            params={"lineweight": lw},
            header={"$PDMODE": 0},
        )
        for k in range(7):
            c.msp.add_point((40 + k * 20, 75), dxfattribs={"lineweight": lw})
        c.window((0, 0), (200, 150))

    # PDMODE symbols stroked with a lineweight
    for i, (mode, lw) in enumerate([(3, 100), (34, 100), (3, 0), (34, 0)], 1):
        c = s.case(
            f"symbol-lineweight-{i:04d}",
            f"PDMODE {mode} PDSIZE 15 with lineweight {lw / 100:.2f} mm",
            tags=["POINT", "lineweight", "PDMODE"],
            questions=["Q-0212"],
            params={"pdmode": mode, "lineweight": lw},
            header={"$PDMODE": mode, "$PDSIZE": 15.0},
        )
        for k in range(4):
            c.msp.add_point((40 + k * 40, 75), dxfattribs={"lineweight": lw})
        c.window((0, 0), (200, 150))

    # POINTs inside a non-uniformly scaled, rotated INSERT (symbol distorted?)
    for i, size in enumerate([5.0, -5.0], 1):
        c = s.case(
            f"point-in-block-{i:04d}",
            f"Block with POINTs (PDMODE 34, PDSIZE {size}) inserted sx=3 sy=1 rot 30",
            tags=["POINT", "INSERT", "non-uniform-scale"],
            questions=["Q-0163"],
            params={"pdsize": size},
            header={"$PDMODE": 34, "$PDSIZE": size},
        )
        blk = c.doc.blocks.new("PTS")
        for k in range(3):
            blk.add_point((k * 10, 0))
        blk.add_line((0, -5), (20, -5))
        c.msp.add_blockref("PTS", (60, 50), dxfattribs={"xscale": 3, "yscale": 1, "rotation": 30})
        c.msp.add_point((40, 110))
        c.window((0, 0), (200, 150))

    # point symbols with OCS extrusion and thickness
    for i, ext in enumerate([(0, 0, -1), (0, 1, 1), (1, 0, 0.2)], 1):
        c = s.case(
            f"point-ocs-{i:04d}",
            f"POINT PDMODE 35 PDSIZE 20 with extrusion {ext}",
            tags=["POINT", "OCS"],
            params={"extrusion": ext},
            header={"$PDMODE": 35, "$PDSIZE": 20.0},
        )
        c.msp.add_point((100, 75), dxfattribs={"extrusion": ext})
        c.window((0, 0), (200, 150))
    c = s.case(
        "point-thickness-0001",
        "POINTs with thickness 20 and tilted extrusion (thickness line?)",
        tags=["POINT", "thickness"],
        questions=["Q-0162"],
        header={"$PDMODE": 0},
    )
    c.msp.add_point((60, 75), dxfattribs={"thickness": 20})
    c.msp.add_point((100, 75), dxfattribs={"thickness": 20, "extrusion": (0, -1, 1)})
    c.msp.add_point((140, 75), dxfattribs={"thickness": 20, "extrusion": (1, 0, 1)})
    c.window((0, 0), (200, 150))

    # extents plot: does the symbol count for extents?
    for i, size in enumerate([20.0, -20.0], 1):
        c = s.case(
            f"point-extents-{i:04d}",
            f"Extents plot of two POINTs PDMODE 35 PDSIZE {size}",
            tags=["POINT", "extents"],
            questions=["Q-0112"],
            header={"$PDMODE": 35, "$PDSIZE": size},
        )
        c.msp.add_point((0, 0))
        c.msp.add_point((100, 50))
        c.plot_extents()

    # points on DEFPOINTS and on a no-plot layer
    c = s.case("point-defpoints-0001", "POINTs on layer Defpoints and on a no-plot layer (not plotted?)", tags=["POINT", "Defpoints", "layer"], header={"$PDMODE": 34, "$PDSIZE": 10.0})
    c.layer("NOPLOT", plot=False)
    c.msp.add_point((50, 75), dxfattribs={"layer": "Defpoints"})
    c.msp.add_point((100, 75), dxfattribs={"layer": "NOPLOT"})
    c.msp.add_point((150, 75))
    c.window((0, 0), (200, 150))

    # random point clouds
    for seed in range(1, 4):
        c = s.case(f"random-{seed:04d}", f"Random POINTs, random PDMODE, seed {seed}", tags=["POINT"], seed=seed)
        rng = c.rng
        c.header(pdmode=rng.choice(PDMODES), pdsize=rng.choice([3.0, 6.0, -4.0]))
        c.params = {"pdmode": c.doc.header["$PDMODE"], "pdsize": c.doc.header["$PDSIZE"]}
        for _ in range(60):
            c.msp.add_point((rng.uniform(5, 195), rng.uniform(5, 145)))
        c.window((0, 0), (200, 150))
