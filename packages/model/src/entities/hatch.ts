/**
 * HATCH and MPOLYGON. research/notes/06-hatch-linetype-appearance.md §1.
 *
 * The AcDbHatch subclass is parsed positionally: codes 10/20/40/42/72/73/97 are reused by the
 * boundary-path, edge, spline, pattern and seed groups (§1.1 "parser gotchas"). All boundary,
 * pattern and seed coordinates are 2D in the hatch OCS (210); the Z of group 10 is the elevation.
 */
import { TagCursor } from "../cursor.ts";
import type { DxfRecord } from "../record.ts";
import { tagNum, xdataTags } from "../tags.ts";
import type { Point2, Point3 } from "../types.ts";
import { type EntityBase, type ParseContext, registerEntity } from "./common.ts";

const Z = Object.freeze({ x: 0, y: 0, z: 1 });
const O = Object.freeze({ x: 0, y: 0, z: 0 });

/** Boundary path flags (92), note 06 §1.3.1. */
export const HatchPathFlags = {
  External: 1,
  Polyline: 2,
  Derived: 4,
  Textbox: 8,
  Outermost: 16,
  NotClosed: 32,
  SelfIntersecting: 64,
  TextIsland: 128,
  Duplicate: 256,
} as const;

export interface HatchLineEdge {
  readonly type: "line";
  readonly start: Point2;
  readonly end: Point2;
}

/**
 * Circular arc edge. Angles in **degrees** as stored. With `ccw = false` AutoCAD stores the
 * complementary angles: the CCW representation is 360−end … 360−start, traversed backwards
 * (note 06 §1.3.3, ezdxf#175).
 */
export interface HatchArcEdge {
  readonly type: "arc";
  readonly center: Point2;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly ccw: boolean;
}

/** Elliptic arc edge; `majorAxis` is relative to the center, `ratio` = minor/major. Angles as for arcs. */
export interface HatchEllipseEdge {
  readonly type: "ellipse";
  readonly center: Point2;
  readonly majorAxis: Point2;
  readonly ratio: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly ccw: boolean;
}

export interface HatchSplineEdge {
  readonly type: "spline";
  readonly degree: number;
  readonly rational: boolean;
  readonly periodic: boolean;
  readonly knots: readonly number[];
  readonly controlPoints: readonly Point2[];
  /** One weight per control point when rational (42 after each control point), else []. */
  readonly weights: readonly number[];
  /** R2010+ fit data (97 count + 11/21); render control points/knots, fit points only as fallback. */
  readonly fitPoints: readonly Point2[];
  readonly startTangent: Point2 | undefined;
  readonly endTangent: Point2 | undefined;
}

export type HatchEdge = HatchLineEdge | HatchArcEdge | HatchEllipseEdge | HatchSplineEdge;

export interface HatchPolylineVertex {
  readonly x: number;
  readonly y: number;
  /** Bulge of the segment starting at this vertex (tan(θ/4), positive = CCW). */
  readonly bulge: number;
}

export interface HatchPolylinePath {
  readonly kind: "polyline";
  /** Group 92 (bit 2 set). */
  readonly flags: number;
  /** Group 73. Open paths still fill as closed (note 06 §1.3.2). */
  readonly closed: boolean;
  readonly hasBulge: boolean;
  readonly vertices: readonly HatchPolylineVertex[];
  readonly sourceHandles: readonly string[];
}

export interface HatchEdgePath {
  readonly kind: "edges";
  readonly flags: number;
  readonly edges: readonly HatchEdge[];
  readonly sourceHandles: readonly string[];
}

export type HatchPath = HatchPolylinePath | HatchEdgePath;

/** Pattern definition line; already scaled and rotated (note 06 §1.6.1). OCS. */
export interface HatchPatternLine {
  /** Degrees (includes the pattern angle 52). */
  readonly angle: number;
  readonly base: Point2;
  /** Offset between adjacent lines, in OCS (already rotated). */
  readonly offset: Point2;
  /** >0 dash, <0 gap, 0 dot; [] = continuous. */
  readonly dashes: readonly number[];
}

