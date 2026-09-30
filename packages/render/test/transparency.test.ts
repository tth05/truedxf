import { describe, expect, it } from "vitest";
import { DisplayListBuilder } from "../src/displaylist.ts";
import { PixelGrid } from "../src/raster.ts";
import { coverage, plotsTransparency } from "../src/transparency.ts";
import { line, modelDoc } from "./helpers.ts";

const request = {
  layout: "Model",
  area: { type: "window" as const, min: [0, 0] as const, max: [10, 10] as const },
  canvas: [10, 10] as const,
};

describe("plotsTransparency", () => {
  const doc = modelDoc({ entities: line("30", 0, 0, 1, 1) });
  it("follows PLOTTRANSPARENCYOVERRIDE", () => {
    expect(plotsTransparency(doc, { ...request, sysvars: { PLOTTRANSPARENCYOVERRIDE: 0 } } as never)).toBe(
      false,
    );
    expect(plotsTransparency(doc, { ...request, sysvars: { PLOTTRANSPARENCYOVERRIDE: 2 } } as never)).toBe(
      true,
    );
    // 1 (default): page setup; no LAYOUT XDATA here → opaque
    expect(plotsTransparency(doc, request)).toBe(false);
  });
});

describe("coverage", () => {
  it("reduces each batch to unique pixels, last writer wins", () => {
    const b = new DisplayListBuilder(1);
    b.points([0.5, 0.5, 0.5, 0.5, 1.5, 0.5], [255, 0, 0, 127]);
    b.breakBatch();
    // two triangles covering pixel (3,3) twice via a shared diagonal
    b.triangles([3, 3, 4, 3, 4, 4, 3, 3, 4, 4, 3, 4], [0, 0, 255, 127]);
    const grid = new PixelGrid({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, [10, 10]);
    const units = coverage(b.build(), grid);
    expect(units.map((u) => u.xy.length / 2)).toEqual([2, 1]);
    expect([...units[1]!.xy]).toEqual([3.5, 3.5]);
  });
});
