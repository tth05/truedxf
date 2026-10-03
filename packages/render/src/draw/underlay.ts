/**
 * PDF / DWF / DGN underlays (note 07 §10, §8.5).
 *
 * VERIFIED-BY-ACAD (images/pdf-*, 2026-09-30): 1 PDF inch = 1 drawing unit at scale 1, whatever
 * INSUNITS (pdf-natural-mm); with 280 bit 2 (on) cleared only the frame plots (pdf-flags-off);
 * PDFFRAME comes from the DICTIONARYVAR (1 or absent: frame, 0 / 2: none, pdfframe-dictvar-*);
 * the frame is the page rectangle (MediaBox), or the clip boundary when clipping.
 *
 * PDF content comes from `RenderEnv.pdf` (pdf.ts; PDF.js in `@truedxf/pdf`): the page is
 * rasterized at the resolution it covers on the target and drawn as image triangles. Drawing is
 * synchronous, so the drawer places an empty bitmap and Frontend.finish() fills it. DWF and DGN
 * content is not rendered (frame only).
 *
 * Colour adjustments, fitted to AutoCAD's PNG plots of images/pdf-flags-*, pdf-fade*-contrast*
 * (2026-10-03, ±1 per channel), in HLS with the hue kept:
 * - contrast c = 281 / 100 on the lightness: L' = P + (L − P)·c with P ≈ 0.3 (contrast 20:
 *   black 61, white 112, yellow FFFFD9 → D9D900, red stays fully saturated);
 * - fade f = 282 / 100, after contrast: L'' = L' + (1 − L')·f (towards the paper); the
 *   saturation becomes that of the colour faded per channel, c + (paper − c)·f (fade 50:
 *   800000 → BF7F7F; with contrast 20 → C28686);
 * - monochrome (280 bit 4): saturation 0, i.e. grey of the HLS lightness (red and blue 127);
 * - adjust for background (280 bit 8): no effect on plots (pdf-flags-adjustbg = pdf-flags-plain);
 *   on a dark display background it inverts the lightness (ASSUMPTION, display only).
 * Areas the page does not paint stay transparent (ASSUMPTION; the probe page is fully painted).
 *
 * Clip boundary (11/21): in underlay units before 41/42, VERIFIED-BY-ACAD pdf-clip-rect,
 * pdf-clip-poly. Flag 16 ("inside mode") does not invert it in plots: pdf-clip-inverted plots
 * like pdf-clip-rect and DXFOUT keeps 280 = 19.
 */
import {
  clipPolygons,
  FillRule,
  lineSegment,
  Matrix44,
  ocsToWcsMatrix,
  type PathSegment,
  triangulateFill,
} from "@truedxf/geometry";
import {
  type DxfDocument,
  dictionaryVariables,
  type UnderlayDefinitionObject,
  type UnderlayEntity,
} from "@truedxf/model";
import type { RasterImage } from "../displaylist.ts";
import {
  type DrawState,
  type Frontend,
  type PlotNote,
  type RenderEnv,
  registerDrawer,
  registerPreparer,
} from "../frontend.ts";
import type { PdfBox, PdfFile, PdfPage, PdfRasterizer, PdfTransform } from "../pdf.ts";

const UNDERLAY_TYPES = ["PDFUNDERLAY", "DWFUNDERLAY", "DGNUNDERLAY"] as const;
const CLIPPING = 1;
const ON = 2;
const MONOCHROME = 4;
const ADJUST_FOR_BACKGROUND = 8;

/** Default largest bitmap side (PdfRasterizer.maxSize). */
const MAX_SIZE = 4096;
/** Filled bitmaps kept per document (count limit, least recently used dropped first). */
const MAX_RASTERS = 16;
/** Contrast pivot in HLS lightness (fitted, see the module comment). */
const CONTRAST_PIVOT = 0.3;

interface PdfDef {
  /** Page rectangle (MediaBox) in PDF units; the underlay origin is its lower-left corner. */
  box: PdfBox;
  /** Undefined without a rasterizer (or when it cannot read the file): frame only. */
  page?: PdfPage;
}

