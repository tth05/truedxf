import { describe, expect, it } from "vitest";
import { viewFromBounds } from "../src/plot.ts";

describe("viewFromBounds", () => {
  it("spans the bounds exactly on the axis that sets the scale", () => {
    // fileformat/corpus-ezdxf-3dface: centre - half-size missed minY by an ulp, so the bottom
    // edge line mapped just below pixel 0 and was dropped
    const b = {
      minX: 606.0089327387539,
      minY: 163.4994741574337,
      maxX: 5154.250845718525,
      maxY: 4199.536162098836,
    };
    const v = viewFromBounds(b, [2000, 1500]);
    expect(v.minY).toBe(b.minY);
    expect(v.maxY).toBe(b.maxY);
    expect((v.minX + v.maxX) / 2).toBeCloseTo((b.minX + b.maxX) / 2, 9);
    expect((v.maxX - v.minX) / 2000).toBeCloseTo((v.maxY - v.minY) / 1500, 12);
  });

  it("snaps x when the width sets the scale", () => {
    const b = { minX: 0.1, minY: 0.3, maxX: 20.3, maxY: 2.7 };
    const v = viewFromBounds(b, [2000, 1500]);
    expect(v.minX).toBe(0.1);
    expect(v.maxX).toBe(20.3);
  });
});
