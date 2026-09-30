// Minimal sfnt (TrueType/OpenType) reader: format sniffing, TrueType collections, and the few
// name/OS-2/head fields needed to index fonts by family without a full parse.

import { FontFormatError } from "../bytes.ts";

const TAG_TTCF = 0x74746366; // 'ttcf'
const SFNT_VERSIONS = new Set([0x00010000, 0x4f54544f /* OTTO */, 0x74727565 /* true */]);

function u16(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

export function isSfnt(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const v = u32(bytes, 0);
  return SFNT_VERSIONS.has(v) || v === TAG_TTCF;
}

export function isCollection(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && u32(bytes, 0) === TAG_TTCF;
}

/** Number of faces (1 for a plain font). */
export function faceCount(bytes: Uint8Array): number {
  return isCollection(bytes) ? u32(bytes, 8) : 1;
}

interface TableRecord {
  tag: string;
  checksum: number;
  offset: number;
  length: number;
}

function tableDirectory(bytes: Uint8Array, at: number): { version: number; tables: TableRecord[] } {
  if (at + 12 > bytes.length) throw new FontFormatError("sfnt table directory out of range");
  const version = u32(bytes, at);
  const n = u16(bytes, at + 4);
  const tables: TableRecord[] = [];
  for (let i = 0; i < n; i++) {
    const r = at + 12 + 16 * i;
    if (r + 16 > bytes.length) throw new FontFormatError("sfnt table directory truncated");
    tables.push({
      tag: String.fromCharCode(bytes[r]!, bytes[r + 1]!, bytes[r + 2]!, bytes[r + 3]!),
      checksum: u32(bytes, r + 4),
      offset: u32(bytes, r + 8),
      length: u32(bytes, r + 12),
    });
  }
  return { version, tables };
}

function faceDirectoryOffset(bytes: Uint8Array, face: number): number {
  if (!isCollection(bytes)) return 0;
  const n = u32(bytes, 8);
  if (face < 0 || face >= n) throw new FontFormatError(`font collection has ${n} faces, requested ${face}`);
  return u32(bytes, 12 + 4 * face);
}

/**
 * Extracts one face of a TrueType collection (.ttc) as a standalone sfnt (opentype.js cannot read
 * collections). Plain fonts are returned unchanged for face 0.
 */
export function extractFace(bytes: Uint8Array, face = 0): Uint8Array {
  if (!isCollection(bytes)) {
    if (face !== 0) throw new FontFormatError("not a font collection");
    return bytes;
  }
  const { version, tables } = tableDirectory(bytes, faceDirectoryOffset(bytes, face));
  const headerLen = 12 + 16 * tables.length;
  let size = headerLen;
  for (const t of tables) size += (t.length + 3) & ~3;
  const out = new Uint8Array(size);
  const put32 = (o: number, v: number) => {
    out[o] = v >>> 24;
    out[o + 1] = (v >>> 16) & 0xff;
    out[o + 2] = (v >>> 8) & 0xff;
    out[o + 3] = v & 0xff;
  };
  const put16 = (o: number, v: number) => {
    out[o] = v >>> 8;
    out[o + 1] = v & 0xff;
  };
  put32(0, version);
  const n = tables.length;
  let es = 0;
  while (1 << (es + 1) <= n) es++;
  put16(4, n);
  put16(6, 16 << es);
  put16(8, es);
  put16(10, n * 16 - (16 << es));
  let at = headerLen;
  tables.forEach((t, i) => {
    const r = 12 + 16 * i;
    for (let k = 0; k < 4; k++) out[r + k] = t.tag.charCodeAt(k);
    put32(r + 4, t.checksum);
    put32(r + 8, at);
    put32(r + 12, t.length);
    if (t.offset + t.length > bytes.length) throw new FontFormatError(`table ${t.tag} out of range`);
    out.set(bytes.subarray(t.offset, t.offset + t.length), at);
    at += (t.length + 3) & ~3;
  });
  return out;
}

export interface SfntNames {
  /** Legacy family (name ID 1) — the GDI face name AutoCAD stores in STYLE XDATA (note 04 §4.1). */
  family: string;
  /** Legacy subfamily (name ID 2), e.g. "Bold Italic". */
  subfamily: string;
  /** Typographic family (name ID 16), if present. */
  typographicFamily?: string;
  fullName?: string;
  bold: boolean;
  italic: boolean;
}

function decodeUtf16be(b: Uint8Array, o: number, len: number): string {
  let s = "";
  for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode(u16(b, o + i));
  return s;
}

function decodeLatin1(b: Uint8Array, o: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[o + i]!);
  return s;
}

/** Reads family/style information of one face without parsing glyph data. */
export function readNames(bytes: Uint8Array, face = 0): SfntNames {
  const { tables } = tableDirectory(bytes, faceDirectoryOffset(bytes, face));
  const find = (tag: string) => tables.find((t) => t.tag === tag);
  const nameT = find("name");
  const byId = new Map<number, { score: number; value: string }>();
  if (nameT) {
    const base = nameT.offset;
    const count = u16(bytes, base + 2);
    const strings = base + u16(bytes, base + 4);
    for (let i = 0; i < count; i++) {
      const r = base + 6 + 12 * i;
      if (r + 12 > bytes.length) break;
      const platform = u16(bytes, r);
      const encoding = u16(bytes, r + 2);
      const lang = u16(bytes, r + 4);
      const id = u16(bytes, r + 6);
      const len = u16(bytes, r + 8);
      const off = strings + u16(bytes, r + 10);
      if (![1, 2, 4, 16, 17].includes(id) || off + len > bytes.length) continue;
      // Prefer Windows English (US), then any Windows, then Unicode, then Mac Roman.
      let score = 0;
      let value: string;
      if (platform === 3 && (encoding === 1 || encoding === 0 || encoding === 10)) {
        score = lang === 0x409 ? 4 : 3;
        value = decodeUtf16be(bytes, off, len);
      } else if (platform === 0) {
        score = 2;
        value = decodeUtf16be(bytes, off, len);
      } else if (platform === 1 && encoding === 0) {
        score = 1;
        value = decodeLatin1(bytes, off, len);
      } else continue;
      const prev = byId.get(id);
      if (!prev || prev.score < score) byId.set(id, { score, value });
    }
  }
  let bold = false;
  let italic = false;
  const os2 = find("OS/2");
  const head = find("head");
  if (os2 && os2.length >= 64) {
    const fsSelection = u16(bytes, os2.offset + 62);
    italic = (fsSelection & 1) !== 0;
    bold = (fsSelection & 0x20) !== 0;
  } else if (head && head.length >= 46) {
    const macStyle = u16(bytes, head.offset + 44);
    bold = (macStyle & 1) !== 0;
    italic = (macStyle & 2) !== 0;
  }
  const names: SfntNames = {
    family: byId.get(1)?.value ?? "",
    subfamily: byId.get(2)?.value ?? "",
    bold,
    italic,
  };
  const tf = byId.get(16)?.value;
  if (tf) names.typographicFamily = tf;
  const full = byId.get(4)?.value;
  if (full) names.fullName = full;
  return names;
}
