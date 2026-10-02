import { describe, expect, it } from "vitest";
import {
  type AcadTableEntity,
  type AcisEntity,
  decodeSatLine,
  type HelixEntity,
  type LineEntity,
  type MeshEntity,
  type MLineEntity,
  type ProxyEntity,
} from "../src/index.ts";
import { errors, loadEntities } from "./snippets.ts";

// MLINE generated with ezdxf 1.4.4 (R2018, 3 vertices, scale 2); the area fill parameters of
// the second vertex's first element (75 1, 42) added by hand.
const MLINE = `
  0 MLINE
  5 2F
330 17
100 AcDbEntity
  8 0
100 AcDbMline
  2 Standard
340 22
 40 2.0
 70 0
 71 1
 72 3
 73 2
 10 10.0
 20 5.0
 30 0.0
210 0.0
220 0.0
230 1.0
 11 10.0
 21 5.0
 31 0.0
 12 0.0
 22 1.0
 32 0.0
 13 -1.0
 23 6.123233995736766e-17
 33 0.0
 74 2
 41 0.0
 41 0.0
 75 0
 74 2
 41 -2.0
 41 0.0
 75 0
 11 10.0
 21 25.0
 31 0.0
 12 1.0
 22 0.0
 32 0.0
 13 -0.7071067811865475
 23 0.7071067811865475
 33 0.0
 74 4
 41 0.0
 41 0.0
 41 1.5
 41 3.0
 75 1
 42 0.25
 74 2
 41 -2.82842712474619
 41 0.0
 75 0
 11 30.0
 21 25.0
 31 0.0
 12 1.0
 22 0.0
 32 0.0
 13 0.0
 23 1.0
 33 0.0
 74 2
 41 0.0
 41 0.0
 75 0
 74 2
 41 -2.0
 41 0.0
 75 0
`;

// Hand-written ACAD_TABLE header (ezdxf cannot create tables), stopping at the first cell:
// the 141 inside the cell data must not become a row height.
const TABLE = `
  0 ACAD_TABLE
  5 60
102 {ACAD_XDICTIONARY
360 61
102 }
330 17
100 AcDbEntity
  8 TABLES
100 AcDbBlockReference
  2 *T1
 10 120.5
 20 -40.25
 30 0.0
100 AcDbTable
280 0
342 51
343 62
 11 1.0
 21 0.0
 31 0.0
 90 22
 91 2
 92 3
 93 0
 94 0
 95 0
 96 0
 40 0.75
 41 0.5
141 8.0
141 6.5
142 30.0
142 20.0
142 25.0
171 1
172 0
141 42
  1 Room
`;

// MESH and HELIX (quarter turn) generated with ezdxf 1.4.4; the HELIX 160/310 proxy graphics
// added by hand.
const MESH = `
  0 MESH
  5 30
330 17
100 AcDbEntity
  8 0
100 AcDbSubDMesh
 71 2
 72 0
 91 1
 92 4
 10 0.0
 20 0.0
 30 0.0
 10 4.0
 20 0.0
 30 0.0
 10 4.0
 20 3.0
 30 0.0
 10 0.0
 20 3.0
 30 1.0
 93 8
 90 3
 90 0
 90 1
 90 2
 90 3
 90 0
 90 2
 90 3
 94 2
 90 0
 90 1
 90 1
 90 2
 95 2
140 0.0
140 -1.0
 90 0
`;

const HELIX = `
  0 HELIX
  5 2F
330 17
100 AcDbEntity
  8 0
160 4
310 0A0B0C0D
100 AcDbSpline
 70 0
 71 3
 72 8
 73 4
 74 0
 40 0.0
 40 0.0
 40 0.0
 40 0.0
 40 1.0
 40 1.0
 40 1.0
 40 1.0
 10 4.0
 20 0.0
 30 0.0
 10 4.0
 20 2.2091389993231734
 30 0.22236768652263827
 10 2.209138999323174
 20 4.0
 30 0.4026323134773617
 10 2.4492935982947064e-16
 20 4.0
 30 0.625
100 AcDbHelix
 90 29
 91 63
 10 0.0
 20 0.0
 30 0.0
 11 4.0
 21 0.0
 31 0.0
 12 0.0
 22 0.0
 32 1.0
 40 4.0
 41 0.25
 42 2.5
290 1
280 1
`;

// REGION generated with ezdxf 1.4.4 for R2000 from our own three SAT lines (ezdxf encodes them);
// the R2013+ 3DSOLID layout (SAT data in ACDSDATA, 290/2 and AcDb3dSolid 350) hand-written.
const ACIS = `
  0 REGION
  5 2F
330 17
100 AcDbEntity
  8 0
100 AcDbModelerGeometry
 70 1
  1 koo l n o
  1 h +-*:;'9 g ^ \\VL kqo QK mk Y-6 P<+ om nmeooeoo momi
  1 n fqfffffffffffffffj:rooh n:rono
  0 3DSOLID
  5 70
330 17
100 AcDbEntity
  8 0
100 AcDbModelerGeometry
290 1
  2 {6c1d0e4a-2b3f-4a5d-9e8f-0a1b2c3d4e5f}
100 AcDb3dSolid
350 71
`;

// Hand-written proxy entity (class ids, graphics, entity data and object ids chosen freely).
const PROXY = `
  0 ACAD_PROXY_ENTITY
  5 80
330 17
100 AcDbEntity
  8 PROXIES
100 AcDbProxyEntity
 90 498
 91 503
 92 8
310 0C00000002000000
 93 24
310 1A2B3C
340 2A
340 3F
340 0
 94 0
 95 33
 70 1
`;

