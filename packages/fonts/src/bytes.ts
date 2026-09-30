// Little-endian byte helpers (SHX headers and index tables are little-endian, note 04 §4.2).

export class FontFormatError extends Error {
  override name = "FontFormatError";
}

export class ByteReader {
  readonly bytes: Uint8Array;
  pos: number;

  constructor(bytes: Uint8Array, pos = 0) {
    this.bytes = bytes;
    this.pos = pos;
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) {
      throw new FontFormatError(`unexpected end of data at offset ${this.pos} (need ${n} bytes)`);
    }
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.pos++]!;
  }

  u16(): number {
    this.need(2);
    const b = this.bytes;
    const v = b[this.pos]! | (b[this.pos + 1]! << 8);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const b = this.bytes;
    const v =
      (b[this.pos]! | (b[this.pos + 1]! << 8) | (b[this.pos + 2]! << 16) | (b[this.pos + 3]! << 24)) >>> 0;
    this.pos += 4;
    return v;
  }

  take(n: number): Uint8Array {
    this.need(n);
    const v = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
}

export class ByteWriter {
  private buf: Uint8Array;
  length = 0;

  constructor(capacity = 1024) {
    this.buf = new Uint8Array(Math.max(16, capacity));
  }

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let c = this.buf.length * 2;
    while (c < this.length + n) c *= 2;
    const nb = new Uint8Array(c);
    nb.set(this.buf.subarray(0, this.length));
    this.buf = nb;
  }

  u8(v: number): this {
    this.ensure(1);
    this.buf[this.length++] = v & 0xff;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.buf[this.length++] = v & 0xff;
    this.buf[this.length++] = (v >>> 8) & 0xff;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    for (let i = 0; i < 4; i++) this.buf[this.length++] = (v >>> (8 * i)) & 0xff;
    return this;
  }

  bytes(b: ArrayLike<number>): this {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
    return this;
  }

  ascii(s: string): this {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
    return this;
  }

  /** Overwrites a u32 at an absolute position (for back-patched offsets). */
  patchU32(at: number, v: number): void {
    for (let i = 0; i < 4; i++) this.buf[at + i] = (v >>> (8 * i)) & 0xff;
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** Latin-1 decode (SHX names are raw bytes; we never guess a code page for them). */
export function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

/** Latin-1 encode; code units > 0xFF become "?". */
export function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c > 0xff ? 0x3f : c;
  }
  return out;
}

/** Copies a view into a fresh, exactly sized ArrayBuffer (for libraries that want ArrayBuffer). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.length);
  new Uint8Array(ab).set(bytes);
  return ab;
}
