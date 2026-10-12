/**
 * Sequential reader over a list of tag indices, for records whose layout is positional (HATCH
 * boundary paths, MULTILEADER context data, MESH, MLINE …) where the same group code means
 * different things depending on where it appears (note 06 §1.1 "parse positionally").
 */
import type { TagStore } from "@truedxf/core";
import type { DxfRecord } from "./record.ts";
import type { Point2, Point3 } from "./types.ts";

function finite(v: number): number {
    return Number.isFinite(v) ? v : 0;
}

export class TagCursor {
    readonly store: TagStore;
    readonly tags: readonly number[];
    pos: number;

    constructor(store: TagStore, tags: readonly number[], pos = 0) {
        this.store = store;
        this.tags = tags;
        this.pos = pos;
    }

    /** Cursor over the data tags of one subclass (all data tags for records without subclasses). */
    static subclass(rec: DxfRecord, name: string, nth = 0): TagCursor {
        const p = rec.hasSubclasses ? rec.subclass(name, nth) : undefined;
        if (p) return new TagCursor(rec.store, [...rec.partTags(p)]);
        return new TagCursor(rec.store, rec.hasSubclasses ? [] : [...rec.dataTags()]);
    }

    get done(): boolean {
        return this.pos >= this.tags.length;
    }

    /** Code of the current tag, -1 at the end. */
    code(): number {
        return this.peek(0);
    }

    /** Code of the tag `k` positions ahead, -1 past the end. */
    peek(k = 1): number {
        const i = this.tags[this.pos + k];
        return i === undefined ? -1 : this.store.codes[i]!;
    }

    /** Tag index (into the TagStore) of the current tag. */
    get index(): number {
        return this.tags[this.pos] ?? -1;
    }

    skip(n = 1): void {
        this.pos += n;
    }

    str(): string {
        return this.store.str(this.tags[this.pos++]!);
    }

    num(): number {
        return finite(this.store.num(this.tags[this.pos++]!));
    }

    int(): number {
        return finite(this.store.int(this.tags[this.pos++]!));
    }

    bool(): boolean {
        return this.store.bool(this.tags[this.pos++]!);
    }

    handle(): string {
        return this.store.handle(this.tags[this.pos++]!);
    }

    binary(): Uint8Array {
        return this.store.binary(this.tags[this.pos++]!);
    }

    /** True if the current tag is a string tag with exactly this (trimmed) value. */
    isStr(code: number, value: string): boolean {
        return this.code() === code && this.store.str(this.tags[this.pos]!).trim() === value;
    }

    /** Reads a point starting at the current tag (code c): consumes c+10 and c+20 when present. */
    point(): Point3 {
        const code = this.code();
        const x = this.num();
        let y = 0;
        let z = 0;
        if (this.code() === code + 10) {
            y = this.num();
            if (this.code() === code + 20) z = this.num();
        }
        return { x, y, z };
    }

    point2(): Point2 {
        const p = this.point();
        return { x: p.x, y: p.y };
    }

    /** Reads the current tag if it has `code`, else returns `def` without advancing. */
    optNum(code: number, def: number): number {
        return this.code() === code ? this.num() : def;
    }

    optInt(code: number, def: number): number {
        return this.code() === code ? this.int() : def;
    }

    /** Consumes consecutive 310 (or `code`) chunks and concatenates them. */
    chunks(code = 310): Uint8Array {
        const parts: Uint8Array[] = [];
        while (this.code() === code) parts.push(this.binary());
        return concatBytes(parts);
    }
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
    if (parts.length === 1) return parts[0]!;
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}
