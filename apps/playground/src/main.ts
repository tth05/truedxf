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
  NotDxfError,
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
import { openDialog } from "./dialog.ts";
import { h, ICONS, icon, mount } from "./dom.ts";
import { canCopyImage, copyPng, printView, savePng } from "./export.ts";
import { droppedFiles, FilesPanel, inputFiles, isDrawing, isDwg, pickDrawing } from "./files.ts";
import { FontFolder, fontLoader } from "./fonts.ts";
import { fmtBytes, fmtCoord, fmtMs, fmtNum } from "./format.ts";
import { dropdown, type MenuItem } from "./menu.ts";
import { droppedSource, openedAgo, type RecentEntry, RecentFiles, type RecentSource } from "./recent.ts";
import { resizableSections, resizableSidebars } from "./resize.ts";
import { SearchBox } from "./search.ts";
import { watchUpdates } from "./update.ts";

const app = document.getElementById("app")!;

// ---- layout skeleton ---------------------------------------------------------------------------

// no `accept` filter: a drawing is opened together with its fonts, shape files and images;
// files without a drawing are added to the open one
const fileInput = h("input", { type: "file", multiple: true, hidden: true });
const folderInput = h("input", { type: "file", multiple: true, webkitdirectory: true, hidden: true });
const fileName = h("span", { class: "filename" }, "No file");
const btnSelect = toolButton(ICONS.select, "Select (click an entity)", true);
const btnMeasure = toolButton(ICONS.measure, "Measure distance (two clicks)", false);
const btnTheme = h("button", { class: "btn icon", title: "Dark / light background" }, icon(ICONS.sun));
const btnLw = h(
  "button",
  { class: "btn icon", title: "Show lineweights", "aria-pressed": "true" },
  icon(ICONS.weight),
);
const modeTabs = h("div", { class: "seg", id: "modes" });
/** Replaced by the search box once the viewer exists. */
const searchSlot = h("div", { class: "search-box" });
/** Zoom factor of the + / − buttons and keys. */
const ZOOM_STEP = 1.5;
/** The image printed by "Print view" (shown only in print, style.css). */
const printHost = h("div", { id: "print" });
document.body.append(printHost);
const exportUi = exportButton();

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
  searchSlot,
  h("div", { class: "seg" }, btnSelect, btnMeasure),
  h("div", { class: "seg" }, btnLw, btnTheme),
  exportUi.root,
  h(
    "button",
    { class: "btn icon keys-help", title: "Keyboard shortcuts (?)", onclick: () => showShortcuts() },
    icon(ICONS.keyboard),
  ),
  openButton(),
  fileInput,
  folderInput,
);

/**
 * The single Open entry point: a file dialog for a drawing together with its fonts, shape files
 * and images (or just more files for the open drawing), and a menu entry for a whole folder (a
 * browser dialog picks either files or a folder, not both).
 */
function openButton(): HTMLElement {
  const root = h(
    "div",
    { class: "split" },
    h(
      "button",
      {
        class: "btn primary",
        onclick: () => chooseFiles(),
        title: "Open a DXF with its fonts, shape files and images, or add files to the open drawing (Ctrl+O)",
      },
      icon(ICONS.open),
      h("span", { class: "label" }, "Open"),
    ),
  );
  const items = (): (MenuItem | "separator")[] => {
    const recentItems: MenuItem[] = recent.entries.slice(0, 5).map((e) => ({
      icon: e.folder ? ICONS.folder : ICONS.clock,
      label: e.name,
      title: `${e.path}, opened ${openedAgo(e.opened)}${e.folder ? " (with its folder)" : ""}`,
      run: () => void openRecent(e),
    }));
    return [
      { icon: ICONS.open, label: "Open files…", keys: "Ctrl+O", run: () => chooseFiles() },
      { icon: ICONS.folder, label: "Open folder…", run: () => chooseFolder() },
      {
        icon: ICONS.font,
        label: "Fonts folder…",
        title: "A folder with your SHX / TrueType fonts, e.g. a copy of AutoCAD's Fonts folder",
        run: () => void fontsFolder.choose(),
      },
      ...(recentItems.length ? (["separator", ...recentItems] as const) : []),
    ];
  };
  const menu = dropdown(
    root,
    items,
    "Select the .dxf together with its fonts, shape files and images. Files without a .dxf are added to the open drawing. " +
      "Your fonts folder is used for every drawing.",
  );
  root.insertBefore(
    h(
      "button",
      {
        class: "btn primary caret",
        title: "More ways to open",
        onclick: (ev: Event) => {
          ev.stopPropagation();
          menu.toggle();
        },
      },
      icon(ICONS.caret),
    ),
    root.querySelector(".menu"),
  );
  return root;
}

