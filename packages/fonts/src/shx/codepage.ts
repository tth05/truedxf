// The code page a bigfont is indexed in (note 04 §4.4 "Bigfont code page").
//
// AutoCAD 2027 holds text as Unicode and draws a character from a style's bigfont at the code
// the character has in the bigfont's DBCS code page: in an ANSI_1252 drawing 日 came from
// bigfont.shx / extfont.shx at its Shift-JIS code 0x93FA and 中 from chineset.shx at its Big5 code
// 0xA4A4 (VERIFIED-BY-ACAD acad-default-fonts/bigfont-txt-*-r2018). A compiled bigfont does not
// name its code page, so it is derived from the file name for the bigfonts AutoCAD ships (and
// common third-party ones), else from the lead-byte ("escape") ranges.

import { baseName } from "../provider.ts";

/** WHATWG labels of the DBCS code pages bigfonts use. */
export type BigFontEncoding = "shift_jis" | "big5" | "gbk" | "euc-kr";

/** Base names (lower case, without `.shx` and a leading `@`) → code page. */
const KNOWN: Readonly<Record<string, BigFontEncoding>> = {
    // Japanese (AutoCAD 2027 Fonts folder)
    bigfont: "shift_jis",
    extfont: "shift_jis",
    extfont2: "shift_jis",
    // Traditional Chinese
    chineset: "big5",
    // Simplified Chinese: gbcbig ships with AutoCAD; hz* / tssd* are the common third-party ones
    gbcbig: "gbk",
    hztxt: "gbk",
    hzfs: "gbk",
    hzdx: "gbk",
    hztxt1: "gbk",
    hztxtb: "gbk",
    tssdchn: "gbk",
    // Korean
    whgtxt: "euc-kr",
    whgdtxt: "euc-kr",
    whtgtxt: "euc-kr",
    whtmtxt: "euc-kr",
};

/**
 * The DBCS code page of a bigfont, or `undefined` when it cannot be told (the caller then uses
 * the drawing code page when that is a DBCS page). Unknown fonts whose lead bytes include the
 * Shift-JIS-only range 0x81–0xA0 without the EUC-style 0xA1–0xDF are Shift-JIS (ASSUMPTION;
 * fonts with escape ranges only above 0xA0 are GB2312, KS X 1001 or Big5 alike).
 */
export function bigFontEncoding(
    fileName: string,
    ranges: readonly (readonly [number, number])[],
): BigFontEncoding | undefined {
    const base = baseName(fileName)
        .toLowerCase()
        .replace(/#\d+$/, "")
        .replace(/\.shx$/, "")
        .replace(/^@/, "");
    const known = KNOWN[base];
    if (known) return known;
    const covers = (lo: number, hi: number) => ranges.some(([a, b]) => a <= hi && b >= lo);
    if (covers(0x81, 0x9f) && !covers(0xa1, 0xdf)) return "shift_jis";
    return undefined;
}
