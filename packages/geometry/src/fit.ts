/**
 * SPLINE from fit points only, reproducing AutoCAD's construction (note 03 §3.8.6):
 * - degree is always 3, whatever code 71 says;
 * - knot parameterization chord length by default; square-root chord (flag 64) and uniform
 *   (flag 128) are selectable (UNKNOWN whether AutoCAD honours them for fit-only files);
 * - "natural" clamped knots: `[0,0,0,0, t_1, …, t_{n−1}, 1,1,1,1]` → n + 3 control points;
 * - with end tangents: first-derivative rows `−P0 + P1 = (U[p+1]/p)·T̂s·L` and
 *   `−P_{n+1} + P_{n+2} = ((1 − U[m−p−1])/p)·T̂e·L`, tangent magnitudes = total chord length L
 *   of the fit polygon (ezdxf `estimate_end_tangent_magnitude(…, "chord")`);
 * - without tangents: natural end conditions C''(0) = C''(1) = 0 (NURBS Book eq. 3.9/3.10);
 * - row order `[C(t0), start row, C(t1..t_{n−1}), end row, C(tn)]`, solved as a banded system.
 *
 * Validated numerically against ezdxf `fit_points_to_cad_cv` (tests/fit.test.ts). ezdxf uses
 * tangents only when both are present; here each end is handled independently: a missing
 * tangent gets C'' = 0 at that end (the note's presumption; UNKNOWN in AutoCAD).
 * Closed (periodic) fit splines: UNKNOWN construction (note 03 §3.8.6) — TODO; treated as open.
 * Fit tolerance > 0 (approximation): UNKNOWN algorithm — treated as interpolation.
 */

import { BandedMatrix } from "./linalg.ts";
import { basisFunctionDerivatives, findKnotSpan, NurbsCurve } from "./nurbs.ts";
import type { Vec3 } from "./vec.ts";

export type KnotParameterization = "chord" | "sqrtChord" | "uniform";

export interface FitPointOptions {
    /** Start tangent direction (any length > 0; normalized internally). */
    readonly startTangent?: Vec3 | undefined;
    /** End tangent direction (any length > 0; normalized internally). */
    readonly endTangent?: Vec3 | undefined;
    readonly parameterization?: KnotParameterization;
    /**
     * Use the tangent vectors as given instead of normalizing them: AutoCAD scales the derivative
     * rows by the stored 12/13 vector length (VERIFIED-BY-ACAD splines/fit-tangents-0003: tangent
     * (5,5) gives P1 − P0 = (U[p+1]/p)·(5,5)·L). Default false (ezdxf).
     */
    readonly rawTangents?: boolean;
}

/** SPLINE flag 70 bits 32/64/128 → parameterization (note 03 §3.8.2); chord by default. */
export function knotParameterizationFromFlags(flags: number): KnotParameterization {
    if (flags & 64) return "sqrtChord";
    if (flags & 128) return "uniform";
    return "chord";
}

/**
 * Parameter vector t_0 = 0 … t_n = 1, computed like ezdxf (`_normalize_distances`: running sum
 * divided by the total, last value exactly 1).
 */
export function fitParameters(points: readonly Vec3[], method: KnotParameterization): Float64Array {
    const n = points.length - 1;
    const t = new Float64Array(n + 1);
    if (n <= 0) return t;
    if (method === "uniform") {
        for (let k = 0; k <= n; k++) t[k] = k / n;
        return t;
    }
    const d = new Float64Array(n);
    let total = 0;
    for (let k = 1; k <= n; k++) {
        const a = points[k - 1]!;
        const b = points[k]!;
        const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        d[k - 1] = method === "sqrtChord" ? Math.sqrt(dist) : dist;
        total += d[k - 1]!;
    }
    let s = 0;
    for (let k = 1; k < n; k++) {
        s += d[k - 1]!;
        t[k] = s / total;
    }
    t[n] = 1;
    return t;
}

function removeConsecutiveDuplicates(points: readonly Vec3[]): Vec3[] {
    // ASSUMPTION: coincident consecutive fit points carry no information (they would make the
    // chord parameterization singular); AutoCAD never writes them.
    const out: Vec3[] = [];
    for (const p of points) {
        const q = out[out.length - 1];
        if (q && q.x === p.x && q.y === p.y && q.z === p.z) continue;
        out.push(p);
    }
    return out;
}

