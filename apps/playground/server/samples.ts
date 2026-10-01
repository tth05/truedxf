/**
 * Dev-server API over the local samples/ folder (docs/PLAN.md §7.6: samples stay local and may be
 * absent: every endpoint then answers with empty data). Only files below samples/ are served.
 *
 *   GET /api/samples/status                → { available, refs, suites: [{ name, cases, score, grades }], corpus }
 *   GET /api/samples/suite/<suite>         → { cases: [{ id, name, title, tags, plot, ref, score }] }
 *   GET /api/samples/corpus?q&type&version&producer&limit → { total, rows }
 *   GET /api/samples/facets                → { versions, producers, types }
 *   GET /api/samples/file/<path>           → a file below samples/
 *   GET /api/samples/image/<suite>/<path>  → a raster file referenced by a fixture (IMAGEDEF)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, isAbsolute, join, resolve, sep } from "node:path";

export const SAMPLES = resolve(import.meta.dirname, "..", "..", "..", "samples");

export interface CaseScore {
  /** Mismatching pixels (exact comparison). */
  exact?: number;
  /** F1 at tolerance 0 / 1 / 2 px. */
  f1?: number[];
  /** The case failed to render. */
  error?: string;
  source: "scoreboard" | "visual";
}

export type Grade = "exact" | "good" | "fair" | "poor" | "error";

/** exact / good (F1 at 1 px ≥ 0.99) / fair (≥ 0.9) / poor; same rule as the browser's dots. */
export function grade(s: CaseScore): Grade {
  if (s.error !== undefined) return "error";
  if (s.exact === 0) return "exact";
  const f1 = s.f1?.[1] ?? s.f1?.[0] ?? 0;
  return f1 >= 0.99 ? "good" : f1 >= 0.9 ? "fair" : "poor";
}

export interface CorpusRow {
  path: string;
  size: number;
  format: string;
  version: string | null;
  producer: string | null;
  title: string | null;
  entities: number;
  types: string[];
}

interface ManifestRow {
  path: string;
  size: number;
  format: string;
  version?: string | null;
  producer?: string | null;
  title?: string | null;
  entities?: Record<string, number>;
  block_entities?: Record<string, number>;
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function dirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** The AutoCAD reference folder (newest acad* build under samples/refs). */
export function refsDir(root = SAMPLES): string | undefined {
  const all = dirs(join(root, "refs")).filter((d) => d.startsWith("acad"));
  const last = all[all.length - 1];
  return last ? join(root, "refs", last) : undefined;
}

/**
 * Per-case scores: the scoreboard reports (CPU scorer), then the visual harness results for
 * cases the scoreboard does not have. The JSON reports list every case; the logs are only a
 * fallback for older reports, since `--quiet` runs log no exact matches.
 */
export function caseScores(root = SAMPLES): Map<string, CaseScore> {
  const out = new Map<string, CaseScore>();
  const board = join(root, "reports", "scoreboard");
  let files: string[] = [];
  try {
    files = readdirSync(board).sort();
  } catch {
    // no scoreboard
  }
  for (const f of files.filter((x) => x.endsWith(".json"))) {
    const report = readJson<{ cases?: Record<string, { exact?: number; f1?: number[]; error?: string }> }>(
      join(board, f),
    );
    for (const [id, c] of Object.entries(report?.cases ?? {}))
      out.set(id, {
        ...(c.exact !== undefined ? { exact: c.exact } : {}),
        ...(c.f1 ? { f1: c.f1 } : {}),
        ...(c.error !== undefined ? { error: c.error } : {}),
        source: "scoreboard",
      });
  }
  const line = /^(\S+\/\S+)\s+exact=(\d+)\s+f1=([\d.]+)\/([\d.]+)\/([\d.]+)/;
  for (const f of files.filter((x) => x.endsWith(".log"))) {
    for (const l of readFileSync(join(board, f), "utf8").split(/\r?\n/)) {
      const m = line.exec(l);
      if (m && !out.has(m[1]!))
        out.set(m[1]!, {
          exact: Number(m[2]),
          f1: [Number(m[3]), Number(m[4]), Number(m[5])],
          source: "scoreboard",
        });
    }
  }
  const visual = readJson<{
    results?: { id: string; metrics?: { exactMismatch?: number; f1?: number[] } }[];
  }>(join(root, "out", "visual", "results.json"));
  for (const r of visual?.results ?? []) {
    if (!r.metrics || out.has(r.id)) continue;
    out.set(r.id, {
      ...(r.metrics.exactMismatch !== undefined ? { exact: r.metrics.exactMismatch } : {}),
      ...(r.metrics.f1 ? { f1: r.metrics.f1 } : {}),
      source: "visual",
    });
  }
  return out;
}

export function listSuites(root = SAMPLES) {
  const gen = join(root, "generated");
  // per-suite counts by grade, over all scored cases
  const grades = new Map<string, Record<Grade, number>>();
  for (const [id, s] of caseScores(root)) {
    const suite = id.slice(0, id.indexOf("/"));
    let g = grades.get(suite);
    if (!g) grades.set(suite, (g = { exact: 0, good: 0, fair: 0, poor: 0, error: 0 }));
    g[grade(s)]++;
  }
  return dirs(gen).map((name) => {
    let cases = 0;
    try {
      cases = readdirSync(join(gen, name)).filter((f) => f.endsWith(".dxf")).length;
    } catch {
      // unreadable
    }
    const score = readJson<{
      n: number;
      exact: number;
      good: number;
      perSuite?: Record<string, { f1: number }>;
    }>(join(root, "reports", "scoreboard", `${name}.json`));
    return {
      name,
      cases,
      ...(score
        ? { score: { n: score.n, exact: score.exact, good: score.good, f1: score.perSuite?.[name]?.f1 } }
        : {}),
      ...(grades.has(name) ? { grades: grades.get(name)! } : {}),
    };
  });
}

export function listCases(suite: string, root = SAMPLES) {
  if (!/^[\w.-]+$/.test(suite)) return [];
  const dir = join(root, "generated", suite);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".dxf"));
  } catch {
    return [];
  }
  const scores = caseScores(root);
  const refs = refsDir(root);
  return files.sort().map((f) => {
    const name = f.slice(0, -4);
    const id = `${suite}/${name}`;
    const meta = readJson<{ title?: string; tags?: string[]; plot?: unknown }>(join(dir, `${name}.json`));
    const ref =
      refs && existsSync(join(refs, suite, `${name}.png`))
        ? `refs/${basename(refs)}/${suite}/${name}.png`
        : null;
    return {
      id,
      name,
      title: meta?.title ?? "",
      tags: meta?.tags ?? [],
      plot: meta?.plot ?? null,
      dxf: `generated/${suite}/${f}`,
      ref,
      score: scores.get(id) ?? null,
    };
  });
}

