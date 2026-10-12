import type { DisplayList } from "@truedxf/render";
import { expect, it } from "vitest";
import { entityBounds, expandView, needsCoverage } from "../src/cull.ts";
import { type RenderParams, ViewerCore } from "../src/protocol.ts";
import { dxf, SAMPLE } from "./helpers.ts";

const none = async () => undefined;
const params: RenderParams = {
    layout: "Model",
    area: { type: "extents" },
    canvas: [400, 300],
    background: [0, 0, 0],
    layers: {},
    lineweights: true,
    raster: "smooth",
};
const near = { minX: -10, minY: -10, maxX: 110, maxY: 10 };
const zoom = {
    type: "window" as const,
    min: [-10, -10] as [number, number],
    max: [110, 10] as [number, number],
};
it("culls whole top-level picks, preserves fine geometry, and never culls extents or plots", async () => {
    const core = new ViewerCore(none, none);
    core.load(SAMPLE, "sample");
    await core.render(params);
    const detail = await core.render({ ...params, area: zoom, cull: near });
    expect(detail.covered).toEqual(near);
    expect(detail.list.entities).toEqual(["A1"]);
    const full = await core.render({ ...params, area: zoom });
    expect(detail.list.batches[0]!.positions).toEqual(full.list.batches[0]!.positions);
    expect((await core.render({ ...params, cull: near })).covered).toBeUndefined();
    const plot = await core.render({ ...params, area: zoom, raster: "autocad", cull: near });
    expect(plot.covered).toBeUndefined();
    const fullPlot = await core.render({ ...params, area: zoom, raster: "autocad" });
    expect(plot.list).toEqual(fullPlot.list);
});
it("invalidates bounds on settings/load and leaves auxiliary plots independent", async () => {
    const core = new ViewerCore(none, none);
    core.load(SAMPLE, "sample");
    await core.render(params);
    await core.render({ ...params, raster: "autocad", retain: false });
    expect((await core.render({ ...params, area: zoom, cull: near })).covered).toEqual(near);
    const toggled = await core.render({ ...params, area: zoom, layers: { TEXT: true }, cull: near });
    expect(toggled.covered).toBeUndefined();
    expect(toggled.list.entities).toContain("A2");
    const lw = await core.render({ ...params, area: zoom, lineweights: false, cull: near });
    expect(lw.covered).toBeUndefined();
    core.load(SAMPLE, "again");
    expect((await core.render({ ...params, area: zoom, cull: near })).covered).toBeUndefined();
});
it("unions repeated viewport handles with origins and keeps unbounded handles unknown", () => {
    const batch = (originX: number, unbounded = false) => ({
        originX,
        originY: 100,
        positions: Float32Array.of(0, 0, 2, 3),
        pick: Uint32Array.of(0, 2, 0),
        unbounded,
    });
    const list = { entities: ["A"], batches: [batch(1000), batch(-1000)] } as unknown as DisplayList;
    expect(entityBounds(list).get("A")).toEqual({ minX: -1000, minY: 100, maxX: 1002, maxY: 103 });
    list.batches.push(batch(0, true) as unknown as DisplayList["batches"][number]);
    expect(entityBounds(list).has("A")).toBe(false);
});
it("keeps an INSERT's children when only its top-level handle passes", async () => {
    const core = new ViewerCore(none, none);
    core.load(
        dxf(`0 SECTION
2 BLOCKS
0 BLOCK
2 B
10 0
20 0
0 LINE
5 C1
10 0
20 0
11 10
21 0
0 ENDBLK
0 ENDSEC
0 SECTION
2 ENTITIES
0 INSERT
5 A1
2 B
10 0
20 0
0 INSERT
5 A2
2 B
10 1000
20 0
0 ENDSEC
0 EOF`),
        "blocks",
    );
    await core.render(params);
    const r = await core.render({ ...params, area: zoom, cull: near });
    expect(r.list.entities).toEqual(["A1"]);
    expect(r.stats.vertices).toBeGreaterThan(0);
});
it("uses paper coordinates for viewport content", async () => {
    const core = new ViewerCore(none, none);
    const info = core.load(
        dxf(`0 SECTION
2 HEADER
9 $TILEMODE
70 0
0 ENDSEC
0 SECTION
2 ENTITIES
0 LINE
5 A1
10 -5
20 0
11 5
21 0
0 VIEWPORT
5 B1
67 1
10 100
20 100
40 20
41 20
68 1
69 2
16 0
26 0
36 1
45 20
0 ENDSEC
0 EOF`),
        "paper",
    );
    const p = { ...params, layout: info.activeLayout };
    await core.render(p);
    const cull = { minX: 90, minY: 90, maxX: 110, maxY: 110 };
    expect((await core.render({ ...p, area: zoom, cull })).list.entities).toContain("A1");
    expect((await core.render({ ...p, area: zoom, cull: near })).list.entities).not.toContain("A1");
});
it("expands by a view size and requests before exhausting the pan margin", () => {
    const v = { minX: 0, minY: 0, maxX: 100, maxY: 80 };
    const c = expandView(v);
    expect(c).toEqual({ minX: -100, minY: -80, maxX: 200, maxY: 160 });
    expect(needsCoverage(v, c)).toBe(false);
    expect(needsCoverage({ ...v, minX: 26, maxX: 126 }, c)).toBe(true);
});

it("preserves complete-layout diagnostics in an empty culled window", async () => {
    const core = new ViewerCore(none, none);
    core.load(SAMPLE, "sample");
    const fit = await core.render(params);
    const cull = { minX: 10000, minY: 10000, maxX: 10100, maxY: 10100 };
    const empty = await core.render({ ...params, area: zoom, cull });
    expect(empty.covered).toEqual(cull);
    expect(empty.stats.vertices).toBe(0);
    expect(empty.warnings).toEqual(fit.warnings);
});
