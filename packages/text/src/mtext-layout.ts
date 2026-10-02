/**
 * MTEXT layout (research/notes/04-text-fonts.md §3.6, §3.7).
 *
 * Model (VERIFIED-BY-ACAD where the note says so, via AutoCAD's stored extents 42/43):
 * - baseline pitch 5/3 × h × f (f = group 44);
 * - "at least" (73 = 1): line 1's baseline is `ascent_1` below the top, where
 *   ascent = max(cap height, ink top) of the line; the next baseline is
 *   (5/3·f·H − H) + ascent below the previous one (H = largest cap height on that line;
 *   mixed heights are UNVERIFIED) — a line whose ink rises above cap height is pushed down;
 * - "exact" (73 = 2): constant pitch 5/3·h·f, box bottom = last baseline − h/3 (one sample, UNVERIFIED);
 * - extents: width = max over lines of inkRight − max(0, inkLeft) (whitespace-only lines: their
 *   pen width), height = top … last baseline + min(0, last line's ink bottom);
 * - word wrap at spaces only; a word fits when its ink (not its advance) ends within the width
 *   (note 04 §3.6.2); a word longer than the width spills; leading spaces count;
 * - default tab stops every 4 × h (VERIFIED-BY-ACAD); `\pt` stops in multiples of h;
 * - style width factor and oblique are the initial `\W`/`\Q` (ezdxf#1351, VERIFIED TrueView).
 * - columns, per-column vertical attachment, text frame and background mask: note 04 §3.7.1
 *   (VERIFIED-BY-ACAD user/columns-all, user/text-frame*, text-probes/mtx-*).
 * - stacks: SHX and TrueType geometry VERIFIED-BY-ACAD (note 04 §11, `stack()` below).
 * - flow direction 3: vertical columns with dual-orientation SHX fonts (`layoutVerticalMText`),
 *   one horizontal line with TrueType fonts (note 04 §11).
 * UNVERIFIED (to calibrate against PLOT references): decoration offsets.
 */
import { type Bounds, ShxFont, type StyleFont } from "@truedxf/fonts";
import { Affine2, Matrix44, ocsToWcsMatrix, type Vec3, wcsToOcsMatrix } from "@truedxf/geometry";
import { bigFontPairCode, glyphCode, type TextFontSource } from "./fonts.ts";
import { decorationOffsets, InkBox, type MeasuredGlyph, measureGlyph, measureResolved } from "./glyphs.ts";
import {
  defaultContext,
  type MTextChar,
  type MTextContext,
  type MTextToken,
  type ParagraphAlign,
  parseMText,
} from "./mtext-parser.ts";
import { boxGlyph, isBoxChar, missingGlyphBox, NOTDEF, quickBox } from "./text-layout.ts";
import type {
  BackgroundFill,
  ColorOverride,
  DecorationKind,
  DecorationLine,
  GlyphPlacement,
  TextLayout,
  TextRun,
} from "./types.ts";

/** Baseline pitch in cap heights (note 04 §3.6.2, VERIFIED-BY-ACAD). */
export const LINE_PITCH = 5 / 3;
/** Default tab stop distance in char heights (VERIFIED-BY-ACAD). */
export const DEFAULT_TAB = 4;
/** Gap between the paragraphs of a flow-direction-3 MTEXT drawn on one line, in char heights. */
const FLOW3_GAP = 0.55;
/** Column pitch of vertical MTEXT in char heights × 44 (see `layoutVerticalMText`). */
const VERTICAL_PITCH = 4 / 3;
/** Advance of a control character's box in char heights (VERIFIED-BY-ACAD, see `glyph()`). */
const CONTROL_ADVANCE = 0.575;

/** MTEXT column data (structurally compatible with @truedxf/model's MTextColumns). */
export interface MTextColumnsInput {
  readonly type: number;
  readonly count: number;
  readonly width: number;
  readonly gutter: number;
  readonly definedHeight: number;
  readonly heights: readonly number[];
  readonly autoHeight?: boolean;
  readonly source?: "embedded" | "xdata";
}

/** The MTEXT fields the layout needs (structurally compatible with @truedxf/model's MTextProps). */
export interface MTextInput {
  readonly text: string;
  /** WCS. */
  readonly insert: Vec3;
  readonly height: number;
  /** Reference width 41; 0 = no wrapping. */
  readonly width: number;
  readonly definedHeight: number;
  /** 1..9 */
  readonly attachment: number;
  readonly flowDirection: number;
  readonly style: string;
  readonly extrusion: Vec3;
  /** WCS x-axis direction (11), wins over rotation; a zero vector hides the text. */
  readonly direction: Vec3 | undefined;
  /** Degrees. */
  readonly rotation: number;
  readonly lineSpacingStyle: number;
  readonly lineSpacingFactor: number;
  readonly bgFlags: number;
  readonly bgColor: number;
  readonly bgTrueColor: number | undefined;
  readonly bgScale: number;
  readonly columns?: MTextColumnsInput | undefined;
}

export interface MTextLayoutOptions {
  /** Wrap width override (pre-R2018 linked columns: the master's column width, note 04 §3.7). */
  wrapWidth?: number;
  /** Dimension text: `\X` wraps at the dimension line (elsewhere it is literal). */
  dimension?: boolean;
  /** $TEXTSIZE: the char height used when 40 ≤ 0 (as for TEXT — ASSUMPTION for MTEXT). */
  defaultHeight?: number;
  /** $QTEXTMODE ≠ 0: one rectangle per line (cap top to baseline, VERIFIED-BY-ACAD text/qtextmode-1). */
  quickText?: boolean;
  /** Decoration offsets in char heights (UNKNOWN in AutoCAD, note 04 §8.6). */
  underlineOffset?: number;
  overlineOffset?: number;
  strikeOffset?: number;
}

/** MTEXT decoration offsets in char heights (VERIFIED-BY-ACAD mtext/code-underline-all; unlike TEXT, no x shift). */
export const MTEXT_DECORATION = { underline: -0.2, overline: 1.2, strike: 0.5 } as const;

// ---- items ------------------------------------------------------------------------------------

interface SubGlyph {
  readonly m: MeasuredGlyph;
  /** Placement relative to the item origin (baseline-left). */
  readonly x: number;
  readonly y: number;
  readonly h: number;
  readonly w: number;
  readonly tanOb: number;
}

interface GlyphItem {
  readonly k: "glyph";
  readonly ctx: MTextContext;
  readonly m: MeasuredGlyph;
  readonly h: number;
  readonly w: number;
  readonly adv: number;
  /** Ink relative to the pen, drawing units (unsheared). */
  readonly ink: Bounds | undefined;
  /** Code point, for CJK line breaking (wrapParagraph). */
  readonly cp?: number;
}

interface SpaceItem {
  readonly k: "space";
  readonly ctx: MTextContext;
  readonly adv: number;
  readonly nbsp: boolean;
}

interface TabItem {
  readonly k: "tab";
  readonly ctx: MTextContext;
}

interface StackItem {
  readonly k: "stack";
  readonly ctx: MTextContext;
  readonly parts: readonly SubGlyph[];
  readonly bars: readonly { x0: number; y0: number; x1: number; y1: number }[];
  readonly adv: number;
  readonly ink: Bounds | undefined;
  readonly h: number;
}

type Item = GlyphItem | SpaceItem | TabItem | StackItem;

interface PlacedItem {
  readonly item: Item;
  x: number;
  adv: number;
}

interface Line {
  readonly items: PlacedItem[];
  readonly paragraph: ParagraphState;
  readonly first: boolean;
  /** Left margin (indents) of the line, drawing units. */
  readonly margin: number;
  pen: number;
  // metrics (after finishLine)
  capMax: number;
  inkTop: number;
  inkBottom: number;
  ext0: number;
  ext1: number;
  hasInk: boolean;
  baseline: number;
  x: number;
  column: number;
}

