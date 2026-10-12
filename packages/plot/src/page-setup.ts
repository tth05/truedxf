// Page setup: the plot parameters a LAYOUT or PLOTSETTINGS object stores in the drawing
// (note 08 §2). The model package reads the raw group codes; this module turns them into what a
// plot means: which area, at what scale, with which style table and flags. Everything a plot
// needs that is *not* in the DXF (device resolution, style table contents, registry sysvars)
// comes from the caller.

import type { DxfRecord, PlotSettings, Point2 } from "@truedxf/model";

/** PLOTSETTINGS 70 bits (note 08 §2.2). */
export const PlotFlags = {
    /** No effect on plotted frames (VERIFIED-BY-ACAD, note 08 §10.12). */
    PlotViewportBorders: 1,
    ShowPlotStyles: 2,
    PlotCentered: 4,
    /** "Hide paperspace objects". */
    PlotHidden: 8,
    UseStandardScale: 16,
    PlotPlotStyles: 32,
    ScaleLineweights: 64,
    PrintLineweights: 128,
    /** Set: -PLOT "Plot paper space first?" defaults to No (VERIFIED-BY-ACAD, note 08 §2.2). */
    DrawViewportsFirst: 512,
    ModelType: 1024,
    UpdatePaper: 2048,
    ZoomToPaperOnUpdate: 4096,
    Initializing: 8192,
    PrevPlotInit: 16384,
} as const;

/** PLOTSETTINGS 74. */
export const PlotType = { Display: 0, Extents: 1, Limits: 2, View: 3, Window: 4, Layout: 5 } as const;
export type PlotType = (typeof PlotType)[keyof typeof PlotType];

/** PLOTSETTINGS 72. */
export const PlotPaperUnits = { Inches: 0, Millimeters: 1, Pixels: 2 } as const;
export type PlotPaperUnits = (typeof PlotPaperUnits)[keyof typeof PlotPaperUnits];

/**
 * Standard scales (75) as [paper units, drawing units]; index 0 = scaled to fit. ObjectARX
 * StdScaleType: the imperial ones (1–15, 34) are paper inches per foot. ezdxf's table lacks 1:5
 * and is one off from 19 on (VERIFIED-BY-ACAD: 26 = 1:50, 27 = 1:100, note 08 §2.3). The plot
 * scale itself comes from 147, so this table is for display.
 */
// biome-ignore format: data table
export const STANDARD_SCALES: readonly (readonly [number, number])[] = Object.freeze([
    [0, 0],
    [1 / 128, 12], [1 / 64, 12], [1 / 32, 12], [1 / 16, 12], [3 / 32, 12], [1 / 8, 12],
    [3 / 16, 12], [1 / 4, 12], [3 / 8, 12], [1 / 2, 12], [3 / 4, 12], [1, 12], [3, 12],
    [6, 12], [12, 12],
    [1, 1], [1, 2], [1, 4], [1, 5], [1, 8], [1, 10], [1, 16], [1, 20], [1, 30], [1, 40],
    [1, 50], [1, 100], [2, 1], [4, 1], [8, 1], [10, 1], [100, 1], [1000, 1],
    [1.5, 12],
] as const);

export type PlotArea =
    | { readonly kind: "display" }
    | { readonly kind: "extents" }
    | { readonly kind: "limits" }
    | { readonly kind: "view"; readonly name: string }
    | { readonly kind: "window"; readonly min: Point2; readonly max: Point2 }
    | { readonly kind: "layout" };

/** Plot scale as a ratio of paper units (72) to drawing units, or fit to the printable area. */
export type PlotScale = "fit" | { readonly paper: number; readonly drawing: number };

