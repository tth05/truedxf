/**
 * Simple geometric entities. Group codes: research/notes/03-entities-geometry.md §3.
 * OCS vs WCS per entity is documented there (§2); the model stores values as written.
 */
import type { Point2, Point3 } from "../types.ts";
import { type EntityBase, registerEntity, simpleParser } from "./common.ts";

const Z = Object.freeze({ x: 0, y: 0, z: 1 });
const O = Object.freeze({ x: 0, y: 0, z: 0 });

export interface LineEntity extends EntityBase {
  readonly type: "LINE";
  /** WCS */
  readonly start: Point3;
  readonly end: Point3;
  readonly thickness: number;
  readonly extrusion: Point3;
}

export interface PointEntity extends EntityBase {
  readonly type: "POINT";
  /** WCS */
  readonly location: Point3;
  readonly thickness: number;
  /** Degrees: angle of the X axis of the UCS in effect when the point was drawn (PDMODE symbols). */
  readonly angle: number;
  readonly extrusion: Point3;
}

export interface CircleEntity extends EntityBase {
  readonly type: "CIRCLE";
  /** OCS */
  readonly center: Point3;
  readonly radius: number;
  readonly thickness: number;
  readonly extrusion: Point3;
}

export interface ArcEntity extends EntityBase {
  readonly type: "ARC";
  /** OCS */
  readonly center: Point3;
  readonly radius: number;
  /** Degrees, counter-clockwise in the OCS. */
  readonly startAngle: number;
  readonly endAngle: number;
  readonly thickness: number;
  readonly extrusion: Point3;
}

export interface EllipseEntity extends EntityBase {
  readonly type: "ELLIPSE";
  /** WCS */
  readonly center: Point3;
  /** WCS vector from center to the major axis end point. */
  readonly majorAxis: Point3;
  readonly ratio: number;
  /** Parameters in radians (not angles); full ellipse 0..2π. */
  readonly startParam: number;
  readonly endParam: number;
  readonly extrusion: Point3;
}

/** SOLID and TRACE: vertex order 1-2-4-3 when drawn (note 03 §3). */
export interface SolidEntity extends EntityBase {
  readonly type: "SOLID" | "TRACE";
  /** OCS */
  readonly v0: Point3;
  readonly v1: Point3;
  readonly v2: Point3;
  /** Absent in 3-vertex solids: then equal to v2. */
  readonly v3: Point3;
  readonly thickness: number;
  readonly extrusion: Point3;
}

export interface Face3dEntity extends EntityBase {
  readonly type: "3DFACE";
  /** WCS */
  readonly v0: Point3;
  readonly v1: Point3;
  readonly v2: Point3;
  readonly v3: Point3;
  /** Invisible edge flags: 1 first, 2 second, 4 third, 8 fourth edge. */
  readonly invisibleEdges: number;
}

export interface RayEntity extends EntityBase {
  readonly type: "RAY" | "XLINE";
  /** WCS */
  readonly start: Point3;
  readonly direction: Point3;
}

export interface SplineEntity extends EntityBase {
  readonly type: "SPLINE";
  /** Plane normal (the spline itself is WCS). */
  readonly normal: Point3 | undefined;
  /** 1 closed, 2 periodic, 4 rational, 8 planar, 16 linear; higher bits: knot parameterization. */
  readonly flags: number;
  readonly degree: number;
  readonly knots: number[];
  readonly weights: number[];
  readonly controlPoints: Point3[];
  readonly fitPoints: Point3[];
  readonly startTangent: Point3 | undefined;
  readonly endTangent: Point3 | undefined;
  readonly knotTolerance: number;
  readonly controlPointTolerance: number;
  readonly fitTolerance: number;
}

export interface ShapeEntity extends EntityBase {
  readonly type: "SHAPE";
  readonly insert: Point3;
  readonly size: number;
  readonly name: string;
  readonly rotation: number;
  readonly widthFactor: number;
  readonly oblique: number;
  readonly thickness: number;
  readonly extrusion: Point3;
}

