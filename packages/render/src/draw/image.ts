/**
 * IMAGE and WIPEOUT (note 07 §8, §9; note 06 §8.3).
 *
 * VERIFIED-BY-ACAD (images suite, 2026-09-30): accoreconsole — the reference harness — plots
 * neither IMAGE nor WIPEOUT (no bitmap, no frame, no mask; the DXFOUT re-save stores empty proxy
 * graphics for both), so RenderEnv.rasterEntities = "omit" reproduces the references. What
 * follows for "draw" (the default) is therefore UNVERIFIED against AutoCAD:
 * - placement: pixel (i, j) (row j from the top) covers insert + [i, i+1]·u + [h−1−j, h−j]·v;
 *   nearest sampling;
 * - clip boundary (pixel coordinates, (−0.5, −0.5) = top-left corner) when 280 = 1; 290 inverts;
 *   the frame follows the clip boundary;
 * - brightness / contrast / fade after ezdxf pr#999: contrast about the mean grey, fade towards
 *   the background, brightness towards white / black;
 * - bitonal (1-bit) images: dark pixels in the entity colour, light pixels background-white or
 *   transparent with display flag 8;
 * - missing / unloaded / hidden images: frame only; frame per IMAGEFRAME (RASTERVARIABLES 70:
 *   0 off, 1 plotted, 2 displayed but not plotted; AutoCAD keeps 70 = 2 on DXFOUT, imageframe-2).
 * - WIPEOUT: boundary filled with the paper colour, frame per WIPEOUTFRAME (DICTIONARYVAR over
 *   WIPEOUTVARIABLES 70).
 */
import { FillRule, lineSegment, type Matrix44, type PathSegment, triangulateFill } from "@truedxf/geometry";
import type {
  DxfDocument,
  ImageDefObject,
  ImageEntity,
  RasterImageProps,
  RasterVariablesObject,
  WipeoutEntity,
  WipeoutVariablesObject,
} from "@truedxf/model";
import { dictionaryVariables } from "@truedxf/model";
import type { RasterImage, Rgba } from "../displaylist.ts";
import { type DrawState, type Frontend, registerDrawer, registerPreparer } from "../frontend.ts";
import { type DecodedRaster, decodeRaster } from "../image-decode.ts";

const SHOW = 1;
const TRANSPARENCY = 8;

/** Decoded files per document and IMAGEDEF handle (null = missing / undecodable). */
const DECODED = new WeakMap<DxfDocument, Map<string, DecodedRaster | null>>();
/** Adjusted rasters per document and (IMAGEDEF, adjustments) key. */
const ADJUSTED = new WeakMap<DxfDocument, Map<string, RasterImage>>();

registerPreparer(async (doc, env) => {
  if (env.rasterEntities === "omit" || !env.loadImage) return;
  let map = DECODED.get(doc);
  if (!map) DECODED.set(doc, (map = new Map()));
  for (const o of doc.objects) {
    if (o.type !== "IMAGEDEF" || map.has(o.handle)) continue;
    const def = o as ImageDefObject;
    let r: DecodedRaster | null = null;
    if (def.fileName) {
      try {
        const bytes = await env.loadImage(def.fileName);
        r = (bytes && decodeRaster(bytes)) || null;
      } catch {
        r = null;
      }
    }
    map.set(o.handle, r);
  }
});

/** Pixel-space point → WCS (note 07 §8.1). */
function pixelToWcs(e: RasterImageProps, x: number, y: number) {
  const h = e.size.y;
  const a = x + 0.5;
  const b = h - y - 0.5;
  return {
    x: e.insert.x + a * e.u.x + b * e.v.x,
    y: e.insert.y + a * e.u.y + b * e.v.y,
    z: e.insert.z + a * e.u.z + b * e.v.z,
  };
}

