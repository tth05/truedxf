/** DWG bit codes used by proxy LWPOLYLINEs (note 07 §15.2; ODA §2). */
export class DwgBits {
    readonly bytes: Uint8Array;
    readonly bitLength: number;
    pos = 0;

    constructor(bytes: Uint8Array, bitLength = bytes.length * 8) {
        if (!Number.isSafeInteger(bitLength) || bitLength < 0 || bitLength > bytes.length * 8)
            throw new RangeError("DWG: invalid bit length");
        this.bytes = bytes;
        this.bitLength = bitLength;
    }

    get remaining(): number {
        return this.bitLength - this.pos;
    }

    private bits(n: number): number {
        if (n > this.remaining) throw new RangeError("DWG: truncated bit stream");
        let v = 0;
        for (let k = 0; k < n; k++, this.pos++)
            v = v * 2 + ((this.bytes[this.pos >>> 3]! >>> (7 - (this.pos & 7))) & 1);
        return v;
    }

    b(): number {
        return this.bits(1);
    }

    bb(): number {
        return this.bits(2);
    }

    /** 3B is a prefix code: 0, 10, 110, 111. */
    threeB(): number {
        return this.b() === 0 ? 0 : this.b() === 0 ? 2 : this.b() === 0 ? 6 : 7;
    }

    rc(): number {
        return this.bits(8);
    }

    rs(): number {
        return this.rc() + this.rc() * 256;
    }

    rl(): number {
        return this.rs() + this.rs() * 65536;
    }

    rd(): number {
        const data = new DataView(new ArrayBuffer(8));
        for (let i = 0; i < 8; i++) data.setUint8(i, this.rc());
        return data.getFloat64(0, true);
    }

    bs(): number {
        const code = this.bb();
        if (code === 1) return this.rc();
        if (code === 2) return 0;
        if (code === 3) return 256;
        const v = this.rs();
        return v >= 0x8000 ? v - 0x10000 : v;
    }

    bl(): number {
        const code = this.bb();
        if (code === 1) return this.rc();
        if (code === 2) return 0;
        if (code === 3) throw new Error("DWG: reserved BL code");
        const v = this.rl();
        return v >= 0x80000000 ? v - 0x100000000 : v;
    }

    bd(): number {
        const code = this.bb();
        if (code === 1) return 1;
        if (code === 2) return 0;
        if (code === 3) throw new Error("DWG: reserved BD code");
        return this.rd();
    }

    twoRD(): [number, number] {
        return [this.rd(), this.rd()];
    }

    threeBD(): [number, number, number] {
        return [this.bd(), this.bd(), this.bd()];
    }

    /** R2000+ extrusion. */
    be(): [number, number, number] {
        return this.b() === 1 ? [0, 0, 1] : this.threeBD();
    }

    /** R2000+ thickness. */
    bt(): number {
        return this.b() === 1 ? 0 : this.bd();
    }

    dd(defaultValue: number): number {
        const code = this.bb();
        if (code === 0) return defaultValue;
        if (code === 3) return this.rd();
        const data = new DataView(new ArrayBuffer(8));
        data.setFloat64(0, defaultValue, true);
        // DD code 10 patches bytes 4,5 first, then 0..3 (ODA §2.9; note 07 §15.2).
        if (code === 2) {
            data.setUint8(4, this.rc());
            data.setUint8(5, this.rc());
        }
        for (let i = 0; i < 4; i++) data.setUint8(i, this.rc());
        return data.getFloat64(0, true);
    }
}
