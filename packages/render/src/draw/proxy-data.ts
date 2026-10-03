/**
 * Proxy graphics (note 07 §15): ACAD_PROXY_ENTITY and entities of unknown classes that carry a
 * proxy graphics chunk (92/160 + 310 in AcDbEntity). The binary is a little-endian command
 * stream: RL total size, RL command count, then commands `RL size (incl. header), RL opcode,
 * payload` (sizes padded to 4 bytes).
 *
 * Corpus plots verify top-level coordinates, closed flag 512 and initial owner colour (note 07
 * §15.3–15.5). Block coordinates, nested PUSH_MODELXFORM composition and other initial traits
 * remain assumptions. Layer indices follow table storage order; the general linetype-index
 * rule remains unverified. TEXT primitives retain their embedded font fields independently of drawing STYLE entries.
 */
import { getDecoder } from "@truedxf/core";
import {
  arbitraryAxis,
  type Curve3,
  ellipticArcCurve3,
  line3,
  Matrix44,
  type PolylineVertex,
  polyline3,
  type Vec3,
} from "@truedxf/geometry";
import type { TextInput, TextStyleSpec } from "@truedxf/text";
import { DwgBits } from "./dwgbits.ts";

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
export interface Traits {
  color: number;
  trueColor: number | undefined;
  layer: string;
  linetype: string;
  lineweight: number;
  linetypeScale: number;
  fill: boolean;
}

export type ProxyPrimitive =
  | { kind: "text"; text: ProxyText; transform: Matrix44 | undefined; traits: Traits }
  | { kind: "curve"; curve: Curve3; traits: Traits }
  | { kind: "fill"; rings: Vec3[][]; traits: Traits }
  | { kind: "point"; p: Vec3; traits: Traits }
  | {
      kind: "lwpolyline";
      vertices: PolylineVertex[];
      closed: boolean;
      constantWidth: number;
      elevation: number;
      thickness: number;
      normal: Vec3;
      plinegen: boolean;
      transform: Matrix44 | undefined;
      traits: Traits;
    };

export interface DecodeContext {
  layers: readonly string[];
  linetypes: readonly string[];
  dxfversion?: string;
  encoding?: string;
  textOnly?: boolean;
}

export interface ProxyText {
  input: TextInput;
  style: TextStyleSpec | undefined;
  raw: boolean;
  tracking: number;
  underline: boolean;
  overline: boolean;
  charset: number;
  pitch: number;
}

/** The DWG body stores OCS points, not WCS triples (note 07 §15.2). */
function lwpolyline(bytes: Uint8Array, r: Reader, version: string) {
  const size = r.u32();
  r.need(size);
  const bits = new DwgBits(bytes.subarray(r.pos, r.pos + size));
  const flags = bits.bs();
  const constantWidth = flags & 4 ? bits.bd() : 0;
  const elevation = flags & 8 ? bits.bd() : 0;
  const thickness = flags & 2 ? bits.bd() : 0;
  const [x, y, z] = flags & 1 ? bits.threeBD() : [0, 0, 1];
  const count = bits.bl();
  const bulges = flags & 16 ? bits.bl() : 0;
  const ids = version >= "AC1024" && flags & 1024 ? bits.bl() : 0;
  const widths = flags & 32 ? bits.bl() : 0;
  // Each following coordinate consumes at least a DD tag. Bound all loops by the payload,
  // including sparse arrays, before allocating (note 07 §15.3 robustness).
  if (
    count < 0 ||
    bulges < 0 ||
    ids < 0 ||
    widths < 0 ||
    bulges > count ||
    ids > count ||
    widths > count ||
    (count > 0 ? 128 + (count - 1) * 4 : 0) + bulges * 2 + ids * 2 + widths * 4 > bits.remaining
  )
    throw new Error("proxy: bad LWPOLYLINE count");
  const vertices: PolylineVertex[] = [];
  if (count > 0) {
    let [px, py] = bits.twoRD();
    vertices.push({ x: px, y: py });
    for (let i = 1; i < count; i++) {
      px = bits.dd(px);
      py = bits.dd(py);
      vertices.push({ x: px, y: py });
    }
  }
  for (let i = 0; i < bulges; i++) vertices[i] = { ...vertices[i]!, bulge: bits.bd() };
  for (let i = 0; i < ids; i++) bits.bl(); // Selection ids do not affect drawing.
  for (let i = 0; i < widths; i++) {
    vertices[i] = { ...vertices[i]!, startWidth: Math.max(0, bits.bd()), endWidth: Math.max(0, bits.bd()) };
  }
  return {
    vertices,
    closed: (flags & 512) !== 0,
    plinegen: (flags & 256) !== 0,
    constantWidth: Math.max(0, constantWidth),
    elevation,
    thickness,
    normal: { x: x!, y: y!, z: z! },
  };
}

