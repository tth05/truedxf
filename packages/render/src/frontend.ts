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
  type ComplexPlacement,
  DashUnits,
  dashPath,
  dilateBySquare,
  ellipticArc2SemiAxes,
  FillRule,
  flattenPath,
  type HatchLoop,
  hatchSolidTriangles,
  LineCap,
  LineJoin,
  Matrix44,
  type Path2,
  selectHatchLoops,
  strokeDot,
  strokePolyline,
  triangulateFill,
} from "@truedxf/geometry";
import type { Block, DxfDocument, Entity, InsertEntity } from "@truedxf/model";
import { plotAciToRgb } from "./aci.ts";
import { BlockRecorder, type BlockStream, replayBlockStream, splitBlockTransform } from "./block-stream.ts";
import { type DisplayList, DisplayListBuilder, type Rgba } from "./displaylist.ts";
import { DrawOrder } from "./draworder.ts";
import { drawSpace, findLayout, layoutAreaView } from "./layout.ts";
import { LinetypeResolver, type LinetypeSpec } from "./linetype.ts";
import type { PdfRasterizer } from "./pdf.ts";
import {
  DEFAULT_CALIBRATION,
  fitWindow,
  type PlotCalibration,
  type PlotRequest,
  pixelSizeOf,
  type View,
  viewFromBounds,
} from "./plot.ts";
import { droppedOnLoad, type Inherited, PropertyResolver, type Resolved, TOP_LEVEL } from "./props.ts";
import {
  arcVertices,
  fillConvexByEdges,
  fillPolygon,
  GS_FILL_FACTOR,
  GS_STROKE_FACTOR,
  gsSegmentCount,
  linePixels,
  lineweightPixels,
  PixelGrid,
  SpanSet,
  strokeDotPixels,
  strokeSegmentPolygon,
  trapezoids,
} from "./raster.ts";
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
   * plots neither — not even frames — in R2004+ files, but plots both in R2000 and older files
   * (VERIFIED-BY-ACAD, images suite, render-probes/imgver-*, note 07 §8.5); `omit` emulates that
   * (omits them for R2004+ only), the reference harness uses it.
   */
  rasterEntities?: "draw" | "omit";
  /**
   * PDF underlay content: a rasterizer such as `@truedxf/pdf` (PDF.js). Without one only the
   * underlay frames are drawn (note 07 §10.3). PDF files are fetched with `loadImage`.
   */
  pdf?: PdfRasterizer;
  calibration?: Partial<PlotCalibration>;
  /**
   * `autocad` (default for plots): emulate AutoCAD's raster plot rules exactly (pixel-snapped
   * thin lines rasterized on the CPU, measured lineweight widths, snapped fills, plot palette).
   * `smooth`: plain geometry for interactive viewing.
   */
  raster?: "autocad" | "smooth";
  /** Approximate sub-pixel geometry for interactive viewing; honoured only with smooth raster. */
  lod?: boolean;
  /** Disable viewer block reuse for fidelity/performance comparisons; ignored without LOD. */
  blockReuse?: boolean;
  /** Viewer-only rejection of top-level picks, including model entities in paper viewports. */
  topLevelFilter?: (e: Entity) => boolean;
  /**
   * Background (paper) colour, default white. ACI 7 contrasts with it; with `raster: "smooth"`
   * (near-)white / (near-)black colours do too (interactive viewers); plots are on white paper.
   */
  background?: readonly [number, number, number];
  /**
   * Viewer layer toggles by upper-case layer name. `false` hides a layer like turning it off (an
   * entity is skipped when its effective layer is hidden; layer-0 block content takes the
   * INSERT's layer; block references are still traversed). `true` shows a layer that is off or
   * frozen in the file.
   */
  layerVisibility?: ReadonlyMap<string, boolean>;
  /**
   * `plot` (default): what a plot shows. `display`: what the screen shows — no-plot and
   * Defpoints layers are drawn too (interactive viewers).
   */
  visibility?: "plot" | "display";
}

export interface PlotResult {
  displayList: DisplayList;
  view: View;
  /** Counts of things the frontend could not render (entity types, features). */
  unsupported: Record<string, number>;
  /** Diagnostics for the user (e.g. missing fonts); absent when there are none. */
  notes?: PlotNote[];
}

