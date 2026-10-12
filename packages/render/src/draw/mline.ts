/**
 * MLINE (note 07 §12). The vertex data hold the final geometry: element k at vertex i starts at
 * `P = V_i + a0 · miter_i`; the 41 list continues with dash start / stop distances along the
 * segment direction (MLEDIT breaks); the last start runs to the next vertex's point.
 *
 * VERIFIED-BY-ACAD (mline suite, 2026-09-30):
 * - Element colours / linetypes behave like exploded LINEs on the MLINE's layer: BYLAYER → the
 *   MLINE's layer, BYBLOCK → the enclosing block context (top level: ACI 7 / Continuous), the
 *   MLINE's own colour and linetype are not used (mline/props-modelspace, props-in-insert-*).
 * - Square caps and joints are split at their midpoint: the half next to the outermost element
 *   of each side takes that element's colour; round caps are two quarter arcs (outer pair), inner
 *   arcs join the symmetric inner pairs (k, n−1−k), k = 1 … ⌊n/2⌋−1 (mline/caps-*).
 */
import {
    ellipticArcCurve3,
    FillRule,
    line3,
    type Matrix44,
    type PathSegment,
    projectCurve3,
    type Vec3,
} from "@truedxf/geometry";
import type {
    DictionaryObject,
    DxfDocument,
    Entity,
    MLineEntity,
    MLineStyleElement,
    MLineStyleObject,
} from "@truedxf/model";
import { registerDrawer } from "../frontend.ts";

const FILL = 1;
const MITERS = 2;
const START_SQUARE = 16;
const START_INNER = 32;
const START_ROUND = 64;
const END_SQUARE = 256;
const END_INNER = 512;
const END_ROUND = 1024;
const CLOSED = 2;
const SUPPRESS_START = 4;
const SUPPRESS_END = 8;

const STANDARD: Pick<MLineStyleObject, "flags" | "fillColor" | "fillTrueColor" | "elements"> = {
    flags: 0,
    fillColor: 256,
    fillTrueColor: undefined,
    elements: [
        { offset: 0.5, color: 256, trueColor: undefined, linetype: "BYLAYER" },
        { offset: -0.5, color: 256, trueColor: undefined, linetype: "BYLAYER" },
    ],
};

function findStyle(doc: DxfDocument, e: MLineEntity): typeof STANDARD {
    const byHandle = e.styleHandle ? doc.getObject(e.styleHandle) : undefined;
    if (byHandle?.type === "MLINESTYLE") return byHandle as MLineStyleObject;
    const dict = doc.namedObject("ACAD_MLINESTYLE") as DictionaryObject | undefined;
    if (dict?.type === "DICTIONARY") {
        const key = (e.styleName || "Standard").toUpperCase();
        const hit = dict.entries.find((x) => x.key.toUpperCase() === key);
        const o = hit ? doc.getObject(hit.handle) : undefined;
        if (o?.type === "MLINESTYLE") return o as MLineStyleObject;
    }
    return STANDARD;
}

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mid = (a: Vec3, b: Vec3): Vec3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
});

/** Semicircle through a and b, bulging towards `out`; returns its two quarter arcs (a side first). */
function capArcs(a: Vec3, b: Vec3, out: Vec3, normal: Vec3) {
    const c = mid(a, b);
    const u = sub(a, c);
    let v = cross(normal, u);
    if (dot(v, out) < 0) v = { x: -v.x, y: -v.y, z: -v.z };
    const q = Math.PI / 2;
    return [
        ellipticArcCurve3({ center: c, u, v, start: 0, sweep: q }),
        ellipticArcCurve3({ center: c, u, v, start: q, sweep: q }),
    ] as const;
}

