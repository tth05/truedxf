/**
 * The rendering frontend: walks a layout of a DxfDocument and emits a display list for a target
 * resolution. It does all geometry work (tessellation, linetypes, lineweight widening, fills);
 * renderers only draw primitives (docs/PLAN.md §3 principle 5).
 *
 * Entity types are drawn by drawers registered with {@link registerDrawer} (see draw/*.ts,
 * text.ts). Drawers use the Frontend's output helpers so linetypes, lineweights, plot styles
 * and picking are applied uniformly.
 */
import {
  BooleanOp,
  booleanPolygons,
  DashUnits,
  dilateBySquare,
  dashPath,
  FillRule,
  flattenPath,
  LineCap,
  LineJoin,
  Matrix44,
  type Path2,
  strokeDot,
  strokePolyline,
  triangulateFill,
} from "@truedxf/geometry";
import type { Block, DxfDocument, Entity, InsertEntity } from "@truedxf/model";
import { plotAciToRgb } from "./aci.ts";
import { type DisplayList, DisplayListBuilder, type Rgba } from "./displaylist.ts";
import { DrawOrder } from "./draworder.ts";
import { drawSpace, findLayout, layoutAreaView } from "./layout.ts";
import { LinetypeResolver, type LinetypeSpec } from "./linetype.ts";
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
import { bandOffset, linePixels, lineweightPixels, PixelGrid } from "./raster.ts";
import { coverage, plotsTransparency } from "./transparency.ts";

export interface RenderEnv {
  /** Font bytes by file or family name (lower-cased); undefined when not available. */
  loadFont?: (name: string) => Promise<Uint8Array | undefined>;
  /**
   * Raster image file bytes for an IMAGEDEF path as written in the file (absolute, relative or
   * bare; the host decides how to search, e.g. relative to the DXF folder); undefined = missing.
   */
  loadImage?: (path: string) => Promise<Uint8Array | undefined>;
  /**
   * IMAGE and WIPEOUT (AutoCAD's ISM raster module): `draw` (default) or `omit`. accoreconsole
   * plots neither — not even frames (VERIFIED-BY-ACAD, images suite, note 07 §8.4) — so the
   * reference harness uses `omit`.
   */
  rasterEntities?: "draw" | "omit";
  calibration?: Partial<PlotCalibration>;
  /**
   * `autocad` (default for plots): emulate AutoCAD's raster plot rules exactly (pixel-snapped
   * thin lines rasterized on the CPU, measured lineweight widths, snapped fills, plot palette).
   * `smooth`: plain geometry for interactive viewing.
   */
  raster?: "autocad" | "smooth";
}

export interface PlotResult {
  displayList: DisplayList;
  view: View;
  /** Counts of things the frontend could not render (entity types, features). */
  unsupported: Record<string, number>;
}

export interface DrawState {
  /** Entity coordinates (WCS of the current block) → target 2D (x, y of the result). */
  readonly m: Matrix44;
  readonly inh: Inherited;
  /** Block names on the INSERT stack (cycle guard). */
  readonly stack: readonly string[];
  /**
   * Linetype pattern units → target units (default 1). INSERT transforms do not scale
   * linetypes (note 06 §2.5, VERIFIED-BY-ACAD `linetypes/insert-scale-*`); a viewport
   * (PSLTSCALE) is the only place that sets this.
   */
  readonly linetypeScale?: number;
}

export type EntityDrawer = (fe: Frontend, e: Entity, st: DrawState) => void;
export type AttribDrawer = (fe: Frontend, insert: InsertEntity, st: DrawState) => void;
export type Preparer = (doc: DxfDocument, env: RenderEnv) => Promise<void>;
/**
 * Called before a block reference's content is drawn (once per MINSERT cell) with the
 * reference and the state it is drawn in; returns a function undoing what it set up (clip,
 * entity filters) after the content, or undefined (XCLIP, draw/xclip.ts).
 */
export type BlockClipHook = (fe: Frontend, parent: Entity, st: DrawState) => (() => void) | undefined;

const DRAWERS = new Map<string, EntityDrawer>();
let attribDrawer: AttribDrawer | undefined;
let blockClipHook: BlockClipHook | undefined;
const PREPARERS: Preparer[] = [];

