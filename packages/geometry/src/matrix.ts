/**
 * Affine matrices: {@link Matrix44} (3D, homogeneous 4×4) and {@link Affine2} (2D, 2×3).
 *
 * Conventions (both types):
 * - **Column vectors**: a point is transformed as `p' = M · p`. `A.multiply(B)` is `A·B`, i.e.
 *   B is applied first, then A — the same convention as three.js and OpenGL.
 * - Matrix44 storage is **column-major** in a `Float64Array(16)`: element (row r, column c) is
 *   `m[c * 4 + r]`; the translation is `m[12], m[13], m[14]`. This is exactly three.js's
 *   `Matrix4.elements` layout, so `new THREE.Matrix4().fromArray(m.m)` works directly.
 * - Affine2 uses the SVG/canvas field names: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
 *
 * Instances are immutable (every operation returns a new matrix). Classes (not interfaces) are
 * used here because the 16 numbers live in a typed array and the operations read better as
 * methods; they are cheap to rebuild from `m` after a structured clone.
 *
 * Used for OCS→WCS (note 03 §2.2), INSERT stacks and the view/plot transform (note 03 §2.1).
 */

import { EPSILON, REL_EPSILON } from "./tolerance.ts";
import type { Vec2, Vec3 } from "./vec.ts";

export class Matrix44 {
    /** Column-major elements; see the module comment. Treat as read-only. */
    readonly m: Float64Array;

    /** Wraps `m` (16 column-major values) without copying. Use the static factories normally. */
    constructor(m: Float64Array) {
        if (m.length !== 16) throw new RangeError("Matrix44 needs 16 elements");
        this.m = m;
    }

