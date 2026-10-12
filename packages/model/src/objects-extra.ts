/**
 * Further OBJECTS: DICTIONARYVAR, MLINESTYLE, MLEADERSTYLE, TABLESTYLE, IMAGEDEF,
 * IMAGEDEF_REACTOR, RASTERVARIABLES, WIPEOUTVARIABLES, SPATIAL_FILTER, GROUP, SCALE,
 * PDF/DWF/DGNDEFINITION and a richer XRECORD (typed payload).
 * research/notes/02-tables-objects.md §3.5–§3.18, 07-blocks-inserts-misc.md §7–§10.
 */
import { TagCursor } from "./cursor.ts";
import { type FieldDef, fieldTable, readFields } from "./fields.ts";
import { type DictionaryObject, type DxfObject, registerObject, type XRecordObject } from "./objects.ts";
import type { DxfRecord } from "./record.ts";
import { type TypedTag, xrecordTags } from "./tags.ts";
import type { Point2, Point3 } from "./types.ts";

const Z = Object.freeze({ x: 0, y: 0, z: 1 });
const O = Object.freeze({ x: 0, y: 0, z: 0 });
const BY_BLOCK_RAW = -1056964608;

function objectBase(rec: DxfRecord): DxfObject {
    return {
        type: rec.type,
        dxfType: rec.type,
        handle: rec.handle,
        owner: rec.owner,
        extensionDictionary: rec.extensionDictionary,
        record: rec,
    };
}

function simpleObject<T extends DxfObject>(type: string, defs: readonly FieldDef[]): (rec: DxfRecord) => T {
    const table = fieldTable(defs);
    return (rec) => readFields<T>(rec, table, { ...objectBase(rec), type } as Record<string, unknown>);
}

// ---- DICTIONARYVAR -----------------------------------------------------------------------

/** System variable stored outside the HEADER (key = entry name in AcDbVariableDictionary). */
export interface DictionaryVarObject extends DxfObject {
    readonly type: "DICTIONARYVAR";
    readonly schema: number;
    /** Value as string (e.g. CANNOSCALE "1:1", WIPEOUTFRAME "1"). */
    readonly value: string;
}

registerObject(
    "DICTIONARYVAR",
    simpleObject<DictionaryVarObject>("DICTIONARYVAR", [
        { name: "schema", code: 280, kind: "int", def: 0 },
        { name: "value", code: 1, kind: "str", def: "" },
    ]),
);

// ---- MLINESTYLE ----------------------------------------------------------------------------

export interface MLineStyleElement {
    /** 49: offset from the reference line (unscaled). */
    readonly offset: number;
    /** 62: ACI (spec default 0 = BYBLOCK; AutoCAD writes 256). */
    readonly color: number;
    readonly trueColor: number | undefined;
    /** 6: linetype name (BYLAYER / BYBLOCK / table name). */
    readonly linetype: string;
}

/** MLINESTYLE flags (70). */
export const MLineStyleFlags = {
    Fill: 1,
    Miters: 2,
    StartSquareCap: 16,
    StartInnerArcs: 32,
    StartRoundCap: 64,
    EndSquareCap: 256,
    EndInnerArcs: 512,
    EndRoundCap: 1024,
} as const;

export interface MLineStyleObject extends DxfObject {
    readonly type: "MLINESTYLE";
    /** 2 (the dictionary key is authoritative). */
    readonly name: string;
    readonly flags: number;
    readonly description: string;
    readonly fillColor: number;
    readonly fillTrueColor: number | undefined;
    /** Degrees. */
    readonly startAngle: number;
    readonly endAngle: number;
    /** In file order (not sorted by offset). */
    readonly elements: readonly MLineStyleElement[];
}

