import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DxfDocument } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import { PrimitiveKind, renderPlot } from "../src/index.ts";
import { dxfBytes } from "./helpers.ts";

const ASSETS = join(import.meta.dirname, "../../fonts/assets");
const loadFont = async (name: string) => {
  try {
    return new Uint8Array(readFileSync(join(ASSETS, name)));
  } catch {
    return undefined;
  }
};
/** Optional local TrueType font; the tests using it skip when it is absent. */
const ARIAL = "C:/Windows/Fonts/arial.ttf";
const loadWithArial = async (name: string) =>
  name.toLowerCase() === "arial.ttf" ? new Uint8Array(readFileSync(ARIAL)) : loadFont(name);

/** LINE (0,0)-(10,0) with a linetype whose second element carries a complex element. */
function doc(element: string, style: string): DxfDocument {
  return DxfDocument.load(
    dxfBytes(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1032
0 ENDSEC
0 SECTION
2 TABLES
0 TABLE
2 LTYPE
5 5
70 1
0 LTYPE
5 30
100 AcDbSymbolTableRecord
100 AcDbLinetypeTableRecord
2 CPLX
70 0
3 complex
72 65
73 3
40 0.9
49 0.5
74 0
${element}
49 -0.2
74 0
0 ENDTAB
0 TABLE
2 STYLE
5 3
70 1
${style}
0 ENDTAB
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
0 ENDSEC
0 SECTION
2 ENTITIES
0 LINE
5 40
330 1F
100 AcDbEntity
8 0
6 CPLX
100 AcDbLine
10 0
20 0
30 0
11 10
21 0
31 0
0 ENDSEC
0 SECTION
2 OBJECTS
0 ENDSEC
0 EOF
`),
  );
}

const request = {
  layout: "Model",
  area: { type: "window" as const, min: [-1, -2] as const, max: [11, 2] as const },
  canvas: [1200, 400] as const,
  lineweights: false,
};

function triangleVertices(list: Awaited<ReturnType<typeof renderPlot>>["displayList"]): [number, number][] {
  const out: [number, number][] = [];
  for (const b of list.batches) {
    if (b.kind !== PrimitiveKind.Triangles) continue;
    for (let k = 0; k < b.positions.length; k += 2)
      out.push([b.originX + b.positions[k]!, b.originY + b.positions[k + 1]!]);
  }
  return out;
}

function hairlineVertices(list: Awaited<ReturnType<typeof renderPlot>>["displayList"]): [number, number][] {
  const out: [number, number][] = [];
  for (const b of list.batches) {
    if (b.kind !== PrimitiveKind.Lines) continue;
    for (let k = 0; k < b.positions.length; k += 2)
      out.push([b.originX + b.positions[k]!, b.originY + b.positions[k + 1]!]);
  }
  return out;
}

const hasVertex = (v: [number, number][], x: number, y: number) =>
  v.some(([a, b]) => Math.abs(a - x) < 1e-5 && Math.abs(b - y) < 1e-5);

describe("complex linetype elements (note 06 §2.3)", () => {
  it("draws shapes from the STYLE's shape file at the end of their element, X/Y offset, S scale", async () => {
    // TDX_BOX (150) = unit square from the origin; X = -0.1, Y = -0.1, S = 0.2
    const d = doc(
      "49 -0.2\n74 4\n75 150\n340 31\n46 0.2\n50 0\n44 -0.1\n45 -0.1",
      "0 STYLE\n5 31\n100 AcDbSymbolTableRecord\n100 AcDbTextStyleTableRecord\n2 \n70 1\n40 0\n41 1\n50 0\n71 0\n42 0.2\n3 truedxf-lt.shx\n4 ",
    );
    const r = await renderPlot(d, request, { loadFont, raster: "smooth" });
    expect(r.unsupported).toEqual({});
    const v = hairlineVertices(r.displayList);
    // L = 10, P = 0.9: k = 11, r = 0.1, h = 0.3; element 1 ends at 0.5 → shape origin (0.4, −0.1)
    expect(hasVertex(v, 0.4, -0.1)).toBe(true);
    expect(hasVertex(v, 0.6, 0.1)).toBe(true);
    expect(hasVertex(v, 0.4 + 0.9, -0.1)).toBe(true);
  });

  it("a missing shape file draws nothing (linetypes/ctext-missing-shx)", async () => {
    const d = doc(
      "49 -0.2\n74 4\n75 150\n340 31\n46 0.2\n50 0\n44 -0.1\n45 -0.1",
      "0 STYLE\n5 31\n100 AcDbSymbolTableRecord\n100 AcDbTextStyleTableRecord\n2 \n70 1\n40 0\n41 1\n50 0\n71 0\n42 0.2\n3 no-such.shx\n4 ",
    );
    const r = await renderPlot(d, request, { loadFont, raster: "smooth" });
    expect(r.unsupported["complex-linetype-missing-shape-file"]).toBeGreaterThan(0);
    expect(hasVertex(hairlineVertices(r.displayList), 0.4, -0.1)).toBe(false);
  });

  it("draws texts of TrueType styles with FONTALT when the font file is missing", async () => {
    const d = doc(
      "49 -0.2\n74 2\n75 0\n340 31\n46 0.2\n50 0\n44 -0.1\n45 -0.1\n9 AB",
      "0 STYLE\n5 31\n100 AcDbSymbolTableRecord\n100 AcDbTextStyleTableRecord\n2 LT\n70 0\n40 0\n41 1\n50 0\n71 0\n42 0.2\n3 truedxf-test.ttf\n4 ",
    );
    const fontLoads: string[] = [];
    const r = await renderPlot(d, request, {
      loadFont: (n) => {
        fontLoads.push(n);
        return loadFont(n);
      },
      raster: "smooth",
      text: { fontAlt: "truedxf-test.shx" },
    });
    // glyph strokes of "AB" start near the first insertion point (0.4, −0.1), height ≈ 0.2
    const glyph = hairlineVertices(r.displayList).filter(
      ([x, y]) => x > 0.35 && x < 0.75 && Math.abs(y) > 1e-9,
    );
    expect(glyph.length).toBeGreaterThan(4);
    expect(Math.min(...glyph.map((p) => p[1]))).toBeGreaterThan(-0.11);
    expect(Math.max(...glyph.map((p) => p[1]))).toBeLessThan(0.11);
    expect(fontLoads.some((n) => n.includes("truedxf-test.shx"))).toBe(true);
  });

  // TrueType linetype text: S < 0 draws like |S|, S = 0 draws nothing (note 06 §2.3,
  // linetypes/ctext-scale-neg, ctext-scale-zero)
  const ttfText = (scale: string) =>
    doc(
      `49 -0.2\n74 2\n75 0\n340 31\n46 ${scale}\n50 0\n44 -0.1\n45 -0.1\n9 AB`,
      "0 STYLE\n5 31\n100 AcDbSymbolTableRecord\n100 AcDbTextStyleTableRecord\n2 LT\n70 0\n40 0\n41 1\n50 0\n71 0\n42 0.2\n3 arial.ttf\n4 ",
    );
  it.skipIf(!existsSync(ARIAL))("draws TrueType text with its own font; S < 0 like |S|", async () => {
    for (const scale of ["0.2", "-0.2"]) {
      const r = await renderPlot(ttfText(scale), request, { loadFont: loadWithArial, raster: "smooth" });
      // filled glyphs of the first "AB" right of its insertion point (0.4, −0.1), not turned
      const glyph = triangleVertices(r.displayList).filter(([x]) => x > 0.3 && x < 0.9);
      expect(glyph.length).toBeGreaterThan(10);
      expect(Math.min(...glyph.map((p) => p[0]))).toBeGreaterThan(0.39);
      expect(Math.min(...glyph.map((p) => p[1]))).toBeGreaterThan(-0.11);
      expect(Math.max(...glyph.map((p) => p[1]))).toBeLessThan(0.11);
    }
  });
  it.skipIf(!existsSync(ARIAL))("draws no TrueType text for S = 0", async () => {
    const r = await renderPlot(ttfText("0"), request, { loadFont: loadWithArial, raster: "smooth" });
    expect(triangleVertices(r.displayList).length).toBe(0);
  });
});
