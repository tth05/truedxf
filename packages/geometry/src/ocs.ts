/**
 * Object coordinate systems (OCS/ECS) via the Arbitrary Axis Algorithm, and the per-entity
 * table of which point codes are OCS and which WCS.
 *
 * Note 03 §2.2 (exact algorithm, strict 1/64 "square polar cap"), §2.3 (elevation), §2.4
 * (per-entity table), §2.6 (thickness direction). Extrusion (0,0,−1) is extremely common
 * (mirrored geometry): its OCS x-axis is (−1,0,0), y-axis (0,1,0), so the stored X is the negated
 * world X and CCW OCS arcs run clockwise seen from +Z.
 */

import { Matrix44 } from "./matrix.ts";
import { AAA_THRESHOLD } from "./tolerance.ts";
import type { Vec3 } from "./vec.ts";

export interface OcsAxes {
  readonly ax: Vec3;
  readonly ay: Vec3;
  readonly az: Vec3;
}

/**
 * Normalize an extrusion vector. A zero (or non-finite) vector is invalid and falls back to the
 * default (0,0,1), like ezdxf does for LibreCAD files with null extrusions (note 03 §1, ezdxf#851).
 */
export function normalizeExtrusion(n: Vec3 | undefined): Vec3 {
  if (!n) return { x: 0, y: 0, z: 1 };
  const l = Math.hypot(n.x, n.y, n.z);
  if (!(l > 0) || !Number.isFinite(l)) return { x: 0, y: 0, z: 1 };
  return { x: n.x / l, y: n.y / l, z: n.z / l };
}

/**
 * Arbitrary Axis Algorithm (note 03 §2.2):
 * ```
 * N = normalize(extrusion)
 * if |N.x| < 1/64 and |N.y| < 1/64: Ax = normalize(Wy × N) else Ax = normalize(Wz × N)
 * Ay = normalize(N × Ax); Az = N
 * ```
 * The comparison is strict `<` against exactly 0.015625. For N = ±Z this yields exact axes
 * (identity, or x ↦ −x, z ↦ −z), so no special-casing is needed.
 */
export function arbitraryAxis(extrusion: Vec3 | undefined): OcsAxes {
  const n = normalizeExtrusion(extrusion);
  let ax: Vec3;
  if (Math.abs(n.x) < AAA_THRESHOLD && Math.abs(n.y) < AAA_THRESHOLD) {
    // Wy × N = (1·Nz − 0·Ny, 0·Nx − 0·Nz, 0·Ny − 1·Nx) = (Nz, 0, −Nx)
    ax = unit(n.z, 0, -n.x);
  } else {
    // Wz × N = (0·Nz − 1·Ny, 1·Nx − 0·Nz, 0) = (−Ny, Nx, 0)
    ax = unit(-n.y, n.x, 0);
  }
  // N × Ax
  const ay = unit(n.y * ax.z - n.z * ax.y, n.z * ax.x - n.x * ax.z, n.x * ax.y - n.y * ax.x);
  return { ax, ay, az: n };
}

function unit(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z);
  // `+ 0` turns −0 into +0 so axes compare and print cleanly.
  return { x: x / l + 0, y: y / l + 0, z: z / l + 0 };
}

/** OCS→WCS matrix: columns `[Ax Ay Az]`, no translation (the OCS origin is the WCS origin). */
export function ocsToWcsMatrix(extrusion: Vec3 | undefined): Matrix44 {
  const { ax, ay, az } = arbitraryAxis(extrusion);
  return Matrix44.fromBasis(ax, ay, az);
}

/** WCS→OCS matrix: the transpose of {@link ocsToWcsMatrix} (orthonormal). */
export function wcsToOcsMatrix(extrusion: Vec3 | undefined): Matrix44 {
  const { ax, ay, az } = arbitraryAxis(extrusion);
  return Matrix44.fromRows(ax.x, ax.y, ax.z, 0, ay.x, ay.y, ay.z, 0, az.x, az.y, az.z, 0, 0, 0, 0, 1);
}

/** `P_wcs = x·Ax + y·Ay + z·Az`. */
export function ocsToWcs(p: Vec3, axes: OcsAxes): Vec3 {
  const { ax, ay, az } = axes;
  return {
    x: p.x * ax.x + p.y * ay.x + p.z * az.x,
    y: p.x * ax.y + p.y * ay.y + p.z * az.y,
    z: p.x * ax.z + p.y * ay.z + p.z * az.z,
  };
}