interface ParagraphState {
  readonly align: ParagraphAlign;
  readonly left: number;
  readonly right: number;
  readonly indent: number;
  readonly tabs: readonly { pos: number; kind: string }[];
  readonly lineSpacing: { mode: "atLeast" | "exact" | "multiple"; factor: number } | undefined;
  readonly spaceBefore: number;
  readonly spaceAfter: number;
  /** Char height where the paragraph starts, outside inline scopes (line gap above). */
  readonly baseHeight: number;
  /** Char height of the paragraph's first token (empty lines). */
  readonly height: number;
  readonly columnBreakAfter: boolean;
}

const DEG = Math.PI / 180;

function emptyLayout(plane: Matrix44, notes: string[]): TextLayout {
  return { plane, backgrounds: [], glyphs: [], lines: [], notes };
}

// ---- entry ------------------------------------------------------------------------------------

/** Lays out an MTEXT entity (also the embedded MTEXT of multi-line attributes and dimension text). */
export function layoutMText(
  e: MTextInput,
  fonts: TextFontSource,
  options: MTextLayoutOptions = {},
): TextLayout {
  const notes: string[] = [];
  const style = fonts.style(e.style);
  const baseFont = style.font;
  const ocs = ocsToWcsMatrix(e.extrusion);
  if (style.suppressed || !baseFont) {
    notes.push(style.suppressed ? "mtext-suppressed-missing-bigfont" : "mtext-no-font");
    return emptyLayout(ocs, notes);
  }
  // direction vector (0,0,0) → invisible in AutoCAD (note 04 §3.6.3)
  const toOcs = wcsToOcsMatrix(e.extrusion);
  let rot = (e.rotation || 0) * DEG;
  if (e.direction) {
    const d = toOcs.transformDirection(e.direction);
    if (Math.hypot(d.x, d.y) < 1e-12) {
      notes.push("mtext-zero-direction");
      return emptyLayout(ocs, notes);
    }
    rot = Math.atan2(d.y, d.x);
  }
  const h0 = e.height > 0 ? e.height : (options.defaultHeight ?? 2.5);
  if (!(h0 > 0)) return emptyLayout(ocs, notes);
  const spec = style.spec;
  const ctx0 = defaultContext(h0, spec?.widthFactor || 1, spec?.oblique ?? 0);
  const tokens = parseMText(e.text, ctx0, options.dimension);
  // flow direction 3 (top to bottom): vertical columns with a dual-orientation SHX font, one
  // horizontal line otherwise (note 04 §11)
  const flow3 = e.flowDirection === 3;
  if (flow3 && baseFont.primary instanceof ShxFont && baseFont.primary.modes === 2)
    return layoutVerticalMText(e, fonts, baseFont, h0, rot, tokens, notes);
  const cols = e.columns && e.columns.type > 0 ? e.columns : undefined;
  let wrap = options.wrapWidth ?? (cols && cols.width > 0 ? cols.width : e.width);
  if (!(wrap > 0) || flow3) wrap = 0;
  const f0 = spacingFactor(e.lineSpacingFactor);
  const exact0 = e.lineSpacingStyle === 2;
  const col = ((e.attachment - 1) % 3) + 1;
  const row = Math.floor((e.attachment - 1) / 3);
  const defaultAlign: ParagraphAlign = col === 2 ? "center" : col === 3 ? "right" : "left";
  const engine = new Engine(fonts, baseFont, h0, options, notes);

  // ---- paragraphs → lines
  const lines: Line[] = [];
  const paragraphs = splitParagraphs(tokens, h0);
  if (flow3) {
    // TrueType: the paragraphs on one line, 0.55·h apart (VERIFIED-BY-ACAD mtext/flow-direction-3,
    // Liberation "ABC\PDEF": D's pen 5.497 after C's advance end at h = 10; one sample)
    const items: Item[] = [];
    paragraphs.forEach((para, k) => {
      const ctx = para.tokens[0]?.ctx ?? ctx0;
      if (k > 0) items.push({ k: "space", ctx, adv: FLOW3_GAP * ctx.height, nbsp: true });
      items.push(...engine.items(para.tokens));
    });
    if (paragraphs[0]) engine.wrapParagraph(items, paragraphs[0].state, 0, lines);
  } else {
    for (const para of paragraphs) {
      const items = engine.items(para.tokens);
      engine.wrapParagraph(items, para.state, wrap, lines);
    }
  }
  if (lines.length === 0) return emptyLayout(ocs, notes);

  // ---- vertical placement, column breaking (note 04 §3.7.1)
  const colSpec = columnSpec(cols, e.definedHeight);
  let column = 0;
  let prev: Line | undefined;
  // Paragraph line spacing (VERIFIED-BY-ACAD mtext/para-spacing-*): \pse<v> = exact spacing as
  // for char height v (pitch 5/3·v, first baseline v below the top), \psa<v> = at least 5/3·v,
  // \psm<f> = f × the single (44 = 1) gap; \pb/\pa = space before/after the paragraph in
  // drawing units. A paragraph's spacing sets the gaps *below* its lines, so the gap above the
  // first line of a paragraph is the previous paragraph's (mtext/para-spacing-reset: `\pxsm2;A\P
  // \ps*;B\PC` puts B two pitches below A and C one pitch below B).
  let pending = 0;
  const lineBottom = (ln: Line, exact: boolean, cap: number) =>
    exact ? ln.baseline - cap / 3 : ln.baseline + Math.min(0, ln.inkBottom);
  /** Extents bottom per line: only the column's last line's descenders count (note 04 §3.6.1). */
  const bottoms: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    const ls = ln.paragraph.lineSpacing;
    const exact = ls ? ls.mode === "exact" : exact0;
    const cap = ls?.mode === "exact" ? ls.factor : h0;
    const ascent = Math.max(ln.capMax, ln.inkTop);
    if (ln.first) pending += ln.paragraph.spaceBefore;
    if (!prev) ln.baseline = exact ? -cap : -ascent;
    else {
      // the gap below `prev` follows prev's paragraph spacing
      const ps = prev.paragraph.lineSpacing;
      if (ps ? ps.mode === "exact" : exact0)
        ln.baseline = prev.baseline - LINE_PITCH * (ps ? ps.factor : h0 * f0);
      else {
        // at least: the gap is (5/3·f − 1)·(previous line's largest height + this paragraph's
        // base height)/2 + cap height + the ink above the cap height, scaled by f when f < 1
        // (VERIFIED-BY-ACAD mtext/spacing-big-line-1, height-style-0; f < 1:
        // spacing-defaults-factor-0 at f = 0.25; f > 1 unscaled: mtext/random-0002, -0003 at 1.25)
        const H2 = (prev.capMax + ln.paragraph.baseHeight) / 2;
        if (ps) {
          // \psa / \psm: single gap 26/15·h (one text each, mtext/para-spacing-sa2 and -xsm2:
          // 13.867 at h = 8 where the entity spacing gives 13.767 — UNVERIFIED in general)
          const single = Math.max((LINE_PITCH - 1) * H2 + ascent, (26 / 15) * H2);
          const scale = ps.mode === "multiple" && ps.factor > 0 ? ps.factor : 1;
          const minPitch = ps.mode === "atLeast" ? LINE_PITCH * ps.factor : 0;
          ln.baseline = prev.baseline - Math.max(minPitch, single * scale);
        } else {
          const cap = Math.min(ascent, ln.capMax);
          ln.baseline = prev.baseline - ((LINE_PITCH * f0 - 1) * H2 + cap + Math.min(1, f0) * (ascent - cap));
        }
      }
    }
    ln.baseline -= pending;
    pending = 0;
    const next = lines[i + 1];
    if (!next || next.first) pending += ln.paragraph.spaceAfter;
    if (colSpec && prev) {
      // a line moves to the next column when its extents bottom (baseline + descenders) passes
      // the column height (VERIFIED-BY-ACAD text-probes/mtx-break-*); a static column count is
      // fixed: overflow and extra \N stay in the last column (user/columns-all,
      // text-probes/mtx-static-extra-breaks)
      const limit = colSpec.limit(column);
      const forced = prev.paragraph.columnBreakAfter && isParagraphStart(lines, ln);
      const over = limit > 0 && -lineBottom(ln, exact, cap) > limit + 1e-9;
      if ((over || forced) && column + 1 < colSpec.maxColumns) {
        column++;
        ln.baseline = exact ? -cap : -ascent;
      }
    }
    // flow direction 3: the baseline at the insertion point (mtext/flow-direction-3, attachment 1)
    if (flow3) ln.baseline = 0;
    ln.column = column;
    bottoms.push(lineBottom(ln, exact, cap));
    prev = ln;
  }
  const last = lines[lines.length - 1]!;
  const nCols = colSpec ? Math.max(colSpec.minColumns, last.column + 1) : 1;
  // content height per column: top = first line's ascent (0), bottom = its last line's extents
  const colContent: number[] = new Array(nCols).fill(0);
  for (let i = 0; i < lines.length; i++) colContent[lines[i]!.column] = -bottoms[i]!;

  // ---- horizontal placement
  let contentWidth = 0;
  for (const ln of lines) {
    const w = ln.hasInk || ln.items.length > 0 ? ln.margin + (ln.ext1 - ln.ext0) : 0;
    contentWidth = Math.max(contentWidth, w + ln.paragraph.right);
  }
  const frameW = wrap > 0 ? wrap : contentWidth;
  for (const ln of lines) {
    let align = ln.paragraph.align === "default" ? defaultAlign : ln.paragraph.align;
    if (align === "justified" || align === "distributed") {
      engine.justify(ln, frameW, lines);
      align = "left";
    }
    const availL = ln.margin;
    const availR = frameW - ln.paragraph.right;
    // left: the line ink (not the pen origin) starts at the margin (VERIFIED-BY-ACAD text-lato/mtext-attach-1)
    if (align === "left") ln.x = availL - ln.ext0;
    else if (align === "right") ln.x = availR - ln.ext1;
    else ln.x = (availL + availR) / 2 - (ln.ext0 + ln.ext1) / 2;
  }

  // ---- attachment
  // Horizontal: the attachment column refers to all columns (n·width + (n−1)·gutter) or the
  // reference width. Vertical: every column is aligned on its own content height (top / middle /
  // bottom of its extents box at the insertion point); stored column heights and 46 never move
  // the text (VERIFIED-BY-ACAD user/columns-all, text-probes/mtx-cols-*, mtext/defined-height-*).
  const colW = cols && cols.width > 0 ? cols.width : frameW;
  const colStep = cols ? colW + cols.gutter : 0;
  const totalW = cols ? nCols * colW + (nCols - 1) * cols.gutter : frameW;
  const xAtt = col === 1 ? 0 : col === 2 ? totalW / 2 : totalW;
  const rowShift = (hc: number) => (row === 0 ? 0 : row === 1 ? hc / 2 : hc);

  const ins = toOcs.transformPoint(e.insert);
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const place = new Affine2(cr, sr, -sr, cr, ins.x, ins.y).multiply(Affine2.translation(-xAtt, 0));

  const glyphs: GlyphPlacement[] = [];
  const decor: DecorationLine[] = [];
  const extents: number[] = [];
  const runs: TextRun[] = [];
  for (const ln of lines) {
    const dy = rowShift(colContent[ln.column]!);
    const base = place.multiply(Affine2.translation(ln.x + ln.column * colStep, ln.baseline + dy));
    // TrueType cell boxes count for the drawing extents (VERIFIED-BY-ACAD user/text-frame2:
    // $EXTMIN/$EXTMAX = pen start … advance end × baseline − descender … baseline + ascender)
    const cell = engine.cellBox(ln);
    if (cell) {
      for (const [x, y] of [
        [cell[0], cell[2]],
        [cell[1], cell[2]],
        [cell[1], cell[3]],
        [cell[0], cell[3]],
      ] as const) {
        const q = base.apply({ x, y });
        extents.push(q.x, q.y);
      }
    }
    if (options.quickText) {
      if (ln.hasInk) decor.push(...quickBox(base, ln.ext0, ln.ext1, 0, ln.capMax));
    } else engine.emitLine(ln, base, glyphs, decor, runs);
  }

  // ---- background mask and text frame (note 04 §3.1, §3.7.1; VERIFIED-BY-ACAD
  // text-probes/mtx-*, user/text-frame*, user/columns-all): one box per column, x = the column
  // [0, width] (single column: the reference width, or the content width when 41 = 0) widened
  // to the ink of its lines, height = max(stored column height, content height) placed like the
  // text; all grown by (45 − 1)·h — for the frame-only flag 16 too (45 defaults to 1.5). The
  // frame is the outline of the union of the column boxes.
  const backgrounds: BackgroundFill[] = [];
  const bg = e.bgFlags;
  if (bg & 3 || bg & 16) {
    const off = Math.max(0, (e.bgScale > 0 ? e.bgScale : 1.5) - 1) * h0;
    const boxes: Box[] = [];
    for (let c = 0; c < nCols; c++) {
      let x0 = c * colStep;
      let x1 = x0 + colW;
      for (const ln of lines) {
        if (ln.column !== c || !ln.hasInk) continue;
        x0 = Math.min(x0, c * colStep + ln.x + ln.ext0);
        x1 = Math.max(x1, c * colStep + ln.x + ln.ext1);
      }
      const hc = Math.max(
        colSpec ? colSpec.height(c) : e.definedHeight > 0 ? e.definedHeight : 0,
        colContent[c]!,
      );
      const y1 = rowShift(hc);
      boxes.push({ x0: x0 - off, x1: x1 + off, y0: y1 - hc - off, y1: y1 + off });
    }
    if (bg & 3) {
      const color: BackgroundFill["color"] =
        bg & 2
          ? { kind: "canvas" }
          : e.bgTrueColor !== undefined
            ? { kind: "rgb", rgb: e.bgTrueColor & 0xffffff }
            : { kind: "aci", aci: e.bgColor };
      for (const b of boxes) {
        const q = [
          place.apply({ x: b.x0, y: b.y0 }),
          place.apply({ x: b.x1, y: b.y0 }),
          place.apply({ x: b.x1, y: b.y1 }),
          place.apply({ x: b.x0, y: b.y1 }),
        ];
        backgrounds.push({
          corners: [q[0]!.x, q[0]!.y, q[1]!.x, q[1]!.y, q[2]!.x, q[2]!.y, q[3]!.x, q[3]!.y],
          color,
        });
      }
    }
    if (bg & 16) {
      for (const ring of unionOutlines(boxes)) {
        for (let k = 0; k < ring.length; k++) {
          const a = place.apply(ring[k]!);
          const b = place.apply(ring[(k + 1) % ring.length]!);
          decor.push({ kind: "frame", x0: a.x, y0: a.y, x1: b.x, y1: b.y, color: undefined });
        }
      }
    }
  }
  const plane = ins.z !== 0 ? ocs.multiply(Matrix44.translation(0, 0, ins.z)) : ocs;
  return {
    plane,
    backgrounds,
    glyphs,
    lines: decor,
    notes,
    ...(extents.length ? { extents } : {}),
    ...(runs.length ? { runs } : {}),
  };
}

