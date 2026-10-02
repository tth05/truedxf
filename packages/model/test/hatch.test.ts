import { describe, expect, it } from "vitest";
import type {
  HatchArcEdge,
  HatchEdgePath,
  HatchEllipseEdge,
  HatchEntity,
  HatchPolylinePath,
  HatchSplineEdge,
  MPolygonEntity,
} from "../src/index.ts";
import { errors, loadEntities } from "./snippets.ts";

// Gradient hatch generated with ezdxf 1.4.4; added by hand as AutoCAD writes them: associativity
// (71 1) with a 330 source handle, the 63 ACI next to each 421 gradient color, and the
// GradientColor*ACI / ACAD XDATA.
const GRADIENT = `
  0 HATCH
  5 2F
330 17
100 AcDbEntity
  8 0
 62 1
100 AcDbHatch
 10 0.0
 20 0.0
 30 0.0
210 0.0
220 0.0
230 1.0
  2 SOLID
 70 1
 71 1
 91 1
 92 1
 93 4
 72 1
 10 20.0
 20 10.0
 11 45.0
 21 10.0
 72 1
 10 45.0
 20 10.0
 11 45.0
 21 30.0
 72 1
 10 45.0
 20 30.0
 11 20.0
 21 30.0
 72 1
 10 20.0
 20 30.0
 11 20.0
 21 10.0
 97 1
330 2E
 75 1
 76 1
 98 1
 10 30
 20 20
450 1
451 0
460 0.5235987755982988
461 0.0
452 0
462 0.0
453 2
463 0
 63 5
421 200
463 1
 63 2
421 15779850
470 CYLINDER
1001 GradientColor1ACI
1070 5
1001 GradientColor2ACI
1070 2
1001 ACAD
1010 0.0
1020 0.0
1030 0.0
`;

// Predefined pattern with a polyline path, generated with ezdxf 1.4.4 (ANSI33, scale 0.5, angle
// 15); the XDICTIONARY group, 47 pixel size and HATCHBACKGROUNDCOLOR XDATA added by hand.
const PATTERN = `
  0 HATCH
  5 30
102 {ACAD_XDICTIONARY
360 31
102 }
330 17
100 AcDbEntity
  8 0
 62 7
100 AcDbHatch
 10 0.0
 20 0.0
 30 1.25
210 0.0
220 0.0
230 1.0
  2 ANSI33
 70 0
 71 0
 91 1
 92 7
 72 0
 73 1
 93 4
 10 -3.5
 20 12.25
 10 8.0
 20 12.25
 10 8.0
 20 20.75
 10 -3.5
 20 20.75
 97 0
 75 1
 76 1
 52 15.0
 41 0.5
 77 0
 78 2
 53 60.0
 43 0.0
 44 0.0
 45 -2.749630657
 46 1.5875
 79 0
 53 60.0
 43 2.1685653249
 44 0.5810653275
 45 -2.749630657
 46 1.5875
 79 2
 49 1.5875
 49 -0.79375
 47 0.025
 98 1
 10 2.25
 20 16.5
1001 HATCHBACKGROUNDCOLOR
1071 -1023410170
`;

