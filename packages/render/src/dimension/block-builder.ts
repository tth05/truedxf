/**
 * Builds the entities of a regenerated dimension / leader block the way AutoCAD writes them into
 * `*D` blocks (note 05 §5): plain LINE / ARC / SOLID / INSERT / MTEXT / LWPOLYLINE records in the
 * dimension's OCS, on the dimension's layer, with BYBLOCK defaults. The records are serialized as
 * DXF tags and parsed by the regular entity parsers, so they render exactly like stored blocks.
 */
import { type DxfDocument, type Entity, loadDxf } from "@truedxf/model";

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** Properties AutoCAD writes on `*D` block entities (VERIFIED-BY-ACAD dimensions/colors-nb …). */
export interface PartProps {
  /** ACI; 0 = BYBLOCK (DIMCLRx default). */
  readonly color: number;
  /** Lineweight; -2 = BYBLOCK (DIMLWx default). */
  readonly lineweight?: number;
  /** Linetype name; undefined = not written (DIMLTYPE ByBlock default). */
  readonly linetype?: string | undefined;
}

export const BYBLOCK: PartProps = { color: 0, lineweight: -2 };

const enc = new TextEncoder();

function num(v: number): string {
  if (!Number.isFinite(v)) return "0";
  // shortest round-trip representation keeps the geometry exact
  return String(Object.is(v, -0) ? 0 : v);
}

export class BlockBuilder {
  private readonly out: string[] = [];
  readonly layer: string;
  readonly z: number;
  /** Entity linetype scale of the owner, copied to every part (dimensions/dimltype-*-nb). */
  readonly ltscale: number;

  /** Placement of subsequent geometry (uniform scale, rotation, translation), see place(). */
  private tf: { x: number; y: number; s: number; rot: number } | undefined;

  constructor(layer: string, z = 0, ltscale = 1) {
    this.layer = layer;
    this.z = z;
    this.ltscale = ltscale;
  }

  /**
   * Writes the geometry emitted by `fn` placed like an INSERT (at, uniform scale, rotation in
   * degrees) — used for arrow blocks the file does not define.
   */
  place(at: Pt, scale: number, rotationDeg: number, fn: () => void): void {
    const prev = this.tf;
    this.tf = { x: at.x, y: at.y, s: scale, rot: (rotationDeg * Math.PI) / 180 };
    try {
      fn();
    } finally {
      this.tf = prev;
    }
  }

  private map(p: Pt): Pt {
    const t = this.tf;
    if (!t) return p;
    const c = Math.cos(t.rot);
    const sn = Math.sin(t.rot);
    return { x: t.x + t.s * (c * p.x - sn * p.y), y: t.y + t.s * (sn * p.x + c * p.y) };
  }

  private get k(): number {
    return this.tf?.s ?? 1;
  }

  private get rotDeg(): number {
    return this.tf ? (this.tf.rot * 180) / Math.PI : 0;
  }

  get empty(): boolean {
    return this.out.length === 0;
  }

  private tag(code: number, value: string | number): void {
    this.out.push(String(code), typeof value === "number" ? num(value) : value);
  }

  private head(type: string, p: PartProps, subclass: string, withLineweight = true): void {
    this.tag(0, type);
    this.tag(100, "AcDbEntity");
    this.tag(8, this.layer);
    if (p.linetype) this.tag(6, p.linetype);
    this.tag(62, p.color);
    if (withLineweight) this.tag(370, p.lineweight ?? -2);
    else if (p.lineweight !== undefined && p.lineweight !== -1) this.tag(370, p.lineweight);
    if (this.ltscale !== 1) this.tag(48, this.ltscale);
    this.tag(100, subclass);
  }

  private pt(code: number, p0: Pt): void {
    const p = this.map(p0);
    this.tag(code, p.x);
    this.tag(code + 10, p.y);
    this.tag(code + 20, this.z);
  }

  line(a: Pt, b: Pt, p: PartProps): void {
    this.head("LINE", p, "AcDbLine");
    this.pt(10, a);
    this.pt(11, b);
  }

  /** ARC; angles in degrees, counter-clockwise from `start` to `end`. */
  arc(c: Pt, r: number, start: number, end: number, p: PartProps): void {
    this.head("ARC", p, "AcDbCircle");
    this.pt(10, c);
    this.tag(40, r * this.k);
    this.tag(100, "AcDbArc");
    this.tag(50, start + this.rotDeg);
    this.tag(51, end + this.rotDeg);
  }

