// CTB (colour-dependent) and STB (named) plot style tables (note 06 §6).
//
// A table is a PIA file (pia.ts) whose text holds a header, an `aci_table` (CTB only), the
// `plot_style` list and the `custom_lineweight_table`. The typed view below keeps the parsed PIA
// tree, so nothing is dropped. Pens/styles default to "use object …" for every property a file
// leaves out.

import {
    decodePia,
    encodePia,
    formatPiaText,
    type PiaNode,
    parsePiaText,
    piaBool,
    piaNumber,
    piaString,
} from "./pia.ts";

export type PlotStyleTableKind = "ctb" | "stb";

/** Line end styles (`end_style`); 4 = use the object's (round). note 06 §6.3. */
export const PlotEndStyle = { Butt: 0, Square: 1, Round: 2, Diamond: 3, Object: 4 } as const;
export type PlotEndStyle = (typeof PlotEndStyle)[keyof typeof PlotEndStyle];

/** Line join styles (`join_style`); 5 = use the object's (round). note 06 §6.3. */
export const PlotJoinStyle = { Miter: 0, Bevel: 1, Round: 2, Diamond: 3, Object: 5 } as const;
export type PlotJoinStyle = (typeof PlotJoinStyle)[keyof typeof PlotJoinStyle];

/** `linetype` 31 = use the object's linetype; 0 = solid, 1…30 = built-in dash patterns. */
export const OBJECT_LINETYPE = 31;
/** `fill_style` 73 = use the object's fill; 64 solid … 72 vertical bars. note 06 §6.3. */
export const OBJECT_FILL_STYLE = 73;
/** `lineweight` 0 = use the object lineweight; N ≥ 1 is a 1-based table index. */
export const OBJECT_LINEWEIGHT = 0;
/** `color` value written for "use object colour" (any value whose low 24 bits are 0xFFFFFF is). */
export const OBJECT_COLOR = -1;

/** `color_policy` values that ignore the pen colour (VERIFIED-BY-ACAD, note 06 §6.3). */
const OBJECT_COLOR_POLICIES: ReadonlySet<number> = new Set([1, 6, 7]);
/** `color_policy` values that convert to grayscale. */
const GRAYSCALE_POLICIES: ReadonlySet<number> = new Set([2, 3]);

/** The 27 lineweights (mm) of AutoCAD's default `custom_lineweight_table`. note 06 §6.3. */
// biome-ignore format: data table
export const DEFAULT_PLOT_LINEWEIGHTS: readonly number[] = Object.freeze([
    0.0, 0.05, 0.09, 0.1, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.53, 0.6, 0.65,
    0.7, 0.8, 0.9, 1.0, 1.06, 1.2, 1.4, 1.58, 2.0, 2.11,
]);

export interface PlotStyle {
    readonly name: string;
    readonly localizedName: string;
    readonly description: string;
    /** Pen colour as 0xRRGGBB, undefined = use object colour (also when the policy ignores it). */
    readonly color: number | undefined;
    /** Raw `color` and `mode_color` (signed int32; `mode_color` undefined when absent). */
    readonly rawColor: number;
    readonly rawModeColor: number | undefined;
    /** Raw `color_policy`: not a clean bitfield, see `color` and `grayscale`. */
    readonly colorPolicy: number;
    /** Convert to grayscale (policies 2 and 3). */
    readonly grayscale: boolean;
    readonly physicalPen: number;
    readonly virtualPen: number;
    /** Screening (intensity) 0…100 %. */
    readonly screening: number;
    readonly linePatternSize: number;
    /** Built-in plot linetype 0…30, undefined = use object linetype. */
    readonly linetype: number | undefined;
    readonly adaptiveLinetype: boolean;
    /** Raw `lineweight`: 0 = object, N ≥ 1 = `lineweights[N − 1]`. */
    readonly lineweightIndex: number;
    /** Pen lineweight in mm (0 = thinnest), undefined = use object lineweight. */
    readonly lineweight: number | undefined;
    /** 64…72, undefined = use object fill. */
    readonly fillStyle: number | undefined;
    /** undefined = use object end style. */
    readonly endStyle: PlotEndStyle | undefined;
    /** undefined = use object join style. */
    readonly joinStyle: PlotJoinStyle | undefined;
}

