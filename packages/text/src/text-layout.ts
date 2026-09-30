/**
 * Single-line text layout: TEXT, ATTRIB, ATTDEF (research/notes/04-text-fonts.md §1).
 *
 * Measured AutoCAD 2027 rules (note 04 §1.4, VERIFIED-BY-ACAD for TTF):
 * - h = cap height; glyphs advance by their pen advance, no kerning;
 * - vertical anchors: Top = +h, Middle = +h/2, Bottom = −descent·h/cap (font-wide), Baseline = 0,
 *   72 = 4 "Middle" = centre of the string's ink box;
 * - horizontal box for Center/Right/Middle/Fit/Aligned: TTF = union of the advance box
 *   [0, Σadvance] and the ink box; SHX = the ink box [inkLeft, inkRight], but the advance box
 *   [0, Σadvance] when the string ends in a space (VERIFIED-BY-ACAD 2026-09-30 with simplex.shx,
 *   suite text: hbox-*, spaces-*, 195 alignment cases);
 * - 72/73 ≠ 0 → the anchor is 11, everything else is recomputed (10 is a cache).
 *
 * Transform order (UNVERIFIED parts marked): glyph → height/width factor → oblique shear about
 * the baseline (x' = x + y·tan θ, applied *after* the width factor — UNVERIFIED, note 04 §1.5
 * item 2) → shift by the alignment offset → backward/upside-down mirror about the anchor →
 * rotation → anchor → OCS.
 */
import type { StyleFont } from "@truedxf/fonts";
import { Affine2, Matrix44, ocsToWcsMatrix, type Vec3 } from "@truedxf/geometry";
import { glyphCode, type TextFontSource } from "./fonts.ts";
import { InkBox, type MeasuredGlyph, measureGlyph } from "./glyphs.ts";
import { decodeTextString, type TextChar } from "./specials.ts";
import type { DecorationLine, GlyphPlacement, TextLayout } from "./types.ts";

/** The TEXT/ATTRIB/ATTDEF fields the layout needs (structurally compatible with @truedxf/model). */
export interface TextInput {
  readonly text: string;
  /** Group 10 (OCS). */
  readonly insert: Vec3;
  /** Group 11 (OCS), undefined when absent. */
  readonly alignPoint: Vec3 | undefined;
  readonly height: number;
  /** Degrees. */
  readonly rotation: number;
  readonly widthFactor: number;
  /** Degrees. */
  readonly oblique: number;
  readonly style: string;
  readonly generationFlags: number;
  readonly halign: number;
  readonly valign: number;
  readonly extrusion: Vec3;
}

export interface TextLayoutOptions {
  /**
   * Debug: place the text at the stored first alignment point 10 as left/baseline text instead of
   * recomputing from 11 (note 04 §1.3 "use stored 10" switch).
   */
  useStoredInsert?: boolean;
  /**
   * Decoration line offsets in text heights (UNKNOWN in AutoCAD, note 04 §8.6): underline below
   * the baseline, overline above the baseline, strike-through above the baseline.
   */
  underlineOffset?: number;
  overlineOffset?: number;
  strikeOffset?: number;
}

/** Default decoration offsets in text heights — UNVERIFIED guesses (note 04 §1.6 / §8.6). */
export const TEXT_DECORATION = { underline: -0.2, overline: 1.2, strike: 0.5 } as const;

interface Placed {
  readonly m: MeasuredGlyph;
  readonly pen: number;
  readonly ch: TextChar;
}

/** Horizontal/vertical metrics of a single line at h = 1, w = 1. */
export interface LineMetrics {
  readonly glyphs: readonly Placed[];
  /** Pen position after the last glyph. */
  readonly advance: number;
  readonly ink: InkBox;
  /** Alignment box [x0, x1]. */
  readonly x0: number;
  readonly x1: number;
}