interface DefCache {
  loader: RenderEnv["loadImage"];
  pdf: PdfRasterizer | undefined;
  /** By PDFDEFINITION handle; null = file missing or unreadable. */
  defs: Map<string, PdfDef | null>;
  files: PdfFile[];
}

interface RasterEntry {
  image: RasterImage;
  /** Started by the first frontend that finishes with this bitmap. */
  fill?: Promise<void>;
}

/** Valid for one loader and rasterizer: new ones (files added in a viewer) look files up again. */
const DEFS = new WeakMap<DxfDocument, DefCache>();
const RASTERS = new WeakMap<DxfDocument, Map<string, RasterEntry>>();
const EMPTY = new Uint8Array(4);

registerPreparer(async (doc, env) => {
  if (!env.loadImage) return;
  let cache = DEFS.get(doc);
  if (!cache || cache.loader !== env.loadImage || cache.pdf !== env.pdf) {
    for (const f of cache?.files ?? []) f.close?.();
    cache = { loader: env.loadImage, pdf: env.pdf, defs: new Map(), files: [] };
    DEFS.set(doc, cache);
    RASTERS.delete(doc);
  }
  const missing = new Map<string, string>();
  for (const o of doc.objects) {
    if (o.type !== "PDFDEFINITION") continue;
    const def = o as UnderlayDefinitionObject;
    if (!cache.defs.has(o.handle)) cache.defs.set(o.handle, await loadDef(def, env, cache));
    if (cache.defs.get(o.handle) === null && def.fileName) missing.set(o.handle, def.fileName);
  }
  return missing.size ? missingPdfNotes(doc, missing) : undefined;
});

async function loadDef(
  def: UnderlayDefinitionObject,
  env: RenderEnv,
  cache: DefCache,
): Promise<PdfDef | null> {
  if (!def.fileName || !env.loadImage) return null;
  let bytes: Uint8Array | undefined;
  try {
    bytes = await env.loadImage(def.fileName);
  } catch {
    bytes = undefined;
  }
  if (!bytes) return null;
  const n = Number(def.name) || 1;
  if (env.pdf) {
    try {
      // the rasterizer may take ownership of the bytes (PDF.js transfers them): pass a copy
      const file = await env.pdf.open(bytes.slice());
      if (file) {
        cache.files.push(file);
        const page = await file.page(n);
        if (page) return { box: page.mediaBox, page };
      }
    } catch {
      // unreadable for the rasterizer: the frame can still come from the MediaBox
    }
  }
  const size = pdfPageSize(bytes, n);
  return size ? { box: [0, 0, size.w, size.h] } : null;
}

/**
 * `pdf-missing` note: PDF files that underlays need but the loader could not supply (or the
 * rasterizer could not read), with the PDFDEFINITION paths as written in `items`.
 */
function missingPdfNotes(doc: DxfDocument, missing: ReadonlyMap<string, string>): PlotNote[] {
  const files = new Set<string>();
  let count = 0;
  for (const b of new Set([doc.modelSpace, ...doc.blocks]))
    for (const e of b.entities) {
      if (e.type !== "PDFUNDERLAY") continue;
      const path = missing.get((e as UnderlayEntity).definitionHandle ?? "");
      if (path === undefined) continue;
      count++;
      files.add(path);
    }
  if (files.size === 0) return [];
  const items = [...files];
  return [
    {
      code: "pdf-missing",
      severity: "warning",
      message: `PDF underlay files not found: ${items.join(", ")} ; only the underlay frames are drawn`,
      count,
      items,
    },
  ];
}

/** Page size in PDF units (1/72 inch) from the n-th /MediaBox (1-based), else the first. */
export function pdfPageSize(bytes: Uint8Array, page: number): { w: number; h: number } | undefined {
  const text = new TextDecoder("latin1").decode(bytes);
  const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g)];
  const m = boxes[page - 1] ?? boxes[0];
  if (!m) return undefined;
  return { w: Number(m[3]) - Number(m[1]), h: Number(m[4]) - Number(m[2]) };
}

