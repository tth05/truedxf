// Definitions of the truedxf test fonts (packages/fonts/assets). All glyph designs are original
// work of the truedxf project (MIT, see assets/LICENSES.md) - no Autodesk or third-party font data.

import {
    assemble,
    compileShp,
    decodeFontInfo,
    decompileShx,
    type ShapeOp,
    type ShxFile,
    type ShxShape,
    SIGNATURES,
    writeShx,
} from "../src/index.ts";
import { compileGlyph, type GlyphDef, type Metrics } from "./glyph-dsl.ts";

// ------------------------------------------------------------------------------------------------
// Latin stroke font "truedxf test": cap height 12 (= above), x-height 8, descender 4.
// Curves use octant arcs (code 10), bulge arcs (12/13) and fractional arcs (11); every arc ends on
// the integer grid so rendering does not depend on the pen-rounding hypothesis.

const O_SHAPE = "M1,4 L1,8 O4,4,-4 L9,4 O4,0,-4";
const O_BOWL = "M1,3 L1,5 O3,4,-4 L7,3 O3,0,-4";

export const LATIN: GlyphDef[] = [
    { code: 0x20, name: "space", advance: 8, path: "" },
    { code: 0x21, advance: 4, path: "M2,12 L2,4 M2,1 L2,0" },
    { code: 0x22, advance: 7, path: "M2,12 L2,9 M5,12 L5,9" },
    { code: 0x23, advance: 10, path: "M3,1 L3,11 M7,1 L7,11 M1,4 L9,4 M1,8 L9,8" },
    { code: 0x24, advance: 10, path: "M8,9 F3,0,270 F3,90,-180 M5,13 L5,-1" },
    { code: 0x25, advance: 10, path: "M1,0 L9,12 M3,8 O2,6,8 M7,0 O2,6,8" },
    { code: 0x26, advance: 10, path: "M9,0 L3,8 B7,8,-1 L2,3 B6,0,1 L9,4" },
    { code: 0x27, advance: 4, path: "M2,12 L2,9" },
    { code: 0x28, advance: 6, path: "M5,13 B5,-3,0.4" },
    { code: 0x29, advance: 6, path: "M1,13 B1,-3,-0.4" },
    { code: 0x2a, advance: 10, path: "M5,11 L5,5 M2,10 L8,6 M8,10 L2,6" },
    { code: 0x2b, advance: 10, path: "M5,2 L5,10 M1,6 L9,6" },
    { code: 0x2c, advance: 4, path: "M2,1 L2,0 L1,-2" },
    { code: 0x2d, advance: 8, path: "M1,6 L7,6" },
    { code: 0x2e, advance: 4, path: "M2,0 L2,1" },
    { code: 0x2f, advance: 8, path: "M1,0 L7,12" },
    { code: 0x30, advance: 10, path: `${O_SHAPE} M3,2 L7,10` },
    { code: 0x31, advance: 10, path: "M2,9 L5,12 L5,0 M2,0 L8,0" },
    { code: 0x32, advance: 10, path: "M1,8 O4,4,-4 L1,0 L9,0" },
    { code: 0x33, advance: 10, path: "M1,12 L6,12 B6,6,-1 L3,6 M6,6 B6,0,-1 L1,0" },
    { code: 0x34, advance: 10, path: "M7,0 L7,12 L1,4 L9,4" },
    { code: 0x35, advance: 10, path: "M9,12 L1,12 L1,7 L5,7 B5,0,-1 L1,0" },
    { code: 0x36, advance: 10, path: "M1,4 O4,4,4 O4,0,4 L1,8 B8,12,-0.4" },
    { code: 0x37, advance: 10, path: "M1,12 L9,12 L3,0" },
    { code: 0x38, advance: 10, path: "M5,6 O3,6,8 O3,2,8" },
    { code: 0x39, advance: 10, path: "M9,8 O4,0,4 O4,4,4 L9,4 B2,0,-0.4" },
    { code: 0x3a, advance: 4, path: "M2,8 L2,7 M2,1 L2,0" },
    { code: 0x3b, advance: 4, path: "M2,8 L2,7 M2,1 L2,0 L1,-2" },
    { code: 0x3c, advance: 10, path: "M9,11 L1,6 L9,1" },
    { code: 0x3d, advance: 10, path: "M1,8 L9,8 M1,4 L9,4" },
    { code: 0x3e, advance: 10, path: "M1,11 L9,6 L1,1" },
    { code: 0x3f, advance: 10, path: "M2,9 O3,4,-4 O3,0,-2 L5,4 M5,1 L5,0" },
    { code: 0x40, advance: 10, path: "M7,8 L7,5 O1,4,4 L9,6 O4,0,6 L8,2 M7,6 O2,0,8" },
    { code: 0x41, advance: 10, path: "M1,0 L5,12 L9,0 M2,3 L8,3" },
    { code: 0x42, advance: 10, path: "M1,6 L6,6 B6,12,1 L1,12 L1,0 L6,0 B6,6,1" },
    { code: 0x43, advance: 10, path: "M9,8 B1,8,1 L1,4 B9,4,1" },
    { code: 0x44, advance: 10, path: "M1,0 L1,12 L5,12 O4,2,-2 L9,4 O4,0,-2 L1,0" },
    { code: 0x45, advance: 10, path: "M9,12 L1,12 L1,0 L9,0 M1,6 L7,6" },
    { code: 0x46, advance: 10, path: "M9,12 L1,12 L1,0 M1,6 L7,6" },
    { code: 0x47, advance: 10, path: "M9,8 O4,0,4 L1,4 O4,4,4 L9,6 L6,6" },
    { code: 0x48, advance: 10, path: "M1,0 L1,12 M9,0 L9,12 M1,6 L9,6" },
    { code: 0x49, advance: 4, path: "M2,0 L2,12" },
    { code: 0x4a, advance: 10, path: "M9,12 L9,4 B1,4,-1" },
    { code: 0x4b, advance: 10, path: "M1,0 L1,12 M9,12 L1,4 M4,7 L9,0" },
    { code: 0x4c, advance: 10, path: "M1,12 L1,0 L9,0" },
    { code: 0x4d, advance: 10, path: "M1,0 L1,12 L5,4 L9,12 L9,0" },
    { code: 0x4e, advance: 10, path: "M1,0 L1,12 L9,0 L9,12" },
    { code: 0x4f, advance: 10, path: O_SHAPE },
    { code: 0x50, advance: 10, path: "M1,0 L1,12 L6,12 B6,6,-1 L1,6" },
    { code: 0x51, advance: 10, path: `${O_SHAPE} M6,3 L10,-1` },
    { code: 0x52, advance: 10, path: "M1,0 L1,12 L6,12 B6,6,-1 L1,6 M5,6 L9,0" },
    { code: 0x53, advance: 10, path: "M8,9 F3,0,270 F3,90,-180" },
    { code: 0x54, advance: 10, path: "M1,12 L9,12 M5,12 L5,0" },
    { code: 0x55, advance: 10, path: "M1,12 L1,4 O4,4,4 L9,12" },
    { code: 0x56, advance: 10, path: "M1,12 L5,0 L9,12" },
    { code: 0x57, advance: 10, path: "M1,12 L3,0 L5,8 L7,0 L9,12" },
    { code: 0x58, advance: 10, path: "M1,0 L9,12 M1,12 L9,0" },
    { code: 0x59, advance: 10, path: "M1,12 L5,6 L9,12 M5,6 L5,0" },
    { code: 0x5a, advance: 10, path: "M1,12 L9,12 L1,0 L9,0" },
    { code: 0x5b, advance: 6, path: "M5,13 L2,13 L2,-3 L5,-3" },
    { code: 0x5c, advance: 8, path: "M1,12 L7,0" },
    { code: 0x5d, advance: 6, path: "M1,13 L4,13 L4,-3 L1,-3" },
    { code: 0x5e, advance: 10, path: "M2,9 L5,12 L8,9" },
    { code: 0x5f, advance: 8, path: "M0,-2 L8,-2" },
    { code: 0x60, advance: 6, path: "M2,12 L4,10" },
    { code: 0x61, advance: 8, path: `${O_BOWL} M7,8 L7,0` },
    { code: 0x62, advance: 8, path: `M1,12 L1,0 ${O_BOWL}` },
    { code: 0x63, advance: 8, path: "M7,5 O3,0,4 L1,3 O3,4,4" },
    { code: 0x64, advance: 8, path: `${O_BOWL} M7,12 L7,0` },
    { code: 0x65, advance: 8, path: "M1,4 L7,4 L7,5 O3,0,4 L1,3 B6,0,0.4" },
    { code: 0x66, advance: 7, path: "M3,0 L3,9 B6,12,-0.4142 L7,12 M1,8 L6,8" },
    { code: 0x67, advance: 8, path: `${O_BOWL} M7,8 L7,-1 O3,0,-4` },
    { code: 0x68, advance: 8, path: "M1,12 L1,0 M1,5 O3,4,-4 L7,0" },
    { code: 0x69, advance: 4, path: "M2,0 L2,8 M2,10 L2,11" },
    { code: 0x6a, advance: 6, path: "M4,8 L4,-2 O2,0,-4 M4,10 L4,11" },
    { code: 0x6b, advance: 8, path: "M1,12 L1,0 M7,8 L1,2 M3,4 L7,0" },
    { code: 0x6c, advance: 4, path: "M2,12 L2,0" },
    { code: 0x6d, advance: 10, path: "M1,0 L1,8 M1,6 O2,4,-4 L5,0 M5,6 O2,4,-4 L9,0" },
    { code: 0x6e, advance: 8, path: "M1,0 L1,8 M1,5 O3,4,-4 L7,0" },
    { code: 0x6f, advance: 8, path: O_BOWL },
    { code: 0x70, advance: 8, path: `M1,8 L1,-4 ${O_BOWL}` },
    { code: 0x71, advance: 8, path: `${O_BOWL} M7,8 L7,-4` },
    { code: 0x72, advance: 7, path: "M1,0 L1,8 M1,5 O3,4,-2 L6,8" },
    { code: 0x73, advance: 8, path: "M6,6 F2,0,270 F2,90,-180" },
    { code: 0x74, advance: 8, path: "M3,11 L3,3 O3,4,2 L7,0 M1,8 L6,8" },
    { code: 0x75, advance: 8, path: "M1,8 L1,3 O3,4,4 M7,8 L7,0" },
    { code: 0x76, advance: 8, path: "M1,8 L4,0 L7,8" },
    { code: 0x77, advance: 10, path: "M1,8 L3,0 L5,6 L7,0 L9,8" },
    { code: 0x78, advance: 8, path: "M1,0 L7,8 M1,8 L7,0" },
    { code: 0x79, advance: 8, path: "M1,8 L4,2 L2,-4 M7,8 L4,2" },
    { code: 0x7a, advance: 8, path: "M1,8 L7,8 L1,0 L7,0" },
    { code: 0x7b, advance: 7, path: "M6,13 B4,11,0.4142 L4,7 L3,5 L4,3 L4,-1 B6,-3,0.4142" },
    { code: 0x7c, advance: 4, path: "M2,13 L2,-3" },
    { code: 0x7d, advance: 7, path: "M1,13 B3,11,-0.4142 L3,7 L4,5 L3,3 L3,-1 B1,-3,-0.4142" },
    { code: 0x7e, advance: 8, path: "M1,6 B4,6,-1 B7,6,1" },
];

