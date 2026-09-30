import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  Bounds2,
  bulgePolylineToSubpath,
  flattenPath,
  flattenSubpath,
  type PolylineVertex,
  polylineCurveVertexIndices,
  polylineFrameVertexIndices,
  polylineHasWidth,
  polylineSegments,
  segmentEnd,
  segmentStart,
  subpathBounds,
  widePolylineOutline,
} from "../src/index.ts";
import { expectClose, expectPointClose, FC_RUNS } from "./helpers.ts";

function signedArea(pts: Float64Array): number {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[2 * i]! * pts[2 * j + 1]! - pts[2 * j]! * pts[2 * i + 1]!;
  }
  return a / 2;
}

/** Even-odd point-in-polygon. */
function inside(x: number, y: number, pts: Float64Array): boolean {
  let c = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[2 * i]!;
    const yi = pts[2 * i + 1]!;
    const xj = pts[2 * j]!;
    const yj = pts[2 * j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe("bulge polylines (note 03 §3.9)", () => {
  it("builds lines and arcs, skipping zero-length segments", () => {
    const v: PolylineVertex[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0, bulge: 1 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const sp = bulgePolylineToSubpath(v, true);
    expect(sp.segments.map((s) => s.kind)).toEqual(["line", "line", "line"]);
    // The bulge sits on the zero-length segment and is dropped with it.
    const sp2 = bulgePolylineToSubpath(
      [
        { x: 0, y: 0, bulge: 1 },
        { x: 10, y: 0 },
      ],
      false,
    );
    expect(sp2.segments[0]!.kind).toBe("arc");
    expectPointClose(segmentStart(sp2.segments[0]!), { x: 0, y: 0 }, 1e-14);
    expectPointClose(segmentEnd(sp2.segments[0]!), { x: 10, y: 0 }, 1e-14);
    const b = subpathBounds(sp2);
    expect(b.minY).toBeCloseTo(-5, 12);
  });

  it("uses the last vertex's bulge for the closing segment", () => {
    const segs = polylineSegments(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0, bulge: 0.5 },
      ],
      true,
    );
    expect(segs.length).toBe(2);
    expect(segs[1]!.bulge).toBe(0.5);
    expectPointClose(segs[1]!.p1, { x: 0, y: 0 }, 0);
  });

  it("lets a non-zero constant width override vertex widths (AutoCAD)", () => {
    const v: PolylineVertex[] = [
      { x: 0, y: 0, startWidth: 1, endWidth: 3 },
      { x: 10, y: 0 },
    ];
    expect(polylineSegments(v, false, 2)[0]!.startWidth).toBe(2);
    expect(polylineSegments(v, false)[0]!.endWidth).toBe(3);
    expect(polylineHasWidth(v)).toBe(true);
    expect(polylineHasWidth([{ x: 0, y: 0 }], 0)).toBe(false);
    expect(polylineHasWidth([{ x: 0, y: 0 }], 0.5)).toBe(true);
  });
});

describe("heavy POLYLINE vertex selection (note 03 §3.10.4)", () => {
  it("keeps curve-fit extra vertices and drops the spline frame", () => {
    expect(polylineCurveVertexIndices([0, 1, 0, 1], 2)).toEqual([0, 1, 2, 3]);
    expect(polylineCurveVertexIndices([8, 8, 8, 16, 16, 16], 4)).toEqual([0, 1, 2]);
    expect(polylineFrameVertexIndices([8, 8, 8, 16, 16, 16])).toEqual([3, 4, 5]);
    // No curve vertices: fall back to the frame.
    expect(polylineCurveVertexIndices([16, 16], 4)).toEqual([0, 1]);
  });
});

describe("wide polylines (note 03 §4)", () => {
  it("makes a butt-ended quad for a single straight segment", () => {
    const o = widePolylineOutline(
      [
        { x: 0, y: 0, startWidth: 2, endWidth: 2 },
        { x: 10, y: 0 },
      ],
      { closed: false, tolerance: 0.01 },
    );
    expect(o.thin.length).toBe(0);
    const [poly] = flattenPath(o.fill, 0.01);
    const box = new Bounds2().addPoints(poly!.points);
    expect([box.minX, box.minY, box.maxX, box.maxY]).toEqual([0, -1, 10, 1]);
    expectClose(signedArea(poly!.points), 20, 1e-12);
  });

  it("miters joints between straight segments", () => {
    const o = widePolylineOutline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      { closed: false, constantWidth: 2, tolerance: 0.01 },
    );
    const polys = flattenPath(o.fill, 0.01);
    expect(polys.length).toBe(2);
    // Outer miter corner at (11, −1) belongs to both faces.
    const hasCorner = (p: Float64Array) => {
      for (let i = 0; i < p.length; i += 2)
        if (Math.abs(p[i]! - 11) < 1e-12 && Math.abs(p[i + 1]! + 1) < 1e-12) return true;
      return false;
    };
    expect(polys.every((p) => hasCorner(p.points))).toBe(true);
    expect(polys.every((p) => signedArea(p.points) > 0)).toBe(true);
  });

  it("miters the closing joint of a closed polyline (square frame)", () => {
    const sq: PolylineVertex[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const o = widePolylineOutline(sq, { closed: true, constantWidth: 2, tolerance: 0.01 });
    const polys = flattenPath(o.fill, 0.01);
    expect(polys.length).toBe(4);
    const box = new Bounds2();
    for (const p of polys) box.addPoints(p.points);
    expect([box.minX, box.minY, box.maxX, box.maxY]).toEqual([-1, -1, 11, 11]);
    // Total area of the frame: 12² − 8² = 80 (pieces are disjoint trapezoids).
    expectClose(
      polys.reduce((a, p) => a + signedArea(p.points), 0),
      80,
      1e-9,
    );
  });

  it("tapers widths linearly", () => {
    const o = widePolylineOutline(
      [
        { x: 0, y: 0, startWidth: 0, endWidth: 4 },
        { x: 10, y: 0 },
      ],
      { closed: false, tolerance: 0.01 },
    );
    const [poly] = flattenPath(o.fill, 0.01);
    expectClose(signedArea(poly!.points), 20, 1e-12); // triangle base 4, height 10
  });

  it("builds annular sectors for arcs (constant width, exact arcs)", () => {
    const o = widePolylineOutline(
      [
        { x: 0, y: 0, bulge: 1, startWidth: 2, endWidth: 2 },
        { x: 10, y: 0 },
      ],
      { closed: false, tolerance: 0.001 },
    );
    const sp = o.fill.subpaths[0]!;
    expect(sp.segments.filter((s) => s.kind === "arc").length).toBe(2);
    const poly = flattenSubpath(sp, 0.001).points;
    // Half annulus between r = 4 and r = 6: π(36 − 16)/2.
    expectClose(signedArea(poly), 10 * Math.PI, 1e-3);
    expect(inside(5, -5, poly)).toBe(true);
    expect(inside(5, -3, poly)).toBe(false);
  });

  it("builds tapered arcs and keeps CCW orientation for CW bulges", () => {
    for (const bulge of [0.7, -0.7]) {
      const o = widePolylineOutline(
        [
          { x: 0, y: 0, bulge, startWidth: 0, endWidth: 2 },
          { x: 10, y: 0 },
        ],
        { closed: false, tolerance: 0.001 },
      );
      const poly = flattenPath(o.fill, 0.001)[0]!.points;
      expect(signedArea(poly)).toBeGreaterThan(0);
      // Width grows toward the end vertex (10, 0): the end is wide, the start a point.
      const nearEnd = [];
      for (let i = 0; i < poly.length; i += 2)
        if (Math.hypot(poly[i]! - 10, poly[i + 1]!) < 1.01) nearEnd.push(i);
      expect(nearEnd.length).toBeGreaterThan(0);
    }
  });

  it("returns zero-width runs as thin centre lines", () => {
    const o = widePolylineOutline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0, startWidth: 1, endWidth: 1 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ],
      { closed: false, tolerance: 0.01 },
    );
    expect(o.fill.subpaths.length).toBe(1);
    expect(o.thin.length).toBe(2);
  });

  it("covers the centre line of random wide polylines (property)", () => {
    const vArb = fc.array(
      fc.record({
        x: fc.integer({ min: -50, max: 50 }),
        y: fc.integer({ min: -50, max: 50 }),
        bulge: fc.oneof(fc.constant(0), fc.double({ min: -2, max: 2, noNaN: true })),
      }),
      { minLength: 2, maxLength: 8 },
    );
    fc.assert(
      fc.property(vArb, fc.boolean(), (v, closed) => {
        const o = widePolylineOutline(v, { closed, constantWidth: 1, tolerance: 0.01 });
        const polys = flattenPath(o.fill, 0.01).map((p) => p.points);
        expect(o.thin.length).toBe(0);
        // Points on the centre line (slightly away from vertices) are inside some piece.
        for (const sp of [bulgePolylineToSubpath(v, closed)]) {
          const center = flattenSubpath(sp, 0.001).points;
          for (let i = 0; i + 3 < center.length; i += 2) {
            const x = (center[i]! + center[i + 2]!) / 2;
            const y = (center[i + 1]! + center[i + 3]!) / 2;
            expect(polys.some((p) => inside(x, y, p))).toBe(true);
          }
        }
        for (const p of polys) expect(signedArea(p)).toBeGreaterThanOrEqual(-1e-9);
      }),
      { ...FC_RUNS, numRuns: 100 },
    );
  });
});

