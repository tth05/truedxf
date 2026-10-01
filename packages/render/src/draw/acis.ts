/**
 * REGION / 3DSOLID / BODY (and the SURFACE family) as 2D wireframe from their ACIS SAT text
 * (note 03 §3.15): every ACIS edge is drawn — straight edges as lines, ellipse-curve edges as
 * elliptic arcs, other curves (intcurve, …) as the chord between their vertices (noted as
 * unsupported). The body transform record is applied. AutoCAD plots exactly these edges in 2D
 * wireframe (misc/solid-box-*, region-square-*, VERIFIED-BY-ACAD 2026-09-30: all 12 box edges,
 * hidden ones included, no isolines for planar faces).
 * R2013+ files keep the ACIS data as SAB (binary SAT) in the ACDSDATA section: ACDSRECORD
 * `320 <entity handle>`, `2 ASM_Data`, `94 <size>`, `310…` (tag layout after ezdxf acis/sab.py).
 */
import {
  type Curve3,
  ellipticArcCurve3,
  line3,
  Matrix44,
  NurbsCurve,
  projectCurve3,
  type Vec3,
} from "@truedxf/geometry";
import type { AcisEntity, DxfDocument } from "@truedxf/model";
import { registerDrawer } from "../frontend.ts";

interface SatRecord {
  type: string;
  tokens: string[];
}

/** Splits SAT text (after the header) into records terminated by "#". */
export function parseSat(lines: readonly string[]): SatRecord[] {
  const text = lines.join("\n");
  const out: SatRecord[] = [];
  // header: version line, product line, units line (ACIS ≥ 7.0); records start after them
  const all = text.split("\n");
  let start = 0;
  const version = Number(all[0]?.trim().split(/\s+/)[0] ?? 0);
  if (version > 0) start = version >= 700 ? 3 : 3;
  let buf: string[] = [];
  for (const raw of all.slice(start)) {
    for (const tok of raw.trim().split(/\s+/)) {
      if (!tok) continue;
      if (tok === "End-of-ACIS-data" || tok === "End-of-ASM-data") return out;
      if (tok === "#") {
        if (buf.length) out.push({ type: buf[0]!, tokens: buf.slice(1) });
        buf = [];
      } else buf.push(tok);
    }
  }
  return out;
}

/** SAB tag bytes (ezdxf acis/const.py Tags). */
const T_INT = 0x04;
const T_DOUBLE = 0x06;
const T_STR = 0x07;
const T_TRUE = 0x0a;
const T_FALSE = 0x0b;
const T_PTR = 0x0c;
const T_TYPE = 0x0d;
const T_TYPE_EX = 0x0e;
const T_SUB_START = 0x0f;
const T_SUB_END = 0x10;
const T_END = 0x11;
const T_LITERAL = 0x12;
const T_LOC = 0x13;
const T_DIR = 0x14;
const T_ENUM = 0x15;
const T_UNKNOWN_17 = 0x17;

