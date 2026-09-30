/**
 * Stroker: flattened polyline + width → filled geometry (triangles for the display list, or a
 * unioned outline).
 *
 * Construction (PostScript/PDF stroke model): the stroke is the union of
 * - one rectangle per segment (± width/2 around the centre line),
 * - one **join** piece per interior vertex (every vertex of a closed polyline), on the outer side
 *   of the turn only — the inner side is covered by the overlapping segment rectangles,
 * - one **cap** piece at each end of an open polyline.
 * Every piece is convex and emitted counter-clockwise, then fan-triangulated.
 *
 * Styles (the CTB pen vocabulary, note 06 §5.2; ezdxf acadctb end style 0 butt, 1 square,
 * 2 round, 3 diamond; join 0 miter, 1 bevel, 2 round, 3 diamond):
 * - cap `butt`: nothing; `square`: rectangle extending h = width/2 past the end; `round`:
 *   half-disc; `diamond`: triangle with its tip h past the end (UNVERIFIED shape).
 * - join `miter`: tip where the outer offset lines meet, falls back to bevel when the miter
 *   ratio `1/cos(θ/2)` (θ = turn angle; = miter length / width as in SVG/PDF) exceeds
 *   `miterLimit`; `bevel`: triangle between the two outer corners; `round`: pie wedge;
 *   `diamond`: bevel plus a tip at distance h along the outer bisector (UNVERIFIED shape — our
 *   reading of "diamond"; to be checked against a CTB-join plot).
 * Defaults are round/round — the ASSUMPTION of note 06 §5.2 for ENDCAPS/JOINSTYLE = 0; the
 * AutoCAD raster rules (lineweight → px, caps, joins) are being calibrated (tools/acad, note 08
 * "Calibration results", question backlog W1/W2) and every choice here is an option.
 *
 * Round pieces are tessellated deterministically: `arcSegmentCount(h, angle, tolerance)` equal
 * angular steps (the flattening rule of flatten.ts), vertices exactly on the circle (inscribed).
 *
 * Degenerate input:
 * - consecutive points closer than `tolerance·1e-3` are merged (as flattenSubpath does);
 * - exactly collinear continuations get no join; 180° reversals (spikes) get a half-disc for
 *   round joins and nothing for miter/bevel (the miter ratio is infinite → bevel of zero area),
 *   i.e. the spike tip is cut square at the vertex like an SVG renderer;
 * - a polyline that collapses to one point is drawn as a *dot*: the two caps back to back
 *   (round → disc, square → square, diamond → rhombus, butt → nothing), oriented along
 *   `dotDirection` (default +x). {@link strokeDot} is the direct entry point for linetype dots.
 *
 * Overlap caveat: triangles of one stroke overlap (segment rectangles overlap at joins, caps
 * overlap rectangles). That is invisible for opaque colours but double-blends with
 * transparency. For transparent strokes use {@link strokeOutline} (clipper union with nonzero)
 * and triangulate that (`triangulateFill(…, { fillRule: "nonZero" })`), which never overlaps.
 */

import { type GridOptions, normalizePolygons } from "./clip.ts";
import { arcSegmentCount } from "./flatten.ts";
import { FillRule, type PolygonWithHoles } from "./polygon.ts";
import { DEFAULT_DEVICE_TOLERANCE_PX } from "./tolerance.ts";
import { triangulateConvex } from "./triangulate.ts";

export const LineCap = {
  Butt: "butt",
  Square: "square",
  Round: "round",
  Diamond: "diamond",
} as const;
export type LineCap = (typeof LineCap)[keyof typeof LineCap];

export const LineJoin = {
  Miter: "miter",
  Bevel: "bevel",
  Round: "round",
  Diamond: "diamond",
} as const;
export type LineJoin = (typeof LineJoin)[keyof typeof LineJoin];

export interface StrokeOptions {
  /** Full stroke width (same units as the points). */
  readonly width: number;
  readonly closed?: boolean;
  readonly cap?: LineCap;
  readonly join?: LineJoin;
  /** Max miter length / width before a miter becomes a bevel. Default 10 (PDF default). */
  readonly miterLimit?: number;
  /** Chord tolerance for round caps/joins (same units). Default 0.1 (device px). */
  readonly tolerance?: number;
  /** Direction (radians) of a stroke that degenerates to a single point. Default 0. */
  readonly dotDirection?: number;
}

export const DEFAULT_MITER_LIMIT = 10;

/** Convex pieces sink: each piece is a CCW ring given as interleaved xy numbers. */
type PieceSink = (ring: number[]) => void;

function signedArea2(r: number[]): number {
  let s = 0;
  const n = r.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    s += r[2 * i]! * r[2 * j + 1]! - r[2 * j]! * r[2 * i + 1]!;
  }
  return s;
}