export interface PageSetup {
    /** Page setup name (1), "" for a layout's own settings. */
    readonly name: string;
    /** Device / PC3 name (2), e.g. "DWG To PDF.pc3"; "" = default device. */
    readonly device: string;
    /** Canonical media name (4), e.g. "ISO_A4_(210.00_x_297.00_MM)". */
    readonly media: string;
    /**
     * Physical paper size (44/45), unrotated: mm, but pixels for raster setups (72 = 2)
     * (VERIFIED-BY-ACAD, note 08 §2.1).
     */
    readonly paperWidth: number;
    readonly paperHeight: number;
    /**
     * Unprintable margins (40–43) in the units of the paper size, unrotated: left/bottom/right/top
     * are device edges for every rotation. A stored page setup plots with these, not with the
     * device's own margins (VERIFIED-BY-ACAD, Q-0706, note 08 §2.1).
     */
    readonly margins: {
        readonly left: number;
        readonly bottom: number;
        readonly right: number;
        readonly top: number;
    };
    readonly paperUnits: PlotPaperUnits;
    /**
     * Raw 73. Paper point (x, y) → canvas column/row (W × H, row 0 at the top): 0 (x, H−1−y)
     * upright; 1 (y, x) 90° clockwise; 2 (W−1−x, y) 180°; 3 (W−1−y, H−1−x) 90° counter-clockwise
     * (VERIFIED-BY-ACAD, Q-0706, note 08 §10.17), W × H = the printable area.
     */
    readonly rotation: 0 | 1 | 2 | 3;
    readonly area: PlotArea;
    readonly scale: PlotScale;
    /**
     * Plot offset (46/47): mm (also in inch setups), pixels on raster setups. Measured from the
     * paper origin's printable corner along the device axes, into the sheet (Q-0757, note 08
     * §2.1); see `plotPlacement`.
     */
    readonly offset: Point2;
    /**
     * Paper image origin (148/149), paper units. Layout plots are shifted by it; window plots
     * ignore it (AutoCAD writes −(48, 49) there; VERIFIED-BY-ACAD, Q-0256, note 08 §2.1).
     */
    readonly imageOrigin: Point2;
    readonly centered: boolean;
    /** Plot style table file name (7), undefined = none. */
    readonly styleSheet: string | undefined;
    /** "Plot with plot styles" (32). */
    readonly plotStyles: boolean;
    /** "Plot object lineweights" (128). */
    readonly plotLineweights: boolean;
    /** "Scale lineweights" (64), layouts only. */
    readonly scaleLineweights: boolean;
    /** 512: viewport content before paper-space entities by default. */
    readonly drawViewportsFirst: boolean;
    /** "Hide paperspace objects" (8). */
    readonly hidePaperSpace: boolean;
    /** "Plot transparency": LAYOUT XDATA `PLOTTRANSPARENCY` 1071 (note 06 §4). */
    readonly plotTransparency: boolean;
    /** 76: 0 as displayed, 1 wireframe, 2 hidden, 3 rendered. */
    readonly shadePlotMode: number;
    readonly flags: number;
}

/** Millimetres per paper unit (72). Raster devices plot at a fixed 100 dpi (note 08 §5.3). */
export function mmPerPaperUnit(units: PlotPaperUnits): number {
    return units === PlotPaperUnits.Millimeters ? 1 : units === PlotPaperUnits.Pixels ? 25.4 / 100 : 25.4;
}

function plotArea(s: PlotSettings): PlotArea {
    switch (s.plotType) {
        case PlotType.Display:
            return { kind: "display" };
        case PlotType.Extents:
            return { kind: "extents" };
        case PlotType.Limits:
            return { kind: "limits" };
        case PlotType.View:
            return { kind: "view", name: s.plotViewName };
        case PlotType.Window:
            return { kind: "window", min: s.windowMin, max: s.windowMax };
        default:
            return { kind: "layout" };
    }
}

// Bit 16 set: 75 = 0 is Fit, otherwise the scale is 147 (75 and 142/143 are ignored); bit 16
// clear: 142/143 (VERIFIED-BY-ACAD, note 08 §2.1). ezdxf writes 147 as a unit factor
// (1/25.4 for inch layouts), which AutoCAD plots as that scale.
function plotScale(s: PlotSettings): PlotScale {
    if (s.plotFlags & PlotFlags.UseStandardScale) {
        if (s.standardScaleType === 0) return "fit";
        if (s.scaleFactor > 0) return { paper: s.scaleFactor, drawing: 1 };
        const std = STANDARD_SCALES[s.standardScaleType];
        if (std) return { paper: std[0], drawing: std[1] };
    }
    // A degenerate custom scale cannot be plotted; AutoCAD's default is 1:1.
    const ok = s.scaleNumerator > 0 && s.scaleDenominator > 0;
    return ok ? { paper: s.scaleNumerator, drawing: s.scaleDenominator } : { paper: 1, drawing: 1 };
}

