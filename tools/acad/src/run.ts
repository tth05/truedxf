// AutoCAD reference runner (docs/fixtures.md, research/notes/08 §6–§7).
//
//   node tools/acad/src/run.ts [--suite s] [--case id] [--force] [--jobs N] [--timeout s] [--list]
//
// For every samples/generated/<suite>/<case>.{json,dxf} it writes a .scr, runs accoreconsole.exe
// (with /isolate so pinned sysvars never touch the user's profile), verifies the echoed prompt
// sequence and the PNG size, and writes samples/refs/<acad-build>/<suite>/<case>.{png,pdf,dxf,log,json}.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { decode as decodePng } from "fast-png";
import { CONFIG_FILES, sha256File } from "./configs.ts";
import { ACAD_DIR, ACCORECONSOLE, GENERATED_DIR, PLOT_STYLES_DIR, REFS_DIR, requireFile } from "./env.ts";
import { buildScript, type CaseMeta, MARK, verifySteps } from "./script.ts";
import { isSupportedCanvas } from "./sizes.ts";

/** Bump when script generation or verification changes; references with another version are re-run. */
export const HARNESS_VERSION = 3;

export type Status = "ok" | "harness-failure" | "invalid-fixture" | "timeout" | "crash";

type Args = { suite?: string; caseId?: string; force: boolean; jobs: number; timeout: number; list: boolean };

function parseArgs(argv: string[]): Args {
  const a: Args = {
    force: false,
    jobs: Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2))),
    timeout: 120,
    list: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`missing value for ${k}`);
      return x;
    };
    if (k === "--suite") a.suite = v();
    else if (k === "--case") a.caseId = v();
    else if (k === "--force") a.force = true;
    else if (k === "--jobs") a.jobs = Number(v());
    else if (k === "--timeout") a.timeout = Number(v());
    else if (k === "--list") a.list = true;
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

// ------------------------------------------------------------------ process

export type ConsoleResult = { exitCode: number | null; timedOut: boolean; log: string; durationMs: number };

/** accoreconsole writes its console transcript to stdout as UTF-16LE. */
export function decodeLog(buf: Buffer): string {
  let s = buf.toString("utf16le");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function killTree(pid: number) {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}

/** The Windows crash reporter keeps running after a console crash (note 08 §6.1). */
function killCrashReporters() {
  spawnSync("taskkill", ["/IM", "senddmp.exe", "/F"], { stdio: "ignore" });
}

export function runConsole(opts: {
  dxf?: string;
  script: string;
  cwd: string;
  isolate: { id: string; dir: string };
  timeoutMs: number;
}): Promise<ConsoleResult> {
  const args = ["/isolate", opts.isolate.id, opts.isolate.dir];
  if (opts.dxf) args.push("/i", opts.dxf);
  args.push("/s", opts.script, "/l", "en-US");
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(requireFile(ACCORECONSOLE, "accoreconsole.exe"), args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => chunks.push(c));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killTree(child.pid);
    }, opts.timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        timedOut,
        log: decodeLog(Buffer.concat(chunks)),
        durationMs: Date.now() - t0,
      });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, timedOut, log: `spawn error: ${e.message}`, durationMs: Date.now() - t0 });
    });
  });
}

// ------------------------------------------------------------------ build probe

export type AcadInfo = { product: string; build: string; acadver: string; vernum: string; dir: string };

export async function probeAcad(work: string): Promise<AcadInfo> {
  mkdirSync(work, { recursive: true });
  const scr = join(work, "probe.scr");
  writeFileSync(
    scr,
    `(princ (strcat "\\n${MARK} PROBE|" (getvar "PRODUCT") "|" (getvar "ACADVER") "|" (getvar "_VERNUM") "\\n"))\r\n_.QUIT\r\n_Y\r\n`,
  );
  const r = await runConsole({
    script: scr,
    cwd: work,
    isolate: { id: "truedxf-probe", dir: join(work, "profile") },
    timeoutMs: 60_000,
  });
  // Anchored: the echoed LISP command line contains the marker text too.
  const m = new RegExp(`^${MARK} PROBE\\|([^|]*)\\|([^|]*)\\|([^\\n]*)`, "m").exec(r.log);
  if (!m) throw new Error(`AutoCAD probe failed:\n${r.log.slice(-2000)}`);
  const year = /AutoCAD (\d{4})/.exec(ACAD_DIR)?.[1] ?? "";
  const acadver = m[2]!.trim();
  const vernum = m[3]!.trim();
  const product = `${m[1]!.trim()} ${year}`.trim();
  return {
    product,
    acadver,
    vernum,
    build: `${acadver} ${vernum}`,
    dir: `acad${year}-R${acadver.split(" ")[0]}`,
  };
}

