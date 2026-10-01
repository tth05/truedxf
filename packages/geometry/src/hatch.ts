/**
 * Hatch engine: HATCH / MPOLYGON boundary loops → solid fill triangles and pattern lines.
 *
 * Input loops are already flattened (edge paths / bulge polylines → `flattenSubpath`) and
 * implicitly closed — every loop is closed for filling, even with 73 = 0 (note 06 §1.3.2).
 *
 * **Loop selection** (note 06 §1.5):
 * - style 0 normal: all loops; 1 outer: loops flagged external (1) or outermost (16);
 *   2 ignore: external loops only (ezdxf `rendering_paths`);
 * - if style ∈ {1, 2} and no loop carries the external flag (files from other writers), nothing
 *   is selected — AutoCAD plots nothing then (VERIFIED-BY-ACAD hatches/nested-*-zero-style1|2);
 *   `geometricFallback: true` selects by geometric nesting depth instead (dxf-viewer): outer →
 *   depth ≤ 1, ignore → depth 0;
 * - text-box loops (flag 8) are dropped by default (ezdxf#573); `textBoxes: "keep"` keeps them
 *   as holes (UNKNOWN which AutoCAD does, test H6).
 * The selected loops are then filled **even-odd** (odd parity; winding is irrelevant in AutoCAD
 * data). MPOLYGON ignores the style: select with style 0.
 *
 * **Pattern lines** (note 06 §1.6): the stored 53/43/44/45/46/49 data is final geometry (already
 * scaled/rotated, includes the hatch origin). For each definition line with direction
 * d = (cos a, sin a), normal n = (−sin a, cos a), base B and offset v, line k of the family is
 * `B + k·v + t·d`. Per family all loop vertices are rotated once into (t, c) = (p·d, p·n), so
 * line k is the horizontal `c = c₀ + k·(v·n)`; the k-range is taken from the vertices' c-range.
 * Crossings use the **half-open rule** `(c_p > c) ≠ (c_q > c)`: a vertex exactly on a hatch line
 * counts as lying below it (a symbolic +ε shift of the line along n). Consequences, all exact and
 * deterministic (no random jiggle as in ezdxf):
 * - a vertex where the boundary passes through the line counts once, a vertex where it only
 *   touches counts zero or two times;
 * - an edge collinear with a hatch line contributes no crossing; the line is drawn along it iff
 *   the region lies on the edge's +c side, e.g. along the bottom edge of a box but not the top
 *   edge (AutoCAD's choice UNKNOWN);
 * - line ends are computed from the edge's lower endpoint, so reversing a loop changes nothing.
 * Inside intervals come from even-odd parity (or nonzero winding) along the line; each is
 * dashed with the pattern anchored at the line's own origin `B + k·v` (u = t − (B + k·v)·d),
 * which shifts successive lines by v·d (note 06 §1.6.2 step 4). Dashes crossing the boundary
 * are cut at it; dots are kept when inside (boundary inclusive).
 *
 * Limits are counts, never time: if the total number of family lines over all definition lines
 * exceeds `maxLines` (default 100,000) or the emitted primitives exceed `maxPrimitives`, the
 * result is empty with `tooDense = true`. AutoCAD then plots **nothing** for the hatch, no solid
 * fill. VERIFIED-BY-ACAD 2026-10-01 (local hatch-probes/dense-lines-*: ANSI31 with 99,995 lines
 * plots, 100,001 lines plots nothing; dense-ansi37-*: 2 × 45k lines plot, 2 × 55k nothing, so
 * it is the total over the families; dense-thin-*: a thin strip with 150k lines is empty too, so
 * it is the line count, not the area; hatches/dense-count-30000 … 300000 are empty; note 06
 * §1.6.3). The primitive limit is ours (UNVERIFIED).
 *
 * Gradient fills are out of scope except the {@link HatchGradient} descriptor.
 */

import { cosSinDeg } from "./angle.ts";
import type { GridOptions } from "./clip.ts";
import { type DashPattern, walkPattern } from "./dash.ts";
import type { Affine2 } from "./matrix.ts";
import { FillRule, windingNumber } from "./polygon.ts";
import { triangulateFill } from "./triangulate.ts";
import type { Vec2 } from "./vec.ts";

export const HatchStyle = {
  Normal: 0,
  Outer: 1,
  Ignore: 2,
} as const;
export type HatchStyle = (typeof HatchStyle)[keyof typeof HatchStyle];

/** Boundary path flags (92), note 06 §1.3.1. */
export const HatchPathFlags = {
  EXTERNAL: 1,
  POLYLINE: 2,
  DERIVED: 4,
  TEXTBOX: 8,
  OUTERMOST: 16,
  NOT_CLOSED: 32,
  SELF_INTERSECTING: 64,
  TEXT_ISLAND: 128,
  DUPLICATE: 256,
} as const;

