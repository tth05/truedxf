// In-memory model of a compiled SHX file (note 04 §4.2).

/** `shapes` = "AutoCAD-86 shapes 1.0/1.1" (normal fonts and shape files), `unifont`, `bigfont`. */
export type ShxKind = "shapes" | "unifont" | "bigfont";

export const SIGNATURES = {
  shapes10: "AutoCAD-86 shapes 1.0",
  shapes11: "AutoCAD-86 shapes 1.1",
  unifont: "AutoCAD-86 unifont 1.0",
  bigfont: "AutoCAD-86 bigfont 1.0",
} as const;

/** One shape record. */
export interface ShxShape {
  /** Shape number: code page byte (shapes), Unicode code point (unifont), DBCS code (bigfont). */
  number: number;
  /** Raw name bytes decoded as Latin-1 (lossless). Shape files use it for lookup by name. */
  name: string;
  /** Shape bytecode as stored after the name, normally ending with the 0 terminator. */
  bytes: Uint8Array;
}

/** Font-wide information from shape 0 (shapes, bigfont) or the unifont header definition. */
export interface ShxFontInfo {
  name: string;
  /** Vector lengths above the baseline that capitals extend = the cap height basis (note 04 §4.4). */
  above: number;
  /** Vector lengths below the baseline that descenders extend. */
  below: number;
  /** 0 = horizontal only, 2 = dual orientation (code 0x0E executes in vertical text). */
  modes: number;
  /** Unifont only: 0 Unicode, 1 packed multibyte, 2 shape file. */
  encoding: number;
  /** Unifont only: 0 embeddable, 1 not embeddable, 2 read-only embedding. */
  embed: number;
  /** Extended big font (`name\0 height 0 modes width 0`): the character cell of primitives. */
  extended?: { height: number; width: number };
  /** Bytes after the name, kept for a lossless rewrite. */
  tail: Uint8Array;
}

export interface ShxFile {
  kind: ShxKind;
  /** Signature text without CR LF 0x1A. */
  signature: string;
  /** All shape records in file order. For `shapes` and `bigfont` files this includes shape 0. */
  shapes: ShxShape[];
  /** Font information, `undefined` for plain shape files without shape 0. */
  info: ShxFontInfo | undefined;
  /** Bigfont lead-byte ("escape") ranges, inclusive. */
  ranges: Array<[number, number]>;
  /** Header values kept for a lossless rewrite (writer recomputes them when absent). */
  header?: {
    /** shapes: first / last shape number field. */
    first?: number;
    last?: number;
    /** unifont: the stored record count. */
    count?: number;
    /** bigfont: the first header word (8 in every known file) and the index entry count. */
    bigfontWord?: number;
    indexCount?: number;
  };
  /** Non-fatal problems found while parsing. */
  warnings: string[];
}

/** Decodes the tail of a font-info definition (after `name\0`). */
export function decodeFontInfo(kind: ShxKind, name: string, tail: Uint8Array): ShxFontInfo {
  const b = (i: number) => tail[i] ?? 0;
  if (kind === "unifont") {
    return { name, above: b(0), below: b(1), modes: b(2), encoding: b(3), embed: b(4), tail };
  }
  const info: ShxFontInfo = { name, above: b(0), below: b(1), modes: b(2), encoding: 0, embed: 0, tail };
  if (kind === "bigfont") {
    if (tail.length === 5 && b(1) === 0 && b(4) === 0) {
      // Extended big font: `height, 0, modes, width, 0` + end (ADSK "Extended Big Font Files").
      info.above = b(0);
      info.below = 0;
      info.modes = b(2);
      info.extended = { height: b(0), width: b(3) };
    } else if (b(0) === 0 && tail.length >= 4) {
      // gbcbig.shx stores `0, above, modes, 0` (an extra leading zero byte, note 04 §4.2).
      info.above = b(1);
      info.below = 0;
      info.modes = b(2);
    }
  }
  return info;
}
