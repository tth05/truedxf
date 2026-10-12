/** Real-GPU zoom timings and screenshot pan regression; writes only to --out (worktree by default).
 * pnpm exec node apps/playground/scripts/cull-check.ts [--synthetic-only] [--skip-build] [--out dir]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Backend, DxfViewer, RenderStats } from "@truedxf/viewer";
import { decode } from "fast-png";
import { chromium, type Page } from "playwright";
import { build, preview } from "vite";

const APP = resolve(import.meta.dirname, "..");
const ROOT = resolve(APP, "../..");
const argv = process.argv.slice(2);
const out = argv.includes("--out") ? resolve(argv[argv.indexOf("--out") + 1]!) : join(ROOT, ".codex-out");
mkdirSync(out, { recursive: true });
if (!argv.includes("--skip-build"))
    await build({ configFile: join(APP, "vite.config.ts"), root: APP, logLevel: "warn" });
const server = await preview({ configFile: join(APP, "vite.config.ts"), root: APP, preview: { port: 0 } });
const url = server.resolvedUrls!.local[0]!;
const browser = await chromium.launch({
    args: [process.platform === "win32" ? "--use-angle=d3d11" : "--use-angle=gl", "--ignore-gpu-blocklist"],
    ignoreDefaultArgs: ["--enable-unsafe-swiftshader"],
});
const errors: string[] = [];
async function open(cull: boolean, merge = true, dpr = 1): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${url}?cull=${cull ? 1 : 0}&merge=${merge ? 1 : 0}`);
    await page.waitForFunction(() => !!(window as unknown as { truedxf?: unknown }).truedxf);
    // Element screenshots include positioned sibling UI; compare only drawing content.
    await page.addStyleTag({ content: ".busy, .toast { visibility: hidden !important; }" });
    await page.evaluate(() => {
        const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
        v.canvas.setAttribute("data-cull-test", "1");
        v.setInteraction(false);
    });
    return page;
}

async function action(page: Page, view: { cx?: number; cy?: number; scale?: number }, zoom?: number) {
    return page.evaluate(
        async ({ view, zoom }) => {
            const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
            const start = performance.now();
            const result = new Promise<{ shownMs: number; stats: RenderStats }>((resolve) => {
                const off = v.on("render", (stats) => {
                    off();
                    resolve({ shownMs: performance.now() - start, stats });
                });
            });
            if (zoom) v.zoom(zoom);
            else v.setView(view);
            return result;
        },
        { view, zoom },
    );
}
function synthetic(paper: boolean): string {
    const tags: (string | number)[] = [
        0,
        "SECTION",
        2,
        "HEADER",
        9,
        "$ACADVER",
        1,
        "AC1009",
        9,
        "$TILEMODE",
        70,
        paper ? 0 : 1,
        0,
        "ENDSEC",
        0,
        "SECTION",
        2,
        "ENTITIES",
    ];
    for (let y = 0; y < 50; y++)
        for (let x = 0; x < 50; x++) {
            tags.push(
                0,
                "SOLID",
                5,
                (y * 50 + x + 256).toString(16),
                62,
                1 + ((x + y) % 6),
                10,
                x * 10,
                20,
                y * 10,
                11,
                x * 10 + 7,
                21,
                y * 10,
                12,
                x * 10,
                22,
                y * 10 + 7,
                13,
                x * 10 + 7,
                23,
                y * 10 + 7,
            );
        }
    if (paper)
        for (const [id, center] of [
            [2, 250],
            [3, 760],
        ]) {
            tags.push(
                0,
                "VIEWPORT",
                5,
                (10000 + id!).toString(16),
                67,
                1,
                10,
                center!,
                20,
                250,
                40,
                500,
                41,
                500,
                68,
                1,
                69,
                id!,
                16,
                0,
                26,
                0,
                36,
                1,
                12,
                250,
                22,
                250,
                45,
                500,
            );
        }
    tags.push(0, "ENDSEC", 0, "EOF");
    return `${tags.join("\n")}\n`;
}
function compare(actual: Buffer, reference: Buffer) {
    const a = decode(actual),
        b = decode(reference);
    if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels)
        throw new Error("screenshot sizes differ");
    const channels = a.channels;
    let different = 0,
        nonEdge = 0,
        maxDelta = 0;
    for (let y = 0; y < a.height; y++)
        for (let x = 0; x < a.width; x++) {
            const k = (y * a.width + x) * channels;
            let delta = 0;
            for (let c = 0; c < 3; c++)
                delta = Math.max(delta, Math.abs(Number(a.data[k + c]) - Number(b.data[k + c])));
            maxDelta = Math.max(maxDelta, delta);
            if (delta <= 8) continue;
            different++;
            let edge = false;
            for (let yy = Math.max(0, y - 1); yy <= Math.min(a.height - 1, y + 1); yy++)
                for (let xx = Math.max(0, x - 1); xx <= Math.min(a.width - 1, x + 1); xx++)
                    for (let c = 0; c < 3; c++)
                        if (
                            Math.abs(
                                Number(b.data[(yy * b.width + xx) * channels + c]) - Number(b.data[k + c]),
                            ) > 8
                        )
                            edge = true;
            if (!edge) nonEdge++;
        }
    return { different, nonEdge, maxDelta, pixels: a.width * a.height };
}
const checks: Record<string, unknown>[] = [];
const timings: Record<string, unknown>[] = [];
let gpu = "";
try {
    for (const [paper, merge, dpr] of argv.includes("--timings-only")
        ? []
        : ([
              [false, true, 1],
              [true, true, 1],
              [false, false, 1],
              [false, true, 2],
          ] as const)) {
        const name = `${paper ? "paper" : "model"}-${merge ? "merged" : "batches"}-dpr${dpr}`;
        const detail = await open(true, merge, dpr),
            full = await open(false, merge, dpr);
        if (!gpu)
            gpu = await detail.evaluate(() => {
                const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
                const gl = v.renderer.renderer.getContext(),
                    ext = gl.getExtension("WEBGL_debug_renderer_info");
                return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
            });
        console.log(`GPU: ${gpu}; ${name}`);
        for (const page of [detail, full])
            await page.evaluate(
                async ({ text, paper }) => {
                    const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
                    await v.load(new TextEncoder().encode(text), "cull-grid.dxf");
                    if (paper) await v.setLayout(v.layouts.find((l) => !l.isModel)!.name);
                    v.setLineweights(false);
                },
                { text: synthetic(paper), paper },
            );
        // Complete settings refresh before establishing the fit used for both lists.
        for (const page of [detail, full])
            await page.waitForFunction(() => {
                const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
                const i = v as unknown as {
                    inFlight: boolean;
                    current: { key: string };
                    contentKey(): string;
                };
                return !i.inFlight && i.current.key === i.contentKey();
            });
        await action(detail, {}, 8);
        await action(full, {}, 8);
        const initial = await detail.evaluate(() => {
            const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
            return v.viewState!;
        });
        const culled = await detail.evaluate(() => {
            const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
            const i = v as unknown as { current: { covered?: unknown }; backend: Backend };
            if (!i.current.covered) throw new Error("expected a culled detail list");
            const call = i.backend.call.bind(i.backend);
            let release: () => void = () => {};
            const held = new Promise<void>((r) => {
                release = r;
            });
            (window as unknown as { releaseCull: () => void }).releaseCull = release;
            i.backend.call = (async (req: Parameters<Backend["call"]>[0]) => {
                if (req.type === "render") await held;
                return call(req);
            }) as Backend["call"];
            return v.stats!.vertices;
        });
        for (const [step, dx] of [0, 0.2, 0.9, 2, -2, 1.2].entries()) {
            for (const page of [detail, full])
                await page.evaluate(
                    ({ initial, dx }) => {
                        const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
                        v.setView({
                            cx: initial.cx + dx * initial.width * initial.scale,
                            cy: initial.cy,
                            scale: initial.scale,
                        });
                        v.renderNow();
                    },
                    { initial, dx },
                );
            const a = await detail.locator("canvas[data-cull-test]").screenshot();
            const b = await full.locator("canvas[data-cull-test]").screenshot();
            writeFileSync(join(out, `${name}-${step}-cull.png`), a);
            writeFileSync(join(out, `${name}-${step}-full.png`), b);
            const row = { name, step, dx, phase: "pending", culledVertices: culled, ...compare(a, b) };
            checks.push(row);
            console.log(JSON.stringify(row));
            if (row.nonEdge > 0) throw new Error(`blank/interior mismatch: ${JSON.stringify(row)}`);
        }
        await detail.evaluate(() => (window as unknown as { releaseCull: () => void }).releaseCull());
        await detail.waitForFunction(() => {
            const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
            const i = v as unknown as {
                inFlight: boolean;
                again: boolean;
                current: { covered?: { minX: number; maxX: number } };
            };
            return (
                !i.inFlight &&
                !i.again &&
                i.current.covered &&
                v.viewState!.cx > i.current.covered.minX &&
                v.viewState!.cx < i.current.covered.maxX
            );
        });
        const a = await detail.locator("canvas[data-cull-test]").screenshot(),
            b = await full.locator("canvas[data-cull-test]").screenshot();
        writeFileSync(join(out, `${name}-settled-cull.png`), a);
        writeFileSync(join(out, `${name}-settled-full.png`), b);
        const settled = { name, phase: "settled", ...compare(a, b) };
        checks.push(settled);
        console.log(JSON.stringify(settled));
        if (settled.nonEdge > 0) throw new Error(`settled interior mismatch: ${JSON.stringify(settled)}`);
        await detail.close();
        await full.close();
    }
    if (!argv.includes("--synthetic-only")) {
        const manifest = readFileSync(join(ROOT, "samples/external/manifest.jsonl"), "utf8");
        const match = manifest
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as { path: string })
            .find((row) => row.path.includes("20240514V1.05.dxf"));
        const path = match && join(ROOT, "samples/external", match.path);
        if (!path) throw new Error("arch-cn-114 sample missing");
        const file = relative(join(ROOT, "samples"), path).replaceAll("\\", "/");
        for (const cull of [false, true]) {
            const page = await open(cull);
            if (!gpu)
                gpu = await page.evaluate(() => {
                    const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
                    const gl = v.renderer.renderer.getContext(),
                        ext = gl.getExtension("WEBGL_debug_renderer_info");
                    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
                });
            await page.evaluate(async (file) => {
                const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
                await v.load(`api/samples/file/${file.split("/").map(encodeURIComponent).join("/")}`);
            }, file);
            const fit = await page.evaluate(
                () => (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer.viewState!,
            );
            for (const factor of [8, 64]) {
                const result = await action(page, { cx: fit.cx, cy: fit.cy, scale: fit.scale / factor });
                const view = await page.evaluate(
                    () => (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer.viewState!,
                );
                const zoomImage = await page.locator("canvas[data-cull-test]").screenshot();
                const zoomPath = join(out, `arch-${factor}-zoom-full.png`);
                if (!cull) writeFileSync(zoomPath, zoomImage);
                else {
                    writeFileSync(join(out, `arch-${factor}-zoom-cull.png`), zoomImage);
                    const pixels = {
                        name: "arch-cn-114",
                        factor,
                        phase: "zoom-settled",
                        ...compare(zoomImage, readFileSync(zoomPath)),
                    };
                    checks.push(pixels);
                    console.log(JSON.stringify(pixels));
                    if (pixels.nonEdge > 0)
                        throw new Error(`arch zoom interior mismatch: ${JSON.stringify(pixels)}`);
                }
                const panView = { cx: view.cx + view.width * view.scale * 0.9 };
                const pan = cull
                    ? await action(page, panView)
                    : await page.evaluate((view) => {
                          const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
                          const start = performance.now();
                          v.setView(view);
                          v.renderNow();
                          v.renderer.renderer.getContext().finish();
                          return { shownMs: performance.now() - start, reusedFullList: true };
                      }, panView);
                const panImage = await page.locator("canvas[data-cull-test]").screenshot();
                const panPath = join(out, `arch-${factor}-pan-full.png`);
                if (!cull) writeFileSync(panPath, panImage);
                else {
                    writeFileSync(join(out, `arch-${factor}-pan-cull.png`), panImage);
                    const pixels = {
                        name: "arch-cn-114",
                        factor,
                        phase: "pan-settled",
                        ...compare(panImage, readFileSync(panPath)),
                    };
                    checks.push(pixels);
                    console.log(JSON.stringify(pixels));
                    if (pixels.nonEdge > 0)
                        throw new Error(`arch interior mismatch: ${JSON.stringify(pixels)}`);
                }
                const row = { name: "arch-cn-114", cull, factor, zoom: result, pan };
                timings.push(row);
                console.log(
                    JSON.stringify({
                        name: row.name,
                        cull,
                        factor,
                        shownMs: result.shownMs,
                        frontendMs: result.stats.ms.frontend,
                        vertices: result.stats.vertices,
                        panMs: pan.shownMs,
                    }),
                );
            }
            await page.close();
        }
    }
    if (errors.length) throw new Error(errors.join("\n"));
} finally {
    const report = argv.includes("--synthetic-only")
        ? "cull-synthetic.json"
        : argv.includes("--timings-only")
          ? "cull-arch.json"
          : "cull-browser.json";
    writeFileSync(join(out, report), JSON.stringify({ gpu, checks, timings, errors }, null, 2));
    await browser.close();
    await server.close();
}
