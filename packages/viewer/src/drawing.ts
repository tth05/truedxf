/** Worker-owned list and spatial index; only upload buffers and requested highlights leave it. */
import type { DisplayList } from "@truedxf/render";
import { MAX_DEPTH_ORDERS, type MergedDisplayList, mergedGroups, orderCount } from "@truedxf/three/merge";
import Flatbush from "flatbush";
import { visibleBounds } from "./bounds.ts";
import { buildPickData, insideRings, type PickBatch, type PickHit, PickIndex } from "./pick.ts";
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
  readonly bounds: Rect | undefined;
  private readonly index: PickIndex;

  constructor(list: DisplayList) {
    this.list = list;
    const batchBounds: (Rect | undefined)[] = [];
    const data = buildPickData(list, batchBounds);
    this.bounds = visibleBounds(list, batchBounds);
    this.index = new PickIndex(list.batches, list.entities, data, list.clips);
  }

  pick(x: number, y: number, tolerance: number): PickHit | undefined {
    return this.index.pick(x, y, tolerance);
  }

  /** Index over the list's snap points, built on the first snap request (measuring only). */
  private snapIndex: Flatbush | null | undefined;

  /** The snap point nearest to (x, y) within `tolerance` (world units), if any. */
  snap(x: number, y: number, tolerance: number): { x: number; y: number; kind: number } | undefined {
    const a = this.list.annotations;
    if (!a || a.snapKinds.length === 0) return undefined;
    if (this.snapIndex === undefined) {
      const fb = new Flatbush(a.snapKinds.length);
      for (let i = 0; i < a.snapKinds.length; i++) {
        const px = a.snapXY[i * 2]!;
        const py = a.snapXY[i * 2 + 1]!;
        fb.add(px, py, px, py);
      }
      fb.finish();
      this.snapIndex = fb;
    }
    const clips = this.list.clips;
    const [i] = this.snapIndex!.neighbors(x, y, 1, tolerance, (k) => {
      const c = a.snapClips[k]!;
      // viewport content snaps only inside its viewport
      return c < 0 || !clips[c] || insideRings(clips[c].rings, a.snapXY[k * 2]!, a.snapXY[k * 2 + 1]!);
    });
    if (i === undefined) return undefined;
    return { x: a.snapXY[i * 2]!, y: a.snapXY[i * 2 + 1]!, kind: a.snapKinds[i]! };
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
  // Annotations (texts, snap points) are answered in the worker and stay there.
  const { annotations: _annotations, ...rest } = list;
  const meta = {
    ...rest,
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
