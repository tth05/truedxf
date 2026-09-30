/**
 * 3D entity curves (WCS or block space) and their exact parallel projection to 2D paths.
 *
 * Renderer pipeline (note 03 §2.1): OCS → WCS (AAA) → nested INSERT transforms → DCS/PSDCS →
 * plot transform → device. All of these are affine, so a single {@link Matrix44} `M` takes
 * geometry to the target space and the x/y of the result are the 2D coordinates (parallel
 * projection; z is dropped). Curve types are preserved exactly:
 * - line → line; 3D polyline → line chain;
 * - elliptic arc `(C, U, V)` → `(M·C, M·U, M·V)` projected; a circular image becomes an `arc`
 *   segment (note 03 §3.6);
 * - NURBS → NURBS with projected control points (weights unchanged under affine maps).
 * Planar OCS geometry (bulge polylines, arcs, hatch loops) is better built as a 2D path in the
 * OCS plane and mapped with `M.multiply(ocsToWcs).planeToAffine2(elevation)` (see
 * {@link projectPlanarPath}).
 */

import { Bounds3 } from "./bounds.ts";
import {
  type EllipticArc3,
  ellipticArc2AsCircle,
  ellipticArc3Bounds,
  projectEllipticArc3,
  transformEllipticArc3,
} from "./ellipse.ts";
import type { Matrix44 } from "./matrix.ts";
import type { NurbsCurve } from "./nurbs.ts";
import { ocsToWcsMatrix } from "./ocs.ts";
import {
  arcSegment,
  ellipticArcSegment,
  lineSegment,
  type Path2,
  type PathSegment,
  type Subpath,
  transformPath,
} from "./path.ts";
import type { Vec3 } from "./vec.ts";

export interface Line3 {
  readonly kind: "line";
  readonly p0: Vec3;
  readonly p1: Vec3;
}

export interface EllipticArcCurve3 extends EllipticArc3 {
  readonly kind: "ellipticArc";
}

export interface NurbsCurve3 {
  readonly kind: "nurbs";
  /** A 3D curve (dim 3). */
  readonly curve: NurbsCurve;
}

export interface Polyline3 {
  readonly kind: "polyline";
  /** Interleaved x, y, z. */
  readonly points: Float64Array;
  readonly closed: boolean;
}

export type Curve3 = Line3 | EllipticArcCurve3 | NurbsCurve3 | Polyline3;

export function line3(p0: Vec3, p1: Vec3): Line3 {
  return { kind: "line", p0, p1 };
}

export function ellipticArcCurve3(e: EllipticArc3): EllipticArcCurve3 {
  return { kind: "ellipticArc", center: e.center, u: e.u, v: e.v, start: e.start, sweep: e.sweep };
}

export function polyline3(points: readonly Vec3[] | Float64Array, closed = false): Polyline3 {
  if (points instanceof Float64Array) return { kind: "polyline", points, closed };
  const a = new Float64Array(points.length * 3);
  points.forEach((p, i) => {
    a[i * 3] = p.x;
    a[i * 3 + 1] = p.y;
    a[i * 3 + 2] = p.z;
  });
  return { kind: "polyline", points: a, closed };
}

/** Transform a 3D curve (stays 3D). */
export function transformCurve3(c: Curve3, m: Matrix44): Curve3 {
  switch (c.kind) {
    case "line":
      return { kind: "line", p0: m.transformPoint(c.p0), p1: m.transformPoint(c.p1) };
    case "ellipticArc":
      return { kind: "ellipticArc", ...transformEllipticArc3(c, m) };
    case "nurbs":
      return { kind: "nurbs", curve: c.curve.transform(m) };
    case "polyline":
      return { kind: "polyline", points: m.transformPoints3(c.points), closed: c.closed };
  }
}

/** Transform by `m` and project onto the target XY plane → 2D subpath (exact). */
export function projectCurve3(c: Curve3, m: Matrix44): Subpath {
  switch (c.kind) {
    case "line": {
      const a = m.transformPoint(c.p0);
      const b = m.transformPoint(c.p1);
      return { segments: [lineSegment({ x: a.x, y: a.y }, { x: b.x, y: b.y })], closed: false };
    }
    case "ellipticArc": {
      const e = projectEllipticArc3(c, m);
      const circle = ellipticArc2AsCircle(e);
      const seg = circle ? arcSegment(circle) : ellipticArcSegment(e);
      return { segments: [seg], closed: Math.abs(c.sweep) >= 2 * Math.PI };
    }
    case "nurbs":
      return { segments: [{ kind: "nurbs", curve: c.curve.project(m) }], closed: false };
    case "polyline": {
      const xy = m.projectPoints(c.points);
      const segs: PathSegment[] = [];
      for (let i = 0; i + 3 < xy.length; i += 2) {
        segs.push(lineSegment({ x: xy[i]!, y: xy[i + 1]! }, { x: xy[i + 2]!, y: xy[i + 3]! }));
      }
      return { segments: segs, closed: c.closed };
    }
  }
}

/**
 * Map a planar path given in an entity's OCS plane (z = `elevation`) to the target 2D space:
 * `target = xy(M · OCS→WCS(extrusion) · (x, y, elevation))`. Exact for all segment kinds.
 */
export function projectPlanarPath(
  path: Path2,
  extrusion: Vec3 | undefined,
  elevation: number,
  m: Matrix44,
): Path2 {
  return transformPath(path, m.multiply(ocsToWcsMatrix(extrusion)).planeToAffine2(elevation));
}

/** Exact 3D bounds of a curve (note 03 §6.1). */
export function curve3Bounds(c: Curve3, out: Bounds3 = new Bounds3()): Bounds3 {
  switch (c.kind) {
    case "line":
      return out.addPoint(c.p0).addPoint(c.p1);
    case "ellipticArc":
      return ellipticArc3Bounds(c, out);
    case "nurbs": {
      const b = c.curve.bounds();
      return out.addXYZ(b[0]!, b[1]!, b[2]!).addXYZ(b[3]!, b[4]!, b[5]!);
    }
    case "polyline":
      for (let i = 0; i + 2 < c.points.length; i += 3)
        out.addXYZ(c.points[i]!, c.points[i + 1]!, c.points[i + 2]!);
      return out;
  }
}
