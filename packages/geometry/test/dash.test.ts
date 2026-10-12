import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    arcSegment,
    autocadCandidateFit,
    ComplexRotation,
    circleArc,
    type DashPattern,
    DashUnits,
    dashPath,
    dashPattern,
    dashPolyline,
    lineSegment,
    measureSubpath,
    patternPeriod,
    phaseFit,
} from "../src/index.ts";
import { expectClose } from "./helpers.ts";

const DASHED = dashPattern([0.5, -0.25]);
const line = (l: number) => Float64Array.of(0, 0, l, 0);

function rangesOf(r: { ranges: Float64Array }): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < r.ranges.length; i += 2) out.push([r.ranges[i]!, r.ranges[i + 1]!]);
    return out;
}

function covered(r: { ranges: Float64Array }, total: number): number {
    let s = 0;
    for (const [a, b] of rangesOf(r)) s += b! >= a! ? b! - a! : total - a! + b!;
    return s;
}

describe("A-type fit (VERIFIED-BY-ACAD, note 06 §2.6)", () => {
    it("lengthens both end dashes by half the residual", () => {
        const r = dashPolyline(line(2), DASHED);
        const got = rangesOf(r);
        const want = [
            [0, 0.5],
            [0.75, 1.25],
            [1.5, 2],
        ];
        expect(got.length).toBe(3);
        for (let i = 0; i < 3; i++) {
            expectClose(got[i]![0]!, want[i]![0]!, 1e-12);
            expectClose(got[i]![1]!, want[i]![1]!, 1e-12);
        }
        expect(Array.from(r.dashes[0]!)).toEqual([0, 0, 0.5, 0]);
    });

    it("draws units shorter than one period continuous", () => {
        const r = dashPolyline(line(0.7), DASHED);
        expect(rangesOf(r)).toEqual([[0, 0.7]]);
        expect(r.dots.length).toBe(0);
    });

    it("property: dashes start at 0, end at L and cover r + k·D", () => {
        const pat = fc
            .tuple(
                fc.double({ min: 0.05, max: 3, noNaN: true }),
                fc.array(fc.double({ min: 0.05, max: 3, noNaN: true }), { minLength: 1, maxLength: 5 }),
            )
            .map(([e0, rest]) => [e0, ...rest.map((v, i) => (i % 2 === 0 ? -v : v))]);
        fc.assert(
            fc.property(pat, fc.double({ min: 0.01, max: 60, noNaN: true }), (lens, L) => {
                const p = dashPattern(lens.length % 2 === 0 ? lens : [...lens, -0.1]);
                const P = patternPeriod(p);
                const D = p.elements.reduce((a, e) => a + Math.max(0, e.length), 0);
                const r = dashPolyline(line(L), p);
                const rg = rangesOf(r);
                expectClose(rg[0]![0]!, 0, 1e-12);
                expectClose(rg[rg.length - 1]![1]!, L, 1e-9);
                if (L < P) expect(rg.length).toBe(1);
                else {
                    const k = Math.floor(L / P);
                    expect(Math.abs(covered(r, L) - (L - k * P + k * D))).toBeLessThan(1e-9 * Math.max(1, L));
                }
                for (const [a, b] of rg) expect(b!).toBeGreaterThan(a!);
                for (let i = 1; i < rg.length; i++) expect(rg[i]![0]!).toBeGreaterThan(rg[i - 1]![1]!);
            }),
            { numRuns: 300, seed: 5 },
        );
    });

    it("dot-first patterns: dots on both ends, even below one period (linetypes/fit-dot)", () => {
        const DOT = dashPattern([0, -0.25]);
        const exact = dashPolyline(line(1), DOT);
        expect(exact.dashes.length).toBe(0);
        expect(exact.dots.length / 3).toBe(5);
        const r = dashPolyline(line(1.1), DOT);
        expect(r.dashes.length).toBe(0);
        const xs = [];
        for (let i = 0; i < r.dots.length; i += 3) xs.push(r.dots[i]!);
        expect(xs.map((x) => Math.round(x * 1e9) / 1e9).sort((a, b) => a - b)).toEqual([
            0, 0.3, 0.55, 0.8, 1.1,
        ]);
        const short = dashPolyline(line(0.1), DOT);
        expect(short.dashes.length).toBe(0);
        expect(Array.from(short.dots).filter((_, i) => i % 3 === 0)).toEqual([0, 0.1]);
        // a dot-first pattern with a dash is continuous below one period (linetypes/odd-dot-dash-start)
        const mixed = dashPolyline(line(0.5), dashPattern([0, -0.25, 0.5, -0.25]));
        expect(rangesOf(mixed)).toEqual([[0, 0.5]]);
    });

    it("uses the declared length 40 for k and r and walks the real elements (linetypes/odd-total-*)", () => {
        // 40 = 25.4 > Σ = 19.05 (odd-total-exceeds, L = 95): [15.75] gap [22.1, 34.8] gap [41.15, 53.85] gap [60.2, 91.7]
        const p = { elements: [{ length: 12.7 }, { length: -6.35 }], period: 25.4 };
        const got = rangesOf(dashPolyline(line(95), p));
        const want = [
            [0, 15.75],
            [22.1, 34.8],
            [41.15, 53.85],
            [60.2, 91.7],
        ];
        expect(got.length).toBe(want.length);
        for (let i = 0; i < want.length; i++) {
            expectClose(got[i]![0]!, want[i]![0]!, 1e-9);
            expectClose(got[i]![1]!, want[i]![1]!, 1e-9);
        }
        // 40 = 0 → continuous (odd-total-zero)
        expect(rangesOf(dashPolyline(line(95), { ...p, period: 0 }))).toEqual([[0, 95]]);
    });

    it("a leading gap starts with a short dash (e0 + r)/2 (linetypes/odd-leading-gap)", () => {
        const got = rangesOf(dashPolyline(line(47.5), dashPattern([-6.35, 12.7])));
        // h = 1.525: [0, h + 12.7], gap 6.35, then dash 12.7 + 2h, nothing after
        expect(got.length).toBe(2);
        expectClose(got[0]![1]!, 14.225, 1e-9);
        expectClose(got[1]![0]!, 20.575, 1e-9);
        expectClose(got[1]![1]!, 36.325, 1e-9);
    });
});

