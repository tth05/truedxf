// SHX shape bytecode: typed operations, disassembler (bytes → ops) and assembler (ops → bytes).
// Semantics per note 04 §4.3; the interpreter lives in interpret.ts.

import type { ShxKind } from "./format.ts";

/**
 * Vector direction table: diagonals "stretch to match the X or Y displacement of the closest
 * orthogonal vector" (ADSK), so they are not unit-circle angles.
 */
export const VECTOR_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [1, 0.5],
    [1, 1],
    [0.5, 1],
    [0, 1],
    [-0.5, 1],
    [-1, 1],
    [-1, 0.5],
    [-1, 0],
    [-1, -0.5],
    [-1, -1],
    [-0.5, -1],
    [0, -1],
    [0.5, -1],
    [1, -1],
    [1, -0.5],
];

export type ShapeOp =
    | { op: "end" }
    | { op: "penDown" }
    | { op: "penUp" }
    /** Code 3: scale /= n. */
    | { op: "divide"; n: number }
    /** Code 4: scale *= n. */
    | { op: "multiply"; n: number }
    | { op: "push" }
    | { op: "pop" }
    /** Code 7: subshape (1-byte number in shape fonts / bigfonts, 2-byte number in unifonts). */
    | { op: "subshape"; shape: number }
    /** Code 7,0 in bigfonts: extended subshape `7,0,shape(2 bytes),x,y,width,height`. */
    | { op: "subshapeExt"; shape: number; x: number; y: number; width: number; height: number }
    /** Code 8: single signed displacement. */
    | { op: "xy"; dx: number; dy: number }
    /** Code 9: displacement list, terminated by (0,0) in the bytes. */
    | { op: "xyList"; points: Array<[number, number]> }
    /** Code 0x0A: octant arc; `count` 0 = full circle. */
    | { op: "octantArc"; radius: number; start: number; count: number; cw: boolean }
    /** Code 0x0B: fractional arc; `radius` is the full 16-bit radius (hr·256 + r). */
    | {
          op: "fracArc";
          startOffset: number;
          endOffset: number;
          radius: number;
          start: number;
          count: number;
          cw: boolean;
      }
    /** Code 0x0C: arc to (dx,dy) with bulge byte (−127..127, 127 = semicircle). */
    | { op: "bulgeArc"; dx: number; dy: number; bulge: number }
    /** Code 0x0D: list of bulge arcs, terminated by (0,0) without bulge byte. */
    | { op: "bulgeList"; arcs: Array<[number, number, number]> }
    /** Code 0x0E: the next command executes only in vertical text. */
    | { op: "verticalOnly" }
    /** Code 0x0F: undefined, no-op. */
    | { op: "nop" }
    /** Byte ≥ 0x10: vector of `length` 1..15 in direction 0..15. */
    | { op: "vector"; length: number; dir: number };

/** Two's complement byte → signed. */
export function s8(b: number): number {
    return b > 127 ? b - 256 : b;
}

/** Signed value → two's complement byte (clamped to −128..127). */
export function toS8(v: number): number {
    const c = Math.max(-128, Math.min(127, Math.round(v)));
    return c < 0 ? c + 256 : c;
}

/** Octant spec byte: bit 7 = clockwise, bits 4–6 = start octant, bits 0–2 = octant count. */
export function octantByte(start: number, count: number, cw: boolean): number {
    return (cw ? 0x80 : 0) | ((start & 7) << 4) | (count & 7);
}

export interface DisassembleResult {
    ops: ShapeOp[];
    /** Byte offset of each op in the input (for diagnostics / disassembly listings). */
    offsets: number[];
    /** Set when the bytes end in the middle of a command or without an end code. */
    truncated: boolean;
}

/**
 * Decodes shape bytecode into ops. Stops at the first end code (0). Truncated commands are
 * dropped and reported via `truncated`, never thrown (fonts in the wild are sloppy).
 */
