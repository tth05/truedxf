/**
 * Complex linetype elements (note 06 §2.2–2.3): SHAPE elements from the shape file of the
 * element's STYLE (340, flag 1 — loaded through `RenderEnv.loadFont` and parsed by
 * @truedxf/fonts) and TEXT elements laid out by the text engine. The dash engine
 * (@truedxf/geometry dash.ts) decides where elements go; this module only draws them.
 *
 * Placement (VERIFIED-BY-ACAD `acad-default-fonts/ltype-*`, `linetypes/ctext-*`, note 06 §2.3):
 * the element origin is the end of the element it rides on, moved by X along and Y across the
 * line, rotated with the line (R=), absolutely (A=) or upright (U=); one shape unit = S × the
 * linetype scale. A shape whose file is missing draws nothing (`linetypes/ctext-missing-shx`).
 */
import { flattenStrokes, ShxFont } from "@truedxf/fonts";
import { type ComplexPlacement, ComplexRotation, Matrix44 } from "@truedxf/geometry";
import type { DxfDocument, Entity, LinetypeElement, TextStyleEntry } from "@truedxf/model";
import { layoutText, type TextFonts, type TextLayout } from "@truedxf/text";
import { type DrawState, type Frontend, registerPreparer, setComplexElementDrawer } from "../frontend.ts";
import type { ComplexElementData } from "../linetype.ts";
import type { Resolved } from "../props.ts";
import { drawLayout, prepareTextFonts } from "../text.ts";

interface ComplexResources {
  /** STYLE handle (upper case) → shape font, or null when the file could not be loaded. */
  readonly shapes: Map<string, ShxFont | null>;
  readonly styles: Map<string, TextStyleEntry>;
  readonly textFonts: TextFonts | undefined;
}

const RESOURCES = new WeakMap<DxfDocument, ComplexResources>();
const TRUETYPE = /\.(ttf|ttc|otf)$/i;

function complexElements(doc: DxfDocument): LinetypeElement[] {
  const out: LinetypeElement[] = [];
  for (const lt of doc.tables.linetypes) for (const el of lt.elements) if (el.flags & 6) out.push(el);
  return out;
}

registerPreparer(async (doc, env) => {
  const els = complexElements(doc);
  if (els.length === 0) return;
  const styles = new Map<string, TextStyleEntry>();
  for (const s of doc.tables.styles) styles.set(s.handle.toUpperCase(), s);
  const shapes = new Map<string, ShxFont | null>();
  let needText = false;
  for (const el of els) {
    if (el.flags & 2) {
      needText = true;
      continue;
    }
    const h = (el.styleHandle ?? "").toUpperCase();
    if (shapes.has(h)) continue;
    const style = styles.get(h);
    let font: ShxFont | null = null;
    if (style?.font && env.loadFont) {
      try {
        const bytes = await env.loadFont(style.font.toLowerCase());
        if (bytes) font = ShxFont.fromBytes(bytes, style.font);
      } catch {
        font = null;
      }
    }
    shapes.set(h, font);
  }
  // Linetype text cannot use TrueType fonts: AutoCAD draws it with FONTALT (simplex.shx) even
  // when the STYLE's TTF is installed and TEXT entities use it. VERIFIED-BY-ACAD (linetypes/ctext-*)
  const textFonts = needText
    ? await prepareTextFonts(doc, env.loadFont, { ...env.text, unavailableFonts: TRUETYPE })
    : undefined;
  RESOURCES.set(doc, { shapes, styles, textFonts });
});

setComplexElementDrawer((fe, placements, e, r, st) => {
  const res = RESOURCES.get(fe.doc);
  if (!res) {
    fe.note("complex-linetype-element");
    return;
  }
  for (const p of placements) {
    const data = p.element.data as ComplexElementData | undefined;
    if (!data) continue;
    if (p.element.kind === "shape") drawShape(fe, res, p, data, r);
    else drawText(fe, res, p, data, e, st);
  }
});

