/**
 * Bézier curves of any degree and dimension, polynomial or rational, stored flat.
 *
 * Used for exact NURBS decomposition (note 03 §3.8.5: knot insertion until every interior knot
 * has multiplicity p gives degree-p Bézier pieces), for exact bounding boxes (§6.1: "Bézier-
 * decompose and solve derivative roots per axis") and for flattening (§3.8.8, §5.3).
 *
 * Layout: `points` holds `(degree + 1) · dim` Cartesian coordinates; `weights` (optional) holds
 * `degree + 1` weights. Rational evaluation works in homogeneous coordinates (w·P, w).
 *
 * Flattening:
 * - Polynomial pieces use Wang's formula (deterministic, uniform in t):
 *   `n = ceil( sqrt( p·(p−1)·max_i |P_{i+2} − 2P_{i+1} + P_i| / (8·tol) ) )`,
 *   since `|C''| ≤ p(p−1)·max|Δ²P|` and linear interpolation with step h deviates by ≤ h²·|C''|/8.
 * - Rational pieces use adaptive midpoint subdivision until every control point lies within
 *   `tol` of the chord; by the convex-hull property (positive weights) the curve then lies
 *   within `tol` of the chord. Deterministic (depth- and count-limited, no time limits). Unlike
 *   ezdxf's midpoint-sagitta test this cannot miss inflections (note 03 §3.8.8).
 */

import { MAX_SEGMENTS_PER_CURVE, MAX_SUBDIVISION_DEPTH } from "./tolerance.ts";

export interface BezierCurve {
  readonly degree: number;
  readonly dim: number;
  /** `(degree + 1) · dim` Cartesian control point coordinates. */
  readonly points: Float64Array;
  /** `degree + 1` weights, or undefined for a polynomial curve. */
  readonly weights?: Float64Array | undefined;
}

export function isRationalBezier(b: BezierCurve): boolean {
  const w = b.weights;
  if (!w) return false;
  for (let i = 0; i < w.length; i++) if (w[i] !== w[0]) return true;
  return false;
}

/** Homogeneous control points `(w·P, w)`, `(degree + 1) · (dim + 1)` values. */
export function toHomogeneous(b: BezierCurve): Float64Array {
  const n = b.degree + 1;
  const d = b.dim;
  const h = new Float64Array(n * (d + 1));
  for (let i = 0; i < n; i++) {
    const w = b.weights ? b.weights[i]! : 1;
    for (let k = 0; k < d; k++) h[i * (d + 1) + k] = b.points[i * d + k]! * w;
    h[i * (d + 1) + d] = w;
  }
  return h;
}

export function fromHomogeneous(
  h: Float64Array,
  degree: number,
  dim: number,
  rational: boolean,
): BezierCurve {
  const n = degree + 1;
  const points = new Float64Array(n * dim);
  const weights = rational ? new Float64Array(n) : undefined;
  for (let i = 0; i < n; i++) {
    const w = h[i * (dim + 1) + dim]!;
    for (let k = 0; k < dim; k++) points[i * dim + k] = h[i * (dim + 1) + k]! / w;
    if (weights) weights[i] = w;
  }
  return { degree, dim, points, weights };
}

/** Evaluate at `t ∈ [0, 1]` by de Casteljau (homogeneous). Writes `dim` values into `out`. */
export function bezierPoint(
  b: BezierCurve,
  t: number,
  out: Float64Array = new Float64Array(b.dim),
): Float64Array {
  const d = b.dim;
  const s = d + 1;
  const tmp = toHomogeneous(b);
  const n = b.degree;
  for (let r = 1; r <= n; r++) {
    for (let i = 0; i <= n - r; i++) {
      for (let k = 0; k < s; k++) tmp[i * s + k] = (1 - t) * tmp[i * s + k]! + t * tmp[(i + 1) * s + k]!;
    }
  }
  const w = tmp[d]!;
  for (let k = 0; k < d; k++) out[k] = tmp[k]! / w;
  return out;
}

