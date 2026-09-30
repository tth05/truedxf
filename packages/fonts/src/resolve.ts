// Font resolution following AutoCAD 2027 (note 04 §4.1), a font cache, and StyleFont: the
// per-text-style composite of primary font, bigfont and glyph fallbacks.

import { baseName, type FontProvider } from "./provider.ts";
import { ShxFont, type ShxFontOptions } from "./shx/font.ts";
import { isShx } from "./shx/parse.ts";
import { TtfFont } from "./ttf/font.ts";
import { faceCount, isSfnt, readNames, type SfntNames } from "./ttf/sfnt.ts";
import type { Font, Glyph, GlyphOptions } from "./types.ts";

/** Font fields of a STYLE table entry. */
export interface StyleFontSpec {
  /** Group 3: primary font file ("txt", "simplex.shx", "arial.ttf"). */
  fontFile?: string;
  /** Group 4: bigfont file. */
  bigFontFile?: string;
  /** XDATA (AppID ACAD) 1000: TrueType family name — wins over group 3. */
  family?: string;
  /** XDATA 1071: LOGFONT-style flags; bit 24 = italic, bit 25 = bold. */
  flags?: number;
}

export type SubstitutionReason =
  | "font-map"
  | "empty-font"
  | "full-path"
  | "missing-font"
  | "unknown-family"
  | "fontalt-missing"
  | "missing-bigfont"
  | "not-a-bigfont"
  | "bigfont-ignored";

/** Every deviation from the requested fonts is reported (PLOT with a missing font is a different drawing). */
export interface FontSubstitution {
  reason: SubstitutionReason;
  requested: string;
  used?: string;
}

export interface FontManagerOptions {
  /** FONTALT: substitute for unresolved fonts. AutoCAD 2027 default "simplex.shx". */
  fontAlt?: string;
  /** acad.fmp-style map `original → substitute` (file names, case-insensitive), applied first. */
  fontMap?: Record<string, string> | ReadonlyMap<string, string>;
  /**
   * TrueType files searched, in order, for glyphs missing from a TTF primary font. AutoCAD draws
   * them from a Windows fallback font at the primary font's scale (note 04 §4.5); which font is
   * UNKNOWN, so the chain is configurable (e.g. ["arialuni.ttf", "simsun.ttc"]).
   */
  glyphFallbacks?: readonly string[];
  /** Missing bigfont: "suppress" (default; the core console drew nothing, note 04 §4.1 item 5) or "ignore". */
  missingBigFont?: "suppress" | "ignore";
  /** AutoCAD 2027 did not resolve absolute paths in group 3 (→ FONTALT). `true` uses the base name. */
  resolveFullPaths?: boolean;
  /** Bigfont glyph scale: by the bigfont's own `above` (default) or the primary font's. UNKNOWN in AutoCAD. */
  bigFontScale?: "own" | "primary";
  /** Options for every SHX font (pen rounding etc.). */
  shx?: ShxFontOptions;
  /** Used when even FONTALT cannot be loaded. */
  lastResort?: Font;
}

export interface ResolvedGlyph {
  glyph: Glyph;
  font: Font;
  /** Drawing units per font unit for text height 1: multiply coordinates by `scale · h`. */
  scale: number;
  /** The glyph is a substitute: from a fallback font, or the "?" AutoCAD draws for missing SHX glyphs. */
  fallback: boolean;
}

export interface ResolvedStyle {
  /** `undefined` when nothing could be loaded at all. */
  font: StyleFont | undefined;
  /** Text using this style must not be drawn (missing bigfont). */
  suppressed: boolean;
  substitutions: FontSubstitution[];
}

const QUESTION_MARK = 0x3f;

/** Primary font + optional bigfont + per-glyph fallbacks of one text style. */
export class StyleFont {
  readonly primary: Font;
  readonly bigFont: ShxFont | undefined;
  readonly glyphFallbacks: readonly Font[];
  private readonly bigScale: "own" | "primary";

