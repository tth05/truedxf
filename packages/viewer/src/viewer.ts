/**
 * DxfViewer: an embeddable, framework-free DXF viewer (docs/PLAN.md Phase 7).
 *
 * - Parsing, the model and display-list generation run in a module worker (backend.ts); display
 *   lists arrive as transferred buffers and are drawn by @truedxf/three's DisplayListRenderer.
 * - Interactive rendering uses `raster: "smooth"` with antialiasing. Lists are built for a pixel
 *   size; after zooming by more than the LOD factor a new list is requested (debounced) while the
 *   old one stays visible (lod.ts).
 * - After GPU upload only positions (for picking/highlighting) stay on the CPU.
 */
import type { Batch, DisplayList } from "@truedxf/render";
import { DisplayListRenderer } from "@truedxf/three";
import * as THREE from "three";
import { type Backend, LocalBackend, WorkerBackend } from "./backend.ts";
import { type LodOptions, needsRetessellation, targetPixelSize } from "./lod.ts";
import { Kind, type PickBatch, PickIndex } from "./pick.ts";
import type {
  AssetLoader,
  DocumentInfo,
  EntityInfo,
  LayerInfo,
  LayoutInfo,
  RenderParams,
  RenderResult,
} from "./protocol.ts";
import {
  fitRect,
  panBy,
  type Rect,
  resize,
  screenToWorld,
  unionRect,
  type ViewState,
  viewRect,
  worldToScreen,
  zoomAt,
} from "./view.ts";

export type Background = "dark" | "light" | readonly [number, number, number];

export interface DxfViewerOptions {
  /** Background: "dark" (default), "light" or RGB. ACI 7 contrasts with it. */
  background?: Background;
  /** Base URL fonts are fetched from by the default font loader (default "fonts/"). */
  fontBaseUrl?: string;
  /** Custom font loader (file or family name, lower-case) — replaces the fetch loader. */
  loadFont?: AssetLoader;
  /** Raster image loader for IMAGEDEF paths (default: none, images are missing). */
  loadImage?: AssetLoader;
  /** Web Worker backend: true (default), false (main thread) or a factory. */
  worker?: boolean | (() => Worker);
  /** Show lineweights (default true). */
  lineweights?: boolean;
  /** Antialiasing (default true). */
  antialias?: boolean;
  lod?: LodOptions;
  /** Debounce before a new level of detail is requested (ms, default 150). */
  lodDelay?: number;
  /** Pick tolerance in CSS pixels (default 6). */
  pickTolerance?: number;
  /** Hover highlighting (default true). */
  hover?: boolean;
  /** preserveDrawingBuffer (tests reading pixels). */
  preserveDrawingBuffer?: boolean;
}

export type Tool = "select" | "measure";

export interface RenderStats {
  batches: number;
  vertices: number;
  entities: number;
  pixelSize: number;
  unsupported: Record<string, number>;
  ms: { frontend: number; pick: number; transfer: number; upload: number; total: number };
}

export interface Measurement {
  a: [number, number];
  b: [number, number];
  distance: number;
  dx: number;
  dy: number;
  /** Angle of a→b in degrees, counter-clockwise from +x. */
  angle: number;
}

export interface ViewerEvents {
  load: DocumentInfo;
  render: RenderStats;
  select: { handle: string | undefined };
  hover: { handle: string | undefined };
  cursor: { x: number; y: number } | undefined;
  view: ViewState;
  busy: { busy: boolean; what: string };
  error: { error: Error };
  measure: Measurement | undefined;
  layout: { name: string };
}

const BACKGROUNDS = {
  dark: [33, 40, 48] as const,
  light: [255, 255, 255] as const,
};
const SELECT_COLOR = new THREE.Color(0x2f81f7);
const HOVER_COLOR = new THREE.Color(0xf0a33e);
const MEASURE_COLOR = new THREE.Color(0x22c55e);