/** Split homogeneous control points at t; returns [left, right] homogeneous arrays. */
export function splitHomogeneous(
  h: Float64Array,
  degree: number,
  s: number,
  t: number,
): [Float64Array, Float64Array] {
  const n = degree;
  const left = new Float64Array(h.length);
  const right = new Float64Array(h.length);
  const tmp = Float64Array.from(h);
  for (let k = 0; k < s; k++) {
    left[k] = tmp[k]!;
    right[n * s + k] = tmp[n * s + k]!;
  }
  for (let r = 1; r <= n; r++) {
    for (let i = 0; i <= n - r; i++) {
      for (let k = 0; k < s; k++) tmp[i * s + k] = (1 - t) * tmp[i * s + k]! + t * tmp[(i + 1) * s + k]!;
    }
    for (let k = 0; k < s; k++) {
      left[r * s + k] = tmp[k]!;
      right[(n - r) * s + k] = tmp[(n - r) * s + k]!;
    }
  }
  return [left, right];
}

export function splitBezier(b: BezierCurve, t: number): [BezierCurve, BezierCurve] {
  const rational = b.weights !== undefined;
  const [l, r] = splitHomogeneous(toHomogeneous(b), b.degree, b.dim + 1, t);
  return [fromHomogeneous(l, b.degree, b.dim, rational), fromHomogeneous(r, b.degree, b.dim, rational)];
}

/** Hodograph of a polynomial Bézier: degree p−1 with points `p·(P_{i+1} − P_i)`. */
export function bezierDerivative(b: BezierCurve): BezierCurve {
  if (b.weights && isRationalBezier(b)) throw new Error("bezierDerivative: rational curves not supported");
  const p = b.degree;
  const d = b.dim;
  if (p === 0) return { degree: 0, dim: d, points: new Float64Array(d) };
  const pts = new Float64Array(p * d);
  for (let i = 0; i < p; i++) {
    for (let k = 0; k < d; k++) pts[i * d + k] = p * (b.points[(i + 1) * d + k]! - b.points[i * d + k]!);
  }
  return { degree: p - 1, dim: d, points: pts };
}

// ---- Bounds --------------------------------------------------------------------------------

/**
 * Tight axis-aligned bounds `[min_0..min_{d−1}, max_0..max_{d−1}]`. The curve interpolates its
 * end points, and by the convex-hull property any piece whose control hull lies inside the
 * current box contributes nothing new; other pieces are split (de Casteljau) until the hull
 * excess is below `eps` (relative to the box size). Works for rational curves with positive
 * weights. Result is within `eps·size` of the exact box and never smaller than the sampled curve.
 */
export function bezierBounds(b: BezierCurve, eps = 1e-12): Float64Array {
  const d = b.dim;
  const s = d + 1;
  const n = b.degree;
  const box = new Float64Array(2 * d);
  for (let k = 0; k < d; k++) {
    const a = b.points[k]!;
    const z = b.points[n * d + k]!;
    box[k] = Math.min(a, z);
    box[d + k] = Math.max(a, z);
  }
  if (n <= 1) return box;
  let size = 0;
  for (let i = 0; i <= n; i++)
    for (let k = 0; k < d; k++) size = Math.max(size, Math.abs(b.points[i * d + k]!));
  const tol = eps * Math.max(size, 1e-300);
  const stack: Float64Array[] = [toHomogeneous(b)];
  const depths: number[] = [0];
  const mid = new Float64Array(d);
  while (stack.length > 0) {
    const h = stack.pop()!;
    const depth = depths.pop()!;
    // Hull excess outside the current box.
    let excess = 0;
    for (let i = 1; i < n; i++) {
      const w = h[i * s + d]!;
      for (let k = 0; k < d; k++) {
        const x = h[i * s + k]! / w;
        excess = Math.max(excess, box[k]! - x, x - box[d + k]!);
      }
    }
    if (excess <= tol) continue;
    const [l, r] = splitHomogeneous(h, n, s, 0.5);
    // The split point lies on the curve: grow the box with it.
    const wm = l[n * s + d]!;
    for (let k = 0; k < d; k++) {
      mid[k] = l[n * s + k]! / wm;
      if (mid[k]! < box[k]!) box[k] = mid[k]!;
      if (mid[k]! > box[d + k]!) box[d + k] = mid[k]!;
    }
    if (depth >= 60) continue;
    stack.push(r, l);
    depths.push(depth + 1, depth + 1);
  }
  return box;
}

