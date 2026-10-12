/**
 * Pipeline benchmark over a fixed set of large, varied corpus files: the viewer worker's work
 * (tokenize → model → renderPlot → pick data) in Node, per stage, median of `--runs`.
 *
 *   node tools/corpus/src/bench.ts [--runs 3] [--only <regex>] [--parse-only] [--zoom] [--zoom-cull] [--by-type] [--gc] [--json out.json]
 *
 * `--by-type`: exclusive frontend time and emitted vertices per entity type (all render passes).
 * `--gc`: with --expose-gc, collect before drawing to exclude garbage from the extra load measurements.
 *
 * Profile one file: node --cpu-prof --cpu-prof-dir=samples/reports/prof tools/corpus/src/bench.ts --only Network
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTags } from "@truedxf/core";
import { DxfDocument } from "@truedxf/model";
import { DisplayListBuilder, Frontend, transferables } from "@truedxf/render";
import { type RenderParams, ViewerCore } from "../../../packages/viewer/src/protocol.ts";
import { resolveBenchPaths } from "./bench-set.ts";
import { ROOT } from "./common.ts";

const FONT_DIRS = [
    join(ROOT, "packages", "fonts", "assets"),
    join(ROOT, "apps", "playground", "fonts"),
    "C:/Windows/Fonts",
    "C:/Program Files/Autodesk/AutoCAD 2027/Fonts",
].filter((d) => existsSync(d));
const fontIndex = new Map<string, string>();
for (const d of FONT_DIRS)
    for (const f of readdirSync(d))
        if (!fontIndex.has(f.toLowerCase())) fontIndex.set(f.toLowerCase(), join(d, f));
const fontBytes = new Map<string, Uint8Array | undefined>();
async function loadFont(name: string): Promise<Uint8Array | undefined> {
    const k = name.toLowerCase();
    if (!fontBytes.has(k)) {
        const p = fontIndex.get(k);
        fontBytes.set(k, p ? new Uint8Array(readFileSync(p)) : undefined);
    }
    return fontBytes.get(k);
}
const loadImage = async () => undefined;

function args() {
    const a = {
        runs: 3,
        only: undefined as RegExp | undefined,
        zoom: false,
        zoomCull: false,
        byType: false,
        parseOnly: false,
        blockReuse: true,
        gc: false,
        json: undefined as string | undefined,
    };
    const v = process.argv.slice(2);
    for (let i = 0; i < v.length; i++) {
        if (v[i] === "--runs") a.runs = Number(v[++i]);
        else if (v[i] === "--only") a.only = new RegExp(v[++i]!, "i");
        else if (v[i] === "--zoom-cull") a.zoomCull = true;
        else if (v[i] === "--zoom") a.zoom = true;
        else if (v[i] === "--by-type") a.byType = true;
        else if (v[i] === "--parse-only") a.parseOnly = true;
        else if (v[i] === "--no-block-reuse") a.blockReuse = false;
        else if (v[i] === "--gc") a.gc = true;
        else if (v[i] === "--json") a.json = v[++i];
    }
    if (a.zoomCull && !a.only)
        a.only = /^(arch-cn-114|dense-hatch-21|circles-117|dims-rumah-34|hatch-gdal-31|viewports-24)$/;
    return a;
}

const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[xs.length >> 1]!;

const BASE: Omit<RenderParams, "area"> = {
    layout: "Model",
    canvas: [1600, 1000],
    background: [33, 40, 48],
    layers: {},
    lineweights: true,
    raster: "smooth",
    dpi: 100,
    assets: 0,
};

const a = args();
BASE.blockReuse = a.blockReuse;
const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
if (a.gc && !gc) throw new Error("--gc requires node --expose-gc");

/** Exclusive (nested entities subtracted) time / vertices per entity type. */
const byType = new Map<string, { ms: number; vertices: number; n: number }>();
let vertexCounter = 0;
if (a.byType) {
    const bp = DisplayListBuilder.prototype as unknown as Record<string, (...x: unknown[]) => void>;
    const vertex = bp.vertex!;
    bp.vertex = function (this: unknown, ...x: unknown[]) {
        vertexCounter++;
        vertex.apply(this, x);
    };
    const fp = Frontend.prototype as unknown as Record<string, (...x: unknown[]) => void>;
    const content = fp.drawEntityContent!;
    const stack: { ms: number; vertices: number }[] = [];
    fp.drawEntityContent = function (this: unknown, ...x: unknown[]) {
        const e = x[0] as { type: string; dxfType: string };
        const t0 = performance.now();
        const v0 = vertexCounter;
        stack.push({ ms: 0, vertices: 0 });
        try {
            content.apply(this, x);
        } finally {
            const inner = stack.pop()!;
            const ms = performance.now() - t0;
            const vertices = vertexCounter - v0;
            const k = e.type === "UNKNOWN" ? e.dxfType : e.type;
            const r = byType.get(k) ?? { ms: 0, vertices: 0, n: 0 };
            r.ms += ms - inner.ms;
            r.vertices += vertices - inner.vertices;
            r.n++;
            byType.set(k, r);
            const outer = stack[stack.length - 1];
            if (outer) {
                outer.ms += ms;
                outer.vertices += vertices;
            }
        }
    };
}
const files = resolveBenchPaths();
if (files.size === 0) {
    console.log("no corpus files (samples/external/manifest.jsonl missing)");
    process.exit(0);
}
const rows: Record<string, unknown>[] = [];
for (const [name, path] of files) {
    if (a.only && !a.only.test(name) && !a.only.test(path)) continue;
    const bytes = new Uint8Array(readFileSync(path));
    const t = {
        tags: [] as number[],
        model: [] as number[],
        render: [] as number[],
        renderCpu: [] as number[],
        pick: [] as number[],
        zoom: [] as number[],
    };
    const cullRows = new Map<string, { ms: number[]; vertices: number[] }>();
    let info: Record<string, unknown> = {};
    let error: string | undefined;
    try {
        for (let r = 0; r < a.runs; r++) {
            let s = performance.now();
            readTags(bytes);
            t.tags.push(performance.now() - s);
            s = performance.now();
            DxfDocument.load(bytes);
            t.model.push(performance.now() - s);
            if (a.parseOnly) continue;
            // fresh core per run: no font/glyph caches carried over (the viewer loads a file once)
            const core = new ViewerCore(loadFont, loadImage);
            const doc = core.load(bytes, name);
            if (a.gc) {
                // Exclude garbage from the two extra parser measurements when isolating drawing.
                gc!();
                gc!();
            }
            const cpuStart = process.cpuUsage();
            const res = await core.render({ ...BASE, layout: doc.activeLayout, area: { type: "extents" } });
            const cpu = process.cpuUsage(cpuStart);
            // CPU time separates this process's render/pick work from unrelated scheduler load.
            t.renderCpu.push((cpu.user + cpu.system) / 1000);
            t.render.push(res.ms.frontend);
            t.pick.push(res.ms.pick);
            if (a.zoomCull) {
                for (const factor of [8, 64]) {
                    // Reset to the same fit bounds before each pair; an unculled fine render also
                    // updates the core's cache, so reusing it would give the next cull an unfair map.
                    if (factor !== 8)
                        await core.render({ ...BASE, layout: doc.activeLayout, area: { type: "extents" } });
                    const b = res.view;
                    const cx = (b.minX + b.maxX) / 2,
                        cy = (b.minY + b.maxY) / 2;
                    const hw = (b.maxX - b.minX) / (factor * 2),
                        hh = (b.maxY - b.minY) / (factor * 2);
                    for (const culled of [true, false]) {
                        const z = await core.render({
                            ...BASE,
                            layout: doc.activeLayout,
                            area: { type: "window", min: [cx - hw, cy - hh], max: [cx + hw, cy + hh] },
                            ...(culled
                                ? {
                                      cull: {
                                          minX: cx - hw * 3,
                                          minY: cy - hh * 3,
                                          maxX: cx + hw * 3,
                                          maxY: cy + hh * 3,
                                      },
                                  }
                                : {}),
                        });
                        const k = `${factor}/${culled ? "culled" : "full"}`;
                        const row = cullRows.get(k) ?? { ms: [], vertices: [] };
                        row.ms.push(z.ms.frontend);
                        row.vertices.push(z.stats.vertices);
                        cullRows.set(k, row);
                    }
                }
            }
            if (a.zoom && res.bounds) {
                // 4× zoom into the centre: a new LOD list (the frontend re-tessellates everything)
                const b = res.bounds;
                const cx = (b.minX + b.maxX) / 2;
                const cy = (b.minY + b.maxY) / 2;
                const hw = (b.maxX - b.minX) / 8;
                const hh = (b.maxY - b.minY) / 8;
                const z = await core.render({
                    ...BASE,
                    layout: doc.activeLayout,
                    area: { type: "window", min: [cx - hw, cy - hh], max: [cx + hw, cy + hh] },
                });
                t.zoom.push(z.ms.frontend);
            }
            if (r === 0) {
                let vertices = 0;
                for (const b of res.list.batches) {
                    vertices += b.positions.length / 2;
                }
                let transfer = 0;
                for (const buf of transferables(res.list)) transfer += buf.byteLength;
                info = {
                    entities: doc.entityCount,
                    layout: doc.activeLayout,
                    batches: res.list.batches.length,
                    vertices,
                    transferMb: +(transfer / 2 ** 20).toFixed(1),
                    unsupported: Object.keys(res.unsupported).length,
                };
            }
        }
    } catch (e) {
        error = String(e);
    }
    const mb = bytes.length / 2 ** 20;
    const row = {
        name,
        mb: +mb.toFixed(1),
        tagsMs: Math.round(median(t.tags)),
        modelMs: Math.round(median(t.model)),
        tagsMbS: +(mb / (median(t.tags) / 1000)).toFixed(0),
        renderMs: t.render.length ? Math.round(median(t.render)) : undefined,
        renderCpuMs: t.renderCpu.length ? Math.round(median(t.renderCpu)) : undefined,
        pickMs: t.pick.length ? Math.round(median(t.pick)) : undefined,
        zoomMs: t.zoom.length ? Math.round(median(t.zoom)) : undefined,
        ...info,
        ...(a.zoomCull
            ? {
                  zoomCull: Object.fromEntries(
                      [...cullRows].map(([k, v]) => [
                          k,
                          {
                              frontendMs: Math.round(median(v.ms)),
                              vertices: median(v.vertices),
                          },
                      ]),
                  ),
              }
            : {}),
        error,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
    if (a.byType) {
        for (const [k, r] of [...byType].sort((x, y) => y[1].ms - x[1].ms).slice(0, 15))
            console.log(
                `  ${k.padEnd(20)} ${String(r.n).padStart(9)} drawn ${Math.round(r.ms).toString().padStart(7)} ms ${(r.vertices / 1e6).toFixed(2).padStart(8)} M vertices`,
            );
        byType.clear();
    }
}
if (a.json)
    writeFileSync(
        a.json,
        JSON.stringify({ date: new Date().toISOString(), node: process.version, rows }, null, 1),
    );