/** Boundary in pixel coordinates: the clip polygon when clipping, else the full image. */
function pixelBoundary(e: RasterImageProps, clip: boolean): [number, number][] {
  const w = e.size.x;
  const h = e.size.y;
  const full: [number, number][] = [
    [-0.5, -0.5],
    [w - 0.5, -0.5],
    [w - 0.5, h - 0.5],
    [-0.5, h - 0.5],
  ];
  if (!clip || e.clipBoundary.length < 2) return full;
  const b = e.clipBoundary;
  if (e.clipType === 1 || b.length === 2) {
    const x0 = Math.min(b[0]!.x, b[1]!.x);
    const x1 = Math.max(b[0]!.x, b[1]!.x);
    const y0 = Math.min(b[0]!.y, b[1]!.y);
    const y1 = Math.max(b[0]!.y, b[1]!.y);
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  }
  const pts = b.map((p) => [p.x, p.y] as [number, number]);
  const f = pts[0]!;
  const l = pts[pts.length - 1]!;
  if (pts.length > 3 && f[0] === l[0] && f[1] === l[1]) pts.pop();
  return pts;
}

function toTarget(e: RasterImageProps, pts: [number, number][], m: Matrix44): Float64Array {
  const out = new Float64Array(pts.length * 2);
  pts.forEach(([x, y], i) => {
    const q = m.transformPoint(pixelToWcs(e, x, y));
    out[i * 2] = q.x;
    out[i * 2 + 1] = q.y;
  });
  return out;
}

function frameMode(doc: DxfDocument, wipeout: boolean): number {
  if (wipeout) {
    const v = dictionaryVariables(doc).get("WIPEOUTFRAME");
    if (v !== undefined && v.trim() !== "") return Number(v) || 0;
    const o = doc.namedObject("ACAD_WIPEOUT_VARS") as WipeoutVariablesObject | undefined;
    return o?.type === "WIPEOUTVARIABLES" ? o.frame : 1;
  }
  const o = doc.namedObject("ACAD_IMAGE_VARS") as RasterVariablesObject | undefined;
  return o?.type === "RASTERVARIABLES" ? o.frame : 1;
}

function drawFrame(fe: Frontend, e: ImageEntity | WipeoutEntity, st: DrawState, ring: Float64Array): void {
  const r = fe.resolve(e, st);
  const n = ring.length >> 1;
  const segs: PathSegment[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    segs.push(
      lineSegment({ x: ring[i * 2]!, y: ring[i * 2 + 1]! }, { x: ring[j * 2]!, y: ring[j * 2 + 1]! }),
    );
  }
  fe.strokePath({ subpaths: [{ segments: segs, closed: true }] }, r, e, st);
}

/** Target-space region to paint (clip polygon, or image rectangle minus it when inverted). */
function region(fe: Frontend, e: RasterImageProps, st: DrawState, clip: boolean): Float64Array {
  const rect = toTarget(e, pixelBoundary(e, false), st.m);
  if (!clip) return triangulateFill([rect], { fillRule: FillRule.EvenOdd, tolerance: fe.tolerance });
  const poly = toTarget(e, pixelBoundary(e, true), st.m);
  if (e.clipInverted)
    return triangulateFill([rect, poly], { fillRule: FillRule.EvenOdd, tolerance: fe.tolerance });
  // the clip region never extends beyond the bitmap
  const inside = triangulateFill([poly], { fillRule: FillRule.EvenOdd, tolerance: fe.tolerance });
  return inside;
}

