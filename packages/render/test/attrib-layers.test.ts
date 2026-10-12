import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DxfDocument } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import { type PlotRequest, renderPlot } from "../src/index.ts";
import { dxfBytes } from "./helpers.ts";

const shx = new Uint8Array(
    readFileSync(join(import.meta.dirname, "..", "..", "fonts", "assets", "truedxf-test.shx")),
);
const loadFont = async (name: string) => (name.toLowerCase() === "txt.shx" ? shx : undefined);

const attrib = (handle: string, layer: string, x: number, text: string) =>
    `0 ATTRIB\n5 ${handle}\n100 AcDbEntity\n8 ${layer}\n100 AcDbText\n10 ${x}\n20 0\n40 5\n1 ${text}\n7 Standard\n100 AcDbAttribute\n2 TAG${handle}\n70 0`;

// An INSERT on GRID whose block draws a layer-0 circle, with one ATTRIB on layer 0 (inherits
// GRID) and one on its own layer LABELS, like the grid bubbles of the playground sample.
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
2 STYLE
70 1
0 STYLE
2 Standard
70 0
40 0
41 1
50 0
71 0
42 2.5
3 txt.shx
4
0 ENDTAB
0 ENDSEC
0 SECTION
2 BLOCKS
0 BLOCK
100 AcDbEntity
8 0
100 AcDbBlockBegin
2 BUBBLE
70 2
10 0
20 0
0 CIRCLE
5 20
100 AcDbEntity
8 0
100 AcDbCircle
10 0
20 0
40 8
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
8 GRID
100 AcDbBlockReference
66 1
2 BUBBLE
10 0
20 0
${attrib("41", "0", -3, "A")}
${attrib("42", "LABELS", 20, "B")}
0 SEQEND
5 43
100 AcDbEntity
8 GRID
0 ENDSEC
0 EOF
`),
);

const request: PlotRequest = {
    layout: "Model",
    area: { type: "window", min: [-20, -20], max: [40, 40] },
    canvas: [600, 600],
};

/** Total x of the drawn vertices: only the circle and "A" are left of x = 15. */
async function drawn(hidden: string[]) {
    const layerVisibility = new Map(hidden.map((l) => [l, false]));
    const { displayList } = await renderPlot(doc, request, {
        loadFont,
        raster: "smooth",
        visibility: "display",
        layerVisibility,
    });
    let left = 0;
    let right = 0;
    for (const b of displayList.batches)
        for (let i = 0; i < b.positions.length; i += 2) {
            if (b.originX + b.positions[i]! < 15) left++;
            else right++;
        }
    return { left, right };
}

describe("viewer layer toggles and ATTRIBs", () => {
    it("draws both attributes and the block with every layer on", async () => {
        const all = await drawn([]);
        expect(all.left).toBeGreaterThan(0);
        expect(all.right).toBeGreaterThan(0);
    });

    it("hides a layer-0 ATTRIB with its INSERT's layer, and an ATTRIB with its own layer", async () => {
        expect(await drawn(["GRID"])).toEqual({ left: 0, right: (await drawn([])).right });
        expect((await drawn(["LABELS"])).right).toBe(0);
        expect(await drawn(["0", "GRID", "LABELS"])).toEqual({ left: 0, right: 0 });
    });
});
