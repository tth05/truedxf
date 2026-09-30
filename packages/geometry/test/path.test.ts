import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  Affine2,
  arcSegment,
  arcSegmentCount,
  cubicSegment,
  ellipticArcSegment,
  flattenPath,
  flattenSubpath,
  lineSegment,
  NurbsCurve,
  nurbsSegment,
  PathBuilder,
  type PathSegment,
  pathBounds,
  quadSegment,
  reverseSegment,
  reverseSubpath,
  segmentBounds,
  segmentDerivativeAt,
  segmentEnd,
  segmentPointAt,
  segmentStart,
  TAU,
  toleranceForTransform,
  transformSegment,
} from "../src/index.ts";
import { distanceToPolyline, expectPointClose, FC_RUNS, vec2Arb } from "./helpers.ts";

const angleArb = fc.double({ min: -7, max: 7, noNaN: true });
const sweepArb = fc.double({ min: -TAU, max: TAU, noNaN: true });

const segmentArb: fc.Arbitrary<PathSegment> = fc.oneof(
  fc.record({ p0: vec2Arb(100), p1: vec2Arb(100) }).map(({ p0, p1 }) => lineSegment(p0, p1)),
  fc
    .record({
      c: vec2Arb(100),
      r: fc.double({ min: 0.001, max: 500, noNaN: true }),
      a: angleArb,
      s: sweepArb,
    })
    .map(({ c, r, a, s }) => arcSegment({ center: c, radius: r, start: a, sweep: s })),
  fc
    .record({ c: vec2Arb(100), u: vec2Arb(200), v: vec2Arb(200), a: angleArb, s: sweepArb })
    .map(({ c, u, v, a, s }) => ellipticArcSegment({ center: c, u, v, start: a, sweep: s })),
  fc.record({ a: vec2Arb(100), b: vec2Arb(100), c: vec2Arb(100) }).map(({ a, b, c }) => quadSegment(a, b, c)),
  fc
    .record({ a: vec2Arb(100), b: vec2Arb(100), c: vec2Arb(100), d: vec2Arb(100) })
    .map(({ a, b, c, d }) => cubicSegment(a, b, c, d)),
  fc
    .record({
      pts: fc.array(fc.double({ min: -100, max: 100, noNaN: true }), { minLength: 10, maxLength: 10 }),
      w: fc.array(fc.double({ min: 0.3, max: 3, noNaN: true }), { minLength: 5, maxLength: 5 }),
    })
    .map(({ pts, w }) =>
      nurbsSegment(
        new NurbsCurve(
          3,
          2,
          Float64Array.from(pts),
          Float64Array.of(0, 0, 0, 0, 0.4, 1, 1, 1, 1),
          Float64Array.from(w),
        ),
      ),
    ),
);

function segmentScale(s: PathSegment): number {
  const b = segmentBounds(s);
  return Math.max(1, Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minY), Math.abs(b.maxY));
}

describe("path segments", () => {
  it("evaluate start/end consistently with pointAt (property)", () => {
    fc.assert(
      fc.property(segmentArb, (s) => {
        const tol = 1e-12 * segmentScale(s);
        expectPointClose(segmentPointAt(s, 0), segmentStart(s), tol);
        expectPointClose(segmentPointAt(s, 1), segmentEnd(s), tol);
      }),
      FC_RUNS,
    );
  });

  it("derivatives agree with finite differences (property)", () => {
    fc.assert(
      fc.property(segmentArb, fc.double({ min: 0.05, max: 0.95, noNaN: true }), (s, t) => {
        const h = 1e-6;
        const a = segmentPointAt(s, t - h);
        const b = segmentPointAt(s, t + h);
        const d = segmentDerivativeAt(s, t);
        const scale = Math.max(1, Math.hypot(d.x, d.y));
        if (s.kind === "nurbs") fc.pre(Math.abs(t - 0.4) > 1e-3);
        expect(Math.abs((b.x - a.x) / (2 * h) - d.x)).toBeLessThan(1e-3 * scale);
        expect(Math.abs((b.y - a.y) / (2 * h) - d.y)).toBeLessThan(1e-3 * scale);
      }),
      FC_RUNS,
    );
  });

  it("bounds contain all samples (property)", () => {
    fc.assert(
      fc.property(segmentArb, (s) => {
        const box = segmentBounds(s);
        const tol = 1e-9 * segmentScale(s);
        let ok = true;
        for (let i = 0; i <= 1000; i++) {
          const p = segmentPointAt(s, i / 1000);
          ok &&= box.containsXY(p.x, p.y, tol);
        }
        expect(ok).toBe(true);
      }),
      FC_RUNS,
    );
  });

  it("cubic bounds are exact at the extrema", () => {
    const c = cubicSegment({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 });
    const b = segmentBounds(c);
    expect(b.maxY).toBeCloseTo(0.75, 15);
    expect(b.minX).toBe(0);
    const q = segmentBounds(quadSegment({ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 0 }));
    expect(q.maxY).toBeCloseTo(1, 15);
  });

  it("transform exactly under affine maps (property)", () => {
    const maps = [
      new Affine2(2, 0.3, -0.7, 1.5, 5, -3), // general → arcs become elliptic
      Affine2.rotation(0.7).multiply(Affine2.scaling(3)), // similarity → arcs stay arcs
      Affine2.scaling(-2, 2).multiply(Affine2.translation(1, 1)), // mirror
    ];
    fc.assert(
      fc.property(
        segmentArb,
        fc.constantFrom(...maps),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (s, m, t) => {
          const ts = transformSegment(s, m);
          if (s.kind === "arc")
            expect(ts.kind).toBe(m.similarityScale() === undefined ? "ellipticArc" : "arc");
          expectPointClose(segmentPointAt(ts, t), m.apply(segmentPointAt(s, t)), 1e-9 * segmentScale(s) * 10);
        },
      ),
      FC_RUNS,
    );
  });

  it("reverse (property)", () => {
    fc.assert(
      fc.property(segmentArb, fc.double({ min: 0, max: 1, noNaN: true }), (s, t) => {
        expectPointClose(
          segmentPointAt(reverseSegment(s), 1 - t),
          segmentPointAt(s, t),
          1e-9 * segmentScale(s),
        );
      }),
      FC_RUNS,
    );
  });
});