function adjust(
  fe: Frontend,
  defHandle: string,
  src: DecodedRaster,
  e: ImageEntity,
  color: Rgba,
): RasterImage {
  let cache = ADJUSTED.get(fe.doc);
  if (!cache) ADJUSTED.set(fe.doc, (cache = new Map()));
  const transparent = (e.displayFlags & TRANSPARENCY) !== 0;
  const [bgR, bgG, bgB] = fe.props.background;
  const key = [defHandle, e.brightness, e.contrast, e.fade, transparent, src.ink ? color.join(",") : ""].join(
    "|",
  );
  const hit = cache.get(key);
  if (hit) return hit;
  const n = src.width * src.height;
  const px = new Uint8Array(n * 4);
  const cf = Math.max(0, e.contrast) / 50;
  let mean = 0;
  if (cf !== 1) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      sum += (src.rgba[o]! * 299 + src.rgba[o + 1]! * 587 + src.rgba[o + 2]! * 114) / 1000;
    }
    mean = Math.round(sum / Math.max(1, n));
  }
  const fade = Math.min(100, Math.max(0, e.fade)) / 100;
  const b = Math.min(100, Math.max(0, e.brightness)) / 50 - 1;
  const bTarget = b > 0 ? 255 : 0;
  const ab = Math.abs(b);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let a = transparent ? src.rgba[o + 3]! : 255;
    let rgb: [number, number, number];
    if (src.ink) {
      if (src.ink[i]) rgb = [color[0], color[1], color[2]];
      else {
        rgb = [bgR, bgG, bgB];
        if (transparent) a = 0;
      }
    } else rgb = [src.rgba[o]!, src.rgba[o + 1]!, src.rgba[o + 2]!];
    const bg = [bgR, bgG, bgB];
    for (let c = 0; c < 3; c++) {
      let v = rgb[c]!;
      if (!src.ink) {
        if (cf !== 1) v = mean + (v - mean) * cf;
        v = v + (bg[c]! - v) * fade;
        v = v + (bTarget - v) * ab;
      }
      px[o + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
    px[o + 3] = a;
  }
  const img: RasterImage = { width: src.width, height: src.height, pixels: px };
  cache.set(key, img);
  return img;
}

registerDrawer("IMAGE", (fe, ent, st) => {
  if (fe.env.rasterEntities === "omit") return;
  const e = ent as ImageEntity;
  if (e.size.x <= 0 || e.size.y <= 0) return;
  const clip = e.clipping && e.clipBoundary.length >= 2;
  const frame = frameMode(fe.doc, false) === 1;
  const def = e.imageDefHandle
    ? (fe.doc.getObject(e.imageDefHandle) as ImageDefObject | undefined)
    : undefined;
  const src = e.imageDefHandle ? DECODED.get(fe.doc)?.get(e.imageDefHandle) : undefined;
  const r = fe.resolve(e, st);
  if (src && def?.loaded !== false && (e.displayFlags & SHOW) !== 0) {
    const img = adjust(fe, e.imageDefHandle!, src, e, fe.color(r));
    const tri = region(fe, e, st, clip);
    // uv of a target point: invert the (projected) affine image placement
    const o = st.m.transformPoint(pixelToWcs(e, -0.5, e.size.y - 0.5));
    const pu = st.m.transformPoint(pixelToWcs(e, e.size.x - 0.5, e.size.y - 0.5));
    const pv = st.m.transformPoint(pixelToWcs(e, -0.5, -0.5));
    const ux = pu.x - o.x;
    const uy = pu.y - o.y;
    const vx = pv.x - o.x;
    const vy = pv.y - o.y;
    const det = ux * vy - uy * vx;
    if (Math.abs(det) > 1e-300 && tri.length >= 6) {
      const uv = new Float64Array(tri.length);
      for (let k = 0; k < tri.length; k += 2) {
        const dx = tri[k]! - o.x;
        const dy = tri[k + 1]! - o.y;
        const s = (dx * vy - dy * vx) / det;
        const t = (ux * dy - uy * dx) / det;
        uv[k] = s;
        uv[k + 1] = 1 - t;
      }
      fe.builder.imageTriangles(tri, uv, img, [255, 255, 255, 255]);
    }
  } else if (!src) fe.note(def ? "image-missing" : "image-no-imagedef");
  if (frame) drawFrame(fe, e, st, toTarget(e, pixelBoundary(e, clip), st.m));
});

registerDrawer("WIPEOUT", (fe, ent, st) => {
  if (fe.env.rasterEntities === "omit") return;
  const e = ent as WipeoutEntity;
  // WIPEOUT boundaries are normalized to the unit "pixel" (size 1 × 1), always clipped
  const ring = toTarget(e, pixelBoundary(e, e.clipBoundary.length >= 2), st.m);
  if ((e.displayFlags & SHOW) !== 0 || e.displayFlags === 0) {
    const [r, g, b] = fe.props.background;
    fe.fillRings([ring], [r, g, b, 255], FillRule.EvenOdd);
  }
  if (frameMode(fe.doc, true) === 1) drawFrame(fe, e, st, ring);
});
