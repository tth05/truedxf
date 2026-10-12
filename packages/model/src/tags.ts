/**
 * Generic typed tag access for any record: data tags, XDATA groups, XRECORD payloads and the
 * `1002 { … }` lists inside XDATA (e.g. `ACAD` / `DSTYLE`, note 05 §3). Values are typed by group
 * code (note 01 §1.2); point codes are joined with their +10/+20 companions.
 */
import { isPointCode, type TagStore } from "@truedxf/core";
import { type DxfRecord, PartKind, type RecordPart } from "./record.ts";
import type { Point3 } from "./types.ts";

export type TagValue = string | number | bigint | boolean | Uint8Array | Point3;

export interface TypedTag {
    readonly code: number;
    readonly value: TagValue;
    /** Tag index in the TagStore of the (first) tag. */
    readonly index: number;
}

function typedValue(store: TagStore, i: number): string | number | bigint | boolean | Uint8Array {
    const v = store.value(i);
    return typeof v === "number" && !Number.isFinite(v) ? 0 : v;
}

/** Converts tag indices to typed tags, joining points (c, c+10[, c+20]) into one Point3 tag. */
export function typedTags(store: TagStore, indices: Iterable<number>, joinPoints = true): TypedTag[] {
    const list = Array.isArray(indices) ? (indices as number[]) : [...indices];
    const out: TypedTag[] = [];
    const codes = store.codes;
    for (let k = 0; k < list.length; k++) {
        const i = list[k]!;
        const code = codes[i]!;
        if (joinPoints && isPointCode(code)) {
            const x = store.num(i);
            let y = 0;
            let z = 0;
            const j = list[k + 1];
            if (j !== undefined && codes[j] === code + 10) {
                y = store.num(j);
                k++;
                const l = list[k + 1];
                if (l !== undefined && codes[l] === code + 20) {
                    z = store.num(l);
                    k++;
                }
            }
            const f = (n: number) => (Number.isFinite(n) ? n : 0);
            out.push({ code, value: { x: f(x), y: f(y), z: f(z) }, index: i });
        } else {
            out.push({ code, value: typedValue(store, i), index: i });
        }
    }
    return out;
}

export interface RecordTagsOptions {
    /** "data" (default): base + subclass parts; "all": every tag after the (0, TYPE) tag. */
    readonly scope?: "data" | "all";
    /** Restrict to one subclass (ignored for records without subclass markers). */
    readonly subclass?: string;
    readonly joinPoints?: boolean;
}

/** Generic typed-tag accessor for any record (entity, object, table entry). */
export function recordTags(rec: DxfRecord, opts: RecordTagsOptions = {}): TypedTag[] {
    const join = opts.joinPoints ?? true;
    if (opts.scope === "all") {
        const idx: number[] = [];
        for (let i = rec.start + 1; i < rec.end; i++) idx.push(i);
        return typedTags(rec.store, idx, join);
    }
    const idx: number[] = [];
    for (const p of rec.parts) {
        if (p.kind !== PartKind.Base && p.kind !== PartKind.Subclass) continue;
        if (opts.subclass !== undefined && rec.hasSubclasses && p.name !== opts.subclass) continue;
        for (const i of rec.partTags(p)) idx.push(i);
    }
    return typedTags(rec.store, idx, join);
}

/** Typed tags of one record part (e.g. an XDATA group or the embedded object). */
export function partTags(rec: DxfRecord, part: RecordPart, joinPoints = true): TypedTag[] {
    return typedTags(rec.store, rec.partTags(part), joinPoints);
}

/** Typed tags of an XDATA group (without the 1001 tag), or [] if the APPID is absent. */
export function xdataTags(rec: DxfRecord, appId: string): TypedTag[] {
    const p = rec.xdata(appId);
    if (!p) return [];
    const idx: number[] = [];
    for (let i = p.start; i < p.end; i++) idx.push(i);
    return typedTags(rec.store, idx, true);
}

/**
 * The tags inside `1000 <name>` + `1002 {` … matching `1002 }` of an XDATA group (nested lists are
 * included verbatim). Like ezdxf `get_xlist`. undefined if not found.
 */
export function xdataList(tags: readonly TypedTag[], name: string): TypedTag[] | undefined {
    for (let k = 0; k < tags.length - 1; k++) {
        const t = tags[k]!;
        if (t.code !== 1000 || String(t.value).trim().toUpperCase() !== name.toUpperCase()) continue;
        const open = tags[k + 1]!;
        if (open.code !== 1002 || String(open.value).trim() !== "{") continue;
        let depth = 1;
        const out: TypedTag[] = [];
        for (let j = k + 2; j < tags.length; j++) {
            const u = tags[j]!;
            if (u.code === 1002) {
                const v = String(u.value).trim();
                if (v === "{") depth++;
                else if (v === "}" && --depth === 0) return out;
            }
            out.push(u);
        }
        return out; // unterminated: take the rest
    }
    return undefined;
}

/**
 * The tags between `1000 <name>_BEGIN` and `1000 <name>_END` (MTEXT column XDATA, note 04 §3.7).
 * undefined if not found.
 */
export function xdataBeginEnd(tags: readonly TypedTag[], name: string): TypedTag[] | undefined {
    const b = `${name}_BEGIN`.toUpperCase();
    const e = `${name}_END`.toUpperCase();
    const k = tags.findIndex((t) => t.code === 1000 && String(t.value).trim().toUpperCase() === b);
    if (k < 0) return undefined;
    const out: TypedTag[] = [];
    for (let j = k + 1; j < tags.length; j++) {
        const t = tags[j]!;
        if (t.code === 1000 && String(t.value).trim().toUpperCase() === e) break;
        out.push(t);
    }
    return out;
}

/** Numeric value of a typed tag (0 for non-numeric values). */
export function tagNum(t: TypedTag | undefined): number {
    if (!t) return 0;
    const v = t.value;
    if (typeof v === "number") return v;
    if (typeof v === "bigint") return Number(v);
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
        const n = Number(v.trim());
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

/** XRECORD payload: all data tags after the `100 AcDbXrecord` marker, minus the leading 280 cloning flag. */
export function xrecordTags(rec: DxfRecord, joinPoints = false): TypedTag[] {
    const part = rec.hasSubclasses ? rec.subclass("AcDbXrecord") : undefined;
    const idx: number[] = [];
    if (part) for (const i of rec.partTags(part)) idx.push(i);
    else
        for (const i of rec.dataTags()) {
            const c = rec.store.codes[i]!;
            if (c !== 5 && c !== 330 && c !== 100) idx.push(i);
        }
    // R2000+: the first tag is the 280 cloning flag (note 02 §3.5)
    if (idx.length > 0 && rec.store.codes[idx[0]!] === 280) idx.shift();
    return typedTags(rec.store, idx, joinPoints);
}
