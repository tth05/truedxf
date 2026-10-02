/** Behaviour gate; run with pnpm fingerprint for an 8 GiB heap per worker. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, endianness } from "node:os";
import { basename, join, relative } from "node:path";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { resolveBenchPaths } from "./bench-set.ts";
import { EXTERNAL, loadManifest, REPORTS, ROOT } from "./common.ts";
import type { Kind, PipelineReply, RecordResult, Target, Task } from "./fingerprint-pipeline.ts";

type SetName = "fixtures" | "corpus" | "model-all";
interface Args {
  mode: "save" | "check";
  sets: SetName[];
  jobs: number;
  sample: number;
  maxMb: number;
  only?: RegExp;
  name: string;
  detail: boolean;
}
interface Baseline {
  version: 1;
  set: SetName;
  records: Record<string, RecordResult>;
}
interface Work {
  task: Task;
  oldHashes?: Partial<Record<Kind, string>>;
}
const SETS: SetName[] = ["fixtures", "corpus", "model-all"];
const KINDS: Kind[] = ["model", "plot", "viewer"];
const OUT = join(REPORTS, "fingerprint");
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const kindsFor = (set: SetName): Kind[] =>
  set === "fixtures" ? KINDS : set === "corpus" ? ["model", "viewer"] : ["model"];

function args(argv: string[]): Args {
  const a: Args = {
    mode: "check",
    sets: ["fixtures", "corpus"],
    jobs: Math.max(1, Math.min(8, cpus().length - 2)),
    sample: 300,
    maxMb: 15,
    name: "baseline",
    detail: false,
  };
  let mode: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`missing value for ${flag}`);
      return v;
    };
    if (flag === "--save" || flag === "--check") {
      if (mode) throw new Error("specify exactly one of --save or --check");
      mode = flag;
      a.mode = flag === "--save" ? "save" : "check";
    } else if (flag === "--set") {
      const v = value();
      const sets = v === "all" ? SETS : v.split(",");
      if (sets.some((s) => !SETS.includes(s as SetName))) throw new Error(`unknown set: ${v}`);
      a.sets = [...new Set(sets)] as SetName[];
    } else if (flag === "--jobs") a.jobs = Number(value());
    else if (flag === "--sample") a.sample = Number(value());
    else if (flag === "--max-mb") a.maxMb = Number(value());
    else if (flag === "--only") a.only = new RegExp(value(), "i");
    else if (flag === "--name") a.name = value();
    else if (flag === "--detail") a.detail = true;
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!mode) throw new Error("specify --save or --check");
  for (const [name, n] of [
    ["jobs", a.jobs],
    ["sample", a.sample],
  ] as const)
    if (!Number.isSafeInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  if (!Number.isFinite(a.maxMb) || a.maxMb <= 0) throw new Error("--max-mb must be positive");
  if (!/^[a-z0-9_-]+$/i.test(a.name)) throw new Error("--name must contain only letters, digits, _ or -");
  return a;
}

function targets(set: SetName, a: Args): Target[] {
  let out: Target[] = [];
  if (set === "fixtures") {
    const gen = join(ROOT, "samples", "generated");
    if (!existsSync(gen)) throw new Error(`missing fixtures directory: ${gen}`);
    for (const suite of readdirSync(gen, { withFileTypes: true })) {
      if (!suite.isDirectory()) continue;
      for (const file of readdirSync(join(gen, suite.name))) {
        if (!file.endsWith(".json")) continue;
        const name = file.slice(0, -5);
        const path = join(gen, suite.name, `${name}.dxf`);
        if (existsSync(path))
          out.push({ id: `${suite.name}/${name}`, name, path, meta: join(gen, suite.name, file) });
      }
    }
  } else {
    if (!existsSync(join(EXTERNAL, "manifest.jsonl"))) throw new Error("missing corpus manifest");
    const sorted = loadManifest()
      .filter((r) => r.format === "ascii-dxf" || r.format === "binary-dxf")
      .sort((a, b) => compare(a.sha256, b.sha256) || compare(a.path, b.path));
    const seen = new Set<string>();
    const unique = sorted.filter((r) => {
      if (seen.has(r.sha256)) return false;
      seen.add(r.sha256);
      return true;
    });
    const eligible = set === "corpus" ? unique.filter((r) => r.size <= a.maxMb * 2 ** 20) : unique;
    const stride = set === "corpus" ? Math.max(1, Math.round(eligible.length / a.sample)) : 1;
    out = eligible
      .filter((_, i) => i % stride === 0)
      .map((r) => ({
        id: r.path,
        name: basename(r.path),
        path: join(EXTERNAL, r.path),
      }));
    if (set === "corpus") {
      const byPath = new Map(out.map((t) => [t.path, t]));
      for (const [name, path] of resolveBenchPaths()) {
        if (/arch-cn|dense-hatch|huge-blocks/.test(name)) continue;
        const id = relative(EXTERNAL, path).replaceAll("\\", "/");
        // samples/bench paths are stable relative to the same manifest root (../bench/…).
        byPath.set(path, { id, name, path });
      }
      out = [...byPath.values()];
    }
  }
  return out
    .filter((t) => !a.only || a.only.test(t.id) || a.only.test(t.name))
    .sort((a, b) => compare(a.id, b.id));
}

function positionPath(base: string, id: string): string {
  return join(`${base}.positions`, `${createHash("sha256").update(id).digest("hex")}.bin`);
}

/** Bounded queue: workers receive paths and return small records, never the model/list buffers. */
async function pool(work: Work[], jobs: number): Promise<PipelineReply[]> {
  if (!work.length) return [];
  const workers: Worker[] = [];
  const replies: PipelineReply[] = new Array(work.length);
  let next = 0;
  let done = 0;
  const timer = setInterval(() => console.log(`  progress ${done}/${work.length}`), 30_000);
  try {
    await new Promise<void>((resolve, reject) => {
      for (let i = 0; i < Math.min(jobs, work.length); i++) {
        const worker = new Worker(new URL(import.meta.url));
        workers.push(worker);
        let active: number | undefined;
        const send = () => {
          if (next < work.length) {
            active = next++;
            worker.postMessage(work[active]);
          } else active = undefined;
        };
        worker.on("message", (reply: PipelineReply) => {
          replies[active!] = reply;
          done++;
          if (done === work.length) resolve();
          else send();
        });
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (done !== work.length && active !== undefined)
            reject(new Error(`worker exited (${code}) on ${work[active]!.task.target.id}`));
        });
        send();
      }
    });
    return replies;
  } finally {
    clearInterval(timer);
    await Promise.all(workers.map((w) => w.terminate()));
  }
}

