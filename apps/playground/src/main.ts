/**
 * truedxf playground: open a DXF (button, drag and drop, or `?file=<url>`) together with its
 * fonts, shape files and images (several files or a folder), browse layouts and layers, pick
 * entities and inspect their raw DXF tags, measure distances.
 */
import {
  type DocumentInfo,
  DxfViewer,
  type EntityInfo,
  type FileInput,
  type RenderStats,
  type ViewerFile,
  type ViewerWarning,
  ViewerWarningCode,
} from "@truedxf/viewer";
import {
  API,
  type CorpusRow,
  corpusBrowser,
  type FixtureCase,
  fixtureBrowser,
  samplesStatus,
} from "./browse.ts";
import { ComparePanel } from "./compare.ts";
import { h, ICONS, icon, mount } from "./dom.ts";
import { droppedFiles, FilesPanel, inputFiles, isDrawing, pickDrawing } from "./files.ts";
import { fmtBytes, fmtCoord, fmtMs, fmtNum } from "./format.ts";

const app = document.getElementById("app")!;

// ---- layout skeleton ---------------------------------------------------------------------------

// no `accept` filter: a drawing is opened together with its fonts, shape files and images
const fileInput = h("input", { type: "file", multiple: true, hidden: true });
const folderInput = h("input", { type: "file", multiple: true, webkitdirectory: true, hidden: true });
const addInput = h("input", { type: "file", multiple: true, hidden: true });
const fileName = h("span", { class: "filename" }, "No file");
const btnSelect = toolButton(ICONS.select, "Select (click an entity)", true);
const btnMeasure = toolButton(ICONS.measure, "Measure distance (two clicks)", false);
const btnFit = h(
  "button",
  { class: "btn icon", title: "Fit to extents (double-click empty space)" },
  icon(ICONS.fit),
);
const btnTheme = h("button", { class: "btn icon", title: "Dark / light background" }, icon(ICONS.sun));
const btnLw = h(
  "button",
  { class: "btn icon", title: "Show lineweights", "aria-pressed": "true" },
  icon(ICONS.weight),
);
const modeTabs = h("div", { class: "seg", id: "modes" });

const topbar = h(
  "header",
  { class: "topbar" },
  h(
    "div",
    { class: "brand" },
    h("span", {
      class: "brand-mark",
      html: '<svg width="14" height="14" viewBox="0 0 32 32"><path d="M6 25 L16 7 L26 25 Z" fill="none" stroke="white" stroke-width="3.5" stroke-linejoin="round"/></svg>',
    }),
    "truedxf",
  ),
  modeTabs,
  fileName,
  h("div", { class: "spacer" }),
  h("div", { class: "seg" }, btnSelect, btnMeasure),
  btnFit,
  btnLw,
  btnTheme,
  h(
    "button",
    {
      class: "btn icon",
      onclick: () => folderInput.click(),
      title: "Open a folder (a drawing with its fonts and images)",
    },
    icon(ICONS.folder),
  ),
  h(
    "button",
    {
      class: "btn primary",
      onclick: () => fileInput.click(),
      title: "Open a DXF file — select its fonts, shape files and images with it",
    },
    icon(ICONS.open),
    "Open",
  ),
  fileInput,
  folderInput,
  addInput,
);

const layoutList = h("div", { class: "list" });
const layerList = h("div", { class: "list" });
const layerSearch = h("input", { class: "search", type: "search", placeholder: "Filter layers…" });
const layerCount = h("span", { class: "count" });
const viewerSections = [
  h("div", { class: "section" }, h("div", { class: "section-head" }, "Layouts"), layoutList),
  h(
    "div",
    { class: "section grow" },
    h(
      "div",
      { class: "section-head" },
      "Layers ",
      layerCount,
      h("span", { class: "spacer" }),
      h("button", { class: "link", onclick: () => setAllLayers(true) }, "All on"),
      h("button", { class: "link", onclick: () => setAllLayers(false) }, "All off"),
    ),
    layerSearch,
    layerList,
  ),
];
const leftPanel = h("aside", { class: "sidebar left" }, ...viewerSections);

