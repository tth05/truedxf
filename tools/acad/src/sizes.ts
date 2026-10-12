// Paper sizes of the truedxf plot configs (docs/fixtures.md "Supported canvases").
// The raster driver runs at a fixed 100 dpi, so the PDF sizes are the same sheets in inches
// (px / 100) and a PDF page maps 1:1 onto the PNG canvas.

export type Canvas = readonly [width: number, height: number];

export const CANVASES: readonly Canvas[] = [
    [2000, 1500],
    [1000, 1000],
    [800, 600],
    // calibration only (lineweight / DPI checks at a larger canvas)
    [4000, 3000],
    // page setup only: the one sheet with non-zero unprintable margins (CANVAS_MARGINS)
    [1600, 1200],
    // fill-style tile anchor probes (research/notes/06 §6.8): printable sizes that are not
    // multiples of 10/20 px, without and with odd margins
    [1017, 1013],
    [1030, 1017],
];

/**
 * Unprintable margins [left, bottom, right, top] in pixels (PDF: the same in 1/100 inch) of the
 * sheets that have them; every other sheet has zero margins. Four distinct values so a plot shows
 * which paper edge each margin belongs to (research/notes/08 §2.5).
 */
export const CANVAS_MARGINS: Readonly<Record<string, readonly [number, number, number, number]>> = {
    "1600x1200": [10, 20, 30, 40],
    // printable area 1016 x 997 px, offset by odd amounts from every sheet edge
    "1030x1017": [3, 7, 11, 13],
};

export function canvasMargins([w, h]: Canvas): readonly [number, number, number, number] {
    return CANVAS_MARGINS[`${w}x${h}`] ?? [0, 0, 0, 0];
}

const f2 = (x: number) => x.toFixed(2);

/** The name AutoCAD lists at the -PLOT paper-size prompt (localized_name in the PMP). */
export function pngPaperName([w, h]: Canvas): string {
    return `truedxf ${w}x${h} (${f2(w)} x ${f2(h)} Pixels)`;
}

export function pdfPaperName([w, h]: Canvas): string {
    return `truedxf ${w}x${h} (${f2(w / 100)} x ${f2(h / 100)} Inches)`;
}

export function isSupportedCanvas(c: readonly number[]): boolean {
    return CANVASES.some(([w, h]) => w === c[0] && h === c[1]);
}

export const PNG_PC3 = "truedxf PNG.pc3";
export const PNG_PMP = "truedxf PNG.pmp";
export const PDF_PC3 = "truedxf PDF.pc3";
export const PDF_PMP = "truedxf PDF.pmp";
