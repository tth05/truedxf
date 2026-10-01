/**
 * Small drawers: HELIX (its stored spline), LIGHT (never plotted), OLE2FRAME and underlays
 * (frame only; the content needs an OLE / PDF renderer).
 */
import {
  buildSplineCurve,
  lineSegment,
  ocsToWcsMatrix,
  type PathSegment,
  projectCurve3,
} from "@truedxf/geometry";
import {
  type DxfDocument,
  dictionaryVariables,
  type HelixEntity,
  type Ole2FrameEntity,
  type UnderlayDefinitionObject,
  type UnderlayEntity,
} from "@truedxf/model";
import { type RenderEnv, registerDrawer, registerPreparer } from "../frontend.ts";

// HELIX carries its geometry as a SPLINE (note 03 §3.13)
registerDrawer("HELIX", (fe, ent, st) => {
  const s = ent as HelixEntity;
  const res = buildSplineCurve({
    degree: s.degree,
    flags: s.flags,
    knots: s.knots,
    controlPoints: s.controlPoints,
    weights: s.weights,
    fitPoints: s.fitPoints,
    startTangent: s.startTangent,
    endTangent: s.endTangent,
  });
  if (!res.curve) {
    fe.note("helix-invalid");
    return;
  }
  fe.strokePath(
    { subpaths: [projectCurve3({ kind: "nurbs", curve: res.curve }, st.m)] },
    fe.resolve(s, st),
    s,
    st,
  );
});

// Light glyphs are display aids: AutoCAD plots nothing for LIGHT, whatever its plot-glyph flag
// (misc/light-point-glyph-0/-1, light-spot; VERIFIED-BY-ACAD 2026-09-30).
registerDrawer("LIGHT", () => {});

function closedPolygon(pts: { x: number; y: number }[]): PathSegment[] {
  const segs: PathSegment[] = [];
  for (let i = 0; i < pts.length; i++) segs.push(lineSegment(pts[i]!, pts[(i + 1) % pts.length]!));
  return segs;
}

// OLE2FRAME: frame of the 10/11 corners (UNVERIFIED; the presentation stream is not decoded)
registerDrawer("OLE2FRAME", (fe, ent, st) => {
  const e = ent as Ole2FrameEntity;
  const ul = e.upperLeft;
  const lr = e.lowerRight;
  const corners = [
    { x: ul.x, y: lr.y, z: ul.z },
    { x: lr.x, y: lr.y, z: ul.z },
    { x: lr.x, y: ul.y, z: ul.z },
    { x: ul.x, y: ul.y, z: ul.z },
  ].map((p) => st.m.transformPoint(p));
  fe.note("ole2frame-content");
  fe.strokePath({ subpaths: [{ segments: closedPolygon(corners), closed: true }] }, fe.resolve(e, st), e, st);
});

// PDF / DWF / DGN underlays (note 07 §10, §8.5): frame only, the content is not rendered.
// VERIFIED-BY-ACAD (images/pdf-*, 2026-09-30): 1 PDF inch = 1 drawing unit at scale 1, whatever
// INSUNITS (pdf-natural-mm); with 280 bit 2 (on) cleared only the frame plots (pdf-flags-off);
// PDFFRAME comes from the DICTIONARYVAR (1 or absent: frame, 0 / 2: none, pdfframe-dictvar-*);
// the frame is the page rectangle (MediaBox), or the clip boundary when clipping.
const PAGE = new WeakMap<DxfDocument, Map<string, { w: number; h: number } | null>>();
const PAGE_LOADER = new WeakMap<DxfDocument, RenderEnv["loadImage"]>();

registerPreparer(async (doc, env) => {
  if (!env.loadImage) return;
  // valid for one loader: a new loader (files added in a viewer) looks the files up again
  let map = PAGE_LOADER.get(doc) === env.loadImage ? PAGE.get(doc) : undefined;
  if (!map) {
    PAGE.set(doc, (map = new Map()));
    PAGE_LOADER.set(doc, env.loadImage);
  }
  for (const o of doc.objects) {
    if (o.type !== "PDFDEFINITION" || map.has(o.handle)) continue;
    const def = o as UnderlayDefinitionObject;
    let page: { w: number; h: number } | null = null;
    try {
      const bytes = def.fileName ? await env.loadImage(def.fileName) : undefined;
      if (bytes) page = pdfPageSize(bytes, Number(def.name) || 1) ?? null;
    } catch {
      page = null;
    }
    map.set(o.handle, page);
  }
});

/** Page size in PDF units (1/72 inch) from the n-th /MediaBox (1-based), else the first. */
export function pdfPageSize(bytes: Uint8Array, page: number): { w: number; h: number } | undefined {
  const text = new TextDecoder("latin1").decode(bytes);
  const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g)];
  const m = boxes[page - 1] ?? boxes[0];
  if (!m) return undefined;
  return { w: Number(m[3]) - Number(m[1]), h: Number(m[4]) - Number(m[2]) };
}

function underlayFrameMode(doc: DxfDocument, type: string): number {
  if (type === "PDFUNDERLAY") {
    const v = dictionaryVariables(doc).get("PDFFRAME");
    return v === undefined || v.trim() === "" ? 1 : Number(v) || 0;
  }
  return doc.header.num(type === "DWFUNDERLAY" ? "$DWFFRAME" : "$DGNFRAME", 1);
}

registerDrawer(["PDFUNDERLAY", "DWFUNDERLAY", "DGNUNDERLAY"], (fe, ent, st) => {
  const e = ent as UnderlayEntity;
  if ((e.flags & 2) !== 0) fe.note("underlay-content");
  if (underlayFrameMode(fe.doc, e.type) !== 1) return;
  const b = e.clipBoundary;
  let pts: { x: number; y: number }[];
  if ((e.flags & 1) !== 0 && b.length >= 2)
    pts =
      b.length === 2
        ? [
            { x: b[0]!.x, y: b[0]!.y },
            { x: b[1]!.x, y: b[0]!.y },
            { x: b[1]!.x, y: b[1]!.y },
            { x: b[0]!.x, y: b[1]!.y },
          ]
        : b.map((p) => ({ x: p.x, y: p.y }));
  else {
    const page = e.definitionHandle ? PAGE.get(fe.doc)?.get(e.definitionHandle) : undefined;
    if (!page) return;
    const w = page.w / 72;
    const h = page.h / 72;
    pts = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  }
  const rot = (e.rotation * Math.PI) / 180;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const m = st.m.multiply(ocsToWcsMatrix(e.extrusion));
  const world = pts.map((p) => {
    const x = p.x * e.scale.x;
    const y = p.y * e.scale.y;
    return m.transformPoint({ x: e.insert.x + x * c - y * s, y: e.insert.y + x * s + y * c, z: e.insert.z });
  });
  fe.strokePath({ subpaths: [{ segments: closedPolygon(world), closed: true }] }, fe.resolve(e, st), e, st);
});
