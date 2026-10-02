import { DisplayListBuilder } from "@truedxf/render";
import { describe, expect, it } from "vitest";
import { buildPickData, PickIndex, segDist } from "../src/pick.ts";

function sample() {
  const b = new DisplayListBuilder(1);
  const black = [0, 0, 0, 255] as const;
  b.beginEntity("FILL");
  b.triangles([0, 0, 100, 0, 100, 100, 0, 0, 100, 100, 0, 100], black);
  b.endEntity();
  b.beginEntity("LINE");
  b.polyline([1000, 1000, 1100, 1000], black);
  // a second range of LINE, drawn over FILL
  b.polyline([10, 50, 90, 50], black);
  b.endEntity();
  b.beginEntity("TOP");
  b.triangles([40, 40, 60, 40, 60, 60], black);
  b.endEntity();
  b.beginEntity("DOT");
  b.points([500, 500], black);
  b.endEntity();
  return b.build();
}

describe("pick index", () => {
  const list = sample();
  // copies, like the transferable form the worker sends
  const data = buildPickData(list);
  const index = new PickIndex(list.batches, list.entities, {
    index: data.index!.slice(0),
    items: data.items.slice(),
  });

  it("indexes every pick range (consecutive primitives of an entity share one)", () => {
    expect(index.size).toBe(4);
  });

  it("prefers strokes near the point over areas containing it", () => {
    expect(index.pick(1050, 1002, 3)?.handle).toBe("LINE");
    expect(index.pick(1050, 1010, 3)).toBeUndefined();
    // on the LINE range lying over FILL: the stroke wins
    expect(index.pick(30, 51, 2)?.handle).toBe("LINE");
    expect(index.pick(20, 20, 2)?.handle).toBe("FILL");
    // inside two areas: the topmost (last drawn) wins
    expect(index.pick(50, 45, 0.5)?.handle).toBe("TOP");
    expect(index.pick(501, 500, 2)).toMatchObject({ handle: "DOT", distance: 1 });
  });

  it("lists the ranges of an entity for highlighting", () => {
    expect(index.ranges("LINE")).toEqual([{ batch: 1, first: 0, count: 4 }]);
    expect(index.ranges("nope")).toEqual([]);
  });

  it("bounds an entity over all of its ranges (zoomToEntity)", () => {
    expect(index.bounds("LINE")).toEqual({ minX: 10, minY: 50, maxX: 1100, maxY: 1000 });
    expect(index.bounds("DOT")).toEqual({ minX: 500, minY: 500, maxX: 500, maxY: 500 });
    expect(index.bounds("nope")).toBeUndefined();
  });

  it("joins the ranges of an entity drawn more than once (viewports); empty entities add nothing", () => {
    const b = new DisplayListBuilder(1);
    const black = [0, 0, 0, 255] as const;
    b.beginEntity("A");
    b.triangles([0, 0, 10, 0, 10, 10], black);
    b.endEntity();
    b.beginEntity("OFF");
    b.endEntity();
    b.beginEntity("A");
    b.triangles([100, 100, 110, 100, 110, 110], black);
    b.endEntity();
    const l = b.build();
    expect(l.entities).toEqual(["A", "A"]);
    const ix = new PickIndex(l.batches, l.entities, buildPickData(l));
    expect(ix.ranges("A")).toHaveLength(2);
    expect(ix.bounds("A")).toEqual({ minX: 0, minY: 0, maxX: 110, maxY: 110 });
  });

  it("handles empty lists", () => {
    const empty = new DisplayListBuilder(1).build();
    const d = buildPickData(empty);
    expect(d.index).toBeUndefined();
    expect(new PickIndex(empty.batches, empty.entities, d).pick(0, 0, 1)).toBeUndefined();
  });

  it("measures segment distances", () => {
    expect(segDist(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(segDist(-3, 4, 0, 0, 10, 0)).toBe(5);
    expect(segDist(1, 1, 0, 0, 0, 0)).toBeCloseTo(Math.SQRT2);
  });
});
