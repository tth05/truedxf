import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    arcBounds,
    arcDerivativeAt,
    arcEndPoint,
    arcFromDegrees,
    arcLength,
    arcPointAt,
    arcStartPoint,
    arcToBulge,
    bulgeFromRadiusAndChord,
    bulgeRadius,
    bulgeSagitta,
    bulgeToArc,
    normalizeRad,
    reverseArc,
    TAU,
} from "../src/index.ts";
import ref from "./fixtures/ezdxf-reference.json" with { type: "json" };
import { coord, expectClose, expectPointClose, FC_RUNS, vec2Arb } from "./helpers.ts";

describe("ARC", () => {
    it("converts DXF degrees with the span rule", () => {
        const a = arcFromDegrees({ x: 0, y: 0 }, 2, 350, 10);
        expectClose(a.start, (350 * Math.PI) / 180, 1e-15);
        expectClose(a.sweep, (20 * Math.PI) / 180, 1e-15);
        expect(arcFromDegrees({ x: 0, y: 0 }, 1, 45, 45).sweep).toBe(0);
        expect(arcFromDegrees({ x: 0, y: 0 }, 1, 0, 360).sweep).toBe(TAU);
        expect(arcFromDegrees({ x: 0, y: 0 }, 1, -90, 0).start).toBeCloseTo((3 * Math.PI) / 2, 15);
    });

    it("evaluates end points, derivative and length", () => {
        const a = arcFromDegrees({ x: 1, y: 1 }, 2, 0, 90);
        expectPointClose(arcStartPoint(a), { x: 3, y: 1 }, 1e-15);
        expectPointClose(arcEndPoint(a), { x: 1, y: 3 }, 1e-15);
        expectPointClose(arcPointAt(a, 0.5), { x: 1 + Math.SQRT2, y: 1 + Math.SQRT2 }, 1e-15);
        expectPointClose(arcDerivativeAt(a, 0), { x: 0, y: Math.PI }, 1e-15);
        expectClose(arcLength(a), Math.PI, 1e-15);
        const r = reverseArc(a);
        expectPointClose(arcStartPoint(r), arcEndPoint(a), 1e-15);
    });

    it("has exact bounds by quadrant crossings, containing all samples (property)", () => {
        const b = arcBounds(arcFromDegrees({ x: 0, y: 0 }, 1, 45, 135));
        expectClose(b.maxY, 1, 1e-15);
        expectClose(b.minY, Math.SQRT1_2, 1e-15);
        expectClose(b.minX, -Math.SQRT1_2, 1e-15);
        fc.assert(
            fc.property(
                vec2Arb(100),
                fc.double({ min: 0.01, max: 100, noNaN: true }),
                fc.double({ min: -10, max: 10, noNaN: true }),
                fc.double({ min: -TAU, max: TAU, noNaN: true }),
                (c, r, start, sweep) => {
                    const arc = { center: c, radius: r, start, sweep };
                    const box = arcBounds(arc);
                    const tol = 1e-9 * (r + Math.abs(c.x) + Math.abs(c.y));
                    let hitMinX = Infinity;
                    let hitMaxX = -Infinity;
                    for (let i = 0; i <= 2000; i++) {
                        const p = arcPointAt(arc, i / 2000);
                        expect(box.containsXY(p.x, p.y, tol)).toBe(true);
                        hitMinX = Math.min(hitMinX, p.x);
                        hitMaxX = Math.max(hitMaxX, p.x);
                    }
                    // Tight: sampling gets within the sampling sagitta of the box.
                    const samp = r * (1 - Math.cos((Math.abs(sweep) / 2000) * 2)) + tol;
                    expect(hitMinX - box.minX).toBeLessThanOrEqual(samp + 1e-9 * r);
                    expect(box.maxX - hitMaxX).toBeLessThanOrEqual(samp + 1e-9 * r);
                },
            ),
            FC_RUNS,
        );
    });
});

describe("bulge (note 03 §3.9.1)", () => {
    it("matches ezdxf bulge_to_arc", () => {
        for (const [p1, p2, b, [cx, cy, sa, ea, r]] of ref.bulge as [
            number[],
            number[],
            number,
            number[],
        ][]) {
            const a = bulgeToArc({ x: p1[0]!, y: p1[1]! }, { x: p2[0]!, y: p2[1]! }, b)!;
            expectPointClose(a.center, { x: cx!, y: cy! }, 1e-12);
            expectClose(a.radius, r!, 1e-12);
            // ezdxf reports CCW arcs: for b < 0 start/end are swapped.
            const [s, e] = b > 0 ? [a.start, a.start + a.sweep] : [a.start + a.sweep, a.start];
            expectClose(normalizeRad(s), normalizeRad(sa!), 1e-12);
            expectClose(normalizeRad(e), normalizeRad(ea!), 1e-12);
        }
    });

    it("handles the semicircle and direction", () => {
        const a = bulgeToArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1)!;
        expect(a.center).toEqual({ x: 5, y: 0 });
        expect(a.sweep).toBeCloseTo(Math.PI, 15);
        // CCW from (0,0) to (10,0) passes below the chord.
        expect(arcPointAt(a, 0.5).y).toBeCloseTo(-5, 12);
        const cw = bulgeToArc({ x: 0, y: 0 }, { x: 10, y: 0 }, -1)!;
        expect(arcPointAt(cw, 0.5).y).toBeCloseTo(5, 12);
        expect(bulgeToArc({ x: 0, y: 0 }, { x: 1, y: 0 }, 0)).toBeUndefined();
        expect(bulgeToArc({ x: 1, y: 1 }, { x: 1, y: 1 }, 0.5)).toBeUndefined();
    });

    it("round-trips bulge → arc → bulge and hits both end points (property)", () => {
        fc.assert(
            fc.property(
                vec2Arb(1000),
                vec2Arb(1000),
                fc.double({ min: -50, max: 50, noNaN: true }).filter((b) => Math.abs(b) > 1e-6),
                (p1, p2, b) => {
                    fc.pre(Math.hypot(p2.x - p1.x, p2.y - p1.y) > 1e-3);
                    const arc = bulgeToArc(p1, p2, b)!;
                    const scale = arc.radius + Math.hypot(p1.x, p1.y) + Math.hypot(p2.x, p2.y);
                    expectPointClose(arcStartPoint(arc), p1, 1e-10 * scale);
                    expectPointClose(arcEndPoint(arc), p2, 1e-10 * scale);
                    const back = arcToBulge(arc);
                    expectClose(back.bulge, b, 1e-9);
                    const c = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    expectClose(bulgeRadius(c, b), arc.radius, 1e-12);
                    // Sagitta: distance of the arc midpoint from the chord midpoint.
                    const m = arcPointAt(arc, 0.5);
                    expectClose(
                        Math.hypot(m.x - (p1.x + p2.x) / 2, m.y - (p1.y + p2.y) / 2),
                        bulgeSagitta(c, b),
                        1e-9 * scale,
                    );
                },
            ),
            FC_RUNS,
        );
    });

    it("computes the bulge from radius and chord", () => {
        expectClose(bulgeFromRadiusAndChord(5, 10), 1, 1e-15);
        expect(bulgeFromRadiusAndChord(1, 10)).toBe(0);
        fc.assert(
            fc.property(
                coord(10).filter((b) => Math.abs(b) > 1e-6 && Math.abs(b) <= 1),
                (b) => {
                    expectClose(bulgeFromRadiusAndChord(bulgeRadius(3, b), 3), Math.abs(b), 1e-9);
                },
            ),
            FC_RUNS,
        );
    });
});
