/**
 * Font serving for the playground: `/fonts/<file name>` (case-insensitive).
 *
 * - Always: packages/fonts/assets (our own MIT test fonts; copied into the production build).
 * - Dev server only: the local system font folders and the AutoCAD Fonts folder, so real
 *   drawings get real fonts on this machine. Nothing from those folders is ever copied into the
 *   repository or the build output.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

export const BUNDLED_FONT_DIR = join(import.meta.dirname, "..", "..", "..", "packages", "fonts", "assets");

/** Local font folders searched by the dev server (after the bundled fonts). */
export function localFontDirs(): string[] {
  const dirs = [
    process.env.TRUEDXF_FONT_DIRS?.split(";") ?? [],
    "C:\\Windows\\Fonts",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts") : "",
    "C:\\Program Files\\Autodesk\\AutoCAD 2027\\Fonts",
    "/usr/share/fonts/truetype",
    "/Library/Fonts",
  ].flat();
  return dirs.filter((d) => d && existsSync(d));
}

/** Lower-case file name → path over the given folders (first folder wins). */
export function indexFonts(dirs: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of dirs) {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      const k = n.toLowerCase();
      if (!out.has(k)) out.set(k, join(d, n));
    }
  }
  return out;
}

export function fontMiddleware(dirs: () => readonly string[]) {
  let index: Map<string, string> | undefined;
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? "").split("?")[0]!;
    const m = /^\/fonts\/([^/]+)$/.exec(url);
    if (!m) return next();
    index ??= indexFonts(dirs());
    const name = decodeURIComponent(m[1]!).toLowerCase();
    const hit = index.get(name);
    if (!hit) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("cache-control", "max-age=3600");
    res.end(readFileSync(hit));
  };
}
