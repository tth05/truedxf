import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAssets, PROBES, sjisCode } from "../scripts/test-fonts.ts";
import { compileShp, parseShx, ShxFont, StyleFont, strokesBounds, writeShx } from "../src/index.ts";

const assets = join(import.meta.dirname, "..", "assets");
const load = (name: string) => new Uint8Array(readFileSync(join(assets, name)));
const font = (name: string, opts = {}) => ShxFont.fromBytes(load(name), name, opts);

describe("committed test fonts", () => {
  const built = buildAssets();

  it("match the generator byte for byte", () => {
    for (const a of built) {
      expect(load(`${a.name}.shx`), a.name).toEqual(a.shx);
      expect(readFileSync(join(assets, `${a.name}.shp`), "latin1"), a.name).toBe(a.shp);
    }
  });

  it("compile from their committed .shp sources to the same bytes", () => {
    for (const a of built) {
      const src = readFileSync(join(assets, `${a.name}.shp`), "latin1");
      const parsed = parseShx(load(`${a.name}.shx`));
      const { file, warnings } = compileShp(src, { signature: parsed.signature });
      expect(warnings, a.name).toEqual([]);
      expect(writeShx(file), a.name).toEqual(a.shx);
    }
  });

  it("decode every glyph without warnings, in both orientations", () => {
    for (const a of built) {
      const f = font(`${a.name}.shx`);
      for (const s of f.file.shapes) {
        if (s.number === 0) continue;
        f.glyph(s.number);
        f.glyph(s.number, { vertical: true });
      }
      // The circled digit of truedxf-big needs the primary font (companion) for its subshape.
      expect(new Set(f.warnings), a.name).toEqual(
        new Set(a.name === "truedxf-big" ? ["shape 34624: missing subshape 49"] : []),
      );
    }
  });
});

describe("truedxf-test.shx", () => {
  const f = font("truedxf-test.shx");

  it("has the designed metrics", () => {
    expect(f.file.signature).toBe("AutoCAD-86 shapes 1.1");
    expect([f.capHeight, f.descent, f.modes]).toEqual([12, 4, 2]);
    expect(f.scaleForHeight(3)).toBe(0.25);
    const A = f.glyph(0x41)!;
    expect(A.advance).toBe(10);
    expect(A.advanceY).toBe(0);
    expect(A.bounds).toEqual({ xMin: 1, yMin: 0, xMax: 9, yMax: 12 });
    expect(f.glyph(0x20)!.strokes).toEqual([]);
    expect(f.glyph(0x20)!.advance).toBe(8);
    // %%d %%p %%c are shapes 256–258 in a non-Unicode font
    expect([256, 257, 258].every((c) => f.hasGlyph(c))).toBe(true);
  });

  it("keeps all ink between descender and accent height and all ends on the grid", () => {
    const exactFont = font("truedxf-test.shx", { penRounding: "none" });
    for (const s of f.file.shapes) {
      if (s.number === 0 || s.number === 10) continue;
      const g = f.glyph(s.number)!;
      expect(Number.isInteger(g.advance) && g.advanceY === 0, `glyph ${s.number}`).toBe(true);
      if (!g.bounds) continue;
      expect(g.bounds.yMin).toBeGreaterThanOrEqual(-4 - 1e-9);
      expect(g.bounds.yMax).toBeLessThanOrEqual(15 + 1e-9);
      // exact and rounded pen arithmetic agree (no glyph depends on the rounding hypothesis)
      const exact = exactFont.glyph(s.number)!;
      expect(exact.advance).toBeCloseTo(g.advance, 9);
    }
  });

  it("stacks glyphs downward in vertical mode", () => {
    const v = f.glyph(0x41, { vertical: true })!;
    expect([v.advance, v.advanceY]).toEqual([0, -18]);
    expect(v.bounds).toEqual({ xMin: -4, yMin: -12, xMax: 4, yMax: 0 });
    const ae = f.glyph(0xc4, { vertical: true })!;
    expect([ae.advance, ae.advanceY]).toEqual([0, -18]);
    expect(ae.bounds!.yMax).toBe(3); // dots 3 above the (shifted) cap line
  });

  it("builds accented letters from subshapes and push/pop", () => {
    const ae = f.glyph(0xc4)!;
    expect(ae.advance).toBe(10);
    expect(ae.strokes).toHaveLength(2 + f.glyph(0x41)!.strokes.length);
    expect(strokesBounds(ae.strokes)).toEqual({ xMin: 1, yMin: 0, xMax: 9, yMax: 15 });
  });

  it("the unifont variant has the same glyphs at Unicode code points", () => {
    const u = font("truedxf-test-uni.shx");
    expect(u.isUnicode).toBe(true);
    for (const [uni, shp] of [
      [0xb0, 256],
      [0xb1, 257],
      [0x2205, 258],
      [0xd8, 258],
      [0x41, 0x41],
      [0xfc, 0xfc],
    ] as const) {
      expect(u.glyph(uni)!.strokes, `U+${uni.toString(16)}`).toEqual(f.glyph(shp)!.strokes);
    }
  });
});

