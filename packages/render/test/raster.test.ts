/**
 * AutoCAD raster plot rules (research/notes/08 §10.3–10.5, §10.13, §10.14). The expected pixels
 * are taken from the AutoCAD 2027 calibration references named in each test.
 */
import { describe, expect, it } from "vitest";
import {
  arcSegmentCount,
  arcVertices,
  fillConvexByEdges,
  fillPolygon,
  gsSegmentCount,
  linePixels,
  SpanSet,
  strokeDotPixels,
  strokeSegmentPolygon,
  trapezoids,
} from "../src/raster.ts";

const pairs = (a: number[]) => {
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < a.length; k += 2) out.push([a[k]!, a[k + 1]!]);
  return out;
};

function spans(s: SpanSet): string[] {
  const out: string[] = [];
  s.forEach((j, a, b) => {
    out.push(`${j}:${a}..${b}`);
  });
  return out;
}

describe("thin lines (§10.3)", () => {
  it("resolves exact halves by the truncated 16.16 slope: toward the start for non-dyadic y-major", () => {
    // probe-line-ties: dx/dy = 1/6 → the tie at row 3 stays at the start column
    const out: number[] = [];
    linePixels(0, 0, 4, 24, out);
    expect(pairs(out)[3]).toEqual([0, 3]);
    const back: number[] = [];
    linePixels(0, 0, -4, 24, back);
    expect(pairs(back)[3]).toEqual([0, 3]);
  });

  it("rounds exact dyadic halves up / right", () => {
    // probe-line-ties: slope 1/2 → every odd row of a y-major line goes right, x-major up
    const y: number[] = [];
    linePixels(0, 0, 12, 24, y);
    expect(pairs(y)[1]).toEqual([1, 1]);
    const x: number[] = [];
    linePixels(0, 0, 24, -12, x);
    expect(pairs(x)[1]).toEqual([1, 0]);
  });

  it("x-major non-dyadic ties go toward the end point", () => {
    // probe-line-ties d=(24,20): 5/6 slope, ties toward the end in both vertical directions
    const up: number[] = [];
    linePixels(0, 0, 24, 20, up);
    const down: number[] = [];
    linePixels(0, 0, 24, -20, down);
    // column 3: exact y = 2.5
    expect(pairs(up)[3]).toEqual([3, 3]);
    expect(pairs(down)[3]).toEqual([3, -3]);
  });

  it("clips the walk to the canvas", () => {
    const out: number[] = [];
    linePixels(-1000, 5, 1000, 5, out, { width: 10, height: 10 });
    expect(out.length / 2).toBe(12);
  });
});

describe("circles and arcs (§10.13)", () => {
  it("segment counts", () => {
    // probe-circles / probe-circles-large / probe-arcs
    expect(arcSegmentCount(1, 2 * Math.PI)).toBe(6);
    expect(arcSegmentCount(6, 2 * Math.PI)).toBe(12);
    expect(arcSegmentCount(49, 2 * Math.PI)).toBe(30);
    expect(arcSegmentCount(456, 2 * Math.PI)).toBe(86);
    expect(arcSegmentCount(599, 2 * Math.PI)).toBe(100);
    expect(arcSegmentCount(27, (97.25 * Math.PI) / 180)).toBe(8);
  });

  it("snaps the centre, uses the integer radius ceil(r) - 1 and floors in absolute coordinates", () => {
    // probe-circles #117 (r = 49.05 px at x ≈ 56): the 240° vertex is (-25, -42) relative to the pixel
    const v = pairs(arcVertices(56.84, 202.04, 49.0547, 0, 2 * Math.PI));
    expect(v.length).toBe(31);
    expect(v[20]).toEqual([56 - 25, 202 - 42]);
    // the same radius near x ≈ 685 rounds that vertex to -24 (raster-curves r = 50)
    const w = pairs(arcVertices(685.89, 1152.73, 50, 0, 2 * Math.PI));
    expect(w[20]).toEqual([685 - 24, 1152 - 42]);
  });

  it("graphics-system curves: at least 32 segments per full turn", () => {
    expect(gsSegmentCount(10, 2 * Math.PI)).toBe(32);
    expect(gsSegmentCount(118.9, 2 * Math.PI)).toBe(35);
    expect(gsSegmentCount(500, (286.26 * Math.PI) / 180)).toBe(57);
  });
});

