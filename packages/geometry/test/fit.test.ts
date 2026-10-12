import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    BandedMatrix,
    buildSplineCurve,
    fitParameters,
    interpolateFitPoints,
    knotParameterizationFromFlags,
    type Vec3,
} from "../src/index.ts";
import ref from "./fixtures/ezdxf-reference.json" with { type: "json" };
import { expectVecClose, FC_RUNS } from "./helpers.ts";

const FIT: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 5, z: 0 },
    { x: 20, y: -3, z: 1 },
    { x: 35, y: 8, z: 2 },
    { x: 40, y: 0, z: 0 },
];

function expectCurve(
    curve: ReturnType<typeof interpolateFitPoints>,
    expected: { cps: number[][]; knots: number[] },
) {
    expect(curve).toBeDefined();
    expectVecClose(curve!.knots, expected.knots, 1e-14);
    expect(curve!.degree).toBe(3);
    // Absolute tolerance: ezdxf's solver leaves ~1e-15 residue where the exact value is 0.
    const flat = expected.cps.flat();
    const got = curve!.points;
    expect(got.length).toBe(flat.length);
    for (let i = 0; i < flat.length; i++) expect(Math.abs(got[i]! - flat[i]!)).toBeLessThan(1e-11);
}

describe("fit-point interpolation, AutoCAD method (note 03 §3.8.6)", () => {
    it("matches ezdxf fit_points_to_cad_cv without tangents (natural ends)", () => {
        expectCurve(interpolateFitPoints(FIT), ref.fit_natural);
    });

    it("matches ezdxf with end tangents scaled by the total chord length", () => {
        expectCurve(
            interpolateFitPoints(FIT, {
                startTangent: { x: 1, y: 1, z: 0 },
                endTangent: { x: 0, y: -1, z: 0 },
            }),
            ref.fit_tangents,
        );
    });

    it("matches ezdxf for sqrt-chord and uniform parameterizations with tangents", () => {
        const tangents = { startTangent: { x: 1, y: 1, z: 0 }, endTangent: { x: 0, y: -1, z: 0 } };
        expectCurve(
            interpolateFitPoints(FIT, { ...tangents, parameterization: "sqrtChord" }),
            ref.fit_tangents_sqrt,
        );
        expectCurve(
            interpolateFitPoints(FIT, { ...tangents, parameterization: "uniform" }),
            ref.fit_tangents_uniform,
        );
    });

    it("matches ezdxf for two and three fit points", () => {
        const two = interpolateFitPoints([
            { x: 0, y: 0, z: 0 },
            { x: 3, y: 4, z: 0 },
        ]);
        expectCurve(two, ref.fit_two);
        const three = interpolateFitPoints([
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 2, z: 0 },
            { x: 4, y: 2, z: 0 },
        ]);
        expectCurve(three, ref.fit_three);
    });

    it("passes through every fit point with zero end curvature (property)", () => {
        const pts = fc
            .array(
                fc.record({
                    x: fc.integer({ min: -100, max: 100 }),
                    y: fc.integer({ min: -100, max: 100 }),
                    z: fc.constant(0),
                }),
                {
                    minLength: 2,
                    maxLength: 30,
                },
            )
            .map((a) => a.filter((p, i) => i === 0 || p.x !== a[i - 1]!.x || p.y !== a[i - 1]!.y))
            .filter((a) => a.length >= 2);
        fc.assert(
            fc.property(pts, (fit) => {
                const c = interpolateFitPoints(fit);
                fc.pre(c !== undefined);
                const t = fitParameters(fit, "chord");
                fit.forEach((q, k) => {
                    expectVecClose(c!.pointAt(t[k]!), [q.x, q.y, q.z], 1e-7);
                });
                const scale = Math.max(1, ...Array.from(c!.points, Math.abs));
                for (const u of [0, 1]) {
                    const d2 = c!.derivativesAt(u, 2)[2]!;
                    expect(Math.hypot(d2[0]!, d2[1]!, d2[2]!)).toBeLessThan(1e-6 * scale);
                }
            }),
            FC_RUNS,
        );
    });

    it("honours a single tangent at its end only", () => {
        const c = interpolateFitPoints(FIT, { startTangent: { x: 0, y: 2, z: 0 } })!;
        const d = c.derivativesAt(0, 2);
        expect(Math.abs(d[1]![0]!)).toBeLessThan(1e-9); // start direction ∥ +Y
        expect(d[1]![1]!).toBeGreaterThan(0);
        expect(Math.hypot(...c.derivativesAt(1, 2)[2]!)).toBeLessThan(1e-9); // natural end
    });

    it("rejects degenerate input", () => {
        expect(interpolateFitPoints([{ x: 1, y: 1, z: 1 }])).toBeUndefined();
        expect(
            interpolateFitPoints([
                { x: 1, y: 1, z: 1 },
                { x: 1, y: 1, z: 1 },
            ]),
        ).toBeUndefined();
    });

    it("maps flag bits to parameterizations", () => {
        expect(knotParameterizationFromFlags(0)).toBe("chord");
        expect(knotParameterizationFromFlags(32 | 1024)).toBe("chord");
        expect(knotParameterizationFromFlags(64)).toBe("sqrtChord");
        expect(knotParameterizationFromFlags(128 | 1024 | 8 | 1)).toBe("uniform");
    });
});

