/**
 * Minimal CPU rasterizer for display lists produced in `raster: "autocad"` mode, where thin
 * geometry is already emitted as single pixels and everything else is triangles. Used for fast
 * experiments and Node-only tests; the three.js renderer (in Chromium) remains the reference
 * implementation of what users see. Rules: points light the pixel containing them; triangles
 * cover pixels whose centre is inside (top-left rule for centres exactly on an edge).
 * Clip regions (display-list `clips`) keep pixels whose centre is inside the region (even-odd),
 * like the three.js stencil clip. Image triangles sample their texture nearest at the pixel
 * centre. Colours with alpha < 255 blend as AutoCAD's plot does:
 * out = (src·a + dst·(256 − a)) >> 8 (VERIFIED-BY-ACAD, note 06 §4.2). Lines primitives are not
 * supported.
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
  const masks = new Map<number, Uint8Array>();
  let mask: Uint8Array | undefined;
  const blend = (i: number, j: number, r: number, g: number, b: number, a: number) => {
    if (i < 0 || j < 0 || i >= w || j >= h || a <= 0) return;
    if (mask && !mask[j * w + i]) return;
    const o = ((h - 1 - j) * w + i) * 4;
    if (a >= 255) {
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      return;
    }
    data[o] = (r * a + data[o]! * (256 - a)) >> 8;
    data[o + 1] = (g * a + data[o + 1]! * (256 - a)) >> 8;
    data[o + 2] = (b * a + data[o + 2]! * (256 - a)) >> 8;
  };
  const put = (i: number, j: number, c: Uint8Array, k: number) =>
    blend(i, j, c[k]!, c[k + 1]!, c[k + 2]!, c[k + 3]!);
  for (const b of list.batches) {
    mask = undefined;
    if (b.clip >= 0) {
      mask = masks.get(b.clip);
      if (!mask) {
        const region = list.clips[b.clip];
        mask = clipMask(
          region ? region.rings : [],
          (x) => (x - view.minX) / ps,
          (y) => (y - view.minY) / ps,
          w,
          h,
        );
        masks.set(b.clip, mask);
      }
    }
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
    } else if (b.kind === 3 && b.uvs && b.image !== undefined) {
      const img = list.images[b.image]!;
      const uv = b.uvs;
      const c = b.colors;
      for (let k = 0; k + 2 < n; k += 3) {
        const x0 = X(k);
        const y0 = Y(k);
        const x1 = X(k + 1);
        const y1 = Y(k + 1);
        const x2 = X(k + 2);
        const y2 = Y(k + 2);
        const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (d === 0) continue;
        triangle(x0, y0, x1, y1, x2, y2, (i, j) => {
          const px = i + 0.5;
          const py = j + 0.5;
          const l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / d;
          const l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / d;
          const l2 = 1 - l0 - l1;
          const u = l0 * uv[k * 2]! + l1 * uv[k * 2 + 2]! + l2 * uv[k * 2 + 4]!;
          const v = l0 * uv[k * 2 + 1]! + l1 * uv[k * 2 + 3]! + l2 * uv[k * 2 + 5]!;
          const tx = Math.min(img.width - 1, Math.max(0, Math.floor(u * img.width)));
          const ty = Math.min(img.height - 1, Math.max(0, Math.floor(v * img.height)));
          const o = (ty * img.width + tx) * 4;
          const q = k * 4;
          blend(
            i,
            j,
            Math.round((img.pixels[o]! * c[q]!) / 255),
            Math.round((img.pixels[o + 1]! * c[q + 1]!) / 255),
            Math.round((img.pixels[o + 2]! * c[q + 2]!) / 255),
            Math.round((img.pixels[o + 3]! * c[q + 3]!) / 255),
          );
        });
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

/** Pixels (row j from the bottom) whose centre lies inside the rings (even-odd). */
export function clipMask(
  rings: readonly Float64Array[],
  toU: (x: number) => number,
  toV: (y: number) => number,
  w: number,
  h: number,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const edges: number[] = [];
  for (const r of rings) {
    const n = r.length >> 1;
    for (let k = 0; k < n; k++) {
      const q = (k + 1) % n;
      edges.push(toU(r[k * 2]!), toV(r[k * 2 + 1]!), toU(r[q * 2]!), toV(r[q * 2 + 1]!));
    }
  }
  const xs: number[] = [];
  for (let j = 0; j < h; j++) {
    const py = j + 0.5;
    xs.length = 0;
    for (let e = 0; e < edges.length; e += 4) {
      const y0 = edges[e + 1]!;
      const y1 = edges[e + 3]!;
      // half-open rule: an edge covers py in [min, max)
      if (py < Math.min(y0, y1) || py >= Math.max(y0, y1)) continue;
      const x0 = edges[e]!;
      const x1 = edges[e + 2]!;
      xs.push(x0 + ((py - y0) / (y1 - y0)) * (x1 - x0));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // centre i + 0.5 in [xa, xb)
      const i0 = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const i1 = Math.min(w - 1, Math.ceil(xs[k + 1]! - 0.5) - 1);
      for (let i = i0; i <= i1; i++) mask[j * w + i] = 1;
    }
  }
  return mask;
}
