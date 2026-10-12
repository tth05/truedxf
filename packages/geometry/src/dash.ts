/**
 * Dash engine (linetypes): applies an LTYPE pattern along a path or flattened polyline.
 *
 * Input pattern: elements in drawing units **already multiplied by the effective linetype
 * scale** (note 06 §2.5): `> 0` dash (pen down), `< 0` gap, `0` dot. Complex elements (text /
 * shape, note 06 §2.2–2.3) ride on the element they are attached to and are reported as
 * placements through the result (and an optional callback) — the engine never draws them.
 *
 * Units and generation modes (note 06 §2.6 "Which primitive is an individual line?"):
 * - the pattern is fitted per **unit**; a unit is a LINE, an ARC, a whole curve, or — for
 *   LWPOLYLINE/POLYLINE — either every segment (PLINEGEN off: `units: "perSegment"`, restart at
 *   every vertex) or the whole polyline (PLINEGEN on / flag 128: `units: "continuous"`, one
 *   pattern run across all vertices);
 * - a closed unit (circle, closed polyline with PLINEGEN) is fitted with `closed = true`; a dash
 *   that ends at the end of a closed unit and one that starts at its start are merged across
 *   the seam into one dash.
 *
 * Fitting ("A-type alignment") is a pluggable {@link DashFitStrategy}. The default
 * {@link autocadCandidateFit} is the **UNVERIFIED** hypothesis of note 06 §2.6:
 *   P = Σ|eᵢ|, L = unit length;
 *   L < P → continuous line (no dashes, no dots, no complex elements; mlightcad pr-668);
 *   else k = ⌊L/P⌋, r = L − kP; both end dashes become e₀/2 + r/2 and the interior runs the
 *   periodic pattern shifted so it meets them exactly (phase e₀/2 − r/2).
 * Alternatives: {@link phaseFit} (plain pattern from a fixed phase, no fitting — ezdxf /
 * mlightcad behaviour, and what hatch pattern lines use) and {@link shortContinuousPhaseFit}.
 *
 * Distances: along a {@link Path2} the engine uses exact arc length per segment (lines, arcs
 * exact; other curves via length.ts quadrature): each segment is flattened with the caller's
 * tolerance and the chord lengths are rescaled so the flattened piece has the exact segment
 * length. For arcs (equal-angle chords) that is exact at every vertex; elsewhere the error is a
 * small fraction of the tolerance. A dash end inside a chord is interpolated on the chord.
 *
 * Dots are zero-length events: reported as `(x, y, angle)` in `dots` (use `strokeDot` for a
 * lineweight dot, or a 1-px point for hairlines), or — with `dotMode: "strokes"` — converted to
 * straight dashes of `dotLength` centred on the dot along the tangent.
 *
 * Determinism: positions are computed from period indices (`m·P + prefix`), not by accumulating
 * sums, and a count limit (`maxPrimitives`) replaces any time limit: when exceeded the whole
 * input is drawn continuous and `tooDense` is set (AutoCAD shows over-dense linetypes as
 * continuous on screen; note 06 §2.6 "Pattern too dense" — plot threshold UNKNOWN).
 */

import { flattenSegmentInto } from "./flatten.ts";
import { segmentLength } from "./length.ts";
import { type Path2, type PathSegment, type Subpath, segmentStart } from "./path.ts";

// ---- Pattern --------------------------------------------------------------------------------

export const ComplexRotation = {
    /** R= : relative to the line direction (default). */
    Relative: "relative",
    /** A= : absolute (74 bit 1). */
    Absolute: "absolute",
    /** U= : relative, but flipped by 180° when it would read upside down (74 bit 8). */
    Upright: "upright",
} as const;
export type ComplexRotation = (typeof ComplexRotation)[keyof typeof ComplexRotation];

export interface ComplexElement {
    readonly kind: "shape" | "text";
    /** Rotation in radians (DXF 50 is written in degrees by AutoCAD, note 06 §2.2). */
    readonly rotation: number;
    readonly rotationMode: ComplexRotation;
    /** X= along the line and Y= perpendicular (left), already scaled. */
    readonly offsetX: number;
    readonly offsetY: number;
    /** S= (already multiplied by the linetype scale). */
    readonly scale: number;
    /** Opaque payload for the placement callback (shape number, text, style handle, …). */
    readonly data?: unknown;
}

