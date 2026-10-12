// Local-only tests against the fonts installed on the development machine (AutoCAD 2027 SHX fonts,
// Windows TrueType fonts). They skip when the folders are missing. No font data is copied or
// committed — assertions only use values already documented in research/notes/04-text-fonts.md.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
    compileShp,
    DirectoryFontProvider,
    decompileShx,
    disassemble,
    FontManager,
    parseShx,
    ShxFont,
    TtfFont,
    writeShx,
} from "../src/index.ts";

const ACAD = "C:/Program Files/Autodesk/AutoCAD 2027/Fonts";
const WIN = "C:/Windows/Fonts";
const hasAcad = existsSync(ACAD);
const hasWin = existsSync(`${WIN}/arial.ttf`);

const shxFiles = hasAcad ? readdirSync(ACAD).filter((n) => n.toLowerCase().endsWith(".shx")) : [];
const read = (dir: string, n: string) => new Uint8Array(readFileSync(`${dir}/${n}`));
// vitest's deep equality is slow on MB-sized arrays
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(a, b) === 0;

describe.skipIf(!hasAcad)("AutoCAD 2027 SHX fonts (local)", () => {
    it("finds the font folder", () => {
        expect(shxFiles.length).toBeGreaterThan(70);
    });

    it("parses every file without warnings and rewrites it byte-identically", () => {
        for (const n of shxFiles) {
            const bytes = read(ACAD, n);
            const file = parseShx(bytes);
            expect(file.warnings, n).toEqual([]);
            expect(same(writeShx(file), bytes), n).toBe(true);
            const { file: re, warnings } = compileShp(decompileShx(file), { signature: file.signature });
            expect(warnings, n).toEqual([]);
            if (file.header?.indexCount !== undefined) re.header = { indexCount: file.header.indexCount };
            expect(same(writeShx(re), bytes), n).toBe(true);
        }
    }, 120_000);

    it("decodes every glyph of every file, horizontally and vertically, with sane metrics", () => {
        const txt = ShxFont.fromBytes(read(ACAD, "txt.shx"), "txt.shx");
        let glyphs = 0;
        const problems: string[] = [];
        for (const n of shxFiles) {
            const raw = ShxFont.fromBytes(read(ACAD, n), n);
            // Bigfonts reference the primary font's shapes (special.shx), so decode them with txt.shx.
            const f = raw.isBigFont ? raw.withCompanion(txt) : raw;
            expect(f.capHeight, n).toBeGreaterThan(0);
            expect(f.descent, n).toBeGreaterThanOrEqual(0);
            for (const s of f.file.shapes) {
                if (s.number === 0) continue;
                for (const vertical of [false, true]) {
                    const g = f.glyph(s.number, { vertical });
                    glyphs++;
                    const where = `${n} shape ${s.number}${vertical ? " (vertical)" : ""}`;
                    if (!g) {
                        problems.push(`${where}: no glyph`);
                        continue;
                    }
                    let ok = Number.isFinite(g.advance) && Number.isFinite(g.advanceY);
                    for (const st of g.strokes)
                        for (const v of st.vertices) ok &&= Number.isFinite(v.x + v.y + v.bulge);
                    if (!ok) problems.push(`${where}: non-finite geometry`);
                    if (g.bounds && !f.isShapeFile) {
                        // ink stays within a few cap heights of the origin
                        const lim = 6 * f.capHeight + 150;
                        const b = g.bounds;
                        if (Math.max(-b.xMin, b.xMax, -b.yMin, b.yMax) > lim)
                            problems.push(`${where}: ink far away`);
                    }
                }
            }
            // Shape 1 ("start of text") pushes and shape 13 (CR) pops the line start: the position stack
            // spans characters in AutoCAD, so decoding them alone under- or overflows. Nothing else warns.
            expect(
                f.warnings.filter((w) => !/position stack underflow|left on the stack/.test(w)),
                n,
            ).toEqual([]);
        }
        expect(problems).toEqual([]);
        expect(glyphs).toBeGreaterThan(100000);
    }, 120_000);

    it("unifont 2-byte subshape numbers are big-endian (every reference resolves only that way)", () => {
        let be = 0;
        let le = 0;
        for (const n of shxFiles) {
            const file = parseShx(read(ACAD, n));
            if (file.kind !== "unifont") continue;
            const numbers = new Set(file.shapes.map((s) => s.number));
            for (const s of file.shapes)
                for (const o of disassemble(s.bytes, "unifont").ops) {
                    if (o.op !== "subshape") continue;
                    const swapped = ((o.shape & 0xff) << 8) | (o.shape >> 8);
                    if (numbers.has(o.shape)) be++;
                    if (numbers.has(swapped) && swapped !== o.shape) le++;
                }
        }
        expect(be).toBeGreaterThan(800);
        expect(le).toBe(0);
    });

    it("matches the AutoCAD 2027 TEXTBOX measurements of note 04 §4.6 (h = 10)", () => {
        const at10 = (n: string) => {
            const f = ShxFont.fromBytes(read(ACAD, n), n);
            const a = f.glyph(0x41)!;
            const s = f.scaleForHeight(10);
            return { f, a, s };
        };
        const txt = at10("txt.shx");
        expect(txt.a.bounds!.xMax * txt.s - txt.a.bounds!.xMin * txt.s).toBeCloseTo(6.6667, 3);
        expect(txt.a.bounds!.yMax * txt.s).toBeCloseTo(10, 9);
        expect(txt.a.advance * txt.s).toBeCloseTo(10, 9);
        expect(txt.f.descent / txt.f.capHeight).toBeCloseTo(1 / 3, 12);
        const simplex = at10("simplex.shx");
        expect((simplex.a.bounds!.xMax - simplex.a.bounds!.xMin) * simplex.s).toBeCloseTo(7.61905, 4);
        // Pen advance of simplex "A" is 22 units (10.476 at h = 10); note 04 §4.6 quotes "≈ 9.5238"
        // (20 units) — unverified, not asserted.
        const romans = at10("romans.shx");
        expect(romans.a.bounds!.xMin * romans.s).toBeCloseTo(0.476, 3);
        expect(romans.a.bounds!.xMax * romans.s).toBeCloseTo(8.095, 3);
        const isocp = at10("isocp.shx");
        const b = isocp.a.bounds!;
        expect([b.xMin, b.xMax, b.yMin, b.yMax].map((v) => +(v * isocp.s).toFixed(4))).toEqual([
            1.5, 7.5, 0.5, 9.5,
        ]);
    });

    it("pen rounding after arcs puts chineset.shx arc glyphs on its 48-unit advance grid", () => {
        const exact = ShxFont.fromBytes(read(ACAD, "chineset.shx"), "c", { penRounding: "none" });
        const rounded = ShxFont.fromBytes(read(ACAD, "chineset.shx"), "c");
        let offGridExact = 0;
        let offGridRounded = 0;
        for (const s of exact.file.shapes) {
            const ops = exact.ops(s.number) ?? [];
            if (!ops.some((o) => o.op === "octantArc" || o.op === "fracArc")) continue;
            if (!Number.isInteger(exact.glyph(s.number)!.advance)) offGridExact++;
            if (!Number.isInteger(rounded.glyph(s.number)!.advance)) offGridRounded++;
        }
        expect(offGridExact).toBeGreaterThan(10);
        expect(offGridRounded).toBe(0);
    });
});

