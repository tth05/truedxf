import { describe, expect, it } from "vitest";
import {
  assemble,
  bigfontSlots,
  compileShp,
  decompileShx,
  disassemble,
  flattenStrokes,
  interpretBytes,
  parseShx,
  type ShapeOp,
  type ShxFile,
  ShxFont,
  type Stroke,
  strokesBounds,
  writeShx,
} from "../src/index.ts";

const r6 = (v: number) => +v.toFixed(6) + 0;
const pts = (s: Stroke) => s.vertices.map((v) => [r6(v.x), r6(v.y)]);
const rb = (b: { xMin: number; yMin: number; xMax: number; yMax: number } | undefined) =>
  b && { xMin: r6(b.xMin), yMin: r6(b.yMin), xMax: r6(b.xMax), yMax: r6(b.yMax) };
const run = (bytes: number[], kind: "shapes" | "unifont" | "bigfont" = "shapes", opts = {}, modes = 0) =>
  interpretBytes(Uint8Array.from(bytes), kind, opts, modes);

describe("shape bytecode interpreter", () => {
  it("draws vectors in all 16 directions with stretched diagonals", () => {
    const r = run([
      0x10, 0x21, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0,
    ]);
    expect(r.strokes).toHaveLength(1);
    const p = pts(r.strokes[0]!);
    expect(p.slice(0, 4)).toEqual([
      [0, 0],
      [1, 0],
      [3, 1],
      [4, 2],
    ]);
    expect(p[4]).toEqual([4.5, 3]);
    expect(r.endX).toBeCloseTo(4.5 - 0.5 - 1 - 1 - 1 - 1 - 1 - 0.5 + 0 + 0.5 + 1 + 1, 9);
  });

  it("starts with the pen down; pen up splits strokes and the advance is the final pen x", () => {
    const r = run([0x14, 2, 0x30, 1, 0x1c, 2, 0x20, 0]);
    expect(r.strokes.map(pts)).toEqual([
      [
        [0, 0],
        [0, 1],
      ],
      [
        [3, 1],
        [3, 0],
      ],
    ]);
    expect(r.endX).toBe(5);
    expect(r.endY).toBe(0);
  });

  it("scales with codes 3/4 cumulatively", () => {
    const r = run([4, 2, 0x10, 3, 4, 0x10, 0]);
    expect(pts(r.strokes[0]!)).toEqual([
      [0, 0],
      [2, 0],
      [2.5, 0],
    ]);
  });

  it("push/pop restores the position without drawing", () => {
    const r = run([5, 0x24, 6, 0x20, 0]);
    expect(r.strokes.map(pts)).toEqual([
      [
        [0, 0],
        [0, 2],
      ],
      [
        [0, 0],
        [2, 0],
      ],
    ]);
    expect(run([6, 0]).warnings[0]).toMatch(/underflow/);
  });

  it("decodes signed displacements (8) and lists (9)", () => {
    const r = run([8, 0xfe, 0x05, 9, 3, 0, 0, 0xfd, 0, 0, 0]);
    expect(pts(r.strokes[0]!)).toEqual([
      [0, 0],
      [-2, 5],
      [1, 5],
      [1, 2],
    ]);
  });

  it("octant arcs: full circle, centre = P − r·(cos 45S, sin 45S)", () => {
    // 10,(1,-040): radius 1, clockwise, start octant 4 (180°), 0 = full circle.
    const r = run([10, 1, 0xc0, 0]);
    const s = r.strokes[0]!;
    expect(s.vertices).toHaveLength(3); // two semicircles
    expect(s.vertices[0]!.bulge).toBeCloseTo(-1, 12);
    expect(rb(strokesBounds(r.strokes))).toEqual({ xMin: 0, yMin: -1, xMax: 2, yMax: 1 });
    expect(r.endX).toBe(0);
  });

  it("octant arc quarter: 10,(3,012) runs 45°→135°", () => {
    const r = run([10, 3, 0x12, 0], "shapes", { penRounding: "none" });
    const [a, b] = r.strokes[0]!.vertices;
    const c = [-3 * Math.cos(Math.PI / 4), -3 * Math.sin(Math.PI / 4)];
    expect(b!.x).toBeCloseTo(c[0]! + 3 * Math.cos((3 * Math.PI) / 4), 12);
    expect(b!.y).toBeCloseTo(c[1]! + 3 * Math.sin((3 * Math.PI) / 4), 12);
    expect(a!.bulge).toBeCloseTo(Math.tan(Math.PI / 8), 12);
  });

  it("rounds the pen to the integer grid after arcs by default (note 04 rounding hypothesis)", () => {
    const exact = run([10, 10, 0x01, 0], "shapes", { penRounding: "none" });
    expect(exact.endX).toBeCloseTo(10 * Math.cos(Math.PI / 4) - 10, 12);
    const rounded = run([10, 10, 0x01, 0]);
    expect([rounded.endX, rounded.endY]).toEqual([-3, 7]);
    // The drawn arc ends at the rounded point and keeps its sweep.
    const v = rounded.strokes[0]!.vertices;
    expect([v[1]!.x, v[1]!.y]).toEqual([-3, 7]);
    expect(v[0]!.bulge).toBeCloseTo(Math.tan(Math.PI / 16), 12);
  });

  it("fractional arc: ADSK example 11,(56,28,0,3,012) = 55°→95°, r = 3", () => {
    const r = run([11, 56, 28, 0, 3, 0x12, 0], "shapes", { penRounding: "none" });
    const a0 = ((45 + (56 * 45) / 256) * Math.PI) / 180;
    const a1 = ((90 + (28 * 45) / 256) * Math.PI) / 180;
    expect(r.endX).toBeCloseTo(3 * (Math.cos(a1) - Math.cos(a0)), 12);
    expect(r.endY).toBeCloseTo(3 * (Math.sin(a1) - Math.sin(a0)), 12);
    expect(r.strokes[0]!.vertices[0]!.bulge).toBeCloseTo(Math.tan((a1 - a0) / 4), 12);
  });

  it("fractional arc radius uses the high byte ×256", () => {
    const r = run([11, 0, 0, 1, 0, 0x04, 0], "shapes", { penRounding: "none" }); // r = 256, 0°→180°
    expect(r.endX).toBeCloseTo(-512, 9);
  });

  it("bulge arcs (12) and polyarcs (13); -128 clamps to -127", () => {
    const r = run([12, 0, 10, 127, 13, 10, 0, 127, 0, 0xf6, 0x80, 0, 0, 0]);
    const v = r.strokes[0]!.vertices;
    expect(v.map((x) => [x.x, x.y])).toEqual([
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
    ]);
    expect(v.map((x) => x.bulge)).toEqual([1, 1, -1, 0]);
  });

  it("code 14 skips the whole next command in horizontal text", () => {
    const bytes = [2, 14, 8, 0xfe, 0xfa, 14, 9, 1, 1, 2, 2, 0, 0, 1, 0x10, 0];
    const h = run(bytes, "shapes", { vertical: true }, 0); // modes 0: never vertical
    expect(pts(h.strokes[0]!)).toEqual([
      [0, 0],
      [1, 0],
    ]);
    const v = run(bytes, "shapes", { vertical: true }, 2);
    expect(pts(v.strokes[0]!)).toEqual([
      [1, -3],
      [2, -3],
    ]);
  });

  it("disassembles and reassembles every op", () => {
    const ops: ShapeOp[] = [
      { op: "penUp" },
      { op: "vector", length: 15, dir: 10 },
      { op: "divide", n: 2 },
      { op: "multiply", n: 3 },
      { op: "push" },
      { op: "pop" },
      { op: "subshape", shape: 0x41 },
      { op: "xy", dx: -128, dy: 127 },
      { op: "xyList", points: [[1, -1]] },
      { op: "octantArc", radius: 5, start: 3, count: 0, cw: true },
      { op: "fracArc", startOffset: 1, endOffset: 2, radius: 300, start: 7, count: 7, cw: false },
      { op: "bulgeArc", dx: 3, dy: 4, bulge: -127 },
      { op: "bulgeList", arcs: [[1, 2, 3]] },
      { op: "verticalOnly" },
      { op: "nop" },
      { op: "penDown" },
      { op: "end" },
    ];
    for (const kind of ["shapes", "unifont"] as const) {
      const bytes = assemble(ops, kind);
      expect(disassemble(bytes, kind).ops).toEqual(ops);
    }
    const ext: ShapeOp[] = [
      { op: "subshapeExt", shape: 0x8140, x: 1, y: 2, width: 3, height: 4 },
      { op: "end" },
    ];
    expect(disassemble(assemble(ext, "bigfont"), "bigfont").ops).toEqual(ext);
    expect(disassemble(Uint8Array.from([8, 1]), "shapes").truncated).toBe(true);
  });
});

