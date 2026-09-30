import { readFileSync } from "node:fs";
import { loadDxf } from "@truedxf/model";

for (const f of process.argv.slice(2)) {
  const d = loadDxf(new Uint8Array(readFileSync(f)));
  for (const e of d.modelSpace.entities)
    if (e.type !== "LINE") {
      const { record, ...rest } = e as any;
      console.log(f.split("/").pop(), JSON.stringify(rest));
    }
}