/** Export menu: the current view as PNG (download or clipboard) or printed. */
function exportButton(): { root: HTMLElement; button: HTMLButtonElement; print(): void } {
  const button = h(
    "button",
    { class: "btn icon", title: "Export the view (PNG, print)", disabled: true },
    icon(ICONS.download),
  );
  const root = h("div", { class: "split export" }, button);
  const run = (what: string, job: () => Promise<void>) =>
    void job().catch((e: unknown) => showError(`${what} failed: ${e instanceof Error ? e.message : e}`));
  const menu = dropdown(root, () => [
    {
      icon: ICONS.image,
      label: "Save view as PNG",
      title: "The current view at screen resolution",
      run: () => run("Saving the image", () => savePng(viewer)),
    },
    ...(canCopyImage()
      ? [
          {
            icon: ICONS.copy,
            label: "Copy view as image",
            run: () =>
              run("Copying the image", async () => {
                await copyPng(viewer);
                showNote("Image copied to the clipboard");
              }),
          },
        ]
      : []),
    {
      icon: ICONS.print,
      label: "Print view…",
      keys: "Ctrl+P",
      title: "Prints the current view (on a white background)",
      run: () => run("Printing", () => printView(viewer, printHost)),
    },
  ]);
  button.addEventListener("click", (ev) => {
    ev.stopPropagation();
    menu.toggle();
  });
  return { root, button, print: () => run("Printing", () => printView(viewer, printHost)) };
}

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
/**
 * The empty state is the static page content of index.html (#landing: what search engines and
 * no-JS visitors see), moved into the stage; its buttons get their actions here.
 */
const emptyState = document.getElementById("landing") ?? h("article", { class: "landing" });
for (const b of emptyState.querySelectorAll<HTMLButtonElement>("[data-open]")) {
  const folder = b.dataset.open === "folder";
  b.prepend(icon(folder ? ICONS.folder : ICONS.open));
  b.addEventListener("click", () => (folder ? chooseFolder() : chooseFiles()));
}
/** Recently opened drawings, below the landing card's buttons (recent.ts; Chromium only). */
const recentList = h("div", { class: "recent", hidden: true });
emptyState.querySelector(".empty-actions")?.after(recentList);
const busy = h("div", { class: "busy" }, h("span", { class: "spinner" }), h("span", {}, "Loading"));
const toast = h("div", { class: "toast" });
const updateBar = h("div", { class: "update-bar", role: "status" });
const measureChip = h("div", { class: "measure-chip" });
/** Name of the measure tool's snap point, next to its marker. */
const snapLabel = h("div", { class: "snap-label" });
const SNAP_NAMES = ["Endpoint", "Midpoint", "Center", "Node", "Quadrant"];
const zoomControls = h(
  "div",
  { class: "zoom-controls" },
  h(
    "button",
    { class: "zoom-btn", title: "Zoom in (+)", onclick: () => viewer.zoom(ZOOM_STEP) },
    icon(ICONS.plus),
  ),
  h(
    "button",
    { class: "zoom-btn", title: "Zoom out (−)", onclick: () => viewer.zoom(1 / ZOOM_STEP) },
    icon(ICONS.minus),
  ),
  h(
    "button",
    {
      class: "zoom-btn",
      title: "Fit to extents (F, or double-click empty space)",
      onclick: () => viewer.fit(),
    },
    icon(ICONS.fit),
  ),
);
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
  snapLabel,
  zoomControls,
  layoutNotice,
  compare.root,
  toast,
  updateBar,
);