describe("wide polylines: AutoCAD joint and arc rules (VERIFIED-BY-ACAD, note 03 §4)", () => {
  const maxX = (o: ReturnType<typeof widePolylineOutline>) => {
    const box = new Bounds2();
    for (const p of flattenPath(o.fill, 0.001)) box.addPoints(p.points);
    return box.maxX;
  };
  const zigzag = (deg: number) => {
    const h = Math.tan(((deg / 2) * Math.PI) / 180) * 70;
    return [
      { x: 60, y: 75 + h },
      { x: 130, y: 75 },
      { x: 60, y: 75 - h },
    ];
  };

  it("miters a 30° joint but not a 5° one (polylines/miter-angle-0002, -0003)", () => {
    const o30 = widePolylineOutline(zigzag(30), { closed: false, constantWidth: 2, tolerance: 0.001 });
    expectClose(maxX(o30), 130 + 1 / Math.sin((15 * Math.PI) / 180), 1e-6);
    const o5 = widePolylineOutline(zigzag(5), { closed: false, constantWidth: 2, tolerance: 0.001 });
    // butt ends at the vertex: only the half-width corners stick out (sin 2.5°)
    expect(maxX(o5)).toBeLessThanOrEqual(130 + Math.sin((2.5 * Math.PI) / 180) + 1e-9);
  });

  it("does not miter where the widths step (polylines/width-arrow)", () => {
    const o = widePolylineOutline(
      [
        { x: 20, y: 75, startWidth: 3, endWidth: 3 },
        { x: 140, y: 75, startWidth: 15, endWidth: 0 },
        { x: 180, y: 75 },
      ],
      { closed: false, tolerance: 0.001 },
    );
    const [, head] = flattenPath(o.fill, 0.001);
    const box = new Bounds2().addPoints(head!.points);
    expect([box.minX, box.minY, box.maxY]).toEqual([140, 67.5, 82.5]);
  });

  it("clamps arc widths to the diameter (polylines/ring-semicircle-w6)", () => {
    const o = widePolylineOutline(
      [
        { x: 90, y: 60, bulge: 1, startWidth: 6, endWidth: 6 },
        { x: 94, y: 60 },
      ],
      { closed: false, tolerance: 0.001 },
    );
    const box = new Bounds2();
    for (const p of flattenPath(o.fill, 0.001)) box.addPoints(p.points);
    // half disk of radius 2r = 4 around (92, 60), nothing above the chord
    expectClose(box.minX, 88, 1e-6);
    expectClose(box.maxX, 96, 1e-6);
    expectClose(box.minY, 56, 1e-2);
    expectClose(box.maxY, 60, 1e-6);
  });
});
