/**
 * DxfDocument: loads a DXF into the lossless typed model.
 *
 * Ownership is derived from file position (ENTITIES → model space or the active paper space by
 * group 67; BLOCKS → enclosing BLOCK), not from 330 (note 02 §4.2 rule 12).
 */
import { Diagnostics, type DxfTags, type ReadTagsOptions, readTags, type SectionInfo } from "@truedxf/core";
import {
  type ChildRecords,
  ENTITY_PARSERS,
  type Entity,
  type EntityBase,
  type ParseContext,
  readBase,
  SIMPLE_ENTITY_FIELDS,
} from "./entities/index.ts";
import { fieldTable, readFields } from "./fields.ts";
import { Header } from "./header.ts";
import { type DictionaryObject, type DxfObject, type LayoutObject, parseObject } from "./objects.ts";
import { DxfRecord } from "./record.ts";
import {
  type BlockRecordEntry,
  emptyTables,
  TABLE_PARSERS,
  type Table,
  type TableEntry,
  type Tables,
} from "./tables.ts";
import { nameKey, type Point3 } from "./types.ts";

export interface DxfClass {
  readonly dxfName: string;
  readonly cppName: string;
  readonly appName: string;
  readonly proxyFlags: number;
  readonly instanceCount: number;
  readonly wasProxy: boolean;
  readonly isEntity: boolean;
  readonly record: DxfRecord;
}

export interface Block {
  readonly name: string;
  /** Handle of the BLOCK record (not the BLOCK_RECORD). */
  readonly handle: string;
  /** 1 anonymous, 2 has attdefs, 4 xref, 8 xref overlay, 16 external dependent, 32 resolved, 64 referenced. */
  readonly flags: number;
  readonly basePoint: Point3;
  readonly layer: string;
  readonly xrefPath: string;
  readonly description: string;
  readonly blockRecord: BlockRecordEntry | undefined;
  readonly record: DxfRecord | undefined;
  readonly endRecord: DxfRecord | undefined;
  readonly entities: Entity[];
  /** *Model_Space, *Paper_Space*, or the R12 $MODEL_SPACE / $PAPER_SPACE blocks. */
  readonly isLayoutBlock: boolean;
}

export interface Layout {
  readonly name: string;
  readonly isModel: boolean;
  readonly tabOrder: number;
  readonly block: Block;
  /** Undefined for R12 files and files without OBJECTS. */
  readonly object: LayoutObject | undefined;
}

export interface LoadOptions extends ReadTagsOptions {}

const BLOCK = fieldTable([
  { name: "name", code: 2, kind: "name", def: "" },
  { name: "flags", code: 70, kind: "int", def: 0 },
  { name: "basePoint", code: 10, kind: "p3", def: { x: 0, y: 0, z: 0 } },
  { name: "xrefPath", code: 1, kind: "str", def: "" },
  { name: "description", code: 4, kind: "str", def: "" },
  { name: "layer", code: 8, kind: "name", def: "0" },
]);

const CLASS = fieldTable([
  { name: "dxfName", code: 1, kind: "str", def: "" },
  { name: "cppName", code: 2, kind: "str", def: "" },
  { name: "appName", code: 3, kind: "str", def: "" },
  { name: "proxyFlags", code: 90, kind: "int", def: 0 },
  { name: "instanceCount", code: 91, kind: "int", def: 0 },
  { name: "wasProxy", code: 280, kind: "bool", def: false },
  { name: "isEntity", code: 281, kind: "bool", def: false },
]);

export function isModelSpaceName(name: string): boolean {
  const k = nameKey(name);
  return k === "*MODEL_SPACE" || k === "$MODEL_SPACE";
}

export function isPaperSpaceName(name: string): boolean {
  const k = nameKey(name);
  return k.startsWith("*PAPER_SPACE") || k === "$PAPER_SPACE";
}

