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

// Objects generated with ezdxf 1.4.4 (R2018), trimmed to one dictionary level. Added or changed
// by hand: the CANNOSCALE variable, the MLEADERSTYLE 340 linetype handle and 296 annotative flag,
// the SPATIAL_FILTER inverse insert matrix (ezdxf writes identity; this is the inverse of an
// INSERT at (50, 20) scaled by 2), and the SCALE and TABLESTYLE records (ezdxf does not write
// those). The XRECORD data starts with a 102 that is data, not a control group.
const OBJECTS = `
  0 DICTIONARY
  5 A
330 0
100 AcDbDictionary
281 1
  3 AcDbVariableDictionary
350 36
  0 DICTIONARY
  5 36
330 A
100 AcDbDictionary
281 1
  3 CANNOSCALE
350 40
  3 WIPEOUTFRAME
350 37
  0 DICTIONARYVAR
  5 40
330 36
100 DictionaryVariables
280 0
  1 1:4
  0 DICTIONARYVAR
  5 37
330 36
100 DictionaryVariables
280 0
  1 1
  0 MLEADERSTYLE
  5 2C
102 {ACAD_REACTORS
330 F
102 }
330 F
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
340 25
 92 -2
290 1
 42 2.0
291 1
 43 8.0
  3 Standard
 44 4.0
300
342 29
174 1
175 1
176 0
178 1
 93 -1056964608
 45 4.0
292 0
297 0
 46 4.0
 94 -1056964608
 47 1.0
 49 1.0
140 1.0
294 1
141 0.0
177 0
142 1.0
295 0
296 1
143 3.75
271 0
272 9
273 9
  0 MLINESTYLE
  5 3E
102 {ACAD_REACTORS
330 10
102 }
330 10
100 AcDbMlineStyle
  2 TWOLINE
 70 0
  3 two lines
 62 256
 51 90.0
 52 90.0
 71 2
 49 0.25
 62 1
  6 BYLAYER
 49 -0.25
 62 256
  6 DASHED
  0 IMAGEDEF
  5 31
102 {ACAD_REACTORS
330 30
330 33
102 }
330 30
100 AcDbRasterImageDef
 90 0
  1 photos\\site.png
 10 640.0
 20 480.0
 11 0.01
 21 0.01
280 1
281 2
  0 IMAGEDEF_REACTOR
  5 33
330 32
100 AcDbRasterImageDefReactor
 90 2
330 32
  0 RASTERVARIABLES
  5 2F
102 {ACAD_REACTORS
330 A
102 }
330 A
100 AcDbRasterVariables
 90 0
 70 1
 71 1
 72 2
  0 WIPEOUTVARIABLES
  5 35
102 {ACAD_REACTORS
330 A
102 }
330 A
100 AcDbWipeoutVariables
 70 1
  0 PDFDEFINITION
  5 39
102 {ACAD_REACTORS
330 38
330 3A
102 }
330 38
100 AcDbUnderlayDefinition
  1 plans\\level-1.pdf
  2 2
  0 GROUP
  5 3D
102 {ACAD_REACTORS
330 C
102 }
330 C
100 AcDbGroup
300 door frame
 70 1
 71 1
340 3B
340 3C
  0 SCALE
  5 50
330 14
100 AcDbScale
 70 0
300 1:4
140 1.0
141 4.0
290 0
  0 SPATIAL_FILTER
  5 47
102 {ACAD_REACTORS
330 46
102 }
330 46
100 AcDbFilter
100 AcDbSpatialFilter
 70 2
 10 -4.0
 20 -3.0
 10 6.0
 20 5.0
210 0.0
220 0.0
230 1.0
 11 0.0
 21 0.0
 31 0.0
 71 1
 72 0
 73 0
 40 0.5
 40 0.0
 40 0.0
 40 -25.0
 40 0.0
 40 0.5
 40 0.0
 40 -10.0
 40 0.0
 40 0.0
 40 0.5
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
  5 51
330 15
100 AcDbTableStyle
280 0
  3 Schedule
 70 0
 71 0
 40 0.75
 41 0.5
280 0
281 0
  7 Standard
140 2.5
170 5
 62 0
 63 8
283 0
 90 512
 91 0
  1
274 -2
284 1
 64 0
  7 Headings
140 3.5
170 2
 62 3
 63 7
283 1
  0 XRECORD
  5 48
330 A
100 AcDbXrecord
280 1
102 TRUEDXF_DATA
 10 1.5
 20 -2.0
 30 0.25
 70 12
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
    expect(vars.get("CANNOSCALE")).toBe("1:4");
    expect(vars.get("WIPEOUTFRAME")).toBe("1");
  });

  it("reads MLEADERSTYLE and MLINESTYLE", () => {
    const { doc } = loadObjects(OBJECTS);
    const ml = doc.getObject("2C") as MLeaderStyleObject;
    expect(ml.type).toBe("MLEADERSTYLE");
    expect(ml.contentType).toBe(2);
    expect(ml.landingGap).toBe(2);
    expect(ml.doglegLength).toBe(8);
    expect(ml.arrowSize).toBe(4);
    expect(ml.textHeight).toBe(4);
    expect(ml.textStyleHandle).toBe("29");
    expect(ml.leaderLinetypeHandle).toBe("25");
    expect(ml.arrowHandle).toBeUndefined();
    expect(ml.blockScale).toEqual({ x: 1, y: 1, z: 1 });
    expect(ml.annotative).toBe(true);
    expect(ml.breakGapSize).toBe(3.75);
    const mls = doc.getObject("3E") as MLineStyleObject;
    expect(mls.name).toBe("TWOLINE");
    expect(mls.flags).toBe(0);
    expect(mls.fillColor).toBe(256);
    expect(mls.elements).toEqual([
      { offset: 0.25, color: 1, trueColor: undefined, linetype: "BYLAYER" },
      { offset: -0.25, color: 256, trueColor: undefined, linetype: "DASHED" },
    ]);
  });

  it("reads raster and underlay definition objects", () => {
    const { doc } = loadObjects(OBJECTS);
    const def = doc.getObject("31") as ImageDefObject;
    expect(def.fileName).toBe("photos\\site.png");
    expect(def.size).toEqual({ x: 640, y: 480 });
    expect(def.pixelSize).toEqual({ x: 0.01, y: 0.01 });
    expect(def.loaded).toBe(true);
    expect(def.resolutionUnits).toBe(2);
    expect((doc.getObject("33") as ImageDefReactorObject).imageHandle).toBe("32");
    expect((doc.getObject("2F") as RasterVariablesObject).frame).toBe(1);
    expect((doc.getObject("2F") as RasterVariablesObject).units).toBe(2);
    expect((doc.getObject("35") as WipeoutVariablesObject).frame).toBe(1);
    const pdf = doc.getObject("39") as UnderlayDefinitionObject;
    expect(pdf.fileName).toBe("plans\\level-1.pdf");
    expect(pdf.name).toBe("2");
  });

  it("reads GROUP, SCALE, TABLESTYLE", () => {
    const { doc } = loadObjects(OBJECTS);
    const g = doc.getObject("3D") as GroupObject;
    expect(g.description).toBe("door frame");
    expect(g.unnamed).toBe(true);
    expect(g.memberHandles).toEqual(["3B", "3C"]);
    const s = doc.getObject("50") as ScaleObject;
    expect(s.name).toBe("1:4");
    expect(s.drawingUnits).toBe(4);
    const ts = doc.getObject("51") as TableStyleObject;
    expect(ts.description).toBe("Schedule");
    expect(ts.horizontalMargin).toBe(0.75);
    expect(ts.cells).toHaveLength(2);
    expect(ts.cells[0]).toMatchObject({
      textStyle: "Standard",
      textHeight: 2.5,
      alignment: 5,
      fillColor: 8,
    });
    expect(ts.cells[1]).toMatchObject({
      textStyle: "Headings",
      textHeight: 3.5,
      textColor: 3,
      fillEnabled: true,
    });
  });

  it("reads SPATIAL_FILTER boundary and both matrices", () => {
    const { doc } = loadObjects(OBJECTS);
    const f = doc.getObject("47") as SpatialFilterObject;
    expect(f.boundary).toEqual([
      { x: -4, y: -3 },
      { x: 6, y: 5 },
    ]);
    expect(f.enabled).toBe(true);
    expect(f.frontClip).toBeUndefined();
    expect(f.inverseInsertMatrix).toEqual([0.5, 0, 0, -25, 0, 0.5, 0, -10, 0, 0, 0.5, 0]);
    expect(f.clipMatrix).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  });

  it("exposes XRECORD payloads and generic record tags", () => {
    const { doc } = loadObjects(OBJECTS);
    const x = doc.getObject("48") as XRecordDataObject;
    expect(x.type).toBe("XRECORD");
    expect(x.cloning).toBe(1);
    expect(x.tags.map((t) => [t.code, t.value])).toEqual([
      [102, "TRUEDXF_DATA"],
      [10, 1.5],
      [20, -2],
      [30, 0.25],
      [70, 12],
    ]);
    const t = recordTags(x.record);
    expect(t.find((e) => e.code === 10)?.value).toEqual({ x: 1.5, y: -2, z: 0.25 });
    expect(recordTags(x.record, { scope: "all" })[0]).toMatchObject({ code: 5, value: "48" });
  });
});
