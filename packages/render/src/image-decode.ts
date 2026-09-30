/**
 * Raster file decoding for IMAGE entities (isomorphic, pure JS: PNG via fast-png, JPEG via
 * jpeg-js, TIFF via utif, BMP here). Output is 8-bit RGBA, top row first, no colour management
 * (PNG gAMA / ICC are ignored, like a plain byte copy).
 */
import { decode as decodePng } from "fast-png";
import jpeg from "jpeg-js";
import UTIF from "utif";

export interface DecodedRaster {
  width: number;
  height: number;
  /** RGBA, top row first. */
  rgba: Uint8Array;
  /** 1-bit (bitonal) source: `ink[i]` = 1 for foreground (dark) pixels. */
  ink?: Uint8Array;
  /** Source had an alpha channel or transparency key. */
  hasAlpha: boolean;
}

export function decodeRaster(bytes: Uint8Array): DecodedRaster | undefined {
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return png(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpg(bytes);
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return bmp(bytes);
    if (
      (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 42)
    )
      return tiff(bytes);
  } catch {
    return undefined;
  }
  return undefined;
}

function png(bytes: Uint8Array): DecodedRaster {
  const im = decodePng(bytes);
  const { width: w, height: h, depth, channels } = im;
  const data = im.data;
  const out = new Uint8Array(w * h * 4);
  const palette = im.palette as number[][] | undefined;
  const rowBits = w * channels * depth;
  const rowBytes = Math.ceil(rowBits / 8);
  const sample = (x: number, y: number, c: number): number => {
    if (depth === 8) return data[(y * w + x) * channels + c]!;
    if (depth === 16) return data[(y * w + x) * channels + c]! >> 8;
    const bit = (x * channels + c) * depth;
    const byte = data[y * rowBytes + (bit >> 3)]!;
    return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const maxv = depth >= 8 ? 255 : (1 << depth) - 1;
  const bitonal = !palette && channels === 1 && depth === 1;
  const ink = bitonal ? new Uint8Array(w * h) : undefined;
  let hasAlpha = channels === 2 || channels === 4;
  const trns = im.transparency as number[] | undefined;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (palette) {
        const idx = sample(x, y, 0);
        const p = palette[idx] ?? [0, 0, 0];
        out[o] = p[0]!;
        out[o + 1] = p[1]!;
        out[o + 2] = p[2]!;
        out[o + 3] = p.length > 3 ? p[3]! : 255;
        if (p.length > 3) hasAlpha = true;
        continue;
      }
      if (channels <= 2) {
        const v = sample(x, y, 0);
        const g = Math.round((v * 255) / maxv);
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = channels === 2 ? sample(x, y, 1) : trns && trns[0] === v ? 0 : 255;
        if (ink) ink[y * w + x] = v === 0 ? 1 : 0;
      } else {
        out[o] = sample(x, y, 0);
        out[o + 1] = sample(x, y, 1);
        out[o + 2] = sample(x, y, 2);
        out[o + 3] = channels === 4 ? sample(x, y, 3) : 255;
      }
    }
  if (trns && !palette) hasAlpha = true;
  return { width: w, height: h, rgba: out, ...(ink ? { ink } : {}), hasAlpha };
}

function jpg(bytes: Uint8Array): DecodedRaster {
  const im = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  return { width: im.width, height: im.height, rgba: new Uint8Array(im.data), hasAlpha: false };
}

function tiff(bytes: Uint8Array): DecodedRaster {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const ifds = UTIF.decode(buf);
  const ifd = ifds[0];
  if (!ifd) throw new Error("tiff: no image");
  UTIF.decodeImage(buf, ifd, ifds);
  const rgba = new Uint8Array(UTIF.toRGBA8(ifd));
  const w = ifd.width as number;
  const h = ifd.height as number;
  const bps = (ifd.t258 as number[] | undefined)?.[0] ?? 1;
  const photometric = (ifd.t262 as number[] | undefined)?.[0] ?? 2;
  const spp = (ifd.t277 as number[] | undefined)?.[0] ?? 1;
  let ink: Uint8Array | undefined;
  if (bps === 1 && spp === 1 && (photometric === 0 || photometric === 1)) {
    ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) ink[i] = rgba[i * 4]! < 128 ? 1 : 0;
  }
  return { width: w, height: h, rgba, ...(ink ? { ink } : {}), hasAlpha: spp === 4 || spp === 2 };
}

/** Uncompressed BMP (1/4/8/24/32 bit, bottom-up or top-down). */
function bmp(bytes: Uint8Array): DecodedRaster {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = dv.getUint32(10, true);
  const header = dv.getUint32(14, true);
  const w = dv.getInt32(18, true);
  const hRaw = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const compression = header >= 40 ? dv.getUint32(30, true) : 0;
  if (compression !== 0 && compression !== 3) throw new Error("bmp: compressed");
  const h = Math.abs(hRaw);
  const topDown = hRaw < 0;
  const colors = header >= 40 ? dv.getUint32(46, true) || (bpp <= 8 ? 1 << bpp : 0) : 1 << bpp;
  const pal: number[][] = [];
  for (let i = 0; i < colors && bpp <= 8; i++) {
    const p = 14 + header + i * 4;
    pal.push([bytes[p + 2]!, bytes[p + 1]!, bytes[p]!]);
  }
  const stride = Math.ceil((w * bpp) / 32) * 4;
  const out = new Uint8Array(w * h * 4);
  const ink = bpp === 1 ? new Uint8Array(w * h) : undefined;
  for (let y = 0; y < h; y++) {
    const row = offset + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      if (bpp <= 8) {
        const bit = x * bpp;
        const idx = (bytes[row + (bit >> 3)]! >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        const c = pal[idx] ?? [0, 0, 0];
        r = c[0]!;
        g = c[1]!;
        b = c[2]!;
        if (ink) ink[y * w + x] = (r + g + b) / 3 < 128 ? 1 : 0;
      } else {
        const p = row + x * (bpp >> 3);
        b = bytes[p]!;
        g = bytes[p + 1]!;
        r = bytes[p + 2]!;
        if (bpp === 32) a = bytes[p + 3]!;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { width: w, height: h, rgba: out, ...(ink ? { ink } : {}), hasAlpha: bpp === 32 };
}
