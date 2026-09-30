/**
 * LEADER, MULTILEADER (DXF name MULTILEADER, alias MLEADER) and TOLERANCE.
 * research/notes/05-dimensions-leaders.md §11 (LEADER), §12 (MULTILEADER context data), §13
 * (TOLERANCE). All points are WCS unless noted. LEADER and TOLERANCE honour the XDATA DSTYLE
 * overrides like DIMENSION (§3).
 */
import { TagCursor } from "../cursor.ts";
import { readDimStyleOverrides } from "../dimstyle.ts";
import { fieldTable, readFields } from "../fields.ts";
import type { DxfRecord } from "../record.ts";
import type { DimValue } from "../tables.ts";
import type { Point3 } from "../types.ts";
import { type EntityBase, registerEntity } from "./common.ts";

const Z = Object.freeze({ x: 0, y: 0, z: 1 });
const X = Object.freeze({ x: 1, y: 0, z: 0 });
const Y = Object.freeze({ x: 0, y: 1, z: 0 });
const O = Object.freeze({ x: 0, y: 0, z: 0 });
const ONE = Object.freeze({ x: 1, y: 1, z: 1 });
const BY_BLOCK_RAW = -1056964608;

// ---- LEADER ------------------------------------------------------------------------------

export interface LeaderEntity extends EntityBase {
  readonly type: "LEADER";
  readonly dimStyle: string;
  /** 71; AutoCAD assumes 1 when absent (note 05 §11.1). */
  readonly arrowhead: boolean;
  /** 72: 0 straight, 1 spline (vertices are fit points). */
  readonly pathType: number;
  /** 73: 0 MTEXT, 1 tolerance, 2 block reference, 3 none. */
  readonly creationFlag: number;
  /** 74: 1 = hook opposite to 211 (the DXF reference has the meaning swapped, note 05 §11.1). */
  readonly hookDirection: number;
  readonly hasHook: boolean;
  readonly textHeight: number;
  readonly textWidth: number;
  /** WCS; first = arrow point. The hook line is stored as the last vertex. */
  readonly vertices: readonly Point3[];
  /** 77: color used when DIMCLRD = BYBLOCK. */
  readonly byBlockColor: number | undefined;
  /** 340: annotation (MTEXT / TOLERANCE / INSERT). */
  readonly annotationHandle: string | undefined;
  readonly normal: Point3;
  /** 211 "horizontal" direction. */
  readonly horizontalDirection: Point3;
  readonly blockOffset: Point3;
  readonly annotationOffset: Point3;
  /** XDATA DSTYLE overrides (code → value). */
  readonly overrides: ReadonlyMap<number, DimValue>;
}

const L = "AcDbLeader";
const LEADER = fieldTable([
  { name: "dimStyle", code: 3, kind: "name", subclass: L, def: "Standard" },
  { name: "arrowhead", code: 71, kind: "bool", subclass: L, def: true },
  { name: "pathType", code: 72, kind: "int", subclass: L, def: 0 },
  { name: "creationFlag", code: 73, kind: "int", subclass: L, def: 3 },
  { name: "hookDirection", code: 74, kind: "int", subclass: L, def: 0 },
  { name: "hasHook", code: 75, kind: "bool", subclass: L, def: false },
  { name: "textHeight", code: 40, kind: "num", subclass: L, def: 0 },
  { name: "textWidth", code: 41, kind: "num", subclass: L, def: 0 },
  { name: "vertices", code: 10, kind: "p3", subclass: L, many: true },
  { name: "byBlockColor", code: 77, kind: "int", subclass: L },
  { name: "annotationHandle", code: 340, kind: "handle", subclass: L },
  { name: "normal", code: 210, kind: "p3", subclass: L, def: Z },
  { name: "horizontalDirection", code: 211, kind: "p3", subclass: L, def: X },
  { name: "blockOffset", code: 212, kind: "p3", subclass: L, def: O },
  { name: "annotationOffset", code: 213, kind: "p3", subclass: L, def: O },
]);