function unifont(shapes: Array<[number, string, ShapeOp[]]>, above = 10, below = 3, modes = 0): ShxFile {
  return {
    kind: "unifont",
    signature: "AutoCAD-86 unifont 1.0",
    shapes: shapes.map(([number, name, ops]) => ({ number, name, bytes: assemble(ops, "unifont") })),
    info: {
      name: "test",
      above,
      below,
      modes,
      encoding: 0,
      embed: 0,
      tail: Uint8Array.from([above, below, modes, 0, 0, 0]),
    },
    ranges: [],
    warnings: [],
  };
}

describe("SHX files", () => {
  it("round-trips a unifont through write/parse; 2-byte subshapes are high byte first", () => {
    const file = unifont([
      [0x41, "a", [{ op: "vector", length: 4, dir: 2 }, { op: "end" }]],
      [
        0x2205,
        "",
        [
          { op: "subshape", shape: 0x41 },
          { op: "penUp" },
          { op: "vector", length: 2, dir: 0 },
          { op: "end" },
        ],
      ],
    ]);
    const bytes = writeShx(file);
    expect(String.fromCharCode(...bytes.subarray(0, 22))).toBe("AutoCAD-86 unifont 1.0");
    const back = parseShx(bytes);
    expect(back.info?.above).toBe(10);
    expect(back.shapes.map((s) => [s.number, s.name])).toEqual([
      [0x41, "a"],
      [0x2205, ""],
    ]);
    expect(Array.from(back.shapes[1]!.bytes.subarray(0, 3))).toEqual([7, 0x00, 0x41]);
    const font = new ShxFont(back);
    const g = font.glyph(0x2205)!;
    expect(g.advance).toBe(6);
    expect(rb(g.bounds)).toEqual({ xMin: 0, yMin: 0, xMax: 4, yMax: 4 });
    expect(font.scaleForHeight(2.5)).toBe(0.25);
    expect(font.glyph(0x42)).toBeUndefined();
    expect(font.hasGlyph(0)).toBe(false);
  });

  it("writes shape files with first/last numbers and an EOF trailer; lookup by name", () => {
    const file: ShxFile = {
      kind: "shapes",
      signature: "AutoCAD-86 shapes 1.0",
      shapes: [
        { number: 140, name: "BOXY", bytes: assemble([{ op: "vector", length: 1, dir: 0 }], "shapes") },
        {
          number: 141,
          name: "ARC",
          bytes: assemble([{ op: "bulgeArc", dx: 2, dy: 0, bulge: 127 }], "shapes"),
        },
      ],
      info: undefined,
      ranges: [],
      warnings: [],
    };
    const bytes = writeShx(file);
    expect(String.fromCharCode(...bytes.subarray(bytes.length - 3))).toBe("EOF");
    const back = parseShx(bytes);
    expect(back.header).toMatchObject({ first: 140, last: 141 });
    const font = new ShxFont(back);
    expect(font.isShapeFile).toBe(true);
    expect(rb(font.glyphByName("arc")!.bounds)).toEqual({ xMin: 0, yMin: -1, xMax: 2, yMax: 0 });
  });

  it("bigfont: hash-table index, escape ranges, DBCS lookup, extended subshapes", () => {
    const prim: ShapeOp[] = [{ op: "vector", length: 10, dir: 0 }, { op: "end" }];
    const file: ShxFile = {
      kind: "bigfont",
      signature: "AutoCAD-86 bigfont 1.0",
      shapes: [
        { number: 0, name: "big", bytes: Uint8Array.from([10, 0, 2, 10, 0]) }, // extended: cell 10 × 10
        { number: 0x8001, name: "", bytes: assemble(prim, "bigfont") },
        {
          number: 0x8140,
          name: "",
          bytes: assemble(
            [
              { op: "subshapeExt", shape: 0x8001, x: 2, y: 3, width: 5, height: 10 },
              { op: "penUp" },
              { op: "xy", dx: 12, dy: 0 },
            ],
            "bigfont",
          ),
        },
      ],
      info: undefined,
      ranges: [[0x80, 0x9f]],
      warnings: [],
    };
    const bytes = writeShx(file);
    const back = parseShx(bytes);
    expect(back.ranges).toEqual([[0x80, 0x9f]]);
    expect(back.info?.extended).toEqual({ height: 10, width: 10 });
    const font = new ShxFont(back);
    expect(font.splitCodes([0x41, 0x81, 0x40, 0x42])).toEqual([0x41, 0x8140, 0x42]);
    const g = font.glyph(0x8140)!;
    expect(g.strokes.map(pts)).toEqual([
      [
        [2, 3],
        [7, 3],
      ],
    ]);
    expect(g.advance).toBe(12);
    // slot = byteswap(code) mod size, forward linear probing
    const slots = bigfontSlots([0, 0x0100, 0x0800], 7);
    expect(slots.indexOf(1)).toBe(1);
    expect(slots.indexOf(2)).toBe(2);
  });
});

