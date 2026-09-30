import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  Affine2,
  circularToEllipticArc2,
  type EllipticArc2,
  ellipseAngleToParam,
  ellipseFromDxf,
  ellipseParamToAngle,
  ellipticArc2AsCircle,
  ellipticArc2Bounds,
  ellipticArc2PointAtParam,
  ellipticArc2SemiAxes,
  ellipticArc2TangentAtParam,
  ellipticArc3Bounds,
  ellipticArc3PointAtParam,
  Matrix44,
  normalizeEllipseAxes,
  ocsArcToEllipticArc3,
  projectEllipticArc3,
  TAU,
  transformEllipticArc2,
} from "../src/index.ts";
import { dirArb, expectClose, expectPointClose, FC_RUNS, vec2Arb, vec3Arb } from "./helpers.ts";

describe("ELLIPSE (note 03 §3.7)", () => {
  it("builds the minor axis as normalize(N × M)·|M|·ratio", () => {
    const e = ellipseFromDxf({
      center: { x: 1, y: 2, z: 0 },
      majorAxis: { x: 4, y: 0, z: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: TAU,
    });
    expect(e.v).toEqual({ x: 0, y: 2, z: 0 });
    expect(e.sweep).toBe(TAU);
    expectPointClose(ellipticArc3PointAtParam(e, Math.PI / 2), { x: 1, y: 4, z: 0 }, 1e-15);
  });

  it("runs clockwise seen from +Z for extrusion (0,0,-1) without mirroring the center", () => {
    const e = ellipseFromDxf({
      center: { x: 5, y: 0, z: 0 },
      majorAxis: { x: 1, y: 0, z: 0 },
      ratio: 1,
      startParam: 0,
      endParam: Math.PI / 2,
      extrusion: { x: 0, y: 0, z: -1 },
    });
    expect(e.v).toEqual({ x: 0, y: -1, z: 0 });
    expectPointClose(ellipticArc3PointAtParam(e, Math.PI / 2), { x: 5, y: -1, z: 0 }, 1e-15);
  });

  it("applies the span rule to parameters", () => {
    const base = { center: { x: 0, y: 0, z: 0 }, majorAxis: { x: 1, y: 0, z: 0 }, ratio: 0.5 };
    expect(ellipseFromDxf({ ...base, startParam: 1, endParam: 1 }).sweep).toBe(0);
    expect(ellipseFromDxf({ ...base, startParam: 0, endParam: TAU }).sweep).toBe(TAU);
    expectClose(
      ellipseFromDxf({ ...base, startParam: -Math.PI / 2, endParam: Math.PI / 2 }).sweep,
      Math.PI,
      1e-15,
    );
  });

  it("converts parameters ↔ angles", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 6.28, noNaN: true }),
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        (t, r) => {
          const a = ellipseParamToAngle(t, r);
          // The point at parameter t lies at polar angle a.
          const p = { x: Math.cos(t), y: r * Math.sin(t) };
          expectClose(Math.atan2(p.y, p.x), a, 1e-12);
          expectClose(Math.cos(ellipseAngleToParam(a, r)), Math.cos(t), 1e-9);
          expectClose(Math.sin(ellipseAngleToParam(a, r)), Math.sin(t), 1e-9);
        },
      ),
      FC_RUNS,
    );
  });

  it("swaps axes for ratio > 1", () => {
    const e = {
      center: { x: 0, y: 0, z: 0 },
      majorAxis: { x: 1, y: 0, z: 0 },
      ratio: 2,
      startParam: 1,
      endParam: 2,
    };
    const n = normalizeEllipseAxes(e);
    expect(n.ratio).toBe(0.5);
    expectPointClose(n.majorAxis, { x: 0, y: 2, z: 0 }, 1e-15);
    // Same point set: start points agree.
    expectPointClose(
      ellipticArc3PointAtParam(ellipseFromDxf(n), ellipseFromDxf(n).start),
      ellipticArc3PointAtParam(ellipseFromDxf(e), 1),
      1e-12,
    );
  });

  it("maps CIRCLE/ARC through the OCS", () => {
    const e = ocsArcToEllipticArc3({ x: 10, y: 5, z: 0 }, 10, 0, Math.PI / 2, { x: 0, y: 0, z: -1 });
    // Note 03 test idea 1: centre (−10, 5), start (−20, 5), end (−10, 15), clockwise from +Z.
    expectPointClose(e.center, { x: -10, y: 5, z: 0 }, 1e-15);
    expectPointClose(ellipticArc3PointAtParam(e, 0), { x: -20, y: 5, z: 0 }, 1e-12);
    expectPointClose(ellipticArc3PointAtParam(e, Math.PI / 2), { x: -10, y: 15, z: 0 }, 1e-12);
  });
});

