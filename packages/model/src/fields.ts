/**
 * Spec-driven field reading: a record's data tags are matched against field definitions by
 * (subclass, group code). Codes that repeat inside a subclass are assigned to the definitions
 * with that code in definition order (ezdxf semantics, note 01 §6.3). Subclass constraints are
 * ignored for records without subclass markers (R12 and many third-party files).
 */
import { decodeUnicodeEscapes } from "@truedxf/core";
import type { DxfRecord } from "./record.ts";
import type { Point2, Point3 } from "./types.ts";

export type FieldKind =
    | "str" // raw string
    | "name" // string with \U+/\M+ escapes decoded (names, keys)
    | "num"
    | "int"
    | "bool"
    | "handle"
    | "p2" // code X, X+10
    | "p3" // code X, X+10, optional X+20 (z defaults to 0)
    | "bigint"
    | "binary";

export interface FieldDef {
    readonly name: string;
    readonly code: number;
    readonly kind: FieldKind;
    /** Subclass marker(s) the field belongs to; "" = base part. Undefined = anywhere. */
    readonly subclass?: string | readonly string[];
    /** Collect all occurrences into an array. */
    readonly many?: boolean;
    /** Value when absent (only for single fields). */
    readonly def?: unknown;
}

type Value = string | number | boolean | bigint | Uint8Array | Point2 | Point3;

function finite(v: number): number {
    return Number.isFinite(v) ? v : 0;
}

/**
 * Reads the value of tag `tags[k]`; returns [value, number of tags consumed]. Points consume the
 * following Y (code+10) and, for p3, Z (code+20) tags when present. With `scan`, a Y/Z that does
 * not follow directly is searched for further on (up to the next X of the same code): old
 * writers interleave coordinates as `10 11 20 21 30 31` (AC1003 files, old QCAD; note 01 §6.3).
 * The out-of-order tags are not reported as consumed; they have no field of their own.
 */
export function readValueAt(
    rec: DxfRecord,
    tags: readonly number[],
    k: number,
    kind: FieldKind,
    scan = false,
): [Value, number] {
    const s = rec.store;
    const i = tags[k]!;
    switch (kind) {
        case "str":
            return [s.str(i), 1];
        case "name":
            return [decodeUnicodeEscapes(s.str(i)), 1];
        case "num":
            return [finite(s.num(i)), 1];
        case "int":
            return [finite(s.int(i)), 1];
        case "bool":
            return [s.bool(i), 1];
        case "handle":
            return [s.handle(i), 1];
        case "bigint":
            return [s.bigint(i), 1];
        case "binary":
            return [s.binary(i), 1];
        case "p2":
        case "p3": {
            const code = s.codes[i]!;
            const x = finite(s.num(i));
            let y = 0;
            let z = 0;
            let n = 1;
            const j = tags[k + 1];
            if (j !== undefined && s.codes[j] === code + 10) {
                y = finite(s.num(j));
                n = 2;
                const l = tags[k + 2];
                if (kind === "p3" && l !== undefined && s.codes[l] === code + 20) {
                    z = finite(s.num(l));
                    n = 3;
                } else if (kind === "p3" && scan) {
                    const m = scanFor(s.codes, tags, k + 2, code + 20, code);
                    if (m >= 0) z = finite(s.num(m));
                }
            } else if (scan) {
                const m = scanFor(s.codes, tags, k + 1, code + 10, code);
                if (m >= 0) {
                    y = finite(s.num(m));
                    const l = kind === "p3" ? scanFor(s.codes, tags, k + 1, code + 20, code) : -1;
                    if (l >= 0) z = finite(s.num(l));
                }
            }
            return [kind === "p2" ? { x, y } : { x, y, z }, n];
        }
    }
}

/** Tag index of the first `code` in tags[from…], stopping at the next `stop` code; -1 if none. */
function scanFor(
    codes: ArrayLike<number>,
    tags: readonly number[],
    from: number,
    code: number,
    stop: number,
): number {
    for (let k = from; k < tags.length; k++) {
        const c = codes[tags[k]!]!;
        if (c === code) return tags[k]!;
        if (c === stop) return -1;
    }
    return -1;
}