export class DxfDocument {
  readonly tags: DxfTags;
  readonly diagnostics: Diagnostics;
  readonly header: Header;
  readonly acadver: string;
  readonly classes: DxfClass[] = [];
  readonly tables: Tables = emptyTables();
  readonly blocks: Block[] = [];
  readonly objects: DxfObject[] = [];
  readonly layouts: Layout[] = [];
  /** All records with a handle (entities, table entries, objects, blocks). */
  readonly byHandle = new Map<string, DxfRecord>();
  readonly modelSpace: Block;
  /** The active paper space layout block (*Paper_Space), if any. */
  readonly paperSpace: Block | undefined;

  private readonly blocksByName = new Map<string, Block>();
  private readonly objectsByHandle = new Map<string, DxfObject>();
  private readonly entitiesByHandle = new Map<string, Entity>();
  private nextId = 0;
  private readonly ctx: ParseContext;

  constructor(tags: DxfTags) {
    this.tags = tags;
    this.diagnostics = tags.diagnostics;
    const section = (name: string) => tags.sections.filter((s) => s.name === name);
    this.header = new Header(tags.store, section("HEADER")[0]);
    this.acadver = tags.encoding.acadver ?? "AC1009";
    this.ctx = { diagnostics: this.diagnostics, acadver: this.acadver };

    for (const s of section("CLASSES")) this.loadClasses(s);
    for (const s of section("TABLES")) this.loadTables(s);
    for (const s of section("BLOCKS")) this.loadBlocks(s);
    for (const s of section("OBJECTS")) this.loadObjects(s);

    this.modelSpace = this.findOrCreateLayoutBlock("*Model_Space", "$MODEL_SPACE");
    this.paperSpace = this.getBlock("*Paper_Space") ?? this.getBlock("$PAPER_SPACE");
    for (const s of section("ENTITIES")) this.loadEntitiesSection(s);
    this.buildLayouts();
  }

  static load(bytes: Uint8Array, options: LoadOptions = {}): DxfDocument {
    const diagnostics = options.diagnostics ?? new Diagnostics();
    return new DxfDocument(readTags(bytes, { ...options, diagnostics }));
  }

  // ---- lookups -----------------------------------------------------------------------------

  getBlock(name: string): Block | undefined {
    return this.blocksByName.get(nameKey(name));
  }

  getObject(handle: string): DxfObject | undefined {
    return this.objectsByHandle.get(handle);
  }

  getEntity(handle: string): Entity | undefined {
    return this.entitiesByHandle.get(handle);
  }

  /** The root (named objects) dictionary: the first DICTIONARY in OBJECTS. */
  get rootDictionary(): DictionaryObject | undefined {
    const first = this.objects[0];
    return first?.type === "DICTIONARY" ? (first as DictionaryObject) : undefined;
  }

  /** Entry `key` of the root dictionary, resolved to an object. */
  namedObject(key: string): DxfObject | undefined {
    const h = this.rootDictionary?.get(key);
    return h ? this.getObject(h) : undefined;
  }

  // ---- loading -----------------------------------------------------------------------------

  private records(section: SectionInfo): DxfRecord[] {
    const store = this.tags.store;
    const codes = store.codes;
    const out: DxfRecord[] = [];
    let start = -1;
    // The final sentinel closes the last record without a temporary array of starts.
    for (let i = section.start; i <= section.end; i++) {
      if (i !== section.end && codes[i] !== 0) continue;
      if (start >= 0) {
        const rec = new DxfRecord(store, start, i, this.nextId++);
        const h = rec.handle;
        if (h && h !== "0") {
          if (this.byHandle.has(h))
            this.diagnostics.warn("duplicate-handle", `duplicate handle ${h}`, { tag: rec.start });
          else this.byHandle.set(h, rec);
        }
        out.push(rec);
      }
      start = i;
    }
    return out;
  }

  private loadClasses(section: SectionInfo): void {
    for (const rec of this.records(section)) {
      if (rec.type !== "CLASS") continue;
      this.classes.push({ ...readFields<Omit<DxfClass, "record">>(rec, CLASS), record: rec });
    }
  }

