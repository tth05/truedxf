/** Compare viewer LOD at one fixed view, including CPU-rasterized hairlines. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DxfDocument } from "@truedxf/model";
import { type PlotRequest, type PlotResult, renderPlot } from "@truedxf/render";
import { rasterize } from "../../../packages/testkit/src/cpu-raster.ts";
import { nodeImageLoader } from "../../../packages/testkit/src/image-files.ts";
import { diffImage } from "../../../packages/testkit/src/metrics.ts";
import { writePng } from "../../../packages/testkit/src/png.ts";
import { describe } from "../../../packages/viewer/src/protocol.ts";
import { resolveBenchPaths } from "./bench-set.ts";
import { ROOT } from "./common.ts";
import { shape } from "./fingerprint-hash.ts";

/** Small detail cases: distinguish a triangle/vertex permutation from actual displacement. */
function primitiveKeys(list: PlotResult["displayList"]): string[] {
    const keys: string[] = [];
    for (const b of list.batches) {
        const stride = b.kind === 0 || b.kind === 3 ? 3 : b.kind === 1 ? 2 : 1;
        for (let i = 0; i < b.positions.length / 2; i += stride) {
            const vertices: string[] = [];
            for (let k = i; k < i + stride; k++) {
                const x = Math.round(((b.positions[k * 2]! + b.originX) / list.pixelSize) * 1000);
                const y = Math.round(((b.positions[k * 2 + 1]! + b.originY) / list.pixelSize) * 1000);
                vertices.push(`${x},${y},${[...b.colors.subarray(k * 4, k * 4 + 4)]}`);
            }
            keys.push(`${b.kind}/${b.clip}/${vertices.sort().join(";")}`);
        }
    }
    return keys.sort();
}

const args = process.argv.slice(2);
let only: RegExp | undefined;
let json: string | undefined;
let images: string | undefined;
let fixtureCount = 3;
let blockReuse = false;
let detail = false;
for (let i = 0; i < args.length; i++) {
    if (args[i] === "--only") only = new RegExp(args[++i]!, "i");
    else if (args[i] === "--json") json = args[++i];
    else if (args[i] === "--images") images = args[++i];
    else if (args[i] === "--fixtures") fixtureCount = Number(args[++i]);
    else if (args[i] === "--block-reuse") blockReuse = true;
    else if (args[i] === "--detail") detail = true;
    else throw new Error(`unknown argument: ${args[i]}`);
}
if (!Number.isInteger(fixtureCount) || fixtureCount < 0) throw new Error("invalid --fixtures count");

const fontIndex = new Map<string, string>();
for (const dir of [
    join(ROOT, "packages/fonts/assets"),
    join(ROOT, "apps/playground/fonts"),
    "C:/Windows/Fonts",
    "C:/Program Files/Autodesk/AutoCAD 2027/Fonts",
]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir))
        if (!fontIndex.has(file.toLowerCase())) fontIndex.set(file.toLowerCase(), join(dir, file));
}
const fontBytes = new Map<string, Uint8Array | undefined>();
async function loadFont(name: string): Promise<Uint8Array | undefined> {
    const key = name.toLowerCase();
    if (!fontBytes.has(key)) {
        const path = fontIndex.get(key);
        fontBytes.set(key, path ? new Uint8Array(readFileSync(path)) : undefined);
    }
    return fontBytes.get(key);
}

const targets = [...resolveBenchPaths()].map(([name, path]) => ({ name, path, fixture: false }));
for (const suite of ["hatches", "text", "mtext", "blocks"]) {
    const dir = join(ROOT, "samples/generated", suite);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
        .filter((f) => f.endsWith(".dxf"))
        .sort();
    const n = Math.min(fixtureCount, files.length);
    for (let i = 0; i < n; i++) {
        const file = files[n === 1 ? 0 : Math.floor((i * (files.length - 1)) / (n - 1))]!;
        targets.push({ name: `${suite}/${file.slice(0, -4)}`, path: join(dir, file), fixture: true });
    }
}

