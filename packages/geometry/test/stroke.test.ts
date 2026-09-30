import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  LineCap,
  LineJoin,
  polygonsArea,
  strokeDot,
  strokeOutline,
  strokePieceRings,
  strokePolyline,
  trianglesArea,
} from "../src/index.ts";
import { distanceToPolyline, expectClose } from "./helpers.ts";

function covered(tri: Float64Array, x: number, y: number): boolean {
  for (let i = 0; i < tri.length; i += 6) {
    const s = (ax: number, ay: number, bx: number, by: number) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const d1 = s(tri[i]!, tri[i + 1]!, tri[i + 2]!, tri[i + 3]!);
    const d2 = s(tri[i + 2]!, tri[i + 3]!, tri[i + 4]!, tri[i + 5]!);
    const d3 = s(tri[i + 4]!, tri[i + 5]!, tri[i]!, tri[i + 1]!);
    if (d1 >= 0 && d2 >= 0 && d3 >= 0) return true;
  }
  return false;
}

const seg = Float64Array.of(0, 0, 10, 0);

describe("stroker caps", () => {
  it("butt / square / round / diamond areas of a single segment", () => {
    const w = 2;
    const area = (cap: LineCap) => trianglesArea(strokePolyline(seg, { width: w, cap, tolerance: 1e-4 }));
    expectClose(area(LineCap.Butt), 20, 1e-12);
    expectClose(area(LineCap.Square), 24, 1e-12);
    expectClose(area(LineCap.Diamond), 22, 1e-12);
    expect(Math.abs(area(LineCap.Round) - (20 + Math.PI))).toBeLessThan(1e-3);
  });

  it("all triangles are counter-clockwise", () => {
    const tri = strokePolyline(Float64Array.of(0, 0, 5, 1, 3, 4, 8, 8), { width: 1.5 });
    for (let i = 0; i < tri.length; i += 6) {
      const c =
        (tri[i + 2]! - tri[i]!) * (tri[i + 5]! - tri[i + 1]!) -
        (tri[i + 3]! - tri[i + 1]!) * (tri[i + 4]! - tri[i]!);
      expect(c).toBeGreaterThan(0);
    }
  });

  it("round tessellation count follows the tolerance deterministically", () => {
    const coarse = strokePolyline(seg, { width: 20, cap: LineCap.Round, tolerance: 1 });
    const fine = strokePolyline(seg, { width: 20, cap: LineCap.Round, tolerance: 0.01 });
    expect(fine.length).toBeGreaterThan(coarse.length);
    expect(Array.from(strokePolyline(seg, { width: 20, tolerance: 0.01 }))).toEqual(Array.from(fine));
    // Round cap vertices lie on the circle (inscribed): deviation ≤ tolerance.
    const pieces = strokePieceRings(seg, {
      width: 20,
      cap: LineCap.Round,
      join: LineJoin.Round,
      tolerance: 0.01,
    });
    const cap = pieces[1]!; // pieces: rect, start cap, end cap
    for (let i = 0; i < cap.length; i += 2) {
      const r = Math.hypot(cap[i]!, cap[i + 1]!);
      if (r !== 0) expectClose(r, 10, 1e-12); // all but the centre
    }
  });
});