const viewerHost = h("div", { class: "viewer" });
const emptyState = h(
  "div",
  { class: "empty" },
  h(
    "div",
    { class: "empty-card" },
    h("div", { class: "empty-icon" }, icon(ICONS.file)),
    h("h2", {}, "Open a DXF drawing"),
    h(
      "p",
      {},
      "Drop a .dxf file — together with its fonts, shape files and images, or their whole folder — " +
        "anywhere, or choose them. Everything runs locally in your browser.",
    ),
    h(
      "div",
      { class: "empty-actions" },
      h(
        "button",
        { class: "btn primary", onclick: () => fileInput.click() },
        icon(ICONS.open),
        "Choose files",
      ),
      h("button", { class: "btn", onclick: () => folderInput.click() }, icon(ICONS.folder), "Open folder"),
    ),
  ),
);
const busy = h("div", { class: "busy" }, h("span", { class: "spinner" }), h("span", {}, "Loading"));
const toast = h("div", { class: "toast" });
const measureChip = h("div", { class: "measure-chip" });
const layoutNotice = h("div", { class: "layout-notice" });
const compare = new ComparePanel();
compare.root.style.display = "none";
const stage = h(
  "section",
  { class: "stage" },
  viewerHost,
  emptyState,
  h("div", { class: "drop" }, "Drop to open"),
  busy,
  measureChip,
  layoutNotice,
  compare.root,
  toast,
);

const inspector = h("div", { class: "section grow" });
let filesPanel: FilesPanel;
const diagnostics = h("div", { class: "list", style: "padding: 0 0 10px" });
const rightPanel = h(
  "aside",
  { class: "sidebar right" },
  inspector,
  h("div", { class: "files-slot" }),
  h(
    "div",
    { class: "section", style: "max-height: 40%" },
    h("div", { class: "section-head" }, "Diagnostics"),
    diagnostics,
  ),
);

const status = {
  file: h("span"),
  entities: h("span"),
  timing: h("span"),
  gpu: h("span"),
  backend: h("span"),
  cursor: h("span", { class: "cursor" }),
};
const statusbar = h("footer", { class: "statusbar" }, ...Object.values(status));
const main = h("main", { class: "main" }, leftPanel, stage, rightPanel);
mount(app, topbar, main, statusbar);

// ---- viewer ------------------------------------------------------------------------------------

/** Where IMAGEDEF paths of the current file resolve (fixtures / corpus files via the samples API). */
let imageBase: ((path: string) => string) | undefined;
/** `?fallbackFont=a.shx,b.ttf`: fonts for text whose font is missing (default: the viewer's). */
const fallbackFont = new URLSearchParams(location.search).get("fallbackFont")?.split(",").filter(Boolean);
const viewer = new DxfViewer(viewerHost, {
  background: "dark",
  fontBaseUrl: "fonts/",
  ...(fallbackFont?.length ? { fallbackFont } : {}),
  loadImage: async (path) => {
    if (!imageBase) return undefined;
    const r = await fetch(imageBase(path));
    return r.status === 200 ? new Uint8Array(await r.arrayBuffer()) : undefined;
  },
});
(window as unknown as { viewer: DxfViewer }).viewer = viewer;
filesPanel = new FilesPanel(viewer, {
  addFiles: () => addInput.click(),
  openDrawing: (f) => void openStored(f),
});
rightPanel.querySelector(".files-slot")!.replaceWith(filesPanel.root);
let info: DocumentInfo | undefined;
let lastRender: RenderStats | undefined;
let loadStart = 0;
let firstFrame: number | undefined;

