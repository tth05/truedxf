/**
 * Drawers for curves, polylines, points, solids, faces, rays and block references.
 * Geometry rules: research/notes/03-entities-geometry.md; blocks: 07.
 */
import {
  arcSpanDeg,
  buildSplineCurve,
  bulgePolylineToSubpath,
  type Curve3,
  DashUnits,
  degToRad,
  ellipseFromDxf,
  ellipticArcCurve3,
  FillRule,
  line3,
  Matrix44,
  ocsArcToEllipticArc3,
  ocsToWcsMatrix,
  type Path2,
  type PolylineVertex,
  polyline3,
  projectCurve3,
  transformPath,
  type Vec3,
  widePolylineOutline,
} from "@truedxf/geometry";
import type {
  ArcEntity,
  CircleEntity,
  EllipseEntity,
  Entity,
  Face3dEntity,
  InsertEntity,
  LineEntity,
  LwPolylineEntity,
  PointEntity,
  PolylineEntity,
  RayEntity,
  SolidEntity,
  SplineEntity,
} from "@truedxf/model";
import { type DrawState, type Frontend, registerDrawer } from "../frontend.ts";
import type { Resolved } from "../props.ts";
import { pointSymbol } from "./points.ts";

function curve(fe: Frontend, c: Curve3, e: Entity, st: DrawState, r: Resolved, closed = false): void {
  const sp = projectCurve3(c, st.m);
  fe.strokePath({ subpaths: [closed ? { ...sp, closed } : sp] }, r, e, st);
}

registerDrawer("LINE", (fe, e, st) => {
  const l = e as LineEntity;
  curve(fe, line3(l.start, l.end), l, st, fe.resolve(l, st));
});

registerDrawer("CIRCLE", (fe, e, st) => {
  const c = e as CircleEntity;
  const arc = ocsArcToEllipticArc3(c.center, c.radius, 0, Math.PI * 2, c.extrusion);
  curve(fe, ellipticArcCurve3(arc), c, st, fe.resolve(c, st), true);
});

registerDrawer("ARC", (fe, e, st) => {
  const a = e as ArcEntity;
  const sweep = degToRad(arcSpanDeg(a.startAngle, a.endAngle));
  const arc = ocsArcToEllipticArc3(a.center, a.radius, degToRad(a.startAngle), sweep, a.extrusion);
  curve(fe, ellipticArcCurve3(arc), a, st, fe.resolve(a, st));
});

registerDrawer("ELLIPSE", (fe, e, st) => {
  const x = e as EllipseEntity;
  const el = ellipseFromDxf({
    center: x.center,
    majorAxis: x.majorAxis,
    ratio: x.ratio,
    startParam: x.startParam,
    endParam: x.endParam,
    extrusion: x.extrusion,
  });
  const full = Math.abs(Math.abs(el.sweep) - Math.PI * 2) < 1e-12;
  curve(fe, ellipticArcCurve3(el), x, st, fe.resolve(x, st), full);
});

registerDrawer("SPLINE", (fe, e, st) => {
  const s = e as SplineEntity;
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
    fe.note("spline-invalid");
    return;
  }
  curve(fe, { kind: "nurbs", curve: res.curve }, s, st, fe.resolve(s, st));
});

/**
 * 2D polyline (LWPOLYLINE or 2D POLYLINE) in its OCS plane: centre line with linetype, or filled
 * band outline for wide polylines (note 03 §4). Linetype generation is continuous across
 * vertices only with PLINEGEN (flag 128).
 */
function polyline2d(
  fe: Frontend,
  e: Entity,
  st: DrawState,
  verts: PolylineVertex[],
  closed: boolean,
  constantWidth: number,
  extrusion: Vec3,
  elevation: number,
  plinegen: boolean,
): void {
  if (verts.length === 0) return;
  const r = fe.resolve(e, st);
  const plane = st.m.multiply(ocsToWcsMatrix(extrusion)).planeToAffine2(elevation);
  const wide = constantWidth !== 0 || verts.some((v) => (v.startWidth ?? 0) > 0 || (v.endWidth ?? 0) > 0);
  const units = plinegen ? DashUnits.Continuous : DashUnits.PerSegment;
  if (!wide) {
    const sub = bulgePolylineToSubpath(verts, closed);
    fe.strokePath(transformPath({ subpaths: [sub] }, plane), r, e, st, { units });
    return;
  }
  // tolerance in OCS units for tapered arcs: target tolerance / plane scale
  const scale = fe.transformScale(st.m) || 1;
  const outline = widePolylineOutline(verts, { closed, constantWidth, tolerance: fe.tolerance / scale });
  if (fe.fillMode) {
    fe.fillPath(transformPath(outline.fill, plane), fe.color(r), FillRule.NonZero);
  } else {
    // FILLMODE 0: outline only (note 03 §4)
    fe.strokePath(transformPath(outline.fill, plane), r, undefined, st);
  }
  if (outline.thin.length > 0) {
    fe.strokePath(transformPath({ subpaths: outline.thin }, plane), r, e, st, { units });
  }
  // UNVERIFIED (note 03 §4): linetypes on wide polylines (dashing the band) are not applied yet
  if (fe.linetypeFor(e, r, st)) fe.note("wide-polyline-linetype");
}