export interface HatchLoop {
  /** Flattened loop, interleaved xy, implicitly closed. */
  readonly points: Float64Array;
  /** Path flags (92). */
  readonly flags: number;
}

export interface HatchLoopSelectionOptions {
  /** Text-box loops (flag 8): `drop` (default, ezdxf) or `keep` as ordinary loops. */
  readonly textBoxes?: "drop" | "keep";
  /**
   * Fall back to geometric nesting when no loop is flagged external. Default false: AutoCAD
   * draws nothing for styles 1/2 without an external loop (VERIFIED-BY-ACAD
   * hatches/nested-*-zero-style1|2).
   */
  readonly geometricFallback?: boolean;
}

/** Representative sample vertices of a loop (≤ 16, evenly spaced, deterministic). */
function sampleVertices(r: Float64Array): number[] {
  const n = r.length >> 1;
  const step = Math.max(1, Math.floor(n / 16));
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  return out;
}

/**
 * Nesting depth of every loop: the number of other loops containing it, decided by a majority
 * vote of sample vertices (robust to loops that touch at a few vertices).
 */
export function loopNestingDepths(loops: readonly Float64Array[]): number[] {
  const depth = new Array<number>(loops.length).fill(0);
  for (let i = 0; i < loops.length; i++) {
    const r = loops[i]!;
    const samples = sampleVertices(r);
    if (samples.length === 0) continue;
    for (let j = 0; j < loops.length; j++) {
      if (i === j || loops[j]!.length < 6) continue;
      let inside = 0;
      for (const v of samples) if (windingNumber([loops[j]!], r[2 * v]!, r[2 * v + 1]!) !== 0) inside++;
      if (2 * inside > samples.length) depth[i]!++;
    }
  }
  return depth;
}

/** Indices of the loops that take part in filling / pattern clipping (module comment). */
export function selectHatchLoops(
  loops: readonly HatchLoop[],
  style: number,
  opts: HatchLoopSelectionOptions = {},
): number[] {
  const keepText = opts.textBoxes === "keep";
  const cand: number[] = [];
  for (let i = 0; i < loops.length; i++) {
    if (!keepText && loops[i]!.flags & HatchPathFlags.TEXTBOX) continue;
    if (loops[i]!.points.length < 6) continue;
    cand.push(i);
  }
  if (style !== HatchStyle.Outer && style !== HatchStyle.Ignore) return cand;
  const hasExternal = cand.some((i) => loops[i]!.flags & HatchPathFlags.EXTERNAL);
  if (hasExternal || opts.geometricFallback !== true) {
    const mask =
      style === HatchStyle.Outer
        ? HatchPathFlags.EXTERNAL | HatchPathFlags.OUTERMOST
        : HatchPathFlags.EXTERNAL;
    return cand.filter((i) => loops[i]!.flags & mask);
  }
  const depth = loopNestingDepths(cand.map((i) => loops[i]!.points));
  const maxDepth = style === HatchStyle.Outer ? 1 : 0;
  return cand.filter((_, k) => depth[k]! <= maxDepth);
}

export interface HatchSolidOptions extends HatchLoopSelectionOptions, GridOptions {
  /** Default even-odd (note 06 §1.5). */
  readonly fillRule?: FillRule;
}

/** Solid (or gradient-area) fill triangles of a hatch. */
export function hatchSolidTriangles(
  loops: readonly HatchLoop[],
  style: number,
  opts: HatchSolidOptions = {},
): Float64Array {
  const sel = selectHatchLoops(loops, style, opts);
  return triangulateFill(
    sel.map((i) => loops[i]!.points),
    { ...opts, fillRule: opts.fillRule ?? FillRule.EvenOdd },
  );
}

// ---- Pattern lines --------------------------------------------------------------------------

export interface HatchPatternLine {
  /** Line angle in degrees (53; includes the pattern angle 52). */
  readonly angle: number;
  /** Base point (43/44), OCS. */
  readonly base: Vec2;
  /** Offset between successive lines (45/46), OCS. */
  readonly offset: Vec2;
  /** Dash items (49): > 0 dash, < 0 gap, 0 dot; empty = continuous. */
  readonly dashes: readonly number[];
}

/**
 * Pattern line under an affine map (hatch inside a scaled / mirrored INSERT): base with the
 * full map, offset with the linear part, dashes scaled by the stretch along the line direction
 * (note 06 §1.6.1, ezdxf#1392/#1399/#1402). Exact for any non-degenerate affine map, since
 * parallel line families map to parallel line families.
 */
export function transformHatchPatternLine(line: HatchPatternLine, m: Affine2): HatchPatternLine {
  const [c, s] = cosSinDeg(line.angle);
  const d = m.applyVector({ x: c, y: s });
  const stretch = Math.hypot(d.x, d.y);
  return {
    angle: (Math.atan2(d.y, d.x) * 180) / Math.PI,
    base: m.apply(line.base),
    offset: m.applyVector(line.offset),
    dashes: line.dashes.map((x) => x * stretch),
  };
}

