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
  /**
   * Registry-only system variables in effect for the plot (not stored in the DXF), e.g.
   * LWDEFAULT in 1/100 mm (note 06 §5.1). Fixture contract: meta.plot.sysvars.
   */
  sysvars?: Readonly<Record<string, number | string>>;
  /**
   * Layouts: answer to -PLOT "Plot paper space first?". false (default, AutoCAD's default answer
   * for layouts with PLOTSETTINGS 70 bit 512): viewport content first, paper-space entities on
   * top; true: paper space first, viewport content on top (note 08 §3.10, VERIFIED-BY-ACAD).
   */
  paperSpaceFirst?: boolean;
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
}

/** The raster driver works at a fixed 100 dpi (note 08 §10.4). Curve rules: raster.ts. */
export const DEFAULT_CALIBRATION: PlotCalibration = {
  dpi: 100,
  hairlineMaxPx: 1,
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
  const v = fitWindow([b.minX, b.minY], [b.maxX, b.maxY], canvas);
  // The axis that sets the scale spans exactly the bounds: centre ± half-size can miss the bounds
  // by an ulp, which moves geometry on the extents edge just outside the canvas (t = 0 must map
  // to pixel 0, note 08 §10; fileformat/corpus-ezdxf-3dface lost its bottom edge line).
  const dx = b.maxX - b.minX;
  const dy = b.maxY - b.minY;
  if (dx > 0 && dx / canvas[0] >= dy / canvas[1]) return { ...v, minX: b.minX, maxX: b.maxX };
  if (dy > 0 && dy / canvas[1] >= dx / canvas[0]) return { ...v, minY: b.minY, maxY: b.maxY };
  return v;
}

/** World units per device pixel for a view on a canvas. */
export function pixelSizeOf(view: View, canvas: readonly [number, number]): number {
  return (view.maxX - view.minX) / canvas[0];
}