interface CurrentList {
  key: string;
  pixelSize: number;
  bounds: Rect | undefined;
  batches: PickBatch[];
  entities: readonly string[];
  pick: PickIndex;
}

/** Default font loader: GET `<base><name>`; 404 → missing. Results are cached. */
export function fetchFontLoader(base: string): AssetLoader {
  const cache = new Map<string, Promise<Uint8Array | undefined>>();
  const root = base.endsWith("/") ? base : `${base}/`;
  return (name) => {
    const key = name.toLowerCase();
    let p = cache.get(key);
    if (!p) {
      p = fetch(`${root}${encodeURIComponent(key)}`)
        .then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined))
        .catch(() => undefined);
      cache.set(key, p);
    }
    return p;
  };
}

export class DxfViewer {
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: DisplayListRenderer;
  private readonly options: DxfViewerOptions;
  private readonly loadFont: AssetLoader;
  private readonly loadImage: AssetLoader;
  private backend: Backend;
  private readonly listeners = new Map<keyof ViewerEvents, Set<(v: never) => void>>();

  private info: DocumentInfo | undefined;
  private docGen = 0;
  private layoutName = "Model";
  private layerToggles = new Map<string, boolean>();
  private background: [number, number, number];
  private lineweights: boolean;
  private view: ViewState | undefined;
  private dpr = 1;
  private current: CurrentList | undefined;
  private inFlight = false;
  private again = false;
  /** Set when the next list must be an extents fit (new document / layout). */
  private fitPending = false;
  private lodTimer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  private readonly resizeObserver: ResizeObserver;
  private tool: Tool = "select";
  private selected: string | undefined;
  private hovered: string | undefined;
  private readonly selectGroup = new THREE.Group();
  private readonly hoverGroup = new THREE.Group();
  private readonly measureGroup = new THREE.Group();
  private readonly paperGroup = new THREE.Group();
  private measureA: [number, number] | undefined;
  private measureB: [number, number] | undefined;
  private cursorWorld: [number, number] | undefined;
  private lastRender: RenderStats | undefined;
  private disposed = false;

  // pointer state
  private readonly pointers = new Map<number, { x: number; y: number; button: number }>();
  private dragMoved = 0;
  private pinch: { dist: number; cx: number; cy: number } | undefined;
  private hoverScheduled = false;
  private lastPointer: { x: number; y: number } | undefined;

