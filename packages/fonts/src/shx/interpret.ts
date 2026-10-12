// SHX shape interpreter: executes decoded shape ops into strokes (note 04 §4.3).

import { bulgeToArc } from "../geom.ts";
import type { Stroke, StrokeVertex } from "../types.ts";
import { disassemble, type ShapeOp, VECTOR_DIRECTIONS } from "./bytecode.ts";
import type { ShxKind } from "./format.ts";

/**
 * Pen rounding (note 04 §4.3 "Rounding hypothesis"): re-simulating ezdxf's test glyphs with the pen
 * rounded to integer shape units after every arc reproduces the exact integer end positions, which
 * strongly suggests AutoCAD keeps the pen on an integer grid. UNKNOWN whether it applies after arcs
 * only or after every command, so it is configurable:
 * - `none`: exact float arithmetic;
 * - `arcs` (default): round the pen after octant (0x0A) and fractional (0x0B) arcs — the only
 *   commands whose end points can leave the grid at scale 1;
 * - `all`: round after every movement.
 * Rounded arcs keep their start point and sweep angle and end exactly at the rounded point (the
 * bulge is unchanged, the radius adapts minimally), so strokes stay continuous.
 */
export type PenRounding = "none" | "arcs" | "all";

export interface InterpretOptions {
    /** Execute code 0x0E commands (vertical text). Only honoured for fonts with modes = 2. */
    vertical?: boolean;
    penRounding?: PenRounding;
    /** Grid in font units the pen is rounded to (default 1). */
    penGrid?: number;
    /** Maximum subshape nesting (count-based, deterministic). Default 16. */
    maxDepth?: number;
    /**
     * Segments per full circle used when an arc must be flattened because the current transform is
     * non-uniform (extended bigfont subshapes only). Default 64.
     */
    anisotropicArcSegments?: number;
}

/** Source of shapes for subshape references. */
export interface ShapeSource {
    /** Kind of the SHX file the shapes come from. */
    readonly fileKind: ShxKind;
    /** `modes` of the font (2 = vertical capable). */
    readonly modes: number;
    /** Extended bigfont primitive cell, if any. */
    readonly cell?: { height: number; width: number } | undefined;
    ops(shape: number): readonly ShapeOp[] | undefined;
}

export interface InterpretResult {
    strokes: Stroke[];
    /** Final pen position = advance (note 04 §4.4). */
    endX: number;
    endY: number;
    warnings: string[];
}

const DEG = Math.PI / 180;

class Machine {
    x = 0;
    y = 0;
    pen = true; // "Draw is activated at the start of each shape" (ADSK)
    scale = 1;
    // Extra non-uniform factors, only != 1 inside extended bigfont subshapes.
    sx = 1;
    sy = 1;
    readonly stack: Array<[number, number]> = [];
    readonly strokes: Stroke[] = [];
    current: StrokeVertex[] | undefined;
    readonly warnings: string[] = [];
    readonly source: ShapeSource;
    readonly vertical: boolean;
    readonly rounding: PenRounding;
    readonly grid: number;
    readonly maxDepth: number;
    readonly anisoSegments: number;

    constructor(source: ShapeSource, o: InterpretOptions) {
        this.source = source;
        this.vertical = (o.vertical ?? false) && source.modes === 2;
        this.rounding = o.penRounding ?? "arcs";
        this.grid = o.penGrid ?? 1;
        this.maxDepth = o.maxDepth ?? 16;
        this.anisoSegments = o.anisotropicArcSegments ?? 64;
    }

    private snap(v: number): number {
        const g = this.grid;
        const r = Math.round(v / g) * g;
        return r === 0 ? 0 : r; // no -0
    }

    endStroke(): void {
        if (this.current && this.current.length > 0) this.strokes.push({ vertices: this.current });
        this.current = undefined;
    }

    /** Moves the pen to (nx, ny); draws a segment with `bulge` when the pen is down. */
    moveTo(nx: number, ny: number, bulge = 0, round = false): void {
        if (round || this.rounding === "all") {
            nx = this.snap(nx);
            ny = this.snap(ny);
        }
        if (this.pen) {
            if (!this.current) this.current = [{ x: this.x, y: this.y, bulge: 0 }];
            this.current[this.current.length - 1]!.bulge = bulge;
            this.current.push({ x: nx, y: ny, bulge: 0 });
        } else {
            this.endStroke();
        }
        this.x = nx;
        this.y = ny;
    }

