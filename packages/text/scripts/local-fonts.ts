/** Node-only font setup for scripts and local tests: truedxf test fonts, Windows fonts, AutoCAD fonts. */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { DirectoryFontProvider, FontManager, type FontProvider } from "@truedxf/fonts";

export const FONT_DIRS = [
  new URL("../../fonts/assets/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  "C:/Windows/Fonts",
  "C:/Program Files/Autodesk/AutoCAD 2027/Fonts",
].filter((d) => existsSync(d));

/**
 * `hide`: font files to treat as missing — e.g. /^liberation/i to mimic a reference machine whose
 * AutoCAD session did not see the Liberation fonts (they plot in FONTALT = simplex.shx).
 */
export function localFontManager(hide?: RegExp): FontManager {
  const dir = new DirectoryFontProvider(FONT_DIRS, {
    readDir: (d) => readdir(d),
    readFile: async (p) => new Uint8Array(await readFile(p)),
  });
  const provider: FontProvider = hide
    ? {
        getFile: (n) => (hide.test(n) ? Promise.resolve(undefined) : dir.getFile(n)),
        listFiles: async () => (await dir.listFiles()).filter((n) => !hide.test(n)),
      }
    : dir;
  return new FontManager(provider, { fontAlt: "simplex.shx", glyphFallbacks: ["arial.ttf"] });
}
