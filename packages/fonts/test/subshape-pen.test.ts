import { describe, expect, it } from "vitest";
import type { ShapeOp } from "../src/shx/bytecode.ts";
import { interpretOps } from "../src/shx/interpret.ts";

describe("SHX subshapes (note 04 §4.3)", () => {
  it("start with the pen down even when the caller lifted it (amgdt f/n, triage 2026-10-01)", () => {
    const sub: ShapeOp[] = [{ op: "vector", length: 1, dir: 0 }, { op: "end" }];
    const main: ShapeOp[] = [
      { op: "penUp" },
      { op: "vector", length: 2, dir: 4 },
      { op: "subshape", shape: 3 },
      { op: "end" },
    ];
    const r = interpretOps(main, { fileKind: "shapes", modes: 0, ops: (n) => (n === 3 ? sub : undefined) });
    expect(r.strokes.map((s) => s.vertices.map((v) => [v.x, v.y]))).toEqual([
      [
        [0, 2],
        [1, 2],
      ],
    ]);
  });
});
