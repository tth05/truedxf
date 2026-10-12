/**
 * LWPOLYLINE / 2D POLYLINE vertex lists → paths, POLYLINE vertex selection, and wide-polyline
 * band outlines.
 *
 * Note 03 §3.9: 40/41/42 of a vertex apply to the segment *from this vertex to the next*; the
 * last vertex's values matter only when closed (closing segment last → first). Zero-length
 * segments are skipped. A non-zero constant width (43) overrides all per-vertex widths in
 * AutoCAD (BricsCAD differs; CONFLICT resolved for AutoCAD).
 *
 * Note 03 §3.10.4: curve-fit polylines (70 & 2) draw **all** vertices incl. the extra flag-1
 * vertices; spline-fit polylines (70 & 4) draw the flag-8 vertices and skip the flag-16 frame
 * (drawn only with SPLFRAME = 1). CONFLICT with ezdxf ≥ 1.4 (drops flag 1) — needs an AutoCAD test.
 *
 * Wide polylines (note 03 §4):
 * - straight segments → quads offset by ±w(s)/2, widths tapering linearly;
 * - joints between consecutive straight segments are **mitered** (offset lines intersected)
 *   when the widths meet (end width of one = start width of the next) and the joint is not too
 *   sharp; otherwise both bands end unmitered (butt) at the vertex. VERIFIED-BY-ACAD
 *   (polylines/width-arrow: width step → no miter; miter-angle-0002 30° mitered, miter-angle-0003
 *   5° and width-hairpin 7.2° not mitered). The exact limit between 7.2° and 30° is UNVERIFIED;
 *   we miter while the miter length ≤ `MITER_LIMIT` half-widths (≈ 11.5°);
 * - open ends are cut perpendicular (butt); a closed polyline also miters the closing joint;
 * - arc segments → annular sectors `r ± w(θ)/2` with radial ends; no miter between an arc and
 *   its neighbours (ezdxf; UNKNOWN in AutoCAD, test idea 23);
 * - arc segment widths are clamped to the arc diameter 2r before tapering, so the inner
 *   radius never goes negative. VERIFIED-BY-ACAD (polylines/ring-semicircle-w6: r = 2, w = 6 →
 *   a half disk of radius 4; ring-semicircle-taper: 0 → 8 tapers like 0 → 4);
 * - zero-width segments are ordinary (lineweight) lines: returned separately as `thin`.
 * Each band piece is a closed, counter-clockwise subpath; fill them together with the nonzero
 * rule (= their union, so overlaps do not double-blend with transparency, note 03 §4.2).
 * Constant-width arcs use exact arc segments; tapered arc edges (spiral-like) are flattened with
 * the caller's `tolerance` (in path units).
 */

import { bulgeToArc, type CircularArc2 } from "./arc.ts";
import { arcSegmentCount } from "./flatten.ts";
import { arcSegment, lineSegment, type Path2, type PathSegment, type Subpath } from "./path.ts";
import type { Vec2 } from "./vec.ts";

export interface PolylineVertex {
    readonly x: number;
    readonly y: number;
    /** Bulge of the segment starting at this vertex (code 42). */
    readonly bulge?: number;
    /** Start width of the segment starting at this vertex (code 40). */
    readonly startWidth?: number;
    /** End width of the segment starting at this vertex (code 41). */
    readonly endWidth?: number;
}

/** A resolved polyline segment (after skipping zero-length ones). */
export interface PolylineSegment {
    readonly p0: Vec2;
    readonly p1: Vec2;
    readonly bulge: number;
    readonly startWidth: number;
    readonly endWidth: number;
    /** The arc when bulge ≠ 0, starting at p0 and ending at p1 (signed sweep). */
    readonly arc: CircularArc2 | undefined;
}

/**
 * Segments of a polyline. `constantWidth ≠ 0` overrides per-vertex widths (AutoCAD rule,
 * note 03 §3.9). Consecutive coincident vertices produce no segment.
 */
export function polylineSegments(
    vertices: readonly PolylineVertex[],
    closed: boolean,
    constantWidth = 0,
): PolylineSegment[] {
    const out: PolylineSegment[] = [];
    const n = vertices.length;
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
        const a = vertices[i]!;
        const b = vertices[(i + 1) % n]!;
        if (a.x === b.x && a.y === b.y) continue;
        const bulge = a.bulge ?? 0;
        const sw = constantWidth !== 0 ? constantWidth : (a.startWidth ?? 0);
        const ew = constantWidth !== 0 ? constantWidth : (a.endWidth ?? 0);
        const p0 = { x: a.x, y: a.y };
        const p1 = { x: b.x, y: b.y };
        out.push({ p0, p1, bulge, startWidth: sw, endWidth: ew, arc: bulgeToArc(p0, p1, bulge) });
    }
    return out;
}

