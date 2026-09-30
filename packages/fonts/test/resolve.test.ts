import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ChainFontProvider,
  DirectoryFontProvider,
  type FontFileSystem,
  FontManager,
  MemoryFontProvider,
  ShxFont,
  TtfFont,
} from "../src/index.ts";
import { latinGlyphs, makeOtf } from "./helpers.ts";

const assets = join(import.meta.dirname, "..", "assets");
const asset = (n: string) => new Uint8Array(readFileSync(join(assets, n)));

function provider(): MemoryFontProvider {
  const p = new MemoryFontProvider({
    "simplex.shx": asset("truedxf-test-uni.shx"), // stands in for FONTALT
    "TXT.SHX": asset("truedxf-test.shx"),
    "big.shx": asset("truedxf-big.shx"),
    "lt.shx": asset("truedxf-lt.shx"),
  });
  p.add("fam.otf", makeOtf({ family: "Fam", glyphs: latinGlyphs(700) }));
  p.add("fambd.otf", makeOtf({ family: "Fam", style: "Bold", bold: true, glyphs: latinGlyphs(720) }));
  p.add(
    "fambi.otf",
    makeOtf({ family: "Fam", style: "Bold Italic", bold: true, italic: true, glyphs: latinGlyphs(740) }),
  );
  // A fallback font with a glyph Fam lacks (U+2205), at a different em size.
  p.add(
    "symbols.otf",
    makeOtf({
      family: "Symbols",
      unitsPerEm: 2000,
      glyphs: [
        {
          unicode: 0x2205,
          advance: 1400,
          contours: [
            [
              [0, 0],
              [1400, 0],
              [700, 1400],
            ],
          ],
        },
      ],
    }),
  );
  return p;
}

describe("FontManager.loadFile", () => {
  it("is case-insensitive, extension-optional and cached", async () => {
    const m = new FontManager(provider());
    const txt = await m.loadFile("txt");
    expect(txt).toBeInstanceOf(ShxFont);
    expect(await m.loadFile("TXT.shx")).toBe(txt);
    expect(await m.loadFile("txt.shx")).toBe(await m.loadFile("TXT.SHX"));
    expect(await m.loadFile("fam")).toBeInstanceOf(TtfFont);
    expect(await m.loadFile("nope")).toBeUndefined();
  });
});

