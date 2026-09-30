import { getDecoder } from "./encoding.ts";
import { ValueKind, valueKind } from "./groupcodes.ts";

export type DxfFormat = "ascii" | "binary";

/**
 * Lossless, lazily decoded tag storage over the original file bytes (struct of arrays).
 *
 * For tag `i`: `codes[i]` is the group code, `codeStarts[i]` the byte offset where the tag begins
 * (the group code line / bytes), and `valueStarts[i]..valueEnds[i]` the raw value bytes (ASCII:
 * the value line without its line terminator; binary: the value without NUL / length prefix).
 * Values are decoded only on access, so loading stays cheap and nothing is lost.
 */
export class TagStore {
  /** Decoder label for strings (set after encoding detection). */
  encoding = "windows-1252";
  /**
   * Used when the primary encoding is UTF-8 but a string is not valid UTF-8 (mislabelled
   * files, note 01 §5.5). Undefined disables the fallback.
   */
  fallbackEncoding: string | undefined = undefined;
  /** Number of strings decoded with the fallback encoding (for diagnostics). */
  fallbackDecodes = 0;

  private lineIndex: Uint32Array | undefined;

  readonly bytes: Uint8Array;
  readonly format: DxfFormat;
  readonly count: number;
  readonly codes: Int32Array;
  readonly codeStarts: Uint32Array;
  readonly valueStarts: Uint32Array;
  readonly valueEnds: Uint32Array;
  /** Byte offset after the last tag (after EOF), or the file length if EOF is missing. */
  readonly end: number;
  /** Binary DXF only: 1 (R12) or 2 (R13+) byte group codes. */
  readonly binaryCodeSize: 0 | 1 | 2;

  constructor(
    bytes: Uint8Array,
    format: DxfFormat,
    count: number,
    codes: Int32Array,
    codeStarts: Uint32Array,
    valueStarts: Uint32Array,
    valueEnds: Uint32Array,
    end: number,
    binaryCodeSize: 0 | 1 | 2 = 0,
  ) {
    this.bytes = bytes;
    this.format = format;
    this.count = count;
    this.codes = codes;
    this.codeStarts = codeStarts;
    this.valueStarts = valueStarts;
    this.valueEnds = valueEnds;
    this.end = end;
    this.binaryCodeSize = binaryCodeSize;
  }

  code(i: number): number {
    return this.codes[i]!;
  }

  /** Raw value bytes (a view, not a copy). */
  raw(i: number): Uint8Array {
    return this.bytes.subarray(this.valueStarts[i], this.valueEnds[i]);
  }

  /** Byte range of the whole tag `i` (code + value, including terminators / NUL / prefixes). */
  tagByteRange(i: number): [number, number] {
    return [this.codeStarts[i]!, i + 1 < this.count ? this.codeStarts[i + 1]! : this.end];
  }

  /** Value as string, decoded with the store encoding. Works for any tag (numbers as text in ASCII). */
  str(i: number): string {
    const s = this.valueStarts[i]!;
    const e = this.valueEnds[i]!;
    if (this.format === "binary") {
      const kind = valueKind(this.codes[i]!);
      if (kind !== ValueKind.String && kind !== ValueKind.Handle) return String(this.value(i));
    }
    return this.decodeRange(s, e);
  }

  /** Decodes an arbitrary byte range with the store encoding (ASCII fast path). */
  decodeRange(s: number, e: number): string {
    const b = this.bytes;
    let ascii = true;
    for (let k = s; k < e; k++) {
      if (b[k]! >= 0x80) {
        ascii = false;
        break;
      }
    }
    if (ascii) {
      if (e - s < 64) {
        let out = "";
        for (let k = s; k < e; k++) out += String.fromCharCode(b[k]!);
        return out;
      }
      return getDecoder("latin1").decode(b.subarray(s, e));
    }
    const view = b.subarray(s, e);
    if (this.fallbackEncoding && this.encoding === "utf-8") {
      try {
        return getDecoder("utf-8", true).decode(view);
      } catch {
        this.fallbackDecodes++;
        return getDecoder(this.fallbackEncoding).decode(view);
      }
    }
    return getDecoder(this.encoding).decode(view);
  }