export interface HatchGradientColor {
  /** 463: 0 first / 1 second. */
  readonly position: number | undefined;
  readonly aci: number | undefined;
  /** 421 0xRRGGBB (authoritative, note 06 §1.7). */
  readonly rgb: number | undefined;
}

export interface HatchGradient {
  /** 450: 0 solid, 1 gradient. */
  readonly kind: number;
  /** 452: 1 single-color gradient. */
  readonly oneColor: boolean;
  /** 453 */
  readonly colorCount: number;
  /** 460, **radians**. */
  readonly rotation: number;
  /** 461: 0 centered … 1 shifted. */
  readonly shift: number;
  /** 462 tint for single-color gradients. */
  readonly tint: number;
  readonly colors: readonly HatchGradientColor[];
  /** 470: LINEAR, CYLINDER, INVCYLINDER, SPHERICAL, … (default LINEAR). */
  readonly name: string;
}

/** Fields shared by HATCH and MPOLYGON. */
export interface HatchProps {
  /** Group 10 (X = Y = 0; Z = elevation), OCS. */
  readonly elevationPoint: Point3;
  readonly elevation: number;
  readonly extrusion: Point3;
  /** Pattern name as written (may carry an island-style suffix like "SOLID,_O"). */
  readonly patternName: string;
  /** HATCH 70 / MPOLYGON 71: solid fill (also set for gradients). */
  readonly solid: boolean;
  readonly paths: readonly HatchPath[];
  /** 75: 0 normal (odd parity), 1 outer, 2 ignore. MPOLYGON renders all paths. */
  readonly style: number;
  /** 76: 0 user-defined, 1 predefined, 2 custom. */
  readonly patternType: number;
  /** 52, degrees (informational; lines are already rotated). */
  readonly patternAngle: number;
  /** 41 (informational; lines are already scaled). */
  readonly patternScale: number;
  readonly patternDouble: boolean;
  readonly patternLines: readonly HatchPatternLine[];
  readonly pixelSize: number | undefined;
  /** Seed points (OCS); they do not define the pattern origin (note 06 §1.4). */
  readonly seeds: readonly Point2[];
  readonly gradient: HatchGradient | undefined;
  /**
   * Raw color of the pattern background (XDATA HATCHBACKGROUNDCOLOR 1071, 0xC2rrggbb true color,
   * 0xC3…aci, note 06 §1.10); undefined if absent.
   */
  readonly backgroundColor: number | undefined;
}

export interface HatchEntity extends EntityBase, HatchProps {
  readonly type: "HATCH";
  /** 71 = 1: associative (render never uses the source objects, note 06 §1.3.4). */
  readonly associative: boolean;
}

export interface MPolygonEntity extends EntityBase, HatchProps {
  readonly type: "MPOLYGON";
  /** 70 */
  readonly version: number;
  /** 63 fill color ACI (R2004+); BYLAYER when absent. */
  readonly fillColor: number;
  /** 73 */
  readonly annotatedBoundary: boolean;
  /** 11 offset vector. */
  readonly offsetVector: Point2;
  /** 99 */
  readonly degenerateLoops: number;
}

// ---- paths ------------------------------------------------------------------------------

function readPolylinePath(c: TagCursor, flags: number): HatchPolylinePath {
  let hasBulge = false;
  let closed = true;
  // HATCH writes 72 then 73, MPOLYGON 73 then 72 (note 06 §1.3.2)
  while (c.code() === 72 || c.code() === 73) {
    if (c.code() === 72) hasBulge = c.bool();
    else closed = c.bool();
  }
  const n = c.code() === 93 ? c.int() : 0;
  const vertices: HatchPolylineVertex[] = [];
  for (let k = 0; k < n && c.code() === 10; k++) {
    const p = c.point2();
    const bulge = c.code() === 42 ? c.num() : 0;
    vertices.push({ x: p.x, y: p.y, bulge });
  }
  // tolerate files whose vertex count is too small
  while (c.code() === 10) {
    const p = c.point2();
    vertices.push({ x: p.x, y: p.y, bulge: c.code() === 42 ? c.num() : 0 });
  }
  return { kind: "polyline", flags, closed, hasBulge, vertices, sourceHandles: readSources(c) };
}

