/**
 * Circular arcs in a plane (OCS or projected 2D) and bulge ↔ arc conversions.
 *
 * - ARC runs CCW about N from 50 to 51 (degrees); span rule incl. start == end → point and
 *   congruent values → full circle (note 03 §3.5, see angle.ts).
 * - Bulge `b = tan(θ/4)`, θ the signed included angle; b > 0 is CCW from this vertex to the next
 *   (note 03 §3.9.1). Formulas:
 *   ```
 *   c = |P2 − P1|, θ = 4·atan(b), r = c·(1 + b²)/(4|b|), h = c·(1 − b²)/(4b)
 *   Center = M + h·n̂ (M chord midpoint, n̂ left normal of P1→P2), a1 = atan2(P1 − C), a2 = a1 + θ
 *   ```
 * Arcs are represented with a signed sweep so a CW bulge arc keeps its direction (important for
 * linetype phase and tapered widths, note 03 §4.2 item 5).
 */

import { angleInSweep, arcSpanDeg, degToRad, normalizeDeg, TAU } from "./angle.ts";
import { Bounds2 } from "./bounds.ts";
import type { Vec2 } from "./vec.ts";

/** `P(φ) = center + radius·(cos φ, sin φ)` for φ from `start` to `start + sweep` (radians). */
export interface CircularArc2 {
    readonly center: Vec2;
    readonly radius: number;
    /** Start angle in radians. */
    readonly start: number;
    /** Signed sweep in radians: > 0 CCW, < 0 CW. |sweep| ≤ 2π. */
    readonly sweep: number;
}

/**
 * ARC entity angles (degrees, CCW) → arc with non-negative sweep. The span follows the ARC
 * full-circle rule; a zero span (start == end) is a degenerate arc that AutoCAD draws as a point.
 */
export function arcFromDegrees(center: Vec2, radius: number, startDeg: number, endDeg: number): CircularArc2 {
    return {
        center,
        radius,
        start: degToRad(normalizeDeg(startDeg)),
        sweep: degToRad(arcSpanDeg(startDeg, endDeg)),
    };
}

/** Full CCW circle starting at angle 0 (CIRCLE entity; linetype starts at OCS angle 0, note 03 §3.4). */
export function circleArc(center: Vec2, radius: number): CircularArc2 {
    return { center, radius, start: 0, sweep: TAU };
}

export function arcPointAtAngle(arc: CircularArc2, phi: number): Vec2 {
    return { x: arc.center.x + arc.radius * Math.cos(phi), y: arc.center.y + arc.radius * Math.sin(phi) };
}

/** Point at normalized parameter `t ∈ [0, 1]` along the sweep. */
export function arcPointAt(arc: CircularArc2, t: number): Vec2 {
    return arcPointAtAngle(arc, arc.start + arc.sweep * t);
}

export function arcStartPoint(arc: CircularArc2): Vec2 {
    return arcPointAtAngle(arc, arc.start);
}

export function arcEndPoint(arc: CircularArc2): Vec2 {
    return arcPointAtAngle(arc, arc.start + arc.sweep);
}

/** Derivative d/dt of {@link arcPointAt} (t ∈ [0,1]). */
export function arcDerivativeAt(arc: CircularArc2, t: number): Vec2 {
    const phi = arc.start + arc.sweep * t;
    const k = arc.radius * arc.sweep;
    return { x: -k * Math.sin(phi), y: k * Math.cos(phi) };
}

export function arcLength(arc: CircularArc2): number {
    return Math.abs(arc.radius * arc.sweep);
}

export function reverseArc(arc: CircularArc2): CircularArc2 {
    return { center: arc.center, radius: arc.radius, start: arc.start + arc.sweep, sweep: -arc.sweep };
}

/**
 * Exact bounding box: endpoints plus every axis point (0°, 90°, 180°, 270°) inside the sweep
 * (note 03 §3.5, §6.1).
 */
export function arcBounds(arc: CircularArc2, out: Bounds2 = new Bounds2()): Bounds2 {
    const { center: c, radius: r } = arc;
    const s = arc.sweep >= 0 ? arc.start : arc.start + arc.sweep;
    const sw = Math.abs(arc.sweep);
    out.addPoint(arcPointAtAngle(arc, arc.start));
    out.addPoint(arcPointAtAngle(arc, arc.start + arc.sweep));
    if (angleInSweep(0, s, sw)) out.addXY(c.x + r, c.y);
    if (angleInSweep(Math.PI / 2, s, sw)) out.addXY(c.x, c.y + r);
    if (angleInSweep(Math.PI, s, sw)) out.addXY(c.x - r, c.y);
    if (angleInSweep((3 * Math.PI) / 2, s, sw)) out.addXY(c.x, c.y - r);
    return out;
}

// ---- Bulge ---------------------------------------------------------------------------------

/**
 * Bulges with `|b| <` this are straight: the sagitta `|b|·c/2` is then below 5e-11 of the chord,
 * far below any device tolerance, while the radius `~c/(4|b|)` would overflow for denormal b.
 */
export const MIN_BULGE = 1e-10;

/**
 * Arc of a bulge segment from `p1` to `p2` (note 03 §3.9.1). Returns `undefined` for a straight
 * segment (|b| < {@link MIN_BULGE}) or coincident points. The arc starts at `p1` and ends at
 * `p2`; its sweep is `4·atan(b)` (signed).
 */
export function bulgeToArc(p1: Vec2, p2: Vec2, bulge: number): CircularArc2 | undefined {
    if (!(Math.abs(bulge) >= MIN_BULGE) || !Number.isFinite(bulge)) return undefined;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const c = Math.hypot(dx, dy);
    if (c === 0) return undefined;
    const b = bulge;
    const sweep = 4 * Math.atan(b);
    const radius = (c * (1 + b * b)) / (4 * Math.abs(b));
    // Signed distance from the chord midpoint to the center along the left normal.
    const h = (c * (1 - b * b)) / (4 * b);
    const nx = -dy / c;
    const ny = dx / c;
    const center = { x: (p1.x + p2.x) / 2 + h * nx, y: (p1.y + p2.y) / 2 + h * ny };
    const start = Math.atan2(p1.y - center.y, p1.x - center.x);
    return { center, radius, start, sweep };
}

/** Bulge of an arc with signed sweep (radians): `tan(sweep/4)`. */
export function bulgeFromSweep(sweep: number): number {
    return Math.tan(sweep / 4);
}

/** Bulge of the arc as a polyline segment (from its start point to its end point). */
export function arcToBulge(arc: CircularArc2): { start: Vec2; end: Vec2; bulge: number } {
    return { start: arcStartPoint(arc), end: arcEndPoint(arc), bulge: bulgeFromSweep(arc.sweep) };
}

/**
 * Magnitude of the bulge of a minor arc of radius `r` over chord `c`: `x/(1 + sqrt(1 − x²))`,
 * `x = c/(2r)` (note 03 §3.9.1, ezdxf `bulge_from_radius_and_chord`). Returns 0 for `c > 2r`.
 */
export function bulgeFromRadiusAndChord(radius: number, chord: number): number {
    const x = chord / (2 * radius);
    if (!(x <= 1)) return 0;
    return x / (1 + Math.sqrt(1 - x * x));
}

/** Radius of a bulge segment with chord length `c`. */
export function bulgeRadius(chord: number, bulge: number): number {
    return (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
}

/** Sagitta (max distance of the arc from its chord) of a bulge segment: `|b|·c/2`. */
export function bulgeSagitta(chord: number, bulge: number): number {
    return (Math.abs(bulge) * chord) / 2;
}
