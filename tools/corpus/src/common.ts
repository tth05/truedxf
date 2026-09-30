import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const EXTERNAL = join(ROOT, "samples", "external");
export const REPORTS = join(ROOT, "samples", "reports");

export interface ManifestRecord {
  path: string;
  source: string;
  origin: string;
  sha256: string;
  size: number;
  format?: "ascii-dxf" | "binary-dxf" | "dwg";
  acadver?: string;
  version?: string;
  producer?: string | null;
  license?: string;
  entities?: Record<string, number>;
}

export function loadManifest(): ManifestRecord[] {
  const file = join(EXTERNAL, "manifest.jsonl");
  if (!existsSync(file)) {
    console.error(`no corpus manifest at ${file} (see samples/README.md)`);
    return [];
  }
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ManifestRecord);
}

export interface CliArgs {
  filter?: RegExp;
  limit?: number;
  out?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--filter") args.filter = new RegExp(argv[++i]!, "i");
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i]!;
  }
  return args;
}

export function selectDxf(records: ManifestRecord[], args: CliArgs): ManifestRecord[] {
  let sel = records.filter((r) => r.format === "ascii-dxf" || r.format === "binary-dxf");
  if (args.filter) sel = sel.filter((r) => args.filter!.test(r.path));
  if (args.limit) sel = sel.slice(0, args.limit);
  return sel;
}
