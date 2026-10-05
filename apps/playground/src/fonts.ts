/**
 * Fonts of the playground. Lookup order (after the viewer's own files, which come first):
 *
 * 1. the user's fonts folder (e.g. a copy of AutoCAD's Fonts folder), remembered across visits
 *    where the browser supports folder handles (Chromium: File System Access API + IndexedDB);
 *    other browsers pick it with a folder input for the session;
 * 2. the served fonts (`fonts/`: our test fonts and the Liberation fallback fonts, see
 *    server/fonts.ts and fonts/README.md; in dev also this machine's font folders);
 * 3. the Liberation stand-in for a missing Windows core font (`arial.ttf` → Liberation Sans, …).
 *
 * The public site ships no Autodesk or Windows fonts: real drawings get their fonts only from
 * the user's own folder.
 */
import { type AssetLoader, fetchFontLoader } from "@truedxf/viewer";
import { idbDelete, idbGet, idbPut } from "./storage.ts";

const FONT_FILE = /\.(shx|ttf|ttc|otf)$/i;
/** A fonts folder is indexed up to this many files / this depth (a picked drive must not hang the page). */
const MAX_FOLDER_FILES = 20_000;
const MAX_FOLDER_DEPTH = 4;
/** IndexedDB key of the remembered folder handle (storage.ts). */
const FOLDER_KEY = "fonts-folder";

/** Windows core fonts → their metric-compatible Liberation stand-ins (lower-case file names). */
export const FONT_ALIASES: Readonly<Record<string, string>> = {
  "arial.ttf": "liberationsans-regular.ttf",
  "arialbd.ttf": "liberationsans-bold.ttf",
  "ariali.ttf": "liberationsans-italic.ttf",
  "arialbi.ttf": "liberationsans-bolditalic.ttf",
  "times.ttf": "liberationserif-regular.ttf",
  "timesbd.ttf": "liberationserif-bold.ttf",
  "timesi.ttf": "liberationserif-italic.ttf",
  "timesbi.ttf": "liberationserif-bolditalic.ttf",
  "cour.ttf": "liberationmono-regular.ttf",
  "courbd.ttf": "liberationmono-bold.ttf",
  "couri.ttf": "liberationmono-italic.ttf",
  "courbi.ttf": "liberationmono-bolditalic.ttf",
};

/**
 * Folder → served fonts → Liberation stand-ins. The viewer's default fallback list for missing
 * fonts (simplex.shx, txt.shx, arial.ttf, …) thereby ends in Liberation Sans on the public site.
 */
export function fontLoader(
  folder: Pick<FontFolder, "read">,
  served: AssetLoader = fetchFontLoader("fonts/"),
): AssetLoader {
  return async (name) => {
    const key = name.toLowerCase();
    const alias = FONT_ALIASES[key];
    return (
      (await folder.read(key)) ??
      (await served(key)) ??
      (alias !== undefined ? await served(alias) : undefined)
    );
  };
}

// ---- the fonts folder --------------------------------------------------------------------------

// File System Access API members that the DOM lib does not declare (Chromium only).
type Permission = "granted" | "denied" | "prompt";
interface FsFile {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
}
interface FsDir {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterable<FsFile | FsDir>;
  queryPermission?(d: { mode: "read" }): Promise<Permission>;
  requestPermission?(d: { mode: "read" }): Promise<Permission>;
}
type PickDir = (o: { id?: string; mode?: "read" }) => Promise<FsDir>;

export type FontFolderState =
  /** No folder chosen. */
  | "none"
  /** Fonts available. */
  | "ready"
  /** A remembered folder needs the user's permission again (a click on Reconnect). */
  | "permission";

/** The user's fonts folder. `onChange` fires after every change of the available fonts. */
export class FontFolder {
  state: FontFolderState = "none";
  /** Folder name (no path: browsers do not reveal it). */
  name: string | undefined;
  /** Whether the folder is remembered for the next visit. */
  remembered = false;
  onChange: () => void = () => {};
  private files = new Map<string, File>();
  private handle: FsDir | undefined;
  private readonly input: HTMLInputElement;

