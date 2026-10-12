import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FontManager, MemoryFontProvider, ShxFont } from "../src/index.ts";
import { latinGlyphs, makeOtf } from "./helpers.ts";

const asset = (n: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "..", "assets", n)));

/** A viewer without AutoCAD fonts: no simplex.shx (FONTALT), only a few free files. */
function viewerFonts(): MemoryFontProvider {
    const p = new MemoryFontProvider({
        "txt.shx": asset("truedxf-test-uni.shx"),
        "mybig.shx": asset("truedxf-big.shx"),
    });
    p.add("sans.otf", makeOtf({ family: "Sans", glyphs: latinGlyphs(700) }));
    p.add("comic.otf", makeOtf({ family: "Comic Sans MS", glyphs: latinGlyphs(710) }));
    return p;
}

describe("FontManager missingFont modes", () => {
    it('"autocad": FONTALT, and nothing when FONTALT is missing too', async () => {
        const m = new FontManager(viewerFonts());
        const r = await m.resolveStyle({ fontFile: "romans.shx" });
        expect(r.font).toBeUndefined();
        expect(r.substitutions.map((s) => s.reason)).toEqual(["missing-font", "fontalt-missing"]);
    });

    it('"fallback": the first loadable fallback font', async () => {
        const m = new FontManager(viewerFonts(), {
            missingFont: "fallback",
            fallbackFonts: ["simplex.shx", "sans.otf", "txt.shx"],
        });
        const r = await m.resolveStyle({ fontFile: "romans.shx" });
        expect(r.font?.primary.name).toBe("sans.otf");
        expect(r.substitutions).toEqual([
            { reason: "missing-font", requested: "romans.shx", used: "sans.otf" },
        ]);
        const fam = await m.resolveStyle({ family: "Nope" });
        expect(fam.font?.primary.name).toBe("sans.otf");
        // a TrueType substitute ignores the bigfont, which is still reported when missing
        const big = await m.resolveStyle({ fontFile: "romans.shx", bigFontFile: "gbcbig.shx" });
        expect(big.suppressed).toBe(false);
        expect(big.substitutions.map((s) => s.reason)).toEqual([
            "missing-font",
            "bigfont-ignored",
            "missing-bigfont",
        ]);
    });

    it("missing bigfont: suppressed in autocad mode, drawn (with the fallback bigfont) in fallback mode", async () => {
        const spec = { fontFile: "txt.shx", bigFontFile: "gbcbig.shx" };
        expect((await new FontManager(viewerFonts()).resolveStyle(spec)).suppressed).toBe(true);
        const plain = await new FontManager(viewerFonts(), { missingFont: "fallback" }).resolveStyle(spec);
        expect(plain.suppressed).toBe(false);
        expect(plain.font?.bigFont).toBeUndefined();
        const withBig = await new FontManager(viewerFonts(), {
            missingFont: "fallback",
            fallbackBigFont: "mybig.shx",
        }).resolveStyle(spec);
        expect(withBig.suppressed).toBe(false);
        expect(withBig.font?.bigFont).toBeInstanceOf(ShxFont);
        expect(withBig.substitutions).toEqual([
            { reason: "missing-bigfont", requested: "gbcbig.shx", used: "mybig.shx" },
        ]);
    });

    it("finds an XDATA family through its group-3 TrueType file", async () => {
        // a provider serving files by name only (no family lookup, no listing), like render/text.ts
        const files = viewerFonts();
        const m = new FontManager({ getFile: (n) => files.getFile(n) });
        const r = await m.resolveStyle({ family: "Comic Sans MS", fontFile: "comic.otf" });
        expect(r.font?.primary.name).toBe("comic.otf");
        expect(r.substitutions).toEqual([]);
        // a group-3 file of another family does not count
        const other = await m.resolveStyle({ family: "Comic Sans MS", fontFile: "sans.otf" });
        expect(other.substitutions[0]?.reason).toBe("unknown-family");
    });
});