    static identity(): Matrix44 {
        return Matrix44.fromRows(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    }

    /** Build from elements in reading order (row by row). */
    static fromRows(
        m00: number,
        m01: number,
        m02: number,
        m03: number,
        m10: number,
        m11: number,
        m12: number,
        m13: number,
        m20: number,
        m21: number,
        m22: number,
        m23: number,
        m30: number,
        m31: number,
        m32: number,
        m33: number,
    ): Matrix44 {
        return new Matrix44(
            Float64Array.of(m00, m10, m20, m30, m01, m11, m21, m31, m02, m12, m22, m32, m03, m13, m23, m33),
        );
    }

    /** Copy from a column-major array (e.g. three.js `elements`). */
    static fromArray(a: ArrayLike<number>): Matrix44 {
        return new Matrix44(Float64Array.from(a));
    }

    /** Affine matrix whose columns are the images of the unit axes and the origin. */
    static fromBasis(ux: Vec3, uy: Vec3, uz: Vec3, origin: Vec3 = { x: 0, y: 0, z: 0 }): Matrix44 {
        return new Matrix44(
            Float64Array.of(
                ux.x,
                ux.y,
                ux.z,
                0,
                uy.x,
                uy.y,
                uy.z,
                0,
                uz.x,
                uz.y,
                uz.z,
                0,
                origin.x,
                origin.y,
                origin.z,
                1,
            ),
        );
    }

    static translation(tx: number, ty: number, tz = 0): Matrix44 {
        return Matrix44.fromRows(1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz, 0, 0, 0, 1);
    }

    static scaling(sx: number, sy: number, sz = 1): Matrix44 {
        return Matrix44.fromRows(sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1);
    }

    /** Rotation about +Z by `angle` radians (CCW seen from +Z). */
    static rotationZ(angle: number): Matrix44 {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        return Matrix44.fromRows(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    }

    /** Rotation about a (not necessarily unit) axis through the origin (Rodrigues). */
    static rotationAxis(axis: Vec3, angle: number): Matrix44 {
        const l = Math.hypot(axis.x, axis.y, axis.z);
        if (l === 0) return Matrix44.identity();
        const x = axis.x / l;
        const y = axis.y / l;
        const z = axis.z / l;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const t = 1 - c;
        return Matrix44.fromRows(
            t * x * x + c,
            t * x * y - s * z,
            t * x * z + s * y,
            0,
            t * x * y + s * z,
            t * y * y + c,
            t * y * z - s * x,
            0,
            t * x * z - s * y,
            t * y * z + s * x,
            t * z * z + c,
            0,
            0,
            0,
            0,
            1,
        );
    }

    /** `M0 · M1 · … · Mk` — the last matrix is applied first. */
    static product(...ms: Matrix44[]): Matrix44 {
        let r = Matrix44.identity();
        for (const x of ms) r = r.multiply(x);
        return r;
    }

    /** Element at row `r`, column `c`. */
    get(r: number, c: number): number {
        return this.m[c * 4 + r]!;
    }

    /** `this · b` (apply `b` first). */
    multiply(b: Matrix44): Matrix44 {
        const a = this.m;
        const bm = b.m;
        const out = new Float64Array(16);
        for (let c = 0; c < 4; c++) {
            const b0 = bm[c * 4]!;
            const b1 = bm[c * 4 + 1]!;
            const b2 = bm[c * 4 + 2]!;
            const b3 = bm[c * 4 + 3]!;
            for (let r = 0; r < 4; r++) {
                out[c * 4 + r] = a[r]! * b0 + a[4 + r]! * b1 + a[8 + r]! * b2 + a[12 + r]! * b3;
            }
        }
        return new Matrix44(out);
    }

    /** `b · this` (apply `this` first, then `b`). */
    followedBy(b: Matrix44): Matrix44 {
        return b.multiply(this);
    }

    /** True when the bottom row is exactly (0, 0, 0, 1). */
    isAffine(): boolean {
        const m = this.m;
        return m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1;
    }

    determinant(): number {
        const [b00, b01, b02, b03, b04, b05, b06, b07, b08, b09, b10, b11] = this.minors();
        return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    }

    /** The twelve 2×2 minors shared by determinant and inverse (cofactor expansion). */
    private minors(): [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
    ] {
        const m = this.m;
        const a00 = m[0]!;
        const a01 = m[1]!;
        const a02 = m[2]!;
        const a03 = m[3]!;
        const a10 = m[4]!;
        const a11 = m[5]!;
        const a12 = m[6]!;
        const a13 = m[7]!;
        const a20 = m[8]!;
        const a21 = m[9]!;
        const a22 = m[10]!;
        const a23 = m[11]!;
        const a30 = m[12]!;
        const a31 = m[13]!;
        const a32 = m[14]!;
        const a33 = m[15]!;
        return [
            a00 * a11 - a01 * a10,
            a00 * a12 - a02 * a10,
            a00 * a13 - a03 * a10,
            a01 * a12 - a02 * a11,
            a01 * a13 - a03 * a11,
            a02 * a13 - a03 * a12,
            a20 * a31 - a21 * a30,
            a20 * a32 - a22 * a30,
            a20 * a33 - a23 * a30,
            a21 * a32 - a22 * a31,
            a21 * a33 - a23 * a31,
            a22 * a33 - a23 * a32,
        ];
    }

    /** Determinant of the upper-left 3×3 (linear) part. */
    determinant3(): number {
        const m = this.m;
        return (
            m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) -
            m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) +
            m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!)
        );
    }

    /**
     * True when the linear part reverses orientation (det < 0): mirrored INSERT scales or an
     * extrusion of (0,0,−1). Arcs then run clockwise after the transform (note 03 §2.2).
     */
    isMirroring(): boolean {
        return this.determinant3() < 0;
    }

    /** General inverse, or `undefined` when singular. */
    invert(): Matrix44 | undefined {
        const m = this.m;
        const a00 = m[0]!;
        const a01 = m[1]!;
        const a02 = m[2]!;
        const a03 = m[3]!;
        const a10 = m[4]!;
        const a11 = m[5]!;
        const a12 = m[6]!;
        const a13 = m[7]!;
        const a20 = m[8]!;
        const a21 = m[9]!;
        const a22 = m[10]!;
        const a23 = m[11]!;
        const a30 = m[12]!;
        const a31 = m[13]!;
        const a32 = m[14]!;
        const a33 = m[15]!;
        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;
        const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (det === 0 || !Number.isFinite(det)) return undefined;
        const inv = 1 / det;
        return new Matrix44(
            Float64Array.of(
                (a11 * b11 - a12 * b10 + a13 * b09) * inv,
                (a02 * b10 - a01 * b11 - a03 * b09) * inv,
                (a31 * b05 - a32 * b04 + a33 * b03) * inv,
                (a22 * b04 - a21 * b05 - a23 * b03) * inv,
                (a12 * b08 - a10 * b11 - a13 * b07) * inv,
                (a00 * b11 - a02 * b08 + a03 * b07) * inv,
                (a32 * b02 - a30 * b05 - a33 * b01) * inv,
                (a20 * b05 - a22 * b02 + a23 * b01) * inv,
                (a10 * b10 - a11 * b08 + a13 * b06) * inv,
                (a01 * b08 - a00 * b10 - a03 * b06) * inv,
                (a30 * b04 - a31 * b02 + a33 * b00) * inv,
                (a21 * b02 - a20 * b04 - a23 * b00) * inv,
                (a11 * b07 - a10 * b09 - a12 * b06) * inv,
                (a00 * b09 - a01 * b07 + a02 * b06) * inv,
                (a31 * b01 - a30 * b03 - a32 * b00) * inv,
                (a20 * b03 - a21 * b01 + a22 * b00) * inv,
            ),
        );
    }

    transpose(): Matrix44 {
        const m = this.m;
        const out = new Float64Array(16);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = m[r * 4 + c]!;
        return new Matrix44(out);
    }

    /** Transform a point (w = 1); divides by w' when the matrix is projective. */
    transformPoint(p: Vec3): Vec3 {
        const m = this.m;
        const x = m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!;
        const y = m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!;
        const z = m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]!;
        const w = m[3]! * p.x + m[7]! * p.y + m[11]! * p.z + m[15]!;
        return w === 1 ? { x, y, z } : { x: x / w, y: y / w, z: z / w };
    }

    /** Transform a direction (w = 0): linear part only, not normalized. */
    transformDirection(v: Vec3): Vec3 {
        const m = this.m;
        return {
            x: m[0]! * v.x + m[4]! * v.y + m[8]! * v.z,
            y: m[1]! * v.x + m[5]! * v.y + m[9]! * v.z,
            z: m[2]! * v.x + m[6]! * v.y + m[10]! * v.z,
        };
    }

    /**
     * Transform interleaved xyz points from `src` into `dst` (may be the same array). Affine only
     * (w is ignored) — this is the hot-loop variant.
     */
    transformPoints3(src: Float64Array, dst: Float64Array = new Float64Array(src.length)): Float64Array {
        const m = this.m;
        const m0 = m[0]!;
        const m1 = m[1]!;
        const m2 = m[2]!;
        const m4 = m[4]!;
        const m5 = m[5]!;
        const m6 = m[6]!;
        const m8 = m[8]!;
        const m9 = m[9]!;
        const m10 = m[10]!;
        const m12 = m[12]!;
        const m13 = m[13]!;
        const m14 = m[14]!;
        for (let i = 0; i + 2 < src.length; i += 3) {
            const x = src[i]!;
            const y = src[i + 1]!;
            const z = src[i + 2]!;
            dst[i] = m0 * x + m4 * y + m8 * z + m12;
            dst[i + 1] = m1 * x + m5 * y + m9 * z + m13;
            dst[i + 2] = m2 * x + m6 * y + m10 * z + m14;
        }
        return dst;
    }

    /**
     * Parallel projection: transform interleaved xyz points and keep x, y (drop z), writing
     * interleaved xy into `dst`.
     */
    projectPoints(
        src: Float64Array,
        dst: Float64Array = new Float64Array((src.length / 3) * 2),
    ): Float64Array {
        const m = this.m;
        const m0 = m[0]!;
        const m1 = m[1]!;
        const m4 = m[4]!;
        const m5 = m[5]!;
        const m8 = m[8]!;
        const m9 = m[9]!;
        const m12 = m[12]!;
        const m13 = m[13]!;
        for (let i = 0, j = 0; i + 2 < src.length; i += 3, j += 2) {
            const x = src[i]!;
            const y = src[i + 1]!;
            const z = src[i + 2]!;
            dst[j] = m0 * x + m4 * y + m8 * z + m12;
            dst[j + 1] = m1 * x + m5 * y + m9 * z + m13;
        }
        return dst;
    }

    /**
     * The 2D affine map of a plane `z = elevation` (in this matrix's source space) onto the
     * projected x/y of the target: `(x, y) ↦ xy(M · (x, y, elevation))`. This is how planar OCS
     * geometry (LWPOLYLINE, ARC, HATCH) is taken to the plot plane exactly (note 03 §2.1, §3.6).
     */
    planeToAffine2(elevation = 0): Affine2 {
        const m = this.m;
        return new Affine2(
            m[0]!,
            m[1]!,
            m[4]!,
            m[5]!,
            m[8]! * elevation + m[12]!,
            m[9]! * elevation + m[13]!,
        );
    }

    equals(b: Matrix44, tol = 0): boolean {
        for (let i = 0; i < 16; i++) if (Math.abs(this.m[i]! - b.m[i]!) > tol) return false;
        return true;
    }
}

