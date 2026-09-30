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

// MLINE 38B and ACAD_TABLE 528 (header only) from ACadSharp sample_AC1032_ascii.dxf
const MLINE = `
  0 MLINE
  5 38B
330 1F
100 AcDbEntity
  8 0
100 AcDbMline
  2 STANDARD
340 18
 40 1.5
 70 1
 71 1
 72 2
 73 2
 10 137.8286153379725
 20 1.014578449646279
 30 0.0
210 0.0
220 0.0
230 1.0
 11 137.8286153379725
 21 1.014578449646279
 31 0.0
 12 0.0
 22 1.0
 32 0.0
 13 -1.0
 23 1.224646799147353E-16
 33 0.0
 74 2
 41 0.75
 41 0.0
 75 0
 74 2
 41 -0.75
 41 0.0
 75 0
 11 137.8286153379725
 21 8.931727104928427
 31 0.0
 12 1.0
 22 0.0
 32 0.0
 13 -0.7071067811865474
 23 0.7071067811865477
 33 0.0
 74 4
 41 1.060660171779821
 41 0.0
 41 1.0
 41 2.0
 75 1
 42 0.5
 74 2
 41 -1.060660171779821
 41 0.0
 75 0
`;

const TABLE = `
  0 ACAD_TABLE
  5 528
102 {ACAD_XDICTIONARY
360 12CF
102 }
330 1F
100 AcDbEntity
  8 Layer1
100 AcDbBlockReference
  2 *T9
 10 774.8657236611279
 20 48.53878603809858
 30 0.0
100 AcDbTable
280 0
342 87
343 570
 11 1.0
 21 0.0
 31 0.0
 90 22
 91 2
 92 3
 93 7340056
 94 0
 95 0
 96 0
 40 0.034198204937273
 41 0.034198204937273
140 0.1025946148118188
141 7.491035367212169
141 6.351095202636404
142 34.19820493727295
142 34.19820493727295
142 34.19820493727295
171 1
172 0
141 99
  1 Table sample
`;

const MESH = `
  0 MESH
  5 343
100 AcDbEntity
  8 0
100 AcDbSubDMesh
 71 2
 72 0
 91 1
 92 4
 10 0
 20 0
 30 0
 10 1
 20 0
 30 0
 10 1
 20 1
 30 0
 10 0
 20 1
 30 0
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
140 0
140 -1
 90 0
`;

const HELIX = `
  0 HELIX
  5 D5
330 2
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
 42 0.000000001
 43 0.0000000001
 40 0
 40 0
 40 0
 40 0
 40 1
 40 1
 40 1
 40 1
 10 10
 20 0
 30 0
 10 10
 20 5
 30 0.2
 10 5
 20 10
 30 0.4
 10 0
 20 10
 30 0.6
100 AcDbHelix
 90 31
 91 125
 10 0.0
 20 0.0
 30 0.0
 11 10.0
 21 0.0
 31 0.0
 12 0.0
 22 0.0
 32 1.0
 40 5
 41 3.0
 42 0.3333333333333333
290 1
280 1
`;

// REGION D69 from ACadSharp sample_AC1015_ascii.dxf (first two SAT lines) and the R2013+ layout
const ACIS = `
  0 REGION
  5 D69
330 1F
100 AcDbEntity
  8 0
100 AcDbModelerGeometry
 70 1
  1 koo km n o
  1 ni ^ *+0;:,4 ^ *+0\\^ [ mo ^ LR mloqhqoqijjlj QK o
  0 3DSOLID
  5 D65
330 1F
100 AcDbEntity
  8 0
100 AcDbModelerGeometry
290 1
  2 {1a113328-eb6d-d44d-824d-78b33668f9e7}
100 AcDb3dSolid
350 D66
`;

// after libredwg example_r14.dxf (chunks shortened)
const PROXY = `
  0 ACAD_PROXY_ENTITY
  5 640
330 1F
100 AcDbEntity
  8 TAVOLO_3
100 AcDbProxyEntity
 90 498
 91 532
 92 8
310 F002000018000000
 93 16
310 4072
340 11
340 2AF
340 0
 94 0
 95 1234
 70 1
`;