const canvas = [1600, 1000] as const;
const background = [33, 40, 48] as const;
const rows: Record<string, unknown>[] = [];
for (const { name, path, fixture } of targets) {
    if (only && !only.test(name)) continue;
    try {
        const doc = DxfDocument.load(new Uint8Array(readFileSync(path)));
        const env = {
            loadFont,
            loadImage: fixture ? nodeImageLoader(dirname(path)) : async () => undefined,
            raster: "smooth" as const,
            visibility: "display" as const,
            background,
            calibration: { dpi: 100 },
            ...(blockReuse ? { lod: true, blockReuse: false } : {}),
        };
        const layout = describe(doc, name, 0, 0).activeLayout;
        const request: PlotRequest = { layout, canvas, area: { type: "extents" }, lineweights: true };
        // Discard the fit list before the pair: dense hatches can require gigabytes of geometry.
        let fit: PlotResult | undefined = await renderPlot(doc, request, env);
        const view = fit.view;
        fit = undefined;
        globalThis.gc?.();
        request.area = { type: "window", min: [view.minX, view.minY], max: [view.maxX, view.maxY] };
        let start = performance.now();
        let off: PlotResult | undefined = await renderPlot(doc, request, env);
        const offMs = performance.now() - start;
        const offVertices = off.displayList.batches.reduce((n, b) => n + b.positions.length / 2, 0);
        const offImage = rasterize(off.displayList, view, canvas);
        const oldList = detail ? off.displayList : undefined;
        off = undefined;
        globalThis.gc?.();
        start = performance.now();
        const on = await renderPlot(doc, request, { ...env, lod: true, blockReuse: true });
        const onMs = performance.now() - start;
        const onVertices = on.displayList.batches.reduce((n, b) => n + b.positions.length / 2, 0);
        const onImage = rasterize(on.displayList, view, canvas);
        if (images) {
            const base = join(images, name);
            mkdirSync(dirname(base), { recursive: true });
            writePng(`${base}.off.png`, offImage);
            writePng(`${base}.on.png`, onImage);
            writePng(`${base}.diff.png`, diffImage(offImage, onImage));
        }
        let changedPixels = 0;
        let changedPixelsAny = 0;
        let inkPixels = 0;
        for (let p = 0; p < offImage.data.length; p += 4) {
            let changed = false;
            let changedAny = false;
            let ink = false;
            for (let c = 0; c < 3; c++) {
                const a = offImage.data[p + c]!;
                const b = onImage.data[p + c]!;
                changed ||= Math.abs(a - b) > 48;
                changedAny ||= a !== b;
                ink ||= a !== background[c] || b !== background[c];
            }
            if (changed) changedPixels++;
            if (changedAny) changedPixelsAny++;
            if (ink) inkPixels++;
        }
        let coordinatesPx: number | undefined;
        let sameStructure: boolean | undefined;
        let samePrimitivesAtMilliPixel: boolean | undefined;
        if (oldList) {
            sameStructure = shape(oldList).structure === shape(on.displayList).structure;
            if (sameStructure) {
                coordinatesPx = 0;
                for (let i = 0; i < oldList.batches.length; i++) {
                    const a = oldList.batches[i]!,
                        b = on.displayList.batches[i]!;
                    for (let j = 0; j < a.positions.length; j++) {
                        const ao = j % 2 ? a.originY : a.originX,
                            bo = j % 2 ? b.originY : b.originX;
                        coordinatesPx = Math.max(
                            coordinatesPx,
                            Math.abs(a.positions[j]! + ao - b.positions[j]! - bo) / on.displayList.pixelSize,
                        );
                    }
                }
            }
            if (
                coordinatesPx !== undefined &&
                coordinatesPx > 1e-3 &&
                offVertices === onVertices &&
                onVertices < 50_000
            ) {
                const a = primitiveKeys(oldList),
                    b = primitiveKeys(on.displayList);
                samePrimitivesAtMilliPixel = a.length === b.length && a.every((key, i) => key === b[i]);
            }
        }
        const row = {
            name,
            offVertices,
            onVertices,
            offMs: Math.round(offMs),
            onMs: Math.round(onMs),
            changedPixels,
            changedPixelsAny,
            inkPixels,
            changedInkPct: inkPixels ? +((100 * changedPixels) / inkPixels).toFixed(3) : 0,
            ...(detail ? { sameStructure, coordinatesPx, samePrimitivesAtMilliPixel } : {}),
        };
        rows.push(row);
        console.log(JSON.stringify(row));
    } catch (error) {
        const row = { name, error: String(error) };
        rows.push(row);
        console.log(JSON.stringify(row));
        process.exitCode = 1;
    }
    globalThis.gc?.();
}
if (json) writeFileSync(json, `${JSON.stringify(rows, null, 2)}\n`);
