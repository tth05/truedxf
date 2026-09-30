import { describe, expect, it } from "vitest";
import {
  fitRect,
  panBy,
  resize,
  screenToWorld,
  unionRect,
  viewRect,
  worldToScreen,
  zoomAt,
} from "../src/view.ts";

const v = { cx: 10, cy: 20, scale: 0.5, width: 200, height: 100 };

describe("view math", () => {
  it("maps screen and world coordinates (y up)", () => {
    expect(screenToWorld(v, 100, 50)).toEqual([10, 20]);
    expect(screenToWorld(v, 0, 0)).toEqual([-40, 45]);
    const [x, y] = worldToScreen(v, -40, 45);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(viewRect(v)).toEqual({ minX: -40, minY: -5, maxX: 60, maxY: 45 });
  });

  it("zooms around the cursor", () => {
    const z = zoomAt(v, 30, 70, 4);
    expect(z.scale).toBeCloseTo(0.125);
    const before = screenToWorld(v, 30, 70);
    const after = screenToWorld(z, 30, 70);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it("pans with the pointer and keeps centre and scale on resize", () => {
    const p = panBy(v, 10, 10);
    expect(p.cx).toBeCloseTo(5);
    expect(p.cy).toBeCloseTo(25);
    expect(resize(v, 400, 300)).toMatchObject({ cx: 10, cy: 20, scale: 0.5, width: 400, height: 300 });
  });

  it("fits rectangles with a margin, degenerate ones too", () => {
    const f = fitRect({ minX: 0, minY: 0, maxX: 100, maxY: 10 }, 200, 100, 0);
    expect(f).toMatchObject({ cx: 50, cy: 5, scale: 0.5 });
    expect(fitRect({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 100, 100).scale).toBeGreaterThan(0);
    expect(fitRect({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, 10, 10).scale).toBe(
      1,
    );
  });

  it("unions rectangles ignoring invalid ones", () => {
    const bad = { minX: 1, minY: 1, maxX: 0, maxY: 0 };
    const unit = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    expect(unionRect(undefined, bad)).toBeUndefined();
    expect(unionRect(bad, unit)).toEqual(unit);
    expect(unionRect(unit, { minX: -1, minY: 2, maxX: 0, maxY: 3 })).toEqual({
      minX: -1,
      minY: 0,
      maxX: 1,
      maxY: 3,
    });
  });
});
