/**
 * HEADER section: `(9, $NAME)` followed by one value tag or a point (10/20[/30]).
 * See research/notes/01-file-format.md §7.
 */
import { isPointCode, type SectionInfo, type TagStore, ValueKind, valueKind } from "@truedxf/core";
import type { Point3 } from "./types.ts";

export type HeaderValue = string | number | boolean | bigint | Point3;

export class Header {
    private readonly store: TagStore;
    /** Upper-cased variable name → [first value tag, end). First occurrence wins. */
    private readonly ranges = new Map<string, [number, number]>();
    private readonly cache = new Map<string, HeaderValue>();

    constructor(store: TagStore, section: SectionInfo | undefined) {
        this.store = store;
        if (!section) return;
        let name: string | undefined;
        let first = 0;
        const flush = (end: number) => {
            if (name && !this.ranges.has(name) && end > first) this.ranges.set(name, [first, end]);
        };
        for (let i = section.start; i < section.end; i++) {
            if (store.codes[i] === 9) {
                flush(i);
                name = store.str(i).trim().toUpperCase();
                first = i + 1;
            }
        }
        flush(section.end);
    }

    has(name: string): boolean {
        return this.ranges.has(name.toUpperCase());
    }

    names(): string[] {
        return [...this.ranges.keys()];
    }

    /** Tag range of the variable's value(s), for lossless access. */
    range(name: string): [number, number] | undefined {
        return this.ranges.get(name.toUpperCase());
    }

    get(name: string): HeaderValue | undefined {
        const key = name.toUpperCase();
        const cached = this.cache.get(key);
        if (cached !== undefined) return cached;
        const r = this.ranges.get(key);
        if (!r) return undefined;
        const v = this.decode(r[0], r[1]);
        if (v !== undefined) this.cache.set(key, v);
        return v;
    }

    private decode(start: number, end: number): HeaderValue | undefined {
        const s = this.store;
        const code = s.codes[start]!;
        if (isPointCode(code)) {
            let x = 0;
            let y = 0;
            let z = 0;
            for (let i = start; i < end; i++) {
                const c = s.codes[i]!;
                const v = s.num(i);
                if (c === code) x = v;
                else if (c === code + 10) y = v;
                else if (c === code + 20) z = v;
            }
            return { x, y, z };
        }
        const kind = valueKind(code);
        switch (kind) {
            case ValueKind.Double:
            case ValueKind.Int16:
            case ValueKind.Int32:
                return s.num(start);
            case ValueKind.Int64:
                return s.bigint(start);
            case ValueKind.Bool:
                return s.bool(start);
            case ValueKind.Handle:
                return s.handle(start);
            default:
                return s.str(start);
        }
    }

    num(name: string, def: number): number {
        const v = this.get(name);
        if (typeof v === "number") return Number.isNaN(v) ? def : v;
        if (typeof v === "boolean") return v ? 1 : 0;
        if (typeof v === "bigint") return Number(v);
        return def;
    }

    str(name: string, def: string): string {
        const v = this.get(name);
        return typeof v === "string" ? v : v === undefined ? def : String(v);
    }

    bool(name: string, def: boolean): boolean {
        const v = this.get(name);
        if (typeof v === "boolean") return v;
        if (typeof v === "number") return v !== 0;
        return def;
    }

    point(name: string, def: Point3): Point3 {
        const v = this.get(name);
        return typeof v === "object" ? v : def;
    }
}
