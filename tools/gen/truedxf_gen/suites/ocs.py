"""OCS / extrusion / elevation / thickness (note 03 §2). Plan-view plots of OCS entities."""

from __future__ import annotations

import math

from ezdxf.math import OCS, Vec3

from ..core import SuiteBuilder, TextEntityAlignment, suite

NORMALS = {
    "z": (0, 0, 1),
    "negz": (0, 0, -1),
    "tilt-y45": (0, -1, 1),
    "tilt-x30": (math.sin(math.radians(30)), 0, math.cos(math.radians(30))),
    "small": (0.01, 0.01, 1),  # |Nx|,|Ny| < 1/64: arbitrary-axis 'Wy' branch
    "threshold": (1 / 64, 0.0, 1),  # right at the 1/64 threshold
    "near-threshold": (0.0157, 0.0, 0.99988),
    "edge-on": (1, 0, 0),
    "unnormalised": (0, 0, -5),
    "unnormalised-pos": (0, 0, 5),
    "unnormalised-tilt": (2, 0, 2),
    "skew": (0.3, -0.4, 0.866),
}


def _q(key: str, *extra: str) -> list[str]:
    qs = list(extra)
    if key.startswith("unnormalised"):
        qs.append("Q-0122")
    return qs


def _place(ocs: OCS, wcs_center: Vec3) -> Vec3:
    """OCS point whose WCS image is ``wcs_center`` (so entities land in the window)."""
    return ocs.from_wcs(wcs_center)


