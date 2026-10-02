/**
 * Tokenizes every DXF of the external corpus with @truedxf/core and decodes every value (decode
 * cost, encoding fallbacks, diagnostics). Writes samples/reports/core-tags.json.
 *
 *   node tools/corpus/src/parse-tags.ts [--filter regex] [--limit n]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTags } from "@truedxf/core";
import { EXTERNAL, loadManifest, parseArgs, REPORTS, selectDxf } from "./common.ts";

interface FileResult {
  path: string;
  bytes: number;
  ms: number;
  tags: number;
  sections: string[];
  encoding: string;
  reason: string;
  diagnostics: Record<string, number>;
  fallbackDecodes: number;
  error?: string;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const files = selectDxf(loadManifest(), args);
  const results: FileResult[] = [];
  let totalBytes = 0;
  let totalMs = 0;
  const t0 = performance.now();
  for (const rec of files) {
    const bytes = new Uint8Array(readFileSync(join(EXTERNAL, rec.path)));
    const r: FileResult = {
      path: rec.path,
      bytes: bytes.length,
      ms: 0,
      tags: 0,
      sections: [],
      encoding: "",
      reason: "",
      diagnostics: {},
      fallbackDecodes: 0,
    };
    try {
      const start = performance.now();
      const { store, sections, encoding, diagnostics } = readTags(bytes);
      // force decoding of every string to measure decode cost and fallback counts
      for (let i = 0; i < store.count; i++) store.value(i);
      r.ms = performance.now() - start;
      r.tags = store.count;
      r.sections = sections.map((s) => s.name);
      r.encoding = encoding.encoding;
      r.reason = encoding.reason;
      r.diagnostics = diagnostics.summary();
      r.fallbackDecodes = store.fallbackDecodes;
      totalBytes += bytes.length;
      totalMs += r.ms;
    } catch (e) {
      r.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    results.push(r);
  }
  const wall = performance.now() - t0;
  const errors = results.filter((r) => r.error);
  const diagTotals: Record<string, number> = {};
  for (const r of results)
    for (const [k, v] of Object.entries(r.diagnostics))
      diagTotals[k] = (diagTotals[k] ?? 0) + (v > 0 ? 1 : 0);
  const summary = {
    files: results.length,
    megabytes: +(totalBytes / 1e6).toFixed(1),
    parseSeconds: +(totalMs / 1000).toFixed(2),
    mbPerSecond: +(totalBytes / 1e6 / (totalMs / 1000)).toFixed(1),
    wallSeconds: +(wall / 1000).toFixed(1),
    exceptions: errors.length,
    filesWithDiagnostic: diagTotals,
    encodings: count(results.map((r) => `${r.encoding} (${r.reason})`)),
  };
  mkdirSync(REPORTS, { recursive: true });
  const out = args.out ?? join(REPORTS, "core-tags.json");
  writeFileSync(out, JSON.stringify({ summary, results }, null, 1));
  console.log(JSON.stringify(summary, null, 2));
  for (const r of errors.slice(0, 20)) console.log(`EXC ${r.path}: ${r.error}`);
}

function count(xs: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}

main();
