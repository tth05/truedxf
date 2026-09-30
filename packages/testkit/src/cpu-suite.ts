/**
 * Scores whole suites with the CPU rasterizer (no browser; fast triage between visual runs):
 *   node packages/testkit/src/cpu-suite.ts <suite>[/<case>] … [--out <dir>] [--quiet]
 * Images are resolved like the harness (IMAGEDEF path, then next to the fixture).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadDxf } from "@truedxf/model";
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
const targets: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") out = resolve(args[++i]!);
  else if (args[i] === "--quiet") quiet = true;
  else targets.push(args[i]!);
}
let n = 0;
let exact = 0;
let good = 0;
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
      const r = await renderPlot(doc, meta.plot, { loadImage: nodeImageLoader(dir) });
      const img = rasterize(r.displayList, r.view, meta.plot.canvas);
      const ref = readPng(refPng);
      const m = compare(img, ref);
      n++;
      if (m.exactMismatch === 0) exact++;
      if (m.f1[1] >= 0.99) good++;
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
    }
  }
}
console.log(`\n${n} cases: ${exact} exact, ${good} with F1(r=1) ≥ 0.99`);
