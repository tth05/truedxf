/**
 * Raster image file lookup for fixtures (Node side; the browser harness asks the server, which
 * uses the same function). IMAGEDEF paths are tried as written (absolute), then relative to the
 * fixture folder, then as a bare file name in the fixture folder (note 07 §8.2, ezdxf order).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

const RASTER = /\.(png|jpe?g|bmp|tiff?|pdf)$/i;

export function findImageFile(path: string, fixtureDir: string): string | undefined {
  const p = path.replaceAll("\\", "/");
  // raster / underlay files only: the harness server must not hand out arbitrary files
  if (!RASTER.test(p)) return undefined;
  const bare = basename(p);
  const tries = [
    isAbsolute(p) || /^[a-z]:\//i.test(p) ? p : undefined,
    join(fixtureDir, p),
    join(fixtureDir, bare),
  ];
  for (const t of tries) {
    if (t && existsSync(t) && statSync(t).isFile()) return t;
  }
  return undefined;
}

/** A `RenderEnv.loadImage` for fixtures in `fixtureDir`. */
export function nodeImageLoader(fixtureDir: string): (path: string) => Promise<Uint8Array | undefined> {
  return async (path) => {
    const f = findImageFile(path, fixtureDir);
    return f ? new Uint8Array(readFileSync(f)) : undefined;
  };
}
