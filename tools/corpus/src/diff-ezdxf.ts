/**
 * Differential oracle: compares truedxf's normalized dump
 * (dump.ts) with ezdxf's (../ezdxf_dump.py) for every corpus DXF, classifies the disagreements
 * (diff-classes.ts) and writes samples/reports/diff-ezdxf.json + diff-ezdxf.md.
 *
 *   node tools/corpus/src/diff-ezdxf.ts [--filter re] [--limit n] [--sample n] [--jobs n]
 *        [--timeout s] [--max-mb n] [--refresh] [--python path] [--examples n]
 *
 * ezdxf dumps are cached under samples/reports/ezdxf-cache/<script hash>/<sha256>.json.gz, so
 * only the first run (or a changed ezdxf_dump.py) pays for ezdxf. Python runs as N parallel
 * `ezdxf_dump.py --serve` workers; a worker exceeding the timeout is killed and restarted.
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { gunzipSync, gzipSync } from "node:zlib";
import { decodeUnicodeEscapes } from "@truedxf/core";
import { DxfDocument } from "@truedxf/model";
import { EXTERNAL, loadManifest, type ManifestRecord, REPORTS, ROOT, selectDxf } from "./common.ts";
import { type Classification, classify } from "./diff-classes.ts";
import { dumpDocument, type Json, type JsonObject } from "./dump.ts";

interface Args {
  filter?: RegExp;
  limit?: number;
  sample?: number;
  jobs: number;
  timeout: number;
  maxMb: number;
  refresh: boolean;
  python: string;
  examples: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    jobs: Math.max(1, Math.min(8, availableParallelism() - 2)),
    timeout: 300,
    maxMb: 40,
    refresh: false,
    python: join(ROOT, "tools/gen/.venv/Scripts/python.exe"),
    examples: 6,
  };
  if (!existsSync(a.python)) a.python = join(ROOT, "tools/gen/.venv/bin/python");
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = () => argv[++i]!;
    if (k === "--filter") a.filter = new RegExp(v(), "i");
    else if (k === "--limit") a.limit = Number(v());
    else if (k === "--sample") a.sample = Number(v());
    else if (k === "--jobs") a.jobs = Number(v());
    else if (k === "--timeout") a.timeout = Number(v());
    else if (k === "--max-mb") a.maxMb = Number(v());
    else if (k === "--refresh") a.refresh = true;
    else if (k === "--python") a.python = v();
    else if (k === "--examples") a.examples = Number(v());
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

// ---- ezdxf worker pool ------------------------------------------------------------------------

const SCRIPT = join(ROOT, "tools/corpus/ezdxf_dump.py");

interface Task {
  src: string;
  out: string;
}

async function runEzdxf(tasks: Task[], args: Args): Promise<void> {
  if (tasks.length === 0) return;
  let next = 0;
  let done = 0;
  const t0 = performance.now();
  const progress = () => {
    if (done % 50 === 0 || done === tasks.length)
      console.error(`ezdxf ${done}/${tasks.length} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  };
  await new Promise<void>((resolveAll) => {
    let active = 0;
    const startWorker = () => {
      if (next >= tasks.length) {
        if (active === 0) resolveAll();
        return;
      }
      active++;
      const proc: ChildProcessWithoutNullStreams = spawn(args.python, [SCRIPT, "--serve"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      });
      proc.stderr.on("data", () => {}); // ezdxf warnings
      let current: Task | undefined;
      let timer: NodeJS.Timeout | undefined;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        active--;
        startWorker();
      };
      const feed = () => {
        if (next >= tasks.length) {
          current = undefined;
          proc.stdin.end();
          return;
        }
        current = tasks[next++]!;
        timer = setTimeout(() => {
          const t = current!;
          writeGz(t.out, { ok: false, error: `timeout after ${args.timeout} s` });
          done++;
          progress();
          current = undefined;
          proc.kill();
        }, args.timeout * 1000);
        proc.stdin.write(`${current.src}\t${current.out}\n`);
      };
      createInterface({ input: proc.stdout }).on("line", (line) => {
        if (!current) return;
        clearTimeout(timer);
        if (line.startsWith("ERR")) writeGz(current.out, { ok: false, error: line.split("\t")[2] ?? line });
        done++;
        progress();
        feed();
      });
      proc.on("exit", () => {
        clearTimeout(timer);
        if (current) {
          // crashed while processing (e.g. out of memory)
          writeGz(current.out, { ok: false, error: "ezdxf worker crashed" });
          done++;
          progress();
        }
        finish();
      });
      feed();
    };
    for (let i = 0; i < Math.min(args.jobs, tasks.length); i++) startWorker();
  });
}

function writeGz(file: string, value: unknown): void {
  writeFileSync(file, gzipSync(JSON.stringify(value)));
}

// ---- comparison ---------------------------------------------------------------------------------

interface Example {
  file: string;
  path: string;
  truedxf: Json | undefined;
  ezdxf: Json | undefined;
}

interface Pattern {
  key: string;
  count: number;
  files: Set<string>;
  values: Map<string, number>;
  examples: Example[];
}

class Comparison {
  compared = 0;
  disagreements = 0;
  readonly patterns = new Map<string, Pattern>();
  file = "";
  fileCompared = 0;
  fileDisagreements = 0;
  readonly maxExamples: number;
  constructor(maxExamples: number) {
    this.maxExamples = maxExamples;
  }

  ok(): void {
    this.compared++;
    this.fileCompared++;
  }

  bad(key: string, path: string, ts: Json | undefined, ez: Json | undefined): void {
    this.compared++;
    this.fileCompared++;
    this.disagreements++;
    this.fileDisagreements++;
    let p = this.patterns.get(key);
    if (!p)
      this.patterns.set(key, (p = { key, count: 0, files: new Set(), values: new Map(), examples: [] }));
    p.count++;
    p.files.add(this.file);
    const vk = `${short(ts)} | ${short(ez)}`;
    const newValue = !p.values.has(vk);
    if (p.values.size < 200 || !newValue) p.values.set(vk, (p.values.get(vk) ?? 0) + 1);
    // examples: distinct files first, plus one per new value pair (for triage)
    const newFile = !p.examples.some((e) => e.file === this.file);
    if (
      (newFile && p.examples.length < this.maxExamples) ||
      (newValue && p.examples.length < 3 * this.maxExamples)
    )
      p.examples.push({ file: this.file, path, truedxf: clip(ts), ezdxf: clip(ez) });
  }
}

function short(v: Json | undefined): string {
  if (v === undefined) return "<absent>";
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

function clip(v: Json | undefined): Json | undefined {
  if (v === undefined) return undefined;
  const s = JSON.stringify(v);
  return s.length > 400 ? `${s.slice(0, 397)}...` : v;
}

const REL = 1e-9;

function numEq(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= REL * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Leaf equality (primitives and arrays of primitives / points). */
function leafEq(a: Json, b: Json): boolean {
  if (typeof a === "number" && typeof b === "number") return numEq(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!leafEq(a[i]!, b[i]!)) return false;
    return true;
  }
  if (typeof a === "boolean" && typeof b === "number") return (a ? 1 : 0) === b;
  if (typeof b === "boolean" && typeof a === "number") return (b ? 1 : 0) === a;
  return a === b;
}

