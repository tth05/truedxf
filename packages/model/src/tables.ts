/**
 * Symbol tables. research/notes/02-tables-objects.md §1–§2.
 */
import { fieldTable, readFields } from "./fields.ts";
import type { DxfRecord } from "./record.ts";
import { nameKey, type Point2, type Point3 } from "./types.ts";

export interface TableEntry {
    readonly type: string;
    readonly name: string;
    readonly flags: number;
    readonly handle: string;
    readonly owner: string;
    readonly record: DxfRecord;
}

/** Common entry flag: xref-dependent (16), resolved (32), referenced (64). */
export const EntryFlags = { XrefDependent: 16, XrefResolved: 32, Referenced: 64 } as const;

export interface LayerEntry extends TableEntry {
    /** Absolute ACI (the sign of group 62 only encodes on/off). */
    readonly color: number;
    readonly trueColor: number | undefined;
    readonly colorName: string | undefined;
    readonly off: boolean;
    readonly frozen: boolean;
    readonly frozenInNewViewports: boolean;
    readonly locked: boolean;
    readonly linetype: string;
    /** Group 290; AutoCAD only writes it when 0. The Defpoints layer never plots regardless. */
    readonly plot: boolean;
    /** 1/100 mm; -3 = default. */
    readonly lineweight: number;
    readonly plotStyleHandle: string | undefined;
    readonly materialHandle: string | undefined;
    /** Raw transparency from XDATA AcCmTransparency (0x020000AA); undefined = opaque. */
    readonly transparency: number | undefined;
}

export interface LinetypeElement {
    /** Dash (> 0), gap (< 0) or dot (0), in drawing units. */
    readonly length: number;
    /** 74: 1 absolute rotation, 2 text, 4 shape, 8 upright (undocumented; note 02 §2.2). */
    readonly flags: number;
    /** 75: shape number (flags & 4) or text index. */
    readonly shapeNumber: number;
    /** 340: STYLE handle (shape file or text style). */
    readonly styleHandle: string | undefined;
    readonly scale: number;
    /** Degrees (50) — the DXF reference wrongly says radians. */
    readonly rotation: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly text: string | undefined;
}

export interface LinetypeEntry extends TableEntry {
    readonly description: string;
    readonly patternLength: number;
    readonly elements: readonly LinetypeElement[];
}

export interface TextStyleEntry extends TableEntry {
    readonly fixedHeight: number;
    readonly widthFactor: number;
    /** Degrees. */
    readonly oblique: number;
    /** 2 backward, 4 upside down. */
    readonly generationFlags: number;
    readonly lastHeight: number;
    /** Primary font file (3): .shx or .ttf name. */
    readonly font: string;
    /** Big font file (4). */
    readonly bigFont: string;
    /** TTF family from XDATA "ACAD" 1000 (wins over `font` in AutoCAD 2027, note 04). */
    readonly ttfFamily: string | undefined;
    /** XDATA "ACAD" 1071 flags: bold/italic/charset/pitch. */
    readonly ttfFlags: number | undefined;
    /** Flag 1: the entry describes a shape file (for SHAPE entities / complex linetypes). */
    readonly isShapeFile: boolean;
    readonly vertical: boolean;
}

export interface BlockRecordEntry extends TableEntry {
    readonly layoutHandle: string | undefined;
    /** $INSUNITS-style code. Insert scales already contain unit conversion (note 07 §1). */
    readonly units: number;
    readonly explodable: boolean;
    readonly scaleUniformly: boolean;
}

export type DimValue = string | number | boolean;

export interface DimStyleEntry extends TableEntry {
    /**
     * Values exactly as present in the file, per group code, in order (code 70 appears twice:
     * flags, then DIMTFILLCLR). Absent codes mean AutoCAD's built-in *imperial* defaults (note 02 §2.6).
     */
    readonly values: ReadonlyMap<number, readonly DimValue[]>;
}

