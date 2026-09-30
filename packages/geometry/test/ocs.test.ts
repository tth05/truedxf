import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  arbitraryAxis,
  dot3,
  entityCoordinateSystem,
  isOcsPoint,
  isWcsExtrusion,
  length3,
  normalizeExtrusion,
  ocsToWcs,
  ocsToWcsMatrix,
  polylineCoordinateSystem,
  thicknessVector,
  wcsToOcs,
  wcsToOcsMatrix,
} from "../src/index.ts";
import ref from "./fixtures/ezdxf-reference.json" with { type: "json" };
import { dirArb, expectClose, expectPointClose, FC_RUNS, vec3Arb } from "./helpers.ts";

const v = (a: number[]) => ({ x: a[0]!, y: a[1]!, z: a[2]! });

describe("arbitrary axis algorithm (note 03 §2.2)", () => {
  it("matches ezdxf OCS.to_wcs", () => {
    for (const [n, p, expected] of ref.ocs as number[][][]) {
      expectPointClose(ocsToWcs(v(p!), arbitraryAxis(v(n!))), v(expected!), 1e-12);
    }
  });

  it("gives the exact mirrored axes for (0,0,-1)", () => {
    const { ax, ay, az } = arbitraryAxis({ x: 0, y: 0, z: -1 });
    expect(ax).toEqual({ x: -1, y: 0, z: 0 });
    expect(ay).toEqual({ x: 0, y: 1, z: 0 });
    expect(az).toEqual({ x: 0, y: 0, z: -1 });
    // Worked example: OCS centre (10, 5) → WCS (−10, 5).
    expect(ocsToWcs({ x: 10, y: 5, z: 0 }, arbitraryAxis({ x: 0, y: 0, z: -1 }))).toEqual({
      x: -10,
      y: 5,
      z: 0,
    });
    expect(ocsToWcsMatrix({ x: 0, y: 0, z: -1 }).isMirroring()).toBe(false); // a rotation (det +1)
    // ...but seen from +Z (parallel projection) it is a mirror: CCW OCS arcs run CW.
    expect(ocsToWcsMatrix({ x: 0, y: 0, z: -1 }).planeToAffine2(0).isMirroring()).toBe(true);
  });

  it("is the identity for +Z, also for a non-unit extrusion", () => {
    expect(arbitraryAxis({ x: 0, y: 0, z: 5 })).toEqual({
      ax: { x: 1, y: 0, z: 0 },
      ay: { x: 0, y: 1, z: 0 },
      az: { x: 0, y: 0, z: 1 },
    });
    expect(isWcsExtrusion({ x: 0, y: 0, z: 3 })).toBe(true);
    expect(isWcsExtrusion({ x: 0, y: 0, z: -1 })).toBe(false);
  });

  it("uses the strict 1/64 threshold on the normalized vector", () => {
    // Exactly 1/64 is outside the cap (strict <) → Wz × N branch: Ax has no z component.
    const n = { x: 1 / 64, y: 0, z: Math.sqrt(1 - 1 / 4096) };
    expect(arbitraryAxis(n).ax.z).toBe(0);
    // Just inside → Wy × N branch: Ax.y == 0.
    const m = { x: 0.0156, y: 0, z: Math.sqrt(1 - 0.0156 ** 2) };
    expect(arbitraryAxis(m).ax.y).toBe(0);
    expect(arbitraryAxis(m).ax.z).not.toBe(0);
  });

  it("falls back to +Z for a null extrusion", () => {
    expect(normalizeExtrusion({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
    expect(normalizeExtrusion(undefined)).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("produces a right-handed orthonormal frame (property)", () => {
    fc.assert(
      fc.property(dirArb, (n) => {
        const { ax, ay, az } = arbitraryAxis(n);
        expectClose(length3(ax), 1, 1e-12);
        expectClose(length3(ay), 1, 1e-12);
        expect(Math.abs(dot3(ax, ay))).toBeLessThan(1e-12);
        expect(Math.abs(dot3(ax, az))).toBeLessThan(1e-12);
        // (Ax × Ay) = Az
        const c = {
          x: ax.y * ay.z - ax.z * ay.y,
          y: ax.z * ay.x - ax.x * ay.z,
          z: ax.x * ay.y - ax.y * ay.x,
        };
        expectPointClose(c, az, 1e-12);
        expect(ocsToWcsMatrix(n).determinant3()).toBeCloseTo(1, 12);
      }),
      FC_RUNS,
    );
  });

  it("round-trips OCS ↔ WCS (property)", () => {
    fc.assert(
      fc.property(dirArb, vec3Arb(1e4), (n, p) => {
        const axes = arbitraryAxis(n);
        expectPointClose(wcsToOcs(ocsToWcs(p, axes), axes), p, 1e-9);
        const m = ocsToWcsMatrix(n);
        expectPointClose(wcsToOcsMatrix(n).transformPoint(m.transformPoint(p)), p, 1e-9);
        expectPointClose(m.transformPoint(p), ocsToWcs(p, axes), 1e-9);
      }),
      FC_RUNS,
    );
  });

  it("computes thickness vectors along the normalized extrusion", () => {
    expect(thicknessVector({ x: 0, y: 0, z: -2 }, 5)).toEqual({ x: 0, y: 0, z: -5 });
  });
});

describe("entity coordinate system table (note 03 §2.4)", () => {
  it("classifies entities", () => {
    expect(entityCoordinateSystem("ARC")).toBe("ocs");
    expect(entityCoordinateSystem("lwpolyline")).toBe("ocs");
    expect(entityCoordinateSystem("ELLIPSE")).toBe("wcs");
    expect(entityCoordinateSystem("SPLINE")).toBe("wcs");
    expect(entityCoordinateSystem("SOLID")).toBe("ocs");
    expect(entityCoordinateSystem("UNKNOWN_CUSTOM")).toBe("wcs");
    expect(polylineCoordinateSystem(0)).toBe("ocs");
    expect(polylineCoordinateSystem(8)).toBe("wcs");
    expect(polylineCoordinateSystem(64)).toBe("wcs");
    expect(isOcsPoint("POLYLINE", 10, 1)).toBe(true);
    expect(isOcsPoint("POLYLINE", 10, 16)).toBe(false);
    expect(isOcsPoint("DIMENSION", 11)).toBe(true);
    expect(isOcsPoint("DIMENSION", 13)).toBe(false);
    expect(isOcsPoint("LINE", 10)).toBe(false);
  });
});
