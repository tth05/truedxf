import { Affine2, Matrix44 } from "@truedxf/geometry";
import { DxfDocument } from "@truedxf/model";
import { describe, expect, it, vi } from "vitest";
import { BlockRecorder, replayBlockStream, splitBlockTransform } from "../src/block-stream.ts";
import {
  DEFAULT_CALIBRATION,
  DisplayListBuilder,
  Frontend,
  type PlotRequest,
  type RenderEnv,
  setBlockClipHook,
} from "../src/index.ts";
import { TOP_LEVEL } from "../src/props.ts";
import { dxfBytes, line } from "./helpers.ts";

const insert = (id: string, name = "B", fields = "") => {
  const rows = fields.split("\n");
  const common = rows.filter((r) => /^(8|6|62|370|420|440) /.test(r));
  const local = rows.filter((r) => !/^(8|6|62|370|420|440) /.test(r));
  return `0 INSERT\n5 ${id}\n100 AcDbEntity\n${common.some((r) => r.startsWith("8 ")) ? "" : "8 0"}\n${common.some((r) => r.startsWith("62 ")) ? "" : "62 1"}\n${common.join("\n")}\n100 AcDbBlockReference\n2 ${name}\n${local.some((r) => r.startsWith("10 ")) ? "" : "10 0"}\n${local.some((r) => r.startsWith("20 ")) ? "" : "20 0"}\n${local.join("\n")}`;
};
const block = (name: string, content: string) =>
  `0 BLOCK\n100 AcDbEntity\n8 0\n100 AcDbBlockBegin\n2 ${name}\n70 0\n10 0\n20 0\n${content}\n0 ENDBLK\n100 AcDbEntity\n8 0\n100 AcDbBlockEnd`;
const document = (
  entities: string,
  content = `${line("30", 0, 0, 10, 2, 0)}\n${line("31", 0, 3, 10, 5, 0)}`,
  blocks = "",
  tables = "",
) =>
  DxfDocument.load(
    dxfBytes(
      `0 SECTION\n2 HEADER\n9 $ACADVER\n1 AC1032\n0 ENDSEC\n0 SECTION\n2 TABLES\n${tables}\n0 ENDSEC\n0 SECTION\n2 BLOCKS\n${block("B", content)}\n${blocks}\n0 ENDSEC\n0 SECTION\n2 ENTITIES\n${entities}\n0 ENDSEC\n0 EOF`,
    ),
  );
const request: PlotRequest = {
  layout: "Model",
  area: { type: "window", min: [-20, -20], max: [100, 100] },
  canvas: [1000, 1000],
  lineweights: true,
  sysvars: { PLOTTRANSPARENCYOVERRIDE: 1 },
};
function frontend(doc: DxfDocument, env: RenderEnv = {}) {
  return new Frontend(doc, request, { minX: -20, minY: -20, maxX: 100, maxY: 100 }, DEFAULT_CALIBRATION, {
    raster: "smooth",
    lod: true,
    ...env,
  });
}
function draw(doc: DxfDocument, env: RenderEnv = {}) {
  const fe = frontend(doc, env);
  fe.drawBlock(doc.modelSpace);
  return { list: fe.build(), unsupported: fe.unsupported };
}
function coordinates(list: ReturnType<DisplayListBuilder["build"]>) {
  return list.batches.flatMap((b) => [...b.positions].map((v, i) => v + (i % 2 ? b.originY : b.originX)));
}

