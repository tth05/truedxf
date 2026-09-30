/**
 * Polygon booleans and clipping (viewport borders, XCLIP boundaries incl. inverted clips),
 * built on clipper2-ts (BSL-1.0).
 *
 * clipper2-ts works on integer coordinates: every function here snaps its input to the grid of
 * a {@link FixedPoint} (see fixed.ts: quantum = largest power of two ≤ tolerance/64, relative to
 * the input's bounds centre). Pass either `tolerance` (the chord tolerance the input was
 * flattened with, same units — default {@link DEFAULT_DEVICE_TOLERANCE_PX}, i.e. device pixels)
 * or an explicit `fixedPoint` when several calls must share one grid (e.g. a clip region reused
 * for many entities). Output vertices are grid points mapped back to float64, so they deviate
 * from the exact intersection by at most quantum/√2.
 *
 * Fill rules: clipper applies one rule to subject and clip alike, so both sides are first
 * normalized separately with their own rule (a union), which yields simple, consistently
 * oriented polygons; the actual operation then runs on those with NonZero.
 *
 * Exact float64 alternative for the common axis-aligned case: {@link clipPolylineToRect}
 * (Liang–Barsky, no snapping) for viewport rectangles and RAY/XLINE clipping.
 *
 * Determinism: clipper2 is a deterministic sweep; for identical input (values and order) the
 * output is identical. Output ring order follows clipper's polytree order.
 */

import {
  Clipper64,
  FillRule as ClipperFillRule,
  ClipType,
  Minkowski,
  type Path64,
  type Paths64,
  type PolyPath64,
  PolyTree64,
  trimCollinear,
} from "clipper2-ts";
import { Bounds2 } from "./bounds.ts";
import { type FixedPoint, fixedPointFor, fromPath64, toPath64 } from "./fixed.ts";
import { FillRule, type PolygonWithHoles, ringsBounds } from "./polygon.ts";
import { DEFAULT_DEVICE_TOLERANCE_PX } from "./tolerance.ts";

export interface GridOptions {
  /** Chord tolerance of the input (same units); selects the grid. Default 0.1 (device px). */
  readonly tolerance?: number;
  /** Explicit grid; overrides `tolerance`. */
  readonly fixedPoint?: FixedPoint;
}

/** A clip region: rings + fill rule; `inverted` keeps what is *outside* (XCLIP inverted). */
export interface ClipRegion {
  readonly rings: readonly Float64Array[];
  readonly fillRule?: FillRule;
  readonly inverted?: boolean;
}

export const BooleanOp = {
  Union: "union",
  Intersection: "intersection",
  Difference: "difference",
  Xor: "xor",
} as const;
export type BooleanOp = (typeof BooleanOp)[keyof typeof BooleanOp];

export function clipperFillRule(r: FillRule | undefined): ClipperFillRule {
  return r === FillRule.NonZero ? ClipperFillRule.NonZero : ClipperFillRule.EvenOdd;
}

function clipType(op: BooleanOp): ClipType {
  switch (op) {
    case BooleanOp.Union:
      return ClipType.Union;
    case BooleanOp.Intersection:
      return ClipType.Intersection;
    case BooleanOp.Difference:
      return ClipType.Difference;
    case BooleanOp.Xor:
      return ClipType.Xor;
  }
}

/** The grid for `opts` covering all given rings / polylines. */
export function gridFor(sets: readonly (readonly Float64Array[])[], opts: GridOptions = {}): FixedPoint {
  if (opts.fixedPoint) return opts.fixedPoint;
  const b = new Bounds2();
  for (const s of sets) ringsBounds(s, b);
  return fixedPointFor(b, opts.tolerance ?? DEFAULT_DEVICE_TOLERANCE_PX);
}

export function ringsToPaths64(fp: FixedPoint, rings: readonly Float64Array[]): Paths64 {
  const out: Paths64 = [];
  for (const r of rings) {
    const p = toPath64(fp, r);
    // Drop an explicit closing point and anything that cannot enclose area.
    if (p.length > 1 && p[0]!.x === p[p.length - 1]!.x && p[0]!.y === p[p.length - 1]!.y) p.pop();
    if (p.length < 3) continue;
    // Remove collinear vertices and zero-width spikes (exact integer test). Harmless for the
    // region, and it works around a clipper2-ts 2.0.1 union bug: a spike folding back along a
    // horizontal edge made the union drop part of the polygon.
    const t = trimCollinear(p, false);
    if (t.length >= 3) out.push(t);
  }
  return out;
}

