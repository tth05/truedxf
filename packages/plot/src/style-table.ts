// CTB (colour-dependent) and STB (named) plot style tables (note 06 §6).
//
// A table is a PIA file (pia.ts) whose text holds a header, an `aci_table` (CTB only), the
// `plot_style` list and the `custom_lineweight_table`. The typed view below keeps the parsed PIA
// tree, so nothing is dropped. Pens/styles default to "use object …" for every property a file
// leaves out.

import { aciToRgb } from "@truedxf/model";
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

/** Line end styles (`end_style`); 4 = use the object's style. note 06 §6.3. */
export const PlotEndStyle = { Butt: 0, Square: 1, Round: 2, Diamond: 3, Object: 4 } as const;
export type PlotEndStyle = (typeof PlotEndStyle)[keyof typeof PlotEndStyle];

/** Line join styles (`join_style`); 5 = use the object's style. note 06 §6.3. */
export const PlotJoinStyle = { Miter: 0, Bevel: 1, Round: 2, Diamond: 3, Object: 5 } as const;
export type PlotJoinStyle = (typeof PlotJoinStyle)[keyof typeof PlotJoinStyle];

/** `linetype` 31 = use the object's linetype; 0…30 are the built-in plot linetypes. */
export const OBJECT_LINETYPE = 31;
/** `fill_style` 73 = use the object's fill; 64…72 are solid, checkerboard, … vertical bars. */
export const OBJECT_FILL_STYLE = 73;

/**
 * `lineweight` values that mean "use object lineweight". ezdxf writes 0 (an index into the
 * lineweight table whose entry 0 is 0.00 mm); AutoCAD's pen tables are widely reported to use 255.
 * CONFLICT (note 06 §6.3): until verified both count as "object", and any other index outside the
 * table does too.
 */
export const OBJECT_LINEWEIGHTS: ReadonlySet<number> = new Set([0, 255]);

/** `color` value meaning "use object colour". */
export const OBJECT_COLOR = -1;