describe("HATCH", () => {
  it("reads edge paths, source handles, seeds and gradient", () => {
    const { doc, entities } = loadEntities(GRADIENT);
    const h = entities[0] as HatchEntity;
    expect(h.type).toBe("HATCH");
    expect(h.patternName).toBe("SOLID");
    expect(h.solid).toBe(true);
    expect(h.associative).toBe(true);
    expect(h.paths).toHaveLength(1);
    const p = h.paths[0] as HatchEdgePath;
    expect(p.kind).toBe("edges");
    expect(p.flags).toBe(1);
    expect(p.edges).toHaveLength(4);
    expect(p.edges[1]).toEqual({
      type: "line",
      start: { x: 45, y: 10 },
      end: { x: 45, y: 30 },
    });
    expect(p.sourceHandles).toEqual(["2E"]);
    expect(h.style).toBe(1);
    expect(h.patternType).toBe(1);
    expect(h.seeds).toEqual([{ x: 30, y: 20 }]);
    expect(h.gradient).toEqual({
      kind: 1,
      oneColor: false,
      colorCount: 2,
      rotation: 0.5235987755982988,
      shift: 0,
      tint: 0,
      colors: [
        { position: 0, aci: 5, rgb: 200 },
        { position: 1, aci: 2, rgb: 15779850 },
      ],
      name: "CYLINDER",
    });
    expect(h.patternLines).toEqual([]);
    expect(errors(doc)).toEqual([]);
  });

  it("reads polyline paths, pattern lines with dashes, pixel size, elevation, background color", () => {
    const h = loadEntities(PATTERN).entities[0] as HatchEntity;
    expect(h.solid).toBe(false);
    expect(h.elevation).toBe(1.25);
    const p = h.paths[0] as HatchPolylinePath;
    expect(p.kind).toBe("polyline");
    expect(p.flags).toBe(7);
    expect(p.closed).toBe(true);
    expect(p.hasBulge).toBe(false);
    expect(p.vertices).toHaveLength(4);
    expect(p.vertices[2]).toEqual({ x: 8, y: 20.75, bulge: 0 });
    expect(p.sourceHandles).toEqual([]);
    expect(h.patternType).toBe(1);
    expect(h.patternAngle).toBe(15);
    expect(h.patternScale).toBe(0.5);
    expect(h.patternLines).toHaveLength(2);
    expect(h.patternLines[0]!.dashes).toEqual([]);
    expect(h.patternLines[1]).toEqual({
      angle: 60,
      base: { x: 2.1685653249, y: 0.5810653275 },
      offset: { x: -2.749630657, y: 1.5875 },
      dashes: [1.5875, -0.79375],
    });
    expect(h.pixelSize).toBe(0.025);
    expect(h.seeds).toEqual([{ x: 2.25, y: 16.5 }]);
    expect(h.backgroundColor).toBe(-1023410170);
  });

  it("reads arc, ellipse and spline edges incl. bulges and R2010 fit data", () => {
    const { doc, entities } = loadEntities(`
  0 HATCH
  5 40
100 AcDbEntity
  8 0
100 AcDbHatch
 10 0
 20 0
 30 0
210 0
220 0
230 1
  2 SOLID
 70 1
 71 1
 91 3
 92 2
 72 1
 73 1
 93 2
 10 0
 20 0
 42 1
 10 10
 20 0
 42 -0.5
 97 1
330 A1
 92 1
 93 3
 72 2
 10 5
 20 5
 40 2
 50 270
 51 360
 73 0
 72 3
 10 1
 20 2
 11 3
 21 0
 40 0.5
 50 0
 51 180
 73 1
 72 4
 94 3
 73 0
 74 0
 95 8
 96 4
 40 0
 40 0
 40 0
 40 0
 40 1
 40 1
 40 1
 40 1
 10 0
 20 0
 10 1
 20 1
 10 2
 20 1
 10 3
 20 0
 97 2
 11 0
 21 0
 11 3
 21 0
 12 1
 22 1
 13 1
 23 -1
 97 2
330 B1
330 B2
 92 1
 93 2
 72 4
 94 3
 73 1
 74 0
 95 4
 96 2
 40 0
 40 0
 40 1
 40 1
 10 0
 20 0
 42 1
 10 1
 20 1
 42 0.5
 97 0
 72 1
 10 1
 20 1
 11 0
 21 0
 97 0
 75 0
 76 1
 98 0
`);
    const h = entities[0] as HatchEntity;
    expect(h.paths).toHaveLength(3);
    const pl = h.paths[0] as HatchPolylinePath;
    expect(pl.hasBulge).toBe(true);
    expect(pl.vertices).toEqual([
      { x: 0, y: 0, bulge: 1 },
      { x: 10, y: 0, bulge: -0.5 },
    ]);
    expect(pl.sourceHandles).toEqual(["A1"]);
    const ep = h.paths[1] as HatchEdgePath;
    expect(ep.edges.map((e) => e.type)).toEqual(["arc", "ellipse", "spline"]);
    expect(ep.edges[0] as HatchArcEdge).toEqual({
      type: "arc",
      center: { x: 5, y: 5 },
      radius: 2,
      startAngle: 270,
      endAngle: 360,
      ccw: false,
    });
    expect(ep.edges[1] as HatchEllipseEdge).toEqual({
      type: "ellipse",
      center: { x: 1, y: 2 },
      majorAxis: { x: 3, y: 0 },
      ratio: 0.5,
      startAngle: 0,
      endAngle: 180,
      ccw: true,
    });
    const sp = ep.edges[2] as HatchSplineEdge;
    expect(sp.degree).toBe(3);
    expect(sp.knots).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(sp.controlPoints).toHaveLength(4);
    expect(sp.weights).toEqual([]);
    expect(sp.fitPoints).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(sp.startTangent).toEqual({ x: 1, y: 1 });
    expect(sp.endTangent).toEqual({ x: 1, y: -1 });
    expect(ep.sourceHandles).toEqual(["B1", "B2"]);
    // spline edge that is not the last edge: its 97 is the fit-point count
    const p3 = h.paths[2] as HatchEdgePath;
    expect(p3.edges.map((e) => e.type)).toEqual(["spline", "line"]);
    const sp2 = p3.edges[0] as HatchSplineEdge;
    expect(sp2.rational).toBe(true);
    expect(sp2.weights).toEqual([1, 0.5]);
    expect(sp2.fitPoints).toEqual([]);
    expect(p3.sourceHandles).toEqual([]);
    expect(h.style).toBe(0);
    expect(errors(doc)).toEqual([]);
  });
});

