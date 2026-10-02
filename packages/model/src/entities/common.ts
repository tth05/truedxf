/**
 * Entity base properties and the parser registry. Common properties live in the base part
 * (R12, and some third-party files) or in `AcDbEntity` (note 03 §1).
 */
import type { Diagnostics } from "@truedxf/core";
import { type FieldDef, fieldTable, readFields, writeFieldAt } from "../fields.ts";
import { type DxfRecord, PartKind } from "../record.ts";

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
  /**
   * Proxy graphics bytes (92/160 length tag + 310 chunks in AcDbEntity, or in AcDbProxyEntity for
   * ACAD_PROXY_ENTITY), concatenated; undefined if absent (note 07 §15.1).
   */
  readonly proxyGraphics?: Uint8Array | undefined;
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
// read without defaults so that absent fields can be recovered from other subclasses first
const COMMON = fieldTable(COMMON_FIELDS.map(({ def: _def, ...d }) => d));

/**
 * Types whose own subclasses never use the common codes below, so a common code found there is a
 * misplaced AcDbEntity property (QCAD/LibreCAD/QGIS write `100 AcDbEntity`, `100 AcDbLine`,
 * `8 …`, `62 …`). ezdxf recovers these the same way (`recover_graphic_attributes`, note 01 §6.3);
 * AutoCAD rejects such files, so the writer's intent is the only reference. MTEXT (48 = column
 * width) and VIEWPORT are deliberately excluded.
 */
// biome-ignore format: compact list
const RECOVER_TYPES = new Set([
  "LINE", "POINT", "CIRCLE", "ARC", "ELLIPSE", "SOLID", "TRACE", "3DFACE", "RAY", "XLINE",
  "SPLINE", "SHAPE", "LWPOLYLINE", "POLYLINE", "VERTEX", "SEQEND", "TEXT", "ATTRIB", "ATTDEF",
  "INSERT", "DIMENSION", "LEADER", "TOLERANCE", "HATCH", "IMAGE", "WIPEOUT", "REGION", "3DSOLID",
  "BODY",
]);
const RECOVER_CODES = new Map(COMMON_FIELDS.filter((d) => d.code !== 410).map((d) => [d.code, d]));

function recoverMisplaced(rec: DxfRecord, f: Record<string, unknown>): void {
  const codes = rec.store.codes;
  for (const p of rec.parts) {
    if (p.kind !== PartKind.Subclass || p.name === "AcDbEntity") continue;
    for (let i = rec.nextDataTag(p.start); i < p.end; i = rec.nextDataTag(i + 1)) {
      const d = RECOVER_CODES.get(codes[i]!);
      if (d && !(d.name in f)) writeFieldAt(rec, i, p.end, d, f);
    }
  }
}

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
  if (rec.hasMisplacedCommon && RECOVER_TYPES.has(rec.type)) recoverMisplaced(rec, f);
  for (const d of COMMON_FIELDS) if (!(d.name in f) && d.def !== undefined) f[d.name] = d.def;
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
    proxyGraphics: readProxyGraphics(rec, "AcDbEntity"),
    record: rec,
  };
}

/**
 * Proxy graphics of a subclass: the first 92 or 160 length tag directly followed by 310 chunks.
 * The version-to-length-code rule is unreliable (ezdxf#978), so both are accepted (note 07 §15.1).
 */
export function readProxyGraphics(rec: DxfRecord, subclass: string): Uint8Array | undefined {
  if (!rec.hasProxyGraphics) return undefined;
  const p = rec.hasSubclasses ? rec.subclass(subclass) : undefined;
  if (!p) return undefined;
  const s = rec.store;
  const codes = s.codes;
  let chunks: Uint8Array[] | undefined;
  let prev = -1;
  for (let i = rec.nextDataTag(p.start); i < p.end; i = rec.nextDataTag(i + 1)) {
    const c = codes[i]!;
    if (chunks) {
      if (c !== 310) break;
      chunks.push(s.binary(i));
    } else if (c === 310 && (prev === 92 || prev === 160)) {
      chunks = [s.binary(i)];
    }
    prev = c;
  }
  if (!chunks) return undefined;
  if (chunks.length === 1) return chunks[0];
  let n = 0;
  for (const b of chunks) n += b.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const b of chunks) {
    out.set(b, o);
    o += b.length;
  }
  return out;
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

/** Tables of simple parsers whose document-owned base can become the final entity. */
export const SIMPLE_ENTITY_FIELDS = new WeakMap<
  EntityParser,
  { type: string; table: ReturnType<typeof fieldTable>; finish?: (entity: EntityBase) => EntityBase }
>();

/** Helper for simple spec-driven entities: base properties + fields from a table. */
export function simpleParser<E extends EntityBase>(
  type: string,
  defs: readonly FieldDef[],
  finish?: (entity: E) => E,
): EntityParser<E> {
  // Simple entities have unambiguous codes (note 01 section 6.3).
  const table = fieldTable(defs, { lenient: true });
  const parser: EntityParser<E> = (rec, base) => {
    const entity = readFields<E>(rec, table, { ...base, type } as Record<string, unknown>);
    return finish ? finish(entity) : entity;
  };
  SIMPLE_ENTITY_FIELDS.set(parser as EntityParser, {
    type,
    table,
    finish: finish as ((entity: EntityBase) => EntityBase) | undefined,
  });
  return parser;
}
