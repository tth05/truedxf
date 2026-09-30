/**
 * MTEXT (and the embedded MTEXT of R2018 multi-line ATTRIB/ATTDEF).
 * research/notes/04-text-fonts.md §3.1 (group codes), §3.2 (chunked content), §3.6.1 (42/43
 * extents), §3.7 (columns: R2018 embedded object and pre-R2018 XDATA ACAD_MTEXT_COLUMN_INFO).
 *
 * MTEXT is a WCS entity: 10 and 11 are WCS, 210 only gives the plane normal.
 */
import { type FieldDef, fieldTable, readFields, readValueAt } from "../fields.ts";
import { type DxfRecord, PartKind } from "../record.ts";
import { partTags, type TypedTag, tagNum, xdataBeginEnd, xdataTags } from "../tags.ts";
import type { Point3 } from "../types.ts";
import { type EntityBase, registerEntity } from "./common.ts";

const Z = Object.freeze({ x: 0, y: 0, z: 1 });
const O = Object.freeze({ x: 0, y: 0, z: 0 });

/** MTEXT column definition (R2018 embedded object or pre-R2018 XDATA), note 04 §3.7. */
export interface MTextColumns {
  /** 0 none, 1 static, 2 dynamic. */
  readonly type: number;
  /**
   * Column count. R2018 stores 0 for dynamic columns with auto height; then it is estimated as
   * round((totalWidth + gutter) / (width + gutter)) like ezdxf (exact value needs layout).
   */
  readonly count: number;
  readonly autoHeight: boolean;
  readonly flowReversed: boolean;
  /** Width of one column (use this for wrapping, not 41 of linked columns). */
  readonly width: number;
  readonly gutter: number;
  /** Column height for static / auto-height columns. */
  readonly definedHeight: number;
  /** Embedded 42 (R2018) or computed (pre-R2018): count·width + (count−1)·gutter. */
  readonly totalWidth: number;
  /** Embedded 43 (R2018): height of the tallest column. */
  readonly totalHeight: number;
  /** Dynamic columns with manual height: one height per column (last may be 0). */
  readonly heights: readonly number[];
  /** Pre-R2018: handles of the linked continuation-column MTEXT entities (ACAD_MTEXT_COLUMNS). */
  readonly linkedHandles: readonly string[];
  readonly source: "embedded" | "xdata";
}

/** Properties of AcDbMText, shared by MTEXT and the embedded MTEXT of multi-line attributes. */
export interface MTextProps {
  /** Content: all 3-chunks and 1-chunks concatenated in file order (note 04 §3.2), raw codes. */
  readonly text: string;
  /** WCS */
  readonly insert: Point3;
  /** Nominal char height (40) = cap height. */
  readonly height: number;
  /** Reference rectangle width (41); 0 = no wrapping. */
  readonly width: number;
  /** Defined height (46, R2007+); 0 = auto. */
  readonly definedHeight: number;
  /**
   * Effective attachment point 1..9 (TL, TC, TR, ML, MC, MR, BL, BC, BR): the embedded object's
   * 70 when present (AutoCAD reads it there, note 04 §3.6.3), else 71.
   */
  readonly attachment: number;
  /** Raw group 71. */
  readonly attachmentPoint71: number;
  /** 1 left→right, 3 top→bottom, 5 by style. */
  readonly flowDirection: number;
  readonly style: string;
  readonly extrusion: Point3;
  /**
   * X-axis direction (11, WCS, not normalized as written); wins over `rotation`. A zero vector
   * makes the MTEXT invisible in AutoCAD (note 04 §3.6.3). Undefined when absent.
   */
  readonly direction: Point3 | undefined;
  /** Group 50 in **degrees** (the DXF reference's "radians" is wrong); used only without 11. */
  readonly rotation: number;
  /** 1 at least, 2 exact. */
  readonly lineSpacingStyle: number;
  readonly lineSpacingFactor: number;
  /** AutoCAD's stored extents (42/43, AcDbMText or embedded object): an oracle, note 04 §3.6.1. */
  readonly rectWidth: number | undefined;
  readonly rectHeight: number | undefined;
  /** 90: 0 off, 1 color, 2 window color, 3 = 1|2, 16 text frame (17 = fill + frame). */
  readonly bgFlags: number;
  /** 63 ACI (required, even with 421). */
  readonly bgColor: number;
  readonly bgTrueColor: number | undefined;
  readonly bgColorName: string | undefined;
  /** 45 border offset factor (1 = exact fit); default 1.5. */
  readonly bgScale: number;
  readonly bgTransparency: number | undefined;
}

export interface MTextEntity extends EntityBase, MTextProps {
  readonly type: "MTEXT";
  readonly columns: MTextColumns | undefined;
  /**
   * Pre-R2018 text-frame LWPOLYLINE handles (XDATA ACAD_MTEXT_TEXT_BORDERS). These polylines are
   * ordinary entities; do not draw the frame twice (note 04 §3.1).
   */
  readonly textBorderHandles: readonly string[];
}

const M = "AcDbMText";

