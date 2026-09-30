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
 * - word wrap at spaces only; a word longer than the width spills; leading spaces count;
 * - default tab stops every 4 × h (VERIFIED-BY-ACAD); `\pt` stops in multiples of h;
 * - style width factor and oblique are the initial `\W`/`\Q` (ezdxf#1351, VERIFIED TrueView).
 * UNVERIFIED (to calibrate against PLOT references): the attachment frame (we use the extents box,
 * or the reference width when 41 > 0), the stack geometry, decoration offsets, tracking, paragraph
 * spacing, background box, column breaking.
 */
import type { Bounds, StyleFont } from "@truedxf/fonts";
import { Affine2, Matrix44, ocsToWcsMatrix, type Vec3, wcsToOcsMatrix } from "@truedxf/geometry";
import { glyphCode, type TextFontSource } from "./fonts.ts";
import { decorationOffsets, InkBox, type MeasuredGlyph, measureGlyph, measureResolved } from "./glyphs.ts";
import {
  defaultContext,
  type MTextChar,
  type MTextContext,
  type MTextToken,
  type ParagraphAlign,
  parseMText,
} from "./mtext-parser.ts";
import { quickBox } from "./text-layout.ts";
import type {
  BackgroundFill,
  ColorOverride,
  DecorationKind,
  DecorationLine,
  GlyphPlacement,
  TextLayout,
} from "./types.ts";

/** Baseline pitch in cap heights (note 04 §3.6.2, VERIFIED-BY-ACAD). */
export const LINE_PITCH = 5 / 3;
/** Default tab stop distance in char heights (VERIFIED-BY-ACAD). */
export const DEFAULT_TAB = 4;

/** MTEXT column data (structurally compatible with @truedxf/model's MTextColumns). */
export interface MTextColumnsInput {
  readonly type: number;
  readonly count: number;
  readonly width: number;
  readonly gutter: number;
  readonly definedHeight: number;
  readonly heights: readonly number[];
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
  if (e.flowDirection === 3) notes.push("mtext-vertical-flow-unsupported");
  const spec = style.spec;
  const ctx0 = defaultContext(h0, spec?.widthFactor || 1, spec?.oblique ?? 0);
  const tokens = parseMText(e.text, ctx0, options.dimension);
  const cols = e.columns && e.columns.type > 0 ? e.columns : undefined;
  let wrap = options.wrapWidth ?? (cols && cols.width > 0 ? cols.width : e.width);
  if (!(wrap > 0)) wrap = 0;
  const f0 = e.lineSpacingFactor > 0 ? e.lineSpacingFactor : 1;
  const exact0 = e.lineSpacingStyle === 2;
  const col = ((e.attachment - 1) % 3) + 1;
  const row = Math.floor((e.attachment - 1) / 3);
  const defaultAlign: ParagraphAlign = col === 2 ? "center" : col === 3 ? "right" : "left";
  const engine = new Engine(fonts, baseFont, h0, options, notes);

  // ---- paragraphs → lines
  const lines: Line[] = [];
  for (const para of splitParagraphs(tokens, h0)) {
    const items = engine.items(para.tokens);
    engine.wrapParagraph(items, para.state, wrap, lines);
  }
  if (lines.length === 0) return emptyLayout(ocs, notes);

  // ---- vertical placement, column breaking
  const colHeights = columnHeights(cols, e.definedHeight);
  let column = 0;
  let prev: Line | undefined;
  let bottom = 0;
  // Paragraph line spacing (VERIFIED-BY-ACAD mtext/para-spacing-*): \pse<v> = exact spacing as
  // for char height v (pitch 5/3·v, first baseline v below the top), \psa<v> = at least 5/3·v,
  // \psm<f> = factor f; \pb/\pa = space before/after the paragraph in drawing units.
  let pending = 0;
  let exactCap = h0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    const ls = ln.paragraph.lineSpacing;
    const exact = ls ? ls.mode === "exact" : exact0;
    const cap = ls?.mode === "exact" ? ls.factor : h0;
    const f = ls?.mode === "multiple" && ls.factor > 0 ? ls.factor : ls ? 1 : f0;
    const minPitch = ls?.mode === "atLeast" ? LINE_PITCH * ls.factor : 0;
    const ascent = Math.max(ln.capMax, ln.inkTop);
    if (ln.first) pending += ln.paragraph.spaceBefore;
    if (!prev) ln.baseline = exact ? -cap : -ascent;
    else if (exact) ln.baseline = prev.baseline - LINE_PITCH * cap * (exact0 && !ls ? f0 : 1);
    // at least: the gap is (5/3·f − 1)·(previous line's largest height + this paragraph's base
    // height)/2 (VERIFIED-BY-ACAD mtext/spacing-big-line-1, height-style-0)
    else
      ln.baseline =
        prev.baseline -
        Math.max(minPitch, ((LINE_PITCH * f - 1) * (prev.capMax + ln.paragraph.baseHeight)) / 2 + ascent);
    ln.baseline -= pending;
    pending = 0;
    const next = lines[i + 1];
    if (!next || next.first) pending += ln.paragraph.spaceAfter;
    // column overflow (UNVERIFIED rule: the baseline passes the column height)
    const limit = colHeights?.[column] ?? colHeights?.[colHeights.length - 1];
    const forced = prev?.paragraph.columnBreakAfter && isParagraphStart(lines, ln);
    if (cols && prev && ((limit !== undefined && limit > 0 && -ln.baseline > limit) || forced)) {
      column++;
      ln.baseline = exact ? -cap : -ascent;
    }
    ln.column = column;
    exactCap = cap;
    const lnBottom = exact ? ln.baseline - cap / 3 : ln.baseline + Math.min(0, ln.inkBottom);
    bottom = Math.min(bottom, lnBottom);
    prev = ln;
  }
  const last = lines[lines.length - 1]!;
  // the extents bottom counts only the descenders of the last line (note 04 §3.6.1)
  const lastExact = last.paragraph.lineSpacing ? last.paragraph.lineSpacing.mode === "exact" : exact0;
  const lastBottom = lastExact ? last.baseline - exactCap / 3 : last.baseline + Math.min(0, last.inkBottom);
  const boxBottom = cols ? bottom : lastBottom;

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

  // ---- attachment frame
  const nCols = Math.max(1, (cols ? Math.max(cols.count, last.column + 1) : 1) || 1);
  const colStep = cols ? (cols.width > 0 ? cols.width : frameW) + cols.gutter : 0;
  const totalW = cols ? nCols * (colStep - cols.gutter) + (nCols - 1) * cols.gutter : frameW;
  let frameH = -boxBottom;
  // 46 (defined height) does not move non-column text (VERIFIED-BY-ACAD mtext/defined-height-*)
  const defH = cols ? (colHeights?.[0] ?? 0) : 0;
  if (defH > 0) frameH = defH; // defined height (46): UNVERIFIED frame rule
  const xAtt = col === 1 ? 0 : col === 2 ? totalW / 2 : totalW;
  const yAtt = row === 0 ? 0 : row === 1 ? -frameH / 2 : -frameH;

  const ins = toOcs.transformPoint(e.insert);
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const place = new Affine2(cr, sr, -sr, cr, ins.x, ins.y).multiply(Affine2.translation(-xAtt, -yAtt));

  const glyphs: GlyphPlacement[] = [];
  const decor: DecorationLine[] = [];
  for (const ln of lines) {
    const base = place.multiply(Affine2.translation(ln.x + ln.column * colStep, ln.baseline));
    if (options.quickText) {
      if (ln.hasInk) decor.push(...quickBox(base, ln.ext0, ln.ext1, 0, ln.capMax));
    } else engine.emitLine(ln, base, glyphs, decor);
  }

  // ---- background fill and frame (note 04 §3.1; geometry UNVERIFIED)
  const backgrounds: BackgroundFill[] = [];
  const bg = e.bgFlags;
  if (bg & 3 || bg & 16) {
    const scale = bg & 3 ? (e.bgScale > 0 ? e.bgScale : 1.5) : 1.5;
    const off = (scale - 1) * h0;
    const x0 = -off;
    const x1 = totalW + off;
    const y1 = off;
    const y0 = -frameH - off;
    const q = [
      place.apply({ x: x0, y: y0 }),
      place.apply({ x: x1, y: y0 }),
      place.apply({ x: x1, y: y1 }),
      place.apply({ x: x0, y: y1 }),
    ];
    if (bg & 3) {
      const color: BackgroundFill["color"] =
        bg & 2
          ? { kind: "canvas" }
          : e.bgTrueColor !== undefined
            ? { kind: "rgb", rgb: e.bgTrueColor & 0xffffff }
            : { kind: "aci", aci: e.bgColor };
      backgrounds.push({
        corners: [q[0]!.x, q[0]!.y, q[1]!.x, q[1]!.y, q[2]!.x, q[2]!.y, q[3]!.x, q[3]!.y],
        color,
      });
    }
    if (bg & 16) {
      for (let k = 0; k < 4; k++) {
        const a = q[k]!;
        const b = q[(k + 1) % 4]!;
        decor.push({ kind: "frame", x0: a.x, y0: a.y, x1: b.x, y1: b.y, color: undefined });
      }
    }
  }
  const plane = ins.z !== 0 ? ocs.multiply(Matrix44.translation(0, 0, ins.z)) : ocs;
  return { plane, backgrounds, glyphs, lines: decor, notes };
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
  const f = e.lineSpacingFactor > 0 ? e.lineSpacingFactor : 1;
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
    else
      ln.baseline =
        prev.baseline - ((LINE_PITCH * f - 1) * (prev.capMax + ln.paragraph.baseHeight)) / 2 - ascent;
    width = Math.max(width, ln.margin + ln.ext1 - ln.ext0);
    prev = ln;
  }
  const last = lines[lines.length - 1]!;
  const bottom = exact ? last.baseline - h0 / 3 : last.baseline + Math.min(0, last.inkBottom);
  return { width, height: top - bottom, lines: lines.length };
}

