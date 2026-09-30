/**
 * Tokenizes every DXF of the external corpus with @truedxf/core and checks a by-value round trip
 * (tokenize → write tags by value → tokenize → compare). Writes samples/reports/core-tags.json.
 *
 *   node tools/corpus/src/parse-tags.ts [--filter regex] [--limit n]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AsciiTagWriter, BinaryTagWriter, Diagnostics, readTags, tokenize, writeStore } from "@truedxf/core";
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
  roundTrip: "ok" | string;
  error?: string;
}

function roundTrip(bytes: Uint8Array): string {
  const { store } = readTags(bytes);
  const binary = store.format === "binary";
  const w = binary
    ? new BinaryTagWriter(store.binaryCodeSize === 1 ? 1 : 2)
    : new AsciiTagWriter({ encoding: "utf-8" });
  writeStore(store, w);
  const again = tokenize(w.toBytes(), { diagnostics: new Diagnostics() });
  again.encoding = "utf-8";
  if (again.count !== store.count) return `tag count ${store.count} → ${again.count}`;
  for (let i = 0; i < store.count; i++) {
    if (store.code(i) !== again.code(i)) return `code mismatch at tag ${i}`;
    const a = store.value(i);
    const b = again.value(i);
    if (a instanceof Uint8Array && b instanceof Uint8Array) {
      if (a.length !== b.length || a.some((x, k) => x !== b[k])) return `binary mismatch at tag ${i}`;
    } else if (typeof a === "number" && typeof b === "number") {
      if (!(Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b)) || (a === 0 && b === 0))) {
        return `number mismatch at tag ${i} (code ${store.code(i)}): ${a} vs ${b}`;
      }
    } else if (a !== b) {
      return `value mismatch at tag ${i} (code ${store.code(i)}): ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
    }
  }
  return "ok";
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
      roundTrip: "skipped",
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
      r.roundTrip = roundTrip(bytes);
    } catch (e) {
      r.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    results.push(r);
  }
  const wall = performance.now() - t0;
  const errors = results.filter((r) => r.error);
  const rtFail = results.filter((r) => !r.error && r.roundTrip !== "ok");
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
    roundTripFailures: rtFail.length,
    filesWithDiagnostic: diagTotals,
    encodings: count(results.map((r) => `${r.encoding} (${r.reason})`)),
  };
  mkdirSync(REPORTS, { recursive: true });
  const out = args.out ?? join(REPORTS, "core-tags.json");
  writeFileSync(out, JSON.stringify({ summary, results }, null, 1));
  console.log(JSON.stringify(summary, null, 2));
  for (const r of errors.slice(0, 20)) console.log(`EXC ${r.path}: ${r.error}`);
  for (const r of rtFail.slice(0, 20)) console.log(`RT  ${r.path}: ${r.roundTrip}`);
}

function count(xs: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}

main();
