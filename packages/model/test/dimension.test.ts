import { describe, expect, it } from "vitest";
import {
  DIM_VAR_BY_CODE,
  DIM_VAR_BY_NAME,
  type DimensionEntity,
  DxfDocument,
  effectiveDimStyle,
  headerDimVars,
  imperialDimDefaults,
} from "../src/index.ts";
import { dxfWith, errors, listing, loadEntities } from "./snippets.ts";

// AutoCAD 2018 dimensions (ACadSharp sample_AC1032_ascii.dxf: 514 aligned, 516 2-line angular,
// 51F radius with DSTYLE override), ARC_DIMENSION from ezdxf examples_dxf/uncommon.dxf (AC1032)
const DIMS = `
  0 DIMENSION
  5 514
330 1F
100 AcDbEntity
  8 Layer1
100 AcDbDimension
280 0
  2 *D3
 10 360.3581002235253
 20 44.29130656278148
 30 0.0
 11 339.0659510877516
 21 34.45477396013389
 31 0.0
 70 32
 71 5
 42 46.71561670814134
 73 0
 74 0
 75 0
  3 ISO-25
100 AcDbAlignedDimension
 13 330.2890594765795
 23 2.941179455067986
 33 0.0
 14 364.4872644138525
 24 37.13938439234094
 34 0.0
 50 30.00000000000059
100 AcDbRotatedDimension
  0 DIMENSION
  5 516
330 1F
100 AcDbEntity
  8 Layer1
100 AcDbDimension
280 0
  2 *D5
 10 512.6794858087018
 20 8.640880277946811
 30 0.0
 11 527.0002178583315
 21 31.58837018239251
 31 0.0
 70 34
 71 5
 42 1.647568218064672
 73 0
 74 0
 75 0
  3 ISO-25
100 AcDb2LineAngularDimension
 13 495.5803833400654
 23 14.34058110082563
 33 0.0
 14 501.2800841629442
 24 37.13938439234094
 34 0.0
 15 495.5803833400654
 25 14.34058110082563
 35 0.0
 16 528.6474703372946
 26 21.99374070687125
 36 0.0
  0 DIMENSION
  5 51F
102 {ACAD_XDICTIONARY
360 520
102 }
102 {ACAD_REACTORS
330 521
102 }
330 1F
100 AcDbEntity
  8 Layer1
100 AcDbDimension
280 0
  2 *D10
 10 569.6764940374901
 20 25.73998274658328
 30 0.0
 11 583.3484821823942
 21 42.4205510740598
 31 0.0
 70 36
 71 5
 42 11.3994016457579
 73 0
 74 0
 75 0
  3 ISO-25
100 AcDbRadialDimension
 15 577.7370882426746
 25 33.80057695176783
 35 0.0
 40 0.0
1001 ACAD
1000 DSTYLE
1002 {
1070 288
1070 1
1070 44
1040 2.0
1070 343
1005 4A4
1070 3
1000 <>mm
1002 }
1001 ACAD_DSTYLE_DIMRADIAL_EXTENSION
1070 387
1070 1
  0 ARC_DIMENSION
  5 3F6
330 1F
100 AcDbEntity
  8 0
100 AcDbDimension
280 0
  2 *D19
 10 68.06288715462068
 20 54.35965668782079
 30 0.0
 11 67.29396625106629
 21 55.51801510380557
 31 0.0
 70 37
 71 5
 42 8.549710556238617
 73 0
 74 0
 75 0
  3 Standard
100 AcDbArcDimension
 13 68.11342579170096
 23 51.14722058669588
 33 0.0
 14 63.13537936201239
 24 57.09329721686422
 34 0.0
 15 62.48195423091837
 25 51.48940586338991
 35 0.0
 70 0
 40 6.222496893710236
 41 1.45471846497695
 71 0
 16 63.13537936201239
 26 57.09329721686422
 36 0.0
 17 0.0
 27 0.0
 37 0.0
`;