  constructor(
    primary: Font,
    bigFont?: ShxFont,
    glyphFallbacks: readonly Font[] = [],
    bigFontScale: "own" | "primary" = "own",
  ) {
    this.primary = primary;
    // Bigfont subshapes that are not in the bigfont refer to the primary font (special.shx).
    this.bigFont = bigFont && primary instanceof ShxFont ? bigFont.withCompanion(primary) : bigFont;
    this.glyphFallbacks = glyphFallbacks;
    this.bigScale = bigFontScale;
  }

  get kind(): Font["kind"] {
    return this.primary.kind;
  }

  /** Font descent in text heights (TEXT Bottom alignment = baseline − descent·h, note 04 §1.4). */
  get descentRatio(): number {
    return this.primary.descent / this.primary.capHeight;
  }

  /**
   * Glyph for a code: Unicode code point (TTF, unifonts), code page byte (shape fonts) or DBCS
   * code lead·256 + trail (bigfonts). Bigfont first, then the primary font (ADSK "Big Font
   * Descriptions"); TTF misses go through `glyphFallbacks`; SHX misses become "?".
   */
  glyph(code: number, options: GlyphOptions = {}): ResolvedGlyph | undefined {
    const p = this.primary;
    const primaryScale = 1 / p.capHeight;
    const bf = this.bigFont;
    if (bf?.hasGlyph(code)) {
      const g = bf.glyph(code, options);
      if (g) {
        const scale = this.bigScale === "own" ? 1 / bf.capHeight : primaryScale;
        return { glyph: g, font: bf, scale, fallback: false };
      }
    }
    const g = p.glyph(code, options);
    if (g) return { glyph: g, font: p, scale: primaryScale, fallback: false };
    if (p.kind === "ttf") {
      for (const f of this.glyphFallbacks) {
        const fg = f.glyph(code, options);
        // Same em size as the primary font (Arial and the fallback fonts measured share upm).
        if (fg)
          return { glyph: fg, font: f, scale: primaryScale * (p.unitsPerEm / f.unitsPerEm), fallback: true };
      }
      return undefined;
    }
    // AutoCAD draws "?" for characters missing from an SHX font (note 04 §4.4).
    if (code !== QUESTION_MARK) {
      const q = p.glyph(QUESTION_MARK, options);
      if (q) return { glyph: q, font: p, scale: primaryScale, fallback: true };
    }
    return undefined;
  }
}

function hasExtension(name: string): boolean {
  return /\.[A-Za-z0-9]{2,4}$/.test(name);
}

function cleanName(name: string): string {
  let s = name.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s;
}

interface FamilyEntry extends SfntNames {
  file: string;
  face: number;
}

/**
 * Loads, caches and resolves fonts. All lookups are deterministic; loads are deduplicated.
 */
export class FontManager {
  readonly provider: FontProvider;
  readonly options: FontManagerOptions;
  private readonly fonts = new Map<string, Promise<Font | undefined>>();
  private readonly byFile = new Map<string, Font>();
  private readonly fontMap = new Map<string, string>();
  private families: Promise<FamilyEntry[]> | undefined;
  private fallbackFonts: Promise<Font[]> | undefined;

  constructor(provider: FontProvider, options: FontManagerOptions = {}) {
    this.provider = provider;
    this.options = options;
    const m = options.fontMap;
    if (m) {
      const entries = m instanceof Map ? [...m.entries()] : Object.entries(m as Record<string, string>);
      for (const [k, v] of entries) this.fontMap.set(k.toLowerCase(), v);
    }
  }