/** Measured MTEXT extents (42/43 model of note 04 §3.6.1), for tests and oracles. */
export interface MTextExtents {
  readonly width: number;
  readonly height: number;
  readonly lines: number;
}

/** Computes AutoCAD's stored extents 42/43 for an MTEXT (the verified extents model). */
export function mtextExtents(
  e: MTextInput,
  fonts: TextFontSource,
  options: MTextLayoutOptions = {},
): MTextExtents {
  const style = fonts.style(e.style);
  const baseFont = style.font;
  const h0 = e.height > 0 ? e.height : (options.defaultHeight ?? 2.5);
  if (!baseFont || !(h0 > 0)) return { width: 0, height: 0, lines: 0 };
  const spec = style.spec;
  const tokens = parseMText(e.text, defaultContext(h0, spec?.widthFactor || 1, spec?.oblique ?? 0));
  const cols = e.columns && e.columns.type > 0 ? e.columns : undefined;
  let wrap = options.wrapWidth ?? (cols && cols.width > 0 ? cols.width : e.width);
  if (!(wrap > 0)) wrap = 0;
  const engine = new Engine(fonts, baseFont, h0, options, []);
  const lines: Line[] = [];
  for (const para of splitParagraphs(tokens, h0))
    engine.wrapParagraph(engine.items(para.tokens), para.state, wrap, lines);
  if (lines.length === 0) return { width: 0, height: 0, lines: 0 };
  const f = spacingFactor(e.lineSpacingFactor);
  const exact = e.lineSpacingStyle === 2;
  let prev: Line | undefined;
  let top = 0;
  let width = 0;
  for (const ln of lines) {
    const ascent = Math.max(ln.capMax, ln.inkTop);
    if (!prev) {
      ln.baseline = 0;
      top = exact ? h0 : ascent;
    } else if (exact) ln.baseline = prev.baseline - LINE_PITCH * h0 * f;
    else {
      const cap = Math.min(ascent, ln.capMax);
      ln.baseline =
        prev.baseline -
        ((LINE_PITCH * f - 1) * (prev.capMax + ln.paragraph.baseHeight)) / 2 -
        cap -
        Math.min(1, f) * (ascent - cap);
    }
    width = Math.max(width, ln.margin + ln.ext1 - ln.ext0);
    prev = ln;
  }
  const last = lines[lines.length - 1]!;
  const bottom = exact ? last.baseline - h0 / 3 : last.baseline + Math.min(0, last.inkBottom);
  return { width, height: top - bottom, lines: lines.length };
}