    displace(dx: number, dy: number, bulge = 0): void {
        const f = this.scale;
        if (bulge !== 0 && this.sx !== this.sy) {
            // Arc under a non-uniform transform is an ellipse: flatten in shape space, then transform.
            const ex = dx * f;
            const ey = dy * f;
            const arc = bulgeToArc(0, 0, ex, ey, bulge);
            const n = Math.max(
                1,
                Math.ceil((Math.abs(arc.sweep) / (2 * Math.PI)) * this.anisoSegments - 1e-9),
            );
            const x0 = this.x;
            const y0 = this.y;
            for (let k = 1; k <= n; k++) {
                const a = arc.a0 + (arc.sweep * k) / n;
                const px = k === n ? ex : arc.cx + arc.r * Math.cos(a);
                const py = k === n ? ey : arc.cy + arc.r * Math.sin(a);
                this.moveTo(x0 + px * this.sx, y0 + py * this.sy);
            }
            return;
        }
        this.moveTo(this.x + dx * f * this.sx, this.y + dy * f * this.sy, bulge);
    }

    /** Circular arc around the centre implied by the start angle; angles in degrees. */
    arc(radius: number, a0: number, sweep: number): void {
        if (radius === 0 || sweep === 0) return;
        const r = radius * this.scale;
        const c0 = Math.cos(a0 * DEG);
        const s0 = Math.sin(a0 * DEG);
        const a1 = (a0 + sweep) * DEG;
        // Offsets from the start point in shape space (before the non-uniform factors).
        const ex = r * (Math.cos(a1) - c0);
        const ey = r * (Math.sin(a1) - s0);
        const round = this.rounding !== "none";
        if (this.sx !== this.sy) {
            const n = Math.max(1, Math.ceil((Math.abs(sweep) / 360) * this.anisoSegments - 1e-9));
            const x0 = this.x;
            const y0 = this.y;
            for (let k = 1; k <= n; k++) {
                const a = (a0 + (sweep * k) / n) * DEG;
                this.moveTo(
                    x0 + r * (Math.cos(a) - c0) * this.sx,
                    y0 + r * (Math.sin(a) - s0) * this.sy,
                    0,
                    round && k === n,
                );
            }
            return;
        }
        if (Math.abs(sweep) >= 360 - 1e-9) {
            // A bulge can't describe a full circle: two semicircles.
            const half = sweep / 2;
            const ah = (a0 + half) * DEG;
            const b = Math.tan((half * DEG) / 4);
            const x0 = this.x;
            const y0 = this.y;
            this.moveTo(x0 + r * (Math.cos(ah) - c0) * this.sx, y0 + r * (Math.sin(ah) - s0) * this.sy, b);
            this.moveTo(x0, y0, b, round);
            return;
        }
        const b = Math.tan((sweep * DEG) / 4);
        this.moveTo(this.x + ex * this.sx, this.y + ey * this.sy, b, round);
    }

    run(ops: readonly ShapeOp[], depth: number, shape: number): void {
        for (let i = 0; i < ops.length; i++) {
            const o = ops[i]!;
            if (o.op === "verticalOnly") {
                // Skip the whole next command (incl. its parameters) in horizontal text (note 04 §4.3).
                if (!this.vertical) i++;
                continue;
            }
            if (o.op === "end") return;
            this.exec(o, depth, shape);
        }
    }

