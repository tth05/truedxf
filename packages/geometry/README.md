# @truedxf/geometry

The float64 geometry kernel of truedxf: curves, OCS, flattening, stroking, dashing, hatch
patterns and polygon clipping, with no dependency on the DXF model.

## Install

```bash
pnpm add @truedxf/geometry
```

ESM only. No DOM and no Node.js APIs: runs in browsers, workers and Node.

## What it does

- Vectors as plain `{ x, y }` / `{ x, y, z }` objects (`Vec2`, `Vec3`, `add3`, `cross3`, ...), so
  model points pass in without conversion, plus `Matrix44`, `Affine2`, `Bounds2`, `Bounds3`.
- OCS: `arbitraryAxis`, `ocsToWcsMatrix`, `wcsToOcsMatrix` (arbitrary axis algorithm, 1/64
  threshold) and `entityCoordinateSystem` / `isOcsPoint`, which say per entity type and group
  code whether a point is OCS or WCS.
- Curves: bulge arcs (`bulgeToArc`, `arcToBulge`), elliptic arcs (`ellipseFromDxf`,
  `ellipseParamToAngle`), `NurbsCurve` with Bezier extraction, `buildSplineCurve` for DXF SPLINE
  data and `interpolateFitPoints` for fit-point-only splines (AutoCAD's construction, note 03
  §3.8.6). Exact bounds for every segment type.
- Paths of line, arc, elliptic-arc, quadratic, cubic and NURBS segments (`Path2`, `PathBuilder`,
  `transformPath`, `projectCurve3`), flattened by `flattenPath` with a device-space chord
  tolerance (default 0.1 px) and deterministic, capped segment counts.
- Polylines: `bulgePolylineToSubpath`, `widePolylineOutline` (tapered widths, AutoCAD's miter
  and arc-width rules, note 03 §4), curve-fit and spline-fit vertex selection.
- `strokePolyline` / `strokeOutline`: width, butt/square/round/diamond caps, miter/bevel/round/
  diamond joins, miter limit.
- Linetypes: `dashPolyline` / `dashPath` with pluggable dash fitting (`autocadCandidateFit`,
  `phaseFit`), dots, and placements of complex shape/text elements.
- Hatches: loop selection by hatch style (`selectHatchLoops`), solid fill
  (`hatchSolidTriangles`), clipped pattern lines (`hatchPatternLines`, 100 000-line limit).
- Booleans and clipping via clipper2 on a fixed-point grid derived from the tolerance
  (`booleanPolygons`, `clipPolygons`, `clipPolylines`), exact `clipPolylineToRect`, and
  `triangulateFill` (clipper2 union + earcut) for even-odd and non-zero fills.
- No DOM and no `node:*` imports: runs in browsers and Node. No randomness, no time limits.

## Usage

```ts
import {
  Affine2, bulgePolylineToSubpath, dashPattern, dashPolyline, flattenSubpath, strokePolyline,
  transformSubpath,
} from "@truedxf/geometry";

// LWPOLYLINE vertices (OCS): a 10 x 5 slot, bulge 1 = half circle
const centre = bulgePolylineToSubpath(
  [{ x: 0, y: 0 }, { x: 10, y: 0, bulge: 1 }, { x: 10, y: 5 }, { x: 0, y: 5, bulge: 1 }],
  true,
);

// to device pixels first, then flatten with 0.1 px max sagitta
const px = flattenSubpath(transformSubpath(centre, Affine2.scaling(20)), 0.1);

const triangles = strokePolyline(px.points, { width: 3, closed: true, join: "round" });
const dashed = dashPolyline(px.points, dashPattern([0.5, -0.25], 20), { closed: true });
console.log(triangles.length / 6, "triangles,", dashed.dashes.length, "dashes");
```

## Status

- AutoCAD's own plot tessellation is not reproduced here. The raster-plot rules live in
  `@truedxf/render` (`raster.ts`), and the SPLINE plot rule is still open ([docs/TODO.md](https://github.com/tth05/truedxf/blob/master/docs/TODO.md)).
- Unknown in AutoCAD, implemented as a best guess: closed (periodic) fit-point splines are
  treated as open, fit tolerance > 0 is treated as interpolation (Q-0177), the wide-polyline
  miter limit between 7.2° and 30°, and the diamond cap/join shapes.
- `autocadCandidateFit` is the UNVERIFIED dash-fitting hypothesis of note 06 §2.6. Dashed wide
  polylines still drift in phase ([docs/TODO.md](https://github.com/tth05/truedxf/blob/master/docs/TODO.md)).

## See also

- [03-entities-geometry](https://github.com/tth05/truedxf/blob/master/research/notes/03-entities-geometry.md): OCS, curves, SPLINE math,
  wide polylines, tessellation
- [06-hatch-linetype-appearance](https://github.com/tth05/truedxf/blob/master/research/notes/06-hatch-linetype-appearance.md): hatch
  loops and patterns, linetype fitting, lineweights
- [@truedxf/model](https://github.com/tth05/truedxf/tree/master/packages/model) for the entity data these functions consume

## License

MIT. AutoCAD and DXF are trademarks of Autodesk, Inc. truedxf is not affiliated with or
endorsed by Autodesk.
