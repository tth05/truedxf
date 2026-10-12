import { describe, expect, it } from "vitest";
import { type AttribEntity, type InsertEntity, type MTextEntity, parseEmbeddedMText } from "../src/index.ts";
import { errors, loadEntities } from "./snippets.ts";

// R2018 layout with embedded column data: generated with ezdxf 1.4.4 (dynamic columns with
// manual heights); 73 line spacing style added by hand.
const R2018_COLUMNS = `
  0 MTEXT
  5 2F
330 17
100 AcDbEntity
  8 0
100 AcDbMText
 10 40.0
 20 60.0
 30 0.0
 40 2.5
 41 12.0
 46 0.0
 71 1
 72 5
  1 first column text\\Psecond column
 73 2
 44 1.25
101 Embedded Object
 70 1
 10 1.0
 20 0.0
 30 0.0
 11 40.0
 21 60.0
 31 0.0
 40 12.0
 41 0.0
 42 25.5
 43 20
 71 2
 72 2
 44 12.0
 45 1.5
 73 0
 74 0
 46 20
 46 15
`;

describe("MTEXT", () => {
    it("reads AcDbMText codes and R2018 embedded column data without clobbering", () => {
        const { doc, entities } = loadEntities(R2018_COLUMNS);
        const m = entities[0] as MTextEntity;
        expect(m.type).toBe("MTEXT");
        expect(m.insert).toEqual({ x: 40, y: 60, z: 0 });
        expect(m.height).toBe(2.5);
        expect(m.width).toBe(12);
        expect(m.attachment).toBe(1);
        expect(m.flowDirection).toBe(5);
        expect(m.text).toBe("first column text\\Psecond column");
        // embedded 10 is the direction and fills the absent 11; 40/41/42 must not overwrite 40/41,
        // embedded 44/73 not the line spacing
        expect(m.lineSpacingStyle).toBe(2);
        expect(m.lineSpacingFactor).toBe(1.25);
        expect(m.direction).toEqual({ x: 1, y: 0, z: 0 });
        expect(m.rectWidth).toBe(25.5);
        expect(m.rectHeight).toBe(20);
        expect(m.columns).toMatchObject({
            type: 2,
            count: 2,
            width: 12,
            gutter: 1.5,
            autoHeight: false,
            heights: [20, 15],
            source: "embedded",
        });
        expect(errors(doc)).toEqual([]);
    });

    it("uses the embedded attachment point (70) over 71", () => {
        const text = R2018_COLUMNS.replace(" 71 1\n 72 5", " 71 1\n 72 5").replace(
            " 70 1\n 10 1.0",
            " 70 5\n 10 1.0",
        );
        const m = loadEntities(text).entities[0] as MTextEntity;
        expect(m.attachmentPoint71).toBe(1);
        expect(m.attachment).toBe(5);
    });

    it("loads an absent or out-of-range 71 as top left (VERIFIED-BY-ACAD fileformat/mtext-attachment-*)", () => {
        for (const [att71, raw] of [
            ["", 1],
            [" 71 0\n", 0],
            [" 71 10\n", 10],
            [" 71 -1\n", -1],
            [" 71 99\n", 99],
        ] as const) {
            const m = loadEntities(`
  0 MTEXT
  5 20
100 AcDbEntity
  8 0
100 AcDbMText
 10 0.0
 20 0.0
 40 2.0
${att71}  1 X
`).entities[0] as MTextEntity;
            expect(m.attachmentPoint71).toBe(raw);
            expect(m.attachment).toBe(1);
        }
    });

    it("joins 3-chunks and the 1-chunk in file order, reads rotation, direction and background", () => {
        const { entities } = loadEntities(`
  0 MTEXT
  5 20
100 AcDbEntity
  8 0
100 AcDbMText
 10 1
 20 2
 30 0
 40 2.5
 41 0
 71 5
 72 1
  3 first chunk,
  3 second-
  1 last
  7 Arial
 50 30
 90 17
 63 1
421 16711680
 45 1.25
`);
        const m = entities[0] as MTextEntity;
        expect(m.text).toBe("first chunk,second-last");
        expect(m.style).toBe("Arial");
        expect(m.rotation).toBe(30);
        expect(m.direction).toBeUndefined();
        expect(m.bgFlags).toBe(17);
        expect(m.bgColor).toBe(1);
        expect(m.bgTrueColor).toBe(0xff0000);
        expect(m.bgScale).toBe(1.25);
        expect(m.columns).toBeUndefined();
    });

    it("reads pre-R2018 column info from XDATA ACAD", () => {
        const { entities } = loadEntities(`
  0 MTEXT
  5 2F
100 AcDbEntity
  8 0
100 AcDbMText
 10 40.0
 20 60.0
 30 0.0
 40 2.5
 41 15.5
 71 1
  1 col 1
1001 ACAD
1000 ACAD_MTEXT_COLUMN_INFO_BEGIN
1070 75
1070 1
1070 79
1070 1
1070 76
1070 2
1070 78
1070 0
1070 48
1040 7.5
1070 49
1040 0.5
1000 ACAD_MTEXT_COLUMN_INFO_END
1000 ACAD_MTEXT_COLUMNS_BEGIN
1070 47
1070 2
1005 3F0
1000 ACAD_MTEXT_COLUMNS_END
1000 ACAD_MTEXT_DEFINED_HEIGHT_BEGIN
1070 46
1040 20.0
1000 ACAD_MTEXT_DEFINED_HEIGHT_END
`);
        const m = entities[0] as MTextEntity;
        expect(m.columns).toEqual({
            type: 1,
            count: 2,
            autoHeight: true,
            flowReversed: false,
            width: 7.5,
            gutter: 0.5,
            definedHeight: 20,
            totalWidth: 15.5,
            totalHeight: 20,
            heights: [],
            linkedHandles: ["3F0"],
            source: "xdata",
        });
    });

    it("decodes the embedded MTEXT of an R2018 multi-line ATTRIB", () => {
        const { entities } = loadEntities(`
  0 INSERT
  5 30
100 AcDbEntity
  8 0
100 AcDbBlockReference
 66 1
  2 B
 10 0
 20 0
  0 ATTRIB
  5 31
100 AcDbEntity
  8 0
100 AcDbText
 10 120.25
 20 48.5
 40 3.0
  1 ROOM 2.14
  7 Labels Narrow
 72 1
 11 131.75
 21 50
100 AcDbAttribute
  2 ROOM-NAME
 70 0
 74 2
280 0
 71 2
 72 0
 11 131.75
 21 50
101 Embedded Object
 10 131.75
 20 50
 40 3.0
 41 0.0
 46 0.0
 71 5
 72 5
  1 ROOM 2.14\\PSTORAGE
  7 Labels Narrow
 73 1
 44 1.0
  0 SEQEND
  5 32
100 AcDbEntity
  8 0
`);
        const ins = entities[0] as InsertEntity;
        const att = ins.attribs[0] as AttribEntity;
        const m = parseEmbeddedMText(att.record);
        expect(m).toBeDefined();
        expect(m?.text).toBe("ROOM 2.14\\PSTORAGE");
        expect(m?.insert).toEqual({ x: 131.75, y: 50, z: 0 });
        expect(m?.attachment).toBe(5);
        expect(m?.flowDirection).toBe(5);
        expect(m?.style).toBe("Labels Narrow");
    });
});
