import { afterEach, describe, expect, it } from "vitest";
import { FONT_ALIASES, fontLoader, InstalledFonts } from "../src/fonts.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);
const nothing = { read: async () => undefined };

describe("playground font loader", () => {
    const served = async (name: string) =>
        name === "liberationsans-regular.ttf" || name === "selawk.ttf" || name === "simplex.shx"
            ? bytes(`served:${name}`)
            : undefined;

    it("prefers the fonts folder, then the served fonts, then the installed fonts, then the stand-in", async () => {
        const folder = {
            read: async (name: string) => (name === "arial.ttf" ? bytes("folder:arial") : undefined),
        };
        const installed = {
            read: async (name: string) =>
                name === "arial.ttf" || name === "segoeui.ttf" || name === "simplex.shx"
                    ? bytes(`installed:${name}`)
                    : undefined,
        };
        const load = fontLoader(folder, installed, served);
        expect(text(await load("Arial.TTF"))).toBe("folder:arial");
        expect(text(await load("simplex.shx"))).toBe("served:simplex.shx");
        expect(text(await load("segoeui.ttf"))).toBe("installed:segoeui.ttf");

        const none = fontLoader(nothing, nothing, served);
        expect(text(await none("arial.ttf"))).toBe("served:liberationsans-regular.ttf");
        expect(text(await none("segoeuib.ttf"))).toBeUndefined();
        expect(text(await none("segoeuii.ttf"))).toBe("served:selawk.ttf");
        expect(await none("txt.shx")).toBeUndefined();
    });

    it("maps Windows faces to bundled Liberation and Selawik files", () => {
        for (const [from, to] of Object.entries(FONT_ALIASES))
            expect(to).toMatch(
                /^seg/.test(from) ? /^selawk(|b|l|sl|sb)\.ttf$/ : /^liberation(sans|serif|mono)-/,
            );
        expect(Object.keys(FONT_ALIASES)).toHaveLength(22);
    });
});

describe("installed fonts", () => {
    const g = globalThis as { queryLocalFonts?: unknown };
    afterEach(() => {
        delete g.queryLocalFonts;
    });
    const face = (postscriptName: string, fullName: string) => ({
        postscriptName,
        fullName,
        blob: async () => new Blob([`installed:${postscriptName}`]),
    });

    it("is unsupported without the Local Font Access API", () => {
        expect(new InstalledFonts().state).toBe("unsupported");
    });

    it("matches font files to installed faces by PostScript name", async () => {
        g.queryLocalFonts = async () => [
            face("ArialMT", "Arial"),
            face("Arial-BoldMT", "Arial Bold"),
            face("SegoeUI", "Segoe UI"),
            face("SegoeUI-Bold", "Segoe UI Bold"),
            face("Verdana", "Verdana"),
        ];
        const fonts = new InstalledFonts();
        expect(fonts.state).toBe("none");
        expect(await fonts.read("arial.ttf")).toBeUndefined();
        await fonts.enable();
        expect(fonts.state).toBe("ready");
        expect(fonts.count).toBe(5);
        // the Windows file name table
        expect(text(await fonts.read("arialbd.ttf"))).toBe("installed:Arial-BoldMT");
        expect(text(await fonts.read("segoeuib.ttf"))).toBe("installed:SegoeUI-Bold");
        // the base name: PostScript name, without "-Regular", or the full name
        expect(text(await fonts.read("verdana.ttf"))).toBe("installed:Verdana");
        expect(text(await fonts.read("segoeui-regular.ttf"))).toBe("installed:SegoeUI");
        expect(text(await fonts.read("segoe ui bold.ttf"))).toBe("installed:SegoeUI-Bold");
        // not installed; SHX fonts are never installed fonts
        expect(await fonts.read("verdanab.ttf")).toBeUndefined();
        expect(await fonts.read("verdana.shx")).toBeUndefined();

        await fonts.disable();
        expect(fonts.state).toBe("none");
        expect(await fonts.read("verdana.ttf")).toBeUndefined();
    });

    it("reports a refused permission", async () => {
        g.queryLocalFonts = async () => {
            throw new Error("NotAllowedError");
        };
        const fonts = new InstalledFonts();
        await fonts.enable();
        expect(fonts.state).toBe("denied");
    });
});
