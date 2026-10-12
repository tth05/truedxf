import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    BooleanOp,
    Bounds2,
    booleanPolygons,
    clipPolygons,
    clipPolylines,
    clipPolylineToRect,
    FillRule,
    fixedPointFor,
    fromFixedX,
    normalizePolygons,
    pointInRings,
    polygonsArea,
    ringArea,
    toFixedX,
    trianglesArea,
    triangulateFill,
    triangulatePolygons,
} from "../src/index.ts";
import { distanceToPolyline, expectClose } from "./helpers.ts";

const rect = (x0: number, y0: number, x1: number, y1: number) =>
    Float64Array.of(x0, y0, x1, y0, x1, y1, x0, y1);

/** Coverage count of a point by a triangle list (strictly inside only). */
function coverage(tri: Float64Array, x: number, y: number): number {
    let n = 0;
    for (let i = 0; i < tri.length; i += 6) {
        const s = (ax: number, ay: number, bx: number, by: number) =>
            (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        const d1 = s(tri[i]!, tri[i + 1]!, tri[i + 2]!, tri[i + 3]!);
        const d2 = s(tri[i + 2]!, tri[i + 3]!, tri[i + 4]!, tri[i + 5]!);
        const d3 = s(tri[i + 4]!, tri[i + 5]!, tri[i]!, tri[i + 1]!);
        if ((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0)) n++;
    }
    return n;
}

function perimeter(r: Float64Array): number {
    let l = 0;
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        l += Math.hypot(r[2 * j]! - r[2 * i]!, r[2 * j + 1]! - r[2 * i + 1]!);
    }
    return l;
}

const polyArb = fc
    .array(fc.tuple(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 })), {
        minLength: 3,
        maxLength: 12,
    })
    .map((pts) => Float64Array.from(pts.flat()));

describe("fixed point", () => {
    it("uses a power-of-two quantum ≤ tol/64 and round-trips grid points", () => {
        const b = new Bounds2().addXY(-1000, -1000).addXY(3000, 2000);
        const fp = fixedPointFor(b, 0.1);
        expect(Math.log2(fp.scale) % 1).toBe(0);
        expect(1 / fp.scale).toBeLessThanOrEqual(0.1 / 64);
        expect(1 / fp.scale).toBeGreaterThan(0.1 / 128);
        const x = 1234.5678;
        expect(Math.abs(fromFixedX(fp, toFixedX(fp, x)) - x)).toBeLessThanOrEqual(0.5 / fp.scale);
    });

    it("coarsens the grid for absurd extents", () => {
        const b = new Bounds2().addXY(-1e15, 0).addXY(1e15, 1);
        const fp = fixedPointFor(b, 1e-6);
        expect(Math.abs(toFixedX(fp, 1e15))).toBeLessThanOrEqual(2 ** 46);
    });
});

describe("triangulateFill", () => {
    it("fills a square with a hole (even-odd) with the exact area", () => {
        const tri = triangulateFill([rect(0, 0, 10, 10), rect(2, 2, 8, 8)]);
        expectClose(trianglesArea(tri), 100 - 36, 1e-9);
        expect(coverage(tri, 1.13, 0.71)).toBe(1);
        expect(coverage(tri, 5.13, 5.71)).toBe(0);
    });

    it("nonzero keeps a same-orientation inner ring filled", () => {
        const tri = triangulateFill([rect(0, 0, 10, 10), rect(2, 2, 8, 8)], { fillRule: FillRule.NonZero });
        expectClose(trianglesArea(tri), 100, 1e-9);
    });

    it("handles a self-intersecting bow tie", () => {
        const bow = Float64Array.of(0, 0, 10, 10, 10, 0, 0, 10);
        const tri = triangulateFill([bow]);
        expectClose(trianglesArea(tri), 50, 1e-9);
    });

    it("island inside a hole is filled", () => {
        const tri = triangulateFill([rect(0, 0, 30, 30), rect(5, 5, 25, 25), rect(10, 10, 20, 20)]);
        expectClose(trianglesArea(tri), 900 - 400 + 100, 1e-9);
        expect(coverage(tri, 15.13, 15.71)).toBe(1);
        expect(coverage(tri, 7.13, 7.71)).toBe(0);
    });

    it("property: triangle area = normalized area; coverage matches the fill rule", () => {
        fc.assert(
            fc.property(fc.array(polyArb, { minLength: 1, maxLength: 3 }), fc.boolean(), (rings, nz) => {
                const rule = nz ? FillRule.NonZero : FillRule.EvenOdd;
                const tri = triangulateFill(rings, { fillRule: rule, tolerance: 1 });
                const polys = normalizePolygons(rings, rule, { tolerance: 1 });
                const area = polygonsArea(polys);
                // Snapped intersection points can make a hole poke through its outer ring by a fraction of
                // a quantum (then the CDT fallback runs); allow a few quanta of area.
                expect(Math.abs(trianglesArea(tri) - area)).toBeLessThanOrEqual(1e-6 * area + 0.05);
                // Coverage at off-grid sample points (integer inputs → x.37 is never on an edge).
                for (let gx = -50; gx < 50; gx += 7) {
                    for (let gy = -50; gy < 50; gy += 7) {
                        const x = gx + Math.SQRT2 / 3;
                        const y = gy + Math.PI / 5;
                        // Skip samples within snapping distance of the boundary (grid quantum 1/64).
                        if (rings.some((r) => distanceToPolyline(x, y, r, true) < 0.05)) continue;
                        expect(coverage(tri, x, y)).toBe(pointInRings(rings, x, y, rule) ? 1 : 0);
                    }
                }
            }),
            { numRuns: 150, seed: 42 },
        );
    });

    it("is deterministic", () => {
        const rings = [Float64Array.of(0, 0, 10, 3, 4, 9, 7, -2, 1, 8), rect(1, 1, 5, 5)];
        expect(Array.from(triangulateFill(rings))).toEqual(Array.from(triangulateFill(rings)));
    });

    it("triangulatePolygons agrees with the normalized area", () => {
        const polys = normalizePolygons([
            rect(100000, 100000, 100010, 100010),
            rect(100002, 100002, 100004, 100004),
        ]);
        expectClose(trianglesArea(triangulatePolygons(polys)), 96, 1e-6);
    });
});

