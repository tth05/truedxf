/**
 * XCLIP: clipping of block references by a SPATIAL_FILTER (INSERT xdict ACAD_FILTER → SPATIAL,
 * note 07 §7). The boundary is stored in the clip-boundary system; the first matrix of the
 * filter (inverse INSERT transform at clip time) maps it into block coordinates, the current
 * INSERT transform (without MINSERT cell offsets) maps it to the target.
 *
 * VERIFIED-BY-ACAD (xclip suite, 2026-09-30; note 07 §7.5):
 * - The clip follows the block when the INSERT is moved/rotated/scaled/mirrored afterwards
 *   (xclip/after-clip-*), both storage styles (rect-block, rect-acad).
 * - MINSERT: one clip for the whole array, placed with the INSERT transform of cell (0,0); the
 *   other cells are clipped by that same region (xclip/minsert).
 * - Clipping disabled (71 = 0): content unclipped and no frame (disabled-frame-*).
 * - $XCLIPFRAME (header; a DICTIONARYVAR XCLIPFRAME is ignored, dictvar-*): R2010+ 280
 *   0 = no frame, 1 = frame plotted, 2 = frame displayed but not plotted; R2004/R2007 290 bool
 *   1 = plotted (a value 2 there makes AutoCAD reject the file).
 * - The second matrix maps the clip-time WCS into the boundary system: block points =
 *   inverse-insert · second⁻¹ · boundary (transform-matrix-*; the identity matrix is the norm).
 * - ATTRIBs: the 2026-10-01 reference of xclip/attrib-outside clips them with the INSERT; this
 *   renderer still draws them unclipped (note 07 §7.5, docs/TODO.md).
 */
import { DashUnits, degToRad, Matrix44, ocsToWcsMatrix } from "@truedxf/geometry";
import type {
  DictionaryObject,
  DxfDocument,
  Entity,
  InsertEntity,
  SpatialFilterObject,
} from "@truedxf/model";
import { type DrawState, type Frontend, setBlockClipHook } from "../frontend.ts";

/** The enabled or disabled SPATIAL_FILTER of an INSERT, if any. */
export function spatialFilter(doc: DxfDocument, e: Entity): SpatialFilterObject | undefined {
  if (!e.extensionDictionary) return undefined;
  const xd = doc.getObject(e.extensionDictionary) as DictionaryObject | undefined;
  if (xd?.type !== "DICTIONARY") return undefined;
  const fh = xd.get("ACAD_FILTER");
  const fd = fh ? (doc.getObject(fh) as DictionaryObject | undefined) : undefined;
  if (fd?.type !== "DICTIONARY") return undefined;
  const sh = fd.get("SPATIAL");
  const sf = sh ? doc.getObject(sh) : undefined;
  return sf?.type === "SPATIAL_FILTER" ? (sf as SpatialFilterObject) : undefined;
}

/** 3×4 row-major (translation in the 4th column) → Matrix44. */
function rows34(v: readonly number[]): Matrix44 {
  return Matrix44.fromRows(
    v[0]!,
    v[1]!,
    v[2]!,
    v[3]!,
    v[4]!,
    v[5]!,
    v[6]!,
    v[7]!,
    v[8]!,
    v[9]!,
    v[10]!,
    v[11]!,
    0,
    0,
    0,
    1,
  );
}

/** Block → WCS transform of an INSERT (cell (0,0) of a MINSERT). */
export function insertMatrix(doc: DxfDocument, ins: InsertEntity): Matrix44 {
  const block = doc.getBlock(ins.blockName);
  const base = block?.basePoint ?? { x: 0, y: 0, z: 0 };
  return Matrix44.product(
    ocsToWcsMatrix(ins.extrusion),
    Matrix44.translation(ins.insert.x, ins.insert.y, ins.insert.z),
    Matrix44.rotationZ(degToRad(ins.rotation)),
    Matrix44.scaling(ins.scale.x, ins.scale.y, ins.scale.z),
    Matrix44.translation(-base.x, -base.y, -base.z),
  );
}

/** Boundary polygon in block coordinates (closed, without a repeated last vertex). */
export function blockBoundary(sf: SpatialFilterObject): { x: number; y: number; z: number }[] {
  let pts = sf.boundary.map((p) => ({ x: p.x, y: p.y }));
  if (pts.length === 2) {
    // two points = axis-aligned rectangle in the boundary system
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    pts = [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y },
    ];
  }
  const n = pts.length;
  if (n > 2 && pts[0]!.x === pts[n - 1]!.x && pts[0]!.y === pts[n - 1]!.y) pts = pts.slice(0, -1);
  // second matrix: (clip-time WCS) → boundary system; the boundary goes back through its inverse
  // (VERIFIED-BY-ACAD xclip/transform-matrix-*)
  const toWcs = rows34(sf.clipMatrix).invert() ?? Matrix44.identity();
  const m = rows34(sf.inverseInsertMatrix).multiply(toWcs);
  return pts.map((p) => m.transformPoint({ x: p.x, y: p.y, z: 0 }));
}

