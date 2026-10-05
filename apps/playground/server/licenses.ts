/**
 * Third-party notices of a build (`licenses.txt`): every npm package with a module in the
 * JavaScript output (main bundle and the worker bundles), with its version, licence and licence
 * file text. MIT/ISC/BSD/Apache-2.0 require the notice to travel with copies of the code.
 * Reads node_modules only, never samples/.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export interface PackageNotice {
  name: string;
  version: string;
  license: string;
  /** Licence / notice files of the package root, sorted by file name. */
  files: { name: string; text: string }[];
}

/** LICENSE, LICENCE, COPYING, NOTICE (any case, any extension: LICENSE.md, LICENSE-MIT, …). */
const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i;

/** The package root of a bundled module file, or undefined for virtual and non-npm modules. */
function packageRoot(file: string, roots: Map<string, string | undefined>): string | undefined {
  // only node_modules: workspace packages (@truedxf/*, the app) are our own MIT code
  if (!/[\\/]node_modules[\\/]/.test(file)) return undefined;
  let dir = dirname(file);
  const visited: string[] = [];
  let found: string | undefined;
  for (;;) {
    if (roots.has(dir)) {
      found = roots.get(dir);
      break;
    }
    visited.push(dir);
    const pkg = join(dir, "package.json");
    // nested package.json files without name/version (`{"type": "module"}`) are not roots
    if (existsSync(pkg)) {
      const json = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string; version?: string };
      if (json.name && json.version) {
        found = dir;
        break;
      }
    }
    const parent = dirname(dir);
    if (parent === dir || /[\\/]node_modules$/.test(dir)) break;
    dir = parent;
  }
  for (const d of visited) roots.set(d, found);
  return found;
}

function readNotice(root: string): PackageNotice {
  const json = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name: string;
    version: string;
    license?: string | { type?: string };
    licenses?: { type?: string }[];
  };
  const license =
    (typeof json.license === "string" ? json.license : json.license?.type) ??
    json.licenses?.map((l) => l.type).join(" OR ") ??
    "UNKNOWN";
  const files = readdirSync(root)
    .filter((f) => LICENSE_FILE.test(f) && statSync(join(root, f)).isFile())
    .sort()
    .map((name) => ({
      name,
      text: readFileSync(join(root, name), "utf8").replace(/\r\n?/g, "\n").trimEnd(),
    }));
  return { name: json.name, version: json.version, license, files };
}

/** Notices for the given bundled module ids, sorted by name and version, one per package. */
export function packageNotices(moduleIds: Iterable<string>): PackageNotice[] {
  const roots = new Map<string, string | undefined>();
  const found = new Set<string>();
  for (const id of moduleIds) {
    // virtual modules ("\0…") and query suffixes ("?worker", "?commonjs-…")
    if (id.startsWith("\0")) continue;
    const root = packageRoot(id.replace(/[?#].*$/, ""), roots);
    if (root) found.add(root);
  }
  const notices = new Map<string, PackageNotice>();
  for (const root of found) {
    const n = readNotice(root);
    notices.set(`${n.name}@${n.version}`, n);
  }
  return [...notices.values()].sort((a, b) =>
    a.name !== b.name
      ? a.name < b.name
        ? -1
        : 1
      : a.version < b.version
        ? -1
        : a.version > b.version
          ? 1
          : 0,
  );
}

const RULE = "=".repeat(78);

/** `licenses.txt`: a list of the packages, then each package's licence files. */
export function formatNotices(notices: PackageNotice[], repoUrl: string): string {
  const out = [
    "Third-party software in this site's JavaScript",
    "",
    `truedxf itself is MIT licensed (${repoUrl}). The JavaScript of this site also`,
    "contains the following packages, under their own licences reproduced below. The fonts",
    "(fonts/LICENSE-*.txt) and PDF.js support files (pdfjs/LICENSE) carry their own licence files.",
    "",
    ...notices.map((n) => `  ${n.name} ${n.version} (${n.license})`),
    "",
  ];
  for (const n of notices) {
    out.push(RULE, `${n.name} ${n.version}`, `License: ${n.license}`, RULE, "");
    if (n.files.length === 0) out.push("(the package contains no licence file)", "");
    for (const f of n.files) out.push(`--- ${f.name} ---`, "", f.text, "");
  }
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
