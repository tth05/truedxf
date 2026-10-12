/**
 * Test input only: encodes (code, value) pairs as binary DXF so the binary tokenizer can be tested
 * without fixture files. `codeSize` 1 = R12 layout (0xFF escape for codes ≥ 255), 2 = R13+.
 * Binary chunks longer than 127 bytes are split into several tags, as AutoCAD writes them.
 */
import { BINARY_SENTINEL, ValueKind, valueKind } from "../src/index.ts";

export type TestTag = [code: number, value: string | number | bigint | boolean | Uint8Array];

export function binaryDxf(tags: readonly TestTag[], codeSize: 1 | 2 = 2): Uint8Array {
    const enc = new TextEncoder();
    const out: number[] = [...enc.encode(BINARY_SENTINEL)];
    const push = (b: ArrayLike<number>) => {
        for (let i = 0; i < b.length; i++) out.push(b[i]!);
    };
    const bytes = (n: number, set: (v: DataView) => void) => {
        const b = new Uint8Array(n);
        set(new DataView(b.buffer));
        push(b);
    };
    for (const [code, value] of tags) {
        const head =
            codeSize === 2 ? [code & 0xff, code >> 8] : code < 255 ? [code] : [255, code & 0xff, code >> 8];
        push(head);
        const num = typeof value === "boolean" ? Number(value) : value;
        switch (valueKind(code)) {
            case ValueKind.Double:
                bytes(8, (v) => v.setFloat64(0, Number(num), true));
                break;
            case ValueKind.Int16:
                bytes(2, (v) => v.setInt16(0, Number(num), true));
                break;
            case ValueKind.Int32:
                bytes(4, (v) => v.setInt32(0, Number(num), true));
                break;
            case ValueKind.Int64:
                bytes(8, (v) => v.setBigInt64(0, typeof num === "bigint" ? num : BigInt(Number(num)), true));
                break;
            case ValueKind.Bool:
                push([Number(num) ? 1 : 0]);
                break;
            case ValueKind.Binary: {
                const data = value instanceof Uint8Array ? value : new Uint8Array();
                for (let off = 0; off === 0 || off < data.length; off += 127) {
                    const part = data.subarray(off, off + 127);
                    if (off > 0) push(head);
                    push([part.length]);
                    push(part);
                    if (data.length === 0) break;
                }
                break;
            }
            default:
                push(enc.encode(String(value)));
                push([0]);
        }
    }
    return Uint8Array.from(out);
}
