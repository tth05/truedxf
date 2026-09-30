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
  const r = font.glyph(code, vertical ? { vertical } : {});
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
