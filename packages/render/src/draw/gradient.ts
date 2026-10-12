/**
 * Gradient hatch fills (450 = 1; note 06 §1.7). The colour is a function of one scalar
 * coordinate q per gradient type, in a frame rotated by 460 about the fill's bounding box:
 *
 * | type | q | f(q) |
 * |---|---|---|
 * | LINEAR | x′ across the rotated extent, t ∈ [0, 1] | t |
 * | CYLINDER | same | sin(π t) |
 * | SPHERICAL | distance d from the box centre, R = half the larger box side | cos(π/2 · min(1, d/R)) |
 * | HEMISPHERICAL | d from a centre S/2 below the box centre, R = S = max(rotated width, unrotated height) | cos(π/2 · min(1, d/R)) |
 * | CURVED | s = w − 0.1125·q², w = 0 at the top edge, q = x′ / half width | sin(π/2 · clamp(s)) |
 * | INV… | as above | 1 − f |
 *
 * 461 ≠ 0 ("not centred"): 1D types move their middle to t = 0.3125 and stretch the second half
 * to 0.703; SPHERICAL moves the centre by (−R/2, +R/2) (up and left), HEMISPHERICAL by −R/2
 * along the rotated x axis. Colours are interpolated
 * per channel in sRGB between the two stored 421 colours (the tint 462 is not re-applied).
 * VERIFIED-BY-ACAD (2026-09-30) for rotation 0 on `hatches/gradient-*`: LINEAR/CYLINDER/SPHERICAL
 * profiles, projected-extent normalisation at 45°, sRGB interpolation, stored second colour,
 * spherical shift. APPROXIMATIONS: AutoCAD Gouraud-shades its own triangle mesh with an ordered
 * dither, so values deviate by a few levels, rotated gradients (30°) are slightly bent, and the
 * HEMISPHERICAL (VERIFIED-BY-ACAD to ≤ 3.7 levels incl. shifted and rotated) and CURVED fits
 * are empirical.
 *
 * The fill is emitted as constant-colour bands (one per rounded colour) clipped to the hatch
 * region, so it works in every renderer and at every resolution.
 */
import { BooleanOp, booleanPolygons, FillRule, triangulateFill } from "@truedxf/geometry";
import type { HatchGradient } from "@truedxf/model";
import { plotAciToRgb } from "../aci.ts";
import type { Rgba } from "../displaylist.ts";
import type { Frontend } from "../frontend.ts";

type Rgb = readonly [number, number, number];

// Gradient colours never take a plot style pen, not even ACI ones (VERIFIED-BY-ACAD
// plotstyles/gradient-pens-*, note 06 §1.7).
function gradientColors(g: HatchGradient): [Rgb, Rgb] {
    const cs = [...g.colors].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const conv = (c: (typeof cs)[number] | undefined): Rgb => {
        if (!c) return [0, 0, 0];
        if (c.rgb !== undefined) return [(c.rgb >> 16) & 255, (c.rgb >> 8) & 255, c.rgb & 255];
        const [r, gg, b] = plotAciToRgb(c.aci ?? 7);
        return [r, gg, b];
    };
    const c1 = conv(cs[0]);
    return [c1, cs.length > 1 ? conv(cs[1]) : c1];
}

const SHIFT_MID = 0.3125;
const SHIFT_REST = 0.703125;

interface Field {
    /** Range of the band coordinate q. */
    readonly q0: number;
    readonly q1: number;
    /** Mix factor (0 = colour 1, 1 = colour 2) at q. */
    f(q: number): number;
    /** Band polygon(s) for q ∈ [a, b] in the rotated frame. */
    band(a: number, b: number): Float64Array[];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function circle(cx: number, cy: number, r: number, n: number, reverse = false): Float64Array {
    const out = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
        const a = ((reverse ? -i : i) * 2 * Math.PI) / n;
        out[i * 2] = cx + r * Math.cos(a);
        out[i * 2 + 1] = cy + r * Math.sin(a);
    }
    return out;
}

