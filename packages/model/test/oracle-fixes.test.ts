/**
 * Regressions for the parser fixes found by the ezdxf differential oracle
 * (tools/corpus/src/diff-ezdxf.ts, triage log in tools/corpus/README.md).
 */
import { BinaryTagWriter, tokenize } from "@truedxf/core";
import { describe, expect, it } from "vitest";
import {
  DxfDocument,
  type InsertEntity,
  type LineEntity,
  type PolylineEntity,
  type SplineEntity,
  type TextEntity,
} from "../src/index.ts";

const enc = new TextEncoder();
type Tag = [number, string | number];

function dxf(...tags: Tag[]): Uint8Array {
  return enc.encode(`${tags.map(([c, v]) => `${String(c).padStart(3)}\r\n${v}`).join("\r\n")}\r\n`);
}

const HEADER: Tag[] = [
  [0, "SECTION"],
  [2, "HEADER"],
  [9, "$ACADVER"],
  [1, "AC1015"],
  [0, "ENDSEC"],
];

function entities(...tags: Tag[]): DxfDocument {
  return DxfDocument.load(
    dxf(...HEADER, [0, "SECTION"], [2, "ENTITIES"], ...tags, [0, "ENDSEC"], [0, "EOF"]),
  );
}

describe("oracle fixes: misplaced subclass data", () => {
  it("recovers common properties written after the entity subclass marker (QCAD/LibreCAD/QGIS)", () => {
    const doc = entities(
      [0, "LINE"],
      [5, "44"],
      [100, "AcDbEntity"],
      [100, "AcDbLine"],
      [8, "Walls"],
      [62, 7],
      [370, 70],
      [6, "CONTINUOUS"],
      [10, 1],
      [20, 2],
      [11, 3],
      [21, 4],
    );
    const e = doc.modelSpace.entities[0] as LineEntity;
    expect(e.layer).toBe("Walls");
    expect(e.color).toBe(7);
    expect(e.lineweight).toBe(70);
    expect(e.linetype).toBe("CONTINUOUS");
    expect(e.end).toEqual({ x: 3, y: 4, z: 0 });
  });

  it("does not override properties present in AcDbEntity", () => {
    const doc = entities(
      [0, "LINE"],
      [100, "AcDbEntity"],
      [8, "A"],
      [100, "AcDbLine"],
      [8, "B"],
      [10, 0],
      [20, 0],
    );
    expect(doc.modelSpace.entities[0]!.layer).toBe("A");
  });

  it("reads VERTEX data written before the subclass markers", () => {
    const doc = entities(
      [0, "POLYLINE"],
      [100, "AcDbEntity"],
      [8, "0"],
      [100, "AcDb3dPolyline"],
      [66, 1],
      [70, 8],
      [0, "VERTEX"],
      [8, "TERRAIN"],
      [70, 32],
      [10, 512345.25],
      [20, 5401234.5],
      [30, 87.5],
      [100, "AcDbVertex"],
      [100, "AcDb3dPolylineVertex"],
      [0, "SEQEND"],
    );
    const p = doc.modelSpace.entities[0] as PolylineEntity;
    expect(p.vertices[0]!.location).toEqual({ x: 512345.25, y: 5401234.5, z: 87.5 });
    expect(p.vertices[0]!.flags).toBe(32);
  });

  it("reads INSERT/TEXT fields placed in the wrong subclass", () => {
    const doc = entities(
      [0, "TEXT"],
      [100, "AcDbEntity"],
      [8, "0"],
      [7, "ROMANS"], // style in AcDbEntity (libredwg#275)
      [100, "AcDbText"],
      [10, 1],
      [20, 2],
      [40, 2.5],
      [1, "abc"],
    );
    expect((doc.modelSpace.entities[0] as TextEntity).style).toBe("ROMANS");
  });
});

describe("oracle fixes: coordinates", () => {
  it("pairs interleaved coordinates 10 11 20 21 30 31 (AC1003 / old QCAD)", () => {
    const doc = entities(
      [0, "LINE"],
      [8, "1"],
      [10, 0.125],
      [11, 0.875],
      [20, 1],
      [21, 1.5],
      [30, 0],
      [31, 2],
    );
    const e = doc.modelSpace.entities[0] as LineEntity;
    expect(e.start).toEqual({ x: 0.125, y: 1, z: 0 });
    expect(e.end).toEqual({ x: 0.875, y: 1.5, z: 2 });
  });

  it("drops (0,0,0) spline tangents", () => {
    const doc = entities(
      [0, "SPLINE"],
      [100, "AcDbEntity"],
      [8, "0"],
      [100, "AcDbSpline"],
      [70, 8],
      [71, 3],
      [12, 0],
      [22, 0],
      [32, 0],
      [13, 1],
      [23, 0],
      [33, 0],
    );
    const s = doc.modelSpace.entities[0] as SplineEntity;
    expect(s.startTangent).toBeUndefined();
    expect(s.endTangent).toEqual({ x: 1, y: 0, z: 0 });
  });
});

