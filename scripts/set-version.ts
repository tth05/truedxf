/**
 * Sets the version of every publishable package (all @truedxf/* packages move together):
 *   node scripts/set-version.ts 0.1.0
 * Workspace dependencies stay `workspace:*`; pnpm replaces them with this version on publish.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: node scripts/set-version.ts <major.minor.patch[-pre]>");
  process.exit(1);
}
const PACKAGES = resolve(import.meta.dirname, "..", "packages");
for (const pkg of readdirSync(PACKAGES).sort()) {
  const file = join(PACKAGES, pkg, "package.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const m = JSON.parse(text) as { name: string; version: string; private?: boolean };
  if (m.private) continue;
  writeFileSync(file, text.replace(/"version": "[^"]*"/, `"version": "${version}"`));
  console.log(`${m.name}: ${m.version} -> ${version}`);
}