const DEGREE: Omit<GlyphDef, "code"> = { name: "degree", advance: 8, path: "M4,8 O2,6,8" };
const PLUSMINUS: Omit<GlyphDef, "code"> = {
    name: "plusminus",
    advance: 10,
    path: "M5,4 L5,12 M1,8 L9,8 M1,2 L9,2",
};
const DIAMETER: Omit<GlyphDef, "code"> = { name: "diameter", advance: 10, path: `${O_SHAPE} M0,-1 L10,13` };

// Accented letters: accent drawn relative to the (vertically shifted) origin inside push/pop, then
// the base letter as a subshape (exercises codes 5, 6, 7 and 14).
const dots = (x1: number, x2: number, y: number) => `M${x1},${y} L${x1},${y + 1} M${x2},${y} L${x2},${y + 1}`;
function accented(code: number, base: number, accent: string, adv: number, vy = -12): GlyphDef {
    return { code, advance: adv, path: `P V${-Math.floor(adv / 2)},${vy} ${accent} Q S${base}` };
}
export const ACCENTED: GlyphDef[] = [
    accented(0xc4, 0x41, dots(3, 7, 14), 10),
    accented(0xd6, 0x4f, dots(3, 7, 14), 10),
    accented(0xdc, 0x55, dots(3, 7, 14), 10),
    accented(0xe4, 0x61, dots(2, 6, 10), 8),
    accented(0xf6, 0x6f, dots(2, 6, 10), 8),
    accented(0xfc, 0x75, dots(2, 6, 10), 8),
    accented(0xe9, 0x65, "M3,10 L5,12", 8),
    { code: 0xdf, name: "sharp s", advance: 9, path: "M1,0 L1,9 O3,4,-4 B4,6,-0.6 B4,0,-1" },
];

