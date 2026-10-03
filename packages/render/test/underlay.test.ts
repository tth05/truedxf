import { describe, expect, it } from "vitest";
import {
  type PdfRasterizer,
  type PdfTransform,
  PrimitiveKind,
  type RenderEnv,
  renderPlot,
} from "../src/index.ts";
import { modelDoc } from "./helpers.ts";

const underlay = (flags = 2, extra = "") => `0 PDFUNDERLAY
5 70
330 1F
100 AcDbEntity
8 0
100 AcDbUnderlayReference
340 80
10 0
20 0
30 0
41 1
42 1
43 1
50 0
280 ${flags}
281 100
282 0
${extra}`;

const definition = `0 PDFDEFINITION
5 80
330 1F
100 AcDbUnderlayDefinition
1 C:\\plans\\site.pdf
2 1`;

const request = {
  layout: "Model",
  area: { type: "window" as const, min: [-1, -1] as const, max: [3, 2] as const },
  canvas: [40, 30] as const,
};

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];

type Call = { transform: PdfTransform; width: number; height: number };

/** A 2 × 1 inch page (144 × 72 PDF units): red left half, blue right half. */
function stub(calls: Call[] = []): PdfRasterizer {
  return {
    async open() {
      return {
        pageCount: 1,
        async page(n) {
          if (n !== 1) return undefined;
          return {
            mediaBox: [0, 0, 144, 72],
            async render(transform, width, height) {
              calls.push({ transform, width, height });
              // invert the transform: pixel centre → PDF point
              const [a, b, c, d, e, f] = transform;
              const det = a * d - b * c;
              const px = new Uint8Array(width * height * 4);
              for (let j = 0; j < height; j++)
                for (let i = 0; i < width; i++) {
                  const u = i + 0.5 - e;
                  const v = j + 0.5 - f;
                  const x = (d * u - c * v) / det;
                  const y = (a * v - b * u) / det;
                  if (x >= 0 && x <= 144 && y >= 0 && y <= 72)
                    px.set(x < 72 ? RED : BLUE, (j * width + i) * 4);
                }
              return px;
            },
          };
        },
      };
    },
  };
}

const pdfBytes = new TextEncoder().encode("%PDF-1.4\n/MediaBox [0 0 144 72]\n%%EOF");

function env(extra: Partial<RenderEnv> = {}): RenderEnv {
  return { loadImage: async () => pdfBytes, pdf: stub(), ...extra };
}

function imageBatches(r: Awaited<ReturnType<typeof renderPlot>>) {
  return r.displayList.batches.filter((b) => b.kind === PrimitiveKind.Image);
}

function area(b: ReturnType<typeof imageBatches>[number]): number {
  let a = 0;
  const p = b.positions;
  for (let k = 0; k + 5 < p.length; k += 6)
    a +=
      Math.abs(
        (p[k + 2]! - p[k]!) * (p[k + 5]! - p[k + 1]!) - (p[k + 4]! - p[k]!) * (p[k + 3]! - p[k + 1]!),
      ) / 2;
  return a;
}

const pixel = (px: Uint8Array, w: number, x: number, y: number) => [
  ...px.slice((y * w + x) * 4, (y * w + x) * 4 + 4),
];

