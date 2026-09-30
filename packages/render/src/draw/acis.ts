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
import { type Curve3, ellipticArcCurve3, line3, projectCurve3, type Vec3 } from "@truedxf/geometry";
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
function sabByHandle(doc: DxfDocument): Map<string, Uint8Array> {
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
    if (v?.type !== "vertex") return undefined;
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
    if (r.type !== "edge") continue;
    const refs = r.tokens.map(ref).filter((i) => !Number.isNaN(i) && i >= 0);
    const vs = refs.filter((i) => at(i)?.type === "vertex");
    const ci = refs.find((i) => /-curve$|^intcurve/.test(at(i)?.type ?? ""));
    if (vs.length < 1) continue;
    const a = point(vs[0]!);
    const b = point(vs[1] ?? vs[0]!);
    if (!a || !b) continue;
    const curve = ci !== undefined ? at(ci)! : undefined;
    const reversed = r.tokens.includes("reversed");
    if (curve?.type === "ellipse-curve") {
      const n = nums(curve);
      if (n.length >= 10) {
        const c = T({ x: n[0]!, y: n[1]!, z: n[2]! });
        const nrm = Tdir({ x: n[3]!, y: n[4]!, z: n[5]! });
        const u = Tdir({ x: n[6]!, y: n[7]!, z: n[8]! });
        const ratio = n[9]!;
        const ul = Math.hypot(u.x, u.y, u.z);
        const nl = Math.hypot(nrm.x, nrm.y, nrm.z) || 1;
        const w = {
          x: ((nrm.y * u.z - nrm.z * u.y) / nl) * ratio,
          y: ((nrm.z * u.x - nrm.x * u.z) / nl) * ratio,
          z: ((nrm.x * u.y - nrm.y * u.x) / nl) * ratio,
        };
        const ang = (p: Vec3) => {
          const d = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
          const cu = (d.x * u.x + d.y * u.y + d.z * u.z) / (ul * ul);
          const wl2 = w.x * w.x + w.y * w.y + w.z * w.z || 1;
          const cw = (d.x * w.x + d.y * w.y + d.z * w.z) / wl2;
          return Math.atan2(cw, cu);
        };
        const pa = T(a);
        const pb = T(b);
        let t0 = ang(pa);
        let t1 = ang(pb);
        if (reversed) [t0, t1] = [t1, t0];
        let sweep = t1 - t0;
        while (sweep <= 1e-12) sweep += 2 * Math.PI;
        curves.push(ellipticArcCurve3({ center: c, u, v: w, start: t0, sweep }));
        continue;
      }
    }
    if (curve && curve.type !== "straight-curve") unsupported++;
    curves.push(line3(T(a), T(b)));
  }
  return { curves, unsupported };
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