export interface PlotStyleTable {
    readonly kind: PlotStyleTableKind;
    readonly description: string;
    readonly scaleFactor: number;
    readonly applyFactor: boolean;
    /** `custom_lineweight_display_units` (0 mm, 1 inch): display only, the values are mm. */
    readonly lineweightDisplayUnits: number;
    /** Lineweight table in mm (`custom_lineweight_table`). */
    readonly lineweights: readonly number[];
    /** CTB: 255 pens, index = ACI − 1. STB: named styles, "Normal" first. */
    readonly styles: readonly PlotStyle[];
    /** The parsed file, for lossless access to keys this view does not model. */
    readonly nodes: readonly PiaNode[];
}

/** The pen of a CTB for ACI 1…255, undefined for other values or STB tables. */
export function penForAci(table: PlotStyleTable, aci: number): PlotStyle | undefined {
    if (table.kind !== "ctb" || !Number.isInteger(aci) || aci < 1 || aci > 255) return undefined;
    return table.styles[aci - 1];
}

/** A named style of an STB (case-insensitive), undefined if the table has none of that name. */
export function styleByName(table: PlotStyleTable, name: string): PlotStyle | undefined {
    if (table.kind !== "stb") return undefined;
    const key = name.toUpperCase();
    return table.styles.find((s) => s.name.toUpperCase() === key);
}

/**
 * Decodes a pen colour value. Only the low 24 bits count, as RGB; the high byte (0xC2, 0xC3, 0xFF
 * …) is ignored, so 0xC300001E is RGB 00001E, not ACI 30. Low bits 0xFFFFFF = use object colour,
 * hence a pen cannot force pure white (VERIFIED-BY-ACAD, note 06 §6.3).
 */
export function decodePlotStyleColor(raw: number): number | undefined {
    const rgb = raw & 0xffffff;
    return rgb === 0xffffff ? undefined : rgb;
}

/** The signed int32 a CTB stores for an explicit colour (the form monochrome.ctb uses). */
export function encodePlotStyleColor(rgb: number): number {
    return 0xff000000 | (rgb & 0xffffff) | 0;
}

function children(node: PiaNode | undefined): readonly PiaNode[] {
    return node?.children ?? [];
}

function get(nodes: readonly PiaNode[], key: string): string | undefined {
    return nodes.find((n) => n.key === key && !n.children)?.value;
}

function readStyle(nodes: readonly PiaNode[], lineweights: readonly number[]): PlotStyle {
    const rawColor = piaNumber(get(nodes, "color"), OBJECT_COLOR) | 0;
    const modeText = get(nodes, "mode_color");
    const rawModeColor = modeText === undefined ? undefined : piaNumber(modeText, OBJECT_COLOR) | 0;
    const policy = piaNumber(get(nodes, "color_policy"), 1);
    const lineweightIndex = piaNumber(get(nodes, "lineweight"), OBJECT_LINEWEIGHT);
    const linetype = piaNumber(get(nodes, "linetype"), OBJECT_LINETYPE);
    const fill = piaNumber(get(nodes, "fill_style"), OBJECT_FILL_STYLE);
    const end = piaNumber(get(nodes, "end_style"), PlotEndStyle.Object);
    const join = piaNumber(get(nodes, "join_style"), PlotJoinStyle.Object);
    const name = piaString(get(nodes, "name"));
    // mode_color wins unless absent or −1 (the Autodesk-*.stb files carry both).
    const value = rawModeColor === undefined || rawModeColor === -1 ? rawColor : rawModeColor;
    return {
        name,
        localizedName:
            get(nodes, "localized_name") === undefined ? name : piaString(get(nodes, "localized_name")),
        description: piaString(get(nodes, "description")),
        color: OBJECT_COLOR_POLICIES.has(policy) ? undefined : decodePlotStyleColor(value),
        rawColor,
        rawModeColor,
        colorPolicy: policy,
        grayscale: GRAYSCALE_POLICIES.has(policy),
        physicalPen: piaNumber(get(nodes, "physical_pen_number"), 0),
        virtualPen: piaNumber(get(nodes, "virtual_pen_number"), 0),
        screening: piaNumber(get(nodes, "screen"), 100),
        linePatternSize: piaNumber(get(nodes, "linepattern_size"), 0.5),
        linetype: linetype >= 0 && linetype < OBJECT_LINETYPE ? linetype : undefined,
        adaptiveLinetype: piaBool(get(nodes, "adaptive_linetype"), true),
        lineweightIndex,
        // 1-based; 0 and indices past the table end (e.g. 255) = object (note 06 §6.3, `lw-index`).
        lineweight:
            lineweightIndex >= 1 && lineweightIndex <= lineweights.length
                ? lineweights[lineweightIndex - 1]
                : undefined,
        fillStyle: fill >= 64 && fill < OBJECT_FILL_STYLE ? fill : undefined,
        endStyle: end >= 0 && end < PlotEndStyle.Object ? (end as PlotEndStyle) : undefined,
        joinStyle: join >= 0 && join <= PlotJoinStyle.Diamond ? (join as PlotJoinStyle) : undefined,
    };
}

