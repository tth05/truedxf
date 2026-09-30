/**
 * TEXT, ATTRIB, ATTDEF and INSERT (+ATTRIB children). research/notes/04-text-fonts.md §1–§2 and
 * 07-blocks-inserts-misc.md §2. MTEXT lives in mtext.ts.
 */
import { type FieldDef, fieldTable, readFields } from "../fields.ts";
import type { DxfRecord } from "../record.ts";
import type { Point3 } from "../types.ts";
import { type EntityBase, readBase, registerEntity } from "./common.ts";

const Z = Object.freeze({ x: 0, y: 0, z: 1 });
const O = Object.freeze({ x: 0, y: 0, z: 0 });

/** Properties shared by TEXT, ATTRIB and ATTDEF (subclass AcDbText). */
export interface TextProps {
  /** Raw text (with %% codes, \U+ escapes, carets). OCS. */
  readonly text: string;
  readonly insert: Point3;
  /** Second alignment point (group 11), undefined when absent; the true anchor if halign/valign ≠ 0. */
  readonly alignPoint: Point3 | undefined;
  readonly height: number;
  /** Degrees. */
  readonly rotation: number;
  readonly widthFactor: number;
  /** Degrees. */
  readonly oblique: number;
  readonly style: string;
  /** 2 backward (mirrored in X), 4 upside down (mirrored in Y). */
  readonly generationFlags: number;
  /** 0 left, 1 center, 2 right, 3 aligned, 4 middle, 5 fit. */
  readonly halign: number;
  /** 0 baseline, 1 bottom, 2 middle, 3 top. */
  readonly valign: number;
  readonly thickness: number;
  readonly extrusion: Point3;
}

export interface TextEntity extends EntityBase, TextProps {
  readonly type: "TEXT";
}

export interface AttribEntity extends EntityBase, TextProps {
  readonly type: "ATTRIB" | "ATTDEF";
  readonly tag: string;
  /** ATTDEF only. */
  readonly prompt: string;
  /** 1 invisible, 2 constant, 4 verify, 8 preset. */
  readonly attribFlags: number;
  readonly fieldLength: number;
  readonly lockPosition: boolean;
  /** R2018 multi-line attribute: the embedded MTEXT's record part exists. */
  readonly isMultiline: boolean;
}

const TEXT_SUB = "AcDbText";

const textFields = (valignCode: number, valignSubclass: string | string[]): FieldDef[] => [
  { name: "thickness", code: 39, kind: "num", subclass: TEXT_SUB, def: 0 },
  { name: "insert", code: 10, kind: "p3", subclass: TEXT_SUB, def: O },
  { name: "height", code: 40, kind: "num", subclass: TEXT_SUB, def: 1 },
  { name: "text", code: 1, kind: "str", subclass: TEXT_SUB, def: "" },
  { name: "rotation", code: 50, kind: "num", subclass: TEXT_SUB, def: 0 },
  { name: "widthFactor", code: 41, kind: "num", subclass: TEXT_SUB, def: 1 },
  { name: "oblique", code: 51, kind: "num", subclass: TEXT_SUB, def: 0 },
  { name: "style", code: 7, kind: "name", subclass: TEXT_SUB, def: "Standard" },
  { name: "generationFlags", code: 71, kind: "int", subclass: TEXT_SUB, def: 0 },
  { name: "halign", code: 72, kind: "int", subclass: TEXT_SUB, def: 0 },
  { name: "alignPoint", code: 11, kind: "p3", subclass: TEXT_SUB },
  { name: "extrusion", code: 210, kind: "p3", subclass: TEXT_SUB, def: Z },
  { name: "valign", code: valignCode, kind: "int", subclass: valignSubclass, def: 0 },
];

const TEXT = fieldTable(textFields(73, TEXT_SUB));

registerEntity<TextEntity>("TEXT", (rec, base) =>
  readFields<TextEntity>(rec, TEXT, { ...base, type: "TEXT" } as Record<string, unknown>),
);

const ATTRIB = fieldTable([
  ...textFields(74, ["AcDbAttribute"]),
  { name: "tag", code: 2, kind: "name", subclass: "AcDbAttribute", def: "" },
  { name: "attribFlags", code: 70, kind: "int", subclass: "AcDbAttribute", def: 0 },
  { name: "fieldLength", code: 73, kind: "int", subclass: "AcDbAttribute", def: 0 },
  // 280 appears twice in R2010+ (version, then lock position; ezdxf#907)
  { name: "version", code: 280, kind: "int", subclass: "AcDbAttribute" },
  { name: "lockPosition", code: 280, kind: "bool", subclass: "AcDbAttribute", def: false },
]);