function isObjList(v: Json | undefined): v is JsonObject[] {
  return (
    Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null && !Array.isArray(v[0])
  );
}

function compareObject(c: Comparison, prefix: string, path: string, ts: JsonObject, ez: JsonObject): void {
  const keys = new Set([...Object.keys(ts), ...Object.keys(ez)]);
  for (const k of keys) {
    if (k === "t" || k === "h") continue;
    const a = ts[k];
    const b = ez[k];
    const key = `${prefix}.${k}`;
    const p = `${path}.${k}`;
    if (isObjList(a) || isObjList(b)) {
      compareList(
        c,
        `${key}[]`,
        p,
        (a as JsonObject[] | undefined) ?? [],
        (b as JsonObject[] | undefined) ?? [],
      );
      continue;
    }
    if (a === undefined || b === undefined) c.bad(`${key} (absent)`, p, a, b);
    else if (leafEq(a, b)) c.ok();
    else c.bad(`${key}${textKind(a, b)}`, p, a, b);
  }
}

const NON_ASCII = /[^ -~\t\r\n]/; // beyond printable ASCII
const ESCAPES = /\\[UM]\+/i;

/**
 * Sub-pattern for string differences that are text decoding, not parsing: ezdxf keeps `\U+XXXX`
 * / `\M+` escapes in names, or decoded with another code page (mojibake).
 */
function textKind(a: Json, b: Json): string {
  if (typeof a !== "string" || typeof b !== "string") return "";
  if (ESCAPES.test(b) && (decodeUnicodeEscapes(b) === a || NON_ASCII.test(a))) return " [escapes]";
  if (NON_ASCII.test(a) || NON_ASCII.test(b)) return " [codepage]";
  return "";
}