registerDrawer("MLINE", (fe, ent, st) => {
    const e = ent as MLineEntity;
    const verts = e.vertices;
    if (verts.length < 2) return;
    const style = findStyle(fe.doc, e);
    const n = Math.min(...verts.map((v) => v.elements.length));
    if (n < 1) return;
    const closed = (e.flags & CLOSED) !== 0;
    const normal = e.extrusion;
    const pts = verts.map((v) =>
        v.elements.slice(0, n).map((el) => add(v.position, v.miter, el.params[0] ?? 0)),
    );
    // vertex element k is the k-th style element by descending offset; element 0 / n−1 are the
    // cap and joint ends whatever the stored geometry says (mline/unsorted-offsets-*)
    const sorted = [...style.elements].sort((a, b) => b.offset - a.offset);
    const order = [...Array(n).keys()];
    const top = order[0]!;
    const bot = order[n - 1]!;
    const elementEntity = (k: number): Entity => {
        const se: MLineStyleElement | undefined = sorted[k];
        return {
            ...e,
            color: se?.color ?? 256,
            trueColor: se?.trueColor,
            linetype: se?.linetype ?? "BYLAYER",
        } as Entity;
    };
    const elems = [...Array(n).keys()].map(elementEntity);
    const res = elems.map((x) => fe.resolve(x, st));
    const stroke = (curves: ReturnType<typeof line3 | typeof ellipticArcCurve3>[], k: number) => {
        const segs: PathSegment[] = [];
        for (const c of curves) segs.push(...projectCurve3(c, st.m).segments);
        if (segs.length)
            fe.strokePath({ subpaths: [{ segments: segs, closed: false }] }, res[k]!, elems[k], st);
    };
    const nseg = closed ? verts.length : verts.length - 1;
    const capsStart = !closed && (e.flags & SUPPRESS_START) === 0;
    const capsEnd = !closed && (e.flags & SUPPRESS_END) === 0;
    const last = verts.length - 1;
    const sOut = { x: -verts[0]!.direction.x, y: -verts[0]!.direction.y, z: -verts[0]!.direction.z };
    const eOut = verts[last - 1]!.direction;

    // ---- fill (drawn first, under the elements)
    if ((style.flags & FILL) !== 0 && fe.fillMode) {
        const arcPts = (a: Vec3, b: Vec3, out: Vec3) => {
            const [q1, q2] = capArcs(a, b, out, normal);
            const out3: Vec3[] = [];
            for (const q of [q1, q2])
                for (let k = 1; k <= 16; k++) {
                    const t = q.start + (q.sweep * k) / 16;
                    out3.push(add(add(q.center, q.u, Math.cos(t)), q.v, Math.sin(t)));
                }
            return out3;
        };
        // union of per-segment quads (+ cap half discs): self-overlapping MLINEs stay filled
        // (mline/random-0003)
        const rings: Float64Array[] = [];
        for (let i = 0; i < nseg; i++) {
            const j = (i + 1) % verts.length;
            rings.push(ccw(project([pts[i]![top]!, pts[j]![top]!, pts[j]![bot]!, pts[i]![bot]!], st.m)));
        }
        if (capsEnd && (style.flags & END_ROUND) !== 0)
            rings.push(
                ccw(project([pts[last]![bot]!, ...arcPts(pts[last]![bot]!, pts[last]![top]!, eOut)], st.m)),
            );
        if (capsStart && (style.flags & START_ROUND) !== 0)
            rings.push(ccw(project([pts[0]![top]!, ...arcPts(pts[0]![top]!, pts[0]![bot]!, sOut)], st.m)));
        const fillEnt = { ...e, color: style.fillColor, trueColor: style.fillTrueColor } as Entity;
        fe.fillRings(rings, fe.color(fe.resolve(fillEnt, st)), FillRule.NonZero);
    }

    // ---- element lines
    for (let k = 0; k < n; k++) {
        const segs: ReturnType<typeof line3>[] = [];
        for (let i = 0; i < nseg; i++) {
            const j = (i + 1) % verts.length;
            const p = pts[i]![k]!;
            const q = pts[j]![k]!;
            const d = verts[i]!.direction;
            const prm = verts[i]!.elements[k]!.params;
            if (prm.length <= 2) {
                segs.push(line3(prm.length === 2 && prm[1] ? add(p, d, prm[1]) : p, q));
                continue;
            }
            for (let m = 1; m < prm.length; m += 2) {
                const a = add(p, d, prm[m]!);
                const b = m + 1 < prm.length ? add(p, d, prm[m + 1]!) : q;
                segs.push(line3(a, b));
            }
        }
        // each segment is its own linetype unit (like exploded LINEs)
        for (const s of segs) stroke([s], k);
    }

    // ---- joints (display miters) and caps
    const split = (i: number) => {
        const a = pts[i]![top]!;
        const b = pts[i]![bot]!;
        const m = mid(a, b);
        stroke([line3(a, m)], top);
        stroke([line3(b, m)], bot);
    };
    if ((style.flags & MITERS) !== 0) {
        for (let i = closed ? 0 : 1; i < (closed ? verts.length : last); i++) split(i);
    }
    const caps = (i: number, square: number, round: number, inner: number, out: Vec3) => {
        if ((style.flags & square) !== 0) split(i);
        if ((style.flags & round) !== 0 && n >= 2) {
            const [q1, q2] = capArcs(pts[i]![top]!, pts[i]![bot]!, out, normal);
            stroke([q1], top);
            stroke([q2], bot);
        }
        if ((style.flags & inner) !== 0) {
            for (let j = 1; j < Math.floor(n / 2); j++) {
                const ka = order[j]!;
                const kb = order[n - 1 - j]!;
                const [q1, q2] = capArcs(pts[i]![ka]!, pts[i]![kb]!, out, normal);
                stroke([q1], ka);
                stroke([q2], kb);
            }
        }
    };
    if (capsStart) caps(0, START_SQUARE, START_ROUND, START_INNER, sOut);
    if (capsEnd) caps(last, END_SQUARE, END_ROUND, END_INNER, eOut);
});

function project(points: readonly Vec3[], m: Matrix44): Float64Array {
    const out = new Float64Array(points.length * 2);
    points.forEach((p, i) => {
        const q = m.transformPoint(p);
        out[i * 2] = q.x;
        out[i * 2 + 1] = q.y;
    });
    return out;
}

function ccw(r: Float64Array): Float64Array {
    let a = 0;
    const n = r.length >> 1;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        a += r[i * 2]! * r[j * 2 + 1]! - r[j * 2]! * r[i * 2 + 1]!;
    }
    if (a >= 0) return r;
    const out = new Float64Array(r.length);
    for (let i = 0; i < n; i++) {
        out[i * 2] = r[(n - 1 - i) * 2]!;
        out[i * 2 + 1] = r[(n - 1 - i) * 2 + 1]!;
    }
    return out;
}