  private loadTables(section: SectionInfo): void {
    let current: Table<TableEntry> | undefined;
    let parser: ((r: DxfRecord) => TableEntry) | undefined;
    for (const rec of this.records(section)) {
      const t = rec.type;
      if (t === "TABLE") {
        const name = rec.str(2).trim().toUpperCase();
        current = this.tableByName(name, rec.handle);
        parser = TABLE_PARSERS[name];
        if (!current) this.diagnostics.info("unknown-table", `unknown table ${name}`, { tag: rec.start });
      } else if (t === "ENDTAB") {
        current = undefined;
      } else if (current) {
        try {
          current.add((parser ?? TABLE_PARSERS.APPID!)(rec));
        } catch (e) {
          this.diagnostics.error("table-entry", `failed to parse ${t}: ${String(e)}`, { tag: rec.start });
        }
      }
    }
  }

  private tableByName(name: string, handle: string): Table<TableEntry> | undefined {
    const t = this.tables;
    const map: Record<string, Table<TableEntry>> = {
      LAYER: t.layers,
      LTYPE: t.linetypes,
      STYLE: t.styles,
      DIMSTYLE: t.dimstyles,
      VPORT: t.vports,
      VIEW: t.views,
      UCS: t.ucs,
      APPID: t.appids,
      BLOCK_RECORD: t.blockRecords,
    };
    const table = map[name];
    if (table && !table.handle && handle) (table as { handle: string }).handle = handle;
    return table;
  }

  private loadBlocks(section: SectionInfo): void {
    const recs = this.records(section);
    let blockRec: DxfRecord | undefined;
    let content: DxfRecord[] = [];
    for (const rec of recs) {
      if (rec.type === "BLOCK") {
        if (blockRec) this.finishBlock(blockRec, content, undefined);
        blockRec = rec;
        content = [];
      } else if (rec.type === "ENDBLK") {
        if (blockRec) this.finishBlock(blockRec, content, rec);
        else this.diagnostics.warn("stray-endblk", "ENDBLK without BLOCK", { tag: rec.start });
        blockRec = undefined;
        content = [];
      } else if (blockRec) {
        content.push(rec);
      } else {
        this.diagnostics.warn("entity-outside-block", `${rec.type} outside of BLOCK`, { tag: rec.start });
      }
    }
    if (blockRec) this.finishBlock(blockRec, content, undefined);
  }

  private finishBlock(rec: DxfRecord, content: DxfRecord[], end: DxfRecord | undefined): void {
    const f = readFields<{
      name: string;
      flags: number;
      basePoint: Point3;
      xrefPath: string;
      description: string;
      layer: string;
    }>(rec, BLOCK);
    const name = f.name || rec.str(3);
    const block: Block = {
      name,
      handle: rec.handle,
      flags: f.flags,
      basePoint: f.basePoint,
      layer: f.layer,
      xrefPath: f.xrefPath,
      description: f.description,
      blockRecord: this.tables.blockRecords.get(name),
      record: rec,
      endRecord: end,
      entities: this.parseEntities(content),
      isLayoutBlock: isModelSpaceName(name) || isPaperSpaceName(name),
    };
    if (!end)
      this.diagnostics.warn("missing-endblk", `block ${name} not terminated by ENDBLK`, { tag: rec.start });
    this.addBlock(block);
  }

  private addBlock(block: Block): void {
    const k = nameKey(block.name);
    const prev = this.blocksByName.get(k);
    if (prev) {
      // AutoCAD merges same-named BLOCKs: name of the first, base point of the second, entities
      // of both (ezdxf experiment, note 07 §1.1). UNVERIFIED (Q-0608)
      this.diagnostics.warn("duplicate-block", `duplicate block ${block.name} (merged)`);
      const merged: Block = {
        ...prev,
        basePoint: block.basePoint,
        entities: [...prev.entities, ...block.entities],
      };
      this.blocksByName.set(k, merged);
      this.blocks[this.blocks.indexOf(prev)] = merged;
      return;
    }
    this.blocksByName.set(k, block);
    this.blocks.push(block);
  }

