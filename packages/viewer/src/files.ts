/**
 * Additional files for the viewer (fonts, shape files, images, further drawings): an in-memory
 * store on the main thread that answers the renderer's asset requests by **loose matching** on
 * the file name. DXF files reference resources by paths of the machine that wrote them
 * (`C:\Program Files\Autodesk\…\Fonts\txt.shx`, `..\images\photo.jpg`, `\\server\share\x.png`)
 * or by bare names (`txt`, `romans`) that a browser can never resolve, so:
 *
 * 1. the requested name is split on `/` and `\` and only its base name is compared,
 *    case-insensitively;
 * 2. a base name without extension also matches stored files with that name plus a known
 *    extension (fonts: .shx, .ttf, .ttc, .otf in that order; images: common raster formats);
 * 3. among several stored files with the same base name (a folder with subfolders), a relative
 *    request resolved against the open drawing's folder wins when it names one exactly; otherwise
 *    the most trailing path segments in common with the request win, then the file closest to
 *    the drawing's folder, then the shallower path, then the path in code-unit order.
 *
 * Files (Blob / File) are kept as given and read only when requested.
 */

export type ViewerFileKind = "drawing" | "font" | "image" | "other";

/** What an asset request is for: decides the extensions tried for names without one. */
export type AssetKind = "font" | "image";

/** A file given as data, e.g. fetched or generated. */
export interface FileInput {
  name: string;
  data: Uint8Array | Blob;
  /**
   * Path inside a picked folder (`File.webkitRelativePath`, a dropped entry's `fullPath`), with
   * `/` or `\` separators; used to tell files with the same name apart. Default: `name`.
   */
  path?: string;
}

/** A file in the store (see DxfViewer.files). */
export interface ViewerFile {
  /** File name (base name of `path`). */
  name: string;
  /** Path as given (`/`-separated, without a leading `/`); the name for files without one. */
  path: string;
  size: number;
  kind: ViewerFileKind;
}

const FONT_EXTENSIONS = [".shx", ".ttf", ".ttc", ".otf"] as const;
const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".jpe",
  ".tif",
  ".tiff",
  ".bmp",
  ".dib",
  ".gif",
  ".webp",
  ".pcx",
  ".tga",
  ".jp2",
] as const;

function extension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}

/** Kind of a file by its extension. */
export function fileKind(name: string): ViewerFileKind {
  const ext = extension(name);
  if (ext === ".dxf") return "drawing";
  if ((FONT_EXTENSIONS as readonly string[]).includes(ext)) return "font";
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
  // PDF underlays are requested like images (loadImage); not an extension tried for bare names
  if (ext === ".pdf") return "image";
  return "other";
}

/** Path segments: split on `/` and `\`, without empty and `.` segments (case kept). */
export function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
}

/** Base name of a Windows or Unix path (`C:\a\b.shx` → `b.shx`). */
export function baseName(path: string): string {
  const s = pathSegments(path);
  return s[s.length - 1] ?? "";
}

