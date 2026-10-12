/**
 * Visual regression runner: renders generated fixtures with the real three.js renderer in
 * headless Chromium (SwiftShader, no antialiasing) and compares them with AutoCAD references.
 *
 *   node packages/testkit/src/visual.ts [--suite s]… [--case suite/case]… [--refs <dir>]
 *        [--out <dir>] [--repeat 2] [--no-build] [--draw-raster]
 *
 * IMAGE / WIPEOUT are omitted like accoreconsole does (note 07 §8.4) unless --draw-raster.
 *
 * Outputs to samples/out/visual/: <suite>/<case>.png (ours), <case>.diff.png, results.json,
 * report.html. See docs/fixtures.md for the fixture/reference layout.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { findImageFile } from "./image-files.ts";
import { compare, diffImage, type Metrics } from "./metrics.ts";
import { decodePng, readPng, writePng } from "./png.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const ROOT = resolve(PKG, "../..");
const GENERATED = join(ROOT, "samples", "generated");
const REFS = join(ROOT, "samples", "refs");
const DIST = join(PKG, ".harness-dist");

/** Font search path for the harness server (local files; nothing here is committed). */
const FONT_DIRS = [
    join(ROOT, "packages", "fonts", "assets"),
    "C:\\Windows\\Fonts",
    "C:\\Program Files\\Autodesk\\AutoCAD 2027\\Fonts",
];

interface Args {
    suites: string[];
    cases: string[];
    refs?: string;
    out: string;
    repeat: number;
    build: boolean;
    /** Regex of fonts to treat as unavailable (mirrors fonts AutoCAD could not see). */
    hideFonts?: string;
    /** Draw IMAGE / WIPEOUT (accoreconsole references never show them). */
    drawRaster: boolean;
    /** Per-case time limit in seconds; the page is recreated after a timeout or crash. */
    timeout: number;
}

function parseArgs(argv: string[]): Args {
    const a: Args = {
        suites: [],
        cases: [],
        out: join(ROOT, "samples", "out", "visual"),
        repeat: 1,
        build: true,
        drawRaster: false,
        timeout: 120,
    };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if (k === "--suite") a.suites.push(argv[++i]!);
        else if (k === "--case") a.cases.push(argv[++i]!);
        else if (k === "--refs") a.refs = argv[++i]!;
        else if (k === "--out") a.out = resolve(argv[++i]!);
        else if (k === "--repeat") a.repeat = Number(argv[++i]);
        else if (k === "--no-build") a.build = false;
        else if (k === "--hide-fonts") a.hideFonts = argv[++i]!;
        else if (k === "--draw-raster") a.drawRaster = true;
        else if (k === "--timeout") a.timeout = Number(argv[++i]);
    }
    return a;
}

export interface CaseMeta {
    id: string;
    suite: string;
    title?: string;
    tags?: string[];
    plot: {
        layout: string;
        area:
            | { type: "window"; min: [number, number]; max: [number, number] }
            | { type: "extents" }
            | { type: "layout" };
        canvas: [number, number];
        styleTable?: string;
        lineweights?: boolean;
        scale?: "fit" | [number, number];
        sysvars?: Record<string, number | string>;
    };
}

function listCases(args: Args): { meta: CaseMeta; dxf: string }[] {
    if (!existsSync(GENERATED)) return [];
    const out: { meta: CaseMeta; dxf: string }[] = [];
    for (const suite of readdirSync(GENERATED).sort()) {
        if (args.suites.length && !args.suites.includes(suite)) continue;
        const dir = join(GENERATED, suite);
        if (!statSync(dir).isDirectory()) continue;
        for (const f of readdirSync(dir).sort()) {
            if (!f.endsWith(".json")) continue;
            const meta = JSON.parse(readFileSync(join(dir, f), "utf8")) as CaseMeta;
            if (args.cases.length && !args.cases.includes(meta.id)) continue;
            const dxf = join(dir, f.replace(/\.json$/, ".dxf"));
            if (existsSync(dxf)) out.push({ meta, dxf });
        }
    }
    return out;
}