  constructor(container: HTMLElement, options: DxfViewerOptions = {}) {
    this.container = container;
    this.options = options;
    this.background = resolveBackground(options.background ?? "dark");
    this.lineweights = options.lineweights ?? true;
    this.loadFont = options.loadFont ?? fetchFontLoader(options.fontBaseUrl ?? "fonts/");
    this.loadImage = options.loadImage ?? (async () => undefined);
    this.backend = this.createBackend();

    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      touchAction: "none",
      outline: "none",
    });
    this.canvas.tabIndex = 0;
    container.append(this.canvas);
    this.renderer = new DisplayListRenderer({
      canvas: this.canvas,
      antialias: options.antialias ?? true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      exactBlend: false,
      releaseArrays: true,
    });
    // nested groups set their own three.js groupOrder: keep them above / below the drawing
    for (const g of [this.hoverGroup, this.selectGroup, this.measureGroup])
      g.renderOrder = Number.MAX_SAFE_INTEGER;
    this.paperGroup.renderOrder = -1;
    this.renderer.overlay.add(this.hoverGroup, this.selectGroup, this.measureGroup);
    this.renderer.underlay.add(this.paperGroup);
    this.applyClearColor();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();
    this.attachInput();
  }

  // ---- events -------------------------------------------------------------------------------

  on<K extends keyof ViewerEvents>(type: K, fn: (v: ViewerEvents[K]) => void): () => void {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(fn as (v: never) => void);
    return () => s.delete(fn as (v: never) => void);
  }

  private emit<K extends keyof ViewerEvents>(type: K, value: ViewerEvents[K]): void {
    for (const fn of this.listeners.get(type) ?? []) (fn as (v: ViewerEvents[K]) => void)(value);
  }

  // ---- public API ---------------------------------------------------------------------------

  get document(): DocumentInfo | undefined {
    return this.info;
  }

  get layouts(): readonly LayoutInfo[] {
    return this.info?.layouts ?? [];
  }

  get layers(): readonly LayerInfo[] {
    return this.info?.layers ?? [];
  }

  get layout(): string {
    return this.layoutName;
  }

  get backendKind(): "worker" | "main" {
    return this.backend.kind;
  }

  get stats(): RenderStats | undefined {
    return this.lastRender;
  }

  get viewState(): ViewState | undefined {
    return this.view ? { ...this.view } : undefined;
  }

  get selection(): string | undefined {
    return this.selected;
  }

  /** Loads a DXF (ASCII or binary) from bytes, a File/Blob or a URL. */
  async load(source: Uint8Array | ArrayBuffer | Blob | URL | string, name?: string): Promise<DocumentInfo> {
    this.emit("busy", { busy: true, what: "Loading" });
    try {
      let bytes: Uint8Array;
      let label = name;
      if (source instanceof Uint8Array) bytes = source;
      else if (source instanceof ArrayBuffer) bytes = new Uint8Array(source);
      else if (typeof Blob !== "undefined" && source instanceof Blob) {
        bytes = new Uint8Array(await source.arrayBuffer());
        label ??= (source as File).name;
      } else {
        const url = String(source);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        bytes = new Uint8Array(await r.arrayBuffer());
        label ??= decodeURIComponent(url.split(/[\\/]/).pop() ?? url);
      }
      const info = await this.callLoad(bytes, label ?? "drawing.dxf");
      this.info = info;
      this.docGen++;
      this.layerToggles = new Map();
      this.selected = undefined;
      this.hovered = undefined;
      this.clearMeasure();
      this.clearHighlight(this.selectGroup);
      this.clearHighlight(this.hoverGroup);
      this.layoutName = info.layouts.find((l) => l.isModel)?.name ?? "Model";
      this.emit("load", info);
      this.emit("layout", { name: this.layoutName });
      this.emit("select", { handle: undefined });
      await this.refit();
      return info;
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      this.emit("error", { error });
      throw error;
    } finally {
      this.emit("busy", { busy: false, what: "" });
    }
  }

  private async callLoad(bytes: Uint8Array, name: string): Promise<DocumentInfo> {
    // copy for the worker transfer (the caller may keep using its buffer)
    const own = bytes.slice();
    try {
      return await this.backend.call({ type: "load", bytes: own, name }, [own.buffer]);
    } catch (e) {
      // a worker that fails to start (e.g. no module worker support): fall back to the main thread
      if (this.backend.kind === "worker" && String(e).includes("viewer worker failed")) {
        this.backend.dispose();
        this.backend = new LocalBackend(this.loadFont, this.loadImage);
        return this.backend.call({ type: "load", bytes: bytes.slice(), name });
      }
      throw e;
    }
  }

  /** Switches to a layout ("Model" or a paper-space layout name) and fits it. */
  async setLayout(name: string): Promise<void> {
    if (!this.info) return;
    const l = this.info.layouts.find((x) => x.name.toUpperCase() === name.toUpperCase());
    if (!l || l.name === this.layoutName) return;
    this.layoutName = l.name;
    this.selected = undefined;
    this.clearHighlight(this.selectGroup);
    this.clearHighlight(this.hoverGroup);
    this.clearMeasure();
    this.emit("layout", { name: l.name });
    this.emit("select", { handle: undefined });
    await this.refit();
  }

  /** Whether a layer is currently shown (toggle, else its on/thawed state in the file). */
  isLayerVisible(name: string): boolean {
    const t = this.layerToggles.get(name.toUpperCase());
    if (t !== undefined) return t;
    const l = this.info?.layers.find((x) => x.name.toUpperCase() === name.toUpperCase());
    return l ? !l.off && !l.frozen : true;
  }

  setLayerVisible(name: string, visible: boolean): void {
    this.setLayersVisible([name], visible);
  }

  setLayersVisible(names: readonly string[], visible: boolean): void {
    for (const n of names) this.layerToggles.set(n.toUpperCase(), visible);
    this.requestList(0);
  }

  setBackground(bg: Background): void {
    this.background = resolveBackground(bg);
    this.applyClearColor();
    this.requestList(0);
  }

  get isDark(): boolean {
    return isDark(this.background);
  }

  setLineweights(on: boolean): void {
    this.lineweights = on;
    this.requestList(0);
  }

  /** Fits the view to the drawing extents (paper sheet included for layouts). */
  fit(): void {
    const r = this.fitRectangle();
    if (!r) return;
    this.setView(fitRect(r, this.cssWidth(), this.cssHeight()));
  }

  /** Zooms by a factor around the canvas centre (> 1 zooms in). */
  zoom(factor: number): void {
    if (!this.view) return;
    this.setView(zoomAt(this.view, this.view.width / 2, this.view.height / 2, factor));
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.canvas.style.cursor = tool === "measure" ? "crosshair" : "";
    if (tool !== "measure") this.clearMeasure();
  }

  get currentTool(): Tool {
    return this.tool;
  }

  screenToWorld(x: number, y: number): [number, number] | undefined {
    return this.view ? screenToWorld(this.view, x, y) : undefined;
  }

  worldToScreen(x: number, y: number): [number, number] | undefined {
    return this.view ? worldToScreen(this.view, x, y) : undefined;
  }

  /** Entity handle at a canvas point (CSS pixels), or undefined. */
  pickAt(x: number, y: number): string | undefined {
    if (!this.view || !this.current) return undefined;
    const [wx, wy] = screenToWorld(this.view, x, y);
    const tol = (this.options.pickTolerance ?? 6) * this.view.scale;
    return this.current.pick.pick(wx, wy, tol)?.handle;
  }

  /** Selects an entity by handle (undefined clears) and highlights it. */
  select(handle: string | undefined): void {
    this.selected = handle;
    this.highlight(this.selectGroup, handle, SELECT_COLOR, 1);
    this.emit("select", { handle });
    this.requestFrame();
  }

  /** Entity details (type, properties raw/resolved, raw DXF tags) from the model. */
  inspect(handle: string): Promise<EntityInfo | undefined> {
    return this.backend.call({ type: "inspect", handle });
  }

  /**
   * Renders a display list of the loaded document with explicit parameters (e.g. a plot with
   * `raster: "autocad"` for comparisons) without changing what the viewer shows.
   */
  renderList(params: RenderParams): Promise<RenderResult> {
    return this.backend.call({ type: "render", params });
  }

  /** Renders a frame now (normally scheduled automatically). */
  renderNow(): void {
    if (!this.view || this.disposed) return;
    this.renderer.render(viewRect(this.view));
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    clearTimeout(this.lodTimer);
    this.resizeObserver.disconnect();
    this.backend.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---- lists / LOD --------------------------------------------------------------------------

  private createBackend(): Backend {
    const w = this.options.worker ?? true;
    if (w !== false && typeof Worker !== "undefined") {
      try {
        const worker =
          typeof w === "function"
            ? w()
            : new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "truedxf-viewer" });
        return new WorkerBackend(worker, this.loadFont, this.loadImage);
      } catch {
        // fall through to the main thread
      }
    }
    return new LocalBackend(this.loadFont, this.loadImage);
  }

  private layoutInfo(): LayoutInfo | undefined {
    return this.info?.layouts.find((l) => l.name === this.layoutName);
  }

  /** Render background: layouts draw on white paper. */
  private renderBackground(): [number, number, number] {
    return this.layoutInfo()?.isModel === false ? [255, 255, 255] : this.background;
  }

  private contentKey(): string {
    return JSON.stringify([
      this.docGen,
      this.layoutName,
      this.renderBackground(),
      [...this.layerToggles].sort(),
      this.lineweights,
    ]);
  }

  private async refit(): Promise<void> {
    this.fitPending = true;
    this.current = undefined;
    // the old list belongs to another layout / document
    this.renderer.clear();
    this.drawPaper();
    this.renderNow();
    await this.fetchList();
  }

  /** Requests a new list after `delay` ms (debounced). */
  private requestList(delay = this.options.lodDelay ?? 150): void {
    clearTimeout(this.lodTimer);
    if (!this.info) return;
    this.lodTimer = setTimeout(() => void this.fetchList(), delay);
  }

  private checkLod(): void {
    const cur = this.current;
    if (!this.view || !cur) return;
    const target = targetPixelSize(this.view.scale, this.dpr, cur.bounds, this.options.lod);
    if (needsRetessellation(cur.pixelSize, target, this.options.lod)) this.requestList();
  }

  private renderParams(): RenderParams {
    const w = Math.max(1, Math.round(this.cssWidth() * this.dpr));
    const h = Math.max(1, Math.round(this.cssHeight() * this.dpr));
    const base = {
      layout: this.layoutName,
      canvas: [w, h] as [number, number],
      background: this.renderBackground(),
      layers: Object.fromEntries(this.layerToggles),
      lineweights: this.lineweights,
      raster: "smooth" as const,
      dpi: 100 * this.dpr,
    };
    if (this.fitPending || !this.view) return { ...base, area: { type: "extents" } };
    // the frontend tessellates the whole drawing; the window only sets the pixel size
    const px = targetPixelSize(this.view.scale, this.dpr, this.current?.bounds, this.options.lod);
    const hw = (w * px) / 2;
    const hh = (h * px) / 2;
    return {
      ...base,
      area: {
        type: "window",
        min: [this.view.cx - hw, this.view.cy - hh],
        max: [this.view.cx + hw, this.view.cy + hh],
      },
    };
  }

  private async fetchList(): Promise<void> {
    if (!this.info || this.disposed) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    this.again = false;
    const key = this.contentKey();
    const docGen = this.docGen;
    const layout = this.layoutName;
    const fit = this.fitPending;
    const params = this.renderParams();
    this.emit("busy", { busy: true, what: "Rendering" });
    const t0 = performance.now();
    try {
      const res = await this.backend.call({ type: "render", params });
      if (docGen === this.docGen && layout === this.layoutName && !this.disposed) {
        this.show(res, key, fit, performance.now() - t0);
      }
    } catch (e) {
      this.emit("error", { error: e instanceof Error ? e : new Error(String(e)) });
    } finally {
      this.inFlight = false;
      this.emit("busy", { busy: false, what: "" });
    }
    if (this.again || (this.current && this.current.key !== this.contentKey())) void this.fetchList();
    else this.checkLod();
  }

  private show(res: RenderResult, key: string, fit: boolean, roundTrip: number): void {
    const list = res.list;
    const t0 = performance.now();
    this.renderer.setDisplayList(list);
    this.applyClearColor();
    const bounds = boundsOf(list);
    const batches = list.batches.map(slimBatch);
    this.current = {
      key,
      pixelSize: list.pixelSize,
      bounds,
      batches,
      entities: list.entities,
      pick: new PickIndex(batches, list.entities, res.pick),
    };
    if (fit) {
      this.fitPending = false;
      const r = this.fitRectangle();
      this.view = r
        ? fitRect(r, this.cssWidth(), this.cssHeight())
        : fitRect({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, this.cssWidth(), this.cssHeight());
      this.emit("view", { ...this.view });
    }
    // re-highlight on the new list (entity indexes change)
    this.highlight(this.selectGroup, this.selected, SELECT_COLOR, 1);
    this.highlight(this.hoverGroup, this.hovered, HOVER_COLOR, 0.85);
    this.renderNow();
    const upload = performance.now() - t0;
    let vertices = 0;
    for (const b of list.batches) vertices += b.positions.length / 2;
    this.lastRender = {
      batches: list.batches.length,
      vertices,
      entities: list.entities.length,
      pixelSize: list.pixelSize,
      unsupported: res.unsupported,
      ms: {
        frontend: res.ms.frontend,
        pick: res.ms.pick,
        transfer: Math.max(0, roundTrip - res.ms.frontend - res.ms.pick),
        upload,
        total: roundTrip + upload,
      },
    };
    this.emit("render", this.lastRender);
  }

  private fitRectangle(): Rect | undefined {
    const paper = this.layoutInfo()?.paper;
    return unionRect(this.current?.bounds, paper);
  }

  // ---- drawing ------------------------------------------------------------------------------

  private applyClearColor(): void {
    const sheet = this.layoutInfo()?.paper !== undefined;
    const c = sheet ? (isDark(this.background) ? [58, 64, 72] : [205, 210, 216]) : this.renderBackground();
    this.renderer.renderer.setClearColor(new THREE.Color(c[0]! / 255, c[1]! / 255, c[2]! / 255), 1);
  }

  /** The paper sheet of a paper-space layout (white, with a soft shadow). */
  private drawPaper(): void {
    disposeChildren(this.paperGroup);
    this.applyClearColor();
    // layouts without a page setup draw on a white background (applyClearColor)
    const r = this.layoutInfo()?.paper;
    if (!r) return;
    const s = Math.max(r.maxX - r.minX, r.maxY - r.minY) * 0.006;
    this.paperGroup.add(
      rectMesh({ minX: r.minX + s, minY: r.minY - s, maxX: r.maxX + s, maxY: r.maxY - s }, 0x000000, 0.35),
    );
    this.paperGroup.add(rectMesh(r, 0xffffff, 1));
  }

  private requestFrame(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  private setView(v: ViewState): void {
    if (!(v.scale > 0) || !Number.isFinite(v.cx) || !Number.isFinite(v.cy)) return;
    this.view = v;
    this.requestFrame();
    this.emit("view", { ...v });
    this.checkLod();
    this.updateMeasureOverlay();
  }

  private cssWidth(): number {
    return Math.max(1, this.container.clientWidth);
  }

  private cssHeight(): number {
    return Math.max(1, this.container.clientHeight);
  }

  private handleResize(): void {
    const w = this.cssWidth();
    const h = this.cssHeight();
    const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const dprChanged = dpr !== this.dpr;
    this.dpr = dpr;
    this.renderer.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    if (this.view) {
      this.view = resize(this.view, w, h);
      if (dprChanged) this.requestList();
    }
    this.renderNow();
  }

  // ---- highlight ----------------------------------------------------------------------------

  private clearHighlight(g: THREE.Group): void {
    disposeChildren(g);
  }

  private highlight(g: THREE.Group, handle: string | undefined, color: THREE.Color, opacity: number): void {
    disposeChildren(g);
    const cur = this.current;
    if (!handle || !cur) return;
    const e = cur.pick.entityOf(handle);
    if (e < 0) return;
    for (const r of cur.pick.ranges(e)) {
      const b = cur.batches[r.batch];
      if (!b) continue;
      const pos = b.positions.slice(r.first * 2, (r.first + r.count) * 2);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(pos, 2));
      const common = { color, transparent: true, opacity, depthTest: false, depthWrite: false };
      let obj: THREE.Object3D;
      if (b.kind === Kind.Lines) obj = new THREE.LineSegments(geom, new THREE.LineBasicMaterial(common));
      else if (b.kind === Kind.Points)
        obj = new THREE.Points(
          geom,
          new THREE.PointsMaterial({ ...common, size: 3, sizeAttenuation: false }),
        );
      else obj = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ ...common, side: THREE.DoubleSide }));
      obj.position.set(b.originX, b.originY, 0);
      obj.frustumCulled = false;
      g.add(obj);
    }
  }

  // ---- measure ------------------------------------------------------------------------------

  private clearMeasure(): void {
    this.measureA = undefined;
    this.measureB = undefined;
    disposeChildren(this.measureGroup);
    this.emit("measure", undefined);
    this.requestFrame();
  }

  private measureClick(wx: number, wy: number): void {
    if (!this.measureA || this.measureB) {
      this.measureA = [wx, wy];
      this.measureB = undefined;
      this.emit("measure", undefined);
    } else {
      this.measureB = [wx, wy];
      const [ax, ay] = this.measureA;
      const dx = wx - ax;
      const dy = wy - ay;
      this.emit("measure", {
        a: [ax, ay],
        b: [wx, wy],
        dx,
        dy,
        distance: Math.hypot(dx, dy),
        angle: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360,
      });
    }
    this.updateMeasureOverlay();
  }

  private updateMeasureOverlay(): void {
    disposeChildren(this.measureGroup);
    const a = this.measureA;
    if (!a || !this.view) return;
    const b = this.measureB ?? this.cursorWorld;
    // positions relative to point a (float32 precision), group positioned at a
    const pts = b ? [0, 0, b[0] - a[0], b[1] - a[1]] : [0, 0];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 2));
    const common = { color: MEASURE_COLOR, transparent: true, depthTest: false, depthWrite: false };
    const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial(common));
    const dots = new THREE.Points(
      g,
      new THREE.PointsMaterial({ ...common, size: 7, sizeAttenuation: false }),
    );
    for (const o of [line, dots]) {
      o.position.set(a[0], a[1], 0);
      o.frustumCulled = false;
      this.measureGroup.add(o);
    }
    this.requestFrame();
  }

  // ---- input --------------------------------------------------------------------------------

  private local(ev: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  private attachInput(): void {
    const c = this.canvas;
    c.addEventListener(
      "wheel",
      (ev) => {
        if (!this.view) return;
        ev.preventDefault();
        const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
        const dy = Math.max(-400, Math.min(400, ev.deltaY * unit));
        const { x, y } = this.local(ev);
        this.setView(zoomAt(this.view, x, y, Math.exp(-dy * 0.0015)));
      },
      { passive: false },
    );
    c.addEventListener("contextmenu", (ev) => ev.preventDefault());
    c.addEventListener("pointerdown", (ev) => {
      c.focus();
      const p = this.local(ev);
      this.pointers.set(ev.pointerId, { ...p, button: ev.button });
      c.setPointerCapture(ev.pointerId);
      if (ev.button === 1) ev.preventDefault();
      this.dragMoved = 0;
      if (this.pointers.size === 2) this.pinch = this.pinchState();
    });
    c.addEventListener("pointermove", (ev) => {
      const p = this.local(ev);
      this.lastPointer = p;
      const prev = this.pointers.get(ev.pointerId);
      if (this.view) {
        this.cursorWorld = screenToWorld(this.view, p.x, p.y);
        this.emit("cursor", { x: this.cursorWorld[0], y: this.cursorWorld[1] });
        if (this.measureA && !this.measureB) this.updateMeasureOverlay();
      }
      if (!prev) {
        this.scheduleHover();
        return;
      }
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      prev.x = p.x;
      prev.y = p.y;
      if (!this.view) return;
      if (this.pointers.size >= 2) {
        const now = this.pinchState();
        if (this.pinch && now) {
          let v = panBy(this.view, now.cx - this.pinch.cx, now.cy - this.pinch.cy);
          if (this.pinch.dist > 0 && now.dist > 0) v = zoomAt(v, now.cx, now.cy, now.dist / this.pinch.dist);
          this.setView(v);
        }
        this.pinch = now;
        this.dragMoved += 10;
        return;
      }
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      // left drag pans only after a small threshold, so clicks stay clicks
      if (prev.button === 1 || prev.button === 2 || this.dragMoved > 3)
        this.setView(panBy(this.view, dx, dy));
    });
    const end = (ev: PointerEvent) => {
      const prev = this.pointers.get(ev.pointerId);
      this.pointers.delete(ev.pointerId);
      this.pinch = this.pointers.size === 2 ? this.pinchState() : undefined;
      if (!prev || ev.type === "pointercancel") return;
      if (prev.button === 0 && this.dragMoved <= 3 && this.pointers.size === 0) {
        const p = this.local(ev);
        if (this.tool === "measure" && this.view) {
          const [wx, wy] = screenToWorld(this.view, p.x, p.y);
          this.measureClick(wx, wy);
        } else this.select(this.pickAt(p.x, p.y));
      }
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("pointerleave", () => {
      this.cursorWorld = undefined;
      this.emit("cursor", undefined);
      if (this.hovered !== undefined && this.pointers.size === 0) this.setHover(undefined);
    });
    c.addEventListener("dblclick", (ev) => {
      if (this.tool === "select" && this.pickAt(this.local(ev).x, this.local(ev).y) === undefined) this.fit();
    });
    c.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        if (this.tool === "measure") this.clearMeasure();
        else this.select(undefined);
      }
    });
  }

  private pinchState(): { dist: number; cx: number; cy: number } | undefined {
    const ps = [...this.pointers.values()];
    if (ps.length < 2) return undefined;
    const a = ps[0]!;
    const b = ps[1]!;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  private scheduleHover(): void {
    if (this.options.hover === false || this.hoverScheduled) return;
    this.hoverScheduled = true;
    requestAnimationFrame(() => {
      this.hoverScheduled = false;
      const p = this.lastPointer;
      if (!p || this.pointers.size > 0) return;
      this.setHover(this.pickAt(p.x, p.y));
    });
  }

  private setHover(handle: string | undefined): void {
    if (handle === this.hovered) return;
    this.hovered = handle;
    this.highlight(this.hoverGroup, handle === this.selected ? undefined : handle, HOVER_COLOR, 0.85);
    this.canvas.style.cursor = this.tool === "measure" ? "crosshair" : handle ? "pointer" : "";
    this.emit("hover", { handle });
    this.requestFrame();
  }
}

function slimBatch(b: Batch): PickBatch {
  return { kind: b.kind, originX: b.originX, originY: b.originY, positions: b.positions };
}

function boundsOf(list: DisplayList): Rect | undefined {
  const b = list.bounds;
  return b.maxX >= b.minX && b.maxY >= b.minY ? { ...b } : undefined;
}

function resolveBackground(bg: Background): [number, number, number] {
  if (bg === "dark") return [...BACKGROUNDS.dark];
  if (bg === "light") return [...BACKGROUNDS.light];
  return [bg[0], bg[1], bg[2]];
}

function isDark(c: readonly [number, number, number]): boolean {
  return c[0] + c[1] + c[2] < 384;
}

function rectMesh(r: Rect, color: number, opacity: number): THREE.Mesh {
  const w = r.maxX - r.minX;
  const h = r.maxY - r.minY;
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, w, 0, w, h, 0, 0, w, h, 0, h]), 2),
  );
  const m = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  m.position.set(r.minX, r.minY, 0);
  m.frustumCulled = false;
  return m;
}

function disposeChildren(g: THREE.Group): void {
  for (const o of [...g.children]) {
    g.remove(o);
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) for (const x of mat) x.dispose();
    else mat?.dispose();
  }
}