const inspector = h("div", { class: "section grow inspector" });
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
const reportLink = h(
  "a",
  { class: "status-link", href: `${__BUILD__.repo}/issues/new`, target: "_blank", rel: "noopener" },
  icon(ICONS.github),
  h("span", {}, "Report a problem"),
);
const statusbar = h(
  "footer",
  { class: "statusbar" },
  ...Object.values(status),
  reportLink,
  h(
    "a",
    { class: "status-link", href: __BUILD__.repo, target: "_blank", rel: "noopener" },
    icon(ICONS.star),
    h("span", {}, "Leave a star"),
  ),
  h(
    "a",
    {
      class: "status-link",
      href: __BUILD__.repo,
      target: "_blank",
      rel: "noopener",
      title: `truedxf ${__BUILD__.commit}, built ${__BUILD__.date}. Source code (MIT)`,
    },
    `truedxf ${__BUILD__.commit}`,
  ),
);
const main = h("main", { class: "main" }, leftPanel, stage, rightPanel);
mount(app, topbar, main, statusbar);
resizableSidebars(main, leftPanel, rightPanel);
resizableSections(leftPanel, "left");
resizableSections(rightPanel, "right");

// ---- viewer ------------------------------------------------------------------------------------

/** Where IMAGEDEF paths of the current file resolve (fixtures / corpus files via the samples API). */
let imageBase: ((path: string) => string) | undefined;
/** `?fallbackFont=a.shx,b.ttf`: fonts for text whose font is missing (default: the viewer's). */
const fallbackFont = new URLSearchParams(location.search).get("fallbackFont")?.split(",").filter(Boolean);
const fontsFolder = new FontFolder();
const recent = new RecentFiles();
recent.onChange = renderRecent;
const viewer = new DxfViewer(viewerHost, {
  background: "dark",
  mergeBatches: new URLSearchParams(location.search).get("merge") !== "0",
  viewCulling: new URLSearchParams(location.search).get("cull") !== "0",
  antialias: new URLSearchParams(location.search).get("aa") !== "0",
  lod: new URLSearchParams(location.search).get("lod") !== "0",
  loadFont: fontLoader(fontsFolder),
  // Chinese / Japanese characters that the drawing's fonts lack (fonts/README.md); fetched only
  // for drawings with CJK text
  cjkFallbackFont: "notosanssc-regular.otf",
  // PDF.js fonts, CMaps and decoders (vite.config.ts): absolute, the worker resolves it
  pdf: { assetsUrl: new URL("pdfjs/", location.href).href },
  ...(fallbackFont?.length ? { fallbackFont } : {}),
  loadImage: async (path) => {
    if (!imageBase) return undefined;
    const r = await fetch(imageBase(path));
    return r.status === 200 ? new Uint8Array(await r.arrayBuffer()) : undefined;
  },
});
(window as unknown as { viewer: DxfViewer }).viewer = viewer;
const searchBox = new SearchBox(viewer);
searchSlot.replaceWith(searchBox.root);
filesPanel = new FilesPanel(
  viewer,
  {
    addFiles: () => chooseFiles(),
    openDrawing: (f) => void openStored(f),
  },
  fontsFolder,
);
fontsFolder.onChange = () => {
  viewer.reloadAssets();
  filesPanel.render();
};
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
  if (filesPanel.current === undefined && filesPanel.urlDrawing) filesPanel.urlDrawing.size = d.byteLength;
  filesPanel.render();
  emptyState.style.display = "none";
  stage.classList.add("has-drawing");
  exportUi.button.disabled = false;
  fileName.textContent = d.name;
  document.title = `${d.name} · truedxf`;
  status.file.innerHTML = "";
  status.file.append(h("b", {}, d.name), ` · ${d.acadver} · ${d.format} · ${fmtBytes(d.byteLength)}`);
  status.entities.textContent = `${fmtNum(d.entityCount)} entities`;
  renderLayouts();
  renderLayers();
  renderDiagnostics();
  showInspector(undefined);
  updateReportLink();
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
  updateReportLink();
});
viewer.on("busy", ({ busy: on, what }) => {
  busy.classList.toggle("on", on);
  (busy.lastChild as HTMLElement).textContent = what || "Working";
});
viewer.on("error", ({ error }) => {
  console.error(error);
  if (error instanceof NotDxfError)
    // a DWG is expected not to open; anything else may be a DXF the sniffer gets wrong
    showError(error.message, error.kind === "dwg" ? undefined : notDxfReport(error));
  else showError(error.message);
  // a tab older than the deployment cannot load its chunks any more
  updates?.check();
});
viewer.on("cursor", (c) => {
  status.cursor.textContent = c ? `${fmtCoord(c.x)}, ${fmtCoord(c.y)}` : "";
});
viewer.on("select", ({ handle }) => void showInspector(handle));
viewer.on("snap", (s) => {
  const p = s && viewer.worldToScreen(s.x, s.y);
  snapLabel.classList.toggle("on", !!p);
  if (!s || !p) return;
  snapLabel.textContent = SNAP_NAMES[s.kind] ?? "Snap";
  snapLabel.style.transform = `translate(${Math.round(p[0] + 12)}px, ${Math.round(p[1] + 10)}px)`;
});
viewer.on("view", () => snapLabel.classList.remove("on"));
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
  if (typeof src === "string")
    filesPanel.urlDrawing = {
      name: name ?? basenameOf(decodeURIComponent(src.split("?")[0]!)),
      url: src,
      reopen: () => void openSource(src, name, images),
    };
  filesPanel.render();
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
async function openLocal(files: FileInput[], source?: RecentSource, drawing?: string): Promise<void> {
  if (files.length === 0) return;
  const drawings = files.filter((f) => isDrawing(f.name));
  if (drawings.length === 0) {
    viewer.addFiles(files);
    const dwg = files.find((f) => isDwg(f.name));
    if (dwg) showError(`${dwg.name} is a DWG file. Only DXF files can be opened.`);
    else if (!info) showError("No .dxf drawing among the files; they were added for the next drawing.");
    return;
  }
  if (drawings.length === 1 || drawing !== undefined) {
    const previous = filesPanel.current;
    beginOpen(undefined);
    filesPanel.current = undefined;
    try {
      const r = await viewer.openFiles(files, drawing !== undefined ? { drawing } : {});
      filesPanel.current = r.opened?.path;
      if (source && r.opened) void recent.remember(source, r.opened);
    } catch {
      // reported through the error event; the open drawing stays (e.g. not a DXF)
      filesPanel.current = previous;
    }
    filesPanel.render();
    return;
  }
  const { drawings: added } = await viewer.openFiles(files, { drawing: false });
  const chosen = await pickDrawing(stage, added);
  if (chosen && (await openStored(chosen)) && source) void recent.remember(source, chosen);
}

