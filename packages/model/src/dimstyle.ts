/**
 * DIMSTYLE variables: group code ↔ `$DIM*` name, value kind and AutoCAD's built-in **imperial**
 * defaults, plus the effective-value resolution used for DIMENSION / LEADER / TOLERANCE.
 *
 * research/notes/02-tables-objects.md §2.6 and 05-dimensions-leaders.md §2–§3:
 * - AutoCAD writes a DIMSTYLE code only when it differs from the imperial initial value, so an
 *   absent code means that default — **not** ezdxf's metric defaults and **not** the header `$DIM*`
 *   value (VERIFIED-BY-ACAD, S1 sample).
 * - Priority: XDATA `ACAD {DSTYLE}` override on the entity > DIMSTYLE record > imperial default.
 * - The same group code is used in the DIMSTYLE record, in the DSTYLE XDATA list and (as `$NAME`)
 *   in the header. The header holds the *current* style for new dimensions only; references to
 *   blocks/text styles/linetypes are names there but handles in the record (note 05 §2.1).
 */
import type { Header, HeaderValue } from "./header.ts";
import type { DxfRecord } from "./record.ts";
import type { DimStyleEntry, DimValue } from "./tables.ts";
import { type TypedTag, tagNum, xdataList, xdataTags } from "./tags.ts";

/** real, int, bool (0/1 → boolean), str, handle (table/block-record handle string), aci, lineweight. */
export type DimVarKind = "real" | "int" | "bool" | "str" | "handle" | "aci" | "lw";

export interface DimVarDef {
    /** Variable name without `$`, e.g. "DIMASZ". */
    readonly name: string;
    readonly code: number;
    readonly kind: DimVarKind;
    /** AutoCAD built-in imperial default (value assumed when the code is absent). */
    readonly def: DimValue;
    /** Header variable holding the same value as a *name* instead of a handle (e.g. $DIMBLK). */
    readonly headerName?: string;
}

const d = (name: string, code: number, kind: DimVarKind, def: DimValue, headerName?: string): DimVarDef =>
    headerName ? { name, code, kind, def, headerName } : { name, code, kind, def };

/**
 * All DIMSTYLE variables in group-code order. Handle-valued variables (340–347) have the header
 * name of the equivalent name-valued header variable.
 */
export const DIM_VARS: readonly DimVarDef[] = [
    d("DIMPOST", 3, "str", ""),
    d("DIMAPOST", 4, "str", ""),
    // R12 arrow block *names*; R2000+ uses the 342–344 handles
    d("DIMBLK_NAME", 5, "str", ""),
    d("DIMBLK1_NAME", 6, "str", ""),
    d("DIMBLK2_NAME", 7, "str", ""),
    d("DIMSCALE", 40, "real", 1),
    d("DIMASZ", 41, "real", 0.18),
    d("DIMEXO", 42, "real", 0.0625),
    d("DIMDLI", 43, "real", 0.38),
    d("DIMEXE", 44, "real", 0.18),
    d("DIMRND", 45, "real", 0),
    d("DIMDLE", 46, "real", 0),
    d("DIMTP", 47, "real", 0),
    d("DIMTM", 48, "real", 0),
    d("DIMFXL", 49, "real", 1),
    // degrees in DIMSTYLE records (corpus: 45/90 in 237 records, radian-like values in 6), while the
    // header `$DIMJOGANG` is in radians and converted by headerDimValue (note 05 §2.2)
    d("DIMJOGANG", 50, "real", 45),
    d("DIMTFILL", 69, "int", 0),
    // the *second* 70 of the record (the first is the table-entry flags)
    d("DIMTFILLCLR", 70, "aci", 0),
    d("DIMTOL", 71, "bool", false),
    d("DIMLIM", 72, "bool", false),
    d("DIMTIH", 73, "bool", true),
    d("DIMTOH", 74, "bool", true),
    d("DIMSE1", 75, "bool", false),
    d("DIMSE2", 76, "bool", false),
    d("DIMTAD", 77, "int", 0),
    d("DIMZIN", 78, "int", 0),
    d("DIMAZIN", 79, "int", 0),
    d("DIMARCSYM", 90, "int", 0),
    d("DIMTXT", 140, "real", 0.18),
    d("DIMCEN", 141, "real", 0.09),
    d("DIMTSZ", 142, "real", 0),
    d("DIMALTF", 143, "real", 25.4),
    d("DIMLFAC", 144, "real", 1),
    d("DIMTVP", 145, "real", 0),
    d("DIMTFAC", 146, "real", 1),
    d("DIMGAP", 147, "real", 0.09),
    d("DIMALTRND", 148, "real", 0),
    d("DIMALT", 170, "bool", false),
    d("DIMALTD", 171, "int", 2),
    d("DIMTOFL", 172, "bool", false),
    d("DIMSAH", 173, "bool", false),
    d("DIMTIX", 174, "bool", false),
    d("DIMSOXD", 175, "bool", false),
    d("DIMCLRD", 176, "aci", 0),
    d("DIMCLRE", 177, "aci", 0),
    d("DIMCLRT", 178, "aci", 0),
    d("DIMADEC", 179, "int", 0),
    d("DIMUNIT", 270, "int", 2),
    d("DIMDEC", 271, "int", 4),
    d("DIMTDEC", 272, "int", 4),
    d("DIMALTU", 273, "int", 2),
    d("DIMALTTD", 274, "int", 2),
    d("DIMAUNIT", 275, "int", 0),
    d("DIMFRAC", 276, "int", 0),
    d("DIMLUNIT", 277, "int", 2),
    d("DIMDSEP", 278, "int", 46),
    d("DIMTMOVE", 279, "int", 0),
    d("DIMJUST", 280, "int", 0),
    d("DIMSD1", 281, "bool", false),
    d("DIMSD2", 282, "bool", false),
    d("DIMTOLJ", 283, "int", 1),
    d("DIMTZIN", 284, "int", 0),
    d("DIMALTZ", 285, "int", 0),
    d("DIMALTTZ", 286, "int", 0),
    d("DIMFIT", 287, "int", 3),
    d("DIMUPT", 288, "bool", false),
    d("DIMATFIT", 289, "int", 3),
    d("DIMFXLON", 290, "bool", false),
    d("DIMTXTDIRECTION", 294, "bool", false),
    d("DIMTXSTY", 340, "handle", "", "DIMTXSTY"),
    d("DIMLDRBLK", 341, "handle", "", "DIMLDRBLK"),
    d("DIMBLK", 342, "handle", "", "DIMBLK"),
    d("DIMBLK1", 343, "handle", "", "DIMBLK1"),
    d("DIMBLK2", 344, "handle", "", "DIMBLK2"),
    d("DIMLTYPE", 345, "handle", "", "DIMLTYPE"),
    d("DIMLTEX1", 346, "handle", "", "DIMLTEX1"),
    d("DIMLTEX2", 347, "handle", "", "DIMLTEX2"),
    d("DIMLWD", 371, "lw", -2),
    d("DIMLWE", 372, "lw", -2),
    // not representable as record codes: stored in DIMSTYLE XDATA groups ACAD_DSTYLE_* (note 02 §2.6)
    d("DIMJAG", 388, "real", 1.5),
    d("DIMBREAK", 391, "real", 0.125),
    d("DIMTOLALIGN", 392, "bool", false),
];

