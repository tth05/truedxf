import { DisplayListBuilder } from "@truedxf/render";
import { describe, expect, it } from "vitest";
import { clipMask, rasterize } from "../src/cpu-raster.ts";

const id = (v: number) => v;

describe("smooth hairlines", () => {
  it("clips far-away endpoints and honours colour, alpha and clip holes", () => {
    const builder = new DisplayListBuilder(1);
    builder.background = [0, 0, 0];
    const clip = builder.addClip({ rings: [Float64Array.of(1, 0, 3, 0, 3, 1, 1, 1)] });
    builder.setClip(clip);
    builder.polyline([-1e12, 0.5, 1e12, 0.5], [255, 0, 0, 128]);
    const img = rasterize(builder.build(), { minX: 0, minY: 0, maxX: 4, maxY: 1 }, [4, 1]);
    expect([...img.data]).toEqual([0, 0, 0, 255, 127, 0, 0, 255, 127, 0, 0, 255, 0, 0, 0, 255]);
  });
});

describe("clipMask", () => {
  it("keeps pixels whose centre lies inside a rectangle", () => {
    const m = clipMask([Float64Array.of(1, 1, 3, 1, 3, 2, 1, 2)], id, id, 4, 3);
    // row j = 1 only (centre 1.5), columns 1 and 2
    expect([...m]).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
  });

  it("uses even-odd for nested rings", () => {
    const outer = Float64Array.of(0, 0, 4, 0, 4, 1, 0, 1);
    const hole = Float64Array.of(1, 0, 3, 0, 3, 1, 1, 1);
    const m = clipMask([outer, hole], id, id, 4, 1);
    expect([...m]).toEqual([1, 0, 0, 1]);
  });
});