/** Centre-line path of a bulge polyline (lines and exact arcs), in the polyline's OCS. */
export function bulgePolylineToSubpath(vertices: readonly PolylineVertex[], closed: boolean): Subpath {
    const segs: PathSegment[] = polylineSegments(vertices, closed).map((s) =>
        s.arc ? arcSegment(s.arc) : lineSegment(s.p0, s.p1),
    );
    return { segments: segs, closed };
}

/** True when any segment width or the constant width is non-zero (note 03 §3.9). */
export function polylineHasWidth(vertices: readonly PolylineVertex[], constantWidth = 0): boolean {
    if (constantWidth !== 0) return true;
    return vertices.some((v) => (v.startWidth ?? 0) !== 0 || (v.endWidth ?? 0) !== 0);
}

// ---- Heavy POLYLINE vertex selection (note 03 §3.10.4) --------------------------------------

export const PolylineFlags = {
    CLOSED: 1,
    CURVE_FIT: 2,
    SPLINE_FIT: 4,
    POLYLINE_3D: 8,
    POLYMESH: 16,
    MESH_CLOSED_N: 32,
    POLYFACE: 64,
    PLINEGEN: 128,
} as const;

export const VertexFlags = {
    EXTRA_CURVE_FIT: 1,
    CURVE_FIT_TANGENT: 2,
    SPLINE_VERTEX: 8,
    SPLINE_FRAME: 16,
    POLYLINE_3D: 32,
    POLYMESH: 64,
    POLYFACE: 128,
} as const;

/**
 * Indices of the vertices that make up the drawn curve: spline-fit → vertices without the
 * frame flag 16 (i.e. the flag-8 curve vertices); otherwise all vertices (curve-fit keeps the
 * extra flag-1 vertices). If a spline-fit polyline has no curve vertices at all, the frame is
 * returned (callers may then evaluate a B-spline over it, note 03 §3.10.4 ASSUMPTION).
 */
export function polylineCurveVertexIndices(vertexFlags: readonly number[], polylineFlags: number): number[] {
    const all = vertexFlags.map((_, i) => i);
    if (!(polylineFlags & PolylineFlags.SPLINE_FIT)) return all;
    const curve = all.filter((i) => !(vertexFlags[i]! & VertexFlags.SPLINE_FRAME));
    return curve.length > 0 ? curve : all;
}

/** Indices of the spline frame control vertices (flag 16), drawn only when SPLFRAME = 1. */
export function polylineFrameVertexIndices(vertexFlags: readonly number[]): number[] {
    return vertexFlags.flatMap((f, i) => (f & VertexFlags.SPLINE_FRAME ? [i] : []));
}

// ---- Wide polylines (note 03 §4) ------------------------------------------------------------

export interface WideOutlineOptions {
    readonly closed: boolean;
    /** Code 43; non-zero overrides all per-vertex widths. */
    readonly constantWidth?: number;
    /** Chord tolerance (path units) for tapered arc edges. */
    readonly tolerance: number;
}

export interface WideOutline {
    /** Closed CCW band pieces; fill with the nonzero rule. */
    readonly fill: Path2;
    /** Runs of zero-width segments, drawn as ordinary lines (ASSUMPTION note 03 §4.1). */
    readonly thin: Subpath[];
}

/** ezdxf's "nearly parallel" threshold for miters (π/100 ≈ 1.8°, trace.py). */
const MITER_PARALLEL_EPS = 0.031415;
/** Maximum miter length in half-widths (1 / sin(θ/2) for a joint angle θ). See module comment. */
const MITER_LIMIT = 10;

/** Whether the joint between two consecutive straight band segments is mitered. */
function mitered(a: PolylineSegment, b: PolylineSegment): boolean {
    const wa = a.endWidth;
    const wb = b.startWidth;
    if (Math.abs(wa - wb) > 1e-9 * Math.max(Math.abs(wa), Math.abs(wb))) return false;
    const d1x = a.p1.x - a.p0.x;
    const d1y = a.p1.y - a.p0.y;
    const d2x = b.p1.x - b.p0.x;
    const d2y = b.p1.y - b.p0.y;
    // joint angle θ between the two segments at the vertex (π = straight on)
    const turn = Math.abs(Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y));
    const theta = Math.PI - turn;
    return theta >= Math.PI - 1e-12 || 1 / Math.sin(theta / 2) <= MITER_LIMIT;
}