registerEntity<LeaderEntity>("LEADER", (rec, base) => ({
  ...readFields<Omit<LeaderEntity, "overrides">>(rec, LEADER, { ...base, type: "LEADER" }),
  overrides: readDimStyleOverrides(rec),
}));

// ---- TOLERANCE ---------------------------------------------------------------------------

export interface ToleranceEntity extends EntityBase {
  readonly type: "TOLERANCE";
  readonly dimStyle: string;
  /** WCS insertion point (left end of the vertical middle of the first row). */
  readonly insert: Point3;
  /** Frame string: rows separated by ^J, fields by %%v, gdt symbols as {\Fgdt;x} (note 05 §13.2). */
  readonly text: string;
  readonly extrusion: Point3;
  /** 11: x-axis direction (WCS). */
  readonly direction: Point3;
  readonly overrides: ReadonlyMap<number, DimValue>;
}

const F = "AcDbFcf";
const TOLERANCE = fieldTable([
  { name: "dimStyle", code: 3, kind: "name", subclass: F, def: "Standard" },
  { name: "insert", code: 10, kind: "p3", subclass: F, def: O },
  { name: "text", code: 1, kind: "str", subclass: F, def: "" },
  { name: "extrusion", code: 210, kind: "p3", subclass: F, def: Z },
  { name: "direction", code: 11, kind: "p3", subclass: F, def: X },
]);

registerEntity<ToleranceEntity>("TOLERANCE", (rec, base) => ({
  ...readFields<Omit<ToleranceEntity, "overrides">>(rec, TOLERANCE, { ...base, type: "TOLERANCE" }),
  overrides: readDimStyleOverrides(rec),
}));

// ---- MULTILEADER ------------------------------------------------------------------------

export interface MLeaderBreak {
  /** LEADER_LINE break index (90) this break belongs to; undefined for dogleg breaks. */
  readonly index: number | undefined;
  readonly start: Point3;
  readonly end: Point3;
}

export interface MLeaderLine {
  /** WCS; first = arrow tip. The leader continues to the LEADER's `lastLeaderPoint`. */
  readonly vertices: readonly Point3[];
  readonly breaks: readonly MLeaderBreak[];
  /** 91 */
  readonly index: number;
  /** 92 raw color (see raw-color.ts); BYBLOCK = use the entity leader color. */
  readonly color: number;
  /** R2010+ per-line overrides (ODA p.214), undefined when absent. */
  readonly leaderType: number | undefined;
  readonly lineweight: number | undefined;
  readonly linetypeHandle: string | undefined;
  readonly arrowHandle: string | undefined;
  readonly arrowSize: number | undefined;
  readonly overrideFlags: number | undefined;
}

export interface MLeaderLeader {
  /** 290; AutoCAD hides the leader if 0. */
  readonly hasLastLeaderLine: boolean;
  readonly hasDoglegVector: boolean;
  /** 10: landing / dogleg start point, WCS. */
  readonly lastLeaderPoint: Point3;
  /** 11: dogleg direction (unit). */
  readonly doglegVector: Point3;
  /** 12/13 pairs: dogleg breaks. */
  readonly breaks: readonly MLeaderBreak[];
  /** 90 branch index. */
  readonly index: number;
  /** 40, already scaled. */
  readonly doglegLength: number;
  readonly lines: readonly MLeaderLine[];
  /** 271: 0 horizontal, 1 vertical (R2010+). */
  readonly attachmentDirection: number;
}