function plotTransparency(rec: DxfRecord | undefined): boolean {
    const part = rec?.xdata("PLOTTRANSPARENCY");
    if (!rec || !part) return false;
    for (const i of rec.partTags(part)) if (rec.store.codes[i] === 1071) return rec.store.int(i) !== 0;
    return false;
}

/** Interprets the plot settings of a LAYOUT or PLOTSETTINGS object. */
export function readPageSetup(settings: PlotSettings & { readonly record?: DxfRecord }): PageSetup {
    const s = settings;
    const flags = s.plotFlags;
    const [left, bottom, right, top] = s.margins;
    const units = s.paperUnits === 1 || s.paperUnits === 2 ? s.paperUnits : PlotPaperUnits.Inches;
    return {
        name: s.pageSetupName,
        device: s.plotConfig,
        media: s.paperSize,
        paperWidth: s.paperWidth,
        paperHeight: s.paperHeight,
        margins: { left, bottom, right, top },
        paperUnits: units,
        rotation: (s.rotation & 3) as 0 | 1 | 2 | 3,
        area: plotArea(s),
        scale: plotScale(s),
        offset: s.plotOrigin,
        imageOrigin: s.paperImageOrigin,
        centered: (flags & PlotFlags.PlotCentered) !== 0,
        styleSheet: s.styleSheet === "" ? undefined : s.styleSheet,
        plotStyles: (flags & PlotFlags.PlotPlotStyles) !== 0,
        plotLineweights: (flags & PlotFlags.PrintLineweights) !== 0,
        scaleLineweights: (flags & PlotFlags.ScaleLineweights) !== 0,
        drawViewportsFirst: (flags & PlotFlags.DrawViewportsFirst) !== 0,
        hidePaperSpace: (flags & PlotFlags.PlotHidden) !== 0,
        plotTransparency: plotTransparency(s.record),
        shadePlotMode: s.shadePlotMode,
        flags,
    };
}

/** Millimetres on paper per drawing unit, or undefined for fit-to-paper. */
export function paperMmPerDrawingUnit(setup: PageSetup): number | undefined {
    if (setup.scale === "fit") return undefined;
    return (setup.scale.paper / setup.scale.drawing) * mmPerPaperUnit(setup.paperUnits);
}

export interface PlotBounds {
    readonly min: Point2;
    readonly max: Point2;
}

export interface PlotPlacementOptions {
    /**
     * Device units per mm for mm and inch page setups (e.g. 600 / 25.4 for a 1/600 in PDF
     * device); default 1 = device units are mm. Raster setups (72 = 2) store everything in device
     * pixels and ignore it.
     */
    readonly unitsPerMm?: number;
    /**
     * The plotted area in drawing units, for the plot types the page setup cannot resolve
     * (display, extents, limits, view) and for fitting a layout plot. Window plots use 48/49 and
     * 140/141.
     */
    readonly bounds?: PlotBounds;
}

/** Affine map [a, b, c, d, e, f]: X = a·x + c·y + e, Y = b·x + d·y + f. */
export type PlotMatrix = readonly [number, number, number, number, number, number];

export interface PlotPlacement {
    /** Printable area in device units and device orientation: the size of a raster plot image. */
    readonly width: number;
    readonly height: number;
    /**
     * Top-left corner of the printable area on the sheet (device units, from the sheet's
     * top-left): where vector devices put the plot. The PDF driver rounds it to whole points.
     */
    readonly printableLeft: number;
    readonly printableTop: number;
    /** Device units per drawing unit. */
    readonly scale: number;
    /**
     * Drawing coordinates of the plotted space → device coordinates in the printable area,
     * X right, Y down. On raster devices pixel (column, row) covers [column, column + 1) ×
     * [row, row + 1).
     */
    readonly matrix: PlotMatrix;
}

