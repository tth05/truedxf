/**
 * Fonts of the playground. Lookup order (after the viewer's own files, which come first):
 *
 * 1. the user's fonts folder (e.g. a copy of AutoCAD's Fonts folder), remembered across visits
 *    where the browser supports folder handles (Chromium: File System Access API + IndexedDB);
 *    other browsers pick it with a folder input for the session;
 * 2. the served fonts (`fonts/`: our test fonts and the free stand-in fonts, see
 *    server/fonts.ts and fonts/README.md; in dev also this machine's font folders);
 * 3. the fonts installed on the user's computer, once allowed (Local Font Access API, Chromium);
 * 4. the free stand-in for a missing Windows font (`arial.ttf` → Liberation Sans, `segoeui.ttf` →
 *    Selawik, …).
 *
 * The public site ships no Autodesk or Windows fonts: real drawings get their fonts only from
 * the user's own folder or installed fonts.
 */
import { type AssetLoader, fetchFontLoader } from "@truedxf/viewer";
import { idbDelete, idbGet, idbPut } from "./storage.ts";

const FONT_FILE = /\.(shx|ttf|ttc|otf)$/i;
/** A fonts folder is indexed up to this many files / this depth (a picked drive must not hang the page). */
const MAX_FOLDER_FILES = 20_000;
const MAX_FOLDER_DEPTH = 4;
/** IndexedDB key of the remembered folder handle (storage.ts). */
const FOLDER_KEY = "fonts-folder";

/**
 * Windows fonts → their metric-compatible free stand-ins (lower-case file names): Liberation for
 * the core fonts, Selawik for Segoe UI (no italics: the upright face stands in).
 */
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
    "segoeui.ttf": "selawk.ttf",
    "segoeuib.ttf": "selawkb.ttf",
    "segoeuii.ttf": "selawk.ttf",
    "segoeuiz.ttf": "selawkb.ttf",
    "segoeuil.ttf": "selawkl.ttf",
    "seguili.ttf": "selawkl.ttf",
    "segoeuisl.ttf": "selawksl.ttf",
    "seguisli.ttf": "selawksl.ttf",
    "seguisb.ttf": "selawksb.ttf",
    "seguisbi.ttf": "selawksb.ttf",
};

/**
 * Folder → served fonts → installed fonts → free stand-ins. The viewer's default fallback list
 * for missing fonts (simplex.shx, txt.shx, arial.ttf, …) thereby ends in Liberation Sans on the
 * public site.
 */
export function fontLoader(
    folder: Pick<FontFolder, "read">,
    installed: Pick<InstalledFonts, "read">,
    served: AssetLoader = fetchFontLoader("fonts/"),
): AssetLoader {
    return async (name) => {
        const key = name.toLowerCase();
        const alias = FONT_ALIASES[key];
        return (
            (await folder.read(key)) ??
            (await served(key)) ??
            (await installed.read(key)) ??
            (alias !== undefined ? await served(alias) : undefined)
        );
    };
}

// ---- installed fonts ---------------------------------------------------------------------------

// Local Font Access API members that the DOM lib does not declare (Chromium only).
interface LocalFontData {
    readonly postscriptName: string;
    readonly fullName: string;
    blob(): Promise<Blob>;
}
type QueryLocalFonts = () => Promise<LocalFontData[]>;
/** IndexedDB key: the user turned installed fonts off (they are used by default once permitted). */
const INSTALLED_OFF_KEY = "installed-fonts-off";

/**
 * Windows font files → PostScript names, for files whose name does not spell the PostScript name
 * (`verdana.ttf` → Verdana and `SegoeUI-Bold.ttf` → SegoeUI-Bold match without the table).
 */
