import { describe, expect, it } from "vitest";
import { extractFace, faceCount, flattenPath, isSfnt, pathBounds, readNames, TtfFont } from "../src/index.ts";
import { latinGlyphs, makeOtf } from "./helpers.ts";

describe("TtfFont (generated OpenType/CFF font)", () => {
    const bytes = makeOtf({ family: "Test Sans", glyphs: latinGlyphs(700), descender: -210 });
    const f = new TtfFont(bytes, "test.otf");

    it("scales by the yMax of glyph A (AutoCAD cap height rule), not ascender or em", () => {
        expect(f.capHeight).toBe(700);
        expect(f.capHeightSource).toBe("A");
        expect(f.scaleForHeight(3.5)).toBeCloseTo(0.005, 12);
        expect(f.unitsPerEm).toBe(1000);
        expect(f.ascent).toBe(800);
        expect(f.descent).toBe(210); // hhea descender, positive
        expect(f.family).toBe("Test Sans");
    });

    it("returns outlines in font units with plain advances", () => {
        const a = f.glyph(0x41)!;
        expect(a.kind).toBe("outline");
        expect(a.advance).toBe(600);
        expect(a.bounds).toEqual({ xMin: 0, yMin: 0, xMax: 600, yMax: 700 });
        expect(a.path[0]).toEqual({ type: "M", x: 0, y: 0 });
        expect(a.path.at(-1)).toEqual({ type: "Z" });
        expect(f.hasGlyph(0x41)).toBe(true);
        expect(f.hasGlyph(0x2205)).toBe(false);
        expect(f.glyph(0x2205)).toBeUndefined();
        expect(f.glyph(0x41)).toBe(a); // cached
    });

    it("computes exact ink boxes of cubic outlines (curve extrema, not control points)", () => {
        const x = f.glyph(0x78)!;
        expect(x.path.some((c) => c.type === "C")).toBe(true);
        const b = x.bounds!;
        // Dense sampling of the flattened outline approaches the exact extremum from below.
        const pts = flattenPath(x.path, { segments: 2000 })[0]!;
        const ys = pts.filter((_, i) => i % 2 === 1);
        expect(b.yMax).toBeGreaterThanOrEqual(Math.max(...ys) - 1e-9);
        expect(b.yMax).toBeLessThan(Math.max(...ys) + 1e-3);
        let maxControl = -Infinity;
        for (const c of x.path) if (c.type === "C") maxControl = Math.max(maxControl, c.y1, c.y2);
        expect(b.yMax).toBeLessThan(maxControl - 5);
    });

    it("flattens outlines into closed contours", () => {
        const [c] = flattenPath(f.glyph(0x41)!.path, { scale: 0.01 });
        expect(c!.map((v) => +v.toFixed(9))).toEqual([0, 0, 3, 7, 6, 0]);
        const curvy = flattenPath(f.glyph(0x78)!.path, { segments: 4 });
        expect(curvy[0]!.length / 2).toBe(16);
        const fine = flattenPath(f.glyph(0x78)!.path, { tolerance: 0.5 });
        expect(fine[0]!.length).toBeGreaterThan(curvy[0]!.length);
    });

    it("falls back to OS/2 cap height when there is no A", () => {
        const noA = new TtfFont(makeOtf({ family: "No A", glyphs: latinGlyphs().slice(1) }));
        expect(noA.capHeightSource).not.toBe("A");
        expect(noA.capHeight).toBeGreaterThan(0);
    });
});

describe("sfnt helpers", () => {
    const regular = makeOtf({ family: "Fam", glyphs: latinGlyphs() });
    const bold = makeOtf({ family: "Fam", style: "Bold", bold: true, glyphs: latinGlyphs(720) });

    it("reads family names and style bits", () => {
        expect(isSfnt(regular)).toBe(true);
        expect(readNames(regular)).toMatchObject({
            family: "Fam",
            subfamily: "Regular",
            bold: false,
            italic: false,
        });
        expect(readNames(bold)).toMatchObject({ family: "Fam", subfamily: "Bold", bold: true });
    });

    it("extracts faces from a TrueType collection", () => {
        const ttc = buildTtc([regular, bold]);
        expect(faceCount(ttc)).toBe(2);
        expect(readNames(ttc, 1).bold).toBe(true);
        const face1 = extractFace(ttc, 1);
        expect(new TtfFont(face1).capHeight).toBe(720);
        expect(new TtfFont(ttc, "x.ttc", { face: 1 }).capHeight).toBe(720);
        expect(new TtfFont(ttc).capHeight).toBe(700);
        expect(pathBounds([])).toBeUndefined();
    });
});

/** Minimal TTC writer: faces keep their own tables (no sharing). */
function buildTtc(faces: Uint8Array[]): Uint8Array {
    const header = 12 + 4 * faces.length;
    const parts: Uint8Array[] = [];
    const offsets: number[] = [];
    let at = header;
    for (const f of faces) {
        const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
        const n = dv.getUint16(4);
        // Rebase this face's table offsets: directory at `at`, tables follow it.
        const copy = new Uint8Array(f.length + ((4 - (f.length % 4)) % 4));
        copy.set(f);
        const cdv = new DataView(copy.buffer);
        for (let i = 0; i < n; i++) cdv.setUint32(12 + 16 * i + 8, dv.getUint32(12 + 16 * i + 8) + at);
        offsets.push(at);
        parts.push(copy);
        at += copy.length;
    }
    const out = new Uint8Array(at);
    const dv = new DataView(out.buffer);
    out.set([0x74, 0x74, 0x63, 0x66], 0);
    dv.setUint32(4, 0x00010000);
    dv.setUint32(8, faces.length);
    for (const [i, o] of offsets.entries()) dv.setUint32(12 + 4 * i, o);
    let p = header;
    for (const part of parts) {
        out.set(part, p);
        p += part.length;
    }
    return out;
}
