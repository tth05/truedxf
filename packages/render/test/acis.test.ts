import { describe, expect, it } from "vitest";
import { satWireframe } from "../src/draw/acis.ts";

const sat = [
    "700 0 1 0",
    "@8 test @12 ACIS 32.0 NT @24 Thu Jan  1 12:00:00 2026",
    "1 9.9999999999999995e-007 1e-010",
    "body $-1 -1 $-1 $-1 $-1 $1 #",
    "transform $-1 -1 1 0 0 0 1 0 0 0 1 100 75 0 1 no_rotate no_reflect no_shear #",
    "edge $-1 -1 $-1 $3 0 $4 10 $-1 $7 forward @7 unknown #",
    "vertex $-1 -1 $-1 $2 $5 #",
    "vertex $-1 -1 $-1 $2 $6 #",
    "point $-1 -1 $-1 0 0 0 #",
    "point $-1 -1 $-1 10 0 0 #",
    "straight-curve $-1 -1 $-1 0 0 0 1 0 0 I I #",
    "End-of-ACIS-data",
];

describe("ACIS wireframe", () => {
    it("draws SAT edges with the body transform", () => {
        const { curves, unsupported } = satWireframe(sat);
        expect(unsupported).toBe(0);
        expect(curves).toEqual([{ kind: "line", p0: { x: 100, y: 75, z: 0 }, p1: { x: 110, y: 75, z: 0 } }]);
    });
});
