// Dev tool: renders the glyphs of a font file (SHX or TTF/OTF) to an SVG sheet for eyeballing.
// Usage: node packages/fonts/scripts/render-svg.ts <font> <out.svg> [--vertical] [--codes=41,42,…]
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { FontManager, flattenPath, flattenStrokes, MemoryFontProvider, ShxFont } from "../src/index.ts";

const [fontPath, outPath, ...flags] = process.argv.slice(2);
if (!fontPath || !outPath) {
    console.error("usage: render-svg.ts <font> <out.svg> [--vertical] [--codes=…]");
    process.exit(1);
}
const vertical = flags.includes("--vertical");
const codesFlag = flags.find((f) => f.startsWith("--codes="));
const bytes = new Uint8Array(readFileSync(fontPath));
const font = new FontManager(new MemoryFontProvider()).fromBytes(bytes, basename(fontPath));
if (!font) throw new Error("unsupported font");
let codes: number[];
if (codesFlag)
    codes = codesFlag
        .slice(8)
        .split(",")
        .map((c) => Number.parseInt(c, 16));
else if (font instanceof ShxFont)
    codes = font.file.shapes.map((s) => s.number).filter((n) => n !== 0 && n !== 10);
else codes = Array.from({ length: 95 }, (_, i) => i + 32);

const cell = 60; // px per text height
const cols = 16;
const s = cell / font.capHeight;
const parts: string[] = [];
codes.forEach((code, i) => {
    const g = font.glyph(code, { vertical });
    const ox = (i % cols) * cell * 1.6 + cell * 0.3;
    const oy = Math.floor(i / cols) * cell * 2 + cell * 1.4;
    parts.push(
        `<text x="${ox}" y="${oy + cell * 0.5}" font-size="9" fill="#999">${code.toString(16)}</text>`,
    );
    parts.push(`<line x1="${ox}" y1="${oy}" x2="${ox + cell * 1.4}" y2="${oy}" stroke="#ddd"/>`);
    if (!g) return;
    parts.push(
        `<line x1="${ox + g.advance * s}" y1="${oy + 4}" x2="${ox + g.advance * s}" y2="${oy - 4}" stroke="#f66"/>`,
    );
    const tx = (x: number) => (ox + x).toFixed(2);
    const ty = (y: number) => (oy - y).toFixed(2);
    if (g.kind === "strokes") {
        for (const pl of flattenStrokes(g.strokes, { scale: s })) {
            const pts: string[] = [];
            for (let k = 0; k < pl.length; k += 2) pts.push(`${tx(pl[k]!)},${ty(pl[k + 1]!)}`);
            if (pts.length === 1) pts.push(pts[0]!);
            parts.push(
                `<polyline points="${pts.join(" ")}" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`,
            );
        }
    } else {
        const d = flattenPath(g.path, { scale: s, tolerance: 0.1 })
            .map((pl) => {
                let p = "";
                for (let k = 0; k < pl.length; k += 2) p += `${k ? "L" : "M"}${tx(pl[k]!)},${ty(pl[k + 1]!)}`;
                return `${p}Z`;
            })
            .join("");
        parts.push(`<path d="${d}" fill="#000" fill-rule="nonzero"/>`);
    }
});
const w = cols * cell * 1.6 + cell;
const h = Math.ceil(codes.length / cols) * cell * 2 + cell;
writeFileSync(
    outPath,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#fff"/>${parts.join("")}</svg>`,
);
console.log(`${codes.length} glyphs → ${outPath}`);
