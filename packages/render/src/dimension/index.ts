/**
 * Regeneration of dimension geometry blocks for DIMENSIONs without a usable `*D` block
 * (note 05 §4.2, §6). AutoCAD regenerates such dimensions on load; the generator rebuilds the
 * block the way AutoCAD's regenerated blocks look in the DXFOUT re-saves of the `dimensions`
 * suite and returns its entities in the dimension's OCS.
 */
import { type Matrix44, type Vec3, wcsToOcsMatrix } from "@truedxf/geometry";
import type { DimensionEntity, Entity } from "@truedxf/model";
import { layoutAngular } from "./angular.ts";
import { BlockBuilder, type Pt } from "./block-builder.ts";
import {
  angleOf,
  DimCtx,
  dirOf,
  dot,
  type GenInput,
  left,
  len,
  norm2pi,
  sub,
  unit,
  type Vec,
} from "./context.ts";
import { dimensionText } from "./format.ts";
import { layoutLinear } from "./linear.ts";
import { layoutOrdinate } from "./ordinate.ts";
import { layoutJogged, layoutRadial } from "./radial.ts";
import { DimStyleVars } from "./vars.ts";

export type { GenInput } from "./context.ts";
export { DimStyleVars } from "./vars.ts";

const DEG = Math.PI / 180;

function to2(m: Matrix44, p: Vec3 | undefined): Pt | undefined {
  if (!p) return undefined;
  const q = m.transformPoint(p);
  return { x: q.x, y: q.y };
}

/** Entities of the regenerated block, in the dimension's OCS (undefined = not supported). */
export function generateDimension(input: GenInput, dim: DimensionEntity): Entity[] | undefined {
  const v = new DimStyleVars(input.doc, dim.dimStyle, dim.overrides);
  v.paperSpace = input.paperSpace ?? dim.paperSpace;
  const toOcs = wcsToOcsMatrix(dim.extrusion);
  const z = dim.textMidpoint?.z ?? toOcs.transformPoint(dim.defPoint).z;
  const w = new BlockBuilder(dim.layer, z, dim.linetypeScale);
  const c = new DimCtx({ ...input, lineweight: dim.lineweight }, v, w);
  const p10 = to2(toOcs, dim.defPoint)!;
  const p11 = dim.textMidpoint ? { x: dim.textMidpoint.x, y: dim.textMidpoint.y } : undefined;
  const p13 = to2(toOcs, dim.defPoint2);
  const p14 = to2(toOcs, dim.defPoint3);
  const common = {
    p10,
    p11,
    userText: dim.userTextPosition,
    // 53 = 0 is automatic orientation, like absent (vagran__dxf-viewer issue-80 DIMBLK.dxf:
    // vertical DIMTIH 0 dimension written with 53 0.0, AutoCAD aligns the text; note 05 §1.6)
    textRotation: dim.textRotation ? dim.textRotation * DEG : undefined,
    horizontal: -dim.horizontalDirection * DEG,
    flip1: dim.flipArrow1,
    flip2: dim.flipArrow2,
  };
  switch (dim.subtype) {
    case "linear":
    case "aligned": {
      if (!p13 || !p14) return undefined;
      const d = dim.subtype === "aligned" ? unit(sub(p14, p13)) : dirOf(dim.angle * DEG);
      const m = Math.abs((p14.x - p13.x) * d.x + (p14.y - p13.y) * d.y);
      const t = dimensionText(v, dim.textOverride, m, "linear");
      layoutLinear(c, { ...common, p13, p14, d, content: t.content, below: t.below });
      break;
    }
    case "radius":
    case "diameter": {
      const P = to2(toOcs, dim.defPoint4);
      if (!P) return undefined;
      const diameter = dim.subtype === "diameter";
      const C = diameter ? { x: (p10.x + P.x) / 2, y: (p10.y + P.y) / 2 } : p10;
      const m = diameter ? len(sub(P, p10)) : len(sub(P, C));
      // AutoCAD writes the diameter sign as U+2205 (S1 *D11, type-diameter-nb)
      const t = dimensionText(v, dim.textOverride, m, "linear", diameter ? "∅" : "R");
      layoutRadial(c, { ...common, C, P, Q: diameter ? p10 : undefined, content: t.content });
      break;
    }
    case "largeRadial": {
      const P = to2(toOcs, dim.defPoint4);
      if (!p13 || !p14 || !P) return undefined;
      const t = dimensionText(v, dim.textOverride, len(sub(P, p10)), "linear", "R");
      layoutJogged(c, { ...common, C: p10, start: p13, jog: p14, P, content: t.content });
      break;
    }
    case "angular":
    case "angular3p": {
      const a = angularGeometry(dim, toOcs, p10, p13, p14);
      if (!a) return undefined;
      const t = dimensionText(v, dim.textOverride, a.a1 - a.a0, "angular");
      layoutAngular(c, { ...common, ...a, content: t.content });
      break;
    }
    case "arc": {
      const V = to2(toOcs, dim.defPoint4);
      if (!V || !p13 || !p14) return undefined;
      const r = len(sub(p10, V));
      const mr = len(sub(p13, V));
      let a0 = angleOf(sub(p13, V));
      let a1 = angleOf(sub(p14, V));
      if (dim.arcEnd !== dim.arcStart) {
        a0 = dim.arcStart;
        a1 = dim.arcEnd;
      }
      const sweep = norm2pi(a1 - a0) || Math.PI * 2;
      const t = dimensionText(v, dim.textOverride, mr * sweep, "linear");
      // orthogonal extension lines only for included angles below 90° (arc-partial-nb)
      const parallel: Vec | undefined = sweep < Math.PI / 2 ? dirOf(a0 + sweep / 2) : undefined;
      layoutAngular(c, {
        ...common,
        V,
        r,
        a0,
        a1: a0 + sweep,
        ext0: [mr, mr],
        ext1: [mr, mr],
        content: t.content,
        arcSymbol: true,
        parallel,
        // the leader is drawn only for full arcs, at mid-angle (arc-leader-nb, arc-partial-leader-nb)
        leaderTo: dim.hasLeader && !dim.isPartial ? mr : undefined,
      });
      break;
    }
    case "ordinate": {
      if (!p13 || !p14) return undefined;
      const axis = -dim.horizontalDirection * DEG;
      const xl = dirOf(axis);
      const rel = sub(p13, p10);
      const m = Math.abs(dim.ordinateX ? dot(rel, xl) : dot(rel, left(xl)));
      const t = dimensionText(v, dim.textOverride, m, "linear");
      layoutOrdinate(c, {
        origin: p10,
        feature: p13,
        leaderEnd: p14,
        xType: dim.ordinateX,
        axis,
        content: t.content,
        textRotation: common.textRotation,
      });
      break;
    }
    default:
      return undefined;
  }
  return w.build();
}

