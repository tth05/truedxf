import { DxfDocument } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import { renderPlot } from "../src/index.ts";
import { dxfBytes } from "./helpers.ts";

// block B (a LINE with its own handle 30), inserted twice, an off-layer LINE and a DIMENSION
// without block (regenerated: lines, arrows and text drawn as generated content)
const doc = DxfDocument.load(
    dxfBytes(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1032
0 ENDSEC
0 SECTION
2 TABLES
0 TABLE
2 LAYER
0 LAYER
100 AcDbSymbolTableRecord
100 AcDbLayerTableRecord
2 0
70 0
62 7
6 Continuous
0 LAYER
100 AcDbSymbolTableRecord
100 AcDbLayerTableRecord
2 OFF
70 0
62 -7
6 Continuous
0 ENDTAB
0 ENDSEC
0 SECTION
2 BLOCKS
0 BLOCK
100 AcDbEntity
8 0
100 AcDbBlockBegin
2 B
70 0
10 0
20 0
0 LINE
5 30
100 AcDbEntity
8 0
100 AcDbLine
10 0
20 0
30 0
11 10
21 0
31 0
0 ENDBLK
100 AcDbEntity
8 0
100 AcDbBlockEnd
0 ENDSEC
0 SECTION
2 ENTITIES
0 INSERT
5 40
100 AcDbEntity
8 0
100 AcDbBlockReference
2 B
10 0
20 0
0 INSERT
5 41
100 AcDbEntity
8 0
100 AcDbBlockReference
2 B
10 0
20 20
0 LINE
5 42
100 AcDbEntity
8 OFF
100 AcDbLine
10 0
20 0
30 0
11 5
21 5
31 0
0 DIMENSION
5 43
100 AcDbEntity
8 0
100 AcDbDimension
10 10
20 -10
30 0
70 32
3 Standard
100 AcDbAlignedDimension
13 0
23 -5
33 0
14 10
24 -5
34 0
100 AcDbRotatedDimension
0 ENDSEC
0 EOF
`),
);

describe("pick identities", () => {
    it("attributes all output to the top-level entity, once per entity (block content, dimensions)", async () => {
        const r = await renderPlot(
            doc,
            { layout: "Model", area: { type: "extents" }, canvas: [200, 150], styleTable: "monochrome.ctb" },
            { raster: "smooth" },
        );
        // not the nested LINE 30, no entry for the off-layer LINE 42
        expect(r.displayList.entities).toEqual(["40", "41", "43"]);
    });
});
