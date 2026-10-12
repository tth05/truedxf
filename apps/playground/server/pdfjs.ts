/**
 * PDF.js support files for PDF underlays (`/pdfjs/…`, `DxfViewer` option `pdf.assetsUrl`):
 * pdfjs-dist's standard fonts (PDFs that use the 14 standard fonts without embedding them),
 * CMaps (CJK text), wasm image decoders (JPEG 2000, JBIG2) and colour profiles. Served by the dev
 * server and copied into every build; the browser fetches them only for PDFs that need them.
 * Licences (Apache-2.0, BSD, MIT, CC0) travel along: LICENSE plus the ones in each folder.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** pdfjs-dist as resolved by @truedxf/pdf (its dependency). */
const PDFJS_DIR = dirname(
    createRequire(join(import.meta.dirname, "..", "..", "..", "packages", "pdf", "package.json")).resolve(
        "pdfjs-dist/package.json",
    ),
);
const FOLDERS = ["standard_fonts", "cmaps", "wasm", "iccs"];
/** The scripting sandbox (form JavaScript) is never used for underlays. */
const SKIP = /^quickjs/;

/** Published path (below `pdfjs/`) → file on disk. */
export function pdfjsFiles(): Map<string, string> {
    const out = new Map<string, string>([["LICENSE", join(PDFJS_DIR, "LICENSE")]]);
    for (const folder of FOLDERS) {
        const dir = join(PDFJS_DIR, folder);
        for (const name of readdirSync(dir).sort()) {
            if (SKIP.test(name) || !statSync(join(dir, name)).isFile()) continue;
            out.set(`${folder}/${name}`, join(dir, name));
        }
    }
    return out;
}

const TYPES: Record<string, string> = {
    ".wasm": "application/wasm",
    ".js": "text/javascript",
    ".ttf": "font/ttf",
};

/** Dev / preview server: `/pdfjs/<path>`. */
export function pdfjsMiddleware(): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
    let files: Map<string, string> | undefined;
    return (req, res, next) => {
        const m = /^\/pdfjs\/([^?]+)/.exec(req.url ?? "");
        if (!m) return next();
        files ??= pdfjsFiles();
        const file = files.get(decodeURIComponent(m[1]!));
        if (!file) return next();
        const ext = /\.[^.]+$/.exec(file)?.[0] ?? "";
        res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream");
        res.end(readFileSync(file));
    };
}
