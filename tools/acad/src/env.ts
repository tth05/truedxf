// Local AutoCAD installation paths (overridable through environment variables).
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const ACAD_DIR = process.env.TRUEDXF_ACAD_DIR ?? "C:\\Program Files\\Autodesk\\AutoCAD 2027";
export const ACCORECONSOLE = join(ACAD_DIR, "accoreconsole.exe");

/** Roaming profile folder of the AutoCAD release (R26.0 = AutoCAD 2027). */
export const ACAD_ROAMING =
    process.env.TRUEDXF_ACAD_ROAMING ??
    join(
        process.env.APPDATA ?? "C:\\Users\\Default\\AppData\\Roaming",
        "Autodesk",
        "AutoCAD 2027",
        "R26.0",
        "enu",
    );

export const PLOTTERS_DIR = process.env.TRUEDXF_PLOTTERS_DIR ?? join(ACAD_ROAMING, "Plotters");
export const PMP_DIR = join(PLOTTERS_DIR, "PMP Files");
export const PLOT_STYLES_DIR = join(PLOTTERS_DIR, "Plot Styles");

export const SAMPLES_DIR = join(REPO_ROOT, "samples");
export const GENERATED_DIR = join(SAMPLES_DIR, "generated");
export const REFS_DIR = join(SAMPLES_DIR, "refs");

export function requireFile(p: string, what: string): string {
    if (!existsSync(p)) throw new Error(`${what} not found: ${p}`);
    return p;
}