/** Union of integer paths with a fill rule → polytree (the normalization step). */
export function normalizePaths64(paths: Paths64, rule: FillRule | undefined): PolyTree64 {
  const c = new Clipper64();
  c.addSubject(paths);
  const tree = new PolyTree64();
  c.execute(ClipType.Union, clipperFillRule(rule), tree);
  return tree;
}

/** Visit the outer polygons of a polytree with their direct holes (islands recurse). */
export function forEachPolygon64(tree: PolyPath64, visit: (outer: Path64, holes: Path64[]) => void): void {
  for (let i = 0; i < tree.count; i++) {
    const outer = tree.child(i);
    const holes: Path64[] = [];
    for (let j = 0; j < outer.count; j++) {
      const h = outer.child(j);
      if (h.poly && h.poly.length >= 3) holes.push(h.poly);
      forEachPolygon64(h, visit); // islands inside the hole
    }
    if (outer.poly && outer.poly.length >= 3) visit(outer.poly, holes);
  }
}

function treeToPolygons(fp: FixedPoint, tree: PolyTree64): PolygonWithHoles[] {
  const out: PolygonWithHoles[] = [];
  forEachPolygon64(tree, (outer, holes) => {
    out.push({ outer: fromPath64(fp, outer), holes: holes.map((h) => fromPath64(fp, h)) });
  });
  return out;
}

/** Normalize a ring set under a fill rule: simple polygons with holes (union). */
export function normalizePolygons(
  rings: readonly Float64Array[],
  fillRule: FillRule = FillRule.EvenOdd,
  opts: GridOptions = {},
): PolygonWithHoles[] {
  const fp = gridFor([rings], opts);
  return treeToPolygons(fp, normalizePaths64(ringsToPaths64(fp, rings), fillRule));
}

function normalizedPaths(
  fp: FixedPoint,
  rings: readonly Float64Array[],
  rule: FillRule | undefined,
): Paths64 {
  const c = new Clipper64();
  c.addSubject(ringsToPaths64(fp, rings));
  const out: Paths64 = [];
  c.execute(ClipType.Union, clipperFillRule(rule), out);
  return out;
}

/**
 * Minkowski dilation of a region by the axis-aligned square [−h, h]²: every point within
 * Chebyshev distance h of the region. Used for the "pixel square touches the region" clip test of
 * single-pixel output (a pixel centre inside the region dilated by half a pixel).
 */
export function dilateBySquare(
  rings: readonly Float64Array[],
  h: number,
  opts: GridOptions & { readonly fillRule?: FillRule } = {},
): PolygonWithHoles[] {
  const fp = gridFor([rings, [Float64Array.of(-h, -h, h, h)]], opts);
  const paths = normalizedPaths(fp, rings, opts.fillRule ?? FillRule.EvenOdd);
  const H = Math.round(h * fp.scale);
  const square = [
    { x: -H, y: -H },
    { x: H, y: -H },
    { x: H, y: H },
    { x: -H, y: H },
  ];
  const c = new Clipper64();
  c.addSubject(paths);
  for (const p of paths) c.addSubject(Minkowski.sum(square, p, true));
  const tree = new PolyTree64();
  c.execute(ClipType.Union, ClipperFillRule.NonZero, tree);
  return treeToPolygons(fp, tree);
}

/**
 * Boolean operation between two ring sets, each with its own fill rule (see module comment).
 */
export function booleanPolygons(
  op: BooleanOp,
  subject: readonly Float64Array[],
  clip: readonly Float64Array[],
  opts: GridOptions & { readonly subjectFillRule?: FillRule; readonly clipFillRule?: FillRule } = {},
): PolygonWithHoles[] {
  const fp = gridFor([subject, clip], opts);
  const c = new Clipper64();
  c.addSubject(normalizedPaths(fp, subject, opts.subjectFillRule));
  c.addClip(normalizedPaths(fp, clip, opts.clipFillRule));
  const tree = new PolyTree64();
  c.execute(clipType(op), ClipperFillRule.NonZero, tree);
  return treeToPolygons(fp, tree);
}

/** Clip filled polygons to a region (intersection, or difference when `region.inverted`). */
export function clipPolygons(
  subject: readonly Float64Array[],
  region: ClipRegion,
  opts: GridOptions & { readonly fillRule?: FillRule } = {},
): PolygonWithHoles[] {
  return booleanPolygons(
    region.inverted ? BooleanOp.Difference : BooleanOp.Intersection,
    subject,
    region.rings,
    {
      ...opts,
      subjectFillRule: opts.fillRule ?? FillRule.NonZero,
      clipFillRule: region.fillRule ?? FillRule.EvenOdd,
    },
  );
}

/** An open or closed polyline for clipping. */
export interface ClipPolyline {
  readonly points: Float64Array;
  readonly closed?: boolean;
}