interface OffsetLine {
    readonly a: Vec2;
    readonly b: Vec2;
}

function offsets(s: PolylineSegment): { left: OffsetLine; right: OffsetLine } {
    const dx = s.p1.x - s.p0.x;
    const dy = s.p1.y - s.p0.y;
    const l = Math.hypot(dx, dy);
    const nx = -dy / l;
    const ny = dx / l;
    const h0 = s.startWidth / 2;
    const h1 = s.endWidth / 2;
    return {
        left: {
            a: { x: s.p0.x + nx * h0, y: s.p0.y + ny * h0 },
            b: { x: s.p1.x + nx * h1, y: s.p1.y + ny * h1 },
        },
        right: {
            a: { x: s.p0.x - nx * h0, y: s.p0.y - ny * h0 },
            b: { x: s.p1.x - nx * h1, y: s.p1.y - ny * h1 },
        },
    };
}

/** Direction of an offset line; falls back to the segment direction when its ends coincide. */
function lineDir(l: OffsetLine, s: PolylineSegment): Vec2 {
    const dx = l.b.x - l.a.x;
    const dy = l.b.y - l.a.y;
    if (dx === 0 && dy === 0) return { x: s.p1.x - s.p0.x, y: s.p1.y - s.p0.y };
    return { x: dx, y: dy };
}

/** Intersection of the infinite offset lines of two segments, or `fallback` if ~parallel. */
function miter(
    l1: OffsetLine,
    s1: PolylineSegment,
    l2: OffsetLine,
    s2: PolylineSegment,
    fallback: Vec2,
): Vec2 {
    const d1 = lineDir(l1, s1);
    const d2 = lineDir(l2, s2);
    const cross = d1.x * d2.y - d1.y * d2.x;
    const dot = d1.x * d2.x + d1.y * d2.y;
    const angle = Math.abs(Math.atan2(cross, dot));
    if (angle < MITER_PARALLEL_EPS || Math.abs(Math.PI - angle) < MITER_PARALLEL_EPS) return fallback;
    const t = ((l2.a.x - l1.a.x) * d2.y - (l2.a.y - l1.a.y) * d2.x) / cross;
    return { x: l1.a.x + d1.x * t, y: l1.a.y + d1.y * t };
}

function closedPolygon(points: readonly Vec2[]): Subpath {
    // Normalize to CCW so the nonzero union of all pieces has no cancelling windings.
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        area += a.x * b.y - a.y * b.x;
    }
    const pts = area < 0 ? points.slice().reverse() : points;
    const segs: PathSegment[] = [];
    for (let i = 0; i < pts.length; i++) segs.push(lineSegment(pts[i]!, pts[(i + 1) % pts.length]!));
    return { segments: segs, closed: true };
}

function isBand(s: PolylineSegment): boolean {
    return s.startWidth !== 0 || s.endWidth !== 0;
}

function arcBand(s: PolylineSegment, tolerance: number): Subpath {
    // Walk the arc CCW so the outer edge comes first (CCW contour); swap widths for CW arcs.
    const arc0 = s.arc!;
    const ccw = arc0.sweep > 0;
    const arc: CircularArc2 = ccw ? arc0 : { ...arc0, start: arc0.start + arc0.sweep, sweep: -arc0.sweep };
    const { center: c, radius: r, start, sweep } = arc;
    // widths are clamped to the diameter (module comment)
    const w0 = Math.min(ccw ? s.startWidth : s.endWidth, 2 * r);
    const w1 = Math.min(ccw ? s.endWidth : s.startWidth, 2 * r);
    const segs: PathSegment[] = [];
    const pt = (rad: number, ang: number): Vec2 => ({
        x: c.x + rad * Math.cos(ang),
        y: c.y + rad * Math.sin(ang),
    });
    if (w0 === w1 && r - w0 / 2 >= 0) {
        const ro = r + w0 / 2;
        const ri = r - w0 / 2;
        const outer = arcSegment({ center: c, radius: ro, start, sweep });
        segs.push(outer);
        const innerEnd = pt(ri, start + sweep);
        segs.push(lineSegment(pt(ro, start + sweep), innerEnd));
        if (ri > 0) segs.push(arcSegment({ center: c, radius: ri, start: start + sweep, sweep: -sweep }));
        segs.push(lineSegment(pt(ri, start), pt(ro, start)));
        return { segments: segs, closed: true };
    }
    // Tapered (or inner radius < 0): flatten both edges; radius varies linearly with the angle.
    const n = arcSegmentCount(r + Math.max(w0, w1) / 2, sweep, tolerance);
    const outer: Vec2[] = [];
    const inner: Vec2[] = [];
    for (let i = 0; i <= n; i++) {
        const f = i / n;
        const ang = start + sweep * f;
        const h = (w0 + (w1 - w0) * f) / 2;
        outer.push(pt(r + h, ang));
        inner.push(pt(r - h, ang));
    }
    const ring = outer.concat(inner.reverse());
    for (let i = 0; i < ring.length; i++) segs.push(lineSegment(ring[i]!, ring[(i + 1) % ring.length]!));
    return { segments: segs, closed: true };
}