export const TEST_METRICS: Metrics = { above: 12, below: 4 };

function lfOps(m: Metrics): ShapeOp[] {
    // Line feed: one line down; in vertical text the next column to the right (ADSK requires shape 10).
    const pitch = m.above + m.below + 4;
    return [
        { op: "penUp" },
        { op: "xy", dx: 0, dy: -pitch },
        { op: "verticalOnly" },
        { op: "xy", dx: 2 * pitch, dy: pitch },
    ];
}

function glyphShapes(defs: GlyphDef[], metrics: Metrics, kind: ShxFile["kind"]): ShxShape[] {
    const adv = new Map(defs.map((d) => [d.code, d.advance]));
    const advanceOf = (c: number) => {
        const a = adv.get(c);
        if (a === undefined) throw new Error(`unknown subshape ${c}`);
        return a;
    };
    return defs.map((d) => {
        const vertical = !d.path.includes(" S");
        const ops = compileGlyph(d, { metrics, advanceOf, vertical });
        const name = d.name ?? (d.code >= 0x21 && d.code < 0x7f ? String.fromCharCode(d.code) : "");
        return { number: d.code, name, bytes: assemble(ops, kind) };
    });
}

function latinDefs(unicode: boolean): GlyphDef[] {
    const specials: GlyphDef[] = unicode
        ? [
              { code: 0xb0, ...DEGREE },
              { code: 0xb1, ...PLUSMINUS },
              { code: 0xd8, ...DIAMETER },
              { code: 0x2205, ...DIAMETER },
          ]
        : // Non-Unicode fonts: %%d %%p %%c are shapes 256, 257, 258 (ADSK "Text Font Descriptions").
          [
              { code: 256, ...DEGREE },
              { code: 257, ...PLUSMINUS },
              { code: 258, ...DIAMETER },
          ];
    return [...LATIN, ...ACCENTED, ...specials];
}