export interface HatchPatternOptions extends HatchLoopSelectionOptions {
  /** Default even-odd. */
  readonly fillRule?: FillRule;
  /** Max family lines over all definition lines. Default 100,000 (note 06 §1.6.3). */
  readonly maxLines?: number;
  /** Max emitted segments + dots. Default 10,000,000. */
  readonly maxPrimitives?: number;
}

export interface HatchPatternResult {
  /** Hairline segments `x0, y0, x1, y1`. */
  readonly segments: Float64Array;
  /** Dots `x, y`. */
  readonly dots: Float64Array;
  /** Number of family lines that were considered. */
  readonly lineCount: number;
  /** A count limit was exceeded; nothing was emitted (AutoCAD plots nothing then). */
  readonly tooDense: boolean;
}

export const DEFAULT_HATCH_MAX_LINES = 100_000;
export const DEFAULT_HATCH_MAX_PRIMITIVES = 10_000_000;

interface Family {
  readonly cx: number;
  readonly sy: number;
  readonly c0: number;
  readonly spacing: number;
  readonly shift: number;
  readonly t0: number;
  readonly kMin: number;
  readonly kMax: number;
  readonly pattern: DashPattern | undefined;
}

function family(line: HatchPatternLine, rings: readonly Float64Array[]): Family | undefined {
  const [cx, sy] = cosSinDeg(line.angle);
  let vx = line.offset.x;
  let vy = line.offset.y;
  let spacing = -vx * sy + vy * cx;
  if (spacing < 0) {
    // Same family with the opposite index direction.
    vx = -vx;
    vy = -vy;
    spacing = -spacing;
  }
  const c0 = -line.base.x * sy + line.base.y * cx;
  const t0 = line.base.x * cx + line.base.y * sy;
  const shift = vx * cx + vy * sy;
  let cmin = Number.POSITIVE_INFINITY;
  let cmax = Number.NEGATIVE_INFINITY;
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i += 2) {
      const c = -r[i]! * sy + r[i + 1]! * cx;
      if (c < cmin) cmin = c;
      if (c > cmax) cmax = c;
    }
  }
  if (!(cmax >= cmin)) return undefined;
  let kMin = 0;
  let kMax = -1;
  if (spacing > 0) {
    kMin = Math.ceil((cmin - c0) / spacing);
    kMax = Math.floor((cmax - c0) / spacing);
  } else if (cmin <= c0 && c0 <= cmax) {
    // Zero spacing: all lines coincide — infinitely dense unless the family is a single line.
    kMin = 0;
    kMax = Number.POSITIVE_INFINITY;
  }
  const P = line.dashes.reduce((a, x) => a + Math.abs(x), 0);
  const pattern =
    line.dashes.length > 0 && P > 0 ? { elements: line.dashes.map((l) => ({ length: l })) } : undefined;
  return { cx, sy, c0, spacing, shift, t0, kMin, kMax, pattern };
}

/** Total number of family lines crossing the loops' extent (for the HPMAXLINES test). */
export function hatchPatternLineCount(
  lines: readonly HatchPatternLine[],
  rings: readonly Float64Array[],
): number {
  let n = 0;
  for (const l of lines) {
    const f = family(l, rings);
    if (f && f.kMax >= f.kMin) n += f.kMax - f.kMin + 1;
  }
  return n;
}

interface Edge {
  readonly clo: number;
  readonly chi: number;
  readonly tlo: number;
  readonly thi: number;
  /** +1 if the edge runs towards +c, −1 otherwise (nonzero winding). */
  readonly w: number;
}

function familyEdges(f: Family, rings: readonly Float64Array[]): Edge[] {
  const edges: Edge[] = [];
  for (const r of rings) {
    const n = r.length >> 1;
    if (n < 2) continue;
    const ts = new Float64Array(n);
    const cs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = r[2 * i]!;
      const y = r[2 * i + 1]!;
      ts[i] = x * f.cx + y * f.sy;
      cs[i] = -x * f.sy + y * f.cx;
    }
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const cp = cs[i]!;
      const cq = cs[j]!;
      if (cp === cq) continue; // parallel to the lines: never crosses under the half-open rule
      if (cp < cq) edges.push({ clo: cp, chi: cq, tlo: ts[i]!, thi: ts[j]!, w: 1 });
      else edges.push({ clo: cq, chi: cp, tlo: ts[j]!, thi: ts[i]!, w: -1 });
    }
  }
  // Stable, deterministic order for the sweep.
  edges.sort((a, b) => a.clo - b.clo || a.chi - b.chi || a.tlo - b.tlo || a.thi - b.thi);
  return edges;
}