/**
 * Vertical MTEXT (flow direction 3) with a dual-orientation SHX font: every paragraph is a column
 * of characters stacked by the font's vertical pen moves (code 0x0E), the first glyph's top at
 * the insertion point; columns run left to right, the first one's ink starting at the
 * insertion point, then 4/3·h·f apart. Measured on fileformat/corpus-ezdxf-text (simplex,
 * h = 100, attachment 1, f = 1 and 2: column pens 133 and ≈ 262 apart, first pen 28 units right
 * of the insertion point) — ASSUMPTION for other attachments; stacks, tabs, decorations and
 * inline fonts are not laid out vertically.
 */
function layoutVerticalMText(
  e: MTextInput,
  fonts: TextFontSource,
  font: StyleFont,
  h0: number,
  rot: number,
  tokens: readonly MTextToken[],
  notes: string[],
): TextLayout {
  const ocs = ocsToWcsMatrix(e.extrusion);
  const toOcs = wcsToOcsMatrix(e.extrusion);
  const ins = toOcs.transformPoint(e.insert);
  const plane = ins.z !== 0 ? ocs.multiply(Matrix44.translation(0, 0, ins.z)) : ocs;
  const place = new Affine2(Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), ins.x, ins.y);
  const pitch = VERTICAL_PITCH * h0 * spacingFactor(e.lineSpacingFactor);
  const glyphs: GlyphPlacement[] = [];
  let x0: number | undefined;
  splitParagraphs(tokens, h0).forEach((para, col) => {
    const placed: { m: MeasuredGlyph; y: number; ctx: MTextContext }[] = [];
    let y = 0;
    let inkLeft = 0;
    for (const t of para.tokens) {
      if (t.t !== "char" && t.t !== "space" && t.t !== "nbsp") continue;
      const code = t.t === "char" ? glyphCode(font, t.ch, fonts.encoding) : 0x20;
      const m = measureGlyph(font, code, true);
      const h = t.ctx.height;
      placed.push({ m, y, ctx: t.ctx });
      if (m.ink) inkLeft = Math.min(inkLeft, m.ink.xMin * h * (t.ctx.widthFactor || 1));
      const r = m.resolved;
      if (r?.glyph.kind === "strokes") y += r.glyph.advanceY * r.scale * h;
    }
    x0 ??= -inkLeft;
    const x = x0 + col * pitch;
    for (const g of placed) {
      const r = g.m.resolved;
      if (!r?.glyph.bounds) continue;
      const s = r.scale * g.ctx.height;
      const tan = Math.tan(g.ctx.oblique * DEG);
      glyphs.push({
        glyph: r.glyph,
        font: r.font,
        matrix: place.multiply(new Affine2(s * (g.ctx.widthFactor || 1), 0, s * tan, s, x, g.y)),
        color: g.ctx.color,
      });
    }
  });
  if (e.attachment !== 1) notes.push("mtext-vertical-attachment-assumed");
  return { plane, backgrounds: [], glyphs, lines: [], notes };
}

// ---- helpers ----------------------------------------------------------------------------------

/**
 * Group 44, clamped to AutoCAD's range 0.25…4 at the low end: a stored 0 draws like 0.25
 * (VERIFIED-BY-ACAD mtext/spacing-defaults-factor-0); an absent 44 is 1 (the model's default).
 */
function spacingFactor(f: number): number {
  return Number.isFinite(f) ? Math.max(0.25, f) : 1;
}

function isParagraphStart(lines: readonly Line[], ln: Line): boolean {
  return ln.first && lines.indexOf(ln) > 0;
}

/** Column breaking and frame heights of an MTEXT with column data (note 04 §3.7.1). */
interface ColumnSpec {
  /** Height limit of column c for line breaking; 0 = unlimited. */
  limit(c: number): number;
  /** Stored height of column c (frame / mask box); 0 = the content height. */
  height(c: number): number;
  /** Columns that exist (and get a frame box) even when empty. */
  readonly minColumns: number;
  readonly maxColumns: number;
}

function columnSpec(cols: MTextColumnsInput | undefined, definedHeight: number): ColumnSpec | undefined {
  if (!cols) return undefined;
  const defH = cols.definedHeight > 0 ? cols.definedHeight : definedHeight > 0 ? definedHeight : 0;
  if (cols.type === 1) {
    // static: a fixed number of columns, all drawn (empty ones too); the last one takes the
    // overflow (VERIFIED-BY-ACAD user/columns-all, text-probes/mtx-cols-static-*)
    const n = Math.max(1, cols.count);
    return { limit: (c) => (c < n - 1 ? defH : 0), height: () => defH, minColumns: n, maxColumns: n };
  }
  const hs = cols.heights;
  if (cols.autoHeight || hs.length === 0) {
    // dynamic, auto height: as many columns of the defined height as the text needs (AutoCAD
    // rewrites the stored count, text-probes/mtx-cols-dynauto-*)
    return { limit: () => defH, height: () => defH, minColumns: 1, maxColumns: Number.POSITIVE_INFINITY };
  }
  // dynamic, manual heights: one column per stored height (0 = unlimited); text that overflows
  // them goes to one extra column of unlimited height (text-probes/mtx-cols-dynman-overflow)
  return {
    limit: (c) => hs[c] ?? 0,
    height: (c) => hs[c] ?? 0,
    minColumns: hs.length,
    maxColumns: hs.length + 1,
  };
}

interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/**
 * Outlines of the union of column boxes ordered left to right. Boxes of one group overlap in x
 * and all contain the attachment line, so each group's union is one stepped polygon
 * (user/columns-all: two touching columns of different heights give one 8-segment frame).
 */
