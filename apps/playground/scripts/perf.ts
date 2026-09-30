/**
 * Viewer performance on large corpus files: builds the playground, serves it with `vite preview`
 * and opens files in headless Chromium, reporting load / first frame / frame times.
 *
 *   node apps/playground/scripts/perf.ts [--count 5] [--max-mb 100] [--files <path,…>] [--gpu]
 *                                        [--timeout <s per file>] [--skip-build]
 *
 * Default Chromium runs WebGL on SwiftShader (CPU), so frame times are pessimistic; `--gpu` uses
 * the default (hardware) backend where available. Results: samples/reports/viewer-perf.json.
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
const browser = await chromium.launch({
  args: a.gpu ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const results: Record<string, unknown>[] = [];
try {
  for (const f of files) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const t0 = Date.now();
    await page.goto(`${url}?file=${encodeURIComponent(`api/samples/file/${f}`)}`);
    let metric: Record<string, number | string> | undefined;
    try {
      await page.waitForFunction(
        () => (window as unknown as { truedxf?: { metrics: unknown[] } }).truedxf?.metrics.length,
        undefined,
        { timeout: a.timeout * 1000, polling: 250 },
      );
      metric = await page.evaluate(
        () =>
          (window as unknown as { truedxf: { metrics: Record<string, number | string>[] } }).truedxf
            .metrics[0]!,
      );
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
                  renderer: { renderer: { getContext(): WebGLRenderingContext } };
                };
              };
            }
          ).truedxf.viewer;
          const gl = v.renderer.renderer.getContext();
          const px = new Uint8Array(4);
          const t: number[] = [];
          for (let i = 0; i < 12; i++) {
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
          };
        })
      : undefined;
    const r = { file: f, wallMs: Date.now() - t0, ...metric, frame: frames, errors: errors.slice(0, 5) };
    results.push(r);
    const mb = (Number(metric?.bytes ?? 0) / 2 ** 20).toFixed(1);
    console.log(
      `${f.split("/").pop()} ${mb} MB: ` +
        (metric
          ? `parse ${Math.round(Number(metric.parse))} ms, frontend ${Math.round(Number(metric.frontend))} ms, upload ${Math.round(Number(metric.upload))} ms, first frame ${Math.round(Number(metric.firstFrame))} ms, ${metric.vertices} vertices / ${metric.batches} batches, frame median ${frames?.median.toFixed(1)} ms (max ${frames?.max.toFixed(1)}), main heap ${frames?.heapMb?.toFixed(0)} MB`
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
  JSON.stringify({ date: new Date().toISOString(), swiftshader: !a.gpu, results }, null, 1),
);
