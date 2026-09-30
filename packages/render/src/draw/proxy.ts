/**
 * Proxy graphics (note 07 §15): ACAD_PROXY_ENTITY and entities of unknown classes that carry a
 * proxy graphics chunk (92/160 + 310 in AcDbEntity). The binary is a little-endian command
 * stream: RL total size, RL command count, then commands `RL size (incl. header), RL opcode,
 * payload` (sizes padded to 4 bytes).
 *
 * UNVERIFIED against AutoCAD: every misc/proxy-* fixture is rejected by AutoCAD on load
 * (invalid-fixture), so the rules follow ODA / ezdxf proxygraphic.py (MIT): coordinates are in
 * the owner's (block) coordinates; sub-entity traits start as the entity's own properties
 * (ASSUMPTION, note 07 §15.3); PUSH_MODELXFORM matrices compose; layer / linetype indices count
 * table records in file order; text primitives are not drawn yet (noted as "proxy-text").
 */
import {
  arbitraryAxis,
  type Curve3,
  ellipticArcCurve3,
  FillRule,
  line3,
  Matrix44,
  polyline3,
  projectCurve3,
  type Vec3,
} from "@truedxf/geometry";
import type { Entity } from "@truedxf/model";
import { type DrawState, type Frontend, registerDrawer } from "../frontend.ts";

/** Opcodes (ODA, note 07 §15.2). */
const OP = {
  EXTENTS: 1,
  CIRCLE: 2,
  CIRCLE_3P: 3,
  ARC: 4,
  ARC_3P: 5,
  POLYLINE: 6,
  POLYGON: 7,
  MESH: 8,
  SHELL: 9,
  TEXT: 10,
  TEXT2: 11,
  XLINE: 12,
  RAY: 13,
  COLOR: 14,
  LAYER_NAME: 15,
  LAYER: 16,
  LINETYPE_NAME: 17,
  LINETYPE: 18,
  MARKER: 19,
  FILL: 20,
  TRUECOLOR: 22,
  LINEWEIGHT: 23,
  LTSCALE: 24,
  PUSH_XFORM: 29,
  PUSH_XFORM2: 30,
  POP_XFORM: 31,
  POLYLINE_NORMAL: 32,
  LWPOLYLINE: 33,
  UNICODE_TEXT: 36,
  UNICODE_TEXT2: 38,
  ELLIPTIC_ARC: 44,
} as const;

/** Sub-entity traits as entity-property overrides. */
interface Traits {
  color: number;
  trueColor: number | undefined;
  layer: string;
  linetype: string;
  lineweight: number;
  linetypeScale: number;
  fill: boolean;
}

export type ProxyPrimitive =
  | { kind: "curve"; curve: Curve3; traits: Traits }
  | { kind: "fill"; ring: Vec3[]; traits: Traits }
  | { kind: "point"; p: Vec3; traits: Traits };

interface DecodeContext {
  layers: readonly string[];
  linetypes: readonly string[];
}

