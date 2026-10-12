// Binary SHX writer (inverse of parse.ts). Produces files in the layout AutoCAD reads (note 04 §4.2).

import { ByteWriter, latin1Bytes } from "../bytes.ts";
import { type ShxFile, type ShxShape, SIGNATURES } from "./format.ts";

function record(s: ShxShape): Uint8Array {
    const name = latin1Bytes(s.name);
    const out = new Uint8Array(name.length + 1 + s.bytes.length);
    out.set(name, 0);
    out[name.length] = 0;
    out.set(s.bytes, name.length + 1);
    return out;
}

function checkLength(s: ShxShape, len: number): void {
    if (len > 0xffff) throw new RangeError(`shape ${s.number}: record too long (${len} bytes)`);
}

function isPrime(n: number): boolean {
    if (n < 2) return false;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
}

/** Hash table size for a bigfont index: the smallest prime ≥ 4/3 · n (AutoCAD files use primes). */
export function bigfontTableSize(n: number): number {
    let s = Math.max(n + 1, Math.ceil((n * 4) / 3));
    while (!isPrime(s)) s++;
    return s;
}

/**
 * Bigfont index slots. The index of every AutoCAD 2027 bigfont is an open-addressing hash table:
 * slot = byteswap(code) mod size with forward linear probing (verified on all 13 bigfonts), so
 * readers that hash (AutoCAD, presumably) only find glyphs placed this way. Returns shape indices
 * per slot (−1 = empty). Insertion follows record order.
 */
export function bigfontSlots(numbers: readonly number[], size: number): number[] {
    const slots = new Array<number>(size).fill(-1);
    numbers.forEach((num, k) => {
        let i = (((num & 0xff) << 8) | (num >> 8)) % size;
        for (let probe = 0; slots[i]! >= 0; probe++) {
            if (probe >= size) throw new RangeError("bigfont index table full");
            i = (i + 1) % size;
        }
        slots[i] = k;
    });
    return slots;
}

/**
 * Serialises an ShxFile. All 79 SHX files of AutoCAD 2027 are rewritten byte-identically after
 * parsing (local test); for bigfonts this needs the stored hash table size (`header.indexCount`),
 * otherwise `bigfontTableSize` is used.
 */
export function writeShx(file: ShxFile): Uint8Array {
    const w = new ByteWriter(4096);
    const sig =
        file.signature ||
        (file.kind === "shapes"
            ? SIGNATURES.shapes10
            : file.kind === "unifont"
              ? SIGNATURES.unifont
              : SIGNATURES.bigfont);
    w.ascii(sig).u8(0x0d).u8(0x0a).u8(0x1a);
    const h = file.header ?? {};

    if (file.kind === "shapes") {
        const recs = file.shapes.map(record);
        const numbers = file.shapes.map((s) => s.number);
        // The lowest and highest shape number (shape 0 included), as in every AutoCAD file.
        const first = numbers.length ? Math.min(...numbers) : 0;
        const last = numbers.length ? Math.max(...numbers) : 0;
        w.u16(first).u16(last).u16(file.shapes.length);
        file.shapes.forEach((s, i) => {
            checkLength(s, recs[i]!.length);
            w.u16(s.number).u16(recs[i]!.length);
        });
        for (const r of recs) w.bytes(r);
        w.ascii("EOF");
    } else if (file.kind === "unifont") {
        const info = file.info;
        if (!info) throw new Error("unifont without font information");
        const shapes = file.shapes.filter((s) => s.number !== 0);
        w.u32(shapes.length + 1);
        const name = latin1Bytes(info.name);
        w.u16(name.length + 1 + info.tail.length)
            .bytes(name)
            .u8(0)
            .bytes(info.tail);
        for (const s of shapes) {
            const r = record(s);
            checkLength(s, r.length);
            w.u16(s.number).u16(r.length).bytes(r);
        }
    } else {
        const recs = file.shapes.map(record);
        const n = file.shapes.length;
        const size = h.indexCount !== undefined && h.indexCount > n ? h.indexCount : bigfontTableSize(n);
        w.u16(h.bigfontWord ?? 8)
            .u16(size)
            .u16(file.ranges.length);
        for (const [a, b] of file.ranges) w.u16(a).u16(b);
        const slots = bigfontSlots(
            file.shapes.map((s) => s.number),
            size,
        );
        const offsets: number[] = [];
        let offset = w.length + size * 8;
        for (const r of recs) {
            offsets.push(offset);
            offset += r.length;
        }
        for (let i = 0; i < size; i++) {
            const k = slots[i]!;
            if (k < 0) w.u16(0).u16(0).u32(0);
            else {
                const s = file.shapes[k]!;
                checkLength(s, recs[k]!.length);
                w.u16(s.number).u16(recs[k]!.length).u32(offsets[k]!);
            }
        }
        for (const r of recs) w.bytes(r);
    }
    return w.toBytes();
}
