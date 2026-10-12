/**
 * 2D paths for the renderer: exact segments (line, circular arc, elliptic arc, quadratic and
 * cubic Bézier, NURBS) grouped into subpaths with a closed flag. Built from entity geometry
 * after projection to the target plane (project.ts, polyline.ts) and consumed by flattening
 * (flatten.ts) and, later, stroking/dashing/hatching.
 *
 * Design:
 * - Every segment is **self-contained** (it knows its own start and end), so segment-wise
 *   algorithms (arc length for dashes, offsets for stroking, bounds) need no context. A subpath
 *   is a chain: segment i+1 is expected to start where segment i ends; flattening connects any
 *   residual gap with a straight line.
 * - `closed` means the subpath is a closed contour: if the last end point differs from the first
 *   start point, an implicit straight closing edge exists.
 * - Arcs keep a **signed sweep** so direction (linetype phase, CW bulges, mirrored OCS) survives.
 *   Under a similarity transform an arc stays an arc; otherwise it becomes an elliptic arc
 *   (exact, note 03 §3.6).
 * - Segment parameter `t ∈ [0, 1]` for `segmentPointAt`/`segmentDerivativeAt` (NURBS: mapped
 *   linearly onto the knot domain).
 *
 * Bounds are exact per segment (note 03 §6.1): arcs by quadrant crossings, elliptic arcs
 * analytically, Béziers by derivative roots, NURBS by hull-pruned Bézier decomposition.
 */

import {
    arcBounds,
    arcDerivativeAt,
    arcEndPoint,
    arcPointAt,
    arcStartPoint,
    type CircularArc2,
    reverseArc,
} from "./arc.ts";
import { Bounds2 } from "./bounds.ts";
import {
    type EllipticArc2,
    ellipticArc2Bounds,
    ellipticArc2PointAtParam,
    ellipticArc2TangentAtParam,
    reverseEllipticArc2,
    transformEllipticArc2,
} from "./ellipse.ts";
import type { Affine2 } from "./matrix.ts";
import type { NurbsCurve } from "./nurbs.ts";
import type { Vec2 } from "./vec.ts";

export interface LineSegment {
    readonly kind: "line";
    readonly p0: Vec2;
    readonly p1: Vec2;
}

export interface ArcSegment extends CircularArc2 {
    readonly kind: "arc";
}

export interface EllipticArcSegment extends EllipticArc2 {
    readonly kind: "ellipticArc";
}

export interface QuadSegment {
    readonly kind: "quad";
    readonly p0: Vec2;
    readonly p1: Vec2;
    readonly p2: Vec2;
}

export interface CubicSegment {
    readonly kind: "cubic";
    readonly p0: Vec2;
    readonly p1: Vec2;
    readonly p2: Vec2;
    readonly p3: Vec2;
}

export interface NurbsSegment {
    readonly kind: "nurbs";
    /** A 2D curve (dim 2); the whole domain is the segment. */
    readonly curve: NurbsCurve;
}

export type PathSegment =
    | LineSegment
    | ArcSegment
    | EllipticArcSegment
    | QuadSegment
    | CubicSegment
    | NurbsSegment;

export interface Subpath {
    readonly segments: readonly PathSegment[];
    readonly closed: boolean;
}

export interface Path2 {
    readonly subpaths: readonly Subpath[];
}

// ---- Constructors --------------------------------------------------------------------------

export function lineSegment(p0: Vec2, p1: Vec2): LineSegment {
    return { kind: "line", p0, p1 };
}

export function arcSegment(arc: CircularArc2): ArcSegment {
    return { kind: "arc", center: arc.center, radius: arc.radius, start: arc.start, sweep: arc.sweep };
}

export function ellipticArcSegment(e: EllipticArc2): EllipticArcSegment {
    return { kind: "ellipticArc", center: e.center, u: e.u, v: e.v, start: e.start, sweep: e.sweep };
}

export function cubicSegment(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): CubicSegment {
    return { kind: "cubic", p0, p1, p2, p3 };
}

export function quadSegment(p0: Vec2, p1: Vec2, p2: Vec2): QuadSegment {
    return { kind: "quad", p0, p1, p2 };
}

