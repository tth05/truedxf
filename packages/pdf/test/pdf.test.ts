import { describe, expect, it } from "vitest";
import { createPdfRasterizer } from "../src/index.ts";

/** A one-page PDF (144 × 72 units): red left half, blue square in the right half, rest unpainted. */
function tinyPdf(): Uint8Array {
    const content = "1 0 0 rg 0 0 72 72 re f 0 0 1 rg 90 18 36 36 re f";
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 72] /Contents 4 0 R /Resources << >> >>",
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ];
    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((o, i) => {
        offsets.push(out.length);
        out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(out);
}

const at = (px: Uint8Array, w: number, x: number, y: number) => [
    ...px.slice((y * w + x) * 4, (y * w + x) * 4 + 4),
];

describe("createPdfRasterizer (PDF.js)", () => {
    it("opens a PDF and reads its page box", async () => {
        const file = await createPdfRasterizer().open(tinyPdf());
        expect(file?.pageCount).toBe(1);
        const page = await file!.page(1);
        expect(page?.mediaBox).toEqual([0, 0, 144, 72]);
        expect(await file!.page(2)).toBeUndefined();
        file!.close?.();
    });

    it("renders a page region to RGBA, transparent where nothing is painted", async () => {
        const file = await createPdfRasterizer().open(tinyPdf());
        const page = (await file!.page(1))!;
        // whole page at 1 px per 4 units: 36 × 18 (y flipped: PDF y up, rows top first)
        const full = (await page.render([0.25, 0, 0, -0.25, 0, 18], 36, 18))!;
        expect(full.length).toBe(36 * 18 * 4);
        expect(at(full, 36, 2, 9)).toEqual([255, 0, 0, 255]);
        expect(at(full, 36, 27, 9)).toEqual([0, 0, 255, 255]);
        expect(at(full, 36, 35, 0)[3]).toBe(0);
        // the right half only
        const right = (await page.render([0.25, 0, 0, -0.25, -18, 18], 18, 18))!;
        expect(at(right, 18, 9, 9)).toEqual([0, 0, 255, 255]);
        expect(at(right, 18, 0, 0)[3]).toBe(0);
        // rotated 90° counter-clockwise: page x runs up the bitmap (18 × 36)
        const rot = (await page.render([0, -0.25, -0.25, 0, 18, 36], 18, 36))!;
        expect(at(rot, 18, 9, 34)).toEqual([255, 0, 0, 255]);
        expect(at(rot, 18, 9, 9)).toEqual([0, 0, 255, 255]);
        file!.close?.();
    });

    it("rejects files that are not PDFs", async () => {
        expect(await createPdfRasterizer().open(new TextEncoder().encode("not a pdf"))).toBeUndefined();
    });
});