export interface MLeaderMText {
  /** 304: MTEXT content string. */
  readonly text: string;
  /** 11 */
  readonly normal: Point3;
  /** 340 STYLE handle. */
  readonly styleHandle: string;
  /** 12: MTEXT insertion point (WCS). */
  readonly insert: Point3;
  /** 13: text direction; wins over `rotation`. */
  readonly direction: Point3;
  /** 42, radians. */
  readonly rotation: number;
  /** 43 */
  readonly width: number;
  readonly definedHeight: number;
  readonly lineSpacingFactor: number;
  readonly lineSpacingStyle: number;
  /** 90 raw color. */
  readonly color: number;
  /** 171: MTEXT attachment point 1..9. */
  readonly attachment: number;
  readonly flowDirection: number;
  /** 91 raw color. */
  readonly bgColor: number;
  readonly bgScale: number;
  readonly bgTransparency: number;
  readonly bgUseWindowColor: boolean;
  readonly bgFill: boolean;
  readonly columnType: number;
  readonly columnAutoHeight: boolean;
  readonly columnWidth: number;
  readonly columnGutter: number;
  readonly columnFlowReversed: boolean;
  readonly columnSizes: readonly number[];
  readonly wordBreak: boolean;
}

export interface MLeaderBlock {
  /** 341 BLOCK_RECORD handle. */
  readonly blockRecordHandle: string;
  readonly normal: Point3;
  /** 15: block location, **WCS**. */
  readonly insert: Point3;
  readonly scale: Point3;
  /** 46, radians. */
  readonly rotation: number;
  /** 93 raw color. */
  readonly color: number;
  /** 47 × 16 (transposed; not used by AutoCAD). */
  readonly matrix: readonly number[];
}

export interface MLeaderContext {
  /** 40: effective overall scale (≈0 ⇒ render nothing). */
  readonly scale: number;
  /** 10: content base point (not the MTEXT insert, note 05 §12.1). */
  readonly basePoint: Point3;
  /** 41: text height, already scaled. */
  readonly textHeight: number;
  /** 140: arrowhead size, scaled. */
  readonly arrowSize: number;
  /** 145: landing gap, scaled. */
  readonly landingGap: number;
  readonly leftAttachment: number;
  readonly rightAttachment: number;
  /** 176: 0 left, 1 center, 2 right. */
  readonly textAlign: number;
  /** 177: 0 content extents, 1 insertion point. */
  readonly attachmentType: number;
  readonly mtext: MLeaderMText | undefined;
  readonly block: MLeaderBlock | undefined;
  readonly planeOrigin: Point3;
  readonly planeXAxis: Point3;
  readonly planeYAxis: Point3;
  readonly planeNormalReversed: boolean;
  readonly leaders: readonly MLeaderLeader[];
  readonly topAttachment: number;
  readonly bottomAttachment: number;
}

export interface MLeaderBlockAttribute {
  /** 330 ATTDEF handle. */
  readonly attdefHandle: string;
  readonly index: number;
  readonly width: number;
  readonly text: string;
}

export interface MultiLeaderEntity extends EntityBase {
  readonly type: "MULTILEADER";
  readonly version: number;
  readonly context: MLeaderContext;
  /** 340 MLEADERSTYLE handle. */
  readonly styleHandle: string | undefined;
  /** 90 property override flags (entity values win regardless, note 05 §12.4). */
  readonly overrideFlags: number;
  /** 170: 0 invisible, 1 straight, 2 spline. */
  readonly leaderType: number;
  /** 91 raw color. */
  readonly leaderColor: number;
  readonly leaderLinetypeHandle: string | undefined;
  readonly leaderLineweight: number;
  readonly landing: boolean;
  readonly dogleg: boolean;
  /** 41, unscaled. */
  readonly doglegLength: number;
  /** 342; undefined = closed filled. */
  readonly arrowHandle: string | undefined;
  /** 42, unscaled. */
  readonly arrowSize: number;
  /** 172: 0 none, 1 block, 2 MTEXT, 3 tolerance. */
  readonly contentType: number;
  readonly textStyleHandle: string | undefined;
  readonly textLeftAttachment: number;
  readonly textRightAttachment: number;
  readonly textAngleType: number;
  readonly textAlignment: number;
  readonly textColor: number;
  readonly textFrame: boolean;
  readonly blockHandle: string | undefined;
  readonly blockColor: number;
  readonly blockScale: Point3;
  /** 43, radians. */
  readonly blockRotation: number;
  readonly blockConnection: number;
  readonly annotative: boolean;
  /** 94/345 pairs: per-leader-line arrow overrides. */
  readonly arrowHeads: readonly { readonly index: number; readonly handle: string }[];
  /** 330/177/44/302 groups: block attribute values. */
  readonly blockAttributes: readonly MLeaderBlockAttribute[];
  readonly textDirectionNegative: boolean;
  readonly textAlignInIPE: number;
  /** 179: 1 left, 2 center, 3 right. */
  readonly textAttachmentPoint: number;
  /** 45 (R2007+). */
  readonly scale: number;
  readonly textAttachmentDirection: number;
  readonly bottomAttachment: number;
  readonly topAttachment: number;
  readonly leaderExtendedToText: boolean;
}