function parseMLineStyle(rec: DxfRecord): MLineStyleObject {
    const c = TagCursor.subclass(rec, "AcDbMlineStyle");
    let name = "";
    let flags = 0;
    let description = "";
    let fillColor = 256;
    let fillTrueColor: number | undefined;
    let startAngle = 90;
    let endAngle = 90;
    const elements: { offset: number; color: number; trueColor: number | undefined; linetype: string }[] = [];
    let inElements = false;
    while (!c.done) {
        const code = c.code();
        if (inElements) {
            if (code === 49)
                elements.push({ offset: c.num(), color: 256, trueColor: undefined, linetype: "BYLAYER" });
            else if (code === 62 && elements.length) elements[elements.length - 1]!.color = c.int();
            else if (code === 420 && elements.length) elements[elements.length - 1]!.trueColor = c.int();
            else if (code === 6 && elements.length) elements[elements.length - 1]!.linetype = c.str().trim();
            else c.skip();
            continue;
        }
        switch (code) {
            case 2:
                name = c.str().trim();
                break;
            case 70:
                flags = c.int();
                break;
            case 3:
                description = c.str();
                break;
            case 62:
                fillColor = c.int();
                break;
            case 420:
                fillTrueColor = c.int();
                break;
            case 51:
                startAngle = c.num();
                break;
            case 52:
                endAngle = c.num();
                break;
            case 71:
                c.skip();
                inElements = true;
                break;
            default:
                c.skip();
        }
    }
    return {
        ...objectBase(rec),
        type: "MLINESTYLE",
        name,
        flags,
        description,
        fillColor,
        fillTrueColor,
        startAngle,
        endAngle,
        elements,
    };
}
registerObject("MLINESTYLE", parseMLineStyle);

// ---- MLEADERSTYLE --------------------------------------------------------------------------

/** MLEADERSTYLE (note 02 §3.10). Colors are raw AcCmColor values (see raw-color.ts). */
export interface MLeaderStyleObject extends DxfObject {
    readonly type: "MLEADERSTYLE";
    readonly unknown179: number;
    /** 170: 0 none, 1 block, 2 MTEXT, 3 tolerance. */
    readonly contentType: number;
    readonly drawMLeaderOrder: number;
    readonly drawLeaderOrder: number;
    readonly maxLeaderPoints: number;
    /** Radians. */
    readonly firstSegmentAngle: number;
    readonly secondSegmentAngle: number;
    /** 173: 0 invisible, 1 straight, 2 spline. */
    readonly leaderType: number;
    readonly leaderColor: number;
    readonly leaderLinetypeHandle: string | undefined;
    readonly leaderLineweight: number;
    readonly landing: boolean;
    readonly landingGap: number;
    readonly dogleg: boolean;
    readonly doglegLength: number;
    /** 3 (the real name is the dictionary key). */
    readonly description: string;
    /** 341; undefined = closed filled. */
    readonly arrowHandle: string | undefined;
    readonly arrowSize: number;
    readonly defaultText: string;
    readonly textStyleHandle: string | undefined;
    readonly textLeftAttachment: number;
    readonly textRightAttachment: number;
    readonly textAngleType: number;
    readonly textAlignment: number;
    readonly textColor: number;
    readonly textHeight: number;
    readonly textFrame: boolean;
    readonly textAlignAlwaysLeft: boolean;
    readonly alignSpace: number;
    readonly blockHandle: string | undefined;
    readonly blockColor: number;
    readonly blockScale: Point3;
    readonly blockScaleEnabled: boolean;
    /** Radians. */
    readonly blockRotation: number;
    readonly blockRotationEnabled: boolean;
    readonly blockConnection: number;
    readonly scale: number;
    readonly overwritePropertyValue: boolean;
    readonly annotative: boolean;
    readonly breakGapSize: number;
    readonly textAttachmentDirection: number;
    readonly bottomAttachment: number;
    readonly topAttachment: number;
}

