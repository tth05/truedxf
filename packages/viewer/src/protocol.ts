/**
 * The viewer's backend protocol: parse → model → display list runs in a module worker (or on the
 * main thread as a fallback) behind these messages. `ViewerCore` is the backend logic itself; it
 * has no DOM or worker dependencies, so tests drive it directly.
 *
 * GPU buffers travel as transferables. Original lists and pick indexes stay in the backend
 * (docs/perf-plan.md steps 1 and 5).
 */
import {
  type DxfDocument,
  type Entity,
  type InsertEntity,
  type LayerEntry,
  loadDxf,
  PropertyResolver as ModelResolver,
} from "@truedxf/model";
import {
  ACI_RGB,
  type DisplayList,
  type PlotArea,
  type PlotRequest,
  renderPlot,
  transferables,
} from "@truedxf/render";
import type { MergedDisplayList } from "@truedxf/three/merge";
import { entityBounds, intersects } from "./cull.ts";
import { DrawingState, drawingUpload, type EntityGeometry } from "./drawing.ts";
import type { PickHit } from "./pick.ts";
import { isValidRect, type Rect } from "./view.ts";
import { documentWarnings, renderWarnings, type ViewerWarning } from "./warnings.ts";

// ---- public data shapes ------------------------------------------------------------------------

export interface LayoutInfo {
  name: string;
  isModel: boolean;
  tabOrder: number;
  /** Paper sheet in paper-space units (approximate: margins/offset), for paper-space layouts. */
  paper?: Rect;
  /** Paper-space extents stored in the LAYOUT object (when valid), for layouts without a sheet. */
  extents?: Rect;
  /**
   * Paper layout without any entity (not even its overall VIEWPORT): never activated in AutoCAD.
   * The AutoCAD GUI initializes such a layout on first activation (page setup, default viewport);
   * the file has nothing to show and accoreconsole plots it blank (note 08 §11).
   */
  empty?: boolean;
}

export interface LayerInfo {
  name: string;
  /** Layer colour 0xRRGGBB (ACI palette with 7 = white, or the true colour). */
  rgb: number;
  aci: number;
  off: boolean;
  frozen: boolean;
  plot: boolean;
  /** Top-level entities on the layer (model and paper space). */
  entities: number;
}

export interface DocumentInfo {
  name: string;
  byteLength: number;
  acadver: string;
  format: string;
  /** Top-level entities in model and paper space. */
  entityCount: number;
  entityTypes: Record<string, number>;
  layouts: LayoutInfo[];
  /**
   * The layout that was current when the file was saved: "Model" with $TILEMODE 1, else the
   * paper layout owning *Paper_Space (note 08 §1.3); "Model" when that layout has no entities.
   */
  activeLayout: string;
  layers: LayerInfo[];
  /** Model diagnostics: occurrences per code. */
  diagnostics: Record<string, number>;
  /** Document-level viewer warnings (e.g. every layer with content is set not to plot). */
  warnings: ViewerWarning[];
  ms: { parse: number };
}

export interface RenderParams {
  /** Build merged GPU buffers in the backend (default false for explicit/exact renders). */
  mergeBatches?: boolean;
  /** Viewer detail coverage, in the list's world (paper for layouts) coordinates. */
  cull?: Rect;
  /** False for auxiliary plot previews: preserve the displayed list's interaction state. */
  retain?: boolean;
  layout: string;
  /** Plot area: "extents" for a fit on first display, else the window to tessellate for. */
  area: PlotArea;
  /** Device pixels of the area. */
  canvas: [number, number];
  background: [number, number, number];
  /** Layer toggles: name → visible (false hides, true shows a layer that is off/frozen in the file). */
  layers: Record<string, boolean>;
  lineweights: boolean;
  raster: "smooth" | "autocad";
  /** Lineweight dpi (default 100; the viewer scales it with devicePixelRatio). */
  dpi?: number;
  /** Draw IMAGE / WIPEOUT (default true). */
  rasterEntities?: boolean;
  /** "display" (viewer default): no-plot / Defpoints layers are shown; "plot": as plotted. */
  visibility?: "display" | "plot";
  /** Plot style table name (plot mode), e.g. "monochrome.ctb". */
  styleTable?: string;
  /** Further plot request fields (fixture contract: meta.plot). */
  scale?: PlotRequest["scale"];
  sysvars?: PlotRequest["sysvars"];
  paperSpaceFirst?: boolean;
  /**
   * Font file(s) for text whose font is missing, tried in order (viewing mode draws such text
   * with the fallback; plot emulation substitutes FONTALT like AutoCAD). Default: the render
   * layer's list (simplex.shx, txt.shx, arial.ttf, LiberationSans-Regular.ttf).
   */
  fallbackFont?: string | readonly string[];
  /** Big font for missing big fonts (default: none). */
  fallbackBigFont?: string;
  /**
   * Asset generation (DxfViewer: its file store's generation). When it differs from the previous
   * render's, the core drops its font and image caches, so files added since are looked up.
   */
  assets?: number;
}

