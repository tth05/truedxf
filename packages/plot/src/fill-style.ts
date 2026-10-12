// CTB/STB fill styles 65–72 on raster devices. They apply only to area fills (SOLID, solid
// HATCH, wide polylines; not text, lines or gradients) and are fixed device-pixel tiles in the
// pen colour on paper white, independent of the object position and the plot scale
// (VERIFIED-BY-ACAD 2026-10-12, note 06 §6.8). Vector devices draw other patterns (PDF:
// 8 pt tiling cells), so this is the PNG driver's output.

/** `fill_style` values. 64 and 73 (object) plot solid. */
export const PlotFillStyle = {
    Solid: 64,
    Checkerboard: 65,
    Crosshatch: 66,
    Diamonds: 67,
    HorizontalBars: 68,
    SlantLeft: 69,
    SlantRight: 70,
    SquareDots: 71,
    VerticalBars: 72,
    Object: 73,
} as const;
export type PlotFillStyle = (typeof PlotFillStyle)[keyof typeof PlotFillStyle];

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Whether device pixel (u, v) of an area fill is inked under `fillStyle`: u = column from the
 * left, v = row from the bottom of the device image (note 06 §6.8). Every harness canvas is a
 * multiple of 20 px high, so counting rows from the top gives the same pixels there; which edge
 * the tiles are anchored to is Q-0760.
 */
export function fillStyleInk(fillStyle: number | undefined, u: number, v: number): boolean {
    const a = mod(u, 10);
    const b = mod(v, 10);
    switch (fillStyle) {
        case PlotFillStyle.Checkerboard:
            return a <= 4 && b <= 4 && (a === 0 || a === 4 || b === 0 || b === 4);
        case PlotFillStyle.Crosshatch:
            return a === 0 || b === 0;
        case PlotFillStyle.Diamonds:
            return mod(u + v, 20) === 0 || mod(u - v, 20) === 0;
        case PlotFillStyle.HorizontalBars:
            return b === 0;
        case PlotFillStyle.SlantLeft:
            return mod(u + v, 20) === 0;
        case PlotFillStyle.SlantRight:
            return mod(u - v, 20) === 0;
        case PlotFillStyle.SquareDots:
            return a <= 1 && b <= 1;
        case PlotFillStyle.VerticalBars:
            return a === 0;
        default:
            return true;
    }
}

/** Tile period in device pixels (the inked set repeats every `n` pixels in u and v). */
export function fillStyleTileSize(fillStyle: number | undefined): number {
    switch (fillStyle) {
        case PlotFillStyle.Diamonds:
        case PlotFillStyle.SlantLeft:
        case PlotFillStyle.SlantRight:
            return 20;
        case PlotFillStyle.Checkerboard:
        case PlotFillStyle.Crosshatch:
        case PlotFillStyle.HorizontalBars:
        case PlotFillStyle.SquareDots:
        case PlotFillStyle.VerticalBars:
            return 10;
        default:
            return 1;
    }
}