registerDrawer("LWPOLYLINE", (fe, e, st) => {
  const p = e as LwPolylineEntity;
  const verts: PolylineVertex[] = p.vertices.map((v) => ({
    x: v.x,
    y: v.y,
    bulge: v.bulge,
    startWidth: v.startWidth < 0 ? 0 : v.startWidth,
    endWidth: v.endWidth < 0 ? 0 : v.endWidth,
  }));
  polyline2d(fe, p, st, verts, p.closed, p.constantWidth, p.extrusion, p.elevation, (p.flags & 128) !== 0);
});

registerDrawer("POLYLINE", (fe, e, st) => {
  const p = e as PolylineEntity;
  const flags = p.flags;
  if (flags & 64) return drawPolyface(fe, p, st);
  if (flags & 16) return drawPolygonMesh(fe, p, st);
  // skip spline frame control points (flag 16); keep curve-fit (1) and spline-fit (8) vertices
  const verts = p.vertices.filter((v) => (v.flags & 16) === 0);
  if (verts.length === 0) return;
  if (flags & 8) {
    const r = fe.resolve(p, st);
    curve(
      fe,
      polyline3(
        verts.map((v) => v.location),
        p.closed,
      ),
      p,
      st,
      r,
      p.closed,
    );
    return;
  }
  const splineFit = (flags & 4) !== 0;
  const pv: PolylineVertex[] = verts.map((v) => ({
    x: v.location.x,
    y: v.location.y,
    bulge: splineFit ? 0 : v.bulge,
    startWidth: v.startWidth < 0 ? p.defaultStartWidth : v.startWidth,
    endWidth: v.endWidth < 0 ? p.defaultEndWidth : v.endWidth,
  }));
  polyline2d(fe, p, st, pv, p.closed, 0, p.extrusion, p.elevationPoint.z, (flags & 128) !== 0);
});