function underlayFrameMode(doc: DxfDocument, type: string): number {
  if (type === "PDFUNDERLAY") {
    const v = dictionaryVariables(doc).get("PDFFRAME");
    return v === undefined || v.trim() === "" ? 1 : Number(v) || 0;
  }
  return doc.header.num(type === "DWFUNDERLAY" ? "$DWFFRAME" : "$DGNFRAME", 1);
}

/** The clip boundary (11/21) in underlay units: 2 points = rectangle, more = polygon. */
function clipRing(e: UnderlayEntity): Float64Array | undefined {
  const b = e.clipBoundary;
  if ((e.flags & CLIPPING) === 0 || b.length < 2) return undefined;
  if (b.length === 2)
    return Float64Array.of(b[0]!.x, b[0]!.y, b[1]!.x, b[0]!.y, b[1]!.x, b[1]!.y, b[0]!.x, b[1]!.y);
  return Float64Array.from(b.flatMap((p) => [p.x, p.y]));
}

/** Underlay units (inches from the page's lower-left corner, before 41/42) → target. */
function underlayMatrix(e: UnderlayEntity, st: DrawState): Matrix44 {
  return st.m
    .multiply(ocsToWcsMatrix(e.extrusion))
    .multiply(Matrix44.translation(e.insert.x, e.insert.y, e.insert.z))
    .multiply(Matrix44.rotationZ((e.rotation * Math.PI) / 180))
    .multiply(Matrix44.scaling(e.scale.x, e.scale.y, 1));
}

function toTarget(m: Matrix44, ring: Float64Array): Float64Array {
  const out = new Float64Array(ring.length);
  for (let k = 0; k + 1 < ring.length; k += 2) {
    const q = m.transformPoint({ x: ring[k]!, y: ring[k + 1]!, z: 0 });
    out[k] = q.x;
    out[k + 1] = q.y;
  }
  return out;
}

registerDrawer(UNDERLAY_TYPES, (fe, ent, st) => {
  const e = ent as UnderlayEntity;
  const def =
    e.type === "PDFUNDERLAY" && e.definitionHandle
      ? DEFS.get(fe.doc)?.defs.get(e.definitionHandle)
      : undefined;
  const m = underlayMatrix(e, st);
  const clip = clipRing(e);
  if ((e.flags & ON) !== 0) {
    if (def?.page) drawContent(fe, e, m, def as Required<PdfDef>, clip);
    else if (def !== null || !fe.env.loadImage) fe.note("underlay-content");
  }
  if (underlayFrameMode(fe.doc, e.type) !== 1) return;
  let ring = clip;
  if (!ring) {
    if (!def) return;
    const w = (def.box[2] - def.box[0]) / 72;
    const h = (def.box[3] - def.box[1]) / 72;
    ring = Float64Array.of(0, 0, w, 0, w, h, 0, h);
  }
  const t = toTarget(m, ring);
  const n = t.length >> 1;
  const segs: PathSegment[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    segs.push(lineSegment({ x: t[i * 2]!, y: t[i * 2 + 1]! }, { x: t[j * 2]!, y: t[j * 2 + 1]! }));
  }
  fe.strokePath({ subpaths: [{ segments: segs, closed: true }] }, fe.resolve(e, st), e, st);
});

