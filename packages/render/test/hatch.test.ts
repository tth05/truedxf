import { describe, expect, it } from "vitest";
import { PrimitiveKind, renderPlot } from "../src/index.ts";
import { modelDoc } from "./helpers.ts";

const extents = {
  layout: "Model",
  area: { type: "extents" as const },
  canvas: [1000, 1000] as const,
  lineweights: false,
};

/** Square polyline path (91 = 1) of half size `h` around (cx, cy); MPOLYGON order 73 before 72. */
function squarePath(cx: number, cy: number, h: number, mpolygon = false): string {
  const v = [
    [cx - h, cy - h],
    [cx + h, cy - h],
    [cx + h, cy + h],
    [cx - h, cy + h],
  ];
  const flags = mpolygon ? "73 1\n72 0" : "72 0\n73 1";
  return `91 1\n92 3\n${flags}\n93 4\n${v.map(([x, y]) => `10 ${x}\n20 ${y}`).join("\n")}\n97 0`;
}

function inkBounds(list: Awaited<ReturnType<typeof renderPlot>>["displayList"]): number[] {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const batch of list.batches) {
    if (batch.kind !== PrimitiveKind.Triangles && batch.kind !== PrimitiveKind.Lines) continue;
    for (let k = 0; k + 1 < batch.positions.length; k += 2) {
      const x = batch.originX + batch.positions[k]!;
      const y = batch.originY + batch.positions[k + 1]!;
      b[0] = Math.min(b[0]!, x);
      b[1] = Math.min(b[1]!, y);
      b[2] = Math.max(b[2]!, x);
      b[3] = Math.max(b[3]!, y);
    }
  }
  return b;
}

describe("HATCH / MPOLYGON (note 06 §1)", () => {
  it("MPOLYGON paths are moved by the 11 offset vector (corpus ezdxf discussion-411)", async () => {
    const d = modelDoc({
      entities: `0 MPOLYGON
5 A0
330 1F
100 AcDbEntity
8 0
100 AcDbMPolygon
70 1
10 0
20 0
30 0
210 0
220 0
230 1
2 SOLID
71 1
${squarePath(0, 0, 1, true)}
76 1
63 256
11 100
21 50
99 0`,
    });
    const r = await renderPlot(d, extents, { raster: "smooth" });
    const b = inkBounds(r.displayList);
    expect(b[0]).toBeCloseTo(99, 6);
    expect(b[1]).toBeCloseTo(49, 6);
    expect(b[2]).toBeCloseTo(101, 6);
    expect(b[3]).toBeCloseTo(51, 6);
  });
});
