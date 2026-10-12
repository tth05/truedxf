import { DxfDocument, type LayoutObject } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import {
    type PlotMatrix,
    PlotPaperUnits,
    paperMmPerDrawingUnit,
    plotPlacement,
    readPageSetup,
} from "../src/index.ts";

type Tag = readonly [number, string | number];

function layout(...tags: Tag[]): LayoutObject {
    const all: Tag[] = [
        [0, "SECTION"],
        [2, "HEADER"],
        [9, "$ACADVER"],
        [1, "AC1027"],
        [0, "ENDSEC"],
        [0, "SECTION"],
        [2, "OBJECTS"],
        [0, "LAYOUT"],
        [5, "1A"],
        ...tags,
        [0, "ENDSEC"],
        [0, "EOF"],
    ];
    const text = `${all.map(([c, v]) => `${String(c).padStart(3)}\r\n${v}`).join("\r\n")}\r\n`;
    const doc = DxfDocument.load(new TextEncoder().encode(text));
    return doc.objects.find((o): o is LayoutObject => o.type === "LAYOUT")!;
}

describe("readPageSetup", () => {
    it("reads an A3 PDF layout at 1:50 with plot styles", () => {
        const setup = readPageSetup(
            layout(
                [100, "AcDbPlotSettings"],
                [1, ""],
                [2, "DWG To PDF.pc3"],
                [4, "ISO_full_bleed_A3_(420.00_x_297.00_MM)"],
                [6, ""],
                [40, 5],
                [41, 6],
                [42, 7],
                [43, 8],
                [44, 420],
                [45, 297],
                [46, 1.5],
                [47, 2.5],
                [48, 0],
                [49, 0],
                [140, 0],
                [141, 0],
                [142, 1],
                [143, 50],
                [70, 688],
                [72, 1],
                [73, 1],
                [74, 5],
                [7, "acad.ctb"],
                [75, 26],
                [147, 0.02],
                [76, 0],
                [100, "AcDbLayout"],
                [1, "Layout1"],
                [1001, "PLOTTRANSPARENCY"],
                [1071, 1],
            ),
        );
        expect(setup).toMatchObject({
            device: "DWG To PDF.pc3",
            media: "ISO_full_bleed_A3_(420.00_x_297.00_MM)",
            paperWidth: 420,
            paperHeight: 297,
            margins: { left: 5, bottom: 6, right: 7, top: 8 },
            paperUnits: PlotPaperUnits.Millimeters,
            rotation: 1,
            area: { kind: "layout" },
            scale: { paper: 0.02, drawing: 1 },
            offset: { x: 1.5, y: 2.5 },
            centered: false,
            styleSheet: "acad.ctb",
            plotStyles: true,
            plotLineweights: true,
            scaleLineweights: false,
            drawViewportsFirst: true,
            hidePaperSpace: false,
            plotTransparency: true,
        });
        expect(paperMmPerDrawingUnit(setup)).toBeCloseTo(1 / 50);
    });

    it("reads a model window plot, custom inch scale, centred, no style table", () => {
        const setup = readPageSetup(
            layout(
                [100, "AcDbPlotSettings"],
                [48, -10],
                [49, -20],
                [140, 30],
                [141, 40],
                [142, 1],
                [143, 96],
                [70, 1024 | 4],
                [72, 0],
                [74, 4],
                [7, ""],
                [100, "AcDbLayout"],
                [1, "Model"],
            ),
        );
        expect(setup.area).toEqual({ kind: "window", min: { x: -10, y: -20 }, max: { x: 30, y: 40 } });
        expect(setup.scale).toEqual({ paper: 1, drawing: 96 });
        expect(setup.centered).toBe(true);
        expect(setup.styleSheet).toBeUndefined();
        expect(setup.plotTransparency).toBe(false);
        expect(paperMmPerDrawingUnit(setup)).toBeCloseTo(25.4 / 96);
    });

    it("takes the scale from 147 with bit 16, 75 = 0 meaning fit (note 08 §2.1)", () => {
        const fit = readPageSetup(
            layout([100, "AcDbPlotSettings"], [70, 16], [75, 0], [147, 0.3], [100, "AcDbLayout"]),
        );
        expect(fit.scale).toBe("fit");
        expect(paperMmPerDrawingUnit(fit)).toBeUndefined();
        // 75 = 17 (1:2) and 142/143 = 1:4 are ignored; 147 decides.
        const settings = (flags: number): Tag[] => [
            [100, "AcDbPlotSettings"],
            [142, 1],
            [143, 4],
            [70, flags],
            [72, 1],
            [75, 17],
            [147, 0.5],
            [100, "AcDbLayout"],
        ];
        expect(readPageSetup(layout(...settings(16))).scale).toEqual({ paper: 0.5, drawing: 1 });
        // Bit 16 clear: 142/143, whatever 75 and 147 say.
        expect(readPageSetup(layout(...settings(0))).scale).toEqual({ paper: 1, drawing: 4 });
    });

    it("falls back to 1:1 for a degenerate custom scale", () => {
        const setup = readPageSetup(
            layout([100, "AcDbPlotSettings"], [142, 0], [143, 0], [100, "AcDbLayout"]),
        );
        expect(setup.scale).toEqual({ paper: 1, drawing: 1 });
    });
});

const apply = (m: PlotMatrix, x: number, y: number) => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
];