export interface RenderResult {
  list: DisplayList;
  /** Present when merged; list.batches is empty in that case. */
  merged?: MergedDisplayList;
  generation: number;
  /** Absent for a complete list, including plots and extents renders. */
  covered?: Rect;
  stats: { batches: number; vertices: number };
  view: Rect;
  /**
   * Bounds of what is visible: like `list.bounds`, but clipped batches (viewport content) count
   * only within their clip region's bounding box. Undefined for an empty list.
   */
  bounds: Rect | undefined;
  unsupported: Record<string, number>;
  /** Why the output is empty / invisible, and render notes (missing fonts, …). */
  warnings: ViewerWarning[];
  ms: { frontend: number; pick: number; merge: number };
}

export interface TagInfo {
  code: number;
  value: string;
}

export interface EntityInfo {
  handle: string;
  id: number;
  type: string;
  dxfType: string;
  /** Owning block name (layout blocks included). */
  block: string | undefined;
  raw: {
    layer: string;
    color: number;
    trueColor: string | undefined;
    colorName: string | undefined;
    linetype: string;
    lineweight: number;
    linetypeScale: number;
    transparency: string | undefined;
    invisible: boolean;
  };
  /** Resolved at top level (ByBlock content is resolved without its INSERT context). */
  resolved: {
    layer: string;
    aci: number;
    rgb: string;
    trueColor: string | undefined;
    linetype: string;
    lineweight: number;
    linetypeScale: number;
    alpha: number;
    plottable: boolean;
  };
  tags: TagInfo[];
  /** Total tags of the record (tags is truncated to MAX_TAGS). */
  tagCount: number;
}

export const MAX_TAGS = 5000;

// ---- messages ----------------------------------------------------------------------------------

export type Request =
  | { type: "load"; bytes: Uint8Array; name: string }
  | { type: "render"; params: RenderParams }
  | { type: "pick"; point: [number, number]; tolerance: number; generation?: number }
  | { type: "geometry"; entity: string | number; generation?: number }
  | { type: "inspect"; handle: string };

export type ResponseValue<R extends Request> = R extends { type: "load" }
  ? DocumentInfo
  : R extends { type: "render" }
    ? RenderResult
    : R extends { type: "pick" }
      ? PickHit | undefined
      : R extends { type: "geometry" }
        ? EntityGeometry | undefined
        : R extends { type: "inspect" }
          ? EntityInfo | undefined
          : never;

/** Main thread → worker. */
export type ToWorker =
  | { kind: "request"; id: number; request: Request }
  | { kind: "asset"; id: number; bytes: Uint8Array | undefined };

/** Worker → main thread. */
export type FromWorker =
  | { kind: "response"; id: number; ok: true; value: unknown }
  | { kind: "response"; id: number; ok: false; error: string }
  | { kind: "asset"; id: number; asset: "font" | "image"; name: string };

/** Buffers to transfer with a response (upload or freshly copied highlight geometry). */
export function responseTransfer(value: unknown): ArrayBuffer[] {
  if (value && typeof value === "object" && "parts" in value) {
    return [...new Set((value as EntityGeometry).parts.map((p) => p.positions.buffer as ArrayBuffer))];
  }
  const v = value as Partial<RenderResult> | undefined;
  if (!v?.list) return [];
  // Image pixels stay in the renderer's per-document raster cache (draw/image.ts) and are reused
  // by later renders: transferring them would detach the cache ("ArrayBuffer is already
  // detached" on the next render), so they are copied (structured clone) instead.
  const images = new Set<ArrayBufferLike>(v.list.images.map((im) => im.pixels.buffer));
  const out = transferables(v.list).filter((b) => !images.has(b));
  for (const g of v.merged?.groups ?? []) {
    for (const p of g.parts) {
      out.push(p.positions.buffer as ArrayBuffer, p.colors.buffer as ArrayBuffer);
      if (p.uvs) out.push(p.uvs.buffer as ArrayBuffer);
    }
  }
  return [...new Set(out)];
}

