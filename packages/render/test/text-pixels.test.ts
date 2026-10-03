/**
 * Whole-pixel glyph advances of TrueType strings in AutoCAD's raster plot (note 04 §14). The
 * expected step patterns are measured in the AutoCAD 2027 references text-probes/ttf-adv-text-*.
 */

import { TtfFont } from "@truedxf/fonts";
import { Affine2 } from "@truedxf/geometry";
import type { GlyphPlacement } from "@truedxf/text";
import { describe, expect, it } from "vitest";
import { makeOtf } from "../../fonts/test/helpers.ts";
import { pixelRunShifts } from "../src/index.ts";
import { PixelGrid } from "../src/raster.ts";
import { largeCjkPixelTriangles } from "../src/text.ts";

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

describe("large SimSun CJK device origins (note 04 §15.3)", () => {
  const font = new TtfFont(
    makeOtf({
      family: "SimSun",
      unitsPerEm: 256,
      glyphs: [
        {
          unicode: 0x4e95,
          advance: 256,
          contours: [
            [
              [0, 0],
              [256, 0],
              [256, 256],
              [0, 256],
            ],
          ],
        },
      ],
    }),
    "test-simsun.otf",
  );
  const glyph: GlyphPlacement = {
    font,
    glyph: font.glyph(0x4e95)!,
    matrix: Affine2.identity(),
    color: undefined,
  };
  const tri = Float64Array.of(0.25, -0.75, 100.25, 0.75, 50.5, 100.25);
  const gridAt = (x = 0, y = 0) =>
    new PixelGrid({ minX: x, minY: y, maxX: x + 1800, maxY: y + 1350 }, [2000, 1500]);
  const transform = (x: number, y: number) => new Affine2(300 / 179, 0, 0, 300 / 179, x, y);

  it("steps the anchor without changing its relative outline or fractional size", () => {
    const grid = gridAt();
    const base = largeCjkPixelTriangles(glyph, tri, transform(100, 900), grid)!;
    for (const phase of [0.25, 0.5, 0.75]) {
      expect(largeCjkPixelTriangles(glyph, tri, transform(100 + phase * 0.9, 900), grid)).toEqual(base);
      const moved = largeCjkPixelTriangles(glyph, tri, transform(100, 900 + phase * 0.9), grid)!;
      expect([...moved].map((v, i) => v - base[i]!)).toEqual([0, 1, 0, 1, 0, 1]);
    }
    const cold = largeCjkPixelTriangles(glyph, tri, transform(100, 300), grid)!;
    expect(largeCjkPixelTriangles(glyph, tri, transform(100, 300 + 0.5 * 0.9), grid)).toEqual(cold);
  });

  it("keeps the near/far device coordinates identical at integer anchor ties", () => {
    const origin = [-1693771.8719396493, 137862.7242351754] as const;
    const near = largeCjkPixelTriangles(glyph, tri, transform(100, 900), gridAt());
    const far = largeCjkPixelTriangles(
      glyph,
      tri,
      transform(origin[0] + 100, origin[1] + 900),
      gridAt(...origin),
    );
    expect(far).toEqual(near);
  });

  it("truncates an off-page string origin before applying whole-pixel glyph advances", () => {
    const grid = gridAt();
    const anchor = { x: -0.2, y: 900 };
    const first = largeCjkPixelTriangles(glyph, tri, transform(anchor.x, anchor.y), grid, anchor)!;
    const next = largeCjkPixelTriangles(glyph, tri, transform(anchor.x + 477 * 0.9, anchor.y), grid, anchor)!;
    expect([...next].map((v, i) => v - first[i]!)).toEqual([477, 0, 477, 0, 477, 0]);
  });

  it("leaves small, stretched, rotated and non-CJK glyphs on their existing path", () => {
    const grid = gridAt();
    expect(largeCjkPixelTriangles(glyph, tri, Affine2.scaling(0.5), grid)).toBeUndefined();
    expect(largeCjkPixelTriangles(glyph, tri, Affine2.scaling(2, 3), grid)).toBeUndefined();
    expect(
      largeCjkPixelTriangles(glyph, tri, Affine2.rotation(0.1).multiply(Affine2.scaling(2)), grid),
    ).toBeUndefined();
    expect(
      largeCjkPixelTriangles(
        { ...glyph, glyph: { ...glyph.glyph, code: 0x41 } },
        tri,
        Affine2.scaling(2),
        grid,
      ),
    ).toBeUndefined();
  });
});