/** Decodes SAB into SAT-like records (pointers "$n", booleans "reversed"/"forward"). */
export function parseSab(bytes: Uint8Array): SatRecord[] | undefined {
  const dec = new TextDecoder();
  const sig = dec.decode(bytes.subarray(0, 15));
  if (sig !== "ACIS BinaryFile" && sig !== "ASM BinaryFile4") return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 15 + 16;
  const out: SatRecord[] = [];
  // header strings (product, version, date) and doubles (units, tolerances)
  const skipTag = () => {
    const t = bytes[i++]!;
    if (t === T_STR) i += 1 + bytes[i]!;
    else if (t === T_DOUBLE) i += 8;
    else throw new Error("sab header");
  };
  try {
    for (let k = 0; k < 6; k++) skipTag();
    let type: string[] = [];
    let rec: SatRecord | undefined;
    const tokens: string[] = [];
    while (i < bytes.length) {
      const t = bytes[i++]!;
      switch (t) {
        case T_INT:
        case T_ENUM:
          tokens.push(String(dv.getInt32(i, true)));
          i += 4;
          break;
        case T_PTR:
          tokens.push(`$${dv.getInt32(i, true)}`);
          i += 4;
          break;
        case T_DOUBLE:
        case T_UNKNOWN_17:
          tokens.push(String(dv.getFloat64(i, true)));
          i += 8;
          break;
        case T_STR: {
          const n = bytes[i++]!;
          tokens.push(dec.decode(bytes.subarray(i, i + n)));
          i += n;
          break;
        }
        case T_LITERAL: {
          const n = dv.getInt32(i, true);
          i += 4;
          tokens.push(...dec.decode(bytes.subarray(i, i + n)).split(/\s+/));
          i += n;
          break;
        }
        case T_TRUE:
          tokens.push("reversed");
          break;
        case T_FALSE:
          tokens.push("forward");
          break;
        case T_TYPE_EX: {
          const n = bytes[i++]!;
          type.push(dec.decode(bytes.subarray(i, i + n)));
          i += n;
          break;
        }
        case T_TYPE: {
          const n = bytes[i++]!;
          type.push(dec.decode(bytes.subarray(i, i + n)));
          i += n;
          if (!rec) rec = { type: type.join("-"), tokens: [] };
          else tokens.push(type.join("-"));
          type = [];
          break;
        }
        case T_LOC:
        case T_DIR:
          for (let k = 0; k < 3; k++) tokens.push(String(dv.getFloat64(i + k * 8, true)));
          i += 24;
          break;
        case T_SUB_START:
        case T_SUB_END:
          break;
        case T_END:
          if (rec) {
            rec.tokens = tokens.splice(0);
            if (rec.type === "End-of-ACIS-data" || rec.type === "End-of-ASM-data") return out;
            out.push(rec);
          }
          rec = undefined;
          break;
        default:
          return out;
      }
    }
  } catch {
    return out;
  }
  return out;
}

/** SAB blobs of the ACDSDATA section by entity handle. */
export function sabByHandle(doc: DxfDocument): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const store = doc.tags.store;
  for (const sec of doc.tags.sections) {
    if (sec.name !== "ACDSDATA") continue;
    let handle: string | undefined;
    let isAsm = false;
    for (let i = sec.start; i < sec.end; i++) {
      const code = store.codes[i]!;
      if (code === 0) {
        handle = undefined;
        isAsm = false;
      } else if (code === 320) handle = store.handle(i);
      else if (code === 2) isAsm = store.str(i).trim() === "ASM_Data";
      else if (code === 94 && handle && isAsm) {
        const size = store.int(i);
        const parts: Uint8Array[] = [];
        let n = 0;
        let k = i + 1;
        for (; k < sec.end && store.codes[k] === 310; k++) {
          const b = store.binary(k);
          parts.push(b);
          n += b.length;
        }
        const buf = new Uint8Array(n);
        let o = 0;
        for (const b of parts) {
          buf.set(b, o);
          o += b.length;
        }
        out.set(handle.toUpperCase(), size > 0 && size <= n ? buf.subarray(0, size) : buf);
        i = k - 1;
      }
    }
  }
  return out;
}

const SAB_CACHE = new WeakMap<DxfDocument, Map<string, Uint8Array>>();

const ref = (t: string) => (t.startsWith("$") ? Number(t.slice(1)) : Number.NaN);
const nums = (r: SatRecord) => r.tokens.filter((t) => /^[-+]?(\d|\.\d)/.test(t)).map(Number);

// tolerant vertices / edges ("tvertex-vertex", "tedge-edge") are derived types
const isVertex = (t: string | undefined) => t === "vertex" || (t?.endsWith("-vertex") ?? false);
const isEdge = (t: string) => t === "edge" || t.endsWith("-edge");

