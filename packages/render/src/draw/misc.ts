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
import type { HelixEntity, Ole2FrameEntity, UnderlayEntity } from "@truedxf/model";
import { registerDrawer } from "../frontend.ts";

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

// PDF / DWF / DGN underlays: clip boundary as frame when it exists (content not rendered)
registerDrawer(["PDFUNDERLAY", "DWFUNDERLAY", "DGNUNDERLAY"], (fe, ent, st) => {
  const e = ent as UnderlayEntity;
  fe.note("underlay-content");
  if (e.clipBoundary.length < 2) return;
  const b = e.clipBoundary;
  const pts =
    b.length === 2
      ? [
          { x: b[0]!.x, y: b[0]!.y },
          { x: b[1]!.x, y: b[0]!.y },
          { x: b[1]!.x, y: b[1]!.y },
          { x: b[0]!.x, y: b[1]!.y },
        ]
      : b.map((p) => ({ x: p.x, y: p.y }));
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