describe("plain phase fit", () => {
    it("total dash length over whole periods is k·D; phase shifts the pattern", () => {
        const r = dashPolyline(line(7.5), DASHED, { fit: phaseFit(0) });
        expectClose(covered(r, 7.5), 5, 1e-12);
        const s = dashPolyline(line(3), DASHED, { fit: phaseFit(0.5) });
        expectClose(rangesOf(s)[0]![0]!, 0.25, 1e-12); // starts in the gap → first dash at 0.25
    });
});

describe("units: per segment (PLINEGEN off) vs continuous (PLINEGEN on)", () => {
    const sq = Float64Array.of(0, 0, 2, 0, 2, 2, 0, 2, 0, 0);
    it("per-segment restarts at every vertex and joins the corner dashes", () => {
        const r = dashPolyline(sq, DASHED, { units: DashUnits.PerSegment });
        // 4 sides × 3 dashes, the 3 interior corners merge two dashes each.
        expect(r.dashes.length).toBe(9);
        // A corner dash runs through the vertex (2, 0).
        const corner = r.dashes[2]!;
        expect(Array.from(corner)).toEqual([1.5, 0, 2, 0, 2, 0.5]);
        const apart = dashPolyline(sq, DASHED, { units: DashUnits.PerSegment, joinUnits: false });
        expect(apart.dashes.length).toBe(12);
    });

    it("continuous runs one fitted pattern over the whole length", () => {
        const r = dashPolyline(sq, DASHED, { units: DashUnits.Continuous });
        const rg = rangesOf(r);
        expectClose(rg[0]![1]!, 0.5, 1e-12); // L = 8, k = 10, r = 0.5 → end dashes 0.5
        expectClose(covered(r, 8), 0.5 + 10 * 0.5, 1e-12);
    });

    it("closed input stretches the pattern to round(L/P) whole periods from the start", () => {
        const ring = Float64Array.of(0, 0, 2, 0, 2, 2, 0, 2);
        const r = dashPolyline(ring, DASHED, { closed: true });
        const rg = rangesOf(r);
        const n = Math.round(8 / 0.75);
        expect(rg.length).toBe(n);
        expectClose(rg[0]![0]!, 0, 1e-12);
        expectClose(rg[1]![0]!, 8 / n, 1e-12);
        expectClose(covered(r, 8), (8 * 2) / 3, 1e-12);
        const tiny = dashPolyline(Float64Array.of(0, 0, 0.1, 0, 0.1, 0.1), DASHED, { closed: true });
        expect(tiny.whole).toBe(true);
        // at least two periods (linetypes/circle-center-r10: 1.24 P → 2 periods)
        const two = dashPolyline(Float64Array.of(0, 0, 0.3, 0, 0.3, 0.165), DASHED, { closed: true });
        expect(two.dashes.length).toBe(2);
    });
});