  private findOrCreateLayoutBlock(name: string, r12Name: string): Block {
    const existing = this.getBlock(name) ?? this.getBlock(r12Name);
    if (existing) return existing;
    const block: Block = {
      name,
      handle: "",
      flags: 0,
      basePoint: { x: 0, y: 0, z: 0 },
      layer: "0",
      xrefPath: "",
      description: "",
      blockRecord: this.tables.blockRecords.get(name),
      record: undefined,
      endRecord: undefined,
      entities: [],
      isLayoutBlock: true,
    };
    this.addBlock(block);
    return block;
  }

  private loadEntitiesSection(section: SectionInfo): void {
    const entities = this.parseEntities(this.records(section));
    let paper: Block | undefined = this.paperSpace;
    for (const e of entities) {
      if (e.paperSpace) {
        paper ??= this.findOrCreateLayoutBlock("*Paper_Space", "$PAPER_SPACE");
        paper.entities.push(e);
      } else {
        this.modelSpace.entities.push(e);
      }
    }
    if (paper && !this.paperSpace) (this as { paperSpace: Block | undefined }).paperSpace = paper;
  }

  private loadObjects(section: SectionInfo): void {
    for (const rec of this.records(section)) {
      let obj: DxfObject;
      try {
        obj = parseObject(rec);
      } catch (e) {
        this.diagnostics.error("object", `failed to parse ${rec.type}: ${String(e)}`, { tag: rec.start });
        obj = {
          type: "UNKNOWN",
          dxfType: rec.type,
          handle: rec.handle,
          owner: rec.owner,
          extensionDictionary: rec.extensionDictionary,
          record: rec,
        };
      }
      this.objects.push(obj);
      if (obj.handle && !this.objectsByHandle.has(obj.handle)) this.objectsByHandle.set(obj.handle, obj);
    }
  }

  /** Parses a record list, grouping POLYLINE+VERTEX*+SEQEND and INSERT+ATTRIB*+SEQEND. */
  parseEntities(recs: readonly DxfRecord[]): Entity[] {
    const out: Entity[] = [];
    for (let k = 0; k < recs.length; k++) {
      const rec = recs[k]!;
      const type = rec.type;
      let children: ChildRecords | undefined;
      if (type === "POLYLINE" || type === "INSERT") {
        const childType = type === "POLYLINE" ? "VERTEX" : "ATTRIB";
        const list: DxfRecord[] = [];
        let j = k + 1;
        while (j < recs.length && recs[j]!.type === childType) list.push(recs[j++]!);
        let seqend: DxfRecord | undefined;
        if (j < recs.length && recs[j]!.type === "SEQEND") {
          // also without 66 / ATTRIBs: a SEQEND directly after an INSERT can only be its own
          seqend = recs[j++];
        } else if (list.length > 0 || type === "POLYLINE") {
          this.diagnostics.warn("missing-seqend", `${type} without SEQEND`, { tag: rec.start });
        }
        children = { children: list, seqend };
        k = j - 1;
      } else if (type === "VERTEX" || type === "ATTRIB" || type === "SEQEND") {
        this.diagnostics.warn("orphan-subentity", `${type} without parent`, { tag: rec.start });
        continue;
      }
      const e = this.parseEntity(rec, children);
      out.push(e);
      if (e.handle && !this.entitiesByHandle.has(e.handle)) this.entitiesByHandle.set(e.handle, e);
    }
    return out;
  }

