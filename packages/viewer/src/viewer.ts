/**
 * DxfViewer: an embeddable, framework-free DXF viewer (docs/PLAN.md Phase 7).
 *
 * - Parsing, the model and display-list generation run in a module worker (backend.ts); display
 *   lists arrive as transferred buffers and are drawn by @truedxf/three's DisplayListRenderer.
 * - Interactive rendering uses `raster: "smooth"` with antialiasing. Lists are built for a pixel
 *   size; after zooming by more than the LOD factor a new list is requested (debounced) while the
 *   old one stays visible (lod.ts).
 * - After GPU upload the main thread retains only metadata and selected/hover highlight geometry.
 */
import type { PdfRasterizerOptions } from "@truedxf/pdf";
import type { ClipRegion } from "@truedxf/render";
import { CLIPPED_STENCIL, DisplayListRenderer } from "@truedxf/three";
import * as THREE from "three";
import { type Backend, LocalBackend, WorkerBackend } from "./backend.ts";
import { contains, expandView, needsCoverage } from "./cull.ts";
import type { EntityGeometry } from "./drawing.ts";
import {
  type AssetKind,
  chooseDrawing,
  type FileInput,
  FileStore,
  relativeUrls,
  type ViewerFile,
} from "./files.ts";
import {
  type Interaction,
  type InteractionOption,
  initialInteraction,
  resolveInteraction,
} from "./interaction.ts";
import { LatestQuery } from "./latest-query.ts";
import { type LodOptions, needsRetessellation, targetPixelSize } from "./lod.ts";
import { Kind } from "./pick.ts";
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
  constrainView,
  fitRect,
  isValidRect,
  limitZoomFactor,
  panBy,
  type Rect,
  resize,
  screenToWorld,
  unionRect,
  type ViewLimits,
  type ViewState,
  viewRect,
  worldToScreen,
  zoomAt,
  zoomLevel,
} from "./view.ts";
import { MISSING_FILE_CODES, type ViewerWarning } from "./warnings.ts";

export type Background = "dark" | "light" | readonly [number, number, number];

export interface DxfViewerOptions {
  /** Background: "dark" (default), "light" or RGB. ACI 7 contrasts with it. */
  background?: Background;
  /**
   * Base URL fonts are fetched from by the default font loader (default "fonts/"). Fonts are
   * looked up in the viewer's files (addFiles) first.
   */
  fontBaseUrl?: string;
  /**
   * Custom font loader (file or family name, lower-case); replaces the fetch loader. Asked
   * after the viewer's files (addFiles).
   */
  loadFont?: AssetLoader;
  /**
   * Raster image loader for IMAGEDEF / underlay paths as written in the file (default: none).
   * Asked after the viewer's files (addFiles), before `resolveRelativeToDrawing`.
   */
  loadImage?: AssetLoader;
  /**
   * For drawings opened from a URL (`load(url)`): fetch image files next to it when neither the
   * viewer's files nor `loadImage` have them: the IMAGEDEF path resolved against the drawing
   * URL when it is relative, then its base name in the drawing's folder. Default true.
   */
  resolveRelativeToDrawing?: boolean;
  /**
   * PDF underlay content, rendered by PDF.js (`@truedxf/pdf`, loaded only for drawings with
   * PDF underlays): rasterizer options (`assetsUrl`: a folder with pdfjs-dist's standard_fonts/,
   * cmaps/, wasm/ and iccs/), or false to draw underlay frames only. Default: enabled.
   */
  pdf?: PdfRasterizerOptions | false;
  /** Web Worker backend: true (default), false (main thread) or a factory. */
  worker?: boolean | (() => Worker);
  /** Show lineweights (default true). */
  lineweights?: boolean;
  /** Antialiasing (default true). */
  antialias?: boolean;
  /** Merge opaque display-list batches to reduce draw calls (default true). */
  mergeBatches?: boolean;
  /** Sub-pixel approximations (default true), or zoom re-tessellation settings. */
  lod?: boolean | LodOptions;
  /** Cull zoomed detail lists (default true); false supports full-list comparisons. */
  viewCulling?: boolean;
  /** Debounce before a new level of detail is requested (ms, default 150). */
  lodDelay?: number;
  /** Pick tolerance in CSS pixels (default 6). */
  pickTolerance?: number;
  /**
   * Which input the viewer handles: true (default) everything, false nothing (a display-only
   * view: the page scrolls over it and the browser's context menu works), or single switches
   * (missing ones stay on), e.g. `{ zoom: "ctrl", select: false }`. See setInteraction().
   */
  interaction?: InteractionOption;
  /**
   * When the view fits the drawing by itself: "load" (default) when a drawing is loaded or the
   * layout changes; "always" also when the container resizes, until the user (or setView) moves
   * the view, and again after fit(); false only when there is no view yet, so reloading a
   * drawing or switching layouts keeps the view.
   */
  autoFit?: AutoFit;
  /** Margin around the drawing when fitting, relative to its size per side (default 0.04). */
  fitMargin?: number;
  /** Zoom limits relative to the fitted view, and keeping the drawing in view (default none). */
  limits?: ViewLimits;
  /**
   * Layout shown after loading: "model" (default), "active" (the one current when the file was
   * saved, DocumentInfo.activeLayout), a layout name (else model space) or a function choosing one.
   */
  initialLayout?: InitialLayout;
  /** Highlight, measure and layout surround colours (CSS colour strings or 0xRRGGBB). */
  colors?: ViewerColors;
  /** preserveDrawingBuffer (tests reading pixels). */
  preserveDrawingBuffer?: boolean;
  /**
   * Font file(s) (names as the font loader serves them) for text whose font is missing, tried in
   * order; default: the render layer's list (simplex.shx, txt.shx, arial.ttf,
   * LiberationSans-Regular.ttf). Missing fonts are reported as `font-missing` warnings.
   */
  fallbackFont?: string | readonly string[];
  /** Big font (.shx) for missing big fonts (default: none). */
  fallbackBigFont?: string;
}