export function disassemble(bytes: Uint8Array, kind: ShxKind): DisassembleResult {
    const ops: ShapeOp[] = [];
    const offsets: number[] = [];
    let i = 0;
    const n = bytes.length;
    const has = (k: number) => i + k <= n;
    const at = (k: number) => bytes[i + k]!;
    while (i < n) {
        const start = i;
        const c = bytes[i]!;
        let op: ShapeOp | undefined;
        let len = 1;
        if (c >= 0x10) {
            op = { op: "vector", length: c >> 4, dir: c & 0x0f };
        } else {
            switch (c) {
                case 0:
                    ops.push({ op: "end" });
                    offsets.push(start);
                    return { ops, offsets, truncated: false };
                case 1:
                    op = { op: "penDown" };
                    break;
                case 2:
                    op = { op: "penUp" };
                    break;
                case 3:
                case 4:
                    if (!has(2)) break;
                    op = c === 3 ? { op: "divide", n: at(1) } : { op: "multiply", n: at(1) };
                    len = 2;
                    break;
                case 5:
                    op = { op: "push" };
                    break;
                case 6:
                    op = { op: "pop" };
                    break;
                case 7:
                    if (kind === "unifont") {
                        if (!has(3)) break;
                        // 2-byte subshape number, high byte first like every other 2-byte bytecode value
                        // (fractional-arc radius, extended subshape). Verified on the AutoCAD 2027 unifonts:
                        // only this order resolves to existing shapes (note 04 §4.3 CONFLICT resolved).
                        op = { op: "subshape", shape: (at(1) << 8) | at(2) };
                        len = 3;
                    } else if (kind === "bigfont" && has(2) && at(1) === 0) {
                        if (!has(8)) break;
                        op = {
                            op: "subshapeExt",
                            shape: (at(2) << 8) | at(3),
                            x: at(4),
                            y: at(5),
                            width: at(6),
                            height: at(7),
                        };
                        len = 8;
                    } else {
                        if (!has(2)) break;
                        op = { op: "subshape", shape: at(1) };
                        len = 2;
                    }
                    break;
                case 8:
                    if (!has(3)) break;
                    op = { op: "xy", dx: s8(at(1)), dy: s8(at(2)) };
                    len = 3;
                    break;
                case 9: {
                    const points: Array<[number, number]> = [];
                    let j = i + 1;
                    let closed = false;
                    while (j + 2 <= n) {
                        const dx = s8(bytes[j]!);
                        const dy = s8(bytes[j + 1]!);
                        j += 2;
                        if (dx === 0 && dy === 0) {
                            closed = true;
                            break;
                        }
                        points.push([dx, dy]);
                    }
                    if (!closed) break;
                    op = { op: "xyList", points };
                    len = j - i;
                    break;
                }
                case 0x0a: {
                    if (!has(3)) break;
                    const spec = at(2);
                    op = {
                        op: "octantArc",
                        radius: at(1),
                        start: (spec >> 4) & 7,
                        count: spec & 7,
                        cw: (spec & 0x80) !== 0,
                    };
                    len = 3;
                    break;
                }
                case 0x0b: {
                    if (!has(6)) break;
                    const spec = at(5);
                    op = {
                        op: "fracArc",
                        startOffset: at(1),
                        endOffset: at(2),
                        radius: at(3) * 256 + at(4),
                        start: (spec >> 4) & 7,
                        count: spec & 7,
                        cw: (spec & 0x80) !== 0,
                    };
                    len = 6;
                    break;
                }
                case 0x0c:
                    if (!has(4)) break;
                    op = { op: "bulgeArc", dx: s8(at(1)), dy: s8(at(2)), bulge: s8(at(3)) };
                    len = 4;
                    break;
                case 0x0d: {
                    const arcs: Array<[number, number, number]> = [];
                    let j = i + 1;
                    let closed = false;
                    while (j + 2 <= n) {
                        const dx = s8(bytes[j]!);
                        const dy = s8(bytes[j + 1]!);
                        if (dx === 0 && dy === 0) {
                            j += 2;
                            closed = true;
                            break;
                        }
                        if (j + 3 > n) break;
                        arcs.push([dx, dy, s8(bytes[j + 2]!)]);
                        j += 3;
                    }
                    if (!closed) break;
                    op = { op: "bulgeList", arcs };
                    len = j - i;
                    break;
                }
                case 0x0e:
                    op = { op: "verticalOnly" };
                    break;
                default:
                    op = { op: "nop" };
                    break;
            }
        }
        if (op === undefined) return { ops, offsets, truncated: true };
        ops.push(op);
        offsets.push(start);
        i += len;
    }
    return { ops, offsets, truncated: true };
}

