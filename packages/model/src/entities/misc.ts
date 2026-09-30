/**
 * MLINE, ACAD_TABLE, MESH, HELIX, the ACIS family (REGION, 3DSOLID, BODY, SURFACE and its
 * subtypes) and ACAD_PROXY_ENTITY.
 * research/notes/07-blocks-inserts-misc.md §12 (MLINE), §13 (ACAD_TABLE), §15 (proxy);
 * 03-entities-geometry.md §3.13 (HELIX), §3.14 (MESH), §3.15 (ACIS).
 */
import { TagCursor } from "../cursor.ts";
import { fieldTable, readFields } from "../fields.ts";
import type { DxfRecord } from "../record.ts";
import type { Point3 } from "../types.ts";
import type { SplineEntity } from "./basic.ts";
import { ENTITY_PARSERS, type EntityBase, registerEntity } from "./common.ts";

const Z = Object.freeze({ x: 0, y: 0, z: 1 });
const X = Object.freeze({ x: 1, y: 0, z: 0 });
const O = Object.freeze({ x: 0, y: 0, z: 0 });

// ---- MLINE -------------------------------------------------------------------------------

export interface MLineElementParams {
  /** 41 list: [offset along miter, dash start along direction, stop, start, …] (note 07 §12.2). */
  readonly params: readonly number[];
  /** 42 list: area-fill break parameters. */
  readonly fillParams: readonly number[];
}

export interface MLineVertex {
  /** WCS; the stored geometry is final (scale / justification / offsets applied). */
  readonly position: Point3;
  /** 12: direction of the segment starting here (unit). */
  readonly direction: Point3;
  /** 13: miter direction (unit). */
  readonly miter: Point3;
  /** One entry per style element. */
  readonly elements: readonly MLineElementParams[];
}

/** MLINE flags (71). */
export const MLineFlags = { HasVertices: 1, Closed: 2, SuppressStartCaps: 4, SuppressEndCaps: 8 } as const;

export interface MLineEntity extends EntityBase {
  readonly type: "MLINE";
  /** 2 (redundant; use styleHandle). */
  readonly styleName: string;
  /** 340 → MLINESTYLE. */
  readonly styleHandle: string | undefined;
  /** 40 (negative flips sides). */
  readonly scale: number;
  /** 70: 0 top, 1 zero, 2 bottom. */
  readonly justification: number;
  readonly flags: number;
  readonly styleElementCount: number;
  readonly start: Point3;
  readonly extrusion: Point3;
  readonly vertices: readonly MLineVertex[];
}

function readMLineElement(c: TagCursor): MLineElementParams {
  const params: number[] = [];
  const fillParams: number[] = [];
  if (c.code() === 74) {
    const n = c.int();
    for (let k = 0; k < n && c.code() === 41; k++) params.push(c.num());
  }
  if (c.code() === 75) {
    const n = c.int();
    for (let k = 0; k < n && c.code() === 42; k++) fillParams.push(c.num());
  }
  return { params, fillParams };
}

registerEntity<MLineEntity>("MLINE", (rec, base) => {
  const c = TagCursor.subclass(rec, "AcDbMline");
  let styleName = "";
  let styleHandle: string | undefined;
  let scale = 1;
  let justification = 0;
  let flags = 0;
  let styleElementCount = 0;
  let start: Point3 = O;
  let extrusion: Point3 = Z;
  const vertices: MLineVertex[] = [];
  while (!c.done) {
    switch (c.code()) {
      case 2:
        styleName = c.str().trim();
        break;
      case 340:
        styleHandle = c.handle();
        break;
      case 40:
        scale = c.num();
        break;
      case 70:
        justification = c.int();
        break;
      case 71:
        flags = c.int();
        break;
      case 73:
        styleElementCount = c.int();
        break;
      case 10:
        start = c.point();
        break;
      case 210:
        extrusion = c.point();
        break;
      case 11: {
        const position = c.point();
        const direction = c.code() === 12 ? c.point() : X;
        const miter = c.code() === 13 ? c.point() : O;
        const elements: MLineElementParams[] = [];
        while (c.code() === 74 || c.code() === 75) elements.push(readMLineElement(c));
        vertices.push({ position, direction, miter, elements });
        break;
      }
      default:
        c.skip();
    }
  }
  return {
    ...base,
    type: "MLINE",
    styleName,
    styleHandle,
    scale,
    justification,
    flags,
    styleElementCount,
    start,
    extrusion,
    vertices,
  };
});

// ---- ACAD_TABLE --------------------------------------------------------------------------

/**
 * ACAD_TABLE: render the anonymous `*T` block like an INSERT (note 07 §13.1); only the block
 * reference part and the basic table geometry are decoded, cell data stays in `record`.
 */