/** Opens a drawing that is among the viewer's files; false when it could not be opened. */
async function openStored(f: ViewerFile): Promise<boolean> {
  const previous = filesPanel.current;
  beginOpen(undefined);
  filesPanel.current = f.path;
  filesPanel.render();
  try {
    await viewer.openDrawing(f.path);
    return true;
  } catch {
    // reported through the error event; the open drawing stays (e.g. not a DXF)
    filesPanel.current = previous;
    filesPanel.render();
    return false;
  }
}

/**
 * The Open dialog. Where the browser has file handles the drawing is remembered for the recent
 * list (recent.ts); elsewhere it is the plain file input.
 */
function chooseFiles(): void {
  if (!recent.supported) {
    fileInput.click();
    return;
  }
  void recent.pickFiles().then((r) => r && openLocal(r.files, r.source));
}

function chooseFolder(): void {
  if (!recent.supported) {
    folderInput.click();
    return;
  }
  void recent.pickFolder().then((r) => r && openLocal(r.files, r.source));
}

/** Reopens a recent drawing (a click: the browser may ask for permission to read it again). */
async function openRecent(e: RecentEntry): Promise<void> {
  let r: Awaited<ReturnType<RecentFiles["reopen"]>>;
  try {
    r = await recent.reopen(e);
  } catch {
    await recent.remove(e);
    showError(`${e.name} is no longer where it was opened from and was removed from the list.`);
    return;
  }
  if (!r) {
    showError(`${e.name}: the browser did not allow reading it.`);
    return;
  }
  await openLocal(r.files, e.folder ? { folder: e.folder } : { files: e.files ?? [] }, r.drawing);
}

