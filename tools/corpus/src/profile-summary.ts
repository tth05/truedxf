/** Compare sampled self/inclusive CPU in model accessors during ViewerCore rendering. */
import { readFileSync, writeFileSync } from "node:fs";

interface Frame {
    functionName: string;
    url: string;
    lineNumber: number;
}
interface ProfileNode {
    id: number;
    callFrame: Frame;
    children?: number[];
}
interface Profile {
    nodes: ProfileNode[];
    samples: number[];
    timeDeltas: number[];
}
interface Row {
    name: string;
    file: string;
    line: number;
    selfMs: number;
    inclusiveMs: number;
    renderSelfMs: number;
    renderInclusiveMs: number;
}

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--json");
const output = outputIndex >= 0 ? args.splice(outputIndex, 2)[1] : undefined;
const summaries = args.map((path) => {
    const profile = JSON.parse(readFileSync(path, "utf8")) as Profile;
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const parents = new Map<number, number>();
    for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
    const rows = new Map<string, Row>();
    let totalMs = 0;
    let renderMs = 0;
    let unscopedGcMs = 0;
    for (let i = 0; i < profile.samples.length; i++) {
        const sample = profile.samples[i]!;
        const ms = profile.timeDeltas[i]! / 1000;
        const stack: ProfileNode[] = [];
        for (let id: number | undefined = sample; id !== undefined; id = parents.get(id)) {
            const node = nodes.get(id);
            if (node) stack.push(node);
        }
        totalMs += ms;
        // GC samples commonly have only a root frame: don't claim they belong to rendering.
        if (stack[0]?.callFrame.functionName === "(garbage collector)") unscopedGcMs += ms;
        const rendering = stack.some(
            ({ callFrame: f }) =>
                (f.functionName === "render" && f.url.endsWith("/packages/viewer/src/protocol.ts")) ||
                // renderPlot resumes after awaited font preparation without ViewerCore's stack.
                (f.functionName === "renderPlot" && f.url.endsWith("/packages/render/src/frontend.ts")),
        );
        if (rendering) renderMs += ms;
        // Recursive instances of a function count once towards its inclusive samples.
        const visited = new Set<string>();
        for (const node of stack) {
            const f = node.callFrame;
            const key = `${f.url}:${f.lineNumber}:${f.functionName}`;
            if (visited.has(key)) continue;
            visited.add(key);
            let row = rows.get(key);
            if (!row) {
                row = {
                    name: f.functionName,
                    file: f.url,
                    line: f.lineNumber + 1,
                    selfMs: 0,
                    inclusiveMs: 0,
                    renderSelfMs: 0,
                    renderInclusiveMs: 0,
                };
                rows.set(key, row);
            }
            row.inclusiveMs += ms;
            if (node.id === sample) row.selfMs += ms;
            if (rendering) {
                row.renderInclusiveMs += ms;
                if (node.id === sample) row.renderSelfMs += ms;
            }
        }
    }
    const sorted = [...rows.values()].sort((a, b) => b.renderSelfMs - a.renderSelfMs);
    const summary = { path, totalMs, renderMs, unscopedGcMs, rows: sorted };
    console.log(path, JSON.stringify({ totalMs, renderMs, unscopedGcMs }));
    for (const row of sorted.filter((row) => row.file.includes("/packages/model/") && row.renderInclusiveMs))
        console.log(
            `${row.name.padEnd(22)} self ${row.renderSelfMs.toFixed(1)} ms, inclusive ${row.renderInclusiveMs.toFixed(1)} ms (${row.file.split("/").pop()}:${row.line})`,
        );
    return summary;
});
if (output) writeFileSync(output, `${JSON.stringify(summaries, null, 2)}\n`);
