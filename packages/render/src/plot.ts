/**
 * Plot requests (what to plot, onto how many pixels) and the resulting view. Mirrors the fixture
 * contract in docs/fixtures.md. The exact AutoCAD raster mapping (pixel centre convention,
 * printable-area inset) comes from the calibration results (note 08 "Calibration results");
 * adjustable via `PlotCalibration`.
 */
import type { Bounds } from "./displaylist.ts";

export type PlotArea =
  | { type: "window"; min: readonly [number, number]; max: readonly [number, number] }
  | { type: "extents" }
  | { type: "layout" };

export interface PlotRequest {
  /** "Model" or a paper-space layout name. */
  layout: string;
  area: PlotArea;
  /** Output size in device pixels. */
  canvas: readonly [number, number];
  /** "monochrome.ctb" | "acad.ctb" | undefined (object colours). */
  styleTable?: string;
  /** Plot object lineweights (default true). */
  lineweights?: boolean;
  scale?: "fit" | readonly [number, number];
}

export interface View {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PlotCalibration {
  /** Raster device resolution used to convert lineweights (mm) to pixels. */
  dpi: number;
  /** Lineweights (in px) at or below this are drawn as 1-px hairlines. */
  hairlineMaxPx: number;
  /**
   * Plot-mode tessellation of circular / elliptic arcs: fixed angular step in degrees
   * (undefined = chord tolerance). AutoCAD's rule is UNVERIFIED (note 08 §10.3: ≈ 6° chords at
   * r = 600 px).
   */
  arcStepDeg?: number;
  /** Experimental: radial offset (device px) applied to plot-mode arc vertices. */
  arcRadiusOffsetPx?: number;
}

/** Defaults until the AutoCAD calibration pins them (note 08 §5.4: raster driver ≈ 100 DPI). */
// arcStepDeg / arcRadiusOffsetPx are fitted to calibration/raster-curves (UNVERIFIED rule)
export const DEFAULT_CALIBRATION: PlotCalibration = {
  dpi: 100,
  hairlineMaxPx: 1,
  arcStepDeg: 6,
  arcRadiusOffsetPx: -0.5,
};

/**
 * View for a plot window with Fit + Center: the window is scaled uniformly to fit the canvas and
 * centred (for a window with the canvas aspect ratio this is the window itself).
 */
export function fitWindow(
  min: readonly [number, number],
  max: readonly [number, number],
  canvas: readonly [number, number],
): View {
  const [w, h] = canvas;
  const dx = Math.max(max[0] - min[0], 1e-12);
  const dy = Math.max(max[1] - min[1], 1e-12);
  const s = Math.max(dx / w, dy / h);
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  return { minX: cx - (w * s) / 2, maxX: cx + (w * s) / 2, minY: cy - (h * s) / 2, maxY: cy + (h * s) / 2 };
}

export function viewFromBounds(b: Bounds, canvas: readonly [number, number]): View {
  if (!(b.maxX >= b.minX && b.maxY >= b.minY)) return fitWindow([0, 0], [canvas[0], canvas[1]], canvas);
  return fitWindow([b.minX, b.minY], [b.maxX, b.maxY], canvas);
}

/** World units per device pixel for a view on a canvas. */
export function pixelSizeOf(view: View, canvas: readonly [number, number]): number {
  return (view.maxX - view.minX) / canvas[0];
}