/** Encodes ops into bytecode. An `end` op is appended when missing. */
export function assemble(ops: readonly ShapeOp[], kind: ShxKind): Uint8Array {
    const out: number[] = [];
    const u8 = (v: number) => {
        if (!Number.isInteger(v) || v < 0 || v > 255) throw new RangeError(`byte out of range: ${v}`);
        out.push(v);
    };
    const sb = (v: number) => {
        if (!Number.isInteger(v) || v < -128 || v > 127)
            throw new RangeError(`signed byte out of range: ${v}`);
        out.push(toS8(v));
    };
    let ended = false;
    for (const o of ops) {
        if (ended) throw new Error("ops after end");
        switch (o.op) {
            case "end":
                out.push(0);
                ended = true;
                break;
            case "penDown":
                out.push(1);
                break;
            case "penUp":
                out.push(2);
                break;
            case "divide":
                out.push(3);
                u8(o.n);
                break;
            case "multiply":
                out.push(4);
                u8(o.n);
                break;
            case "push":
                out.push(5);
                break;
            case "pop":
                out.push(6);
                break;
            case "subshape":
                out.push(7);
                if (kind === "unifont") {
                    u8(o.shape >> 8);
                    u8(o.shape & 0xff);
                } else {
                    if (o.shape === 0 && kind === "bigfont")
                        throw new RangeError("bigfont subshape 0 is the extended form");
                    u8(o.shape);
                }
                break;
            case "subshapeExt":
                if (kind !== "bigfont") throw new Error("extended subshapes exist only in bigfonts");
                out.push(7, 0);
                u8(o.shape >> 8);
                u8(o.shape & 0xff);
                u8(o.x);
                u8(o.y);
                u8(o.width);
                u8(o.height);
                break;
            case "xy":
                out.push(8);
                sb(o.dx);
                sb(o.dy);
                break;
            case "xyList":
                out.push(9);
                for (const [dx, dy] of o.points) {
                    if (dx === 0 && dy === 0) throw new RangeError("(0,0) inside an xy list terminates it");
                    sb(dx);
                    sb(dy);
                }
                out.push(0, 0);
                break;
            case "octantArc":
                out.push(0x0a);
                u8(o.radius);
                out.push(octantByte(o.start, o.count, o.cw));
                break;
            case "fracArc":
                out.push(0x0b);
                u8(o.startOffset);
                u8(o.endOffset);
                u8(o.radius >> 8);
                u8(o.radius & 0xff);
                out.push(octantByte(o.start, o.count, o.cw));
                break;
            case "bulgeArc":
                out.push(0x0c);
                sb(o.dx);
                sb(o.dy);
                sb(o.bulge);
                break;
            case "bulgeList":
                out.push(0x0d);
                for (const [dx, dy, b] of o.arcs) {
                    if (dx === 0 && dy === 0) throw new RangeError("(0,0) inside a bulge list terminates it");
                    sb(dx);
                    sb(dy);
                    sb(b);
                }
                out.push(0, 0);
                break;
            case "verticalOnly":
                out.push(0x0e);
                break;
            case "nop":
                out.push(0x0f);
                break;
            case "vector":
                if (o.length < 1 || o.length > 15 || o.dir < 0 || o.dir > 15)
                    throw new RangeError("bad vector");
                out.push((o.length << 4) | o.dir);
                break;
        }
    }
    if (!ended) out.push(0);
    return Uint8Array.from(out);
}
