import { readFileSync, writeFileSync } from "node:fs";
import { decode, encode } from "fast-png";
import type { Image } from "./metrics.ts";

/** Reads a PNG as 8-bit RGBA (expands grey, palette and RGB images). */
export function readPng(path: string): Image {
    return decodePng(new Uint8Array(readFileSync(path)));
}

export function decodePng(bytes: Uint8Array): Image {
    const png = decode(bytes);
    const { width, height, channels } = png;
    const src = png.data;
    const out = new Uint8Array(width * height * 4);
    const palette = png.palette;
    const depth = png.depth;
    for (let p = 0; p < width * height; p++) {
        let r: number;
        let g: number;
        let b: number;
        let a = 255;
        if (palette) {
            const c = palette[src[p]!]!;
            r = c[0]!;
            g = c[1]!;
            b = c[2]!;
            a = c[3] ?? 255;
        } else {
            const k = p * channels;
            const v = (i: number) => (depth === 16 ? src[k + i]! >> 8 : src[k + i]!);
            if (channels >= 3) {
                r = v(0);
                g = v(1);
                b = v(2);
                if (channels === 4) a = v(3);
            } else {
                r = g = b = v(0);
                if (channels === 2) a = v(1);
            }
        }
        out[p * 4] = r;
        out[p * 4 + 1] = g;
        out[p * 4 + 2] = b;
        out[p * 4 + 3] = a;
    }
    return { width, height, data: out };
}

export function writePng(path: string, img: Image): void {
    writeFileSync(
        path,
        encode({ width: img.width, height: img.height, data: img.data, channels: 4, depth: 8 }),
    );
}
