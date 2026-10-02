import { describe, expect, it } from "vitest";
import { PropertyResolver, TOP_LEVEL } from "../src/props.ts";
import { line, modelDoc } from "./helpers.ts";

describe("property context caching", () => {
  it("still reports missing resources once when cached and uncached contexts are visited", () => {
    const doc = modelDoc({ entities: line("A", 0, 0, 1, 1).replace("8 0", "8 MISSING\n6 MISSING") });
    const e = doc.modelSpace.entities[0]!;
    const props = new PropertyResolver(doc);
    const before = doc.diagnostics.summary();
    props.resolve(e, TOP_LEVEL);
    const after = doc.diagnostics.summary();
    expect((after["missing-layer"] ?? 0) - (before["missing-layer"] ?? 0)).toBe(1);
    expect((after["missing-linetype"] ?? 0) - (before["missing-linetype"] ?? 0)).toBe(1);
    props.isPlotted(e, TOP_LEVEL);
    props.resolve(e, TOP_LEVEL);
    props.viewport = { handle: "F", frozen: new Set() };
    props.resolve(e, TOP_LEVEL);
    expect(doc.diagnostics.summary()).toEqual(after);
  });

  it("isolates inheritance and viewport visibility, and reuses a restored context", () => {
    const doc = modelDoc({ entities: line("A", 0, 0, 1, 1, 0) });
    const e = doc.modelSpace.entities[0]!;
    const props = new PropertyResolver(doc);
    const top = props.properties(e, TOP_LEVEL);
    expect(props.properties(e, TOP_LEVEL)).toBe(top);
    expect(props.resolve(e, TOP_LEVEL)).toBe(props.resolve(e, TOP_LEVEL));
    const inherited = props.inherit({ ...e, color: 1 }, TOP_LEVEL);
    expect(props.properties(e, inherited).aci).toBe(1);
    expect(top.aci).toBe(7);
    props.viewport = { handle: "F", frozen: new Set(["0"]) };
    expect(props.properties(e, TOP_LEVEL).visible).toBe(false);
    props.viewport = undefined;
    expect(props.properties(e, TOP_LEVEL)).toBe(top);
  });
});
