import { describe, expect, it } from "vitest";
import {
  dictionaryVariables,
  type GroupObject,
  type ImageDefObject,
  type ImageDefReactorObject,
  type MLeaderStyleObject,
  type MLineStyleObject,
  type RasterVariablesObject,
  recordTags,
  type ScaleObject,
  type SpatialFilterObject,
  type TableStyleObject,
  type UnderlayDefinitionObject,
  type WipeoutVariablesObject,
  type XRecordDataObject,
} from "../src/index.ts";
import { errors, loadObjects } from "./snippets.ts";

// Object layouts from ACadSharp sample_AC1032_ascii.dxf (AutoCAD 2018)
const OBJECTS = `
  0 DICTIONARY
  5 C
330 0
100 AcDbDictionary
281 1
  3 AcDbVariableDictionary
350 66
  0 DICTIONARY
  5 66
330 C
100 AcDbDictionary
281 1
  3 CANNOSCALE
350 F0
  3 WIPEOUTFRAME
350 F1
  0 DICTIONARYVAR
  5 F0
330 66
100 DictionaryVariables
280 0
  1 1:1
  0 DICTIONARYVAR
  5 F1
330 66
100 DictionaryVariables
280 0
  1 2
  0 MLEADERSTYLE
  5 E5
102 {ACAD_REACTORS
330 D7
102 }
330 D7
100 AcDbMLeaderStyle
179 2
170 2
171 1
172 0
 90 2
 40 0.0
 41 0.0
173 1
 91 -1056964608
340 14
 92 -2
290 1
 42 0.09
291 1
 43 0.36
  3 Standard
 44 0.18
300
342 11
174 1
178 1
175 1
176 0
 93 -1056964608
 45 0.18
292 0
297 0
 46 0.18
 94 -1056964608
 47 1.0
 49 1.0
140 1.0
293 1
141 0.0
294 1
177 0
142 1.0
295 0
296 1
143 0.125
271 0
272 9
273 9
298 0
  0 MLINESTYLE
  5 18
330 17
100 AcDbMlineStyle
  2 STANDARD
 70 1
  3 desc
 62 256
 51 90.0
 52 90.0
 71 2
 49 0.5
 62 1
  6 BYLAYER
 49 -0.5
 62 256
  6 DASHED
  0 IMAGEDEF
  5 8C4
102 {ACAD_REACTORS
330 8C2
330 8C5
102 }
330 8C2
100 AcDbRasterImageDef
 90 0
  1 .\\image.JPG
 10 994.0
 20 965.0
 11 0.2645833333333333
 21 0.2645833333333333
280 1
281 5
  0 IMAGEDEF_REACTOR
  5 8C5
330 8C6
100 AcDbRasterImageDefReactor
 90 2
330 8C6
  0 RASTERVARIABLES
  5 8C3
330 C
100 AcDbRasterVariables
 90 0
 70 1
 71 1
 72 5
  0 WIPEOUTVARIABLES
  5 44E
330 C
100 AcDbWipeoutVariables
 70 1
  0 PDFDEFINITION
  5 D06
330 D04
100 AcDbUnderlayDefinition
  1 ..\\pdf-definition.pdf
  2 1
  0 GROUP
  5 69E
330 D
100 AcDbGroup
300 my group
 70 1
 71 1
340 69D
340 69C
  0 SCALE
  5 B7
330 B6
100 AcDbScale
 70 0
300 1:2
140 1.0
141 2.0
290 0
  0 SPATIAL_FILTER
  5 D32
330 D31
100 AcDbFilter
100 AcDbSpatialFilter
 70 2
 10 46.42855644924885
 20 -35.9902029734044
 10 49.20594578282998
 20 -32.68925562094364
210 0.0
220 0.0
230 1.0
 11 0.0
 21 0.0
 31 0.0
 71 1
 72 0
 73 0
 40 25.4
 40 0.0
 40 0.0
 40 -1087.948660776566
 40 0.0
 40 25.4
 40 0.0
 40 942.6167510625766
 40 0.0
 40 0.0
 40 25.4
 40 0.0
 40 1.0
 40 0.0
 40 0.0
 40 0.0
 40 0.0
 40 1.0
 40 0.0
 40 0.0
 40 0.0
 40 0.0
 40 1.0
 40 0.0
  0 TABLESTYLE
  5 87
330 86
100 AcDbTableStyle
280 0
  3 Standard
 70 0
 71 0
 40 0.06
 41 0.06
280 0
281 0
  7 Standard
140 0.18
170 2
 62 0
 63 7
283 0
 90 512
 91 0
  1
274 -2
284 1
 64 0
  7 Title
140 0.25
170 5
 62 1
 63 7
283 1
  0 XRECORD
  5 A0
330 C
100 AcDbXrecord
280 1
102 VTR_0.000_0.000_1.000
 10 1.0
 20 2.0
 30 3.0
 70 7
`;