/** Compiled lookup: code → definitions in order. */
export interface FieldTable {
    readonly defs: readonly FieldDef[];
    readonly byCode: ReadonlyMap<number, readonly FieldDef[]>;
    /**
     * After the subclass-aware pass, fill still-missing single fields from tags in *other* parts
     * that no field consumed (data before the markers, or in the wrong subclass). Only for types
     * whose codes are unambiguous across subclasses (ezdxf `simple_dxfattribs_loader`, note 01 §6.3).
     */
    readonly lenient: boolean;
}

export function fieldTable(defs: readonly FieldDef[], options: { lenient?: boolean } = {}): FieldTable {
    const byCode = new Map<number, FieldDef[]>();
    for (const d of defs) {
        let l = byCode.get(d.code);
        if (!l) byCode.set(d.code, (l = []));
        l.push(d);
    }
    return { defs, byCode, lenient: options.lenient ?? false };
}

function matchesSubclass(def: FieldDef, subclass: string, strict: boolean): boolean {
    if (!strict || def.subclass === undefined) return true;
    if (typeof def.subclass === "string") return def.subclass === subclass;
    return def.subclass.includes(subclass);
}

/** Write a field directly; return the next data tag after adjacent coordinates. */
export function writeFieldAt(
    rec: DxfRecord,
    i: number,
    end: number,
    def: FieldDef,
    into: Record<string, unknown>,
    scan = false,
): number {
    const s = rec.store;
    let next = rec.nextDataTag(i + 1);
    let value: Value;
    switch (def.kind) {
        case "str":
            value = s.str(i);
            break;
        case "name":
            value = decodeUnicodeEscapes(s.str(i));
            break;
        case "num":
            value = finite(s.num(i));
            break;
        case "int":
            value = finite(s.int(i));
            break;
        case "bool":
            value = s.bool(i);
            break;
        case "handle":
            value = s.handle(i);
            break;
        case "bigint":
            value = s.bigint(i);
            break;
        case "binary":
            value = s.binary(i);
            break;
        case "p2":
        case "p3": {
            const code = s.codes[i]!;
            const x = finite(s.num(i));
            let y = 0;
            let z = 0;
            if (next < end && s.codes[next] === code + 10) {
                y = finite(s.num(next));
                next = rec.nextDataTag(next + 1);
                if (def.kind === "p3" && next < end && s.codes[next] === code + 20) {
                    z = finite(s.num(next));
                    next = rec.nextDataTag(next + 1);
                } else if (def.kind === "p3" && scan) {
                    const m = scanRange(rec, next, end, code + 20, code);
                    if (m >= 0) z = finite(s.num(m));
                }
            } else if (scan) {
                const m = scanRange(rec, next, end, code + 10, code);
                if (m >= 0) {
                    y = finite(s.num(m));
                    const l = def.kind === "p3" ? scanRange(rec, next, end, code + 20, code) : -1;
                    if (l >= 0) z = finite(s.num(l));
                }
            }
            value = def.kind === "p2" ? { x, y } : { x, y, z };
            break;
        }
    }
    if (def.many) {
        let arr = into[def.name] as Value[] | undefined;
        if (!arr) into[def.name] = arr = [];
        arr.push(value);
    } else into[def.name] = value;
    return next;
}

function scanRange(rec: DxfRecord, from: number, end: number, code: number, stop: number): number {
    const codes = rec.store.codes;
    for (let i = from; i < end; i = rec.nextDataTag(i + 1)) {
        if (codes[i] === code) return i;
        if (codes[i] === stop) return -1;
    }
    return -1;
}

interface CompiledDef {
    readonly def: FieldDef;
    readonly index: number;
}
interface CompiledTable {
    readonly low: (readonly CompiledDef[] | undefined)[];
    readonly high: Map<number, readonly CompiledDef[]>;
    readonly subclasses: Set<string>;
    readonly anywhere: boolean;
    readonly count: number;
    readonly pool: Uint8Array[];
}
const compiledTables = new WeakMap<FieldTable, CompiledTable>();

