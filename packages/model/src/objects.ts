/**
 * OBJECTS section. research/notes/02-tables-objects.md §3, 08-layouts-viewports-plotting.md §2.
 */
import { fieldTable, readFields } from "./fields.ts";
import type { DxfRecord } from "./record.ts";
import { nameKey, type Point2, type Point3 } from "./types.ts";

export interface DxfObject {
  /** Parsed type discriminator; "UNKNOWN" if no parser. */
  readonly type: string;
  readonly dxfType: string;
  readonly handle: string;
  readonly owner: string;
  readonly extensionDictionary: string | undefined;
  readonly record: DxfRecord;
}

export interface DictionaryEntry {
  readonly key: string;
  readonly handle: string;
  /** 350 soft owner or 360 hard owner. */
  readonly code: number;
}

export interface DictionaryObject extends DxfObject {
  readonly type: "DICTIONARY";
  /** 280: hard owner flag. */
  readonly hardOwner: boolean;
  /** 281: duplicate record cloning flag. */
  readonly cloning: number;
  readonly entries: readonly DictionaryEntry[];
  /** Default entry handle (ACDBDICTIONARYWDFLT, 340). */
  readonly defaultHandle: string | undefined;
  /** Case-insensitive lookup. */
  get(key: string): string | undefined;
}

export interface XRecordObject extends DxfObject {
  readonly type: "XRECORD";
  readonly cloning: number;
}

export interface SortEntsObject extends DxfObject {
  readonly type: "SORTENTSTABLE";
  readonly blockRecordHandle: string;
  /** [entity handle, sort handle] pairs as written. */
  readonly pairs: readonly (readonly [string, string])[];
}

/** Subset of AcDbPlotSettings needed to reproduce plots (note 08 §2.1; 48/49 & 140/141 corrected). */
export interface PlotSettings {
  readonly pageSetupName: string;
  readonly plotConfig: string;
  readonly paperSize: string;
  readonly plotViewName: string;
  /** Margins in mm: left, bottom, right, top (40–43). */
  readonly margins: readonly [number, number, number, number];
  /** Paper width/height in mm (44/45). */
  readonly paperWidth: number;
  readonly paperHeight: number;
  readonly plotOrigin: Point2;
  readonly windowMin: Point2;
  readonly windowMax: Point2;
  readonly scaleNumerator: number;
  readonly scaleDenominator: number;
  readonly plotFlags: number;
  /** 72: 0 inches, 1 mm, 2 pixels. */
  readonly paperUnits: number;
  /** 73: 0, 1 (90° ccw), 2 (180°), 3 (90° cw). */
  readonly rotation: number;
  /** 74: 0 display, 1 extents, 2 limits, 3 view, 4 window, 5 layout. */
  readonly plotType: number;
  readonly styleSheet: string;
  readonly standardScaleType: number;
  readonly shadePlotMode: number;
  readonly scaleFactor: number;
  readonly paperImageOrigin: Point2;
}

export interface LayoutObject extends DxfObject, PlotSettings {
  readonly type: "LAYOUT";
  readonly name: string;
  readonly layoutFlags: number;
  readonly tabOrder: number;
  readonly limitsMin: Point2;
  readonly limitsMax: Point2;
  readonly insertionBase: Point3;
  readonly extentsMin: Point3;
  readonly extentsMax: Point3;
  readonly elevation: number;
  /** 330 inside AcDbLayout: the layout's BLOCK_RECORD. */
  readonly blockRecordHandle: string | undefined;
  /** 331: last active viewport. */
  readonly viewportHandle: string | undefined;
}

export interface PlotSettingsObject extends DxfObject, PlotSettings {
  readonly type: "PLOTSETTINGS";
}

function base(rec: DxfRecord): DxfObject {
  return {
    type: rec.type,
    dxfType: rec.type,
    handle: rec.handle,
    owner: rec.owner,
    extensionDictionary: rec.extensionDictionary,
    record: rec,
  };
}

export function parseDictionary(rec: DxfRecord): DictionaryObject {
  const s = rec.store;
  let hardOwner = false;
  let cloning = 1;
  let defaultHandle: string | undefined;
  const entries: DictionaryEntry[] = [];
  let key: string | undefined;
  for (const i of rec.dataTags()) {
    const code = s.codes[i]!;
    if (code === 3) key = s.str(i);
    else if ((code === 350 || code === 360) && key !== undefined) {
      entries.push({ key, handle: s.handle(i), code });
      key = undefined;
    } else if (code === 280) hardOwner = s.bool(i);
    else if (code === 281) cloning = s.int(i);
    else if (code === 340) defaultHandle = s.handle(i);
  }
  const index = new Map<string, string>();
  for (const e of entries) if (!index.has(nameKey(e.key))) index.set(nameKey(e.key), e.handle);
  return {
    ...base(rec),
    type: "DICTIONARY",
    hardOwner,
    cloning,
    entries,
    defaultHandle,
    get: (k: string) => index.get(nameKey(k)),
  };
}

export function parseSortEnts(rec: DxfRecord): SortEntsObject {
  const s = rec.store;
  let blockRecordHandle = "";
  const pairs: [string, string][] = [];
  let ent: string | undefined;
  for (const p of rec.parts) {
    if (p.kind !== 1 || p.name !== "AcDbSortentsTable") continue;
    for (const i of rec.partTags(p)) {
      const code = s.codes[i]!;
      if (code === 330) blockRecordHandle = s.handle(i);
      else if (code === 331) ent = s.handle(i);
      else if (code === 5 && ent !== undefined) {
        pairs.push([ent, s.handle(i)]);
        ent = undefined;
      }
    }
  }
  return { ...base(rec), type: "SORTENTSTABLE", blockRecordHandle, pairs };
}