/**
 * Where a page setup puts the drawing on the device (note 08 §2.1, §2.5, §10.17; VERIFIED-BY-ACAD
 * 2026-10-12 for the margins, rotations, offsets and 148/149 of stored page setups plotted with
 * PLOTROTMODE 2):
 *
 * - The device prints the printable area: the sheet (44/45) minus the margins (40–43), both in
 *   device orientation. The paper origin is its bottom-left / top-left / top-right /
 *   bottom-right corner for rotation 0 / 1 / 2 / 3.
 * - The offset (46/47) moves the origin along the device width / height into the sheet, so in
 *   paper coordinates it is (46, 47) for rotations 0/2 and (47, 46) for 1/3.
 * - A window plot puts the window's lower-left corner on the origin; a layout plot puts paper
 *   (0, 0) there, shifted by 148/149 (only verified unrotated).
 * - Centred plots ignore the offset and centre the plotted area in the printable area (AutoCAD
 *   stores the centring offset in 46/47); Fit scales it to the printable area.
 */
export function plotPlacement(setup: PageSetup, options: PlotPlacementOptions = {}): PlotPlacement {
    const raster = setup.paperUnits === PlotPaperUnits.Pixels;
    const perMm = raster ? 1 : (options.unitsPerMm ?? 1);
    // Device units per paper unit.
    const m = raster ? 1 : mmPerPaperUnit(setup.paperUnits) * perMm;
    const { left, bottom, right, top } = setup.margins;
    const width = (setup.paperWidth - left - right) * perMm;
    const height = (setup.paperHeight - bottom - top) * perMm;
    const rot = setup.rotation;
    const odd = rot === 1 || rot === 3;
    // Printable area in paper units, paper orientation.
    const pw = (odd ? height : width) / m;
    const ph = (odd ? width : height) / m;

    const area = setup.area;
    const layout = area.kind === "layout";
    const bounds: PlotBounds | undefined = area.kind === "window" ? area : options.bounds;
    const needBounds = !layout || setup.scale === "fit";
    if (needBounds && !bounds) throw new Error(`plotPlacement: plot area "${area.kind}" needs bounds`);
    const aw = bounds ? bounds.max.x - bounds.min.x : 0;
    const ah = bounds ? bounds.max.y - bounds.min.y : 0;

    // Paper units per drawing unit.
    let k: number;
    if (setup.scale === "fit")
        k = aw > 0 && ah > 0 ? Math.min(pw / aw, ph / ah) : aw > 0 ? pw / aw : ah > 0 ? ph / ah : 1;
    else k = setup.scale.paper / setup.scale.drawing;

    // Paper point q = k·p + t, relative to the paper origin.
    let tx: number;
    let ty: number;
    if (layout && setup.scale !== "fit") {
        tx = setup.imageOrigin.x;
        ty = setup.imageOrigin.y;
    } else {
        tx = -k * bounds!.min.x;
        ty = -k * bounds!.min.y;
    }
    let ox = setup.offset.x * perMm;
    let oy = setup.offset.y * perMm;
    if (setup.centered && !layout) {
        tx += (pw - k * aw) / 2;
        ty += (ph - k * ah) / 2;
        ox = 0;
        oy = 0;
    }

    const s = m * k;
    const ex = m * tx;
    const ey = m * ty;
    let matrix: PlotMatrix;
    switch (rot) {
        case 1:
            matrix = [0, s, s, 0, ey + ox, ex + oy];
            break;
        case 2:
            matrix = [-s, 0, 0, s, width - ex - ox, ey + oy];
            break;
        case 3:
            matrix = [0, -s, -s, 0, width - ey - ox, height - ex - oy];
            break;
        default:
            matrix = [s, 0, 0, -s, ex + ox, height - ey - oy];
    }
    return { width, height, printableLeft: left * perMm, printableTop: top * perMm, scale: s, matrix };
}
