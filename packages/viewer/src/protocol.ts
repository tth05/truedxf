/**
 * The viewer's backend protocol: parse → model → display list runs in a module worker (or on the
 * main thread as a fallback) behind these messages. `ViewerCore` is the backend logic itself; it
 * has no DOM or worker dependencies, so tests drive it directly.
 *
 * Display lists and pick indexes travel as transferables (typed-array buffers are moved, not
 * copied; docs/PLAN.md §4.2a).
 */
import {
  type DxfDocument,
  type Entity,
  type InsertEntity,
  type LayerEntry,
  loadDxf,
  PropertyResolver as ModelResolver,
} from "@truedxf/model";
import { ACI_RGB, type DisplayList, type PlotArea, renderPlot, transferables } from "@truedxf/render";
import { buildPickData, type PickData } from "./pick.ts";
import type { Rect } from "./view.ts";

// ---- public data shapes ------------------------------------------------------------------------

export interface LayoutInfo {
  name: string;
  isModel: boolean;
  tabOrder: number;
  /** Paper sheet in paper-space units (approximate: margins/offset), for paper-space layouts. */
  paper?: Rect;
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
  layers: LayerInfo[];
  /** Model diagnostics: occurrences per code. */
  diagnostics: Record<string, number>;
  ms: { parse: number };
}

export interface RenderParams {
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
}

export interface RenderResult {
  list: DisplayList;
  pick: PickData;
  view: Rect;
  unsupported: Record<string, number>;
  ms: { frontend: number; pick: number };
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
  | { type: "inspect"; handle: string };

export type ResponseValue<R extends Request> = R extends { type: "load" }
  ? DocumentInfo
  : R extends { type: "render" }
    ? RenderResult
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

/** Buffers to transfer with a response (display list and pick index). */
export function responseTransfer(value: unknown): ArrayBuffer[] {
  const v = value as Partial<RenderResult> | undefined;
  if (!v?.list || !v.pick) return [];
  const out = transferables(v.list);
  if (v.pick.index) out.push(v.pick.index);
  out.push(v.pick.items.buffer as ArrayBuffer);
  return [...new Set(out)];
}

export type AssetLoader = (name: string) => Promise<Uint8Array | undefined>;

// ---- the backend -------------------------------------------------------------------------------

export class ViewerCore {
  private doc: DxfDocument | undefined;
  private byId: Map<number, Entity> | undefined;
  private byHandle: Map<string, Entity> | undefined;
  private ownerBlock: Map<Entity, string> | undefined;
  /** Stable loader identities: the text layer caches fonts per loader function. */
  private readonly loadFont: AssetLoader;
  private readonly loadImage: AssetLoader;

  constructor(loadFont: AssetLoader, loadImage: AssetLoader) {
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
    }
  }

  load(bytes: Uint8Array, name: string): DocumentInfo {
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
    const t0 = performance.now();
    const res = await renderPlot(
      doc,
      {
        layout: p.layout,
        area: p.area,
        canvas: p.canvas,
        lineweights: p.lineweights,
        ...(p.styleTable ? { styleTable: p.styleTable } : {}),
      },
      {
        loadFont: this.loadFont,
        loadImage: this.loadImage,
        raster: p.raster,
        background: p.background,
        layerVisibility: new Map(Object.entries(p.layers).map(([k, v]) => [k.toUpperCase(), v])),
        rasterEntities: p.rasterEntities === false ? "omit" : "draw",
        visibility: p.visibility ?? "display",
        ...(p.dpi ? { calibration: { dpi: p.dpi } } : {}),
      },
    );
    const t1 = performance.now();
    const pick = buildPickData(res.displayList);
    const t2 = performance.now();
    return {
      list: res.displayList,
      pick,
      view: { ...res.view },
      unsupported: res.unsupported,
      ms: { frontend: t1 - t0, pick: t2 - t1 },
    };
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
      const o = l.object;
      if (!l.isModel && o) {
        const lim = { minX: o.limitsMin.x, minY: o.limitsMin.y, maxX: o.limitsMax.x, maxY: o.limitsMax.y };
        if (lim.maxX > lim.minX && lim.maxY > lim.minY && Number.isFinite(lim.maxX + lim.maxY)) {
          // layout limits are the paper sheet as AutoCAD shows it (plot scale included)
          info.paper = lim;
        } else if (o.paperWidth > 0 && o.paperHeight > 0) {
          // paper size (mm) → paper units (72 = 0 inches) × plot scale; rotated paper swaps w, h
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
          info.paper = { minX: -ml, minY: -mb, maxX: w - ml, maxY: h - mb };
        }
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
    layers,
    diagnostics: doc.diagnostics.summary(),
    ms: { parse: parseMs },
  };
}
