import { describe, expect, it } from "vitest";
import type { ImageEntity, Ole2FrameEntity, UnderlayEntity, WipeoutEntity } from "../src/index.ts";
import { errors, loadEntities } from "./snippets.ts";

// IMAGE, WIPEOUT and PDFUNDERLAY generated with ezdxf 1.4.4 (R2018); the WIPEOUT 160/310 proxy
// graphics and the underlay 420 true color added by hand. OLE2FRAME hand-written (ezdxf cannot
// create one); the payload bytes are arbitrary.
const ENTITIES = `
  0 IMAGE
  5 32
330 17
100 AcDbEntity
  8 0
100 AcDbRasterImage
 90 0
 10 5.0
 20 10.0
 30 0.0
 11 0.05
 21 0.0
 31 0.0
 12 3.061616997868383e-18
 22 0.05
 32 0.0
 13 640.0
 23 480.0
340 31
 70 7
280 0
281 50
282 50
283 0
360 33
 71 1
 91 2
 14 0.0
 24 0.0
 14 639.0
 24 479.0
290 0
  0 WIPEOUT
  5 34
330 17
100 AcDbEntity
  8 0
160 8
310 0102030405060708
100 AcDbWipeout
 90 0
 10 100.0
 20 0.0
 30 0.0
 11 20.0
 21 0.0
 31 0.0
 12 0.0
 22 15.0
 32 0.0
 13 1.0
 23 1.0
340 0
 70 7
280 1
281 50
282 50
283 0
360 0
 71 2
 91 4
 14 -0.5
 24 0.5
 14 0.5
 24 0.5
 14 0.0
 24 -0.5
 14 -0.5
 24 0.5
290 0
  0 PDFUNDERLAY
  5 3A
330 17
100 AcDbEntity
  8 0
 62 3
420 3394611
100 AcDbUnderlayReference
340 39
 10 200.0
 20 50.0
 30 0.0
 41 3.0
 42 3.0
 43 1.0
 50 30.0
280 1
281 100
282 0
 11 0
 21 0
 11 8
 21 6
  0 OLE2FRAME
  5 3F
100 AcDbEntity
  8 0
100 AcDbOle2Frame
 70 2
  3 Test Object
 10 2.0
 20 8.0
 30 0.0
 11 12.0
 21 3.0
 31 0.0
 71 2
 72 1
 90 6
310 A1B2C3
310 D4E5F6
  1 OLE
`;

describe("IMAGE / WIPEOUT / UNDERLAY / OLE2FRAME", () => {
  it("reads raster image placement, display flags and clip boundary", () => {
    const { doc, entities } = loadEntities(ENTITIES);
    const img = entities[0] as ImageEntity;
    expect(img.type).toBe("IMAGE");
    expect(img.insert).toEqual({ x: 5, y: 10, z: 0 });
    expect(img.u).toEqual({ x: 0.05, y: 0, z: 0 });
    expect(img.v).toEqual({ x: 3.061616997868383e-18, y: 0.05, z: 0 });
    expect(img.size).toEqual({ x: 640, y: 480 });
    expect(img.imageDefHandle).toBe("31");
    expect(img.imageDefReactorHandle).toBe("33");
    expect(img.displayFlags).toBe(7);
    expect(img.clipping).toBe(false);
    expect(img.brightness).toBe(50);
    expect(img.clipType).toBe(1);
    expect(img.clipBoundary).toEqual([
      { x: 0, y: 0 },
      { x: 639, y: 479 },
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
    expect(w.clipBoundary).toHaveLength(4);
    expect(w.u.x).toBe(20);
    expect(w.proxyGraphics).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it("reads underlay references", () => {
    const u = loadEntities(ENTITIES).entities[2] as UnderlayEntity;
    expect(u.type).toBe("PDFUNDERLAY");
    expect(u.definitionHandle).toBe("39");
    expect(u.insert).toEqual({ x: 200, y: 50, z: 0 });
    expect(u.scale).toEqual({ x: 3, y: 3, z: 1 });
    expect(u.rotation).toBe(30);
    expect(u.flags).toBe(1);
    expect(u.contrast).toBe(100);
    expect(u.clipBoundary).toEqual([
      { x: 0, y: 0 },
      { x: 8, y: 6 },
    ]);
    expect(u.color).toBe(3);
  });

  it("reads OLE2FRAME corners and binary payload", () => {
    const o = loadEntities(ENTITIES).entities[3] as Ole2FrameEntity;
    expect(o.type).toBe("OLE2FRAME");
    expect(o.description).toBe("Test Object");
    expect(o.upperLeft).toEqual({ x: 2, y: 8, z: 0 });
    expect(o.lowerRight).toEqual({ x: 12, y: 3, z: 0 });
    expect(o.objectType).toBe(2);
    expect(o.dataLength).toBe(6);
    expect([...o.data]).toEqual([0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6]);
  });
});
