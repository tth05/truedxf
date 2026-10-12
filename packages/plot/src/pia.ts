// Codec for Autodesk "PIA" files: PC3 plotter configs, PMP model parameters, CTB/STB plot styles
// (note 06 §6.3, note 08 §5.3; container layout verified on the AutoCAD 2027 install files, see
// tools/acad/README.md "PIA file format").
//
//   48 bytes  ASCII "PIAFILEVERSION_2.0,<TYPE>VER1,compress\r\npmzlibcodec"  (TYPE: PC3 also for .pmp, CTB, STB)
//   12 bytes  uint32 LE: adler32(compressed body), length(plain text), length(compressed body)
//   rest      zlib stream of latin-1 text
//
// Text: one entry per line, indented by one space per nesting level. `key=value` (string values
// start with `"` and have no closing quote) or `key{` … `}` sections. Large floats may carry a
// trailing ` (xxxxxxxxxxxxxx)` token with the exact double; it is optional and ignored on read.

import { unzlibSync, zlibSync } from "fflate";

export interface PiaNode {
    readonly key: string;
    readonly value?: string;
    readonly children?: PiaNode[];
}

export interface PiaFile {
    /** "PC3", "CTB", "STB", … */
    readonly type: string;
    readonly text: string;
}

const HEADER_LENGTH = 60;
const MAGIC = /^PIAFILEVERSION_2\.0,(\w+)VER1,compress\r\npmzlibcodec$/;

export function adler32(buf: Uint8Array): number {
    let a = 1;
    let b = 0;
    for (let i = 0; i < buf.length; i++) {
        a = (a + buf[i]!) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
}

function latin1(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192)
        s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    return s;
}

function toLatin1(text: string): Uint8Array {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
}

export function decodePia(file: Uint8Array): PiaFile {
    const head = latin1(file.subarray(0, 48));
    const m = MAGIC.exec(head);
    if (!m) throw new Error(`not a PIA v2 file (header ${JSON.stringify(head.slice(0, 30))})`);
    // Some files (DWG To PDF.pc3) end with a NUL byte.
    const text = latin1(unzlibSync(file.subarray(HEADER_LENGTH))).replace(/\0+$/, "");
    return { type: m[1]!, text };
}

export function encodePia(type: string, text: string): Uint8Array {
    const plain = toLatin1(text);
    const comp = zlibSync(plain, { level: 9 });
    const out = new Uint8Array(HEADER_LENGTH + comp.length);
    out.set(toLatin1(`PIAFILEVERSION_2.0,${type}VER1,compress\r\npmzlibcodec`));
    const view = new DataView(out.buffer);
    view.setUint32(48, adler32(comp), true);
    view.setUint32(52, plain.length, true);
    view.setUint32(56, comp.length, true);
    out.set(comp, HEADER_LENGTH);
    return out;
}

export function parsePiaText(text: string): PiaNode[] {
    const root: PiaNode[] = [];
    const stack: PiaNode[][] = [root];
    for (const raw of text.split("\n")) {
        const line = raw.replace(/\r$/, "").trimStart();
        if (line === "") continue;
        const top = stack[stack.length - 1]!;
        if (line === "}") {
            if (stack.length === 1) throw new Error("unbalanced } in PIA text");
            stack.pop();
            continue;
        }
        if (line.endsWith("{") && !line.includes("=")) {
            const children: PiaNode[] = [];
            top.push({ key: line.slice(0, -1), children });
            stack.push(children);
            continue;
        }
        const eq = line.indexOf("=");
        if (eq < 0) throw new Error(`bad PIA line: ${line}`);
        top.push({ key: line.slice(0, eq), value: line.slice(eq + 1) });
    }
    if (stack.length !== 1) throw new Error("unterminated section in PIA text");
    return root;
}

export function formatPiaText(nodes: readonly PiaNode[], depth = 0): string {
    let out = "";
    const pad = " ".repeat(depth);
    for (const n of nodes) {
        if (n.children) out += `${pad}${n.key}{\n${formatPiaText(n.children, depth + 1)}${pad}}\n`;
        else out += `${pad}${n.key}=${n.value ?? ""}\n`;
    }
    return out;
}

/** Child section or entry by a slash path, e.g. "plot_style/0/color". */
export function piaGet(nodes: readonly PiaNode[], path: string): PiaNode | undefined {
    let cur: PiaNode | undefined;
    let list = nodes;
    for (const part of path.split("/")) {
        cur = list.find((n) => n.key === part);
        if (!cur) return undefined;
        list = cur.children ?? [];
    }
    return cur;
}

/** A string value: the leading `"` is a type marker, there is no closing quote. */
export function piaString(value: string | undefined): string {
    if (value === undefined) return "";
    return value.startsWith('"') ? value.slice(1) : value;
}

/** A number value; the optional ` (xxxxxxxxxxxxxx)` exact-double token is ignored. */
export function piaNumber(value: string | undefined, def: number): number {
    if (value === undefined) return def;
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : def;
}

export function piaBool(value: string | undefined, def: boolean): boolean {
    if (value === undefined) return def;
    return value.trim().toUpperCase() === "TRUE";
}
