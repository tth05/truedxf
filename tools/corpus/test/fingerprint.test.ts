import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DxfDocument } from "@truedxf/model";
import type { DisplayList } from "@truedxf/render";
import { fingerprint, modelFingerprint, shape } from "../src/fingerprint-hash.ts";
import { coordinateDelta, runTask } from "../src/fingerprint-pipeline.ts";

test("canonical values: key order, omitted fields, exact numbers and framed strings", () => {
  assert.equal(fingerprint({ z: 1, a: 2 }), fingerprint({ a: 2, z: 1 }));
  assert.equal(
    fingerprint({ a: 1 }),
    fingerprint({ a: 1, b: undefined, record: 2, store: 3, tags: 4, endRecord: 5 }),
  );
  for (const [a, b] of [
    [0, -0],
    [NaN, null],
    [Infinity, "Infinity"],
    [1n, "1"],
    [1, 1 + Number.EPSILON],
  ])
    assert.notEqual(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(["a", "bc"]), fingerprint(["ab", "c"]));
});

test("model hash includes table metadata as well as entries", () => {
  const bytes = (handle: string) =>
    Buffer.from(`0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n5\n${handle}\n0\nENDTAB\n0\nENDSEC\n0\nEOF\n`);
  assert.notEqual(
    modelFingerprint(DxfDocument.load(bytes("A"))).hash,
    modelFingerprint(DxfDocument.load(bytes("B"))).hash,
  );
});

test("cycles and shared references are stable and distinct from duplicated values", () => {
  const a: Record<string, unknown> = { n: 1 };
  a.self = a;
  const b: Record<string, unknown> = { self: undefined, n: 1 };
  b.self = b;
  assert.equal(fingerprint(a), fingerprint(b));
  const shared = { n: 1 };
  assert.notEqual(fingerprint([shared, shared]), fingerprint([{ n: 1 }, { n: 1 }]));
  assert.equal(fingerprint([shared, shared], false), fingerprint([{ n: 1 }, { n: 1 }], false));
});

test("maps and sets sort entries; typed arrays hash only their visible byte range", () => {
  assert.equal(
    fingerprint(
      new Map([
        [{ x: 1 }, "a"],
        [{ x: 1 }, "b"],
      ]),
    ),
    fingerprint(
      new Map([
        [{ x: 1 }, "b"],
        [{ x: 1 }, "a"],
      ]),
    ),
  );
  assert.equal(
    fingerprint(
      new Map([
        ["a", 1],
        ["b", 2],
      ]),
    ),
    fingerprint(
      new Map([
        ["b", 2],
        ["a", 1],
      ]),
    ),
  );
  assert.equal(fingerprint(new Set([{ x: 1 }, { x: 2 }])), fingerprint(new Set([{ x: 2 }, { x: 1 }])));
  const map = new Map<string, unknown>();
  map.set("self", map);
  assert.equal(fingerprint(map), fingerprint(map));
  assert.equal(fingerprint(new Uint8Array([0, 1, 2, 3]).subarray(1, 3)), fingerprint(new Uint8Array([1, 2])));
  assert.notEqual(fingerprint(new Float32Array([0])), fingerprint(new Float32Array([-0])));
});

test("list shapes distinguish primitive kinds/counts from coordinates and colours", () => {
  const list: DisplayList = {
    pixelSize: 0.5,
    background: [255, 255, 255],
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    batches: [
      {
        kind: 1,
        originX: 10,
        originY: 20,
        clip: -1,
        positions: new Float32Array([0, 0, 1, 1]),
        colors: new Uint8Array(8),
        pick: new Uint32Array([0, 2, 0]),
      },
    ],
    clips: [],
    images: [],
    entities: ["A"],
  };
  const changed = { ...list, batches: [{ ...list.batches[0]!, positions: new Float32Array([0, 0, 2, 1]) }] };
  assert.deepEqual(shape(list), shape(changed));
  assert.notEqual(fingerprint(list, false), fingerprint(changed, false));
  assert.notEqual(
    shape(list).structure,
    shape({ ...list, batches: [{ ...list.batches[0]!, kind: 2 }] }).structure,
  );
  const dir = mkdtempSync(join(tmpdir(), "truedxf-fingerprint-"));
  const path = join(dir, "snapshot.bin");
  try {
    const json = Buffer.from(
      JSON.stringify({
        version: 1,
        lists: {
          viewer: {
            hash: "old",
            pixelSize: list.pixelSize,
            shape: shape(list),
            batches: [{ originX: 10, originY: 20, length: 4 }],
          },
        },
      }),
    );
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(json.length);
    writeFileSync(path, Buffer.concat([prefix, json, Buffer.from(list.batches[0]!.positions.buffer)]));
    assert.equal(coordinateDelta(path, "viewer", changed, "old"), 2);
    assert.equal(coordinateDelta(path, "viewer", list, "old"), 0);
    assert.equal(coordinateDelta(path, "viewer", list, "stale"), undefined);
    assert.equal(coordinateDelta(path, "plot", list, "old"), undefined);
  } finally {
    unlinkSync(path);
    rmdirSync(dir);
  }
});

test("pipeline snapshots round-trip and identical errors compare equal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "truedxf-fingerprint-"));
  const path = join(dir, "line.dxf");
  const positions = join(dir, "positions.bin");
  try {
    writeFileSync(
      path,
      "0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n10\n21\n10\n0\nENDSEC\n0\nEOF\n",
    );
    const target = { id: "line", name: "line", path };
    const saved = await runTask({ target, kinds: ["model", "viewer"], saveDetail: true, positions });
    assert.equal(saved.record.model?.error, undefined);
    assert.equal(saved.record.entities, 1);
    const checked = await runTask(
      { target, kinds: ["viewer"], positions },
      { viewer: saved.record.viewer!.hash },
    );
    assert.equal(checked.record.viewer?.hash, saved.record.viewer?.hash);
    assert.equal(checked.record.viewer?.delta, 0);
    assert.ok(readFileSync(positions).length > 4);
    const missing = { ...target, path: join(dir, "missing.dxf") };
    const a = await runTask({ target: missing, kinds: ["model", "viewer"] });
    const b = await runTask({ target: missing, kinds: ["model", "viewer"] });
    assert.ok(a.record.model?.error);
    assert.equal(a.record.model?.hash, b.record.model?.hash);
    assert.equal(a.record.viewer?.hash, b.record.viewer?.hash);
  } finally {
    unlinkSync(path);
    unlinkSync(positions);
    rmdirSync(dir);
  }
});
