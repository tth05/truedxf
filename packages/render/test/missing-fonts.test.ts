import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DxfDocument } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import { makeOtf } from "../../fonts/test/helpers.ts";
import { type PlotRequest, renderPlot } from "../src/index.ts";
import { prepareTextFonts } from "../src/text.ts";
import { dxfBytes } from "./helpers.ts";

const assets = join(import.meta.dirname, "..", "..", "fonts", "assets");
/** A viewer-like font loader: FONTALT (simplex.shx) and txt.shx exist, nothing else. */
const files: Record<string, string> = {
  "simplex.shx": "truedxf-test-uni.shx",
  "txt.shx": "truedxf-test.shx",
  "mybig.shx": "truedxf-big.shx",
};
const loadFont = async (name: string) => {
  const f = files[name.toLowerCase()];
  return f ? new Uint8Array(readFileSync(join(assets, f))) : undefined;
};

function style(name: string, font: string, big = ""): string {
  return `0 STYLE\n2 ${name}\n70 0\n40 0\n41 1\n50 0\n71 0\n42 2.5\n3 ${font}\n4 ${big}`;
}

function text(y: number, styleName: string, s: string): string {
  return `0 TEXT\n330 1F\n100 AcDbEntity\n8 0\n100 AcDbText\n10 0\n20 ${y}\n30 0\n40 5\n1 ${s}\n7 ${styleName}`;
}

const doc = () =>
  DxfDocument.load(
    dxfBytes(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1032
0 ENDSEC
0 SECTION
2 TABLES
0 TABLE
2 BLOCK_RECORD
5 1
70 1
0 BLOCK_RECORD
5 1F
330 1
100 AcDbSymbolTableRecord
100 AcDbBlockTableRecord
2 *Model_Space
0 ENDTAB
0 TABLE
2 STYLE
70 3
${style("Standard", "txt.shx")}
${style("MISSING", "romans.shx")}
${style("BIG", "txt.shx", "gbcbig.shx")}
0 ENDTAB
0 ENDSEC
0 SECTION
2 ENTITIES
${text(0, "MISSING", "AB")}
${text(20, "BIG", "CD")}
0 MTEXT
330 1F
100 AcDbEntity
8 0
100 AcDbMText
10 0
20 40
30 0
40 5
1 {\\fNoSuchFamily|b0|i0|c0|p34;EF}
7 Standard
0 ENDSEC
0 EOF
`),
  );

const request: PlotRequest = {
  layout: "Model",
  area: { type: "window", min: [-10, -10], max: [70, 50] },
  canvas: [800, 600],
};

describe("missing fonts (PlotResult.notes, TextRenderOptions.missingFont)", () => {
  it.each([0, 34306])("distinguishes localized and English SimSun families with flags %i", async (flags) => {
    const simsun = makeOtf({ family: "SimSun", glyphs: [] });
    const load = async (name: string) => (name.toLowerCase() === "simsun.ttc" ? simsun : loadFont(name));
    const d = DxfDocument.load(
      dxfBytes(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1032
0 ENDSEC
0 SECTION
2 TABLES
0 TABLE
2 STYLE
70 3
${style("LOCALIZED", "")}\n1001 ACAD\n1000 宋体\n1071 ${flags}
${style("ENGLISH", "")}\n1001 ACAD\n1000 SimSun\n1071 ${flags}
${style("FILE_LOCALIZED", "simsun.ttc")}\n1001 ACAD\n1000 宋体\n1071 ${flags}
0 ENDTAB
0 ENDSEC
0 EOF
`),
    );
    const plot = await prepareTextFonts(d, load);
    expect(plot!.style("LOCALIZED").font!.primary.kind).toBe("shx");
    expect(plot!.style("LOCALIZED").substitutions).toContainEqual({
      reason: "unknown-family",
      requested: "宋体",
      used: "simplex.shx",
    });
    expect(plot!.style("FILE_LOCALIZED").font!.primary.kind).toBe("shx");
    expect(plot!.style("ENGLISH").font!.primary.kind).toBe("ttf");
    expect(plot!.style("ENGLISH").substitutions).toEqual([]);
    const viewer = await prepareTextFonts(d, load, { missingFont: "fallback" });
    expect(viewer!.style("LOCALIZED").font!.primary.kind).toBe("ttf");
  });
  it('"autocad" (plots): FONTALT, the missing-bigfont text and the unknown \\f family are not drawn', async () => {
    const r = await renderPlot(doc(), request, { loadFont });
    expect(r.notes).toEqual([
      {
        code: "font-missing",
        severity: "warning",
        message: expect.stringContaining("NoSuchFamily, romans.shx"),
        count: 2,
        items: ["NoSuchFamily", "romans.shx"],
      },
      {
        code: "bigfont-missing",
        severity: "warning",
        message: expect.stringContaining("not drawn"),
        count: 1,
        items: ["gbcbig.shx"],
      },
    ]);
    // only "AB" (in FONTALT) is drawn
    expect(r.displayList.bounds.maxY).toBeLessThan(10);
  });

  it('"fallback": everything is drawn; the default for smooth (viewer) rendering', async () => {
    const r = await renderPlot(doc(), request, { loadFont, text: { missingFont: "fallback" } });
    expect(r.notes?.map((n) => [n.code, n.items])).toEqual([
      ["font-missing", ["NoSuchFamily", "romans.shx"]],
      ["bigfont-missing", ["gbcbig.shx"]],
    ]);
    expect(r.notes?.[0]?.message).toContain("drawn with simplex.shx");
    expect(r.notes?.[1]?.message).toContain("drawn without them");
    expect(r.displayList.bounds.maxY).toBeGreaterThan(40);
    const smooth = await renderPlot(doc(), request, { loadFont, raster: "smooth" });
    expect(smooth.notes?.[1]?.message).toContain("drawn without them");
  });

  it("uses the configured fallback fonts", async () => {
    const r = await renderPlot(doc(), request, {
      loadFont,
      text: { missingFont: "fallback", fallbackFont: "txt.shx", fallbackBigFont: "mybig.shx" },
    });
    expect(r.notes?.[0]?.message).toContain("drawn with txt.shx");
    expect(r.notes?.[1]?.message).toContain("drawn with mybig.shx");
  });

  it("reports nothing when every font loads", async () => {
    const d = DxfDocument.load(
      dxfBytes(`
0 SECTION
2 TABLES
0 TABLE
2 BLOCK_RECORD
5 1
70 1
0 BLOCK_RECORD
5 1F
330 1
100 AcDbSymbolTableRecord
100 AcDbBlockTableRecord
2 *Model_Space
0 ENDTAB
0 TABLE
2 STYLE
70 1
${style("Standard", "txt.shx")}
${style("UNUSED", "romans.shx")}
0 ENDTAB
0 ENDSEC
0 SECTION
2 ENTITIES
${text(0, "Standard", "AB")}
0 ENDSEC
0 EOF
`),
    );
    const r = await renderPlot(d, request, { loadFont });
    expect(r.notes).toBeUndefined();
  });
});
