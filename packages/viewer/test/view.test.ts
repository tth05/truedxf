import { describe, expect, it } from "vitest";
import {
  constrainView,
  fitRect,
  limitZoomFactor,
  panBy,
  resize,
  screenToWorld,
  unionRect,
  viewRect,
  worldToScreen,
  zoomAt,
  zoomLevel,
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

describe("view limits", () => {
  // 100 × 100 drawing on a 100 × 100 canvas, no margin: fitted scale 1
  const frame = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const fitted = { cx: 50, cy: 50, scale: 1, width: 100, height: 100 };

  it("measures zoom relative to the fitted view", () => {
    expect(zoomLevel(fitted, frame, 0)).toBe(1);
    expect(zoomLevel({ ...fitted, scale: 0.25 }, frame, 0)).toBe(4);
  });

  it("limits zoom factors so the level stays in range", () => {
    const limits = { minZoom: 0.5, maxZoom: 8 };
    expect(limitZoomFactor(fitted, 4, frame, limits, 0)).toBe(4);
    expect(limitZoomFactor(fitted, 100, frame, limits, 0)).toBe(8);
    expect(limitZoomFactor(fitted, 0.1, frame, limits, 0)).toBe(0.5);
    // at the limit, further zooming in does nothing
    expect(limitZoomFactor({ ...fitted, scale: 1 / 8 }, 2, frame, limits, 0)).toBeCloseTo(1);
    expect(limitZoomFactor(fitted, 100, frame, undefined, 0)).toBe(100);
    expect(limitZoomFactor(fitted, 100, undefined, limits, 0)).toBe(100);
  });

  it("clamps the scale around the centre and keeps the centre in the drawing", () => {
    const far = { ...fitted, cx: 500, cy: -20, scale: 10 };
    expect(constrainView(far, frame, { minZoom: 1 }, 0)).toEqual({ ...far, scale: 1 });
    expect(constrainView(far, frame, { keepInView: true }, 0)).toEqual({ ...far, cx: 100, cy: 0 });
    expect(constrainView(far, frame, {}, 0)).toBe(far);
    expect(constrainView(far, undefined, { minZoom: 1, keepInView: true }, 0)).toBe(far);
  });
});
