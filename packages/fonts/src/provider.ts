// Font providers: where font bytes come from. The package is isomorphic, so file-system access is
// injected (FontFileSystem) instead of importing node:fs.

/** Source of font files. Names are base file names ("simplex.shx", "arial.ttf"), matched case-insensitively. */
export interface FontProvider {
  /** Bytes of a font file, or `undefined` if the provider does not have it. */
  getFile(fileName: string): Promise<Uint8Array | undefined>;
  /**
   * All file names the provider can deliver. Needed to resolve TrueType fonts by family name
   * (STYLE XDATA); providers that cannot list files may implement `findFamily` instead.
   */
  listFiles?(): Promise<string[]>;
  /** Optional direct family lookup (returns a file name, optionally `name.ttc#face`). */
  findFamily?(family: string, style: { bold: boolean; italic: boolean }): Promise<string | undefined>;
}

export function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

/** In-memory provider (tests, browser apps that fetched or received files). */
export class MemoryFontProvider implements FontProvider {
  private readonly files = new Map<string, { name: string; bytes: Uint8Array }>();

  constructor(entries?: Iterable<readonly [string, Uint8Array]> | Record<string, Uint8Array>) {
    if (entries) {
      const it = Symbol.iterator in entries ? entries : Object.entries(entries);
      for (const [name, bytes] of it as Iterable<readonly [string, Uint8Array]>) this.add(name, bytes);
    }
  }

  /** Adds or replaces a file (stored under its base name). */
  add(fileName: string, bytes: Uint8Array): this {
    const name = baseName(fileName);
    this.files.set(name.toLowerCase(), { name, bytes });
    return this;
  }

  async getFile(fileName: string): Promise<Uint8Array | undefined> {
    return this.files.get(fileName.toLowerCase())?.bytes;
  }

  async listFiles(): Promise<string[]> {
    return [...this.files.values()].map((f) => f.name);
  }
}

/** The file-system operations a DirectoryFontProvider needs (e.g. wrap `node:fs/promises`). */
export interface FontFileSystem {
  /** Entry names (not paths) of a directory; should reject or return [] for missing directories. */
  readDir(dir: string): Promise<string[]>;
  readFile(path: string): Promise<Uint8Array>;
}

const FONT_EXTENSIONS = /\.(shx|ttf|ttc|otf)$/i;

/**
 * Serves font files from a list of directories, like AutoCAD's support file search path: the first
 * directory containing a name wins. Directories are listed once, lazily; not recursive.
 */
export class DirectoryFontProvider implements FontProvider {
  private readonly dirs: readonly string[];
  private readonly fs: FontFileSystem;
  private index: Promise<Map<string, { name: string; path: string }>> | undefined;

  constructor(dirs: readonly string[], fs: FontFileSystem) {
    this.dirs = dirs;
    this.fs = fs;
  }

  private buildIndex(): Promise<Map<string, { name: string; path: string }>> {
    this.index ??= (async () => {
      const map = new Map<string, { name: string; path: string }>();
      for (const dir of this.dirs) {
        let names: string[];
        try {
          names = await this.fs.readDir(dir);
        } catch {
          continue;
        }
        const sep = dir.endsWith("/") || dir.endsWith("\\") ? "" : "/";
        for (const name of [...names].sort()) {
          if (!FONT_EXTENSIONS.test(name)) continue;
          const key = name.toLowerCase();
          if (!map.has(key)) map.set(key, { name, path: dir + sep + name });
        }
      }
      return map;
    })();
    return this.index;
  }

  async getFile(fileName: string): Promise<Uint8Array | undefined> {
    const e = (await this.buildIndex()).get(fileName.toLowerCase());
    if (!e) return undefined;
    try {
      return await this.fs.readFile(e.path);
    } catch {
      return undefined;
    }
  }

  async listFiles(): Promise<string[]> {
    return [...(await this.buildIndex()).values()].map((e) => e.name);
  }
}

/** Tries several providers in order (e.g. user fonts, then an AutoCAD Fonts folder, then Windows fonts). */
export class ChainFontProvider implements FontProvider {
  private readonly providers: readonly FontProvider[];

  constructor(providers: readonly FontProvider[]) {
    this.providers = providers;
  }

  async getFile(fileName: string): Promise<Uint8Array | undefined> {
    for (const p of this.providers) {
      const b = await p.getFile(fileName);
      if (b) return b;
    }
    return undefined;
  }

  async listFiles(): Promise<string[]> {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of this.providers) {
      for (const n of (await p.listFiles?.()) ?? []) {
        if (seen.has(n.toLowerCase())) continue;
        seen.add(n.toLowerCase());
        out.push(n);
      }
    }
    return out;
  }

  async findFamily(family: string, style: { bold: boolean; italic: boolean }): Promise<string | undefined> {
    for (const p of this.providers) {
      const f = await p.findFamily?.(family, style);
      if (f) return f;
    }
    return undefined;
  }
}
