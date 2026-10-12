import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    Affine2,
    angleInSweep,
    arcSpanDeg,
    arcSpanRad,
    cosSinDeg,
    cross3,
    degToRad,
    Matrix44,
    normalizeDeg,
    normalizeRad,
    singularValues2,
    TAU,
} from "../src/index.ts";
import { coord, dirArb, expectClose, expectPointClose, FC_RUNS, vec3Arb } from "./helpers.ts";

describe("angles", () => {
    it("normalizes into [0, 360) / [0, 2π)", () => {
        expect(normalizeDeg(-90)).toBe(270);
        expect(normalizeDeg(720)).toBe(0);
        expect(normalizeDeg(-1e-20)).toBe(0);
        expect(normalizeRad(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 15);
        expect(normalizeRad(-1e-300)).toBe(0);
        fc.assert(
            fc.property(coord(1e6), (a) => {
                const n = normalizeRad(a);
                return n >= 0 && n < TAU;
            }),
            FC_RUNS,
        );
    });

    it("implements the ARC span rule (note 03 §3.5)", () => {
        expect(arcSpanDeg(45, 45)).toBe(0); // point
        expect(arcSpanDeg(0, 360)).toBe(360); // full circle
        expect(arcSpanDeg(-180, 180)).toBe(360);
        expect(arcSpanDeg(350, 10)).toBe(20); // wrap
        expect(arcSpanDeg(10, 350)).toBe(340);
        expect(arcSpanRad(1, 1)).toBe(0);
        expect(arcSpanRad(0, TAU)).toBe(TAU);
        expect(arcSpanRad(-Math.PI / 2, Math.PI / 2)).toBeCloseTo(Math.PI, 15);
    });

    it("gives exact cos/sin at quadrant angles", () => {
        expect(cosSinDeg(90)).toEqual([0, 1]);
        expect(cosSinDeg(-90)).toEqual([0, -1]);
        expect(cosSinDeg(540)).toEqual([-1, 0]);
        const [c, s] = cosSinDeg(30);
        expectClose(c, Math.sqrt(3) / 2, 1e-15);
        expectClose(s, 0.5, 1e-15);
    });

    it("tests angles inside a sweep", () => {
        expect(angleInSweep(0, degToRad(350), degToRad(20))).toBe(true);
        expect(angleInSweep(Math.PI, degToRad(350), degToRad(20))).toBe(false);
        expect(angleInSweep(1, 0, TAU)).toBe(true);
    });
});

const matArb = fc
    .record({
        ax: dirArb,
        angle: fc.double({ min: -7, max: 7, noNaN: true }),
        sx: fc.double({ min: 0.1, max: 10, noNaN: true }),
        sy: fc.double({ min: -10, max: -0.1, noNaN: true }),
        sz: fc.double({ min: 0.1, max: 10, noNaN: true }),
        t: vec3Arb(100),
    })
    .map(({ ax, angle, sx, sy, sz, t }) =>
        Matrix44.product(
            Matrix44.translation(t.x, t.y, t.z),
            Matrix44.rotationAxis(ax, angle),
            Matrix44.scaling(sx, sy, sz),
        ),
    );

describe("Matrix44", () => {
    it("uses column-major storage with column vectors (three.js layout)", () => {
        const m = Matrix44.translation(1, 2, 3);
        expect(Array.from(m.m.subarray(12, 15))).toEqual([1, 2, 3]);
        expect(m.get(0, 3)).toBe(1);
        expect(m.transformPoint({ x: 1, y: 1, z: 1 })).toEqual({ x: 2, y: 3, z: 4 });
        expect(m.transformDirection({ x: 1, y: 1, z: 1 })).toEqual({ x: 1, y: 1, z: 1 });
    });

    it("composes right-to-left (A·B applies B first)", () => {
        const t = Matrix44.translation(10, 0, 0);
        const r = Matrix44.rotationZ(Math.PI / 2);
        const p = { x: 1, y: 0, z: 0 };
        expectPointClose(t.multiply(r).transformPoint(p), { x: 10, y: 1, z: 0 }, 1e-15);
        expectPointClose(t.followedBy(r).transformPoint(p), { x: 0, y: 11, z: 0 }, 1e-15);
        expectPointClose(Matrix44.product(t, r).transformPoint(p), { x: 10, y: 1, z: 0 }, 1e-15);
    });

    it("inverts affine matrices (property)", () => {
        fc.assert(
            fc.property(matArb, vec3Arb(100), (m, p) => {
                const inv = m.invert()!;
                expect(inv).toBeDefined();
                expectPointClose(inv.transformPoint(m.transformPoint(p)), p, 1e-9);
                expect(m.multiply(inv).equals(Matrix44.identity(), 1e-9)).toBe(true);
            }),
            FC_RUNS,
        );
    });

    it("computes determinants and detects mirroring", () => {
        fc.assert(
            fc.property(matArb, (m) => {
                // sy < 0 in matArb, so every generated matrix mirrors.
                expect(m.isMirroring()).toBe(true);
                expectClose(m.determinant(), m.determinant3(), 1e-9);
            }),
            FC_RUNS,
        );
        expect(Matrix44.scaling(2, 3, 4).determinant()).toBe(24);
        expect(Matrix44.scaling(1, 1, 0).invert()).toBeUndefined();
        expect(Matrix44.rotationZ(1).isMirroring()).toBe(false);
    });

    it("round-trips through fromRows/transpose/fromArray", () => {
        const m = Matrix44.fromRows(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 0, 0, 1);
        expect(m.get(1, 2)).toBe(7);
        expect(m.transpose().get(2, 1)).toBe(7);
        expect(Matrix44.fromArray(m.m).equals(m)).toBe(true);
        expect(m.isAffine()).toBe(true);
    });

    it("rotationAxis follows the right-hand rule", () => {
        const r = Matrix44.rotationAxis({ x: 0, y: 0, z: 2 }, Math.PI / 2);
        expectPointClose(r.transformPoint({ x: 1, y: 0, z: 0 }), { x: 0, y: 1, z: 0 }, 1e-15);
        fc.assert(
            fc.property(dirArb, fc.double({ min: -7, max: 7, noNaN: true }), vec3Arb(10), (axis, a, v) => {
                const w = Matrix44.rotationAxis(axis, a).transformDirection(v);
                expectClose(Math.hypot(w.x, w.y, w.z), Math.hypot(v.x, v.y, v.z), 1e-12);
            }),
            FC_RUNS,
        );
    });

    it("transforms and projects point arrays like transformPoint", () => {
        fc.assert(
            fc.property(matArb, vec3Arb(100), (m, p) => {
                const a = m.transformPoints3(Float64Array.of(p.x, p.y, p.z));
                const q = m.transformPoint(p);
                expect(Array.from(a)).toEqual([q.x, q.y, q.z]);
                expect(Array.from(m.projectPoints(Float64Array.of(p.x, p.y, p.z)))).toEqual([q.x, q.y]);
            }),
            FC_RUNS,
        );
    });

    it("maps a plane at an elevation to a 2D affine (planeToAffine2)", () => {
        fc.assert(
            fc.property(matArb, coord(100), coord(100), coord(100), (m, x, y, z) => {
                const q = m.transformPoint({ x, y, z });
                const a = m.planeToAffine2(z).apply({ x, y });
                expectPointClose(a, { x: q.x, y: q.y }, 1e-9);
            }),
            FC_RUNS,
        );
    });

    it("cross3 is right-handed", () => {
        expect(cross3({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
    });
});

describe("Affine2", () => {
    it("composes, inverts and detects similarities", () => {
        const m = Affine2.translation(5, 1).multiply(Affine2.rotation(0.3)).multiply(Affine2.scaling(2));
        expect(m.similarityScale()).toBeCloseTo(2, 12);
        const inv = m.invert()!;
        expectPointClose(inv.apply(m.apply({ x: 3, y: -4 })), { x: 3, y: -4 }, 1e-12);
        expect(Affine2.scaling(2, 3).similarityScale()).toBeUndefined();
        expect(Affine2.scaling(-2, 2).similarityScale()).toBeCloseTo(2, 15);
        expect(Affine2.scaling(-2, 2).isMirroring()).toBe(true);
        expect(Affine2.scaling(0, 1).invert()).toBeUndefined();
        const m44 = m.toMatrix44();
        expectPointClose(m44.planeToAffine2(0).apply({ x: 1, y: 2 }), m.apply({ x: 1, y: 2 }), 1e-15);
    });

    it("computes singular values", () => {
        expect(singularValues2(3, 0, 0, -2)).toEqual([3, 2]);
        fc.assert(
            fc.property(coord(10), coord(10), coord(10), coord(10), (a, b, c, d) => {
                const [s1, s2] = singularValues2(a, b, c, d);
                // σ1·σ2 = |det|, σ1² + σ2² = ‖M‖_F²
                expectClose(s1 * s2, Math.abs(a * d - b * c), 1e-9);
                expectClose(s1 * s1 + s2 * s2, a * a + b * b + c * c + d * d, 1e-9);
                expect(s1).toBeGreaterThanOrEqual(s2);
            }),
            FC_RUNS,
        );
    });
});
