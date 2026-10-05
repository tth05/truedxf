import { DxfDocument } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import { type PlotRequest, renderPlot } from "../src/index.ts";
import { hasCjkText } from "../src/text.ts";
import { dxfBytes } from "./helpers.ts";

const enc = new TextEncoder();
const mtext = (s: string) => `0 MTEXT\n5 20\n100 AcDbEntity\n8 0\n100 AcDbMText\n10 0\n20 0\n40 2.5\n1 ${s}`;
const doc = (entities: string, header = "9 $ACADVER\n1 AC1032") =>
  DxfDocument.load(
    dxfBytes(`0 SECTION\n2 HEADER\n${header}\n0 ENDSEC\n0 SECTION\n2 ENTITIES\n${entities}\n0 ENDSEC\n0 EOF`),
  );

describe("CJK glyph fallbacks", () => {
  it("detect CJK text by code page, escapes and UTF-8", () => {
    expect(hasCjkText(doc(mtext("Room 101")), "windows-1252")).toBe(false);
    expect(hasCjkText(doc(mtext("\\U+4E2D\\U+6587")), "windows-1252")).toBe(true);
    expect(hasCjkText(doc(mtext("\\U+00B0 only")), "windows-1252")).toBe(false);
    expect(hasCjkText(doc(mtext("\\M+1889A")), "windows-1252")).toBe(true);
    expect(hasCjkText(doc(mtext("Room 101")), "gbk")).toBe(true);
    // UTF-8 in an ASCII file: 中文, 한국어; not °±
    const utf8 = (s: string) =>
      DxfDocument.load(
        enc.encode(`  0\nSECTION\n  2\nENTITIES\n  0\nTEXT\n  1\n${s}\n  0\nENDSEC\n  0\nEOF\n`),
      );
    expect(hasCjkText(utf8("中文"), "utf-8")).toBe(true);
    expect(hasCjkText(utf8("한국어"), "utf-8")).toBe(true);
    expect(hasCjkText(utf8("90° ±0.1"), "utf-8")).toBe(false);
  });

  it("load the CJK fallbacks only for drawings with CJK text", async () => {
    const request: PlotRequest = { layout: "Model", area: { type: "extents" }, canvas: [200, 100] };
    for (const [text, expected] of [
      ["Room 101", false],
      ["\\U+4E2D", true],
    ] as const) {
      const asked: string[] = [];
      await renderPlot(doc(mtext(text)), request, {
        raster: "smooth",
        loadFont: async (name) => {
          asked.push(name.toLowerCase());
          return undefined;
        },
        text: { cjkFallbacks: ["notocjk.otf"] },
      });
      expect(asked.includes("notocjk.otf")).toBe(expected);
    }
  });
});
