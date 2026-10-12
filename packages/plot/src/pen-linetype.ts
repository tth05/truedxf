// CTB/STB pen linetypes 0–30 (`linetype` of a plot style; 31 = use the object linetype). They
// replace the object linetype completely and are fixed lengths on the sheet: neither LTSCALE,
// entity 48, PSLTSCALE, the plot scale nor `linepattern_size` changes them (VERIFIED-BY-ACAD
// 2026-10-12, Q-0228, note 06 §6.7). The definitions are measured from AutoCAD's PLOT output.

/** Millimetres per inch; the measured patterns are multiples of 0.005 in. */
const MM_PER_IN = 25.4;

export interface PenLinetype {
    /** Name in the Plot Style Table Editor list. */
    readonly name: string;
    /** Pattern on the sheet in inches: dash > 0, gap < 0, 0 = dot. Empty = continuous. */
    readonly elements: readonly number[];
    /**
     * Length (inches) that adaptive mode fits whole repetitions of: the period for 1–16, a
     * constant 0.5 in for the ISO types 17–30 (note 06 §6.7).
     */
    readonly fitLength: number;
}

function lt(name: string, elements: readonly number[], fit?: number): PenLinetype {
    const period = elements.reduce((sum, e) => sum + Math.abs(e), 0);
    return { name, elements, fitLength: fit ?? period };
}

const ISO = 0.5;

/** Pen linetypes by CTB `linetype` value 0–30 (note 06 §6.7). */
// biome-ignore format: data table
export const PEN_LINETYPES: readonly PenLinetype[] = Object.freeze([
    lt("Solid", []),
    lt("Dashed", [0.15, -0.1]),
    lt("Dotted", [0, -0.1]),
    lt("Dash Dot", [0.13, -0.06, 0, -0.06]),
    lt("Short Dash", [0.125, -0.375]),
    lt("Medium Dash", [0.25, -0.25]),
    lt("Long Dash", [0.375, -0.125]),
    lt("Short Dash X2", [0.25, -0.75]),
    lt("Medium Dash X2", [0.5, -0.5]),
    lt("Long Dash X2", [0.75, -0.25]),
    lt("Medium Long Dash", [0.3, -0.2]),
    lt("Medium Dash Short Dash Short Dash", [0.2, -0.06, 0.06, -0.06, 0.06, -0.06]),
    lt("Long Dash Short Dash", [0.35, -0.05, 0.05, -0.05]),
    lt("Long Dash Dot Dot", [0.35, -0.05, 0, -0.05, 0, -0.05]),
    lt("Long Dash Dot", [0.4, -0.05, 0, -0.05]),
    lt("Medium Dash Dot Short Dash Dot", [0.25, -0.05, 0, -0.05, 0.05, -0.05, 0, -0.05]),
    lt("Sparse Dot", [0, -0.5]),
    lt("ISO Dash", [0.235, -0.06], ISO),
    lt("ISO Dash Space", [0.235, -0.355], ISO),
    lt("ISO Long Dash Dot", [0.47, -0.06, 0, -0.06], ISO),
    lt("ISO Long Dash Double Dot", [0.47, -0.06, 0, -0.06, 0, -0.06], ISO),
    lt("ISO Long Dash Triple Dot", [0.47, -0.06, 0, -0.06, 0, -0.06, 0, -0.06], ISO),
    lt("ISO Dot", [0, -0.395], ISO),
    lt("ISO Long Dash Short Dash", [0.47, -0.06, 0.12, -0.06], ISO),
    lt("ISO Long Dash Double Short Dash", [0.47, -0.06, 0.12, -0.06, 0.12, -0.06], ISO),
    lt("ISO Dash Dot", [0.235, -0.06, 0, -0.06], ISO),
    lt("ISO Double Dash Dot", [0.235, -0.06, 0.235, -0.06, 0, -0.06], ISO),
    lt("ISO Dash Double Dot", [0.235, -0.06, 0, -0.06, 0, -0.06], ISO),
    lt("ISO Double Dash Double Dot", [0.235, -0.06, 0.235, -0.06, 0, -0.06, 0, -0.06], ISO),
    lt("ISO Dash Triple Dot", [0.235, -0.06, 0, -0.06, 0, -0.06, 0, -0.06], ISO),
    lt("ISO Double Dash Triple Dot", [0.235, -0.06, 0.235, -0.06, 0, -0.06, 0, -0.06, 0, -0.06], ISO),
]);

/** One inked piece along a run, in paper mm from its start; start = end for a dot. */
export interface PenDash {
    readonly start: number;
    readonly end: number;
}

// A dot exactly on the end point is drawn or not by floating-point luck in AutoCAD (note 06
// §6.7); we keep it. A dash starting there would be empty.
const EPS = 1e-9;

/**
 * The dashes of pen linetype `linetype` (1–30) along a run of `length` paper mm. Undefined for
 * 0 (continuous) and anything else that is not a pattern (31 = the object linetype).
 *
 * Fixed mode: phase 0 at the start, the pattern cut at the end. Pass the whole length of a
 * polyline (vertices do not restart the pattern) and of circles and arcs.
 * Adaptive mode: N = max(1, round(L / F)) repetitions of the pattern scaled by L / (N·F),
 * starting in the middle of the first dash. AutoCAD applies it to each LINE and polyline
 * segment separately and never to circles and arcs (note 06 §6.7).
 *
 * On wide lines each dash is a butt-ended stroke; the pen's end style applies only where the
 * curve itself starts or ends inside a dash, a polyline vertex inside a dash gets the pen's join
 * style, and dots are discs of the line width (VERIFIED-BY-ACAD, Q-0761, note 06 §6.7).
 */
export function penLinetypeDashes(
    linetype: number,
    length: number,
    adaptive = false,
): readonly PenDash[] | undefined {
    const def = PEN_LINETYPES[linetype];
    if (!def || def.elements.length === 0 || !(length >= 0)) return undefined;
    let scale = MM_PER_IN;
    let pos = 0;
    if (adaptive) {
        const fit = def.fitLength * MM_PER_IN;
        const n = Math.max(1, Math.round(length / fit));
        scale *= length / (n * fit);
        pos = (-def.elements[0]! * scale) / 2;
    }
    const period = def.elements.reduce((sum, e) => sum + Math.abs(e), 0) * scale;
    // An adaptive run of length 0 scales the pattern to nothing.
    if (!(period > 1e-6)) return [{ start: 0, end: length }];
    const out: PenDash[] = [];
    for (let i = 0; pos <= length + EPS; i = (i + 1) % def.elements.length) {
        const e = def.elements[i]! * scale;
        if (e === 0 || (e > 0 && pos < length - EPS)) {
            const end = Math.min(pos + e, length);
            if (pos + e >= 0) out.push({ start: Math.min(Math.max(pos, 0), end), end });
        }
        pos += Math.abs(e);
    }
    return out;
}