/** truedxf-test.shx: non-Unicode shape font ("AutoCAD-86 shapes 1.1"). */
export function buildTestShapesFont(): ShxFile {
    const m = TEST_METRICS;
    const shapes: ShxShape[] = [
        { number: 0, name: "truedxf test font (MIT)", bytes: Uint8Array.from([m.above, m.below, 2, 0]) },
        { number: 10, name: "lf", bytes: assemble(lfOps(m), "shapes") },
        ...glyphShapes(latinDefs(false), m, "shapes"),
    ].sort((a, b) => a.number - b.number);
    return fileOf("shapes", shapes, SIGNATURES.shapes11);
}

/** truedxf-test-uni.shx: the same glyphs as a Unicode font ("AutoCAD-86 unifont 1.0"). */
export function buildTestUnifont(): ShxFile {
    const m = TEST_METRICS;
    const shapes: ShxShape[] = [
        { number: 10, name: "lf", bytes: assemble(lfOps(m), "unifont") },
        ...glyphShapes(latinDefs(true), m, "unifont"),
    ].sort((a, b) => a.number - b.number);
    const f = fileOf("unifont", shapes, SIGNATURES.unifont);
    f.info = {
        name: "truedxf test unifont (MIT)",
        above: m.above,
        below: m.below,
        modes: 2,
        encoding: 0,
        embed: 0,
        tail: Uint8Array.from([m.above, m.below, 2, 0, 0, 0]),
    };
    return f;
}

function fileOf(kind: ShxFile["kind"], shapes: ShxShape[], signature: string): ShxFile {
    // Round-trip through the parser model to fill `info` consistently.
    const file: ShxFile = { kind, signature, shapes, info: undefined, ranges: [], warnings: [] };
    const s0 = shapes.find((s) => s.number === 0);
    if (s0 && kind !== "unifont") file.info = decodeFontInfo(kind, s0.name, s0.bytes);
    return file;
}

