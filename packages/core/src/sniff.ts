/**
 * What kind of file some bytes are, from their first lines only: lets a viewer say "this is not
 * a DXF file" instead of drawing nothing. Deliberately lenient, the tokenizer reports what is
 * wrong further on: an ASCII DXF is anything whose first lines (after an optional BOM and blank
 * lines) alternate integer group codes and values up to a `0`/name or `9`/`$NAME` pair,
 * so files without a HEADER or even without `0 SECTION` (Gerber's writer starts with `9
 * $ACADVER`) pass. Checked against the corpus: 12 842 of its 12 855 `.dxf` files pass; the
 * others are RTF / fuzzer / fragment files.
 */
import { BINARY_SENTINEL } from "./tokenizer.ts";

export type FileSniff =
  /** ASCII DXF. */
  | "ascii"
  /** Binary DXF (sentinel "AutoCAD Binary DXF"). */
  | "binary"
  /** Drawing Interchange Binary (DXB), not DXF. */
  | "dxb"
  /** AutoCAD DWG ("AC1015" … version string at offset 0). */
  | "dwg"
  /** Anything else. */
  | "unknown";

const DXB_SENTINEL = "AutoCAD DXB 1.0\r\n\x1a\x00";
/** ASCII lines looked at (`999` comments can precede the first section). */
const MAX_LINES = 64;
const GROUP_CODE = /^[+-]?\d{1,4}$/;

function startsWith(bytes: Uint8Array, s: string): boolean {
  if (bytes.length < s.length) return false;
  for (let i = 0; i < s.length; i++) if (bytes[i] !== s.charCodeAt(i)) return false;
  return true;
}

export function sniffFile(bytes: Uint8Array): FileSniff {
  if (startsWith(bytes, BINARY_SENTINEL)) return "binary";
  if (startsWith(bytes, DXB_SENTINEL)) return "dxb";
  // DWG: "AC10nn" / "AC1.2" / "AC1.40" / "AC2.10" version magic, then binary data
  if (/^AC[0-9.]{4}$/.test(String.fromCharCode(...bytes.subarray(0, 6)))) return "dwg";
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  // the first lines as text (bounded: a DXF line is short, a binary file has no line breaks)
  const lines: string[] = [];
  while (lines.length < MAX_LINES && i < bytes.length) {
    let e = i;
    while (e < bytes.length && bytes[e] !== 10 && bytes[e] !== 13 && e - i < 4096) e++;
    if (e - i >= 4096) return "unknown";
    let s = "";
    for (let k = i; k < e; k++) {
      const b = bytes[k]!;
      if (b === 0) return "unknown";
      s += String.fromCharCode(b);
    }
    lines.push(s.trim());
    // LF, CR…CRLF (AutoCAD reads CRCRLF files, fileformat/eol-crcrlf-*) or a lone CR (old Mac)
    let j = e;
    while (bytes[j] === 13) j++;
    i = bytes[j] === 10 ? j + 1 : e + 1;
  }
  let k = 0;
  while (k < lines.length && lines[k] === "") k++;
  // well-formed pairs up to the first `0`/name or `9`/`$NAME` (errors after it are the tokenizer's)
  for (; k + 1 < lines.length; k += 2) {
    const code = lines[k]!;
    if (!GROUP_CODE.test(code)) return "unknown";
    const n = Number(code);
    const value = lines[k + 1]!;
    if ((n === 0 && /^[A-Za-z_]/.test(value)) || (n === 9 && value.startsWith("$"))) return "ascii";
  }
  return "unknown";
}