const manifests = new Map<string, ManifestRow[]>();
function loadManifest(root = SAMPLES): ManifestRow[] {
  const cached = manifests.get(root);
  if (cached) return cached;
  const out: ManifestRow[] = [];
  try {
    for (const l of readFileSync(join(root, "external", "manifest.jsonl"), "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l) as ManifestRow;
        if (typeof r.format === "string" && r.format.endsWith("dxf")) out.push(r);
      } catch {
        // skip bad lines
      }
    }
  } catch {
    // no corpus
  }
  manifests.set(root, out);
  return out;
}

function rowOf(r: ManifestRow): CorpusRow {
  const ents = { ...(r.block_entities ?? {}), ...(r.entities ?? {}) };
  const top = Object.entries(r.entities ?? {}).sort((a, b) => b[1] - a[1]);
  return {
    path: r.path,
    size: r.size,
    format: r.format,
    version: r.version ?? null,
    producer: r.producer ?? null,
    title: r.title ?? null,
    entities: Object.values(r.entities ?? {}).reduce((a, b) => a + b, 0),
    types: (top.length ? top : Object.entries(ents)).slice(0, 8).map(([k]) => k),
  };
}

export function searchCorpus(params: URLSearchParams, root = SAMPLES): { total: number; rows: CorpusRow[] } {
  const q = (params.get("q") ?? "").trim().toLowerCase();
  const type = (params.get("type") ?? "").trim().toUpperCase();
  const version = params.get("version") ?? "";
  const producer = params.get("producer") ?? "";
  const sort = params.get("sort") ?? "";
  const limit = Math.min(Number(params.get("limit") ?? 200) || 200, 1000);
  let rows = loadManifest(root).filter((r) => {
    if (q && !r.path.toLowerCase().includes(q) && !(r.title ?? "").toLowerCase().includes(q)) return false;
    if (type && !r.entities?.[type] && !r.block_entities?.[type]) return false;
    if (version && String(r.version ?? "") !== version) return false;
    if (producer && String(r.producer ?? "") !== producer) return false;
    return true;
  });
  if (sort === "size") rows = [...rows].sort((a, b) => b.size - a.size);
  return { total: rows.length, rows: rows.slice(0, limit).map(rowOf) };
}