/**
 * DIMSTYLE XDATA extension codes (`1001 ACAD_DSTYLE_*`, `1070 <code>`, value) → record code.
 * R2000/R2004 store the dimension linetypes and fixed extension line length there (note 02 §2.6,
 * note 05 §1.2).
 */
const XDATA_CODE_ALIASES: ReadonlyMap<number, number> = new Map([
    [380, 345], // ACAD_DSTYLE_DIM_LINETYPE → DIMLTYPE
    [381, 346], // ACAD_DSTYLE_DIM_EXT1_LINETYPE → DIMLTEX1
    [382, 347], // ACAD_DSTYLE_DIM_EXT2_LINETYPE → DIMLTEX2
    [383, 290], // ACAD_DSTYLE_DIMEXT_ENABLED → DIMFXLON
    [378, 49], // ACAD_DSTYLE_DIMEXT_LENGTH → DIMFXL
    [388, 388],
    [391, 391],
    [392, 392],
]);

export const DIM_VAR_BY_CODE: ReadonlyMap<number, DimVarDef> = new Map(DIM_VARS.map((v) => [v.code, v]));
export const DIM_VAR_BY_NAME: ReadonlyMap<string, DimVarDef> = new Map(DIM_VARS.map((v) => [v.name, v]));

/** Name → value for every DIMSTYLE variable. */
export type DimVars = Readonly<Record<string, DimValue>>;

/** Normalizes a raw value to the variable's kind (bool → boolean, numbers finite, handles as-is). */
export function normalizeDimValue(v: DimVarDef, raw: unknown): DimValue {
    switch (v.kind) {
        case "bool":
            if (typeof raw === "boolean") return raw;
            return toNum(raw) !== 0;
        case "str":
        case "handle":
            return typeof raw === "string" ? raw : raw === undefined ? "" : String(raw);
        case "int":
        case "aci":
        case "lw":
            return Math.trunc(toNum(raw));
        default:
            return toNum(raw);
    }
}

