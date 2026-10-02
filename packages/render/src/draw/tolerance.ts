/**
 * TOLERANCE (feature control frame, research/notes/05-dimensions-leaders.md §13). There is no
 * stored geometry: rows (`^J`) of fields (`%%v`) are laid out left to right, each field a cell of
 * its text width + t (t = DIMTXT·DIMSCALE), rows 2·t high stacked downwards from the insertion
 * point (the middle of row 1's left edge). VERIFIED-BY-ACAD leaders/tol-* (frame rows ±t, cell =
 * width + t, DIMGAP unused, empty rows keep their place).
 */
import { ocsToWcsMatrix, wcsToOcsMatrix } from "@truedxf/geometry";
import type { ToleranceEntity } from "@truedxf/model";
import { BlockBuilder } from "../dimension/block-builder.ts";
import { add, angleOf, DimCtx, dirOf, left, type Vec } from "../dimension/context.ts";
import { DimStyleVars } from "../dimension/vars.ts";
import { type DrawState, type Frontend, registerDrawer } from "../frontend.ts";
import { annotationFonts, drawGenerated, syntheticBlock } from "./dimension.ts";

function toleranceEntities(fe: Frontend, tol: ToleranceEntity) {
  const doc = fe.doc;
  const v = new DimStyleVars(doc, tol.dimStyle, tol.overrides);
  const toOcs = wcsToOcsMatrix(tol.extrusion);
  const ins = toOcs.transformPoint(tol.insert);
  const dx = toOcs.transformDirection(tol.direction);
  const w = new BlockBuilder(tol.layer, ins.z, tol.linetypeScale);
  const c = new DimCtx({ doc, fonts: annotationFonts(doc), lineweight: tol.lineweight }, v, w);
  const t = v.scaled("DIMTXT");
  const rot = Math.hypot(dx.x, dx.y) > 1e-12 ? angleOf(dx) : 0;
  const u = dirOf(rot);
  const n = left(u);
  const P = (x: number, y: number): Vec => add(add({ x: ins.x, y: ins.y }, u, x), n, y);
  const frame = { color: c.dim.color, lineweight: c.dim.lineweight };
  const L = (x0: number, y0: number, x1: number, y1: number) => w.line(P(x0, y0), P(x1, y1), frame);
  const rows = tol.text.split("^J").map((r) => r.split("%%v"));
  const texts: { x: number; y: number; s: string }[] = [];
  // rows sharing the first field (composite) are drawn separately, not merged
  // (VERIFIED-BY-ACAD leaders/tol-composite, Q-0604)
  rows.forEach((fields, k) => {
    const yc = -2 * t * k;
    const cells: { x0: number; x1: number }[] = [];
    let x = 0;
    fields.forEach((f, _i) => {
      if (f === "") return;
      const tw = c.measure(f).width;
      texts.push({ x: x + t / 2, y: yc, s: f });
      cells.push({ x0: x, x1: x + tw + t });
      x += tw + t;
    });
    if (cells.length === 0) {
      // an empty row still draws its top and bottom edge, t long (tol-datum-only)
      L(0, yc + t, t, yc + t);
      L(0, yc - t, t, yc - t);
      return;
    }
    const x1 = cells[cells.length - 1]!.x1;
    L(0, yc + t, x1, yc + t);
    L(0, yc - t, x1, yc - t);
    L(0, yc + t, 0, yc - t);
    for (const cell of cells) L(cell.x1, yc + t, cell.x1, yc - t);
  });
  for (const tx of texts) {
    // MTEXT middle-left at the cell's text origin
    w.mtext(P(tx.x, tx.y), t, tx.s, c.style, rot, c.text, { attachment: 4 });
  }
  return w.build();
}

registerDrawer("TOLERANCE", (fe, e, st: DrawState) => {
  const tol = e as ToleranceEntity;
  let cache = fe.caches.get("tolerance:generated") as
    | Map<ToleranceEntity, ReturnType<typeof toleranceEntities>>
    | undefined;
  if (!cache) {
    cache = new Map();
    fe.caches.set("tolerance:generated", cache);
  }
  if (!cache.has(tol)) cache.set(tol, toleranceEntities(fe, tol));
  const ents = cache.get(tol);
  if (!ents || ents.length === 0) return;
  drawGenerated(fe, syntheticBlock(`*T~${tol.handle || tol.id}`, ents), ocsToWcsMatrix(tol.extrusion), e, st);
});
