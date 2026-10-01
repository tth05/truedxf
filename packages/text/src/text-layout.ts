/**
 * Single-line text layout: TEXT, ATTRIB, ATTDEF (research/notes/04-text-fonts.md §1).
 *
 * Measured AutoCAD 2027 rules (note 04 §1.4; VERIFIED-BY-ACAD = AutoCAD PLOT / DXFOUT of the
 * suite `text`, 2026-09-30, mostly with simplex.shx because the fixtures' Liberation Sans was
 * substituted on the reference machine):
 * - h = cap height; glyphs advance by their pen advance, no kerning;
 * - vertical anchors: Top = +h, Middle = +h/2, Bottom = −descent·h/cap (font-wide), Baseline = 0,
 *   72 = 4 "Middle" = centre of the string's ink box;
 * - horizontal box for Center/Right/Middle/Fit/Aligned: TTF = union of the advance box
 *   [0, Σadvance] and the ink box; SHX = the ink box [inkLeft, inkRight], but the advance box
 *   [0, Σadvance] when the string ends in a space (VERIFIED-BY-ACAD: hbox-*, spaces-*);
 * - 72/73 ≠ 0 → the anchor is 11 (missing 11 = the origin, VERIFIED-BY-ACAD missing11-*); an
 *   invalid 72 draws LEFT at 10, an invalid 73 counts as baseline at 11 (combo-invalid-*);
 * - height ≤ 0 (and ALIGNED with coincident points) draws with $TEXTSIZE (height0-*,
 *   aligned-coincident); a TEXT without group 71 uses the STYLE's generation flags (flags-style-*);
 * - FIT/ALIGNED: BACKWARD mirrors about the baseline (like upside-down), both flags mirror
 *   nothing (fitflags-*, ezdxf#353);
 * - SHX control characters execute the font's shape if it has one (LF = shape 10 moves the pen
 *   down without returning), otherwise "?" (caret-controls);
 * - %%u/%%o/%%k lines: SHX at −0.2 h / 1.2 h / 0.5 h spanning the advances shifted by −0.15 h
 *   (special-* with simplex.shx; the shift's origin is unknown); TTF at −descent / ascent / 0.5 h
 *   (hhea), unshifted (text-lato/text-*);
 * - $QTEXTMODE: a rectangle [box] × [−descent, h] instead of the glyphs (qtextmode-1).
 *
 * Transform order: glyph → height/width factor → oblique shear about the baseline
 * (x' = x + y·tan θ, applied *after* the width factor — UNVERIFIED, note 04 §1.5 item 2) → shift by
 * the alignment offset → backward/upside-down mirror about the anchor → rotation → anchor → OCS.
 */
import type { StyleFont } from "@truedxf/fonts";
import { Affine2, Matrix44, ocsToWcsMatrix, type Vec3 } from "@truedxf/geometry";
import { glyphCode, type TextFontSource } from "./fonts.ts";
import { decorationOffsets, InkBox, type MeasuredGlyph, measureGlyph } from "./glyphs.ts";
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
  /** Group 71; `undefined` = absent (then the STYLE's flags apply). */
  readonly generationFlags: number | undefined;
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
  /** $TEXTSIZE: the height used for height ≤ 0 (AutoCAD default 2.5). */
  defaultHeight?: number;
  /** $QTEXTMODE ≠ 0: draw boxes instead of glyphs. */
  quickText?: boolean;
  /** Decoration offsets in text heights (default {@link TEXT_DECORATION}). */
  decoration?: Partial<{ underline: number; overline: number; strike: number; shift: number }>;
}

/**
 * Decoration geometry in text heights for SHX fonts: y of underline/overline/strike-through above
 * the baseline and the x shift of the lines (VERIFIED-BY-ACAD with simplex.shx; TrueType fonts use
 * their hhea metrics and no shift, see {@link decorationOffsets}).
 */
export const TEXT_DECORATION = { underline: -0.2, overline: 1.2, strike: 0.5, shift: -0.15 } as const;