function compile(table: FieldTable): CompiledTable {
    const cached = compiledTables.get(table);
    if (cached) return cached;
    const low = new Array<readonly CompiledDef[] | undefined>(1072).fill(undefined);
    const high = new Map<number, readonly CompiledDef[]>();
    const indices = new Map<FieldDef, number>();
    const subclasses = new Set<string>();
    let anywhere = false;
    for (const [code, defs] of table.byCode) {
        const entries: CompiledDef[] = [];
        for (const def of defs) {
            let index = indices.get(def);
            if (index === undefined) {
                index = indices.size;
                indices.set(def, index);
            }
            entries.push({ def, index });
            if (def.subclass === undefined) anywhere = true;
            else if (typeof def.subclass === "string") subclasses.add(def.subclass);
            else for (const name of def.subclass) subclasses.add(name);
        }
        if (code >= 0 && code < low.length) low[code] = entries;
        else high.set(code, entries);
    }
    const result = { low, high, subclasses, anywhere, count: indices.size, pool: [] as Uint8Array[] };
    compiledTables.set(table, result);
    return result;
}

/**
 * Reads fields into a plain object. Unmatched tags remain in the lossless record.
 * Definition order, first matches, repeated fields, and subclass constraints follow
 * note 01 §6.3. Only adjacent coordinates are consumed; scanned coordinates are not.
 */
export function readFields<T>(rec: DxfRecord, table: FieldTable, into: Record<string, unknown> = {}): T {
    const strict = rec.hasSubclasses;
    const c = compile(table);
    // A pool, rather than one global scratch buffer, also permits recursive reads from setters.
    const filled = c.pool.pop() ?? new Uint8Array(c.count);
    const codes = rec.store.codes;
    const lenient = strict && table.lenient;
    let skipped: number[] | undefined;
    try {
        for (const part of rec.parts) {
            if (part.kind !== 0 && part.kind !== 1) continue;
            const subclass = part.kind === 0 ? "" : part.name;
            if (strict && !lenient && !c.anywhere && !c.subclasses.has(subclass)) continue;
            for (let i = rec.nextDataTag(part.start); i < part.end; ) {
                const code = codes[i]!;
                const defs = code >= 0 && code < c.low.length ? c.low[code] : c.high.get(code);
                let entry: CompiledDef | undefined;
                if (defs)
                    for (const d of defs) {
                        if (matchesSubclass(d.def, subclass, strict) && (d.def.many || !filled[d.index])) {
                            entry = d;
                            break;
                        }
                    }
                if (!entry) {
                    // Store only unmatched starting tags, in part order. Adjacent point components
                    // consumed in the strict pass must never become lenient candidates.
                    if (lenient && defs) (skipped ??= []).push(i, part.end);
                    i = rec.nextDataTag(i + 1);
                    continue;
                }
                i = writeFieldAt(rec, i, part.end, entry.def, into, !entry.def.many);
                if (!entry.def.many) filled[entry.index] = 1;
            }
        }
        // Only the strict pass's unconsumed tags are eligible. Do not consume further
        // candidates here: the old lenient pass also visited each saved starting tag.
        if (skipped)
            for (let k = 0; k < skipped.length; k += 2) {
                const i = skipped[k]!;
                const code = codes[i]!;
                const defs = (code >= 0 && code < c.low.length ? c.low[code] : c.high.get(code))!;
                for (const entry of defs) {
                    if (entry.def.many || filled[entry.index]) continue;
                    writeFieldAt(rec, i, skipped[k + 1]!, entry.def, into, true);
                    filled[entry.index] = 1;
                    break;
                }
            }
        for (const d of table.defs) {
            if (d.many) into[d.name] ??= [];
            else if (!(d.name in into) && d.def !== undefined) into[d.name] = d.def;
        }
        return into as T;
    } finally {
        filled.fill(0);
        c.pool.push(filled);
    }
}

/** All data tags of a record as [code, index] pairs within an optional subclass, in order. */
export function tagsOf(rec: DxfRecord, subclass?: string): number[] {
    const out: number[] = [];
    for (const p of rec.parts) {
        if (p.kind !== 0 && p.kind !== 1) continue;
        if (subclass !== undefined && rec.hasSubclasses && p.name !== subclass) continue;
        for (const i of rec.partTags(p)) out.push(i);
    }
    return out;
}
