import { Diagnostics } from "./diagnostics.ts";
import { ValueKind, valueKind } from "./groupcodes.ts";
import { TagStore } from "./tagstore.ts";

export const BINARY_SENTINEL = "AutoCAD Binary DXF\r\n\x1a\x00";
const DXB_SENTINEL = "AutoCAD DXB 1.0\r\n\x1a\x00";

export class DxfFormatError extends Error {
    override name = "DxfFormatError";
}

export interface TokenizeOptions {
    diagnostics?: Diagnostics;
}

function startsWith(bytes: Uint8Array, s: string): boolean {
    if (bytes.length < s.length) return false;
    for (let i = 0; i < s.length; i++) if (bytes[i] !== s.charCodeAt(i)) return false;
    return true;
}

export function isBinaryDxf(bytes: Uint8Array): boolean {
    return startsWith(bytes, BINARY_SENTINEL);
}

/** Splits DXF bytes (ASCII or binary) into a lossless TagStore. Encoding is not set here. */
export function tokenize(bytes: Uint8Array, options: TokenizeOptions = {}): TagStore {
    const diag = options.diagnostics ?? new Diagnostics();
    if (startsWith(bytes, DXB_SENTINEL)) throw new DxfFormatError("DXB files are not DXF");
    if (isBinaryDxf(bytes)) return tokenizeBinary(bytes, diag);
    return tokenizeAscii(bytes, diag);
}

/** Growable struct-of-arrays buffer for tags. */
class TagBuffer {
    count = 0;
    codes: Int32Array;
    codeStarts: Uint32Array;
    valueStarts: Uint32Array;
    valueEnds: Uint32Array;

    constructor(capacity: number) {
        const c = Math.max(capacity, 64);
        this.codes = new Int32Array(c);
        this.codeStarts = new Uint32Array(c);
        this.valueStarts = new Uint32Array(c);
        this.valueEnds = new Uint32Array(c);
    }

    push(code: number, codeStart: number, vs: number, ve: number): void {
        if (this.count === this.codes.length) this.grow();
        const n = this.count++;
        this.codes[n] = code;
        this.codeStarts[n] = codeStart;
        this.valueStarts[n] = vs;
        this.valueEnds[n] = ve;
    }

    private grow(): void {
        const c = this.codes.length * 2;
        const g = <T extends Int32Array | Uint32Array>(a: T, ctor: new (n: number) => T): T => {
            const r = new ctor(c);
            r.set(a);
            return r;
        };
        this.codes = g(this.codes, Int32Array);
        this.codeStarts = g(this.codeStarts, Uint32Array);
        this.valueStarts = g(this.valueStarts, Uint32Array);
        this.valueEnds = g(this.valueEnds, Uint32Array);
    }
}

function isEofValue(b: Uint8Array, s: number, e: number): boolean {
    while (s < e && (b[s] === 32 || b[s] === 9)) s++;
    while (e > s && (b[e - 1] === 32 || b[e - 1] === 9)) e--;
    return (
        e - s === 3 && (b[s]! | 0x20) === 0x65 && (b[s + 1]! | 0x20) === 0x6f && (b[s + 2]! | 0x20) === 0x66
    );
}

