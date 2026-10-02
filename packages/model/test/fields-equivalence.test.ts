import { Diagnostics, tokenize } from "@truedxf/core";
import fc from "fast-check";
import { expect, it } from "vitest";
import { DxfDocument } from "../src/document.ts";
import { ENTITY_PARSERS, readBase, simpleParser } from "../src/entities/common.ts";
import { type FieldDef, type FieldKind, fieldTable, readFields } from "../src/fields.ts";
import { DxfRecord } from "../src/record.ts";
import { readFieldsOracle } from "./fields-oracle.ts";
import { DxfRecordOracle } from "./record-oracle.ts";

type Tag = readonly [number, string];
const enc = new TextEncoder();
function record(tags: readonly Tag[], type = "TEST"): DxfRecord {
  const lines = ["0", type];
  for (const [code, value] of tags) lines.push(String(code), value);
  lines.push("0", "EOF");
  const store = tokenize(enc.encode(`${lines.join("\n")}\n`));
  return new DxfRecord(store, 0, store.count - 1, 1);
}

function check(defs: readonly FieldDef[], tags: readonly Tag[], lenient: boolean, type: string): void {
  const rec = record(tags, type);
  const old = new DxfRecordOracle(rec.store, rec.start, rec.end, rec.id);
  expect(rec.parts).toEqual(old.parts);
  expect(rec.hasSubclasses).toBe(old.hasSubclasses);
  expect(rec.handle).toBe(old.handle);
  expect(rec.owner).toBe(old.owner);
  expect(rec.handle).toBe(old.handle); // cached lookups still agree
  expect(rec.extensionDictionary).toBe(old.extensionDictionary);
  expect(rec.reactors).toEqual(old.reactors);
  expect([...rec.dataTags()]).toEqual([...old.dataTags()]);
  // SEQEND is exposed directly on compound entities; its enumerable shape is hashed too.
  expect({ ...rec }).toEqual({ ...old });
  const table = fieldTable(defs, { lenient });
  const expected: Record<string, unknown> = {};
  const actual: Record<string, unknown> = {};
  let failure: Error | undefined;
  try {
    readFieldsOracle(rec, table, expected);
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    failure = e;
  }
  if (failure) expect(() => readFields(rec, table, actual)).toThrow(failure.message);
  else readFields(rec, table, actual);
  expect(actual).toEqual(expected);
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  // Scratch flags must be reset when the same compiled table is reused.
  if (failure) expect(() => readFields(rec, table)).toThrow(failure.message);
  else expect(readFields(rec, table)).toEqual(expected);
}

it("preserves definition identity/order, coordinate consumption, app ranges, and lenient recovery", () => {
  const point: FieldDef = { name: "point", code: 10, kind: "p3", subclass: "A" };
  const defs: FieldDef[] = [
    point,
    point,
    { name: "second", code: 10, kind: "p2", subclass: ["A", "B"], def: 42 },
    { name: "y", code: 20, kind: "num", subclass: "B", def: -1 },
    { name: "many", code: 11, kind: "p3", many: true },
    { name: "high", code: 1500, kind: "int" },
    { name: "negative", code: -1, kind: "str" },
  ];
  for (const tags of [
    [
      [100, "A"],
      [10, "1"],
      [102, "{APP"],
      [20, "99"],
      [102, "}"],
      [20, "2"],
      [30, "3"],
      [10, "4"],
    ],
    [
      [10, "1"],
      [11, "4"],
      [20, "2"],
      [21, "5"],
      [30, "3"],
      [31, "6"],
      [100, "A"],
      [10, "7"],
    ],
    [
      [100, "A"],
      [10, "1"],
      [20, "2"],
      [100, "B"],
      [10, "3"],
      [1500, "5.9"],
      [-1, "x"],
    ],
    [
      [100, "A"],
      [10, "1"],
      [30, "9"],
      [10, "2"],
      [20, "3"],
      [100, "A"],
      [10, "4"],
    ],
  ] as Tag[][])
    for (const lenient of [false, true]) check(defs, tags, lenient, "TEST");
});

