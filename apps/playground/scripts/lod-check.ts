/** AA GPU density comparison at a shared fit view; writes only to --out (default .codex-out). */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DxfViewer, RenderParams } from "@truedxf/viewer";
import { encode } from "fast-png";
import { chromium } from "playwright";
import { build, preview } from "vite";

const APP = resolve(import.meta.dirname, "..");
const ROOT = resolve(APP, "../..");
// This Node-only script shares the corpus selection without pulling that separate TypeScript
// project's sources into the playground build's rootDir.
const { resolveBenchPaths } = (await import(
    pathToFileURL(join(ROOT, "tools/corpus/src/bench-set.ts")).href
)) as { resolveBenchPaths(): Map<string, string> };
const arg = (name: string, fallback: string) => {
    const i = process.argv.indexOf(name);
    return i < 0 ? fallback : process.argv[i + 1]!;
};
const out = resolve(ROOT, arg("--out", ".codex-out"));
const label = arg("--label", "density");
const only = new RegExp(arg("--only", "mtext|arch-cn|attribs|proxy|viewports|civil"));
mkdirSync(out, { recursive: true });
if (!process.argv.includes("--skip-build"))
    await build({ configFile: join(APP, "vite.config.ts"), root: APP, logLevel: "warn" });
const server = await preview({ configFile: join(APP, "vite.config.ts"), root: APP, preview: { port: 0 } });
const browser = await chromium.launch({
    args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"],
    ignoreDefaultArgs: ["--enable-unsafe-swiftshader"],
});
const results = [];
try {
    for (const [name, path] of resolveBenchPaths()) {
        if (!only.test(name)) continue;
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
        try {
            page.on("pageerror", (e) => console.error(e));
            const file = relative(join(ROOT, "samples"), path).replaceAll("\\", "/");
            const fileUrl = `api/samples/file/${file.split("/").map(encodeURIComponent).join("/")}`;
            await page.goto(`${server.resolvedUrls!.local[0]}?lod=0&file=${encodeURIComponent(fileUrl)}`);
            await page.waitForFunction(
                () => (window as unknown as { truedxf?: { metrics: unknown[] } }).truedxf?.metrics.length,
                undefined,
                { timeout: 300_000 },
            );
            // Wait for the viewer's fit request to finish; auxiliary lists below never trigger another fit.
            await page.waitForFunction(() => {
                const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
                return !(v as unknown as { inFlight: boolean }).inFlight;
            });
            const capture = await page.evaluate(async () => {
                const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
                const view = v.viewState!;
                const gl = v.renderer.renderer.getContext();
                const ext = gl.getExtension("WEBGL_debug_renderer_info");
                const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
                if (/swiftshader|unknown/i.test(gpu)) throw new Error(`Hardware GPU required: ${gpu}`);
                if (!gl.getContextAttributes()?.antialias) throw new Error("Antialiasing is disabled");
                const hw = (view.width * view.scale) / 2;
                const hh = (view.height * view.scale) / 2;
                const rect = {
                    minX: view.cx - hw,
                    maxX: view.cx + hw,
                    minY: view.cy - hh,
                    maxY: view.cy + hh,
                };
                const params: RenderParams = {
                    ...(v as unknown as { renderParams(): RenderParams }).renderParams(),
                    area: { type: "window", min: [rect.minX, rect.minY], max: [rect.maxX, rect.maxY] },
                    canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight],
                    mergeBatches: true,
                    retain: false,
                };
                const modes = [];
                for (const lod of [false, true]) {
                    const res = await v.renderList({ ...params, lod });
                    if (res.merged) v.renderer.setMergedDisplayList(res.merged);
                    else v.renderer.setDisplayList(res.list);
                    v.renderer.render(rect);
                    const { data, width, height } = v.renderer.readPixels();
                    let binary = "";
                    for (let i = 0; i < data.length; i += 8192)
                        binary += String.fromCharCode(...data.subarray(i, i + 8192));
                    modes.push({
                        lod,
                        pixels: btoa(binary),
                        width,
                        height,
                        ...res.stats,
                        calls: v.renderer.renderer.info.render.calls,
                        frontend: res.ms.frontend,
                    });
                }
                return { gpu, view, rect, modes };
            });
            const pixels = capture.modes.map((m) => Buffer.from(m.pixels, "base64"));
            const { width, height } = capture.modes[0]!;
            let absolute = 0;
            let changed = 0;
            let cells = 0;
            for (let y = 0; y + 3 < height; y += 4) {
                for (let x = 0; x + 3 < width; x += 4) {
                    let max = 0;
                    for (let c = 0; c < 3; c++) {
                        let delta = 0;
                        for (let dy = 0; dy < 4; dy++)
                            for (let dx = 0; dx < 4; dx++) {
                                const i = ((y + dy) * width + x + dx) * 4 + c;
                                delta += pixels[0]![i]! - pixels[1]![i]!;
                            }
                        const d = Math.abs(delta / 16);
                        absolute += d;
                        max = Math.max(max, d);
                    }
                    if (max > 24) changed++;
                    cells++;
                }
            }
            if (/mtext|arch-cn/.test(name) || process.argv.includes("--images-all")) {
                for (let i = 0; i < 2; i++)
                    writeFileSync(
                        join(out, `${label}-${name}-${i ? "on" : "off"}.png`),
                        encode({ width, height, data: pixels[i]!, channels: 4 }),
                    );
            }
            const result = {
                name,
                gpu: capture.gpu,
                view: capture.view,
                meanAbsoluteRgb: absolute / (cells * 3),
                changedCellPercent: (100 * changed) / cells,
                cells,
                modes: capture.modes.map(({ pixels: _pixels, ...mode }) => mode),
            };
            results.push(result);
            console.log(JSON.stringify(result));
        } finally {
            await page.close();
        }
    }
} finally {
    await browser.close();
    await server.close();
    writeFileSync(join(out, `${label}.json`), JSON.stringify(results, null, 2));
}