export type AssetLoader = (name: string) => Promise<Uint8Array | undefined>;

// ---- the backend -------------------------------------------------------------------------------

export class ViewerCore {
  private drawing: DrawingState | undefined;
  private generation = 0;
  private boundsKey: string | undefined;
  private entityBounds = new Map<string, Rect>();
  private boundsPixelSize = 0;
  private fullWarnings: ViewerWarning[] = [];
  private doc: DxfDocument | undefined;
  private byId: Map<number, Entity> | undefined;
  private byHandle: Map<string, Entity> | undefined;
  private ownerBlock: Map<Entity, string> | undefined;
  private readonly baseFont: AssetLoader;
  private readonly baseImage: AssetLoader;
  /**
   * Loader identities passed to the renderer: the text layer caches fonts and the image drawer
   * decoded files per loader function, so these stay stable until the asset generation changes.
   */
  private loadFont: AssetLoader;
  private loadImage: AssetLoader;
  private assets = 0;

  constructor(loadFont: AssetLoader, loadImage: AssetLoader) {
    this.baseFont = loadFont;
    this.baseImage = loadImage;
    this.loadFont = loadFont;
    this.loadImage = loadImage;
  }

  async handle(req: Request): Promise<unknown> {
    switch (req.type) {
      case "load":
        return this.load(req.bytes, req.name);
      case "render":
        return this.render(req.params);
      case "inspect":
        return this.inspect(req.handle);
      case "pick":
        return this.matches(req.generation) ? this.drawing?.pick(...req.point, req.tolerance) : undefined;
      case "geometry":
        return this.matches(req.generation) ? this.drawing?.geometry(req.entity) : undefined;
    }
  }

  load(bytes: Uint8Array, name: string): DocumentInfo {
    this.drawing = undefined;
    this.boundsKey = undefined;
    this.entityBounds.clear();
    this.fullWarnings = [];
    this.generation++;
    const t0 = performance.now();
    const doc = loadDxf(bytes);
    const ms = performance.now() - t0;
    this.doc = doc;
    this.byId = undefined;
    this.byHandle = undefined;
    this.ownerBlock = undefined;
    return describe(doc, name, bytes.byteLength, ms);
  }