function emitCcw(sink: PieceSink, r: number[]): void {
  const a = signedArea2(r);
  if (a === 0 || !Number.isFinite(a)) return;
  if (a < 0) {
    const n = r.length >> 1;
    const rev: number[] = [];
    for (let i = n - 1; i >= 0; i--) rev.push(r[2 * i]!, r[2 * i + 1]!);
    sink(rev);
  } else sink(r);
}

/** Polyline with near-duplicate points removed (see module comment). */
function cleanPoints(points: Float64Array, closed: boolean, eps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i]!;
    const y = points[i + 1]!;
    const n = out.length;
    if (n >= 2 && Math.hypot(x - out[n - 2]!, y - out[n - 1]!) <= eps) continue;
    out.push(x, y);
  }
  if (closed && out.length >= 4) {
    const n = out.length;
    if (Math.hypot(out[n - 2]! - out[0]!, out[n - 1]! - out[1]!) <= eps) out.length -= 2;
  }
  return out;
}

/** Fan of points on the circle (cx, cy, h) from angle a0 sweeping `sweep`, centre first. */
function wedge(cx: number, cy: number, h: number, a0: number, sweep: number, tol: number): number[] {
  const n = arcSegmentCount(h, sweep, tol);
  const r: number[] = [cx, cy];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    r.push(cx + h * Math.cos(a), cy + h * Math.sin(a));
  }
  return r;
}

interface Resolved {
  readonly h: number;
  readonly cap: LineCap;
  readonly join: LineJoin;
  readonly miterLimit: number;
  readonly tol: number;
}

function resolve(o: StrokeOptions): Resolved {
  return {
    h: Math.abs(o.width) / 2,
    cap: o.cap ?? LineCap.Round,
    join: o.join ?? LineJoin.Round,
    miterLimit: o.miterLimit ?? DEFAULT_MITER_LIMIT,
    tol: o.tolerance ?? DEFAULT_DEVICE_TOLERANCE_PX,
  };
}

/** Cap at (x, y) facing the unit direction (dx, dy) (pointing away from the stroke). */
function capPiece(sink: PieceSink, x: number, y: number, dx: number, dy: number, r: Resolved): void {
  const { h } = r;
  const nx = -dy * h;
  const ny = dx * h;
  switch (r.cap) {
    case LineCap.Butt:
      return;
    case LineCap.Square:
      emitCcw(sink, [
        x + nx,
        y + ny,
        x - nx,
        y - ny,
        x - nx + dx * h,
        y - ny + dy * h,
        x + nx + dx * h,
        y + ny + dy * h,
      ]);
      return;
    case LineCap.Diamond:
      emitCcw(sink, [x + nx, y + ny, x - nx, y - ny, x + dx * h, y + dy * h]);
      return;
    case LineCap.Round: {
      // Half-disc from the left normal clockwise through the outward direction.
      const a0 = Math.atan2(ny, nx);
      emitCcw(sink, wedge(x, y, h, a0, -Math.PI, r.tol));
      return;
    }
  }
}

/** Join at (x, y) between unit directions d0 (incoming) and d1 (outgoing). */
function joinPiece(
  sink: PieceSink,
  x: number,
  y: number,
  d0x: number,
  d0y: number,
  d1x: number,
  d1y: number,
  r: Resolved,
): void {
  const cross = d0x * d1y - d0y * d1x;
  const dot = d0x * d1x + d0y * d1y;
  if (cross === 0 && dot > 0) return; // straight on
  const theta = Math.atan2(cross, dot); // signed turn angle in (−π, π]
  const s = theta >= 0 ? 1 : -1;
  const { h } = r;
  // Outer normals: rotate the directions by −s·90°.
  const o0x = s * d0y;
  const o0y = -s * d0x;
  const o1x = s * d1y;
  const o1y = -s * d1x;
  const ax = x + o0x * h;
  const ay = y + o0y * h;
  const bx = x + o1x * h;
  const by = y + o1y * h;
  const half = Math.abs(theta) / 2;
  switch (r.join) {
    case LineJoin.Round:
      emitCcw(sink, wedge(x, y, h, Math.atan2(o0y, o0x), theta, r.tol));
      return;
    case LineJoin.Bevel:
      emitCcw(sink, [x, y, ax, ay, bx, by]);
      return;
    case LineJoin.Miter: {
      const c = Math.cos(half);
      if (!(c > 0) || 1 / c > r.miterLimit) {
        emitCcw(sink, [x, y, ax, ay, bx, by]);
        return;
      }
      let mx = o0x + o1x;
      let my = o0y + o1y;
      const ml = Math.hypot(mx, my);
      mx = (mx / ml) * (h / c);
      my = (my / ml) * (h / c);
      emitCcw(sink, [x, y, ax, ay, x + mx, y + my, bx, by]);
      return;
    }
    case LineJoin.Diamond: {
      let mx = o0x + o1x;
      let my = o0y + o1y;
      const ml = Math.hypot(mx, my);
      if (!(ml > 0)) {
        // 180° reversal: tip straight ahead along d0.
        mx = d0x;
        my = d0y;
      } else {
        mx /= ml;
        my /= ml;
      }
      emitCcw(sink, [x, y, ax, ay, x + mx * h, y + my * h, bx, by]);
      return;
    }
  }
}

