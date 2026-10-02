// TtfFont: TrueType/OpenType fonts via opentype.js, with AutoCAD's metric rules (note 04 §4.5).

import * as opentypeNs from "opentype.js";
import { toArrayBuffer } from "../bytes.ts";
import { pathBounds } from "../geom.ts";
import type { Font, OutlineGlyph, PathCommand } from "../types.ts";
import { extractFace, readNames, type SfntNames } from "./sfnt.ts";

// Narrow structural view of the opentype.js 2.x objects we use (its bundled typings are for 1.x).
interface OtPathCommand {
  type: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}
interface OtGlyph {
  index: number;
  advanceWidth?: number;
  path: { commands: OtPathCommand[] } | (() => { commands: OtPathCommand[] });
  getPath?: unknown;
}
interface OtFont {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  tables: Record<string, Record<string, unknown> | undefined>;
  charToGlyphIndex(s: string): number;
  glyphs: { get(index: number): OtGlyph };
}
interface OtModule {
  parse(buffer: ArrayBuffer, options?: unknown): OtFont;
}

// opentype.js ships a UMD bundle: under Node's ESM loader the API is on `default`, bundlers
// (vite) pick the ESM build with named exports.
const opentype: OtModule = (() => {
  const ns = opentypeNs as unknown as { parse?: unknown; default?: unknown };
  return (typeof ns.parse === "function" ? ns : ns.default) as OtModule;
})();

export interface TtfMetrics {
  unitsPerEm: number;
  /** yMax of glyph "A" (AutoCAD's cap height basis). */
  capHeightA: number | undefined;
  /** OS/2 sCapHeight. */
  os2CapHeight: number | undefined;
  hheaAscender: number;
  /** Positive. AutoCAD's TEXT Bottom uses this (Arial 434/1466, note 04 §1.4). */
  hheaDescender: number;
  winAscent: number | undefined;
  winDescent: number | undefined;
  typoAscender: number | undefined;
  typoDescender: number | undefined;
  xHeight: number | undefined;
}

export interface TtfFontOptions {
  /** Face index for .ttc collections (default 0). */
  face?: number;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export class TtfFont implements Font {
  readonly kind = "ttf" as const;
  readonly name: string;
  readonly capHeight: number;
  readonly ascent: number;
  readonly descent: number;
  readonly unitsPerEm: number;
  readonly metrics: TtfMetrics;
  readonly names: SfntNames;
  /** How capHeight was determined ("A" is AutoCAD's rule; the others are fallbacks, UNKNOWN). */
  readonly capHeightSource: "A" | "os2" | "ascender";
  private readonly ot: OtFont;
  private readonly cache = new Map<number, OutlineGlyph | undefined>();

  constructor(bytes: Uint8Array, name = "", options: TtfFontOptions = {}) {
    const face = extractFace(bytes, options.face ?? 0);
    // Resolve only requested glyphs. Layout uses cmap + plain hmtx advances and
    // explicit outlines, without GSUB shaping or kerning (note 04 section 4.5).
    this.ot = opentype.parse(toArrayBuffer(face), { lowMemory: true });
    this.names = readNames(face);
    this.name = name || this.names.family;
    const ot = this.ot;
    const os2 = ot.tables.os2 ?? {};
    const hhea = ot.tables.hhea ?? {};
    const upm = ot.unitsPerEm;
    const aIndex = ot.charToGlyphIndex("A");
    let capA: number | undefined;
    if (aIndex > 0) {
      const b = pathBounds(this.commands(ot.glyphs.get(aIndex)));
      if (b && b.yMax > 0) capA = b.yMax;
    }
    this.metrics = {
      unitsPerEm: upm,
      capHeightA: capA,
      os2CapHeight: num(os2.sCapHeight),
      hheaAscender: num(hhea.ascender) ?? ot.ascender,
      hheaDescender: -(num(hhea.descender) ?? ot.descender),
      winAscent: num(os2.usWinAscent),
      winDescent: num(os2.usWinDescent),
      typoAscender: num(os2.sTypoAscender),
      typoDescender: num(os2.sTypoDescender),
      xHeight: num(os2.sxHeight),
    };
    // Text height = yMax of "A" (VERIFIED-BY-ACAD, note 04 §4.5). Fonts without "A": UNKNOWN →
    // OS/2 cap height, then the ascender.
    if (capA !== undefined) {
      this.capHeight = capA;
      this.capHeightSource = "A";
    } else if (this.metrics.os2CapHeight && this.metrics.os2CapHeight > 0) {
      this.capHeight = this.metrics.os2CapHeight;
      this.capHeightSource = "os2";
    } else {
      this.capHeight = this.metrics.hheaAscender > 0 ? this.metrics.hheaAscender : upm;
      this.capHeightSource = "ascender";
    }
    this.ascent = this.metrics.hheaAscender;
    this.descent = this.metrics.hheaDescender;
    this.unitsPerEm = upm;
  }

  get family(): string {
    return this.names.family;
  }

  scaleForHeight(height: number): number {
    return height / this.capHeight;
  }

  private glyphIndex(code: number): number {
    if (code < 0 || code > 0x10ffff) return 0;
    return this.ot.charToGlyphIndex(String.fromCodePoint(code));
  }

  hasGlyph(code: number): boolean {
    return this.glyphIndex(code) > 0;
  }

  private commands(g: OtGlyph): PathCommand[] {
    const p = typeof g.path === "function" ? g.path() : g.path;
    const out: PathCommand[] = [];
    for (const c of p?.commands ?? []) {
      switch (c.type) {
        case "M":
        case "L":
          out.push({ type: c.type, x: c.x!, y: c.y! });
          break;
        case "Q":
          out.push({ type: "Q", x1: c.x1!, y1: c.y1!, x: c.x!, y: c.y! });
          break;
        case "C":
          out.push({ type: "C", x1: c.x1!, y1: c.y1!, x2: c.x2!, y2: c.y2!, x: c.x!, y: c.y! });
          break;
        case "Z":
          out.push({ type: "Z" });
          break;
      }
    }
    return out;
  }

  /** Glyph outline in font units (y up); `undefined` when the font has no glyph for the code. */
  glyph(code: number): OutlineGlyph | undefined {
    if (this.cache.has(code)) return this.cache.get(code);
    const index = this.glyphIndex(code);
    let g: OutlineGlyph | undefined;
    if (index > 0) g = this.glyphByIndex(index, code);
    this.cache.set(code, g);
    return g;
  }

  /** Glyph by glyph index (0 = .notdef), not cached. */
  glyphByIndex(index: number, code = -1): OutlineGlyph {
    const og = this.ot.glyphs.get(index);
    const path = this.commands(og);
    // No kerning: AutoCAD uses plain hmtx advances (note 04 §4.5).
    return { kind: "outline", code, path, advance: og.advanceWidth ?? 0, bounds: pathBounds(path) };
  }
}