export type Point2D = Point2;

registerEntity(
  "LINE",
  simpleParser<LineEntity>("LINE", [
    { name: "start", code: 10, kind: "p3", subclass: "AcDbLine", def: O },
    { name: "end", code: 11, kind: "p3", subclass: "AcDbLine", def: O },
    { name: "thickness", code: 39, kind: "num", subclass: "AcDbLine", def: 0 },
    { name: "extrusion", code: 210, kind: "p3", subclass: "AcDbLine", def: Z },
  ]),
);

registerEntity(
  "POINT",
  simpleParser<PointEntity>("POINT", [
    { name: "location", code: 10, kind: "p3", subclass: "AcDbPoint", def: O },
    { name: "thickness", code: 39, kind: "num", subclass: "AcDbPoint", def: 0 },
    { name: "extrusion", code: 210, kind: "p3", subclass: "AcDbPoint", def: Z },
    { name: "angle", code: 50, kind: "num", subclass: "AcDbPoint", def: 0 },
  ]),
);

const CIRCLE_FIELDS = [
  { name: "center", code: 10, kind: "p3", subclass: "AcDbCircle", def: O },
  { name: "radius", code: 40, kind: "num", subclass: "AcDbCircle", def: 0 },
  { name: "thickness", code: 39, kind: "num", subclass: "AcDbCircle", def: 0 },
  { name: "extrusion", code: 210, kind: "p3", subclass: "AcDbCircle", def: Z },
] as const;

registerEntity("CIRCLE", simpleParser<CircleEntity>("CIRCLE", CIRCLE_FIELDS));

registerEntity(
  "ARC",
  simpleParser<ArcEntity>("ARC", [
    ...CIRCLE_FIELDS,
    { name: "startAngle", code: 50, kind: "num", subclass: "AcDbArc", def: 0 },
    { name: "endAngle", code: 51, kind: "num", subclass: "AcDbArc", def: 360 },
  ]),
);

registerEntity(
  "ELLIPSE",
  simpleParser<EllipseEntity>("ELLIPSE", [
    { name: "center", code: 10, kind: "p3", subclass: "AcDbEllipse", def: O },
    { name: "majorAxis", code: 11, kind: "p3", subclass: "AcDbEllipse", def: { x: 1, y: 0, z: 0 } },
    { name: "extrusion", code: 210, kind: "p3", subclass: "AcDbEllipse", def: Z },
    { name: "ratio", code: 40, kind: "num", subclass: "AcDbEllipse", def: 1 },
    { name: "startParam", code: 41, kind: "num", subclass: "AcDbEllipse", def: 0 },
    { name: "endParam", code: 42, kind: "num", subclass: "AcDbEllipse", def: Math.PI * 2 },
  ]),
);

const solidFields = [
  { name: "v0", code: 10, kind: "p3", subclass: "AcDbTrace", def: O },
  { name: "v1", code: 11, kind: "p3", subclass: "AcDbTrace", def: O },
  { name: "v2", code: 12, kind: "p3", subclass: "AcDbTrace", def: O },
  { name: "v3", code: 13, kind: "p3", subclass: "AcDbTrace" },
  { name: "thickness", code: 39, kind: "num", subclass: "AcDbTrace", def: 0 },
  { name: "extrusion", code: 210, kind: "p3", subclass: "AcDbTrace", def: Z },
] as const;

for (const t of ["SOLID", "TRACE"] as const) {
  registerEntity<SolidEntity>(
    t,
    simpleParser<SolidEntity>(t, solidFields, (e) => (e.v3 ? e : { ...e, v3: e.v2 })),
  );
}