describe("HATCH spline weights", () => {
  it("accepts weights written as 40 after each control point (DWG code) for rational splines", () => {
    const h = loadEntities(`
  0 HATCH
  5 60
100 AcDbEntity
  8 0
100 AcDbHatch
 10 0
 20 0
 30 0
  2 ANSI31
 70 0
 71 0
 91 1
 92 5
 93 2
 72 4
 94 2
 73 1
 74 0
 95 6
 96 3
 40 0
 40 0
 40 0
 40 1
 40 1
 40 1
 10 0
 20 0
 40 1
 10 1
 20 1
 40 0.7
 10 2
 20 0
 40 1
 72 1
 10 2
 20 0
 11 0
 21 0
 97 0
 75 0
 76 1
 78 0
 98 0
`).entities[0] as HatchEntity;
    const p = h.paths[0] as HatchEdgePath;
    expect(p.edges.map((e) => e.type)).toEqual(["spline", "line"]);
    const sp = p.edges[0] as HatchSplineEdge;
    expect(sp.controlPoints).toHaveLength(3);
    expect(sp.weights).toEqual([1, 0.7, 1]);
    expect(sp.knots).toHaveLength(6);
  });
});

describe("MPOLYGON", () => {
  it("reads the MPOLYGON layout (73 before 72, fill color, offset vector)", () => {
    const { doc, entities } = loadEntities(`
  0 MPOLYGON
  5 50
100 AcDbEntity
  8 0
100 AcDbMPolygon
 70 1
 10 0
 20 0
 30 0
210 0
220 0
230 1
  2 SOLID
 71 1
 91 1
 92 2
 73 1
 72 0
 93 3
 10 0
 20 0
 10 4
 20 0
 10 4
 20 3
 76 1
 73 0
 63 3
 11 0.5
 21 0.25
 99 0
450 0
451 0
460 0
461 0
452 0
462 0
453 0
470 LINEAR
`);
    const m = entities[0] as MPolygonEntity;
    expect(m.type).toBe("MPOLYGON");
    expect(m.version).toBe(1);
    expect(m.solid).toBe(true);
    expect(m.fillColor).toBe(3);
    expect(m.offsetVector).toEqual({ x: 0.5, y: 0.25 });
    const p = m.paths[0] as HatchPolylinePath;
    expect(p.closed).toBe(true);
    expect(p.vertices).toHaveLength(3);
    expect(m.gradient?.kind).toBe(0);
    expect(errors(doc)).toEqual([]);
  });
});
