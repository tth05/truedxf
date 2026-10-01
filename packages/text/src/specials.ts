/**
 * Special codes of single-line text (TEXT, ATTRIB, ATTDEF): research/notes/04-text-fonts.md §1.6.
 *
 * - Caret codes (`^J`, `^ `, `^@` terminates) are DXF-level escapes, decoded first (note 01 §1.5).
 * - `\U+XXXX` (exactly 4 hex digits) and `\M+nXXXX` escapes (note 04 §5).
 * - `%%c %%d %%p %%%`, `%%u %%o %%k` toggles, `%%nnn` (1–3 decimal digits, greedy — AutoCAD's exact
 *   rule for fewer than 3 digits is UNKNOWN, note 04 §8.13); an unknown `%%x` renders `x`
 *   (VERIFIED-BY-ACAD text/unknown-pct: "a%%xb" → "axb", "ab%% cd" → "ab cd").
 * - MTEXT codes (`\P`, `\L`, …) are **not** interpreted in TEXT (ezdxf#258).
 */
import { getDecoder } from "@truedxf/core";

/** A symbolic character whose code depends on the font (note 04 §4.4, §4.5). */
export type SpecialSymbol = "degree" | "plusminus" | "diameter";

export interface TextChar {
  /** Unicode code point (or, with `numeric`, the number of `%%nnn`). */
  readonly cp: number;
  /** From `%%d`, `%%p`, `%%c`: mapped per font (shape numbers 256–258 for non-Unicode SHX). */
  readonly symbol?: SpecialSymbol;
  /** From `%%nnn`: a character number — Unicode/Latin-1 for TTF, a raw shape number for SHX (ASSUMPTION). */
  readonly numeric?: boolean;
  readonly underline: boolean;
  readonly overline: boolean;
  readonly strike: boolean;
}

const MIF_CODEPAGES: Record<string, string | undefined> = {
  "1": "shift_jis",
  "2": "big5",
  "3": "euc-kr",
  "4": undefined, // Johab: no WHATWG decoder
  "5": "gbk",
};

function isHex(c: string | undefined): boolean {
  return c !== undefined && /^[0-9A-Fa-f]$/.test(c);
}

/**
 * Tries to decode a `\U+XXXX` or `\M+nXXXX` escape at `s[i]` (which is a backslash).
 * Returns [decoded string, consumed length] or undefined.
 */
export function decodeEscapeAt(s: string, i: number): [string, number] | undefined {
  if (s[i] !== "\\") return undefined;
  const k = s[i + 1];
  // `\U+` and `\u+` both decode (VERIFIED-BY-ACAD text/escape-spellings); hex digits in any case
  if ((k === "U" || k === "u") && s[i + 2] === "+") {
    const hex = s.slice(i + 3, i + 7);
    if (hex.length === 4 && [...hex].every(isHex)) return [String.fromCharCode(Number.parseInt(hex, 16)), 7];
    return undefined;
  }
  if ((k === "M" || k === "m") && s[i + 2] === "+") {
    const page = s[i + 3];
    const hex = s.slice(i + 4, i + 8);
    if (page === undefined || hex.length !== 4 || ![...hex].every(isHex)) return undefined;
    const enc = MIF_CODEPAGES[page];
    if (!enc) return undefined;
    const v = Number.parseInt(hex, 16);
    const bytes = v < 0x100 ? new Uint8Array([v]) : new Uint8Array([v >> 8, v & 0xff]);
    const out = getDecoder(enc).decode(bytes);
    return out.includes("�") ? undefined : [out, 8];
  }
  return undefined;
}

/**
 * Decodes carets like ezdxf `caret_decode` (`^X` → chr((ord(X) − 64) mod 126), `^ ` → `^`) and
 * truncates at NUL (`^@`, note 04 §1.6). A trailing lone `^` stays literal.
 */
export function decodeCarets(s: string): string {
  if (s.indexOf("^") < 0 && s.indexOf("\0") < 0) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "^" && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      i++;
      const c = next === 32 ? "^" : String.fromCharCode(caretCode(next));
      if (c === "\0") break;
      out += c;
    } else {
      if (ch === "\0") break;
      out += ch;
    }
  }
  return out;
}

/**
 * Code of `^X` (X ≠ space): (X − 64) as a 16-bit code unit — `^J` LF, `^a` "!", `^z` ":", and for
 * X below "@" a code in U+FFE0…U+FFFF (`^6` U+FFF6, `^?` U+FFFF; not ezdxf's mod-126 "t" nor
 * DEL). No font has those, so SHX fonts draw "?" and TrueType fonts a missing-glyph box.
 * VERIFIED-BY-ACAD text/caret-lowercase(-mtext), mtext/stack-caret-nospace (the PDFs' ToUnicode
 * maps name U+FFFF, U+FFF6, U+FFED; note 04 §11).
 */
export function caretCode(next: number): number {
  return (next - 64) & 0xffff;
}

/** Decodes a TEXT/ATTRIB string into characters with decoration flags. */
export function decodeTextString(raw: string): TextChar[] {
  const s = decodeCarets(raw);
  const out: TextChar[] = [];
  let underline = false;
  let overline = false;
  let strike = false;
  const digits = ["", "", ""];
  const push = (cp: number, extra?: { symbol?: SpecialSymbol; numeric?: boolean }) =>
    out.push({ cp, ...extra, underline, overline, strike });
  for (let i = 0; i < s.length; ) {
    const ch = s[i]!;
    if (ch === "\\") {
      const esc = decodeEscapeAt(s, i);
      if (esc) {
        for (const c of esc[0]) push(c.codePointAt(0)!);
        i += esc[1];
        continue;
      }
    } else if (ch === "%" && s[i + 1] === "%" && i + 2 < s.length) {
      const c = s[i + 2]!;
      const lc = c.toLowerCase();
      if (lc === "c" || lc === "d" || lc === "p") {
        const symbol: SpecialSymbol = lc === "c" ? "diameter" : lc === "d" ? "degree" : "plusminus";
        push(lc === "c" ? 0xd8 : lc === "d" ? 0xb0 : 0xb1, { symbol });
        i += 3;
        continue;
      }
      if (c === "%") {
        push(0x25);
        i += 3;
        continue;
      }
      if (lc === "u" || lc === "o" || lc === "k") {
        if (lc === "u") underline = !underline;
        else if (lc === "o") overline = !overline;
        else strike = !strike;
        i += 3;
        continue;
      }
      if (c >= "0" && c <= "9") {
        let j = i + 2;
        while (j < s.length && j < i + 5 && s[j]! >= "0" && s[j]! <= "9") {
          digits[j - i - 2] = s[j]!;
          j++;
        }
        // AutoCAD reads the digits into a 3-character buffer that keeps the previous code's
        // tail: "[%%009][%%65]" draws U+0293 (659) for "%%65" (VERIFIED-BY-ACAD text/nnn-short;
        // whether the buffer survives across strings is UNKNOWN — reset per string here)
        push(Number(digits.join("")), { numeric: true });
        i = j;
        continue;
      }
      // unknown %% code: AutoCAD drops the %% and keeps the character (VERIFIED-BY-ACAD text/unknown-pct)
      i += 2;
      continue;
    }
    const cp = s.codePointAt(i)!;
    push(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return out;
}
