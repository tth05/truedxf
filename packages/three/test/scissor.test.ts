import { expect, it } from "vitest";
import { coverageScissors } from "../src/scissor.ts";

it.each([
  { minX: 2, minY: 3, maxX: 8, maxY: 9 },
  { minX: -20, minY: -20, maxX: 20, maxY: 20 },
  { minX: 20, minY: 20, maxX: 30, maxY: 30 },
  { minX: -1, minY: 3.3, maxX: 6.7, maxY: 15 },
])("partitions every pixel exactly once for %o", (covered) => {
  const { inside, outside } = coverageScissors({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, covered, 17, 13);
  const hits = new Uint8Array(17 * 13);
  for (const [x, y, w, h] of [inside, ...outside])
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) hits[yy * 17 + xx]!++;
  expect([...hits].every((n) => n === 1)).toBe(true);
});
