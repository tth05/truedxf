// A tiny glyph description language compiled to SHX shape ops (used to build our own test fonts).
//
// Path syntax (absolute integer font units, y up, whitespace separated):
//   M x,y        pen up, move to (x,y)
//   L x,y        draw a line to (x,y)
//   B x,y,b      draw a bulge arc to (x,y); b = DXF bulge (encoded as round(b·127))
//   O r,s,c      octant arc from the current point: radius r, start octant s (45° steps CCW from
//                3 o'clock), c octants (negative = clockwise, ±8 = full circle)
//   F r,a0,a1    fractional arc from the current point: radius r, start/end angle in degrees
//                (a1 > a0 = counter-clockwise)
//   P / Q        push / pop the pen position
//   S n          subshape n (the pen is assumed to end at that glyph's advance)
//   s n          subshape n wrapped in push/pop (pen position unchanged; for foreign glyphs)
//   V dx,dy      vertical-text-only displacement (code 14 + 8), not tracked in the horizontal frame
// Every glyph gets AutoCAD's vertical-text idiom: `2,14,8,(-⌊adv/2⌋,-above)` at the start and
// `14,8,(-(adv-⌊adv/2⌋),-(below+2))` at the end, so fonts with modes = 2 stack vertically.

import { type ShapeOp, VECTOR_DIRECTIONS } from "../src/index.ts";

export interface GlyphDef {
  code: number;
  name?: string;
  advance: number;
  path: string;
}

export interface Metrics {
  above: number;
  below: number;
}

const EPS = 1e-6;

function vectorFor(dx: number, dy: number): ShapeOp | undefined {
  for (let dir = 0; dir < 16; dir++) {
    const [ux, uy] = VECTOR_DIRECTIONS[dir]!;
    const len = ux !== 0 ? dx / ux : dy / uy;
    if (!Number.isInteger(len) || len < 1 || len > 15) continue;
    if (ux * len === dx && uy * len === dy) return { op: "vector", length: len, dir };
  }
  return undefined;
}

/** Octant-arc end offset from the start point (same math as the interpreter). */
function arcDelta(r: number, a0deg: number, sweepDeg: number): [number, number] {
  const a0 = (a0deg * Math.PI) / 180;
  const a1 = ((a0deg + sweepDeg) * Math.PI) / 180;
  return [r * (Math.cos(a1) - Math.cos(a0)), r * (Math.sin(a1) - Math.sin(a0))];
}

/** Encodes a fractional arc like AutoCAD's 11,(so,eo,hr,r,±0SC) (note 04 §4.3). */
export function fracArcOp(r: number, a0: number, a1: number): Extract<ShapeOp, { op: "fracArc" }> {
  const u = 45 / 256;
  const cw = a1 < a0;
  let S: number;
  let so: number;
  let E: number;
  let eo: number;
  let C: number;
  if (!cw) {
    S = Math.floor(a0 / 45 + EPS);
    so = Math.round((a0 - 45 * S) / u);
    E = Math.ceil(a1 / 45 - EPS) - 1;
    eo = Math.round((a1 - 45 * E) / u);
    C = E - S + 1;
  } else {
    S = Math.ceil(a0 / 45 - EPS);
    so = Math.round((45 * S - a0) / u);
    E = Math.floor(a1 / 45 + EPS) + 1;
    eo = Math.round((45 * E - a1) / u);
    C = S - E + 1;
  }
  if (C < 1 || C > 8) throw new RangeError(`fractional arc spans ${C} octants`);
  return {
    op: "fracArc",
    startOffset: so,
    endOffset: eo === 256 ? 0 : eo,
    radius: r,
    start: ((S % 8) + 8) % 8,
    count: C === 8 ? 0 : C,
    cw,
  };
}

function fracSweep(o: Extract<ShapeOp, { op: "fracArc" }>): [number, number] {
  const u = 45 / 256;
  const count = o.count === 0 ? 8 : o.count;
  const eo = o.endOffset === 0 ? 256 : o.endOffset;
  const a0 = o.cw ? 45 * o.start - o.startOffset * u : 45 * o.start + o.startOffset * u;
  const a1 = o.cw ? 45 * (o.start - count + 1) - eo * u : 45 * (o.start + count - 1) + eo * u;
  let sweep = a1 - a0;
  if (!o.cw && sweep <= 0) sweep += 360;
  if (o.cw && sweep >= 0) sweep -= 360;
  return [a0, sweep];
}

export interface CompileGlyphOptions {
  metrics: Metrics;
  /** Advance of other glyphs (for `S` subshape calls). */
  advanceOf: (code: number) => number;
  /** Emit the vertical-text idiom (default true). */
  vertical?: boolean;
  /** Allow arcs that end off the integer grid (probe glyphs). Default false. */
  allowOffGrid?: boolean;
}