function makeField(
    name: string,
    shifted: boolean,
    box: { x0: number; y0: number; x1: number; y1: number },
    tol: number,
    /** Height of the target-aligned (unrotated) bounding box. */
    unrotatedHeight: number,
): Field {
    const inv = name.startsWith("INV");
    const base = inv ? name.slice(3) : name;
    const W = box.x1 - box.x0;
    const H = box.y1 - box.y0;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const pad = Math.max(W, H) * 0.01 + tol;
    const out = (v: number) => (inv ? 1 - v : v);
    const segs = (r: number) =>
        Math.max(16, Math.min(2048, Math.ceil(Math.PI / Math.acos(Math.max(0, 1 - tol / Math.max(r, tol))))));
    if (base === "SPHERICAL" || base === "HEMISPHERICAL") {
        let R = Math.max(W, H) / 2;
        let ox = cx;
        let oy = cy;
        if (shifted) {
            ox -= R / 2;
            oy += R / 2;
        }
        if (base === "HEMISPHERICAL") {
            // size S = max(extent along the rotated x axis, unrotated height H₀); centre (0, −S/2) from
            // the box centre (the frame origin) in the rotated frame, R = S; shifted moves the centre
            // by −S/2 along the rotated x axis only. Empirical fit, VERIFIED-BY-ACAD 2026-10-01 to
            // mean |Δ| ≤ 3.7 levels: hatches/gradient-{inv,}hemispherical-shift{0,1}-a{0,45} and local
            // hatch-probes/hemi-{tall,wide,square}-shift{0,1}-a{0,30} (note 06 §1.7.1)
            R = Math.max(W, unrotatedHeight);
            ox = shifted ? -R / 2 : 0;
            oy = -R / 2;
        }
        let dmax = 0;
        for (const [x, y] of [
            [box.x0, box.y0],
            [box.x1, box.y0],
            [box.x0, box.y1],
            [box.x1, box.y1],
        ] as const)
            dmax = Math.max(dmax, Math.hypot(x - ox, y - oy));
        const dmin =
            ox >= box.x0 && ox <= box.x1 && oy >= box.y0 && oy <= box.y1 ? 0 : distToBox(ox, oy, box);
        return {
            q0: dmin,
            q1: dmax + pad,
            f: (d) => out(Math.cos((Math.PI / 2) * Math.min(1, d / R))),
            band: (a, b) =>
                a <= 0
                    ? [circle(ox, oy, b, segs(b))]
                    : [circle(ox, oy, b, segs(b)), circle(ox, oy, a, segs(a), true)],
        };
    }
    if (base === "CURVED") {
        const k = 0.1125;
        const n = 256;
        const sAt = (x: number, y: number) => (box.y1 - y) / H - k * ((x - cx) / (W / 2)) ** 2;
        const yAt = (s: number, x: number) => box.y1 - H * (s + k * ((x - cx) / (W / 2)) ** 2);
        const xs: number[] = [];
        for (let i = 0; i <= n; i++) xs.push(box.x0 - pad + ((W + 2 * pad) * i) / n);
        return {
            q0: sAt(box.x0, box.y1) - 0.01,
            q1: sAt(cx, box.y0) + 0.01,
            f: (s) => out(Math.sin((Math.PI / 2) * clamp01(s))),
            band: (a, b) => {
                const r = new Float64Array(xs.length * 2 * 2);
                let k2 = 0;
                for (const x of xs) {
                    r[k2++] = x;
                    r[k2++] = yAt(a, x);
                }
                for (let i = xs.length - 1; i >= 0; i--) {
                    r[k2++] = xs[i]!;
                    r[k2++] = yAt(b, xs[i]!);
                }
                return [r];
            },
        };
    }
    // 1D types: LINEAR, CYLINDER (unknown names fall back to LINEAR)
    const cyl = base === "CYLINDER";
    const tAt = (x: number) => {
        let t = (x - box.x0) / W;
        if (shifted) t = t < SHIFT_MID ? (0.5 * t) / SHIFT_MID : 0.5 + (0.5 * (t - SHIFT_MID)) / SHIFT_REST;
        return clamp01(t);
    };
    return {
        q0: box.x0 - pad,
        q1: box.x1 + pad,
        f: (x) => out(cyl ? Math.sin(Math.PI * tAt(x)) : tAt(x)),
        band: (a, b) => [Float64Array.of(a, box.y0 - pad, b, box.y0 - pad, b, box.y1 + pad, a, box.y1 + pad)],
    };
}

function distToBox(x: number, y: number, b: { x0: number; y0: number; x1: number; y1: number }): number {
    const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
    const dy = y < b.y0 ? b.y0 - y : y > b.y1 ? y - b.y1 : 0;
    return Math.hypot(dx, dy);
}

