/**
 * Emulation of AutoCAD 2027's raster plot rules (VERIFIED-BY-ACAD, note 08 §10):
 *
 * - world → device: u = (x − xmin) / pixelSize, v = (y − ymin) / pixelSize; a point lights pixel
 *   (floor u, floor v) (§10.2).
 * - thin lines (≤ 1 px): both endpoints are snapped to pixels first, then the pixels along the
 *   exact line between the snapped pixel centres are chosen: nearest pixel on the minor axis,
 *   exact halves toward the end point for x-major and toward the start point for y-major lines
 *   (§10.3, 92/93 lines).
 * - lineweights: w = max(1, round(mm · 100 / 25.4)) px (fixed 100 dpi); the band around the
 *   snapped centre pixel p is [p − ⌊(w−1)/2⌋, p + ⌈(w−1)/2⌉] (even widths get the extra pixel
 *   up / right); round caps and joins (§10.4). Diagonal footprints are UNVERIFIED (AutoCAD's are
 *   ~20 % thinner at 45°).
 * - fills: vertices snapped to pixel corners (floor), pixel-centre coverage (§10.5).
 *
 * Thin geometry is rasterized here on the CPU and emitted as single-pixel points at pixel
 * centres, so the GPU's line rules never influence the result.
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

  /** Pixel column of a world x (floor rule; the far window edge maps to the last pixel, §10.2). */
  px(x: number): number {
    return edge(Math.floor((x - this.minX) / this.pixelSize), (x - this.minX) / this.pixelSize, this.width);
  }

  py(y: number): number {
    return edge(Math.floor((y - this.minY) / this.pixelSize), (y - this.minY) / this.pixelSize, this.height);
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

/** Integer pixel stepping rule of a thin line between snapped pixels (i0,j0) → (i1,j1). */
export function linePixels(
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  out: number[],
  grid?: PixelGrid,
): void {
  const dx = i1 - i0;
  const dy = j1 - j0;
  if (dx === 0 && dy === 0) {
    out.push(i0, j0);
    return;
  }
  // clip the stepping range to the canvas (with margin) to bound the work for huge lines
  if (Math.abs(dx) >= Math.abs(dy)) {
    const s = dx > 0 ? 1 : -1;
    const slope = dy / dx;
    const up = j1 > j0; // exact halves go toward the end point
    let from = 0;
    let to = Math.abs(dx);
    if (grid) {
      const lo = s > 0 ? -1 - i0 : i0 - grid.width;
      const hi = s > 0 ? grid.width - i0 : i0 + 1;
      from = Math.max(from, lo);
      to = Math.min(to, hi);
    }
    for (let k = from; k <= to; k++) {
      const i = i0 + s * k;
      const y = j0 + slope * (i - i0);
      out.push(i, roundHalf(y, up));
    }
  } else {
    const s = dy > 0 ? 1 : -1;
    const slope = dx / dy;
    const right = i0 > i1; // exact halves go toward the start point
    let from = 0;
    let to = Math.abs(dy);
    if (grid) {
      const lo = s > 0 ? -1 - j0 : j0 - grid.height;
      const hi = s > 0 ? grid.height - j0 : j0 + 1;
      from = Math.max(from, lo);
      to = Math.min(to, hi);
    }
    for (let k = from; k <= to; k++) {
      const j = j0 + s * k;
      const x = i0 + slope * (j - j0);
      out.push(roundHalf(x, right), j);
    }
  }
}

/** Nearest integer; exact .5 goes up when `up`, else down. */
function roundHalf(v: number, up: boolean): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return up ? f + 1 : f;
}

/** Plotted width in pixels for a lineweight in 1/100 mm (≥ 1). */
export function lineweightPixels(lw100: number, dpi = 100): number {
  if (lw100 <= 0) return 1;
  return Math.max(1, Math.round(((lw100 / 100) * dpi) / 25.4));
}

/** Offset (in pixels) of the band centre from the snapped pixel centre: +0.5 for even widths. */
export function bandOffset(w: number): number {
  return w % 2 === 0 ? 0.5 : 0;
}
