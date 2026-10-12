/**
 * Browser side of the visual harness: parse → frontend → three.js → PNG, driven by Playwright
 * through `window.truedxf`. Fonts are fetched from the harness server (`/fonts/<file>`), raster
 * images from `/images/<suite>/<IMAGEDEF path>`.
 */
import { loadDxf } from "@truedxf/model";
import { type PlotRequest, type RenderEnv, renderPlot } from "@truedxf/render";
import { DisplayListRenderer } from "@truedxf/three";

const canvas = document.createElement("canvas");
document.body.append(canvas);
const renderer = new DisplayListRenderer({ canvas, preserveDrawingBuffer: true, antialias: false });

const fontCache = new Map<string, Promise<Uint8Array | undefined>>();
function loadFont(name: string): Promise<Uint8Array | undefined> {
    const key = name.toLowerCase();
    let p = fontCache.get(key);
    if (!p) {
        p = fetch(`/fonts/${encodeURIComponent(key)}`).then(async (r) =>
            r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined,
        );
        fontCache.set(key, p);
    }
    return p;
}

function fromBase64(b64: string): Uint8Array {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

export interface HarnessOptions {
    /** Fonts AutoCAD could not see when the references were made (regex on file/family name). */
    hideFonts?: string;
    /** Fixture suite (image paths resolve relative to its folder). */
    suite?: string;
    /** Draw IMAGE / WIPEOUT (accoreconsole omits them). */
    drawRaster?: boolean;
}

function imageLoader(suite: string | undefined) {
    return async (path: string): Promise<Uint8Array | undefined> => {
        if (!suite) return undefined;
        const r = await fetch(`/images/${suite}/${encodeURIComponent(path)}`);
        return r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined;
    };
}

export interface HarnessResult {
    png: string;
    width: number;
    height: number;
    batches: number;
    diagnostics: Record<string, number>;
    ms: { parse: number; frontend: number; render: number };
}

declare global {
    interface Window {
        truedxf: {
            render(dxfBase64: string, request: PlotRequest, options?: HarnessOptions): Promise<HarnessResult>;
        };
    }
}

window.truedxf = {
    async render(dxfBase64, request, options) {
        const t0 = performance.now();
        const doc = loadDxf(fromBase64(dxfBase64));
        const t1 = performance.now();
        const env: RenderEnv & { text?: { unavailableFonts?: RegExp } } = {
            loadFont,
            loadImage: imageLoader(options?.suite),
            // fixture plot style tables (truedxf-*.ctb|stb) lie next to the case, like images
            loadPlotStyleTable: imageLoader(options?.suite),
            rasterEntities: options?.drawRaster ? "draw" : "omit",
        };
        if (options?.hideFonts) env.text = { unavailableFonts: new RegExp(options.hideFonts, "i") };
        const plot = await renderPlot(doc, request, env);
        const t2 = performance.now();
        const [w, h] = plot.canvas;
        renderer.setSize(w, h, true);
        renderer.setDisplayList(plot.displayList);
        renderer.render(plot.view);
        const png = canvas.toDataURL("image/png");
        const t3 = performance.now();
        return {
            png: png.slice(png.indexOf(",") + 1),
            width: w,
            height: h,
            batches: plot.displayList.batches.length,
            diagnostics: doc.diagnostics.summary(),
            ms: { parse: t1 - t0, frontend: t2 - t1, render: t3 - t2 },
        };
    },
};
document.title = "ready";