export function nurbsSegment(curve: NurbsCurve): NurbsSegment {
    if (curve.dim !== 2) throw new Error("path NURBS segments must be 2D");
    return { kind: "nurbs", curve };
}

// ---- Evaluation ----------------------------------------------------------------------------

function nurbsPoint(c: NurbsCurve, u: number): Vec2 {
    const p = c.pointAt(u);
    return { x: p[0]!, y: p[1]! };
}

export function segmentStart(s: PathSegment): Vec2 {
    switch (s.kind) {
        case "line":
        case "quad":
        case "cubic":
            return s.p0;
        case "arc":
            return arcStartPoint(s);
        case "ellipticArc":
            return ellipticArc2PointAtParam(s, s.start);
        case "nurbs":
            return nurbsPoint(s.curve, s.curve.domainStart);
    }
}

export function segmentEnd(s: PathSegment): Vec2 {
    switch (s.kind) {
        case "line":
            return s.p1;
        case "quad":
            return s.p2;
        case "cubic":
            return s.p3;
        case "arc":
            return arcEndPoint(s);
        case "ellipticArc":
            return ellipticArc2PointAtParam(s, s.start + s.sweep);
        case "nurbs":
            return nurbsPoint(s.curve, s.curve.domainEnd);
    }
}

export function segmentPointAt(s: PathSegment, t: number): Vec2 {
    switch (s.kind) {
        case "line":
            return { x: s.p0.x + (s.p1.x - s.p0.x) * t, y: s.p0.y + (s.p1.y - s.p0.y) * t };
        case "arc":
            return arcPointAt(s, t);
        case "ellipticArc":
            return ellipticArc2PointAtParam(s, s.start + s.sweep * t);
        case "quad": {
            const u = 1 - t;
            return {
                x: u * u * s.p0.x + 2 * u * t * s.p1.x + t * t * s.p2.x,
                y: u * u * s.p0.y + 2 * u * t * s.p1.y + t * t * s.p2.y,
            };
        }
        case "cubic": {
            const u = 1 - t;
            const a = u * u * u;
            const b = 3 * u * u * t;
            const c = 3 * u * t * t;
            const d = t * t * t;
            return {
                x: a * s.p0.x + b * s.p1.x + c * s.p2.x + d * s.p3.x,
                y: a * s.p0.y + b * s.p1.y + c * s.p2.y + d * s.p3.y,
            };
        }
        case "nurbs": {
            const c = s.curve;
            return nurbsPoint(c, c.domainStart + (c.domainEnd - c.domainStart) * t);
        }
    }
}

/** Derivative w.r.t. the segment parameter t ∈ [0, 1] (tangent direction and speed). */
export function segmentDerivativeAt(s: PathSegment, t: number): Vec2 {
    switch (s.kind) {
        case "line":
            return { x: s.p1.x - s.p0.x, y: s.p1.y - s.p0.y };
        case "arc":
            return arcDerivativeAt(s, t);
        case "ellipticArc": {
            const d = ellipticArc2TangentAtParam(s, s.start + s.sweep * t);
            return { x: d.x * s.sweep, y: d.y * s.sweep };
        }
        case "quad": {
            const u = 1 - t;
            return {
                x: 2 * (u * (s.p1.x - s.p0.x) + t * (s.p2.x - s.p1.x)),
                y: 2 * (u * (s.p1.y - s.p0.y) + t * (s.p2.y - s.p1.y)),
            };
        }
        case "cubic": {
            const u = 1 - t;
            return {
                x:
                    3 *
                    (u * u * (s.p1.x - s.p0.x) + 2 * u * t * (s.p2.x - s.p1.x) + t * t * (s.p3.x - s.p2.x)),
                y:
                    3 *
                    (u * u * (s.p1.y - s.p0.y) + 2 * u * t * (s.p2.y - s.p1.y) + t * t * (s.p3.y - s.p2.y)),
            };
        }
        case "nurbs": {
            const c = s.curve;
            const span = c.domainEnd - c.domainStart;
            const d = c.derivativesAt(c.domainStart + span * t, 1)[1]!;
            return { x: d[0]! * span, y: d[1]! * span };
        }
    }
}

