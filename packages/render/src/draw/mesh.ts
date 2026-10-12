/**
 * MESH (AcDbSubDMesh) wireframe (note 03 §3.14). AutoCAD's 2D wireframe plot shows the edges of
 * the level-0 cage; at subdivision level L > 0 these edges follow the smoothed surface
 * (Catmull–Clark, L steps) and the finer subdivision edges are not drawn (misc/mesh-box-*,
 * VERIFIED-BY-ACAD 2026-09-30 for the edge set; the exact smoothing is UNVERIFIED pixel-wise).
 * Creases: sharpness c keeps an edge sharp for c levels (−1 = always), semi-sharp rules after
 * DeRose et al. 1998; boundary edges are sharp.
 */
import { polyline3, projectCurve3, type Vec3 } from "@truedxf/geometry";
import type { MeshEntity } from "@truedxf/model";
import { registerDrawer } from "../frontend.ts";

interface Edge {
    a: number;
    b: number;
    faces: number[];
    sharp: number;
}

const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
const add3 = (p: Vec3, q: Vec3, s = 1): Vec3 => ({ x: p.x + q.x * s, y: p.y + q.y * s, z: p.z + q.z * s });
const scale3 = (p: Vec3, s: number): Vec3 => ({ x: p.x * s, y: p.y * s, z: p.z * s });
const lerp3 = (p: Vec3, q: Vec3, t: number): Vec3 => add3(scale3(p, 1 - t), q, t);

/** One Catmull–Clark step; `chains` (vertex index lists along original edges) are refined in place. */
function subdivide(
    verts: Vec3[],
    faces: number[][],
    sharpness: Map<string, number>,
    chains: number[][],
): { verts: Vec3[]; faces: number[][]; sharpness: Map<string, number> } {
    const edges = new Map<string, Edge>();
    faces.forEach((f, fi) => {
        for (let i = 0; i < f.length; i++) {
            const a = f[i]!;
            const b = f[(i + 1) % f.length]!;
            const k = key(a, b);
            let e = edges.get(k);
            if (!e) edges.set(k, (e = { a, b, faces: [], sharp: sharpness.get(k) ?? 0 }));
            e.faces.push(fi);
        }
    });
    const facePts = faces.map((f) =>
        scale3(
            f.reduce((s, i) => add3(s, verts[i]!), { x: 0, y: 0, z: 0 }),
            1 / f.length,
        ),
    );
    const nv = verts.length;
    const nf = faces.length;
    // new vertex numbering: old vertices, face points, edge points
    const edgeIndex = new Map<string, number>();
    const out: Vec3[] = new Array(nv + nf);
    const edgePts: Vec3[] = [];
    const isSharp = (e: Edge) => e.faces.length !== 2 || e.sharp < 0 || e.sharp > 0;
    for (const [k, e] of edges) {
        const mid = scale3(add3(verts[e.a]!, verts[e.b]!), 0.5);
        let p = mid;
        if (e.faces.length === 2 && e.sharp >= 0 && e.sharp < 1) {
            const smooth = scale3(
                add3(add3(verts[e.a]!, verts[e.b]!), add3(facePts[e.faces[0]!]!, facePts[e.faces[1]!]!)),
                0.25,
            );
            p = lerp3(smooth, mid, e.sharp);
        }
        edgeIndex.set(k, nv + nf + edgePts.length);
        edgePts.push(p);
    }
    // vertex points
    const incident: Edge[][] = Array.from({ length: nv }, () => []);
    for (const e of edges.values()) {
        incident[e.a]!.push(e);
        incident[e.b]!.push(e);
    }
    const vfaces: number[][] = Array.from({ length: nv }, () => []);
    faces.forEach((f, fi) => {
        for (const i of f) vfaces[i]!.push(fi);
    });
    for (let v = 0; v < nv; v++) {
        const S = verts[v]!;
        const inc = incident[v]!;
        const n = inc.length;
        if (n === 0) {
            out[v] = S;
            continue;
        }
        const sharpEdges = inc.filter(isSharp);
        let smooth: Vec3 = S;
        if (vfaces[v]!.length > 0) {
            const Q = scale3(
                vfaces[v]!.reduce((s, fi) => add3(s, facePts[fi]!), { x: 0, y: 0, z: 0 }),
                1 / vfaces[v]!.length,
            );
            const R = scale3(
                inc.reduce((s, e) => add3(s, scale3(add3(verts[e.a]!, verts[e.b]!), 0.5)), {
                    x: 0,
                    y: 0,
                    z: 0,
                }),
                1 / n,
            );
            smooth = scale3(add3(add3(Q, R, 2), S, n - 3), 1 / n);
        }
        let p: Vec3;
        if (sharpEdges.length < 2) p = smooth;
        else {
            let sharpRule: Vec3;
            if (sharpEdges.length === 2) {
                const o0 = verts[sharpEdges[0]!.a === v ? sharpEdges[0]!.b : sharpEdges[0]!.a]!;
                const o1 = verts[sharpEdges[1]!.a === v ? sharpEdges[1]!.b : sharpEdges[1]!.a]!;
                sharpRule = scale3(add3(add3(o0, o1), S, 6), 1 / 8);
            } else sharpRule = S;
            // semi-sharp: blend by the mean sharpness of the sharp edges (boundary / −1 count as 1)
            const mean =
                sharpEdges.reduce(
                    (s, e) => s + (e.faces.length !== 2 || e.sharp < 0 ? 1 : Math.min(1, e.sharp)),
                    0,
                ) / sharpEdges.length;
            p = mean >= 1 ? sharpRule : lerp3(smooth, sharpRule, mean);
        }
        out[v] = p;
    }
    for (let f = 0; f < nf; f++) out[nv + f] = facePts[f]!;
    out.push(...edgePts);
    // new faces and sharpness
    const nfaces: number[][] = [];
    const nsharp = new Map<string, number>();
    faces.forEach((f, fi) => {
        const fp = nv + fi;
        for (let i = 0; i < f.length; i++) {
            const v = f[i]!;
            const next = edgeIndex.get(key(v, f[(i + 1) % f.length]!))!;
            const prev = edgeIndex.get(key(f[(i + f.length - 1) % f.length]!, v))!;
            nfaces.push([v, next, fp, prev]);
        }
    });
    for (const [k, e] of edges) {
        const m = edgeIndex.get(k)!;
        const s = e.sharp < 0 ? -1 : Math.max(0, e.sharp - 1);
        if (s !== 0) {
            nsharp.set(key(e.a, m), s);
            nsharp.set(key(m, e.b), s);
        }
    }
    for (const c of chains) {
        const refined: number[] = [c[0]!];
        for (let i = 0; i + 1 < c.length; i++)
            refined.push(edgeIndex.get(key(c[i]!, c[i + 1]!)) ?? c[i + 1]!, c[i + 1]!);
        c.length = 0;
        c.push(...refined);
    }
    return { verts: out, faces: nfaces, sharpness: nsharp };
}

