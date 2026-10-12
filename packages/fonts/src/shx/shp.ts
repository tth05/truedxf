// .shp source ⇄ ShxFile: a compiler (like AutoCAD's COMPILE) and a decompiler (note 04 §4.2 "SHP
// source"). Syntax: `*number,defbytes,name` headers followed by comma-separated byte values;
// numbers with a leading 0 are hex, parentheses are cosmetic, `;` starts a comment;
// `*UNIFONT,6,name` + `above,below,modes,encoding,embed,0`; `*BIGFONT nchars,nranges,b1,e1,…`.

import { disassemble, type ShapeOp } from "./bytecode.ts";
import { decodeFontInfo, type ShxFile, type ShxKind, type ShxShape, SIGNATURES } from "./format.ts";

interface Token {
    value: number;
    neg: boolean;
    /** Source spelling (decides whether a unifont subshape number is one 16-bit token). */
    text: string;
    line: number;
}

export interface CompileOptions {
    /** Signature for `shapes` files (default "AutoCAD-86 shapes 1.0"). */
    signature?: string;
}

export interface CompileResult {
    file: ShxFile;
    warnings: string[];
}

export class ShpSyntaxError extends Error {
    override name = "ShpSyntaxError";
}

function parseNumber(t: string, line: number): Token {
    const s = t.trim();
    let neg = false;
    let body = s;
    if (body.startsWith("+")) body = body.slice(1);
    else if (body.startsWith("-")) {
        neg = true;
        body = body.slice(1);
    }
    let value: number;
    if (/^0[0-9a-fA-F]+$/.test(body)) value = Number.parseInt(body, 16);
    else if (/^[0-9]+$/.test(body)) value = Number.parseInt(body, 10);
    else throw new ShpSyntaxError(`line ${line}: invalid number "${t}"`);
    return { value: neg ? -value : value, neg, text: s, line };
}

function tokenize(text: string, line: number): Token[] {
    const out: Token[] = [];
    for (const part of text.replace(/[()]/g, " ").split(",")) {
        if (part.trim() === "") continue;
        out.push(parseNumber(part, line));
    }
    return out;
}

/** Converts a value to a two's complement byte (signed displacements, bulges). */
function sByte(t: Token, warnings: string[]): number {
    if (t.value < -128 || t.value > 255) warnings.push(`line ${t.line}: ${t.text} does not fit a byte`);
    return t.value < 0 ? (t.value + 256) & 0xff : t.value & 0xff;
}

/** Octant spec: negative values compile to sign-magnitude (0x80 | value), verified in ltypeshp.shx. */
function octByte(t: Token, warnings: string[]): number {
    const m = Math.abs(t.value);
    if (m > 0x7f && t.neg) warnings.push(`line ${t.line}: octant spec ${t.text} out of range`);
    return t.neg ? 0x80 | (m & 0x7f) : m & 0xff;
}

function uByte(t: Token, warnings: string[]): number {
    if (t.value < 0 || t.value > 255) warnings.push(`line ${t.line}: ${t.text} is not an unsigned byte`);
    return t.value < 0 ? (t.value + 256) & 0xff : t.value & 0xff;
}

/** A token spelled as a 16-bit hex number (`0xxxx`, ≥ 5 characters) or with a value > 255. */
function isWide(t: Token): boolean {
    return t.value > 255 || (/^0[0-9a-fA-F]{4,}$/.test(t.text) && !t.neg);
}