/** First-frame metrics per opened file (read by the perf script and the smoke test). */
export interface LoadMetrics {
  name: string;
  bytes: number;
  entities: number;
  parse: number;
  frontend: number;
  upload: number;
  firstFrame: number;
  batches: number;
  vertices: number;
  backend: string;
}
const metrics: LoadMetrics[] = [];
(window as unknown as { truedxf: { viewer: DxfViewer; metrics: LoadMetrics[] } }).truedxf = {
  viewer,
  metrics,
};

viewer.on("load", (d) => {
  info = d;
  emptyState.style.display = "none";
  fileName.textContent = d.name;
  document.title = `${d.name} — truedxf`;
  status.file.innerHTML = "";
  status.file.append(h("b", {}, d.name), ` · ${d.acadver} · ${d.format} · ${fmtBytes(d.byteLength)}`);
  status.entities.textContent = `${fmtNum(d.entityCount)} entities`;
  renderLayouts();
  renderLayers();
  renderDiagnostics();
  showInspector(undefined);
});
viewer.on("layout", () => renderLayouts());
viewer.on("warnings", () => {
  renderLayoutNotice();
  renderDiagnostics();
  filesPanel.render();
});
viewer.on("files", () => filesPanel.render());
viewer.on("render", (r) => {
  lastRender = r;
  if (firstFrame === undefined && loadStart) {
    firstFrame = performance.now() - loadStart;
    metrics.push({
      name: info?.name ?? "",
      bytes: info?.byteLength ?? 0,
      entities: info?.entityCount ?? 0,
      parse: info?.ms.parse ?? 0,
      frontend: r.ms.frontend,
      upload: r.ms.upload,
      firstFrame,
      batches: r.batches,
      vertices: r.vertices,
      backend: viewer.backendKind,
    });
  }
  const parse = info?.ms.parse ?? 0;
  status.timing.textContent =
    `parse ${fmtMs(parse)} · render ${fmtMs(r.ms.frontend)} · upload ${fmtMs(r.ms.upload)}` +
    (firstFrame !== undefined ? ` · first frame ${fmtMs(firstFrame)}` : "");
  status.gpu.textContent = `${fmtNum(r.batches)} batches · ${fmtNum(r.vertices)} vertices`;
  status.backend.textContent = viewer.backendKind === "worker" ? "worker" : "main thread";
  renderDiagnostics();
});
viewer.on("busy", ({ busy: on, what }) => {
  busy.classList.toggle("on", on);
  (busy.lastChild as HTMLElement).textContent = what || "Working";
});
viewer.on("error", ({ error }) => {
  console.error(error);
  showError(error.message);
});
viewer.on("cursor", (c) => {
  status.cursor.textContent = c ? `${fmtCoord(c.x)}, ${fmtCoord(c.y)}` : "";
});
viewer.on("select", ({ handle }) => void showInspector(handle));
viewer.on("measure", (m) => {
  measureChip.classList.toggle("on", !!m);
  if (!m) return;
  mount(
    measureChip,
    h("div", {}, `distance ${fmtCoord(m.distance)}`),
    h("div", {}, `Δx ${fmtCoord(m.dx)}  Δy ${fmtCoord(m.dy)}`),
    h("div", {}, `angle ${m.angle.toFixed(3)}°`),
  );
});

/** Common state for opening a drawing (local files have no URL: `src` undefined). */
function beginOpen(src: string | undefined, images?: (path: string) => string): void {
  imageBase = images;
  syncUrl(src);
  if (src === undefined || !src.startsWith(API)) {
    compare.root.style.display = "none";
  }
  loadStart = performance.now();
  firstFrame = undefined;
  hideError();
}

export async function openSource(
  src: File | string,
  name?: string,
  images?: (path: string) => string,
): Promise<void> {
  beginOpen(typeof src === "string" ? src : undefined, images);
  filesPanel.current =
    typeof src === "string" ? undefined : viewer.files.find((f) => f.name === src.name)?.path;
  try {
    await viewer.load(src, name);
  } catch {
    // reported through the error event
  }
}