/** Wireframe curves of an ACIS model in WCS (block coordinates). */
export function satWireframe(lines: readonly string[] | SatRecord[]): {
  curves: Curve3[];
  unsupported: number;
} {
  const recs =
    typeof lines[0] === "string" || lines.length === 0 ? parseSat(lines as string[]) : (lines as SatRecord[]);
  const at = (i: number) => (i >= 0 && i < recs.length ? recs[i] : undefined);
  const point = (vi: number): Vec3 | undefined => {
    const v = at(vi);
    if (!isVertex(v?.type)) return undefined;
    for (const t of v.tokens) {
      const p = at(ref(t));
      if (p?.type === "point") {
        const n = nums(p);
        const k = n.length - 3;
        if (k >= 0) return { x: n[k]!, y: n[k + 1]!, z: n[k + 2]! };
      }
    }
    return undefined;
  };
  // body transform (row vectors: p' = (p · R + t) · scale)
  let xf: number[] | undefined;
  for (const r of recs)
    if (r.type === "transform") {
      const n = nums(r).slice(-13);
      if (n.length === 13) xf = n;
      break;
    }
  const T = (p: Vec3): Vec3 => {
    if (!xf) return p;
    const s = xf[12] ?? 1;
    return {
      x: (p.x * xf[0]! + p.y * xf[3]! + p.z * xf[6]! + xf[9]!) * s,
      y: (p.x * xf[1]! + p.y * xf[4]! + p.z * xf[7]! + xf[10]!) * s,
      z: (p.x * xf[2]! + p.y * xf[5]! + p.z * xf[8]! + xf[11]!) * s,
    };
  };
  const Tdir = (d: Vec3): Vec3 => {
    if (!xf) return d;
    const s = xf[12] ?? 1;
    return {
      x: (d.x * xf[0]! + d.y * xf[3]! + d.z * xf[6]!) * s,
      y: (d.x * xf[1]! + d.y * xf[4]! + d.z * xf[7]!) * s,
      z: (d.x * xf[2]! + d.y * xf[5]! + d.z * xf[8]!) * s,
    };
  };
  const curves: Curve3[] = [];
  let unsupported = 0;
  for (const r of recs) {
    if (!isEdge(r.type)) continue;
    const refs = r.tokens.map(ref).filter((i) => !Number.isNaN(i) && i >= 0);
    const vs = refs.filter((i) => isVertex(at(i)?.type));
    const ci = refs.find((i) => /-curve$|^intcurve/.test(at(i)?.type ?? ""));
    if (vs.length < 1) continue;
    const a = point(vs[0]!);
    const b = point(vs[1] ?? vs[0]!);
    if (!a || !b) continue;
    const curve = ci !== undefined ? at(ci)! : undefined;
    const reversed = r.tokens.includes("reversed");
    if (curve && curve.type !== "straight-curve") {
      // Curved edges are bounded by their vertices: a curve that does not pass through them was
      // misread (or is a kind we cannot evaluate) and falls back to the chord, noted.
      const c =
        curve.type === "ellipse-curve"
          ? ellipseEdge(geometry(curve), T, Tdir, a, b, reversed)
          : splineEdge(geometry(curve), edgeParams(r, vs), reversed, T, a, b);
      if (c) {
        curves.push(c);
        continue;
      }
      unsupported++;
    }
    curves.push(line3(T(a), T(b)));
  }
  return { curves, unsupported };
}

/**
 * Geometry tokens of a curve record: everything after its header pointers. The header is
 * `$attrib` (old SAT) or `$attrib <history id> $…` (ACIS ≥ 7, SAB); reading numbers from the
 * start of the record took the history id −1 for the first coordinate, which made ellipse edges
 * millions of units large (corpus libredwg#1021 test-trichter, netDxf#475 MUEB).
 */
function geometry(r: SatRecord): string[] {
  let k = 0;
  for (let i = 0; i < Math.min(4, r.tokens.length); i++) if (r.tokens[i]!.startsWith("$")) k = i + 1;
  return r.tokens.slice(k);
}