/** Builds the typed view of parsed CTB/STB text. */
export function plotStyleTableFromNodes(nodes: readonly PiaNode[], kind: PlotStyleTableKind): PlotStyleTable {
    const lwNodes = children(nodes.find((n) => n.key === "custom_lineweight_table"));
    const lineweights: number[] = [];
    for (const n of lwNodes) {
        const i = Number.parseInt(n.key, 10);
        if (Number.isInteger(i) && i >= 0) lineweights[i] = piaNumber(n.value, 0);
    }
    const table = lwNodes.length > 0 ? Array.from(lineweights, (mm) => mm ?? 0) : DEFAULT_PLOT_LINEWEIGHTS;
    const styleNodes = children(nodes.find((n) => n.key === "plot_style")).filter((n) => n.children);
    // Entries are keyed 0, 1, 2 …; order by key so a CTB pen index is always ACI − 1.
    const ordered = [...styleNodes].sort((a, b) => Number(a.key) - Number(b.key));
    return {
        kind,
        description: piaString(get(nodes, "description")),
        scaleFactor: piaNumber(get(nodes, "scale_factor"), 1),
        applyFactor: piaBool(get(nodes, "apply_factor"), false),
        lineweightDisplayUnits: piaNumber(get(nodes, "custom_lineweight_display_units"), 0),
        lineweights: table,
        styles: ordered.map((n) => readStyle(n.children!, table)),
        nodes,
    };
}

/** Reads a .ctb/.stb file. The kind comes from the PIA header (CTBVER1 / STBVER1). */
export function readPlotStyleTable(bytes: Uint8Array): PlotStyleTable {
    const { type, text } = decodePia(bytes);
    const kind = type.toLowerCase();
    if (kind !== "ctb" && kind !== "stb") throw new Error(`not a plot style table (PIA type ${type})`);
    return plotStyleTableFromNodes(parsePiaText(text), kind);
}

/** Writes a table back to a .ctb/.stb file (round-trips `nodes`). */
export function writePlotStyleTable(table: PlotStyleTable): Uint8Array {
    return encodePia(table.kind.toUpperCase(), formatPiaText(table.nodes));
}

/** Overrides for one pen when building a table; omitted properties use the object's. */
export interface PenSpec {
    /** Explicit pen colour (not 0xFFFFFF, which means "object"). */
    readonly color?: number;
    /** 1-based index into the lineweight table. */
    readonly lineweightIndex?: number;
    readonly screening?: number;
    readonly grayscale?: boolean;
    readonly linetype?: number;
    /** Adaptive pen linetype (default true, like AutoCAD's new pens). */
    readonly adaptiveLinetype?: boolean;
    readonly endStyle?: PlotEndStyle;
    readonly joinStyle?: PlotJoinStyle;
    readonly fillStyle?: number;
}

const val = (key: string, value: string | number): PiaNode => ({ key, value: String(value) });

// The policies the stock tables use: 1 object, 3 grayscale, 5 explicit colour, 2 colour + grayscale.
function policyFor(spec: PenSpec): number {
    if (spec.color === undefined) return spec.grayscale ? 3 : 1;
    return spec.grayscale ? 2 : 5;
}