export function reverseSegment(s: PathSegment): PathSegment {
    switch (s.kind) {
        case "line":
            return { kind: "line", p0: s.p1, p1: s.p0 };
        case "arc":
            return { kind: "arc", ...reverseArc(s) };
        case "ellipticArc":
            return { kind: "ellipticArc", ...reverseEllipticArc2(s) };
        case "quad":
            return { kind: "quad", p0: s.p2, p1: s.p1, p2: s.p0 };
        case "cubic":
            return { kind: "cubic", p0: s.p3, p1: s.p2, p2: s.p1, p3: s.p0 };
        case "nurbs":
            return { kind: "nurbs", curve: s.curve.reverse() };
    }
}

export function reverseSubpath(sp: Subpath): Subpath {
    const segs: PathSegment[] = [];
    for (let i = sp.segments.length - 1; i >= 0; i--) segs.push(reverseSegment(sp.segments[i]!));
    return { segments: segs, closed: sp.closed };
}

// ---- Transform -----------------------------------------------------------------------------

/**
 * Exact affine transform. Arcs stay arcs under similarities (mirroring flips the sweep sign),
 * otherwise become elliptic arcs.
 */
export function transformSegment(s: PathSegment, m: Affine2): PathSegment {
    switch (s.kind) {
        case "line":
            return { kind: "line", p0: m.apply(s.p0), p1: m.apply(s.p1) };
        case "arc": {
            const k = m.similarityScale();
            if (k !== undefined) {
                const center = m.apply(s.center);
                // Image of the start direction gives the new start angle.
                const d = m.applyVector({ x: Math.cos(s.start), y: Math.sin(s.start) });
                const mirrored = m.isMirroring();
                return {
                    kind: "arc",
                    center,
                    radius: s.radius * k,
                    start: Math.atan2(d.y, d.x),
                    sweep: mirrored ? -s.sweep : s.sweep,
                };
            }
            const e: EllipticArc2 = {
                center: s.center,
                u: { x: s.radius, y: 0 },
                v: { x: 0, y: s.radius },
                start: s.start,
                sweep: s.sweep,
            };
            return ellipticArcSegment(transformEllipticArc2(e, m));
        }
        case "ellipticArc":
            return ellipticArcSegment(transformEllipticArc2(s, m));
        case "quad":
            return { kind: "quad", p0: m.apply(s.p0), p1: m.apply(s.p1), p2: m.apply(s.p2) };
        case "cubic":
            return {
                kind: "cubic",
                p0: m.apply(s.p0),
                p1: m.apply(s.p1),
                p2: m.apply(s.p2),
                p3: m.apply(s.p3),
            };
        case "nurbs":
            return { kind: "nurbs", curve: s.curve.transform2(m) };
    }
}

export function transformSubpath(sp: Subpath, m: Affine2): Subpath {
    return { segments: sp.segments.map((s) => transformSegment(s, m)), closed: sp.closed };
}

export function transformPath(p: Path2, m: Affine2): Path2 {
    return { subpaths: p.subpaths.map((sp) => transformSubpath(sp, m)) };
}

// ---- Bounds --------------------------------------------------------------------------------

/** Real roots of `a·t² + b·t + c` inside (0, 1). */
function quadraticRootsInUnit(a: number, b: number, c: number, out: number[]): void {
    const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
    if (scale === 0) return;
    if (Math.abs(a) <= 1e-14 * scale) {
        if (b !== 0) push01(-c / b, out);
        return;
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) return;
    const sq = Math.sqrt(disc);
    // Numerically stable form.
    const q = -0.5 * (b + (b >= 0 ? sq : -sq));
    push01(q / a, out);
    if (q !== 0) push01(c / q, out);
}

function push01(t: number, out: number[]): void {
    if (t > 0 && t < 1) out.push(t);
}

