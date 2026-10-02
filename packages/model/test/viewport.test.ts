import { describe, expect, it } from "vitest";
import { type ViewportEntity, ViewportFlags } from "../src/index.ts";
import { errors, loadEntities } from "./snippets.ts";

// Paper-space viewport generated with ezdxf 1.4.4 (R2018); added by hand as AutoCAD writes
// them: an XDICTIONARY group, frozen layers (331 and 341), status flags, the 340 clip entity,
// UCS per viewport, visual style, ambient light colors.
const VIEWPORT = `
  0 VIEWPORT
  5 2F
102 {ACAD_XDICTIONARY
360 30
102 }
330 1B
100 AcDbEntity
 67 1
  8 VIEWPORTS
100 AcDbViewport
 10 150.0
 20 100.0
 30 0.0
 40 240.0
 41 160.0
 68 2
 69 3
 12 400.0
 22 300.0
 13 0.0
 23 0.0
 14 10.0
 24 10.0
 15 10.0
 25 10.0
 16 0.0
 26 0.0
 36 1.0
 17 0.0
 27 0.0
 37 0.0
 42 50.0
 43 0.0
 44 0.0
 45 80.0
 50 0.0
 51 10.0
 72 100
331 3A
331 3B
341 3C
 90 592544
340 3D
  1 grayscale.ctb
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
348 3E
292 1
282 1
141 0.0
142 0.0
 63 250
421 3355443
`;

// R12 viewport generated with ezdxf 1.4.4: view data in XDATA ACAD/MVIEW; fast zoom, UCS icon,
// grid, snap spacing and hide-plot values set by hand.
const R12 = `
  0 VIEWPORT
  5 2D
 67 1
  8 VIEWPORTS
 10 150.0
 20 100.0
 30 0.0
 40 240.0
 41 160.0
 68 2
 69 3
1001 ACAD
1000 MVIEW
1002 {
1070 16
1010 3.0
1020 4.0
1030 0.0
1010 0.0
1020 0.0
1030 1.0
1040 0
1040 80.0
1040 400.0
1040 300.0
1040 50
1040 0
1040 0
1070 0
1070 500
1070 1
1070 3
1070 0
1070 1
1070 0
1070 0
1040 0
1040 0.0
1040 0.0
1040 2.5
1040 2.5
1040 10.0
1040 10.0
1070 1
1002 {
1003 DIMS
1003 HATCHES
1002 }
1002 }
`;

describe("VIEWPORT", () => {
  it("reads all AcDbViewport codes, frozen layers (331 and 341) and clip entity", () => {
    const { doc } = loadEntities(VIEWPORT);
    const v = doc.paperSpace!.entities[0] as ViewportEntity;
    expect(v.type).toBe("VIEWPORT");
    expect(v.center).toEqual({ x: 150, y: 100, z: 0 });
    expect(v.width).toBe(240);
    expect(v.height).toBe(160);
    expect(v.status).toBe(2);
    expect(v.id).toBe(3);
    expect(v.viewCenter).toEqual({ x: 400, y: 300 });
    expect(v.viewDirection).toEqual({ x: 0, y: 0, z: 1 });
    expect(v.viewTarget).toEqual({ x: 0, y: 0, z: 0 });
    expect(v.viewHeight).toBe(80);
    expect(v.twist).toBe(10);
    expect(v.circleZoom).toBe(100);
    expect(v.frozenLayerHandles).toEqual(["3A", "3B", "3C"]);
    expect(v.flags).toBe(592544);
    expect(v.flags & ViewportFlags.NonRectangularClipping).toBeTruthy();
    expect(v.isOn).toBe(true);
    expect(v.clipBoundaryHandle).toBe("3D");
    expect(v.plotStyleSheet).toBe("grayscale.ctb");
    expect(v.ucsPerViewport).toBe(true);
    expect(v.visualStyleHandle).toBe("3E");
    expect(v.ambientColor).toBe(250);
    expect(v.ambientTrueColor).toBe(3355443);
    expect(v.scale).toBe(2);
    expect(errors(doc)).toEqual([]);
  });

  it("decodes R12 MVIEW XDATA", () => {
    const { doc } = loadEntities(R12, "AC1009");
    const v = doc.paperSpace!.entities[0] as ViewportEntity;
    expect(v.viewTarget).toEqual({ x: 3, y: 4, z: 0 });
    expect(v.viewDirection).toEqual({ x: 0, y: 0, z: 1 });
    expect(v.viewHeight).toBe(80);
    expect(v.viewCenter).toEqual({ x: 400, y: 300 });
    expect(v.lensLength).toBe(50);
    expect(v.circleZoom).toBe(500);
    expect(v.ucsIcon).toBe(3);
    expect(v.snapSpacing).toEqual({ x: 2.5, y: 2.5 });
    expect(v.flags).toBe(ViewportFlags.FastZoom | ViewportFlags.Grid | ViewportFlags.HidePlot);
    expect(v.frozenLayerNames).toEqual(["DIMS", "HATCHES"]);
    expect(v.isOn).toBe(true);
  });
});
