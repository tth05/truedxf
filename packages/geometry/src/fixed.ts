/**
 * Fixed-point grid for the integer polygon engine (clipper2-ts works on integer coordinates).
 *
 * Mapping: `X = round((x − originX) · scale)`, `x = X / scale + originX`.
 *
 * Scale choice ({@link fixedPointFor}):
 * - The grid quantum `q = 1 / scale` is the **largest power of two ≤ tolerance / 64**. With the
 *   device-space default tolerance of 0.1 px (note 03 §5.3) that is 2⁻¹⁰ px ≈ 0.001 px, so
 *   snapping moves a vertex by at most q/2 ≈ 0.0005 px — two orders of magnitude below the
 *   chord tolerance, i.e. invisible at any raster resolution. A power of two makes the scaling
 *   exact in binary (x·2ᵏ never rounds), so the only rounding is the final `Math.round`.
 * - `origin` is the centre of the input bounds snapped to the grid. Working relative to it keeps
 *   the integers small: clipper2-ts takes its fast `number` path while products of coordinate
 *   deltas stay below 2⁵³ (|X| ≲ 4.7·10⁷), and falls back to BigInt beyond that.
 * - If the extent would exceed {@link MAX_FIXED_COORD} (2⁴⁶, well inside clipper's safe range
 *   2⁵³/4 for its internal sums), the quantum is doubled until it fits. That only happens for
 *   absurd tolerance/extent ratios (> 10¹² : 1) and keeps the conversion total.
 *
 * Everything is deterministic: the same bounds and tolerance always give the same grid.
 */

import type { Bounds2 } from "./bounds.ts";

/** Largest |X| (integer grid units) we hand to clipper2-ts. */
export const MAX_FIXED_COORD = 2 ** 46;

/** Default ratio tolerance / quantum. */
export const FIXED_QUANTA_PER_TOLERANCE = 64;

export interface FixedPoint {
  /** Grid units per source unit (a power of two). */
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
}

function floorPow2(v: number): number {
  // 2^floor(log2 v) without log2 rounding surprises.
  let p = 2 ** Math.floor(Math.log2(v));
  if (p > v) p /= 2;
  if (p * 2 <= v) p *= 2;
  return p;
}

/**
 * Grid for geometry within `bounds` flattened with chord tolerance `tolerance` (same units).
 * An empty box yields origin (0, 0).
 */
export function fixedPointFor(
  bounds: Bounds2,
  tolerance: number,
  quantaPerTolerance = FIXED_QUANTA_PER_TOLERANCE,
): FixedPoint {
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new RangeError(`bad tolerance ${tolerance}`);
  let q = floorPow2(tolerance / quantaPerTolerance);
  let ox = 0;
  let oy = 0;
  let half = 0;
  if (!bounds.isEmpty()) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    half = Math.max(bounds.maxX - cx, cx - bounds.minX, bounds.maxY - cy, cy - bounds.minY);
    // Grow the quantum until the extent fits; the origin is snapped to the final grid.
    while (half / q > MAX_FIXED_COORD / 2) q *= 2;
    ox = Math.round(cx / q) * q;
    oy = Math.round(cy / q) * q;
  }
  return { scale: 1 / q, originX: ox, originY: oy };
}

export function toFixedX(fp: FixedPoint, x: number): number {
  return Math.round((x - fp.originX) * fp.scale);
}

export function toFixedY(fp: FixedPoint, y: number): number {
  return Math.round((y - fp.originY) * fp.scale);
}

export function fromFixedX(fp: FixedPoint, X: number): number {
  return X / fp.scale + fp.originX;
}

export function fromFixedY(fp: FixedPoint, Y: number): number {
  return Y / fp.scale + fp.originY;
}

/** Interleaved xy → clipper Path64 (optionally dropping consecutive duplicates after snapping). */
export function toPath64(fp: FixedPoint, xy: Float64Array, dedupe = true): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let px = Number.NaN;
  let py = Number.NaN;
  for (let i = 0; i + 1 < xy.length; i += 2) {
    const X = toFixedX(fp, xy[i]!);
    const Y = toFixedY(fp, xy[i + 1]!);
    if (dedupe && X === px && Y === py) continue;
    out.push({ x: X, y: Y });
    px = X;
    py = Y;
  }
  return out;
}

/** clipper Path64 → interleaved xy. */
export function fromPath64(fp: FixedPoint, path: readonly { x: number; y: number }[]): Float64Array {
  const out = new Float64Array(path.length * 2);
  for (let i = 0; i < path.length; i++) {
    out[2 * i] = fromFixedX(fp, path[i]!.x);
    out[2 * i + 1] = fromFixedY(fp, path[i]!.y);
  }
  return out;
}