describe("flattening (note 03 §5.3)", () => {
  it("uses the documented arc segment counts", () => {
    // Note 03 §5.3: full circle at tol 0.1 px: r = 100 → ~71, 1000 → ~222, 10 000 → ~703.
    expect(arcSegmentCount(100, TAU, 0.1)).toBe(71);
    expect(arcSegmentCount(1000, TAU, 0.1)).toBe(223);
    expect(arcSegmentCount(10000, TAU, 0.1)).toBe(703);
    expect(arcSegmentCount(0.05, TAU, 0.1)).toBe(2);
    expect(arcSegmentCount(10, 0, 0.1)).toBe(1);
  });

  it("stays within the tolerance for every segment kind (property)", () => {
    fc.assert(
      fc.property(segmentArb, fc.constantFrom(0.05, 0.1, 0.25, 1), (s, tol) => {
        const poly = flattenSubpath({ segments: [s], closed: false }, tol).points;
        expectPointClose({ x: poly[0]!, y: poly[1]! }, segmentStart(s), 0);
        expectPointClose({ x: poly[poly.length - 2]!, y: poly[poly.length - 1]! }, segmentEnd(s), 0);
        let worst = 0;
        for (let i = 0; i <= 2000; i++) {
          const p = segmentPointAt(s, i / 2000);
          worst = Math.max(worst, distanceToPolyline(p.x, p.y, poly));
        }
        expect(worst).toBeLessThanOrEqual(tol * (1 + 1e-6) + 1e-12 * segmentScale(s));
      }),
      FC_RUNS,
    );
  });

  it("is deterministic and puts arc vertices on the curve", () => {
    const s = arcSegment({ center: { x: 3, y: 4 }, radius: 250, start: 0.1, sweep: 2 });
    const a = flattenSubpath({ segments: [s], closed: false }, 0.1).points;
    const b = flattenSubpath({ segments: [s], closed: false }, 0.1).points;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length / 2 - 1).toBe(arcSegmentCount(250, 2, 0.1));
    for (let i = 0; i < a.length; i += 2) expect(Math.hypot(a[i]! - 3, a[i + 1]! - 4)).toBeCloseTo(250, 9);
  });

  it("drops the duplicate closing vertex of closed subpaths", () => {
    const circle = arcSegment({ center: { x: 0, y: 0 }, radius: 10, start: 0, sweep: TAU });
    const [poly] = flattenPath({ subpaths: [{ segments: [circle], closed: true }] }, 0.1);
    expect(poly!.closed).toBe(true);
    const n = poly!.points.length / 2;
    expect(n).toBe(arcSegmentCount(10, TAU, 0.1));
  });

  it("converts device tolerances to source units", () => {
    expect(toleranceForTransform(Affine2.scaling(10, 2), 0.1)).toBeCloseTo(0.01, 15);
  });
});

describe("PathBuilder", () => {
  it("builds chained subpaths and bridges gaps", () => {
    const p = new PathBuilder()
      .moveTo({ x: 0, y: 0 })
      .lineTo({ x: 10, y: 0 })
      .arc({ center: { x: 10, y: 5 }, radius: 5, start: -Math.PI / 2, sweep: Math.PI })
      .cubicTo({ x: 5, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 5 })
      .close()
      .moveTo({ x: 20, y: 0 })
      .quadTo({ x: 25, y: 5 }, { x: 30, y: 0 })
      .arc({ center: { x: 40, y: 0 }, radius: 1, start: 0, sweep: 1 }) // gap → connector
      .build();
    expect(p.subpaths.length).toBe(2);
    expect(p.subpaths[0]!.closed).toBe(true);
    expect(p.subpaths[0]!.segments.map((s) => s.kind)).toEqual(["line", "arc", "cubic"]);
    expect(p.subpaths[1]!.segments.map((s) => s.kind)).toEqual(["quad", "line", "arc"]);
    const b = pathBounds(p);
    expect(b.maxX).toBe(41);
    expect(b.maxY).toBeCloseTo(10, 12);
    const r = reverseSubpath(p.subpaths[1]!);
    expectPointClose(segmentStart(r.segments[0]!), segmentEnd(p.subpaths[1]!.segments[2]!), 1e-15);
    expect(() => new PathBuilder().lineTo({ x: 0, y: 0 })).toThrow();
  });
});
