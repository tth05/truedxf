import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DxfDocument } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import { PrimitiveKind, renderPlot } from "../src/index.ts";
import { dxfBytes } from "./helpers.ts";

const ASSETS = join(import.meta.dirname, "../../fonts/assets");
const loadFont = async (name: string) => {
    try {
        return new Uint8Array(readFileSync(join(ASSETS, name)));
    } catch {
        return undefined;
    }
};

/** A SHAPE of truedxf-lt.shx (TDX_BOX = unit square from the origin) with extra group codes. */
function doc(shape: string, file = "truedxf-lt.shx"): DxfDocument {
    return DxfDocument.load(
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
5 3
70 1
0 STYLE
5 31
100 AcDbSymbolTableRecord
100 AcDbTextStyleTableRecord
2
70 1
40 0
41 1
50 0
71 0
42 0.2
3 ${file}
4
0 ENDTAB
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
0 ENDSEC
0 SECTION
2 ENTITIES
0 SHAPE
5 40
330 1F
100 AcDbEntity
8 0
100 AcDbShape
${shape}
0 ENDSEC
0 SECTION
2 OBJECTS
0 ENDSEC
0 EOF
`),
    );
}

const request = {
    layout: "Model",
    area: { type: "window" as const, min: [-10, -10] as const, max: [10, 10] as const },
    canvas: [400, 400] as const,
    lineweights: false,
};

async function vertices(
    d: DxfDocument,
): Promise<{ v: [number, number][]; unsupported: Record<string, number> }> {
    const r = await renderPlot(d, request, { loadFont, raster: "smooth" });
    const v: [number, number][] = [];
    for (const b of r.displayList.batches) {
        if (b.kind !== PrimitiveKind.Lines) continue;
        for (let k = 0; k < b.positions.length; k += 2)
            v.push([b.originX + b.positions[k]!, b.originY + b.positions[k + 1]!]);
    }
    return { v, unsupported: r.unsupported };
}

const has = (v: [number, number][], x: number, y: number) =>
    v.some(([a, b]) => Math.abs(a - x) < 1e-6 && Math.abs(b - y) < 1e-6);

describe("SHAPE entities (note 07 §14)", () => {
    it("draws the named shape: insertion, size, rotation", async () => {
        const { v, unsupported } = await vertices(doc("10 5\n20 5\n30 0\n40 2\n2 tdx_box\n50 90"));
        expect(unsupported).toEqual({});
        for (const [x, y] of [
            [5, 5],
            [5, 7],
            [3, 7],
            [3, 5],
        ] as const)
            expect(has(v, x, y)).toBe(true);
    });

    it("x-scale stretches along the shape x axis, oblique slants like TEXT", async () => {
        const { v } = await vertices(doc(`10 0\n20 0\n30 0\n40 2\n2 TDX_BOX\n41 2\n51 45`));
        for (const [x, y] of [
            [0, 0],
            [4, 0],
            [6, 2],
            [2, 2],
        ] as const)
            expect(has(v, x, y)).toBe(true);
    });

    it("10 is an OCS point: 210 = -Z mirrors shape and insertion point", async () => {
        const { v } = await vertices(doc("10 5\n20 5\n30 0\n40 2\n2 TDX_BOX\n210 0\n220 0\n230 -1"));
        for (const [x, y] of [
            [-5, 5],
            [-7, 5],
            [-7, 7],
            [-5, 7],
        ] as const)
            expect(has(v, x, y)).toBe(true);
    });

    it("draws nothing for an unknown name or a missing shape file", async () => {
        const a = await vertices(doc("10 0\n20 0\n30 0\n40 2\n2 NO_SUCH"));
        expect(a.v).toEqual([]);
        expect(a.unsupported["shape-not-found"]).toBe(1);
        const b = await vertices(doc("10 0\n20 0\n30 0\n40 2\n2 TDX_BOX", "missing.shx"));
        expect(b.v).toEqual([]);
        expect(b.unsupported["shape-missing-file"]).toBe(1);
    });

    it("finds a shape file stored with a foreign directory by its base name", async () => {
        const { v } = await vertices(
            doc("10 0\n20 0\n30 0\n40 1\n2 TDX_BOX", "D:\\elsewhere\\TRUEDXF-LT.SHX"),
        );
        expect(has(v, 1, 1)).toBe(true);
    });

    it("reports a missing shape file as a shapefile-missing note", async () => {
        const shape = "10 0\n20 0\n30 0\n40 2\n2 TDX_BOX";
        const env = { loadFont, raster: "smooth" as const };
        const r = await renderPlot(doc(shape, "C:\\x\\missing.shx"), request, env);
        const note = r.notes?.find((n) => n.code === "shapefile-missing");
        expect(note?.items).toEqual(["C:\\x\\missing.shx"]);
        expect(note?.count).toBe(1);
        const ok = await renderPlot(doc(shape), request, env);
        expect(ok.notes?.some((n) => n.code === "shapefile-missing") ?? false).toBe(false);
    });
});
