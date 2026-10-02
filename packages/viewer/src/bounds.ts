import type { DisplayList } from "@truedxf/render";
import type { Rect } from "./view.ts";

/** Display-list bounds with clipped batches limited to their clip region (see RenderResult.bounds). */
export function visibleBounds(
  list: Pick<DisplayList, "batches" | "clips">,
  batchBounds?: readonly (Rect | undefined)[],
): Rect | undefined {
  let out: Rect | undefined;
  const clipBox = new Map<number, Rect>();
  for (let bi = 0; bi < list.batches.length; bi++) {
    const b = list.batches[bi]!;
    const p = b.positions;
    // infinite XLINE/RAY extensions don't count for fitting
    if (p.length < 2 || b.unbounded) continue;
    let r = batchBounds?.[bi];
    if (!r) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let i = 0; i + 1 < p.length; i += 2) {
        const x = p[i]!;
        const y = p[i + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      r = {
        minX: minX + b.originX,
        minY: minY + b.originY,
        maxX: maxX + b.originX,
        maxY: maxY + b.originY,
      };
    }
    if (b.clip >= 0) {
      let c = clipBox.get(b.clip);
      if (!c) {
        c = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const ring of list.clips[b.clip]?.rings ?? []) {
          for (let i = 0; i + 1 < ring.length; i += 2) {
            c.minX = Math.min(c.minX, ring[i]!);
            c.maxX = Math.max(c.maxX, ring[i]!);
            c.minY = Math.min(c.minY, ring[i + 1]!);
            c.maxY = Math.max(c.maxY, ring[i + 1]!);
          }
        }
        clipBox.set(b.clip, c);
      }
      r = {
        minX: Math.max(r.minX, c.minX),
        minY: Math.max(r.minY, c.minY),
        maxX: Math.min(r.maxX, c.maxX),
        maxY: Math.min(r.maxY, c.maxY),
      };
      if (!(r.maxX >= r.minX && r.maxY >= r.minY)) continue;
    }
    out = out
      ? {
          minX: Math.min(out.minX, r.minX),
          minY: Math.min(out.minY, r.minY),
          maxX: Math.max(out.maxX, r.maxX),
          maxY: Math.max(out.maxY, r.maxY),
        }
      : r;
  }
  return out;
}
