/**
 * Parameter sweeps against AutoCAD references with the CPU rasterizer (no browser):
 *   node packages/testkit/src/experiment.ts <suite/case> '<json calibration override>' …
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadDxf } from "@truedxf/model";
import { renderPlot } from "@truedxf/render";
import { rasterize } from "./cpu-raster.ts";
import { compare } from "./metrics.ts";
import { readPng } from "./png.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const [id, ...variants] = process.argv.slice(2);
const [suite, name] = id!.split("/");
const base = join(ROOT, "samples", "generated", suite!, name!);
const meta = JSON.parse(readFileSync(`${base}.json`, "utf8"));
const doc = loadDxf(new Uint8Array(readFileSync(`${base}.dxf`)));
const ref = readPng(join(ROOT, "samples", "refs", "acad2027-R26.0", suite!, `${name}.png`));
for (const v of variants.length ? variants : ["{}"]) {
    const calibration = JSON.parse(v);
    const r = await renderPlot(doc, meta.plot, { calibration });
    const img = rasterize(r.displayList, r.view, meta.plot.canvas);
    const m = compare(img, ref);
    console.log(
        v.padEnd(30),
        `exact=${m.exactMismatch}`,
        `f1=${m.f1.map((x) => x.toFixed(4)).join("/")}`,
        `ink ${m.inkA}/${m.inkB}`,
    );
}