function drawShape(
  fe: Frontend,
  res: ComplexResources,
  p: ComplexPlacement,
  data: ComplexElementData,
  r: Resolved,
): void {
  const el = data.element;
  const font = res.shapes.get((el.styleHandle ?? "").toUpperCase());
  if (!font) {
    fe.note("complex-linetype-missing-shape-file");
    return;
  }
  const glyph = font.glyph(el.shapeNumber);
  if (!glyph) return;
  // One shape unit = S (× linetype scale); S < 0 mirrors through the origin. S = 0 collapses the
  // shape along the line but keeps 1 drawing unit across it. VERIFIED-BY-ACAD
  // (acad-default-fonts/ltype-fenceline2-scale-zero|negative)
  const s = p.element.scale;
  const sx = s;
  const sy = s === 0 ? 1 : s;
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const tol = fe.tolerance / Math.max(Math.abs(sx), Math.abs(sy));
  for (const pl of flattenStrokes(glyph.strokes, { tolerance: tol })) {
    const out = new Float64Array(pl.length);
    for (let i = 0; i + 1 < pl.length; i += 2) {
      const u = pl[i]! * sx;
      const v = pl[i + 1]! * sy;
      out[i] = p.x + cos * u - sin * v;
      out[i + 1] = p.y + sin * u + cos * v;
    }
    fe.strokeFlat(out, false, r);
  }
}

function drawText(
  fe: Frontend,
  res: ComplexResources,
  p: ComplexPlacement,
  data: ComplexElementData,
  e: Entity,
  st: DrawState,
): void {
  const el = data.element;
  const fonts = res.textFonts;
  const style = res.styles.get((el.styleHandle ?? "").toUpperCase());
  if (!fonts || !style || !el.text) {
    fe.note("complex-linetype-text-unavailable");
    return;
  }
  // Text height = |S| × the STYLE's fixed height when that is set, else |S|; S = 0 counts as 1
  // (in linetype scale units) and S < 0 turns the text by 180° about its insertion point.
  // VERIFIED-BY-ACAD (linetypes/ctext-height-*, ctext-scale-zero, ctext-scale-neg)
  const S = p.element.scale === 0 ? data.scale : p.element.scale;
  const height = Math.abs(S) * (style.fixedHeight > 0 ? style.fixedHeight : 1);
  const turn = S < 0 ? Math.PI : 0;
  const input = (x: number, y: number, angle: number) => ({
    text: el.text!,
    insert: { x, y, z: 0 },
    alignPoint: undefined,
    height,
    rotation: (angle * 180) / Math.PI,
    widthFactor: style.widthFactor || 1,
    oblique: style.oblique,
    style: style.name,
    generationFlags: 0,
    halign: 0,
    valign: 0,
    extrusion: { x: 0, y: 0, z: 1 },
  });
  let { x, y } = p;
  const rot = p.element.rotation;
  if (p.element.rotationMode === ComplexRotation.Upright && rot !== 0) {
    // U= turns the text about the centre of its glyph box: it stays centred where the text with
    // rotation 0 would be (R= turns about the insertion point). VERIFIED-BY-ACAD
    // (linetypes/ctext-orient-u-30-0 vs ctext-orient-r-30-0)
    const box = glyphBox(layoutText(input(0, 0, 0), fonts));
    if (box) {
      const cx = (box[0] + box[2]) / 2;
      const cy = (box[1] + box[3]) / 2;
      const t = p.angle - rot;
      x += Math.cos(t) * cx - Math.sin(t) * cy - (Math.cos(p.angle) * cx - Math.sin(p.angle) * cy);
      y += Math.sin(t) * cx + Math.cos(t) * cy - (Math.sin(p.angle) * cx + Math.cos(p.angle) * cy);
    }
  }
  drawLayout(fe, layoutText(input(x, y, p.angle + turn), fonts), e, IDENTITY, st.inh);
}

/** Glyph ink box [xmin, ymin, xmax, ymax] of a layout in its plane. */
function glyphBox(layout: TextLayout): [number, number, number, number] | undefined {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const g of layout.glyphs) {
    const b = g.glyph.bounds;
    if (!b) continue;
    for (const [u, v] of [
      [b.xMin, b.yMin],
      [b.xMax, b.yMin],
      [b.xMin, b.yMax],
      [b.xMax, b.yMax],
    ] as const) {
      const q = g.matrix.apply({ x: u, y: v });
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
  }
  return x1 >= x0 ? [x0, y0, x1, y1] : undefined;
}

const IDENTITY = Matrix44.identity();