function drawContent(
  fe: Frontend,
  e: UnderlayEntity,
  m: Matrix44,
  def: Required<PdfDef>,
  clip: Float64Array | undefined,
): void {
  const [bx0, by0, bx1, by1] = def.box;
  const w = (bx1 - bx0) / 72;
  const h = (by1 - by0) / 72;
  if (!(w > 0) || !(h > 0)) return;
  // painted region in underlay units: the page, cut by the clip boundary
  const page = Float64Array.of(0, 0, w, 0, w, h, 0, h);
  const rings = clip ? clipPolygons([page], { rings: [clip] }).flatMap((p) => [p.outer, ...p.holes]) : [page];
  if (rings.length === 0) return;
  const target = rings.map((r) => toTarget(m, r));
  const tri = triangulateFill(target, { fillRule: FillRule.EvenOdd, tolerance: fe.tolerance });
  if (tri.length < 6) return;

  // The bitmap is aligned with the device pixels (rotated / mirrored placements are rendered
  // by PDF.js, not resampled): texel (i, j) covers target [x0 + i·T, x0 + (i+1)·T] ×
  // [y1 − (j+1)·T, y1 − j·T] on the grid of the view. Static plots only rasterize the part in
  // view; an interactive list must cover the whole drawing (it is panned without re-rendering).
  const v = fe.view;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of target)
    for (let k = 0; k + 1 < r.length; k += 2) {
      minX = Math.min(minX, r[k]!);
      maxX = Math.max(maxX, r[k]!);
      minY = Math.min(minY, r[k + 1]!);
      maxY = Math.max(maxY, r[k + 1]!);
    }
  if (!fe.lod) {
    minX = Math.max(minX, v.minX);
    minY = Math.max(minY, v.minY);
    maxX = Math.min(maxX, v.maxX);
    maxY = Math.min(maxY, v.maxY);
  }
  if (!(maxX > minX) || !(maxY > minY)) return;
  const max = fe.env.pdf?.maxSize ?? MAX_SIZE;
  let size = fe.pixelSize;
  const span = Math.max(maxX - minX, maxY - minY);
  if (span / size > max) size = span / max;
  const gx0 = Math.floor((minX - v.minX) / size);
  const gx1 = Math.ceil((maxX - v.minX) / size);
  const gy0 = Math.floor((v.maxY - maxY) / size);
  const gy1 = Math.ceil((v.maxY - minY) / size);
  const width = Math.max(1, gx1 - gx0);
  const height = Math.max(1, gy1 - gy0);
  const tx = (x: number) => (x - v.minX) / size - gx0;
  const ty = (y: number) => (v.maxY - y) / size - gy0;

  // PDF units → texels: underlay units are inches from the page's lower-left corner
  const o = m.transformPoint({ x: 0, y: 0, z: 0 });
  const ex = m.transformPoint({ x: 1 / 72, y: 0, z: 0 });
  const ey = m.transformPoint({ x: 0, y: 1 / 72, z: 0 });
  const a = (ex.x - o.x) / size;
  const b = -(ex.y - o.y) / size;
  const c = (ey.x - o.x) / size;
  const d = -(ey.y - o.y) / size;
  if (!(Math.abs(a * d - b * c) > 1e-300)) return;
  const transform = [a, b, c, d, tx(o.x) - a * bx0 - c * by0, ty(o.y) - b * bx0 - d * by0] as const;

  const uv = new Float64Array(tri.length);
  for (let k = 0; k + 1 < tri.length; k += 2) {
    uv[k] = tx(tri[k]!) / width;
    uv[k + 1] = ty(tri[k + 1]!) / height;
  }
  const image = raster(fe, def.page, transform, width, height, adjustments(fe, e));
  fe.builder.imageTriangles(tri, uv, image, [255, 255, 255, 255]);
}

interface Adjustments {
  contrast: number;
  fade: number;
  mono: boolean;
  invert: boolean;
  /** Fade target (the paper / background), RGB in [0, 1]. */
  paper: readonly [number, number, number];
}

function adjustments(fe: Frontend, e: UnderlayEntity): Adjustments {
  const [r, g, b] = fe.props.background;
  const paper = [r / 255, g / 255, b / 255] as const;
  const dark = Math.max(r, g, b) + Math.min(r, g, b) < 255;
  return {
    contrast: Math.min(100, Math.max(0, e.contrast)) / 100,
    fade: Math.min(100, Math.max(0, e.fade)) / 100,
    mono: (e.flags & MONOCHROME) !== 0,
    // display only: plots are on white paper (pdf-flags-adjustbg)
    invert: (e.flags & ADJUST_FOR_BACKGROUND) !== 0 && fe.props.display && dark,
    paper,
  };
}