export function registerDrawer(types: string | readonly string[], drawer: EntityDrawer): void {
  for (const t of typeof types === "string" ? [types] : types) DRAWERS.set(t, drawer);
}

export function setAttribDrawer(d: AttribDrawer): void {
  attribDrawer = d;
}

export function setBlockClipHook(h: BlockClipHook): void {
  blockClipHook = h;
}

/** Async preparation before drawing (e.g. loading all fonts a document needs). */
export function registerPreparer(p: Preparer): void {
  PREPARERS.push(p);
}

/** Chord tolerance in device pixels for curve flattening. */
export const TOLERANCE_PX = 0.1;
const MAX_BLOCK_DEPTH = 64;

export interface StrokeOptions {
  /** Linetype generation: continuous over the whole path (PLINEGEN, single curves) or per segment. */
  units?: DashUnits;
  /** Ignore linetypes (e.g. hatch pattern lines, text). */
  noLinetype?: boolean;
}

export class Frontend {
  readonly doc: DxfDocument;
  readonly env: RenderEnv;
  readonly request: PlotRequest;
  readonly view: View;
  readonly pixelSize: number;
  /** Flattening tolerance in target (world) units. */
  readonly tolerance: number;
  /** Output; swapped for a capture builder while drawing a transparent entity. */
  builder: DisplayListBuilder;
  readonly props: PropertyResolver;
  readonly linetypes: LinetypeResolver;
  readonly calibration: PlotCalibration;
  readonly unsupported: Record<string, number> = {};
  readonly monochrome: boolean;
  readonly lineweights: boolean;
  readonly fillMode: boolean;
  /** Per-frontend caches for drawers (keyed by module). */
  readonly caches = new Map<string, unknown>();
  /** Device pixel grid when emulating AutoCAD's raster rules. */
  readonly grid: PixelGrid | undefined;
  /** Plot draw order of block entities (SORTENTSTABLE, draworder.ts). */
  readonly drawOrder: DrawOrder;
  /** Whether this plot honours transparency (PLOTTRANSPARENCYOVERRIDE / page setup). */
  readonly transparency: boolean;
  /**
   * Entity-level culling while drawing clipped content (front/back clip planes of viewports and
   * XCLIPs); an entity is skipped when any filter rejects it.
   */
  readonly entityFilters: ((e: Entity, st: DrawState) => boolean)[] = [];
  /** Clip stack (intersected regions, display-list clip indices); see pushClip. */
  private readonly clipStack: { rings: Float64Array[]; index: number; pointIndex: number }[] = [];
  private readonly pixelScratch: number[] = [];

  constructor(
    doc: DxfDocument,
    request: PlotRequest,
    view: View,
    calibration: PlotCalibration,
    env: RenderEnv = {},
  ) {
    this.doc = doc;
    this.env = env;
    this.request = request;
    this.view = view;
    this.pixelSize = pixelSizeOf(view, request.canvas);
    this.tolerance = this.pixelSize * TOLERANCE_PX;
    this.builder = new DisplayListBuilder(this.pixelSize);
    this.props = new PropertyResolver(doc);
    this.linetypes = new LinetypeResolver(doc);
    this.calibration = calibration;
    this.monochrome = (request.styleTable ?? "").toLowerCase() === "monochrome.ctb";
    this.lineweights = request.lineweights ?? true;
    this.fillMode = doc.header.num("$FILLMODE", 1) !== 0;
    this.grid = (env.raster ?? "autocad") === "autocad" ? new PixelGrid(view, request.canvas) : undefined;
    this.drawOrder = new DrawOrder(doc);
    this.transparency = plotsTransparency(doc, request);
  }

  note(what: string): void {
    this.unsupported[what] = (this.unsupported[what] ?? 0) + 1;
  }

  // ---- traversal ---------------------------------------------------------------------------

  drawBlock(block: Block, m: Matrix44 = Matrix44.identity()): void {
    this.drawEntities(this.drawOrder.entities(block), {
      m,
      inh: TOP_LEVEL,
      stack: [block.name.toUpperCase()],
    });
  }