const MLS = "AcDbMLeaderStyle";
const MLEADERSTYLE_FIELDS: FieldDef[] = [
    { name: "unknown179", code: 179, kind: "int", subclass: MLS, def: 2 },
    { name: "contentType", code: 170, kind: "int", subclass: MLS, def: 2 },
    { name: "drawMLeaderOrder", code: 171, kind: "int", subclass: MLS, def: 1 },
    { name: "drawLeaderOrder", code: 172, kind: "int", subclass: MLS, def: 0 },
    { name: "maxLeaderPoints", code: 90, kind: "int", subclass: MLS, def: 2 },
    { name: "firstSegmentAngle", code: 40, kind: "num", subclass: MLS, def: 0 },
    { name: "secondSegmentAngle", code: 41, kind: "num", subclass: MLS, def: 0 },
    { name: "leaderType", code: 173, kind: "int", subclass: MLS, def: 1 },
    { name: "leaderColor", code: 91, kind: "int", subclass: MLS, def: BY_BLOCK_RAW },
    { name: "leaderLinetypeHandle", code: 340, kind: "handle", subclass: MLS },
    { name: "leaderLineweight", code: 92, kind: "int", subclass: MLS, def: -2 },
    { name: "landing", code: 290, kind: "bool", subclass: MLS, def: true },
    { name: "landingGap", code: 42, kind: "num", subclass: MLS, def: 0.09 },
    { name: "dogleg", code: 291, kind: "bool", subclass: MLS, def: true },
    { name: "doglegLength", code: 43, kind: "num", subclass: MLS, def: 0.36 },
    { name: "description", code: 3, kind: "str", subclass: MLS, def: "" },
    { name: "arrowHandle", code: 341, kind: "handle", subclass: MLS },
    { name: "arrowSize", code: 44, kind: "num", subclass: MLS, def: 0.18 },
    { name: "defaultText", code: 300, kind: "str", subclass: MLS, def: "" },
    { name: "textStyleHandle", code: 342, kind: "handle", subclass: MLS },
    { name: "textLeftAttachment", code: 174, kind: "int", subclass: MLS, def: 1 },
    { name: "textRightAttachment", code: 178, kind: "int", subclass: MLS, def: 1 },
    { name: "textAngleType", code: 175, kind: "int", subclass: MLS, def: 1 },
    { name: "textAlignment", code: 176, kind: "int", subclass: MLS, def: 0 },
    { name: "textColor", code: 93, kind: "int", subclass: MLS, def: BY_BLOCK_RAW },
    { name: "textHeight", code: 45, kind: "num", subclass: MLS, def: 0.18 },
    { name: "textFrame", code: 292, kind: "bool", subclass: MLS, def: false },
    { name: "textAlignAlwaysLeft", code: 297, kind: "bool", subclass: MLS, def: false },
    { name: "alignSpace", code: 46, kind: "num", subclass: MLS, def: 0.18 },
    { name: "blockHandle", code: 343, kind: "handle", subclass: MLS },
    { name: "blockColor", code: 94, kind: "int", subclass: MLS, def: BY_BLOCK_RAW },
    { name: "bsx", code: 47, kind: "num", subclass: MLS, def: 1 },
    { name: "bsy", code: 49, kind: "num", subclass: MLS, def: 1 },
    { name: "bsz", code: 140, kind: "num", subclass: MLS, def: 1 },
    { name: "blockScaleEnabled", code: 293, kind: "bool", subclass: MLS, def: true },
    { name: "blockRotation", code: 141, kind: "num", subclass: MLS, def: 0 },
    { name: "blockRotationEnabled", code: 294, kind: "bool", subclass: MLS, def: true },
    { name: "blockConnection", code: 177, kind: "int", subclass: MLS, def: 0 },
    { name: "scale", code: 142, kind: "num", subclass: MLS, def: 1 },
    { name: "overwritePropertyValue", code: 295, kind: "bool", subclass: MLS, def: false },
    { name: "annotative", code: 296, kind: "bool", subclass: MLS, def: false },
    { name: "breakGapSize", code: 143, kind: "num", subclass: MLS, def: 0.125 },
    { name: "textAttachmentDirection", code: 271, kind: "int", subclass: MLS, def: 0 },
    { name: "bottomAttachment", code: 272, kind: "int", subclass: MLS, def: 9 },
    { name: "topAttachment", code: 273, kind: "int", subclass: MLS, def: 9 },
];
const MLEADERSTYLE = fieldTable(MLEADERSTYLE_FIELDS);