export function unionOutlines(boxes: readonly Box[]): { x: number; y: number }[][] {
  const sorted = [...boxes].sort((a, b) => a.x0 - b.x0);
  const out: { x: number; y: number }[][] = [];
  let i = 0;
  while (i < sorted.length) {
    const group = [sorted[i]!];
    let right = sorted[i]!.x1;
    i++;
    while (i < sorted.length && sorted[i]!.x0 <= right + 1e-9) {
      right = Math.max(right, sorted[i]!.x1);
      group.push(sorted[i]!);
      i++;
    }
    const xs = [...new Set(group.flatMap((b) => [b.x0, b.x1]))].sort((a, b) => a - b);
    const top: { x: number; y: number }[] = [];
    const bottom: { x: number; y: number }[] = [];
    for (let k = 0; k + 1 < xs.length; k++) {
      const xa = xs[k]!;
      const xb = xs[k + 1]!;
      let t = Number.NEGATIVE_INFINITY;
      let u = Number.POSITIVE_INFINITY;
      for (const b of group) {
        if (b.x0 <= xa && b.x1 >= xb) {
          t = Math.max(t, b.y1);
          u = Math.min(u, b.y0);
        }
      }
      top.push({ x: xa, y: t }, { x: xb, y: t });
      bottom.push({ x: xa, y: u }, { x: xb, y: u });
    }
    const ring = [...top, ...bottom.reverse()];
    // drop repeated and collinear vertices
    const clean: { x: number; y: number }[] = [];
    for (const p of ring) {
      const q = clean[clean.length - 1];
      if (q && Math.abs(q.x - p.x) < 1e-12 && Math.abs(q.y - p.y) < 1e-12) continue;
      clean.push(p);
    }
    for (let k = 0; k < clean.length && clean.length > 4; ) {
      const a = clean[(k + clean.length - 1) % clean.length]!;
      const b = clean[k]!;
      const c = clean[(k + 1) % clean.length]!;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1e-12) clean.splice(k, 1);
      else k++;
    }
    out.push(clean);
  }
  return out;
}

interface Paragraph {
  readonly tokens: MTextToken[];
  readonly state: ParagraphState;
}

function paragraphState(
  tokens: readonly MTextToken[],
  endCtx: MTextContext,
  columnBreak: boolean,
  baseHeight: number,
): ParagraphState {
  // The paragraph properties in effect at the paragraph's end apply to the whole paragraph
  // (a `\p…;` anywhere in the paragraph formats it — ASSUMPTION, suite mtext/para-scope-mid).
  const p = (tokens.length ? tokens[tokens.length - 1]!.ctx : endCtx).paragraph;
  const h = (tokens[0]?.ctx ?? endCtx).height;
  return {
    align: p.align,
    left: p.left,
    right: p.right,
    indent: p.indent,
    tabs: p.tabs,
    lineSpacing: p.lineSpacing,
    spaceBefore: p.spaceBefore,
    spaceAfter: p.spaceAfter,
    height: h,
    baseHeight,
    columnBreakAfter: columnBreak,
  };
}

function splitParagraphs(tokens: readonly MTextToken[], h0: number): Paragraph[] {
  const out: Paragraph[] = [];
  let cur: MTextToken[] = [];
  let lastCtx: MTextContext | undefined;
  // the char height in effect where a paragraph starts (outside braces opened in it)
  let base = h0;
  for (const t of tokens) {
    lastCtx = t.ctx;
    if (t.t === "paragraph" || t.t === "column" || t.t === "dimwrap") {
      out.push({ tokens: cur, state: paragraphState(cur, t.ctx, t.t === "column", base) });
      base = t.ctx.height;
      cur = [];
      continue;
    }
    cur.push(t);
  }
  // a trailing \P does not add an empty last line (UNVERIFIED; suite mtext/wrap-trailing-p)
  if (cur.length > 0 || out.length === 0)
    out.push({ tokens: cur, state: paragraphState(cur, lastCtx ?? defaultContext(h0), false, base) });
  return out;
}

class Engine {
  private readonly fonts: TextFontSource;
  private readonly baseFont: StyleFont;
  private readonly h0: number;
  private readonly o: MTextLayoutOptions;
  private readonly notes: string[];

  constructor(
    fonts: TextFontSource,
    baseFont: StyleFont,
    h0: number,
    o: MTextLayoutOptions,
    notes: string[],
  ) {
    this.fonts = fonts;
    this.baseFont = baseFont;
    this.h0 = h0;
    this.o = o;
    this.notes = notes;
  }

  private fontOf(ctx: MTextContext): StyleFont {
    if (!ctx.font) return this.baseFont;
    const f = this.fonts.inlineFont(ctx.font);
    if (!f) {
      if (!this.notes.includes("mtext-inline-font-unresolved"))
        this.notes.push("mtext-inline-font-unresolved");
      return this.baseFont;
    }
    return f;
  }

  /**
   * A character, measured. Missing glyphs (VERIFIED-BY-ACAD 2026-10-01, note 04 §11):
   * - control characters draw Arial's .notdef at Arial's cap scale whatever the font, advancing
   *   by 0.575·h (Liberation Sans and Lato alike; text/caret-codes-mtext, text-lato/mtext-control),
   *   FS/GS/RS/US (^\ ^] ^^ ^_) by nothing — the next character overlaps the box;
   * - characters missing from an SHX font come from a TrueType fallback at that font's own
   *   cap-height scale — unlike TEXT, which draws "?" (text/escape-spellings); when no fallback
   *   has them they draw nothing (font-probes/bigcp-mtext: 한 with txt + gbcbig);
   * - {@link isBoxChar} characters no font has: Arial's .notdef with its advance
   *   (text/caret-lowercase-mtext `^?`), inside a stack the primary font's .notdef
   *   (mtext/stack-caret-*: `^6` = U+FFF6); SHX fonts draw "?" for them (mtext/stack-caret-nospace
   *   with simplex, 2026-09-30); other missing characters draw nothing (text/fallback-thai-mtext).
   */
  private glyph(ctx: MTextContext, ch: MTextChar, inStack = false): GlyphItem {
    const font = this.fontOf(ctx);
    const ttf = font.primary.kind === "ttf";
    let m: MeasuredGlyph;
    if (ch.control && !inStack) {
      const nd = missingGlyphBox(this.fonts) ?? this.fonts.notdefGlyph?.(font);
      if (nd) {
        const advance = ch.cp >= 0x1c && ch.cp <= 0x1f ? 0 : CONTROL_ADVANCE;
        m = { ...measureResolved(NOTDEF, nd), advance };
      } else m = measureGlyph(font, 0x3f);
    } else {
      const box = ch.control || isBoxChar(ch.cp);
      const code = ch.control ? (ttf ? undefined : 0x3f) : glyphCode(font, ch, this.fonts.encoding);
      m = code === undefined ? measureResolved(0, undefined) : measureGlyph(font, code);
      // characters missing from an SHX font come from a TrueType fallback at that font's own
      // cap-height scale — unlike TEXT, which draws "?" (VERIFIED-BY-ACAD text/escape-spellings)
      if (!ttf && !box && (!m.resolved || m.resolved.fallback) && ch.cp !== 0x3f) {
        const fb = this.fonts.fallbackGlyph?.(ch.cp);
        m = fb ? measureResolved(ch.cp, fb) : measureResolved(ch.cp, undefined);
      }
      if (ttf && !m.resolved && box) {
        const nd = inStack ? this.fonts.notdefGlyph?.(font) : missingGlyphBox(this.fonts);
        if (nd) m = boxGlyph(ch.cp, nd);
        // a stack measures the box up to its advance, not its ink (stack-caret-side-by-side:
        // the next pen is box pen + advance + the "0" side bearing)
        if (inStack && m.ink) m = { ...m, ink: { ...m.ink, xMax: Math.max(m.ink.xMax, m.advance) } };
      }
    }
    return { ...this.glyphItem(ctx, m), cp: ch.cp };
  }

  private glyphItem(ctx: MTextContext, m: MeasuredGlyph): GlyphItem {
    const h = ctx.height;
    const w = ctx.widthFactor || 1;
    const ink = m.ink
      ? { xMin: m.ink.xMin * h * w, xMax: m.ink.xMax * h * w, yMin: m.ink.yMin * h, yMax: m.ink.yMax * h }
      : undefined;
    return { k: "glyph", ctx, m, h, w, adv: m.advance * h * w * trackingFactor(ctx.tracking), ink };
  }

  private spaceAdvance(ctx: MTextContext): number {
    const font = this.fontOf(ctx);
    const m = measureGlyph(font, 0x20);
    return m.advance * ctx.height * (ctx.widthFactor || 1) * trackingFactor(ctx.tracking);
  }

