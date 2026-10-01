/**
 * Device-independent text layout: the output of the TEXT/ATTRIB/MTEXT layout engines. A
 * renderer turns glyph placements into strokes (SHX) or filled outlines (TTF), decoration lines
 * into lines at the entity's lineweight and background rectangles into fills.
 *
 * Coordinates: everything is in the 2D **text plane** (OCS x/y of the entity; MTEXT uses the
 * OCS of its extrusion), and `plane` maps plane coordinates (z = 0) to WCS.
 */
import type { Font, Glyph } from "@truedxf/fonts";
import type { Affine2, Matrix44 } from "@truedxf/geometry";

/**
 * Inline colour of MTEXT runs (`\C`, `\c`). `undefined` = the entity's own resolved colour.
 * ACI 0 = ByBlock, 256 = ByLayer (resolved by the renderer in the entity's context).
 */
export type ColorOverride =
  | { readonly kind: "aci"; readonly aci: number }
  | { readonly kind: "rgb"; readonly rgb: number };

export interface GlyphPlacement {
  readonly glyph: Glyph;
  readonly font: Font;
  /** Font units → plane. Includes height, width factor, oblique, mirroring and rotation. */
  readonly matrix: Affine2;
  readonly color: ColorOverride | undefined;
  /** TrueType glyphs: index into `TextLayout.runs` and character index within that run. */
  readonly run?: { readonly run: number; readonly index: number };
}

/**
 * A TrueType text run: the characters AutoCAD hands to the raster plot driver as one string
 * (a TEXT line; an MTEXT line segment with one font, height and width). The driver places its
 * glyphs on whole device pixels (note 04 §14); renderers that emulate the plot use the exact
 * advances below to do the same.
 */
export interface TextRun {
  /** Unit baseline direction in the text plane. */
  readonly dirX: number;
  readonly dirY: number;
  /** Pen advance of every character, spaces included, in plane units along the baseline. */
  readonly advances: readonly number[];
}

export type DecorationKind = "underline" | "overline" | "strike" | "stack-bar" | "frame";

/** A straight line in plane coordinates, drawn with the entity's lineweight. */
export interface DecorationLine {
  readonly kind: DecorationKind;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly color: ColorOverride | undefined;
}

/** Background fill colour: an explicit colour or the canvas (paper) colour. */
export type BackgroundColor = ColorOverride | { readonly kind: "canvas" };

/** A filled quadrilateral (plane coordinates, 4 corners counter-clockwise), drawn before the text. */
export interface BackgroundFill {
  readonly corners: readonly [number, number, number, number, number, number, number, number];
  readonly color: BackgroundColor;
}

export interface TextLayout {
  /** Plane (x, y, 0) → WCS. */
  readonly plane: Matrix44;
  readonly backgrounds: readonly BackgroundFill[];
  readonly glyphs: readonly GlyphPlacement[];
  readonly lines: readonly DecorationLine[];
  /**
   * Extra plane-coordinate quads (8 numbers each) that count for the drawing extents but are not
   * drawn: AutoCAD's extents of TrueType text are the font cell boxes (pen start … advance end ×
   * baseline − descender … baseline + ascender), not the ink (note 04 §13).
   */
  readonly extents?: readonly number[];
  /** TrueType text runs referenced by `GlyphPlacement.run`. */
  readonly runs?: readonly TextRun[];
  /** Things the layout could not honour (unsupported features, missing glyphs), for diagnostics. */
  readonly notes: readonly string[];
}

export const EMPTY_LAYOUT_NOTES: readonly string[] = Object.freeze([]);
