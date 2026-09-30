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
 * following Y (code+10) and, for p3, Z (code+20) tags when present.
 */
export function readValueAt(
  rec: DxfRecord,
  tags: readonly number[],
  k: number,
  kind: FieldKind,
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
        }
      }
      return [kind === "p2" ? { x, y } : { x, y, z }, n];
    }
  }
}

/** Compiled lookup: code → definitions in order. */
export interface FieldTable {
  readonly defs: readonly FieldDef[];
  readonly byCode: ReadonlyMap<number, readonly FieldDef[]>;
}

export function fieldTable(defs: readonly FieldDef[]): FieldTable {
  const byCode = new Map<number, FieldDef[]>();
  for (const d of defs) {
    let l = byCode.get(d.code);
    if (!l) byCode.set(d.code, (l = []));
    l.push(d);
  }
  return { defs, byCode };
}

function matchesSubclass(def: FieldDef, subclass: string, strict: boolean): boolean {
  if (!strict || def.subclass === undefined) return true;
  if (typeof def.subclass === "string") return def.subclass === subclass;
  return def.subclass.includes(subclass);
}

/**
 * Reads fields into a plain object. Unmatched tags are ignored (they remain in the record for
 * round-tripping). Returns the object with defaults applied for absent single fields.
 */
export function readFields<T>(rec: DxfRecord, table: FieldTable, into: Record<string, unknown> = {}): T {
  const strict = rec.hasSubclasses;
  const filled = new Set<FieldDef>();
  const codes = rec.store.codes;
  for (const part of rec.parts) {
    if (part.kind !== 0 && part.kind !== 1) continue;
    const subclass = part.kind === 0 ? "" : part.name;
    const tags = [...rec.partTags(part)];
    for (let k = 0; k < tags.length; ) {
      const defs = table.byCode.get(codes[tags[k]!]!);
      let def: FieldDef | undefined;
      if (defs) {
        for (const d of defs) {
          if (!matchesSubclass(d, subclass, strict)) continue;
          if (d.many || !filled.has(d)) {
            def = d;
            break;
          }
        }
      }
      if (!def) {
        k++;
        continue;
      }
      const [v, n] = readValueAt(rec, tags, k, def.kind);
      k += n;
      if (def.many) {
        let arr = into[def.name] as Value[] | undefined;
        if (!arr) into[def.name] = arr = [];
        arr.push(v);
      } else {
        into[def.name] = v;
        filled.add(def);
      }
    }
  }
  for (const d of table.defs) {
    if (d.many) into[d.name] ??= [];
    else if (!(d.name in into) && d.def !== undefined) into[d.name] = d.def;
  }
  return into as T;
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
