/**
 * Local files for the playground: reading dropped files and folders, the "Files" panel (the
 * viewer's additional files and what the drawing is missing) and the picker for folders with
 * several drawings.
 */
import { type DxfViewer, type FileInput, type ViewerFile, ViewerWarningCode } from "@truedxf/viewer";
import { h, ICONS, icon, mount } from "./dom.ts";
import type { FontFolder } from "./fonts.ts";
import { fmtBytes, fmtNum } from "./format.ts";

/** Warnings whose items are fonts (or shape files) the fonts folder can provide. */
const FONT_CODES: readonly string[] = [
  ViewerWarningCode.FontMissing,
  ViewerWarningCode.BigFontMissing,
  ViewerWarningCode.ShapeFileMissing,
];

/** Stop reading a dropped folder after this many files (a dropped drive must not hang the page). */
const MAX_DROPPED_FILES = 20_000;

export const isDrawing = (name: string) => /\.dxf$/i.test(name);
export const isDwg = (name: string) => /\.dwg$/i.test(name);

const DWG_HINT =
  "DWG files cannot be opened. Save the drawing as DXF in your CAD program (DXFOUT or Save As), or convert it with the free ODA File Converter.";

/** Files of an `<input type="file">` (folder picks keep `webkitRelativePath` as path). */
export function inputFiles(input: HTMLInputElement): FileInput[] {
  return [...(input.files ?? [])].map((f) => ({
    name: f.name,
    data: f,
    path: f.webkitRelativePath || f.name,
  }));
}

/**
 * Files of a drop, folders read recursively (DataTransferItem.webkitGetAsEntry; paths are the
 * entries' `fullPath`). Must be called synchronously in the drop handler: the items are only
 * accessible during the event.
 */
export function droppedFiles(dt: DataTransfer): Promise<FileInput[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of dt.items) {
    if (item.kind !== "file") continue;
    const e = item.webkitGetAsEntry?.();
    if (e) entries.push(e);
  }
  const plain = [...dt.files].map((f) => ({ name: f.name, data: f, path: f.name }));
  if (entries.length === 0) return Promise.resolve(plain);
  return readEntries(entries);
}

async function readEntries(roots: FileSystemEntry[]): Promise<FileInput[]> {
  const out: FileInput[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (out.length >= MAX_DROPPED_FILES) return;
    if (e.isFile) {
      try {
        const f = await new Promise<File>((ok, fail) => (e as FileSystemFileEntry).file(ok, fail));
        out.push({ name: f.name, data: f, path: e.fullPath.replace(/^\/+/, "") });
      } catch {
        // unreadable entry: skip
      }
      return;
    }
    if (!e.isDirectory) return;
    const reader = (e as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    // readEntries returns the directory in chunks until an empty batch
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok) => reader.readEntries(ok, () => ok([])));
      if (batch.length === 0) break;
      children.push(...batch);
    }
    children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const c of children) await walk(c);
  };
  for (const r of roots) await walk(r);
  return out;
}

/** The last drawing opened from a URL (?file=, a fixture, the corpus): listed in italics. */
export interface UrlDrawing {
  name: string;
  url: string;
  size?: number;
  reopen(): void;
}

export interface FilesPanelActions {
  addFiles(): void;
  openDrawing(file: ViewerFile): void;
}

/**
 * The "Files" section: the fonts folder, missing files (with an add action) and the viewer's
 * additional files.
 */
export class FilesPanel {
  readonly root: HTMLElement;
  private readonly head: HTMLElement;
  private readonly list: HTMLElement;
  private readonly viewer: DxfViewer;
  private readonly actions: FilesPanelActions;
  private readonly fonts: FontFolder;
  /** Path of the open drawing when it came from the files. */
  current: string | undefined;
  /** The last drawing opened from a URL; stays listed until another URL drawing replaces it. */
  urlDrawing: UrlDrawing | undefined;

  constructor(viewer: DxfViewer, actions: FilesPanelActions, fonts: FontFolder) {
    this.viewer = viewer;
    this.actions = actions;
    this.fonts = fonts;
    this.head = h("div", { class: "section-head" });
    this.list = h("div", { class: "list files" });
    this.root = h("div", { class: "section", style: "max-height: 34%" }, this.head, this.list);
    this.render();
  }

