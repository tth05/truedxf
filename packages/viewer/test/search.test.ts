import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type RenderParams, ViewerCore } from "../src/protocol.ts";
import { dxf } from "./helpers.ts";

const font = new Uint8Array(
    readFileSync(join(import.meta.dirname, "..", "..", "fonts", "assets", "truedxf-test-uni.shx")),
);
const none = async () => undefined;

const DRAWING = dxf(`0 SECTION
2 ENTITIES
0 LINE
5 A
8 0
10 0
20 0
11 100
21 0
0 TEXT
5 B
8 0
10 10
20 20
40 3
1 Room 101
0 MTEXT
5 C
8 0
10 10
20 50
40 3
1 {\\fArial|b1;Room}\\P102
0 TEXT
5 D
8 0
10 60
20 50
40 3
1 Kitchen
0 ENDSEC
0 EOF`);

const params: RenderParams = {
    layout: "Model",
    area: { type: "window", min: [-10, -10], max: [110, 70] },
    canvas: [1200, 800],
    background: [0, 0, 0],
    layers: {},
    lineweights: false,
    raster: "smooth",
    annotations: true,
};

async function core(): Promise<ViewerCore> {
    const c = new ViewerCore(async () => font, none);
    c.load(DRAWING, "search.dxf");
    const r = await c.render(params);
    // texts and snap points stay in the backend
    expect(r.list.annotations).toBeUndefined();
    return c;
}

describe("search and snap requests", () => {
    it("find texts in reading order, case-insensitively, with their drawn bounds", async () => {
        const c = await core();
        const r = c.search("ROOM", 10);
        expect(r.layout).toBe("Model");
        expect(r.matches.map((m) => [m.handle, m.text])).toEqual([
            ["C", "Room\n102"],
            ["B", "Room 101"],
        ]);
        const b = r.matches[1]!.bounds;
        expect(b.minX).toBeGreaterThanOrEqual(9.5);
        expect(b.minY).toBeGreaterThanOrEqual(19.5);
        expect(b.maxY).toBeLessThan(24);
        expect(c.search("room 102", 10).total).toBe(1);
        expect(c.search("", 10).total).toBe(0);
        expect(c.search("cellar", 10).total).toBe(0);
    });

    it("snap to the nearest end or midpoint within the tolerance", async () => {
        const c = await core();
        expect(await c.handle({ type: "snap", point: [99, 1], tolerance: 2 })).toEqual({
            x: 100,
            y: 0,
            kind: 0,
        });
        expect(await c.handle({ type: "snap", point: [51, -1], tolerance: 2 })).toEqual({
            x: 50,
            y: 0,
            kind: 1,
        });
        expect(await c.handle({ type: "snap", point: [30, 30], tolerance: 2 })).toBeUndefined();
    });

    it("record nothing without annotations", async () => {
        const c = new ViewerCore(async () => font, none);
        c.load(DRAWING, "search.dxf");
        await c.render({ ...params, annotations: false });
        expect(c.search("room", 10).total).toBe(0);
        expect(await c.handle({ type: "snap", point: [99, 1], tolerance: 2 })).toBeUndefined();
    });
});