function penNodes(index: number, name: string, spec: PenSpec): PiaNode {
    return {
        key: String(index),
        children: [
            val("name", `"${name}`),
            val("localized_name", `"${name}`),
            val("description", '"'),
            val("color", spec.color === undefined ? OBJECT_COLOR : encodePlotStyleColor(spec.color)),
            val("color_policy", policyFor(spec)),
            val("physical_pen_number", 0),
            val("virtual_pen_number", 0),
            val("screen", spec.screening ?? 100),
            val("linepattern_size", "0.5"),
            val("linetype", spec.linetype ?? OBJECT_LINETYPE),
            val("adaptive_linetype", spec.adaptiveLinetype === false ? "FALSE" : "TRUE"),
            val("lineweight", spec.lineweightIndex ?? OBJECT_LINEWEIGHT),
            val("fill_style", spec.fillStyle ?? OBJECT_FILL_STYLE),
            val("end_style", spec.endStyle ?? PlotEndStyle.Object),
            val("join_style", spec.joinStyle ?? PlotJoinStyle.Object),
        ],
    };
}

function tableNodes(
    kind: PlotStyleTableKind,
    description: string,
    styles: PiaNode[],
    aciNames?: string[],
): PiaNode[] {
    const lw = DEFAULT_PLOT_LINEWEIGHTS.map((mm, i) => val(String(i), mm.toFixed(2)));
    return [
        val("description", `"${description}`),
        val("aci_table_available", kind === "ctb" ? "TRUE" : "FALSE"),
        val("scale_factor", "1.0"),
        val("apply_factor", "FALSE"),
        val("custom_lineweight_display_units", 0),
        ...(aciNames
            ? [{ key: "aci_table", children: aciNames.map((n, i) => val(String(i), `"${n}`)) }]
            : []),
        { key: "plot_style", children: styles },
        { key: "custom_lineweight_table", children: lw },
    ];
}

/** A CTB whose pen for ACI n is `pen(n)` (n = 1…255). */
export function buildColorTable(
    description: string,
    pen: (aci: number) => PenSpec = () => ({}),
): PlotStyleTable {
    const names = Array.from({ length: 255 }, (_, i) => `Color_${i + 1}`);
    const styles = names.map((n, i) => penNodes(i, n, pen(i + 1)));
    return plotStyleTableFromNodes(tableNodes("ctb", description, styles, names), "ctb");
}

/** An STB with "Normal" (all object) first, then the given named styles. */
export function buildNamedTable(
    description: string,
    styles: Readonly<Record<string, PenSpec>> = {},
): PlotStyleTable {
    const entries = [["Normal", {}] as const, ...Object.entries(styles)];
    const nodes = entries.map(([name, spec], i) => penNodes(i, name, spec));
    return plotStyleTableFromNodes(tableNodes("stb", description, nodes), "stb");
}

/**
 * Behavioural equivalents of the stock tables, which we cannot ship (pen values from note 06
 * §6.3): acad.ctb and "Screening 100%.ctb" use the object for everything, monochrome.ctb has
 * black pens, Grayscale.ctb policy 3, "Screening n%.ctb" screen n, "Fill Patterns.ctb" fill
 * styles 64…72 on pens 1…9.
 */
export const ACAD_CTB: PlotStyleTable = buildColorTable("acad.ctb equivalent");
export const MONOCHROME_CTB: PlotStyleTable = buildColorTable("monochrome.ctb equivalent", () => ({
    color: 0,
}));
export const GRAYSCALE_CTB: PlotStyleTable = buildColorTable("Grayscale.ctb equivalent", () => ({
    grayscale: true,
}));

const BUILTIN = new Map<string, () => PlotStyleTable>([
    ["acad.ctb", () => ACAD_CTB],
    ["monochrome.ctb", () => MONOCHROME_CTB],
    ["grayscale.ctb", () => GRAYSCALE_CTB],
    ["screening 100%.ctb", () => ACAD_CTB],
    ...[25, 50, 75].map(
        (s) =>
            [
                `screening ${s}%.ctb`,
                () => buildColorTable(`Screening ${s}%.ctb equivalent`, () => ({ screening: s })),
            ] as const,
    ),
    [
        "fill patterns.ctb",
        () =>
            buildColorTable("Fill Patterns.ctb equivalent", (aci) =>
                aci <= 9 ? { fillStyle: 63 + aci } : {},
            ),
    ],
]);

