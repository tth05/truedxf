import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadDxf } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import { type RenderParams, ViewerCore } from "../src/protocol.ts";
import { renderWarnings, ViewerWarningCode } from "../src/warnings.ts";
import { dxf } from "./helpers.ts";

const none = async () => undefined;

const params = (over: Partial<RenderParams> = {}): RenderParams => ({
    layout: "Model",
    area: { type: "extents" },
    canvas: [400, 300],
    background: [255, 255, 255],
    layers: {},
    lineweights: true,
    raster: "smooth",
    ...over,
});

interface LayerSpec {
    name: string;
    color?: number;
    flags?: number;
    plot?: 0 | 1;
    trueColor?: number;
}

function layer(l: LayerSpec): string {
    return `0 LAYER
100 AcDbSymbolTableRecord
100 AcDbLayerTableRecord
2 ${l.name}
70 ${l.flags ?? 0}
62 ${l.color ?? 7}
${l.trueColor !== undefined ? `420 ${l.trueColor}` : ""}
6 Continuous
${l.plot === 0 ? "290 0" : ""}
370 -3`;
}

function line(handle: string, layerName: string, extra = ""): string {
    return `0 LINE
5 ${handle}
100 AcDbEntity
8 ${layerName}
${extra}
100 AcDbLine
10 0
20 0
30 0
11 100
21 50
31 0`;
}