registerEntity<Face3dEntity>(
  "3DFACE",
  simpleParser<Face3dEntity>(
    "3DFACE",
    [
      { name: "v0", code: 10, kind: "p3", subclass: "AcDbFace", def: O },
      { name: "v1", code: 11, kind: "p3", subclass: "AcDbFace", def: O },
      { name: "v2", code: 12, kind: "p3", subclass: "AcDbFace", def: O },
      { name: "v3", code: 13, kind: "p3", subclass: "AcDbFace" },
      { name: "invisibleEdges", code: 70, kind: "int", subclass: "AcDbFace", def: 0 },
    ],
    (e) => (e.v3 ? e : { ...e, v3: e.v2 }),
  ),
);

registerEntity(
  "RAY",
  simpleParser<RayEntity>("RAY", [
    { name: "start", code: 10, kind: "p3", subclass: "AcDbRay", def: O },
    { name: "direction", code: 11, kind: "p3", subclass: "AcDbRay", def: { x: 1, y: 0, z: 0 } },
  ]),
);

registerEntity(
  "XLINE",
  simpleParser<RayEntity>("XLINE", [
    { name: "start", code: 10, kind: "p3", subclass: "AcDbXline", def: O },
    { name: "direction", code: 11, kind: "p3", subclass: "AcDbXline", def: { x: 1, y: 0, z: 0 } },
  ]),
);

const isNull = (v: Point3 | undefined) => v !== undefined && v.x === 0 && v.y === 0 && v.z === 0;

registerEntity<SplineEntity>(
  "SPLINE",
  simpleParser<SplineEntity>(
    "SPLINE",
    [
      { name: "normal", code: 210, kind: "p3", subclass: "AcDbSpline" },
      { name: "flags", code: 70, kind: "int", subclass: "AcDbSpline", def: 0 },
      { name: "degree", code: 71, kind: "int", subclass: "AcDbSpline", def: 3 },
      { name: "knotTolerance", code: 42, kind: "num", subclass: "AcDbSpline", def: 1e-10 },
      { name: "controlPointTolerance", code: 43, kind: "num", subclass: "AcDbSpline", def: 1e-10 },
      { name: "fitTolerance", code: 44, kind: "num", subclass: "AcDbSpline", def: 1e-10 },
      { name: "startTangent", code: 12, kind: "p3", subclass: "AcDbSpline" },
      { name: "endTangent", code: 13, kind: "p3", subclass: "AcDbSpline" },
      { name: "knots", code: 40, kind: "num", subclass: "AcDbSpline", many: true },
      { name: "weights", code: 41, kind: "num", subclass: "AcDbSpline", many: true },
      { name: "controlPoints", code: 10, kind: "p3", subclass: "AcDbSpline", many: true },
      { name: "fitPoints", code: 11, kind: "p3", subclass: "AcDbSpline", many: true },
    ],
    (e) => {
      // Null tangents carry no direction (note 03 section 3).
      if (!isNull(e.startTangent) && !isNull(e.endTangent)) return e;
      return {
        ...e,
        startTangent: isNull(e.startTangent) ? undefined : e.startTangent,
        endTangent: isNull(e.endTangent) ? undefined : e.endTangent,
      };
    },
  ),
);

registerEntity(
  "SHAPE",
  simpleParser<ShapeEntity>("SHAPE", [
    { name: "thickness", code: 39, kind: "num", subclass: "AcDbShape", def: 0 },
    { name: "insert", code: 10, kind: "p3", subclass: "AcDbShape", def: O },
    { name: "size", code: 40, kind: "num", subclass: "AcDbShape", def: 1 },
    { name: "name", code: 2, kind: "name", subclass: "AcDbShape", def: "" },
    { name: "rotation", code: 50, kind: "num", subclass: "AcDbShape", def: 0 },
    { name: "widthFactor", code: 41, kind: "num", subclass: "AcDbShape", def: 1 },
    { name: "oblique", code: 51, kind: "num", subclass: "AcDbShape", def: 0 },
    { name: "extrusion", code: 210, kind: "p3", subclass: "AcDbShape", def: Z },
  ]),
);
