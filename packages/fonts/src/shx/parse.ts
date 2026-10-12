// Binary SHX parser for shape fonts, unifonts and bigfonts (layout: note 04 §4.2).

import { ByteReader, FontFormatError, latin1 } from "../bytes.ts";
import { decodeFontInfo, type ShxFile, type ShxKind, type ShxShape } from "./format.ts";

/** True if the bytes start with an "AutoCAD-86" SHX signature. */
export function isShx(bytes: Uint8Array): boolean {
    const sig = "AutoCAD-86 ";
    if (bytes.length < sig.length) return false;
    for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig.charCodeAt(i)) return false;
    return true;
}

function readSignature(bytes: Uint8Array): { signature: string; kind: ShxKind; dataStart: number } {
    // The signature is terminated by CR LF 0x1A; some writers emit a bare LF (note 04 §4.2, KH).
    const limit = Math.min(bytes.length, 64);
    let end = -1;
    for (let i = 0; i < limit; i++) {
        if (bytes[i] === 0x1a) {
            end = i;
            break;
        }
    }
    if (end < 0) throw new FontFormatError("not an SHX file: signature terminator 0x1A not found");
    let textEnd = end;
    while (textEnd > 0 && (bytes[textEnd - 1] === 0x0a || bytes[textEnd - 1] === 0x0d)) textEnd--;
    const signature = latin1(bytes.subarray(0, textEnd)).trim();
    let kind: ShxKind;
    const lower = signature.toLowerCase();
    if (lower.startsWith("autocad-86 shapes")) kind = "shapes";
    else if (lower.startsWith("autocad-86 unifont")) kind = "unifont";
    else if (lower.startsWith("autocad-86 bigfont")) kind = "bigfont";
    else throw new FontFormatError(`unknown SHX signature "${signature}"`);
    return { signature, kind, dataStart: end + 1 };
}

/** Splits a record into its null-terminated name and the bytecode after it. */
function splitRecord(number: number, rec: Uint8Array, warnings: string[]): ShxShape {
    const z = rec.indexOf(0);
    if (z < 0) {
        warnings.push(`shape ${number}: record without name terminator`);
        return { number, name: "", bytes: rec.slice() };
    }
    return { number, name: latin1(rec.subarray(0, z)), bytes: rec.slice(z + 1) };
}

/** Parses a compiled .shx file. Throws FontFormatError only for unusable headers. */
export function parseShx(bytes: Uint8Array): ShxFile {
    const { signature, kind, dataStart } = readSignature(bytes);
    const warnings: string[] = [];
    const r = new ByteReader(bytes, dataStart);
    const shapes: ShxShape[] = [];
    const file: ShxFile = { kind, signature, shapes, info: undefined, ranges: [], warnings };

    if (kind === "shapes") {
        const first = r.u16();
        const last = r.u16();
        const count = r.u16();
        file.header = { first, last };
        const index: Array<[number, number]> = [];
        for (let i = 0; i < count; i++) {
            if (r.remaining < 4) {
                warnings.push(`index truncated after ${i} of ${count} entries`);
                break;
            }
            index.push([r.u16(), r.u16()]);
        }
        for (const [number, length] of index) {
            if (r.remaining < length) {
                warnings.push(`shape ${number}: record truncated`);
                break;
            }
            shapes.push(splitRecord(number, r.take(length), warnings));
        }
        // Trailer "EOF" (not required by readers).
    } else if (kind === "unifont") {
        const count = r.u32();
        file.header = { count };
        const defLength = r.u16();
        const def = r.take(defLength);
        const z = def.indexOf(0);
        const name = latin1(def.subarray(0, z < 0 ? def.length : z));
        file.info = decodeFontInfo("unifont", name, def.slice(z < 0 ? def.length : z + 1));
        for (let i = 1; i < count; i++) {
            if (r.remaining < 4) {
                if (r.remaining > 0 || i < count - 1)
                    warnings.push(`unifont: ${count - i} of ${count - 1} records missing`);
                break;
            }
            const number = r.u16();
            const length = r.u16();
            if (r.remaining < length) {
                warnings.push(`shape ${number}: record truncated`);
                break;
            }
            shapes.push(splitRecord(number, r.take(length), warnings));
        }
    } else {
        const bigfontWord = r.u16();
        const indexCount = r.u16();
        const nranges = r.u16();
        file.header = { bigfontWord, indexCount };
        for (let i = 0; i < nranges; i++) file.ranges.push([r.u16(), r.u16()]);
        const entries: Array<[number, number, number]> = [];
        for (let i = 0; i < indexCount; i++) {
            if (r.remaining < 8) {
                warnings.push(`bigfont index truncated after ${i} of ${indexCount} entries`);
                break;
            }
            const number = r.u16();
            const length = r.u16();
            const offset = r.u32();
            if (number === 0 && length === 0 && offset === 0) continue; // padding entries
            entries.push([number, length, offset]);
        }
        // The index is a hash table (see write.ts); keep the records in file (offset) order.
        entries.sort((a, b) => a[2] - b[2]);
        for (const [number, length, offset] of entries) {
            if (offset + length > bytes.length) {
                warnings.push(`shape ${number}: record outside the file`);
                continue;
            }
            shapes.push(splitRecord(number, bytes.subarray(offset, offset + length), warnings));
        }
    }

    if (kind !== "unifont") {
        const s0 = shapes.find((s) => s.number === 0);
        if (s0) file.info = decodeFontInfo(kind, s0.name, s0.bytes);
    }
    return file;
}
