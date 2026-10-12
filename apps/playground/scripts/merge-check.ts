/** GPU pixel comparison: pnpm exec node apps/playground/scripts/merge-check.ts [--skip-build]. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DisplayListRenderer } from "@truedxf/three";
import type { Backend, DxfViewer, RenderParams } from "@truedxf/viewer";
import { chromium, type Page } from "playwright";
import type * as THREE from "three";
import { build, preview } from "vite";

type DisplayList = Parameters<DisplayListRenderer["setDisplayList"]>[0];
type Batch = DisplayList["batches"][number];

const APP = resolve(import.meta.dirname, "..");
const SAMPLES = resolve(APP, "../../samples");
const files = process.argv.includes("--synthetic-only")
    ? []
    : readFileSync(join(SAMPLES, "reports/prof/perf-files.txt"), "utf8").trim().split(",");
const only = process.argv[process.argv.indexOf("--only") + 1];
const selectedFiles = process.argv.includes("--only") ? files.filter((f) => f.includes(only!)) : files;
if (!process.argv.includes("--skip-build"))
    await build({ configFile: join(APP, "vite.config.ts"), root: APP, logLevel: "warn" });
const server = await preview({ configFile: join(APP, "vite.config.ts"), root: APP, preview: { port: 0 } });
const browser = await chromium.launch({
    args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"],
    ignoreDefaultArgs: ["--enable-unsafe-swiftshader"],
});
const results: Record<string, unknown>[] = [];

/** Exercise real pointer events and asynchronous worker highlights, including viewport stencils. */
async function interactionSmoke(page: Page, paper: boolean): Promise<Record<string, unknown>> {
    const target = await page.evaluate(async (paper) => {
        const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
        if (paper) {
            const layout = v.layouts.find((l) => !l.isModel && !l.empty);
            if (!layout) throw new Error("smoke: no paper layout");
            await v.setLayout(layout.name);
        }
        v.setInteraction({ pan: false, zoom: false, hover: true, select: true });
        v.fit();
        // Wait for the fitted list's LOD request, if any, before choosing a pointer target.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const rect = v.canvas.getBoundingClientRect();
        const internals = v as unknown as {
            current: { generation: number; batches?: unknown; pick?: unknown };
            renderer: { list?: unknown };
        };
        if (internals.current.batches || internals.current.pick || internals.renderer.list)
            throw new Error("smoke: main thread retained list geometry/index");
        for (const o of v.renderer.scene.children) {
            const mesh = o as THREE.Mesh;
            if (!mesh.geometry || !(mesh.material as THREE.Material)?.colorWrite) continue;
            for (const name of ["position", "color", "uv"])
                if (mesh.geometry.getAttribute(name)?.array)
                    throw new Error(`smoke: uploaded ${name} array was not released`);
        }
        const state = { hover: undefined as string | undefined, select: undefined as string | undefined };
        (window as unknown as { interactionSmoke: typeof state }).interactionSmoke = state;
        v.on("hover", (e) => {
            state.hover = e.handle;
        });
        v.on("select", (e) => {
            state.select = e.handle;
        });
        for (let iy = 1; iy < 32; iy++) {
            for (let ix = 1; ix < 32; ix++) {
                const x = (rect.width * ix) / 32;
                const y = (rect.height * iy) / 32;
                const handle = await v.pickAt(x, y);
                if (!handle) continue;
                // The paper-space smoke must exercise clipped model content, not just its frame.
                if (paper) {
                    const backend = (v as unknown as { backend: Backend }).backend;
                    const geometry = await backend.call({
                        type: "geometry",
                        entity: handle,
                        generation: internals.current.generation,
                    });
                    if (!geometry?.parts.some((p) => (p.clip ?? -1) >= 0)) continue;
                }
                return { x: rect.left + x, y: rect.top + y, handle, layout: v.layout };
            }
        }
        throw new Error("smoke: no visible entity found");
    }, paper);
    await page.mouse.move(target.x, target.y);
    await page.waitForFunction((handle) => {
        const w = window as unknown as {
            interactionSmoke: { hover?: string };
            truedxf: { viewer: DxfViewer };
        };
        const g = (w.truedxf.viewer as unknown as { hoverGroup: THREE.Group }).hoverGroup;
        return (
            w.interactionSmoke.hover === handle &&
            g.children.some((o) => {
                const m = o as THREE.Mesh;
                return (
                    (m.material as THREE.Material)?.colorWrite &&
                    m.geometry?.getAttribute("position")?.count > 0
                );
            })
        );
    }, target.handle);
    await page.mouse.click(target.x, target.y);
    await page.waitForFunction((handle) => {
        const w = window as unknown as {
            interactionSmoke: { select?: string };
            truedxf: { viewer: DxfViewer };
        };
        const g = (w.truedxf.viewer as unknown as { selectGroup: THREE.Group }).selectGroup;
        return (
            w.interactionSmoke.select === handle &&
            g.children.some((o) => {
                const m = o as THREE.Mesh;
                return (
                    (m.material as THREE.Material)?.colorWrite &&
                    m.geometry?.getAttribute("position")?.count > 0
                );
            })
        );
    }, target.handle);
    const highlight = await page.evaluate(() => {
        const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
        const g = (v as unknown as { selectGroup: THREE.Group }).selectGroup;
        const geometry = g.children.filter((o) => ((o as THREE.Mesh).material as THREE.Material)?.colorWrite);
        return {
            objects: geometry.length,
            clipped: geometry.some((o) => ((o as THREE.Mesh).material as THREE.Material).stencilWrite),
        };
    });
    if (paper && !highlight.clipped) throw new Error("smoke: viewport highlight lost its stencil test");
    return { ...target, highlight };
}