export type Tool = "select" | "measure";

export type AutoFit = "load" | "always" | false;

export type InitialLayout = "model" | "active" | (string & {}) | ((doc: DocumentInfo) => string | undefined);

/** A CSS colour string ("#2f81f7", "rgb(...)", names) or 0xRRGGBB. */
export type ViewerColor = string | number;

export interface ViewerColors {
  /** Selected entity (default #2f81f7). */
  select?: ViewerColor;
  /** Entity under the pointer (default #f0a33e). */
  hover?: ViewerColor;
  /** Measure tool line and points (default #ff2d95). */
  measure?: ViewerColor;
  /**
   * Around the paper sheet of a layout (default: a grey matching the background). The sheet
   * itself stays white: the drawing's colours are contrasted against white paper.
   */
  surround?: ViewerColor;
}

export interface RenderStats {
  batches: number;
  vertices: number;
  entities: number;
  pixelSize: number;
  unsupported: Record<string, number>;
  /** Warnings of this render (empty / invisible output, missing fonts, …). */
  warnings: ViewerWarning[];
  ms: { frontend: number; pick: number; merge: number; transfer: number; upload: number; total: number };
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
  /**
   * The current warnings changed (document warnings followed by those of the current layout's
   * render; see DxfViewer.warnings). Emitted after load and after renders that change them.
   */
  warnings: readonly ViewerWarning[];
  /** The viewer's additional files changed (addFiles, removeFile, clearFiles, openFiles). */
  files: readonly ViewerFile[];
}

/** Result of DxfViewer.openFiles. */
export interface OpenFilesResult {
  /** The drawings (.dxf) among the given files, in input order. */
  drawings: ViewerFile[];
  /** The drawing that was opened, if any. */
  opened: ViewerFile | undefined;
  /** The opened drawing's document info. */
  document: DocumentInfo | undefined;
}

export interface OpenFilesOptions {
  /**
   * Which drawing to open: a name or path (loose matching like resources), or `false` to only
   * add the files (e.g. to let the user choose among several drawings first). Default: the
   * first drawing among the given files.
   */
  drawing?: string | false;
}

const BACKGROUNDS = {
  dark: [33, 40, 48] as const,
  light: [255, 255, 255] as const,
};
const DEFAULT_COLORS = { select: 0x2f81f7, hover: 0xf0a33e, measure: 0xff2d95 } as const;
/** Margin of zoomToEntity: a lone entity right at the canvas edge looks cut off. */
const ENTITY_MARGIN = 0.25;

interface CurrentList {
  key: string;
  pixelSize: number;
  bounds: Rect | undefined;
  generation: number;
  covered?: Rect;
  /** Clip regions of the list (highlights of viewport content are clipped like it). */
  clips: readonly ClipRegion[];
}

/**
 * Default font loader: GET `<base><name>` (lower-case file name). When `<base>index.json` lists
 * the available files, only listed files are requested; text styles make the resolver probe
 * many candidate names, and missing ones must not show up as failed requests. Cached.
 */
