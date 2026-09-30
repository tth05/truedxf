/**
 * Emulation of AutoCAD 2027's raster plot rules (VERIFIED-BY-ACAD, note 08 §10). Everything here
 * works in device pixels: u right, v up, pixel (i, j) = [i, i+1) × [j, j+1).
 *
 * - world → device: u = (x − xmin) / pixelSize; a point lights pixel (floor u, floor v) (§10.2).
 * - thin lines (§10.3): endpoints snap to their pixels; the line is x(y) = x0 + (y − y0)·s with
 *   s = dx/dy in 16.16 fixed point truncated toward zero, walked from the start point. y-major:
 *   column round-half-up(x(j)); x-major: row round-half-up(y(i)) of the inverted line
 *   (301/301 probe lines). {@link linePixels}.
 * - circles and arcs (§10.13): centre snapped to its pixel centre, integer radius ceil(R) − 1,
 *   n = 2·ceil(|sweep|/π·√Ri + 1/4) uniform segments from the start angle, vertices floor()ed in
 *   absolute device coordinates (190/190 probe curves). {@link arcVertices}.
 * - lineweights (§10.4, §10.14): w = max(1, round(mm · 100 / 25.4)) px; each segment is a convex
 *   polygon with integer vertices P ± round-half-up(±(w−1)/2 · n) and round caps of radius
 *   (w−1)/2 with max(2, floor((w−1)/2) + 1) segments per half circle, its edges rasterized with
 *   the thin-line rule in polygon order and filled between. {@link strokeSegmentPolygon}.
 * - fills (§10.5): vertices snapped (floor); pixel (i, j) is filled when the scanline y = j crosses
 *   the polygon with x_left < i + ½ ≤ x_right, edges walked from their lower vertex with a
 *   16.16 truncated slope ({@link fillPolygon}); solid hatches are first cut into trapezoids at
 *   every vertex y, whose corners snap separately ({@link trapezoids}).
 *
 * All raster output is computed here on the CPU (single pixels and pixel-aligned spans), so the
 * GPU's rasterization rules never influence the result.
 */
import type { View } from "./plot.ts";

export class PixelGrid {
  readonly minX: number;
  readonly minY: number;
  readonly pixelSize: number;
  readonly width: number;
  readonly height: number;

  constructor(view: View, canvas: readonly [number, number]) {
    this.minX = view.minX;
    this.minY = view.minY;
    this.width = canvas[0];
    this.height = canvas[1];
    this.pixelSize = (view.maxX - view.minX) / canvas[0];
  }

  /** Device coordinate of a world x. */
  u(x: number): number {
    return (x - this.minX) / this.pixelSize;
  }

  v(y: number): number {
    return (y - this.minY) / this.pixelSize;
  }

  /** Pixel column of a world x (floor rule; the far window edge maps to the last pixel, §10.2). */
  px(x: number): number {
    const u = this.u(x);
    return edge(Math.floor(u), u, this.width);
  }

  py(y: number): number {
    const v = this.v(y);
    return edge(Math.floor(v), v, this.height);
  }

  /** World coordinate of the centre of pixel column i. */
  cx(i: number): number {
    return this.minX + (i + 0.5) * this.pixelSize;
  }

  cy(j: number): number {
    return this.minY + (j + 0.5) * this.pixelSize;
  }

  /** World coordinate of the lower-left corner of pixel column i. */
  ex(i: number): number {
    return this.minX + i * this.pixelSize;
  }

  ey(j: number): number {
    return this.minY + j * this.pixelSize;
  }

  /** Snaps a world point to its pixel centre. */
  snapCenter(x: number, y: number): [number, number] {
    return [this.cx(this.px(x)), this.cy(this.py(y))];
  }

  /** Snaps a world point to the lower-left corner of its pixel (fill vertices). */
  snapCorner(x: number, y: number): [number, number] {
    return [this.ex(this.px(x)), this.ey(this.py(y))];
  }

  /** True if the pixel range [i0,i1]×[j0,j1] can intersect the canvas. */
  visible(i0: number, j0: number, i1: number, j1: number): boolean {
    return (
      Math.max(i0, i1) >= 0 &&
      Math.min(i0, i1) < this.width &&
      Math.max(j0, j1) >= 0 &&
      Math.min(j0, j1) < this.height
    );
  }
}