function nonNull(h: string | undefined): string | undefined {
    return h && h !== "0" ? h : undefined;
}

registerObject("MLEADERSTYLE", (rec) => {
    const { bsx, bsy, bsz, ...f } = readFields<
        Omit<MLeaderStyleObject, keyof DxfObject | "blockScale"> & { bsx: number; bsy: number; bsz: number }
    >(rec, MLEADERSTYLE);
    const o: MLeaderStyleObject = {
        ...objectBase(rec),
        ...f,
        type: "MLEADERSTYLE",
        blockScale: { x: bsx, y: bsy, z: bsz },
        arrowHandle: nonNull(f.arrowHandle),
        blockHandle: nonNull(f.blockHandle),
    };
    return o;
});

// ---- TABLESTYLE ----------------------------------------------------------------------------

export interface TableStyleCell {
    /** 7: text style *name*. */
    readonly textStyle: string;
    readonly textHeight: number;
    readonly alignment: number;
    readonly textColor: number;
    readonly fillColor: number;
    readonly fillEnabled: boolean;
    readonly dataType: number;
    readonly unitType: number;
    readonly format: string;
    /** 274–279 border lineweights (horizontal top, inside, bottom, vertical left, inside, right). */
    readonly borderLineweights: readonly number[];
    /** 284–289 border visibility. */
    readonly borderVisible: readonly boolean[];
    /** 64–69 border colors (ACI). */
    readonly borderColors: readonly number[];
}

export interface TableStyleObject extends DxfObject {
    readonly type: "TABLESTYLE";
    readonly version: number;
    readonly description: string;
    readonly flowDirection: number;
    readonly flags: number;
    readonly horizontalMargin: number;
    readonly verticalMargin: number;
    readonly suppressTitle: boolean;
    readonly suppressHeader: boolean;
    /** Cell styles in file order (data, title, header in AutoCAD files). */
    readonly cells: readonly TableStyleCell[];
}

function parseTableStyle(rec: DxfRecord): TableStyleObject {
    const c = TagCursor.subclass(rec, "AcDbTableStyle");
    let version = 0;
    let description = "";
    let flowDirection = 0;
    let flags = 0;
    let horizontalMargin = 0.06;
    let verticalMargin = 0.06;
    let suppressTitle = false;
    let suppressHeader = false;
    let seen280 = false;
    const cells: {
        textStyle: string;
        textHeight: number;
        alignment: number;
        textColor: number;
        fillColor: number;
        fillEnabled: boolean;
        dataType: number;
        unitType: number;
        format: string;
        borderLineweights: number[];
        borderVisible: boolean[];
        borderColors: number[];
    }[] = [];
    while (!c.done) {
        const code = c.code();
        const cell = cells[cells.length - 1];
        if (code === 7) {
            cells.push({
                textStyle: c.str().trim(),
                textHeight: 0.18,
                alignment: 5,
                textColor: 0,
                fillColor: 7,
                fillEnabled: false,
                dataType: 512,
                unitType: 0,
                format: "",
                borderLineweights: [-2, -2, -2, -2, -2, -2],
                borderVisible: [true, true, true, true, true, true],
                borderColors: [0, 0, 0, 0, 0, 0],
            });
            continue;
        }
        if (cell) {
            if (code === 140) cell.textHeight = c.num();
            else if (code === 170) cell.alignment = c.int();
            else if (code === 62) cell.textColor = c.int();
            else if (code === 63) cell.fillColor = c.int();
            else if (code === 283) cell.fillEnabled = c.bool();
            else if (code === 90) cell.dataType = c.int();
            else if (code === 91) cell.unitType = c.int();
            else if (code === 1) cell.format = c.str();
            else if (code >= 274 && code <= 279) cell.borderLineweights[code - 274] = c.int();
            else if (code >= 284 && code <= 289) cell.borderVisible[code - 284] = c.bool();
            else if (code >= 64 && code <= 69) cell.borderColors[code - 64] = c.int();
            else c.skip();
            continue;
        }
        switch (code) {
            case 280:
                if (seen280) suppressTitle = c.bool();
                else version = c.int();
                seen280 = true;
                break;
            case 3:
                description = c.str();
                break;
            case 70:
                flowDirection = c.int();
                break;
            case 71:
                flags = c.int();
                break;
            case 40:
                horizontalMargin = c.num();
                break;
            case 41:
                verticalMargin = c.num();
                break;
            case 281:
                suppressHeader = c.bool();
                break;
            default:
                c.skip();
        }
    }
    return {
        ...objectBase(rec),
        type: "TABLESTYLE",
        version,
        description,
        flowDirection,
        flags,
        horizontalMargin,
        verticalMargin,
        suppressTitle,
        suppressHeader,
        cells,
    };
}
registerObject("TABLESTYLE", parseTableStyle);