it("matches the old field reader and structural scan on randomized records and definitions", () => {
  const code = fc.constantFrom(
    -1,
    5,
    6,
    8,
    10,
    11,
    20,
    21,
    30,
    31,
    40,
    70,
    100,
    101,
    102,
    105,
    160,
    210,
    220,
    230,
    290,
    310,
    330,
    360,
    999,
    1001,
    1004,
    1071,
    1500,
  );
  const kind = fc.constantFrom<FieldKind>(
    "str",
    "name",
    "num",
    "int",
    "bool",
    "handle",
    "p2",
    "p3",
    "bigint",
    "binary",
  );
  const def = fc.record({
    name: fc.constantFrom("a", "b", "c", "d", "e"),
    code,
    kind,
    subclass: fc.constantFrom(undefined, "", "A", "B", ["", "A"], ["A", "B"]),
    many: fc.boolean(),
    def: fc.constantFrom(undefined, 42, false, "default"),
  });
  const tag = fc.tuple(
    code,
    fc.constantFrom(
      "",
      "1",
      "-0",
      "2.5",
      "ABC",
      "A",
      "B",
      "{APP",
      "}",
      "{ACAD_XDICTIONARY",
      "{ACAD_REACTORS",
      "Embedded Object",
      "1e20",
      "\\U+0041",
      "NaN",
    ),
  );
  fc.assert(
    fc.property(
      fc.array(def, { maxLength: 12 }),
      fc.array(tag, { maxLength: 50 }),
      fc.boolean(),
      fc.constantFrom("TEST", "XRECORD", "DIMSTYLE"),
      check,
    ),
    { numRuns: 5000, seed: 1706 },
  );
});

it("supports recursive reads and returns scratch flags after exceptions", () => {
  const table = fieldTable([
    { name: "a", code: 10, kind: "num" },
    { name: "b", code: 20, kind: "num" },
  ]);
  const rec = record([
    [10, "1"],
    [20, "2"],
    [10, "9"],
  ]);
  let b = 0;
  const into = {
    a: 0,
    get b() {
      return b;
    },
    set b(value: number) {
      b = value;
      expect(
        readFields(
          record([
            [10, "3"],
            [20, "4"],
          ]),
          table,
        ),
      ).toEqual({ a: 3, b: 4 });
    },
  };
  readFields(rec, table, into);
  expect(into.a).toBe(1);
  expect(into.b).toBe(2);
  expect(() =>
    readFields(rec, table, {
      set b(_v: unknown) {
        throw new Error("setter");
      },
    }),
  ).toThrow("setter");
  expect(readFields(rec, table)).toEqual({ a: 1, b: 2 });
});

it("keeps public parser copying and discards partial fields on the document's fast failure path", () => {
  const defs: FieldDef[] = [{ name: "extra", code: 40, kind: "num", def: 7 }];
  const rec = record([[40, "2"]], "PERF_TEST");
  const base = { ...readBase(rec), custom: "retained" };
  const parser = simpleParser("PERF_TEST", defs);
  const entity = parser(rec, base, { acadver: "AC1009", diagnostics: new Diagnostics() }, undefined);
  expect(entity).toEqual({ ...base, extra: 2 });
  expect(entity).not.toBe(base);
  expect("extra" in base).toBe(false);
  const failing = simpleParser("PERF_TEST", defs, () => {
    throw new Error("postprocess");
  });
  ENTITY_PARSERS.set("PERF_TEST", failing);
  try {
    const doc = DxfDocument.load(
      enc.encode("0\nSECTION\n2\nENTITIES\n0\nPERF_TEST\n40\n2\n0\nENDSEC\n0\nEOF\n"),
    );
    const failed = doc.modelSpace.entities[0]!;
    expect(failed.type).toBe("UNKNOWN");
    expect("extra" in failed).toBe(false);
    expect(Object.keys(failed)).toEqual(Object.keys(readBase(failed.record)));
    expect(doc.diagnostics.summary()).toEqual({ entity: 1 });
  } finally {
    ENTITY_PARSERS.delete("PERF_TEST");
  }
});
