import { DisplayListBuilder } from "@truedxf/render";
import { describe, expect, it } from "vitest";
import { DrawingState } from "../src/drawing.ts";
import { buildPickData } from "../src/pick.ts";
import { visibleBounds } from "../src/protocol.ts";
import type { Rect } from "../src/view.ts";

describe("visible bounds", () => {
    it("preserves quantized batch bounds instead of substituting float64 list.bounds", () => {
        const b = new DisplayListBuilder(1);
        b.beginEntity("A");
        b.polyline([0, 0, 100000.001, 1], [0, 0, 0, 255]);
        b.endEntity();
        b.setUnbounded(true);
        b.polyline([-1e9, -1e9, 1e9, 1e9], [0, 0, 0, 255]);
        const list = b.build();
        const expected = { minX: 0, minY: 0, maxX: 100000, maxY: 1 };
        expect(list.bounds.maxX).toBe(100000.001);
        expect(visibleBounds(list)).toEqual(expected);
        expect(new DrawingState(list).bounds).toEqual(expected);
    });

    it("preserves whole-batch clipping when separate primitives miss the clip", () => {
        const b = new DisplayListBuilder(1);
        const clip = b.addClip({ rings: [Float64Array.of(0, 0, 10, 0, 10, 10, 0, 10)] });
        b.setClip(clip);
        b.beginEntity("A");
        b.polyline([-20, 4, -10, 4], [0, 0, 0, 255]);
        b.endEntity();
        b.beginEntity("B");
        b.polyline([20, 6, 30, 6], [0, 0, 0, 255]);
        b.endEntity();
        const list = b.build();
        expect(list.bounds.minX).toBe(Infinity);
        const expected = { minX: 0, minY: 4, maxX: 10, maxY: 6 };
        expect(visibleBounds(list)).toEqual(expected);
        expect(new DrawingState(list).bounds).toEqual(expected);
    });

    it("scans batches with incomplete pick coverage, including an entirely unpicked batch", () => {
        const b = new DisplayListBuilder(1);
        b.polyline([-10, -10, -5, -5], [0, 0, 0, 255]);
        b.beginEntity("A");
        b.polyline([0, 0, 10, 10], [0, 0, 0, 255]);
        b.endEntity();
        b.breakBatch();
        b.polyline([20, 20, 30, 30], [0, 0, 0, 255]);
        const list = b.build();
        const cached: (Rect | undefined)[] = [];
        buildPickData(list, cached);
        expect(cached[0]).toBeUndefined();
        expect(cached[1]).toBeUndefined();
        expect(new DrawingState(list).bounds).toEqual(visibleBounds(list));
        expect(new DrawingState(list).bounds).toEqual({ minX: -10, minY: -10, maxX: 30, maxY: 30 });
    });

    it("limits clipped batches (viewport content) to their clip region", () => {
        const b = new DisplayListBuilder(1);
        const black = [0, 0, 0, 255] as const;
        b.polyline([0, 0, 10, 10], black);
        // model content far outside a 20×20 viewport at (100, 100)
        const clip = b.addClip({ rings: [Float64Array.of(100, 100, 120, 100, 120, 120, 100, 120)] });
        b.setClip(clip);
        b.polyline([-5000, 110, 5000, 110], black);
        b.setClip(-1);
        const list = b.build();
        // the builder clips bounds too now (note 08 §10.16); visibleBounds must agree
        expect(list.bounds.minX).toBe(0);
        expect(visibleBounds(list)).toEqual({ minX: 0, minY: 0, maxX: 120, maxY: 110 });
        expect(visibleBounds(new DisplayListBuilder(1).build())).toBeUndefined();
    });
});