const MTEXT_CODES = new Set([
  304, 11, 340, 12, 13, 42, 43, 44, 45, 170, 90, 171, 172, 91, 141, 92, 291, 292, 173, 293, 142, 143, 294,
  144, 295,
]);
const BLOCK_CODES = new Set([341, 14, 15, 16, 46, 93, 47]);

function readMText(c: TagCursor): MLeaderMText {
  const m: Record<string, unknown> = {
    text: "",
    normal: Z,
    styleHandle: "0",
    insert: O,
    direction: X,
    rotation: 0,
    width: 0,
    definedHeight: 0,
    lineSpacingFactor: 1,
    lineSpacingStyle: 1,
    color: BY_BLOCK_RAW,
    attachment: 1,
    flowDirection: 1,
    bgColor: -939524096,
    bgScale: 1.5,
    bgTransparency: 0,
    bgUseWindowColor: false,
    bgFill: false,
    columnType: 0,
    columnAutoHeight: false,
    columnWidth: 0,
    columnGutter: 0,
    columnFlowReversed: false,
    wordBreak: true,
  };
  const columnSizes: number[] = [];
  while (MTEXT_CODES.has(c.code())) {
    switch (c.code()) {
      case 304:
        m.text = c.str();
        break;
      case 11:
        m.normal = c.point();
        break;
      case 340:
        m.styleHandle = c.handle();
        break;
      case 12:
        m.insert = c.point();
        break;
      case 13:
        m.direction = c.point();
        break;
      case 42:
        m.rotation = c.num();
        break;
      case 43:
        m.width = c.num();
        break;
      case 44:
        m.definedHeight = c.num();
        break;
      case 45:
        m.lineSpacingFactor = c.num();
        break;
      case 170:
        m.lineSpacingStyle = c.int();
        break;
      case 90:
        m.color = c.int();
        break;
      case 171:
        m.attachment = c.int();
        break;
      case 172:
        m.flowDirection = c.int();
        break;
      case 91:
        m.bgColor = c.int();
        break;
      case 141:
        m.bgScale = c.num();
        break;
      case 92:
        m.bgTransparency = c.int();
        break;
      case 291:
        m.bgUseWindowColor = c.bool();
        break;
      case 292:
        m.bgFill = c.bool();
        break;
      case 173:
        m.columnType = c.int();
        break;
      case 293:
        m.columnAutoHeight = c.bool();
        break;
      case 142:
        m.columnWidth = c.num();
        break;
      case 143:
        m.columnGutter = c.num();
        break;
      case 294:
        m.columnFlowReversed = c.bool();
        break;
      case 144:
        columnSizes.push(c.num());
        break;
      case 295:
        m.wordBreak = c.bool();
        break;
    }
  }
  return { ...(m as unknown as MLeaderMText), columnSizes };
}

