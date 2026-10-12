/**
 * VIEWPORT entity (paper-space viewport). research/notes/08-layouts-viewports-plotting.md §3.
 *
 * - `center` is in paper-space coordinates; `viewCenter` (12) is in **DCS**, relative to the view
 *   target (17) and rotated by the twist (note 08 §3.1, realdwg-web#138).
 * - `viewDirection` (16) may be non-normalized (ezdxf#1298): normalize before use.
 * - scale = height (41) / viewHeight (45) paper units per model unit (§3.3).
 * - `status` (68) and `id` (69) are unreliable in files (§3.2); on/off is `flags & 0x20000`.
 * - Frozen layers: DXF writes 331; 341 (the DWG code) is accepted as well.
 * - R12 files store the view data in XDATA `ACAD` / `MVIEW` (ezdxf viewport.py), decoded here.
 */
import { fieldTable, readFields } from "../fields.ts";
import type { DxfRecord } from "../record.ts";
import { type TypedTag, tagNum, xdataList, xdataTags } from "../tags.ts";
import type { Point2, Point3 } from "../types.ts";
import { type EntityBase, registerEntity } from "./common.ts";

const Z = Object.freeze({ x: 0, y: 0, z: 1 });
const X = Object.freeze({ x: 1, y: 0, z: 0 });
const Y = Object.freeze({ x: 0, y: 1, z: 0 });
const O = Object.freeze({ x: 0, y: 0, z: 0 });
const O2 = Object.freeze({ x: 0, y: 0 });

/** Status flags (90), note 08 §3.1.1. */
export const ViewportFlags = {
    Perspective: 0x1,
    FrontClip: 0x2,
    BackClip: 0x4,
    UcsFollow: 0x8,
    FrontClipNotAtEye: 0x10,
    UcsIconVisible: 0x20,
    UcsIconAtOrigin: 0x40,
    FastZoom: 0x80,
    Snap: 0x100,
    Grid: 0x200,
    IsometricSnap: 0x400,
    HidePlot: 0x800,
    IsoPairTop: 0x1000,
    IsoPairRight: 0x2000,
    ZoomLock: 0x4000,
    AlwaysEnabled: 0x8000,
    NonRectangularClipping: 0x10000,
    Off: 0x20000,
    GridBeyondLimits: 0x40000,
    AdaptiveGrid: 0x80000,
    SubdivideGrid: 0x100000,
    GridFollowsWorkplane: 0x200000,
} as const;

export interface ViewportEntity extends EntityBase {
    readonly type: "VIEWPORT";
    /** Paper-space center of the viewport rectangle. */
    readonly center: Point3;
    /** Paper-space width / height (40/41). */
    readonly width: number;
    readonly height: number;
    /** 68 (runtime; unreliable). */
    readonly status: number;
    /** 69 (1 = overall paper-space viewport, unreliable). */
    readonly id: number;
    /** 12, DCS. */
    readonly viewCenter: Point2;
    readonly snapBase: Point2;
    readonly snapSpacing: Point2;
    readonly gridSpacing: Point2;
    /** 16, WCS, from target towards the camera; not necessarily unit length. */
    readonly viewDirection: Point3;
    /** 17, WCS. */
    readonly viewTarget: Point3;
    readonly lensLength: number;
    readonly frontClip: number;
    readonly backClip: number;
    /** 45: view height in model units (DCS). */
    readonly viewHeight: number;
    /** Degrees. */
    readonly snapAngle: number;
    /** 51, degrees; sign convention: note 08 §3.5 (CONFLICT, verify). */
    readonly twist: number;
    readonly circleZoom: number;
    /** LAYER handles frozen in this viewport (331, also 341). */
    readonly frozenLayerHandles: readonly string[];
    /** R12 (XDATA MVIEW): frozen layer *names* (1003). */
    readonly frozenLayerNames: readonly string[];
    /** 90 status flags (ViewportFlags). */
    readonly flags: number;
    /** 340: clip boundary entity (only if flags & NonRectangularClipping). */
    readonly clipBoundaryHandle: string | undefined;
    /** 1: plot style sheet of the viewport. */
    readonly plotStyleSheet: string;
    readonly renderMode: number;
    readonly ucsPerViewport: boolean;
    readonly ucsIcon: number;
    readonly ucsOrigin: Point3;
    readonly ucsXAxis: Point3;
    readonly ucsYAxis: Point3;
    readonly ucsHandle: string | undefined;
    readonly baseUcsHandle: string | undefined;
    readonly ucsOrthoType: number;
    readonly elevation: number;
    /** 170: 0 as displayed, 1 wireframe, 2 hidden, 3 rendered. */
    readonly shadePlotMode: number;
    readonly gridFrequency: number;
    readonly backgroundHandle: string | undefined;
    readonly shadePlotHandle: string | undefined;
    readonly visualStyleHandle: string | undefined;
    readonly defaultLighting: boolean;
    readonly defaultLightingType: number;
    readonly brightness: number;
    readonly contrast: number;
    readonly ambientColor: number;
    readonly ambientTrueColor: number | undefined;
    readonly ambientColorName: string | undefined;
    readonly sunHandle: string | undefined;
    /** Convenience: !(flags & Off). */
    readonly isOn: boolean;
    /** Convenience: 41/45 (paper units per model unit), 0 if viewHeight is 0. */
    readonly scale: number;
}