  circle(c: Pt, r: number, p: PartProps): void {
    this.head("CIRCLE", p, "AcDbCircle");
    this.pt(10, c);
    this.tag(40, r * this.k);
  }

  /** SOLID with the DXF corner order (triangle: v2 = v3). */
  solid(v0: Pt, v1: Pt, v2: Pt, v3: Pt, p: PartProps): void {
    this.head("SOLID", p, "AcDbTrace");
    this.pt(10, v0);
    this.pt(11, v1);
    this.pt(12, v2);
    this.pt(13, v3);
  }

  insert(block: string, at: Pt, scale: number, rotationDeg: number, p: PartProps): void {
    this.head("INSERT", p, "AcDbBlockReference");
    this.tag(2, block);
    this.pt(10, at);
    this.tag(41, scale);
    this.tag(42, scale);
    this.tag(43, scale);
    const r = (((rotationDeg + this.rotDeg) % 360) + 360) % 360;
    if (Math.abs(r) > 1e-9 && Math.abs(r - 360) > 1e-9) this.tag(50, r);
  }

  /** Fit-point SPLINE (degree 3) with optional end tangents. */
  splineFit(fit: readonly Pt[], startTan: Pt | undefined, endTan: Pt | undefined, p: PartProps): void {
    this.head("SPLINE", p, "AcDbSpline");
    this.tag(70, 8);
    this.tag(71, 3);
    this.tag(72, 0);
    this.tag(73, 0);
    this.tag(74, fit.length);
    this.tag(44, 1e-10);
    if (startTan) this.pt(12, startTan);
    if (endTan) this.pt(13, endTan);
    for (const f of fit) this.pt(11, f);
  }

  lwpolyline(
    verts: readonly { x: number; y: number; bulge?: number }[],
    closed: boolean,
    width: number,
    p: PartProps,
  ): void {
    this.head("LWPOLYLINE", p, "AcDbPolyline");
    this.tag(90, verts.length);
    this.tag(70, closed ? 1 : 0);
    if (width !== 0) this.tag(43, width * this.k);
    if (this.z !== 0) this.tag(38, this.z);
    for (const v0 of verts) {
      const v = { ...v0, ...this.map(v0) };
      this.tag(10, v.x);
      this.tag(20, v.y);
      if (v.bulge) this.tag(42, v.bulge);
    }
  }

  /**
   * Dimension text: MTEXT attachment 5 (middle centre) at the text midpoint, direction vector
   * only when not horizontal (note 05 §5.3).
   */
  mtext(
    at: Pt,
    height: number,
    content: string,
    style: string,
    angleRad: number,
    p: PartProps,
    extra: {
      attachment?: number;
      width?: number;
      bgFill?: { flags: number; color: number; scale: number };
    } = {},
  ): void {
    this.head("MTEXT", p, "AcDbMText", false);
    this.pt(10, at);
    this.tag(40, height);
    this.tag(41, extra.width ?? 0);
    this.tag(71, extra.attachment ?? 5);
    this.tag(72, 1);
    // group 1 holds at most 250 chars; longer content continues in 3 chunks
    let s = content;
    while (s.length > 250) {
      this.tag(3, s.slice(0, 250));
      s = s.slice(250);
    }
    this.tag(1, s);
    this.tag(7, style);
    if (Math.abs(angleRad) > 1e-12) {
      this.tag(11, Math.cos(angleRad));
      this.tag(21, Math.sin(angleRad));
      this.tag(31, 0);
    }
    this.tag(73, 1);
    this.tag(44, 1);
    if (extra.bgFill) {
      this.tag(90, extra.bgFill.flags);
      this.tag(63, extra.bgFill.color);
      this.tag(45, extra.bgFill.scale);
      this.tag(441, 0);
    }
  }

  /** Parses the collected records into entities. */
  build(): Entity[] {
    if (this.out.length === 0) return [];
    const body = this.out.join("\n");
    const text = `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n9\n$DWGCODEPAGE\n3\nANSI_1252\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${body}\n0\nENDSEC\n0\nEOF\n`;
    const doc: DxfDocument = loadDxf(enc.encode(text));
    return doc.modelSpace.entities;
  }
}