/** The bitmap for one page placement: cached per document, filled by Frontend.finish(). */
function raster(
  fe: Frontend,
  page: PdfPage,
  transform: PdfTransform,
  width: number,
  height: number,
  a: Adjustments,
): RasterImage {
  let cache = RASTERS.get(fe.doc);
  if (!cache) RASTERS.set(fe.doc, (cache = new Map()));
  const key = [...transform, width, height, a.contrast, a.fade, a.mono, a.invert, a.paper].join("|");
  const pageKey = `${pageId(page)}|${key}`;
  let entry = cache.get(pageKey);
  if (entry) cache.delete(pageKey);
  else {
    entry = { image: { width, height, pixels: EMPTY, smooth: !fe.grid } };
    while (cache.size >= MAX_RASTERS) cache.delete(cache.keys().next().value!);
  }
  cache.set(pageKey, entry);
  const en = entry;
  fe.defer(() => (en.fill ??= fill(en.image, page, transform, a)));
  return en.image;
}

const PAGE_IDS = new WeakMap<PdfPage, number>();
let nextPageId = 0;
function pageId(page: PdfPage): number {
  let id = PAGE_IDS.get(page);
  if (id === undefined) PAGE_IDS.set(page, (id = nextPageId++));
  return id;
}

async function fill(
  image: RasterImage,
  page: PdfPage,
  transform: PdfTransform,
  a: Adjustments,
): Promise<void> {
  let px: Uint8Array | undefined;
  try {
    px = await page.render(transform, image.width, image.height);
  } catch {
    px = undefined;
  }
  // the placeholder is ours: fill it in place (lists already reference it)
  (image as { pixels: Uint8Array }).pixels =
    px && px.length === image.width * image.height * 4
      ? adjust(px, a)
      : new Uint8Array(image.width * image.height * 4);
}

function adjust(px: Uint8Array, a: Adjustments): Uint8Array {
  if (a.contrast === 1 && a.fade === 0 && !a.mono && !a.invert) return px;
  const hls = [0, 0, 0];
  const faded = [0, 0, 0];
  const rgb = [0, 0, 0];
  const [pr, pg, pb] = a.paper;
  const paperL = (Math.max(pr, pg, pb) + Math.min(pr, pg, pb)) / 2;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const r = px[i]! / 255;
    const g = px[i + 1]! / 255;
    const b = px[i + 2]! / 255;
    rgbToHls(r, g, b, hls);
    let l = hls[1]!;
    let s = hls[2]!;
    if (a.invert) l = 1 - l;
    l = CONTRAST_PIVOT + (l - CONTRAST_PIVOT) * a.contrast;
    if (a.fade > 0) {
      l += (paperL - l) * a.fade;
      rgbToHls(r + (pr - r) * a.fade, g + (pg - g) * a.fade, b + (pb - b) * a.fade, faded);
      s = faded[2]!;
    }
    hlsToRgb(hls[0]!, Math.min(1, Math.max(0, l)), a.mono ? 0 : s, rgb);
    px[i] = Math.round(rgb[0]! * 255);
    px[i + 1] = Math.round(rgb[1]! * 255);
    px[i + 2] = Math.round(rgb[2]! * 255);
  }
  return px;
}

/** RGB in [0, 1] → hue [0, 1), lightness, saturation (HLS). */
function rgbToHls(r: number, g: number, b: number, out: number[]): void {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    out[0] = 0;
    out[1] = l;
    out[2] = 0;
    return;
  }
  const d = max - min;
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  out[0] = h / 6;
  out[1] = l;
  out[2] = s;
}

function hlsToRgb(h: number, l: number, s: number, out: number[]): void {
  if (s === 0) {
    out[0] = out[1] = out[2] = l;
    return;
  }
  const q = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  out[0] = hue(p, q, h + 1 / 3);
  out[1] = hue(p, q, h);
  out[2] = hue(p, q, h - 1 / 3);
}

function hue(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