// ---- raster: IMAGEDEF, IMAGEDEF_REACTOR, RASTERVARIABLES, WIPEOUTVARIABLES -----------------

export interface ImageDefObject extends DxfObject {
    readonly type: "IMAGEDEF";
    readonly classVersion: number;
    /** 1: file path (absolute, relative or bare name; backslashes). */
    readonly fileName: string;
    /** 10/20: image size in pixels. */
    readonly size: Point2;
    /** 11/21 (not 11/12 as the spec says): default pixel size in drawing units. */
    readonly pixelSize: Point2;
    readonly loaded: boolean;
    /** 281: 0 none, 2 cm, 5 inch. */
    readonly resolutionUnits: number;
}

registerObject(
    "IMAGEDEF",
    simpleObject<ImageDefObject>("IMAGEDEF", [
        { name: "classVersion", code: 90, kind: "int", def: 0 },
        { name: "fileName", code: 1, kind: "str", def: "" },
        { name: "size", code: 10, kind: "p2", def: { x: 1, y: 1 } },
        { name: "pixelSize", code: 11, kind: "p2", def: { x: 1, y: 1 } },
        { name: "loaded", code: 280, kind: "bool", def: true },
        { name: "resolutionUnits", code: 281, kind: "int", def: 0 },
    ]),
);

export interface ImageDefReactorObject extends DxfObject {
    readonly type: "IMAGEDEF_REACTOR";
    readonly classVersion: number;
    /** 330 in AcDbRasterImageDefReactor: the IMAGE. */
    readonly imageHandle: string | undefined;
}

registerObject(
    "IMAGEDEF_REACTOR",
    simpleObject<ImageDefReactorObject>("IMAGEDEF_REACTOR", [
        { name: "classVersion", code: 90, kind: "int", subclass: "AcDbRasterImageDefReactor", def: 2 },
        { name: "imageHandle", code: 330, kind: "handle", subclass: "AcDbRasterImageDefReactor" },
    ]),
);

/** RASTERVARIABLES (root key ACAD_IMAGE_VARS): 70 = IMAGEFRAME (whether image borders plot). */
export interface RasterVariablesObject extends DxfObject {
    readonly type: "RASTERVARIABLES";
    readonly classVersion: number;
    /** 0 no frame, 1 frame (2 = displayed not plotted?, note 07 §8.3 UNKNOWN). */
    readonly frame: number;
    /** 0 draft, 1 high (screen only). */
    readonly quality: number;
    /** 0 none, 1 mm, 2 cm, 3 m, 4 km, 5 in, 6 ft, 7 yd, 8 mi. */
    readonly units: number;
}

