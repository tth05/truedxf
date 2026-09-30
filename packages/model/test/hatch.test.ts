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

// AutoCAD 2018 gradient hatch (ACadSharp sample_AC1032_ascii.dxf, HATCH 376)
const GRADIENT = `
  0 HATCH
  5 376
330 1F
100 AcDbEntity
  8 0
100 AcDbHatch
 10 0.0
 20 0.0
 30 0.0
210 0.0
220 0.0
230 1.0
  2 SOLID,_O
 70 1
 71 1
 91 1
 92 1
 93 4
 72 1
 10 102.7457616028917
 20 49.5096547418996
 11 123.1990874847903
 21 49.5096547418996
 72 1
 10 123.1990874847903
 20 49.5096547418996
 11 123.1990874847903
 21 63.13440569324831
 72 1
 10 123.1990874847903
 20 63.13440569324831
 11 102.7457616028917
 21 63.13440569324831
 72 1
 10 102.7457616028917
 20 63.13440569324831
 11 102.7457616028917
 21 49.5096547418996
 97 1
330 372
 75 1
 76 1
 98 1
 10 0.0
 20 0.0
450 1
451 0
460 0.0
461 0.0
452 0
462 0.0
453 2
463 0.0
 63 5
421 255
463 1.0
 63 2
421 16776960
470 SPHERICAL
1001 GradientColor1ACI
1070 5
1001 GradientColor2ACI
1070 2
1001 ACAD
1010 0.0
1020 0.0
1030 0.0
`;

// AutoCAD 2018 predefined pattern with a polyline path (HATCH BBB, pattern lines shortened to 2)
const PATTERN = `
  0 HATCH
  5 BBB
102 {ACAD_XDICTIONARY
360 BBC
102 }
330 1F
100 AcDbEntity
  8 0
100 AcDbHatch
 10 0.0
 20 0.0
 30 2.5
210 0.0
220 0.0
230 1.0
  2 HSBDR3E0
 70 0
 71 0
 91 1
 92 7
 72 0
 73 1
 93 4
 10 18.38260550487516
 20 -191.5837900662197
 10 14.84707159894242
 20 -191.5837900662197
 10 14.84707159894242
 20 -195.1193239721524
 10 18.38260550487516
 20 -195.1193239721524
 97 0
 75 1
 76 2
 52 0.0
 41 0.1
 77 0
 78 2
 53 71.56504820000001
 43 14.84707159894242
 44 -194.5193239721524
 45 -0.0000000081121132
 46 2.399999954335414
 79 2
 49 0.31622777
 49 -7.27323837
 53 33.6900673
 43 14.94707159894242
 44 -194.2193239721524
 45 0.0000000094658198
 46 2.400000088443181
 79 0
 47 0.05
 98 1
 10 14.8
 20 -194.0
1001 HATCHBACKGROUNDCOLOR
1071 -1023344383
`;

describe("HATCH", () => {
  it("reads edge paths, source handles, seeds and gradient (AutoCAD sample)", () => {
    const { doc, entities } = loadEntities(GRADIENT);
    const h = entities[0] as HatchEntity;
    expect(h.type).toBe("HATCH");
    expect(h.patternName).toBe("SOLID,_O");
    expect(h.solid).toBe(true);
    expect(h.associative).toBe(true);
    expect(h.paths).toHaveLength(1);
    const p = h.paths[0] as HatchEdgePath;
    expect(p.kind).toBe("edges");
    expect(p.flags).toBe(1);
    expect(p.edges).toHaveLength(4);
    expect(p.edges[1]).toEqual({
      type: "line",
      start: { x: 123.1990874847903, y: 49.5096547418996 },
      end: { x: 123.1990874847903, y: 63.13440569324831 },
    });
    expect(p.sourceHandles).toEqual(["372"]);
    expect(h.style).toBe(1);
    expect(h.patternType).toBe(1);
    expect(h.seeds).toEqual([{ x: 0, y: 0 }]);
    expect(h.gradient).toEqual({
      kind: 1,
      oneColor: false,
      colorCount: 2,
      rotation: 0,
      shift: 0,
      tint: 0,
      colors: [
        { position: 0, aci: 5, rgb: 255 },
        { position: 1, aci: 2, rgb: 16776960 },
      ],
      name: "SPHERICAL",
    });
    expect(h.patternLines).toEqual([]);
    expect(errors(doc)).toEqual([]);
  });

  it("reads polyline paths, pattern lines with dashes, pixel size, elevation, background color", () => {
    const h = loadEntities(PATTERN).entities[0] as HatchEntity;
    expect(h.solid).toBe(false);
    expect(h.elevation).toBe(2.5);
    const p = h.paths[0] as HatchPolylinePath;
    expect(p.kind).toBe("polyline");
    expect(p.flags).toBe(7);
    expect(p.closed).toBe(true);
    expect(p.hasBulge).toBe(false);
    expect(p.vertices).toHaveLength(4);
    expect(p.vertices[2]).toEqual({ x: 14.84707159894242, y: -195.1193239721524, bulge: 0 });
    expect(p.sourceHandles).toEqual([]);
    expect(h.patternType).toBe(2);
    expect(h.patternScale).toBe(0.1);
    expect(h.patternLines).toHaveLength(2);
    expect(h.patternLines[0]).toEqual({
      angle: 71.56504820000001,
      base: { x: 14.84707159894242, y: -194.5193239721524 },
      offset: { x: -0.0000000081121132, y: 2.399999954335414 },
      dashes: [0.31622777, -7.27323837],
    });
    expect(h.patternLines[1]!.dashes).toEqual([]);
    expect(h.pixelSize).toBe(0.05);
    expect(h.seeds).toEqual([{ x: 14.8, y: -194 }]);
    expect(h.backgroundColor).toBe(-1023344383);
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
