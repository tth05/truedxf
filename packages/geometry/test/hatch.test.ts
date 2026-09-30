import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  Affine2,
  FillRule,
  type HatchLoop,
  HatchPathFlags,
  type HatchPatternLine,
  HatchStyle,
  hatchPatternLineCount,
  hatchPatternLines,
  hatchPatternLinesInRings,
  hatchSolidTriangles,
  loopNestingDepths,
  pointInRings,
  selectHatchLoops,
  transformHatchPatternLine,
  trianglesArea,
} from "../src/index.ts";
import { distanceToPolyline, expectClose } from "./helpers.ts";

const sq = (x0: number, y0: number, s: number) =>
  Float64Array.of(x0, y0, x0 + s, y0, x0 + s, y0 + s, x0, y0 + s);

const nested: HatchLoop[] = [
  { points: sq(0, 0, 10), flags: HatchPathFlags.EXTERNAL | HatchPathFlags.POLYLINE },
  { points: sq(2, 2, 6), flags: HatchPathFlags.OUTERMOST },
  { points: sq(4, 4, 2), flags: 0 },
];

// ANSI31 as AutoCAD stores it at scale 1 (note 06 §1.6.1): 45°, offset (0, .125) rotated by 45°.
const ansi31 = (scale = 1): HatchPatternLine => ({
  angle: 45,
  base: { x: 0, y: 0 },
  offset: { x: -0.125 * Math.SQRT1_2 * scale, y: 0.125 * Math.SQRT1_2 * scale },
  dashes: [],
});

function segs(r: { segments: Float64Array }): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < r.segments.length; i += 4) out.push(Array.from(r.segments.subarray(i, i + 4)));
  return out;
}

describe("hatch loop selection and solid fill (note 06 §1.5)", () => {
  it("normal / outer / ignore by path flags", () => {
    expectClose(trianglesArea(hatchSolidTriangles(nested, HatchStyle.Normal)), 100 - 36 + 4, 1e-9);
    expectClose(trianglesArea(hatchSolidTriangles(nested, HatchStyle.Outer)), 100 - 36, 1e-9);
    expectClose(trianglesArea(hatchSolidTriangles(nested, HatchStyle.Ignore)), 100, 1e-9);
  });

  it("styles 1/2 select nothing without external flags (VERIFIED-BY-ACAD hatches/nested-*-zero-*)", () => {
    const unflagged = nested.map((l) => ({ ...l, flags: 0 }));
    expect(loopNestingDepths(unflagged.map((l) => l.points))).toEqual([0, 1, 2]);
    expect(selectHatchLoops(unflagged, HatchStyle.Outer)).toEqual([]);
    expect(selectHatchLoops(unflagged, HatchStyle.Ignore)).toEqual([]);
    expect(selectHatchLoops(unflagged, HatchStyle.Normal)).toEqual([0, 1, 2]);
    // optional geometric nesting fallback (dxf-viewer behaviour)
    expect(selectHatchLoops(unflagged, HatchStyle.Outer, { geometricFallback: true })).toEqual([0, 1]);
    expect(selectHatchLoops(unflagged, HatchStyle.Ignore, { geometricFallback: true })).toEqual([0]);
  });

  it("drops text-box loops by default", () => {
    const withText = [...nested.slice(0, 1), { points: sq(3, 3, 1), flags: HatchPathFlags.TEXTBOX }];
    expectClose(trianglesArea(hatchSolidTriangles(withText, HatchStyle.Normal)), 100, 1e-9);
    expectClose(
      trianglesArea(hatchSolidTriangles(withText, HatchStyle.Normal, { textBoxes: "keep" })),
      99,
      1e-9,
    );
  });

  it("even-odd over overlapping separate loops leaves the overlap empty", () => {
    const loops = [
      { points: sq(0, 0, 4), flags: 1 },
      { points: sq(2, 2, 4), flags: 1 },
    ];
    expectClose(trianglesArea(hatchSolidTriangles(loops, HatchStyle.Normal)), 32 - 8, 1e-9);
  });
});