  items(tokens: readonly MTextToken[]): Item[] {
    const out: Item[] = [];
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k]!;
      switch (t.t) {
        case "char": {
          // "~1" with special.shx-style bigfonts is one bigfont glyph (fonts.ts bigFontPairCode)
          const n = tokens[k + 1];
          const pair =
            n?.t === "char" && !t.ch.control && !n.ch.control && n.ctx === t.ctx
              ? bigFontPairCode(this.fontOf(t.ctx), t.ch.cp, n.ch.cp)
              : undefined;
          if (pair !== undefined) {
            k++;
            out.push(this.glyphItem(t.ctx, measureGlyph(this.fontOf(t.ctx), pair)));
          } else out.push(this.glyph(t.ctx, t.ch));
          break;
        }
        case "space":
        case "nbsp":
          out.push({ k: "space", ctx: t.ctx, adv: this.spaceAdvance(t.ctx), nbsp: t.t === "nbsp" });
          break;
        case "tab":
          out.push({ k: "tab", ctx: t.ctx });
          break;
        case "stack":
          out.push(this.stack(t.ctx, t.upper, t.lower, t.kind));
          break;
        default:
          break;
      }
    }
    return out;
  }

  /**
   * Stack geometry (hs = the current char height; parts are drawn at hs — the usual 70 % comes
   * from an explicit \H0.7x;). VERIFIED-BY-ACAD 2026-09-30 with simplex.shx (mtext/stack-*) and
   * 2026-10-01 with TrueType fonts (Liberation Sans: mtext/stack-*, Lato: text-lato/mtext-stacks;
   * note 04 §11):
   *
   * TrueType — every part is placed by its ink box (side bearings removed):
   * - "/" and "^": lower part on the baseline; upper part's baseline at the lower part's ink
   *   height (top − bottom) + hs/3; "/" draws a bar at the lower ink height + hs/6 from the
   *   stack start over the larger ink width and centres both parts on it by ink width, "^"
   *   puts both inks at the stack start;
   * - "#": upper ink at the stack start on a baseline at the lower part's ink height, lower ink
   *   hs/3 after the upper ink's right edge, a 2·hs long slash at 55° centred at (upper ink
   *   right + hs/6, upper baseline);
   * - no divider: the ink at the stack start, raised by hs/3;
   * - advance = the stack's ink width + the side bearing of the font's "0" (Liberation Sans 80,
   *   Lato 60 font units — the PDF pen positions match to < 1 unit);
   * - a part that starts with a space keeps it: its box starts at the pen (mtext/stack-space-after-slash,
   *   still ~19 font units narrower than AutoCAD's bar there);
   * - the stack's height for the line (ascent push, \A) = upper baseline + the upper part's ink
   *   height (top − bottom): a descender in the upper part raises it (mtext/stack-escaped-semicolon).
   *
   * SHX (simplex.shx) — the same rules with pen boxes, which is what they reduce to for simplex
   * digits (ink height = hs, small side bearings): upper baseline 4/3·hs, bar 7/6·hs ending at
   * the widest part's ink right edge, "/" centring by ink right edge, "#" upper baseline hs;
   * advance = the larger part advance ("#": lower start + lower advance); no divider: raised hs/3.
   */
  private stack(
    ctx: MTextContext,
    upper: readonly MTextChar[],
    lower: readonly MTextChar[],
    kind: "^" | "/" | "#" | "",
  ): StackItem {
    const h = ctx.height;
    const run = (chars: readonly MTextChar[]) => {
      const gs: GlyphItem[] = chars.map((c) => this.glyph(ctx, c, true));
      let pen = 0;
      const ink = new InkBox();
      const xs: number[] = [];
      for (const g of gs) {
        xs.push(pen);
        if (g.ink) ink.add(g.ink, pen, 0);
        pen += g.adv;
      }
      return { gs, xs, adv: pen, ink, inkRight: ink.empty ? pen : ink.xMax };
    };
    const up = run(upper);
    const lo = run(lower);
    const parts: SubGlyph[] = [];
    const bars: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const tan = Math.tan(ctx.oblique * DEG);
    const add = (r: ReturnType<typeof run>, dx: number, y: number) => {
      r.gs.forEach((g, k) => {
        parts.push({ m: g.m, x: dx + r.xs[k]!, y, h: g.h, w: g.w, tanOb: tan });
      });
    };
    const slash = (cx: number, cy: number) => {
      const dx = Math.cos(55 * DEG) * h;
      const dy = Math.sin(55 * DEG) * h;
      bars.push({ x0: cx - dx, y0: cy - dy, x1: cx + dx, y1: cy + dy });
    };
    let adv: number;
    let top: number | undefined;
    if (this.fontOf(ctx).primary.kind === "ttf") {
      // ink boxes; a part without ink keeps its pen box
      const box = (r: ReturnType<typeof run>) =>
        r.ink.empty
          ? { x0: 0, x1: r.adv, y0: 0, y1: 0 }
          : { x0: r.gs[0]?.ink ? r.ink.xMin : 0, x1: r.ink.xMax, y0: r.ink.yMin, y1: r.ink.yMax };
      const ub = box(up);
      const lb = box(lo);
      const uw = ub.x1 - ub.x0;
      const lw = lb.x1 - lb.x0;
      const lowerH = lo.ink.empty ? h : lb.y1 - lb.y0;
      const zero = measureGlyph(this.fontOf(ctx), 0x30);
      const gap = zero.ink ? (zero.advance - zero.ink.xMax) * h * (ctx.widthFactor || 1) : 0;
      let yU: number;
      if (kind === "") {
        yU = h / 3;
        add(up, -ub.x0, yU);
        adv = uw + gap;
      } else if (kind === "#") {
        yU = lowerH;
        const lx = uw + h / 3;
        add(up, -ub.x0, yU);
        add(lo, lx - lb.x0, 0);
        slash(uw + h / 6, yU);
        adv = lx + lw + gap;
      } else {
        yU = lowerH + h / 3;
        const width = Math.max(uw, lw);
        const center = kind === "/";
        add(up, (center ? (width - uw) / 2 : 0) - ub.x0, yU);
        add(lo, (center ? (width - lw) / 2 : 0) - lb.x0, 0);
        if (center) bars.push({ x0: 0, y0: lowerH + h / 6, x1: width, y1: lowerH + h / 6 });
        adv = width + gap;
      }
      if (!up.ink.empty) top = yU + (ub.y1 - ub.y0);
    } else if (kind === "") {
      // no divider: the text raised by hs/3 (VERIFIED-BY-ACAD mtext/stack-no-divider)
      add(up, 0, h / 3);
      adv = up.adv;
    } else if (kind === "#") {
      const lx = up.inkRight + h / 3;
      add(up, 0, h);
      add(lo, lx, 0);
      slash(up.inkRight + h / 6, h);
      adv = lx + lo.adv;
    } else {
      const width = Math.max(up.inkRight, lo.inkRight);
      const center = kind === "/";
      add(up, center ? (width - up.inkRight) / 2 : 0, (4 / 3) * h);
      add(lo, center ? (width - lo.inkRight) / 2 : 0, 0);
      if (kind === "/") bars.push({ x0: 0, y0: (7 / 6) * h, x1: width, y1: (7 / 6) * h });
      adv = Math.max(up.adv, lo.adv);
    }
    const ink = new InkBox();
    for (const p of parts) {
      const b = p.m.ink;
      if (b)
        ink.add(
          { xMin: b.xMin * p.h * p.w, xMax: b.xMax * p.h * p.w, yMin: b.yMin * p.h, yMax: b.yMax * p.h },
          p.x,
          p.y,
        );
    }
    for (const b of bars)
      ink.add({ xMin: b.x0, xMax: b.x1, yMin: Math.min(b.y0, b.y1), yMax: Math.max(b.y0, b.y1) }, 0, 0);
    if (top !== undefined && !ink.empty) ink.yMax = Math.max(ink.yMax, top);
    return { k: "stack", ctx, parts, bars, adv, ink: ink.empty ? undefined : ink, h };
  }

  private tabAdvance(x: number, ln: Line): number {
    const h = this.h0;
    const stops = ln.paragraph.tabs;
    const rel = x;
    for (const s of stops) {
      const p = s.pos * h - ln.margin;
      if (p > rel + 1e-9) return p - rel;
    }
    const step = DEFAULT_TAB * h;
    const next = (Math.floor((rel + ln.margin) / step + 1e-9) + 1) * step - ln.margin;
    return next - rel;
  }

  private newLine(p: ParagraphState, first: boolean): Line {
    const h = this.h0;
    const margin = (p.left + (first ? p.indent : 0)) * h;
    return {
      items: [],
      paragraph: p,
      first,
      margin,
      pen: 0,
      capMax: 0,
      inkTop: 0,
      inkBottom: 0,
      ext0: 0,
      ext1: 0,
      hasInk: false,
      baseline: 0,
      x: 0,
      column: 0,
    };
  }

  private push(ln: Line, item: Item): void {
    const adv = item.k === "tab" ? this.tabAdvance(ln.pen, ln) : item.adv;
    ln.items.push({ item, x: ln.pen, adv });
    ln.pen += adv;
  }

  wrapParagraph(items: readonly Item[], p: ParagraphState, wrap: number, out: Line[]): void {
    let ln = this.newLine(p, true);
    const lineW = (l: Line) => wrap - l.margin - p.right * this.h0;
    let k = 0;
    while (k < items.length) {
      const it = items[k]!;
      if ((it.k === "space" && !it.nbsp) || it.k === "tab") {
        this.push(ln, it);
        k++;
        continue;
      }
      // a word: consecutive glyph / stack / nbsp items, split next to CJK characters
      // (cjkBreak, VERIFIED-BY-ACAD text-probes/cjk-wrap-*, cjk-mixed-*; note 04 §3.6.2)
      let j = k;
      let wordAdv = 0;
      let wordInk = 0;
      while (j < items.length) {
        const w = items[j]!;
        if ((w.k === "space" && !w.nbsp) || w.k === "tab") break;
        if (j > k && cjkBreak(items[j - 1]!, w)) break;
        const ink = w.k === "glyph" || w.k === "stack" ? w.ink : undefined;
        wordInk = ink ? wordAdv + ink.xMax : wordInk;
        wordAdv += w.adv;
        j++;
      }
      // the word fits when its ink ends inside the width; its advance may overshoot
      // (VERIFIED-BY-ACAD mtext/chunk-*, note 04 §3.6.2)
      if (wrap > 0 && ln.items.length > 0 && ln.pen + wordInk > lineW(ln) + 1e-9) {
        this.finishLine(ln);
        out.push(ln);
        ln = this.newLine(p, false);
      }
      for (let q = k; q < j; q++) this.push(ln, items[q]!);
      k = j;
    }
    this.finishLine(ln);
    out.push(ln);
  }

  private finishLine(ln: Line): void {
    const ink = new InkBox();
    let cap = 0;
    for (const pi of ln.items) {
      const it = pi.item;
      if (it.k === "glyph" || it.k === "stack") {
        cap = Math.max(cap, it.h);
        if (it.ink) ink.add(it.ink, pi.x, this.alignShift(it, 0));
      }
    }
    // empty / whitespace-only line: the height at the paragraph start
    if (cap === 0) cap = ln.items[0]?.item.ctx.height ?? ln.paragraph.height;
    // \A shifts depend on the line's cap height: recompute with the final value
    ink.xMin = Number.POSITIVE_INFINITY;
    ink.xMax = Number.NEGATIVE_INFINITY;
    ink.yMin = Number.POSITIVE_INFINITY;
    ink.yMax = Number.NEGATIVE_INFINITY;
    for (const pi of ln.items) {
      const it = pi.item;
      if ((it.k === "glyph" || it.k === "stack") && it.ink) {
        const dy = this.alignShift(it, cap);
        ink.add(it.ink, pi.x, dy);
        // an overline raises the line like ink (VERIFIED-BY-ACAD mtext/code-underline-all)
        const d = MTEXT_DECORATION;
        if (it.ctx.overline)
          ink.add({ xMin: 0, xMax: pi.adv, yMin: d.overline * it.h, yMax: d.overline * it.h }, pi.x, dy);
        if (it.ctx.underline)
          ink.add({ xMin: 0, xMax: pi.adv, yMin: d.underline * it.h, yMax: d.underline * it.h }, pi.x, dy);
      }
    }
    ln.capMax = cap;
    ln.hasInk = !ink.empty;
    ln.inkTop = ink.empty ? 0 : ink.yMax;
    ln.inkBottom = ink.empty ? 0 : ink.yMin;
    if (ink.empty) {
      ln.ext0 = 0;
      ln.ext1 = ln.pen;
    } else {
      // ink left of the pen origin is not counted (Arial "Arc", note 04 §3.6.1). Only the first
      // glyph's own side bearing is removed: leading tabs/spaces keep their advance (a line
      // starting with ^I sits on the 4·h tab stop, VERIFIED-BY-ACAD user/studienleistung legend)
      let firstInkX = 0;
      for (const pi of ln.items) {
        if ((pi.item.k === "glyph" || pi.item.k === "stack") && pi.item.ink) {
          firstInkX = pi.x;
          break;
        }
      }
      ln.ext0 = Math.max(0, ink.xMin - firstInkX);
      ln.ext1 = ink.xMax;
      // tabs count with their full advance ("asasas^I" → 8 h, VERIFIED-BY-ACAD)
      const lastInk = lastInkIndex(ln);
      for (let q = 0; q < ln.items.length; q++) {
        const pi = ln.items[q]!;
        if (pi.item.k === "tab" && q > lastInk) ln.ext1 = Math.max(ln.ext1, pi.x + pi.adv);
      }
    }
  }

  /** TrueType cell box of a line [x0, x1, bottom, top] (line coordinates), or undefined. */
  cellBox(ln: Line): [number, number, number, number] | undefined {
    let x0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let top = 0;
    let bottom = 0;
    for (const pi of ln.items) {
      const it = pi.item;
      if (it.k !== "glyph") continue;
      const r = it.m.resolved;
      if (r?.font.kind !== "ttf") continue;
      x0 = Math.min(x0, pi.x);
      x1 = Math.max(x1, pi.x + pi.adv);
      top = Math.max(top, r.font.ascent * r.scale * it.h);
      bottom = Math.min(bottom, -r.font.descent * r.scale * it.h);
    }
    return x0 <= x1 ? [x0, x1, bottom, top] : undefined;
  }

  private alignShift(it: GlyphItem | StackItem, cap: number): number {
    const a = it.ctx.align;
    if (a === 0 || cap === 0) return 0;
    return a === 1 ? (cap - it.h) / 2 : cap - it.h;
  }

  /** Justified/distributed: stretch the spaces of all but the paragraph's last line (ASSUMPTION). */
  justify(ln: Line, frameW: number, lines: readonly Line[]): void {
    const idx = lines.indexOf(ln);
    const next = lines[idx + 1];
    const lastOfParagraph = !next || next.first;
    if (lastOfParagraph && ln.paragraph.align === "justified") return;
    const avail = frameW - ln.margin - ln.paragraph.right * this.h0;
    const lastInk = lastInkIndex(ln);
    const spaces: number[] = [];
    for (let q = 0; q < lastInk; q++) if (ln.items[q]!.item.k === "space") spaces.push(q);
    const extra = avail - ln.ext1;
    if (spaces.length === 0 || extra <= 0) return;
    const add = extra / spaces.length;
    let shift = 0;
    for (let q = 0; q < ln.items.length; q++) {
      const pi = ln.items[q]!;
      pi.x += shift;
      if (spaces.includes(q)) {
        pi.adv += add;
        shift += add;
      }
    }
    ln.ext1 += shift;
  }

  /**
   * TrueType runs of a line (note 04 §14): consecutive glyphs and spaces with one font, height,
   * width, tracking and oblique; tabs, stacks and SHX glyphs end a run. Returns the run slot of
   * every line item.
   */
  private textRuns(ln: Line, base: Affine2, runs: TextRun[]): ({ run: number; index: number } | undefined)[] {
    const slots: ({ run: number; index: number } | undefined)[] = new Array(ln.items.length).fill(undefined);
    let start = -1;
    let ttf = false;
    let font: unknown;
    const flush = (end: number) => {
      // spaces at the end of a run (the break of a wrapped line) are not part of the string
      while (start >= 0 && end > start && ln.items[end - 1]!.item.k === "space") end--;
      if (start >= 0 && ttf && end > start) {
        const run = runs.length;
        const advances: number[] = [];
        for (let q = start; q < end; q++) {
          slots[q] = { run, index: q - start };
          advances.push(ln.items[q]!.adv);
        }
        runs.push({ dirX: base.a, dirY: base.b, advances });
      }
      start = -1;
      ttf = false;
      font = undefined;
    };
    const same = (a: MTextContext, b: MTextContext) =>
      a.font === b.font &&
      a.color === b.color &&
      a.underline === b.underline &&
      a.overline === b.overline &&
      a.strike === b.strike &&
      a.height === b.height &&
      a.widthFactor === b.widthFactor &&
      a.tracking === b.tracking &&
      a.oblique === b.oblique;
    ln.items.forEach((pi, q) => {
      const it = pi.item;
      const resolved = it.k === "glyph" ? it.m.resolved?.font : undefined;
      if ((it.k !== "glyph" && it.k !== "space") || resolved?.kind === "shx") {
        flush(q);
        return;
      }
      // a glyph from another (fallback) font is drawn as a string of its own
      if (start >= 0 && (!same(ln.items[start]!.item.ctx, it.ctx) || (resolved && font && resolved !== font)))
        flush(q);
      if (start < 0) start = q;
      if (resolved) {
        font = resolved;
        ttf = true;
      }
    });
    flush(ln.items.length);
    return slots;
  }

  emitLine(
    ln: Line,
    base: Affine2,
    glyphs: GlyphPlacement[],
    decor: DecorationLine[],
    runs: TextRun[],
  ): void {
    const slots = this.textRuns(ln, base, runs);
    for (let q = 0; q < ln.items.length; q++) {
      const pi = ln.items[q]!;
      const it = pi.item;
      if (it.k === "glyph") {
        const r = it.m.resolved;
        if (!r?.glyph.bounds) continue;
        const s = r.scale;
        const tan = Math.tan(it.ctx.oblique * DEG);
        const dy = this.alignShift(it, ln.capMax);
        const slot = slots[q];
        glyphs.push({
          glyph: r.glyph,
          font: r.font,
          matrix: base.multiply(new Affine2(s * it.h * it.w, 0, s * it.h * tan, s * it.h, pi.x, dy)),
          color: it.ctx.color,
          ...(slot ? { run: slot } : {}),
        });
      } else if (it.k === "stack") {
        const dy = this.alignShift(it, ln.capMax);
        for (const p of it.parts) {
          const r = p.m.resolved;
          if (!r?.glyph.bounds) continue;
          const s = r.scale;
          glyphs.push({
            glyph: r.glyph,
            font: r.font,
            matrix: base.multiply(
              new Affine2(s * p.h * p.w, 0, s * p.h * p.tanOb, s * p.h, pi.x + p.x, dy + p.y),
            ),
            color: it.ctx.color,
          });
        }
        for (const b of it.bars) {
          const a = base.apply({ x: pi.x + b.x0, y: dy + b.y0 });
          const c = base.apply({ x: pi.x + b.x1, y: dy + b.y1 });
          decor.push({ kind: "stack-bar", x0: a.x, y0: a.y, x1: c.x, y1: c.y, color: it.ctx.color });
        }
      }
    }
    this.decorations(ln, base, decor);
  }

  /** Underline/overline/strike runs; strokes continue across spaces (note 04 §3.3). */
  private decorations(ln: Line, base: Affine2, decor: DecorationLine[]): void {
    const d = decorationOffsets(this.baseFont);
    const kinds: readonly [DecorationKind, "underline" | "overline" | "strike", number][] = [
      ["underline", "underline", this.o.underlineOffset ?? d.underline],
      ["overline", "overline", this.o.overlineOffset ?? d.overline],
      ["strike", "strike", this.o.strikeOffset ?? d.strike],
    ];
    const lastInk = lastInkIndex(ln);
    for (const [kind, flag, off] of kinds) {
      let start = -1;
      let end = 0;
      let color: ColorOverride | undefined;
      const flush = () => {
        if (start >= 0 && end > start) {
          const y = off * ln.capMax;
          const a = base.apply({ x: start, y });
          const b = base.apply({ x: end, y });
          decor.push({ kind, x0: a.x, y0: a.y, x1: b.x, y1: b.y, color });
        }
        start = -1;
      };
      for (let q = 0; q < ln.items.length; q++) {
        const pi = ln.items[q]!;
        // trailing spaces after the last glyph are not decorated (UNVERIFIED)
        const on = pi.item.ctx[flag] && (q <= lastInk || pi.item.k === "glyph");
        if (on) {
          if (start < 0) {
            start = pi.x;
            color = pi.item.ctx.color;
          }
          end = pi.x + pi.adv;
        } else flush();
      }
      flush();
    }
  }
}