// ------------------------------------------------------------------------------------------------
// Bigfont "truedxf big": Shift-JIS escape ranges, 16-unit cell (above 16 ≠ the Latin font's 12,
// to probe how AutoCAD scales bigfont glyphs relative to the primary font - note 04 §8.15).

export const BIG_METRICS: Metrics = { above: 16, below: 0 };

let sjisMap: Map<string, number> | undefined;

/** Shift-JIS code (lead·256 + trail) of a character, via the platform decoder (windows-31j). */
export function sjisCode(ch: string): number {
    if (!sjisMap) {
        sjisMap = new Map();
        const dec = new TextDecoder("shift_jis");
        for (let lead = 0x81; lead <= 0xfc; lead++) {
            if (lead > 0x9f && lead < 0xe0) continue;
            for (let trail = 0x40; trail <= 0xfc; trail++) {
                if (trail === 0x7f) continue;
                const c = dec.decode(Uint8Array.of(lead, trail));
                if (c.length === 1 && c !== "�" && !sjisMap.has(c)) sjisMap.set(c, lead * 256 + trail);
            }
        }
    }
    const code = sjisMap.get(ch);
    if (code === undefined) throw new Error(`no Shift-JIS code for ${ch}`);
    return code;
}

export const BIG_GLYPHS: Array<{ ch: string; path: string }> = [
    { ch: "一", path: "M1,8 L15,8" },
    { ch: "二", path: "M3,12 L13,12 M1,3 L15,3" },
    { ch: "三", path: "M2,14 L14,14 M3,8 L13,8 M1,1 L15,1" },
    { ch: "十", path: "M1,9 L15,9 M8,15 L8,0" },
    { ch: "口", path: "M2,13 L2,1 M2,13 L14,13 L14,1 M2,2 L14,2" },
    { ch: "中", path: "M2,11 L2,4 M2,11 L14,11 L14,4 M2,5 L14,5 M8,15 L8,0" },
    { ch: "日", path: "M3,15 L3,0 M3,15 L13,15 L13,0 M3,8 L13,8 M3,1 L13,1" },
    { ch: "田", path: "M2,14 L2,1 M2,14 L14,14 L14,1 M2,2 L14,2 M8,14 L8,2 M2,8 L14,8" },
    { ch: "山", path: "M8,15 L8,2 M2,10 L2,2 L14,2 M14,10 L14,1" },
    { ch: "川", path: "M4,15 L4,8 B1,0,0.3 M8,14 L8,2 M13,15 L13,0" },
    { ch: "人", path: "M8,15 L8,10 B1,0,0.25 M8,10 B15,0,-0.25" },
    { ch: "大", path: "M1,10 L15,10 M8,15 L8,10 B1,0,0.25 M8,10 B15,0,-0.25" },
    // "○1": circle drawn here, digit from the *primary* font via a 1-byte subshape (like special.shx).
    { ch: "①", path: "M8,0 O7,6,8 M5,4 s49" },
];

/** truedxf-big.shx: a small bigfont ("AutoCAD-86 bigfont 1.0", hash-table index). */
export function buildTestBigfont(): ShxFile {
    const m = BIG_METRICS;
    const advance = 18;
    const shapes: ShxShape[] = [
        { number: 0, name: "truedxf big (MIT)", bytes: Uint8Array.from([m.above, m.below, 2, 0]) },
    ];
    for (const g of BIG_GLYPHS) {
        const code = sjisCode(g.ch);
        const ops = compileGlyph({ code, advance, path: g.path }, { metrics: m, advanceOf: () => 0 });
        // Glyph names are the raw DBCS code bytes, as in gbcbig.shx.
        const name = String.fromCharCode(code >> 8, code & 0xff);
        shapes.push({ number: code, name, bytes: assemble(ops, "bigfont") });
    }
    const file = fileOf("bigfont", shapes, SIGNATURES.bigfont);
    file.ranges = [
        [0x81, 0x9f],
        [0xe0, 0xfc],
    ];
    return file;
}

// ------------------------------------------------------------------------------------------------
// Extended bigfont "truedxf extbig": primitives in a 16 × 16 cell, glyphs composed with the
// extended subshape `7,0,shape(2),x,y,width,height` (ADSK "Extended Big Font Files").