  private parseEntity(rec: DxfRecord, children: ChildRecords | undefined): Entity {
    let base: EntityBase;
    try {
      base = readBase(rec);
    } catch (e) {
      this.diagnostics.error("entity", `failed to read ${rec.type}: ${String(e)}`, { tag: rec.start });
      base = { ...readBase(new DxfRecord(rec.store, rec.start, rec.start + 1, rec.id)), record: rec };
    }
    const parser = ENTITY_PARSERS.get(rec.type);
    if (!parser) return { ...base, type: "UNKNOWN" };
    const simple = SIMPLE_ENTITY_FIELDS.get(parser);
    try {
      if (simple) {
        // This base has not escaped: extend it directly instead of cloning 21 properties.
        // Calling the registered parser externally still uses its copying public path.
        const into = base as unknown as Record<string, unknown>;
        into.type = simple.type;
        const entity = readFields<Entity>(rec, simple.table, into);
        return (simple.finish ? simple.finish(entity) : entity) as Entity;
      }
      return parser(rec, base, this.ctx, children) as Entity;
    } catch (e) {
      if (simple) {
        // A failed field read can leave partial properties. Rebuild the original base only
        // on this exceptional path so UNKNOWN retains exactly the former fallback shape.
        try {
          base = readBase(rec);
        } catch {
          base = { ...readBase(new DxfRecord(rec.store, rec.start, rec.start + 1, rec.id)), record: rec };
        }
      }
      this.diagnostics.error("entity", `failed to parse ${rec.type}: ${String(e)}`, { tag: rec.start });
      return { ...base, type: "UNKNOWN" };
    }
  }

  private buildLayouts(): void {
    const layoutObjects = this.objects.filter((o): o is LayoutObject => o.type === "LAYOUT");
    const used = new Set<Block>();
    const brByHandle = new Map(this.tables.blockRecords.entries.map((b) => [b.handle, b]));
    const brByLayout = new Map<string, BlockRecordEntry>();
    for (const b of this.tables.blockRecords.entries) if (b.layoutHandle) brByLayout.set(b.layoutHandle, b);
    const linked = new Map<LayoutObject, Block>();
    // 1. LAYOUT 330 → BLOCK_RECORD, 2. BLOCK_RECORD 340 → LAYOUT (template-copied LAYOUTs keep
    // stale 330s, e.g. QGIS exports), 3. Model by name
    for (const lo of layoutObjects) {
      const br =
        (lo.blockRecordHandle ? brByHandle.get(lo.blockRecordHandle) : undefined) ??
        brByLayout.get(lo.handle);
      let block = br ? this.getBlock(br.name) : undefined;
      if (!block && nameKey(lo.name) === "MODEL") block = this.modelSpace;
      if (block && !used.has(block)) {
        linked.set(lo, block);
        used.add(block);
      }
    }
    // 4. remaining paper layouts ↔ unused *Paper_Space* blocks, both in order of appearance
    // (ezdxf's recovery for QGIS files, note 08 §2)
    const spare = this.blocks.filter((b) => isPaperSpaceName(b.name) && !used.has(b));
    for (const lo of layoutObjects) {
      if (linked.has(lo) || nameKey(lo.name) === "MODEL") continue;
      const block = spare.shift();
      if (!block) break;
      this.diagnostics.info("layout-relinked", `layout ${lo.name} linked to ${block.name} by position`);
      linked.set(lo, block);
      used.add(block);
    }
    for (const lo of layoutObjects) {
      const block = linked.get(lo);
      if (!block) {
        this.diagnostics.warn("layout-without-block", `layout ${lo.name} has no block`);
        continue;
      }
      this.layouts.push({
        name: lo.name,
        isModel: block === this.modelSpace,
        tabOrder: lo.tabOrder,
        block,
        object: lo,
      });
    }
    if (!used.has(this.modelSpace)) {
      this.layouts.push({
        name: "Model",
        isModel: true,
        tabOrder: 0,
        block: this.modelSpace,
        object: undefined,
      });
    }
    if (this.paperSpace && !used.has(this.paperSpace)) {
      this.layouts.push({
        name: "Layout1",
        isModel: false,
        tabOrder: 1,
        block: this.paperSpace,
        object: undefined,
      });
    }
    this.layouts.sort((a, b) => a.tabOrder - b.tabOrder);
  }
}

export function loadDxf(bytes: Uint8Array, options: LoadOptions = {}): DxfDocument {
  return DxfDocument.load(bytes, options);
}
