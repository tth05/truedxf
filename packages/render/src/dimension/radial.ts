/**
 * Radius, diameter and jogged-radius (LARGE_RADIAL_DIMENSION) layout as AutoCAD 2027 regenerates
 * it (DXFOUT re-saves of the `dimensions` suite: type-radius/diameter/jogged-*, radius-*,
 * diameter-*, hdir-radius-*; note 05 §6.3).
 */
import {
  add,
  angleOf,
  type DimCtx,
  dirOf,
  dot,
  left,
  len,
  neg,
  readable,
  sub,
  unit,
  type Vec,
} from "./context.ts";
import type { Pt } from "./writer.ts";

export interface RadialInput {
  /** Centre (radius: 10, diameter: midpoint of 10–15). */
  readonly C: Pt;
  /** Point on the curve with the arrow (15). */
  readonly P: Pt;
  /** Diameter: the opposite point (10). */
  readonly Q: Pt | undefined;
  readonly p11: Pt | undefined;
  readonly userText: boolean;
  readonly textRotation: number | undefined;
  readonly horizontal: number;
  readonly content: string;
}

/**
 * Centre mark (DIMCEN × DIMSCALE, drawn when the dimension line is not drawn to the centre):
 * a cross ±|DIMCEN|, for DIMCEN < 0 also centre lines from 2·|DIMCEN| to r + |DIMCEN|, in the
 * extension line colour. VERIFIED-BY-ACAD radius-dimtofl-0-nb, diameter-dimcen-*-colors-nb,
 * radius-dimcen-dimscale-nb (Q-0548, Q-0549).
 */
function centerMark(c: DimCtx, C: Pt, r: number): void {
  const cen = c.v.scaled("DIMCEN");
  if (cen === 0) return;
  const a = Math.abs(cen);
  const p = { color: c.ext1.color, lineweight: c.ext1.lineweight };
  const w = c.w;
  w.line({ x: C.x - a, y: C.y }, { x: C.x + a, y: C.y }, p);
  w.line({ x: C.x, y: C.y - a }, { x: C.x, y: C.y + a }, p);
  if (cen < 0) {
    w.line({ x: C.x - 2 * a, y: C.y }, { x: C.x - r - a, y: C.y }, p);
    w.line({ x: C.x + 2 * a, y: C.y }, { x: C.x + r + a, y: C.y }, p);
    w.line({ x: C.x, y: C.y - 2 * a }, { x: C.x, y: C.y - r - a }, p);
    w.line({ x: C.x, y: C.y + 2 * a }, { x: C.x, y: C.y + r + a }, p);
  }
}

export function layoutRadial(c: DimCtx, inp: RadialInput): void {
  const { C, P, Q } = inp;
  const w = c.w;
  const rv = sub(P, C);
  const r = len(rv);
  const rh = unit(rv);
  const diameter = Q !== undefined;
  const tb = c.measure(inp.content);
  const tw = tb.width;
  const tmove = c.v.num("DIMTMOVE");
  const tofl = c.v.bool("DIMTOFL");
  const tad = c.v.num("DIMTAD");
  const tgap = c.box ? 2 * c.gap : c.gap;
  const aL = c.arrowLen(1);
  const dimP = c.dim;
  const at = (s: number) => add(C, rh, s);
  const baseOut = at(r + aL);
  const baseIn = at(r - aL);
  const user = inp.userText && inp.p11 !== undefined;
  const s11 = user ? dot(sub(inp.p11!, C), rh) : 0;
  const inside = user && tmove !== 2 && s11 < r;
  // text orientation: TOH (outside) / TIH (inside) → horizontal (hdir-radius-*), else radial
  let rot: number;
  const horizontal = inside ? c.v.bool("DIMTIH") : c.v.bool("DIMTOH");
  if (inp.textRotation !== undefined) rot = inp.textRotation;
  else if (horizontal && !(user && tmove === 2)) rot = inp.horizontal;
  else rot = readable(angleOf(rh));
  const aligned = Math.abs(Math.sin(rot - angleOf(rh))) < 1e-9;
  const up = left(dirOf(rot));
  const lift = (p: Pt) => (tad === 0 ? p : add(p, up, tgap + tb.height / 2));
  const arrowOut = () => c.arrow(1, P, neg(rh));
  const arrowIn = () => c.arrow(1, P, rh);

  if (user && tmove === 2) {
    // text free at 11; the dimension line runs inside to the arrow (broken where the text sits on it)
    const p = inp.p11!;
    const onLine = Math.abs(dot(sub(p, C), left(rh))) < tb.height / 2 + c.gap;
    if (diameter) {
      const qBase = add(Q, rh, c.arrowLen(0));
      w.line(qBase, baseIn, dimP);
      c.writeText(p, rot, inp.content, tb);
      c.arrow(0, Q, neg(rh));
      arrowIn();
      return;
    }
    const half = c.textHalfExtent(tb, rot, rh);
    if (onLine && s11 - half > 0 && s11 + half < r - aL) {
      w.line(C, at(s11 - half), dimP);
      w.line(baseIn, at(s11 + half), dimP);
    } else w.line(C, baseIn, dimP);
    c.writeText(p, rot, inp.content, tb);
    arrowIn();
    return;
  }

  if (inside) {
    // text moved inside the circle: one line from the text to the arrow, arrow inside, and for
    // diameters no second arrow (radius-/diameter-moved-inside-tmove0/1-nb)
    const center = lift(at(s11));
    w.line(at(s11 - tw / 2 - c.gap), baseIn, dimP);
    c.writeText(center, rot, inp.content, tb);
    arrowIn();
    return;
  }
  if (user && diameter && s11 < 0) {
    // diameter text beyond the opposite point: one line through the circle (diameter-moved-outside-*)
    const center = lift(at(s11));
    w.line(at(s11 - tw / 2 - c.gap), baseIn, dimP);
    c.writeText(center, rot, inp.content, tb);
    arrowIn();
    return;
  }

  // text outside beyond P: leader from the arrow base (default placement and moved-outside)
  const s0 = user ? s11 - tw / 2 : r + aL + c.asz + c.gap;
  let center: Vec;
  if (!aligned) {
    // the landing starts DIMASZ (diameter: 2·DIMASZ) beyond the arrow base (radius-dimtoh-1-nb,
    // diameter-dimtoh-1-nb, hdir-radius-30-nb)
    const knee = add(baseOut, rh, diameter ? 2 * c.asz : c.asz);
    let h = dirOf(rot);
    if (dot(h, rh) < 0) h = neg(h);
    const end = add(knee, h, tw + c.gap);
    center = lift(add(knee, h, c.gap + tw / 2));
    w.line(end, knee, dimP);
    w.line(knee, baseOut, dimP);
  } else {
    center = lift(at(s0 + tw / 2));
    w.line(tad === 0 ? at(s0 - c.gap) : at(s0 + tw + c.gap), baseOut, dimP);
  }
  if (diameter && tofl) {
    const qb = add(Q, rh, -c.arrowLen(0));
    w.line(qb, add(qb, rh, -c.asz), dimP);
  }
  c.writeText(center, rot, inp.content, tb);
  if (diameter) {
    if (tofl) {
      w.line(Q, P, dimP);
      c.arrow(0, Q, rh);
      arrowOut();
    } else {
      arrowOut();
      centerMark(c, C, r);
    }
    return;
  }
  if (tofl) {
    w.line(C, P, dimP);
    arrowOut();
  } else {
    arrowOut();
    centerMark(c, C, r);
  }
}

