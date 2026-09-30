/**
 * Regeneration of dimension geometry blocks for DIMENSIONs without a usable `*D` block
 * (note 05 §4.2, §6). AutoCAD regenerates such dimensions on load; the generator rebuilds the
 * block the way AutoCAD's regenerated blocks look in the DXFOUT re-saves of the `dimensions`
 * suite and returns its entities in the dimension's OCS.
 */
import { type Matrix44, type Vec3, wcsToOcsMatrix } from "@truedxf/geometry";
import type { DimensionEntity, Entity } from "@truedxf/model";
import { DimCtx, dirOf, type GenInput, sub, unit } from "./context.ts";
import { dimensionText } from "./format.ts";
import { layoutLinear } from "./linear.ts";
import { DimStyleVars } from "./vars.ts";
import { EntityWriter, type Pt } from "./writer.ts";

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
  const toOcs = wcsToOcsMatrix(dim.extrusion);
  const z = dim.textMidpoint?.z ?? toOcs.transformPoint(dim.defPoint).z;
  const w = new EntityWriter(dim.layer, z, dim.linetypeScale);
  const c = new DimCtx({ ...input, lineweight: dim.lineweight }, v, w);
  const p10 = to2(toOcs, dim.defPoint)!;
  const p11 = dim.textMidpoint ? { x: dim.textMidpoint.x, y: dim.textMidpoint.y } : undefined;
  const p13 = to2(toOcs, dim.defPoint2);
  const p14 = to2(toOcs, dim.defPoint3);
  const common = {
    p10,
    p11,
    userText: dim.userTextPosition,
    textRotation: dim.textRotation !== undefined ? dim.textRotation * DEG : undefined,
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
    default:
      return undefined;
  }
  return w.build();
}