// Restrict the family index to a few families so the test does not read all of C:\Windows\Fonts.
const WIN_SUBSET =
    /^(arial|arialbd|ariali|arialbi|ariblk|times|timesbd|calibri|cambria|LiberationSans-.*)\.(ttf|ttc)$/i;

describe.skipIf(!hasWin)("Windows TrueType fonts (local)", () => {
    const ttf = (n: string) => new TtfFont(read(WIN, n), n);

    it("Arial: cap height = A.yMax 1466 (not sCapHeight 1467), hhea descent 434, no kerning", () => {
        const f = ttf("arial.ttf");
        expect(f.capHeight).toBe(1466);
        expect(f.metrics.os2CapHeight).toBe(1467);
        expect(f.descent).toBe(434);
        expect(f.unitsPerEm).toBe(2048);
        const a = f.glyph(0x41)!;
        expect(a.advance).toBe(1366);
        expect(a.bounds).toMatchObject({ xMin: -3, xMax: 1369, yMin: 0, yMax: 1466 });
        expect(f.glyph(0x78)!.bounds!.yMax).toBe(1062);
        expect(f.glyph(0x56)!.advance + a.advance).toBe(2732); // "AV" = plain advances
        expect(f.hasGlyph(0x2205)).toBe(false);
        expect(f.hasGlyph(0xd8)).toBe(true);
        expect(f.descent / f.capHeight).toBeCloseTo(0.296044, 6);
    });

    it("Times (A.yMax 1387 vs sCapHeight 1356), Calibri 1300, Liberation Sans 1409", () => {
        const times = ttf("times.ttf");
        expect(times.capHeight).toBe(1387);
        expect(times.glyph(0x48)!.bounds!.yMax / times.capHeight).toBeCloseTo(0.97765, 4);
        if (existsSync(`${WIN}/calibri.ttf`)) expect(ttf("calibri.ttf").capHeight).toBe(1300);
        if (existsSync(`${WIN}/LiberationSans-Regular.ttf`))
            expect(ttf("LiberationSans-Regular.ttf").capHeight).toBe(1409);
    });

    it("resolves families with style bits through a directory provider, incl. .ttc faces", async () => {
        const provider = new DirectoryFontProvider([WIN], {
            readDir: async (d) => (await readdir(d)).filter((n) => WIN_SUBSET.test(n)),
            readFile: async (p) => new Uint8Array(await readFile(p)),
        });
        const m = new FontManager(provider);
        expect((await m.findFamily("Arial"))?.name.toLowerCase()).toBe("arial.ttf");
        expect((await m.findFamily("arial", true))?.name.toLowerCase()).toBe("arialbd.ttf");
        expect((await m.findFamily("Arial", false, true))?.name.toLowerCase()).toBe("ariali.ttf");
        expect((await m.findFamily("Arial", true, true))?.name.toLowerCase()).toBe("arialbi.ttf");
        expect((await m.findFamily("Arial Black"))?.name.toLowerCase()).toBe("ariblk.ttf");
        const r = await m.resolveStyle({ fontFile: "romans.shx", family: "Arial", flags: 34 | (1 << 25) });
        expect(r.font?.primary.name.toLowerCase()).toBe("arialbd.ttf");
        if (existsSync(`${WIN}/cambria.ttc`)) {
            const math = await m.findFamily("Cambria Math");
            expect(math?.name.toLowerCase()).toBe("cambria.ttc#1");
            expect(math!.hasGlyph(0x2205)).toBe(true);
        }
        // Arial lacks U+2205: a configured fallback supplies it at Arial's scale
        const fb = new FontManager(provider, { glyphFallbacks: ["cambria.ttc#1"] });
        const style = (await fb.resolveStyle({ family: "Arial" })).font!;
        const g = style.glyph(0x2205);
        if (existsSync(`${WIN}/cambria.ttc`)) expect(g?.fallback).toBe(true);
    });
});