class Reader {
  readonly dv: DataView;
  pos: number;
  readonly end: number;
  constructor(bytes: Uint8Array, pos: number, end: number) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
    this.end = end;
  }
  need(n: number): void {
    if (this.pos + n > this.end) throw new Error("proxy: truncated");
  }
  u32(): number {
    this.need(4);
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.dv.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    this.need(8);
    const v = this.dv.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  v3(): Vec3 {
    return { x: this.f64(), y: this.f64(), z: this.f64() };
  }
  points(n: number): Vec3[] {
    if (n < 0 || n > (this.end - this.pos) / 24) throw new Error("proxy: bad count");
    const out: Vec3[] = [];
    for (let k = 0; k < n; k++) out.push(this.v3());
    return out;
  }
  /** Zero-terminated 8-bit string padded to 4 bytes. */
  str(): string {
    let s = "";
    let k = this.pos;
    while (k < this.end && this.dv.getUint8(k) !== 0) s += String.fromCharCode(this.dv.getUint8(k++));
    this.pos = Math.min(this.end, (k + 4) & ~3);
    return s;
  }
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.sqrt(dot(a, a));
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const addv = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

function circleCurve(c: Vec3, r: number, normal: Vec3, start = 0, sweep = 2 * Math.PI): Curve3 {
  const ax = arbitraryAxis(normal);
  return ellipticArcCurve3({ center: c, u: scale(ax.ax, r), v: scale(ax.ay, r), start, sweep });
}

/** Circle through three points: centre, radius, unit normal (undefined if collinear). */
function circle3(p1: Vec3, p2: Vec3, p3: Vec3) {
  const a = sub(p2, p1);
  const b = sub(p3, p1);
  const n = cross(a, b);
  const nn = dot(n, n);
  if (nn < 1e-24) return undefined;
  const c = addv(p1, scale(addv(scale(cross(n, a), dot(b, b)), scale(cross(b, n), dot(a, a))), 1 / (2 * nn)));
  return { c, r: len(sub(p1, c)), n: scale(n, 1 / Math.sqrt(nn)) };
}

function arc3(p1: Vec3, p2: Vec3, p3: Vec3): Curve3 {
  const k = circle3(p1, p2, p3);
  if (!k) return line3(p1, p3);
  const u = sub(p1, k.c);
  const v = cross(k.n, u);
  const ang = (p: Vec3) => {
    const d = sub(p, k.c);
    let t = Math.atan2(dot(d, v), dot(d, u));
    if (t < 0) t += 2 * Math.PI;
    return t;
  };
  // p2 lies between p1 and p3 on a CCW sweep about n by construction of n = (p2−p1)×(p3−p1)
  return ellipticArcCurve3({ center: k.c, u, v, start: 0, sweep: ang(p3) || 2 * Math.PI });
}

function transformCurve(c: Curve3, m: Matrix44): Curve3 {
  switch (c.kind) {
    case "line":
      return line3(m.transformPoint(c.p0), m.transformPoint(c.p1));
    case "ellipticArc":
      return {
        ...c,
        center: m.transformPoint(c.center),
        u: m.transformDirection(c.u),
        v: m.transformDirection(c.v),
      };
    case "polyline": {
      const out = new Float64Array(c.points.length);
      for (let k = 0; k + 2 < c.points.length; k += 3) {
        const p = m.transformPoint({ x: c.points[k]!, y: c.points[k + 1]!, z: c.points[k + 2]! });
        out[k] = p.x;
        out[k + 1] = p.y;
        out[k + 2] = p.z;
      }
      return { kind: "polyline", points: out, closed: c.closed };
    }
    default:
      return c;
  }
}

/** Decodes a proxy graphics blob into primitives (robust: stops at the first corrupt command). */
export function decodeProxyGraphics(
  bytes: Uint8Array,
  initial: Traits,
  ctx: DecodeContext,
): {
  primitives: ProxyPrimitive[];
  unsupported: string[];
} {
  const primitives: ProxyPrimitive[] = [];
  const unsupported: string[] = [];
  let traits: Traits = { ...initial };
  const stack: (Matrix44 | undefined)[] = [];
  let xf: Matrix44 | undefined;
  const emitCurve = (c: Curve3) =>
    primitives.push({ kind: "curve", curve: xf ? transformCurve(c, xf) : c, traits });
  const emitPoints = (pts: Vec3[], closed: boolean) => {
    const w = xf ? pts.map((p) => xf!.transformPoint(p)) : pts;
    if (w.length === 1) primitives.push({ kind: "point", p: w[0]!, traits });
    else if (w.length > 1) primitives.push({ kind: "curve", curve: polyline3(w, closed), traits });
  };
  if (bytes.length < 8) return { primitives, unsupported };
  const head = new Reader(bytes, 0, bytes.length);
  head.u32(); // total size
  const count = head.u32();
  let pos = 8;
  for (let n = 0; n < count && pos + 8 <= bytes.length; n++) {
    const hr = new Reader(bytes, pos, bytes.length);
    const size = hr.u32();
    const op = hr.u32();
    if (size < 8 || pos + size > bytes.length) break;
    const r = new Reader(bytes, pos + 8, pos + size);
    pos += size;
    try {
      switch (op) {
        case OP.CIRCLE: {
          const c = r.v3();
          const rad = r.f64();
          emitCurve(circleCurve(c, rad, r.v3()));
          break;
        }
        case OP.CIRCLE_3P: {
          const k = circle3(r.v3(), r.v3(), r.v3());
          if (k) emitCurve(circleCurve(k.c, k.r, k.n));
          break;
        }
        case OP.ARC: {
          const c = r.v3();
          const rad = r.f64();
          const nrm = r.v3();
          const sv = r.v3();
          const sweep = r.f64();
          const l = len(sv) || 1;
          const u = scale(sv, rad / l);
          const nl = len(nrm) || 1;
          const v = scale(cross(scale(nrm, 1 / nl), u), 1);
          emitCurve(ellipticArcCurve3({ center: c, u, v, start: 0, sweep }));
          break;
        }
        case OP.ARC_3P:
          emitCurve(arc3(r.v3(), r.v3(), r.v3()));
          break;
        case OP.POLYLINE:
        case OP.POLYLINE_NORMAL:
          emitPoints(r.points(r.i32()), false);
          break;
        case OP.POLYGON: {
          const pts = r.points(r.i32());
          if (traits.fill)
            primitives.push({ kind: "fill", ring: xf ? pts.map((p) => xf!.transformPoint(p)) : pts, traits });
          else emitPoints(pts, true);
          break;
        }
        case OP.SHELL: {
          const pts = r.points(r.i32());
          const size = r.i32();
          let k = 0;
          while (k < size) {
            const cnt = r.i32();
            k++;
            const m = Math.abs(cnt);
            const face: Vec3[] = [];
            for (let j = 0; j < m && k < size; j++, k++) {
              const p = pts[r.i32()];
              if (p) face.push(p);
            }
            if (cnt > 0)
              emitPoints(face, true); // negative counts are holes; drawn too
            else emitPoints(face, true);
          }
          break;
        }
        case OP.MESH: {
          const rows = r.i32();
          const cols = r.i32();
          const pts = r.points(rows * cols);
          for (let i = 0; i < rows; i++) emitPoints(pts.slice(i * cols, i * cols + cols), false);
          for (let j = 0; j < cols; j++) {
            const col: Vec3[] = [];
            for (let i = 0; i < rows; i++) col.push(pts[i * cols + j]!);
            emitPoints(col, false);
          }
          break;
        }
        case OP.ELLIPTIC_ARC: {
          const c = r.v3();
          const nrm = r.v3();
          const major = r.f64();
          const minor = r.f64();
          const t0 = r.f64();
          const t1 = r.f64();
          const rot = r.f64();
          const ax = arbitraryAxis(nrm);
          const dir = addv(scale(ax.ax, Math.cos(rot)), scale(ax.ay, Math.sin(rot)));
          const perp = cross(ax.az, dir);
          let sweep = t1 - t0;
          if (sweep <= 0) sweep += 2 * Math.PI;
          emitCurve(
            ellipticArcCurve3({ center: c, u: scale(dir, major), v: scale(perp, minor), start: t0, sweep }),
          );
          break;
        }
        case OP.COLOR: {
          const v = r.i32();
          traits = { ...traits, color: v, trueColor: undefined };
          break;
        }
        case OP.TRUECOLOR: {
          const raw = r.u32();
          const method = raw >>> 24;
          if (method === 0xc2) traits = { ...traits, color: 257, trueColor: raw & 0xffffff };
          else if (method === 0xc3) traits = { ...traits, color: raw & 0xff, trueColor: undefined };
          else if (method === 0xc0) traits = { ...traits, color: 256, trueColor: undefined };
          else if (method === 0xc1) traits = { ...traits, color: 0, trueColor: undefined };
          break;
        }
        case OP.LAYER: {
          const name = ctx.layers[r.u32()];
          if (name) traits = { ...traits, layer: name };
          break;
        }
        case OP.LAYER_NAME:
          traits = { ...traits, layer: r.str() || traits.layer };
          break;
        case OP.LINETYPE: {
          const i = r.u32();
          const name =
            i === 0xffffffff ? "BYLAYER" : i === 0xfffffffe || i === 32766 ? "BYBLOCK" : ctx.linetypes[i];
          traits = { ...traits, linetype: name ?? "BYLAYER" };
          break;
        }
        case OP.LINETYPE_NAME:
          traits = { ...traits, linetype: r.str() || "BYLAYER" };
          break;
        case OP.LINEWEIGHT:
          traits = { ...traits, lineweight: r.i32() };
          break;
        case OP.LTSCALE:
          traits = { ...traits, linetypeScale: r.f64() };
          break;
        case OP.FILL:
          traits = { ...traits, fill: r.u32() !== 0 };
          break;
        case OP.PUSH_XFORM:
        case OP.PUSH_XFORM2: {
          const v: number[] = [];
          for (let k = 0; k < 16; k++) v.push(r.f64());
          // row-major, column vectors (translation in the last column)
          const m = Matrix44.fromRows(
            ...(v as [
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
            ]),
          );
          stack.push(xf);
          xf = xf ? xf.multiply(m) : m;
          break;
        }
        case OP.POP_XFORM:
          xf = stack.pop();
          break;
        case OP.EXTENTS:
        case OP.MARKER:
          break;
        case OP.TEXT:
        case OP.TEXT2:
        case OP.UNICODE_TEXT:
        case OP.UNICODE_TEXT2:
          unsupported.push("proxy-text");
          break;
        case OP.LWPOLYLINE:
          unsupported.push("proxy-lwpolyline");
          break;
        case OP.XLINE:
        case OP.RAY:
          unsupported.push("proxy-xline");
          break;
        default:
          break;
      }
    } catch {
      unsupported.push("proxy-corrupt");
      break;
    }
  }
  return { primitives, unsupported };
}

const CTX_CACHE = new WeakMap<object, DecodeContext>();

function context(fe: Frontend): DecodeContext {
  let c = CTX_CACHE.get(fe.doc);
  if (!c) {
    c = {
      layers: fe.doc.tables.layers.entries.map((l) => l.name),
      linetypes: fe.doc.tables.linetypes.entries.map((l) => l.name),
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
    if (p.kind === "curve") fe.strokePath({ subpaths: [projectCurve3(p.curve, st.m)] }, r, sub, st);
    else if (p.kind === "point") {
      const q = st.m.transformPoint(p.p);
      fe.pixel(q.x, q.y, fe.color(r));
    } else {
      const ring = new Float64Array(p.ring.length * 2);
      p.ring.forEach((v, i) => {
        const q = st.m.transformPoint(v);
        ring[i * 2] = q.x;
        ring[i * 2 + 1] = q.y;
      });
      fe.fillRings([ring], fe.color(r), FillRule.EvenOdd);
    }
  }
  return true;
}

registerDrawer(["ACAD_PROXY_ENTITY", "*PROXY-GRAPHICS"], (fe, e, st) => {
  if (!drawProxyGraphics(fe, e, st)) fe.note("proxy-no-graphics");
});
