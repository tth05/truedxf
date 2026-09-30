import { dilateBySquare } from "@truedxf/geometry";
import type { SpatialFilterObject } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import { blockBoundary } from "../src/draw/xclip.ts";
import { dropOnEdges } from "../src/frontend.ts";

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

function filter(boundary: [number, number][], inverse = I, clip = I): SpatialFilterObject {
  return {
    boundary: boundary.map(([x, y]) => ({ x, y })),
    inverseInsertMatrix: inverse,
    clipMatrix: clip,
  } as unknown as SpatialFilterObject;
}

const xy = (pts: { x: number; y: number }[]) =>
  pts.map((p) => [Math.round(p.x * 1e9) / 1e9, Math.round(p.y * 1e9) / 1e9]);

describe("XCLIP boundary", () => {
  it("expands two points to a rectangle and applies the inverse insert matrix", () => {
    const b = blockBoundary(
      filter(
        [
          [70, 55],
          [120, 90],
        ],
        [1, 0, 0, -60, 0, 1, 0, -45, 0, 0, 1, 0],
      ),
    );
    expect(xy(b)).toEqual([
      [10, 10],
      [60, 10],
      [60, 45],
      [10, 45],
    ]);
  });

  it("drops a repeated closing vertex", () => {
    expect(
      blockBoundary(
        filter([
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ]),
      ).length,
    ).toBe(3);
  });

  it("maps the boundary back through the inverse of the second matrix", () => {
    // second matrix = translation (-40, -30): boundary (0,0) is block point (40, 30)
    const b = blockBoundary(
      filter(
        [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        I,
        [1, 0, 0, -40, 0, 1, 0, -30, 0, 0, 1, 0],
      ),
    );
    expect(xy(b)[0]).toEqual([40, 30]);
  });
});

describe("dilateBySquare", () => {
  it("grows a rectangle by h on every side", () => {
    const [p] = dilateBySquare([Float64Array.of(0, 0, 10, 0, 10, 5, 0, 5)], 0.5, { tolerance: 0.01 });
    const xs = [...p!.outer].filter((_, i) => i % 2 === 0);
    const ys = [...p!.outer].filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(-0.5, 6);
    expect(Math.max(...xs)).toBeCloseTo(10.5, 6);
    expect(Math.min(...ys)).toBeCloseTo(-0.5, 6);
    expect(Math.max(...ys)).toBeCloseTo(5.5, 6);
  });
});

describe("dropOnEdges", () => {
  const edges = Float64Array.of(0, 0, 10, 0, 10, 0, 10, 10);
  it("drops segments lying entirely on a boundary edge", () => {
    const parts = dropOnEdges(Float64Array.of(2, 0, 8, 0, 8, 5), false, edges, 1e-9);
    expect(parts?.map((p) => [...p])).toEqual([[8, 0, 8, 5]]);
  });
  it("keeps segments only partly on an edge", () => {
    expect(dropOnEdges(Float64Array.of(-5, 0, 5, 0), false, edges, 1e-9)).toBeUndefined();
  });
});