/** Frame visibility for plots from $XCLIPFRAME (see module comment). */
function framePlotted(doc: DxfDocument): boolean {
  return doc.header.num("$XCLIPFRAME", 2) === 1;
}

function clipHook(fe: Frontend, parent: Entity, st: DrawState): (() => void) | undefined {
  if (parent.type !== "INSERT") return undefined;
  const sf = spatialFilter(fe.doc, parent);
  if (!sf?.enabled || sf.boundary.length < 2) return undefined;
  const m = st.m.multiply(insertMatrix(fe.doc, parent));
  const pts = blockBoundary(sf).map((p) => m.transformPoint(p));
  if (pts.length < 3) return undefined;
  const ring = new Float64Array(pts.length * 2);
  pts.forEach((p, k) => {
    ring[k * 2] = p.x;
    ring[k * 2 + 1] = p.y;
  });
  if (!fe.caches.has(`xclip-frame:${parent.handle}:${st.stack.join("/")}`) && framePlotted(fe.doc)) {
    // one frame per reference (not per MINSERT cell), drawn with the INSERT's properties
    fe.caches.set(`xclip-frame:${parent.handle}:${st.stack.join("/")}`, true);
    const segments = pts.map((p, k) => ({
      kind: "line" as const,
      p0: { x: p.x, y: p.y },
      p1: { x: pts[(k + 1) % pts.length]!.x, y: pts[(k + 1) % pts.length]!.y },
    }));
    fe.strokePath({ subpaths: [{ segments, closed: true }] }, fe.resolve(parent, st), parent, st, {
      units: DashUnits.PerSegment,
    });
  }
  // a line on a polygon edge is dropped, on a 2-point rectangle's edge it stays (note 07 §7.5)
  fe.pushClip([ring], { dropOnBoundary: sf.boundary.length > 2 });
  if (sf.frontClip !== undefined || sf.backClip !== undefined) {
    // front/back planes along the clip normal (boundary-system z): front keeps z ≤ 40, back
    // keeps z ≥ 41 (VERIFIED-BY-ACAD xclip/frontback-*). Entity-level culling of the direct block
    // content only; entities crossing a plane are kept whole (AutoCAD cuts them).
    const toClip = rows34(sf.clipMatrix).multiply(
      rows34(sf.inverseInsertMatrix).invert() ?? Matrix44.identity(),
    );
    const lo = sf.backClip ?? Number.NEGATIVE_INFINITY;
    const hi = sf.frontClip ?? Number.POSITIVE_INFINITY;
    const depth = st.stack.length + 1;
    const filter = (e: Entity, cst: DrawState) =>
      cst.stack.length !== depth || depthOverlaps(e, (p) => toClip.transformPoint(p).z, lo, hi);
    fe.entityFilters.push(filter);
    return () => {
      fe.entityFilters.pop();
      fe.popClip();
    };
  }
  return () => fe.popClip();
}

/**
 * True if the entity has no 3D points or the depth range of its (top-level) 3D points overlaps
 * [lo, hi] — entities crossing a plane are kept whole (UNVERIFIED approximation; AutoCAD cuts).
 */
export function depthOverlaps(
  e: Entity,
  depth: (p: { x: number; y: number; z: number }) => number,
  lo: number,
  hi: number,
): boolean {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const visit = (v: unknown, level: number): void => {
    if (level > 2 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, level + 1);
      return;
    }
    const p = v as { x?: unknown; y?: unknown; z?: unknown };
    if (typeof p.x === "number" && typeof p.y === "number" && typeof p.z === "number") {
      const k = depth(p as { x: number; y: number; z: number });
      if (k < min) min = k;
      if (k > max) max = k;
      return;
    }
    if (level > 0) for (const x of Object.values(v)) visit(x, level + 1);
  };
  for (const [key, v] of Object.entries(e)) {
    if (key === "extrusion" || key === "record") continue;
    visit(v, 0);
  }
  if (min > max) return true;
  return max >= lo - 1e-9 && min <= hi + 1e-9;
}

setBlockClipHook(clipHook);
