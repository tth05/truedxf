import type { Batch, DisplayList } from "@truedxf/render";
import { describe, expect, it } from "vitest";
import { MAX_DEPTH_ORDERS, mergedGroups, orderCount, orderRanges, orderZ } from "../src/merge.ts";

function batch(kind: Batch["kind"], count: number, clip = -1, alpha = 255): Batch {
    return {
        kind,
        clip,
        originX: 1e9,
        originY: -1e9,
        positions: Float32Array.from({ length: count * 2 }, (_, i) => i),
        colors: new Uint8Array(count * 4).fill(alpha),
        pick: new Uint32Array(),
    };
}

function list(batches: Batch[]): DisplayList {
    return {
        batches,
        clips: [],
        images: [],
        entities: [],
        pixelSize: 1,
        background: [0, 0, 0],
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    };
}

describe("depth-ordered merging", () => {
    it("orders uncovered prefixes, gaps and suffixes separately from pick ranges", () => {
        const b = { ...batch(2, 10), pick: new Uint32Array([2, 2, 0, 6, 2, 1]) };
        const ranges: number[][] = [];
        orderRanges(b, (first, count) => ranges.push([first, count]));
        expect(ranges).toEqual([
            [0, 2],
            [2, 2],
            [4, 2],
            [6, 2],
            [8, 2],
        ]);
        expect(orderCount(list([b, batch(2, 1)]))).toBe(6);
    });

    it("has distinct 24-bit depths for every one of four million orders", () => {
        let previous = 2 ** 24;
        let minimumGap = Infinity;
        for (let i = 0; i < MAX_DEPTH_ORDERS; i++) {
            // Model float32 vertex storage and GPU clip-to-window depth conversion.
            const z = Math.fround(orderZ(i, MAX_DEPTH_ORDERS));
            const depth = Math.round(Math.fround(Math.fround(-z * 0.5) + 0.5) * (2 ** 24 - 1));
            minimumGap = Math.min(minimumGap, previous - depth);
            previous = depth;
        }
        expect(minimumGap).toBeGreaterThanOrEqual(3);
        expect(orderZ(0, MAX_DEPTH_ORDERS)).toBeGreaterThan(-1);
        expect(orderZ(MAX_DEPTH_ORDERS - 1, MAX_DEPTH_ORDERS)).toBeLessThan(1);
    });

    it("merges kind switches, retains alpha/images, and assigns order globally across clip runs", () => {
        const input = list([
            batch(1, 2),
            batch(0, 3),
            batch(1, 2),
            batch(0, 3, -1, 128),
            batch(3, 3),
            batch(2, 1, 0),
            batch(1, 2),
        ]);
        const groups = [...mergedGroups(input, orderCount(input))];
        expect(groups.map((g) => g.clip)).toEqual([-1, 0, -1]);
        expect(groups[0]!.parts.map((p) => [p.kind, p.positions.length / 3, !!p.individual])).toEqual([
            [0, 3, false],
            [1, 4, false],
            [0, 3, true],
            [3, 3, true],
        ]);
        const lines = groups[0]!.parts[1]!;
        expect(lines.positions[2]).toBeLessThan(groups[0]!.parts[0]!.positions[2]!);
        expect(lines.positions[8]).toBeGreaterThan(groups[0]!.parts[0]!.positions[2]!);
        expect(groups[2]!.parts[0]!.positions[2]).toBeGreaterThan(groups[1]!.parts[0]!.positions[2]!);
        const g = groups[0]!;
        expect(g.originX + lines.positions[0]!).toBe(input.batches[0]!.originX);
        expect(g.originY + lines.positions[1]!).toBe(input.batches[0]!.originY + 1);
        expect(lines.colors).toEqual(new Uint8Array(16).fill(255));
    });

    it("chunks at primitive boundaries and keeps all vertices", () => {
        const input = list([batch(0, 4_000_002)]);
        const [group] = [...mergedGroups(input, 1)];
        expect(group!.parts.map((p) => p.positions.length / 3)).toEqual([3_999_999, 3]);
        expect(group!.parts[1]!.positions[2]).toBe(Math.fround(orderZ(0, 1)));
    });

    it("copies individual alpha/image data without retaining their original batches", () => {
        const image = { ...batch(3, 3), uvs: new Float32Array([0, 0, 1, 0, 1, 1]), image: 0 };
        const alpha = batch(1, 2, -1, 128);
        const input = list([alpha, image]);
        const parts = [...mergedGroups(input, orderCount(input))][0]!.parts;
        expect(parts[0]!.individual).toBe(true);
        expect(parts[1]!.image).toBe(0);
        expect(parts[1]!.uvs).toEqual(image.uvs);
        const buffers = parts.flatMap((p) => [
            p.positions.buffer,
            p.colors.buffer,
            ...(p.uvs ? [p.uvs.buffer] : []),
        ]);
        structuredClone(parts, { transfer: buffers });
        expect(alpha.colors.byteLength).toBeGreaterThan(0);
        expect(image.positions.byteLength).toBeGreaterThan(0);
        expect(image.uvs.byteLength).toBeGreaterThan(0);
    });
});
