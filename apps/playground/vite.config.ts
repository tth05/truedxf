import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { BUNDLED_FONT_DIR, fontMiddleware, localFontDirs } from "./server/fonts.ts";
import { samplesMiddleware } from "./server/samples.ts";

/** Serves /fonts/* (dev: bundled + local font folders) and copies the bundled fonts into builds. */
function fonts(): Plugin {
  return {
    name: "truedxf-fonts",
    configureServer(server) {
      server.middlewares.use(fontMiddleware(() => [BUNDLED_FONT_DIR, ...localFontDirs()]));
    },
    generateBundle() {
      for (const f of readdirSync(BUNDLED_FONT_DIR)) {
        if (!/\.(shx|ttf|otf|ttc)$/i.test(f)) continue;
        this.emitFile({
          type: "asset",
          fileName: `fonts/${f.toLowerCase()}`,
          source: readFileSync(join(BUNDLED_FONT_DIR, f)),
        });
      }
    },
  };
}

/** Dev only: fixture / corpus API over the local samples/ folder (absent → empty lists). */
function samples(): Plugin {
  return {
    name: "truedxf-samples",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(samplesMiddleware());
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [fonts(), samples()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 1024 },
  server: { fs: { strict: false } },
});