/** Compiles one glyph description to shape ops (without the terminating `end`). */
export function compileGlyph(g: GlyphDef, o: CompileGlyphOptions): ShapeOp[] {
  const ops: ShapeOp[] = [];
  const { above, below } = o.metrics;
  const vertical = o.vertical ?? true;
  const half = Math.floor(g.advance / 2);
  let x = 0;
  let y = 0;
  let pen = true;
  const stack: Array<[number, number]> = [];
  // Pending straight draws (merged into a code 9 list) and bulge arcs (code 13 list).
  let lines: Array<[number, number]> = [];
  let bulges: Array<[number, number, number]> = [];
  const flush = () => {
    if (lines.length === 1) ops.push({ op: "xy", dx: lines[0]![0], dy: lines[0]![1] });
    else if (lines.length > 1) ops.push({ op: "xyList", points: lines });
    lines = [];
    if (bulges.length === 1)
      ops.push({ op: "bulgeArc", dx: bulges[0]![0], dy: bulges[0]![1], bulge: bulges[0]![2] });
    else if (bulges.length > 1) ops.push({ op: "bulgeList", arcs: bulges });
    bulges = [];
  };
  const emit = (op: ShapeOp) => {
    flush();
    ops.push(op);
  };
  const penUp = () => {
    if (pen) emit({ op: "penUp" });
    pen = false;
  };
  const penDown = () => {
    if (!pen) emit({ op: "penDown" });
    pen = true;
  };
  const displacement = (dx: number, dy: number, draw: boolean) => {
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) throw new Error(`glyph ${g.code}: non-integer move`);
    if (dx === 0 && dy === 0) return;
    const v = vectorFor(dx, dy);
    if (v) {
      emit(v);
      return;
    }
    if (Math.abs(dx) > 127 || Math.abs(dy) > 127) throw new Error(`glyph ${g.code}: displacement too large`);
    if (draw) {
      if (bulges.length) flush();
      lines.push([dx, dy]);
    } else emit({ op: "xy", dx, dy });
  };
  const snap = (v: number): number => {
    const r = Math.round(v);
    if (Math.abs(v - r) > EPS && !o.allowOffGrid)
      throw new Error(`glyph ${g.code}: arc ends off the grid (${v})`);
    return r; // interpreter default: pen rounded to the grid after arcs
  };

  if (vertical) {
    penUp();
    emit({ op: "verticalOnly" });
    emit({ op: "xy", dx: -half, dy: -above });
  }
  const tokens = g.path.trim().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    const cmd = t[0]!;
    if (cmd === "S" && t !== tokens[tokens.length - 1]) throw new Error(`glyph ${g.code}: S must be last`);
    const args = t.slice(1) === "" ? [] : t.slice(1).split(",").map(Number);
    switch (cmd) {
      case "M": {
        penUp();
        displacement(args[0]! - x, args[1]! - y, false);
        x = args[0]!;
        y = args[1]!;
        break;
      }
      case "L": {
        penDown();
        displacement(args[0]! - x, args[1]! - y, true);
        x = args[0]!;
        y = args[1]!;
        break;
      }
      case "B": {
        penDown();
        const dx = args[0]! - x;
        const dy = args[1]! - y;
        const b = Math.round(args[2]! * 127);
        if (b === 0) displacement(dx, dy, true);
        else {
          if (lines.length) flush();
          bulges.push([dx, dy, b]);
        }
        x = args[0]!;
        y = args[1]!;
        break;
      }
      case "O": {
        penDown();
        const [r, s, c] = args as [number, number, number];
        const cw = c < 0;
        const n = Math.abs(c);
        emit({ op: "octantArc", radius: r, start: s, count: n === 8 ? 0 : n, cw });
        const [dx, dy] = arcDelta(r, 45 * s, (cw ? -45 : 45) * n);
        x = snap(x + dx);
        y = snap(y + dy);
        break;
      }
      case "F": {
        penDown();
        const op = fracArcOp(args[0]!, args[1]!, args[2]!);
        emit(op);
        const [a0, sweep] = fracSweep(op);
        const [dx, dy] = arcDelta(args[0]!, a0, sweep);
        x = snap(x + dx);
        y = snap(y + dy);
        break;
      }
      case "P":
        emit({ op: "push" });
        stack.push([x, y]);
        break;
      case "Q": {
        emit({ op: "pop" });
        const p = stack.pop();
        if (!p) throw new Error(`glyph ${g.code}: pop without push`);
        [x, y] = p;
        break;
      }
      case "V":
        penUp();
        emit({ op: "verticalOnly" });
        emit({ op: "xy", dx: args[0]!, dy: args[1]! });
        break;
      case "s":
        emit({ op: "push" });
        emit({ op: "subshape", shape: args[0]! });
        emit({ op: "pop" });
        pen = false;
        break;
      case "S": {
        const n = args[0]!;
        emit({ op: "subshape", shape: n });
        x += o.advanceOf(n);
        pen = false; // every glyph ends with the pen up
        break;
      }
      default:
        throw new Error(`glyph ${g.code}: unknown command ${t}`);
    }
  }
  const last = tokens[tokens.length - 1] ?? "";
  if (last.startsWith("S")) {
    // A trailing subshape supplies the advance and the vertical end move itself.
    if (x !== g.advance || y !== 0)
      throw new Error(`glyph ${g.code}: trailing subshape must end at the advance`);
    flush();
    return ops;
  }
  penUp();
  displacement(g.advance - x, -y, false);
  if (vertical) {
    emit({ op: "verticalOnly" });
    emit({ op: "xy", dx: -(g.advance - half), dy: -(below + 2) });
  }
  flush();
  return ops;
}
