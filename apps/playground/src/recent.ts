/**
 * Recently opened drawings (Chromium only: File System Access API). Drawings opened through the
 * Open dialog, the folder dialog or a drop keep their file handles in IndexedDB (storage.ts), so
 * they reopen with one click on the next visit — together with the fonts, images and shape files
 * opened with them, or their whole folder. Nothing is copied: the browser only remembers which
 * files they were and asks again for permission to read them. Other browsers have no handles:
 * the list stays empty and the ordinary file inputs are used.
 */
import type { FileInput, ViewerFile } from "@truedxf/viewer";
import { idbGet, idbPut } from "./storage.ts";

type Permission = "granted" | "denied" | "prompt";
interface FsHandle {
    readonly kind: "file" | "directory";
    readonly name: string;
    queryPermission?(d: { mode: "read" }): Promise<Permission>;
    requestPermission?(d: { mode: "read" }): Promise<Permission>;
    isSameEntry?(other: FsHandle): Promise<boolean>;
}
export interface FsFileHandle extends FsHandle {
    readonly kind: "file";
    getFile(): Promise<File>;
}
export interface FsDirHandle extends FsHandle {
    readonly kind: "directory";
    values(): AsyncIterable<FsFileHandle | FsDirHandle>;
}
type OpenPicker = (o: { id?: string; multiple?: boolean }) => Promise<FsFileHandle[]>;
type DirPicker = (o: { id?: string; mode?: "read" }) => Promise<FsDirHandle>;

/** Where a drawing came from: files picked together, or a folder. */
export type RecentSource = { files: FsFileHandle[] } | { folder: FsDirHandle };

export interface RecentEntry {
    /** The drawing's file name. */
    name: string;
    /** Its path among the opened files (folder: relative to the folder's parent, like `webkitRelativePath`). */
    path: string;
    size: number;
    /** Date.now() of the last opening. */
    opened: number;
    files?: FsFileHandle[];
    folder?: FsDirHandle;
}

const KEY = "recent-files";
const MAX_ENTRIES = 8;
/** A folder is read up to this many files / this depth (a picked drive must not hang the page). */
const MAX_FOLDER_FILES = 20_000;
const MAX_FOLDER_DEPTH = 6;