const POSTSCRIPT_NAMES: Readonly<Record<string, string>> = {
    "arial.ttf": "ArialMT",
    "arialbd.ttf": "Arial-BoldMT",
    "ariali.ttf": "Arial-ItalicMT",
    "arialbi.ttf": "Arial-BoldItalicMT",
    "arialn.ttf": "ArialNarrow",
    "arialnb.ttf": "ArialNarrow-Bold",
    "arialni.ttf": "ArialNarrow-Italic",
    "arialnbi.ttf": "ArialNarrow-BoldItalic",
    "ariblk.ttf": "Arial-Black",
    "times.ttf": "TimesNewRomanPSMT",
    "timesbd.ttf": "TimesNewRomanPS-BoldMT",
    "timesi.ttf": "TimesNewRomanPS-ItalicMT",
    "timesbi.ttf": "TimesNewRomanPS-BoldItalicMT",
    "cour.ttf": "CourierNewPSMT",
    "courbd.ttf": "CourierNewPS-BoldMT",
    "couri.ttf": "CourierNewPS-ItalicMT",
    "courbi.ttf": "CourierNewPS-BoldItalicMT",
    "calibrib.ttf": "Calibri-Bold",
    "calibrii.ttf": "Calibri-Italic",
    "calibriz.ttf": "Calibri-BoldItalic",
    "calibril.ttf": "Calibri-Light",
    "calibrili.ttf": "Calibri-LightItalic",
    "cambriab.ttf": "Cambria-Bold",
    "cambriai.ttf": "Cambria-Italic",
    "cambriaz.ttf": "Cambria-BoldItalic",
    "candarab.ttf": "Candara-Bold",
    "candarai.ttf": "Candara-Italic",
    "candaraz.ttf": "Candara-BoldItalic",
    "consola.ttf": "Consolas",
    "consolab.ttf": "Consolas-Bold",
    "consolai.ttf": "Consolas-Italic",
    "consolaz.ttf": "Consolas-BoldItalic",
    "corbelb.ttf": "Corbel-Bold",
    "corbeli.ttf": "Corbel-Italic",
    "corbelz.ttf": "Corbel-BoldItalic",
    "constan.ttf": "Constantia",
    "constanb.ttf": "Constantia-Bold",
    "constani.ttf": "Constantia-Italic",
    "constanz.ttf": "Constantia-BoldItalic",
    "segoeuib.ttf": "SegoeUI-Bold",
    "segoeuii.ttf": "SegoeUI-Italic",
    "segoeuiz.ttf": "SegoeUI-BoldItalic",
    "segoeuil.ttf": "SegoeUI-Light",
    "seguili.ttf": "SegoeUI-LightItalic",
    "segoeuisl.ttf": "SegoeUI-Semilight",
    "seguisli.ttf": "SegoeUI-SemilightItalic",
    "seguisb.ttf": "SegoeUI-Semibold",
    "seguisbi.ttf": "SegoeUI-SemiboldItalic",
    "seguibl.ttf": "SegoeUIBlack",
    "seguibli.ttf": "SegoeUIBlack-Italic",
    "verdanab.ttf": "Verdana-Bold",
    "verdanai.ttf": "Verdana-Italic",
    "verdanaz.ttf": "Verdana-BoldItalic",
    "tahomabd.ttf": "Tahoma-Bold",
    "georgiab.ttf": "Georgia-Bold",
    "georgiai.ttf": "Georgia-Italic",
    "georgiaz.ttf": "Georgia-BoldItalic",
    "trebuc.ttf": "TrebuchetMS",
    "trebucbd.ttf": "TrebuchetMS-Bold",
    "trebucit.ttf": "TrebuchetMS-Italic",
    "trebucbi.ttf": "Trebuchet-BoldItalic",
    "comic.ttf": "ComicSansMS",
    "comicbd.ttf": "ComicSansMS-Bold",
    "comici.ttf": "ComicSansMS-Italic",
    "comicz.ttf": "ComicSansMS-BoldItalic",
    "lucon.ttf": "LucidaConsole",
    "l_10646.ttf": "LucidaSansUnicode",
    "micross.ttf": "MicrosoftSansSerif",
    "pala.ttf": "PalatinoLinotype-Roman",
    "palab.ttf": "PalatinoLinotype-Bold",
    "palai.ttf": "PalatinoLinotype-Italic",
    "palabi.ttf": "PalatinoLinotype-BoldItalic",
    "framd.ttf": "FranklinGothic-Medium",
    "framdit.ttf": "FranklinGothic-MediumItalic",
    "gadugib.ttf": "Gadugi-Bold",
    "symbol.ttf": "SymbolMT",
    "wingding.ttf": "Wingdings-Regular",
    "msyh.ttc": "MicrosoftYaHei",
    "msyhbd.ttc": "MicrosoftYaHei-Bold",
    "msjh.ttc": "MicrosoftJhengHeiRegular",
    "msjhbd.ttc": "MicrosoftJhengHeiBold",
    "malgun.ttf": "MalgunGothic",
    "malgunbd.ttf": "MalgunGothicBold",
    "msgothic.ttc": "MS-Gothic",
    "yugothm.ttc": "YuGothic-Medium",
};