function readSources(c: TagCursor): string[] {
  const out: string[] = [];
  if (c.code() !== 97) return out;
  const n = c.int();
  for (let k = 0; k < n && c.code() === 330; k++) out.push(c.handle());
  return out;
}

/** Reads fixed-layout edge fields: each code at most once, in any order. */
function readFixed(c: TagCursor, codes: readonly number[]): Map<number, Point2 | number> {
  const got = new Map<number, Point2 | number>();
  while (codes.includes(c.code()) && !got.has(c.code())) {
    const code = c.code();
    got.set(code, code === 10 || code === 11 ? c.point2() : c.num());
  }
  return got;
}

const P0 = Object.freeze({ x: 0, y: 0 });

function readEdge(c: TagCursor, type: number, last: boolean): HatchEdge | undefined {
  switch (type) {
    case 1: {
      const f = readFixed(c, [10, 11]);
      return { type: "line", start: (f.get(10) as Point2) ?? P0, end: (f.get(11) as Point2) ?? P0 };
    }
    case 2: {
      const f = readFixed(c, [10, 40, 50, 51, 73]);
      return {
        type: "arc",
        center: (f.get(10) as Point2) ?? P0,
        radius: (f.get(40) as number) ?? 0,
        startAngle: (f.get(50) as number) ?? 0,
        endAngle: (f.get(51) as number) ?? 360,
        ccw: ((f.get(73) as number) ?? 1) !== 0,
      };
    }
    case 3: {
      const f = readFixed(c, [10, 11, 40, 50, 51, 73]);
      return {
        type: "ellipse",
        center: (f.get(10) as Point2) ?? P0,
        majorAxis: (f.get(11) as Point2) ?? { x: 1, y: 0 },
        ratio: (f.get(40) as number) ?? 1,
        startAngle: (f.get(50) as number) ?? 0,
        endAngle: (f.get(51) as number) ?? 360,
        ccw: ((f.get(73) as number) ?? 1) !== 0,
      };
    }
    case 4:
      return readSplineEdge(c, last);
    default:
      return undefined;
  }
}

function readSplineEdge(c: TagCursor, last: boolean): HatchSplineEdge {
  const degree = c.optInt(94, 3);
  const rational = c.code() === 73 ? c.bool() : false;
  const periodic = c.code() === 74 ? c.bool() : false;
  const nKnots = c.optInt(95, -1);
  const nCtrl = c.optInt(96, -1);
  const knots: number[] = [];
  while (c.code() === 40 && (nKnots < 0 || knots.length < nKnots)) knots.push(c.num());
  while (c.code() === 40) knots.push(c.num());
  const controlPoints: Point2[] = [];
  const weights: number[] = [];
  while (c.code() === 10 && (nCtrl < 0 || controlPoints.length < nCtrl)) {
    controlPoints.push(c.point2());
    // weights are 42 in DXF; some writers use 40 (the DWG code) after each control point
    if (c.code() === 42 || (c.code() === 40 && rational)) weights.push(c.num());
  }
  const fitPoints: Point2[] = [];
  let startTangent: Point2 | undefined;
  let endTangent: Point2 | undefined;
  // 97 after the control points is the R2010+ fit-point count, unless it is the source-object
  // count that follows the path's last edge (note 06 §1.3.3 spline edges, §1.3.4).
  if (c.code() === 97) {
    const next = c.peek(1);
    const isFit = !last || next === 11 || next === 12 || next === 13 || next === 97;
    if (isFit) {
      const n = c.int();
      for (let k = 0; k < n && c.code() === 11; k++) fitPoints.push(c.point2());
    }
  }
  if (c.code() === 12) startTangent = c.point2();
  if (c.code() === 13) endTangent = c.point2();
  return {
    type: "spline",
    degree,
    rational,
    periodic,
    knots,
    controlPoints,
    weights,
    fitPoints,
    startTangent,
    endTangent,
  };
}

