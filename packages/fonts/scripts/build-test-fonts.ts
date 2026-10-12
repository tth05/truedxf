// Regenerates packages/fonts/assets/*.shx|.shp and truedxf.lin from test-fonts.ts.
// Run: node packages/fonts/scripts/build-test-fonts.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAssets, TEST_LIN } from "./test-fonts.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(out, { recursive: true });
for (const a of buildAssets()) {
    writeFileSync(join(out, `${a.name}.shx`), a.shx);
    writeFileSync(join(out, `${a.name}.shp`), Buffer.from(a.shp, "latin1"));
    console.log(`${a.name}.shx  ${a.shx.length} bytes`);
}
writeFileSync(join(out, "truedxf.lin"), TEST_LIN.replace(/\n/g, "\r\n"));