describe("MLINE", () => {
  it("reads vertices with miter directions and element parameters", () => {
    const { doc, entities } = loadEntities(MLINE);
    const m = entities[0] as MLineEntity;
    expect(m.type).toBe("MLINE");
    expect(m.styleName).toBe("STANDARD");
    expect(m.styleHandle).toBe("18");
    expect(m.scale).toBe(1.5);
    expect(m.justification).toBe(1);
    expect(m.styleElementCount).toBe(2);
    expect(m.start).toEqual({ x: 137.8286153379725, y: 1.014578449646279, z: 0 });
    expect(m.vertices).toHaveLength(2);
    expect(m.vertices[0]!.direction).toEqual({ x: 0, y: 1, z: 0 });
    expect(m.vertices[0]!.elements).toEqual([
      { params: [0.75, 0], fillParams: [] },
      { params: [-0.75, 0], fillParams: [] },
    ]);
    expect(m.vertices[1]!.miter.x).toBeCloseTo(-0.7071067811865474);
    expect(m.vertices[1]!.elements[0]).toEqual({ params: [1.060660171779821, 0, 1, 2], fillParams: [0.5] });
    expect(errors(doc)).toEqual([]);
  });
});

describe("ACAD_TABLE", () => {
  it("reads the block reference and table geometry, stopping at the cell data", () => {
    const t = loadEntities(TABLE).entities[0] as AcadTableEntity;
    expect(t.type).toBe("ACAD_TABLE");
    expect(t.blockName).toBe("*T9");
    expect(t.insert.x).toBeCloseTo(774.8657236611278);
    expect(t.insert.y).toBeCloseTo(48.53878603809858);
    expect(t.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(t.tableStyleHandle).toBe("87");
    expect(t.blockRecordHandle).toBe("570");
    expect(t.rowCount).toBe(2);
    expect(t.columnCount).toBe(3);
    expect(t.rowHeights).toEqual([7.491035367212169, 6.351095202636404]);
    expect(t.columnWidths).toHaveLength(3);
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
    expect(h.startPoint).toEqual({ x: 10, y: 0, z: 0 });
    expect(h.axisVector).toEqual({ x: 0, y: 0, z: 1 });
    expect(h.radius).toBe(5);
    expect(h.turns).toBe(3);
    expect(h.rightHanded).toBe(true);
    expect(h.proxyGraphics).toEqual(new Uint8Array([10, 11, 12, 13]));
  });
});

describe("ACIS entities", () => {
  it("decodes SAT lines of R2000–R2010 files and flags R2013+ ACDSDATA storage", () => {
    const [region, solid] = loadEntities(ACIS).entities as AcisEntity[];
    expect(region!.type).toBe("REGION");
    expect(region!.modelerVersion).toBe(1);
    expect(region!.satLines[0]).toBe("400 42 1 0");
    expect(region!.satLines[1]).toBe("16 Autodesk AutoCAD 20 ASM 230.7.0.65535 NT 0");
    expect(region!.acisInAcdsData).toBe(false);
    expect(solid!.type).toBe("3DSOLID");
    expect(solid!.satLines).toEqual([]);
    expect(solid!.acisInAcdsData).toBe(true);
    expect(solid!.uid).toBe("{1a113328-eb6d-d44d-824d-78b33668f9e7}");
    expect(solid!.historyHandle).toBe("D66");
  });

  it("decodeSatLine inverts 159 − c and drops the space after an encoded 'A'", () => {
    expect(decodeSatLine("^ *+0\\^ [")).toBe("AutoCAD");
    expect(decodeSatLine("koo km")).toBe("400 42");
  });
});

describe("ACAD_PROXY_ENTITY", () => {
  it("reads class ids, proxy graphics, entity data and object ids", () => {
    const p = loadEntities(PROXY).entities[0] as ProxyEntity;
    expect(p.type).toBe("ACAD_PROXY_ENTITY");
    expect(p.proxyClassId).toBe(498);
    expect(p.applicationClassId).toBe(532);
    expect(p.proxyGraphics).toEqual(new Uint8Array([0xf0, 0x02, 0, 0, 0x18, 0, 0, 0]));
    expect(p.entityDataBits).toBe(16);
    expect(p.entityData).toEqual(new Uint8Array([0x40, 0x72]));
    expect(p.objectIds).toEqual(["11", "2AF", "0"]);
    expect(p.dwgFormat).toBe(1234);
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
