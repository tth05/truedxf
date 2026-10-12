import fc from "fast-check";
import { expect } from "vitest";

/** Distance from (x, y) to the polyline (interleaved xy), optionally closed. */
export function distanceToPolyline(x: number, y: number, pts: Float64Array, closed = false): number {
    let best = Infinity;
    const n = pts.length / 2;
    if (n === 1) return Math.hypot(x - pts[0]!, y - pts[1]!);
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        const ax = pts[2 * i]!;
        const ay = pts[2 * i + 1]!;
        const bx = pts[2 * j]!;
        const by = pts[2 * j + 1]!;
        const dx = bx - ax;
        const dy = by - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
    }
    return best;
}

export function expectClose(actual: number, expected: number, tol = 1e-9): void {
    if (!(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)))) {
        expect(actual).toBe(expected);
    }
}

export function expectVecClose(actual: ArrayLike<number>, expected: ArrayLike<number>, tol = 1e-9): void {
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
        if (!(Math.abs(actual[i]! - expected[i]!) <= tol * Math.max(1, Math.abs(expected[i]!)))) {
            expect(Array.from(actual)).toEqual(Array.from(expected));
        }
    }
}

export function expectPointClose(
    actual: { x: number; y: number; z?: number },
    expected: { x: number; y: number; z?: number },
    tol = 1e-9,
): void {
    expectClose(actual.x, expected.x, tol);
    expectClose(actual.y, expected.y, tol);
    if (expected.z !== undefined) expectClose(actual.z ?? 0, expected.z, tol);
}

/** A "reasonable" float: finite, moderate magnitude, no -0 surprises. */
export const coord = (max = 1000) => fc.double({ min: -max, max, noNaN: true, noDefaultInfinity: true });

export const vec2Arb = (max = 1000) => fc.record({ x: coord(max), y: coord(max) });
export const vec3Arb = (max = 1000) => fc.record({ x: coord(max), y: coord(max), z: coord(max) });

/** Non-degenerate direction vector. */
export const dirArb = vec3Arb(10).filter((v) => Math.hypot(v.x, v.y, v.z) > 1e-3);

export const FC_RUNS = { numRuns: 200, seed: 20260930 } as const;
