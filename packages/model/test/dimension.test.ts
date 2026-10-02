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

// Generated with ezdxf 1.4.4 (R2018: aligned, 2-line angular, radius with DSTYLE override, arc
// dimension). Added by hand, because ezdxf does not write them but AutoCAD does: 42 measurement
// (note 05 §1.7), the radius 40 leader length, an XDICTIONARY group, a 343 (DIMBLK1) override
// as 1005 handle, a second XDATA application, and the ARC_DIMENSION 40/41 arc parameters.
const DIMS = `
  0 DIMENSION
  5 30
330 17
100 AcDbEntity
  8 0
100 AcDbDimension
280 0
  2 *D1
  3 METRIC-2
 10 6.6717988226486264
 20 9.992301766027062
 30 0.0
 11 20.839748528310782
 21 21.240377207533825
 31 0.0
 70 32
 71 5
 42 36.05551275463989
  1 <>
100 AcDbAlignedDimension
 13 10.0
 23 5.0
 33 0.0
 14 40.0
 24 25.0
 34 0.0
 50 33.690067525979785
100 AcDbRotatedDimension
  0 DIMENSION
  5 43
330 17
100 AcDbEntity
  8 0
100 AcDbDimension
280 0
  2 *D2
  3 METRIC-2
 10 75.0
 20 30.0
 30 0.0
 11 40.806712952437216
 21 -14.175675350220613
 31 0.0
 70 34
 71 5
 42 0.9420000403794636
  1 <>
100 AcDb2LineAngularDimension
 13 60.0
 23 0.0
 33 0.0
 14 90.0
 24 5.0
 34 0.0
 15 60.0
 25 0.0
 35 0.0
 16 70.0
 26 20.0
 36 0.0
  0 DIMENSION
  5 54
102 {ACAD_XDICTIONARY
360 55
102 }
330 17
100 AcDbEntity
  8 0
100 AcDbDimension
280 0
  2 *D3
  3 METRIC-2
 10 120.0
 20 10.0
 30 0.0
 11 130.90950745381437
 21 21.112274614819825
 31 0.0
 70 36
 71 5
 42 8.0
  1 <>
100 AcDbRadialDimension
 15 126.12835554495183
 25 15.142300877492314
 35 0.0
 40 0.0
1001 ACAD
1000 DSTYLE
1002 {
1070 172
1070 1
1070 288
1070 1
1070 44
1040 1.5
1070 343
1005 3A
1070 3
1000 <> mm
1002 }
1001 TRUEDXF_TEST
1070 7
  0 ARC_DIMENSION
  5 5F
330 17
100 AcDbEntity
  8 0
100 AcDbDimension
280 0
  2 *D4
  3 Standard
 10 160.0
 20 20.0
 30 0.0
 11 165.81138830084188
 21 15.811388300841898
 31 0.0
 70 40
 71 5
 42 18.84955592153876
  1 <>
100 AcDbArcDimension
 13 162.0
 23 0.0
 33 0.0
 14 150.0
 24 12.0
 34 0.0
 15 150.0
 25 0.0
 35 0.0
 40 0.0
 41 1.5707963267948966
 70 0
 71 0
 16 0.0
 26 0.0
 36 0.0
 17 0.0
 27 0.0
 37 0.0
`;

// Hand-written DIMSTYLE records in AutoCAD's sparse form: only values that differ from the
// imperial defaults are written (note 02 §2); TFILL has the second 70 (DIMTFILLCLR) and the
// ACAD_DSTYLE_* XDATA extensions.
const DIMSTYLES = `
  0 TABLE
  2 DIMSTYLE
  5 A
100 AcDbSymbolTable
 70 3
  0 DIMSTYLE
105 2B
330 A
100 AcDbSymbolTableRecord
100 AcDbDimStyleTableRecord
  2 Standard
 70 0
340 1B
  0 DIMSTYLE
105 2F
330 A
100 AcDbSymbolTableRecord
100 AcDbDimStyleTableRecord
  2 METRIC-2
 70 0
 41 2.0
 42 0.5
 44 1.0
 73 0
 74 0
 77 1
140 2.0
147 0.5
271 2
278 44
340 1B
  0 DIMSTYLE
105 2C
330 A
100 AcDbSymbolTableRecord
100 AcDbDimStyleTableRecord
  2 TFILL
 70 0
 69 2
 70 5
176 1
177 3
178 4
340 1B
1001 ACAD_DSTYLE_DIMBREAK
1070 391
1040 0.75
1001 ACAD_DSTYLE_DIM_LINETYPE
1070 380
1005 3B
  0 ENDTAB
`;

