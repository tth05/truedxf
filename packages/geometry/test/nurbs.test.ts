import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    bezierBounds,
    bezierPoint,
    clampedUniformKnots,
    Matrix44,
    NurbsCurve,
    roundKnots,
    splitBezier,
    uniformKnots,
} from "../src/index.ts";
import ref from "./fixtures/ezdxf-reference.json" with { type: "json" };
import { distanceToPolyline, expectVecClose, FC_RUNS } from "./helpers.ts";

function curve3(cps: number[][], knots: number[], degree: number, weights?: number[]): NurbsCurve {
    return new NurbsCurve(
        degree,
        3,
        Float64Array.from(cps.flat()),
        Float64Array.from(knots),
        weights ? Float64Array.from(weights) : undefined,
    );
}

const RATIONAL_CPS = [
    [0, 0, 0],
    [1, 3, 0],
    [4, 4, 1],
    [6, 1, 0],
    [9, 2, -1],
    [10, 6, 0],
];
const RATIONAL_W = [1, 0.5, 2, 1, 0.75, 1];
const RATIONAL_KNOTS = [0, 0.5, 1, 2, 3, 3, 4, 5, 6.5, 7];

describe("NURBS evaluation (note 03 §3.8.5)", () => {
    const c = curve3(RATIONAL_CPS, RATIONAL_KNOTS, 3, RATIONAL_W);

    it("matches ezdxf for a rational, unclamped curve with a double knot", () => {
        expect(c.domainStart).toBe(2);
        expect(c.domainEnd).toBe(4);
        ref.rational.params.forEach((u, i) => {
            expectVecClose(c.pointAt(u), ref.rational.points[i]!, 1e-12);
        });
    });

    it("matches ezdxf first and second derivatives", () => {
        ref.rational.params.forEach((u, i) => {
            const d = c.derivativesAt(u, 2);
            const expected = ref.rational.derivs[i]!;
            for (let k = 0; k <= 2; k++) expectVecClose(d[k]!, expected[k]!, 1e-9);
        });
    });

    it("evaluates AutoCAD periodic storage as a standard NURBS (note 03 §3.8.4)", () => {
        const p = curve3(ref.periodic.cps, ref.periodic.knots, 3);
        ref.periodic.params.forEach((u, i) => {
            expectVecClose(p.pointAt(u), ref.periodic.points[i]!, 1e-12);
        });
        // Closed: start == end.
        expectVecClose(p.pointAt(p.domainStart), p.pointAt(p.domainEnd), 1e-12);
    });

    it("interpolates the end points of a clamped curve", () => {
        const k = clampedUniformKnots(5, 3);
        expect(Array.from(k)).toEqual([0, 0, 0, 0, 1, 2, 2, 2, 2]);
        const cc = curve3(RATIONAL_CPS.slice(0, 5), Array.from(k), 3);
        expectVecClose(cc.pointAt(0), [0, 0, 0], 0);
        expectVecClose(cc.pointAt(2), [9, 2, -1], 1e-15);
        expect(Array.from(uniformKnots(3, 2))).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("supports degree 1 (polyline) and high degrees", () => {
        const l = curve3(
            [
                [0, 0, 0],
                [1, 0, 0],
                [1, 1, 0],
            ],
            [0, 0, 1, 2, 2],
            1,
        );
        expectVecClose(l.pointAt(0.5), [0.5, 0, 0], 1e-15);
        expectVecClose(l.pointAt(1.5), [1, 0.5, 0], 1e-15);
        // Degree 5 Bézier as NURBS equals de Casteljau.
        const cps = [0, 1, 2, 3, 4, 5].map((i) => [i, (i * i) % 7, i % 2]);
        const b = curve3(cps, [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], 5);
        const bz = { degree: 5, dim: 3, points: Float64Array.from(cps.flat()) };
        for (const t of [0, 0.25, 0.7, 1]) expectVecClose(b.pointAt(t), bezierPoint(bz, t), 1e-13);
    });

    it("validates its input", () => {
        expect(() => curve3([[0, 0, 0]], [0, 0, 1, 1], 1)).toThrow();
        expect(() => curve3(RATIONAL_CPS, [0, 1, 2], 3)).toThrow();
        expect(() => curve3(RATIONAL_CPS, [0, 0.5, 1, 2, 3, 3, 4, 5, 6.5, 1], 3)).toThrow();
    });
});

/** Random valid NURBS: degree 1..5, 2D, clamped or not, optional positive weights. */
const nurbsArb = fc
    .record({
        degree: fc.integer({ min: 1, max: 5 }),
        extra: fc.integer({ min: 0, max: 6 }),
        clamped: fc.boolean(),
        rational: fc.boolean(),
        seed: fc.array(fc.double({ min: -100, max: 100, noNaN: true }), { minLength: 64, maxLength: 64 }),
        gaps: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 32, maxLength: 32 }),
        w: fc.array(fc.double({ min: 0.2, max: 5, noNaN: true }), { minLength: 32, maxLength: 32 }),
    })
    .map(({ degree, extra, clamped, rational, seed, gaps, w }) => {
        const count = degree + 1 + extra;
        const points = Float64Array.from(seed.slice(0, count * 2));
        const m = count + degree + 1;
        const knots = new Float64Array(m);
        let k = 0;
        for (let i = 0; i < m; i++) {
            // Gaps of 0 create repeated knots (multiplicity up to the degree keeps continuity).
            if (i > 0) k += gaps[i % gaps.length]!;
            knots[i] = k;
        }
        if (clamped) {
            for (let i = 0; i <= degree; i++) {
                knots[i] = knots[degree]!;
                knots[m - 1 - i] = knots[m - 1 - degree]!;
            }
        }
        return {
            degree,
            points,
            knots,
            weights: rational ? Float64Array.from(w.slice(0, count)) : undefined,
        };
    })
    .filter(({ knots, degree, points }) => {
        const count = points.length / 2;
        if (!(knots[count]! > knots[degree]!)) return false;
        // Interior multiplicity ≤ degree (no discontinuities) keeps the tests simple.
        const a = knots[degree]!;
        const b = knots[count]!;
        for (let i = 0; i + degree < knots.length; i++) {
            if (knots[i]! > a && knots[i]! < b && knots[i] === knots[i + degree]) return false;
        }
        return true;
    })
    .map(({ degree, points, knots, weights }) => new NurbsCurve(degree, 2, points, knots, weights));