export function buildTestExtBigfont(): ShxFile {
    const cell = 16;
    const prim = (path: string) =>
        compileGlyph(
            { code: 0, advance: 0, path },
            { metrics: { above: cell, below: 0 }, advanceOf: () => 0, vertical: false },
        );
    const P_BOX = 0x8101;
    const P_CROSS = 0x8102;
    const P_RING = 0x8103;
    const primitives: Array<[number, ShapeOp[]]> = [
        [P_BOX, prim("M0,0 L0,16 L16,16 L16,0 L0,0")],
        [P_CROSS, prim("M0,8 L16,8 M8,0 L8,16")],
        [P_RING, prim("M8,0 O8,6,8")],
    ];
    const ext = (shape: number, x: number, y: number, w: number, h: number): ShapeOp => ({
        op: "subshapeExt",
        shape,
        x,
        y,
        width: w,
        height: h,
    });
    const advanceMove: ShapeOp[] = [{ op: "penUp" }, { op: "xy", dx: 18, dy: 0 }];
    const composites: Array<[string, ShapeOp[]]> = [
        ["口", [ext(P_BOX, 1, 1, 14, 14), ...advanceMove]],
        ["田", [ext(P_BOX, 1, 1, 14, 14), ext(P_CROSS, 1, 1, 14, 14), ...advanceMove]],
        ["日", [ext(P_BOX, 3, 0, 10, 8), ext(P_BOX, 3, 8, 10, 8), ...advanceMove]],
        ["〇", [ext(P_RING, 0, 2, 16, 12), ...advanceMove]], // ellipse: non-uniform primitive scaling
    ];
    const shapes: ShxShape[] = [
        // Extended header: character height, 0, modes, character width, 0.
        { number: 0, name: "truedxf extbig (MIT)", bytes: Uint8Array.from([cell, 0, 2, cell, 0]) },
        ...primitives.map(([n, ops]) => ({ number: n, name: "", bytes: assemble(ops, "bigfont") })),
        ...composites.map(([ch, ops]) => {
            const code = sjisCode(ch);
            return {
                number: code,
                name: String.fromCharCode(code >> 8, code & 0xff),
                bytes: assemble(ops, "bigfont"),
            };
        }),
    ];
    const file = fileOf("bigfont", shapes, SIGNATURES.bigfont);
    file.ranges = [
        [0x81, 0x9f],
        [0xe0, 0xfc],
    ];
    return file;
}

// ------------------------------------------------------------------------------------------------
// Shape file for complex linetypes / SHAPE entities (no shape 0; looked up by name).

export const LT_SHAPES: Array<{ number: number; name: string; source: string }> = [
    // Values in .shp syntax so the file doubles as documentation of the encodings.
    { number: 150, name: "TDX_BOX", source: "014,010,01C,018,0" }, // 1×1 square, lower-left at the point
    { number: 151, name: "TDX_CIRC", source: "10,(1,-040),0" }, // circle r = 1 through the point (octant arc)
    { number: 152, name: "TDX_ZIG", source: "012,01E,0" }, // zigzag up/down
    { number: 153, name: "TDX_TRACK", source: "2,014,1,01C,01C,2,014,0" }, // centred vertical tick
    { number: 154, name: "TDX_ARC", source: "12,(2,0,127),0" }, // semicircle via bulge arc
    { number: 155, name: "TDX_WAVE", source: "13,(2,0,127),(2,0,-127),(0,0),0" }, // polyarc S-wave
    { number: 156, name: "TDX_ARROW", source: "2,8,(-2,1),1,8,(2,-1),8,(-2,-1),0" }, // chevron ending at the point
    { number: 157, name: "TDX_FRAC", source: "11,(0,0,0,2,004),0" }, // fractional-arc semicircle r = 2
    { number: 158, name: "TDX_HALF", source: "3,2,014,010,01C,018,4,2,0" }, // half-size box (codes 3/4)
];

export function buildTestLinetypeShapes(): ShxFile {
    const src = LT_SHAPES.map((s) => {
        const n = s.source.split(",").length;
        return `*${s.number},${n},${s.name}\n${s.source}`;
    }).join("\n");
    // Count bytes by compiling (parenthesised lists make the token count differ from the byte count).
    const { file } = compileShp(src);
    const fixed = LT_SHAPES.map(
        (s, i) => `*${s.number},${file.shapes[i]!.bytes.length},${s.name}\n${s.source}`,
    ).join("\n");
    const { file: out, warnings } = compileShp(fixed, { signature: SIGNATURES.shapes10 });
    if (warnings.length) throw new Error(warnings.join("; "));
    return out;
}