  constructor() {
    this.input = document.createElement("input");
    this.input.type = "file";
    this.input.multiple = true;
    this.input.hidden = true;
    this.input.setAttribute("webkitdirectory", "");
    this.input.addEventListener("change", () => {
      const all = [...(this.input.files ?? [])];
      this.input.value = "";
      if (all.length === 0) return;
      const root = all[0]!.webkitRelativePath.split("/")[0] || "fonts";
      this.set(root, all.filter((f) => FONT_FILE.test(f.name)).slice(0, MAX_FOLDER_FILES), false);
    });
    document.body.append(this.input);
  }

  /** Number of font files in the folder. */
  get count(): number {
    return this.files.size;
  }

  /** Whether the browser can remember the folder (File System Access API). */
  get canRemember(): boolean {
    return typeof (window as { showDirectoryPicker?: PickDir }).showDirectoryPicker === "function";
  }

  /** Bytes of a font file in the folder (lower-case base name). */
  async read(name: string): Promise<Uint8Array | undefined> {
    const f = this.files.get(name);
    return f ? new Uint8Array(await f.arrayBuffer()) : undefined;
  }

  /** Restores the remembered folder (start-up): ready when the permission persisted. */
  async restore(): Promise<void> {
    const h = await idbGet<FsDir>(FOLDER_KEY);
    if (!h) return;
    this.handle = h;
    this.name = h.name;
    this.remembered = true;
    if ((await h.queryPermission?.({ mode: "read" })) === "granted") await this.index(h);
    else {
      this.state = "permission";
      this.onChange();
    }
  }

  /** Lets the user choose a folder (must run in a click handler). */
  async choose(): Promise<void> {
    const pick = (window as { showDirectoryPicker?: PickDir }).showDirectoryPicker;
    if (!pick) {
      this.input.click();
      return;
    }
    let h: FsDir;
    try {
      h = await pick.call(window, { id: "truedxf-fonts", mode: "read" });
    } catch {
      // cancelled (AbortError) or refused (e.g. a system folder): nothing changes
      return;
    }
    this.handle = h;
    this.remembered = await idbPut(FOLDER_KEY, h);
    await this.index(h);
  }

  /** Asks again for the permission of a remembered folder (must run in a click handler). */
  async reconnect(): Promise<void> {
    const h = this.handle;
    if (!h) return this.choose();
    if ((await h.requestPermission?.({ mode: "read" })) === "granted") await this.index(h);
  }

  /** Forgets the folder (and its remembered handle). */
  async forget(): Promise<void> {
    this.handle = undefined;
    await idbDelete(FOLDER_KEY);
    this.set(undefined, [], false);
  }

  private async index(dir: FsDir): Promise<void> {
    const out: File[] = [];
    const walk = async (d: FsDir, depth: number): Promise<void> => {
      const children: (FsFile | FsDir)[] = [];
      try {
        for await (const c of d.values()) children.push(c);
      } catch {
        return; // unreadable folder: skip
      }
      // sorted, so the first of several same-named fonts is stable
      children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const c of children) {
        if (out.length >= MAX_FOLDER_FILES) return;
        if (c.kind === "file") {
          if (!FONT_FILE.test(c.name)) continue;
          try {
            out.push(await c.getFile());
          } catch {
            // unreadable file: skip
          }
        } else if (depth < MAX_FOLDER_DEPTH) await walk(c, depth + 1);
      }
    };
    await walk(dir, 0);
    this.set(dir.name, out, this.remembered);
  }

  private set(name: string | undefined, files: readonly File[], remembered: boolean): void {
    this.files = new Map();
    for (const f of files) {
      const k = f.name.toLowerCase();
      if (!this.files.has(k)) this.files.set(k, f);
    }
    this.name = name;
    this.remembered = remembered;
    this.state = name === undefined ? "none" : "ready";
    this.onChange();
  }
}
