import { flattenPath } from "@truedxf/geometry";
import { DxfDocument } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import { pointSymbol } from "../src/draw/points.ts";
import { PropertyResolver, TOP_LEVEL } from "../src/props.ts";
import { dxfBytes } from "./helpers.ts";

function bounds(mode: number, size: number): number[] {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of flattenPath(pointSymbol(mode, size).paths, 1e-4)) {
    for (let i = 0; i < p.points.length; i += 2) {
      b[0] = Math.min(b[0]!, p.points[i]!);
      b[1] = Math.min(b[1]!, p.points[i + 1]!);
      b[2] = Math.max(b[2]!, p.points[i]!);
      b[3] = Math.max(b[3]!, p.points[i + 1]!);
    }
  }
  return b.map((v) => Math.round(v * 1000) / 1000);
}

describe("PDMODE symbols (VERIFIED-BY-ACAD points/pdmode-*)", () => {
  it("draws + with arms ±S and × with arms of length S", () => {
    expect(bounds(2, 2)).toEqual([-2, -2, 2, 2]);
    const d = Math.round(Math.SQRT1_2 * 2 * 1000) / 1000;
    expect(bounds(3, 2)).toEqual([-d, -d, d, d]);
  });

  it("uses S/2 for the tick, circle and square", () => {
    expect(bounds(4, 2)).toEqual([0, 0, 0, 1]);
    expect(bounds(33, 2)).toEqual([-1, -1, 1, 1]);
    expect(bounds(65, 2)).toEqual([-1, -1, 1, 1]);
  });

  it("draws the dot of mode 0 together with frames, none for mode 1", () => {
    expect(pointSymbol(32, 1).dot).toBe(true);
    expect(pointSymbol(33, 1).dot).toBe(false);
    expect(pointSymbol(1, 1).paths.subpaths).toHaveLength(0);
  });
});

function layer(name: string, flags: number, plot: 0 | 1, color = 7): string {
  return `0 LAYER
100 AcDbSymbolTableRecord
100 AcDbLayerTableRecord
2 ${name}
70 ${flags}
62 ${color}
6 Continuous
290 ${plot}
370 -3`;
}

function ent(type: string, layerName: string, extra = ""): string {
  const body =
    type === "INSERT"
      ? "100 AcDbBlockReference\n2 B\n10 0\n20 0"
      : "100 AcDbLine\n10 0\n20 0\n30 0\n11 1\n21 1\n31 0";
  return `0 ${type}\n100 AcDbEntity\n8 ${layerName}\n${extra}\n${body}`;
}

const doc = DxfDocument.load(
  dxfBytes(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1032
0 ENDSEC
0 SECTION
2 TABLES
0 TABLE
2 LAYER
${layer("0", 0, 1)}
${layer("X", 0, 1, 3)}
${layer("OFF", 0, 1, -2)}
${layer("FROZEN", 1, 1)}
${layer("NOPLOT", 0, 0)}
0 ENDTAB
0 ENDSEC
0 SECTION
2 BLOCKS
0 BLOCK
100 AcDbEntity
8 0
100 AcDbBlockBegin
2 B
70 0
10 0
20 0
${ent("LINE", "0")}
${ent("LINE", "X")}
0 ENDBLK
100 AcDbEntity
8 0
100 AcDbBlockEnd
0 ENDSEC
0 SECTION
2 ENTITIES
${ent("INSERT", "X")}
${ent("INSERT", "OFF")}
${ent("INSERT", "FROZEN")}
${ent("INSERT", "NOPLOT")}
${ent("LINE", "OFF")}
${ent("LINE", "NOPLOT")}
${ent("LINE", "X", "60 1")}
0 ENDSEC
0 EOF
`),
);

describe("render PropertyResolver (model resolve.ts adapter)", () => {
  const props = new PropertyResolver(doc);
  const [onIns, offIns, frozenIns, noplotIns, offLine, noplotLine, invisible] = doc.modelSpace.entities;
  const [child0, childX] = doc.getBlock("B")!.entities;
  const plotted = (ins: typeof onIns) => {
    const inh = props.inherit(ins!, TOP_LEVEL);
    return [props.isPlotted(child0!, inh), props.isPlotted(childX!, inh)];
  };

  it("resolves layer-0 block content to the INSERT's layer", () => {
    const inh = props.inherit(onIns!, TOP_LEVEL);
    expect(props.resolve(child0!, inh)).toMatchObject({ layer: "X", aci: 3 });
    expect(plotted(onIns)).toEqual([true, true]);
  });

  it("off INSERT layer hides only layer-0 content (blocks/vis-insert-layer-off)", () => {
    expect(props.expands(offIns!, TOP_LEVEL)).toBe(true);
    expect(plotted(offIns)).toEqual([false, true]);
  });

  it("frozen INSERT layer hides the whole reference", () => {
    expect(props.expands(frozenIns!, TOP_LEVEL)).toBe(false);
  });

  it("no-plot INSERT layer suppresses all content (blocks/vis-insert-layer-noplot)", () => {
    expect(props.expands(noplotIns!, TOP_LEVEL)).toBe(true);
    expect(plotted(noplotIns)).toEqual([false, false]);
  });

  it("extents mode counts off and no-plot layers but not frozen or invisible entities", () => {
    const ext = new PropertyResolver(doc);
    ext.extents = true;
    expect(ext.isPlotted(offLine!, TOP_LEVEL)).toBe(true);
    expect(ext.isPlotted(noplotLine!, TOP_LEVEL)).toBe(true);
    expect(ext.isPlotted(invisible!, TOP_LEVEL)).toBe(false);
    expect(props.isPlotted(offLine!, TOP_LEVEL)).toBe(false);
    expect(props.isPlotted(noplotLine!, TOP_LEVEL)).toBe(false);
  });

  it("takes LWDEFAULT from the plot request", () => {
    expect(new PropertyResolver(doc, undefined, 100).resolve(offLine!, TOP_LEVEL).lineweight).toBe(100);
    expect(props.resolve(offLine!, TOP_LEVEL).lineweight).toBe(25);
  });
});
