/**
 * Angle helpers: degree/radian conversion, normalization, and the ARC/ELLIPSE span rules.
 *
 * DXF angles of ARC/TEXT/INSERT are degrees, CCW about the extrusion axis; ELLIPSE 41/42 are
 * radians (ellipse *parameters*, not angles) (note 03 §2.5, §3.7).
 *
 * Span rule (note 03 §3.5, VERIFIED-BY-ACAD via TrueView/BricsCAD, ezdxf#330): `span = (end −
 * start) mod 360` in [0, 360); identical raw values give a zero span (AutoCAD draws a point);
 * congruent-but-different values (0 → 360, −180 → 180) give a full turn.
 * UNKNOWN (note 03 §3.5): AutoCAD's behaviour for 0/360 is only known from ezdxf (full circle).
 */

export const TAU = 2 * Math.PI;
const DEG = Math.PI / 180;

export function degToRad(deg: number): number {
  return deg * DEG;
}

export function radToDeg(rad: number): number {
  return rad / DEG;
}

/** Normalize radians into [0, 2π). */
export function normalizeRad(a: number): number {
  const r = a % TAU;
  const n = r < 0 ? r + TAU : r;
  // `r + TAU` can round up to exactly TAU for tiny negative r.
  return n >= TAU ? 0 : n;
}

/** Normalize degrees into [0, 360). */
export function normalizeDeg(a: number): number {
  const r = a % 360;
  const n = r < 0 ? r + 360 : r;
  return n >= 360 ? 0 : n;
}

/**
 * CCW span from `start` to `end` in degrees, in [0, 360], with the full-circle rule:
 * `start === end` → 0; `(end − start) mod 360 == 0` otherwise → 360 (note 03 §3.5).
 */
export function arcSpanDeg(start: number, end: number): number {
  if (start === end) return 0;
  const s = normalizeDeg(end - start);
  return s === 0 ? 360 : s;
}

/** Radian version of {@link arcSpanDeg}, used for ELLIPSE parameters (note 03 §3.7). */
export function arcSpanRad(start: number, end: number): number {
  if (start === end) return 0;
  const s = normalizeRad(end - start);
  return s === 0 ? TAU : s;
}

/**
 * `[cos, sin]` of an angle in degrees, exact at multiples of 90° (so an ARC from 0° to 90° ends
 * exactly on the axis instead of at 6e-17). Other angles are reduced into [0, 360) first, which
 * keeps full precision for huge or negative inputs.
 */
export function cosSinDeg(deg: number): [number, number] {
  const a = normalizeDeg(deg);
  if (a === 0) return [1, 0];
  if (a === 90) return [0, 1];
  if (a === 180) return [-1, 0];
  if (a === 270) return [0, -1];
  const r = a * DEG;
  return [Math.cos(r), Math.sin(r)];
}

/**
 * True when angle `a` (radians) lies on the CCW sweep from `start` covering `sweep ≥ 0`
 * radians (inclusive at both ends, up to a tiny tolerance).
 */
export function angleInSweep(a: number, start: number, sweep: number, eps = 1e-12): boolean {
  if (sweep >= TAU) return true;
  const d = normalizeRad(a - start);
  return d <= sweep + eps || d >= TAU - eps;
}