/** Fills the selected hatch rings (target coordinates, even-odd) with a gradient. */
export function fillGradient(fe: Frontend, rings: readonly Float64Array[], g: HatchGradient): void {
    if (rings.length === 0) return;
    const [c1, c2] = gradientColors(g);
    // rotated frame about the centre of the target bounding box
    let bx0 = Number.POSITIVE_INFINITY;
    let by0 = Number.POSITIVE_INFINITY;
    let bx1 = Number.NEGATIVE_INFINITY;
    let by1 = Number.NEGATIVE_INFINITY;
    for (const r of rings)
        for (let i = 0; i + 1 < r.length; i += 2) {
            bx0 = Math.min(bx0, r[i]!);
            bx1 = Math.max(bx1, r[i]!);
            by0 = Math.min(by0, r[i + 1]!);
            by1 = Math.max(by1, r[i + 1]!);
        }
    const ocx = (bx0 + bx1) / 2;
    const ocy = (by0 + by1) / 2;
    const cos = Math.cos(g.rotation);
    const sin = Math.sin(g.rotation);
    const toFrame = (x: number, y: number): [number, number] => [
        (x - ocx) * cos + (y - ocy) * sin,
        -(x - ocx) * sin + (y - ocy) * cos,
    ];
    const frameRings = rings.map((r) => {
        const o = new Float64Array(r.length);
        for (let i = 0; i + 1 < r.length; i += 2) {
            const [u, v] = toFrame(r[i]!, r[i + 1]!);
            o[i] = u;
            o[i + 1] = v;
        }
        return o;
    });
    const box = {
        x0: Number.POSITIVE_INFINITY,
        y0: Number.POSITIVE_INFINITY,
        x1: Number.NEGATIVE_INFINITY,
        y1: Number.NEGATIVE_INFINITY,
    };
    for (const r of frameRings)
        for (let i = 0; i + 1 < r.length; i += 2) {
            box.x0 = Math.min(box.x0, r[i]!);
            box.x1 = Math.max(box.x1, r[i]!);
            box.y0 = Math.min(box.y0, r[i + 1]!);
            box.y1 = Math.max(box.y1, r[i + 1]!);
        }
    if (!(box.x1 > box.x0 && box.y1 > box.y0)) return;
    const field = makeField(g.name.toUpperCase() || "LINEAR", g.shift !== 0, box, fe.tolerance, by1 - by0);
    const colorAt = (q: number): Rgba => {
        const f = field.f(q);
        return [
            Math.round(c1[0] + (c2[0] - c1[0]) * f),
            Math.round(c1[1] + (c2[1] - c1[1]) * f),
            Math.round(c1[2] + (c2[2] - c1[2]) * f),
            255,
        ];
    };
    // colour runs along q (sampled finely; band edges accurate to 1/4096 of the range)
    const N = 4096;
    const same = (a: Rgba, b: Rgba) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    const bands: { a: number; b: number; color: Rgba }[] = [];
    let start = field.q0;
    let cur = colorAt(field.q0);
    for (let i = 1; i <= N; i++) {
        const q = field.q0 + ((field.q1 - field.q0) * i) / N;
        const qm = field.q0 + ((field.q1 - field.q0) * (i - 0.5)) / N;
        const c = colorAt(i === N ? q : qm);
        if (!same(c, cur) || i === N) {
            const end = i === N ? q : field.q0 + ((field.q1 - field.q0) * (i - 1)) / N;
            if (end > start) bands.push({ a: start, b: end, color: cur });
            start = end;
            cur = c;
        }
    }
    const back = (r: Float64Array): Float64Array => {
        const o = new Float64Array(r.length);
        for (let i = 0; i + 1 < r.length; i += 2) {
            o[i] = ocx + r[i]! * cos - r[i + 1]! * sin;
            o[i + 1] = ocy + r[i]! * sin + r[i + 1]! * cos;
        }
        return o;
    };
    const tol = fe.tolerance / 4;
    for (const band of bands) {
        const polys = booleanPolygons(BooleanOp.Intersection, field.band(band.a, band.b), frameRings, {
            tolerance: tol,
            subjectFillRule: FillRule.EvenOdd,
            clipFillRule: FillRule.EvenOdd,
        });
        if (polys.length === 0) continue;
        const rr = polys.flatMap((p) => [back(p.outer), ...p.holes.map(back)]);
        fe.fillTriangles(triangulateFill(rr, { fillRule: FillRule.EvenOdd, tolerance: tol }), band.color);
    }
}
