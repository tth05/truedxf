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
];

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
