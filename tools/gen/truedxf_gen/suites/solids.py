"""SOLID / TRACE / 3DFACE (+ invisible edges, FILLMODE, vertex order) — note 03 §3.11–3.12."""

from __future__ import annotations

from ..core import SuiteBuilder, suite


@suite("solids", "SOLID, TRACE and 3DFACE incl. vertex order, invisible edges, FILLMODE", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    # SOLID vertex order: 1-2-4-3 ("bow tie" if given as a polygon order)
    orders = {
        "zorder": [(40, 30), (160, 30), (40, 120), (160, 120)],  # correct DXF order -> rectangle
        "polygon-order": [(40, 30), (160, 30), (160, 120), (40, 120)],  # polygon order -> bow tie
        "triangle-3eq4": [(40, 30), (160, 30), (100, 120), (100, 120)],
        "triangle-3only": [(40, 30), (160, 30), (100, 120)],
        "concave": [(40, 30), (160, 30), (90, 60), (160, 120)],
        "degenerate-line": [(40, 75), (160, 75), (40, 75), (160, 75)],
    }
    for fm in (1, 0):
        for name, pts in orders.items():
            qs = (["Q-0184"] if name == "polygon-order" else []) + (["Q-0183"] if fm == 0 else [])
            c = s.case(f"solid-{name}-fill{fm}", f"SOLID {name} FILLMODE={fm}", tags=["SOLID", "FILLMODE"], questions=qs, params={"points": pts, "fillmode": fm}, header={"$FILLMODE": fm})
            c.msp.add_solid(pts)
            c.window((0, 0), (200, 150))
    for fm in (1, 0):
        c = s.case(f"trace-fill{fm}", f"TRACE (like SOLID) FILLMODE={fm}", tags=["TRACE", "FILLMODE"], header={"$FILLMODE": fm})
        c.msp.add_trace([(20, 40), (180, 40), (20, 60), (180, 90)])
        c.msp.add_trace([(20, 100), (180, 100), (20, 130), (180, 110)])
        c.window((0, 0), (200, 150))
    # FILLMODE on every filled entity type at once
    for fm in (0, 1):
        c = s.case(f"fillmode-mixed-{fm}", f"SOLID, TRACE, wide LWPOLYLINE and solid HATCH with $FILLMODE={fm}", tags=["SOLID", "TRACE", "LWPOLYLINE", "HATCH", "FILLMODE"], questions=["Q-0183"], params={"fillmode": fm}, header={"$FILLMODE": fm})
        c.msp.add_solid([(15, 85), (85, 85), (15, 135), (85, 135)])
        c.msp.add_trace([(115, 85), (185, 85), (115, 135), (185, 125)])
        c.msp.add_lwpolyline([(15, 20), (60, 60), (90, 20)], dxfattribs={"const_width": 6})
        h = c.msp.add_hatch(color=7)
        h.paths.add_polyline_path([(115, 15), (185, 15), (185, 65), (115, 65)], is_closed=True, flags=1)
        c.window((0, 0), (200, 150))

    # SOLID with lineweight (outline widened?) and colour
    for i, lw in enumerate([0, 50, 211], 1):
        c = s.case(f"solid-lineweight-{i:04d}", f"SOLID square with lineweight {lw / 100:.2f} mm (does the fill grow?)", tags=["SOLID", "lineweight"], params={"lineweight": lw}, style_table="acad.ctb")
        c.msp.add_solid([(50, 25), (150, 25), (50, 125), (150, 125)], dxfattribs={"lineweight": lw, "color": 5})
        c.window((0, 0), (200, 150))
    # 3DFACE: invisible edge flags 70 bits 1..8 (never filled)
    for flags in range(16):
        c = s.case(f"3dface-invisible-{flags:02d}", f"3DFACE quad with invisible-edge flags {flags}", tags=["3DFACE", "invisible-edges"], questions=["Q-0189"], params={"flags": flags})
        c.msp.add_3dface([(40, 30, 0), (160, 30, 0), (160, 120, 0), (40, 120, 0)], dxfattribs={"invisible_edges": flags})
        c.window((0, 0), (200, 150))
    c = s.case("3dface-triangle", "3DFACE triangle (4th vertex = 3rd)", tags=["3DFACE"])
    c.msp.add_3dface([(40, 30, 0), (160, 30, 0), (100, 120, 0), (100, 120, 0)])
    c.window((0, 0), (200, 150))
    c = s.case("3dface-nonplanar", "Non-planar 3DFACE (plan projection) with $SPLFRAME=1 (invisible edges shown?)", tags=["3DFACE", "SPLFRAME"], questions=["Q-0189"], header={"$SPLFRAME": 1})
    c.msp.add_3dface([(40, 30, 0), (160, 30, 50), (160, 120, -30), (40, 120, 20)], dxfattribs={"invisible_edges": 5})
    c.window((0, 0), (200, 150))
    # thickness on SOLID (prism): top face filled in 2D wireframe plot?
    c = s.case("solid-thickness-tilted", "SOLID with thickness 30 and tilted extrusion", tags=["SOLID", "thickness", "OCS"], questions=["Q-0185"])
    c.msp.add_solid([(60, 20), (120, 20), (60, 60), (120, 60)], dxfattribs={"thickness": 30, "extrusion": (0, -0.5, 0.866)})
    c.window((0, 0), (200, 150))
    # overlapping solids of different colours: file order
    c = s.case("solid-overlap", "Three overlapping SOLIDs red/green/blue in file order", tags=["SOLID", "draw-order"], style_table="acad.ctb")
    for k, col in enumerate((1, 3, 5)):
        x = 30 + k * 35
        c.msp.add_solid([(x, 30), (x + 80, 30), (x, 110), (x + 80, 110)], dxfattribs={"color": col})
    c.window((0, 0), (200, 150))
    # random
    for seed in range(1, 5):
        c = s.case(f"random-{seed:04d}", f"Random SOLIDs/TRACEs/3DFACEs, seed {seed}", tags=["SOLID", "TRACE", "3DFACE"], seed=seed)
        rng = c.rng
        for _ in range(15):
            pts = [(rng.uniform(10, 190), rng.uniform(10, 140)) for _ in range(4)]
            k = rng.choice(["solid", "trace", "face"])
            if k == "solid":
                c.msp.add_solid(pts)
            elif k == "trace":
                c.msp.add_trace(pts)
            else:
                c.msp.add_3dface([(*p, 0) for p in pts], dxfattribs={"invisible_edges": rng.randint(0, 15)})
        c.window((0, 0), (200, 150))
