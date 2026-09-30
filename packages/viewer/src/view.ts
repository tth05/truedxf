/**
 * View math (no DOM): a 2D orthographic view given by its centre (float64 world coordinates) and
 * scale (world units per CSS pixel), shown on a canvas of `width` × `height` CSS pixels.
 * Screen coordinates are CSS pixels from the top-left corner, y down; world y is up.
 */

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ViewState {
  cx: number;
  cy: number;
  /** World units per CSS pixel (> 0). */
  scale: number;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
}

export function viewRect(v: ViewState): Rect {
  const hw = (v.width * v.scale) / 2;
  const hh = (v.height * v.scale) / 2;
  return { minX: v.cx - hw, minY: v.cy - hh, maxX: v.cx + hw, maxY: v.cy + hh };
}

export function screenToWorld(v: ViewState, x: number, y: number): [number, number] {
  return [v.cx + (x - v.width / 2) * v.scale, v.cy - (y - v.height / 2) * v.scale];
}

export function worldToScreen(v: ViewState, wx: number, wy: number): [number, number] {
  return [(wx - v.cx) / v.scale + v.width / 2, v.height / 2 - (wy - v.cy) / v.scale];
}

/** Fits a world rectangle into the canvas with a relative margin on each side. */
export function fitRect(r: Rect, width: number, height: number, margin = 0.04): ViewState {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  let dx = r.maxX - r.minX;
  let dy = r.maxY - r.minY;
  if (!(dx >= 0 && dy >= 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) {
    return { cx: 0, cy: 0, scale: 1, width: w, height: h };
  }
  if (dx === 0 && dy === 0) dx = dy = 1;
  const scale = Math.max(dx / w, dy / h) * (1 + 2 * margin) || 1;
  return { cx: (r.minX + r.maxX) / 2, cy: (r.minY + r.maxY) / 2, scale, width: w, height: h };
}

/** Zooms by `factor` (> 1 = zoom in) keeping the world point under screen (x, y) fixed. */
export function zoomAt(v: ViewState, x: number, y: number, factor: number): ViewState {
  const [wx, wy] = screenToWorld(v, x, y);
  const scale = v.scale / factor;
  // the world point stays under the cursor: wx = cx' + (x - w/2)·scale'
  return {
    ...v,
    scale,
    cx: wx - (x - v.width / 2) * scale,
    cy: wy + (y - v.height / 2) * scale,
  };
}

/** Pans by a screen-space delta in CSS pixels (content follows the pointer). */
export function panBy(v: ViewState, dx: number, dy: number): ViewState {
  return { ...v, cx: v.cx - dx * v.scale, cy: v.cy + dy * v.scale };
}

/** Resizes the canvas keeping the centre and scale. */
export function resize(v: ViewState, width: number, height: number): ViewState {
  return { ...v, width: Math.max(width, 1), height: Math.max(height, 1) };
}

export function unionRect(a: Rect | undefined, b: Rect | undefined): Rect | undefined {
  if (!a || !isValidRect(a)) return b && isValidRect(b) ? { ...b } : undefined;
  if (!b || !isValidRect(b)) return { ...a };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function isValidRect(r: Rect): boolean {
  return (
    Number.isFinite(r.minX) &&
    Number.isFinite(r.minY) &&
    Number.isFinite(r.maxX) &&
    Number.isFinite(r.maxY) &&
    r.maxX >= r.minX &&
    r.maxY >= r.minY
  );
}
