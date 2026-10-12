/**
 * Paper-space VIEWPORT: frame drawer and model-space content (note 08 §3, VERIFIED-BY-ACAD
 * results in layout.ts and note 08 §10.12).
 *
 * Model → paper (parallel projection, note 08 §3.5; twist sign VERIFIED calibration/vp-twist):
 *   q = P − target, DCS axes (Xd, Yd) = arbitrary axis algorithm of the normalized view
 *   direction, paper = center + s · (R_ccw(twist) · (Xd·q, Yd·q) − viewCenter), s = 41 / 45.
 *
 * Clipping: the rectangle center ± (40, 41)/2, or the paper-space clip entity (340, flag
 * 0x10000). The region goes into the display list (per-pixel-centre clip in the renderers);
 * thick strokes are cut straight at the border (layouts/clip-thick-rect).
 * Frames: rectangular viewports draw their rectangle in the VIEWPORT's colour, continuous, 1 px;
 * a polygonal viewport draws no rectangle (the clip entity is an ordinary paper-space entity)
 * (layouts/clip-*).
 */
import {
    arbitraryAxis,
    buildSplineCurve,
    bulgePolylineToSubpath,
    type Curve3,
    degToRad,
    ellipseFromDxf,
    ellipticArcCurve3,
    flattenPath,
    Matrix44,
    normalizeExtrusion,
    ocsArcToEllipticArc3,
    ocsToWcsMatrix,
    type Path2,
    type PolylineVertex,
    projectCurve3,
    transformPath,
} from "@truedxf/geometry";
import {
    type CircleEntity,
    type EllipseEntity,
    type Entity,
    type LwPolylineEntity,
    type PolylineEntity,
    type SplineEntity,
    type ViewportEntity,
    ViewportFlags,
} from "@truedxf/model";
import { type Frontend, registerDrawer } from "../frontend.ts";
import { currentPaper, type LayoutContext, layoutPsltscale, setPaperSpaceHooks } from "../layout.ts";
import { TOP_LEVEL } from "../props.ts";
import { depthOverlaps } from "./xclip.ts";

/** Model (WCS) → paper transform of a viewport (z = scaled depth along the view direction). */
export function viewportMatrix(vp: ViewportEntity): Matrix44 {
    const d = normalizeExtrusion(vp.viewDirection);
    const { ax, ay } = arbitraryAxis(d);
    const t = vp.viewTarget;
    const s = vp.scale;
    const dcs = Matrix44.fromRows(ax.x, ax.y, ax.z, 0, ay.x, ay.y, ay.z, 0, d.x, d.y, d.z, 0, 0, 0, 0, 1);
    return Matrix44.product(
        Matrix44.translation(vp.center.x - s * vp.viewCenter.x, vp.center.y - s * vp.viewCenter.y, 0),
        Matrix44.scaling(s, s, s),
        Matrix44.rotationZ(degToRad(vp.twist)),
        dcs,
        Matrix44.translation(-t.x, -t.y, -t.z),
    );
}

/** Rectangle of the viewport in paper coordinates as a closed ring. */
export function viewportRect(vp: ViewportEntity): Float64Array {
    const hw = Math.abs(vp.width) / 2;
    const hh = Math.abs(vp.height) / 2;
    const { x, y } = vp.center;
    return Float64Array.of(x - hw, y - hh, x + hw, y - hh, x + hw, y + hh, x - hw, y + hh);
}

/** Closed outline of a clip-boundary entity (paper coordinates), or undefined if unsupported. */
export function boundaryPath(e: Entity): Path2 | undefined {
    const id = Matrix44.identity();
    const curve = (c: Curve3): Path2 => ({ subpaths: [{ ...projectCurve3(c, id), closed: true }] });
    switch (e.type) {
        case "LWPOLYLINE": {
            const p = e as LwPolylineEntity;
            const verts: PolylineVertex[] = p.vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge }));
            if (verts.length < 2) return undefined;
            const plane = ocsToWcsMatrix(p.extrusion).planeToAffine2(p.elevation);
            return transformPath({ subpaths: [bulgePolylineToSubpath(verts, true)] }, plane);
        }
        case "POLYLINE": {
            const p = e as PolylineEntity;
            if (p.flags & (8 | 16 | 64)) return undefined;
            const verts: PolylineVertex[] = p.vertices
                .filter((v) => (v.flags & 16) === 0)
                .map((v) => ({ x: v.location.x, y: v.location.y, bulge: (p.flags & 4) !== 0 ? 0 : v.bulge }));
            if (verts.length < 2) return undefined;
            const plane = ocsToWcsMatrix(p.extrusion).planeToAffine2(p.elevationPoint.z);
            return transformPath({ subpaths: [bulgePolylineToSubpath(verts, true)] }, plane);
        }
        case "CIRCLE": {
            const c = e as CircleEntity;
            return curve(
                ellipticArcCurve3(ocsArcToEllipticArc3(c.center, c.radius, 0, Math.PI * 2, c.extrusion)),
            );
        }
        case "ELLIPSE": {
            const x = e as EllipseEntity;
            const el = ellipseFromDxf({
                center: x.center,
                majorAxis: x.majorAxis,
                ratio: x.ratio,
                startParam: 0,
                endParam: Math.PI * 2,
                extrusion: x.extrusion,
            });
            return curve(ellipticArcCurve3(el));
        }
        case "SPLINE": {
            const s = e as SplineEntity;
            const res = buildSplineCurve({
                degree: s.degree,
                flags: s.flags,
                knots: s.knots,
                controlPoints: s.controlPoints,
                weights: s.weights,
                fitPoints: s.fitPoints,
                startTangent: s.startTangent,
                endTangent: s.endTangent,
            });
            return res.curve ? curve({ kind: "nurbs", curve: res.curve }) : undefined;
        }
        default:
            return undefined;
    }
}

