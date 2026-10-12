// Builds accoreconsole .scr scripts from case metadata (docs/fixtures.md) and the list of
// (prompt, answer) steps the echoed log must show (research/notes/08 §6.4, prompt texts
// VERIFIED-BY-ACAD 2027 transcript in research/notes/08 §10.1).
import { PDF_PC3, PNG_PC3, pdfPaperName, pngPaperName } from "./sizes.ts";

export type PlotArea =
    | { type: "window"; min: [number, number]; max: [number, number] }
    | { type: "extents" }
    | { type: "layout" };

export type PlotMeta = {
    layout: string;
    area: PlotArea;
    canvas: [number, number];
    /** CTB/STB file name in the Plot Styles folder, or "." for none (tools/acad README) */
    styleTable: string;
    lineweights: boolean;
    /** "fit", [paperUnits, drawingUnits], or a verbatim -PLOT scale answer such as "1:50" */
    scale: "fit" | [number, number] | string;
    /**
     * harness extension: "detailed" (default) answers every -PLOT prompt from this meta;
     * "pagesetup" plots with the page setup stored in the DXF (Detailed = No; only the device,
     * which must be the one stored in the layout, and the file name are answered)
     */
    mode?: "detailed" | "pagesetup";
    /** harness extension: drawing orientation (default Landscape, Portrait for square sheets) */
    orientation?: "portrait" | "landscape";
    /** harness extension: answer to "Plot upside down?" (default false) */
    upsideDown?: boolean;
    /** harness extension: answer to "Plot with plot styles?" (default true) */
    plotStyles?: boolean;
    /** harness extension: answer to "Scale lineweights with plot scale?" (layouts; default false) */
    scaleLineweights?: boolean;
    /** harness extension: PDF paper units (default inches; raster devices have no such prompt) */
    paperUnits?: "inches" | "mm";
    /** harness extension: answer "Save changes to page setup" with Yes and run DXFOUT after the plots */
    savePageSetup?: boolean;
    /** harness extension: answer to "Plot paper space first?" (layouts only; default false = AutoCAD default) */
    paperSpaceFirst?: boolean;
    /** harness extension: extra sysvars set after the prologue, e.g. { "PLOTTRANSPARENCYOVERRIDE": 2 } */
    sysvars?: Record<string, number | string>;
};

export type CaseMeta = {
    id: string;
    suite: string;
    title?: string;
    plot: PlotMeta;
    outputs?: ("png" | "pdf" | "dxf")[];
    [k: string]: unknown;
};

export type Step = { prompt: string; answer: string };

/**
 * Session sysvars pinned by every script (note 08 §7 item 8). They are registry/profile values;
 * the runner uses `/isolate` so they never leak into the user's AutoCAD profile.
 * Drawing-stored variables (FILLMODE, MSLTSCALE, SORTENTS, LTSCALE, PSLTSCALE, ...) are NOT
 * overridden — they are fixture properties — but they are echoed into the log.
 */
export const PROLOGUE_SYSVARS: [string, number | string][] = [
    ["FILEDIA", 0],
    ["CMDDIA", 0],
    ["CMDECHO", 1],
    ["EXPERT", 5],
    ["BACKGROUNDPLOT", 0],
    ["PLOTTRANSPARENCYOVERRIDE", 0],
    ["PLOTOFFSET", 0],
    ["PLOTROTMODE", 2],
    ["LWDEFAULT", 25],
    ["TEXTFILL", 1],
    ["TEXTQLTY", 50],
    ["FONTALT", "simplex.shx"],
    ["SECURELOAD", 0],
];
export const ECHO_SYSVARS = [
    "FILLMODE",
    "MSLTSCALE",
    "PSLTSCALE",
    "LTSCALE",
    "SORTENTS",
    "TILEMODE",
    "LWDISPLAY",
    "PDMODE",
    "PDSIZE",
];

export const MARK = "@@TRUEDXF@@";

