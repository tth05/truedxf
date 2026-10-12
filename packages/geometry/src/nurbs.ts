/**
 * NURBS / B-spline curves of any degree (1–n) in 2D or 3D.
 *
 * Note 03 §3.8:
 * - Evaluate the stored control points, knots and weights as a standard NURBS over the domain
 *   `[U[p], U[n+1]]` (`n + 1` control points, `m + 1 = n + p + 2` knots). This covers clamped
 *   and unclamped vectors, and AutoCAD's **periodic storage** (n + p control points whose first p
 *   repeat the last p, n + 2p + 1 knots) with no special case (§3.8.4). The closed/periodic flags
 *   do not change evaluation (VERIFIED-BY-ACAD via TrueView, ezdxf#851).
 * - Point evaluation: de Boor in homogeneous coordinates (§3.8.5). Derivatives: NURBS Book A2.3
 *   (basis function derivatives) + A4.2 (rational curve derivatives).
 * - Span search: binary search over `[p, n]` with the end special case (ezdxf's linear
 *   fallback exists because its binary search looped on odd knot vectors, §3.8.5).
 * - Knot insertion: Boehm's algorithm (NURBS Book A5.1) in homogeneous coordinates.
 * - Bézier decomposition: insert every distinct knot of the domain (incl. both ends) up to
 *   multiplicity p; each non-empty span then has its own p+1 Bézier control points (§3.8.5).
 *
 * The domain ends are `knots[degree]` and `knots[count]`.
 */

import { type BezierCurve, bezierBounds, flattenBezierInto, fromHomogeneous } from "./bezier.ts";
import type { Affine2, Matrix44 } from "./matrix.ts";

export class NurbsCurve {
    readonly degree: number;
    /** 2 or 3. */
    readonly dim: number;
    /** Cartesian control points, `count · dim` values. */
    readonly points: Float64Array;
    readonly knots: Float64Array;
    /** One weight per control point, or undefined for a non-rational B-spline. */
    readonly weights: Float64Array | undefined;

    constructor(
        degree: number,
        dim: number,
        points: Float64Array,
        knots: Float64Array,
        weights?: Float64Array | undefined,
    ) {
        if (!(degree >= 1) || !Number.isInteger(degree)) throw new RangeError(`invalid degree ${degree}`);
        if (points.length % dim !== 0) throw new RangeError("points length is not a multiple of dim");
        const count = points.length / dim;
        if (count < degree + 1)
            throw new RangeError(`need at least ${degree + 1} control points, got ${count}`);
        if (knots.length !== count + degree + 1) {
            throw new RangeError(`expected ${count + degree + 1} knots, got ${knots.length}`);
        }
        for (let i = 1; i < knots.length; i++) {
            if (!(knots[i]! >= knots[i - 1]!)) throw new RangeError("knots must be non-decreasing");
        }
        if (weights && weights.length !== count)
            throw new RangeError("weights length must equal control point count");
        if (!(knots[count]! > knots[degree]!)) throw new RangeError("empty parameter domain");
        this.degree = degree;
        this.dim = dim;
        this.points = points;
        this.knots = knots;
        this.weights = weights;
    }

    /** Number of control points. */
    get count(): number {
        return this.points.length / this.dim;
    }

    get domainStart(): number {
        return this.knots[this.degree]!;
    }

    get domainEnd(): number {
        return this.knots[this.count]!;
    }

    /** True when weights are present and not all equal. */
    get isRational(): boolean {
        const w = this.weights;
        if (!w) return false;
        for (let i = 1; i < w.length; i++) if (w[i] !== w[0]) return true;
        return false;
    }

    /** Control point i as an array of `dim` numbers. */
    controlPoint(i: number): number[] {
        return Array.from(this.points.subarray(i * this.dim, (i + 1) * this.dim));
    }

    /**
     * Knot span index k in [p, n] with `U[k] ≤ u < U[k+1]`; for u at (or beyond) the domain end
     * the last non-empty span. `u` is clamped to the domain.
     */
    findSpan(u: number): number {
        return findKnotSpan(this.knots, this.count, this.degree, u);
    }