/** Lays out the characters of one line at h = 1 without width factor (pen positions + boxes). */
export function measureLine(chars: readonly TextChar[], font: StyleFont, encoding: string): LineMetrics {
  const glyphs: Placed[] = [];
  const ink = new InkBox();
  let pen = 0;
  for (const ch of chars) {
    // control characters render as "?" in TEXT (note 04 §1.6)
    const c = ch.cp < 0x20 && !ch.numeric ? { ...ch, cp: 0x3f } : ch;
    const m = measureGlyph(font, glyphCode(font, c, encoding));
    glyphs.push({ m, pen, ch });
    if (m.ink) ink.add(m.ink, pen, 0);
    pen += m.advance;
  }
  let x0: number;
  let x1: number;
  if (ink.empty) {
    x0 = 0;
    x1 = pen;
  } else if (font.kind === "ttf") {
    x0 = Math.min(0, ink.xMin);
    x1 = Math.max(pen, ink.xMax);
  } else if (!glyphs[glyphs.length - 1]?.m.ink) {
    // SHX with trailing spaces: the advance box (VERIFIED-BY-ACAD, text/spaces-* via simplex.shx)
    x0 = 0;
    x1 = pen;
  } else {
    // SHX: the ink box, a leading space is not counted (VERIFIED-BY-ACAD, text/hbox-*, spaces-*)
    x0 = ink.xMin;
    x1 = ink.xMax;
  }
  return { glyphs, advance: pen, ink, x0, x1 };
}

function emptyLayout(plane: Matrix44, notes: string[]): TextLayout {
  return { plane, backgrounds: [], glyphs: [], lines: [], notes };
}

const DEG = Math.PI / 180;

/** The placement of a single-line text: frame (h = 1 text units → OCS plane) and metrics. */
export interface TextFrame {
  /** Text units (cap height 1, pen origin at 0, baseline y = 0) → OCS x/y. */
  readonly frame: Affine2;
  readonly line: LineMetrics;
  /** Effective height and width factor (ALIGNED/FIT recompute them). */
  readonly height: number;
  readonly widthFactor: number;
  /** Effective rotation, radians. */
  readonly rotation: number;
  /** OCS z of the text plane. */
  readonly elevation: number;
}

/**
 * Computes where a TEXT/ATTRIB/ATTDEF goes. `frame.apply({x: 0, y: 0})` is AutoCAD's first
 * alignment point 10 (the left end of the baseline). Undefined when nothing is drawn.
 */