// ------------------------------------------------------------------------------------------------
// Probe font: glyphs whose AutoCAD rendering answers open questions (note 04 §4.3, §8.3).
// Each probe draws the construct under test, then a short marker from the resulting pen position.

export interface Probe {
    ch: string;
    question: string;
    ops: ShapeOp[];
}

const marker: ShapeOp[] = [
    { op: "penDown" },
    { op: "vector", length: 2, dir: 4 },
    { op: "penUp" },
    { op: "vector", length: 2, dir: 12 },
];

export const PROBES: Probe[] = [
    {
        ch: "A",
        question:
            "pen rounding after an octant arc (r 10, 0-45 deg): marker at x = 7.071 (exact) or 7 (rounded)?",
        ops: [
            { op: "xy", dx: 10, dy: 0 },
            { op: "octantArc", radius: 10, start: 0, count: 1, cw: false },
            { op: "penUp" },
            ...marker,
        ],
    },
    {
        ch: "B",
        question: "same arc, then 8,(0,-7) drawn: does the line end at (7.071,0.071) or (7,0)?",
        ops: [
            { op: "xy", dx: 10, dy: 0 },
            { op: "octantArc", radius: 10, start: 0, count: 1, cw: false },
            { op: "xy", dx: 0, dy: -7 },
            { op: "penUp" },
            ...marker,
        ],
    },
    {
        ch: "C",
        question: "fractional arc with offsets: ADSK example 11,(56,28,0,3,012) = 55-95 deg, at scale 4",
        ops: [
            { op: "multiply", n: 4 },
            { op: "fracArc", startOffset: 56, endOffset: 28, radius: 3, start: 1, count: 2, cw: false },
            { op: "divide", n: 4 },
            { op: "penUp" },
            ...marker,
        ],
    },
    {
        ch: "D",
        question:
            "rounding under scale 1/2: arc r 15 (7.5) ends at (-2.197,5.303); grid 1 -> (-2,5), grid 0.5 -> (-2,5.5)?",
        ops: [
            { op: "divide", n: 2 },
            { op: "octantArc", radius: 15, start: 0, count: 1, cw: false },
            { op: "multiply", n: 2 },
            { op: "penUp" },
            ...marker,
        ],
    },
    {
        ch: "E",
        question: "bulge arc tessellation: semicircle of diameter 12 (segment count in PLOT)",
        ops: [{ op: "bulgeArc", dx: 12, dy: 0, bulge: 127 }, { op: "penUp" }, ...marker],
    },
    {
        ch: "F",
        question: "full octant circle r = 6 (tessellation) and pen return",
        ops: [
            { op: "xy", dx: 6, dy: 0 },
            { op: "octantArc", radius: 6, start: 4, count: 0, cw: true },
            { op: "penUp" },
            ...marker,
        ],
    },
    {
        ch: "G",
        question: "does a scale set in one glyph persist into the next? (ends with scale 2)",
        ops: [{ op: "vector", length: 4, dir: 0 }, { op: "multiply", n: 2 }, { op: "penUp" }],
    },
    {
        ch: "H",
        question: "pen-down without movement: dot or nothing?",
        ops: [
            { op: "penUp" },
            { op: "vector", length: 4, dir: 2 },
            { op: "penDown" },
            { op: "penUp" },
            { op: "vector", length: 4, dir: 14 },
        ],
    },
    {
        ch: "I",
        question: "zero-length displacement with the pen down: dot or nothing?",
        ops: [
            { op: "penUp" },
            { op: "vector", length: 4, dir: 2 },
            { op: "penDown" },
            { op: "xy", dx: 0, dy: 0 },
            { op: "penUp" },
            { op: "vector", length: 4, dir: 14 },
        ],
    },
    {
        ch: "J",
        question: "glyph ending above the baseline (end y = 3): does the next glyph start at y = 3?",
        ops: [{ op: "vector", length: 4, dir: 0 }, { op: "penUp" }, { op: "vector", length: 3, dir: 4 }],
    },
    {
        ch: "K",
        question: "fractional arc end offset 0 (= 256) and octant count C: 11,(0,0,0,6,016) = 45-315 deg?",
        ops: [
            { op: "xy", dx: 4, dy: 4 },
            { op: "fracArc", startOffset: 0, endOffset: 0, radius: 6, start: 1, count: 6, cw: false },
            { op: "penUp" },
            ...marker,
        ],
    },
];