describe(".shp compiler", () => {
  const src = [
    "; a comment",
    "*UNIFONT,6,Test font; with semicolon",
    "12,4,2,0,0,0",
    "*00041,10,a",
    "2,8,(-2,-3),1,0AC,10,(3,-043),0",
    "*00042,6,",
    "7,(0,041),2,014,0",
    "*02205,4,",
    "7,00041,0",
  ].join("\n");

  it("compiles with role-aware signs: two's complement displacements, sign-magnitude octants", () => {
    const { file, warnings } = compileShp(src);
    expect(file.kind).toBe("unifont");
    expect(file.info).toMatchObject({ name: "Test font; with semicolon", above: 12, below: 4, modes: 2 });
    expect(Array.from(file.shapes[0]!.bytes)).toEqual([2, 8, 0xfe, 0xfd, 1, 0xac, 10, 3, 0xc3, 0]);
    expect(Array.from(file.shapes[1]!.bytes)).toEqual([7, 0, 0x41, 2, 0x14, 0]);
    expect(Array.from(file.shapes[2]!.bytes)).toEqual([7, 0, 0x41, 0]);
    expect(warnings).toEqual([]);
  });

  it("decompiles to source that compiles back to identical bytes", () => {
    const { file } = compileShp(src);
    const bin = writeShx(file);
    const again = compileShp(decompileShx(parseShx(bin)));
    expect(writeShx(again.file)).toEqual(bin);
    expect(again.warnings).toEqual([]);
  });

  it("reports defbytes mismatches", () => {
    const { warnings } = compileShp("*1,5,X\n014,0");
    expect(warnings[0]).toMatch(/defbytes 5 but 2/);
  });
});

describe("flattening", () => {
  it("splits arcs into equal-angle chords (default 8 per octant)", () => {
    const r = run([10, 1, 0x04, 0]); // semicircle, 4 octants
    const [pl] = flattenStrokes(r.strokes);
    expect(pl!.length / 2).toBe(33);
    const [coarse] = flattenStrokes(r.strokes, { maxAngle: 90, scale: 2 });
    expect(coarse!.map(r6)).toEqual([0, 0, -2, 2, -4, 0]);
  });
});
