import fc from "fast-check";
import { expect, it } from "vitest";
import { tokenize } from "../src/index.ts";
import { binaryDxf, type TestTag } from "./binary-dxf.ts";

it("reads binary numbers exactly as generic value decoding, including truncated integers", () => {
  const tag = fc.oneof(
    fc.double().map((v): TestTag => [10, v]),
    fc.integer({ min: -32768, max: 32767 }).map((v): TestTag => [70, v]),
    fc.integer().map((v): TestTag => [90, v]),
    fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }).map((v): TestTag => [160, v]),
    fc.boolean().map((v): TestTag => [290, v]),
    fc.constant<TestTag>([1, "123"]),
    fc.constant<TestTag>([5, "ABC"]),
    fc.constant<TestTag>([310, new Uint8Array([1, 2])]),
  );
  fc.assert(
    fc.property(fc.array(tag, { maxLength: 40 }), fc.constantFrom<1 | 2>(1, 2), (tags, size) => {
      const bytes = binaryDxf([[0, "SECTION"], ...tags, [0, "EOF"]], size);
      // Nonzero byte offset catches accidental reads relative to the underlying buffer.
      const padded = new Uint8Array(bytes.length + 20);
      padded.set(bytes, 7);
      const store = tokenize(padded.subarray(7, 7 + bytes.length));
      for (let i = 0; i < store.count; i++) {
        const v = store.value(i);
        const n =
          typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : typeof v === "boolean" ? +v : NaN;
        expect(Object.is(store.num(i), n)).toBe(true);
        expect(Object.is(store.int(i), Math.trunc(n))).toBe(true);
      }
    }),
    { numRuns: 1000, seed: 1705 },
  );
});