export interface ViewportTableEntry extends TableEntry {
    readonly lowerLeft: Point2;
    readonly upperRight: Point2;
    /** View center in DCS. */
    readonly center: Point2;
    readonly direction: Point3;
    readonly target: Point3;
    /** View height (40; not 45 as the reference claims). */
    readonly height: number;
    readonly aspectRatio: number;
    readonly lensLength: number;
    readonly twist: number;
    readonly viewMode: number;
}

export interface ViewEntry extends TableEntry {
    readonly center: Point2;
    readonly height: number;
    readonly width: number;
    readonly direction: Point3;
    readonly target: Point3;
    readonly twist: number;
}

export class Table<T extends TableEntry> {
    readonly name: string;
    readonly handle: string;
    readonly entries: T[] = [];
    private readonly byName = new Map<string, T>();

    constructor(name: string, handle: string) {
        this.name = name;
        this.handle = handle;
    }

    add(e: T): void {
        this.entries.push(e);
        const k = nameKey(e.name);
        if (!this.byName.has(k)) this.byName.set(k, e); // first wins (note 02 §4.2)
    }

    /** Case-insensitive lookup. */
    get(name: string): T | undefined {
        return this.byName.get(nameKey(name));
    }

    has(name: string): boolean {
        return this.byName.has(nameKey(name));
    }

    [Symbol.iterator](): Iterator<T> {
        return this.entries[Symbol.iterator]();
    }

    get size(): number {
        return this.entries.length;
    }
}

const Z = Object.freeze({ x: 0, y: 0, z: 1 });
const O = Object.freeze({ x: 0, y: 0, z: 0 });
const O2 = Object.freeze({ x: 0, y: 0 });

const ENTRY = fieldTable([
    { name: "name", code: 2, kind: "name", def: "" },
    { name: "flags", code: 70, kind: "int", def: 0 },
]);

function baseEntry(rec: DxfRecord): TableEntry {
    const f = readFields<{ name: string; flags: number }>(rec, ENTRY);
    return {
        type: rec.type,
        name: f.name,
        flags: f.flags,
        handle: rec.handle,
        owner: rec.owner,
        record: rec,
    };
}

const LAYER = fieldTable([
    { name: "color", code: 62, kind: "int", def: 7 },
    { name: "linetype", code: 6, kind: "name", def: "Continuous" },
    { name: "plot", code: 290, kind: "bool", def: true },
    { name: "lineweight", code: 370, kind: "int", def: -3 },
    { name: "trueColor", code: 420, kind: "int" },
    { name: "colorName", code: 430, kind: "str" },
    { name: "plotStyleHandle", code: 390, kind: "handle" },
    { name: "materialHandle", code: 347, kind: "handle" },
]);

function xdataValue(rec: DxfRecord, appId: string, code: number): number | string | undefined {
    const p = rec.xdata(appId);
    if (!p) return undefined;
    for (let i = p.start; i < p.end; i++) {
        if (rec.store.codes[i] === code)
            return code >= 1060 && code <= 1071 ? rec.store.int(i) : rec.store.str(i);
    }
    return undefined;
}

export function parseLayer(rec: DxfRecord): LayerEntry {
    const e = baseEntry(rec);
    const f = readFields<{
        color: number;
        linetype: string;
        plot: boolean;
        lineweight: number;
        trueColor?: number;
        colorName?: string;
        plotStyleHandle?: string;
        materialHandle?: string;
    }>(rec, LAYER);
    const t = xdataValue(rec, "AcCmTransparency", 1071);
    return {
        ...e,
        color: Math.abs(f.color) || 7,
        off: f.color < 0,
        frozen: (e.flags & 1) !== 0,
        frozenInNewViewports: (e.flags & 2) !== 0,
        locked: (e.flags & 4) !== 0,
        linetype: f.linetype || "Continuous",
        plot: f.plot,
        lineweight: f.lineweight,
        trueColor: f.trueColor,
        colorName: f.colorName,
        plotStyleHandle: f.plotStyleHandle,
        materialHandle: f.materialHandle,
        transparency: typeof t === "number" ? t : undefined,
    };
}

