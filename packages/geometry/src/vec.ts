/**
 * 2D/3D vectors.
 *
 * Representation decision: vectors are plain **readonly `{ x, y }` / `{ x, y, z }` object
 * interfaces** with free functions, not classes.
 * - `@truedxf/model` exposes entity points as plain `{x, y, z}` objects, so entity data flows
 *   into the kernel without conversion (structural typing).
 * - Plain objects of one shape get a single V8 hidden class and inline well; free functions
 *   tree-shake and survive `postMessage`/structured clone (no prototypes to lose in workers).
 * - Hot loops (flattening, stroking, NURBS evaluation) do not allocate vectors at all: they
 *   work on interleaved `Float64Array`s (`x0, y0, x1, y1, …`).
 *
 * Naming: suffix `2`/`3` gives the dimension (`add3`, `dot2`). All functions return new objects
 * and never mutate their arguments.
 */

export interface Vec2 {
    readonly x: number;
    readonly y: number;
}

export interface Vec3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export function vec2(x: number, y: number): Vec2 {
    return { x, y };
}

export function vec3(x: number, y: number, z: number): Vec3 {
    return { x, y, z };
}

export const ZERO2: Vec2 = Object.freeze({ x: 0, y: 0 });
export const ZERO3: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const X_AXIS: Vec3 = Object.freeze({ x: 1, y: 0, z: 0 });
export const Y_AXIS: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 });
export const Z_AXIS: Vec3 = Object.freeze({ x: 0, y: 0, z: 1 });

// ---- Vec2 ----------------------------------------------------------------------------------

export function add2(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
}

export function scale2(a: Vec2, s: number): Vec2 {
    return { x: a.x * s, y: a.y * s };
}

/** `a + b·s` */
export function addScaled2(a: Vec2, b: Vec2, s: number): Vec2 {
    return { x: a.x + b.x * s, y: a.y + b.y * s };
}

export function neg2(a: Vec2): Vec2 {
    return { x: -a.x, y: -a.y };
}

export function dot2(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
}

/** z component of the 3D cross product (positive when b is CCW from a). */
export function cross2(a: Vec2, b: Vec2): number {
    return a.x * b.y - a.y * b.x;
}

export function length2(a: Vec2): number {
    return Math.hypot(a.x, a.y);
}

export function lengthSq2(a: Vec2): number {
    return a.x * a.x + a.y * a.y;
}

export function distance2(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Unit vector; returns (0,0) for a zero vector. */
export function normalize2(a: Vec2): Vec2 {
    const l = Math.hypot(a.x, a.y);
    return l > 0 ? { x: a.x / l, y: a.y / l } : ZERO2;
}

/** Rotate 90° counter-clockwise (left normal). */
export function perp2(a: Vec2): Vec2 {
    return { x: -a.y, y: a.x };
}

export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function midpoint2(a: Vec2, b: Vec2): Vec2 {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Polar angle in radians, (−π, π]. */
export function angle2(a: Vec2): number {
    return Math.atan2(a.y, a.x);
}

/** Point at `center + r·(cos a, sin a)`. */
export function polar2(center: Vec2, r: number, a: number): Vec2 {
    return { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
}

export function equals2(a: Vec2, b: Vec2, tol = 0): boolean {
    return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

// ---- Vec3 ----------------------------------------------------------------------------------

export function add3(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale3(a: Vec3, s: number): Vec3 {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}

/** `a + b·s` */
export function addScaled3(a: Vec3, b: Vec3, s: number): Vec3 {
    return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}

export function neg3(a: Vec3): Vec3 {
    return { x: -a.x, y: -a.y, z: -a.z };
}

export function dot3(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** `a × b = (a.y·b.z − a.z·b.y, a.z·b.x − a.x·b.z, a.x·b.y − a.y·b.x)` (note 03 §2.2). */
export function cross3(a: Vec3, b: Vec3): Vec3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

export function length3(a: Vec3): number {
    return Math.hypot(a.x, a.y, a.z);
}

export function lengthSq3(a: Vec3): number {
    return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function distance3(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Unit vector; returns (0,0,0) for a zero vector. */
export function normalize3(a: Vec3): Vec3 {
    const l = Math.hypot(a.x, a.y, a.z);
    return l > 0 ? { x: a.x / l, y: a.y / l, z: a.z / l } : ZERO3;
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function equals3(a: Vec3, b: Vec3, tol = 0): boolean {
    return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol;
}

/** Drop z (parallel projection onto the XY plane). */
export function xy(a: Vec3): Vec2 {
    return { x: a.x, y: a.y };
}

/** Lift a 2D point to 3D with the given z. */
export function withZ(a: Vec2, z = 0): Vec3 {
    return { x: a.x, y: a.y, z };
}