describe("PDFUNDERLAY content", () => {
  it("draws the page bitmap at the target resolution, 1 PDF inch = 1 unit", async () => {
    const calls: Call[] = [];
    const doc = modelDoc({ entities: underlay(), objects: definition });
    const r = await renderPlot(doc, request, env({ pdf: stub(calls) }));
    const [b] = imageBatches(r);
    expect(b).toBeDefined();
    expect(area(b!)).toBeCloseTo(2, 6);
    // 0.1 units per pixel: 20 × 10 texels for the 2 × 1 page, device-aligned (y down)
    expect(calls).toHaveLength(1);
    expect([calls[0]!.width, calls[0]!.height]).toEqual([20, 10]);
    const t = calls[0]!.transform;
    for (const [i, x] of [10 / 72, 0, 0, -10 / 72, 0, 10].entries()) expect(t[i]!).toBeCloseTo(x, 9);
    const img = r.displayList.images[b!.image!]!;
    expect([img.width, img.height]).toEqual([20, 10]);
    expect(pixel(img.pixels, 20, 0, 0)).toEqual(RED);
    expect(pixel(img.pixels, 20, 19, 9)).toEqual(BLUE);
    // uv (0, 0) = top-left bitmap corner = world (0, 1)
    for (let k = 0; k < b!.positions.length / 2; k++) {
      const x = b!.originX + b!.positions[k * 2]!;
      const y = b!.originY + b!.positions[k * 2 + 1]!;
      expect(b!.uvs![k * 2]!).toBeCloseTo(x / 2, 6);
      expect(b!.uvs![k * 2 + 1]!).toBeCloseTo(1 - y, 6);
    }
    expect(r.unsupported["underlay-content"]).toBeUndefined();
  });

  it("rasterizes only the part of the page in view (plots)", async () => {
    const calls: Call[] = [];
    const doc = modelDoc({ entities: underlay(), objects: definition });
    // 4 × 3 units on 40 × 30 pixels: the page's right half is in view
    const window = {
      ...request,
      area: { type: "window" as const, min: [1, 0] as const, max: [5, 3] as const },
    };
    await renderPlot(doc, window, env({ pdf: stub(calls) }));
    expect(calls).toHaveLength(1);
    expect([calls[0]!.width, calls[0]!.height]).toEqual([10, 10]);
    // PDF x = 72 (world x = 1) is the bitmap's left edge
    expect(calls[0]!.transform[4]).toBeCloseTo(-10, 9);
  });

  it("renders rotated placements straight into device pixels", async () => {
    const calls: Call[] = [];
    const rotated = underlay().replace("50 0", "50 90");
    const r = await renderPlot(
      modelDoc({ entities: rotated, objects: definition }),
      { ...request, area: { type: "window" as const, min: [-2, -1] as const, max: [2, 2] as const } },
      env({ pdf: stub(calls) }),
    );
    // the 2 × 1 page stands upright: 10 × 20 texels
    expect([calls[0]!.width, calls[0]!.height]).toEqual([10, 20]);
    const img = r.displayList.images[imageBatches(r)[0]!.image!]!;
    // bottom row (page x near 0): red; top row (page x near 144): blue
    expect(pixel(img.pixels, 10, 5, 19)).toEqual(RED);
    expect(pixel(img.pixels, 10, 5, 0)).toEqual(BLUE);
  });

  it("cuts the clip boundary; flag 16 does not invert it (pdf-clip-inverted)", async () => {
    const clip = "11 0.5\n21 0.25\n11 1.5\n21 0.75";
    const inside = await renderPlot(
      modelDoc({ entities: underlay(3, clip), objects: definition }),
      request,
      env(),
    );
    expect(area(imageBatches(inside)[0]!)).toBeCloseTo(0.5, 6);
    const flagged = await renderPlot(
      modelDoc({ entities: underlay(19, clip), objects: definition }),
      request,
      env(),
    );
    expect(area(imageBatches(flagged)[0]!)).toBeCloseTo(0.5, 6);
  });

  it("applies monochrome, contrast and fade in HLS", async () => {
    const mono = await renderPlot(modelDoc({ entities: underlay(6), objects: definition }), request, env());
    const m = mono.displayList.images[imageBatches(mono)[0]!.image!]!;
    // pdf-flags-mono: red plots grey 127 (HLS lightness 0.5)
    expect(pixel(m.pixels, m.width, 0, 0).slice(0, 3)).toEqual([128, 128, 128]);
    const faded = await renderPlot(
      modelDoc({ entities: underlay(2).replace("282 0", "282 50"), objects: definition }),
      request,
      env(),
    );
    const f = faded.displayList.images[imageBatches(faded)[0]!.image!]!;
    // pdf-fade50-contrast100: red → (255, 127, 127)
    expect(pixel(f.pixels, f.width, 0, 0).slice(0, 3)).toEqual([255, 128, 128]);
  });

  it("draws nothing but the frame with the underlay off", async () => {
    const r = await renderPlot(modelDoc({ entities: underlay(0), objects: definition }), request, env());
    expect(imageBatches(r)).toHaveLength(0);
    expect(r.displayList.batches.length).toBeGreaterThan(0);
  });

  it("without a rasterizer draws the frame and notes the missing content", async () => {
    const r = await renderPlot(modelDoc({ entities: underlay(), objects: definition }), request, {
      loadImage: async () => pdfBytes,
    });
    expect(imageBatches(r)).toHaveLength(0);
    expect(r.unsupported["underlay-content"]).toBe(1);
  });

  it("reports missing PDF files", async () => {
    const r = await renderPlot(modelDoc({ entities: underlay(), objects: definition }), request, {
      loadImage: async () => undefined,
      pdf: stub(),
    });
    expect(imageBatches(r)).toHaveLength(0);
    expect(r.notes?.find((n) => n.code === "pdf-missing")?.items).toEqual(["C:\\plans\\site.pdf"]);
  });
});
