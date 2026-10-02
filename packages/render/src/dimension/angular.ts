/**
 * Angular (2-line, 3-point) and arc-length dimension layout as AutoCAD 2027 regenerates it
 * (DXFOUT re-saves of the `dimensions` suite: type-angular*, angular2l-*, angular3p-*, type-arc-*,
 * arc-*; note 05 §5.4, §5.5, §6.4).
 */

import type { Pt } from "./block-builder.ts";
import {
  add,
  angleOf,
  type DimCtx,
  dirOf,
  dot,
  left,
  norm2pi,
  readable,
  sub,
  unit,
  type Vec,
} from "./context.ts";

const DEG = 180 / Math.PI;

export interface AngularInput {
  /** Vertex / arc centre. */
  readonly V: Pt;
  /** Start and end angle of the dimension arc (counter-clockwise, radians). */
  readonly a0: number;
  readonly a1: number;
  /** Radius of the dimension arc. */
  readonly r: number;
  /**
   * Extension line source per end: the span [lo, hi] (distances from V along the ray) of the
   * measured geometry on that ray; undefined = no extension line (arc on the geometry).
   */
  readonly ext0: readonly [number, number] | undefined;
  readonly ext1: readonly [number, number] | undefined;
  readonly content: string;
  readonly p11: Pt | undefined;
  readonly userText: boolean;
  readonly textRotation: number | undefined;
  /** "Horizontal" for DIMTIH (−51, radians). */
  readonly horizontal: number;
  /** Arc length: DIMARCSYM symbol. */
  readonly arcSymbol?: boolean;
  /** Arc length: parallel extension lines (included angle < 90°) along this direction. */
  readonly parallel?: Vec;
  /** Arc-length leader (71 = 1): from the dimension arc to the measured arc of this radius. */
  readonly leaderTo?: number;
}