export function parseLinetype(rec: DxfRecord): LinetypeEntry {
    const e = baseEntry(rec);
    const s = rec.store;
    let description = "";
    let patternLength = 0;
    const elements: LinetypeElement[] = [];
    let cur: {
        length: number;
        flags: number;
        shapeNumber: number;
        styleHandle: string | undefined;
        scale: number;
        rotation: number;
        offsetX: number;
        offsetY: number;
        text: string | undefined;
    } | null = null;
    for (const i of rec.dataTags()) {
        const code = s.codes[i]!;
        if (code === 49) {
            if (cur) elements.push(cur);
            cur = {
                length: s.num(i) || 0,
                flags: 0,
                shapeNumber: 0,
                styleHandle: undefined,
                scale: 1,
                rotation: 0,
                offsetX: 0,
                offsetY: 0,
                text: undefined,
            };
            continue;
        }
        if (code === 3) description = s.str(i);
        else if (code === 40) patternLength = s.num(i) || 0;
        else if (cur) {
            if (code === 74) cur.flags = s.int(i) || 0;
            else if (code === 75) cur.shapeNumber = s.int(i) || 0;
            else if (code === 340) cur.styleHandle = s.handle(i);
            else if (code === 46) cur.scale = s.num(i) || 0;
            else if (code === 50) cur.rotation = s.num(i) || 0;
            else if (code === 44) cur.offsetX = s.num(i) || 0;
            else if (code === 45) cur.offsetY = s.num(i) || 0;
            else if (code === 9) cur.text = s.str(i);
        }
    }
    if (cur) elements.push(cur);
    return { ...e, description, patternLength, elements };
}

const STYLE = fieldTable([
    { name: "fixedHeight", code: 40, kind: "num", def: 0 },
    { name: "widthFactor", code: 41, kind: "num", def: 1 },
    { name: "oblique", code: 50, kind: "num", def: 0 },
    { name: "generationFlags", code: 71, kind: "int", def: 0 },
    { name: "lastHeight", code: 42, kind: "num", def: 0 },
    { name: "font", code: 3, kind: "name", def: "" },
    { name: "bigFont", code: 4, kind: "name", def: "" },
]);

export function parseTextStyle(rec: DxfRecord): TextStyleEntry {
    const e = baseEntry(rec);
    const f = readFields<{
        fixedHeight: number;
        widthFactor: number;
        oblique: number;
        generationFlags: number;
        lastHeight: number;
        font: string;
        bigFont: string;
    }>(rec, STYLE);
    const family = xdataValue(rec, "ACAD", 1000);
    const flags = xdataValue(rec, "ACAD", 1071);
    return {
        ...e,
        fixedHeight: f.fixedHeight,
        widthFactor: f.widthFactor || 1,
        oblique: f.oblique,
        generationFlags: f.generationFlags,
        lastHeight: f.lastHeight,
        font: f.font,
        bigFont: f.bigFont,
        ttfFamily: typeof family === "string" && family.trim() ? family : undefined,
        ttfFlags: typeof flags === "number" ? flags : undefined,
        isShapeFile: (e.flags & 1) !== 0,
        vertical: (e.flags & 4) !== 0,
    };
}

const BLOCK_RECORD = fieldTable([
    { name: "layoutHandle", code: 340, kind: "handle" },
    { name: "units", code: 70, kind: "int", subclass: "AcDbBlockTableRecord", def: 0 },
    { name: "explodable", code: 280, kind: "bool", def: true },
    { name: "scaleUniformly", code: 281, kind: "bool", def: false },
]);

export function parseBlockRecord(rec: DxfRecord): BlockRecordEntry {
    const e = baseEntry(rec);
    const f = readFields<{
        layoutHandle?: string;
        units: number;
        explodable: boolean;
        scaleUniformly: boolean;
    }>(rec, BLOCK_RECORD);
    return {
        ...e,
        flags: 0,
        layoutHandle: f.layoutHandle && f.layoutHandle !== "0" ? f.layoutHandle : undefined,
        units: f.units,
        explodable: f.explodable,
        scaleUniformly: f.scaleUniformly,
    };
}

