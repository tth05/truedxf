/**
 * IMAGE, WIPEOUT, PDF/DWF/DGN underlays and OLE2FRAME.
 * research/notes/07-blocks-inserts-misc.md §8 (IMAGE), §9 (WIPEOUT), §10 (UNDERLAY), §11 (OLE2FRAME).
 */
import { TagCursor } from "../cursor.ts";
import { fieldTable, readFields } from "../fields.ts";
import type { DxfRecord } from "../record.ts";
import type { Point2, Point3 } from "../types.ts";
import { type EntityBase, registerEntity } from "./common.ts";

const Z = Object.freeze({ x: 0, y: 0, z: 1 });
const O = Object.freeze({ x: 0, y: 0, z: 0 });

/** IMAGE display flags (70). */
export const ImageFlags = {
  Show: 1,
  ShowUnaligned: 2,
  UseClipping: 4,
  Transparency: 8,
} as const;

/**
 * Raster image placement (IMAGE and WIPEOUT share it). World transform of a pixel-space point
 * (x right, y down, pixel (0,0) centre at 0,0): `insert + (x + 0.5)·u + (h − y − 0.5)·v`
 * (note 07 §8.1).
 */
export interface RasterImageProps {
  readonly classVersion: number;
  /** WCS: lower-left corner of the image. */
  readonly insert: Point3;
  /** WCS vector of one pixel along the bottom edge. */
  readonly u: Point3;
  /** WCS vector of one pixel along the left edge (up). */
  readonly v: Point3;
  /** Size in pixels (13/23); WIPEOUT: (1, 1). */
  readonly size: Point2;
  /** 340 → IMAGEDEF ("0" for WIPEOUT). */
  readonly imageDefHandle: string | undefined;
  /** 70 ImageFlags. */
  readonly displayFlags: number;
  /** 280 */
  readonly clipping: boolean;
  readonly brightness: number;
  readonly contrast: number;
  readonly fade: number;
  readonly imageDefReactorHandle: string | undefined;
  /** 71: 1 rectangular (2 corner points), 2 polygonal. */
  readonly clipType: number;
  /** Clip boundary in **pixel** coordinates (WIPEOUT: normalized to −0.5 … 0.5). */
  readonly clipBoundary: readonly Point2[];
  /** 290 (R2010+): false = show inside (normal), true = inverted (hide inside). */
  readonly clipInverted: boolean;
}

export interface ImageEntity extends EntityBase, RasterImageProps {
  readonly type: "IMAGE";
}

export interface WipeoutEntity extends EntityBase, RasterImageProps {
  readonly type: "WIPEOUT";
}

const RASTER_SUB = ["AcDbRasterImage", "AcDbWipeout"];
const RASTER = fieldTable([
  { name: "classVersion", code: 90, kind: "int", subclass: RASTER_SUB, def: 0 },
  { name: "insert", code: 10, kind: "p3", subclass: RASTER_SUB, def: O },
  { name: "u", code: 11, kind: "p3", subclass: RASTER_SUB, def: { x: 1, y: 0, z: 0 } },
  { name: "v", code: 12, kind: "p3", subclass: RASTER_SUB, def: { x: 0, y: 1, z: 0 } },
  { name: "size", code: 13, kind: "p2", subclass: RASTER_SUB, def: { x: 1, y: 1 } },
  { name: "imageDefHandle", code: 340, kind: "handle", subclass: RASTER_SUB },
  { name: "displayFlags", code: 70, kind: "int", subclass: RASTER_SUB, def: 3 },
  { name: "clipping", code: 280, kind: "bool", subclass: RASTER_SUB, def: false },
  { name: "brightness", code: 281, kind: "int", subclass: RASTER_SUB, def: 50 },
  { name: "contrast", code: 282, kind: "int", subclass: RASTER_SUB, def: 50 },
  { name: "fade", code: 283, kind: "int", subclass: RASTER_SUB, def: 0 },
  { name: "imageDefReactorHandle", code: 360, kind: "handle", subclass: RASTER_SUB },
  { name: "clipType", code: 71, kind: "int", subclass: RASTER_SUB, def: 1 },
  { name: "clipBoundary", code: 14, kind: "p2", subclass: RASTER_SUB, many: true },
  { name: "clipInverted", code: 290, kind: "bool", subclass: RASTER_SUB, def: false },
]);

function nonNull(h: string | undefined): string | undefined {
  return h && h !== "0" ? h : undefined;
}

function rasterParser<T extends "IMAGE" | "WIPEOUT">(type: T) {
  return (rec: DxfRecord, base: EntityBase) => {
    const f = readFields<RasterImageProps>(rec, RASTER);
    return {
      ...base,
      ...f,
      type,
      imageDefHandle: nonNull(f.imageDefHandle),
      imageDefReactorHandle: nonNull(f.imageDefReactorHandle),
    };
  };
}

registerEntity<ImageEntity>("IMAGE", rasterParser("IMAGE"));
registerEntity<WipeoutEntity>("WIPEOUT", rasterParser("WIPEOUT"));

// ---- underlays ---------------------------------------------------------------------------