function lastInkIndex(ln: Line): number {
  for (let q = ln.items.length - 1; q >= 0; q--) {
    const k = ln.items[q]!.item.k;
    if (k === "glyph" || k === "stack") return q;
  }
  return -1;
}

/**
 * `\T` tracking multiplies the advances, clamped to AutoCAD's range 0.75…4 (VERIFIED-BY-ACAD
 * mtext/code-tracking(-rel): \T0.5 and \T0.1x both give 0.75, \T2 and \T1.5x multiply).
 */
export function trackingFactor(t: number): number {
  if (!(t > 0)) return 1;
  return Math.min(4, Math.max(0.75, t));
}

// Kinsoku: characters that never start a line (closing marks, small kana) or never end one
// (CJK opening marks). VERIFIED-BY-ACAD for ，。、） (text-probes/cjk-wrap-w40: "未经允" /
// "许，不得泄", "计）。" kept together) and （《「【 (cjk-open-w40: moved to the next line);
// “ does end a line (cjk-wrap-w53). The rest of the sets is the usual Chinese / Japanese rule
// (ASSUMPTION).
const NO_LINE_START = new Set(
  [
    ..."、。，．：；？！）］｝〕〉》」』】〙〗〟’”｠»ヽヾーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖ々〻゠〜・％‰℃,.:;?!)]}%",
  ].map((c) => c.codePointAt(0)!),
);
const NO_LINE_END = new Set([..."（［｛〔〈《「『【〘〖〝｟"].map((c) => c.codePointAt(0)!));

