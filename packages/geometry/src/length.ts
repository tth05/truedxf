/**
 * Arc length of path segments — needed by the linetype engine, whose dashes run along the curve
 * by arc length (note 03 §5.3: "Linetype dashes along curves need arc length parameterization").
 *
 * Lines and circular arcs are exact. Other kinds integrate |C'(t)| with adaptive Gauss–Legendre
 * quadrature (8 nodes): an interval is accepted when its estimate agrees with the sum of its two
 * halves to `rel` relative accuracy; depth-limited, so the result is deterministic.
 * NURBS are integrated per Bézier piece (smooth inside each piece).
 */

import { bezierDerivative, isRationalBezier } from "./bezier.ts";
import { type PathSegment, type Subpath, segmentDerivativeAt, segmentEnd, segmentStart } from "./path.ts";

// 8-point Gauss–Legendre nodes/weights on [−1, 1].
const GL_X = [
    -0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498, 0.1834346424956498,
    0.525532409916329, 0.7966664774136267, 0.9602898564975363,
];
const GL_W = [
    0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362,
    0.3137066458778873, 0.2223810344533745, 0.1012285362903763,
];

function gauss(f: (t: number) => number, a: number, b: number): number {
    const h = (b - a) / 2;
    const m = (a + b) / 2;
    let s = 0;
    for (let i = 0; i < 8; i++) s += GL_W[i]! * f(m + h * GL_X[i]!);
    return s * h;
}

/** Adaptive integral of `f` over [a, b]. */
export function integrate(
    f: (t: number) => number,
    a: number,
    b: number,
    rel = 1e-12,
    maxDepth = 24,
): number {
    const rec = (a: number, b: number, whole: number, depth: number): number => {
        const m = (a + b) / 2;
        const l = gauss(f, a, m);
        const r = gauss(f, m, b);
        const both = l + r;
        if (depth >= maxDepth || Math.abs(both - whole) <= rel * Math.abs(both)) return both;
        return rec(a, m, l, depth + 1) + rec(m, b, r, depth + 1);
    };
    return rec(a, b, gauss(f, a, b), 0);
}

export function segmentLength(s: PathSegment, rel = 1e-12): number {
    switch (s.kind) {
        case "line":
            return Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y);
        case "arc":
            return Math.abs(s.radius * s.sweep);
        case "nurbs": {
            let total = 0;
            for (const piece of s.curve.bezierSegments()) {
                if (!isRationalBezier(piece)) {
                    const d = bezierDerivative(piece);
                    const n = d.degree;
                    total += integrate(
                        (t) => {
                            // de Casteljau on the hodograph (2D)
                            const tmp = Float64Array.from(d.points);
                            for (let r = 1; r <= n; r++) {
                                for (let i = 0; i <= n - r; i++) {
                                    tmp[2 * i] = (1 - t) * tmp[2 * i]! + t * tmp[2 * i + 2]!;
                                    tmp[2 * i + 1] = (1 - t) * tmp[2 * i + 1]! + t * tmp[2 * i + 3]!;
                                }
                            }
                            return Math.hypot(tmp[0]!, tmp[1]!);
                        },
                        0,
                        1,
                        rel,
                    );
                } else {
                    const c = s.curve;
                    total += integrate(
                        (u) => {
                            const d = c.derivativesAt(u, 1)[1]!;
                            return Math.hypot(d[0]!, d[1]!);
                        },
                        piece.u0,
                        piece.u1,
                        rel,
                    );
                }
            }
            return total;
        }
        default:
            return integrate(
                (t) => {
                    const d = segmentDerivativeAt(s, t);
                    return Math.hypot(d.x, d.y);
                },
                0,
                1,
                rel,
            );
    }
}

/** Total length of a subpath, including the implicit closing edge of a closed subpath. */
export function subpathLength(sp: Subpath, rel = 1e-12): number {
    let total = 0;
    for (const s of sp.segments) total += segmentLength(s, rel);
    if (sp.closed && sp.segments.length > 0) {
        const first = sp.segments[0]!;
        const last = sp.segments[sp.segments.length - 1]!;
        const a = segmentEnd(last);
        const b = segmentStart(first);
        total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return total;
}