/** Absolute paths: drive (`C:`), root (`/x`, `\x`), UNC (`\\server`) or URL (`file:`). */
export function isAbsolutePath(path: string): boolean {
  return /^([A-Za-z]:|[\\/]|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/.test(path.trim());
}

/** Strips surrounding whitespace and quotes (paths in DXF files are sometimes quoted). */
function cleanRequest(request: string): string {
  let s = request.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s;
}

interface Entry {
  file: ViewerFile;
  data: Uint8Array | Blob;
  /** Lower-case path segments. */
  segs: string[];
  /** Lower-case joined path (unique key). */
  key: string;
  /** Lower-case base name. */
  base: string;
}

function isFileInput(f: unknown): f is FileInput {
  return typeof f === "object" && f !== null && "data" in f && "name" in f;
}

/** Resolves `segs` (lower case, may contain `..`) against a directory. */
function resolveSegments(dir: readonly string[], segs: readonly string[]): string[] | undefined {
  const out = [...dir];
  for (const s of segs) {
    if (s === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else out.push(s);
  }
  return out;
}

function trailingMatch(a: readonly string[], b: readonly string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: readonly string[], b: readonly string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * The viewer's file store (see the module comment for the matching rules). Every change bumps
 * `generation`; the viewer passes it to the backend, which then drops its font and image caches.
 */
export class FileStore {
  private entries: Entry[] = [];
  private gen = 0;
  /** Lower-case directory segments of the open drawing when it came from the store. */
  private drawingDir: string[] | undefined;

  /** Increases with every change of the files or of the open drawing's folder. */
  get generation(): number {
    return this.gen;
  }

  get size(): number {
    return this.entries.length;
  }

  /** The stored files, by path. */
  list(): ViewerFile[] {
    return [...this.entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((e) => e.file);
  }

  /**
   * Adds files (a `File` uses its `webkitRelativePath` as path when set). A file with the same
   * path (case-insensitive) replaces the stored one. Returns the added files in input order.
   */
  add(files: Iterable<File | FileInput>): ViewerFile[] {
    const added: ViewerFile[] = [];
    for (const f of files) {
      const data = isFileInput(f) ? f.data : f;
      const rel = isFileInput(f) ? f.path : (f as File).webkitRelativePath;
      const segsOrig = pathSegments(rel || f.name);
      if (segsOrig.length === 0) continue;
      const name = segsOrig[segsOrig.length - 1]!;
      const segs = segsOrig.map((s) => s.toLowerCase());
      const key = segs.join("/");
      const file: ViewerFile = {
        name,
        path: segsOrig.join("/"),
        size: data instanceof Uint8Array ? data.byteLength : data.size,
        kind: fileKind(name),
      };
      const entry: Entry = { file, data, segs, key, base: name.toLowerCase() };
      const i = this.entries.findIndex((e) => e.key === key);
      if (i >= 0) this.entries[i] = entry;
      else this.entries.push(entry);
      added.push(file);
    }
    if (added.length) this.gen++;
    return added;
  }

  /**
   * Removes the file with this path, or (for a bare name) every file with this name. Returns the
   * number of files removed.
   */
  remove(nameOrPath: string): number {
    const segs = pathSegments(cleanRequest(nameOrPath)).map((s) => s.toLowerCase());
    if (segs.length === 0) return 0;
    const key = segs.join("/");
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.key !== key);
    if (this.entries.length === before && segs.length === 1)
      this.entries = this.entries.filter((e) => e.base !== key);
    const n = before - this.entries.length;
    if (n) this.gen++;
    return n;
  }

  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.gen++;
  }

  /** Bumps the generation without a change of the files (the host's loaders changed). */
  touch(): void {
    this.gen++;
  }

  /**
   * Sets the open drawing's path in the store (undefined: not from the store): relative paths
   * resolve against its folder, and same-named files closer to it win.
   */
  setDrawing(path: string | undefined): void {
    const dir =
      path === undefined
        ? undefined
        : pathSegments(path)
            .map((s) => s.toLowerCase())
            .slice(0, -1);
    if (JSON.stringify(dir) === JSON.stringify(this.drawingDir)) return;
    this.drawingDir = dir;
    if (this.entries.length) this.gen++;
  }

  /** The stored path of a Blob / File that is in the store (identity), else undefined. */
  pathOf(data: Blob): string | undefined {
    return this.entries.find((e) => e.data === data)?.file.path;
  }

  /** The stored file a request resolves to (see the module comment), or undefined. */
  find(request: string, kind?: AssetKind | "drawing"): ViewerFile | undefined {
    return this.match(request, kind)?.file;
  }

  /** Bytes of the stored file a request resolves to; undefined when none matches or it cannot be read. */
  async read(request: string, kind?: AssetKind | "drawing"): Promise<Uint8Array | undefined> {
    const e = this.match(request, kind);
    if (!e) return undefined;
    return readData(e.data);
  }

  /** The stored data (as given) of the file a request resolves to. */
  data(request: string, kind?: AssetKind | "drawing"): Uint8Array | Blob | undefined {
    return this.match(request, kind)?.data;
  }

  private match(request: string, kind: AssetKind | "drawing" | undefined): Entry | undefined {
    const req = cleanRequest(request);
    const reqSegs = pathSegments(req).map((s) => s.toLowerCase());
    const base = reqSegs[reqSegs.length - 1];
    if (!base || base === "..") return undefined;
    const pool = kind === "drawing" ? this.entries.filter((e) => e.file.kind === "drawing") : this.entries;
    let candidates = pool.filter((e) => e.base === base);
    if (candidates.length === 0 && extension(base) === "") {
      // a bare font / image name: try the kind's extensions in order (txt → txt.shx before txt.ttf)
      const exts: readonly string[] =
        kind === "font"
          ? FONT_EXTENSIONS
          : kind === "image"
            ? IMAGE_EXTENSIONS
            : kind === "drawing"
              ? [".dxf"]
              : [...FONT_EXTENSIONS, ...IMAGE_EXTENSIONS, ".dxf"];
      for (const ext of exts) {
        candidates = pool.filter((e) => e.base === base + ext);
        if (candidates.length) break;
      }
    }
    if (candidates.length <= 1) return candidates[0];
    // several files share the name: an exact relative hit, then the best path match
    if (this.drawingDir && !isAbsolutePath(req)) {
      const resolved = resolveSegments(this.drawingDir, reqSegs);
      const key = resolved?.join("/");
      const hit = key === undefined ? undefined : candidates.find((e) => e.key === key);
      if (hit) return hit;
    }
    // compare the request's directories only (the base names are equal, the extension may not be)
    const dirs = reqSegs.slice(0, -1).filter((s) => s !== "..");
    const dir = this.drawingDir ?? [];
    const score = (e: Entry) => [
      trailingMatch(dirs, e.segs.slice(0, -1)),
      commonPrefix(dir, e.segs.slice(0, -1)),
      -e.segs.length,
    ];
    let best = candidates[0]!;
    let bestScore = score(best);
    for (const e of candidates.slice(1)) {
      const s = score(e);
      let cmp = 0;
      for (let i = 0; i < s.length && cmp === 0; i++) cmp = s[i]! - bestScore[i]!;
      if (cmp > 0 || (cmp === 0 && e.key < best.key)) {
        best = e;
        bestScore = s;
      }
    }
    return best;
  }
}

/**
 * The drawing DxfViewer.openFiles opens: `drawing` (a name or path among the store's drawings,
 * loosely matched), none for `false`, else the first drawing among the files just added.
 */
export function chooseDrawing(
  store: FileStore,
  added: readonly ViewerFile[],
  drawing?: string | false,
): ViewerFile | undefined {
  if (drawing === false) return undefined;
  if (drawing !== undefined) return store.find(drawing, "drawing");
  return added.find((f) => f.kind === "drawing");
}

async function readData(data: Uint8Array | Blob): Promise<Uint8Array | undefined> {
  if (data instanceof Uint8Array) return data;
  try {
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    // e.g. NotReadableError: the file changed or was deleted after it was picked
    return undefined;
  }
}

/**
 * URLs to try for a resource next to a drawing opened from `drawingUrl`: a relative request
 * resolved against it, then the base name in the drawing's folder.
 */
export function relativeUrls(drawingUrl: string, request: string): string[] {
  const req = cleanRequest(request);
  const segs = pathSegments(req);
  const base = segs[segs.length - 1];
  if (!base || base === "..") return [];
  const out: string[] = [];
  const add = (rel: string) => {
    try {
      const u = new URL(rel, drawingUrl).href;
      if (!out.includes(u)) out.push(u);
    } catch {
      // not a valid URL base
    }
  };
  if (!isAbsolutePath(req)) add(segs.map((s) => (s === ".." ? s : encodeURIComponent(s))).join("/"));
  add(encodeURIComponent(base));
  return out;
}
