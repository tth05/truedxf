/** Small DXF builders for render tests. */
import { DxfDocument } from "@truedxf/model";

const enc = new TextEncoder();

/** Parses "code value" lines into a DXF byte stream. */
export function dxfBytes(listing: string): Uint8Array {
  const out: string[] = [];
  for (const raw of listing.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(-?\d+)(?: (.*))?$/.exec(line);
    if (!m) throw new Error(`bad listing line: ${line}`);
    out.push(m[1]!.padStart(3), m[2] ?? "");
  }
  return enc.encode(`${out.join("\r\n")}\r\n`);
}

/**
 * A model-space-only AC1032 document: header vars, a BLOCK_RECORD for *Model_Space with handle
 * 1F, the given entities (owner 1F) and objects.
 */
export function modelDoc(opts: { entities: string; objects?: string; header?: string }): DxfDocument {
  return DxfDocument.load(
    dxfBytes(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1032
${opts.header ?? ""}
0 ENDSEC
0 SECTION
2 TABLES
0 TABLE
2 BLOCK_RECORD
5 1
70 1
0 BLOCK_RECORD
5 1F
330 1
100 AcDbSymbolTableRecord
100 AcDbBlockTableRecord
2 *Model_Space
0 ENDTAB
0 ENDSEC
0 SECTION
2 ENTITIES
${opts.entities}
0 ENDSEC
0 SECTION
2 OBJECTS
${opts.objects ?? ""}
0 ENDSEC
0 EOF
`),
  );
}

/** A LINE entity listing with a handle. */
export function line(handle: string, x0: number, y0: number, x1: number, y1: number, color = 7): string {
  return `0 LINE
5 ${handle}
330 1F
100 AcDbEntity
8 0
62 ${color}
100 AcDbLine
10 ${x0}
20 ${y0}
30 0
11 ${x1}
21 ${y1}
31 0`;
}