function renderRecent(): void {
  const items = recent.entries.slice(0, 5);
  recentList.hidden = items.length === 0;
  mount(
    recentList,
    h("div", { class: "recent-head" }, "Recent drawings"),
    items.map((e) => {
      const remove = h(
        "button",
        { class: "recent-remove", title: "Remove from the list", type: "button" },
        icon(ICONS.close),
      );
      remove.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void recent.remove(e);
      });
      return h(
        "button",
        {
          class: "recent-item",
          type: "button",
          title: `${e.path}${e.folder ? " (opened with its folder)" : ""}`,
          onclick: () => void openRecent(e),
        },
        icon(e.folder ? ICONS.folder : ICONS.file),
        h("span", { class: "recent-name" }, e.name),
        h("span", { class: "recent-meta" }, openedAgo(e.opened)),
        remove,
      );
    }),
  );
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
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && !ev.altKey && (ev.key === "o" || ev.key === "O")) {
    ev.preventDefault();
    chooseFiles();
    return;
  }
  // Ctrl+F searches the drawing's texts (the browser's find sees only the page around it)
  if (mod && !ev.altKey && (ev.key === "f" || ev.key === "F") && info) {
    ev.preventDefault();
    searchBox.focus();
    return;
  }
  // Ctrl+P prints the view (the browser's own print of this page would be empty)
  if (mod && !ev.altKey && (ev.key === "p" || ev.key === "P") && info) {
    ev.preventDefault();
    exportUi.print();
    return;
  }
  if (mod || ev.altKey) return;
  const t = ev.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)
    return;
  if (document.querySelector(".modal")) return;
  if (ev.key === "f" || ev.key === "F") viewer.fit();
  else if (ev.key === "m" || ev.key === "M") setTool(viewer.currentTool === "measure" ? "select" : "measure");
  else if (ev.key === "+" || ev.key === "=") viewer.zoom(ZOOM_STEP);
  else if (ev.key === "-" || ev.key === "_") viewer.zoom(1 / ZOOM_STEP);
  else if (ev.key === "?") showShortcuts();
  else return;
  ev.preventDefault();
});