// AutoCAD 2018 DIMSTYLE records (same sample): ISO-25 writes only values that differ from the
// imperial defaults; custom_dim_style has the second 70 (DIMTFILLCLR) and XDATA extensions.
const DIMSTYLES = `
  0 TABLE
  2 DIMSTYLE
  5 A
100 AcDbSymbolTable
 70 3
  0 DIMSTYLE
105 27
330 A
100 AcDbSymbolTableRecord
100 AcDbDimStyleTableRecord
  2 Standard
 70 0
340 11
  0 DIMSTYLE
105 39A
330 A
100 AcDbSymbolTableRecord
100 AcDbDimStyleTableRecord
  2 ISO-25
 70 0
 41 2.5
 42 0.625
 43 3.75
 44 1.25
 73 0
 74 0
 77 1
 78 8
140 2.5
141 2.5
143 0.03937007874016
147 0.625
171 3
172 1
271 2
272 2
274 3
278 44
283 0
284 8
340 11
  0 DIMSTYLE
105 994
330 A
100 AcDbSymbolTableRecord
100 AcDbDimStyleTableRecord
  2 custom_dim_style
 70 0
 69 2
 70 97
176 86
177 183
178 151
340 11
1001 ACAD_DSTYLE_DIMBREAK
1070 391
1040 0.25
1001 ACAD_DSTYLE_DIM_LINETYPE
1070 380
1005 6D9
  0 ENDTAB
`;

describe("DIMENSION", () => {
  it("reads common data, subtype definition points and flags (AutoCAD samples)", () => {
    const { doc, entities } = loadEntities(DIMS);
    const [lin, ang, rad, arc] = entities as DimensionEntity[];
    expect(lin!.type).toBe("DIMENSION");
    expect(lin!.subtype).toBe("linear");
    expect(lin!.blockName).toBe("*D3");
    expect(lin!.dimStyle).toBe("ISO-25");
    expect(lin!.flags).toBe(32);
    expect(lin!.defPoint).toEqual({ x: 360.3581002235253, y: 44.29130656278148, z: 0 });
    expect(lin!.textMidpoint).toEqual({ x: 339.0659510877516, y: 34.45477396013389, z: 0 });
    expect(lin!.defPoint2).toEqual({ x: 330.2890594765795, y: 2.941179455067986, z: 0 });
    expect(lin!.defPoint3).toEqual({ x: 364.4872644138525, y: 37.13938439234094, z: 0 });
    expect(lin!.angle).toBeCloseTo(30);
    expect(lin!.measurement).toBeCloseTo(46.71561670814134);
    expect(lin!.attachment).toBe(5);
    expect(lin!.textOverride).toBeUndefined();
    expect(lin!.overrides.size).toBe(0);

    expect(ang!.subtype).toBe("angular");
    expect(ang!.dimType).toBe(2);
    expect(ang!.defPoint5).toEqual({ x: 528.6474703372946, y: 21.99374070687125, z: 0 });

    expect(rad!.subtype).toBe("radius");
    expect(rad!.defPoint4).toEqual({ x: 577.7370882426746, y: 33.80057695176783, z: 0 });
    expect(rad!.leaderLength).toBe(0);
    expect([...rad!.overrides]).toEqual([
      [288, 1],
      [44, 2],
      [343, "4A4"],
      [3, "<>mm"],
    ]);

    expect(arc!.type).toBe("ARC_DIMENSION");
    expect(arc!.subtype).toBe("arc");
    // 70 of AcDbDimension (type 5 | 32) vs. 70 of AcDbArcDimension (is partial)
    expect(arc!.flags).toBe(37);
    expect(arc!.isPartial).toBe(false);
    expect(arc!.hasLeader).toBe(false);
    expect(arc!.arcStart).toBeCloseTo(6.222496893710236);
    expect(arc!.arcEnd).toBeCloseTo(1.45471846497695);
    // 41 of AcDbArcDimension must not become the line spacing factor
    expect(arc!.lineSpacingFactor).toBe(1);
    expect(arc!.defPoint4).toEqual({ x: 62.48195423091837, y: 51.48940586338991, z: 0 });
    expect(arc!.defPoint6).toEqual({ x: 0, y: 0, z: 0 });
    expect(errors(doc)).toEqual([]);
  });

  it("reads R12 dimensions without subclass markers and flags", () => {
    const { entities } = loadEntities(
      `
  0 DIMENSION
  8 0
  2 *D1
 10 10
 20 0
 11 5
 21 1
 70 164
  1 R<>
 13 0
 23 0
 14 10
 24 0
 15 3
 25 4
 40 2.5
`,
      "AC1009",
    );
    const d = entities[0] as DimensionEntity;
    expect(d.subtype).toBe("radius");
    expect(d.userTextPosition).toBe(true);
    expect(d.textOverride).toBe("R<>");
    expect(d.defPoint4).toEqual({ x: 3, y: 4, z: 0 });
    expect(d.leaderLength).toBe(2.5);
  });
});

