import { describe, expect, it } from "vitest";
import { type ViewportEntity, ViewportFlags } from "../src/index.ts";
import { errors, loadEntities } from "./snippets.ts";

// AutoCAD 2018 paper-space viewport (ACadSharp sample_AC1032_ascii.dxf, VIEWPORT 245) with
// frozen layers and a clip entity added
const VIEWPORT = `
  0 VIEWPORT
  5 245
102 {ACAD_XDICTIONARY
360 246
102 }
330 58
100 AcDbEntity
 67 1
  8 0
100 AcDbViewport
 10 5.249999761581421
 20 3.999999761581421
 30 0.0
 40 8.399999618530275
 41 6.399999618530274
 68 2
 69 2
 12 6.0
 22 4.5
 13 0.0
 23 0.0
 14 0.5
 24 0.5
 15 0.5
 25 0.5
 16 0.0
 26 0.0
 36 1.0
 17 0.0
 27 0.0
 37 0.0
 42 50.0
 43 0.0
 44 0.0
 45 9.228705435763796
 50 0.0
 51 15.0
 72 1000
331 2A
331 2B
341 2C
 90 885344
340 3F
  1 monochrome.ctb
281 0
 71 1
 74 0
110 0.0
120 0.0
130 0.0
111 1.0
121 0.0
131 0.0
112 0.0
122 1.0
132 0.0
 79 0
146 0.0
170 0
 61 5
348 9F
292 1
282 1
141 0.0
142 0.0
 63 250
421 3355443
`;

// AutoCAD R12 (ACadSharp sample_AC1009_ascii.dxf): view data in XDATA ACAD/MVIEW
const R12 = `
  0 VIEWPORT
  5 26B
 67 1
  8 0
 10 5.6799995242141348
 20 3.966666779180211
 30 0.0
 40 9.0879992387426185
 41 6.3466668466883389
 68 2
 69 2
1001 ACAD
1000 MVIEW
1002 {
1070 16
1010 1.0
1020 2.0
1030 0.0
1010 0.0
1020 0.0
1030 1.0
1040 0.0
1040 9.1088709677419342
1040 6.0
1040 4.5
1040 50.0
1040 0.0
1040 0.0
1070 0
1070 1000
1070 1
1070 3
1070 0
1070 1
1070 0
1070 0
1040 0.0
1040 0.0
1040 0.0
1040 0.5
1040 0.5
1040 0.5
1040 0.5
1070 1
1002 {
1003 HIDDEN
1003 WALLS
1002 }
1002 }
`;

describe("VIEWPORT", () => {
  it("reads all AcDbViewport codes, frozen layers (331 and 341) and clip entity", () => {
    const { doc } = loadEntities(VIEWPORT);
    const v = doc.paperSpace!.entities[0] as ViewportEntity;
    expect(v.type).toBe("VIEWPORT");
    expect(v.center).toEqual({ x: 5.249999761581421, y: 3.999999761581421, z: 0 });
    expect(v.width).toBeCloseTo(8.4);
    expect(v.height).toBeCloseTo(6.4);
    expect(v.status).toBe(2);
    expect(v.id).toBe(2);
    expect(v.viewCenter).toEqual({ x: 6, y: 4.5 });
    expect(v.viewDirection).toEqual({ x: 0, y: 0, z: 1 });
    expect(v.viewTarget).toEqual({ x: 0, y: 0, z: 0 });
    expect(v.viewHeight).toBeCloseTo(9.228705435763796);
    expect(v.twist).toBe(15);
    expect(v.circleZoom).toBe(1000);
    expect(v.frozenLayerHandles).toEqual(["2A", "2B", "2C"]);
    expect(v.flags).toBe(885344);
    expect(v.flags & ViewportFlags.NonRectangularClipping).toBeTruthy();
    expect(v.isOn).toBe(true);
    expect(v.clipBoundaryHandle).toBe("3F");
    expect(v.plotStyleSheet).toBe("monochrome.ctb");
    expect(v.ucsPerViewport).toBe(true);
    expect(v.visualStyleHandle).toBe("9F");
    expect(v.ambientColor).toBe(250);
    expect(v.ambientTrueColor).toBe(3355443);
    expect(v.scale).toBeCloseTo(6.399999618530274 / 9.228705435763796);
    expect(errors(doc)).toEqual([]);
  });

  it("decodes R12 MVIEW XDATA", () => {
    const { doc } = loadEntities(R12, "AC1009");
    const v = doc.paperSpace!.entities[0] as ViewportEntity;
    expect(v.viewTarget).toEqual({ x: 1, y: 2, z: 0 });
    expect(v.viewDirection).toEqual({ x: 0, y: 0, z: 1 });
    expect(v.viewHeight).toBeCloseTo(9.1088709677419342);
    expect(v.viewCenter).toEqual({ x: 6, y: 4.5 });
    expect(v.lensLength).toBe(50);
    expect(v.circleZoom).toBe(1000);
    expect(v.ucsIcon).toBe(3);
    expect(v.snapSpacing).toEqual({ x: 0.5, y: 0.5 });
    expect(v.flags).toBe(ViewportFlags.FastZoom | ViewportFlags.Grid | ViewportFlags.HidePlot);
    expect(v.frozenLayerNames).toEqual(["HIDDEN", "WALLS"]);
    expect(v.isOn).toBe(true);
  });
});
