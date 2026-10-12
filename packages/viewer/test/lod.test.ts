import { describe, expect, it } from "vitest";
import { needsRetessellation, targetPixelSize } from "../src/lod.ts";

describe("level of detail", () => {
    it("re-tessellates only beyond the factor", () => {
        expect(needsRetessellation(1, 1)).toBe(false);
        expect(needsRetessellation(1, 0.6)).toBe(false);
        expect(needsRetessellation(1, 0.5)).toBe(false);
        expect(needsRetessellation(1, 0.49)).toBe(true);
        expect(needsRetessellation(1, 2)).toBe(false);
        expect(needsRetessellation(1, 2.01)).toBe(true);
        expect(needsRetessellation(1, 1.4, { factor: 1.25 })).toBe(true);
        expect(needsRetessellation(0, 1)).toBe(true);
    });

    it("targets device pixels and clamps deep zoom to the extents", () => {
        expect(targetPixelSize(2, 2, undefined)).toBe(1);
        const ext = { minX: 0, minY: 0, maxX: 65536, maxY: 100 };
        expect(targetPixelSize(1e-6, 1, ext)).toBe(1);
        expect(targetPixelSize(1e-6, 1, ext, { minPixelFraction: 1 / 655360 })).toBeCloseTo(0.1);
        expect(targetPixelSize(8, 1, ext)).toBe(8);
    });
});