export function parseDimStyle(rec: DxfRecord): DimStyleEntry {
    const e = baseEntry(rec);
    const values = new Map<number, DimValue[]>();
    const s = rec.store;
    let seenName = false;
    for (const i of rec.dataTags()) {
        const code = s.codes[i]!;
        if (code === 105 || code === 100) continue;
        if (code === 2 && !seenName) {
            seenName = true;
            continue;
        }
        const v = s.value(i);
        const dv: DimValue =
            typeof v === "bigint" ? Number(v) : v instanceof Uint8Array ? "" : (v as DimValue);
        let l = values.get(code);
        if (!l) values.set(code, (l = []));
        l.push(dv);
    }
    // first 70 = entry flags, which baseEntry already read
    const flags70 = values.get(70);
    if (flags70) flags70.shift();
    if (flags70 && flags70.length === 0) values.delete(70);
    return { ...e, values };
}

const VPORT = fieldTable([
    { name: "lowerLeft", code: 10, kind: "p2", def: O2 },
    { name: "upperRight", code: 11, kind: "p2", def: { x: 1, y: 1 } },
    { name: "center", code: 12, kind: "p2", def: O2 },
    { name: "direction", code: 16, kind: "p3", def: Z },
    { name: "target", code: 17, kind: "p3", def: O },
    { name: "height", code: 40, kind: "num", def: 1 },
    { name: "aspectRatio", code: 41, kind: "num", def: 1 },
    { name: "lensLength", code: 42, kind: "num", def: 50 },
    { name: "twist", code: 51, kind: "num", def: 0 },
    { name: "viewMode", code: 71, kind: "int", def: 0 },
]);

export function parseVport(rec: DxfRecord): ViewportTableEntry {
    return readFields<ViewportTableEntry>(rec, VPORT, { ...baseEntry(rec) } as Record<string, unknown>);
}

const VIEW = fieldTable([
    { name: "height", code: 40, kind: "num", def: 1 },
    { name: "center", code: 10, kind: "p2", def: O2 },
    { name: "width", code: 41, kind: "num", def: 1 },
    { name: "direction", code: 11, kind: "p3", def: Z },
    { name: "target", code: 12, kind: "p3", def: O },
    { name: "twist", code: 50, kind: "num", def: 0 },
]);

export function parseView(rec: DxfRecord): ViewEntry {
    return readFields<ViewEntry>(rec, VIEW, { ...baseEntry(rec) } as Record<string, unknown>);
}

export interface Tables {
    readonly layers: Table<LayerEntry>;
    readonly linetypes: Table<LinetypeEntry>;
    readonly styles: Table<TextStyleEntry>;
    readonly dimstyles: Table<DimStyleEntry>;
    readonly vports: Table<ViewportTableEntry>;
    readonly views: Table<ViewEntry>;
    readonly ucs: Table<TableEntry>;
    readonly appids: Table<TableEntry>;
    readonly blockRecords: Table<BlockRecordEntry>;
}

export const TABLE_PARSERS: Record<string, (rec: DxfRecord) => TableEntry> = {
    LAYER: parseLayer,
    LTYPE: parseLinetype,
    STYLE: parseTextStyle,
    DIMSTYLE: parseDimStyle,
    VPORT: parseVport,
    VIEW: parseView,
    UCS: baseEntry,
    APPID: baseEntry,
    BLOCK_RECORD: parseBlockRecord,
};

export function emptyTables(): Tables {
    return {
        layers: new Table("LAYER", ""),
        linetypes: new Table("LTYPE", ""),
        styles: new Table("STYLE", ""),
        dimstyles: new Table("DIMSTYLE", ""),
        vports: new Table("VPORT", ""),
        views: new Table("VIEW", ""),
        ucs: new Table("UCS", ""),
        appids: new Table("APPID", ""),
        blockRecords: new Table("BLOCK_RECORD", ""),
    };
}