describe("paths: exact arc length", () => {
    it("dashes along an arc sit at exact arc-length angles", () => {
        const r = 10;
        const path = {
            subpaths: [
                {
                    segments: [
                        arcSegment({ center: { x: 0, y: 0 }, radius: r, start: 0, sweep: Math.PI / 2 }),
                    ],
                    closed: false,
                },
            ],
        };
        const m = measureSubpath(path.subpaths[0]!, 0.01);
        expectClose(m.distances[m.distances.length - 1]!, (r * Math.PI) / 2, 1e-12);
        const res = dashPath(path, dashPattern([1, -1]), 0.01, { fit: phaseFit(0) })[0]!;
        for (let i = 0; i < res.dashes.length; i++) {
            const d = res.dashes[i]!;
            const s0 = res.ranges[2 * i]!;
            const ang = Math.atan2(d[1]!, d[0]!);
            expect(Math.abs(ang * r - s0)).toBeLessThan(0.01);
            expect(Math.abs(Math.hypot(d[0]!, d[1]!) - r)).toBeLessThanOrEqual(0.01 + 1e-12);
        }
    });

    it("a circle is one closed unit with whole periods (linetypes/circle-*)", () => {
        const path = { subpaths: [{ segments: [arcSegment(circleArc({ x: 0, y: 0 }, 5))], closed: true }] };
        const res = dashPath(path, DASHED, 0.001)[0]!;
        const L = 2 * Math.PI * 5;
        expect(res.dashes.length).toBe(Math.round(L / 0.75)); // stretched whole periods
    });

    it("per-segment units follow path segments", () => {
        const sp = {
            segments: [
                lineSegment({ x: 0, y: 0 }, { x: 2, y: 0 }),
                lineSegment({ x: 2, y: 0 }, { x: 2, y: 0.5 }),
            ],
            closed: false,
        };
        const res = dashPath({ subpaths: [sp] }, DASHED, 0.01, { units: DashUnits.PerSegment })[0]!;
        // second segment (0.5 < P) is continuous and joined to the first segment's end dash
        const last = res.dashes[res.dashes.length - 1]!;
        expect(Array.from(last)).toEqual([1.5, 0, 2, 0, 2, 0.5]);
    });
});