/** Edge parameters (start, end) stored after the vertex pointers (newer ACIS), if any. */
function edgeParams(r: SatRecord, vs: readonly number[]): [number, number] | undefined {
  // positional: a closed edge points to the same vertex twice
  const at: number[] = [];
  for (let i = 0; i < r.tokens.length && at.length < 2; i++) {
    const t = r.tokens[i]!;
    if (t.startsWith("$") && vs.includes(ref(t))) at.push(Number(r.tokens[i + 1]));
  }
  const [p0, p1] = at;
  return p0 !== undefined && p1 !== undefined && Number.isFinite(p0) && Number.isFinite(p1)
    ? [p0, p1]
    : undefined;
}

type Xf = (p: Vec3) => Vec3;

const dist = (p: Vec3, q: Vec3) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

/** Rounding slack for coordinates near these points: old SAT text has 6 significant digits. */
const precision = (...ps: Vec3[]) =>
  1e-5 * Math.max(...ps.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)))) + 1e-9;

/**
 * Elliptic arc of an `ellipse-curve` edge (centre, normal, major axis, ratio) from its start to
 * its end vertex, in local coordinates; undefined unless both vertices lie on the ellipse.
 */
function ellipseEdge(
  g: readonly string[],
  T: Xf,
  Tdir: Xf,
  a: Vec3,
  b: Vec3,
  reversed: boolean,
): Curve3 | undefined {
  const n = g.slice(0, 10).map(Number);
  if (n.length < 10 || !n.every(Number.isFinite)) return undefined;
  const c = { x: n[0]!, y: n[1]!, z: n[2]! };
  const nrm = { x: n[3]!, y: n[4]!, z: n[5]! };
  const u = { x: n[6]!, y: n[7]!, z: n[8]! };
  const ratio = n[9]!;
  const ul = Math.hypot(u.x, u.y, u.z);
  const nl = Math.hypot(nrm.x, nrm.y, nrm.z);
  if (!(ul > 0) || !(nl > 0) || !(ratio > 0)) return undefined;
  // minor axis = N̂ × major · ratio, taken before the body transform so that a mirroring
  // transform keeps the curve (N̂ is a pseudo-vector)
  const w = {
    x: ((nrm.y * u.z - nrm.z * u.y) / nl) * ratio,
    y: ((nrm.z * u.x - nrm.x * u.z) / nl) * ratio,
    z: ((nrm.x * u.y - nrm.y * u.x) / nl) * ratio,
  };
  const wl2 = w.x * w.x + w.y * w.y + w.z * w.z;
  const ang = (p: Vec3) => {
    const d = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
    return Math.atan2(
      (d.x * w.x + d.y * w.y + d.z * w.z) / wl2,
      (d.x * u.x + d.y * u.y + d.z * u.z) / (ul * ul),
    );
  };
  const on = (p: Vec3, t: number) =>
    dist(p, {
      x: c.x + u.x * Math.cos(t) + w.x * Math.sin(t),
      y: c.y + u.y * Math.cos(t) + w.y * Math.sin(t),
      z: c.z + u.z * Math.cos(t) + w.z * Math.sin(t),
    }) <= tol;
  const tol = 1e-3 * ul + precision(c, a, b);
  let t0 = ang(a);
  let t1 = ang(b);
  if (!on(a, t0) || !on(b, t1)) return undefined;
  if (reversed) [t0, t1] = [t1, t0];
  let sweep = t1 - t0;
  while (sweep <= 1e-12) sweep += 2 * Math.PI;
  return ellipticArcCurve3({ center: T(c), u: Tdir(u), v: Tdir(w), start: t0, sweep });
}