// ---- Flattening ----------------------------------------------------------------------------

/**
 * Wang's segment count for a polynomial Bézier (see module comment). Returns ≥ 1, capped at
 * {@link MAX_SEGMENTS_PER_CURVE}.
 */
export function wangSegmentCount(b: BezierCurve, tol: number): number {
  const p = b.degree;
  if (p <= 1) return 1;
  const d = b.dim;
  let m = 0;
  for (let i = 0; i + 2 <= p; i++) {
    let sq = 0;
    for (let k = 0; k < d; k++) {
      const v = b.points[(i + 2) * d + k]! - 2 * b.points[(i + 1) * d + k]! + b.points[i * d + k]!;
      sq += v * v;
    }
    m = Math.max(m, Math.sqrt(sq));
  }
  if (m === 0) return 1;
  const n = Math.ceil(Math.sqrt((p * (p - 1) * m) / (8 * tol)));
  return Math.min(Math.max(n, 1), MAX_SEGMENTS_PER_CURVE);
}

/** Distance from point `q` (index i in homogeneous h) to segment h[0]–h[n], in Cartesian. */
function hullDeviation(h: Float64Array, n: number, d: number): number {
  const s = d + 1;
  const w0 = h[d]!;
  const wn = h[n * s + d]!;
  let len2 = 0;
  const a = new Float64Array(d);
  const ab = new Float64Array(d);
  for (let k = 0; k < d; k++) {
    a[k] = h[k]! / w0;
    ab[k] = h[n * s + k]! / wn - a[k]!;
    len2 += ab[k]! * ab[k]!;
  }
  let maxDist = 0;
  for (let i = 1; i < n; i++) {
    const w = h[i * s + d]!;
    let t = 0;
    if (len2 > 0) {
      for (let k = 0; k < d; k++) t += (h[i * s + k]! / w - a[k]!) * ab[k]!;
      t = Math.min(1, Math.max(0, t / len2));
    }
    let dist2 = 0;
    for (let k = 0; k < d; k++) {
      const v = h[i * s + k]! / w - (a[k]! + t * ab[k]!);
      dist2 += v * v;
    }
    maxDist = Math.max(maxDist, dist2);
  }
  return Math.sqrt(maxDist);
}

/**
 * Append the flattened curve to `out` as Cartesian coordinates, **excluding** the start point
 * (the caller has already emitted it) and including the end point. Returns the number of
 * segments emitted.
 */
export function flattenBezierInto(b: BezierCurve, tol: number, out: number[]): number {
  const d = b.dim;
  const n = b.degree;
  if (n <= 1 || !isRationalBezier(b)) {
    const count = n <= 1 ? 1 : wangSegmentCount(b, tol);
    const pt = new Float64Array(d);
    for (let i = 1; i <= count; i++) {
      if (i === count) {
        for (let k = 0; k < d; k++) out.push(b.points[n * d + k]!);
      } else {
        bezierPoint(b, i / count, pt);
        for (let k = 0; k < d; k++) out.push(pt[k]!);
      }
    }
    return count;
  }
  // Rational: adaptive hull-based subdivision, processed left to right.
  const s = d + 1;
  const stack: Float64Array[] = [toHomogeneous(b)];
  const depths: number[] = [0];
  let emitted = 0;
  while (stack.length > 0) {
    const h = stack.pop()!;
    const depth = depths.pop()!;
    if (
      depth < MAX_SUBDIVISION_DEPTH &&
      emitted + stack.length < MAX_SEGMENTS_PER_CURVE &&
      !(hullDeviation(h, n, d) <= tol)
    ) {
      const [l, r] = splitHomogeneous(h, n, s, 0.5);
      stack.push(r, l);
      depths.push(depth + 1, depth + 1);
      continue;
    }
    const w = h[n * s + d]!;
    for (let k = 0; k < d; k++) out.push(h[n * s + k]! / w);
    emitted++;
  }
  return emitted;
}