describe("DIMSTYLE", () => {
  it("maps group codes to variable names with imperial defaults", () => {
    expect(DIM_VAR_BY_CODE.get(41)?.name).toBe("DIMASZ");
    expect(DIM_VAR_BY_NAME.get("DIMTFILLCLR")?.code).toBe(70);
    const d = imperialDimDefaults();
    expect(d.DIMASZ).toBe(0.18);
    expect(d.DIMTXT).toBe(0.18);
    expect(d.DIMTIH).toBe(true);
    expect(d.DIMTAD).toBe(0);
    expect(d.DIMDEC).toBe(4);
    expect(d.DIMDSEP).toBe(46);
    expect(d.DIMALTF).toBe(25.4);
    expect(d.DIMLWD).toBe(-2);
  });

  it("resolves override > DIMSTYLE record > imperial default", () => {
    const doc = DxfDocument.load(dxfWith({ tables: DIMSTYLES, entities: DIMS }));
    const iso = doc.tables.dimstyles.get("iso-25")!;
    const standard = doc.tables.dimstyles.get("Standard")!;
    const std = effectiveDimStyle(standard);
    expect(std.DIMASZ).toBe(0.18);
    expect(std.DIMTXSTY).toBe("11");
    expect(std.DIMTOFL).toBe(false);
    const e = effectiveDimStyle(iso);
    expect(e.DIMASZ).toBe(2.5);
    expect(e.DIMTIH).toBe(false);
    expect(e.DIMTAD).toBe(1);
    expect(e.DIMDSEP).toBe(44);
    expect(e.DIMCLRD).toBe(0);
    expect(e.DIMLFAC).toBe(1);
    const rad = doc.getEntity("51F") as DimensionEntity;
    const o = effectiveDimStyle(iso, rad.overrides);
    expect(o.DIMUPT).toBe(true);
    expect(o.DIMEXE).toBe(2);
    expect(o.DIMBLK1).toBe("4A4");
    expect(o.DIMPOST).toBe("<>mm");
    expect(o.DIMASZ).toBe(2.5);
    // missing style → built-in defaults
    expect(effectiveDimStyle(undefined).DIMGAP).toBe(0.09);
  });

  it("reads the second 70 as DIMTFILLCLR and the ACAD_DSTYLE_* XDATA extensions", () => {
    const doc = DxfDocument.load(dxfWith({ tables: DIMSTYLES }));
    const c = doc.tables.dimstyles.get("custom_dim_style")!;
    const e = effectiveDimStyle(c);
    expect(e.DIMTFILL).toBe(2);
    expect(e.DIMTFILLCLR).toBe(97);
    expect(e.DIMCLRD).toBe(86);
    expect(e.DIMBREAK).toBe(0.25);
    expect(e.DIMLTYPE).toBe("6D9");
    expect(e.DIMJAG).toBe(1.5);
  });

  it("reads header $DIM* values but never uses them as fallback by default", () => {
    const tags = listing(`
  0 SECTION
  2 HEADER
  9 $ACADVER
  1 AC1032
  9 $DIMASZ
 40 5.0
  9 $DIMTAD
 70 1
  9 $DIMBLK
  1 BoxBlank
  0 ENDSEC
  0 EOF
`);
    const text = `${tags.map(([c, v]) => `${c}\r\n${v}`).join("\r\n")}\r\n`;
    const doc = DxfDocument.load(new TextEncoder().encode(text));
    expect(headerDimVars(doc.header)).toEqual({ DIMASZ: 5, DIMTAD: 1, DIMBLK: "BoxBlank" });
    expect(effectiveDimStyle(undefined).DIMASZ).toBe(0.18);
    const h = effectiveDimStyle(undefined, undefined, { fallback: "header", header: doc.header });
    expect(h.DIMASZ).toBe(5);
    expect(h.DIMTAD).toBe(1);
    expect(h.DIMEXO).toBe(0.0625);
  });
});