  async render(p: RenderParams): Promise<RenderResult> {
    const doc = this.requireDoc();
    if (p.assets !== undefined && p.assets !== this.assets) {
      // new identities: every font and image is requested again (files were added / removed)
      this.assets = p.assets;
      this.loadFont = (name) => this.baseFont(name);
      this.loadImage = (name) => this.baseImage(name);
    }
    // Area/resolution affect tessellation, not which entities are eligible. Auxiliary plots
    // must not replace the interactive cache (nor its retained pick generation).
    const {
      area: _area,
      canvas: _canvas,
      cull: _cull,
      mergeBatches: _merge,
      retain: _retain,
      ...settings
    } = p;
    const key = JSON.stringify(settings);
    if (p.retain !== false && key !== this.boundsKey) {
      this.boundsKey = key;
      this.entityBounds.clear();
      this.fullWarnings = [];
    }
    const covered =
      p.raster === "smooth" &&
      p.area.type !== "extents" &&
      p.cull &&
      isValidRect(p.cull) &&
      key === this.boundsKey &&
      this.entityBounds.size > 0
        ? { ...p.cull }
        : undefined;
    // Coarse curves/greeked text can grow slightly on refinement. Keep a fit-pixel guard;
    // unknown and unbounded entities always draw, rather than trusting incomplete bounds.
    const padding = this.boundsPixelSize * 4;
    const t0 = performance.now();
    const toggles = new Map(Object.entries(p.layers).map(([k, v]) => [k.toUpperCase(), v]));
    const res = await renderPlot(
      doc,
      {
        layout: p.layout,
        area: p.area,
        canvas: p.canvas,
        lineweights: p.lineweights,
        ...(p.styleTable ? { styleTable: p.styleTable } : {}),
        ...(p.scale ? { scale: p.scale } : {}),
        ...(p.sysvars ? { sysvars: p.sysvars } : {}),
        ...(p.paperSpaceFirst !== undefined ? { paperSpaceFirst: p.paperSpaceFirst } : {}),
      },
      {
        loadFont: this.loadFont,
        loadImage: this.loadImage,
        raster: p.raster,
        lod: true,
        ...(covered
          ? {
              topLevelFilter: (e: Entity) => {
                const bounds = this.entityBounds.get(e.handle || `#${e.id}`);
                return !bounds || intersects(bounds, covered, padding);
              },
            }
          : {}),
        background: p.background,
        layerVisibility: toggles,
        rasterEntities: p.rasterEntities === false ? "omit" : "draw",
        visibility: p.visibility ?? "display",
        ...(p.dpi ? { calibration: { dpi: p.dpi } } : {}),
        ...(p.fallbackFont !== undefined || p.fallbackBigFont !== undefined
          ? {
              text: {
                ...(p.fallbackFont !== undefined ? { fallbackFont: p.fallbackFont } : {}),
                ...(p.fallbackBigFont !== undefined ? { fallbackBigFont: p.fallbackBigFont } : {}),
              },
            }
          : {}),
      },
    );
    const t1 = performance.now();
    const drawing = new DrawingState(res.displayList);
    if (!covered && p.retain !== false && p.raster === "smooth") {
      this.entityBounds = entityBounds(res.displayList);
      this.boundsPixelSize = res.displayList.pixelSize;
    }
    const t2 = performance.now();
    const upload = drawingUpload(res.displayList, p.mergeBatches ?? false);
    const t3 = performance.now();
    if (p.retain !== false) {
      this.drawing = drawing;
      this.generation++;
    }
    // Layout-wide empty/invisible diagnostics must not describe just an empty zoom window.
    const warnings = covered
      ? this.fullWarnings
      : renderWarnings(doc, {
          layout: p.layout,
          toggles,
          visibility: p.visibility ?? "display",
          list: res.displayList,
          unsupported: res.unsupported,
          notes: res.notes,
        });
    if (!covered && p.retain !== false && p.raster === "smooth") this.fullWarnings = warnings;
    return {
      ...upload,
      generation: this.generation,
      ...(covered ? { covered } : {}),
      view: { ...res.view },
      bounds: visibleBounds(res.displayList),
      unsupported: res.unsupported,
      warnings,
      ms: { frontend: t1 - t0, pick: t2 - t1, merge: t3 - t2 },
    };
  }

  private matches(generation: number | undefined): boolean {
    return generation === undefined || generation === this.generation;
  }

  inspect(handle: string): EntityInfo | undefined {
    const doc = this.requireDoc();
    if (!this.byId || !this.byHandle || !this.ownerBlock) {
      // every entity incl. ATTRIBs of INSERTs (the model's handle map has top-level records only)
      this.byId = new Map();
      this.byHandle = new Map();
      this.ownerBlock = new Map();
      const add = (x: Entity, block: string) => {
        this.byId!.set(x.id, x);
        if (x.handle && !this.byHandle!.has(x.handle)) this.byHandle!.set(x.handle, x);
        this.ownerBlock!.set(x, block);
        if (x.type === "INSERT") for (const a of (x as InsertEntity).attribs) add(a, block);
      };
      for (const b of new Set([doc.modelSpace, ...doc.blocks])) for (const x of b.entities) add(x, b.name);
    }
    const e = handle.startsWith("#") ? this.byId.get(Number(handle.slice(1))) : this.byHandle.get(handle);
    if (!e) return undefined;
    const r = new ModelResolver(doc).resolve(e);
    const rec = e.record;
    const s = rec.store;
    const tags: TagInfo[] = [];
    for (let i = rec.start; i < rec.end && tags.length < MAX_TAGS; i++) {
      tags.push({ code: s.codes[i]!, value: formatValue(s.value(i)) });
    }
    const hex = (n: number | undefined) =>
      n === undefined ? undefined : `#${(n & 0xffffff).toString(16).padStart(6, "0")}`;
    return {
      handle: e.handle,
      id: e.id,
      type: e.type,
      dxfType: e.dxfType,
      block: this.ownerBlock.get(e),
      raw: {
        layer: e.layer,
        color: e.color,
        trueColor: hex(e.trueColor),
        colorName: e.colorName,
        linetype: e.linetype,
        lineweight: e.lineweight,
        linetypeScale: e.linetypeScale,
        transparency: e.transparency === undefined ? undefined : `0x${e.transparency.toString(16)}`,
        invisible: e.invisible,
      },
      resolved: {
        layer: r.layer,
        aci: r.aci,
        rgb: hex(r.rgb)!,
        trueColor: hex(r.trueColor),
        linetype: r.linetype,
        lineweight: r.lineweight,
        linetypeScale: r.linetypeScale,
        alpha: r.alpha,
        plottable: r.plottable,
      },
      tags,
      tagCount: rec.end - rec.start,
    };
  }