describe("stroker joins", () => {
  const corner = Float64Array.of(0, 0, 10, 0, 10, 10);
  it("miter on a right angle fills the square corner exactly (outline area)", () => {
    const o = strokeOutline(
      corner,
      { width: 2, cap: LineCap.Butt, join: LineJoin.Miter },
      { tolerance: 1e-3 },
    );
    // Two 10×2 bands overlapping in a 1×1 square, plus the 1×1 miter square.
    expectClose(polygonsArea(o), 20 + 20 - 1 + 1, 1e-6);
  });

  it("bevel cuts the corner, round lies between bevel and miter", () => {
    const a = (join: LineJoin) =>
      polygonsArea(
        strokeOutline(corner, { width: 2, cap: LineCap.Butt, join, tolerance: 1e-4 }, { tolerance: 1e-4 }),
      );
    expectClose(a(LineJoin.Bevel), 39 + 0.5, 1e-6);
    expectClose(a(LineJoin.Round), 39 + Math.PI / 4, 1e-3);
    expectClose(a(LineJoin.Miter), 40, 1e-6);
    expectClose(a(LineJoin.Diamond), 39 + Math.SQRT1_2, 1e-6); // quad P, A, P + h·bisector, B
  });

  it("miter limit falls back to bevel for sharp angles", () => {
    const sharp = Float64Array.of(0, 0, 10, 0, 0, 1);
    const tip = (limit: number) => {
      const t = strokePolyline(sharp, {
        width: 1,
        cap: LineCap.Butt,
        join: LineJoin.Miter,
        miterLimit: limit,
      });
      let mx = 0;
      for (let i = 0; i < t.length; i += 2) mx = Math.max(mx, t[i]!);
      return mx;
    };
    expect(tip(100)).toBeGreaterThan(15);
    expect(tip(4)).toBeLessThan(10.6);
  });

  it("180° spikes and duplicate points produce finite geometry", () => {
    const spike = Float64Array.of(0, 0, 10, 0, 10, 0, 0, 0);
    for (const join of Object.values(LineJoin)) {
      const t = strokePolyline(spike, { width: 2, join });
      expect(t.length).toBeGreaterThan(0);
      expect(t.every(Number.isFinite)).toBe(true);
    }
    const rt = strokePolyline(spike, { width: 2, join: LineJoin.Round, cap: LineCap.Butt, tolerance: 1e-4 });
    expect(covered(rt, 10.9, 0.01)).toBe(true); // half disc at the spike tip
  });

  it("closed polylines get a join at vertex 0 and no caps", () => {
    const sq = Float64Array.of(0, 0, 10, 0, 10, 10, 0, 10);
    const o = strokeOutline(sq, { width: 2, closed: true, join: LineJoin.Miter }, { tolerance: 1e-3 });
    expectClose(polygonsArea(o), 12 * 12 - 8 * 8, 1e-6);
  });

  it("zero-length input draws a dot of the cap shape", () => {
    const p = Float64Array.of(3, 4, 3, 4);
    expect(Math.abs(trianglesArea(strokePolyline(p, { width: 2, tolerance: 1e-4 })) - Math.PI)).toBeLessThan(
      1e-3,
    );
    expectClose(trianglesArea(strokePolyline(p, { width: 2, cap: LineCap.Square })), 4, 1e-12);
    expect(strokePolyline(p, { width: 2, cap: LineCap.Butt }).length).toBe(0);
    const d = strokeDot(0, 0, Math.PI / 4, { width: 2, cap: LineCap.Square });
    let mx = 0;
    for (let i = 0; i < d.length; i += 2) mx = Math.max(mx, d[i]!);
    expectClose(mx, Math.SQRT2, 1e-12); // rotated square
  });
});

describe("stroker coverage property (round caps and joins = Minkowski sum with a disc)", () => {
  it("covers exactly the points within width/2 of the polyline (± tolerance)", () => {
    const pts = fc.array(
      fc.tuple(fc.double({ min: -20, max: 20, noNaN: true }), fc.double({ min: -20, max: 20, noNaN: true })),
      {
        minLength: 2,
        maxLength: 8,
      },
    );
    fc.assert(
      fc.property(pts, fc.double({ min: 0.2, max: 8, noNaN: true }), fc.boolean(), (p, w, closed) => {
        const xy = Float64Array.from(p.flat());
        const tol = 0.01;
        const tri = strokePolyline(xy, { width: w, closed, tolerance: tol });
        const h = w / 2;
        for (let gx = -25; gx <= 25; gx += 2.3) {
          for (let gy = -25; gy <= 25; gy += 2.3) {
            const d = distanceToPolyline(gx, gy, xy, closed && p.length > 2);
            if (d < h - tol - 1e-9) expect(covered(tri, gx, gy)).toBe(true);
            else if (d > h + 1e-9) expect(covered(tri, gx, gy)).toBe(false);
          }
        }
      }),
      { numRuns: 200, seed: 11 },
    );
  });
});
