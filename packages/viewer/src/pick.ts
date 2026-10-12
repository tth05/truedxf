/**
 * Picking over a display list (our own spatial index, not the three.js
 * raycaster). Every pick range (batch, first vertex, vertex count, entity) becomes an item of a
 * flatbush index over its bounding box; a query tests the candidate primitives exactly.
 *
 * The index and original positions stay where the list is built (the worker).
 */
import type { ClipRegion, DisplayList } from "@truedxf/render";
import Flatbush from "flatbush";
import type { Rect } from "./view.ts";

/** PrimitiveKind values of @truedxf/render (a type-only import keeps the pipeline out of the main bundle). */
export const Kind = { Triangles: 0, Lines: 1, Points: 2, Image: 3 } as const;

/** Flatbush construction data of one display list, retained by the backend. */
export interface PickData {
    /** Flatbush buffer (undefined when the list has no pick ranges). */
    index: ArrayBuffer | undefined;
    /** 4 per item: batch, first vertex, vertex count, entity index. */
    items: Uint32Array;
}

/** The parts of a batch picking or requested highlight geometry needs. */
export interface PickBatch {
    readonly kind: number;
    readonly originX: number;
    readonly originY: number;
    readonly positions: Float32Array;
    /** Index into the list's clip regions, -1 (or absent) for none. */
    readonly clip?: number;
}

export interface PickHit {
    /** Index into DisplayList.entities. */
    entity: number;
    /** Entity handle (or "#id"). */
    handle: string;
    /** World distance from the query point (0 inside a filled area). */
    distance: number;
}

export interface PickRange {
    batch: number;
    first: number;
    count: number;
}