function strokePieces(points: Float64Array, options: StrokeOptions, sink: PieceSink): void {
  const r = resolve(options);
  if (!(r.h > 0)) return;
  const closed = options.closed ?? false;
  const p = cleanPoints(points, closed, r.tol * 1e-3);
  const n = p.length >> 1;
  if (n === 0) return;
  if (n === 1) {
    strokeDotPieces(p[0]!, p[1]!, options.dotDirection ?? 0, r, sink);
    return;
  }
  const segs = closed && n > 2 ? n : n - 1;
  const dirs = new Float64Array(segs * 2);
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const dx = p[2 * j]! - p[2 * i]!;
    const dy = p[2 * j + 1]! - p[2 * i + 1]!;
    const l = Math.hypot(dx, dy);
    dirs[2 * i] = dx / l;
    dirs[2 * i + 1] = dy / l;
    const nx = (-dy / l) * r.h;
    const ny = (dx / l) * r.h;
    const x0 = p[2 * i]!;
    const y0 = p[2 * i + 1]!;
    const x1 = p[2 * j]!;
    const y1 = p[2 * j + 1]!;
    emitCcw(sink, [x0 - nx, y0 - ny, x1 - nx, y1 - ny, x1 + nx, y1 + ny, x0 + nx, y0 + ny]);
  }
  const isClosed = closed && n > 2;
  for (let v = isClosed ? 0 : 1; v < (isClosed ? n : n - 1); v++) {
    const i0 = (v - 1 + segs) % segs;
    joinPiece(
      sink,
      p[2 * v]!,
      p[2 * v + 1]!,
      dirs[2 * i0]!,
      dirs[2 * i0 + 1]!,
      dirs[2 * v]!,
      dirs[2 * v + 1]!,
      r,
    );
  }
  if (!isClosed) {
    capPiece(sink, p[0]!, p[1]!, -dirs[0]!, -dirs[1]!, r);
    const e = segs - 1;
    capPiece(sink, p[2 * (n - 1)]!, p[2 * (n - 1) + 1]!, dirs[2 * e]!, dirs[2 * e + 1]!, r);
  }
}

function strokeDotPieces(x: number, y: number, angle: number, r: Resolved, sink: PieceSink): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  capPiece(sink, x, y, dx, dy, r);
  capPiece(sink, x, y, -dx, -dy, r);
}

/**
 * Stroke a polyline (interleaved xy) into triangles (6 numbers per triangle, CCW). See the
 * module comment for the construction and the transparency caveat.
 */
export function strokePolyline(points: Float64Array, options: StrokeOptions): Float64Array {
  const out: number[] = [];
  strokePieces(points, options, (ring) => triangulateConvex(Float64Array.from(ring), out));
  return Float64Array.from(out);
}

/** Append the stroke triangles to `out` (for batching many strokes into one array). */
export function strokePolylineInto(points: Float64Array, options: StrokeOptions, out: number[]): void {
  strokePieces(points, options, (ring) => triangulateConvex(Float64Array.from(ring), out));
}

/**
 * The raw convex pieces (CCW rings) of a stroke — overlapping; union them with nonzero for an
 * outline, or use {@link strokeOutline}.
 */
export function strokePieceRings(points: Float64Array, options: StrokeOptions): Float64Array[] {
  const out: Float64Array[] = [];
  strokePieces(points, options, (ring) => out.push(Float64Array.from(ring)));
  return out;
}

/**
 * Outline of the stroke: the nonzero union of its pieces as simple polygons with holes, snapped
 * to the fixed-point grid of `grid` (default: from the stroke tolerance). Overlap-free.
 */
export function strokeOutline(
  points: Float64Array,
  options: StrokeOptions,
  grid: GridOptions = {},
): PolygonWithHoles[] {
  const rings = strokePieceRings(points, options);
  return normalizePolygons(rings, FillRule.NonZero, {
    tolerance: options.tolerance ?? DEFAULT_DEVICE_TOLERANCE_PX,
    ...grid,
  });
}

/**
 * A dot of the stroke's cap shape at (x, y), oriented along `angle` (radians): round → disc,
 * square → square of side `width`, diamond → rhombus, butt → nothing. For linetype dots
 * (note 06 §2.6 "Zero-length dash": ASSUMPTION disc of diameter = lineweight with round caps).
 */
export function strokeDot(x: number, y: number, angle: number, options: StrokeOptions): Float64Array {
  const out: number[] = [];
  const r = resolve(options);
  if (r.h > 0) strokeDotPieces(x, y, angle, r, (ring) => triangulateConvex(Float64Array.from(ring), out));
  return Float64Array.from(out);
}