describe("MLINE", () => {
  it("reads vertices with miter directions and element parameters", () => {
    const { doc, entities } = loadEntities(MLINE);
    const m = entities[0] as MLineEntity;
    expect(m.type).toBe("MLINE");
    expect(m.styleName).toBe("Standard");
    expect(m.styleHandle).toBe("22");
    expect(m.scale).toBe(2);
    expect(m.justification).toBe(0);
    expect(m.styleElementCount).toBe(2);
    expect(m.start).toEqual({ x: 10, y: 5, z: 0 });
    expect(m.vertices).toHaveLength(3);
    expect(m.vertices[0]!.direction).toEqual({ x: 0, y: 1, z: 0 });
    expect(m.vertices[0]!.elements).toEqual([
      { params: [0, 0], fillParams: [] },
      { params: [-2, 0], fillParams: [] },
    ]);
    expect(m.vertices[1]!.miter.x).toBeCloseTo(-0.7071067811865475);
    expect(m.vertices[1]!.elements[0]).toEqual({ params: [0, 0, 1.5, 3], fillParams: [0.25] });
    expect(errors(doc)).toEqual([]);
  });
});

describe("ACAD_TABLE", () => {
  it("reads the block reference and table geometry, stopping at the cell data", () => {
    const t = loadEntities(TABLE).entities[0] as AcadTableEntity;
    expect(t.type).toBe("ACAD_TABLE");
    expect(t.blockName).toBe("*T1");
    expect(t.insert).toEqual({ x: 120.5, y: -40.25, z: 0 });
    expect(t.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(t.tableStyleHandle).toBe("51");
    expect(t.blockRecordHandle).toBe("62");
    expect(t.rowCount).toBe(2);
    expect(t.columnCount).toBe(3);
    expect(t.rowHeights).toEqual([8, 6.5]);
    expect(t.columnWidths).toEqual([30, 20, 25]);
  });
});

describe("MESH", () => {
  it("reads vertices, n-gon face list, edges and creases", () => {
    const m = loadEntities(MESH).entities[0] as MeshEntity;
    expect(m.type).toBe("MESH");
    expect(m.subdivisionLevel).toBe(1);
    expect(m.vertices).toHaveLength(4);
    expect(m.faces).toEqual([
      [0, 1, 2],
      [0, 2, 3],
    ]);
    expect(m.edges).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(m.creases).toEqual([0, -1]);
  });
});

describe("HELIX", () => {
  it("reads the embedded spline and the helix parameters", () => {
    const h = loadEntities(HELIX).entities[0] as HelixEntity;
    expect(h.type).toBe("HELIX");
    expect(h.degree).toBe(3);
    expect(h.controlPoints).toHaveLength(4);
    expect(h.knots).toHaveLength(8);
    expect(h.axisBase).toEqual({ x: 0, y: 0, z: 0 });
    expect(h.startPoint).toEqual({ x: 4, y: 0, z: 0 });
    expect(h.axisVector).toEqual({ x: 0, y: 0, z: 1 });
    expect(h.radius).toBe(4);
    expect(h.turns).toBe(0.25);
    expect(h.rightHanded).toBe(true);
    expect(h.proxyGraphics).toEqual(new Uint8Array([10, 11, 12, 13]));
  });
});

describe("ACIS entities", () => {
  it("decodes SAT lines of R2000–R2010 files and flags R2013+ ACDSDATA storage", () => {
    const [region, solid] = loadEntities(ACIS).entities as AcisEntity[];
    expect(region!.type).toBe("REGION");
    expect(region!.modelerVersion).toBe(1);
    expect(region!.satLines).toEqual([
      "400 3 1 0",
      "7 truedxf 8 ACIS 4.0 NT 24 Fri Oct 02 12:00:00 2026",
      "1 9.9999999999999995e-007 1e-010",
    ]);
    expect(region!.acisInAcdsData).toBe(false);
    expect(solid!.type).toBe("3DSOLID");
    expect(solid!.satLines).toEqual([]);
    expect(solid!.acisInAcdsData).toBe(true);
    expect(solid!.uid).toBe("{6c1d0e4a-2b3f-4a5d-9e8f-0a1b2c3d4e5f}");
    expect(solid!.historyHandle).toBe("71");
  });

  it("decodeSatLine inverts 159 − c and drops the space after an encoded 'A'", () => {
    expect(decodeSatLine("^ -:> jn")).toBe("Area 51");
    expect(decodeSatLine("koo l")).toBe("400 3");
  });
});

describe("ACAD_PROXY_ENTITY", () => {
  it("reads class ids, proxy graphics, entity data and object ids", () => {
    const p = loadEntities(PROXY).entities[0] as ProxyEntity;
    expect(p.type).toBe("ACAD_PROXY_ENTITY");
    expect(p.proxyClassId).toBe(498);
    expect(p.applicationClassId).toBe(503);
    expect(p.proxyGraphics).toEqual(new Uint8Array([0x0c, 0, 0, 0, 0x02, 0, 0, 0]));
    expect(p.entityDataBits).toBe(24);
    expect(p.entityData).toEqual(new Uint8Array([0x1a, 0x2b, 0x3c]));
    expect(p.objectIds).toEqual(["2A", "3F", "0"]);
    expect(p.dwgFormat).toBe(33);
    expect(p.originalFormat).toBe(1);
  });

  it("exposes AcDbEntity proxy graphics on ordinary entities", () => {
    const l = loadEntities(`
  0 LINE
  5 1
100 AcDbEntity
  8 0
 92 2
310 ABCD
100 AcDbLine
 10 0
 20 0
 11 1
 21 1
`).entities[0] as LineEntity;
    expect(l.proxyGraphics).toEqual(new Uint8Array([0xab, 0xcd]));
    const plain = loadEntities(MLINE).entities[0]!;
    expect(plain.proxyGraphics).toBeUndefined();
  });
});
