/**
 * A DXF record (entity, table entry, object, BLOCK/ENDBLK, CLASS, …) as a view over a tag range
 * of the lossless TagStore. Structure (subclasses, 102 app-data groups, embedded object, XDATA)
 * is computed lazily. See research/notes/01-file-format.md §6.
 */
import { decodeUnicodeEscapes, type TagStore } from "@truedxf/core";

export const PartKind = {
    /** Tags before the first subclass marker (handle, 102 groups, owner, R12 data). */
    Base: 0,
    /** From a `100` marker up to the next marker / embedded object / XDATA. */
    Subclass: 1,
    /** `102 {NAME` … `102 }` (tags between the braces). */
    AppData: 2,
    /** `101 Embedded Object` … (R2018 MTEXT/ATTRIB). */
    Embedded: 3,
    /** One XDATA group: `1001 APPID` and its tags. */
    XData: 4,
} as const;
export type PartKind = (typeof PartKind)[keyof typeof PartKind];

export interface RecordPart {
    kind: PartKind;
    /** Subclass marker, app-data name (without `{`), APPID; "" for base / embedded. */
    name: string;
    /** First tag of the part's content (after the marker tag). */
    start: number;
    /** One past the last content tag. */
    end: number;
}

export interface TagValueView {
    code: number;
    index: number;
}

// Structural names repeat per entity; a store-scoped pool dies with the document.
const names = new WeakMap<TagStore, Map<string, string>>();
// Text/dimension drawing repeatedly reads raw tag overrides. Keeping these small caches
// avoids moving structural scans into the frontend (note 01 section 11).
const FRONTEND_PARTS = new Set([
    "TEXT",
    "ATTRIB",
    "ATTDEF",
    "MTEXT",
    "DIMENSION",
    "LEADER",
    "MULTILEADER",
    "MLEADER",
]);
export function internString(store: TagStore, value: string): string {
    let pool = names.get(store);
    if (!pool) names.set(store, (pool = new Map()));
    const existing = pool.get(value);
    if (existing !== undefined) return existing;
    // Bound overhead for pathological drawings with mostly unique names.
    if (pool.size < 4096) pool.set(value, value);
    return value;
}

export class DxfRecord {
    readonly store: TagStore;
    /** Tag index of the `(0, TYPE)` tag. */
    readonly start: number;
    /** One past the last tag of the record. */
    readonly end: number;
    /** Unique id within the document (records without handles still get one). */
    readonly id: number;
    private _parts: RecordPart[] | undefined;
    private _type: string | undefined;
    // Low byte: presence flags. Two 11-bit offsets keep common handle/owner metadata
    // in one small integer; 2047 means scan the base part for an unusually late tag.
    #flags = 0;
    #handle: string | undefined;

    constructor(store: TagStore, start: number, end: number, id: number) {
        this.store = store;
        this.start = start;
        this.end = end;
        this.id = id;
    }

    /** Record type (value of the code-0 tag), trimmed and upper-cased. */
    get type(): string {
        this._type ??= internString(this.store, this.store.str(this.start).trim().toUpperCase());
        return this._type;
    }

    get parts(): RecordPart[] {
        this._parts ??= this.computeParts();
        return this._parts;
    }