/**
 * A line may break between two items of a word: next to a CJK character (lines break between
 * CJK characters and at CJK / Latin boundaries), unless the second one may not start a line or
 * the first one may not end it.
 */
function cjkBreak(a: Item, b: Item): boolean {
  const ca = a.k === "glyph" ? a.cp : undefined;
  const cb = b.k === "glyph" ? b.cp : undefined;
  if (!(ca !== undefined && isCjk(ca)) && !(cb !== undefined && isCjk(cb))) return false;
  if (cb !== undefined && NO_LINE_START.has(cb)) return false;
  if (ca !== undefined && NO_LINE_END.has(ca)) return false;
  return true;
}

/**
 * Characters MTEXT breaks lines around: CJK ideographs, kana, bopomofo, CJK symbols and
 * punctuation, fullwidth / halfwidth forms (note 04 §3.6.2). Hangul is left out: Korean
 * separates words with spaces (ASSUMPTION, not probed).
 */
function isCjk(cp: number): boolean {
  return (
    (cp >= 0x2e80 && cp <= 0x2fdf) || // radicals
    (cp >= 0x3000 && cp <= 0x33ff) || // symbols, punctuation, kana, bopomofo, enclosed, compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) || // extension A
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) || // compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // compatibility forms
    (cp >= 0xff00 && cp <= 0xffef) || // fullwidth / halfwidth forms
    (cp >= 0x20000 && cp <= 0x3134f) // extensions B–G
  );
}
