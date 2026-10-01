import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BIG_FONT_CODE, bigFontEncoding, compileShp, ShxFont, StyleFont } from "../src/index.ts";

const asset = (n: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "..", "assets", n)));

describe("bigFontEncoding (note 04 §4.4)", () => {
  it("knows the bigfonts AutoCAD ships, by base name", () => {
    expect(bigFontEncoding("bigfont.shx", [])).toBe("shift_jis");
    expect(bigFontEncoding("@extfont2.shx", [])).toBe("shift_jis");
    expect(bigFontEncoding("D:/acad/Fonts/CHINESET.SHX", [])).toBe("big5");
    expect(bigFontEncoding("gbcbig", [])).toBe("gbk");
    expect(bigFontEncoding("whgtxt.shx", [])).toBe("euc-kr");
  });

  it("falls back to the escape ranges: Shift-JIS lead bytes, else unknown", () => {
    expect(
      bigFontEncoding("mine.shx", [
        [0x81, 0x9f],
        [0xe0, 0xfc],
      ]),
    ).toBe("shift_jis");
    expect(bigFontEncoding("mine.shx", [[0xa1, 0xfe]])).toBeUndefined();
    expect(bigFontEncoding("mine.shx", [[0x80, 0xff]])).toBeUndefined();
  });
});

describe("StyleFont bigfont addressing", () => {
  const primary = ShxFont.fromBytes(asset("truedxf-test-uni.shx"), "txt.shx");
  const big = ShxFont.fromBytes(asset("truedxf-big.shx"), "truedxf-big.shx");
  const sf = new StyleFont(primary, big);

  it("derives the code page from the escape ranges", () => {
    expect(sf.bigFontEncoding).toBe("shift_jis");
  });

  it("BIG_FONT_CODE + dbcs draws from the bigfont; the same number as a code point does not", () => {
    expect(sf.bigFontCode(0x88ea)).toBe(BIG_FONT_CODE + 0x88ea);
    expect(sf.bigFontCode(0x1234)).toBeUndefined();
    expect(sf.bigFontCode(undefined)).toBeUndefined();
    expect(sf.glyph(BIG_FONT_CODE + 0x88ea)?.font).toBe(sf.bigFont);
    // U+88EA is a CJK ideograph, not Shift-JIS 0x88EA: primary font's "?"
    const r = sf.glyph(0x88ea);
    expect(r?.font).toBe(primary);
    expect(r?.fallback).toBe(true);
  });

  it("uses the gbcbig header form `0, 64, 2, 0` as cap height 8 (VERIFIED-BY-ACAD bigcp-text)", () => {
    const { file } = compileShp(
      ["*BIGFONT 1,1,0A1,0FE", "*0,5,gb", "0,64,2,0,0", "*0B0A1,4,x", "1,014,0"].join("\n"),
    );
    const f = new ShxFont(file, "gbcbig.shx");
    expect(f.isBigFont).toBe(true);
    expect(f.capHeight).toBe(8);
  });
});