export interface AcadTableEntity extends EntityBase {
  readonly type: "ACAD_TABLE";
  /** 2: `*T…` block name. */
  readonly blockName: string;
  /** OCS */
  readonly insert: Point3;
  readonly scale: Point3;
  /** Degrees. */
  readonly rotation: number;
  readonly extrusion: Point3;
  readonly version: number;
  /** 342 → TABLESTYLE. */
  readonly tableStyleHandle: string | undefined;
  /** 343 → BLOCK_RECORD of the `*T` block. */
  readonly blockRecordHandle: string | undefined;
  /** 11: horizontal direction (WCS). */
  readonly direction: Point3;
  readonly tableFlags: number;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly rowHeights: readonly number[];
  readonly columnWidths: readonly number[];
}

const BR = "AcDbBlockReference";
const TABLE_REF = fieldTable([
  { name: "blockName", code: 2, kind: "name", subclass: BR, def: "" },
  { name: "insert", code: 10, kind: "p3", subclass: BR, def: O },
  { name: "sx", code: 41, kind: "num", subclass: BR, def: 1 },
  { name: "sy", code: 42, kind: "num", subclass: BR, def: 1 },
  { name: "sz", code: 43, kind: "num", subclass: BR, def: 1 },
  { name: "rotation", code: 50, kind: "num", subclass: BR, def: 0 },
  { name: "extrusion", code: 210, kind: "p3", subclass: BR, def: Z },
]);

registerEntity<AcadTableEntity>("ACAD_TABLE", (rec, base) => {
  const r = readFields<{
    blockName: string;
    insert: Point3;
    sx: number;
    sy: number;
    sz: number;
    rotation: number;
    extrusion: Point3;
  }>(rec, TABLE_REF);
  const c = TagCursor.subclass(rec, "AcDbTable");
  let version = 0;
  let tableStyleHandle: string | undefined;
  let blockRecordHandle: string | undefined;
  let direction: Point3 = X;
  let tableFlags = 0;
  let rowCount = 0;
  let columnCount = 0;
  const rowHeights: number[] = [];
  const columnWidths: number[] = [];
  // the table header ends at the first cell (171); cell data reuses many codes
  while (!c.done && c.code() !== 171) {
    switch (c.code()) {
      case 280:
        version = c.int();
        break;
      case 342:
        tableStyleHandle = c.handle();
        break;
      case 343:
        blockRecordHandle = c.handle();
        break;
      case 11:
        direction = c.point();
        break;
      case 90:
        tableFlags = c.int();
        break;
      case 91:
        rowCount = c.int();
        break;
      case 92:
        columnCount = c.int();
        break;
      case 141:
        rowHeights.push(c.num());
        break;
      case 142:
        columnWidths.push(c.num());
        break;
      default:
        c.skip();
    }
  }
  return {
    ...base,
    type: "ACAD_TABLE",
    blockName: r.blockName,
    insert: r.insert,
    scale: { x: r.sx, y: r.sy, z: r.sz },
    rotation: r.rotation,
    extrusion: r.extrusion,
    version,
    tableStyleHandle,
    blockRecordHandle,
    direction,
    tableFlags,
    rowCount,
    columnCount,
    rowHeights,
    columnWidths,
  };
});

// ---- MESH --------------------------------------------------------------------------------

export interface MeshEntity extends EntityBase {
  readonly type: "MESH";
  readonly version: number;
  readonly blendCrease: boolean;
  /** 91: subdivision level; > 0 means AutoCAD shows the smoothed surface (note 03 §3.14). */
  readonly subdivisionLevel: number;
  /** Level-0 control cage vertices (WCS). */
  readonly vertices: readonly Point3[];
  /** Faces as 0-based vertex index lists (n-gons). */
  readonly faces: readonly (readonly number[])[];
  /** Edges as vertex index pairs. */
  readonly edges: readonly (readonly [number, number])[];
  /** One crease value per edge. */
  readonly creases: readonly number[];
}

