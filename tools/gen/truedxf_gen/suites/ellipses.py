"""ELLIPSE: ratio, rotation, parameter ranges, full/partial, extrusion (note 03 §3.7)."""

from __future__ import annotations

import math

from ..core import SuiteBuilder, suite

TAU = math.tau


@suite("ellipses", "ELLIPSE: ratios, rotations, parameter ranges", layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    # ratio sweep (full ellipse, major axis along x)
    for i, ratio in enumerate([1.0, 0.999, 0.75, 0.5, 0.25, 0.1, 0.02, 1e-6], 1):
        c = s.case(f"ratio-{i:04d}", f"Full ELLIPSE a=80 ratio {ratio}", tags=["ELLIPSE"], questions=["Q-0164"] if ratio == 1.0 else ["Q-0165"] if ratio < 1e-5 else [], params={"ratio": ratio})
        c.msp.add_ellipse((100, 75), (80, 0), ratio)
        c.window((0, 0), (200, 150))
    # rotation of the major axis
    for i, ang in enumerate([0, 10, 30, 45, 90, 135, 180, 270, 333], 1):
        r = math.radians(ang)
        c = s.case(f"rotation-{i:04d}", f"ELLIPSE major axis at {ang} deg, ratio 0.4", tags=["ELLIPSE"], params={"angle": ang})
        c.msp.add_ellipse((100, 75), (60 * math.cos(r), 60 * math.sin(r)), 0.4)
        c.window((0, 0), (200, 150))
    # parameter ranges (41/42 are parameters, not angles)
    ranges = [
        (0, math.pi / 2), (math.pi / 2, math.pi), (0, math.pi), (math.pi, 0), (5.5, 0.5), (0, TAU),
        (-math.pi / 2, math.pi / 2), (0, 7.0), (1.0, 1.0), (0.2, 0.2 + 1e-4), (math.radians(30), math.radians(120)),
        (TAU, 2 * TAU), (-TAU, 0),
    ]
    for i, (p0, p1) in enumerate(ranges, 1):
        c = s.case(
            f"param-{i:04d}",
            f"Elliptical arc ratio 0.5 params {p0:.4f}..{p1:.4f}",
            tags=["ELLIPSE", "parameters"],
            questions=["Q-0165"] if p0 == p1 else [],
            params={"start_param": p0, "end_param": p1},
        )
        c.msp.add_ellipse((100, 75), (70, 0), 0.5, p0, p1)
        c.msp.add_line((95, 75), (105, 75))
        c.msp.add_line((100, 70), (100, 80))
        c.window((0, 0), (200, 150))
    # angle vs parameter: an ELLIPSE arc 30..120 deg as *parameters* next to rays at 30/120 deg
    c = s.case("param-vs-angle-0001", "Elliptical arc with params 30..120 deg and RAYs at geometric 30/120 deg", tags=["ELLIPSE", "parameters"])
    c.msp.add_ellipse((100, 75), (80, 0), 0.3, math.radians(30), math.radians(120))
    for a in (30, 120):
        c.msp.add_line((100, 75), (100 + 90 * math.cos(math.radians(a)), 75 + 90 * math.sin(math.radians(a))))
    c.window((0, 0), (200, 150))
    # minor axis longer than major (ratio > 1 is invalid) - open check
    for i, bad in enumerate([1.5, 1.0000001, -0.5, 1e-10], 1):
        c = s.case(f"ratio-invalid-{i:04d}", f"ELLIPSE a=40 with ratio {bad} (out of the valid range 1e-6..1)", tags=["ELLIPSE", "invalid"],
                   questions=["Q-0164"] if bad >= 1 else ["Q-0165"], params={"ratio": bad})
        c.allow_audit_errors = True
        # ezdxf clamps the ratio on export: write a marker value and patch the bytes
        c.msp.add_ellipse((100, 75), (40, 0), 0.123456, 0, math.pi / 2 if bad < 0 else math.tau)
        c.byte_filters.append(lambda d, bad=bad: d.replace(b"\n 40\n0.123456\n", f"\n 40\n{bad!r}\n".encode(), 1))
        c.msp.add_ellipse((100, 75), (40, 0), 0.5, 0, math.pi / 2, dxfattribs={"color": 1}) if bad < 0 else None
        c.window((0, 0), (200, 150))
    # parameter span slightly above 2*pi: full ellipse or tiny arc?
    for i, (p0, p1) in enumerate([(0.0, 6.2831855), (0.1, 0.1 + math.tau + 1e-7), (0.0, math.tau - 1e-7)], 1):
        c = s.case(f"param-2pi-{i:04d}", f"ELLIPSE params {p0}..{p1!r}", tags=["ELLIPSE", "parameters"], questions=["Q-0166"], params={"start_param": p0, "end_param": p1})
        e = c.msp.add_ellipse((100, 75), (70, 0), 0.5)
        e.dxf.start_param = p0
        e.dxf.end_param = p1
        c.window((0, 0), (200, 150))
    # extrusion not perpendicular to the major axis
    c = s.case("extrusion-not-perpendicular", "ELLIPSE major (40,0,0) with extrusion (0.3,0,1) (not perpendicular)", tags=["ELLIPSE", "OCS", "invalid"], questions=["Q-0167"])
    c.allow_audit_errors = True
    e = c.msp.add_ellipse((100, 75), (40, 0), 0.5)
    e.dxf.extrusion = (0.3, 0, 1)
    c.window((0, 0), (200, 150))
    # size / tessellation sweep
    for i, (a, pxu) in enumerate([(0.5, 10), (5, 10), (80, 10), (800, 1), (8000, 0.1), (80, 40)], 1):
        c = s.case(f"size-{i:04d}", f"ELLIPSE a={a} ratio 0.6 rotated 20 at {pxu} px/unit", tags=["ELLIPSE", "tessellation"], questions=["Q-0181"], params={"major": a, "px_per_unit": pxu})
        r = math.radians(20)
        c.msp.add_ellipse((0, 0), (a * math.cos(r), a * math.sin(r)), 0.6)
        c.window_center((0, 0), pxu)
    # extrusion (0,0,-1): parameter direction is reversed in WCS
    for i, (ext, p0, p1) in enumerate([((0, 0, -1), 0, math.pi / 2), ((0, 0, -1), 0.5, 5.0), ((0, 0.6, 0.8), 0, math.pi)], 1):
        c = s.case(f"extrusion-{i:04d}", f"Elliptical arc params {p0}..{p1:.3f} with extrusion {ext}", tags=["ELLIPSE", "OCS"], params={"extrusion": ext})
        from ezdxf.math import OCS, Vec3

        ocs = OCS(ext)
        major = ocs.to_wcs(Vec3(70, 0, 0))
        c.msp.add_ellipse((100, 75, 0), major, 0.5, p0, p1, dxfattribs={"extrusion": ext})
        c.msp.add_point((100, 75))
        c.window((0, 0), (200, 150))
    # seeded random ellipse arcs
    for seed in range(1, 7):
        c = s.case(f"random-{seed:04d}", f"Random ELLIPSE arcs, seed {seed}", tags=["ELLIPSE"], seed=seed)
        rng = c.rng
        for _ in range(12):
            a = rng.uniform(5, 60)
            ang = rng.uniform(0, TAU)
            c.msp.add_ellipse((rng.uniform(30, 170), rng.uniform(30, 120)), (a * math.cos(ang), a * math.sin(ang)),
                              rng.uniform(0.05, 1.0), rng.uniform(0, TAU), rng.uniform(0, TAU))
        c.window((0, 0), (200, 150))