export interface DashElement {
    /** > 0 dash, < 0 gap, 0 dot (already scaled). */
    readonly length: number;
    readonly complex?: ComplexElement;
}

export interface DashPattern {
    readonly elements: readonly DashElement[];
    /**
     * Declared pattern length (LTYPE 40, already scaled) used by the A-type fit for k and r; may
     * differ from Σ|eᵢ| in odd files. Default Σ|eᵢ|.
     */
    readonly period?: number;
}

/** Pattern from plain signed lengths (LTYPE 49 values) times `scale`. */
export function dashPattern(lengths: readonly number[], scale = 1): DashPattern {
    return { elements: lengths.map((l) => ({ length: l * scale })) };
}

/** Pattern with every element length multiplied by `f` (complex elements unchanged). */
export function scaledPattern(p: DashPattern, f: number): DashPattern {
    return {
        elements: p.elements.map((e) => ({ ...e, length: e.length * f })),
        ...(p.period !== undefined ? { period: p.period * f } : {}),
    };
}

/** Σ|eᵢ| */
export function patternPeriod(p: DashPattern): number {
    let s = 0;
    for (const e of p.elements) s += Math.abs(e.length);
    return s;
}

// ---- Fitting --------------------------------------------------------------------------------

/**
 * How a unit of length L is dashed: `continuous`, or the periodic pattern with pattern
 * coordinate `u = s + phase` on the interior `[head, interiorEnd]` (default `L − tail`), plus a
 * forced head dash `[0, head]` and a forced tail dash `[interiorEnd, interiorEnd + tail]`
 * (clipped to L; 0 = none). With `endDots` the head and tail are dots at 0 and at
 * `min(L, interiorEnd + head)` instead of dashes.
 */
export type DashFit =
    | { readonly kind: "continuous" }
    | {
          readonly kind: "pattern";
          readonly phase: number;
          readonly head: number;
          readonly tail: number;
          /** End of the periodic interior (default `L − tail`). */
          readonly interiorEnd?: number;
          /** Head and tail are dots (patterns starting with a dot). */
          readonly endDots?: boolean;
          /** Length multiplier applied to the pattern elements for this unit (default 1). */
          readonly scale?: number;
      };

export type DashFitStrategy = (length: number, pattern: DashPattern, closed: boolean) => DashFit;

const CONTINUOUS: DashFit = { kind: "continuous" };

/**
 * AutoCAD's A-type alignment (note 06 §2.6, VERIFIED-BY-ACAD 2026-09-30). Pattern e₀ … eₙ₋₁,
 * Σ = Σ|eᵢ|, P = declared length (LTYPE 40, normally = Σ), L = unit length:
 * - **open unit** (LINE, ARC, open ELLIPSE, PLINEGEN-off polyline segment): k = ⌊L/P⌋,
 *   r = L − kP, h = (e₀ + r)/2. AutoCAD walks the element sequence
 *   `[h, e₁ … eₙ₋₁, (k − 1) × (e₀ … eₙ₋₁), e₀ + r]` from s = 0 and clips it at L. For a normal
 *   pattern both end dashes are h = e₀/2 + r/2 and the interior has phase e₀/2 − r/2
 *   (`linetypes/fit-*`, `arc-*`, `ellipse-*-partial`); with 40 ≠ Σ or a leading gap the same
 *   walk explains `linetypes/odd-*` (the tail `e₀ + r` is then not clipped).
 *   L < P → continuous. Patterns starting with a dot (e₀ = 0) draw a dot at both ends instead
 *   of end dashes (`linetypes/odd-dot-dash-start`); a pure dot pattern (no dash, e.g. DOT) does
 *   so even for L < P (`linetypes/fit-dot*`).
 * - **closed unit** (CIRCLE, full ELLIPSE): L < P → continuous; else the pattern is **stretched**
 *   to n = max(2, round(L/P)) whole periods and starts with e₀ at the curve start
 *   (`linetypes/circle-*`, `ellipse-*-full`).
 * P ≤ 0 (LTYPE 40 = 0) → continuous (`linetypes/odd-total-zero`).
 */