export function fetchFontLoader(base: string): AssetLoader {
  const cache = new Map<string, Promise<Uint8Array | undefined>>();
  const root = base.endsWith("/") ? base : `${base}/`;
  let index: Promise<Set<string> | undefined> | undefined;
  return (name) => {
    const key = name.toLowerCase();
    let p = cache.get(key);
    if (!p) {
      index ??= fetch(`${root}index.json`)
        .then(async (r) =>
          r.ok ? new Set(((await r.json()) as string[]).map((x) => x.toLowerCase())) : undefined,
        )
        .catch(() => undefined);
      p = index.then((known) =>
        known && !known.has(key)
          ? undefined
          : fetch(`${root}${encodeURIComponent(key)}`)
              .then(async (r) => (r.status === 200 ? new Uint8Array(await r.arrayBuffer()) : undefined))
              .catch(() => undefined),
      );
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
  private readonly store = new FileStore();
  /** Absolute URL of the open drawing when it was loaded from a URL (resolveRelativeToDrawing). */
  private drawingUrl: string | undefined;
  private readonly nearDrawing = new Map<string, Promise<Uint8Array | undefined>>();
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
  private base: CurrentList | undefined;
  private clickRevision = 0;
  private readonly geometryCache = new Map<string, Promise<EntityGeometry | undefined>>();
  private readonly highlightRevision = new Map<THREE.Group, number>();
  private readonly hoverQuery = new LatestQuery(
    (p: { x: number; y: number; current: CurrentList }) => this.pickAt(p.x, p.y),
    (handle, p) => {
      if (this.current === p.current && !this.disposed && this.input.hover && this.pointers.size === 0)
        this.setHover(handle);
    },
    (error) => this.interactionError(error),
  );
  private inFlight = false;
  private again = false;
  /** Set when the next list must be an extents fit (new document / layout). */
  private fitPending = false;
  private lodTimer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  private readonly resizeObserver: ResizeObserver;
  private tool: Tool = "select";
  private input: Interaction;
  private autoFit: AutoFit;
  private limits: ViewLimits | undefined;
  private readonly colors: {
    select: THREE.Color;
    hover: THREE.Color;
    measure: THREE.Color;
    surround: THREE.Color | undefined;
  };
  /** The view is the fitted one (autoFit "always" re-fits it on resize). */
  private fitted = false;
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
  private renderWarnings: ViewerWarning[] = [];
  private warningsKey = "[]";
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
    this.input = initialInteraction(options.interaction);
    this.autoFit = options.autoFit ?? "load";
    this.limits = options.limits;
    this.colors = {
      select: new THREE.Color(DEFAULT_COLORS.select),
      hover: new THREE.Color(DEFAULT_COLORS.hover),
      measure: new THREE.Color(DEFAULT_COLORS.measure),
      surround: undefined,
    };
    this.assignColors(options.colors ?? {});
    // Every asset request: the viewer's files, then the configured loader (then, for images, the
    // drawing's URL folder). These identities stay fixed; the backend makes fresh ones per file
    // store generation (RenderParams.assets) because the renderer caches per loader identity.
    const userFont = options.loadFont ?? fetchFontLoader(options.fontBaseUrl ?? "fonts/");
    const userImage = options.loadImage;
    this.loadFont = async (name) => (await this.store.read(name, "font")) ?? (await tryLoad(userFont, name));
    this.loadImage = async (name) =>
      (await this.store.read(name, "image")) ??
      (userImage ? await tryLoad(userImage, name) : undefined) ??
      (await this.loadNearDrawing(name));
    this.backend = this.createBackend();

    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      outline: "none",
    });
    container.append(this.canvas);
    this.renderer = new DisplayListRenderer({
      canvas: this.canvas,
      antialias: options.antialias ?? true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      exactBlend: false,
      mergeBatches: options.mergeBatches ?? true,
      releaseArrays: true,
    });
    // nested groups set their own three.js groupOrder: keep them above / below the drawing, each
    // its own order so the stencil passes of clipped highlights do not interleave
    [this.hoverGroup, this.selectGroup, this.measureGroup].forEach((g, i) => {
      g.renderOrder = Number.MAX_SAFE_INTEGER - 2 + i;
    });
    this.paperGroup.renderOrder = -1;
    this.renderer.detailOverlay.add(this.hoverGroup, this.selectGroup);
    this.renderer.overlay.add(this.measureGroup);
    this.renderer.underlay.add(this.paperGroup);
    this.applyClearColor();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();
    this.attachInput();
    this.applyInteraction();
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

  /**
   * Why the view may look empty, and what was substituted: document warnings (e.g. every layer
   * with content is set not to plot) followed by those of the current render (empty layout,
   * hidden layers, content in the background colour, missing fonts). Stable `code`s, see
   * ViewerWarningCode.
   */
  get warnings(): readonly ViewerWarning[] {
    return [...(this.info?.warnings ?? []), ...this.renderWarnings];
  }

  /**
   * Names of files the current drawing needs but the viewer could not find (fonts, big fonts,
   * images, shape files: the `items` of the MISSING_FILE_CODES warnings, as written in the file;
   * font names may be family names). Add them with addFiles; the view re-renders.
   */
  get missingFiles(): string[] {
    const out = new Set<string>();
    for (const w of this.warnings)
      if (MISSING_FILE_CODES.includes(w.code)) for (const i of w.items ?? []) out.add(i);
    return [...out];
  }

  // ---- additional files ---------------------------------------------------------------------

  /** The additional files (fonts, shape files, images, drawings), by path. */
  get files(): readonly ViewerFile[] {
    return this.store.list();
  }

  /**
   * Adds files the drawing references (fonts, .shx shape files / big fonts, images, …). Asset
   * requests look here first, by file name (loose matching, see the README / files.ts); a
   * `File`'s `webkitRelativePath` (folder picks) is its path. Files are read when requested.
   * A drawing that is open re-renders, so warnings such as `font-missing` update.
   */
  addFiles(files: Iterable<File | FileInput>): ViewerFile[] {
    const added = this.store.add(files);
    if (added.length) this.filesChanged();
    return added;
  }

  /** Removes a file by path, or every file with that name. Returns whether any was removed. */
  removeFile(nameOrPath: string): boolean {
    const n = this.store.remove(nameOrPath);
    if (n) this.filesChanged();
    return n > 0;
  }

  /** Removes every additional file. */
  clearFiles(): void {
    if (this.store.size === 0) return;
    this.store.clear();
    this.filesChanged();
  }

  /**
   * Looks every font and image up again and re-renders: call it when `loadFont` / `loadImage`
   * start returning other files (e.g. the user chose a fonts folder the loader reads from).
   */
  reloadAssets(): void {
    this.store.touch();
    if (this.info) this.requestList(0);
  }

  /** The additional file a requested name (e.g. an IMAGEDEF path) resolves to, if any. */
  findFile(request: string, kind?: AssetKind): ViewerFile | undefined {
    return this.store.find(request, kind);
  }

  /**
   * Opens a drawing together with its resources: every file is added (drawings too, so that
   * openDrawing can switch between them), and the drawing chosen by `options.drawing` (default:
   * the first .dxf among `files`) is opened. Without a drawing among the files (and no
   * `options.drawing`), the open drawing re-renders with the new files.
   */
  async openFiles(
    files: Iterable<File | FileInput>,
    options: OpenFilesOptions = {},
  ): Promise<OpenFilesResult> {
    const added = this.store.add(files);
    const drawings = added.filter((f) => f.kind === "drawing");
    const opened = chooseDrawing(this.store, added, options.drawing);
    if (added.length) this.emit("files", this.store.list());
    if (typeof options.drawing === "string" && !opened)
      throw new Error(`${options.drawing}: no such drawing among the files`);
    if (!opened) {
      if (added.length && this.info) this.requestList(0);
      return { drawings, opened, document: undefined };
    }
    const document = await this.openDrawing(opened.path);
    return { drawings, opened, document };
  }

  /** Opens a drawing that is among the additional files (by path or name). */
  async openDrawing(nameOrPath: string): Promise<DocumentInfo> {
    const file = this.store.find(nameOrPath, "drawing");
    const data = this.store.data(nameOrPath, "drawing");
    if (!file || !data) throw new Error(`${nameOrPath}: no such drawing among the files`);
    return this.loadFrom(data, file.name, file.path);
  }

  private filesChanged(): void {
    this.emit("files", this.store.list());
    // the new store generation (contentKey) makes the backend look every asset up again
    if (this.info) this.requestList(0);
  }

  private async loadNearDrawing(name: string): Promise<Uint8Array | undefined> {
    const base = this.drawingUrl;
    if (!base || this.options.resolveRelativeToDrawing === false) return undefined;
    for (const url of relativeUrls(base, name)) {
      let p = this.nearDrawing.get(url);
      if (!p) {
        p = fetch(url)
          .then(async (r) => (r.status === 200 ? new Uint8Array(await r.arrayBuffer()) : undefined))
          .catch(() => undefined);
        this.nearDrawing.set(url, p);
      }
      const bytes = await p;
      if (bytes) return bytes;
    }
    return undefined;
  }

  /**
   * Loads a DXF (ASCII or binary) from bytes, a File/Blob or a URL. The additional files stay
   * (see addFiles / openFiles); a File that is among them resolves relative paths from its folder.
   */
  async load(source: Uint8Array | ArrayBuffer | Blob | URL | string, name?: string): Promise<DocumentInfo> {
    const isBlob = typeof Blob !== "undefined" && source instanceof Blob;
    return this.loadFrom(source, name, isBlob ? this.store.pathOf(source) : undefined);
  }

  private async loadFrom(
    source: Uint8Array | ArrayBuffer | Blob | URL | string,
    name: string | undefined,
    storePath: string | undefined,
  ): Promise<DocumentInfo> {
    this.emit("busy", { busy: true, what: "Loading" });
    try {
      let bytes: Uint8Array;
      let label = name;
      let url: string | undefined;
      if (source instanceof Uint8Array) bytes = source;
      else if (source instanceof ArrayBuffer) bytes = new Uint8Array(source);
      else if (typeof Blob !== "undefined" && source instanceof Blob) {
        bytes = new Uint8Array(await source.arrayBuffer());
        label ??= (source as File).name;
      } else {
        url = String(source);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        bytes = new Uint8Array(await r.arrayBuffer());
        label ??= decodeURIComponent(url.split(/[\\/]/).pop() ?? url);
      }
      this.drawingUrl = url === undefined ? undefined : absoluteUrl(url);
      this.nearDrawing.clear();
      this.store.setDrawing(storePath);
      const info = await this.callLoad(bytes, label ?? "drawing.dxf");
      this.info = info;
      this.docGen++;
      this.layerToggles = new Map();
      this.selected = undefined;
      this.hovered = undefined;
      this.clearMeasure();
      this.clearHighlight(this.selectGroup);
      this.clearHighlight(this.hoverGroup);
      this.layoutName = this.initialLayout(info);
      this.renderWarnings = [];
      this.emit("load", info);
      this.emitWarnings();
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
    this.renderWarnings = [];
    this.emitWarnings();
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

  /**
   * Fits the view to the drawing extents (paper sheet included for layouts). With autoFit
   * "always" the view then follows container resizes again.
   */
  fit(): void {
    const r = this.fitRectangle();
    if (!r) return;
    this.applyView(this.fitView(r), true);
  }

  /** Fits the view to a world rectangle; `margin` per side relative to its size (default fitMargin). */
  fitTo(rect: Rect, margin = this.fitMargin): void {
    if (!isValidRect(rect)) return;
    this.applyView(fitRect(rect, this.cssWidth(), this.cssHeight(), margin));
  }

  /**
   * Zooms to an entity of the current layout (its drawn geometry; margin per side relative to its
   * size, default 0.25). A point only centres the view. False when the entity draws nothing here.
   */
  async zoomToEntity(handle: string, margin = ENTITY_MARGIN): Promise<boolean> {
    const cur = this.current;
    if (!cur || !this.view) return false;
    const r = (await this.entityGeometry(handle))?.bounds;
    if (!r || this.current !== cur || this.disposed) return false;
    if (r.maxX === r.minX && r.maxY === r.minY) this.setView({ cx: r.minX, cy: r.minY });
    else this.fitTo(r, margin);
    return true;
  }

  /** Sets the view centre (world coordinates) and / or scale (world units per CSS pixel). */
  setView(view: { cx?: number; cy?: number; scale?: number }): void {
    if (!this.view) return;
    this.applyView({
      ...this.view,
      ...(view.cx !== undefined ? { cx: view.cx } : {}),
      ...(view.cy !== undefined ? { cy: view.cy } : {}),
      ...(view.scale !== undefined ? { scale: view.scale } : {}),
    });
  }

  /** Zooms by a factor around the canvas centre (> 1 zooms in), within the zoom limits. */
  zoom(factor: number): void {
    if (!this.view) return;
    this.applyView(zoomAt(this.view, this.view.width / 2, this.view.height / 2, this.limitZoom(factor)));
  }

  /** Zoom level relative to the fitted view (1 = fitted), or undefined before the first render. */
  get zoomLevel(): number | undefined {
    const r = this.fitRectangle();
    return this.view && r ? zoomLevel(this.view, r, this.fitMargin) : undefined;
  }

  /** The input switches in effect. */
  get interaction(): Interaction {
    return { ...this.input };
  }

  /**
   * Changes which input the viewer handles: true / false for everything, or the switches to
   * change, e.g. `setInteraction({ pan: false, zoom: false })` to lock the view.
   */
  setInteraction(change: InteractionOption): void {
    this.input = resolveInteraction(this.input, change);
    this.applyInteraction();
  }

  setAutoFit(mode: AutoFit): void {
    this.autoFit = mode;
  }

  /** Changes the navigation limits; the current view is brought within them. */
  setLimits(limits: ViewLimits | undefined): void {
    this.limits = limits;
    if (this.view) this.applyView(this.view, this.fitted);
  }

  /** Changes highlight, measure or surround colours (undefined keeps a colour). */
  setColors(colors: ViewerColors): void {
    this.assignColors(colors);
    this.applyClearColor();
    this.highlight(this.selectGroup, this.selected, this.colors.select, 1);
    this.highlight(this.hoverGroup, this.hoverShown(), this.colors.hover, 0.85);
    this.updateMeasureOverlay();
    this.requestFrame();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.updateCursor();
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
  async pickAt(x: number, y: number): Promise<string | undefined> {
    if (!this.view || !this.current) return undefined;
    const [wx, wy] = screenToWorld(this.view, x, y);
    // Coarse fallback is display-only: outside detail coverage wait for the next list.
    if (this.current.covered && !contains(this.current.covered, wx, wy)) return undefined;
    const tol = (this.options.pickTolerance ?? 6) * this.view.scale;
    const cur = this.current;
    const hit = await this.backend.call({
      type: "pick",
      point: [wx, wy],
      tolerance: tol,
      generation: cur.generation,
    });
    return this.current === cur && !this.disposed ? hit?.handle : undefined;
  }

  /** Selects an entity by handle (undefined clears) and highlights it. */
  select(handle: string | undefined): void {
    this.clickRevision++;
    this.selected = handle;
    this.pruneGeometryCache();
    this.highlight(this.selectGroup, handle, this.colors.select, 1);
    this.highlight(this.hoverGroup, this.hoverShown(), this.colors.hover, 0.85);
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
    return this.backend.call({
      type: "render",
      params: { assets: this.store.generation, pdf: this.options.pdf ?? {}, ...params, retain: false },
    });
  }

  /** Renders a frame now (normally scheduled automatically). */
  renderNow(): void {
    if (!this.view || this.disposed) return;
    this.renderer.render(viewRect(this.view));
  }

  /**
   * The current view as an image (PNG by default) at the canvas resolution. The frame is drawn
   * and copied in the same task, so this works without preserveDrawingBuffer.
   */
  snapshot(type = "image/png", quality?: number): Promise<Blob> {
    this.renderNow();
    return new Promise((resolve, reject) =>
      this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("snapshot failed"))), type, quality),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.hoverQuery.cancel();
    this.current = undefined;
    this.geometryCache.clear();
    this.clearHighlight(this.selectGroup);
    this.clearHighlight(this.hoverGroup);
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
      this.store.generation,
    ]);
  }

  private async refit(): Promise<void> {
    this.fitPending = this.autoFit !== false || !this.view;
    this.current = undefined;
    this.base = undefined;
    this.renderer.clearBase();
    this.hoverQuery.cancel();
    this.clickRevision++;
    this.geometryCache.clear();
    this.clearHighlight(this.selectGroup);
    this.clearHighlight(this.hoverGroup);
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
    const options = typeof this.options.lod === "object" ? this.options.lod : undefined;
    const target = targetPixelSize(this.view.scale, this.dpr, this.fitRectangle(), options);
    if (
      needsRetessellation(cur.pixelSize, target, options) ||
      (cur.covered && needsCoverage(viewRect(this.view), cur.covered))
    )
      this.requestList();
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
      mergeBatches: this.options.mergeBatches ?? true,
      lod: this.options.lod !== false,
      dpi: 100 * this.dpr,
      assets: this.store.generation,
      pdf: this.options.pdf ?? {},
      ...(this.options.fallbackFont !== undefined ? { fallbackFont: this.options.fallbackFont } : {}),
      ...(this.options.fallbackBigFont !== undefined
        ? { fallbackBigFont: this.options.fallbackBigFont }
        : {}),
    };
    if (this.fitPending || !this.view) {
      // Paper layouts fit their sheet. Not the display-list extents: those include model-space
      // content outside the viewports (clipped by the stencil, but still in the bounds), which
      // made the sheet a dot on a far too coarse list.
      const frame = this.layoutFrame();
      if (!frame) return { ...base, area: { type: "extents" } };
      const r = viewRect(this.fitView(frame));
      return { ...base, area: { type: "window", min: [r.minX, r.minY], max: [r.maxX, r.maxY] } };
    }
    // The window sets pixel size; coverage is independent of the LOD resolution clamp.
    const px = targetPixelSize(
      this.view.scale,
      this.dpr,
      this.fitRectangle(),
      typeof this.options.lod === "object" ? this.options.lod : undefined,
    );
    const hw = (w * px) / 2;
    const hh = (h * px) / 2;
    return {
      ...base,
      ...(this.options.viewCulling !== false &&
      this.base?.key === this.contentKey() &&
      px < this.base.pixelSize
        ? { cull: expandView(viewRect(this.view)) }
        : {}),
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
      if (
        docGen === this.docGen &&
        layout === this.layoutName &&
        key === this.contentKey() &&
        !this.disposed
      ) {
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
    if (res.covered) {
      if (!this.current?.covered) this.renderer.preserveBase();
    } else {
      this.renderer.clearBase();
    }
    if (res.merged) this.renderer.setMergedDisplayList(res.merged);
    else this.renderer.setDisplayList(list);
    this.renderer.setCoverage(res.covered);
    this.applyClearColor();
    // clipped bounds: viewport content outside its viewport does not count (fit, LOD clamp)
    const bounds = res.covered ? this.base?.bounds : res.bounds;
    this.hoverQuery.cancel();
    this.clickRevision++;
    this.geometryCache.clear();
    this.current = {
      key,
      pixelSize: list.pixelSize,
      bounds,
      generation: res.generation,
      clips: list.clips,
      covered: res.covered,
    };
    if (!res.covered) this.base = this.current;
    if (fit) {
      this.fitPending = false;
      const r = this.fitRectangle();
      this.view = this.constrain(this.fitView(r ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }));
      this.fitted = true;
      this.emit("view", { ...this.view });
    } else if (this.view && this.limits) {
      // the extents may have changed (first list after a kept view, layer toggles)
      const v = this.constrain(this.view);
      if (v !== this.view) {
        this.view = v;
        this.emit("view", { ...v });
      }
    }
    // re-highlight on the new list (entity indexes change)
    this.highlight(this.selectGroup, this.selected, this.colors.select, 1);
    this.highlight(this.hoverGroup, this.hoverShown(), this.colors.hover, 0.85);
    this.renderNow();
    const upload = performance.now() - t0;
    this.lastRender = {
      ...res.stats,
      entities: list.entities.length,
      pixelSize: list.pixelSize,
      unsupported: res.unsupported,
      warnings: res.warnings,
      ms: {
        frontend: res.ms.frontend,
        pick: res.ms.pick,
        merge: res.ms.merge,
        transfer: Math.max(0, roundTrip - res.ms.frontend - res.ms.pick - res.ms.merge),
        upload,
        total: roundTrip + upload,
      },
    };
    this.renderWarnings = res.warnings;
    this.emit("render", this.lastRender);
    this.emitWarnings();
  }

  private emitWarnings(): void {
    const all = this.warnings;
    const key = JSON.stringify(all);
    if (key === this.warningsKey) return;
    this.warningsKey = key;
    this.emit("warnings", all);
  }

  /** The sheet (or stored paper-space extents) of a paper layout; undefined for model space. */
  private layoutFrame(): Rect | undefined {
    const l = this.layoutInfo();
    return l && !l.isModel ? (l.paper ?? l.extents) : undefined;
  }

  private fitRectangle(): Rect | undefined {
    return unionRect(this.layoutFrame(), this.current?.bounds);
  }

  // ---- drawing ------------------------------------------------------------------------------

  private applyClearColor(): void {
    const sheet = this.layoutInfo()?.paper !== undefined;
    if (sheet && this.colors.surround) {
      this.renderer.renderer.setClearColor(this.colors.surround, 1);
      return;
    }
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

  /** Every view change goes through here: limits, `fitted`, frame, `view` event, LOD. */
  private applyView(v: ViewState, fitted = false): void {
    if (!(v.scale > 0) || !Number.isFinite(v.scale) || !Number.isFinite(v.cx) || !Number.isFinite(v.cy))
      return;
    this.view = this.constrain(v);
    this.fitted = fitted;
    this.requestFrame();
    this.emit("view", { ...v });
    this.checkLod();
    this.updateMeasureOverlay();
  }

  private constrain(v: ViewState): ViewState {
    return constrainView(v, this.fitRectangle(), this.limits, this.fitMargin);
  }

  private limitZoom(factor: number): number {
    return this.view
      ? limitZoomFactor(this.view, factor, this.fitRectangle(), this.limits, this.fitMargin)
      : factor;
  }

  private get fitMargin(): number {
    return this.options.fitMargin ?? 0.04;
  }

  private fitView(r: Rect): ViewState {
    return fitRect(r, this.cssWidth(), this.cssHeight(), this.fitMargin);
  }

  private initialLayout(info: DocumentInfo): string {
    const want = this.options.initialLayout ?? "model";
    const model = info.layouts.find((l) => l.isModel)?.name ?? "Model";
    let name: string | undefined =
      want === "active" ? info.activeLayout : want === "model" ? model : undefined;
    if (typeof want === "function") name = want(info);
    else name ??= want;
    return info.layouts.find((l) => l.name.toUpperCase() === name?.toUpperCase())?.name ?? model;
  }

  private assignColors(c: ViewerColors): void {
    if (c.select !== undefined) this.colors.select = new THREE.Color(c.select);
    if (c.hover !== undefined) this.colors.hover = new THREE.Color(c.hover);
    if (c.measure !== undefined) this.colors.measure = new THREE.Color(c.measure);
    if (c.surround !== undefined) this.colors.surround = new THREE.Color(c.surround);
  }

  private applyInteraction(): void {
    const i = this.input;
    // "none" keeps the browser from scrolling the page on touch: only claim it to pan / zoom
    this.canvas.style.touchAction = i.pan || i.zoom ? "none" : "auto";
    if (i.keyboard) this.canvas.tabIndex = 0;
    else this.canvas.removeAttribute("tabindex");
    if (!i.hover) {
      this.hoverQuery.cancel();
      this.setHover(undefined);
    }
    this.updateCursor();
  }

  private updateCursor(): void {
    let cursor = "";
    if (this.tool === "measure") cursor = "crosshair";
    else if (this.hovered !== undefined && this.input.select) cursor = "pointer";
    this.canvas.style.cursor = cursor;
  }

  /** The hover highlight: not drawn over the selection. */
  private hoverShown(): string | undefined {
    return this.hovered === this.selected ? undefined : this.hovered;
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
      this.view = this.constrain(resize(this.view, w, h));
      if (this.autoFit === "always" && this.fitted) this.fit();
      else this.emit("view", { ...this.view });
      if (dprChanged) this.requestList();
    }
    this.renderNow();
  }

  // ---- highlight ----------------------------------------------------------------------------

  private clearHighlight(g: THREE.Group): void {
    this.highlightRevision.set(g, (this.highlightRevision.get(g) ?? 0) + 1);
    disposeChildren(g);
  }

  private interactionError(error: unknown): void {
    if (!this.disposed)
      this.emit("error", { error: error instanceof Error ? error : new Error(String(error)) });
  }

  private pruneGeometryCache(): void {
    for (const handle of this.geometryCache.keys())
      if (handle !== this.selected && handle !== this.hovered) this.geometryCache.delete(handle);
  }

  private entityGeometry(handle: string): Promise<EntityGeometry | undefined> {
    const cur = this.current;
    if (!cur) return Promise.resolve(undefined);
    let geometry = this.geometryCache.get(handle);
    if (!geometry) {
      geometry = this.backend.call({ type: "geometry", entity: handle, generation: cur.generation });
      if (handle === this.selected || handle === this.hovered) this.geometryCache.set(handle, geometry);
    }
    return geometry;
  }

  private highlight(g: THREE.Group, handle: string | undefined, color: THREE.Color, opacity: number): void {
    this.clearHighlight(g);
    const cur = this.current;
    if (!handle || !cur) return;
    const revision = this.highlightRevision.get(g);
    void this.entityGeometry(handle)
      .then((geometry) => {
        if (!geometry || this.disposed || this.current !== cur || revision !== this.highlightRevision.get(g))
          return;
        this.drawHighlight(g, geometry, cur, color, opacity);
        this.requestFrame();
      })
      .catch((error: unknown) => this.interactionError(error));
  }

  private drawHighlight(
    g: THREE.Group,
    geometry: EntityGeometry,
    cur: CurrentList,
    color: THREE.Color,
    opacity: number,
  ): void {
    let order = 0;
    let activeClip = -1;
    for (const b of geometry.parts) {
      // viewport content: clipped by the stencil like the drawing (clip masks before the ranges)
      const clip = b.clip ?? -1;
      const region = clip >= 0 ? cur.clips[clip] : undefined;
      if (clip !== activeClip && region) {
        for (const m of this.renderer.clipMaskObjects(region)) {
          m.renderOrder = order++;
          g.add(m);
        }
      }
      activeClip = region ? clip : -1;
      const geom = geometry2d(b.positions);
      const common = {
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        ...CLIPPED_STENCIL,
        stencilWrite: region !== undefined,
      };
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
      obj.renderOrder = order++;
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
    const g = geometry2d(new Float32Array(pts));
    const common = { color: this.colors.measure, transparent: true, depthTest: false, depthWrite: false };
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
        const z = this.input.zoom;
        // without zoom (or Ctrl in "ctrl" mode) the wheel scrolls the page
        if (!this.view || !z || (z === "ctrl" && !ev.ctrlKey && !ev.metaKey)) return;
        ev.preventDefault();
        const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
        const dy = Math.max(-400, Math.min(400, ev.deltaY * unit));
        const { x, y } = this.local(ev);
        this.applyView(zoomAt(this.view, x, y, this.limitZoom(Math.exp(-dy * 0.0015))));
      },
      { passive: false },
    );
    // right-drag pans: keep the browser menu only when it would not
    c.addEventListener("contextmenu", (ev) => {
      if (this.input.pan) ev.preventDefault();
    });
    c.addEventListener("pointerdown", (ev) => {
      if (this.input.keyboard) c.focus({ preventScroll: true });
      const p = this.local(ev);
      this.pointers.set(ev.pointerId, { ...p, button: ev.button });
      c.setPointerCapture(ev.pointerId);
      // middle button: no autoscroll while panning
      if (ev.button === 1 && this.input.pan) ev.preventDefault();
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
          let v = this.view;
          if (this.input.pan) v = panBy(v, now.cx - this.pinch.cx, now.cy - this.pinch.cy);
          if (this.input.zoom && this.pinch.dist > 0 && now.dist > 0)
            v = zoomAt(v, now.cx, now.cy, this.limitZoom(now.dist / this.pinch.dist));
          if (v !== this.view) this.applyView(v);
        }
        this.pinch = now;
        this.dragMoved += 10;
        return;
      }
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      // left drag pans only after a small threshold, so clicks stay clicks
      if (this.input.pan && (prev.button === 1 || prev.button === 2 || this.dragMoved > 3))
        this.applyView(panBy(this.view, dx, dy));
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
        } else if (this.input.select) void this.clickAt(p.x, p.y);
      }
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("pointerleave", () => {
      this.lastPointer = undefined;
      this.hoverQuery.cancel();
      this.cursorWorld = undefined;
      this.emit("cursor", undefined);
      if (this.hovered !== undefined && this.pointers.size === 0) this.setHover(undefined);
    });
    c.addEventListener("dblclick", (ev) => {
      if (!this.input.dblclickFit || this.tool !== "select") return;
      const p = this.local(ev);
      if (!this.input.select) this.fit();
      else {
        const cur = this.current;
        void this.pickAt(p.x, p.y)
          .then((handle) => {
            if (this.current === cur && !this.disposed && handle === undefined) this.fit();
          })
          .catch((error: unknown) => this.interactionError(error));
      }
    });
    c.addEventListener("keydown", (ev) => {
      if (this.input.keyboard && ev.key === "Escape") {
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
    if (!this.input.hover || this.hoverScheduled) return;
    this.hoverScheduled = true;
    requestAnimationFrame(() => {
      this.hoverScheduled = false;
      const p = this.lastPointer;
      if (!p || this.pointers.size > 0 || !this.input.hover || !this.current) return;
      this.hoverQuery.push({ ...p, current: this.current });
    });
  }

  private setHover(handle: string | undefined): void {
    if (handle === this.hovered) return;
    this.hovered = handle;
    this.pruneGeometryCache();
    this.highlight(this.hoverGroup, this.hoverShown(), this.colors.hover, 0.85);
    this.updateCursor();
    this.emit("hover", { handle });
    this.requestFrame();
  }

  private async clickAt(x: number, y: number): Promise<void> {
    const revision = ++this.clickRevision;
    const cur = this.current;
    try {
      const handle = await this.pickAt(x, y);
      if (revision === this.clickRevision && this.current === cur && !this.disposed) this.select(handle);
    } catch (error) {
      this.interactionError(error);
    }
  }
}

async function tryLoad(load: AssetLoader, name: string): Promise<Uint8Array | undefined> {
  try {
    return await load(name);
  } catch {
    return undefined;
  }
}

function absoluteUrl(url: string): string | undefined {
  try {
    return new URL(url, typeof location !== "undefined" ? location.href : undefined).href;
  } catch {
    return undefined;
  }
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
  const g = geometry2d(new Float32Array([0, 0, w, 0, w, h, 0, 0, w, h, 0, h]));
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

/**
 * Geometry from x, y pairs. three.js computes bounding spheres for sorting transparent objects;
 * with 2-component positions that gives NaN (and console errors), so a fixed sphere is set
 * (overlays are at z = 0 and never frustum-culled).
 */
function geometry2d(xy: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(xy, 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);
  return g;
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
