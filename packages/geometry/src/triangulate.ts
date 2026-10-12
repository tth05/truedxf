/**
 * Fill triangulation: ring set + fill rule → triangle list for the display list.
 *
 * Pipeline:
 * 1. Snap to the fixed-point grid (fixed.ts; quantum ≤ tolerance/64) and **normalize** with a
 *    clipper2 union under the requested fill rule. This resolves self-intersections, overlapping
 *    loops, duplicate/collinear points and hole nesting — HATCH boundaries are frequently
 *    self-touching or self-intersecting (note 06 §1.5).
 * 2. Walk the polytree: every outer ring with its direct holes goes to **earcut** (ISC). Earcut
 *    runs on the *integer* grid coordinates, where its orientation predicates are exact as long
 *    as coordinate products stay below 2⁵³ (|X| < 4.7·10⁷, true for page-sized device geometry).
 *    Earcut can fail on holes touching the outer ring at a vertex (clipper2 emits such
 *    polygons); its result is verified with `earcut.deviation` (exact on integers) and on
 *    failure the polygon is decomposed into slab trapezoids instead (exact, more triangles).
 * 3. Map the vertices back to float64.
 *
 * Output: `Float64Array` of triangles, 6 numbers (x0, y0, x1, y1, x2, y2) per triangle, in
 * source units. Triangles never overlap (earcut partitions each normalized polygon), so the
 * result is safe for transparent fills.
 *
 * Deterministic: no randomness; identical input gives identical output.
 */

import type { Path64 } from "clipper2-ts";
import earcut, { deviation } from "earcut";
import { forEachPolygon64, type GridOptions, gridFor, normalizePaths64, ringsToPaths64 } from "./clip.ts";
import { type FixedPoint, fromFixedX, fromFixedY } from "./fixed.ts";
import { FillRule, type PolygonWithHoles } from "./polygon.ts";

export interface TriangulateOptions extends GridOptions {
    readonly fillRule?: FillRule;
}

/** Earcut on integer grid rings; exact trapezoidation fallback when earcut's area check fails. */
function triangulate64(fp: FixedPoint, rings: Path64[], out: number[]): void {
    const flat: number[] = [];
    const holes: number[] = [];
    for (let r = 0; r < rings.length; r++) {
        if (r > 0) holes.push(flat.length / 2);
        for (const p of rings[r]!) flat.push(p.x, p.y);
    }
    const holeIdx = holes.length > 0 ? holes : null;
    const idx = earcut(flat, holeIdx, 2);
    if (deviation(flat, holeIdx, 2, idx) > EARCUT_MAX_DEVIATION) {
        // Earcut mis-handles rings that touch themselves or each other at vertices / on edges, which
        // clipper2 legitimately emits (and snapped intersections can even let a hole poke through
        // its outer ring by a fraction of a quantum).
        trapezoidate64(fp, rings, out);
        return;
    }
    for (const i of idx) out.push(fromFixedX(fp, flat[2 * i]!), fromFixedY(fp, flat[2 * i + 1]!));
}

/**
 * Robust fallback: horizontal slab decomposition. Between consecutive distinct vertex y values
 * no two edges cross (the input is a clipper2 union result, so edges meet only at endpoints),
 * so the edges spanning a slab are totally ordered by x; nonzero winding (outer rings and holes
 * are oppositely oriented) selects the inside trapezoids, each emitted as two triangles.
 * Always correct, but produces more triangles than earcut (and T-junctions).
 */
