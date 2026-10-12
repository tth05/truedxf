// Pre-optimization ASCII tokenizer, retained as a differential oracle.
import type { Diagnostics } from "../src/diagnostics.ts";
import { TagStore } from "../src/tagstore.ts";

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

/**
 * Parses a group code line: optional blanks, optional sign, digits, optional blanks, then
 * optionally anything after a blank — AutoCAD reads ` 10   // insertion point x` as code 10
 * (VERIFIED-BY-ACAD user/text-frame-annotated, note 01 §8.1). NaN if invalid.
 */
function parseCode(b: Uint8Array, s: number, e: number): number {
    while (s < e && (b[s] === 32 || b[s] === 9)) s++;
    if (s >= e) return Number.NaN;
    let neg = false;
    if (b[s] === 45) {
        neg = true;
        s++;
    } else if (b[s] === 43) s++;
    let i = s;
    let v = 0;
    while (i < e) {
        const c = b[i]! - 48;
        if (c < 0 || c > 9) break;
        v = v * 10 + c;
        i++;
    }
    if (i === s || i - s > 6) return Number.NaN;
    // trailing text is accepted only after a blank (a comment); "10abc" stays invalid
    if (i < e && b[i] !== 32 && b[i] !== 9) return Number.NaN;
    return neg ? -v : v;
}

function isEofValue(b: Uint8Array, s: number, e: number): boolean {
    while (s < e && (b[s] === 32 || b[s] === 9)) s++;
    while (e > s && (b[e - 1] === 32 || b[e - 1] === 9)) e--;
    return (
        e - s === 3 && (b[s]! | 0x20) === 0x65 && (b[s + 1]! | 0x20) === 0x6f && (b[s + 2]! | 0x20) === 0x66
    );
}

export function tokenizeAsciiOracle(bytes: Uint8Array, diag: Diagnostics): TagStore {
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

    /** Returns [contentEnd, next]; next = -1 at end of data. */
    const lineEnd = (start: number): [number, number] => {
        const p = bytes.indexOf(nl, start);
        if (p < 0) return [len, len];
        let ce = p;
        if (stripCr && ce > start && bytes[ce - 1] === 13) ce--;
        return [ce, p + 1];
    };

    while (pos < len) {
        const codeStart = pos;
        const [ce, afterCode] = lineEnd(pos);
        const code = parseCode(bytes, codeStart, ce);
        if (Number.isNaN(code)) {
            // blank trailing lines / garbage after the last tag
            let blank = true;
            for (let k = codeStart; k < ce; k++) {
                const c = bytes[k]!;
                if (c !== 32 && c !== 9 && c !== 13 && c !== 26 && c !== 0) {
                    blank = false;
                    break;
                }
            }
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
        const [ve, afterValue] = lineEnd(vs);
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