function drawPolyface(fe: Frontend, p: PolylineEntity, st: DrawState): void {
  const r = fe.resolve(p, st);
  const vertices: Vec3[] = [];
  const faces: number[][] = [];
  for (const v of p.vertices) {
    if ((v.flags & 64) !== 0) vertices.push(v.location);
    else if ((v.flags & 128) !== 0) faces.push([...v.faceIndices]);
  }
  const seen = new Set<string>();
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i]!;
      const b = f[(i + 1) % f.length]!;
      if (a <= 0) continue; // negative index = invisible edge starting at this vertex
      const pa = vertices[Math.abs(a) - 1];
      const pb = vertices[Math.abs(b) - 1];
      if (!pa || !pb) continue;
      const lo = Math.min(Math.abs(a), Math.abs(b));
      const hi = Math.max(Math.abs(a), Math.abs(b));
      const key = `${lo}-${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      curve(fe, line3(pa, pb), p, st, r);
    }
  }
}

function drawPolygonMesh(fe: Frontend, p: PolylineEntity, st: DrawState): void {
  const r = fe.resolve(p, st);
  const m = p.m;
  const n = p.n;
  const pts = p.vertices.map((v) => v.location);
  if (m * n !== pts.length || m < 1 || n < 1) {
    fe.note("mesh-count-mismatch");
    return;
  }
  const closedM = (p.flags & 1) !== 0;
  const closedN = (p.flags & 32) !== 0;
  for (let i = 0; i < m; i++) curve(fe, polyline3(pts.slice(i * n, i * n + n), closedN), p, st, r, closedN);
  for (let j = 0; j < n; j++) {
    const col: Vec3[] = [];
    for (let i = 0; i < m; i++) col.push(pts[i * n + j]!);
    curve(fe, polyline3(col, closedM), p, st, r, closedM);
  }
}

registerDrawer("POINT", (fe, e, st) => {
  const p = e as PointEntity;
  const r = fe.resolve(p, st);
  const mode = fe.doc.header.num("$PDMODE", 0);
  const loc = st.m.transformPoint(p.location);
  const sym = pointSymbol(mode, pointSize(fe, st));
  // POINT ignores the lineweight: always one pixel (note 08 §10.3)
  if (sym.dot) fe.pixel(loc.x, loc.y, fe.color(r));
  if (sym.paths.subpaths.length === 0) return;
  // symbols are aligned with the point's angle (degrees, UCS X axis when drawn); UNVERIFIED sign
  const rot = Matrix44.rotationZ(degToRad(p.angle));
  const at = Matrix44.translation(loc.x, loc.y, 0).multiply(rot);
  fe.strokePath(transformPath(sym.paths, at.planeToAffine2(0)), r, undefined, st, { noLinetype: true });
});

/**
 * PDSIZE in target units: > 0 absolute (scaled by block transform), 0 → 5 % of the plotted view
 * height, < 0 → |PDSIZE| % of the view height (note 03 §3.1; UNVERIFIED which height PLOT uses).
 */
function pointSize(fe: Frontend, st: DrawState): number {
  const pdsize = fe.doc.header.num("$PDSIZE", 0);
  const viewH = fe.view.maxY - fe.view.minY;
  if (pdsize > 0) return pdsize * fe.transformScale(st.m);
  if (pdsize === 0) return viewH * 0.05;
  return (viewH * -pdsize) / 100;
}

registerDrawer(["SOLID", "TRACE"], (fe, e, st) => {
  const s = e as SolidEntity;
  const r = fe.resolve(s, st);
  const m = st.m.multiply(ocsToWcsMatrix(s.extrusion));
  // drawing order 1-2-4-3 (note 03 §3)
  const q = [s.v0, s.v1, s.v3, s.v2].map((p) => m.transformPoint(p));
  if (fe.fillMode) {
    const tri = [
      q[0]!.x,
      q[0]!.y,
      q[1]!.x,
      q[1]!.y,
      q[2]!.x,
      q[2]!.y,
      q[0]!.x,
      q[0]!.y,
      q[2]!.x,
      q[2]!.y,
      q[3]!.x,
      q[3]!.y,
    ];
    fe.fillTriangles(tri, fe.color(r));
  } else {
    const path: Path2 = { subpaths: [projectCurve3(polyline3([s.v0, s.v1, s.v3, s.v2], true), m)] };
    fe.strokePath(path, r, s, st);
  }
});

registerDrawer("3DFACE", (fe, e, st) => {
  const f = e as Face3dEntity;
  const r = fe.resolve(f, st);
  const v = [f.v0, f.v1, f.v2, f.v3];
  for (let i = 0; i < 4; i++) {
    if (f.invisibleEdges & (1 << i)) continue;
    const a = v[i]!;
    const b = v[(i + 1) % 4]!;
    if (a.x === b.x && a.y === b.y && a.z === b.z) continue;
    curve(fe, line3(a, b), f, st, r);
  }
});

registerDrawer(["RAY", "XLINE"], (fe, e, st) => {
  const x = e as RayEntity;
  const r = fe.resolve(x, st);
  const p = st.m.transformPoint(x.start);
  const d = st.m.transformDirection(x.direction);
  const len = Math.hypot(d.x, d.y);
  if (len === 0) return;
  // extend beyond the view (the renderer clips to the canvas); linetype phase starts at the
  // ray origin (UNVERIFIED for XLINE)
  const v = fe.view;
  const reach =
    Math.hypot(v.maxX - v.minX, v.maxY - v.minY) +
    Math.hypot(p.x - (v.minX + v.maxX) / 2, p.y - (v.minY + v.maxY) / 2);
  const k = reach / len;
  const t0 = x.type === "XLINE" ? -k : 0;
  const a = { x: p.x + d.x * t0, y: p.y + d.y * t0 };
  const b = { x: p.x + d.x * k, y: p.y + d.y * k };
  fe.strokePath({ subpaths: [{ segments: [{ kind: "line", p0: a, p1: b }], closed: false }] }, r, x, st);
});

registerDrawer("INSERT", (fe, e, st) => {
  const ins = e as InsertEntity;
  const block = fe.doc.getBlock(ins.blockName);
  if (!block) {
    fe.note("missing-block");
    return;
  }
  const base = block.basePoint;
  const ocs = ocsToWcsMatrix(ins.extrusion);
  const rot = Matrix44.rotationZ(degToRad(ins.rotation));
  const scale = Matrix44.scaling(ins.scale.x, ins.scale.y, ins.scale.z);
  const toBase = Matrix44.translation(-base.x, -base.y, -base.z);
  for (let row = 0; row < ins.rowCount; row++) {
    for (let col = 0; col < ins.columnCount; col++) {
      // MINSERT spacing is rotated with the insert, not scaled (note 07 §2; ezdxf/LibreCAD)
      const cell = Matrix44.translation(col * ins.columnSpacing, row * ins.rowSpacing, 0);
      const local = Matrix44.product(
        ocs,
        Matrix44.translation(ins.insert.x, ins.insert.y, ins.insert.z),
        rot,
        cell,
        scale,
        toBase,
      );
      if (!fe.drawBlockContent(block, local, ins, st)) return;
    }
  }
});

/** DIMENSION and ACAD_TABLE: draw the stored anonymous geometry block as is (notes 05 / 07). */
registerDrawer(["DIMENSION", "ARC_DIMENSION", "LARGE_RADIAL_DIMENSION", "ACAD_TABLE"], (fe, e, st) => {
  const name = (e as Entity & { blockName?: string }).blockName;
  const block = name ? fe.doc.getBlock(name) : undefined;
  if (!block) {
    fe.note(`${e.dxfType}-without-block`);
    return;
  }
  fe.drawBlockContent(block, Matrix44.identity(), e, st);
});
