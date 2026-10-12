/**
 * PDF underlay rasterizer for `@truedxf/render` (`RenderEnv.pdf`), backed by PDF.js
 * (pdfjs-dist, Apache-2.0). truedxf never parses or draws PDF itself: PDF.js renders a page
 * region to a canvas and the renderer places the pixels like an IMAGE (note 07 §10.3).
 *
 * - PDF.js is imported on the first `open()`, so drawings without PDF underlays never load it.
 * - It parses in the calling thread (PDF.js "fake worker"): the viewer already renders in a
 *   worker, and no worker script URL has to be configured.
 * - Browsers / workers draw into an `OffscreenCanvas`; Node uses PDF.js' own canvas factory
 *   (`@napi-rs/canvas`, an optional dependency of pdfjs-dist) with the legacy build.
 * - Determinism: glyphs are drawn as paths (no FontFace / system fonts), no GPU canvas.
 */
import type { PdfFile, PdfPage, PdfRasterizer, PdfTransform } from "@truedxf/render";

export type { PdfBox, PdfFile, PdfPage, PdfRasterizer, PdfTransform } from "@truedxf/render";

export interface PdfRasterizerOptions {
    /**
     * Folder URL (trailing slash) with pdfjs-dist's `standard_fonts/`, `cmaps/`, `wasm/` and
     * `iccs/` folders, copied from the package. Needed for PDFs with non-embedded standard fonts,
     * CJK CMaps, JPEG 2000 / JBIG2 images or ICC colours; without it such content falls back or
     * is skipped. In Node a file path prefix works too.
     */
    assetsUrl?: string;
    /** Largest bitmap side in pixels (default 4096). */
    maxSize?: number;
}

type PdfJs = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
type PdfJsPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

let pdfjs: Promise<PdfJs> | undefined;

function loadPdfJs(): Promise<PdfJs> {
    pdfjs ??= (async () => {
        const g = globalThis as { pdfjsWorker?: unknown };
        g.pdfjsWorker ??= await import("#pdfjs-worker");
        return (await import("#pdfjs")) as PdfJs;
    })();
    return pdfjs;
}

/** A 2D canvas: OffscreenCanvas in browsers and workers, PDF.js' factory (Node) otherwise. */
interface CanvasAndContext {
    canvas: { width: number; height: number };
    context: {
        getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
    };
}

const offscreen = typeof OffscreenCanvas !== "undefined";

/** PDF.js `CanvasFactory` for its scratch canvases (patterns, masks, groups) without a DOM. */
class OffscreenCanvasFactory {
    create(width: number, height: number) {
        const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
        return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
    }
    reset(cc: { canvas: OffscreenCanvas }, width: number, height: number): void {
        cc.canvas.width = Math.max(1, width);
        cc.canvas.height = Math.max(1, height);
    }
    destroy(cc: { canvas: OffscreenCanvas | null; context: unknown }): void {
        if (cc.canvas) {
            cc.canvas.width = 0;
            cc.canvas.height = 0;
        }
        cc.canvas = null;
        cc.context = null;
    }
}

/**
 * PDF.js `FilterFactory` without SVG filters (they need a document): transfer functions,
 * knockout groups and high-contrast modes render unfiltered.
 */
class NoFilterFactory {
    addFilter() {
        return "none";
    }
    addHCMFilter() {
        return "none";
    }
    addAlphaFilter() {
        return "none";
    }
    addLuminosityFilter() {
        return "none";
    }
    addKnockoutFilter() {
        return "none";
    }
    addHighlightHCMFilter() {
        return "none";
    }
    addSelectionHCMFilter() {
        return "none";
    }
    addSelectionFilter() {
        return "none";
    }
    createSelectionStyle() {
        return null;
    }
    destroy() {}
}

export function createPdfRasterizer(options: PdfRasterizerOptions = {}): PdfRasterizer {
    const base = options.assetsUrl;
    return {
        ...(options.maxSize !== undefined ? { maxSize: options.maxSize } : {}),
        async open(bytes: Uint8Array): Promise<PdfFile | undefined> {
            const lib = await loadPdfJs();
            let task: ReturnType<PdfJs["getDocument"]> | undefined;
            try {
                task = lib.getDocument({
                    data: bytes,
                    verbosity: lib.VerbosityLevel.ERRORS,
                    useSystemFonts: false,
                    disableFontFace: true,
                    enableHWA: false,
                    stopAtErrors: false,
                    ...(base
                        ? {
                              standardFontDataUrl: `${base}standard_fonts/`,
                              cMapUrl: `${base}cmaps/`,
                              wasmUrl: `${base}wasm/`,
                              iccUrl: `${base}iccs/`,
                              // PDF.js's default for this reads document.baseURI, which throws in a Web Worker
                              // (the viewer's backend): fetch the files directly when they are web URLs
                              ...(/^(https?|blob):/i.test(base) ? { useWorkerFetch: true } : {}),
                          }
                        : {}),
                    ...(offscreen && typeof document === "undefined"
                        ? { CanvasFactory: OffscreenCanvasFactory, FilterFactory: NoFilterFactory }
                        : {}),
                });
                return pdfFile(task, await task.promise);
            } catch {
                // damaged, encrypted (no password) or not a PDF
                void task?.destroy();
                return undefined;
            }
        },
    };
}

function pdfFile(task: { destroy(): Promise<void> }, doc: PdfDocument): PdfFile {
    const pages = new Map<number, Promise<PdfPage | undefined>>();
    return {
        pageCount: doc.numPages,
        page(n: number) {
            if (!Number.isInteger(n) || n < 1 || n > doc.numPages) return Promise.resolve(undefined);
            let p = pages.get(n);
            if (!p) {
                p = doc.getPage(n).then(
                    (page) => pdfPage(doc, page),
                    () => undefined,
                );
                pages.set(n, p);
            }
            return p;
        },
        close() {
            void task.destroy();
        },
    };
}

function pdfPage(doc: PdfDocument, page: PdfJsPage): PdfPage {
    const [x0, y0, x1, y1] = page.view as [number, number, number, number];
    return {
        // PDF.js exposes the visible page box (CropBox, else MediaBox)
        mediaBox: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)],
        async render(t: PdfTransform, width: number, height: number) {
            // PDF.js applies `transform` after its viewport (unrotated, 1 unit = 1 PDF unit, y down
            // from the top of the view box): undo the viewport, (u, v) → (u + vx0, vy1 − v)
            const viewport = page.getViewport({ scale: 1, rotation: 0 });
            const [vx0, , , vy1] = viewport.viewBox as [number, number, number, number];
            const [a, b, c, d, e, f] = t;
            const cc = createCanvas(doc, width, height);
            try {
                await page.render({
                    // context only: given a canvas, PDF.js asks it for an opaque (alpha: false) context
                    canvas: null,
                    canvasContext: cc.context as unknown as CanvasRenderingContext2D,
                    viewport,
                    transform: [a, b, -c, -d, a * vx0 + c * vy1 + e, b * vx0 + d * vy1 + f],
                    background: "rgba(0,0,0,0)",
                }).promise;
                const data = cc.context.getImageData(0, 0, width, height).data;
                return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            } catch {
                return undefined;
            } finally {
                cc.canvas.width = 0;
                cc.canvas.height = 0;
            }
        },
    };
}

function createCanvas(doc: PdfDocument, width: number, height: number): CanvasAndContext {
    if (offscreen) {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) return { canvas, context };
    }
    return (doc.canvasFactory as { create(w: number, h: number): CanvasAndContext }).create(width, height);
}
