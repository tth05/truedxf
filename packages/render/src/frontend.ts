/**
 * The rendering frontend: walks a layout of a DxfDocument and emits a display list for a target
 * resolution. It does all geometry work (tessellation, lineweight widening, fills); renderers
 * only draw primitives (docs/PLAN.md §3 principle 5).
 */
import {
  arcSpanDeg,
  buildSplineCurve,
  bulgePolylineToSubpath,
  type Curve3,
  degToRad,
  ellipseFromDxf,
  ellipticArcCurve3,
  flattenPath,
  line3,
  Matrix44,
  ocsArcToEllipticArc3,
  ocsToWcsMatrix,
  type Path2,
  polyline3,
  projectCurve3,
  projectPlanarPath,
  type Vec3,
} from "@truedxf/geometry";
import type {
  ArcEntity,
  Block,
  CircleEntity,
  DxfDocument,
  EllipseEntity,
  Entity,
  EntityBase,
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
import { type DisplayList, DisplayListBuilder, type Rgba } from "./displaylist.ts";
import {
  DEFAULT_CALIBRATION,
  fitWindow,
  type PlotCalibration,
  type PlotRequest,
  pixelSizeOf,
  type View,
  viewFromBounds,
} from "./plot.ts";
import { type Inherited, PropertyResolver, type Resolved, TOP_LEVEL } from "./props.ts";

export interface RenderEnv {
  /** Font bytes by file or family name (lower-cased); undefined when not available. */
  loadFont?: (name: string) => Promise<Uint8Array | undefined>;
  calibration?: Partial<PlotCalibration>;
}

export interface PlotResult {
  displayList: DisplayList;
  view: View;
  /** Counts of things the frontend could not render (entity types, features). */
  unsupported: Record<string, number>;
}

/** Chord tolerance in device pixels for curve flattening. */
const TOLERANCE_PX = 0.1;
const MAX_BLOCK_DEPTH = 64;

interface State {
  /** Entity coordinates (WCS of the current block) → target 2D (x, y of the result). */
  m: Matrix44;
  inh: Inherited;
  /** Block names on the INSERT stack (cycle guard). */
  stack: string[];
}

export class Frontend {
  readonly doc: DxfDocument;
  readonly request: PlotRequest;
  readonly view: View;
  readonly pixelSize: number;
  readonly builder: DisplayListBuilder;
  readonly props: PropertyResolver;
  readonly calibration: PlotCalibration;
  readonly unsupported: Record<string, number> = {};
  private readonly monochrome: boolean;
  private readonly lineweights: boolean;
  private readonly fillMode: boolean;
  private readonly pdmode: number;

  constructor(doc: DxfDocument, request: PlotRequest, view: View, calibration: PlotCalibration) {
    this.doc = doc;
    this.request = request;
    this.view = view;
    this.pixelSize = pixelSizeOf(view, request.canvas);
    this.builder = new DisplayListBuilder(this.pixelSize);
    this.props = new PropertyResolver(doc);
    this.calibration = calibration;
    this.monochrome = (request.styleTable ?? "").toLowerCase() === "monochrome.ctb";
    this.lineweights = request.lineweights ?? true;
    this.fillMode = doc.header.num("$FILLMODE", 1) !== 0;
    this.pdmode = doc.header.num("$PDMODE", 0);
  }

  private note(what: string): void {
    this.unsupported[what] = (this.unsupported[what] ?? 0) + 1;
  }

  // ---- traversal ---------------------------------------------------------------------------

  drawBlock(block: Block): void {
    this.drawEntities(block.entities, {
      m: Matrix44.identity(),
      inh: TOP_LEVEL,
      stack: [block.name.toUpperCase()],
    });
  }

  private drawEntities(entities: readonly Entity[], st: State): void {
    for (const e of entities) {
      try {
        this.drawEntity(e, st);
      } catch (err) {
        this.note(`error:${e.type}:${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  drawEntity(e: Entity, st: State): void {
    if (!this.props.isPlotted(e, st.inh)) {
      if (e.type !== "INSERT") return;
      // an INSERT on an off (not frozen) layer still shows content on other layers (note 07 §3)
      const l = this.props.layer(this.props.effectiveLayer(e, st.inh));
      if (l.frozen || e.invisible || !this.isInsertContentVisible(e)) return;
    }
    const b = this.builder;
    b.beginEntity(e.handle || `#${e.id}`);
    switch (e.type) {
      case "LINE":
        this.drawLine(e, st);
        break;
      case "CIRCLE":
        this.drawCircle(e, st);
        break;
      case "ARC":
        this.drawArc(e, st);
        break;
      case "ELLIPSE":
        this.drawEllipse(e, st);
        break;
      case "LWPOLYLINE":
        this.drawLwPolyline(e, st);
        break;
      case "POLYLINE":
        this.drawPolyline(e, st);
        break;
      case "SPLINE":
        this.drawSpline(e, st);
        break;
      case "POINT":
        this.drawPoint(e, st);
        break;
      case "SOLID":
      case "TRACE":
        this.drawSolid(e, st);
        break;
      case "3DFACE":
        this.draw3dFace(e, st);
        break;
      case "RAY":
      case "XLINE":
        this.drawRay(e, st);
        break;
      case "INSERT":
        b.endEntity();
        this.drawInsert(e, st);
        return;
      default:
        this.drawOther(e, st);
    }
    b.endEntity();
  }

  private isInsertContentVisible(_e: InsertEntity): boolean {
    return true;
  }

  // ---- output ------------------------------------------------------------------------------

  private color(r: Resolved): Rgba {
    if (this.monochrome) return [0, 0, 0, 255];
    return [r.rgb[0], r.rgb[1], r.rgb[2], 255];
  }

  /** Lineweight in device pixels, or 0 for a hairline. */
  private widthPx(r: Resolved): number {
    if (!this.lineweights || r.lineweight <= 0) return 0;
    const px = (r.lineweight / 100) * (this.calibration.dpi / 25.4);
    return px <= this.calibration.hairlineMaxPx ? 0 : px;
  }

  /** Strokes a 2D path (target coordinates) with the entity's lineweight. */
  private strokePath(path: Path2, r: Resolved): void {
    const tol = this.pixelSize * TOLERANCE_PX;
    const color = this.color(r);
    const w = this.widthPx(r) * this.pixelSize;
    for (const pl of flattenPath(path, tol)) {
      if (w === 0) this.builder.polyline(pl.points, color, pl.closed);
      else this.strokePolyline(pl.points, pl.closed, w, color);
    }
  }

  /**
   * Interim stroker: rectangles per segment plus square-ish joins.
   * TODO: replace with @truedxf/geometry's stroker (caps/joins per calibration).
   */
  private strokePolyline(xy: Float64Array, closed: boolean, width: number, color: Rgba): void {
    this.note("interim-stroker");
    const n = xy.length >> 1;
    const h = width / 2;
    const tri: number[] = [];
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const x0 = xy[i * 2]!;
      const y0 = xy[i * 2 + 1]!;
      const j = (i + 1) % n;
      const x1 = xy[j * 2]!;
      const y1 = xy[j * 2 + 1]!;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const nx = (-dy / len) * h;
      const ny = (dx / len) * h;
      tri.push(
        x0 + nx,
        y0 + ny,
        x1 + nx,
        y1 + ny,
        x1 - nx,
        y1 - ny,
        x0 + nx,
        y0 + ny,
        x1 - nx,
        y1 - ny,
        x0 - nx,
        y0 - ny,
      );
    }
    this.builder.triangles(tri, color);
  }

  private fillPolygon(pts: readonly { x: number; y: number }[], r: Resolved): void {
    // convex fan (SOLID/TRACE quads are convex or bow-ties; bow-ties are drawn as two triangles)
    const color = this.color(r);
    const tri: number[] = [];
    for (let i = 1; i + 1 < pts.length; i++) {
      tri.push(pts[0]!.x, pts[0]!.y, pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y);
    }
    this.builder.triangles(tri, color);
  }

  private curve(c: Curve3, st: State, r: Resolved, closed = false): void {
    const sp = projectCurve3(c, st.m);
    this.strokePath({ subpaths: [closed ? { ...sp, closed } : sp] }, r);
  }

  // ---- entities ----------------------------------------------------------------------------

  private drawLine(e: LineEntity, st: State): void {
    this.curve(line3(e.start, e.end), st, this.props.resolve(e, st.inh));
  }

  private drawCircle(e: CircleEntity, st: State): void {
    const arc = ocsArcToEllipticArc3(e.center, e.radius, 0, Math.PI * 2, e.extrusion);
    this.curve(ellipticArcCurve3(arc), st, this.props.resolve(e, st.inh), true);
  }

  private drawArc(e: ArcEntity, st: State): void {
    const sweep = degToRad(arcSpanDeg(e.startAngle, e.endAngle));
    const arc = ocsArcToEllipticArc3(e.center, e.radius, degToRad(e.startAngle), sweep, e.extrusion);
    this.curve(ellipticArcCurve3(arc), st, this.props.resolve(e, st.inh));
  }

  private drawEllipse(e: EllipseEntity, st: State): void {
    const el = ellipseFromDxf({
      center: e.center,
      majorAxis: e.majorAxis,
      ratio: e.ratio,
      startParam: e.startParam,
      endParam: e.endParam,
      extrusion: e.extrusion,
    });
    const full = Math.abs(Math.abs(el.sweep) - Math.PI * 2) < 1e-12;
    this.curve(ellipticArcCurve3(el), st, this.props.resolve(e, st.inh), full);
  }

  private drawLwPolyline(e: LwPolylineEntity, st: State): void {
    if (e.vertices.length === 0) return;
    const verts = e.vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge }));
    if (e.constantWidth > 0 || e.vertices.some((v) => v.startWidth > 0 || v.endWidth > 0))
      this.note("polyline-width");
    const sub = bulgePolylineToSubpath(verts, e.closed);
    const path = projectPlanarPath({ subpaths: [sub] }, e.extrusion, e.elevation, st.m);
    this.strokePath(path, this.props.resolve(e, st.inh));
  }

  private drawPolyline(e: PolylineEntity, st: State): void {
    const r = this.props.resolve(e, st.inh);
    const flags = e.flags;
    if (flags & 64) {
      this.drawPolyface(e, st, r);
      return;
    }
    if (flags & 16) {
      this.drawPolygonMesh(e, st, r);
      return;
    }
    // skip spline frame control points (flag 16); keep curve-fit (1) and spline-fit (8) vertices
    const verts = e.vertices.filter((v) => (v.flags & 16) === 0);
    if (verts.length === 0) return;
    if (flags & 8) {
      this.curve(
        polyline3(
          verts.map((v) => v.location),
          e.closed,
        ),
        st,
        r,
        e.closed,
      );
      return;
    }
    if ((flags & 4) === 0 && verts.some((v) => v.startWidth > 0 || v.endWidth > 0))
      this.note("polyline-width");
    const sub = bulgePolylineToSubpath(
      verts.map((v) => ({ x: v.location.x, y: v.location.y, bulge: flags & 4 ? 0 : v.bulge })),
      e.closed,
    );
    this.strokePath(projectPlanarPath({ subpaths: [sub] }, e.extrusion, e.elevationPoint.z, st.m), r);
  }

  private drawPolyface(e: PolylineEntity, st: State, r: Resolved): void {
    const vertices: Vec3[] = [];
    const faces: number[][] = [];
    for (const v of e.vertices) {
      if ((v.flags & 64) !== 0) vertices.push(v.location);
      else if ((v.flags & 128) !== 0) faces.push([...v.faceIndices]);
    }
    const seen = new Set<string>();
    for (const f of faces) {
      for (let i = 0; i < f.length; i++) {
        const a = f[i]!;
        const b = f[(i + 1) % f.length]!;
        if (a <= 0) continue; // negative index = invisible edge starting here
        const pa = vertices[Math.abs(a) - 1];
        const pb = vertices[Math.abs(b) - 1];
        if (!pa || !pb) continue;
        const key =
          Math.abs(a) < Math.abs(b) ? `${Math.abs(a)}-${Math.abs(b)}` : `${Math.abs(b)}-${Math.abs(a)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.curve(line3(pa, pb), st, r);
      }
    }
  }

  private drawPolygonMesh(e: PolylineEntity, st: State, r: Resolved): void {
    const m = e.m;
    const n = e.n;
    const pts = e.vertices.map((v) => v.location);
    if (m * n !== pts.length || m < 1 || n < 1) {
      this.note("mesh-count-mismatch");
      return;
    }
    const closedM = (e.flags & 1) !== 0;
    const closedN = (e.flags & 32) !== 0;
    for (let i = 0; i < m; i++) this.curve(polyline3(pts.slice(i * n, i * n + n), closedN), st, r, closedN);
    for (let j = 0; j < n; j++) {
      const col: Vec3[] = [];
      for (let i = 0; i < m; i++) col.push(pts[i * n + j]!);
      this.curve(polyline3(col, closedM), st, r, closedM);
    }
  }

  private drawSpline(e: SplineEntity, st: State): void {
    const res = buildSplineCurve({
      degree: e.degree,
      flags: e.flags,
      knots: e.knots,
      controlPoints: e.controlPoints,
      weights: e.weights,
      fitPoints: e.fitPoints,
      startTangent: e.startTangent,
      endTangent: e.endTangent,
    });
    if (!res.curve) {
      this.note("spline-invalid");
      return;
    }
    this.curve({ kind: "nurbs", curve: res.curve }, st, this.props.resolve(e, st.inh));
  }

  private drawPoint(e: PointEntity, st: State): void {
    const r = this.props.resolve(e, st.inh);
    const mode = this.pdmode;
    if ((mode & 31) === 1) return; // mode 1: nothing
    if (mode !== 0) this.note(`pdmode-${mode}`);
    const p = st.m.transformPoint(e.location);
    this.builder.points([p.x, p.y], this.color(r));
  }

  private drawSolid(e: SolidEntity, st: State): void {
    const r = this.props.resolve(e, st.inh);
    const m = st.m.multiply(ocsToWcsMatrix(e.extrusion));
    // drawing order 1-2-4-3 (note 03 §3)
    const q = [e.v0, e.v1, e.v3, e.v2].map((p) => m.transformPoint(p));
    if (this.fillMode) {
      this.fillPolygon([q[0]!, q[1]!, q[2]!], r);
      this.fillPolygon([q[0]!, q[2]!, q[3]!], r);
    } else this.strokePath({ subpaths: [projectCurve3(polyline3([e.v0, e.v1, e.v3, e.v2], true), m)] }, r);
  }

  private draw3dFace(e: Face3dEntity, st: State): void {
    const r = this.props.resolve(e, st.inh);
    const v = [e.v0, e.v1, e.v2, e.v3];
    for (let i = 0; i < 4; i++) {
      if (e.invisibleEdges & (1 << i)) continue;
      const a = v[i]!;
      const b = v[(i + 1) % 4]!;
      if (a.x === b.x && a.y === b.y && a.z === b.z) continue;
      this.curve(line3(a, b), st, r);
    }
  }

  private drawRay(e: RayEntity, st: State): void {
    const r = this.props.resolve(e, st.inh);
    const p = st.m.transformPoint(e.start);
    const d = st.m.transformDirection(e.direction);
    const len = Math.hypot(d.x, d.y);
    if (len === 0) return;
    // extend to the view diagonal (+ margin); the renderer clips to the canvas
    const v = this.view;
    const reach =
      Math.hypot(v.maxX - v.minX, v.maxY - v.minY) +
      Math.hypot(p.x - (v.minX + v.maxX) / 2, p.y - (v.minY + v.maxY) / 2);
    const k = reach / len;
    const t0 = e.type === "XLINE" ? -k : 0;
    const a = { x: p.x + d.x * t0, y: p.y + d.y * t0 };
    const b = { x: p.x + d.x * k, y: p.y + d.y * k };
    this.strokePath({ subpaths: [{ segments: [{ kind: "line", p0: a, p1: b }], closed: false }] }, r);
  }

  private drawInsert(e: InsertEntity, st: State): void {
    const block = this.doc.getBlock(e.blockName);
    if (!block) {
      this.note("missing-block");
      return;
    }
    const key = block.name.toUpperCase();
    if (st.stack.includes(key) || st.stack.length > MAX_BLOCK_DEPTH) {
      this.note("recursive-block");
      return;
    }
    const inh = this.props.inherit(e, st.inh);
    const base = block.basePoint;
    const ocs = ocsToWcsMatrix(e.extrusion);
    const rot = Matrix44.rotationZ(degToRad(e.rotation));
    const scale = Matrix44.scaling(e.scale.x, e.scale.y, e.scale.z);
    const toBase = Matrix44.translation(-base.x, -base.y, -base.z);
    const plotted = this.props.isPlotted(e, st.inh);
    for (let row = 0; row < e.rowCount; row++) {
      for (let col = 0; col < e.columnCount; col++) {
        // MINSERT spacing is rotated with the insert, not scaled (note 07 §2; ezdxf/LibreCAD)
        const cell = Matrix44.translation(col * e.columnSpacing, row * e.rowSpacing, 0);
        const local = Matrix44.product(
          ocs,
          Matrix44.translation(e.insert.x, e.insert.y, e.insert.z),
          rot,
          cell,
          scale,
          toBase,
        );
        this.drawEntities(block.entities, { m: st.m.multiply(local), inh, stack: [...st.stack, key] });
      }
    }
    // ATTRIBs are stored in their final position and drawn after the block content (note 07 §3)
    if (plotted && e.attribs.length > 0) this.note("attrib-text");
  }

  private drawOther(e: Entity, st: State): void {
    const anyE = e as EntityBase & { blockName?: string };
    // dimensions and tables: draw their anonymous geometry block as stored (note 05 / 07)
    if (
      (e.dxfType === "DIMENSION" || e.dxfType === "ACAD_TABLE" || e.dxfType.endsWith("_DIMENSION")) &&
      anyE.blockName
    ) {
      const block = this.doc.getBlock(anyE.blockName);
      if (block) {
        const inh = this.props.inherit(e, st.inh);
        this.drawEntities(block.entities, { m: st.m, inh, stack: [...st.stack, block.name.toUpperCase()] });
        return;
      }
    }
    this.note(`entity:${e.dxfType}`);
  }

  build(): DisplayList {
    return this.builder.build();
  }
}

function layoutBlock(doc: DxfDocument, name: string): Block {
  const k = name.toUpperCase();
  if (k === "MODEL") return doc.modelSpace;
  const l = doc.layouts.find((x) => x.name.toUpperCase() === k);
  return l?.block ?? doc.modelSpace;
}

/** Renders a plot request to a display list plus the view it must be shown with. */
export async function renderPlot(
  doc: DxfDocument,
  request: PlotRequest,
  env: RenderEnv = {},
): Promise<PlotResult> {
  const calibration = { ...DEFAULT_CALIBRATION, ...env.calibration };
  const block = layoutBlock(doc, request.layout);
  let view: View;
  if (request.area.type === "window") {
    view = fitWindow(request.area.min, request.area.max, request.canvas);
  } else {
    // extents: a first pass at a coarse resolution finds the drawing bounds
    const ext = doc.header.point("$EXTMAX", { x: 1, y: 1, z: 0 });
    const exn = doc.header.point("$EXTMIN", { x: 0, y: 0, z: 0 });
    const guess = fitWindow(
      [exn.x, exn.y],
      [Math.max(ext.x, exn.x + 1e-9), Math.max(ext.y, exn.y + 1e-9)],
      request.canvas,
    );
    const probe = new Frontend(doc, request, guess, calibration);
    probe.drawBlock(block);
    view = viewFromBounds(probe.build().bounds, request.canvas);
  }
  const fe = new Frontend(doc, request, view, calibration);
  fe.drawBlock(block);
  return { displayList: fe.build(), view, unsupported: fe.unsupported };
}
