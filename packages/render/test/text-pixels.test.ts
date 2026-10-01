/**
 * Whole-pixel glyph advances of TrueType strings in AutoCAD's raster plot (note 04 §14). The
 * expected step patterns are measured in the AutoCAD 2027 references text-probes/ttf-adv-text-*.
 */
import { Affine2 } from "@truedxf/geometry";
import { describe, expect, it } from "vitest";
import { pixelRunShifts } from "../src/index.ts";

/** Pixel steps between consecutive glyphs of a run of `n` equal advances `a` (px). */
function steps(a: number, n: number): number[] {
  const shifts = pixelRunShifts({ dirX: 1, dirY: 0, advances: new Array(n).fill(a) }, Affine2.identity(), 1)!;
  const pos = shifts.map((s, i) => i * a + s.x);
  return pos.slice(1).map((p, i) => Math.round(p - pos[i]!));
}

describe("TrueType raster pixel advances (note 04 §14)", () => {
  it("front-loads the missing pixels when every gap needs one (r at h = 3: 53 × 15 px, then 14 px)", () => {
    const s = steps(14.5209, 103);
    expect(s.slice(0, 53).every((v) => v === 15)).toBe(true);
    expect(s.slice(53).every((v) => v === 14)).toBe(true);
  });
  it("spaces the missing pixels every P = floor(gaps / E) gaps (n at h = 3: 1000 1000 …)", () => {
    expect(steps(24.2512, 61).join("")).toBe("25242424".repeat(15));
    // s at h = 4: one extra pixel every 16 gaps
    const s = steps(29.0703, 51);
    expect(s.map((v, i) => (v === 30 ? i : -1)).filter((i) => i >= 0)).toEqual([0, 16, 32]);
  });
  it("keeps the first glyph and the floored total width", () => {
    const run = { dirX: 0, dirY: 1, advances: [10.6, 3.2, 7.9, 5.5] };
    const shifts = pixelRunShifts(run, Affine2.scaling(2), 1)!; // 2 px per plane unit along y
    expect(shifts[0]).toEqual({ x: 0, y: 0 });
    expect(shifts.every((s) => s.x === 0)).toBe(true);
    // px: 21.2 6.4 15.8 11 → floors 21 6 15 11, E = 54 − 53 = 1 at gap 0
    expect(shifts.map((s) => +(s.y * 2).toFixed(6))).toEqual([0, 0.8, 0.4, -0.4]);
  });
  it("leaves single characters alone", () => {
    expect(pixelRunShifts({ dirX: 1, dirY: 0, advances: [3.3] }, Affine2.identity(), 1)).toBeUndefined();
  });
});