describe("oracle fixes: document structure", () => {
  it("merges duplicate BLOCKs: first name, second base point, entities of both (note 07 §1.1)", () => {
    const doc = DxfDocument.load(
      dxf(
        ...HEADER,
        [0, "SECTION"],
        [2, "BLOCKS"],
        [0, "BLOCK"],
        [8, "0"],
        [2, "Detail"],
        [70, 0],
        [10, 0],
        [20, 0],
        [0, "LINE"],
        [8, "0"],
        [10, 0],
        [20, 0],
        [11, 1],
        [21, 1],
        [0, "ENDBLK"],
        [0, "BLOCK"],
        [8, "0"],
        [2, "DETAIL"],
        [70, 0],
        [10, 5],
        [20, 6],
        [0, "CIRCLE"],
        [8, "0"],
        [10, 0],
        [20, 0],
        [40, 1],
        [0, "ENDBLK"],
        [0, "ENDSEC"],
        [0, "EOF"],
      ),
    );
    const b = doc.getBlock("detail")!;
    expect(b.name).toBe("Detail");
    expect(b.basePoint).toEqual({ x: 5, y: 6, z: 0 });
    expect(b.entities.map((e) => e.type)).toEqual(["LINE", "CIRCLE"]);
    expect(doc.blocks.filter((x) => x.name.toUpperCase() === "DETAIL")).toHaveLength(1);
    expect(doc.diagnostics.summary()["duplicate-block"]).toBe(1);
  });

  it("attaches a SEQEND that follows an INSERT without ATTRIBs and 66", () => {
    const doc = entities([0, "INSERT"], [8, "0"], [2, "foo"], [10, 2], [20, 2], [0, "SEQEND"], [8, "0"]);
    expect(doc.modelSpace.entities).toHaveLength(1);
    expect((doc.modelSpace.entities[0] as InsertEntity).seqend).toBeDefined();
    expect(doc.diagnostics.summary()["orphan-subentity"]).toBeUndefined();
  });

  it("relinks LAYOUTs with stale block-record handles by tab order (QGIS exports)", () => {
    const blockRecord = (h: string, name: string): Tag[] => [
      [0, "BLOCK_RECORD"],
      [5, h],
      [100, "AcDbSymbolTableRecord"],
      [100, "AcDbBlockTableRecord"],
      [2, name],
    ];
    const block = (h: string, name: string): Tag[] => [
      [0, "BLOCK"],
      [5, h],
      [100, "AcDbEntity"],
      [8, "0"],
      [100, "AcDbBlockBegin"],
      [2, name],
      [70, 0],
      [10, 0],
      [20, 0],
      [0, "ENDBLK"],
      [100, "AcDbEntity"],
      [100, "AcDbBlockEnd"],
    ];
    const layout = (h: string, name: string, tab: number, br: string): Tag[] => [
      [0, "LAYOUT"],
      [5, h],
      [100, "AcDbPlotSettings"],
      [100, "AcDbLayout"],
      [1, name],
      [71, tab],
      [330, br],
    ];
    const doc = DxfDocument.load(
      dxf(
        ...HEADER,
        [0, "SECTION"],
        [2, "TABLES"],
        [0, "TABLE"],
        [2, "BLOCK_RECORD"],
        ...blockRecord("6D", "*Model_Space"),
        ...blockRecord("6E", "*Paper_Space"),
        ...blockRecord("6F", "*Paper_Space0"),
        [0, "ENDTAB"],
        [0, "ENDSEC"],
        [0, "SECTION"],
        [2, "BLOCKS"],
        ...block("7F", "*Model_Space"),
        ...block("81", "*Paper_Space"),
        ...block("83", "*Paper_Space0"),
        [0, "ENDSEC"],
        [0, "SECTION"],
        [2, "OBJECTS"],
        [0, "DICTIONARY"],
        [5, "C"],
        [100, "AcDbDictionary"],
        ...layout("22", "Model", 0, "1F"),
        ...layout("1E", "Layout1", 1, "1B"),
        ...layout("26", "Layout2", 2, "23"),
        [0, "ENDSEC"],
        [0, "EOF"],
      ),
    );
    expect(doc.layouts.map((l) => [l.name, l.block.name])).toEqual([
      ["Model", "*Model_Space"],
      ["Layout1", "*Paper_Space"],
      ["Layout2", "*Paper_Space0"],
    ]);
    expect(doc.diagnostics.summary()["layout-without-block"]).toBeUndefined();
  });

  it("reads binary-DXF bool header values (290)", () => {
    const w = new BinaryTagWriter(2);
    const tags: Tag[] = [
      [0, "SECTION"],
      [2, "HEADER"],
      [9, "$ACADVER"],
      [1, "AC1015"],
      [9, "$PSTYLEMODE"],
      [290, 1],
      [9, "$LWDISPLAY"],
      [290, 0],
      [0, "ENDSEC"],
      [0, "EOF"],
    ];
    for (const [c, v] of tags) w.write(c, c === 290 ? v === 1 : v);
    const bytes = w.toBytes();
    expect(tokenize(bytes).format).toBe("binary");
    const doc = DxfDocument.load(bytes);
    expect(doc.header.bool("$PSTYLEMODE", false)).toBe(true);
    expect(doc.header.bool("$LWDISPLAY", true)).toBe(false);
  });
});