describe("DIMENSION", () => {
  it("reads common data, subtype definition points and flags", () => {
    const { doc, entities } = loadEntities(DIMS);
    const [lin, ang, rad, arc] = entities as DimensionEntity[];
    expect(lin!.type).toBe("DIMENSION");
    expect(lin!.subtype).toBe("linear");
    expect(lin!.blockName).toBe("*D1");
    expect(lin!.dimStyle).toBe("METRIC-2");
    expect(lin!.flags).toBe(32);
    expect(lin!.defPoint).toEqual({ x: 6.6717988226486264, y: 9.992301766027062, z: 0 });
    expect(lin!.textMidpoint).toEqual({ x: 20.839748528310782, y: 21.240377207533825, z: 0 });
    expect(lin!.defPoint2).toEqual({ x: 10, y: 5, z: 0 });
    expect(lin!.defPoint3).toEqual({ x: 40, y: 25, z: 0 });
    expect(lin!.angle).toBeCloseTo(33.690067525979785);
    expect(lin!.measurement).toBeCloseTo(36.05551275463989);
    expect(lin!.attachment).toBe(5);
    expect(lin!.textOverride).toBe("<>");
    expect(lin!.overrides.size).toBe(0);

    expect(ang!.subtype).toBe("angular");
    expect(ang!.dimType).toBe(2);
    expect(ang!.defPoint5).toEqual({ x: 70, y: 20, z: 0 });

    expect(rad!.subtype).toBe("radius");
    expect(rad!.defPoint4).toEqual({ x: 126.12835554495183, y: 15.142300877492314, z: 0 });
    expect(rad!.leaderLength).toBe(0);
    expect([...rad!.overrides]).toEqual([
      [172, 1],
      [288, 1],
      [44, 1.5],
      [343, "3A"],
      [3, "<> mm"],
    ]);

    expect(arc!.type).toBe("ARC_DIMENSION");
    expect(arc!.subtype).toBe("arc");
    // 70 of AcDbDimension (R2018 arc type 8 | 32) vs. 70 of AcDbArcDimension (is partial)
    expect(arc!.flags).toBe(40);
    expect(arc!.isPartial).toBe(false);
    expect(arc!.hasLeader).toBe(false);
    expect(arc!.arcStart).toBe(0);
    expect(arc!.arcEnd).toBeCloseTo(Math.PI / 2);
    // 41 of AcDbArcDimension must not become the line spacing factor
    expect(arc!.lineSpacingFactor).toBe(1);
    expect(arc!.defPoint4).toEqual({ x: 150, y: 0, z: 0 });
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
    const metric = doc.tables.dimstyles.get("metric-2")!;
    const standard = doc.tables.dimstyles.get("Standard")!;
    const std = effectiveDimStyle(standard);
    expect(std.DIMASZ).toBe(0.18);
    expect(std.DIMTXSTY).toBe("1B");
    expect(std.DIMTOFL).toBe(false);
    const e = effectiveDimStyle(metric);
    expect(e.DIMASZ).toBe(2);
    expect(e.DIMTIH).toBe(false);
    expect(e.DIMTAD).toBe(1);
    expect(e.DIMDSEP).toBe(44);
    expect(e.DIMCLRD).toBe(0);
    expect(e.DIMLFAC).toBe(1);
    const rad = doc.getEntity("54") as DimensionEntity;
    const o = effectiveDimStyle(metric, rad.overrides);
    expect(o.DIMTOFL).toBe(true);
    expect(o.DIMUPT).toBe(true);
    expect(o.DIMEXE).toBe(1.5);
    expect(o.DIMBLK1).toBe("3A");
    expect(o.DIMPOST).toBe("<> mm");
    expect(o.DIMASZ).toBe(2);
    // missing style → built-in defaults
    expect(effectiveDimStyle(undefined).DIMGAP).toBe(0.09);
  });

  it("reads the second 70 as DIMTFILLCLR and the ACAD_DSTYLE_* XDATA extensions", () => {
    const doc = DxfDocument.load(dxfWith({ tables: DIMSTYLES }));
    const c = doc.tables.dimstyles.get("TFILL")!;
    const e = effectiveDimStyle(c);
    expect(e.DIMTFILL).toBe(2);
    expect(e.DIMTFILLCLR).toBe(5);
    expect(e.DIMCLRD).toBe(1);
    expect(e.DIMBREAK).toBe(0.75);
    expect(e.DIMLTYPE).toBe("3B");
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
