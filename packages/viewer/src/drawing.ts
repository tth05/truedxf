/** Worker-owned list and spatial index; only upload buffers and requested highlights leave it. */
import type { DisplayList } from "@truedxf/render";
import { MAX_DEPTH_ORDERS, type MergedDisplayList, mergedGroups, orderCount } from "@truedxf/three/merge";
import { buildPickData, type PickBatch, type PickHit, PickIndex } from "./pick.ts";
import type { Rect } from "./view.ts";

export interface EntityGeometry {
  parts: PickBatch[];
  bounds: Rect | undefined;
}

export interface DrawingUpload {
  list: DisplayList;
  merged?: MergedDisplayList;
  stats: { batches: number; vertices: number };
}

export class DrawingState {
  readonly list: DisplayList;
  private readonly index: PickIndex;

  constructor(list: DisplayList) {
    this.list = list;
    this.index = new PickIndex(list.batches, list.entities, buildPickData(list), list.clips);
  }

  pick(x: number, y: number, tolerance: number): PickHit | undefined {
    return this.index.pick(x, y, tolerance);
  }

  geometry(entity: string | number): EntityGeometry {
    const handle = typeof entity === "number" ? this.list.entities[entity] : entity;
    const parts: PickBatch[] = [];
    if (handle === undefined) return { parts, bounds: undefined };
    for (const r of this.index.ranges(handle)) {
      const b = this.list.batches[r.batch]!;
      parts.push({
        kind: b.kind,
        originX: b.originX,
        originY: b.originY,
        clip: b.clip,
        positions: b.positions.slice(r.first * 2, (r.first + r.count) * 2),
      });
    }
    return { parts, bounds: this.index.bounds(handle) };
  }
}

export function drawingUpload(list: DisplayList, merge: boolean): DrawingUpload {
  // The worker retains the originals for exact picking. Transfer only independent buffers,
  // including clip rings: moving an original would silently corrupt subsequent queries.
  const meta = {
    ...list,
    clips: list.clips.map((c) => ({ ...c, rings: c.rings.map((r) => r.slice()) })),
    batches: [],
  };
  const stats = {
    batches: list.batches.length,
    vertices: list.batches.reduce((n, b) => n + b.positions.length / 2, 0),
  };
  const count = merge ? orderCount(list) : 0;
  if (merge && count <= MAX_DEPTH_ORDERS) {
    const { batches: _batches, ...metadata } = meta;
    return { list: meta, merged: { ...metadata, groups: [...mergedGroups(list, count)] }, stats };
  }
  return {
    list: {
      ...meta,
      batches: list.batches.map((b) => ({
        ...b,
        positions: b.positions.slice(),
        colors: b.colors.slice(),
        pick: b.pick.slice(),
        uvs: b.uvs?.slice(),
      })),
    },
    stats,
  };
}