function tokenizeAscii(bytes: Uint8Array, diag: Diagnostics): TagStore {
    const len = bytes.length;
    let pos = 0;
    if (len >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        pos = 3;
        diag.info("utf8-bom", "file starts with a UTF-8 BOM");
    }
    // Line terminator: LF (optionally preceded by CR) if the file contains any LF, else lone CR.
    const nl = bytes.indexOf(10, pos) >= 0 ? 10 : 13;
    const stripCr = nl === 10;
    // rough capacity estimate: AutoCAD files average ~12 bytes per line
    const buf = new TagBuffer(Math.ceil(len / 24));
    let end = len;
    let sawEof = false;

    while (pos < len) {
        const codeStart = pos;
        let code = 0;
        let digits = 0;
        let neg = false;
        // 0: leading blanks, 1: sign, 2: digits, 3: comment, 4: invalid.
        let state = 0;
        let blank = true;
        while (pos < len && bytes[pos] !== nl) {
            const c = bytes[pos++]!;
            // Strip CR only before an actual LF, just as the old line splitter did.
            if (stripCr && c === 13 && bytes[pos] === nl) break;
            if (c !== 32 && c !== 9 && c !== 13 && c !== 26 && c !== 0) blank = false;
            if (state >= 3) continue;
            if (c >= 48 && c <= 57) {
                code = code * 10 + c - 48;
                digits++;
                state = 2;
            } else if (c === 32 || c === 9) {
                if (state === 2)
                    state = 3; // annotated group codes: note 01 §8.1
                else if (state === 1) state = 4;
            } else if (state === 0 && (c === 43 || c === 45)) {
                neg = c === 45;
                state = 1;
            } else state = 4;
        }
        const afterCode = pos < len ? pos + 1 : len;
        if (state === 4 || digits === 0 || digits > 6) code = Number.NaN;
        else if (neg) code = -code;
        if (Number.isNaN(code)) {
            // blank trailing lines / garbage after the last tag
            if (!(blank && afterCode >= len)) {
                diag.error("invalid-group-code", "invalid group code line, skipping one line to resync", {
                    offset: codeStart,
                });
            }
            pos = afterCode;
            continue;
        }
        if (afterCode >= len) {
            diag.error("missing-value", `group code ${code} at end of file has no value`, {
                offset: codeStart,
            });
            break;
        }
        const vs = afterCode;
        pos = vs;
        while (pos < len && bytes[pos] !== nl) pos++;
        let ve = pos;
        if (pos < len && stripCr && ve > vs && bytes[ve - 1] === 13) ve--;
        const afterValue = pos < len ? pos + 1 : len;
        buf.push(code, codeStart, vs, ve);
        pos = afterValue;
        if (code === 0 && isEofValue(bytes, vs, ve)) {
            end = afterValue;
            sawEof = true;
            break;
        }
    }
    if (!sawEof) diag.warn("missing-eof", "file has no EOF marker");
    return new TagStore(
        bytes,
        "ascii",
        buf.count,
        buf.codes,
        buf.codeStarts,
        buf.valueStarts,
        buf.valueEnds,
        end,
    );
}

function tokenizeBinary(bytes: Uint8Array, diag: Diagnostics): TagStore {
    const len = bytes.length;
    let pos = BINARY_SENTINEL.length;
    // byte 22 is the low byte of the first code (0); byte 23 is 0 for 2-byte codes, 'S' for 1-byte
    const codeSize: 1 | 2 = bytes[pos + 1] === 0 ? 2 : 1;
    const buf = new TagBuffer(Math.ceil(len / 10));
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = len;
    let sawEof = false;
    while (pos < len) {
        const codeStart = pos;
        let code: number;
        if (codeSize === 2) {
            if (pos + 2 > len) break;
            code = dv.getUint16(pos, true);
            pos += 2;
        } else {
            code = bytes[pos]!;
            pos += 1;
            if (code === 255) {
                if (pos + 2 > len) break;
                code = dv.getUint16(pos, true);
                pos += 2;
            }
        }
        if (code >= 32768) code -= 65536;
        const kind = valueKind(code);
        let vs = pos;
        let ve: number;
        switch (kind) {
            case ValueKind.Double:
            case ValueKind.Int64:
                ve = pos + 8;
                break;
            case ValueKind.Int32:
                ve = pos + 4;
                break;
            case ValueKind.Int16:
                ve = pos + 2;
                break;
            case ValueKind.Bool:
                ve = pos + 1;
                break;
            case ValueKind.Binary: {
                const n = bytes[pos] ?? 0;
                vs = pos + 1;
                ve = vs + n;
                break;
            }
            default: {
                const z = bytes.indexOf(0, pos);
                ve = z < 0 ? len : z;
                break;
            }
        }
        if (ve > len) {
            diag.error("truncated", `binary DXF truncated in value of group code ${code}`, {
                offset: codeStart,
            });
            break;
        }
        buf.push(code, codeStart, vs, ve);
        const isString = kind === ValueKind.String || kind === ValueKind.Handle;
        pos = isString ? ve + 1 : ve;
        if (code === 0 && ve - vs === 3 && bytes[vs] === 69 && bytes[vs + 1] === 79 && bytes[vs + 2] === 70) {
            end = pos;
            sawEof = true;
            break;
        }
    }
    if (!sawEof) diag.warn("missing-eof", "binary DXF has no EOF marker");
    return new TagStore(
        bytes,
        "binary",
        buf.count,
        buf.codes,
        buf.codeStarts,
        buf.valueStarts,
        buf.valueEnds,
        Math.min(end, len),
        codeSize,
    );
}