/** 2D affine map `x' = a·x + c·y + e`, `y' = b·x + d·y + f` (column vectors). */
export class Affine2 {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
    readonly e: number;
    readonly f: number;

    constructor(a: number, b: number, c: number, d: number, e: number, f: number) {
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
        this.e = e;
        this.f = f;
    }

    static identity(): Affine2 {
        return new Affine2(1, 0, 0, 1, 0, 0);
    }

    static translation(tx: number, ty: number): Affine2 {
        return new Affine2(1, 0, 0, 1, tx, ty);
    }

    static scaling(sx: number, sy = sx): Affine2 {
        return new Affine2(sx, 0, 0, sy, 0, 0);
    }

    static rotation(angle: number): Affine2 {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        return new Affine2(c, s, -s, c, 0, 0);
    }

    /** `this · o` (apply `o` first). */
    multiply(o: Affine2): Affine2 {
        return new Affine2(
            this.a * o.a + this.c * o.b,
            this.b * o.a + this.d * o.b,
            this.a * o.c + this.c * o.d,
            this.b * o.c + this.d * o.d,
            this.a * o.e + this.c * o.f + this.e,
            this.b * o.e + this.d * o.f + this.f,
        );
    }

    /** `o · this` (apply `this` first). */
    followedBy(o: Affine2): Affine2 {
        return o.multiply(this);
    }

