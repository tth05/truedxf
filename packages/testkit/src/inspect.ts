/**
 * Prints what the frontend could not render for fixtures (entity types, features), without a
 * browser:  node packages/testkit/src/inspect.ts <suite>[/<case>] …
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadDxf } from "@truedxf/model";
import { renderPlot } from "@truedxf/render";

const ROOT = resolve(import.meta.dirname, "../../..");
const GEN = join(ROOT, "samples", "generated");

for (const arg of process.argv.slice(2)) {
  const [suite, name] = arg.split("/");
  const dir = join(GEN, suite!);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && (!name || x === `${name}.json`))) {
    const meta = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const doc = loadDxf(new Uint8Array(readFileSync(join(dir, f.replace(/\.json$/, ".dxf")))));
    const types: Record<string, number> = {};
    for (const e of doc.modelSpace.entities) types[e.type] = (types[e.type] ?? 0) + 1;
    const r = await renderPlot(doc, meta.plot);
    console.log(meta.id, JSON.stringify(types), "unsupported:", JSON.stringify(r.unsupported));
  }
}
