/**
 * @truedxf/geometry — the geometry kernel.
 *
 * Curve half: vectors and matrices, OCS, arcs and bulges, ellipses, NURBS (incl. AutoCAD
 * fit-point interpolation), 2D paths, flattening with a device-space tolerance, exact bounds,
 * polyline / wide-polyline construction (research/notes/03-entities-geometry.md).
 *
 * Fill half (research/notes/06-hatch-linetype-appearance.md):
 * - stroke.ts — polyline → triangles / outline with caps, joins, miter limit;
 * - triangulate.ts — ring set + fill rule → non-overlapping triangles (clipper2 union + earcut);
 * - clip.ts, fixed.ts — booleans and region clipping on a documented fixed-point grid;
 * - dash.ts — linetype engine (units, pluggable A-type fitting, dots, complex placements);
 * - hatch.ts — hatch loop selection, solid fill, deterministic pattern-line generation.
 * Everything is deterministic (no randomness, count limits instead of time limits).
 */

export * from "./angle.ts";
export * from "./arc.ts";
export * from "./bezier.ts";
export * from "./bounds.ts";
export * from "./clip.ts";
export * from "./dash.ts";
export * from "./ellipse.ts";
export * from "./fit.ts";
export * from "./fixed.ts";
export * from "./flatten.ts";
export * from "./hatch.ts";
export * from "./length.ts";
export * from "./linalg.ts";
export * from "./matrix.ts";
export * from "./nurbs.ts";
export * from "./ocs.ts";
export * from "./path.ts";
export * from "./polygon.ts";
export * from "./polyline.ts";
export * from "./project.ts";
export * from "./spline.ts";
export * from "./stroke.ts";
export * from "./tolerance.ts";
export * from "./triangulate.ts";
export * from "./vec.ts";
