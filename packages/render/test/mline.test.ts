import { describe, expect, it } from "vitest";
import { renderPlot } from "../src/index.ts";
import { modelDoc } from "./helpers.ts";

const style = `0 MLINESTYLE
5 50
330 1F
100 AcDbMlineStyle
2 TWO
70 0
3
62 256
51 90
52 90
71 2
49 0
62 1
6 BYLAYER
49 0.5
62 3
6 BYLAYER`;

// one segment (0,0) → (10,0); element params a0 = 1 (upper) and 0 (lower)
const mline = `0 MLINE
5 60
330 1F
100 AcDbEntity
8 0
100 AcDbMline
2 TWO
340 50
40 1
70 1
71 1
72 2
73 2
10 0
20 0
30 0
210 0
220 0
230 1
11 0
21 0
31 0
12 1
22 0
32 0
13 0
23 1
33 0
74 2
41 1
41 0
75 0
74 2
41 0
41 0
75 0
11 10
21 0
31 0
12 1
22 0
32 0
13 0
23 1
33 0
74 2
41 1
41 0
75 0
74 2
41 0
41 0
75 0`;

describe("MLINE", () => {
    it("maps vertex elements to style elements sorted by descending offset", async () => {
        const doc = modelDoc({ entities: mline, objects: style });
        const r = await renderPlot(
            doc,
            { layout: "Model", area: { type: "window", min: [-1, -2], max: [11, 7] }, canvas: [120, 90] },
            { raster: "smooth" },
        );
        // upper element (a0 = 1) is the style's first element by offset: 0.5 → green (ACI 3)
        const colorAt = (y: number) => {
            for (const b of r.displayList.batches) {
                for (let i = 0; i < b.positions.length / 2; i++) {
                    if (Math.abs(b.originY + b.positions[i * 2 + 1]! - y) < 1e-6)
                        return [...b.colors.subarray(i * 4, i * 4 + 3)];
                }
            }
            return undefined;
        };
        expect(colorAt(1)).toEqual([0, 255, 0]);
        expect(colorAt(0)).toEqual([255, 0, 0]);
    });
});
