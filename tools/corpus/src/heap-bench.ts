/** Retained document memory, isolated per file/run. Run with node --expose-gc. */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeHeapSnapshot } from "node:v8";
import { DxfDocument } from "@truedxf/model";
import { resolveBenchPaths } from "./bench-set.ts";

const argv = process.argv.slice(2);
const option = (flag: string) => argv[argv.indexOf(flag) + 1];
const has = (flag: string) => argv.includes(flag);
const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
if (!gc) throw new Error("run with node --expose-gc");
if (has("--file")) {
    // File bytes precede the baseline: the deltas measure load's allocations only.
    const bytes = readFileSync(option("--file")!);
    gc();
    gc();
    const before = process.memoryUsage();
    const start = performance.now();
    const doc = DxfDocument.load(bytes);
    const loadMs = performance.now() - start;
    gc();
    gc();
    const after = process.memoryUsage();
    let entities = 0;
    let topLevelEntities = 0;
    for (const block of doc.blocks) {
        topLevelEntities += block.entities.length;
        for (const entity of block.entities) {
            entities++;
            if (entity.type === "POLYLINE") entities += entity.vertices.length;
            if (entity.type === "INSERT") entities += entity.attribs.length;
        }
    }
    const heapBytes = after.heapUsed - before.heapUsed;
    console.log(
        JSON.stringify({
            fileBytes: bytes.byteLength,
            entities,
            topLevelEntities,
            loadMs,
            heapBytes,
            externalBytes: after.external - before.external,
            arrayBufferBytes: after.arrayBuffers - before.arrayBuffers,
            bytesPerEntity: heapBytes / entities,
        }),
    );
    if (has("--snapshot")) writeHeapSnapshot(option("--snapshot"));
    // Keep the document live through GC and snapshot generation.
    if (doc.tags.store.count === 0) throw new Error("empty document");
} else {
    const runs = has("--runs") ? Number(option("--runs")) : 3;
    if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("--runs must be positive");
    const only = has("--only") ? new RegExp(option("--only")!, "i") : undefined;
    const rows = [];
    for (const [name, path] of resolveBenchPaths()) {
        if (only && !only.test(name)) continue;
        const measurements = [];
        for (let run = 0; run < runs; run++) {
            const child = spawnSync(
                process.execPath,
                [
                    "--disable-warning=ExperimentalWarning",
                    "--expose-gc",
                    "--max-old-space-size=16000",
                    fileURLToPath(import.meta.url),
                    "--file",
                    path,
                    ...(has("--snapshot") && run === 0 ? ["--snapshot", option("--snapshot")!] : []),
                ],
                { encoding: "utf8", maxBuffer: 1024 * 1024 },
            );
            if (child.status !== 0) throw new Error(child.stderr || String(child.error));
            measurements.push(JSON.parse(child.stdout) as Record<string, number>);
        }
        const median: Record<string, number> = {};
        for (const key of Object.keys(measurements[0]!))
            median[key] = measurements.map((m) => m[key]!).sort((x, y) => x - y)[runs >> 1]!;
        const row = { name, ...median, runs: measurements };
        rows.push(row);
        console.log(JSON.stringify(row));
    }
    if (has("--json")) writeFileSync(option("--json")!, `${JSON.stringify(rows, null, 2)}\n`);
}
