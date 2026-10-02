/**
 * Pipeline benchmark over a fixed set of large, varied corpus files: the viewer worker's work
 * (tokenize → model → renderPlot → pick data) in Node, per stage, median of `--runs`.
 *
 *   node tools/corpus/src/bench.ts [--runs 3] [--only <regex>] [--zoom] [--by-type] [--json out.json]
 *
 * `--by-type`: exclusive frontend time and emitted vertices per entity type (all render passes).
 *
 * Profile one file: node --cpu-prof --cpu-prof-dir=samples/reports/prof tools/corpus/src/bench.ts --only Network
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTags } from "@truedxf/core";
import { DxfDocument } from "@truedxf/model";
import { DisplayListBuilder, Frontend, transferables } from "@truedxf/render";
import { type RenderParams, ViewerCore } from "../../../packages/viewer/src/protocol.ts";
import { EXTERNAL, ROOT } from "./common.ts";

const BENCH_DIR = join(ROOT, "samples", "bench");

/**
 * name → unique path substring of a manifest path (several names are non-ASCII), or
 * `bench/<file>` under samples/bench (generated locally, e.g. binary conversions with ezdxf).
 */
export const BENCH_SET: Record<string, string> = {
  "arch-cn-114": "20240514V1.05.dxf",
  "huge-blocks-187": "issue-833/10739673_test_extracted",
  "circles-117": "LC_Tests_1_extracted/circles_large.dxf",
  "splines-82": "spline_points_large.dxf",
  "proxy-hatch-77": "issue-847/10978953_acad_proxy_entity_example_extracted",
  "mtext-elec-35": "Elektrik Projeler.dxf",
  "dims-rumah-34": "DesignRumah.dxf",
  "hatch-gdal-31": "zhangmabeng1.dxf",
  "r13-polyline-24": "kb-674.dxf",
  "viewports-24": "problematic_viewports.dxf",
  "dense-hatch-21": "issue-574/7495047_test_extracted/test.dxf",
  "attribs-21": "0909_021.dxf",
  "r12-network-16": "Network.dxf",
  "mpolygon-italy-26": "Italy.dxf",
  "3dface-civil-13": "Civil Drawings AutoCAD2000.dxf",
  "binary-1": "sample_AC1015_binary.dxf",
  // ezdxf recover + saveas(fmt="bin") of zhangmabeng1.dxf (the corpus has no large binary DXF)
  "binary-gdal-17": "bench/hatch-gdal-binary.dxf",
};

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
    byType: false,
    json: undefined as string | undefined,
  };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "--runs") a.runs = Number(v[++i]);
    else if (v[i] === "--only") a.only = new RegExp(v[++i]!, "i");
    else if (v[i] === "--zoom") a.zoom = true;
    else if (v[i] === "--by-type") a.byType = true;
    else if (v[i] === "--json") a.json = v[++i];
  }
  return a;
}

function resolvePaths(): Map<string, string> {
  const out = new Map<string, string>();
  const manifest = join(EXTERNAL, "manifest.jsonl");
  if (!existsSync(manifest)) return out;
  const paths = readFileSync(manifest, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => (JSON.parse(l) as { path: string }).path);
  for (const [name, sub] of Object.entries(BENCH_SET)) {
    if (sub.startsWith("bench/")) {
      const f = join(BENCH_DIR, sub.slice(6));
      if (existsSync(f)) out.set(name, f);
      continue;
    }
    const hit = paths.find((p) => p.includes(sub));
    if (hit) out.set(name, join(EXTERNAL, hit));
  }
  return out;
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
const files = resolvePaths();
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
    pick: [] as number[],
    zoom: [] as number[],
  };
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
      // fresh core per run: no font/glyph caches carried over (the viewer loads a file once)
      const core = new ViewerCore(loadFont, loadImage);
      const doc = core.load(bytes, name);
      const res = await core.render({ ...BASE, layout: doc.activeLayout, area: { type: "extents" } });
      t.render.push(res.ms.frontend);
      t.pick.push(res.ms.pick);
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
    pickMs: t.pick.length ? Math.round(median(t.pick)) : undefined,
    zoomMs: t.zoom.length ? Math.round(median(t.zoom)) : undefined,
    ...info,
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
