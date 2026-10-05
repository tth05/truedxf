/**
 * Sets the versions of publishable packages for a release (docs/RELEASING.md):
 *   node scripts/set-version.ts <patch|minor|major|none|x.y.z[-pre]> [package...] [--offline] [--github-output]
 * Packages are given as `core`, `@truedxf/core` or `all` (default: all). Each package has its own
 * version: a bump moves each selected package from its current version, an exact version sets
 * all selected packages to it, `none` keeps the versions (publish what is not on npm yet).
 *
 * Workspace dependencies are `workspace:^`, which pnpm replaces with `^<dependency version>` on
 * publish. Unless `--offline` is given, the script asks the registry that every new version is
 * unpublished and that every workspace dependency outside the selection is already on npm at its
 * current version, since a published package would otherwise depend on a version that does not
 * exist.
 *
 * Prints the release plan; `--github-output` also writes `tags` (one git tag per package,
 * `@truedxf/core@0.1.1`), `filters` (pnpm `--filter` arguments) and `summary` to $GITHUB_OUTPUT.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const VERSION = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
const BUMPS = ["patch", "minor", "major", "none"];

const args = process.argv.slice(2);
const offline = args.includes("--offline");
const githubOutput = args.includes("--github-output");
const [target, ...selection] = args
  .filter((a) => !a.startsWith("--"))
  .flatMap((a) => a.split(/[\s,]+/).filter(Boolean));
if (!target || !(BUMPS.includes(target) || VERSION.test(target))) {
  console.error(
    "usage: node scripts/set-version.ts <patch|minor|major|none|x.y.z[-pre]> [package...|all] [--offline] [--github-output]",
  );
  process.exit(1);
}

interface Pkg {
  dir: string;
  file: string;
  text: string;
  name: string;
  version: string;
  deps: string[];
}

const PACKAGES = resolve(import.meta.dirname, "..", "packages");
const pkgs = new Map<string, Pkg>();
for (const dir of readdirSync(PACKAGES).sort()) {
  const file = join(PACKAGES, dir, "package.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const m = JSON.parse(text) as {
    name: string;
    version: string;
    private?: boolean;
    dependencies?: Record<string, string>;
  };
  if (m.private) continue;
  const deps = Object.entries(m.dependencies ?? {})
    .filter(([, v]) => v.startsWith("workspace:"))
    .map(([k]) => k);
  pkgs.set(m.name, { dir, file, text, name: m.name, version: m.version, deps });
}

const all = selection.length === 0 || selection.includes("all");
const selected: Pkg[] = [];
for (const s of all ? [...pkgs.keys()] : selection) {
  const p = pkgs.get(s) ?? pkgs.get(`@truedxf/${s}`);
  if (!p) {
    console.error(
      `unknown or private package: ${s} (publishable: ${[...pkgs.values()].map((x) => x.dir).join(", ")})`,
    );
    process.exit(1);
  }
  if (!selected.includes(p)) selected.push(p);
}

function next(current: string): string {
  if (target === "none") return current;
  if (VERSION.test(target!)) return target!;
  const m = VERSION.exec(current);
  if (!m) throw new Error(`cannot bump ${current}`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const pre = m[4];
  // 1.2.3-rc.1 + patch = 1.2.3 (the pre-release becomes the release), like `npm version`
  if (target === "patch") return pre ? `${maj}.${min}.${pat}` : `${maj}.${min}.${pat + 1}`;
  if (target === "minor") return pre && pat === 0 ? `${maj}.${min}.0` : `${maj}.${min + 1}.0`;
  return pre && min === 0 && pat === 0 ? `${maj}.0.0` : `${maj + 1}.0.0`;
}

const plan = selected.map((p) => ({ pkg: p, from: p.version, to: next(p.version) }));

function published(name: string, version: string): boolean {
  try {
    const out = execFileSync("pnpm", ["view", `${name}@${version}`, "version", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    }).trim();
    return out !== "" && out !== "[]";
  } catch (e) {
    // pnpm view --json reports errors as JSON on stdout and exits 1
    const { stdout, stderr } = e as { stdout?: string; stderr?: string };
    const err = `${stdout ?? ""}${stderr ?? ""}`.trim() || String(e);
    if (/ERR_PNPM_FETCH_404|ERR_PNPM_PACKAGE_NOT_FOUND|E404/.test(err)) return false;
    throw new Error(`registry lookup of ${name}@${version} failed: ${err}`);
  }
}

const errors: string[] = [];
if (!offline) {
  const releasing = new Set(selected.map((p) => p.name));
  for (const { pkg, to } of plan)
    if (target !== "none" && published(pkg.name, to)) errors.push(`${pkg.name}@${to} is already on npm`);
  const checked = new Set<string>();
  for (const { pkg } of plan)
    for (const dep of pkg.deps) {
      if (releasing.has(dep) || checked.has(dep)) continue;
      checked.add(dep);
      const d = pkgs.get(dep);
      if (!d) errors.push(`${pkg.name} depends on ${dep}, which is private`);
      else if (!published(d.name, d.version))
        errors.push(
          `${pkg.name} depends on ${d.name}@${d.version}, which is not on npm: release ${d.dir} too`,
        );
    }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

for (const { pkg, from, to } of plan) {
  if (to !== from) writeFileSync(pkg.file, pkg.text.replace(/"version": "[^"]*"/, `"version": "${to}"`));
  console.log(`${pkg.name}: ${from === to ? to : `${from} -> ${to}`}`);
}

if (githubOutput) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) throw new Error("--github-output needs $GITHUB_OUTPUT");
  const tags = plan.filter((p) => p.to !== p.from).map((p) => `${p.pkg.name}@${p.to}`);
  const filters = plan.map((p) => `--filter ${p.pkg.name}`).join(" ");
  const summary = plan.map((p) => `${p.pkg.name}@${p.to}`).join(", ");
  appendFileSync(out, `tags=${tags.join(" ")}\nfilters=${filters}\nsummary=${summary}\n`);
}
