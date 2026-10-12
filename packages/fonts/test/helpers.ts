// Test helpers: build tiny OpenType (CFF) fonts in memory with opentype.js.
import * as ns from "opentype.js";

// biome-ignore lint/suspicious/noExplicitAny: opentype.js 2.x has no matching typings
const ot: any = (ns as any).Font ? ns : (ns as any).default;

export interface GlyphSpec {
    unicode: number;
    advance: number;
    /** Closed polygon(s) in font units; a contour with `curve: true` uses one cubic per edge. */
    contours: Array<Array<[number, number]>>;
    curve?: boolean;
}

export interface OtfSpec {
    family: string;
    style?: string;
    unitsPerEm?: number;
    ascender?: number;
    descender?: number;
    glyphs: GlyphSpec[];
    bold?: boolean;
    italic?: boolean;
}

function setFsSelection(bytes: Uint8Array, bold: boolean, italic: boolean): void {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = dv.getUint16(4);
    for (let i = 0; i < n; i++) {
        const r = 12 + 16 * i;
        const tag = String.fromCharCode(bytes[r]!, bytes[r + 1]!, bytes[r + 2]!, bytes[r + 3]!);
        if (tag !== "OS/2") continue;
        const off = dv.getUint32(r + 8);
        let v = dv.getUint16(off + 62) & ~0x61;
        if (bold) v |= 0x20;
        if (italic) v |= 0x01;
        if (!bold && !italic) v |= 0x40;
        dv.setUint16(off + 62, v);
    }
}

export function makeOtf(spec: OtfSpec): Uint8Array {
    const notdef = new ot.Glyph({ name: ".notdef", advanceWidth: 500, path: new ot.Path() });
    const glyphs = [notdef];
    for (const g of spec.glyphs) {
        const p = new ot.Path();
        for (const c of g.contours) {
            p.moveTo(c[0]![0], c[0]![1]);
            for (let i = 1; i <= c.length; i++) {
                const [x, y] = c[i % c.length]!;
                if (g.curve) {
                    const [px, py] = c[i - 1]!;
                    p.curveTo(
                        px + (x - px) / 3,
                        py + (y - py) / 3 + 40,
                        px + (2 * (x - px)) / 3,
                        py + (2 * (y - py)) / 3 + 40,
                        x,
                        y,
                    );
                } else p.lineTo(x, y);
            }
            p.close();
        }
        glyphs.push(
            new ot.Glyph({
                name: `u${g.unicode.toString(16)}`,
                unicode: g.unicode,
                advanceWidth: g.advance,
                path: p,
            }),
        );
    }
    const font = new ot.Font({
        familyName: spec.family,
        styleName: spec.style ?? "Regular",
        unitsPerEm: spec.unitsPerEm ?? 1000,
        ascender: spec.ascender ?? 800,
        descender: spec.descender ?? -200,
        glyphs,
    });
    const bytes = new Uint8Array(font.toArrayBuffer());
    setFsSelection(bytes, spec.bold ?? false, spec.italic ?? false);
    return bytes;
}

/** "A" is a triangle reaching `cap`; "H" a box; "x" a box to 500. */
export function latinGlyphs(cap = 700): GlyphSpec[] {
    return [
        {
            unicode: 0x41,
            advance: 600,
            contours: [
                [
                    [0, 0],
                    [300, cap],
                    [600, 0],
                ],
            ],
        },
        {
            unicode: 0x48,
            advance: 650,
            contours: [
                [
                    [50, 0],
                    [50, cap + 10],
                    [600, cap + 10],
                    [600, 0],
                ],
            ],
        },
        {
            unicode: 0x78,
            advance: 500,
            curve: true,
            contours: [
                [
                    [0, -20],
                    [0, 500],
                    [500, 500],
                    [500, -20],
                ],
            ],
        },
    ];
}
