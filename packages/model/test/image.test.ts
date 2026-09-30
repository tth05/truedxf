import { describe, expect, it } from "vitest";
import type { ImageEntity, Ole2FrameEntity, UnderlayEntity, WipeoutEntity } from "../src/index.ts";
import { errors, loadEntities } from "./snippets.ts";

// AutoCAD 2018 layouts (ACadSharp sample_AC1032_ascii.dxf: IMAGE 8C6, WIPEOUT 44D, PDFUNDERLAY D07);
// OLE2FRAME after bjnortier-dxf testOle2Frame.dxf
const ENTITIES = `
  0 IMAGE
  5 8C6
330 1F
100 AcDbEntity
  8 0
100 AcDbRasterImage
 90 0
 10 0.0
 20 15.0
 30 0.0
 11 0.0104166666666667
 21 0.0
 31 0.0
 12 0.0
 22 0.0104166666666667
 32 0.0
 13 994.0
 23 965.0
340 8C4
 70 7
280 0
281 50
282 50
283 0
290 0
360 8C5
 71 1
 91 2
 14 -0.5
 24 -0.5
 14 993.5
 24 964.4999999999999
  0 WIPEOUT
  5 44D
330 1F
100 AcDbEntity
  8 0
160 8
310 0102030405060708
100 AcDbWipeout
 90 0
 10 271.9211288808192
 20 3.988123351850958
 30 0.0
 11 31.70774292607268
 21 0.0
 31 0.0
 12 0.0
 22 31.70774292607268
 32 0.0
 13 1.0
 23 1.0
340 0
 70 7
280 1
281 50
282 50
283 0
290 0
360 0
 71 2
 91 3
 14 -0.5
 24 0.5
 14 0.3260511008800897
 24 0.492063502336059
 14 -0.5
 24 -0.5
  0 PDFUNDERLAY
  5 D07
330 1F
100 AcDbEntity
  8 0
 62 193
420 10175212
100 AcDbUnderlayReference
340 D06
 10 16.28692563580262
 20 15.0
 30 0.0
 41 2.0
 42 2.0
 43 1.0
 50 45.0
280 3
281 100
282 0
 11 0.0
 21 0.0
 11 5.0
 21 4.0
  0 OLE2FRAME
  5 2D
100 AcDbEntity
  8 0
100 AcDbOle2Frame
 70 2
  3 Paintbrush Picture
 10 0.0
 20 0.0
 30 0.0
 11 10.0
 21 -5.0
 31 0.0
 71 3
 72 0
 90 8
310 DEADBEEF
310 CAFEBABE
  1 OLE
`;

describe("IMAGE / WIPEOUT / UNDERLAY / OLE2FRAME", () => {
  it("reads raster image placement, display flags and clip boundary", () => {
    const { doc, entities } = loadEntities(ENTITIES);
    const img = entities[0] as ImageEntity;
    expect(img.type).toBe("IMAGE");
    expect(img.insert).toEqual({ x: 0, y: 15, z: 0 });
    expect(img.u).toEqual({ x: 0.0104166666666667, y: 0, z: 0 });
    expect(img.v).toEqual({ x: 0, y: 0.0104166666666667, z: 0 });
    expect(img.size).toEqual({ x: 994, y: 965 });
    expect(img.imageDefHandle).toBe("8C4");
    expect(img.imageDefReactorHandle).toBe("8C5");
    expect(img.displayFlags).toBe(7);
    expect(img.clipping).toBe(false);
    expect(img.brightness).toBe(50);
    expect(img.clipType).toBe(1);
    expect(img.clipBoundary).toEqual([
      { x: -0.5, y: -0.5 },
      { x: 993.5, y: 964.4999999999999 },
    ]);
    expect(img.clipInverted).toBe(false);
    expect(errors(doc)).toEqual([]);
  });

  it("reads WIPEOUT (AcDbWipeout only) with normalized boundary and proxy graphics", () => {
    const w = loadEntities(ENTITIES).entities[1] as WipeoutEntity;
    expect(w.type).toBe("WIPEOUT");
    expect(w.imageDefHandle).toBeUndefined();
    expect(w.clipping).toBe(true);
    expect(w.clipType).toBe(2);
    expect(w.clipBoundary).toHaveLength(3);
    expect(w.u.x).toBeCloseTo(31.70774292607268);
    expect(w.proxyGraphics).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it("reads underlay references", () => {
    const u = loadEntities(ENTITIES).entities[2] as UnderlayEntity;
    expect(u.type).toBe("PDFUNDERLAY");
    expect(u.definitionHandle).toBe("D06");
    expect(u.insert).toEqual({ x: 16.28692563580262, y: 15, z: 0 });
    expect(u.scale).toEqual({ x: 2, y: 2, z: 1 });
    expect(u.rotation).toBe(45);
    expect(u.flags).toBe(3);
    expect(u.contrast).toBe(100);
    expect(u.clipBoundary).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 4 },
    ]);
    expect(u.color).toBe(193);
  });

  it("reads OLE2FRAME corners and binary payload", () => {
    const o = loadEntities(ENTITIES).entities[3] as Ole2FrameEntity;
    expect(o.type).toBe("OLE2FRAME");
    expect(o.description).toBe("Paintbrush Picture");
    expect(o.upperLeft).toEqual({ x: 0, y: 0, z: 0 });
    expect(o.lowerRight).toEqual({ x: 10, y: -5, z: 0 });
    expect(o.objectType).toBe(3);
    expect(o.dataLength).toBe(8);
    expect([...o.data]).toEqual([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe]);
  });
});
