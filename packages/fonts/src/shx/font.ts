// ShxFont: the Font implementation for compiled SHX files.

import { strokesBounds } from "../geom.ts";
import type { Font, GlyphOptions, StrokeGlyph } from "../types.ts";
import { disassemble, type ShapeOp } from "./bytecode.ts";
import type { ShxFile, ShxShape } from "./format.ts";
import { type InterpretOptions, interpretOps, type PenRounding, type ShapeSource } from "./interpret.ts";
import { parseShx } from "./parse.ts";

export interface ShxFontOptions {
    penRounding?: PenRounding;
    penGrid?: number;
    maxDepth?: number;
    anisotropicArcSegments?: number;
}

export class ShxFont implements Font, ShapeSource {
    readonly kind = "shx" as const;
    readonly name: string;
    readonly file: ShxFile;
    readonly capHeight: number;
    readonly ascent: number;
    readonly descent: number;
    readonly unitsPerEm: number;
    readonly modes: number;
    get fileKind(): ShxFile["kind"] {
        return this.file.kind;
    }
    readonly cell: { height: number; width: number } | undefined;
    /** Problems found while decoding glyphs (appended lazily as glyphs are requested). */
    readonly warnings: string[] = [];

    private readonly options: ShxFontOptions;
    private readonly byNumber = new Map<number, ShxShape>();
    private byName: Map<string, ShxShape> | undefined;
    private readonly opsCache = new Map<number, readonly ShapeOp[] | undefined>();
    private readonly glyphCache = new Map<number, StrokeGlyph | undefined>();

    constructor(file: ShxFile, name = file.info?.name ?? "", options: ShxFontOptions = {}) {
        this.file = file;
        this.name = name;
        this.options = options;
        for (const s of file.shapes) if (!this.byNumber.has(s.number)) this.byNumber.set(s.number, s);
        const info = file.info;
        this.modes = info?.modes ?? 0;
        this.cell = info?.extended;
        this.warnings.push(...file.warnings);
        let above = info?.above ?? 0;
        // gbcbig.shx's `0, 64, 2, 0` header (format.ts): AutoCAD 2027 draws its glyphs (scaled by
        // 9/102 to ~7.4 units) at 1/8 of the text height, not 1/64: 日 is 7.8 high at h = 10
        // (VERIFIED-BY-ACAD font-probes/bigcp-text, note 04 §10; other fonts with this header form:
        // ASSUMPTION).
        if (file.kind === "bigfont" && info && !info.extended && info.tail[0] === 0 && info.tail.length >= 4)
            above = 8;
        if (above <= 0) {
            // Shape files and broken fonts: use the measured "A" (as ezdxf does), else 1 (plain shapes).
            const a = this.glyph(65);
            above = a?.bounds && a.bounds.yMax > 0 ? a.bounds.yMax : 1;
        }
        this.capHeight = above;
        this.ascent = above;
        this.descent = info?.below ?? 0;
        this.unitsPerEm = above;
    }

    static fromBytes(bytes: Uint8Array, name?: string, options?: ShxFontOptions): ShxFont {
        const file = parseShx(bytes);
        return new ShxFont(file, name, options);
    }

    get isBigFont(): boolean {
        return this.file.kind === "bigfont";
    }

    /** True for fonts indexed by Unicode code points (unifont with encoding 0). */
    get isUnicode(): boolean {
        return this.file.kind === "unifont" && (this.file.info?.encoding ?? 0) === 0;
    }

    /** True for a shape file without font information (SHAPE entities, complex linetypes). */
    get isShapeFile(): boolean {
        return this.file.info === undefined;
    }

    scaleForHeight(height: number): number {
        return height / this.capHeight;
    }

    shape(code: number): ShxShape | undefined {
        return this.byNumber.get(code);
    }

    /** Shape lookup by name, case-insensitive (SHAPE entities and linetypes, note 04 §4.1). */
    shapeByName(name: string): ShxShape | undefined {
        if (!this.byName) {
            this.byName = new Map();
            for (const s of this.file.shapes) {
                const k = s.name.toUpperCase();
                if (s.number !== 0 && k !== "" && !this.byName.has(k)) this.byName.set(k, s);
            }
        }
        return this.byName.get(name.toUpperCase());
    }

    hasGlyph(code: number): boolean {
        return code !== 0 && this.byNumber.has(code);
    }

    /**
     * A view of this (big) font whose subshapes missing from the file resolve in `primary`:
     * special.shx / spec_bar.shx reference the digits and letters of the primary font this way
     * (1-byte subshapes 0x30–0x54 that do not exist in the bigfont itself).
     */
    withCompanion(primary: ShxFont): ShxFont {
        const f = new ShxFont(this.file, this.name, this.options);
        f.companion = primary;
        return f;
    }

    private companion: ShxFont | undefined;

    ops(shape: number): readonly ShapeOp[] | undefined {
        const own = this.ownOps(shape);
        return own ?? this.companion?.ownOps(shape);
    }

    private ownOps(shape: number): readonly ShapeOp[] | undefined {
        if (this.opsCache.has(shape)) return this.opsCache.get(shape);
        const s = this.byNumber.get(shape);
        let ops: readonly ShapeOp[] | undefined;
        if (s) {
            const d = disassemble(s.bytes, this.file.kind);
            if (d.truncated) this.warnings.push(`shape ${shape}: bytecode truncated`);
            ops = d.ops;
        }
        this.opsCache.set(shape, ops);
        return ops;
    }

    /** Runs a shape with explicit options (not cached). */
    render(code: number, options: GlyphOptions & InterpretOptions = {}): StrokeGlyph | undefined {
        const ops = code === 0 ? undefined : this.ops(code);
        if (!ops) return undefined;
        const r = interpretOps(ops, this, { ...this.options, ...options }, code);
        for (const w of r.warnings) this.warnings.push(w);
        return {
            kind: "strokes",
            code,
            strokes: r.strokes,
            advance: r.endX,
            advanceY: r.endY,
            bounds: strokesBounds(r.strokes),
        };
    }

    glyph(code: number, options: GlyphOptions = {}): StrokeGlyph | undefined {
        const vertical = options.vertical === true && this.modes === 2;
        const key = vertical ? -1 - code : code;
        if (this.glyphCache.has(key)) return this.glyphCache.get(key);
        const g = this.render(code, { vertical });
        this.glyphCache.set(key, g);
        return g;
    }

    /** Glyph of a named shape (SHAPE entities, complex linetypes). */
    glyphByName(name: string): StrokeGlyph | undefined {
        const s = this.shapeByName(name);
        return s ? this.glyph(s.number) : undefined;
    }

    /** Bigfont: is `byte` a lead byte of a double-byte code (escape range)? */
    isLeadByte(byte: number): boolean {
        for (const [a, b] of this.file.ranges) if (byte >= a && byte <= b) return true;
        return false;
    }

    /**
     * Bigfont text lookup: bytes inside the escape ranges combine with the next byte into a DBCS
     * code (lead·256 + trail); other bytes stay single codes (note 04 §4.2).
     */
    splitCodes(bytes: ArrayLike<number>): number[] {
        const out: number[] = [];
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i]!;
            if (this.isBigFont && this.isLeadByte(b) && i + 1 < bytes.length) {
                out.push(b * 256 + bytes[i + 1]!);
                i++;
            } else out.push(b);
        }
        return out;
    }
}
