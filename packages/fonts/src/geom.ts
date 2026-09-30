// Small geometry helpers for strokes with bulges and outline paths.

import type { Bounds, PathCommand, Polyline, Stroke } from "./types.ts";

export interface BulgeArc {
  cx: number;
  cy: number;
  r: number;
  /** Start angle (radians). */
  a0: number;
  /** Signed sweep (radians), positive = counter-clockwise. */
  sweep: number;
}

/** Arc of the segment (x0,y0)→(x1,y1) with bulge b (b ≠ 0). */
export function bulgeToArc(x0: number, y0: number, x1: number, y1: number, b: number): BulgeArc {
  const sweep = 4 * Math.atan(b);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const chord = Math.hypot(dx, dy);
  const r = chord / (2 * Math.abs(Math.sin(sweep / 2)));
  // Centre lies on the chord's perpendicular bisector, at signed distance (chord/2)·cot(sweep/2).
  const k = (1 - b * b) / (4 * b); // = cot(sweep/2)/2 expressed through the bulge
  const cx = (x0 + x1) / 2 - k * dy;
  const cy = (y0 + y1) / 2 + k * dx;
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  return { cx, cy, r, a0, sweep };
}

export function emptyBounds(): Bounds {
  return { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
}

export function addPoint(b: Bounds, x: number, y: number): void {
  if (x < b.xMin) b.xMin = x;
  if (x > b.xMax) b.xMax = x;
  if (y < b.yMin) b.yMin = y;
  if (y > b.yMax) b.yMax = y;
}

export function finiteBounds(b: Bounds): Bounds | undefined {
  return b.xMin <= b.xMax ? b : undefined;
}

/** Adds the exact extent of a bulge arc (end points plus crossed quadrant extremes). */
export function addArc(b: Bounds, x0: number, y0: number, x1: number, y1: number, bulge: number): void {
  addPoint(b, x0, y0);
  addPoint(b, x1, y1);
  if (bulge === 0) return;
  const { cx, cy, r, a0, sweep } = bulgeToArc(x0, y0, x1, y1, bulge);
  const lo = Math.min(a0, a0 + sweep);
  const hi = Math.max(a0, a0 + sweep);
  const q = Math.PI / 2;
  for (let k = Math.ceil(lo / q); k * q <= hi; k++) {
    addPoint(b, cx + r * Math.cos(k * q), cy + r * Math.sin(k * q));
  }
}

export function strokesBounds(strokes: readonly Stroke[]): Bounds | undefined {
  const b = emptyBounds();
  for (const s of strokes) {
    const v = s.vertices;
    if (v.length === 1) addPoint(b, v[0]!.x, v[0]!.y);
    for (let i = 0; i + 1 < v.length; i++) {
      const p = v[i]!;
      const q = v[i + 1]!;
      addArc(b, p.x, p.y, q.x, q.y, p.bulge);
    }
  }
  return finiteBounds(b);
}

function quadExtrema(p0: number, p1: number, p2: number, out: number[]): void {
  const d = p0 - 2 * p1 + p2;
  if (d !== 0) {
    const t = (p0 - p1) / d;
    if (t > 0 && t < 1) out.push(t);
  }
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number, out: number[]): void {
  // Roots of the derivative a·t² + b·t + c.
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-12) {
    if (b !== 0) {
      const t = -c / b;
      if (t > 0 && t < 1) out.push(t);
    }
    return;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return;
  const s = Math.sqrt(disc);
  for (const t of [(-b + s) / (2 * a), (-b - s) / (2 * a)]) if (t > 0 && t < 1) out.push(t);
}

/** Exact ink box of an outline (curve extrema included, not just control points). */
export function pathBounds(path: readonly PathCommand[]): Bounds | undefined {
  const b = emptyBounds();
  let x = 0;
  let y = 0;
  const ts: number[] = [];
  for (const c of path) {
    if (c.type === "Z") continue;
    if (c.type === "Q") {
      ts.length = 0;
      quadExtrema(x, c.x1, c.x, ts);
      quadExtrema(y, c.y1, c.y, ts);
      for (const t of ts) {
        const u = 1 - t;
        addPoint(b, u * u * x + 2 * u * t * c.x1 + t * t * c.x, u * u * y + 2 * u * t * c.y1 + t * t * c.y);
      }
    } else if (c.type === "C") {
      ts.length = 0;
      cubicExtrema(x, c.x1, c.x2, c.x, ts);
      cubicExtrema(y, c.y1, c.y2, c.y, ts);
      for (const t of ts) {
        const u = 1 - t;
        const k0 = u * u * u;
        const k1 = 3 * u * u * t;
        const k2 = 3 * u * t * t;
        const k3 = t * t * t;
        addPoint(b, k0 * x + k1 * c.x1 + k2 * c.x2 + k3 * c.x, k0 * y + k1 * c.y1 + k2 * c.y2 + k3 * c.y);
      }
    }
    addPoint(b, c.x, c.y);
    x = c.x;
    y = c.y;
  }
  return finiteBounds(b);
}

export interface FlattenOptions {
  /**
   * Maximum sweep per segment in degrees. Default 5.625° = 8 segments per 45° octant, 64 per full
   * circle. AutoCAD's SHX arc tessellation in PLOT is UNKNOWN (note 04 §4.3/§8.3) — keep it
   * configurable and deterministic.
   */
  maxAngle?: number;
  /**
   * Optional maximum chord error in stroke units. When set, the segment count is the larger of
   * the angle rule and the tolerance rule.
   */
  tolerance?: number;
  /** Uniform scale applied to the coordinates (e.g. `font.scaleForHeight(h)`). Default 1. */
  scale?: number;
}

/** Number of segments used for an arc of `sweep` radians and radius `r` (after scaling). */
export function arcSegments(sweep: number, r: number, options: FlattenOptions = {}): number {
  const maxAngle = ((options.maxAngle ?? 5.625) * Math.PI) / 180;
  const a = Math.abs(sweep);
  let n = Math.max(1, Math.ceil(a / maxAngle - 1e-9));
  const tol = options.tolerance;
  if (tol !== undefined && tol > 0 && r > tol) {
    const step = 2 * Math.acos(1 - tol / r);
    n = Math.max(n, Math.ceil(a / step - 1e-9));
  }
  return n;
}

/** Flattens strokes into polylines; arcs are split into `arcSegments` equal-angle chords. */
export function flattenStrokes(strokes: readonly Stroke[], options: FlattenOptions = {}): Polyline[] {
  const s = options.scale ?? 1;
  const out: Polyline[] = [];
  for (const st of strokes) {
    const v = st.vertices;
    if (v.length === 0) continue;
    const pl: number[] = [v[0]!.x * s, v[0]!.y * s];
    for (let i = 0; i + 1 < v.length; i++) {
      const p = v[i]!;
      const q = v[i + 1]!;
      if (p.bulge !== 0) {
        const arc = bulgeToArc(p.x, p.y, q.x, q.y, p.bulge);
        const n = arcSegments(arc.sweep, arc.r * s, options);
        for (let k = 1; k < n; k++) {
          const a = arc.a0 + (arc.sweep * k) / n;
          pl.push((arc.cx + arc.r * Math.cos(a)) * s, (arc.cy + arc.r * Math.sin(a)) * s);
        }
      }
      pl.push(q.x * s, q.y * s);
    }
    out.push(pl);
  }
  return out;
}

export interface PathFlattenOptions {
  /** Uniform scale applied to the coordinates. Default 1. */
  scale?: number;
  /**
   * Maximum deviation in output units (Wang's bound). When unset, every curve gets `segments`
   * chords. How AutoCAD's TEXTQLTY maps to segment counts is UNKNOWN (note 04 §4.5).
   */
  tolerance?: number;
  /** Chords per curve when no tolerance is given (default 8). */
  segments?: number;
}

/** Flattens an outline into contours `[x0, y0, …]`, each implicitly closed (end ≠ start point). */
export function flattenPath(path: readonly PathCommand[], options: PathFlattenOptions = {}): Polyline[] {
  const s = options.scale ?? 1;
  const tol = options.tolerance;
  const fixed = Math.max(1, options.segments ?? 8);
  const count = (dd: number, k: number): number =>
    tol !== undefined && tol > 0 ? Math.max(1, Math.ceil(Math.sqrt((k * dd * s) / tol) - 1e-9)) : fixed;
  const out: Polyline[] = [];
  let cur: number[] | undefined;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const close = () => {
    if (cur && cur.length >= 2) {
      const n = cur.length;
      if (n >= 4 && cur[n - 2] === cur[0] && cur[n - 1] === cur[1]) cur.length = n - 2;
      out.push(cur);
    }
    cur = undefined;
  };
  for (const c of path) {
    switch (c.type) {
      case "M":
        close();
        cur = [c.x * s, c.y * s];
        x = sx = c.x;
        y = sy = c.y;
        break;
      case "L":
        cur ??= [x * s, y * s];
        cur.push(c.x * s, c.y * s);
        x = c.x;
        y = c.y;
        break;
      case "Q": {
        cur ??= [x * s, y * s];
        const n = count(Math.hypot(x - 2 * c.x1 + c.x, y - 2 * c.y1 + c.y), 0.25);
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          cur.push(
            (u * u * x + 2 * u * t * c.x1 + t * t * c.x) * s,
            (u * u * y + 2 * u * t * c.y1 + t * t * c.y) * s,
          );
        }
        x = c.x;
        y = c.y;
        break;
      }
      case "C": {
        cur ??= [x * s, y * s];
        const dd = Math.max(
          Math.hypot(x - 2 * c.x1 + c.x2, y - 2 * c.y1 + c.y2),
          Math.hypot(c.x1 - 2 * c.x2 + c.x, c.y1 - 2 * c.y2 + c.y),
        );
        const n = count(dd, 0.75);
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          const k0 = u * u * u;
          const k1 = 3 * u * u * t;
          const k2 = 3 * u * t * t;
          const k3 = t * t * t;
          cur.push(
            (k0 * x + k1 * c.x1 + k2 * c.x2 + k3 * c.x) * s,
            (k0 * y + k1 * c.y1 + k2 * c.y2 + k3 * c.y) * s,
          );
        }
        x = c.x;
        y = c.y;
        break;
      }
      case "Z":
        close();
        x = sx;
        y = sy;
        break;
    }
  }
  close();
  return out;
}