const V = "AcDbViewport";
const VIEWPORT = fieldTable([
    { name: "center", code: 10, kind: "p3", subclass: V, def: O },
    { name: "width", code: 40, kind: "num", subclass: V, def: 1 },
    { name: "height", code: 41, kind: "num", subclass: V, def: 1 },
    { name: "status", code: 68, kind: "int", subclass: V, def: 0 },
    { name: "id", code: 69, kind: "int", subclass: V, def: 2 },
    { name: "viewCenter", code: 12, kind: "p2", subclass: V, def: O2 },
    { name: "snapBase", code: 13, kind: "p2", subclass: V, def: O2 },
    { name: "snapSpacing", code: 14, kind: "p2", subclass: V, def: { x: 10, y: 10 } },
    { name: "gridSpacing", code: 15, kind: "p2", subclass: V, def: { x: 10, y: 10 } },
    { name: "viewDirection", code: 16, kind: "p3", subclass: V, def: Z },
    { name: "viewTarget", code: 17, kind: "p3", subclass: V, def: O },
    { name: "lensLength", code: 42, kind: "num", subclass: V, def: 50 },
    { name: "frontClip", code: 43, kind: "num", subclass: V, def: 0 },
    { name: "backClip", code: 44, kind: "num", subclass: V, def: 0 },
    { name: "viewHeight", code: 45, kind: "num", subclass: V, def: 1 },
    { name: "snapAngle", code: 50, kind: "num", subclass: V, def: 0 },
    { name: "twist", code: 51, kind: "num", subclass: V, def: 0 },
    { name: "circleZoom", code: 72, kind: "int", subclass: V, def: 100 },
    { name: "frozen331", code: 331, kind: "handle", subclass: V, many: true },
    { name: "frozen341", code: 341, kind: "handle", subclass: V, many: true },
    { name: "flags", code: 90, kind: "int", subclass: V, def: 0 },
    { name: "clipBoundaryHandle", code: 340, kind: "handle", subclass: V },
    { name: "plotStyleSheet", code: 1, kind: "str", subclass: V, def: "" },
    { name: "renderMode", code: 281, kind: "int", subclass: V, def: 0 },
    { name: "ucsPerViewport", code: 71, kind: "bool", subclass: V, def: false },
    { name: "ucsIcon", code: 74, kind: "int", subclass: V, def: 0 },
    { name: "ucsOrigin", code: 110, kind: "p3", subclass: V, def: O },
    { name: "ucsXAxis", code: 111, kind: "p3", subclass: V, def: X },
    { name: "ucsYAxis", code: 112, kind: "p3", subclass: V, def: Y },
    { name: "ucsHandle", code: 345, kind: "handle", subclass: V },
    { name: "baseUcsHandle", code: 346, kind: "handle", subclass: V },
    { name: "ucsOrthoType", code: 79, kind: "int", subclass: V, def: 0 },
    { name: "elevation", code: 146, kind: "num", subclass: V, def: 0 },
    { name: "shadePlotMode", code: 170, kind: "int", subclass: V, def: 0 },
    { name: "gridFrequency", code: 61, kind: "int", subclass: V, def: 5 },
    { name: "backgroundHandle", code: 332, kind: "handle", subclass: V },
    { name: "shadePlotHandle", code: 333, kind: "handle", subclass: V },
    { name: "visualStyleHandle", code: 348, kind: "handle", subclass: V },
    { name: "defaultLighting", code: 292, kind: "bool", subclass: V, def: true },
    { name: "defaultLightingType", code: 282, kind: "int", subclass: V, def: 1 },
    { name: "brightness", code: 141, kind: "num", subclass: V, def: 0 },
    { name: "contrast", code: 142, kind: "num", subclass: V, def: 0 },
    { name: "ambientColor", code: 63, kind: "int", subclass: V, def: 250 },
    { name: "ambientTrueColor", code: 421, kind: "int", subclass: V },
    { name: "ambientColorName", code: 431, kind: "str", subclass: V },
    { name: "sunHandle", code: 361, kind: "handle", subclass: V },
]);