  private requireDoc(): DxfDocument {
    if (!this.doc) throw new Error("no document loaded");
    return this.doc;
  }
}

/** Display-list bounds with clipped batches limited to their clip region (see RenderResult.bounds). */
export function visibleBounds(list: Pick<DisplayList, "batches" | "clips">): Rect | undefined {
  let out: Rect | undefined;
  const clipBox = new Map<number, Rect>();
  for (const b of list.batches) {
    const p = b.positions;
    // infinite XLINE/RAY extensions don't count for fitting
    if (p.length < 2 || b.unbounded) continue;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i + 1 < p.length; i += 2) {
      const x = p[i]!;
      const y = p[i + 1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    let r: Rect = {
      minX: minX + b.originX,
      minY: minY + b.originY,
      maxX: maxX + b.originX,
      maxY: maxY + b.originY,
    };
    if (b.clip >= 0) {
      let c = clipBox.get(b.clip);
      if (!c) {
        c = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const ring of list.clips[b.clip]?.rings ?? []) {
          for (let i = 0; i + 1 < ring.length; i += 2) {
            c.minX = Math.min(c.minX, ring[i]!);
            c.maxX = Math.max(c.maxX, ring[i]!);
            c.minY = Math.min(c.minY, ring[i + 1]!);
            c.maxY = Math.max(c.maxY, ring[i + 1]!);
          }
        }
        clipBox.set(b.clip, c);
      }
      r = {
        minX: Math.max(r.minX, c.minX),
        minY: Math.max(r.minY, c.minY),
        maxX: Math.min(r.maxX, c.maxX),
        maxY: Math.min(r.maxY, c.maxY),
      };
      if (!(r.maxX >= r.minX && r.maxY >= r.minY)) continue;
    }
    out = out
      ? {
          minX: Math.min(out.minX, r.minX),
          minY: Math.min(out.minY, r.minY),
          maxX: Math.max(out.maxX, r.maxX),
          maxY: Math.max(out.maxY, r.maxY),
        }
      : r;
  }
  return out;
}

function formatValue(v: string | number | bigint | boolean | Uint8Array): string {
  if (v instanceof Uint8Array) {
    let s = "";
    for (let i = 0; i < v.length && i < 64; i++) s += v[i]!.toString(16).padStart(2, "0").toUpperCase();
    return v.length > 64 ? `${s}… (${v.length} bytes)` : s;
  }
  return String(v);
}

function layerRgb(l: Pick<LayerEntry, "color" | "trueColor">): number {
  if (l.trueColor !== undefined) return l.trueColor & 0xffffff;
  return ACI_RGB[Math.abs(l.color)] ?? 0xffffff;
}

/** A missing $TILEMODE behaves like 0, a layout tab (VERIFIED-BY-ACAD, note 08 §1.3). */
function activeLayout(doc: DxfDocument): string {
  if (doc.header.num("$TILEMODE", 0) !== 0 || !doc.paperSpace) return "Model";
  const l = doc.layouts.find((x) => !x.isModel && x.block === doc.paperSpace);
  return l && l.block.entities.length > 0 ? l.name : "Model";
}

