/**
 * Text encodings of DXF files. See research/notes/01-file-format.md §5.
 *
 * - AC1021 (R2007) and later: UTF-8.
 * - Earlier: the code page named by $DWGCODEPAGE (default ANSI_1252).
 * - `\U+XXXX` and `\M+NXXXX` escapes can appear in any string; they are decoded in the semantic
 *   layer (after MTEXT chunks are joined), not by the tag store.
 */

const ANSI: Record<string, string> = {
  "874": "windows-874",
  "932": "shift_jis",
  "936": "gbk",
  "949": "euc-kr",
  "950": "big5",
  "1250": "windows-1250",
  "1251": "windows-1251",
  "1252": "windows-1252",
  "1253": "windows-1253",
  "1254": "windows-1254",
  "1255": "windows-1255",
  "1256": "windows-1256",
  "1257": "windows-1257",
  "1258": "windows-1258",
};

/** Names seen in the wild besides ANSI_nnnn (libdxfrw, ACadSharp aliases). */
const ALIASES: Record<string, string> = {
  ASCII: "windows-1252",
  LATIN1: "windows-1252",
  "ISO-8859-1": "windows-1252",
  "ISO8859-1": "windows-1252",
  "ISO8859-15": "iso-8859-15",
  "ISO-8859-15": "iso-8859-15",
  CP1252: "windows-1252",
  "IBM 850": "windows-1252",
  "APPLE ROMAN": "macintosh",
  "MAC-ROMAN": "macintosh",
  GBK: "gbk",
  GB2312: "gbk",
  GB18030: "gb18030",
  CHINESE: "gbk",
  "CN-GB": "gbk",
  "SHIFT-JIS": "shift_jis",
  SJIS: "shift_jis",
  BIG5: "big5",
  "BIG5-HKSCS": "big5",
  EUCKR: "euc-kr",
  KSC5601: "euc-kr",
  KCS5601: "euc-kr",
  "UTF-8": "utf-8",
  UTF8: "utf-8",
  DOS866: "ibm866",
  DOS932: "shift_jis",
  DOS950: "big5",
};

export const DEFAULT_CODEPAGE_ENCODING = "windows-1252";

/**
 * Maps a $DWGCODEPAGE value to a WHATWG TextDecoder label. Unknown values map to windows-1252
 * (ezdxf matches only the numeric suffix, so `ANSI1252` and `ansi_1252` work too).
 */
export function codepageToEncoding(codepage: string | undefined): { encoding: string; known: boolean } {
  if (!codepage) return { encoding: DEFAULT_CODEPAGE_ENCODING, known: false };
  const name = codepage.trim().toUpperCase();
  const alias = ALIASES[name];
  if (alias) return { encoding: alias, known: true };
  const m = /^(?:ANSI|CP)_?(\d+)$/.exec(name);
  if (m) {
    const enc = ANSI[m[1]!];
    if (enc) return { encoding: enc, known: true };
  }
  return { encoding: DEFAULT_CODEPAGE_ENCODING, known: false };
}

/** $ACADVER ≥ AC1021 means the file is UTF-8. */
export function isUtf8Version(acadver: string | undefined): boolean {
  return acadver !== undefined && /^AC\d{4}$/.test(acadver) && acadver >= "AC1021";
}

const decoders = new Map<string, TextDecoder>();

/** windows-1252 0x80–0x9F (WHATWG; the five undefined bytes map to the C1 controls). */
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F" + "\u0090‘’“”•–—˜™š›œ\u009DžŸ";

/**
 * windows-1252 from a table. Node (23.10) decodes the WHATWG labels windows-1252 / iso-8859-1 /
 * latin1 as ISO-8859-1, turning € “ Š … into C1 controls; browsers are correct.
 */
