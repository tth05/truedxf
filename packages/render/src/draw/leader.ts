/**
 * LEADER (research/notes/05-dimensions-leaders.md §11): the stored vertices as straight segments
 * or a fit-point spline, the DIMLDRBLK arrowhead and the unstored extension under MTEXT
 * annotations. Parts are built like dimension block content (dimension/writer.ts) and drawn
 * as content of the LEADER, so BYBLOCK resolves to the entity.
 */
import { ocsToWcsMatrix, wcsToOcsMatrix } from "@truedxf/geometry";
import type { LeaderEntity, MTextEntity } from "@truedxf/model";
import { arrowLength } from "../dimension/arrows.ts";
import { add, DimCtx, len, sub, unit, type Vec } from "../dimension/context.ts";
import { DimStyleVars } from "../dimension/vars.ts";
import { EntityWriter, type Pt } from "../dimension/writer.ts";
import { type DrawState, type Frontend, registerDrawer } from "../frontend.ts";
import { annotationFonts, drawGenerated, syntheticBlock } from "./dimension.ts";

function leaderEntities(fe: Frontend, ld: LeaderEntity) {
  const doc = fe.doc;
  const v = new DimStyleVars(doc, ld.dimStyle, ld.overrides);
  const toOcs = wcsToOcsMatrix(ld.normal);
  const pts: Vec[] = ld.vertices.map((p) => {
    const q = toOcs.transformPoint(p);
    return { x: q.x, y: q.y };
  });
  if (pts.length < 2) return undefined;
  const z = toOcs.transformPoint(ld.vertices[0]!).z;
  const w = new EntityWriter(ld.layer, z, ld.linetypeScale);
  const c = new DimCtx({ doc, fonts: annotationFonts(doc), lineweight: ld.lineweight }, v, w);
  // group 77 is ignored: DIMCLRD BYBLOCK shows the entity colour (VERIFIED-BY-ACAD
  // leaders/leader-77-color-*, Q-0588)
  const props = c.dim;
  const hd = toOcs.transformDirection(ld.horizontalDirection);
  let h = unit({ x: hd.x, y: hd.y });
  if (ld.hookDirection === 1) h = { x: -h.x, y: -h.y };
  const annotation = ld.annotationHandle ? doc.getEntity(ld.annotationHandle) : undefined;
  const mtext =
    ld.creationFlag === 0 && annotation?.type === "MTEXT" ? (annotation as MTextEntity) : undefined;
  // text annotation without a stored hook: AutoCAD adds the hook vertex DIMASZ before the end
  // (VERIFIED-BY-ACAD leaders/leader-hookflag-no-hook-vertex: DXFOUT gains 95,90 and 75 = 1)
  if (mtext && pts.length >= 2) {
    const last = pts[pts.length - 1]!;
    const prev = pts[pts.length - 2]!;
    const seg = unit(sub(last, prev));
    if (Math.abs(seg.x * h.y - seg.y * h.x) > 1e-9) pts.splice(pts.length - 1, 0, add(last, h, -c.asz));
  }
  // extension under the text (not stored): DIMGAP + text width from the last vertex along 211
  // (reversed by 74 = 1) when the text is above the line, even back over a stored hook
  // (VERIFIED-BY-ACAD leaders/leader-hook-211px/mx-74-*; note 05 §11.2 step 4)
  if (mtext && v.num("DIMTAD") !== 0 && ld.textWidth > 0) {
    const last = pts[pts.length - 1]!;
    pts.push(add(last, h, c.gap + ld.textWidth));
  }
  // arrowhead: DIMLDRBLK at vertex 0, omitted when the first segment is shorter than twice the
  // arrow size; the first segment starts at the arrow base
  const arrowName = v.arrow("DIMLDRBLK");
  const first = len(sub(pts[1]!, pts[0]!));
  const drawArrow = ld.arrowhead && first >= 2 * c.asz - 1e-9;
  const dir0 = unit(sub(pts[0]!, pts[1]!));
  const line = [...pts];
  if (drawArrow) line[0] = add(pts[0]!, dir0, -arrowLength(arrowName) * c.asz);
  if (ld.pathType === 1 && line.length > 2) {
    const n = line.length;
    w.splineFit(line, unit(sub(line[1]!, line[0]!)), unit(sub(line[n - 1]!, line[n - 2]!)), props);
  } else {
    for (let k = 0; k + 1 < line.length; k++) w.line(line[k]!, line[k + 1]!, props);
  }
  if (drawArrow) c.arrowNamed(arrowName, pts[0]!, dir0, c.asz);
  return w.build();
}

registerDrawer("LEADER", (fe, e, st: DrawState) => {
  const ld = e as LeaderEntity;
  let cache = fe.caches.get("leader:generated") as
    | Map<LeaderEntity, ReturnType<typeof leaderEntities>>
    | undefined;
  if (!cache) {
    cache = new Map();
    fe.caches.set("leader:generated", cache);
  }
  let ents = cache.get(ld);
  if (!cache.has(ld)) {
    ents = leaderEntities(fe, ld);
    cache.set(ld, ents);
  }
  if (!ents || ents.length === 0) return;
  drawGenerated(fe, syntheticBlock(`*L~${ld.handle || ld.id}`, ents), ocsToWcsMatrix(ld.normal), e, st);
});

export type { Pt };
