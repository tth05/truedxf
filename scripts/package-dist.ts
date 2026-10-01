/**
 * Finishes the `tsc -b` output of the publishable packages (run by `pnpm build`):
 * - `.d.ts` files keep the `./x.ts` specifiers of the sources; rewrite them to `./x.js` so
 *   consumers on any TypeScript version / module resolution find the declarations;
 * - `new URL("./worker.ts", import.meta.url)` (the viewer's worker) is a string TS does not
 *   rewrite: point it at the emitted `.js`;
 * - copy the root LICENSE into each package (npm only packs files inside the package folder).
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES = join(ROOT, "packages");

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

const RELATIVE_TS = /(from\s+|import\s*\(\s*|import\s+)(["'])(\.\.?\/[^"']+?)\.ts\2/g;
const URL_TS = /new URL\((["'])(\.\.?\/[^"']+?)\.ts\1,\s*import\.meta\.url\)/g;

let changed = 0;
for (const pkg of readdirSync(PACKAGES).sort()) {
  const dir = join(PACKAGES, pkg);
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) continue;
  const { private: isPrivate } = JSON.parse(readFileSync(manifest, "utf8")) as { private?: boolean };
  if (isPrivate) continue;
  const dist = join(dir, "dist");
  if (!existsSync(dist)) throw new Error(`${pkg}: no dist/ (run tsc -b first)`);
  for (const f of files(dist)) {
    const isDts = f.endsWith(".d.ts");
    if (!isDts && !f.endsWith(".js")) continue;
    const src = readFileSync(f, "utf8");
    let out = src.replace(URL_TS, (_m, q: string, p: string) => `new URL(${q}${p}.js${q}, import.meta.url)`);
    if (isDts)
      out = out.replace(RELATIVE_TS, (_m, kw: string, q: string, p: string) => `${kw}${q}${p}.js${q}`);
    if (out !== src) {
      writeFileSync(f, out);
      changed++;
    }
  }
  copyFileSync(join(ROOT, "LICENSE"), join(dir, "LICENSE"));
}
console.log(`package-dist: ${changed} files rewritten`);
