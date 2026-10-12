/**
 * Polygon primitives shared by triangulation, clipping, stroking and hatching.
 *
 * - A **ring** is a closed polygon as interleaved `x, y` in a `Float64Array`, first point not
 *   repeated. Orientation is free unless a function says otherwise.
 * - A **polygon set** is a list of rings plus a fill rule. HATCH fills and XCLIP/viewport clip
 *   regions are even-odd (note 06 §1.5); stroke pieces are unioned with nonzero.
 * - {@link PolygonWithHoles} is the normalized form (simple, non-overlapping, holes directly
 *   inside their outer ring) produced by the boolean engine and consumed by earcut.
 */

import { Bounds2 } from "./bounds.ts";

export const FillRule = {
    EvenOdd: "evenOdd",
    NonZero: "nonZero",
} as const;
export type FillRule = (typeof FillRule)[keyof typeof FillRule];

export interface PolygonWithHoles {
    readonly outer: Float64Array;
    readonly holes: readonly Float64Array[];
}

/** Signed area of a ring (positive = counter-clockwise in a y-up frame). Shoelace, float64. */
export function ringArea(ring: Float64Array): number {
    const n = ring.length >> 1;
    if (n < 3) return 0;
    // Relative to the first vertex: much less cancellation for rings far from the origin.
    const x0 = ring[0]!;
    const y0 = ring[1]!;
    let s = 0;
    for (let i = 1; i + 1 < n; i++) {
        const ax = ring[2 * i]! - x0;
        const ay = ring[2 * i + 1]! - y0;
        const bx = ring[2 * i + 2]! - x0;
        const by = ring[2 * i + 3]! - y0;
        s += ax * by - ay * bx;
    }
    return s / 2;
}

/** Total area of a normalized polygon set (outer minus holes, all as absolute values). */
export function polygonsArea(polys: readonly PolygonWithHoles[]): number {
    let a = 0;
    for (const p of polys) {
        a += Math.abs(ringArea(p.outer));
        for (const h of p.holes) a -= Math.abs(ringArea(h));
    }
    return a;
}

/** Sum of the (absolute) areas of a triangle list (6 numbers per triangle). */
export function trianglesArea(tri: Float64Array): number {
    let a = 0;
    for (let i = 0; i + 5 < tri.length; i += 6) {
        const ax = tri[i + 2]! - tri[i]!;
        const ay = tri[i + 3]! - tri[i + 1]!;
        const bx = tri[i + 4]! - tri[i]!;
        const by = tri[i + 5]! - tri[i + 1]!;
        a += Math.abs(ax * by - ay * bx) / 2;
    }
    return a;
}

/** Reverse the vertex order of a ring (returns a new array). */
export function reverseRing(ring: Float64Array): Float64Array {
    const n = ring.length >> 1;
    const out = new Float64Array(ring.length);
    for (let i = 0; i < n; i++) {
        out[2 * i] = ring[2 * (n - 1 - i)]!;
        out[2 * i + 1] = ring[2 * (n - 1 - i) + 1]!;
    }
    return out;
}

export function ringsBounds(rings: readonly Float64Array[], out: Bounds2 = new Bounds2()): Bounds2 {
    for (const r of rings) out.addPoints(r);
    return out;
}

/**
 * Winding number of the rings around (x, y). Uses the half-open crossing rule
 * (`(y0 > y) ≠ (y1 > y)`), so a point exactly on a horizontal edge or vertex is classified
 * consistently (as if nudged by +ε in y) — the same rule the hatch scanline uses.
 */
export function windingNumber(rings: readonly Float64Array[], x: number, y: number): number {
    let w = 0;
    for (const r of rings) {
        const n = r.length >> 1;
        for (let i = 0; i < n; i++) {
            const j = i + 1 === n ? 0 : i + 1;
            const x0 = r[2 * i]!;
            const y0 = r[2 * i + 1]!;
            const x1 = r[2 * j]!;
            const y1 = r[2 * j + 1]!;
            const up = y0 <= y && y1 > y;
            const down = y1 <= y && y0 > y;
            if (!up && !down) continue;
            // x of the edge at height y, computed from the lower endpoint (direction independent).
            const t = up ? (y - y0) / (y1 - y0) : (y - y1) / (y0 - y1);
            const xe = up ? x0 + (x1 - x0) * t : x1 + (x0 - x1) * t;
            if (xe > x) w += up ? 1 : -1;
        }
    }
    return w;
}

/** Point-in-polygon-set test for the given fill rule. */
export function pointInRings(rings: readonly Float64Array[], x: number, y: number, rule: FillRule): boolean {
    const w = windingNumber(rings, x, y);
    return rule === FillRule.EvenOdd ? (w & 1) !== 0 : w !== 0;
}

/** Interleaved xy points (any iterable of `{x, y}`) → `Float64Array`. */
export function ringFromPoints(points: Iterable<{ readonly x: number; readonly y: number }>): Float64Array {
    const out: number[] = [];
    for (const p of points) out.push(p.x, p.y);
    return Float64Array.from(out);
}