/** The clip entity of a non-rectangular viewport, if any. */
function clipEntity(fe: Frontend, vp: ViewportEntity): Entity | undefined {
    if (!(vp.flags & ViewportFlags.NonRectangularClipping) || !vp.clipBoundaryHandle) return undefined;
    return fe.doc.getEntity(vp.clipBoundaryHandle);
}

/** Clip rings of a viewport in paper coordinates. */
export function viewportClipRings(fe: Frontend, vp: ViewportEntity): Float64Array[] {
    const ce = clipEntity(fe, vp);
    if (ce) {
        const path = boundaryPath(ce);
        if (path) return flattenPath(path, fe.tolerance / 4).map((p) => p.points);
        fe.note(`viewport-clip:${ce.dxfType}`);
    }
    return [viewportRect(vp)];
}

function layerHandles(fe: Frontend): Map<string, string> {
    let m = fe.caches.get("viewport:layer-handles") as Map<string, string> | undefined;
    if (!m) {
        m = new Map();
        for (const l of fe.doc.tables.layers) if (l.handle) m.set(l.handle.toUpperCase(), l.name);
        fe.caches.set("viewport:layer-handles", m);
    }
    return m;
}

function frozenLayers(fe: Frontend, vp: ViewportEntity): Set<string> {
    const byHandle = layerHandles(fe);
    const out = new Set<string>();
    for (const h of vp.frozenLayerHandles) {
        const n = byHandle.get(h.toUpperCase());
        if (n) out.add(n.toUpperCase());
    }
    for (const n of vp.frozenLayerNames) out.add(n.toUpperCase());
    return out;
}

/** Draws model space through a viewport (clip, VP layer state, PSLTSCALE). */
export function drawViewportContent(fe: Frontend, vp: ViewportEntity, ctx: LayoutContext): void {
    const s = vp.scale;
    if (!(s > 0) || !Number.isFinite(s)) {
        fe.note("viewport-invalid-scale");
        return;
    }
    // not implemented (note 08 §3.5): perspective views
    if (vp.flags & ViewportFlags.Perspective) fe.note("viewport-perspective");
    const m = viewportMatrix(vp);
    const depth = depthRange(vp);
    const prev = fe.props.viewport;
    fe.props.viewport = { handle: vp.handle, frozen: frozenLayers(fe, vp) };
    fe.pushClip(viewportClipRings(fe, vp));
    try {
        const msp = fe.doc.modelSpace;
        const entities = fe.drawOrder.entities(msp);
        if (depth) {
            const d = normalizeExtrusion(vp.viewDirection);
            const t = vp.viewTarget;
            const [lo, hi] = depth;
            fe.entityFilters.push(
                (e, cst) =>
                    cst.stack.length !== 1 ||
                    depthOverlaps(
                        e,
                        (p) => d.x * (p.x - t.x) + d.y * (p.y - t.y) + d.z * (p.z - t.z),
                        lo,
                        hi,
                    ),
            );
        }
        fe.drawEntities(entities, {
            m,
            inh: TOP_LEVEL,
            stack: [msp.name.toUpperCase()],
            // PSLTSCALE 1: dash lengths in paper units; 0: in model units (scaled with the viewport)
            linetypeScale: layoutPsltscale(fe.doc, ctx) ? 1 : s,
        });
    } finally {
        if (depth) fe.entityFilters.pop();
        fe.popClip();
        fe.props.viewport = prev;
    }
}

/**
 * Front/back clip planes as a depth interval along the view direction from the target
 * (VERIFIED-BY-ACAD layouts/clipplanes-*): back clip (0x4) keeps depth ≥ 44; front clip (0x2)
 * keeps depth ≤ 43 with 0x10 ("front clip not at eye"), and depth ≤ 0 without it.
 */
function depthRange(vp: ViewportEntity): [number, number] | undefined {
    const f = vp.flags;
    if (!(f & (ViewportFlags.FrontClip | ViewportFlags.BackClip))) return undefined;
    const lo = f & ViewportFlags.BackClip ? vp.backClip : Number.NEGATIVE_INFINITY;
    let hi = Number.POSITIVE_INFINITY;
    if (f & ViewportFlags.FrontClip) hi = f & ViewportFlags.FrontClipNotAtEye ? vp.frontClip : 0;
    return [lo, hi];
}

setPaperSpaceHooks({ drawViewportContent, viewportClipRings });

// Frame: the VIEWPORT as a paper-space entity (layer visibility is handled by the frontend:
// off / frozen / no-plot / Defpoints layers hide the frame but not the content).
registerDrawer("VIEWPORT", (fe, e, st) => {
    const vp = e as ViewportEntity;
    const paper = currentPaper(fe);
    if (!paper || st.stack.length !== 1 || isModelStack(st.stack) || vp === paper.overall) return;
    if (clipEntity(fe, vp)) return;
    const ring = viewportRect(vp);
    const pts = [0, 1, 2, 3].map((k) => ({ x: ring[k * 2]!, y: ring[k * 2 + 1]! }));
    const segments = pts.map((p, k) => ({ kind: "line" as const, p0: p, p1: pts[(k + 1) % 4]! }));
    // the frame plots in its colour but always continuous and 1 px: the VIEWPORT's linetype and
    // lineweight are ignored (VERIFIED-BY-ACAD layouts/frame-layer-props)
    const r = { ...fe.resolve(vp, st), lineweight: 0 };
    fe.strokePath({ subpaths: [{ segments, closed: true }] }, r, vp, st, { noLinetype: true });
});

function isModelStack(stack: readonly string[]): boolean {
    const k = stack[0] ?? "";
    return k === "*MODEL_SPACE" || k === "$MODEL_SPACE";
}