export const autocadCandidateFit: DashFitStrategy = (length, pattern, closed) => {
    const S = patternPeriod(pattern);
    const P = pattern.period ?? S;
    if (!(P > 0) || !(S > 0)) return CONTINUOUS;
    const e0 = pattern.elements[0]!.length;
    if (closed) {
        if (length < P) return CONTINUOUS;
        const n = Math.max(2, Math.round(length / P));
        return { kind: "pattern", phase: 0, head: 0, tail: 0, scale: length / (n * P) };
    }
    if (length < P && (e0 !== 0 || pattern.elements.some((e) => e.length > 0))) return CONTINUOUS;
    const k = Math.floor(length / P);
    const r = length - k * P;
    const h = (e0 + r) / 2;
    const a0 = Math.abs(e0);
    return {
        kind: "pattern",
        phase: a0 - h,
        head: h,
        tail: e0 + r,
        interiorEnd: h + k * S - a0,
        endDots: e0 === 0,
    };
};

/** Plain pattern starting at pattern coordinate `phase`, no end fitting, no short rule. */
export function phaseFit(phase = 0): DashFitStrategy {
    return (_length, pattern) =>
        patternPeriod(pattern) > 0 ? { kind: "pattern", phase, head: 0, tail: 0 } : CONTINUOUS;
}

/** Like {@link phaseFit} but units shorter than one period are continuous (mlightcad rule). */
export function shortContinuousPhaseFit(phase = 0): DashFitStrategy {
    return (length, pattern) => {
        const P = patternPeriod(pattern);
        return P > 0 && length >= P ? { kind: "pattern", phase, head: 0, tail: 0 } : CONTINUOUS;
    };
}

// ---- Pattern walking ------------------------------------------------------------------------

export interface PatternEventSink {
    /** A dash covering [s0, s1] (already clipped to the region). */
    dash(s0: number, s1: number): void;
    /** A dot at s. */
    dot(s: number): void;
    /** Complex element of `elements[index]`, anchored at the end of that element (s). */
    complex?(s: number, element: ComplexElement, index: number): void;
}

/**
 * Walk the periodic pattern (`u = s + phase`) over the region [a, b] and report dashes (clipped
 * to the region), dots and complex anchors with `a ≤ s ≤ b` — except that dots exactly at an
 * `exclusive` end (within `eps`) are skipped (used next to forced head/tail dashes).
 * Returns the number of events, or −1 when more than `limit` would be produced (nothing further
 * is reported then).
 */
export function walkPattern(
    pattern: DashPattern,
    phase: number,
    a: number,
    b: number,
    sink: PatternEventSink,
    limit = Number.POSITIVE_INFINITY,
    exclusiveStart = false,
    exclusiveEnd = false,
): number {
    const els = pattern.elements;
    const P = patternPeriod(pattern);
    if (!(P > 0) || !(b >= a)) return 0;
    const eps = P * 1e-9;
    const lo = exclusiveStart ? a + eps : a;
    const hi = exclusiveEnd ? b - eps : b;
    // Prefix sums of one period (start of each element in pattern coordinates).
    const pre = new Float64Array(els.length + 1);
    for (let i = 0; i < els.length; i++) pre[i + 1] = pre[i]! + Math.abs(els[i]!.length);
    let m = Math.floor((a + phase) / P);
    let count = 0;
    for (;;) {
        const base = m * P - phase;
        if (base > b) break;
        for (let i = 0; i < els.length; i++) {
            const e = els[i]!;
            const s0 = base + pre[i]!;
            if (s0 > b) break;
            const s1 = i + 1 === els.length ? (m + 1) * P - phase : base + pre[i + 1]!;
            if (e.length > 0) {
                if (s1 > a && s0 < b) {
                    const c0 = Math.max(s0, a);
                    const c1 = Math.min(s1, b);
                    if (c1 > c0) {
                        if (++count > limit) return -1;
                        sink.dash(c0, c1);
                    }
                }
            } else if (e.length === 0) {
                if (s0 >= lo && s0 <= hi) {
                    if (++count > limit) return -1;
                    sink.dot(s0);
                }
            }
            // Complex anchors are inclusive at both ends (a forced head dash *is* the first element).
            if (e.complex && sink.complex && s1 >= a - eps && s1 <= b + eps) {
                if (++count > limit) return -1;
                sink.complex(s1, e.complex, i);
            }
        }
        m++;
    }
    return count;
}

// ---- Measured polylines ---------------------------------------------------------------------

/**
 * A polyline with cumulative arc-length distances and fitting-unit boundaries.
 * `units` holds the vertex index where each unit starts (first is 0); a unit ends where the
 * next starts, the last one at the final vertex. A closed polyline repeats its first point at
 * the end (the closing edge is materialized).
 */