const lispStr = (s: string) => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const lispVal = (v: number | string) => (typeof v === "number" ? String(v) : lispStr(v));
const fmt = (x: number) => {
    const s = x.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
    return s === "-0" ? "0" : s;
};

const LISP_HELPERS = [
    `(defun tdx-str (v) (cond ((= (type v) 'STR) v) ((= (type v) 'INT) (itoa v)) ((= (type v) 'REAL) (rtos v 2 8)) (T "?")))`,
    `(defun tdx-set (n v) (if (getvar n) (progn (setvar n v) (princ (strcat "\\n${MARK} SYSVAR " n "=" (tdx-str (getvar n))))) (princ (strcat "\\n${MARK} NOSYSVAR " n))) (princ))`,
    `(defun tdx-echo (n) (princ (strcat "\\n${MARK} ECHO " n "=" (if (getvar n) (tdx-str (getvar n)) "<none>"))) (princ))`,
];

const yn = (b: boolean | undefined) => (b ? "_Y" : "_N");

export function plotSteps(meta: CaseMeta, device: "png" | "pdf", outFile: string): Step[] {
    const p = meta.plot;
    const isModel = p.layout.toLowerCase() === "model";
    if (p.mode === "pagesetup") {
        // Non-detailed -PLOT (VERIFIED-BY-ACAD 2026-10-12): "Enter a page setup name <>" (Enter =
        // the layout's own settings), device (answered with the stored device so it stays
        // unchanged), file name, save, proceed.
        return [
            { prompt: "Detailed plot configuration?", answer: "_N" },
            { prompt: "Enter a layout name or [?]", answer: isModel ? "Model" : p.layout },
            { prompt: "Enter a page setup name", answer: "" },
            { prompt: "Enter an output device name or [?]", answer: device === "png" ? PNG_PC3 : PDF_PC3 },
            { prompt: "Enter file name", answer: outFile },
            { prompt: "Save changes to page setup", answer: yn(p.savePageSetup) },
            { prompt: "Proceed with plot", answer: "_Y" },
        ];
    }
    const steps: Step[] = [
        { prompt: "Detailed plot configuration?", answer: "_Y" },
        { prompt: "Enter a layout name or [?]", answer: isModel ? "Model" : p.layout },
        { prompt: "Enter an output device name or [?]", answer: device === "png" ? PNG_PC3 : PDF_PC3 },
        {
            prompt: "Enter paper size or [?]",
            answer: device === "png" ? pngPaperName(p.canvas) : pdfPaperName(p.canvas),
        },
    ];
    // Raster devices have no paper-units prompt (VERIFIED-BY-ACAD); PDF sheets are in inches = px/100.
    if (device === "pdf")
        steps.push({
            prompt: "Enter paper units [Inches/Millimeters]",
            answer: p.paperUnits === "mm" ? "_M" : "_I",
        });
    steps.push(
        // Square sheets: "Landscape" rotates the plot by 90 deg (VERIFIED-BY-ACAD, note 08 §10.1);
        // "Portrait" keeps +X to the right. Wider-than-high sheets use Landscape.
        // On a landscape sheet Landscape/Portrait x upside-down No/Yes are stored as PLOTSETTINGS
        // 73 = 0/1/2/3 (VERIFIED-BY-ACAD 2026-10-12, note 08 §2.1).
        {
            prompt: "Enter drawing orientation [Portrait/Landscape]",
            answer: p.orientation
                ? p.orientation === "portrait"
                    ? "_P"
                    : "_L"
                : p.canvas[0] > p.canvas[1]
                  ? "_L"
                  : "_P",
        },
        { prompt: "Plot upside down?", answer: yn(p.upsideDown) },
    );
    const a = p.area;
    if (a.type === "window") {
        steps.push(
            { prompt: "Enter plot area", answer: "_W" },
            { prompt: "Enter lower left corner of window", answer: `${fmt(a.min[0])},${fmt(a.min[1])}` },
            { prompt: "Enter upper right corner of window", answer: `${fmt(a.max[0])},${fmt(a.max[1])}` },
        );
    } else if (a.type === "extents") {
        steps.push({ prompt: "Enter plot area", answer: "_E" });
    } else {
        if (isModel) throw new Error("area type 'layout' needs a paper-space layout");
        steps.push({ prompt: "Enter plot area", answer: "_L" });
    }
    let scale: string;
    if (p.scale === "fit") scale = "_F";
    else if (typeof p.scale === "string") scale = p.scale;
    else {
        // Paper units are pixels on the PNG device and inches (= px / 100) on the PDF device.
        const [paper, drawing] = p.scale;
        scale = `${fmt(device === "png" ? paper : paper / 100)}=${fmt(drawing)}`;
    }
    steps.push(
        { prompt: "Enter plot scale", answer: scale },
        // Plot area "Layout" has no [Center] option (VERIFIED-BY-ACAD: "_C" cancels -PLOT).
        a.type === "layout"
            ? { prompt: "Enter plot offset (x,y)", answer: "0,0" }
            : { prompt: "Enter plot offset (x,y) or [Center]", answer: "_C" },
        // The style-table prompt also follows a "No" (VERIFIED-BY-ACAD 2026-10-12).
        { prompt: "Plot with plot styles?", answer: yn(p.plotStyles ?? true) },
        { prompt: "Enter plot style table name", answer: p.styleTable },
        { prompt: "Plot with lineweights?", answer: yn(p.lineweights) },
    );
    if (isModel) {
        steps.push({ prompt: "Enter shade plot setting", answer: "_A" });
    } else {
        steps.push(
            { prompt: "Scale lineweights with plot scale?", answer: yn(p.scaleLineweights) },
            { prompt: "Plot paper space first?", answer: p.paperSpaceFirst ? "_Y" : "_N" },
            { prompt: "Hide paperspace objects?", answer: "_N" },
        );
    }
    steps.push(
        { prompt: "Enter file name", answer: outFile },
        { prompt: "Save changes to page setup", answer: yn(p.savePageSetup) },
        { prompt: "Proceed with plot", answer: "_Y" },
    );
    return steps;
}