function edge(i: number, u: number, n: number): number {
  return i === n && u - n < n * 1e-9 ? n - 1 : i;
}

/** Fraction bits of AutoCAD's fixed-point line and edge slopes (≥ 14 fit, note 08 §10.3). */
export const FIX_ONE = 65536;

/** Pixel range [lo, hi] along the walked axis to generate (the canvas plus a margin). */
interface Range {
  lo: number;
  hi: number;
}

/**
 * Thin-line pixels between snapped pixels (i0,j0) → (i1,j1) (note 08 §10.3, VERIFIED-BY-ACAD
 * calibration/raster-lines 93/93, probe-line-ties 208/208): the line is represented as
 * x(y) = i0 + (y − j0)·K/2^16 with K = trunc(dx·2^16/dy) (toward zero), so exact half-pixel ties
 * resolve by the truncation bias (toward the start point) or, for dyadic slopes, upward/rightward.
 * y-major lines take column floor(x(j) + ½) in every row; x-major lines take, in every column, the
 * row floor(y*(i) + ½) of the inverted line. `grid` limits the output to the canvas.
 */
export function linePixels(
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  out: number[],
  grid?: { width: number; height: number },
): void {
  const dx = i1 - i0;
  const dy = j1 - j0;
  if (dx === 0 && dy === 0) {
    out.push(i0, j0);
    return;
  }
  if (dy === 0) {
    const s = dx > 0 ? 1 : -1;
    const r = clipRange(i0, s, Math.abs(dx), grid?.width);
    for (let k = r.lo; k <= r.hi; k++) out.push(i0 + s * k, j0);
    return;
  }
  const K = Math.trunc((dx * FIX_ONE) / dy);
  if (Math.abs(dy) >= Math.abs(dx)) {
    const s = dy > 0 ? 1 : -1;
    const r = clipRange(j0, s, Math.abs(dy), grid?.height);
    for (let k = r.lo; k <= r.hi; k++) {
      const d = s * k;
      out.push(i0 + Math.floor((2 * d * K + FIX_ONE) / (2 * FIX_ONE)), j0 + d);
    }
    return;
  }
  const s = dx > 0 ? 1 : -1;
  const r = clipRange(i0, s, Math.abs(dx), grid?.width);
  for (let k = r.lo; k <= r.hi; k++) {
    const d = s * k;
    // y*(i) = j0 + d·2^16/K; row = floor(y* + ½) (K ≠ 0 here since |dx| > |dy| > 0)
    out.push(i0 + d, j0 + Math.floor((2 * d * FIX_ONE + K) / (2 * K)));
  }
}

/** Steps k ∈ [0, n] of a walk start + s·k that can land within [−1, size] (all when no size). */
function clipRange(start: number, s: number, n: number, size: number | undefined): Range {
  if (size === undefined) return { lo: 0, hi: n };
  const lo = s > 0 ? -1 - start : start - size;
  const hi = s > 0 ? size - start : start + 1;
  return { lo: Math.max(0, lo), hi: Math.min(n, hi) };
}

/** Plotted width in pixels for a lineweight in 1/100 mm (≥ 1). */
export function lineweightPixels(lw100: number, dpi = 100): number {
  if (lw100 <= 0) return 1;
  return Math.max(1, Math.round(((lw100 / 100) * dpi) / 25.4));
}

// ---- curves --------------------------------------------------------------------------------

/**
 * Number of segments of a circular arc with integer device radius `ri` and a sweep (radians):
 * n = 2·ceil(|sweep|/π · √ri + ¼) (note 08 §10.13, VERIFIED-BY-ACAD probe-circles, -circles-large,
 * -arcs: 110/110 distinct radius/sweep pairs; full circles n = 2·ceil(2√ri + ¼)).
 */
export function arcSegmentCount(ri: number, sweep: number): number {
  return 2 * Math.ceil((Math.abs(sweep) / Math.PI) * Math.sqrt(Math.max(0, ri)) + 0.25);
}

/**
 * Vertex pixels (flat i, j pairs) of a circular arc in device coordinates (centre cu, cv, radius r
 * px, start angle and signed sweep in radians): centre snapped to its pixel centre, integer radius
 * ceil(r) − 1, vertices at the uniform angles start + sweep·k/n, floor()ed in absolute
 * coordinates (note 08 §10.13). A full circle repeats its first vertex at the end.
 */