/** Encodes one shape's value tokens into bytecode with role-aware sign conversion. */
function encodeBytecode(tokens: Token[], kind: ShxKind, warnings: string[]): number[] {
    const out: number[] = [];
    let i = 0;
    const next = (): Token | undefined => tokens[i++];
    const need = (role: (t: Token, w: string[]) => number, what: string): boolean => {
        const t = next();
        if (!t) {
            warnings.push(`shape truncated: missing ${what}`);
            return false;
        }
        out.push(role(t, warnings));
        return true;
    };
    const wide = (): boolean => {
        const t = tokens[i];
        if (t && isWide(t)) {
            i++;
            out.push((t.value >> 8) & 0xff, t.value & 0xff);
            return true;
        }
        return need(uByte, "subshape high byte") && need(uByte, "subshape low byte");
    };
    while (i < tokens.length) {
        const t = next()!;
        const c = uByte(t, warnings);
        out.push(c);
        if (c === 0) break;
        if (c >= 0x10) continue;
        switch (c) {
            case 3:
            case 4:
                need(uByte, "scale factor");
                break;
            case 7:
                if (kind === "unifont") wide();
                else if (kind === "bigfont" && tokens[i]?.value === 0) {
                    need(uByte, "extended marker");
                    if (wide()) {
                        need(sByte, "x");
                        need(sByte, "y");
                        need(uByte, "width");
                        need(uByte, "height");
                    }
                } else need(uByte, "subshape");
                break;
            case 8:
                need(sByte, "dx");
                need(sByte, "dy");
                break;
            case 9:
                for (;;) {
                    const a = next();
                    const b = next();
                    if (!a || !b) {
                        warnings.push("unterminated xy list");
                        break;
                    }
                    out.push(sByte(a, warnings), sByte(b, warnings));
                    if (a.value === 0 && b.value === 0) break;
                }
                break;
            case 10:
                need(uByte, "radius");
                need(octByte, "octant spec");
                break;
            case 11:
                need(uByte, "start offset");
                need(uByte, "end offset");
                need(uByte, "high radius");
                need(uByte, "radius");
                need(octByte, "octant spec");
                break;
            case 12:
                need(sByte, "dx");
                need(sByte, "dy");
                need(sByte, "bulge");
                break;
            case 13:
                for (;;) {
                    const a = next();
                    const b = next();
                    if (!a || !b) {
                        warnings.push("unterminated bulge list");
                        break;
                    }
                    out.push(sByte(a, warnings), sByte(b, warnings));
                    if (a.value === 0 && b.value === 0) break;
                    if (!need(sByte, "bulge")) break;
                }
                break;
            default:
                break;
        }
    }
    if (i < tokens.length) {
        warnings.push(`${tokens.length - i} value(s) after the end code kept verbatim`);
        for (; i < tokens.length; i++) out.push(uByte(tokens[i]!, warnings));
    }
    return out;
}

interface RawShape {
    number: number;
    defbytes: number;
    name: string;
    tokens: Token[];
    line: number;
}

/** Compiles .shp source text into an ShxFile (write it with `writeShx`). */
export function compileShp(text: string, options: CompileOptions = {}): CompileResult {
    const warnings: string[] = [];
    const shapesRaw: RawShape[] = [];
    let unifont: { name: string; tokens: Token[]; line: number } | undefined;
    let bigfont: { ranges: Array<[number, number]> } | undefined;
    let current: { tokens: Token[] } | undefined;
    const lines = text.split(/\r?\n/);
    lines.forEach((rawLine, idx) => {
        const line = idx + 1;
        const head = rawLine.trimStart();
        // Header lines keep their name verbatim (names may contain ';' or trailing blanks).
        const semi = head.startsWith("*") ? -1 : rawLine.indexOf(";");
        const l = (semi >= 0 ? rawLine.slice(0, semi) : rawLine).trim();
        if (l === "") return;
        if (head.startsWith("*")) {
            const h = head.slice(1);
            const l2 = h;
            const upper = h.toUpperCase();
            if (upper.startsWith("UNIFONT")) {
                const parts = h.split(",");
                unifont = { name: parts.slice(2).join(","), tokens: [], line };
                current = unifont;
            } else if (upper.startsWith("BIGFONT")) {
                const vals = tokenize(h.slice(7).replace(/^\s+/, ""), line).map((t) => t.value);
                const nr = vals[1] ?? 0;
                const ranges: Array<[number, number]> = [];
                for (let k = 0; k < nr; k++) ranges.push([vals[2 + 2 * k] ?? 0, vals[3 + 2 * k] ?? 0]);
                bigfont = { ranges };
                current = undefined;
            } else {
                const c1 = h.indexOf(",");
                const c2 = c1 < 0 ? -1 : h.indexOf(",", c1 + 1);
                if (c1 < 0) throw new ShpSyntaxError(`line ${line}: bad shape header "${l2}"`);
                const number = parseNumber(h.slice(0, c1), line).value;
                const defbytes = parseNumber(c2 < 0 ? h.slice(c1 + 1) : h.slice(c1 + 1, c2), line).value;
                const name = c2 < 0 ? "" : h.slice(c2 + 1);
                const rs: RawShape = { number, defbytes, name, tokens: [], line };
                shapesRaw.push(rs);
                current = rs;
            }
            return;
        }
        if (!current) {
            warnings.push(`line ${line}: data outside a shape ignored`);
            return;
        }
        current.tokens.push(...tokenize(l, line));
    });

    const kind: ShxKind = unifont ? "unifont" : bigfont ? "bigfont" : "shapes";
    const shapes: ShxShape[] = [];
    for (const rs of shapesRaw) {
        const w: string[] = [];
        const bytes =
            rs.number === 0 && kind !== "unifont"
                ? rs.tokens.map((t) => uByte(t, w))
                : encodeBytecode(rs.tokens, kind, w);
        if (bytes.length !== rs.defbytes) w.push(`defbytes ${rs.defbytes} but ${bytes.length} bytes`);
        for (const m of w) warnings.push(`shape ${rs.number} (line ${rs.line}): ${m}`);
        shapes.push({ number: rs.number, name: rs.name, bytes: Uint8Array.from(bytes) });
    }
    const file: ShxFile = {
        kind,
        signature:
            kind === "unifont"
                ? SIGNATURES.unifont
                : kind === "bigfont"
                  ? SIGNATURES.bigfont
                  : (options.signature ?? SIGNATURES.shapes10),
        shapes,
        info: undefined,
        ranges: bigfont?.ranges ?? [],
        warnings: [],
    };
    if (unifont) {
        const tail = Uint8Array.from(unifont.tokens.map((t) => uByte(t, warnings)));
        file.info = decodeFontInfo("unifont", unifont.name, tail);
    } else {
        const s0 = shapes.find((s) => s.number === 0);
        if (s0) file.info = decodeFontInfo(kind, s0.name, s0.bytes);
    }
    return { file, warnings };
}

