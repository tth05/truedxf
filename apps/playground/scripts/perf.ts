/**
 * Viewer performance on large corpus files: builds the playground, serves it with `vite preview`
 * and opens files in headless Chromium, reporting load / first frame / frame times.
 *
 *   node apps/playground/scripts/perf.ts [--count 5] [--max-mb 100] [--files <path,…>] [--gpu]
 *                                        [--files-from <UTF-8 path>] [--timeout <s per file>] [--skip-build]
 *
 * Default Chromium runs WebGL on SwiftShader (CPU), so frame times are pessimistic; `--gpu` asks
 * for the hardware GPU (headless Chromium falls back to SwiftShader without `--use-angle` and
 * `--ignore-gpu-blocklist`); the WebGL renderer in use is printed and recorded.
 * Results: samples/reports/viewer-perf.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { build, preview } from "vite";

const APP = resolve(import.meta.dirname, "..");
const ROOT = resolve(APP, "../..");
const SAMPLES = join(ROOT, "samples");

interface Row {
    path: string;
    size: number;
    format: string;
}

function args() {
    const a = { count: 5, maxMb: 100, files: [] as string[], gpu: false, skipBuild: false, timeout: 300 };
    const v = process.argv.slice(2);
    for (let i = 0; i < v.length; i++) {
        const k = v[i];
        if (k === "--count") a.count = Number(v[++i]);
        else if (k === "--max-mb") a.maxMb = Number(v[++i]);
        else if (k === "--files") a.files = v[++i]!.split(",");
        else if (k === "--files-from") a.files = readFileSync(v[++i]!, "utf8").trim().split(",");
        else if (k === "--gpu") a.gpu = true;
        else if (k === "--skip-build") a.skipBuild = true;
        else if (k === "--timeout") a.timeout = Number(v[++i]);
    }
    return a;
}

function largest(count: number, maxMb: number): string[] {
    let text: string;
    try {
        text = readFileSync(join(SAMPLES, "external", "manifest.jsonl"), "utf8");
    } catch {
        return [];
    }
    const rows: Row[] = [];
    const seen = new Set<number>();
    for (const l of text.split("\n")) {
        if (!l.trim()) continue;
        const r = JSON.parse(l) as Row;
        // one file per size: the corpus has duplicates
        if (r.format !== "ascii-dxf" || r.size >= maxMb * 1e6 || seen.has(r.size)) continue;
        seen.add(r.size);
        rows.push(r);
    }
    return rows
        .sort((a, b) => b.size - a.size)
        .slice(0, count)
        .map((r) => `external/${r.path}`);
}

const a = args();
const files = a.files.length ? a.files : largest(a.count, a.maxMb);
if (files.length === 0) {
    console.log("no corpus files (samples/external/manifest.jsonl missing)");
    process.exit(0);
}
if (!a.skipBuild) await build({ configFile: join(APP, "vite.config.ts"), root: APP, logLevel: "warn" });
const server = await preview({ configFile: join(APP, "vite.config.ts"), root: APP, preview: { port: 0 } });
const url = server.resolvedUrls?.local[0] ?? "http://localhost:4173/";
const browser = await chromium.launch(
    a.gpu
        ? {
              args: [
                  process.platform === "win32" ? "--use-angle=d3d11" : "--use-angle=gl",
                  "--ignore-gpu-blocklist",
              ],
              ignoreDefaultArgs: ["--enable-unsafe-swiftshader"],
          }
        : { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
);
let gpu = "";
const results: Record<string, unknown>[] = [];
try {
    for (const f of files) {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            if (m.type() === "error") errors.push(m.text());
        });
        console.log(`… ${f.split("/").pop()}`);
        if (!gpu) {
            gpu = await page.evaluate(() => {
                const gl = document.createElement("canvas").getContext("webgl2");
                const ext = gl?.getExtension("WEBGL_debug_renderer_info");
                return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
            });
            console.log(`WebGL: ${gpu}`);
        }
        const t0 = Date.now();
        // corpus names contain '#', '%', spaces…: encode each path segment for the fetch URL
        const fileUrl = `api/samples/file/${f.split("/").map(encodeURIComponent).join("/")}`;
        await page.goto(`${url}?file=${encodeURIComponent(fileUrl)}`);
        let metric: Record<string, number | string> | undefined;
        try {
            await page.waitForFunction(
                () =>
                    (window as unknown as { truedxf?: { metrics: unknown[] } }).truedxf?.metrics.length ||
                    document.querySelector(".toast.on"),
                undefined,
                { timeout: a.timeout * 1000, polling: 250 },
            );
            metric = await page.evaluate(
                () =>
                    (window as unknown as { truedxf: { metrics: Record<string, number | string>[] } }).truedxf
                        .metrics[0],
            );
            if (!metric) errors.push(`load failed: ${await page.locator(".toast").textContent()}`);
        } catch (e) {
            errors.push(String(e));
        }
        const frames = metric
            ? await page.evaluate(() => {
                  const v = (
                      window as unknown as {
                          truedxf: {
                              viewer: {
                                  zoom(f: number): void;
                                  renderNow(): void;
                                  renderer: {
                                      renderer: {
                                          getContext(): WebGLRenderingContext;
                                          info: { render: { calls: number } };
                                      };
                                  };
                              };
                          };
                      }
                  ).truedxf.viewer;
                  const gl = v.renderer.renderer.getContext();
                  const px = new Uint8Array(4);
                  const t: number[] = [];
                  for (let i = 0; i < 6; i++) {
                      v.zoom(i % 2 ? 1 / 1.05 : 1.05);
                      const s = performance.now();
                      v.renderNow();
                      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
                      t.push(performance.now() - s);
                  }
                  t.sort((x, y) => x - y);
                  const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
                      ?.usedJSHeapSize;
                  return {
                      median: t[t.length >> 1]!,
                      max: t[t.length - 1]!,
                      heapMb: heap ? heap / 2 ** 20 : undefined,
                      calls: v.renderer.renderer.info.render.calls,
                  };
              })
            : undefined;
        // performance.memory includes uncollected upload buffers (and is bucketed by Chromium).
        // Keep that original metric for comparisons, then measure live main-isolate memory after
        // GC, outside all timed work. Backing storage includes ArrayBuffers, reported separately.
        let retained: { heapMb: number; backingMb: number } | undefined;
        if (metric) {
            const cdp = await page.context().newCDPSession(page);
            await cdp.send("HeapProfiler.collectGarbage");
            const heap = await cdp.send("Runtime.getHeapUsage");
            retained = {
                heapMb: heap.usedSize / 2 ** 20,
                backingMb: (heap.backingStorageSize ?? 0) / 2 ** 20,
            };
            await cdp.detach();
        }
        const r = {
            file: f,
            wallMs: Date.now() - t0,
            ...metric,
            frame: frames,
            retained,
            errors: errors.slice(0, 5),
        };
        results.push(r);
        const mb = (Number(metric?.bytes ?? 0) / 2 ** 20).toFixed(1);
        console.log(
            `${f.split("/").pop()} ${mb} MB: ` +
                (metric
                    ? `parse ${Math.round(Number(metric.parse))} ms, frontend ${Math.round(Number(metric.frontend))} ms, upload ${Math.round(Number(metric.upload))} ms, first frame ${Math.round(Number(metric.firstFrame))} ms, ${metric.vertices} vertices / ${metric.batches} batches, frame median ${frames?.median.toFixed(1)} ms (max ${frames?.max.toFixed(1)}), ${frames?.calls} draw calls, main heap ${frames?.heapMb?.toFixed(0)} MB; retained ${retained?.heapMb.toFixed(1)} MB heap + ${retained?.backingMb.toFixed(1)} MB backing storage`
                    : `FAILED ${errors[0] ?? ""}`),
        );
        await page.close();
    }
} finally {
    await browser.close();
    await server.close();
}
mkdirSync(join(SAMPLES, "reports"), { recursive: true });
writeFileSync(
    join(SAMPLES, "reports", "viewer-perf.json"),
    JSON.stringify({ date: new Date().toISOString(), swiftshader: !a.gpu, gpu, results }, null, 1),
);