function latestRefs(): string | undefined {
    if (!existsSync(REFS)) return undefined;
    const dirs = readdirSync(REFS)
        .map((d) => join(REFS, d))
        .filter((d) => statSync(d).isDirectory())
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return dirs[0];
}

const MIME: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".map": "application/json",
    ".css": "text/css",
};

function serve(): Promise<{ server: Server; url: string }> {
    const server = createServer((req, res) => {
        const url = decodeURIComponent((req.url ?? "/").split("?")[0]!);
        if (url.startsWith("/images/")) {
            // /images/<suite>/<IMAGEDEF path>: resolved like AutoCAD relative to the fixture folder
            const rest = url.slice(8);
            const cut = rest.indexOf("/");
            const suite = rest.slice(0, cut);
            const hit = /^[a-z0-9-]+$/.test(suite)
                ? findImageFile(rest.slice(cut + 1), join(GENERATED, suite))
                : undefined;
            if (!hit) {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, { "content-type": "application/octet-stream" });
            res.end(readFileSync(hit));
            return;
        }
        if (url.startsWith("/fonts/")) {
            const name = url.slice(7);
            for (const d of FONT_DIRS) {
                if (!existsSync(d)) continue;
                const hit = readdirSync(d).find((f) => f.toLowerCase() === name.toLowerCase());
                if (hit) {
                    res.writeHead(200, { "content-type": "application/octet-stream" });
                    res.end(readFileSync(join(d, hit)));
                    return;
                }
            }
            res.writeHead(404).end();
            return;
        }
        const file = join(DIST, url === "/" ? "index.html" : url);
        if (!file.startsWith(DIST) || !existsSync(file)) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(readFileSync(file));
    });
    return new Promise((ok) =>
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            const port = typeof addr === "object" && addr ? addr.port : 0;
            ok({ server, url: `http://127.0.0.1:${port}/` });
        }),
    );
}

interface HarnessWindow {
    truedxf: {
        render(
            dxf: string,
            plot: CaseMeta["plot"],
            options?: { hideFonts?: string; suite?: string; drawRaster?: boolean },
        ): Promise<{ png: string; ms: unknown; batches: number }>;
    };
}