/** Sub-pattern for items missing on one side because their key is encoded differently. */
function nameKind(name: string): string {
  return ESCAPES.test(name) || NON_ASCII.test(name) ? " [encoded name]" : "";
}

function typeOf(o: JsonObject): string {
  return typeof o.t === "string" ? o.t : "";
}

/** Pairs two entity lists: by index when the type sequences match, else by handle, then by type order. */
function align(ts: JsonObject[], ez: JsonObject[]): [JsonObject | undefined, JsonObject | undefined][] {
  if (ts.length === ez.length && ts.every((e, i) => typeOf(e) === typeOf(ez[i]!)))
    return ts.map((e, i) => [e, ez[i]]);
  const pairs: [JsonObject | undefined, JsonObject | undefined][] = [];
  const byHandle = new Map<string, number>();
  ez.forEach((e, i) => {
    if (typeof e.h === "string" && !byHandle.has(e.h)) byHandle.set(e.h, i);
  });
  const usedEz = new Set<number>();
  const pending: JsonObject[] = [];
  for (const e of ts) {
    const j = typeof e.h === "string" ? byHandle.get(e.h) : undefined;
    if (j !== undefined && !usedEz.has(j) && typeOf(ez[j]!) === typeOf(e)) {
      usedEz.add(j);
      pairs.push([e, ez[j]]);
    } else pending.push(e);
  }
  const rest = new Map<string, number[]>();
  ez.forEach((e, i) => {
    if (usedEz.has(i)) return;
    const l = rest.get(typeOf(e));
    if (l) l.push(i);
    else rest.set(typeOf(e), [i]);
  });
  for (const e of pending) {
    const l = rest.get(typeOf(e));
    const j = l?.shift();
    if (j === undefined) pairs.push([e, undefined]);
    else {
      usedEz.add(j);
      pairs.push([e, ez[j]]);
    }
  }
  ez.forEach((e, i) => {
    if (!usedEz.has(i)) pairs.push([undefined, e]);
  });
  return pairs;
}

function compareList(c: Comparison, prefix: string, path: string, ts: JsonObject[], ez: JsonObject[]): void {
  const pairs = align(ts, ez);
  pairs.forEach(([a, b], i) => {
    const type = typeOf(a ?? b ?? {});
    const key = type ? `${prefix} ${type}` : prefix;
    const p = `${path}[${i}]${a?.h ? `#${a.h}` : b?.h ? `#${b.h}` : ""}`;
    if (!a) c.bad(`${key} missing in truedxf`, p, undefined, b!.t ?? "item");
    else if (!b) c.bad(`${key} missing in ezdxf`, p, a.t ?? "item", undefined);
    else compareObject(c, key, p, a, b);
  });
}

function compareMap(c: Comparison, prefix: string, ts: JsonObject, ez: JsonObject, sub?: string): void {
  const keys = new Set([...Object.keys(ts), ...Object.keys(ez)]);
  for (const k of keys) {
    const a = ts[k] as JsonObject | undefined;
    const b = ez[k] as JsonObject | undefined;
    if (!a) c.bad(`${prefix} missing in truedxf${nameKind(k)}`, `${prefix}[${k}]`, undefined, k);
    else if (!b) c.bad(`${prefix} missing in ezdxf${nameKind(k)}`, `${prefix}[${k}]`, k, undefined);
    else if (sub) compareObject(c, prefix, `${prefix}[${k}]`, a, b);
  }
}