function toNum(raw: unknown): number {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
    if (typeof raw === "boolean") return raw ? 1 : 0;
    if (typeof raw === "bigint") return Number(raw);
    if (typeof raw === "string") {
        const n = Number(raw.trim());
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

/** AutoCAD's built-in imperial defaults for all variables. */
export function imperialDimDefaults(): Record<string, DimValue> {
    const out: Record<string, DimValue> = {};
    for (const v of DIM_VARS) out[v.name] = v.def;
    return out;
}

/** Values present in a DIMSTYLE record (code → first value; 70 is already DIMTFILLCLR). */
export function dimStyleValues(entry: DimStyleEntry): Map<number, DimValue> {
    const out = new Map<number, DimValue>();
    // XDATA extensions first, so that native record codes (R2007+ 345–347 …) win
    for (const app of entry.record.xdataAppIds) {
        if (!app.toUpperCase().startsWith("ACAD_DSTYLE_")) continue;
        const tags = xdataTags(entry.record, app);
        for (let k = 0; k + 1 < tags.length; k++) {
            if (tags[k]!.code !== 1070) continue;
            const code = XDATA_CODE_ALIASES.get(tagNum(tags[k]));
            if (code === undefined) continue;
            out.set(code, overrideValue(tags[++k]!));
        }
    }
    for (const [code, list] of entry.values) if (list.length > 0) out.set(code, list[0]!);
    return out;
}

/**
 * DSTYLE overrides of an entity (XDATA `ACAD` → `1000 DSTYLE`, `1002 {`, pairs of `1070 code` +
 * typed value, `1002 }`), note 05 §3. Invalid pairs are ignored (like AutoCAD). Handle 0 for the
 * arrow blocks means "closed filled" and is kept as "0".
 */
export function readDimStyleOverrides(rec: DxfRecord): Map<number, DimValue> {
    const out = new Map<number, DimValue>();
    const list = xdataList(xdataTags(rec, "ACAD"), "DSTYLE");
    if (!list) return out;
    for (let k = 0; k + 1 < list.length; k++) {
        const key = list[k]!;
        if (key.code !== 1070) continue;
        const val = list[k + 1]!;
        if (val.code === 1002) continue;
        k++;
        out.set(tagNum(key), overrideValue(val));
    }
    return out;
}

function overrideValue(t: TypedTag): DimValue {
    const v = t.value;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "bigint") return Number(v);
    return "";
}

export interface EffectiveDimStyleOptions {
    /**
     * Fallback used for codes absent from the DIMSTYLE record. Default "imperial" (AutoCAD's rule).
     * "header" back-fills from `$DIM*` header variables first (LibreCAD behaviour, **not** AutoCAD's,
     * note 05 §2.1 CONFLICT) — only useful for writing new dimensions with the current settings.
     */
    readonly fallback?: "imperial" | "header";
    readonly header?: Header;
}

/**
 * Effective DIMSTYLE variables (name → value) for an entity: DSTYLE `overrides` (code → value) >
 * values present in `entry` > AutoCAD imperial defaults. `entry` may be undefined (dimstyle name
 * not found → defaults, like AutoCAD falling back to built-in values).
 */
export function effectiveDimStyle(
    entry: DimStyleEntry | undefined,
    overrides?: ReadonlyMap<number, DimValue>,
    options: EffectiveDimStyleOptions = {},
): DimVars {
    const out: Record<string, DimValue> = {};
    const present = entry ? dimStyleValues(entry) : new Map<number, DimValue>();
    const header = options.fallback === "header" ? options.header : undefined;
    for (const v of DIM_VARS) {
        let raw: unknown;
        if (overrides?.has(v.code)) raw = overrides.get(v.code);
        else if (present.has(v.code)) raw = present.get(v.code);
        else if (header) raw = headerDimValue(header, v);
        out[v.name] = raw === undefined ? v.def : normalizeDimValue(v, raw);
    }
    return out;
}

/**
 * The header `$DIM*` value of a variable, or undefined if absent. Handle-valued variables return
 * the header's *name* (e.g. `$DIMBLK=BoxBlank`, without the leading underscore of the block name,
 * note 05 §2.1). `$DIMJOGANG` is in radians.
 */
export function headerDimValue(header: Header, v: DimVarDef): DimValue | undefined {
    const name = `$${v.headerName ?? v.name}`;
    if (v.code >= 5 && v.code <= 7) return undefined; // no header equivalent of the R12 name codes
    const hv: HeaderValue | undefined = header.get(name);
    if (hv === undefined) return undefined;
    if (typeof hv === "object") return undefined; // point
    if (v.kind === "handle") return String(hv);
    if (v.code === 50 && typeof hv === "number") return (hv * 180) / Math.PI; // $DIMJOGANG: radians
    return normalizeDimValue(v, hv);
}

/** All `$DIM*` header variables present in the header, by variable name (current dimension settings). */
export function headerDimVars(header: Header): Record<string, DimValue> {
    const out: Record<string, DimValue> = {};
    for (const v of DIM_VARS) {
        const hv = headerDimValue(header, v);
        if (hv !== undefined) out[v.name] = hv;
    }
    return out;
}
