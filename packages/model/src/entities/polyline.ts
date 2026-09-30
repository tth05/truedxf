/**
 * LWPOLYLINE and POLYLINE/VERTEX/SEQEND. research/notes/03-entities-geometry.md §3–§4.
 */
import { fieldTable, readFields } from "../fields.ts";
import type { DxfRecord } from "../record.ts";
import type { Point3 } from "../types.ts";
import { type EntityBase, readBase, registerEntity } from "./common.ts";

const Z = Object.freeze({ x: 0, y: 0, z: 1 });
const O = Object.freeze({ x: 0, y: 0, z: 0 });

export interface LwVertex {
  readonly x: number;
  readonly y: number;
  /** Start/end width; -1 when not given (use `constantWidth`). */
  readonly startWidth: number;
  readonly endWidth: number;
  readonly bulge: number;
  readonly id: number | undefined;
}

export interface LwPolylineEntity extends EntityBase {
  readonly type: "LWPOLYLINE";
  /** 1 closed, 128 linetype generation continuous across vertices (PLINEGEN). */
  readonly flags: number;
  readonly closed: boolean;
  readonly constantWidth: number;
  /** OCS z of all vertices. */
  readonly elevation: number;
  readonly thickness: number;
  readonly extrusion: Point3;
  /** OCS vertices. */
  readonly vertices: readonly LwVertex[];
}

registerEntity<LwPolylineEntity>("LWPOLYLINE", (rec, base) => {
  let flags = 0;
  let constantWidth = 0;
  let elevation = 0;
  let thickness = 0;
  let extrusion: Point3 = Z;
  const vertices: LwVertex[] = [];
  const s = rec.store;
  const strict = rec.hasSubclasses;
  let cur:
    | { x: number; y: number; startWidth: number; endWidth: number; bulge: number; id: number | undefined }
    | undefined;
  for (const p of rec.parts) {
    if (p.kind !== 0 && p.kind !== 1) continue;
    if (strict && p.name !== "AcDbPolyline") continue;
    const tags = [...rec.partTags(p)];
    for (let k = 0; k < tags.length; k++) {
      const i = tags[k]!;
      const code = s.codes[i]!;
      switch (code) {
        case 10: {
          if (cur) vertices.push(cur);
          const x = s.num(i);
          let y = 0;
          const j = tags[k + 1];
          if (j !== undefined && s.codes[j] === 20) {
            y = s.num(j);
            k++;
          }
          cur = { x: fin(x), y: fin(y), startWidth: -1, endWidth: -1, bulge: 0, id: undefined };
          break;
        }
        case 40:
          if (cur) cur.startWidth = fin(s.num(i));
          break;
        case 41:
          if (cur) cur.endWidth = fin(s.num(i));
          break;
        case 42:
          if (cur) cur.bulge = fin(s.num(i));
          break;
        case 91:
          if (cur) cur.id = s.int(i);
          break;
        case 70:
          flags = s.int(i);
          break;
        case 43:
          constantWidth = fin(s.num(i));
          break;
        case 38:
          elevation = fin(s.num(i));
          break;
        case 39:
          thickness = fin(s.num(i));
          break;
        case 210: {
          const x = s.num(i);
          const y = tags[k + 1] !== undefined && s.codes[tags[k + 1]!] === 220 ? s.num(tags[++k]!) : 0;
          const z = tags[k + 1] !== undefined && s.codes[tags[k + 1]!] === 230 ? s.num(tags[++k]!) : 1;
          extrusion = { x: fin(x), y: fin(y), z: fin(z) };
          break;
        }
      }
    }
  }
  if (cur) vertices.push(cur);
  return {
    ...base,
    type: "LWPOLYLINE",
    flags,
    closed: (flags & 1) !== 0,
    constantWidth,
    elevation,
    thickness,
    extrusion,
    vertices,
  };
});