registerEntity<MeshEntity>("MESH", (rec, base) => {
  const c = TagCursor.subclass(rec, "AcDbSubDMesh");
  let version = 2;
  let blendCrease = false;
  let subdivisionLevel = 0;
  const vertices: Point3[] = [];
  const faces: number[][] = [];
  const edges: [number, number][] = [];
  const creases: number[] = [];
  while (!c.done) {
    switch (c.code()) {
      case 71:
        version = c.int();
        break;
      case 72:
        blendCrease = c.bool();
        break;
      case 91:
        subdivisionLevel = c.int();
        break;
      case 92: {
        const n = c.int();
        for (let k = 0; k < n && c.code() === 10; k++) vertices.push(c.point());
        break;
      }
      case 93: {
        // 93 = size of the face list (count of 90 tags), not the face count
        const size = c.int();
        let read = 0;
        while (read < size && c.code() === 90) {
          const n = c.int();
          read++;
          const face: number[] = [];
          for (let k = 0; k < n && read < size && c.code() === 90; k++, read++) face.push(c.int());
          faces.push(face);
        }
        break;
      }
      case 94: {
        const n = c.int();
        for (let k = 0; k < n && c.code() === 90; k++) {
          const a = c.int();
          const b = c.code() === 90 ? c.int() : a;
          edges.push([a, b]);
        }
        break;
      }
      case 95: {
        const n = c.int();
        for (let k = 0; k < n && c.code() === 140; k++) creases.push(c.num());
        break;
      }
      case 90:
        // 90 overrides (override count 90, then 91/92/90 …): keep raw in the record
        return done();
      default:
        c.skip();
    }
  }
  return done();
  function done(): MeshEntity {
    return { ...base, type: "MESH", version, blendCrease, subdivisionLevel, vertices, faces, edges, creases };
  }
});

// ---- HELIX -------------------------------------------------------------------------------

/** HELIX = complete AcDbSpline + AcDbHelix parameters; render the spline (note 03 §3.13). */
export interface HelixEntity extends Omit<SplineEntity, "type"> {
  readonly type: "HELIX";
  readonly axisBase: Point3;
  readonly startPoint: Point3;
  readonly axisVector: Point3;
  /** 40: top radius (base radius = |startPoint − axisBase|). */
  readonly radius: number;
  readonly turns: number;
  readonly turnHeight: number;
  /** 290: true = right-handed. */
  readonly rightHanded: boolean;
  /** 280: 0 turn height, 1 turns, 2 height. */
  readonly constrain: number;
}

const H = "AcDbHelix";
const HELIX = fieldTable([
  { name: "axisBase", code: 10, kind: "p3", subclass: H, def: O },
  { name: "startPoint", code: 11, kind: "p3", subclass: H, def: X },
  { name: "axisVector", code: 12, kind: "p3", subclass: H, def: Z },
  { name: "radius", code: 40, kind: "num", subclass: H, def: 1 },
  { name: "turns", code: 41, kind: "num", subclass: H, def: 1 },
  { name: "turnHeight", code: 42, kind: "num", subclass: H, def: 1 },
  { name: "rightHanded", code: 290, kind: "bool", subclass: H, def: true },
  { name: "constrain", code: 280, kind: "int", subclass: H, def: 1 },
]);

registerEntity<HelixEntity>("HELIX", (rec, base, ctx, children) => {
  const spline = ENTITY_PARSERS.get("SPLINE");
  const s = (spline ? spline(rec, base, ctx, children) : base) as SplineEntity;
  const h = rec.hasSubclasses ? readFields<Record<string, unknown>>(rec, HELIX) : {};
  return { ...s, ...(h as object), type: "HELIX" } as HelixEntity;
});

// ---- ACIS (REGION, 3DSOLID, BODY, SURFACE family) ---------------------------------------

export interface AcisEntity extends EntityBase {
  readonly type:
    | "REGION"
    | "3DSOLID"
    | "BODY"
    | "SURFACE"
    | "EXTRUDEDSURFACE"
    | "LOFTEDSURFACE"
    | "REVOLVEDSURFACE"
    | "SWEPTSURFACE"
    | "PLANESURFACE"
    | "NURBSURFACE";
  /** 70 modeler format version. */
  readonly modelerVersion: number;
  /**
   * Decoded SAT text lines (1 lines, joined with their 3 continuations) when stored in the entity
   * (R2000–R2010); [] otherwise.
   */
  readonly satLines: readonly string[];
  /**
   * R2013+ (290/2 present, no 1/3 lines): the ACIS data is SAB in the ACDSDATA section, keyed by
   * this entity's handle (note 03 §3.15).
   */
  readonly acisInAcdsData: boolean;
  /** 2: GUID (R2013+). */
  readonly uid: string | undefined;
  /** 3DSOLID 350: history object. */
  readonly historyHandle: string | undefined;
  /** SURFACE 71/72: U/V isolines. */
  readonly uIsolines: number;
  readonly vIsolines: number;
}

/**
 * Decodes AutoCAD's SAT "encryption" (R2000–R2010 DXF): every character except space becomes
 * chr(159 − c). An encoded 'A' (0x5E) is followed by an extra space, which is dropped — observed in
 * AutoCAD-written samples ("^ *+0\^ [" → "AutoCAD"), same as ezdxf's decoder (note 03 §3.15).
 */
export function decodeSatLine(line: string): string {
  let out = "";
  for (let k = 0; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c === 0x20) {
      out += " ";
      continue;
    }
    if (c < 0x20 || c > 0x7e) {
      out += line[k];
      continue;
    }
    out += String.fromCharCode(159 - c);
    if (c === 0x5e && line.charCodeAt(k + 1) === 0x20) k++;
  }
  return out;
}

