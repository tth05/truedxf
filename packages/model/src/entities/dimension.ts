/**
 * DIMENSION (all subtypes), ARC_DIMENSION, LARGE_RADIAL_DIMENSION.
 * research/notes/05-dimensions-leaders.md §1 (codes, 70 flags, definition points per subtype),
 * §3 (XDATA DSTYLE overrides). Render the `*D` block (`blockName`); the definition points are
 * only needed for regeneration (note 05 §0).
 *
 * Coordinate systems: 10, 13, 14, 15 are WCS; 11, 12, 16 are OCS (extrusion 210). Inside the
 * `*D` block all entities are in the dimension's OCS (note 05 §1.2).
 */
import { readDimStyleOverrides } from "../dimstyle.ts";
import { type FieldDef, fieldTable, readFields } from "../fields.ts";
import type { DimValue } from "../tables.ts";
import type { Point3 } from "../types.ts";
import { type EntityBase, registerEntity } from "./common.ts";

const Z = Object.freeze({ x: 0, y: 0, z: 1 });
const O = Object.freeze({ x: 0, y: 0, z: 0 });

/** Low nibble of group 70 (note 05 §1.3). */
export const DimensionType = {
    Linear: 0,
    Aligned: 1,
    Angular: 2,
    Diameter: 3,
    Radius: 4,
    Angular3Point: 5,
    Ordinate: 6,
    /** ARC_DIMENSION in R2018+ (5 up to R2013): dispatch on the DXF type, not on 70. */
    Arc: 8,
} as const;

export type DimensionSubtype =
    | "linear"
    | "aligned"
    | "angular"
    | "diameter"
    | "radius"
    | "angular3p"
    | "ordinate"
    | "arc"
    | "largeRadial"
    | "unknown";

export interface DimensionEntity extends EntityBase {
    readonly type: "DIMENSION" | "ARC_DIMENSION" | "LARGE_RADIAL_DIMENSION";
    /** Derived from the DXF type and 70 & 0x0F. */
    readonly subtype: DimensionSubtype;
    /** 280 (0 = R2010). */
    readonly version: number;
    /** Geometry block `*D<n>` (2); "" if absent (e.g. dimensional constraints). */
    readonly blockName: string;
    /** 3; resolve case-insensitively, "Standard" if absent. */
    readonly dimStyle: string;
    /** Raw group 70 (type | 32 block-used | 64 ordinate X | 128 user text position). */
    readonly flags: number;
    /** 70 & 0x0F. */
    readonly dimType: number;
    /** 70 & 64 (ordinate only): X-type ordinate. */
    readonly ordinateX: boolean;
    /** 70 & 128: text moved to a user-defined position. */
    readonly userTextPosition: boolean;
    /** 10, WCS; meaning per subtype (note 05 §1.4). */
    readonly defPoint: Point3;
    /** 11, OCS text midpoint; its z is the elevation of the block content. */
    readonly textMidpoint: Point3 | undefined;
    /** 12, OCS clone insertion point (Baseline/Continue); usually 0,0,0. */
    readonly clonePoint: Point3;
    /** 71, MTEXT attachment 1..9 (default 5). */
    readonly attachment: number;
    readonly lineSpacingStyle: number;
    readonly lineSpacingFactor: number;
    /** 42: raw measurement (drawing units, radians for angular), informative. */
    readonly measurement: number | undefined;
    readonly flipArrow1: boolean;
    readonly flipArrow2: boolean;
    /**
     * 1: undefined/"" /"<>" = measured text, " " = suppressed, otherwise literal text where the
     * first `<>` is replaced by the measurement (note 05 §1.5).
     */
    readonly textOverride: string | undefined;
    /** 52, degrees; 0 or absent = not oblique (note 05 §1.6). */
    readonly obliqueAngle: number;
    /** 53, degrees, OCS; undefined = automatic orientation. */
    readonly textRotation: number | undefined;
    /** 51: negative of the UCS X angle at creation (degrees). */
    readonly horizontalDirection: number;
    readonly extrusion: Point3;
    /** 13, WCS (linear/aligned: ext line 1 origin; angular: line 1 start; ordinate: feature …). */
    readonly defPoint2: Point3 | undefined;
    /** 14, WCS. */
    readonly defPoint3: Point3 | undefined;
    /** 15, WCS (radius/diameter: point on the curve; angular3p/arc: vertex / arc center). */
    readonly defPoint4: Point3 | undefined;
    /** 16, OCS (2-line angular: point on the dim arc; ARC_DIMENSION: leader point 1). */
    readonly defPoint5: Point3 | undefined;
    /** 17 (ARC_DIMENSION leader point 2). */
    readonly defPoint6: Point3 | undefined;
    /** 50, degrees: dimension line angle of linear dims. */
    readonly angle: number;
    /** 40: leader length (radius/diameter), ARC_DIMENSION start parameter (rad), jog angle (large radial). */
    readonly leaderLength: number;
    /** ARC_DIMENSION: 40/41 start/end parameters of the measured arc (radians). */
    readonly arcStart: number;
    readonly arcEnd: number;
    /** ARC_DIMENSION 70. */
    readonly isPartial: boolean;
    /** ARC_DIMENSION 71. */
    readonly hasLeader: boolean;
    /** Dimensional constraint (no block, layer `*ADSK_CONSTRAINTS`): not annotation, not plotted. */
    readonly isConstraint: boolean;
    /** XDATA `ACAD {DSTYLE}` overrides: DIMSTYLE group code → value (note 05 §3). */
    readonly overrides: ReadonlyMap<number, DimValue>;
}