const ATTDEF = fieldTable([
  ...textFields(74, ["AcDbAttributeDefinition"]),
  { name: "prompt", code: 3, kind: "str", subclass: "AcDbAttributeDefinition", def: "" },
  { name: "tag", code: 2, kind: "name", subclass: "AcDbAttributeDefinition", def: "" },
  { name: "attribFlags", code: 70, kind: "int", subclass: "AcDbAttributeDefinition", def: 0 },
  { name: "fieldLength", code: 73, kind: "int", subclass: "AcDbAttributeDefinition", def: 0 },
  { name: "version", code: 280, kind: "int", subclass: "AcDbAttributeDefinition" },
  { name: "lockPosition", code: 280, kind: "bool", subclass: "AcDbAttributeDefinition", def: false },
]);

function attribParser(type: "ATTRIB" | "ATTDEF") {
  const table = type === "ATTRIB" ? ATTRIB : ATTDEF;
  return (rec: DxfRecord, base: EntityBase): AttribEntity => {
    const e = readFields<AttribEntity & { version?: number }>(rec, table, {
      ...base,
      type,
      prompt: "",
    } as Record<string, unknown>);
    // With only one 280 present (pre-R2010), it is the lock-position flag.
    const lockOnly = rec.hasSubclasses && count280(rec) === 1;
    return {
      ...e,
      lockPosition: lockOnly ? (e.version ?? 0) !== 0 : e.lockPosition,
      isMultiline: rec.embedded !== undefined,
    };
  };
}

function count280(rec: DxfRecord): number {
  let n = 0;
  for (const i of rec.dataTags()) if (rec.store.codes[i] === 280) n++;
  return n;
}

registerEntity("ATTRIB", attribParser("ATTRIB"));
registerEntity("ATTDEF", attribParser("ATTDEF"));

export function parseAttrib(rec: DxfRecord): AttribEntity {
  return attribParser("ATTRIB")(rec, readBase(rec));
}

export interface InsertEntity extends EntityBase {
  readonly type: "INSERT";
  readonly blockName: string;
  /** OCS */
  readonly insert: Point3;
  readonly scale: Point3;
  /** Degrees. */
  readonly rotation: number;
  readonly columnCount: number;
  readonly rowCount: number;
  readonly columnSpacing: number;
  readonly rowSpacing: number;
  readonly extrusion: Point3;
  readonly attribs: readonly AttribEntity[];
  readonly seqend: DxfRecord | undefined;
}

const INSERT_SUB = ["AcDbBlockReference", "AcDbMInsertBlock"];
const INSERT = fieldTable([
  { name: "blockName", code: 2, kind: "name", subclass: INSERT_SUB, def: "" },
  { name: "insert", code: 10, kind: "p3", subclass: INSERT_SUB, def: O },
  { name: "sx", code: 41, kind: "num", subclass: INSERT_SUB, def: 1 },
  { name: "sy", code: 42, kind: "num", subclass: INSERT_SUB, def: 1 },
  { name: "sz", code: 43, kind: "num", subclass: INSERT_SUB, def: 1 },
  { name: "rotation", code: 50, kind: "num", subclass: INSERT_SUB, def: 0 },
  { name: "columnCount", code: 70, kind: "int", subclass: INSERT_SUB, def: 1 },
  { name: "rowCount", code: 71, kind: "int", subclass: INSERT_SUB, def: 1 },
  { name: "columnSpacing", code: 44, kind: "num", subclass: INSERT_SUB, def: 0 },
  { name: "rowSpacing", code: 45, kind: "num", subclass: INSERT_SUB, def: 0 },
  { name: "extrusion", code: 210, kind: "p3", subclass: INSERT_SUB, def: Z },
]);

registerEntity<InsertEntity>("INSERT", (rec, base, _ctx, children) => {
  const f = readFields<{
    blockName: string;
    insert: Point3;
    sx: number;
    sy: number;
    sz: number;
    rotation: number;
    columnCount: number;
    rowCount: number;
    columnSpacing: number;
    rowSpacing: number;
    extrusion: Point3;
  }>(rec, INSERT);
  return {
    ...base,
    type: "INSERT",
    blockName: f.blockName,
    insert: f.insert,
    scale: { x: f.sx, y: f.sy, z: f.sz },
    rotation: f.rotation,
    // count 0 is read as 1 (note 11b)
    columnCount: Math.max(1, f.columnCount),
    rowCount: Math.max(1, f.rowCount),
    columnSpacing: f.columnSpacing,
    rowSpacing: f.rowSpacing,
    extrusion: f.extrusion,
    attribs: (children?.children ?? []).filter((c) => c.type === "ATTRIB").map(parseAttrib),
    seqend: children?.seqend,
  };
});
