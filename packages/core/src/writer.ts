import { ValueKind, valueKind } from "./groupcodes.ts";
import type { TagStore } from "./tagstore.ts";
import { BINARY_SENTINEL } from "./tokenizer.ts";

export type TagValue = string | number | bigint | boolean | Uint8Array;

/** AutoCAD's float formatting: shortest round-trip form, integral values with ".0" (note 01 §1.1). */
export function formatDouble(x: number): string {
  if (Number.isNaN(x)) return "0.0";
  if (Object.is(x, -0)) return "0.0";
  const s = String(x);
  if (Number.isInteger(x) && !s.includes("e")) return `${s}.0`;
  return s;
}

function hex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, "0");
  return s.toUpperCase();
}

/** Escapes non-ASCII characters as `\U+XXXX` (UTF-16 code units), for pre-R2007 files. */
export function escapeNonAscii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c < 0x80 ? s[i] : `\\U+${c.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}

export interface AsciiWriterOptions {
  /** `utf-8` (R2007+) or `ascii` (non-ASCII chars become \U+XXXX; valid for every version). */
  encoding?: "utf-8" | "ascii";
  lineEnding?: "\r\n" | "\n";
}

/** Formats tags the way AutoCAD writes them: right-aligned codes (width 3), padded ints. */
export class AsciiTagWriter {
  private readonly chunks: Uint8Array[] = [];
  private pending: string[] = [];
  private pendingLength = 0;
  private readonly encoder = new TextEncoder();
  readonly encoding: "utf-8" | "ascii";
  readonly eol: string;

  constructor(options: AsciiWriterOptions = {}) {
    this.encoding = options.encoding ?? "utf-8";
    this.eol = options.lineEnding ?? "\r\n";
  }

  write(code: number, value: TagValue): void {
    const kind = valueKind(code);
    let v: string;
    if (value instanceof Uint8Array) v = hex(value);
    else if (typeof value === "boolean") v = (value ? "1" : "0").padStart(6);
    else if (typeof value === "bigint") v = value.toString();
    else if (typeof value === "number") {
      if (kind === ValueKind.Double) v = formatDouble(value);
      else if (kind === ValueKind.Int16 || kind === ValueKind.Bool) v = String(Math.trunc(value)).padStart(6);
      else if (kind === ValueKind.Int32) v = String(Math.trunc(value)).padStart(9);
      else if (kind === ValueKind.Int64) v = String(Math.trunc(value));
      else v = formatDouble(value);
    } else v = this.encoding === "ascii" ? escapeNonAscii(value) : value;
    this.push(`${String(code).padStart(3)}${this.eol}${v}${this.eol}`);
  }

  /** Writes already-encoded bytes verbatim (lossless pass-through of unmodified records). */
  writeRaw(bytes: Uint8Array): void {
    this.flushPending();
    this.chunks.push(bytes);
  }

  private push(s: string): void {
    this.pending.push(s);
    this.pendingLength += s.length;
    if (this.pendingLength > 1 << 16) this.flushPending();
  }

  private flushPending(): void {
    if (this.pending.length === 0) return;
    this.chunks.push(this.encoder.encode(this.pending.join("")));
    this.pending = [];
    this.pendingLength = 0;
  }

  toBytes(): Uint8Array {
    this.flushPending();
    return concat(this.chunks);
  }
}

/** Binary DXF writer. `codeSize` 1 = R12 layout (0xFF escape for codes ≥ 255), 2 = R13+. */
export class BinaryTagWriter {
  private readonly chunks: Uint8Array[] = [];
  private readonly encoder = new TextEncoder();
  readonly codeSize: 1 | 2;

  constructor(codeSize: 1 | 2 = 2) {
    this.codeSize = codeSize;
    this.chunks.push(this.encoder.encode(BINARY_SENTINEL));
  }

  write(code: number, value: TagValue): void {
    const kind = valueKind(code);
    const head =
      this.codeSize === 2
        ? le16(code)
        : code < 255
          ? Uint8Array.of(code)
          : Uint8Array.of(255, code & 0xff, (code >> 8) & 0xff);
    this.chunks.push(head);
    const num = typeof value === "boolean" ? (value ? 1 : 0) : value;
    switch (kind) {
      case ValueKind.Double: {
        const b = new Uint8Array(8);
        new DataView(b.buffer).setFloat64(0, Number(num), true);
        this.chunks.push(b);
        return;
      }
      case ValueKind.Int16:
        this.chunks.push(le16(Math.trunc(Number(num))));
        return;
      case ValueKind.Int32: {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setInt32(0, Math.trunc(Number(num)), true);
        this.chunks.push(b);
        return;
      }
      case ValueKind.Int64: {
        const b = new Uint8Array(8);
        new DataView(b.buffer).setBigInt64(
          0,
          typeof num === "bigint" ? num : BigInt(Math.trunc(Number(num))),
          true,
        );
        this.chunks.push(b);
        return;
      }
      case ValueKind.Bool:
        this.chunks.push(Uint8Array.of(Number(num) ? 1 : 0));
        return;
      case ValueKind.Binary: {
        const data = value instanceof Uint8Array ? value : new Uint8Array();
        for (let off = 0; off === 0 || off < data.length; off += 127) {
          const part = data.subarray(off, off + 127);
          if (off > 0) this.chunks.push(head);
          this.chunks.push(Uint8Array.of(part.length), part);
          if (data.length === 0) break;
        }
        return;
      }
      default:
        this.chunks.push(this.encoder.encode(String(value)), Uint8Array.of(0));
    }
  }

  toBytes(): Uint8Array {
    return concat(this.chunks);
  }
}

function le16(v: number): Uint8Array {
  return Uint8Array.of(v & 0xff, (v >> 8) & 0xff);
}

export function concat(chunks: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Re-emits all tags of a store by value (not by raw copy). Used for format conversion and tests. */
export function writeStore(
  store: TagStore,
  writer: AsciiTagWriter | BinaryTagWriter,
  from = 0,
  to: number = store.count,
): void {
  for (let i = from; i < to; i++) {
    const code = store.codes[i]!;
    const kind = valueKind(code);
    // strings and handles are passed as decoded text; everything else by typed value
    const v = kind === ValueKind.String || kind === ValueKind.Handle ? store.str(i) : store.value(i);
    writer.write(code, v);
  }
}