function readEdgePath(c: TagCursor, flags: number): HatchEdgePath {
  const n = c.code() === 93 ? c.int() : 0;
  const edges: HatchEdge[] = [];
  for (let k = 0; k < n && c.code() === 72; k++) {
    const type = c.int();
    const e = readEdge(c, type, k === n - 1);
    if (e) edges.push(e);
  }
  return { kind: "edges", flags, edges, sourceHandles: readSources(c) };
}

function readPaths(c: TagCursor, n: number): HatchPath[] {
  const paths: HatchPath[] = [];
  for (let k = 0; k < n && c.code() === 92; k++) {
    const flags = c.int();
    paths.push(flags & HatchPathFlags.Polyline ? readPolylinePath(c, flags) : readEdgePath(c, flags));
  }
  return paths;
}

// ---- pattern, gradient -----------------------------------------------------------------

function readPatternLines(c: TagCursor, n: number): HatchPatternLine[] {
  const lines: HatchPatternLine[] = [];
  for (let k = 0; k < n && c.code() === 53; k++) {
    const f = new Map<number, number>();
    while ([53, 43, 44, 45, 46, 79].includes(c.code()) && !f.has(c.code())) f.set(c.code(), c.num());
    const nd = f.get(79) ?? 0;
    const dashes: number[] = [];
    while (c.code() === 49 && dashes.length < Math.max(nd, 0)) dashes.push(c.num());
    lines.push({
      angle: f.get(53) ?? 0,
      base: { x: f.get(43) ?? 0, y: f.get(44) ?? 0 },
      offset: { x: f.get(45) ?? 0, y: f.get(46) ?? 0 },
      dashes,
    });
  }
  return lines;
}

const GRADIENT_CODES = [451, 452, 453, 460, 461, 462, 463, 63, 421, 470];

function readGradient(c: TagCursor): HatchGradient {
  const kind = c.int();
  let oneColor = false;
  let colorCount = 0;
  let rotation = 0;
  let shift = 0;
  let tint = 0;
  let name = "LINEAR";
  const colors: { position: number | undefined; aci: number | undefined; rgb: number | undefined }[] = [];
  const current = () => {
    let cur = colors[colors.length - 1];
    if (!cur) colors.push((cur = { position: undefined, aci: undefined, rgb: undefined }));
    return cur;
  };
  while (GRADIENT_CODES.includes(c.code())) {
    switch (c.code()) {
      case 452:
        oneColor = c.bool();
        break;
      case 453:
        colorCount = c.int();
        break;
      case 460:
        rotation = c.num();
        break;
      case 461:
        shift = c.num();
        break;
      case 462:
        tint = c.num();
        break;
      case 463:
        colors.push({ position: c.num(), aci: undefined, rgb: undefined });
        break;
      case 63: {
        const cur = current();
        // a second 63 without 463 starts a new color (ezdxf gradient loader)
        if (cur.aci !== undefined) colors.push({ position: undefined, aci: c.int(), rgb: undefined });
        else cur.aci = c.int();
        break;
      }
      case 421: {
        const cur = current();
        if (cur.rgb !== undefined) colors.push({ position: undefined, aci: undefined, rgb: c.int() });
        else cur.rgb = c.int();
        break;
      }
      case 470:
        name = c.str().trim() || "LINEAR";
        break;
      default:
        c.skip();
    }
  }
  return { kind, oneColor, colorCount, rotation, shift, tint, colors, name };
}

// ---- entity ------------------------------------------------------------------------------

interface ParsedHatch extends HatchProps {
  code70: number;
  code71: number;
  fillColor: number;
  annotatedBoundary: boolean;
  offsetVector: Point2;
  degenerateLoops: number;
}