describe("viewer block streams", () => {
  it("skips single continuous LINEs but admits dashed lines on the second use", () => {
    for (const dashed of [false, true]) {
      const entities = Array.from({ length: 10 }, (_, i) =>
        insert((64 + i).toString(16), "B", `10 ${i * 10}`),
      ).join("\n");
      const tables =
        "0 TABLE\n2 LTYPE\n0 LTYPE\n100 AcDbSymbolTableRecord\n100 AcDbLinetypeTableRecord\n2 DASH\n70 0\n3 dash\n72 65\n73 2\n40 3\n49 2\n74 0\n49 -1\n74 0\n0 ENDTAB";
      const doc = document(
        entities,
        `${line("30", 0, 0, 10, 2, 0)}\n6 ${dashed ? "DASH" : "Continuous"}`,
        "",
        tables,
      );
      const fe = frontend(doc),
        captures: boolean[] = [],
        original = fe.drawEntities.bind(fe);
      vi.spyOn(fe, "drawEntities").mockImplementation((es, st) => {
        if (es === doc.getBlock("B")!.entities) captures.push(fe.builder instanceof BlockRecorder);
        original(es, st);
      });
      fe.drawBlock(doc.modelSpace);
      expect(captures).toEqual(dashed ? [false, true] : Array(10).fill(false));
      expect(fe.build()).toEqual(draw(doc, { blockReuse: false }).list);
    }
  });
  it("admits only repeated keys and captures exactly on their second use", () => {
    const doc = document(`${insert("40")}\n${insert("41", "B", "10 30")}\n${insert("42", "B", "10 60")}`);
    const fe = frontend(doc),
      b = doc.getBlock("B")!,
      captures: boolean[] = [];
    const original = fe.drawEntities.bind(fe);
    vi.spyOn(fe, "drawEntities").mockImplementation((entities, st) => {
      if (entities === b.entities) captures.push(fe.builder instanceof BlockRecorder);
      original(entities, st);
    });
    const state = { m: Matrix44.identity(), inh: TOP_LEVEL, stack: ["*MODEL_SPACE"] };
    fe.drawEntity(doc.modelSpace.entities[0]!, state);
    expect(captures).toEqual([false]);
    fe.drawEntity(doc.modelSpace.entities[1]!, state);
    expect(captures).toEqual([false, true]);
    fe.drawEntity(doc.modelSpace.entities[2]!, state);
    expect(captures).toEqual([false, true]);
    expect(fe.build()).toEqual(draw(doc, { blockReuse: false }).list);
  });
  it("preserves the first use's resolver mode when its signature is deferred", () => {
    const doc = document(insert("40")),
      fe = frontend(doc),
      b = doc.getBlock("B")!,
      captures: boolean[] = [],
      original = fe.drawEntities.bind(fe);
    vi.spyOn(fe, "drawEntities").mockImplementation((es, st) => {
      if (es === b.entities) captures.push(fe.builder instanceof BlockRecorder);
      original(es, st);
    });
    for (const extents of [true, false, false, false]) {
      fe.props.extents = extents;
      fe.drawBlockContent(b, Matrix44.identity(), doc.modelSpace.entities[0]!, {
        m: Matrix44.identity(),
        inh: TOP_LEVEL,
        stack: ["*MODEL_SPACE"],
      });
    }
    expect(captures).toEqual([false, false, true]);
  });
  it("falls back for arbitrary clip hooks even when the first reference is unclipped", () => {
    const doc = document(
      `${insert("40")}\n${insert("41", "B", "10 30")}`,
      insert("31", "C"),
      block("C", line("32", 0, 0, 10, 2)),
    );
    const hook = vi.fn(() => undefined);
    const previous = setBlockClipHook(hook);
    try {
      const fe = frontend(doc),
        spy = vi.spyOn(fe, "drawEntities");
      fe.drawBlock(doc.modelSpace);
      expect(spy.mock.calls.filter(([es]) => es === doc.getBlock("C")!.entities)).toHaveLength(2);
      expect(hook).toHaveBeenCalledTimes(4);
    } finally {
      setBlockClipHook(previous!, true);
    }
  });
  it("leaves top-level culling outside cached content traversal", () => {
    const doc = document(`${insert("40")}\n${insert("41", "B", "10 30")}\n${insert("42", "B", "10 60")}`);
    const env: RenderEnv = { topLevelFilter: (e) => e.handle !== "40" };
    const on = draw(doc, env);
    expect(on).toEqual(draw(doc, { ...env, blockReuse: false }));
    expect(on.list.entities).toEqual(["41", "42"]);
  });

  it("does not cache a definition containing a nested clip hook or target-axis gradient", () => {
    const gradient =
      "0 HATCH\n5 30\n100 AcDbEntity\n8 0\n100 AcDbHatch\n2 SOLID\n70 1\n71 0\n91 1\n92 3\n72 0\n73 1\n93 4\n10 0\n20 0\n10 10\n20 0\n10 10\n20 10\n10 0\n20 10\n97 0\n75 0\n76 0\n98 0\n450 1\n451 0\n452 0\n453 2\n460 0\n461 0\n462 0\n463 0\n421 16711680\n463 1\n421 255\n470 LINEAR";
    for (const content of [
      gradient,
      insert("31", "C").replace("100 AcDbEntity", "102 {ACAD_XDICTIONARY\n360 90\n102 }\n100 AcDbEntity"),
    ]) {
      const doc = document(
        `${insert("40")}\n${insert("41", "B", "10 30")}`,
        content,
        block("C", line("32", 0, 0, 10, 2)),
      );
      const fe = frontend(doc),
        spy = vi.spyOn(fe, "drawEntities");
      fe.drawBlock(doc.modelSpace);
      expect(spy.mock.calls.filter(([es]) => es === doc.getBlock("B")!.entities)).toHaveLength(2);
      expect(fe.build()).toEqual(draw(doc, { blockReuse: false }).list);
    }
  });

  it("draws directly once, records the second use and replays later references with per-INSERT picks", () => {
    const doc = document(
      `${insert("40")}\n${insert("41", "B", "10 25\n20 10\n50 90")}\n${insert("42", "B", "10 50\n20 50\n50 37")}`,
    );
    const fe = frontend(doc);
    const spy = vi.spyOn(fe, "drawEntities");
    fe.drawBlock(doc.modelSpace);
    expect(spy.mock.calls.filter(([entities]) => entities === doc.getBlock("B")!.entities)).toHaveLength(2);
    const list = fe.build();
    const off = draw(doc, { blockReuse: false }).list;
    expect(list.entities).toEqual(["40", "41", "42"]);
    expect(list.batches.map((b) => [...b.pick])).toEqual(off.batches.map((b) => [...b.pick]));
    const xy = coordinates(list),
      old = coordinates(off);
    expect(xy).toHaveLength(old.length);
    for (let i = 0; i < xy.length; i++) expect(Math.abs(xy[i]! - old[i]!)).toBeLessThan(1e-5);
    expect(list.bounds.minX).toBeCloseTo(off.bounds.minX, 10);
    expect(list.bounds.maxY).toBeCloseTo(off.bounds.maxY, 10);
  });

  it("keys exact scale, parity, ByBlock colour, true colour, lineweight, alpha and linetype", () => {
    const contexts = [
      "",
      "41 2\n42 2",
      "41 -1\n42 1",
      "62 2",
      "420 1193046",
      "370 100",
      "440 33554560",
      "6 DASH",
    ];
    const entities = contexts
      .flatMap((fields, i) => [
        insert((64 + i * 3).toString(16), "B", fields),
        insert((65 + i * 3).toString(16), "B", `${fields}\n10 30`),
        insert((66 + i * 3).toString(16), "B", `${fields}\n10 60`),
      ])
      .join("\n");
    const content = `${line("30", 0, 0, 10, 2, 0)}\n370 -2\n440 16777216\n6 ByBlock\n${line("31", 0, 3, 10, 5, 0)}\n370 -2\n440 16777216\n6 ByBlock`;
    const tables =
      "0 TABLE\n2 LTYPE\n0 LTYPE\n100 AcDbSymbolTableRecord\n100 AcDbLinetypeTableRecord\n2 DASH\n70 0\n3 dash\n72 65\n73 2\n40 3\n49 2\n74 0\n49 -1\n74 0\n0 ENDTAB";
    const doc = document(entities, content, "", tables);
    const fe = frontend(doc);
    const spy = vi.spyOn(fe, "drawEntities");
    fe.drawBlock(doc.modelSpace);
    expect(spy.mock.calls.filter(([es]) => es === doc.getBlock("B")!.entities)).toHaveLength(
      contexts.length * 2,
    );
    const list = fe.build(),
      off = draw(doc, { blockReuse: false }).list;
    expect(list.batches.map((b) => [...b.colors])).toEqual(off.batches.map((b) => [...b.colors]));
    expect(list.batches.map((b) => b.positions.length)).toEqual(off.batches.map((b) => b.positions.length));
  });

  it("records nested INSERTs with the outer stream and repeats unsupported counts", () => {
    const doc = document(
      `${insert("40")}\n${insert("41", "B", "10 30")}\n${insert("42", "B", "10 60")}`,
      `${insert("31", "C", "10 5")}\n0 NOT_SUPPORTED\n5 32\n100 AcDbEntity\n8 0`,
      block("C", line("33", 0, 0, 4, 1, 0)),
    );
    const fe = frontend(doc);
    const spy = vi.spyOn(fe, "drawEntities");
    fe.drawBlock(doc.modelSpace);
    expect(spy.mock.calls.filter(([es]) => es === doc.getBlock("C")!.entities)).toHaveLength(2);
    expect(fe.unsupported["entity:NOT_SUPPORTED"]).toBe(3);
    expect(fe.build()).toEqual(draw(doc, { blockReuse: false }).list);
  });

  it("keeps ATTRIBs and MINSERT cells attributed to their own top-level reference", () => {
    const attrib =
      "0 ATTRIB\n5 50\n100 AcDbEntity\n8 0\n100 AcDbText\n10 5\n20 5\n40 1\n1 A\n100 AcDbAttribute\n2 TAG\n70 0\n0 SEQEND\n5 51";
    const doc = document(
      `${insert("40", "B", "70 2\n71 2\n44 15\n45 15\n66 1")}\n${attrib}\n${insert("41", "B", "10 50")}`,
    );
    const on = draw(doc),
      off = draw(doc, { blockReuse: false });
    expect(on).toEqual(off);
    expect(on.list.entities).toEqual(["40", "41"]);
  });

  it("respects effective layer toggles, reference no-plot propagation and render-local caches", () => {
    const tables =
      "0 TABLE\n2 LAYER\n0 LAYER\n100 AcDbSymbolTableRecord\n100 AcDbLayerTableRecord\n2 HIDDEN\n70 0\n62 7\n6 Continuous\n290 0\n0 ENDTAB";
    const doc = document(
      `${insert("40")}\n${insert("41", "B", "8 HIDDEN")}`,
      `${line("30", 0, 0, 10, 2, 0)}\n${line("31", 0, 5, 10, 5, 2)}\n8 FIXED`,
      "",
      tables,
    );
    for (const visibility of ["plot", "display"] as const)
      for (const hidden of ["0", "HIDDEN", "FIXED"]) {
        const env: RenderEnv = { visibility, layerVisibility: new Map([[hidden, false]]) };
        expect(draw(doc, env)).toEqual(draw(doc, { ...env, blockReuse: false }));
      }
  });

  it("falls back with LOD off, plot raster, clip regions, entity filters and viewport layers", () => {
    const doc = document(`${insert("40")}\n${insert("41", "B", "10 30")}`);
    for (const env of [{ lod: false }, { raster: "autocad" as const }, { blockReuse: false }])
      expect(draw(doc, env)).toEqual(draw(doc, { ...env, blockReuse: false }));
    for (const mode of ["clip", "filter", "viewport"]) {
      const fe = frontend(doc);
      if (mode === "clip") fe.pushClip([Float64Array.of(-1, -1, 20, -1, 20, 20, -1, 20)]);
      if (mode === "filter") fe.entityFilters.push((e) => e.handle !== "30");
      if (mode === "viewport") fe.props.viewport = { handle: "70", frozen: new Set() };
      const spy = vi.spyOn(fe, "drawEntities");
      fe.drawBlock(doc.modelSpace);
      expect(spy.mock.calls.filter(([es]) => es === doc.getBlock("B")!.entities)).toHaveLength(2);
    }
  });

  it("keeps cycle/depth guard and inherited linetypeScale contexts separate", () => {
    const doc = document(insert("40"));
    const fe = frontend(doc),
      parent = doc.modelSpace.entities[0]!,
      b = doc.getBlock("B")!;
    const spy = vi.spyOn(fe, "drawEntities");
    for (const linetypeScale of [1, 2, 1, 2, 1, 2])
      fe.drawBlockContent(b, Matrix44.identity(), parent, {
        m: Matrix44.identity(),
        inh: TOP_LEVEL,
        stack: ["*MODEL_SPACE"],
        linetypeScale,
      });
    expect(spy).toHaveBeenCalledTimes(4);
    expect(
      fe.drawBlockContent(b, Matrix44.identity(), parent, {
        m: Matrix44.identity(),
        inh: TOP_LEVEL,
        stack: ["B"],
      }),
    ).toBe(false);
    expect(
      fe.drawBlockContent(b, Matrix44.identity(), parent, {
        m: Matrix44.identity(),
        inh: TOP_LEVEL,
        stack: Array(65).fill("C"),
      }),
    ).toBe(false);
    expect(fe.unsupported["recursive-block"]).toBe(2);
  });

  it("rejects shear, nonuniform scale, perspective, tilt and nonfinite matrices", () => {
    for (const m of [
      Matrix44.scaling(1, 2),
      Matrix44.rotationAxis({ x: 1, y: 0, z: 0 }, 0.2),
      Matrix44.fromRows(1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
      Matrix44.fromRows(1, 0, 0.1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
      Matrix44.fromRows(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0, 0, 1),
      Matrix44.scaling(Number.NaN, 1),
    ])
      expect(splitBlockTransform(m)).toBeUndefined();
    for (const sx of [2, -2]) {
      const m = Matrix44.product(
        Matrix44.translation(20, 30),
        Matrix44.rotationZ(0.37),
        Matrix44.scaling(sx, 2, 3),
      );
      const split = splitBlockTransform(m)!;
      expect(split.scale).toBeCloseTo(2, 14);
      const restored = split.r.toMatrix44().multiply(split.s).planeToAffine2(5);
      expect(restored.equals(m.planeToAffine2(5), 1e-14)).toBe(true);
    }
  });

  it("records copied Float64 primitives, UVs, clip changes and batch/unbounded commands in order", () => {
    const recorder = new BlockRecorder(0.1, 100, 100),
      color = [1, 2, 3, 255] as const;
    const xy = Float64Array.of(0.123456789123, 0, 2, 0, 2, 2);
    const image = { width: 1, height: 1, pixels: Uint8Array.of(255, 255, 255, 255) };
    const region = { rings: [Float64Array.of(-2, -2, 3, -2, 3, 3)] };
    const id = recorder.addClip(region);
    recorder.setClip(id);
    recorder.triangles(xy, color);
    recorder.breakBatch();
    recorder.polyline(xy, color, true);
    recorder.points(xy.subarray(0, 2), color);
    recorder.imageTriangles(xy, [0, 0, 1, 0, 1, 1], image, color);
    recorder.setUnbounded(true);
    recorder.setClip(-1);
    recorder.points([100, 100], color);
    recorder.setUnbounded(false);
    const out = new DisplayListBuilder(0.1),
      expected = new DisplayListBuilder(0.1),
      rigid = new Affine2(0, 1, -1, 0, 10, 20);
    out.beginEntity("CURRENT");
    expected.beginEntity("CURRENT");
    expected.setClip(expected.addClip({ rings: region.rings.map((r) => rigid.applyPoints(r)) }));
    expected.triangles(rigid.applyPoints(xy), color);
    expected.breakBatch();
    expected.polyline(rigid.applyPoints(xy), color, true);
    expected.points(rigid.applyPoints(xy.subarray(0, 2)), color);
    expected.imageTriangles(rigid.applyPoints(xy), [0, 0, 1, 0, 1, 1], image, color);
    expected.setUnbounded(true);
    expected.setClip(-1);
    expected.points(rigid.applyPoints(Float64Array.of(100, 100)), color);
    expected.setUnbounded(false);
    xy.fill(999);
    region.rings[0]!.fill(999);
    replayBlockStream({ commands: recorder.commands, vertices: recorder.vertices, notes: {} }, out, rigid);
    expect(out.build()).toEqual(expected.build());
  });

  it("bounds coordinates and commands even for empty streams", () => {
    const r = new BlockRecorder(1, 2, 2);
    r.points([0, 0, 1, 1], [0, 0, 0, 255]);
    r.points([2, 2], [0, 0, 0, 255]);
    expect(r.overflow).toBe(true);
    expect(r.commands).toHaveLength(0);
    const empty = new BlockRecorder(1, 10, 2);
    empty.breakBatch();
    empty.breakBatch();
    empty.breakBatch();
    expect(empty.overflow).toBe(true);
    expect(empty.commands).toHaveLength(0);
  });
});
