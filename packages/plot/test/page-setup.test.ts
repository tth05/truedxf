import { DxfDocument, type LayoutObject } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import { PlotPaperUnits, paperMmPerDrawingUnit, readPageSetup } from "../src/index.ts";

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
                [75, 25],
                [147, 1],
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
            scale: { paper: 1, drawing: 50 },
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

    it("maps standard scale 0 to fit and imperial scales to inches per foot", () => {
        const fit = readPageSetup(layout([100, "AcDbPlotSettings"], [70, 16], [75, 0], [100, "AcDbLayout"]));
        expect(fit.scale).toBe("fit");
        expect(paperMmPerDrawingUnit(fit)).toBeUndefined();
        const quarter = readPageSetup(
            layout([100, "AcDbPlotSettings"], [70, 16], [72, 0], [75, 8], [100, "AcDbLayout"]),
        );
        expect(quarter.scale).toEqual({ paper: 0.25, drawing: 12 });
    });

    it("falls back to 1:1 for a degenerate custom scale", () => {
        const setup = readPageSetup(
            layout([100, "AcDbPlotSettings"], [142, 0], [143, 0], [100, "AcDbLayout"]),
        );
        expect(setup.scale).toEqual({ paper: 1, drawing: 1 });
    });
});
