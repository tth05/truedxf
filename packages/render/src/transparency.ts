/**
 * Plotted transparency (note 06 §4).
 *
 * VERIFIED-BY-ACAD (transparency suite, 2026-09-30):
 * - PLOTTRANSPARENCYOVERRIDE 0 plots everything opaque, even with the page-setup flag set
 *   (transparency/entity-050-plot-off, layouts/pagesetup-plottransparency); 2 always plots
 *   transparency; 1 follows the page setup: LAYOUT XDATA `1001 PLOTTRANSPARENCY / 1071 1`.
 *   PlotRequest.sysvars defaults to 0 like the reference harness prologue (docs/fixtures.md);
 *   pass 1 for AutoCAD's out-of-the-box behaviour.
 * - Blending over what is already drawn, per 8-bit channel, alpha a = 440 & 0xFF:
 *   out = (src·a + dst·(256 − a)) >> 8 (entity-025/050/075/090, overlap-same-color, layer-070).
 * - Layer transparency (AcCmTransparency XDATA) applies to BYLAYER entities; BYBLOCK takes the
 *   INSERT's (layer-070, byblock-*).
 * Each entity blends once per pixel (its coverage is a pixel set), so overlapping parts of one
 * entity (joints, round caps) do not darken twice.
 */
import type { DxfDocument } from "@truedxf/model";
import { type DisplayList, PrimitiveKind } from "./displaylist.ts";
import type { PlotRequest } from "./plot.ts";
import type { PixelGrid } from "./raster.ts";

export function plotsTransparency(doc: DxfDocument, request: PlotRequest): boolean {
    const override = Number(request.sysvars?.PLOTTRANSPARENCYOVERRIDE ?? 0);
    if (override === 0) return false;
    if (override === 2) return true;
    const key = request.layout.toUpperCase();
    const layout = doc.layouts.find((l) => l.name.toUpperCase() === key || (key === "MODEL" && l.isModel));
    const rec = layout?.object?.record;
    const part = rec?.xdata("PLOTTRANSPARENCY");
    if (!rec || !part) return false;
    for (const i of rec.partTags(part)) if (rec.store.codes[i] === 1071) return rec.store.int(i) !== 0;
    return false;
}

/** Pixel-centre points and their colours. */
export interface Coverage {
    xy: Float64Array;
    rgba: Uint8Array;
}

/**
 * Pixel coverage of a captured display list (one entity), one unit per batch (the capture
 * breaks batches between blend units), last writer wins inside a unit. Coverage rules match the
 * renderers: points light their pixel, triangles cover pixels whose centre is inside
 * (top-left rule).
 */
export function coverage(list: DisplayList, grid: PixelGrid): Coverage[] {
    return list.batches.map((b) => unitCoverage(b, grid));
}

function unitCoverage(b: DisplayList["batches"][number], grid: PixelGrid): Coverage {
    const w = grid.width;
    const h = grid.height;
    const px = new Map<number, number>();
    const cols: number[] = [];
    const set = (i: number, j: number, c: Uint8Array, k: number) => {
        if (i < 0 || j < 0 || i >= w || j >= h) return;
        const key = j * w + i;
        let slot = px.get(key);
        if (slot === undefined) {
            slot = cols.length;
            px.set(key, slot);
            cols.push(0, 0, 0, 0);
        }
        cols[slot] = c[k]!;
        cols[slot + 1] = c[k + 1]!;
        cols[slot + 2] = c[k + 2]!;
        cols[slot + 3] = c[k + 3]!;
    };
    {
        const pos = b.positions;
        const n = pos.length >> 1;
        const X = (k: number) => (b.originX + pos[k * 2]! - grid.minX) / grid.pixelSize;
        const Y = (k: number) => (b.originY + pos[k * 2 + 1]! - grid.minY) / grid.pixelSize;
        if (b.kind === PrimitiveKind.Points) {
            for (let k = 0; k < n; k++) set(Math.floor(X(k)), Math.floor(Y(k)), b.colors, k * 4);
        } else if (b.kind === PrimitiveKind.Triangles) {
            for (let k = 0; k + 2 < n; k += 3)
                triangle(X(k), Y(k), X(k + 1), Y(k + 1), X(k + 2), Y(k + 2), w, h, (i, j) =>
                    set(i, j, b.colors, k * 4),
                );
        }
    }
    const xy = new Float64Array(px.size * 2);
    const rgba = new Uint8Array(px.size * 4);
    let o = 0;
    for (const [key, slot] of px) {
        xy[o * 2] = grid.cx(key % w);
        xy[o * 2 + 1] = grid.cy(Math.floor(key / w));
        rgba.set(cols.slice(slot, slot + 4), o * 4);
        o++;
    }
    return { xy, rgba };
}

function triangle(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    w: number,
    h: number,
    plot: (i: number, j: number) => void,
): void {
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) return;
    if (area < 0) {
        [x1, x2] = [x2, x1];
        [y1, y2] = [y2, y1];
    }
    const minI = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxI = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minJ = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxJ = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
    const edge = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
        (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    const inc = (ax: number, ay: number, bx: number, by: number) => (ay === by ? bx < ax : by < ay);
    const t0 = inc(x1, y1, x2, y2);
    const t1 = inc(x2, y2, x0, y0);
    const t2 = inc(x0, y0, x1, y1);
    for (let j = minJ; j <= maxJ; j++) {
        const py = j + 0.5;
        for (let i = minI; i <= maxI; i++) {
            const px = i + 0.5;
            const w0 = edge(x1, y1, x2, y2, px, py);
            const w1 = edge(x2, y2, x0, y0, px, py);
            const w2 = edge(x0, y0, x1, y1, px, py);
            if ((w0 > 0 || (w0 === 0 && t0)) && (w1 > 0 || (w1 === 0 && t1)) && (w2 > 0 || (w2 === 0 && t2)))
                plot(i, j);
        }
    }
}