function compareDocs(c: Comparison, ts: JsonObject, ez: JsonObject): void {
  // header: only variables present on both sides count (ezdxf fills in some defaults)
  const th = ts.header as JsonObject;
  const eh = ez.header as JsonObject;
  for (const k of Object.keys(th)) {
    if (!(k in eh)) {
      c.bad(`header ${k} missing in ezdxf`, `header.${k}`, th[k], undefined);
      continue;
    }
    if (leafEq(th[k]!, eh[k]!)) c.ok();
    else c.bad(`header ${k}`, `header.${k}`, th[k], eh[k]);
  }
  const tt = ts.tables as JsonObject;
  const et = ez.tables as JsonObject;
  for (const t of ["layers", "linetypes", "styles"])
    compareMap(c, `table ${t}`, tt[t] as JsonObject, et[t] as JsonObject, t);
  const tb = new Set(tt.blockRecords as string[]);
  const eb = new Set(et.blockRecords as string[]);
  for (const n of new Set([...tb, ...eb])) {
    if (tb.has(n) && eb.has(n)) c.ok();
    else
      c.bad(
        `table blockRecords missing in ${tb.has(n) ? "ezdxf" : "truedxf"}${nameKind(n)}`,
        `blockRecords[${n}]`,
        tb.has(n) ? n : undefined,
        eb.has(n) ? n : undefined,
      );
  }
  compareMap(c, "layout", ts.layouts as JsonObject, ez.layouts as JsonObject, "layout");
  const tbl = ts.blocks as JsonObject;
  const ebl = ez.blocks as JsonObject;
  for (const k of new Set([...Object.keys(tbl), ...Object.keys(ebl)])) {
    const a = tbl[k] as JsonObject | undefined;
    const b = ebl[k] as JsonObject | undefined;
    if (!a) c.bad(`block missing in truedxf${nameKind(k)}`, `blocks[${k}]`, undefined, k);
    else if (!b) c.bad(`block missing in ezdxf${nameKind(k)}`, `blocks[${k}]`, k, undefined);
    else {
      for (const f of ["flags", "basePoint"]) {
        if (leafEq(a[f]!, b[f]!)) c.ok();
        else c.bad(`block.${f}`, `blocks[${k}].${f}`, a[f], b[f]);
      }
      compareList(c, "entity", `blocks[${k}]`, a.entities as JsonObject[], b.entities as JsonObject[]);
    }
  }
  compareList(c, "entity", "modelspace", ts.modelspace as JsonObject[], ez.modelspace as JsonObject[]);
  compareList(c, "entity", "paperspace", ts.paperspace as JsonObject[], ez.paperspace as JsonObject[]);
}

// ---- main -------------------------------------------------------------------------------------

interface FileResult {
  path: string;
  status: "compared" | "ezdxf-failed" | "truedxf-failed" | "skipped-large";
  loader?: string;
  compared?: number;
  disagreements?: number;
  error?: string;
}

