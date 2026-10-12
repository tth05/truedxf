import { describe, expect, it } from "vitest";
import { DwgBits } from "../src/draw/dwgbits.ts";

function reader(bits: string): DwgBits {
    const s = bits.replaceAll(" ", "");
    const bytes = new Uint8Array(Math.ceil(s.length / 8));
    for (let k = 0; k < s.length; k++) bytes[k >>> 3]! |= Number(s[k]) << (7 - (k & 7));
    return new DwgBits(bytes, s.length);
}

const octets = (...values: number[]) => values.map((v) => v.toString(2).padStart(8, "0")).join("");
const raw = (v: number) => {
    const data = new DataView(new ArrayBuffer(8));
    data.setFloat64(0, v, true);
    return octets(...new Uint8Array(data.buffer));
};

describe("DWG bit codes (ODA §2)", () => {
    it("reads MSB-first B, BB and prefix 3B across byte boundaries", () => {
        const r = reader("1 10 0 10 110 111");
        expect(r.b()).toBe(1);
        expect(r.bb()).toBe(2);
        expect([r.threeB(), r.threeB(), r.threeB(), r.threeB()]).toEqual([0, 2, 6, 7]);
        expect(r.remaining).toBe(0);
    });

    it("reads unaligned little-endian RC, RS, RL, RD and 2RD", () => {
        const r = reader(
            `1 ${octets(0xab, 0x34, 0x12, 0x78, 0x56, 0x34, 0xf2)} ${raw(-2.5)} ${raw(3)} ${raw(4)}`,
        );
        r.b();
        expect(r.rc()).toBe(0xab);
        expect(r.rs()).toBe(0x1234);
        expect(r.rl()).toBe(0xf2345678);
        expect(r.rd()).toBe(-2.5);
        expect(r.twoRD()).toEqual([3, 4]);
    });

    it("decodes every BS and valid BL code, including signed full values", () => {
        const r = reader(
            `00 ${octets(0xff, 0xff)} 01 ${octets(255)} 10 11 00 ${octets(0xff, 0xff, 0xff, 0xff)} 01 ${octets(42)} 10`,
        );
        expect([r.bs(), r.bs(), r.bs(), r.bs()]).toEqual([-1, 255, 0, 256]);
        expect([r.bl(), r.bl(), r.bl()]).toEqual([-1, 42, 0]);
        expect(() => reader("11").bl()).toThrow("reserved BL");
    });

    it("decodes BD and 3BD, and rejects the reserved BD code", () => {
        expect(reader(`00 ${raw(-123.5)} 01 10`).threeBD()).toEqual([-123.5, 1, 0]);
        expect(() => reader("11").bd()).toThrow("reserved BD");
    });

    it("decodes default and explicit R2000+ BE and BT", () => {
        expect(reader("1").be()).toEqual([0, 0, 1]);
        expect(reader(`0 01 10 00 ${raw(-2)}`).be()).toEqual([1, 0, -2]);
        expect(reader("1").bt()).toBe(0);
        expect(reader(`0 00 ${raw(2.5)}`).bt()).toBe(2.5);
    });

    it("decodes all four DD codes with the ODA byte patch order", () => {
        // The default and expected values have deliberately distinct bytes in every patched slot.
        const defaultBytes = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x10, 0x40];
        const fromBytes = (bytes: number[]) =>
            new DataView(Uint8Array.from(bytes).buffer).getFloat64(0, true);
        const d = fromBytes(defaultBytes);
        expect(reader("00").dd(d)).toBe(d);
        expect(reader(`01 ${octets(0xaa, 0xbb, 0xcc, 0xdd)}`).dd(d)).toBe(
            fromBytes([0xaa, 0xbb, 0xcc, 0xdd, 0x55, 0x66, 0x10, 0x40]),
        );
        expect(reader(`10 ${octets(0xee, 0xff, 0xaa, 0xbb, 0xcc, 0xdd)}`).dd(d)).toBe(
            fromBytes([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x10, 0x40]),
        );
        expect(reader(`11 ${raw(-7.25)}`).dd(d)).toBe(-7.25);
    });

    const reads: [string, string, (r: DwgBits) => unknown][] = [
        ["B", "1", (r) => r.b()],
        ["BB", "10", (r) => r.bb()],
        ["3B", "111", (r) => r.threeB()],
        ["RC", octets(42), (r) => r.rc()],
        ["RS", octets(1, 2), (r) => r.rs()],
        ["RL", octets(1, 2, 3, 4), (r) => r.rl()],
        ["RD", raw(3), (r) => r.rd()],
        ["BS", `00${octets(1, 2)}`, (r) => r.bs()],
        ["BL", `00${octets(1, 2, 3, 4)}`, (r) => r.bl()],
        ["BD", `00${raw(2)}`, (r) => r.bd()],
        ["2RD", `${raw(1)}${raw(2)}`, (r) => r.twoRD()],
        ["3BD", "011010", (r) => r.threeBD()],
        ["BE", "0011010", (r) => r.be()],
        ["BT", "001", (r) => r.bt()],
        ["DD-low", `01${octets(1, 2, 3, 4)}`, (r) => r.dd(1)],
        ["DD-six", `10${octets(1, 2, 3, 4, 5, 6)}`, (r) => r.dd(1)],
        ["DD-full", `11${raw(2)}`, (r) => r.dd(1)],
    ];
    it.each(reads)("bounds-checks every truncation of %s", (_name, bits, read) => {
        for (let n = 0; n < bits.length; n++) expect(() => read(reader(bits.slice(0, n)))).toThrow();
        expect(() => read(reader(bits))).not.toThrow();
    });
});