const DIM = "AcDbDimension";
const LINEAR = ["AcDbAlignedDimension", "AcDbRotatedDimension"];
const SUB = [
    ...LINEAR,
    "AcDb3PointAngularDimension",
    "AcDb2LineAngularDimension",
    "AcDbDiametricDimension",
    "AcDbRadialDimension",
    "AcDbOrdinateDimension",
    "AcDbArcDimension",
    "AcDbRadialDimensionLarge",
];
const ARC = "AcDbArcDimension";

const DIM_FIELDS: FieldDef[] = [
    { name: "version", code: 280, kind: "int", subclass: DIM, def: 0 },
    { name: "blockName", code: 2, kind: "name", subclass: DIM, def: "" },
    { name: "dimStyle", code: 3, kind: "name", subclass: DIM, def: "Standard" },
    { name: "defPoint", code: 10, kind: "p3", subclass: DIM, def: O },
    { name: "textMidpoint", code: 11, kind: "p3", subclass: DIM },
    // spec puts 12 and 52 into AcDbAlignedDimension, AutoCAD/ezdxf write them into AcDbDimension
    { name: "clonePoint", code: 12, kind: "p3", subclass: [DIM, ...LINEAR], def: O },
    { name: "flags", code: 70, kind: "int", subclass: DIM, def: 0 },
    { name: "attachment", code: 71, kind: "int", subclass: DIM, def: 5 },
    { name: "lineSpacingStyle", code: 72, kind: "int", subclass: DIM, def: 1 },
    { name: "lineSpacingFactor", code: 41, kind: "num", subclass: DIM, def: 1 },
    { name: "measurement", code: 42, kind: "num", subclass: DIM },
    { name: "flipArrow1", code: 74, kind: "bool", subclass: DIM, def: false },
    { name: "flipArrow2", code: 75, kind: "bool", subclass: DIM, def: false },
    { name: "textOverride", code: 1, kind: "str", subclass: DIM },
    { name: "obliqueAngle", code: 52, kind: "num", subclass: [DIM, ...LINEAR], def: 0 },
    { name: "textRotation", code: 53, kind: "num", subclass: DIM },
    { name: "horizontalDirection", code: 51, kind: "num", subclass: DIM, def: 0 },
    { name: "extrusion", code: 210, kind: "p3", subclass: DIM, def: Z },
    { name: "defPoint2", code: 13, kind: "p3", subclass: SUB },
    { name: "defPoint3", code: 14, kind: "p3", subclass: SUB },
    { name: "defPoint4", code: 15, kind: "p3", subclass: SUB },
    { name: "defPoint5", code: 16, kind: "p3", subclass: SUB },
    { name: "defPoint6", code: 17, kind: "p3", subclass: SUB },
    { name: "angle", code: 50, kind: "num", subclass: LINEAR, def: 0 },
    { name: "leaderLength", code: 40, kind: "num", subclass: SUB, def: 0 },
    { name: "arcEnd", code: 41, kind: "num", subclass: ARC, def: 0 },
    { name: "isPartial", code: 70, kind: "bool", subclass: ARC, def: false },
    { name: "hasLeader", code: 71, kind: "bool", subclass: ARC, def: false },
];
const TABLE = fieldTable(DIM_FIELDS);

const SUBTYPES: readonly DimensionSubtype[] = [
    "linear",
    "aligned",
    "angular",
    "diameter",
    "radius",
    "angular3p",
    "ordinate",
];

type DimFields = Omit<DimensionEntity, keyof EntityBase | "subtype" | "dimType" | "ordinateX">;

function parseDimension(type: DimensionEntity["type"]) {
    return (rec: Parameters<Parameters<typeof registerEntity>[1]>[0], base: EntityBase): DimensionEntity => {
        const f = readFields<DimFields>(rec, TABLE);
        const dimType = f.flags & 0x0f;
        const subtype: DimensionSubtype =
            type === "ARC_DIMENSION"
                ? "arc"
                : type === "LARGE_RADIAL_DIMENSION"
                  ? "largeRadial"
                  : (SUBTYPES[dimType] ?? "unknown");
        return {
            ...base,
            ...f,
            type,
            subtype,
            dimType,
            ordinateX: (f.flags & 64) !== 0,
            userTextPosition: (f.flags & 128) !== 0,
            arcStart: f.leaderLength,
            isConstraint: f.blockName === "" && base.layer.toUpperCase() === "*ADSK_CONSTRAINTS",
            overrides: readDimStyleOverrides(rec),
        };
    };
}

registerEntity("DIMENSION", parseDimension("DIMENSION"));
registerEntity("ARC_DIMENSION", parseDimension("ARC_DIMENSION"));
registerEntity("LARGE_RADIAL_DIMENSION", parseDimension("LARGE_RADIAL_DIMENSION"));