/**
 * Clip polylines (hairlines, dashes, pattern lines) to a region. Returns open polylines; a
 * closed input is clipped as an open path that repeats its first point.
 *
 * Direction/order: clipper2 may split and reorder the pieces; the pieces are not guaranteed to
 * keep the input direction. Apply linetypes **before** clipping (AutoCAD generates linetypes in
 * model space before the viewport clip, note 06 §2.6), so this does not matter for rendering.
 */
export function clipPolylines(
  lines: readonly (Float64Array | ClipPolyline)[],
  region: ClipRegion,
  opts: GridOptions = {},
): Float64Array[] {
  const items = lines.map((l) => (l instanceof Float64Array ? { points: l, closed: false } : l));
  const fp = gridFor([items.map((l) => l.points), region.rings], opts);
  const open: Paths64 = [];
  for (const l of items) {
    const p = toPath64(fp, l.points);
    if (l.closed && p.length > 2) p.push({ ...p[0]! });
    if (p.length >= 2) open.push(p);
  }
  const c = new Clipper64();
  c.addOpenSubject(open);
  c.addClip(normalizedPaths(fp, region.rings, region.fillRule ?? FillRule.EvenOdd));
  const closedOut: Paths64 = [];
  const openOut: Paths64 = [];
  c.execute(
    region.inverted ? ClipType.Difference : ClipType.Intersection,
    ClipperFillRule.NonZero,
    closedOut,
    openOut,
  );
  return openOut.filter((p) => p.length >= 2).map((p) => fromPath64(fp, p));
}

// ---- Exact rectangle clipping (float64, no grid) ---------------------------------------------

export interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Liang–Barsky clip of segment (x0,y0)–(x1,y1) to `r`. Returns `[t0, t1]` (0 ≤ t0 ≤ t1 ≤ 1) or
 * undefined when outside. Boundary points count as inside.
 */
export function clipSegmentToRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: Rect,
): [number, number] | undefined {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - r.minX, r.maxX - x0, y0 - r.minY, r.maxY - y0];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return undefined;
      continue;
    }
    const t = qi / pi;
    if (pi < 0) {
      if (t > t1) return undefined;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return undefined;
      if (t < t1) t1 = t;
    }
  }
  return [t0, t1];
}

/**
 * Exact clip of a polyline to an axis-aligned rectangle. Keeps direction; contiguous inside
 * runs stay one polyline. Endpoints are computed as `p + t·(q − p)` with t = 0/1 mapped to the
 * original vertices exactly.
 */
export function clipPolylineToRect(points: Float64Array, rect: Rect, closed = false): Float64Array[] {
  const n = points.length >> 1;
  const out: Float64Array[] = [];
  if (n === 0) return out;
  if (n === 1) {
    const x = points[0]!;
    const y = points[1]!;
    if (x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY) out.push(Float64Array.of(x, y));
    return out;
  }
  let cur: number[] | undefined;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const x0 = points[2 * i]!;
    const y0 = points[2 * i + 1]!;
    const x1 = points[2 * j]!;
    const y1 = points[2 * j + 1]!;
    const c = clipSegmentToRect(x0, y0, x1, y1, rect);
    if (!c) {
      if (cur) out.push(Float64Array.from(cur));
      cur = undefined;
      continue;
    }
    const [t0, t1] = c;
    const ax = t0 === 0 ? x0 : x0 + (x1 - x0) * t0;
    const ay = t0 === 0 ? y0 : y0 + (y1 - y0) * t0;
    const bx = t1 === 1 ? x1 : x0 + (x1 - x0) * t1;
    const by = t1 === 1 ? y1 : y0 + (y1 - y0) * t1;
    if (!cur || t0 > 0) {
      if (cur) out.push(Float64Array.from(cur));
      cur = [ax, ay];
    }
    if (cur.length === 2 || cur[cur.length - 2] !== bx || cur[cur.length - 1] !== by) cur.push(bx, by);
    if (t1 < 1) {
      out.push(Float64Array.from(cur));
      cur = undefined;
    }
  }
  if (cur) out.push(Float64Array.from(cur));
  // A closed polyline whose first and last runs meet at vertex 0 becomes one run.
  if (closed && out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (
      first[0] === points[0] &&
      first[1] === points[1] &&
      last[last.length - 2] === points[0] &&
      last[last.length - 1] === points[1]
    ) {
      const merged = new Float64Array(last.length + first.length - 2);
      merged.set(last, 0);
      merged.set(first.subarray(2), last.length);
      out.splice(out.length - 1, 1);
      out[0] = merged;
    }
  }
  return out;
}
