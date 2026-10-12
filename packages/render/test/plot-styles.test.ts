import { buildColorTable } from "@truedxf/plot";
import { describe, expect, it } from "vitest";
import type { DisplayList } from "../src/displaylist.ts";
import { type PlotRequest, renderPlot } from "../src/index.ts";
import { line, modelDoc } from "./helpers.ts";

/** Distinct RGB colours (0xRRGGBB) of a display list. */
function colors(list: DisplayList): number[] {
    const out = new Set<number>();
    for (const b of list.batches)
        for (let k = 0; k + 3 < b.colors.length; k += 4)
            out.add((b.colors[k]! << 16) | (b.colors[k + 1]! << 8) | b.colors[k + 2]!);
    return [...out].sort((a, b) => a - b);
}

/** Number of plotted vertices (thin raster strokes are one point per pixel). */
function points(list: DisplayList): number {
    return list.batches.reduce((n, b) => n + b.positions.length / 2, 0);
}

const request: PlotRequest = {
    layout: "Model",
    area: { type: "window", min: [-0.05, -0.05], max: [199.95, 149.95] },
    canvas: [2000, 1500],
    styleTable: "test.ctb",
};

describe("plot style pens (note 06 §6.5)", () => {
    const table = buildColorTable("test", (aci) =>
        aci === 1 ? { color: 0x0000ff } : aci === 2 ? { linetype: 1, adaptiveLinetype: false } : {},
    );

    it("applies the pen of the resolved ACI and leaves true colours alone", async () => {
        const red = await renderPlot(modelDoc({ entities: line("A1", 10, 10, 50, 10, 1) }), {
            ...request,
            plotStyleTable: table,
        });
        expect(colors(red.displayList)).toEqual([0x0000ff]);
        const trueRed = line("A1", 10, 10, 50, 10, 1).replace("62 1", "62 1\n420 16711680");
        const tc = await renderPlot(modelDoc({ entities: trueRed }), { ...request, plotStyleTable: table });
        expect(colors(tc.displayList)).toEqual([0xff0000]);
        const off = await renderPlot(modelDoc({ entities: line("A1", 10, 10, 50, 10, 1) }), {
            ...request,
            plotStyleTable: table,
            plotStyles: false,
        });
        expect(colors(off.displayList)).toEqual([0xff0000]);
    });

    it("dashes with the pen linetype in sheet lengths (note 06 §6.7)", async () => {
        // 40 units = 400 px = 4 in of "Dashed" (0.15 in dash, 0.1 in gap): 16 dashes of 15 px
        const r = await renderPlot(modelDoc({ entities: line("A1", 10, 10, 50, 10, 2) }), {
            ...request,
            plotStyleTable: table,
        });
        const n = points(r.displayList);
        expect(n).toBeGreaterThanOrEqual(16 * 14);
        expect(n).toBeLessThanOrEqual(16 * 16);
    });

    it("notes a table it cannot load and plots with object properties", async () => {
        const r = await renderPlot(modelDoc({ entities: line("A1", 10, 10, 50, 10, 1) }), request);
        expect(colors(r.displayList)).toEqual([0xff0000]);
        expect(r.notes?.map((n) => n.code)).toContain("plot-style-table-missing");
    });
});

describe("stored page setups (note 08 §10.17)", () => {
    // Model window (0,0)-(30,20) at 1:1 on a 300 × 200 px raster sheet, margins L/B/R/T 10/20/30/40
    const settings = (rotation: number) => `0 LAYOUT
5 50
100 AcDbPlotSettings
1
2 truedxf PNG.pc3
40 10
41 20
42 30
43 40
44 300
45 200
48 0
49 0
140 30
141 20
70 16
72 2
73 ${rotation}
74 4
75 16
147 10
100 AcDbLayout
1 Model
70 1
330 1F
100 AcDbLayout`;

    it("plots the printable area with the paper rotated onto the device", async () => {
        for (const [rotation, x, y] of [
            [0, 5, 135],
            [1, 5, 5],
            [3, 255, 135],
        ] as const) {
            // a 1-unit square at (0, 0)..(1, 1) = 10 × 10 px in the paper origin's corner
            const solid = `0 SOLID
5 A2
330 1F
100 AcDbEntity
8 0
62 1
100 AcDbTrace
10 0
20 0
11 1
21 0
12 0
22 1
13 1
23 1`;
            const doc = modelDoc({ entities: solid, objects: settings(rotation) });
            const r = await renderPlot(doc, { ...request, pageSetup: true });
            expect(r.canvas).toEqual([260, 140]);
            const b = r.displayList.bounds;
            // the view is the device image, Y up: centre of the square in canvas pixels
            const cx = (b.minX + b.maxX) / 2;
            const cy = r.canvas[1] - (b.minY + b.maxY) / 2;
            // ±1 px: the square's edges lie on pixel boundaries (fill-rule ties)
            expect(Math.abs(cx - x)).toBeLessThanOrEqual(1);
            expect(Math.abs(cy - y)).toBeLessThanOrEqual(1);
        }
    });
});