class Windows1252Decoder implements TextDecoder {
  readonly encoding = "windows-1252";
  readonly fatal = false;
  decode(input?: ArrayBufferView | ArrayBuffer): string {
    if (!input) return "";
    const b =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    let out = "";
    for (let i = 0; i < b.length; i += 4096) {
      const end = Math.min(b.length, i + 4096);
      const codes: number[] = [];
      for (let k = i; k < end; k++) {
        const c = b[k]!;
        codes.push(c >= 0x80 && c < 0xa0 ? CP1252_HIGH.charCodeAt(c - 0x80) : c);
      }
      out += String.fromCharCode(...codes);
    }
    return out;
  }
}

export function getDecoder(encoding: string, fatal = false): TextDecoder {
  const key = fatal ? `${encoding}!` : encoding;
  let d = decoders.get(key);
  if (!d) {
    d = new TextDecoder(encoding, { fatal, ignoreBOM: true });
    // windows-1252 has no invalid bytes, so `fatal` does not matter for the table decoder
    if (d.encoding === "windows-1252" && d.decode(Uint8Array.of(0x80)) !== "€") d = new Windows1252Decoder();
    decoders.set(key, d);
  }
  return d;
}

/** True if `bytes[start, end)` is valid UTF-8 and contains at least one non-ASCII sequence. */
export function isNonAsciiUtf8(bytes: Uint8Array, start: number, end: number): boolean {
  let nonAscii = false;
  let i = start;
  while (i < end) {
    const b = bytes[i]!;
    if (b < 0x80) {
      i++;
      continue;
    }
    nonAscii = true;
    let n: number;
    if (b >= 0xc2 && b <= 0xdf) n = 1;
    else if (b >= 0xe0 && b <= 0xef) n = 2;
    else if (b >= 0xf0 && b <= 0xf4) n = 3;
    else return false;
    if (i + n >= end) return false;
    for (let k = 1; k <= n; k++) {
      if ((bytes[i + k]! & 0xc0) !== 0x80) return false;
    }
    i += n + 1;
  }
  return nonAscii;
}

/** `\M+N` code page selectors (note 01 §5.3; ezdxf's cp1391 for 4 is a typo for Johab 1361). */
const MIF_CODEPAGES: Record<string, string | undefined> = {
  "1": "shift_jis",
  "2": "big5",
  "3": "euc-kr",
  "4": undefined, // Johab: no WHATWG decoder
  "5": "gbk",
};

const ESCAPE_RE = /\\U\+([0-9A-Fa-f]{4})|\\M\+([1-5])([0-9A-Fa-f]{4})/g;

/**
 * Decodes `\U+XXXX` (UTF-16 code unit, surrogate pairs combine naturally) and `\M+NXXXX`
 * (a double-byte character in code page N). Malformed escapes stay literal.
 */
export function decodeUnicodeEscapes(s: string): string {
  if (s.indexOf("\\") < 0) return s;
  return s.replace(
    ESCAPE_RE,
    (whole, u: string | undefined, mifPage: string | undefined, mifHex: string | undefined) => {
      if (u !== undefined) return String.fromCharCode(Number.parseInt(u, 16));
      const enc = MIF_CODEPAGES[mifPage!];
      if (!enc) return whole;
      const v = Number.parseInt(mifHex!, 16);
      const bytes = v < 0x100 ? new Uint8Array([v]) : new Uint8Array([v >> 8, v & 0xff]);
      const out = getDecoder(enc).decode(bytes);
      return out.includes("�") ? whole : out;
    },
  );
}

/**
 * Decodes caret-encoded control characters (`^J` → LF, `^ ` → `^`), using ezdxf's generalized
 * rule `chr((ord(c) - 64) % 126)` observed from AutoCAD output (note 01 §1.5). A trailing `^`
 * stays literal.
 */
export function decodeCaret(s: string): string {
  if (s.indexOf("^") < 0) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "^" && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      out += next === 32 ? "^" : String.fromCharCode((next - 64 + 126) % 126);
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}