const MTEXT_DEFS: FieldDef[] = [
  { name: "insert", code: 10, kind: "p3", subclass: M, def: O },
  { name: "height", code: 40, kind: "num", subclass: M, def: 1 },
  { name: "width", code: 41, kind: "num", subclass: M, def: 0 },
  { name: "definedHeight", code: 46, kind: "num", subclass: M, def: 0 },
  { name: "attachmentPoint71", code: 71, kind: "int", subclass: M, def: 1 },
  { name: "flowDirection", code: 72, kind: "int", subclass: M, def: 1 },
  { name: "style", code: 7, kind: "name", subclass: M, def: "Standard" },
  { name: "extrusion", code: 210, kind: "p3", subclass: M, def: Z },
  { name: "direction", code: 11, kind: "p3", subclass: M },
  { name: "rectWidth", code: 42, kind: "num", subclass: M },
  { name: "rectHeight", code: 43, kind: "num", subclass: M },
  { name: "rotation", code: 50, kind: "num", subclass: M, def: 0 },
  { name: "lineSpacingStyle", code: 73, kind: "int", subclass: M, def: 1 },
  { name: "lineSpacingFactor", code: 44, kind: "num", subclass: M, def: 1 },
  { name: "bgFlags", code: 90, kind: "int", subclass: M, def: 0 },
  { name: "bgColor", code: 63, kind: "int", subclass: M, def: 0 },
  { name: "bgTrueColor", code: 421, kind: "int", subclass: M },
  { name: "bgColorName", code: 431, kind: "str", subclass: M },
  { name: "bgScale", code: 45, kind: "num", subclass: M, def: 1.5 },
  { name: "bgTransparency", code: 441, kind: "int", subclass: M },
];
const MTEXT = fieldTable(MTEXT_DEFS);

/** Joins the 3 and 1 chunks of a tag list in file order (note 04 §3.2). */
function joinChunks(rec: DxfRecord, tags: Iterable<number>): string {
  const s = rec.store;
  let text = "";
  for (const i of tags) {
    const c = s.codes[i]!;
    if (c === 3 || c === 1) text += s.str(i);
  }
  return text;
}

function textTags(rec: DxfRecord): number[] {
  const out: number[] = [];
  for (const p of rec.parts) {
    if (p.kind !== PartKind.Base && p.kind !== PartKind.Subclass) continue;
    if (rec.hasSubclasses && p.name !== M) continue;
    for (const i of rec.partTags(p)) out.push(i);
  }
  return out;
}

/** Embedded object values of an MTEXT (R2018 columns), by code; 46 collected. */
interface EmbeddedColumnData {
  attachment: number | undefined;
  direction: Point3 | undefined;
  insert: Point3 | undefined;
  width: number | undefined;
  columns: MTextColumns;
}

function readEmbeddedColumns(tags: readonly TypedTag[]): EmbeddedColumnData {
  let attachment: number | undefined;
  let direction: Point3 | undefined;
  let insert: Point3 | undefined;
  let width: number | undefined;
  let type = 0;
  let count = 0;
  let autoHeight = false;
  let flowReversed = false;
  let colWidth = 0;
  let gutter = 0;
  let definedHeight = 0;
  let totalWidth = 0;
  let totalHeight = 0;
  const heights: number[] = [];
  for (const t of tags) {
    switch (t.code) {
      case 70:
        attachment = tagNum(t);
        break;
      case 10:
        direction = t.value as Point3;
        break;
      case 11:
        insert = t.value as Point3;
        break;
      case 40:
        width = tagNum(t);
        break;
      case 41:
        definedHeight = tagNum(t);
        break;
      case 42:
        totalWidth = tagNum(t);
        break;
      case 43:
        totalHeight = tagNum(t);
        break;
      case 71:
        type = tagNum(t);
        break;
      case 72:
        count = tagNum(t);
        break;
      case 44:
        colWidth = tagNum(t);
        break;
      case 45:
        gutter = tagNum(t);
        break;
      case 73:
        autoHeight = tagNum(t) !== 0;
        break;
      case 74:
        flowReversed = tagNum(t) !== 0;
        break;
      case 46:
        heights.push(tagNum(t));
        break;
    }
  }
  if (count === 0) {
    if (heights.length) count = heights.length;
    else if (totalWidth > 0) {
      const wg = Math.abs(colWidth + gutter);
      if (wg > 1e-6) count = Math.round((totalWidth + gutter) / wg);
    }
  }
  return {
    attachment,
    direction,
    insert,
    width,
    columns: {
      type,
      count,
      autoHeight,
      flowReversed,
      width: colWidth,
      gutter,
      definedHeight,
      totalWidth,
      totalHeight,
      heights,
      linkedHandles: [],
      source: "embedded",
    },
  };
}

