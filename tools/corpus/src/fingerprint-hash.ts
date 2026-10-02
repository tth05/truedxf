import { createHash, type Hash } from "node:crypto";
import type { DxfDocument } from "@truedxf/model";
import type { DisplayList } from "@truedxf/render";

const SKIP = new Set(["record", "endRecord", "store", "tags"]);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Framed tokens prevent ambiguity; bytes go straight to SHA rather than a giant JSON string. */
class Walker {
  readonly hash: Hash = createHash("sha256");
  readonly seen = new Map<object, number>();
  readonly references: boolean;
  readonly seed: Walker | undefined;
  readonly baseIndex: number;
  constructor(seed?: Walker, references = true) {
    this.seed = seed;
    this.baseIndex = seed ? seed.baseIndex + seed.seen.size : 0;
    this.references = references;
  }
  index(value: object): number | undefined {
    return this.seen.get(value) ?? this.seed?.index(value);
  }
  token(type: string, value = ""): void {
    this.hash.update(`${type}${Buffer.byteLength(value)}:`).update(value);
  }
  sortKey(value: unknown): string {
    // A read-only parent overlay avoids copying the whole visited graph for every XDATA Map.
    const walker = new Walker(this);
    walker.walk(value);
    return walker.hash.digest("hex");
  }
  walk(value: unknown): void {
    if (value === undefined) return;
    if (value === null) {
      this.token("null");
      return;
    }
    if (typeof value === "number") {
      this.token("number", Object.is(value, -0) ? "-0" : String(value));
      return;
    }
    if (typeof value === "string") {
      this.token("string", value);
      return;
    }
    if (typeof value === "bigint") {
      this.token("bigint", String(value));
      return;
    }
    if (typeof value === "boolean") {
      this.token("boolean", String(value));
      return;
    }
    // Dictionary objects expose methods alongside parsed fields. Functions contain no model data.
    if (typeof value !== "object") return;
    const prior = this.references ? this.index(value) : undefined;
    if (prior !== undefined) {
      this.token("ref", `#${prior}`);
      return;
    }
    if (this.references) this.seen.set(value, this.baseIndex + this.seen.size);
    if (ArrayBuffer.isView(value)) {
      this.token(value.constructor.name, String(value.byteLength));
      this.hash.update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    } else if (value instanceof ArrayBuffer) {
      this.token("ArrayBuffer", String(value.byteLength));
      this.hash.update(new Uint8Array(value));
    } else if (Array.isArray(value)) {
      this.token("array");
      for (const item of value) this.walk(item);
      this.token("end");
    } else if (value instanceof Map) {
      this.token("map");
      const entries = [...value]
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => ({ k, v, order: this.sortKey([k, v]) }));
      entries.sort((a, b) => compare(a.order, b.order));
      for (const { k, v } of entries) {
        this.walk(k);
        this.walk(v);
      }
      this.token("end");
    } else if (value instanceof Set) {
      this.token("set");
      const entries = [...value].map((v) => ({ v, order: this.sortKey(v) }));
      entries.sort((a, b) => compare(a.order, b.order));
      for (const { v } of entries) this.walk(v);
      this.token("end");
    } else {
      this.token("object");
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj).sort()) {
        if (SKIP.has(key) || obj[key] === undefined || typeof obj[key] === "function") continue;
        this.token("key", key);
        this.walk(obj[key]);
      }
      this.token("end");
    }
  }
}

export function fingerprint(value: unknown, references = true): string {
  const walker = new Walker(undefined, references);
  walker.walk(value);
  return walker.hash.digest("hex").slice(0, 16);
}

export function modelFingerprint(doc: DxfDocument): { hash: string; entities: number } {
  // Header is deliberately omitted: it is a view over the raw store, rather than parsed fields.
  return {
    hash: fingerprint({
      acadver: doc.acadver,
      tables: doc.tables,
      blocks: doc.blocks,
      layouts: doc.layouts,
      objects: doc.objects,
      classes: doc.classes,
      diagnostics: doc.diagnostics.summary(),
    }),
    entities: doc.blocks.reduce((n, block) => n + block.entities.length, 0),
  };
}

export interface Shape {
  batches: number;
  vertices: number;
  counts: string;
  structure: string;
}

export function shape(list: DisplayList): Shape {
  const counts = list.batches.map((b) => b.positions.length / 2);
  return {
    batches: counts.length,
    vertices: counts.reduce((a, b) => a + b, 0),
    counts: fingerprint(counts),
    structure: fingerprint(list.batches.map((b) => [b.kind, b.positions.length / 2])),
  };
}
