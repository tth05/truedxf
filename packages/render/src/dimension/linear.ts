/**
 * Linear (rotated / horizontal / vertical) and aligned dimension layout, reconstructed from the
 * blocks AutoCAD 2027 regenerates for DIMENSIONs without `*D` block (DXFOUT re-saves of the
 * `dimensions` suite, 2026-09-30; note 05 §6.2 has the rules and case ids).
 */
import { allowsExtension } from "./arrows.ts";
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
import type { TextBox } from "./measure.ts";
import type { Pt } from "./writer.ts";

const DEG = Math.PI / 180;
const EPS = 1e-9;

export interface LinearInput {
  /** OCS points: ext line origins, dimension line point, text midpoint (11). */
  readonly p13: Pt;
  readonly p14: Pt;
  readonly p10: Pt;
  readonly p11: Pt | undefined;
  /** Dimension line direction (unit). */
  readonly d: Vec;
  readonly userText: boolean;
  /** 53 in radians, undefined = automatic. */
  readonly textRotation: number | undefined;
  /** −51 in radians: "horizontal" for DIMTIH. */
  readonly horizontal: number;
  readonly flip1: boolean;
  readonly flip2: boolean;
  readonly content: string;
  readonly below: string | undefined;
}

type Fit = { arrowsIn: boolean; textIn: boolean };

/** DIMATFIT / DIMTIX / DIMSOXD decision (VERIFIED-BY-ACAD dimensions/fit-* sheets, Q-0552). */
function fit(c: DimCtx, m: number, need: number, textFits: boolean): Fit & { suppress: boolean } {
  const asz = c.asz;
  const gap = c.gap;
  const arrowsRoom = 2 * (asz + gap);
  const both = m + EPS >= need && m + EPS >= arrowsRoom;
  const tix = c.v.bool("DIMTIX");
  const soxd = c.v.bool("DIMSOXD");
  if (both) return { arrowsIn: true, textIn: true, suppress: false };
  if (tix) return { arrowsIn: false, textIn: true, suppress: soxd };
  switch (c.v.num("DIMATFIT")) {
    case 0:
      return { arrowsIn: false, textIn: false, suppress: false };
    case 1:
      return { arrowsIn: false, textIn: textFits, suppress: false };
    case 2:
      // "text first": arrows stay inside only with room to spare (fit-atfit2-*: 10 → out, 14 → in)
      return { arrowsIn: m > arrowsRoom + EPS, textIn: false, suppress: false };
    default:
      if (textFits) return { arrowsIn: false, textIn: true, suppress: false };
      return { arrowsIn: m + EPS >= arrowsRoom, textIn: false, suppress: false };
  }
}

