import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    arbitraryAxis,
    buildSplineCurve,
    bulgePolylineToSubpath,
    curve3Bounds,
    ellipseFromDxf,
    ellipticArc3PointAtParam,
    ellipticArcCurve3,
    flattenSubpath,
    line3,
    Matrix44,
    ocsArcToEllipticArc3,
    ocsToWcs,
    polyline3,
    projectCurve3,
    projectPlanarPath,
    segmentEnd,
    segmentPointAt,
    segmentStart,
    TAU,
    transformCurve3,
} from "../src/index.ts";
import { dirArb, distanceToPolyline, expectPointClose, FC_RUNS } from "./helpers.ts";

const view = Matrix44.product(
    Matrix44.scaling(3, 3, 3),
    Matrix44.rotationAxis({ x: 1, y: -1, z: 0.5 }, 0.8),
    Matrix44.translation(-5, 2, 1),
);

describe("projection of 3D curves", () => {
    it("projects lines and polylines", () => {
        const sp = projectCurve3(line3({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }), view);
        const q = view.transformPoint({ x: 4, y: 5, z: 6 });
        expectPointClose(segmentEnd(sp.segments[0]!), { x: q.x, y: q.y }, 1e-12);
        const pl = projectCurve3(
            polyline3(
                [
                    { x: 0, y: 0, z: 0 },
                    { x: 1, y: 0, z: 1 },
                    { x: 1, y: 1, z: 2 },
                ],
                true,
            ),
            view,
        );
        expect(pl.segments.length).toBe(2);
        expect(pl.closed).toBe(true);
        expect(
            curve3Bounds(
                polyline3([
                    { x: 0, y: 0, z: 0 },
                    { x: 1, y: -1, z: 2 },
                ]),
            ).maxZ,
        ).toBe(2);
    });

    it("projects circles to arcs in plan view and to elliptic arcs otherwise", () => {
        const circle = ellipticArcCurve3(
            ocsArcToEllipticArc3({ x: 0, y: 0, z: 0 }, 5, 0, TAU, { x: 0, y: 0, z: -1 }),
        );
        const plan = projectCurve3(circle, Matrix44.scaling(2, 2, 2));
        expect(plan.segments[0]!.kind).toBe("arc");
        expect(plan.closed).toBe(true);
        // Extrusion −Z: the projected circle runs clockwise.
        const s = plan.segments[0]!;
        expect(s.kind === "arc" && s.sweep < 0).toBe(true);
        expect(projectCurve3(circle, view).segments[0]!.kind).toBe("ellipticArc");
    });

    it("projects elliptic arcs and NURBS exactly (property)", () => {
        fc.assert(
            fc.property(dirArb, fc.double({ min: 0, max: 1, noNaN: true }), (n, f) => {
                const e = ellipseFromDxf({
                    center: { x: 1, y: 2, z: 3 },
                    majorAxis: { x: 4, y: 1, z: 0 },
                    ratio: 0.4,
                    startParam: 0.5,
                    endParam: 4,
                    extrusion: n,
                });
                const sp = projectCurve3(ellipticArcCurve3(e), view);
                const q = view.transformPoint(ellipticArc3PointAtParam(e, e.start + e.sweep * f));
                expectPointClose(segmentPointAt(sp.segments[0]!, f), { x: q.x, y: q.y }, 1e-9);
            }),
            FC_RUNS,
        );
        const spline = buildSplineCurve({
            degree: 3,
            fitPoints: [
                { x: 0, y: 0, z: 0 },
                { x: 5, y: 5, z: 1 },
                { x: 10, y: 0, z: 2 },
            ],
        }).curve!;
        const sp = projectCurve3({ kind: "nurbs", curve: spline }, view);
        const t = transformCurve3({ kind: "nurbs", curve: spline }, view);
        for (const u of [0, 0.3, 1]) {
            const p = t.kind === "nurbs" ? t.curve.pointAt(u) : new Float64Array(3);
            expectPointClose(segmentPointAt(sp.segments[0]!, u), { x: p[0]!, y: p[1]! }, 1e-9);
        }
    });

    it("maps planar OCS paths (LWPOLYLINE with elevation and extrusion) exactly", () => {
        const ext = { x: 0.3, y: -0.2, z: 1 };
        const elevation = 7;
        const ocs = bulgePolylineToSubpath(
            [
                { x: 0, y: 0, bulge: 0.5 },
                { x: 10, y: 0 },
                { x: 10, y: 10, bulge: -1 },
                { x: 0, y: 10 },
            ],
            true,
        );
        const path = projectPlanarPath({ subpaths: [ocs] }, ext, elevation, view);
        const axes = arbitraryAxis(ext);
        ocs.segments.forEach((s, i) => {
            for (const t of [0, 0.4, 1]) {
                const p = segmentPointAt(s, t);
                const w = view.transformPoint(ocsToWcs({ x: p.x, y: p.y, z: elevation }, axes));
                expectPointClose(segmentPointAt(path.subpaths[0]!.segments[i]!, t), { x: w.x, y: w.y }, 1e-9);
            }
        });
        // Flattened result is closed and starts where it should.
        const flat = flattenSubpath(path.subpaths[0]!, 0.1);
        const st = segmentStart(path.subpaths[0]!.segments[0]!);
        expect(distanceToPolyline(st.x, st.y, flat.points, true)).toBe(0);
    });
});
