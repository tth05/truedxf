import { describe, expect, it } from "vitest";
import { DEFAULT_CALIBRATION, Frontend, fitWindow, renderPlot } from "../src/index.ts";
import { viewFromBounds } from "../src/plot.ts";
import { modelDoc } from "./helpers.ts";

describe("viewFromBounds", () => {
  it("spans the bounds exactly on the axis that sets the scale", () => {
    // fileformat/corpus-ezdxf-3dface: centre - half-size missed minY by an ulp, so the bottom
    // edge line mapped just below pixel 0 and was dropped. Own bounds with the same miss (2e-14).
    const b = { minX: 101.37, minY: 50.73, maxX: 4101.48, maxY: 3051.02 };
    const v = viewFromBounds(b, [2000, 1500]);
    expect(v.minY).toBe(b.minY);
    expect(v.maxY).toBe(b.maxY);
    expect((v.minX + v.maxX) / 2).toBeCloseTo((b.minX + b.maxX) / 2, 9);
    expect((v.maxX - v.minX) / 2000).toBeCloseTo((v.maxY - v.minY) / 1500, 12);
  });

  it("snaps x when the width sets the scale", () => {
    const b = { minX: 0.1, minY: 0.3, maxX: 20.3, maxY: 2.7 };
    const v = viewFromBounds(b, [2000, 1500]);
    expect(v.minX).toBe(0.1);
    expect(v.maxX).toBe(20.3);
  });
});

describe("extents plots", () => {
  const circle = `0 CIRCLE
5 40
330 1F
100 AcDbEntity
8 0
100 AcDbCircle
10 5
20 5
30 0
40 10`;
  const request = {
    layout: "Model",
    area: { type: "extents" as const },
    canvas: [200, 150] as const,
    styleTable: "monochrome.ctb",
  };

  it("treats degenerate header extents (0,0)-(0,0) as unset", async () => {
    const header = "9 $EXTMIN\n10 0\n20 0\n30 0\n9 $EXTMAX\n10 0\n20 0\n30 0";
    const r = await renderPlot(modelDoc({ entities: circle, header }), request);
    expect(r.view.maxY - r.view.minY).toBeCloseTo(20, 1);
  });

  it("caps curve tessellation when the view is far smaller than the geometry", () => {
    const doc = modelDoc({ entities: circle });
    const view = fitWindow([0, 0], [4e-9, 3e-9], [200, 150]);
    for (const raster of ["smooth", "autocad"] as const) {
      const fe = new Frontend(
        doc,
        { ...request, area: { type: "window", min: [0, 0], max: [4e-9, 3e-9] } },
        view,
        DEFAULT_CALIBRATION,
        { raster },
      );
      const pts = fe.flatten({
        subpaths: [
          {
            segments: [{ kind: "arc", center: { x: 0, y: 0 }, radius: 10, start: 0, sweep: 2 * Math.PI }],
            closed: false,
          },
        ],
      });
      expect(pts[0]!.points.length / 2).toBeLessThanOrEqual((1 << 16) + 1);
    }
  });
});