const O2 = Object.freeze({ x: 0, y: 0 });
const O3 = Object.freeze({ x: 0, y: 0, z: 0 });
const PS = "AcDbPlotSettings";

const PLOT_SETTINGS = [
  { name: "pageSetupName", code: 1, kind: "str", subclass: PS, def: "" },
  { name: "plotConfig", code: 2, kind: "str", subclass: PS, def: "" },
  { name: "paperSize", code: 4, kind: "str", subclass: PS, def: "" },
  { name: "plotViewName", code: 6, kind: "str", subclass: PS, def: "" },
  { name: "m0", code: 40, kind: "num", subclass: PS, def: 0 },
  { name: "m1", code: 41, kind: "num", subclass: PS, def: 0 },
  { name: "m2", code: 42, kind: "num", subclass: PS, def: 0 },
  { name: "m3", code: 43, kind: "num", subclass: PS, def: 0 },
  { name: "paperWidth", code: 44, kind: "num", subclass: PS, def: 0 },
  { name: "paperHeight", code: 45, kind: "num", subclass: PS, def: 0 },
  { name: "plotOrigin", code: 46, kind: "p2", subclass: PS, def: O2 },
  { name: "windowMin", code: 48, kind: "p2", subclass: PS, def: O2 },
  { name: "wmaxX", code: 140, kind: "num", subclass: PS, def: 0 },
  { name: "wmaxY", code: 141, kind: "num", subclass: PS, def: 0 },
  { name: "scaleNumerator", code: 142, kind: "num", subclass: PS, def: 1 },
  { name: "scaleDenominator", code: 143, kind: "num", subclass: PS, def: 1 },
  { name: "plotFlags", code: 70, kind: "int", subclass: PS, def: 0 },
  { name: "paperUnits", code: 72, kind: "int", subclass: PS, def: 0 },
  { name: "rotation", code: 73, kind: "int", subclass: PS, def: 0 },
  { name: "plotType", code: 74, kind: "int", subclass: PS, def: 5 },
  { name: "styleSheet", code: 7, kind: "str", subclass: PS, def: "" },
  { name: "standardScaleType", code: 75, kind: "int", subclass: PS, def: 0 },
  { name: "shadePlotMode", code: 76, kind: "int", subclass: PS, def: 0 },
  { name: "scaleFactor", code: 147, kind: "num", subclass: PS, def: 1 },
  { name: "paperImageOrigin", code: 148, kind: "p2", subclass: PS, def: O2 },
] as const;

const PLOT_TABLE = fieldTable(PLOT_SETTINGS);
const L = "AcDbLayout";
const LAYOUT_TABLE = fieldTable([
  ...PLOT_SETTINGS,
  { name: "name", code: 1, kind: "str", subclass: L, def: "" },
  { name: "layoutFlags", code: 70, kind: "int", subclass: L, def: 0 },
  { name: "tabOrder", code: 71, kind: "int", subclass: L, def: 0 },
  { name: "limitsMin", code: 10, kind: "p2", subclass: L, def: O2 },
  { name: "limitsMax", code: 11, kind: "p2", subclass: L, def: { x: 12, y: 9 } },
  { name: "insertionBase", code: 12, kind: "p3", subclass: L, def: O3 },
  { name: "extentsMin", code: 14, kind: "p3", subclass: L, def: O3 },
  { name: "extentsMax", code: 15, kind: "p3", subclass: L, def: O3 },
  { name: "elevation", code: 146, kind: "num", subclass: L, def: 0 },
  { name: "blockRecordHandle", code: 330, kind: "handle", subclass: L },
  { name: "viewportHandle", code: 331, kind: "handle", subclass: L },
]);

function plotSettings(f: Record<string, unknown>): PlotSettings {
  return {
    ...(f as unknown as PlotSettings),
    margins: [f.m0 as number, f.m1 as number, f.m2 as number, f.m3 as number],
    windowMax: { x: f.wmaxX as number, y: f.wmaxY as number },
  };
}

export function parseLayout(rec: DxfRecord): LayoutObject {
  const f = readFields<Record<string, unknown>>(rec, LAYOUT_TABLE);
  return { ...plotSettings(f), ...(f as object), ...base(rec), type: "LAYOUT" } as LayoutObject;
}

export function parsePlotSettings(rec: DxfRecord): PlotSettingsObject {
  const f = readFields<Record<string, unknown>>(rec, PLOT_TABLE);
  return { ...plotSettings(f), ...base(rec), type: "PLOTSETTINGS" } as PlotSettingsObject;
}

export const OBJECT_PARSERS = new Map<string, (rec: DxfRecord) => DxfObject>([
  ["DICTIONARY", parseDictionary],
  ["ACDBDICTIONARYWDFLT", (r) => ({ ...parseDictionary(r), dxfType: r.type })],
  ["XRECORD", (r) => ({ ...base(r), type: "XRECORD", cloning: r.num(280, 1) }) as XRecordObject],
  ["SORTENTSTABLE", parseSortEnts],
  ["LAYOUT", parseLayout],
  ["PLOTSETTINGS", parsePlotSettings],
]);

export function registerObject(type: string, parser: (rec: DxfRecord) => DxfObject): void {
  OBJECT_PARSERS.set(type, parser);
}

export function parseObject(rec: DxfRecord): DxfObject {
  const p = OBJECT_PARSERS.get(rec.type);
  return p ? p(rec) : { ...base(rec), type: "UNKNOWN" };
}