// ------------------------------------------------------------------ cases

type CaseFiles = { id: string; suite: string; name: string; json: string; dxf: string };

export function listCases(filter: { suite?: string; caseId?: string }): CaseFiles[] {
  if (!existsSync(GENERATED_DIR)) return [];
  const out: CaseFiles[] = [];
  const suites = readdirSync(GENERATED_DIR).filter((s) => statSync(join(GENERATED_DIR, s)).isDirectory());
  for (const suite of suites.sort()) {
    if (filter.suite && suite !== filter.suite) continue;
    for (const f of readdirSync(join(GENERATED_DIR, suite)).sort()) {
      if (!f.endsWith(".json")) continue;
      const name = f.slice(0, -5);
      const id = `${suite}/${name}`;
      if (filter.caseId && id !== filter.caseId && name !== filter.caseId) continue;
      const dxf = join(GENERATED_DIR, suite, `${name}.dxf`);
      if (!existsSync(dxf)) continue;
      out.push({ id, suite, name, json: join(GENERATED_DIR, suite, f), dxf });
    }
  }
  return out;
}

type RefMeta = {
  id: string;
  status: Status;
  harness: number;
  acad: { product: string; build: string };
  configs: Record<string, string | null>;
  fixtureSha256: string;
  metaSha256: string;
  script: string;
  durationMs: number;
  outputs: Record<string, Record<string, unknown>>;
  messages: string[];
};

function configHashes(styleTable: string): Record<string, string | null> {
  return {
    pc3: sha256File(CONFIG_FILES.pngPc3),
    pmp: sha256File(CONFIG_FILES.pngPmp),
    ctb: sha256File(join(PLOT_STYLES_DIR, styleTable)),
    pdfPc3: sha256File(CONFIG_FILES.pdfPc3),
    pdfPmp: sha256File(CONFIG_FILES.pdfPmp),
  };
}

function isUpToDate(refJson: string, fixtureSha: string, metaSha: string): boolean {
  if (!existsSync(refJson)) return false;
  try {
    const r = JSON.parse(readFileSync(refJson, "utf8")) as RefMeta;
    if (r.fixtureSha256 !== fixtureSha || r.metaSha256 !== metaSha || r.harness !== HARNESS_VERSION)
      return false;
    return r.status === "ok" || r.status === "invalid-fixture";
  } catch {
    return false;
  }
}

function pngInfo(buf: Buffer) {
  const img = decodePng(buf);
  return {
    width: img.width,
    height: img.height,
    channels: img.channels,
    depth: img.depth,
    palette: !!img.palette,
    sha256: sha256(buf),
  };
}

function pdfInfo(buf: Buffer) {
  const s = buf.toString("latin1");
  const mb = /\/MediaBox\s*\[\s*([-\d.\s]+)\]/.exec(s);
  return {
    bytes: buf.length,
    sha256: sha256(buf),
    ...(mb ? { mediaBox: mb[1]!.trim().split(/\s+/).map(Number) } : {}),
    pages: (s.match(/\/Type\s*\/Page[^s]/g) ?? []).length,
  };
}

const ERROR_PATTERNS = [
  /Invalid or incomplete DXF input/i,
  /is not valid DXF file/i,
  /Unknown command/i,
  /\*Invalid\*/,
  /Invalid (option keyword|input|point|number)/i,
  /; error:/i,
  /Point or option keyword required/i,
  /Requires an integer|Requires a real/i,
  /not found\./i,
];

