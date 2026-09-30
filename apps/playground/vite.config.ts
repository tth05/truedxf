import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { BUNDLED_FONT_DIR, FONT_FILE, fontMiddleware, localFontDirs } from "./server/fonts.ts";
import { samplesMiddleware } from "./server/samples.ts";

/** Serves /fonts/* (dev: bundled + local font folders) and copies the bundled fonts into builds. */
function fonts(): Plugin {
  return {
    name: "truedxf-fonts",
    configureServer(server) {
      server.middlewares.use(fontMiddleware(() => [BUNDLED_FONT_DIR, ...localFontDirs()]));
    },
    // `vite preview` is local too (perf and smoke tests)
    configurePreviewServer(server) {
      server.middlewares.use(fontMiddleware(() => [BUNDLED_FONT_DIR, ...localFontDirs()]));
    },
    generateBundle() {
      const names: string[] = [];
      for (const f of readdirSync(BUNDLED_FONT_DIR)) {
        if (!FONT_FILE.test(f)) continue;
        names.push(f.toLowerCase());
        this.emitFile({
          type: "asset",
          fileName: `fonts/${f.toLowerCase()}`,
          source: readFileSync(join(BUNDLED_FONT_DIR, f)),
        });
      }
      this.emitFile({ type: "asset", fileName: "fonts/index.json", source: JSON.stringify(names) });
    },
  };
}

/** Dev / preview only: fixture / corpus API over the local samples/ folder (absent → empty lists). */
function samples(): Plugin {
  return {
    name: "truedxf-samples",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(samplesMiddleware());
    },
    configurePreviewServer(server) {
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
