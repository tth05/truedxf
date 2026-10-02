import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

export function resolveBenchPaths(): Map<string, string> {
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