/** Generate the pattern lines of a hatch, clipped to the selected loops and dashed. */
export function hatchPatternLines(
  loops: readonly HatchLoop[],
  style: number,
  lines: readonly HatchPatternLine[],
  opts: HatchPatternOptions = {},
): HatchPatternResult {
  const sel = selectHatchLoops(loops, style, opts);
  const rings = sel.map((i) => loops[i]!.points);
  return hatchPatternLinesInRings(rings, lines, opts);
}

/** {@link hatchPatternLines} on an explicit ring set (no loop selection). */
export function hatchPatternLinesInRings(
  rings: readonly Float64Array[],
  lines: readonly HatchPatternLine[],
  opts: HatchPatternOptions = {},
): HatchPatternResult {
  const maxLines = opts.maxLines ?? DEFAULT_HATCH_MAX_LINES;
  const maxPrim = opts.maxPrimitives ?? DEFAULT_HATCH_MAX_PRIMITIVES;
  const evenOdd = (opts.fillRule ?? FillRule.EvenOdd) === FillRule.EvenOdd;
  const empty = (lineCount: number, tooDense: boolean): HatchPatternResult => ({
    segments: new Float64Array(0),
    dots: new Float64Array(0),
    lineCount,
    tooDense,
  });
  const fams = lines.map((l) => family(l, rings));
  let lineCount = 0;
  for (const f of fams) if (f && f.kMax >= f.kMin) lineCount += f.kMax - f.kMin + 1;
  if (!(lineCount <= maxLines) || !Number.isFinite(lineCount)) return empty(lineCount, true);

  const seg: number[] = [];
  const dots: number[] = [];
  let prims = 0;
  const xs: number[] = [];
  const ws: number[] = [];
  const order: number[] = [];
  for (const f of fams) {
    if (!f || f.kMax < f.kMin) continue;
    const edges = familyEdges(f, rings);
    let next = 0;
    let active: Edge[] = [];
    const toXY = (t: number, c: number, out: number[]) => out.push(t * f.cx - c * f.sy, t * f.sy + c * f.cx);
    for (let k = f.kMin; k <= f.kMax; k++) {
      const c = f.c0 + k * f.spacing;
      while (next < edges.length && edges[next]!.clo <= c) active.push(edges[next++]!);
      active = active.filter((e) => e.chi > c);
      if (active.length < 2) continue;
      xs.length = 0;
      ws.length = 0;
      for (const e of active) {
        // clo ≤ c < chi holds for every active edge: the half-open crossing rule.
        xs.push(e.tlo + ((c - e.clo) * (e.thi - e.tlo)) / (e.chi - e.clo));
        ws.push(e.w);
      }
      order.length = 0;
      for (let i = 0; i < xs.length; i++) order.push(i);
      order.sort((a, b) => xs[a]! - xs[b]! || ws[a]! - ws[b]!);
      // Inside intervals along the line.
      let wind = 0;
      let start = 0;
      const lineOrigin = f.t0 + k * f.shift;
      for (const i of order) {
        const before = evenOdd ? wind & 1 : wind;
        wind += evenOdd ? 1 : ws[i]!;
        const after = evenOdd ? wind & 1 : wind;
        if (before === 0 && after !== 0) start = xs[i]!;
        else if (before !== 0 && after === 0) {
          const end = xs[i]!;
          if (!(end > start)) continue;
          if (!f.pattern) {
            if (++prims > maxPrim) return empty(lineCount, true);
            toXY(start, c, seg);
            toXY(end, c, seg);
            continue;
          }
          const n = walkPattern(
            f.pattern,
            -lineOrigin,
            start,
            end,
            {
              dash: (a, b) => {
                toXY(a, c, seg);
                toXY(b, c, seg);
              },
              dot: (s) => toXY(s, c, dots),
            },
            maxPrim - prims,
          );
          if (n < 0) return empty(lineCount, true);
          prims += n;
        }
      }
    }
  }
  return { segments: Float64Array.from(seg), dots: Float64Array.from(dots), lineCount, tooDense: false };
}

// ---- Gradient (descriptor only) -------------------------------------------------------------

/** Gradient fill descriptor (450–470, note 06 §1.7). Rendering is out of scope here. */
export interface HatchGradient {
  /** 470: LINEAR, CYLINDER, INVCYLINDER, SPHERICAL, INVSPHERICAL, HEMISPHERICAL, … */
  readonly name: string;
  /** 460, radians. */
  readonly angle: number;
  /** 461: 0 centred … 1 shifted. */
  readonly shift: number;
  /** 452 = 1: single-colour gradient (second colour derived from the tint 462). */
  readonly singleColor: boolean;
  readonly tint: number;
  /** 463 position + resolved RGB (421) per colour. */
  readonly colors: readonly { readonly position: number; readonly rgb: number }[];
}
