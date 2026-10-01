import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BIG_FONT_CODE, compileShp, ShxFont, StyleFont } from "@truedxf/fonts";
import { describe, expect, it } from "vitest";
import { bigFontPairCode, glyphCode } from "../src/fonts.ts";

const asset = (n: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "..", "..", "fonts", "assets", n)));
const primary = ShxFont.fromBytes(asset("truedxf-test-uni.shx"), "txt.shx");

describe("glyphCode with a style bigfont (note 04 §4.4)", () => {
  const sf = new StyleFont(primary, ShxFont.fromBytes(asset("truedxf-big.shx"), "truedxf-big.shx"));

  it("encodes into the bigfont's code page, whatever the drawing code page", () => {
    // 一 U+4E00 = Shift-JIS 0x88EA
    for (const enc of ["windows-1252", "gbk", "big5"])
      expect(glyphCode(sf, { cp: 0x4e00 }, enc)).toBe(BIG_FONT_CODE + 0x88ea);
    expect(sf.glyph(glyphCode(sf, { cp: 0x4e00 }, "windows-1252"))?.font).toBe(sf.bigFont);
  });

  it("keeps characters the bigfont lacks with the primary font (by code point)", () => {
    expect(glyphCode(sf, { cp: 0x41 }, "windows-1252")).toBe(0x41);
    expect(glyphCode(sf, { cp: 0xe9 }, "windows-1252")).toBe(0xe9); // é: no Shift-JIS code
  });
});

describe("bigFontPairCode: ASCII escape bytes (special.shx `~`)", () => {
  const { file } = compileShp(
    [
      "*BIGFONT 2,1,07E,07E",
      "*0,4,special test",
      "10,0,2,0",
      "*07E31,4,one",
      "1,014,0",
      "*00020,3,space",
      "2,060,0",
    ].join("\n"),
  );
  const sf = new StyleFont(primary, new ShxFont(file, "special.shx"));

  it("pairs `~` with the next character into one bigfont glyph", () => {
    expect(bigFontPairCode(sf, 0x7e, 0x31)).toBe(BIG_FONT_CODE + 0x7e31);
    expect(bigFontPairCode(sf, 0x7e, 0x39)).toBeUndefined();
    expect(bigFontPairCode(sf, 0x41, 0x31)).toBeUndefined();
    expect(bigFontPairCode(sf, 0x7e, undefined)).toBeUndefined();
  });

  it("takes ASCII the bigfont has (its space) from the bigfont", () => {
    expect(glyphCode(sf, { cp: 0x20 }, "windows-1252")).toBe(BIG_FONT_CODE + 0x20);
    expect(sf.glyph(0x20)?.font).toBe(sf.bigFont);
  });
});
