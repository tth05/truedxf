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
  #hasSubclasses = false;
  #hasProxyGraphics = false;
  #hasMisplacedCommon = false;
  #handleIndex = -1;
  #ownerIndex = -1;
  #handle: string | undefined;
  #owner: string | undefined;

  constructor(store: TagStore, start: number, end: number, id: number) {
    this.store = store;
    this.start = start;
    this.end = end;
    this.id = id;
  }

  /** Record type (value of the code-0 tag), trimmed and upper-cased. */
  get type(): string {
    this._type ??= this.store.str(this.start).trim().toUpperCase();
    return this._type;
  }

  get parts(): RecordPart[] {
    this._parts ??= this.computeParts();
    return this._parts;
  }

  /** True if the record has at least one subclass marker (R13+ structure). */
  get hasSubclasses(): boolean {
    this.parts;
    return this.#hasSubclasses;
  }

  /** Conservative presence flags computed during the structural scan. */
  get hasProxyGraphics(): boolean {
    this.parts;
    return this.#hasProxyGraphics;
  }

  get hasMisplacedCommon(): boolean {
    this.parts;
    return this.#hasMisplacedCommon;
  }

  private computeParts(): RecordPart[] {
    const s = this.store;
    const type = this.type;
    const isXrecord = type === "XRECORD";
    const handleCode = type === "DIMSTYLE" ? 105 : 5;
    let cur: RecordPart = { kind: PartKind.Base, name: "", start: this.start + 1, end: this.end };
    const parts: RecordPart[] = [cur];
    for (let i = this.start + 1; i < this.end; i++) {
      const code = s.codes[i]!;
      if (cur.kind === PartKind.Base) {
        if (code === handleCode && this.#handleIndex < 0) this.#handleIndex = i;
        if (code === 330 && this.#ownerIndex < 0) this.#ownerIndex = i;
      }
      if (cur.kind === PartKind.Base || cur.kind === PartKind.Subclass) {
        if (code === 310) this.#hasProxyGraphics = true;
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
              this.#hasMisplacedCommon = true;
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
        name = s.str(i).trim();
        this.#hasSubclasses = true;
      } else if (code === 101 && cur.kind !== PartKind.Embedded && s.str(i).trim() === "Embedded Object") {
        kind = PartKind.Embedded;
        name = "";
      } else if (code === 102 && !(isXrecord && cur.kind === PartKind.Subclass)) {
        // XRECORD payload 102 is ordinary data (note 01 section 6.2).
        const v = s.str(i).trim();
        if (!v.startsWith("{")) continue;
        let j = i + 1;
        while (j < this.end && s.codes[j] !== 102 && s.codes[j] !== 0) j++;
        parts.push({ kind: PartKind.AppData, name: v.slice(1), start: i + 1, end: j });
        this.appRanges.push(i, Math.min(j + 1, this.end));
        i = j;
        continue;
      } else continue;
      cur.end = i;
      cur = { kind, name, start: i + 1, end: this.end };
      // Append the enclosing part before any app-data children: already in source order.
      parts.push(cur);
    }
    cur.end = this.end;
    return parts;
  }

  /** Pairs [from, to) of tag ranges covered by 102 groups including their brace tags. */
  private readonly appRanges: number[] = [];

  /** Next data tag index ≥ i that is not inside an app-data group. */
  nextDataTag(i: number): number {
    if (!this._parts) this.parts;
    const r = this.appRanges;
    for (let k = 0; k < r.length; k += 2) if (i >= r[k]! && i < r[k + 1]!) return r[k + 1]!;
    return i;
  }

  /** Handle (code 5 in the base part; 105 for DIMSTYLE). "" if absent. */
  get handle(): string {
    this.parts;
    return (this.#handle ??= this.#handleIndex < 0 ? "" : this.store.handle(this.#handleIndex));
  }

  /** Owner handle (the 330 in the base part outside app data). "" if absent. Advisory only. */
  get owner(): string {
    this.parts;
    return (this.#owner ??= this.#ownerIndex < 0 ? "" : this.store.handle(this.#ownerIndex));
  }

  appData(name: string): RecordPart | undefined {
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
      for (let i = p.start; i < p.end; i++) if (this.store.codes[i] === 330) out.push(this.store.handle(i));
    return out;
  }

  subclass(name: string, nth = 0): RecordPart | undefined {
    let k = 0;
    for (const p of this.parts) if (p.kind === PartKind.Subclass && p.name === name && k++ === nth) return p;
    return undefined;
  }

  get embedded(): RecordPart | undefined {
    return this.parts.find((p) => p.kind === PartKind.Embedded);
  }

  /** XDATA group for an APPID (case-insensitive). */
  xdata(appId: string): RecordPart | undefined {
    const key = appId.toUpperCase();
    return this.parts.find((p) => p.kind === PartKind.XData && p.name.toUpperCase() === key);
  }

  get xdataAppIds(): string[] {
    return this.parts.filter((p) => p.kind === PartKind.XData).map((p) => p.name);
  }

  /** Tag indices of the data parts (base + subclasses), in order, excluding app data / xdata. */
  *dataTags(): Generator<number> {
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
