import type { Matrix44 } from "@truedxf/geometry";
import { DxfDocument, type ViewportEntity } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import { viewportMatrix } from "../src/draw/viewport.ts";
import { PrimitiveKind, renderPlot } from "../src/index.ts";
import { findLayout, layoutAreaView, layoutPsltscale, plottedViewports } from "../src/layout.ts";
import { dxfBytes } from "./helpers.ts";

/** A VIEWPORT listing in paper space (owner 20 = *Paper_Space record). */
function viewport(o: {
  handle: string;
  id: number;
  status?: number;
  center: [number, number];
  size: [number, number];
  viewCenter: [number, number];
  viewHeight: number;
  twist?: number;
  direction?: [number, number, number];
  target?: [number, number, number];
  flags?: number;
  layer?: string;
}): string {
  const d = o.direction ?? [0, 0, 1];
  const t = o.target ?? [0, 0, 0];
  return `0 VIEWPORT
5 ${o.handle}
330 20
100 AcDbEntity
67 1
8 ${o.layer ?? "0"}
100 AcDbViewport
10 ${o.center[0]}
20 ${o.center[1]}
30 0
40 ${o.size[0]}
41 ${o.size[1]}
68 ${o.status ?? 1}
69 ${o.id}
12 ${o.viewCenter[0]}
22 ${o.viewCenter[1]}
16 ${d[0]}
26 ${d[1]}
36 ${d[2]}
17 ${t[0]}
27 ${t[1]}
37 ${t[2]}
45 ${o.viewHeight}
51 ${o.twist ?? 0}
90 ${o.flags ?? 0}`;
}

function line(
  handle: string,
  owner: string,
  a: [number, number],
  b: [number, number],
  paper = false,
): string {
  return `0 LINE
5 ${handle}
330 ${owner}
100 AcDbEntity
${paper ? "67 1\n" : ""}8 0
100 AcDbLine
10 ${a[0]}
20 ${a[1]}
30 0
11 ${b[0]}
21 ${b[1]}
31 0`;
}

