import { DisplayListBuilder } from "@truedxf/render";
import { describe, expect, it } from "vitest";
import { visibleBounds } from "../src/protocol.ts";

describe("visible bounds", () => {
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