export function dxfoutSteps(outFile: string): Step[] {
    return [
        { prompt: "Enter DXF file name", answer: outFile },
        { prompt: "Enter decimal places of accuracy", answer: "_V" },
        { prompt: "Enter version", answer: "2018" },
        { prompt: "Enter decimal places of accuracy", answer: "16" },
    ];
}

export type BuiltScript = {
    text: string;
    plots: { device: "png" | "pdf"; steps: Step[] }[];
    zoom?: Step[];
    dxfout?: Step[];
};

/**
 * Model-space window plots: zoom the current view to a tiny area at the window centre first.
 * When the plot window lies inside the current view, AutoCAD trims the window to the geometry
 * extents on every side where the extents come closer to the window edge than ~2 % of the view
 * height, and then centres the trimmed area — shifting the whole plot (VERIFIED-BY-ACAD,
 * note 08 §10.1). A view smaller than the window disables the trimming.
 */
export function zoomSteps(meta: CaseMeta): Step[] | undefined {
    const p = meta.plot;
    if (p.area.type !== "window") return undefined;
    const { min, max } = p.area;
    return [
        { prompt: "[All/Center/Dynamic/Extents/Previous/Scale/Window/Object]", answer: "_C" },
        {
            prompt: "Specify center point",
            answer: `${fmt((min[0] + max[0]) / 2)},${fmt((min[1] + max[1]) / 2)}`,
        },
        { prompt: "Enter magnification or height", answer: fmt((max[1] - min[1]) / 100) },
    ];
}