interface Placed {
  readonly m: MeasuredGlyph;
  readonly pen: number;
  readonly penY: number;
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

const QUESTION = 0x3f;

/** The glyph code of a TEXT character: control characters (and DEL) per note 04 §1.6. */
function textCode(font: StyleFont, ch: TextChar, encoding: string): number {
  if (!ch.numeric && (ch.cp < 0x20 || ch.cp === 0x7f)) {
    // SHX fonts execute their own control shapes (LF = shape 10); everything else is "?"
    if (font.primary.kind === "shx" && font.primary.hasGlyph(ch.cp)) return ch.cp;
    return QUESTION;
  }
  return glyphCode(font, ch, encoding);
}

/** Lays out the characters of one line at h = 1 without width factor (pen positions + boxes). */
export function measureLine(chars: readonly TextChar[], font: StyleFont, encoding: string): LineMetrics {
  const glyphs: Placed[] = [];
  const ink = new InkBox();
  let pen = 0;
  let penY = 0;
  for (const ch of chars) {
    const m = measureGlyph(font, textCode(font, ch, encoding));
    glyphs.push({ m, pen, penY, ch });
    if (m.ink) ink.add(m.ink, pen, penY);
    pen += m.advance;
    const r = m.resolved;
    if (r?.glyph.kind === "strokes") penY += r.glyph.advanceY * r.scale;
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
    x0 = 0;
    x1 = pen;
  } else {
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
  /** Font descent in text heights (for quick-text boxes). */
  readonly descent: number;
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
  const defaultHeight = options.defaultHeight ?? 2.5;
  let h = e.height > 0 ? e.height : defaultHeight;
  if (!(h > 0)) return undefined;
  if (style.spec?.vertical) notes.push("text-vertical-unsupported");
  const chars = decodeTextString(e.text);
  const line = measureLine(chars, font, fonts.encoding);
  let w = e.widthFactor || 1;
  const tanOb = Math.tan((e.oblique || 0) * DEG);
  let rot = (e.rotation || 0) * DEG;
  const flags = e.generationFlags ?? style.spec?.generationFlags ?? 0;
  let sx = flags & 2 ? -1 : 1;
  let sy = flags & 4 ? -1 : 1;
  const validH = e.halign >= 0 && e.halign <= 5;
  const halign = validH ? e.halign : 0;
  // 72 > 2 ignores 73 (ezdxf get_align_enum); an invalid 73 counts as baseline
  const valign = halign > 2 || e.valign < 0 || e.valign > 3 ? 0 : e.valign;
  // group 11 defaults to the origin (VERIFIED-BY-ACAD text/missing11-*)
  const p11: Vec3 = e.alignPoint ?? { x: 0, y: 0, z: e.insert.z };
  let anchor: Vec3 = e.insert;
  let ax = 0;
  let ay = 0;
  const boxW = line.x1 - line.x0;
  if (options.useStoredInsert || !validH) {
    // stored 10 is the (mirrored) left end of the baseline; invalid 72 → LEFT at 10
  } else if (halign === 3 || halign === 5) {
    const p1 = e.insert;
    const dx = p11.x - p1.x;
    const dy = p11.y - p1.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-12 && boxW > 1e-12) {
      rot = Math.atan2(dy, dx);
      if (halign === 3) h = d / (boxW * w);
      else w = d / (boxW * h);
      ax = line.x0;
      // FIT/ALIGNED: backward mirrors about the baseline, both flags mirror nothing (VERIFIED)
      if (sx < 0 && sy < 0) {
        sx = 1;
        sy = 1;
      } else if (sx < 0) {
        sx = 1;
        sy = -1;
      }
    } else if (halign === 3) {
      // ALIGNED with coincident points: AutoCAD computes h = 0 → $TEXTSIZE (VERIFIED)
      h = defaultHeight;
    }
    // FIT with coincident points: LEFT at 10 with the stored height (VERIFIED)
  } else if (halign !== 0 || e.valign !== 0) {
    anchor = p11;
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
  return {
    frame,
    line,
    height: h,
    widthFactor: w,
    rotation: rot,
    elevation: anchor.z,
    descent: font.descentRatio,
  };
}

/** Lays out a TEXT/ATTRIB/ATTDEF entity. */
export function layoutText(e: TextInput, fonts: TextFontSource, options: TextLayoutOptions = {}): TextLayout {
  const notes: string[] = [];
  const ocs = ocsToWcsMatrix(e.extrusion);
  const tf = textFrame(e, fonts, options, notes);
  if (!tf) return emptyLayout(ocs, notes);
  const { frame, line } = tf;
  const plane = tf.elevation !== 0 ? ocs.multiply(Matrix44.translation(0, 0, tf.elevation)) : ocs;
  if (options.quickText) {
    return {
      plane,
      backgrounds: [],
      glyphs: [],
      lines: quickBox(frame, line.x0, line.x1, -tf.descent, 1),
      notes,
    };
  }
  const glyphs: GlyphPlacement[] = [];
  for (const g of line.glyphs) {
    const r = g.m.resolved;
    if (!r?.glyph.bounds) continue;
    const s = r.scale;
    glyphs.push({
      glyph: r.glyph,
      font: r.font,
      matrix: frame.multiply(new Affine2(s, 0, 0, s, g.pen, g.penY)),
      color: undefined,
    });
  }
  const style = fonts.style(e.style);
  const fontDeco = style.font ? decorationOffsets(style.font) : TEXT_DECORATION;
  // SHX decoration lines start 0.15 h left of the characters, TTF ones at the pen (VERIFIED-BY-ACAD)
  const shift = style.font?.kind === "ttf" ? 0 : TEXT_DECORATION.shift;
  const lines = decorations(line, frame, { ...TEXT_DECORATION, ...fontDeco, shift, ...options.decoration });
  // extents of TrueType TEXT: the cell box [0, advance] × [−descender, ascender]
  // (VERIFIED-BY-ACAD extents/probe-text-xxx: $EXTMAX = advance end, baseline + hhea ascender)
  const p = style.font?.primary;
  let extents: number[] | undefined;
  if (p?.kind === "ttf" && line.glyphs.length > 0) {
    const a = p.ascent / p.capHeight;
    const d = -p.descent / p.capHeight;
    extents = [];
    for (const [x, y] of [
      [0, d],
      [line.advance, d],
      [line.advance, a],
      [0, a],
    ] as const) {
      const q = frame.apply({ x, y });
      extents.push(q.x, q.y);
    }
  }
  return { plane, backgrounds: [], glyphs, lines, notes, ...(extents ? { extents } : {}) };
}

/** A quick-text rectangle ($QTEXTMODE) in frame units, as four decoration lines. */
export function quickBox(frame: Affine2, x0: number, x1: number, y0: number, y1: number): DecorationLine[] {
  const q = [
    frame.apply({ x: x0, y: y0 }),
    frame.apply({ x: x1, y: y0 }),
    frame.apply({ x: x1, y: y1 }),
    frame.apply({ x: x0, y: y1 }),
  ];
  const out: DecorationLine[] = [];
  for (let k = 0; k < 4; k++) {
    const a = q[k]!;
    const b = q[(k + 1) % 4]!;
    out.push({ kind: "frame", x0: a.x, y0: a.y, x1: b.x, y1: b.y, color: undefined });
  }
  return out;
}

function decorations(
  line: LineMetrics,
  frame: Affine2,
  d: { underline: number; overline: number; strike: number; shift: number },
): DecorationLine[] {
  const out: DecorationLine[] = [];
  const kinds = [
    ["underline", d.underline],
    ["overline", d.overline],
    ["strike", d.strike],
  ] as const;
  for (const [kind, y] of kinds) {
    let start = -1;
    let end = 0;
    let yy = 0;
    const flush = () => {
      if (start >= 0 && end > start) {
        const a = frame.apply({ x: start + d.shift, y: yy + y });
        const b = frame.apply({ x: end + d.shift, y: yy + y });
        out.push({ kind, x0: a.x, y0: a.y, x1: b.x, y1: b.y, color: undefined });
      }
      start = -1;
    };
    for (const g of line.glyphs) {
      if (g.penY !== yy) flush();
      if (g.ch[kind]) {
        if (start < 0) {
          start = g.pen;
          yy = g.penY;
        }
        end = g.pen + g.m.advance;
      } else flush();
    }
    flush();
  }
  return out;
}