describe("hatch pattern lines", () => {
  it("ANSI31 on a unit-ish square: lines inside, ends on the boundary, total length ≈ area / spacing", () => {
    const loops: HatchLoop[] = [{ points: sq(0, 0, 3), flags: 1 }];
    const r = hatchPatternLines(loops, HatchStyle.Normal, [ansi31()]);
    expect(r.tooDense).toBe(false);
    let total = 0;
    for (const [x0, y0, x1, y1] of segs(r)) {
      expect(distanceToPolyline(x0!, y0!, loops[0]!.points, true)).toBeLessThan(1e-9);
      expect(distanceToPolyline(x1!, y1!, loops[0]!.points, true)).toBeLessThan(1e-9);
      expectClose(Math.atan2(y1! - y0!, x1! - x0!), Math.PI / 4, 1e-9);
      total += Math.hypot(x1! - x0!, y1! - y0!);
    }
    // Exact: spacing · Σ chord = area up to the triangular end pieces (≤ spacing · perimeter / 2).
    expect(Math.abs(total * 0.125 - 9)).toBeLessThan(0.125 * 6);
    expect(r.lineCount).toBe(hatchPatternLineCount([ansi31()], [loops[0]!.points]));
  });

  it("islands cut the pattern (style normal) and are ignored with style ignore", () => {
    const horiz: HatchPatternLine = { angle: 0, base: { x: 0, y: 0.5 }, offset: { x: 0, y: 1 }, dashes: [] };
    const normal = segs(hatchPatternLines(nested, HatchStyle.Normal, [horiz]));
    const ignore = segs(hatchPatternLines(nested, HatchStyle.Ignore, [horiz]));
    expect(ignore.length).toBe(10);
    const y45 = normal.filter((s) => s[1] === 4.5).map((s) => [s[0], s[2]]);
    expect(y45).toEqual([
      [0, 2],
      [4, 6],
      [8, 10],
    ]);
  });

  it("vertex hits are exact: through-vertices count once, touching vertices not at all", () => {
    const diamond: HatchLoop[] = [{ points: Float64Array.of(0, -1, 1, 0, 0, 1, -1, 0), flags: 1 }];
    const horiz: HatchPatternLine = { angle: 0, base: { x: 0, y: 0 }, offset: { x: 0, y: 0.5 }, dashes: [] };
    const s = segs(hatchPatternLines(diamond, 0, [horiz]));
    expect(s).toEqual([
      [-0.5, -0.5, 0.5, -0.5],
      [-1, 0, 1, 0],
      [-0.5, 0.5, 0.5, 0.5],
    ]);
  });

  it("an edge collinear with a hatch line is drawn iff the region lies on its +normal side", () => {
    const horiz: HatchPatternLine = { angle: 0, base: { x: 0, y: 0 }, offset: { x: 0, y: 1 }, dashes: [] };
    const s = segs(hatchPatternLines([{ points: sq(0, 0, 2), flags: 1 }], 0, [horiz]));
    expect(s).toEqual([
      [0, 0, 2, 0],
      [0, 1, 2, 1],
    ]);
  });

  it("dashes are anchored at each line's own origin B + k·v (brick-style shift)", () => {
    const brick: HatchPatternLine = {
      angle: 0,
      base: { x: 0, y: 0.5 },
      offset: { x: 0.5, y: 1 },
      dashes: [1, -1],
    };
    const r = hatchPatternLines([{ points: sq(0, 0, 10), flags: 1 }], 0, [brick]);
    for (const [x0, y0, x1] of segs(r)) {
      const k = Math.round(y0! - 0.5);
      const origin = 0.5 * k;
      const u = (((x0! - origin) % 2) + 2) % 2;
      // Each dash starts at a pattern start or at the boundary.
      expect(x0 === 0 || Math.abs(u) < 1e-9 || Math.abs(u - 2) < 1e-9).toBe(true);
      expect(x1! - x0!).toBeLessThanOrEqual(1 + 1e-12);
    }
    const dots: HatchPatternLine = {
      angle: 90,
      base: { x: 0.5, y: 0 },
      offset: { x: -1, y: 0 },
      dashes: [0, -1],
    };
    const d = hatchPatternLines([{ points: sq(0, 0, 3), flags: 1 }], 0, [dots]);
    expect(d.segments.length).toBe(0);
    expect(d.dots.length / 2).toBe(3 * 4); // x = 0.5, 1.5, 2.5; y = 0, 1, 2, 3 (inclusive)
  });

  it("nonzero rule keeps an overlap filled", () => {
    const loops = [
      { points: sq(0, 0, 4), flags: 1 },
      { points: sq(2, 2, 4), flags: 1 },
    ];
    const h: HatchPatternLine = { angle: 0, base: { x: 0, y: 3 }, offset: { x: 0, y: 10 }, dashes: [] };
    expect(segs(hatchPatternLines(loops, 0, [h]))).toEqual([
      [0, 3, 2, 3],
      [4, 3, 6, 3],
    ]);
    expect(segs(hatchPatternLines(loops, 0, [h], { fillRule: FillRule.NonZero }))).toEqual([[0, 3, 6, 3]]);
  });

  it("count limits instead of time limits", () => {
    const dense = hatchPatternLines([{ points: sq(0, 0, 100), flags: 1 }], 0, [ansi31(1e-4)]);
    expect(dense.tooDense).toBe(true);
    expect(dense.segments.length).toBe(0);
    const zero = hatchPatternLines([{ points: sq(0, 0, 1), flags: 1 }], 0, [
      { angle: 0, base: { x: 0, y: 0.5 }, offset: { x: 1, y: 0 }, dashes: [] },
    ]);
    expect(zero.tooDense).toBe(true);
    const manyDashes = hatchPatternLines(
      [{ points: sq(0, 0, 10), flags: 1 }],
      0,
      [{ ...ansi31(), dashes: [0.001, -0.001] }],
      {
        maxPrimitives: 1000,
      },
    );
    expect(manyDashes.tooDense).toBe(true);
  });

  it("transformHatchPatternLine scales offsets and dashes with the map", () => {
    const t = transformHatchPatternLine(
      { angle: 0, base: { x: 1, y: 1 }, offset: { x: 0, y: 0.5 }, dashes: [1, -0.5] },
      Affine2.scaling(2, 3),
    );
    expect(t.angle).toBe(0);
    expect(t.base).toEqual({ x: 2, y: 3 });
    expect(t.offset).toEqual({ x: 0, y: 1.5 });
    expect(t.dashes).toEqual([2, -1]);
  });

  it("property: every dash lies inside the region, ends on the boundary or inside; deterministic", () => {
    const poly = fc
      .array(fc.tuple(fc.integer({ min: -20, max: 20 }), fc.integer({ min: -20, max: 20 })), {
        minLength: 3,
        maxLength: 10,
      })
      .map((p) => Float64Array.from(p.flat()));
    fc.assert(
      fc.property(
        fc.array(poly, { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 0, max: 359 }),
        fc.double({ min: 0.3, max: 3, noNaN: true }),
        fc.boolean(),
        (rings, angle, spacing, dashed) => {
          const a = (angle * Math.PI) / 180;
          const line: HatchPatternLine = {
            angle,
            base: { x: 0.25, y: -0.5 },
            offset: {
              x: -Math.sin(a) * spacing + Math.cos(a) * 0.3,
              y: Math.cos(a) * spacing + Math.sin(a) * 0.3,
            },
            dashes: dashed ? [0.7, -0.4, 0, -0.4] : [],
          };
          const r = hatchPatternLinesInRings(rings, [line]);
          const again = hatchPatternLinesInRings(rings, [line]);
          expect(Array.from(again.segments)).toEqual(Array.from(r.segments));
          for (const [x0, y0, x1, y1] of segs(r)) {
            const mx = (x0! + x1!) / 2;
            const my = (y0! + y1!) / 2;
            const onBoundary = rings.some((q) => distanceToPolyline(mx, my, q, true) < 1e-7);
            if (!onBoundary) expect(pointInRings(rings, mx, my, FillRule.EvenOdd)).toBe(true);
          }
          for (let i = 0; i < r.dots.length; i += 2) {
            const x = r.dots[i]!;
            const y = r.dots[i + 1]!;
            const onBoundary = rings.some((q) => distanceToPolyline(x, y, q, true) < 1e-7);
            if (!onBoundary) expect(pointInRings(rings, x, y, FillRule.EvenOdd)).toBe(true);
          }
        },
      ),
      { numRuns: 300, seed: 3 },
    );
  });
});
