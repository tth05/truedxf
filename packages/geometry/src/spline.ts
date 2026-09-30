/**
 * DXF SPLINE (and HELIX, which embeds a full AcDbSpline) → NURBS curve.
 *
 * Rules (note 03 §3.8.3):
 * 1. Control points present → draw the stored NURBS (control points, knots, weights). AutoCAD
 *    writes CPs and knots even for fit-method splines; fit points are then editing data only.
 * 2. Only fit points → cubic interpolation the AutoCAD way (fit.ts, §3.8.6).
 * 3. Closed/periodic flags do not change evaluation (VERIFIED-BY-ACAD via TrueView, ezdxf#851);
 *    AutoCAD's periodic storage evaluates correctly as a standard NURBS (§3.8.4).
 *
 * Robustness (§3.8.1): counts 72/73/74 are not trusted (callers pass the actual tags); weights
 * are used only when there is one per control point (netDxf); zero tangents are dropped (ezdxf).
 * Repairs that AutoCAD's behaviour does not pin down are reported in `issues`.
 */

import { interpolateFitPoints, knotParameterizationFromFlags } from "./fit.ts";
import { clampedUniformKnots, NurbsCurve } from "./nurbs.ts";
import type { Vec3 } from "./vec.ts";

export interface DxfSplineData {
  /** Code 71 (ignored for fit-point splines, which are always cubic). */
  readonly degree: number;
  /** Code 70. */
  readonly flags?: number;
  /** Code 40 values in file order. */
  readonly knots?: ArrayLike<number>;
  /** Code 10 points in file order. */
  readonly controlPoints?: readonly Vec3[];
  /** Code 41 values in file order. */
  readonly weights?: ArrayLike<number>;
  /** Code 11 points. */
  readonly fitPoints?: readonly Vec3[];
  /** Code 12. */
  readonly startTangent?: Vec3;
  /** Code 13. */
  readonly endTangent?: Vec3;
}

export interface SplineBuildResult {
  readonly curve: NurbsCurve | undefined;
  /** Which data the curve came from. */
  readonly source: "control" | "fit" | "none";
  /** Human-readable repairs / reasons (for render diagnostics). */
  readonly issues: string[];
}

function isZero(v: Vec3 | undefined): boolean {
  return !v || (v.x === 0 && v.y === 0 && v.z === 0);
}

export function buildSplineCurve(data: DxfSplineData): SplineBuildResult {
  const issues: string[] = [];
  const cps = data.controlPoints ?? [];
  if (cps.length > 0) {
    let degree = Math.trunc(data.degree);
    if (!(degree >= 1)) {
      issues.push(`invalid degree ${data.degree}, using 3`);
      degree = 3;
    }
    if (cps.length < 2)
      return { curve: undefined, source: "none", issues: [...issues, "single control point"] };
    if (cps.length < degree + 1) {
      // UNKNOWN what AutoCAD does; lowering the degree keeps the data drawable.
      issues.push(`degree ${degree} needs ${degree + 1} control points, lowered to ${cps.length - 1}`);
      degree = cps.length - 1;
    }
    const points = new Float64Array(cps.length * 3);
    cps.forEach((p, i) => {
      points[i * 3] = p.x;
      points[i * 3 + 1] = p.y;
      points[i * 3 + 2] = p.z;
    });
    let weights: Float64Array | undefined;
    if (data.weights && data.weights.length > 0) {
      if (data.weights.length === cps.length) weights = Float64Array.from(data.weights);
      else
        issues.push(
          `weight count ${data.weights.length} != control point count ${cps.length}, weights ignored`,
        );
    }
    let knots: Float64Array | undefined;
    const raw = data.knots ? Float64Array.from(data.knots) : undefined;
    if (raw && raw.length === cps.length + degree + 1 && isValidKnotVector(raw, cps.length, degree)) {
      knots = raw;
    } else {
      issues.push(
        raw && raw.length > 0
          ? `invalid knot vector (${raw.length} knots for ${cps.length} control points, degree ${degree}), using clamped uniform knots`
          : "missing knots, using clamped uniform knots",
      );
      knots = clampedUniformKnots(cps.length, degree);
    }
    return { curve: new NurbsCurve(degree, 3, points, knots, weights), source: "control", issues };
  }
  const fit = data.fitPoints ?? [];
  if (fit.length >= 2) {
    const curve = interpolateFitPoints(fit, {
      startTangent: isZero(data.startTangent) ? undefined : data.startTangent,
      endTangent: isZero(data.endTangent) ? undefined : data.endTangent,
      parameterization: knotParameterizationFromFlags(data.flags ?? 0),
    });
    if (!curve) return { curve: undefined, source: "none", issues: [...issues, "degenerate fit points"] };
    return { curve, source: "fit", issues };
  }
  return {
    curve: undefined,
    source: "none",
    issues: [...issues, "no control points and fewer than 2 fit points"],
  };
}

function isValidKnotVector(k: Float64Array, count: number, degree: number): boolean {
  for (let i = 0; i < k.length; i++) if (!Number.isFinite(k[i]!)) return false;
  for (let i = 1; i < k.length; i++) if (k[i]! < k[i - 1]!) return false;
  return k[count]! > k[degree]!;
}
