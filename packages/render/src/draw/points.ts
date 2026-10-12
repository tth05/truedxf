/**
 * PDMODE point symbols (note 03 §3.1): low 3 bits select the figure (0 dot, 1 nothing, 2 +,
 * 3 ×, 4 short vertical tick), +32 circle, +64 square.
 *
 * Geometry in units of the point size S (see `pointSize` in basic.ts), VERIFIED-BY-ACAD
 * (points/pdmode-*, 2026-09-30): `+` arms ±S, `×` arms of length S along the diagonals (ends at
 * ±S/√2), tick from the centre up to S/2, circle radius S/2, square half-side S/2. The dot of
 * mode 0 is drawn together with the frames.
 */
import type { Path2, PathSegment, Subpath } from "@truedxf/geometry";

export interface PointSymbol {
    /** Draw a single dot at the point. */
    readonly dot: boolean;
    /** Symbol geometry centred at the origin. */
    readonly paths: Path2;
}

function line(x0: number, y0: number, x1: number, y1: number): Subpath {
    return { segments: [{ kind: "line", p0: { x: x0, y: y0 }, p1: { x: x1, y: y1 } }], closed: false };
}

export function pointSymbol(mode: number, size: number): PointSymbol {
    const fig = mode & 7;
    const h = size / 2;
    const d = size * Math.SQRT1_2;
    const subs: Subpath[] = [];
    let dot = false;
    switch (fig) {
        case 0:
            dot = true;
            break;
        case 1:
            break;
        case 2:
            subs.push(line(-size, 0, size, 0), line(0, -size, 0, size));
            break;
        case 3:
            subs.push(line(-d, -d, d, d), line(-d, d, d, -d));
            break;
        case 4:
            subs.push(line(0, 0, 0, h));
            break;
        default:
            dot = true;
    }
    if (mode & 32) {
        const seg: PathSegment = {
            kind: "arc",
            center: { x: 0, y: 0 },
            radius: h,
            start: 0,
            sweep: Math.PI * 2,
        };
        subs.push({ segments: [seg], closed: true });
    }
    if (mode & 64) {
        subs.push({
            segments: [
                { kind: "line", p0: { x: -h, y: -h }, p1: { x: h, y: -h } },
                { kind: "line", p0: { x: h, y: -h }, p1: { x: h, y: h } },
                { kind: "line", p0: { x: h, y: h }, p1: { x: -h, y: h } },
                { kind: "line", p0: { x: -h, y: h }, p1: { x: -h, y: -h } },
            ],
            closed: true,
        });
    }
    return { dot, paths: { subpaths: subs } };
}