export function arcVertices(cu: number, cv: number, r: number, start: number, sweep: number): number[] {
  const ccx = Math.floor(cu) + 0.5;
  const ccy = Math.floor(cv) + 0.5;
  const ri = Math.max(0, Math.ceil(r) - 1);
  const n = arcSegmentCount(ri, sweep);
  const out: number[] = [];
  for (let k = 0; k <= n; k++) {
    const t = start + (sweep * k) / n;
    out.push(Math.floor(ccx + ri * Math.cos(t)), Math.floor(ccy + ri * Math.sin(t)));
  }
  return out;
}

/**
 * Radius factors of the graphics-system curve tessellation (note 08 §10.13): strokes (elliptic
 * arcs, arcs whose circle leaves the canvas) fit 1.0084–1.0254 (probe-ellipses, polylines/bulge-*),
 * outlines of wide polylines 1.0 (polylines/ring-semicircle-w6 exact).
 */
export const GS_STROKE_FACTOR = 1.016;
export const GS_FILL_FACTOR = 1;

/**
 * Segments of a curve tessellated by AutoCAD's graphics system (elliptic arcs, off-canvas circular
 * arcs, outlines): ceil(max(32, π·√(a·f)) · |sweep| / 2π) uniform parameter steps from the start,
 * vertices at the exact points; a = semi-major axis / radius in device px (note 08 §10.13,
 * VERIFIED-BY-ACAD probe-ellipses 30/30, polylines/bulge-0003/-0009/-0010; the PDF driver uses the
 * same rule with f = 1 at 600 dpi).
 */
export function gsSegmentCount(a: number, sweep: number, f = GS_STROKE_FACTOR): number {
  const full = Math.max(32, Math.PI * Math.sqrt(Math.max(0, a) * f));
  return Math.max(1, Math.ceil((full * Math.abs(sweep)) / (2 * Math.PI) - 1e-9));
}

// ---- wide strokes --------------------------------------------------------------------------

const hu = (x: number) => Math.floor(x + 0.5);

/**
 * Footprints of zero-length strokes by pixel width, relative to the snapped pixel (note 08 §10.14,
 * VERIFIED-BY-ACAD probe-thick, thick-probe; rows listed as [dj, i-from, i-to]).
 */
const ZERO_LENGTH: Record<number, readonly (readonly [number, number, number])[]> = {
  2: [
    [0, -1, 0],
    [-1, 0, 0],
  ],
  5: [
    [1, -1, 0],
    [0, -2, 1],
    [-1, -1, 0],
  ],
  8: [
    [2, -2, 1],
    [1, -2, 2],
    [0, -3, 2],
    [-1, -2, 2],
    [-2, -2, 1],
  ],
};

function zeroLengthRows(w: number): readonly (readonly [number, number, number])[] {
  // 3–4 px strokes share the 2 px dot, 6 px the 5 px one; 7 px is not producible at 100 dpi
  return ZERO_LENGTH[w <= 4 ? 2 : w <= 6 ? 5 : 8]!;
}

/**
 * Convex polygon (flat integer vertices, counter-clockwise) of one wide stroke segment between the
 * snapped pixels P0 = (i0, j0) and P1 = (i1, j1) for a width of w ≥ 2 px (note 08 §10.14,
 * VERIFIED-BY-ACAD probe-thick / thick-probe: 281/288 bodies, 269/288 whole strokes):
 * body offsets o± = round-half-up(±h·n), h = (w − 1)/2, n the left unit normal — for w = 2 the
 * base line and its copy one pixel up (x-major) or right (y-major); round caps of radius h with
 * max(2, floor(h) + 1) segments per half circle, vertices P + round-half-up(h·(cos a, sin a)).
 * Returns undefined for a zero-length segment (see {@link strokeDotPixels}).
 */
