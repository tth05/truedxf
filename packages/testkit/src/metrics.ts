/**
 * Image comparison metrics between our render (A) and the AutoCAD reference (B), both RGBA with
 * the same size. docs/PLAN.md §7.
 *
 * - exact: pixels whose RGB differs at all (no tolerance).
 * - tolerant(r): an ink pixel (≠ background) of A is matched if B has an ink pixel within
 *   Chebyshev distance r whose channels differ by at most `channelTolerance`, and vice versa
 *   → recall / precision / F1.
 */

export interface Image {
  width: number;
  height: number;
  /** RGBA, top row first. */
  data: Uint8Array;
}

export interface Metrics {
  width: number;
  height: number;
  exactMismatch: number;
  inkA: number;
  inkB: number;
  /** F1 of the tolerant match for r = 0, 1, 2. */
  f1: [number, number, number];
  recall: [number, number, number];
  precision: [number, number, number];
}

const BG = [255, 255, 255];

function isInk(d: Uint8Array, i: number, bg: readonly number[]): boolean {
  return d[i] !== bg[0] || d[i + 1] !== bg[1] || d[i + 2] !== bg[2];
}

function similar(a: Uint8Array, i: number, b: Uint8Array, j: number, tol: number): boolean {
  return (
    Math.abs(a[i]! - b[j]!) <= tol &&
    Math.abs(a[i + 1]! - b[j + 1]!) <= tol &&
    Math.abs(a[i + 2]! - b[j + 2]!) <= tol
  );
}

/** Fraction of ink pixels of `a` that have a similar ink pixel in `b` within radius r. */
function matchRate(a: Image, b: Image, r: number, tol: number, bg: readonly number[]): [number, number] {
  const { width: w, height: h } = a;
  let ink = 0;
  let matched = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!isInk(a.data, i, bg)) continue;
      ink++;
      let found = false;
      for (let dy = -r; dy <= r && !found; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = (yy * w + xx) * 4;
          if (isInk(b.data, j, bg) && similar(a.data, i, b.data, j, tol)) {
            found = true;
            break;
          }
        }
      }
      if (found) matched++;
    }
  }
  return [ink, matched];
}

export function compare(
  a: Image,
  b: Image,
  options: { channelTolerance?: number; background?: readonly number[] } = {},
): Metrics {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  }
  const tol = options.channelTolerance ?? 8;
  const bg = options.background ?? BG;
  let exactMismatch = 0;
  for (let i = 0; i < a.data.length; i += 4) if (!similar(a.data, i, b.data, i, 0)) exactMismatch++;
  const f1: [number, number, number] = [0, 0, 0];
  const recall: [number, number, number] = [0, 0, 0];
  const precision: [number, number, number] = [0, 0, 0];
  let inkA = 0;
  let inkB = 0;
  for (let r = 0; r <= 2; r++) {
    const [na, ma] = matchRate(a, b, r, tol, bg);
    const [nb, mb] = matchRate(b, a, r, tol, bg);
    inkA = na;
    inkB = nb;
    // precision: how much of what we drew is right; recall: how much of AutoCAD's ink we drew
    precision[r] = na === 0 ? (nb === 0 ? 1 : 0) : ma / na;
    recall[r] = nb === 0 ? (na === 0 ? 1 : 0) : mb / nb;
    const p = precision[r]!;
    const q = recall[r]!;
    f1[r] = p + q === 0 ? 0 : (2 * p * q) / (p + q);
  }
  return { width: a.width, height: a.height, exactMismatch, inkA, inkB, f1, recall, precision };
}

/**
 * Diff visualisation: white background, AutoCAD-only ink in red, our-only ink in blue, matching
 * ink in light grey (exact) or dark grey (colour differs).
 */
export function diffImage(a: Image, b: Image, bg: readonly number[] = BG): Image {
  const out = new Uint8Array(a.data.length);
  for (let i = 0; i < a.data.length; i += 4) {
    const ia = isInk(a.data, i, bg);
    const ib = isInk(b.data, i, bg);
    let c: [number, number, number];
    if (ia && ib) c = similar(a.data, i, b.data, i, 0) ? [200, 200, 200] : [90, 90, 90];
    else if (ib) c = [230, 30, 30];
    else if (ia) c = [30, 80, 230];
    else c = [255, 255, 255];
    out[i] = c[0];
    out[i + 1] = c[1];
    out[i + 2] = c[2];
    out[i + 3] = 255;
  }
  return { width: a.width, height: a.height, data: out };
}
