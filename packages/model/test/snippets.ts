/** Helpers for building small DXF files from tag listings in tests. */
import { DxfDocument } from "../src/index.ts";

const enc = new TextEncoder();

/**
 * Parses a listing of "code value" lines (as printed by DXF dump tools; the value is everything
 * after the first run of spaces following the code, may be empty) into [code, value] pairs.
 */
export function listing(text: string): [number, string][] {
  const out: [number, string][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    const m = /^\s*(-?\d+)(?: (.*))?$/.exec(line);
    if (!m) throw new Error(`bad listing line: ${line}`);
    const v = (m[2] ?? "").replace(/^ +/, "");
    out.push([Number(m[1]), v === "<SP>" ? " " : v]);
  }
  return out;
}

function encode(tags: readonly [number, string | number][]): Uint8Array {
  return enc.encode(`${tags.map(([c, v]) => `${String(c).padStart(3)}\r\n${v}`).join("\r\n")}\r\n`);
}

/** A DXF with the given ENTITIES (and optional OBJECTS) listings, $ACADVER as given. */
export function dxfWith(opts: { entities?: string; objects?: string; tables?: string; acadver?: string }) {
  const tags: [number, string | number][] = [
    [0, "SECTION"],
    [2, "HEADER"],
    [9, "$ACADVER"],
    [1, opts.acadver ?? "AC1032"],
    [0, "ENDSEC"],
  ];
  if (opts.tables) tags.push([0, "SECTION"], [2, "TABLES"], ...listing(opts.tables), [0, "ENDSEC"]);
  tags.push([0, "SECTION"], [2, "ENTITIES"], ...listing(opts.entities ?? ""), [0, "ENDSEC"]);
  if (opts.objects) tags.push([0, "SECTION"], [2, "OBJECTS"], ...listing(opts.objects), [0, "ENDSEC"]);
  tags.push([0, "EOF"]);
  return encode(tags);
}

export function loadEntities(entities: string, acadver?: string) {
  const doc = DxfDocument.load(dxfWith({ entities, acadver }));
  return { doc, entities: doc.modelSpace.entities };
}

export function loadObjects(objects: string) {
  const doc = DxfDocument.load(dxfWith({ objects }));
  return { doc, objects: doc.objects };
}

/** Diagnostics with severity error (parse failures are reported as errors). */
export function errors(doc: DxfDocument) {
  return doc.diagnostics.items.filter((d) => d.severity === "error");
}