export interface JoggedInput {
  /** True centre (10). */
  readonly C: Pt;
  /** Override centre = start of the dimension line (13). */
  readonly start: Pt;
  /** Jog location (14). */
  readonly jog: Pt;
  /** Point on the arc with the arrow (15). */
  readonly P: Pt;
  readonly content: string;
  readonly textRotation: number | undefined;
  readonly horizontal: number;
}

/**
 * Jogged radius: 13 → A, A → B through the jog point 14 at DIMJOGANG to the radial line, B → the
 * arrow at 15 along the true radial line 10 → 15 (B = intersection of the jog line with it,
 * A = 2·14 − B). VERIFIED-BY-ACAD type-jogged-*, jogged-swapped-13-15-nb, jogged-dimjogang-30-nb:
 * AutoCAD reads 13 = override centre, 14 = jog point, 15 = chord point (Q-0526, Q-0527).
 */
export function layoutJogged(c: DimCtx, inp: JoggedInput): void {
  const w = c.w;
  const rh = unit(sub(inp.P, inp.C));
  let jang = c.v.num("DIMJOGANG");
  // degrees, also small values (0.5236 → 0.5236°, jogged-dimjogang-rad-nb); 90° and more fall
  // back to 45° (jogged-dimjogang-90-nb)
  if (!(jang > 0 && jang < 90 - 1e-9)) jang = 45;
  // the jog turns towards the side of the start point (jogged-swapped-13-15-nb)
  const side = rh.x * (inp.start.y - inp.C.y) - rh.y * (inp.start.x - inp.C.x) >= 0 ? 1 : -1;
  const a = angleOf(rh) + (side * jang * Math.PI) / 180;
  const jd = dirOf(a);
  // B: jog line (through 14 along jd) ∩ radial line (through C along rh)
  const denom = jd.x * rh.y - jd.y * rh.x;
  const d = sub(inp.C, inp.jog);
  const t = Math.abs(denom) > 1e-12 ? (d.x * rh.y - d.y * rh.x) / denom : 0;
  const B = add(inp.jog, jd, t);
  const A = { x: 2 * inp.jog.x - B.x, y: 2 * inp.jog.y - B.y };
  const aL = c.arrowLen(1);
  // the arrow points from B to 15, backwards when B lies beyond the arc (jogged-dimjogang-rad-nb)
  const ad = unit(sub(inp.P, B), rh);
  const base = add(inp.P, ad, -aL);
  const tb = c.measure(inp.content);
  const rot = inp.textRotation ?? (c.v.bool("DIMTIH") ? inp.horizontal : readable(angleOf(rh)));
  const up = left(dirOf(rot));
  // the text sits midway between B and the arrow base (type-jogged-*, sparse-dimstyle-jogged)
  const mid = add(B, sub(base, B), 0.5);
  const aligned = Math.abs(Math.sin(rot - angleOf(rh))) < 1e-9;
  const tad = aligned ? c.v.num("DIMTAD") : 0;
  const center = tad === 0 ? mid : add(mid, up, (c.box ? 2 : 1) * c.gap + tb.height / 2);
  w.line(inp.start, A, c.dim);
  w.line(A, B, c.dim);
  if (tad === 0 && inp.content !== "" && !c.noText) {
    const half = c.textHalfExtent(tb, rot, rh);
    w.line(add(mid, rh, -half), B, c.dim);
    w.line(base, add(mid, rh, half), c.dim);
  } else w.line(B, base, c.dim);
  c.arrow(1, inp.P, ad);
  c.writeText(center, rot, inp.content, tb);
}