    /** Evaluate the curve point at `u` (clamped to the domain) via de Boor (note 03 §3.8.5). */
    pointAt(u: number, out: Float64Array = new Float64Array(this.dim)): Float64Array {
        const p = this.degree;
        const d = this.dim;
        const s = d + 1;
        const U = this.knots;
        const uu = Math.min(Math.max(u, this.domainStart), this.domainEnd);
        const k = this.findSpan(uu);
        const tmp = new Float64Array((p + 1) * s);
        for (let j = 0; j <= p; j++) {
            const i = k - p + j;
            const w = this.weights ? this.weights[i]! : 1;
            for (let c = 0; c < d; c++) tmp[j * s + c] = this.points[i * d + c]! * w;
            tmp[j * s + d] = w;
        }
        for (let r = 1; r <= p; r++) {
            for (let j = p; j >= r; j--) {
                const i = k - p + j;
                const denom = U[i + p - r + 1]! - U[i]!;
                const alpha = denom === 0 ? 0 : (uu - U[i]!) / denom;
                for (let c = 0; c < s; c++)
                    tmp[j * s + c] = (1 - alpha) * tmp[(j - 1) * s + c]! + alpha * tmp[j * s + c]!;
            }
        }
        const w = tmp[p * s + d]!;
        for (let c = 0; c < d; c++) out[c] = tmp[p * s + c]! / w;
        return out;
    }

    /**
     * Derivatives `C(u), C'(u), …, C^(order)(u)` (each `dim` values) w.r.t. the knot parameter.
     * NURBS Book A2.3 + A4.2.
     */
    derivativesAt(u: number, order: number): Float64Array[] {
        const p = this.degree;
        const d = this.dim;
        const uu = Math.min(Math.max(u, this.domainStart), this.domainEnd);
        const k = this.findSpan(uu);
        const du = Math.min(order, p);
        const ders = basisFunctionDerivatives(k, uu, p, du, this.knots);
        // Homogeneous derivatives A^(i) (d coords) and w^(i).
        const A: Float64Array[] = [];
        const W: number[] = [];
        for (let i = 0; i <= order; i++) {
            const a = new Float64Array(d);
            let w = 0;
            if (i <= du) {
                const row = ders[i]!;
                for (let j = 0; j <= p; j++) {
                    const idx = k - p + j;
                    const wt = this.weights ? this.weights[idx]! : 1;
                    const f = row[j]! * wt;
                    for (let c = 0; c < d; c++) a[c] = a[c]! + f * this.points[idx * d + c]!;
                    w += f;
                }
            }
            A.push(a);
            W.push(w);
        }
        const CK: Float64Array[] = [];
        for (let i = 0; i <= order; i++) {
            const v = Float64Array.from(A[i]!);
            for (let j = 1; j <= i; j++) {
                const f = binomial(i, j) * W[j]!;
                const prev = CK[i - j]!;
                for (let c = 0; c < d; c++) v[c] = v[c]! - f * prev[c]!;
            }
            for (let c = 0; c < d; c++) v[c] = v[c]! / W[0]!;
            CK.push(v);
        }
        return CK;
    }

    /** Insert knot `u` `times` times (Boehm, homogeneous). The curve shape is unchanged. */
    insertKnot(u: number, times = 1): NurbsCurve {
        let c: NurbsCurve = this;
        for (let t = 0; t < times; t++) c = c.insertKnotOnce(u);
        return c;
    }