// ---------------------------------------------------------------------------------------------
// Decompiler

const hex = (v: number, digits = 2) => `0${v.toString(16).toUpperCase().padStart(digits, "0")}`;

function octText(start: number, count: number, cw: boolean): string {
    return `${cw ? "-" : ""}0${(start & 7).toString(16)}${(count & 7).toString(16)}`;
}

/** One op as .shp values. */
export function opToShp(o: ShapeOp, kind: ShxKind): string {
    switch (o.op) {
        case "end":
            return "0";
        case "penDown":
            return "1";
        case "penUp":
            return "2";
        case "divide":
            return `3,${o.n}`;
        case "multiply":
            return `4,${o.n}`;
        case "push":
            return "5";
        case "pop":
            return "6";
        case "subshape":
            return kind === "unifont" ? `7,(${o.shape >> 8},${o.shape & 0xff})` : `7,${o.shape}`;
        case "subshapeExt":
            return `7,0,(${o.shape >> 8},${o.shape & 0xff}),${o.x},${o.y},${o.width},${o.height}`;
        case "xy":
            return `8,(${o.dx},${o.dy})`;
        case "xyList":
            return `9,${o.points.map(([x, y]) => `(${x},${y})`).join(",")},(0,0)`;
        case "octantArc":
            return `10,(${o.radius},${octText(o.start, o.count, o.cw)})`;
        case "fracArc":
            return `11,(${o.startOffset},${o.endOffset},${o.radius >> 8},${o.radius & 0xff},${octText(o.start, o.count, o.cw)})`;
        case "bulgeArc":
            return `12,(${o.dx},${o.dy},${o.bulge})`;
        case "bulgeList":
            return `13,${o.arcs.map(([x, y, b]) => `(${x},${y},${b})`).join(",")},(0,0)`;
        case "verticalOnly":
            return "14";
        case "nop":
            return "15";
        case "vector":
            return hex((o.length << 4) | o.dir);
    }
}

function shapeBody(s: ShxShape, kind: ShxKind): string {
    const d = disassemble(s.bytes, kind);
    const consumed = d.truncated ? -1 : d.offsets[d.offsets.length - 1]! + 1;
    if (d.truncated || consumed !== s.bytes.length) {
        // Not a clean program: keep the bytes verbatim (unsigned values compile back unchanged).
        return Array.from(s.bytes, (b) => String(b)).join(",");
    }
    // Group into lines: break after pen up/down and at the end, for readability.
    const lines: string[] = [];
    let cur: string[] = [];
    for (const o of d.ops) {
        cur.push(opToShp(o, kind));
        if (o.op === "penUp" || o.op === "penDown" || o.op === "end" || cur.length >= 8) {
            lines.push(cur.join(","));
            cur = [];
        }
    }
    if (cur.length) lines.push(cur.join(","));
    return lines.join(",\n");
}

function numberText(n: number, kind: ShxKind): string {
    if (kind === "shapes") return String(n);
    return hex(n, 4);
}

/** Decompiles an ShxFile into .shp source that `compileShp` turns back into the same bytes. */
export function decompileShx(file: ShxFile): string {
    const out: string[] = [];
    const kind = file.kind;
    if (kind === "unifont") {
        const info = file.info;
        if (info) {
            out.push(`*UNIFONT,${info.tail.length},${info.name}`);
            out.push(Array.from(info.tail, String).join(","));
        }
    } else if (kind === "bigfont") {
        const r = file.ranges.map(([a, b]) => `${hex(a)},${hex(b)}`).join(",");
        out.push(`*BIGFONT ${file.shapes.length},${file.ranges.length}${r ? `,${r}` : ""}`);
    }
    for (const s of file.shapes) {
        if (kind === "unifont" && s.number === 0) continue;
        out.push(`*${numberText(s.number, kind)},${s.bytes.length},${s.name}`);
        out.push(
            s.number === 0 && kind !== "unifont" ? Array.from(s.bytes, String).join(",") : shapeBody(s, kind),
        );
    }
    return `${out.join("\n")}\n`;
}