describe("FontManager.resolveStyle (AutoCAD 2027 rules, note 04 §4.1)", () => {
  it("group 3 SHX without extension", async () => {
    const r = await new FontManager(provider()).resolveStyle({ fontFile: "txt" });
    expect(r.font?.primary.name).toBe("txt.shx");
    expect(r.substitutions).toEqual([]);
    expect(r.suppressed).toBe(false);
    expect(r.font?.descentRatio).toBe(4 / 12);
  });

  it("XDATA family wins over group 3 and selects bold/italic faces", async () => {
    const m = new FontManager(provider());
    const plain = await m.resolveStyle({ fontFile: "txt.shx", family: "Fam", flags: 34 });
    expect(plain.font?.primary.kind).toBe("ttf");
    expect(plain.font?.primary.capHeight).toBe(700);
    const bold = await m.resolveStyle({ fontFile: "", family: "fam", flags: 34 | (1 << 25) });
    expect(bold.font?.primary.capHeight).toBe(720);
    const bi = await m.resolveStyle({ family: "Fam", flags: (1 << 25) | (1 << 24) });
    expect(bi.font?.primary.capHeight).toBe(740);
    const italicOnly = await m.resolveStyle({ family: "Fam", flags: 1 << 24 });
    // No italic-only face: the closest is Regular (bold match scores above italic match).
    expect(italicOnly.font?.primary.capHeight).toBe(700);
  });

  it("unknown family, missing file, empty group 3 and full paths fall back to FONTALT", async () => {
    const m = new FontManager(provider());
    for (const spec of [
      { family: "Nope" },
      { fontFile: "missing.shx" },
      { fontFile: "" },
      { fontFile: "C:\\fonts\\txt.shx" },
    ]) {
      const r = await m.resolveStyle(spec);
      expect(r.font?.primary.name, JSON.stringify(spec)).toBe("simplex.shx");
      expect(r.substitutions[0]?.used).toBe("simplex.shx");
    }
    const withPaths = new FontManager(provider(), { resolveFullPaths: true });
    expect((await withPaths.resolveStyle({ fontFile: "C:\\fonts\\txt.shx" })).font?.primary.name).toBe(
      "txt.shx",
    );
    expect((await m.resolveStyle({ fontFile: '"txt"' })).font?.primary.name).toBe("txt.shx");
  });

  it("reports a missing FONTALT and uses the last resort", async () => {
    const lastResort = ShxFont.fromBytes(asset("truedxf-test.shx"), "builtin");
    const m = new FontManager(new MemoryFontProvider(), { lastResort });
    const r = await m.resolveStyle({ fontFile: "romans.shx" });
    expect(r.font?.primary).toBe(lastResort);
    expect(r.substitutions.map((s) => s.reason)).toEqual(["missing-font", "fontalt-missing"]);
    const none = await new FontManager(new MemoryFontProvider()).resolveStyle({ fontFile: "x" });
    expect(none.font).toBeUndefined();
  });

  it("applies the font map first", async () => {
    const map = FontManager.parseFontMap("# comment\nromanc.shx;txt.shx\nfoo;fam.otf\n");
    const m = new FontManager(provider(), { fontMap: map });
    const r = await m.resolveStyle({ fontFile: "romanc" });
    expect(r.font?.primary.name).toBe("txt.shx");
    expect(r.substitutions).toEqual([{ reason: "font-map", requested: "romanc", used: "txt.shx" }]);
  });

  it("bigfonts: resolved with SHX primaries, ignored with TTF, missing ones suppress the text", async () => {
    const m = new FontManager(provider());
    const ok = await m.resolveStyle({ fontFile: "txt", bigFontFile: "big.shx" });
    expect(ok.font?.bigFont?.isBigFont).toBe(true);
    const missing = await m.resolveStyle({ fontFile: "txt", bigFontFile: "gbcbig.shx" });
    expect(missing.suppressed).toBe(true);
    expect(missing.substitutions).toEqual([{ reason: "missing-bigfont", requested: "gbcbig.shx" }]);
    const ignoreMissing = await new FontManager(provider(), { missingBigFont: "ignore" }).resolveStyle({
      fontFile: "txt",
      bigFontFile: "gbcbig.shx",
    });
    expect(ignoreMissing.suppressed).toBe(false);
    const withTtf = await m.resolveStyle({ fontFile: "fam.otf", bigFontFile: "big.shx" });
    expect(withTtf.font?.bigFont).toBeUndefined();
    expect(withTtf.substitutions[0]?.reason).toBe("bigfont-ignored");
    const notBig = await m.resolveStyle({ fontFile: "txt", bigFontFile: "lt.shx" });
    expect(notBig.substitutions[0]?.reason).toBe("not-a-bigfont");
  });

  it("TTF glyph fallback at the primary font's (em-normalised) scale", async () => {
    const m = new FontManager(provider(), { glyphFallbacks: ["symbols.otf"] });
    const r = await m.resolveStyle({ family: "Fam" });
    const style = r.font!;
    const a = style.glyph(0x41)!;
    expect(a).toMatchObject({ fallback: false, scale: 1 / 700 });
    const dia = style.glyph(0x2205)!;
    expect(dia.fallback).toBe(true);
    expect(dia.font.name).toBe("symbols.otf");
    expect(dia.scale).toBeCloseTo((1 / 700) * (1000 / 2000), 15);
    expect(style.glyph(0x4e2d)).toBeUndefined();
  });
});

describe("providers", () => {
  it("DirectoryFontProvider: first directory wins, injected file system", async () => {
    const files: Record<string, Uint8Array> = {
      "/a/TXT.SHX": Uint8Array.of(1),
      "/b/txt.shx": Uint8Array.of(2),
      "/b/arial.ttf": Uint8Array.of(3),
      "/b/readme.txt": Uint8Array.of(4),
    };
    const fs: FontFileSystem = {
      async readDir(dir) {
        const pre = `${dir}/`;
        const out = Object.keys(files)
          .filter((k) => k.startsWith(pre))
          .map((k) => k.slice(pre.length));
        if (out.length === 0) throw new Error("ENOENT");
        return out;
      },
      async readFile(p) {
        const b = files[p];
        if (!b) throw new Error("ENOENT");
        return b;
      },
    };
    const d = new DirectoryFontProvider(["/missing", "/a", "/b"], fs);
    expect(await d.getFile("txt.shx")).toEqual(Uint8Array.of(1));
    expect(await d.getFile("ARIAL.TTF")).toEqual(Uint8Array.of(3));
    expect(await d.getFile("readme.txt")).toBeUndefined();
    expect((await d.listFiles()).sort()).toEqual(["TXT.SHX", "arial.ttf"]);
    const chain = new ChainFontProvider([new MemoryFontProvider({ "txt.shx": Uint8Array.of(9) }), d]);
    expect(await chain.getFile("txt.shx")).toEqual(Uint8Array.of(9));
    expect(await chain.getFile("arial.ttf")).toEqual(Uint8Array.of(3));
    expect(await chain.listFiles()).toEqual(["txt.shx", "arial.ttf"]);
  });
});