// AcCmColor method bytes in the top 8 bits of a colour value (note 02 raw colours).
const BY_COLOR = 0xc2;
const BY_ACI = 0xc3;

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
    /** Pen colour as 0xRRGGBB, undefined = use object colour. */
    readonly color: number | undefined;
    /** Raw `color` and `mode_color` values (signed int32 AcCmColor). */
    readonly rawColor: number;
    readonly rawModeColor: number;
    /** `color_policy` bit 1. */
    readonly dither: boolean;
    /** `color_policy` bit 2: convert to grayscale. */
    readonly grayscale: boolean;
    readonly physicalPen: number;
    readonly virtualPen: number;
    /** Screening (intensity) 0…100 %. */
    readonly screening: number;
    readonly linePatternSize: number;
    /** Built-in plot linetype 0…30, undefined = use object linetype. */
    readonly linetype: number | undefined;
    readonly adaptiveLinetype: boolean;
    /** Raw `lineweight` (an index into the table's lineweights). */
    readonly lineweightIndex: number;
    /** Pen lineweight in mm, undefined = use object lineweight. */
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
    /** `custom_lineweight_display_units`: display only, the table values are always mm. */
    readonly lineweightDisplayUnits: number;
    /** Lineweight table in mm, indexed by `PlotStyle.lineweightIndex`. */
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
 * Decodes a plot style colour value. -1 = object; method 0xC2 = true colour in the low 24 bits;
 * 0xC3 = ACI in the low 24 bits (0xC3FFFFFF is ezdxf's second "object" marker).
 */
export function decodePlotStyleColor(raw: number): number | undefined {
    const u = raw >>> 0;
    const method = u >>> 24;
    if (method === BY_COLOR) return u & 0xffffff;
    if (method === BY_ACI) {
        const aci = u & 0xffffff;
        return aci >= 1 && aci <= 255 ? aciToRgb(aci) : undefined;
    }
    return undefined;
}

/** The signed int32 a CTB stores for a true colour. */
export function encodePlotStyleColor(rgb: number): number {
    return (BY_COLOR << 24) | (rgb & 0xffffff) | 0;
}

function children(node: PiaNode | undefined): readonly PiaNode[] {
    return node?.children ?? [];
}

function get(nodes: readonly PiaNode[], key: string): string | undefined {
    return nodes.find((n) => n.key === key && !n.children)?.value;
}

function readStyle(nodes: readonly PiaNode[], lineweights: readonly number[]): PlotStyle {
    const rawColor = piaNumber(get(nodes, "color"), OBJECT_COLOR) | 0;
    const policy = piaNumber(get(nodes, "color_policy"), 1);
    const lineweightIndex = piaNumber(get(nodes, "lineweight"), 255);
    const linetype = piaNumber(get(nodes, "linetype"), OBJECT_LINETYPE);
    const fill = piaNumber(get(nodes, "fill_style"), OBJECT_FILL_STYLE);
    const end = piaNumber(get(nodes, "end_style"), PlotEndStyle.Object);
    const join = piaNumber(get(nodes, "join_style"), PlotJoinStyle.Object);
    const name = piaString(get(nodes, "name"));
    return {
        name,
        localizedName:
            get(nodes, "localized_name") === undefined ? name : piaString(get(nodes, "localized_name")),
        description: piaString(get(nodes, "description")),
        color: decodePlotStyleColor(rawColor),
        rawColor,
        rawModeColor: piaNumber(get(nodes, "mode_color"), rawColor) | 0,
        dither: (policy & 1) !== 0,
        grayscale: (policy & 2) !== 0,
        physicalPen: piaNumber(get(nodes, "physical_pen_number"), 0),
        virtualPen: piaNumber(get(nodes, "virtual_pen_number"), 0),
        screening: piaNumber(get(nodes, "screen"), 100),
        linePatternSize: piaNumber(get(nodes, "linepattern_size"), 0.5),
        linetype: linetype >= 0 && linetype < OBJECT_LINETYPE ? linetype : undefined,
        adaptiveLinetype: piaBool(get(nodes, "adaptive_linetype"), true),
        lineweightIndex,
        lineweight:
            OBJECT_LINEWEIGHTS.has(lineweightIndex) || !(lineweightIndex in lineweights)
                ? undefined
                : lineweights[lineweightIndex],
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
    const table = lwNodes.length > 0 ? lineweights : DEFAULT_PLOT_LINEWEIGHTS;
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
    readonly color?: number;
    readonly lineweightIndex?: number;
    readonly screening?: number;
    readonly grayscale?: boolean;
    readonly linetype?: number;
    readonly endStyle?: PlotEndStyle;
    readonly joinStyle?: PlotJoinStyle;
    readonly fillStyle?: number;
}

const val = (key: string, value: string | number): PiaNode => ({ key, value: String(value) });

function penNodes(index: number, name: string, spec: PenSpec): PiaNode {
    const color = spec.color === undefined ? OBJECT_COLOR : encodePlotStyleColor(spec.color);
    return {
        key: String(index),
        children: [
            val("name", `"${name}`),
            val("localized_name", `"${name}`),
            val("description", '"'),
            val("color", color),
            val("mode_color", color),
            val("color_policy", 1 | (spec.grayscale ? 2 : 0)),
            val("physical_pen_number", 0),
            val("virtual_pen_number", 0),
            val("screen", spec.screening ?? 100),
            val("linepattern_size", "0.5"),
            val("linetype", spec.linetype ?? OBJECT_LINETYPE),
            val("adaptive_linetype", "TRUE"),
            val("lineweight", spec.lineweightIndex ?? 255),
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
 * Behavioural equivalents of the standard tables (we cannot ship Autodesk's files): acad.ctb uses
 * the object's properties for every pen; monochrome.ctb plots every pen black (true colours are an
 * exception the caller handles, note 08 §10.7).
 */
export const ACAD_CTB: PlotStyleTable = buildColorTable("acad.ctb equivalent");
export const MONOCHROME_CTB: PlotStyleTable = buildColorTable("monochrome.ctb equivalent", () => ({
    color: 0,
}));

const BUILTIN = new Map<string, PlotStyleTable>([
    ["acad.ctb", ACAD_CTB],
    ["monochrome.ctb", MONOCHROME_CTB],
]);

/** Built-in equivalent of a standard table by file name (case-insensitive), if there is one. */
export function builtinPlotStyleTable(fileName: string): PlotStyleTable | undefined {
    return BUILTIN.get(fileName.toLowerCase());
}
