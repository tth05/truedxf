import { encode } from "fast-png";
import { describe, expect, it } from "vitest";
import { decodeRaster } from "../src/image-decode.ts";
import { PrimitiveKind, renderPlot } from "../src/index.ts";
import { modelDoc } from "./helpers.ts";

// 2×1 RGB: red, blue
const png = encode({ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 0, 0, 255]), channels: 3 });

const image = `0 IMAGE
5 70
330 1F
100 AcDbEntity
8 0
100 AcDbRasterImage
90 0
10 0
20 0
30 0
11 1
21 0
31 0
12 0
22 1
32 0
13 2
23 1
340 80
70 3
280 0
281 50
282 50
283 0
71 1
91 2
14 -0.5
24 -0.5
14 1.5
24 0.5`;

const imagedef = `0 IMAGEDEF
5 80
330 1F
100 AcDbRasterImageDef
90 0
1 C:\\img\\two.png
10 2
20 1
11 1
21 1
280 1
281 0`;

const request = {
  layout: "Model",
  area: { type: "window" as const, min: [-1, -1] as const, max: [3, 2] as const },
  canvas: [40, 30] as const,
};

describe("raster decoding", () => {
  it("decodes PNG to RGBA", () => {
    const r = decodeRaster(png)!;
    expect([r.width, r.height]).toEqual([2, 1]);
    expect([...r.rgba]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    expect(r.ink).toBeUndefined();
  });

  it("marks dark pixels of 1-bit images as ink", () => {
    const bits = encode({ width: 8, height: 1, data: new Uint8Array([0b01010101]), depth: 1, channels: 1 });
    const r = decodeRaster(bits)!;
    expect([...r.ink!]).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
  });
});

describe("IMAGE", () => {
  it("emits an image batch with the placement quad", async () => {
    const doc = modelDoc({ entities: image, objects: imagedef });
    const r = await renderPlot(doc, request, { loadImage: async () => png, raster: "smooth" });
    const b = r.displayList.batches.find((x) => x.kind === PrimitiveKind.Image)!;
    expect(b).toBeDefined();
    const img = r.displayList.images[b.image!]!;
    expect([img.width, img.height]).toEqual([2, 1]);
    // uv (0,0) is the top-left image corner = world (0, 1)
    for (let k = 0; k < b.positions.length / 2; k++) {
      const x = b.originX + b.positions[k * 2]!;
      const y = b.originY + b.positions[k * 2 + 1]!;
      expect(b.uvs![k * 2]!).toBeCloseTo(x / 2, 6);
      expect(b.uvs![k * 2 + 1]!).toBeCloseTo(1 - y, 6);
    }
  });

  it("is omitted like accoreconsole with rasterEntities = omit", async () => {
    const doc = modelDoc({ entities: image, objects: imagedef });
    const r = await renderPlot(doc, request, { loadImage: async () => png, rasterEntities: "omit" });
    expect(r.displayList.batches.length).toBe(0);
  });
});