const TRUETYPE_FILE = /\.(ttf|ttc|otf)$/i;
/** Lower-case, without spaces (PostScript and full names compare like file base names). */
const compact = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export type InstalledFontsState =
    /** The browser cannot read installed fonts (Local Font Access API: Chromium desktop only). */
    | "unsupported"
    /** Not in use (never allowed, or turned off). */
    | "none"
    /** The user refused the permission (site settings → Fonts). */
    | "denied"
    /** Fonts available. */
    | "ready";

/**
 * The fonts installed on the user's computer (Segoe UI, Verdana, Arial, …), read with the Local
 * Font Access API after the user allows it. Nothing leaves the browser. Font files are matched to
 * the installed faces by PostScript name. `onChange` fires after every change of the available fonts.
 */
export class InstalledFonts {
    state: InstalledFontsState;
    onChange: () => void = () => {};
    /** Compact PostScript and full names → face. */
    private faces = new Map<string, LocalFontData>();
    private bytes = new Map<LocalFontData, Promise<Uint8Array | undefined>>();
    private count_ = 0;

    constructor() {
        this.state = this.query ? "none" : "unsupported";
    }

    /** Number of installed font faces. */
    get count(): number {
        return this.count_;
    }

    private get query(): QueryLocalFonts | undefined {
        const q = (globalThis as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
        return typeof q === "function" ? q.bind(globalThis) : undefined;
    }

    /** Bytes of an installed font for a TrueType file name (lower-case base name). */
    async read(name: string): Promise<Uint8Array | undefined> {
        if (this.state !== "ready" || !TRUETYPE_FILE.test(name)) return undefined;
        const base = compact(name.replace(TRUETYPE_FILE, ""));
        const known = POSTSCRIPT_NAMES[name];
        const face =
            (known !== undefined ? this.faces.get(compact(known)) : undefined) ??
            this.faces.get(base) ??
            this.faces.get(base.replace(/-regular$/, ""));
        if (!face) return undefined;
        let p = this.bytes.get(face);
        if (!p) {
            p = face
                .blob()
                .then(async (b) => new Uint8Array(await b.arrayBuffer()))
                .catch(() => undefined);
            this.bytes.set(face, p);
        }
        return p;
    }

    /** Start-up: uses the installed fonts when the permission persisted and the user did not turn them off. */
    async restore(): Promise<void> {
        if (this.state === "unsupported" || (await idbGet<boolean>(INSTALLED_OFF_KEY))) return;
        let permission: PermissionState | undefined;
        try {
            permission = (await navigator.permissions.query({ name: "local-fonts" as PermissionName })).state;
        } catch {
            return; // the browser does not know the permission
        }
        // "denied" stays quiet until the user asks for the fonts (enable → the hint)
        if (permission === "granted") await this.load();
    }

    /** Asks for the permission and uses the installed fonts (must run in a click handler). */
    async enable(): Promise<void> {
        await idbDelete(INSTALLED_OFF_KEY);
        await this.load();
    }

    /** Stops using the installed fonts (also on the next visit). */
    async disable(): Promise<void> {
        await idbPut(INSTALLED_OFF_KEY, true);
        this.faces = new Map();
        this.bytes = new Map();
        this.count_ = 0;
        this.setState("none");
    }

    private async load(): Promise<void> {
        const query = this.query;
        if (!query) return;
        let list: LocalFontData[];
        try {
            list = await query();
        } catch {
            // refused (NotAllowedError / SecurityError)
            this.setState("denied");
            return;
        }
        const faces = new Map<string, LocalFontData>();
        // PostScript names first: they are unique; full names only fill gaps
        for (const f of list)
            if (!faces.has(compact(f.postscriptName))) faces.set(compact(f.postscriptName), f);
        for (const f of list) if (!faces.has(compact(f.fullName))) faces.set(compact(f.fullName), f);
        this.faces = faces;
        this.bytes = new Map();
        this.count_ = list.length;
        // an empty list is what browsers return when the permission was refused
        this.setState(list.length ? "ready" : "denied");
    }

    private setState(state: InstalledFontsState): void {
        this.state = state;
        this.onChange();
    }
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
