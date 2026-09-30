import type { DisplayList } from "@truedxf/render";
import { describe, expect, it } from "vitest";
import { PickIndex } from "../src/pick.ts";
import { type RenderParams, type RenderResult, responseTransfer, ViewerCore } from "../src/protocol.ts";
import { SAMPLE } from "./helpers.ts";

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

  it("renders extents despite unset header extents, with a pick index", async () => {
    const r = await core.render(params());
    expect(r.list.batches.length).toBeGreaterThan(0);
    // the circle is on a layer that is off: bounds are the line and the solid
    expect(r.list.bounds.minX).toBeCloseTo(0, 0);
    expect(r.list.bounds.maxX).toBeCloseTo(300, 0);
    expect(r.list.bounds.maxY).toBeCloseTo(100, 0);
    expect(new Set(r.list.entities)).toEqual(new Set(["A1", "A3"]));
    const pick = new PickIndex(r.list.batches, r.list.entities, r.pick);
    expect(pick.pick(50, 0.1, 1)?.handle).toBe("A1");
    expect(pick.pick(250, 50, 1)?.handle).toBe("A3");
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
    expect(t).toContain(r.pick.index);
    expect(t).toContain(r.pick.items.buffer);
    for (const b of r.list.batches) expect(t).toContain(b.positions.buffer);
    expect(new Set(t).size).toBe(t.length);
    expect(responseTransfer({ entityCount: 1 })).toEqual([]);
  });

  it("survives a structured clone with transfer (the worker message)", async () => {
    const r = await core.render(params());
    const copy: RenderResult = structuredClone(r, { transfer: responseTransfer(r) });
    // the originals are detached
    expect(r.pick.items.byteLength).toBe(0);
    const pick = new PickIndex(copy.list.batches, copy.list.entities, copy.pick);
    expect(pick.pick(50, 0.1, 1)?.handle).toBe("A1");
  });
});
