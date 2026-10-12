import { describe, expect, it } from "vitest";
import {
    ACAD_CTB,
    applyPlotStyle,
    buildColorTable,
    buildNamedTable,
    builtinPlotStyleTable,
    decodePia,
    decodePlotStyleColor,
    encodePia,
    formatPiaText,
    grayscaleRgb,
    MONOCHROME_CTB,
    PlotEndStyle,
    type PlotStyle,
    parsePiaText,
    penForAci,
    penForObject,
    plotStyleTableFromNodes,
    readPlotStyleTable,
    screenRgb,
    styleByName,
    writePlotStyleTable,
} from "../src/index.ts";

describe("PIA container", () => {
    it("round-trips type and latin-1 text", () => {
        const text = 'description="Größe\nsub{\n a=1\n}\n';
        const bytes = encodePia("CTB", text);
        expect(new TextDecoder().decode(bytes.subarray(0, 48))).toBe(
            "PIAFILEVERSION_2.0,CTBVER1,compress\r\npmzlibcodec",
        );
        expect(decodePia(bytes)).toEqual({ type: "CTB", text });
    });

    it("strips trailing NULs and rejects other headers", () => {
        expect(decodePia(encodePia("PC3", "a=1\n\0")).text).toBe("a=1\n");
        expect(() => decodePia(new Uint8Array(60))).toThrow(/not a PIA/);
    });

    it("parses nested sections and formats them back", () => {
        const text = 'a="x\ns{\n b=1.5 (abcdefghijklmn)\n t{\n  c=TRUE\n }\n}\n';
        const nodes = parsePiaText(text);
        expect(nodes).toEqual([
            { key: "a", value: '"x' },
            {
                key: "s",
                children: [
                    { key: "b", value: "1.5 (abcdefghijklmn)" },
                    { key: "t", children: [{ key: "c", value: "TRUE" }] },
                ],
            },
        ]);
        expect(formatPiaText(nodes)).toBe(text);
        expect(() => parsePiaText("s{\n")).toThrow(/unterminated/);
    });
});

/** One CTB pen from the lines of its `plot_style` entry. */
function pen(...lines: string[]): PlotStyle {
    const text = `plot_style{\n 0{\n${lines.map((l) => `  ${l}\n`).join("")} }\n}\n`;
    return plotStyleTableFromNodes(parsePiaText(text), "ctb").styles[0]!;
}