describe("objects", () => {
  it("parses all extra object types without errors", () => {
    const { doc } = loadObjects(OBJECTS);
    expect(errors(doc)).toEqual([]);
    const types = doc.objects.map((o) => o.type);
    expect(types).not.toContain("UNKNOWN");
  });

  it("reads DICTIONARYVAR values via the variable dictionary", () => {
    const { doc } = loadObjects(OBJECTS);
    const vars = dictionaryVariables(doc);
    expect(vars.get("CANNOSCALE")).toBe("1:1");
    expect(vars.get("WIPEOUTFRAME")).toBe("2");
  });

  it("reads MLEADERSTYLE and MLINESTYLE", () => {
    const { doc } = loadObjects(OBJECTS);
    const ml = doc.getObject("E5") as MLeaderStyleObject;
    expect(ml.type).toBe("MLEADERSTYLE");
    expect(ml.contentType).toBe(2);
    expect(ml.landingGap).toBe(0.09);
    expect(ml.doglegLength).toBe(0.36);
    expect(ml.arrowSize).toBe(0.18);
    expect(ml.textHeight).toBe(0.18);
    expect(ml.textStyleHandle).toBe("11");
    expect(ml.leaderLinetypeHandle).toBe("14");
    expect(ml.arrowHandle).toBeUndefined();
    expect(ml.blockScale).toEqual({ x: 1, y: 1, z: 1 });
    expect(ml.annotative).toBe(true);
    expect(ml.breakGapSize).toBe(0.125);
    const mls = doc.getObject("18") as MLineStyleObject;
    expect(mls.name).toBe("STANDARD");
    expect(mls.flags).toBe(1);
    expect(mls.fillColor).toBe(256);
    expect(mls.elements).toEqual([
      { offset: 0.5, color: 1, trueColor: undefined, linetype: "BYLAYER" },
      { offset: -0.5, color: 256, trueColor: undefined, linetype: "DASHED" },
    ]);
  });

  it("reads raster and underlay definition objects", () => {
    const { doc } = loadObjects(OBJECTS);
    const def = doc.getObject("8C4") as ImageDefObject;
    expect(def.fileName).toBe(".\\image.JPG");
    expect(def.size).toEqual({ x: 994, y: 965 });
    expect(def.pixelSize).toEqual({ x: 0.2645833333333333, y: 0.2645833333333333 });
    expect(def.loaded).toBe(true);
    expect(def.resolutionUnits).toBe(5);
    expect((doc.getObject("8C5") as ImageDefReactorObject).imageHandle).toBe("8C6");
    expect((doc.getObject("8C3") as RasterVariablesObject).frame).toBe(1);
    expect((doc.getObject("8C3") as RasterVariablesObject).units).toBe(5);
    expect((doc.getObject("44E") as WipeoutVariablesObject).frame).toBe(1);
    const pdf = doc.getObject("D06") as UnderlayDefinitionObject;
    expect(pdf.fileName).toBe("..\\pdf-definition.pdf");
    expect(pdf.name).toBe("1");
  });

  it("reads GROUP, SCALE, TABLESTYLE", () => {
    const { doc } = loadObjects(OBJECTS);
    const g = doc.getObject("69E") as GroupObject;
    expect(g.description).toBe("my group");
    expect(g.unnamed).toBe(true);
    expect(g.memberHandles).toEqual(["69D", "69C"]);
    const s = doc.getObject("B7") as ScaleObject;
    expect(s.name).toBe("1:2");
    expect(s.drawingUnits).toBe(2);
    const ts = doc.getObject("87") as TableStyleObject;
    expect(ts.description).toBe("Standard");
    expect(ts.horizontalMargin).toBe(0.06);
    expect(ts.cells).toHaveLength(2);
    expect(ts.cells[0]).toMatchObject({
      textStyle: "Standard",
      textHeight: 0.18,
      alignment: 2,
      fillColor: 7,
    });
    expect(ts.cells[1]).toMatchObject({
      textStyle: "Title",
      textHeight: 0.25,
      textColor: 1,
      fillEnabled: true,
    });
  });

  it("reads SPATIAL_FILTER boundary and both matrices", () => {
    const { doc } = loadObjects(OBJECTS);
    const f = doc.getObject("D32") as SpatialFilterObject;
    expect(f.boundary).toEqual([
      { x: 46.42855644924885, y: -35.9902029734044 },
      { x: 49.20594578282998, y: -32.68925562094364 },
    ]);
    expect(f.enabled).toBe(true);
    expect(f.frontClip).toBeUndefined();
    expect(f.inverseInsertMatrix).toEqual([
      25.4, 0, 0, -1087.948660776566, 0, 25.4, 0, 942.6167510625766, 0, 0, 25.4, 0,
    ]);
    expect(f.clipMatrix).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  });

  it("exposes XRECORD payloads and generic record tags", () => {
    const { doc } = loadObjects(OBJECTS);
    const x = doc.getObject("A0") as XRecordDataObject;
    expect(x.type).toBe("XRECORD");
    expect(x.cloning).toBe(1);
    expect(x.tags.map((t) => [t.code, t.value])).toEqual([
      [102, "VTR_0.000_0.000_1.000"],
      [10, 1],
      [20, 2],
      [30, 3],
      [70, 7],
    ]);
    const t = recordTags(x.record);
    expect(t.find((e) => e.code === 10)?.value).toEqual({ x: 1, y: 2, z: 3 });
    expect(recordTags(x.record, { scope: "all" })[0]).toMatchObject({ code: 5, value: "A0" });
  });
});