  /** Value as number (double or integer). NaN if it can't be parsed. */
  num(i: number): number {
    if (this.format === "binary") {
      const v = this.value(i);
      if (typeof v === "boolean") return v ? 1 : 0; // binary 290-299 (was NaN → header bools false)
      return typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : Number.NaN;
    }
    return parseAsciiNumber(this.bytes, this.valueStarts[i]!, this.valueEnds[i]!);
  }

  /** Value as integer; floats are truncated (ProE writes ints as floats). NaN if unparseable. */
  int(i: number): number {
    return Math.trunc(this.num(i));
  }

  /** 64-bit integer value (160–169). */
  bigint(i: number): bigint {
    if (this.format === "binary") {
      const v = this.value(i);
      return typeof v === "bigint" ? v : BigInt(Math.trunc(Number(v)));
    }
    const s = this.str(i).trim();
    try {
      return BigInt(s);
    } catch {
      const n = this.num(i);
      return Number.isFinite(n) ? BigInt(Math.trunc(n)) : 0n;
    }
  }

  bool(i: number): boolean {
    const n = this.num(i);
    return Number.isFinite(n) && n !== 0;
  }

  /** Handle value, normalized to uppercase without leading zeros ("0" for null handles). */
  handle(i: number): string {
    return normalizeHandle(this.str(i));
  }

  /** Binary chunk value (310–319, 1004): hex-decoded in ASCII files, raw bytes in binary files. */
  binary(i: number): Uint8Array {
    if (this.format === "binary") return this.raw(i);
    return hexToBytes(this.bytes, this.valueStarts[i]!, this.valueEnds[i]!);
  }

  /** Typed value according to the group code's value kind. */
  value(i: number): string | number | bigint | boolean | Uint8Array {
    const code = this.codes[i]!;
    const kind = valueKind(code);
    if (this.format === "ascii") {
      switch (kind) {
        case ValueKind.Double:
          return this.num(i);
        case ValueKind.Int16:
        case ValueKind.Int32:
          return this.int(i);
        case ValueKind.Int64:
          return this.bigint(i);
        case ValueKind.Bool:
          return this.bool(i);
        case ValueKind.Binary:
          return this.binary(i);
        case ValueKind.Handle:
          return this.handle(i);
        default:
          return this.str(i);
      }
    }
    const s = this.valueStarts[i]!;
    const dv = new DataView(this.bytes.buffer, this.bytes.byteOffset);
    switch (kind) {
      case ValueKind.Double:
        return dv.getFloat64(s, true);
      case ValueKind.Int16:
        return dv.getInt16(s, true);
      case ValueKind.Int32:
        return dv.getInt32(s, true);
      case ValueKind.Int64:
        return dv.getBigInt64(s, true);
      case ValueKind.Bool:
        return this.bytes[s] !== 0;
      case ValueKind.Binary:
        return this.raw(i);
      case ValueKind.Handle:
        return normalizeHandle(this.decodeRange(s, this.valueEnds[i]!));
      default:
        return this.decodeRange(s, this.valueEnds[i]!);
    }
  }

  /** True if the tag's raw value equals the ASCII string `s` (no decoding, no allocation). */
  valueIs(i: number, s: string): boolean {
    const vs = this.valueStarts[i]!;
    let ve = this.valueEnds[i]!;
    const b = this.bytes;
    if (this.format === "ascii") {
      // structural strings may carry trailing blanks
      while (ve > vs && (b[ve - 1] === 32 || b[ve - 1] === 9)) ve--;
    }
    let start = vs;
    if (this.format === "ascii") while (start < ve && (b[start] === 32 || b[start] === 9)) start++;
    if (ve - start !== s.length) return false;
    for (let k = 0; k < s.length; k++) if (b[start + k] !== s.charCodeAt(k)) return false;
    return true;
  }