export function buildScript(
    meta: CaseMeta,
    files: { png?: string; pdf?: string; dxf?: string },
): BuiltScript {
    const lines: string[] = [...LISP_HELPERS];
    for (const [n, v] of PROLOGUE_SYSVARS) lines.push(`(tdx-set ${lispStr(n)} ${lispVal(v)})`);
    for (const [n, v] of Object.entries(meta.plot.sysvars ?? {}))
        lines.push(`(tdx-set ${lispStr(n)} ${lispVal(v)})`);
    for (const n of ECHO_SYSVARS) lines.push(`(tdx-echo ${lispStr(n)})`);
    lines.push("_.UCS", "_W");
    // DXFOUT first, so the AutoCAD re-save does not contain the harness ZOOM below; after the
    // plots when the plots save their page setup (savePageSetup).
    let dxfout: Step[] | undefined;
    const dxfoutLast = !!meta.plot.savePageSetup;
    if (files.dxf && !dxfoutLast) {
        dxfout = dxfoutSteps(files.dxf);
        lines.push(`(princ "\\n${MARK} BEGIN dxf")`, "_.DXFOUT", ...dxfout.map((s) => s.answer));
    }
    const zoom = zoomSteps(meta);
    if (zoom) {
        // Paper-space window plots are trimmed the same way: switch to the layout (paper space) and
        // zoom there. LAYOUTCREATEVIEWPORT 0 so the switch never adds a viewport to the layout.
        if (meta.plot.layout.toLowerCase() !== "model") {
            lines.push(
                `(tdx-set "LAYOUTCREATEVIEWPORT" 0)`,
                `(setvar "CTAB" ${lispStr(meta.plot.layout)})`,
                "_.PSPACE",
            );
        }
        lines.push(`(princ "\\n${MARK} BEGIN zoom")`, "_.ZOOM", ...zoom.map((s) => s.answer));
    }
    const plots: BuiltScript["plots"] = [];
    for (const device of ["png", "pdf"] as const) {
        const out = files[device];
        if (!out) continue;
        const steps = plotSteps(meta, device, out);
        plots.push({ device, steps });
        lines.push(`(princ "\\n${MARK} BEGIN ${device}")`, "_.-PLOT", ...steps.map((s) => s.answer));
    }
    if (files.dxf && dxfoutLast) {
        dxfout = dxfoutSteps(files.dxf);
        lines.push(`(princ "\\n${MARK} BEGIN dxf")`, "_.DXFOUT", ...dxfout.map((s) => s.answer));
    }
    lines.push(`(princ "\\n${MARK} DONE\\n")`, "_.QUIT", "_Y");
    // CRLF, no BOM, final newline (note 08 §6.3).
    return {
        text: `${lines.join("\r\n")}\r\n`,
        plots,
        ...(zoom ? { zoom } : {}),
        ...(dxfout ? { dxfout } : {}),
    };
}

/**
 * Checks that the echoed log answers `steps` in order: each step must match a later log line that
 * contains the prompt text and ends with the answer. Returns the first mismatch, or null.
 */
export function verifySteps(
    logLines: string[],
    from: number,
    steps: Step[],
): { at: number; error: string | null } {
    let i = from;
    for (const s of steps) {
        let found = -1;
        for (let j = i; j < logLines.length; j++) {
            const l = logLines[j]!;
            if (l.includes(s.prompt)) {
                found = j;
                break;
            }
        }
        if (found < 0) return { at: i, error: `prompt not found: "${s.prompt}" (answer ${s.answer})` };
        const line = logLines[found]!.trimEnd();
        // An empty answer (Enter) accepts the default: the echoed line ends with the prompt.
        if (s.answer !== "" && !line.endsWith(` ${s.answer}`))
            return { at: found, error: `unexpected answer line: ${line}` };
        // A re-prompt of the same question means AutoCAD rejected the answer.
        const next = logLines.slice(found + 1, found + 3).find((l) => l.includes(s.prompt));
        if (next && s.prompt !== "Enter decimal places of accuracy")
            return { at: found, error: `answer rejected: ${line}` };
        i = found + 1;
    }
    return { at: i, error: null };
}