export function layoutLinear(c: DimCtx, inp: LinearInput): void {
  const { p13, p14, d } = inp;
  const w = c.w;
  const tmove = c.v.num("DIMTMOVE");
  // DIMTMOVE 0 with user text: the dimension line moves through the text point (dimtmove-0-*)
  const base = inp.userText && tmove === 0 && inp.p11 ? inp.p11 : inp.p10;
  const P1 = add(base, d, dot(sub(p13, base), d));
  const P2 = add(base, d, dot(sub(p14, base), d));
  const m = len(sub(P2, P1));
  const u = m > EPS ? unit(sub(P2, P1)) : d;
  const nrm = left(d);
  // extension line directions: from the origin towards the dimension line
  const ed = (o: Pt, P: Pt): Vec => {
    const v = sub(P, o);
    if (len(v) > EPS) return unit(v);
    const s = dot(sub(inp.p10, o), nrm);
    return s < 0 ? neg(nrm) : nrm;
  };
  const e1 = ed(p13, P1);
  const e2 = ed(p14, P2);

  // ---- text
  const content = inp.content;
  const tb: TextBox = c.measure(content);
  const tbBelow = inp.below !== undefined ? c.measure(inp.below) : undefined;
  const width = Math.max(tb.width, tbBelow?.width ?? 0);
  const hasText = (content !== "" || inp.below !== undefined) && !c.noText;
  const lineAngle = angleOf(d);
  let rot: number;
  if (inp.textRotation !== undefined) rot = inp.textRotation;
  else if (c.v.bool("DIMTIH")) rot = inp.horizontal;
  else rot = readable(lineAngle);
  const just = c.v.num("DIMJUST");
  const overExt = just === 3 || just === 4;
  // DIMJUST 3/4: text parallel to the extension line (dimjust-3/4-*)
  if (overExt && inp.textRotation === undefined) rot = readable(angleOf(just === 3 ? e1 : e2));
  // DIMTXTDIRECTION (code 294) 1: right-to-left, the text turned by 180° (dimtxtdirection-1-nb)
  const up = left(dirOf(rot));
  if (c.v.bool("DIMTXTDIRECTION")) rot += Math.PI;
  const aligned = Math.abs(Math.sin(rot - lineAngle)) < 1e-9 || overExt;
  let tad = c.v.num("DIMTAD");
  if (!aligned) tad = 0; // text not parallel to the line is centred on it (dimtih-1-aligned-nb)
  const tvp = c.v.num("DIMTVP");
  const breaks = hasText && (!aligned || (tad === 0 && Math.abs(tvp) < 0.7 && inp.below === undefined));
  const tgap = c.box ? 2 * c.gap : c.gap;
  const halfAlong = aligned ? width / 2 + c.gap : c.textHalfExtent(tb, rot, u);
  const textSpace = breaks ? 2 * halfAlong : width;
  const need = breaks ? 2 * (c.asz + c.gap) + textSpace : Math.max(width, 2 * (c.asz + c.gap));
  const f = hasText
    ? fit(c, m, need, m + EPS >= textSpace)
    : { ...fit(c, m, 2 * (c.asz + c.gap), true), textIn: true };
  const offset = (s: number): Vec => {
    if (tad === 0) return { x: up.x * tvp * c.txt, y: up.y * tvp * c.txt };
    let k = tgap + tb.height / 2;
    if (tad === 4) k = -k;
    else if (tad === 2 && dot(sub(p13, P1), up) + dot(sub(p14, P2), up) > 0) k = -k;
    return { x: up.x * k * s, y: up.y * k * s };
  };

  // text centre and the side of an outside text
  const outSide: 1 | 2 = just === 1 ? 1 : 2;
  const outAnchor = outSide === 1 ? P1 : P2;
  const outDir = outSide === 1 ? neg(u) : u;
  const arrowPart = (i: 0 | 1) => (f.arrowsIn || f.suppress ? 0 : c.arrowLen(i));
  let center: Vec;
  let textIn = f.textIn || overExt;
  let leader: Pt[] | undefined;
  let extUnder: { from: Pt; to: Pt } | undefined;
  if (inp.userText && inp.p11 && tmove !== 0) {
    textIn = true;
    const p = inp.p11;
    const dist = Math.abs(dot(sub(p, base), up));
    if (tmove === 1 && dist > 1.5 * (c.gap + tb.height / 2)) {
      const mid = add(P1, u, m / 2);
      const knee = add(p, u, -c.gap);
      leader = [mid, knee, add(knee, u, width + 2 * c.gap)];
      center = add(add(knee, u, c.gap + width / 2), up, c.gap + tb.height / 2);
    } else if (tmove === 1) center = add(p, up, c.gap + tb.height / 2);
    else center = p;
  } else if (overExt) {
    // DIMJUST 3/4: parallel to the extension line, DIMEXE + gap beyond the dimension line,
    // on its left side (dimjust-3/4-*)
    const P = just === 3 ? P1 : P2;
    const e = just === 3 ? e1 : e2;
    center = add(add(P, e, c.exe + c.gap + width / 2), left(e), tgap + tb.height / 2);
  } else if (textIn) {
    let s = inp.userText && inp.p11 ? dot(sub(inp.p11, P1), u) : m / 2;
    if (just === 1) s = c.asz + 2 * c.gap + width / 2;
    else if (just === 2) s = m - (c.asz + 2 * c.gap + width / 2);
    center = add(add(P1, u, s), offset(1));
  } else if (tmove === 0) {
    const s0 = arrowPart(outSide === 1 ? 0 : 1) + c.asz + c.gap;
    center = add(add(outAnchor, outDir, s0 + width / 2), offset(1));
    if (tad !== 0) extUnder = { from: outAnchor, to: add(outAnchor, outDir, s0 + width + c.gap) };
  } else {
    // text moved over the dimension line (DIMTMOVE 1 with leader, 2 without): constant offsets
    // measured in fit-tmove1/2-nb (0.4125·h along, 1.375·h up — ASSUMPTION for other sizes)
    const mid = add(P1, u, m / 2);
    const lift = add(mid, up, 1.375 * c.txt);
    if (tmove === 1) {
      const knee = add(lift, u, 0.4125 * c.txt);
      leader = [mid, knee, add(knee, u, width + 2 * c.gap)];
      center = add(add(knee, u, c.gap + width / 2), up, c.gap + tb.height / 2);
    } else center = lift;
    textIn = true;
  }
  const textOnLine = textIn && !leader && !(inp.userText && tmove === 2);
  const brk = breaks && textOnLine && !overExt;
  const tAlong = dot(sub(center, P1), u);
  // user-positioned text (DIMTMOVE 1/2) is written before the arrows (dimtmove-1/2-*)
  const textFirst = tmove !== 0 && (inp.userText || !f.textIn);
  const emitText = () => {
    if (leader) {
      w.line(leader[0]!, leader[1]!, c.dim);
      w.line(leader[1]!, leader[2]!, c.dim);
    }
    writeTexts(c, center, rot, inp, tb, tbBelow, up);
  };

  // ---- extension lines
  const fxlon = c.v.bool("DIMFXLON");
  const fxl = c.v.scaled("DIMFXL");
  const extLine = (o: Pt, P: Pt, e: Vec, extra: number, props: typeof c.ext1) => {
    const dist = dot(sub(P, o), e);
    const start = fxlon ? Math.max(c.exo, dist - fxl) : c.exo;
    w.line(add(o, e, start), add(P, e, c.exe + extra), props);
  };
  const extExtra = (i: 1 | 2) =>
    (just === 3 && i === 1) || (just === 4 && i === 2) ? c.gap + width + c.gap : 0;
  if (!c.v.bool("DIMSE1")) extLine(p13, P1, e1, extExtra(1), c.ext1);
  if (!c.v.bool("DIMSE2")) extLine(p14, P2, e2, extExtra(2), c.ext2);

  // ---- dimension line and arrows
  const sd1 = c.v.bool("DIMSD1");
  const sd2 = c.v.bool("DIMSD2");
  const dimP = c.dim;
  const l1 = c.arrowLen(0);
  const l2 = c.arrowLen(1);
  const ext1 = c.tsz > 0 || allowsExtension(c.arrowNames[0]) ? c.dle : 0;
  const ext2 = c.tsz > 0 || allowsExtension(c.arrowNames[1]) ? c.dle : 0;
  const reverse = just === 1 || just === 3;
  const at = (s: number) => add(P1, u, s);
  if (f.arrowsIn) {
    const a = inp.flip1 ? 0 : l1;
    const b = inp.flip2 ? 0 : l2;
    let s0 = a > 0 ? a : -ext1;
    let s1 = b > 0 ? m - b : m + ext2;
    if (inp.flip1) s0 = l1;
    if (inp.flip2) s1 = m - l2;
    const half = halfAlong;
    if (sd1 && sd2) {
      // both halves suppressed
    } else if (sd1 || sd2) {
      // the remaining half runs from its arrow past the text (dimsd1-*, dimsd2-nb)
      const edge = sd1 ? (brk ? tAlong + half : tAlong - half) : brk ? tAlong - half : tAlong + half;
      if (sd1) w.line(at(s1), at(Math.min(edge, s1)), dimP);
      else w.line(at(s0), at(Math.max(edge, s0)), dimP);
    } else if (brk) {
      w.line(at(reverse ? s1 : s0), at(reverse ? tAlong + half : tAlong - half), dimP);
      w.line(at(reverse ? s0 : s1), at(reverse ? tAlong - half : tAlong + half), dimP);
    } else if (reverse) w.line(at(s1), at(s0), dimP);
    else w.line(at(s0), at(s1), dimP);
    // outside text beside an inside-arrow dimension: a DIMASZ stub (TAD 0) or the line under
    // the text (TAD ≠ 0) from the extension line (fit-atfit2-*, fit-atfit3-*)
    if (!textIn && tmove === 0) {
      if (extUnder) w.line(extUnder.from, extUnder.to, dimP);
      else w.line(outAnchor, add(outAnchor, outDir, c.asz), dimP);
    }
    if (textFirst) emitText();
    if (c.tsz > 0) {
      if (!sd2) c.arrow(1, P2, u);
      if (!sd1) c.arrow(0, P1, neg(u));
    } else {
      const arrow1 = () => {
        if (sd1) return;
        if (inp.flip1) {
          c.arrow(0, P1, u);
          w.line(at(-l1), at(-l1 - c.asz), dimP);
          w.line(P1, at(l1), dimP);
        } else c.arrow(0, P1, neg(u));
      };
      const arrow2 = () => {
        if (sd2) return;
        if (inp.flip2) {
          c.arrow(1, P2, neg(u));
          w.line(at(m + l2), at(m + l2 + c.asz), dimP);
          w.line(P2, at(m - l2), dimP);
        } else c.arrow(1, P2, u);
      };
      if (reverse) {
        arrow2();
        arrow1();
      } else {
        arrow1();
        arrow2();
      }
    }
    if (textFirst) return;
  } else {
    const tofl = c.v.bool("DIMTOFL");
    const stub = (i: 0 | 1) => {
      const P = i === 0 ? P1 : P2;
      const o = i === 0 ? neg(u) : u;
      const s0 = c.arrowLen(i);
      const isTextSide = !textIn && tmove === 0 && (i === 0 ? outSide === 1 : outSide === 2);
      const end = isTextSide && extUnder ? len(sub(extUnder.to, P)) : s0 + c.asz;
      w.line(add(P, o, s0), add(P, o, end), dimP);
    };
    if (!f.suppress) {
      if (!sd1) stub(0);
      if (!sd2) stub(1);
    }
    const inner = () => {
      if (brk) {
        w.line(P1, at(tAlong - halfAlong), dimP);
        w.line(P2, at(tAlong + halfAlong), dimP);
      } else w.line(P1, P2, dimP);
    };
    const innerLine = tofl || textOnLine || f.suppress;
    // DIMTMOVE 1/2: AutoCAD writes the text (and leader) before the inner line (fit-tmove*-nb)
    const late = tmove !== 0 && !f.textIn;
    if (innerLine && !late) inner();
    if (late) {
      if (leader) {
        w.line(leader[0]!, leader[1]!, dimP);
        w.line(leader[1]!, leader[2]!, dimP);
      }
      writeTexts(c, center, rot, inp, tb, tbBelow, up);
      if (innerLine) inner();
      if (leader && innerLine) inner();
      leader = undefined;
    }
    if (!f.suppress) {
      if (!sd1) c.arrow(0, P1, u);
      if (!sd2) c.arrow(1, P2, neg(u));
    }
    if (late) return;
  }
  emitText();
}

function writeTexts(
  c: DimCtx,
  center: Pt,
  rot: number,
  inp: LinearInput,
  tb: TextBox,
  tbBelow: TextBox | undefined,
  up: Vec,
): void {
  if (inp.below !== undefined && tbBelow) {
    // `\X`: first part above, second below the line (text-override-split-nb)
    const k = c.gap + tb.height / 2;
    const base = add(center, up, -(c.gap + tb.height / 2));
    c.writeText(add(base, up, k), rot, inp.content, tb);
    c.writeText(add(base, up, -(c.gap + tbBelow.height / 2)), rot, inp.below, tbBelow);
    return;
  }
  c.writeText(center, rot, inp.content, tb);
}

export { DEG };
