import { describe, expect, it } from "vitest";
import { defaultContext, type MTextToken, parseMText } from "../src/index.ts";

const parse = (s: string) => parseMText(s, defaultContext(2.5));
const str = (cs: readonly { cp: number }[]) => cs.map((c) => String.fromCodePoint(c.cp)).join("");

/** Readable token stream: chars joined, others as markers. */
function show(tokens: MTextToken[]): string {
    return tokens
        .map((t) => {
            switch (t.t) {
                case "char":
                    return String.fromCodePoint(t.ch.cp);
                case "space":
                    return " ";
                case "stack":
                    return `[${str(t.upper)}${t.kind}${str(t.lower)}]`;
                default:
                    return `<${t.t}>`;
            }
        })
        .join("");
}

describe("MTEXT inline codes (note 04 §3.3)", () => {
    it("handles paragraphs, literals, nbsp, tabs", () => {
        expect(show(parse("a\\Pb\\\\c\\{d\\}e\\~f^Ig^Jh"))).toBe(
            "a<paragraph>b\\c{d}e<nbsp>f<tab>g<paragraph>h",
        );
        expect(show(parse("a\nb\tc\rd"))).toBe("a<paragraph>b<tab>cd");
    });
    it("prints unknown commands verbatim", () => {
        expect(show(parse("a\\:b"))).toBe("a\\:b");
        // AutoCAD 2027 swallows "\C" without digits (VERIFIED-BY-ACAD mtext/code-invalid-codes)
        expect(show(parse("\\C+5x"))).toBe("+5x");
        expect(show(parse("a\\C+5b\\H1..5c\\AXd}e\\Jf\\:g"))).toBe("a+5b.5cXde\\Jf\\:g");
    });
    it("parses heights (absolute, relative, accumulating, invalid)", () => {
        const t = parse("\\H2.5;a{\\H2x;b\\H3x;c}d\\H1..5");
        const h = t.filter((x) => x.t === "char").map((x) => x.ctx.height);
        expect(h.slice(0, 4)).toEqual([2.5, 5, 15, 2.5]);
        expect(show(t)).toBe("abcd.5");
        expect(parse("\\H.5xa")[0]!.ctx.height).toBe(1.25);
        expect(parse("\\H-2;a")[0]!.ctx.height).toBe(2);
    });
    it("scopes properties with braces and ignores unbalanced }", () => {
        const t = parse("{\\C1;a}b}c");
        expect(t[0]!.ctx.color).toEqual({ kind: "aci", aci: 1 });
        expect(t[1]!.ctx.color).toBeUndefined();
        expect(show(t)).toBe("abc");
    });
    it("reads \\c as R + 256·G + 65536·B", () => {
        expect(parse("\\c255;x")[0]!.ctx.color).toEqual({ kind: "rgb", rgb: 0xff0000 });
        expect(parse("\\c16711680;x")[0]!.ctx.color).toEqual({ kind: "rgb", rgb: 0x0000ff });
    });
    it("ignores ACI > 256 but consumes it", () => {
        const t = parse("\\C1000;x");
        expect(show(t)).toBe("x");
        expect(t[0]!.ctx.color).toBeUndefined();
    });
    it("parses \\A with tolerance", () => {
        expect(parse("\\A1;x")[0]!.ctx.align).toBe(1);
        expect(parse("\\A5x")[0]!.ctx.align).toBe(0);
        expect(show(parse("\\AXy"))).toBe("Xy");
    });
    it("parses stacks", () => {
        expect(show(parse("\\S1/2;"))).toBe("[1/2]");
        expect(show(parse("\\S1^ 2;"))).toBe("[1^2]");
        expect(show(parse("\\S5^6;"))).toBe("[5\uFFF6]");
        expect(show(parse("\\S1#2;x"))).toBe("[1#2]x");
        expect(show(parse("\\S\\N^ \\P;"))).toBe("[N^P]");
        expect(show(parse("\\S1/2/3;"))).toBe("[1/2/3]");
        expect(show(parse("\\S12;"))).toBe("[12]");
        expect(show(parse("\\Sa\\;b/c;d"))).toBe("[a;b/c]d");
    });
    it("decodes \\U+ inside the tokenizer (no fake syntax)", () => {
        expect(show(parse("\\U+005CP"))).toBe("\\P");
        expect(show(parse("\\U+007Bx"))).toBe("{x");
    });
    it("parses font commands", () => {
        const t = parse("\\fArial|b1|i0|c0|p34;x\\Fgdt;y\\f|b1;z");
        expect(t[0]!.ctx.font).toEqual({ name: "Arial", bold: true, italic: false });
        expect(t[1]!.ctx.font).toEqual({ name: "gdt", bold: false, italic: false });
        expect(t[2]!.ctx.font!.name).toBe("gdt"); // empty family: no change
    });
    it("parses paragraph properties", () => {
        const p = parse("\\pxi-3,l4,t4;x")[0]!.ctx.paragraph;
        expect(p).toMatchObject({ indent: -3, left: 4, tabs: [{ pos: 4, kind: "left" }] });
        expect(parse("\\pxqc;x")[0]!.ctx.paragraph.align).toBe("center");
        expect(parse("\\pxqr;\\pq*;x")[0]!.ctx.paragraph.align).toBe("default");
        expect(parse("\\pxsm2;x")[0]!.ctx.paragraph.lineSpacing).toEqual({ mode: "multiple", factor: 2 });
        expect(parse("\\pxt1,c3,r5.5;x")[0]!.ctx.paragraph.tabs.map((t) => t.kind)).toEqual([
            "left",
            "center",
            "right",
        ]);
    });
    it("decodes %% specials, control characters and NUL", () => {
        expect(show(parse("%%c%%d%%p%%%"))).toBe("Ø°±%");
        expect(show(parse("a^Bb"))).toBe("a\u0002b");
        expect(show(parse("A^aB^zC^?D"))).toBe("A!B:C\uFFFFD");
        expect(show(parse("x^@y"))).toBe("x");
        expect(show(parse("1^ 2"))).toBe("1^2");
    });
});
