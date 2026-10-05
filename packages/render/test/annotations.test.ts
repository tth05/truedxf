import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DxfDocument } from "@truedxf/model";
import { plainMText, plainText } from "@truedxf/text";
import { describe, expect, it } from "vitest";
import { type DisplayList, type PlotRequest, renderPlot, SnapKind } from "../src/index.ts";
import { dxfBytes, line } from "./helpers.ts";

const assets = join(import.meta.dirname, "..", "..", "fonts", "assets");
const loadFont = async (name: string) =>
  ["simplex.shx", "txt.shx"].includes(name.toLowerCase())
    ? new Uint8Array(readFileSync(join(assets, "truedxf-test-uni.shx")))
    : undefined;

const text = (handle: string, x: number, y: number, s: string) =>
  `0 TEXT\n5 ${handle}\n100 AcDbEntity\n8 0\n100 AcDbText\n10 ${x}\n20 ${y}\n30 0\n40 2\n1 ${s}`;
const circle = (handle: string, x: number, y: number, r: number) =>
  `0 CIRCLE\n5 ${handle}\n100 AcDbEntity\n8 0\n100 AcDbCircle\n10 ${x}\n20 ${y}\n30 0\n40 ${r}`;
const insert = (handle: string, x: number) =>
  `0 INSERT\n5 ${handle}\n100 AcDbEntity\n8 0\n100 AcDbBlockReference\n2 B\n10 ${x}\n20 50`;

/** Model space: a LINE, a CIRCLE, a TEXT and 6 INSERTs of a block with a LINE and a TEXT. */
function doc(): DxfDocument {
  const inserts = Array.from({ length: 6 }, (_, i) => insert((0x80 + i).toString(16), i * 20)).join("\n");
  return DxfDocument.load(
    dxfBytes(`0 SECTION\n2 HEADER\n9 $ACADVER\n1 AC1032\n0 ENDSEC
0 SECTION\n2 BLOCKS
0 BLOCK\n100 AcDbEntity\n8 0\n100 AcDbBlockBegin\n2 B\n70 0\n10 0\n20 0
${line("40", 0, 0, 10, 0, 0)}
${text("41", 0, 2, "ROOM %%c5")}
0 ENDBLK\n100 AcDbEntity\n8 0\n100 AcDbBlockEnd
0 ENDSEC
0 SECTION\n2 ENTITIES
${line("30", 0, 0, 100, 0, 0)}
${circle("31", 50, 20, 5)}
${text("32", 10, 30, "Hello truedxf")}
${inserts}
0 ENDSEC\n0 EOF`),
  );
}

const request: PlotRequest = {
  layout: "Model",
  area: { type: "window", min: [-10, -10], max: [130, 70] },
  canvas: [1400, 800],
  lineweights: false,
};

async function list(annotations: boolean): Promise<DisplayList> {
  const r = await renderPlot(doc(), request, { loadFont, raster: "smooth", lod: true, annotations });
  return r.displayList;
}

const snapsOf = (l: DisplayList) => {
  const a = l.annotations!;
  return [...a.snapKinds].map((k, i) => ({ k, x: a.snapXY[i * 2]!, y: a.snapXY[i * 2 + 1]! }));
};
const has = (s: { k: number; x: number; y: number }[], k: number, x: number, y: number) =>
  s.some((p) => p.k === k && Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);

describe("display list annotations", () => {
  it("are absent unless requested (plots and fidelity tests stay unchanged)", async () => {
    expect((await list(false)).annotations).toBeUndefined();
  });

  it("record line ends, midpoints, circle centres and quadrants", async () => {
    const s = snapsOf(await list(true));
    expect(has(s, SnapKind.Endpoint, 0, 0)).toBe(true);
    expect(has(s, SnapKind.Endpoint, 100, 0)).toBe(true);
    expect(has(s, SnapKind.Midpoint, 50, 0)).toBe(true);
    expect(has(s, SnapKind.Center, 50, 20)).toBe(true);
    expect(has(s, SnapKind.Quadrant, 55, 20)).toBe(true);
    expect(has(s, SnapKind.Quadrant, 50, 15)).toBe(true);
  });

  it("record block content in every insert, replayed blocks included", async () => {
    const l = await list(true);
    const s = snapsOf(l);
    for (let i = 0; i < 6; i++) {
      expect(has(s, SnapKind.Endpoint, i * 20, 50)).toBe(true);
      expect(has(s, SnapKind.Endpoint, i * 20 + 10, 50)).toBe(true);
    }
    const rooms = l.annotations!.texts.filter((t) => t.text === "ROOM ⌀5");
    expect(rooms.map((t) => t.entity).sort()).toEqual(["80", "81", "82", "83", "84", "85"]);
    for (const t of rooms) {
      const x = Number.parseInt(t.entity, 16) - 0x80;
      expect(t.bounds.minX).toBeGreaterThanOrEqual(x * 20 - 0.5);
      expect(t.bounds.maxX).toBeLessThan(x * 20 + 15);
      expect(t.bounds.minY).toBeGreaterThan(51);
    }
  });

  it("record texts with the bounds of what was drawn", async () => {
    const t = (await list(true)).annotations!.texts.find((x) => x.entity === "32")!;
    expect(t.text).toBe("Hello truedxf");
    expect(t.bounds.minX).toBeGreaterThanOrEqual(9.5);
    expect(t.bounds.minY).toBeGreaterThanOrEqual(29.5);
    expect(t.bounds.maxY).toBeLessThan(33);
    expect(t.bounds.maxX).toBeGreaterThan(20);
  });
});

describe("plain text", () => {
  it("decodes TEXT specials", () => {
    expect(plainText("%%c50 %%p0.1 90%%d")).toBe("⌀50 ±0.1 90°");
    expect(plainText("%%uUnder%%u")).toBe("Under");
  });

  it("drops MTEXT formatting", () => {
    expect(plainMText("{\\fArial|b1;Room}\\P\\H2x;101\\~A")).toBe("Room\n101 A");
    expect(plainMText("1 \\S1/2;")).toBe("1 1/2");
  });
});