/**
 * Band outline of a wide polyline (see module comment). Coordinates stay in the polyline's OCS
 * plane; map the result to the target with `transformPath` / `projectPlanarPath`.
 */
export function widePolylineOutline(
    vertices: readonly PolylineVertex[],
    options: WideOutlineOptions,
): WideOutline {
    const segs = polylineSegments(vertices, options.closed, options.constantWidth ?? 0);
    const fill: Subpath[] = [];
    const thin: Subpath[] = [];
    const n = segs.length;
    if (n === 0) return { fill: { subpaths: [] }, thin };

    // Runs of consecutive straight band segments get mitered joints. For closed polylines the
    // sequence is cyclic: rotate it so it starts right after a run boundary.
    const isLineBand = (s: PolylineSegment) => !s.arc && isBand(s);
    const cyclic = options.closed && segs.every(isLineBand);
    let rot = 0;
    if (options.closed && !cyclic) {
        for (let i = 0; i < n; i++) {
            const prev = segs[(i - 1 + n) % n]!;
            if (!isLineBand(prev) || !isLineBand(segs[i]!)) {
                rot = i;
                break;
            }
        }
    }
    const order = segs.slice(rot).concat(segs.slice(0, rot));

    let thinRun: PathSegment[] = [];
    const flushThin = () => {
        if (thinRun.length > 0) thin.push({ segments: thinRun, closed: false });
        thinRun = [];
    };

    let i = 0;
    while (i < n) {
        const s = order[i]!;
        if (!isBand(s)) {
            thinRun.push(s.arc ? arcSegment(s.arc) : lineSegment(s.p0, s.p1));
            i++;
            continue;
        }
        flushThin();
        if (s.arc) {
            fill.push(arcBand(s, options.tolerance));
            i++;
            continue;
        }
        let j = i;
        while (j + 1 < n && isLineBand(order[j + 1]!)) j++;
        emitLinearRun(order.slice(i, j + 1), cyclic, fill);
        i = j + 1;
    }
    flushThin();
    // A closed polyline whose thin run wraps around the start keeps it as two open pieces; that
    // is harmless for stroking except at the joint (TODO: merge, note 03 §4.1 mixed widths).
    return { fill: { subpaths: fill }, thin };
}

function emitLinearRun(run: PolylineSegment[], cyclic: boolean, out: Subpath[]): void {
    const m = run.length;
    const off = run.map(offsets);
    for (let k = 0; k < m; k++) {
        const s = run[k]!;
        const o = off[k]!;
        let l0 = o.left.a;
        let r0 = o.right.a;
        let l1 = o.left.b;
        let r1 = o.right.b;
        const hasPrev = k > 0 || cyclic;
        const hasNext = k < m - 1 || cyclic;
        if (hasPrev && mitered(run[(k - 1 + m) % m]!, s)) {
            const pk = (k - 1 + m) % m;
            const ps = run[pk]!;
            const po = off[pk]!;
            l0 = miter(po.left, ps, o.left, s, o.left.a);
            r0 = miter(po.right, ps, o.right, s, o.right.a);
        }
        if (hasNext && mitered(s, run[(k + 1) % m]!)) {
            const nk = (k + 1) % m;
            const ns = run[nk]!;
            const no = off[nk]!;
            l1 = miter(o.left, s, no.left, ns, o.left.b);
            r1 = miter(o.right, s, no.right, ns, o.right.b);
        }
        out.push(closedPolygon([r0, r1, l1, l0]));
    }
}
