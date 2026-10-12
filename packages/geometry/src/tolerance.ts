/**
 * Tolerance constants shared by the geometry kernel.
 *
 * All geometry is float64 (AGENTS.md). Constants are grouped by what they compare:
 * - AutoCAD-defined thresholds that must be reproduced bit-exactly (the 1/64 polar cap of the
 *   arbitrary axis algorithm, note 03 §2.2);
 * - generic numeric guards (division by ~0, parallel vectors);
 * - device-space flattening defaults (note 03 §5.3: sagitta ≤ 0.1 px).
 */

/** Arbitrary axis algorithm polar cap, `|Nx| < 1/64 && |Ny| < 1/64` (strict `<`, note 03 §2.2). */
export const AAA_THRESHOLD = 1 / 64;

/** Guard for "is this length/determinant zero" on unit-scale quantities. */
export const EPSILON = 1e-12;

/** Relative tolerance for "these two doubles are the same value" (e.g. similarity detection). */
export const REL_EPSILON = 1e-10;

/**
 * Default device-space chord tolerance in pixels (max sagitta). Note 03 §5.3: stay well below
 * 0.5 px so that aliased rasterization flips no pixel centre; aim for ≤ 0.1 px.
 */
export const DEFAULT_DEVICE_TOLERANCE_PX = 0.1;

/**
 * Hard upper bound for the number of line segments a single curve piece may be flattened into.
 * A count limit (not a time limit) keeps the output deterministic (AGENTS.md) and bounds memory
 * when a caller passes an absurdly small tolerance.
 */
export const MAX_SEGMENTS_PER_CURVE = 1 << 16;

/** Maximum recursion depth for adaptive (hull-based) subdivision; 2^20 pieces per Bézier. */
export const MAX_SUBDIVISION_DEPTH = 20;

/** True when `|a - b| <= abs + rel * max(|a|, |b|)`. */
export function isClose(a: number, b: number, rel = REL_EPSILON, abs = EPSILON): boolean {
    return Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
}