/** `x = P·Ax, y = P·Ay, z = P·Az`. */
export function wcsToOcs(p: Vec3, axes: OcsAxes): Vec3 {
  const { ax, ay, az } = axes;
  return {
    x: p.x * ax.x + p.y * ax.y + p.z * ax.z,
    y: p.x * ay.x + p.y * ay.y + p.z * ay.z,
    z: p.x * az.x + p.y * az.y + p.z * az.z,
  };
}

/** True when the (normalized) extrusion is exactly +Z, i.e. OCS = WCS. */
export function isWcsExtrusion(extrusion: Vec3 | undefined): boolean {
  const n = normalizeExtrusion(extrusion);
  return n.x === 0 && n.y === 0 && n.z === 1;
}

/**
 * Thickness offset vector `thickness · N̂` (note 03 §2.6). Applies to WCS entities (LINE,
 * POINT) as well as OCS ones.
 */
export function thicknessVector(extrusion: Vec3 | undefined, thickness: number): Vec3 {
  const n = normalizeExtrusion(extrusion);
  return { x: n.x * thickness, y: n.y * thickness, z: n.z * thickness };
}

// ---- Per-entity coordinate system table (note 03 §2.4) -------------------------------------

/**
 * `"ocs"`: point codes are OCS and 210 defines the OCS. `"wcs"`: points are WCS; 210 (if any)
 * is only a normal / thickness direction. `"mixed"`: some codes OCS, some WCS (DIMENSION).
 * `"polyline"`: depends on POLYLINE flags (see {@link polylineCoordinateSystem}).
 */
export type EntityCoordinateSystem = "ocs" | "wcs" | "mixed" | "polyline";

/**
 * Coordinate system of the point codes (10–37) per entity type (note 03 §2.4).
 * CONFLICTs resolved as follows (both marked in the note):
 * - SHAPE: spec entity text says WCS, the spec OCS table says OCS; ezdxf treats it as WCS.
 *   We follow the OCS table. UNKNOWN until tested with a non-Z extrusion (note 03 test idea 4).
 * - IMAGE/WIPEOUT: ASSUMPTION WCS (ezdxf), spec OCS table says OCS.
 */
export const ENTITY_COORDINATE_SYSTEMS: Readonly<Record<string, EntityCoordinateSystem>> = Object.freeze({
  LINE: "wcs",
  POINT: "wcs",
  XLINE: "wcs",
  RAY: "wcs",
  "3DFACE": "wcs",
  ELLIPSE: "wcs",
  SPLINE: "wcs",
  HELIX: "wcs",
  MESH: "wcs",
  MTEXT: "wcs",
  IMAGE: "wcs",
  WIPEOUT: "wcs",
  VIEWPORT: "wcs",
  LEADER: "wcs",
  MLINE: "wcs",
  CIRCLE: "ocs",
  ARC: "ocs",
  LWPOLYLINE: "ocs",
  SOLID: "ocs",
  TRACE: "ocs",
  TEXT: "ocs",
  ATTRIB: "ocs",
  ATTDEF: "ocs",
  INSERT: "ocs",
  HATCH: "ocs",
  MPOLYGON: "ocs",
  SHAPE: "ocs",
  POLYLINE: "polyline",
  VERTEX: "polyline",
  DIMENSION: "mixed",
});

/**
 * DIMENSION point codes (note 03 §2.4, ezdxf entities/dimension.py): 10, 13, 14, 15 are WCS;
 * 11, 12, 16 are OCS.
 */
export const DIMENSION_OCS_POINT_CODES: ReadonlySet<number> = new Set([11, 12, 16]);

/** Coordinate system of an entity type's points; unknown types default to WCS. */
export function entityCoordinateSystem(type: string): EntityCoordinateSystem {
  return ENTITY_COORDINATE_SYSTEMS[type.toUpperCase()] ?? "wcs";
}

/**
 * POLYLINE/VERTEX: 3D polyline (flag 8), polygon mesh (16) and polyface mesh (64) are WCS;
 * everything else is a 2D polyline in OCS (note 03 §2.4, §3.10.1).
 */
export function polylineCoordinateSystem(polylineFlags: number): "ocs" | "wcs" {
  return polylineFlags & (8 | 16 | 64) ? "wcs" : "ocs";
}

/** True when the point with group code `code` of entity `type` is in OCS. */
export function isOcsPoint(type: string, code: number, polylineFlags = 0): boolean {
  switch (entityCoordinateSystem(type)) {
    case "ocs":
      return true;
    case "wcs":
      return false;
    case "polyline":
      return polylineCoordinateSystem(polylineFlags) === "ocs";
    case "mixed":
      return DIMENSION_OCS_POINT_CODES.has(code);
  }
}
