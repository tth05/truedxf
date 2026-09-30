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
  VertexEntity,
} from "@truedxf/model";
import { type DrawState, type Frontend, registerDrawer } from "../frontend.ts";
import type { Resolved } from "../props.ts";
import { pointSymbol } from "./points.ts";

function curve(
  fe: Frontend,
  c: Curve3,
  e: Entity,
  st: DrawState,
  r: Resolved,
  closed = false,
  noLinetype = false,
): void {
  const sp = projectCurve3(c, st.m);
  fe.strokePath({ subpaths: [closed ? { ...sp, closed } : sp] }, r, e, st, { noLinetype });
}

/** Target-plane offset of an extrusion by `thickness` along N̂, or undefined if it is invisible. */
function thicknessOffset(fe: Frontend, st: DrawState, thickness: number, n: Vec3): Vec3 | undefined {
  if (thickness === 0) return undefined;
  const len = Math.hypot(n.x, n.y, n.z) || 1;
  const d = st.m.transformDirection({
    x: (n.x * thickness) / len,
    y: (n.y * thickness) / len,
    z: (n.z * thickness) / len,
  });
  return Math.hypot(d.x, d.y) > fe.tolerance ? d : undefined;
}

/**
 * A curve with thickness in 2D wireframe: the base curve, the top curve (+t·N̂) and a connecting
 * edge at every vertex of the flattened base curve. VERIFIED-BY-ACAD (ocs/thickness-skew,
 * lines-curves/line-thickness-*: LINE → quad, CIRCLE/ARC → two curves plus generator lines at the
 * tessellation vertices, 40 for a 150 px circle; note 03 §2.6).
 */
function extruded(fe: Frontend, c: Curve3, st: DrawState, r: Resolved, d: Vec3, closed = false): void {
  const sp = projectCurve3(c, st.m);
  for (const fl of fe.flatten({ subpaths: [closed ? { ...sp, closed } : sp] })) {
    const pts = fl.points;
    const top = new Float64Array(pts.length);
    for (let k = 0; k < pts.length; k += 2) {
      top[k] = pts[k]! + d.x;
      top[k + 1] = pts[k + 1]! + d.y;
    }
    fe.strokeFlat(pts, fl.closed, r);
    fe.strokeFlat(top, fl.closed, r);
    for (let k = 0; k < pts.length; k += 2)
      fe.strokeFlat(Float64Array.of(pts[k]!, pts[k + 1]!, top[k]!, top[k + 1]!), false, r);
  }
}

/**
 * Extrusion 210 = (0, 0, 0) (kept by AutoCAD): an ARC is not drawn, a CIRCLE is drawn in the XY
 * plane around the WCS origin (its centre collapses to 0). VERIFIED-BY-ACAD ocs/zero-extrusion-*
 */
function zeroVector(n: Vec3): boolean {
  return n.x === 0 && n.y === 0 && n.z === 0;
}

registerDrawer("LINE", (fe, e, st) => {
  const l = e as LineEntity;
  const r = fe.resolve(l, st);
  const d = thicknessOffset(fe, st, l.thickness, l.extrusion);
  if (d) extruded(fe, line3(l.start, l.end), st, r, d);
  else curve(fe, line3(l.start, l.end), l, st, r);
});

/** A negative CIRCLE/ARC radius is repaired to 1 on load (DXFOUT writes 40 = 1). VERIFIED-BY-ACAD
 * lines-curves/circle-degenerate-0002, degenerate-lw-0002/0004, fileformat/corpus-ezdxf-circle-radius-le-0 */
function radius(r: number): number {
  return r < 0 ? 1 : r;
}

