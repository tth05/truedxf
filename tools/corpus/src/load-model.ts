/**
 * Loads every DXF of the external corpus into @truedxf/model and reports exceptions, parse
 * diagnostics, entity type coverage and timing. Writes samples/reports/model-load.json.
 *
 *   node tools/corpus/src/load-model.ts [--filter regex] [--limit n]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DxfDocument, type Entity } from "@truedxf/model";
import { EXTERNAL, loadManifest, parseArgs, REPORTS, selectDxf } from "./common.ts";

interface Result {
    path: string;
    ms: number;
    entities: number;
    blocks: number;
    layouts: number;
    unknown: Record<string, number>;
    diagnostics: Record<string, number>;
    error?: string;
}

function walk(entities: readonly Entity[], f: (e: Entity) => void): void {
    for (const e of entities) f(e);
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const files = selectDxf(loadManifest(), args);
    const results: Result[] = [];
    const types: Record<string, number> = {};
    const unknownTypes: Record<string, number> = {};
    let bytes = 0;
    let ms = 0;
    for (const rec of files) {
        const data = new Uint8Array(readFileSync(join(EXTERNAL, rec.path)));
        const r: Result = {
            path: rec.path,
            ms: 0,
            entities: 0,
            blocks: 0,
            layouts: 0,
            unknown: {},
            diagnostics: {},
        };
        try {
            const t = performance.now();
            const doc = DxfDocument.load(data);
            r.ms = performance.now() - t;
            bytes += data.length;
            ms += r.ms;
            r.blocks = doc.blocks.length;
            r.layouts = doc.layouts.length;
            for (const b of doc.blocks) {
                walk(b.entities, (e) => {
                    r.entities++;
                    types[e.type] = (types[e.type] ?? 0) + 1;
                    if (e.type === "UNKNOWN") {
                        r.unknown[e.dxfType] = (r.unknown[e.dxfType] ?? 0) + 1;
                        unknownTypes[e.dxfType] = (unknownTypes[e.dxfType] ?? 0) + 1;
                    }
                });
            }
            r.diagnostics = doc.diagnostics.summary();
        } catch (e) {
            r.error =
                e instanceof Error
                    ? `${e.name}: ${e.message}\n${e.stack?.split("\n").slice(1, 4).join("\n")}`
                    : String(e);
        }
        results.push(r);
    }
    const errors = results.filter((r) => r.error);
    const diagFiles: Record<string, number> = {};
    for (const r of results)
        for (const k of Object.keys(r.diagnostics)) diagFiles[k] = (diagFiles[k] ?? 0) + 1;
    const sort = (m: Record<string, number>) =>
        Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
    const summary = {
        files: results.length,
        exceptions: errors.length,
        mbPerSecond: +(bytes / 1e6 / (ms / 1000)).toFixed(1),
        entityTypes: sort(types),
        unknownTypes: sort(unknownTypes),
        filesWithDiagnostic: sort(diagFiles),
    };
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(
        args.out ?? join(REPORTS, "model-load.json"),
        JSON.stringify({ summary, results }, null, 1),
    );
    console.log(JSON.stringify(summary, null, 2));
    for (const r of errors.slice(0, 15)) console.log(`EXC ${r.path}: ${r.error}`);
}

main();