const MAX_LEVEL = 6;

registerDrawer("MESH", (fe, ent, st) => {
    const e = ent as MeshEntity;
    if (e.vertices.length === 0) return;
    // cage edges: the stored edge list, else the face edges
    const pairs: [number, number][] = [];
    const seen = new Set<string>();
    const addEdge = (a: number, b: number) => {
        const k = key(a, b);
        if (a === b || seen.has(k) || a >= e.vertices.length || b >= e.vertices.length) return;
        seen.add(k);
        pairs.push([a, b]);
    };
    for (const [a, b] of e.edges) addEdge(a, b);
    for (const f of e.faces) for (let i = 0; i < f.length; i++) addEdge(f[i]!, f[(i + 1) % f.length]!);
    const chains = pairs.map(([a, b]) => [a, b]);
    let verts: Vec3[] = [...e.vertices];
    const level = Math.min(MAX_LEVEL, Math.max(0, e.subdivisionLevel));
    if (level > 0 && e.faces.length > 0) {
        let faces = e.faces.map((f) => [...f]);
        let sharpness = new Map<string, number>();
        e.edges.forEach(([a, b], i) => {
            const c = e.creases[i] ?? 0;
            if (c !== 0) sharpness.set(key(a, b), c);
        });
        for (let l = 0; l < level; l++)
            ({ verts, faces, sharpness } = subdivide(verts, faces, sharpness, chains));
    }
    const r = fe.resolve(e, st);
    for (const c of chains) {
        const sp = projectCurve3(polyline3(c.map((i) => verts[i]!)), st.m);
        fe.strokePath({ subpaths: [sp] }, r, e, st);
    }
});