registerObject(
    "RASTERVARIABLES",
    simpleObject<RasterVariablesObject>("RASTERVARIABLES", [
        { name: "classVersion", code: 90, kind: "int", def: 0 },
        { name: "frame", code: 70, kind: "int", def: 1 },
        { name: "quality", code: 71, kind: "int", def: 1 },
        { name: "units", code: 72, kind: "int", def: 0 },
    ]),
);

/** WIPEOUTVARIABLES (root key ACAD_WIPEOUT_VARS): 70 = WIPEOUTFRAME. */
export interface WipeoutVariablesObject extends DxfObject {
    readonly type: "WIPEOUTVARIABLES";
    readonly frame: number;
}

registerObject(
    "WIPEOUTVARIABLES",
    simpleObject<WipeoutVariablesObject>("WIPEOUTVARIABLES", [
        { name: "frame", code: 70, kind: "int", def: 0 },
    ]),
);

// ---- underlay definitions -------------------------------------------------------------------

export interface UnderlayDefinitionObject extends DxfObject {
    readonly type: "PDFDEFINITION" | "DWFDEFINITION" | "DGNDEFINITION";
    readonly fileName: string;
    /** PDF: page number as string; DGN: model name; DWF: sheet name. */
    readonly name: string;
}

for (const t of ["PDFDEFINITION", "DWFDEFINITION", "DGNDEFINITION"] as const)
    registerObject(
        t,
        simpleObject<UnderlayDefinitionObject>(t, [
            { name: "fileName", code: 1, kind: "str", def: "" },
            { name: "name", code: 2, kind: "str", def: "" },
        ]),
    );

// ---- SPATIAL_FILTER --------------------------------------------------------------------------

/** XCLIP boundary (INSERT xdict ACAD_FILTER → SPATIAL), note 02 §3.13 / 07 §7. */
export interface SpatialFilterObject extends DxfObject {
    readonly type: "SPATIAL_FILTER";
    /** 2 points = rectangle (lower-left, upper-right), more = polygon; clip-boundary CS. */
    readonly boundary: readonly Point2[];
    readonly extrusion: Point3;
    /** 11: origin of the boundary's local CS. */
    readonly origin: Point3;
    readonly enabled: boolean;
    readonly frontClip: number | undefined;
    readonly backClip: number | undefined;
    /**
     * Inverse of the INSERT transform at clip time: 12 values, row-major 3×4
     * [m00 m01 m02 tx, m10 m11 m12 ty, m20 m21 m22 tz] (ezdxf `to_matrix`).
     */
    readonly inverseInsertMatrix: readonly number[];
    /** Transform into the clip-boundary CS, same layout. */
    readonly clipMatrix: readonly number[];
}

const IDENTITY_3X4 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

function parseSpatialFilter(rec: DxfRecord): SpatialFilterObject {
    const c = TagCursor.subclass(rec, "AcDbSpatialFilter");
    const boundary: Point2[] = [];
    let extrusion: Point3 = Z;
    let origin: Point3 = O;
    let enabled = true;
    let hasFront = false;
    let hasBack = false;
    let frontClip: number | undefined;
    let backClip: number | undefined;
    const values: number[] = [];
    while (!c.done) {
        switch (c.code()) {
            case 70:
                c.skip();
                break;
            case 10:
                boundary.push(c.point2());
                break;
            case 210:
                extrusion = c.point();
                break;
            case 11:
                origin = c.point();
                break;
            case 71:
                enabled = c.bool();
                break;
            case 72:
                hasFront = c.bool();
                // the front distance (40) directly follows the flag and is not a matrix value
                if (hasFront && c.code() === 40) frontClip = c.num();
                break;
            case 73:
                hasBack = c.bool();
                if (hasBack && c.code() === 41) backClip = c.num();
                break;
            case 40:
                values.push(c.num());
                break;
            case 41:
                backClip = c.num();
                break;
            default:
                c.skip();
        }
    }
    // the matrices are the last 24 values (ezdxf)
    const m = values.slice(-24);
    return {
        ...objectBase(rec),
        type: "SPATIAL_FILTER",
        boundary,
        extrusion,
        origin,
        enabled,
        frontClip,
        backClip: hasBack ? backClip : undefined,
        inverseInsertMatrix: m.length === 24 ? m.slice(0, 12) : IDENTITY_3X4,
        clipMatrix: m.length === 24 ? m.slice(12) : IDENTITY_3X4,
    };
}
registerObject("SPATIAL_FILTER", parseSpatialFilter);