export function layoutAngular(c: DimCtx, inp: AngularInput): void {
  const { V, r } = inp;
  const w = c.w;
  const sweep = norm2pi(inp.a1 - inp.a0) || Math.PI * 2;
  const a0 = inp.a0;
  const a1 = a0 + sweep;
  const onArc = (a: number, rr = r) => add(V, dirOf(a), rr);

  // ---- extension lines (radial, or parallel for short arc-length dims)
  const extLine = (a: number, span: readonly [number, number] | undefined, props: typeof c.ext1) => {
    if (inp.parallel) {
      if (!span) return;
      // span = [distance of the measured point from the arc, …] handled by the caller
      return;
    }
    if (!span) return;
    const [lo, hi] = span;
    const d = dirOf(a);
    if (r > hi) w.line(add(V, d, hi + c.exo), add(V, d, r + c.exe), props);
    else if (r < lo) w.line(add(V, d, lo - c.exo), add(V, d, r - c.exe), props);
  };
  let tip0 = onArc(a0);
  let tip1 = onArc(a1);
  let t0 = a0;
  let t1 = a1;
  if (inp.parallel && inp.ext0 && inp.ext1) {
    // orthogonal extension lines: from the measured points along the bisector direction up to the
    // dimension arc (arc-partial-nb); the arrows sit where they meet the arc
    const pd = inp.parallel;
    const hit = (o: Pt): Pt => {
      const oc = sub(o, V);
      const b = dot(oc, pd);
      const cc = dot(oc, oc) - r * r;
      const t = -b + Math.sqrt(Math.max(0, b * b - cc));
      return add(o, pd, t);
    };
    const o0 = onArc(a0, inp.ext0[0]);
    const o1 = onArc(a1, inp.ext1[0]);
    tip0 = hit(o0);
    tip1 = hit(o1);
    t0 = angleOf(sub(tip0, V));
    t1 = t0 + norm2pi(angleOf(sub(tip1, V)) - t0);
    if (!c.v.bool("DIMSE1")) w.line(add(o0, pd, c.exo), add(tip0, pd, c.exe), c.ext1);
    if (!c.v.bool("DIMSE2")) w.line(add(o1, pd, c.exo), add(tip1, pd, c.exe), c.ext2);
  } else {
    if (!c.v.bool("DIMSE1")) extLine(a0, inp.ext0, c.ext1);
    if (!c.v.bool("DIMSE2")) extLine(a1, inp.ext1, c.ext2);
  }

  // ---- text
  const tb = c.measure(inp.content);
  const am = (t0 + t1) / 2;
  const tangent = am + Math.PI / 2;
  // DIMTIH makes angular text horizontal too (sparse-dimstyle-angular: imperial DIMTIH 1)
  const rot = inp.textRotation ?? (c.v.bool("DIMTIH") && !inp.arcSymbol ? inp.horizontal : readable(tangent));
  const up = left(dirOf(rot));
  const aligned = Math.abs(Math.sin(rot - tangent)) < 1e-9;
  const tad = aligned ? c.v.num("DIMTAD") : 0;
  const tgap = c.box ? 2 * c.gap : c.gap;
  let center: Vec;
  if (inp.userText && inp.p11) center = inp.p11;
  else if (tad === 0) center = onArc(am);
  else center = add(onArc(am), up, tgap + tb.height / 2);

  // ---- arc and arrows: arrows are chords of the arc (tip and base on it, VERIFIED-BY-ACAD S1)
  // the arc ends where the arrow base (chord DIMASZ from the tip) meets it: 2·asin(asz / 2r)
  const chordAngle = (l: number) => (l > 0 ? 2 * Math.asin(Math.min(1, l / (2 * r))) : 0);
  const d0 = chordAngle(c.arrowLen(0));
  const d1 = chordAngle(c.arrowLen(1));
  const s0 = t0 + d0;
  const s1 = t1 - d1;
  const arcP = c.dim;
  const brk = tad === 0 && inp.content !== "" && !c.noText && !(inp.userText && inp.p11);
  if (brk) {
    // the arc is cut where it leaves the gap-enlarged text box (sparse-dimstyle-angular)
    const u = dirOf(rot);
    const n = left(u);
    const hw = tb.width / 2 + c.gap;
    const hh = tb.height / 2 + c.gap;
    const inBox = (a: number) => {
      const q = sub(onArc(a), center);
      return Math.abs(dot(q, u)) <= hw && Math.abs(dot(q, n)) <= hh;
    };
    const leave = (sign: 1 | -1) => {
      let lo = 0;
      let hi = Math.min(Math.PI, (2 * Math.hypot(hw, hh)) / r);
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (inBox(am + sign * mid)) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const e0 = am - leave(-1);
    const e1 = am + leave(1);
    if (e0 > s0) w.arc(V, r, norm2deg(s0), norm2deg(e0), arcP);
    if (e1 < s1) w.arc(V, r, norm2deg(e1), norm2deg(s1), arcP);
  } else w.arc(V, r, norm2deg(s0), norm2deg(s1), arcP);
  const chordArrow = (i: 0 | 1, tip: Pt, ta: number, sign: 1 | -1) => {
    const base = onArc(ta + sign * chordAngle(c.asz));
    const v = sub(tip, base);
    c.arrow(i, tip, unit(v), { cornerLeft: true });
  };
  chordArrow(0, tip0, t0, 1);
  chordArrow(1, tip1, t1, -1);
  c.writeText(center, rot, inp.content, tb);
  if (inp.arcSymbol) arcSymbol(c, center, rot, tb.width);
  if (inp.leaderTo !== undefined) {
    // arc-length leader: from the dimension arc at mid-angle to the measured arc (arc-leader-nb)
    const from = onArc(am);
    const to = onArc(am, inp.leaderTo);
    w.line(from, to, c.dim);
    c.arrow(1, to, unit(sub(to, from)), { cornerLeft: true });
  }
}

function norm2deg(a: number): number {
  return norm2pi(a) * DEG;
}

/**
 * DIMARCSYM symbol as a separate ARC (continuous linetype): 0 = before the text (radius 0.8·h,
 * centre w/2 + h left of the text centre, 0.4·h below it, 0…180°), 1 = over the text (radius
 * 1.0875·h, centre 0.0125·h above the text centre, 46.3972…133.6028°). VERIFIED-BY-ACAD
 * arc-dimarcsym-0/1-txt4/8-nb, arc-dimarcsym-0-wide-text-nb (Q-0532).
 */
function arcSymbol(c: DimCtx, center: Pt, rot: number, width: number): void {
  const mode = c.v.num("DIMARCSYM");
  if (mode === 2) return;
  const h = c.txt;
  const u = dirOf(rot);
  const n = left(u);
  const p = { color: c.text.color, linetype: "Continuous" };
  const rd = rot * DEG;
  if (mode === 1) {
    c.w.arc(add(center, n, 0.0125 * h), 1.0875 * h, rd + 46.3972, rd + 133.6028, p);
    return;
  }
  c.w.arc(add(add(center, u, -(width / 2 + h)), n, -0.4 * h), 0.8 * h, rd, rd + 180, p);
}