/** Model space (record 1F) + active paper space (record 20, "Layout1"). */
function paperDoc(opts: { model: string; paper: string; header?: string }): DxfDocument {
  return DxfDocument.load(
    dxfBytes(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1032
${opts.header ?? ""}
0 ENDSEC
0 SECTION
2 TABLES
0 TABLE
2 BLOCK_RECORD
5 1
70 2
0 BLOCK_RECORD
5 1F
330 1
100 AcDbSymbolTableRecord
100 AcDbBlockTableRecord
2 *Model_Space
0 BLOCK_RECORD
5 20
330 1
100 AcDbSymbolTableRecord
100 AcDbBlockTableRecord
2 *Paper_Space
0 ENDTAB
0 ENDSEC
0 SECTION
2 BLOCKS
0 BLOCK
5 21
330 20
100 AcDbEntity
8 0
100 AcDbBlockBegin
2 *Paper_Space
70 0
10 0
20 0
30 0
3 *Paper_Space
1
0 ENDBLK
5 22
330 20
100 AcDbEntity
8 0
100 AcDbBlockEnd
0 ENDSEC
0 SECTION
2 ENTITIES
${opts.model}
${opts.paper}
0 ENDSEC
0 SECTION
2 OBJECTS
0 ENDSEC
0 EOF
`),
  );
}

const OVERALL = viewport({
  handle: "30",
  id: 1,
  center: [100, 75],
  size: [240, 180],
  viewCenter: [100, 75],
  viewHeight: 180,
});

function vpEntity(doc: DxfDocument, handle: string): ViewportEntity {
  const e = doc.getEntity(handle);
  if (e?.type !== "VIEWPORT") throw new Error(`no viewport ${handle}`);
  return e;
}

const apply = (m: Matrix44, x: number, y: number, z = 0) => {
  const p = m.transformPoint({ x, y, z });
  return [p.x, p.y].map((v) => Math.round(v * 1e9) / 1e9 + 0);
};

describe("viewportMatrix", () => {
  it("maps the DCS view centre to the viewport centre with scale 41/45", () => {
    const doc = paperDoc({
      model: "",
      paper: viewport({
        handle: "31",
        id: 2,
        center: [100, 75],
        size: [120, 90],
        viewCenter: [10, 5],
        viewHeight: 180,
      }),
    });
    const m = viewportMatrix(vpEntity(doc, "31"));
    expect(apply(m, 10, 5)).toEqual([100, 75]);
    expect(apply(m, 12, 5)).toEqual([101, 75]);
  });

  it("rotates model content counter-clockwise by the twist (calibration/vp-twist)", () => {
    const doc = paperDoc({
      model: "",
      paper: viewport({
        handle: "31",
        id: 2,
        center: [0, 0],
        size: [100, 100],
        viewCenter: [0, 0],
        viewHeight: 100,
        twist: 90,
        target: [5, 5, 0],
      }),
    });
    const m = viewportMatrix(vpEntity(doc, "31"));
    expect(apply(m, 5, 5)).toEqual([0, 0]);
    expect(apply(m, 15, 5)).toEqual([0, 10]);
  });

  it("uses the arbitrary-axis DCS for 3D view directions", () => {
    const doc = paperDoc({
      model: "",
      paper: viewport({
        handle: "31",
        id: 2,
        center: [0, 0],
        size: [100, 100],
        viewCenter: [0, 0],
        viewHeight: 100,
        direction: [0, -5, 0],
      }),
    });
    // front view: WCS X to the right, WCS Z up
    const m = viewportMatrix(vpEntity(doc, "31"));
    expect(apply(m, 1, 0, 0)).toEqual([1, 0]);
    expect(apply(m, 0, 0, 1)).toEqual([0, 1]);
  });
});

describe("layout selection", () => {
  const doc = paperDoc({
    model: line("40", "1F", [0, 0], [10, 0]),
    paper: [
      viewport({ handle: "33", id: 3, center: [50, 50], size: [20, 20], viewCenter: [0, 0], viewHeight: 20 }),
      OVERALL,
      viewport({
        handle: "32",
        id: 2,
        status: 0,
        center: [20, 20],
        size: [20, 20],
        viewCenter: [0, 0],
        viewHeight: 20,
      }),
      viewport({
        handle: "31",
        id: 0,
        status: -1,
        center: [80, 20],
        size: [20, 20],
        viewCenter: [0, 0],
        viewHeight: 20,
      }),
    ].join("\n"),
  });

  it("finds layouts case-insensitively and falls back to model space", () => {
    expect(findLayout(doc, "layout1").isModel).toBe(false);
    expect(findLayout(doc, "Model").isModel).toBe(true);
    expect(findLayout(doc, "nope").isModel).toBe(true);
  });

  it("skips the overall viewport (id 1) and status 0, plots in handle order", () => {
    const vps = plottedViewports(findLayout(doc, "Layout1").block.entities);
    expect(vps.map((v) => v.handle)).toEqual(["31", "33"]);
  });

  it("uses $PSLTSCALE for the active layout", () => {
    expect(layoutPsltscale(doc, findLayout(doc, "Layout1"))).toBe(true);
    const d0 = paperDoc({ model: "", paper: OVERALL, header: "9 $PSLTSCALE\n70 0" });
    expect(layoutPsltscale(d0, findLayout(d0, "Layout1"))).toBe(false);
  });

  it("plot area layout maps 1 px to 1 paper unit from the origin", () => {
    const v = layoutAreaView({ layout: "Layout1", area: { type: "layout" }, canvas: [200, 150] });
    expect(v).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 150 });
  });
});

describe("renderPlot of a layout", () => {
  const doc = paperDoc({
    model: line("40", "1F", [-100, 0], [100, 0]),
    paper: [
      OVERALL,
      viewport({
        handle: "31",
        id: 2,
        center: [100, 75],
        size: [40, 30],
        viewCenter: [0, 0],
        viewHeight: 30,
      }),
      line("41", "20", [0, 10], [200, 10], true),
    ].join("\n"),
  });
  const request = {
    layout: "Layout1",
    area: { type: "window" as const, min: [0, 0] as const, max: [200, 150] as const },
    canvas: [200, 150] as const,
    styleTable: "monochrome.ctb",
  };

  it("draws viewport content clipped to the viewport, then paper space", async () => {
    const r = await renderPlot(doc, request);
    const list = r.displayList;
    // the viewport region, and the same region dilated by half a pixel for single-pixel output
    expect(list.clips.length).toBe(2);
    const clipped = list.batches.filter((b) => b.clip >= 0);
    expect(clipped.length).toBeGreaterThan(0);
    // model line through the viewport centre at paper y = 75
    const ys = clipped.flatMap((b) => {
      const out: number[] = [];
      for (let k = 1; k < b.positions.length; k += 2) out.push(b.originY + b.positions[k]!);
      return out;
    });
    expect(Math.min(...ys)).toBeCloseTo(75.5, 5);
    // paper space (frame + line) comes after the viewport content by default
    const firstUnclipped = list.batches.findIndex((b) => b.clip === -1);
    const lastClipped = list.batches.map((b) => b.clip >= 0).lastIndexOf(true);
    expect(firstUnclipped).toBeGreaterThan(lastClipped);
    expect(
      list.batches.every((b) => b.kind === PrimitiveKind.Points || b.kind === PrimitiveKind.Triangles),
    ).toBe(true);
  });

  it("puts viewport content last with paperSpaceFirst", async () => {
    const r = await renderPlot(doc, { ...request, paperSpaceFirst: true });
    const b = r.displayList.batches;
    expect(b[b.length - 1]!.clip).toBeGreaterThanOrEqual(0);
    expect(b[0]!.clip).toBe(-1);
  });
});
