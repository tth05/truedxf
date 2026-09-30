/**
 * Font access for the layout engines. Layout is synchronous; font loading is not — so all fonts a
 * document needs (STYLE entries and MTEXT inline `\f`/`\F` fonts) are resolved up front with
 * {@link TextFonts.prepare}, after which {@link TextFontSource} lookups are synchronous.
 *
 * Resolution rules are @truedxf/fonts' `FontManager.resolveStyle` (AutoCAD 2027, note 04 §4.1).
 */
import {
  type Font,
  type FontManager,
  type FontSubstitution,
  type ResolvedGlyph,
  ShxFont,
  type StyleFont,
  TtfFont,
} from "@truedxf/fonts";
import type { SpecialSymbol } from "./specials.ts";

/** The STYLE table fields the layout needs (structurally compatible with @truedxf/model's TextStyleEntry). */
export interface TextStyleSpec {
  readonly name: string;
  /** Group 3. */
  readonly font: string;
  /** Group 4. */
  readonly bigFont: string;
  /** XDATA ACAD 1000 family (wins over group 3). */
  readonly ttfFamily?: string | undefined;
  /** XDATA ACAD 1071 flags (bit 24 italic, bit 25 bold). */
  readonly ttfFlags?: number | undefined;
  readonly widthFactor: number;
  /** Degrees. */
  readonly oblique: number;
  readonly generationFlags: number;
  readonly fixedHeight: number;
  readonly vertical: boolean;
}

export interface ResolvedTextStyle {
  readonly name: string;
  /** Undefined when nothing could be loaded. */
  readonly font: StyleFont | undefined;
  /** Missing bigfont: AutoCAD draws nothing (note 04 §4.1 item 5). */
  readonly suppressed: boolean;
  readonly spec: TextStyleSpec | undefined;
  readonly substitutions: readonly FontSubstitution[];
}

/** An MTEXT inline font command: `\fFamily|b1|i0|c0|p34;` or `\Ffile;` (note 04 §3.3). */
export interface InlineFontSpec {
  /** Family (TTF), file name (`romans.shx`, `arial.ttf`), optionally `primary,bigfont`. */
  readonly name: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** Synchronous font lookups for the layout engines. */
export interface TextFontSource {
  /** STYLE by name (case-insensitive); a missing style falls back to Standard (note 04 §4.1 item 7). */
  style(name: string): ResolvedTextStyle;
  /** Resolved inline font; `undefined` = not prepared / not resolvable (keep the current font). */
  inlineFont(spec: InlineFontSpec): StyleFont | undefined;
  /** WHATWG label of the drawing code page ($DWGCODEPAGE), for non-Unicode SHX fonts. */
  readonly encoding: string;
  /**
   * MTEXT: a glyph for a character missing from an SHX font, from a TrueType fallback scaled by
   * its own cap height (VERIFIED-BY-ACAD text/escape-spellings; which font AutoCAD uses is UNKNOWN).
   */
  fallbackGlyph?(cp: number): ResolvedGlyph | undefined;
  /** MTEXT: the missing-glyph box drawn for control characters (text/caret-codes-mtext). */
  notdefGlyph?(font: StyleFont): ResolvedGlyph | undefined;
}

export function inlineFontKey(spec: InlineFontSpec): string {
  return `${spec.name.trim().toLowerCase()}|${spec.bold ? 1 : 0}|${spec.italic ? 1 : 0}`;
}

function looksLikeFile(name: string): boolean {
  return /\.(shx|ttf|ttc|otf)$/i.test(name.trim());
}

/**
 * Prepared fonts of one document: STYLE entries and inline fonts, resolved through a FontManager.
 */
export class TextFonts implements TextFontSource {
  readonly manager: FontManager;
  readonly encoding: string;
  private readonly specs = new Map<string, TextStyleSpec>();
  private readonly styles = new Map<string, ResolvedTextStyle>();
  private readonly inline = new Map<string, StyleFont | undefined>();
  private fontAltStyle: ResolvedTextStyle | undefined;
  private readonly fallbackNames: readonly string[];
  private fallbacks: Font[] | undefined;

  /**
   * @param glyphFallbacks TrueType files for glyphs missing from SHX fonts in MTEXT, in order
   *   (default: arial.ttf, seguisym.ttf, simsun.ttc — SimSun reproduced AutoCAD's CJK fallback
   *   glyph exactly, Arial's .notdef its control-character box).
   */
  constructor(
    manager: FontManager,
    styles: Iterable<TextStyleSpec>,
    encoding = "windows-1252",
    glyphFallbacks: readonly string[] = ["arial.ttf", "seguisym.ttf", "simsun.ttc"],
  ) {
    this.manager = manager;
    this.encoding = encoding;
    this.fallbackNames = glyphFallbacks;
    for (const s of styles) this.specs.set(s.name.toUpperCase(), s);
  }

  fallbackGlyph(cp: number): ResolvedGlyph | undefined {
    for (const f of this.fallbacks ?? []) {
      const g = f.glyph(cp);
      if (g) return { glyph: g, font: f, scale: 1 / f.capHeight, fallback: true };
    }
    return undefined;
  }

  notdefGlyph(font: StyleFont): ResolvedGlyph | undefined {
    const f =
      font.primary instanceof TtfFont ? font.primary : this.fallbacks?.find((x) => x instanceof TtfFont);
    if (!(f instanceof TtfFont)) return undefined;
    return { glyph: f.glyphByIndex(0), font: f, scale: 1 / f.capHeight, fallback: true };
  }