export function corpusFacets(root = SAMPLES) {
  const versions = new Map<string, number>();
  const producers = new Map<string, number>();
  const types = new Map<string, number>();
  for (const r of loadManifest(root)) {
    const v = String(r.version ?? "");
    const p = String(r.producer ?? "");
    if (v && /^[\w. -]+$/.test(v)) versions.set(v, (versions.get(v) ?? 0) + 1);
    if (p && p !== "null") producers.set(p, (producers.get(p) ?? 0) + 1);
    for (const t of Object.keys({ ...(r.entities ?? {}), ...(r.block_entities ?? {}) }))
      types.set(t, (types.get(t) ?? 0) + 1);
  }
  const sorted = (m: Map<string, number>) =>
    [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ name: k, n }));
  return { versions: sorted(versions), producers: sorted(producers), types: sorted(types).slice(0, 120) };
}

/** Resolves a path below samples/ (undefined for anything outside or missing). */
export function samplePath(rel: string, root = SAMPLES): string | undefined {
  const p = resolve(root, rel);
  if (p !== root && !p.startsWith(root + sep)) return undefined;
  return existsSync(p) && statSync(p).isFile() ? p : undefined;
}

const RASTER = /\.(png|jpe?g|tiff?|bmp|gif|pdf)$/i;

function fixtureImage(suite: string, path: string, root = SAMPLES): string | undefined {
  if (!/^[\w.-]+$/.test(suite)) return undefined;
  return nearImage(join(root, "generated", suite), path, root);
}

/** A raster file referenced by an IMAGEDEF path, looked up relative to `dir` (below samples/). */
export function nearImage(dir: string, path: string, root = SAMPLES): string | undefined {
  const p = path.replaceAll("\\", "/");
  if (!RASTER.test(p)) return undefined;
  for (const t of [
    isAbsolute(p) || /^[a-z]:\//i.test(p) ? undefined : join(dir, p),
    join(dir, basename(p)),
  ]) {
    if (t && samplePath(t, root)) return t;
  }
  return undefined;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json",
  ".dxf": "application/octet-stream",
};

/** Images: a missing IMAGEDEF file is expected (drawn as a frame): 204, not an error. */
function sendImage(res: ServerResponse, file: string | undefined): void {
  if (file) send(res, file);
  else {
    res.statusCode = 204;
    res.end();
  }
}

function send(res: ServerResponse, file: string): void {
  res.statusCode = 200;
  res.setHeader("content-type", MIME[extname(file).toLowerCase()] ?? "application/octet-stream");
  res.end(readFileSync(file));
}

export function samplesMiddleware(root = SAMPLES) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/samples/")) {
      next();
      return;
    }
    const route = decodeURIComponent(url.pathname.slice("/api/samples/".length));
    try {
      if (route === "status") {
        const available = existsSync(root);
        const refs = available ? refsDir(root) : undefined;
        json(res, {
          available,
          refs: refs ? basename(refs) : null,
          suites: available ? listSuites(root) : [],
          corpus: available ? loadManifest(root).length : 0,
        });
      } else if (route.startsWith("suite/")) json(res, { cases: listCases(route.slice(6), root) });
      else if (route === "corpus") json(res, searchCorpus(url.searchParams, root));
      else if (route === "facets") json(res, corpusFacets(root));
      else if (route.startsWith("file/")) {
        const f = samplePath(route.slice(5), root);
        if (f) send(res, f);
        else json(res, { error: "not found" }, 404);
      } else if (route.startsWith("image/")) {
        const rest = route.slice(6);
        const cut = rest.indexOf("/");
        const f = cut > 0 ? fixtureImage(rest.slice(0, cut), rest.slice(cut + 1), root) : undefined;
        sendImage(res, f);
      } else if (route === "near-image") {
        // ?dir=<folder below samples/>&path=<IMAGEDEF path>
        const dir = resolve(root, url.searchParams.get("dir") ?? "");
        const inside = dir === root || dir.startsWith(root + sep);
        sendImage(res, inside ? nearImage(dir, url.searchParams.get("path") ?? "", root) : undefined);
      } else json(res, { error: "not found" }, 404);
    } catch (e) {
      json(res, { error: String(e) }, 500);
    }
  };
}