export async function runCase(
  c: CaseFiles,
  acad: AcadInfo,
  worker: { id: number; tmp: string },
  opts: { force: boolean; timeoutS: number },
): Promise<{ status: Status | "skipped"; messages: string[] }> {
  const metaBuf = readFileSync(c.json);
  const dxfBuf = readFileSync(c.dxf);
  const fixtureSha = sha256(dxfBuf);
  const metaSha = sha256(metaBuf);
  const refDir = join(REFS_DIR, acad.dir, c.suite);
  const refBase = join(refDir, c.name);
  if (!opts.force && isUpToDate(`${refBase}.json`, fixtureSha, metaSha))
    return { status: "skipped", messages: [] };

  const meta = JSON.parse(metaBuf.toString("utf8")) as CaseMeta;
  const messages: string[] = [];
  const outputs = meta.outputs ?? ["png"];
  if (!isSupportedCanvas(meta.plot.canvas)) messages.push(`unsupported canvas ${meta.plot.canvas.join("x")}`);

  // Short, space-free working paths (note 08 §6.3); one directory per worker.
  const work = join(worker.tmp, `w${worker.id}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const inDxf = join(work, "case.dxf");
  copyFileSync(c.dxf, inDxf);
  const files = {
    ...(outputs.includes("png") ? { png: join(work, "out.png") } : {}),
    ...(outputs.includes("pdf") ? { pdf: join(work, "out.pdf") } : {}),
    ...(outputs.includes("dxf") ? { dxf: join(work, "out.dxf") } : {}),
  };
  let built: ReturnType<typeof buildScript> | undefined;
  try {
    built = buildScript(meta, files);
  } catch (e) {
    messages.push(`script generation failed: ${(e as Error).message}`);
  }
  const scriptPath = join(work, "run.scr");
  let status: Status = "ok";
  let res: ConsoleResult | undefined;
  const refOutputs: RefMeta["outputs"] = {};
  if (!built || messages.some((m) => m.startsWith("unsupported"))) {
    status = "harness-failure";
  } else {
    writeFileSync(scriptPath, built.text, "utf8");
    res = await runConsole({
      dxf: inDxf,
      script: scriptPath,
      cwd: work,
      isolate: { id: `truedxf-w${worker.id}`, dir: join(worker.tmp, `profile-w${worker.id}`) },
      timeoutMs: opts.timeoutS * 1000,
    });
    const log = res.log;
    const lines = log.split("\n");
    if (/Invalid or incomplete DXF input|is not valid DXF file/i.test(log)) {
      status = "invalid-fixture";
      messages.push("AutoCAD rejected the DXF");
    } else if (res.timedOut) {
      status = "timeout";
      messages.push(`timeout after ${opts.timeoutS}s`);
    } else if (!lines.some((l) => l.startsWith(`${MARK} DONE`))) {
      // A clean exit without the DONE marker means the script desynchronised (a rejected answer
      // turned the remaining lines into commands); a non-zero exit is a console crash.
      status = res.exitCode === 0 ? "harness-failure" : "crash";
      messages.push(`console exited with ${res.exitCode} before the end of the script`);
      if (status === "crash") killCrashReporters();
      for (const p of built.plots) {
        const begin = lines.findIndex((l) => l.startsWith(`${MARK} BEGIN ${p.device}`));
        if (begin < 0) continue;
        const v = verifySteps(lines, begin, p.steps);
        if (v.error) messages.push(`${p.device}: ${v.error}`);
      }
    } else {
      for (const l of lines) {
        if (ERROR_PATTERNS.some((re) => re.test(l))) messages.push(`log: ${l.trim()}`);
        if (l.startsWith(`${MARK} NOSYSVAR`)) messages.push(`log: ${l.trim()}`);
      }
      let pos = 0;
      for (const p of built.plots) {
        const begin = lines.findIndex((l, i) => i >= pos && l.startsWith(`${MARK} BEGIN ${p.device}`));
        const v = verifySteps(lines, begin < 0 ? pos : begin, p.steps);
        if (v.error) messages.push(`${p.device}: ${v.error}`);
        pos = v.at;
        const eff = lines.slice(pos, pos + 4).find((l) => l.includes("Effective plotting area"));
        if (!eff) messages.push(`${p.device}: no "Effective plotting area" after Proceed`);
        else
          refOutputs[p.device] = {
            effectivePlottingArea: eff.replace("Effective plotting area:", "").trim(),
          };
      }
      if (built.zoom) {
        const begin = lines.findIndex((l) => l.startsWith(`${MARK} BEGIN zoom`));
        const v = verifySteps(lines, Math.max(0, begin), built.zoom);
        if (v.error) messages.push(`zoom: ${v.error}`);
      }
      if (built.dxfout) {
        const begin = lines.findIndex((l) => l.startsWith(`${MARK} BEGIN dxf`));
        const v = verifySteps(lines, Math.max(0, begin), built.dxfout);
        if (v.error) messages.push(`dxf: ${v.error}`);
      }
      if (messages.length > 0) status = "harness-failure";
    }
  }

  // Collect outputs.
  mkdirSync(refDir, { recursive: true });
  for (const ext of ["png", "pdf", "dxf"] as const) rmSync(`${refBase}.${ext}`, { force: true });
  const produced = files as Partial<Record<"png" | "pdf" | "dxf", string>>;
  for (const ext of outputs) {
    const f = produced[ext];
    if (!f || !existsSync(f)) {
      if (status === "ok") {
        status = "harness-failure";
        messages.push(`${ext}: output file missing`);
      }
      continue;
    }
    const buf = readFileSync(f);
    writeFileSync(`${refBase}.${ext}`, buf);
    try {
      if (ext === "png") {
        const info = pngInfo(buf);
        refOutputs.png = { ...refOutputs.png, ...info };
        if (info.width !== meta.plot.canvas[0] || info.height !== meta.plot.canvas[1]) {
          status = status === "ok" ? "harness-failure" : status;
          messages.push(`png: size ${info.width}x${info.height} != canvas ${meta.plot.canvas.join("x")}`);
        }
      } else if (ext === "pdf") refOutputs.pdf = { ...refOutputs.pdf, ...pdfInfo(buf) };
      else refOutputs.dxf = { bytes: buf.length, sha256: sha256(buf) };
    } catch (e) {
      status = status === "ok" ? "harness-failure" : status;
      messages.push(`${ext}: cannot read output: ${(e as Error).message}`);
    }
  }
  if (res) writeFileSync(`${refBase}.log`, res.log, "utf8");
  const ref: RefMeta = {
    id: c.id,
    status,
    harness: HARNESS_VERSION,
    acad: { product: acad.product, build: acad.build },
    configs: configHashes(meta.plot.styleTable),
    fixtureSha256: fixtureSha,
    metaSha256: metaSha,
    script: built?.text ?? "",
    durationMs: res?.durationMs ?? 0,
    outputs: refOutputs,
    messages,
  };
  writeFileSync(`${refBase}.json`, `${JSON.stringify(ref, null, 2)}\n`, "utf8");
  return { status, messages };
}

// ------------------------------------------------------------------ main

export function harnessTmp(): string {
  const t = process.env.TRUEDXF_ACAD_TMP ?? join(tmpdir(), "truedxf-acad");
  if (t.includes(" ")) throw new Error(`temp dir must not contain spaces: ${t} (set TRUEDXF_ACAD_TMP)`);
  return t;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = listCases({
    ...(args.suite ? { suite: args.suite } : {}),
    ...(args.caseId ? { caseId: args.caseId } : {}),
  });
  if (args.list) {
    for (const c of cases) console.log(c.id);
    return;
  }
  if (cases.length === 0) {
    console.error("no cases found under", GENERATED_DIR);
    process.exitCode = 1;
    return;
  }
  for (const f of [CONFIG_FILES.pngPc3, CONFIG_FILES.pngPmp])
    requireFile(f, `${basename(f)} (run node tools/acad/src/configs.ts)`);
  const tmp = harnessTmp();
  mkdirSync(tmp, { recursive: true });
  const acad = await probeAcad(join(tmp, "probe"));
  console.log(
    `${acad.product} ${acad.build} -> samples/refs/${acad.dir}; ${cases.length} case(s), ${args.jobs} job(s)`,
  );
  const counts: Record<string, number> = {};
  let next = 0;
  const t0 = Date.now();
  const worker = async (id: number) => {
    while (next < cases.length) {
      const c = cases[next++]!;
      let r: Awaited<ReturnType<typeof runCase>>;
      try {
        r = await runCase(c, acad, { id, tmp }, { force: args.force, timeoutS: args.timeout });
      } catch (e) {
        r = { status: "harness-failure", messages: [(e as Error).stack ?? String(e)] };
      }
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      if (r.status !== "skipped")
        console.log(
          `${r.status.padEnd(16)} ${c.id}${r.messages.length ? `  ${r.messages.join(" | ")}` : ""}`,
        );
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, args.jobs) }, (_, i) => worker(i)));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(counts));
  if (Object.keys(counts).some((k) => k !== "ok" && k !== "skipped")) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