const ACIS_TYPES = [
  "REGION",
  "3DSOLID",
  "BODY",
  "SURFACE",
  "EXTRUDEDSURFACE",
  "LOFTEDSURFACE",
  "REVOLVEDSURFACE",
  "SWEPTSURFACE",
  "PLANESURFACE",
  "NURBSURFACE",
] as const;

function parseAcis(type: AcisEntity["type"]) {
  return (rec: DxfRecord, base: EntityBase): AcisEntity => {
    const c = TagCursor.subclass(rec, "AcDbModelerGeometry");
    let modelerVersion = 1;
    const raw: string[] = [];
    let uid: string | undefined;
    let flag = false;
    while (!c.done) {
      switch (c.code()) {
        case 70:
          modelerVersion = c.int();
          break;
        case 1:
          raw.push(c.str());
          break;
        case 3:
          // continuation of the previous line
          if (raw.length) raw[raw.length - 1] += c.str();
          else raw.push(c.str());
          break;
        case 290:
          flag = c.bool();
          break;
        case 2:
          uid = c.str().trim();
          break;
        default:
          c.skip();
      }
    }
    const history = rec.find(350, "AcDb3dSolid");
    const surf = rec.hasSubclasses ? rec.subclass("AcDbSurface") : undefined;
    let uIsolines = 0;
    let vIsolines = 0;
    if (surf) {
      for (const i of rec.partTags(surf)) {
        const code = rec.store.codes[i];
        if (code === 71) uIsolines = rec.store.int(i);
        else if (code === 72) vIsolines = rec.store.int(i);
      }
    }
    return {
      ...base,
      type,
      modelerVersion,
      satLines: raw.map(decodeSatLine),
      acisInAcdsData: raw.length === 0 && (flag || uid !== undefined),
      uid,
      historyHandle: history >= 0 ? rec.store.handle(history) : undefined,
      uIsolines,
      vIsolines,
    };
  };
}

for (const t of ACIS_TYPES) registerEntity(t, parseAcis(t));

// ---- ACAD_PROXY_ENTITY -------------------------------------------------------------------

export interface ProxyEntity extends EntityBase {
  readonly type: "ACAD_PROXY_ENTITY";
  /** 90: always 498. */
  readonly proxyClassId: number;
  /** 91: 500 + index of the class in the CLASSES section. */
  readonly applicationClassId: number;
  /** Entity data bytes (93/161 + 310), undefined if absent. */
  readonly entityData: Uint8Array | undefined;
  /** 93/161: size of the entity data in bits. */
  readonly entityDataBits: number;
  /** 330/340/350/360 object ids before the 94 end marker. */
  readonly objectIds: readonly string[];
  /** 95: dwg format (low word version, high word maintenance release). */
  readonly dwgFormat: number;
  /** 70: 0 DWG, 1 DXF. */
  readonly originalFormat: number;
}

registerEntity<ProxyEntity>("ACAD_PROXY_ENTITY", (rec, base) => {
  const c = TagCursor.subclass(rec, "AcDbProxyEntity");
  let proxyClassId = 498;
  let applicationClassId = 0;
  let proxyGraphics: Uint8Array | undefined;
  let entityData: Uint8Array | undefined;
  let entityDataBits = 0;
  const objectIds: string[] = [];
  let dwgFormat = 0;
  let originalFormat = 0;
  while (!c.done) {
    switch (c.code()) {
      case 90:
        proxyClassId = c.int();
        break;
      case 91:
        applicationClassId = c.int();
        break;
      case 92:
      case 160: {
        c.skip();
        // the graphics length tag may be used for both graphics and entity data in odd writers:
        // the first 310 run after 92/160 is the graphics (ezdxf load_proxy_data)
        if (proxyGraphics === undefined && c.code() === 310) proxyGraphics = c.chunks();
        break;
      }
      case 96:
      case 162:
        c.skip();
        c.chunks(311);
        break;
      case 93:
      case 161:
        entityDataBits = c.int();
        if (c.code() === 310) entityData = c.chunks();
        break;
      case 330:
      case 340:
      case 350:
      case 360:
        objectIds.push(c.handle());
        break;
      case 95:
        dwgFormat = c.int();
        break;
      case 70:
        originalFormat = c.int();
        break;
      default:
        c.skip();
    }
  }
  return {
    ...base,
    type: "ACAD_PROXY_ENTITY",
    proxyClassId,
    applicationClassId,
    proxyGraphics: proxyGraphics ?? base.proxyGraphics,
    entityData,
    entityDataBits,
    objectIds,
    dwgFormat,
    originalFormat,
  };
});