/** Underlay flags (280). */
export const UnderlayFlags = {
  Clipping: 1,
  On: 2,
  Monochrome: 4,
  AdjustForBackground: 8,
  ClipInverted: 16,
} as const;

export interface UnderlayEntity extends EntityBase {
  readonly type: "PDFUNDERLAY" | "DWFUNDERLAY" | "DGNUNDERLAY";
  /** 340 → PDFDEFINITION / DWFDEFINITION / DGNDEFINITION. */
  readonly definitionHandle: string | undefined;
  /** OCS insertion point. */
  readonly insert: Point3;
  readonly scale: Point3;
  /** Degrees, about the OCS z axis. */
  readonly rotation: number;
  readonly extrusion: Point3;
  /** 280 UnderlayFlags. */
  readonly flags: number;
  readonly contrast: number;
  readonly fade: number;
  /** 11/21: 2 points = rectangle, more = polygon; underlay-local units before scaling. */
  readonly clipBoundary: readonly Point2[];
}

const U = "AcDbUnderlayReference";
const UNDERLAY = fieldTable([
  { name: "definitionHandle", code: 340, kind: "handle", subclass: U },
  { name: "insert", code: 10, kind: "p3", subclass: U, def: O },
  { name: "sx", code: 41, kind: "num", subclass: U, def: 1 },
  { name: "sy", code: 42, kind: "num", subclass: U, def: 1 },
  { name: "sz", code: 43, kind: "num", subclass: U, def: 1 },
  { name: "rotation", code: 50, kind: "num", subclass: U, def: 0 },
  { name: "extrusion", code: 210, kind: "p3", subclass: U, def: Z },
  { name: "flags", code: 280, kind: "int", subclass: U, def: 2 },
  { name: "contrast", code: 281, kind: "int", subclass: U, def: 100 },
  { name: "fade", code: 282, kind: "int", subclass: U, def: 0 },
  { name: "clipBoundary", code: 11, kind: "p2", subclass: U, many: true },
]);

function underlayParser(type: UnderlayEntity["type"]) {
  return (rec: DxfRecord, base: EntityBase): UnderlayEntity => {
    const { sx, sy, sz, ...f } = readFields<
      Omit<UnderlayEntity, keyof EntityBase | "scale"> & { sx: number; sy: number; sz: number }
    >(rec, UNDERLAY);
    return {
      ...base,
      ...f,
      type,
      scale: { x: sx, y: sy, z: sz },
      definitionHandle: nonNull(f.definitionHandle),
    };
  };
}

registerEntity("PDFUNDERLAY", underlayParser("PDFUNDERLAY"));
registerEntity("DWFUNDERLAY", underlayParser("DWFUNDERLAY"));
registerEntity("DGNUNDERLAY", underlayParser("DGNUNDERLAY"));
// PDFREFERENCE is an alias of PDFUNDERLAY (note 07 §10.1)
registerEntity("PDFREFERENCE", underlayParser("PDFUNDERLAY"));

// ---- OLE2FRAME ---------------------------------------------------------------------------

export interface Ole2FrameEntity extends EntityBase {
  readonly type: "OLE2FRAME";
  readonly version: number;
  /** 3: descriptive string (e.g. "Paintbrush Picture"). */
  readonly description: string;
  /** 10: upper-left corner (WCS). */
  readonly upperLeft: Point3;
  /** 11: lower-right corner (WCS). */
  readonly lowerRight: Point3;
  /** 71: 1 link, 2 embedded, 3 static. */
  readonly objectType: number;
  /** 72: 0 model space, 1 paper space. */
  readonly tileMode: number;
  /** 90 declared length. */
  readonly dataLength: number;
  /**
   * 310 payload: 0x80-byte AutoCAD header (u16 marker, four Point3d corners UL, UR, LR, LL → rotated
   * frames) followed by an MS-CFB compound document (note 07 §11).
   */
  readonly data: Uint8Array;
}

registerEntity<Ole2FrameEntity>("OLE2FRAME", (rec, base) => {
  const c = TagCursor.subclass(rec, "AcDbOle2Frame");
  let version = 2;
  let description = "";
  let upperLeft: Point3 = O;
  let lowerRight: Point3 = O;
  let objectType = 2;
  let tileMode = 0;
  let dataLength = 0;
  const chunks: Uint8Array[] = [];
  while (!c.done) {
    switch (c.code()) {
      case 70:
        version = c.int();
        break;
      case 3:
        description = c.str();
        break;
      case 10:
        upperLeft = c.point();
        break;
      case 11:
        lowerRight = c.point();
        break;
      case 71:
        objectType = c.int();
        break;
      case 72:
        tileMode = c.int();
        break;
      case 90:
        dataLength = c.int();
        break;
      case 310:
        chunks.push(c.binary());
        break;
      default:
        c.skip();
    }
  }
  let n = 0;
  for (const b of chunks) n += b.length;
  const data = new Uint8Array(n);
  let o = 0;
  for (const b of chunks) {
    data.set(b, o);
    o += b.length;
  }
  return {
    ...base,
    type: "OLE2FRAME",
    version,
    description,
    upperLeft,
    lowerRight,
    objectType,
    tileMode,
    dataLength,
    data,
  };
});