function readBlock(c: TagCursor): MLeaderBlock {
  let blockRecordHandle = "0";
  let normal: Point3 = Z;
  let insert: Point3 = O;
  let scale: Point3 = ONE;
  let rotation = 0;
  let color = BY_BLOCK_RAW;
  const matrix: number[] = [];
  while (BLOCK_CODES.has(c.code())) {
    switch (c.code()) {
      case 341:
        blockRecordHandle = c.handle();
        break;
      case 14:
        normal = c.point();
        break;
      case 15:
        insert = c.point();
        break;
      case 16:
        scale = c.point();
        break;
      case 46:
        rotation = c.num();
        break;
      case 93:
        color = c.int();
        break;
      case 47:
        matrix.push(c.num());
        break;
    }
  }
  return { blockRecordHandle, normal, insert, scale, rotation, color, matrix };
}

function readLeaderLine(c: TagCursor): MLeaderLine {
  c.skip(); // 304 LEADER_LINE{
  const vertices: Point3[] = [];
  const breaks: MLeaderBreak[] = [];
  let breakIndex: number | undefined;
  let breakStart: Point3 | undefined;
  let index = 0;
  let color = BY_BLOCK_RAW;
  let leaderType: number | undefined;
  let lineweight: number | undefined;
  let linetypeHandle: string | undefined;
  let arrowHandle: string | undefined;
  let arrowSize: number | undefined;
  let overrideFlags: number | undefined;
  while (!c.done && c.code() !== 305) {
    switch (c.code()) {
      case 10:
        vertices.push(c.point());
        break;
      case 90:
        breakIndex = c.int();
        break;
      case 11:
        breakStart = c.point();
        break;
      case 12: {
        const end = c.point();
        breaks.push({ index: breakIndex, start: breakStart ?? end, end });
        breakStart = undefined;
        break;
      }
      case 91:
        index = c.int();
        break;
      case 92:
        color = c.int();
        break;
      case 170:
        leaderType = c.int();
        break;
      case 171:
        lineweight = c.int();
        break;
      case 340:
        linetypeHandle = c.handle();
        break;
      case 341:
        arrowHandle = c.handle();
        break;
      case 40:
        arrowSize = c.num();
        break;
      case 93:
        overrideFlags = c.int();
        break;
      default:
        c.skip();
    }
  }
  if (c.code() === 305) c.skip();
  return {
    vertices,
    breaks,
    index,
    color,
    leaderType,
    lineweight,
    linetypeHandle,
    arrowHandle,
    arrowSize,
    overrideFlags,
  };
}

function readLeader(c: TagCursor): MLeaderLeader {
  c.skip(); // 302 LEADER{
  let hasLastLeaderLine = false;
  let hasDoglegVector = false;
  let lastLeaderPoint: Point3 = O;
  let doglegVector: Point3 = X;
  const breaks: MLeaderBreak[] = [];
  let breakStart: Point3 | undefined;
  let index = 0;
  let doglegLength = 0;
  const lines: MLeaderLine[] = [];
  let attachmentDirection = 0;
  while (!c.done && c.code() !== 303) {
    switch (c.code()) {
      case 304:
        if (c.isStr(304, "LEADER_LINE{")) lines.push(readLeaderLine(c));
        else c.skip();
        break;
      case 290:
        hasLastLeaderLine = c.bool();
        break;
      case 291:
        hasDoglegVector = c.bool();
        break;
      case 10:
        lastLeaderPoint = c.point();
        break;
      case 11:
        doglegVector = c.point();
        break;
      case 12:
        breakStart = c.point();
        break;
      case 13: {
        const end = c.point();
        breaks.push({ index: undefined, start: breakStart ?? end, end });
        breakStart = undefined;
        break;
      }
      case 90:
        index = c.int();
        break;
      case 40:
        doglegLength = c.num();
        break;
      case 271:
        attachmentDirection = c.int();
        break;
      default:
        c.skip();
    }
  }
  if (c.code() === 303) c.skip();
  return {
    hasLastLeaderLine,
    hasDoglegVector,
    lastLeaderPoint,
    doglegVector,
    breaks,
    index,
    doglegLength,
    lines,
    attachmentDirection,
  };
}