export interface MeasuredPolyline {
    readonly points: Float64Array;
    readonly distances: Float64Array;
    readonly units: Uint32Array;
    readonly closed: boolean;
    /** Source segments by distance range (measureSubpath), for exact points on arcs. */
    readonly spans?: readonly SegmentSpan[];
}

export interface SegmentSpan {
    readonly s0: number;
    readonly s1: number;
    readonly seg: PathSegment;
}

export const DashUnits = {
    /** One pattern run over the whole polyline (PLINEGEN on, or a single curve). */
    Continuous: "continuous",
    /** Restart the pattern at every vertex / path segment (PLINEGEN off). */
    PerSegment: "perSegment",
} as const;
export type DashUnits = (typeof DashUnits)[keyof typeof DashUnits];

/** Measure a plain polyline; `perSegment` makes every edge a unit. */
export function measurePolyline(
    points: Float64Array,
    closed = false,
    units: DashUnits = DashUnits.Continuous,
): MeasuredPolyline {
    const n0 = points.length >> 1;
    const pts = closed && n0 > 1 ? new Float64Array(points.length + 2) : Float64Array.from(points);
    if (closed && n0 > 1) {
        pts.set(points);
        pts[points.length] = points[0]!;
        pts[points.length + 1] = points[1]!;
    }
    const n = pts.length >> 1;
    const dist = new Float64Array(n);
    for (let i = 1; i < n; i++) {
        dist[i] = dist[i - 1]! + Math.hypot(pts[2 * i]! - pts[2 * i - 2]!, pts[2 * i + 1]! - pts[2 * i - 1]!);
    }
    let u: Uint32Array;
    if (units === DashUnits.PerSegment) {
        const idx: number[] = [];
        for (let i = 0; i + 1 < n; i++) if (dist[i + 1]! > dist[i]!) idx.push(i);
        u = Uint32Array.from(idx.length > 0 ? idx : [0]);
    } else u = Uint32Array.of(0);
    return { points: pts, distances: dist, units: u, closed: closed && n0 > 1 };
}

/**
 * Measure a subpath with exact per-segment lengths (see module comment). `perSegment` makes
 * every path segment (and the implicit closing edge, and any gap connector) a unit.
 */
export function measureSubpath(
    sp: Subpath,
    tolerance: number,
    units: DashUnits = DashUnits.Continuous,
): MeasuredPolyline {
    const pts: number[] = [];
    const dist: number[] = [];
    const unitStarts: number[] = [];
    const spans: SegmentSpan[] = [];
    const segs = sp.segments;
    if (segs.length === 0) {
        return {
            points: new Float64Array(0),
            distances: new Float64Array(0),
            units: Uint32Array.of(0),
            closed: false,
        };
    }
    const first = segmentStart(segs[0]!);
    pts.push(first.x, first.y);
    dist.push(0);
    const gapEps = tolerance * 1e-3;
    const addLine = (x: number, y: number) => {
        const n = pts.length;
        const d = Math.hypot(x - pts[n - 2]!, y - pts[n - 1]!);
        unitStarts.push(dist.length - 1);
        pts.push(x, y);
        dist.push(dist[dist.length - 1]! + d);
    };
    for (const s of segs) {
        const st = segmentStart(s);
        const n = pts.length;
        if (Math.hypot(st.x - pts[n - 2]!, st.y - pts[n - 1]!) > gapEps) addLine(st.x, st.y);
        const startIdx = dist.length - 1;
        const d0 = dist[startIdx]!;
        const tmp: number[] = [];
        flattenSegmentInto(s, tolerance, tmp);
        // Chord lengths of the flattened piece, rescaled to the exact segment length.
        const chords: number[] = [];
        let px = pts[pts.length - 2]!;
        let py = pts[pts.length - 1]!;
        let chordSum = 0;
        for (let i = 0; i < tmp.length; i += 2) {
            const c = Math.hypot(tmp[i]! - px, tmp[i + 1]! - py);
            chords.push(c);
            chordSum += c;
            px = tmp[i]!;
            py = tmp[i + 1]!;
        }
        if (!(chordSum > 0)) continue; // zero-length segment: no unit
        const exact = s.kind === "line" ? chordSum : segmentLength(s);
        const f = exact / chordSum;
        unitStarts.push(startIdx);
        spans.push({ s0: d0, s1: d0 + exact, seg: s });
        let acc = 0;
        for (let i = 0; i < chords.length; i++) {
            acc += chords[i]!;
            pts.push(tmp[2 * i]!, tmp[2 * i + 1]!);
            // Last vertex gets the exact end distance (no accumulated rounding).
            dist.push(i + 1 === chords.length ? d0 + exact : d0 + acc * f);
        }
    }
    if (sp.closed) {
        const n = pts.length;
        if (Math.hypot(first.x - pts[n - 2]!, first.y - pts[n - 1]!) > gapEps) addLine(first.x, first.y);
        else {
            // Snap the end exactly onto the start so the seam is watertight.
            pts[n - 2] = first.x;
            pts[n - 1] = first.y;
        }
    }
    const u = units === DashUnits.PerSegment && unitStarts.length > 0 ? unitStarts : [0];
    return {
        points: Float64Array.from(pts),
        distances: Float64Array.from(dist),
        units: Uint32Array.from(u),
        closed: sp.closed && pts.length > 2,
        spans,
    };
}

