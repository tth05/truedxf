// Codec for Autodesk "PIA" files (PC3 plotter configs, PMP model parameters, CTB/STB plot styles).
//
// Container (research/notes/08 §5.3, verified on the AutoCAD 2027 install files):
//   48 bytes  ASCII "PIAFILEVERSION_2.0,<TYPE>VER1,compress\r\npmzlibcodec"   (TYPE = PC3 for .pc3 AND .pmp)
//   12 bytes  uint32 LE: adler32(compressed body), length(plain text), length(compressed body)
//   rest      zlib stream of the plain text
// AutoCAD 2027 also ships a new "PIAFILEVERSION_3.0,json" (uncompressed JSON) variant; we only write v2.
//
// Plain text: one entry per line, indented by one space per nesting level:
//   key=value        value is raw text; strings start with `"` and have NO closing quote
//   key{  ...  }     nested section
// Floats >= 1e5 or with many digits carry a trailing ` (xxxxxxxxxxxxxx)` token: a uuencode-style
// encoding of the exact little-endian IEEE double (+ 16 bits of an unknown checksum). The token is
// optional on read; we never write it (AutoCAD accepts plain decimals, verified by `?` listing).

import { deflateSync, inflateSync } from "node:zlib";

export type PiaNode = { key: string; value?: string; children?: PiaNode[] };

const HEADER_V2 = (type: string) => `PIAFILEVERSION_2.0,${type}VER1,compress\r\npmzlibcodec`;

export function adler32(buf: Uint8Array): number {
    let a = 1;
    let b = 0;
    for (let i = 0; i < buf.length; i++) {
        a = (a + buf[i]!) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
}

export function decodePia(file: Buffer): { type: string; text: string } {
    const head = file.subarray(0, 48).toString("latin1");
    const m = /^PIAFILEVERSION_2\.0,(\w+)VER1,compress\r\npmzlibcodec$/.exec(head);
    if (!m) throw new Error(`not a PIA v2 file (header ${JSON.stringify(head.slice(0, 30))})`);
    const plain = inflateSync(file.subarray(60));
    let text = plain.toString("latin1");
    // Some files (DWG To PDF.pc3) end with a NUL byte.
    text = text.replace(/\0+$/, "");
    return { type: m[1]!, text };
}

export function encodePia(type: string, text: string): Buffer {
    const plain = Buffer.from(text, "latin1");
    const comp = deflateSync(plain, { level: 9 });
    const header = Buffer.alloc(60);
    header.write(HEADER_V2(type), 0, "latin1");
    header.writeUInt32LE(adler32(comp), 48);
    header.writeUInt32LE(plain.length, 52);
    header.writeUInt32LE(comp.length, 56);
    return Buffer.concat([header, comp]);
}

export function parsePiaText(text: string): PiaNode[] {
    const root: PiaNode = { key: "", children: [] };
    const stack: PiaNode[] = [root];
    for (const raw of text.split("\n")) {
        const line = raw.replace(/\r$/, "").trimStart();
        if (line === "") continue;
        const top = stack[stack.length - 1]!;
        if (line === "}") {
            stack.pop();
            if (stack.length === 0) throw new Error("unbalanced }");
            continue;
        }
        if (line.endsWith("{") && !line.includes("=")) {
            const node: PiaNode = { key: line.slice(0, -1), children: [] };
            top.children!.push(node);
            stack.push(node);
            continue;
        }
        const eq = line.indexOf("=");
        if (eq < 0) throw new Error(`bad PIA line: ${line}`);
        top.children!.push({ key: line.slice(0, eq), value: line.slice(eq + 1) });
    }
    if (stack.length !== 1) throw new Error("unterminated section");
    return root.children!;
}

export function formatPiaText(nodes: PiaNode[], depth = 0): string {
    let out = "";
    const pad = " ".repeat(depth);
    for (const n of nodes) {
        if (n.children) {
            out += `${pad}${n.key}{\n${formatPiaText(n.children, depth + 1)}${pad}}\n`;
        } else {
            out += `${pad}${n.key}=${n.value ?? ""}\n`;
        }
    }
    return out;
}

/** Find a child section/entry by a slash path, e.g. "media/size/name". */
export function piaGet(nodes: PiaNode[], path: string): PiaNode | undefined {
    let cur: PiaNode | undefined;
    let list = nodes;
    for (const part of path.split("/")) {
        cur = list.find((n) => n.key === part);
        if (!cur) return undefined;
        list = cur.children ?? [];
    }
    return cur;
}

export function piaSet(nodes: PiaNode[], path: string, value: string): void {
    const n = piaGet(nodes, path);
    if (!n || n.children) throw new Error(`no PIA value at ${path}`);
    n.value = value;
}

export const str = (s: string) => `"${s}`;
export const bool = (b: boolean) => (b ? "TRUE" : "FALSE");
/** Floats are written like AutoCAD's short form: integral values as "123.0". */
export function num(x: number): string {
    return Number.isInteger(x) ? `${x}.0` : String(x);
}
export const sec = (key: string, children: PiaNode[]): PiaNode => ({ key, children });
export const val = (key: string, value: string): PiaNode => ({ key, value });