    exec(o: ShapeOp, depth: number, shape: number): void {
        switch (o.op) {
            case "penDown":
                this.pen = true;
                break;
            case "penUp":
                this.pen = false;
                this.endStroke();
                break;
            case "divide":
                if (o.n === 0) this.warnings.push(`shape ${shape}: divide by 0 ignored`);
                else this.scale /= o.n;
                break;
            case "multiply":
                this.scale *= o.n;
                break;
            case "push":
                // ADSK: the stack is 4 deep ("Position stack overflow"); we keep going to show something.
                if (this.stack.length >= 4) this.warnings.push(`shape ${shape}: position stack overflow`);
                this.stack.push([this.x, this.y]);
                break;
            case "pop": {
                const p = this.stack.pop();
                if (!p) {
                    this.warnings.push(`shape ${shape}: position stack underflow`);
                    break;
                }
                // Pop moves without drawing.
                this.endStroke();
                this.x = p[0];
                this.y = p[1];
                break;
            }
            case "subshape": {
                if (depth >= this.maxDepth) {
                    this.warnings.push(`shape ${shape}: subshape nesting too deep`);
                    break;
                }
                const sub = this.source.ops(o.shape);
                if (!sub) {
                    this.warnings.push(`shape ${shape}: missing subshape ${o.shape}`);
                    break;
                }
                // Scale and position carry into the subshape (ADSK), but it starts with the pen down:
                // amgdt f/n call subshape 3 with the pen up and AutoCAD draws its first stroke (note 04
                // §4.3, triage 2026-10-01; ADSK says draw mode is not reset).
                this.pen = true;
                this.run(sub, depth + 1, o.shape);
                break;
            }
            case "subshapeExt": {
                if (depth >= this.maxDepth) {
                    this.warnings.push(`shape ${shape}: subshape nesting too deep`);
                    break;
                }
                const sub = this.source.ops(o.shape);
                if (!sub) {
                    this.warnings.push(`shape ${shape}: missing subshape ${o.shape}`);
                    break;
                }
                // Extended big font: the primitive, designed in the font's character cell, is placed at
                // (x, y) and scaled to width × height (ADSK "Extended Big Font Files"). The pen returns to
                // where the command started (ASSUMPTION; placement is absolute within the cell).
                const cell = this.source.cell ?? { height: 1, width: 1 };
                const saved = {
                    x: this.x,
                    y: this.y,
                    scale: this.scale,
                    sx: this.sx,
                    sy: this.sy,
                    pen: this.pen,
                };
                this.endStroke();
                this.x += o.x * this.scale * this.sx;
                this.y += o.y * this.scale * this.sy;
                this.sx *= o.width / (cell.width || 1);
                this.sy *= o.height / (cell.height || 1);
                this.run(sub, depth + 1, o.shape);
                this.endStroke();
                this.x = saved.x;
                this.y = saved.y;
                this.scale = saved.scale;
                this.sx = saved.sx;
                this.sy = saved.sy;
                this.pen = saved.pen;
                break;
            }
            case "xy":
                this.displace(o.dx, o.dy);
                break;
            case "xyList":
                for (const [dx, dy] of o.points) this.displace(dx, dy);
                break;
            case "vector": {
                const d = VECTOR_DIRECTIONS[o.dir]!;
                this.displace(d[0] * o.length, d[1] * o.length);
                break;
            }
            case "octantArc": {
                const count = o.count === 0 ? 8 : o.count;
                this.arc(o.radius, 45 * o.start, (o.cw ? -45 : 45) * count);
                break;
            }
            case "fracArc": {
                // ADSK: offsets in units of 45°/256; radius = high·256 + low (note 04 §4.3).
                const count = o.count === 0 ? 8 : o.count;
                const eo = o.endOffset === 0 ? 256 : o.endOffset;
                const u = 45 / 256;
                let a0: number;
                let a1: number;
                if (!o.cw) {
                    a0 = 45 * o.start + o.startOffset * u;
                    a1 = 45 * (o.start + count - 1) + eo * u;
                } else {
                    a0 = 45 * o.start - o.startOffset * u;
                    a1 = 45 * (o.start - count + 1) - eo * u;
                }
                let sweep = a1 - a0;
                if (!o.cw && sweep <= 0) sweep += 360;
                if (o.cw && sweep >= 0) sweep -= 360;
                this.arc(o.radius, a0, sweep);
                break;
            }
            case "bulgeArc":
                this.displace(o.dx, o.dy, Math.max(-127, o.bulge) / 127);
                break;
            case "bulgeList":
                for (const [dx, dy, b] of o.arcs) this.displace(dx, dy, Math.max(-127, b) / 127);
                break;
            case "nop":
            case "end":
            case "verticalOnly":
                break;
        }
    }
}

/** Runs the ops of one shape and returns its strokes and end position. */
export function interpretOps(
    ops: readonly ShapeOp[],
    source: ShapeSource,
    options: InterpretOptions = {},
    shape = -1,
): InterpretResult {
    const m = new Machine(source, options);
    m.run(ops, 0, shape);
    m.endStroke();
    if (m.stack.length > 0)
        m.warnings.push(`shape ${shape}: ${m.stack.length} position(s) left on the stack`);
    return { strokes: m.strokes, endX: m.x === 0 ? 0 : m.x, endY: m.y === 0 ? 0 : m.y, warnings: m.warnings };
}

/** Convenience: decode and run raw bytecode (no subshape source except itself). */
export function interpretBytes(
    bytes: Uint8Array,
    kind: ShxKind,
    options: InterpretOptions = {},
    modes = 0,
): InterpretResult {
    const { ops } = disassemble(bytes, kind);
    return interpretOps(ops, { fileKind: kind, modes, ops: () => undefined }, options);
}
