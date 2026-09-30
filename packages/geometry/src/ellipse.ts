/**
 * Elliptical arcs in conjugate-diameter form, `P(t) = C + cos t·U + sin t·V`, t from `start` to
 * `start + sweep` — the single internal representation for CIRCLE, ARC, ELLIPSE and bulge arcs
 * in any orientation (note 03 §3.6). U and V need not be orthogonal, so the form is exact under
 * every affine map (block scaling, view, plot): `C' = M·C, U' = M·U, V' = M·V`.
 *
 * ELLIPSE (note 03 §3.7) is WCS; its 210 is only the plane normal:
 * `minor = normalize(N × major)·|major|·ratio`; parameters (41/42, radians) are not angles:
 * `param = atan2(sin(angle)/ratio, cos(angle))`, `angle = atan2(sin(param)·ratio, cos(param))`.
 *
 * Exact bounding box (note 03 §3.7, §6.1): per axis i the extreme parameters are
 * `t = atan2(V_i, U_i)` and `t + π`, filtered by the sweep.
 */

import { angleInSweep, arcSpanRad, normalizeRad, TAU } from "./angle.ts";
import type { CircularArc2 } from "./arc.ts";
import { Bounds2, Bounds3 } from "./bounds.ts";
import { type Affine2, type Matrix44, singularValues2 } from "./matrix.ts";
import { arbitraryAxis, normalizeExtrusion, ocsToWcs } from "./ocs.ts";
import { REL_EPSILON } from "./tolerance.ts";
import type { Vec2, Vec3 } from "./vec.ts";

export interface EllipticArc3 {
  readonly center: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  /** Start parameter (radians). */
  readonly start: number;
  /** Signed parameter sweep (radians), |sweep| ≤ 2π. */
  readonly sweep: number;
}

export interface EllipticArc2 {
  readonly center: Vec2;
  readonly u: Vec2;
  readonly v: Vec2;
  readonly start: number;
  readonly sweep: number;
}

/** ELLIPSE entity data (codes 10, 11, 40, 41, 42, 210). */
export interface DxfEllipse {
  readonly center: Vec3;
  /** Semi-major axis vector, relative to the center (WCS). */
  readonly majorAxis: Vec3;
  readonly ratio: number;
  readonly startParam: number;
  readonly endParam: number;
  readonly extrusion?: Vec3;
}

/**
 * ELLIPSE → elliptic arc. The sweep follows the ARC span rule in radians (equal raw values give 0,
 * congruent values a full turn). A negative ratio keeps its sign (flips V), which ezdxf accepts;
 * UNKNOWN whether AutoCAD does (note 03 §3.7). Ratio > 1 should be normalized first with
 * {@link normalizeEllipseAxes} (ezdxf's audit behaviour; UNKNOWN in AutoCAD).
 */
export function ellipseFromDxf(e: DxfEllipse): EllipticArc3 {
  const n = normalizeExtrusion(e.extrusion);
  const m = e.majorAxis;
  const len = Math.hypot(m.x, m.y, m.z);
  // N × M; re-orthogonalizes when N is not perpendicular to M (bad data, ASSUMPTION §3.7).
  const cx = n.y * m.z - n.z * m.y;
  const cy = n.z * m.x - n.x * m.z;
  const cz = n.x * m.y - n.y * m.x;
  const cl = Math.hypot(cx, cy, cz);
  const k = cl > 0 ? (len * e.ratio) / cl : 0;
  return {
    center: e.center,
    u: m,
    v: { x: cx * k, y: cy * k, z: cz * k },
    start: normalizeRad(e.startParam),
    sweep: arcSpanRad(e.startParam, e.endParam),
  };
}

/**
 * Swap axes of an ELLIPSE with ratio > 1 (ezdxf audit, note 03 §3.7): the new major is the old
 * minor vector, `ratio' = 1/ratio`, params shift by −π/2 (full ellipses stay full).
 */