/**
 * The B-spline (`nubs`) / NURBS (`nurbs`) approximation stored in an intcurve (and other
 * procedural curves): `degree closure knotCount (knot multiplicity)… point…`, each end knot
 * written once less than in a clamped knot vector (ezdxf acis/entities.py). Trimmed to the edge
 * parameters when they lie on the spline, else drawn whole; undefined unless the result runs
 * between the edge's vertices.
 */
function splineEdge(
  g: readonly string[],
  params: [number, number] | undefined,
  reversed: boolean,
  T: Xf,
  a: Vec3,
  b: Vec3,
): Curve3 | undefined {
  const s = g.findIndex((t) => t === "nubs" || t === "nurbs");
  if (s < 0) return undefined;
  const spline = parseBs(g, s + 1, g[s] === "nurbs");
  if (!spline) return undefined;
  const lo = spline.domainStart;
  const hi = spline.domainEnd;
  const span = hi - lo;
  const ranges: [number, number][] = [];
  if (params) {
    // a reversed edge stores the negated curve parameters
    const [p0, p1] = params;
    ranges.push(reversed ? [-p1, -p0] : [p0, p1], reversed ? [p0, p1] : [-p1, -p0]);
  }
  ranges.push([lo, hi]);
  let size = dist(a, b);
  const P = spline.points;
  for (let i = 0; i + 2 < P.length; i += 3)
    size = Math.max(size, dist({ x: P[i]!, y: P[i + 1]!, z: P[i + 2]! }, a));
  const tol = 1e-3 * size + precision(a, b);
  const at = (u: number) => {
    const q = spline.pointAt(u);
    return { x: q[0]!, y: q[1]!, z: q[2]! };
  };
  if (dist(a, b) === 0 && dist(at(lo), at(hi)) <= tol) {
    // a closed edge on a closed (periodic) spline may start anywhere on it: the whole spline,
    // if the vertex lies in its control point box (the curve stays inside the control hull)
    let inside = true;
    for (const [c, v] of [
      [0, a.x],
      [1, a.y],
      [2, a.z],
    ] as const) {
      let mn = Number.POSITIVE_INFINITY;
      let mx = Number.NEGATIVE_INFINITY;
      for (let i = c; i < P.length; i += 3) {
        mn = Math.min(mn, P[i]!);
        mx = Math.max(mx, P[i]!);
      }
      if (v < mn - tol || v > mx + tol) inside = false;
    }
    if (inside) return { kind: "nurbs", curve: spline.transform(affine(T)) };
  }
  for (const [r0, r1] of ranges) {
    if (!(r0 >= lo - 1e-9 * span && r1 <= hi + 1e-9 * span && r1 - r0 > 1e-12 * span)) continue;
    const u0 = Math.max(r0, lo);
    const u1 = Math.min(r1, hi);
    const q0 = at(u0);
    const q1 = at(u1);
    const fits = (dist(q0, a) <= tol && dist(q1, b) <= tol) || (dist(q0, b) <= tol && dist(q1, a) <= tol);
    if (!fits) continue;
    const sub = u0 === lo && u1 === hi ? spline : trim(spline, u0, u1);
    return sub ? { kind: "nurbs", curve: sub.transform(affine(T)) } : undefined;
  }
  return undefined;
}