try {
    const probe = await browser.newPage();
    await probe.goto(server.resolvedUrls!.local[0]!);
    await probe.waitForFunction(() => !!(window as unknown as { truedxf?: unknown }).truedxf);
    const synthetic = await probe.evaluate(() => {
        const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
        const Renderer = v.renderer.constructor as typeof DisplayListRenderer;
        const bounds = { minX: -1, minY: -1, maxX: 1, maxY: 1 };
        const xy = [-0.8, -0.8, 0.8, -0.8, 0.8, 0.8, -0.8, -0.8, 0.8, 0.8, -0.8, 0.8];
        function batch(rgb: number[], clip = -1, kind: Batch["kind"] = 0): Batch {
            const positions = new Float32Array(kind === 1 ? [-0.9, 0, 0.9, 0] : kind === 2 ? [0, 0] : xy);
            return {
                kind,
                clip,
                originX: 0,
                originY: 0,
                positions,
                colors: Uint8Array.from({ length: positions.length * 2 }, (_, i) => rgb[i % 4] ?? 255),
                pick: new Uint32Array([0, positions.length / 2, 0]),
            };
        }
        const red = batch([255, 0, 0]);
        const blue = batch([0, 0, 255]);
        const clips = [
            { rings: [new Float64Array([-1, -1, 0, -1, 0, 1, -1, 1])] },
            { rings: [new Float64Array([0, -1, 1, -1, 1, 1, 0, 1])] },
        ];
        const image: Batch = {
            ...batch([255, 255, 255], -1, 3),
            image: 0,
            uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]),
        };
        const cases = [
            {
                name: "later range wins",
                batches: [
                    {
                        ...red,
                        positions: new Float32Array([...xy, ...xy]),
                        colors: new Uint8Array([...red.colors, ...blue.colors]),
                        pick: new Uint32Array([0, 6, 0, 6, 6, 1]),
                    },
                ],
                center: [0, 0, 255, 255],
            },
            { name: "later kind wins", batches: [batch([0, 255, 0], -1, 1), red, batch([0, 0, 255], -1, 2)] },
            { name: "stencil groups", batches: [red, batch([0, 255, 0], 0), batch([0, 0, 255], 1)] },
            {
                name: "alpha between opaque",
                batches: [red, batch([0, 255, 0, 128]), blue],
                center: [0, 0, 255, 255],
            },
            { name: "alpha layers", batches: [red, batch([0, 255, 0, 128]), batch([0, 0, 255, 128])] },
            { name: "image", batches: [red, image] },
            { name: "host layers and clipped highlight", batches: [red], host: true },
        ];
        const checks = [];
        for (const exactBlend of [true, false]) {
            const r = new Renderer({ mergeBatches: true, exactBlend });
            const count = exactBlend ? 1 : 4_000_001;
            const fallbackBatch = {
                ...batch([255, 0, 0], -1, 2),
                positions: new Float32Array(count * 2),
                colors: new Uint8Array(count * 4).fill(255),
                pick: Uint32Array.from({ length: count * 3 }, (_, i) =>
                    i % 3 === 0 ? i / 3 : i % 3 === 1 ? 1 : 0,
                ),
            };
            r.setDisplayList({
                batches: [fallbackBatch],
                clips: [],
                images: [],
                entities: [],
                pixelSize: 1,
                background: [0, 0, 0],
                bounds,
            });
            const object = r.scene.children.find((o) => (o as THREE.Points).isPoints) as THREE.Points;
            if (
                object.geometry.getAttribute("position").itemSize !== 2 ||
                (object.material as THREE.Material).depthTest
            )
                throw new Error("unmerged fallback was not selected");
            checks.push({
                name: exactBlend ? "exactBlend disables merging" : "depth capacity fallback",
                different: 0,
            });
            r.dispose();
        }
        for (const c of cases) {
            const pixels: Uint8Array[] = [];
            for (const mergeBatches of [false, true]) {
                const r = new Renderer({
                    mergeBatches,
                    exactBlend: false,
                    antialias: false,
                    releaseArrays: true,
                });
                r.setSize(64, 64);
                const list: DisplayList = {
                    batches: c.batches,
                    clips,
                    images: [{ width: 1, height: 1, pixels: new Uint8Array([0, 0, 255, 128]) }],
                    entities: [],
                    pixelSize: 1,
                    background: [0, 0, 0],
                    bounds,
                };
                r.setDisplayList(list);
                if (c.host) {
                    // Borrow an uploaded mesh's geometry/material to test queue-independent host stages.
                    const mesh = r.scene.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh;
                    const below = mesh.clone();
                    below.material = (mesh.material as THREE.Material).clone();
                    const bm = below.material as THREE.MeshBasicMaterial;
                    bm.vertexColors = false;
                    bm.color.setRGB(0, 1, 0);
                    bm.transparent = true;
                    bm.depthTest = false;
                    bm.depthWrite = false;
                    below.scale.set(1.2, 1.2, 1);
                    r.underlay.add(below);
                    const above = below.clone();
                    above.material = bm.clone();
                    (above.material as THREE.MeshBasicMaterial).color.setRGB(0, 0, 1);
                    Object.assign(above.material, { stencilWrite: true, stencilFunc: 517, stencilRef: 0 });
                    // NotEqualStencilFunc = 517; same CLIPPED_STENCIL contract as viewer highlights.
                    const masks = r.clipMaskObjects(clips[0]!);
                    masks.forEach((m, i) => {
                        m.renderOrder = i;
                        r.overlay.add(m);
                    });
                    above.renderOrder = masks.length;
                    r.overlay.add(above);
                }
                r.render(bounds);
                const data = r.readPixels().data;
                pixels.push(data);
                // Release-array upload callbacks must also permit subsequent renders.
                r.render(bounds);
                const second = r.readPixels().data;
                if (data.some((x, i) => x !== second[i])) throw new Error(`${c.name}: second render changed`);
                if (c.center?.some((x, i) => x !== data[(32 * 64 + 32) * 4 + i]))
                    throw new Error(`${c.name}: later depth did not win`);
                r.dispose();
            }
            let different = 0;
            for (let i = 0; i < pixels[0]!.length; i += 4)
                if ([0, 1, 2, 3].some((k) => pixels[0]![i + k] !== pixels[1]![i + k])) different++;
            checks.push({ name: c.name, different });
            if (different) throw new Error(`${c.name}: ${different} different pixels`);
        }
        return checks;
    });
    console.log("Synthetic GPU checks:", synthetic);
    await probe.close();
    results.push({ synthetic });
    for (const file of selectedFiles) {
        const captures: Buffer[] = [];
        const modes: Record<string, unknown>[] = [];
        for (const merge of [1, 0]) {
            const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
            try {
                if (process.argv.includes("--diagnose") && merge === 1) {
                    await page.addInitScript(() => {
                        Object.defineProperty(window, "truedxf", {
                            configurable: true,
                            set(value: { viewer: DxfViewer }) {
                                Object.defineProperty(window, "truedxf", { value, configurable: true });
                                const backend = (value.viewer as unknown as { backend: Backend }).backend;
                                const call = backend.call.bind(backend);
                                backend.call = (request, transfer) => {
                                    if (request.type === "render" && request.params.retain !== false)
                                        (window as unknown as { mergeParams: RenderParams }).mergeParams =
                                            request.params;
                                    return call(request, transfer);
                                };
                            },
                        });
                    });
                }
                const fileUrl = `api/samples/file/${file.split("/").map(encodeURIComponent).join("/")}`;
                await page.goto(
                    `${server.resolvedUrls!.local[0]}?aa=0&merge=${merge}&file=${encodeURIComponent(fileUrl)}`,
                );
                await page.waitForFunction(
                    () => (window as unknown as { truedxf?: { metrics: unknown[] } }).truedxf?.metrics.length,
                    undefined,
                    { timeout: 300_000 },
                );
                const capture = await page.evaluate(async () => {
                    const v = (window as unknown as { truedxf: { viewer: DxfViewer } }).truedxf.viewer;
                    v.fit();
                    // Let fit/LOD and layout settle before capturing the same fitted window.
                    await new Promise((ok) => setTimeout(ok, 500));
                    v.renderNow();
                    const { width, height, data } = v.renderer.readPixels();
                    let binary = "";
                    for (let i = 0; i < data.length; i += 8192)
                        binary += String.fromCharCode(...data.subarray(i, i + 8192));
                    const gl = v.renderer.renderer.getContext();
                    const ext = gl.getExtension("WEBGL_debug_renderer_info");
                    let alphaImageObjects = 0;
                    v.renderer.scene.traverse((o) => {
                        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
                        if (m?.depthTest && m.transparent && m.blending === 1) alphaImageObjects++;
                    });
                    return {
                        pixels: btoa(binary),
                        width,
                        height,
                        calls: v.renderer.renderer.info.render.calls,
                        view: v.viewState,
                        alphaImageObjects,
                        depthBits: gl.getParameter(gl.DEPTH_BITS) as number,
                        gpu: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown",
                    };
                });
                const { pixels, ...mode } = capture;
                captures.push(Buffer.from(pixels, "base64"));
                modes.push({ merge, ...mode });
                if (process.argv.includes("--diagnose") && merge === 1) {
                    const diagnosis = await page.evaluate(async () => {
                        const w = window as unknown as {
                            truedxf: { viewer: DxfViewer };
                            mergeParams: RenderParams;
                        };
                        const r = w.truedxf.viewer.renderer;
                        // Request an auxiliary ordinary list at the same resolution; picking stays on the
                        // interactive generation and this diagnostic never retains arrays in normal use.
                        const params = w.mergeParams;
                        const list = (await w.truedxf.viewer.renderList({ ...params, mergeBatches: false }))
                            .list;
                        const rebased: Batch[] = [];
                        for (let start = 0; start < list.batches.length; ) {
                            let end = start;
                            let minX = Infinity;
                            let minY = Infinity;
                            let maxX = -Infinity;
                            let maxY = -Infinity;
                            while (
                                end < list.batches.length &&
                                list.batches[end]!.clip === list.batches[start]!.clip
                            ) {
                                const b = list.batches[end++]!;
                                for (let i = 0; i < b.positions.length; i += 2) {
                                    const x = b.originX + b.positions[i]!;
                                    const y = b.originY + b.positions[i + 1]!;
                                    minX = Math.min(minX, x);
                                    minY = Math.min(minY, y);
                                    maxX = Math.max(maxX, x);
                                    maxY = Math.max(maxY, y);
                                }
                            }
                            const originX = minX + (maxX - minX) / 2;
                            const originY = minY + (maxY - minY) / 2;
                            for (let k = start; k < end; k++) {
                                const b = list.batches[k]!;
                                const positions = new Float32Array(b.positions.length);
                                for (let i = 0; i < positions.length; i += 2) {
                                    positions[i] = b.originX + b.positions[i]! - originX;
                                    positions[i + 1] = b.originY + b.positions[i + 1]! - originY;
                                }
                                rebased.push({ ...b, positions, originX, originY });
                            }
                            start = end;
                        }
                        const Renderer = r.constructor as typeof DisplayListRenderer;
                        const legacy = new Renderer({ exactBlend: false, antialias: false });
                        const { width, height } = r.readPixels();
                        legacy.setSize(width, height);
                        const v = w.truedxf.viewer.viewState!;
                        const hw = (v.width * v.scale) / 2;
                        const hh = (v.height * v.scale) / 2;
                        const view = { minX: v.cx - hw, maxX: v.cx + hw, minY: v.cy - hh, maxY: v.cy + hh };
                        legacy.setDisplayList({ ...list, batches: rebased });
                        legacy.render(view);
                        const rebasedPixels = legacy.readPixels().data;
                        w.truedxf.viewer.renderNow();
                        const mergedPixels = r.readPixels().data;
                        legacy.setDisplayList(list);
                        legacy.render(view);
                        const originalPixels = legacy.readPixels().data;
                        let mergedVsRebased = 0;
                        let originalVsRebased = 0;
                        const examples = [];
                        for (let i = 0; i < mergedPixels.length; i += 4) {
                            if ([0, 1, 2, 3].some((c) => mergedPixels[i + c] !== rebasedPixels[i + c]))
                                mergedVsRebased++;
                            if ([0, 1, 2, 3].some((c) => originalPixels[i + c] !== rebasedPixels[i + c])) {
                                originalVsRebased++;
                                if (examples.length < 10)
                                    examples.push({
                                        x: (i / 4) % width,
                                        y: Math.floor(i / 4 / width),
                                        original: [...originalPixels.subarray(i, i + 4)],
                                        rebased: [...rebasedPixels.subarray(i, i + 4)],
                                    });
                            }
                        }
                        legacy.dispose();
                        return { mergedVsRebased, originalVsRebased, examples };
                    });
                    modes[0]!.diagnosis = diagnosis;
                    console.log("Coordinate-rebase diagnosis:", diagnosis);
                    if (diagnosis.mergedVsRebased !== 0)
                        throw new Error(
                            `${file}: merging changed ${diagnosis.mergedVsRebased} pixels beyond rebasing`,
                        );
                }
                if (file.includes("problematic_viewports.dxf") || file.endsWith("/Network.dxf")) {
                    const smoke = await interactionSmoke(page, file.includes("problematic_viewports.dxf"));
                    modes[modes.length - 1]!.interaction = smoke;
                    console.log("Interaction smoke:", smoke);
                }
            } finally {
                await page.close();
            }
        }
        let different = 0;
        const [on, off] = captures as [Buffer, Buffer];
        if (on.length !== off.length) throw new Error("drawing buffer size changed");
        if (JSON.stringify(modes[0]!.view) !== JSON.stringify(modes[1]!.view))
            throw new Error("fitted views differ");
        for (let i = 0; i < on.length; i += 4) if (on.readUInt32LE(i) !== off.readUInt32LE(i)) different++;
        if (different > 2) throw new Error(`${file}: ${different} differing pixels exceeds the merge gate`);
        results.push({ file, different, modes });
        console.log(
            `${file.split("/").pop()}: ${different} differing pixels; ${modes[0]!.calls} / ${modes[1]!.calls} calls`,
        );
    }
} finally {
    await browser.close();
    await server.close();
}
mkdirSync(join(SAMPLES, "reports/prof"), { recursive: true });
const report = process.argv.includes("--synthetic-only")
    ? "merge-synthetic.json"
    : process.argv.includes("--only")
      ? `merge-check-${only}.json`
      : "merge-check.json";
writeFileSync(join(SAMPLES, "reports/prof", report), JSON.stringify(results, null, 2));