describe("wide strokes (§10.4, §10.14)", () => {
  const stroke = (i0: number, j0: number, i1: number, j1: number, w: number) => {
    const s = new SpanSet();
    fillConvexByEdges(strokeSegmentPolygon(i0, j0, i1, j1, w)!, s);
    return spans(s);
  };

  it("horizontal band and round caps of an 8 px stroke", () => {
    // thick-probe h lines, lw 2.11 mm: rows p-3..p+4, caps 0 2 2 3 2 2 1 0 / 0 2 3 4 3 2 1 0
    expect(stroke(0, 0, 20, 0, 8)).toEqual([
      "-3:0..20",
      "-2:-2..22",
      "-1:-2..23",
      "0:-3..24",
      "1:-2..23",
      "2:-2..22",
      "3:-1..21",
      "4:0..20",
    ]);
  });

  it("2 px strokes add one pixel on the positive minor side", () => {
    // probe-thick lw 0.40/0.50 mm: the thin line and its copy one row up
    const thin: number[] = [];
    linePixels(0, 0, 54, 3, thin);
    const s = new SpanSet();
    fillConvexByEdges(strokeSegmentPolygon(0, 0, 54, 3, 2)!, s);
    const got = new Set<string>();
    s.forEach((j, a, b) => {
      for (let i = a; i <= b; i++) got.add(`${i},${j}`);
    });
    for (const [i, j] of pairs(thin)) {
      expect(got.has(`${i},${j}`)).toBe(true);
      expect(got.has(`${i},${j + 1}`)).toBe(true);
    }
    expect(got.size).toBe(2 * 55);
  });

  it("zero-length strokes", () => {
    const s = new SpanSet();
    strokeDotPixels(0, 0, 8, s);
    expect(spans(s)).toEqual(["-2:-2..1", "-1:-2..2", "0:-3..2", "1:-2..2", "2:-2..1"]);
    expect(strokeSegmentPolygon(3, 3, 3, 3, 8)).toBeUndefined();
  });
});

describe("fills (§10.5)", () => {
  it("axis-aligned rectangle fills [x0, x1) x [y0, y1)", () => {
    const s = new SpanSet();
    fillPolygon([[2, 3, 7, 3, 7, 5, 2, 5]], true, s);
    expect(spans(s)).toEqual(["3:2..6", "4:2..6"]);
  });

  it("exact dyadic ties: left edges exclusive, right edges inclusive", () => {
    // probe-fills solid4 #11: slope 1/2 left edge
    const s = new SpanSet();
    fillPolygon([[0, 0, 10, 0, 10, 4, 2, 4]], true, s);
    // row 1: left edge x = 0.5 → pixel 0 (centre 0.5) excluded
    expect(spans(s)[1]).toBe("1:1..9");
    const t = new SpanSet();
    fillPolygon([[0, 0, 10, 0, 8, 4, 0, 4]], true, t);
    // row 1: right edge x = 9.5 → pixel 9 (centre 9.5) included
    expect(spans(t)[1]).toBe("1:0..9");
  });

  it("hatch trapezoids split at every vertex y", () => {
    const q = trapezoids([Float64Array.of(0, 0, 10, 3.5, 2, 8)], true);
    expect(q.length).toBe(2);
    expect(q[0]![5]).toBe(3.5);
  });

  it("hatch trapezoids also split where edges cross (hatches/selfint-bowtie)", () => {
    // bow tie (0,0) (10,10) (10,0) (0,10): the diagonals cross at y = 5
    const q = trapezoids([Float64Array.of(0, 0, 10, 10, 10, 0, 0, 10)], true);
    const area = q.reduce((s, t) => s + ((t[2]! - t[0]! + t[4]! - t[6]!) / 2) * (t[5]! - t[1]!), 0);
    expect(area).toBeCloseTo(50, 9);
    expect(q.every((t) => t[2]! >= t[0]! && t[4]! >= t[6]!)).toBe(true);
    expect(q.map((t) => t[1])).toContain(5);
  });
});
