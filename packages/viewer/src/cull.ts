/** Viewer bounds come from output, so INSERT transforms and widening are already applied. */
import type { DisplayList } from "@truedxf/render";
import type { Rect } from "./view.ts";

export function intersects(a: Rect, b: Rect, padding = 0): boolean {
    return (
        a.maxX + padding >= b.minX &&
        a.minX - padding <= b.maxX &&
        a.maxY + padding >= b.minY &&
        a.minY - padding <= b.maxY
    );
}

export function contains(r: Rect, x: number, y: number): boolean {
    return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

export function expandView(r: Rect): Rect {
    const w = r.maxX - r.minX;
    const h = r.maxY - r.minY;
    return { minX: r.minX - w, minY: r.minY - h, maxX: r.maxX + w, maxY: r.maxY + h };
}

/** Trigger with 25% of the coverage width/height still available as a pan margin. */
export function needsCoverage(view: Rect, covered: Rect): boolean {
    const x = (covered.maxX - covered.minX) * 0.25;
    const y = (covered.maxY - covered.minY) * 0.25;
    return (
        view.minX <= covered.minX + x ||
        view.maxX >= covered.maxX - x ||
        view.minY <= covered.minY + y ||
        view.maxY >= covered.maxY - y
    );
}

export function entityBounds(list: DisplayList): Map<string, Rect> {
    const bounds = new Map<string, Rect>();
    const unbounded = new Set<string>();
    for (const b of list.batches) {
        for (let k = 0; k < b.pick.length; k += 3) {
            const handle = list.entities[b.pick[k + 2]!]!;
            if (b.unbounded) {
                unbounded.add(handle);
                continue;
            }
            const first = b.pick[k]! * 2;
            const end = first + b.pick[k + 1]! * 2;
            let r = bounds.get(handle);
            for (let i = first; i < end; i += 2) {
                const x = b.positions[i]! + b.originX;
                const y = b.positions[i + 1]! + b.originY;
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    unbounded.add(handle);
                    continue;
                }
                if (!r) {
                    r = { minX: x, minY: y, maxX: x, maxY: y };
                    bounds.set(handle, r);
                } else {
                    r.minX = Math.min(r.minX, x);
                    r.maxX = Math.max(r.maxX, x);
                    r.minY = Math.min(r.minY, y);
                    r.maxY = Math.max(r.maxY, y);
                }
            }
        }
    }
    // XLINE/RAY geometry is extended for the render window; cached endpoints aren't bounds.
    for (const handle of unbounded) bounds.delete(handle);
    // A handle can occur in multiple viewports: union their output in paper coordinates
    // (note 08 §3.5). Do not intersect with viewport clips: partial fits can underbound it.
    return bounds;
}