/** The keyboard and mouse reference (the keyboard button, `?`). */
function showShortcuts(): void {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const ctrl = mac ? "⌘" : "Ctrl";
  const row = (keys: string[], what: string) =>
    h(
      "tr",
      {},
      h(
        "td",
        { class: "keys" },
        keys.flatMap((k, i) => [i ? h("span", { class: "or" }, " / ") : null, h("kbd", {}, k)]),
      ),
      h("td", {}, what),
    );
  const group = (title: string, rows: HTMLElement[]) =>
    h("div", { class: "shortcut-group" }, h("h3", {}, title), h("table", { class: "shortcuts" }, rows));
  openDialog({
    title: "Keyboard and mouse",
    class: "wide",
    body: [
      h(
        "div",
        { class: "shortcut-cols" },
        group("View", [
          row(["Wheel"], "Zoom at the pointer"),
          row(["Drag"], "Pan (any mouse button)"),
          row(["+", "−"], "Zoom in / out"),
          row(["F"], "Fit the drawing"),
          row(["Double-click"], "Fit (on empty space)"),
        ]),
        group("Tools", [
          row(["Click"], "Select an entity and inspect it"),
          row(["M"], "Measure on / off (two clicks)"),
          row(["Alt"], "Measure without snapping (hold)"),
          row(["Esc"], "Clear the selection or measurement"),
          row(["Alt+click"], "Isolate a layer (Layers panel)"),
        ]),
        group("Search", [
          row([`${ctrl}+F`], "Search text in the drawing"),
          row(["Enter", "↓"], "Next match"),
          row(["Shift+Enter", "↑"], "Previous match"),
        ]),
        group("Files", [
          row([`${ctrl}+O`], "Open files"),
          row([`${ctrl}+P`], "Print the view"),
          row(["Drop"], "Open dropped files or folders"),
        ]),
        group("Help", [row(["?"], "This overview")]),
      ),
    ],
  });
}

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
  const source = droppedSource(ev.dataTransfer);
  void droppedFiles(ev.dataTransfer).then(
    async (files) => openLocal(files, await source),
    (e) => showError(String(e)),
  );
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
          title: `${l.name}${flags.length ? ` (${flags.join(", ")} in file)` : ""}. Click: toggle, Alt+click: isolate`,
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

/**
 * "Report a problem" opens the repository's issue form (.github/ISSUE_TEMPLATE/rendering.yml)
 * with its Environment field filled in: build, browser and the drawing's version / entity types
 * / what was not rendered. No file name.
 */
function updateReportLink(): void {
  const lines = [`truedxf: ${__BUILD__.commit} (${__BUILD__.date})`, `Browser: ${navigator.userAgent}`];
  if (info) {
    lines.push(
      `Drawing: ${info.acadver}, ${info.format}, ${fmtBytes(info.byteLength)}, ${info.entityCount} entities`,
    );
    const types = Object.entries(info.entityTypes).sort((a, b) => b[1] - a[1]);
    lines.push(`Entity types: ${types.map(([k, n]) => `${k} ${n}`).join(", ")}`);
    const un = Object.entries(lastRender?.unsupported ?? {});
    if (un.length) lines.push(`Not rendered: ${un.map(([k, n]) => `${k} ${n}`).join(", ")}`);
    const codes = [...new Set(viewer.warnings.map((w) => w.code))];
    if (codes.length) lines.push(`Viewer warnings: ${codes.join(", ")}`);
  }
  // GitHub rejects very long URLs: cut the tail (the long lists come last)
  let environment = lines.join("\n");
  if (environment.length > 4000) environment = `${environment.slice(0, 4000)}…`;
  const q = new URLSearchParams({ template: "rendering.yml", title: "Rendering problem: ", environment });
  reportLink.setAttribute("href", `${__BUILD__.repo}/issues/new?${q}`);
}

