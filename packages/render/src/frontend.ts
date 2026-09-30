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
  DashUnits,
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
import { type DisplayList, DisplayListBuilder, type Rgba } from "./displaylist.ts";
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

export interface DrawState {
  /** Entity coordinates (WCS of the current block) → target 2D (x, y of the result). */
  readonly m: Matrix44;
  readonly inh: Inherited;
  /** Block names on the INSERT stack (cycle guard). */
  readonly stack: readonly string[];
}

export type EntityDrawer = (fe: Frontend, e: Entity, st: DrawState) => void;
export type AttribDrawer = (fe: Frontend, insert: InsertEntity, st: DrawState) => void;
export type Preparer = (doc: DxfDocument, env: RenderEnv) => Promise<void>;

const DRAWERS = new Map<string, EntityDrawer>();
let attribDrawer: AttribDrawer | undefined;
const PREPARERS: Preparer[] = [];

export function registerDrawer(types: string | readonly string[], drawer: EntityDrawer): void {
  for (const t of typeof types === "string" ? [types] : types) DRAWERS.set(t, drawer);
}

export function setAttribDrawer(d: AttribDrawer): void {
  attribDrawer = d;
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
  readonly builder: DisplayListBuilder;
  readonly props: PropertyResolver;
  readonly linetypes: LinetypeResolver;
  readonly calibration: PlotCalibration;
  readonly unsupported: Record<string, number> = {};
  readonly monochrome: boolean;
  readonly lineweights: boolean;
  readonly fillMode: boolean;
  /** Per-frontend caches for drawers (keyed by module). */
  readonly caches = new Map<string, unknown>();

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
  }

  note(what: string): void {
    this.unsupported[what] = (this.unsupported[what] ?? 0) + 1;
  }

  // ---- traversal ---------------------------------------------------------------------------

  drawBlock(block: Block, m: Matrix44 = Matrix44.identity()): void {
    this.drawEntities(block.entities, { m, inh: TOP_LEVEL, stack: [block.name.toUpperCase()] });
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
    drawer(this, e, st);
    this.builder.endEntity();
  }

  /** Draws a block's entities with an additional transform and the parent's inherited properties. */
  drawBlockContent(block: Block, local: Matrix44, parent: Entity, st: DrawState): boolean {
    const key = block.name.toUpperCase();
    if (st.stack.includes(key) || st.stack.length > MAX_BLOCK_DEPTH) {
      this.note("recursive-block");
      return false;
    }
    const inh = this.props.inherit(parent, st.inh);
    this.drawEntities(block.entities, { m: st.m.multiply(local), inh, stack: [...st.stack, key] });
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

  // ---- output ------------------------------------------------------------------------------

  resolve(e: Entity, st: DrawState): Resolved {
    return this.props.resolve(e, st.inh);
  }

  color(r: Resolved): Rgba {
    if (this.monochrome) return [0, 0, 0, 255];
    return [r.rgb[0], r.rgb[1], r.rgb[2], 255];
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
    return this.linetypes.spec(r.linetype, e.linetypeScale, this.transformScale(st.m));
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
      for (const pl of flattenPath(path, this.tolerance)) this.strokeFlat(pl.points, pl.closed, r);
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
    const color = this.color(r);
    const w = this.strokeWidth(r);
    if (w === 0) {
      if (points.length === 2) this.builder.points(points, color);
      else this.builder.polyline(points, color, closed);
      return;
    }
    this.builder.triangles(strokePolyline(points, { ...this.strokeOptions(w), closed }), color);
  }

  fillTriangles(tri: ArrayLike<number>, color: Rgba): void {
    this.builder.triangles(tri, color);
  }

  /** Fills rings (target coordinates) with a fill rule. */
  fillRings(rings: readonly Float64Array[], color: Rgba, fillRule: FillRule = FillRule.NonZero): void {
    if (rings.length === 0) return;
    this.builder.triangles(triangulateFill(rings, { fillRule, tolerance: this.tolerance }), color);
  }

  /** Fills a path (target coordinates). */
  fillPath(path: Path2, color: Rgba, fillRule: FillRule = FillRule.NonZero): void {
    this.fillRings(
      flattenPath(path, this.tolerance).map((p) => p.points),
      color,
      fillRule,
    );
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
  for (const p of PREPARERS) await p(doc, env);
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
    const probe = new Frontend(doc, request, guess, calibration, env);
    probe.drawBlock(block);
    view = viewFromBounds(probe.build().bounds, request.canvas);
  }
  const fe = new Frontend(doc, request, view, calibration, env);
  fe.drawBlock(block);
  return { displayList: fe.build(), view, unsupported: fe.unsupported };
}