function drawing(layers: LayerSpec[], entities: string[]): Uint8Array {
    return dxf(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1032
0 ENDSEC
0 SECTION
2 TABLES
0 TABLE
2 LAYER
${layers.map(layer).join("\n")}
0 ENDTAB
0 ENDSEC
0 SECTION
2 ENTITIES
${entities.join("\n")}
0 ENDSEC
0 EOF
`);
}

function load(bytes: Uint8Array): ViewerCore {
    const core = new ViewerCore(none, none);
    core.load(bytes, "test.dxf");
    return core;
}

const codes = (ws: readonly { code: string }[]) => ws.map((w) => w.code);

describe("viewer warnings", () => {
    it("reports values that are not numbers; the entities holding them are skipped", async () => {
        const bad = line("A2", "0").replace("10 0\n", "10 nan\n").replace("21 50", "21 inf");
        const core = new ViewerCore(none, none);
        const info = core.load(drawing([{ name: "0" }], [line("A1", "0"), bad]), "nan.dxf");
        expect(info.warnings).toEqual([
            expect.objectContaining({ code: ViewerWarningCode.UnparsedNumber, count: 2 }),
        ]);
        expect((await core.render(params())).list.batches.length).toBeGreaterThan(0);
    });

    it("flags a drawing whose content layers are all set not to plot (LibreDWG 290 = 0)", async () => {
        const bytes = drawing(
            [
                { name: "0", plot: 0 },
                { name: "A", plot: 0, color: 1 },
            ],
            [line("A1", "0"), line("A2", "A")],
        );
        const core = new ViewerCore(none, none);
        const info = core.load(bytes, "noplot.dxf");
        expect(info.warnings).toHaveLength(1);
        expect(info.warnings[0]).toMatchObject({
            code: ViewerWarningCode.LayersNoPlot,
            severity: "info",
            items: ["0", "A"],
        });
        // the viewer shows no-plot layers: nothing to explain on screen
        const shown = await core.render(params());
        expect(shown.list.batches.length).toBeGreaterThan(0);
        expect(shown.warnings).toEqual([]);
        // a plot of it is empty, and says why
        const plotted = await core.render(params({ visibility: "plot" }));
        expect(plotted.list.batches).toHaveLength(0);
        expect(codes(plotted.warnings)).toEqual([ViewerWarningCode.LayersNoPlot]);
    });

    it("does not flag a drawing with at least one plotting content layer", () => {
        const info = new ViewerCore(none, none).load(
            drawing(
                [
                    { name: "0", plot: 0 },
                    { name: "A", color: 1 },
                ],
                [line("A1", "0"), line("A2", "A")],
            ),
            "x.dxf",
        );
        expect(info.warnings).toEqual([]);
    });

    it("explains an empty view when every content layer is off or frozen", async () => {
        const core = load(
            drawing(
                [{ name: "0", color: -7 }, { name: "F", flags: 1 }, { name: "UNUSED" }],
                [line("A1", "0"), line("A2", "F")],
            ),
        );
        const r = await core.render(params());
        expect(r.list.batches).toHaveLength(0);
        expect(r.warnings).toHaveLength(1);
        expect(r.warnings[0]).toMatchObject({
            code: ViewerWarningCode.LayersHidden,
            layout: "Model",
            items: ["0", "F"],
        });
        expect(r.warnings[0]!.message).toContain("off or frozen");
        // turning them on in the viewer clears it
        expect((await core.render(params({ layers: { "0": true, f: true } }))).warnings).toEqual([]);
    });

    it("explains an empty view when the viewer hides every content layer", async () => {
        const core = load(drawing([{ name: "A", color: 1 }], [line("A1", "A")]));
        const r = await core.render(params({ layers: { A: false } }));
        expect(codes(r.warnings)).toEqual([ViewerWarningCode.LayersHidden]);
        expect(r.warnings[0]!.message).toContain("hidden");
    });

    it("reports an empty layout", async () => {
        const r = await load(drawing([{ name: "0" }], [])).render(params());
        expect(codes(r.warnings)).toEqual([ViewerWarningCode.LayoutEmpty]);
    });

    it("reports entities that draw nothing", async () => {
        // 60 = 1: invisible
        const r = await load(drawing([{ name: "0" }], [line("A1", "0", "60 1")])).render(params());
        expect(r.list.batches).toHaveLength(0);
        expect(r.warnings[0]).toMatchObject({ code: ViewerWarningCode.NothingVisible, count: 1 });
    });

    it("shows white true colours on a light background (QCAD layer 0 with 420 = 0xFFFFFF)", async () => {
        const core = load(drawing([{ name: "0", trueColor: 0xffffff }], [line("A1", "0")]));
        const color = (list: { batches: readonly { colors: Uint8Array }[] }) => [
            ...list.batches[0]!.colors.slice(0, 3),
        ];
        const light = await core.render(params());
        expect(color(light.list)).toEqual([0, 0, 0]);
        // the flip is reported (info): original colour and its layer
        expect(light.warnings).toEqual([
            {
                code: ViewerWarningCode.ColorsAdjusted,
                severity: "info",
                message: expect.stringContaining("drawn in black for contrast"),
                layout: "Model",
                items: ["#FFFFFF (layer 0)"],
                count: 1,
            },
        ]);
        // near-white too
        const near = load(drawing([{ name: "0", trueColor: 0xfafbfc }], [line("A1", "0")]));
        expect(color((await near.render(params())).list)).toEqual([0, 0, 0]);
        // and near-black on a dark background
        const dark = load(drawing([{ name: "0", trueColor: 0x030301 }], [line("A1", "0")]));
        const darkRender = await dark.render(params({ background: [33, 40, 48] }));
        expect(color(darkRender.list)).toEqual([255, 255, 255]);
        expect(darkRender.warnings[0]?.message).toContain("drawn in white for contrast");
        expect(darkRender.warnings[0]?.items).toEqual(["#030301 (layer 0)"]);
        // a light colour that is not white keeps its RGB
        const grey = load(drawing([{ name: "0", trueColor: 0xe0e0e0 }], [line("A1", "0")]));
        const greyRender = await grey.render(params());
        expect(color(greyRender.list)).toEqual([0xe0, 0xe0, 0xe0]);
        expect(greyRender.warnings).toEqual([]);
        // ACI 255 (palette white) flips too, reported as an ACI colour
        const aci = load(drawing([{ name: "W", color: 255 }], [line("A1", "W")]));
        expect((await aci.render(params())).warnings[0]?.items).toEqual(["ACI 255 (layer W)"]);
        // plot emulation keeps the true colour (no note): white on white paper, flagged as invisible
        const plot = await core.render(params({ raster: "autocad", visibility: "plot" }));
        expect(codes(plot.warnings)).toEqual([ViewerWarningCode.ContentInvisible]);
    });

    it("passes render notes through (missing fonts)", () => {
        const doc = loadDxf(drawing([{ name: "0" }], [line("A1", "0")]));
        const ws = renderWarnings(doc, {
            layout: "Model",
            toggles: new Map(),
            visibility: "display",
            list: {
                background: [255, 255, 255],
                batches: [
                    {
                        kind: 1,
                        originX: 0,
                        originY: 0,
                        positions: new Float32Array([0, 0, 1, 1]),
                        colors: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
                        clip: -1,
                        pick: new Uint32Array(),
                    },
                ],
            },
            unsupported: {},
            notes: [{ code: "font-missing", message: "Fonts not found: a.shx", items: ["a.shx"], count: 2 }],
        });
        expect(ws).toEqual([
            {
                code: ViewerWarningCode.FontMissing,
                severity: "warning",
                message: "Fonts not found: a.shx",
                layout: "Model",
                items: ["a.shx"],
                count: 2,
            },
        ]);
    });
});

describe("missing fonts", () => {
    const assets = join(import.meta.dirname, "..", "..", "fonts", "assets");
    // only "fb.shx" exists: the style's romans.shx and every default fallback are missing
    const loadFont = async (name: string) =>
        name.toLowerCase() === "fb.shx"
            ? new Uint8Array(readFileSync(join(assets, "truedxf-test-uni.shx")))
            : undefined;
    const bytes = dxf(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1032
0 ENDSEC
0 SECTION
2 TABLES
0 TABLE
2 BLOCK_RECORD
5 1
70 1
0 BLOCK_RECORD
5 1F
330 1
100 AcDbSymbolTableRecord
100 AcDbBlockTableRecord
2 *Model_Space
0 ENDTAB
0 TABLE
2 STYLE
0 STYLE
2 Standard
70 0
40 0
41 1
50 0
71 0
42 2.5
3 romans.shx
4
0 ENDTAB
0 ENDSEC
0 SECTION
2 ENTITIES
0 TEXT
5 T1
330 1F
100 AcDbEntity
8 0
100 AcDbText
10 0
20 0
30 0
40 5
1 AB
7 Standard
0 ENDSEC
0 EOF
`);

    it("draws text with the fallback font and reports the missing font", async () => {
        const core = new ViewerCore(loadFont, none);
        core.load(bytes, "fonts.dxf");
        const r = await core.render(params({ fallbackFont: ["nope.ttf", "fb.shx"] }));
        expect(r.list.batches.length).toBeGreaterThan(0);
        const w = r.warnings.find((x) => x.code === ViewerWarningCode.FontMissing);
        expect(w).toMatchObject({ severity: "warning", layout: "Model" });
        expect(w?.items).toContain("romans.shx");
    });
});
