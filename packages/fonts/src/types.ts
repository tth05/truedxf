// Shared geometry and font types of @truedxf/fonts. The package deliberately has no dependency on
// other truedxf packages, so it defines its own small path/glyph types here.

/** Axis-aligned box. Empty boxes are represented by `undefined` at the use sites. */
export interface Bounds {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/**
 * Vertex of an SHX stroke. `bulge` belongs to the segment that *starts* at this vertex (DXF
 * LWPOLYLINE convention): 0 = straight, tan(sweep/4) otherwise, positive = counter-clockwise.
 * The last vertex's bulge is always 0.
 */
export interface StrokeVertex {
  x: number;
  y: number;
  bulge: number;
}

/** One pen-down run of an SHX glyph: an open polyline, never filled (note 04 §4.4). */
export interface Stroke {
  vertices: StrokeVertex[];
}

/** Flattened stroke: `[x0, y0, x1, y1, …]`. */
export type Polyline = number[];

/** Outline path command (TTF/OTF), font units, y up. */
export type PathCommand =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Z" };

interface GlyphBase {
  /** The code the glyph was requested with (Unicode code point, code page byte or DBCS code). */
  code: number;
  /** Horizontal pen advance in font units. SHX: final pen x; TTF: hmtx advance (no kerning). */
  advance: number;
  /** Ink box in font units, `undefined` for glyphs without ink (space). */
  bounds: Bounds | undefined;
}

/** SHX glyph: stroked polylines (with exact arcs as bulges) in font units, baseline at y = 0. */
export interface StrokeGlyph extends GlyphBase {
  kind: "strokes";
  strokes: Stroke[];
  /** Final pen y (SHX glyphs may end off the baseline; vertical text advances in −y). */
  advanceY: number;
}

/** TTF/OTF glyph: filled outline in font units, baseline at y = 0, y up. */
export interface OutlineGlyph extends GlyphBase {
  kind: "outline";
  path: PathCommand[];
}

export type Glyph = StrokeGlyph | OutlineGlyph;

export type FontKind = "shx" | "ttf";

/** Options for glyph lookup. */
export interface GlyphOptions {
  /** Vertical text (STYLE flag 4): SHX code 0x0E commands execute (only in fonts with modes = 2). */
  vertical?: boolean;
}

/** Unified font interface over SHX and TrueType/OpenType fonts. All metrics are in font units. */
export interface Font {
  readonly kind: FontKind;
  /** File name or family the font was loaded as (informational). */
  readonly name: string;
  /**
   * The height that corresponds to the DXF text height (= cap height, note 04 §0.1).
   * SHX: `above`; TTF: yMax of glyph "A".
   */
  readonly capHeight: number;
  /** Font-wide ascent (SHX: above; TTF: hhea ascender). */
  readonly ascent: number;
  /** Font-wide descent as a positive number (SHX: below; TTF: hhea descender), used for TEXT Bottom. */
  readonly descent: number;
  /** Units per em (TTF) — SHX fonts report `capHeight`. Used to scale fallback glyphs. */
  readonly unitsPerEm: number;
  /** Factor from font units to drawing units for text height `h` (= h / capHeight). */
  scaleForHeight(height: number): number;
  hasGlyph(code: number): boolean;
  /** Glyph for a code, `undefined` if the font does not contain it. Results are cached. */
  glyph(code: number, options?: GlyphOptions): Glyph | undefined;
}