    private insertKnotOnce(u: number): NurbsCurve {
        const p = this.degree;
        const d = this.dim;
        const s = d + 1;
        const n = this.count - 1;
        const U = this.knots;
        const k = this.findSpan(u);
        const Pw = this.homogeneous();
        const Q = new Float64Array((n + 2) * s);
        for (let i = 0; i <= k - p; i++) for (let c = 0; c < s; c++) Q[i * s + c] = Pw[i * s + c]!;
        for (let i = k; i <= n; i++) for (let c = 0; c < s; c++) Q[(i + 1) * s + c] = Pw[i * s + c]!;
        for (let i = k - p + 1; i <= k; i++) {
            const denom = U[i + p]! - U[i]!;
            const alpha = denom === 0 ? 0 : (u - U[i]!) / denom;
            for (let c = 0; c < s; c++)
                Q[i * s + c] = alpha * Pw[i * s + c]! + (1 - alpha) * Pw[(i - 1) * s + c]!;
        }
        const knots = new Float64Array(U.length + 1);
        knots.set(U.subarray(0, k + 1), 0);
        knots[k + 1] = u;
        knots.set(U.subarray(k + 1), k + 2);
        return NurbsCurve.fromHomogeneous(p, d, Q, knots, this.weights !== undefined);
    }

    /** Homogeneous control points `(w·P, w)`. */
    homogeneous(): Float64Array {
        const d = this.dim;
        const s = d + 1;
        const n = this.count;
        const h = new Float64Array(n * s);
        for (let i = 0; i < n; i++) {
            const w = this.weights ? this.weights[i]! : 1;
            for (let c = 0; c < d; c++) h[i * s + c] = this.points[i * d + c]! * w;
            h[i * s + d] = w;
        }
        return h;
    }

    static fromHomogeneous(
        degree: number,
        dim: number,
        h: Float64Array,
        knots: Float64Array,
        rational: boolean,
    ): NurbsCurve {
        const s = dim + 1;
        const n = h.length / s;
        const points = new Float64Array(n * dim);
        const weights = rational ? new Float64Array(n) : undefined;
        for (let i = 0; i < n; i++) {
            const w = h[i * s + dim]!;
            for (let c = 0; c < dim; c++) points[i * dim + c] = h[i * s + c]! / w;
            if (weights) weights[i] = w;
        }
        return new NurbsCurve(degree, dim, points, knots, weights);
    }

    /**
     * Exact Bézier decomposition of the domain. Each piece covers `[u0, u1]` of the original
     * parameter; its local parameter t ∈ [0, 1] maps linearly.
     */
    bezierSegments(): BezierPiece[] {
        const p = this.degree;
        let c: NurbsCurve = this;
        // Distinct knot values in the closed domain.
        const a = this.domainStart;
        const b = this.domainEnd;
        const values: number[] = [];
        for (const v of this.knots)
            if (v >= a && v <= b && (values.length === 0 || v !== values[values.length - 1])) values.push(v);
        for (const v of values) {
            let mult = 0;
            for (const x of c.knots) if (x === v) mult++;
            if (mult < p) c = c.insertKnot(v, p - mult);
        }
        const U = c.knots;
        const d = this.dim;
        const s = d + 1;
        const H = c.homogeneous();
        const rational = this.weights !== undefined;
        const out: BezierPiece[] = [];
        for (let k = p; k < c.count; k++) {
            if (!(U[k + 1]! > U[k]!)) continue;
            if (U[k]! < a || U[k + 1]! > b) continue;
            const h = H.slice((k - p) * s, (k + 1) * s);
            const bz = fromHomogeneous(h, p, d, rational);
            out.push({ ...bz, u0: U[k]!, u1: U[k + 1]! });
        }
        return out;
    }

    /** Affine transform (3D curves). Weights are unchanged under affine maps. */
    transform(m: Matrix44): NurbsCurve {
        if (this.dim !== 3) throw new Error("transform needs a 3D curve");
        return new NurbsCurve(this.degree, 3, m.transformPoints3(this.points), this.knots, this.weights);
    }

    /** Transform by `m` and project in parallel onto the target XY plane → 2D curve. */
    project(m: Matrix44): NurbsCurve {
        if (this.dim !== 3) throw new Error("project needs a 3D curve");
        return new NurbsCurve(this.degree, 2, m.projectPoints(this.points), this.knots, this.weights);
    }