  drawEntities(entities: readonly Entity[], st: DrawState): void {
    for (const e of entities) {
      try {
        this.drawEntity(e, st);
      } catch (err) {
        this.note(`error:${e.type}:${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  drawEntity(e: Entity, st: DrawState): void {
    for (const f of this.entityFilters) if (!f(e, st)) return;
    if (e.type === "INSERT") {
      this.drawInsert(e, st);
      return;
    }
    if (!this.props.isPlotted(e, st.inh)) return;
    const drawer = DRAWERS.get(e.type === "UNKNOWN" ? e.dxfType : e.type);
    if (!drawer) {
      this.note(`entity:${e.dxfType}`);
      return;
    }
    this.builder.beginEntity(e.handle || `#${e.id}`);
    if (this.transparency && this.grid && this.alpha(this.resolve(e, st)) < 255)
      this.drawTransparent(e, st, drawer);
    else drawer(this, e, st);
    this.builder.endEntity();
  }

  /**
   * A transparent entity is captured and re-emitted as single pixels, one batch per blend unit
   * (a fill, a stroke segment), so each unit blends once per pixel (transparency.ts).
   */
  private drawTransparent(e: Entity, st: DrawState, drawer: EntityDrawer): void {
    const out = this.builder;
    const capture = new DisplayListBuilder(this.pixelSize);
    this.builder = capture;
    try {
      drawer(this, e, st);
    } finally {
      this.builder = out;
    }
    // one blend unit per captured batch (a fill, a stroke segment, a run of pixels)
    for (const cov of coverage(capture.build(), this.grid!)) {
      out.breakBatch();
      const c = cov.rgba;
      for (let k = 0; k < cov.xy.length >> 1; k++)
        out.points(
          [cov.xy[k * 2]!, cov.xy[k * 2 + 1]!],
          [c[k * 4]!, c[k * 4 + 1]!, c[k * 4 + 2]!, c[k * 4 + 3]!],
        );
    }
    out.breakBatch();
  }

  /** Plotted alpha of resolved properties (255 when transparency does not plot). */
  alpha(r: Resolved): number {
    if (!this.transparency) return 255;
    return (r as Resolved & { alpha?: number }).alpha ?? 255;
  }

  /** Draws a block's entities with an additional transform and the parent's inherited properties. */
  drawBlockContent(block: Block, local: Matrix44, parent: Entity, st: DrawState): boolean {
    const key = block.name.toUpperCase();
    if (st.stack.includes(key) || st.stack.length > MAX_BLOCK_DEPTH) {
      this.note("recursive-block");
      return false;
    }
    const inh = this.props.inherit(parent, st.inh);
    const m = st.m.multiply(local);
    const done = blockClipHook?.(this, parent, st);
    this.drawEntities(this.drawOrder.entities(block), {
      m,
      inh,
      stack: [...st.stack, key],
      linetypeScale: st.linetypeScale,
    });
    done?.();
    return true;
  }

  private drawInsert(e: InsertEntity, st: DrawState): void {
    if (e.invisible) return;
    const layer = this.props.layer(this.props.effectiveLayer(e, st.inh));
    // A frozen INSERT layer hides the whole reference; an off layer only hides content that
    // inherits it (layer-0 entities). UNVERIFIED (note 07 §3 / note 02).
    if (layer.frozen) return;
    const drawer = DRAWERS.get("INSERT");
    if (!drawer) return;
    drawer(this, e, st);
    if (e.attribs.length > 0 && this.props.isPlotted(e, st.inh)) {
      if (attribDrawer) attribDrawer(this, e, st);
      else this.note("attrib-text");
    }
  }

  // ---- clipping ----------------------------------------------------------------------------

  /**
   * Restricts subsequent output to a region (rings in target coordinates, even-odd), intersected
   * with the current clip. Renderers clip per pixel centre (three.js stencil, cpu-raster): areas
   * (fills, widened strokes) keep pixels whose centre is inside, which matches AutoCAD's straight
   * cut of thick strokes at viewport borders (note 08 §3.6). Single-pixel output of thin lines
   * uses the region dilated by half a pixel, i.e. a pixel is kept when it touches the region —
   * the pixels AutoCAD draws for a line clipped geometrically, boundary included (the end pixel
   * of a clipped line is the one containing the boundary point; lines lying on the boundary stay).
   */
  pushClip(rings: readonly Float64Array[]): void {
    let r = rings.filter((x) => x.length >= 6);
    const top = this.clipStack[this.clipStack.length - 1];
    if (top) {
      r = booleanPolygons(BooleanOp.Intersection, top.rings, r, {
        tolerance: this.tolerance / 16,
        subjectFillRule: FillRule.EvenOdd,
        clipFillRule: FillRule.EvenOdd,
      }).flatMap((p) => [p.outer, ...p.holes]);
    }
    // an empty region hides everything: keep a degenerate ring so the renderer still clips
    if (r.length === 0) r = [Float64Array.of(0, 0, 0, 0, 0, 0)];
    const index = this.builder.addClip({ rings: r });
    let pointIndex = index;
    if (this.grid) {
      const d = dilateBySquare(r, this.pixelSize / 2, { tolerance: this.tolerance / 16 });
      pointIndex = this.builder.addClip({ rings: d.flatMap((p) => [p.outer, ...p.holes]) });
    }
    this.clipStack.push({ rings: r, index, pointIndex });
    this.builder.setClip(index, pointIndex);
  }

  popClip(): void {
    this.clipStack.pop();
    const top = this.clipStack[this.clipStack.length - 1];
    if (top) this.builder.setClip(top.index, top.pointIndex);
    else this.builder.setClip(-1);
  }

  // ---- output ------------------------------------------------------------------------------

  resolve(e: Entity, st: DrawState): Resolved {
    return this.props.resolve(e, st.inh);
  }

  color(r: Resolved): Rgba {
    const a = this.alpha(r);
    // true colours keep their RGB even with monochrome.ctb (note 08 §10.7)
    if (r.trueColor !== undefined) return [r.rgb[0], r.rgb[1], r.rgb[2], a];
    if (this.monochrome) return [0, 0, 0, a];
    if (this.grid) {
      const [red, g, b] = plotAciToRgb(r.aci);
      return [red, g, b, a];
    }
    return [r.rgb[0], r.rgb[1], r.rgb[2], a];
  }

  /** Plotted lineweight in device pixels (≥ 1). */
  widthPixels(r: Resolved): number {
    if (!this.lineweights) return 1;
    return lineweightPixels(r.lineweight, this.calibration.dpi);
  }

  /** A single device pixel (POINT, which ignores lineweights). */
  pixel(x: number, y: number, color: Rgba): void {
    if (this.grid) {
      const [cx, cy] = this.grid.snapCenter(x, y);
      this.builder.points([cx, cy], color);
    } else this.builder.points([x, y], color);
  }

  /** Lineweight in target units, or 0 for a 1-px hairline. */
  strokeWidth(r: Resolved): number {
    if (!this.lineweights || r.lineweight <= 0) return 0;
    const px = (r.lineweight / 100) * (this.calibration.dpi / 25.4);
    return px <= this.calibration.hairlineMaxPx ? 0 : px * this.pixelSize;
  }

  /** Uniform scale of the transform in the target plane (for linetype scaling). */
  transformScale(m: Matrix44): number {
    const a = m.transformDirection({ x: 1, y: 0, z: 0 });
    const b = m.transformDirection({ x: 0, y: 1, z: 0 });
    const det = Math.abs(a.x * b.y - a.y * b.x);
    return det > 0 ? Math.sqrt(det) : Math.hypot(a.x, a.y) || 1;
  }

  linetypeFor(e: Entity, r: Resolved, st: DrawState): LinetypeSpec | undefined {
    return this.linetypes.spec(r.linetype, e.linetypeScale, st.linetypeScale ?? 1);
  }

  /**
   * Strokes a 2D path (target coordinates) with the entity's linetype and lineweight.
   * `e` supplies the linetype scale; pass `options.noLinetype` for continuous output.
   */
  strokePath(
    path: Path2,
    r: Resolved,
    e: Entity | undefined,
    st: DrawState,
    options: StrokeOptions = {},
  ): void {
    const lt = !options.noLinetype && e ? this.linetypeFor(e, r, st) : undefined;
    if (!lt) {
      for (const pl of this.flatten(path)) this.strokeFlat(pl.points, pl.closed, r);
      return;
    }
    const results = dashPath(path, lt.pattern, this.tolerance, {
      units: options.units ?? DashUnits.Continuous,
    });
    const color = this.color(r);
    const w = this.strokeWidth(r);
    for (const res of results) {
      for (const d of res.dashes) this.strokeFlat(d, res.whole, r);
      const dots = res.dots;
      for (let i = 0; i + 2 < dots.length; i += 3) {
        if (w === 0) this.builder.points([dots[i]!, dots[i + 1]!], color);
        else
          this.builder.triangles(
            strokeDot(dots[i]!, dots[i + 1]!, dots[i + 2]!, this.strokeOptions(w)),
            color,
          );
      }
      if (res.placements.length > 0) this.note("complex-linetype-element");
    }
  }

  private strokeOptions(w: number) {
    // Round caps/joins: ASSUMPTION until calibration (note 06 §5.2)
    return { width: w, cap: LineCap.Round, join: LineJoin.Round, tolerance: this.tolerance };
  }

  /** Strokes a flattened polyline (target coordinates) with the entity's lineweight. */
  strokeFlat(points: Float64Array, closed: boolean, r: Resolved): void {
    if (points.length < 2) return;
    if (this.grid) {
      this.rasterStroke(points, closed, r);
      return;
    }
    const color = this.color(r);
    const w = this.strokeWidth(r);
    if (w === 0) {
      if (points.length === 2) this.builder.points(points, color);
      else this.builder.polyline(points, color, closed);
      return;
    }
    this.builder.triangles(strokePolyline(points, { ...this.strokeOptions(w), closed }), color);
  }

  /** AutoCAD raster rules for strokes (see raster.ts). */
  private rasterStroke(points: Float64Array, closed: boolean, r: Resolved): void {
    const g = this.grid!;
    const color = this.color(r);
    const w = this.widthPixels(r);
    const n = points.length >> 1;
    if (w <= 1) {
      const out = this.pixelScratch;
      out.length = 0;
      const count = n === 1 ? 1 : closed ? n : n - 1;
      for (let k = 0; k < count; k++) {
        const a = k;
        const b = n === 1 ? 0 : (k + 1) % n;
        const i0 = g.px(points[a * 2]!);
        const j0 = g.py(points[a * 2 + 1]!);
        const i1 = g.px(points[b * 2]!);
        const j1 = g.py(points[b * 2 + 1]!);
        if (!g.visible(i0, j0, i1, j1)) continue;
        linePixels(i0, j0, i1, j1, out, g);
      }
      if (out.length === 0) return;
      const xy = new Float64Array(out.length);
      for (let k = 0; k < out.length; k += 2) {
        xy[k] = g.cx(out[k]!);
        xy[k + 1] = g.cy(out[k + 1]!);
      }
      this.builder.points(xy, color);
      return;
    }
    // snapped centre line (+ half a pixel up/right for even widths), round caps/joins
    const off = bandOffset(w) * g.pixelSize;
    const snapped = new Float64Array(points.length);
    for (let k = 0; k < n; k++) {
      snapped[k * 2] = g.cx(g.px(points[k * 2]!)) + off;
      snapped[k * 2 + 1] = g.cy(g.py(points[k * 2 + 1]!)) + off;
    }
    const opts = {
      width: w * g.pixelSize,
      cap: LineCap.Round,
      join: LineJoin.Round,
      tolerance: this.tolerance,
    };
    if (color[3] < 255) {
      // transparent strokes blend segment by segment: joints darken twice (transparency.ts)
      const count = closed ? n : n - 1;
      for (let k = 0; k < count; k++) {
        const b = (k + 1) % n;
        const seg = [snapped[k * 2]!, snapped[k * 2 + 1]!, snapped[b * 2]!, snapped[b * 2 + 1]!];
        this.builder.triangles(strokePolyline(Float64Array.from(seg), { ...opts, closed: false }), color);
        this.builder.breakBatch();
      }
      return;
    }
    this.builder.triangles(strokePolyline(snapped, { ...opts, closed }), color);
  }

  fillTriangles(tri: ArrayLike<number>, color: Rgba): void {
    const g = this.grid;
    if (!g) {
      this.builder.triangles(tri, color);
      return;
    }
    // fill vertices snap to pixel corners; pixel-centre coverage (note 08 §10.5)
    const out = new Float64Array(tri.length);
    for (let k = 0; k + 1 < tri.length; k += 2) {
      out[k] = g.ex(g.px(tri[k]!));
      out[k + 1] = g.ey(g.py(tri[k + 1]!));
    }
    this.builder.triangles(out, color);
  }

  /** Fills rings (target coordinates) with a fill rule. */
  fillRings(rings: readonly Float64Array[], color: Rgba, fillRule: FillRule = FillRule.NonZero): void {
    if (rings.length === 0) return;
    this.fillTriangles(triangulateFill(rings, { fillRule, tolerance: this.tolerance }), color);
  }

  /** Flattens a path with the plot-mode curve rules (see PlotCalibration.arcStepDeg). */
  flatten(path: Path2): { points: Float64Array; closed: boolean }[] {
    const step = this.grid ? this.calibration.arcStepDeg : undefined;
    if (!step) return flattenPath(path, this.tolerance);
    const out: { points: Float64Array; closed: boolean }[] = [];
    for (const sp of path.subpaths) {
      const pts: number[] = [];
      for (const seg of sp.segments) {
        if (seg.kind === "arc" || seg.kind === "ellipticArc") {
          const n = Math.max(1, Math.ceil(Math.abs(seg.sweep) / ((step * Math.PI) / 180) - 1e-9));
          const dr = (this.calibration.arcRadiusOffsetPx ?? 0) * this.pixelSize;
          for (let k = pts.length === 0 ? 0 : 1; k <= n; k++) {
            const t = seg.start + (seg.sweep * k) / n;
            if (seg.kind === "arc")
              pts.push(
                seg.center.x + (seg.radius + dr) * Math.cos(t),
                seg.center.y + (seg.radius + dr) * Math.sin(t),
              );
            else
              pts.push(
                seg.center.x + seg.u.x * Math.cos(t) + seg.v.x * Math.sin(t),
                seg.center.y + seg.u.y * Math.cos(t) + seg.v.y * Math.sin(t),
              );
          }
        } else {
          const fl = flattenPath({ subpaths: [{ segments: [seg], closed: false }] }, this.tolerance)[0];
          if (!fl) continue;
          const start = pts.length === 0 ? 0 : 2;
          for (let k = start; k < fl.points.length; k++) pts.push(fl.points[k]!);
        }
      }
      let arr = Float64Array.from(pts);
      if (sp.closed && arr.length >= 4 && arr[0] === arr[arr.length - 2] && arr[1] === arr[arr.length - 1]) {
        arr = arr.slice(0, arr.length - 2);
      }
      out.push({ points: arr, closed: sp.closed });
    }
    return out;
  }

  /** Fills a path (target coordinates). */
  fillPath(path: Path2, color: Rgba, fillRule: FillRule = FillRule.NonZero): void {
    this.fillRings(
      this.flatten(path).map((p) => p.points),
      color,
      fillRule,
    );
  }

  build(): DisplayList {
    return this.builder.build();
  }
}

/** Renders a plot request to a display list plus the view it must be shown with. */
export async function renderPlot(
  doc: DxfDocument,
  request: PlotRequest,
  env: RenderEnv = {},
): Promise<PlotResult> {
  for (const p of PREPARERS) await p(doc, env);
  const calibration = { ...DEFAULT_CALIBRATION, ...env.calibration };
  const space = findLayout(doc, request.layout);
  let view: View;
  if (request.area.type === "window") {
    view = fitWindow(request.area.min, request.area.max, request.canvas);
  } else if (request.area.type === "layout" && !space.isModel) {
    view = layoutAreaView(request);
  } else {
    // extents: a first pass at a coarse resolution finds the drawing bounds
    const ext = doc.header.point("$EXTMAX", { x: 1, y: 1, z: 0 });
    const exn = doc.header.point("$EXTMIN", { x: 0, y: 0, z: 0 });
    const guess = fitWindow(
      [exn.x, exn.y],
      [Math.max(ext.x, exn.x + 1e-9), Math.max(ext.y, exn.y + 1e-9)],
      request.canvas,
    );
    const probe = new Frontend(doc, request, guess, calibration, env);
    drawSpace(probe, space);
    view = viewFromBounds(probe.build().bounds, request.canvas);
  }
  const fe = new Frontend(doc, request, view, calibration, env);
  drawSpace(fe, space);
  return { displayList: fe.build(), view, unsupported: fe.unsupported };
}