/** "Report it" link for a file the viewer did not take for a DXF (no file name or content). */
function notDxfReport(e: NotDxfError): string {
  const environment = [
    `truedxf: ${__BUILD__.commit} (${__BUILD__.date})`,
    `Browser: ${navigator.userAgent}`,
    `Detected as: ${e.kind}`,
  ].join("\n");
  const q = new URLSearchParams({
    template: "rendering.yml",
    title: "File not recognised as DXF: ",
    environment,
  });
  return `${__BUILD__.repo}/issues/new?${q}`;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * Error message at the bottom of the stage. With `reportUrl` it stays until closed and offers
 * to report the problem on GitHub; otherwise it hides after a few seconds.
 */
function showError(msg: string, reportUrl?: string): void {
  clearTimeout(toastTimer);
  mount(
    toast,
    h("span", { class: "toast-text" }, msg.split("\n")[0] ?? msg),
    reportUrl
      ? [
          h("span", { class: "toast-sub" }, "Think this is wrong?"),
          h(
            "a",
            { class: "toast-action", href: reportUrl, target: "_blank", rel: "noopener" },
            icon(ICONS.github),
            "Report on GitHub",
          ),
        ]
      : null,
    h("button", { class: "toast-close", title: "Close", onclick: hideError }, icon(ICONS.close)),
  );
  toast.classList.remove("note");
  toast.classList.add("on");
  if (!reportUrl) toastTimer = setTimeout(hideError, 8000);
}
function hideError(): void {
  toast.classList.remove("on", "note");
}

/** A short neutral confirmation ("Image copied …") in the error toast's place. */
function showNote(msg: string): void {
  clearTimeout(toastTimer);
  mount(toast, h("span", { class: "toast-text" }, msg));
  toast.classList.add("on", "note");
  toastTimer = setTimeout(hideError, 2500);
}

// ---- modes: viewer / fixtures / corpus (dev server with local samples only) -------------------------

function basenameOf(p: string): string {
  return p.replaceAll("\\", "/").split("/").pop() ?? p;
}

async function openFixture(c: FixtureCase): Promise<void> {
  const suite = c.id.split("/")[0]!;
  await openSource(
    `${API}file/${c.dxf}`,
    `${c.name}.dxf`,
    (p) => `${API}image/${suite}/${encodeURIComponent(p)}`,
  );
  // reopening it from the Files panel shows the AutoCAD comparison again
  if (filesPanel.urlDrawing) filesPanel.urlDrawing.reopen = () => void openFixture(c);
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
      mount(
        leftPanel,
        (fixtures ??= withResizableSections(
          fixtureBrowser(st, (c) => void openFixture(c)),
          "fixtures",
        )),
      );
    else
      mount(
        leftPanel,
        (corpus ??= withResizableSections(
          corpusBrowser((r) => void openCorpus(r)),
          "corpus",
        )),
      );
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

// ---- updates -----------------------------------------------------------------------------------

const updates = __UPDATES__
  ? watchUpdates({
      inUse: () => viewer.document !== undefined || viewer.files.length > 0,
      offer: (reload) => {
        mount(
          updateBar,
          h("span", { class: "update-dot" }),
          h("span", {}, "A new version of truedxf is available."),
          h(
            "button",
            {
              class: "btn primary",
              onclick: reload,
              title: "Reload the page. Drawings opened from your computer need to be opened again.",
            },
            "Reload",
          ),
          h(
            "button",
            { class: "btn icon ghost", title: "Not now", onclick: () => updateBar.classList.remove("on") },
            icon(ICONS.close),
          ),
        );
        updateBar.classList.add("on");
      },
    })
  : undefined;

// ---- small screens -----------------------------------------------------------------------------

/**
 * Below 900 px the side panels are hidden (style.css): say so once, the first time the page is
 * opened on such a screen.
 */
function smallScreenNotice(): void {
  if (!window.matchMedia("(max-width: 900px)").matches) return;
  try {
    if (localStorage.getItem("truedxf.small-screen-notice")) return;
    localStorage.setItem("truedxf.small-screen-notice", "1");
  } catch {
    // storage unavailable: show it every visit rather than never
  }
  openDialog({
    title: "Made for larger screens",
    body: [
      h(
        "p",
        {},
        "truedxf is not optimized for phones yet. On small screens the side panels (layouts, layers, " +
          "inspector and files) are hidden.",
      ),
      h(
        "p",
        {},
        "Opening, panning and zooming drawings works. Turn the device sideways or use a computer for the rest.",
      ),
    ],
    actions: [{ label: "Got it", primary: true }],
  });
}

// ---- start -------------------------------------------------------------------------------------

renderLayouts();
renderDiagnostics();
void showInspector(undefined);
const initial = new URLSearchParams(location.search).get("file");
if (initial) void openSource(initial);
// the public build has no samples (vite.config.ts): the fixture / corpus code is dropped
if (__SAMPLES__) void initModes();
updateReportLink();
void fontsFolder.restore();
void recent.restore();
smallScreenNotice();

export { viewer };

/** The fixture / corpus browsers keep their panels in their own container. */
function withResizableSections<T extends HTMLElement>(el: T, key: string): T {
  resizableSections(el, key);
  return el;
}