  render(): void {
    const files = this.viewer.files;
    const missing = this.viewer.document ? this.viewer.missingFiles : [];
    mount(
      this.head,
      "Files ",
      h("span", { class: "count" }, files.length ? String(files.length) : ""),
      h("span", { class: "spacer" }),
      files.length
        ? h(
            "button",
            { class: "link", onclick: () => this.viewer.clearFiles(), title: "Remove all files" },
            "Clear",
          )
        : null,
    );
    const rows: HTMLElement[] = [];
    // the last drawing opened from a URL (?file=, a fixture, the corpus) is not one of the files:
    // list it anyway, in italics, so the panel shows every drawing you can go back to
    const u = this.urlDrawing;
    if (u) {
      const open = this.current === undefined && this.viewer.document !== undefined;
      rows.push(
        h(
          "div",
          {
            class: `item transient${open ? " active" : ""}`,
            title: `${u.url}: opened from a URL (link, fixture or corpus), not one of your files${open ? "" : ". Click to open"}`,
            onclick: () => {
              if (!open) u.reopen();
            },
          },
          h("span", { class: "icon-16" }, icon(ICONS.file)),
          h("span", { class: "name" }, u.name),
          h("span", { class: "meta" }, u.size !== undefined ? fmtBytes(u.size) : ""),
        ),
      );
    }
    const fontsMissing =
      this.viewer.document !== undefined &&
      this.viewer.warnings.some((w) => FONT_CODES.includes(w.code) && w.items?.length);
    rows.push(...this.fontsFolderRows(fontsMissing));
    if (missing.length) {
      rows.push(
        h(
          "div",
          { class: "diag-sub" },
          `Missing (${missing.length}): `,
          h("button", { class: "link inline", onclick: () => this.actions.addFiles() }, "add them"),
        ),
      );
      for (const name of missing)
        rows.push(
          h(
            "div",
            {
              class: "item missing",
              title: `${name}: not found. Add a file with this name`,
              onclick: () => this.actions.addFiles(),
            },
            h("span", { class: "n" }, "!"),
            h("span", { class: "name" }, name),
          ),
        );
    }
    if (files.length) {
      if (missing.length) rows.push(h("div", { class: "diag-sub" }, "Loaded"));
      for (const f of files) {
        const remove = h("button", { class: "link remove", title: `Remove ${f.path}` }, "×");
        remove.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.viewer.removeFile(f.path);
        });
        const drawing = f.kind === "drawing";
        const dwg = isDwg(f.name);
        rows.push(
          h(
            "div",
            {
              class: `item${drawing && f.path === this.current ? " active" : ""}${drawing ? "" : " static"}${dwg ? " unsupported" : ""}`,
              title: drawing ? `${f.path}: click to open` : dwg ? `${f.path}: ${DWG_HINT}` : f.path,
              ...(drawing ? { onclick: () => this.actions.openDrawing(f) } : {}),
            },
            h(
              "span",
              { class: "icon-16" },
              icon(
                drawing || dwg || /\.pdf$/i.test(f.name)
                  ? ICONS.file
                  : f.kind === "image"
                    ? ICONS.grid
                    : f.kind === "font"
                      ? ICONS.font
                      : ICONS.file,
              ),
            ),
            h("span", { class: "name" }, f.path),
            h("span", { class: "meta" }, fmtBytes(f.size)),
            remove,
          ),
        );
      }
    } else if (!missing.length) {
      rows.push(
        h(
          "div",
          { class: "hint" },
          "Fonts, shape files and images the drawing references. Open them together with the " +
            "drawing (several files or a folder), or add them later. Names match without folders.",
        ),
      );
    }
    mount(this.list, rows);
  }

  /** The fonts folder: its state, or (fonts missing, none chosen) why text looks different. */
  private fontsFolderRows(fontsMissing: boolean): HTMLElement[] {
    const f = this.fonts;
    const choose = (label: string) =>
      h("button", { class: "link inline", onclick: () => void f.choose() }, label);
    if (f.state === "ready")
      return [
        h(
          "div",
          {
            class: "item static",
            title: f.remembered
              ? `Fonts folder "${f.name}": remembered for your next visit`
              : `Fonts folder "${f.name}": for this visit (this browser cannot remember folders)`,
          },
          h("span", { class: "icon-16" }, icon(ICONS.folder)),
          h("span", { class: "name" }, `Fonts: ${f.name}`),
          h("span", { class: "meta" }, `${fmtNum(f.count)} fonts`),
          h(
            "button",
            { class: "link", onclick: () => void f.choose(), title: "Choose another fonts folder" },
            "Change",
          ),
          h(
            "button",
            { class: "link remove", onclick: () => void f.forget(), title: "Forget the fonts folder" },
            "×",
          ),
        ),
      ];
    if (f.state === "permission")
      return [
        h(
          "div",
          { class: "hint" },
          `Your fonts folder "${f.name}" needs your permission again: `,
          h("button", { class: "link inline", onclick: () => void f.reconnect() }, "reconnect"),
          " or ",
          h("button", { class: "link inline", onclick: () => void f.forget() }, "forget it"),
          ".",
        ),
      ];
    if (!fontsMissing) return [];
    const why =
      "This site ships no AutoCAD or Windows fonts (txt.shx, simplex.shx, …), so missing fonts are " +
      "drawn in Liberation Sans and text can look different from AutoCAD. Choose your fonts folder " +
      "(e.g. a copy of AutoCAD's Fonts folder): it stays on your computer" +
      (f.canRemember ? " and is remembered for your next visit." : ". This browser keeps it for this visit.");
    return [
      h(
        "div",
        { class: "diag-sub fonts-cta" },
        choose("Choose your fonts folder"),
        h("span", { class: "help", title: why, "aria-label": why, role: "img" }, icon(ICONS.help)),
      ),
    ];
  }
}

/**
 * Lets the user choose one of several drawings (folder picks / multi-selections); resolves with
 * the chosen file, or undefined when cancelled.
 */
export function pickDrawing(
  host: HTMLElement,
  drawings: readonly ViewerFile[],
): Promise<ViewerFile | undefined> {
  return new Promise((resolve) => {
    const close = (f: ViewerFile | undefined) => {
      overlay.remove();
      window.removeEventListener("keydown", onKey, true);
      resolve(f);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        close(undefined);
      }
    };
    const sorted = [...drawings].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    const overlay = h(
      "div",
      { class: "picker" },
      h(
        "div",
        { class: "picker-card" },
        h("b", {}, `${drawings.length} drawings. Open which one?`),
        h("p", {}, "The other files stay available. Switch drawings in the Files panel."),
        h(
          "div",
          { class: "list" },
          sorted.map((f) =>
            h(
              "div",
              { class: "item", title: f.path, onclick: () => close(f) },
              icon(ICONS.file),
              h("span", { class: "name" }, f.path),
              h("span", { class: "meta" }, fmtBytes(f.size)),
            ),
          ),
        ),
        h(
          "div",
          { class: "notice-actions" },
          h("button", { class: "btn", onclick: () => close(undefined) }, "Cancel"),
        ),
      ),
    );
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) close(undefined);
    });
    window.addEventListener("keydown", onKey, true);
    host.append(overlay);
  });
}