/**
 * Opens local files (file dialog, folder, drop): the drawing among them with the others as its
 * resources; a choice when there are several drawings; without a drawing, the files are added
 * to the open one.
 */
async function openLocal(files: FileInput[]): Promise<void> {
  if (files.length === 0) return;
  const drawings = files.filter((f) => isDrawing(f.name));
  if (drawings.length === 0) {
    viewer.addFiles(files);
    if (!info) showError("No .dxf drawing among the files — they were added for the next drawing.");
    return;
  }
  if (drawings.length === 1) {
    beginOpen(undefined);
    filesPanel.current = undefined;
    try {
      const r = await viewer.openFiles(files);
      filesPanel.current = r.opened?.path;
      filesPanel.render();
    } catch {
      // reported through the error event
    }
    return;
  }
  const { drawings: added } = await viewer.openFiles(files, { drawing: false });
  const chosen = await pickDrawing(stage, added);
  if (chosen) await openStored(chosen);
}

/** Opens a drawing that is among the viewer's files. */
async function openStored(f: ViewerFile): Promise<void> {
  beginOpen(undefined);
  filesPanel.current = f.path;
  filesPanel.render();
  try {
    await viewer.openDrawing(f.path);
  } catch {
    // reported through the error event
  }
}

/**
 * Keeps `?file=` in sync with the open drawing so links and reloads reopen it. Local files have
 * no URL the page could reload, so opening one removes a stale `?file=`.
 */
function syncUrl(src: string | undefined): void {
  const url = new URL(location.href);
  const current = url.searchParams.get("file");
  if (typeof src === "string") {
    if (current === src) return;
    url.searchParams.set("file", src);
    history.pushState({ file: src }, "", url);
  } else {
    if (current === null) return;
    url.searchParams.delete("file");
    history.pushState({}, "", url);
  }
}

window.addEventListener("popstate", () => {
  const file = new URLSearchParams(location.search).get("file");
  if (file) void openSource(file);
});

// ---- toolbar -----------------------------------------------------------------------------------

function toolButton(svg: string, title: string, pressed: boolean): HTMLButtonElement {
  return h("button", { class: "btn icon", title, "aria-pressed": String(pressed) }, icon(svg));
}

for (const input of [fileInput, folderInput]) {
  input.addEventListener("change", () => {
    const files = inputFiles(input);
    input.value = "";
    void openLocal(files);
  });
}
addInput.addEventListener("change", () => {
  const files = inputFiles(addInput);
  addInput.value = "";
  viewer.addFiles(files);
});
btnFit.addEventListener("click", () => viewer.fit());
btnSelect.addEventListener("click", () => setTool("select"));
btnMeasure.addEventListener("click", () => setTool("measure"));
btnTheme.addEventListener("click", () => {
  const dark = !viewer.isDark;
  viewer.setBackground(dark ? "dark" : "light");
  applyTheme(dark);
});
btnLw.addEventListener("click", () => {
  const on = btnLw.getAttribute("aria-pressed") !== "true";
  btnLw.setAttribute("aria-pressed", String(on));
  viewer.setLineweights(on);
});

function setTool(t: "select" | "measure"): void {
  viewer.setTool(t);
  btnSelect.setAttribute("aria-pressed", String(t === "select"));
  btnMeasure.setAttribute("aria-pressed", String(t === "measure"));
  if (t === "select") measureChip.classList.remove("on");
}

function applyTheme(dark: boolean): void {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  mount(btnTheme, icon(dark ? ICONS.sun : ICONS.moon));
  try {
    localStorage.setItem("truedxf.theme", dark ? "dark" : "light");
  } catch {
    // storage unavailable
  }
}

{
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("truedxf.theme");
  } catch {
    // storage unavailable
  }
  if (saved === "light") {
    viewer.setBackground("light");
    applyTheme(false);
  } else applyTheme(true);
}