/** truedxf-probe.shx: unifont with one probe per capital letter. */
export function buildProbeFont(): ShxFile {
    const shapes: ShxShape[] = PROBES.map((p) => ({
        number: p.ch.codePointAt(0)!,
        name: p.ch.toLowerCase(),
        bytes: assemble([...p.ops, { op: "penUp" }, { op: "xy", dx: 4, dy: 0 }], "unifont"),
    }));
    shapes.unshift({
        number: 0x20,
        name: "space",
        bytes: assemble([{ op: "penUp" }, { op: "xy", dx: 8, dy: 0 }], "unifont"),
    });
    const f = fileOf("unifont", shapes, SIGNATURES.unifont);
    f.info = {
        name: "truedxf probe (MIT)",
        above: 12,
        below: 4,
        modes: 0,
        encoding: 0,
        embed: 0,
        tail: Uint8Array.from([12, 4, 0, 0, 0, 0]),
    };
    return f;
}

// ------------------------------------------------------------------------------------------------

export interface AssetFile {
    name: string;
    /** Binary .shx content. */
    shx: Uint8Array;
    /** .shp source (Latin-1 text). */
    shp: string;
}

const HEADER = (title: string) =>
    [
        `;; ${title}`,
        ";; Generated by packages/fonts/scripts/build-test-fonts.ts - do not edit by hand.",
        ";; Original glyph designs of the truedxf project, MIT licence (see LICENSES.md).",
        "",
    ].join("\n");

function asset(name: string, title: string, file: ShxFile, notes: string[] = []): AssetFile {
    const shp = HEADER(title) + notes.map((n) => `;; ${n}\n`).join("") + decompileShx(file);
    return { name, shx: writeShx(file), shp };
}

/** All test font assets, deterministic. */
export function buildAssets(): AssetFile[] {
    return [
        asset(
            "truedxf-test",
            "truedxf-test.shx - Latin stroke font (AutoCAD-86 shapes 1.1)",
            buildTestShapesFont(),
        ),
        asset("truedxf-test-uni", "truedxf-test-uni.shx - the same glyphs as a unifont", buildTestUnifont()),
        asset("truedxf-big", "truedxf-big.shx - small Shift-JIS bigfont", buildTestBigfont()),
        asset(
            "truedxf-extbig",
            "truedxf-extbig.shx - extended bigfont (7,0 subshapes)",
            buildTestExtBigfont(),
        ),
        asset("truedxf-lt", "truedxf-lt.shx - shapes for complex linetypes", buildTestLinetypeShapes()),
        asset(
            "truedxf-probe",
            "truedxf-probe.shx - probe glyphs for open SHX questions",
            buildProbeFont(),
            PROBES.map((p) => `${p.ch}: ${p.question}`),
        ),
    ];
}

/** Linetype definitions using truedxf-lt.shx (AutoCAD .lin syntax). */
export const TEST_LIN = `;; truedxf.lin - complex linetypes using truedxf-lt.shx (MIT, truedxf project)
*TDX_BOXES,Boxes ---- [] ---- [] ----
A,.5,-.2,[TDX_BOX,truedxf-lt.shx,x=-.1,y=-.1,s=.2],-.2
*TDX_CIRCLES,Circles ---- o ---- o ----
A,.5,-.2,[TDX_CIRC,truedxf-lt.shx,x=-.1,s=.1],-.2
*TDX_ZIGZAG,Zig zag /\\/\\/\\/\\
A,.0001,-.2,[TDX_ZIG,truedxf-lt.shx,x=-.2,s=.2],-.4,[TDX_ZIG,truedxf-lt.shx,r=180,x=.2,s=.2],-.2
*TDX_TRACKS,Tracks -|-|-|-|-|-
A,.15,[TDX_TRACK,truedxf-lt.shx,s=.25],.15
*TDX_WAVES,Waves ~~~~
A,.0001,[TDX_WAVE,truedxf-lt.shx,s=.1],-.4
*TDX_ARROWS,Arrows ---->---->
A,.5,[TDX_ARROW,truedxf-lt.shx,s=.1],-.1
`;
