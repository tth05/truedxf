/**
 * Shared state and helpers of the dimension block generator: effective sizes, part properties
 * (colours / lineweights / linetypes per DIMCLRx / DIMLWx / DIMLTxx, note 05 §8) and text
 * emission (MTEXT, DIMGAP < 0 frame, DIMTFILL background).
 */
import type { DxfDocument } from "@truedxf/model";
import type { TextFontSource } from "@truedxf/text";
import { arrowBlockEntities, arrowKey, arrowLength, writeArrow } from "./arrows.ts";
import { measureText, type TextBox } from "./measure.ts";
import type { DimStyleVars } from "./vars.ts";
import type { EntityWriter, PartProps, Pt } from "./writer.ts";

export interface Vec {
  x: number;
  y: number;
}

export const add = (a: Pt, b: Pt, k = 1): Vec => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const sub = (a: Pt, b: Pt): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
export const len = (a: Pt): number => Math.hypot(a.x, a.y);
export const neg = (a: Pt): Vec => ({ x: -a.x, y: -a.y });
/** Left normal (rotated +90°). */
export const left = (a: Pt): Vec => ({ x: -a.y, y: a.x });
export const unit = (a: Pt, fallback: Pt = { x: 1, y: 0 }): Vec => {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: fallback.x, y: fallback.y };
};
export const dirOf = (rad: number): Vec => ({ x: Math.cos(rad), y: Math.sin(rad) });
export const angleOf = (a: Pt): number => Math.atan2(a.y, a.x);

const TAU = Math.PI * 2;