/** Summary of a loaded document for the UI (layouts, layers, counts). */
export function describe(doc: DxfDocument, name: string, byteLength: number, parseMs: number): DocumentInfo {
  const perLayer = new Map<string, { name: string; n: number }>();
  const types: Record<string, number> = {};
  let count = 0;
  const blocks = [doc.modelSpace, ...doc.layouts.filter((l) => !l.isModel).map((l) => l.block)];
  for (const b of new Set(blocks)) {
    for (const e of b.entities) {
      count++;
      types[e.dxfType] = (types[e.dxfType] ?? 0) + 1;
      const k = e.layer.toUpperCase();
      const c = perLayer.get(k);
      if (c) c.n++;
      else perLayer.set(k, { name: e.layer, n: 1 });
    }
  }
  const layers: LayerInfo[] = [];
  const seen = new Set<string>();
  for (const l of doc.tables.layers) {
    const k = l.name.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    layers.push({
      name: l.name,
      rgb: layerRgb(l),
      aci: Math.abs(l.color),
      off: l.off,
      frozen: l.frozen,
      plot: l.plot,
      entities: perLayer.get(k)?.n ?? 0,
    });
  }
  // layers used by entities but missing from the table behave like default layers
  for (const [k, v] of perLayer) {
    if (seen.has(k)) continue;
    layers.push({
      name: v.name,
      rgb: 0xffffff,
      aci: 7,
      off: false,
      frozen: false,
      plot: true,
      entities: v.n,
    });
  }
  layers.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const layouts: LayoutInfo[] = doc.layouts
    .map((l) => {
      const info: LayoutInfo = {
        name: l.isModel ? "Model" : l.name,
        isModel: l.isModel,
        tabOrder: l.tabOrder,
      };
      if (!l.isModel && l.block.entities.length === 0) info.empty = true;
      const o = l.object;
      if (!l.isModel && o) {
        const ext = {
          minX: o.extentsMin.x,
          minY: o.extentsMin.y,
          maxX: o.extentsMax.x,
          maxY: o.extentsMax.y,
        };
        if (
          ext.maxX > ext.minX &&
          ext.maxY > ext.minY &&
          Math.max(ext.maxX - ext.minX, ext.maxY - ext.minY) < 1e12
        )
          info.extents = ext;
        // paper size (mm) → paper units (72 = 0 inches) × plot scale; rotated paper swaps w, h
        let sheet: Rect | undefined;
        let size: [number, number] | undefined;
        if (o.paperWidth > 0 && o.paperHeight > 0) {
          const scale =
            o.scaleNumerator > 0 && o.scaleDenominator > 0 ? o.scaleDenominator / o.scaleNumerator : 1;
          const k = (o.paperUnits === 0 ? 1 / 25.4 : 1) * scale;
          let w = o.paperWidth * k;
          let h = o.paperHeight * k;
          let ml = o.margins[0] * k;
          let mb = o.margins[1] * k;
          if (o.rotation === 1 || o.rotation === 3) {
            [w, h] = [h, w];
            [ml, mb] = [mb, ml];
          }
          size = [w, h];
          sheet = { minX: -ml, minY: -mb, maxX: w - ml, maxY: h - mb };
        }
        // Layout limits are the sheet as AutoCAD shows it (margins / offset included), unless
        // they do not match the paper size (e.g. Revit's (0,0)-(12,9) on an A3 sheet).
        const lim = { minX: o.limitsMin.x, minY: o.limitsMin.y, maxX: o.limitsMax.x, maxY: o.limitsMax.y };
        const lw = lim.maxX - lim.minX;
        const lh = lim.maxY - lim.minY;
        const near = (a: number, b: number) => Math.abs(a - b) <= 0.05 * Math.max(a, b);
        const limitsOk =
          lw > 0 &&
          lh > 0 &&
          Number.isFinite(lw + lh) &&
          (!size || (near(lw, size[0]) && near(lh, size[1])) || (near(lw, size[1]) && near(lh, size[0])));
        const paper = limitsOk ? lim : sheet;
        if (paper) info.paper = paper;
      }
      return info;
    })
    .sort((a, b) => (a.isModel === b.isModel ? a.tabOrder - b.tabOrder : a.isModel ? -1 : 1));
  if (!layouts.some((l) => l.isModel)) layouts.unshift({ name: "Model", isModel: true, tabOrder: 0 });
  return {
    name,
    byteLength,
    acadver: doc.acadver,
    format: doc.tags.store.format,
    entityCount: count,
    entityTypes: types,
    layouts,
    activeLayout: activeLayout(doc),
    layers,
    diagnostics: doc.diagnostics.summary(),
    warnings: documentWarnings(doc),
    ms: { parse: parseMs },
  };
}