export function trapezoidate64(fp: FixedPoint, rings: readonly Path64[], out: number[]): void {
    interface E {
        y0: number;
        y1: number;
        x0: number;
        x1: number;
        w: number;
    }
    const edges: E[] = [];
    const ys: number[] = [];
    for (const r of rings) {
        for (let i = 0; i < r.length; i++) {
            const p = r[i]!;
            const q = r[(i + 1) % r.length]!;
            ys.push(p.y);
            if (p.y === q.y) continue;
            if (p.y < q.y) edges.push({ y0: p.y, y1: q.y, x0: p.x, x1: q.x, w: 1 });
            else edges.push({ y0: q.y, y1: p.y, x0: q.x, x1: p.x, w: -1 });
        }
    }
    ys.sort((a, b) => a - b);
    const uy = ys.filter((y, i) => i === 0 || y !== ys[i - 1]);
    edges.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0 || a.y1 - b.y1 || a.x1 - b.x1);
    const xAt = (e: E, y: number) =>
        y === e.y0 ? e.x0 : y === e.y1 ? e.x1 : e.x0 + ((e.x1 - e.x0) * (y - e.y0)) / (e.y1 - e.y0);
    let next = 0;
    let active: E[] = [];
    for (let s = 0; s + 1 < uy.length; s++) {
        const ya = uy[s]!;
        const yb = uy[s + 1]!;
        while (next < edges.length && edges[next]!.y0 <= ya) active.push(edges[next++]!);
        active = active.filter((e) => e.y1 > ya);
        slab(active, ya, yb, 0);
    }

    function slab(act: readonly E[], ya: number, yb: number, depth: number): void {
        const ym = (ya + yb) / 2;
        const span = act
            .map((e) => ({ e, xm: xAt(e, ym), xa: xAt(e, ya), xb: xAt(e, yb) }))
            .sort((a, b) => a.xm - b.xm || a.xa + a.xb - (b.xa + b.xb));
        // Rounded clipper2 output can contain edges that cross by a fraction of a quantum: split the
        // slab at the first crossing found (bounded depth keeps it finite and deterministic).
        if (depth < MAX_SLAB_SPLITS) {
            for (let i = 0; i + 1 < span.length; i++) {
                const u = span[i]!;
                const v = span[i + 1]!;
                if (u.xa <= v.xa && u.xb <= v.xb) continue;
                const da = u.xa - v.xa;
                const db = u.xb - v.xb;
                const yc = ya + ((yb - ya) * da) / (da - db);
                if (yc > ya && yc < yb) {
                    slab(act, ya, yc, depth + 1);
                    slab(act, yc, yb, depth + 1);
                    return;
                }
            }
        }
        let w = 0;
        let left: (typeof span)[number] | undefined;
        for (const it of span) {
            const before = w;
            w += it.e.w;
            if (before === 0 && w !== 0) left = it;
            else if (before !== 0 && w === 0 && left) {
                const X = [left.xa, it.xa, it.xb, left.xb];
                const Y = [ya, ya, yb, yb];
                const px = X.map((x) => fromFixedX(fp, x));
                const py = Y.map((y) => fromFixedY(fp, y));
                if (it.xa > left.xa) out.push(px[0]!, py[0]!, px[1]!, py[1]!, px[2]!, py[2]!);
                if (it.xb > left.xb) out.push(px[0]!, py[0]!, px[2]!, py[2]!, px[3]!, py[3]!);
                left = undefined;
            }
        }
    }
}

/** Max recursive splits of one slab at edge crossings. */
const MAX_SLAB_SPLITS = 32;

/**
 * Relative area deviation above which an earcut result is rejected (integer input: earcut's
 * area sums are exact, so a correct triangulation deviates by ~0).
 */
const EARCUT_MAX_DEVIATION = 1e-9;

/** Normalize (union with `fillRule`, default even-odd) and triangulate a ring set. */
export function triangulateFill(rings: readonly Float64Array[], opts: TriangulateOptions = {}): Float64Array {
    const fp = gridFor([rings], opts);
    const tree = normalizePaths64(ringsToPaths64(fp, rings), opts.fillRule ?? FillRule.EvenOdd);
    const out: number[] = [];
    forEachPolygon64(tree, (outer, holes) => triangulate64(fp, [outer, ...holes], out));
    return Float64Array.from(out);
}

/**
 * Triangulate already-normalized polygons (e.g. from `normalizePolygons` / `clipPolygons`)
 * without another union; vertices are snapped to the grid of `opts` (identity for polygons
 * that came out of the boolean engine with the same grid).
 */
export function triangulatePolygons(
    polys: readonly PolygonWithHoles[],
    opts: GridOptions = {},
): Float64Array {
    const fp = gridFor([polys.flatMap((p) => [p.outer, ...p.holes])], opts);
    const out: number[] = [];
    for (const p of polys) {
        const rings = ringsToPaths64(fp, [p.outer, ...p.holes]);
        if (rings.length > 0) triangulate64(fp, rings, out);
    }
    return Float64Array.from(out);
}

/**
 * Fan-triangulate a convex ring (no normalization; caller guarantees convexity, e.g. SOLID
 * quads, stroke pieces). Triangles are emitted with the ring's orientation; zero-area and
 * rounding slivers of the opposite orientation are skipped.
 */
export function triangulateConvex(ring: Float64Array, out: number[] = []): number[] {
    const n = ring.length >> 1;
    const x0 = ring[0]!;
    const y0 = ring[1]!;
    let sign = 0;
    for (let i = 1; i + 1 < n; i++) {
        sign +=
            (ring[2 * i]! - x0) * (ring[2 * i + 3]! - y0) - (ring[2 * i + 1]! - y0) * (ring[2 * i + 2]! - x0);
    }
    if (sign === 0) return out;
    for (let i = 1; i + 1 < n; i++) {
        const x1 = ring[2 * i]!;
        const y1 = ring[2 * i + 1]!;
        const x2 = ring[2 * i + 2]!;
        const y2 = ring[2 * i + 3]!;
        const c = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
        if (sign > 0 ? c <= 0 : c >= 0) continue;
        out.push(x0, y0, x1, y1, x2, y2);
    }
    return out;
}