type Fields = Omit<
    ViewportEntity,
    keyof EntityBase | "frozenLayerHandles" | "frozenLayerNames" | "isOn" | "scale"
> & {
    frozen331: string[];
    frozen341: string[];
};

/** R12 viewport data from XDATA ACAD/MVIEW (layout per ezdxf `load_xdata_into_dxf_namespace`). */
function readMView(rec: DxfRecord): Partial<Fields> & { frozenNames?: string[] } {
    const list = xdataList(xdataTags(rec, "ACAD"), "MVIEW");
    if (!list || list.length < 26) return {};
    // list[0] = 1070 version (16); values follow in fixed order; the frozen-layer names are a nested list
    const v: TypedTag[] = [];
    const names: string[] = [];
    let depth = 0;
    for (let k = 1; k < list.length; k++) {
        const t = list[k]!;
        if (t.code === 1002) {
            depth += String(t.value).trim() === "{" ? 1 : -1;
            continue;
        }
        if (depth > 0) {
            if (t.code === 1003) names.push(String(t.value));
        } else v.push(t);
    }
    const p = (t: TypedTag | undefined): Point3 =>
        t && typeof t.value === "object" && !(t.value instanceof Uint8Array) ? (t.value as Point3) : O;
    const n = (k: number) => tagNum(v[k]);
    let flags = 0;
    if (n(11)) flags |= ViewportFlags.FastZoom;
    if (n(13)) flags |= ViewportFlags.Snap;
    if (n(14)) flags |= ViewportFlags.Grid;
    if (n(15)) flags |= ViewportFlags.IsometricSnap;
    if (n(24)) flags |= ViewportFlags.HidePlot;
    return {
        viewTarget: p(v[0]),
        viewDirection: p(v[1]),
        twist: n(2),
        viewHeight: n(3),
        viewCenter: { x: n(4), y: n(5) },
        lensLength: n(6),
        frontClip: n(7),
        backClip: n(8),
        renderMode: n(9),
        circleZoom: n(10),
        ucsIcon: n(12),
        snapAngle: n(17),
        snapBase: { x: n(18), y: n(19) },
        snapSpacing: { x: n(20), y: n(21) },
        gridSpacing: { x: n(22), y: n(23) },
        flags,
        frozenNames: names,
    };
}

registerEntity<ViewportEntity>("VIEWPORT", (rec, base) => {
    let f = readFields<Fields>(rec, VIEWPORT);
    let frozenLayerNames: string[] = [];
    if (!rec.hasSubclasses) {
        const { frozenNames, ...mv } = readMView(rec);
        f = { ...f, ...mv };
        frozenLayerNames = frozenNames ?? [];
    }
    const { frozen331, frozen341, ...rest } = f;
    return {
        ...base,
        ...rest,
        type: "VIEWPORT",
        frozenLayerHandles: [...frozen331, ...frozen341].filter((h) => h !== "0"),
        frozenLayerNames,
        clipBoundaryHandle:
            f.clipBoundaryHandle && f.clipBoundaryHandle !== "0" ? f.clipBoundaryHandle : undefined,
        isOn: (f.flags & ViewportFlags.Off) === 0,
        scale: f.viewHeight !== 0 ? f.height / f.viewHeight : 0,
    };
});