// ---- GROUP, SCALE ---------------------------------------------------------------------------

export interface GroupObject extends DxfObject {
    readonly type: "GROUP";
    readonly description: string;
    /** 70 = 1: unnamed. */
    readonly unnamed: boolean;
    readonly selectable: boolean;
    readonly memberHandles: readonly string[];
}

registerObject(
    "GROUP",
    simpleObject<GroupObject>("GROUP", [
        { name: "description", code: 300, kind: "str", subclass: "AcDbGroup", def: "" },
        { name: "unnamed", code: 70, kind: "bool", subclass: "AcDbGroup", def: false },
        { name: "selectable", code: 71, kind: "bool", subclass: "AcDbGroup", def: true },
        { name: "memberHandles", code: 340, kind: "handle", subclass: "AcDbGroup", many: true },
    ]),
);

/** Annotation scale: scale = paperUnits / drawingUnits. */
export interface ScaleObject extends DxfObject {
    readonly type: "SCALE";
    readonly name: string;
    readonly paperUnits: number;
    readonly drawingUnits: number;
    /** 290: the 1:1 entry. */
    readonly isUnitScale: boolean;
}

registerObject(
    "SCALE",
    simpleObject<ScaleObject>("SCALE", [
        { name: "name", code: 300, kind: "str", subclass: "AcDbScale", def: "" },
        { name: "paperUnits", code: 140, kind: "num", subclass: "AcDbScale", def: 1 },
        { name: "drawingUnits", code: 141, kind: "num", subclass: "AcDbScale", def: 1 },
        { name: "isUnitScale", code: 290, kind: "bool", subclass: "AcDbScale", def: false },
    ]),
);

// ---- XRECORD ------------------------------------------------------------------------------

/** XRECORD with its payload as typed tags (no point joining: XRECORD tags are a raw bag). */
export interface XRecordDataObject extends XRecordObject {
    /** Payload tags after the 280 cloning flag, computed lazily. */
    readonly tags: readonly TypedTag[];
}

registerObject("XRECORD", (rec) => {
    let tags: TypedTag[] | undefined;
    const o = {
        ...objectBase(rec),
        type: "XRECORD",
        cloning: rec.num(280, 1),
        get tags(): TypedTag[] {
            tags ??= xrecordTags(rec);
            return tags;
        },
    };
    return o as XRecordDataObject;
});

// ---- helpers ------------------------------------------------------------------------------

/** Minimal document interface (avoids a dependency on document.ts). */
export interface ObjectLookup {
    namedObject(key: string): DxfObject | undefined;
    getObject(handle: string): DxfObject | undefined;
}

/**
 * DICTIONARYVAR values of the root `AcDbVariableDictionary` (e.g. CANNOSCALE, WIPEOUTFRAME,
 * XCLIPFRAME), keyed by upper-cased variable name (note 02 §3.6).
 */
export function dictionaryVariables(doc: ObjectLookup): Map<string, string> {
    const out = new Map<string, string>();
    const dict = doc.namedObject("AcDbVariableDictionary") as DictionaryObject | undefined;
    if (dict?.type !== "DICTIONARY") return out;
    for (const e of dict.entries) {
        const o = doc.getObject(e.handle);
        if (o?.type === "DICTIONARYVAR") out.set(e.key.toUpperCase(), (o as DictionaryVarObject).value);
    }
    return out;
}
