/** Glyph measurement shared by the TEXT and MTEXT layout engines (note 04 §4.4, §4.5). */
import type { Bounds, ResolvedGlyph, StyleFont } from "@truedxf/fonts";

/** A glyph measured at text height 1 (cap height = 1), before width factor. */
export interface MeasuredGlyph {
  readonly code: number;
  readonly resolved: ResolvedGlyph | undefined;
  /** Pen advance (SHX: final pen x; TTF: hmtx advance, no kerning). */
  readonly advance: number;
  /** Ink box relative to the pen position, `undefined` without ink. */
  readonly ink: Bounds | undefined;
}

export function measureGlyph(font: StyleFont, code: number, vertical = false): MeasuredGlyph {
  return measureResolved(code, font.glyph(code, vertical ? { vertical } : {}));
}

export function measureResolved(code: number, r: ResolvedGlyph | undefined): MeasuredGlyph {
  if (!r) return { code, resolved: undefined, advance: 0, ink: undefined };
  const s = r.scale;
  const b = r.glyph.bounds;
  return {
    code,
    resolved: r,
    advance: r.glyph.advance * s,
    ink: b ? { xMin: b.xMin * s, yMin: b.yMin * s, xMax: b.xMax * s, yMax: b.yMax * s } : undefined,
  };
}

/** A space within one linked TrueType fallback run uses that font's advance (note 04 §15). */
export function fallbackSpace(
  before: ResolvedGlyph | undefined,
  after: ResolvedGlyph | undefined,
): MeasuredGlyph | undefined {
  if (!before?.fallback || !after?.fallback || before.font !== after.font || before.font.kind !== "ttf")
    return undefined;
  const glyph = before.font.glyph(0x20);
  return glyph ? measureResolved(0x20, { ...before, glyph }) : undefined;
}

/** Growable ink box. */
export class InkBox {
  xMin = Number.POSITIVE_INFINITY;
  yMin = Number.POSITIVE_INFINITY;
  xMax = Number.NEGATIVE_INFINITY;
  yMax = Number.NEGATIVE_INFINITY;

  get empty(): boolean {
    return this.xMin > this.xMax;
  }

  add(b: Bounds, dx: number, dy: number, sx = 1, sy = 1): void {
    const x0 = b.xMin * sx + dx;
    const x1 = b.xMax * sx + dx;
    const y0 = b.yMin * sy + dy;
    const y1 = b.yMax * sy + dy;
    if (Math.min(x0, x1) < this.xMin) this.xMin = Math.min(x0, x1);
    if (Math.max(x0, x1) > this.xMax) this.xMax = Math.max(x0, x1);
    if (Math.min(y0, y1) < this.yMin) this.yMin = Math.min(y0, y1);
    if (Math.max(y0, y1) > this.yMax) this.yMax = Math.max(y0, y1);
  }

  addBox(o: InkBox): void {
    if (o.empty) return;
    this.add(o, 0, 0);
  }
}

/**
 * Decoration line heights in text heights (above the baseline) for a font (VERIFIED-BY-ACAD
 * 2026-09-30): SHX (simplex.shx) underline −0.2 h, overline 1.2 h, strike 0.5 h; TrueType (Lato)
 * underline at −hhea descent, overline at the hhea ascent, strike 0.5 h.
 */
export function decorationOffsets(font: StyleFont): { underline: number; overline: number; strike: number } {
  const p = font.primary;
  if (p.kind === "ttf")
    return { underline: -p.descent / p.capHeight, overline: p.ascent / p.capHeight, strike: 0.5 };
  return { underline: -0.2, overline: 1.2, strike: 0.5 };
}
