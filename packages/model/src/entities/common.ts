/**
 * Entity base properties and the parser registry. Common properties live in the base part
 * (R12, and some third-party files) or in `AcDbEntity` (note 03 §1).
 */
import type { Diagnostics } from "@truedxf/core";
import { type FieldDef, fieldTable, readFields } from "../fields.ts";
import type { DxfRecord } from "../record.ts";

export interface EntityBase {
  /** Parsed type discriminator; "UNKNOWN" for types without a parser (see `dxfType`). */
  readonly type: string;
  /** DXF record type as written (e.g. "LINE", "AECC_…"). */
  readonly dxfType: string;
  /** Document-unique id (entities without handles have one too). */
  readonly id: number;
  /** Handle, "" if absent (R12). */
  readonly handle: string;
  /** Owner handle (advisory; ownership is derived from file position). */
  readonly owner: string;
  readonly layer: string;
  /** Linetype name; "BYLAYER" when absent. */
  readonly linetype: string;
  /** ACI (0 ByBlock, 256 ByLayer, 257 ByEntity). 256 when absent. */
  readonly color: number;
  /** 0xRRGGBB when present (420). Takes precedence over `color` for display. */
  readonly trueColor: number | undefined;
  /** Color-book name (430). */
  readonly colorName: string | undefined;
  /** Raw transparency (440): 0x020000AA alpha, 0x01000000 ByBlock; undefined = ByLayer. */
  readonly transparency: number | undefined;
  /** Lineweight in 1/100 mm; -1 ByLayer (default), -2 ByBlock, -3 Default. */
  readonly lineweight: number;
  readonly linetypeScale: number;
  /** Group 60 = 1: invisible (hidden, e.g. inactive dynamic-block visibility states). */
  readonly invisible: boolean;
  /** Group 67 = 1: entity is in paper space (only meaningful in the ENTITIES section). */
  readonly paperSpace: boolean;
  readonly layoutName: string | undefined;
  readonly plotStyleHandle: string | undefined;
  readonly materialHandle: string | undefined;
  readonly extensionDictionary: string | undefined;
  readonly record: DxfRecord;
}

const ENTITY = ["", "AcDbEntity"];

export const COMMON_FIELDS: readonly FieldDef[] = [
  { name: "layer", code: 8, kind: "name", subclass: ENTITY, def: "0" },
  { name: "linetype", code: 6, kind: "name", subclass: ENTITY, def: "BYLAYER" },
  { name: "color", code: 62, kind: "int", subclass: ENTITY, def: 256 },
  { name: "trueColor", code: 420, kind: "int", subclass: ENTITY },
  { name: "colorName", code: 430, kind: "str", subclass: ENTITY },
  { name: "transparency", code: 440, kind: "int", subclass: ENTITY },
  { name: "lineweight", code: 370, kind: "int", subclass: ENTITY, def: -1 },
  { name: "linetypeScale", code: 48, kind: "num", subclass: ENTITY, def: 1 },
  { name: "invisible", code: 60, kind: "bool", subclass: ENTITY, def: false },
  { name: "paperSpace", code: 67, kind: "bool", subclass: ENTITY, def: false },
  { name: "layoutName", code: 410, kind: "str", subclass: ENTITY },
  { name: "plotStyleHandle", code: 390, kind: "handle", subclass: ENTITY },
  { name: "materialHandle", code: 347, kind: "handle", subclass: ENTITY },
];
const COMMON = fieldTable(COMMON_FIELDS);

export interface ParseContext {
  readonly diagnostics: Diagnostics;
  /** $ACADVER of the document ("AC1009", …). */
  readonly acadver: string;
}

/** Sub-records of complex entities: VERTEX* for POLYLINE, ATTRIB* for INSERT, plus SEQEND. */
export interface ChildRecords {
  readonly children: readonly DxfRecord[];
  readonly seqend: DxfRecord | undefined;
}

export type EntityParser<E extends EntityBase = EntityBase> = (
  rec: DxfRecord,
  base: EntityBase,
  ctx: ParseContext,
  children: ChildRecords | undefined,
) => E;

export function readBase(rec: DxfRecord): EntityBase {
  const f = readFields<Record<string, unknown>>(rec, COMMON);
  const layer = (f.layer as string) || "0";
  const linetype = ((f.linetype as string) || "BYLAYER").trim();
  return {
    type: rec.type,
    dxfType: rec.type,
    id: rec.id,
    handle: rec.handle,
    owner: rec.owner,
    layer,
    linetype,
    color: f.color as number,
    trueColor: f.trueColor as number | undefined,
    colorName: f.colorName as string | undefined,
    transparency: f.transparency as number | undefined,
    lineweight: f.lineweight as number,
    linetypeScale: f.linetypeScale as number,
    invisible: f.invisible as boolean,
    paperSpace: f.paperSpace as boolean,
    layoutName: f.layoutName as string | undefined,
    plotStyleHandle: f.plotStyleHandle as string | undefined,
    materialHandle: f.materialHandle as string | undefined,
    extensionDictionary: rec.extensionDictionary,
    record: rec,
  };
}

/** Parser registry by DXF type name. */
export const ENTITY_PARSERS = new Map<string, EntityParser>();

export function registerEntity<E extends EntityBase>(
  types: string | string[],
  parser: EntityParser<E>,
): void {
  for (const t of Array.isArray(types) ? types : [types])
    ENTITY_PARSERS.set(t, parser as unknown as EntityParser);
}

/** Helper for simple spec-driven entities: base properties + fields from a table. */
export function simpleParser<E extends EntityBase>(type: string, defs: readonly FieldDef[]): EntityParser<E> {
  const table = fieldTable(defs);
  return (rec, base) => readFields<E>(rec, table, { ...base, type } as Record<string, unknown>);
}
