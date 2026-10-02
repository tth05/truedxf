import type { DisplayList } from "@truedxf/render";
import { describe, expect, it } from "vitest";
import { LocalBackend } from "../src/backend.ts";
import { type RenderParams, type RenderResult, responseTransfer, ViewerCore } from "../src/protocol.ts";
import { dxf, SAMPLE } from "./helpers.ts";

const params = (over: Partial<RenderParams> = {}): RenderParams => ({
  layout: "Model",
  area: { type: "extents" },
  canvas: [400, 300],
  background: [0, 0, 0],
  layers: {},
  lineweights: true,
  raster: "smooth",
  ...over,
});

function fillColor(list: DisplayList): number[] | undefined {
  for (const b of list.batches) if (b.kind === 0) return [...b.colors.slice(0, 3)];
  return undefined;
}

describe("ViewerCore (worker backend logic)", () => {
  const none = async () => undefined;
  const core = new ViewerCore(none, none);
  const info = core.load(SAMPLE, "sample.dxf");

  it("describes the document", () => {
    expect(info.entityCount).toBe(3);
    expect(info.entityTypes).toEqual({ LINE: 1, CIRCLE: 1, SOLID: 1 });
    expect(info.layouts[0]).toMatchObject({ name: "Model", isModel: true });
    expect(info.layers.find((l) => l.name === "WALLS")).toMatchObject({
      rgb: 0xff0000,
      off: false,
      entities: 1,
    });
    expect(info.layers.find((l) => l.name === "TEXT")).toMatchObject({ off: true, entities: 1 });
    // layer 0 is used but not defined
    expect(info.layers.find((l) => l.name === "0")).toMatchObject({ entities: 1 });
  });

  it("defaults to viewer LOD, forwards its off switch, and ignores it for plots", async () => {
    const backend = new ViewerCore(none, none);
    backend.load(
      dxf(`0 SECTION\n2 ENTITIES\n0 LINE\n5 A\n8 0\n370 30\n10 0\n20 0\n11 10\n21 10\n0 ENDSEC\n0 EOF`),
      "lod.dxf",
    );
    const p = params({ area: { type: "window", min: [0, 0], max: [100, 100] } });
    const on = await backend.render(p);
    const off = await backend.render({ ...p, lod: false });
    expect(on.list.batches[0]!.kind).toBe(1); // 1-pixel hairline
    expect(off.list.batches[0]!.kind).toBe(0); // widened lineweight
    const plot = await backend.render({ ...p, raster: "autocad" });
    expect((await backend.render({ ...p, raster: "autocad", lod: false })).list).toEqual(plot.list);
  });

  it("renders extents despite unset header extents, with a pick index", async () => {
    const r = await core.render(params());
    expect(r.list.batches.length).toBeGreaterThan(0);
    // the circle is on a layer that is off: bounds are the line and the solid
    expect(r.list.bounds.minX).toBeCloseTo(0, 0);
    expect(r.list.bounds.maxX).toBeCloseTo(300, 0);
    expect(r.list.bounds.maxY).toBeCloseTo(100, 0);
    expect(new Set(r.list.entities)).toEqual(new Set(["A1", "A3"]));
    expect(await core.handle({ type: "pick", point: [50, 0.1], tolerance: 1 })).toMatchObject({
      handle: "A1",
    });
    expect(await core.handle({ type: "pick", point: [250, 50], tolerance: 1 })).toMatchObject({
      handle: "A3",
    });
  });

  it("applies layer toggles: hide, and show a layer that is off in the file", async () => {
    const r = await core.render(params({ layers: { walls: false, TEXT: true } }));
    expect(new Set(r.list.entities)).toEqual(new Set(["A2", "A3"]));
  });

  it("contrasts ACI 7 with the background", async () => {
    expect(fillColor((await core.render(params())).list)).toEqual([255, 255, 255]);
    expect(fillColor((await core.render(params({ background: [255, 255, 255] }))).list)).toEqual([0, 0, 0]);
  });

  it("inspects entities with raw tags and resolved properties", () => {
    const e = core.inspect("A1")!;
    expect(e).toMatchObject({ type: "LINE", handle: "A1" });
    expect(e.resolved).toMatchObject({ layer: "WALLS", aci: 1, rgb: "#ff0000" });
    expect(e.raw.color).toBe(256);
    expect(e.tags[0]).toEqual({ code: 0, value: "LINE" });
    expect(e.tags.find((t) => t.code === 11)?.value).toBe("100");
    expect(core.inspect("FFFF")).toBeUndefined();
  });

  it("lists every buffer of a render result for transfer", async () => {
    const r = await core.render(params());
    const t = responseTransfer(r);
    for (const b of r.list.batches) expect(t).toContain(b.positions.buffer);
    expect(new Set(t).size).toBe(t.length);
    expect(responseTransfer({ entityCount: 1 })).toEqual([]);
  });

  it("copies image pixels instead of transferring them (the renderer caches them)", async () => {
    const r = await core.render(params());
    const pixels = new Uint8Array(16);
    const withImage = { ...r, list: { ...r.list, images: [{ width: 2, height: 2, pixels }] } };
    expect(responseTransfer(withImage)).not.toContain(pixels.buffer);
  });

  it.each([false, true])("retains picking and geometry after transfer (merge=%s)", async (mergeBatches) => {
    const r = await core.render(params({ mergeBatches }));
    const firstBuffer = responseTransfer(r)[0]!;
    const copy: RenderResult = structuredClone(r, { transfer: responseTransfer(r) });
    expect(firstBuffer.byteLength).toBe(0);
    expect(copy.stats.batches).toBeGreaterThan(0);
    if (mergeBatches) {
      expect(copy.list.batches).toEqual([]);
      expect(copy.merged!.groups.length).toBeGreaterThan(0);
      expect(JSON.stringify(copy.merged)).not.toContain('"pick"');
    }
    expect(
      await core.handle({ type: "pick", point: [50, 0.1], tolerance: 1, generation: r.generation }),
    ).toMatchObject({ handle: "A1" });
    const geometry = await core.handle({ type: "geometry", entity: "A1", generation: r.generation });
    const highlighted = geometry as import("../src/drawing.ts").EntityGeometry;
    expect(highlighted.parts.length).toBeGreaterThan(0);
    expect(highlighted.bounds!.minX).toBeCloseTo(0, 0);
    expect(highlighted.bounds!.maxX).toBeCloseTo(100, 0);
    const transferred = structuredClone(highlighted, { transfer: responseTransfer(highlighted) });
    expect(transferred.parts[0]!.positions.byteLength).toBeGreaterThan(0);
    expect(await core.handle({ type: "geometry", entity: copy.list.entities.indexOf("A1") })).toEqual(
      transferred,
    );
    expect(await core.handle({ type: "pick", point: [50, 0.1], tolerance: 1 })).toMatchObject({
      handle: "A1",
    });
  });

  it("rejects old generations and keeps interactive state during auxiliary plots", async () => {
    const r = await core.render(params());
    await core.render(params({ layers: { WALLS: false }, retain: false }));
    expect(
      await core.handle({ type: "pick", point: [50, 0.1], tolerance: 1, generation: r.generation }),
    ).toMatchObject({ handle: "A1" });
    await core.render(params({ layers: { WALLS: false } }));
    expect(
      await core.handle({ type: "pick", point: [50, 0.1], tolerance: 1, generation: r.generation }),
    ).toBeUndefined();
    expect(await core.handle({ type: "geometry", entity: "A1", generation: r.generation })).toBeUndefined();
    core.load(SAMPLE, "new.dxf");
    expect(await core.handle({ type: "pick", point: [250, 50], tolerance: 1 })).toBeUndefined();
  });

  it("runs merged upload, pick and geometry through LocalBackend", async () => {
    const backend = new LocalBackend(none, none);
    await backend.call({ type: "load", bytes: SAMPLE, name: "sample.dxf" });
    const r = await backend.call({ type: "render", params: params({ mergeBatches: true }) });
    expect(r.list.batches).toEqual([]);
    expect((await backend.call({ type: "pick", point: [50, 0.1], tolerance: 1 }))?.handle).toBe("A1");
    expect((await backend.call({ type: "geometry", entity: "A1" }))?.parts.length).toBeGreaterThan(0);
    backend.dispose();
  });

  it("handles clip-aware pick and geometry requests through ViewerCore after transfer", async () => {
    const viewportCore = new ViewerCore(none, none);
    const info = viewportCore.load(
      dxf(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1009
9 $TILEMODE
70 0
0 ENDSEC
0 SECTION
2 ENTITIES
0 LINE
5 A1
8 0
10 -50
20 0
11 50
21 0
0 VIEWPORT
5 B1
8 0
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
17 0
27 0
37 0
12 0
22 0
45 20
0 ENDSEC
0 EOF
`),
      "viewport.dxf",
    );
    const r = await viewportCore.render(
      params({
        layout: info.activeLayout,
        area: { type: "window", min: [80, 80], max: [120, 120] },
        mergeBatches: true,
      }),
    );
    const uploaded = structuredClone(r, { transfer: responseTransfer(r) });
    expect(uploaded.list.clips.length).toBeGreaterThan(0);
    expect(await viewportCore.handle({ type: "pick", point: [100, 100.2], tolerance: 1 })).toMatchObject({
      handle: "A1",
    });
    expect(await viewportCore.handle({ type: "pick", point: [120, 100], tolerance: 1 })).toBeUndefined();
    const geometry = (await viewportCore.handle({
      type: "geometry",
      entity: "A1",
    })) as import("../src/drawing.ts").EntityGeometry;
    expect(geometry.parts.length).toBeGreaterThan(0);
    expect(geometry.parts.every((p) => (p.clip ?? -1) >= 0)).toBe(true);
    expect(geometry.bounds!.minX).toBeCloseTo(50, 0);
    expect(geometry.bounds!.maxX).toBeCloseTo(150, 0);
    expect(uploaded.list.clips[geometry.parts[0]!.clip!]).toBeDefined();
  });
});