/** The harness margins sheet: 1600 × 1200 px, margins L/B/R/T 10/20/30/40, layout plot 1:1. */
function marginsSheet(rotation: number, ...extra: Tag[]): Tag[] {
    return [
        [100, "AcDbPlotSettings"],
        [2, "truedxf PNG.pc3"],
        [40, 10],
        [41, 20],
        [42, 30],
        [43, 40],
        [44, 1600],
        [45, 1200],
        ...extra,
        [70, 16 | 32 | 128],
        [72, 2],
        [73, rotation],
        [74, 5],
        [75, 16],
        [147, 1],
        [100, "AcDbLayout"],
    ];
}

describe("plotPlacement (note 08 §10.17)", () => {
    it("prints the printable area with the origin in the rotation's corner", () => {
        // Paper pixel (x, y) → canvas (column, row) of the 1560 × 1140 printable image.
        const cases: [number, number[]][] = [
            [0, [3, 1140 - 1 - 5]],
            [1, [5, 3]],
            [2, [1560 - 1 - 3, 5]],
            [3, [1560 - 1 - 5, 1140 - 1 - 3]],
        ];
        for (const [rot, pixel] of cases) {
            const p = plotPlacement(readPageSetup(layout(...marginsSheet(rot))));
            expect([p.width, p.height]).toEqual([1560, 1140]);
            const [x, y] = apply(p.matrix, 3.5, 5.5);
            expect([Math.floor(x!), Math.floor(y!)]).toEqual(pixel);
        }
    });

    it("moves the origin by 46/47 along the device axes into the sheet", () => {
        const offset: Tag[] = [
            [46, 100],
            [47, 50],
        ];
        const at = (rot: number) =>
            apply(plotPlacement(readPageSetup(layout(...marginsSheet(rot, ...offset)))).matrix, 0, 0);
        expect(at(0)).toEqual([100, 1140 - 50]);
        expect(at(1)).toEqual([100, 50]);
        expect(at(2)).toEqual([1560 - 100, 50]);
        expect(at(3)).toEqual([1560 - 100, 1140 - 50]);
    });

    it("moves window plots by 46/47 along the paper axes (Q-0761)", () => {
        const window = (rot: number) =>
            readPageSetup(
                layout(
                    ...marginsSheet(rot, [46, 100], [47, 50], [48, 0], [49, 0], [140, 500], [141, 500]).map(
                        (t): Tag => (t[0] === 74 ? [74, 4] : t),
                    ),
                ),
            );
        const at = (rot: number) => apply(plotPlacement(window(rot)).matrix, 0, 0);
        expect(at(0)).toEqual([100, 1090]);
        expect(at(1)).toEqual([50, 100]);
        expect(at(2)).toEqual([1460, 50]);
        expect(at(3)).toEqual([1510, 1040]);
    });

    it("shifts layout plots by 148/149 and ignores them for windows", () => {
        const image: Tag[] = [
            [148, 100],
            [149, 50],
        ];
        const shifted = plotPlacement(readPageSetup(layout(...marginsSheet(0, ...image))));
        expect(apply(shifted.matrix, 0, 0)).toEqual([100, 1140 - 50]);
        const window = readPageSetup(
            layout(
                ...marginsSheet(0, ...image, [48, 10], [49, 20], [140, 110], [141, 220]).map(
                    (t): Tag => (t[0] === 74 ? [74, 4] : t),
                ),
            ),
        );
        expect(apply(plotPlacement(window).matrix, 10, 20)).toEqual([0, 1140]);
    });

    it("applies offsets in mm on inch and mm setups", () => {
        const setup = (units: number) =>
            readPageSetup(
                layout(
                    [100, "AcDbPlotSettings"],
                    [44, 508],
                    [45, 381],
                    [46, 5],
                    [47, 3],
                    [70, 16],
                    [72, units],
                    [74, 5],
                    [75, 16],
                    [147, 1],
                    [100, "AcDbLayout"],
                ),
            );
        const perMm = 600 / 25.4;
        const inch = plotPlacement(setup(0), { unitsPerMm: perMm });
        expect(inch.height).toBeCloseTo(9000);
        const [x, y] = apply(inch.matrix, 1, 1);
        expect(x).toBeCloseTo(600 + 5 * perMm);
        expect(y).toBeCloseTo(9000 - 600 - 3 * perMm);
        const [xm] = apply(plotPlacement(setup(1), { unitsPerMm: perMm }).matrix, 25.4, 0);
        expect(xm).toBeCloseTo(600 + 5 * perMm);
    });

    it("fits and centres a window, ignoring the offset", () => {
        const setup = readPageSetup(
            layout(
                [100, "AcDbPlotSettings"],
                [44, 2000],
                [45, 1500],
                [46, 7],
                [47, 9],
                [48, 0],
                [49, 0],
                [140, 100],
                [141, 50],
                [70, 16 | 4],
                [72, 2],
                [73, 1],
                [74, 4],
                [75, 0],
                [100, "AcDbLayout"],
            ),
        );
        // Rotated: the paper is 1500 wide, 2000 high; a 100 × 50 window fits at 15 px/unit and
        // is centred vertically on the paper (= horizontally on the device).
        const p = plotPlacement(setup);
        expect(p.scale).toBe(15);
        expect(apply(p.matrix, 0, 0)).toEqual([625, 0]);
        expect(apply(p.matrix, 100, 50)).toEqual([1375, 1500]);
        expect(() => plotPlacement({ ...setup, area: { kind: "extents" } })).toThrow(/bounds/);
    });
});