interface Difference {
  id: string;
  kind: Kind;
  old?: RecordResult;
  current?: RecordResult;
  reason: string;
}
async function check(
  set: SetName,
  a: Args,
  base: string,
  selected: Target[],
  baseline: Baseline,
  records: Record<string, RecordResult>,
): Promise<number> {
  const differences: Difference[] = [];
  const ids = [...new Set([...Object.keys(records), ...Object.keys(baseline.records)])]
    .filter((id) => !a.only || a.only.test(id) || selected.some((t) => t.id === id))
    .sort();
  for (const kind of kindsFor(set)) {
    for (const id of ids) {
      const old = baseline.records[id];
      const current = records[id];
      const before = old?.[kind];
      const after = current?.[kind];
      if (before && after && before.hash === after.hash) continue;
      let reason = !before ? "new record" : !after ? "missing record" : "model differs";
      if (before && after) {
        if (before.error !== undefined || after.error !== undefined)
          reason = `error changed: ${JSON.stringify(before.error ?? "success")} -> ${JSON.stringify(after.error ?? "success")}`;
        else if (kind !== "model") {
          const x = before.shape;
          const y = after.shape;
          reason =
            x?.structure === y?.structure
              ? "coordinates or colours differ"
              : `structure differs (batches ${x?.batches}->${y?.batches}, vertices ${x?.vertices}->${y?.vertices})`;
        }
      }
      differences.push({ id, kind, old, current, reason });
    }
  }
  if (a.detail) {
    const byId = new Map(selected.map((t) => [t.id, t]));
    const details = differences.filter(
      (d) =>
        d.reason === "coordinates or colours differ" &&
        byId.has(d.id) &&
        existsSync(positionPath(base, d.id)),
    );
    const replies = await pool(
      details.map((d) => ({
        task: { target: byId.get(d.id)!, kinds: [d.kind], positions: positionPath(base, d.id) },
        oldHashes: { [d.kind]: d.old![d.kind]!.hash },
      })),
      a.jobs,
    );
    for (let i = 0; i < details.length; i++) {
      const d = details[i]!;
      const result = replies[i]!.record[d.kind]!;
      if (result.hash !== d.current![d.kind]!.hash)
        d.reason = "NONDETERMINISTIC: detail re-render hash changed";
      else if (result.delta !== undefined)
        d.reason = `coordinates differ: max abs delta = ${result.delta.toPrecision(6)} px${result.delta === 0 ? " (colours or other metadata differ)" : ""}`;
    }
  }
  for (const kind of kindsFor(set)) {
    const diffs = differences.filter((d) => d.kind === kind);
    console.log(
      `${set} / ${kind}: ${ids.length} checked, ${ids.length - diffs.length} identical, ${diffs.length} differing`,
    );
    for (const d of diffs) console.log(`  ${d.id}: ${d.reason.replaceAll("\n", " ")}`);
  }
  return differences.length;
}

