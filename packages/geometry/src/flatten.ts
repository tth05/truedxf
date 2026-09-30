/**
 * Flattening of paths into polylines (`Float64Array`, interleaved x, y) with a chord tolerance.
 *
 * Note 03 §5.3: tessellate in **device space** after the full transform, with max deviation
 * (sagitta) ≤ 0.1 px. Build the path in device units (project.ts / `transformPath`) and pass
 * `tolerance = 0.1`, or flatten in source units with {@link toleranceForTransform}.
 *
 * Deterministic segment counts (no time limits, no randomness):
 * - line: 1.
 * - circular arc, radius r, sweep Δ: `n = max(1, ceil(|Δ| / min(π, 2·acos(1 − tol/r))))` (note
 *   03 §5.3; `1 − tol/r` clamped to ≥ −1, the π cap only matters for r < tol); vertices at equal
 *   angle steps on the arc (inscribed polygon, sagitta `r(1 − cos(Δ/2n)) ≤ tol`).
 * - elliptic arc (conjugate form, semi-major a = σmax[U V]): the same formula with r = a,
 *   equal *parameter* steps. The image of the unit-circle chord error `1 − cos(h/2)` is
 *   stretched at most by σmax, so the error is ≤ tol; the bound is tight at the major vertices.
 * - quadratic/cubic Bézier: Wang's formula (bezier.ts), equal parameter steps.
 * - NURBS: exact Bézier decomposition, then Wang (polynomial) or hull-adaptive midpoint
 *   subdivision (rational) per piece (note 03 §3.8.8).
 * Every count is capped at `MAX_SEGMENTS_PER_CURVE`.
 *
 * AutoCAD's own raster-plot tessellation is UNKNOWN (note 03 §5.1/§5.3: possible visible
 * faceting of huge circles); if it turns out coarser, these formulas are the place to imitate it.
 */

import { type BezierCurve, flattenBezierInto } from "./bezier.ts";
import { ellipticArc2PointAtParam, ellipticArc2SemiAxes } from "./ellipse.ts";
import type { Affine2 } from "./matrix.ts";
import { type Path2, type PathSegment, type Subpath, segmentEnd, segmentStart } from "./path.ts";
import { DEFAULT_DEVICE_TOLERANCE_PX, MAX_SEGMENTS_PER_CURVE } from "./tolerance.ts";

export interface FlatPolyline {
  /** Interleaved x, y. A closed polyline does not repeat its first point at the end. */
  readonly points: Float64Array;
  readonly closed: boolean;
}

/**
 * Segment count for a circular arc of radius `r` and sweep `sweep` (radians) with max sagitta
 * `tol` (same units as r).
 */
export function arcSegmentCount(radius: number, sweep: number, tol: number): number {
  const r = Math.abs(radius);
  const s = Math.abs(sweep);
  if (!(r > 0) || !(s > 0)) return 1;
  // 2·acos(1 − x) written as 4·asin(√(x/2)): identical, but exact for tiny x = tol/r where
  // 1 − x rounds to 1. Step capped at π so a full circle never collapses into one segment.
  const step = Math.min(Math.PI, 4 * Math.asin(Math.sqrt(Math.min(1, tol / (2 * r)))));
  if (!(step > 0)) return MAX_SEGMENTS_PER_CURVE;
  return Math.min(Math.max(1, Math.ceil(s / step)), MAX_SEGMENTS_PER_CURVE);
}

/**
 * Tolerance to use in *source* units so that after applying `m` the deviation is ≤ `tolDevice`:
 * `tolDevice / σmax(m)`.
 */
export function toleranceForTransform(m: Affine2, tolDevice = DEFAULT_DEVICE_TOLERANCE_PX): number {
  const [smax] = m.singularValues();
  return smax > 0 ? tolDevice / smax : tolDevice;
}

function pushSampled(
  out: number[],
  n: number,
  f: (t: number) => { x: number; y: number },
  end: { x: number; y: number },
): number {
  for (let i = 1; i < n; i++) {
    const p = f(i / n);
    out.push(p.x, p.y);
  }
  out.push(end.x, end.y);
  return n;
}

/**
 * Append the flattened segment to `out` (interleaved xy), **excluding** its start point and
 * including its exact end point. Returns the number of line segments emitted.
 */
export function flattenSegmentInto(s: PathSegment, tol: number, out: number[]): number {
  switch (s.kind) {
    case "line":
      out.push(s.p1.x, s.p1.y);
      return 1;
    case "arc": {
      const n = arcSegmentCount(s.radius, s.sweep, tol);
      const { center: c, radius: r, start, sweep } = s;
      return pushSampled(
        out,
        n,
        (t) => {
          const a = start + sweep * t;
          return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
        },
        segmentEnd(s),
      );
    }
    case "ellipticArc": {
      const [a] = ellipticArc2SemiAxes(s);
      const n = arcSegmentCount(a, s.sweep, tol);
      return pushSampled(out, n, (t) => ellipticArc2PointAtParam(s, s.start + s.sweep * t), segmentEnd(s));
    }
    case "quad":
    case "cubic": {
      const pts =
        s.kind === "quad"
          ? Float64Array.of(s.p0.x, s.p0.y, s.p1.x, s.p1.y, s.p2.x, s.p2.y)
          : Float64Array.of(s.p0.x, s.p0.y, s.p1.x, s.p1.y, s.p2.x, s.p2.y, s.p3.x, s.p3.y);
      const b: BezierCurve = { degree: s.kind === "quad" ? 2 : 3, dim: 2, points: pts };
      return flattenBezierInto(b, tol, out);
    }
    case "nurbs": {
      let n = 0;
      for (const piece of s.curve.bezierSegments()) n += flattenBezierInto(piece, tol, out);
      return n;
    }
  }
}

/** Flatten one subpath. Gaps between segments become straight connections. */
export function flattenSubpath(sp: Subpath, tol: number): FlatPolyline {
  const out: number[] = [];
  const segs = sp.segments;
  if (segs.length === 0) return { points: new Float64Array(0), closed: sp.closed };
  const first = segmentStart(segs[0]!);
  out.push(first.x, first.y);
  for (const s of segs) {
    const st = segmentStart(s);
    const lx = out[out.length - 2]!;
    const ly = out[out.length - 1]!;
    // Connect real gaps; ignore round-off differences between adjacent end/start points.
    if (Math.hypot(st.x - lx, st.y - ly) > tol * 1e-3) out.push(st.x, st.y);
    flattenSegmentInto(s, tol, out);
  }
  if (sp.closed && out.length >= 4) {
    // Drop an explicit closing vertex that coincides with the start (within tol/1000).
    const dx = out[out.length - 2]! - first.x;
    const dy = out[out.length - 1]! - first.y;
    if (Math.hypot(dx, dy) <= tol * 1e-3) out.length -= 2;
  }
  return { points: Float64Array.from(out), closed: sp.closed };
}

export function flattenPath(p: Path2, tol: number = DEFAULT_DEVICE_TOLERANCE_PX): FlatPolyline[] {
  return p.subpaths.map((sp) => flattenSubpath(sp, tol));
}