describe("plot style tables", () => {
    it("decodes pen colours from the low 24 bits (note 06 §6.3)", () => {
        expect(decodePlotStyleColor(-1)).toBeUndefined();
        expect(decodePlotStyleColor(-1006632961)).toBeUndefined(); // 0xC3FFFFFF
        expect(decodePlotStyleColor(0xc2ffffff | 0)).toBeUndefined();
        expect(decodePlotStyleColor(0xc2ff8000 | 0)).toBe(0xff8000);
        expect(decodePlotStyleColor(0xc300001e | 0)).toBe(0x00001e); // not ACI 30
        expect(decodePlotStyleColor(-16777216)).toBe(0); // monochrome.ctb black
    });

    it("reads a CTB written from a built table", () => {
        const built = buildColorTable("test", (aci) =>
            aci === 1
                ? { color: 0x0000ff, lineweightIndex: 14, screening: 50, endStyle: PlotEndStyle.Butt }
                : {},
        );
        const table = readPlotStyleTable(writePlotStyleTable(built));
        expect(table.kind).toBe("ctb");
        expect(table.styles).toHaveLength(255);
        expect(penForAci(table, 1)).toMatchObject({
            name: "Color_1",
            color: 0x0000ff,
            colorPolicy: 5,
            lineweight: 0.5,
            screening: 50,
            endStyle: PlotEndStyle.Butt,
            joinStyle: undefined,
            linetype: undefined,
        });
        expect(penForAci(table, 2)).toMatchObject({
            color: undefined,
            lineweight: undefined,
            screening: 100,
        });
        expect(penForAci(table, 0)).toBeUndefined();
        expect(penForAci(table, 256)).toBeUndefined();
    });

    it("indexes lineweights from 1; 0 and past-the-end mean object (note 06 §6.3)", () => {
        expect(pen("lineweight=0").lineweight).toBeUndefined();
        expect(pen("lineweight=1").lineweight).toBe(0); // entry 0 = 0.00 mm: thinnest, not object
        expect(pen("lineweight=27").lineweight).toBe(2.11);
        expect(pen("lineweight=28").lineweight).toBeUndefined();
        expect(pen("lineweight=255").lineweight).toBeUndefined();
    });

    it("uses mode_color over color and honours the colour policy", () => {
        expect(pen("color=-16777216", "mode_color=-1006632961", "color_policy=5").color).toBeUndefined();
        expect(pen("color=-1", "mode_color=-16776961", "color_policy=5").color).toBe(0x0000ff);
        expect(pen("color=-16776961", "mode_color=-1", "color_policy=0").color).toBe(0x0000ff);
        for (const policy of [1, 6, 7])
            expect(pen("color=-16776961", `color_policy=${policy}`).color).toBeUndefined();
        expect(pen("color_policy=2").grayscale).toBe(true);
        expect(pen("color_policy=3").grayscale).toBe(true);
        expect(pen("color_policy=7").grayscale).toBe(false);
    });

    it("orders pens by key and fills missing properties with object defaults", () => {
        const nodes = parsePiaText(
            'description="x\nplot_style{\n 1{\n  name="Color_2\n  color=-16777216\n  color_policy=5\n }\n 0{\n  name="Color_1\n }\n}\n',
        );
        const table = plotStyleTableFromNodes(nodes, "ctb");
        expect(table.styles.map((s) => s.name)).toEqual(["Color_1", "Color_2"]);
        expect(penForAci(table, 2)!.color).toBe(0x000000);
        expect(penForAci(table, 1)).toMatchObject({
            color: undefined,
            lineweight: undefined,
            colorPolicy: 1,
        });
        expect(table.lineweights).toHaveLength(27);
    });

    it("finds named styles in STB tables only", () => {
        const stb = readPlotStyleTable(
            writePlotStyleTable(buildNamedTable("named", { Thick: { lineweightIndex: 21 } })),
        );
        expect(stb.kind).toBe("stb");
        expect(stb.styles[0]!.name).toBe("Normal");
        expect(styleByName(stb, "thick")!.lineweight).toBe(1.0);
        expect(styleByName(stb, "missing")).toBeUndefined();
        expect(penForAci(stb, 1)).toBeUndefined();
        expect(styleByName(ACAD_CTB, "Color_1")).toBeUndefined();
    });

    it("provides equivalents of the stock tables by name", () => {
        expect(builtinPlotStyleTable("Monochrome.CTB")).toBe(MONOCHROME_CTB);
        expect(penForAci(MONOCHROME_CTB, 5)).toMatchObject({ color: 0, colorPolicy: 5 });
        expect(ACAD_CTB.styles.every((s) => s.color === undefined && s.lineweight === undefined)).toBe(true);
        expect(penForAci(builtinPlotStyleTable("Grayscale.ctb")!, 1)!.grayscale).toBe(true);
        expect(penForAci(builtinPlotStyleTable("Screening 50%.ctb")!, 1)!.screening).toBe(50);
        const fills = builtinPlotStyleTable("Fill Patterns.ctb")!;
        expect([1, 9, 10].map((aci) => penForAci(fills, aci)!.fillStyle)).toEqual([64, 72, undefined]);
        expect(builtinPlotStyleTable("custom.ctb")).toBeUndefined();
    });
});

describe("applying pens (note 06 §6.5)", () => {
    const red = { rgb: 0xff0000, aci: 1, lineweight: 0.25 };

    it("converts to grayscale with floored terms and screens towards white", () => {
        expect(grayscaleRgb(0x808080)).toBe(0x7f7f7f);
        expect(grayscaleRgb(0xfafafa)).toBe(0xf8f8f8);
        expect(screenRgb(0xff0000, 50)).toBe(0xff8080);
        expect(screenRgb(0x000000, 0)).toBe(0xffffff);
        expect(screenRgb(0x123456, 100)).toBe(0x123456);
    });

    it("applies pen colour, then grayscale, then screening, and the pen lineweight", () => {
        const table = buildColorTable("t", (aci) =>
            aci === 1 ? { color: 0x0000ff, grayscale: true, screening: 50, lineweightIndex: 21 } : {},
        );
        expect(applyPlotStyle(penForObject(table, red), red)).toMatchObject({
            rgb: screenRgb(grayscaleRgb(0x0000ff), 50),
            lineweight: 1.0,
        });
        const green = { rgb: 0x00ff00, aci: 3, lineweight: 0.5 };
        expect(applyPlotStyle(penForObject(table, green), green)).toMatchObject({
            rgb: 0x00ff00,
            lineweight: 0.5,
        });
    });

    it("gives true colours no pen", () => {
        const tc = { rgb: 0x00ff00, aci: undefined, lineweight: 1 };
        expect(penForObject(MONOCHROME_CTB, tc)).toBeUndefined();
        expect(applyPlotStyle(penForObject(MONOCHROME_CTB, tc), tc)).toMatchObject({
            rgb: 0x00ff00,
            lineweight: 1,
        });
        expect(applyPlotStyle(penForObject(MONOCHROME_CTB, red), red).rgb).toBe(0);
        expect(applyPlotStyle(penForObject(undefined, red), red).rgb).toBe(0xff0000);
    });
});