async function main(): Promise<void> {
  const start = performance.now();
  const a = args(process.argv.slice(2));
  if (a.detail && endianness() !== "LE") throw new Error("position snapshots require a little-endian host");
  let total = 0;
  let errors = 0;
  let differing = 0;
  for (const set of a.sets) {
    const setStart = performance.now();
    const selected = targets(set, a);
    const base = join(OUT, `${a.name}-${set}`);
    let baseline: Baseline | undefined;
    if (a.mode === "check") {
      baseline = JSON.parse(readFileSync(`${base}.json`, "utf8")) as Baseline;
      if (baseline.version !== 1 || baseline.set !== set || !baseline.records)
        throw new Error(`invalid baseline: ${base}.json`);
    } else {
      mkdirSync(OUT, { recursive: true });
      if (a.detail) mkdirSync(`${base}.positions`, { recursive: true });
    }
    const priorSelected = baseline && Object.keys(baseline.records).some((id) => !a.only || a.only.test(id));
    if (!selected.length && !priorSelected) throw new Error(`no targets selected for ${set}`);
    console.log(`${a.mode} ${set}: ${selected.length} records, ${a.jobs} workers`);
    const replies = await pool(
      selected.map((target) => ({
        task: {
          target,
          kinds: kindsFor(set),
          saveDetail: a.mode === "save" && a.detail,
          positions: a.mode === "save" && a.detail ? positionPath(base, target.id) : undefined,
        },
      })),
      a.jobs,
    );
    const records = Object.fromEntries(selected.map((t, i) => [t.id, replies[i]!.record]));
    const errorRecords = Object.values(records).filter((r) =>
      KINDS.some((k) => r[k]?.error !== undefined),
    ).length;
    const errorHashes = Object.values(records).reduce(
      (n, r) => n + KINDS.filter((k) => r[k]?.error !== undefined).length,
      0,
    );
    if (a.mode === "save")
      writeFileSync(
        `${base}.json`,
        `${JSON.stringify({ version: 1, set, records } satisfies Baseline, null, 2)}\n`,
      );
    else differing += await check(set, a, base, selected, baseline!, records);
    total += selected.length;
    errors += errorRecords;
    console.log(
      `${set}: ${selected.length} records, ${errorRecords} records with errors (${errorHashes} error hashes), ${((performance.now() - setStart) / 1000).toFixed(2)} s`,
    );
  }
  console.log(
    `TOTAL: ${total} records, ${errors} records with errors, ${differing} differences, ${((performance.now() - start) / 1000).toFixed(2)} s`,
  );
  process.exitCode = differing ? 1 : 0;
}

if (isMainThread) {
  await main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
} else {
  const { runTask } = await import("./fingerprint-pipeline.ts");
  parentPort!.on("message", async ({ task, oldHashes }: Work) => {
    parentPort!.postMessage(await runTask(task, oldHashes));
  });
}