    determinant(): number {
        return this.a * this.d - this.b * this.c;
    }

    isMirroring(): boolean {
        return this.determinant() < 0;
    }

    invert(): Affine2 | undefined {
        const det = this.determinant();
        if (det === 0 || !Number.isFinite(det)) return undefined;
        const ia = this.d / det;
        const ib = -this.b / det;
        const ic = -this.c / det;
        const id = this.a / det;
        return new Affine2(ia, ib, ic, id, -(ia * this.e + ic * this.f), -(ib * this.e + id * this.f));
    }

    apply(p: Vec2): Vec2 {
        return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f };
    }

    applyVector(v: Vec2): Vec2 {
        return { x: this.a * v.x + this.c * v.y, y: this.b * v.x + this.d * v.y };
    }

    /** Transform interleaved xy points (hot-loop variant). */
    applyPoints(src: Float64Array, dst: Float64Array = new Float64Array(src.length)): Float64Array {
        const { a, b, c, d, e, f } = this;
        for (let i = 0; i + 1 < src.length; i += 2) {
            const x = src[i]!;
            const y = src[i + 1]!;
            dst[i] = a * x + c * y + e;
            dst[i + 1] = b * x + d * y + f;
        }
        return dst;
    }

    /** Singular values `[σmax, σmin]` of the linear part. */
    singularValues(): [number, number] {
        return singularValues2(this.a, this.b, this.c, this.d);
    }

    /**
     * If the linear part is a similarity (rotation · uniform scale, possibly mirrored), return the
     * scale factor; otherwise `undefined`. Circles stay circles exactly under similarities.
     */
    similarityScale(rel = REL_EPSILON): number | undefined {
        const { a, b, c, d } = this;
        const s2x = a * a + b * b;
        const s2y = c * c + d * d;
        const dotxy = a * c + b * d;
        const m = Math.max(s2x, s2y);
        if (m <= 0) return undefined;
        if (Math.abs(s2x - s2y) > rel * m || Math.abs(dotxy) > rel * m) return undefined;
        return Math.sqrt((s2x + s2y) / 2);
    }

    toMatrix44(): Matrix44 {
        return Matrix44.fromRows(
            this.a,
            this.c,
            0,
            this.e,
            this.b,
            this.d,
            0,
            this.f,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
        );
    }

    equals(o: Affine2, tol = 0): boolean {
        return (
            Math.abs(this.a - o.a) <= tol &&
            Math.abs(this.b - o.b) <= tol &&
            Math.abs(this.c - o.c) <= tol &&
            Math.abs(this.d - o.d) <= tol &&
            Math.abs(this.e - o.e) <= tol &&
            Math.abs(this.f - o.f) <= tol
        );
    }
}

/**
 * Singular values `[σmax, σmin]` of the 2×2 matrix with columns `(a, b)` and `(c, d)`.
 * σmax bounds how much any vector is stretched — used to convert device tolerances into
 * source-space tolerances and to size ellipse flattening (note 03 §5.3).
 */
export function singularValues2(a: number, b: number, c: number, d: number): [number, number] {
    // Closed form via E = (a+d)/2, F = (a−d)/2, G = (b+c)/2, H = (b−c)/2 on [[a c],[b d]].
    const e = (a + d) / 2;
    const f = (a - d) / 2;
    const g = (b + c) / 2;
    const h = (b - c) / 2;
    const q = Math.hypot(e, h);
    const r = Math.hypot(f, g);
    return [q + r, Math.abs(q - r)];
}

/** True when `|x| <= EPSILON` (helper for degenerate-matrix checks). */
export function nearZero(x: number): boolean {
    return Math.abs(x) <= EPSILON;
}