interface AngularGeometry {
  V: Pt;
  a0: number;
  a1: number;
  r: number;
  ext0: [number, number] | undefined;
  ext1: [number, number] | undefined;
}

function span(V: Pt, d: Vec, a: Pt, b: Pt): [number, number] {
  const ta = dot(sub(a, V), d);
  const tb = dot(sub(b, V), d);
  return [Math.max(0, Math.min(ta, tb)), Math.max(0, ta, tb)];
}

/**
 * Vertex, measured sector and extension-line spans of an angular dimension. 2-line: lines 13–14
 * and 15–10, the sector containing 16 (VERIFIED-BY-ACAD angular2l-sector-1…4-nb, Q-0528);
 * 3-point: vertex 15, rays to 13 and 14, the sector containing the arc point 10.
 */
function angularGeometry(
  dim: DimensionEntity,
  toOcs: Matrix44,
  p10: Pt,
  p13: Pt | undefined,
  p14: Pt | undefined,
): AngularGeometry | undefined {
  const p15 = to2(toOcs, dim.defPoint4);
  if (!p13 || !p14 || !p15) return undefined;
  if (dim.subtype === "angular3p") {
    const V = p15;
    const r = len(sub(p10, V));
    const b13 = angleOf(sub(p13, V));
    const b14 = angleOf(sub(p14, V));
    const a10 = angleOf(sub(p10, V));
    const in13 = norm2pi(a10 - b13) <= norm2pi(b14 - b13);
    const [a0, e0, a1, e1] = in13 ? [b13, p13, b14, p14] : [b14, p14, b13, p13];
    const s0 = len(sub(e0, V));
    const s1 = len(sub(e1, V));
    return { V, a0, a1: a0 + norm2pi(a1 - a0), r, ext0: [s0, s0], ext1: [s1, s1] };
  }
  const p16 = dim.defPoint5 ? { x: dim.defPoint5.x, y: dim.defPoint5.y } : p10;
  const d1 = unit(sub(p14, p13));
  const d2 = unit(sub(p10, p15));
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-12) return undefined;
  const q = sub(p15, p13);
  const t = (q.x * d2.y - q.y * d2.x) / den;
  const V = { x: p13.x + d1.x * t, y: p13.y + d1.y * t };
  const qa = sub(p16, V);
  // q = α·d1 + β·d2: the signs select the rays bounding the sector with 16
  const alpha = (qa.x * d2.y - qa.y * d2.x) / den;
  const beta = (d1.x * qa.y - d1.y * qa.x) / den;
  const r1 = alpha >= 0 ? d1 : { x: -d1.x, y: -d1.y };
  const r2 = beta >= 0 ? d2 : { x: -d2.x, y: -d2.y };
  const e1 = span(V, r1, p13, p14);
  const e2 = span(V, r2, p15, p10);
  const cross = r1.x * r2.y - r1.y * r2.x;
  const [ra, ea, rb, eb] = cross >= 0 ? [r1, e1, r2, e2] : [r2, e2, r1, e1];
  const a0 = angleOf(ra);
  const a1 = a0 + norm2pi(angleOf(rb) - a0);
  return { V, a0, a1, r: len(qa), ext0: ea, ext1: eb };
}
