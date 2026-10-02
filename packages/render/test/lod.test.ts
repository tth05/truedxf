import type { Font, OutlineGlyph, StrokeGlyph } from "@truedxf/fonts";
import { Affine2, Matrix44 } from "@truedxf/geometry";
import type { TextLayout } from "@truedxf/text";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CALIBRATION, Frontend, type PlotRequest, PrimitiveKind, renderPlot } from "../src/index.ts";
import { TOP_LEVEL } from "../src/props.ts";
import { drawLayout } from "../src/text.ts";
import { line, modelDoc } from "./helpers.ts";

const request: PlotRequest = {
  layout: "Model",
  area: { type: "extents" },
  canvas: [100, 100],
  lineweights: false,
};
const header = "9 $EXTMIN\n10 0\n20 0\n9 $EXTMAX\n10 10\n20 10";
const vertices = (r: Awaited<ReturnType<typeof renderPlot>>) =>
  r.displayList.batches.reduce((n, b) => n + b.positions.length / 2, 0);

describe("viewer LOD", () => {
  it("uses one pass for plausible extents and two accurate passes after a rejected guess", async () => {
    const spy = vi.spyOn(Frontend.prototype, "drawBlock");
    try {
      const doc = modelDoc({ entities: line("A", 0, 0, 10, 10), header });
      const result = await renderPlot(doc, request, { raster: "smooth", lod: true });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result.view).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
      spy.mockClear();
      const stale = modelDoc({ entities: line("A", 0, 0, 100, 100), header });
      const fallback = await renderPlot(stale, request, { raster: "smooth", lod: true });
      expect(spy).toHaveBeenCalledTimes(3);
      expect(fallback.view).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    } finally {
      spy.mockRestore();
    }
  });

  it("ignores LOD in AutoCAD mode", async () => {
    const doc = modelDoc({ entities: line("A", 0, 0, 10, 10), header });
    expect(await renderPlot(doc, request, { lod: true })).toEqual(await renderPlot(doc, request));
  });

  it("greeks only glyphs with ink, preserves inline colour, and refines at the threshold", () => {
    const doc = modelDoc({ entities: line("A", 0, 0, 1, 1) });
    const glyph: StrokeGlyph = {
      kind: "strokes",
      code: 65,
      advance: 2,
      advanceY: 0,
      bounds: { xMin: 0, yMin: 0, xMax: 2, yMax: 2 },
      strokes: [
        {
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 0, y: 2, bulge: 0 },
            { x: 2, y: 0, bulge: 0 },
          ],
        },
      ],
    };
    const placement = {
      glyph,
      font: { capHeight: 2 } as Font,
      matrix: Affine2.scaling(0.5),
      color: { kind: "rgb" as const, rgb: 0xff0000 },
    };
    const layout: TextLayout = {
      plane: Matrix44.identity(),
      backgrounds: [],
      lines: [],
      notes: [],
      glyphs: [placement, { ...placement, glyph: { ...glyph, bounds: undefined, strokes: [] } }],
    };
    const fe = new Frontend(doc, request, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, DEFAULT_CALIBRATION, {
      raster: "smooth",
      lod: true,
    });
    drawLayout(fe, layout, doc.modelSpace.entities[0]!, Matrix44.identity(), TOP_LEVEL);
    const list = fe.build();
    expect(list.batches[0]!.kind).toBe(PrimitiveKind.Triangles);
    expect(list.batches[0]!.positions.length).toBe(12);
    expect([...list.batches[0]!.colors.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(list.bounds.minY).toBeLessThan(0.5);
    const detailed = new Frontend(
      doc,
      request,
      { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      DEFAULT_CALIBRATION,
      { raster: "smooth", lod: true },
    );
    drawLayout(detailed, layout, doc.modelSpace.entities[0]!, Matrix44.identity(), TOP_LEVEL);
    expect(detailed.build().batches[0]!.positions.length).toBe(8);
  });

  it("conserves filled ink including holes under affine transforms with six vertices per run", () => {
    const doc = modelDoc({ entities: line("A", 0, 0, 1, 1) });
    // A 2x2 square with a reversed 1x1 hole: 3 font units of filled ink.
    const glyph: OutlineGlyph = {
      kind: "outline",
      code: 65,
      advance: 3,
      bounds: { xMin: 0, yMin: 0, xMax: 2, yMax: 2 },
      path: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 2, y: 0 },
        { type: "L", x: 2, y: 2 },
        { type: "L", x: 0, y: 2 },
        { type: "Z" },
        { type: "M", x: 0.5, y: 0.5 },
        { type: "L", x: 0.5, y: 1.5 },
        { type: "L", x: 1.5, y: 1.5 },
        { type: "L", x: 1.5, y: 0.5 },
        { type: "Z" },
      ],
    };
    const font = { capHeight: 2 } as Font;
    for (const transform of [
      Affine2.scaling(0.1),
      new Affine2(0, 0.1, -0.2, 0.05, 10, 20),
      new Affine2(-0.1, 0, 0.05, 0.2, 10, 20),
    ]) {
      const layout: TextLayout = {
        plane: Matrix44.identity(),
        backgrounds: [],
        lines: [],
        notes: [],
        glyphs: [0, 3].map((x, index) => ({
          glyph,
          font,
          matrix: transform.multiply(Affine2.translation(x, 0)),
          color: undefined,
          run: { run: 0, index },
        })),
      };
      const fe = new Frontend(doc, request, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, DEFAULT_CALIBRATION, {
        raster: "smooth",
        lod: true,
      });
      drawLayout(fe, layout, doc.modelSpace.entities[0]!, Matrix44.identity(), TOP_LEVEL);
      const batches = fe.build().batches;
      expect(batches).toHaveLength(1);
      const p = batches[0]!.positions;
      expect(p).toHaveLength(12);
      let area = 0;
      for (let i = 0; i < p.length; i += 6)
        area +=
          Math.abs(
            (p[i + 2]! - p[i]!) * (p[i + 5]! - p[i + 1]!) - (p[i + 4]! - p[i]!) * (p[i + 3]! - p[i + 1]!),
          ) / 2;
      expect(area).toBeCloseTo(6 * Math.abs(transform.determinant()), 6);
      expect(fe.build().bounds.maxY - fe.build().bounds.minY).toBeGreaterThan(0);
    }
  });

  it("splits at run, baseline and colour changes and leaves backgrounds/decorations unchanged", () => {
    const doc = modelDoc({ entities: line("A", 0, 0, 1, 1) });
    const glyph: OutlineGlyph = {
      kind: "outline",
      code: 65,
      advance: 2,
      bounds: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 },
      path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 1, y: 0 }, { type: "L", x: 0, y: 1 }, { type: "Z" }],
    };
    const font = { capHeight: 1 } as Font;
    const layout: TextLayout = {
      plane: Matrix44.identity(),
      notes: [],
      backgrounds: [{ corners: [0, 0, 10, 0, 10, 10, 0, 10], color: { kind: "rgb", rgb: 0x123456 } }],
      lines: [{ kind: "stack-bar", x0: 0, y0: 5, x1: 3, y1: 5, color: undefined }],
      glyphs: [0, 1, 2, 3].map((index) => ({
        glyph,
        font,
        matrix: new Affine2(0.1, 0, 0, 0.1, index, index === 3 ? 1 : 0),
        run: { run: index === 0 ? 0 : 1, index },
        color: index >= 2 ? { kind: "rgb" as const, rgb: 0xff0000 } : undefined,
      })),
    };
    const render = (lod: boolean) => {
      const fe = new Frontend(doc, request, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, DEFAULT_CALIBRATION, {
        raster: "smooth",
        lod,
      });
      drawLayout(fe, layout, doc.modelSpace.entities[0]!, Matrix44.identity(), TOP_LEVEL);
      return fe.build();
    };
    const on = render(true);
    const off = render(false);
    expect(on.batches[0]!.positions.length).toBe(12 + 4 * 12);
    expect(on.batches[0]!.positions.slice(0, 12)).toEqual(off.batches[0]!.positions.slice(0, 12));
    expect(on.batches.at(-1)).toEqual(off.batches.at(-1));
    expect(on.batches[0]!.colors.slice(18 * 4, 19 * 4)).toEqual(Uint8Array.of(255, 0, 0, 255));
  });

  it("applies SHX stroke width at draw time, scales nonuniform lengths, and keeps sub-pixel ink", () => {
    const doc = modelDoc({ entities: `${line("A", 0, 0, 1, 1)}\n370 100` });
    const glyph: StrokeGlyph = {
      kind: "strokes",
      code: 45,
      advance: 2,
      advanceY: 0,
      bounds: { xMin: 0, yMin: 0, xMax: 2, yMax: 0 },
      strokes: [
        {
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 2, y: 0, bulge: 0 },
          ],
        },
      ],
    };
    const font = { capHeight: 2 } as Font;
    const area = (lineweights: boolean) => {
      const fe = new Frontend(
        doc,
        { ...request, lineweights },
        { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        DEFAULT_CALIBRATION,
        { raster: "smooth", lod: true },
      );
      drawLayout(
        fe,
        {
          plane: Matrix44.identity(),
          backgrounds: [],
          lines: [],
          notes: [],
          glyphs: [{ glyph, font, matrix: Affine2.scaling(0.25, 0.1), color: undefined }],
        },
        doc.modelSpace.entities[0]!,
        Matrix44.identity(),
        TOP_LEVEL,
      );
      const bounds = fe.build().bounds;
      expect(fe.build().batches[0]!.positions).toHaveLength(12);
      return (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
    };
    expect(area(false)).toBeCloseTo(0.5, 6); // half a target unit of stroke x one-pixel width
    expect(area(true)).toBeCloseTo(0.5 * (DEFAULT_CALIBRATION.dpi / 25.4), 6);
    expect(area(false)).toBeCloseTo(0.5, 6); // the shared glyph cache contains no lineweight
  });

  it("measures filled area rather than double-counting overlapping outline contours", () => {
    const doc = modelDoc({ entities: line("A", 0, 0, 1, 1) });
    const glyph: OutlineGlyph = {
      kind: "outline",
      code: 65,
      advance: 3,
      bounds: { xMin: 0, yMin: 0, xMax: 3, yMax: 2 },
      path: [0, 1].flatMap((x) => [
        { type: "M" as const, x, y: 0 },
        { type: "L" as const, x: x + 2, y: 0 },
        { type: "L" as const, x: x + 2, y: 2 },
        { type: "L" as const, x, y: 2 },
        { type: "Z" as const },
      ]),
    };
    const fe = new Frontend(doc, request, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, DEFAULT_CALIBRATION, {
      raster: "smooth",
      lod: true,
    });
    drawLayout(
      fe,
      {
        plane: Matrix44.identity(),
        backgrounds: [],
        lines: [],
        notes: [],
        glyphs: [{ glyph, font: { capHeight: 2 } as Font, matrix: Affine2.scaling(0.1), color: undefined }],
      },
      doc.modelSpace.entities[0]!,
      Matrix44.identity(),
      TOP_LEVEL,
    );
    const b = fe.build().bounds;
    expect((b.maxX - b.minX) * (b.maxY - b.minY)).toBeCloseTo(0.06, 7); // union = 6, sum = 8
    expect(fe.build().batches[0]!.positions).toHaveLength(12);
  });

  it("replaces sub-pixel hatch spacing with coverage but keeps the total-line cutoff", async () => {
    const hatch = (spacing: number) =>
      modelDoc({
        entities: `0 HATCH\n5 A\n330 1F\n100 AcDbEntity\n8 0\n100 AcDbHatch\n2 USER\n70 0\n71 0\n91 1\n92 3\n72 0\n73 1\n93 4\n10 0\n20 0\n10 10\n20 0\n10 10\n20 10\n10 0\n20 10\n97 0\n75 0\n76 0\n78 1\n53 0\n43 0\n44 0\n45 0\n46 ${spacing}\n79 0\n98 0`,
      });
    const window: PlotRequest = { ...request, area: { type: "window", min: [0, 0], max: [10, 10] } };
    const env = { raster: "smooth" as const, lod: true };
    const on = await renderPlot(hatch(0.05), window, env);
    const off = await renderPlot(hatch(0.05), window, { raster: "smooth" });
    expect(vertices(on)).toBeLessThan(vertices(off));
    expect(on.displayList.batches[0]!.kind).toBe(PrimitiveKind.Triangles);
    const dense = await renderPlot(hatch(0.00001), window, env);
    expect(vertices(dense)).toBe(0);
    expect(dense.unsupported["hatch-too-dense"]).toBe(1);
  });

  it("preserves narrow filled bands and simplifies 1.2-pixel lineweight strokes", async () => {
    const doc = modelDoc({
      entities: `0 LWPOLYLINE\n5 A\n330 1F\n100 AcDbEntity\n8 0\n370 100\n100 AcDbPolyline\n90 2\n70 0\n43 0.12\n10 0\n20 5\n10 10\n20 5`,
    });
    const window: PlotRequest = {
      ...request,
      lineweights: true,
      area: { type: "window", min: [0, 0], max: [10, 10] },
    };
    const on = await renderPlot(doc, window, { raster: "smooth", lod: true });
    const off = await renderPlot(doc, window, { raster: "smooth" });
    expect(on.displayList).toEqual(off.displayList);
    expect(on.displayList.batches[0]!.kind).toBe(PrimitiveKind.Triangles);
    const weighted = modelDoc({ entities: `${line("B", 0, 0, 10, 10)}\n370 30` });
    expect(
      (await renderPlot(weighted, window, { raster: "smooth", lod: true })).displayList.batches[0]!.kind,
    ).toBe(PrimitiveKind.Lines);
    expect((await renderPlot(weighted, window, { raster: "smooth" })).displayList.batches[0]!.kind).toBe(
      PrimitiveKind.Triangles,
    );
  });
});
