/**
 * Linetype patterns for rendering (note 06 §2). The pattern (LTYPE 49 values) is scaled by the
 * entity linetype scale × $LTSCALE and by the uniform scale of the block transform, then walked
 * along the curve in target coordinates.
 *
 * UNVERIFIED (note 06 §2.4): whether INSERT scale scales linetypes (we assume yes, the pattern
 * lives in block space); PSLTSCALE for viewports is handled by the paper-space code path.
 */
import {
    ComplexRotation,
    type DashElement,
    type DashFitStrategy,
    type DashPattern,
    DashUnits,
    phaseFit,
} from "@truedxf/geometry";
import type { DxfDocument, LinetypeElement, LinetypeEntry } from "@truedxf/model";
import { PEN_LINETYPES } from "@truedxf/plot";

/** Payload of a complex dash element: the LTYPE record element and the pattern scale. */
export interface ComplexElementData {
    readonly element: LinetypeElement;
    /** Effective linetype scale the pattern was multiplied with. */
    readonly scale: number;
}

export interface LinetypeSpec {
    /** The LTYPE entry; undefined for plot style pen linetypes. */
    readonly entry: LinetypeEntry | undefined;
    /** Pattern already multiplied by all scale factors (target units). */
    readonly pattern: DashPattern;
    readonly period: number;
    /** Fit strategy and dash units replacing the LTYPE defaults (pen linetypes). */
    readonly fit?: DashFitStrategy;
    readonly units?: DashUnits;
}

/**
 * Adaptive pen linetype on one unit of length L: N = max(1, round(L / F)) repetitions with every
 * element scaled by L / (N·F), starting in the middle of the first dash (note 06 §6.7).
 */
function penAdaptiveFit(fitLength: number): DashFitStrategy {
    return (length, pattern) => {
        const n = Math.max(1, Math.round(length / fitLength));
        const scale = length / (n * fitLength);
        const e0 = pattern.elements[0]!.length;
        return { kind: "pattern", phase: (e0 * scale) / 2, head: 0, tail: 0, scale };
    };
}

/**
 * Plot style pen linetype 1–30 (CTB/STB `linetype`): fixed lengths on the sheet that replace the
 * object linetype, whatever LTSCALE, PSLTSCALE or the plot scale (VERIFIED-BY-ACAD, Q-0228,
 * note 06 §6.7). Fixed mode runs one pattern from phase 0 over the whole curve; adaptive mode
 * fits each segment separately (AutoCAD ignores it for circles and arcs: pass `adaptive` false).
 * `unitsPerInch`: target units per sheet inch.
 */
export function penLinetypeSpec(
    index: number,
    adaptive: boolean,
    unitsPerInch: number,
): LinetypeSpec | undefined {
    const def = PEN_LINETYPES[index];
    if (!def || def.elements.length === 0 || !(unitsPerInch > 0)) return undefined;
    const elements = def.elements.map((length) => ({ length: length * unitsPerInch }));
    let period = 0;
    for (const el of elements) period += Math.abs(el.length);
    return {
        entry: undefined,
        pattern: { elements, period },
        period,
        fit: adaptive ? penAdaptiveFit(def.fitLength * unitsPerInch) : phaseFit(0),
        units: adaptive ? DashUnits.PerSegment : DashUnits.Continuous,
    };
}

const CONTINUOUS = new Set(["CONTINUOUS", "BYLAYER", "BYBLOCK", ""]);

export class LinetypeResolver {
    private readonly doc: DxfDocument;
    readonly ltscale: number;
    private readonly cache = new Map<string, LinetypeEntry | null>();

    constructor(doc: DxfDocument) {
        this.doc = doc;
        this.ltscale = doc.header.num("$LTSCALE", 1) || 1;
    }

    entry(name: string): LinetypeEntry | undefined {
        const key = name.toUpperCase();
        if (CONTINUOUS.has(key)) return undefined;
        let e = this.cache.get(key);
        if (e === undefined) {
            const t = this.doc.tables.linetypes.get(name);
            // a pattern needs a gap or a complex element to differ from a continuous line (TRACKS has
            // only dashes and shapes: acad-default-fonts/ltype-tracks-*)
            e = t?.elements.some((x) => x.length < 0 || (x.flags & 6) !== 0) ? t : null;
            this.cache.set(key, e);
        }
        return e ?? undefined;
    }

    /**
     * Pattern for a linetype name with the given entity scale and transform scale, or undefined
     * for continuous lines.
     */
    spec(name: string, entityScale: number, transformScale: number): LinetypeSpec | undefined {
        const entry = this.entry(name);
        if (!entry) return undefined;
        const scale = (entityScale || 1) * this.ltscale * transformScale;
        if (!(scale > 0) || !Number.isFinite(scale)) return undefined;
        const elements: DashElement[] = entry.elements.map((el) => {
            const kind = el.flags & 2 ? "text" : el.flags & 4 ? "shape" : undefined;
            if (!kind) return { length: el.length * scale };
            return {
                length: el.length * scale,
                complex: {
                    kind,
                    rotation: (el.rotation * Math.PI) / 180,
                    rotationMode:
                        el.flags & 1
                            ? ComplexRotation.Absolute
                            : el.flags & 8
                              ? ComplexRotation.Upright
                              : ComplexRotation.Relative,
                    offsetX: el.offsetX * scale,
                    offsetY: el.offsetY * scale,
                    scale: el.scale * scale,
                    data: { element: el, scale } satisfies ComplexElementData,
                },
            };
        });
        let period = 0;
        for (const el of elements) period += Math.abs(el.length);
        if (period === 0) return undefined;
        // the A-type fit uses the declared length 40, not Σ|49| (VERIFIED-BY-ACAD linetypes/odd-*)
        return { entry, pattern: { elements, period: entry.patternLength * scale }, period };
    }
}
