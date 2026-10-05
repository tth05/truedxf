/**
 * Level of detail: a display list is tessellated and
 * its lineweights widened for one pixel size. While zooming, the current list is scaled; once
 * the view's pixel size differs from the list's by more than `factor`, a new list is requested
 * (debounced by the viewer; the old one stays visible until the new one arrives).
 */
import type { Rect } from "./view.ts";

export interface LodOptions {
  /** Re-tessellate when the pixel size changed by more than this factor (default 2). */
  factor?: number;
  /**
   * Finest pixel size as a fraction of the drawing's larger extent (default 1 / 65536): deeper
   * zoom only magnifies, so curve tessellation of the whole drawing stays bounded.
   */
  minPixelFraction?: number;
}

/** Pixel size (world units per device pixel) a new list should be built for. */
export function targetPixelSize(
  scale: number,
  devicePixelRatio: number,
  extents: Rect | undefined,
  options: LodOptions = {},
): number {
  let px = scale / Math.max(devicePixelRatio, 1e-6);
  if (extents) {
    const size = Math.max(extents.maxX - extents.minX, extents.maxY - extents.minY);
    const min = size * (options.minPixelFraction ?? 1 / 65536);
    if (Number.isFinite(min) && min > 0 && px < min) px = min;
  }
  return px;
}

/** True when a list built for `listPixelSize` is too coarse or too fine for `target`. */
export function needsRetessellation(
  listPixelSize: number,
  target: number,
  options: LodOptions = {},
): boolean {
  if (!(listPixelSize > 0) || !(target > 0)) return true;
  const factor = options.factor ?? 2;
  const ratio = listPixelSize / target;
  return ratio > factor * (1 + 1e-9) || ratio < 1 / (factor * (1 + 1e-9));
}
