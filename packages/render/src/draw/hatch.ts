/**
 * HATCH / MPOLYGON (note 06 §1): boundary loops from polyline or edge paths (OCS), solid fill
 * with island selection by hatch style, or the stored pattern lines (already scaled/rotated)
 * clipped to the loops. Gradients are filled with their first colour for now.
 */
import {
  arcSpanDeg,
  buildSplineCurve,
  bulgePolylineToSubpath,
  degToRad,
  FillRule,
  flattenPath,
  type HatchLoop,
  hatchPatternLines,
  hatchSolidTriangles,
  lineSegment,
  Matrix44,
  ocsToWcsMatrix,
  type PathSegment,
  projectCurve3,
  type Subpath,
  transformHatchPatternLine,
  transformPath,
} from "@truedxf/geometry";
import type { HatchEdge, HatchEntity, HatchPath, MPolygonEntity } from "@truedxf/model";
import { aciToRgb } from "../aci.ts";
import type { Rgba } from "../displaylist.ts";
import { registerDrawer } from "../frontend.ts";

const IDENTITY = Matrix44.identity();

/** Edge → path segment in the OCS plane. */
function edgeSegment(edge: HatchEdge): PathSegment[] {
  switch (edge.type) {
    case "line":
      return [lineSegment(edge.start, edge.end)];
    case "arc": {
      // ccw = false: complementary angles, traversed clockwise (note 06 §1.3.3, ezdxf#175)
      const a = edge.ccw ? edge.startAngle : 360 - edge.endAngle;
      const b = edge.ccw ? edge.endAngle : 360 - edge.startAngle;
      const span = degToRad(arcSpanDeg(a, b));
      if (edge.ccw)
        return [{ kind: "arc", center: edge.center, radius: edge.radius, start: degToRad(a), sweep: span }];
      return [{ kind: "arc", center: edge.center, radius: edge.radius, start: degToRad(b), sweep: -span }];
    }
    case "ellipse": {
      // angles are treated as ellipse parameters like ezdxf (UNVERIFIED, note 06 §1.3.3)
      const u = edge.majorAxis;
      const v = { x: -u.y * edge.ratio, y: u.x * edge.ratio };
      const a = edge.ccw ? edge.startAngle : 360 - edge.endAngle;
      const b = edge.ccw ? edge.endAngle : 360 - edge.startAngle;
      const span = degToRad(arcSpanDeg(a, b));
      return [
        edge.ccw
          ? { kind: "ellipticArc", center: edge.center, u, v, start: degToRad(a), sweep: span }
          : { kind: "ellipticArc", center: edge.center, u, v, start: degToRad(b), sweep: -span },
      ];
    }
    case "spline": {
      const z = (p: { x: number; y: number }) => ({ x: p.x, y: p.y, z: 0 });
      const res = buildSplineCurve({
        degree: edge.degree,
        knots: edge.knots,
        controlPoints: edge.controlPoints.map(z),
        weights: edge.weights,
        fitPoints: edge.fitPoints.map(z),
        startTangent: edge.startTangent ? z(edge.startTangent) : undefined,
        endTangent: edge.endTangent ? z(edge.endTangent) : undefined,
      });
      if (!res.curve) return [];
      return [...projectCurve3({ kind: "nurbs", curve: res.curve }, IDENTITY).segments];
    }
  }
}

function pathToSubpath(p: HatchPath): Subpath {
  if (p.kind === "polyline") return bulgePolylineToSubpath(p.vertices, true);
  return { segments: p.edges.flatMap(edgeSegment), closed: true };
}

registerDrawer(["HATCH", "MPOLYGON"], (fe, e, st) => {
  const h = e as HatchEntity | MPolygonEntity;
  const r = fe.resolve(h, st);
  // OCS plane (with elevation) → target
  const plane = st.m.multiply(ocsToWcsMatrix(h.extrusion)).planeToAffine2(h.elevation);
  const loops: HatchLoop[] = [];
  for (const p of h.paths) {
    const target = transformPath({ subpaths: [pathToSubpath(p)] }, plane);
    for (const fl of flattenPath(target, fe.tolerance)) {
      if (fl.points.length >= 6) loops.push({ points: fl.points, flags: p.flags });
    }
  }
  if (loops.length === 0) return;
  const style = h.style;
  let color: Rgba = fe.color(r);
  if (h.gradient && h.gradient.kind === 1) {
    // UNVERIFIED: gradient interpolation not implemented (note 06 §1.7); first colour as fill
    fe.note("hatch-gradient");
    const c = h.gradient.colors[0];
    if (c && !fe.monochrome) {
      const rgb =
        c.rgb !== undefined ? [(c.rgb >> 16) & 255, (c.rgb >> 8) & 255, c.rgb & 255] : aciToRgb(c.aci ?? 7);
      color = [rgb[0]!, rgb[1]!, rgb[2]!, 255];
    }
    fe.fillTriangles(
      hatchSolidTriangles(loops, style, { tolerance: fe.tolerance, fillRule: FillRule.EvenOdd }),
      color,
    );
    return;
  }
  if (h.solid) {
    fe.fillTriangles(
      hatchSolidTriangles(loops, style, { tolerance: fe.tolerance, fillRule: FillRule.EvenOdd }),
      color,
    );
    return;
  }
  const lines = h.patternLines.map((l) =>
    transformHatchPatternLine({ angle: l.angle, base: l.base, offset: l.offset, dashes: l.dashes }, plane),
  );
  if (lines.length === 0) return;
  const res = hatchPatternLines(loops, style, lines);
  if (res.tooDense) {
    // UNVERIFIED (note 06 §1.6: HPMAXLINES): too dense patterns are filled solid
    fe.note("hatch-too-dense");
    fe.fillTriangles(hatchSolidTriangles(loops, style, { tolerance: fe.tolerance }), color);
    return;
  }
  const seg = res.segments;
  for (let i = 0; i + 3 < seg.length; i += 4) {
    fe.strokeFlat(seg.subarray(i, i + 4), false, r);
  }
  const dots = res.dots;
  for (let i = 0; i + 1 < dots.length; i += 2) fe.strokeFlat(dots.subarray(i, i + 2), false, r);
});