  /** 1-based line number of the group code line of tag `i` (ASCII only; 0 for binary). */
  lineOf(i: number): number {
    if (this.format !== "ascii") return 0;
    const idx = this.getLineIndex();
    const off = this.codeStarts[i]!;
    let lo = 0;
    let hi = idx.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (idx[mid]! <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  private getLineIndex(): Uint32Array {
    if (this.lineIndex) return this.lineIndex;
    const b = this.bytes;
    const nl = b.indexOf(10) >= 0 ? 10 : 13;
    const starts: number[] = [0];
    let p = b.indexOf(nl);
    while (p >= 0) {
      starts.push(p + 1);
      p = b.indexOf(nl, p + 1);
    }
    this.lineIndex = Uint32Array.from(starts);
    return this.lineIndex;
  }
}

export function normalizeHandle(s: string): string {
  const t = s.trim().toUpperCase();
  let k = 0;
  while (k < t.length - 1 && t[k] === "0") k++;
  return t.slice(k) || "0";
}

function hexVal(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}

function hexToBytes(b: Uint8Array, s: number, e: number): Uint8Array {
  while (s < e && (b[s] === 32 || b[s] === 9)) s++;
  while (e > s && (b[e - 1] === 32 || b[e - 1] === 9)) e--;
  const out = new Uint8Array((e - s) >> 1);
  let n = 0;
  for (let k = s; k + 1 < e; k += 2) {
    const hi = hexVal(b[k]!);
    const lo = hexVal(b[k + 1]!);
    if (hi < 0 || lo < 0) break;
    out[n++] = (hi << 4) | lo;
  }
  return n === out.length ? out : out.subarray(0, n);
}

/**
 * Parses an ASCII number like C `strtod` is used by AutoCAD-compatible readers: surrounding
 * whitespace is ignored; `1e+20`, `.5`, `-0`, `1.0E+20` are accepted. Returns NaN for empty or
 * invalid values. Lenient repairs (trailing garbage, decimal comma) are left to recover mode.
 */
export function parseAsciiNumber(b: Uint8Array, s: number, e: number): number {
  while (s < e && (b[s] === 32 || b[s] === 9)) s++;
  while (e > s && (b[e - 1] === 32 || b[e - 1] === 9 || b[e - 1] === 13)) e--;
  if (s >= e) return Number.NaN;
  // integer fast path
  let i = s;
  let neg = false;
  if (b[i] === 45) {
    neg = true;
    i++;
  } else if (b[i] === 43) i++;
  let v = 0;
  const digitsStart = i;
  while (i < e) {
    const c = b[i]! - 48;
    if (c < 0 || c > 9) break;
    v = v * 10 + c;
    i++;
  }
  const digits = i - digitsStart;
  if (i === e)
    return digits > 0 && digits < 16 ? (neg ? -v : v) : digits > 0 ? Number(latin1(b, s, e)) : Number.NaN;
  // decimal fast path (Clinger): mantissa of ≤ 15 digits is exact, 10^k is exact, and one IEEE
  // division is correctly rounded, so the result equals Number(str).
  if (b[i] === 46) {
    let j = i + 1;
    let mant = v;
    let scale = 1;
    while (j < e) {
      const c = b[j]! - 48;
      if (c < 0 || c > 9) break;
      mant = mant * 10 + c;
      scale *= 10;
      j++;
    }
    const fracDigits = j - i - 1;
    if (j === e && digits + fracDigits <= 15 && digits + fracDigits > 0) {
      const r = mant / scale;
      return neg ? -r : r;
    }
  }
  return parseNumberString(latin1(b, s, e));
}

const STRTOD_PREFIX = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/**
 * Number() for well-formed values, else C `strtod` semantics after removing inner whitespace
 * (seen in the wild: "0.0l", "1.000000000000000E 20"; note 01 §1.4). Hex/binary literals and
 * "Infinity", which Number() would accept, are not DXF numbers.
 */
function parseNumberString(str: string): number {
  if (!/^[+-]?(?:0[xXbBoO]|Infinity)/.test(str)) {
    const n = Number(str);
    if (!Number.isNaN(n)) return n;
  }
  const m = STRTOD_PREFIX.exec(str.replace(/\s+/g, ""));
  return m ? Number(m[0]) : Number.NaN;
}

function latin1(b: Uint8Array, s: number, e: number): string {
  let out = "";
  for (let k = s; k < e; k++) out += String.fromCharCode(b[k]!);
  return out;
}