@suite("ocs", "Extrusion vectors, elevation and thickness (plan view)", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    center = Vec3(100, 75, 0)
    for key, n in NORMALS.items():
        ocs = OCS(n)
        # CIRCLE + ARC
        c = s.case(f"circle-{key}", f"CIRCLE r=40 and ARC r=25 0..120 with extrusion {n}", tags=["CIRCLE", "ARC", "OCS"], questions=_q(key, "Q-0125"), params={"extrusion": n})
        p = _place(ocs, center)
        c.msp.add_circle(p, 40, dxfattribs={"extrusion": n})
        c.msp.add_arc(p, 25, 0, 120, dxfattribs={"extrusion": n})
        c.msp.add_line((95, 75), (105, 75))
        c.msp.add_line((100, 70), (100, 80))
        c.window((0, 0), (200, 150))
        # LWPOLYLINE with bulge and elevation
        c = s.case(f"lwpolyline-{key}", f"LWPOLYLINE with bulges, elevation 5, extrusion {n}", tags=["LWPOLYLINE", "OCS", "elevation"], questions=_q(key), params={"extrusion": n})
        p = _place(ocs, center)
        pts = [(p.x - 40, p.y - 30, 0, 0, 0), (p.x + 40, p.y - 30, 0, 0, 0.5), (p.x + 40, p.y + 30, 0, 0, 0), (p.x - 40, p.y + 30, 0, 0, -0.3)]
        c.msp.add_lwpolyline(pts, format="xyseb", close=True, dxfattribs={"extrusion": n, "elevation": p.z})
        c.window((0, 0), (200, 150))
        # SOLID + TRACE (OCS corners)
        c = s.case(f"solid-{key}", f"SOLID and TRACE with extrusion {n}", tags=["SOLID", "TRACE", "OCS"], questions=_q(key, "Q-0125"), params={"extrusion": n})
        p = _place(ocs, center)
        c.msp.add_solid([(p.x - 50, p.y - 20, p.z), (p.x - 10, p.y - 20, p.z), (p.x - 50, p.y + 20, p.z), (p.x - 10, p.y + 30, p.z)], dxfattribs={"extrusion": n})
        c.msp.add_trace([(p.x + 10, p.y - 20, p.z), (p.x + 50, p.y - 20, p.z), (p.x + 10, p.y + 20, p.z), (p.x + 50, p.y + 20, p.z)], dxfattribs={"extrusion": n})
        c.window((0, 0), (200, 150))
        # TEXT (OCS insertion + rotation)
        c = s.case(f"text-{key}", f"TEXT 'OCS Fg' h=15 rot 10 with extrusion {n}", tags=["TEXT", "OCS"], questions=_q(key, "Q-0125") + (["Q-0126"] if key == "negz" else []), params={"extrusion": n})
        p = _place(ocs, center)
        t = c.msp.add_text("OCS Fg", height=15, rotation=10, dxfattribs={"extrusion": n})
        t.set_placement(p, align=TextEntityAlignment.MIDDLE_CENTER)
        c.window((0, 0), (200, 150))
        # ELLIPSE is WCS (extrusion only defines the plane) - include for contrast
        c = s.case(f"ellipse-{key}", f"ELLIPSE (WCS centre) with extrusion {n}", tags=["ELLIPSE", "OCS"], params={"extrusion": n})
        nz = Vec3(n).normalize()
        major = ocs.to_wcs(Vec3(50, 0, 0))  # OCS x axis: perpendicular to the extrusion
        c.msp.add_ellipse(center, major_axis=major, ratio=0.5, dxfattribs={"extrusion": nz})
        c.window((0, 0), (200, 150))

    # INSERT with extrusion (block drawn in the OCS plane)
    for key in ("negz", "tilt-y45", "small", "skew"):
        n = NORMALS[key]
        ocs = OCS(n)
        c = s.case(f"insert-{key}", f"INSERT of an 'F' block with extrusion {n}", tags=["INSERT", "OCS"], questions=["Q-0125", "Q-0127"], params={"extrusion": n})
        blk = c.doc.blocks.new("F")
        blk.add_lwpolyline([(0, 0), (0, 60), (40, 60)])
        blk.add_line((0, 30), (25, 30))
        blk.add_circle((30, 10), 8)
        p = _place(ocs, Vec3(80, 45, 0))
        c.msp.add_blockref("F", p, dxfattribs={"extrusion": n, "rotation": 15})
        c.window((0, 0), (200, 150))

    # HATCH with extrusion (0,0,-1): OCS x negated (ezdxf#736)
    for key in ("z", "negz", "tilt-x30"):
        n = NORMALS[key]
        ocs = OCS(n)
        c = s.case(f"hatch-{key}", f"Solid HATCH (square + circle hole) with extrusion {n}", tags=["HATCH", "OCS"], questions=["Q-0125"], params={"extrusion": n})
        p = _place(ocs, center)
        h = c.msp.add_hatch(color=1, dxfattribs={"extrusion": n, "elevation": (0, 0, p.z)})
        h.paths.add_polyline_path([(p.x - 40, p.y - 40), (p.x + 40, p.y - 40), (p.x + 40, p.y + 40), (p.x - 40, p.y + 40)], is_closed=True, flags=1)
        ep = h.paths.add_edge_path(flags=16)
        ep.add_arc((p.x + 10, p.y), 15, 0, 360)
        c.window((0, 0), (200, 150))

    # 2D POLYLINE with elevation in the header (vertex z ignored?)
    c = s.case("polyline2d-elevation-0001", "2D POLYLINE with header elevation and conflicting vertex z", tags=["POLYLINE", "elevation"], questions=["Q-0125", "Q-0137"])
    pl = c.msp.add_polyline2d([(20, 20), (180, 20), (100, 130)], close=True, dxfattribs={"extrusion": (0, 0, -1)})
    pl.dxf.elevation = (0, 0, 7)
    for i, v in enumerate(pl.vertices):
        v.dxf.location = Vec3(v.dxf.location.x, v.dxf.location.y, 100 * (i + 1))
    c.window((-200, 0), (0, 150))

    # thickness in plan view and in tilted views of the extrusion
    for key in ("z", "tilt-y45", "skew"):
        n = NORMALS[key]
        ocs = OCS(n)
        c = s.case(f"thickness-{key}", f"LINE/CIRCLE/ARC/SOLID/TEXT with thickness 20, extrusion {n}", tags=["thickness", "OCS", "LINE", "CIRCLE", "SOLID", "TEXT"], params={"extrusion": n, "thickness": 20})
        da = {"thickness": 20, "extrusion": n}
        c.msp.add_line((20, 20), (60, 40), dxfattribs=da)  # LINE: WCS points, 210 = thickness direction
        p = _place(ocs, Vec3(100, 40, 0))
        c.msp.add_circle(p, 15, dxfattribs=da)
        p = _place(ocs, Vec3(150, 40, 0))
        c.msp.add_arc(p, 15, 0, 180, dxfattribs=da)
        p = _place(ocs, Vec3(30, 100, 0))
        c.msp.add_solid([(p.x, p.y, p.z), (p.x + 30, p.y, p.z), (p.x, p.y + 20, p.z), (p.x + 30, p.y + 20, p.z)], dxfattribs=da)
        p = _place(ocs, Vec3(90, 100, 0))
        c.msp.add_text("Th", height=15, dxfattribs={**da, "insert": p})
        c.window((0, 0), (200, 150))

    # arbitrary random normals (seeded)
    for seed in range(1, 7):
        c = s.case(f"random-normal-{seed:04d}", f"CIRCLE+ARC+LWPOLYLINE with a random extrusion, seed {seed}", tags=["OCS", "CIRCLE", "ARC", "LWPOLYLINE"], seed=seed)
        rng = c.rng
        n = Vec3(rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.2, 1)).normalize()
        if rng.random() < 0.5:
            n = -n
        c.params["extrusion"] = [round(v, 9) for v in n]
        n = Vec3(c.params["extrusion"])
        ocs = OCS(n)
        p = _place(ocs, center)
        c.msp.add_circle(p, 35, dxfattribs={"extrusion": n})
        c.msp.add_arc(p, 20, rng.uniform(0, 360), rng.uniform(0, 360), dxfattribs={"extrusion": n})
        c.msp.add_lwpolyline([(p.x - 15, p.y), (p.x + 15, p.y, 0, 0, 1)], format="xyseb", close=True, dxfattribs={"extrusion": n, "elevation": p.z})
        c.window((0, 0), (200, 150))


    _question_cases(s)


