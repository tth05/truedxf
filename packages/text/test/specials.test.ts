import { describe, expect, it } from "vitest";
import { decodeCarets, decodeTextString } from "../src/index.ts";

const cps = (s: string) =>
  decodeTextString(s)
    .map((c) => String.fromCodePoint(c.cp))
    .join("");

describe("TEXT special codes (note 04 §1.6)", () => {
  it("decodes %% symbols case-insensitively", () => {
    expect(cps("%%c%%d%%p%%%")).toBe("Ø°±%");
    expect(cps("%%C%%D%%P")).toBe("Ø°±");
    expect(decodeTextString("%%c")[0]!.symbol).toBe("diameter");
  });
  it("toggles underline/overline/strike", () => {
    const d = decodeTextString("a%%ub%%uc%%o%%kd");
    expect(d.map((c) => c.underline)).toEqual([false, true, false, false]);
    expect(d[3]!.overline && d[3]!.strike).toBe(true);
  });
  it("decodes %%nnn greedily up to 3 digits", () => {
    expect(cps("%%216x")).toBe("Øx");
    expect(decodeTextString("%%065")[0]).toMatchObject({ cp: 65, numeric: true });
    expect(cps("%%1234")).toBe("{4");
  });
  it("drops %% before unknown codes", () => {
    expect(cps("a%%xb")).toBe("axb");
    expect(cps("ab%% cd%%%%")).toBe("ab cd%%");
    expect(cps("50%")).toBe("50%");
  });
  it("decodes \\U+XXXX (exactly 4 hex digits) and \\M+nXXXX", () => {
    expect(cps("\\U+2205\\U+00d8")).toBe("∅Ø");
    expect(cps("\\U+22054.0")).toBe("∅4.0");
    expect(cps("\\U+12")).toBe("\\U+12");
    expect(cps("\\M+5D7DF")).toBe("走");
  });
  it("does not interpret MTEXT codes in TEXT", () => {
    expect(cps("a\\Pb")).toBe("a\\Pb");
  });
  it("decodes carets and truncates at ^@", () => {
    expect(decodeCarets("a^Jb^ c")).toBe("a\nb^c");
    expect(decodeCarets("x^@y")).toBe("x");
    expect(decodeCarets("AB^")).toBe("AB^");
  });
});
