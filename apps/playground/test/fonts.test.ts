import { describe, expect, it } from "vitest";
import { FONT_ALIASES, fontLoader } from "../src/fonts.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);

describe("playground font loader", () => {
    const served = async (name: string) =>
        name === "liberationsans-regular.ttf" || name === "simplex.shx" ? bytes(`served:${name}`) : undefined;

    it("prefers the fonts folder, then the served fonts, then the Liberation stand-in", async () => {
        const folder = {
            read: async (name: string) => (name === "arial.ttf" ? bytes("folder:arial") : undefined),
        };
        const load = fontLoader(folder, served);
        expect(text(await load("Arial.TTF"))).toBe("folder:arial");
        expect(text(await load("simplex.shx"))).toBe("served:simplex.shx");

        const none = fontLoader({ read: async () => undefined }, served);
        expect(text(await none("arial.ttf"))).toBe("served:liberationsans-regular.ttf");
        expect(await none("txt.shx")).toBeUndefined();
    });

    it("maps every Windows core face to a bundled Liberation file", () => {
        for (const target of Object.values(FONT_ALIASES))
            expect(target).toMatch(/^liberation(sans|serif|mono)-/);
        expect(Object.keys(FONT_ALIASES)).toHaveLength(12);
    });
});
