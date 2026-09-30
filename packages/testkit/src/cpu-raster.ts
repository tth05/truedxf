/**
 * Minimal CPU rasterizer for display lists produced in `raster: "autocad"` mode, where thin
 * geometry is already emitted as single pixels and everything else is triangles. Used for fast
 * experiments and Node-only tests; the three.js renderer (in Chromium) remains the reference
 * implementation of what users see. Rules: points light the pixel containing them; triangles
 * cover pixels whose centre is inside (top-left rule for centres exactly on an edge).
 * Clip regions and Lines primitives are not supported.
 */
import type { DisplayList } from "@truedxf/render";
import type { Image } from "./metrics.ts";

export function rasterize(
  list: DisplayList,
  view: { minX: number; minY: number; maxX: number; maxY: number },
  canvas: readonly [number, number],
): Image {
  const [w, h] = canvas;
  const data = new Uint8Array(w * h * 4);
  const [br, bg, bb] = list.background;
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = br;
    data[i * 4 + 1] = bg;
    data[i * 4 + 2] = bb;
    data[i * 4 + 3] = 255;
  }
  const ps = (view.maxX - view.minX) / w;
  const put = (i: number, j: number, c: Uint8Array, k: number) => {
    if (i < 0 || j < 0 || i >= w || j >= h) return;
    const o = ((h - 1 - j) * w + i) * 4;
    data[o] = c[k]!;
    data[o + 1] = c[k + 1]!;
    data[o + 2] = c[k + 2]!;
  };
  for (const b of list.batches) {
    const pos = b.positions;
    const n = pos.length >> 1;
    const X = (k: number) => (b.originX + pos[k * 2]! - view.minX) / ps;
    const Y = (k: number) => (b.originY + pos[k * 2 + 1]! - view.minY) / ps;
    if (b.kind === 2) {
      for (let k = 0; k < n; k++) put(Math.floor(X(k)), Math.floor(Y(k)), b.colors, k * 4);
    } else if (b.kind === 0) {
      for (let k = 0; k + 2 < n; k += 3) {
        triangle(X(k), Y(k), X(k + 1), Y(k + 1), X(k + 2), Y(k + 2), (i, j) => put(i, j, b.colors, k * 4));
      }
    }
  }
  return { width: w, height: h, data };
}

function triangle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  plot: (i: number, j: number) => void,
): void {
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (area === 0) return;
  // orient counter-clockwise
  if (area < 0) {
    [x1, x2] = [x2, x1];
    [y1, y2] = [y2, y1];
  }
  const minI = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxI = Math.ceil(Math.max(x0, x1, x2));
  const minJ = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxJ = Math.ceil(Math.max(y0, y1, y2));
  const edge = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
    (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  // top-left rule for a CCW triangle in y-up coordinates: include left and top edges
  const inc = (ax: number, ay: number, bx: number, by: number) => (ay === by ? bx < ax : by < ay);
  const t0 = inc(x1, y1, x2, y2);
  const t1 = inc(x2, y2, x0, y0);
  const t2 = inc(x0, y0, x1, y1);
  for (let j = minJ; j <= maxJ; j++) {
    const py = j + 0.5;
    for (let i = minI; i <= maxI; i++) {
      const px = i + 0.5;
      const w0 = edge(x1, y1, x2, y2, px, py);
      const w1 = edge(x2, y2, x0, y0, px, py);
      const w2 = edge(x0, y0, x1, y1, px, py);
      if ((w0 > 0 || (w0 === 0 && t0)) && (w1 > 0 || (w1 === 0 && t1)) && (w2 > 0 || (w2 === 0 && t2)))
        plot(i, j);
    }
  }
}
