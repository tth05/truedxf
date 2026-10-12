import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FontManager, MemoryFontProvider } from "@truedxf/fonts";
import { TextFonts, type TextStyleSpec } from "../src/index.ts";

const ASSETS = join(import.meta.dirname, "..", "..", "fonts", "assets");
const ACAD_FONTS = "C:/Program Files/Autodesk/AutoCAD 2027/Fonts";
const WIN_FONTS = "C:/Windows/Fonts";

export function style(name: string, font: string, extra: Partial<TextStyleSpec> = {}): TextStyleSpec {
    return {
        name,
        font,
        bigFont: "",
        widthFactor: 1,
        oblique: 0,
        generationFlags: 0,
        fixedHeight: 0,
        vertical: false,
        ...extra,
    };
}

/** Optional local fonts (AutoCAD / Windows); tests using them skip when absent. */
export const SIMPLEX = join(ACAD_FONTS, "simplex.shx");
export const ARIAL = join(WIN_FONTS, "arial.ttf");
export const LATO = join(WIN_FONTS, "LatoWeb-Regular.ttf");
export const hasSimplex = existsSync(SIMPLEX);
export const hasArial = existsSync(ARIAL);
export const hasLato = existsSync(LATO);

/** TextFonts over the MIT test fonts plus whichever local fonts exist. */
export async function testFonts(
    styles: TextStyleSpec[],
    inline: { name: string; bold: boolean; italic: boolean }[] = [],
) {
    const p = new MemoryFontProvider();
    for (const f of ["truedxf-test.shx", "truedxf-test-uni.shx", "truedxf-big.shx"])
        p.add(f, new Uint8Array(readFileSync(join(ASSETS, f))));
    for (const f of [SIMPLEX, ARIAL, LATO]) if (existsSync(f)) p.add(f, new Uint8Array(readFileSync(f)));
    const m = new FontManager(p, { fontAlt: "truedxf-test.shx" });
    const fonts = new TextFonts(m, styles);
    await fonts.prepare(inline);
    return fonts;
}