def _zero_extrusion(data: bytes) -> bytes:
    """Byte filter: force 210=(0,0,0) on the entity drawn on layer ZEROEXT."""
    marker = b"  8\nZEROEXT\n"
    i = data.index(marker)
    j = data.index(b"\n  0\n", i)
    seg = data[i:j]
    if b"\n210\n" in seg:
        k = seg.index(b"\n210\n")
        k30 = seg.index(b"\n230\n", k)
        end = seg.find(b"\n", k30 + 5)
        end = len(seg) if end < 0 else end
        seg = seg[:k] + b"\n210\n0.0\n220\n0.0\n230\n0.0" + seg[end:]
    else:
        raise ValueError("ZEROEXT entity has no 210 group")
    return data[:i] + seg + data[j:]


def _question_cases(s: SuiteBuilder) -> None:
    # Q-0124: extrusion (0,0,0) per entity type (one type per case so a rejection stays local)
    for kind in ("arc", "circle", "spline", "lwpolyline", "hatch", "insert"):
        c = s.case(
            f"zero-extrusion-{kind}",
            f"{kind.upper()} with extrusion 210=(0,0,0) (right) beside a +Z twin (left)",
            tags=[kind.upper(), "OCS", "invalid"],
            questions=["Q-0124"],
            params={"kind": kind},
        )
        c.layer("ZEROEXT")
        c.allow_audit_errors = True
        if kind == "insert":
            blk = c.doc.blocks.new("F")
            blk.add_lwpolyline([(0, 0), (0, 60), (40, 60)])
            blk.add_line((0, 30), (25, 30))
        for layer, dx in (("0", 0), ("ZEROEXT", 100)):
            a = {"layer": layer}
            if layer == "ZEROEXT":
                # a tiny non-default extrusion makes ezdxf write 210 in its proper place; the byte
                # filter then replaces it with (0,0,0)
                a["extrusion"] = (0, 1e-9, 1)
            if kind == "arc":
                c.msp.add_arc((50 + dx, 75), 30, 0, 200, dxfattribs=a)
            elif kind == "circle":
                c.msp.add_circle((50 + dx, 75), 30, dxfattribs=a)
            elif kind == "spline":
                c.msp.add_open_spline([(20 + dx, 40), (40 + dx, 120), (60 + dx, 40), (80 + dx, 110)], dxfattribs=a)
            elif kind == "lwpolyline":
                c.msp.add_lwpolyline(
                    [(20 + dx, 40, 0, 0, 0.5), (80 + dx, 40, 0, 0, 0), (80 + dx, 110, 0, 0, 0), (20 + dx, 110, 0, 0, 0)],
                    format="xyseb", close=True, dxfattribs=a,
                )
            elif kind == "hatch":
                h = c.msp.add_hatch(color=1, dxfattribs=a)
                h.paths.add_polyline_path([(20 + dx, 40), (80 + dx, 40), (80 + dx, 110), (20 + dx, 110)], is_closed=True, flags=1)
            elif kind == "insert":
                c.msp.add_blockref("F", (30 + dx, 40), dxfattribs={**a, "rotation": 10})
        c.byte_filters.append(_zero_extrusion)
        c.window((0, 0), (200, 150))

    # Q-0104: legacy elevation 38 on an R12 CIRCLE (added to center z?) - answered by DXFOUT
    for i, z in enumerate([0.0, 3.0], 1):
        c = s.case(
            f"r12-elevation-{i:04d}",
            f"R12 CIRCLE with group 38=5 and center z={z}",
            tags=["CIRCLE", "elevation", "R12"],
            questions=["Q-0104"],
            params={"center_z": z},
            dxfversion="R12",
        )
        c.layer("ELEV38")
        c.msp.add_circle((100, 75, z), 40, dxfattribs={"layer": "ELEV38"})
        c.byte_filters.append(lambda d: d.replace(b"  8\nELEV38\n", b"  8\nELEV38\n 38\n5.0\n", 1))
        c.window((0, 0), (200, 150))

    # Q-0125/Q-0126: MTEXT with extrusion (text mirroring in OCS)
    for key in ("negz", "tilt-y45", "skew"):
        n = NORMALS[key]
        ocs = OCS(n)
        c = s.case(
            f"mtext-{key}",
            f"MTEXT 'Rg OCS' h=15 with extrusion {n}",
            tags=["MTEXT", "OCS"],
            questions=["Q-0125"] + (["Q-0126"] if key == "negz" else []),
            params={"extrusion": n},
        )
        mt = c.msp.add_mtext("Rg OCS", dxfattribs={"char_height": 15, "extrusion": n})
        # MTEXT insertion point is WCS; the text direction must lie in the OCS plane
        mt.dxf.insert = Vec3(100, 75, 0)
        mt.dxf.text_direction = ocs.to_wcs(Vec3(1, 0, 0))
        mt.dxf.attachment_point = 5
        c.window((0, 0), (200, 150))

    # Q-0128: TEXT/ATTRIB/HATCH/ARC inside mirrored INSERTs, 1..3 nesting levels, rotation 90
    for levels in (1, 2, 3):
        c = s.case(
            f"mirror-nesting-{levels}",
            f"Block with ARC/TEXT/HATCH/ATTRIB in {levels} nested INSERT level(s), each sx=-1 rot 90",
            tags=["INSERT", "mirror", "TEXT", "HATCH", "ATTRIB"],
            questions=["Q-0128"],
            params={"levels": levels},
        )
        b0 = c.doc.blocks.new("B0")
        b0.add_arc((0, 0), 12, 0, 120)
        b0.add_text("Fg", height=8, dxfattribs={"insert": (2, 2)})
        h = b0.add_hatch(color=1)
        h.paths.add_polyline_path([(-20, -20), (-5, -20), (-5, -5)], is_closed=True)
        b0.add_attdef("TAG", (-20, 5), dxfattribs={"height": 5})
        name = "B0"
        for k in range(1, levels):
            b = c.doc.blocks.new(f"B{k}")
            b.add_blockref(name, (0, 0), dxfattribs={"xscale": -1, "rotation": 90})
            name = f"B{k}"
        ins = c.msp.add_blockref(name, (100, 75), dxfattribs={"xscale": -1, "rotation": 90})
        if levels == 1:
            ins.add_auto_attribs({"TAG": "Att"})
        c.window((0, 0), (200, 150))