// ---- Engine ---------------------------------------------------------------------------------

export interface ComplexPlacement {
    /** Anchor after X/Y offsets (note 06 §2.3: end of the carrying element + X along, Y left). */
    readonly x: number;
    readonly y: number;
    /**
     * Anchor before the upright flip (= x, y unless `flipped`). TrueType text turns about its own
     * cell box instead of the gap middle (note 06 §2.3), so its drawer starts from here.
     */
    readonly anchorX: number;
    readonly anchorY: number;
    /** Final element rotation (radians), after the rotation mode. */
    readonly angle: number;
    /** Line direction at the anchor (radians). */
    readonly tangentAngle: number;
    /** True when an upright element was flipped by 180°. */
    readonly flipped: boolean;
    /** Arc-length distance of the (un-offset) anchor along the input. */
    readonly distance: number;
    /** Index of the carrying element in the pattern. */
    readonly elementIndex: number;
    readonly element: ComplexElement;
}

export interface DashOptions {
    /** Fitting strategy; default {@link autocadCandidateFit}. */
    readonly fit?: DashFitStrategy;
    /** Join dashes that touch across a unit boundary (vertex) into one polyline. Default true. */
    readonly joinUnits?: boolean;
    /** `points` (default): dots only in `dots`; `strokes`: dots become dashes of `dotLength`. */
    readonly dotMode?: "points" | "strokes";
    readonly dotLength?: number;
    /** Max dashes + dots + placements before falling back to continuous. Default 1,000,000. */
    readonly maxPrimitives?: number;
    /** Called for every complex element placement (also collected in the result). */
    readonly onComplex?: (p: ComplexPlacement) => void;
    /**
     * Upright (U=) test for a line direction (radians); default: points left. The caller maps
     * directions back into the entity's own coordinates (a mirrored INSERT does not flip).
     */
    readonly upsideDown?: (tangentAngle: number) => boolean;
}

export interface DashResult {
    /** Open polylines, one per (merged) dash, in walking order. */
    readonly dashes: Float64Array[];
    /**
     * `[s0, s1]` distance pair per dash. A dash merged across the seam of a closed input has
     * s0 > s1 (it runs s0 → end → start → s1).
     */
    readonly ranges: Float64Array;
    /** Dots as `x, y, angle` triples (angle = tangent direction, radians). */
    readonly dots: Float64Array;
    readonly placements: ComplexPlacement[];
    /** The primitive limit was hit; everything was drawn continuous instead. */
    readonly tooDense: boolean;
    /**
     * Closed input drawn as one continuous run (short rule or too dense): `dashes[0]` repeats its
     * first point at the end — stroke it as a closed polyline (joins, no caps).
     */
    readonly whole: boolean;
}

export const DEFAULT_MAX_DASH_PRIMITIVES = 1_000_000;

/** Index i with distances[i] ≤ s < distances[i+1] (clamped to the last edge). */
function edgeAt(dist: Float64Array, s: number): number {
    let lo = 0;
    let hi = dist.length - 2;
    if (hi <= 0) return 0;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (dist[mid]! <= s) lo = mid;
        else hi = mid - 1;
    }
    // Skip zero-length edges forward so tangents are defined.
    while (lo < dist.length - 2 && dist[lo + 1]! <= dist[lo]!) lo++;
    return lo;
}