const openPicker = () => (window as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker;
const dirPicker = () => (window as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;

export class RecentFiles {
    entries: RecentEntry[] = [];
    onChange: () => void = () => {};

    /** Whether drawings can be remembered (the browser has file handles). */
    get supported(): boolean {
        return typeof openPicker() === "function" && typeof dirPicker() === "function";
    }

    async restore(): Promise<void> {
        if (!this.supported) return;
        const stored = await idbGet<RecentEntry[]>(KEY);
        if (!Array.isArray(stored)) return;
        this.entries = stored.filter((e) => e && typeof e.name === "string" && (e.files?.length || e.folder));
        this.onChange();
    }

    /** The Open dialog with handles. Undefined when cancelled. */
    async pickFiles(): Promise<{ files: FileInput[]; source: RecentSource } | undefined> {
        let handles: FsFileHandle[];
        try {
            handles = await openPicker()!.call(window, { id: "truedxf-open", multiple: true });
        } catch {
            return undefined; // cancelled
        }
        const files = await readFiles(handles);
        return { files, source: { files: handles } };
    }

    /** The folder dialog with a handle. Undefined when cancelled. */
    async pickFolder(): Promise<{ files: FileInput[]; source: RecentSource } | undefined> {
        let dir: FsDirHandle;
        try {
            dir = await dirPicker()!.call(window, { id: "truedxf-open", mode: "read" });
        } catch {
            return undefined;
        }
        return { files: await readFolder(dir), source: { folder: dir } };
    }

    /** Remembers the drawing `opened` (one of the files read from `source`) as the newest entry. */
    async remember(source: RecentSource, opened: ViewerFile): Promise<void> {
        if (!this.supported) return;
        const entry: RecentEntry = {
            name: opened.name,
            path: opened.path,
            size: opened.size,
            opened: Date.now(),
            ...("folder" in source ? { folder: source.folder } : { files: source.files }),
        };
        const kept: RecentEntry[] = [];
        for (const e of this.entries) if (!(await sameDrawing(e, entry))) kept.push(e);
        this.entries = [entry, ...kept].slice(0, MAX_ENTRIES);
        await this.save();
    }

    async remove(entry: RecentEntry): Promise<void> {
        this.entries = this.entries.filter((e) => e !== entry);
        await this.save();
    }

    /**
     * Reads an entry's files again (must run in a click handler: the browser may ask for permission).
     * Undefined when permission was refused; throws when the files are gone.
     */
    async reopen(entry: RecentEntry): Promise<{ files: FileInput[]; drawing: string } | undefined> {
        const handles: FsHandle[] = entry.folder ? [entry.folder] : (entry.files ?? []);
        for (const h of handles) {
            if ((await h.queryPermission?.({ mode: "read" })) === "granted") continue;
            if ((await h.requestPermission?.({ mode: "read" })) !== "granted") return undefined;
        }
        const files = entry.folder ? await readFolder(entry.folder) : await readFiles(entry.files ?? []);
        if (!files.some((f) => f.path === entry.path))
            throw new Error(`${entry.name} is no longer where it was opened from.`);
        return { files, drawing: entry.path };
    }

    private async save(): Promise<void> {
        await idbPut(KEY, this.entries);
        this.onChange();
    }
}

async function sameDrawing(a: RecentEntry, b: RecentEntry): Promise<boolean> {
    if (a.path !== b.path) return false;
    const ha = a.folder ?? a.files?.find((f) => f.name === a.name);
    const hb = b.folder ?? b.files?.find((f) => f.name === b.name);
    if (!ha || !hb || !ha.isSameEntry) return a.name === b.name;
    try {
        return await ha.isSameEntry(hb);
    } catch {
        return false;
    }
}

async function readFiles(handles: readonly FsFileHandle[]): Promise<FileInput[]> {
    const out: FileInput[] = [];
    for (const h of handles) {
        const f = await h.getFile();
        out.push({ name: f.name, data: f, path: f.name });
    }
    return out;
}

/** The folder's files with paths like `webkitRelativePath` (folder name first), sorted. */
async function readFolder(dir: FsDirHandle): Promise<FileInput[]> {
    const out: FileInput[] = [];
    const walk = async (d: FsDirHandle, prefix: string, depth: number): Promise<void> => {
        const children: (FsFileHandle | FsDirHandle)[] = [];
        try {
            for await (const c of d.values()) children.push(c);
        } catch {
            return; // unreadable folder: skip
        }
        children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const c of children) {
            if (out.length >= MAX_FOLDER_FILES) return;
            if (c.kind === "file") {
                try {
                    const f = await c.getFile();
                    out.push({ name: f.name, data: f, path: `${prefix}${f.name}` });
                } catch {
                    // unreadable file: skip
                }
            } else if (depth < MAX_FOLDER_DEPTH) await walk(c, `${prefix}${c.name}/`, depth + 1);
        }
    };
    await walk(dir, `${dir.name}/`, 0);
    return out;
}

/**
 * File handles of a drop, requested synchronously in the drop handler (the items expire after
 * it). Resolves to a source when the drop was a folder or files (not a mix), else undefined.
 */
export function droppedSource(dt: DataTransfer): Promise<RecentSource | undefined> {
    type Item = DataTransferItem & { getAsFileSystemHandle?(): Promise<FsHandle | null> };
    const pending: Promise<FsHandle | null>[] = [];
    for (const item of dt.items as unknown as Iterable<Item>) {
        if (item.kind !== "file" || !item.getAsFileSystemHandle) return Promise.resolve(undefined);
        pending.push(item.getAsFileSystemHandle().catch(() => null));
    }
    if (pending.length === 0) return Promise.resolve(undefined);
    return Promise.all(pending).then((hs) => {
        if (hs.some((h) => !h)) return undefined;
        const handles = hs as FsHandle[];
        if (handles.length === 1 && handles[0]!.kind === "directory")
            return { folder: handles[0] as FsDirHandle };
        if (handles.every((h) => h.kind === "file")) return { files: handles as FsFileHandle[] };
        return undefined;
    });
}

/** "just now", "5 minutes ago", "yesterday", "3 Oct" … for the list. */
export function openedAgo(ms: number, now = Date.now()): string {
    const s = Math.max(0, (now - ms) / 1000);
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    if (s < 60) return "just now";
    if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
    if (s < 86_400) return rtf.format(-Math.round(s / 3600), "hour");
    if (s < 7 * 86_400) return rtf.format(-Math.round(s / 86_400), "day");
    return new Date(ms).toLocaleDateString("en", { day: "numeric", month: "short" });
}