function readContext(c: TagCursor): MLeaderContext {
  c.skip(); // 300 CONTEXT_DATA{
  const x: Record<string, unknown> = {
    scale: 1,
    basePoint: O,
    textHeight: 0,
    arrowSize: 0,
    landingGap: 0,
    leftAttachment: 1,
    rightAttachment: 1,
    textAlign: 0,
    attachmentType: 0,
    mtext: undefined,
    block: undefined,
    planeOrigin: O,
    planeXAxis: X,
    planeYAxis: Y,
    planeNormalReversed: false,
    topAttachment: 9,
    bottomAttachment: 9,
  };
  const leaders: MLeaderLeader[] = [];
  while (!c.done && c.code() !== 301) {
    switch (c.code()) {
      case 302:
        if (c.isStr(302, "LEADER{")) leaders.push(readLeader(c));
        else c.skip();
        break;
      case 290:
        if (c.bool()) x.mtext = readMText(c);
        break;
      case 296:
        if (c.bool()) x.block = readBlock(c);
        break;
      case 40:
        x.scale = c.num();
        break;
      case 10:
        x.basePoint = c.point();
        break;
      case 41:
        x.textHeight = c.num();
        break;
      case 140:
        x.arrowSize = c.num();
        break;
      case 145:
        x.landingGap = c.num();
        break;
      case 174:
        x.leftAttachment = c.int();
        break;
      case 175:
        x.rightAttachment = c.int();
        break;
      case 176:
        x.textAlign = c.int();
        break;
      case 177:
        x.attachmentType = c.int();
        break;
      case 110:
        x.planeOrigin = c.point();
        break;
      case 111:
        x.planeXAxis = c.point();
        break;
      case 112:
        x.planeYAxis = c.point();
        break;
      case 297:
        x.planeNormalReversed = c.bool();
        break;
      case 272:
        x.topAttachment = c.int();
        break;
      case 273:
        x.bottomAttachment = c.int();
        break;
      default:
        c.skip();
    }
  }
  if (c.code() === 301) c.skip();
  return { ...(x as unknown as MLeaderContext), leaders };
}

const EMPTY_CONTEXT: MLeaderContext = {
  scale: 1,
  basePoint: O,
  textHeight: 0,
  arrowSize: 0,
  landingGap: 0,
  leftAttachment: 1,
  rightAttachment: 1,
  textAlign: 0,
  attachmentType: 0,
  mtext: undefined,
  block: undefined,
  planeOrigin: O,
  planeXAxis: X,
  planeYAxis: Y,
  planeNormalReversed: false,
  leaders: [],
  topAttachment: 9,
  bottomAttachment: 9,
};