/** A user-facing diagnostic of a render, e.g. `{ code: "font-missing", items: ["txt.shx"] }`. */
export interface PlotNote {
  /** Stable machine-readable id ("font-missing", "bigfont-missing", …). */
  code: string;
  message: string;
  severity?: "info" | "warning";
  /** How many things are affected (e.g. text styles / inline fonts). */
  count?: number;
  /** The names concerned (e.g. missing font files or families). */
  items?: string[];
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
/** Draws complex linetype elements (shapes / texts) placed by the dash engine (draw/complex-linetype.ts). */
export type ComplexElementDrawer = (
  fe: Frontend,
  placements: readonly ComplexPlacement[],
  e: Entity,
  r: Resolved,
  st: DrawState,
) => void;
/** Async preparation before drawing; may return user-facing notes for the PlotResult. */
// biome-ignore lint/suspicious/noConfusingVoidType: existing preparers are `async () => {}` (Promise<void>)
export type Preparer = (doc: DxfDocument, env: RenderEnv) => Promise<void | readonly PlotNote[]>;
/**
 * Called before a block reference's content is drawn (once per MINSERT cell) with the
 * reference and the state it is drawn in; returns a function undoing what it set up (clip,
 * entity filters) after the content, or undefined (XCLIP, draw/xclip.ts).
 */
export type BlockClipHook = (fe: Frontend, parent: Entity, st: DrawState) => (() => void) | undefined;

const DRAWERS = new Map<string, EntityDrawer>();
let attribDrawer: AttribDrawer | undefined;
let complexDrawer: ComplexElementDrawer | undefined;
let blockClipHook: BlockClipHook | undefined;
let staticBlockClips = false;
const PREPARERS: Preparer[] = [];

export function registerDrawer(types: string | readonly string[], drawer: EntityDrawer): void {
  for (const t of typeof types === "string" ? [types] : types) DRAWERS.set(t, drawer);
}

export function setComplexElementDrawer(d: ComplexElementDrawer): void {
  complexDrawer = d;
}

export function setAttribDrawer(d: AttribDrawer): void {
  attribDrawer = d;
}

/**
 * `staticContent` is reserved for the built-in metadata-based XCLIP hook: the eligibility walk
 * rejects extension dictionaries. Arbitrary hooks can depend on the current pick/transform,
 * even when the first reference has no clip, so they disable block reuse throughout a render.
 */
export function setBlockClipHook(h: BlockClipHook, staticContent = false): BlockClipHook | undefined {
  const previous = blockClipHook;
  blockClipHook = h;
  staticBlockClips = staticContent;
  return previous;
}

/** Async preparation before drawing (e.g. loading all fonts a document needs). */
export function registerPreparer(p: Preparer): void {
  PREPARERS.push(p);
}

/** Linetype periods below this many device pixels plot continuous (note 06 §2.6.1). */
export const DENSE_LINETYPE_PERIOD_PX = 0.5;

/**
 * Upright (U=) linetype elements flip when the line points left **in the entity's own block
 * coordinates**: a mirrored or rotated INSERT does not flip them. VERIFIED-BY-ACAD
 * (linetypes/ctext-insert-mirror, ctext-insert-rotate). Undefined = decide in target coordinates.
 */
function blockUpsideDown(m: Matrix44): ((t: number) => boolean) | undefined {
  const x = m.transformDirection({ x: 1, y: 0, z: 0 });
  const y = m.transformDirection({ x: 0, y: 1, z: 0 });
  if (x.x === 1 && x.y === 0 && y.x === 0 && y.y === 1) return undefined;
  const det = x.x * y.y - x.y * y.x;
  if (det === 0) return undefined;
  // first row of the inverse of [x y]: the block x component of a target direction
  const i0 = y.y / det;
  const i1 = -y.x / det;
  return (t) => i0 * Math.cos(t) + i1 * Math.sin(t) < -1e-9;
}

/** Chord tolerance in device pixels for curve flattening. */
export const TOLERANCE_PX = 0.1;
const MAX_BLOCK_DEPTH = 64;
/** Interactive display: colours within this of white / black count as white / black (Frontend.color). */
const NEAR_EXTREME = 8;

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
  /** Colours flipped for contrast by color() (interactive display): "#RRGGBB" / "ACI n" → layers. */
  readonly contrastFlips = new Map<string, Set<string>>();
  readonly monochrome: boolean;
  readonly lineweights: boolean;
  readonly fillMode: boolean;
  /** Per-frontend caches for drawers (keyed by module). */
  readonly caches = new Map<string, unknown>();
  /** Device pixel grid when emulating AutoCAD's raster rules. */
  readonly grid: PixelGrid | undefined;
  readonly lod: boolean;
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
  private readonly clipStack: {
    rings: Float64Array[];
    index: number;
    pointIndex: number;
    /** Boundary edges (x0, y0, x1, y1 …) whose collinear strokes are dropped, see pushClip. */
    edges?: Float64Array;
  }[] = [];
  private readonly pixelScratch: number[] = [];
  /**
   * Pick identity of the top-level entity being drawn. Everything drawn inside it (block
   * content, ATTRIBs, generated dimension / leader geometry, arrow blocks) belongs to it, like
   * AutoCAD's selection picks the block reference or dimension, not its parts.
   */
  pickOwner: string | undefined;
  /** Numbers count direct uses until a repeated key earns a recording. */
  private readonly blockStreams = new Map<Block, Map<string, BlockStream | number>>();
  private readonly blockFirstUses = new Map<Block, { st: DrawState; extents: boolean; display: boolean }>();
  private readonly reusableBlocks = new Map<Block, boolean>();
  private recordedVertices = 0;
  private recordedCommands = 0;
  private recordedEntries = 0;
  private observedBlockKeys = 0;
  private recordingBlock = false;
  private blockCacheFull = false;
  private readonly blockReplayWorkspace = { xy: new Float64Array(0) };
  /** Async work run by finish() before the list is handed out (PDF underlay bitmaps). */
  private readonly deferred: (() => Promise<void>)[] = [];