function pick(files: ManifestRecord[], args: Args): ManifestRecord[] {
  let sel = selectDxf(files, { filter: args.filter });
  if (args.sample) {
    // deterministic sample: every k-th file in sha order
    sel = [...sel].sort((a, b) => a.sha256.localeCompare(b.sha256));
    const step = Math.max(1, Math.floor(sel.length / args.sample));
    sel = sel.filter((_, i) => i % step === 0).slice(0, args.sample);
  }
  if (args.limit) sel = sel.slice(0, args.limit);
  return sel;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files = pick(loadManifest(), args);
  const scriptHash = createHash("sha256").update(readFileSync(SCRIPT)).digest("hex").slice(0, 10);
  const cacheDir = join(REPORTS, "ezdxf-cache", scriptHash);
  mkdirSync(cacheDir, { recursive: true });
  const cacheFile = (r: ManifestRecord) => join(cacheDir, `${r.sha256}.json.gz`);
  const large = (r: ManifestRecord) => r.size > args.maxMb * 1e6;

  const tasks = files
    .filter((r) => !large(r) && (args.refresh || !existsSync(cacheFile(r))))
    .map((r) => ({ src: join(EXTERNAL, r.path), out: cacheFile(r) }));
  console.error(`${files.length} files, ${tasks.length} need an ezdxf dump (cache ${cacheDir})`);
  await runEzdxf(tasks, args);

  const c = new Comparison(args.examples);
  const results: FileResult[] = [];
  const t0 = performance.now();
  for (const [n, rec] of files.entries()) {
    if (n % 200 === 0)
      console.error(`compare ${n}/${files.length} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
    if (large(rec)) {
      results.push({ path: rec.path, status: "skipped-large" });
      continue;
    }
    let ez: JsonObject;
    try {
      ez = JSON.parse(gunzipSync(readFileSync(cacheFile(rec))).toString("utf8")) as JsonObject;
    } catch (e) {
      results.push({ path: rec.path, status: "ezdxf-failed", error: `cache unreadable: ${String(e)}` });
      continue;
    }
    if (!ez.ok) {
      results.push({ path: rec.path, status: "ezdxf-failed", error: String(ez.error) });
      continue;
    }
    let ts: JsonObject;
    try {
      ts = dumpDocument(DxfDocument.load(new Uint8Array(readFileSync(join(EXTERNAL, rec.path)))));
    } catch (e) {
      results.push({ path: rec.path, status: "truedxf-failed", error: String(e) });
      continue;
    }
    c.file = rec.path;
    c.fileCompared = 0;
    c.fileDisagreements = 0;
    compareDocs(c, ts, ez.doc as JsonObject);
    results.push({
      path: rec.path,
      status: "compared",
      loader: String(ez.loader),
      compared: c.fileCompared,
      disagreements: c.fileDisagreements,
    });
  }
  writeReport(c, results, args);
}

interface PatternOut {
  key: string;
  count: number;
  files: number;
  classification: Classification | undefined;
  values: [string, number][];
  examples: Example[];
}

function writeReport(c: Comparison, results: FileResult[], args: Args): void {
  const patterns: PatternOut[] = [...c.patterns.values()]
    .sort((a, b) => b.count - a.count)
    .map((p) => ({
      key: p.key,
      count: p.count,
      files: p.files.size,
      classification: classify(p.key),
      values: [...p.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      examples: p.examples,
    }));
  const status: Record<string, number> = {};
  for (const r of results) status[r.status] = (status[r.status] ?? 0) + 1;
  const loaders: Record<string, number> = {};
  for (const r of results) if (r.loader) loaders[r.loader] = (loaders[r.loader] ?? 0) + 1;
  const byClass: Record<string, number> = {};
  for (const p of patterns) {
    const k = p.classification?.kind ?? "unclassified";
    byClass[k] = (byClass[k] ?? 0) + p.count;
  }
  const agreement = c.compared ? 1 - c.disagreements / c.compared : 1;
  const summary = {
    files: results.length,
    status,
    ezdxfLoader: loaders,
    comparedAttributes: c.compared,
    disagreements: c.disagreements,
    agreement: +(agreement * 100).toFixed(4),
    disagreementsByClass: byClass,
    filesWithDisagreements: results.filter((r) => (r.disagreements ?? 0) > 0).length,
    patterns: patterns.length,
    options: { filter: args.filter?.source, limit: args.limit, sample: args.sample, maxMb: args.maxMb },
  };
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(
    join(REPORTS, "diff-ezdxf.json"),
    JSON.stringify(
      { summary, patterns, failures: results.filter((r) => r.status.endsWith("failed")), files: results },
      null,
      1,
    ),
  );
  writeFileSync(join(REPORTS, "diff-ezdxf.md"), markdown(summary, patterns, results));
  console.log(JSON.stringify(summary, null, 2));
  for (const p of patterns.slice(0, 25))
    console.log(
      `${String(p.count).padStart(9)} ${String(p.files).padStart(5)}f  ${p.classification?.kind ?? "??"}  ${p.key}`,
    );
}

function markdown(summary: Record<string, unknown>, patterns: PatternOut[], results: FileResult[]): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [
    "# Differential oracle: truedxf vs ezdxf",
    "",
    "Generated by `tools/corpus/src/diff-ezdxf.ts`; classifications from `tools/corpus/src/diff-classes.ts`.",
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    "## Disagreement patterns",
    "",
    "| # | count | files | class | pattern | top values (truedxf \\| ezdxf) | note |",
    "|---|---:|---:|---|---|---|---|",
  ];
  patterns.slice(0, 80).forEach((p, i) => {
    const vals = p.values
      .slice(0, 3)
      .map(([v, n]) => `\`${esc(v)}\` ×${n}`)
      .join("<br>");
    lines.push(
      `| ${i + 1} | ${p.count} | ${p.files} | ${p.classification?.kind ?? "**unclassified**"} | ${esc(p.key)} | ${vals} | ${esc(p.classification?.note ?? "")} |`,
    );
  });
  const failures = results.filter((r) => r.status.endsWith("failed"));
  if (failures.length) {
    lines.push("", "## Load failures", "");
    for (const f of failures.slice(0, 50)) lines.push(`- ${f.status}: \`${f.path}\` — ${esc(f.error ?? "")}`);
  }
  const worst = results
    .filter((r) => (r.disagreements ?? 0) > 0)
    .sort((a, b) => b.disagreements! - a.disagreements!)
    .slice(0, 20);
  if (worst.length) {
    lines.push("", "## Files with most disagreements", "");
    for (const r of worst) lines.push(`- ${r.disagreements}/${r.compared}: \`${r.path}\``);
  }
  return `${lines.join("\n")}\n`;
}

await main();
