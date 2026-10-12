import { describe, expect, it } from "vitest";
import {
    ACAD_CTB,
    buildColorTable,
    buildNamedTable,
    builtinPlotStyleTable,
    decodePia,
    decodePlotStyleColor,
    encodePia,
    formatPiaText,
    MONOCHROME_CTB,
    PlotEndStyle,
    parsePiaText,
    penForAci,
    plotStyleTableFromNodes,
    readPlotStyleTable,
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

describe("plot style tables", () => {
    it("decodes pen colours", () => {
        expect(decodePlotStyleColor(-1)).toBeUndefined();
        expect(decodePlotStyleColor(0xc2ff8000 | 0)).toBe(0xff8000);
        expect(decodePlotStyleColor(-1006632961)).toBeUndefined(); // 0xC3FFFFFF
        expect(decodePlotStyleColor(0xc3000001 | 0)).toBe(0xff0000);
    });

    it("reads a CTB written from a built table", () => {
        const built = buildColorTable("test", (aci) =>
            aci === 1
                ? { color: 0x0000ff, lineweightIndex: 13, screening: 50, endStyle: PlotEndStyle.Butt }
                : {},
        );
        const table = readPlotStyleTable(writePlotStyleTable(built));
        expect(table.kind).toBe("ctb");
        expect(table.styles).toHaveLength(255);
        const red = penForAci(table, 1)!;
        expect(red).toMatchObject({
            name: "Color_1",
            color: 0x0000ff,
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

    it("orders pens by key and fills missing properties with object defaults", () => {
        const nodes = parsePiaText(
            'description="x\nplot_style{\n 1{\n  name="Color_2\n  color=-1040187392\n }\n 0{\n  name="Color_1\n }\n}\n',
        );
        const table = plotStyleTableFromNodes(nodes, "ctb");
        expect(table.styles.map((s) => s.name)).toEqual(["Color_1", "Color_2"]);
        expect(penForAci(table, 2)!.color).toBe(0x000000);
        expect(penForAci(table, 1)).toMatchObject({ color: undefined, lineweight: undefined, dither: true });
        expect(table.lineweights).toHaveLength(27);
    });

    it("finds named styles in STB tables only", () => {
        const stb = readPlotStyleTable(
            writePlotStyleTable(buildNamedTable("named", { Thick: { lineweightIndex: 20 } })),
        );
        expect(stb.kind).toBe("stb");
        expect(stb.styles[0]!.name).toBe("Normal");
        expect(styleByName(stb, "thick")!.lineweight).toBe(1.0);
        expect(styleByName(stb, "missing")).toBeUndefined();
        expect(penForAci(stb, 1)).toBeUndefined();
        expect(styleByName(ACAD_CTB, "Color_1")).toBeUndefined();
    });

    it("provides the standard tables by name", () => {
        expect(builtinPlotStyleTable("Monochrome.CTB")).toBe(MONOCHROME_CTB);
        expect(penForAci(MONOCHROME_CTB, 5)!.color).toBe(0);
        expect(ACAD_CTB.styles.every((s) => s.color === undefined && s.lineweight === undefined)).toBe(true);
        expect(builtinPlotStyleTable("grayscale.ctb")).toBeUndefined();
    });
});
