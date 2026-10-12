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
 * Standard scales (75) as [paper units, drawing units]; index 0 = scaled to fit. The imperial
 * ones (1–15) are inches per foot, i.e. paper inches per 12 drawing units (ObjectARX
 * StdScaleType; ezdxf STD_SCALES, note 08 §2.3). 33 = 1 1/2" = 1' (ObjectARX only).
 */
// biome-ignore format: data table
export const STANDARD_SCALES: readonly (readonly [number, number])[] = Object.freeze([
    [0, 0],
    [1 / 128, 12], [1 / 64, 12], [1 / 32, 12], [1 / 16, 12], [3 / 32, 12], [1 / 8, 12],
    [3 / 16, 12], [1 / 4, 12], [3 / 8, 12], [1 / 2, 12], [3 / 4, 12], [1, 12], [3, 12],
    [6, 12], [12, 12],
    [1, 1], [1, 2], [1, 4], [1, 8], [1, 10], [1, 16], [1, 20], [1, 30], [1, 40], [1, 50],
    [1, 100], [2, 1], [4, 1], [8, 1], [10, 1], [100, 1], [1000, 1],
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
    /** Physical paper size in mm, in unrotated device orientation (44/45). */
    readonly paperWidth: number;
    readonly paperHeight: number;
    /** Unprintable margins in mm (40–43), unrotated. */
    readonly margins: {
        readonly left: number;
        readonly bottom: number;
        readonly right: number;
        readonly top: number;
    };
    readonly paperUnits: PlotPaperUnits;
    /** Raw 73: 0 none, 1 = 90°, 2 = 180°, 3 = 270° (direction: Q-0706). */
    readonly rotation: 0 | 1 | 2 | 3;
    readonly area: PlotArea;
    readonly scale: PlotScale;
    /** Plot offset (46/47), always mm. Ignored when `centered`. */
    readonly offset: Point2;
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

function plotScale(s: PlotSettings): PlotScale {
    if (s.plotFlags & PlotFlags.UseStandardScale) {
        if (s.standardScaleType === 0) return "fit";
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
