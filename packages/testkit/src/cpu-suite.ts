/**
 * Scores whole suites with the CPU rasterizer (no browser; fast triage between visual runs):
 *   node packages/testkit/src/cpu-suite.ts <suite>[/<case>] … [--out <dir>] [--quiet] [--draw-raster]
 *        [--hide-fonts <regex>] [--json <file>]
 * Fonts are looked up like the visual harness (packages/fonts/assets, Windows fonts, AutoCAD fonts).
 * Images are resolved like the harness (IMAGEDEF path, then next to the fixture). IMAGE / WIPEOUT
 * are omitted like accoreconsole does unless --draw-raster. PDF underlays are rasterized with PDF.js.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadDxf } from "@truedxf/model";
import { createPdfRasterizer } from "@truedxf/pdf";
import { renderPlot } from "@truedxf/render";
import { rasterize } from "./cpu-raster.ts";
import { nodeImageLoader } from "./image-files.ts";
import { compare, diffImage } from "./metrics.ts";
import { readPng, writePng } from "./png.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const GEN = join(ROOT, "samples", "generated");
const REF = join(ROOT, "samples", "refs", "acad2027-R26.0");

const args = process.argv.slice(2);
let out: string | undefined;
let quiet = false;
let drawRaster = false;
let hideFonts: string | undefined;
let jsonOut: string | undefined;
const targets: string[] = [];
const pdf = createPdfRasterizer();
for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = resolve(args[++i]!);
    else if (args[i] === "--quiet") quiet = true;
    else if (args[i] === "--draw-raster") drawRaster = true;
    else if (args[i] === "--hide-fonts") hideFonts = args[++i]!;
    else if (args[i] === "--json") jsonOut = resolve(args[++i]!);
    else targets.push(args[i]!);
}
const FONT_DIRS = [
    join(ROOT, "packages", "fonts", "assets"),
    "C:/Windows/Fonts",
    "C:/Program Files/Autodesk/AutoCAD 2027/Fonts",
].filter((d) => existsSync(d));
const fontIndex = new Map<string, string>();
for (const d of FONT_DIRS)
    for (const f of readdirSync(d))
        if (!fontIndex.has(f.toLowerCase())) fontIndex.set(f.toLowerCase(), join(d, f));
const fontCache = new Map<string, Uint8Array | undefined>();
async function loadFont(name: string): Promise<Uint8Array | undefined> {
    const key = name.toLowerCase();
    if (!fontCache.has(key)) {
        const path = fontIndex.get(key);
        fontCache.set(key, path ? new Uint8Array(readFileSync(path)) : undefined);
    }
    return fontCache.get(key);
}

let n = 0;
let exact = 0;
let good = 0;
/** Every scored case, also the exact ones (--quiet leaves those out of the log). */
const cases: Record<string, { exact: number; f1: number[] } | { error: string }> = {};
const perSuite: Record<string, { cases: number; exact: number; good: number; f1: number }> = {};
for (const t of targets) {
    const [suite, name] = t.split("/");
    const dir = join(GEN, suite!);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)
        .filter((x) => x.endsWith(".json") && (!name || x === `${name}.json`))
        .sort()) {
        const meta = JSON.parse(readFileSync(join(dir, f), "utf8"));
        const refPng = join(REF, suite!, f.replace(/\.json$/, ".png"));
        const dxf = join(dir, f.replace(/\.json$/, ".dxf"));
        if (!existsSync(refPng) || !existsSync(dxf)) continue;
        try {
            const doc = loadDxf(new Uint8Array(readFileSync(dxf)));
            // the harness prologue sets PLOTTRANSPARENCYOVERRIDE 0 unless the case overrides it
            const plot = { ...meta.plot, sysvars: { PLOTTRANSPARENCYOVERRIDE: 0, ...meta.plot.sysvars } };
            // the harness answers "." for "no plot style table"
            if (plot.styleTable === ".") delete plot.styleTable;
            // "pagesetup": AutoCAD plotted the stored page setup (tools/acad README)
            if (plot.mode === "pagesetup") plot.pageSetup = true;
            const r = await renderPlot(doc, plot, {
                loadImage: nodeImageLoader(dir),
                loadFont,
                // fixture tables (truedxf-*.ctb|stb) lie next to the case; stock names are built in
                loadPlotStyleTable: async (name: string) => {
                    const path = join(dir, name);
                    return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
                },
                pdf,
                rasterEntities: drawRaster ? "draw" : "omit",
                ...(hideFonts ? { text: { unavailableFonts: new RegExp(hideFonts, "i") } } : {}),
            });
            const img = rasterize(r.displayList, r.view, r.canvas);
            const ref = readPng(refPng);
            const m = compare(img, ref);
            n++;
            if (m.exactMismatch === 0) exact++;
            if (m.f1[1] >= 0.99) good++;
            const ps = (perSuite[suite!] ??= { cases: 0, exact: 0, good: 0, f1: 0 });
            ps.cases++;
            if (m.exactMismatch === 0) ps.exact++;
            if (m.f1[1] >= 0.99) ps.good++;
            ps.f1 += m.f1[1];
            cases[meta.id] = { exact: m.exactMismatch, f1: m.f1.map((x: number) => Number(x.toFixed(4))) };
            if (out) {
                mkdirSync(join(out, suite!), { recursive: true });
                const base = join(out, suite!, f.replace(/\.json$/, ""));
                writePng(`${base}.png`, img);
                writePng(`${base}.diff.png`, diffImage(img, ref));
            }
            if (!quiet || m.exactMismatch > 0)
                console.log(
                    meta.id.padEnd(48),
                    `exact=${m.exactMismatch}`.padEnd(14),
                    `f1=${m.f1.map((x: number) => x.toFixed(3)).join("/")}`,
                    Object.keys(r.unsupported).length ? JSON.stringify(r.unsupported) : "",
                );
        } catch (e) {
            console.log(meta.id.padEnd(48), "ERROR", e instanceof Error ? e.stack : e);
            cases[meta.id] = { error: e instanceof Error ? e.message : String(e) };
        }
    }
}
console.log(`\n${n} cases: ${exact} exact, ${good} with F1(r=1) ≥ 0.99`);
for (const ps of Object.values(perSuite)) ps.f1 = ps.cases ? ps.f1 / ps.cases : 0;
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ n, exact, good, perSuite, cases }, null, 1));
