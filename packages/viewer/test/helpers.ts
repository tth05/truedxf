/** A small R12-style DXF (header, LAYER table, entities) for viewer tests. */
const enc = new TextEncoder();

export function dxf(listing: string): Uint8Array {
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
 * Header with unset extents (1e20 / -1e20), layers WALLS (red) and TEXT (off), a LINE A1 on
 * WALLS, a CIRCLE A2 on TEXT and a SOLID A3 on the undefined layer 0.
 */
export const SAMPLE = dxf(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1009
9 $EXTMIN
10 1e20
20 1e20
9 $EXTMAX
10 -1e20
20 -1e20
0 ENDSEC
0 SECTION
2 TABLES
0 TABLE
2 LAYER
70 2
0 LAYER
2 WALLS
70 0
62 1
6 CONTINUOUS
0 LAYER
2 TEXT
70 0
62 -3
6 CONTINUOUS
0 ENDTAB
0 ENDSEC
0 SECTION
2 ENTITIES
0 LINE
5 A1
8 WALLS
10 0
20 0
11 100
21 0
0 CIRCLE
5 A2
8 TEXT
10 50
20 50
40 10
0 SOLID
5 A3
8 0
10 200
20 0
11 300
21 0
12 200
22 100
13 300
23 100
0 ENDSEC
0 EOF
`);