    /** True if the record has at least one subclass marker (R13+ structure). */
    get hasSubclasses(): boolean {
        if (!(this.#flags & 1)) this.parts;
        return !!(this.#flags & 2);
    }

    /** Conservative presence flags computed during the structural scan. */
    get hasProxyGraphics(): boolean {
        if (!(this.#flags & 1)) this.parts;
        return !!(this.#flags & 4);
    }

    get hasMisplacedCommon(): boolean {
        if (!(this.#flags & 1)) this.parts;
        return !!(this.#flags & 8);
    }

    /** Release load-only structural objects; raw SEQEND records retain their enumerable view. */
    releaseParts(): void {
        const type = this.type;
        if (type === "SEQEND" || (this.#flags & 2 && FRONTEND_PARTS.has(type))) return;
        this._parts = undefined;
    }

    private computeParts(): RecordPart[] {
        const s = this.store;
        const type = this.type;
        if (this.appRanges) this.appRanges = undefined;
        if (type === "SEQEND") this.appRanges = [];
        const isXrecord = type === "XRECORD";
        const handleCode = type === "DIMSTYLE" ? 105 : 5;
        let cur: RecordPart = { kind: PartKind.Base, name: "", start: this.start + 1, end: this.end };
        const parts: RecordPart[] = [cur];
        for (let i = this.start + 1; i < this.end; i++) {
            const code = s.codes[i]!;
            if (cur.kind === PartKind.Base) {
                if (code === handleCode && !(this.#flags & (2047 << 8)))
                    this.#flags |= Math.min(i - this.start, 2047) << 8;
                if (code === 330 && !(this.#flags & (2047 << 19)))
                    this.#flags |= Math.min(i - this.start, 2047) << 19;
            }
            if (cur.kind === PartKind.Base || cur.kind === PartKind.Subclass) {
                if (code === 310) this.#flags |= 4;
                if (cur.kind === PartKind.Subclass && cur.name !== "AcDbEntity") {
                    // Recovery candidates from note 01 section 6.3, excluding ambiguous layout code 410.
                    switch (code) {
                        case 8:
                        case 6:
                        case 62:
                        case 420:
                        case 430:
                        case 440:
                        case 370:
                        case 48:
                        case 60:
                        case 67:
                        case 390:
                        case 347:
                            this.#flags |= 8;
                    }
                }
            }
            let kind: PartKind;
            let name: string;
            if (cur.kind === PartKind.XData) {
                if (code !== 1001) continue;
                kind = PartKind.XData;
                name = s.str(i).trim();
            } else if (code === 1001) {
                kind = PartKind.XData;
                name = s.str(i).trim();
            } else if (code === 100 && cur.kind !== PartKind.Embedded) {
                kind = PartKind.Subclass;
                name = internString(s, s.str(i).trim());
                this.#flags |= 2;
            } else if (
                code === 101 &&
                cur.kind !== PartKind.Embedded &&
                s.str(i).trim() === "Embedded Object"
            ) {
                kind = PartKind.Embedded;
                name = "";
            } else if (code === 102 && !(isXrecord && cur.kind === PartKind.Subclass)) {
                // XRECORD payload 102 is ordinary data (note 01 section 6.2).
                const v = s.str(i).trim();
                if (!v.startsWith("{")) continue;
                let j = i + 1;
                while (j < this.end && s.codes[j] !== 102 && s.codes[j] !== 0) j++;
                parts.push({ kind: PartKind.AppData, name: v.slice(1), start: i + 1, end: j });
                this.#flags |= 32;
                (this.appRanges ??= []).push(i, Math.min(j + 1, this.end));
                i = j;
                continue;
            } else continue;
            cur.end = i;
            if (kind === PartKind.Embedded) this.#flags |= 64;
            if (kind === PartKind.XData) this.#flags |= 128;
            cur = { kind, name, start: i + 1, end: this.end };
            // Append the enclosing part before any app-data children: already in source order.
            parts.push(cur);
        }
        cur.end = this.end;
        this.#flags |= 1;
        if (parts.length === 1) this.#flags |= 16;
        return parts;
    }

    /** Pairs [from, to) of tag ranges covered by 102 groups including their brace tags. */
    declare private appRanges: number[] | undefined;

    /** Next data tag index ≥ i that is not inside an app-data group. */
    nextDataTag(i: number): number {
        if (!(this.#flags & 1)) this.parts;
        // Avoid looking up an absent helper property for every ordinary data tag.
        if (!(this.#flags & 32)) return i;
        const r = this.appRanges;
        if (!r) return i;
        for (let k = 0; k < r.length; k += 2) if (i >= r[k]! && i < r[k + 1]!) return r[k + 1]!;
        return i;
    }

    /** Handle (code 5 in the base part; 105 for DIMSTYLE). "" if absent. */
    get handle(): string {
        if (this.#handle !== undefined) return this.#handle;
        if (!(this.#flags & 1)) this.parts;
        const i = this.baseIndex((this.#flags >>> 8) & 2047, this.type === "DIMSTYLE" ? 105 : 5);
        return (this.#handle ??= i < 0 ? "" : this.store.handle(i));
    }

    /** Owner handle (the 330 in the base part outside app data). "" if absent. Advisory only. */
    get owner(): string {
        if (!(this.#flags & 1)) this.parts;
        const i = this.baseIndex((this.#flags >>> 19) & 2047, 330);
        return i < 0 ? "" : internString(this.store, this.store.handle(i));
    }

    private baseIndex(offset: number, code: number): number {
        if (offset === 0) return -1;
        if (offset < 2047) return this.start + offset;
        // App-data owners must not shadow the base owner (note 01 section 6).
        for (const part of this.parts) {
            if (part.kind !== PartKind.Base) continue;
            for (const i of this.partTags(part)) if (this.store.codes[i] === code) return i;
        }
        return -1;
    }

    appData(name: string): RecordPart | undefined {
        if (this.#flags & 1 && !(this.#flags & 32)) return undefined;
        for (const p of this.parts) if (p.kind === PartKind.AppData && p.name === name) return p;
        return undefined;
    }

    /** Handle of the extension dictionary ({ACAD_XDICTIONARY 360). */
    get extensionDictionary(): string | undefined {
        const p = this.appData("ACAD_XDICTIONARY");
        if (!p) return undefined;
        for (let i = p.start; i < p.end; i++) if (this.store.codes[i] === 360) return this.store.handle(i);
        return undefined;
    }

    get reactors(): string[] {
        const p = this.appData("ACAD_REACTORS");
        const out: string[] = [];
        if (p)
            for (let i = p.start; i < p.end; i++)
                if (this.store.codes[i] === 330) out.push(this.store.handle(i));
        return out;
    }

    subclass(name: string, nth = 0): RecordPart | undefined {
        if (this.#flags & 1 && !(this.#flags & 2)) return undefined;
        let k = 0;
        for (const p of this.parts)
            if (p.kind === PartKind.Subclass && p.name === name && k++ === nth) return p;
        return undefined;
    }

    get embedded(): RecordPart | undefined {
        if (this.#flags & 1 && !(this.#flags & 64)) return undefined;
        return this.parts.find((p) => p.kind === PartKind.Embedded);
    }

    /** XDATA group for an APPID (case-insensitive). */
    xdata(appId: string): RecordPart | undefined {
        if (this.#flags & 1 && !(this.#flags & 128)) return undefined;
        const key = appId.toUpperCase();
        return this.parts.find((p) => p.kind === PartKind.XData && p.name.toUpperCase() === key);
    }

    get xdataAppIds(): string[] {
        if (this.#flags & 1 && !(this.#flags & 128)) return [];
        return this.parts.filter((p) => p.kind === PartKind.XData).map((p) => p.name);
    }

    /** Tag indices of the data parts (base + subclasses), in order, excluding app data / xdata. */
    *dataTags(): Generator<number> {
        if (!this._parts && this.#flags & 16) {
            for (let i = this.start + 1; i < this.end; i++) yield i;
            return;
        }
        for (const p of this.parts) {
            if (p.kind !== PartKind.Base && p.kind !== PartKind.Subclass) continue;
            for (let i = this.nextDataTag(p.start); i < p.end; i = this.nextDataTag(i + 1)) yield i;
        }
    }

    /** Data tag indices of one part, skipping app-data groups inside it. */
    *partTags(p: RecordPart): Generator<number> {
        for (let i = this.nextDataTag(p.start); i < p.end; i = this.nextDataTag(i + 1)) yield i;
    }

    /** Index of the first tag with `code` in the data parts, optionally within a subclass. */
    find(code: number, subclass?: string): number {
        // Unqualified lookups need only codes when every part is base/subclass data. In
        // particular, plot-style resolution reads 380 for every entity (note 06 section 6.2);
        // rebuilding released geometry caches here moved load-time work into rendering.
        // Qualified lookups and subclass marker queries still need the full view.
        if (
            !this._parts &&
            (this.#flags & 16 ||
                (this.#flags & 1 &&
                    subclass === undefined &&
                    code !== 100 &&
                    !(this.#flags & (32 | 64 | 128))))
        ) {
            const codes = this.store.codes;
            for (let i = this.start + 1; i < this.end; i++) if (codes[i] === code) return i;
            return -1;
        }
        if (!this._parts && this.#flags & 1 && subclass === undefined && code !== 100) {
            // App ranges survive release, so skip them without allocating parts. Embedded and
            // XDATA markers permanently end ordinary data (note 01 section 6); an unrecognized
            // 101 value is still a data tag, just as in computeParts.
            const s = this.store;
            for (let i = this.nextDataTag(this.start + 1); i < this.end; i = this.nextDataTag(i + 1)) {
                const c = s.codes[i]!;
                if (c === 1001 || (c === 101 && s.str(i).trim() === "Embedded Object")) break;
                if (c === code) return i;
            }
            return -1;
        }
        for (const p of this.parts) {
            if (p.kind !== PartKind.Base && p.kind !== PartKind.Subclass) continue;
            if (subclass !== undefined && this.hasSubclasses && p.name !== subclass) continue;
            for (let i = this.nextDataTag(p.start); i < p.end; i = this.nextDataTag(i + 1))
                if (this.store.codes[i] === code) return i;
        }
        return -1;
    }

    str(code: number, def = "", subclass?: string): string {
        const i = this.find(code, subclass);
        return i < 0 ? def : this.store.str(i);
    }

    num(code: number, def = 0, subclass?: string): number {
        const i = this.find(code, subclass);
        if (i < 0) return def;
        const v = this.store.num(i);
        return Number.isNaN(v) ? def : v;
    }

    /** Decoded name-like string (trimmed of line noise, \U+ escapes decoded). */
    name(code: number, def = "", subclass?: string): string {
        const i = this.find(code, subclass);
        return i < 0 ? def : decodeUnicodeEscapes(this.store.str(i));
    }

    /** Byte range of the record in the source (for lossless pass-through). */
    byteRange(): [number, number] {
        const [a] = this.store.tagByteRange(this.start);
        const b = this.end < this.store.count ? this.store.codeStarts[this.end]! : this.store.end;
        return [a, b];
    }
}