export function strokeSegmentPolygon(
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  w: number,
): number[] | undefined {
  const dx = i1 - i0;
  const dy = j1 - j0;
  if (dx === 0 && dy === 0) return undefined;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const h = (w - 1) / 2;
  let opx: number;
  let opy: number;
  let omx: number;
  let omy: number;
  if (w <= 2) {
    // one extra pixel along the minor axis, on whichever side of the line that is
    const [ex, ey] = Math.abs(dx) >= Math.abs(dy) ? [0, 1] : [1, 0];
    if (ex * nx + ey * ny > 0) [opx, opy, omx, omy] = [ex, ey, 0, 0];
    else [opx, opy, omx, omy] = [0, 0, ex, ey];
  } else {
    opx = hu(h * nx);
    opy = hu(h * ny);
    omx = hu(-h * nx);
    omy = hu(-h * ny);
  }
  const nc = Math.max(2, Math.floor(h) + 1);
  const phi = Math.atan2(ny, nx);
  const v: number[] = [i0 + omx, j0 + omy, i1 + omx, j1 + omy];
  for (let k = 1; k < nc; k++) {
    const a = phi - Math.PI + (Math.PI * k) / nc;
    v.push(i1 + hu(h * Math.cos(a)), j1 + hu(h * Math.sin(a)));
  }
  v.push(i1 + opx, j1 + opy, i0 + opx, j0 + opy);
  for (let k = 1; k < nc; k++) {
    const a = phi + (Math.PI * k) / nc;
    v.push(i0 + hu(h * Math.cos(a)), j0 + hu(h * Math.sin(a)));
  }
  return v;
}

/** Collects filled pixels as horizontal spans per row. */
export class SpanSet {
  private readonly rows = new Map<number, number[]>();

  /** Adds the inclusive span [i0, i1] of row j. */
  add(j: number, i0: number, i1: number): void {
    if (i1 < i0) return;
    const r = this.rows.get(j);
    if (r) r.push(i0, i1);
    else this.rows.set(j, [i0, i1]);
  }

  get empty(): boolean {
    return this.rows.size === 0;
  }

  /** Merged, sorted spans: callback(j, i0, i1) with inclusive ends. */
  forEach(fn: (j: number, i0: number, i1: number) => void): void {
    const js = [...this.rows.keys()].sort((a, b) => a - b);
    for (const j of js) {
      const r = this.rows.get(j)!;
      const idx: number[] = [];
      for (let k = 0; k < r.length; k += 2) idx.push(k);
      idx.sort((a, b) => r[a]! - r[b]!);
      let s = r[idx[0]!]!;
      let e = r[idx[0]! + 1]!;
      for (let q = 1; q < idx.length; q++) {
        const a = r[idx[q]!]!;
        const b = r[idx[q]! + 1]!;
        if (a <= e + 1) e = Math.max(e, b);
        else {
          fn(j, s, e);
          s = a;
          e = b;
        }
      }
      fn(j, s, e);
    }
  }
}

/**
 * Fills a convex polygon with integer vertices the way AutoCAD fills wide strokes: its edges are
 * rasterized with {@link linePixels} in polygon order and each row is filled between its leftmost
 * and rightmost boundary pixel (note 08 §10.14).
 */
export function fillConvexByEdges(
  v: readonly number[],
  out: SpanSet,
  grid?: { width: number; height: number },
): void {
  const n = v.length >> 1;
  const pts: number[] = [];
  for (let k = 0; k < n; k++) {
    const b = (k + 1) % n;
    linePixels(v[k * 2]!, v[k * 2 + 1]!, v[b * 2]!, v[b * 2 + 1]!, pts, grid);
  }
  const lo = new Map<number, number>();
  const hi = new Map<number, number>();
  for (let q = 0; q < pts.length; q += 2) {
    const i = pts[q]!;
    const j = pts[q + 1]!;
    const a = lo.get(j);
    if (a === undefined || i < a) lo.set(j, i);
    const b = hi.get(j);
    if (b === undefined || i > b) hi.set(j, i);
  }
  for (const [j, a] of lo) out.add(j, a, hi.get(j)!);
}

/** Zero-length stroke of width w at pixel (i, j) (note 08 §10.14; POINT entities stay 1 px). */
export function strokeDotPixels(i: number, j: number, w: number, out: SpanSet): void {
  if (w <= 1) {
    out.add(j, i, i);
    return;
  }
  for (const [dj, a, b] of zeroLengthRows(w)) out.add(j + dj, i + a, i + b);
}

// ---- fills ---------------------------------------------------------------------------------

/**
 * Scanline fill of polygons with integer vertices (flat i, j rings) with AutoCAD's fill rule
 * (note 08 §10.5, VERIFIED-BY-ACAD raster-fills, probe-fills: all SOLIDs off pixel boundaries):
 * the scanline of row j is y = j; every edge is walked from its lower vertex with the slope
 * trunc(dx·2^16/dy)/2^16, crossings [ymin, ymax); pixel i is filled when x_left < i + ½ ≤ x_right.
 */