export function buildPickData(
    list: Pick<DisplayList, "batches">,
    batchBounds?: (Rect | undefined)[],
): PickData {
    let n = 0;
    for (const b of list.batches) n += b.pick.length / 3;
    const items = new Uint32Array(n * 4);
    if (n === 0) return { index: undefined, items };
    const fb = new Flatbush(n);
    let k = 0;
    list.batches.forEach((b, bi) => {
        const p = b.positions;
        let covered = 0;
        let batchMinX = Infinity;
        let batchMinY = Infinity;
        let batchMaxX = -Infinity;
        let batchMaxY = -Infinity;
        for (let r = 0; r + 2 < b.pick.length; r += 3) {
            const first = b.pick[r]!;
            const count = b.pick[r + 1]!;
            let minX = Number.POSITIVE_INFINITY;
            let minY = Number.POSITIVE_INFINITY;
            let maxX = Number.NEGATIVE_INFINITY;
            let maxY = Number.NEGATIVE_INFINITY;
            for (let v = first; v < first + count; v++) {
                const x = p[v * 2]!;
                const y = p[v * 2 + 1]!;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
            if (batchBounds) {
                // Reuse relative float32 bounds before adding the origin, exactly as visibleBounds
                // does. Only contiguous, complete pick coverage can replace its vertex scan.
                covered = first === covered ? first + count : -1;
                if (minX < batchMinX) batchMinX = minX;
                if (minY < batchMinY) batchMinY = minY;
                if (maxX > batchMaxX) batchMaxX = maxX;
                if (maxY > batchMaxY) batchMaxY = maxY;
            }
            if (!(maxX >= minX)) minX = maxX = minY = maxY = 0;
            fb.add(minX + b.originX, minY + b.originY, maxX + b.originX, maxY + b.originY);
            items[k * 4] = bi;
            items[k * 4 + 1] = first;
            items[k * 4 + 2] = count;
            items[k * 4 + 3] = b.pick[r + 2]!;
            k++;
        }
        if (batchBounds && covered === p.length / 2 && p.length > 0) {
            batchBounds[bi] = {
                minX: batchMinX + b.originX,
                minY: batchMinY + b.originY,
                maxX: batchMaxX + b.originX,
                maxY: batchMaxY + b.originY,
            };
        }
    });
    fb.finish();
    return { index: fb.data as ArrayBuffer, items };
}

export class PickIndex {
    private readonly batches: readonly PickBatch[];
    private readonly entities: readonly string[];
    private readonly items: Uint32Array;
    private readonly index: Flatbush | undefined;
    private readonly clips: readonly ClipRegion[];
    private byHandle: Map<string, PickRange[]> | undefined;

    constructor(
        batches: readonly PickBatch[],
        entities: readonly string[],
        data: PickData,
        clips: readonly ClipRegion[] = [],
    ) {
        this.batches = batches;
        this.entities = entities;
        this.items = data.items;
        this.index = data.index ? Flatbush.from(data.index) : undefined;
        this.clips = clips;
    }

    get size(): number {
        return this.items.length / 4;
    }

    /**
     * The entity at world point (x, y) within `tolerance` world units. Strokes and near misses
     * (distance > 0) win over filled areas containing the point, the nearest first, so lines stay
     * pickable on top of hatches; among areas containing the point the topmost (last drawn) wins.
     * Clipped geometry is only pickable inside its clip region (viewport content).
     */
    pick(x: number, y: number, tolerance: number): PickHit | undefined {
        if (!this.index) return undefined;
        const ids = this.index.search(x - tolerance, y - tolerance, x + tolerance, y + tolerance);
        let best: { d: number; area: boolean; order: number; entity: number } | undefined;
        for (const id of ids) {
            const bi = this.items[id * 4]!;
            const b = this.batches[bi]!;
            const clip = b.clip !== undefined && b.clip >= 0 ? this.clips[b.clip] : undefined;
            if (clip && !insideRings(clip.rings, x, y)) continue;
            const d = rangeDistance(
                b,
                this.items[id * 4 + 1]!,
                this.items[id * 4 + 2]!,
                x - b.originX,
                y - b.originY,
                tolerance,
            );
            if (d > tolerance) continue;
            const area = d === 0 && (b.kind === Kind.Triangles || b.kind === Kind.Image);
            const cand = { d, area, order: id, entity: this.items[id * 4 + 3]! };
            if (!best || better(cand, best)) best = cand;
        }
        if (!best) return undefined;
        return { entity: best.entity, handle: this.entities[best.entity] ?? "", distance: best.d };
    }

    /**
     * The pick ranges of an entity (for highlighting): of every list entity with that handle, as
     * an entity may occur more than once (model space drawn in several viewports).
     */
    ranges(handle: string): readonly PickRange[] {
        if (!this.byHandle) {
            const m = new Map<string, PickRange[]>();
            for (let k = 0; k < this.items.length; k += 4) {
                const h = this.entities[this.items[k + 3]!] ?? "";
                let a = m.get(h);
                if (!a) m.set(h, (a = []));
                a.push({ batch: this.items[k]!, first: this.items[k + 1]!, count: this.items[k + 2]! });
            }
            this.byHandle = m;
        }
        return this.byHandle.get(handle) ?? [];
    }

    /** World bounds of an entity's pick ranges (what highlighting draws), or undefined. */
    bounds(handle: string): Rect | undefined {
        let r: Rect | undefined;
        for (const { batch, first, count } of this.ranges(handle)) {
            const b = this.batches[batch];
            if (!b) continue;
            const p = b.positions;
            for (let i = first * 2; i < (first + count) * 2; i += 2) {
                const x = p[i]! + b.originX;
                const y = p[i + 1]! + b.originY;
                if (!r) r = { minX: x, minY: y, maxX: x, maxY: y };
                else {
                    if (x < r.minX) r.minX = x;
                    if (y < r.minY) r.minY = y;
                    if (x > r.maxX) r.maxX = x;
                    if (y > r.maxY) r.maxY = y;
                }
            }
        }
        return r;
    }
}

function better(
    a: { d: number; area: boolean; order: number },
    b: { d: number; area: boolean; order: number },
): boolean {
    if (a.area !== b.area) return !a.area;
    if (a.area) return a.order > b.order;
    if (a.d !== b.d) return a.d < b.d;
    return a.order > b.order;
}

/** Distance from local point (x, y) to the primitives of a range (early exit at 0). */
export function rangeDistance(
    b: PickBatch,
    first: number,
    count: number,
    x: number,
    y: number,
    tolerance: number,
): number {
    const p = b.positions;
    let best = Number.POSITIVE_INFINITY;
    const end = first + count;
    if (b.kind === Kind.Lines) {
        for (let v = first; v + 1 < end; v += 2) {
            const d = segDist(x, y, p[v * 2]!, p[v * 2 + 1]!, p[v * 2 + 2]!, p[v * 2 + 3]!);
            if (d < best) best = d;
        }
    } else if (b.kind === Kind.Points) {
        for (let v = first; v < end; v++) {
            const d = Math.hypot(x - p[v * 2]!, y - p[v * 2 + 1]!);
            if (d < best) best = d;
        }
    } else {
        for (let v = first; v + 2 < end; v += 3) {
            const ax = p[v * 2]!;
            const ay = p[v * 2 + 1]!;
            const bx = p[v * 2 + 2]!;
            const by = p[v * 2 + 3]!;
            const cx = p[v * 2 + 4]!;
            const cy = p[v * 2 + 5]!;
            const minX = Math.min(ax, bx, cx);
            const maxX = Math.max(ax, bx, cx);
            const minY = Math.min(ay, by, cy);
            const maxY = Math.max(ay, by, cy);
            if (x < minX - tolerance || x > maxX + tolerance || y < minY - tolerance || y > maxY + tolerance)
                continue;
            // the bbox test also keeps degenerate (collinear) triangles from matching their whole line
            if (x >= minX && x <= maxX && y >= minY && y <= maxY && inTriangle(x, y, ax, ay, bx, by, cx, cy))
                return 0;
            const d = Math.min(
                segDist(x, y, ax, ay, bx, by),
                segDist(x, y, bx, by, cx, cy),
                segDist(x, y, cx, cy, ax, ay),
            );
            if (d < best) best = d;
        }
    }
    return best;
}

/** Point in polygon rings, even-odd (clip regions). */
export function insideRings(rings: readonly Float64Array[], x: number, y: number): boolean {
    let inside = false;
    for (const r of rings) {
        for (let i = 0, j = r.length - 2; i + 1 < r.length; j = i, i += 2) {
            const yi = r[i + 1]!;
            const yj = r[j + 1]!;
            if (yi > y !== yj > y && x < ((r[j]! - r[i]!) * (y - yi)) / (yj - yi) + r[i]!) inside = !inside;
        }
    }
    return inside;
}

export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inTriangle(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
): boolean {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
}