/** Built-in equivalent of a stock table by file name (case-insensitive), if there is one. */
export function builtinPlotStyleTable(fileName: string): PlotStyleTable | undefined {
    return BUILTIN.get(fileName.toLowerCase())?.();
}

/** Grayscale = ⌊0.299 R⌋ + ⌊0.587 G⌋ + ⌊0.114 B⌋, each term floored (VERIFIED-BY-ACAD, note 06 §6.3). */
export function grayscaleRgb(rgb: number): number {
    const g =
        Math.floor(0.299 * ((rgb >> 16) & 255)) +
        Math.floor(0.587 * ((rgb >> 8) & 255)) +
        Math.floor(0.114 * (rgb & 255));
    return (g << 16) | (g << 8) | g;
}

/** Screening s %: c' = 255 − ⌊(255 − c)·s/100⌋ per channel (VERIFIED-BY-ACAD, note 06 §6.3). */
export function screenRgb(rgb: number, screening: number): number {
    if (screening >= 100) return rgb;
    const s = Math.max(0, screening);
    const ch = (c: number) => 255 - Math.floor(((255 - c) * s) / 100);
    return (ch((rgb >> 16) & 255) << 16) | (ch((rgb >> 8) & 255) << 8) | ch(rgb & 255);
}

/** An object's resolved plot properties before the pen is applied. */
export interface ObjectPen {
    /** Plotted RGB (ACI already mapped through the plot palette). */
    readonly rgb: number;
    /**
     * Resolved ACI 1…255, or undefined for a true colour (which gets no pen). Colour-book
     * colours (430 + 420) are true colours here; 430 without 420 is dropped and the 62 counts
     * (VERIFIED-BY-ACAD, note 06 §6.4).
     */
    readonly aci: number | undefined;
    /** Resolved lineweight in mm (Default already replaced by LWDEFAULT). */
    readonly lineweight: number;
}

export interface PlottedPen {
    readonly rgb: number;
    /** mm; 0 = thinnest line. */
    readonly lineweight: number;
    readonly endStyle: PlotEndStyle | undefined;
    readonly joinStyle: PlotJoinStyle | undefined;
    /** 65–72: raster fill tile (`fillStyleInk`), only for area fills; undefined = solid. */
    readonly fillStyle: number | undefined;
    /** Pen linetype 0–30 (`penLinetypeDashes`), undefined = the object linetype. */
    readonly linetype: number | undefined;
    readonly adaptiveLinetype: boolean;
}

/**
 * Applies a pen (note 06 §6.5): colour (or the object's), grayscale, then screening; the pen
 * lineweight or the object's. `style` undefined = no table, plot styles off, or a true-colour
 * object, all of which plot with object properties. Plot-lineweights off and scale-lineweights
 * are page-setup switches the caller applies afterwards.
 */
export function applyPlotStyle(style: PlotStyle | undefined, object: ObjectPen): PlottedPen {
    if (!style)
        return {
            rgb: object.rgb,
            lineweight: object.lineweight,
            endStyle: undefined,
            joinStyle: undefined,
            fillStyle: undefined,
            linetype: undefined,
            adaptiveLinetype: false,
        };
    let rgb = style.color ?? object.rgb;
    if (style.grayscale) rgb = grayscaleRgb(rgb);
    rgb = screenRgb(rgb, style.screening);
    return {
        rgb,
        lineweight: style.lineweight ?? object.lineweight,
        endStyle: style.endStyle,
        joinStyle: style.joinStyle,
        fillStyle: style.fillStyle === 64 ? undefined : style.fillStyle,
        linetype: style.linetype,
        adaptiveLinetype: style.adaptiveLinetype,
    };
}

/** The CTB pen for an object: its resolved ACI; true colours (aci undefined) get none (note 06 §6.4). */
export function penForObject(table: PlotStyleTable | undefined, object: ObjectPen): PlotStyle | undefined {
    if (!table || object.aci === undefined) return undefined;
    return penForAci(table, object.aci);
}