  /** Pick identity of an entity: the top-level entity it is drawn in, its handle, or "#id". */
  pickId(e: Entity): string {
    return this.pickOwner ?? (e.handle || `#${e.id}`);
  }

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
    const background: [number, number, number] = env.background ? [...env.background] : [255, 255, 255];
    this.builder.background = background;
    const lwDefault = request.sysvars?.LWDEFAULT;
    this.props = new PropertyResolver(
      doc,
      background,
      typeof lwDefault === "number" ? lwDefault : undefined,
      env.layerVisibility,
    );
    this.props.display = env.visibility === "display";
    this.linetypes = new LinetypeResolver(doc);
    this.calibration = calibration;
    this.monochrome = (request.styleTable ?? "").toLowerCase() === "monochrome.ctb";
    this.lineweights = request.lineweights ?? true;
    // Plot-time sysvars override the saved header (note 07 §15.7, shell-fillmode-zero).
    this.fillMode = Number(request.sysvars?.FILLMODE ?? doc.header.num("$FILLMODE", 1)) !== 0;
    this.grid = (env.raster ?? "autocad") === "autocad" ? new PixelGrid(view, request.canvas) : undefined;
    this.lod = env.lod === true && env.raster === "smooth";
    this.drawOrder = new DrawOrder(doc);
    this.transparency = plotsTransparency(doc, request);
  }

  note(what: string): void {
    this.unsupported[what] = (this.unsupported[what] ?? 0) + 1;
  }

  /**
   * Schedules async work that completes what was drawn (e.g. filling a placeholder bitmap):
   * drawing stays synchronous, and only the frontend whose list is returned runs it (finish()),
   * so the extents probes never do.
   */
  defer(task: () => Promise<void>): void {
    this.deferred.push(task);
  }

  /** Runs the deferred tasks in order (deterministic). */
  async finish(): Promise<void> {
    for (const t of this.deferred.splice(0)) await t();
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
    if (this.pickOwner !== undefined) {
      this.drawEntityContent(e, st);
      return;
    }
    if (this.env.topLevelFilter && !this.env.topLevelFilter(e)) return;
    // a top-level entity: one pick entity for all of its output
    const id = this.pickId(e);
    this.builder.beginEntity(id);
    this.pickOwner = id;
    try {
      this.drawEntityContent(e, st);
    } finally {
      this.pickOwner = undefined;
      this.builder.endEntity();
    }
  }

  private drawEntityContent(e: Entity, st: DrawState): void {
    if (droppedOnLoad(this.doc, e)) return;
    for (const f of this.entityFilters) if (!f(e, st)) return;
    if (e.type === "INSERT") {
      this.drawInsert(e, st);
      return;
    }
    if (!this.props.isPlotted(e, st.inh)) return;
    const vis = this.env.layerVisibility;
    if (vis && vis.size > 0 && vis.get(this.props.effectiveLayer(e, st.inh).toUpperCase()) === false) return;
    // entities without a drawer fall back to their proxy graphics (draw/proxy.ts, note 07 §15.3)
    const drawer =
      DRAWERS.get(e.type === "UNKNOWN" ? e.dxfType : e.type) ??
      (e.proxyGraphics ? DRAWERS.get("*PROXY-GRAPHICS") : undefined);
    if (!drawer) {
      this.note(`entity:${e.dxfType}`);
      return;
    }
    if (this.transparency && this.grid && this.alpha(this.resolve(e, st)) < 255)
      this.drawTransparent(e, st, drawer);
    else drawer(this, e, st);
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
    if (done && this.builder instanceof BlockRecorder) this.builder.unsafe = true;
    const contentState = {
      m,
      inh,
      stack: [...st.stack, key],
      linetypeScale: st.linetypeScale,
    };
    try {
      if (done || !this.reuseBlock(block, contentState))
        this.drawEntities(this.drawOrder.entities(block), contentState);
    } finally {
      done?.();
    }
    return true;
  }

  private reusableBlock(block: Block, visiting = new Set<Block>()): boolean {
    const cached = this.reusableBlocks.get(block);
    if (cached !== undefined) return cached;
    if (visiting.has(block) || visiting.size > MAX_BLOCK_DEPTH) return false;
    visiting.add(block);
    let reusable = true;
    for (const e of block.entities) {
      // Clips and gradients are defined in the target frame (notes 07 §7, 06 §1.7).
      // Infinite-line reach depends on the view and start position; keep its existing path.
      if (
        e.extensionDictionary ||
        e.type === "VIEWPORT" ||
        e.type === "RAY" ||
        e.type === "XLINE" ||
        ((e.type === "HATCH" || e.type === "MPOLYGON") && e.gradient?.kind === 1)
      ) {
        reusable = false;
        break;
      }
      if (e.type === "INSERT" || e.type === "ACAD_TABLE" || e.type === "DIMENSION") {
        const child = e.blockName ? this.doc.getBlock(e.blockName) : undefined;
        if (child && !this.reusableBlock(child, visiting)) {
          reusable = false;
          break;
        }
      }
    }
    visiting.delete(block);
    this.reusableBlocks.set(block, reusable);
    return reusable;
  }

  private reuseBlock(block: Block, st: DrawState): boolean {
    if (
      !this.lod ||
      this.env.blockReuse === false ||
      this.recordingBlock ||
      (blockClipHook !== undefined && !staticBlockClips) ||
      this.props.viewport ||
      this.entityFilters.length ||
      this.clipStack.length
    )
      return false;
    // Measurements show capture overhead dominates short-lived single continuous LINEs;
    // even 32 uses save only ~9%. Skip their key/capture allocations altogether.
    // Dashed lines can emit substantial geometry (note 06 §2.5), so keep them eligible.
    const only = block.entities.length === 1 ? block.entities[0] : undefined;
    if (only?.type === "LINE" && this.props.properties(only, st.inh).linetype.toUpperCase() === "CONTINUOUS")
      return false;
    let entries = this.blockStreams.get(block);
    const first = this.blockFirstUses.get(block);
    if (!entries && !first) {
      if (this.blockCacheFull || this.recordedEntries >= 4096 || this.observedBlockKeys >= 16_384)
        return false;
      // Thousands of one-off definitions occur in network exports. Keep their immutable
      // state instead of constructing a signature/eligibility walk that will never be used.
      // Resolver modes must be captured here, since extents traversal can change them later.
      this.blockFirstUses.set(block, { st, extents: this.props.extents, display: this.props.display });
      this.observedBlockKeys++;
      return false;
    }
    if (!this.reusableBlock(block)) return false;
    // Absolute-angle complex elements do not rotate with a rigid replay (note 06 §2.3).
    // A document-level fallback also covers inherited/inline complex linetypes and proxy data.
    let absolute = this.caches.get("block-reuse:absolute-linetypes") as boolean | undefined;
    if (absolute === undefined) {
      absolute = [...this.doc.tables.linetypes].some((lt) =>
        lt.elements.some((el) => (el.flags & 7) > 1 && (el.flags & 1) !== 0),
      );
      this.caches.set("block-reuse:absolute-linetypes", absolute);
    }
    if (absolute) return false;
    const split = splitBlockTransform(st.m);
    if (!split) return false;
    const key = this.blockReuseKey(st, split.scale, split.mirror);
    if (!entries) {
      entries = new Map();
      const previous = splitBlockTransform(first!.st.m);
      if (previous)
        entries.set(
          this.blockReuseKey(first!.st, previous.scale, previous.mirror, first!.extents, first!.display),
          1,
        );
      this.blockStreams.set(block, entries);
      this.blockFirstUses.delete(block);
    }
    const stream = entries?.get(key);
    if (stream !== undefined && typeof stream !== "number") {
      replayBlockStream(stream, this.builder, split.r, this.blockReplayWorkspace);
      for (const [what, count] of Object.entries(stream.notes))
        this.unsupported[what] = (this.unsupported[what] ?? 0) + count;
      return true;
    }
    // Stop admitting entries at deterministic per-render limits, retaining hot definitions.
    // Command/entry limits also bound tiny or empty streams, not just coordinate storage.
    if (
      this.blockCacheFull ||
      this.recordedEntries >= 4096 ||
      this.recordedVertices >= 32_000_000 ||
      this.recordedCommands >= 262_144
    )
      return false;
    if (stream === undefined) {
      // The first use cannot amortize capture plus replay. Bound admission metadata separately
      // so a drawing with many unique transforms/properties cannot grow an unbounded key map.
      if (this.observedBlockKeys >= 16_384) return false;
      if (!entries) this.blockStreams.set(block, (entries = new Map()));
      entries.set(key, 1);
      this.observedBlockKeys++;
      return false;
    }
    const out = this.builder;
    const recorder = new BlockRecorder(
      this.pixelSize,
      32_000_000 - this.recordedVertices,
      262_144 - this.recordedCommands,
    );
    const before = { ...this.unsupported };
    this.builder = recorder;
    this.recordingBlock = true;
    try {
      this.drawEntities(this.drawOrder.entities(block), { ...st, m: split.s });
    } finally {
      this.builder = out;
      this.recordingBlock = false;
    }
    if (recorder.overflow || recorder.unsafe) {
      if (recorder.overflow) this.blockCacheFull = true;
      // Nothing was emitted to the real builder; undo captured counters before the fallback.
      for (const what of Object.keys(this.unsupported)) {
        if (before[what] === undefined) delete this.unsupported[what];
        else this.unsupported[what] = before[what]!;
      }
      return false;
    }
    const notes: Record<string, number> = {};
    for (const [what, count] of Object.entries(this.unsupported)) {
      const delta = count - (before[what] ?? 0);
      if (delta) notes[what] = delta;
    }
    const recorded: BlockStream = { commands: recorder.commands, vertices: recorder.vertices, notes };
    if (!entries) this.blockStreams.set(block, (entries = new Map()));
    entries.set(key, recorded);
    this.recordedVertices += recorder.vertices;
    this.recordedCommands += recorder.commands.length;
    this.recordedEntries++;
    replayBlockStream(recorded, out, split.r, this.blockReplayWorkspace);
    return true;
  }

  private blockReuseKey(
    st: DrawState,
    scale: number,
    mirror: boolean,
    extents = this.props.extents,
    display = this.props.display,
  ): string {
    // The resolver folds the ByBlock chain into the innermost resolved parent (note 07 §3).
    // Include visibility/plot propagation and alpha as well as the drawer-facing Inherited.
    const p = st.inh.parents[st.inh.parents.length - 1]!.resolved;
    return JSON.stringify([
      scale,
      mirror,
      st.m.m[10],
      st.inh.layer,
      st.inh.aci,
      st.inh.trueColor,
      st.inh.lineweight,
      st.inh.linetype,
      p.alpha,
      p.colorName,
      p.plotStyleHandle,
      p.expandBlock,
      p.contentPlottable,
      st.linetypeScale ?? 1,
      st.stack,
      extents,
      display,
    ]);
  }

  private drawInsert(e: InsertEntity, st: DrawState): void {
    // An invisible reference or a frozen INSERT layer hides the whole reference; an off layer
    // only hides content that inherits it (layer-0 entities). Note 07 §3.2 (props.ts)
    if (!this.props.expands(e, st.inh)) return;
    const drawer = DRAWERS.get("INSERT");
    if (!drawer) return;
    drawer(this, e, st);
    // ATTRIBs on visible layers still plot when the INSERT's layer is off (attribs/layer-off-insert,
    // VERIFIED-BY-ACAD); the drawer checks each ATTRIB's own visibility with the inherited props.
    if (e.attribs.length > 0) {
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
  pushClip(rings: readonly Float64Array[], options: { dropOnBoundary?: boolean } = {}): void {
    let r = rings.filter((x) => x.length >= 6);
    // polygonal XCLIP boundaries drop strokes lying on them (xclip/rect-4pt vs rect-block, note 07
    // §7.5; layouts/clip-thick-bulge); inherited by nested clips
    let edges = this.clipStack[this.clipStack.length - 1]?.edges;
    if (options.dropOnBoundary) edges = concatEdges(edges, r);
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
    this.clipStack.push({ rings: r, index, pointIndex, ...(edges ? { edges } : {}) });
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
    if (r.trueColor === undefined) {
      if (this.monochrome) return [0, 0, 0, a];
      if (this.grid) {
        const [red, g, b] = plotAciToRgb(r.aci);
        return [red, g, b, a];
      }
    }
    // interactive display (no pixel grid): (near-)white on a light background and (near-)black
    // on a dark one contrast with it like ACI 7 — true colours such as QCAD's layer 0 with
    // 420 = 0xFFFFFF, and ACI 255. A viewer choice, not plot behaviour (plots keep the RGB).
    if (!this.grid && this.env.background) {
      const bg = this.env.background;
      const [red, g, b] = r.rgb;
      const dark = bg[0] + bg[1] + bg[2] < 384;
      if (dark ? Math.max(red, g, b) <= NEAR_EXTREME : Math.min(red, g, b) >= 255 - NEAR_EXTREME) {
        const key =
          r.trueColor === undefined
            ? `ACI ${r.aci}`
            : `#${(r.trueColor & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
        let layers = this.contrastFlips.get(key);
        if (!layers) this.contrastFlips.set(key, (layers = new Set()));
        layers.add(r.layer);
        return dark ? [255, 255, 255, a] : [0, 0, 0, a];
      }
    }
    return [r.rgb[0], r.rgb[1], r.rgb[2], a];
  }

  /** The user-facing note for colours color() flipped for contrast, if any. */
  contrastNote(): PlotNote | undefined {
    if (this.contrastFlips.size === 0) return undefined;
    const items = [...this.contrastFlips]
      .map(([c, layers]) => `${c} (layer${layers.size === 1 ? "" : "s"} ${[...layers].sort().join(", ")})`)
      .sort();
    const n = this.contrastFlips.size;
    const dark = (this.env.background ?? [255, 255, 255]).reduce((x, y) => x + y, 0) < 384;
    return {
      code: "colors-adjusted",
      severity: "info",
      message:
        `${n} colour${n === 1 ? "" : "s"} too close to the background ${n === 1 ? "was" : "were"} ` +
        `drawn in ${dark ? "white" : "black"} for contrast (plots keep them): ` +
        items.slice(0, 4).join("; ") +
        (items.length > 4 ? `; and ${items.length - 4} more` : ""),
      count: n,
      items,
    };
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
    const hairlineMax = this.lod
      ? Math.max(1.5, this.calibration.hairlineMaxPx)
      : this.calibration.hairlineMaxPx;
    return px <= hairlineMax ? 0 : px * this.pixelSize;
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
    let lt = !options.noLinetype && e ? this.linetypeFor(e, r, st) : undefined;
    // A pattern whose period is below half a device pixel plots continuous (dash count does not
    // matter). VERIFIED-BY-ACAD (note 06 §2.6.1; linetypes/dense-*: 0.38 px continuous, 0.51 px dashed)
    if (lt && lt.period < DENSE_LINETYPE_PERIOD_PX * this.pixelSize) lt = undefined;
    // a zero-length path plots like continuous: a dot with the lineweight footprint
    // (VERIFIED-BY-ACAD lines-curves/zero-line-lw*-dashed = zero-line-lw*-cont)
    if (lt && isZeroLength(path)) lt = undefined;
    if (!lt) {
      for (const pl of this.flatten(path)) this.strokeFlat(pl.points, pl.closed, r);
      return;
    }
    const results = dashPath(path, lt.pattern, this.tolerance, {
      units: options.units ?? DashUnits.Continuous,
      upsideDown: blockUpsideDown(st.m),
    });
    const color = this.color(r);
    const w = this.strokeWidth(r);
    for (const res of results) {
      for (const d of res.dashes) this.strokeFlat(d, res.whole, r);
      const dots = res.dots;
      for (let i = 0; i + 2 < dots.length; i += 3) {
        // plot mode: a dot is a zero-length stroke (note 08 §10.14)
        if (this.grid) this.rasterStroke(Float64Array.of(dots[i]!, dots[i + 1]!), false, r);
        else if (w === 0) this.builder.points([dots[i]!, dots[i + 1]!], color);
        else
          this.builder.triangles(
            strokeDot(dots[i]!, dots[i + 1]!, dots[i + 2]!, this.strokeOptions(w)),
            color,
          );
      }
      if (res.placements.length > 0) {
        if (complexDrawer && e) complexDrawer(this, res.placements, e, r, st);
        else this.note("complex-linetype-element");
      }
    }
  }

  private strokeOptions(w: number) {
    // Round caps/joins: ASSUMPTION until calibration (note 06 §5.2)
    return { width: w, cap: LineCap.Round, join: LineJoin.Round, tolerance: this.tolerance };
  }

  /** Strokes a flattened polyline (target coordinates) with the entity's lineweight. */
  strokeFlat(points: Float64Array, closed: boolean, r: Resolved): void {
    if (points.length < 2) return;
    const edges = this.clipStack[this.clipStack.length - 1]?.edges;
    if (edges && points.length >= 4) {
      const parts = dropOnEdges(points, closed, edges, this.pixelSize * 1e-3);
      if (parts) {
        for (const p of parts) this.strokeFlat(p, false, r);
        return;
      }
    }
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
    // wide strokes: every segment is its own convex polygon with round caps, so joins are the
    // union of the caps (note 08 §10.4, §10.14)
    const count = n === 1 ? 1 : closed ? n : n - 1;
    const transparent = color[3] < 255;
    let spans = new SpanSet();
    for (let k = 0; k < count; k++) {
      const b = n === 1 ? 0 : (k + 1) % n;
      const i0 = g.px(points[k * 2]!);
      const j0 = g.py(points[k * 2 + 1]!);
      const i1 = g.px(points[b * 2]!);
      const j1 = g.py(points[b * 2 + 1]!);
      if (!g.visible(i0 - w, j0 - w, i1 + w, j1 + w) && !g.visible(i1 - w, j1 - w, i0 + w, j0 + w)) continue;
      const poly = strokeSegmentPolygon(i0, j0, i1, j1, w);
      if (poly) fillConvexByEdges(poly, spans, g);
      else strokeDotPixels(i0, j0, w, spans);
      if (transparent) {
        // transparent strokes blend segment by segment: joints darken twice (transparency.ts)
        this.emitSpans(spans, color);
        this.builder.breakBatch();
        spans = new SpanSet();
      }
    }
    this.emitSpans(spans, color);
  }

  /** Emits pixel spans as pixel-aligned rectangles (renderers sample pixel centres). */
  private emitSpans(spans: SpanSet, color: Rgba): void {
    if (spans.empty) return;
    const g = this.grid!;
    const tri: number[] = [];
    spans.forEach((j, a, b) => {
      if (j < 0 || j >= g.height || b < 0 || a >= g.width) return;
      const x0 = g.ex(Math.max(a, -1));
      const x1 = g.ex(Math.min(b, g.width) + 1);
      const y0 = g.ey(j);
      const y1 = g.ey(j + 1);
      tri.push(x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1);
    });
    if (tri.length) this.builder.triangles(tri, color);
  }

  /**
   * Fills triangles (target coordinates): in plot mode each triangle is a polygon with snapped
   * vertices filled with AutoCAD's scanline rule (raster.ts fillPolygon; consistent tie rules make
   * a triangulation fill exactly like its polygon, note 08 §10.5).
   */
  fillTriangles(tri: ArrayLike<number>, color: Rgba): void {
    const g = this.grid;
    if (!g) {
      this.builder.triangles(tri, color);
      return;
    }
    const spans = new SpanSet();
    const ring = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k + 5 < tri.length; k += 6) {
      for (let q = 0; q < 3; q++) {
        ring[q * 2] = g.px(tri[k + q * 2]!);
        ring[q * 2 + 1] = g.py(tri[k + q * 2 + 1]!);
      }
      fillPolygon([ring], true, spans, g);
    }
    this.emitSpans(spans, color);
  }

  /**
   * Already quantized device triangles must not pass through world coordinates and snap again:
   * a large plot origin can move an integer vertex to the preceding pixel (note 04 §15.3).
   */
  fillPixelTriangles(tri: ArrayLike<number>, color: Rgba): void {
    const spans = new SpanSet();
    const ring = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k + 5 < tri.length; k += 6) {
      for (let q = 0; q < 6; q++) ring[q] = tri[k + q]!;
      fillPolygon([ring], true, spans, this.grid);
    }
    this.emitSpans(spans, color);
  }

  /** Fills rings (target coordinates) with a fill rule. */
  fillRings(rings: readonly Float64Array[], color: Rgba, fillRule: FillRule = FillRule.NonZero): void {
    if (rings.length === 0) return;
    const g = this.grid;
    if (g) {
      // plot mode: the polygon itself with snapped vertices (SOLID, note 08 §10.5)
      const snapped = rings.map((r) => {
        const out: number[] = [];
        for (let k = 0; k + 1 < r.length; k += 2) out.push(g.px(r[k]!), g.py(r[k + 1]!));
        return out;
      });
      const spans = new SpanSet();
      fillPolygon(snapped, fillRule === FillRule.EvenOdd, spans, g);
      this.emitSpans(spans, color);
      return;
    }
    this.fillTriangles(triangulateFill(rings, { fillRule, tolerance: this.tolerance }), color);
  }

  /**
   * Fills a solid hatch (flattened loops in target coordinates, hatch style 75): in plot mode
   * AutoCAD cuts the area into trapezoids at every vertex y and snaps each trapezoid's corners
   * separately (note 08 §10.5).
   */
  fillHatch(loops: readonly HatchLoop[], style: number, color: Rgba): void {
    const g = this.grid;
    if (!g) {
      this.fillTriangles(hatchSolidTriangles(loops, style, { tolerance: this.tolerance }), color);
      return;
    }
    const rings = selectHatchLoops(loops, style).map((i) => loops[i]!.points);
    const spans = new SpanSet();
    for (const t of trapezoids(rings, true)) {
      const q: number[] = [];
      for (let k = 0; k < 8; k += 2) q.push(g.px(t[k]!), g.py(t[k + 1]!));
      fillPolygon([q], true, spans, g);
    }
    this.emitSpans(spans, color);
  }

  /**
   * Flattens a path. Plot mode tessellates curves like AutoCAD (note 08 §10.13): circular arcs
   * that lie on the canvas go to the raster driver as arcs (integer rule,
   * raster.ts arcVertices); other arcs, elliptic arcs and arcs of filled outlines are tessellated
   * in the graphics system (raster.ts gsSegmentCount) at their exact points.
   */
  flatten(path: Path2, forFill = false): { points: Float64Array; closed: boolean }[] {
    const g = this.grid;
    const tol = Math.max(this.tolerance, curveToleranceFloor(path));
    if (!g) return flattenPath(path, tol);
    const out: { points: Float64Array; closed: boolean }[] = [];
    for (const sp of path.subpaths) {
      const pts: number[] = [];
      // appends a vertex list; the first one is dropped when it repeats the previous end point
      const append = (v: ArrayLike<number>) => {
        let k = 0;
        const n = pts.length;
        if (n >= 2 && v.length >= 2 && v[0] === pts[n - 2] && v[1] === pts[n - 1]) k = 2;
        for (; k < v.length; k++) pts.push(v[k]!);
      };
      for (const seg of sp.segments) {
        if (seg.kind === "arc") {
          const r = seg.radius / g.pixelSize;
          const cu = g.u(seg.center.x);
          const cv = g.v(seg.center.y);
          // heuristic (note 08 §10.13): the arc itself on the canvas, radius ≤ 1024 px
          if (!forFill && arcRuleApplies(cu, cv, r, seg.start, seg.sweep, g.width, g.height)) {
            // device pixels; emit their centres, which snap back to the same pixels
            const v = arcVertices(cu, cv, r, seg.start, seg.sweep);
            const w: number[] = [];
            for (let k = 0; k + 1 < v.length; k += 2) w.push(g.cx(v[k]!), g.cy(v[k + 1]!));
            append(w);
            continue;
          }
          const n = Math.min(
            MAX_CURVE_SEGMENTS,
            gsSegmentCount(r, seg.sweep, forFill ? GS_FILL_FACTOR : GS_STROKE_FACTOR),
          );
          const w: number[] = [];
          for (let k = 0; k <= n; k++) {
            const t = seg.start + (seg.sweep * k) / n;
            w.push(seg.center.x + seg.radius * Math.cos(t), seg.center.y + seg.radius * Math.sin(t));
          }
          append(w);
        } else if (seg.kind === "ellipticArc") {
          // uniform parameter steps, exact vertices
          const n = Math.min(
            MAX_CURVE_SEGMENTS,
            gsSegmentCount(ellipticArc2SemiAxes(seg)[0] / g.pixelSize, seg.sweep, GS_STROKE_FACTOR),
          );
          const w: number[] = [];
          for (let k = 0; k <= n; k++) {
            const t = seg.start + (seg.sweep * k) / n;
            const c = Math.cos(t);
            const sn = Math.sin(t);
            w.push(seg.center.x + seg.u.x * c + seg.v.x * sn, seg.center.y + seg.u.y * c + seg.v.y * sn);
          }
          append(w);
        } else {
          const fl = flattenPath({ subpaths: [{ segments: [seg], closed: false }] }, tol)[0];
          if (fl) append(fl.points);
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
      this.flatten(path, true).map((p) => p.points),
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
  const notes: PlotNote[] = [];
  for (const p of PREPARERS) notes.push(...((await p(doc, env)) ?? []));
  const calibration = { ...DEFAULT_CALIBRATION, ...env.calibration };
  const space = findLayout(doc, request.layout);
  let view: View;
  if (request.area.type === "window") {
    view = fitWindow(request.area.min, request.area.max, request.canvas);
  } else if (request.area.type === "layout" && !space.isModel) {
    view = layoutAreaView(request);
  } else {
    // extents: a first pass at a coarse resolution finds the drawing bounds
    // the stored extents only seed the probe's resolution: model space $EXTMIN/$EXTMAX, a layout
    // its LAYOUT 14/15 (they match paper space + viewport frames, note 08 §10.16)
    const lo = space.isModel ? undefined : space.layout?.object;
    const ext = lo ? lo.extentsMax : doc.header.point("$EXTMAX", { x: 1, y: 1, z: 0 });
    const exn = lo ? lo.extentsMin : doc.header.point("$EXTMIN", { x: 0, y: 0, z: 0 });
    // geometric bounds: no pixel grid (it clips to the guessed canvas), no lineweight widening
    const probeBounds = (guess: View) => {
      const probe = new Frontend(doc, { ...request, lineweights: false }, guess, calibration, {
        ...env,
        raster: "smooth",
        lod: false,
      });
      probe.props.extents = true;
      drawSpace(probe, space);
      return probe.build().bounds;
    };
    const w = ext.x - exn.x;
    const h = ext.y - exn.y;
    let guess: View;
    // degenerate header extents (0,0)-(0,0), written by many non-AutoCAD writers, count as unset:
    // a ~1e-9 window would make the probe flatten every curve at a 1e-10 tolerance
    if (w >= 0 && h >= 0 && Math.max(w, h) > 0 && w < 1e15 && h < 1e15) {
      guess = fitWindow(
        [exn.x, exn.y],
        [Math.max(ext.x, exn.x + 1e-9), Math.max(ext.y, exn.y + 1e-9)],
        request.canvas,
      );
      if (
        env.lod &&
        env.raster === "smooth" &&
        w > 0 &&
        h > 0 &&
        !(space.isModel && preferExtentsProbe(space.block.entities, w, h))
      ) {
        // The viewer can refine the list on its next scale octave. Use stored extents only
        // when the actual geometry confirms their scale; plots still probe (note 03 §6.2).
        const fast = new Frontend(doc, request, guess, calibration, env);
        drawSpace(fast, space);
        const displayList = fast.build();
        const bounds = displayList.bounds;
        const bw = bounds.maxX - bounds.minX;
        const bh = bounds.maxY - bounds.minY;
        if (bw >= w / 4 && bw <= w * 4 && bh >= h / 4 && bh <= h * 4) {
          await fast.finish();
          const contrast = fast.contrastNote();
          if (contrast) notes.push(contrast);
          return {
            displayList,
            view: viewFromBounds(bounds, request.canvas),
            unsupported: fast.unsupported,
            ...(notes.length ? { notes } : {}),
          };
        }
      }
    } else {
      // unset header extents (AutoCAD writes EXTMIN 1e20 / EXTMAX -1e20 for empty or never
      // regenerated drawings): the guess only sets the flattening tolerance, so a very coarse
      // pass first, then one at the resolution of its bounds
      const coarse = probeBounds(fitWindow([-1e7, -1e7], [1e7, 1e7], request.canvas));
      guess = viewFromBounds(coarse, request.canvas);
    }
    view = viewFromBounds(probeBounds(guess), request.canvas);
  }
  const fe = new Frontend(doc, request, view, calibration, env);
  drawSpace(fe, space);
  await fe.finish();
  const contrast = fe.contrastNote();
  if (contrast) notes.push(contrast);
  return { displayList: fe.build(), view, unsupported: fe.unsupported, ...(notes.length ? { notes } : {}) };
}

/**
 * Avoid a speculative full render when a bounded sample suggests grossly stale-large header
 * extents (note 03 §6.2). This only selects the accurate probe path: sampled anchors are never
 * used as fit bounds. A 64× discrepancy on both axes leaves ordinary 4× checks to the fast pass.
 */
function preferExtentsProbe(entities: readonly Entity[], width: number, height: number): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sampled = 0;
  const count = Math.min(32, entities.length);
  for (let i = 0; i < count; i++) {
    const e = entities[Math.floor((i * entities.length) / count)]!;
    // Only WCS geometry with explicit vertices: an OCS anchor or block insertion alone says
    // nothing about the size/location of its output (note 03 §2, note 07 §3).
    const points =
      e.type === "LINE"
        ? [e.start, e.end]
        : e.type === "3DFACE"
          ? [e.v0, e.v1, e.v2, e.v3]
          : e.type === "POINT"
            ? [e.location]
            : undefined;
    if (!points) continue;
    sampled++;
    for (const p of points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return sampled >= 8 && maxX - minX < width / 64 && maxY - minY < height / 64;
}

/**
 * Guard against runaway tessellation (a view far smaller than the geometry, e.g. a degenerate
 * extents guess): at most this many chords per full circle, independent of the pixel size.
 */
const MAX_CURVE_SEGMENTS = 1 << 16;

/**
 * Smallest useful chord tolerance for a path: the sagitta of a full circle of the path's largest
 * curve radius cut into MAX_CURVE_SEGMENTS chords (count-based, deterministic). Lines: 0.
 */
function curveToleranceFloor(path: Path2): number {
  let r = 0;
  for (const sp of path.subpaths) {
    for (const seg of sp.segments) {
      if (seg.kind === "arc") r = Math.max(r, seg.radius);
      else if (seg.kind === "ellipticArc")
        r = Math.max(r, Math.hypot(seg.u.x, seg.u.y) + Math.hypot(seg.v.x, seg.v.y));
      else if (seg.kind === "quad" || seg.kind === "cubic") {
        const q = seg.kind === "quad" ? [seg.p0, seg.p1, seg.p2] : [seg.p0, seg.p1, seg.p2, seg.p3];
        for (const a of q) for (const b of q) r = Math.max(r, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
  }
  return r * (1 - Math.cos(Math.PI / MAX_CURVE_SEGMENTS));
}

/** Whether every segment of a path is a single point (zero-length LINE, zero-radius arc). */
function isZeroLength(path: Path2): boolean {
  for (const sp of path.subpaths) {
    for (const seg of sp.segments) {
      if (seg.kind === "line") {
        if (seg.p0.x !== seg.p1.x || seg.p0.y !== seg.p1.y) return false;
      } else if (seg.kind === "arc") {
        if (seg.radius !== 0 && seg.sweep !== 0) return false;
      } else return false;
    }
  }
  return true;
}

function concatEdges(prev: Float64Array | undefined, rings: readonly Float64Array[]): Float64Array {
  const out: number[] = prev ? Array.from(prev) : [];
  for (const ring of rings) {
    const n = ring.length >> 1;
    for (let k = 0; k < n; k++) {
      const q = (k + 1) % n;
      out.push(ring[k * 2]!, ring[k * 2 + 1]!, ring[q * 2]!, ring[q * 2 + 1]!);
    }
  }
  return Float64Array.from(out);
}

/**
 * Parameter interval [u0, u1] of segment a→b lying on edge e (collinear within tol), or
 * undefined.
 */
function onEdge(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  e: Float64Array,
  k: number,
  tol: number,
): [number, number] | undefined {
  const ex = e[k]!;
  const ey = e[k + 1]!;
  const dx = e[k + 2]! - ex;
  const dy = e[k + 3]! - ey;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return undefined;
  const len = Math.sqrt(len2);
  if (Math.abs((ax - ex) * dy - (ay - ey) * dx) / len > tol) return undefined;
  if (Math.abs((bx - ex) * dy - (by - ey) * dx) / len > tol) return undefined;
  // edge extent [0, 1] expressed in the segment's parameter
  const ta = ((ax - ex) * dx + (ay - ey) * dy) / len2;
  const tb = ((bx - ex) * dx + (by - ey) * dy) / len2;
  if (ta === tb) return undefined;
  let u0 = (0 - ta) / (tb - ta);
  let u1 = (1 - ta) / (tb - ta);
  if (u0 > u1) [u0, u1] = [u1, u0];
  u0 = Math.max(0, u0);
  u1 = Math.min(1, u1);
  return u1 - u0 > 1e-12 ? [u0, u1] : undefined;
}

/** Removes the segments of a polyline lying on one of the edges; undefined when none does. */
export function dropOnEdges(
  points: Float64Array,
  closed: boolean,
  edges: Float64Array,
  tol: number,
): Float64Array[] | undefined {
  const n = points.length >> 1;
  const count = closed ? n : n - 1;
  const out: Float64Array[] = [];
  let cur: number[] = [];
  let hit = false;
  const flush = () => {
    if (cur.length >= 4) out.push(Float64Array.from(cur));
    cur = [];
  };
  for (let sg = 0; sg < count; sg++) {
    const a = sg;
    const b = (sg + 1) % n;
    const ax = points[a * 2]!;
    const ay = points[a * 2 + 1]!;
    const bx = points[b * 2]!;
    const by = points[b * 2 + 1]!;
    // only segments lying entirely on an edge are dropped; partial overlaps are pixel ties in
    // the fixtures (note 07 §7.5)
    const cut: [number, number][] = [];
    for (let k = 0; k + 3 < edges.length; k += 4) {
      const iv = onEdge(ax, ay, bx, by, edges, k, tol);
      if (iv && iv[0] <= 1e-9 && iv[1] >= 1 - 1e-9) cut.push(iv);
    }
    if (cut.length === 0) {
      if (cur.length === 0) cur.push(ax, ay);
      cur.push(bx, by);
      continue;
    }
    hit = true;
    cut.sort((p, q) => p[0] - q[0]);
    let u = 0;
    const at = (t: number): [number, number] => [ax + (bx - ax) * t, ay + (by - ay) * t];
    for (const [u0, u1] of cut) {
      if (u0 > u) {
        if (cur.length === 0) cur.push(...at(u));
        cur.push(...at(u0));
      }
      flush();
      u = Math.max(u, u1);
    }
    if (u < 1) cur.push(...at(u), bx, by);
  }
  flush();
  return hit ? out : undefined;
}

/**
 * Whether a circular arc goes to the raster driver's integer arc rule (note 08 §10.13). AutoCAD
 * uses it for arcs whose full circle is on the canvas (VERIFIED-BY-ACAD) and also for dimension
 * and polyline arcs whose circle runs off the canvas (dimensions/type-arc-*, angular-*,
 * polylines/closed-0004). HEURISTIC for the latter: the arc's own extent on the canvas and a device
 * radius of at most 1024 px (r 1000 arc rule, r 1350 graphics system). Known counterexamples: plain
 * ARCs in splines/rational-quarter-circle and fileformat/version-r12, and layouts/clip-bulge, plot
 * with the graphics system.
 */
function arcRuleApplies(
  cu: number,
  cv: number,
  r: number,
  start: number,
  sweep: number,
  w: number,
  h: number,
): boolean {
  if (cu - r >= 0 && cu + r <= w && cv - r >= 0 && cv + r <= h) return true;
  if (r > 1024) return false;
  // bounding box of the arc (device v grows with y)
  let x0 = Math.min(cu + r * Math.cos(start), cu + r * Math.cos(start + sweep));
  let x1 = Math.max(cu + r * Math.cos(start), cu + r * Math.cos(start + sweep));
  let y0 = Math.min(cv + r * Math.sin(start), cv + r * Math.sin(start + sweep));
  let y1 = Math.max(cv + r * Math.sin(start), cv + r * Math.sin(start + sweep));
  const a0 = Math.min(start, start + sweep);
  const a1 = Math.max(start, start + sweep);
  for (let k = Math.ceil(a0 / (Math.PI / 2)); k * (Math.PI / 2) <= a1; k++) {
    const q = ((k % 4) + 4) % 4;
    if (q === 0) x1 = cu + r;
    else if (q === 1) y1 = cv + r;
    else if (q === 2) x0 = cu - r;
    else y0 = cv - r;
  }
  return x0 >= 0 && x1 <= w && y0 >= 0 && y1 <= h;
}