const ellArb = fc
  .record({
    center: vec2Arb(100),
    u: vec2Arb(50),
    v: vec2Arb(50),
    start: fc.double({ min: -7, max: 7, noNaN: true }),
    sweep: fc.double({ min: -TAU, max: TAU, noNaN: true }),
  })
  .filter((e) => Math.hypot(e.u.x, e.u.y) + Math.hypot(e.v.x, e.v.y) > 1e-3) as fc.Arbitrary<EllipticArc2>;

describe("elliptic arcs (conjugate form, note 03 §3.6)", () => {
  it("has tight analytic bounds containing all samples (property)", () => {
    fc.assert(
      fc.property(ellArb, (e) => {
        const box = ellipticArc2Bounds(e);
        const [a] = ellipticArc2SemiAxes(e);
        const tol = 1e-9 * (a + Math.abs(e.center.x) + Math.abs(e.center.y));
        let minX = Infinity;
        let maxY = -Infinity;
        const N = 4000;
        for (let i = 0; i <= N; i++) {
          const p = ellipticArc2PointAtParam(e, e.start + (e.sweep * i) / N);
          expect(box.containsXY(p.x, p.y, tol)).toBe(true);
          minX = Math.min(minX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        const h = (Math.abs(e.sweep) / N) * 2;
        const slack = a * (1 - Math.cos(h)) + tol;
        expect(minX - box.minX).toBeLessThanOrEqual(slack);
        expect(box.maxY - maxY).toBeLessThanOrEqual(slack);
      }),
      FC_RUNS,
    );
  });

  it("3D bounds contain samples (property)", () => {
    fc.assert(
      fc.property(
        vec3Arb(100),
        vec3Arb(20),
        vec3Arb(20),
        fc.double({ min: 0, max: TAU, noNaN: true }),
        (c, u, v, sw) => {
          const e = { center: c, u, v, start: 0.3, sweep: sw };
          const box = ellipticArc3Bounds(e);
          for (let i = 0; i <= 500; i++) {
            const p = ellipticArc3PointAtParam(e, 0.3 + (sw * i) / 500);
            expect(box.containsXYZ(p.x, p.y, p.z, 1e-9 * 200)).toBe(true);
          }
        },
      ),
      FC_RUNS,
    );
  });

  it("is exact under affine maps and projection", () => {
    fc.assert(
      fc.property(ellArb, fc.double({ min: 0, max: 1, noNaN: true }), (e, f) => {
        const m = new Affine2(2, 0.5, -0.3, 0.7, 10, -4);
        const t = e.start + e.sweep * f;
        expectPointClose(
          ellipticArc2PointAtParam(transformEllipticArc2(e, m), t),
          m.apply(ellipticArc2PointAtParam(e, t)),
          1e-9,
        );
      }),
      FC_RUNS,
    );
    fc.assert(
      fc.property(dirArb, fc.double({ min: 0, max: TAU, noNaN: true }), (n, t) => {
        const e3 = ocsArcToEllipticArc3({ x: 1, y: 2, z: 3 }, 4, 0, TAU, n);
        const m = Matrix44.rotationAxis({ x: 1, y: 2, z: 3 }, 0.7);
        const e2 = projectEllipticArc3(e3, m);
        const q = m.transformPoint(ellipticArc3PointAtParam(e3, t));
        expectPointClose(ellipticArc2PointAtParam(e2, t), { x: q.x, y: q.y }, 1e-9);
      }),
      FC_RUNS,
    );
  });

  it("detects circles incl. mirrored ones", () => {
    const e = transformEllipticArc2(
      circularToEllipticArc2({ center: { x: 1, y: 1 }, radius: 2, start: 0.5, sweep: 1 }),
      new Affine2(-3, 0, 0, 3, 0, 0),
    );
    const c = ellipticArc2AsCircle(e)!;
    expect(c.radius).toBeCloseTo(6, 12);
    expect(c.sweep).toBe(-1);
    for (const f of [0, 0.3, 1]) {
      const p = ellipticArc2PointAtParam(e, e.start + e.sweep * f);
      const a = c.start + c.sweep * f;
      expectPointClose(
        p,
        { x: c.center.x + c.radius * Math.cos(a), y: c.center.y + c.radius * Math.sin(a) },
        1e-12,
      );
    }
    expect(ellipticArc2AsCircle({ ...e, v: { x: 0, y: 1 } })).toBeUndefined();
  });

  it("computes semi-axes and tangents", () => {
    const e = { center: { x: 0, y: 0 }, u: { x: 3, y: 0 }, v: { x: 0, y: 1 }, start: 0, sweep: TAU };
    expect(ellipticArc2SemiAxes(e)).toEqual([3, 1]);
    expectPointClose(ellipticArc2TangentAtParam(e, 0), { x: 0, y: 1 }, 1e-15);
  });
});