export function segmentBounds(s: PathSegment, out: Bounds2 = new Bounds2()): Bounds2 {
    switch (s.kind) {
        case "line":
            return out.addPoint(s.p0).addPoint(s.p1);
        case "arc":
            return arcBounds(s, out);
        case "ellipticArc":
            return ellipticArc2Bounds(s, out);
        case "quad": {
            out.addPoint(s.p0).addPoint(s.p2);
            for (const [a, b, c] of [
                [s.p0.x, s.p1.x, s.p2.x],
                [s.p0.y, s.p1.y, s.p2.y],
            ] as const) {
                const den = a - 2 * b + c;
                if (den !== 0) {
                    const t = (a - b) / den;
                    if (t > 0 && t < 1) out.addPoint(segmentPointAt(s, t));
                }
            }
            return out;
        }
        case "cubic": {
            out.addPoint(s.p0).addPoint(s.p3);
            const ts: number[] = [];
            for (const [p0, p1, p2, p3] of [
                [s.p0.x, s.p1.x, s.p2.x, s.p3.x],
                [s.p0.y, s.p1.y, s.p2.y, s.p3.y],
            ] as const) {
                // B'(t)/3 = a t² + b t + c
                quadraticRootsInUnit(-p0 + 3 * p1 - 3 * p2 + p3, 2 * (p0 - 2 * p1 + p2), p1 - p0, ts);
            }
            for (const t of ts) out.addPoint(segmentPointAt(s, t));
            return out;
        }
        case "nurbs": {
            const b = s.curve.bounds();
            return out.addXY(b[0]!, b[1]!).addXY(b[2]!, b[3]!);
        }
    }
}

export function subpathBounds(sp: Subpath, out: Bounds2 = new Bounds2()): Bounds2 {
    for (const s of sp.segments) segmentBounds(s, out);
    return out;
}

export function pathBounds(p: Path2, out: Bounds2 = new Bounds2()): Bounds2 {
    for (const sp of p.subpaths) subpathBounds(sp, out);
    return out;
}

// ---- Builder -------------------------------------------------------------------------------

/**
 * Incremental builder with a current point, for code that thinks in "move/line/curve to".
 * Curves given with explicit geometry (arcs, NURBS) are appended as-is; if they do not start at
 * the current point a connecting line is inserted.
 */
export class PathBuilder {
    private readonly subpaths: Subpath[] = [];
    private segments: PathSegment[] = [];
    private current: Vec2 | undefined;

    moveTo(p: Vec2): this {
        this.flush(false);
        this.current = p;
        return this;
    }

    lineTo(p: Vec2): this {
        const c = this.requireCurrent();
        this.segments.push(lineSegment(c, p));
        this.current = p;
        return this;
    }

    quadTo(p1: Vec2, p2: Vec2): this {
        const c = this.requireCurrent();
        this.segments.push(quadSegment(c, p1, p2));
        this.current = p2;
        return this;
    }

    cubicTo(p1: Vec2, p2: Vec2, p3: Vec2): this {
        const c = this.requireCurrent();
        this.segments.push(cubicSegment(c, p1, p2, p3));
        this.current = p3;
        return this;
    }

    /** Append any segment; starts a subpath at its start if none is open. */
    segment(s: PathSegment): this {
        const start = segmentStart(s);
        if (!this.current) {
            this.current = start;
        } else if (start.x !== this.current.x || start.y !== this.current.y) {
            const dx = start.x - this.current.x;
            const dy = start.y - this.current.y;
            const scale = Math.max(Math.abs(start.x), Math.abs(start.y), 1);
            if (Math.hypot(dx, dy) > 1e-12 * scale) this.segments.push(lineSegment(this.current, start));
        }
        this.segments.push(s);
        this.current = segmentEnd(s);
        return this;
    }

    arc(arc: CircularArc2): this {
        return this.segment(arcSegment(arc));
    }

    ellipticArc(e: EllipticArc2): this {
        return this.segment(ellipticArcSegment(e));
    }

    nurbs(curve: NurbsCurve): this {
        return this.segment(nurbsSegment(curve));
    }

    close(): this {
        this.flush(true);
        return this;
    }

    build(): Path2 {
        this.flush(false);
        return { subpaths: this.subpaths.slice() };
    }

    private requireCurrent(): Vec2 {
        if (!this.current) throw new Error("PathBuilder: moveTo first");
        return this.current;
    }

    private flush(closed: boolean): void {
        if (this.segments.length > 0) this.subpaths.push({ segments: this.segments, closed });
        this.segments = [];
        if (closed) this.current = undefined;
    }
}