function parseBs(g: readonly string[], i: number, rational: boolean): NurbsCurve | undefined {
  const degree = Number(g[i]);
  if (!(degree >= 1 && degree <= 25 && Number.isInteger(degree))) return undefined;
  // the closure ("open" / "closed" / "periodic", an enum in SAB) is missing in old SAT
  for (const skip of [1, 0]) {
    let k = i + 1 + skip;
    const nk = Number(g[k++]);
    if (!(nk >= 2 && Number.isInteger(nk)) || k + 2 * nk > g.length) continue;
    const knots: number[] = [];
    let ok = true;
    for (let j = 0; j < nk && ok; j++) {
      const v = Number(g[k++]);
      const m = Number(g[k++]);
      if (!Number.isFinite(v) || !(m >= 1 && Number.isInteger(m)) || (knots.length > 0 && v < knots.at(-1)!))
        ok = false;
      else for (let q = 0; q < m; q++) knots.push(v);
    }
    if (!ok) continue;
    const count = knots.length - degree + 1;
    const stride = rational ? 4 : 3;
    if (count < degree + 1 || k + count * stride > g.length) continue;
    const pts = new Float64Array(count * 3);
    const wts = rational ? new Float64Array(count) : undefined;
    for (let j = 0; j < count; j++) {
      for (let c = 0; c < 3; c++) pts[j * 3 + c] = Number(g[k++]);
      if (wts) wts[j] = Number(g[k++]);
    }
    if (!pts.every(Number.isFinite) || (wts && !wts.every((w) => w > 0))) continue;
    try {
      return new NurbsCurve(degree, 3, pts, Float64Array.from([knots[0]!, ...knots, knots.at(-1)!]), wts);
    } catch {
      // inconsistent counts: try the other layout
    }
  }
  return undefined;
}

/** The part of `c` over [u0, u1]: knot insertion up to multiplicity p at both ends. */
function trim(c: NurbsCurve, u0: number, u1: number): NurbsCurve | undefined {
  const p = c.degree;
  const mult = (k: Float64Array, u: number) => k.reduce((n, v) => n + (v === u ? 1 : 0), 0);
  let s = c;
  s = s.insertKnot(u0, Math.max(0, p - mult(s.knots, u0)));
  s = s.insertKnot(u1, Math.max(0, p - mult(s.knots, u1)));
  const K = s.knots;
  // a knot of multiplicity p at indices r … r+p−1 makes the curve pass through point r − 1
  const first = K.lastIndexOf(u0) - p;
  const last = K.indexOf(u1) - 1;
  if (first < 0 || last < first + 1 || last >= s.count) return undefined;
  const knots = K.slice(first, last + p + 2);
  knots[0] = u0;
  knots[knots.length - 1] = u1;
  try {
    return new NurbsCurve(
      p,
      3,
      s.points.slice(first * 3, (last + 1) * 3),
      knots,
      s.weights?.slice(first, last + 1),
    );
  } catch {
    return undefined;
  }
}

/** The affine map `T` as a matrix. */
function affine(T: Xf): Matrix44 {
  const o = T({ x: 0, y: 0, z: 0 });
  const d = (p: Vec3) => {
    const q = T(p);
    return { x: q.x - o.x, y: q.y - o.y, z: q.z - o.z };
  };
  return Matrix44.fromBasis(d({ x: 1, y: 0, z: 0 }), d({ x: 0, y: 1, z: 0 }), d({ x: 0, y: 0, z: 1 }), o);
}

registerDrawer(
  [
    "REGION",
    "3DSOLID",
    "BODY",
    "SURFACE",
    "EXTRUDEDSURFACE",
    "LOFTEDSURFACE",
    "REVOLVEDSURFACE",
    "SWEPTSURFACE",
    "PLANESURFACE",
    "NURBSURFACE",
  ],
  (fe, ent, st) => {
    const e = ent as AcisEntity;
    let source: readonly string[] | SatRecord[] = e.satLines;
    if (e.satLines.length === 0) {
      let sab = SAB_CACHE.get(fe.doc);
      if (!sab) SAB_CACHE.set(fe.doc, (sab = sabByHandle(fe.doc)));
      const blob = sab.get(e.handle.toUpperCase());
      const recs = blob ? parseSab(blob) : undefined;
      if (!recs) {
        fe.note(e.acisInAcdsData ? "acis-sab-missing" : "acis-empty");
        return;
      }
      source = recs;
    }
    const { curves, unsupported } = satWireframe(source);
    if (unsupported) fe.note("acis-curve");
    const r = fe.resolve(e, st);
    for (const c of curves) fe.strokePath({ subpaths: [projectCurve3(c, st.m)] }, r, e, st);
  },
);
