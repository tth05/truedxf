/**
 * Built-in arrowheads (note 05 §10). Arrow blocks point right with the tip at (0, 0) and are
 * inserted at the tip scaled by DIMASZ·DIMSCALE. The default (closed filled) arrow is written as a
 * SOLID directly into the block with half-width 1/6 of its length (VERIFIED-BY-ACAD S1/S2 and
 * every `-nb` reference of the dimensions suite).
 */
import type { BlockBuilder, PartProps, Pt } from "./block-builder.ts";

/** Upper-case name without the leading underscore ("" = closed filled). */
export function arrowKey(name: string): string {
    const n = name.trim().toUpperCase();
    return n.startsWith("_") ? n.slice(1) : n;
}

/**
 * Arrows that do not shorten the dimension line and allow DIMDLE: VERIFIED-BY-ACAD
 * dimensions/arrow-*-nb and dimdle-2-*-nb (Q-0542, Q-0543) — the ezdxf/GDAL list.
 */
const ZERO_LENGTH = new Set(["ARCHTICK", "OBLIQUE", "DOTSMALL", "SMALL", "INTEGRAL", "NONE"]);

/** Length (in arrow sizes) by which an arrow shortens the line it ends; user blocks count as 1. */
export function arrowLength(name: string): number {
    return ZERO_LENGTH.has(arrowKey(name)) ? 0 : 1;
}

export function allowsExtension(name: string): boolean {
    return ZERO_LENGTH.has(arrowKey(name));
}

export interface ArrowOptions {
    /** SOLID corner 10 left (true) / right of the arrow direction; default: the linear rule. */
    readonly cornerLeft?: boolean;
    /** Tip-to-base distance of the SOLID (arc arrows: the chord), default the arrow size. */
    readonly length?: number;
    /** Part properties instead of the dimension's DIMCLRD / DIMLWD. */
    readonly props?: PartProps;
}

/**
 * Emits an arrowhead with its tip at `tip`, pointing along the unit vector `dir`.
 * `_None` writes nothing (dimensions/arrow-none-nb).
 */
export function writeArrow(
    w: BlockBuilder,
    name: string,
    blockName: string,
    tip: Pt,
    dir: Pt,
    size: number,
    props: PartProps,
    opts: ArrowOptions = {},
): void {
    const key = arrowKey(name);
    if (key === "NONE") return;
    if (key === "" || key === "CLOSEDFILLED") {
        const l = opts.length ?? size;
        const bx = tip.x - dir.x * l;
        const by = tip.y - dir.y * l;
        // corner 10 lies left of the dimension line direction (left of arrows pointing right, right
        // of arrows pointing left); 12 = 13 = tip (dimensions/*-nb references). On arcs corner 10 is
        // left of the arrow direction.
        const a = Math.atan2(dir.y, dir.x);
        const k =
            opts.cornerLeft !== undefined
                ? opts.cornerLeft
                    ? 1
                    : -1
                : a > -Math.PI / 2 + 1e-9 && a <= Math.PI / 2 + 1e-9
                  ? 1
                  : -1;
        const hx = (-dir.y * size * k) / 6;
        const hy = (dir.x * size * k) / 6;
        // the SOLID keeps a BYBLOCK lineweight (lineweights-nb)
        w.solid({ x: bx + hx, y: by + hy }, { x: bx - hx, y: by - hy }, tip, tip, { color: props.color });
        return;
    }
    w.insert(blockName, tip, size, (Math.atan2(dir.y, dir.x) * 180) / Math.PI, props);
}

/**
 * DXF tag listings (without the BLOCK wrapper) of arrow blocks, for arrows referenced by name
 * but not defined in the file. Geometry from AutoCAD-written blocks where known, else ezdxf's
 * shapes (note 05 §10.3 table).
 */