export function fillPolygon(rings: readonly (readonly number[])[], evenOdd: boolean, out: SpanSet): void {
  interface Edge {
    xb: number;
    yb: number;
    yt: number;
    k: number;
    dir: number;
  }
  const edges: Edge[] = [];
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const r of rings) {
    const n = r.length >> 1;
    for (let q = 0; q < n; q++) {
      const ax = r[q * 2]!;
      const ay = r[q * 2 + 1]!;
      const b = (q + 1) % n;
      const bx = r[b * 2]!;
      const by = r[b * 2 + 1]!;
      if (ay === by) continue;
      const up = ay < by;
      const [xb, yb, xt, yt] = up ? [ax, ay, bx, by] : [bx, by, ax, ay];
      edges.push({ xb, yb, yt, k: Math.trunc(((xt - xb) * FIX_ONE) / (yt - yb)), dir: up ? 1 : -1 });
      if (yb < ymin) ymin = yb;
      if (yt > ymax) ymax = yt;
    }
  }
  const xs: { x: number; dir: number }[] = [];
  for (let j = ymin; j < ymax; j++) {
    xs.length = 0;
    for (const e of edges)
      if (j >= e.yb && j < e.yt) xs.push({ x: e.xb * FIX_ONE + (j - e.yb) * e.k, dir: e.dir });
    xs.sort((a, b) => a.x - b.x);
    let wind = 0;
    for (let q = 0; q + 1 < xs.length; q++) {
      wind += xs[q]!.dir;
      if (evenOdd ? q % 2 !== 0 : wind === 0) continue;
      // x_left < i + ½ ≤ x_right in units of 2^-16 px
      const a = Math.floor((xs[q]!.x - FIX_ONE / 2) / FIX_ONE) + 1;
      const b = Math.floor((xs[q + 1]!.x - FIX_ONE / 2) / FIX_ONE);
      out.add(j, a, b);
    }
  }
}

/**
 * Trapezoid decomposition of rings (device coordinates, not snapped) at every vertex y, as
 * AutoCAD fills solid hatches (note 08 §10.5: a triangle's long edge kinks at the snapped split
 * point; VERIFIED-BY-ACAD probe-fills: 40/40 hatches without islands). Returns quads
 * (x0, y0, x1, y0, x2, y1, x3, y1).
 */
export function trapezoids(rings: readonly ArrayLike<number>[], evenOdd: boolean): number[][] {
  interface Edge {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    dir: number;
  }
  const edges: Edge[] = [];
  const ys: number[] = [];
  for (const r of rings) {
    const n = r.length >> 1;
    for (let q = 0; q < n; q++) {
      const ax = r[q * 2]!;
      const ay = r[q * 2 + 1]!;
      const b = (q + 1) % n;
      const bx = r[b * 2]!;
      const by = r[b * 2 + 1]!;
      ys.push(ay);
      if (ay === by) continue;
      edges.push(ay < by ? { ax, ay, bx, by, dir: 1 } : { ax: bx, ay: by, bx: ax, by: ay, dir: -1 });
    }
  }
  ys.sort((a, b) => a - b);
  const levels = ys.filter((y, k) => k === 0 || y !== ys[k - 1]);
  const xAt = (e: Edge, y: number) => e.ax + ((e.bx - e.ax) * (y - e.ay)) / (e.by - e.ay);
  const out: number[][] = [];
  for (let q = 0; q + 1 < levels.length; q++) {
    const y0 = levels[q]!;
    const y1 = levels[q + 1]!;
    const ym = (y0 + y1) / 2;
    const act = edges.filter((e) => e.ay <= y0 && e.by >= y1).sort((a, b) => xAt(a, ym) - xAt(b, ym));
    let wind = 0;
    for (let k = 0; k + 1 < act.length; k++) {
      wind += act[k]!.dir;
      if (evenOdd ? k % 2 !== 0 : wind === 0) continue;
      const l = act[k]!;
      const r = act[k + 1]!;
      out.push([xAt(l, y0), y0, xAt(r, y0), y0, xAt(r, y1), y1, xAt(l, y1), y1]);
    }
  }
  return out;
}
