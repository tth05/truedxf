import type { Batch, DisplayList } from "@truedxf/render";

// About four depth-buffer units per order; at least three after float32 projection rounding.
export const MAX_DEPTH_ORDERS = 4_000_000;
const MAX_VERTICES = 4_000_000;

/** Pick ranges and the gaps between them, in vertex/draw order. */
export function orderRanges(batch: Batch, visit: (first: number, count: number) => void): void {
    let end = 0;
    for (let i = 0; i < batch.pick.length; i += 3) {
        const first = batch.pick[i]!;
        const count = batch.pick[i + 1]!;
        if (first > end) visit(end, first - end);
        if (count > 0) visit(first, count);
        end = first + count;
    }
    const n = batch.positions.length / 2;
    if (end < n) visit(end, n - end);
}

export function orderCount(list: DisplayList): number {
    let n = 0;
    for (const batch of list.batches) orderRanges(batch, () => n++);
    return n;
}

export function orderZ(index: number, total: number): number {
    // Orthographic near=-1/far=1: positive world z becomes smaller (nearer) depth.
    return -0.999 + (1.998 * (index + 1)) / (total + 1);
}

export interface MergedPart {
    kind: Batch["kind"];
    positions: Float32Array;
    colors: Uint8Array;
    /** Present for individual alpha/image batches. */
    individual?: boolean;
    uvs?: Float32Array;
    image?: number;
}

export interface MergedGroup {
    clip: number;
    originX: number;
    originY: number;
    parts: MergedPart[];
}

/** Worker-built GPU buffers. No original batch positions or pick ranges cross this seam. */
export interface MergedDisplayList extends Omit<DisplayList, "batches"> {
    groups: MergedGroup[];
}

function opaque(batch: Batch): boolean {
    if (batch.kind === 3) return false;
    for (let i = 3; i < batch.colors.length; i += 4) if (batch.colors[i]! < 255) return false;
    return true;
}

/** Build one clip run at a time so temporary CPU memory stays bounded by the run. */
export function* mergedGroups(list: DisplayList, total: number): Generator<MergedGroup> {
    let order = 0;
    for (let start = 0; start < list.batches.length; ) {
        const clip = list.batches[start]!.clip;
        let end = start;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const counts = [0, 0, 0];
        const isOpaque: boolean[] = [];
        while (end < list.batches.length && list.batches[end]!.clip === clip) {
            const b = list.batches[end]!;
            const yes = opaque(b);
            isOpaque.push(yes);
            if (yes) counts[b.kind]! += b.positions.length / 2;
            for (let v = 0; v < b.positions.length; v += 2) {
                const x = b.originX + b.positions[v]!;
                const y = b.originY + b.positions[v + 1]!;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
            end++;
        }
        const originX = Number.isFinite(minX) ? minX + (maxX - minX) / 2 : 0;
        const originY = Number.isFinite(minY) ? minY + (maxY - minY) / 2 : 0;
        const parts: MergedPart[] = [];
        const byKind: MergedPart[][] = [[], [], []];
        for (let kind = 0; kind < 3; kind++) {
            // Never split a triangle/line at a buffer boundary.
            const stride = kind === 0 ? 3 : kind === 1 ? 2 : 1;
            const limit = MAX_VERTICES - (MAX_VERTICES % stride);
            for (let left = counts[kind]!; left > 0; ) {
                const n = Math.min(left, limit);
                const part: MergedPart = {
                    kind: kind as Batch["kind"],
                    positions: new Float32Array(n * 3),
                    colors: new Uint8Array(n * 4),
                };
                byKind[kind]!.push(part);
                parts.push(part);
                left -= n;
            }
        }
        const chunks = [0, 0, 0];
        const offsets = [0, 0, 0];
        for (let i = start; i < end; i++) {
            const b = list.batches[i]!;
            const yes = isOpaque[i - start]!;
            const individual: MergedPart | undefined = yes
                ? undefined
                : {
                      kind: b.kind,
                      positions: new Float32Array((b.positions.length / 2) * 3),
                      colors: b.colors.slice(),
                      individual: true,
                      uvs: b.uvs?.slice(),
                      image: b.image,
                  };
            if (individual) parts.push(individual);
            orderRanges(b, (first, count) => {
                const z = orderZ(order++, total);
                for (let v = first; v < first + count; v++) {
                    const part = individual ?? byKind[b.kind]![chunks[b.kind]!]!;
                    const offset = individual ? v : offsets[b.kind]!;
                    part.positions[offset * 3] = b.originX + b.positions[v * 2]! - originX;
                    part.positions[offset * 3 + 1] = b.originY + b.positions[v * 2 + 1]! - originY;
                    part.positions[offset * 3 + 2] = z;
                    if (!individual) {
                        for (let c = 0; c < 4; c++) part.colors[offset * 4 + c] = b.colors[v * 4 + c]!;
                        offsets[b.kind]!++;
                        if (offsets[b.kind]! * 3 === part.positions.length) {
                            chunks[b.kind]!++;
                            offsets[b.kind] = 0;
                        }
                    }
                }
            });
        }
        yield { clip, originX, originY, parts };
        start = end;
    }
}