interface CaseResult {
    id: string;
    status: "ok" | "no-reference" | "error";
    error?: string;
    metrics?: Metrics;
    deterministic?: boolean;
    ms?: unknown;
    batches?: number;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const cases = listCases(args);
    if (cases.length === 0) {
        console.log("no cases found under samples/generated");
        return;
    }
    if (args.build) {
        const { build } = await import("vite");
        await build({ configFile: join(PKG, "vite.config.ts") });
    }
    const refs = args.refs ? resolve(args.refs) : latestRefs();
    const { server, url } = await serve();
    const browser = await chromium.launch({
        headless: true,
        args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    });
    // A case that crashes the renderer process or never finishes must not stall the whole run:
    // every case races a timeout, and the page is replaced after a crash / timeout.
    const openPage = async () => {
        const p = await browser.newPage({ deviceScaleFactor: 1 });
        p.on("pageerror", (e) => console.error("page error:", e.message));
        await p.goto(url);
        await p.waitForFunction(() => document.title === "ready");
        return p;
    };
    let page = await openPage();
    let crashed = false;
    const watchCrash = () => page.on("crash", () => (crashed = true));
    watchCrash();
    mkdirSync(args.out, { recursive: true });
    const results: CaseResult[] = [];
    for (const { meta, dxf } of cases) {
        const r: CaseResult = { id: meta.id, status: "ok" };
        try {
            const b64 = readFileSync(dxf).toString("base64");
            const pngs: string[] = [];
            for (let k = 0; k < Math.max(1, args.repeat); k++) {
                const evaluation = page.evaluate(
                    ([d, p, o]) => (window as unknown as HarnessWindow).truedxf.render(d, p, o),
                    [
                        b64,
                        // the harness prologue sets PLOTTRANSPARENCYOVERRIDE 0 unless the case overrides it
                        { ...meta.plot, sysvars: { PLOTTRANSPARENCYOVERRIDE: 0, ...meta.plot.sysvars } },
                        { hideFonts: args.hideFonts, suite: meta.suite, drawRaster: args.drawRaster },
                    ] as const,
                );
                let timer: ReturnType<typeof setTimeout> | undefined;
                const limit = new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`timeout after ${args.timeout}s`)),
                        args.timeout * 1000,
                    );
                });
                const res = await Promise.race([evaluation, limit]).finally(() => clearTimeout(timer));
                pngs.push(res.png);
                r.ms = res.ms;
                r.batches = res.batches;
            }
            if (pngs.length > 1) r.deterministic = pngs.every((p) => p === pngs[0]);
            const ours = decodePng(new Uint8Array(Buffer.from(pngs[0]!, "base64")));
            const outDir = join(args.out, meta.suite);
            mkdirSync(outDir, { recursive: true });
            const base = join(outDir, meta.id.split("/")[1]!);
            writePng(`${base}.png`, ours);
            const refPng = refs ? join(refs, `${meta.id}.png`) : undefined;
            if (refPng && existsSync(refPng)) {
                const ref = readPng(refPng);
                r.metrics = compare(ours, ref);
                writePng(`${base}.diff.png`, diffImage(ours, ref));
            } else {
                r.status = "no-reference";
            }
        } catch (e) {
            r.status = "error";
            r.error = e instanceof Error ? e.message : String(e);
            if (crashed || /timeout|crash|closed|Target/i.test(r.error)) {
                await page.close().catch(() => {});
                page = await openPage();
                crashed = false;
                watchCrash();
            }
        }
        results.push(r);
        const m = r.metrics;
        console.log(
            `${r.status.padEnd(12)} ${meta.id.padEnd(48)} ${m ? `exact=${m.exactMismatch} f1=${m.f1.map((x) => x.toFixed(3)).join("/")}` : (r.error ?? "")}`,
        );
    }
    await browser.close();
    server.close();
    writeFileSync(join(args.out, "results.json"), JSON.stringify({ refs, results }, null, 1));
    writeFileSync(join(args.out, "report.html"), report(results, refs, args.out));
    const scored = results.filter((r) => r.metrics);
    const exact = scored.filter((r) => r.metrics!.exactMismatch === 0).length;
    const f1ok = scored.filter((r) => r.metrics!.f1[1] >= 0.99).length;
    console.log(
        `\n${results.length} cases, ${scored.length} with references: ${exact} exact, ${f1ok} with F1(r=1) ≥ 0.99`,
    );
}

function report(results: CaseResult[], refs: string | undefined, out: string): string {
    const rows = results
        .map((r) => {
            const [suite, name] = r.id.split("/");
            const m = r.metrics;
            const img = (p: string) => `<img loading="lazy" src="${p}" />`;
            const refImg = refs ? `file:///${join(refs, `${r.id}.png`).replaceAll("\\", "/")}` : "";
            return `<tr><td>${r.id}<br/>${r.status}${r.error ? `<br/>${r.error}` : ""}</td>
<td>${m ? `exact ${m.exactMismatch}<br/>F1 ${m.f1.map((x) => x.toFixed(3)).join(" / ")}<br/>ink ${m.inkA} / ${m.inkB}` : ""}</td>
<td>${img(`${suite}/${name}.png`)}</td><td>${refs ? img(refImg) : ""}</td><td>${m ? img(`${suite}/${name}.diff.png`) : ""}</td></tr>`;
        })
        .join("\n");
    return `<!doctype html><meta charset="utf-8"><title>truedxf visual report</title>
<style>body{font:13px sans-serif} img{width:400px;border:1px solid #ccc} td{vertical-align:top;padding:4px}</style>
<p>refs: ${refs ?? "none"} · output: ${out}</p>
<p>Diff colours: red = only AutoCAD, blue = only truedxf, light grey = identical, dark grey = colour differs.</p>
<table><tr><th>case</th><th>metrics</th><th>truedxf</th><th>AutoCAD</th><th>diff</th></tr>${rows}</table>`;
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