window.addEventListener("keydown", (ev) => {
  if (ev.target instanceof HTMLInputElement) return;
  if (ev.key === "f" || ev.key === "F") viewer.fit();
  else if (ev.key === "m" || ev.key === "M") setTool(viewer.currentTool === "measure" ? "select" : "measure");
  else if (ev.key === "o" && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    fileInput.click();
  }
});

// ---- drag and drop -----------------------------------------------------------------------------

let dragDepth = 0;
window.addEventListener("dragenter", (ev) => {
  if (!ev.dataTransfer?.types.includes("Files")) return;
  ev.preventDefault();
  dragDepth++;
  stage.classList.add("dragging");
});
window.addEventListener("dragover", (ev) => ev.preventDefault());
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) stage.classList.remove("dragging");
});
window.addEventListener("drop", (ev) => {
  ev.preventDefault();
  dragDepth = 0;
  stage.classList.remove("dragging");
  if (!ev.dataTransfer) return;
  // read the items now: they are only accessible during the event
  void droppedFiles(ev.dataTransfer).then(openLocal, (e) => showError(String(e)));
});

// ---- panels ------------------------------------------------------------------------------------

function renderLayouts(): void {
  mount(
    layoutList,
    viewer.layouts.map((l) =>
      h(
        "div",
        {
          class: `item${l.name === viewer.layout ? " active" : ""}`,
          onclick: () => void viewer.setLayout(l.name),
          title: l.isModel ? "Model space" : `Paper-space layout ${l.name}`,
        },
        icon(l.isModel ? ICONS.model : ICONS.layout),
        h("span", { class: "name" }, l.name),
        h("span", { class: "meta" }, l.empty ? "empty" : ""),
      ),
    ),
  );
  renderLayoutNotice();
}

/** Viewer warnings that explain an empty (or blank-looking) stage, with their notice title. */
const EMPTY_TITLES: Record<string, string> = {
  [ViewerWarningCode.LayoutEmpty]: "Nothing in this layout",
  [ViewerWarningCode.LayersHidden]: "All layers with content are hidden",
  [ViewerWarningCode.LayersNoPlot]: "Nothing plots",
  [ViewerWarningCode.NothingVisible]: "Nothing visible",
  [ViewerWarningCode.ContentInvisible]: "Drawn in the background colour",
};

/**
 * Stage notice for an empty view: a never-initialized layout (LayoutInfo.empty), or the viewer
 * warning that explains why nothing shows (hidden layers, empty layout, …).
 */
function renderLayoutNotice(): void {
  const l = viewer.layouts.find((x) => x.name === viewer.layout);
  if (l?.empty) {
    layoutNotice.classList.add("on");
    mount(
      layoutNotice,
      h("b", {}, `Layout "${l.name}" is empty`),
      h(
        "p",
        {},
        "It was never opened in AutoCAD, so the file stores no viewport or page setup for it. " +
          "AutoCAD creates a default viewport the first time the tab is activated.",
      ),
    );
    return;
  }
  const w = viewer.warnings.find((x) => x.layout === viewer.layout && EMPTY_TITLES[x.code]);
  layoutNotice.classList.toggle("on", w !== undefined);
  if (!w) return;
  const actions: HTMLElement[] = [];
  if (w.code === ViewerWarningCode.LayersHidden)
    actions.push(h("button", { class: "btn", onclick: () => setAllLayers(true) }, "Show all layers"));
  else if (w.code === ViewerWarningCode.LayoutEmpty)
    for (const name of (w.items ?? []).slice(0, 3))
      actions.push(h("button", { class: "btn", onclick: () => void viewer.setLayout(name) }, `Open ${name}`));
  else if (w.code === ViewerWarningCode.ContentInvisible)
    actions.push(
      h(
        "button",
        { class: "btn", onclick: () => btnTheme.click() },
        viewer.isDark ? "Light background" : "Dark background",
      ),
    );
  mount(
    layoutNotice,
    h("b", {}, EMPTY_TITLES[w.code]),
    h("p", {}, w.message),
    actions.length ? h("div", { class: "notice-actions" }, actions) : null,
  );
}

