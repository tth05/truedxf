/** Proxy drawing shares the normal stroke, polyline and TEXT paths (note 07 §15). */
import { codepageToEncoding } from "@truedxf/core";
import { FillRule, projectCurve3 } from "@truedxf/geometry";
import type { Entity } from "@truedxf/model";
import { type DrawState, type Frontend, registerDrawer } from "../frontend.ts";
import { drawProxyText } from "../text.ts";
import { polyline2d } from "./basic.ts";
import { type DecodeContext, decodeProxyGraphics, type Traits } from "./proxy-data.ts";

export { decodeProxyGraphics } from "./proxy-data.ts";

const CTX_CACHE = new WeakMap<object, DecodeContext>();

function context(fe: Frontend): DecodeContext {
    let c = CTX_CACHE.get(fe.doc);
    if (!c) {
        c = {
            layers: fe.doc.tables.layers.entries.map((l) => l.name),
            linetypes: fe.doc.tables.linetypes.entries.map((l) => l.name),
            dxfversion: fe.doc.acadver,
            encoding: codepageToEncoding(fe.doc.header.str("$DWGCODEPAGE", "ANSI_1252")).encoding,
        };
        CTX_CACHE.set(fe.doc, c);
    }
    return c;
}

/** Draws an entity's proxy graphics with its own properties as the initial traits. */
export function drawProxyGraphics(fe: Frontend, e: Entity, st: DrawState): boolean {
    const g = e.proxyGraphics;
    if (!g || g.length < 8) return false;
    const initial: Traits = {
        color: e.color,
        trueColor: e.trueColor,
        layer: e.layer,
        linetype: e.linetype,
        lineweight: e.lineweight,
        linetypeScale: e.linetypeScale,
        fill: false,
    };
    const { primitives, unsupported } = decodeProxyGraphics(g, initial, context(fe));
    for (const u of unsupported) fe.note(u);
    for (const p of primitives) {
        const sub = { ...e, ...p.traits } as Entity;
        const r = fe.resolve(sub, st);
        if (!fe.props.isPlotted(sub, st.inh)) continue;
        if (p.kind === "text") {
            drawProxyText(fe, p.text, sub, p.transform ? { ...st, m: st.m.multiply(p.transform) } : st);
        } else if (p.kind === "lwpolyline") {
            polyline2d(
                fe,
                sub,
                p.transform ? { ...st, m: st.m.multiply(p.transform) } : st,
                p.vertices,
                p.closed,
                p.constantWidth,
                p.normal,
                p.elevation,
                p.plinegen,
            );
        } else if (p.kind === "curve")
            fe.strokePath({ subpaths: [projectCurve3(p.curve, st.m)] }, r, sub, st);
        else if (p.kind === "point") {
            const q = st.m.transformPoint(p.p);
            fe.pixel(q.x, q.y, fe.color(r));
        } else {
            const rings = p.rings.map((points) => {
                const ring = new Float64Array(points.length * 2);
                points.forEach((v, i) => {
                    const q = st.m.transformPoint(v);
                    ring[i * 2] = q.x;
                    ring[i * 2 + 1] = q.y;
                });
                return ring;
            });
            if (fe.fillMode) fe.fillRings(rings, fe.color(r), FillRule.EvenOdd);
            else for (const ring of rings) fe.strokeFlat(ring, true, r);
        }
    }
    return true;
}

registerDrawer(["ACAD_PROXY_ENTITY", "*PROXY-GRAPHICS"], (fe, e, st) => {
    if (!drawProxyGraphics(fe, e, st)) fe.note("proxy-no-graphics");
});