export function parseMultiLeader(rec: DxfRecord, base: EntityBase): MultiLeaderEntity {
  const c = TagCursor.subclass(rec, "AcDbMLeader");
  let context = EMPTY_CONTEXT;
  const e: Record<string, unknown> = {
    version: 2,
    styleHandle: undefined,
    overrideFlags: 0,
    leaderType: 1,
    leaderColor: BY_BLOCK_RAW,
    leaderLinetypeHandle: undefined,
    leaderLineweight: -2,
    landing: true,
    dogleg: true,
    doglegLength: 0,
    arrowHandle: undefined,
    arrowSize: 0,
    contentType: 2,
    textStyleHandle: undefined,
    textLeftAttachment: 1,
    textRightAttachment: 1,
    textAngleType: 1,
    textAlignment: 0,
    textColor: BY_BLOCK_RAW,
    textFrame: false,
    blockHandle: undefined,
    blockColor: BY_BLOCK_RAW,
    blockScale: ONE,
    blockRotation: 0,
    blockConnection: 0,
    annotative: false,
    textDirectionNegative: false,
    textAlignInIPE: 0,
    textAttachmentPoint: 1,
    scale: 1,
    textAttachmentDirection: 0,
    bottomAttachment: 9,
    topAttachment: 9,
    leaderExtendedToText: false,
  };
  const arrowHeads: { index: number; handle: string }[] = [];
  const blockAttributes: MLeaderBlockAttribute[] = [];
  let arrowIndex = 0;
  let attr: { attdefHandle: string; index: number; width: number; text: string } | undefined;
  const flushAttr = () => {
    if (attr) blockAttributes.push(attr);
    attr = undefined;
  };
  while (!c.done) {
    const code = c.code();
    switch (code) {
      case 300:
        if (c.isStr(300, "CONTEXT_DATA{")) context = readContext(c);
        else c.skip();
        break;
      case 270:
        e.version = c.int();
        break;
      case 340:
        e.styleHandle = c.handle();
        break;
      case 90:
        e.overrideFlags = c.int();
        break;
      case 170:
        e.leaderType = c.int();
        break;
      case 91:
        e.leaderColor = c.int();
        break;
      case 341:
        e.leaderLinetypeHandle = c.handle();
        break;
      case 171:
        e.leaderLineweight = c.int();
        break;
      case 290:
        e.landing = c.bool();
        break;
      case 291:
        e.dogleg = c.bool();
        break;
      case 41:
        e.doglegLength = c.num();
        break;
      case 342:
        e.arrowHandle = c.handle();
        break;
      case 42:
        e.arrowSize = c.num();
        break;
      case 172:
        e.contentType = c.int();
        break;
      case 343:
        e.textStyleHandle = c.handle();
        break;
      case 173:
        e.textLeftAttachment = c.int();
        break;
      case 95:
        e.textRightAttachment = c.int();
        break;
      case 174:
        e.textAngleType = c.int();
        break;
      case 175:
        e.textAlignment = c.int();
        break;
      case 92:
        e.textColor = c.int();
        break;
      case 292:
        e.textFrame = c.bool();
        break;
      case 344:
        e.blockHandle = c.handle();
        break;
      case 93:
        e.blockColor = c.int();
        break;
      case 10:
        e.blockScale = c.point();
        break;
      case 43:
        e.blockRotation = c.num();
        break;
      case 176:
        e.blockConnection = c.int();
        break;
      case 293:
        e.annotative = c.bool();
        break;
      case 94:
        arrowIndex = c.int();
        break;
      case 345:
        arrowHeads.push({ index: arrowIndex, handle: c.handle() });
        break;
      case 330:
        flushAttr();
        attr = { attdefHandle: c.handle(), index: 0, width: 1, text: "" };
        break;
      case 177:
        if (attr) attr.index = c.int();
        else c.skip();
        break;
      case 44:
        if (attr) attr.width = c.num();
        else c.skip();
        break;
      case 302:
        if (attr) attr.text = c.str();
        else c.skip();
        break;
      case 294:
        e.textDirectionNegative = c.bool();
        break;
      case 178:
        e.textAlignInIPE = c.int();
        break;
      case 179:
        e.textAttachmentPoint = c.int();
        break;
      case 45:
        e.scale = c.num();
        break;
      case 271:
        e.textAttachmentDirection = c.int();
        break;
      case 272:
        e.bottomAttachment = c.int();
        break;
      case 273:
        e.topAttachment = c.int();
        break;
      case 295:
        e.leaderExtendedToText = c.bool();
        break;
      default:
        c.skip();
    }
  }
  flushAttr();
  return {
    ...base,
    ...(e as object),
    type: "MULTILEADER",
    context,
    arrowHeads,
    blockAttributes,
  } as unknown as MultiLeaderEntity;
}

registerEntity(["MULTILEADER", "MLEADER"], parseMultiLeader);
