/** Summarize V8 snapshot shallow sizes by object kind, excluding backing-store bytes. */
import { readFileSync, writeFileSync } from "node:fs";

type Snapshot = {
    snapshot: {
        meta: {
            node_fields: string[];
            node_types: (string[] | string)[];
            edge_fields: string[];
            edge_types: (string[] | string)[];
        };
    };
    nodes: number[];
    edges: number[];
    strings: string[];
};
// Large snapshots exceed V8's single-string limit. Decode the flat arrays separately.
const bytes = readFileSync(process.argv[2]!);
const nodesKey = bytes.indexOf(Buffer.from('"nodes":'));
const prefix = bytes.subarray(0, nodesKey).toString("utf8").trimEnd();
const metadata = JSON.parse(`${prefix.slice(0, -1)}}`) as Pick<Snapshot, "snapshot">;
function array(key: string, strings = false): unknown {
    const marker = Buffer.from(`"${key}":`);
    const start = bytes.indexOf(marker) + marker.length;
    const end = strings ? bytes.lastIndexOf(93) : bytes.indexOf(93, start);
    return JSON.parse(bytes.subarray(start, end + 1).toString("utf8"));
}
const snapshot: Snapshot = {
    ...metadata,
    nodes: array("nodes") as number[],
    edges: array("edges") as number[],
    strings: array("strings", true) as string[],
};
const fields = snapshot.snapshot.meta.node_fields;
const types = snapshot.snapshot.meta.node_types[0] as string[];
const typeIndex = fields.indexOf("type");
const nameIndex = fields.indexOf("name");
const sizeIndex = fields.indexOf("self_size");
const countIndex = fields.indexOf("edge_count");
const edgeFields = snapshot.snapshot.meta.edge_fields;
const edgeTypes = snapshot.snapshot.meta.edge_types[0] as string[];
const edgeType = edgeFields.indexOf("type");
const edgeName = edgeFields.indexOf("name_or_index");
let edgeOffset = 0;
const groups = new Map<string, { count: number; bytes: number }>();
for (let i = 0; i < snapshot.nodes.length; i += fields.length) {
    const type = types[snapshot.nodes[i + typeIndex]!]!;
    const name = snapshot.strings[snapshot.nodes[i + nameIndex]!]!;
    const count = snapshot.nodes[i + countIndex]!;
    const keys: string[] = [];
    if (type === "object" && name === "Object") {
        for (let j = edgeOffset; j < edgeOffset + count * edgeFields.length; j += edgeFields.length)
            if (edgeTypes[snapshot.edges[j + edgeType]!] === "property") {
                const property = snapshot.strings[snapshot.edges[j + edgeName]!]!;
                if (property !== "__proto__") keys.push(property);
            }
    }
    edgeOffset += count * edgeFields.length;
    const key = `${type}: ${name.length > 100 ? "(long name)" : name}${keys.length ? ` {${keys.join(",")}}` : ""}`;
    const row = groups.get(key) ?? { count: 0, bytes: 0 };
    row.count++;
    row.bytes += snapshot.nodes[i + sizeIndex]!;
    groups.set(key, row);
}
const rows = [...groups].map(([kind, row]) => ({ kind, ...row })).sort((a, b) => b.bytes - a.bytes);
const output = `${JSON.stringify(rows.slice(0, 50), null, 2)}\n`;
console.log(output);
if (process.argv[3]) writeFileSync(process.argv[3], output);