function pointAt(m: MeasuredPolyline, s: number, out: number[]): number {
    const i = edgeAt(m.distances, s);
    const d0 = m.distances[i]!;
    const d1 = m.distances[i + 1] ?? d0;
    const x0 = m.points[2 * i]!;
    const y0 = m.points[2 * i + 1]!;
    const x1 = m.points[2 * i + 2] ?? x0;
    const y1 = m.points[2 * i + 3] ?? y0;
    if (s <= d0) out.push(x0, y0);
    else if (s >= d1) out.push(x1, y1);
    else {
        const t = (s - d0) / (d1 - d0);
        out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
    return i;
}

function tangentAt(m: MeasuredPolyline, s: number): number {
    const i = edgeAt(m.distances, s);
    const dx = (m.points[2 * i + 2] ?? m.points[2 * i]!) - m.points[2 * i]!;
    const dy = (m.points[2 * i + 3] ?? m.points[2 * i + 1]!) - m.points[2 * i + 1]!;
    return Math.atan2(dy, dx);
}

/** Sub-polyline between distances s0 < s1. */
function extract(m: MeasuredPolyline, s0: number, s1: number, out: number[]): void {
    const i0 = pointAt(m, s0, out);
    const dist = m.distances;
    for (let i = i0 + 1; i < dist.length && dist[i]! < s1; i++) {
        if (dist[i]! <= s0) continue;
        out.push(m.points[2 * i]!, m.points[2 * i + 1]!);
    }
    pointAt(m, s1, out);
}

/**
 * Exact point and tangent direction at distance s on a circular arc span (arc length is linear in
 * the angle), or undefined for other segments (the chord interpolation is used then).
 */
function exactOnArc(m: MeasuredPolyline, s: number): { x: number; y: number; angle: number } | undefined {
    const spans = m.spans;
    if (!spans || spans.length === 0) return undefined;
    let lo = 0;
    let hi = spans.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (spans[mid]!.s0 <= s) lo = mid;
        else hi = mid - 1;
    }
    const sp = spans[lo]!;
    if (s < sp.s0 - 1e-9 || s > sp.s1 + 1e-9 || !(sp.s1 > sp.s0)) return undefined;
    const g = sp.seg;
    const f = Math.min(1, Math.max(0, (s - sp.s0) / (sp.s1 - sp.s0)));
    if (g.kind === "arc") {
        const t = g.start + g.sweep * f;
        const dir = g.sweep >= 0 ? Math.PI / 2 : -Math.PI / 2;
        return {
            x: g.center.x + g.radius * Math.cos(t),
            y: g.center.y + g.radius * Math.sin(t),
            angle: t + dir,
        };
    }
    if (g.kind === "ellipticArc") {
        const lu = Math.hypot(g.u.x, g.u.y);
        const lv = Math.hypot(g.v.x, g.v.y);
        const dot = g.u.x * g.v.x + g.u.y * g.v.y;
        if (Math.abs(lu - lv) > 1e-9 * lu || Math.abs(dot) > 1e-9 * lu * lu) return undefined;
        const t = g.start + g.sweep * f;
        const c = Math.cos(t);
        const n = Math.sin(t);
        const k = g.sweep >= 0 ? 1 : -1;
        return {
            x: g.center.x + g.u.x * c + g.v.x * n,
            y: g.center.y + g.u.y * c + g.v.y * n,
            angle: Math.atan2(k * (-g.u.y * n + g.v.y * c), k * (-g.u.x * n + g.v.x * c)),
        };
    }
    return undefined;
}

/** Pen-up span [g0, g1] around s between the merged dash intervals (s0, s1, unit triples). */
function gapAround(merged: readonly number[], s: number, total: number, closed: boolean): [number, number] {
    let g0 = 0;
    let g1 = total;
    let before = -1;
    let after = -1;
    for (let i = 0; i < merged.length; i += 3) {
        if (merged[i + 1]! <= s + 1e-12 * Math.max(1, total)) before = i;
        else if (merged[i]! >= s) {
            after = i;
            break;
        } else return [s, s]; // inside a dash: turn about the anchor
    }
    if (before >= 0) g0 = merged[before + 1]!;
    else if (closed && merged.length > 0) g0 = merged[merged.length - 2]! - total;
    if (after >= 0) g1 = merged[after]!;
    else if (closed && merged.length > 0) g1 = merged[0]! + total;
    return [g0, g1];
}

