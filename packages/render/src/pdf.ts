/**
 * PDF underlay content (note 07 §10.3). The renderer never parses or draws PDF itself: a host
 * passes a rasterizer (`RenderEnv.pdf`, e.g. `@truedxf/pdf` backed by PDF.js) that renders a page
 * into an RGBA bitmap, and the underlay drawer places that bitmap like an IMAGE.
 */

/** A rectangle in PDF units (1/72 inch, y up): [x0, y0, x1, y1]. */
export type PdfBox = readonly [number, number, number, number];

/**
 * A canvas-style affine matrix [a, b, c, d, e, f]: PDF units (y up) → bitmap pixels (origin at
 * the top-left corner, y down): x' = a·x + c·y + e, y' = b·x + d·y + f.
 */
export type PdfTransform = readonly [number, number, number, number, number, number];

export interface PdfRasterizer {
  /** Opens a PDF file; undefined when it cannot be read (damaged, encrypted, not a PDF). */
  open(bytes: Uint8Array): Promise<PdfFile | undefined>;
  /** Largest bitmap side in pixels (default 4096): larger underlays are drawn coarser. */
  readonly maxSize?: number;
}

export interface PdfFile {
  readonly pageCount: number;
  /** Page `n` (1-based); undefined when the file has no such page. */
  page(n: number): Promise<PdfPage | undefined>;
  /** Releases the file (called when the renderer drops it from its cache). */
  close?(): void;
}

export interface PdfPage {
  /** The page rectangle in PDF units. */
  readonly mediaBox: PdfBox;
  /**
   * Renders the page through `transform` into a `width` × `height` bitmap: RGBA, top row first,
   * unpremultiplied, transparent where the page paints nothing; undefined on failure.
   */
  render(transform: PdfTransform, width: number, height: number): Promise<Uint8Array | undefined>;
}