    /** 2D affine transform (2D curves). */
    transform2(a: Affine2): NurbsCurve {
        if (this.dim !== 2) throw new Error("transform2 needs a 2D curve");
        return new NurbsCurve(this.degree, 2, a.applyPoints(this.points), this.knots, this.weights);
    }

    /** Same curve traversed backwards; the parameter maps as `u' = a + b − u`. */
    reverse(): NurbsCurve {
        const d = this.dim;
        const n = this.count;
        const pts = new Float64Array(this.points.length);
        for (let i = 0; i < n; i++)
            for (let c = 0; c < d; c++) pts[i * d + c] = this.points[(n - 1 - i) * d + c]!;
        const U = this.knots;
        const a = U[0]!;
        const b = U[U.length - 1]!;
        const knots = new Float64Array(U.length);
        for (let i = 0; i < U.length; i++) knots[i] = a + b - U[U.length - 1 - i]!;
        const w = this.weights ? Float64Array.from(this.weights).reverse() : undefined;
        return new NurbsCurve(this.degree, d, pts, knots, w);
    }

    /** Tight bounds `[min..., max...]` from the Bézier pieces (curve, not control polygon; §6.1). */
    bounds(): Float64Array {
        const d = this.dim;
        const box = new Float64Array(2 * d);
        box.fill(Infinity, 0, d);
        box.fill(-Infinity, d, 2 * d);
        for (const piece of this.bezierSegments()) {
            const b = bezierBounds(piece);
            for (let c = 0; c < d; c++) {
                box[c] = Math.min(box[c]!, b[c]!);
                box[d + c] = Math.max(box[d + c]!, b[d + c]!);
            }
        }
        return box;
    }

    /**
     * Flatten to interleaved coordinates (`dim` per point) with max deviation ≤ `tol` (in curve
     * units): Bézier decomposition, then Wang's count (polynomial) or hull-adaptive subdivision
     * (rational) per piece (note 03 §3.8.8). Deterministic.
     */
    flatten(tol: number): Float64Array {
        const pieces = this.bezierSegments();
        const out: number[] = [];
        const first = pieces[0]!;
        for (let c = 0; c < this.dim; c++) out.push(first.points[c]!);
        for (const piece of pieces) flattenBezierInto(piece, tol, out);
        return Float64Array.from(out);
    }
}

/** A Bézier piece of a NURBS, covering the original parameter interval `[u0, u1]`. */
export interface BezierPiece extends BezierCurve {
    readonly u0: number;
    readonly u1: number;
}

/**
 * Knot span index k in [p, n] (n = count − 1) with `U[k] ≤ u < U[k+1]`; for u at or beyond the
 * domain end the last non-empty span, before the domain start the first one. Binary search.
 */
export function findKnotSpan(U: ArrayLike<number>, count: number, p: number, u: number): number {
    const n = count - 1;
    if (u >= U[n + 1]!) {
        let k = n;
        while (k > p && !(U[k]! < U[k + 1]!)) k--;
        return k;
    }
    if (u <= U[p]!) {
        let k = p;
        while (k < n && !(U[k + 1]! > U[k]!)) k++;
        return k;
    }
    let lo = p;
    let hi = n + 1;
    // Invariant: U[lo] <= u < U[hi].
    while (hi - lo > 1) {
        const mid = (lo + hi) >>> 1;
        if (u < U[mid]!) hi = mid;
        else lo = mid;
    }
    return lo;
}

/**
 * Basis functions and derivatives `ders[k][j] = N^(k)_{span−p+j, p}(u)`, k = 0..n
 * (NURBS Book A2.3).
 */