/**
 * Does a line direction make upright elements read upside down? Only when it points left:
 * exactly vertical lines keep the direction (up and down). VERIFIED-BY-ACAD
 * (linetypes/ctext-orient-u-*: lines at 85/90/270/275 keep, 95/180/265 flip).
 */
function upsideDown(a: number): boolean {
    return Math.cos(a) < -1e-9;
}

/** Apply a pattern along a measured polyline. */
export function dashMeasured(
    m: MeasuredPolyline,
    pattern: DashPattern,
    options: DashOptions = {},
): DashResult {
    const fit = options.fit ?? autocadCandidateFit;
    const limit = options.maxPrimitives ?? DEFAULT_MAX_DASH_PRIMITIVES;
    const joinUnits = options.joinUnits ?? true;
    const dist = m.distances;
    const nPts = dist.length;
    const total = nPts > 0 ? dist[nPts - 1]! : 0;
    // Dash intervals as (s0, s1, unit) triples in walking order.
    let intervals: number[] = [];
    let dotS: number[] = [];
    let complexS: { s: number; el: ComplexElement; idx: number }[] = [];
    let tooDense = false;
    let count = 0;

    const unitCount = m.units.length;
    const singleClosedUnit = m.closed && unitCount === 1;
    for (let u = 0; u < unitCount; u++) {
        const startIdx = m.units[u]!;
        const endIdx = u + 1 < unitCount ? m.units[u + 1]! : nPts - 1;
        const off = dist[startIdx]!;
        const L = dist[endIdx]! - off;
        if (!(L > 0)) continue;
        const f = fit(L, pattern, singleClosedUnit);
        if (f.kind === "continuous") {
            intervals.push(off, off + L, u);
            continue;
        }
        const head = Math.min(Math.max(f.head, 0), L);
        const iEnd = Math.min(Math.max(f.interiorEnd ?? L - Math.max(f.tail, 0), head), L);
        const tailEnd = Math.min(iEnd + Math.max(f.tail, 0), L);
        const pat = f.scale !== undefined && f.scale !== 1 ? scaledPattern(pattern, f.scale) : pattern;
        if (f.endDots) dotS.push(off);
        else if (head > 0) intervals.push(off, off + head, u);
        const sink: PatternEventSink = {
            dash: (a, b) => intervals.push(off + a, off + b, u),
            dot: (s) => dotS.push(off + s),
            complex: (s, el, idx) => complexS.push({ s: off + s, el, idx }),
        };
        const c = walkPattern(
            pat,
            f.phase,
            head,
            iEnd,
            sink,
            limit - count,
            head > 0 || f.endDots === true,
            tailEnd > iEnd || f.endDots === true,
        );
        if (c < 0) {
            tooDense = true;
            break;
        }
        count += c;
        if (f.endDots) dotS.push(off + Math.min(L, iEnd + head));
        else if (tailEnd > iEnd) intervals.push(off + iEnd, off + tailEnd, u);
    }
    if (tooDense) {
        intervals = total > 0 ? [0, total, 0] : [];
        dotS = [];
        complexS = [];
    }

    // Merge touching intervals of one unit always, across units only with `joinUnits`.
    const eps = (total > 0 ? total : 1) * 1e-12;
    const merged: number[] = [];
    for (let i = 0; i < intervals.length; i += 3) {
        const a = intervals[i]!;
        const b = intervals[i + 1]!;
        const u = intervals[i + 2]!;
        const n = merged.length;
        if (n > 0 && a <= merged[n - 2]! + eps && (joinUnits || merged[n - 1] === u)) {
            if (b > merged[n - 2]!) merged[n - 2] = b;
            merged[n - 1] = u;
        } else merged.push(a, b, u);
    }

    const dashes: Float64Array[] = [];
    const ranges: number[] = [];
    const nm = merged.length / 3;
    const whole = m.closed && nm === 1 && merged[0]! <= eps && merged[1]! >= total - eps;
    const seam =
        m.closed &&
        nm >= 2 &&
        (joinUnits || singleClosedUnit) &&
        merged[0]! <= eps &&
        merged[3 * (nm - 1) + 1]! >= total - eps;
    for (let k = seam ? 1 : 0; k < (seam ? nm - 1 : nm); k++) {
        const out: number[] = [];
        extract(m, merged[3 * k]!, merged[3 * k + 1]!, out);
        dashes.push(Float64Array.from(out));
        ranges.push(merged[3 * k]!, merged[3 * k + 1]!);
    }
    if (seam) {
        const a = merged[3 * (nm - 1)]!;
        const b = merged[1]!;
        const out: number[] = [];
        extract(m, a, total, out);
        const head: number[] = [];
        extract(m, 0, b, head);
        for (let i = 2; i < head.length; i++) out.push(head[i]!);
        dashes.push(Float64Array.from(out));
        ranges.push(a, b);
    }

    const tmp: number[] = [];
    const dots: number[] = [];
    const strokeDots = options.dotMode === "strokes";
    const dotHalf = (options.dotLength ?? 0) / 2;
    for (const s of dotS) {
        tmp.length = 0;
        pointAt(m, s, tmp);
        const a = tangentAt(m, s);
        if (strokeDots) {
            const dx = Math.cos(a) * dotHalf;
            const dy = Math.sin(a) * dotHalf;
            dashes.push(Float64Array.of(tmp[0]! - dx, tmp[1]! - dy, tmp[0]! + dx, tmp[1]! + dy));
            ranges.push(s - dotHalf, s + dotHalf);
        } else dots.push(tmp[0]!, tmp[1]!, a);
    }

    const placements: ComplexPlacement[] = [];
    const frame = (s: number): { x: number; y: number; t: number } => {
        const ex = exactOnArc(m, s);
        if (ex) return { x: ex.x, y: ex.y, t: ex.angle };
        tmp.length = 0;
        pointAt(m, s, tmp);
        return { x: tmp[0]!, y: tmp[1]!, t: tangentAt(m, s) };
    };
    for (const c of complexS) {
        const a = frame(c.s);
        const el = c.el;
        const t = a.t;
        const ct = Math.cos(t);
        const st = Math.sin(t);
        // X/Y offsets in the line frame, rotation about the anchor (note 06 §2.3).
        let x = a.x + ct * el.offsetX - st * el.offsetY;
        let y = a.y + st * el.offsetX + ct * el.offsetY;
        let angle = t + el.rotation;
        let flipped = false;
        const anchorX = x;
        const anchorY = y;
        if (el.rotationMode === ComplexRotation.Absolute) angle = el.rotation;
        else if (el.rotationMode === ComplexRotation.Upright && (options.upsideDown ?? upsideDown)(t)) {
            // An upright element that would read upside down is turned by 180° about the middle of the
            // pen-up span around its anchor: on a straight line that is exactly where a reversed line
            // puts it. VERIFIED-BY-ACAD for SHX text (simplex.shx standing in for a TTF: linetypes/
            // ctext-orient-u-*, ctext-gasline-shapes circle, references before 2026-10-01); TrueType
            // text turns about its cell box centre instead (complex-linetype.ts, note 06 §2.3)
            const [g0, g1] = gapAround(merged, c.s, total, m.closed);
            const q = frame(((((g0 + g1) / 2) % total) + total) % total);
            x = 2 * q.x - x;
            y = 2 * q.y - y;
            angle += Math.PI;
            flipped = true;
        }
        const p: ComplexPlacement = {
            x,
            y,
            anchorX,
            anchorY,
            angle,
            tangentAngle: t,
            flipped,
            distance: c.s,
            elementIndex: c.idx,
            element: el,
        };
        placements.push(p);
        options.onComplex?.(p);
    }
    return {
        dashes,
        ranges: Float64Array.from(ranges),
        dots: Float64Array.from(dots),
        placements,
        tooDense,
        whole,
    };
}

/** Dash a plain polyline (see {@link measurePolyline} for `units`). */
export function dashPolyline(
    points: Float64Array,
    pattern: DashPattern,
    options: DashOptions & { readonly closed?: boolean; readonly units?: DashUnits } = {},
): DashResult {
    return dashMeasured(measurePolyline(points, options.closed ?? false, options.units), pattern, options);
}

/** Dash every subpath of a path (exact arc lengths, see module comment). */
export function dashPath(
    path: Path2,
    pattern: DashPattern,
    tolerance: number,
    options: DashOptions & { readonly units?: DashUnits } = {},
): DashResult[] {
    return path.subpaths.map((sp) =>
        dashMeasured(measureSubpath(sp, tolerance, options.units), pattern, options),
    );
}