export function normalizeEllipseAxes(e: DxfEllipse): DxfEllipse {
  if (Math.abs(e.ratio) <= 1) return e;
  const arc = ellipseFromDxf({ ...e, startParam: 0, endParam: TAU });
  const full = arcSpanRad(e.startParam, e.endParam) === TAU;
  return {
    center: e.center,
    majorAxis: arc.v,
    ratio: 1 / e.ratio,
    startParam: full ? e.startParam : normalizeRad(e.startParam - Math.PI / 2),
    endParam: full ? e.endParam : normalizeRad(e.endParam - Math.PI / 2),
    ...(e.extrusion ? { extrusion: e.extrusion } : {}),
  };
}

/** Ellipse parameter → polar angle about the center, in the ellipse's own axes. */
export function ellipseParamToAngle(param: number, ratio: number): number {
  return Math.atan2(Math.sin(param) * ratio, Math.cos(param));
}

/** Polar angle → ellipse parameter, in [0, 2π). */
export function ellipseAngleToParam(angle: number, ratio: number): number {
  return normalizeRad(Math.atan2(Math.sin(angle) / ratio, Math.cos(angle)));
}

/**
 * CIRCLE/ARC (OCS center, radius, start angle, sweep in radians) → WCS elliptic arc:
 * `C = AAA(N)·center, U = r·Ax, V = r·Ay` (note 03 §3.4, §3.6).
 */
export function ocsArcToEllipticArc3(
  centerOcs: Vec3,
  radius: number,
  start: number,
  sweep: number,
  extrusion?: Vec3,
): EllipticArc3 {
  const axes = arbitraryAxis(extrusion);
  return {
    center: ocsToWcs(centerOcs, axes),
    u: { x: axes.ax.x * radius, y: axes.ax.y * radius, z: axes.ax.z * radius },
    v: { x: axes.ay.x * radius, y: axes.ay.y * radius, z: axes.ay.z * radius },
    start,
    sweep,
  };
}

// ---- Evaluation ----------------------------------------------------------------------------

export function ellipticArc3PointAtParam(e: EllipticArc3, t: number): Vec3 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return {
    x: e.center.x + c * e.u.x + s * e.v.x,
    y: e.center.y + c * e.u.y + s * e.v.y,
    z: e.center.z + c * e.u.z + s * e.v.z,
  };
}

export function ellipticArc2PointAtParam(e: EllipticArc2, t: number): Vec2 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: e.center.x + c * e.u.x + s * e.v.x, y: e.center.y + c * e.u.y + s * e.v.y };
}

/** Point at normalized `f ∈ [0, 1]` along the sweep. */
export function ellipticArc2PointAt(e: EllipticArc2, f: number): Vec2 {
  return ellipticArc2PointAtParam(e, e.start + e.sweep * f);
}

/** d/dt of the curve at parameter t: `−sin t·U + cos t·V` (note 03 §3.7). */
export function ellipticArc2TangentAtParam(e: EllipticArc2, t: number): Vec2 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: -s * e.u.x + c * e.v.x, y: -s * e.u.y + c * e.v.y };
}

export function ellipticArc3TangentAtParam(e: EllipticArc3, t: number): Vec3 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: -s * e.u.x + c * e.v.x, y: -s * e.u.y + c * e.v.y, z: -s * e.u.z + c * e.v.z };
}

export function reverseEllipticArc2(e: EllipticArc2): EllipticArc2 {
  return { center: e.center, u: e.u, v: e.v, start: e.start + e.sweep, sweep: -e.sweep };
}

// ---- Transforms ----------------------------------------------------------------------------

export function transformEllipticArc3(e: EllipticArc3, m: Matrix44): EllipticArc3 {
  return {
    center: m.transformPoint(e.center),
    u: m.transformDirection(e.u),
    v: m.transformDirection(e.v),
    start: e.start,
    sweep: e.sweep,
  };
}

/** Transform by `m` and project in parallel onto the target XY plane (drop z). Exact. */
export function projectEllipticArc3(e: EllipticArc3, m: Matrix44): EllipticArc2 {
  const c = m.transformPoint(e.center);
  const u = m.transformDirection(e.u);
  const v = m.transformDirection(e.v);
  return {
    center: { x: c.x, y: c.y },
    u: { x: u.x, y: u.y },
    v: { x: v.x, y: v.y },
    start: e.start,
    sweep: e.sweep,
  };
}