function fin(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/** POLYLINE flags (70). */
export const PolylineFlags = {
  Closed: 1,
  CurveFit: 2,
  SplineFit: 4,
  Polyline3d: 8,
  PolygonMesh: 16,
  MeshClosedN: 32,
  PolyfaceMesh: 64,
  LinetypeContinuous: 128,
} as const;

/** VERTEX flags (70). */
export const VertexFlags = {
  ExtraCurveFit: 1,
  CurveFitTangent: 2,
  SplineVertex: 8,
  SplineFrame: 16,
  Polyline3d: 32,
  PolygonMesh: 64,
  PolyfaceMesh: 128,
} as const;

export interface VertexEntity extends EntityBase {
  readonly type: "VERTEX";
  /** OCS for 2D polylines, WCS for 3D polylines and meshes. */
  readonly location: Point3;
  readonly startWidth: number;
  readonly endWidth: number;
  readonly bulge: number;
  readonly flags: number;
  /** Curve-fit tangent direction (degrees), when flag 2 is set. */
  readonly tangent: number | undefined;
  /** Polyface face record vertex indices (1-based; negative = invisible edge). */
  readonly faceIndices: readonly number[];
  /** Group 91 vertex identifier. */
  readonly vertexId: number | undefined;
}

export interface PolylineEntity extends EntityBase {
  readonly type: "POLYLINE";
  readonly flags: number;
  readonly closed: boolean;
  /** (0, 0, elevation) in OCS for 2D polylines. */
  readonly elevationPoint: Point3;
  readonly thickness: number;
  readonly defaultStartWidth: number;
  readonly defaultEndWidth: number;
  /** Mesh M/N vertex counts or polyface vertex/face counts. */
  readonly m: number;
  readonly n: number;
  readonly mDensity: number;
  readonly nDensity: number;
  /** Smooth surface / curve type: 0 none, 5 quadratic B-spline, 6 cubic, 8 Bezier. */
  readonly smoothType: number;
  readonly extrusion: Point3;
  readonly vertices: readonly VertexEntity[];
  readonly seqend: DxfRecord | undefined;
}

const POLYLINE = fieldTable([
  { name: "elevationPoint", code: 10, kind: "p3", def: O },
  { name: "thickness", code: 39, kind: "num", def: 0 },
  { name: "flags", code: 70, kind: "int", def: 0 },
  { name: "defaultStartWidth", code: 40, kind: "num", def: 0 },
  { name: "defaultEndWidth", code: 41, kind: "num", def: 0 },
  { name: "m", code: 71, kind: "int", def: 0 },
  { name: "n", code: 72, kind: "int", def: 0 },
  { name: "mDensity", code: 73, kind: "int", def: 0 },
  { name: "nDensity", code: 74, kind: "int", def: 0 },
  { name: "smoothType", code: 75, kind: "int", def: 0 },
  { name: "extrusion", code: 210, kind: "p3", def: Z },
]);

const POLY_SUBCLASSES = ["AcDb2dPolyline", "AcDb3dPolyline", "AcDbPolyFaceMesh", "AcDbPolygonMesh"];
const VERTEX_SUBCLASSES = [
  "AcDbVertex",
  "AcDb2dVertex",
  "AcDb3dPolylineVertex",
  "AcDbPolyFaceMeshVertex",
  "AcDbPolygonMeshVertex",
  "AcDbFaceRecord",
];

const VERTEX = fieldTable(
  [
    { name: "location", code: 10, kind: "p3", subclass: VERTEX_SUBCLASSES, def: O },
    { name: "startWidth", code: 40, kind: "num", subclass: VERTEX_SUBCLASSES, def: -1 },
    { name: "endWidth", code: 41, kind: "num", subclass: VERTEX_SUBCLASSES, def: -1 },
    { name: "bulge", code: 42, kind: "num", subclass: VERTEX_SUBCLASSES, def: 0 },
    { name: "flags", code: 70, kind: "int", subclass: VERTEX_SUBCLASSES, def: 0 },
    { name: "tangent", code: 50, kind: "num", subclass: VERTEX_SUBCLASSES },
    { name: "f1", code: 71, kind: "int", subclass: VERTEX_SUBCLASSES },
    { name: "f2", code: 72, kind: "int", subclass: VERTEX_SUBCLASSES },
    { name: "f3", code: 73, kind: "int", subclass: VERTEX_SUBCLASSES },
    { name: "f4", code: 74, kind: "int", subclass: VERTEX_SUBCLASSES },
    { name: "vertexId", code: 91, kind: "int", subclass: VERTEX_SUBCLASSES },
  ],
  { lenient: true },
); // data before the markers occurs (ACadSharp#421 contours.dxf)

export function parseVertex(rec: DxfRecord): VertexEntity {
  const base = readBase(rec);
  const f = readFields<Record<string, unknown>>(rec, VERTEX);
  const faceIndices: number[] = [];
  for (const k of ["f1", "f2", "f3", "f4"])
    if (typeof f[k] === "number" && f[k] !== 0) faceIndices.push(f[k] as number);
  return {
    ...base,
    type: "VERTEX",
    location: f.location as Point3,
    startWidth: f.startWidth as number,
    endWidth: f.endWidth as number,
    bulge: f.bulge as number,
    flags: f.flags as number,
    tangent: f.tangent as number | undefined,
    faceIndices,
    vertexId: f.vertexId as number | undefined,
  };
}

registerEntity<PolylineEntity>("POLYLINE", (rec, base, _ctx, children) => {
  const f = readFields<Record<string, unknown>>(rec, POLYLINE);
  // subclass constraints: POLYLINE fields live in one of the POLY_SUBCLASSES (or base for R12)
  if (rec.hasSubclasses && !rec.parts.some((p) => POLY_SUBCLASSES.includes(p.name))) {
    // unknown layout: fields were read from any subclass, which is fine for POLYLINE's codes
  }
  const flags = f.flags as number;
  return {
    ...base,
    type: "POLYLINE",
    flags,
    closed: (flags & PolylineFlags.Closed) !== 0,
    elevationPoint: f.elevationPoint as Point3,
    thickness: f.thickness as number,
    defaultStartWidth: f.defaultStartWidth as number,
    defaultEndWidth: f.defaultEndWidth as number,
    m: f.m as number,
    n: f.n as number,
    mDensity: f.mDensity as number,
    nDensity: f.nDensity as number,
    smoothType: f.smoothType as number,
    extrusion: f.extrusion as Point3,
    vertices: (children?.children ?? []).map(parseVertex),
    seqend: children?.seqend,
  };
});