describe("clipping", () => {
    it("intersection / difference / union / xor areas", () => {
        const a = [rect(0, 0, 10, 10)];
        const b = [rect(5, 5, 15, 15)];
        expectClose(polygonsArea(booleanPolygons(BooleanOp.Intersection, a, b)), 25, 1e-9);
        expectClose(polygonsArea(booleanPolygons(BooleanOp.Difference, a, b)), 75, 1e-9);
        expectClose(polygonsArea(booleanPolygons(BooleanOp.Union, a, b)), 175, 1e-9);
        expectClose(polygonsArea(booleanPolygons(BooleanOp.Xor, a, b)), 150, 1e-9);
    });

    it("inverted clip keeps the outside", () => {
        const inside = clipPolygons([rect(0, 0, 10, 10)], { rings: [rect(2, 2, 4, 4)] });
        const outside = clipPolygons([rect(0, 0, 10, 10)], { rings: [rect(2, 2, 4, 4)], inverted: true });
        expectClose(polygonsArea(inside), 4, 1e-9);
        expectClose(polygonsArea(outside), 96, 1e-9);
    });

    it("property: clip ∩ + clip ∖ = subject", () => {
        fc.assert(
            fc.property(polyArb, polyArb, (s, c) => {
                const o = { tolerance: 1 };
                const whole = polygonsArea(normalizePolygons([s], FillRule.NonZero, o));
                const inn = polygonsArea(clipPolygons([s], { rings: [c] }, o));
                const out = polygonsArea(clipPolygons([s], { rings: [c], inverted: true }, o));
                // Intersection vertices are snapped to the 1/64 grid: each moves by ≤ 1/128, sweeping at
                // most (edge length)/128 of area.
                expect(Math.abs(inn + out - whole)).toBeLessThanOrEqual((perimeter(s) + perimeter(c)) / 64);
            }),
            { numRuns: 200, seed: 7 },
        );
    });

    it("clips open polylines to a region (inside pieces lie inside, total length preserved)", () => {
        const region = { rings: [rect(0, 0, 10, 10), rect(4, 4, 6, 6)] }; // square with a hole
        const line = Float64Array.of(-5, 5, 15, 5);
        const inn = clipPolylines([line], region);
        const out = clipPolylines([line], { ...region, inverted: true });
        const len = (ps: Float64Array[]) =>
            ps.reduce((a, p) => {
                let l = 0;
                for (let i = 2; i < p.length; i += 2)
                    l += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
                return a + l;
            }, 0);
        expectClose(len(inn), 8, 1e-6);
        expectClose(len(out), 12, 1e-6);
        expect(inn.length).toBe(2);
        for (const p of inn) {
            for (let i = 0; i < p.length; i += 2) expect(p[i]! >= -1e-9 && p[i]! <= 10 + 1e-9).toBe(true);
        }
    });

    it("rect clip is exact and keeps direction", () => {
        const pts = Float64Array.of(-10, 0, 0.5, 0.5, 20, 0.25);
        const r = clipPolylineToRect(pts, { minX: 0, minY: 0, maxX: 1, maxY: 1 });
        expect(r.length).toBe(1);
        expect(r[0]![0]).toBeCloseTo(0, 12);
        expect(r[0]![2]).toBe(0.5);
        expect(r[0]![r[0]!.length - 2]).toBe(1);
        const closed = clipPolylineToRect(
            rect(0.2, 0.2, 0.8, 0.8),
            { minX: 0, minY: 0, maxX: 1, maxY: 1 },
            true,
        );
        expect(closed.length).toBe(1);
        expect(closed[0]!.length).toBe(10); // 4 corners + the closing point
    });

    it("ringArea sign", () => {
        expect(ringArea(rect(0, 0, 2, 3))).toBe(6);
    });
});