function hex(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

function renderLayers(): void {
  const q = layerSearch.value.trim().toLowerCase();
  const layers = viewer.layers.filter((l) => !q || l.name.toLowerCase().includes(q));
  layerCount.textContent = String(viewer.layers.length);
  mount(
    layerList,
    layers.map((l) => {
      const on = viewer.isLayerVisible(l.name);
      const flags = [l.off ? "off" : "", l.frozen ? "frozen" : "", l.plot ? "" : "no-plot"].filter(Boolean);
      const toggle = (ev: Event) => {
        ev.stopPropagation();
        if ((ev as MouseEvent).altKey) {
          viewer.setLayersVisible(
            viewer.layers.map((x) => x.name),
            false,
          );
          viewer.setLayerVisible(l.name, true);
        } else viewer.setLayerVisible(l.name, !on);
        renderLayers();
      };
      const box = h("input", {
        type: "checkbox",
        class: "layer-check",
        "aria-label": `Show layer ${l.name}`,
      });
      box.checked = on;
      box.addEventListener("click", toggle);
      // ACI 7 and colours within 8 of white/black are drawn black or white depending on the
      // background (the viewer flips them for contrast): show them split
      const r = (l.rgb >> 16) & 255;
      const g = (l.rgb >> 8) & 255;
      const b = l.rgb & 255;
      const flips = (l.aci === 7 && l.rgb === 0xffffff) || Math.min(r, g, b) >= 247 || Math.max(r, g, b) <= 8;
      const swatch = flips
        ? "background:linear-gradient(135deg,#fff 50%,#000 50%)"
        : `background:${hex(l.rgb)}`;
      return h(
        "div",
        {
          class: `item${on ? "" : " off"}`,
          title: `${l.name}${flags.length ? ` (${flags.join(", ")} in file)` : ""} — click: toggle, Alt+click: isolate`,
          onclick: toggle,
        },
        box,
        h("span", {
          class: "swatch",
          style: swatch,
          title: l.aci > 0 && l.aci < 256 ? `ACI ${l.aci} (${hex(l.rgb)})` : hex(l.rgb),
        }),
        h("span", { class: "name" }, l.name),
        h("span", { class: "meta" }, l.entities ? fmtNum(l.entities) : ""),
      );
    }),
  );
}
layerSearch.addEventListener("input", renderLayers);

function setAllLayers(on: boolean): void {
  viewer.setLayersVisible(
    viewer.layers.map((l) => l.name),
    on,
  );
  renderLayers();
}

function warningRow(w: ViewerWarning): HTMLElement {
  return h(
    "div",
    { class: `diag-row ${w.severity}`, title: `${w.code}${w.items ? `: ${w.items.join(", ")}` : ""}` },
    h("span", { class: "n" }, w.severity === "warning" ? "!" : "i"),
    h("span", { class: "t" }, w.message),
  );
}

function renderDiagnostics(): void {
  const rows: HTMLElement[] = [];
  const warnings = viewer.warnings;
  if (warnings.length) {
    rows.push(h("div", { class: "diag-sub" }, "Viewer warnings"));
    for (const w of warnings) rows.push(warningRow(w));
  }
  const un = Object.entries(lastRender?.unsupported ?? {}).sort((a, b) => b[1] - a[1]);
  const model = Object.entries(info?.diagnostics ?? {}).sort((a, b) => b[1] - a[1]);
  rows.push(
    h("div", { class: "diag-sub" }, `Renderer: ${un.length ? "not rendered" : "everything rendered"}`),
  );
  for (const [k, n] of un)
    rows.push(h("div", { class: "diag-row" }, h("span", { class: "n" }, n), h("span", { class: "t" }, k)));
  rows.push(h("div", { class: "diag-sub" }, `Model: ${model.length ? "diagnostics" : "no diagnostics"}`));
  for (const [k, n] of model)
    rows.push(h("div", { class: "diag-row" }, h("span", { class: "n" }, n), h("span", { class: "t" }, k)));
  if (info) {
    const types = Object.entries(info.entityTypes).sort((a, b) => b[1] - a[1]);
    rows.push(h("div", { class: "diag-sub" }, "Entity types (model + paper space)"));
    for (const [k, n] of types)
      rows.push(
        h(
          "div",
          { class: "diag-row" },
          h("span", { class: "n", style: "color:var(--muted)" }, n),
          h("span", { class: "t" }, k),
        ),
      );
  }
  mount(diagnostics, rows);
}

let inspectSeq = 0;
async function showInspector(handle: string | undefined): Promise<void> {
  const seq = ++inspectSeq;
  const head = h("div", { class: "section-head" }, "Inspector");
  if (!handle) {
    mount(
      inspector,
      head,
      h("div", { class: "hint" }, info ? "Click an entity to inspect it." : "Open a drawing to start."),
    );
    return;
  }
  // the worker may still be busy (e.g. a level-of-detail render): show that something happens
  mount(inspector, head, h("div", { class: "hint" }, `Loading ${handle}…`));
  let e: EntityInfo | undefined;
  try {
    e = await viewer.inspect(handle);
  } catch (err) {
    showError(String(err));
  }
  if (seq !== inspectSeq) return;
  if (!e) {
    mount(inspector, head, h("div", { class: "hint" }, `Entity ${handle} not found in the model.`));
    return;
  }
  const kv = (k: string, v: Node | string) => [h("span", { class: "k" }, k), h("span", { class: "v" }, v)];
  const lw = (n: number) =>
    n === -1 ? "ByLayer" : n === -2 ? "ByBlock" : n === -3 ? "Default" : `${(n / 100).toFixed(2)} mm`;
  const col = (c: number) => (c === 256 ? "ByLayer" : c === 0 ? "ByBlock" : `ACI ${c}`);
  const swatch = (rgb: string) => h("span", { class: "swatch", style: `background:${rgb}` });
  mount(
    inspector,
    head,
    h(
      "div",
      { class: "kv" },
      kv("Type", e.type === e.dxfType ? e.type : `${e.dxfType} (${e.type})`),
      kv("Handle", e.handle || `#${e.id}`),
      e.block ? kv("Block", e.block) : [],
      kv("Layer", e.raw.layer === e.resolved.layer ? e.raw.layer : `${e.raw.layer} → ${e.resolved.layer}`),
      kv(
        "Colour",
        h(
          "span",
          {},
          swatch(e.resolved.rgb),
          `${e.raw.trueColor ?? col(e.raw.color)}${e.raw.colorName ? ` "${e.raw.colorName}"` : ""} → ${e.resolved.trueColor ?? `ACI ${e.resolved.aci}`} ${e.resolved.rgb}`,
        ),
      ),
      kv("Linetype", `${e.raw.linetype} → ${e.resolved.linetype} ×${fmtCoord(e.resolved.linetypeScale)}`),
      kv("Lineweight", `${lw(e.raw.lineweight)} → ${lw(e.resolved.lineweight)}`),
      kv(
        "Transparency",
        `${e.raw.transparency ?? "ByLayer"} → ${Math.round((1 - e.resolved.alpha / 255) * 100)}%`,
      ),
      e.raw.invisible ? kv("Invisible", "yes (60)") : [],
      kv("Plots", e.resolved.plottable ? "yes" : "no"),
    ),
    h("div", { class: "section-head" }, "DXF tags ", h("span", { class: "count" }, String(e.tagCount))),
    h(
      "div",
      { class: "tags" },
      h(
        "table",
        {},
        e.tags.map((t) =>
          h(
            "tr",
            { class: t.code === 100 || t.code === 102 || t.code === 1001 ? "marker" : "" },
            h("td", { class: "code" }, t.code),
            h("td", {}, t.value),
          ),
        ),
      ),
      e.tags.length < e.tagCount ? h("div", { class: "hint" }, `… ${e.tagCount - e.tags.length} more`) : null,
    ),
  );
}

// ---- errors ------------------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showError(msg: string): void {
  toast.textContent = msg.split("\n")[0] ?? msg;
  toast.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideError, 8000);
}
function hideError(): void {
  toast.classList.remove("on");
}