export function arrowBlockEntities(name: string, w: BlockBuilder, p: PartProps): boolean {
    const key = arrowKey(name);
    const L = (a: Pt, b: Pt) => w.line(a, b, p);
    const s = 1 / 6;
    switch (key) {
        case "CLOSEDBLANK":
            L({ x: -1, y: s }, { x: 0, y: 0 });
            L({ x: 0, y: 0 }, { x: -1, y: -s });
            L({ x: -1, y: s }, { x: -1, y: -s });
            return true;
        case "CLOSED":
            L({ x: -1, y: s }, { x: 0, y: 0 });
            L({ x: 0, y: 0 }, { x: -1, y: -s });
            L({ x: -1, y: s }, { x: -1, y: -s });
            L({ x: 0, y: 0 }, { x: -1, y: 0 });
            return true;
        case "OPEN":
            L({ x: -1, y: s }, { x: 0, y: 0 });
            L({ x: 0, y: 0 }, { x: -1, y: -s });
            L({ x: 0, y: 0 }, { x: -1, y: 0 });
            return true;
        case "OPEN30": {
            const t = Math.tan(Math.PI / 12);
            L({ x: -1, y: t }, { x: 0, y: 0 });
            L({ x: 0, y: 0 }, { x: -1, y: -t });
            L({ x: 0, y: 0 }, { x: -1, y: 0 });
            return true;
        }
        case "OPEN90":
            L({ x: -0.5, y: 0.5 }, { x: 0, y: 0 });
            L({ x: 0, y: 0 }, { x: -0.5, y: -0.5 });
            L({ x: 0, y: 0 }, { x: -1, y: 0 });
            return true;
        case "ARCHTICK":
            w.lwpolyline(
                [
                    { x: -0.5, y: -0.5 },
                    { x: 0.5, y: 0.5 },
                ],
                false,
                0.15,
                p,
            );
            return true;
        case "OBLIQUE":
            L({ x: -0.5, y: -0.5 }, { x: 0.5, y: 0.5 });
            return true;
        case "BOXBLANK":
            L({ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 });
            L({ x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 });
            L({ x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 });
            L({ x: -0.5, y: 0.5 }, { x: -0.5, y: -0.5 });
            L({ x: -0.5, y: 0 }, { x: -1, y: 0 });
            return true;
        case "BOXFILLED":
            w.solid({ x: -0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, p);
            L({ x: -0.5, y: 0 }, { x: -1, y: 0 });
            return true;
        case "DATUMFILLED":
            w.solid({ x: 0, y: 0.57735 }, { x: -1, y: 0 }, { x: 0, y: -0.57735 }, { x: 0, y: -0.57735 }, p);
            return true;
        case "DATUMBLANK":
            L({ x: 0, y: 0.57735 }, { x: 0, y: -0.57735 });
            L({ x: 0, y: -0.57735 }, { x: -1, y: 0 });
            L({ x: -1, y: 0 }, { x: 0, y: 0.57735 });
            return true;
        case "DOT":
            w.lwpolyline(
                [
                    { x: -0.25, y: 0, bulge: 1 },
                    { x: 0.25, y: 0, bulge: 1 },
                ],
                true,
                0.5,
                p,
            );
            L({ x: -0.5, y: 0 }, { x: -1, y: 0 });
            return true;
        case "DOTSMALL":
            w.lwpolyline(
                [
                    { x: -0.0625, y: 0, bulge: 1 },
                    { x: 0.0625, y: 0, bulge: 1 },
                ],
                true,
                0.5,
                p,
            );
            return true;
        case "DOTBLANK":
            w.circle({ x: 0, y: 0 }, 0.5, p);
            L({ x: -0.5, y: 0 }, { x: -1, y: 0 });
            return true;
        case "SMALL":
            w.circle({ x: 0, y: 0 }, 0.25, p);
            return true;
        case "ORIGIN":
            w.circle({ x: 0, y: 0 }, 0.5, p);
            L({ x: 0, y: 0 }, { x: -1, y: 0 });
            return true;
        case "ORIGIN2":
            w.circle({ x: 0, y: 0 }, 0.5, p);
            w.circle({ x: 0, y: 0 }, 0.25, p);
            L({ x: -0.5, y: 0 }, { x: -1, y: 0 });
            return true;
        case "INTEGRAL": {
            const r = 0.3535534;
            w.arc({ x: -r, y: 0 }, r, 270, 360, p);
            w.arc({ x: r, y: 0 }, r, 90, 180, p);
            return true;
        }
        case "NONE":
            return true;
        default:
            return false;
    }
}