class Reader {
  readonly bytes: Uint8Array;
  readonly start: number;
  readonly dv: DataView;
  pos: number;
  readonly end: number;
  constructor(bytes: Uint8Array, pos: number, end: number) {
    this.bytes = bytes;
    this.start = pos;
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
  str(encoding = "windows-1252", unicode = false): string {
    let k = this.pos;
    const step = unicode ? 2 : 1;
    while (true) {
      this.need(k - this.pos + step);
      if ((unicode ? this.dv.getUint16(k, true) : this.dv.getUint8(k)) === 0) break;
      k += step;
    }
    const s = getDecoder(unicode ? "utf-16le" : encoding).decode(this.bytes.subarray(this.pos, k));
    // Padding is relative to this command's payload. DWG-body commands can leave the next
    // command unaligned in the blob (gh109 stair opcode 33; note 07 §15.6).
    const next = this.start + Math.ceil((k + step - this.start) / 4) * 4;
    this.need(next - this.pos);
    this.pos = next;
    return s;
  }
}

/** Proxy text supplies a baseline origin/direction in WCS, not TEXT alignment points (07 §15.2). */
function readText(r: Reader, op: number, ctx: DecodeContext): ProxyText {
  const unicode = op === OP.UNICODE_TEXT || op === OP.UNICODE_TEXT2;
  const extended = op === OP.TEXT2 || op === OP.UNICODE_TEXT2;
  const encoding = ctx.encoding ?? "windows-1252";
  const pos = r.v3();
  const normal = r.v3();
  const direction = r.v3();
  let text = extended ? r.str(encoding, unicode) : "";
  let raw = false;
  if (extended) {
    const length = r.i32();
    // Length is a UTF-16 code-unit / byte count; -1 means use the terminated string.
    if (length >= 0) text = text.slice(0, length);
    raw = r.u32() === 0;
  }
  const height = r.f64();
  const widthFactor = r.f64();
  const oblique = (r.f64() * 180) / Math.PI;
  if (!extended) text = r.str(encoding, unicode);
  const tracking = extended ? r.f64() : 1;
  let generationFlags = 0;
  let vertical = false;
  let underline = false;
  let overline = false;
  let charset = 0;
  let pitch = 0;
  let style: TextStyleSpec | undefined;
  if (extended) {
    if (r.u32()) generationFlags |= 2;
    if (r.u32()) generationFlags |= 4;
    vertical = r.u32() !== 0;
    underline = r.u32() !== 0;
    overline = r.u32() !== 0;
    let family = "";
    let flags = 0;
    if (unicode) {
      if (r.u32()) flags |= 1 << 25;
      if (r.u32()) flags |= 1 << 24;
      charset = r.u32();
      pitch = r.u32();
      // Match STYLE's LOGFONT packing so font resolution receives every proxy field (04 §4.1).
      flags |= ((charset & 0xff) << 8) | (pitch & 0xff);
      family = r.str(encoding, true);
    }
    const font = r.str(encoding, unicode);
    const bigFont = r.str(encoding, unicode);
    // Private styles keep proxy font fields independent of identically named drawing styles.
    const name = `*PROXY:${JSON.stringify([font, bigFont, family, flags, vertical])}`;
    style = {
      name,
      font,
      bigFont,
      ttfFamily: family || undefined,
      ttfFlags: flags,
      widthFactor: 1,
      oblique: 0,
      generationFlags: 0,
      fixedHeight: 0,
      vertical,
    };
  }
  const ax = arbitraryAxis(normal);
  const insert = { x: dot(pos, ax.ax), y: dot(pos, ax.ay), z: dot(pos, ax.az) };
  return {
    input: {
      text,
      insert,
      alignPoint: undefined,
      height,
      widthFactor,
      oblique,
      rotation: (Math.atan2(dot(direction, ax.ay), dot(direction, ax.ax)) * 180) / Math.PI,
      style: style?.name ?? "Standard",
      generationFlags,
      halign: 0,
      valign: 0,
      extrusion: normal,
    },
    style,
    raw,
    tracking,
    underline,
    overline,
    charset,
    pitch,
  };
}

/** Font preparation only needs text commands; do not tessellate/decode unrelated proxy geometry. */
export function proxyTexts(bytes: Uint8Array, encoding: string): ProxyText[] {
  const initial: Traits = {
    color: 256,
    trueColor: undefined,
    layer: "0",
    linetype: "BYLAYER",
    lineweight: -1,
    linetypeScale: 1,
    fill: false,
  };
  return decodeProxyGraphics(bytes, initial, {
    layers: [],
    linetypes: [],
    encoding,
    textOnly: true,
  }).primitives.flatMap((p) => (p.kind === "text" ? [p.text] : []));
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
    if (ctx.textOnly && ![OP.TEXT, OP.TEXT2, OP.UNICODE_TEXT, OP.UNICODE_TEXT2].some((v) => v === op))
      continue;
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
            primitives.push({
              kind: "fill",
              rings: [xf ? pts.map((p) => xf!.transformPoint(p)) : pts],
              traits,
            });
          else emitPoints(pts, true);
          break;
        }
        case OP.SHELL: {
          const pts = r.points(r.i32());
          const size = r.i32();
          if (size < 0 || size > (r.end - r.pos) / 4) throw new Error("proxy: bad face-list size");
          let k = 0;
          let faceRings: Vec3[][] | undefined;
          while (k < size) {
            const cnt = r.i32();
            k++;
            const m = Math.abs(cnt);
            if (m > size - k) throw new Error("proxy: bad face count");
            const face: Vec3[] = [];
            for (let j = 0; j < m && k < size; j++, k++) {
              const p = pts[r.i32()];
              if (!p) throw new Error("proxy: bad face index");
              face.push(p);
            }
            if (traits.fill) {
              if (cnt > 0) {
                faceRings = [xf ? face.map((p) => xf!.transformPoint(p)) : face];
                primitives.push({ kind: "fill", rings: faceRings, traits });
              } else {
                if (!faceRings) throw new Error("proxy: hole without face");
                faceRings.push(xf ? face.map((p) => xf!.transformPoint(p)) : face);
              }
            } else emitPoints(face, true);
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
          // The corpus uses 32767/32766 for ByLayer/ByBlock (note 07 §15.5).
          const name =
            i === 0xffffffff || i === 32767
              ? "BYLAYER"
              : i === 0xfffffffe || i === 32766
                ? "BYBLOCK"
                : ctx.linetypes[i];
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
          primitives.push({ kind: "text", text: readText(r, op, ctx), transform: xf, traits });
          break;
        case OP.LWPOLYLINE:
          primitives.push({
            kind: "lwpolyline",
            ...lwpolyline(bytes, r, ctx.dxfversion ?? "AC1032"),
            transform: xf,
            traits,
          });
          break;
        case OP.XLINE:
        case OP.RAY:
          unsupported.push("proxy-xline");
          break;
        default:
          break;
      }
      // A POLYLINE leaves FILLON enabled for a following POLYGON (note 07 §15.7).
      // Consumption by the other primitive types still needs an isolated AutoCAD probe.
      if ([2, 3, 4, 5, 7, 8, 9, 10, 11, 33, 36, 38, 44].includes(op) && traits.fill)
        traits = { ...traits, fill: false };
    } catch {
      unsupported.push("proxy-corrupt");
      break;
    }
  }
  return { primitives, unsupported };
}