// ---- modes: viewer / fixtures / corpus (dev server with local samples only) -------------------------

const basenameOf = (p: string) => p.replaceAll("\\", "/").split("/").pop() ?? p;

async function openFixture(c: FixtureCase): Promise<void> {
  const suite = c.id.split("/")[0]!;
  await openSource(
    `${API}file/${c.dxf}`,
    `${c.name}.dxf`,
    (p) => `${API}image/${suite}/${encodeURIComponent(p)}`,
  );
  if (!c.plot) {
    compare.root.style.display = "none";
    return;
  }
  compare.root.style.display = "";
  await compare.show(viewer, c.plot, c.ref ? `${API}file/${c.ref}` : undefined);
}

async function openCorpus(row: CorpusRow): Promise<void> {
  // corpus names contain '#', '%', spaces…: encode each path segment
  const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  const dir = `external/${row.path.split("/").slice(0, -1).join("/")}`;
  await openSource(
    `${API}file/external/${enc(row.path)}`,
    basenameOf(row.path),
    (p) => `${API}near-image?${new URLSearchParams({ dir, path: p })}`,
  );
}

async function initModes(): Promise<void> {
  const st = await samplesStatus();
  if (!st.available) return;
  let fixtures: HTMLElement | undefined;
  let corpus: HTMLElement | undefined;
  const tabs = {
    viewer: h("button", { class: "btn" }, "Viewer"),
    fixtures: h("button", { class: "btn", title: "Generated fixtures vs AutoCAD references" }, "Fixtures"),
    corpus: h(
      "button",
      { class: "btn", title: `${fmtNum(st.corpus)} DXF files in samples/external` },
      "Corpus",
    ),
  };
  const set = (m: keyof typeof tabs) => {
    for (const [k, b] of Object.entries(tabs)) b.setAttribute("aria-pressed", String(k === m));
    if (m === "viewer") mount(leftPanel, ...viewerSections);
    else if (m === "fixtures")
      mount(leftPanel, (fixtures ??= fixtureBrowser(st, (c) => void openFixture(c))));
    else mount(leftPanel, (corpus ??= corpusBrowser((r) => void openCorpus(r))));
    if (m !== "fixtures") compare.root.style.display = "none";
    try {
      localStorage.setItem("truedxf.mode", m);
    } catch {
      // storage unavailable
    }
  };
  tabs.viewer.addEventListener("click", () => set("viewer"));
  tabs.fixtures.addEventListener("click", () => set("fixtures"));
  tabs.corpus.addEventListener("click", () => set("corpus"));
  mount(modeTabs, tabs.viewer, tabs.fixtures, tabs.corpus);
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("truedxf.mode");
  } catch {
    // storage unavailable
  }
  // a ?file= link opens in the viewer; otherwise restore the last mode
  const fromUrl = new URLSearchParams(location.search).has("file");
  set(!fromUrl && (saved === "fixtures" || saved === "corpus") ? saved : "viewer");
}

// ---- start -------------------------------------------------------------------------------------

renderLayouts();
renderDiagnostics();
void showInspector(undefined);
const initial = new URLSearchParams(location.search).get("file");
if (initial) void openSource(initial);
void initModes();

export { viewer };