describe("SPLINE builder (note 03 §3.8.3)", () => {
    it("prefers control points over fit points", () => {
        const r = buildSplineCurve({
            degree: 2,
            controlPoints: [
                { x: 0, y: 0, z: 0 },
                { x: 1, y: 1, z: 0 },
                { x: 2, y: 0, z: 0 },
            ],
            knots: [0, 0, 0, 1, 1, 1],
            fitPoints: FIT,
        });
        expect(r.source).toBe("control");
        expect(r.issues).toEqual([]);
        expectVecClose(r.curve!.pointAt(0.5), [1, 0.5, 0], 1e-15);
    });

    it("builds from fit points only (always cubic, ignores degree)", () => {
        const r = buildSplineCurve({ degree: 2, fitPoints: FIT, startTangent: { x: 0, y: 0, z: 0 } });
        expect(r.source).toBe("fit");
        expect(r.curve!.degree).toBe(3);
        // The zero tangent is dropped → same as natural.
        expectVecClose(r.curve!.points, interpolateFitPoints(FIT)!.points, 0);
    });

    it("repairs bad data and reports it", () => {
        const cps = [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 1, z: 0 },
            { x: 2, y: 0, z: 0 },
        ];
        const r = buildSplineCurve({ degree: 3, controlPoints: cps, knots: [0, 1], weights: [1, 2] });
        expect(r.curve!.degree).toBe(2);
        expect(r.curve!.weights).toBeUndefined();
        expect(r.issues.length).toBe(3);
        expect(buildSplineCurve({ degree: 3 }).curve).toBeUndefined();
    });

    it("uses weights when one per control point is given", () => {
        const r = buildSplineCurve({
            degree: 2,
            controlPoints: [
                { x: 1, y: 0, z: 0 },
                { x: 1, y: 1, z: 0 },
                { x: 0, y: 1, z: 0 },
            ],
            knots: [0, 0, 0, 1, 1, 1],
            weights: [1, Math.SQRT1_2, 1],
        });
        const p = r.curve!.pointAt(0.37);
        expect(Math.hypot(p[0]!, p[1]!)).toBeCloseTo(1, 14);
    });
});

describe("BandedMatrix", () => {
    it("solves with pivoting", () => {
        const a = new BandedMatrix(3, 1, 1);
        // [[0 1 0],[1 0 1],[0 1 1]] needs a row swap at k = 0.
        a.set(0, 1, 1);
        a.set(1, 0, 1);
        a.set(1, 2, 1);
        a.set(2, 1, 1);
        a.set(2, 2, 1);
        const x = a.solve(Float64Array.of(2, 4, 5), 1)!;
        expectVecClose(x, [1, 2, 3], 1e-15);
        const s = new BandedMatrix(2, 1, 1);
        s.set(0, 0, 1);
        s.set(0, 1, 1);
        s.set(1, 0, 1);
        s.set(1, 1, 1);
        expect(s.solve(Float64Array.of(1, 1), 1)).toBeUndefined();
    });
});