/** Normalizes to [0, 2π). */
export function norm2pi(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/**
 * Readable text angle: directions in (90°, 270°] are turned by 180°, so vertical dimensions read
 * bottom→top. VERIFIED-BY-ACAD dimensions/flip-angle-* (90° kept, 91° and 270° flipped; Q-0535).
 */
export function readable(a: number): number {
  const n = norm2pi(a);
  const eps = 1e-9;
  return n > Math.PI / 2 + eps && n <= (3 * Math.PI) / 2 + eps
    ? n - Math.PI
    : n > (3 * Math.PI) / 2
      ? n - TAU
      : n;
}

export interface GenInput {
  readonly doc: DxfDocument;
  readonly fonts: TextFontSource | undefined;
  /** Lineweight of the dimension entity (copied to the text). */
  readonly lineweight?: number;
}

export class DimCtx {
  readonly v: DimStyleVars;
  readonly w: EntityWriter;
  readonly fonts: TextFontSource | undefined;
  readonly doc: DxfDocument;
  readonly style: string;
  /** Text height (fixed style height, else DIMTXT·DIMSCALE). */
  readonly txt: number;
  /** Text is omitted (no DIMTXSTY in an R2000+ record, VERIFIED-BY-ACAD dimtxsty-absent-nb). */
  readonly noText: boolean;
  readonly asz: number;
  readonly exo: number;
  readonly exe: number;
  /** |DIMGAP|·DIMSCALE. */
  readonly gap: number;
  /** DIMGAP < 0: frame around the text. */
  readonly box: boolean;
  readonly dle: number;
  readonly tsz: number;
  readonly dim: PartProps;
  readonly ext1: PartProps;
  readonly ext2: PartProps;
  readonly text: PartProps;
  readonly arrowNames: [string, string];

  constructor(input: GenInput, v: DimStyleVars, w: EntityWriter) {
    this.v = v;
    this.w = w;
    this.doc = input.doc;
    this.fonts = input.fonts;
    this.style = v.textStyle();
    const entry = this.doc.tables.styles.get(this.style);
    const fixed = entry?.fixedHeight ?? 0;
    // a fixed style height is used as is, not × DIMSCALE (VERIFIED-BY-ACAD text-fixed-height-style-nb, Q-0563)
    this.txt = fixed > 0 ? fixed : v.scaled("DIMTXT");
    this.noText = v.str("DIMTXSTY") === "" && this.doc.header.str("$ACADVER", "AC1009") >= "AC1015";
    this.asz = v.scaled("DIMASZ");
    this.exo = v.scaled("DIMEXO");
    this.exe = v.scaled("DIMEXE");
    const g = v.scaled("DIMGAP");
    this.gap = Math.abs(g);
    this.box = g < 0;
    this.dle = v.scaled("DIMDLE");
    this.tsz = v.scaled("DIMTSZ");
    const lwd = v.num("DIMLWD");
    const lwe = v.num("DIMLWE");
    this.dim = { color: v.num("DIMCLRD"), lineweight: lwd, linetype: v.linetype("DIMLTYPE") };
    this.ext1 = { color: v.num("DIMCLRE"), lineweight: lwe, linetype: v.linetype("DIMLTEX1") };
    this.ext2 = { color: v.num("DIMCLRE"), lineweight: lwe, linetype: v.linetype("DIMLTEX2") };
    // text has no DIMLWx: AutoCAD copies the entity's own lineweight (entity-color-byblock-nb)
    this.text = { color: v.num("DIMCLRT"), lineweight: input.lineweight };
    this.arrowNames = v.arrows();
  }

  /** Arrow part props: DIMCLRD and DIMLWD, never a linetype (note 05 §8, S1 *D22). */
  get arrowProps(): PartProps {
    return { color: this.dim.color, lineweight: this.dim.lineweight };
  }

  measure(content: string): TextBox {
    return measureText(this.fonts, content, this.txt, this.style);
  }

  /** Arrow length for dim-line shortening (0 for ticks). */
  arrowLen(i: 0 | 1): number {
    if (this.tsz > 0) return 0;
    return arrowLength(this.arrowNames[i]) * this.asz;
  }

  /** Name of the block to insert for an arrow: the document's block name if it exists. */
  arrowBlock(name: string): string {
    const b = this.doc.getBlock(name) ?? this.doc.getBlock(`_${arrowKey(name)}`);
    return b ? b.name : name.startsWith("_") ? name : `_${name}`;
  }

  /** Arrow at a dimension-line end: tip `tip`, pointing along `dir` (or a DIMTSZ tick). */
  arrow(i: 0 | 1, tip: Pt, dir: Pt): void {
    if (this.tsz > 0) {
      // ticks: a LINE ±DIMTSZ along (d + n) in DIMCLRD/DIMLWD (VERIFIED-BY-ACAD dimtsz-2-*-nb)
      const d = i === 0 ? neg(dir) : dir;
      const k = { x: d.x - d.y, y: d.y + d.x };
      this.w.line(add(tip, k, -this.tsz), add(tip, k, this.tsz), this.arrowProps);
      return;
    }
    this.arrowNamed(this.arrowNames[i], tip, dir, this.asz);
  }

  /** Any arrow by name; blocks the file lacks are synthesized in place (note 05 §10.3). */
  arrowNamed(name: string, tip: Pt, dir: Pt, size: number): void {
    const key = arrowKey(name);
    if (key !== "" && key !== "NONE" && !this.doc.getBlock(this.arrowBlock(name))) {
      const deg = (angleOf(dir) * 180) / Math.PI;
      let known = true;
      this.w.place(tip, size, deg, () => {
        known = arrowBlockEntities(name, this.w, this.arrowProps);
      });
      if (known) return;
      name = ""; // unknown and undefined: closed filled (GDAL's fallback)
    }
    writeArrow(this.w, name, this.arrowBlock(name), tip, dir, size, this.arrowProps);
  }

  /**
   * Writes the text MTEXT centred at `at` (angle in radians) plus DIMGAP < 0 frame. Background
   * fill per DIMTFILL (MTEXT 90/63/45 = 1.1, VERIFIED-BY-ACAD dimtfill-1/2-nb).
   */
  writeText(at: Pt, angle: number, content: string, tb: TextBox): void {
    if (content === "" || this.noText) return;
    const tfill = this.v.num("DIMTFILL");
    const bg =
      tfill === 1
        ? { flags: 3, color: 256, scale: 1.1 }
        : tfill === 2
          ? { flags: 1, color: this.v.num("DIMTFILLCLR"), scale: 1.1 }
          : undefined;
    this.w.mtext(at, this.txt, content, this.style, angle, this.text, bg ? { bgFill: bg } : {});
    if (this.box) {
      // frame |DIMGAP| around the text box in DIMCLRD / DIMLWD (VERIFIED-BY-ACAD dimgap-m1-nb,
      // dimgap-box-colors-nb; Q-0562)
      const u = dirOf(angle);
      const n = left(u);
      const hw = tb.width / 2 + this.gap;
      const hh = tb.height / 2 + this.gap;
      const c = (sx: number, sy: number) => add(add(at, u, sx * hw), n, sy * hh);
      const q = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
      const p = { color: this.dim.color, lineweight: this.dim.lineweight };
      for (let k = 0; k < 4; k++) this.w.line(q[k]!, q[(k + 1) % 4]!, p);
    }
  }

  /** Distance from the text centre to the edge of its (gap-enlarged) box along direction `d`. */
  textHalfExtent(tb: TextBox, textAngle: number, d: Pt): number {
    const u = dirOf(textAngle);
    const n = left(u);
    const hw = tb.width / 2 + this.gap;
    const hh = tb.height / 2 + this.gap;
    const a = Math.abs(dot(d, u));
    const b = Math.abs(dot(d, n));
    const tw = a > 1e-12 ? hw / a : Number.POSITIVE_INFINITY;
    const th = b > 1e-12 ? hh / b : Number.POSITIVE_INFINITY;
    return Math.min(tw, th);
  }
}
