/**
 * HATCH / MPOLYGON (note 06 §1): boundary loops from polyline or edge paths (OCS), solid fill
 * with island selection by hatch style, or the stored pattern lines (already scaled/rotated)
 * clipped to the loops. Gradients: gradient.ts.
 */
import {
    Affine2,
    arcSpanDeg,
    buildSplineCurve,
    bulgePolylineToSubpath,
    cosSinDeg,
    DEFAULT_HATCH_MAX_LINES,
    degToRad,
    type HatchLoop,
    hatchPatternLineCount,
    hatchPatternLines,
    lineSegment,
    Matrix44,
    ocsToWcsMatrix,
    type PathSegment,
    projectCurve3,
    selectHatchLoops,
    transformHatchPatternLine,
    transformPath,
} from "@truedxf/geometry";
import type { HatchEdge, HatchEntity, HatchPath, MPolygonEntity } from "@truedxf/model";
import type { Rgba } from "../displaylist.ts";
import { type Frontend, registerDrawer } from "../frontend.ts";
import { fillGradient } from "./gradient.ts";

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
                return [
                    {
                        kind: "arc",
                        center: edge.center,
                        radius: edge.radius,
                        start: degToRad(a),
                        sweep: span,
                    },
                ];
            return [
                { kind: "arc", center: edge.center, radius: edge.radius, start: degToRad(b), sweep: -span },
            ];
        }
        case "ellipse": {
            // 50/51 are geometric angles in the ellipse frame, parameter = atan2(sin a / ratio, cos a)
            // like ezdxf (note 06 §1.3.3); kept in the angle's turn so 0…360 stays a full ellipse
            const u = edge.majorAxis;
            const v = { x: -u.y * edge.ratio, y: u.x * edge.ratio };
            const toParam = (deg: number) => {
                if (!(edge.ratio > 0)) return deg;
                const r = degToRad(deg);
                const p = Math.atan2(Math.sin(r) / edge.ratio, Math.cos(r));
                let d = p - r;
                d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
                return deg + (d * 180) / Math.PI;
            };
            const a = toParam(edge.ccw ? edge.startAngle : 360 - edge.endAngle);
            const b = toParam(edge.ccw ? edge.endAngle : 360 - edge.startAngle);
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

/** Boundary segments of a path in stored order (polyline paths: n − 1 segments when open). */
function pathSegments(p: HatchPath): PathSegment[] {
    if (p.kind === "polyline") return [...bulgePolylineToSubpath(p.vertices, p.closed).segments];
    return p.edges.flatMap(edgeSegment);
}

/**
 * Loop polygon of a path the way AutoCAD builds it: every segment contributes its flattened
 * points **without its end point**, in stored order, and the loop closes from the last point to
 * the first. Edges are never reordered or reversed, gaps become straight lines to the next
 * start, and an open polyline path (73 = 0) loses its last vertex. VERIFIED-BY-ACAD
 * (hatches/edges-shuffled*, edges-reversed-one, edges-open-3-edges, poly-open-u-shape,
 * one-loop-two-rects, edges-gap-*; note 06 §1.3.3)
 */
function loopPoints(fe: Frontend, p: HatchPath, plane: Affine2): Float64Array {
    const out: number[] = [];
    for (const seg of pathSegments(p)) {
        const t = transformPath({ subpaths: [{ segments: [seg], closed: false }] }, plane);
        for (const fl of fe.flatten(t)) {
            for (let i = 0; i < fl.points.length - 2; i++) out.push(fl.points[i]!);
        }
    }
    return Float64Array.from(out);
}

registerDrawer(["HATCH", "MPOLYGON"], (fe, e, st) => {
    const h = e as HatchEntity | MPolygonEntity;
    // A zero extrusion vector (210 = 0,0,0) does not plot. VERIFIED-BY-ACAD (lead, basic-entities
    // references)
    if (h.extrusion.x === 0 && h.extrusion.y === 0 && h.extrusion.z === 0) return;
    const r = fe.resolve(h, st);
    // OCS plane (with elevation) → target
    let plane = st.m.multiply(ocsToWcsMatrix(h.extrusion)).planeToAffine2(h.elevation);
    // MPOLYGON 11 offset vector translates the stored paths (and, ASSUMPTION, the pattern): AutoCAD
    // Map writes polygons around (0, 0) with their position in 11 (corpus ezdxf discussion-411
    // mpolygons_*.dxf, note 06 §1.12). Taken as OCS like the vertices (only 210 = 0,0,1 seen).
    if (h.type === "MPOLYGON" && (h.offsetVector.x !== 0 || h.offsetVector.y !== 0))
        plane = plane.multiply(Affine2.translation(h.offsetVector.x, h.offsetVector.y));
    const loops: HatchLoop[] = [];
    for (const p of h.paths) {
        const pts = loopPoints(fe, p, plane);
        if (pts.length >= 6) loops.push({ points: pts, flags: p.flags });
    }
    if (loops.length === 0) return;
    // The boundary counts for the drawing extents, not the pattern lines, so a pattern hatch (or a
    // too-dense one that plots nothing) still spans its loops. VERIFIED-BY-ACAD
    // extents/probe-hatch-pattern (note 03 §6.2). Taken to hold with FILLMODE 0 too (ASSUMPTION).
    if (fe.props.extents) for (const l of loops) fe.builder.points(l.points, fe.color(r));
    // FILLMODE 0 hides every hatch completely, pattern hatches too, no outline. VERIFIED-BY-ACAD
    // (hatches/solid-fillmode-0 is an ANSI31 hatch; note 06)
    if (!fe.fillMode) return;
    const style = h.style;
    const color: Rgba = fe.color(r);
    if (h.gradient && h.gradient.kind === 1) {
        // gradient interpolation: draw/gradient.ts (note 06 §1.7)
        fillGradient(
            fe,
            selectHatchLoops(loops, style).map((k) => loops[k]!.points),
            h.gradient,
        );
        return;
    }
    if (h.solid) {
        fe.withFillStyle(r, () => fe.fillHatch(loops, style, color));
        return;
    }
    let lines = h.patternLines.map((l) =>
        transformHatchPatternLine(
            { angle: l.angle, base: l.base, offset: l.offset, dashes: l.dashes },
            plane,
        ),
    );
    if (lines.length === 0) return;
    let coverage = 0;
    if (fe.lod) {
        const rings = selectHatchLoops(loops, style).map((k) => loops[k]!.points);
        // Check the original families before replacing them: AutoCAD's count limit suppresses
        // the entire hatch, including sub-pixel families (note 06 §1.6.3).
        if (!(hatchPatternLineCount(lines, rings) <= DEFAULT_HATCH_MAX_LINES)) {
            fe.note("hatch-too-dense");
            return;
        }
        lines = lines.flatMap((line) => {
            const [cx, sy] = cosSinDeg(line.angle);
            const spacingPx = Math.abs(-line.offset.x * sy + line.offset.y * cx) / fe.pixelSize;
            const period = line.dashes.reduce((sum, dash) => sum + Math.abs(dash), 0);
            if (spacingPx > 0 && spacingPx < 1) {
                // Dots cover one device pixel; empty/zero-period definitions are continuous, as in
                // the pattern engine. This is a viewer approximation, not an AutoCAD plot rule.
                const on = line.dashes.reduce(
                    (sum, dash) => sum + (dash > 0 ? dash : dash === 0 ? fe.pixelSize : 0),
                    0,
                );
                const fraction = period > 0 ? Math.min(1, on / period) : 1;
                coverage += fraction / spacingPx;
                return [];
            }
            return [period > 0 && period < fe.pixelSize ? { ...line, dashes: [] } : line];
        });
    }
    const res = hatchPatternLines(loops, style, lines);
    if (res.tooDense) {
        // more than 100,000 pattern lines: AutoCAD plots nothing, no solid fill. VERIFIED-BY-ACAD
        // (hatches/dense-count-*, note 06 §1.6.3)
        fe.note("hatch-too-dense");
        return;
    }
    if (coverage > 0)
        fe.fillHatch(loops, style, [
            color[0],
            color[1],
            color[2],
            Math.round(color[3] * Math.min(1, coverage)),
        ]);
    const seg = res.segments;
    for (let i = 0; i + 3 < seg.length; i += 4) {
        fe.strokeFlat(seg.subarray(i, i + 4), false, r);
    }
    const dots = res.dots;
    for (let i = 0; i + 1 < dots.length; i += 2) fe.strokeFlat(dots.subarray(i, i + 2), false, r);
});