  /** Resolves every STYLE entry and the given inline fonts. */
  async prepare(inlineSpecs: Iterable<InlineFontSpec> = []): Promise<void> {
    if (!this.fallbacks) {
      const out: Font[] = [];
      for (const n of this.fallbackNames) {
        const f = await this.manager.loadFile(n);
        if (f) out.push(f);
      }
      this.fallbacks = out;
    }
    for (const [key, spec] of this.specs) {
      if (this.styles.has(key)) continue;
      const r = await this.manager.resolveStyle({
        fontFile: spec.font,
        bigFontFile: spec.bigFont,
        family: spec.ttfFamily,
        flags: spec.ttfFlags,
      });
      this.styles.set(key, {
        name: spec.name,
        font: r.font,
        suppressed: r.suppressed,
        spec,
        substitutions: r.substitutions,
      });
    }
    if (!this.fontAltStyle) {
      const r = await this.manager.resolveStyle({ fontFile: "" });
      this.fontAltStyle = {
        name: "",
        font: r.font,
        suppressed: false,
        spec: undefined,
        substitutions: r.substitutions,
      };
    }
    for (const spec of inlineSpecs) {
      const key = inlineFontKey(spec);
      if (this.inline.has(key)) continue;
      this.inline.set(key, await this.resolveInline(spec));
    }
  }

  private async resolveInline(spec: InlineFontSpec): Promise<StyleFont | undefined> {
    let name = spec.name.trim();
    if (name === "") return undefined;
    let big = "";
    const comma = name.indexOf(",");
    if (comma >= 0) {
      // `\fromans.shx,bigfont.shx;` selects a bigfont (mlightcad `splitInlineFontFamily`)
      big = name.slice(comma + 1).trim();
      name = name.slice(0, comma).trim();
    }
    const r = looksLikeFile(name)
      ? await this.manager.resolveStyle({ fontFile: name, bigFontFile: big })
      : await this.manager.resolveStyle({
          family: name,
          flags: (spec.bold ? 1 << 25 : 0) | (spec.italic ? 1 << 24 : 0),
          // an unknown family could also be an SHX file name without extension (`\Fgdt;`)
          fontFile: name,
          bigFontFile: big,
        });
    if (!r.font) return undefined;
    // Unknown family names try the name as a file (`\Ftxt;`, `\fromans;`) before FONTALT.
    if (!looksLikeFile(name) && r.substitutions.some((s) => s.reason === "unknown-family")) {
      const f = await this.manager.resolveStyle({ fontFile: name, bigFontFile: big });
      if (f.font && !f.substitutions.some((s) => s.reason === "missing-font")) return f.font;
    }
    return r.suppressed ? undefined : r.font;
  }

  style(name: string): ResolvedTextStyle {
    const key = name.toUpperCase();
    const hit = this.styles.get(key) ?? this.styles.get("STANDARD");
    if (hit) return hit;
    return (
      this.fontAltStyle ?? { name, font: undefined, suppressed: false, spec: undefined, substitutions: [] }
    );
  }

  inlineFont(spec: InlineFontSpec): StyleFont | undefined {
    return this.inline.get(inlineFontKey(spec));
  }
}

// ---- code mapping --------------------------------------------------------------------------

const encoders = new Map<string, Map<number, number>>();
const DBCS = new Set(["shift_jis", "gbk", "gb2312", "big5", "euc-kr", "gb18030"]);

/** Reverse code page table: Unicode code point → byte (or lead·256 + trail for DBCS pages). */
function encoderFor(encoding: string): Map<number, number> {
  const key = encoding.toLowerCase();
  let m = encoders.get(key);
  if (m) return m;
  m = new Map();
  let dec: TextDecoder | undefined;
  try {
    dec = new TextDecoder(key);
  } catch {
    dec = undefined;
  }
  if (dec) {
    for (let b = 0x80; b <= 0xff; b++) {
      const s = dec.decode(new Uint8Array([b]));
      if (s.length === 1 && s !== "�" && !m.has(s.charCodeAt(0))) m.set(s.charCodeAt(0), b);
    }
    if (DBCS.has(key)) {
      for (let lead = 0x81; lead <= 0xfe; lead++) {
        for (let trail = 0x40; trail <= 0xfe; trail++) {
          const s = dec.decode(new Uint8Array([lead, trail]));
          if (s.length === 1 && s !== "�") {
            const cp = s.charCodeAt(0);
            if (!m.has(cp)) m.set(cp, (lead << 8) | trail);
          }
        }
      }
    }
  }
  encoders.set(key, m);
  return m;
}

export interface CharForCode {
  readonly cp: number;
  readonly symbol?: SpecialSymbol | undefined;
  readonly numeric?: boolean | undefined;
}

/**
 * The glyph code of a character for a style font (note 04 §4.4, §4.5, §5):
 * - TTF and Unicode SHX (unifonts): the Unicode code point. `%%c` is U+00D8 for TTF
 *   (VERIFIED-BY-ACAD); for unifonts U+2205 when the font has it, else U+00D8 (UNKNOWN).
 * - Non-Unicode SHX: `%%d %%p %%c` → shapes 256/257/258 (ADSK); other characters → the code page
 *   byte (DBCS pairs as lead·256 + trail for bigfonts); `%%nnn` → shape nnn (ASSUMPTION).
 */
export function glyphCode(font: StyleFont, ch: CharForCode, encoding: string): number {
  const p = font.primary;
  const shape = p instanceof ShxFont && !p.isUnicode;
  if (ch.symbol) {
    if (shape) return ch.symbol === "degree" ? 256 : ch.symbol === "plusminus" ? 257 : 258;
    if (ch.symbol === "diameter" && p instanceof ShxFont && p.hasGlyph(0x2205)) return 0x2205;
    return ch.cp;
  }
  if (ch.numeric || !shape || ch.cp < 0x80) return ch.cp;
  return encoderFor(encoding).get(ch.cp) ?? 0x3f;
}