export function textFrame(
  e: TextInput,
  fonts: TextFontSource,
  options: TextLayoutOptions = {},
  notes: string[] = [],
): TextFrame | undefined {
  const style = fonts.style(e.style);
  const font = style.font;
  if (style.suppressed || !font) {
    notes.push(style.suppressed ? "text-suppressed-missing-bigfont" : "text-no-font");
    return undefined;
  }
  let h = e.height;
  if (!(h > 0)) {
    // ezdxf skips height-0 text; AutoCAD behaviour UNKNOWN (note 04 §1.5)
    notes.push("text-height-0");
    return undefined;
  }
  if (style.spec?.vertical) notes.push("text-vertical-unsupported");
  const chars = decodeTextString(e.text);
  const line = measureLine(chars, font, fonts.encoding);
  let w = e.widthFactor || 1;
  const tanOb = Math.tan((e.oblique || 0) * DEG);
  let rot = (e.rotation || 0) * DEG;
  let sx = e.generationFlags & 2 ? -1 : 1;
  let sy = e.generationFlags & 4 ? -1 : 1;
  // unknown 72 values fall back to LEFT (ezdxf; AutoCAD keeps 10, text/combo-invalid-*)
  const halign = e.halign >= 0 && e.halign <= 5 ? e.halign : 0;
  // 72 > 2 ignores 73 (ezdxf get_align_enum); unknown combinations fall back to LEFT
  const valign = halign > 2 || e.valign < 0 || e.valign > 3 ? 0 : e.valign;
  let anchor: Vec3 = e.insert;
  let ax = 0;
  let ay = 0;
  const boxW = line.x1 - line.x0;
  if (options.useStoredInsert) {
    // stored 10 is the (mirrored) left end of the baseline
  } else if (halign === 3 || halign === 5) {
    const p1 = e.insert;
    const p2 = e.alignPoint ?? e.insert;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-12 && boxW > 1e-12) {
      rot = Math.atan2(dy, dx);
      if (halign === 3) h = d / (boxW * w);
      else w = d / (boxW * h);
      // FIT/ALIGNED mirror quirks (ezdxf#353, VERIFIED AutoCAD): upside-down mirrors about the
      // baseline; backward does *not* mirror about the start point — we keep the text between the
      // two points (mirror about the box centre, UNVERIFIED); with both flags AutoCAD mirrors nothing.
      if (sx < 0 && sy < 0) {
        sx = 1;
        sy = 1;
      }
      if (sx < 0) {
        anchor = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, z: p1.z };
        ax = (line.x0 + line.x1) / 2;
      } else ax = line.x0;
    }
    // coincident points: LEFT at 10 with the stored height/width (note 04 §1.3, ASSUMPTION)
  } else if (halign !== 0 || valign !== 0) {
    anchor = e.alignPoint ?? e.insert;
    if (halign === 4) {
      ax = (line.x0 + line.x1) / 2;
      ay = line.ink.empty ? 0.5 : (line.ink.yMin + line.ink.yMax) / 2;
    } else {
      ax = halign === 1 ? (line.x0 + line.x1) / 2 : halign === 2 ? line.x1 : 0;
      if (valign === 1) ay = -font.descentRatio;
      else if (valign === 2) ay = 0.5;
      else if (valign === 3) ay = 1;
    }
  }
  // text frame (h = 1 units) → plane
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  // X = h·(w·(x − ax) + tanθ·y), Y = h·(y − ay); then mirror, rotate, translate
  const frame = new Affine2(
    cr * sx * h * w,
    sr * sx * h * w,
    cr * sx * h * tanOb - sr * sy * h,
    sr * sx * h * tanOb + cr * sy * h,
    anchor.x + cr * sx * (-h * w * ax) - sr * sy * (-h * ay),
    anchor.y + sr * sx * (-h * w * ax) + cr * sy * (-h * ay),
  );
  return { frame, line, height: h, widthFactor: w, rotation: rot, elevation: anchor.z };
}

/** Lays out a TEXT/ATTRIB/ATTDEF entity. */
export function layoutText(e: TextInput, fonts: TextFontSource, options: TextLayoutOptions = {}): TextLayout {
  const notes: string[] = [];
  const ocs = ocsToWcsMatrix(e.extrusion);
  const tf = textFrame(e, fonts, options, notes);
  if (!tf) return emptyLayout(ocs, notes);
  const { frame, line } = tf;
  const glyphs: GlyphPlacement[] = [];
  for (const g of line.glyphs) {
    const r = g.m.resolved;
    if (!r?.glyph.bounds) continue;
    const s = r.scale;
    glyphs.push({
      glyph: r.glyph,
      font: r.font,
      matrix: frame.multiply(new Affine2(s, 0, 0, s, g.pen, 0)),
      color: undefined,
    });
  }
  const lines = decorations(line, frame, options);
  const plane = tf.elevation !== 0 ? ocs.multiply(Matrix44.translation(0, 0, tf.elevation)) : ocs;
  return { plane, backgrounds: [], glyphs, lines, notes };
}

function decorations(line: LineMetrics, frame: Affine2, o: TextLayoutOptions): DecorationLine[] {
  const out: DecorationLine[] = [];
  const kinds = [
    ["underline", o.underlineOffset ?? TEXT_DECORATION.underline],
    ["overline", o.overlineOffset ?? TEXT_DECORATION.overline],
    ["strike", o.strikeOffset ?? TEXT_DECORATION.strike],
  ] as const;
  for (const [kind, y] of kinds) {
    let start = -1;
    let end = 0;
    const flush = () => {
      if (start >= 0 && end > start) {
        const a = frame.apply({ x: start, y });
        const b = frame.apply({ x: end, y });
        out.push({ kind, x0: a.x, y0: a.y, x1: b.x, y1: b.y, color: undefined });
      }
      start = -1;
    };
    for (const g of line.glyphs) {
      const on = g.ch[kind];
      if (on) {
        if (start < 0) start = g.pen;
        end = g.pen + g.m.advance;
      } else flush();
    }
    flush();
  }
  return out;
}