  /** Parses an acad.fmp file (`original;substitute` per line). */
  static parseFontMap(text: string): Map<string, string> {
    const m = new Map<string, string>();
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (l === "" || l.startsWith("#")) continue;
      const i = l.indexOf(";");
      if (i <= 0) continue;
      m.set(l.slice(0, i).trim(), l.slice(i + 1).trim());
    }
    return m;
  }

  private mapped(name: string): string | undefined {
    const direct = this.fontMap.get(name.toLowerCase());
    if (direct) return direct;
    if (!hasExtension(name)) {
      for (const ext of [".shx", ".ttf"]) {
        const v = this.fontMap.get(`${name}${ext}`.toLowerCase());
        if (v) return v;
      }
    }
    return undefined;
  }

  /**
   * Loads a font file by name (case-insensitive; without extension tries .shx, .ttf, .ttc, .otf —
   * `txt` → txt.shx, `arial` → arial.ttf). `name.ttc#2` selects a collection face. Cached.
   */
  loadFile(fileName: string): Promise<Font | undefined> {
    const key = fileName.toLowerCase();
    let p = this.fonts.get(key);
    if (!p) {
      p = this.load(fileName);
      this.fonts.set(key, p);
    }
    return p;
  }

  private async load(spec: string): Promise<Font | undefined> {
    let name = spec;
    let face = 0;
    const hash = spec.lastIndexOf("#");
    if (hash > 0 && /^\d+$/.test(spec.slice(hash + 1))) {
      name = spec.slice(0, hash);
      face = Number(spec.slice(hash + 1));
    }
    const candidates = hasExtension(name) ? [name] : [".shx", ".ttf", ".ttc", ".otf"].map((e) => name + e);
    for (const c of candidates) {
      // One instance per actual file (and face), however it was requested.
      const key = `${c.toLowerCase()}#${face}`;
      const cached = this.byFile.get(key);
      if (cached) return cached;
      const bytes = await this.provider.getFile(c);
      if (!bytes) continue;
      const font = this.fromBytes(bytes, face ? `${c}#${face}` : c, face);
      if (font) this.byFile.set(key, font);
      return font;
    }
    return undefined;
  }

  /** Builds a Font from bytes (SHX or sfnt); `undefined` for unsupported formats. */
  fromBytes(bytes: Uint8Array, name: string, face = 0): Font | undefined {
    try {
      if (isShx(bytes)) return ShxFont.fromBytes(bytes, name, this.options.shx);
      if (isSfnt(bytes)) return new TtfFont(bytes, name, { face });
    } catch {
      return undefined;
    }
    return undefined;
  }

  private familyIndex(): Promise<FamilyEntry[]> {
    this.families ??= (async () => {
      const out: FamilyEntry[] = [];
      const files = (await this.provider.listFiles?.()) ?? [];
      for (const file of [...files].sort()) {
        if (!/\.(ttf|ttc|otf)$/i.test(file)) continue;
        const bytes = await this.provider.getFile(file);
        if (!bytes || !isSfnt(bytes)) continue;
        try {
          const n = faceCount(bytes);
          for (let face = 0; face < n; face++) out.push({ ...readNames(bytes, face), file, face });
        } catch {
          // unreadable font: skip
        }
      }
      return out;
    })();
    return this.families;
  }

  /**
   * TrueType font by family (the GDI face name AutoCAD stores in STYLE XDATA) and style bits.
   * Exact bold/italic match first, then the closest face (GDI would synthesize — UNKNOWN in
   * AutoCAD).
   */
  async findFamily(family: string, bold = false, italic = false): Promise<TtfFont | undefined> {
    const want = family.trim().toLowerCase();
    if (want === "") return undefined;
    const direct = await this.provider.findFamily?.(family, { bold, italic });
    if (direct) {
      const f = await this.loadFile(direct);
      if (f instanceof TtfFont) return f;
    }
    const all = await this.familyIndex();
    let best: FamilyEntry | undefined;
    let bestScore = -1;
    for (const e of all) {
      let score: number;
      if (e.family.toLowerCase() === want) score = 8;
      else if (e.typographicFamily?.toLowerCase() === want) score = 4;
      else if (e.fullName?.toLowerCase() === want) score = 4;
      else continue;
      if (e.bold === bold) score += 2;
      if (e.italic === italic) score += 1;
      if (score > bestScore) {
        best = e;
        bestScore = score;
      }
    }
    if (!best) return undefined;
    const f = await this.loadFile(best.face ? `${best.file}#${best.face}` : best.file);
    return f instanceof TtfFont ? f : undefined;
  }

  private glyphFallbackFonts(): Promise<Font[]> {
    this.fallbackFonts ??= (async () => {
      const out: Font[] = [];
      for (const n of this.options.glyphFallbacks ?? []) {
        const f = await this.loadFile(n);
        if (f) out.push(f);
      }
      return out;
    })();
    return this.fallbackFonts;
  }

  private async fontAlt(subs: FontSubstitution[]): Promise<Font | undefined> {
    const alt = this.options.fontAlt ?? "simplex.shx";
    const f = await this.loadFile(alt);
    if (f) return f;
    const last = this.options.lastResort;
    subs.push({ reason: "fontalt-missing", requested: alt, ...(last ? { used: last.name } : {}) });
    return last;
  }

  /** Resolves a STYLE's fonts like AutoCAD 2027 (note 04 §4.1 "Resolution precedence"). */
  async resolveStyle(spec: StyleFontSpec): Promise<ResolvedStyle> {
    const subs: FontSubstitution[] = [];
    const altName = this.options.fontAlt ?? "simplex.shx";
    let primary: Font | undefined;
    const family = spec.family?.trim() ?? "";
    if (family !== "") {
      // 1. A non-empty XDATA family wins over group 3, even if group 3 is an SHX.
      const flags = spec.flags ?? 0;
      primary = await this.findFamily(family, (flags & (1 << 25)) !== 0, (flags & (1 << 24)) !== 0);
      if (!primary) {
        subs.push({ reason: "unknown-family", requested: family, used: altName });
        primary = await this.fontAlt(subs);
      }
    } else {
      primary = await this.resolveFile(spec.fontFile ?? "", subs, false);
    }

    let bigFont: ShxFont | undefined;
    let suppressed = false;
    const bigName = cleanName(spec.bigFontFile ?? "");
    if (bigName !== "") {
      if (primary && primary.kind !== "shx") {
        // A bigfont next to a TTF primary font is ignored (note 04 §4.1 item 5).
        subs.push({ reason: "bigfont-ignored", requested: bigName });
      } else {
        const bf = await this.resolveFile(bigName, subs, true);
        if (bf instanceof ShxFont && bf.isBigFont) bigFont = bf;
        else if (bf) subs.push({ reason: "not-a-bigfont", requested: bigName });
        else if ((this.options.missingBigFont ?? "suppress") === "suppress") suppressed = true;
      }
    }

    const fallbacks = primary?.kind === "ttf" ? await this.glyphFallbackFonts() : [];
    const font = primary ? new StyleFont(primary, bigFont, fallbacks, this.options.bigFontScale) : undefined;
    return { font, suppressed, substitutions: subs };
  }

  /** Group 3 / group 4 resolution: quotes, full paths, font map, file lookup, FONTALT. */
  private async resolveFile(
    raw: string,
    subs: FontSubstitution[],
    isBig: boolean,
  ): Promise<Font | undefined> {
    let name = cleanName(raw);
    const altName = this.options.fontAlt ?? "simplex.shx";
    const fail = async (reason: SubstitutionReason, requested: string): Promise<Font | undefined> => {
      if (isBig) {
        subs.push({ reason: "missing-bigfont", requested });
        return undefined;
      }
      subs.push({ reason, requested, used: altName });
      return this.fontAlt(subs);
    };
    if (name === "") return fail("empty-font", raw);
    if (/[\\/]|^[A-Za-z]:/.test(name)) {
      // AutoCAD 2027: `C:\Windows\Fonts\arial.ttf` in group 3 did NOT resolve (→ FONTALT).
      if (!this.options.resolveFullPaths) return fail("full-path", name);
      name = baseName(name);
    }
    const m = this.mapped(name);
    if (m && m.toLowerCase() !== name.toLowerCase()) {
      subs.push({ reason: "font-map", requested: name, used: m });
      name = m;
    }
    const f = await this.loadFile(name);
    if (f) return f;
    return fail("missing-font", name);
  }
}