function parseHatchData(rec: DxfRecord, subclass: string): ParsedHatch {
  const c = TagCursor.subclass(rec, subclass);
  let elevationPoint: Point3 = O;
  let extrusion: Point3 = Z;
  let patternName = "";
  let code70 = 0;
  let code71 = 0;
  let paths: HatchPath[] = [];
  let pathsRead = false;
  let style = 0;
  let patternType = 1;
  let patternAngle = 0;
  let patternScale = 1;
  let patternDouble = false;
  let patternLines: HatchPatternLine[] = [];
  let pixelSize: number | undefined;
  const seeds: Point2[] = [];
  let gradient: HatchGradient | undefined;
  let fillColor = 256;
  let annotatedBoundary = false;
  let offsetVector: Point2 = { x: 0, y: 0 };
  let degenerateLoops = 0;
  while (!c.done) {
    switch (c.code()) {
      case 10:
        if (!pathsRead) elevationPoint = c.point();
        else c.point();
        break;
      case 210:
        extrusion = c.point();
        break;
      case 2:
        patternName = c.str().trim();
        break;
      case 70:
        code70 = c.int();
        break;
      case 71:
        code71 = c.int();
        break;
      case 91: {
        const n = c.int();
        if (!pathsRead) paths = readPaths(c, n);
        pathsRead = true;
        break;
      }
      case 75:
        style = c.int();
        break;
      case 76:
        patternType = c.int();
        break;
      case 52:
        patternAngle = c.num();
        break;
      case 41:
        patternScale = c.num();
        break;
      case 77:
        patternDouble = c.bool();
        break;
      case 78:
        patternLines = readPatternLines(c, c.int());
        break;
      case 47:
        pixelSize = c.num();
        break;
      case 98: {
        const n = c.int();
        for (let k = 0; k < n && c.code() === 10; k++) seeds.push(c.point2());
        break;
      }
      case 450:
        gradient = readGradient(c);
        break;
      case 63:
        fillColor = c.int();
        break;
      case 73:
        annotatedBoundary = c.bool();
        break;
      case 11:
        offsetVector = c.point2();
        break;
      case 99:
        degenerateLoops = c.int();
        break;
      default:
        c.skip();
    }
  }
  let backgroundColor: number | undefined;
  const bg = xdataTags(rec, "HATCHBACKGROUNDCOLOR").find((t) => t.code === 1071);
  if (bg) backgroundColor = tagNum(bg);
  return {
    elevationPoint,
    elevation: elevationPoint.z,
    extrusion,
    patternName,
    solid: false,
    paths,
    style,
    patternType,
    patternAngle,
    patternScale,
    patternDouble,
    patternLines,
    pixelSize,
    seeds,
    gradient,
    backgroundColor,
    code70,
    code71,
    fillColor,
    annotatedBoundary,
    offsetVector,
    degenerateLoops,
  };
}

function hatchProps(p: ParsedHatch, solid: boolean): HatchProps {
  return {
    elevationPoint: p.elevationPoint,
    elevation: p.elevation,
    extrusion: p.extrusion,
    patternName: p.patternName,
    solid,
    paths: p.paths,
    style: p.style,
    patternType: p.patternType,
    patternAngle: p.patternAngle,
    patternScale: p.patternScale,
    patternDouble: p.patternDouble,
    patternLines: p.patternLines,
    pixelSize: p.pixelSize,
    seeds: p.seeds,
    gradient: p.gradient,
    backgroundColor: p.backgroundColor,
  };
}

export function parseHatch(rec: DxfRecord, base: EntityBase, _ctx?: ParseContext): HatchEntity {
  const p = parseHatchData(rec, "AcDbHatch");
  return { ...base, ...hatchProps(p, p.code70 !== 0), type: "HATCH", associative: p.code71 !== 0 };
}

export function parseMPolygon(rec: DxfRecord, base: EntityBase): MPolygonEntity {
  const p = parseHatchData(rec, "AcDbMPolygon");
  return {
    ...base,
    ...hatchProps(p, p.code71 !== 0),
    type: "MPOLYGON",
    version: p.code70,
    fillColor: p.fillColor,
    annotatedBoundary: p.annotatedBoundary,
    offsetVector: p.offsetVector,
    degenerateLoops: p.degenerateLoops,
  };
}

registerEntity("HATCH", parseHatch);
registerEntity("MPOLYGON", parseMPolygon);