/** Pre-R2018 columns from XDATA `ACAD` (ACAD_MTEXT_COLUMN_INFO etc.), note 04 §3.7. */
export function readXDataColumns(acad: readonly TypedTag[]): MTextColumns | undefined {
  const info = xdataBeginEnd(acad, "ACAD_MTEXT_COLUMN_INFO");
  if (!info) return undefined;
  let type = 0;
  let count = 1;
  let autoHeight = false;
  let flowReversed = false;
  let width = 0;
  let gutter = 0;
  const heights: number[] = [];
  for (let k = 0; k < info.length; k++) {
    const t = info[k]!;
    if (t.code !== 1070) continue;
    const key = tagNum(t);
    const v = info[k + 1];
    if (!v) break;
    k++;
    switch (key) {
      case 75:
        type = tagNum(v);
        break;
      case 79:
        autoHeight = tagNum(v) !== 0;
        break;
      case 76:
        count = tagNum(v);
        break;
      case 78:
        flowReversed = tagNum(v) !== 0;
        break;
      case 48:
        width = tagNum(v);
        break;
      case 49:
        gutter = tagNum(v);
        break;
      case 50: {
        const n = tagNum(v);
        for (let j = 0; j < n && info[k + 1]?.code === 1040; j++) heights.push(tagNum(info[++k]));
        break;
      }
    }
  }
  const linkedHandles = (xdataBeginEnd(acad, "ACAD_MTEXT_COLUMNS") ?? [])
    .filter((t) => t.code === 1005)
    .map((t) => String(t.value));
  let definedHeight = 0;
  for (const t of xdataBeginEnd(acad, "ACAD_MTEXT_DEFINED_HEIGHT") ?? [])
    if (t.code === 1040) definedHeight = tagNum(t);
  const totalWidth = count * width + Math.max(0, count - 1) * gutter;
  const totalHeight = heights.length ? Math.max(...heights) : definedHeight;
  return {
    type,
    count,
    autoHeight,
    flowReversed,
    width,
    gutter,
    definedHeight,
    totalWidth,
    totalHeight,
    heights,
    linkedHandles,
    source: "xdata",
  };
}

type MTextFields = Omit<MTextProps, "text" | "attachment" | "rectWidth" | "rectHeight"> & {
  rectWidth?: number;
  rectHeight?: number;
};

registerEntity<MTextEntity>("MTEXT", (rec, base) => {
  const f = readFields<MTextFields>(rec, MTEXT);
  const text = joinChunks(rec, textTags(rec));
  const emb = rec.embedded;
  let columns: MTextColumns | undefined;
  let attachment = f.attachmentPoint71;
  let rectWidth = f.rectWidth;
  let rectHeight = f.rectHeight;
  let { insert, width, direction, rotation } = f;
  if (emb) {
    const e = readEmbeddedColumns(partTags(rec, emb));
    columns = e.columns;
    if (e.attachment !== undefined && e.attachment >= 1 && e.attachment <= 9) attachment = e.attachment;
    // The embedded values duplicate AcDbMText ones; they only fill gaps and must never overwrite
    // the real values (libredwg#1321, note 04 §3.6.3).
    if (!hasCode(rec, 10) && e.insert) insert = e.insert;
    if (!hasCode(rec, 41) && e.width !== undefined) width = e.width;
    if (direction === undefined && e.direction) {
      direction = e.direction;
      rotation = 0;
    }
    rectWidth ??= e.columns.totalWidth || undefined;
    rectHeight ??= e.columns.totalHeight || undefined;
  }
  const acad = xdataTags(rec, "ACAD");
  if (!columns && acad.length) columns = readXDataColumns(acad);
  const textBorderHandles = (xdataBeginEnd(acad, "ACAD_MTEXT_TEXT_BORDERS") ?? [])
    .filter((t) => t.code === 1005)
    .map((t) => String(t.value));
  return {
    ...base,
    ...f,
    type: "MTEXT",
    text,
    insert,
    width,
    direction,
    rotation,
    attachment,
    rectWidth,
    rectHeight,
    columns,
    textBorderHandles,
  };
});

function hasCode(rec: DxfRecord, code: number): boolean {
  return rec.find(code, M) >= 0;
}

/**
 * The embedded MTEXT of an R2018 multi-line ATTRIB/ATTDEF (`101 Embedded Object` followed by
 * AcDbMText codes from 10 on, note 04 §2.3). Graphical properties come from the host entity.
 * Returns undefined if the record has no embedded object.
 */
export function parseEmbeddedMText(rec: DxfRecord): MTextProps | undefined {
  const emb = rec.embedded;
  if (!emb) return undefined;
  const tags = [...rec.partTags(emb)];
  const o: Record<string, unknown> = {};
  const s = rec.store;
  for (let k = 0; k < tags.length; ) {
    const code = s.codes[tags[k]!]!;
    const def = MTEXT.byCode.get(code)?.[0];
    if (!def || code === 1 || code === 3) {
      k++;
      continue;
    }
    const [v, n] = readValueAt(rec, tags, k, def.kind);
    o[def.name] = v;
    k += n;
  }
  for (const d of MTEXT_DEFS) if (!(d.name in o) && d.def !== undefined) o[d.name] = d.def;
  const f = o as unknown as MTextFields;
  return {
    ...f,
    text: joinChunks(rec, tags),
    attachment: f.attachmentPoint71,
    rectWidth: f.rectWidth,
    rectHeight: f.rectHeight,
  };
}