function samples(c: NurbsCurve, n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i <= n; i++) out.push(c.domainStart + ((c.domainEnd - c.domainStart) * i) / n);
    return out;
}

describe("NURBS algorithms (properties)", () => {
    it("knot insertion does not change the curve", () => {
        fc.assert(
            fc.property(
                nurbsArb,
                fc.double({ min: 0, max: 1, noNaN: true }),
                fc.integer({ min: 1, max: 3 }),
                (c, f, r) => {
                    const u = c.domainStart + (c.domainEnd - c.domainStart) * f;
                    const d = c.insertKnot(u, r);
                    expect(d.count).toBe(c.count + r);
                    for (const s of samples(c, 20)) expectVecClose(d.pointAt(s), c.pointAt(s), 1e-9);
                },
            ),
            FC_RUNS,
        );
    });

    it("Bézier decomposition reproduces the NURBS exactly", () => {
        fc.assert(
            fc.property(nurbsArb, (c) => {
                const pieces = c.bezierSegments();
                expect(pieces[0]!.u0).toBe(c.domainStart);
                expect(pieces[pieces.length - 1]!.u1).toBe(c.domainEnd);
                for (const piece of pieces) {
                    expect(piece.degree).toBe(c.degree);
                    for (const t of [0, 0.2, 0.5, 0.9, 1]) {
                        const u = piece.u0 + (piece.u1 - piece.u0) * t;
                        expectVecClose(bezierPoint(piece, t), c.pointAt(u), 1e-9);
                    }
                }
            }),
            FC_RUNS,
        );
    });

    it("derivatives agree with finite differences", () => {
        fc.assert(
            fc.property(nurbsArb, fc.double({ min: 0.05, max: 0.95, noNaN: true }), (c, f) => {
                const u = c.domainStart + (c.domainEnd - c.domainStart) * f;
                // Stay away from knots (derivatives may jump there for degree 1).
                for (const k of c.knots) fc.pre(Math.abs(k - u) > 1e-3);
                const h = 1e-6;
                const d = c.derivativesAt(u, 1)[1]!;
                const a = c.pointAt(u - h);
                const b = c.pointAt(u + h);
                const scale = Math.max(1, Math.hypot(d[0]!, d[1]!));
                for (let k = 0; k < 2; k++)
                    expect(Math.abs((b[k]! - a[k]!) / (2 * h) - d[k]!)).toBeLessThan(1e-3 * scale);
            }),
            FC_RUNS,
        );
    });

    it("bounds contain the curve and are tight", () => {
        fc.assert(
            fc.property(nurbsArb, (c) => {
                const box = c.bounds();
                const hull = [Infinity, Infinity, -Infinity, -Infinity];
                for (let i = 0; i < c.count; i++) {
                    hull[0] = Math.min(hull[0]!, c.points[2 * i]!);
                    hull[1] = Math.min(hull[1]!, c.points[2 * i + 1]!);
                    hull[2] = Math.max(hull[2]!, c.points[2 * i]!);
                    hull[3] = Math.max(hull[3]!, c.points[2 * i + 1]!);
                }
                const sampled = [Infinity, Infinity, -Infinity, -Infinity];
                for (const s of [...samples(c, 3000), ...c.knots]) {
                    const p = c.pointAt(s);
                    sampled[0] = Math.min(sampled[0]!, p[0]!);
                    sampled[1] = Math.min(sampled[1]!, p[1]!);
                    sampled[2] = Math.max(sampled[2]!, p[0]!);
                    sampled[3] = Math.max(sampled[3]!, p[1]!);
                }
                // Contains every sample.
                expect(sampled[0]!).toBeGreaterThanOrEqual(box[0]! - 1e-9);
                expect(sampled[1]!).toBeGreaterThanOrEqual(box[1]! - 1e-9);
                expect(sampled[2]!).toBeLessThanOrEqual(box[2]! + 1e-9);
                expect(sampled[3]!).toBeLessThanOrEqual(box[3]! + 1e-9);
                // Never looser than the control hull, and close to the densely sampled box.
                expect(box[0]!).toBeGreaterThanOrEqual(hull[0]! - 1e-9);
                expect(box[3]!).toBeLessThanOrEqual(hull[3]! + 1e-9);
                const size = Math.max(hull[2]! - hull[0]!, hull[3]! - hull[1]!, 1);
                for (let k = 0; k < 4; k++) expect(Math.abs(box[k]! - sampled[k]!)).toBeLessThan(2e-3 * size);
            }),
            { ...FC_RUNS, numRuns: 100 },
        );
    });

    it("flattening stays within the tolerance", () => {
        fc.assert(
            fc.property(nurbsArb, fc.constantFrom(0.01, 0.1, 1), (c, tol) => {
                const poly = c.flatten(tol);
                expectVecClose(poly.subarray(0, 2), c.pointAt(c.domainStart), 1e-12);
                expectVecClose(poly.subarray(poly.length - 2), c.pointAt(c.domainEnd), 1e-12);
                let worst = 0;
                for (const s of samples(c, 1500)) {
                    const p = c.pointAt(s);
                    worst = Math.max(worst, distanceToPolyline(p[0]!, p[1]!, poly));
                }
                expect(worst).toBeLessThanOrEqual(tol * (1 + 1e-6));
            }),
            { ...FC_RUNS, numRuns: 100 },
        );
    });

    it("reverse traverses the same points backwards", () => {
        fc.assert(
            fc.property(nurbsArb, fc.double({ min: 0, max: 1, noNaN: true }), (c, f) => {
                const r = c.reverse();
                const u = c.domainStart + (c.domainEnd - c.domainStart) * f;
                const ur = r.domainEnd - (u - c.domainStart);
                expectVecClose(r.pointAt(ur), c.pointAt(u), 1e-9);
            }),
            FC_RUNS,
        );
    });

    it("is affine invariant (transform / project)", () => {
        const c = curve3(RATIONAL_CPS, RATIONAL_KNOTS, 3, RATIONAL_W);
        const m = Matrix44.product(
            Matrix44.translation(3, 4, 5),
            Matrix44.rotationAxis({ x: 1, y: 1, z: 0 }, 0.4),
        );
        const t = c.transform(m);
        const p2 = c.project(m);
        for (const u of [2, 2.5, 3.3, 4]) {
            const q = c.pointAt(u);
            const e = m.transformPoint({ x: q[0]!, y: q[1]!, z: q[2]! });
            expectVecClose(t.pointAt(u), [e.x, e.y, e.z], 1e-12);
            expectVecClose(p2.pointAt(u), [e.x, e.y], 1e-12);
        }
    });
});

describe("Bézier helpers", () => {
    it("splits and bounds rational Béziers (quarter circle)", () => {
        const q = {
            degree: 2,
            dim: 2,
            points: Float64Array.of(1, 0, 1, 1, 0, 1),
            weights: Float64Array.of(1, Math.SQRT1_2, 1),
        };
        for (const t of [0, 0.3, 0.5, 1]) {
            const p = bezierPoint(q, t);
            expect(Math.hypot(p[0]!, p[1]!)).toBeCloseTo(1, 14);
        }
        const [l, r] = splitBezier(q, 0.5);
        const m = bezierPoint(l, 1);
        expectVecClose(bezierPoint(r, 0), m, 1e-15);
        expectVecClose(m, [Math.SQRT1_2, Math.SQRT1_2], 1e-14);
        const box = bezierBounds(q);
        expectVecClose(box, [0, 0, 1, 1], 1e-12);
    });

    it("rounds knots like ezdxf", () => {
        expect(Array.from(roundKnots(Float64Array.of(0, 0.30000000001, 1), 1e-10))).toEqual([0, 0.3, 1]);
    });
});