describe("dots, complex elements, limits", () => {
    it("complex elements on arcs sit on the true arc with the true tangent", () => {
        const pat: DashPattern = {
            elements: [
                { length: 1 },
                {
                    length: -1,
                    complex: {
                        kind: "shape",
                        rotation: 0,
                        rotationMode: ComplexRotation.Relative,
                        offsetX: 0,
                        offsetY: 0,
                        scale: 1,
                    },
                },
            ],
        };
        const arc = {
            subpaths: [
                {
                    segments: [arcSegment({ center: { x: 0, y: 0 }, radius: 10, start: 0, sweep: Math.PI })],
                    closed: false,
                },
            ],
        };
        const res = dashPath(arc, pat, 0.5, { fit: phaseFit(0) })[0]!;
        for (const p of res.placements) {
            expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 9);
            expect(p.tangentAngle).toBeCloseTo(p.distance / 10 + Math.PI / 2, 9);
        }
    });

    it("dots as short strokes", () => {
        const r = dashPolyline(line(1), dashPattern([0, -0.25]), { dotMode: "strokes", dotLength: 0.02 });
        expect(r.dots.length).toBe(0);
        expect(r.dashes.length).toBe(5);
        expect(Array.from(r.dashes[1]!).map((v) => Math.round(v * 1e12) / 1e12)).toEqual([0.24, 0, 0.26, 0]);
    });

    it("places complex elements at the end of their element with X/Y offsets and upright flip", () => {
        const gas: DashPattern = {
            elements: [
                { length: 0.5 },
                {
                    length: -0.2,
                    complex: {
                        kind: "text",
                        rotation: 0,
                        rotationMode: ComplexRotation.Upright,
                        offsetX: -0.1,
                        offsetY: -0.05,
                        scale: 0.1,
                        data: "GAS",
                    },
                },
                { length: -0.25 },
            ],
        };
        const seen: number[] = [];
        const r = dashPolyline(Float64Array.of(10, 0, 0, 0), gas, {
            fit: phaseFit(0),
            onComplex: (p) => seen.push(p.distance),
        });
        expect(r.placements.length).toBe(10); // anchors at 0.7 + 0.95·i ≤ 10
        const p = r.placements[0]!;
        expect(p.distance).toBeCloseTo(0.7, 12);
        // unflipped: anchor 0.7 − X 0.1 along the (leftward) line = x 9.4, Y −0.05 on the left normal
        // (0, −1) = y 0.05; upright turns it by 180° about the middle of the gap [0.5, 0.95] (x 9.275)
        expect(p.x).toBeCloseTo(9.15, 12);
        expect(p.y).toBeCloseTo(-0.05, 12);
        expect(p.flipped).toBe(true);
        // the anchor before the flip stays available (TrueType text turns about its own cell box)
        expect(p.anchorX).toBeCloseTo(9.4, 12);
        expect(p.anchorY).toBeCloseTo(0.05, 12);
        expect(Math.cos(p.angle)).toBeCloseTo(1, 12);
        expect(seen.length).toBe(r.placements.length);
        // the caller decides "upside down" in the entity's own coordinates (mirrored INSERT)
        const kept = dashPolyline(Float64Array.of(10, 0, 0, 0), gas, {
            fit: phaseFit(0),
            upsideDown: () => false,
        });
        expect(kept.placements[0]!.flipped).toBe(false);
        expect(kept.placements[0]!.x).toBeCloseTo(9.4, 12);
        expect(Math.cos(kept.placements[0]!.angle)).toBeCloseTo(-1, 12);
        const abs = dashPolyline(Float64Array.of(10, 0, 0, 0), {
            elements: gas.elements.map((e) =>
                e.complex
                    ? {
                          ...e,
                          complex: { ...e.complex, rotationMode: ComplexRotation.Absolute, rotation: 0.3 },
                      }
                    : e,
            ),
        });
        expect(abs.placements.every((q) => q.angle === 0.3)).toBe(true);
    });

    it("falls back to continuous when the primitive limit is exceeded (count, not time)", () => {
        const r = dashPolyline(line(1000), dashPattern([0.001, -0.001]), { maxPrimitives: 1000 });
        expect(r.tooDense).toBe(true);
        expect(rangesOf(r)).toEqual([[0, 1000]]);
    });

    it("is deterministic", () => {
        const pts = Float64Array.of(0, 0, 3.3, 1.1, 5, -2, 9, 4);
        const a = dashPolyline(pts, dashPattern([1.25, -0.25, 0.25, -0.25]), { units: DashUnits.PerSegment });
        const b = dashPolyline(pts, dashPattern([1.25, -0.25, 0.25, -0.25]), { units: DashUnits.PerSegment });
        expect(a.dashes.map((d) => Array.from(d))).toEqual(b.dashes.map((d) => Array.from(d)));
        expect(autocadCandidateFit(5, DASHED, false)).toEqual(autocadCandidateFit(5, DASHED, false));
    });
});
