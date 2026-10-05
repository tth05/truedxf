import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import {
  BUNDLED_FONT_DIR,
  FALLBACK_FONT_DIR,
  FONT_FILE,
  fontMiddleware,
  localFontDirs,
} from "./server/fonts.ts";
import { pdfjsFiles, pdfjsMiddleware } from "./server/pdfjs.ts";
import { samplesMiddleware } from "./server/samples.ts";

/**
 * Build modes:
 * - default (`vite`, `vite build`, `vite preview`): the development app, with the Fixtures /
 *   Corpus modes over the local samples/ folder (perf script, smoke test);
 * - `public` (`vite build --mode public`): the deployed site. No samples code, no sourcemaps,
 *   canonical URL / sitemap for `SITE_URL`, Cloudflare Pages `_headers`.
 */
const PUBLIC_MODE = "public";
/** Production URL of the public site (canonical link, Open Graph, sitemap). */
const SITE_URL = (process.env.SITE_URL ?? "https://truedxf.pages.dev").replace(/\/+$/, "");
/** Repository (links, "Report a problem"). */
const REPO_URL = process.env.REPO_URL ?? "https://github.com/tth05/truedxf";

/** Serves /fonts/* (dev: bundled + local font folders) and copies the bundled fonts into builds. */
function fonts(): Plugin {
  const served = () => [BUNDLED_FONT_DIR, ...localFontDirs(), FALLBACK_FONT_DIR];
  return {
    name: "truedxf-fonts",
    configureServer(server) {
      server.middlewares.use(fontMiddleware(served));
    },
    // `vite preview` is local too (perf and smoke tests)
    configurePreviewServer(server) {
      server.middlewares.use(fontMiddleware(served));
    },
    generateBundle() {
      const names: string[] = [];
      for (const dir of [BUNDLED_FONT_DIR, FALLBACK_FONT_DIR])
        for (const f of readdirSync(dir).sort()) {
          if (!FONT_FILE.test(f)) continue;
          names.push(f.toLowerCase());
          this.emitFile({
            type: "asset",
            fileName: `fonts/${f.toLowerCase()}`,
            source: readFileSync(join(dir, f)),
          });
        }
      // the OFL travels with the fonts (fonts/README.md)
      for (const f of readdirSync(FALLBACK_FONT_DIR).sort())
        if (/^LICENSE-.*\.txt$/.test(f))
          this.emitFile({
            type: "asset",
            fileName: `fonts/${f}`,
            source: readFileSync(join(FALLBACK_FONT_DIR, f)),
          });
      this.emitFile({ type: "asset", fileName: "fonts/index.json", source: JSON.stringify(names) });
    },
  };
}

/** PDF.js support files for PDF underlays under /pdfjs/ (server/pdfjs.ts), served and copied into builds. */
function pdfjs(): Plugin {
  return {
    name: "truedxf-pdfjs",
    configureServer(server) {
      server.middlewares.use(pdfjsMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(pdfjsMiddleware());
    },
    generateBundle() {
      for (const [path, file] of pdfjsFiles())
        this.emitFile({ type: "asset", fileName: `pdfjs/${path}`, source: readFileSync(file) });
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

/**
 * Build stamp: short commit (+ "-dirty") and date, shown to people; `id` tells deployments
 * apart (version.json, src/update.ts), so it changes with every build.
 */
let stamp: { commit: string; date: string; id: string } | undefined;
function buildInfo(): { commit: string; date: string; id: string } {
  if (stamp) return stamp;
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", args, { cwd: import.meta.dirname, encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  const commit = git("rev-parse", "--short", "HEAD") || "unknown";
  const dirty = git("status", "--porcelain") !== "";
  const now = new Date().toISOString();
  stamp = { commit: dirty ? `${commit}-dirty` : commit, date: now.slice(0, 10), id: `${commit}@${now}` };
  return stamp;
}

/**
 * `%SITE_URL%` / `%REPO_URL%` in index.html; robots.txt, sitemap.xml, _headers, 404.html and
 * version.json for the public site.
 */
function site(isPublic: boolean): Plugin {
  return {
    name: "truedxf-site",
    transformIndexHtml: {
      // before Vite's own %ENV% replacement, which warns about unknown names
      order: "pre",
      handler(html) {
        let out = html.replaceAll("%SITE_URL%", SITE_URL).replaceAll("%REPO_URL%", REPO_URL);
        // only the deployed site claims a canonical URL; local builds must not
        if (!isPublic) out = out.replace(/\s*<link rel="canonical"[^>]*>/, "");
        return out;
      },
    },
    generateBundle() {
      if (!isPublic) return;
      const asset = (fileName: string, source: string) => this.emitFile({ type: "asset", fileName, source });
      asset("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
      asset(
        "sitemap.xml",
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          `  <url><loc>${SITE_URL}/</loc><lastmod>${buildInfo().date}</lastmod></url>\n</urlset>\n`,
      );
      asset("_headers", readFileSync(join(import.meta.dirname, "cloudflare", "_headers"), "utf8"));
      // Without a top-level 404.html, Cloudflare Pages treats the site as a single-page app and
      // answers every unknown path with index.html and status 200: search engines see duplicate
      // pages, and a tab left open across a deploy gets HTML for its old (deleted) chunks.
      asset("404.html", readFileSync(join(import.meta.dirname, "cloudflare", "404.html"), "utf8"));
      // what the running page compares its own build id with (src/update.ts)
      asset("version.json", JSON.stringify({ id: buildInfo().id }));
    },
  };
}

export default defineConfig(({ mode }) => {
  const isPublic = mode === PUBLIC_MODE;
  return {
    root: import.meta.dirname,
    base: "./",
    plugins: [fonts(), pdfjs(), samples(), site(isPublic)],
    define: {
      __SAMPLES__: JSON.stringify(!isPublic),
      __UPDATES__: JSON.stringify(isPublic),
      __BUILD__: JSON.stringify({ ...buildInfo(), repo: REPO_URL }),
    },
    worker: { format: "es" },
    build: { target: "es2022", sourcemap: !isPublic, chunkSizeWarningLimit: 1024 },
    server: { fs: { strict: false } },
  };
});