export function transformEllipticArc2(e: EllipticArc2, a: Affine2): EllipticArc2 {
  return {
    center: a.apply(e.center),
    u: a.applyVector(e.u),
    v: a.applyVector(e.v),
    start: e.start,
    sweep: e.sweep,
  };
}

/** A circular arc as a 2D elliptic arc (`U = (r, 0)`, `V = (0, r)`, t = angle). */
export function circularToEllipticArc2(a: CircularArc2): EllipticArc2 {
  return {
    center: a.center,
    u: { x: a.radius, y: 0 },
    v: { x: 0, y: a.radius },
    start: a.start,
    sweep: a.sweep,
  };
}

/**
 * If the elliptic arc is actually circular (|U| = |V|, U ⊥ V within `rel`), return the
 * equivalent circular arc (exact circle math makes flattening counts deterministic and cheaper).
 * Mirrored conjugate pairs (V = −rot90(U)) give a negative sweep.
 */
export function ellipticArc2AsCircle(e: EllipticArc2, rel = REL_EPSILON): CircularArc2 | undefined {
  const uu = e.u.x * e.u.x + e.u.y * e.u.y;
  const vv = e.v.x * e.v.x + e.v.y * e.v.y;
  const uv = e.u.x * e.v.x + e.u.y * e.v.y;
  const m = Math.max(uu, vv);
  if (!(m > 0) || Math.abs(uu - vv) > rel * m || Math.abs(uv) > rel * m) return undefined;
  const radius = Math.sqrt((uu + vv) / 2);
  const alpha = Math.atan2(e.u.y, e.u.x);
  const ccw = e.u.x * e.v.y - e.u.y * e.v.x > 0;
  return ccw
    ? { center: e.center, radius, start: alpha + e.start, sweep: e.sweep }
    : { center: e.center, radius, start: alpha - e.start, sweep: -e.sweep };
}

/**
 * Principal semi-axes of the (full) ellipse: `[a, b]` with a ≥ b ≥ 0 — the singular values of
 * the matrix `[U V]`. `a` bounds the chord error of uniform parameter steps (flatten.ts).
 */
export function ellipticArc2SemiAxes(e: EllipticArc2): [number, number] {
  return singularValues2(e.u.x, e.u.y, e.v.x, e.v.y);
}

// ---- Bounds --------------------------------------------------------------------------------

function extremeParams(ui: number, vi: number, start: number, sweep: number, out: number[]): void {
  if (ui === 0 && vi === 0) return;
  const t = Math.atan2(vi, ui);
  const s = sweep >= 0 ? start : start + sweep;
  const sw = Math.abs(sweep);
  if (angleInSweep(t, s, sw)) out.push(t);
  if (angleInSweep(t + Math.PI, s, sw)) out.push(t + Math.PI);
}

export function ellipticArc2Bounds(e: EllipticArc2, out: Bounds2 = new Bounds2()): Bounds2 {
  out.addPoint(ellipticArc2PointAtParam(e, e.start));
  out.addPoint(ellipticArc2PointAtParam(e, e.start + e.sweep));
  const ts: number[] = [];
  extremeParams(e.u.x, e.v.x, e.start, e.sweep, ts);
  extremeParams(e.u.y, e.v.y, e.start, e.sweep, ts);
  for (const t of ts) out.addPoint(ellipticArc2PointAtParam(e, t));
  return out;
}

export function ellipticArc3Bounds(e: EllipticArc3, out: Bounds3 = new Bounds3()): Bounds3 {
  out.addPoint(ellipticArc3PointAtParam(e, e.start));
  out.addPoint(ellipticArc3PointAtParam(e, e.start + e.sweep));
  const ts: number[] = [];
  extremeParams(e.u.x, e.v.x, e.start, e.sweep, ts);
  extremeParams(e.u.y, e.v.y, e.start, e.sweep, ts);
  extremeParams(e.u.z, e.v.z, e.start, e.sweep, ts);
  for (const t of ts) out.addPoint(ellipticArc3PointAtParam(e, t));
  return out;
}
