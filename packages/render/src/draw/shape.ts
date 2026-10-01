/**
 * SHAPE entities (note 07 §14): a named shape from the shape files of the STYLE entries with
 * flag 1, searched in table order (ezdxf shape.py "iterating over all the text styles … until the
 * one with the matching name is found"), drawn with the SHX interpreter of @truedxf/fonts.
 *
 * Geometry VERIFIED-BY-ACAD 2026-10-01 (acad-default-fonts/shape-*, shape-probes/*, note 07 §14):
 * one shape unit = size 40 (0 draws as 1, < 0 mirrors through the insertion point); x-scale 41
 * stretches along the shape's x axis, oblique 51 slants independently of it like TEXT
 * (x = x·41 + y·tan 51), rotation 50 turns about the insertion point; 10 is an OCS point
 * (210 = −Z mirrors the shape and its insertion point); thickness 39 extrudes the strokes along N̂
 * like a curve with thickness (top copy + an edge at every vertex, thickness-text-shape-iso).
 * Arcs are flattened finer than AutoCAD's plot facets (UNKNOWN, note 04 §4.3).
 */
import { flattenStrokes, type ShxFont, type StrokeGlyph } from "@truedxf/fonts";
import { Affine2, Matrix44, ocsToWcsMatrix } from "@truedxf/geometry";
import type { DxfDocument, ShapeEntity } from "@truedxf/model";
import { type PlotNote, registerDrawer, registerPreparer } from "../frontend.ts";
import { loadShapeFile } from "./complex-linetype.ts";

/** Loaded shape files of a document, in STYLE table order (missing files left out). */
const FILES = new WeakMap<DxfDocument, readonly ShxFont[]>();

function hasShapes(doc: DxfDocument): boolean {
  for (const b of doc.blocks) for (const e of b.entities) if (e.type === "SHAPE") return true;
  return false;
}

registerPreparer(async (doc, env) => {
  if (!hasShapes(doc)) return;
  const files: ShxFont[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const s of doc.tables.styles) {
    if (!s.isShapeFile || !s.font || seen.has(s.font.toLowerCase())) continue;
    seen.add(s.font.toLowerCase());
    const f = await loadShapeFile(env, s);
    if (f) files.push(f);
    else missing.push(s.font);
  }
  FILES.set(doc, files);
  return env.loadFont && missing.length ? missingShapeFileNotes(doc, files, missing) : undefined;
});

/**
 * `shapefile-missing` note (PlotResult.notes): shape files of flag-1 STYLEs that could not be
 * loaded, reported when some SHAPE entity's name is in none of the loaded files (`count`).
 */
function missingShapeFileNotes(doc: DxfDocument, files: readonly ShxFont[], missing: string[]): PlotNote[] {
  let count = 0;
  for (const b of doc.blocks)
    for (const e of b.entities) if (e.type === "SHAPE" && !find(files, (e as ShapeEntity).name)) count++;
  if (count === 0) return [];
  return [
    {
      code: "shapefile-missing",
      severity: "warning",
      message: `Shape files not found: ${missing.join(", ")}; ${count} shape${count === 1 ? " is" : "s are"} not drawn`,
      count,
      items: missing,
    },
  ];
}

function find(files: readonly ShxFont[], name: string): { font: ShxFont; glyph: StrokeGlyph } | undefined {
  for (const font of files) {
    const glyph = font.glyphByName(name);
    if (glyph) return { font, glyph };
  }
  return undefined;
}

registerDrawer("SHAPE", (fe, ent, st) => {
  const e = ent as ShapeEntity;
  const files = FILES.get(fe.doc) ?? [];
  const hit = find(files, e.name);
  if (!hit) {
    // AutoCAD resolves the name when it reads the DXF and rejects the drawing when no flag-1
    // STYLE's file has it (VERIFIED-BY-ACAD shape-probes/style-flag0-geniso); draw nothing
    fe.note(files.length > 0 ? "shape-not-found" : "shape-missing-file");
    return;
  }
  // A shape file has no "above" value: one shape unit is one size unit. A real font used as a
  // shape file scales like text (size = height of "above") — ASSUMPTION.
  const unit = hit.font.isShapeFile ? 1 : hit.font.capHeight;
  const s = (e.size === 0 ? 1 : e.size) / unit;
  const wf = e.widthFactor === 0 ? 1 : e.widthFactor; // 41 = 0 like 1 (ASSUMPTION, as TEXT)
  const slant = Math.tan((e.oblique * Math.PI) / 180);
  const plane = st.m
    .multiply(ocsToWcsMatrix(e.extrusion))
    .multiply(Matrix44.translation(e.insert.x, e.insert.y, e.insert.z))
    .multiply(Matrix44.rotationZ((e.rotation * Math.PI) / 180))
    .multiply(Matrix44.fromRows(s * wf, s * slant, 0, 0, 0, s, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
  // shape plane (x, y, 0) → target (x, y): a parallel projection drops z
  const a = plane.m;
  const t = new Affine2(a[0]!, a[1]!, a[4]!, a[5]!, a[12]!, a[13]!);
  const sigma = t.singularValues()[0];
  const tolerance = sigma > 0 ? fe.tolerance / sigma : 1;
  const r = fe.resolve(e, st);
  const d = thickness(e, st.m, fe.tolerance);
  for (const pl of flattenStrokes(hit.glyph.strokes, { tolerance })) {
    const pts = t.applyPoints(Float64Array.from(pl));
    fe.strokeFlat(pts, false, r);
    if (!d) continue;
    const top = new Float64Array(pts.length);
    for (let k = 0; k + 1 < pts.length; k += 2) {
      top[k] = pts[k]! + d.x;
      top[k + 1] = pts[k + 1]! + d.y;
    }
    fe.strokeFlat(top, false, r);
    for (let k = 0; k + 1 < pts.length; k += 2)
      fe.strokeFlat(Float64Array.of(pts[k]!, pts[k + 1]!, top[k]!, top[k + 1]!), false, r);
  }
});

/** Target-plane offset of the extrusion by 39 along N̂, or undefined when it is not visible. */
function thickness(e: ShapeEntity, m: Matrix44, tol: number): { x: number; y: number } | undefined {
  if (e.thickness === 0) return undefined;
  const n = e.extrusion;
  const len = Math.hypot(n.x, n.y, n.z) || 1;
  const k = e.thickness / len;
  const d = m.transformDirection({ x: n.x * k, y: n.y * k, z: n.z * k });
  return Math.hypot(d.x, d.y) > tol ? d : undefined;
}
