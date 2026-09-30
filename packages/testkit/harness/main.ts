/**
 * Browser side of the visual harness: parse → frontend → three.js → PNG, driven by Playwright
 * through `window.truedxf`. Fonts are fetched from the harness server (`/fonts/<file>`).
 */
import { loadDxf } from "@truedxf/model";
import { type PlotRequest, renderPlot } from "@truedxf/render";
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
    truedxf: { render(dxfBase64: string, request: PlotRequest): Promise<HarnessResult> };
  }
}

window.truedxf = {
  async render(dxfBase64, request) {
    const t0 = performance.now();
    const doc = loadDxf(fromBase64(dxfBase64));
    const t1 = performance.now();
    const plot = await renderPlot(doc, request, { loadFont });
    const t2 = performance.now();
    const [w, h] = request.canvas;
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
