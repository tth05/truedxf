import { existsSync, readFileSync } from "node:fs";
import * as ns from "opentype.js";
import { expect, it } from "vitest";
import { TtfFont } from "../src/index.ts";
import { latinGlyphs, makeOtf } from "./helpers.ts";
import { EagerTtfFont } from "./ttf-oracle.ts";

interface ParsedFont {
    tables: Record<string, unknown>;
    charToGlyphIndex(text: string): number;
    getKerningValue(left: number, right: number): number;
}
interface OtModule {
    parse(buffer: ArrayBuffer, options?: { lowMemory: boolean }): ParsedFont;
}
const mod = ns as unknown as { parse?: unknown; default?: unknown };
const ot = (typeof mod.parse === "function" ? mod : mod.default) as OtModule;

const paths = [
    "apps/playground/fonts/LiberationSans-Regular.ttf",
    "apps/playground/fonts/LiberationSerif-Italic.ttf",
    "apps/playground/fonts/LiberationMono-Bold.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/calibri.ttf",
    "C:/Windows/Fonts/simhei.ttf",
];
const inputs: [string, Uint8Array][] = [
    ["generated CFF", makeOtf({ family: "Lazy Test", glyphs: latinGlyphs(700) })],
    ["generated CFF without A", makeOtf({ family: "No A", glyphs: latinGlyphs().slice(1) })],
];
for (const path of paths) if (existsSync(path)) inputs.push([path, new Uint8Array(readFileSync(path))]);

it("preserves eager metrics, cmap indices, outlines, advances, GSUB tables, and kerning", () => {
    const codes = [
        ...Array.from({ length: 256 }, (_, i) => i),
        0x391,
        0x3b1,
        0x410,
        0x627,
        0x20ac,
        0x2205,
        0x4e00,
        0x4e2d,
        0x6587,
        0x6f22,
        0x1f600,
        0x10ffff,
    ];
    for (const [name, bytes] of inputs) {
        const eager = new EagerTtfFont(bytes, name);
        const lazy = new TtfFont(bytes, name);
        expect(lazy.names, name).toEqual(eager.names);
        expect(lazy.metrics, name).toEqual(eager.metrics);
        expect(
            [lazy.capHeight, lazy.capHeightSource, lazy.unitsPerEm, lazy.ascent, lazy.descent],
            name,
        ).toEqual([eager.capHeight, eager.capHeightSource, eager.unitsPerEm, eager.ascent, eager.descent]);
        const buffer = new Uint8Array(bytes).buffer;
        const rawEager = ot.parse(buffer);
        const rawLazy = ot.parse(buffer, { lowMemory: true });
        expect(rawLazy.tables.gsub, name).toEqual(rawEager.tables.gsub);
        for (const code of codes) {
            const text = String.fromCodePoint(code);
            const index = rawEager.charToGlyphIndex(text);
            expect(rawLazy.charToGlyphIndex(text), name).toBe(index);
            expect(lazy.hasGlyph(code), name).toBe(eager.hasGlyph(code));
            expect(lazy.glyph(code), `${name}: ${code}`).toEqual(eager.glyph(code));
            expect(lazy.glyphByIndex(index), `${name}: index ${index}`).toEqual(eager.glyphByIndex(index));
        }
        for (const pair of ["AV", "To", "fi", "Ta", "中文"]) {
            const left = rawEager.charToGlyphIndex(pair[0]!);
            const right = rawEager.charToGlyphIndex(pair[1]!);
            expect(rawLazy.getKerningValue(left, right), `${name}: ${pair}`).toBe(
                rawEager.getKerningValue(left, right),
            );
        }
    }
}, 120000);
