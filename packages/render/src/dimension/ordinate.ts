/**
 * Ordinate dimension layout (note 05 §5.7, §6.5; VERIFIED-BY-ACAD type-ordinate-x/y-nb,
 * hdir-ordinate-y-*-nb): a leader along the local axis from the feature (13 + DIMEXO) to the
 * leader end (14), with a jog from 14 − 4·DIMASZ to 14 − 2·DIMASZ when 13 and 14 are not in line,
 * continued under the text (DIMGAP + text width). The local axes are rotated by −(group 51).
 */

import type { Pt } from "./block-builder.ts";
import { add, angleOf, type DimCtx, dirOf, dot, left, readable, sub } from "./context.ts";

export interface OrdinateInput {
  readonly origin: Pt;
  readonly feature: Pt;
  readonly leaderEnd: Pt;
  readonly xType: boolean;
  /** Local x-axis angle (radians) = −(group 51). */
  readonly axis: number;
  readonly content: string;
  readonly textRotation: number | undefined;
}

export function layoutOrdinate(c: DimCtx, inp: OrdinateInput): void {
  const w = c.w;
  const xl = dirOf(inp.axis);
  const yl = left(xl);
  // X-type dimensions measure along x with a leader along y and vice versa
  let d = inp.xType ? yl : xl;
  const n = inp.xType ? xl : yl;
  const f = inp.feature;
  const e = inp.leaderEnd;
  if (dot(sub(e, f), d) < 0) d = { x: -d.x, y: -d.y };
  const along = dot(sub(e, f), d);
  const off = dot(sub(e, f), n);
  const tb = c.measure(inp.content);
  const p = c.ext1;
  const start = add(f, d, c.exo);
  const end = add(e, d, c.gap + tb.width);
  if (Math.abs(off) > 1e-9) {
    const k1 = add(f, d, along - 4 * c.asz);
    const k2 = add(add(f, d, along - 2 * c.asz), n, off);
    w.line(start, k1, p);
    w.line(k1, k2, p);
    w.line(k2, end, p);
  } else w.line(start, end, p);
  const rot = inp.textRotation ?? readable(angleOf(d));
  const up = left(dirOf(rot));
  const tad = c.v.num("DIMTAD");
  const mid = add(e, d, c.gap + tb.width / 2);
  const center = tad === 0 ? mid : add(mid, up, (c.box ? 2 : 1) * c.gap + tb.height / 2);
  c.writeText(center, rot, inp.content, tb);
}