registerDrawer("CIRCLE", (fe, e, st) => {
  const c = e as CircleEntity;
  // VERIFIED-BY-ACAD ocs/zero-extrusion-circle (Q-0124)
  const zero = zeroVector(c.extrusion);
  const center = zero ? { x: 0, y: 0, z: 0 } : c.center;
  const arc = ocsArcToEllipticArc3(
    center,
    radius(c.radius),
    0,
    Math.PI * 2,
    zero ? { x: 0, y: 0, z: 1 } : c.extrusion,
  );
  const r = fe.resolve(c, st);
  const d = thicknessOffset(fe, st, c.thickness, c.extrusion);
  if (d) extruded(fe, ellipticArcCurve3(arc), st, r, d, true);
  else curve(fe, ellipticArcCurve3(arc), c, st, r, true);
});

registerDrawer("ARC", (fe, e, st) => {
  const a = e as ArcEntity;
  // VERIFIED-BY-ACAD ocs/zero-extrusion-arc (Q-0124)
  if (zeroVector(a.extrusion)) return;
  // end − start ≥ 360° plots a full circle (30 … 450 is not reduced to 60°). VERIFIED-BY-ACAD
  // lines-curves/arc-normalise-0004 (0005: 0 … 720)
  const sweep = degToRad(a.endAngle - a.startAngle >= 360 ? 360 : arcSpanDeg(a.startAngle, a.endAngle));
  const arc = ocsArcToEllipticArc3(a.center, radius(a.radius), degToRad(a.startAngle), sweep, a.extrusion);
  const r = fe.resolve(a, st);
  const d = thicknessOffset(fe, st, a.thickness, a.extrusion);
  if (d) extruded(fe, ellipticArcCurve3(arc), st, r, d);
  else curve(fe, ellipticArcCurve3(arc), a, st, r);
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
  // A parameter span ≥ 2π is a full ellipse (not reduced modulo 2π to a tiny arc): 0 … 6.2831855
  // and 0 … 7 plot the full ellipse. VERIFIED-BY-ACAD ellipses/param-2pi-*, param-0008 (Q-0166)
  const span = x.endParam - x.startParam;
  const arc = span >= Math.PI * 2 - 1e-12 ? { ...el, sweep: Math.PI * 2 } : el;
  const full = Math.abs(Math.abs(arc.sweep) - Math.PI * 2) < 1e-12;
  curve(fe, ellipticArcCurve3(arc), x, st, fe.resolve(x, st), full);
});

