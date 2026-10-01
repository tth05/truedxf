import type { NurbsCurve } from "@truedxf/geometry";
import { describe, expect, it } from "vitest";
import { satWireframe } from "../src/draw/acis.ts";

const HEADER = [
  "700 0 1 0",
  "@8 test @12 ACIS 32.0 NT @24 Thu Jan  1 12:00:00 2026",
  "1 9.9999999999999995e-007 1e-010",
];

/** SAT with records 0: body, then the given records, then two vertices/points at a and b. */
function sat(edge: string, curve: string, a: string, b: string, vertex = "vertex"): string[] {
  return [
    ...HEADER,
    "body $-1 -1 $-1 $-1 $-1 $-1 #", // 0
    `${edge} #`, // 1
    `${vertex} $-1 -1 $-1 $1 $4 #`, // 2
    `${vertex} $-1 -1 $-1 $1 $5 #`, // 3
    `point $-1 -1 $-1 ${a} #`, // 4
    `point $-1 -1 $-1 ${b} #`, // 5
    `${curve} #`, // 6
    "End-of-ACIS-data",
  ];
}

describe("ACIS curved edges", () => {
  it("reads ellipse geometry after the `$attrib id $…` header (not the history id)", () => {
    const { curves, unsupported } = satWireframe(
      sat(
        "edge $-1 -1 $-1 $2 0 $3 1.5707963267948966 $-1 $6 forward @7 unknown",
        "ellipse-curve $-1 -1 $-1 10 20 0 0 0 1 5 0 0 1 I I",
        "15 20 0",
        "10 25 0",
      ),
    );
    expect(unsupported).toBe(0);
    expect(curves).toHaveLength(1);
    const c = curves[0]!;
    if (c.kind !== "ellipticArc") throw new Error(c.kind);
    expect(c.center).toEqual({ x: 10, y: 20, z: 0 });
    expect(c.u).toEqual({ x: 5, y: 0, z: 0 });
    expect(c.start).toBeCloseTo(0, 12);
    expect(c.sweep).toBeCloseTo(Math.PI / 2, 12);
  });

  it("falls back to the chord (noted) when the ellipse does not pass through the vertices", () => {
    const { curves, unsupported } = satWireframe(
      sat(
        "edge $-1 -1 $-1 $2 0 $3 1 $-1 $6 forward @7 unknown",
        "ellipse-curve $-1 -1 $-1 1e7 0 0 0 0 1 5 0 0 1 I I",
        "15 20 0",
        "10 25 0",
      ),
    );
    expect(unsupported).toBe(1);
    expect(curves).toEqual([{ kind: "line", p0: { x: 15, y: 20, z: 0 }, p1: { x: 10, y: 25, z: 0 } }]);
  });

  it("draws tolerant edges and vertices", () => {
    const { curves } = satWireframe(
      sat(
        "tedge-edge $-1 -1 $-1 $2 0 $3 1 $-1 $6 forward @7 unknown $-1 0.001",
        "straight-curve $-1 -1 $-1 0 0 0 1 0 0 I I",
        "0 0 0",
        "3 4 0",
        "tvertex-vertex",
      ),
    );
    expect(curves).toEqual([{ kind: "line", p0: { x: 0, y: 0, z: 0 }, p1: { x: 3, y: 4, z: 0 } }]);
  });

  it("evaluates the B-spline of an intcurve, trimmed to the edge parameters", () => {
    // cubic Bézier (0,0) (1,2) (3,2) (4,0): C(0.25) = (0.90625, 1.125), C(0.75) = (3.09375, 1.125)
    const { curves, unsupported } = satWireframe(
      sat(
        "edge $-1 -1 $-1 $2 0.25 $3 0.75 $-1 $6 forward @7 unknown",
        "intcurve-curve $-1 -1 $-1 forward { exactcur nubs 3 open 2 0 3 1 3 0 0 0 1 2 0 3 2 0 4 0 0 0 } I I",
        "0.90625 1.125 0",
        "3.09375 1.125 0",
      ),
    );
    expect(unsupported).toBe(0);
    const c = curves[0]!;
    if (c.kind !== "nurbs") throw new Error(c.kind);
    const n: NurbsCurve = c.curve;
    const p = (u: number) => Array.from(n.pointAt(u));
    expect(p(n.domainStart)[0]).toBeCloseTo(0.90625, 12);
    expect(p(n.domainEnd)[0]).toBeCloseTo(3.09375, 12);
    expect(p(0.5)[0]).toBeCloseTo(2, 12);
    expect(p(0.5)[1]).toBeCloseTo(1.5, 12);
  });

  it("does not draw a spline that does not run between the vertices", () => {
    const { curves, unsupported } = satWireframe(
      sat(
        "edge $-1 -1 $-1 $2 0 $3 1 $-1 $6 forward @7 unknown",
        "intcurve-curve $-1 -1 $-1 forward { exactcur nubs 3 open 2 0 3 1 3 0 0 0 1e6 2 0 3 2 0 9e6 0 0 0 } I I",
        "0 0 0",
        "4 0 0",
      ),
    );
    expect(unsupported).toBe(1);
    expect(curves[0]!.kind).toBe("line");
  });
});
