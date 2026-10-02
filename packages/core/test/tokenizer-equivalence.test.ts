import fc from "fast-check";
import { expect, it } from "vitest";
import { Diagnostics, tokenize } from "../src/index.ts";
import { tokenizeAsciiOracle } from "./tokenizer-oracle.ts";

const enc = new TextEncoder();

function check(bytes: Uint8Array): void {
  const before = new Diagnostics();
  const after = new Diagnostics();
  const expected = tokenizeAsciiOracle(bytes, before);
  const actual = tokenize(bytes, { diagnostics: after });
  expect(actual.codes).toEqual(expected.codes);
  expect(actual.codeStarts).toEqual(expected.codeStarts);
  expect(actual.valueStarts).toEqual(expected.valueStarts);
  expect(actual.valueEnds).toEqual(expected.valueEnds);
  expect(actual.count).toBe(expected.count);
  expect(actual.end).toBe(expected.end);
  expect(after.items).toEqual(before.items);
}

it("preserves every offset and diagnostic for malformed and mixed line endings", () => {
  for (const eol of ["\n", "\r", "\r\n"]) {
    for (const bom of ["", "\uFEFF"]) {
      for (const tail of ["", eol, `${eol} \t\r\x1a\0`, `${eol}garbage`]) {
        for (const code of ["", " \t", "+", "-0", "999999", "1000000", "10x", "10 // x", "\r10", "10\r"]) {
          check(enc.encode(`${bom}${code}${eol}value${eol}0${eol} eOf \t${tail}`));
          check(enc.encode(`${bom}${code}${tail}`));
        }
      }
    }
  }
  for (const text of ["0\nEOF\r", "0\rEOF\n", "10\r\r\nx\n", "10\n\r\n", "10\n", "10", "0\nEOF\n10\nx"])
    check(enc.encode(text));
});

it("matches the old tokenizer on arbitrary bytes and randomized code/value lines", () => {
  fc.assert(fc.property(fc.uint8Array({ maxLength: 500 }), check), { numRuns: 3000, seed: 1701 });
  const line = fc.oneof(
    fc.integer({ min: -1000000, max: 1000000 }).map(String),
    fc.constantFrom("", " \t", "+10", "-0", "0", "EOF", "10 // note", "1x", "\0", "\x1a", "\r"),
  );
  fc.assert(
    fc.property(fc.array(line, { maxLength: 50 }), fc.constantFrom("\n", "\r", "\r\n"), (lines, eol) => {
      check(enc.encode(lines.join(eol)));
    }),
    { numRuns: 3000, seed: 1702 },
  );
});