registerDrawer("SPLINE", (fe, e, st) => {
  const s = e as SplineEntity;
  // AutoCAD rebuilds interpolating fit-point splines (fit tolerance 0) from the fit points on load,
  // ignoring stored control points and the 70 bits 64/128 (always chord-length knots), with the
  // 12/13 tangents unnormalized. VERIFIED-BY-ACAD via DXFOUT: splines/fit-and-control,
  // fit-param-64/128(-tangents), fit-tangents-*. With a fit tolerance the stored control points
  // are AutoCAD's own approximation (its algorithm is unknown, splines/fit-tolerance*).
  const fromFit = s.fitPoints.length >= 2 && (s.controlPoints.length === 0 || !(s.fitTolerance > 1e-9));
  const res = buildSplineCurve({
    degree: s.degree,
    flags: fromFit ? s.flags & ~(64 | 128) : s.flags,
    knots: s.knots,
    controlPoints: fromFit ? [] : s.controlPoints,
    weights: s.weights,
    fitPoints: s.fitPoints,
    startTangent: s.startTangent,
    endTangent: s.endTangent,
    rawTangents: true,
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
    // A closed PLINEGEN polyline is one closed linetype unit whose pattern starts at vertex 1.
    // VERIFIED-BY-ACAD (note 06 §2.6; linetypes/pl-zigzag-*-closed-gen1, pl-fine-gen1)
    const vs = closed && plinegen && verts.length > 1 ? [...verts.slice(1), verts[0]!] : verts;
    const sub = bulgePolylineToSubpath(vs, closed);
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

/**
 * Negative widths: a per-vertex width counts with its absolute value, a negative constant width
 * (43) as 0. VERIFIED-BY-ACAD polylines/width-negative-width (40/41 = -4 → 4 wide),
 * width-const-negative (43 = -1 → hairline). The model reports an absent 40/41 as -1.
 */
function vertexWidth(w: number): number {
  return w === -1 ? 0 : Math.abs(w);
}

registerDrawer("LWPOLYLINE", (fe, e, st) => {
  const p = e as LwPolylineEntity;
  const verts: PolylineVertex[] = p.vertices.map((v) => ({
    x: v.x,
    y: v.y,
    bulge: v.bulge,
    startWidth: vertexWidth(v.startWidth),
    endWidth: vertexWidth(v.endWidth),
  }));
  const cw = Math.max(0, p.constantWidth);
  polyline2d(fe, p, st, verts, p.closed, cw, p.extrusion, p.elevation, (p.flags & 128) !== 0);
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
    // 3D polylines plot continuous (no linetype). VERIFIED-BY-ACAD (linetypes/other-polyline3d)
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
      true,
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
  const vertices: Vec3[] = [];
  const faces: VertexEntity[] = [];
  for (const v of p.vertices) {
    if ((v.flags & 64) !== 0) vertices.push(v.location);
    else if ((v.flags & 128) !== 0) faces.push(v);
  }
  // $SPLFRAME 1 shows invisible edges. VERIFIED-BY-ACAD polylines/polyface-invisible-splframe
  const splframe = fe.doc.header.num("$SPLFRAME", 0) !== 0;
  const seen = new Set<string>();
  for (const face of faces) {
    // each face plots with its face record's own properties (colour, layer, …).
    // VERIFIED-BY-ACAD polylines/polyface-face-colors
    if (!fe.props.isPlotted(face, st.inh)) continue;
    const r = fe.resolve(face, st);
    // index 0 = unused corner (triangles)
    const f = face.faceIndices.filter((x) => x !== 0);
    for (let i = 0; i < f.length; i++) {
      const a = f[i]!;
      const b = f[(i + 1) % f.length]!;
      if (a < 0 && !splframe) continue; // negative index = invisible edge starting at this vertex
      const pa = vertices[Math.abs(a) - 1];
      const pb = vertices[Math.abs(b) - 1];
      if (!pa || !pb) continue;
      const lo = Math.min(Math.abs(a), Math.abs(b));
      const hi = Math.max(Math.abs(a), Math.abs(b));
      const key = `${lo}-${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // mesh edges plot continuous. VERIFIED-BY-ACAD (linetypes/other-polymesh)
      curve(fe, line3(pa, pb), face, st, r, false, true);
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
  // mesh edges plot continuous. VERIFIED-BY-ACAD (linetypes/other-polymesh)
  for (let i = 0; i < m; i++)
    curve(fe, polyline3(pts.slice(i * n, i * n + n), closedN), p, st, r, closedN, true);
  for (let j = 0; j < n; j++) {
    const col: Vec3[] = [];
    for (let i = 0; i < m; i++) col.push(pts[i * n + j]!);
    curve(fe, polyline3(col, closedM), p, st, r, closedM, true);
  }
}

registerDrawer("POINT", (fe, e, st) => {
  const p = e as PointEntity;
  const r = fe.resolve(p, st);
  const mode = fe.doc.header.num("$PDMODE", 0);
  const loc = st.m.transformPoint(p.location);
  const sym = pointSymbol(mode, pointSize(fe, st));
  // POINT and its symbol ignore the lineweight: always one pixel. VERIFIED-BY-ACAD (note 08
  // §10.3; points/symbol-lineweight-*)
  const thin: Resolved = { ...r, lineweight: 0 };
  if (sym.dot) fe.pixel(loc.x, loc.y, fe.color(r));
  if (p.thickness !== 0) {
    // thickness: a line from P to P + t·N̂ (note 03 §2.6)
    const n = p.extrusion;
    const len = Math.hypot(n.x, n.y, n.z) || 1;
    const k = p.thickness / len;
    const top = { x: p.location.x + n.x * k, y: p.location.y + n.y * k, z: p.location.z + n.z * k };
    curve(fe, line3(p.location, top), p, st, thin);
  }
  if (sym.paths.subpaths.length === 0) return;
  // The symbol lies in the plane of 210 (arbitrary axis) at the WCS location, rotated by −angle
  // (clockwise). VERIFIED-BY-ACAD (points/point-angle-*, point-ocs-*)
  const lm = Matrix44.product(
    Matrix44.translation(p.location.x, p.location.y, p.location.z),
    ocsToWcsMatrix(p.extrusion),
    Matrix44.rotationZ(-degToRad(p.angle)),
  );
  // the symbol is transformed with the block (distorted by non-uniform scale). VERIFIED-BY-ACAD
  // (points/point-in-block-0001)
  fe.strokePath(transformPath(sym.paths, st.m.multiply(lm).planeToAffine2(0)), thin, undefined, st, {
    noLinetype: true,
  });
});

/**
 * Point size S (the `+` arm length, points.ts) in the point's own units: PDSIZE > 0 absolute;
 * 0 → 5 % and < 0 → |PDSIZE| % of *half* the plotted view height. VERIFIED-BY-ACAD
 * (points/pdsize-relative-*, pdsize-vport-*, point-in-block-0001): the plot area height counts,
 * not the *Active VPORT height; inside blocks the symbol is transformed with the block, and the
 * relative size uses the view height measured in block units (|M⁻¹·(0, 1)|, point-in-block-0002).
 */
function pointSize(fe: Frontend, st: DrawState): number {
  const pdsize = fe.doc.header.num("$PDSIZE", 0);
  if (pdsize > 0) return pdsize;
  const up = st.m.planeToAffine2(0).invert()?.applyVector({ x: 0, y: 1 });
  const k = up ? Math.hypot(up.x, up.y) : 1;
  const half = ((fe.view.maxY - fe.view.minY) / 2) * (k > 0 ? k : 1);
  if (pdsize === 0) return half * 0.05;
  return (half * -pdsize) / 100;
}

registerDrawer(["SOLID", "TRACE"], (fe, e, st) => {
  const s = e as SolidEntity;
  const r = fe.resolve(s, st);
  const m = st.m.multiply(ocsToWcsMatrix(s.extrusion));
  // outline order 1-2-4-3 (note 03 §3)
  const corners = [s.v0, s.v1, s.v3, s.v2];
  const d = thicknessOffset(fe, st, s.thickness, s.extrusion);
  if (d) {
    // a prism in wireframe: bottom, top and the four vertical edges, never filled.
    // VERIFIED-BY-ACAD solids/solid-thickness-tilted, ocs/thickness-skew
    const ocs = ocsToWcsMatrix(s.extrusion);
    extruded(
      fe,
      polyline3(
        corners.map((p) => ocs.transformPoint(p)),
        true,
      ),
      st,
      r,
      d,
      true,
    );
    return;
  }
  // Filled only when the plane faces the view (normal ∥ view direction); a tilted SOLID/TRACE
  // plots as its outline. VERIFIED-BY-ACAD ocs/solid-small (210 = 0.01, 0.01, 1), solid-tilt-*,
  // solid-edge-on
  const ex = m.transformDirection({ x: 1, y: 0, z: 0 });
  const ey = m.transformDirection({ x: 0, y: 1, z: 0 });
  const nx = ex.y * ey.z - ex.z * ey.y;
  const ny = ex.z * ey.x - ex.x * ey.z;
  const nz = ex.x * ey.y - ex.y * ey.x;
  const facing = Math.hypot(nx, ny) <= 1e-9 * Math.hypot(nx, ny, nz);
  if (fe.fillMode && facing) {
    // the 1-2-4-3 polygon is filled as is: a crossed order gives a bow tie, a concave one keeps
    // its notch. VERIFIED-BY-ACAD solids/solid-polygon-order-fill1, solid-concave-fill1
    const ring = new Float64Array(8);
    corners.forEach((p, i) => {
      const q = m.transformPoint(p);
      ring[i * 2] = q.x;
      ring[i * 2 + 1] = q.y;
    });
    fe.fillRings([ring], fe.color(r), FillRule.NonZero);
    // zero-area SOLIDs draw nothing but still count for the extents. VERIFIED-BY-ACAD
    // (fileformat/corpus-gdal-solid-less-than-4-vertices: $EXTMIN/$EXTMAX span the degenerate ones)
    if (fe.props.extents) fe.builder.points(ring, fe.color(r));
  } else {
    const path: Path2 = { subpaths: [projectCurve3(polyline3(corners, true), m)] };
    fe.strokePath(path, r, s, st);
  }
});

registerDrawer("3DFACE", (fe, e, st) => {
  const f = e as Face3dEntity;
  const r = fe.resolve(f, st);
  const v = [f.v0, f.v1, f.v2, f.v3];
  const splframe = fe.doc.header.num("$SPLFRAME", 0) !== 0;
  for (let i = 0; i < 4; i++) {
    // $SPLFRAME 1 shows invisible edges. VERIFIED-BY-ACAD solids/3dface-nonplanar
    if (f.invisibleEdges & (1 << i) && !splframe) continue;
    const a = v[i]!;
    const b = v[(i + 1) % 4]!;
    if (a.x === b.x && a.y === b.y && a.z === b.z) continue;
    // 3DFACE edges plot continuous. VERIFIED-BY-ACAD (linetypes/other-3dface)
    curve(fe, line3(a, b), f, st, r, false, true);
  }
});

registerDrawer(["RAY", "XLINE"], (fe, e, st) => {
  const x = e as RayEntity;
  const r = fe.resolve(x, st);
  const p = st.m.transformPoint(x.start);
  const d = st.m.transformDirection(x.direction);
  const len = Math.hypot(d.x, d.y);
  if (len === 0) return;
  // Clipped to the plot window first, then fitted like a LINE of that length (A-type ends at
  // the window edges). VERIFIED-BY-ACAD (note 06 §2.6; linetypes/infinite-xline*, infinite-ray)
  const v = fe.view;
  let t0 = x.type === "XLINE" ? Number.NEGATIVE_INFINITY : 0;
  let t1 = Number.POSITIVE_INFINITY;
  const clipAxis = (p0: number, dd: number, lo: number, hi: number): boolean => {
    if (dd === 0) return p0 >= lo && p0 <= hi;
    const a = (lo - p0) / dd;
    const b = (hi - p0) / dd;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
    return true;
  };
  if (!clipAxis(p.x, d.x, v.minX, v.maxX) || !clipAxis(p.y, d.y, v.minY, v.maxY) || !(t1 > t0)) return;
  const a = { x: p.x + d.x * t0, y: p.y + d.y * t0 };
  const b = { x: p.x + d.x * t1, y: p.y + d.y * t1 };
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
  // a zero scale factor is read as 1 (AutoCAD repairs it on load). VERIFIED-BY-ACAD
  // blocks/zero-scale-x, zero-scale-y
  const s1 = (v: number) => (v === 0 ? 1 : v);
  const scale = Matrix44.scaling(s1(ins.scale.x), s1(ins.scale.y), s1(ins.scale.z));
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

/** ACAD_TABLE: draw the stored anonymous geometry block as is (note 07); DIMENSION: dimension.ts. */
registerDrawer("ACAD_TABLE", (fe, e, st) => {
  const name = (e as Entity & { blockName?: string }).blockName;
  const block = name ? fe.doc.getBlock(name) : undefined;
  if (!block) {
    fe.note(`${e.dxfType}-without-block`);
    return;
  }
  fe.drawBlockContent(block, Matrix44.identity(), e, st);
});