// ---- helpers ----------------------------------------------------------------------------------

function isParagraphStart(lines: readonly Line[], ln: Line): boolean {
  return ln.first && lines.indexOf(ln) > 0;
}

function columnHeights(cols: MTextColumnsInput | undefined, definedHeight: number): number[] | undefined {
  if (!cols) return undefined;
  if (cols.heights.length > 0) return [...cols.heights];
  const h = cols.definedHeight > 0 ? cols.definedHeight : definedHeight;
  return h > 0 ? [h] : undefined;
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

  private glyph(ctx: MTextContext, ch: MTextChar): GlyphItem {
    const font = this.fontOf(ctx);
    let m: MeasuredGlyph;
    if (ch.control) {
      // control characters: the missing-glyph box of a TrueType font (text/caret-codes-mtext)
      const nd = this.fonts.notdefGlyph?.(font);
      m = nd ? measureResolved(0x25af, nd) : measureGlyph(font, 0x3f);
    } else {
      m = measureGlyph(font, glyphCode(font, ch, this.fonts.encoding));
      // characters missing from an SHX font come from a TrueType fallback at that font's own
      // cap-height scale — unlike TEXT, which draws "?" (VERIFIED-BY-ACAD text/escape-spellings)
      if (font.primary.kind === "shx" && (!m.resolved || m.resolved.fallback) && ch.cp !== 0x3f) {
        const fb = this.fonts.fallbackGlyph?.(ch.cp);
        if (fb) m = measureResolved(ch.cp, fb);
      }
    }
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
    for (const t of tokens) {
      switch (t.t) {
        case "char":
          out.push(this.glyph(t.ctx, t.ch));
          break;
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
   * Stack geometry, measured in AutoCAD 2027 plots with simplex.shx (suite mtext/stack-*,
   * VERIFIED-BY-ACAD 2026-09-30; hs = the current char height, parts are drawn at hs — the usual
   * 70 % comes from an explicit \H0.7x;):
   * - "/" and "^": lower part on the baseline, upper part's baseline at 4/3·hs; "/" draws a bar at
   *   7/6·hs from the stack start to the widest part's ink right edge; "/" centres the parts on
   *   the bar by ink width, "^" left-aligns them; advance = the larger part advance;
   * - "#": upper part at the start on baseline hs, lower part on the baseline starting h/3 after
   *   the upper part's ink right edge; a 2·hs long slash at 55° centred at (upper ink right + hs/6,
   *   hs); advance = lower start + lower advance;
   * - no divider: the text raised by hs/3.
   */
  private stack(
    ctx: MTextContext,
    upper: readonly MTextChar[],
    lower: readonly MTextChar[],
    kind: "^" | "/" | "#" | "",
  ): StackItem {
    const h = ctx.height;
    const run = (chars: readonly MTextChar[]) => {
      const gs: GlyphItem[] = chars.map((c) => this.glyph(ctx, c));
      let pen = 0;
      const ink = new InkBox();
      const xs: number[] = [];
      for (const g of gs) {
        xs.push(pen);
        if (g.ink) ink.add(g.ink, pen, 0);
        pen += g.adv;
      }
      return { gs, xs, adv: pen, inkRight: ink.empty ? pen : ink.xMax };
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
    let adv: number;
    if (kind === "") {
      // no divider: the text raised by hs/3 (VERIFIED-BY-ACAD mtext/stack-no-divider)
      add(up, 0, h / 3);
      adv = up.adv;
    } else if (kind === "#") {
      const lx = up.inkRight + h / 3;
      add(up, 0, h);
      add(lo, lx, 0);
      const cx = up.inkRight + h / 6;
      const dx = Math.cos(55 * DEG) * h;
      const dy = Math.sin(55 * DEG) * h;
      bars.push({ x0: cx - dx, y0: h - dy, x1: cx + dx, y1: h + dy });
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
      // a word: consecutive glyph / stack / nbsp items
      let j = k;
      let wordAdv = 0;
      while (j < items.length) {
        const w = items[j]!;
        if ((w.k === "space" && !w.nbsp) || w.k === "tab") break;
        wordAdv += w.adv;
        j++;
      }
      if (wrap > 0 && ln.items.length > 0 && ln.pen + wordAdv > lineW(ln) + 1e-9) {
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
      // ink left of the pen origin is not counted (Arial "Arc", note 04 §3.6.1)
      ln.ext0 = Math.max(0, ink.xMin);
      ln.ext1 = ink.xMax;
      // tabs count with their full advance ("asasas^I" → 8 h, VERIFIED-BY-ACAD)
      const lastInk = lastInkIndex(ln);
      for (let q = 0; q < ln.items.length; q++) {
        const pi = ln.items[q]!;
        if (pi.item.k === "tab" && q > lastInk) ln.ext1 = Math.max(ln.ext1, pi.x + pi.adv);
      }
    }
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

  emitLine(ln: Line, base: Affine2, glyphs: GlyphPlacement[], decor: DecorationLine[]): void {
    for (const pi of ln.items) {
      const it = pi.item;
      if (it.k === "glyph") {
        const r = it.m.resolved;
        if (!r?.glyph.bounds) continue;
        const s = r.scale;
        const tan = Math.tan(it.ctx.oblique * DEG);
        const dy = this.alignShift(it, ln.capMax);
        glyphs.push({
          glyph: r.glyph,
          font: r.font,
          matrix: base.multiply(new Affine2(s * it.h * it.w, 0, s * it.h * tan, s * it.h, pi.x, dy)),
          color: it.ctx.color,
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