describe("bigfonts", () => {
  it("truedxf-big: DBCS lookup through the escape ranges, companion subshapes", () => {
    const big = font("truedxf-big.shx");
    expect(big.isBigFont).toBe(true);
    expect(big.capHeight).toBe(16);
    const code = sjisCode("中");
    expect(code).toBe(0x9286);
    expect(big.splitCodes([0x41, 0x92, 0x86])).toEqual([0x41, 0x9286]);
    expect(big.glyph(code)!.advance).toBe(18);
    const primary = font("truedxf-test.shx");
    const style = new StyleFont(primary, big);
    const circled = style.glyph(sjisCode("①"))!;
    expect(circled.font).toBeInstanceOf(ShxFont);
    expect(circled.scale).toBe(1 / 16);
    // circle + the primary font's "1" (3 strokes)
    const g = circled.glyph;
    expect(g.kind === "strokes" && g.strokes.length).toBe(1 + primary.glyph(0x31)!.strokes.length);
    // single-byte codes come from the primary font at its own scale
    expect(style.glyph(0x41)).toMatchObject({ font: primary, scale: 1 / 12, fallback: false });
    // missing SHX glyphs render as "?"
    expect(style.glyph(0x7f)).toMatchObject({ fallback: true, glyph: primary.glyph(0x3f) });
  });

  it("truedxf-extbig: extended subshapes scale primitives non-uniformly", () => {
    const ext = font("truedxf-extbig.shx");
    expect(ext.file.info?.extended).toEqual({ height: 16, width: 16 });
    expect(ext.glyph(sjisCode("口"))!.bounds).toEqual({ xMin: 1, yMin: 1, xMax: 15, yMax: 15 });
    const ring = ext.glyph(sjisCode("〇"))!;
    const b = ring.bounds!;
    expect([b.xMin, b.xMax, b.yMin, b.yMax].map((v) => +v.toFixed(9))).toEqual([0, 16, 2, 14]);
    expect(ring.advance).toBe(18);
  });
});

describe("truedxf-lt.shx", () => {
  it("is a shape file with named shapes", () => {
    const lt = font("truedxf-lt.shx");
    expect(lt.isShapeFile).toBe(true);
    expect(lt.glyphByName("tdx_box")!.bounds).toEqual({ xMin: 0, yMin: 0, xMax: 1, yMax: 1 });
    const c = lt.glyphByName("TDX_CIRC")!.bounds!;
    expect([c.xMin, c.xMax, c.yMin, c.yMax].map((v) => +v.toFixed(9))).toEqual([0, 2, -1, 1]);
    expect(lt.glyphByName("TDX_HALF")!.bounds).toEqual({ xMin: 0, yMin: 0, xMax: 0.5, yMax: 0.5 });
  });
});

describe("truedxf-probe.shx", () => {
  it("probe A distinguishes the pen-rounding hypotheses", () => {
    const exact = font("truedxf-probe.shx", { penRounding: "none" }).glyph(0x41)!;
    const rounded = font("truedxf-probe.shx").glyph(0x41)!;
    expect(exact.advance).toBeCloseTo(10 * Math.SQRT1_2 + 4, 9);
    expect(rounded.advance).toBe(11);
    expect(PROBES).toHaveLength(11);
  });
});