export function basisFunctionDerivatives(
    span: number,
    u: number,
    p: number,
    n: number,
    U: ArrayLike<number>,
): Float64Array[] {
    const ndu: Float64Array[] = [];
    for (let j = 0; j <= p; j++) ndu.push(new Float64Array(p + 1));
    const left = new Float64Array(p + 1);
    const right = new Float64Array(p + 1);
    ndu[0]![0] = 1;
    for (let j = 1; j <= p; j++) {
        left[j] = u - U[span + 1 - j]!;
        right[j] = U[span + j]! - u;
        let saved = 0;
        for (let r = 0; r < j; r++) {
            // Lower triangle: knot differences.
            ndu[j]![r] = right[r + 1]! + left[j - r]!;
            const temp = ndu[j]![r] === 0 ? 0 : ndu[r]![j - 1]! / ndu[j]![r]!;
            // Upper triangle: basis functions.
            ndu[r]![j] = saved + right[r + 1]! * temp;
            saved = left[j - r]! * temp;
        }
        ndu[j]![j] = saved;
    }
    const ders: Float64Array[] = [];
    for (let k = 0; k <= n; k++) ders.push(new Float64Array(p + 1));
    for (let j = 0; j <= p; j++) ders[0]![j] = ndu[j]![p]!;
    const a = [new Float64Array(p + 1), new Float64Array(p + 1)];
    for (let r = 0; r <= p; r++) {
        let s1 = 0;
        let s2 = 1;
        a[0]![0] = 1;
        for (let k = 1; k <= n; k++) {
            let dsum = 0;
            const rk = r - k;
            const pk = p - k;
            if (r >= k) {
                const den = ndu[pk + 1]![rk]!;
                a[s2]![0] = den === 0 ? 0 : a[s1]![0]! / den;
                dsum = a[s2]![0]! * ndu[rk]![pk]!;
            }
            const j1 = rk >= -1 ? 1 : -rk;
            const j2 = r - 1 <= pk ? k - 1 : p - r;
            for (let j = j1; j <= j2; j++) {
                const den = ndu[pk + 1]![rk + j]!;
                a[s2]![j] = den === 0 ? 0 : (a[s1]![j]! - a[s1]![j - 1]!) / den;
                dsum += a[s2]![j]! * ndu[rk + j]![pk]!;
            }
            if (r <= pk) {
                const den = ndu[pk + 1]![r]!;
                a[s2]![k] = den === 0 ? 0 : -a[s1]![k - 1]! / den;
                dsum += a[s2]![k]! * ndu[r]![pk]!;
            }
            ders[k]![r] = dsum;
            const t = s1;
            s1 = s2;
            s2 = t;
        }
    }
    let f = p;
    for (let k = 1; k <= n; k++) {
        for (let j = 0; j <= p; j++) ders[k]![j] = ders[k]![j]! * f;
        f *= p - k;
    }
    return ders;
}

function binomial(n: number, k: number): number {
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
}

/** Clamped (open uniform) knot vector `[0]*(p+1), 1, …, n−p, [n−p+1]*(p+1)` (note 03 §3.8.4). */
export function clampedUniformKnots(count: number, degree: number): Float64Array {
    const m = count + degree + 1;
    const k = new Float64Array(m);
    const last = count - degree;
    for (let i = 0; i < m; i++) k[i] = Math.min(Math.max(i - degree, 0), last);
    return k;
}

/** Unclamped uniform knot vector `0, 1, …, n+p+1` (note 03 §3.8.4). */
export function uniformKnots(count: number, degree: number): Float64Array {
    const m = count + degree + 1;
    const k = new Float64Array(m);
    for (let i = 0; i < m; i++) k[i] = i;
    return k;
}

/**
 * Round knots to `-log10(tolerance)` decimals so near-equal knots become exact multiplicities
 * (ezdxf `round_knots`, note 03 §3.8.3 item 4). Harmless for evaluation; avoids sliver Bézier
 * pieces in decomposition. Returns the input when `tolerance` is not in (0, 1).
 */
export function roundKnots(knots: Float64Array, tolerance: number): Float64Array {
    if (!(tolerance > 0 && tolerance < 1)) return knots;
    const digits = Math.round(-Math.log10(tolerance));
    const f = 10 ** digits;
    return knots.map((k) => Math.round(k * f) / f);
}