function finiteOrUndefined(v: Vec3 | undefined): Vec3 | undefined {
    if (!v) return undefined;
    const l = Math.hypot(v.x, v.y, v.z);
    return l > 0 && Number.isFinite(l) ? v : undefined;
}

function unitOrUndefined(v: Vec3 | undefined): Vec3 | undefined {
    if (!v) return undefined;
    const l = Math.hypot(v.x, v.y, v.z);
    if (!(l > 0) || !Number.isFinite(l)) return undefined;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/**
 * Cubic global interpolation of fit points (AutoCAD method, see module comment). Returns a 3D
 * clamped cubic {@link NurbsCurve}, or `undefined` for fewer than two distinct points or a
 * singular system.
 */
export function interpolateFitPoints(
    fitPoints: readonly Vec3[],
    options: FitPointOptions = {},
): NurbsCurve | undefined {
    const pts = removeConsecutiveDuplicates(fitPoints);
    if (pts.length < 2) return undefined;
    const p = 3;
    const n = pts.length - 1;
    const t = fitParameters(pts, options.parameterization ?? "chord");
    const count = n + 3;
    const knots = new Float64Array(count + p + 1);
    for (let i = 0; i <= p; i++) {
        knots[i] = 0;
        knots[count + i] = 1;
    }
    for (let k = 1; k < n; k++) knots[p + k] = t[k]!;
    const m = knots.length - 1;

    let chordLength = 0;
    for (let k = 1; k <= n; k++) {
        const a = pts[k - 1]!;
        const b = pts[k]!;
        chordLength += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    const ts = options.rawTangents
        ? finiteOrUndefined(options.startTangent)
        : unitOrUndefined(options.startTangent);
    const te = options.rawTangents
        ? finiteOrUndefined(options.endTangent)
        : unitOrUndefined(options.endTangent);

    const A = new BandedMatrix(count, 3, 3);
    const B = new Float64Array(count * 3);
    const setRhs = (row: number, v: Vec3) => {
        B[row * 3] = v.x;
        B[row * 3 + 1] = v.y;
        B[row * 3 + 2] = v.z;
    };
    const basisRow = (row: number, u: number) => {
        const span = findKnotSpan(knots, count, p, u);
        const N = basisFunctionDerivatives(span, u, p, 0, knots)[0]!;
        for (let j = 0; j <= p; j++) if (N[j] !== 0) A.set(row, span - p + j, N[j]!);
    };

    // Row 0: C(t0) = Q0.
    basisRow(0, 0);
    setRhs(0, pts[0]!);
    // Row 1: start condition.
    if (ts) {
        const f = (knots[p + 1]! / p) * chordLength;
        A.set(1, 0, -1);
        A.set(1, 1, 1);
        setRhs(1, { x: ts.x * f, y: ts.y * f, z: ts.z * f });
    } else {
        const u1 = knots[p + 1]!;
        const u2 = knots[p + 2]!;
        const f = (p * (p - 1)) / u1;
        A.set(1, 0, f / u1);
        A.set(1, 1, (-f * (u1 + u2)) / (u1 * u2));
        A.set(1, 2, f / u2);
    }
    // Rows 2..n: C(t_k) = Q_k for interior k.
    for (let k = 1; k < n; k++) {
        basisRow(k + 1, t[k]!);
        setRhs(k + 1, pts[k]!);
    }
    // Row n+1: end condition.
    const last = count - 1;
    if (te) {
        const f = ((1 - knots[m - p - 1]!) / p) * chordLength;
        A.set(n + 1, last - 1, -1);
        A.set(n + 1, last, 1);
        setRhs(n + 1, { x: te.x * f, y: te.y * f, z: te.z * f });
    } else {
        const v1 = 1 - knots[m - p - 1]!;
        const v2 = 1 - knots[m - p - 2]!;
        const f = (p * (p - 1)) / v1;
        A.set(n + 1, last - 2, f / v2);
        A.set(n + 1, last - 1, (-f * (v1 + v2)) / (v1 * v2));
        A.set(n + 1, last, f / v1);
    }
    // Row n+2: C(tn) = Qn.
    basisRow(n + 2, 1);
    setRhs(n + 2, pts[n]!);

    const X = A.solve(B, 3);
    if (!X) return undefined;
    for (const v of X) if (!Number.isFinite(v)) return undefined;
    return new NurbsCurve(p, 3, X, knots);
}
